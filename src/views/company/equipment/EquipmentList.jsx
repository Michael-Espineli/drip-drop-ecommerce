import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  EQUIPMENT_STATUS,
  EQUIPMENT_STATUS_OPTIONS,
  Equipment,
  displayEquipmentStatus,
  equipmentDefaultsToNeedsService,
  normalizeEquipmentStatus,
} from "../../../utils/models/Equipment";
import { addDays, addMonths, addWeeks, addYears, format } from "date-fns";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { EquipmentPart } from "../../../utils/models/EquipmentPart";
import { appAlert } from "../../../utils/appDialog";
import {
  AdjustmentsHorizontalIcon,
  BriefcaseIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import {
  filterCompanyUserAdminOptions,
  isActiveCompanyUser,
  sortCompanyUsersByName,
} from "../../../utils/companyUsers";
import {
  JOB_BILLING_STATUS,
  JOB_OPERATION_STATUS,
  normalizeJobStatus,
} from "../../../utils/jobStatusFilters";
import {
  CREATE_JOBS_PERMISSION_ID,
  CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
  SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID,
} from "../../../utils/companyPermissions";
import {
  DEFAULT_ISSUE_PRIORITY,
  DEFAULT_JOB_PLAN_TIER,
  JOB_PLAN_STATUS,
  getIssuePriorityLabel,
  getJobPlanRecommendationLabel,
  normalizeIssuePriority,
} from "../../../utils/models/JobPlan";
import {
  SalesCatalogBillingBehavior,
  SalesCatalogItemType,
  SalesCatalogSourceType,
} from "../../../utils/models/Sales";
import { canonicalJobTaskType } from "../../../utils/jobTaskTypes";
import {
  buildCustomerActiveById,
  equipmentDateIsDueThroughToday as dateIsDue,
  equipmentMatchesActiveFilter,
  equipmentNeedsMaintenance as isNeedsMaintenance,
  equipmentNeedsMaintenanceForActiveBoard,
} from "../../../utils/equipmentMaintenance";
import { normalizeAddress } from "../../../utils/customerLocationData";

const EMPTY_TOP_COUNTS = {
  all: 0,
  maintenance: 0,
  repair: 0,
  nonOperational: 0,
};

const DEFAULT_EQUIPMENT_FILTER = "maintenance";
const DEFAULT_ACTIVE_STATUS_FILTER = "active";
const ACTIVE_STATUS_FILTER_LABELS = {
  active: "Active",
  inactive: "Inactive",
  both: "Both",
};
const EQUIPMENT_FILTER_PATH_SEGMENTS = {
  all: "all-equipment",
  maintenance: "needs-maintenance",
  repair: "needs-repair",
  nonOperational: "non-operational",
};
const EQUIPMENT_FILTER_ALIASES = {
  all: "all",
  "all-equipment": "all",
  maintenance: "maintenance",
  "needs-maintenance": "maintenance",
  repair: "repair",
  "needs-repair": "repair",
  nonOperational: "nonOperational",
  "non-operational": "nonOperational",
};

const CUSTOM_CATALOG_VALUE = "__custom__";
const DEFAULT_MAINTENANCE_NAME = "Clean";
const SCHEDULE_JOB_MODAL = "scheduleJob";
const SCHEDULE_JOB_INTENTS = {
  maintenance: {
    label: "Maintenance",
    actionLabel: "Schedule Maintenance",
    jobType: "Maintenance",
    historyTitle: "Equipment maintenance scheduled",
    tone: "green",
  },
  repair: {
    label: "Repair",
    actionLabel: "Schedule Repair",
    jobType: "Repair",
    historyTitle: "Equipment repair scheduled",
    tone: "amber",
  },
};
const ACTIVE_JOB_OPERATION_STATUSES = [
  JOB_OPERATION_STATUS.draft,
  JOB_OPERATION_STATUS.scheduled,
];
const ACTIVE_JOB_BILLING_STATUSES = [
  JOB_BILLING_STATUS.draft,
  JOB_BILLING_STATUS.estimate,
  JOB_BILLING_STATUS.accepted,
  JOB_BILLING_STATUS.inProgress,
];
const TERMINAL_JOB_BILLING_STATUSES = new Set([
  normalizeJobStatus(JOB_BILLING_STATUS.invoiced),
  normalizeJobStatus(JOB_BILLING_STATUS.paid),
  normalizeJobStatus(JOB_BILLING_STATUS.comped),
  normalizeJobStatus(JOB_BILLING_STATUS.customerResolved),
  normalizeJobStatus(JOB_BILLING_STATUS.expired),
  normalizeJobStatus(JOB_BILLING_STATUS.rejected),
]);
const EQUIPMENT_TABLE_SORT_COLUMNS = [
  { field: "customerName", label: "Customer" },
  { field: "serviceAddress", label: "Service Location" },
  { field: "make", label: "Make" },
  { field: "model", label: "Model" },
  { field: "type", label: "Type" },
  { field: "nextServiceDate", label: "Next Service" },
  { field: "status", label: "Status" },
  { field: "activeJobs", label: "Active Jobs" },
  { field: "recurringServiceStops", label: "RSS" },
];
const EQUIPMENT_TABLE_COLUMN_COUNT = EQUIPMENT_TABLE_SORT_COLUMNS.length + 2;
const inputBase =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";
const modalSecondaryButton =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50";
const modalPrimaryButton =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700";

const todayDateInputValue = () => format(new Date(), "yyyy-MM-dd");

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(value || 0) || 0) / 100);

const quantityNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const toDateTimeLocalValue = (date) => {
  const value = date instanceof Date ? date : new Date();
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
};

const defaultScheduledAt = () => {
  const value = new Date();
  value.setHours(value.getHours() + 1, 0, 0, 0);
  return toDateTimeLocalValue(value);
};

const getTaskBillingLaborPriceCents = (task = {}) => {
  const explicitBillingValue =
    task.billingLaborPriceCents ??
    task.customerLaborPriceCents ??
    task.billingLaborRateCents ??
    task.laborBillingRateCents ??
    task.billableLaborCents;

  if (explicitBillingValue !== undefined && explicitBillingValue !== null && explicitBillingValue !== "") {
    const amount = Number(explicitBillingValue || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  return Number(task.contractedRate || 0);
};

const plannedMaterialTotalCostCents = (item = {}) => {
  if (item.plannedTotalCostCents !== undefined && item.plannedTotalCostCents !== null) {
    return Number(item.plannedTotalCostCents || 0);
  }

  return Math.round(Number(item.plannedUnitCostCents || item.cost || 0) * quantityNumber(item.quantity));
};

const plannedMaterialTotalPriceCents = (item = {}) => {
  if (item.plannedTotalPriceCents !== undefined && item.plannedTotalPriceCents !== null) {
    return Number(item.plannedTotalPriceCents || 0);
  }

  return Math.round(Number(item.plannedUnitPriceCents || item.price || 0) * quantityNumber(item.quantity));
};

const scheduleTemplateDetailsEmpty = () => ({
  tasks: [],
  plannedServiceStops: [],
  shoppingItems: [],
  laborLineItems: [],
});

const laborLineIdValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return value.id || value.value || value.docId || "";
};

const splitTemplateIdList = (value = "") => String(value || "")
  .split(",")
  .map((idValue) => idValue.trim())
  .filter(Boolean);

const laborLineIdArray = (value) => (
  Array.isArray(value)
    ? value.map(laborLineIdValue).filter(Boolean)
    : laborLineIdValue(value)
      ? splitTemplateIdList(laborLineIdValue(value))
      : []
);

const getLaborLineTaskIds = (line = {}) => laborLineIdArray(
  line.taskTemplateIds?.length
    ? line.taskTemplateIds
    : line.taskIds?.length
      ? line.taskIds
      : line.laborLineTaskIds
);

const getLaborLinePlannedStopIds = (line = {}) => laborLineIdArray(
  line.plannedServiceStopTemplateIds?.length
    ? line.plannedServiceStopTemplateIds
    : line.plannedServiceStopIds?.length
      ? line.plannedServiceStopIds
      : line.laborLinePlannedServiceStopIds
);

const laborLineTotalPriceCents = (line = {}) => {
  const quantity = Math.max(Number(line.quantity || line.defaultQuantity || 1) || 1, 1);
  const explicitTotal = line.totalPriceCents ?? line.totalAmountCents ?? line.amount ?? line.price;
  if (explicitTotal !== undefined && explicitTotal !== null && explicitTotal !== "") return Number(explicitTotal || 0);
  return Math.round(Number(line.unitPriceCents ?? line.unitAmountCents ?? line.rateAmountCents ?? line.rate ?? 0) * quantity);
};

const laborLineUnitPriceCents = (line = {}) => {
  const quantity = Math.max(Number(line.quantity || line.defaultQuantity || 1) || 1, 1);
  const explicitUnit = line.unitPriceCents ?? line.unitAmountCents ?? line.rateAmountCents;
  if (explicitUnit !== undefined && explicitUnit !== null && explicitUnit !== "") return Number(explicitUnit || 0);
  return quantity ? Math.round(laborLineTotalPriceCents(line) / quantity) : laborLineTotalPriceCents(line);
};

const laborLineInternalCostCents = (line = {}) => Number(
  line.internalCostCents ??
  line.internalLaborCostCents ??
  line.laborCostCents ??
  line.unitCostCents ??
  line.cost ??
  0
);

const laborLineCatalogItemId = (line = {}) => (
  line.salesCatalogItemId ||
  line.catalogItemId ||
  line.sourceCatalogItemId ||
  ""
);

const dateInputToLocalDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const dateToInputValue = (value) => {
  if (!value) return "";

  const valueDate = value instanceof Date
    ? value
    : typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

  if (Number.isNaN(valueDate.getTime())) return "";
  return format(valueDate, "yyyy-MM-dd");
};

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    {children}
  </div>
);

const ModalShell = ({ title, description = "Make a quick update without leaving the list.", children, onClose, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-950">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
          aria-label="Close"
          type="button"
        >
          x
        </button>
      </div>
      {children}
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  </div>
);

const equipmentMatchesDetailFilters = (
  equipment,
  {
    activeStatusFilter = DEFAULT_ACTIVE_STATUS_FILTER,
    customerActiveById = {},
    typeFilter = "",
    needsServiceFilter = "",
  } = {}
) => {
  if (!equipmentMatchesActiveFilter(equipment, activeStatusFilter, customerActiveById)) return false;
  if (typeFilter && equipment?.type !== typeFilter) return false;
  if (needsServiceFilter === "true") return equipment?.needsService === true;
  if (needsServiceFilter === "false") return equipment?.needsService !== true;
  return true;
};

const equipmentListRecordFromSnapshot = (equipmentDoc) => {
  const rawData = equipmentDoc.data() || {};
  const modeledEquipment = Equipment.fromFirestore(equipmentDoc);

  return {
    ...rawData,
    ...modeledEquipment,
    id: equipmentDoc.id,
    active: rawData.active ?? modeledEquipment.isActive,
    operationStatus: rawData.operationStatus || "",
    equipmentStatus: rawData.equipmentStatus || "",
    status: modeledEquipment.status || rawData.status || rawData.operationStatus || rawData.equipmentStatus || "",
  };
};

const isNeedsRepair = (eq) => normalizeEquipmentStatus(eq?.status) === "needsrepair";
const isNonOperational = (eq) => normalizeEquipmentStatus(eq?.status) === "nonoperational";

const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
  if (!lastServiceDate) return null;

  const amount = Number(serviceFrequency);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const base = new Date(lastServiceDate);
  if (Number.isNaN(base.getTime())) return null;

  if (serviceFrequencyEvery === "Day") return addDays(base, amount);
  if (serviceFrequencyEvery === "Week") return addWeeks(base, amount);
  if (serviceFrequencyEvery === "Month") return addMonths(base, amount);
  if (serviceFrequencyEvery === "Year") return addYears(base, amount);
  return null;
};

const sortableDateMillis = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();

  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isNaN(millis) ? null : millis;
};

const companyUserDisplayName = (user = {}) =>
  user.userName || user.name || user.fullName || user.displayName || user.email || "";

const companyUserRecordId = (user = {}) => user.userId || user.id || "";

const getCompanyUserId = (companyUser = {}) => (
  companyUser.userId || companyUser.uid || companyUser.id || ""
);

const buildCompanyUserOption = (companyUser = {}) => {
  const id = companyUser.id || companyUser.userId || companyUser.uid || "";
  const userId = getCompanyUserId(companyUser);
  const userName = companyUserDisplayName(companyUser) || "Company User";

  return {
    ...companyUser,
    id,
    userId,
    userName,
    value: userId,
    label: `${userName}${companyUser.roleName ? ` - ${companyUser.roleName}` : ""}`,
  };
};

const jobTemplateIsScheduleable = (template = {}) => (
  template.isActive !== false &&
  template.active !== false &&
  template.technicianCanAdd === true
);

const getTemplateDefaultIssuePriority = (template = {}) => normalizeIssuePriority(
  template.defaultIssuePriorityLevel ??
  template.issuePriorityLevel ??
  template.priorityLevel ??
  template.solutionTier ??
  DEFAULT_ISSUE_PRIORITY
);

const templateIntentMatches = (template = {}, intent = "") => {
  const searchable = `${template.name || ""} ${template.type || ""} ${template.jobType || ""} ${template.description || ""}`.toLowerCase();
  if (intent === "repair") return searchable.includes("repair");
  if (intent === "maintenance") {
    return searchable.includes("maintenance") || searchable.includes("service");
  }
  return false;
};

const formatAddressLine = (address = {}) => {
  if (typeof address === "string") return address.trim();
  if (!address || typeof address !== "object") return "";

  const normalizedAddress = normalizeAddress(address);
  const street = normalizedAddress.streetAddress || "";
  const cityStateZip = [
    normalizedAddress.city,
    normalizedAddress.state,
    normalizedAddress.zip || normalizedAddress.zipCode,
  ].filter(Boolean).join(" ");

  return [street, cityStateZip].filter(Boolean).join(", ");
};

const serviceLocationSearchValues = (serviceLocation = {}, equipment = {}) => [
  serviceLocation?.nickName,
  serviceLocation?.name,
  serviceLocation?.label,
  serviceLocation?.customerName,
  formatAddressLine(serviceLocation?.address),
  formatAddressLine(serviceLocation?.serviceLocationAddress),
  formatAddressLine(serviceLocation?.locationAddress),
  formatAddressLine(equipment?.serviceLocationAddress),
  formatAddressLine(equipment?.locationAddress),
  formatAddressLine(equipment?.address),
  equipment?.serviceLocationName,
  equipment?.locationName,
  equipment?.addressLabel,
];

const serviceLocationDisplayAddress = (serviceLocation = {}) => {
  const location = serviceLocation || {};

  return (
    formatAddressLine(location.address) ||
    formatAddressLine(location.serviceLocationAddress) ||
    formatAddressLine(location.locationAddress) ||
    formatAddressLine(location.addressLabel) ||
    location.label ||
    location.nickName ||
    ""
  );
};

const serviceLocationDisplayName = (serviceLocation = {}) => {
  const location = serviceLocation || {};

  return (
    location.nickName ||
    location.name ||
    location.label ||
    serviceLocationDisplayAddress(location) ||
    "Service Location"
  );
};

const getRecordEquipmentIds = (record = {}) => [
  record.equipmentId,
  ...(Array.isArray(record.equipmentIds) ? record.equipmentIds : []),
  ...(Array.isArray(record.companyEquipmentIds) ? record.companyEquipmentIds : []),
].filter(Boolean).map(String);

const isActiveEquipmentJob = (job = {}) => {
  const operationStatus = normalizeJobStatus(job.operationStatus || job.status);
  const billingStatus = normalizeJobStatus(job.billingStatus);

  if (operationStatus === normalizeJobStatus(JOB_OPERATION_STATUS.finished)) return false;
  return !TERMINAL_JOB_BILLING_STATUSES.has(billingStatus);
};

const isScheduledEquipmentJob = (job = {}) => (
  normalizeJobStatus(job.operationStatus || job.status) === normalizeJobStatus(JOB_OPERATION_STATUS.scheduled)
);

const getJobDateMillis = (job = {}) => sortableDateMillis(job.dateCreated || job.createdAt) || 0;

const compactEquipmentJob = (job = {}, equipmentTaskCount = 0, equipmentTaskNames = []) => ({
  id: job.id,
  internalId: job.internalId || "",
  description: job.description || "",
  type: job.type || "",
  operationStatus: job.operationStatus || job.status || "",
  billingStatus: job.billingStatus || "",
  dateMillis: getJobDateMillis(job),
  equipmentTaskCount,
  equipmentTaskNames: [...new Set(equipmentTaskNames.filter(Boolean))],
});

const addJobToEquipmentLookup = (lookup, equipmentId, job, equipmentTaskCount = 0, equipmentTaskNames = []) => {
  if (!equipmentId || !job?.id) return;

  const currentJobs = lookup[equipmentId] || [];
  const existingIndex = currentJobs.findIndex((currentJob) => currentJob.id === job.id);
  const nextJob = compactEquipmentJob(job, equipmentTaskCount, equipmentTaskNames);

  if (existingIndex >= 0) {
    const nextJobs = [...currentJobs];
    nextJobs[existingIndex] = {
      ...nextJobs[existingIndex],
      equipmentTaskCount: Math.max(nextJobs[existingIndex].equipmentTaskCount || 0, equipmentTaskCount),
      equipmentTaskNames: [
        ...new Set([
          ...(nextJobs[existingIndex].equipmentTaskNames || []),
          ...nextJob.equipmentTaskNames,
        ]),
      ],
    };
    lookup[equipmentId] = nextJobs;
    return;
  }

  lookup[equipmentId] = [...currentJobs, nextJob];
};

const getJobStatusLabel = (job = {}) => (
  [job.operationStatus, job.billingStatus].filter(Boolean).join(" / ") || "Active"
);

