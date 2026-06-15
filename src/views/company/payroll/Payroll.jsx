import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { Link, useLocation } from "react-router-dom";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { estimateServiceStopPay } from "../../../utils/payroll/payEstimate";
import { v4 as uuidv4 } from "uuid";
import {
  IoBriefcaseOutline,
  IoBuildOutline,
  IoBusinessOutline,
  IoCalendarOutline,
  IoCallOutline,
  IoCardOutline,
  IoCarOutline,
  IoCashOutline,
  IoChevronDownOutline,
  IoChevronUpOutline,
  IoChatbubbleEllipsesOutline,
  IoCheckmarkCircleOutline,
  IoClipboardOutline,
  IoContractOutline,
  IoConstructOutline,
  IoDocumentTextOutline,
  IoExpandOutline,
  IoFilterOutline,
  IoFlaskOutline,
  IoHammerOutline,
  IoHomeOutline,
  IoListOutline,
  IoLocationOutline,
  IoMapOutline,
  IoPeopleOutline,
  IoPersonOutline,
  IoPricetagOutline,
  IoReaderOutline,
  IoSparklesOutline,
  IoTimeOutline,
  IoTrailSignOutline,
  IoWarningOutline,
  IoWaterOutline,
} from "react-icons/io5";

const SERVICE_STOP_BACKFILL_COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";
const BASE_TECHNICIAN_RATE_ID = "base_technician_default";
const BASE_TECHNICIAN_RATE_PLAN_ID = "base_technician_rate_template";

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
  const date = dateFromValue(value);
  return date ? date.toLocaleDateString() : "-";
};

const isoDate = (date) => date.toISOString().slice(0, 10);

const isoDateTime = (value) => {
  const date = dateFromValue(value);
  return date ? date.toISOString() : "";
};

const debugDateTime = (value) => isoDateTime(value) || "-";

const serializeForDebug = (value) => {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeForDebug);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeForDebug(nestedValue)])
    );
  }
  return value;
};

const statusLabel = (value) =>
  String(value || "unknown")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const StatCard = ({ title, value, subtitle }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
  </div>
);

const StatusPill = ({ status }) => (
  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
    {statusLabel(status)}
  </span>
);

