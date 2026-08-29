import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArchiveBoxIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  BeakerIcon,
  BriefcaseIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import { collection, doc, getCountFromServer, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  COMPANY_WIDE_SETTINGS_DOC_ID,
  DEFAULT_COMPANY_WORK_SETTINGS,
  PAYROLL_ENABLED_FIELD,
  isPayrollEnabled,
  normalizeCompanyWorkSettings,
} from "../../../utils/companyWorkSettings";
import {
  CUSTOMER_BILLING_ENABLED_FIELD,
  SALES_BILLING_AUTOMATION_FIELD,
  SALES_CREATE_BILLING_SUBSCRIPTION_ON_ACCEPTANCE_FIELD,
  isCustomerBillingEnabled,
  isShoppingItemInstallInvoiceAutomationEnabled,
  shouldCreateBillingSubscriptionOnAgreementAcceptance,
} from "../../../utils/sales/billingSettings";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const settingsRef = (companyId) =>
  doc(db, "companies", companyId, "settings", COMPANY_WIDE_SETTINGS_DOC_ID);

const emptyOverview = {
  company: null,
  emailConfiguration: null,
  paySettings: null,
  testerStripSettings: null,
  counters: {
    recurringServiceStops: null,
    workOrders: null,
  },
  counts: {
    taskGroups: null,
    jobTemplates: null,
    termsTemplates: null,
    readingTemplates: null,
    dosageTemplates: null,
    productCatalog: null,
    vendorItems: null,
    onboardingChecklist: null,
    pipelineStages: null,
    leadSources: null,
    textTemplates: null,
  },
};

const companyDocRef = (companyId) => doc(db, "companies", companyId);
const emailConfigurationRef = (companyId) => doc(db, "companies", companyId, "settings", "emailConfiguration");
const paySettingsRef = (companyId) => doc(db, "companies", companyId, "paySettings", "main");
const testerStripSettingsRef = (companyId) => doc(db, "companies", companyId, "settings", "testerStripProfiles");
const workOrderCounterRef = (companyId) => doc(db, "companies", companyId, "settings", "workOrders");
const recurringStopCounterRef = (companyId) => doc(db, "companies", companyId, "settings", "recurringServiceStops");

const collectionRefs = (companyId) => ({
  taskGroups: collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups"),
  jobTemplates: collection(db, "companies", companyId, "jobTemplates"),
  termsTemplates: collection(db, "companies", companyId, "termsTemplates"),
  readingTemplates: collection(db, "companies", companyId, "settings", "readings", "readings"),
  dosageTemplates: collection(db, "companies", companyId, "settings", "dosages", "dosages"),
  productCatalog: collection(db, "companies", companyId, "settings", "genericItems", "genericItems"),
  vendorItems: collection(db, "companies", companyId, "settings", "dataBase", "dataBase"),
  onboardingChecklist: collection(db, "companies", companyId, "settings", "onboardingChecklist", "items"),
  pipelineStages: collection(db, "companies", companyId, "settings", "customerPipeline", "items"),
  leadSources: collection(db, "companies", companyId, "settings", "customerPipeline", "leadSources"),
  textTemplates: collection(db, "companies", companyId, "settings", "textTemplates", "templates"),
});

const safeGetDocData = async (ref, label) => {
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.error(`Failed to load ${label}:`, error);
    return null;
  }
};

