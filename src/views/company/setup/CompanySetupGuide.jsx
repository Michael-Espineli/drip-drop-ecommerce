import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, where, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import {
  FaArrowRight,
  FaCheckCircle,
  FaClipboardList,
  FaFastForward,
  FaFileInvoiceDollar,
  FaMapMarkedAlt,
  FaRedoAlt,
  FaRegCircle,
  FaRoute,
  FaUsers,
} from "react-icons/fa";
import { MdEmail, MdOutlineLocalOffer } from "react-icons/md";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { db } from "../../../utils/config";
import { salesCollectionNames } from "../../../utils/models/Sales";
import BillingReadinessCard from "../sales/components/BillingReadinessCard";

const emptyCounts = {
  companyUsers: 0,
  customers: 0,
  serviceLocations: 0,
  bodiesOfWater: 0,
  equipment: 0,
  taskGroups: 0,
  jobTemplates: 0,
  recurringServiceStops: 0,
  routes: 0,
  serviceStops: 0,
  jobs: 0,
  termsTemplates: 0,
  catalogItems: 0,
  agreements: 0,
  billingProfiles: 0,
  billingSubscriptions: 0,
  activeBillingSubscriptions: 0,
  invoices: 0,
  payments: 0,
  customerMigrationRows: 0,
};

const STARTUP_GUIDE_TEMPLATE_VERSION = 1;
const STARTUP_GUIDE_STATUS = {
  active: "active",
  skipped: "skipped",
  complete: "complete",
};
const STARTUP_ITEM_STATUS = {
  open: "open",
  complete: "complete",
};

const startupGuideDocRef = (companyId) => doc(db, "companies", companyId, "settings", "startupGuide");
const startupGuideItemsRef = (companyId) => collection(db, "companies", companyId, "settings", "startupGuide", "items");

const safeGetDoc = async (ref, label) => {
  try {
    return await getDoc(ref);
  } catch (err) {
    console.debug(`Unable to load setup document for ${label}:`, err);
    return null;
  }
};

const safeGetDocs = async (ref, label) => {
  try {
    return await getDocs(ref);
  } catch (err) {
    console.debug(`Unable to load setup collection for ${label}:`, err);
    return { docs: [] };
  }
};

const countSnapshot = async (ref, label = "collection") => {
  try {
    const snapshot = await getDocs(ref);
    return snapshot.size;
  } catch (err) {
    console.debug(`Unable to load setup count for ${label}:`, err);
    return 0;
  }
};

const normalizeStatus = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const getBillingSubscriptionCounts = async (companyId) => {
  try {
    const snapshot = await getDocs(query(collection(db, salesCollectionNames.billingSubscriptions), where("companyId", "==", companyId)));
    const activeBillingSubscriptions = snapshot.docs.filter((subscriptionDoc) => {
      const data = subscriptionDoc.data() || {};
      return ["active", "trialing"].includes(normalizeStatus(data.stripeStatus || data.status));
    }).length;

    return {
      activeBillingSubscriptions,
      billingSubscriptions: snapshot.size,
    };
  } catch (err) {
    console.debug("Unable to load setup billing subscription counts:", err);
    return {
      activeBillingSubscriptions: 0,
      billingSubscriptions: 0,
    };
  }
};

const getString = (...values) => values.find((value) => typeof value === "string" && value.trim()) || "";

const getActorId = (dataBaseUser, authUser) => (
  dataBaseUser?.id ||
  dataBaseUser?.userId ||
  dataBaseUser?.uid ||
  authUser?.uid ||
  ""
);

const getActorName = (dataBaseUser, authUser) => (
  getString(
    dataBaseUser?.userName,
    dataBaseUser?.displayName,
    [dataBaseUser?.firstName, dataBaseUser?.lastName].filter(Boolean).join(" "),
    authUser?.displayName,
    authUser?.email
  ) || "Company user"
);

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const normalizeStoredStartupItem = (item = {}, fallbackOrder = 0) => ({
  id: item.id || item.templateItemId || "",
  templateItemId: item.templateItemId || item.id || "",
  sectionId: item.sectionId || "",
  sectionTitle: item.sectionTitle || "",
  title: String(item.title || "").trim(),
  description: String(item.description || "").trim(),
  routePath: item.routePath || item.to || "",
  actionLabel: item.actionLabel || "Open",
  sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : fallbackOrder,
  status: item.status === STARTUP_ITEM_STATUS.complete ? STARTUP_ITEM_STATUS.complete : STARTUP_ITEM_STATUS.open,
  completedAt: item.completedAt || null,
  completedByUserId: item.completedByUserId || "",
  completedByName: item.completedByName || "",
  lastEvidence: item.lastEvidence || null,
});

