import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import {
  FaArrowRight,
  FaCheckCircle,
  FaClipboardList,
  FaFileInvoiceDollar,
  FaMapMarkedAlt,
  FaRegCircle,
  FaRoute,
  FaUsers,
} from "react-icons/fa";
import { MdEmail, MdOutlineLocalOffer } from "react-icons/md";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { salesCollectionNames } from "../../../utils/models/Sales";

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
  billingSubscriptions: 0,
  invoices: 0,
  payments: 0,
};

const countSnapshot = async (ref) => {
  const snapshot = await getDocs(ref);
  return snapshot.size;
};

const getString = (...values) => values.find((value) => typeof value === "string" && value.trim()) || "";

const SectionIcon = ({ icon: Icon }) => (
  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white">
    <Icon className="h-4 w-4" />
  </span>
);

const SetupItem = ({ item }) => {
  const complete = !!item.completed;

  return (
    <div className="flex min-h-[116px] flex-col justify-between rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={complete ? "mt-0.5 text-emerald-600" : "mt-0.5 text-slate-300"}>
          {complete ? <FaCheckCircle className="h-5 w-5" /> : <FaRegCircle className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
            <span className={complete ? "rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700" : "rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"}>
              {complete ? "Done" : "Needs setup"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
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
  );
};

const CompanySetupGuide = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [company, setCompany] = useState(null);
  const [emailConfig, setEmailConfig] = useState(null);
  const [counts, setCounts] = useState(emptyCounts);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLoading(false);
      setCompany(null);
      setEmailConfig(null);
      setCounts(emptyCounts);
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
          billingSubscriptions,
          invoices,
          payments,
        ] = await Promise.all([
          getDoc(doc(db, "companies", companyId)),
          getDoc(doc(db, "companies", companyId, "settings", "emailConfiguration")),
          countSnapshot(collection(db, "companies", companyId, "companyUsers")),
          countSnapshot(collection(db, "companies", companyId, "customers")),
          countSnapshot(collection(db, "companies", companyId, "serviceLocations")),
          countSnapshot(collection(db, "companies", companyId, "bodiesOfWater")),
          countSnapshot(collection(db, "companies", companyId, "equipment")),
          countSnapshot(collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups")),
          countSnapshot(collection(db, "companies", companyId, "jobTemplates")),
          countSnapshot(collection(db, "companies", companyId, "recurringServiceStop")),
          countSnapshot(collection(db, "companies", companyId, "routes")),
          countSnapshot(collection(db, "companies", companyId, "serviceStops")),
          countSnapshot(collection(db, "companies", companyId, "workOrders")),
          countSnapshot(collection(db, "companies", companyId, "termsTemplates")),
          countSnapshot(query(collection(db, salesCollectionNames.catalogItems), where("companyId", "==", companyId))),
          countSnapshot(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", companyId))),
          countSnapshot(query(collection(db, salesCollectionNames.billingSubscriptions), where("companyId", "==", companyId))),
          countSnapshot(query(collection(db, salesCollectionNames.invoices), where("companyId", "==", companyId))),
          countSnapshot(query(collection(db, salesCollectionNames.payments), where("companyId", "==", companyId))),
        ]);

        setCompany(companySnap.exists() ? { id: companySnap.id, ...companySnap.data() } : null);
        setEmailConfig(emailConfigSnap.exists() ? { id: emailConfigSnap.id, ...emailConfigSnap.data() } : null);
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
          billingSubscriptions,
          invoices,
          payments,
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
    const hasStripeAccount = !!getString(company?.stripeConnectedAccountId, company?.stripeAccountId, company?.stripeConnectedAccount?.id);
    const emailReady = !!emailConfig && emailConfig.emailIsOn !== false;

    return [
      {
        title: "Foundation",
        helper: "Make sure the company record and team basics are ready.",
        icon: FaClipboardList,
        items: [
          {
            title: "Company profile",
            description: "Add the company name and contact details customers will recognize on work, agreements, and billing.",
            completed: !!companyName && !!companyContact,
            metric: companyName ? "Profile started" : "Missing company info",
            to: "/Company/CompanyInfo",
            actionLabel: "Company info",
          },
          {
            title: "Team users",
            description: "Invite or create the people who will schedule, service, bill, and manage customers.",
            completed: counts.companyUsers > 0,
            metric: `${counts.companyUsers} users`,
            to: "/company/companyUsers",
            actionLabel: "Manage users",
          },
          {
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
        title: "Customer Setup",
        helper: "Build the customer record before service and billing begin.",
        icon: FaUsers,
        items: [
          {
            title: "Customers",
            description: "Create the homeowner or property customer who will receive service and billing.",
            completed: counts.customers > 0,
            metric: `${counts.customers} customers`,
            to: "/company/customers",
            actionLabel: "Customers",
          },
          {
            title: "Service locations",
            description: "Attach the address where service happens so routing, stops, and agreements can line up.",
            completed: counts.serviceLocations > 0,
            metric: `${counts.serviceLocations} locations`,
            to: "/company/serviceLocations",
            actionLabel: "Locations",
          },
          {
            title: "Bodies of water",
            description: "Add pools, spas, or other serviced water bodies so service history is tied to the right place.",
            completed: counts.bodiesOfWater > 0,
            metric: `${counts.bodiesOfWater} bodies`,
            to: "/company/bodiesOfWater",
            actionLabel: "Pools",
          },
          {
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
        title: "Service And Routing",
        helper: "Turn customer records into repeatable work and daily routes.",
        icon: FaRoute,
        items: [
          {
            title: "Task groups",
            description: "Create reusable service task lists so recurring stops and jobs stay consistent.",
            completed: counts.taskGroups > 0,
            metric: `${counts.taskGroups} task groups`,
            to: "/company/taskGroups",
            actionLabel: "Task groups",
          },
          {
            title: "Job templates",
            description: "Prepare reusable job templates for repairs, install work, and common one-off jobs.",
            completed: counts.jobTemplates > 0,
            metric: `${counts.jobTemplates} templates`,
            to: "/company/settings/job-templates",
            actionLabel: "Job templates",
          },
          {
            title: "Recurring service stops",
            description: "Create the weekly, twice-weekly, or commercial service schedules that drive route work.",
            completed: counts.recurringServiceStops > 0,
            metric: `${counts.recurringServiceStops} recurring stops`,
            to: "/company/recurringServiceStop",
            actionLabel: "Recurring stops",
          },
          {
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
        title: "Sales And Billing",
        helper: "Connect terms, catalog items, service agreements, subscriptions, invoices, and payments.",
        icon: FaFileInvoiceDollar,
        items: [
          {
            title: "Terms templates",
            description: "Create company-specific agreement terms, such as weekly residential or commercial service terms.",
            completed: counts.termsTemplates > 0,
            metric: `${counts.termsTemplates} templates`,
            to: "/company/settings/terms-templates",
            actionLabel: "Terms",
          },
          {
            title: "Sales catalog items",
            description: "Build reusable service, labor, material, fee, and recurring billing items before agreements and invoices.",
            completed: counts.catalogItems > 0,
            metric: `${counts.catalogItems} catalog items`,
            to: "/company/sales/catalog-items",
            actionLabel: "Catalog",
          },
          {
            title: "Stripe billing readiness",
            description: "Connect and verify the company Stripe account before collecting online payments.",
            completed: hasStripeAccount,
            metric: hasStripeAccount ? "Connected account found" : "Stripe setup needed",
            to: "/company/sales/subscriptions",
            actionLabel: "Billing",
          },
          {
            title: "Service agreements",
            description: "Send agreements that can turn accepted service into billing subscriptions and recurring service work.",
            completed: counts.agreements > 0,
            metric: `${counts.agreements} agreements`,
            to: "/company/sales/agreements",
            actionLabel: "Agreements",
          },
          {
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
  }, [company, counts, emailConfig, recentlySelectedCompanyName]);

  const allItems = setupSections.flatMap((section) => section.items);
  const completedCount = allItems.filter((item) => item.completed).length;
  const progress = allItems.length ? Math.round((completedCount / allItems.length) * 100) : 0;
  const nextItem = allItems.find((item) => !item.completed);

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
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Company Setup Guide</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{recentlySelectedCompanyName || company?.name || "Setup Guide"}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Work through the app from company basics to customers, service, routing, agreements, subscriptions, invoices, and payments.
            </p>
          </div>

          <div className="min-w-[260px] rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Setup progress</span>
              <span className="text-sm font-semibold text-slate-950">{completedCount}/{allItems.length}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{progress}% complete</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
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
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {setupSections.map((section) => {
            const sectionComplete = section.items.filter((item) => item.completed).length;
            return (
              <section key={section.title} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {section.items.map((item) => (
                    <SetupItem key={`${section.title}-${item.title}`} item={item} />
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