const isLiveRecurringEquipmentStop = (stop = {}) => {
  if (stop.active === false || stop.isActive === false) return false;

  const normalizedStatus = String(stop.status || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  if (["inactive", "cancelled", "canceled", "deleted", "ended"].includes(normalizedStatus)) return false;

  const endMillis = sortableDateMillis(stop.endDate);
  return stop.noEndDate || !endMillis || endMillis >= Date.now();
};

const compactRecurringStop = (stop = {}, equipmentTaskCount = 0, equipmentTaskNames = []) => ({
  id: stop.id,
  internalId: stop.internalId || "",
  customerName: stop.customerName || "",
  type: stop.type || "",
  frequency: stop.frequency || "",
  day: stop.day || stop.daysOfWeek || "",
  tech: stop.tech || stop.techName || stop.technicianName || stop.workerName || "",
  dateMillis: sortableDateMillis(stop.startDate || stop.dateCreated) || 0,
  equipmentTaskCount,
  equipmentTaskNames: [...new Set(equipmentTaskNames.filter(Boolean))],
});

const addRecurringStopToEquipmentLookup = (lookup, equipmentId, stop, equipmentTaskCount = 0, equipmentTaskNames = []) => {
  if (!equipmentId || !stop?.id) return;

  const currentStops = lookup[equipmentId] || [];
  const existingIndex = currentStops.findIndex((currentStop) => currentStop.id === stop.id);
  const nextStop = compactRecurringStop(stop, equipmentTaskCount, equipmentTaskNames);

  if (existingIndex >= 0) {
    const nextStops = [...currentStops];
    nextStops[existingIndex] = {
      ...nextStops[existingIndex],
      equipmentTaskCount: Math.max(nextStops[existingIndex].equipmentTaskCount || 0, equipmentTaskCount),
      equipmentTaskNames: [
        ...new Set([
          ...(nextStops[existingIndex].equipmentTaskNames || []),
          ...nextStop.equipmentTaskNames,
        ]),
      ],
    };
    lookup[equipmentId] = nextStops;
    return;
  }

  lookup[equipmentId] = [...currentStops, nextStop];
};

const sortRecurringStopLookup = (lookup = {}) => {
  Object.keys(lookup).forEach((equipmentId) => {
    lookup[equipmentId] = lookup[equipmentId].sort((a, b) => (
      String(a.day || "").localeCompare(String(b.day || "")) ||
      String(a.internalId || "").localeCompare(String(b.internalId || "")) ||
      b.dateMillis - a.dateMillis
    ));
  });

  return lookup;
};

const recurringStopDayLabel = (stop = {}) => (
  Array.isArray(stop.day)
    ? stop.day.join(", ")
    : Array.isArray(stop.daysOfWeek)
      ? stop.daysOfWeek.join(", ")
      : stop.day || stop.daysOfWeek || "No day"
);

const recurringStopFrequencyLabel = (stop = {}) => stop.frequency || "No frequency";

const recurringStopTechnicianLabel = (stop = {}) => stop.tech || "Unassigned";

const ActiveJobsCell = ({ jobs = [], loading = false }) => {
  if (loading && jobs.length === 0) {
    return <span className="text-xs text-slate-400">Checking...</span>;
  }

  if (jobs.length === 0) {
    return <span className="text-sm text-slate-400">—</span>;
  }

  const visibleJobs = jobs.slice(0, 2);
  const remainingCount = Math.max(0, jobs.length - visibleJobs.length);
  const firstJob = jobs[0] || {};
  const firstJobSummary = firstJob.equipmentTaskNames?.length
    ? firstJob.equipmentTaskNames.slice(0, 2).join(", ")
    : firstJob.description || firstJob.type || getJobStatusLabel(firstJob);

  return (
    <div className="min-w-[150px] max-w-[190px] space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800">
          {jobs.length}
        </span>
        <span className="text-xs font-semibold text-slate-600">active</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {visibleJobs.map((job) => (
          <Link
            key={job.id}
            to={`/company/jobs/detail/${job.id}`}
            title={[job.internalId || "Job", getJobStatusLabel(job)].filter(Boolean).join(" - ")}
            className="max-w-[78px] truncate rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100"
          >
            {job.internalId || "Job"}
          </Link>
        ))}
        {remainingCount > 0 && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">
            +{remainingCount}
          </span>
        )}
      </div>
      {firstJobSummary && (
        <p className="truncate text-[11px] font-medium text-slate-500" title={firstJobSummary}>
          {firstJobSummary}
        </p>
      )}
    </div>
  );
};