const safeGetCollectionCount = async (ref, label) => {
  try {
    const snap = await getCountFromServer(ref);
    return Number(snap.data().count || 0);
  } catch (error) {
    console.error(`Failed to count ${label}:`, error);
    return null;
  }
};

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value) => {
  const date = dateFromValue(value);
  if (!date) return "Not saved";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const labelize = (value) => {
  if (!value) return "Not set";

  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatCount = (value, singular, plural = `${singular}s`) => {
  if (value === null || value === undefined) return "Unavailable";
  return `${value} ${Number(value) === 1 ? singular : plural}`;
};

const formatNextNumber = (value, prefix) => {
  if (value === null || value === undefined) return "Unavailable";
  return `${prefix}${Number(value || 0) + 1}`;
};

const normalizeStripeAccountId = (value) => {
  const id = typeof value === "string" ? value.trim() : "";
  return id.startsWith("acct_") ? id : "";
};

const getCompanyConnectedAccountId = (companyData = {}) => (
  normalizeStripeAccountId(companyData.stripeConnectedAccountId) ||
  normalizeStripeAccountId(companyData.stripeConnectAccountId)
);

const onOffLabel = (enabled) => (enabled ? "On" : "Off");

const settingSections = [
  {
    title: "Offered Work",
    icon: BriefcaseIcon,
    items: [
      {
        key: "workOffersGoLiveByDefault",
        label: "Offers go live by default",
        helper: "Technician and management offers post without a review step.",
      },
      {
        key: "workOffersRequireApprovalBeforePosting",
        label: "Require approval before posting",
        helper: "New offers stay pending until management approves them.",
      },
      {
        key: "workOffersAutoAssignOnAcceptance",
        label: "Auto-assign accepted work",
        helper: "Accepted offers are assigned to the claiming technician immediately.",
      },
      {
        key: "workOffersRequireApprovalBeforeAssignment",
        label: "Require approval before assignment",
        helper: "Accepted offers wait for management approval before assignment.",
      },
    ],
  },
  {
    title: "Route Coverage",
    icon: MapIcon,
    items: [
      {
        key: "technicianCanOfferFullRoutes",
        label: "Technicians can offer full routes",
        helper: "Route owners can post the whole day route for coverage.",
      },
      {
        key: "technicianCanOfferPartialRoutes",
        label: "Technicians can offer partial routes",
        helper: "Route owners can post selected route stops instead of the whole route.",
      },
      {
        key: "technicianCanOfferOneOffJobs",
        label: "Technicians can offer one-off jobs",
        helper: "Technicians can offer short-term job work from their queue.",
      },
      {
        key: "technicianCanOfferRecurringWork",
        label: "Technicians can offer recurring work",
        helper: "Technicians can offer recurring or long-term coverage.",
      },
      {
        key: "managementCanOfferAnyWork",
        label: "Management can offer any work",
        helper: "Managers can post routes, route stops, recurring work, and jobs for any technician.",
      },
    ],
  },
  {
    title: "Payroll",
    icon: CurrencyDollarIcon,
    items: [
      {
        key: "payrollEnabled",
        label: "Payroll enabled",
        helper: "Allows scheduled work to estimate and generate technician payroll line items.",
      },
      {
        key: "workOfferIncentivesCreatePayrollLines",
        label: "Create payroll lines for incentives",
        helper: "Accepted offer incentives are preserved for payroll line generation.",
      },
    ],
  },
  {
    title: "Billing",
    icon: CreditCardIcon,
    items: [
      {
        key: "customerBillingEnabled",
        label: "Customer billing enabled",
        helper: "Allows recurring service agreements to create billing subscriptions and start customer payment setup.",
      },
      {
        key: "salesCreateBillingSubscriptionOnAcceptanceDefault",
        label: "Create subscription by default",
        helper: "Preselects billing subscription creation when a recurring service agreement is marked accepted.",
      },
    ],
  },
];

const dependentSettingUpdates = (key, value) => {
  if (key === "workOffersGoLiveByDefault" && value) {
    return { workOffersRequireApprovalBeforePosting: false };
  }
  if (key === "workOffersRequireApprovalBeforePosting" && value) {
    return { workOffersGoLiveByDefault: false };
  }
  if (key === "workOffersAutoAssignOnAcceptance" && value) {
    return { workOffersRequireApprovalBeforeAssignment: false };
  }
  if (key === "workOffersRequireApprovalBeforeAssignment" && value) {
    return { workOffersAutoAssignOnAcceptance: false };
  }
  if (key === "customerBillingEnabled" && !value) {
    return { salesCreateBillingSubscriptionOnAcceptanceDefault: false };
  }
  if (key === "salesCreateBillingSubscriptionOnAcceptanceDefault" && value) {
    return { customerBillingEnabled: true };
  }
  return {};
};

const CompanyWideSettings = () => {
  const {
    recentlySelectedCompany,
    setCustomerBillingEnabled,
    setPayrollEnabled,
    setSalesBillingAutomationEnabled,
    user,
  } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();
  const [settings, setSettings] = useState(DEFAULT_COMPANY_WORK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [overview, setOverview] = useState(emptyOverview);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const normalizedSettings = useMemo(() => normalizeCompanyWorkSettings(settings), [settings]);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      if (!recentlySelectedCompany) {
        setSettings(DEFAULT_COMPANY_WORK_SETTINGS);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const [snap, companySnap] = await Promise.all([
          getDoc(settingsRef(recentlySelectedCompany)),
          getDoc(companyDocRef(recentlySelectedCompany)),
        ]);
        if (cancelled) return;

        const settingsData = snap.exists() ? snap.data() : {};
        const companyData = companySnap.exists() ? companySnap.data() : {};
        const nextSettings = normalizeCompanyWorkSettings({
          ...settingsData,
          customerBillingEnabled: companySnap.exists()
            ? isCustomerBillingEnabled(companyData)
            : settingsData.customerBillingEnabled,
          salesCreateBillingSubscriptionOnAcceptanceDefault: companySnap.exists()
            ? shouldCreateBillingSubscriptionOnAgreementAcceptance(companyData)
            : settingsData.salesCreateBillingSubscriptionOnAcceptanceDefault,
          payrollEnabled: companySnap.exists()
            ? isPayrollEnabled(companyData)
            : settingsData.payrollEnabled,
        });
        setSettings(nextSettings);
        setLastSavedAt(snap.exists() ? snap.data()?.updatedAt || null : null);
      } catch (error) {
        console.error("Failed to load company-wide settings:", error);
        toast.error("Could not load company-wide settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    let cancelled = false;

    const loadOverview = async () => {
      if (!recentlySelectedCompany) {
        setOverview(emptyOverview);
        setOverviewLoading(false);
        return;
      }

      setOverviewLoading(true);

      const refs = collectionRefs(recentlySelectedCompany);
      const [
        company,
        emailConfiguration,
        paySettings,
        testerStripSettings,
        recurringCounter,
        workOrderCounter,
        taskGroups,
        jobTemplates,
        termsTemplates,
        readingTemplates,
        dosageTemplates,
        productCatalog,
        vendorItems,
        onboardingChecklist,
        pipelineStages,
        leadSources,
        textTemplates,
      ] = await Promise.all([
        safeGetDocData(companyDocRef(recentlySelectedCompany), "company profile"),
        safeGetDocData(emailConfigurationRef(recentlySelectedCompany), "email configuration"),
        safeGetDocData(paySettingsRef(recentlySelectedCompany), "payroll settings"),
        safeGetDocData(testerStripSettingsRef(recentlySelectedCompany), "tester strip settings"),
        safeGetDocData(recurringStopCounterRef(recentlySelectedCompany), "recurring service stop counter"),
        safeGetDocData(workOrderCounterRef(recentlySelectedCompany), "work order counter"),
        safeGetCollectionCount(refs.taskGroups, "task groups"),
        safeGetCollectionCount(refs.jobTemplates, "job templates"),
        safeGetCollectionCount(refs.termsTemplates, "terms templates"),
        safeGetCollectionCount(refs.readingTemplates, "reading templates"),
        safeGetCollectionCount(refs.dosageTemplates, "dosage templates"),
        safeGetCollectionCount(refs.productCatalog, "product catalog"),
        safeGetCollectionCount(refs.vendorItems, "vendor items"),
        safeGetCollectionCount(refs.onboardingChecklist, "onboarding checklist"),
        safeGetCollectionCount(refs.pipelineStages, "customer pipeline stages"),
        safeGetCollectionCount(refs.leadSources, "lead sources"),
        safeGetCollectionCount(refs.textTemplates, "text templates"),
      ]);

      if (cancelled) return;

      setOverview({
        company,
        emailConfiguration,
        paySettings,
        testerStripSettings,
        counters: {
          recurringServiceStops: recurringCounter?.increment ?? 0,
          workOrders: workOrderCounter?.increment ?? 0,
        },
        counts: {
          taskGroups,
          jobTemplates,
          termsTemplates,
          readingTemplates,
          dosageTemplates,
          productCatalog,
          vendorItems,
          onboardingChecklist,
          pipelineStages,
          leadSources,
          textTemplates,
        },
      });
      setOverviewLoading(false);
    };

    loadOverview();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  const updateSetting = (key, value) => {
    setSettings((current) => normalizeCompanyWorkSettings({
      ...current,
      [key]: value,
      ...dependentSettingUpdates(key, value),
    }));
  };

  const saveSettings = async () => {
    if (!requirePermission("900", "update company-wide settings")) return;
    if (!recentlySelectedCompany) {
      toast.error("Select a company before saving settings.");
      return;
    }

    const billingEnabled = normalizedSettings.customerBillingEnabled === true;
    const createSubscriptionOnAcceptanceDefault = billingEnabled &&
      normalizedSettings.salesCreateBillingSubscriptionOnAcceptanceDefault === true;
    const payrollEnabled = isPayrollEnabled(normalizedSettings);
    const timestamp = serverTimestamp();
    const updatedByName = user?.displayName || user?.email || "Company user";
    const payload = {
      ...normalizedSettings,
      updatedAt: timestamp,
      updatedByUserId: user?.uid || "",
      updatedByName,
    };
    const companyBillingPayload = {
      [CUSTOMER_BILLING_ENABLED_FIELD]: billingEnabled,
      salesBillingEnabled: billingEnabled,
      [SALES_BILLING_AUTOMATION_FIELD]: createSubscriptionOnAcceptanceDefault,
      [SALES_CREATE_BILLING_SUBSCRIPTION_ON_ACCEPTANCE_FIELD]: createSubscriptionOnAcceptanceDefault,
      salesBillingAutomationUpdatedAt: timestamp,
      salesBillingAutomationUpdatedByUserId: user?.uid || "",
      salesBillingAutomationUpdatedByUserName: updatedByName,
      customerBillingSettingsUpdatedAt: timestamp,
      customerBillingSettingsUpdatedByUserId: user?.uid || "",
      customerBillingSettingsUpdatedByUserName: updatedByName,
      [PAYROLL_ENABLED_FIELD]: payrollEnabled,
      payrollSettingsUpdatedAt: timestamp,
      payrollSettingsUpdatedByUserId: user?.uid || "",
      payrollSettingsUpdatedByUserName: updatedByName,
    };
    const paySettingsPayload = {
      [PAYROLL_ENABLED_FIELD]: payrollEnabled,
      updatedAt: timestamp,
      updatedByUserId: user?.uid || "",
      updatedByName,
    };

    setSaving(true);

    try {
      const batch = writeBatch(db);
      batch.set(settingsRef(recentlySelectedCompany), payload, { merge: true });
      batch.set(companyDocRef(recentlySelectedCompany), companyBillingPayload, { merge: true });
      batch.set(paySettingsRef(recentlySelectedCompany), paySettingsPayload, { merge: true });
      await batch.commit();
      setSettings(normalizeCompanyWorkSettings(payload));
      setCustomerBillingEnabled(billingEnabled);
      setPayrollEnabled(payrollEnabled);
      setSalesBillingAutomationEnabled(createSubscriptionOnAcceptanceDefault);
      const savedAt = new Date();
      setOverview((current) => ({
        ...current,
        company: {
          ...(current.company || {}),
          [CUSTOMER_BILLING_ENABLED_FIELD]: billingEnabled,
          salesBillingEnabled: billingEnabled,
          [SALES_BILLING_AUTOMATION_FIELD]: createSubscriptionOnAcceptanceDefault,
          [SALES_CREATE_BILLING_SUBSCRIPTION_ON_ACCEPTANCE_FIELD]: createSubscriptionOnAcceptanceDefault,
          salesBillingAutomationUpdatedAt: savedAt,
          salesBillingAutomationUpdatedByUserId: user?.uid || "",
          salesBillingAutomationUpdatedByUserName: updatedByName,
          customerBillingSettingsUpdatedAt: savedAt,
          customerBillingSettingsUpdatedByUserId: user?.uid || "",
          customerBillingSettingsUpdatedByUserName: updatedByName,
          [PAYROLL_ENABLED_FIELD]: payrollEnabled,
          payrollSettingsUpdatedAt: savedAt,
          payrollSettingsUpdatedByUserId: user?.uid || "",
          payrollSettingsUpdatedByUserName: updatedByName,
        },
        paySettings: {
          ...(current.paySettings || {}),
          [PAYROLL_ENABLED_FIELD]: payrollEnabled,
          updatedAt: savedAt,
          updatedByUserId: user?.uid || "",
          updatedByName,
        },
      }));
      setLastSavedAt(savedAt);
      toast.success("Company settings saved.");
    } catch (error) {
      console.error("Failed to save company-wide settings:", error);
      toast.error("Could not save company settings.");
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_COMPANY_WORK_SETTINGS);
  };

  const formatSavedAt = (value) => {
    if (!value) return "Not saved yet";
    const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
    if (Number.isNaN(date?.getTime?.())) return "Not saved yet";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-6 text-slate-950 sm:px-4 lg:px-6">
      <div className="w-full space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Link
                to="/company/settings"
                className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Settings
              </Link>
              <div className="mt-4 flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                  <Cog6ToothIcon className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company configuration</p>
                  <h1 className="mt-1 text-3xl font-bold text-slate-950">Company Settings</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Company-wide switches for billing, offered work, route coverage, assignment, and payroll incentives.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={resetDefaults}
                disabled={saving || loading}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Defaults
              </button>
              <button
                type="button"
                onClick={saveSettings}
                disabled={saving || loading}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircleIcon className="h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <p className="mt-4 text-xs font-semibold text-slate-500">Last saved: {formatSavedAt(lastSavedAt)}</p>
        </header>

        {overviewLoading ? (
          <OverviewLoading />
        ) : (
          <CompanyOverview overview={overview} currentUserId={user?.uid || ""} />
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500 shadow-sm">
            Loading company settings...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {settingSections.map((section) => {
              const Icon = section.icon;

              return (
                <section key={section.title} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {section.items.map((item) => (
                      <ToggleRow
                        key={item.key}
                        label={item.label}
                        helper={item.helper}
                        checked={Boolean(normalizedSettings[item.key])}
                        onChange={(value) => updateSetting(item.key, value)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const StatusPill = ({ enabled, children }) => (
  <span
    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
      enabled
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-100 text-slate-600"
    }`}
  >
    {children}
  </span>
);

const OverviewRow = ({ label, value, muted = false }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <dt className="text-sm text-slate-500">{label}</dt>
    <dd className={`max-w-[58%] break-words text-right text-sm font-semibold ${muted ? "text-slate-500" : "text-slate-900"}`}>
      {value || "Not set"}
    </dd>
  </div>
);

const OverviewCard = ({ title, icon: Icon, badge, links = [], children }) => (
  <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="min-w-0 text-lg font-semibold text-slate-950">{title}</h2>
      </div>
      {badge}
    </div>
    <dl className="divide-y divide-slate-100 px-5 py-2">
      {children}
    </dl>
    {links.length > 0 ? (
      <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {link.label}
          </Link>
        ))}
      </div>
    ) : null}
  </section>
);

const OverviewLoading = () => (
  <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500 shadow-sm">
    Loading company overview...
  </section>
);

const CompanyOverview = ({ overview, currentUserId }) => {
  const company = overview.company || {};
  const emailConfiguration = overview.emailConfiguration || {};
  const paySettings = overview.paySettings || {};
  const testerStripSettings = overview.testerStripSettings || {};
  const counts = overview.counts || {};
  const counters = overview.counters || {};

  const customerBillingEnabled = isCustomerBillingEnabled(company);
  const agreementSubscriptionAutomationEnabled = shouldCreateBillingSubscriptionOnAgreementAcceptance(company);
  const installInvoiceAutomationEnabled = isShoppingItemInstallInvoiceAutomationEnabled(company);
  const connectedAccountId = getCompanyConnectedAccountId(company);
  const ownerCanManageStripe = Boolean(company.ownerId && currentUserId && company.ownerId === currentUserId);
  const enabledTesterProfiles = Array.isArray(testerStripSettings.enabledProfileIds)
    ? testerStripSettings.enabledProfileIds.length
    : 0;
  const payrollEnabled = isPayrollEnabled(company) && isPayrollEnabled(paySettings);
  const setupConfigured = counts.taskGroups > 0 || counts.jobTemplates > 0 || counts.termsTemplates > 0 || counts.productCatalog > 0 || counts.vendorItems > 0;
  const poolDataConfigured = counts.readingTemplates > 0 || counts.dosageTemplates > 0 || enabledTesterProfiles > 0;
  const payrollConfigured = Boolean(overview.paySettings);
  const customerSetupConfigured = counts.pipelineStages > 0 || counts.onboardingChecklist > 0;

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase text-blue-700">Company overview</p>
        <h2 className="mt-1 text-2xl font-bold text-slate-950">Settings Snapshot</h2>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-4">
        <OverviewCard
          title="Company Profile"
          icon={DocumentTextIcon}
          badge={<StatusPill enabled={!company.hideFromBrowse}>{company.hideFromBrowse ? "Hidden" : "Visible"}</StatusPill>}
          links={[{ to: "/Company/CompanyInfo", label: "Company Info" }]}
        >
          <OverviewRow label="Company email" value={company.email} />
          <OverviewRow label="Phone" value={company.phoneNumber} />
          <OverviewRow label="Website" value={company.websiteURL} />
          <OverviewRow label="Verification" value={company.verified ? "Verified" : "Not verified"} />
        </OverviewCard>

        <OverviewCard
          title="Billing & Stripe"
          icon={CreditCardIcon}
          badge={<StatusPill enabled={customerBillingEnabled}>{onOffLabel(customerBillingEnabled)}</StatusPill>}
          links={[{ to: "/company/settings/stripe-billing", label: ownerCanManageStripe ? "Manage Stripe Billing" : "View Stripe Billing" }]}
        >
          <OverviewRow label="Customer billing" value={onOffLabel(customerBillingEnabled)} />
          <OverviewRow label="Agreement subscriptions" value={onOffLabel(agreementSubscriptionAutomationEnabled)} />
          <OverviewRow label="Installed-item invoices" value={onOffLabel(installInvoiceAutomationEnabled)} />
          <OverviewRow label="Connected account" value={connectedAccountId || "Not connected"} muted={!connectedAccountId} />
          <OverviewRow label="Last billing update" value={formatDateTime(company.salesBillingAutomationUpdatedAt)} />
          {customerBillingEnabled && !connectedAccountId ? (
            <div className="py-2">
              <dt className="sr-only">Billing setup warning</dt>
              <dd className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                Billing is on, but no Stripe connected account is saved.
              </dd>
            </div>
          ) : null}
        </OverviewCard>

        <OverviewCard
          title="Communication"
          icon={EnvelopeIcon}
          badge={<StatusPill enabled={emailConfiguration.emailIsOn === true}>{onOffLabel(emailConfiguration.emailIsOn === true)}</StatusPill>}
          links={[
            { to: "/Company/EmailConfiguration", label: "Email Configuration" },
            { to: "/company/settings/text-templates", label: "Text Templates" },
          ]}
        >
          <OverviewRow label="Service emails" value={onOffLabel(emailConfiguration.emailIsOn === true)} />
          <OverviewRow label="Photo required" value={onOffLabel(emailConfiguration.requirePhoto === true)} />
          <OverviewRow label="From email" value={emailConfiguration.fromEmail} />
          <OverviewRow label="Reply-to email" value={emailConfiguration.replyToEmail} />
          <OverviewRow label="Text templates" value={formatCount(counts.textTemplates, "saved template")} />
        </OverviewCard>

        <OverviewCard
          title="Setup Libraries"
          icon={ArchiveBoxIcon}
          badge={<StatusPill enabled={setupConfigured}>{setupConfigured ? "Configured" : "Needs setup"}</StatusPill>}
          links={[
            { to: "/Company/TaskGroups", label: "Task Groups" },
            { to: "/company/settings/job-templates", label: "Job Templates" },
            { to: "/company/settings/terms-templates", label: "Terms Templates" },
            { to: "/company/settings/product-catalog", label: "Products" },
            { to: "/company/settings/vendor-items", label: "Vendor Items" },
          ]}
        >
          <OverviewRow label="Task groups" value={formatCount(counts.taskGroups, "group")} />
          <OverviewRow label="Job templates" value={formatCount(counts.jobTemplates, "template")} />
          <OverviewRow label="Terms templates" value={formatCount(counts.termsTemplates, "template")} />
          <OverviewRow label="Products" value={formatCount(counts.productCatalog, "product")} />
          <OverviewRow label="Vendor items" value={formatCount(counts.vendorItems, "vendor item")} />
        </OverviewCard>

        <OverviewCard
          title="Pool Data"
          icon={BeakerIcon}
          badge={<StatusPill enabled={poolDataConfigured}>{poolDataConfigured ? "Mapped" : "Needs setup"}</StatusPill>}
          links={[
            { to: "/company/readingsAndDosages", label: "Readings & Dosages" },
            { to: "/company/settings/tester-strips", label: "Tester Strips" },
            { to: "/company/settings/stop-data", label: "Stop Data" },
          ]}
        >
          <OverviewRow label="Reading templates" value={formatCount(counts.readingTemplates, "template")} />
          <OverviewRow label="Dosage templates" value={formatCount(counts.dosageTemplates, "template")} />
          <OverviewRow label="Tester strip profiles" value={formatCount(enabledTesterProfiles, "enabled profile")} />
          <OverviewRow label="Next recurring stop" value={formatNextNumber(counters.recurringServiceStops, "RSS")} />
        </OverviewCard>

        <OverviewCard
          title="Payroll"
          icon={CurrencyDollarIcon}
          badge={<StatusPill enabled={payrollEnabled}>{onOffLabel(payrollEnabled)}</StatusPill>}
          links={[{ to: "/company/settings/payroll-setup", label: "Payroll Setup" }]}
        >
          <OverviewRow label="Payroll enabled" value={onOffLabel(payrollEnabled)} />
          <OverviewRow label="Pay mode" value={labelize(paySettings.payMode)} />
          <OverviewRow label="Route pay source" value={labelize(paySettings.routePaySource)} />
          <OverviewRow label="Task pay source" value={labelize(paySettings.taskPaySource)} />
          <OverviewRow label="Lock after approval" value={onOffLabel(paySettings.lockPayAfterApproval === true)} />
          {!payrollConfigured ? <OverviewRow label="Pay rules" value="Default rules" muted /> : null}
        </OverviewCard>

        <OverviewCard
          title="Customer Setup"
          icon={ChatBubbleLeftRightIcon}
          badge={<StatusPill enabled={customerSetupConfigured}>{customerSetupConfigured ? "Pipeline" : "Needs setup"}</StatusPill>}
          links={[
            { to: "/company/settings/onboarding-checklist", label: "Onboarding Checklist" },
            { to: "/company/settings/onboarding-checklist#customer-pipeline", label: "Customer Pipeline" },
          ]}
        >
          <OverviewRow label="Onboarding items" value={formatCount(counts.onboardingChecklist, "item")} />
          <OverviewRow label="Pipeline stages" value={formatCount(counts.pipelineStages, "stage")} />
          <OverviewRow label="Lead sources" value={formatCount(counts.leadSources, "source")} />
          <OverviewRow label="Next work order" value={formatNextNumber(counters.workOrders, "J")} />
        </OverviewCard>
      </div>
    </section>
  );
};

const ToggleRow = ({ label, helper, checked, onChange }) => (
  <label className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 transition hover:bg-slate-50">
    <span>
      <span className="block text-sm font-semibold text-slate-900">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{helper}</span>
    </span>
    <span className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-blue-600" : "bg-slate-300"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`}
      />
    </span>
  </label>
);

export default CompanyWideSettings;