const DetailField = ({ label, value, accent }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 break-words text-sm font-semibold ${accent ? "text-blue-700" : "text-slate-900"}`}>
      {value === null || value === undefined || value === "" ? "-" : String(value)}
    </p>
  </div>
);

const emptyPaymentForm = () => ({
  paidDate: isoDate(new Date()),
  paymentReference: "",
  paidNotes: "",
});

const defaultPaySettings = (companyId) => ({
  companyId,
  payMode: "productionOnly",
  routePaySource: "serviceStopAndCompletedTasks",
  taskPaySource: "technicianRateThenTaskContractedRate",
  hourlyPaySource: "none",
  allowMultipleWorkTypesPerStop: true,
  defaultStackBehavior: "stackable",
  allowTechnicianRateOverrides: true,
  allowManualPayAdjustments: false,
  payCommercialAsSeparateWorkType: true,
  paySpaAsSeparateWorkType: true,
  payPerBodyOfWater: true,
  commercialMultiBodyPayStyle: "basePlusAdditionalBodyRate",
  lockPayAfterApproval: true,
  recalculateUnapprovedPayWhenRatesChange: true,
});

const hourlyPaySettings = (companyId) => ({
  ...defaultPaySettings(companyId),
  payMode: "hourlyOnly",
  routePaySource: "none",
  taskPaySource: "none",
  hourlyPaySource: "activeRouteDuration",
  allowMultipleWorkTypesPerStop: false,
  payCommercialAsSeparateWorkType: false,
  paySpaAsSeparateWorkType: false,
  payPerBodyOfWater: false,
  commercialMultiBodyPayStyle: "singleCommercialRate",
});

const hybridPaySettings = (companyId) => ({
  ...defaultPaySettings(companyId),
  payMode: "hybrid",
  hourlyPaySource: "activeRouteDuration",
});

const normalizePaySettingsForIos = (settings = {}, companyId = "") => {
  const normalized = {
    ...defaultPaySettings(companyId),
    ...settings,
    companyId,
  };

  if (normalized.hourlyPaySource === "activeRouteLog") {
    normalized.hourlyPaySource = "activeRouteLogs";
  }

  return normalized;
};

const emptyRateForm = () => ({
  technicianId: "",
  workTypeId: "",
  payBasis: "serviceStop",
  rateType: "flatPerStop",
  amount: "",
  effectiveStartDate: isoDate(new Date()),
  status: "active",
  reason: "",
});

const rateTypeOptions = ["flatPerStop", "flatPerTask", "hourly", "perBodyOfWater", "perServiceLocation", "percentage", "manual"];
const payBasisOptions = ["serviceStop", "serviceStopTask", "technicianHourly", "manualAdjustment"];
const payModeOptions = ["productionOnly", "hourlyOnly", "hybrid"];
const routePaySourceOptions = ["serviceStop", "completedTasks", "serviceStopAndCompletedTasks", "hourlyServiceStopDuration", "hourlyTaskActualTime", "none"];
const taskPaySourceOptions = ["technicianRate", "taskContractedRate", "technicianRateThenTaskContractedRate", "taskContractedRateThenTechnicianRate", "hourlyActualTime", "hourlyEstimatedTime", "none"];
const hourlyPaySourceOptions = ["activeRouteDuration", "activeRouteLogs", "serviceStopDuration", "taskActualTime", "none"];
const stackBehaviorOptions = ["stackable", "exclusive", "replacesBase", "modifier"];
const commercialMultiBodyPayStyleOptions = ["singleCommercialRate", "sameRatePerBodyOfWater", "basePlusAdditionalBodyRate"];
const rateStatusOptions = ["active", "scheduled", "draft", "expired", "archived"];
const workCategoryOptions = ["route", "serviceCall", "repair", "installation", "cleaning", "commercial", "startup", "drainAndRefill", "extra", "custom"];

const defaultStopPayCategories = [
  {
    id: "route",
    label: "Routes",
    category: "Route",
    sourceId: "system_recurring_service_stop",
    helper: "Recurring route work and scheduled route visits.",
    defaultWorkCategory: "route",
    defaultRateType: "flatPerStop",
    defaultIconName: "figure.pool.swim",
  },
  {
    id: "job",
    label: "Jobs",
    category: "Job",
    sourceId: "system_job_service_stop",
    helper: "Actual job work performed by a technician.",
    defaultWorkCategory: "serviceCall",
    defaultRateType: "flatPerStop",
    defaultIconName: "briefcase",
  },
  {
    id: "jobEstimate",
    label: "Job Estimates",
    category: "Job Estimate",
    sourceId: "system_job_estimate_service_stop",
    helper: "Fact-finding visits for requested job work before quoting.",
    defaultWorkCategory: "serviceCall",
    defaultRateType: "flatPerStop",
    defaultIconName: "doc.text.magnifyingglass",
  },
  {
    id: "serviceAgreementEstimate",
    label: "Service Agreement Estimates",
    category: "Service Agreement Estimate",
    sourceId: "system_service_agreement_estimate_service_stop",
    helper: "New recurring service surveys, new pools, and agreement inspections.",
    defaultWorkCategory: "startup",
    defaultRateType: "flatPerStop",
    defaultIconName: "list.clipboard",
  },
  {
    id: "customerRelationship",
    label: "Customer Relationship",
    category: "Customer Relationship",
    sourceId: "system_customer_relationship_service_stop",
    helper: "Open-ended customer visits, follow-ups, corrections, and conversations.",
    defaultWorkCategory: "serviceCall",
    defaultRateType: "flatPerStop",
    defaultIconName: "person.wave.2",
  },
];

const iosIconOptions = [
  { name: "figure.pool.swim", label: "Pool Service", category: "Pool", Icon: IoWaterOutline },
  { name: "briefcase", label: "Job", category: "Work", Icon: IoBriefcaseOutline },
  { name: "doc.text.magnifyingglass", label: "Estimate", category: "Sales", Icon: IoDocumentTextOutline },
  { name: "list.clipboard", label: "Checklist", category: "Work", Icon: IoClipboardOutline },
  { name: "person.wave.2", label: "Customer Visit", category: "Customer", Icon: IoPeopleOutline },
  { name: "wrench.and.screwdriver", label: "Repair", category: "Repair", Icon: IoConstructOutline },
  { name: "hammer", label: "Install", category: "Repair", Icon: IoHammerOutline },
  { name: "drop", label: "Water", category: "Pool", Icon: IoWaterOutline },
  { name: "testtube.2", label: "Water Test", category: "Pool", Icon: IoFlaskOutline },
  { name: "leaf", label: "Cleaning", category: "Pool", Icon: IoSparklesOutline },
  { name: "sparkles", label: "Clean Up", category: "Pool", Icon: IoSparklesOutline },
  { name: "calendar", label: "Scheduled", category: "Scheduling", Icon: IoCalendarOutline },
  { name: "clock", label: "Hourly", category: "Scheduling", Icon: IoTimeOutline },
  { name: "checkmark.circle", label: "Completed", category: "Status", Icon: IoCheckmarkCircleOutline },
  { name: "exclamationmark.triangle", label: "Needs Review", category: "Status", Icon: IoWarningOutline },
  { name: "house", label: "Residential", category: "Customer", Icon: IoHomeOutline },
  { name: "building.2", label: "Commercial", category: "Customer", Icon: IoBusinessOutline },
  { name: "person", label: "Customer", category: "Customer", Icon: IoPersonOutline },
  { name: "phone", label: "Call", category: "Customer", Icon: IoCallOutline },
  { name: "bubble.left.and.bubble.right", label: "Conversation", category: "Customer", Icon: IoChatbubbleEllipsesOutline },
  { name: "truck.box", label: "Route", category: "Route", Icon: IoTrailSignOutline },
  { name: "car", label: "Drive Time", category: "Route", Icon: IoCarOutline },
  { name: "map", label: "Route Map", category: "Route", Icon: IoMapOutline },
  { name: "location", label: "Location", category: "Route", Icon: IoLocationOutline },
  { name: "dollarsign.circle", label: "Pay", category: "Payroll", Icon: IoCashOutline },
  { name: "creditcard", label: "Payment", category: "Payroll", Icon: IoCardOutline },
  { name: "doc.plaintext", label: "Paperwork", category: "Admin", Icon: IoReaderOutline },
  { name: "checklist", label: "Task List", category: "Work", Icon: IoListOutline },
  { name: "gearshape.2", label: "Equipment", category: "Repair", Icon: IoBuildOutline },
  { name: "tag", label: "Custom", category: "General", Icon: IoPricetagOutline },
];

const IosIconPicker = ({ label, value, onChange }) => {
  const [query, setQuery] = useState("");
  const selectedIcon = iosIconOptions.find((icon) => icon.name === value);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleIcons = iosIconOptions.filter((icon) => {
    if (!normalizedQuery) return true;
    return [icon.name, icon.label, icon.category].some((field) => field.toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="text-sm font-semibold text-slate-700 sm:col-span-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>{label}</span>
        <span className="text-xs font-normal text-slate-500">
          {selectedIcon ? `${selectedIcon.label} - ${selectedIcon.name}` : value ? `Current - ${value}` : "Choose an iOS icon"}
        </span>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Search pool, repair, route, pay..."
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {value && !selectedIcon ? (
        <p className="mt-1 text-xs font-normal text-amber-700">
          This record is using an icon that is not in the picker yet. Choose a new one below to replace it.
        </p>
      ) : null}
      <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2">
        {visibleIcons.length === 0 ? (
          <p className="rounded-md bg-white p-3 text-xs font-normal text-slate-500 sm:col-span-2">
            No icons match that search.
          </p>
        ) : visibleIcons.map((icon) => {
          const PreviewIcon = icon.Icon;
          const isSelected = value === icon.name;

          return (
            <button
              type="button"
              key={icon.name}
              onClick={() => onChange(icon.name)}
              aria-pressed={isSelected}
              className={`flex min-h-[4.5rem] items-center gap-3 rounded-md border p-3 text-left transition ${
                isSelected
                  ? "border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-500"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-white"
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${isSelected ? "bg-white" : "bg-slate-100"}`}>
                <PreviewIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{icon.label}</span>
                <span className="block truncate text-xs font-normal text-slate-500">{icon.name}</span>
                <span className="block text-[11px] font-normal text-slate-400">{icon.category}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const normalizeStopPayCategory = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_/-]/g, "");

const stopPayCategoryForValue = (value = "", categories = defaultStopPayCategories) => {
  const normalized = normalizeStopPayCategory(value);
  return categories.find((category) => (
    normalizeStopPayCategory(category.id) === normalized ||
    normalizeStopPayCategory(category.category) === normalized ||
    normalizeStopPayCategory(category.label) === normalized ||
    normalizeStopPayCategory(category.sourceId) === normalized
  )) || null;
};

const stopPayCategoryForServiceStopType = (type = {}, categories = defaultStopPayCategories) => {
  const explicitMatch =
    stopPayCategoryForValue(type.stopPayBucketId, categories) ||
    stopPayCategoryForValue(type.serviceStopBucketId, categories) ||
    stopPayCategoryForValue(type.stopPayBucketLabel, categories) ||
    stopPayCategoryForValue(type.category, categories) ||
    stopPayCategoryForValue(type.serviceStopCategory, categories) ||
    stopPayCategoryForValue(type.serviceStopTypeUseCaseRawValue, categories) ||
    stopPayCategoryForValue(type.id, categories);

  if (explicitMatch) return explicitMatch;

  const searchable = `${type.name || ""} ${type.type || ""}`.toLowerCase();
  if (searchable.includes("service agreement") || searchable.includes("recurring service estimate") || searchable.includes("startup")) {
    return categories.find((category) => category.id === "serviceAgreementEstimate");
  }
  if (searchable.includes("estimate")) {
    return categories.find((category) => category.id === "jobEstimate");
  }
  if (searchable.includes("route") || searchable.includes("weekly")) {
    return categories.find((category) => category.id === "route");
  }
  if (searchable.includes("customer") || searchable.includes("follow up") || searchable.includes("courtesy")) {
    return categories.find((category) => category.id === "customerRelationship");
  }

  return categories.find((category) => category.id === "job") || categories[0] || null;
};

const stopPayCategoryForWorkType = (type = {}, categories = defaultStopPayCategories) => {
  const explicitMatch =
    stopPayCategoryForValue(type.stopPayBucketId, categories) ||
    stopPayCategoryForValue(type.serviceStopBucketId, categories) ||
    stopPayCategoryForValue(type.stopPayBucketLabel, categories) ||
    stopPayCategoryForValue(type.serviceStopCategory, categories) ||
    stopPayCategoryForValue(type.stopPayCategory, categories) ||
    stopPayCategoryForValue(type.serviceStopBucket, categories) ||
    stopPayCategoryForValue(type.sourceId, categories);

  if (explicitMatch) return explicitMatch;

  const searchable = `${type.name || ""} ${type.type || ""}`.toLowerCase();
  if (searchable.includes("service agreement") || searchable.includes("recurring service estimate") || searchable.includes("startup")) {
    return categories.find((category) => category.id === "serviceAgreementEstimate");
  }
  if (searchable.includes("estimate")) {
    return categories.find((category) => category.id === "jobEstimate");
  }
  if (searchable.includes("route") || searchable.includes("weekly") || type.category === "route") {
    return categories.find((category) => category.id === "route");
  }
  if (searchable.includes("customer") || searchable.includes("follow up") || searchable.includes("courtesy")) {
    return categories.find((category) => category.id === "customerRelationship");
  }

  return categories.find((category) => category.id === "job") || categories[0] || null;
};

const emptyWorkTypeForm = () => ({
  name: "",
  stopPayCategoryId: "job",
  category: "serviceCall",
  iconName: "",
  defaultRateType: "flatPerStop",
  defaultStackBehavior: "stackable",
});

const emptyServiceStopTypeForm = () => ({
  name: "",
  categoryId: "job",
  imageName: "",
  defaultWorkTypeIds: [],
});

const dollarsToCents = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const centsToInputDollars = (value) => {
  const amount = Number(value || 0) / 100;
  return Number.isFinite(amount) ? String(amount) : "";
};

const suggestedPayBasisForMatrixWorkType = (workType = {}) => {
  if (workType.defaultRateType === "hourly") return "technicianHourly";

  switch (workType.category) {
    case "route":
    case "serviceCall":
    case "commercial":
    case "startup":
      return "serviceStop";
    case "repair":
    case "installation":
    case "cleaning":
    case "drainAndRefill":
    case "extra":
    case "custom":
      return "serviceStopTask";
    default:
      return "serviceStop";
  }
};

const rateMatrixCellKey = (technicianId, columnId) => `${technicianId || "unknown"}__${columnId || "general"}`;

const activeRateRank = (rate = {}) => {
  const status = String(rate.status || "active").toLowerCase();
  if (status === "active") return 0;
  if (status === "scheduled") return 1;
  if (status === "draft") return 2;
  if (status === "expired") return 3;
  if (status === "archived") return 4;
  return 5;
};

const compareTechnicianRates = (left = {}, right = {}) => {
  const statusDiff = activeRateRank(left) - activeRateRank(right);
  if (statusDiff !== 0) return statusDiff;
  return (dateFromValue(right.effectiveStartDate)?.getTime() || 0) - (dateFromValue(left.effectiveStartDate)?.getTime() || 0);
};

const sortedTechnicianRates = (rates = []) => [...rates].sort(compareTechnicianRates);

const displayWorkTitle = (item) =>
  item.taskName ||
  item.workTypeName ||
  item.serviceStopTypeName ||
  item.displayTitle ||
  "Payroll Line";

const rateTypeLabel = (item) => {
  const isMissingRate =
    item?.calculationStatus === "needsReview" &&
    !item?.rateId &&
    !item?.technicianRateId &&
    Number(item?.rateAmountCents || 0) === 0;

  return isMissingRate ? "Missing Rate" : statusLabel(item?.rateType);
};

const isLineItemPaid = (item) => Boolean(item?.paidAt) || item?.calculationStatus === "paid";

const isLineItemApproved = (item) =>
  Boolean(item?.approvedAt) || item?.calculationStatus === "approved" || isLineItemPaid(item);

const isLineItemVoided = (item) => Boolean(item?.voidedAt) || item?.calculationStatus === "voided";

const isActiveCompanyServiceStopType = (type = {}) =>
  type?.isActive !== false &&
  !["archived", "deleted", "inactive"].includes(String(type?.status || "").trim().toLowerCase());

const isActiveCompanyWorkType = (type = {}) =>
  type?.isActive !== false &&
  type?.active !== false &&
  !["archived", "deleted", "inactive"].includes(String(type?.status || "").trim().toLowerCase());

const isFinishedStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  return ["finished", "completed", "done", "complete"].includes(normalized);
};

const isServiceStopFinished = (stop) =>
  isFinishedStatus(stop?.operationStatus) ||
  Boolean(dateFromValue(stop?.endTime) || dateFromValue(stop?.finishedAt) || dateFromValue(stop?.completedAt));

const dateAtStartOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateAtEndOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const minutesBetween = (start, end) => {
  const startValue = dateFromValue(start);
  const endValue = dateFromValue(end);
  if (!startValue || !endValue) return 0;
  return Math.max(0, Math.round((endValue.getTime() - startValue.getTime()) / 60000));
};

const serviceStopStreetAddress = (stop = {}) =>
  stop?.address?.streetAddress ||
  stop?.address?.address01 ||
  stop?.serviceLocationAddress ||
  (typeof stop?.address === "string" ? stop.address : "") ||
  "";

const makePayLineItemId = ({ source, serviceStopId, serviceStopTaskId, technicianId, workTypeId }) =>
  [
    "comp_pay_line",
    source || "serviceStop",
    serviceStopId || "no_stop",
    serviceStopTaskId || "no_task",
    "no_route",
    "no_route_log",
    technicianId || "no_technician",
    workTypeId || "no_work_type",
  ].join("_");

const payStatementReference = (statementNumber) => `PS-${String(statementNumber).padStart(6, "0")}`;

const Payroll = ({ mode = "payroll" }) => {
  const isSetupMode = mode === "setup";
  const { recentlySelectedCompany, user } = useContext(Context);
  const location = useLocation();
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return isoDate(date);
  });
  const [endDate, setEndDate] = useState(() => isoDate(new Date()));
  const [lineItems, setLineItems] = useState([]);
  const [statements, setStatements] = useState([]);
  const [settingsForm, setSettingsForm] = useState(() => defaultPaySettings(""));
  const [companyStopPayBuckets, setCompanyStopPayBuckets] = useState([]);
  const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
  const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
  const [workTypeMappings, setWorkTypeMappings] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [technicianRates, setTechnicianRates] = useState([]);
  const [rateForm, setRateForm] = useState(emptyRateForm);
  const [workTypeForm, setWorkTypeForm] = useState(emptyWorkTypeForm);
  const [serviceStopTypeForm, setServiceStopTypeForm] = useState(emptyServiceStopTypeForm);
  const [editingWorkTypeId, setEditingWorkTypeId] = useState("");
  const [editingServiceStopTypeId, setEditingServiceStopTypeId] = useState("");
  const [editingRateId, setEditingRateId] = useState("");
  const [activeTab, setActiveTab] = useState(() => {
    const requestedTab = new URLSearchParams(location.search).get("tab");
    const payrollTabs = ["lineItems", "statements"];
    return isSetupMode ? "overview" : payrollTabs.includes(requestedTab) ? requestedTab : "lineItems";
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [detailLineItem, setDetailLineItem] = useState(null);
  const [detailStatement, setDetailStatement] = useState(null);
  const [backfillResult, setBackfillResult] = useState(null);
  const [backfillProgress, setBackfillProgress] = useState(null);
  const [stopPayModal, setStopPayModal] = useState(null);
  const [rateMatrixEditMode, setRateMatrixEditMode] = useState(false);
  const [rateMatrixDrafts, setRateMatrixDrafts] = useState({});
  const [rateMatrixFiltersOpen, setRateMatrixFiltersOpen] = useState(false);
  const [rateMatrixFullscreen, setRateMatrixFullscreen] = useState(false);
  const [collapsedRateMatrixBucketIds, setCollapsedRateMatrixBucketIds] = useState([]);
  const [rateMatrixTechnicianFilterIds, setRateMatrixTechnicianFilterIds] = useState([]);
  const [rateMatrixWorkTypeFilterIds, setRateMatrixWorkTypeFilterIds] = useState([]);

  useEffect(() => {
    setActiveTab((currentTab) => {
      const setupTabs = ["overview", "stopPay", "rates", "settings"];
      const payrollTabs = ["lineItems", "statements"];
      const allowedTabs = isSetupMode ? setupTabs : payrollTabs;
      const requestedTab = new URLSearchParams(location.search).get("tab");
      if (!isSetupMode && allowedTabs.includes(requestedTab)) return requestedTab;
      return allowedTabs.includes(currentTab) ? currentTab : allowedTabs[0];
    });
  }, [isSetupMode, location.search]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLineItems([]);
      setStatements([]);
      setSettingsForm(defaultPaySettings(""));
      setCompanyStopPayBuckets([]);
      setCompanyServiceStopTypes([]);
      setCompanyWorkTypes([]);
      setWorkTypeMappings([]);
      setCompanyUsers([]);
      setTechnicianRates([]);
      setRateForm(emptyRateForm());
      setWorkTypeForm(emptyWorkTypeForm());
      setServiceStopTypeForm(emptyServiceStopTypeForm());
      setEditingWorkTypeId("");
      setEditingServiceStopTypeId("");
      setEditingRateId("");
      setDetailStatement(null);
      setBackfillResult(null);
      setBackfillProgress(null);
      setRateMatrixEditMode(false);
      setRateMatrixDrafts({});
      setRateMatrixFiltersOpen(false);
      setRateMatrixFullscreen(false);
      setCollapsedRateMatrixBucketIds([]);
      setRateMatrixTechnicianFilterIds([]);
      setRateMatrixWorkTypeFilterIds([]);
      return;
    }

    const loadPayroll = async () => {
      setLoading(true);
      setError("");

      try {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T23:59:59`);

        const lineItemsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayLineItems");
        const lineItemsQuery = query(
          lineItemsRef,
          where("completedDate", ">=", start),
          where("completedDate", "<=", end)
        );

        const statementsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayStatements");
        const settingsRef = doc(db, "companies", recentlySelectedCompany, "paySettings", "main");
        const stopPayBucketsRef = collection(db, "companies", recentlySelectedCompany, "companyStopPayBuckets");
        const serviceStopTypesRef = collection(db, "companies", recentlySelectedCompany, "companyServiceStopTypes");
        const workTypesRef = collection(db, "companies", recentlySelectedCompany, "companyWorkTypes");
        const workTypeMappingsRef = collection(db, "companies", recentlySelectedCompany, "workTypeMappings");
        const companyUsersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const technicianRatesRef = collection(db, "companies", recentlySelectedCompany, "technicianRates");

        const [
          lineItemsSnap,
          statementsSnap,
          settingsSnap,
          stopPayBucketsSnap,
          serviceStopTypesSnap,
          workTypesSnap,
          workTypeMappingsSnap,
          companyUsersSnap,
          technicianRatesSnap,
        ] = await Promise.all([
          getDocs(lineItemsQuery),
          getDocs(statementsRef),
          getDoc(settingsRef),
          getDocs(stopPayBucketsRef),
          getDocs(serviceStopTypesRef),
          getDocs(workTypesRef),
          getDocs(workTypeMappingsRef),
          getDocs(companyUsersRef),
          getDocs(technicianRatesRef),
        ]);

        const nextLineItems = lineItemsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => (dateFromValue(b.completedDate)?.getTime() || 0) - (dateFromValue(a.completedDate)?.getTime() || 0));

        const nextStatements = statementsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((statement) => {
            const statementStart = dateFromValue(statement.startDate);
            const statementEnd = dateFromValue(statement.endDate);
            if (!statementStart || !statementEnd) return true;
            return statementStart <= end && statementEnd >= start;
          })
          .sort((a, b) => (dateFromValue(b.startDate)?.getTime() || 0) - (dateFromValue(a.startDate)?.getTime() || 0));

        setLineItems(nextLineItems);
        setStatements(nextStatements);
        const nextPaySettings = normalizePaySettingsForIos(
          settingsSnap.exists() ? settingsSnap.data() : {},
          recentlySelectedCompany
        );
        setSettingsForm(nextPaySettings);
        setCompanyStopPayBuckets(
          stopPayBucketsSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.label || a.name || "").localeCompare(String(b.label || b.name || "")))
        );
        setCompanyServiceStopTypes(
          serviceStopTypesSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")))
        );
        setCompanyWorkTypes(
          workTypesSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")))
        );
        setWorkTypeMappings(
          workTypeMappingsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        );
        setCompanyUsers(
          companyUsersSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => String(a.userName || a.name || "").localeCompare(String(b.userName || b.name || "")))
        );
        setTechnicianRates(
          technicianRatesSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => (dateFromValue(b.effectiveStartDate)?.getTime() || 0) - (dateFromValue(a.effectiveStartDate)?.getTime() || 0))
        );
      } catch (err) {
        console.error("Error loading payroll:", err);
        setError("Could not load payroll data.");
      } finally {
        setLoading(false);
      }
    };

    loadPayroll();
  }, [recentlySelectedCompany, startDate, endDate]);

  const summary = useMemo(() => {
    const activeItems = lineItems.filter((item) => !isLineItemVoided(item));
    const totalCents = activeItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
    const needsReview = activeItems.filter((item) => item.calculationStatus === "needsReview").length;
    const approved = activeItems.filter(isLineItemApproved).length;
    const paid = activeItems.filter(isLineItemPaid).length;
    const statementCandidateItems = activeItems.filter(
      (item) =>
        isLineItemApproved(item) &&
        !isLineItemPaid(item) &&
        !item.payStatementId
    );
    const statementCandidateCents = statementCandidateItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);

    return { activeItems, totalCents, needsReview, approved, paid, statementCandidateItems, statementCandidateCents };
  }, [lineItems]);

  const statementCandidateGroups = useMemo(() => {
    const groupsByTechnician = new Map();

    summary.statementCandidateItems.forEach((item) => {
      const technicianId = item.technicianId || "unknown";
      const existing = groupsByTechnician.get(technicianId) || {
        technicianId,
        technicianName: item.technicianName || "Unknown",
        workerType: item.workerType || "notAssigned",
        lineItems: [],
        subtotalCents: 0,
      };

      existing.lineItems.push(item);
      existing.subtotalCents += Number(item.totalAmountCents || 0);
      groupsByTechnician.set(technicianId, existing);
    });

    return [...groupsByTechnician.values()]
      .map((group) => ({
        ...group,
        lineItems: group.lineItems.sort(
          (a, b) => (dateFromValue(a.completedDate)?.getTime() || 0) - (dateFromValue(b.completedDate)?.getTime() || 0)
        ),
      }))
      .sort((a, b) => String(a.technicianName || "").localeCompare(String(b.technicianName || "")));
  }, [summary.statementCandidateItems]);

  const approvableLineItems = useMemo(
    () => summary.activeItems.filter((item) => !isLineItemApproved(item)),
    [summary.activeItems]
  );

  const currentUserId = user?.uid || user?.id || "";

  const lineItemsForStatement = (statement) => {
    const ids = new Set(Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []);
    return lineItems.filter((item) => ids.has(item.id) || item.payStatementId === statement.id);
  };

  const lineItemsForStatementDetail = (detail) => {
    if (!detail) return [];
    return detail.type === "candidate" ? detail.group?.lineItems || [] : lineItemsForStatement(detail.statement || {});
  };

  const statementDetailSummary = (detail) => {
    if (!detail) return null;
    const lines = lineItemsForStatementDetail(detail);
    const source = detail.type === "candidate" ? detail.group : detail.statement;
    return {
      lines,
      title: detail.type === "candidate"
        ? `${source?.technicianName || "Technician"} Statement Preview`
        : source?.statementReference || source?.technicianName || "Pay Statement",
      technicianName: source?.technicianName || "Technician",
      workerType: source?.workerType || "notAssigned",
      startDate: detail.type === "candidate" ? startDate : source?.startDate,
      endDate: detail.type === "candidate" ? endDate : source?.endDate,
      subtotalCents: detail.type === "candidate" ? source?.subtotalCents : source?.subtotalCents,
      adjustmentCents: detail.type === "candidate" ? 0 : source?.adjustmentCents,
      totalCents: detail.type === "candidate" ? source?.subtotalCents : source?.totalCents,
      status: detail.type === "candidate" ? "ready" : source?.status,
    };
  };

  const statementLineItemIds = (statement) => {
    const ids = new Set(Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []);
    lineItems
      .filter((item) => item.payStatementId === statement.id)
      .forEach((item) => ids.add(item.id));
    return [...ids];
  };

  const setActionNotice = (message = "") => {
    setActionError("");
    setActionMessage(message);
  };

  const setActionFailure = (message) => {
    setActionMessage("");
    setActionError(message);
  };

  const updateLocalLineItem = (id, payload) => {
    setLineItems((items) => items.map((item) => (item.id === id ? { ...item, ...payload } : item)));
  };

  const updateLocalStatement = (id, payload) => {
    setStatements((items) => items.map((item) => (item.id === id ? { ...item, ...payload } : item)));
  };

  const workerName = (technicianId) => {
    if (technicianId === BASE_TECHNICIAN_RATE_ID) return "Base Technician Defaults";
    const worker = companyUsers.find((item) => item.userId === technicianId || item.id === technicianId);
    return worker?.userName || worker?.name || worker?.displayName || technicianId || "-";
  };

  const workTypeName = (workTypeId) => {
    const workType = companyWorkTypes.find((item) => item.id === workTypeId);
    return workType?.name || (workTypeId ? workTypeId : "General");
  };

  const serviceStopTypeWorkTypeNames = (type) => {
    const ids = Array.isArray(type.defaultWorkTypeIds) ? type.defaultWorkTypeIds : [];
    const activeNames = ids
      .map((id) => companyWorkTypes.find((item) => item.id === id))
      .filter(isActiveCompanyWorkType)
      .map((workType) => workType.name || workType.id)
      .filter(Boolean);
    if (activeNames.length === 0) return "No default work types";
    return activeNames.join(", ");
  };

  const activeCompanyServiceStopTypes = useMemo(
    () => companyServiceStopTypes.filter(isActiveCompanyServiceStopType),
    [companyServiceStopTypes]
  );
  const activeCompanyWorkTypes = useMemo(
    () => companyWorkTypes.filter(isActiveCompanyWorkType),
    [companyWorkTypes]
  );

  const stopPayCategories = useMemo(() => {
    const byId = new Map(
      defaultStopPayCategories.map((bucket, index) => [
        bucket.id,
        {
          ...bucket,
          isActive: true,
          isSystemDefault: true,
          sortOrder: index * 10,
        },
      ])
    );

    companyStopPayBuckets.forEach((bucket, index) => {
      if (!bucket?.id) return;
      const base = byId.get(bucket.id) || {};
      const label = String(bucket.label || bucket.name || base.label || "Stop Bucket").trim();
      const category = bucket.category || base.category || "Job";

      byId.set(bucket.id, {
        ...base,
        ...bucket,
        label,
        category,
        helper: bucket.helper || base.helper || "",
        defaultWorkCategory: bucket.defaultWorkCategory || base.defaultWorkCategory || "serviceCall",
        defaultRateType: bucket.defaultRateType || base.defaultRateType || "flatPerStop",
        defaultIconName: bucket.defaultIconName || bucket.iconName || base.defaultIconName || "briefcase",
        sourceId: bucket.sourceId || base.sourceId || bucket.id,
        isActive: bucket.isActive !== false,
        isSystemDefault: Boolean(base.isSystemDefault),
        sortOrder: bucket.sortOrder ?? base.sortOrder ?? (defaultStopPayCategories.length + index) * 10,
      });
    });

    return [...byId.values()]
      .filter((bucket) => bucket.isActive !== false)
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.label || "").localeCompare(String(b.label || "")));
  }, [companyStopPayBuckets]);

  const serviceStopTypesByStopPayCategory = useMemo(() => {
    const grouped = Object.fromEntries(stopPayCategories.map((category) => [category.id, []]));

    activeCompanyServiceStopTypes.forEach((type) => {
      const category = stopPayCategoryForServiceStopType(type, stopPayCategories);
      const categoryId = category?.id || "job";
      grouped[categoryId] = [...(grouped[categoryId] || []), type];
    });

    return grouped;
  }, [activeCompanyServiceStopTypes, stopPayCategories]);

  const workTypesByStopPayCategory = useMemo(() => {
    const grouped = Object.fromEntries(stopPayCategories.map((category) => [category.id, []]));

    activeCompanyWorkTypes.forEach((type) => {
      const category = stopPayCategoryForWorkType(type, stopPayCategories);
      const categoryId = category?.id || "job";
      grouped[categoryId] = [...(grouped[categoryId] || []), type];
    });

    return grouped;
  }, [activeCompanyWorkTypes, stopPayCategories]);

  const serviceStopTypeFormWorkTypeOptions = workTypesByStopPayCategory[serviceStopTypeForm.categoryId] || [];
  const rateMatrixRows = useMemo(
    () => [
      {
        id: BASE_TECHNICIAN_RATE_ID,
        userId: BASE_TECHNICIAN_RATE_ID,
        matrixTechnicianId: BASE_TECHNICIAN_RATE_ID,
        matrixName: "Base Technician Defaults",
        workerType: "Starting rates for new technicians",
        isRateTemplate: true,
      },
      ...companyUsers
        .map((worker) => ({
          ...worker,
          matrixTechnicianId: worker.userId || worker.id || worker.docId || "",
          matrixName: worker.userName || worker.name || worker.displayName || "Technician",
        }))
        .filter((worker) => worker.matrixTechnicianId)
        .sort((a, b) => String(a.matrixName || "").localeCompare(String(b.matrixName || ""))),
    ],
    [companyUsers]
  );
  const rateMatrixColumns = useMemo(
    () => [
      {
        id: "generalHourly",
        label: "General Hourly",
        helper: "Fallback hourly rate",
        bucketId: "generalHourly",
        bucketLabel: "General",
        bucketHelper: "Fallback rates",
        bucketSortOrder: -1,
        workTypeId: "",
        defaultPayBasis: "technicianHourly",
        defaultRateType: "hourly",
        isGeneralHourly: true,
      },
      ...activeCompanyWorkTypes
        .map((workType) => {
          const bucket = stopPayCategoryForWorkType(workType, stopPayCategories) || stopPayCategories[0] || {};
          return {
            id: workType.id,
            label: workType.name || "Work Type",
            helper: statusLabel(workType.category || suggestedPayBasisForMatrixWorkType(workType)),
            bucketId: bucket.id || "job",
            bucketLabel: bucket.label || "Job",
            bucketHelper: bucket.helper || "",
            bucketSortOrder: Number(bucket.sortOrder ?? 0),
            workTypeId: workType.id,
            defaultPayBasis: suggestedPayBasisForMatrixWorkType(workType),
            defaultRateType: workType.defaultRateType || "flatPerStop",
            isGeneralHourly: false,
          };
        })
        .sort((a, b) =>
          Number(a.bucketSortOrder || 0) - Number(b.bucketSortOrder || 0) ||
          String(a.bucketLabel || "").localeCompare(String(b.bucketLabel || "")) ||
          String(a.label || "").localeCompare(String(b.label || ""))
        ),
    ],
    [activeCompanyWorkTypes, stopPayCategories]
  );
  const filteredRateMatrixRows = useMemo(
    () =>
      rateMatrixTechnicianFilterIds.length === 0
        ? rateMatrixRows
        : rateMatrixRows.filter((worker) => rateMatrixTechnicianFilterIds.includes(worker.matrixTechnicianId)),
    [rateMatrixRows, rateMatrixTechnicianFilterIds]
  );
  const filteredRateMatrixColumns = useMemo(
    () =>
      rateMatrixWorkTypeFilterIds.length === 0
        ? rateMatrixColumns
        : rateMatrixColumns.filter((column) => rateMatrixWorkTypeFilterIds.includes(column.id)),
    [rateMatrixColumns, rateMatrixWorkTypeFilterIds]
  );
  const filteredRateMatrixColumnGroups = useMemo(() => {
    const groups = [];
    const groupsById = new Map();

    filteredRateMatrixColumns.forEach((column) => {
      const bucketId = column.bucketId || "uncategorized";
      const group = groupsById.get(bucketId) || {
        bucketId,
        bucketLabel: column.bucketLabel || "Bucket",
        bucketHelper: column.bucketHelper || "",
        bucketSortOrder: Number(column.bucketSortOrder || 0),
        columns: [],
      };

      group.columns.push(column);
      if (!groupsById.has(bucketId)) {
        groupsById.set(bucketId, group);
        groups.push(group);
      }
    });

    return groups;
  }, [filteredRateMatrixColumns]);
  const activeRateMatrixFilterCount = rateMatrixTechnicianFilterIds.length + rateMatrixWorkTypeFilterIds.length;

  useEffect(() => {
    const availableTechnicianIds = new Set(rateMatrixRows.map((worker) => worker.matrixTechnicianId));
    const availableWorkTypeIds = new Set(rateMatrixColumns.map((column) => column.id));
    const availableBucketIds = new Set(rateMatrixColumns.map((column) => column.bucketId || "uncategorized"));
    setRateMatrixTechnicianFilterIds((ids) => ids.filter((id) => availableTechnicianIds.has(id)));
    setRateMatrixWorkTypeFilterIds((ids) => ids.filter((id) => availableWorkTypeIds.has(id)));
    setCollapsedRateMatrixBucketIds((ids) => ids.filter((id) => availableBucketIds.has(id)));
  }, [rateMatrixRows, rateMatrixColumns]);

  useEffect(() => {
    if (!rateMatrixFullscreen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setRateMatrixFullscreen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [rateMatrixFullscreen]);

  const nextWorkTypeSortOrder = () => (companyWorkTypes.map((type) => Number(type.sortOrder || 0)).reduce((max, value) => Math.max(max, value), 0) || 0) + 10;
  const nextServiceStopTypeSortOrder = () => (activeCompanyServiceStopTypes.map((type) => Number(type.sortOrder || 0)).reduce((max, value) => Math.max(max, value), 0) || 0) + 10;

  const updateWorkTypeStopPayCategory = (categoryId) => {
    const category = stopPayCategories.find((item) => item.id === categoryId) || stopPayCategories[1];
    setWorkTypeForm((form) => ({
      ...form,
      stopPayCategoryId: category.id,
      category: category.defaultWorkCategory,
      defaultRateType: category.defaultRateType,
      iconName: form.iconName || category.defaultIconName,
    }));
  };

  const updateServiceStopTypeCategory = (categoryId) => {
    const category = stopPayCategories.find((item) => item.id === categoryId) || stopPayCategories[1];
    const allowedWorkTypeIds = new Set(
      activeCompanyWorkTypes
        .filter((type) => stopPayCategoryForWorkType(type, stopPayCategories)?.id === category.id)
        .map((type) => type.id)
    );
    setServiceStopTypeForm((form) => ({
      ...form,
      categoryId: category.id,
      imageName: form.imageName || category.defaultIconName,
      defaultWorkTypeIds: (form.defaultWorkTypeIds || []).filter((id) => allowedWorkTypeIds.has(id)),
    }));
  };

  const resetWorkTypeForm = () => {
    setEditingWorkTypeId("");
    setWorkTypeForm(emptyWorkTypeForm());
  };

  const resetServiceStopTypeForm = () => {
    setEditingServiceStopTypeId("");
    setServiceStopTypeForm(emptyServiceStopTypeForm());
  };

  const openCreateWorkTypeModal = () => {
    resetWorkTypeForm();
    setStopPayModal("workType");
  };

  const openCreateServiceStopTypeModal = () => {
    resetServiceStopTypeForm();
    setStopPayModal("serviceStopType");
  };

  const closeStopPayModal = () => {
    setStopPayModal(null);
    resetWorkTypeForm();
    resetServiceStopTypeForm();
  };

  const editWorkType = (workType) => {
    const category = stopPayCategoryForWorkType(workType, stopPayCategories) || stopPayCategories[1];
    setEditingWorkTypeId(workType.id);
    setWorkTypeForm({
      name: workType.name || "",
      stopPayCategoryId: category.id,
      category: workType.category || category.defaultWorkCategory,
      iconName: workType.iconName || "",
      defaultRateType: workType.defaultRateType || category.defaultRateType,
      defaultStackBehavior: workType.defaultStackBehavior || "stackable",
    });
    setStopPayModal("workType");
  };

  const editServiceStopType = (serviceStopType) => {
    const category = stopPayCategoryForServiceStopType(serviceStopType, stopPayCategories) || stopPayCategories[1];
    setEditingServiceStopTypeId(serviceStopType.id);
    setServiceStopTypeForm({
      name: serviceStopType.name || "",
      categoryId: category.id,
      imageName: serviceStopType.imageName || serviceStopType.typeImage || "",
      defaultWorkTypeIds: Array.isArray(serviceStopType.defaultWorkTypeIds) ? serviceStopType.defaultWorkTypeIds : [],
    });
    setStopPayModal("serviceStopType");
  };

  const loadOutstandingStopsForServiceStopType = async (serviceStopType) => {
    if (!recentlySelectedCompany || !serviceStopType?.id) return [];

    const serviceStopsRef = collection(db, "companies", recentlySelectedCompany, "serviceStops");
    const lookupFields = [
      ["serviceStopTypeId", serviceStopType.id],
      ["typeId", serviceStopType.id],
      ["serviceStopTypeName", serviceStopType.name],
      ["type", serviceStopType.name],
    ].filter(([, value]) => Boolean(value));

    const snapshots = await Promise.all(
      lookupFields.map(([fieldName, value]) =>
        getDocs(query(serviceStopsRef, where(fieldName, "==", value)))
      )
    );

    const stopsById = new Map();
    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((docSnap) => {
        stopsById.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
      });
    });

    return [...stopsById.values()]
      .filter((stop) => !isServiceStopFinished(stop))
      .sort((a, b) => (dateFromValue(a.serviceDate)?.getTime() || 0) - (dateFromValue(b.serviceDate)?.getTime() || 0));
  };

  const deleteCompanyServiceStopType = async (serviceStopType) => {
    if (!recentlySelectedCompany || !serviceStopType?.id) return;

    const actionKey = `delete-service-stop-type-${serviceStopType.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const outstandingStops = await loadOutstandingStopsForServiceStopType(serviceStopType);
      const warning = outstandingStops.length > 0
        ? `There are ${outstandingStops.length} unfinished service stop(s) using "${serviceStopType.name || "this type"}". Archiving keeps historical payroll references, but new setup screens will no longer show this stop type. Archive it anyway?`
        : `Archive "${serviceStopType.name || "this service stop type"}"? Historical payroll and service stop references will stay stored.`;

      if (!window.confirm(warning)) {
        setSavingAction("");
        return;
      }

      const now = new Date();
      const payload = {
        active: false,
        isActive: false,
        status: "Archived",
        archivedAt: now,
        archivedByUserId: currentUserId,
        deletedAt: now,
        deletedByUserId: currentUserId,
        deletionMode: "company_soft_delete",
        deletionNotes: outstandingStops.length > 0
          ? `Archived with ${outstandingStops.length} unfinished service stop(s) still referencing this type.`
          : "Archived from payroll setup.",
        updatedAt: now,
        updatedByUserId: currentUserId,
      };

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyServiceStopTypes", serviceStopType.id), payload);
      setCompanyServiceStopTypes((types) =>
        types.map((type) => (type.id === serviceStopType.id ? { ...type, ...payload } : type))
      );
      if (editingServiceStopTypeId === serviceStopType.id) {
        closeStopPayModal();
      }
      setActionNotice("Service stop type archived. Historical payroll references were preserved.");
    } catch (err) {
      console.error("Error archiving service stop type:", err);
      setActionFailure("Could not archive that service stop type.");
    } finally {
      setSavingAction("");
    }
  };

  const deleteCompanyWorkType = async (workType) => {
    if (!recentlySelectedCompany || !workType?.id) return;

    const actionKey = `delete-work-type-${workType.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const mappedServiceStopTypes = companyServiceStopTypes.filter((type) =>
        Array.isArray(type.defaultWorkTypeIds) && type.defaultWorkTypeIds.includes(workType.id)
      );
      const warning = mappedServiceStopTypes.length > 0
        ? `This work type is used by ${mappedServiceStopTypes.length} service stop type mapping(s). Archiving keeps historical payroll references, removes it from new setup choices, and removes it from those mappings. Archive it anyway?`
        : `Archive "${workType.name || "this payroll work type"}"? Historical payroll references will stay stored.`;

      if (!window.confirm(warning)) {
        setSavingAction("");
        return;
      }

      const now = new Date();
      const payload = {
        active: false,
        isActive: false,
        status: "Archived",
        archivedAt: now,
        archivedByUserId: currentUserId,
        deletedAt: now,
        deletedByUserId: currentUserId,
        deletionMode: "company_soft_delete",
        deletionNotes: mappedServiceStopTypes.length > 0
          ? `Archived and removed from ${mappedServiceStopTypes.length} service stop type mapping(s).`
          : "Archived from payroll setup.",
        updatedAt: now,
        updatedByUserId: currentUserId,
      };
      const batch = writeBatch(db);

      batch.update(doc(db, "companies", recentlySelectedCompany, "companyWorkTypes", workType.id), payload);
      mappedServiceStopTypes.forEach((serviceStopType) => {
        batch.update(doc(db, "companies", recentlySelectedCompany, "companyServiceStopTypes", serviceStopType.id), {
          defaultWorkTypeIds: (serviceStopType.defaultWorkTypeIds || []).filter((id) => id !== workType.id),
          updatedAt: now,
          updatedByUserId: currentUserId,
        });
      });

      await batch.commit();
      setCompanyWorkTypes((workTypes) =>
        workTypes.map((type) => (type.id === workType.id ? { ...type, ...payload } : type))
      );
      if (mappedServiceStopTypes.length > 0) {
        const mappedServiceStopTypeIds = new Set(mappedServiceStopTypes.map((type) => type.id));
        setCompanyServiceStopTypes((types) =>
          types.map((type) =>
            mappedServiceStopTypeIds.has(type.id)
              ? {
                  ...type,
                  defaultWorkTypeIds: (type.defaultWorkTypeIds || []).filter((id) => id !== workType.id),
                  updatedAt: now,
                  updatedByUserId: currentUserId,
                }
              : type
          )
        );
      }
      if (editingWorkTypeId === workType.id) {
        closeStopPayModal();
      }
      setActionNotice("Payroll work type archived. Historical payroll references were preserved.");
    } catch (err) {
      console.error("Error archiving payroll work type:", err);
      setActionFailure("Could not archive that payroll work type.");
    } finally {
      setSavingAction("");
    }
  };

  const savePaySettings = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    const actionKey = "save-pay-settings";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const payload = {
        ...normalizePaySettingsForIos(settingsForm, recentlySelectedCompany),
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };
      await setDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main"), payload, { merge: true });
      setSettingsForm(payload);
      setActionNotice("Payroll settings saved.");
    } catch (err) {
      console.error("Error saving payroll settings:", err);
      setActionFailure("Could not save payroll settings.");
    } finally {
      setSavingAction("");
    }
  };

  const applyPaySettingsPreset = (presetName) => {
    const presetSettings = {
      production: defaultPaySettings(recentlySelectedCompany || ""),
      hourly: hourlyPaySettings(recentlySelectedCompany || ""),
      hybrid: hybridPaySettings(recentlySelectedCompany || ""),
    }[presetName];

    if (!presetSettings) return;
    setSettingsForm((form) => ({
      ...form,
      ...presetSettings,
      companyId: recentlySelectedCompany || form.companyId || "",
    }));
  };

  const saveServiceStopTypeWorkTypes = async (serviceStopTypeId, selectedIds) => {
    if (!recentlySelectedCompany || !serviceStopTypeId) return;
    const actionKey = `save-stop-type-${serviceStopTypeId}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const activeWorkTypeIds = new Set(activeCompanyWorkTypes.map((workType) => workType.id));
      const cleanIds = [...new Set((selectedIds || []).filter((id) => id && activeWorkTypeIds.has(id)))];
      const payload = {
        defaultWorkTypeIds: cleanIds,
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyServiceStopTypes", serviceStopTypeId), payload);
      setCompanyServiceStopTypes((types) =>
        types.map((type) => (type.id === serviceStopTypeId ? { ...type, ...payload } : type))
      );
      setActionNotice("Service stop type payroll mapping saved.");
    } catch (err) {
      console.error("Error saving service stop type work types:", err);
      setActionFailure("Could not save that service stop type mapping.");
    } finally {
      setSavingAction("");
    }
  };

  const createCompanyWorkType = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;

    const cleanName = workTypeForm.name.trim();
    if (!cleanName) {
      setActionFailure("Add a payroll work type name first.");
      return;
    }

    const duplicate = activeCompanyWorkTypes.some((workType) =>
      workType.id !== editingWorkTypeId &&
      String(workType.name || "").trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      setActionFailure(`A payroll work type named ${cleanName} already exists.`);
      return;
    }

    const actionKey = editingWorkTypeId ? "update-work-type" : "create-work-type";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const wasEditing = Boolean(editingWorkTypeId);
      const category = stopPayCategories.find((item) => item.id === workTypeForm.stopPayCategoryId) || stopPayCategories[1];
      const existingWorkType = companyWorkTypes.find((workType) => workType.id === editingWorkTypeId);
      const workTypeId = existingWorkType?.id || `comp_work_type_${uuidv4()}`;
      const payload = {
        id: workTypeId,
        companyId: recentlySelectedCompany,
        name: cleanName,
        category: workTypeForm.category || category.defaultWorkCategory,
        iconName: workTypeForm.iconName.trim() || category.defaultIconName,
        isActive: existingWorkType?.isActive !== false,
        status: existingWorkType?.status || "Active",
        defaultRateType: workTypeForm.defaultRateType || category.defaultRateType,
        defaultStackBehavior: workTypeForm.defaultStackBehavior || "stackable",
        sortOrder: existingWorkType?.sortOrder ?? nextWorkTypeSortOrder(),
        stopPayBucketId: category.id,
        stopPayBucketLabel: category.label,
        serviceStopCategory: category.category,
        createdAt: existingWorkType?.createdAt || new Date(),
        createdByUserId: existingWorkType?.createdByUserId || currentUserId,
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "companyWorkTypes", workTypeId), payload, { merge: true });
      setCompanyWorkTypes((workTypes) =>
        [payload, ...workTypes.filter((workType) => workType.id !== workTypeId)]
          .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")))
      );
      resetWorkTypeForm();
      setStopPayModal(null);
      setActionNotice(wasEditing ? "Payroll work type updated." : "Payroll work type created.");
    } catch (err) {
      console.error("Error saving company work type:", err);
      setActionFailure("Could not save that payroll work type.");
    } finally {
      setSavingAction("");
    }
  };

  const createCompanyServiceStopType = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;

    const cleanName = serviceStopTypeForm.name.trim();
    if (!cleanName) {
      setActionFailure("Add a service stop type name first.");
      return;
    }

    const duplicate = activeCompanyServiceStopTypes.some((type) =>
      type.id !== editingServiceStopTypeId &&
      String(type.name || "").trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      setActionFailure(`A service stop type named ${cleanName} already exists.`);
      return;
    }

    const actionKey = editingServiceStopTypeId ? "update-service-stop-type" : "create-service-stop-type";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const wasEditing = Boolean(editingServiceStopTypeId);
      const category = stopPayCategories.find((item) => item.id === serviceStopTypeForm.categoryId) || stopPayCategories[1];
      const existingServiceStopType = companyServiceStopTypes.find((type) => type.id === editingServiceStopTypeId);
      const serviceStopTypeId = existingServiceStopType?.id || `comp_ss_type_${uuidv4()}`;
      const allowedDefaultWorkTypeIds = new Set(serviceStopTypeFormWorkTypeOptions.map((workType) => workType.id));
      const payload = {
        id: serviceStopTypeId,
        companyId: recentlySelectedCompany,
        name: cleanName,
        imageName: serviceStopTypeForm.imageName.trim() || category.defaultIconName,
        isActive: existingServiceStopType?.isActive !== false,
        status: existingServiceStopType?.status || "Active",
        sortOrder: existingServiceStopType?.sortOrder ?? nextServiceStopTypeSortOrder(),
        category: category.category,
        serviceStopCategory: category.category,
        stopPayBucketId: category.id,
        stopPayBucketLabel: category.label,
        defaultWorkTypeIds: [...new Set((serviceStopTypeForm.defaultWorkTypeIds || []).filter((id) => id && allowedDefaultWorkTypeIds.has(id)))],
        createdAt: existingServiceStopType?.createdAt || new Date(),
        createdByUserId: existingServiceStopType?.createdByUserId || currentUserId,
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "companyServiceStopTypes", serviceStopTypeId), payload, { merge: true });
      setCompanyServiceStopTypes((types) =>
        [payload, ...types.filter((type) => type.id !== serviceStopTypeId)]
          .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")))
      );
      resetServiceStopTypeForm();
      setStopPayModal(null);
      setActionNotice(wasEditing ? "Service stop type updated." : "Service stop type created.");
    } catch (err) {
      console.error("Error saving company service stop type:", err);
      setActionFailure("Could not save that service stop type.");
    } finally {
      setSavingAction("");
    }
  };

  const editTechnicianRate = (rate) => {
    setEditingRateId(rate.id);
    setRateForm({
      technicianId: rate.technicianId || "",
      workTypeId: rate.workTypeId || "",
      payBasis: rate.payBasis || "serviceStop",
      rateType: rate.rateType || "flatPerStop",
      amount: String(Number(rate.amountCents || 0) / 100),
      effectiveStartDate: isoDate(dateFromValue(rate.effectiveStartDate) || new Date()),
      status: rate.status || "active",
      reason: rate.reason || "",
    });
  };

  const resetRateForm = () => {
    setEditingRateId("");
    setRateForm(emptyRateForm());
  };

  const toggleRateMatrixTechnicianFilter = (technicianId) => {
    setRateMatrixTechnicianFilterIds((ids) =>
      ids.includes(technicianId) ? ids.filter((id) => id !== technicianId) : [...ids, technicianId]
    );
  };

  const toggleRateMatrixWorkTypeFilter = (workTypeId) => {
    setRateMatrixWorkTypeFilterIds((ids) =>
      ids.includes(workTypeId) ? ids.filter((id) => id !== workTypeId) : [...ids, workTypeId]
    );
  };

  const clearRateMatrixFilters = () => {
    setRateMatrixTechnicianFilterIds([]);
    setRateMatrixWorkTypeFilterIds([]);
  };

  const toggleRateMatrixBucket = (bucketId) => {
    setCollapsedRateMatrixBucketIds((ids) =>
      ids.includes(bucketId) ? ids.filter((id) => id !== bucketId) : [...ids, bucketId]
    );
  };

  const rateForMatrixCell = (technicianId, column) => {
    const matches = technicianRates.filter((rate) => {
      if ((rate.technicianId || "") !== technicianId) return false;
      if (column.isGeneralHourly) {
        return rate.payBasis === "technicianHourly" && !rate.workTypeId;
      }
      return (rate.workTypeId || "") === column.workTypeId;
    });

    return sortedTechnicianRates(matches)[0] || null;
  };

  const matrixDraftForCell = (worker, column) => {
    const rate = rateForMatrixCell(worker.matrixTechnicianId, column);
    const effectiveStartDate = isoDate(dateFromValue(rate?.effectiveStartDate) || new Date());
    const amount = rate ? centsToInputDollars(rate.amountCents) : "";
    const isBaseTechnicianRate = worker.matrixTechnicianId === BASE_TECHNICIAN_RATE_ID;

    return {
      key: rateMatrixCellKey(worker.matrixTechnicianId, column.id),
      rateId: rate?.id || "",
      technicianId: worker.matrixTechnicianId,
      technicianName: worker.matrixName,
      isBaseTechnicianRate,
      workTypeId: column.workTypeId,
      workTypeName: column.label,
      payBasis: rate?.payBasis || column.defaultPayBasis,
      rateType: rate?.rateType || column.defaultRateType,
      amount,
      status: rate?.status || "active",
      effectiveStartDate,
      reason: rate?.reason || "",
      ratePlanId: rate?.ratePlanId || (isBaseTechnicianRate ? BASE_TECHNICIAN_RATE_PLAN_ID : "web_matrix_rate_plan"),
      createdAt: rate?.createdAt || null,
      createdByUserId: rate?.createdByUserId || "",
      originalAmountCents: Number(rate?.amountCents || 0),
      originalRateType: rate?.rateType || column.defaultRateType,
      originalStatus: rate?.status || "active",
      originalEffectiveStartDate: effectiveStartDate,
      originalReason: rate?.reason || "",
    };
  };

  const buildRateMatrixDrafts = () => {
    const drafts = {};
    rateMatrixRows.forEach((worker) => {
      rateMatrixColumns.forEach((column) => {
        const draft = matrixDraftForCell(worker, column);
        drafts[draft.key] = draft;
      });
    });
    return drafts;
  };

  const startRateMatrixEditMode = () => {
    setRateMatrixDrafts(buildRateMatrixDrafts());
    setRateMatrixEditMode(true);
    resetRateForm();
  };

  const cancelRateMatrixEditMode = () => {
    setRateMatrixEditMode(false);
    setRateMatrixDrafts({});
  };

  const updateRateMatrixDraft = (key, field, value) => {
    setRateMatrixDrafts((drafts) => ({
      ...drafts,
      [key]: {
        ...(drafts[key] || {}),
        [field]: value,
      },
    }));
  };

  const hasRateMatrixDraftChange = (draft = {}) => {
    const hasAmount = String(draft.amount || "").trim() !== "";
    if (!draft.rateId && !hasAmount) return false;
    return (
      dollarsToCents(draft.amount) !== Number(draft.originalAmountCents || 0) ||
      draft.rateType !== draft.originalRateType ||
      draft.status !== draft.originalStatus ||
      draft.effectiveStartDate !== draft.originalEffectiveStartDate ||
      String(draft.reason || "") !== String(draft.originalReason || "")
    );
  };

  const saveRateMatrix = async () => {
    if (!recentlySelectedCompany) return;

    const draftsToSave = Object.values(rateMatrixDrafts).filter(hasRateMatrixDraftChange);
    if (draftsToSave.length === 0) {
      cancelRateMatrixEditMode();
      setActionNotice("No technician rate changes to save.");
      return;
    }

    const actionKey = "save-rate-matrix";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const batch = writeBatch(db);
      const now = new Date();
      const savedRates = draftsToSave.map((draft) => {
        const rateId = draft.rateId || `comp_tech_rate_${uuidv4()}`;
        const isBaseTechnicianRate = draft.technicianId === BASE_TECHNICIAN_RATE_ID;
        const payload = {
          id: rateId,
          companyId: recentlySelectedCompany,
          technicianId: draft.technicianId,
          technicianName: draft.technicianName || null,
          payBasis: draft.payBasis || "serviceStop",
          workTypeId: draft.workTypeId || null,
          amountCents: dollarsToCents(draft.amount),
          rateType: draft.rateType || "flatPerStop",
          effectiveStartDate: new Date(`${draft.effectiveStartDate || isoDate(new Date())}T12:00:00`),
          effectiveEndDate: null,
          status: draft.status || "active",
          reason: String(draft.reason || "").trim() || null,
          ratePlanId: draft.ratePlanId || (isBaseTechnicianRate ? BASE_TECHNICIAN_RATE_PLAN_ID : "web_matrix_rate_plan"),
          isBaseTechnicianRate,
          rateTemplate: isBaseTechnicianRate ? "baseTechnicianDefaults" : null,
          createdAt: draft.createdAt || now,
          createdByUserId: draft.createdByUserId || currentUserId,
          updatedAt: now,
          updatedByUserId: currentUserId,
        };

        batch.set(doc(db, "companies", recentlySelectedCompany, "technicianRates", rateId), payload, { merge: true });
        return payload;
      });

      await batch.commit();
      setTechnicianRates((rates) => {
        const byId = new Map(rates.map((rate) => [rate.id, rate]));
        savedRates.forEach((rate) => byId.set(rate.id, { ...(byId.get(rate.id) || {}), ...rate }));
        return sortedTechnicianRates([...byId.values()]);
      });
      setRateMatrixEditMode(false);
      setRateMatrixDrafts({});
      setActionNotice(`Saved ${savedRates.length} technician rate cell${savedRates.length === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error("Error saving technician rate matrix:", err);
      setActionFailure("Could not save technician rate matrix.");
    } finally {
      setSavingAction("");
    }
  };

  const saveTechnicianRate = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;
    if (!rateForm.technicianId) {
      setActionFailure("Select a technician before saving a rate.");
      return;
    }
    if (rateForm.payBasis !== "technicianHourly" && !rateForm.workTypeId) {
      setActionFailure("Select a work type for non-hourly technician rates.");
      return;
    }

    const actionKey = "save-technician-rate";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const rateId = editingRateId || `comp_tech_rate_${uuidv4()}`;
      const isBaseTechnicianRate = rateForm.technicianId === BASE_TECHNICIAN_RATE_ID;
      const payload = {
        id: rateId,
        companyId: recentlySelectedCompany,
        technicianId: rateForm.technicianId,
        technicianName: isBaseTechnicianRate ? "Base Technician Defaults" : workerName(rateForm.technicianId),
        payBasis: rateForm.payBasis,
        workTypeId: rateForm.payBasis === "technicianHourly" ? null : rateForm.workTypeId,
        amountCents: dollarsToCents(rateForm.amount),
        rateType: rateForm.rateType,
        effectiveStartDate: new Date(`${rateForm.effectiveStartDate || isoDate(new Date())}T12:00:00`),
        effectiveEndDate: null,
        status: rateForm.status,
        reason: rateForm.reason.trim() || null,
        ratePlanId: technicianRates.find((rate) => rate.id === editingRateId)?.ratePlanId || (isBaseTechnicianRate ? BASE_TECHNICIAN_RATE_PLAN_ID : "web_manual_rate_plan"),
        isBaseTechnicianRate,
        rateTemplate: isBaseTechnicianRate ? "baseTechnicianDefaults" : null,
        createdAt: technicianRates.find((rate) => rate.id === editingRateId)?.createdAt || new Date(),
        createdByUserId: technicianRates.find((rate) => rate.id === editingRateId)?.createdByUserId || currentUserId,
        updatedAt: new Date(),
        updatedByUserId: currentUserId,
      };
      await setDoc(doc(db, "companies", recentlySelectedCompany, "technicianRates", rateId), payload, { merge: true });
      setTechnicianRates((rates) =>
        [payload, ...rates.filter((rate) => rate.id !== rateId)].sort(
          (a, b) => (dateFromValue(b.effectiveStartDate)?.getTime() || 0) - (dateFromValue(a.effectiveStartDate)?.getTime() || 0)
        )
      );
      resetRateForm();
      setActionNotice("Technician rate saved.");
    } catch (err) {
      console.error("Error saving technician rate:", err);
      setActionFailure("Could not save technician rate.");
    } finally {
      setSavingAction("");
    }
  };

  const buildApprovalPayload = () => ({
    approvedAt: new Date(),
    approvedByUserId: currentUserId,
  });

  const buildPaymentPayload = () => {
    const paidDate = paymentForm.paidDate || isoDate(new Date());
    const paymentReference = paymentForm.paymentReference.trim();
    const paidNotes = paymentForm.paidNotes.trim();

    return {
      paidAt: new Date(`${paidDate}T12:00:00`),
      paidByUserId: currentUserId,
      paymentMode: "manual",
      paymentSource: "manual",
      paymentReference: paymentReference || null,
      externalReferenceId: paymentReference || null,
      paidNotes: paidNotes || null,
    };
  };

  const showServiceStopBackfill = recentlySelectedCompany === SERVICE_STOP_BACKFILL_COMPANY_ID;
  const showServiceStopBackfillPanel = showServiceStopBackfill && (isSetupMode || activeTab === "lineItems");

  const serviceStopTypeForStop = (stop = {}) => {
    const typeId = stop.typeId || stop.serviceStopTypeId || "";
    return (
      companyServiceStopTypes.find((type) => type.id === typeId) || {
        id: typeId,
        name: stop.type || stop.serviceStopTypeName || "Service Stop",
        stopPayBucketId: stop.stopPayBucketId || stop.serviceStopBucketId || "",
        stopPayBucketLabel: stop.stopPayBucketLabel || stop.serviceStopBucketLabel || "",
        category: stop.category || stop.serviceStopCategory || "",
        serviceStopCategory: stop.serviceStopCategory || stop.category || "",
        defaultWorkTypeIds: stop.defaultWorkTypeIds || stop.serviceStopDefaultWorkTypeIds || [],
      }
    );
  };

  const workerForStop = (stop = {}) => {
    const workerId = stop.techId || stop.userId || stop.technicianId || "";
    const knownWorker = companyUsers.find((companyUser) =>
      companyUser.userId === workerId ||
      companyUser.id === workerId ||
      companyUser.docId === workerId
    );

    return knownWorker || {
      id: workerId,
      userId: workerId,
      userName: stop.tech || stop.techName || stop.userName || "Technician",
      workerType: stop.workerType || "",
    };
  };

  const shouldKeepExistingPayLine = (existingLineItem) => {
    if (!existingLineItem) return false;
    if (existingLineItem.calculationStatus === "paid" || existingLineItem.paidAt) return true;
    if (existingLineItem.calculationStatus === "voided") {
      return ["adminVoided", "duplicate"].includes(existingLineItem.voidReason);
    }
    if (settingsForm.lockPayAfterApproval && (existingLineItem.calculationStatus === "approved" || existingLineItem.approvedAt)) {
      return true;
    }
    if (!settingsForm.recalculateUnapprovedPayWhenRatesChange) {
      return ["pending", "calculated", "adjusted"].includes(existingLineItem.calculationStatus);
    }
    return false;
  };

  const buildPayLineItemPayload = ({ line, serviceStop, serviceStopType, tasks, worker, completedDate, calculatedAt }) => {
    const technicianId = worker?.userId || worker?.id || serviceStop.techId || "";
    const task = tasks.find((taskItem) => taskItem.id === line.sourceTaskId);
    const source = line.source || "serviceStop";
    const serviceStopTaskId = source === "serviceStopTask" ? line.sourceTaskId || task?.id || "" : "";
    const lineId = makePayLineItemId({
      source,
      serviceStopId: serviceStop.id,
      serviceStopTaskId,
      technicianId,
      workTypeId: line.workTypeId || "",
    });
    const category =
      stopPayCategoryForServiceStopType(serviceStopType, stopPayCategories) ||
      stopPayCategoryForServiceStopType(serviceStop, stopPayCategories);
    const title = line.title || line.workTypeName || task?.name || serviceStop.type || "Payroll Line";
    const subtitleParts = [
      serviceStop.customerName,
      serviceStopStreetAddress(serviceStop),
      serviceStop.jobName || serviceStop.jobInternalId,
    ].filter(Boolean);

    return {
      id: lineId,
      companyId: recentlySelectedCompany,
      technicianId,
      technicianName: worker?.userName || worker?.name || worker?.displayName || serviceStop.tech || "Technician",
      workerType: worker?.workerType || serviceStop.workerType || "",
      source,
      serviceStopId: serviceStop.id,
      serviceStopTaskId: serviceStopTaskId || null,
      activeRouteId: null,
      activeRouteLogId: null,
      workTypeId: line.workTypeId || null,
      workTypeName: line.workTypeName || null,
      rateId: line.rateId || null,
      rateAmountCents: Number(line.rateAmountCents || 0),
      rateType: line.rateType || "manual",
      payBasis: line.payBasis || null,
      quantity: Number(line.quantity || 0),
      quantityUnit: line.quantityUnit || "each",
      totalAmountCents: Number(line.totalAmountCents || 0),
      completedDate,
      calculatedAt,
      calculationStatus: line.calculationStatus || "calculated",
      approvedAt: null,
      approvedByUserId: null,
      paidAt: null,
      paidByUserId: null,
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      payStatementId: null,
      exportBatchId: null,
      notes: line.notes || null,
      adminReviewNotes: "Generated by payroll setup bulk finish.",
      lineNumber: null,
      lineReference: null,
      paymentReference: null,
      displayTitle: title,
      displaySubtitle: subtitleParts.join(" - "),
      customerId: serviceStop.customerId || null,
      customerName: serviceStop.customerName || null,
      serviceLocationId: serviceStop.serviceLocationId || null,
      serviceLocationAddress: serviceStopStreetAddress(serviceStop) || null,
      jobId: serviceStop.jobId || null,
      jobInternalId: serviceStop.jobInternalId || null,
      taskName: task?.name || task?.description || (source === "serviceStopTask" ? title : null),
      serviceStopTypeName: serviceStopType?.name || serviceStop.type || serviceStop.serviceStopTypeName || null,
      serviceStopCategory: category?.category || serviceStop.category || serviceStop.serviceStopCategory || null,
      generatedBySource: "payroll_setup_bulk_finish",
      generatedByUserId: currentUserId,
      updatedAt: calculatedAt,
    };
  };

  const finishUnfinishedServiceStopsForRange = async () => {
    if (!showServiceStopBackfill || !recentlySelectedCompany) return;

    const start = dateAtStartOfDay(startDate);
    const end = dateAtEndOfDay(endDate);
    if (!start || !end || start > end) {
      setActionFailure("Choose a valid service stop date range first.");
      return;
    }

    const actionKey = "finish-service-stop-range";
    setSavingAction(actionKey);
    setActionNotice();
    setBackfillResult(null);
    setBackfillProgress({
      action: "Finishing Stops",
      current: 0,
      total: 0,
      detail: "Finding unfinished service stops...",
    });

    try {
      const stopsSnap = await getDocs(
        query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("serviceDate", ">=", start),
          where("serviceDate", "<=", end)
        )
      );
      const unfinishedStops = stopsSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((stop) => !isServiceStopFinished(stop))
        .sort((a, b) => (dateFromValue(a.serviceDate)?.getTime() || 0) - (dateFromValue(b.serviceDate)?.getTime() || 0));

      if (unfinishedStops.length === 0) {
        setBackfillResult({ finishedStops: 0, generatedLines: 0, preservedLines: 0, finishedTasks: 0 });
        setBackfillProgress(null);
        setActionNotice("No unfinished service stops were found in that date range.");
        return;
      }

      const totalUnfinishedStops = unfinishedStops.length;
      setBackfillProgress({
        action: "Finishing Stops",
        current: 0,
        total: totalUnfinishedStops,
        detail: `0/${totalUnfinishedStops} service stops ready`,
      });

      const generatedLineItems = [];
      let generatedLines = 0;
      let preservedLines = 0;
      let finishedTasks = 0;

      for (let index = 0; index < unfinishedStops.length; index += 1) {
        const stop = unfinishedStops[index];
        setBackfillProgress({
          action: "Finishing Stops",
          current: index + 1,
          total: totalUnfinishedStops,
          detail: `${index + 1}/${totalUnfinishedStops} service stops being worked on`,
        });
        const tasksSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "serviceStops", stop.id, "tasks"));
        const rawTasks = tasksSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        const serviceDate = dateFromValue(stop.serviceDate) || new Date();
        const completedAt = dateFromValue(stop.endTime) || dateFromValue(stop.completedAt) || dateFromValue(stop.finishedAt) || new Date(serviceDate);
        if (completedAt.getHours() === 0 && completedAt.getMinutes() === 0 && completedAt.getSeconds() === 0) {
          completedAt.setHours(17, 0, 0, 0);
        }
        const fallbackDuration = Number(stop.estimatedDuration || stop.duration || 0);
        const startAt = dateFromValue(stop.startTime) || new Date(completedAt.getTime() - fallbackDuration * 60000);
        const duration = minutesBetween(startAt, completedAt) || fallbackDuration;
        const worker = workerForStop(stop);
        const finishedTasksForStop = rawTasks.map((task) => ({
          ...task,
          status: isFinishedStatus(task.status) ? task.status : "Finished",
          workerId: task.workerId || worker.userId || stop.techId || "",
          workerName: task.workerName || worker.userName || worker.name || stop.tech || "",
          completedAt: dateFromValue(task.completedAt) || completedAt,
          updatedAt: completedAt,
        }));
        const newlyFinishedTasks = finishedTasksForStop.filter((task) => {
          const original = rawTasks.find((item) => item.id === task.id);
          return original && !isFinishedStatus(original.status);
        });

        const finishedStop = {
          ...stop,
          companyId: recentlySelectedCompany,
          operationStatus: "Finished",
          startTime: startAt,
          endTime: completedAt,
          finishedAt: completedAt,
          completedAt,
          completedDate: completedAt,
          duration,
          manuallyFinished: true,
          manualFinishSource: "payroll_setup_bulk_finish",
          completedWithoutCustomerEmail: true,
          updatedAt: completedAt,
        };
        const serviceStopType = serviceStopTypeForStop(finishedStop);
        const payLines = estimateServiceStopPay({
          companyId: recentlySelectedCompany,
          settings: settingsForm,
          serviceStop: finishedStop,
          serviceStopType,
          tasks: finishedTasksForStop,
          worker,
          workTypes: companyWorkTypes,
          mappings: workTypeMappings,
          rates: technicianRates,
          date: serviceDate,
        });

        const existingPaySnap = await getDocs(
          query(
            collection(db, "companies", recentlySelectedCompany, "technicianPayLineItems"),
            where("serviceStopId", "==", stop.id)
          )
        );
        const existingPayById = new Map(
          existingPaySnap.docs.map((docSnap) => [docSnap.id, { id: docSnap.id, ...docSnap.data() }])
        );
        const batch = writeBatch(db);

        batch.update(doc(db, "companies", recentlySelectedCompany, "serviceStops", stop.id), {
          operationStatus: "Finished",
          startTime: startAt,
          endTime: completedAt,
          finishedAt: completedAt,
          completedAt,
          completedDate: completedAt,
          duration,
          manuallyFinished: true,
          manualFinishSource: "payroll_setup_bulk_finish",
          completedWithoutCustomerEmail: true,
          updatedAt: completedAt,
        });

        newlyFinishedTasks.forEach((task) => {
          batch.update(doc(db, "companies", recentlySelectedCompany, "serviceStops", stop.id, "tasks", task.id), {
            status: "Finished",
            workerId: task.workerId,
            workerName: task.workerName,
            completedAt,
            updatedAt: completedAt,
          });
        });

        for (const line of payLines) {
          const payload = buildPayLineItemPayload({
            line,
            serviceStop: finishedStop,
            serviceStopType,
            tasks: finishedTasksForStop,
            worker,
            completedDate: serviceDate,
            calculatedAt: new Date(),
          });
          const existingLine = existingPayById.get(payload.id);
          if (shouldKeepExistingPayLine(existingLine)) {
            preservedLines += 1;
            return;
          }

          batch.set(
            doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", payload.id),
            payload,
            { merge: true }
          );
          generatedLineItems.push(payload);
          generatedLines += 1;
        }

        await batch.commit();
        finishedTasks += newlyFinishedTasks.length;
      }

      if (generatedLineItems.length) {
        const generatedIds = new Set(generatedLineItems.map((item) => item.id));
        setLineItems((items) =>
          [...generatedLineItems, ...items.filter((item) => !generatedIds.has(item.id))]
            .sort((a, b) => (dateFromValue(b.completedDate)?.getTime() || 0) - (dateFromValue(a.completedDate)?.getTime() || 0))
        );
      }

      const result = {
        finishedStops: unfinishedStops.length,
        generatedLines,
        preservedLines,
        finishedTasks,
      };
      setBackfillProgress({
        action: "Finishing Stops",
        current: totalUnfinishedStops,
        total: totalUnfinishedStops,
        detail: "Refreshing payroll line items...",
      });
      setBackfillResult(result);
      setActionNotice(
        `Finished ${result.finishedStops} service stop(s), finished ${result.finishedTasks} task(s), and generated ${result.generatedLines} payroll line item(s).`
      );
    } catch (err) {
      console.error("Error finishing service stops for payroll:", err);
      setActionFailure(err.message || "Could not finish service stops for that date range.");
    } finally {
      setSavingAction("");
      setBackfillProgress(null);
    }
  };

  const createStatementForGroup = async (group) => {
    if (!recentlySelectedCompany || !group?.lineItems?.length) return;
    const actionKey = `create-statement-${group.technicianId}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const createdStatement = await runTransaction(db, async (transaction) => {
        const now = new Date();
        const settingsRef = doc(db, "companies", recentlySelectedCompany, "settings", "payStatements");
        const settingsSnap = await transaction.get(settingsRef);
        const currentIncrement = settingsSnap.exists() ? Number(settingsSnap.data()?.increment || 0) : 0;
        const statementNumber = currentIncrement + 1;
        const statementId = `comp_pay_stmt_${uuidv4()}`;
        const lineItemIds = group.lineItems.map((item) => item.id);
        const statementPayload = {
          id: statementId,
          companyId: recentlySelectedCompany,
          technicianId: group.technicianId,
          technicianName: group.technicianName,
          workerType: group.workerType || "notAssigned",
          startDate: new Date(`${startDate}T00:00:00`),
          endDate: new Date(`${endDate}T23:59:59`),
          lineItemIds,
          subtotalCents: group.subtotalCents,
          adjustmentCents: 0,
          totalCents: group.subtotalCents,
          status: "draft",
          createdAt: now,
          createdByUserId: currentUserId,
          approvedAt: null,
          approvedByUserId: null,
          paidAt: null,
          paidByUserId: null,
          exportedAt: null,
          exportProvider: null,
          externalReferenceId: null,
          notes: null,
          statementNumber,
          statementReference: payStatementReference(statementNumber),
          paymentReference: null,
          paidNotes: null,
        };

        transaction.set(settingsRef, { category: "payStatements", increment: statementNumber }, { merge: true });
        transaction.set(
          doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statementId),
          statementPayload
        );
        lineItemIds.forEach((id) => {
          transaction.update(doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id), {
            payStatementId: statementId,
          });
        });

        return statementPayload;
      });

      setStatements((items) =>
        [createdStatement, ...items.filter((statement) => statement.id !== createdStatement.id)].sort(
          (a, b) => (dateFromValue(b.startDate)?.getTime() || 0) - (dateFromValue(a.startDate)?.getTime() || 0)
        )
      );
      setLineItems((items) =>
        items.map((item) =>
          createdStatement.lineItemIds.includes(item.id)
            ? { ...item, payStatementId: createdStatement.id }
            : item
        )
      );
      setActionNotice(`Created pay statement ${createdStatement.statementReference} for ${createdStatement.technicianName}.`);
      setDetailStatement((current) =>
        current?.type === "candidate" && current?.group?.technicianId === group.technicianId
          ? { type: "statement", statement: createdStatement }
          : current
      );
    } catch (err) {
      console.error("Error creating pay statement:", err);
      setActionFailure("Could not create that pay statement.");
    } finally {
      setSavingAction("");
    }
  };

  const createAllCandidateStatements = async () => {
    if (statementCandidateGroups.length === 0) {
      setActionFailure("There are no approved line items ready for statements.");
      return;
    }

    for (const group of statementCandidateGroups) {
      await createStatementForGroup(group);
    }
  };

  const approveAllLineItems = async () => {
    if (!recentlySelectedCompany) return;

    if (approvableLineItems.length === 0) {
      setActionFailure("There are no line items ready to approve.");
      return;
    }

    const actionKey = "approve-all-lines";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const payload = { ...buildApprovalPayload(), calculationStatus: "approved" };
      const chunkSize = 450;

      for (let index = 0; index < approvableLineItems.length; index += chunkSize) {
        const batch = writeBatch(db);
        approvableLineItems.slice(index, index + chunkSize).forEach((item) => {
          const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
          batch.update(lineRef, payload);
        });
        await batch.commit();
      }

      const approvedIds = new Set(approvableLineItems.map((item) => item.id));
      setLineItems((items) =>
        items.map((item) => (approvedIds.has(item.id) ? { ...item, ...payload } : item))
      );
      setActionNotice(`Approved ${approvableLineItems.length} payroll line item(s).`);
    } catch (err) {
      console.error("Error approving all payroll line items:", err);
      setActionFailure("Could not approve all payroll line items.");
    } finally {
      setSavingAction("");
    }
  };

  const approveLineItem = async (item) => {
    if (!recentlySelectedCompany || !item?.id) return;
    const actionKey = `approve-line-${item.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const payload = { ...buildApprovalPayload(), calculationStatus: "approved" };
      const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
      await updateDoc(lineRef, payload);
      updateLocalLineItem(item.id, payload);
      setActionNotice("Line item approved.");
    } catch (err) {
      console.error("Error approving payroll line item:", err);
      setActionFailure("Could not approve that payroll line item.");
    } finally {
      setSavingAction("");
    }
  };

  const approveStatement = async (statement) => {
    if (!recentlySelectedCompany || !statement?.id) return;
    const actionKey = `approve-statement-${statement.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const approvalPayload = buildApprovalPayload();
      const statementPayload = { ...approvalPayload, status: "approved" };
      const linePayload = { ...approvalPayload, calculationStatus: "approved" };
      const batch = writeBatch(db);
      const statementRef = doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statement.id);
      batch.update(statementRef, statementPayload);

      const eligibleLineIds = statementLineItemIds(statement).filter((id) => {
        const line = lineItems.find((item) => item.id === id);
        return !line || (line.calculationStatus !== "paid" && line.calculationStatus !== "voided");
      });

      eligibleLineIds.forEach((id) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id);
        batch.update(lineRef, linePayload);
      });

      await batch.commit();
      updateLocalStatement(statement.id, statementPayload);
      setDetailStatement((current) =>
        current?.type === "statement" && current?.statement?.id === statement.id
          ? { ...current, statement: { ...current.statement, ...statementPayload } }
          : current
      );
      setLineItems((items) =>
        items.map((item) => (eligibleLineIds.includes(item.id) ? { ...item, ...linePayload } : item))
      );
      setActionNotice("Statement approved.");
    } catch (err) {
      console.error("Error approving payroll statement:", err);
      setActionFailure("Could not approve that payroll statement.");
    } finally {
      setSavingAction("");
    }
  };

  const openPaymentModal = (targetType, target) => {
    setPaymentForm({
      ...emptyPaymentForm(),
      paymentReference: target?.paymentReference || "",
      paidNotes: target?.paidNotes || "",
    });
    setPaymentModal({ targetType, target });
    setActionNotice();
  };

  const closePaymentModal = () => {
    if (savingAction) return;
    setPaymentModal(null);
    setPaymentForm(emptyPaymentForm());
  };

  const markLineItemPaid = async (item) => {
    if (!recentlySelectedCompany || !item?.id) return;
    const actionKey = `pay-line-${item.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = item.approvedAt ? {} : buildApprovalPayload();
      const payload = {
        ...approvalPayload,
        ...paymentPayload,
        calculationStatus: "paid",
      };
      const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
      await updateDoc(lineRef, payload);
      updateLocalLineItem(item.id, payload);
      setPaymentModal(null);
      setActionNotice("Line item marked paid.");
    } catch (err) {
      console.error("Error marking payroll line item paid:", err);
      setActionFailure("Could not mark that payroll line item paid.");
    } finally {
      setSavingAction("");
    }
  };

  const markStatementPaid = async (statement) => {
    if (!recentlySelectedCompany || !statement?.id) return;
    const actionKey = `pay-statement-${statement.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = statement.approvedAt ? {} : buildApprovalPayload();
      const statementPayload = {
        ...approvalPayload,
        ...paymentPayload,
        status: "paid",
      };
      const linePaymentPayload = {
        ...paymentPayload,
        calculationStatus: "paid",
        payStatementId: statement.id,
      };
      const batch = writeBatch(db);
      const statementRef = doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statement.id);
      batch.update(statementRef, statementPayload);

      const linkedLineIds = statementLineItemIds(statement);
      linkedLineIds.forEach((id) => {
        const line = lineItems.find((item) => item.id === id);
        const lineApprovalPayload = line?.approvedAt ? {} : approvalPayload;
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id);
        batch.update(lineRef, {
          ...lineApprovalPayload,
          ...linePaymentPayload,
        });
      });

      await batch.commit();
      updateLocalStatement(statement.id, statementPayload);
      setDetailStatement((current) =>
        current?.type === "statement" && current?.statement?.id === statement.id
          ? { ...current, statement: { ...current.statement, ...statementPayload } }
          : current
      );
      setLineItems((items) =>
        items.map((item) =>
          linkedLineIds.includes(item.id)
            ? {
                ...item,
                ...(item.approvedAt ? {} : approvalPayload),
                ...linePaymentPayload,
              }
            : item
        )
      );
      setPaymentModal(null);
      setActionNotice("Statement marked paid.");
    } catch (err) {
      console.error("Error marking payroll statement paid:", err);
      setActionFailure("Could not mark that payroll statement paid.");
    } finally {
      setSavingAction("");
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!paymentModal) return;
    if (paymentModal.targetType === "statement") {
      await markStatementPaid(paymentModal.target);
    } else {
      await markLineItemPaid(paymentModal.target);
    }
  };

  const closeDetailModal = () => {
    setDetailLineItem(null);
  };

  const closeStatementDetail = () => {
    if (savingAction) return;
    setDetailStatement(null);
  };

  const renderStatementLineItemsTable = (items) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Work</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No line items found.</td>
            </tr>
          ) : items.map((item) => (
            <tr key={item.id}>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{shortDate(item.completedDate)}</td>
              <td className="px-4 py-3 text-slate-700">
                <div className="font-medium text-slate-900">{displayWorkTitle(item)}</div>
                <div className="text-xs text-slate-500">{rateTypeLabel(item)} · {Number(item.quantity || 0)} {item.quantityUnit || "each"}</div>
              </td>
              <td className="px-4 py-3 text-slate-600">{item.customerName || item.serviceLocationAddress || "-"}</td>
              <td className="whitespace-nowrap px-4 py-3"><StatusPill status={isLineItemPaid(item) ? "paid" : item.calculationStatus} /></td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(item.totalAmountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderLineItems = () => {
    if (summary.activeItems.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No payroll line items found for this date range.</div>;
    }

    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Work</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.activeItems.map((item) => {
              const isPaid = Boolean(item.paidAt) || item.calculationStatus === "paid";
              const isApproved = Boolean(item.approvedAt) || item.calculationStatus === "approved" || isPaid;
              const isVoided = item.calculationStatus === "voided";

              return (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{shortDate(item.completedDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{item.technicianName || "Worker"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="font-medium">{displayWorkTitle(item)}</div>
                    <div className="text-xs text-slate-500">{rateTypeLabel(item)} · {Number(item.quantity || 0)} {item.quantityUnit || "each"}</div>
                    {item.paymentReference ? <div className="mt-1 text-xs text-slate-500">Ref: {item.paymentReference}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.customerName || item.serviceLocationAddress || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusPill status={isPaid ? "paid" : item.calculationStatus} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(item.totalAmountCents)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailLineItem(item)}
                        className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        onClick={() => approveLineItem(item)}
                        disabled={isApproved || isVoided || savingAction === `approve-line-${item.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingAction === `approve-line-${item.id}` ? "Saving" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openPaymentModal("lineItem", item)}
                        disabled={isPaid || isVoided}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mark Paid
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderStatements = () => {
    return (
      <div className="grid gap-6">
        <section>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Ready to Create</h2>
              <p className="mt-1 text-sm text-slate-500">Approved, unpaid line items that are not already attached to a statement.</p>
            </div>
            <button
              type="button"
              onClick={createAllCandidateStatements}
              disabled={statementCandidateGroups.length === 0 || Boolean(savingAction)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAction.startsWith("create-statement") ? "Creating" : "Create All Statements"}
            </button>
          </div>

          {statementCandidateGroups.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
              No approved line items are ready for statements.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Technician</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Line Items</th>
                    <th className="px-4 py-3 text-right">Ready Total</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statementCandidateGroups.map((group) => (
                    <tr key={group.technicianId}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{group.technicianName}</div>
                        <div className="text-xs text-slate-500">{statusLabel(group.workerType)}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{shortDate(startDate)} - {shortDate(endDate)}</td>
                      <td className="px-4 py-3 text-slate-600">{group.lineItems.length} approved unpaid line item(s)</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(group.subtotalCents)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailStatement({ type: "candidate", group })}
                            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Inspect
                          </button>
                          <button
                            type="button"
                            onClick={() => createStatementForGroup(group)}
                            disabled={savingAction === `create-statement-${group.technicianId}` || Boolean(savingAction)}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {savingAction === `create-statement-${group.technicianId}` ? "Creating" : "Create"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-lg font-bold text-slate-900">Statements</h2>
            <p className="mt-1 text-sm text-slate-500">Draft, approved, and paid statements for this pay period.</p>
          </div>

          {statements.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No pay statements found for this date range.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Statement</th>
                    <th className="px-4 py-3">Technician</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Line Items</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statements.map((statement) => {
                    const isPaid = Boolean(statement.paidAt) || statement.status === "paid";
                    const isApproved = Boolean(statement.approvedAt) || statement.status === "approved" || isPaid;
                    const linkedLines = lineItemsForStatement(statement);

                    return (
                      <tr key={statement.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{statement.statementReference || "Draft Statement"}</div>
                          {statement.paymentReference ? <div className="text-xs text-slate-500">Payment ref: {statement.paymentReference}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{statement.technicianName || "Technician"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{shortDate(statement.startDate)} - {shortDate(statement.endDate)}</td>
                        <td className="whitespace-nowrap px-4 py-3"><StatusPill status={isPaid ? "paid" : statement.status} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">{linkedLines.length || statement.lineItemIds?.length || 0}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(statement.totalCents)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setDetailStatement({ type: "statement", statement })}
                              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              Inspect
                            </button>
                            <button
                              type="button"
                              onClick={() => approveStatement(statement)}
                              disabled={isApproved || savingAction === `approve-statement-${statement.id}`}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingAction === `approve-statement-${statement.id}` ? "Saving" : "Approve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => openPaymentModal("statement", statement)}
                              disabled={isPaid}
                              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Mark Paid
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderStatementDetailModal = () => {
    if (!detailStatement) return null;

    const detail = detailStatement;
    const summary = statementDetailSummary(detail);
    const isCandidate = detail.type === "candidate";
    const statement = detail.statement || {};
    const group = detail.group || {};
    const isPaid = !isCandidate && (Boolean(statement.paidAt) || statement.status === "paid");
    const isApproved = !isCandidate && (Boolean(statement.approvedAt) || statement.status === "approved" || isPaid);
    const createActionKey = `create-statement-${group.technicianId}`;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-white shadow-xl">
          <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-slate-200 bg-white p-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {isCandidate ? "Statement Preview" : "Statement Detail"}
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">{summary.title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {summary.technicianName} · {shortDate(summary.startDate)} - {shortDate(summary.endDate)}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {isCandidate ? (
                <button
                  type="button"
                  onClick={() => createStatementForGroup(group)}
                  disabled={savingAction === createActionKey || Boolean(savingAction)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === createActionKey ? "Creating" : "Create Statement"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => approveStatement(statement)}
                    disabled={isApproved || savingAction === `approve-statement-${statement.id}`}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingAction === `approve-statement-${statement.id}` ? "Saving" : "Approve Statement"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailStatement(null);
                      openPaymentModal("statement", statement);
                    }}
                    disabled={isPaid}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Mark Paid
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={closeStatementDetail}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <DetailField label="Status" value={summary.status} accent />
              <DetailField label="Line Items" value={summary.lines.length} />
              <DetailField label="Subtotal" value={moneyFromCents(summary.subtotalCents)} />
              <DetailField label="Adjustments" value={moneyFromCents(summary.adjustmentCents)} />
              <DetailField label="Total" value={moneyFromCents(summary.totalCents)} accent />
            </div>

            <div className="mt-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Line Items</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Review each payroll line before {isCandidate ? "creating" : "approving"} this statement.
                  </p>
                </div>
              </div>
              {renderStatementLineItemsTable(summary.lines)}
            </div>

            {!isCandidate ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Statement Dates</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-semibold">Created:</span> {debugDateTime(statement.createdAt)}</p>
                    <p><span className="font-semibold">Approved:</span> {debugDateTime(statement.approvedAt)}</p>
                    <p><span className="font-semibold">Paid:</span> {debugDateTime(statement.paidAt)}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Payment</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-semibold">Reference:</span> {statement.paymentReference || statement.externalReferenceId || "-"}</p>
                    <p><span className="font-semibold">Notes:</span> {statement.paidNotes || statement.notes || "-"}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <form onSubmit={savePaySettings} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Payroll Settings</h2>
          <p className="mt-1 text-sm text-slate-500">These fields mirror the iOS CompanyPaySettings document.</p>
        </div>
        <button
          type="submit"
          disabled={savingAction === "save-pay-settings"}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingAction === "save-pay-settings" ? "Saving" : "Save Settings"}
        </button>
      </div>

      <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Quick Setup</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyPaySettingsPreset("production")}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Production Pay Defaults
          </button>
          <button
            type="button"
            onClick={() => applyPaySettingsPreset("hourly")}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Hourly Pay Defaults
          </button>
          <button
            type="button"
            onClick={() => applyPaySettingsPreset("hybrid")}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Hybrid Pay Defaults
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-semibold text-slate-700">
          Pay mode
          <select
            value={settingsForm.payMode || "productionOnly"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, payMode: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {payModeOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Route pay source
          <select
            value={settingsForm.routePaySource || "serviceStopAndCompletedTasks"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, routePaySource: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {routePaySourceOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Task pay source
          <select
            value={settingsForm.taskPaySource || "technicianRateThenTaskContractedRate"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, taskPaySource: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {taskPaySourceOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Hourly pay source
          <select
            value={settingsForm.hourlyPaySource || "none"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, hourlyPaySource: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {hourlyPaySourceOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Default stacking
          <select
            value={settingsForm.defaultStackBehavior || "stackable"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, defaultStackBehavior: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {stackBehaviorOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Commercial Multi-BOW style
          <select
            value={settingsForm.commercialMultiBodyPayStyle || "basePlusAdditionalBodyRate"}
            onChange={(event) => setSettingsForm((form) => ({ ...form, commercialMultiBodyPayStyle: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {commercialMultiBodyPayStyleOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[
          ["allowMultipleWorkTypesPerStop", "Multiple work types per stop"],
          ["allowTechnicianRateOverrides", "Technician rate overrides"],
          ["allowManualPayAdjustments", "Manual pay adjustments"],
          ["payCommercialAsSeparateWorkType", "Commercial separate work type"],
          ["paySpaAsSeparateWorkType", "Spa separate work type"],
          ["payPerBodyOfWater", "Pay per body of water"],
          ["lockPayAfterApproval", "Lock after approval"],
          ["recalculateUnapprovedPayWhenRatesChange", "Recalculate unapproved pay"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={Boolean(settingsForm[key])}
              onChange={(event) => setSettingsForm((form) => ({ ...form, [key]: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>
        ))}
      </div>
    </form>
  );

  const renderSetupOverview = () => {
    const flowSteps = [
      {
        title: "Schedule Stop",
        subtitle: "Route, job, or recurring stop",
        example: "Example: weekly pool route",
      },
      {
        title: "Pick Stop Type",
        subtitle: "What kind of work is being scheduled",
        example: "Example: Weekly Route",
      },
      {
        title: "Pays As",
        subtitle: "Payroll work created from that stop",
        example: "Example: Route",
      },
      {
        title: "Technician Rate",
        subtitle: "Worker-specific pay for that work",
        example: "Example: Michael · $80",
      },
      {
        title: "Payroll Line",
        subtitle: "Review, approve, create statements, and mark paid",
        example: "Example: calculated line item",
      },
    ];

    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900">Payroll Setup Flow</h2>
            <p className="text-sm text-slate-500">One scheduled stop becomes one or more payroll lines through this path.</p>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-5">
            {flowSteps.map((step, index) => (
              <div key={step.title} className="relative rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{index + 1}</div>
                <h3 className="mt-3 text-sm font-bold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-xs text-slate-600">{step.subtitle}</p>
                <p className="mt-3 rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-700">{step.example}</p>
                {index < flowSteps.length - 1 ? (
                  <div className="absolute -right-2 top-1/2 hidden h-4 w-4 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-blue-300 lg:block" />
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setActiveTab("stopPay")}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="text-base font-bold text-slate-900">Stop Pay Setup</h3>
            <p className="mt-2 text-sm text-slate-600">Choose which payroll work types each scheduled service stop type creates.</p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rates")}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="text-base font-bold text-slate-900">Technician Rates</h3>
            <p className="mt-2 text-sm text-slate-600">Set each technician's amount for each payroll work type.</p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="text-base font-bold text-slate-900">Pay Rules</h3>
            <p className="mt-2 text-sm text-slate-600">Control approval behavior, route pay source, task pay source, and recalculation.</p>
          </button>
        </section>
      </div>
    );
  };

  const renderStopPaySetup = () => (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Stop Pay Setup</h2>
            <p className="mt-1 text-sm text-slate-500">
              Split service stop payroll by bucket, then map each stop type to payroll work.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreateServiceStopTypeModal}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700"
            >
              Create New Service Stop
            </button>
            <button
              type="button"
              onClick={openCreateWorkTypeModal}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              Create New Work Type
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {stopPayCategories.map((category) => {
          const categoryTypes = serviceStopTypesByStopPayCategory[category.id] || [];
          const categoryWorkTypes = workTypesByStopPayCategory[category.id] || [];

          return (
            <div key={category.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-1 border-b border-slate-100 pb-2.5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{category.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">{category.helper}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {categoryTypes.length} stop type{categoryTypes.length === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                      {categoryWorkTypes.length} work type{categoryWorkTypes.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <p className="truncate text-[11px] text-slate-400">Fallback source: {category.sourceId}</p>
              </div>

              <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Payroll Work Types</p>
                <div className="mt-2 grid gap-1.5">
                  {categoryWorkTypes.length === 0 ? (
                    <p className="text-xs text-slate-500">No payroll work types in this bucket.</p>
                  ) : categoryWorkTypes.map((workType) => (
                    <div key={workType.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800">{workType.name}</p>
                        <p className="truncate text-[11px] text-slate-500">{statusLabel(workType.defaultRateType)} / {statusLabel(workType.category)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => editWorkType(workType)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Service Stop Types</p>
                <div className="mt-2 grid gap-2.5">
                  {categoryTypes.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                      No service stop types are set up for this bucket yet.
                    </p>
                  ) : categoryTypes.map((type) => {
                    const selectedIds = new Set(Array.isArray(type.defaultWorkTypeIds) ? type.defaultWorkTypeIds : []);
                    const categoryWorkTypeIds = new Set(categoryWorkTypes.map((workType) => workType.id));
                    const legacySelectedWorkTypes = activeCompanyWorkTypes.filter((workType) => selectedIds.has(workType.id) && !categoryWorkTypeIds.has(workType.id));
                    const visibleWorkTypes = [...categoryWorkTypes, ...legacySelectedWorkTypes];
                    return (
                      <div key={type.id} className="rounded-md border border-slate-200 bg-white p-3">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <h4 className="truncate text-sm font-bold text-slate-900">{type.name || "Service stop type"}</h4>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {(type.category || category.category)} - {serviceStopTypeWorkTypeNames(type)}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => editServiceStopType(type)}
                              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => saveServiceStopTypeWorkTypes(type.id, [...selectedIds])}
                              disabled={savingAction === `save-stop-type-${type.id}`}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingAction === `save-stop-type-${type.id}` ? "Saving" : "Save Mapping"}
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {visibleWorkTypes.length === 0 ? (
                            <p className="text-xs text-slate-500">Create payroll work types before mapping this stop type.</p>
                          ) : visibleWorkTypes.map((workType) => {
                            const workTypeCategory = stopPayCategoryForWorkType(workType, stopPayCategories);
                            const isOutsideBucket = workTypeCategory?.id !== category.id;

                            return (
                              <label key={workType.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  defaultChecked={selectedIds.has(workType.id)}
                                  onChange={(event) => {
                                    if (event.target.checked) {
                                      selectedIds.add(workType.id);
                                    } else {
                                      selectedIds.delete(workType.id);
                                    }
                                  }}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{workType.name}</span>
                                  {isOutsideBucket ? (
                                    <span className="text-[11px] text-amber-600">Mapped from {workTypeCategory?.label || "another bucket"}</span>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const renderStopPayEditorModal = () => {
    if (!stopPayModal) return null;

    const isWorkTypeModal = stopPayModal === "workType";

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        {isWorkTypeModal ? (
          <form onSubmit={createCompanyWorkType} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{editingWorkTypeId ? "Edit Payroll Work Type" : "Create New Work Type"}</h2>
                <p className="mt-1 text-sm text-slate-500">Work types are the rows technicians get rates for.</p>
              </div>
              <button type="button" onClick={closeStopPayModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                Name
                <input
                  value={workTypeForm.name}
                  onChange={(event) => setWorkTypeForm((form) => ({ ...form, name: event.target.value }))}
                  placeholder="Job Estimate, Service Agreement Estimate..."
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Stop Bucket
                <select
                  value={workTypeForm.stopPayCategoryId}
                  onChange={(event) => updateWorkTypeStopPayCategory(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {stopPayCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Work Category
                <select
                  value={workTypeForm.category}
                  onChange={(event) => setWorkTypeForm((form) => ({ ...form, category: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {workCategoryOptions.map((category) => (
                    <option key={category} value={category}>{statusLabel(category)}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Rate Type
                <select
                  value={workTypeForm.defaultRateType}
                  onChange={(event) => setWorkTypeForm((form) => ({ ...form, defaultRateType: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {rateTypeOptions.map((option) => (
                    <option key={option} value={option}>{statusLabel(option)}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Stack
                <select
                  value={workTypeForm.defaultStackBehavior}
                  onChange={(event) => setWorkTypeForm((form) => ({ ...form, defaultStackBehavior: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {stackBehaviorOptions.map((option) => (
                    <option key={option} value={option}>{statusLabel(option)}</option>
                  ))}
                </select>
              </label>

              <IosIconPicker
                label="Icon"
                value={workTypeForm.iconName}
                onChange={(iconName) => setWorkTypeForm((form) => ({ ...form, iconName }))}
              />
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {editingWorkTypeId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const workType = companyWorkTypes.find((type) => type.id === editingWorkTypeId);
                      if (workType) deleteCompanyWorkType(workType);
                    }}
                    disabled={savingAction === `delete-work-type-${editingWorkTypeId}`}
                    className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingAction === `delete-work-type-${editingWorkTypeId}` ? "Deleting" : "Delete"}
                  </button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeStopPayModal} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={["create-work-type", "update-work-type"].includes(savingAction)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === "update-work-type" ? "Updating" : savingAction === "create-work-type" ? "Creating" : editingWorkTypeId ? "Update Work Type" : "Create Work Type"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={createCompanyServiceStopType} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{editingServiceStopTypeId ? "Edit Service Stop Type" : "Create New Service Stop"}</h2>
                <p className="mt-1 text-sm text-slate-500">Stop types point to default payroll work.</p>
              </div>
              <button type="button" onClick={closeStopPayModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                Name
                <input
                  value={serviceStopTypeForm.name}
                  onChange={(event) => setServiceStopTypeForm((form) => ({ ...form, name: event.target.value }))}
                  placeholder="Job Estimate, Courtesy Visit..."
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Stop Bucket
                <select
                  value={serviceStopTypeForm.categoryId}
                  onChange={(event) => updateServiceStopTypeCategory(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {stopPayCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>

              <IosIconPicker
                label="Icon"
                value={serviceStopTypeForm.imageName}
                onChange={(imageName) => setServiceStopTypeForm((form) => ({ ...form, imageName }))}
              />

              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                Default Payroll Work Types
                <select
                  multiple
                  value={serviceStopTypeForm.defaultWorkTypeIds}
                  onChange={(event) => {
                    const selectedIds = Array.from(event.target.selectedOptions).map((option) => option.value);
                    setServiceStopTypeForm((form) => ({ ...form, defaultWorkTypeIds: selectedIds }));
                  }}
                  className="mt-1 min-h-[8rem] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {serviceStopTypeFormWorkTypeOptions.map((workType) => (
                    <option key={workType.id} value={workType.id}>{workType.name}</option>
                  ))}
                </select>
                {serviceStopTypeFormWorkTypeOptions.length === 0 ? (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Create a payroll work type in this bucket before selecting defaults.
                  </span>
                ) : null}
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {editingServiceStopTypeId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const serviceStopType = companyServiceStopTypes.find((type) => type.id === editingServiceStopTypeId);
                      if (serviceStopType) deleteCompanyServiceStopType(serviceStopType);
                    }}
                    disabled={savingAction === `delete-service-stop-type-${editingServiceStopTypeId}`}
                    className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingAction === `delete-service-stop-type-${editingServiceStopTypeId}` ? "Deleting" : "Delete"}
                  </button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeStopPayModal} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={["create-service-stop-type", "update-service-stop-type"].includes(savingAction)}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === "update-service-stop-type" ? "Updating" : savingAction === "create-service-stop-type" ? "Creating" : editingServiceStopTypeId ? "Update Stop Type" : "Create Stop Type"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    );
  };

  const renderTechnicianRates = () => (
    <section className={rateMatrixFullscreen ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-white p-4" : "rounded-lg border border-slate-200 bg-white p-5 shadow-sm"}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Technician Rates</h2>
          <p className="mt-1 text-sm text-slate-500">
            {rateMatrixFullscreen ? "Full-screen matrix view." : "Rate amounts by technician and payroll work type."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRateMatrixFiltersOpen((isOpen) => !isOpen)}
            disabled={rateMatrixRows.length === 0 || rateMatrixColumns.length === 0}
            aria-expanded={rateMatrixFiltersOpen}
            aria-controls="rate-matrix-filters"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IoFilterOutline className="h-4 w-4" aria-hidden="true" />
            Filters
            {activeRateMatrixFilterCount > 0 ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                {activeRateMatrixFilterCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setRateMatrixFullscreen((isFullscreen) => !isFullscreen)}
            disabled={rateMatrixRows.length === 0 || rateMatrixColumns.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rateMatrixFullscreen ? (
              <IoContractOutline className="h-4 w-4" aria-hidden="true" />
            ) : (
              <IoExpandOutline className="h-4 w-4" aria-hidden="true" />
            )}
            {rateMatrixFullscreen ? "Exit Full Screen" : "Expand Matrix"}
          </button>
          {rateMatrixEditMode ? (
            <>
              <button
                type="button"
                onClick={saveRateMatrix}
                disabled={savingAction === "save-rate-matrix"}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction === "save-rate-matrix" ? "Saving" : "Save Matrix"}
              </button>
              <button
                type="button"
                onClick={cancelRateMatrixEditMode}
                disabled={savingAction === "save-rate-matrix"}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startRateMatrixEditMode}
              disabled={rateMatrixRows.length === 0 || rateMatrixColumns.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Edit Matrix
            </button>
          )}
        </div>
      </div>

      {rateMatrixFiltersOpen ? (
        <div id="rate-matrix-filters" className="mt-4 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">Matrix Filters</p>
              <p className="mt-1 text-xs text-slate-500">
                Showing {filteredRateMatrixRows.length} of {rateMatrixRows.length} rate rows and {filteredRateMatrixColumns.length} of {rateMatrixColumns.length} work types.
              </p>
            </div>
            {activeRateMatrixFilterCount > 0 ? (
              <button
                type="button"
                onClick={clearRateMatrixFilters}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Clear Filters
              </button>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Technicians</p>
              <div className="mt-2 grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
                {rateMatrixRows.map((worker) => (
                  <label key={worker.matrixTechnicianId} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={rateMatrixTechnicianFilterIds.includes(worker.matrixTechnicianId)}
                      onChange={() => toggleRateMatrixTechnicianFilter(worker.matrixTechnicianId)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="truncate">{worker.matrixName}</span>
                  </label>
                ))}
              </div>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Work Types</p>
              <div className="mt-2 grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
                {rateMatrixColumns.map((column) => (
                  <label key={column.id} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={rateMatrixWorkTypeFilterIds.includes(column.id)}
                      onChange={() => toggleRateMatrixWorkTypeFilter(column.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="truncate">{column.label}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {rateMatrixRows.length === 0 || rateMatrixColumns.length === 0 ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Add technicians and payroll work types before editing rates.
        </div>
      ) : filteredRateMatrixRows.length === 0 || filteredRateMatrixColumns.length === 0 ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          <p>No matrix cells match the current filters.</p>
          <button type="button" onClick={clearRateMatrixFilters} className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
            Clear Filters
          </button>
        </div>
      ) : (
        <div className={rateMatrixFullscreen ? "mt-5 min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200" : "mt-5 max-h-[72vh] overflow-auto rounded-lg border border-slate-200"}>
          <table className="min-w-max border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 top-0 z-40 w-56 min-w-[14rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-left align-top font-bold text-slate-800">
                  Technician
                </th>
                {filteredRateMatrixColumnGroups.map((group) => {
                  const isCollapsed = collapsedRateMatrixBucketIds.includes(group.bucketId);
                  return (
                    <th
                      key={group.bucketId}
                      colSpan={isCollapsed ? 1 : group.columns.length}
                      className="sticky top-0 z-30 h-14 border-b border-r border-blue-200 bg-blue-50 px-3 py-2 text-left align-middle"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-bold text-blue-950">{group.bucketLabel}</span>
                          <span className="mt-0.5 block truncate text-[11px] font-normal text-blue-700">
                            {group.columns.length} work type{group.columns.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleRateMatrixBucket(group.bucketId)}
                          aria-expanded={!isCollapsed}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                        >
                          {isCollapsed ? (
                            <IoChevronDownOutline className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <IoChevronUpOutline className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {isCollapsed ? "Expand" : "Collapse"}
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
              <tr>
                {filteredRateMatrixColumnGroups.map((group) => {
                  const isCollapsed = collapsedRateMatrixBucketIds.includes(group.bucketId);
                  if (isCollapsed) {
                    return (
                      <th
                        key={`${group.bucketId}-collapsed`}
                        className="sticky top-14 z-20 w-36 min-w-[9rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-left align-top"
                      >
                        <span className="block text-sm font-bold text-slate-700">{group.columns.length} hidden</span>
                        <span className="mt-1 block text-[11px] font-normal text-slate-500">Expand bucket to edit rates.</span>
                      </th>
                    );
                  }

                  return group.columns.map((column) => (
                    <th
                      key={column.id}
                      className="sticky top-14 z-20 w-52 min-w-[13rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-left align-top"
                    >
                      <span className="block text-sm font-bold text-slate-900">{column.label}</span>
                      <span className="mt-1 block text-[11px] font-normal text-slate-500">
                        {column.isGeneralHourly ? column.helper : `${statusLabel(column.defaultPayBasis)} / ${statusLabel(column.defaultRateType)}`}
                      </span>
                    </th>
                  ));
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRateMatrixRows.map((worker) => (
                <tr key={worker.matrixTechnicianId}>
                  <th className={`sticky left-0 z-10 w-56 min-w-[14rem] border-b border-r border-slate-200 px-3 py-3 text-left align-top ${worker.isRateTemplate ? "bg-amber-50" : "bg-white"}`}>
                    <span className="block text-sm font-bold text-slate-900">{worker.matrixName}</span>
                    <span className={`mt-1 block truncate text-[11px] font-normal ${worker.isRateTemplate ? "text-amber-700" : "text-slate-500"}`}>{worker.workerType || worker.role || worker.matrixTechnicianId}</span>
                  </th>
                  {filteredRateMatrixColumnGroups.map((group) => {
                    const isCollapsed = collapsedRateMatrixBucketIds.includes(group.bucketId);
                    if (isCollapsed) {
                      return (
                        <td key={`${worker.matrixTechnicianId}-${group.bucketId}-collapsed`} className="w-36 min-w-[9rem] border-b border-r border-slate-200 bg-slate-50 p-3 text-center align-middle">
                          <span className="text-xs font-semibold text-slate-400">{group.columns.length} hidden</span>
                        </td>
                      );
                    }

                    return group.columns.map((column) => {
                      const key = rateMatrixCellKey(worker.matrixTechnicianId, column.id);
                      const draft = rateMatrixDrafts[key] || matrixDraftForCell(worker, column);
                      const hasRate = Boolean(draft.rateId);
                      const hasAmount = String(draft.amount || "").trim() !== "";

                      return (
                        <td key={key} className={`w-52 min-w-[13rem] border-b border-r border-slate-200 p-2 align-top ${worker.isRateTemplate ? "bg-amber-50/50" : "bg-white"}`}>
                          {rateMatrixEditMode ? (
                            <div className="grid gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500">
                                Amount
                                <input
                                  type="number"
                                  step="0.01"
                                  value={draft.amount}
                                  onChange={(event) => updateRateMatrixDraft(key, "amount", event.target.value)}
                                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-900"
                                />
                              </label>
                              <p className="truncate text-[11px] text-slate-400">{statusLabel(draft.rateType)} / {statusLabel(draft.payBasis)}</p>
                            </div>
                          ) : hasRate || hasAmount ? (
                            <div className="space-y-1.5">
                              <p className="text-base font-bold text-slate-900">{moneyFromCents(dollarsToCents(draft.amount))}</p>
                              <p className="text-[11px] font-semibold text-slate-600">{statusLabel(draft.rateType)}</p>
                              <p className="text-[11px] text-slate-500">{statusLabel(draft.payBasis)}</p>
                              <StatusPill status={draft.status} />
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No rate</span>
                          )}
                        </td>
                      );
                    });
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!rateMatrixFullscreen ? <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-800">Advanced Rate Rows</summary>
        <div className="border-t border-slate-200 bg-white p-4">
          <form onSubmit={saveTechnicianRate} className="grid gap-4 lg:grid-cols-6">
            <label className="text-sm font-semibold text-slate-700 lg:col-span-2">
              Technician
              <select value={rateForm.technicianId} onChange={(event) => setRateForm((form) => ({ ...form, technicianId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">Select technician</option>
                <option value={BASE_TECHNICIAN_RATE_ID}>Base Technician Defaults</option>
                {companyUsers.map((worker) => <option key={worker.id} value={worker.userId || worker.id}>{worker.userName || worker.name || "Technician"}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700 lg:col-span-2">
              Work type
              <select value={rateForm.workTypeId} onChange={(event) => setRateForm((form) => ({ ...form, workTypeId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">General / hourly</option>
                {activeCompanyWorkTypes.map((workType) => <option key={workType.id} value={workType.id}>{workType.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Pay basis
              <select value={rateForm.payBasis} onChange={(event) => setRateForm((form) => ({ ...form, payBasis: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                {payBasisOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Rate type
              <select value={rateForm.rateType} onChange={(event) => setRateForm((form) => ({ ...form, rateType: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                {rateTypeOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Amount
              <input type="number" step="0.01" value={rateForm.amount} onChange={(event) => setRateForm((form) => ({ ...form, amount: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Effective
              <input type="date" value={rateForm.effectiveStartDate} onChange={(event) => setRateForm((form) => ({ ...form, effectiveStartDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Status
              <select value={rateForm.status} onChange={(event) => setRateForm((form) => ({ ...form, status: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                {rateStatusOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700 lg:col-span-3">
              Notes
              <input type="text" value={rateForm.reason} onChange={(event) => setRateForm((form) => ({ ...form, reason: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <div className="flex items-end gap-2 lg:col-span-2">
              <button type="submit" disabled={savingAction === "save-technician-rate"} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {savingAction === "save-technician-rate" ? "Saving" : editingRateId ? "Update Rate" : "Add Rate"}
              </button>
              {editingRateId ? (
                <button type="button" onClick={resetRateForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Technician</th>
                  <th className="px-4 py-3">Work Type</th>
                  <th className="px-4 py-3">Basis</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {technicianRates.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No technician rates found.</td></tr>
                ) : technicianRates.map((rate) => (
                  <tr key={rate.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{workerName(rate.technicianId)}</td>
                    <td className="px-4 py-3 text-slate-700">{workTypeName(rate.workTypeId)}</td>
                    <td className="px-4 py-3 text-slate-600">{statusLabel(rate.payBasis)}</td>
                    <td className="px-4 py-3 text-slate-700">{moneyFromCents(rate.amountCents)} / {statusLabel(rate.rateType)}</td>
                    <td className="px-4 py-3"><StatusPill status={rate.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => editTechnicianRate(rate)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details> : null}
    </section>
  );

  const tabItems = isSetupMode
    ? [
      ["overview", "Overview"],
      ["stopPay", "Stop Pay Setup"],
      ["rates", "Technician Rates"],
      ["settings", "Pay Rules"],
    ]
    : [
      ["lineItems", "Line Items"],
      ["statements", "Statements"],
    ];
  const backfillProgressPercent = backfillProgress?.total
    ? Math.max(5, Math.round((backfillProgress.current / backfillProgress.total) * 100))
    : 8;

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {isSetupMode ? "Company Settings" : "Payroll Review"}
              </p>
              <h1 className="mt-2 text-3xl font-bold text-slate-950">{isSetupMode ? "Payroll Setup" : "Payroll"}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                {isSetupMode
                  ? "Configure how scheduled work turns into technician pay."
                  : "Review payroll line items, create statements from approved pay, and mark technician pay as paid."}
              </p>
            </div>
            {isSetupMode ? (
              <Link
                to="/company/payroll"
                className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
              >
                Open Payroll
              </Link>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]">
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm" />
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm" />
                <Link
                  to="/company/settings/payroll-setup"
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Payroll Setup
                </Link>
                <button
                  type="button"
                  onClick={approveAllLineItems}
                  disabled={approvableLineItems.length === 0 || Boolean(savingAction)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === "approve-all-lines" ? "Approving" : "Approve All"}
                </button>
                <button
                  type="button"
                  onClick={createAllCandidateStatements}
                  disabled={statementCandidateGroups.length === 0 || Boolean(savingAction)}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction.startsWith("create-statement") ? "Generating" : "Generate Statements"}
                </button>
              </div>
            )}
          </div>
        </section>

        {showServiceStopBackfillPanel ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Company Service Stop Backfill</p>
                <h2 className="mt-1 text-base font-bold text-slate-950">Finish Unfinished Stops and Generate Payroll</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-700">
                  Murdock pool service only. Uses the selected service date range, skips customer emails, marks unfinished stops complete, and creates technician pay line items.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm shadow-sm" />
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm shadow-sm" />
                <button
                  type="button"
                  onClick={finishUnfinishedServiceStopsForRange}
                  disabled={savingAction === "finish-service-stop-range" || Boolean(savingAction && savingAction !== "finish-service-stop-range")}
                  className="rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === "finish-service-stop-range" ? "Finishing" : "Finish Stops"}
                </button>
              </div>
            </div>
            {backfillResult ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-amber-800">
                <span className="rounded-full bg-white px-2.5 py-1">{backfillResult.finishedStops} stop(s)</span>
                <span className="rounded-full bg-white px-2.5 py-1">{backfillResult.finishedTasks} task(s)</span>
                <span className="rounded-full bg-white px-2.5 py-1">{backfillResult.generatedLines} line item(s)</span>
                <span className="rounded-full bg-white px-2.5 py-1">{backfillResult.preservedLines} preserved</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {!isSetupMode ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Payroll total" value={moneyFromCents(summary.totalCents)} subtitle={`${summary.activeItems.length} active line item(s)`} />
            <StatCard title="Needs review" value={summary.needsReview} subtitle="Line items requiring attention" />
            <StatCard title="Approved" value={summary.approved} subtitle="Approved line items" />
            <StatCard title="Ready for statements" value={moneyFromCents(summary.statementCandidateCents)} subtitle={`${summary.statementCandidateItems.length} approved unpaid line(s)`} />
            <StatCard title="Paid" value={summary.paid} subtitle="Marked paid internally" />
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {tabItems.map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-4 py-2 text-sm font-bold transition ${
                activeTab === tab ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {actionMessage ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{actionMessage}</div> : null}
        {actionError ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</div> : null}
        {loading ? <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">Loading payroll...</div> : null}
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {!loading && !error && !isSetupMode && activeTab === "lineItems" ? renderLineItems() : null}
        {!loading && !error && !isSetupMode && activeTab === "statements" ? renderStatements() : null}
        {!loading && !error && isSetupMode && activeTab === "overview" ? renderSetupOverview() : null}
        {!loading && !error && isSetupMode && activeTab === "stopPay" ? renderStopPaySetup() : null}
        {!loading && !error && isSetupMode && activeTab === "rates" ? renderTechnicianRates() : null}
        {!loading && !error && isSetupMode && activeTab === "settings" ? renderSettings() : null}
      </div>
      {renderStopPayEditorModal()}
      {renderStatementDetailModal()}
      {backfillProgress ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-600">{backfillProgress.action}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {backfillProgress.total ? `${backfillProgress.current}/${backfillProgress.total}` : "Finding stops"}
            </p>
            <p className="mt-1 text-sm text-slate-600">{backfillProgress.detail}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Murdock pool service only</p>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-amber-600 transition-all duration-300"
                style={{ width: `${backfillProgressPercent}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
      {paymentModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={submitPayment} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Mark Paid</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {paymentModal.targetType === "statement"
                    ? paymentModal.target.statementReference || paymentModal.target.technicianName || "Pay statement"
                    : displayWorkTitle(paymentModal.target)}
                </p>
              </div>
              <button type="button" onClick={closePaymentModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-semibold text-slate-700">
                Paid date
                <input
                  type="date"
                  value={paymentForm.paidDate}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paidDate: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Reference
                <input
                  type="text"
                  value={paymentForm.paymentReference}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paymentReference: event.target.value }))}
                  placeholder="Check number, cash note, ACH ref"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Notes
                <textarea
                  value={paymentForm.paidNotes}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paidNotes: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closePaymentModal} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(savingAction)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction ? "Saving" : "Mark Paid"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {detailLineItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Payroll Line Detail</h2>
                <p className="mt-1 text-sm text-slate-500">{detailLineItem.displayTitle || detailLineItem.workTypeName || "Payroll line"}</p>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Status" value={detailLineItem.calculationStatus} accent />
                <DetailField label="Total" value={moneyFromCents(detailLineItem.totalAmountCents)} accent />
                <DetailField label="Completed" value={debugDateTime(detailLineItem.completedDate)} />
                <DetailField label="Source" value={detailLineItem.source} />
                <DetailField label="Technician" value={detailLineItem.technicianName || (detailLineItem.technicianId ? "Assigned technician" : "")} accent />
                <DetailField label="Worker Type" value={detailLineItem.workerType} />
                <DetailField label="Company" value={detailLineItem.companyName || (detailLineItem.companyId || recentlySelectedCompany ? "Selected company" : "")} />
                <DetailField label="Service Stop" value={detailLineItem.serviceStopInternalId || (detailLineItem.serviceStopId ? "Service stop" : "")} accent />
                <DetailField label="Service Stop Type" value={detailLineItem.serviceStopTypeName} />
                <DetailField label="Job" value={detailLineItem.jobInternalId || (detailLineItem.jobId ? "Job" : "")} />
                <DetailField label="Task" value={detailLineItem.displayTitle || detailLineItem.workTypeName || (detailLineItem.serviceStopTaskId || detailLineItem.taskId ? "Task" : "")} />
                <DetailField label="Work Type" value={detailLineItem.workTypeName || (detailLineItem.workTypeId ? "General" : "")} accent />
                <DetailField label="Pay Basis" value={detailLineItem.payBasis} accent />
                <DetailField label="Rate Type" value={rateTypeLabel(detailLineItem)} />
                <DetailField label="Rate Amount" value={moneyFromCents(detailLineItem.rateAmountCents)} />
                <DetailField label="Quantity" value={`${Number(detailLineItem.quantity || 0)} ${detailLineItem.quantityUnit || ""}`.trim()} />
                <DetailField label="Rate" value={rateTypeLabel(detailLineItem) || (detailLineItem.rateId || detailLineItem.technicianRateId ? "Rate" : "")} />
                <DetailField label="Pay Statement" value={detailLineItem.payStatementReference || detailLineItem.payStatementId} />
                <DetailField label="Payment Ref" value={detailLineItem.paymentReference || detailLineItem.externalReferenceId} />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Context</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-semibold">Title:</span> {detailLineItem.displayTitle || detailLineItem.workTypeName || "-"}</p>
                    <p><span className="font-semibold">Customer:</span> {detailLineItem.customerName || "-"}</p>
                    <p><span className="font-semibold">Address:</span> {detailLineItem.serviceLocationAddress || "-"}</p>
                    <p><span className="font-semibold">Created:</span> {debugDateTime(detailLineItem.createdAt)}</p>
                    <p><span className="font-semibold">Updated:</span> {debugDateTime(detailLineItem.updatedAt)}</p>
                    <p><span className="font-semibold">Approved:</span> {debugDateTime(detailLineItem.approvedAt)}</p>
                    <p><span className="font-semibold">Paid:</span> {debugDateTime(detailLineItem.paidAt)}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Debug Notes</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p><span className="font-semibold">Calculation notes:</span> {detailLineItem.calculationNotes || detailLineItem.notes || "-"}</p>
                    <p><span className="font-semibold">Void reason:</span> {detailLineItem.voidReason || "-"}</p>
                    <p><span className="font-semibold">Payment notes:</span> {detailLineItem.paidNotes || "-"}</p>
                    <p><span className="font-semibold">Raw status:</span> {detailLineItem.status || "-"}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-950 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">Raw Firestore Data</h3>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(serializeForDebug(detailLineItem), null, 2))}
                    className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    Copy JSON
                  </button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-100">
                  {JSON.stringify(serializeForDebug(detailLineItem), null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Payroll;