const RecurringStopsCell = ({ stops = [], loading = false }) => {
  if (loading && stops.length === 0) {
    return <span className="text-xs text-slate-400">Checking...</span>;
  }

  if (stops.length === 0) {
    return <span className="text-sm text-slate-400">—</span>;
  }

  const visibleStops = stops.slice(0, 2);
  const remainingCount = Math.max(0, stops.length - visibleStops.length);

  return (
    <div className="min-w-[170px] max-w-[230px] space-y-1.5">
      <div className="space-y-1">
        {visibleStops.map((stop) => (
          <Link
            key={stop.id}
            to={`/company/recurringServiceStop/details/${stop.id}`}
            title={[
              recurringStopTechnicianLabel(stop),
              recurringStopDayLabel(stop),
              recurringStopFrequencyLabel(stop),
            ].filter(Boolean).join(" - ")}
            className="block rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs transition hover:border-emerald-300 hover:bg-emerald-100"
          >
            <span className="block truncate font-bold text-emerald-800">
              {recurringStopTechnicianLabel(stop)}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-600">
              {recurringStopDayLabel(stop)} · {recurringStopFrequencyLabel(stop)}
            </span>
          </Link>
        ))}
      </div>
      {remainingCount > 0 && (
        <p className="text-[11px] font-bold text-slate-500">
          +{remainingCount} more schedule{remainingCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
};

const getEquipmentListMeta = (equipmentData = []) => ({
  types: [...new Set(equipmentData.map((item) => item.type))].filter(Boolean),
  topCounts: {
    all: equipmentData.length,
    maintenance: equipmentData.filter(isNeedsMaintenance).length,
    repair: equipmentData.filter(isNeedsRepair).length,
    nonOperational: equipmentData.filter(isNonOperational).length,
  },
});

const getQuickStatusOption = (status) => {
  const normalizedStatus = normalizeEquipmentStatus(status);
  if (!normalizedStatus) return "";
  if (normalizedStatus === "maintenance" || normalizedStatus === "needsservice") return "Needs Maintenance";
  return (
    EQUIPMENT_STATUS_OPTIONS.find(
      (statusOption) => normalizeEquipmentStatus(statusOption) === normalizedStatus
    ) || ""
  );
};

const getEquipmentFilterFromTab = (tabValue) =>
  EQUIPMENT_FILTER_ALIASES[tabValue] || DEFAULT_EQUIPMENT_FILTER;

const getEquipmentFilterPath = (filter) =>
  EQUIPMENT_FILTER_PATH_SEGMENTS[filter] || EQUIPMENT_FILTER_PATH_SEGMENTS[DEFAULT_EQUIPMENT_FILTER];

const TopFilterButton = ({ label, count, active, onClick }) => (
  <button
    onClick={onClick}
    type="button"
    className={[
      "flex items-center justify-between gap-3 w-full sm:w-auto",
      "rounded-md border px-4 py-2 text-sm font-bold shadow-sm transition",
      active
        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
    ].join(" ")}
  >
    <span>{label}</span>
    <span
      className={[
        "min-w-[34px] text-center px-2 py-0.5 rounded-full text-xs font-bold",
        active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-700",
      ].join(" ")}
    >
      {count}
    </span>
  </button>
);

const QuickActionMenuItem = ({ label, icon: Icon, tone = "black", onClick }) => {
  const toneClasses =
    tone === "amber"
      ? "text-amber-700 hover:bg-amber-50"
    : tone === "green"
        ? "text-emerald-700 hover:bg-emerald-50"
        : "text-slate-900 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition ${toneClasses}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
};

const EquipmentDetailLink = ({ equipment, children }) => (
  <Link
    to={`/company/equipment/detail/${equipment.id}`}
    className="font-semibold text-slate-900 hover:text-blue-900 hover:underline"
  >
    {children || "—"}
  </Link>
);

export default function EquipmentList() {
  const navigate = useNavigate();
  const { tab } = useParams();
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    dataBaseUser,
    currentUser,
    user,
    companyUserAccess,
  } = useContext(Context);
  const { can } = useCompanyPermissions();

  const [equipmentList, setEquipmentList] = useState([]);
  const [filteredEquipmentList, setFilteredEquipmentList] = useState([]);
  const [serviceLocationsById, setServiceLocationsById] = useState({});
  const [customerActiveById, setCustomerActiveById] = useState({});
  const [activeJobsByEquipmentId, setActiveJobsByEquipmentId] = useState({});
  const [loadingActiveJobs, setLoadingActiveJobs] = useState(false);
  const [recurringStopsByEquipmentId, setRecurringStopsByEquipmentId] = useState({});
  const [loadingRecurringStops, setLoadingRecurringStops] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savingNoteIds, setSavingNoteIds] = useState({});
  const [noteErrors, setNoteErrors] = useState({});

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // ✅ NEW: routine maintenance filter (needsService)
  // "" | "true" | "false"
  const [needsServiceFilter, setNeedsServiceFilter] = useState("");
  const [activeStatusFilter, setActiveStatusFilter] = useState(DEFAULT_ACTIVE_STATUS_FILTER);
  const [showFilterModal, setShowFilterModal] = useState(false);

  const [sortBy, setSortBy] = useState("nextServiceDate");
  const [sortOrder, setSortOrder] = useState("asc");

  const [types, setTypes] = useState([]);
  const [topCounts, setTopCounts] = useState(EMPTY_TOP_COUNTS);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [equipmentError, setEquipmentError] = useState("");

  // all | maintenance | repair | nonOperational
  const [topFilter, setTopFilter] = useState(() => getEquipmentFilterFromTab(tab));
  const [openActionMenuId, setOpenActionMenuId] = useState("");
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [activeQuickModal, setActiveQuickModal] = useState("");
  const [selectedQuickEquipment, setSelectedQuickEquipment] = useState(null);

  const [companyUsers, setCompanyUsers] = useState([]);
  const [jobTemplates, setJobTemplates] = useState([]);
  const [loadingJobTemplates, setLoadingJobTemplates] = useState(false);
  const [scheduleJobIntent, setScheduleJobIntent] = useState("maintenance");
  const [scheduleTemplateId, setScheduleTemplateId] = useState("");
  const [scheduleTemplateDetails, setScheduleTemplateDetails] = useState(scheduleTemplateDetailsEmpty);
  const [loadingScheduleTemplateDetails, setLoadingScheduleTemplateDetails] = useState(false);
  const [scheduleAdminId, setScheduleAdminId] = useState("");
  const [scheduleTechnicianId, setScheduleTechnicianId] = useState("");
  const [scheduleDateTime, setScheduleDateTime] = useState(defaultScheduledAt);
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [schedulingJob, setSchedulingJob] = useState(false);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [equipmentMakes, setEquipmentMakes] = useState([]);
  const [equipmentModels, setEquipmentModels] = useState([]);
  const [catalogTypeId, setCatalogTypeId] = useState(CUSTOM_CATALOG_VALUE);
  const [catalogMakeId, setCatalogMakeId] = useState(CUSTOM_CATALOG_VALUE);
  const [catalogEquipmentId, setCatalogEquipmentId] = useState(CUSTOM_CATALOG_VALUE);
  const [quickName, setQuickName] = useState("");
  const [quickType, setQuickType] = useState("");
  const [quickTypeId, setQuickTypeId] = useState("");
  const [quickMake, setQuickMake] = useState("");
  const [quickMakeId, setQuickMakeId] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [quickModelId, setQuickModelId] = useState("");
  const [quickUniversalEquipmentId, setQuickUniversalEquipmentId] = useState("");
  const [quickManualPdfLink, setQuickManualPdfLink] = useState("");
  const [quickNotes, setQuickNotes] = useState("");
  const [quickStatus, setQuickStatus] = useState("");
  const [quickNeedsService, setQuickNeedsService] = useState(false);
  const [quickLastServiceDate, setQuickLastServiceDate] = useState("");
  const [quickServiceFrequency, setQuickServiceFrequency] = useState("");
  const [quickServiceFrequencyEvery, setQuickServiceFrequencyEvery] = useState("");

  const [maintenanceName, setMaintenanceName] = useState(DEFAULT_MAINTENANCE_NAME);
  const [maintenanceDate, setMaintenanceDate] = useState(todayDateInputValue);
  const [maintenancePerformedBy, setMaintenancePerformedBy] = useState("Company");
  const [maintenanceCompanyUserId, setMaintenanceCompanyUserId] = useState("");
  const [maintenanceCustomerName, setMaintenanceCustomerName] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");

  const [repairName, setRepairName] = useState("");
  const [repairDate, setRepairDate] = useState(todayDateInputValue);
  const [repairPerformedBy, setRepairPerformedBy] = useState("Company");
  const [repairCompanyUserId, setRepairCompanyUserId] = useState("");
  const [repairCustomerName, setRepairCustomerName] = useState("");
  const [repairPartsReplaced, setRepairPartsReplaced] = useState([]);
  const [currentPart, setCurrentPart] = useState("");
  const [repairNotes, setRepairNotes] = useState("");

  const loggedInUser = currentUser || user || {};
  const createdByUserId = dataBaseUser?.id || loggedInUser?.uid || loggedInUser?.id || "";
  const createdByUserName =
    `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
    loggedInUser?.displayName ||
    loggedInUser?.userName ||
    "Unknown";
  const scheduleJobIntentConfig = SCHEDULE_JOB_INTENTS[scheduleJobIntent] || SCHEDULE_JOB_INTENTS.maintenance;
  const canScheduleTemplateForOthers =
    can(CREATE_JOBS_PERMISSION_ID) ||
    can(CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID);
  const canScheduleTemplateSelf =
    canScheduleTemplateForOthers ||
    can(SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID);

  const equipmentIdSignature = useMemo(() => (
    equipmentList.map((equipment) => equipment.id).filter(Boolean).sort().join("|")
  ), [equipmentList]);

  const customerIdSignature = useMemo(() => (
    [...new Set(equipmentList.map((equipment) => equipment.customerId).filter(Boolean))]
      .sort()
      .join("|")
  ), [equipmentList]);

  const serviceLocationIdSignature = useMemo(() => (
    [...new Set(equipmentList.map((equipment) => equipment.serviceLocationId).filter(Boolean))]
      .sort()
      .join("|")
  ), [equipmentList]);

  useEffect(() => {
    const nextFilter = getEquipmentFilterFromTab(tab);
    const canonicalTab = getEquipmentFilterPath(nextFilter);

    setTopFilter(nextFilter);

    if (nextFilter === "maintenance") {
      setSearchTerm("");
      setTypeFilter("");
      setNeedsServiceFilter("");
      setActiveStatusFilter(DEFAULT_ACTIVE_STATUS_FILTER);
    }

    if (tab !== canonicalTab) {
      navigate(`/company/equipment/${canonicalTab}`, { replace: true });
    }
  }, [tab, navigate]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCompanyUsers([]);
      return;
    }

    let cancelled = false;

    const fetchCompanyUsers = async () => {
      try {
        const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const snap = await getDocs(query(usersRef, orderBy("userName", "asc")));
        const data = sortCompanyUsersByName(snap.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));

        if (!cancelled) {
          setCompanyUsers(data);
          if (data.length) {
            setMaintenanceCompanyUserId((current) => current || data[0].id);
            setRepairCompanyUserId((current) => current || data[0].id);
          }
        }
      } catch (error) {
        console.error("Error loading company users:", error);
        if (!cancelled) setCompanyUsers([]);
      }
    };

    fetchCompanyUsers();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !canScheduleTemplateSelf) {
      setJobTemplates([]);
      setLoadingJobTemplates(false);
      return;
    }

    let cancelled = false;

    const fetchJobTemplates = async () => {
      try {
        setLoadingJobTemplates(true);
        const templatesSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates"));
        const templates = templatesSnap.docs.map((templateDoc) => ({
          id: templateDoc.data().id || templateDoc.id,
          ...templateDoc.data(),
        }));

        if (!cancelled) setJobTemplates(templates);
      } catch (error) {
        console.error("Error loading equipment schedule templates:", error);
        if (!cancelled) setJobTemplates([]);
      } finally {
        if (!cancelled) setLoadingJobTemplates(false);
      }
    };

    fetchJobTemplates();

    return () => {
      cancelled = true;
    };
  }, [canScheduleTemplateSelf, recentlySelectedCompany]);

  useEffect(() => {
    if (activeQuickModal !== SCHEDULE_JOB_MODAL || !recentlySelectedCompany || !scheduleTemplateId) {
      setScheduleTemplateDetails(scheduleTemplateDetailsEmpty());
      setLoadingScheduleTemplateDetails(false);
      return;
    }

    let cancelled = false;

    const fetchScheduleTemplateDetails = async () => {
      try {
        setLoadingScheduleTemplateDetails(true);
        const templateRef = doc(db, "companies", recentlySelectedCompany, "jobTemplates", scheduleTemplateId);
        const [tasksSnap, stopsSnap, shoppingSnap, laborLinesSnap] = await Promise.all([
          getDocs(collection(templateRef, "tasks")),
          getDocs(collection(templateRef, "plannedServiceStops")),
          getDocs(collection(templateRef, "shoppingItems")),
          getDocs(collection(templateRef, "laborLineItems")),
        ]);

        if (cancelled) return;

        setScheduleTemplateDetails({
          tasks: tasksSnap.docs
            .map((taskDoc) => ({ id: taskDoc.data().id || taskDoc.id, ...taskDoc.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
          plannedServiceStops: stopsSnap.docs
            .map((stopDoc) => ({ id: stopDoc.data().id || stopDoc.id, ...stopDoc.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
          shoppingItems: shoppingSnap.docs
            .map((itemDoc) => ({ id: itemDoc.data().id || itemDoc.id, ...itemDoc.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
          laborLineItems: laborLinesSnap.docs
            .map((lineDoc) => ({ id: lineDoc.data().id || lineDoc.id, ...lineDoc.data() }))
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
        });
      } catch (error) {
        console.error("Error loading equipment schedule template details:", error);
        if (!cancelled) {
          setScheduleTemplateDetails(scheduleTemplateDetailsEmpty());
          toast.error("Could not load template details.");
        }
      } finally {
        if (!cancelled) setLoadingScheduleTemplateDetails(false);
      }
    };

    fetchScheduleTemplateDetails();

    return () => {
      cancelled = true;
    };
  }, [activeQuickModal, recentlySelectedCompany, scheduleTemplateId]);

  useEffect(() => {
    setNoteDrafts((currentDrafts) => {
      const nextDrafts = {};
      equipmentList.forEach((equipment) => {
        nextDrafts[equipment.id] = currentDrafts[equipment.id] ?? equipment.notes ?? "";
      });
      return nextDrafts;
    });

    setNoteErrors((currentErrors) => {
      const nextErrors = {};
      equipmentList.forEach((equipment) => {
        if (currentErrors[equipment.id]) nextErrors[equipment.id] = currentErrors[equipment.id];
      });
      return nextErrors;
    });
  }, [equipmentList]);

  useEffect(() => {
    if (!recentlySelectedCompany || !customerIdSignature) {
      setCustomerActiveById({});
      return;
    }

    let cancelled = false;
    const customerIds = customerIdSignature.split("|").filter(Boolean);

    const fetchCustomerActiveStates = async () => {
      try {
        const customerEntries = await Promise.all(
          customerIds.map(async (customerId) => {
            const customerSnap = await getDoc(
              doc(db, "companies", recentlySelectedCompany, "customers", customerId)
            );

            if (!customerSnap.exists()) return [customerId, true];
            const customerData = customerSnap.data() || {};
            return [customerId, (customerData.active ?? customerData.isActive ?? true) !== false];
          })
        );

        if (!cancelled) {
          setCustomerActiveById(Object.fromEntries(customerEntries));
        }
      } catch (error) {
        console.error("Error loading equipment customer active states:", error);
        if (!cancelled) setCustomerActiveById({});
      }
    };

    fetchCustomerActiveStates();

    return () => {
      cancelled = true;
    };
  }, [customerIdSignature, recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !serviceLocationIdSignature) {
      setServiceLocationsById({});
      return;
    }

    let cancelled = false;
    const serviceLocationIds = serviceLocationIdSignature.split("|").filter(Boolean);

    const fetchServiceLocations = async () => {
      try {
        const locationEntries = await Promise.all(
          serviceLocationIds.map(async (serviceLocationId) => {
            const locationSnap = await getDoc(
              doc(db, "companies", recentlySelectedCompany, "serviceLocations", serviceLocationId)
            );

            return locationSnap.exists()
              ? [serviceLocationId, { id: serviceLocationId, ...locationSnap.data() }]
              : [serviceLocationId, null];
          })
        );

        if (!cancelled) {
          setServiceLocationsById(Object.fromEntries(locationEntries.filter(([, location]) => location)));
        }
      } catch (error) {
        console.error("Error loading service location addresses:", error);
        if (!cancelled) setServiceLocationsById({});
      }
    };

    fetchServiceLocations();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany, serviceLocationIdSignature]);

  useEffect(() => {
    if (!recentlySelectedCompany || !equipmentIdSignature) {
      setActiveJobsByEquipmentId({});
      setLoadingActiveJobs(false);
      return;
    }

    let cancelled = false;
    const equipmentIds = new Set(equipmentIdSignature.split("|").filter(Boolean));

    const fetchActiveJobs = async () => {
      try {
        setLoadingActiveJobs(true);

        const workOrdersRef = collection(db, "companies", recentlySelectedCompany, "workOrders");
        const [operationSnap, billingSnap] = await Promise.all([
          getDocs(query(workOrdersRef, where("operationStatus", "in", ACTIVE_JOB_OPERATION_STATUSES))),
          getDocs(query(workOrdersRef, where("billingStatus", "in", ACTIVE_JOB_BILLING_STATUSES))),
        ]);
        const activeJobsById = new Map();

        [...operationSnap.docs, ...billingSnap.docs].forEach((jobDoc) => {
          const job = { id: jobDoc.id, ref: jobDoc.ref, ...jobDoc.data() };
          if (isActiveEquipmentJob(job)) activeJobsById.set(job.id, job);
        });

        const nextLookup = {};
        const activeJobs = [...activeJobsById.values()];

        activeJobs.forEach((job) => {
          getRecordEquipmentIds(job).forEach((equipmentId) => {
            if (equipmentIds.has(equipmentId)) {
              addJobToEquipmentLookup(nextLookup, equipmentId, job);
            }
          });
        });

        await Promise.all(activeJobs.map(async (job) => {
          try {
            const taskSnap = await getDocs(collection(job.ref, "tasks"));
            const taskDetailsByEquipmentId = new Map();

            taskSnap.docs.forEach((taskDoc) => {
              const task = taskDoc.data() || {};
              getRecordEquipmentIds(task).forEach((equipmentId) => {
                if (!equipmentIds.has(equipmentId)) return;

                const current = taskDetailsByEquipmentId.get(equipmentId) || { count: 0, names: [] };
                taskDetailsByEquipmentId.set(equipmentId, {
                  count: current.count + 1,
                  names: [...current.names, task.name || task.description || task.type || ""].filter(Boolean),
                });
              });
            });

            taskDetailsByEquipmentId.forEach((taskDetails, equipmentId) => {
              addJobToEquipmentLookup(nextLookup, equipmentId, job, taskDetails.count, taskDetails.names);
            });
          } catch (error) {
            console.error("Error loading active equipment job tasks:", error);
          }
        }));

        Object.keys(nextLookup).forEach((equipmentId) => {
          nextLookup[equipmentId] = nextLookup[equipmentId].sort((a, b) => b.dateMillis - a.dateMillis);
        });

        if (!cancelled) setActiveJobsByEquipmentId(nextLookup);
      } catch (error) {
        console.error("Error loading active equipment jobs:", error);
        if (!cancelled) setActiveJobsByEquipmentId({});
      } finally {
        if (!cancelled) setLoadingActiveJobs(false);
      }
    };

    fetchActiveJobs();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany, equipmentIdSignature]);

  useEffect(() => {
    if (!recentlySelectedCompany || !equipmentIdSignature) {
      setRecurringStopsByEquipmentId({});
      setLoadingRecurringStops(false);
      return;
    }

    let cancelled = false;
    const equipmentIds = new Set(equipmentIdSignature.split("|").filter(Boolean));
    const equipmentIdsByServiceLocationId = new Map();
    const equipmentIdsByCustomerId = new Map();

    equipmentList.forEach((equipment) => {
      if (!equipment?.id) return;

      if (equipment.serviceLocationId) {
        const serviceLocationEquipmentIds = equipmentIdsByServiceLocationId.get(equipment.serviceLocationId) || [];
        equipmentIdsByServiceLocationId.set(equipment.serviceLocationId, [...serviceLocationEquipmentIds, equipment.id]);
      }

      if (equipment.customerId) {
        const customerEquipmentIds = equipmentIdsByCustomerId.get(equipment.customerId) || [];
        equipmentIdsByCustomerId.set(equipment.customerId, [...customerEquipmentIds, equipment.id]);
      }
    });

    const fetchRecurringStops = async () => {
      try {
        setLoadingRecurringStops(true);

        const stopsSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop"));
        const liveStops = stopsSnap.docs
          .map((stopDoc) => ({ id: stopDoc.id, ref: stopDoc.ref, ...stopDoc.data() }))
          .filter(isLiveRecurringEquipmentStop);
        const nextLookup = {};

        liveStops.forEach((stop) => {
          const stopEquipmentIds = new Set(
            getRecordEquipmentIds(stop).filter((equipmentId) => equipmentIds.has(equipmentId))
          );
          const stopServiceLocationId = stop.serviceLocationId || stop.locationId || "";
          const stopCustomerId = stop.customerId || "";

          if (stopServiceLocationId) {
            (equipmentIdsByServiceLocationId.get(stopServiceLocationId) || []).forEach((equipmentId) => {
              stopEquipmentIds.add(equipmentId);
            });
          } else if (stopCustomerId) {
            (equipmentIdsByCustomerId.get(stopCustomerId) || []).forEach((equipmentId) => {
              stopEquipmentIds.add(equipmentId);
            });
          }

          stopEquipmentIds.forEach((equipmentId) => {
            addRecurringStopToEquipmentLookup(nextLookup, equipmentId, stop);
          });
        });

        await Promise.all(liveStops.map(async (stop) => {
          try {
            const taskSnap = await getDocs(collection(stop.ref, "tasks"));
            const taskDetailsByEquipmentId = new Map();

            taskSnap.docs.forEach((taskDoc) => {
              const task = taskDoc.data() || {};
              getRecordEquipmentIds(task).forEach((equipmentId) => {
                if (!equipmentIds.has(equipmentId)) return;

                const current = taskDetailsByEquipmentId.get(equipmentId) || { count: 0, names: [] };
                taskDetailsByEquipmentId.set(equipmentId, {
                  count: current.count + 1,
                  names: [...current.names, task.name || task.description || task.type || ""].filter(Boolean),
                });
              });
            });

            taskDetailsByEquipmentId.forEach((taskDetails, equipmentId) => {
              addRecurringStopToEquipmentLookup(nextLookup, equipmentId, stop, taskDetails.count, taskDetails.names);
            });
          } catch (error) {
            console.error("Error loading equipment recurring stop tasks:", error);
          }
        }));

        sortRecurringStopLookup(nextLookup);

        if (!cancelled) setRecurringStopsByEquipmentId(nextLookup);
      } catch (error) {
        console.error("Error loading equipment recurring stops:", error);
        if (!cancelled) setRecurringStopsByEquipmentId({});
      } finally {
        if (!cancelled) setLoadingRecurringStops(false);
      }
    };

    fetchRecurringStops();

    return () => {
      cancelled = true;
    };
  }, [equipmentIdSignature, equipmentList, recentlySelectedCompany]);

  useEffect(() => {
    let cancelled = false;

    const fetchEquipmentTypes = async () => {
      try {
        const typesSnap = await getDocs(
          query(collection(db, "universal", "equipment", "equipmentTypes"), orderBy("name", "asc"))
        );
        if (!cancelled) {
          setEquipmentTypes(typesSnap.docs.map((typeDoc) => ({ id: typeDoc.id, ...typeDoc.data() })));
        }
      } catch (error) {
        console.error("Error loading universal equipment types:", error);
        if (!cancelled) setEquipmentTypes([]);
      }
    };

    fetchEquipmentTypes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalogTypeId || catalogTypeId === CUSTOM_CATALOG_VALUE) {
      setEquipmentMakes([]);
      return;
    }

    let cancelled = false;

    const fetchEquipmentMakes = async () => {
      try {
        const makesSnap = await getDocs(
          query(
            collection(db, "universal", "equipment", "equipmentMakes"),
            where("types", "array-contains", catalogTypeId)
          )
        );
        if (!cancelled) {
          setEquipmentMakes(makesSnap.docs.map((makeDoc) => ({ id: makeDoc.id, ...makeDoc.data() })));
        }
      } catch (error) {
        console.error("Error loading universal equipment makes:", error);
        if (!cancelled) setEquipmentMakes([]);
      }
    };

    fetchEquipmentMakes();

    return () => {
      cancelled = true;
    };
  }, [catalogTypeId]);

  useEffect(() => {
    if (
      !catalogTypeId ||
      catalogTypeId === CUSTOM_CATALOG_VALUE ||
      !catalogMakeId ||
      catalogMakeId === CUSTOM_CATALOG_VALUE
    ) {
      setEquipmentModels([]);
      return;
    }

    let cancelled = false;

    const fetchEquipmentModels = async () => {
      try {
        const modelsSnap = await getDocs(
          query(
            collection(db, "universal", "equipment", "equipment"),
            where("typeId", "==", catalogTypeId),
            where("makeId", "==", catalogMakeId)
          )
        );
        if (!cancelled) {
          setEquipmentModels(modelsSnap.docs.map((modelDoc) => ({ id: modelDoc.id, ...modelDoc.data() })));
        }
      } catch (error) {
        console.error("Error loading universal equipment models:", error);
        if (!cancelled) setEquipmentModels([]);
      }
    };

    fetchEquipmentModels();

    return () => {
      cancelled = true;
    };
  }, [catalogMakeId, catalogTypeId]);

  useEffect(() => {
    let cancelled = false;

    const fetchEquipment = async () => {
      if (!recentlySelectedCompany) {
        setEquipmentList([]);
        setTypes([]);
        setTopCounts(EMPTY_TOP_COUNTS);
        setEquipmentError("");
        setLoadingEquipment(false);
        return;
      }

      try {
        setLoadingEquipment(true);
        setEquipmentError("");

        const [equipmentSnap, customersSnap] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "equipment")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "customers")).catch((customerError) => {
            console.warn("Unable to load customers for equipment maintenance list:", customerError);
            return { docs: [] };
          }),
        ]);
        const equipmentData = equipmentSnap.docs.map(equipmentListRecordFromSnapshot);
        const nextCustomerActiveById = buildCustomerActiveById(
          customersSnap.docs.map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() }))
        );

        if (cancelled) return;

        setCustomerActiveById(nextCustomerActiveById);
        setEquipmentList(equipmentData);
      } catch (error) {
        console.error("Equipment Data Error!:", error);
        if (!cancelled) {
          setEquipmentError("Could not load equipment for the selected view.");
          setEquipmentList([]);
          setTypes([]);
          setTopCounts(EMPTY_TOP_COUNTS);
        }
      } finally {
        if (!cancelled) {
          setLoadingEquipment(false);
        }
      }
    };

    fetchEquipment();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    const { types: uniqueTypes } = getEquipmentListMeta(equipmentList);
    const countableEquipment = equipmentList.filter((equipment) => equipmentMatchesDetailFilters(equipment, {
      activeStatusFilter,
      customerActiveById,
      typeFilter,
      needsServiceFilter,
    }));
    const { topCounts: nextTopCounts } = getEquipmentListMeta(countableEquipment);
    const maintenanceBoardCount = equipmentList
      .filter((equipment) => equipmentNeedsMaintenanceForActiveBoard(equipment, customerActiveById))
      .length;

    setTypes(uniqueTypes);
    setTopCounts({
      ...nextTopCounts,
      maintenance: maintenanceBoardCount,
    });
  }, [activeStatusFilter, customerActiveById, equipmentList, needsServiceFilter, typeFilter]);

  // -----------------------------
  // ✅ Unique customer count
  // -----------------------------
  const uniqueCustomerCount = useMemo(() => {
    const ids = new Set(
      (filteredEquipmentList || [])
        .map((e) => (e?.customerId ?? "").toString().trim())
        .filter(Boolean)
    );
    return ids.size;
  }, [filteredEquipmentList]);

  const maintenanceBoardEquipment = useMemo(() => (
    equipmentList.filter((equipment) => equipmentNeedsMaintenanceForActiveBoard(equipment, customerActiveById))
  ), [customerActiveById, equipmentList]);
  const maintenanceDueCount = maintenanceBoardEquipment.length;
  const maintenanceScheduledJobSummary = useMemo(() => {
    const scheduledEquipmentIds = new Set();
    const scheduledJobIds = new Set();

    maintenanceBoardEquipment.forEach((equipment) => {
      const scheduledJobs = (activeJobsByEquipmentId[equipment?.id] || []).filter(isScheduledEquipmentJob);
      if (!scheduledJobs.length) return;

      if (equipment?.id) scheduledEquipmentIds.add(equipment.id);
      scheduledJobs.forEach((job) => scheduledJobIds.add(job.id));
    });

    return {
      equipmentCount: scheduledEquipmentIds.size,
      jobCount: scheduledJobIds.size,
    };
  }, [activeJobsByEquipmentId, maintenanceBoardEquipment]);
  const quickDefaultsToNeedsService = useMemo(() => equipmentDefaultsToNeedsService({
    name: quickName,
    type: quickType,
    make: quickMake,
    model: quickModel,
  }), [quickMake, quickModel, quickName, quickType]);
  const quickServiceIsRequired = quickNeedsService || quickDefaultsToNeedsService;
  const quickNextMaintenanceDate = useMemo(() => {
    if (!quickServiceIsRequired) return null;

    return computeNextServiceDate(
      dateInputToLocalDate(quickLastServiceDate),
      quickServiceFrequency,
      quickServiceFrequencyEvery
    );
  }, [quickLastServiceDate, quickServiceFrequency, quickServiceFrequencyEvery, quickServiceIsRequired]);

  const companyUserOptions = useMemo(() => (
    companyUsers
      .filter(isActiveCompanyUser)
      .map(buildCompanyUserOption)
      .filter((companyUser) => companyUser.userId)
  ), [companyUsers]);

  const currentCompanyUser = useMemo(() => {
    const accessCompanyUserId = companyUserAccess?.companyUserId || companyUserAccess?.companyUserDocId || "";
    const accessUserId = companyUserAccess?.userId || loggedInUser?.uid || dataBaseUser?.id || "";

    return companyUserOptions.find((companyUser) => (
      companyUser.id === accessCompanyUserId ||
      companyUser.userId === accessUserId ||
      companyUser.id === accessUserId ||
      companyUser.userId === createdByUserId ||
      companyUser.id === createdByUserId
    )) || null;
  }, [companyUserAccess, companyUserOptions, createdByUserId, dataBaseUser?.id, loggedInUser?.uid]);

  const scheduleTemplateOptions = useMemo(() => (
    jobTemplates
      .filter(jobTemplateIsScheduleable)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
  ), [jobTemplates]);

  const scheduleAdminOptions = useMemo(() => (
    filterCompanyUserAdminOptions(companyUserOptions)
  ), [companyUserOptions]);

  const scheduleTechnicianOptions = useMemo(() => {
    if (canScheduleTemplateForOthers) return companyUserOptions;
    return currentCompanyUser ? [currentCompanyUser] : [];
  }, [canScheduleTemplateForOthers, companyUserOptions, currentCompanyUser]);

  const selectedScheduleTemplate = useMemo(() => (
    scheduleTemplateOptions.find((template) => template.id === scheduleTemplateId) || null
  ), [scheduleTemplateId, scheduleTemplateOptions]);

  const selectedScheduleAdmin = useMemo(() => (
    scheduleAdminOptions.find((admin) => admin.userId === scheduleAdminId || admin.id === scheduleAdminId) || null
  ), [scheduleAdminId, scheduleAdminOptions]);

  const selectedScheduleTechnician = useMemo(() => (
    scheduleTechnicianOptions.find((technician) => (
      technician.userId === scheduleTechnicianId || technician.id === scheduleTechnicianId
    )) || null
  ), [scheduleTechnicianId, scheduleTechnicianOptions]);

  const scheduleGeneratedPriceCents = useMemo(() => {
    const laborLinePrice = scheduleTemplateDetails.laborLineItems.reduce(
      (total, line) => total + laborLineTotalPriceCents(line),
      0
    );
    const taskPrice = scheduleTemplateDetails.tasks.reduce(
      (total, task) => total + getTaskBillingLaborPriceCents(task),
      0
    );
    const stopPrice = scheduleTemplateDetails.plannedServiceStops.reduce(
      (total, stop) => total + Number(stop.plannedLaborCostCents || 0),
      0
    );
    const materialPrice = scheduleTemplateDetails.shoppingItems.reduce(
      (total, item) => total + plannedMaterialTotalPriceCents(item),
      0
    );

    const generatedPrice = (scheduleTemplateDetails.laborLineItems.length ? laborLinePrice : taskPrice + stopPrice) + materialPrice;
    return generatedPrice || Number(selectedScheduleTemplate?.defaultRateCents || selectedScheduleTemplate?.rate || 0);
  }, [scheduleTemplateDetails, selectedScheduleTemplate]);

  const selectedQuickEquipmentServiceLocation = useMemo(() => (
    selectedQuickEquipment?.serviceLocationId
      ? serviceLocationsById[selectedQuickEquipment.serviceLocationId]
      : null
  ), [selectedQuickEquipment, serviceLocationsById]);

  const selectedQuickEquipmentServiceAddress = serviceLocationDisplayAddress(selectedQuickEquipmentServiceLocation) ||
    formatAddressLine(selectedQuickEquipment?.serviceLocationAddress) ||
    formatAddressLine(selectedQuickEquipment?.locationAddress) ||
    formatAddressLine(selectedQuickEquipment?.address) ||
    "";

  const scheduleEquipmentIsMissingLocation =
    activeQuickModal === SCHEDULE_JOB_MODAL &&
    (!selectedQuickEquipment?.customerId || !selectedQuickEquipment?.serviceLocationId);

  const canCreateScheduledEquipmentJob =
    canScheduleTemplateSelf &&
    !!selectedQuickEquipment &&
    !!selectedScheduleTemplate &&
    !!selectedScheduleAdmin &&
    !!selectedScheduleTechnician &&
    !!scheduleDateTime &&
    !scheduleEquipmentIsMissingLocation &&
    !loadingScheduleTemplateDetails &&
    !schedulingJob;

  useEffect(() => {
    if (activeQuickModal !== SCHEDULE_JOB_MODAL) return;

    if (!scheduleTemplateId && scheduleTemplateOptions.length) {
      const preferredTemplate =
        scheduleTemplateOptions.find((template) => templateIntentMatches(template, scheduleJobIntent)) ||
        scheduleTemplateOptions[0];
      setScheduleTemplateId(preferredTemplate?.id || "");
    }

    if (!scheduleAdminId && scheduleAdminOptions.length) {
      setScheduleAdminId(scheduleAdminOptions[0].userId || scheduleAdminOptions[0].id || "");
    }

    if (!scheduleTechnicianId && scheduleTechnicianOptions.length) {
      setScheduleTechnicianId(scheduleTechnicianOptions[0].userId || scheduleTechnicianOptions[0].id || "");
    }
  }, [
    activeQuickModal,
    scheduleAdminId,
    scheduleAdminOptions,
    scheduleJobIntent,
    scheduleTechnicianId,
    scheduleTechnicianOptions,
    scheduleTemplateId,
    scheduleTemplateOptions,
  ]);

  const getEquipmentServiceLocation = useCallback((equipment) => (
    equipment?.serviceLocationId ? serviceLocationsById[equipment.serviceLocationId] : null
  ), [serviceLocationsById]);

  const getEquipmentServiceAddress = useCallback((equipment) => (
    serviceLocationDisplayAddress(getEquipmentServiceLocation(equipment)) ||
    formatAddressLine(equipment?.serviceLocationAddress) ||
    formatAddressLine(equipment?.locationAddress) ||
    formatAddressLine(equipment?.address) ||
    ""
  ), [getEquipmentServiceLocation]);

  const getEquipmentActiveJobs = useCallback((equipment) => (
    activeJobsByEquipmentId[equipment?.id] || []
  ), [activeJobsByEquipmentId]);

  const getEquipmentRecurringStops = useCallback((equipment) => (
    recurringStopsByEquipmentId[equipment?.id] || []
  ), [recurringStopsByEquipmentId]);

  const getSortValue = useCallback((equipment, field) => {
    if (field === "serviceAddress") return getEquipmentServiceAddress(equipment);
    if (field === "activeJobs") return getEquipmentActiveJobs(equipment).length;
    if (field === "recurringServiceStops") return getEquipmentRecurringStops(equipment).length;
    return equipment?.[field];
  }, [getEquipmentActiveJobs, getEquipmentRecurringStops, getEquipmentServiceAddress]);

  useEffect(() => {
    let filtered = topFilter === "maintenance"
      ? [...maintenanceBoardEquipment]
      : equipmentList.filter((equipment) => equipmentMatchesDetailFilters(equipment, {
        activeStatusFilter,
        customerActiveById,
        typeFilter,
        needsServiceFilter,
      }));

    if (topFilter === "maintenance") {
      filtered = filtered.filter((equipment) => equipmentMatchesDetailFilters(equipment, {
        activeStatusFilter: DEFAULT_ACTIVE_STATUS_FILTER,
        customerActiveById,
        typeFilter,
        needsServiceFilter,
      }));
    } else if (topFilter === "repair") {
      filtered = filtered.filter(isNeedsRepair);
    } else if (topFilter === "nonOperational") {
      filtered = filtered.filter(isNonOperational);
    }

    // Search
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter((item) =>
        [
          item.customerName,
          item.type,
          item.make,
          item.model,
          item.notes,
          item.status,
          getEquipmentServiceAddress(item),
          ...serviceLocationSearchValues(getEquipmentServiceLocation(item), item),
          ...getEquipmentActiveJobs(item).flatMap((job) => [
            job.internalId,
            job.description,
            job.type,
            job.operationStatus,
            job.billingStatus,
            ...(job.equipmentTaskNames || []),
          ]),
          ...getEquipmentRecurringStops(item).flatMap((stop) => [
            stop.internalId,
            stop.type,
            stop.frequency,
            stop.day,
            stop.tech,
            ...(stop.equipmentTaskNames || []),
          ]),
        ].some((value) => String(value || "").toLowerCase().includes(s))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const fieldA = getSortValue(a, sortBy);
      const fieldB = getSortValue(b, sortBy);

      // Dates
      if (sortBy === "nextServiceDate" || fieldA instanceof Date || fieldB instanceof Date) {
        const timeA = sortableDateMillis(fieldA);
        const timeB = sortableDateMillis(fieldB);

        if (timeA === null && timeB === null) return 0;
        if (timeA === null) return 1;
        if (timeB === null) return -1;

        const comparison = timeA - timeB;
        return sortOrder === "desc" ? comparison * -1 : comparison;
      }

      // Strings
      if (typeof fieldA === "string" && typeof fieldB === "string") {
        const comparison = fieldA.localeCompare(fieldB);
        return sortOrder === "desc" ? comparison * -1 : comparison;
      }

      // Fallback
      let comparison = 0;
      if (fieldA > fieldB) comparison = 1;
      else if (fieldA < fieldB) comparison = -1;
      return sortOrder === "desc" ? comparison * -1 : comparison;
    });

    setFilteredEquipmentList(filtered);
  }, [
    activeStatusFilter,
    customerActiveById,
    equipmentList,
    getEquipmentActiveJobs,
    getEquipmentRecurringStops,
    getEquipmentServiceAddress,
    getEquipmentServiceLocation,
    getSortValue,
    maintenanceBoardEquipment,
    needsServiceFilter,
    searchTerm,
    sortBy,
    sortOrder,
    topFilter,
    typeFilter,
  ]);

  const handleSort = (field) => {
    const order = sortBy === field && sortOrder === "asc" ? "desc" : "asc";
    setSortBy(field);
    setSortOrder(order);
  };

  const handleTopFilterChange = (filter) => {
    setTopFilter(filter);
    navigate(`/company/equipment/${getEquipmentFilterPath(filter)}`);

    if (filter === "maintenance") {
      setSortBy("nextServiceDate");
      setSortOrder("asc");
    }
  };

  const activeStatusFilterLabel = ACTIVE_STATUS_FILTER_LABELS[activeStatusFilter] || ACTIVE_STATUS_FILTER_LABELS.active;
  const routineServiceFilterLabel = needsServiceFilter === "true"
    ? "Needs Service: Yes"
    : needsServiceFilter === "false"
      ? "Needs Service: No"
      : "Needs Service: All";
  const topFilterLabel = topFilter === "all"
    ? "All equipment"
    : topFilter === "maintenance"
      ? "Needs maintenance"
      : topFilter === "repair"
        ? "Needs repair"
        : "Non-operational";
  const appliedDetailFilterCount = [
    typeFilter,
    needsServiceFilter,
    activeStatusFilter !== DEFAULT_ACTIVE_STATUS_FILTER ? activeStatusFilter : "",
  ].filter(Boolean).length;
  const maintenanceTableFiltersActive = Boolean(typeFilter || needsServiceFilter || searchTerm.trim());
  const maintenanceEmptyAfterFilters =
    topFilter === "maintenance" &&
    !loadingEquipment &&
    maintenanceDueCount > 0 &&
    filteredEquipmentList.length === 0 &&
    maintenanceTableFiltersActive;
  const maintenanceTableMismatch =
    topFilter === "maintenance" &&
    !loadingEquipment &&
    maintenanceDueCount > 0 &&
    filteredEquipmentList.length === 0 &&
    !maintenanceTableFiltersActive;
  const maintenanceTroubleshooting = useMemo(() => ({
    equipmentLoaded: equipmentList.length,
    dueByOperationsRule: maintenanceDueCount,
    shownInTable: filteredEquipmentList.length,
    activeStatusFilter,
    typeFilter: typeFilter || "All",
    needsServiceFilter: needsServiceFilter || "All",
    searchTerm: searchTerm || "None",
  }), [
    activeStatusFilter,
    equipmentList.length,
    filteredEquipmentList.length,
    maintenanceDueCount,
    needsServiceFilter,
    searchTerm,
    typeFilter,
  ]);

  useEffect(() => {
    if (!maintenanceTableMismatch) return;

    console.warn("Equipment maintenance page mismatch", {
      ...maintenanceTroubleshooting,
      dueEquipmentIds: maintenanceBoardEquipment.map((equipment) => equipment.id),
      dueEquipmentPreview: maintenanceBoardEquipment.slice(0, 10).map((equipment) => ({
        id: equipment.id,
        name: equipment.name || equipment.type || equipment.model || "",
        customerName: equipment.customerName || "",
        status: equipment.status || equipment.operationStatus || equipment.equipmentStatus || "",
        needsService: equipment.needsService,
        nextServiceDate: equipment.nextServiceDate,
        isActive: equipment.isActive,
        active: equipment.active,
      })),
    });
  }, [maintenanceBoardEquipment, maintenanceTableMismatch, maintenanceTroubleshooting]);

  const resetDetailFilters = () => {
    setTypeFilter("");
    setNeedsServiceFilter("");
    setActiveStatusFilter(DEFAULT_ACTIVE_STATUS_FILTER);
  };

  const getStatusClass = (status, maintenanceFlag) => {
    const s = normalizeEquipmentStatus(status);
    if (maintenanceFlag) return "bg-amber-50 text-amber-700";
    if (s === "needsmaintenance" || s === "maintenance" || s === "needsservice") return "bg-amber-50 text-amber-700";
    if (s === "needsrepair") return "bg-orange-50 text-orange-700";
    if (s === "nonoperational") return "bg-red-50 text-red-700";
    return "bg-slate-100 text-slate-700";
  };

  const getEquipmentDisplayName = (equipment) =>
    [
      equipment?.name,
      equipment?.make,
      equipment?.model,
    ].filter(Boolean).join(" ") || equipment?.type || "Equipment";

  const buildEquipmentContext = (equipment, jobIntent = "") => ({
    jobIntent,
    equipmentId: equipment?.id || "",
    equipmentName: getEquipmentDisplayName(equipment),
    customerId: equipment?.customerId || "",
    customerName: equipment?.customerName || "",
    serviceLocationId: equipment?.serviceLocationId || "",
    bodyOfWaterId: equipment?.bodyOfWaterId || "",
    type: equipment?.type || "",
    make: equipment?.make || "",
    model: equipment?.model || "",
    name: equipment?.name || "",
  });

  const getQuickEquipmentServiceDraft = (overrides = {}) => ({
    name: quickName,
    type: quickType,
    make: quickMake,
    model: quickModel,
    ...overrides,
  });

  const applyQuickServiceDefaults = (overrides = {}) => {
    if (!equipmentDefaultsToNeedsService(getQuickEquipmentServiceDraft(overrides))) return;

    setQuickNeedsService(true);
    setQuickServiceFrequency((current) => current || "6");
    setQuickServiceFrequencyEvery((current) => current || "Month");
  };

  const updateEquipmentInLists = (equipmentId, updates) => {
    const applyUpdates = (equipment) =>
      equipment.id === equipmentId ? { ...equipment, ...updates } : equipment;

    setEquipmentList((current) => current.map(applyUpdates));
    setFilteredEquipmentList((current) => current.map(applyUpdates));

    if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
      setNoteDrafts((current) => ({
        ...current,
        [equipmentId]: updates.notes || "",
      }));
    }
  };

  const closeQuickModal = () => {
    setActiveQuickModal("");
    setSelectedQuickEquipment(null);
  };

  const openQuickModal = (equipment, modalName, jobIntent = "maintenance") => {
    closeQuickActions();
    setSelectedQuickEquipment(equipment);
    setActiveQuickModal(modalName);

    if (modalName === "makeModel") {
      const shouldDefaultNeedsService = equipmentDefaultsToNeedsService(equipment);
      setQuickName(equipment.name || "");
      setQuickType(equipment.type || "");
      setQuickTypeId(equipment.typeId || "");
      setQuickMake(equipment.make || "");
      setQuickMakeId(equipment.makeId || "");
      setQuickModel(equipment.model || "");
      setQuickModelId(equipment.modelId || "");
      setQuickUniversalEquipmentId(equipment.universalEquipmentId || equipment.modelId || "");
      setQuickManualPdfLink(equipment.manualPdfLink || "");
      setQuickNotes(equipment.notes || "");
      setQuickNeedsService(!!equipment.needsService || shouldDefaultNeedsService);
      setQuickLastServiceDate(dateToInputValue(equipment.lastServiceDate));
      setQuickServiceFrequency(
        equipment.serviceFrequency !== undefined &&
          equipment.serviceFrequency !== null &&
          equipment.serviceFrequency !== ""
          ? String(equipment.serviceFrequency)
          : shouldDefaultNeedsService
            ? "6"
            : ""
      );
      setQuickServiceFrequencyEvery(equipment.serviceFrequencyEvery || (shouldDefaultNeedsService ? "Month" : ""));
      setCatalogTypeId(equipment.typeId || CUSTOM_CATALOG_VALUE);
      setCatalogMakeId(equipment.makeId || CUSTOM_CATALOG_VALUE);
      setCatalogEquipmentId(equipment.universalEquipmentId || equipment.modelId || CUSTOM_CATALOG_VALUE);
    }

    if (modalName === "notes") {
      setQuickNotes(equipment.notes || "");
    }

    if (modalName === "status") {
      setQuickStatus(getQuickStatusOption(equipment.status));
    }

    if (modalName === "maintenance") {
      setMaintenanceName(DEFAULT_MAINTENANCE_NAME);
      setMaintenanceDate(todayDateInputValue());
      setMaintenancePerformedBy("Company");
      setMaintenanceCompanyUserId(companyUsers?.[0]?.id || "");
      setMaintenanceCustomerName(equipment.customerName || "");
      setMaintenanceNotes("");
    }

    if (modalName === "repair") {
      setRepairName("");
      setRepairDate(todayDateInputValue());
      setRepairPerformedBy("Company");
      setRepairCompanyUserId(companyUsers?.[0]?.id || "");
      setRepairCustomerName("");
      setRepairPartsReplaced([]);
      setCurrentPart("");
      setRepairNotes("");
    }

    if (modalName === SCHEDULE_JOB_MODAL) {
      const normalizedIntent = SCHEDULE_JOB_INTENTS[jobIntent] ? jobIntent : "maintenance";
      const intentConfig = SCHEDULE_JOB_INTENTS[normalizedIntent];
      const preferredTemplate =
        scheduleTemplateOptions.find((template) => templateIntentMatches(template, normalizedIntent)) ||
        scheduleTemplateOptions[0];
      const defaultAdmin = scheduleAdminOptions[0];
      const defaultTechnician = canScheduleTemplateForOthers
        ? scheduleTechnicianOptions[0]
        : currentCompanyUser || scheduleTechnicianOptions[0];

      setScheduleJobIntent(normalizedIntent);
      setScheduleTemplateId(preferredTemplate?.id || "");
      setScheduleAdminId(defaultAdmin?.userId || defaultAdmin?.id || "");
      setScheduleTechnicianId(defaultTechnician?.userId || defaultTechnician?.id || "");
      setScheduleDateTime(defaultScheduledAt());
      setScheduleNotes(`${intentConfig.label} for ${getEquipmentDisplayName(equipment)}`);
    }
  };

  const handleCatalogTypeChange = (value) => {
    setCatalogTypeId(value);
    setCatalogMakeId(CUSTOM_CATALOG_VALUE);
    setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
    setEquipmentModels([]);
    setQuickMakeId("");
    setQuickModelId("");
    setQuickUniversalEquipmentId("");
    setQuickManualPdfLink("");

    if (value === CUSTOM_CATALOG_VALUE) {
      setQuickTypeId("");
      return;
    }

    const selected = equipmentTypes.find((item) => item.id === value);
    setQuickTypeId(selected?.id || "");
    setQuickType(selected?.name || "");
    setQuickMake("");
    setQuickModel("");
    applyQuickServiceDefaults({
      type: selected?.name || "",
      make: "",
      model: "",
    });
  };

  const handleCatalogMakeChange = (value) => {
    setCatalogMakeId(value);
    setCatalogEquipmentId(CUSTOM_CATALOG_VALUE);
    setQuickModelId("");
    setQuickUniversalEquipmentId("");
    setQuickManualPdfLink("");

    if (value === CUSTOM_CATALOG_VALUE) {
      setQuickMakeId("");
      return;
    }

    const selected = equipmentMakes.find((item) => item.id === value);
    setQuickMakeId(selected?.id || "");
    setQuickMake(selected?.name || "");
    setQuickModel("");
    applyQuickServiceDefaults({
      make: selected?.name || "",
      model: "",
    });
  };

  const handleCatalogEquipmentChange = (value) => {
    setCatalogEquipmentId(value);

    if (value === CUSTOM_CATALOG_VALUE) {
      setQuickModelId("");
      setQuickUniversalEquipmentId("");
      setQuickManualPdfLink("");
      return;
    }

    const selected = equipmentModels.find((item) => item.id === value);
    setQuickModel(selected?.model || selected?.name || "");
    setQuickModelId(selected?.id || "");
    setQuickUniversalEquipmentId(selected?.id || "");
    setQuickManualPdfLink(selected?.manualPdfLink || "");
    if (!quickName.trim()) setQuickName(selected?.name || selected?.model || "");
    applyQuickServiceDefaults({
      name: quickName.trim() ? quickName : selected?.name || selected?.model || "",
      model: selected?.model || selected?.name || "",
    });
  };

  const handleSaveEquipment = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    const defaultsToNeedsService = equipmentDefaultsToNeedsService({
      name: quickName,
      type: quickType,
      make: quickMake,
      model: quickModel,
    });
    const finalNeedsService = quickNeedsService || defaultsToNeedsService;
    const finalLastServiceDate = finalNeedsService ? dateInputToLocalDate(quickLastServiceDate) : null;
    const serviceFrequencyValue =
      quickServiceFrequency || (defaultsToNeedsService ? "6" : "");
    const serviceFrequencyEveryValue =
      quickServiceFrequencyEvery || (defaultsToNeedsService ? "Month" : "");
    const numericServiceFrequency = Number(serviceFrequencyValue);
    const nextMaintenanceDate = finalNeedsService
      ? computeNextServiceDate(finalLastServiceDate, numericServiceFrequency, serviceFrequencyEveryValue)
      : null;

    if (finalNeedsService && !finalLastServiceDate) {
      toast.error("Add a last serviced date before saving equipment that needs service.");
      return;
    }

    if (
      finalNeedsService &&
      (!Number.isFinite(numericServiceFrequency) ||
        numericServiceFrequency <= 0 ||
        !serviceFrequencyEveryValue ||
        !nextMaintenanceDate)
    ) {
      toast.error("Add a valid service frequency so the next maintenance date can be calculated.");
      return;
    }

    const updates = {
      name: quickName,
      type: quickType,
      typeId: quickTypeId,
      make: quickMake,
      makeId: quickMakeId,
      model: quickModel,
      modelId: quickModelId,
      universalEquipmentId: quickUniversalEquipmentId,
      manualPdfLink: quickManualPdfLink,
      notes: quickNotes,
      needsService: finalNeedsService,
      lastServiceDate: finalNeedsService ? finalLastServiceDate : null,
      nextServiceDate: nextMaintenanceDate,
      serviceFrequency: finalNeedsService ? numericServiceFrequency : null,
      serviceFrequencyEvery: finalNeedsService ? serviceFrequencyEveryValue : "",
    };

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id),
        updates
      );
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Equipment updated");
    } catch (error) {
      console.error("Error updating equipment:", error);
      toast.error("Failed to update equipment");
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    const updates = { notes: quickNotes };

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id),
        updates
      );
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Notes updated");
    } catch (error) {
      console.error("Error updating equipment notes:", error);
      toast.error("Failed to update notes");
    }
  };

  const handleInlineNoteChange = (equipmentId, value) => {
    setNoteDrafts((current) => ({
      ...current,
      [equipmentId]: value,
    }));

    setNoteErrors((current) => {
      if (!current[equipmentId]) return current;
      const next = { ...current };
      delete next[equipmentId];
      return next;
    });
  };

  const handleInlineNoteSave = async (equipment) => {
    if (!equipment || !recentlySelectedCompany || !can("64")) return;

    const draft = noteDrafts[equipment.id] ?? "";
    const currentNotes = equipment.notes || "";
    if (draft === currentNotes) return;

    try {
      setSavingNoteIds((current) => ({ ...current, [equipment.id]: true }));
      setNoteErrors((current) => {
        if (!current[equipment.id]) return current;
        const next = { ...current };
        delete next[equipment.id];
        return next;
      });

      const updates = { notes: draft };
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", equipment.id),
        updates
      );
      updateEquipmentInLists(equipment.id, updates);
    } catch (error) {
      console.error("Error updating equipment notes from table:", error);
      setNoteErrors((current) => ({
        ...current,
        [equipment.id]: "Could not save",
      }));
      toast.error("Failed to update notes");
    } finally {
      setSavingNoteIds((current) => {
        const next = { ...current };
        delete next[equipment.id];
        return next;
      });
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    if (!quickStatus) {
      toast.error("Choose a status");
      return;
    }

    const updates = { status: quickStatus };

    try {
      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id),
        updates
      );
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Status updated");
    } catch (error) {
      console.error("Error updating equipment status:", error);
      toast.error("Failed to update status");
    }
  };

  const resolveEquipmentServiceLocation = async (equipment) => {
    if (!equipment?.serviceLocationId || !recentlySelectedCompany) return null;

    const existingServiceLocation = getEquipmentServiceLocation(equipment);
    if (existingServiceLocation) return existingServiceLocation;

    const locationSnap = await getDoc(
      doc(db, "companies", recentlySelectedCompany, "serviceLocations", equipment.serviceLocationId)
    );

    return locationSnap.exists()
      ? { id: equipment.serviceLocationId, ...locationSnap.data() }
      : null;
  };

  const buildScheduleLineItems = ({
    planId,
    normalizedTasks,
    normalizedPlannedStops,
    normalizedShoppingItems,
    normalizedLaborLineItems = [],
  }) => ([
    ...(normalizedLaborLineItems.length
      ? normalizedLaborLineItems.map((line, index) => {
        const amount = Number(line.totalPriceCents || 0);
        const quantity = Number(line.quantity || 1) || 1;
        const catalogItemId = laborLineCatalogItemId(line);
        const salesItemType = line.salesItemType || (catalogItemId ? SalesCatalogItemType.service : SalesCatalogItemType.labor);
        const lineType = salesItemType === SalesCatalogItemType.labor ? "Labor" : "Service";
        return {
          id: `${planId}_${line.id}`,
          catalogItemId,
          salesCatalogItemId: catalogItemId,
          sourceType: line.sourceType || SalesCatalogSourceType.manual,
          sourceId: line.sourceId || catalogItemId || line.id,
          salesItemType,
          billingBehavior: line.billingBehavior || SalesCatalogBillingBehavior.oneTime,
          type: line.type || lineType,
          name: line.name || `Service ${index + 1}`,
          description: [
            line.description || "",
            line.taskIds?.length ? `${line.taskIds.length} task${line.taskIds.length === 1 ? "" : "s"}` : "",
            line.plannedServiceStopIds?.length ? `${line.plannedServiceStopIds.length} planned stop${line.plannedServiceStopIds.length === 1 ? "" : "s"}` : "",
          ].filter(Boolean).join(" - "),
          quantity,
          unitAmountCents: Number(line.unitPriceCents || 0),
          totalAmountCents: amount,
          amount,
          billingLaborPriceCents: amount,
          internalLaborCostCents: Number(line.internalCostCents || 0),
          taskIds: line.taskIds || [],
          plannedServiceStopIds: line.plannedServiceStopIds || [],
          equipmentId: line.equipmentId || "",
          serviceLocationId: line.serviceLocationId || "",
          bodyOfWaterId: line.bodyOfWaterId || "",
          taxable: Boolean(line.taxable),
          stripeConnectedAccountId: line.stripeConnectedAccountId || "",
          stripeProductId: line.stripeProductId || "",
          stripePriceId: line.stripePriceId || "",
          displayAmount: moneyFromCents(amount),
        };
      })
      : [
        ...normalizedPlannedStops.map((stop) => {
          const amount = Number(stop.plannedLaborCostCents || 0);
          return {
            id: `${planId}_${stop.id}`,
            sourceType: SalesCatalogSourceType.serviceStopType,
            sourceId: stop.serviceStopTypeId || stop.id,
            salesItemType: SalesCatalogItemType.service,
            billingBehavior: SalesCatalogBillingBehavior.oneTime,
            type: "Planned Stop",
            name: stop.name || "Planned Service Stop",
            description: stop.description || stop.plannedLaborNotes || "",
            quantity: 1,
            unitAmountCents: amount,
            totalAmountCents: amount,
            amount,
            equipmentId: stop.equipmentId || "",
            serviceLocationId: stop.serviceLocationId || "",
            bodyOfWaterId: stop.bodyOfWaterId || "",
            taxable: false,
            displayAmount: moneyFromCents(amount),
          };
        }),
        ...normalizedTasks.map((task) => {
          const amount = getTaskBillingLaborPriceCents(task);
          return {
            id: `${planId}_${task.id}`,
            sourceType: SalesCatalogSourceType.task,
            sourceId: task.id,
            salesItemType: SalesCatalogItemType.labor,
            billingBehavior: SalesCatalogBillingBehavior.oneTime,
            type: "Task",
            name: task.name || "Task",
            description: task.description || task.type || "",
            quantity: 1,
            unitAmountCents: amount,
            totalAmountCents: amount,
            amount,
            billingLaborPriceCents: amount,
            internalLaborCostCents: Number(task.contractedRate || 0),
            equipmentId: task.equipmentId || "",
            serviceLocationId: task.serviceLocationId || "",
            bodyOfWaterId: task.bodyOfWaterId || "",
            taxable: false,
            displayAmount: moneyFromCents(amount),
          };
        }),
      ]),
    ...normalizedShoppingItems.map((item) => {
      const quantity = quantityNumber(item.quantity) || 1;
      const amount = plannedMaterialTotalPriceCents(item);
      const unitAmountCents = quantity ? Math.round(amount / quantity) : amount;
      return {
        id: `${planId}_${item.id}`,
        sourceType: item.dbItemId || item.itemId ? "databaseItem" : "shoppingListItem",
        sourceId: item.dbItemId || item.itemId || item.id,
        salesItemType: "material",
        billingBehavior: "oneTime",
        type: "Material",
        name: item.name || "Material",
        description: item.description || "",
        quantity,
        unitAmountCents,
        totalAmountCents: amount,
        amount,
        equipmentId: item.equipmentId || "",
        serviceLocationId: item.serviceLocationId || "",
        bodyOfWaterId: item.bodyOfWaterId || "",
        taxable: Boolean(item.taxable),
        displayAmount: moneyFromCents(amount),
      };
    }),
  ]).filter((item) => item.totalAmountCents > 0 || item.name);

  const handleScheduleEquipmentJob = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany) return;

    if (!canScheduleTemplateSelf) {
      toast.error("You do not have permission to schedule template work orders.");
      return;
    }

    if (!canCreateScheduledEquipmentJob) {
      toast.error("Pick a template, admin, technician, and scheduled time.");
      return;
    }

    if (!canScheduleTemplateForOthers && selectedScheduleTechnician?.userId !== currentCompanyUser?.userId) {
      toast.error("You can only assign this work order to yourself.");
      setScheduleTechnicianId(currentCompanyUser?.userId || currentCompanyUser?.id || "");
      return;
    }

    const scheduledDate = new Date(scheduleDateTime);
    if (Number.isNaN(scheduledDate.getTime())) {
      toast.error("Choose a valid scheduled date and time.");
      return;
    }

    setSchedulingJob(true);

    try {
      const serviceLocation =
        await resolveEquipmentServiceLocation(selectedQuickEquipment) ||
        {
          id: selectedQuickEquipment.serviceLocationId || "",
          label: selectedQuickEquipmentServiceAddress || "Service Location",
          address: {},
        };
      const serviceLocationName = serviceLocationDisplayName(serviceLocation);
      const workOrderCounterRef = doc(db, "companies", recentlySelectedCompany, "settings", "workOrders");
      const workOrderCounterSnap = await getDoc(workOrderCounterRef);
      const nextCount = workOrderCounterSnap.exists()
        ? Number(workOrderCounterSnap.data().increment || 0) + 1
        : 1;
      const nextInternalId = `J${nextCount}`;
      const jobId = `comp_wo_${uuidv4()}`;
      const planId = `comp_job_plan_${uuidv4()}`;
      const now = new Date();
      const nowTimestamp = Timestamp.fromDate(now);
      const nowMillis = now.getTime();
      const equipmentContext = buildEquipmentContext(selectedQuickEquipment, scheduleJobIntent);
      const description =
        scheduleNotes.trim() ||
        selectedScheduleTemplate?.description ||
        `${scheduleJobIntentConfig.label} for ${getEquipmentDisplayName(selectedQuickEquipment)}`;
      const customerName = selectedQuickEquipment.customerName || "Customer";
      const adminId = selectedScheduleAdmin.userId || selectedScheduleAdmin.id || "";
      const adminName = selectedScheduleAdmin.userName || selectedScheduleAdmin.label || "";
      const techId = selectedScheduleTechnician.userId || selectedScheduleTechnician.id || "";
      const techName = selectedScheduleTechnician.userName || selectedScheduleTechnician.label || "";

      await setDoc(workOrderCounterRef, { increment: nextCount }, { merge: true });

      const normalizedTasks = scheduleTemplateDetails.tasks.map((task, index) => ({
        id: `comp_job_task_${uuidv4()}`,
        companyId: recentlySelectedCompany,
        jobId,
        sourcePlanId: planId,
        sourceSolutionId: planId,
        sourceTemplateId: selectedScheduleTemplate.id,
        sourceTemplateTaskId: task.id || "",
        name: task.name || task.description || "Task",
        type: canonicalJobTaskType(task.type || scheduleJobIntentConfig.jobType || "General"),
        description: task.description || "",
        contractedRate: Number(task.contractedRate || 0),
        billingLaborPriceCents: getTaskBillingLaborPriceCents(task),
        estimatedTime: Number(task.estimatedTime || 0),
        status: "Draft",
        customerApproval: Boolean(task.customerApproval || false),
        actualTime: 0,
        workerId: "",
        workerType: "Not Assigned",
        workerName: "",
        laborContractId: "",
        serviceStopId: { id: "", internalId: "" },
        equipmentId: selectedQuickEquipment.id,
        serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
        bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
        dataBaseItemId: task.dataBaseItemId || "",
        shoppingListItemId: task.shoppingListItemId || "",
        shoppingListItemIds: Array.isArray(task.shoppingListItemIds) ? task.shoppingListItemIds : [],
        sortOrder: Number(task.sortOrder ?? index),
      }));
      const taskIdMap = scheduleTemplateDetails.tasks.reduce((map, task, index) => ({
        ...map,
        [task.id]: normalizedTasks[index]?.id,
      }), {});
      const normalizedPlannedStops = scheduleTemplateDetails.plannedServiceStops.length
        ? scheduleTemplateDetails.plannedServiceStops.map((stop, index) => {
          const originalTaskIds = Array.isArray(stop.taskTemplateIds)
            ? stop.taskTemplateIds
            : Array.isArray(stop.taskIds)
              ? stop.taskIds
              : [];

          return {
            id: `comp_job_plan_stop_${uuidv4()}`,
            companyId: recentlySelectedCompany,
            jobId,
            sourcePlanId: planId,
            sourceSolutionId: planId,
            sourceTemplateId: selectedScheduleTemplate.id,
            sourceTemplatePlannedStopId: stop.id || "",
            name: stop.name || stop.serviceStopTypeName || selectedScheduleTemplate.name || "Planned Stop",
            description: stop.description || "",
            serviceStopTypeId: stop.serviceStopTypeId || "",
            serviceStopTypeName: stop.serviceStopTypeName || "",
            serviceStopTypeImage: stop.serviceStopTypeImage || "",
            serviceStopTypeUseCaseRawValue: stop.serviceStopTypeUseCaseRawValue || "",
            estimatedMinutes: Number(stop.estimatedMinutes || 0),
            sortOrder: Number(stop.sortOrder ?? index),
            taskIds: originalTaskIds.map((taskId) => taskIdMap[taskId]).filter(Boolean),
            plannedLaborCostCents: stop.plannedLaborCostCents !== undefined && stop.plannedLaborCostCents !== null
              ? Number(stop.plannedLaborCostCents)
              : null,
            plannedLaborNotes: stop.plannedLaborNotes || "",
            equipmentId: selectedQuickEquipment.id,
            serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
            bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
            createdAt: nowTimestamp,
            createdByUserId: createdByUserId || "",
          };
        })
        : [{
          id: `comp_job_plan_stop_${uuidv4()}`,
          companyId: recentlySelectedCompany,
          jobId,
          sourcePlanId: planId,
          sourceSolutionId: planId,
          sourceTemplateId: selectedScheduleTemplate.id,
          name: selectedScheduleTemplate.name || `${scheduleJobIntentConfig.label} Visit`,
          description,
          serviceStopTypeId: "system_job_service_stop",
          serviceStopTypeName: "Job Visit",
          serviceStopTypeImage: "briefcase",
          serviceStopTypeUseCaseRawValue: "jobVisit",
          estimatedMinutes: normalizedTasks.reduce((total, task) => total + Number(task.estimatedTime || 0), 0) || 60,
          sortOrder: 0,
          taskIds: normalizedTasks.map((task) => task.id),
          plannedLaborCostCents: 0,
          plannedLaborNotes: "",
          equipmentId: selectedQuickEquipment.id,
          serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
          bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
          createdAt: nowTimestamp,
          createdByUserId: createdByUserId || "",
        }];
      const plannedStopIdMap = normalizedPlannedStops.reduce((map, stop) => ({
        ...map,
        [stop.sourceTemplatePlannedStopId || stop.id]: stop.id,
      }), {});
      const normalizedLaborLineItems = scheduleTemplateDetails.laborLineItems.map((line, index) => {
        const quantity = Math.max(Number(line.quantity || line.defaultQuantity || 1) || 1, 1);
        const sourceTaskIds = getLaborLineTaskIds(line);
        const sourcePlannedStopIds = getLaborLinePlannedStopIds(line);
        const taskIds = sourceTaskIds.map((taskId) => taskIdMap[taskId]).filter(Boolean);
        const plannedServiceStopIds = sourcePlannedStopIds.map((stopId) => plannedStopIdMap[stopId]).filter(Boolean);
        const catalogItemId = laborLineCatalogItemId(line);
        const laborLineId = `comp_job_labor_line_${uuidv4()}`;

        return {
          id: laborLineId,
          laborLineId,
          companyId: recentlySelectedCompany,
          jobId,
          sourcePlanId: planId,
          sourceSolutionId: planId,
          sourceTemplateId: selectedScheduleTemplate.id,
          sourceTemplateLaborLineId: line.id || "",
          name: line.name || line.title || `Service ${index + 1}`,
          description: line.description || "",
          quantity,
          unitPriceCents: laborLineUnitPriceCents(line),
          totalPriceCents: laborLineTotalPriceCents(line),
          internalCostCents: laborLineInternalCostCents(line),
          unitCostCents: laborLineInternalCostCents(line),
          taskIds,
          laborLineTaskIds: taskIds,
          plannedServiceStopIds,
          laborLinePlannedServiceStopIds: plannedServiceStopIds,
          sourceTemplateTaskIds: sourceTaskIds,
          sourceTemplatePlannedServiceStopIds: sourcePlannedStopIds,
          equipmentId: selectedQuickEquipment.id,
          serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
          bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
          salesItemType: line.salesItemType || (catalogItemId ? SalesCatalogItemType.service : SalesCatalogItemType.labor),
          billingBehavior: line.billingBehavior || SalesCatalogBillingBehavior.oneTime,
          sourceType: line.sourceType || SalesCatalogSourceType.manual,
          sourceId: line.sourceId || catalogItemId || "",
          catalogItemId,
          salesCatalogItemId: catalogItemId,
          sourceCatalogItemId: line.sourceCatalogItemId || catalogItemId,
          catalogItemName: line.catalogItemName || line.sourceCatalogItemName || line.name || "",
          stripeConnectedAccountId: line.stripeConnectedAccountId || "",
          stripeProductId: line.stripeProductId || "",
          stripePriceId: line.stripePriceId || "",
          taxable: Boolean(line.taxable),
          sortOrder: Number(line.sortOrder ?? index),
          createdAt: nowTimestamp,
          createdAtMillis: nowMillis,
          createdByUserId: createdByUserId || "",
          createdByUserName: createdByUserName || "",
          updatedAt: nowTimestamp,
          updatedAtMillis: nowMillis,
        };
      });
      const normalizedShoppingItems = scheduleTemplateDetails.shoppingItems.map((item, index) => {
        const quantity = item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "1";

        return {
          id: `comp_shop_${uuidv4()}`,
          companyId: recentlySelectedCompany,
          jobId,
          customerId: selectedQuickEquipment.customerId || "",
          customerName,
          planId,
          sourcePlanId: planId,
          solutionId: planId,
          sourceSolutionId: planId,
          equipmentId: selectedQuickEquipment.id,
          serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
          bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
          sourceTemplateId: selectedScheduleTemplate.id,
          sourceTemplateShoppingItemId: item.id || "",
          category: "Job",
          subCategory: item.subCategory || "Custom",
          status: "Need to Purchase",
          purchaserId: createdByUserId || "",
          purchaserName: createdByUserName || "",
          genericItemId: item.genericItemId || "",
          name: item.name || "",
          description: item.description || "",
          datePurchased: null,
          quantity,
          userId: "",
          userName: "",
          dbItemId: item.dbItemId || "",
          purchasedItem: "",
          invoiced: false,
          plannedUnitCostCents: item.plannedUnitCostCents ?? null,
          plannedUnitPriceCents: item.plannedUnitPriceCents ?? null,
          plannedTotalCostCents: plannedMaterialTotalCostCents(item),
          plannedTotalPriceCents: plannedMaterialTotalPriceCents(item),
          cost: item.plannedUnitCostCents ?? item.cost ?? 0,
          price: item.plannedUnitPriceCents ?? item.price ?? 0,
          itemId: item.dbItemId || item.itemId || "",
          itemType: item.subCategory || item.itemType || "Custom",
          sortOrder: Number(item.sortOrder ?? index),
        };
      });
      const lineItems = buildScheduleLineItems({
        planId,
        normalizedTasks,
        normalizedPlannedStops,
        normalizedShoppingItems,
        normalizedLaborLineItems,
      });
      const subtotalAmountCents = lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
      const totalAmountCents = subtotalAmountCents || scheduleGeneratedPriceCents;
      const plannedLaborCostCents = normalizedLaborLineItems.length
        ? normalizedLaborLineItems.reduce((total, line) => total + Number(line.internalCostCents || 0), 0)
        : normalizedTasks.reduce((total, task) => total + Number(task.contractedRate || 0), 0) +
          normalizedPlannedStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
      const plannedLaborPriceCents = normalizedLaborLineItems.length
        ? normalizedLaborLineItems.reduce((total, line) => total + Number(line.totalPriceCents || 0), 0)
        : normalizedTasks.reduce((total, task) => total + getTaskBillingLaborPriceCents(task), 0) +
          normalizedPlannedStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
      const materialCostCents = normalizedShoppingItems.reduce(
        (total, item) => total + plannedMaterialTotalCostCents(item),
        0
      );
      const materialPriceCents = normalizedShoppingItems.reduce(
        (total, item) => total + plannedMaterialTotalPriceCents(item),
        0
      );
      const internalCostCents = plannedLaborCostCents + materialCostCents;
      const projectedProfitCents = totalAmountCents - internalCostCents;
      const profitMarginPercent = totalAmountCents > 0
        ? Math.round((projectedProfitCents / totalAmountCents) * 1000) / 10
        : 0;
      const issuePriorityLevel = getTemplateDefaultIssuePriority(selectedScheduleTemplate);
      const issuePriorityLabel = getIssuePriorityLabel(issuePriorityLevel);
      const planTierLabel = getJobPlanRecommendationLabel(DEFAULT_JOB_PLAN_TIER);
      const planName = selectedScheduleTemplate.name ? `${selectedScheduleTemplate.name} Plan` : `${scheduleJobIntentConfig.label} Plan`;

      const planRecord = {
        id: planId,
        planId,
        solutionId: planId,
        companyId: recentlySelectedCompany,
        jobId,
        jobInternalId: nextInternalId,
        customerId: selectedQuickEquipment.customerId || "",
        customerName,
        serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
        serviceLocationName,
        bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
        bodyOfWaterName: selectedQuickEquipment.bodyOfWaterName || "",
        equipmentId: selectedQuickEquipment.id,
        equipmentName: getEquipmentDisplayName(selectedQuickEquipment),
        equipmentIds: [selectedQuickEquipment.id],
        sourceType: "template",
        sourceTemplateId: selectedScheduleTemplate.id,
        sourceTemplateName: selectedScheduleTemplate.name || "",
        title: planName,
        name: planName,
        planName,
        description,
        status: JOB_PLAN_STATUS.DRAFT,
        planTier: DEFAULT_JOB_PLAN_TIER,
        planTierLabel,
        solutionTier: DEFAULT_JOB_PLAN_TIER,
        solutionTierLabel: planTierLabel,
        recommendationRank: DEFAULT_JOB_PLAN_TIER,
        recommendationRankLabel: planTierLabel,
        issuePriorityLevel,
        issuePriorityLabel,
        isActivePlan: true,
        isAccepted: false,
        rateAmountCents: totalAmountCents,
	        totalAmountCents,
	        subtotalAmountCents,
	        laborCostCents: plannedLaborCostCents,
	        plannedLaborCostCents,
	        plannedLaborPriceCents,
	        materialCostCents,
	        materialPriceCents,
	        internalCostCents,
        projectedProfitCents,
        profitMarginPercent,
	        costSummary: {
	          plannedLaborCostCents,
	          plannedLaborPriceCents,
	          plannedMaterialCostCents: materialCostCents,
	          plannedMaterialPriceCents: materialPriceCents,
	          internalCostCents,
        },
        billingSummary: {
          pricingSource: "templateGeneratedPrice",
          lineItemCount: lineItems.length,
          subtotalAmountCents,
          totalAmountCents,
          projectedProfitCents,
          profitMarginPercent,
        },
        scopeOfWork: {
          title: planName,
          customerDescription: description,
          taskSummaries: normalizedTasks.map((task, index) => ({
            id: task.id,
            sortOrder: Number(task.sortOrder ?? index),
            name: task.name || `Task ${index + 1}`,
            type: task.type || "",
            estimatedMinutes: Number(task.estimatedTime || 0),
            plannedLaborCostCents: Number(task.contractedRate || 0),
            billingLaborPriceCents: getTaskBillingLaborPriceCents(task),
            equipmentId: task.equipmentId || "",
            serviceLocationId: task.serviceLocationId || "",
            bodyOfWaterId: task.bodyOfWaterId || "",
          })),
	          plannedStopSummaries: normalizedPlannedStops.map((stop, index) => ({
	            id: stop.id,
	            sortOrder: Number(stop.sortOrder ?? index),
	            name: stop.name || `Visit ${index + 1}`,
            serviceStopTypeId: stop.serviceStopTypeId || "",
            serviceStopTypeName: stop.serviceStopTypeName || "",
            estimatedMinutes: Number(stop.estimatedMinutes || 0),
	            plannedLaborCostCents: Number(stop.plannedLaborCostCents || 0),
	            taskIds: Array.isArray(stop.taskIds) ? stop.taskIds : [],
	            equipmentId: stop.equipmentId || "",
	            serviceLocationId: stop.serviceLocationId || "",
	            bodyOfWaterId: stop.bodyOfWaterId || "",
	          })),
	          laborLineSummaries: normalizedLaborLineItems.map((line, index) => ({
	            id: line.id,
	            sortOrder: Number(line.sortOrder ?? index),
	            name: line.name || `Service ${index + 1}`,
	            description: line.description || "",
	            quantity: Number(line.quantity || 1),
	            unitPriceCents: Number(line.unitPriceCents || 0),
	            totalPriceCents: Number(line.totalPriceCents || 0),
	            internalCostCents: Number(line.internalCostCents || 0),
	            catalogItemId: laborLineCatalogItemId(line),
	            taskIds: Array.isArray(line.taskIds) ? line.taskIds : [],
	            plannedServiceStopIds: Array.isArray(line.plannedServiceStopIds) ? line.plannedServiceStopIds : [],
	            equipmentId: line.equipmentId || "",
	            serviceLocationId: line.serviceLocationId || "",
	            bodyOfWaterId: line.bodyOfWaterId || "",
	          })),
	          materialSummaries: normalizedShoppingItems.map((item, index) => ({
	            id: item.id,
	            sortOrder: Number(item.sortOrder ?? index),
            name: item.name || `Material ${index + 1}`,
            description: item.description || "",
            quantity: item.quantity || "1",
            plannedTotalCostCents: plannedMaterialTotalCostCents(item),
            plannedTotalPriceCents: plannedMaterialTotalPriceCents(item),
            equipmentId: item.equipmentId || "",
            serviceLocationId: item.serviceLocationId || "",
            bodyOfWaterId: item.bodyOfWaterId || "",
          })),
          counts: {
	            tasks: normalizedTasks.length,
	            plannedServiceStops: normalizedPlannedStops.length,
	            shoppingItems: normalizedShoppingItems.length,
	            laborLineItems: normalizedLaborLineItems.length,
	            lineItems: lineItems.length,
	          },
	        },
	        tasks: normalizedTasks,
	        plannedServiceStops: normalizedPlannedStops,
	        shoppingItems: normalizedShoppingItems,
	        laborLineItems: normalizedLaborLineItems,
	        estimateLaborLineItems: normalizedLaborLineItems,
	        lineItems,
	        estimateLineItems: lineItems,
	        taskCount: normalizedTasks.length,
	        plannedStopCount: normalizedPlannedStops.length,
	        materialCount: normalizedShoppingItems.length,
	        laborLineCount: normalizedLaborLineItems.length,
        createdAt: nowTimestamp,
        createdAtMillis: nowMillis,
        createdByUserId,
        createdByUserName,
        updatedAt: nowTimestamp,
        updatedAtMillis: nowMillis,
      };
      const jobData = {
        id: jobId,
        internalId: nextInternalId,
        type: selectedScheduleTemplate.jobType || selectedScheduleTemplate.type || scheduleJobIntentConfig.jobType,
        dateCreated: nowTimestamp,
        updatedAt: nowTimestamp,
        updatedAtMillis: nowMillis,
        lastHistoryEventTitle: scheduleJobIntentConfig.historyTitle,
        lastHistoryEventType: "Created",
        description,
        operationStatus: "Scheduled",
        billingStatus: "Draft",
        issuePriorityLevel,
        issuePriorityLabel,
        priorityLevel: issuePriorityLevel,
        priorityLabel: issuePriorityLabel,
        solutionTier: issuePriorityLevel,
        solutionTierLabel: issuePriorityLabel,
        activePlanId: planId,
        activePlanTier: DEFAULT_JOB_PLAN_TIER,
        activePlanTierLabel: planTierLabel,
        acceptedPlanId: "",
        activeSolutionId: planId,
        activeSolutionTier: DEFAULT_JOB_PLAN_TIER,
        activeSolutionTierLabel: planTierLabel,
        acceptedSolutionId: "",
        planSelectionStatus: "Draft",
        solutionSelectionStatus: "Draft",
        customerId: selectedQuickEquipment.customerId || "",
        customerName,
        serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
        serviceLocationName,
        bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
        bodyOfWaterName: selectedQuickEquipment.bodyOfWaterName || "",
        serviceStopIds: [],
        laborContractIds: [],
        adminId,
        adminName,
        adminAssignmentSource: "Equipment schedule popup",
	        purchasedItemsIds: [],
	        rate: totalAmountCents,
	        laborCost: plannedLaborCostCents,
	        plannedLaborPriceCents,
	        plannedMaterialCostCents: materialCostCents,
	        plannedMaterialPriceCents: materialPriceCents,
	        estimateSubtotalCents: subtotalAmountCents,
	        estimateTotalCents: totalAmountCents,
	        estimateLineItems: lineItems,
	        laborLineItems: normalizedLaborLineItems,
	        estimateLaborLineItems: normalizedLaborLineItems,
	        laborLineCount: normalizedLaborLineItems.length,
	        taskCount: normalizedTasks.length,
	        plannedStopCount: normalizedPlannedStops.length,
	        materialCount: normalizedShoppingItems.length,
	        otherCompany: false,
        receivedLaborContractId: "",
        receiverId: "",
        senderId: recentlySelectedCompany,
        dateEstimateAccepted: null,
        estimateAcceptedById: null,
        estimateAcceptType: null,
        estimateAcceptedNotes: "",
        invoiceDate: null,
        invoiceRef: "",
        invoiceType: null,
        invoiceNotes: "",
        sourceTemplateId: selectedScheduleTemplate.id,
        sourceTemplateName: selectedScheduleTemplate.name || "",
        createdFromBasicWorkOrderForm: true,
        createdFromEquipmentList: true,
        createdFromEquipmentScheduleModal: true,
        basicWorkOrderMode: "template",
        assignedTechId: techId,
        assignedTechName: techName,
        assignedCompanyUserId: selectedScheduleTechnician.id || "",
        scheduledAt: Timestamp.fromDate(scheduledDate),
        scheduledDate: Timestamp.fromDate(scheduledDate),
        equipmentId: selectedQuickEquipment.id,
        equipmentIds: [selectedQuickEquipment.id],
        companyEquipmentIds: [selectedQuickEquipment.id],
        equipmentName: getEquipmentDisplayName(selectedQuickEquipment),
        equipmentContext,
        jobIntent: scheduleJobIntent,
        createdByUserId,
        createdByUserName,
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), jobData);
      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plans", planId), planRecord);

      for (const stop of normalizedPlannedStops) {
        await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plannedServiceStops", stop.id), stop);
      }

	      for (const task of normalizedTasks) {
	        await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), task);
	      }

	      for (const line of normalizedLaborLineItems) {
	        await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "laborLineItems", line.id), line);
	      }

	      for (const item of normalizedShoppingItems) {
	        await setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", item.id), item);
	      }

      const selectedPlannedStop = normalizedPlannedStops[0] || null;
      const serviceStopId = `comp_ss_${uuidv4()}`;
      const serviceStopCounterRef = doc(db, "companies", recentlySelectedCompany, "settings", "recurringServiceStops");
      const serviceStopCounterSnap = await getDoc(serviceStopCounterRef);
      const currentServiceStopCount = serviceStopCounterSnap.exists()
        ? Number(serviceStopCounterSnap.data().increment || 0)
        : 0;
      const nextServiceStopCount = currentServiceStopCount + 1;
      const serviceStopInternalId = `SS${currentServiceStopCount}`;
      const taskIdsForStop = Array.isArray(selectedPlannedStop?.taskIds) && selectedPlannedStop.taskIds.length
        ? selectedPlannedStop.taskIds
        : normalizedTasks.map((task) => task.id);
      const scheduledTasks = normalizedTasks.filter((task) => taskIdsForStop.includes(task.id));
      const duration =
        Number(selectedPlannedStop?.estimatedMinutes || 0) ||
        scheduledTasks.reduce((total, task) => total + Number(task.estimatedTime || 0), 0) ||
        60;
      const payTypeId = selectedPlannedStop?.payTypeId || selectedPlannedStop?.serviceStopTypeId || "system_job_service_stop";
      const payTypeName = selectedPlannedStop?.payTypeName || selectedPlannedStop?.serviceStopTypeName || scheduleJobIntentConfig.label;

      await setDoc(serviceStopCounterRef, { increment: nextServiceStopCount }, { merge: true });

      const serviceStopRecord = {
        id: serviceStopId,
        address: serviceLocation.address || {},
        companyId: recentlySelectedCompany,
        companyName: recentlySelectedCompanyName || "",
        customerId: selectedQuickEquipment.customerId || "",
        customerName,
        dateCreated: Timestamp.fromDate(now),
        serviceDate: Timestamp.fromDate(scheduledDate),
        description: selectedPlannedStop?.description || description,
        estimatedDuration: duration,
        operationStatus: "Not Finished",
        billingStatus: "Not Invoiced",
        isInvoiced: false,
        contractedCompanyId: "",
        jobId,
        jobName: nextInternalId,
        serviceLocationId: selectedQuickEquipment.serviceLocationId || "",
        bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
        bodyOfWaterName: selectedQuickEquipment.bodyOfWaterName || "",
        tech: techName,
        techId,
        internalId: serviceStopInternalId,
        checkList: [],
        mainCompanyId: "",
        otherCompany: false,
        laborContractId: "",
        endTime: null,
        startTime: null,
        includeDosages: false,
        includeReadings: false,
        estimatedPayCents: 0,
        estimatedPayLines: [],
        payTypeId,
        payTypeName,
        manualPayOverrideCents: null,
        manualPayOverrideNotes: "",
        plannedServiceStopId: selectedPlannedStop?.id || "",
        rate: scheduledTasks.reduce((total, task) => total + Number(task.contractedRate || 0), 0),
        recurringServiceStopId: "",
        type: selectedPlannedStop?.serviceStopTypeName || scheduleJobIntentConfig.label,
        typeId: selectedPlannedStop?.serviceStopTypeId || "system_job_service_stop",
        typeImage: selectedPlannedStop?.serviceStopTypeImage || "briefcase",
        category: "Job",
        serviceStopTypeUseCaseRawValue: selectedPlannedStop?.serviceStopTypeUseCaseRawValue || "jobVisit",
        source: "EquipmentList",
        serviceNotes: "",
        duration,
        equipmentId: selectedQuickEquipment.id,
        equipmentIds: [selectedQuickEquipment.id],
        companyEquipmentIds: [selectedQuickEquipment.id],
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId), serviceStopRecord);

      for (const task of scheduledTasks) {
        const serviceStopTaskId = `comp_ss_tas_${uuidv4()}`;
        const scheduledTaskUpdates = {
          workerId: techId,
          workerName: techName,
          workerType: selectedScheduleTechnician.workerType || "Assigned",
          status: "Scheduled",
          serviceStopId: {
            id: serviceStopId,
            internalId: serviceStopInternalId,
          },
          serviceStopIdString: serviceStopId,
        };

        await setDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId, "tasks", serviceStopTaskId), {
          ...task,
          ...scheduledTaskUpdates,
          id: serviceStopTaskId,
          jobId: {
            id: jobId || "",
            internalId: nextInternalId || "",
          },
          recurringServiceStopId: {
            id: "",
            internalId: "",
          },
          jobTaskId: task.id,
          payTypeId: task.payTypeId || task.workTypeId || "",
          payTypeName: task.payTypeName || task.workTypeName || "",
          workOrderTaskId: task.id,
        });

        await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), scheduledTaskUpdates);
      }

      if (selectedPlannedStop?.id) {
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plannedServiceStops", selectedPlannedStop.id), {
          serviceStopId,
          scheduledServiceStopId: serviceStopId,
          convertedServiceStopId: serviceStopId,
          scheduledServiceStopInternalId: serviceStopInternalId,
          scheduledDate: Timestamp.fromDate(scheduledDate),
          assignedTechId: techId,
          assignedTechName: techName,
        });
      }

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
        serviceStopIds: arrayUnion(serviceStopId),
        scheduledServiceStopId: serviceStopId,
        scheduledServiceStopInternalId: serviceStopInternalId,
        assignedTechId: techId,
        assignedTechName: techName,
        operationStatus: "Scheduled",
      });

      const scheduledWorkId = `com_equ_sw_${uuidv4()}`;
      await setDoc(
        doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id, "scheduledWork", scheduledWorkId),
        {
          id: scheduledWorkId,
          name: selectedScheduleTemplate.name || scheduleJobIntentConfig.label,
          type: scheduleJobIntentConfig.jobType,
          serviceDate: Timestamp.fromDate(scheduledDate),
          techId,
          techName,
          serviceStopId,
          serviceStopInternalId,
          jobId,
          jobInternalId: nextInternalId,
          status: "Scheduled",
          description,
          dateCreated: nowTimestamp,
          dateCompleted: null,
        }
      );

      const historyId = `comp_job_hist_${uuidv4()}`;
      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "history", historyId), {
        id: historyId,
        companyId: recentlySelectedCompany,
        jobId,
        jobInternalId: nextInternalId,
        eventType: "Created",
        title: scheduleJobIntentConfig.historyTitle,
        description: `Scheduled from equipment list using template: ${selectedScheduleTemplate.name || "Template"}`,
        changes: [
          { field: "adminName", label: "Admin", before: "-", after: adminName || "-" },
          { field: "assignedTechName", label: "Technician", before: "-", after: techName || "-" },
          { field: "customerName", label: "Customer", before: "-", after: customerName || "-" },
          { field: "serviceLocationName", label: "Service Location", before: "-", after: serviceLocationName || "-" },
          { field: "equipmentName", label: "Equipment", before: "-", after: getEquipmentDisplayName(selectedQuickEquipment) },
          { field: "scheduledAt", label: "Scheduled Time", before: "-", after: scheduledDate.toLocaleString() },
	          { field: "rate", label: "Generated Price", before: "-", after: moneyFromCents(totalAmountCents) },
	          { field: "laborLineItems", label: "Service Lines", before: "-", after: String(normalizedLaborLineItems.length) },
	        ],
        metadata: {
          sourceTemplateId: selectedScheduleTemplate.id,
          sourceTemplateName: selectedScheduleTemplate.name || "",
          starterPlanId: planId,
          activePlanId: planId,
          activeSolutionId: planId,
          scheduledServiceStopId: serviceStopId,
          scheduledServiceStopInternalId: serviceStopInternalId,
          createdFromEquipmentList: true,
          createdFromEquipmentScheduleModal: true,
          equipmentId: selectedQuickEquipment.id,
          equipmentName: getEquipmentDisplayName(selectedQuickEquipment),
          bodyOfWaterId: selectedQuickEquipment.bodyOfWaterId || "",
          bodyOfWaterName: selectedQuickEquipment.bodyOfWaterName || "",
          equipmentContext,
          adminAssignmentSource: "Equipment schedule popup",
        },
        severity: "success",
        actorUserId: createdByUserId || "",
        actorUserName: createdByUserName,
        actorCompanyUserId: currentCompanyUser?.id || "",
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
      });

      const scheduledJobForLookup = {
        ...jobData,
        serviceStopIds: [serviceStopId],
        scheduledServiceStopId: serviceStopId,
        scheduledServiceStopInternalId: serviceStopInternalId,
      };

      setActiveJobsByEquipmentId((current) => {
        const next = { ...current };
        addJobToEquipmentLookup(
          next,
          selectedQuickEquipment.id,
          scheduledJobForLookup,
          normalizedTasks.length,
          normalizedTasks.map((task) => task.name)
        );
        Object.keys(next).forEach((equipmentId) => {
          next[equipmentId] = [...next[equipmentId]].sort((a, b) => b.dateMillis - a.dateMillis);
        });
        return next;
      });

      closeQuickModal();
      toast.success(`${scheduleJobIntentConfig.label} scheduled.`);
    } catch (error) {
      console.error("Error scheduling equipment job:", error);
      toast.error(`Failed to schedule ${scheduleJobIntentConfig.label.toLowerCase()}.`);
    } finally {
      setSchedulingJob(false);
    }
  };

  const handleCreateMaintenance = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    try {
      const maintenanceDateValue = dateInputToLocalDate(maintenanceDate);
      if (!maintenanceDateValue) {
        toast.error("Choose a maintenance date");
        return;
      }

      const equipmentRef = doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id);
      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(equipmentRef, "serviceHistory", serviceId);
      const selectedCompanyUser = companyUsers.find((user) => user.id === maintenanceCompanyUserId);
      const performedBy = maintenancePerformedBy;
      const techId = performedBy === "Company" ? companyUserRecordId(selectedCompanyUser) : "";
      const techName =
        performedBy === "Company"
          ? companyUserDisplayName(selectedCompanyUser)
          : (maintenanceCustomerName || "").trim();
      const nextServiceDate = computeNextServiceDate(
        maintenanceDateValue,
        selectedQuickEquipment.serviceFrequency,
        selectedQuickEquipment.serviceFrequencyEvery
      );

      await setDoc(serviceHistoryDoc, {
        id: serviceId,
        name: (maintenanceName || "").trim(),
        type: "Maintenance",
        date: maintenanceDateValue,
        performedBy,
        addedBy: "Manual",
        description: maintenanceNotes,
        techId,
        techName,
        jobId: "",
        partIds: [],
      });

      const updates = {
        lastServiceDate: maintenanceDateValue,
        nextServiceDate,
      };
      const currentMaintenanceStatus = normalizeEquipmentStatus(selectedQuickEquipment?.status);
      if (["needsmaintenance", "maintenance", "needsservice"].includes(currentMaintenanceStatus)) {
        updates.status = EQUIPMENT_STATUS.OPERATIONAL;
      }

      await updateDoc(equipmentRef, updates);
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Maintenance record saved");
    } catch (error) {
      console.error("Error creating maintenance history:", error);
      toast.error("Failed to create maintenance record");
    }
  };

  const handleMaintenancePerformedByChange = (value) => {
    setMaintenancePerformedBy(value);
    if (value === "Customer") {
      setMaintenanceCustomerName(selectedQuickEquipment?.customerName || "");
    }
  };

  const handleCreateRepair = async () => {
    if (!selectedQuickEquipment || !recentlySelectedCompany || !can("64")) return;

    try {
      const repairDateValue = dateInputToLocalDate(repairDate);
      if (!repairDateValue) {
        toast.error("Choose a repair date");
        return;
      }

      const equipmentRef = doc(db, "companies", recentlySelectedCompany, "equipment", selectedQuickEquipment.id);
      const serviceId = "com_equ_sh_" + uuidv4();
      const serviceHistoryDoc = doc(equipmentRef, "serviceHistory", serviceId);
      const partsRef = collection(equipmentRef, "parts");
      const partIds = [];

      for (const partName of repairPartsReplaced) {
        const cleanName = (partName || "").trim();
        if (!cleanName) continue;

        const partId = "com_equ_par_" + uuidv4();
        await setDoc(
          doc(partsRef, partId),
          EquipmentPart.toFirestore(
            new EquipmentPart({
              id: partId,
              name: cleanName,
              createdAt: new Date(),
            })
          )
        );
        partIds.push(partId);
      }

      const selectedCompanyUser = companyUsers.find((user) => user.id === repairCompanyUserId);
      const performedBy = repairPerformedBy;
      const techId = performedBy === "Company" ? companyUserRecordId(selectedCompanyUser) : "";
      const techName =
        performedBy === "Company" ? companyUserDisplayName(selectedCompanyUser) : (repairCustomerName || "").trim();

      await setDoc(serviceHistoryDoc, {
        id: serviceId,
        name: (repairName || "").trim(),
        type: "Repair",
        date: repairDateValue,
        performedBy,
        addedBy: "Manual",
        description: repairNotes,
        techId,
        techName,
        jobId: "",
        partIds,
      });
      const updates = {
        status: EQUIPMENT_STATUS.OPERATIONAL,
      };

      await updateDoc(equipmentRef, updates);
      updateEquipmentInLists(selectedQuickEquipment.id, updates);
      closeQuickModal();
      toast.success("Repair record saved");
    } catch (error) {
      console.error("Error creating repair history:", error);
      toast.error("Failed to create repair record");
    }
  };

  const addPart = () => {
    const value = (currentPart || "").trim();
    if (!value) return;
    setRepairPartsReplaced((current) => [...current, value]);
    setCurrentPart("");
  };

  const removePart = (index) => {
    setRepairPartsReplaced((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const openActionEquipment = useMemo(
    () => filteredEquipmentList.find((equipment) => equipment.id === openActionMenuId) || null,
    [filteredEquipmentList, openActionMenuId]
  );

  const closeQuickActions = () => {
    setOpenActionMenuId("");
    setActionMenuPosition(null);
  };

  const toggleQuickActions = (equipmentId, event) => {
    if (openActionMenuId === equipmentId) {
      closeQuickActions();
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const left = Math.min(
      Math.max(8, buttonRect.right - menuWidth),
      window.innerWidth - menuWidth - 8
    );

    setOpenActionMenuId(equipmentId);
    setActionMenuPosition({
      top: buttonRect.bottom + 8,
      left,
    });
  };

  // -----------------------------
  // ✅ Excel download
  // -----------------------------
  const downloadExcel = () => {
    try {
      const rows = filteredEquipmentList.map((eq) => {
        const maintenanceFlag = isNeedsMaintenance(eq);

        return {
          Equipment: eq?.name || eq?.model || eq?.type || "Equipment",
          "Customer Name": eq?.customerName || "",
          "Service Location Address": getEquipmentServiceAddress(eq),
          Name: eq?.name || "",
          Make: eq?.make || "",
          Model: eq?.model || "",
          Type: eq?.type || "",
          Status: maintenanceFlag ? "Needs Maintenance" : displayEquipmentStatus(eq?.status || ""),
          "Active Jobs": getEquipmentActiveJobs(eq)
            .map((job) => [
              job.internalId || job.id,
              job.equipmentTaskNames?.length ? job.equipmentTaskNames.join(", ") : job.description || job.type,
              getJobStatusLabel(job),
            ].filter(Boolean).join(" - "))
            .join("\n"),
          RSS: getEquipmentRecurringStops(eq)
            .map((stop) => [
              recurringStopTechnicianLabel(stop),
              recurringStopDayLabel(stop),
              recurringStopFrequencyLabel(stop),
            ].filter(Boolean).join(" - "))
            .join("\n"),
          "Needs Service (bool)": eq?.needsService ?? "",
          "Last Service Date": eq?.needsService && eq?.lastServiceDate ? format(eq.lastServiceDate, "yyyy-MM-dd") : "",
          "Next Service Date": eq?.needsService && eq?.nextServiceDate ? format(eq.nextServiceDate, "yyyy-MM-dd") : "",
          "Service Frequency": eq?.needsService ? eq?.serviceFrequency || "" : "",
          "Service Frequency Every": eq?.needsService ? eq?.serviceFrequencyEvery ?? "" : "",
          "Is Active": eq?.isActive ?? "",
          Notes: eq?.notes || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Equipment");

      const fileName = `equipment_export_${format(new Date(), "yyyy-MM-dd_HH-mm")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error("Excel export failed:", e);
      appAlert("Excel export failed. Check console for details.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company assets</p>
            <h2 className="mt-1 text-3xl font-bold text-slate-950">Equipment</h2>
            <p className="mt-1 text-sm text-slate-500">Track assets, service schedules, and operational status.</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                Customers shown: {uniqueCustomerCount}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                Equipment shown: {filteredEquipmentList.length}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {can("60") && (
              <Link
                to="/company/equipment/universal-suggestions"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Equipment Suggestions
              </Link>
            )}

            {can("62") && (
              <Link
                to={"/company/equipment/createNew"}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                Create New
              </Link>
            )}
          </div>
        </div>
        </section>

        {/* TOP FILTER BUTTONS */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TopFilterButton
            label="All Equipment"
            count={topCounts.all}
            active={topFilter === "all"}
            onClick={() => handleTopFilterChange("all")}
          />
          <TopFilterButton
            label="Needs Maintenance"
            count={topCounts.maintenance}
            active={topFilter === "maintenance"}
            onClick={() => handleTopFilterChange("maintenance")}
          />
          <TopFilterButton
            label="Needs Repair"
            count={topCounts.repair}
            active={topFilter === "repair"}
            onClick={() => handleTopFilterChange("repair")}
          />
          <TopFilterButton
            label="Non-Operational"
            count={topCounts.nonOperational}
            active={topFilter === "nonOperational"}
            onClick={() => handleTopFilterChange("nonOperational")}
          />
        </section>

        {maintenanceDueCount > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            <span className="font-bold">Maintenance Alert:</span> You have {maintenanceDueCount} item(s) needing maintenance (by status or due date).{" "}
            {loadingActiveJobs
              ? "Checking scheduled job coverage."
              : `Of those, ${maintenanceScheduledJobSummary.jobCount} scheduled job(s) cover ${maintenanceScheduledJobSummary.equipmentCount} item(s).`}
          </div>
        )}

        {(maintenanceEmptyAfterFilters || maintenanceTableMismatch) && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-bold">Maintenance list troubleshooting</p>
                <p className="mt-1">
                  {maintenanceEmptyAfterFilters
                    ? "Due equipment was loaded, but your current search or filters hide it from the table."
                    : "Due equipment was loaded, but the table is empty. Try resetting filters or refreshing the page."}
                </p>
                <div className="mt-3 grid gap-2 text-xs font-semibold sm:grid-cols-2 lg:grid-cols-4">
                  <span>Loaded: {maintenanceTroubleshooting.equipmentLoaded}</span>
                  <span>Due: {maintenanceTroubleshooting.dueByOperationsRule}</span>
                  <span>Shown: {maintenanceTroubleshooting.shownInTable}</span>
                  <span>Search: {maintenanceTroubleshooting.searchTerm}</span>
                  <span>Active: {maintenanceTroubleshooting.activeStatusFilter}</span>
                  <span>Type: {maintenanceTroubleshooting.typeFilter}</span>
                  <span>Needs Service: {maintenanceTroubleshooting.needsServiceFilter}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetDetailFilters();
                  setSearchTerm("");
                }}
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100"
              >
                Reset Filters
              </button>
            </div>
          </div>
        )}

        {equipmentError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            {equipmentError}
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {/* Filters */}
          <div className="border-b border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                onChange={(e) => setSearchTerm(e.target.value)}
                value={searchTerm}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                type="text"
                placeholder="Search customer, address, job, make, model, status, notes..."
              />

              <button
                type="button"
                onClick={() => setShowFilterModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <AdjustmentsHorizontalIcon className="h-5 w-5" />
                <span>Filters{appliedDetailFilterCount ? ` (${appliedDetailFilterCount})` : ""}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>Showing {filteredEquipmentList.length} of {equipmentList.length} item{equipmentList.length === 1 ? "" : "s"}</div>
            <div>{[topFilterLabel, activeStatusFilterLabel, typeFilter || "All types", routineServiceFilterLabel].join(" - ")}</div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-slate-50">
                <tr>
                  {EQUIPMENT_TABLE_SORT_COLUMNS.map(({ field, label }) => (
                    <th
                      key={field}
                      className="cursor-pointer select-none border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      onClick={() => handleSort(field)}
                    >
                      {label}
                      {sortBy === field ? (sortOrder === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                  <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {loadingEquipment && (
                  <tr>
                    <td colSpan={EQUIPMENT_TABLE_COLUMN_COUNT} className="px-6 py-12 text-center text-sm text-slate-500">
                      Loading equipment...
                    </td>
                  </tr>
                )}

                {!loadingEquipment && filteredEquipmentList.map((equipment) => {
                  const maintenanceFlag = isNeedsMaintenance(equipment);
                  const actionMenuOpen = openActionMenuId === equipment.id;
                  const hasQuickActions = can("64") || canScheduleTemplateSelf;
                  const serviceLocation = getEquipmentServiceLocation(equipment);
                  const serviceAddress = getEquipmentServiceAddress(equipment);
                  const activeJobs = getEquipmentActiveJobs(equipment);
                  const recurringStops = getEquipmentRecurringStops(equipment);
                  const noteDraft = noteDrafts[equipment.id] ?? equipment.notes ?? "";
                  const noteDirty = noteDraft !== (equipment.notes || "");
                  const noteSaving = !!savingNoteIds[equipment.id];
                  const noteError = noteErrors[equipment.id];

                  return (
                    <tr key={equipment.id} className="transition hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 text-sm">
                        <EquipmentDetailLink equipment={equipment}>
                          {equipment.customerName}
                        </EquipmentDetailLink>
                      </td>

                      <td className="min-w-[240px] px-5 py-3 text-sm text-slate-700">
                        {equipment.serviceLocationId ? (
                          <Link
                            to={`/company/serviceLocations/detail/${equipment.serviceLocationId}`}
                            className="font-semibold text-slate-800 hover:text-blue-800 hover:underline"
                            title={serviceAddress || serviceLocation?.nickName || ""}
                          >
                            {serviceAddress || serviceLocation?.nickName || "Address unavailable"}
                          </Link>
                        ) : (
                          <span className="text-slate-400">No service location</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                        <EquipmentDetailLink equipment={equipment}>
                          {equipment.make}
                        </EquipmentDetailLink>
                      </td>

                      <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                        <EquipmentDetailLink equipment={equipment}>
                          {equipment.model}
                        </EquipmentDetailLink>
                      </td>

                      <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                        {equipment.type}
                      </td>

                      <td
                        className={`whitespace-nowrap px-5 py-3 text-sm ${equipment.needsService && dateIsDue(equipment.nextServiceDate) ? "font-semibold text-red-600" : "text-slate-700"
                          }`}
                      >
                        {equipment.needsService && equipment.nextServiceDate ? format(equipment.nextServiceDate, "PP") : "—"}
                      </td>

                      <td className="whitespace-nowrap px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                            equipment.status,
                            maintenanceFlag
                          )}`}
                        >
                          {maintenanceFlag ? "Needs Maintenance" : displayEquipmentStatus(equipment.status)}
                        </span>
                      </td>

                      <td className="px-5 py-3 text-sm text-slate-700">
                        <ActiveJobsCell jobs={activeJobs} loading={loadingActiveJobs} />
                      </td>

                      <td className="px-5 py-3 text-sm text-slate-700">
                        <RecurringStopsCell stops={recurringStops} loading={loadingRecurringStops} />
                      </td>

                      <td className="min-w-[260px] px-5 py-3 text-sm text-slate-700">
                        <textarea
                          value={noteDraft}
                          disabled={!can("64") || noteSaving}
                          rows={2}
                          onChange={(event) => handleInlineNoteChange(equipment.id, event.target.value)}
                          onBlur={() => handleInlineNoteSave(equipment)}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                              event.currentTarget.blur();
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              const textarea = event.currentTarget;
                              handleInlineNoteChange(equipment.id, equipment.notes || "");
                              window.setTimeout(() => textarea.blur(), 0);
                            }
                          }}
                          className={[
                            "min-h-[72px] w-full resize-y rounded-md border bg-white px-3 py-2 text-sm text-slate-800 shadow-sm",
                            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100",
                            "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
                            noteError ? "border-red-300" : noteDirty ? "border-blue-300" : "border-slate-300",
                          ].join(" ")}
                          placeholder="Add equipment notes"
                        />
                        <div className="mt-1 min-h-[16px] text-xs">
                          {noteSaving ? (
                            <span className="font-semibold text-blue-600">Saving...</span>
                          ) : noteError ? (
                            <span className="font-semibold text-red-600">{noteError}</span>
                          ) : noteDirty ? (
                            <span className="font-semibold text-blue-600">Unsaved changes</span>
                          ) : null}
                        </div>
                      </td>

                      <td className="relative min-w-[140px] px-5 py-3">
                        <div className="relative inline-flex">
                          <button
                            type="button"
                            disabled={!hasQuickActions}
                            onClick={(event) => toggleQuickActions(equipment.id, event)}
                            aria-haspopup="menu"
                            aria-expanded={actionMenuOpen}
                            aria-label="Open quick actions"
                            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <EllipsisVerticalIcon className="h-5 w-5" />
                            <span>Actions</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!loadingEquipment && filteredEquipmentList.length === 0 && (
                  <tr>
                    <td colSpan={EQUIPMENT_TABLE_COLUMN_COUNT} className="px-6 py-12 text-center text-sm text-slate-500">
                      No equipment found for the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {openActionEquipment && actionMenuPosition && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close quick actions"
              onClick={closeQuickActions}
            />
            <div
              role="menu"
              style={{
                top: actionMenuPosition.top,
                left: actionMenuPosition.left,
              }}
              className="fixed z-50 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-sm"
            >
              {can("64") && (
                <>
                  <QuickActionMenuItem
                    label="Edit Equipment"
                    icon={PencilSquareIcon}
                    onClick={() => openQuickModal(openActionEquipment, "makeModel")}
                  />
                  <QuickActionMenuItem
                    label="Edit Notes"
                    icon={DocumentTextIcon}
                    onClick={() => openQuickModal(openActionEquipment, "notes")}
                  />
                  <QuickActionMenuItem
                    label="Update Status"
                    icon={AdjustmentsHorizontalIcon}
                    onClick={() => openQuickModal(openActionEquipment, "status")}
                  />
                  <QuickActionMenuItem
                    label="Record Maintenance"
                    icon={WrenchScrewdriverIcon}
                    tone="green"
                    onClick={() => openQuickModal(openActionEquipment, "maintenance")}
                  />
                  <QuickActionMenuItem
                    label="Record Repair"
                    icon={WrenchScrewdriverIcon}
                    tone="amber"
                    onClick={() => openQuickModal(openActionEquipment, "repair")}
                  />
                </>
              )}
              {canScheduleTemplateSelf && (
                <>
                  <QuickActionMenuItem
                    label="Schedule Maintenance"
                    icon={BriefcaseIcon}
                    tone="green"
                    onClick={() => openQuickModal(openActionEquipment, SCHEDULE_JOB_MODAL, "maintenance")}
                  />
                  <QuickActionMenuItem
                    label="Schedule Repair"
                    icon={BriefcaseIcon}
                    tone="amber"
                    onClick={() => openQuickModal(openActionEquipment, SCHEDULE_JOB_MODAL, "repair")}
                  />
                </>
              )}
            </div>
          </>
        )}

        {showFilterModal && (
          <ModalShell
            title="Equipment Filters"
            description="Choose which equipment appears on the board."
            onClose={() => setShowFilterModal(false)}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={resetDetailFilters}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Reset
                </button>
                <button
                  onClick={() => setShowFilterModal(false)}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Done
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <Field label="Equipment Status">
                <select
                  onChange={(event) => setActiveStatusFilter(event.target.value)}
                  value={activeStatusFilter}
                  className={inputBase}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="both">Both</option>
                </select>
              </Field>

              <Field label="Type">
                <select
                  onChange={(event) => setTypeFilter(event.target.value)}
                  value={typeFilter}
                  className={inputBase}
                >
                  <option value="">All Types</option>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Needs Service">
                <select
                  onChange={(event) => setNeedsServiceFilter(event.target.value)}
                  value={needsServiceFilter}
                  className={inputBase}
                >
                  <option value="">All</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </Field>
            </div>
          </ModalShell>
        )}

        {activeQuickModal === "makeModel" && selectedQuickEquipment && (
          <ModalShell
            title="Edit Equipment"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEquipment}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Save
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <Field label="Equipment">
                <input
                  value={quickName}
                  onChange={(event) => {
                    setQuickName(event.target.value);
                    applyQuickServiceDefaults({ name: event.target.value });
                  }}
                  className={inputBase}
                />
              </Field>

              <Field label="Catalog Type">
                <select
                  value={catalogTypeId}
                  onChange={(event) => handleCatalogTypeChange(event.target.value)}
                  className={inputBase}
                >
                  <option value={CUSTOM_CATALOG_VALUE}>Custom Type</option>
                  {equipmentTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>

              {catalogTypeId === CUSTOM_CATALOG_VALUE && (
                <Field label="Custom Type">
                  <input
                    value={quickType}
                    onChange={(event) => {
                      setQuickType(event.target.value);
                      setQuickTypeId("");
                      applyQuickServiceDefaults({
                        type: event.target.value,
                        make: "",
                        model: "",
                      });
                    }}
                    className={inputBase}
                  />
                </Field>
              )}

              <Field label="Make">
                <select
                  value={catalogMakeId}
                  onChange={(event) => handleCatalogMakeChange(event.target.value)}
                  className={inputBase}
                  disabled={catalogTypeId !== CUSTOM_CATALOG_VALUE && !equipmentMakes.length}
                >
                  <option value={CUSTOM_CATALOG_VALUE}>Custom Make</option>
                  {equipmentMakes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {catalogMakeId === CUSTOM_CATALOG_VALUE && (
                  <input
                    value={quickMake}
                    onChange={(event) => {
                      setQuickMake(event.target.value);
                      setQuickMakeId("");
                      applyQuickServiceDefaults({
                        make: event.target.value,
                        model: "",
                      });
                    }}
                    className={`${inputBase} mt-2`}
                    placeholder="Custom Make"
                  />
                )}
              </Field>

              <Field label="Model">
                <select
                  value={catalogEquipmentId}
                  onChange={(event) => handleCatalogEquipmentChange(event.target.value)}
                  className={inputBase}
                  disabled={catalogMakeId !== CUSTOM_CATALOG_VALUE && !equipmentModels.length}
                >
                  <option value={CUSTOM_CATALOG_VALUE}>Custom Equipment</option>
                  {equipmentModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.model || item.name}
                    </option>
                  ))}
                </select>
                {catalogEquipmentId === CUSTOM_CATALOG_VALUE && (
                  <input
                    value={quickModel}
                    onChange={(event) => {
                      setQuickModel(event.target.value);
                      setQuickModelId("");
                      setQuickUniversalEquipmentId("");
                      setQuickManualPdfLink("");
                      applyQuickServiceDefaults({ model: event.target.value });
                    }}
                    className={`${inputBase} mt-2`}
                    placeholder="Custom Model"
                  />
                )}
              </Field>

              {quickManualPdfLink && (
                <a
                  href={quickManualPdfLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                  View selected catalog manual
                </a>
              )}

              <Field label="Needs Service">
                <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={quickServiceIsRequired}
                    disabled={quickDefaultsToNeedsService}
                    onChange={(event) => {
                      setQuickNeedsService(event.target.checked);
                      if (event.target.checked) {
                        setQuickServiceFrequency((current) => current || "6");
                        setQuickServiceFrequencyEvery((current) => current || "Month");
                      }
                    }}
                    className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-semibold text-slate-700">
                    {quickServiceIsRequired ? "Yes" : "No"}
                  </span>
                </label>
              </Field>

              {quickServiceIsRequired && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Last Serviced">
                    <input
                      type="date"
                      value={quickLastServiceDate}
                      onChange={(event) => setQuickLastServiceDate(event.target.value)}
                      className={inputBase}
                    />
                  </Field>

                  <Field label="Next Maintenance Date">
                    <input
                      type="date"
                      value={quickNextMaintenanceDate ? format(quickNextMaintenanceDate, "yyyy-MM-dd") : ""}
                      readOnly
                      className={`${inputBase} bg-slate-50`}
                    />
                  </Field>

                  <Field label="Service Frequency">
                    <div className="grid grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)] gap-2">
                      <input
                        type="number"
                        min="1"
                        value={quickServiceFrequency}
                        onChange={(event) => setQuickServiceFrequency(event.target.value)}
                        className={inputBase}
                        placeholder="6"
                      />
                      <select
                        value={quickServiceFrequencyEvery}
                        onChange={(event) => setQuickServiceFrequencyEvery(event.target.value)}
                        className={inputBase}
                      >
                        <option value="">Unit</option>
                        <option value="Day">Days</option>
                        <option value="Week">Weeks</option>
                        <option value="Month">Months</option>
                        <option value="Year">Years</option>
                      </select>
                    </div>
                  </Field>
                </div>
              )}

              <Field label="Notes">
                <textarea
                  value={quickNotes}
                  onChange={(event) => setQuickNotes(event.target.value)}
                  className={inputBase}
                  rows={4}
                />
              </Field>
            </div>
          </ModalShell>
        )}

        {activeQuickModal === "notes" && selectedQuickEquipment && (
          <ModalShell
            title="Edit Notes"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNotes}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Save
                </button>
              </div>
            }
          >
            <Field label="Notes">
              <textarea
                value={quickNotes}
                onChange={(event) => setQuickNotes(event.target.value)}
                className={inputBase}
                rows={6}
              />
            </Field>
          </ModalShell>
        )}

        {activeQuickModal === "status" && selectedQuickEquipment && (
          <ModalShell
            title="Update Status"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateStatus}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Save
                </button>
              </div>
            }
          >
            <Field label="Status">
              <select
                value={quickStatus}
                onChange={(event) => setQuickStatus(event.target.value)}
                className={inputBase}
              >
                <option value="" disabled>
                  Select status
                </option>
                {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </Field>
          </ModalShell>
        )}

        {activeQuickModal === SCHEDULE_JOB_MODAL && selectedQuickEquipment && (
          <ModalShell
            title={scheduleJobIntentConfig.actionLabel}
            onClose={schedulingJob ? undefined : closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  disabled={schedulingJob}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleScheduleEquipmentJob}
                  disabled={!canCreateScheduledEquipmentJob}
                  className={`${modalPrimaryButton} disabled:cursor-not-allowed disabled:opacity-60`}
                  type="button"
                >
                  {schedulingJob ? "Scheduling..." : scheduleJobIntentConfig.actionLabel}
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Equipment</p>
                  <p className="mt-1 font-semibold text-slate-900">{getEquipmentDisplayName(selectedQuickEquipment)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedQuickEquipment.customerName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Service Location</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedQuickEquipmentServiceAddress || "—"}</p>
                </div>
              </div>

              {scheduleEquipmentIsMissingLocation && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This equipment needs a customer and service location before a job can be scheduled.
                </div>
              )}

              <Field label="Template">
                <select
                  value={scheduleTemplateId}
                  onChange={(event) => setScheduleTemplateId(event.target.value)}
                  disabled={loadingJobTemplates || schedulingJob}
                  className={inputBase}
                >
                  <option value="">Select template</option>
                  {scheduleTemplateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name || "Template"}
                    </option>
                  ))}
                </select>
                {!loadingJobTemplates && scheduleTemplateOptions.length === 0 && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No active technician-enabled templates found.
                  </p>
                )}
              </Field>

              {selectedScheduleTemplate && (
                <div className="grid gap-3 text-sm sm:grid-cols-5">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tasks</p>
                    <p className="mt-1 font-bold text-slate-950">{scheduleTemplateDetails.tasks.length}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Services</p>
                    <p className="mt-1 font-bold text-slate-950">{scheduleTemplateDetails.laborLineItems.length}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Stops</p>
                    <p className="mt-1 font-bold text-slate-950">{scheduleTemplateDetails.plannedServiceStops.length || 1}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Items</p>
                    <p className="mt-1 font-bold text-slate-950">{scheduleTemplateDetails.shoppingItems.length}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Price</p>
                    <p className="mt-1 font-bold text-slate-950">{moneyFromCents(scheduleGeneratedPriceCents)}</p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Admin">
                  <select
                    value={scheduleAdminId}
                    onChange={(event) => setScheduleAdminId(event.target.value)}
                    disabled={schedulingJob}
                    className={inputBase}
                  >
                    <option value="">Select admin</option>
                    {scheduleAdminOptions.map((admin) => (
                      <option key={admin.id || admin.userId} value={admin.userId || admin.id}>
                        {admin.label || admin.userName || "Admin"}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Technician">
                  <select
                    value={scheduleTechnicianId}
                    onChange={(event) => setScheduleTechnicianId(event.target.value)}
                    disabled={schedulingJob || !canScheduleTemplateForOthers}
                    className={inputBase}
                  >
                    <option value="">Select technician</option>
                    {scheduleTechnicianOptions.map((technician) => (
                      <option key={technician.id || technician.userId} value={technician.userId || technician.id}>
                        {technician.label || technician.userName || "Technician"}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Scheduled Time">
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  onChange={(event) => setScheduleDateTime(event.target.value)}
                  disabled={schedulingJob}
                  className={inputBase}
                />
              </Field>

              <Field label="Work Notes">
                <textarea
                  value={scheduleNotes}
                  onChange={(event) => setScheduleNotes(event.target.value)}
                  disabled={schedulingJob}
                  className={inputBase}
                  rows={4}
                />
              </Field>

              {loadingScheduleTemplateDetails && (
                <p className="text-sm font-semibold text-blue-700">Loading template details...</p>
              )}
            </div>
          </ModalShell>
        )}

        {activeQuickModal === "maintenance" && selectedQuickEquipment && (
          <ModalShell
            title="Create Maintenance Record"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateMaintenance}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Create
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedQuickEquipment.customerName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Address</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedQuickEquipmentServiceAddress || "—"}</p>
                </div>
              </div>

              <Field label="Name">
                <input
                  value={maintenanceName}
                  onChange={(event) => setMaintenanceName(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={maintenanceDate}
                  onChange={(event) => setMaintenanceDate(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Performed By">
                <select
                  value={maintenancePerformedBy}
                  onChange={(event) => handleMaintenancePerformedByChange(event.target.value)}
                  className={inputBase}
                >
                  <option value="Company">Company</option>
                  <option value="Customer">Customer</option>
                </select>
              </Field>

              {maintenancePerformedBy === "Company" ? (
                <Field label="Company User">
                  <select
                    value={maintenanceCompanyUserId}
                    onChange={(event) => setMaintenanceCompanyUserId(event.target.value)}
                    className={inputBase}
                  >
                    {companyUsers.length === 0 ? (
                      <option value="">No company users found</option>
                    ) : (
                      companyUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {companyUserDisplayName(user) || "Technician"}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
              ) : (
                <Field label="Customer Name">
                  <input
                    value={maintenanceCustomerName}
                    onChange={(event) => setMaintenanceCustomerName(event.target.value)}
                    className={inputBase}
                  />
                </Field>
              )}

              <Field label="Notes">
                <textarea
                  value={maintenanceNotes}
                  onChange={(event) => setMaintenanceNotes(event.target.value)}
                  className={inputBase}
                  rows={4}
                />
              </Field>
            </div>
          </ModalShell>
        )}

        {activeQuickModal === "repair" && selectedQuickEquipment && (
          <ModalShell
            title="Create Repair Record"
            onClose={closeQuickModal}
            footer={
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeQuickModal}
                  className={modalSecondaryButton}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateRepair}
                  className={modalPrimaryButton}
                  type="button"
                >
                  Create
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedQuickEquipment.customerName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Address</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedQuickEquipmentServiceAddress || "—"}</p>
                </div>
              </div>

              <Field label="Name">
                <input
                  value={repairName}
                  onChange={(event) => setRepairName(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={repairDate}
                  onChange={(event) => setRepairDate(event.target.value)}
                  className={inputBase}
                />
              </Field>

              <Field label="Performed By">
                <select
                  value={repairPerformedBy}
                  onChange={(event) => setRepairPerformedBy(event.target.value)}
                  className={inputBase}
                >
                  <option value="Company">Company</option>
                  <option value="Customer">Customer</option>
                </select>
              </Field>

              {repairPerformedBy === "Company" ? (
                <Field label="Company User">
                  <select
                    value={repairCompanyUserId}
                    onChange={(event) => setRepairCompanyUserId(event.target.value)}
                    className={inputBase}
                  >
                    {companyUsers.length === 0 ? (
                      <option value="">No company users found</option>
                    ) : (
                      companyUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {companyUserDisplayName(user) || "Technician"}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
              ) : (
                <Field label="Customer Name">
                  <input
                    value={repairCustomerName}
                    onChange={(event) => setRepairCustomerName(event.target.value)}
                    className={inputBase}
                  />
                </Field>
              )}

              <Field label="Parts Replaced">
                <div className="flex gap-2">
                  <input
                    value={currentPart}
                    onChange={(event) => setCurrentPart(event.target.value)}
                    className={inputBase}
                  />
                  <button
                    onClick={addPart}
                    className="shrink-0 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    type="button"
                  >
                    Add
                  </button>
                </div>

                {!!repairPartsReplaced.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {repairPartsReplaced.map((part, index) => (
                      <span
                        key={`${part}-${index}`}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700"
                      >
                        {part}
                        <button
                          onClick={() => removePart(index)}
                          className="font-bold text-slate-500 hover:text-red-600"
                          aria-label="Remove part"
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Notes">
                <textarea
                  value={repairNotes}
                  onChange={(event) => setRepairNotes(event.target.value)}
                  className={inputBase}
                  rows={4}
                />
              </Field>
            </div>
          </ModalShell>
        )}

        {/* ✅ Download button at bottom */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={downloadExcel}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
          >
            Download Excel
          </button>
        </div>
      </div>
    </div>
  );
}