const buildStartupItemPayload = (item) => ({
  id: item.id,
  templateItemId: item.id,
  sectionId: item.sectionId,
  sectionTitle: item.sectionTitle,
  title: item.title,
  description: item.description,
  routePath: item.to,
  actionLabel: item.actionLabel,
  sortOrder: Number(item.sortOrder || 0),
  templateVersion: STARTUP_GUIDE_TEMPLATE_VERSION,
  completionMode: "live_data",
  lastEvidence: {
    satisfied: !!item.completed,
    metric: item.metric,
    checkedAt: serverTimestamp(),
  },
  updatedAt: serverTimestamp(),
});

const SectionIcon = ({ icon: Icon }) => (
  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white">
    <Icon className="h-4 w-4" />
  </span>
);

const SetupItem = ({ item, guideSkipped }) => {
  const complete = item.status === STARTUP_ITEM_STATUS.complete;
  const disabled = guideSkipped;
  const statusLabel = disabled ? "Guide skipped" : complete ? "Done" : "Needs setup";
  const statusClass = disabled
    ? "rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500"
    : complete
      ? "rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
      : "rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700";

  return (
    <div className={`rounded-md border border-slate-200 bg-white p-4 shadow-sm ${disabled ? "opacity-70" : ""}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={complete ? "mt-0.5 text-emerald-600" : "mt-0.5 text-slate-300"}>
            {complete ? <FaCheckCircle className="h-5 w-5" /> : <FaRegCircle className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
              <span className={statusClass}>{statusLabel}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
            {complete && item.completedAt ? (
              <p className="mt-2 text-xs font-semibold text-emerald-700">
                Completed {formatDate(item.completedAt)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.metric}</span>
          <Link
            to={item.to}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {item.actionLabel}
            <FaArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
};

const CompanySetupGuide = () => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    stripeConnectedAccountId,
    user: authUser,
    dataBaseUser,
  } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [company, setCompany] = useState(null);
  const [emailConfig, setEmailConfig] = useState(null);
  const [counts, setCounts] = useState(emptyCounts);
  const [startupGuide, setStartupGuide] = useState(null);
  const [storedStartupItems, setStoredStartupItems] = useState([]);
  const [guideSaving, setGuideSaving] = useState(false);
  const [guideSyncing, setGuideSyncing] = useState(false);
  const guideSyncInFlight = useRef(false);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLoading(false);
      setCompany(null);
      setEmailConfig(null);
      setCounts(emptyCounts);
      setStartupGuide(null);
      setStoredStartupItems([]);
      return;
    }

    const loadSetupState = async () => {
      setLoading(true);
      setError("");

      try {
        const companyId = recentlySelectedCompany;
        const [
          companySnap,
          emailConfigSnap,
          guideSnap,
          guideItemsSnap,
          companyUsers,
          customers,
          serviceLocations,
          bodiesOfWater,
          equipment,
          taskGroups,
          jobTemplates,
          recurringServiceStops,
          routes,
          serviceStops,
          jobs,
          termsTemplates,
          catalogItems,
          agreements,
          billingProfiles,
          billingSubscriptionCounts,
          invoices,
          payments,
          customerMigrationRows,
        ] = await Promise.all([
          safeGetDoc(doc(db, "companies", companyId), "company"),
          safeGetDoc(doc(db, "companies", companyId, "settings", "emailConfiguration"), "email configuration"),
          safeGetDoc(startupGuideDocRef(companyId), "startup guide"),
          safeGetDocs(query(startupGuideItemsRef(companyId), orderBy("sortOrder", "asc")), "startup guide items"),
          countSnapshot(collection(db, "companies", companyId, "companyUsers"), "company users"),
          countSnapshot(collection(db, "companies", companyId, "customers"), "customers"),
          countSnapshot(collection(db, "companies", companyId, "serviceLocations"), "service locations"),
          countSnapshot(collection(db, "companies", companyId, "bodiesOfWater"), "bodies of water"),
          countSnapshot(collection(db, "companies", companyId, "equipment"), "equipment"),
          countSnapshot(collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups"), "task groups"),
          countSnapshot(collection(db, "companies", companyId, "jobTemplates"), "job templates"),
          countSnapshot(collection(db, "companies", companyId, "recurringServiceStop"), "recurring service stops"),
          countSnapshot(collection(db, "companies", companyId, "routes"), "routes"),
          countSnapshot(collection(db, "companies", companyId, "serviceStops"), "service stops"),
          countSnapshot(collection(db, "companies", companyId, "workOrders"), "jobs"),
          countSnapshot(collection(db, "companies", companyId, "termsTemplates"), "terms templates"),
          countSnapshot(query(collection(db, salesCollectionNames.catalogItems), where("companyId", "==", companyId)), "sales catalog items"),
          countSnapshot(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", companyId)), "sales agreements"),
          countSnapshot(query(collection(db, salesCollectionNames.billingProfiles), where("companyId", "==", companyId)), "billing profiles"),
          getBillingSubscriptionCounts(companyId),
          countSnapshot(query(collection(db, salesCollectionNames.invoices), where("companyId", "==", companyId)), "sales invoices"),
          countSnapshot(query(collection(db, salesCollectionNames.payments), where("companyId", "==", companyId)), "sales payments"),
          countSnapshot(collection(db, "companies", companyId, "customerMigrationTracker"), "customer migration tracker"),
        ]);

        setCompany(companySnap?.exists?.() ? { id: companySnap.id, ...companySnap.data() } : null);
        setEmailConfig(emailConfigSnap?.exists?.() ? { id: emailConfigSnap.id, ...emailConfigSnap.data() } : null);
        setStartupGuide(guideSnap?.exists?.() ? { id: guideSnap.id, ...guideSnap.data() } : null);
        setStoredStartupItems(
          guideItemsSnap.docs.map((itemDoc, index) => normalizeStoredStartupItem({ id: itemDoc.id, ...itemDoc.data() }, index * 10))
        );
        setCounts({
          companyUsers,
          customers,
          serviceLocations,
          bodiesOfWater,
          equipment,
          taskGroups,
          jobTemplates,
          recurringServiceStops,
          routes,
          serviceStops,
          jobs,
          termsTemplates,
          catalogItems,
          agreements,
          billingProfiles,
          billingSubscriptions: billingSubscriptionCounts.billingSubscriptions,
          activeBillingSubscriptions: billingSubscriptionCounts.activeBillingSubscriptions,
          invoices,
          payments,
          customerMigrationRows,
        });
      } catch (err) {
        console.error("Unable to load company setup guide:", err);
        setError("Unable to load the setup guide right now.");
      } finally {
        setLoading(false);
      }
    };

    loadSetupState();
  }, [recentlySelectedCompany]);

  const setupSections = useMemo(() => {
    const companyName = getString(company?.companyName, company?.name, recentlySelectedCompanyName);
    const companyContact = getString(company?.email, company?.phoneNumber, company?.phone, company?.streetAddress, company?.address?.streetAddress);
    const connectedAccountId = getString(stripeConnectedAccountId, company?.stripeConnectedAccountId, company?.stripeAccountId, company?.stripeConnectedAccount?.id);
    const hasStripeAccount = !!connectedAccountId;
    const emailReady = !!emailConfig && emailConfig.emailIsOn !== false;

    return [
      {
        id: "foundation",
        title: "Foundation",
        helper: "Make sure the company record and team basics are ready.",
        icon: FaClipboardList,
        items: [
          {
            id: "company_profile",
            sectionId: "foundation",
            sectionTitle: "Foundation",
            sortOrder: 10,
            title: "Company profile",
            description: "Add the company name and contact details customers will recognize on work, agreements, and billing.",
            completed: !!companyName && !!companyContact,
            metric: companyName ? "Profile started" : "Missing company info",
            to: "/Company/CompanyInfo",
            actionLabel: "Company info",
          },
          {
            id: "team_users",
            sectionId: "foundation",
            sectionTitle: "Foundation",
            sortOrder: 20,
            title: "Team users",
            description: "Invite or create the people who will schedule, service, bill, and manage customers.",
            completed: counts.companyUsers > 0,
            metric: `${counts.companyUsers} users`,
            to: "/company/companyUsers",
            actionLabel: "Manage users",
          },
          {
            id: "email_configuration",
            sectionId: "foundation",
            sectionTitle: "Foundation",
            sortOrder: 30,
            title: "Email configuration",
            description: "Set the company email behavior used for service agreements, invoices, and customer communication.",
            completed: emailReady,
            metric: emailReady ? "Email config found" : "Review email setup",
            to: "/Company/EmailConfiguration",
            actionLabel: "Email setup",
          },
        ],
      },
      {
        id: "customer_setup",
        title: "Customer Setup",
        helper: "Build the customer record before service and billing begin.",
        icon: FaUsers,
        items: [
          {
            id: "customers",
            sectionId: "customer_setup",
            sectionTitle: "Customer Setup",
            sortOrder: 110,
            title: "Customers",
            description: "Create the homeowner or property customer who will receive service and billing.",
            completed: counts.customers > 0,
            metric: `${counts.customers} customers`,
            to: "/company/customers",
            actionLabel: "Customers",
          },
          {
            id: "customer_migration_tracker",
            sectionId: "customer_setup",
            sectionTitle: "Customer Setup",
            sortOrder: 115,
            title: "Customer migration tracker",
            description: "Check each customer through site info, routing, billing, and custom transition signoffs so nobody is missed.",
            completed: counts.customerMigrationRows > 0,
            metric: `${counts.customerMigrationRows} tracked customers`,
            to: "/company/migration",
            actionLabel: "Tracker",
          },
          {
            id: "service_locations",
            sectionId: "customer_setup",
            sectionTitle: "Customer Setup",
            sortOrder: 120,
            title: "Service locations",
            description: "Attach the address where service happens so routing, stops, and agreements can line up.",
            completed: counts.serviceLocations > 0,
            metric: `${counts.serviceLocations} locations`,
            to: "/company/serviceLocations",
            actionLabel: "Locations",
          },
          {
            id: "bodies_of_water",
            sectionId: "customer_setup",
            sectionTitle: "Customer Setup",
            sortOrder: 130,
            title: "Bodies of water",
            description: "Add pools, spas, or other serviced water bodies so service history is tied to the right place.",
            completed: counts.bodiesOfWater > 0,
            metric: `${counts.bodiesOfWater} bodies`,
            to: "/company/bodiesOfWater",
            actionLabel: "Pools",
          },
          {
            id: "equipment",
            sectionId: "customer_setup",
            sectionTitle: "Customer Setup",
            sortOrder: 140,
            title: "Equipment",
            description: "Track pumps, filters, heaters, and other equipment that affect service and repairs.",
            completed: counts.equipment > 0,
            metric: `${counts.equipment} equipment`,
            to: "/company/equipment",
            actionLabel: "Equipment",
          },
        ],
      },
      {
        id: "service_routing",
        title: "Service and Routing",
        helper: "Turn customer records into repeatable work and daily routes.",
        icon: FaRoute,
        items: [
          {
            id: "task_groups",
            sectionId: "service_routing",
            sectionTitle: "Service and Routing",
            sortOrder: 210,
            title: "Task groups",
            description: "Create reusable service task lists so recurring stops and jobs stay consistent.",
            completed: counts.taskGroups > 0,
            metric: `${counts.taskGroups} task groups`,
            to: "/company/taskGroups",
            actionLabel: "Task groups",
          },
          {
            id: "job_templates",
            sectionId: "service_routing",
            sectionTitle: "Service and Routing",
            sortOrder: 220,
            title: "Job templates",
            description: "Prepare reusable job templates for repairs, install work, and common one-off jobs.",
            completed: counts.jobTemplates > 0,
            metric: `${counts.jobTemplates} templates`,
            to: "/company/settings/job-templates",
            actionLabel: "Job templates",
          },
          {
            id: "recurring_service_stops",
            sectionId: "service_routing",
            sectionTitle: "Service and Routing",
            sortOrder: 230,
            title: "Recurring service stops",
            description: "Create the weekly, twice-weekly, or commercial service schedules that drive route work.",
            completed: counts.recurringServiceStops > 0,
            metric: `${counts.recurringServiceStops} recurring stops`,
            to: "/company/recurringServiceStop",
            actionLabel: "Recurring stops",
          },
          {
            id: "routes",
            sectionId: "service_routing",
            sectionTitle: "Service and Routing",
            sortOrder: 240,
            title: "Routes",
            description: "Put recurring stops into route order so technicians know what to do next.",
            completed: counts.routes > 0 || counts.serviceStops > 0,
            metric: `${counts.routes} routes`,
            to: "/company/route-builder",
            actionLabel: "Route builder",
          },
        ],
      },
      {
        id: "sales_billing",
        title: "Sales and Billing",
        helper: "Connect terms, catalog items, service agreements, subscriptions, invoices, and payments.",
        icon: FaFileInvoiceDollar,
        items: [
          {
            id: "terms_templates",
            sectionId: "sales_billing",
            sectionTitle: "Sales and Billing",
            sortOrder: 310,
            title: "Terms templates",
            description: "Create company-specific agreement terms, such as weekly residential or commercial service terms.",
            completed: counts.termsTemplates > 0,
            metric: `${counts.termsTemplates} templates`,
            to: "/company/settings/terms-templates",
            actionLabel: "Terms",
          },
          {
            id: "sales_catalog_items",
            sectionId: "sales_billing",
            sectionTitle: "Sales and Billing",
            sortOrder: 320,
            title: "Sales catalog items",
            description: "Build reusable service, labor, material, fee, and recurring billing items before agreements and invoices.",
            completed: counts.catalogItems > 0,
            metric: `${counts.catalogItems} catalog items`,
            to: "/company/sales/catalog-items",
            actionLabel: "Catalog",
          },
          {
            id: "stripe_billing_readiness",
            sectionId: "sales_billing",
            sectionTitle: "Sales and Billing",
            sortOrder: 330,
            title: "Stripe billing readiness",
            description: "Connect and verify the company Stripe account before collecting online payments.",
            completed: hasStripeAccount,
            metric: hasStripeAccount ? "Connected account found" : "Stripe setup needed",
            to: "/company/sales/subscriptions",
            actionLabel: "Billing",
          },
          {
            id: "service_agreements",
            sectionId: "sales_billing",
            sectionTitle: "Sales and Billing",
            sortOrder: 340,
            title: "Service agreements",
            description: "Send agreements that can turn accepted service into billing subscriptions and recurring service work.",
            completed: counts.agreements > 0,
            metric: `${counts.agreements} agreements`,
            to: "/company/sales/agreements",
            actionLabel: "Agreements",
          },
          {
            id: "invoices_payments",
            sectionId: "sales_billing",
            sectionTitle: "Sales and Billing",
            sortOrder: 350,
            title: "Invoices and payments",
            description: "Track invoice totals, money received, app payments, and cash or check payments.",
            completed: counts.invoices > 0 || counts.payments > 0,
            metric: `${counts.invoices} invoices / ${counts.payments} payments`,
            to: "/company/sales/invoices",
            actionLabel: "Invoices",
          },
        ],
      },
    ];
  }, [company, counts, emailConfig, recentlySelectedCompanyName, stripeConnectedAccountId]);

  const templateItems = useMemo(() => setupSections.flatMap((section) => section.items), [setupSections]);
  const storedItemsById = useMemo(() => {
    const map = new Map();
    storedStartupItems.forEach((item) => {
      if (item.id) map.set(item.id, item);
    });
    return map;
  }, [storedStartupItems]);

  const hydratedSections = useMemo(() => (
    setupSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const storedItem = storedItemsById.get(item.id);
        const complete = storedItem?.status === STARTUP_ITEM_STATUS.complete || item.completed;
        return {
          ...item,
          status: complete ? STARTUP_ITEM_STATUS.complete : STARTUP_ITEM_STATUS.open,
          completed: complete,
          completedAt: storedItem?.completedAt || null,
          completedByName: storedItem?.completedByName || "",
        };
      }),
    }))
  ), [setupSections, storedItemsById]);

  const allItems = hydratedSections.flatMap((section) => section.items);
  const completedCount = allItems.filter((item) => item.completed).length;
  const progress = allItems.length ? Math.round((completedCount / allItems.length) * 100) : 0;
  const guideSkipped = startupGuide?.status === STARTUP_GUIDE_STATUS.skipped;
  const guideComplete = !guideSkipped && allItems.length > 0 && completedCount === allItems.length;
  const nextItem = guideSkipped ? null : allItems.find((item) => !item.completed);
  const guideStatusLabel = guideSkipped ? "Skipped" : guideComplete ? "Complete" : "Active";
  const guideStatusClass = guideSkipped
    ? "bg-slate-100 text-slate-600 ring-slate-200"
    : guideComplete
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-blue-50 text-blue-700 ring-blue-200";
  const setupStripeConnectedAccountId = getString(
    stripeConnectedAccountId,
    company?.stripeConnectedAccountId,
    company?.stripeAccountId,
    company?.stripeConnectedAccount?.id
  );

  useEffect(() => {
    if (!recentlySelectedCompany || loading || guideSyncInFlight.current || templateItems.length === 0) return;
    if (startupGuide?.status === STARTUP_GUIDE_STATUS.skipped) return;

    let cancelled = false;

    const syncStartupGuide = async () => {
      guideSyncInFlight.current = true;
      setGuideSyncing(true);
      try {
        const batch = writeBatch(db);
        const itemRef = startupGuideItemsRef(recentlySelectedCompany);
        const localNow = Timestamp.fromDate(new Date());
        const nextItemsById = new Map(storedItemsById);
        let writeCount = 0;

        templateItems.forEach((item) => {
          const storedItem = nextItemsById.get(item.id);
          const itemDocRef = doc(itemRef, item.id);
          const basePayload = buildStartupItemPayload(item);
          const shouldComplete = item.completed && storedItem?.status !== STARTUP_ITEM_STATUS.complete;

          if (!storedItem) {
            const payload = {
              ...basePayload,
              status: item.completed ? STARTUP_ITEM_STATUS.complete : STARTUP_ITEM_STATUS.open,
              completedAt: item.completed ? serverTimestamp() : null,
              completedByUserId: item.completed ? "system" : "",
              completedByName: item.completed ? "Startup Guide" : "",
              completionReason: item.completed ? "live_data_match" : "",
              companyId: recentlySelectedCompany,
              createdAt: serverTimestamp(),
            };
            batch.set(itemDocRef, payload, { merge: true });
            nextItemsById.set(item.id, normalizeStoredStartupItem({
              ...payload,
              completedAt: item.completed ? localNow : null,
              lastEvidence: { satisfied: !!item.completed, metric: item.metric, checkedAt: localNow },
            }));
            writeCount += 1;
          } else if (shouldComplete) {
            const payload = {
              ...basePayload,
              status: STARTUP_ITEM_STATUS.complete,
              completedAt: serverTimestamp(),
              completedByUserId: "system",
              completedByName: "Startup Guide",
              completionReason: "live_data_match",
            };
            batch.set(itemDocRef, payload, { merge: true });
            nextItemsById.set(item.id, normalizeStoredStartupItem({
              ...storedItem,
              ...payload,
              completedAt: localNow,
              lastEvidence: { satisfied: true, metric: item.metric, checkedAt: localNow },
            }));
            writeCount += 1;
          }
        });

        const syncedItems = templateItems.map((item) => nextItemsById.get(item.id)).filter(Boolean);
        const syncedCompletedCount = syncedItems.filter((item) => item.status === STARTUP_ITEM_STATUS.complete).length;
        const nextGuideStatus = syncedItems.length > 0 && syncedCompletedCount === syncedItems.length
          ? STARTUP_GUIDE_STATUS.complete
          : STARTUP_GUIDE_STATUS.active;
        const guidePayload = {
          id: "startupGuide",
          companyId: recentlySelectedCompany,
          status: nextGuideStatus,
          templateVersion: STARTUP_GUIDE_TEMPLATE_VERSION,
          totalItems: templateItems.length,
          completedItems: syncedCompletedCount,
          progress,
          updatedAt: serverTimestamp(),
          ...(startupGuide ? {} : { createdAt: serverTimestamp() }),
        };

        if (
          !startupGuide ||
          startupGuide.status !== guidePayload.status ||
          Number(startupGuide.totalItems || 0) !== guidePayload.totalItems ||
          Number(startupGuide.completedItems || 0) !== guidePayload.completedItems
        ) {
          batch.set(startupGuideDocRef(recentlySelectedCompany), guidePayload, { merge: true });
          writeCount += 1;
        }

        if (writeCount > 0) {
          await batch.commit();
          if (cancelled) return;

          setStoredStartupItems([...nextItemsById.values()].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)));
          setStartupGuide((current) => ({
            ...(current || {}),
            ...guidePayload,
            updatedAt: localNow,
            createdAt: current?.createdAt || localNow,
          }));
        }
      } catch (err) {
        console.error("Unable to sync startup guide:", err);
        if (!cancelled) toast.error("Could not save startup guide progress.");
      } finally {
        guideSyncInFlight.current = false;
        if (!cancelled) setGuideSyncing(false);
      }
    };

    syncStartupGuide();

    return () => {
      cancelled = true;
    };
  }, [loading, progress, recentlySelectedCompany, startupGuide, storedItemsById, templateItems]);

  const handleSkipGuide = async () => {
    if (!requirePermission("800", "skip the startup guide")) return;
    if (!recentlySelectedCompany) return;
    if (!window.confirm("Skip the startup guide for this company? You can restart it from this page later.")) return;

    setGuideSaving(true);
    const localNow = Timestamp.fromDate(new Date());
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);

    try {
      const payload = {
        id: "startupGuide",
        companyId: recentlySelectedCompany,
        status: STARTUP_GUIDE_STATUS.skipped,
        skippedAt: serverTimestamp(),
        skippedByUserId: actorId,
        skippedByName: actorName,
        templateVersion: STARTUP_GUIDE_TEMPLATE_VERSION,
        totalItems: templateItems.length,
        completedItems: completedCount,
        progress,
        updatedAt: serverTimestamp(),
        ...(startupGuide ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(startupGuideDocRef(recentlySelectedCompany), payload, { merge: true });
      setStartupGuide((current) => ({
        ...(current || {}),
        ...payload,
        skippedAt: localNow,
        updatedAt: localNow,
        createdAt: current?.createdAt || localNow,
      }));
      toast.success("Startup guide skipped.");
    } catch (err) {
      console.error("Unable to skip startup guide:", err);
      toast.error("Could not skip the startup guide.");
    } finally {
      setGuideSaving(false);
    }
  };

  const handleRestartGuide = async () => {
    if (!requirePermission("800", "restart the startup guide")) return;
    if (!recentlySelectedCompany) return;
    if (!window.confirm("Restart the startup guide and clear saved checklist progress? Completed steps may be marked done again when the app sees the required data.")) return;

    setGuideSaving(true);
    const localNow = Timestamp.fromDate(new Date());
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);

    try {
      const batch = writeBatch(db);
      const itemRef = startupGuideItemsRef(recentlySelectedCompany);
      const nextStoredItems = templateItems.map((item) => normalizeStoredStartupItem({
        ...buildStartupItemPayload(item),
        id: item.id,
        status: STARTUP_ITEM_STATUS.open,
        completedAt: null,
        completedByUserId: "",
        completedByName: "",
        lastEvidence: { satisfied: !!item.completed, metric: item.metric, checkedAt: localNow },
      }));

      templateItems.forEach((item) => {
        batch.set(doc(itemRef, item.id), {
          ...buildStartupItemPayload(item),
          status: STARTUP_ITEM_STATUS.open,
          completedAt: null,
          completedByUserId: "",
          completedByName: "",
          completionReason: "",
          companyId: recentlySelectedCompany,
          restartCount: Number(startupGuide?.restartCount || 0) + 1,
          restartedAt: serverTimestamp(),
          restartedByUserId: actorId,
          restartedByName: actorName,
        }, { merge: true });
      });

      const guidePayload = {
        id: "startupGuide",
        companyId: recentlySelectedCompany,
        status: STARTUP_GUIDE_STATUS.active,
        templateVersion: STARTUP_GUIDE_TEMPLATE_VERSION,
        totalItems: templateItems.length,
        completedItems: 0,
        progress: 0,
        skippedAt: null,
        skippedByUserId: "",
        skippedByName: "",
        restartCount: Number(startupGuide?.restartCount || 0) + 1,
        restartedAt: serverTimestamp(),
        restartedByUserId: actorId,
        restartedByName: actorName,
        updatedAt: serverTimestamp(),
        ...(startupGuide ? {} : { createdAt: serverTimestamp() }),
      };

      batch.set(startupGuideDocRef(recentlySelectedCompany), guidePayload, { merge: true });
      await batch.commit();

      setStoredStartupItems(nextStoredItems);
      setStartupGuide((current) => ({
        ...(current || {}),
        ...guidePayload,
        restartedAt: localNow,
        updatedAt: localNow,
        createdAt: current?.createdAt || localNow,
      }));
      toast.success("Startup guide restarted.");
    } catch (err) {
      console.error("Unable to restart startup guide:", err);
      toast.error("Could not restart the startup guide.");
    } finally {
      setGuideSaving(false);
    }
  };

  if (!recentlySelectedCompany) {
    return (
      <div className="min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Select a company to view the setup guide.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
      <div className="mb-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Company Startup Guide</p>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${guideStatusClass}`}>
                {guideStatusLabel}
              </span>
              {guideSyncing ? (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                  Saving progress
                </span>
              ) : null}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{recentlySelectedCompanyName || company?.name || "Startup Guide"}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Work through the app from company basics to customers, service, routing, agreements, subscriptions, invoices, and payments.
            </p>
          </div>

          <div className="min-w-[280px] space-y-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Startup progress</span>
                <span className="text-sm font-semibold text-slate-950">{completedCount}/{allItems.length}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-500">{progress}% complete</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {!guideSkipped ? (
                <button
                  type="button"
                  onClick={handleSkipGuide}
                  disabled={guideSaving || guideSyncing || loading}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaFastForward className="h-3.5 w-3.5" />
                  Skip Guide
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleRestartGuide}
                disabled={guideSaving || guideSyncing || loading}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  guideSkipped
                    ? "bg-slate-950 text-white hover:bg-slate-800"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <FaRedoAlt className="h-3.5 w-3.5" />
                Restart Guide
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {guideSkipped ? (
        <div className="mb-5 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          <p className="font-semibold text-slate-900">Startup guide skipped</p>
          <p className="mt-1">The checklist is paused for this company. Restart it when you want to walk through setup again.</p>
        </div>
      ) : guideComplete && !loading ? (
        <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-semibold">Startup guide complete</p>
          <p className="mt-1">Core company setup is ready based on the records currently in the app.</p>
        </div>
      ) : null}

      {nextItem && !loading ? (
        <div className="mb-5 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Next recommended step</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{nextItem.title}</p>
            <p className="mt-1 text-xs text-slate-600">{nextItem.description}</p>
          </div>
          <Link
            to={nextItem.to}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {nextItem.actionLabel}
            <FaArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Loading setup guide...</div>
      ) : (
        <div className="space-y-5">
          {hydratedSections.map((section) => {
            const sectionComplete = section.items.filter((item) => item.completed).length;
            const showBillingReadiness = section.title === "Sales and Billing";

            return (
              <section key={section.title} className="space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <SectionIcon icon={section.icon} />
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{section.title}</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{section.helper}</p>
                    </div>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                    {sectionComplete}/{section.items.length}
                  </span>
                </div>

                {showBillingReadiness ? (
                  <BillingReadinessCard
                    activeSubscriptionCount={counts.activeBillingSubscriptions}
                    billingProfileCount={counts.billingProfiles}
                    companyId={recentlySelectedCompany}
                    connectedAccountId={setupStripeConnectedAccountId}
                  />
                ) : null}

                <div className="space-y-3">
                  {section.items.map((item) => (
                    <SetupItem key={`${section.title}-${item.title}`} item={item} guideSkipped={guideSkipped} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link to="/company/operations-dashboard" className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
          <span className="inline-flex items-center gap-2"><FaMapMarkedAlt /> Operations dashboard</span>
          <FaArrowRight className="h-3 w-3" />
        </Link>
        <Link to="/company/sales" className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
          <span className="inline-flex items-center gap-2"><MdOutlineLocalOffer /> Sales dashboard</span>
          <FaArrowRight className="h-3 w-3" />
        </Link>
        <Link to="/Company/EmailConfiguration" className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
          <span className="inline-flex items-center gap-2"><MdEmail /> Email setup</span>
          <FaArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};

export default CompanySetupGuide;
