import React, { useCallback, useEffect, useMemo, useState, useContext } from "react";
import { Link, useParams, useNavigate, UNSAFE_NavigationContext } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import Select from "react-select";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { GoHistory } from "react-icons/go";
import {
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CurrencyDollarIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  EnvelopeIcon,
  PencilSquareIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import {
  estimateServiceStopPaySummary,
  estimatePlannedServiceStopPayRange,
  formatPayRate,
} from "../../../utils/payroll/payEstimate";
import { runWorkCompletionEffects } from "../../../utils/workCompletionEffects";
import { promptForReplacementInstallDetails } from "../../../utils/replacementTasks";
import { EQUIPMENT_STATUS, EQUIPMENT_STATUS_OPTIONS } from "../../../utils/models/Equipment";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID,
  UPDATE_JOBS_PERMISSION_ID,
} from "../../../utils/companyPermissions";
import { getCallableAuthPayload } from "../../../utils/callableAuth";
import {
  salesCollectionNames,
  SalesAgreementSourceType,
  SalesAgreementStatus,
  SalesCatalogBillingBehavior,
  SalesCatalogItemType,
  SalesCatalogSourceType,
} from "../../../utils/models/Sales";
import { salesCatalogCollection } from "../../../utils/sales/salesFirestore";
import {
  BODY_OF_WATER_JOB_TASK_TYPES,
  EQUIPMENT_JOB_TASK_TYPES,
  INSTALL_ITEM_JOB_TASK_TYPES,
  jobTaskTypeOptionsFromDocs,
} from "../../../utils/jobTaskTypes";
import {
  SUGGESTED_WORK_STATUS,
  getSuggestedWorkTierLabel,
  normalizeSuggestedWorkTier,
  suggestedWorkIdForSource,
} from "../../../utils/models/SuggestedWork";
import {
  DEFAULT_ISSUE_PRIORITY,
  DEFAULT_JOB_PLAN_TIER,
  ISSUE_PRIORITY_OPTIONS,
  JOB_PLAN_STATUS,
  JOB_PLAN_TIER_OPTIONS,
  getJobPlanDisplayName,
  getJobPlanRecommendationDisplay,
  getJobPlanRecommendationLabel,
  getIssuePriorityLabel,
  getIssuePriorityTone,
  getJobPlanTierTone,
  normalizeIssuePriority,
  normalizeJobPlanTier,
  normalizeJobPlanStatus,
} from "../../../utils/models/JobPlan";
import { appConfirm, appPrompt } from "../../../utils/appDialog";
import { fetchCompanyVendors } from "../../../utils/vendors";
import {
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORY,
  DEFAULT_SUBCATEGORY,
  DEFAULT_UOM,
  SUBCATEGORY_OPTIONS,
  UOM_OPTIONS,
} from "../databaseItems/databaseItemOptions";
import {
  getItemPhotoUrl,
  itemPhotoFieldsFromSource,
} from "../../../utils/itemPhotos";
import {
  SHOPPING_LIST_INVOICED_STATUS,
  isShoppingListStatusClosed,
  syncLinkedShoppingPurchase,
} from "../../../utils/shoppingPurchaseSync";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../../../utils/companyUsers";
import ShareItemButton from "../../components/share/ShareItemButton";
import {
  JOB_BILLING_STATUS,
  JOB_OPERATION_STATUS,
} from "../../../utils/jobStatusFilters";

/**
 * JobDetailView
 * - Added Billing tab for estimate / invoice lifecycle
 * - Billing tab includes:
 *   - Contract / estimate history
 *   - Contract snapshot
 *   - Send estimate
 *   - Mark estimate accepted
 *   - Mark invoiced
 * - Fixed shopping delete path bug
 */

const JOB_DETAIL_SECTION_LOADING = {
  shell: true,
  snapshot: true,
  plannedOverview: true,
  plannedWork: true,
  plannedMaterials: true,
  workOffers: true,
  actual: true,
};

const createSectionLoadingState = () => ({ ...JOB_DETAIL_SECTION_LOADING });

const clearSectionLoadingState = () =>
  Object.keys(JOB_DETAIL_SECTION_LOADING).reduce((next, key) => {
    next[key] = false;
    return next;
  }, {});

const TASK_STATUS_OPTIONS = ["Unassigned", "Scheduled", "In Progress", "Finished"];
const CUSTOMER_NOTE_AUDIENCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "office", label: "Office" },
  { value: "field", label: "Field" },
];
const JOB_DETAIL_SECTIONS = [
  { id: "overview", tab: "Plans", label: "Overview", helper: "Customer options for solving this job" },
  { id: "create-plans", tab: "Planned", label: "Create Plans", helper: "Create estimates based on services and products" },
  { id: "actual", tab: "Actual", label: "Actual", helper: "Service stops, payroll, and purchased parts" },
  { id: "billing", tab: "Billing", label: "Billing", helper: "Estimate, invoice, and payment lifecycle" },
  { id: "history", tab: "History", label: "History", helper: "Change orders and job audit trail" },
];
const DEFAULT_JOB_DETAIL_SECTION_ID = "overview";
const JOB_DETAIL_TABS = JOB_DETAIL_SECTIONS.map((section) => section.tab);
const JOB_DETAIL_SECTION_IDS = JOB_DETAIL_SECTIONS.map((section) => section.id);
const JOB_DETAIL_TAB_BY_SECTION_ID = JOB_DETAIL_SECTIONS.reduce((map, section) => {
  map[section.id] = section.tab;
  return map;
}, {});
const JOB_DETAIL_SECTION_ID_BY_TAB = JOB_DETAIL_SECTIONS.reduce((map, section) => {
  map[section.tab] = section.id;
  return map;
}, {});
const DETAIL_PANEL_IDS_BY_SECTION = {
  Plans: ["plans-overview", "plans-options"],
  Planned: ["planned-editor"],
  Actual: ["actual-service-stops", "actual-work", "actual-offers"],
  Billing: ["billing-summary", "billing-agreements"],
  History: ["history-summary", "history-change-orders"],
};
const DEFAULT_OPEN_DETAIL_PANELS = {
  "plans-overview": true,
  "plans-options": true,
  "planned-editor": true,
  "actual-service-stops": true,
  "actual-work": false,
  "actual-offers": false,
  "billing-summary": true,
  "billing-agreements": false,
  "history-summary": true,
  "history-change-orders": false,
};
const withFirestoreDocId = (docSnap) => {
  const data = docSnap.data();
  const firestoreId = docSnap.id;

  return {
    ...data,
    id: firestoreId,
  };
};
const getFirestoreDocId = (record = {}) =>
  record.firestoreId || record.docId || record.id || "";
const PLAN_EDITOR_UNSAVED_WARNING =
  "You have unsaved plan changes. Leave this page and discard those changes?";
const PLAN_EDITOR_DISCARD_WARNING =
  "You have unsaved plan changes. Load another plan and discard those changes?";

const salesPaymentTermsDueDays = (paymentTerms = "") => {
  const key = String(paymentTerms || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (key === "net7") return 7;
  if (key === "net14") return 14;
  if (key === "net15") return 15;
  if (key === "net30") return 30;
  return 0;
};

const salesDueDateForTerms = (paymentTerms = "dueOnReceipt") => {
  const dueDate = new Date();
  dueDate.setHours(0, 0, 0, 0);
  dueDate.setDate(dueDate.getDate() + salesPaymentTermsDueDays(paymentTerms));
  return dueDate;
};

const EMPTY_TASK_EDIT_FORM = {
  name: "",
  type: "",
  status: "Unassigned",
  laborCost: "",
  billingLaborPrice: "",
  estimatedTime: "",
  bodyOfWaterId: "",
  equipmentId: "",
  dataBaseItemId: "",
  quantity: "1",
  customerApproval: false,
};

const EMPTY_PLANNED_STOP_FORM = {
  serviceStopTypeId: "",
  name: "",
  description: "",
  estimatedMinutes: "0",
  taskIds: [],
};

const EMPTY_LABOR_LINE_FORM = {
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  internalCost: "0",
  taskIds: [],
  plannedServiceStopIds: [],
};

const EMPTY_SHOPPING_EDIT_FORM = {
  name: "",
  description: "",
  status: "",
  quantity: "1",
  plannedUnitCost: "0.00",
  plannedUnitPrice: "0.00",
  linkedTaskId: "",
  customerApprovalRequired: false,
  updateDatabaseItem: false,
};

const PLANNED_MATERIAL_STATUS_OPTIONS = [
  "Needs Customer Approval",
  "Ready to Purchase",
  "Need to Purchase",
  "Purchased",
  "Delivered",
  "Installed",
  "Customer Rejected",
  "Cancelled",
];

const JobHeaderActionMenuItem = ({
  label,
  icon: Icon,
  tone = "slate",
  onClick,
  disabled = false,
}) => {
  const toneClasses =
    tone === "amber"
      ? "text-amber-700 hover:bg-amber-50 data-[focus]:bg-amber-50"
      : tone === "emerald"
        ? "text-emerald-700 hover:bg-emerald-50 data-[focus]:bg-emerald-50"
        : tone === "blue"
          ? "text-blue-700 hover:bg-blue-50 data-[focus]:bg-blue-50"
          : tone === "violet"
            ? "text-violet-700 hover:bg-violet-50 data-[focus]:bg-violet-50"
            : "text-slate-700 hover:bg-slate-50 data-[focus]:bg-slate-50";

  return (
    <MenuItem disabled={disabled}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={[
          "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
          toneClasses,
        ].join(" ")}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{label}</span>
      </button>
    </MenuItem>
  );
};

const createEmptyShoppingDbItemForm = (vendor = null) => ({
  name: "",
  rate: "",
  sellPrice: "",
  billable: false,
  sku: "",
  vendor,
  uom: DEFAULT_UOM,
  category: DEFAULT_CATEGORY,
  subcategory: DEFAULT_SUBCATEGORY,
  color: "",
  size: "",
  description: "",
  tracking: "",
});

const buildShoppingDbItemOption = (data = {}, docId = "") => {
  const id = data.id || docId;
  const name = data.name || "Unnamed Item";
  const sku = data.sku || "";
  const rate = Number(data.rate || 0);
  const sellPrice = Number(data.sellPrice ?? data.billingRate ?? data.rate ?? 0);

  return {
    id,
    name,
    description: data.description || "",
    genericItemId: data.genericItemId || "",
    dbItemId: id,
    rate,
    sellPrice,
    billingRate: Number(data.billingRate ?? sellPrice),
    cost: Number(data.cost || data.rate || 0),
    category: data.category || "",
    subCategory: data.subCategory || "",
    UOM: data.UOM || "",
    sku,
    size: data.size || "",
    color: data.color || "",
    storeName: data.storeName || "",
    venderId: data.venderId || data.vendorId || "",
    vendorId: data.vendorId || data.venderId || "",
    billable: Boolean(data.billable),
    tracking: data.tracking || "",
    photoUrl: getItemPhotoUrl(data),
    imageUrl: data.imageUrl || data.imageURL || "",
    primaryPhotoUrl: data.primaryPhotoUrl || "",
    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
    label: [name, sku].filter(Boolean).join(" - "),
    value: id,
  };
};

const useUnsavedChangesWarning = (when, message) => {
  const navigationContext = useContext(UNSAFE_NavigationContext);
  const navigator = navigationContext?.navigator;

  useEffect(() => {
    if (!when || typeof window === "undefined") return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [message, when]);

  useEffect(() => {
    if (!when || typeof navigator?.block !== "function") return undefined;

    const unblock = navigator.block((transition) => {
      appConfirm({
        title: "Unsaved Changes",
        message,
        confirmLabel: "Discard Changes",
        variant: "danger",
      }).then((confirmed) => {
        if (confirmed) {
          unblock();
          transition.retry();
        }
      });
    });

    return unblock;
  }, [message, navigator, when]);
};

const planSnapshotCents = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const planSnapshotNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const getPlanSnapshotMaterialCostCents = (item = {}) => {
  if (item.plannedTotalCostCents !== undefined && item.plannedTotalCostCents !== null) {
    return planSnapshotCents(item.plannedTotalCostCents);
  }

  return Math.round(planSnapshotCents(item.plannedUnitCostCents ?? item.cost) * planSnapshotNumber(item.quantity));
};

const getPlanSnapshotMaterialPriceCents = (item = {}) => {
  if (item.plannedTotalPriceCents !== undefined && item.plannedTotalPriceCents !== null) {
    return planSnapshotCents(item.plannedTotalPriceCents);
  }

  return Math.round(planSnapshotCents(item.plannedUnitPriceCents ?? item.price) * planSnapshotNumber(item.quantity));
};

const getPlanSnapshotTaskBillingLaborCents = (task = {}) => {
  const explicitBillingValue =
    task.billingLaborPriceCents ??
    task.customerLaborPriceCents ??
    task.billingLaborRateCents ??
    task.laborBillingRateCents ??
    task.billableLaborCents;

  if (explicitBillingValue !== undefined && explicitBillingValue !== null && explicitBillingValue !== "") {
    return planSnapshotCents(explicitBillingValue);
  }

  return planSnapshotCents(task.contractedRate);
};

const laborLineSnapshotIdValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return value.id || value.value || value.docId || "";
};

const laborLineSnapshotArray = (value) => (
  Array.isArray(value)
    ? value.map(laborLineSnapshotIdValue).filter(Boolean)
    : laborLineSnapshotIdValue(value)
      ? [laborLineSnapshotIdValue(value)]
      : []
);

const normalizeJobLaborLineItems = (items = []) => (
  (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const quantity = Math.max(planSnapshotNumber(item.quantity || item.defaultQuantity || 1), 1);
      const totalPriceCents = planSnapshotCents(
        item.totalPriceCents ??
        item.totalAmountCents ??
        item.amount ??
        item.price ??
        Math.round(planSnapshotCents(item.unitPriceCents ?? item.unitAmountCents ?? item.rate) * quantity)
      );
      const unitPriceCents = planSnapshotCents(
        item.unitPriceCents ??
        item.unitAmountCents ??
        (quantity ? Math.round(totalPriceCents / quantity) : totalPriceCents)
      );
      const taskIds = laborLineSnapshotArray(item.taskIds?.length ? item.taskIds : item.laborLineTaskIds);
      const plannedServiceStopIds = laborLineSnapshotArray(
        item.plannedServiceStopIds?.length
          ? item.plannedServiceStopIds
          : item.laborLinePlannedServiceStopIds
      );

      return {
        ...item,
        id: item.id || item.laborLineId || `labor_line_${index}`,
        laborLineId: item.laborLineId || item.id || `labor_line_${index}`,
        name: item.name || item.title || `Labor ${index + 1}`,
        description: item.description || "",
        quantity,
        unitPriceCents,
        totalPriceCents,
        internalCostCents: planSnapshotCents(
          item.internalCostCents ??
          item.internalLaborCostCents ??
          item.laborCostCents ??
          item.unitCostCents ??
          item.cost
        ),
        taskIds,
        laborLineTaskIds: taskIds,
        plannedServiceStopIds,
        laborLinePlannedServiceStopIds: plannedServiceStopIds,
        sortOrder: Number(item.sortOrder ?? index),
        salesItemType: item.salesItemType || SalesCatalogItemType.labor,
        billingBehavior: item.billingBehavior || SalesCatalogBillingBehavior.oneTime,
        sourceType: item.sourceType || SalesCatalogSourceType.manual,
      };
    })
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
);

const JOB_SERVICE_CATALOG_TYPES = new Set([
  SalesCatalogItemType.service,
  SalesCatalogItemType.recurringService,
  SalesCatalogItemType.labor,
  SalesCatalogItemType.manual,
]);

const isJobServiceCatalogItem = (item = {}) => (
  item.active !== false && JOB_SERVICE_CATALOG_TYPES.has(item.type || SalesCatalogItemType.service)
);

const getCatalogServiceTaskTemplates = (item = {}) => {
  const templates =
    item.metadata?.taskTemplates ||
    item.metadata?.tasks ||
    item.taskTemplates ||
    [];

  return Array.isArray(templates) ? templates.filter(Boolean) : [];
};

const buildPlanEditorSnapshot = ({
  planId = "",
  title = "",
  description = "",
  tasks = [],
  plannedStops = [],
  laborLines = [],
  materials = [],
} = {}) => {
  const cleanString = (value) => String(value || "").trim();
  const sortEditableItems = (items = []) =>
    (items || [])
      .map((item, index) => ({ item: item || {}, index }))
      .sort((a, b) => {
        const orderDelta = planSnapshotNumber(a.item.sortOrder ?? a.index) - planSnapshotNumber(b.item.sortOrder ?? b.index);
        if (orderDelta !== 0) return orderDelta;
        return cleanString(a.item.id).localeCompare(cleanString(b.item.id));
      });

  return JSON.stringify({
    planId: cleanString(planId),
    title: cleanString(title),
    description: cleanString(description),
    tasks: sortEditableItems(tasks).map(({ item, index }) => ({
      id: cleanString(item.id),
      sortOrder: planSnapshotNumber(item.sortOrder ?? index),
      name: cleanString(item.name),
      description: cleanString(item.description),
      type: cleanString(item.type),
      status: cleanString(item.status || "Unassigned"),
      contractedRate: planSnapshotCents(item.contractedRate),
      billingLaborPriceCents: getPlanSnapshotTaskBillingLaborCents(item),
      estimatedTime: planSnapshotNumber(item.estimatedTime || item.estimatedMinutes),
      bodyOfWaterId: cleanString(item.bodyOfWaterId),
      equipmentId: cleanString(item.equipmentId),
      dataBaseItemId: cleanString(item.dataBaseItemId || item.dbItemId),
      quantity: planSnapshotNumber(item.quantity || 1),
      customerApproval: Boolean(item.customerApproval || item.customerApprovalRequired),
    })),
    plannedStops: sortEditableItems(plannedStops).map(({ item, index }) => ({
      id: cleanString(item.id),
      sortOrder: planSnapshotNumber(item.sortOrder ?? index),
      name: cleanString(item.name),
      description: cleanString(item.description),
      type: cleanString(item.type || item.serviceStopTypeName),
      serviceStopTypeId: cleanString(item.serviceStopTypeId || item.typeId),
      estimatedMinutes: planSnapshotNumber(item.estimatedMinutes || item.duration || item.estimatedDuration),
      plannedLaborCostCents: planSnapshotCents(item.plannedLaborCostCents ?? item.estimatedLaborCostCents ?? item.laborCostCents),
      plannedLaborNotes: cleanString(item.plannedLaborNotes),
      taskIds: [...(Array.isArray(item.taskIds) ? item.taskIds : [])].map(cleanString).sort(),
    })),
    laborLines: sortEditableItems(laborLines).map(({ item, index }) => {
      const quantity = Math.max(planSnapshotNumber(item.quantity || 1), 1);
      const totalPriceCents = planSnapshotCents(
        item.totalPriceCents ??
        item.totalAmountCents ??
        item.amount ??
        planSnapshotCents(item.unitPriceCents ?? item.unitAmountCents) * quantity
      );
      const unitPriceCents = planSnapshotCents(
        item.unitPriceCents ??
        item.unitAmountCents ??
        (quantity ? Math.round(totalPriceCents / quantity) : totalPriceCents)
      );

      return {
        id: cleanString(item.id),
        sortOrder: planSnapshotNumber(item.sortOrder ?? index),
        name: cleanString(item.name || item.title),
        description: cleanString(item.description),
        quantity,
        unitPriceCents,
        totalPriceCents,
        internalCostCents: planSnapshotCents(item.internalCostCents ?? item.internalLaborCostCents ?? item.laborCostCents ?? item.cost),
        taskIds: [
          ...(Array.isArray(item.taskIds)
            ? item.taskIds
            : Array.isArray(item.laborLineTaskIds)
              ? item.laborLineTaskIds
              : []),
        ].map(cleanString).sort(),
        plannedServiceStopIds: [
          ...(Array.isArray(item.plannedServiceStopIds)
            ? item.plannedServiceStopIds
            : Array.isArray(item.laborLinePlannedServiceStopIds)
              ? item.laborLinePlannedServiceStopIds
              : []),
        ].map(cleanString).sort(),
      };
    }),
    materials: sortEditableItems(materials).map(({ item, index }) => ({
      id: cleanString(item.id),
      sortOrder: planSnapshotNumber(item.sortOrder ?? index),
      name: cleanString(item.name || item.dbItemName),
      description: cleanString(item.description),
      subCategory: cleanString(item.subCategory),
      genericItemId: cleanString(item.genericItemId),
      dbItemId: cleanString(item.dbItemId),
      linkedTaskId: cleanString(item.linkedTaskId),
      quantity: planSnapshotNumber(item.quantity || item.quantityString || 1),
      plannedUnitCostCents: planSnapshotCents(item.plannedUnitCostCents ?? item.cost),
      plannedUnitPriceCents: planSnapshotCents(item.plannedUnitPriceCents ?? item.price),
      plannedTotalCostCents: getPlanSnapshotMaterialCostCents(item),
      plannedTotalPriceCents: getPlanSnapshotMaterialPriceCents(item),
      customerApprovalRequired: Boolean(item.customerApprovalRequired),
      customerApprovalStatus: cleanString(item.customerApprovalStatus),
    })),
  });
};

const JobDetailView = () => {
  const { jobId, section } = useParams();
  const navigate = useNavigate();

  // Auth / company context
  const authCtx = useContext(Context);
  const { recentlySelectedCompany, dataBaseUser } = authCtx;
  const { can, requirePermission } = useCompanyPermissions();
  const salesWorkflowEnabled = authCtx?.isFeatureEnabled?.("feature_flag_004") === true;

  const currentUser =
    authCtx?.currentUser || authCtx?.user || authCtx?.currentuser || authCtx || {};

  const getUserId = () => currentUser?.uid || currentUser?.id || "";
  const getUserName = () =>
    currentUser?.displayName || currentUser?.userName || currentUser?.name || "Unknown";

  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(() => createSectionLoadingState());
  const [edit, setEdit] = useState(false);

  const [job, setJob] = useState({
    adminId: "",
    adminName: "",
    billingStatus: "",
    bodyOfWaterId: "",
    bodyOfWaterName: "",
    chemicals: "",
    customerId: "",
    customerName: "",
    description: "",
    electricalParts: "",
    equipmentId: "",
    equipmentName: "",
    id: "",
    internalId: "",
    installationParts: "",
    jobTemplateId: "",
    laborCost: "",
    miscParts: "",
    operationStatus: "",
    pvcParts: "",
    rate: 0,
    repairRequestId: "",
    repairRequestSourcePath: "",
    serviceLocationId: "",
    serviceStopIds: [],
    type: "",
    issuePriorityLevel: DEFAULT_ISSUE_PRIORITY,
    issuePriorityLabel: getIssuePriorityLabel(DEFAULT_ISSUE_PRIORITY),
    solutionTier: DEFAULT_ISSUE_PRIORITY,
    solutionTierLabel: getIssuePriorityLabel(DEFAULT_ISSUE_PRIORITY),
    activePlanId: "",
    activePlanTier: DEFAULT_JOB_PLAN_TIER,
    activePlanTierLabel: getJobPlanRecommendationLabel(DEFAULT_JOB_PLAN_TIER),
    acceptedPlanId: "",
    activeSolutionId: "",
    activeSolutionTier: DEFAULT_JOB_PLAN_TIER,
    activeSolutionTierLabel: getJobPlanRecommendationLabel(DEFAULT_JOB_PLAN_TIER),
    acceptedSolutionId: "",
    planSelectionStatus: "",
    solutionSelectionStatus: "",
    dateCreated: null,
    updatedAt: null,
    updatedAtMillis: 0,
  });

  const isTemplateWorkOrder = Boolean(
    job.sourceTemplateId ||
    job.jobTemplateId ||
    (job.createdFromBasicWorkOrderForm && job.basicWorkOrderMode === "template")
  );
  const canUpdateCurrentJob = can(UPDATE_JOBS_PERMISSION_ID) ||
    (isTemplateWorkOrder && can(EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID));
  const requireUpdateCurrentJob = (action = "update jobs") => {
    if (canUpdateCurrentJob) return true;
    return requirePermission(UPDATE_JOBS_PERMISSION_ID, action);
  };

  const [customer, setCustomer] = useState({
    id: "",
    firstName: "",
    lastName: "",
    phoneNumber: "",
    email: "",
    billingStreetAddress: "",
    billingCity: "",
    billingState: "",
    billingZip: "",
    billingNotes: "",
    active: true,
    verified: false,
  });

  const [serviceLocation, setServiceLocation] = useState({
    bodiesOfWaterId: [],
    gateCode: "",
    nickName: "",
    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    active: true,
    id: "",
  });

  const [serviceStops, setServiceStops] = useState([]);
  const [showAllActualServiceStops, setShowAllActualServiceStops] = useState(false);
  const [plannedServiceStops, setPlannedServiceStops] = useState([]);
  const [newPlannedStop, setNewPlannedStop] = useState(false);
  const [savingPlannedStop, setSavingPlannedStop] = useState(false);
  const [plannedStopForm, setPlannedStopForm] = useState(EMPTY_PLANNED_STOP_FORM);
  const [laborLineItems, setLaborLineItems] = useState([]);
  const [newLaborLine, setNewLaborLine] = useState(false);
  const [editingLaborLineId, setEditingLaborLineId] = useState("");
  const [savingLaborLine, setSavingLaborLine] = useState(false);
  const [laborLineForm, setLaborLineForm] = useState(EMPTY_LABOR_LINE_FORM);
  const [serviceCatalogItems, setServiceCatalogItems] = useState([]);
  const [loadingServiceCatalogItems, setLoadingServiceCatalogItems] = useState(false);
  const [showServiceCatalogPicker, setShowServiceCatalogPicker] = useState(false);
  const [addingCatalogServiceId, setAddingCatalogServiceId] = useState("");
  const [newTaskLaborLineId, setNewTaskLaborLineId] = useState("");
  const [newPlannedStopLaborLineId, setNewPlannedStopLaborLineId] = useState("");
  const [workOffers, setWorkOffers] = useState([]);
  const [showAllWorkOffers, setShowAllWorkOffers] = useState(false);
  const [purchasedItems, setPurchasedItems] = useState([]);
  const [showPurchasedItemPicker, setShowPurchasedItemPicker] = useState(false);
  const [availablePurchasedItems, setAvailablePurchasedItems] = useState([]);
  const [loadingAvailablePurchasedItems, setLoadingAvailablePurchasedItems] = useState(false);
  const [selectedPurchasedItemIds, setSelectedPurchasedItemIds] = useState([]);
  const [purchasedItemStartDate, setPurchasedItemStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return format(date, "yyyy-MM-dd");
  });
  const [purchasedItemEndDate, setPurchasedItemEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [purchasedItemCategoryFilter, setPurchasedItemCategoryFilter] = useState("All");
  const [purchasedItemBillableFilter, setPurchasedItemBillableFilter] = useState("Billable");
  const [purchasedItemInvoicedFilter, setPurchasedItemInvoicedFilter] = useState("Not Invoiced");
  const [purchasedItemSearchTerm, setPurchasedItemSearchTerm] = useState("");
  const [purchasedItemSortBy, setPurchasedItemSortBy] = useState("date-desc");
  const [removingPurchasedItemId, setRemovingPurchasedItemId] = useState("");
  const [actualPayLineItems, setActualPayLineItems] = useState([]);
  const [paySettings, setPaySettings] = useState(null);
  const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
  const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
  const [workTypeMappings, setWorkTypeMappings] = useState([]);
  const [technicianRates, setTechnicianRates] = useState([]);

  // Edit pickers
  const [adminList, setAdminList] = useState([]);
  const [selectedAdmin, setSelectedAdmin] = useState(null);

  const billingStatusOptions = useMemo(
    () =>
      ["Draft", "Estimate", "Accepted", "In Progress", "Invoiced", "Paid", "Comped", JOB_BILLING_STATUS.customerResolved, "Expired", "Rejected"].map((s) => ({
        value: s,
        label: s,
      })),
    []
  );

  const operationStatusOptions = useMemo(
    () =>
      ["Estimate Pending", "Unscheduled", "Scheduled", "Waiting for Parts", "In Progress", "Finished"].map((s) => ({
        value: s,
        label: s,
      })),
    []
  );

  const issuePriorityOptions = useMemo(
    () =>
      ISSUE_PRIORITY_OPTIONS.map((option) => ({
        value: option.value,
        label: `${option.value} - ${option.label}`,
      })),
    []
  );

  const [selectedBillingStatus, setSelectedBillingStatus] = useState({
    value: "Draft",
    label: "Draft",
  });
  const [selectedOperationStatus, setSelectedOperationStatus] = useState({
    value: "Estimate Pending",
    label: "Estimate Pending",
  });
  const [selectedSolutionTier, setSelectedSolutionTier] = useState({
    value: DEFAULT_ISSUE_PRIORITY,
    label: getIssuePriorityLabel(DEFAULT_ISSUE_PRIORITY),
  });

  // Sections
  const getInitialJobTab = useCallback((sectionValue) => (
    JOB_DETAIL_TAB_BY_SECTION_ID[sectionValue] || JOB_DETAIL_TAB_BY_SECTION_ID[DEFAULT_JOB_DETAIL_SECTION_ID]
  ), []);
  const tabs = JOB_DETAIL_TABS;
  const [activeTab, setActiveTab] = useState(() => getInitialJobTab(section));
  const [openDetailPanels, setOpenDetailPanels] = useState(() => ({ ...DEFAULT_OPEN_DETAIL_PANELS }));
  const [showBillingLifecycleHelp, setShowBillingLifecycleHelp] = useState(false);
  const [showJobHistoryModal, setShowJobHistoryModal] = useState(false);
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingJobTemplate, setSavingJobTemplate] = useState(false);
  const [showCustomerNoteModal, setShowCustomerNoteModal] = useState(false);
  const [customerNoteDraft, setCustomerNoteDraft] = useState("");
  const [customerNoteAudience, setCustomerNoteAudience] = useState("all");
  const [customerNoteBodyOfWaterId, setCustomerNoteBodyOfWaterId] = useState("");
  const [savingCustomerNote, setSavingCustomerNote] = useState(false);
  const [expiringJob, setExpiringJob] = useState(false);
  const [resolvingCustomerHandledJob, setResolvingCustomerHandledJob] = useState(false);

  useEffect(() => {
    setActiveTab(getInitialJobTab(section));
  }, [section, getInitialJobTab]);

  useEffect(() => {
    if (!jobId) return;
    if (!section || !JOB_DETAIL_SECTION_IDS.includes(section)) {
      navigate(`/company/jobs/detail/${jobId}/${DEFAULT_JOB_DETAIL_SECTION_ID}`, { replace: true });
    }
  }, [jobId, navigate, section]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setServiceCatalogItems([]);
      setLoadingServiceCatalogItems(false);
      return undefined;
    }

    setLoadingServiceCatalogItems(true);
    return onSnapshot(
      salesCatalogCollection(db, recentlySelectedCompany),
      (snapshot) => {
        const items = snapshot.docs
          .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
          .filter(isJobServiceCatalogItem)
          .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
        setServiceCatalogItems(items);
        setLoadingServiceCatalogItems(false);
      },
      (error) => {
        console.error("[JobDetailView] Unable to load service catalog", error);
        setLoadingServiceCatalogItems(false);
      }
    );
  }, [recentlySelectedCompany]);

  const handleJobTabChange = useCallback((nextTab) => {
    const sectionId = JOB_DETAIL_SECTION_ID_BY_TAB[nextTab] || DEFAULT_JOB_DETAIL_SECTION_ID;
    setActiveTab(nextTab);
    if (jobId) {
      navigate(`/company/jobs/detail/${jobId}/${sectionId}`);
    }
  }, [jobId, navigate]);

  // Tasks
  const [taskTypeList, setTaskTypeList] = useState([]);
  const [taskList, setTaskList] = useState([]);
  const [taskEquipmentStatusDrafts, setTaskEquipmentStatusDrafts] = useState({});
  const [newTask, setNewTask] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState(null);
  const [taskDescription, setTaskDescription] = useState("");
  const [taskLaborCost, setTaskLaborCost] = useState("0");
  const [taskBillingLaborPrice, setTaskBillingLaborPrice] = useState("0");
  const [estimatedTime, setEstimatedTime] = useState("0");
  const [taskBodyOfWaterList, setTaskBodyOfWaterList] = useState([]);
  const [taskEquipmentList, setTaskEquipmentList] = useState([]);
  const [selectedTaskBodyOfWater, setSelectedTaskBodyOfWater] = useState(null);
  const [selectedTaskEquipment, setSelectedTaskEquipment] = useState(null);
  const [selectedTaskDbItem, setSelectedTaskDbItem] = useState(null);
  const [taskQuantity, setTaskQuantity] = useState("1");
  const [editingTaskId, setEditingTaskId] = useState("");
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [taskEditForm, setTaskEditForm] = useState(EMPTY_TASK_EDIT_FORM);

  // Shopping list
  const [shoppingList, setShoppingList] = useState([]);
  const [showAllPlannedMaterials, setShowAllPlannedMaterials] = useState(false);
  const [newShoppingList, setNewShoppingList] = useState(false);
  const [markingPurchasedShoppingItemId, setMarkingPurchasedShoppingItemId] = useState("");

  const shoppingSubCategoryOptions = [
    { value: "Data Base", label: "Data Base" },
    { value: "Chemical", label: "Chemical" },
    { value: "Part", label: "Part" },
    { value: "Custom", label: "Custom" },
  ];

  const [companyUserList, setCompanyUserList] = useState([]);
  const [shoppingDbItemList, setShoppingDbItemList] = useState([]);
  const [selectedPurchaser, setSelectedPurchaser] = useState(null);
  const [selectedShoppingDbItem, setSelectedShoppingDbItem] = useState(null);
  const [shoppingDbItemVendorList, setShoppingDbItemVendorList] = useState([]);
  const [showShoppingDbItemCreator, setShowShoppingDbItemCreator] = useState(false);
  const [savingShoppingDbItem, setSavingShoppingDbItem] = useState(false);
  const [shoppingDbItemForm, setShoppingDbItemForm] = useState(() => createEmptyShoppingDbItemForm());

  const [shoppingFormData, setShoppingFormData] = useState({
    category: "Job",
    subCategory: "Data Base",
    status: "Need to Purchase",
    purchaserId: "",
    purchaserName: "",
    genericItemId: "",
    name: "",
    description: "",
    plannedUnitCost: "",
    plannedUnitPrice: "",
    datePurchased: "",
    quantity: "1",
    jobId: "",
    jobName: "",
    dbItemId: "",
    linkedTaskId: "",
    customerApprovalRequired: false,
  });
  const [editingShoppingItemId, setEditingShoppingItemId] = useState("");
  const [savingShoppingEdit, setSavingShoppingEdit] = useState(false);
  const [shoppingEditForm, setShoppingEditForm] = useState(EMPTY_SHOPPING_EDIT_FORM);

  useEffect(() => {
    (async () => {
      if (!recentlySelectedCompany) {
        setShoppingDbItemVendorList([]);
        setShoppingDbItemForm(createEmptyShoppingDbItemForm());
        return;
      }

      try {
        const vendors = await fetchCompanyVendors(db, recentlySelectedCompany);
        setShoppingDbItemVendorList(vendors);
        setShoppingDbItemForm((prev) => ({
          ...prev,
          vendor: prev.vendor || vendors[0] || null,
        }));
      } catch (error) {
        console.warn("Unable to load vendors for planned material database item form.", error);
      }
    })();
  }, [recentlySelectedCompany]);

  useEffect(() => {
    setTaskEquipmentStatusDrafts((prev) => {
      const next = { ...prev };

      (taskList || []).forEach((task) => {
        if (task?.id && task?.equipmentId && !next[task.id]) {
          next[task.id] = task.equipmentStatusOnCompletion || EQUIPMENT_STATUS.OPERATIONAL;
        }
      });

      Object.keys(next).forEach((taskId) => {
        if (!(taskList || []).some((task) => task.id === taskId)) {
          delete next[taskId];
        }
      });

      return next;
    });
  }, [taskList]);

  const [draftContractData, setDraftContractData] = useState({
    category: "Job",
    subCategory: "Data Base",
    status: "Need to Purchase",
    purchaserId: "",
    purchaserName: "",
    genericItemId: "",
    name: "",
    description: "",
    datePurchased: "",
    quantity: "",
    jobId: "",
    jobName: "",
    dbItemId: "",
  });
  // PNL
  // Description
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  // Comments
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [commentFilter, setCommentFilter] = useState("All");
  const [showCommentsModal, setShowCommentsModal] = useState(false);

  // Billing / Contracts
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState("");
  const [jobSalesAgreements, setJobSalesAgreements] = useState([]);
  const [salesAgreementsLoading, setSalesAgreementsLoading] = useState(false);
  const [selectedSalesAgreementId, setSelectedSalesAgreementId] = useState("");
  const [sendingEstimateEmail, setSendingEstimateEmail] = useState(false);
  const [sendingInvoiceEmail, setSendingInvoiceEmail] = useState(false);
  const [markingJobFinished, setMarkingJobFinished] = useState(false);
  const [markingJobInvoiced, setMarkingJobInvoiced] = useState(false);
  const [linkedSalesAgreement, setLinkedSalesAgreement] = useState(null);
  const [linkedSalesInvoice, setLinkedSalesInvoice] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(true);
  const [changeOrders, setChangeOrders] = useState([]);
  const [changeOrdersLoading, setChangeOrdersLoading] = useState(true);
  const [jobPlans, setJobPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [acceptingPlanId, setAcceptingPlanId] = useState("");
  const [selectedPlanEditorId, setSelectedPlanEditorId] = useState("");
  const [loadingPlanEditorId, setLoadingPlanEditorId] = useState("");
  const [savingPlanEditor, setSavingPlanEditor] = useState(false);
  const [planEditorDraft, setPlanEditorDraft] = useState({
    title: "",
    description: "",
  });
  const [planForm, setPlanForm] = useState({
    id: "",
    title: "",
    planTier: DEFAULT_JOB_PLAN_TIER,
    solutionTier: DEFAULT_JOB_PLAN_TIER,
    status: JOB_PLAN_STATUS.DRAFT,
    description: "",
    rate: "",
    laborCost: "",
  });
  const [deletingJob, setDeletingJob] = useState(false);
  const [showChangeOrderModal, setShowChangeOrderModal] = useState(false);
  const [savingChangeOrder, setSavingChangeOrder] = useState(false);
  const [changeOrderForm, setChangeOrderForm] = useState({
    title: "",
    requestedBy: "Customer",
    requestSource: "Customer",
    status: "Requested",
    customerApprovalRequired: true,
    description: "",
    reason: "",
    priceImpact: "",
    laborCostImpact: "",
    materialCostImpact: "",
    scheduleImpact: "",
    internalNotes: "",
  });
  const plannedTotalMinutes = useMemo(() => {
    const taskMinutes = (taskList || []).reduce(
      (total, task) => total + Number(task.estimatedTime || 0),
      0
    );

    const plannedStopMinutes = (plannedServiceStops || []).reduce(
      (total, stop) => total + Number(stop.estimatedMinutes || 0),
      0
    );

    return taskMinutes + plannedStopMinutes;
  }, [taskList, plannedServiceStops]);

  const plannedDurationHours = useMemo(() => {
    return (plannedTotalMinutes / 60).toFixed(2);
  }, [plannedTotalMinutes]);


  const filteredComments = useMemo(() => {
    if (commentFilter === "Open") return (comments || []).filter((c) => !c.resolved);
    if (commentFilter === "Resolved") return (comments || []).filter((c) => !!c.resolved);
    return comments || [];
  }, [comments, commentFilter]);

  const selectedContract = useMemo(
    () => contracts.find((c) => c.id === selectedContractId) || contracts[0] || null,
    [contracts, selectedContractId]
  );

  const selectedSalesAgreement = useMemo(
    () =>
      jobSalesAgreements.find((agreement) => agreement.id === selectedSalesAgreementId) ||
      (linkedSalesAgreement?.id ? linkedSalesAgreement : null) ||
      jobSalesAgreements[0] ||
      null,
    [jobSalesAgreements, linkedSalesAgreement, selectedSalesAgreementId]
  );

  const selectedBillingRecord = selectedSalesAgreement || selectedContract;
  const isJobExpired = String(job.billingStatus || "").trim().toLowerCase() === "expired";
  const isJobCustomerResolved = String(job.billingStatus || "").trim().toLowerCase() ===
    JOB_BILLING_STATUS.customerResolved.toLowerCase();

  const contractStatusOptions = useMemo(
    () => ["Draft", "Sent", "Viewed", "Accepted", "Rejected", "Expired", "Invoiced", "Paid"],
    []
  );

  const billingLifecycleSteps = useMemo(
    () => [
      {
        status: "Draft",
        operation: "Estimate Pending",
        title: "1. Draft",
        description: "Billing has not been prepared yet.",
      },
      {
        status: "Estimate",
        operation: "Unscheduled",
        title: "2. Estimate",
        description: "Estimate is prepared or sent and the job can move toward scheduling.",
      },
      {
        status: "Accepted",
        operation: "Unscheduled",
        title: "3. Accepted",
        description: "Customer approval is recorded; keep or move the job into scheduling.",
      },
      {
        status: "In Progress",
        operation: "Scheduled / In Progress / Finished",
        title: "4. In Progress",
        description: "Work is scheduled, underway, waiting on parts, or finished but not invoiced yet.",
      },
      {
        status: "Invoiced",
        operation: "Finished",
        title: "5. Invoiced",
        description: "The customer-facing invoice has been recorded; iOS marks the work finished.",
      },
      {
        status: "Paid",
        operation: "Finished",
        title: "6. Paid",
        description: "Payment is complete and the job should remain finished.",
      },
      {
        status: "Comped",
        operation: "Finished",
        title: "7. Comped",
        description: "The company absorbed the job cost or comped the work; no customer invoice is expected.",
      },
      {
        status: JOB_BILLING_STATUS.customerResolved,
        operation: "Finished",
        title: "Customer Resolved",
        description: "The customer took care of the issue; the job remains preserved for history and no company invoice is expected.",
      },
      {
        status: "Expired",
        operation: "Estimate Pending",
        title: "Expired",
        description: "The estimate or billing window expired; unfinished work returns to estimate pending.",
      },
      {
        status: "Rejected",
        operation: "Estimate Pending",
        title: "Rejected",
        description: "The customer rejected the billing or estimate; keep the job history because the work may still need a new path forward.",
      },
    ],
    []
  );

  const suggestBillingForOperation = (operationStatus, currentBillingStatus = "Draft") => {
    switch (operationStatus) {
      case "Estimate Pending":
        return currentBillingStatus === "Draft" ? "Draft" : currentBillingStatus;
      case "Unscheduled":
        return currentBillingStatus === "Draft" ? "Estimate" : currentBillingStatus;
      case "Scheduled":
        return currentBillingStatus === "Draft" || currentBillingStatus === "Estimate"
          ? "Accepted"
          : currentBillingStatus;
      case "In Progress":
        return ["Draft", "Estimate", "Accepted"].includes(currentBillingStatus)
          ? "In Progress"
          : currentBillingStatus;
      case "Waiting for Parts":
        return currentBillingStatus === "Draft" || currentBillingStatus === "Estimate"
          ? "Accepted"
          : currentBillingStatus;
      case "Finished":
        return ["Draft", "Estimate", "Accepted"].includes(currentBillingStatus)
          ? "In Progress"
          : currentBillingStatus;
      default:
        return currentBillingStatus;
    }
  };

  const suggestOperationForBilling = (billingStatus, currentOperationStatus = "Estimate Pending") => {
    switch (billingStatus) {
      case "Draft":
        return currentOperationStatus === "Finished" ? "Estimate Pending" : currentOperationStatus;
      case "Estimate":
        return currentOperationStatus === "Estimate Pending" ? "Unscheduled" : currentOperationStatus;
      case "Accepted":
        return currentOperationStatus === "Estimate Pending" || currentOperationStatus === "Unscheduled"
          ? "Unscheduled"
          : currentOperationStatus;
      case "In Progress":
        return currentOperationStatus === "Estimate Pending" || currentOperationStatus === "Unscheduled"
          ? "Scheduled"
          : currentOperationStatus;
      case "Invoiced":
        return currentOperationStatus !== "Finished" ? "Finished" : currentOperationStatus;
      case "Paid":
        return "Finished";
      case "Comped":
        return "Finished";
      case JOB_BILLING_STATUS.customerResolved:
        return JOB_OPERATION_STATUS.finished;
      case "Expired":
        return currentOperationStatus !== "Finished" ? "Estimate Pending" : currentOperationStatus;
      case "Rejected":
        return currentOperationStatus !== "Finished" ? "Estimate Pending" : currentOperationStatus;
      default:
        return currentOperationStatus;
    }
  };
  const [customerPriceInput, setCustomerPriceInput] = useState("");
  const requiresShoppingDbItem = shoppingFormData.subCategory === "Data Base";
  const requiresShoppingManualDetails = !requiresShoppingDbItem;
  const isJobAcceptedForMaterials = (status = job.billingStatus) => (
    ["accepted", "in progress", "invoiced", "paid", "comped"].includes(
      String(status || "").trim().toLowerCase()
    )
  );
  const initialJobMaterialStatus = ({ customerApprovalRequired = false, requestedStatus = "" } = {}) => {
    if (customerApprovalRequired) return "Needs Customer Approval";

    if (!isJobAcceptedForMaterials()) return "Needs Customer Approval";

    const normalizedRequestedStatus = String(requestedStatus || "").trim();
    if (
      normalizedRequestedStatus &&
      normalizedRequestedStatus !== "Need to Purchase" &&
      normalizedRequestedStatus !== "Needs Customer Approval"
    ) {
      return normalizedRequestedStatus;
    }

    return "Ready to Purchase";
  };

  const canSaveShoppingItem = useMemo(() => {
    const hasQuantity =
      shoppingFormData.quantity !== "" && !Number.isNaN(Number(shoppingFormData.quantity));
    const hasName = requiresShoppingDbItem
      ? shoppingFormData.dbItemId.trim() !== ""
      : shoppingFormData.name.trim() !== "";

    return hasQuantity && hasName;
  }, [shoppingFormData, requiresShoppingDbItem]);

  const canCreateShoppingDbItem = useMemo(() => {
    const hasName = shoppingDbItemForm.name.trim() !== "";
    const validRate = shoppingDbItemForm.rate === "" || Number(shoppingDbItemForm.rate) >= 0;
    const validSellPrice = shoppingDbItemForm.sellPrice === "" || Number(shoppingDbItemForm.sellPrice) >= 0;

    return hasName && validRate && validSellPrice && !savingShoppingDbItem;
  }, [savingShoppingDbItem, shoppingDbItemForm]);

  const cents = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  };

  const dollarsFromCents = (value) => ((cents(value) / 100) || 0).toFixed(2);

  const idValue = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return value.id || value.value || value.docId || "";
  };

  const companyUserDisplayName = (user = {}) => getCompanyUserDisplayName(user, "Admin");

  const companyUserRoleName = (user = {}) => user.roleName || user.role || "";

  const buildAdminOption = (docSnap) => {
    const data = docSnap.data();
    const docId = docSnap.id;
    const adminId = data.userId || data.id || docId;
    const companyUserId = data.id || docId;
    const name = companyUserDisplayName(data);
    const roleName = companyUserRoleName(data);
    const alternateIds = [...new Set([adminId, data.userId, data.id, docId].filter(Boolean))];

    return {
      ...data,
      id: adminId,
      userId: adminId,
      companyUserId,
      name,
      userName: name,
      label: `${name}${roleName ? ` — ${roleName}` : ""}`,
      value: adminId,
      alternateIds,
    };
  };

  const adminMatchesJob = (admin, sourceJob = {}) => {
    const jobAdminId = sourceJob.adminId || "";
    const jobAdminName = sourceJob.adminName || "";

    if (jobAdminId && admin.alternateIds?.includes(jobAdminId)) return true;
    return Boolean(jobAdminName && (admin.name === jobAdminName || admin.userName === jobAdminName));
  };

  const currentAdminOption = (sourceJob = {}) => {
    if (!sourceJob.adminId && !sourceJob.adminName) return null;

    return {
      id: sourceJob.adminId || "",
      userId: sourceJob.adminId || "",
      companyUserId: "",
      name: sourceJob.adminName || "Current Admin",
      userName: sourceJob.adminName || "Current Admin",
      label: sourceJob.adminName || "Current Admin",
      value: sourceJob.adminId || "",
      alternateIds: [sourceJob.adminId].filter(Boolean),
    };
  };

  const quantityNumber = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  };

  const moneyFromCents = (value) => formatCurrency(cents(value) / 100);

  const getTaskBillingLaborPriceCents = (task = {}) => {
    const explicitBillingValue =
      task.billingLaborPriceCents ??
      task.customerLaborPriceCents ??
      task.billingLaborRateCents ??
      task.laborBillingRateCents ??
      task.billableLaborCents;

    if (explicitBillingValue !== undefined && explicitBillingValue !== null && explicitBillingValue !== "") {
      return cents(explicitBillingValue);
    }

    return cents(task.contractedRate);
  };

  const getShoppingPlannedTotalCostCents = (item) => {
    if (item?.plannedTotalCostCents !== undefined && item?.plannedTotalCostCents !== null) {
      return cents(item.plannedTotalCostCents);
    }

    const qty = quantityNumber(item?.quantity);
    const unit = item?.plannedUnitCostCents ?? item?.cost ?? 0;

    return Math.round(cents(unit) * qty);
  };

  const getShoppingPlannedTotalPriceCents = (item) => {
    if (item?.plannedTotalPriceCents !== undefined && item?.plannedTotalPriceCents !== null) {
      return cents(item.plannedTotalPriceCents);
    }

    const qty = quantityNumber(item?.quantity);
    const unit = item?.plannedUnitPriceCents ?? item?.price ?? 0;

    return Math.round(cents(unit) * qty);
  };

  const laborLineArray = (value) => (
    Array.isArray(value)
      ? value.map(idValue).filter(Boolean)
      : idValue(value)
        ? [idValue(value)]
        : []
  );

  const plannedServiceStopsPath = (companyId, currentJobId) =>
    collection(
      db,
      "companies",
      companyId,
      "workOrders",
      currentJobId,
      "plannedServiceStops"
    );

  const workOffersPath = (companyId) =>
    collection(db, "companies", companyId, "workOffers");

  const purchasedItemsPath = (companyId) =>
    collection(db, "companies", companyId, "purchasedItems");

  const payLineItemsPath = (companyId) =>
    collection(db, "companies", companyId, "technicianPayLineItems");

  const jobHistoryPath = (companyId, currentJobId) =>
    collection(db, "companies", companyId, "workOrders", currentJobId, "history");

  const changeOrdersPath = (companyId, currentJobId) =>
    collection(db, "companies", companyId, "workOrders", currentJobId, "changeOrders");

  const jobPlansPath = (companyId, currentJobId) =>
    collection(db, "companies", companyId, "workOrders", currentJobId, "plans");

  const legacyJobSolutionsPath = (companyId, currentJobId) =>
    collection(db, "companies", companyId, "workOrders", currentJobId, "solutions");

  const deleteQueryDocs = async (targetQuery) => {
    const snap = await getDocs(targetQuery);
    await Promise.all(snap.docs.map((docSnap) => deleteDoc(docSnap.ref)));
    return snap.size;
  };

  const getAuditUserName = () =>
    `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
    dataBaseUser?.userName ||
    getUserName();

  const valueForHistory = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    if (value?.toDate) return formatDateTimeValue(value);
    if (value instanceof Date) return formatDateTimeValue(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  };

  const buildHistoryChange = (field, label, before, after) => {
    const beforeValue = valueForHistory(before);
    const afterValue = valueForHistory(after);
    if (beforeValue === afterValue) return null;
    return {
      field,
      label,
      before: beforeValue,
      after: afterValue,
    };
  };

  const recordJobHistory = async ({
    eventType = "Job Updated",
    title,
    description = "",
    changes = [],
    metadata = {},
    changeOrderId = "",
    severity = "info",
  }) => {
    try {
      if (!recentlySelectedCompany || !jobId || !title) return;

      const historyId = "comp_job_hist_" + uuidv4();
      const now = new Date();
      const nowMillis = now.getTime();
      const nextChanges = (changes || []).filter(Boolean);
      await setDoc(doc(jobHistoryPath(recentlySelectedCompany, jobId), historyId), {
        id: historyId,
        companyId: recentlySelectedCompany,
        jobId,
        jobInternalId: job.internalId || "",
        eventType,
        title,
        description,
        changes: nextChanges,
        metadata,
        changeOrderId,
        severity,
        actorUserId: getUserId() || "",
        actorUserName: getAuditUserName(),
        actorCompanyUserId: dataBaseUser?.id || "",
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
      });

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
        lastHistoryEventId: historyId,
        lastHistoryEventTitle: title,
        lastHistoryEventType: eventType,
      });

      setJob((prev) => ({
        ...prev,
        updatedAt: now,
        updatedAtMillis: nowMillis,
        lastHistoryEventId: historyId,
        lastHistoryEventTitle: title,
        lastHistoryEventType: eventType,
      }));
    } catch (err) {
      console.warn("[JobDetailView] Failed to record job history", err);
    }
  };

  const upsertSuggestedWorkRecord = async ({
    billingStatus = job.billingStatus || "",
    previousBillingStatus = job.billingStatus || "",
    previousOperationStatus = job.operationStatus || "",
    nextOperationStatus = job.operationStatus || "",
    statusChangedAtMillis = Date.now(),
    reason = "Job needs follow-up",
    priorityLevel = job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY,
  } = {}) => {
    if (!recentlySelectedCompany || !jobId) return null;

    const customerId = job.customerId || customer.id || "";
    if (!customerId) {
      throw new Error("This job needs a customer before it can be listed as suggested work.");
    }

    const normalizedPriority = normalizeSuggestedWorkTier(priorityLevel);
    const priorityLabel = getSuggestedWorkTierLabel(normalizedPriority);
    const customerName =
      job.customerName ||
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
      customer.companyName ||
      "Customer";
    const locationAddress = [
      serviceLocation.streetAddress,
      serviceLocation.city,
      serviceLocation.state,
      serviceLocation.zip,
    ]
      .filter(Boolean)
      .join(", ");
    const locationName = serviceLocation.nickName || serviceLocation.name || "";
    const openTaskCount = (taskList || []).filter(
      (task) => String(task.status || "").toLowerCase() !== "finished"
    ).length;
    const jobLabel = job.internalId || job.type || jobId;
    const statusLabel = billingStatus || "Outstanding";
    const noteLines = [
      `Job ${jobLabel} was converted to suggested work for later customer review.`,
      `Priority: ${normalizedPriority} - ${priorityLabel}`,
      job.type ? `Type: ${job.type}` : "",
      job.description ? `Scope: ${job.description}` : "",
      `Billing: ${previousBillingStatus || "Not set"} -> ${statusLabel}`,
      `Operations: ${previousOperationStatus || "Not set"} -> ${nextOperationStatus || "Not set"}`,
      Number(job.rate || 0) ? `Customer price: ${moneyFromCents(job.rate)}` : "",
      locationName || locationAddress ? `Location: ${[locationName, locationAddress].filter(Boolean).join(" - ")}` : "",
      job.bodyOfWaterName ? `Body of water: ${job.bodyOfWaterName}` : "",
      job.equipmentName ? `Equipment: ${job.equipmentName}` : "",
      `Tasks: ${(taskList || []).length}${openTaskCount ? ` (${openTaskCount} open)` : ""}`,
      shoppingList.length ? `Planned products: ${shoppingList.length}` : "",
      purchasedItems.length ? `Purchased items: ${purchasedItems.length}` : "",
      reason ? `Reason: ${reason}` : "",
    ].filter(Boolean);
    const suggestedWorkId = suggestedWorkIdForSource("job", jobId) || jobId;

    const suggestedWorkRecord = {
      id: suggestedWorkId,
      companyId: recentlySelectedCompany,
      customerId,
      customerName,
      sourceType: "job",
      sourceId: jobId,
      sourcePath: `companies/${recentlySelectedCompany}/workOrders/${jobId}`,
      jobId,
      jobInternalId: job.internalId || "",
      jobType: job.type || "",
      jobDescription: job.description || "",
      jobRateCents: Number(job.rate || 0),
      jobLaborCostCents: Number(job.laborCost || 0),
      previousBillingStatus,
      previousOperationStatus,
      sourceBillingStatus: statusLabel,
      sourceOperationStatus: nextOperationStatus || "",
      billingStatus: statusLabel,
      operationStatus: nextOperationStatus || "",
      priorityLevel: normalizedPriority,
      priorityLabel,
      solutionTier: normalizedPriority,
      solutionTierLabel: priorityLabel,
      status: SUGGESTED_WORK_STATUS.OPEN,
      suggestionStatus: SUGGESTED_WORK_STATUS.OPEN,
      serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
      serviceLocationName: locationName,
      serviceLocationAddress: locationAddress,
      bodyOfWaterId: job.bodyOfWaterId || "",
      bodyOfWaterName: job.bodyOfWaterName || "",
      equipmentId: job.equipmentId || "",
      equipmentName: job.equipmentName || "",
      adminId: job.adminId || "",
      adminName: job.adminName || "",
      repairRequestId: job.repairRequestId || "",
      serviceStopIds: Array.isArray(job.serviceStopIds) ? job.serviceStopIds : [],
      taskCount: (taskList || []).length,
      openTaskCount,
      plannedServiceStopCount: (plannedServiceStops || []).length,
      plannedMaterialCount: (shoppingList || []).length,
      purchasedItemCount: (purchasedItems || []).length,
      title: `${priorityLabel}: ${jobLabel}`,
      description: job.description || reason || "",
      note: noteLines.join("\n"),
      reason,
      statusChangedAt: serverTimestamp(),
      statusChangedAtMillis,
      updatedAt: serverTimestamp(),
      updatedAtMillis: statusChangedAtMillis,
      lastUpdatedByUserId: getUserId() || "",
      lastUpdatedByUserName: getAuditUserName(),
    };

    await setDoc(
      doc(db, "companies", recentlySelectedCompany, "suggestedWork", suggestedWorkId),
      suggestedWorkRecord,
      { merge: true }
    );

    return suggestedWorkRecord;
  };

  const upsertExpiredJobRecord = async ({
    previousBillingStatus = job.billingStatus || "",
    previousOperationStatus = job.operationStatus || "",
    nextOperationStatus = job.operationStatus || "",
    expiredAtMillis = Date.now(),
    reason = "Job canceled from job detail",
    priorityLevel = job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY,
  } = {}) => {
    if (!recentlySelectedCompany || !jobId) return null;

    const customerId = job.customerId || customer.id || "";
    if (!customerId) {
      throw new Error("This job needs a customer before it can be canceled.");
    }

    const customerName =
      job.customerName ||
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
      customer.companyName ||
      "Customer";
    const locationAddress = [
      serviceLocation.streetAddress,
      serviceLocation.city,
      serviceLocation.state,
      serviceLocation.zip,
    ]
      .filter(Boolean)
      .join(", ");
    const locationName = serviceLocation.nickName || serviceLocation.name || "";
    const openTaskCount = (taskList || []).filter(
      (task) => String(task.status || "").toLowerCase() !== "finished"
    ).length;
    const jobLabel = job.internalId || job.type || jobId;
    const noteLines = [
      `Job ${jobLabel} was canceled without deleting the work order.`,
      job.type ? `Type: ${job.type}` : "",
      job.description ? `Scope: ${job.description}` : "",
      `Billing: ${previousBillingStatus || "Not set"} -> Expired`,
      `Operations: ${previousOperationStatus || "Not set"} -> ${nextOperationStatus || "Not set"}`,
      Number(job.rate || 0) ? `Customer price: ${moneyFromCents(job.rate)}` : "",
      locationName || locationAddress ? `Location: ${[locationName, locationAddress].filter(Boolean).join(" - ")}` : "",
      job.bodyOfWaterName ? `Body of water: ${job.bodyOfWaterName}` : "",
      job.equipmentName ? `Equipment: ${job.equipmentName}` : "",
      `Tasks: ${(taskList || []).length}${openTaskCount ? ` (${openTaskCount} open)` : ""}`,
      shoppingList.length ? `Planned products: ${shoppingList.length}` : "",
      purchasedItems.length ? `Purchased items: ${purchasedItems.length}` : "",
    ].filter(Boolean);

    const expiredJobRecord = {
      id: jobId,
      companyId: recentlySelectedCompany,
      customerId,
      customerName,
      jobId,
      jobInternalId: job.internalId || "",
      jobType: job.type || "",
      jobDescription: job.description || "",
      jobRateCents: Number(job.rate || 0),
      jobLaborCostCents: Number(job.laborCost || 0),
      previousBillingStatus,
      previousOperationStatus,
      billingStatus: "Expired",
      operationStatus: nextOperationStatus || "",
      serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
      serviceLocationName: locationName,
      serviceLocationAddress: locationAddress,
      bodyOfWaterId: job.bodyOfWaterId || "",
      bodyOfWaterName: job.bodyOfWaterName || "",
      equipmentId: job.equipmentId || "",
      equipmentName: job.equipmentName || "",
      adminId: job.adminId || "",
      adminName: job.adminName || "",
      repairRequestId: job.repairRequestId || "",
      serviceStopIds: Array.isArray(job.serviceStopIds) ? job.serviceStopIds : [],
      taskCount: (taskList || []).length,
      openTaskCount,
      plannedServiceStopCount: (plannedServiceStops || []).length,
      plannedMaterialCount: (shoppingList || []).length,
      purchasedItemCount: (purchasedItems || []).length,
      title: `Expired job: ${jobLabel}`,
      note: noteLines.join("\n"),
      reason,
      sourcePath: `companies/${recentlySelectedCompany}/workOrders/${jobId}`,
      expiredAt: serverTimestamp(),
      expiredAtMillis,
      expiredByUserId: getUserId() || "",
      expiredByUserName: getAuditUserName(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(
      doc(db, "companies", recentlySelectedCompany, "customers", customerId, "expiredJobs", jobId),
      expiredJobRecord,
      { merge: true }
    );

    await upsertSuggestedWorkRecord({
      billingStatus: "Expired",
      previousBillingStatus,
      previousOperationStatus,
      nextOperationStatus,
      statusChangedAtMillis: expiredAtMillis,
      reason,
      priorityLevel,
    });

    return expiredJobRecord;
  };

  const upsertCustomerResolvedJobRecord = async ({
    previousBillingStatus = job.billingStatus || "",
    previousOperationStatus = job.operationStatus || "",
    resolvedAtMillis = Date.now(),
    resolutionNote = "Customer took care of the issue.",
  } = {}) => {
    if (!recentlySelectedCompany || !jobId) return null;

    const customerId = job.customerId || customer.id || "";
    if (!customerId) {
      throw new Error("This job needs a customer before it can be marked customer resolved.");
    }

    const customerName =
      job.customerName ||
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
      customer.companyName ||
      "Customer";
    const locationAddress = [
      serviceLocation.streetAddress,
      serviceLocation.city,
      serviceLocation.state,
      serviceLocation.zip,
    ]
      .filter(Boolean)
      .join(", ");
    const locationName = serviceLocation.nickName || serviceLocation.name || "";
    const openTaskCount = (taskList || []).filter(
      (task) => String(task.status || "").toLowerCase() !== "finished"
    ).length;
    const jobLabel = job.internalId || job.type || jobId;
    const noteLines = [
      `Job ${jobLabel} was closed because the customer took care of the issue.`,
      job.type ? `Type: ${job.type}` : "",
      job.description ? `Issue: ${job.description}` : "",
      resolutionNote ? `Resolution note: ${resolutionNote}` : "",
      `Billing: ${previousBillingStatus || "Not set"} -> ${JOB_BILLING_STATUS.customerResolved}`,
      `Operations: ${previousOperationStatus || "Not set"} -> ${JOB_OPERATION_STATUS.finished}`,
      locationName || locationAddress ? `Location: ${[locationName, locationAddress].filter(Boolean).join(" - ")}` : "",
      job.bodyOfWaterName ? `Body of water: ${job.bodyOfWaterName}` : "",
      job.equipmentName ? `Equipment: ${job.equipmentName}` : "",
      `Tasks: ${(taskList || []).length}${openTaskCount ? ` (${openTaskCount} open)` : ""}`,
      shoppingList.length ? `Planned products: ${shoppingList.length}` : "",
      purchasedItems.length ? `Purchased items: ${purchasedItems.length}` : "",
    ].filter(Boolean);
    const authorId = getUserId() || "";
    const authorName = getAuditUserName();
    const customerResolvedRecord = {
      id: jobId,
      companyId: recentlySelectedCompany,
      customerId,
      customerName,
      jobId,
      jobInternalId: job.internalId || "",
      jobType: job.type || "",
      jobDescription: job.description || "",
      previousBillingStatus,
      previousOperationStatus,
      billingStatus: JOB_BILLING_STATUS.customerResolved,
      operationStatus: JOB_OPERATION_STATUS.finished,
      outcome: "customerTookCareOfIt",
      resolutionNote,
      serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
      serviceLocationName: locationName,
      serviceLocationAddress: locationAddress,
      bodyOfWaterId: job.bodyOfWaterId || "",
      bodyOfWaterName: job.bodyOfWaterName || "",
      equipmentId: job.equipmentId || "",
      equipmentName: job.equipmentName || "",
      adminId: job.adminId || "",
      adminName: job.adminName || "",
      repairRequestId: job.repairRequestId || "",
      serviceStopIds: Array.isArray(job.serviceStopIds) ? job.serviceStopIds : [],
      taskCount: (taskList || []).length,
      openTaskCount,
      plannedServiceStopCount: (plannedServiceStops || []).length,
      plannedMaterialCount: (shoppingList || []).length,
      purchasedItemCount: (purchasedItems || []).length,
      title: `Customer resolved job: ${jobLabel}`,
      note: noteLines.join("\n"),
      sourcePath: `companies/${recentlySelectedCompany}/workOrders/${jobId}`,
      resolvedAt: serverTimestamp(),
      resolvedAtMillis,
      resolvedByUserId: authorId,
      resolvedByUserName: authorName,
      updatedAt: serverTimestamp(),
      updatedAtMillis: resolvedAtMillis,
    };

    const noteId = `job_customer_resolved_${jobId}`;

    await Promise.all([
      setDoc(
        doc(db, "companies", recentlySelectedCompany, "customers", customerId, "customerResolvedJobs", jobId),
        customerResolvedRecord,
        { merge: true }
      ),
      setDoc(
        doc(db, "companies", recentlySelectedCompany, "customers", customerId, "notes", noteId),
        {
          id: noteId,
          companyId: recentlySelectedCompany,
          customerId,
          customerName,
          bodyOfWaterId: job.bodyOfWaterId || "",
          bodyOfWaterName: job.bodyOfWaterName || "",
          serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
          userId: authorId,
          userName: authorName,
          authorId,
          authorName,
          note: noteLines.join("\n"),
          comment: noteLines.join("\n"),
          text: noteLines.join("\n"),
          audience: "all",
          visibility: "all",
          resolved: true,
          sourceType: "jobCustomerResolved",
          sourceId: jobId,
          jobId,
          jobInternalId: job.internalId || "",
          jobType: job.type || "",
          date: serverTimestamp(),
          dateMillis: resolvedAtMillis,
          createdAt: serverTimestamp(),
          createdAtMillis: resolvedAtMillis,
          updatedAt: serverTimestamp(),
          updatedAtMillis: resolvedAtMillis,
        },
        { merge: true }
      ),
    ]);

    return customerResolvedRecord;
  };

  const centsFromCurrencyInput = (value) => {
    if (value === "" || value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  };

  const resetChangeOrderForm = () => {
    setChangeOrderForm({
      title: "",
      requestedBy: "Customer",
      requestSource: "Customer",
      status: "Requested",
      customerApprovalRequired: true,
      description: "",
      reason: "",
      priceImpact: "",
      laborCostImpact: "",
      materialCostImpact: "",
      scheduleImpact: "",
      internalNotes: "",
    });
  };

  const openChangeOrderModal = () => {
    resetChangeOrderForm();
    setShowChangeOrderModal(true);
  };

  const closeChangeOrderModal = () => {
    if (savingChangeOrder) return;
    setShowChangeOrderModal(false);
    resetChangeOrderForm();
  };

  const handleChangeOrderFormChange = (field, value) => {
    setChangeOrderForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const saveChangeOrder = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;
      if (!changeOrderForm.title.trim()) return toast.error("Add a change order title");
      if (!changeOrderForm.description.trim()) return toast.error("Describe the requested change");

      setSavingChangeOrder(true);

      const id = "comp_change_order_" + uuidv4();
      const priceImpactCents = centsFromCurrencyInput(changeOrderForm.priceImpact);
      const laborCostImpactCents = centsFromCurrencyInput(changeOrderForm.laborCostImpact);
      const materialCostImpactCents = centsFromCurrencyInput(changeOrderForm.materialCostImpact);

      const payload = {
        id,
        companyId: recentlySelectedCompany,
        jobId,
        jobInternalId: job.internalId || "",
        activePlanId: job.activePlanId || activePlan?.id || "",
        acceptedPlanId: job.acceptedPlanId || acceptedPlan?.id || "",
        solutionTier: activePlan?.solutionTier || job.activePlanTier || null,
        solutionTierLabel: activePlan?.solutionTierLabel || job.activePlanTierLabel || "",
        customerId: job.customerId || customer.id || "",
        customerName: job.customerName || [customer.firstName, customer.lastName].filter(Boolean).join(" "),
        serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
        serviceLocationName: serviceLocation.nickName || "",
        title: changeOrderForm.title.trim(),
        requestedBy: changeOrderForm.requestedBy,
        requestSource: changeOrderForm.requestSource,
        status: changeOrderForm.status,
        customerApprovalRequired: Boolean(changeOrderForm.customerApprovalRequired),
        approvalStatus: changeOrderForm.customerApprovalRequired ? "Needs Approval" : "Internal",
        description: changeOrderForm.description.trim(),
        reason: changeOrderForm.reason.trim(),
        priceImpactCents,
        laborCostImpactCents,
        materialCostImpactCents,
        scheduleImpact: changeOrderForm.scheduleImpact.trim(),
        internalNotes: changeOrderForm.internalNotes.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUserId: getUserId() || "",
        createdByUserName: getAuditUserName(),
      };

      await setDoc(doc(changeOrdersPath(recentlySelectedCompany, jobId), id), payload);

      await recordJobHistory({
        eventType: "Change Order",
        title: `Change order requested: ${payload.title}`,
        description: payload.description,
        changeOrderId: id,
        severity: "warning",
        changes: [
          buildHistoryChange("status", "Status", "—", payload.status),
          buildHistoryChange("priceImpactCents", "Price Impact", "—", moneyFromCents(priceImpactCents)),
          buildHistoryChange("laborCostImpactCents", "Labor Cost Impact", "—", moneyFromCents(laborCostImpactCents)),
          buildHistoryChange("materialCostImpactCents", "Product Cost Impact", "—", moneyFromCents(materialCostImpactCents)),
          buildHistoryChange("scheduleImpact", "Schedule Impact", "—", payload.scheduleImpact || "—"),
        ],
        metadata: {
          requestedBy: payload.requestedBy,
          requestSource: payload.requestSource,
          customerApprovalRequired: payload.customerApprovalRequired,
          activePlanId: payload.activePlanId || "",
          acceptedPlanId: payload.acceptedPlanId || "",
        },
      });

      toast.success("Change order created");
      setShowChangeOrderModal(false);
      resetChangeOrderForm();
      handleJobTabChange("Planned");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create change order");
    } finally {
      setSavingChangeOrder(false);
    }
  };

  const getPlannedStopTasks = (stop) => {
    const taskIds = Array.isArray(stop?.taskIds) ? stop.taskIds : [];
    if (!taskIds.length) return taskList || [];

    return (taskList || []).filter((task) => taskIds.includes(task.id));
  };

  const getPlannedStopType = (stop) => {
    const typeId = stop?.serviceStopTypeId || stop?.typeId || "";
    if (!typeId) return null;

    return (
      companyServiceStopTypes.find((type) => type.id === typeId) || {
        id: typeId,
        name: stop.serviceStopTypeName || stop.type || "Service Stop",
        defaultWorkTypeIds: stop.defaultWorkTypeIds || [],
      }
    );
  };

  const getPlannedStopPayRange = (stop) =>
    estimatePlannedServiceStopPayRange({
      companyId: recentlySelectedCompany,
      settings: paySettings,
      serviceStopType: getPlannedStopType(stop),
      tasks: getPlannedStopTasks(stop),
      companyUsers: companyUserList,
      workTypes: companyWorkTypes,
      mappings: workTypeMappings,
      rates: technicianRates,
    });

  const getPlannedStopCostCents = (stop) => {
    const range = getPlannedStopPayRange(stop);
    return Math.max(cents(stop.plannedLaborCostCents), cents(range.maxAmountCents));
  };

  const getLaborLineTaskIds = (line = {}) => laborLineArray(line.taskIds?.length ? line.taskIds : line.laborLineTaskIds);

  const getLaborLinePlannedStopIds = (line = {}) =>
    laborLineArray(
      line.plannedServiceStopIds?.length
        ? line.plannedServiceStopIds
        : line.laborLinePlannedServiceStopIds
    );

  const laborLineScopeTotals = ({ taskIds = [], plannedServiceStopIds = [] } = {}) => {
    const taskIdSet = new Set(taskIds);
    const stopIdSet = new Set(plannedServiceStopIds);
    const selectedTasks = (taskList || []).filter((task) => taskIdSet.has(task.id));
    const selectedStops = (plannedServiceStops || []).filter((stop) => stopIdSet.has(stop.id));
    const taskCostCents = selectedTasks.reduce((total, task) => total + cents(task.contractedRate), 0);
    const taskPriceCents = selectedTasks.reduce((total, task) => total + getTaskBillingLaborPriceCents(task), 0);
    const stopCostCents = selectedStops.reduce((total, stop) => total + getPlannedStopCostCents(stop), 0);

    return {
      selectedTasks,
      selectedStops,
      costCents: taskCostCents + stopCostCents,
      priceCents: taskPriceCents + stopCostCents,
    };
  };

  const laborLineScopeLabel = (line = {}) => {
    const taskCount = getLaborLineTaskIds(line).length;
    const stopCount = getLaborLinePlannedStopIds(line).length;

    if (!taskCount && !stopCount) return "No tasks or stops attached";

    return [
      taskCount ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : "",
      stopCount ? `${stopCount} planned stop${stopCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" • ");
  };

  const buildLaborLineFormFromLine = (line = {}) => ({
    ...EMPTY_LABOR_LINE_FORM,
    name: line.name || "",
    description: line.description || "",
    quantity: String(line.quantity || 1),
    unitPrice: dollarsFromCents(line.unitPriceCents ?? line.unitAmountCents ?? line.totalPriceCents ?? line.totalAmountCents),
    internalCost: dollarsFromCents(line.internalCostCents ?? line.internalLaborCostCents ?? line.laborCostCents),
    taskIds: getLaborLineTaskIds(line),
    plannedServiceStopIds: getLaborLinePlannedStopIds(line),
  });

  const buildSuggestedLaborLineForm = () => {
    const assignedTaskIds = new Set((laborLineItems || []).flatMap((line) => getLaborLineTaskIds(line)));
    const assignedStopIds = new Set((laborLineItems || []).flatMap((line) => getLaborLinePlannedStopIds(line)));
    const defaultTaskIds = (taskList || [])
      .filter((task) => task.id && (!assignedTaskIds.has(task.id) || !(laborLineItems || []).length))
      .map((task) => task.id);
    const defaultStopIds = (plannedServiceStops || [])
      .filter((stop) => stop.id && (!assignedStopIds.has(stop.id) || !(laborLineItems || []).length))
      .map((stop) => stop.id);
    const totals = laborLineScopeTotals({
      taskIds: defaultTaskIds,
      plannedServiceStopIds: defaultStopIds,
    });

    return {
      ...EMPTY_LABOR_LINE_FORM,
      name: (laborLineItems || []).length ? `Labor ${(laborLineItems || []).length + 1}` : "Labor",
      quantity: "1",
      unitPrice: dollarsFromCents(totals.priceCents),
      internalCost: dollarsFromCents(totals.costCents),
      taskIds: defaultTaskIds,
      plannedServiceStopIds: defaultStopIds,
    };
  };

  const persistLaborLineItems = async (nextItems = []) => {
    const normalizedItems = normalizeJobLaborLineItems(nextItems).map((item, index) => ({
      ...item,
      sortOrder: Number(item.sortOrder ?? index),
      updatedAtMillis: Date.now(),
      updatedByUserId: getUserId() || "",
      updatedByUserName: getAuditUserName(),
    }));

    await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
      laborLineItems: normalizedItems,
      updatedAt: serverTimestamp(),
      updatedAtMillis: Date.now(),
    });

    setLaborLineItems(normalizedItems);
    setJob((prev) => ({
      ...prev,
      laborLineItems: normalizedItems,
      updatedAt: new Date(),
      updatedAtMillis: Date.now(),
    }));

    return normalizedItems;
  };

  const selectedPlannedStopType = useMemo(() => {
    if (!plannedStopForm.serviceStopTypeId) return null;
    return (
      (companyServiceStopTypes || []).find((type) => type.id === plannedStopForm.serviceStopTypeId) ||
      null
    );
  }, [companyServiceStopTypes, plannedStopForm.serviceStopTypeId]);

  const plannedStopFormTasks = useMemo(() => {
    const selectedTaskIds = new Set(plannedStopForm.taskIds || []);
    if (!selectedTaskIds.size) return taskList || [];
    return (taskList || []).filter((task) => selectedTaskIds.has(task.id));
  }, [plannedStopForm.taskIds, taskList]);

  const plannedStopFormPayRange = useMemo(() => (
    estimatePlannedServiceStopPayRange({
      companyId: recentlySelectedCompany,
      settings: paySettings,
      serviceStopType: selectedPlannedStopType,
      tasks: plannedStopFormTasks,
      companyUsers: companyUserList,
      workTypes: companyWorkTypes,
      mappings: workTypeMappings,
      rates: technicianRates,
    })
  ), [
    recentlySelectedCompany,
    paySettings,
    selectedPlannedStopType,
    plannedStopFormTasks,
    companyUserList,
    companyWorkTypes,
    workTypeMappings,
    technicianRates,
  ]);

  const getScheduledStopTasks = (stop) => {
    const stopId = stop?.id || "";
    return (taskList || []).filter((task) => {
      const taskStopId =
        idValue(task?.serviceStopId) ||
        idValue(task?.serviceStopID);

      return taskStopId === stopId;
    });
  };

  const getScheduledStopType = (stop) => {
    const typeId =
      stop?.typeId ||
      stop?.serviceStopTypeId ||
      (stop?.jobId ? "system_job_service_stop" : stop?.recurringServiceStopId ? "system_recurring_service_stop" : "");
    if (!typeId) return null;

    return (
      companyServiceStopTypes.find((type) => type.id === typeId) || {
        id: typeId,
        name: stop.type || stop.serviceStopTypeName || "Service Stop",
        defaultWorkTypeIds: stop.defaultWorkTypeIds || stop.serviceStopDefaultWorkTypeIds || [],
      }
    );
  };

  const getScheduledStopWorker = (stop) => {
    const workerId = stop?.techId || stop?.userId || stop?.technicianId || "";
    if (!workerId) return null;

    return (
      companyUserList.find((user) =>
        user.userId === workerId ||
        user.id === workerId ||
        user.docId === workerId
      ) || {
        id: workerId,
        userId: workerId,
        userName: stop.tech || stop.techName || stop.userName || "Technician",
      }
    );
  };

  const getScheduledStopEstimatedLaborCents = (stop) => {
    if (
      stop &&
      Object.prototype.hasOwnProperty.call(stop, "manualPayOverrideCents") &&
      stop.manualPayOverrideCents !== null &&
      stop.manualPayOverrideCents !== undefined
    ) {
      return Math.max(0, cents(stop.manualPayOverrideCents));
    }

    const explicitAmount = Math.max(
      cents(stop?.manualPayOverrideCents),
      cents(stop?.actualLaborCostCents),
      cents(stop?.laborCostCents),
      cents(stop?.estimatedLaborCostCents),
      cents(stop?.estimatedPayCents),
      cents(stop?.payrollCostCents),
      cents(stop?.totalAmountCents),
      cents(stop?.laborCost),
      cents(stop?.payCents)
    );

    if (explicitAmount > 0) return explicitAmount;

    const tasks = getScheduledStopTasks(stop);
    const estimateTasks = tasks.length
      ? tasks
      : [{
        id: `${stop?.id || "stop"}_duration`,
        name: stop?.type || "Service Stop",
        type: stop?.type || stop?.serviceStopTypeName || "",
        estimatedTime: Number(stop?.duration || stop?.estimatedDuration || 0),
        contractedRate: 0,
      }];

    const summary = estimateServiceStopPaySummary({
      companyId: recentlySelectedCompany,
      settings: paySettings,
      serviceStop: stop,
      serviceStopType: getScheduledStopType(stop),
      serviceStopUseCaseSourceId: stop?.jobId
        ? "system_job_service_stop"
        : stop?.recurringServiceStopId
          ? "system_recurring_service_stop"
          : "system_unknown_service_stop",
      tasks: estimateTasks,
      worker: getScheduledStopWorker(stop),
      workTypes: companyWorkTypes,
      mappings: workTypeMappings,
      rates: technicianRates,
      date: stop?.serviceDate?.toDate?.() || stop?.serviceDate || new Date(),
    });

    if (summary.needsReview) {
      console.warn("[JobDetailView][scheduledStopLaborNeedsReview]", {
        jobId,
        serviceStopId: stop?.id || "",
        serviceStopTypeId: stop?.typeId || stop?.serviceStopTypeId || "",
        serviceStopTypeName: stop?.type || stop?.serviceStopTypeName || "",
        techId: stop?.techId || stop?.userId || stop?.technicianId || "",
        techName: stop?.tech || stop?.techName || stop?.userName || "",
        totalAmountCents: summary.totalAmountCents,
        lines: summary.lines,
        payrollContext: {
          paySettingsLoaded: Boolean(paySettings),
          companyServiceStopTypesCount: companyServiceStopTypes.length,
          companyWorkTypesCount: companyWorkTypes.length,
          workTypeMappingsCount: workTypeMappings.length,
          technicianRatesCount: technicianRates.length,
          taskCount: estimateTasks.length,
        },
      });
    }

    return cents(summary.totalAmountCents);
  };
  const formatCurrency = (number, locale = "en-US", currency = "USD") =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(number || 0));

  const formatStatusLabel = (status) => {
    const raw = String(status || "").trim();
    if (!raw) return "";

    const normalized = raw.toLowerCase();
    const labels = {
      [SalesAgreementStatus.draft]: "Draft",
      [SalesAgreementStatus.sent]: "Sent",
      [SalesAgreementStatus.revised]: "Revised",
      [SalesAgreementStatus.accepted]: "Accepted",
      [SalesAgreementStatus.rejected]: "Rejected",
      [SalesAgreementStatus.expired]: "Expired",
      [SalesAgreementStatus.canceled]: "Canceled",
    };

    return labels[normalized] || raw;
  };

  const getStatusClass = (status) => {
    switch (formatStatusLabel(status)) {
      case "Draft":
      case "Estimate Pending":
      case "Unscheduled":
      case "Expired":
        return "bg-red-100 text-red-800";
      case "Estimate":
      case "Sent":
      case "Viewed":
      case "In Progress":
      case "Waiting for Parts":
        return "bg-yellow-100 text-yellow-800";
      case "Accepted":
      case "Scheduled":
      case "Finished":
      case "Paid":
      case "Comped":
      case JOB_BILLING_STATUS.customerResolved:
        return "bg-green-100 text-green-800";
      case "Invoiced":
        return "bg-blue-100 text-blue-800";
      case "Canceled":
      case "Rejected":
        return "bg-gray-200 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const statusTone = (status) => {
    switch (formatStatusLabel(status)) {
      case "Draft":
      case "Estimate Pending":
      case "Unscheduled":
      case "Expired":
        return "border-slate-200 bg-slate-50 text-slate-700";
      case "Estimate":
      case "Sent":
      case "Viewed":
      case "In Progress":
      case "Waiting for Parts":
        return "border-amber-200 bg-amber-50 text-amber-700";
      case "Accepted":
      case "Scheduled":
      case "Finished":
      case "Paid":
      case "Comped":
      case JOB_BILLING_STATUS.customerResolved:
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "Invoiced":
        return "border-blue-200 bg-blue-50 text-blue-700";
      case "Canceled":
      case "Rejected":
        return "border-rose-200 bg-rose-50 text-rose-700";
      default:
        return "border-slate-200 bg-slate-50 text-slate-700";
    }
  };

  const StatusBadge = ({ status }) => (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}>
      {formatStatusLabel(status) || "Not set"}
    </span>
  );

  const toneClasses = (tone) => {
    switch (tone) {
      case "red":
        return "border-red-200 bg-red-50 text-red-700";
      case "amber":
        return "border-amber-200 bg-amber-50 text-amber-800";
      case "blue":
        return "border-blue-200 bg-blue-50 text-blue-700";
      case "emerald":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      default:
        return "border-slate-200 bg-slate-50 text-slate-700";
    }
  };

  const issuePriorityTone = (priority) => toneClasses(getIssuePriorityTone(priority));

  const solutionTierTone = (tier) => toneClasses(getJobPlanTierTone(tier));

  const IssuePriorityBadge = ({ priority }) => {
    const normalizedPriority = normalizeIssuePriority(priority);

    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${issuePriorityTone(normalizedPriority)}`}>
        {normalizedPriority} - {getIssuePriorityLabel(normalizedPriority)}
      </span>
    );
  };

  const PlanTierBadge = ({ tier }) => {
    const normalizedTier = normalizeJobPlanTier(tier);

    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${solutionTierTone(normalizedTier)}`}>
        {getJobPlanRecommendationDisplay(normalizedTier)}
      </span>
    );
  };

  const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 12,
    colors: {
      ...theme.colors,
      primary25: "#DBEAFE",
      primary50: "#BFDBFE",
      primary: "#2563EB",
      neutral0: "#F8FAFC",
      neutral5: "#F1F5F9",
      neutral10: "#E2E8F0",
      neutral20: "#CBD5E1",
      neutral30: "#94A3B8",
      neutral40: "#64748B",
      neutral50: "#475569",
      neutral80: "#0F172A",
      neutral90: "#020617",
    },
  });

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: "#F8FAFC",
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? "#2563EB" : "#CBD5E1",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
      cursor: "pointer",
      "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#94A3B8" },
    }),
    dropdownIndicator: (base) => ({
      ...base,
      color: "#475569",
      "&:hover": { color: "#0F172A" },
    }),
    clearIndicator: (base) => ({
      ...base,
      color: "#64748B",
      "&:hover": { color: "#0F172A" },
    }),
    indicatorSeparator: (base) => ({
      ...base,
      backgroundColor: "#CBD5E1",
    }),
    input: (base) => ({
      ...base,
      color: "#0F172A",
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: "#FFFFFF",
      border: "1px solid #CBD5E1",
      borderRadius: 12,
      boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
      overflow: "hidden",
      zIndex: 40,
    }),
    menuList: (base) => ({
      ...base,
      backgroundColor: "#FFFFFF",
      padding: 4,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected ? "#2563EB" : state.isFocused ? "#DBEAFE" : "#FFFFFF",
      borderRadius: 8,
      color: state.isSelected ? "#FFFFFF" : "#0F172A",
      cursor: "pointer",
      fontWeight: state.isSelected ? 700 : 500,
      "&:active": {
        backgroundColor: state.isSelected ? "#2563EB" : "#BFDBFE",
      },
    }),
    placeholder: (base) => ({
      ...base,
      color: "#64748B",
    }),
    singleValue: (base) => ({
      ...base,
      color: "#0F172A",
      fontWeight: 600,
    }),
  };

  const fieldLabelClass = "block text-xs font-bold uppercase tracking-wide text-slate-600";
  const fieldInputClass =
    "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  const selectedTaskTypeValue = selectedTaskType?.value || "";
  const taskNeedsBodyOfWater = BODY_OF_WATER_JOB_TASK_TYPES.has(selectedTaskTypeValue);
  const taskNeedsEquipment = EQUIPMENT_JOB_TASK_TYPES.has(selectedTaskTypeValue);
  const taskNeedsInstallItem = INSTALL_ITEM_JOB_TASK_TYPES.has(selectedTaskTypeValue);
  const editingTaskTypeValue = taskEditForm.type || "";
  const editingTaskNeedsBodyOfWater = BODY_OF_WATER_JOB_TASK_TYPES.has(editingTaskTypeValue);
  const editingTaskNeedsEquipment = EQUIPMENT_JOB_TASK_TYPES.has(editingTaskTypeValue);
  const editingTaskNeedsInstallItem = INSTALL_ITEM_JOB_TASK_TYPES.has(editingTaskTypeValue);

  const taskEquipmentOptions = useMemo(() => {
    if (selectedTaskTypeValue !== "Clean Filter") return taskEquipmentList;

    return (taskEquipmentList || []).filter((item) =>
      String(item.type || item.category || "").toLowerCase().includes("filter")
    );
  }, [selectedTaskTypeValue, taskEquipmentList]);

  const editingTaskEquipmentOptions = useMemo(() => {
    if (editingTaskTypeValue !== "Clean Filter") return taskEquipmentList;

    return (taskEquipmentList || []).filter((item) =>
      String(item.type || item.category || "").toLowerCase().includes("filter")
    );
  }, [editingTaskTypeValue, taskEquipmentList]);

  const taskTypeSelectOptions = useMemo(() => {
    const options = (taskTypeList || []).map((option) => ({
      value: option.value || option.name || option.label || "",
      label: option.label || option.name || option.value || "",
    })).filter((option) => option.value);

    if (
      editingTaskTypeValue &&
      !options.some((option) => option.value === editingTaskTypeValue)
    ) {
      return [{ value: editingTaskTypeValue, label: editingTaskTypeValue }, ...options];
    }

    return options;
  }, [editingTaskTypeValue, taskTypeList]);

  const taskStatusSelectOptions = useMemo(() => {
    const currentStatus = taskEditForm.status || "";
    if (
      currentStatus &&
      !TASK_STATUS_OPTIONS.includes(currentStatus)
    ) {
      return [currentStatus, ...TASK_STATUS_OPTIONS];
    }

    return TASK_STATUS_OPTIONS;
  }, [taskEditForm.status]);

  const equipmentById = useMemo(
    () => new Map((taskEquipmentList || []).map((item) => [item.id, item])),
    [taskEquipmentList]
  );

  const bodyOfWaterById = useMemo(
    () => new Map((taskBodyOfWaterList || []).map((item) => [item.id, item])),
    [taskBodyOfWaterList]
  );

  const shoppingDbItemById = useMemo(
    () => new Map((shoppingDbItemList || []).map((item) => [item.id, item])),
    [shoppingDbItemList]
  );

  const getLinkedShoppingItemsForTask = (task) => {
    const linkedIds = new Set(
      [
        task?.shoppingListItemId,
        ...(Array.isArray(task?.shoppingListItemIds) ? task.shoppingListItemIds : []),
      ].filter(Boolean)
    );

    return (shoppingList || []).filter((item) => {
      const itemId = item.id || item.docId || "";
      const linkedTaskId =
        item.linkedTaskId ||
        item.linkedJobTaskId ||
        item.jobTaskId ||
        item.sourceTaskId ||
        "";

      return linkedIds.has(itemId) || linkedTaskId === task?.id;
    });
  };

  const taskContextLabel = (task) => {
    const parts = [];

    if (task.bodyOfWaterId) {
      parts.push(bodyOfWaterById.get(task.bodyOfWaterId)?.name || "Linked body of water");
    }

    if (task.equipmentId) {
      parts.push(equipmentById.get(task.equipmentId)?.name || "Linked equipment");
    }

    if (task.dataBaseItemId) {
      const item = (shoppingDbItemList || []).find((dbItem) => dbItem.id === task.dataBaseItemId);
      parts.push(item?.name || "Linked item");
    }

    return parts.join(" • ");
  };
  // Contract create confirmation modal
  const [showCreateContractModal, setShowCreateContractModal] = useState(false);
  const [showCreateWorkOfferModal, setShowCreateWorkOfferModal] = useState(false);
  const [savingWorkOffer, setSavingWorkOffer] = useState(false);
  const [workOfferForm, setWorkOfferForm] = useState({
    offerType: "Internal Board",
    workerId: "",
    boardVisibility: "Contractors Only",
    title: "",
    notes: "",
    selectedTaskIds: [],
    serviceStopTypeId: "",
    paySource: "Technician Rate",
    offeredAmount: "",
    includeDate: false,
    proposedStartDate: "",
    allowsTechnicianSelfScheduling: false,
  });

  // Contract details / edit modal
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractForm, setContractForm] = useState({
    id: "",
    receiverName: "",
    notes: "",
    rate: "",
    status: "Draft",
    lastDateToAccept: "",
    terms: [],
    lineItems: [],
    jobId: "",
  });

  const [savingContract, setSavingContract] = useState(false);
  const [deletingContract, setDeletingContract] = useState(false);
  const formatDateValue = (value) => {
    if (!value) return "—";
    const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
    return Number.isNaN(date?.getTime?.()) ? "—" : format(date, "MMM d, yyyy");
  };

  const formatDateTimeValue = (value) => {
    if (!value) return "—";
    const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
    return Number.isNaN(date?.getTime?.()) ? "—" : format(date, "MMM d, yyyy • h:mm a");
  };

  const formatTimeValue = (value) => {
    if (!value) return "—";
    const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
    if (!Number.isNaN(date?.getTime?.())) {
      return format(date, "h:mm a");
    }
    return String(value);
  };

  const formatDurationMinutes = (minutes) => {
    const value = Number(minutes || 0);
    if (!value) return "—";

    const hrs = Math.floor(value / 60);
    const mins = value % 60;

    if (hrs && mins) return `${hrs}h ${mins}m`;
    if (hrs) return `${hrs}h`;
    return `${mins}m`;
  };

  const getServiceStopAddress = (address = {}) => {
    const parts = [
      address?.streetAddress,
      address?.city,
      address?.state,
      address?.zip,
    ].filter(Boolean);

    return parts.length ? parts.join(", ") : "—";
  };

  const openServiceStopDetail = (stopId) => {
    if (!stopId) return;
    navigate(`/company/serviceStops/detail/${stopId}`);
  };

  const normalizeTerms = (terms) => {
    if (!Array.isArray(terms)) return [];
    return terms.map((term, index) => {
      if (typeof term === "string") {
        return {
          id: `term_${index}`,
          title: term,
          description: "",
          value: "",
        };
      }

      return {
        id: term?.id || `term_${index}`,
        title: term?.title || term?.name || term?.label || `Term ${index + 1}`,
        description: term?.description || term?.notes || "",
        value: term?.value || term?.amount || "",
      };
    });
  };

  const buildContractSnapshotFromScope = ({
    plannedStops = plannedServiceStops,
    tasks = taskList,
    laborLines = laborLineItems,
    materials = shoppingList,
  } = {}) => {
    const normalizedLaborLines = normalizeJobLaborLineItems(laborLines);
    const taskIds = (tasks || []).map((task) => task.id).filter(Boolean);
    const plannedStopIds = (plannedStops || []).map((stop) => stop.id).filter(Boolean);
    const fallbackLaborPriceCents =
      (tasks || []).reduce((total, task) => total + getTaskBillingLaborPriceCents(task), 0) +
      (plannedStops || []).reduce((total, stop) => total + getPlannedStopCostCents(stop), 0);
    const fallbackLaborCostCents =
      (tasks || []).reduce((total, task) => total + cents(task.contractedRate), 0) +
      (plannedStops || []).reduce((total, stop) => total + getPlannedStopCostCents(stop), 0);

    const laborItems = normalizedLaborLines.length
      ? normalizedLaborLines.map((line, index) => {
        const quantity = Math.max(quantityNumber(line.quantity || 1), 1);
        const totalAmountCents = cents(line.totalPriceCents);
        const unitAmountCents = cents(line.unitPriceCents || (quantity ? Math.round(totalAmountCents / quantity) : totalAmountCents));
        const lineTaskIds = getLaborLineTaskIds(line);
        const linePlannedStopIds = getLaborLinePlannedStopIds(line);

        return {
          id: line.id || `labor_line_${index}`,
          laborLineId: line.id || `labor_line_${index}`,
          catalogItemId: line.salesCatalogItemId || "",
          sourceType: SalesCatalogSourceType.manual,
          sourceId: line.id || `labor_line_${index}`,
          salesItemType: SalesCatalogItemType.labor,
          billingBehavior: SalesCatalogBillingBehavior.oneTime,
          type: "Labor",
          name: line.name || `Labor ${index + 1}`,
          description: [line.description, laborLineScopeLabel(line)].filter(Boolean).join(" • "),
          quantity,
          unitAmountCents,
          totalAmountCents,
          amount: totalAmountCents,
          billingLaborPriceCents: totalAmountCents,
          internalLaborCostCents: cents(line.internalCostCents),
          unitCostCents: cents(line.internalCostCents),
          taskIds: lineTaskIds,
          plannedServiceStopIds: linePlannedStopIds,
          taxable: false,
          stripeProductId: line.stripeProductId || "",
          stripePriceId: line.stripePriceId || "",
          displayAmount: moneyFromCents(totalAmountCents),
          metadata: {
            laborLineId: line.id || `labor_line_${index}`,
            jobId,
            jobInternalId: job.internalId || "",
            taskIds: lineTaskIds,
            plannedServiceStopIds: linePlannedStopIds,
          },
        };
      })
      : (fallbackLaborPriceCents || fallbackLaborCostCents)
        ? [{
          id: `job_labor_${jobId || "current"}`,
          laborLineId: "",
          catalogItemId: "",
          sourceType: SalesCatalogSourceType.manual,
          sourceId: jobId || "",
          salesItemType: SalesCatalogItemType.labor,
          billingBehavior: SalesCatalogBillingBehavior.oneTime,
          type: "Labor",
          name: "Labor",
          description: [
            taskIds.length ? `${taskIds.length} task${taskIds.length === 1 ? "" : "s"}` : "",
            plannedStopIds.length ? `${plannedStopIds.length} planned stop${plannedStopIds.length === 1 ? "" : "s"}` : "",
          ].filter(Boolean).join(" • "),
          quantity: 1,
          unitAmountCents: fallbackLaborPriceCents,
          totalAmountCents: fallbackLaborPriceCents,
          amount: fallbackLaborPriceCents,
          billingLaborPriceCents: fallbackLaborPriceCents,
          internalLaborCostCents: fallbackLaborCostCents,
          unitCostCents: fallbackLaborCostCents,
          taskIds,
          plannedServiceStopIds: plannedStopIds,
          taxable: false,
          stripeProductId: "",
          stripePriceId: "",
          displayAmount: moneyFromCents(fallbackLaborPriceCents),
          metadata: {
            generatedFromPlannedWork: true,
            jobId,
            jobInternalId: job.internalId || "",
            taskIds,
            plannedServiceStopIds: plannedStopIds,
          },
        }]
        : [];

    const materialItems = (materials || []).map((item) => {
      const amount = getShoppingPlannedTotalPriceCents(item);
      const quantity = Number(item.quantity || 0);
      const unitAmountCents =
        item?.plannedUnitPriceCents !== undefined && item?.plannedUnitPriceCents !== null
          ? cents(item.plannedUnitPriceCents)
          : quantity
            ? Math.round(amount / quantity)
            : amount;

      return {
        id: item.id,
        catalogItemId: item.salesCatalogItemId || "",
        sourceType: item.dbItemId || item.genericItemId
          ? SalesCatalogSourceType.databaseItem
          : SalesCatalogSourceType.shoppingListItem,
        sourceId: item.dbItemId || item.genericItemId || item.id,
        salesItemType: SalesCatalogItemType.material,
        billingBehavior: SalesCatalogBillingBehavior.oneTime,
        type: "Material",
        name: item.name || "Product",
        description: item.description || "",
        quantity,
        unitAmountCents,
        totalAmountCents: amount,
        amount,
        taxable: Boolean(item.taxable),
        stripeProductId: item.stripeProductId || "",
        stripePriceId: item.stripePriceId || "",
        displayAmount: moneyFromCents(amount),
      };
    });

    return [...laborItems, ...materialItems];
  };

  const buildSuggestedContractSnapshot = () => buildContractSnapshotFromScope();

  const contractSnapshotItems = useMemo(() => {
    if (selectedContract?.lineItems?.length) {
      return selectedContract.lineItems.map((item, index) => ({
        id: item?.id || `line_${index}`,
        type: item?.type || "Item",
        name: item?.name || item?.title || `Line ${index + 1}`,
        description: item?.description || "",
        quantity: Number(item?.quantity || 1),
        amount: Number(item?.amount || item?.totalAmountCents || item?.price || 0),
        displayAmount: formatCurrency((Number(item?.amount || item?.totalAmountCents || item?.price || 0) / 100) || 0),
      }));
    }

    return buildSuggestedContractSnapshot();
  }, [
    selectedContract,
    plannedServiceStops,
    taskList,
    laborLineItems,
    shoppingList,
    companyUserList,
    paySettings,
    companyServiceStopTypes,
    companyWorkTypes,
    workTypeMappings,
    technicianRates,
  ]);

  const billingSnapshotItems = useMemo(() => {
    if (selectedSalesAgreement?.lineItems?.length) {
      return selectedSalesAgreement.lineItems.map((item, index) => ({
        id: item?.id || `agreement_line_${index}`,
        type: item?.type || item?.salesItemType || "Item",
        name: item?.name || item?.title || `Line ${index + 1}`,
        description: item?.description || "",
        quantity: Number(item?.quantity || 1),
        amount: Number(item?.totalAmountCents || item?.amount || item?.price || 0),
        displayAmount: formatCurrency((Number(item?.totalAmountCents || item?.amount || item?.price || 0) / 100) || 0),
      }));
    }

    return contractSnapshotItems;
  }, [contractSnapshotItems, selectedSalesAgreement]);

  const plannedStopLaborCents = useMemo(() => {
    return (plannedServiceStops || []).reduce(
      (total, stop) => total + getPlannedStopCostCents(stop),
      0
    );
  }, [
    plannedServiceStops,
    taskList,
    companyUserList,
    paySettings,
    companyServiceStopTypes,
    companyWorkTypes,
    workTypeMappings,
    technicianRates,
  ]);

  const plannedTaskLaborCents = useMemo(() => {
    return (taskList || []).reduce(
      (total, task) => total + cents(task.contractedRate),
      0
    );
  }, [taskList]);

  const plannedTaskBillingLaborCents = (taskList || []).reduce(
    (total, task) => total + getTaskBillingLaborPriceCents(task),
    0
  );

  const plannedLaborLinePriceCents = useMemo(() => {
    return (laborLineItems || []).reduce((total, line) => total + cents(line.totalPriceCents), 0);
  }, [laborLineItems]);

  const plannedLaborLineCostCents = useMemo(() => {
    return (laborLineItems || []).reduce((total, line) => total + cents(line.internalCostCents), 0);
  }, [laborLineItems]);

  const plannedLaborPriceCents = useMemo(() => {
    if ((laborLineItems || []).length) return plannedLaborLinePriceCents;
    return plannedStopLaborCents + plannedTaskBillingLaborCents;
  }, [laborLineItems, plannedLaborLinePriceCents, plannedStopLaborCents, plannedTaskBillingLaborCents]);

  const plannedTotalLaborCents = useMemo(() => {
    if ((laborLineItems || []).length) return plannedLaborLineCostCents;
    return plannedStopLaborCents + plannedTaskLaborCents;
  }, [laborLineItems, plannedLaborLineCostCents, plannedStopLaborCents, plannedTaskLaborCents]);

  const plannedMaterialCostCents = useMemo(() => {
    return (shoppingList || []).reduce(
      (total, item) => total + getShoppingPlannedTotalCostCents(item),
      0
    );
  }, [shoppingList]);

  const plannedMaterialPriceCents = useMemo(() => {
    return (shoppingList || []).reduce(
      (total, item) => total + getShoppingPlannedTotalPriceCents(item),
      0
    );
  }, [shoppingList]);

  const plannedEstimatePriceCents = useMemo(() => {
    return plannedLaborPriceCents + plannedMaterialPriceCents;
  }, [plannedLaborPriceCents, plannedMaterialPriceCents]);

  const activePlan = useMemo(() => (
    (jobPlans || []).find((solution) => solution.id === (job.activePlanId || job.activeSolutionId)) ||
    (jobPlans || []).find((solution) => solution.isActivePlan) ||
    (jobPlans || []).find((solution) => solution.id === (job.acceptedPlanId || job.acceptedSolutionId)) ||
    null
  ), [jobPlans, job.activePlanId, job.activeSolutionId, job.acceptedPlanId, job.acceptedSolutionId]);

  const acceptedPlan = useMemo(() => (
    (jobPlans || []).find((solution) => solution.id === (job.acceptedPlanId || job.acceptedSolutionId)) ||
    (jobPlans || []).find((solution) => solution.isAccepted) ||
    (jobPlans || []).find((solution) => normalizeJobPlanStatus(solution.status) === JOB_PLAN_STATUS.ACCEPTED) ||
    null
  ), [jobPlans, job.acceptedPlanId, job.acceptedSolutionId]);

  const selectedEditorPlan = useMemo(() => {
    const targetId =
      selectedPlanEditorId ||
      job.activePlanId ||
      job.activeSolutionId ||
      activePlan?.id ||
      "";

    return (
      (jobPlans || []).find((solution) => solution.id === targetId) ||
      activePlan ||
      (jobPlans || [])[0] ||
      null
    );
  }, [activePlan, job.activePlanId, job.activeSolutionId, jobPlans, selectedPlanEditorId]);

  useEffect(() => {
    if (!jobPlans.length) {
      if (selectedPlanEditorId) setSelectedPlanEditorId("");
      return;
    }

    const preferredId =
      selectedPlanEditorId ||
      job.activePlanId ||
      job.activeSolutionId ||
      activePlan?.id ||
      jobPlans[0]?.id ||
      "";

    if (preferredId && jobPlans.some((solution) => solution.id === preferredId)) {
      if (!selectedPlanEditorId) setSelectedPlanEditorId(preferredId);
      return;
    }

    setSelectedPlanEditorId(jobPlans[0]?.id || "");
  }, [activePlan?.id, job.activePlanId, job.activeSolutionId, jobPlans, selectedPlanEditorId]);

  useEffect(() => {
    if (!selectedEditorPlan) {
      setPlanEditorDraft({ title: "", description: "" });
      return;
    }

    setPlanEditorDraft({
      title: getJobPlanDisplayName(selectedEditorPlan, ""),
      description: selectedEditorPlan.description || "",
    });
  }, [selectedEditorPlan]);

  const explicitPlanTotalCents = (solution = {}) =>
    cents(solution.billingSummary?.totalAmountCents ?? solution.totalAmountCents ?? solution.rateAmountCents ?? solution.rate ?? 0);

  const planOptionLaborCents = (solution = {}) => {
    const explicitLaborCost = cents(
      solution.costSummary?.plannedLaborCostCents ??
      solution.plannedLaborCostCents ??
      solution.laborCostCents ??
      solution.laborCost ??
      0
    );
    if (explicitLaborCost > 0) return explicitLaborCost;

    return normalizeJobLaborLineItems(solution.laborLineItems || solution.estimateLaborLineItems || [])
      .reduce((total, line) => total + cents(line.internalCostCents), 0);
  };

  const planOptionMaterialCostCents = (solution = {}) =>
    cents(solution.costSummary?.plannedMaterialCostCents ?? solution.materialCostCents ?? solution.plannedMaterialCostCents ?? 0);

  const planScopeArrays = (solution = {}) => ({
    tasks: Array.isArray(solution.tasks) ? solution.tasks : [],
    plannedServiceStops: Array.isArray(solution.plannedServiceStops) ? solution.plannedServiceStops : [],
    laborLineItems: normalizeJobLaborLineItems(solution.laborLineItems || solution.estimateLaborLineItems || []),
    shoppingItems: Array.isArray(solution.shoppingItems) ? solution.shoppingItems : [],
  });

  const linkedTaskIdForPlanMaterial = (item = {}) => (
    idValue(
      item.linkedTaskId ||
      item.linkedJobTaskId ||
      item.jobTaskId ||
      item.sourceTaskId ||
      item.taskId ||
      ""
    )
  );

  const buildPlanMaterialPrepKeys = (item = {}, linkedTaskId = "", overrides = {}) => Array.from(
    new Set(
      [
        ...(Array.isArray(item.prepKeys) ? item.prepKeys : []),
        jobId ? `job:${jobId}` : "",
        overrides.customerId || item.customerId ? `customer:${overrides.customerId || item.customerId}` : "",
        overrides.serviceLocationId || item.serviceLocationId ? `serviceLocation:${overrides.serviceLocationId || item.serviceLocationId}` : "",
        linkedTaskId ? `jobTask:${linkedTaskId}` : "",
      ].filter(Boolean)
    )
  );

  const attachPlanMaterialsToTasks = (tasks = [], materials = []) => {
    const materialIdsByTaskId = new Map();

    materials.forEach((item) => {
      const linkedTaskId = linkedTaskIdForPlanMaterial(item);
      if (!linkedTaskId || !item?.id) return;

      const currentIds = materialIdsByTaskId.get(linkedTaskId) || [];
      materialIdsByTaskId.set(linkedTaskId, [...currentIds, item.id]);
    });

    return tasks.map((task) => {
      const materialIds = materialIdsByTaskId.get(task.id) || [];
      if (!materialIds.length) return task;

      const shoppingListItemIds = Array.from(
        new Set(
          [
            task.shoppingListItemId,
            ...(Array.isArray(task.shoppingListItemIds) ? task.shoppingListItemIds : []),
            ...materialIds,
          ].filter(Boolean)
        )
      );

      return {
        ...task,
        shoppingListItemId: task.shoppingListItemId || shoppingListItemIds[0] || "",
        shoppingListItemIds,
      };
    });
  };

  const planLineItems = (solution = {}) => {
    if (Array.isArray(solution.estimateLineItems) && solution.estimateLineItems.length) {
      return solution.estimateLineItems;
    }

    if (Array.isArray(solution.lineItems) && solution.lineItems.length) {
      return solution.lineItems;
    }

    const scope = planScopeArrays(solution);
    const lineItems = buildContractSnapshotFromScope({
      plannedStops: scope.plannedServiceStops,
      tasks: scope.tasks,
      laborLines: scope.laborLineItems,
      materials: scope.shoppingItems,
    });

    if (lineItems.length) return lineItems;

    const total = explicitPlanTotalCents(solution);
    return total > 0
      ? [{
        id: `plan_${solution.id || "option"}`,
        catalogItemId: "",
        sourceType: SalesCatalogSourceType.manual,
        sourceId: solution.id || "",
        salesItemType: SalesCatalogItemType.service,
        billingBehavior: SalesCatalogBillingBehavior.oneTime,
        type: "Plan",
        name: getJobPlanDisplayName(solution, "Plan Option"),
        description: solution.description || "",
        quantity: 1,
        unitAmountCents: total,
        totalAmountCents: total,
        amount: total,
        taxable: false,
        displayAmount: moneyFromCents(total),
      }]
      : [];
  };

  const planOptionTotalCents = (solution = {}) => {
    const explicitTotal = explicitPlanTotalCents(solution);
    if (explicitTotal > 0) return explicitTotal;
    return planLineItems(solution).reduce((total, item) => total + cents(item.totalAmountCents || item.amount || 0), 0);
  };

  const selectedEditorPlanScope = selectedEditorPlan ? planScopeArrays(selectedEditorPlan) : null;
  const savedPlanEditorSnapshot = useMemo(() => {
    if (!selectedEditorPlan) {
      return buildPlanEditorSnapshot();
    }

    return buildPlanEditorSnapshot({
      planId: selectedEditorPlan.id,
      title: getJobPlanDisplayName(selectedEditorPlan, ""),
      description: selectedEditorPlan.description || "",
      tasks: selectedEditorPlanScope.tasks,
      plannedStops: selectedEditorPlanScope.plannedServiceStops,
      laborLines: selectedEditorPlanScope.laborLineItems,
      materials: selectedEditorPlanScope.shoppingItems,
    });
  }, [
    selectedEditorPlan,
    selectedEditorPlanScope,
  ]);
  const currentPlanEditorSnapshot = useMemo(() => (
    buildPlanEditorSnapshot({
      planId: selectedEditorPlan?.id || selectedPlanEditorId || "",
      title: planEditorDraft.title,
      description: planEditorDraft.description,
      tasks: taskList,
      plannedStops: plannedServiceStops,
      laborLines: laborLineItems,
      materials: shoppingList,
    })
  ), [
    selectedEditorPlan?.id,
    selectedPlanEditorId,
    planEditorDraft.title,
    planEditorDraft.description,
    taskList,
    plannedServiceStops,
    laborLineItems,
    shoppingList,
  ]);
  const hasPlanEditorContent = Boolean(
    planEditorDraft.title.trim() ||
    planEditorDraft.description.trim() ||
    (taskList || []).length ||
    (plannedServiceStops || []).length ||
    (laborLineItems || []).length ||
    (shoppingList || []).length
  );
  const hasUnsavedPlanEditorChanges = Boolean(
    !loading &&
    !plansLoading &&
    !loadingPlanEditorId &&
    hasPlanEditorContent &&
    currentPlanEditorSnapshot !== savedPlanEditorSnapshot
  );

  useUnsavedChangesWarning(hasUnsavedPlanEditorChanges, PLAN_EDITOR_UNSAVED_WARNING);

  const currentIssuePriority = () =>
    normalizeIssuePriority(job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY);

  const resetPlanForm = (solution = null) => {
    const tier = normalizeJobPlanTier(solution?.planTier || solution?.solutionTier || DEFAULT_JOB_PLAN_TIER);
    const lineItems = solution ? planLineItems(solution) : buildSuggestedContractSnapshot();
    const calculatedTotalCents = solution
      ? planOptionTotalCents(solution)
      : lineItems.reduce((total, item) => total + cents(item.totalAmountCents || item.amount || 0), 0);
    setPlanForm({
      id: solution?.id || "",
      title: solution ? getJobPlanDisplayName(solution, "") : "",
      planTier: tier,
      solutionTier: tier,
      status: normalizeJobPlanStatus(solution?.status || JOB_PLAN_STATUS.DRAFT),
      description: solution?.description || "",
      rate: dollarsFromCents(calculatedTotalCents || job.rate || 0),
      laborCost: dollarsFromCents(solution ? planOptionLaborCents(solution) : plannedTotalLaborCents),
    });
  };

  const openPlanModal = (solution = null) => {
    resetPlanForm(solution);
    setShowPlanModal(true);
  };

  const closePlanModal = () => {
    if (savingPlan) return;
    setShowPlanModal(false);
    resetPlanForm();
  };

  const planSnapshotFromCurrentWork = ({
    solutionId,
    solutionTier,
    solutionTierLabel,
    title,
    description,
    totalAmountCents,
    laborCostCents,
    status,
  }) => {
    const priority = currentIssuePriority();
    const priorityLabel = getIssuePriorityLabel(priority);
    const planName = String(title || "").trim() || "Untitled Plan";
    const taskSnapshots = (taskList || []).map((task, index) => ({
      ...task,
      sortOrder: Number(task.sortOrder ?? index),
      companyId: recentlySelectedCompany,
      jobId,
      sourceSolutionId: solutionId,
    }));
    const plannedStopSnapshots = (plannedServiceStops || []).map((stop, index) => ({
      ...stop,
      sortOrder: Number(stop.sortOrder ?? index),
      companyId: recentlySelectedCompany,
      jobId,
      sourceSolutionId: solutionId,
    }));
    const laborLineSnapshots = normalizeJobLaborLineItems(laborLineItems).map((line, index) => ({
      ...line,
      sortOrder: Number(line.sortOrder ?? index),
      companyId: recentlySelectedCompany,
      jobId,
      sourcePlanId: solutionId,
      sourceSolutionId: solutionId,
    }));
    const materialSnapshots = (shoppingList || []).map((item, index) => ({
      ...item,
      sortOrder: Number(item.sortOrder ?? index),
      companyId: recentlySelectedCompany,
      jobId,
      sourceSolutionId: solutionId,
      solutionId,
    }));
    const lineItems = buildContractSnapshotFromScope({
      plannedStops: plannedStopSnapshots,
      tasks: taskSnapshots,
      laborLines: laborLineSnapshots,
      materials: materialSnapshots,
    });
    const subtotalAmountCents = lineItems.reduce(
      (total, item) => total + cents(item.totalAmountCents || item.amount || 0),
      0
    );
    const calculatedTotalAmountCents = subtotalAmountCents || totalAmountCents || cents(job.rate);
    const calculatedLaborCostCents = plannedTotalLaborCents || laborCostCents || cents(job.laborCost);
    const internalCostCents = calculatedLaborCostCents + plannedMaterialCostCents;
    const projectedProfitCents = calculatedTotalAmountCents - internalCostCents;
    const profitMarginPercent = calculatedTotalAmountCents > 0
      ? Math.round((projectedProfitCents / calculatedTotalAmountCents) * 1000) / 10
      : 0;
    const scopeOfWork = {
      title: planName,
      customerDescription: description,
      issueDescription: job.description || "",
      taskSummaries: taskSnapshots.map((task, index) => ({
        id: task.id || "",
        sortOrder: Number(task.sortOrder ?? index),
        name: task.name || task.description || `Task ${index + 1}`,
        type: task.type || "",
        estimatedMinutes: Number(task.estimatedTime || 0),
        plannedLaborCostCents: cents(task.contractedRate),
        billingLaborPriceCents: getTaskBillingLaborPriceCents(task),
        bodyOfWaterId: task.bodyOfWaterId || "",
        equipmentId: task.equipmentId || "",
        dataBaseItemId: task.dataBaseItemId || "",
      })),
      plannedStopSummaries: plannedStopSnapshots.map((stop, index) => ({
        id: stop.id || "",
        sortOrder: Number(stop.sortOrder ?? index),
        name: stop.name || stop.serviceStopTypeName || `Planned Visit ${index + 1}`,
        serviceStopTypeId: stop.serviceStopTypeId || stop.typeId || "",
        serviceStopTypeName: stop.serviceStopTypeName || stop.type || "",
        estimatedMinutes: Number(stop.estimatedMinutes || 0),
        plannedLaborCostCents: getPlannedStopCostCents(stop),
        taskIds: Array.isArray(stop.taskIds) ? stop.taskIds : [],
      })),
      laborLineSummaries: laborLineSnapshots.map((line, index) => ({
        id: line.id || "",
        sortOrder: Number(line.sortOrder ?? index),
        name: line.name || `Labor ${index + 1}`,
        description: line.description || "",
        quantity: Number(line.quantity || 1),
        unitPriceCents: cents(line.unitPriceCents),
        totalPriceCents: cents(line.totalPriceCents),
        internalCostCents: cents(line.internalCostCents),
        taskIds: getLaborLineTaskIds(line),
        plannedServiceStopIds: getLaborLinePlannedStopIds(line),
      })),
      materialSummaries: materialSnapshots.map((item, index) => ({
        id: item.id || "",
        sortOrder: Number(item.sortOrder ?? index),
        name: item.name || item.dbItemName || `Material ${index + 1}`,
        description: item.description || "",
        quantity: item.quantity || "1",
        plannedTotalCostCents: getShoppingPlannedTotalCostCents(item),
        plannedTotalPriceCents: getShoppingPlannedTotalPriceCents(item),
        customerApprovalRequired: Boolean(item.customerApprovalRequired),
      })),
      counts: {
        tasks: taskSnapshots.length,
        plannedServiceStops: plannedStopSnapshots.length,
        laborLineItems: laborLineSnapshots.length,
        shoppingItems: materialSnapshots.length,
        lineItems: lineItems.length,
      },
    };

    return {
      id: solutionId,
      planId: solutionId,
      solutionId,
      companyId: recentlySelectedCompany,
      jobId,
      jobInternalId: job.internalId || "",
      customerId: job.customerId || customer.id || "",
      customerName: job.customerName || getCustomerDisplayName(),
      serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
      serviceLocationName: job.serviceLocationName || serviceLocation.nickName || "",
      bodyOfWaterId: job.bodyOfWaterId || "",
      bodyOfWaterName: job.bodyOfWaterName || "",
      equipmentId: job.equipmentId || "",
      equipmentName: job.equipmentName || "",
      sourceType: "currentJobPlan",
      title: planName,
      name: planName,
      planName,
      description,
      status,
      planTier: solutionTier,
      planTierLabel: solutionTierLabel,
      solutionTier,
      solutionTierLabel,
      recommendationRank: solutionTier,
      recommendationRankLabel: solutionTierLabel,
      issuePriorityLevel: priority,
      issuePriorityLabel: priorityLabel,
      isAccepted: false,
      isActivePlan: false,
      rateAmountCents: calculatedTotalAmountCents,
      totalAmountCents: calculatedTotalAmountCents,
      subtotalAmountCents,
      laborCostCents: calculatedLaborCostCents,
      plannedLaborCostCents: calculatedLaborCostCents,
      materialCostCents: plannedMaterialCostCents,
      materialPriceCents: plannedMaterialPriceCents,
      internalCostCents,
      projectedProfitCents,
      profitMarginPercent,
      scopeOfWork,
      costSummary: {
        plannedLaborCostCents: calculatedLaborCostCents,
        plannedLaborLineCostCents,
        plannedLaborLinePriceCents,
        plannedLaborPriceCents,
        plannedTaskLaborCents,
        plannedTaskBillingLaborCents,
        plannedServiceStopLaborCostCents: plannedStopLaborCents,
        plannedMaterialCostCents,
        plannedMaterialPriceCents,
        internalCostCents,
      },
      billingSummary: {
        pricingSource: lineItems.length ? "plannedScopeLineItems" : "jobFallbackRate",
        lineItemCount: lineItems.length,
        subtotalAmountCents,
        totalAmountCents: calculatedTotalAmountCents,
        plannedLaborPriceCents,
        plannedTaskBillingLaborCents,
        projectedProfitCents,
        profitMarginPercent,
      },
      tasks: taskSnapshots,
      plannedServiceStops: plannedStopSnapshots,
      laborLineItems: laborLineSnapshots,
      estimateLaborLineItems: laborLineSnapshots,
      shoppingItems: materialSnapshots,
      lineItems,
      estimateLineItems: lineItems,
      taskCount: taskSnapshots.length,
      plannedStopCount: plannedStopSnapshots.length,
      laborLineCount: laborLineSnapshots.length,
      materialCount: materialSnapshots.length,
      updatedAt: serverTimestamp(),
      updatedAtMillis: Date.now(),
      updatedByUserId: getUserId() || "",
      updatedByUserName: getAuditUserName(),
    };
  };

  const sortPlanOptions = (options = []) =>
    [...options].sort((a, b) => {
      const tierSort = normalizeJobPlanTier(a.planTier || a.solutionTier) - normalizeJobPlanTier(b.planTier || b.solutionTier);
      if (tierSort !== 0) return tierSort;
      const aDate = a.createdAt?.toDate?.()?.getTime?.() || Number(a.createdAtMillis || 0);
      const bDate = b.createdAt?.toDate?.()?.getTime?.() || Number(b.createdAtMillis || 0);
      return aDate - bDate;
    });

  const upsertLocalPlanOption = (payload, { makeActive = true } = {}) => {
    const localPayload = {
      ...payload,
      _sourceCollection: "plans",
      updatedAt: new Date(),
    };

    setJobPlans((prev) => {
      const next = (prev || [])
        .filter((solution) => solution.id !== localPayload.id)
        .map((solution) => (
          makeActive
            ? { ...solution, isActivePlan: false }
            : solution
        ));

      return sortPlanOptions([...next, localPayload]);
    });
  };

  const saveCurrentEditorToPlan = async ({
    planId = "",
    title = "",
    planTier = "",
    status = "",
    description = undefined,
    makeActive = true,
    showToast = true,
    recordHistory = true,
    historyTitle = "",
    switchToTab = "",
  } = {}) => {
    if (!recentlySelectedCompany || !jobId) throw new Error("Missing job context.");

    const existingSolution = (jobPlans || []).find((solution) => solution.id === planId);
    const solutionId = planId || `comp_job_plan_${uuidv4()}`;
    const solutionTier = normalizeJobPlanTier(planTier || existingSolution?.planTier || existingSolution?.solutionTier || DEFAULT_JOB_PLAN_TIER);
    const solutionTierLabel = getJobPlanRecommendationLabel(solutionTier);
    const existingPlanName = existingSolution ? getJobPlanDisplayName(existingSolution, "") : "";
    const nextTitle = (title || existingPlanName || "").trim() || "Untitled Plan";
    const nextDescription = typeof description === "string"
      ? description.trim()
      : (existingSolution?.description || "").trim();
    const currentLineItems = buildSuggestedContractSnapshot();
    const totalAmountCents =
      currentLineItems.reduce((total, item) => total + cents(item.totalAmountCents || item.amount || 0), 0) ||
      cents(job.rate);
    const laborCostCents = plannedTotalLaborCents || cents(job.laborCost);
    const requestedStatus = normalizeJobPlanStatus(status || existingSolution?.status || JOB_PLAN_STATUS.DRAFT);
    const nextStatus = existingSolution?.isAccepted ? JOB_PLAN_STATUS.ACCEPTED : requestedStatus;
    const nowMillis = Date.now();

    const payload = {
      ...(existingSolution || {}),
      ...planSnapshotFromCurrentWork({
        solutionId,
        solutionTier,
        solutionTierLabel,
        title: nextTitle,
        description: nextDescription,
        totalAmountCents,
        laborCostCents,
        status: nextStatus,
      }),
      isAccepted: Boolean(existingSolution?.isAccepted),
      isActivePlan: makeActive ? true : Boolean(existingSolution?.isActivePlan),
      acceptedAt: existingSolution?.acceptedAt || null,
      acceptedByUserId: existingSolution?.acceptedByUserId || "",
      acceptedByUserName: existingSolution?.acceptedByUserName || "",
      createdAt: existingSolution?.createdAt || serverTimestamp(),
      createdAtMillis: existingSolution?.createdAtMillis || nowMillis,
      createdByUserId: existingSolution?.createdByUserId || getUserId() || "",
      createdByUserName: existingSolution?.createdByUserName || getAuditUserName(),
    };

    await setDoc(doc(jobPlansPath(recentlySelectedCompany, jobId), solutionId), payload, { merge: true });

    if (makeActive) {
      const jobUpdates = {
        activePlanId: solutionId,
        activePlanTier: solutionTier,
        activePlanTierLabel: solutionTierLabel,
        activeSolutionId: solutionId,
        activeSolutionTier: solutionTier,
        activeSolutionTierLabel: solutionTierLabel,
        activePlanRecommendationRank: solutionTier,
        activePlanRecommendationRankLabel: solutionTierLabel,
        planSelectionStatus: nextStatus,
        solutionSelectionStatus: nextStatus,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      };

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), jobUpdates);

      const inactiveWrites = (jobPlans || [])
        .filter((solution) => solution.id !== solutionId && solution.isActivePlan)
        .map((solution) => {
          const sourcePath = solution._sourceCollection === "solutions"
            ? legacyJobSolutionsPath(recentlySelectedCompany, jobId)
            : jobPlansPath(recentlySelectedCompany, jobId);

          return setDoc(doc(sourcePath, solution.id), {
            isActivePlan: false,
            updatedAt: serverTimestamp(),
            updatedAtMillis: nowMillis,
          }, { merge: true });
        });

      if (inactiveWrites.length) await Promise.all(inactiveWrites);

      setJob((prev) => ({
        ...prev,
        ...jobUpdates,
        updatedAt: new Date(nowMillis),
      }));
      setSelectedPlanEditorId(solutionId);
    }

    upsertLocalPlanOption(payload, { makeActive });

    if (recordHistory) {
      await recordJobHistory({
        eventType: "Plan",
        title: historyTitle || (existingSolution ? `Plan updated: ${nextTitle}` : `Plan added: ${nextTitle}`),
        description: nextDescription,
        changes: [
          buildHistoryChange(
            "recommendationRank",
            "Recommendation Rank",
            existingSolution ? getJobPlanRecommendationDisplay(existingSolution.planTier || existingSolution.solutionTier) : "—",
            getJobPlanRecommendationDisplay(solutionTier)
          ),
          buildHistoryChange("totalAmountCents", "Calculated Customer Price", existingSolution ? moneyFromCents(planOptionTotalCents(existingSolution)) : "—", moneyFromCents(payload.totalAmountCents)),
          buildHistoryChange("taskCount", "Tasks", existingSolution ? String(existingSolution.taskCount || 0) : "—", String(payload.taskCount || 0)),
          buildHistoryChange("plannedStopCount", "Planned Stops", existingSolution ? String(existingSolution.plannedStopCount || 0) : "—", String(payload.plannedStopCount || 0)),
          buildHistoryChange("materialCount", "Products", existingSolution ? String(existingSolution.materialCount || 0) : "—", String(payload.materialCount || 0)),
        ],
        metadata: {
          planId: solutionId,
          planTier: solutionTier,
          planTierLabel: solutionTierLabel,
          snapshotSource: "plannedEditor",
        },
        severity: existingSolution ? "info" : "success",
      });
    }

    if (showToast) toast.success(existingSolution ? "Plan updated" : "Plan added");
    if (switchToTab) handleJobTabChange(switchToTab);

    return payload;
  };

  const savePlanOption = async () => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!planForm.title.trim()) {
      toast.error("Add a plan name");
      return;
    }

    try {
      setSavingPlan(true);
      await saveCurrentEditorToPlan({
        planId: planForm.id,
        title: planForm.title,
        planTier: planForm.planTier || planForm.solutionTier,
        status: planForm.status,
        description: planForm.description,
        makeActive: true,
        showToast: true,
        recordHistory: true,
        switchToTab: "Plans",
      });
      setShowPlanModal(false);
      resetPlanForm();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save plan");
    } finally {
      setSavingPlan(false);
    }
  };

  const planWorkspaceScope = (solution, { accepted = false } = {}) => {
    const scope = planScopeArrays(solution);
    const taskIdMap = new Map();
    const stopIdMap = new Map();
    const baseTasksToWrite = scope.tasks.map((task, index) => {
      const sourceTaskId = task.id || "";
      const nextTaskId = sourceTaskId || `comp_job_task_${uuidv4()}`;
      if (sourceTaskId) taskIdMap.set(sourceTaskId, nextTaskId);

      return {
        ...task,
        id: nextTaskId,
        companyId: recentlySelectedCompany,
        jobId,
        status: task.status || "Unassigned",
        sortOrder: Number(task.sortOrder ?? index),
        sourcePlanId: solution.id,
        sourceSolutionId: solution.id,
      };
    });
    const taskIds = new Set(baseTasksToWrite.map((task) => task.id));
    const plannedStopsToWrite = scope.plannedServiceStops.map((stop, index) => {
      const sourceStopId = stop.id || "";
      const nextStopId = sourceStopId || `comp_job_plan_stop_${uuidv4()}`;
      if (sourceStopId) stopIdMap.set(sourceStopId, nextStopId);

      return {
        ...stop,
        id: nextStopId,
        companyId: recentlySelectedCompany,
        jobId,
        taskIds: Array.isArray(stop.taskIds)
          ? stop.taskIds.map((taskId) => taskIdMap.get(taskId) || taskId).filter((taskId) => taskIds.has(taskId))
          : [],
        sortOrder: Number(stop.sortOrder ?? index),
        sourcePlanId: solution.id,
        sourceSolutionId: solution.id,
      };
    });
    const plannedStopIds = new Set(plannedStopsToWrite.map((stop) => stop.id));
    const laborLinesToWrite = normalizeJobLaborLineItems(scope.laborLineItems).map((line, index) => ({
      ...line,
      id: line.id || `comp_job_labor_line_${uuidv4()}`,
      companyId: recentlySelectedCompany,
      jobId,
      taskIds: getLaborLineTaskIds(line)
        .map((taskId) => taskIdMap.get(taskId) || taskId)
        .filter((taskId) => taskIds.has(taskId)),
      laborLineTaskIds: getLaborLineTaskIds(line)
        .map((taskId) => taskIdMap.get(taskId) || taskId)
        .filter((taskId) => taskIds.has(taskId)),
      plannedServiceStopIds: getLaborLinePlannedStopIds(line)
        .map((stopId) => stopIdMap.get(stopId) || stopId)
        .filter((stopId) => plannedStopIds.has(stopId)),
      laborLinePlannedServiceStopIds: getLaborLinePlannedStopIds(line)
        .map((stopId) => stopIdMap.get(stopId) || stopId)
        .filter((stopId) => plannedStopIds.has(stopId)),
      sortOrder: Number(line.sortOrder ?? index),
      sourcePlanId: solution.id,
      sourceSolutionId: solution.id,
      acceptedPlanScope: accepted,
    }));
    const materialsToWrite = scope.shoppingItems.map((item, index) => {
      const customerApprovalRequired = Boolean(item.customerApprovalRequired);
      const customerApprovalApproved = item.customerApprovalStatus === "approved";
      const linkedTaskId = linkedTaskIdForPlanMaterial(item);
      const customerId = job.customerId || customer?.id || item.customerId || "";
      const serviceLocationId = job.serviceLocationId || serviceLocation?.id || item.serviceLocationId || "";

      return {
        ...item,
        id: item.id || `comp_shop_${uuidv4()}`,
        companyId: recentlySelectedCompany,
        category: "Job",
        jobId,
        customerId,
        customerName: job.customerName || getCustomerDisplayName() || item.customerName || "",
        serviceLocationId,
        linkedTaskId,
        status: accepted
          ? customerApprovalRequired && !customerApprovalApproved
            ? "Needs Customer Approval"
            : "Ready to Purchase"
          : "Needs Customer Approval",
        estimateAccepted: accepted,
        estimateAcceptedAt: accepted ? serverTimestamp() : null,
        jobBillingStatus: accepted ? "accepted" : String(job.billingStatus || "draft").toLowerCase(),
        needsAction: accepted,
        planWorkspaceOnly: !accepted,
        planId: solution.id,
        sourcePlanId: solution.id,
        solutionId: solution.id,
        sourceSolutionId: solution.id,
        prepKeys: buildPlanMaterialPrepKeys(item, linkedTaskId, { customerId, serviceLocationId }),
        sortOrder: Number(item.sortOrder ?? index),
      };
    });
    const tasksToWrite = attachPlanMaterialsToTasks(baseTasksToWrite, materialsToWrite);

    return { tasksToWrite, plannedStopsToWrite, laborLinesToWrite, materialsToWrite };
  };

  const replacePlannedWorkspace = async (solution, { accepted = false } = {}) => {
    const { tasksToWrite, plannedStopsToWrite, laborLinesToWrite, materialsToWrite } = planWorkspaceScope(solution, { accepted });

    await Promise.all([
      deleteQueryDocs(collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks")),
      deleteQueryDocs(plannedServiceStopsPath(recentlySelectedCompany, jobId)),
      deleteQueryDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("jobId", "==", jobId))),
    ]);

    const writes = [
      ...tasksToWrite.map((task) =>
        setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), task)
      ),
      ...plannedStopsToWrite.map((stop) =>
        setDoc(doc(plannedServiceStopsPath(recentlySelectedCompany, jobId), stop.id), stop)
      ),
      ...materialsToWrite.map((item) =>
        setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", item.id), item)
      ),
    ];

    await Promise.all(writes);

    setTaskList(tasksToWrite);
    setPlannedServiceStops(plannedStopsToWrite);
    setLaborLineItems(laborLinesToWrite);
    setShoppingList(
      materialsToWrite.map((item) => ({
        ...item,
        estimateAcceptedAt: accepted ? new Date() : null,
      }))
    );

    return { tasksToWrite, plannedStopsToWrite, laborLinesToWrite, materialsToWrite };
  };

  const confirmDiscardUnsavedPlanChanges = async () => (
    !hasUnsavedPlanEditorChanges || await appConfirm({
      title: "Unsaved Plan Changes",
      message: PLAN_EDITOR_DISCARD_WARNING,
      confirmLabel: "Discard Changes",
      variant: "danger",
    })
  );

  const loadPlanIntoEditor = async (solution, { confirmUnsavedChanges = true } = {}) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!solution?.id || !recentlySelectedCompany || !jobId) return;

    if (confirmUnsavedChanges && !(await confirmDiscardUnsavedPlanChanges())) return false;

    try {
      setLoadingPlanEditorId(solution.id);
      const { tasksToWrite, plannedStopsToWrite, laborLinesToWrite, materialsToWrite } = await replacePlannedWorkspace(solution, {
        accepted: false,
      });
      const solutionTier = normalizeJobPlanTier(solution.planTier || solution.solutionTier);
      const solutionTierLabel = getJobPlanRecommendationLabel(solutionTier);
      const nextStatus = normalizeJobPlanStatus(solution.status || JOB_PLAN_STATUS.DRAFT);
      const nowMillis = Date.now();
      const jobUpdates = {
        activePlanId: solution.id,
        activePlanTier: solutionTier,
        activePlanTierLabel: solutionTierLabel,
        activeSolutionId: solution.id,
        activeSolutionTier: solutionTier,
        activeSolutionTierLabel: solutionTierLabel,
        activePlanRecommendationRank: solutionTier,
        activePlanRecommendationRankLabel: solutionTierLabel,
        planSelectionStatus: nextStatus,
        solutionSelectionStatus: nextStatus,
        laborLineItems: laborLinesToWrite,
        estimateLaborLineItems: laborLinesToWrite,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      };

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), jobUpdates);

      await Promise.all(
        (jobPlans || []).map((option) => {
          const sourcePath = option._sourceCollection === "solutions"
            ? legacyJobSolutionsPath(recentlySelectedCompany, jobId)
            : jobPlansPath(recentlySelectedCompany, jobId);

          return setDoc(doc(sourcePath, option.id), {
            isActivePlan: option.id === solution.id,
            updatedAt: serverTimestamp(),
            updatedAtMillis: nowMillis,
          }, { merge: true });
        })
      );

      setJob((prev) => ({
        ...prev,
        ...jobUpdates,
        updatedAt: new Date(nowMillis),
      }));
      setSelectedPlanEditorId(solution.id);
      resetPlanForm(solution);
      await recordJobHistory({
        eventType: "Plan",
        title: `Plan loaded for editing: ${getJobPlanDisplayName(solution, "Untitled Plan")}`,
        description: solution.description || "",
        changes: [
          buildHistoryChange("activePlanId", "Editing Plan", job.activePlanId || job.activeSolutionId || "—", solution.id),
          buildHistoryChange("tasks", "Tasks", String(taskList.length), String(tasksToWrite.length)),
          buildHistoryChange("plannedServiceStops", "Planned Stops", String(plannedServiceStops.length), String(plannedStopsToWrite.length)),
          buildHistoryChange("laborLineItems", "Service Lines", String(laborLineItems.length), String(laborLinesToWrite.length)),
          buildHistoryChange("shoppingItems", "Planned Products", String(shoppingList.length), String(materialsToWrite.length)),
        ],
        metadata: {
          planId: solution.id,
          planTier: solutionTier,
          planTierLabel: solutionTierLabel,
          editorLoad: true,
        },
      });

      toast.success("Plan loaded into Planned");
      handleJobTabChange("Planned");
      return true;
    } catch (err) {
      console.error(err);
      toast.error("Failed to load plan");
      return false;
    } finally {
      setLoadingPlanEditorId("");
    }
  };

  const handlePlanEditorSelection = async (planId) => {
    const nextPlan = (jobPlans || []).find((solution) => solution.id === planId) || null;

    if (!nextPlan) {
      setSelectedPlanEditorId("");
      return;
    }

    if (nextPlan.id === selectedEditorPlan?.id && !hasUnsavedPlanEditorChanges) {
      setSelectedPlanEditorId(nextPlan.id);
      return;
    }

    await loadPlanIntoEditor(nextPlan);
  };

  const saveSelectedEditorPlan = async () => {
    if (!requireUpdateCurrentJob("update jobs")) return;

    if (!selectedEditorPlan?.id) {
      createPlanFromEditor();
      return;
    }

    try {
      setSavingPlanEditor(true);
      const editorTitle = planEditorDraft.title.trim();
      const editorDescription = planEditorDraft.description.trim();
      if (!editorTitle && !getJobPlanDisplayName(selectedEditorPlan, "")) {
        toast.error("Add a plan name");
        return;
      }
      await saveCurrentEditorToPlan({
        planId: selectedEditorPlan.id,
        title: editorTitle || getJobPlanDisplayName(selectedEditorPlan, ""),
        planTier: selectedEditorPlan.planTier || selectedEditorPlan.solutionTier,
        status: selectedEditorPlan.status || JOB_PLAN_STATUS.DRAFT,
        description: editorDescription,
        makeActive: true,
        showToast: true,
        recordHistory: true,
        historyTitle: `Plan saved from Planned editor: ${editorTitle || getJobPlanDisplayName(selectedEditorPlan, "Untitled Plan")}`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to save plan");
    } finally {
      setSavingPlanEditor(false);
    }
  };

  const createPlanFromEditor = () => {
    if (!requireUpdateCurrentJob("update jobs")) return;

    const tier = normalizeJobPlanTier(selectedEditorPlan?.planTier || selectedEditorPlan?.solutionTier || DEFAULT_JOB_PLAN_TIER);
    const lineItems = buildSuggestedContractSnapshot();
    const calculatedTotalCents =
      lineItems.reduce((total, item) => total + cents(item.totalAmountCents || item.amount || 0), 0) ||
      cents(job.rate);

    setPlanForm({
      id: "",
      title: planEditorDraft.title.trim(),
      planTier: tier,
      solutionTier: tier,
      status: JOB_PLAN_STATUS.DRAFT,
      description: planEditorDraft.description,
      rate: dollarsFromCents(calculatedTotalCents),
      laborCost: dollarsFromCents(plannedTotalLaborCents),
    });
    setShowPlanModal(true);
  };

  const refreshEditorPlanBeforeEstimate = async () => {
    const hasEditableScope =
      (taskList || []).length > 0 ||
      (plannedServiceStops || []).length > 0 ||
      (laborLineItems || []).length > 0 ||
      (shoppingList || []).length > 0 ||
      cents(job.rate) > 0;

    if (!hasEditableScope) return null;

    const targetPlan = selectedEditorPlan || activePlan || (jobPlans || [])[0] || null;
    const tier = normalizeJobPlanTier(targetPlan?.planTier || targetPlan?.solutionTier || DEFAULT_JOB_PLAN_TIER);
    const fallbackTitle = "Untitled Plan";
    const editorTitle = planEditorDraft.title.trim();
    const editorDescription = planEditorDraft.description.trim();

    return saveCurrentEditorToPlan({
      planId: targetPlan?.id || `comp_job_plan_${uuidv4()}`,
      title: editorTitle || targetPlan?.title || targetPlan?.name || fallbackTitle,
      planTier: tier,
      status: targetPlan?.status || JOB_PLAN_STATUS.DRAFT,
      description: targetPlan ? editorDescription : editorDescription || targetPlan?.description || "",
      makeActive: true,
      showToast: false,
      recordHistory: false,
    });
  };

  const promotePlanToActiveWork = async (solution, { updateBillingStatus = true, historyTitle = "" } = {}) => {
    if (!solution?.id || !recentlySelectedCompany || !jobId) return { readyShoppingItemCount: 0 };

    const { tasksToWrite, plannedStopsToWrite, laborLinesToWrite, materialsToWrite } =
      planWorkspaceScope(solution, { accepted: true });

    await Promise.all([
      deleteQueryDocs(collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks")),
      deleteQueryDocs(plannedServiceStopsPath(recentlySelectedCompany, jobId)),
      deleteQueryDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("jobId", "==", jobId))),
    ]);

    const writes = [
      ...tasksToWrite.map((task) =>
        setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), task)
      ),
      ...plannedStopsToWrite.map((stop) =>
        setDoc(doc(plannedServiceStopsPath(recentlySelectedCompany, jobId), stop.id), stop)
      ),
      ...materialsToWrite.map((item) =>
        setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", item.id), item)
      ),
    ];

    await Promise.all(writes);

    const solutionTier = normalizeJobPlanTier(solution.planTier || solution.solutionTier);
    const solutionTierLabel = getJobPlanRecommendationLabel(solutionTier);
    const nextOperationStatus =
      !job.operationStatus || job.operationStatus === "Estimate Pending"
        ? "Unscheduled"
        : job.operationStatus;
    const jobUpdates = {
      activePlanId: solution.id,
      acceptedPlanId: solution.id,
      activePlanTier: solutionTier,
      activePlanTierLabel: solutionTierLabel,
      acceptedPlanTier: solutionTier,
      acceptedPlanTierLabel: solutionTierLabel,
      activeSolutionId: solution.id,
      acceptedSolutionId: solution.id,
      activeSolutionTier: solutionTier,
      activeSolutionTierLabel: solutionTierLabel,
      acceptedSolutionTier: solutionTier,
      acceptedSolutionTierLabel: solutionTierLabel,
      activePlanRecommendationRank: solutionTier,
      activePlanRecommendationRankLabel: solutionTierLabel,
      acceptedPlanRecommendationRank: solutionTier,
      acceptedPlanRecommendationRankLabel: solutionTierLabel,
      solutionSelectionStatus: JOB_PLAN_STATUS.ACCEPTED,
      planSelectionStatus: JOB_PLAN_STATUS.ACCEPTED,
      rate: planOptionTotalCents(solution),
      laborCost: planOptionLaborCents(solution),
      laborLineItems: laborLinesToWrite,
      estimateLaborLineItems: laborLinesToWrite,
      acceptedPlanCostSummary: solution.costSummary || {},
      acceptedPlanBillingSummary: solution.billingSummary || {},
      updatedAt: serverTimestamp(),
      updatedAtMillis: Date.now(),
    };

    if (updateBillingStatus) {
      jobUpdates.billingStatus = "Accepted";
      jobUpdates.operationStatus = nextOperationStatus;
    }

    await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), jobUpdates);

    await Promise.all(
      (jobPlans || []).map((option) => {
        const isSelected = option.id === solution.id;
        const optionUpdates = {
          isActivePlan: isSelected,
          isAccepted: isSelected,
          planTier: normalizeJobPlanTier(option.planTier || option.solutionTier),
          planTierLabel: getJobPlanRecommendationLabel(option.planTier || option.solutionTier),
          recommendationRank: normalizeJobPlanTier(option.planTier || option.solutionTier),
          recommendationRankLabel: getJobPlanRecommendationLabel(option.planTier || option.solutionTier),
          updatedAt: serverTimestamp(),
          updatedAtMillis: Date.now(),
        };

        if (isSelected) {
          optionUpdates.status = JOB_PLAN_STATUS.ACCEPTED;
          optionUpdates.acceptedAt = serverTimestamp();
          optionUpdates.acceptedByUserId = getUserId() || "";
          optionUpdates.acceptedByUserName = getAuditUserName();
        } else if (normalizeJobPlanStatus(option.status) === JOB_PLAN_STATUS.ACCEPTED) {
          optionUpdates.status = JOB_PLAN_STATUS.SUPERSEDED;
          optionUpdates.supersededAt = serverTimestamp();
        }

        const sourcePath = option._sourceCollection === "solutions"
          ? legacyJobSolutionsPath(recentlySelectedCompany, jobId)
          : jobPlansPath(recentlySelectedCompany, jobId);

        return updateDoc(doc(sourcePath, option.id), optionUpdates);
      })
    );

    setTaskList(tasksToWrite);
    setPlannedServiceStops(plannedStopsToWrite);
    setLaborLineItems(laborLinesToWrite);
    setShoppingList(materialsToWrite.map((item) => ({ ...item, estimateAcceptedAt: new Date() })));
    setJob((prev) => ({
      ...prev,
      ...jobUpdates,
      updatedAt: new Date(),
      billingStatus: updateBillingStatus ? "Accepted" : prev.billingStatus,
      operationStatus: updateBillingStatus ? nextOperationStatus : prev.operationStatus,
    }));
    setSelectedPlanEditorId(solution.id);
    if (updateBillingStatus) {
      setSelectedBillingStatus({ value: "Accepted", label: "Accepted" });
      setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
    }

    await recordJobHistory({
      eventType: "Plan",
      title: historyTitle || `Plan accepted: ${getJobPlanDisplayName(solution, "Untitled Plan")}`,
      description: solution.description || "",
      changes: [
        buildHistoryChange("acceptedPlanId", "Accepted Plan", job.acceptedPlanId || job.acceptedSolutionId || "—", solution.id),
        buildHistoryChange("recommendationRank", "Recommendation Rank", "—", getJobPlanRecommendationDisplay(solutionTier)),
        buildHistoryChange("rate", "Customer Price", moneyFromCents(job.rate), moneyFromCents(planOptionTotalCents(solution))),
        buildHistoryChange("tasks", "Tasks", String(taskList.length), String(tasksToWrite.length)),
        buildHistoryChange("plannedServiceStops", "Planned Stops", String(plannedServiceStops.length), String(plannedStopsToWrite.length)),
        buildHistoryChange("laborLineItems", "Service Lines", String(laborLineItems.length), String(laborLinesToWrite.length)),
        buildHistoryChange("shoppingItems", "Planned Products", String(shoppingList.length), String(materialsToWrite.length)),
      ],
      metadata: {
        planId: solution.id,
        planTier: solutionTier,
        planTierLabel: solutionTierLabel,
        solutionId: solution.id,
        solutionTier,
        solutionTierLabel,
        promotedTaskCount: tasksToWrite.length,
        promotedPlannedStopCount: plannedStopsToWrite.length,
        promotedLaborLineCount: laborLinesToWrite.length,
        promotedMaterialCount: materialsToWrite.length,
      },
      severity: "success",
    });

    return { readyShoppingItemCount: materialsToWrite.length };
  };

  const acceptPlanOption = async (solution) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!solution?.id) return;

    const ok = await appConfirm({
      title: "Accept Plan",
      message: "Accept this plan and replace the active job work with its saved scope?",
      confirmLabel: "Accept Plan",
    });
    if (!ok) return;

    try {
      setAcceptingPlanId(solution.id);
      await promotePlanToActiveWork(solution);
      toast.success("Plan accepted and promoted to the active job work");
      handleJobTabChange("Planned");
    } catch (err) {
      console.error(err);
      toast.error("Failed to accept plan");
    } finally {
      setAcceptingPlanId("");
    }
  };

  const actualPurchasedMaterialCostCents = useMemo(() => {
    return (purchasedItems || []).reduce((total, item) => {
      const price = cents(item.price);
      const qty = quantityNumber(item.quantityString ?? item.quantity);
      return total + Math.round(price * qty);
    }, 0);
  }, [purchasedItems]);

  const billablePurchasedMaterialPriceCents = useMemo(() => {
    return (purchasedItems || []).reduce((total, item) => {
      const isHandledByJob = item.billingOwner === "job" || item.assignedToJob || item.jobId || item.workOrderId;
      const isJobBillable = item.jobBillable ?? item.billable;
      if (!isHandledByJob || !isJobBillable) return total;

      const unit = item.jobBillingRate !== undefined && item.jobBillingRate !== null
        ? cents(item.jobBillingRate)
        : item.billingRate !== undefined && item.billingRate !== null
          ? cents(item.billingRate)
          : cents(item.price);

      const qty = quantityNumber(item.quantityString ?? item.quantity);

      return total + Math.round(unit * qty);
    }, 0);
  }, [purchasedItems]);

  const jobBillingIsInvoiced = (status = job.billingStatus) =>
    ["invoiced", "paid"].includes(String(status || "").toLowerCase());

  const purchasedItemInvoiceUpdates = ({ invoiceId = "", invoiceType = "job" } = {}) => ({
    invoiced: true,
    invoiceStatus: "Invoiced",
    jobBillingStatus: "invoiced",
    status: "Invoiced",
    invoiceId: invoiceId || "",
    invoiceRef: invoiceId || "",
    invoiceType,
    invoicedAt: serverTimestamp(),
    jobInvoicedAt: serverTimestamp(),
  });

  const purchasedItemInvoiceState = ({ invoiceId = "", invoiceType = "job" } = {}) => ({
    invoiced: true,
    invoiceStatus: "Invoiced",
    jobBillingStatus: "invoiced",
    status: "Invoiced",
    invoiceId: invoiceId || "",
    invoiceRef: invoiceId || "",
    invoiceType,
    invoicedAt: new Date(),
    jobInvoicedAt: new Date(),
  });

  const shoppingItemInvoiceUpdates = ({ invoiceId = "", invoiceType = "job" } = {}) => ({
    invoiced: true,
    invoiceStatus: "Invoiced",
    jobBillingStatus: "invoiced",
    status: SHOPPING_LIST_INVOICED_STATUS,
    needsAction: false,
    invoiceId: invoiceId || "",
    invoiceRef: invoiceId || "",
    invoiceType,
    invoicedAt: serverTimestamp(),
    jobInvoicedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const shoppingItemInvoiceState = ({ invoiceId = "", invoiceType = "job" } = {}) => ({
    invoiced: true,
    invoiceStatus: "Invoiced",
    jobBillingStatus: "invoiced",
    status: SHOPPING_LIST_INVOICED_STATUS,
    needsAction: false,
    invoiceId: invoiceId || "",
    invoiceRef: invoiceId || "",
    invoiceType,
    invoicedAt: new Date(),
    jobInvoicedAt: new Date(),
    updatedAt: new Date(),
  });

  const markPurchasedItemsInvoicedForJob = async ({ invoiceId = "", invoiceType = "job" } = {}) => {
    if (!recentlySelectedCompany || !jobId) return 0;

    const itemsById = new Map((purchasedItems || []).map((item) => [item.id, item]));

    const addSnapDocs = (snap) => {
      snap.docs.forEach((itemDoc) => {
        const item = withFirestoreDocId(itemDoc);
        itemsById.set(getFirestoreDocId(item), item);
      });
    };

    const [jobIdSnap, workOrderIdSnap, assignedJobIdSnap] = await Promise.all([
      getDocs(query(purchasedItemsPath(recentlySelectedCompany), where("jobId", "==", jobId))),
      getDocs(query(purchasedItemsPath(recentlySelectedCompany), where("workOrderId", "==", jobId))),
      getDocs(query(purchasedItemsPath(recentlySelectedCompany), where("assignedJobId", "==", jobId))),
    ]);

    addSnapDocs(jobIdSnap);
    addSnapDocs(workOrderIdSnap);
    addSnapDocs(assignedJobIdSnap);

    const items = Array.from(itemsById.values()).filter((item) => item?.id);
    if (!items.length) return 0;

    const updates = purchasedItemInvoiceUpdates({ invoiceId, invoiceType });
    const stateUpdates = purchasedItemInvoiceState({ invoiceId, invoiceType });
    await Promise.all(
      items.map(async (item) => {
        const purchasedItemId = getFirestoreDocId(item);
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchasedItemId), updates);

        if (item.shoppingListItemId) {
          await syncLinkedShoppingPurchase({
            db,
            companyId: recentlySelectedCompany,
            purchasedItemId,
            shoppingItemId: item.shoppingListItemId,
            purchasedItemData: {
              ...item,
              ...stateUpdates,
              id: purchasedItemId,
            },
            invoiced: true,
            preferPurchasedContext: true,
          });
        }
      })
    );

    setPurchasedItems((prev) =>
      (prev || []).map((item) => (itemsById.has(getFirestoreDocId(item)) ? { ...item, ...stateUpdates } : item))
    );

    return items.length;
  };

  const markShoppingItemsInvoicedForJob = async ({ invoiceId = "", invoiceType = "job" } = {}) => {
    if (!recentlySelectedCompany || !jobId) return 0;

    const itemsById = new Map((shoppingList || []).map((item) => [getFirestoreDocId(item), item]));

    const addSnapDocs = (snap) => {
      snap.docs.forEach((itemDoc) => {
        const item = withFirestoreDocId(itemDoc);
        itemsById.set(getFirestoreDocId(item), item);
      });
    };

    const [jobIdSnap, workOrderIdSnap, assignedJobIdSnap] = await Promise.all([
      getDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("jobId", "==", jobId))),
      getDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("workOrderId", "==", jobId))),
      getDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("assignedJobId", "==", jobId))),
    ]);

    addSnapDocs(jobIdSnap);
    addSnapDocs(workOrderIdSnap);
    addSnapDocs(assignedJobIdSnap);

    const items = Array.from(itemsById.values()).filter((item) => getFirestoreDocId(item));
    if (!items.length) return 0;

    const updates = shoppingItemInvoiceUpdates({ invoiceId, invoiceType });
    const stateUpdates = shoppingItemInvoiceState({ invoiceId, invoiceType });
    const linkedPurchaseUpdates = purchasedItemInvoiceUpdates({ invoiceId, invoiceType });

    await Promise.all(
      items.map(async (item) => {
        const shoppingItemId = getFirestoreDocId(item);
        const purchasedItemId = item.purchasedItem || item.purchasedItemId || "";
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", shoppingItemId), updates);

        if (purchasedItemId) {
          try {
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchasedItemId), linkedPurchaseUpdates);
          } catch (error) {
            console.warn(`Could not mark linked purchased item ${purchasedItemId} as invoiced`, error);
          }

          await syncLinkedShoppingPurchase({
            db,
            companyId: recentlySelectedCompany,
            shoppingItemId,
            purchasedItemId,
            shoppingItemData: {
              ...item,
              ...stateUpdates,
              id: shoppingItemId,
            },
            invoiced: true,
          });
        }
      })
    );

    setShoppingList((current) =>
      (current || []).map((item) => (itemsById.has(getFirestoreDocId(item)) ? { ...item, ...stateUpdates } : item))
    );

    return items.length;
  };

  const markShoppingItemsReadyForAcceptedEstimate = async () => {
    if (!recentlySelectedCompany || !jobId) return 0;

    const shoppingSnap = await getDocs(
      query(
        collection(db, "companies", recentlySelectedCompany, "shoppingList"),
        where("jobId", "==", jobId)
      )
    );
    const terminalStatuses = new Set(["purchased", "delivered", "installed", "invoiced", "cancelled", "canceled"]);
    const items = shoppingSnap.docs
      .map(withFirestoreDocId)
      .filter((item) => {
        if (terminalStatuses.has(String(item.status || "").toLowerCase())) return false;
        if (item.customerApprovalRequired && item.customerApprovalStatus !== "approved") return false;
        return true;
      });

    if (!items.length) return 0;

    await Promise.all(
      items.map((item) =>
        updateDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", getFirestoreDocId(item)), {
          status: "Ready to Purchase",
          estimateAccepted: true,
          estimateAcceptedAt: serverTimestamp(),
          jobBillingStatus: "accepted",
        })
      )
    );

    setShoppingList((current) =>
      (current || []).map((item) =>
        items.some((readyItem) => readyItem.id === item.id)
          ? {
            ...item,
            status: "Ready to Purchase",
            estimateAccepted: true,
            estimateAcceptedAt: new Date(),
            jobBillingStatus: "accepted",
          }
          : item
      )
    );

    return items.length;
  };

  const actualPayrollTotalCents = useMemo(() => {
    return (actualPayLineItems || []).reduce((total, line) => {
      return total + cents(line.totalAmountCents ?? line.amountCents ?? line.totalCents ?? line.payCents);
    }, 0);
  }, [actualPayLineItems]);

  const scheduledStopLaborEstimateCents = useMemo(() => {
    const stopIdsWithPayroll = new Set(
      (actualPayLineItems || [])
        .map((line) => idValue(line.serviceStopId) || idValue(line.stopId))
        .filter(Boolean)
    );

    return (serviceStops || []).reduce((total, stop) => {
      if (stopIdsWithPayroll.has(stop.id)) return total;
      return total + getScheduledStopEstimatedLaborCents(stop);
    }, 0);
  }, [
    actualPayLineItems,
    serviceStops,
    taskList,
    companyUserList,
    paySettings,
    companyServiceStopTypes,
    companyWorkTypes,
    workTypeMappings,
    technicianRates,
  ]);

  const actualLaborTotalCents = useMemo(() => {
    return actualPayrollTotalCents + scheduledStopLaborEstimateCents;
  }, [actualPayrollTotalCents, scheduledStopLaborEstimateCents]);

  const savedLaborCostCents = useMemo(() => {
    return cents(job.laborCost);
  }, [job.laborCost]);

  const projectedProfitCents = useMemo(() => {
    return (plannedEstimatePriceCents || cents(job.rate)) - plannedTotalLaborCents - plannedMaterialCostCents;
  }, [job.rate, plannedEstimatePriceCents, plannedTotalLaborCents, plannedMaterialCostCents]);

  const estimateCustomerPriceCents = useMemo(() => {
    return plannedEstimatePriceCents || cents(job.rate);
  }, [job.rate, plannedEstimatePriceCents]);

  const estimateInternalCostCents = useMemo(() => {
    return plannedTotalLaborCents + plannedMaterialCostCents;
  }, [plannedTotalLaborCents, plannedMaterialCostCents]);

  const actualRecordedCostCents = useMemo(() => {
    return actualLaborTotalCents + actualPurchasedMaterialCostCents;
  }, [actualLaborTotalCents, actualPurchasedMaterialCostCents]);

  const actualCostVarianceCents = useMemo(() => {
    return actualRecordedCostCents - estimateInternalCostCents;
  }, [actualRecordedCostCents, estimateInternalCostCents]);

  const actualProfitCents = useMemo(() => {
    return estimateCustomerPriceCents - actualRecordedCostCents;
  }, [actualRecordedCostCents, estimateCustomerPriceCents]);

  const contractTotalCents = useMemo(() => {
    if (selectedSalesAgreement) {
      return Number(
        selectedSalesAgreement.totalAmountCents ??
        selectedSalesAgreement.rateAmountCents ??
        selectedSalesAgreement.subtotalAmountCents ??
        0
      );
    }

    if (selectedContract?.rate !== undefined && selectedContract?.rate !== null) {
      return Number(selectedContract.rate || 0);
    }
    return Number(job.rate || 0);
  }, [job.rate, selectedContract, selectedSalesAgreement]);

  const getCustomerEmail = () => (
    customer.email ||
    customer.customerEmail ||
    customer.billingEmail ||
    customer.mainContact?.email ||
    customer.contact?.email ||
    job.customerEmail ||
    job.email ||
    job.billingEmail ||
    selectedSalesAgreement?.email ||
    selectedSalesAgreement?.customerEmail ||
    selectedSalesAgreement?.billingEmail ||
    selectedContract?.receiverEmail ||
    selectedContract?.customerEmail ||
    selectedContract?.email ||
    selectedContract?.billingEmail ||
    ""
  );

  const getCustomerDisplayName = (fallback = "Customer") => (
    job.customerName ||
    customer.displayName ||
    customer.customerName ||
    customer.name ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    selectedSalesAgreement?.customerName ||
    selectedContract?.receiverName ||
    fallback
  );

  const buildJobCustomerNoteDraft = ({ bodyOfWaterId = "" } = {}) => {
    const jobLabel = [job.internalId, job.type].filter(Boolean).join(" - ") || jobId;
    const locationAddress = [
      serviceLocation.streetAddress,
      serviceLocation.city,
      serviceLocation.state,
      serviceLocation.zip,
    ]
      .filter(Boolean)
      .join(", ");
    const selectedBody = taskBodyOfWaterList.find((body) => body.id === (job.bodyOfWaterId || bodyOfWaterId || customerNoteBodyOfWaterId));
    const bodyOfWaterName = job.bodyOfWaterName || selectedBody?.label || selectedBody?.name || "";
    const openTasks = (taskList || []).filter((task) => String(task.status || "").toLowerCase() !== "finished");
    const plannedMaterials = shoppingList || [];
    const purchasedMaterialCount = (purchasedItems || []).length;
    const serviceStopCount = (serviceStops || []).length;

    return [
      `Job note from ${jobLabel}`,
      `Customer: ${getCustomerDisplayName()}`,
      locationAddress ? `Location: ${locationAddress}` : "",
      bodyOfWaterName ? `Body of water: ${bodyOfWaterName}` : "",
      `Billing status: ${job.billingStatus || "Not set"}`,
      `Operation status: ${job.operationStatus || "Not set"}`,
      Number(job.rate || 0) ? `Customer price: ${moneyFromCents(job.rate)}` : "",
      job.description ? `Scope: ${job.description}` : "",
      `Tasks: ${(taskList || []).length}${openTasks.length ? ` (${openTasks.length} open)` : " (all complete)"}`,
      plannedMaterials.length ? `Planned products: ${plannedMaterials.length}` : "",
      purchasedMaterialCount ? `Purchased products: ${purchasedMaterialCount}` : "",
      serviceStopCount ? `Service stops: ${serviceStopCount}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  const openCreateCustomerNoteModal = () => {
    const customerId = getCustomerDetailId();
    if (!customerId) {
      toast.error("This job needs a customer before creating a customer note.");
      return;
    }

    const nextBodyOfWaterId =
      job.bodyOfWaterId ||
      (taskBodyOfWaterList.length === 1 ? taskBodyOfWaterList[0].id : "");

    setCustomerNoteBodyOfWaterId(nextBodyOfWaterId);
    setCustomerNoteAudience("all");
    setCustomerNoteDraft(buildJobCustomerNoteDraft({ bodyOfWaterId: nextBodyOfWaterId }));
    setShowCustomerNoteModal(true);
  };

  const saveCustomerNoteFromJob = async () => {
    const trimmedNote = customerNoteDraft.trim();
    const customerId = getCustomerDetailId();

    if (!trimmedNote) return toast.error("Write a customer note first.");
    if (!recentlySelectedCompany || !customerId) return toast.error("Missing customer.");

    const userId = getUserId() || dataBaseUser?.id || "";
    if (!userId) return toast.error("Missing signed-in user.");

    const selectedBody = taskBodyOfWaterList.find((body) => body.id === customerNoteBodyOfWaterId) || null;
    const nowMillis = Date.now();
    const noteId = `comp_cus_note_${uuidv4()}`;
    const authorName = getAuditUserName();

    try {
      setSavingCustomerNote(true);
      await setDoc(doc(db, "companies", recentlySelectedCompany, "customers", customerId, "notes", noteId), {
        id: noteId,
        companyId: recentlySelectedCompany,
        customerId,
        customerName: getCustomerDisplayName(""),
        bodyOfWaterId: selectedBody?.id || customerNoteBodyOfWaterId || job.bodyOfWaterId || "",
        bodyOfWaterName: selectedBody?.label || selectedBody?.name || job.bodyOfWaterName || "",
        serviceLocationId: job.serviceLocationId || serviceLocation.id || selectedBody?.serviceLocationId || "",
        userId,
        userName: authorName,
        authorId: userId,
        authorName,
        note: trimmedNote,
        comment: trimmedNote,
        text: trimmedNote,
        audience: customerNoteAudience,
        visibility: customerNoteAudience,
        resolved: false,
        sourceType: "jobDetail",
        sourceId: jobId,
        jobId,
        jobInternalId: job.internalId || "",
        jobType: job.type || "",
        date: serverTimestamp(),
        dateMillis: nowMillis,
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      });

      await recordJobHistory({
        eventType: "Customer Note",
        title: "Customer note created from job",
        description: trimmedNote,
        metadata: {
          customerNoteId: noteId,
          customerId,
          audience: customerNoteAudience,
        },
      });

      setShowCustomerNoteModal(false);
      toast.success("Customer note created.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create customer note.");
    } finally {
      setSavingCustomerNote(false);
    }
  };

  const getCustomerDetailId = (source = {}) => (
    source?.customerId ||
    source?.receiverId ||
    source?.customer?.id ||
    job.customerId ||
    customer.id ||
    ""
  );

  const renderCustomerDetailLink = (label, source = {}, className = "", fallback = "Customer") => {
    const displayName = label || fallback;
    const customerDetailId = getCustomerDetailId(source);
    const sharedClassName = className.trim();

    if (!customerDetailId || !displayName || displayName === "—" || displayName === "Not set") {
      return <span className={sharedClassName}>{displayName}</span>;
    }

    return (
      <Link
        to={`/company/customers/details/${customerDetailId}`}
        onClick={(event) => event.stopPropagation()}
        className={[
          sharedClassName,
          "text-blue-700 hover:text-blue-900 hover:underline",
        ].filter(Boolean).join(" ")}
      >
        {displayName}
      </Link>
    );
  };

  const getCustomerUserId = (source = customer) => (
    source?.customerUserId ||
    source?.userId ||
    source?.linkedCustomerUserId ||
    source?.linkedHomeownerUserId ||
    source?.homeownerUserId ||
    source?.homeownerId ||
    (Array.isArray(source?.linkedCustomerIds) ? source.linkedCustomerIds[0] : null) ||
    null
  );

  const getServiceLocationSnapshot = () => ({
    id: job.serviceLocationId || serviceLocation.id || "",
    nickName: serviceLocation.nickName || "",
    streetAddress: serviceLocation.streetAddress || "",
    address02: serviceLocation.address02 || "",
    city: serviceLocation.city || "",
    state: serviceLocation.state || "",
    zip: serviceLocation.zip || "",
  });

  const getSalesLineItemsFromSnapshot = (sourceItems = null) => {
    const snapshotItems =
      Array.isArray(sourceItems) && sourceItems.length
        ? sourceItems
        : selectedSalesAgreement?.lineItems?.length
          ? selectedSalesAgreement.lineItems
          : contractSnapshotItems?.length
            ? contractSnapshotItems
            : buildSuggestedContractSnapshot();
    const mappedItems = snapshotItems
      .map((item, index) => {
        const quantity = Math.max(Number(item.quantity || 1), 1);
        const totalAmountCents = cents(
          item.totalAmountCents ??
          item.amount ??
          item.price ??
          item.unitAmountCents ??
          0
        );
        const unitAmountCents = cents(
          item.unitAmountCents ??
          (quantity ? Math.round(totalAmountCents / quantity) : totalAmountCents)
        );

        return {
          id: item.id || `job_line_${index}`,
          catalogItemId: item.catalogItemId || "",
          sourceType: item.sourceType || SalesCatalogSourceType.manual,
          sourceId: item.sourceId || item.id || "",
          name: item.name || item.title || `Line ${index + 1}`,
          description: item.description || "",
          quantity,
          unitAmountCents,
          totalAmountCents,
          taxable: Boolean(item.taxable),
          type: item.salesItemType || item.type || SalesCatalogItemType.service,
          stripeProductId: item.stripeProductId || "",
          stripePriceId: item.stripePriceId || "",
          metadata: {
            ...(item.metadata || {}),
            billingBehavior: item.billingBehavior || SalesCatalogBillingBehavior.oneTime,
            jobId,
            jobInternalId: job.internalId || "",
          },
        };
      })
      .filter((item) => item.name && item.totalAmountCents >= 0);

    if (mappedItems.length) return mappedItems;

    const fallbackTotal = cents(job.rate);
    return fallbackTotal > 0
      ? [{
        id: `job_rate_${jobId}`,
        catalogItemId: "",
        sourceType: SalesCatalogSourceType.manual,
        sourceId: jobId,
        name: job.type || job.internalId || "Job Estimate",
        description: job.description || "",
        quantity: 1,
        unitAmountCents: fallbackTotal,
        totalAmountCents: fallbackTotal,
        taxable: false,
        type: SalesCatalogItemType.service,
        stripeProductId: "",
        stripePriceId: "",
        metadata: {
          billingBehavior: SalesCatalogBillingBehavior.oneTime,
          jobId,
          jobInternalId: job.internalId || "",
        },
      }]
      : [];
  };

  const buildSalesAgreementPlanOptions = (planOptionOverrides = []) => {
    const sourcePlanMap = new Map();

    const basePlans = jobPlans.length
      ? jobPlans
      : activePlan
        ? [activePlan]
        : [];

    basePlans.forEach((solution) => {
      if (solution?.id) sourcePlanMap.set(solution.id, solution);
    });
    (planOptionOverrides || []).forEach((solution) => {
      if (solution?.id) sourcePlanMap.set(solution.id, solution);
    });

    const sourcePlans = sortPlanOptions([...sourcePlanMap.values()]);

    if (!sourcePlans.length) return [];

    return sourcePlans.map((solution) => {
      const tier = normalizeJobPlanTier(solution.planTier || solution.solutionTier);
      const lineItems = getSalesLineItemsFromSnapshot(planLineItems(solution));
      const totalAmountCents =
        planOptionTotalCents(solution) ||
        lineItems.reduce((total, item) => total + cents(item.totalAmountCents), 0);

      return {
        id: solution.id,
        planId: solution.id,
        solutionId: solution.id,
        title: getJobPlanDisplayName(solution, "Untitled Plan"),
        planName: getJobPlanDisplayName(solution, "Untitled Plan"),
        description: solution.description || "",
        status: solution.status || JOB_PLAN_STATUS.DRAFT,
        planTier: tier,
        planTierLabel: getJobPlanRecommendationLabel(tier),
        solutionTier: tier,
        solutionTierLabel: getJobPlanRecommendationLabel(tier),
        recommendationRank: tier,
        recommendationRankLabel: getJobPlanRecommendationLabel(tier),
        totalAmountCents,
        rateAmountCents: totalAmountCents,
        laborCostCents: planOptionLaborCents(solution),
        materialCostCents: planOptionMaterialCostCents(solution),
        scopeOfWork: solution.scopeOfWork || {},
        costSummary: solution.costSummary || {},
        billingSummary: {
          ...(solution.billingSummary || {}),
          totalAmountCents,
          lineItemCount: lineItems.length,
        },
        taskCount: planScopeArrays(solution).tasks.length || Number(solution.taskCount || 0),
        plannedStopCount: planScopeArrays(solution).plannedServiceStops.length || Number(solution.plannedStopCount || 0),
        laborLineCount: planScopeArrays(solution).laborLineItems.length || Number(solution.laborLineCount || 0),
        materialCount: planScopeArrays(solution).shoppingItems.length || Number(solution.materialCount || 0),
        laborLineItems: planScopeArrays(solution).laborLineItems,
        lineItems,
        estimateLineItems: lineItems,
      };
    });
  };

  const isServiceAgreementRecord = (record) =>
    Boolean(record?.id && String(record.id).startsWith("sa_")) ||
    record?.sourceType === SalesAgreementSourceType.oneOffJob ||
    record?.sourceType === SalesAgreementSourceType.recurringService ||
    record?.sourceType === SalesAgreementSourceType.manual;

  const normalizeSalesAgreementStatus = (status) => {
    const key = String(status || SalesAgreementStatus.draft).trim().toLowerCase();
    return Object.values(SalesAgreementStatus).includes(key)
      ? key
      : SalesAgreementStatus.draft;
  };

  const normalizeAgreementDeadline = (value) => {
    if (!value) return null;
    if (value?.toDate || value instanceof Date) return value;
    if (typeof value === "string") {
      const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
      return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
    }
    return value;
  };

  const findLinkedSalesAgreement = async () => {
    if (!recentlySelectedCompany || !jobId) return null;

    if (linkedSalesAgreement?.id) {
      const linkedSnap = await getDoc(doc(db, salesCollectionNames.agreements, linkedSalesAgreement.id));
      if (linkedSnap.exists()) return withFirestoreDocId(linkedSnap);
    }

    const agreementId =
      selectedContract?.salesAgreementId ||
      selectedContract?.agreementId ||
      job.salesAgreementId ||
      job.salesEstimateAgreementId ||
      "";

    if (agreementId) {
      const agreementSnap = await getDoc(doc(db, salesCollectionNames.agreements, agreementId));
      if (agreementSnap.exists()) return withFirestoreDocId(agreementSnap);
    }

    const agreementsSnap = await getDocs(
      query(
        collection(db, salesCollectionNames.agreements),
        where("companyId", "==", recentlySelectedCompany),
        where("sourceType", "==", "oneOffJob"),
        where("sourceId", "==", jobId)
      )
    );

    return agreementsSnap.empty
      ? null
      : withFirestoreDocId(agreementsSnap.docs[0]);
  };

  const ensureJobSalesAgreement = async ({
    sourceRecord = null,
    forceNew = false,
    status = "",
    planOptionOverrides = [],
  } = {}) => {
    const email = getCustomerEmail();
    if (!email) throw new Error("Customer email is required before sending an estimate.");

    const source = sourceRecord || selectedSalesAgreement || selectedContract || {};
    const sourceIsAgreement = isServiceAgreementRecord(source);
    const existingAgreement = forceNew
      ? null
      : sourceIsAgreement && source?.id
        ? source
        : await findLinkedSalesAgreement();
    const planOptions = buildSalesAgreementPlanOptions(planOptionOverrides);
    const selectedPlanId =
      source?.selectedPlanId ||
      source?.selectedSolutionId ||
      existingAgreement?.selectedPlanId ||
      existingAgreement?.selectedSolutionId ||
      job.acceptedPlanId ||
      job.acceptedSolutionId ||
      job.activePlanId ||
      job.activeSolutionId ||
      activePlan?.id ||
      planOptions[0]?.planId ||
      planOptions[0]?.solutionId ||
      "";
    const selectedPlanOption =
      planOptions.find((option) => (option.planId || option.solutionId) === selectedPlanId) ||
      planOptions[0] ||
      null;
    const lineItems = getSalesLineItemsFromSnapshot(
      selectedPlanOption?.lineItems?.length
        ? selectedPlanOption.lineItems
        : source?.lineItems?.length
          ? source.lineItems
          : existingAgreement?.lineItems
    );
    if (!lineItems.length) throw new Error("Add at least one line item or job price before sending.");

    const id = existingAgreement?.id || (sourceIsAgreement && source?.id ? source.id : `sa_${uuidv4()}`);
    const subtotalAmountCents = lineItems.reduce((total, item) => total + cents(item.totalAmountCents), 0);
    const sourceRate =
      selectedPlanOption?.totalAmountCents ??
      source?.rateAmountCents ??
      source?.totalAmountCents ??
      source?.rate ??
      existingAgreement?.totalAmountCents ??
      existingAgreement?.rateAmountCents ??
      0;
    const totalAmountCents = cents(sourceRate) || subtotalAmountCents || cents(job.rate);
    const selectedSolutionId = selectedPlanId;
    const selectedSolutionOption = selectedPlanOption;
    const sourceTerms = source?.termsList?.length ? source.termsList : source?.terms;
    const selectedTerms = normalizeTerms(sourceTerms || []);
    const fallbackTerms =
      source?.termsSummary ||
      source?.termsText ||
      source?.notes ||
      source?.description ||
      existingAgreement?.termsSummary ||
      existingAgreement?.terms ||
      job.description ||
      "Customer approval is required before work begins.";
    const termsList = selectedTerms
      .map((term, index) => ({
        id: term.id || `term_${index}`,
        title: term.title || term.name || term.label || `Term ${index + 1}`,
        description: term.description || term.value || term.title || "",
        value: term.value || "",
      }))
      .filter((term) => term.description || term.title);
    const fallbackTermsList = [{
      id: "fallback_terms",
      title: "Agreement Terms",
      description: fallbackTerms,
      value: "",
    }];
    const termsText = termsList
      .map((term) => term.description || term.title)
      .filter(Boolean);
    const termsSummary = (termsText.length ? termsText : [fallbackTerms]).join("\n");
    const legacyContractId = !sourceIsAgreement
      ? source?.id || existingAgreement?.contractId || ""
      : existingAgreement?.contractId || "";

    const payload = {
      ...(existingAgreement || {}),
      id,
      companyId: recentlySelectedCompany,
      companyName: authCtx?.recentlySelectedCompanyName || source?.senderName || "",
      customerId: job.customerId || customer.id || "",
      customerUserId: getCustomerUserId(),
      customerName: getCustomerDisplayName(),
      customerEmail: email,
      billingEmail: customer.billingEmail || email,
      customerPhoneNumber: customer.phoneNumber || customer.phone || "",
      relationshipId: customer.relationshipId || customer.customerCompanyRelationshipId || "",
      customerCompanyRelationshipId: customer.customerCompanyRelationshipId || customer.relationshipId || "",
      email,
      serviceLocationIds: [job.serviceLocationId || serviceLocation.id || ""].filter(Boolean),
      serviceLocationSnapshots: [getServiceLocationSnapshot()].filter((location) => location.id || location.streetAddress),
      sourceType: SalesAgreementSourceType.oneOffJob,
      sourceId: jobId,
      title: source?.title || `${job.internalId || "Job"} Estimate`,
      description: source?.description || source?.notes || job.description || "",
      terms: selectedTerms.length ? "" : fallbackTerms,
      termsTemplateId: source?.termsTemplateId || "",
      termsTemplateName: source?.termsTemplateName || "Job Estimate Terms",
      termsTemplateDescription: source?.termsTemplateDescription || "",
      termsList: termsList.length ? termsList : fallbackTermsList,
      termsSummary,
      lineItems,
      planOptions,
      solutionOptions: planOptions,
      allowPlanSelection: planOptions.length > 1,
      allowSolutionSelection: planOptions.length > 1,
      selectedPlanId,
      selectedSolutionId,
      defaultPlanId: selectedPlanId,
      defaultSolutionId: selectedSolutionId,
      acceptedPlanId: existingAgreement?.acceptedPlanId || job.acceptedPlanId || "",
      acceptedSolutionId: existingAgreement?.acceptedSolutionId || existingAgreement?.acceptedPlanId || job.acceptedSolutionId || job.acceptedPlanId || "",
      status: normalizeSalesAgreementStatus(status || existingAgreement?.status || source?.status),
      billingProfileId: existingAgreement?.billingProfileId || "",
      billingSubscriptionId: existingAgreement?.billingSubscriptionId || "",
      rateAmountCents: totalAmountCents,
      subtotalAmountCents,
      taxAmountCents: existingAgreement?.taxAmountCents || 0,
      totalAmountCents,
      rateType: "oneTime",
      serviceCadence: "oneTime",
      serviceCadenceCount: 1,
      billingFrequency: "oneTime",
      billingFrequencyCount: 1,
      paymentTerms: existingAgreement?.paymentTerms || "dueOnReceipt",
      invoiceDeliveryMethod: "email",
      manualBillingAutoSendEnabled: false,
      includedServices: [],
      excludedServices: [],
      startDate: existingAgreement?.startDate || null,
      endDate: existingAgreement?.endDate || null,
      expiresAt: normalizeAgreementDeadline(source?.expiresAt || source?.lastDateToAccept || existingAgreement?.expiresAt),
      atWill: false,
      createdByUserId: existingAgreement?.createdByUserId || getUserId() || dataBaseUser?.id || "",
      emailDelivery: existingAgreement?.emailDelivery || {},
      updatedAt: serverTimestamp(),
      createdAt: existingAgreement?.createdAt || serverTimestamp(),
      jobId,
      contractId: legacyContractId,
    };

    await setDoc(doc(db, salesCollectionNames.agreements, id), payload, { merge: true });
    await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
      salesAgreementId: id,
      salesEstimateAgreementId: id,
    });

    if (legacyContractId) {
      await updateDoc(doc(db, "contracts", legacyContractId), {
        salesAgreementId: id,
        receiverName: source.receiverName || getCustomerDisplayName(),
        receiverEmail: source.receiverEmail || email,
        customerId: source.customerId || job.customerId || customer.id || "",
        customerName: source.customerName || getCustomerDisplayName(),
        customerEmail: source.customerEmail || email,
        email: source.email || email,
        billingEmail: source.billingEmail || customer.billingEmail || email,
        customerUserId: getCustomerUserId(source) || getCustomerUserId(),
        relationshipId: source.relationshipId || customer.relationshipId || customer.customerCompanyRelationshipId || "",
        customerCompanyRelationshipId:
          source.customerCompanyRelationshipId ||
          customer.customerCompanyRelationshipId ||
          customer.relationshipId ||
          "",
        updatedAt: serverTimestamp(),
      });
    }

    setLinkedSalesAgreement(payload);
    setSelectedSalesAgreementId(id);
    return payload;
  };

  const findLinkedSalesInvoice = async () => {
    if (!recentlySelectedCompany || !jobId) return null;

    if (linkedSalesInvoice?.id) {
      const linkedSnap = await getDoc(doc(db, salesCollectionNames.invoices, linkedSalesInvoice.id));
      if (linkedSnap.exists()) return withFirestoreDocId(linkedSnap);
    }

    const invoiceId =
      selectedContract?.salesInvoiceId ||
      selectedContract?.invoiceId ||
      job.salesInvoiceId ||
      "";

    if (invoiceId) {
      const invoiceSnap = await getDoc(doc(db, salesCollectionNames.invoices, invoiceId));
      if (invoiceSnap.exists()) return withFirestoreDocId(invoiceSnap);
    }

    const invoicesSnap = await getDocs(
      query(
        collection(db, salesCollectionNames.invoices),
        where("companyId", "==", recentlySelectedCompany),
        where("jobId", "==", jobId)
      )
    );

    return invoicesSnap.empty
      ? null
      : withFirestoreDocId(invoicesSnap.docs[0]);
  };

  const ensureJobSalesInvoice = async (agreementInput = "", options = {}) => {
    const { requireEmail = true } = options;
    const email = getCustomerEmail();
    if (requireEmail && !email) throw new Error("Customer email is required before sending an invoice.");

    const lineItems = getSalesLineItemsFromSnapshot();
    if (!lineItems.length) throw new Error("Add at least one line item or job price before invoicing.");

    const existingInvoice = await findLinkedSalesInvoice();
    const sourceAgreement = agreementInput && typeof agreementInput === "object"
      ? agreementInput
      : selectedSalesAgreement;
    const agreementId = typeof agreementInput === "string" ? agreementInput : sourceAgreement?.id || "";
    const id = existingInvoice?.id || `si_${uuidv4()}`;
    const subtotalAmountCents = lineItems.reduce((total, item) => total + cents(item.totalAmountCents), 0);
    const totalAmountCents = cents(
      sourceAgreement?.totalAmountCents ??
      sourceAgreement?.rateAmountCents ??
      selectedContract?.rate ??
      0
    ) || subtotalAmountCents || cents(job.rate);
    const paymentTerms = sourceAgreement?.paymentTerms || existingInvoice?.paymentTerms || "dueOnReceipt";
    const dueDate = salesDueDateForTerms(paymentTerms);

    const payload = {
      ...(existingInvoice || {}),
      id,
      companyId: recentlySelectedCompany,
      companyName: authCtx?.recentlySelectedCompanyName || selectedContract?.senderName || sourceAgreement?.companyName || "",
      customerId: job.customerId || customer.id || "",
      customerUserId: getCustomerUserId(),
      customerName: getCustomerDisplayName(),
      customerEmail: email,
      billingEmail: customer.billingEmail || email,
      customerPhoneNumber: customer.phoneNumber || customer.phone || "",
      relationshipId: customer.relationshipId || customer.customerCompanyRelationshipId || "",
      customerCompanyRelationshipId: customer.customerCompanyRelationshipId || customer.relationshipId || "",
      email,
      agreementId: agreementId || existingInvoice?.agreementId || sourceAgreement?.id || linkedSalesAgreement?.id || "",
      jobId,
      contractId: selectedContract?.id || sourceAgreement?.contractId || "",
      billingSubscriptionId: existingInvoice?.billingSubscriptionId || "",
      stripeConnectedAccountId: authCtx?.stripeConnectedAccountId || "",
      stripeInvoiceId: existingInvoice?.stripeInvoiceId || "",
      stripePaymentIntentId: existingInvoice?.stripePaymentIntentId || "",
      stripeHostedInvoiceUrl: existingInvoice?.stripeHostedInvoiceUrl || "",
      stripeInvoicePdfUrl: existingInvoice?.stripeInvoicePdfUrl || "",
      invoiceNumber: existingInvoice?.invoiceNumber || `${job.internalId || "JOB"}-${String(Date.now()).slice(-6)}`,
      type: "oneTime",
      status: existingInvoice?.status === "paid" ? "paid" : "open",
      deliveryMethod: sourceAgreement?.invoiceDeliveryMethod || existingInvoice?.deliveryMethod || "email",
      paymentTerms,
      currency: "usd",
      billingPeriodStart: existingInvoice?.billingPeriodStart || null,
      billingPeriodEnd: existingInvoice?.billingPeriodEnd || null,
      dueDate: existingInvoice?.dueDate || Timestamp.fromDate(dueDate),
      subtotalAmountCents,
      discountAmountCents: existingInvoice?.discountAmountCents || 0,
      taxAmountCents: existingInvoice?.taxAmountCents || 0,
      totalAmountCents,
      amountPaidCents: existingInvoice?.amountPaidCents || 0,
      amountDueCents: Math.max(totalAmountCents - cents(existingInvoice?.amountPaidCents), 0),
      writeOffAmountCents: existingInvoice?.writeOffAmountCents || 0,
      memo: sourceAgreement?.description || sourceAgreement?.termsSummary || selectedContract?.notes || job.description || "",
      lineItems,
      sourceType: "jobEstimateConversion",
      sourceId: jobId,
      updatedAt: serverTimestamp(),
      createdAt: existingInvoice?.createdAt || serverTimestamp(),
      serviceLocationSnapshots: [getServiceLocationSnapshot()].filter((location) => location.id || location.streetAddress),
    };

    await setDoc(doc(db, salesCollectionNames.invoices, id), payload, { merge: true });
    await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
      salesInvoiceId: id,
      invoiceDate: serverTimestamp(),
      invoiceType: "salesInvoice",
      invoiceRef: id,
    });

    if (selectedContract?.id) {
      await updateDoc(doc(db, "contracts", selectedContract.id), {
        salesInvoiceId: id,
        receiverName: selectedContract.receiverName || getCustomerDisplayName(),
        receiverEmail: selectedContract.receiverEmail || email,
        customerId: selectedContract.customerId || job.customerId || customer.id || "",
        customerName: selectedContract.customerName || getCustomerDisplayName(),
        customerEmail: selectedContract.customerEmail || email,
        email: selectedContract.email || email,
        billingEmail: selectedContract.billingEmail || customer.billingEmail || email,
        customerUserId: getCustomerUserId(selectedContract) || getCustomerUserId(),
        relationshipId: selectedContract.relationshipId || customer.relationshipId || customer.customerCompanyRelationshipId || "",
        customerCompanyRelationshipId:
          selectedContract.customerCompanyRelationshipId ||
          customer.customerCompanyRelationshipId ||
          customer.relationshipId ||
          "",
        updatedAt: serverTimestamp(),
      });
    }

    setLinkedSalesInvoice(payload);
    return payload;
  };

  const activeWorkOfferTaskIds = useMemo(() => {
    const inactiveStatuses = new Set(["Rejected", "rejected", "Cancelled", "Canceled", "cancelled", "canceled", "Expired", "expired"]);

    return new Set(
      (workOffers || [])
        .filter((offer) => !inactiveStatuses.has(offer.status || ""))
        .flatMap((offer) => {
          if (Array.isArray(offer.jobTaskIds)) return offer.jobTaskIds;
          if (Array.isArray(offer.taskIds)) return offer.taskIds;
          return [];
        })
        .filter(Boolean)
    );
  }, [workOffers]);

  const availableWorkOfferTasks = useMemo(
    () => (taskList || []).filter((task) => task?.id && !activeWorkOfferTaskIds.has(task.id)),
    [taskList, activeWorkOfferTaskIds]
  );

  const selectedWorkOfferTasks = useMemo(() => {
    const selectedIds = new Set(workOfferForm.selectedTaskIds || []);
    return availableWorkOfferTasks.filter((task) => selectedIds.has(task.id));
  }, [availableWorkOfferTasks, workOfferForm.selectedTaskIds]);

  const selectedWorkOfferMinutes = useMemo(
    () => selectedWorkOfferTasks.reduce((total, task) => total + Number(task.estimatedTime || 0), 0),
    [selectedWorkOfferTasks]
  );

  const selectedWorkOfferLaborCents = useMemo(
    () => selectedWorkOfferTasks.reduce((total, task) => total + cents(task.contractedRate), 0),
    [selectedWorkOfferTasks]
  );

  const toInputDateValue = (value) => {
    if (!value) return "";
    const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
    if (Number.isNaN(date?.getTime?.())) return "";
    return format(date, "yyyy-MM-dd");
  };
  const actualMarginPercent = useMemo(() => {
    const rate = estimateCustomerPriceCents;
    if (rate <= 0) return "0.0";

    return ((actualProfitCents / rate) * 100).toFixed(1);
  }, [estimateCustomerPriceCents, actualProfitCents]);

  const billingReadyCents = useMemo(() => {
    return estimateCustomerPriceCents;
  }, [estimateCustomerPriceCents]);

  const estimateProfitAgainstBillablePlanCents = useMemo(() => {
    return estimateCustomerPriceCents - plannedTotalLaborCents - plannedMaterialCostCents;
  }, [estimateCustomerPriceCents, plannedTotalLaborCents, plannedMaterialCostCents]);

  const estimateDifferenceCents = useMemo(() => {
    return contractTotalCents - estimateCustomerPriceCents;
  }, [contractTotalCents, estimateCustomerPriceCents]);

  const markJobAsFinished = async () => {
    if (markingJobFinished) return;

    try {
      if (!recentlySelectedCompany || !jobId) return;

      setMarkingJobFinished(true);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      const previousBillingStatus = job.billingStatus || "—";
      const nextBillingStatus =
        job.billingStatus === "Draft" || !job.billingStatus ? "In Progress" : job.billingStatus;
      const finishedTasks = [];

      for (const task of taskList || []) {
        if (!task?.id) continue;

        const installDetails = await promptForReplacementInstallDetails(task);
        if (installDetails === null) {
          toast.error("Replacement install details are required before finishing the job");
          return;
        }

        finishedTasks.push({
          ...task,
          ...installDetails,
          equipmentStatusOnCompletion: task.equipmentId
            ? taskEquipmentStatusDrafts[task.id] || EQUIPMENT_STATUS.OPERATIONAL
            : "",
          status: "Finished",
        });
      }

      await updateDoc(jobRef, {
        operationStatus: "Finished",
        billingStatus: nextBillingStatus,
      });

      await Promise.all(
        finishedTasks.map(async (task) => {
          if (!task?.id) return;

          const effects = await runWorkCompletionEffects({
            db,
            companyId: recentlySelectedCompany,
            task,
            jobId,
            currentJobOperationStatus: "Finished",
          });

          await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id),
            {
              status: "Finished",
              ...(task.equipmentStatusOnCompletion ? { equipmentStatusOnCompletion: task.equipmentStatusOnCompletion } : {}),
              ...(task.installedEquipmentName ? { installedEquipmentName: task.installedEquipmentName } : {}),
              ...(task.installedEquipmentType ? { installedEquipmentType: task.installedEquipmentType } : {}),
              ...(task.installedEquipmentMake ? { installedEquipmentMake: task.installedEquipmentMake } : {}),
              ...(task.installedEquipmentModel ? { installedEquipmentModel: task.installedEquipmentModel } : {}),
              ...(task.installedEquipmentNotes ? { installedEquipmentNotes: task.installedEquipmentNotes } : {}),
              ...(effects.equipmentHistory?.replacementEquipmentId
                ? {
                  replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId,
                  installedEquipmentId: effects.equipmentHistory.replacementEquipmentId,
                }
                : {}),
              ...(effects.equipmentHistory?.installedPurchasedItemId
                ? {
                  purchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                  installedPurchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                }
                : {}),
            }
          );
        })
      );

      setJob((prev) => ({
        ...prev,
        operationStatus: "Finished",
        billingStatus:
          prev.billingStatus === "Draft" || !prev.billingStatus
            ? "In Progress"
            : prev.billingStatus,
      }));
      setTaskList((prev) =>
        prev.map((task) => finishedTasks.find((finishedTask) => finishedTask.id === task.id) || task)
      );

      setSelectedOperationStatus({
        value: "Finished",
        label: "Finished",
      });
      setSelectedBillingStatus({ value: nextBillingStatus, label: nextBillingStatus });
      await recordJobHistory({
        eventType: "Status Change",
        title: "Job marked as finished",
        description: `${taskList?.length || 0} task(s) were marked finished.`,
        changes: [
          buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", "Finished"),
          buildHistoryChange("billingStatus", "Billing Status", previousBillingStatus, nextBillingStatus),
        ],
      });
      await addJobCommentDocument(`Job finished by ${getAuditUserName()}.`, {
        resolved: true,
        sourceType: "jobFinished",
        metadata: {
          finishedByUserId: getUserId() || "",
          finishedByUserName: getAuditUserName(),
          taskCount: taskList?.length || 0,
        },
      });

      toast.success("Job marked as finished");
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark job as finished");
    } finally {
      setMarkingJobFinished(false);
    }
  };


  const openCreateContractModal = () => {
    setShowCreateContractModal(true);
    const id = "sa_" + uuidv4();
    const customerDisplayName = getCustomerDisplayName();
    const customerEmail = getCustomerEmail();
    const acceptByDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const defaultTerms = [
      {
        id: uuidv4(),
        title: "Scope of Work",
        description: job.description || "Complete the agreed work for this job.",
        value: "",
      },
      {
        id: uuidv4(),
        title: "Estimated Duration",
        description: `${plannedDurationHours || "0.00"} hours estimated`,
        value: plannedDurationHours || "0.00",
      },
      {
        id: uuidv4(),
        title: "Customer Price",
        description: "Total customer price for this job",
        value: plannedEstimatePriceCents || cents(job.rate),
      },
      {
        id: uuidv4(),
        title: "Planned Labor",
        description: "Internal planned labor cost",
        value: plannedTotalLaborCents,
      },
      {
        id: uuidv4(),
        title: "Planned Products",
        description: "Internal planned product cost",
        value: plannedMaterialCostCents,
      },
      {
        id: uuidv4(),
        title: "Planned Billable Products",
        description: "Planned customer-facing product value included for estimate review",
        value: plannedMaterialPriceCents,
      },
    ];

    const lineItems = buildSuggestedContractSnapshot().map((item) => ({
      id: item.id,
      catalogItemId: item.catalogItemId || "",
      sourceType: item.sourceType || "",
      sourceId: item.sourceId || "",
      salesItemType: item.salesItemType || "",
      billingBehavior: item.billingBehavior || SalesCatalogBillingBehavior.oneTime,
      type: item.type,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitAmountCents: item.unitAmountCents ?? item.amount,
      totalAmountCents: item.totalAmountCents ?? item.amount,
      amount: item.amount,
      taxable: Boolean(item.taxable),
      stripeProductId: item.stripeProductId || "",
      stripePriceId: item.stripePriceId || "",
    }));
    setDraftContractData({
      id,
      senderName:
        `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
        getUserName(),
      senderId: recentlySelectedCompany,
      senderUserId: getUserId() || "",
      senderAcceptance: true,
      receiverName: customerDisplayName,
      receiverId: customer.id || job.customerId || "",
      receiverEmail: customerEmail,
      receiverAcceptance: false,
      dateSent: null,
      lastDateToAccept: format(acceptByDate, "yyyy-MM-dd"),
      dateAccepted: null,
      status: SalesAgreementStatus.draft,
      terms: defaultTerms,
      notes: job.description || "",
      rate: dollarsFromCents(job.rate),
      lineItems,
      jobId: jobId || "", // requested
      jobInternalId: job.internalId || "",
      customerId: job.customerId || customer.id || "",
      customerName: customerDisplayName,
      customerEmail,
      email: customerEmail,
      billingEmail: customer.billingEmail || customerEmail,
      customerUserId: getCustomerUserId(),
      relationshipId: customer.relationshipId || customer.customerCompanyRelationshipId || "",
      customerCompanyRelationshipId: customer.customerCompanyRelationshipId || customer.relationshipId || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      sourceType: SalesAgreementSourceType.oneOffJob,
      sourceId: jobId || "",
      version: (jobSalesAgreements?.length || 0) + 1,
    })
  };

  const closeCreateContractModal = () => {
    setShowCreateContractModal(false);
  };

  const openContractModal = (contract) => {
    if (!contract) return;

    setContractForm({
      id: contract.id || "",
      receiverName: contract.receiverName || "",
      notes: contract.notes || "",
      rate: String(((Number(contract.rate || 0)) / 100).toFixed(2)),
      status: contract.status || "Draft",
      lastDateToAccept: toInputDateValue(contract.lastDateToAccept),
      terms: Array.isArray(contract.terms) ? contract.terms : [],
      lineItems: Array.isArray(contract.lineItems) ? contract.lineItems : [],
      jobId: contract.jobId || jobId || "",
    });

    setShowContractModal(true);
  };

  const closeContractModal = () => {
    setShowContractModal(false);
    setContractForm({
      id: "",
      receiverName: "",
      notes: "",
      rate: "",
      status: "Draft",
      lastDateToAccept: "",
      terms: [],
      lineItems: [],
      jobId: "",
    });
  };
  const handleDraftContractDataChange = (field, value) => {
    setDraftContractData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };
  const handleContractFormChange = (field, value) => {
    setContractForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const getCompanyUserId = (user) => user?.userId || user?.id || user?.docId || "";

  const getCompanyUserName = (user) =>
    user?.userName ||
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    "Technician";

  const getCompanyUserWorkerType = (user) => {
    const workerType = user?.workerType;
    if (!workerType) return "Not Assigned";
    if (typeof workerType === "string") return workerType;
    return workerType?.rawValue || workerType?.value || workerType?.name || "Not Assigned";
  };

  const openCreateWorkOfferModal = () => {
    const firstUser = (companyUserList || []).find((user) => getCompanyUserId(user));
    const defaultOfferType = firstUser ? "Direct User" : "Internal Board";

    setWorkOfferForm({
      offerType: defaultOfferType,
      workerId: firstUser ? getCompanyUserId(firstUser) : "",
      boardVisibility: "Contractors Only",
      title: `${job.internalId || "Job"} - ${job.customerName || customer.firstName || "Work Offer"}`.trim(),
      notes: job.description || "",
      selectedTaskIds: availableWorkOfferTasks.map((task) => task.id),
      serviceStopTypeId: companyServiceStopTypes?.[0]?.id || "",
      paySource: "Technician Rate",
      offeredAmount: "",
      includeDate: false,
      proposedStartDate: "",
      allowsTechnicianSelfScheduling: false,
    });
    setShowCreateWorkOfferModal(true);
  };

  const closeCreateWorkOfferModal = () => {
    if (savingWorkOffer) return;
    setShowCreateWorkOfferModal(false);
  };

  const handleWorkOfferFormChange = (field, value) => {
    setWorkOfferForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const toggleWorkOfferTask = (taskId) => {
    setWorkOfferForm((prev) => {
      const selected = new Set(prev.selectedTaskIds || []);
      if (selected.has(taskId)) {
        selected.delete(taskId);
      } else {
        selected.add(taskId);
      }

      return {
        ...prev,
        selectedTaskIds: Array.from(selected),
      };
    });
  };

  const saveWorkOffer = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;
      if (!selectedWorkOfferTasks.length) {
        toast.error("Select at least one available task.");
        return;
      }

      const isBoardPost = workOfferForm.offerType === "Internal Board";
      const selectedWorker = (companyUserList || []).find(
        (user) => getCompanyUserId(user) === workOfferForm.workerId
      );

      if (!isBoardPost && !selectedWorker) {
        toast.error("Select a technician before creating a direct offer.");
        return;
      }

      setSavingWorkOffer(true);

      const id = "comp_work_offer_" + uuidv4();
      const boardPostId = isBoardPost ? "comp_work_board_" + uuidv4() : "";
      const selectedType =
        (companyServiceStopTypes || []).find((type) => type.id === workOfferForm.serviceStopTypeId) || null;
      const offeredAmountCents =
        workOfferForm.paySource === "Offered Amount"
          ? Math.round(Number(workOfferForm.offeredAmount || 0) * 100)
          : 0;
      const payTotal =
        workOfferForm.paySource === "Offered Amount"
          ? offeredAmountCents
          : workOfferForm.paySource === "Unpaid"
            ? 0
            : selectedWorkOfferLaborCents;
      const offerTitle =
        workOfferForm.title?.trim() ||
        `${job.internalId || "Job"} - ${job.customerName || "Work Offer"}`.trim();
      const serviceAddress = {
        streetAddress: serviceLocation.streetAddress || "",
        city: serviceLocation.city || "",
        state: serviceLocation.state || "",
        zip: serviceLocation.zip || "",
        latitude: Number(serviceLocation.latitude || 0),
        longitude: Number(serviceLocation.longitude || 0),
      };
      const selectedTaskIds = selectedWorkOfferTasks.map((task) => task.id);
      const estimatedPayLines = selectedWorkOfferTasks.map((task) => ({
        id: `offer_estimate_task_preview_${task.id}`,
        sourceTaskId: task.id,
        source: "Service Stop Task",
        workTypeId: "",
        workTypeName: task.type || "",
        title: task.name || task.type || "Task",
        rateAmountCents: cents(task.contractedRate),
        rateType: "Flat Per Task",
        quantity: 1,
        quantityUnit: "Each",
        totalAmountCents: cents(task.contractedRate),
        calculationStatus: cents(task.contractedRate) > 0 ? "Calculated" : "Needs Review",
        notes: `${task.type || "Task"} • ${Number(task.estimatedTime || 0)} min • Task contracted rate`,
      }));

      const firestoreOffer = {
        id,
        companyId: recentlySelectedCompany,
        jobId,
        jobInternalId: job.internalId || "",
        jobName: job.type || job.description || job.internalId || "Job",
        serviceStopId: "",
        serviceStopInternalId: "",
        offerType: workOfferForm.offerType,
        status: isBoardPost ? "Posted" : "Sent",
        title: offerTitle,
        description: workOfferForm.notes || job.description || "",
        offeredToUserId: isBoardPost ? "" : getCompanyUserId(selectedWorker),
        offeredToUserName: isBoardPost ? "" : getCompanyUserName(selectedWorker),
        offeredToWorkerType: isBoardPost ? "Not Assigned" : getCompanyUserWorkerType(selectedWorker),
        postedToBoard: isBoardPost,
        isBoardPost,
        boardVisibility: isBoardPost ? workOfferForm.boardVisibility : "Contractors Only",
        boardPostId,
        jobTaskIds: selectedTaskIds,
        taskIds: selectedTaskIds,
        serviceStopTaskIds: [],
        customerId: job.customerId || customer.id || "",
        customerName: job.customerName || [customer.firstName, customer.lastName].filter(Boolean).join(" "),
        serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
        serviceLocationName: serviceLocation.nickName || "",
        address: serviceAddress,
        proposedStartDate:
          workOfferForm.includeDate && workOfferForm.proposedStartDate
            ? Timestamp.fromDate(new Date(workOfferForm.proposedStartDate))
            : null,
        proposedEndDate: null,
        estimatedMinutes: selectedWorkOfferMinutes,
        allowsTechnicianSelfScheduling: workOfferForm.allowsTechnicianSelfScheduling,
        canTechnicianSchedule: workOfferForm.allowsTechnicianSelfScheduling,
        paySource: workOfferForm.paySource,
        offeredAmountCents,
        estimatedLaborCents: selectedWorkOfferLaborCents,
        estimatedPayCents: payTotal,
        estimatedPayTotalCents: payTotal,
        manualPayOverrideCents:
          workOfferForm.paySource === "Offered Amount"
            ? offeredAmountCents
            : workOfferForm.paySource === "Unpaid"
              ? 0
              : null,
        manualPayOverrideNotes:
          workOfferForm.paySource === "Offered Amount"
            ? "Manual payroll amount from work offer."
            : workOfferForm.paySource === "Unpaid"
              ? "Work offer marked unpaid."
              : "",
        estimatedPayLines:
          workOfferForm.paySource === "Offered Amount"
            ? [
              {
                id: "offer_estimate_offered_amount",
                sourceTaskId: null,
                source: "Manual Adjustment",
                workTypeId: "",
                workTypeName: "",
                title: "Offered Amount",
                rateAmountCents: offeredAmountCents,
                rateType: "Manual",
                quantity: 1,
                quantityUnit: "Each",
                totalAmountCents: offeredAmountCents,
                calculationStatus: offeredAmountCents > 0 ? "Calculated" : "Needs Review",
                notes: "Fixed amount offered for this work.",
              },
            ]
            : workOfferForm.paySource === "Unpaid"
              ? [
                {
                  id: "offer_estimate_unpaid",
                  sourceTaskId: null,
                  source: "Manual Adjustment",
                  workTypeId: "",
                  workTypeName: "",
                  title: "Unpaid Work",
                  rateAmountCents: 0,
                  rateType: "Manual",
                  quantity: 0,
                  quantityUnit: "Each",
                  totalAmountCents: 0,
                  calculationStatus: "Calculated",
                  notes: "This offer is marked unpaid.",
                },
              ]
              : estimatedPayLines,
        estimatedPayNotes: "Estimate only. Final payroll is generated from completed service stop work.",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUserId: getUserId() || "",
        createdByUserName: getUserName(),
        sentAt: isBoardPost ? null : serverTimestamp(),
        postedAt: isBoardPost ? serverTimestamp() : null,
        acceptedAt: null,
        acceptedByUserId: "",
        acceptedByUserName: "",
        rejectedAt: null,
        completedAt: null,
        adminNotes: workOfferForm.notes || "",
        workerNotes: "",
        sourceLaborContractId: "",
        externalCompanyId: "",
        externalCompanyName: "",
        serviceStopTypeId: selectedType?.id || "",
        serviceStopTypeName: selectedType?.name || "",
        serviceStopTypeImage: selectedType?.image || selectedType?.typeImage || "",
        serviceStopTypeUseCaseRawValue: "jobVisit",
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOffers", id), firestoreOffer, { merge: true });

      await setDoc(
        doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "workOfferRefs", id),
        {
          id,
          jobId,
          status: firestoreOffer.status,
          offerType: firestoreOffer.offerType,
          title: firestoreOffer.title,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      setWorkOffers((prev) => [
        {
          ...firestoreOffer,
          createdAt: new Date(),
          updatedAt: new Date(),
          sentAt: isBoardPost ? null : new Date(),
          postedAt: isBoardPost ? new Date() : null,
        },
        ...(prev || []),
      ]);
      await recordJobHistory({
        eventType: "Work Offer",
        title: `Work offer created: ${offerTitle}`,
        description: firestoreOffer.description || "",
        changes: [
          buildHistoryChange("status", "Status", "—", firestoreOffer.status),
          buildHistoryChange("offerType", "Offer Type", "—", firestoreOffer.offerType),
          buildHistoryChange("estimatedPayCents", "Estimated Pay", "—", moneyFromCents(payTotal)),
          buildHistoryChange("taskCount", "Tasks", "—", selectedTaskIds.length),
        ],
        metadata: {
          workOfferId: id,
          boardPostId,
          target: isBoardPost ? "Internal Board" : getCompanyUserName(selectedWorker),
        },
      });
      setShowCreateWorkOfferModal(false);
      toast.success("Work offer created");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create work offer");
    } finally {
      setSavingWorkOffer(false);
    }
  };

  const saveContractChanges = async () => {
    try {
      if (!contractForm.id) return toast.error("Missing contract id");

      setSavingContract(true);

      const contractRef = doc(db, "contracts", contractForm.id);
      const customerEmail = getCustomerEmail();
      const nextRateCents = centsFromCurrencyInput(contractForm.rate);

      await updateDoc(contractRef, {
        receiverName: contractForm.receiverName || "",
        receiverEmail: selectedContract?.receiverEmail || customerEmail,
        customerId: selectedContract?.customerId || job.customerId || customer.id || "",
        customerName: selectedContract?.customerName || getCustomerDisplayName(),
        customerEmail: selectedContract?.customerEmail || customerEmail,
        email: selectedContract?.email || customerEmail,
        billingEmail: selectedContract?.billingEmail || customer.billingEmail || customerEmail,
        customerUserId: getCustomerUserId(selectedContract) || getCustomerUserId(),
        relationshipId: selectedContract?.relationshipId || customer.relationshipId || customer.customerCompanyRelationshipId || "",
        customerCompanyRelationshipId:
          selectedContract?.customerCompanyRelationshipId ||
          customer.customerCompanyRelationshipId ||
          customer.relationshipId ||
          "",
        notes: contractForm.notes || "",
        rate: nextRateCents,
        status: contractForm.status || "Draft",
        lastDateToAccept: contractForm.lastDateToAccept
          ? Timestamp.fromDate(new Date(contractForm.lastDateToAccept))
          : null,
        jobId: contractForm.jobId || jobId || "",
        updatedAt: serverTimestamp(),
      });
      await recordJobHistory({
        eventType: "Billing",
        title: "Estimate / contract updated",
        changes: [
          buildHistoryChange("receiverName", "Receiver", selectedContract?.receiverName, contractForm.receiverName || ""),
          buildHistoryChange("rate", "Contract Total", moneyFromCents(selectedContract?.rate || 0), moneyFromCents(nextRateCents)),
          buildHistoryChange("status", "Status", selectedContract?.status || "—", contractForm.status || "Draft"),
          buildHistoryChange("lastDateToAccept", "Accept By", formatDateValue(selectedContract?.lastDateToAccept), formatDateValue(contractForm.lastDateToAccept)),
        ],
        metadata: { contractId: contractForm.id },
      });

      toast.success("Contract updated");
      closeContractModal();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update contract");
    } finally {
      setSavingContract(false);
    }
  };

  const deleteContractItem = async () => {
    try {
      if (!contractForm.id) return toast.error("Missing contract id");

      const ok = await appConfirm({
        title: "Delete Contract",
        message: "Delete this contract? This cannot be undone.",
        confirmLabel: "Delete Contract",
        variant: "danger",
      });
      if (!ok) return;

      setDeletingContract(true);

      await deleteDoc(doc(db, "contracts", contractForm.id));
      await recordJobHistory({
        eventType: "Billing",
        title: "Estimate / contract deleted",
        description: contractForm.receiverName || selectedContract?.receiverName || "",
        metadata: { contractId: contractForm.id },
        severity: "danger",
      });

      if (selectedContractId === contractForm.id) {
        setSelectedContractId("");
      }

      toast.success("Contract deleted");
      closeContractModal();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete contract");
    } finally {
      setDeletingContract(false);
    }
  };

  // MARK: initial load
  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    (async () => {
      try {
        setLoading(true);
        setSectionLoading(createSectionLoadingState());

        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        const jobSnap = await getDoc(jobRef);
        if (!jobSnap.exists()) throw new Error("Job not found");

        const j = jobSnap.data();
        const dateCreated = j.dateCreated?.toDate?.() ?? null;
        const loadedIssuePriority = normalizeIssuePriority(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY);
        const loadedActiveSolutionTier = normalizeJobPlanTier(j.activePlanTier || j.activeSolutionTier || DEFAULT_JOB_PLAN_TIER);

        const serviceStopIds = (Array.isArray(j.serviceStopIds)
          ? j.serviceStopIds
          : j.serviceStopIds
            ? [j.serviceStopIds]
            : []
        )
          .map(idValue)
          .filter(Boolean);

        setJob((prev) => ({
          ...prev,
          ...j,
          dateCreated,
          serviceStopIds,
          issuePriorityLevel: loadedIssuePriority,
          issuePriorityLabel: j.issuePriorityLabel || j.priorityLabel || getIssuePriorityLabel(loadedIssuePriority),
          solutionTier: loadedIssuePriority,
          solutionTierLabel: j.solutionTierLabel || j.priorityLabel || getIssuePriorityLabel(loadedIssuePriority),
          activePlanTier: loadedActiveSolutionTier,
          activePlanTierLabel: j.activePlanRecommendationRankLabel || getJobPlanRecommendationLabel(loadedActiveSolutionTier),
          activePlanId: j.activePlanId || j.activeSolutionId || "",
          acceptedPlanId: j.acceptedPlanId || j.acceptedSolutionId || "",
          activeSolutionId: j.activeSolutionId || j.activePlanId || "",
          acceptedSolutionId: j.acceptedSolutionId || j.acceptedPlanId || "",
          solutionSelectionStatus: j.solutionSelectionStatus || j.planSelectionStatus || "",
          planSelectionStatus: j.planSelectionStatus || j.solutionSelectionStatus || "",
        }));
        setLaborLineItems(normalizeJobLaborLineItems(j.laborLineItems || j.estimateLaborLineItems || []));
        setLoading(false);
        setSectionLoading((prev) => ({
          ...prev,
          shell: false,
        }));

        const stopSnapshots = serviceStopIds.length
          ? await Promise.all(
            serviceStopIds.map((stopId) =>
              getDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", stopId))
            )
          )
          : [];

        const stopsById = new Map();
        const addStopFromSnapshot = (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          const stopId = idValue(data.id) || snap.id;
          stopsById.set(stopId, {
            ...data,
            id: stopId,
          });
        };

        stopSnapshots
          .filter((snap) => snap.exists())
          .forEach(addStopFromSnapshot);

        const serviceStopsRef = collection(db, "companies", recentlySelectedCompany, "serviceStops");
        const stopQueries = [
          query(serviceStopsRef, where("jobId", "==", jobId)),
          query(serviceStopsRef, where("jobId.id", "==", jobId)),
          query(serviceStopsRef, where("workOrderId", "==", jobId)),
          query(serviceStopsRef, where("assignedJobId", "==", jobId)),
        ];

        for (const stopQuery of stopQueries) {
          try {
            const linkedStopsSnap = await getDocs(stopQuery);
            linkedStopsSnap.docs.forEach(addStopFromSnapshot);
          } catch (queryError) {
            console.warn("[JobDetailView][loadJobDetails] Could not load linked service stops", queryError);
          }
        }

        const stops = Array.from(stopsById.values()).sort((a, b) => {
          const aDate = a.serviceDate?.toDate?.()?.getTime?.() || new Date(a.serviceDate || 0).getTime();
          const bDate = b.serviceDate?.toDate?.()?.getTime?.() || new Date(b.serviceDate || 0).getTime();
          return bDate - aDate;
        });

        setServiceStops(stops);

        setDescriptionDraft(j.description || "");
        setCustomerPriceInput(((Number(j.rate || 0) / 100) || 0).toFixed(2));
        setSelectedOperationStatus({
          value: j.operationStatus || "Estimate Pending",
          label: j.operationStatus || "Estimate Pending",
        });

        setSelectedBillingStatus({
          value: j.billingStatus || "Draft",
          label: j.billingStatus || "Draft",
        });
        const nextSolutionTier = normalizeIssuePriority(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY);
        setSelectedSolutionTier({
          value: nextSolutionTier,
          label: `${nextSolutionTier} - ${getIssuePriorityLabel(nextSolutionTier)}`,
        });

        setShoppingFormData((prev) => ({
          ...prev,
          jobId: jobId || "",
          jobName: j.internalId || "Job",
        }));

        const customerRef = doc(db, "companies", recentlySelectedCompany, "customers", j.customerId);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const c = customerSnap.data();
          setCustomer((prev) => ({
            ...prev,
            ...c,
            id: c.id || customerSnap.id,
            firstName: c.firstName || "",
            lastName: c.lastName || "",
            phoneNumber: c.phoneNumber || "",
            email: c.email || "",
            billingStreetAddress: c.billingAddress?.streetAddress || "",
            billingCity: c.billingAddress?.city || "",
            billingState: c.billingAddress?.state || "",
            billingZip: c.billingAddress?.zip || "",
            billingNotes: c.billingNotes || "",
            active: c.active,
            verified: c.verified,
          }));
        }

        const locRef = doc(db, "companies", recentlySelectedCompany, "serviceLocations", j.serviceLocationId);
        const locSnap = await getDoc(locRef);
        if (locSnap.exists()) {
          const l = locSnap.data();
          setServiceLocation((prev) => ({
            ...prev,
            id: l.id,
            bodiesOfWaterId: l.bodiesOfWaterId || [],
            gateCode: l.gateCode || "",
            nickName: l.nickName || "",
            streetAddress: l.address?.streetAddress || "",
            city: l.address?.city || "",
            state: l.address?.state || "",
            zip: l.address?.zip || "",
            active: l.active,
          }));
        }
        setSectionLoading((prev) => ({
          ...prev,
          snapshot: false,
        }));

        if (j.serviceLocationId) {
          const [bodySnap, equipmentSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, "companies", recentlySelectedCompany, "bodiesOfWater"),
                where("serviceLocationId", "==", j.serviceLocationId)
              )
            ),
            getDocs(
              query(
                collection(db, "companies", recentlySelectedCompany, "equipment"),
                where("serviceLocationId", "==", j.serviceLocationId)
              )
            ),
          ]);

          setTaskBodyOfWaterList(
            bodySnap.docs.map((docSnap) => {
              const data = docSnap.data();
              const id = data.id || docSnap.id;

              return {
                ...data,
                id,
                value: id,
                label: data.name || "Body Of Water",
              };
            })
          );

          setTaskEquipmentList(
            equipmentSnap.docs.map((docSnap) => {
              const data = docSnap.data();
              const id = data.id || docSnap.id;
              const label = data.name
                ? `${data.name}${data.type ? ` — ${data.type}` : ""}`
                : data.model || "Equipment";

              return {
                ...data,
                id,
                value: id,
                label,
              };
            })
          );
        } else {
          setTaskBodyOfWaterList([]);
          setTaskEquipmentList([]);
        }

        const taskTypeQuery = query(collection(db, "universal", "settings", "taskTypes"));
        const taskTypeSnap = await getDocs(taskTypeQuery);
        setTaskTypeList(jobTaskTypeOptionsFromDocs(taskTypeSnap.docs));

        const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
        const tasksSnap = await getDocs(tasksRef);
        const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
        setTaskList(tasks);

        const itemsRef = query(
          collection(db, "companies", recentlySelectedCompany, "shoppingList"),
          where("jobId", "==", jobId)
        );
        const itemsSnap = await getDocs(itemsRef);
        const items = itemsSnap.docs.map(withFirestoreDocId);
        setShoppingList(items);

        const companyUsersQ = query(
          collection(db, "companies", recentlySelectedCompany, "companyUsers"),
          orderBy("firstName")
        );
        const companyUsersSnap = await getDocs(companyUsersQ);
        const companyUsers = sortCompanyUsersByName(companyUsersSnap.docs.map((docSnap) => {
          const data = docSnap.data();
          const name = getCompanyUserDisplayName(data, "Unnamed User");

          return {
            ...data,
            id: data.id || docSnap.id,
            userId: data.userId || data.id || docSnap.id,
            userName: data.userName || name,
            name,
            label: name,
            value: data.id || docSnap.id,
          };
        }));
        setCompanyUserList(companyUsers);

        const [
          paySettingsSnap,
          serviceStopTypesSnap,
          workTypesSnap,
          mappingsSnap,
          ratesSnap,
        ] = await Promise.all([
          getDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyServiceStopTypes")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyWorkTypes")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "workTypeMappings")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "technicianRates")),
        ]);

        setPaySettings(paySettingsSnap.exists() ? paySettingsSnap.data() : null);
        setCompanyServiceStopTypes(
          serviceStopTypesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        );
        setCompanyWorkTypes(
          workTypesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        );
        setWorkTypeMappings(
          mappingsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        );
        setTechnicianRates(
          ratesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        );

        const dbItemsQ = query(
          collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
          orderBy("name")
        );
        const dbItemsSnap = await getDocs(dbItemsQ);
        const dbItems = dbItemsSnap.docs.map((docSnap) => buildShoppingDbItemOption(docSnap.data(), docSnap.id));
        setShoppingDbItemList(dbItems);
        setSectionLoading((prev) => ({
          ...prev,
          plannedMaterials: false,
        }));

        await loadJobWorkflowData({
          companyId: recentlySelectedCompany,
          currentJobId: jobId,
          currentTaskList: tasks,
          currentShoppingList: items,
          currentServiceStops: stops,
        });
        setSectionLoading((prev) => ({
          ...prev,
          plannedOverview: false,
          plannedWork: false,
          workOffers: false,
          actual: false,
        }));

      } catch (e) {
        console.error(e);
        setSectionLoading(clearSectionLoadingState());
        toast.error("Failed to load job details");
      } finally {
        setLoading(false);
      }
    })();
  }, [recentlySelectedCompany, jobId]);

  // comments subscription
  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    const commentsRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments");
    const commentsQ = query(commentsRef, orderBy("date", "desc"));

    setCommentsLoading(true);

    const unsub = onSnapshot(
      commentsQ,
      (snap) => {
        const list = snap.docs.map((d) => d.data());
        setComments(list);
        setCommentsLoading(false);
      },
      (err) => {
        console.error(err);
        setCommentsLoading(false);
        toast.error("Failed to load comments");
      }
    );

    return () => unsub();
  }, [recentlySelectedCompany, jobId]);

  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    setSalesAgreementsLoading(true);

    const agreementsQ = query(
      collection(db, salesCollectionNames.agreements),
      where("companyId", "==", recentlySelectedCompany),
      where("sourceType", "==", SalesAgreementSourceType.oneOffJob),
      where("sourceId", "==", jobId)
    );

    const unsub = onSnapshot(
      agreementsQ,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...d.data(), id: d.data().id || d.id }))
          .sort((a, b) => {
            const aDate =
              a.updatedAt?.toDate?.()?.getTime?.() ||
              a.createdAt?.toDate?.()?.getTime?.() ||
              0;
            const bDate =
              b.updatedAt?.toDate?.()?.getTime?.() ||
              b.createdAt?.toDate?.()?.getTime?.() ||
              0;
            return bDate - aDate;
          });

        const activeAgreement =
          list.find((agreement) => agreement.id === selectedSalesAgreementId) ||
          list[0] ||
          null;

        setJobSalesAgreements(list);
        setLinkedSalesAgreement(activeAgreement);
        if (!selectedSalesAgreementId && list.length) {
          setSelectedSalesAgreementId(list[0].id);
        } else if (!list.length) {
          setSelectedSalesAgreementId("");
        }
        setSalesAgreementsLoading(false);
      },
      (err) => {
        console.error(err);
        setSalesAgreementsLoading(false);
        toast.error("Failed to load service agreements");
      }
    );

    return () => unsub();
  }, [recentlySelectedCompany, jobId, selectedSalesAgreementId]);

  // contracts subscription
  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    setContractsLoading(true);

    const contractsRef = query(collection(
      db,
      "contracts"
    )
      , where("senderId", "==", recentlySelectedCompany)
      , where("jobId", "==", jobId));

    let unsub = () => { };

    try {
      const contractsQ = query(contractsRef, orderBy("dateSent", "desc"));

      unsub = onSnapshot(
        contractsQ,
        (snap) => {
          const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
          setContracts(list);
          if (!selectedContractId && list.length) {
            setSelectedContractId(list[0].id);
          }
          setContractsLoading(false);
        },
        (err) => {
          console.error(err);
          setContractsLoading(false);
          toast.error("Failed to load contracts");
        }
      );
    } catch (err) {
      console.error(err);
      setContractsLoading(false);
    }

    return () => unsub();
  }, [recentlySelectedCompany, jobId, selectedContractId]);

  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    setJobHistoryLoading(true);

    const historyQ = query(
      jobHistoryPath(recentlySelectedCompany, jobId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      historyQ,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...d.data(), id: d.data().id || d.id }))
          .sort((a, b) => {
            const aDate = a.createdAt?.toDate?.()?.getTime?.() || Number(a.createdAtMillis || 0);
            const bDate = b.createdAt?.toDate?.()?.getTime?.() || Number(b.createdAtMillis || 0);
            return bDate - aDate;
          });

        setJobHistory(list);
        setJobHistoryLoading(false);
      },
      (err) => {
        console.error(err);
        setJobHistoryLoading(false);
        toast.error("Failed to load job history");
      }
    );

    return () => unsub();
  }, [recentlySelectedCompany, jobId]);

  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    setChangeOrdersLoading(true);

    const changeOrdersQ = query(
      changeOrdersPath(recentlySelectedCompany, jobId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      changeOrdersQ,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...d.data(), id: d.data().id || d.id }))
          .sort((a, b) => {
            const aDate = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const bDate = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return bDate - aDate;
          });

        setChangeOrders(list);
        setChangeOrdersLoading(false);
      },
      (err) => {
        console.error(err);
        setChangeOrdersLoading(false);
        toast.error("Failed to load change orders");
      }
    );

    return () => unsub();
  }, [recentlySelectedCompany, jobId]);

  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    setPlansLoading(true);

    let planRecords = [];
    let legacySolutionRecords = [];
    let plansLoaded = false;
    let legacyLoaded = false;

    const mapPlanSnap = (snap, sourceCollection) =>
      snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          id: data.id || data.planId || data.solutionId || d.id,
          planId: data.planId || data.id || d.id,
          solutionId: data.solutionId || data.id || d.id,
          planTier: normalizeJobPlanTier(data.planTier || data.solutionTier || data.recommendationRank || DEFAULT_JOB_PLAN_TIER),
          planTierLabel: getJobPlanRecommendationLabel(data.planTier || data.solutionTier || data.recommendationRank),
          recommendationRank: normalizeJobPlanTier(data.planTier || data.solutionTier || data.recommendationRank || DEFAULT_JOB_PLAN_TIER),
          recommendationRankLabel: getJobPlanRecommendationLabel(data.planTier || data.solutionTier || data.recommendationRank),
          _sourceCollection: sourceCollection,
        };
      });

    const publishPlans = () => {
      if (!plansLoaded || !legacyLoaded) return;

      const merged = new Map();
      legacySolutionRecords.forEach((record) => merged.set(record.id, record));
      planRecords.forEach((record) => merged.set(record.id, record));
      const list = [...merged.values()].sort((a, b) => {
        const tierSort = normalizeJobPlanTier(a.planTier || a.solutionTier) - normalizeJobPlanTier(b.planTier || b.solutionTier);
        if (tierSort !== 0) return tierSort;
        const aDate = a.createdAt?.toDate?.()?.getTime?.() || Number(a.createdAtMillis || 0);
        const bDate = b.createdAt?.toDate?.()?.getTime?.() || Number(b.createdAtMillis || 0);
        return aDate - bDate;
      });

      setJobPlans(list);
      setPlansLoading(false);
    };

    const unsubPlans = onSnapshot(
      jobPlansPath(recentlySelectedCompany, jobId),
      (snap) => {
        planRecords = mapPlanSnap(snap, "plans");
        plansLoaded = true;
        publishPlans();
      },
      (err) => {
        console.error(err);
        plansLoaded = true;
        setPlansLoading(false);
        toast.error("Failed to load job plans");
      }
    );

    const unsubLegacySolutions = onSnapshot(
      legacyJobSolutionsPath(recentlySelectedCompany, jobId),
      (snap) => {
        legacySolutionRecords = mapPlanSnap(snap, "solutions");
        legacyLoaded = true;
        publishPlans();
      },
      (err) => {
        console.error(err);
        legacyLoaded = true;
        publishPlans();
      }
    );

    return () => {
      unsubPlans();
      unsubLegacySolutions();
    };
  }, [recentlySelectedCompany, jobId]);


  const saveDescription = async () => {
    if (!requireUpdateCurrentJob("update jobs")) return;

    try {
      if (!recentlySelectedCompany || !jobId) return;

      setSavingDescription(true);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      const previousDescription = job.description || "";

      await updateDoc(jobRef, { description: descriptionDraft });
      await recordJobHistory({
        title: "Description updated",
        changes: [
          buildHistoryChange("description", "Description", previousDescription, descriptionDraft),
        ],
      });

      setJob((prev) => ({ ...prev, description: descriptionDraft }));
      toast.success("Description saved");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save description");
    } finally {
      setSavingDescription(false);
    }
  };

  const addJobCommentDocument = async (commentText, {
    resolved = false,
    sourceType = "",
    metadata = {},
  } = {}) => {
    const trimmedComment = String(commentText || "").trim();
    const userId = getUserId();

    if (!trimmedComment || !recentlySelectedCompany || !jobId) return null;

    const id = "comp_wo_com_" + uuidv4();
    const authorName = getAuditUserName();
    const commentRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments", id);

    await setDoc(commentRef, {
      id,
      jobId,
      companyId: recentlySelectedCompany,
      userId,
      userName: authorName,
      authorId: userId,
      authorName,
      date: serverTimestamp(),
      dateMillis: Date.now(),
      comment: trimmedComment,
      resolved,
      sourceType,
      metadata,
    });

    return id;
  };

  const addEstimateAcceptedJobComment = async ({
    title = "Estimate accepted",
    contractId = "",
    salesAgreementId = "",
    readyShoppingItemCount = 0,
  } = {}) => {
    const acceptedByName = getAuditUserName();
    const lines = [
      `${title} by ${acceptedByName}.`,
      contractId ? `Estimate/contract: ${contractId}` : "",
      salesAgreementId ? `Service agreement: ${salesAgreementId}` : "",
      Number(readyShoppingItemCount || 0) ? `Products ready to purchase: ${readyShoppingItemCount}` : "",
    ].filter(Boolean);

    return addJobCommentDocument(lines.join("\n"), {
      resolved: true,
      sourceType: "estimateAccepted",
      metadata: {
        acceptedByUserId: getUserId() || "",
        acceptedByUserName: acceptedByName,
        contractId,
        salesAgreementId,
        readyShoppingItemCount,
      },
    });
  };

  const addComment = async () => {
    try {
      const userId = getUserId();

      if (!userId) return toast.error("Missing userId (not signed in?)");
      if (!newComment.trim()) return toast.error("Write a comment first");
      if (!recentlySelectedCompany || !jobId) return;

      setAddingComment(true);

      const commentId = await addJobCommentDocument(newComment.trim());
      await recordJobHistory({
        eventType: "Comment",
        title: "Comment added",
        description: newComment.trim(),
        metadata: { commentId },
      });

      setNewComment("");
      toast.success("Comment added");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add comment");
    } finally {
      setAddingComment(false);
    }
  };

  const setCommentResolved = async (commentId, resolved) => {
    try {
      if (!recentlySelectedCompany || !jobId) return;

      const commentRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments", commentId);
      await updateDoc(commentRef, { resolved });
      await recordJobHistory({
        eventType: "Comment",
        title: resolved ? "Comment resolved" : "Comment reopened",
        metadata: { commentId },
      });

      toast.success(resolved ? "Marked resolved" : "Re-opened");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update comment");
    }
  };

  const editJob = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;

    try {
      setEdit(true);

      const userQuery = query(collection(db, "companies", recentlySelectedCompany, "companyUsers"));
      const userSnap = await getDocs(userQuery);
      const admins = sortCompanyUsersByName(userSnap.docs.map(buildAdminOption));
      setAdminList(admins);

      const current = admins.find((a) => adminMatchesJob(a, job)) || currentAdminOption(job);
      setSelectedAdmin(current);
      setCustomerPriceInput(((Number(job.rate || 0) / 100) || 0).toFixed(2));
      setSelectedBillingStatus({
        value: job.billingStatus || "Draft",
        label: job.billingStatus || "Draft",
      });
      setSelectedOperationStatus({
        value: job.operationStatus || "Estimate Pending",
        label: job.operationStatus || "Estimate Pending",
      });
      const nextSolutionTier = normalizeIssuePriority(job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY);
      setSelectedSolutionTier({
        value: nextSolutionTier,
        label: `${nextSolutionTier} - ${getIssuePriorityLabel(nextSolutionTier)}`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to enter edit mode");
    }
  };

  const cancelEditJob = () => {
    setEdit(false);
    setSelectedAdmin(null);
    setCustomerPriceInput(((Number(job.rate || 0) / 100) || 0).toFixed(2));
    setSelectedBillingStatus({
      value: job.billingStatus || "Draft",
      label: job.billingStatus || "Draft",
    });
    setSelectedOperationStatus({
      value: job.operationStatus || "Estimate Pending",
      label: job.operationStatus || "Estimate Pending",
    });
    const nextSolutionTier = normalizeIssuePriority(job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY);
    setSelectedSolutionTier({
      value: nextSolutionTier,
      label: `${nextSolutionTier} - ${getIssuePriorityLabel(nextSolutionTier)}`,
    });
  };

  const saveEditChanges = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;

    try {
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

      const updates = {};

      if (
        selectedAdmin?.id &&
        (selectedAdmin.id !== job.adminId || selectedAdmin.name !== job.adminName)
      ) {
        updates.adminId = selectedAdmin.id;
        updates.adminName = selectedAdmin.name;
      }
      if (customerPriceInput !== "" && Number(customerPriceInput) < 0) {
        return toast.error("Customer price cannot be negative");
      }
      const nextRateCents = Math.round(Number(customerPriceInput || 0) * 100);

      if (Number.isFinite(nextRateCents) && nextRateCents !== Number(job.rate || 0)) {
        updates.rate = nextRateCents;
      }

      if (selectedBillingStatus?.value && selectedBillingStatus.value !== (job.billingStatus || "")) {
        updates.billingStatus = selectedBillingStatus.value;
      }

      if (selectedOperationStatus?.value && selectedOperationStatus.value !== (job.operationStatus || "")) {
        updates.operationStatus = selectedOperationStatus.value;
      }

      const resolvedBillingStatus = updates.billingStatus ?? job.billingStatus ?? "";
      if (
        resolvedBillingStatus === JOB_BILLING_STATUS.customerResolved &&
        (updates.operationStatus ?? job.operationStatus) !== JOB_OPERATION_STATUS.finished
      ) {
        updates.operationStatus = JOB_OPERATION_STATUS.finished;
      }

      const nextSolutionTier = normalizeIssuePriority(selectedSolutionTier?.value);
      const currentSolutionTier = normalizeIssuePriority(job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY);
      if (nextSolutionTier !== currentSolutionTier) {
        updates.issuePriorityLevel = nextSolutionTier;
        updates.issuePriorityLabel = getIssuePriorityLabel(nextSolutionTier);
        updates.solutionTier = nextSolutionTier;
        updates.solutionTierLabel = getIssuePriorityLabel(nextSolutionTier);
        updates.priorityLevel = nextSolutionTier;
        updates.priorityLabel = getIssuePriorityLabel(nextSolutionTier);
      }

      if (["Expired", "Rejected", JOB_BILLING_STATUS.customerResolved].includes(updates.billingStatus) && !(job.customerId || customer.id)) {
        return toast.error("Attach a customer before closing this job.");
      }

      if (Object.keys(updates).length) {
        await updateDoc(jobRef, updates);
        let invoicedPurchasedItemCount = 0;
        let invoicedShoppingItemCount = 0;
        if (updates.billingStatus && jobBillingIsInvoiced(updates.billingStatus)) {
          const invoiceId = job.salesInvoiceId || job.invoiceRef || job.invoiceId || "";
          const invoiceType = job.invoiceType || (job.salesInvoiceId ? "salesInvoice" : "job");
          invoicedPurchasedItemCount = await markPurchasedItemsInvoicedForJob({ invoiceId, invoiceType });
          invoicedShoppingItemCount = await markShoppingItemsInvoicedForJob({ invoiceId, invoiceType });
        }
        await recordJobHistory({
          title: "Job details updated",
          changes: [
            buildHistoryChange("adminName", "Admin", job.adminName, updates.adminName ?? job.adminName),
            buildHistoryChange("rate", "Customer Price", moneyFromCents(job.rate), moneyFromCents(updates.rate ?? job.rate)),
            buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", updates.billingStatus ?? job.billingStatus),
            buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", updates.operationStatus ?? job.operationStatus),
            buildHistoryChange("issuePriority", "Issue Priority", getIssuePriorityLabel(job.issuePriorityLevel || job.priorityLevel || job.solutionTier), getIssuePriorityLabel(updates.issuePriorityLevel ?? job.issuePriorityLevel ?? job.priorityLevel ?? job.solutionTier)),
          ],
          metadata: invoicedPurchasedItemCount || invoicedShoppingItemCount
            ? { invoicedPurchasedItemCount, invoicedShoppingItemCount }
            : {},
        });

        if (updates.billingStatus === "Expired") {
          await upsertExpiredJobRecord({
            previousBillingStatus: job.billingStatus || "",
            previousOperationStatus: job.operationStatus || "",
            nextOperationStatus: updates.operationStatus ?? job.operationStatus ?? "",
            reason: "Job expired from edit status",
            priorityLevel: updates.issuePriorityLevel ?? updates.solutionTier ?? job.issuePriorityLevel ?? job.priorityLevel ?? job.solutionTier ?? DEFAULT_ISSUE_PRIORITY,
          });
        }

        if (updates.billingStatus === "Rejected") {
          await upsertSuggestedWorkRecord({
            billingStatus: "Rejected",
            previousBillingStatus: job.billingStatus || "",
            previousOperationStatus: job.operationStatus || "",
            nextOperationStatus: updates.operationStatus ?? job.operationStatus ?? "",
            reason: "Job rejected from edit status",
            priorityLevel: updates.issuePriorityLevel ?? updates.solutionTier ?? job.issuePriorityLevel ?? job.priorityLevel ?? job.solutionTier ?? DEFAULT_ISSUE_PRIORITY,
          });
        }

        if (updates.billingStatus === JOB_BILLING_STATUS.customerResolved) {
          await upsertCustomerResolvedJobRecord({
            previousBillingStatus: job.billingStatus || "",
            previousOperationStatus: job.operationStatus || "",
            resolvedAtMillis: Date.now(),
            resolutionNote: "Customer took care of the issue from job edit status.",
          });
        }

        toast.success("Saved");
      } else {
        toast.success("No changes");
      }

      const jobSnap = await getDoc(jobRef);
      if (jobSnap.exists()) {
        const j = jobSnap.data();

        setJob((prev) => ({
          ...prev,
          adminId: j.adminId || "",
          adminName: j.adminName || "",
          billingStatus: j.billingStatus || "",
          operationStatus: j.operationStatus || "",
          issuePriorityLevel: normalizeIssuePriority(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY),
          issuePriorityLabel: getIssuePriorityLabel(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY),
          solutionTier: normalizeIssuePriority(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY),
          solutionTierLabel: getIssuePriorityLabel(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY),
          rate: Number(j.rate || 0),
        }));

        setCustomerPriceInput(((Number(j.rate || 0) / 100) || 0).toFixed(2));
        setSelectedBillingStatus({
          value: j.billingStatus || "Draft",
          label: j.billingStatus || "Draft",
        });
        setSelectedOperationStatus({
          value: j.operationStatus || "Estimate Pending",
          label: j.operationStatus || "Estimate Pending",
        });
        const refreshedSolutionTier = normalizeIssuePriority(j.issuePriorityLevel || j.priorityLevel || j.solutionTier || DEFAULT_ISSUE_PRIORITY);
        setSelectedSolutionTier({
          value: refreshedSolutionTier,
          label: `${refreshedSolutionTier} - ${getIssuePriorityLabel(refreshedSolutionTier)}`,
        });
      }

      setEdit(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save changes");
    }
  };

  const cancelJob = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!edit) {
      toast.error("Click Edit before canceling this job.");
      return;
    }

    try {
      const previousBillingStatus = job.billingStatus || "";
      const previousOperationStatus = job.operationStatus || "";
      const nextOperationStatus = suggestOperationForBilling(
        "Expired",
        job.operationStatus || "Estimate Pending"
      );
      const nextSolutionTier = normalizeIssuePriority(selectedSolutionTier?.value || job.issuePriorityLevel || job.priorityLevel || job.solutionTier);
      const nextSolutionTierLabel = getIssuePriorityLabel(nextSolutionTier);
      if (!(job.customerId || customer.id)) {
        return toast.error("Attach a customer before canceling this job.");
      }

      const ok = isJobExpired
        ? true
        : await appConfirm({
          title: "Cancel Job",
          message: "Cancel this job? The job will not be deleted. Billing status will be set to Expired and the scope will be copied to Suggested Work.",
          confirmLabel: "Cancel Job",
          variant: "danger",
        });
      if (!ok) return;

      setExpiringJob(true);
      const nowMillis = Date.now();
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      const currentSolutionTier = normalizeIssuePriority(job.issuePriorityLevel || job.priorityLevel || job.solutionTier || DEFAULT_ISSUE_PRIORITY);

      if (!isJobExpired || job.operationStatus !== nextOperationStatus || currentSolutionTier !== nextSolutionTier) {
        await updateDoc(jobRef, {
          billingStatus: "Expired",
          operationStatus: nextOperationStatus,
          issuePriorityLevel: nextSolutionTier,
          issuePriorityLabel: nextSolutionTierLabel,
          solutionTier: nextSolutionTier,
          solutionTierLabel: nextSolutionTierLabel,
          priorityLevel: nextSolutionTier,
          priorityLabel: nextSolutionTierLabel,
          updatedAt: serverTimestamp(),
          updatedAtMillis: nowMillis,
        });
      }

      await upsertExpiredJobRecord({
        previousBillingStatus,
        previousOperationStatus,
        nextOperationStatus,
        expiredAtMillis: nowMillis,
        reason: "Job canceled from job detail",
        priorityLevel: nextSolutionTier,
      });

      await recordJobHistory({
        eventType: "Job Canceled",
        title: isJobExpired ? "Expired job customer note refreshed" : "Job canceled and marked expired",
        description: "The job was preserved and copied to suggested work.",
        changes: isJobExpired
          ? []
          : [
            buildHistoryChange("billingStatus", "Billing Status", previousBillingStatus || "—", "Expired"),
            buildHistoryChange("operationStatus", "Operation Status", previousOperationStatus || "—", nextOperationStatus),
            buildHistoryChange("issuePriority", "Issue Priority", getIssuePriorityLabel(job.issuePriorityLevel || job.priorityLevel || job.solutionTier), nextSolutionTierLabel),
          ],
        metadata: {
          customerId: job.customerId || customer.id || "",
          customerExpiredJobId: jobId,
          suggestedWorkId: suggestedWorkIdForSource("job", jobId),
        },
        severity: "warning",
      });

      setJob((prev) => ({
        ...prev,
        billingStatus: "Expired",
        operationStatus: nextOperationStatus,
        issuePriorityLevel: nextSolutionTier,
        issuePriorityLabel: nextSolutionTierLabel,
        solutionTier: nextSolutionTier,
        solutionTierLabel: nextSolutionTierLabel,
        updatedAt: new Date(nowMillis),
        updatedAtMillis: nowMillis,
      }));
      setSelectedBillingStatus({ value: "Expired", label: "Expired" });
      setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
      setSelectedSolutionTier({ value: nextSolutionTier, label: `${nextSolutionTier} - ${nextSolutionTierLabel}` });
      toast.success(isJobExpired ? "Expired job note refreshed" : "Job canceled");
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Failed to cancel job");
    } finally {
      setExpiringJob(false);
    }
  };

  const markCustomerTookCareOfJob = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (resolvingCustomerHandledJob) return;
    if (!edit) {
      toast.error("Click Edit before closing this job.");
      return;
    }
    if (!(job.customerId || customer.id)) {
      toast.error("Attach a customer before closing this job.");
      return;
    }

    const promptedNote = await appPrompt({
      title: "Customer Took Care Of It",
      message: "Add an optional note about what the customer handled. Leave the default if no extra detail is needed.",
      inputLabel: "Resolution note",
      defaultValue: "Customer took care of the issue.",
      confirmLabel: "Close Job",
      required: false,
    });
    if (promptedNote === null) return;

    const resolutionNote = String(promptedNote || "").trim() || "Customer took care of the issue.";

    try {
      setResolvingCustomerHandledJob(true);

      const previousBillingStatus = job.billingStatus || "";
      const previousOperationStatus = job.operationStatus || "";
      const nowMillis = Date.now();
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

      if (!isJobCustomerResolved || job.operationStatus !== JOB_OPERATION_STATUS.finished) {
        await updateDoc(jobRef, {
          billingStatus: JOB_BILLING_STATUS.customerResolved,
          operationStatus: JOB_OPERATION_STATUS.finished,
          customerResolutionStatus: "customerTookCareOfIt",
          customerResolutionNote: resolutionNote,
          customerResolvedAt: serverTimestamp(),
          customerResolvedAtMillis: nowMillis,
          customerResolvedByUserId: getUserId() || "",
          customerResolvedByUserName: getAuditUserName(),
          updatedAt: serverTimestamp(),
          updatedAtMillis: nowMillis,
        });
      }

      await upsertCustomerResolvedJobRecord({
        previousBillingStatus,
        previousOperationStatus,
        resolvedAtMillis: nowMillis,
        resolutionNote,
      });

      await recordJobHistory({
        eventType: "Customer Resolved",
        title: isJobCustomerResolved ? "Customer resolved note refreshed" : "Customer took care of it",
        description: "The job was preserved and closed because the customer took care of the issue.",
        changes: isJobCustomerResolved
          ? []
          : [
            buildHistoryChange("billingStatus", "Billing Status", previousBillingStatus || "—", JOB_BILLING_STATUS.customerResolved),
            buildHistoryChange("operationStatus", "Operation Status", previousOperationStatus || "—", JOB_OPERATION_STATUS.finished),
          ],
        metadata: {
          customerId: job.customerId || customer.id || "",
          customerResolvedJobId: jobId,
          outcome: "customerTookCareOfIt",
          resolutionNote,
        },
        severity: "success",
      });

      setJob((prev) => ({
        ...prev,
        billingStatus: JOB_BILLING_STATUS.customerResolved,
        operationStatus: JOB_OPERATION_STATUS.finished,
        customerResolutionStatus: "customerTookCareOfIt",
        customerResolutionNote: resolutionNote,
        customerResolvedAt: new Date(nowMillis),
        customerResolvedAtMillis: nowMillis,
        updatedAt: new Date(nowMillis),
        updatedAtMillis: nowMillis,
      }));
      setSelectedBillingStatus({
        value: JOB_BILLING_STATUS.customerResolved,
        label: JOB_BILLING_STATUS.customerResolved,
      });
      setSelectedOperationStatus({
        value: JOB_OPERATION_STATUS.finished,
        label: JOB_OPERATION_STATUS.finished,
      });

      toast.success(isJobCustomerResolved ? "Customer resolution note refreshed" : "Job closed as customer resolved");
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Failed to close job as customer resolved");
    } finally {
      setResolvingCustomerHandledJob(false);
    }
  };

  const deleteJob = async (e) => {
    e.preventDefault();
    if (!requirePermission("26", "delete jobs")) return;
    if (!edit) {
      toast.error("Click Edit before deleting this job.");
      return;
    }
    if (!recentlySelectedCompany || !jobId) return;

    const ok = await appConfirm({
      title: "Delete Job",
      message: [
        "Delete this job permanently?",
        "",
        "Cancel, Rejected, or Customer Resolved keeps the job in history because the issue still matters.",
        "Delete removes the job record and job-owned notes, tasks, planned stops, change orders, and planned product rows. Use delete only for accidental or duplicate jobs.",
      ].join("\n"),
      confirmLabel: "Continue",
      variant: "danger",
    });

    if (!ok) return;

    const confirmation = await appPrompt({
      title: "Delete Job",
      message: 'Type "DELETE" to permanently delete this job.',
      inputLabel: 'Type DELETE to confirm',
      confirmLabel: "Delete Job",
      variant: "danger",
    });
    if (confirmation !== "DELETE") {
      toast.error("Job delete canceled");
      return;
    }

    try {
      setDeletingJob(true);

      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      const jobOwnedCollections = [
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "history"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "changeOrders"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plans"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "solutions"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plannedServiceStops"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "laborLineItems"),
        collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "workOfferRefs"),
      ];

      await Promise.all(jobOwnedCollections.map((collectionRef) => deleteQueryDocs(collectionRef)));

      await Promise.all([
        deleteQueryDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("jobId", "==", jobId))),
        deleteQueryDocs(query(workOffersPath(recentlySelectedCompany), where("jobId", "==", jobId))),
      ]);

      await deleteDoc(jobRef);

      toast.success("Job deleted");
      navigate("/company/jobs/operations", { replace: true });
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Failed to delete job");
    } finally {
      setDeletingJob(false);
    }
  };

  const openCreateTemplateModal = () => {
    if (!requireUpdateCurrentJob("update jobs")) return;

    const defaultName = [job.type, job.internalId].filter(Boolean).join(" - ") || "Job Template";
    setTemplateName(defaultName);
    setShowCreateTemplateModal(true);
  };

  const closeCreateTemplateModal = () => {
    if (savingJobTemplate) return;
    setShowCreateTemplateModal(false);
    setTemplateName("");
  };

  const saveJobAsTemplate = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;

    const nextTemplateName = templateName.trim();
    if (!nextTemplateName) return toast.error("Add a template name");
    if (!recentlySelectedCompany || !jobId) return;

    try {
      setSavingJobTemplate(true);

      const templateId = "comp_job_template_" + uuidv4();
      const now = new Date();
      const createdByUserId = getUserId() || "";
      const createdByUserName = getAuditUserName();
      const taskIdMap = Object.fromEntries(
        (taskList || []).map((task) => [task.id, "comp_job_template_task_" + uuidv4()])
      );
      const plannedStopIdMap = Object.fromEntries(
        (plannedServiceStops || []).map((plannedStop) => [plannedStop.id, "comp_job_template_plan_stop_" + uuidv4()])
      );
      const normalizedTemplateLaborLines = normalizeJobLaborLineItems(laborLineItems);
      const defaultTemplatePriceCents = plannedEstimatePriceCents || cents(job.rate);

      const templateRef = doc(db, "companies", recentlySelectedCompany, "jobTemplates", templateId);
      await setDoc(templateRef, {
        id: templateId,
        companyId: recentlySelectedCompany,
        name: nextTemplateName,
        description: job.description || "",
        jobType: job.type || "",
        type: job.type || "",
        jobTypeImage: job.jobTypeImage || "",
        defaultRateCents: defaultTemplatePriceCents,
        defaultLaborCostCents: plannedTotalLaborCents || cents(job.laborCost),
        defaultLaborPriceCents: plannedLaborPriceCents,
        defaultMaterialCostCents: plannedMaterialCostCents,
        defaultMaterialPriceCents: plannedMaterialPriceCents,
        taskCount: taskList.length,
        plannedStopCount: plannedServiceStops.length,
        shoppingItemCount: shoppingList.length,
        laborLineCount: normalizedTemplateLaborLines.length,
        color: job.color || "",
        isActive: true,
        locked: false,
        sourceJobId: jobId,
        sourceJobInternalId: job.internalId || "",
        sourceCustomerId: job.customerId || "",
        sourceCustomerName: job.customerName || "",
        createdAt: serverTimestamp(),
        createdAtMillis: now.getTime(),
        createdByUserId,
        createdByUserName,
        updatedAt: serverTimestamp(),
        updatedAtMillis: now.getTime(),
      });

      const taskWrites = (taskList || []).map((task, index) => {
        const templateTaskId = taskIdMap[task.id] || "comp_job_template_task_" + uuidv4();
        return setDoc(
          doc(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "tasks", templateTaskId),
          {
            id: templateTaskId,
            companyId: recentlySelectedCompany,
            templateId,
            name: task.name || task.description || "Task",
            type: task.type || "",
            description: task.description || "",
            contractedRate: cents(task.contractedRate),
            billingLaborPriceCents: getTaskBillingLaborPriceCents(task),
            estimatedTime: Number(task.estimatedTime || 0),
            customerApproval: Boolean(task.customerApproval),
            equipmentId: task.equipmentId || "",
            serviceLocationId: "",
            bodyOfWaterId: "",
            dataBaseItemId: task.dataBaseItemId || "",
            sortOrder: Number(task.sortOrder ?? index),
            sourceTaskId: task.id || "",
          }
        );
      });

      const plannedStopWrites = (plannedServiceStops || []).map((plannedStop, index) => {
        const plannedStopId = plannedStopIdMap[plannedStop.id] || "comp_job_template_plan_stop_" + uuidv4();
        const sourceTaskIds = Array.isArray(plannedStop.taskIds) ? plannedStop.taskIds : [];
        const taskTemplateIds = sourceTaskIds.map((taskId) => taskIdMap[taskId]).filter(Boolean);

        return setDoc(
          doc(
            db,
            "companies",
            recentlySelectedCompany,
            "jobTemplates",
            templateId,
            "plannedServiceStops",
            plannedStopId
          ),
          {
            id: plannedStopId,
            companyId: recentlySelectedCompany,
            templateId,
            name: plannedStop.name || plannedStop.serviceStopTypeName || "Planned Stop",
            description: plannedStop.description || "",
            serviceStopTypeId: plannedStop.serviceStopTypeId || "",
            serviceStopTypeName: plannedStop.serviceStopTypeName || "",
            serviceStopTypeImage: plannedStop.serviceStopTypeImage || "",
            serviceStopTypeUseCaseRawValue: plannedStop.serviceStopTypeUseCaseRawValue || "",
            estimatedMinutes: Number(plannedStop.estimatedMinutes || 0),
            sortOrder: Number(plannedStop.sortOrder ?? index),
            taskTemplateIds,
            taskIds: taskTemplateIds,
            plannedLaborCostCents:
              plannedStop.plannedLaborCostCents !== undefined && plannedStop.plannedLaborCostCents !== null
                ? cents(plannedStop.plannedLaborCostCents)
                : null,
            plannedLaborNotes: plannedStop.plannedLaborNotes || "",
            sourcePlannedStopId: plannedStop.id || "",
          }
        );
      });

      const laborLineWrites = normalizedTemplateLaborLines.map((line, index) => {
        const templateLaborLineId = "comp_job_template_labor_line_" + uuidv4();
        const taskTemplateIds = getLaborLineTaskIds(line).map((taskId) => taskIdMap[taskId]).filter(Boolean);
        const plannedServiceStopTemplateIds = getLaborLinePlannedStopIds(line)
          .map((plannedStopId) => plannedStopIdMap[plannedStopId])
          .filter(Boolean);

        return setDoc(
          doc(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "laborLineItems", templateLaborLineId),
          {
            id: templateLaborLineId,
            laborLineId: templateLaborLineId,
            companyId: recentlySelectedCompany,
            templateId,
            name: line.name || `Labor ${index + 1}`,
            description: line.description || "",
            quantity: Number(line.quantity || 1),
            unitPriceCents: cents(line.unitPriceCents),
            totalPriceCents: cents(line.totalPriceCents),
            internalCostCents: cents(line.internalCostCents),
            taskTemplateIds,
            taskIds: taskTemplateIds,
            laborLineTaskIds: taskTemplateIds,
            plannedServiceStopTemplateIds,
            plannedServiceStopIds: plannedServiceStopTemplateIds,
            laborLinePlannedServiceStopIds: plannedServiceStopTemplateIds,
            salesItemType: line.salesItemType || SalesCatalogItemType.labor,
            billingBehavior: line.billingBehavior || SalesCatalogBillingBehavior.oneTime,
            sourceType: line.sourceType || SalesCatalogSourceType.manual,
            sortOrder: Number(line.sortOrder ?? index),
            sourceLaborLineId: line.id || "",
          }
        );
      });

      const shoppingWrites = (shoppingList || []).map((item, index) => {
        const templateItemId = "comp_job_template_shop_item_" + uuidv4();
        const plannedTotalPriceCents = getShoppingPlannedTotalPriceCents(item);

        return setDoc(
          doc(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "shoppingItems", templateItemId),
          {
            id: templateItemId,
            companyId: recentlySelectedCompany,
            templateId,
            subCategory: item.subCategory || item.itemType || "Custom",
            name: getMaterialName(item),
            description: item.description || "",
            quantity: item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "1",
            dbItemId: item.dbItemId || item.itemId || "",
            genericItemId: item.genericItemId || "",
            plannedUnitCostCents: item.plannedUnitCostCents ?? item.cost ?? null,
            plannedUnitPriceCents: item.plannedUnitPriceCents ?? item.price ?? null,
            plannedTotalCostCents: getShoppingPlannedTotalCostCents(item),
            plannedTotalPriceCents,
            billable: plannedTotalPriceCents > 0,
            sortOrder: Number(item.sortOrder ?? index),
            sourceShoppingListItemId: item.id || "",
          }
        );
      });

      await Promise.all([...taskWrites, ...plannedStopWrites, ...laborLineWrites, ...shoppingWrites]);

      await recordJobHistory({
        eventType: "Template",
        title: `Job template created: ${nextTemplateName}`,
        description: `Created from ${job.internalId || job.type || "this job"}.`,
        changes: [
          buildHistoryChange("tasks", "Tasks", "—", String(taskList.length)),
          buildHistoryChange("plannedServiceStops", "Planned Stops", "—", String(plannedServiceStops.length)),
          buildHistoryChange("laborLineItems", "Service Lines", "—", String(normalizedTemplateLaborLines.length)),
          buildHistoryChange("shoppingItems", "Planned Products", "—", String(shoppingList.length)),
        ],
        metadata: {
          templateId,
          templateName: nextTemplateName,
          taskCount: taskList.length,
          plannedStopCount: plannedServiceStops.length,
          laborLineCount: normalizedTemplateLaborLines.length,
          materialCount: shoppingList.length,
        },
        severity: "success",
      });

      toast.success("Job template created");
      setShowCreateTemplateModal(false);
      setTemplateName("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create job template");
    } finally {
      setSavingJobTemplate(false);
    }
  };

  const handleSelectedOperationStatus = (opt) => {
    setSelectedOperationStatus(opt);
    const nextBillingStatus = suggestBillingForOperation(
      opt.value,
      selectedBillingStatus?.value || job.billingStatus || "Draft"
    );
    setSelectedBillingStatus({ value: nextBillingStatus, label: nextBillingStatus });
  };

  const handleSelectedBillingStatus = (opt) => {
    setSelectedBillingStatus(opt);
    const nextBillingStatus = opt?.value;
    if (!nextBillingStatus || nextBillingStatus === "Estimate") return;

    const nextOperationStatus = suggestOperationForBilling(
      nextBillingStatus,
      selectedOperationStatus?.value || job.operationStatus || "Estimate Pending"
    );
    setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
  };
  const getPayrollLineAmountCents = (line) => {
    return cents(
      line.totalAmountCents ??
      line.amountCents ??
      line.totalCents ??
      line.payCents ??
      line.lineTotalCents ??
      0
    );
  };

  const getPayrollLineTitle = (line) => {
    return (
      line.taskName ||
      line.workTypeName ||
      line.serviceStopTypeName ||
      line.name ||
      "Payroll Line Item"
    );
  };

  const getPayrollLineWorker = (line) => {
    return line.technicianName || line.workerName || line.userName || "—";
  };

  const renderActualPayrollLineCard = (line) => {
    const amountCents = getPayrollLineAmountCents(line);

    return (
      <div
        key={line.id}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Payroll Line
            </p>

            <p className="mt-1 text-base font-bold text-gray-800">
              {getPayrollLineTitle(line)}
            </p>

            <p className="mt-1 text-sm text-gray-600">
              Worker: <span className="font-semibold">{getPayrollLineWorker(line)}</span>
            </p>
          </div>

          <span className="px-3 py-1 text-xs font-bold rounded-full border bg-green-50 text-green-700 border-green-200">
            {moneyFromCents(amountCents)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Pay Basis
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {line.payBasis || line.rateType || "—"}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Source
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {line.sourceType || line.category || "—"}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Status
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {line.status || "—"}
            </p>
          </div>
        </div>

        {line.notes && (
          <p className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
            {line.notes}
          </p>
        )}
      </div>
    );
  };
  const clearLaborLineEditor = ({ force = false } = {}) => {
    if (savingLaborLine && !force) return;
    setNewLaborLine(false);
    setEditingLaborLineId("");
    setLaborLineForm(EMPTY_LABOR_LINE_FORM);
  };

  const showNewLaborLineItem = () => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    setNewTask(false);
    setShowServiceCatalogPicker(false);
    setEditingTaskId("");
    setEditingLaborLineId("");
    setLaborLineForm(buildSuggestedLaborLineForm());
    setNewLaborLine(true);
  };

  const toggleServiceCatalogPicker = () => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    clearLaborLineEditor({ force: true });
    clearNewTask({ preventDefault: () => { } });
    setEditingTaskId("");
    setNewTaskLaborLineId("");
    setNewPlannedStopLaborLineId("");
    setShowServiceCatalogPicker((current) => !current);
  };

  const editGeneratedLaborLine = (line) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    setNewTask(false);
    setEditingTaskId("");
    setEditingLaborLineId("");
    setLaborLineForm({
      ...EMPTY_LABOR_LINE_FORM,
      name: line.name || "Labor",
      description: "",
      quantity: String(line.quantity || 1),
      unitPrice: dollarsFromCents(line.unitPriceCents ?? line.totalPriceCents),
      internalCost: dollarsFromCents(line.internalCostCents),
      taskIds: laborLineArray(line.taskIds),
      plannedServiceStopIds: laborLineArray(line.plannedServiceStopIds),
    });
    setNewLaborLine(true);
  };

  const startLaborLineEdit = (line) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    setNewTask(false);
    setEditingTaskId("");
    setNewLaborLine(false);
    setEditingLaborLineId(line.id);
    setLaborLineForm(buildLaborLineFormFromLine(line));
  };

  const updateLaborLineForm = (field, value) => {
    setLaborLineForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const toggleLaborLineTask = (taskId) => {
    setLaborLineForm((prev) => {
      const taskIds = new Set(prev.taskIds || []);
      if (taskIds.has(taskId)) {
        taskIds.delete(taskId);
      } else {
        taskIds.add(taskId);
      }

      return {
        ...prev,
        taskIds: Array.from(taskIds),
      };
    });
  };

  const toggleLaborLinePlannedStop = (plannedStopId) => {
    setLaborLineForm((prev) => {
      const plannedServiceStopIds = new Set(prev.plannedServiceStopIds || []);
      if (plannedServiceStopIds.has(plannedStopId)) {
        plannedServiceStopIds.delete(plannedStopId);
      } else {
        plannedServiceStopIds.add(plannedStopId);
      }

      return {
        ...prev,
        plannedServiceStopIds: Array.from(plannedServiceStopIds),
      };
    });
  };

  const syncLaborLineFormToScopeTotals = () => {
    const totals = laborLineScopeTotals(laborLineForm);
    setLaborLineForm((prev) => ({
      ...prev,
      unitPrice: dollarsFromCents(totals.priceCents),
      internalCost: dollarsFromCents(totals.costCents),
    }));
  };

  const saveLaborLineItem = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!recentlySelectedCompany || !jobId) return toast.error("Missing job context.");

    const name = laborLineForm.name.trim();
    const quantity = Number(laborLineForm.quantity || 1);
    const unitPriceCents = centsFromCurrencyInput(laborLineForm.unitPrice);
    const internalCostCents = centsFromCurrencyInput(laborLineForm.internalCost);

    if (!name) return toast.error("Add a service line name.");
    if (!Number.isFinite(quantity) || quantity <= 0) return toast.error("Quantity must be greater than 0.");
    if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) return toast.error("Service price cannot be negative.");
    if (!Number.isFinite(internalCostCents) || internalCostCents < 0) return toast.error("Service cost cannot be negative.");

    const existingLine = (laborLineItems || []).find((line) => line.id === editingLaborLineId);
    const nowMillis = Date.now();
    const lineId = existingLine?.id || `comp_job_labor_line_${uuidv4()}`;
    const payload = {
      ...(existingLine || {}),
      id: lineId,
      laborLineId: lineId,
      companyId: recentlySelectedCompany,
      jobId,
      name,
      description: laborLineForm.description.trim(),
      quantity,
      unitPriceCents,
      totalPriceCents: Math.round(unitPriceCents * quantity),
      internalCostCents,
      taskIds: laborLineArray(laborLineForm.taskIds),
      laborLineTaskIds: laborLineArray(laborLineForm.taskIds),
      plannedServiceStopIds: laborLineArray(laborLineForm.plannedServiceStopIds),
      laborLinePlannedServiceStopIds: laborLineArray(laborLineForm.plannedServiceStopIds),
      salesItemType: SalesCatalogItemType.labor,
      billingBehavior: SalesCatalogBillingBehavior.oneTime,
      sourceType: SalesCatalogSourceType.manual,
      sortOrder: existingLine ? Number(existingLine.sortOrder || 0) : (laborLineItems || []).length,
      createdAtMillis: existingLine?.createdAtMillis || nowMillis,
      createdByUserId: existingLine?.createdByUserId || getUserId() || "",
      createdByUserName: existingLine?.createdByUserName || getAuditUserName(),
      updatedAtMillis: nowMillis,
      updatedByUserId: getUserId() || "",
      updatedByUserName: getAuditUserName(),
    };
    const nextItems = existingLine
      ? (laborLineItems || []).map((line) => (line.id === existingLine.id ? payload : line))
      : [...(laborLineItems || []), payload];

    try {
      setSavingLaborLine(true);
      const persistedItems = await persistLaborLineItems(nextItems);

      await recordJobHistory({
        eventType: "Service Line",
        title: `${existingLine ? "Service line updated" : "Service line added"}: ${name}`,
        description: payload.description,
        changes: [
          buildHistoryChange("totalPriceCents", "Customer Price", existingLine ? moneyFromCents(existingLine.totalPriceCents) : "—", moneyFromCents(payload.totalPriceCents)),
          buildHistoryChange("internalCostCents", "Internal Cost", existingLine ? moneyFromCents(existingLine.internalCostCents) : "—", moneyFromCents(payload.internalCostCents)),
          buildHistoryChange("taskIds", "Linked Tasks", existingLine ? String(getLaborLineTaskIds(existingLine).length) : "—", String(payload.taskIds.length)),
          buildHistoryChange("plannedServiceStopIds", "Linked Planned Stops", existingLine ? String(getLaborLinePlannedStopIds(existingLine).length) : "—", String(payload.plannedServiceStopIds.length)),
        ],
        metadata: {
          laborLineId: lineId,
          taskIds: payload.taskIds,
          plannedServiceStopIds: payload.plannedServiceStopIds,
          laborLineCount: persistedItems.length,
        },
        severity: existingLine ? "info" : "success",
      });

      clearLaborLineEditor({ force: true });
      toast.success(existingLine ? "Updated service line" : "Added service line");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save service line");
    } finally {
      setSavingLaborLine(false);
    }
  };

  const catalogTemplateNumber = (...values) => {
    const found = values.find((value) => value !== undefined && value !== null && value !== "");
    const parsed = Number(found || 0);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  };

  const catalogTemplateCents = (...values) => Math.round(catalogTemplateNumber(...values));

  const catalogTemplateMinutes = (template = {}) => catalogTemplateNumber(
    template.estimatedMinutes,
    template.estimatedTime,
    template.minutes,
    template.durationMinutes,
    template.duration
  );

  const catalogTemplateType = (template = {}) => (
    template.type ||
    template.taskType ||
    template.taskTypeName ||
    taskTypeList?.[0]?.value ||
    "General"
  );

  const addCatalogServiceToJob = async (catalogItem) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!recentlySelectedCompany || !jobId || !catalogItem?.id) return toast.error("Missing job context.");

    const serviceName = String(catalogItem.name || "").trim();
    if (!serviceName) return toast.error("Catalog service needs a name.");

    setAddingCatalogServiceId(catalogItem.id);

    try {
      const lineId = `comp_job_labor_line_${uuidv4()}`;
      const nowMillis = Date.now();
      const taskTemplates = getCatalogServiceTaskTemplates(catalogItem);
      const createdTasks = taskTemplates
        .map((template, index) => {
          const taskName = String(
            template.name ||
            template.title ||
            template.description ||
            `Task ${index + 1}`
          ).trim();
          if (!taskName) return null;

          const taskId = `comp_wo_tas_${uuidv4()}`;
          const laborCostCents = catalogTemplateCents(
            template.laborCostCents,
            template.contractRateCents,
            template.contractedRateCents,
            template.costCents
          );
          const billingLaborPriceCents = catalogTemplateCents(
            template.billingLaborPriceCents,
            template.unitAmountCents,
            template.priceCents,
            template.rateCents
          );

          return {
            id: taskId,
            name: taskName,
            description: template.description || "",
            type: catalogTemplateType(template),
            contractedRate: laborCostCents,
            billingLaborPriceCents,
            estimatedTime: catalogTemplateMinutes(template),
            status: "Unassigned",
            customerApproval: Boolean(template.customerApproval || template.customerApprovalRequired),
            actualTime: 0,
            workerId: "",
            workerType: "Not Assigned",
            workerName: "",
            laborContractId: "",
            serviceStopId: {
              id: "",
              internalId: "",
            },
            equipmentId: "",
            serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
            bodyOfWaterId: "",
            dataBaseItemId: "",
            shoppingListItemId: "",
            shoppingListItemIds: [],
            customerApprovalRequired: Boolean(template.customerApproval || template.customerApprovalRequired),
            customerApprovalStatus: template.customerApproval || template.customerApprovalRequired ? "pending" : "notRequired",
            customerApprovalRequestId: "",
            sourceType: "serviceCatalog",
            sourceCatalogItemId: catalogItem.id,
            sourceCatalogItemName: serviceName,
            sourceCatalogTaskTemplateId: template.id || template.templateId || "",
            laborLineId: lineId,
            laborLineIds: [lineId],
            sortOrder: (taskList || []).length + index,
            createdAtMillis: nowMillis,
            createdByUserId: getUserId() || "",
            createdByUserName: getAuditUserName(),
            updatedAtMillis: nowMillis,
            updatedByUserId: getUserId() || "",
            updatedByUserName: getAuditUserName(),
          };
        })
        .filter(Boolean);

      await Promise.all(
        createdTasks.map((task) => (
          setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), task)
        ))
      );

      const quantity = Math.max(Number(catalogItem.defaultQuantity || 1), 1);
      const taskPriceCents = createdTasks.reduce((total, task) => total + cents(task.billingLaborPriceCents), 0);
      const taskCostCents = createdTasks.reduce((total, task) => total + cents(task.contractedRate), 0);
      const unitPriceCents = cents(catalogItem.unitAmountCents) || taskPriceCents;
      const internalCostCents = cents(catalogItem.unitCostCents) || taskCostCents;
      const taskIds = createdTasks.map((task) => task.id);
      const catalogLine = {
        id: lineId,
        laborLineId: lineId,
        companyId: recentlySelectedCompany,
        jobId,
        name: serviceName,
        description: catalogItem.description || "",
        quantity,
        unitPriceCents,
        totalPriceCents: Math.round(unitPriceCents * quantity),
        internalCostCents,
        taskIds,
        laborLineTaskIds: taskIds,
        plannedServiceStopIds: [],
        laborLinePlannedServiceStopIds: [],
        salesItemType: catalogItem.type || SalesCatalogItemType.service,
        billingBehavior: catalogItem.billingBehavior || SalesCatalogBillingBehavior.oneTime,
        sourceType: catalogItem.sourceType || SalesCatalogSourceType.manual,
        sourceId: catalogItem.sourceId || "",
        catalogItemId: catalogItem.id,
        salesCatalogItemId: catalogItem.id,
        catalogItemName: serviceName,
        stripeProductId: catalogItem.stripeProductId || "",
        stripePriceId: catalogItem.stripePriceId || "",
        sortOrder: (laborLineItems || []).length,
        createdAtMillis: nowMillis,
        createdByUserId: getUserId() || "",
        createdByUserName: getAuditUserName(),
        updatedAtMillis: nowMillis,
        updatedByUserId: getUserId() || "",
        updatedByUserName: getAuditUserName(),
      };

      const persistedItems = await persistLaborLineItems([...(laborLineItems || []), catalogLine]);
      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
      setTaskList(tasks);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: tasks,
        currentShoppingList: shoppingList,
      });

      await recordJobHistory({
        eventType: "Service Line",
        title: `Catalog service added: ${serviceName}`,
        description: catalogItem.description || "",
        changes: [
          buildHistoryChange("catalogItemId", "Service Catalog Item", "—", serviceName),
          buildHistoryChange("totalPriceCents", "Customer Price", "—", moneyFromCents(catalogLine.totalPriceCents)),
          buildHistoryChange("taskIds", "Seeded Tasks", "—", String(taskIds.length)),
        ],
        metadata: {
          laborLineId: lineId,
          catalogItemId: catalogItem.id,
          taskIds,
          laborLineCount: persistedItems.length,
        },
        severity: "success",
      });

      setShowServiceCatalogPicker(false);
      toast.success(
        taskIds.length
          ? `Added ${serviceName} with ${taskIds.length} task${taskIds.length === 1 ? "" : "s"}`
          : `Added ${serviceName}`
      );
    } catch (err) {
      console.error("[JobDetailView] Failed to add catalog service", err);
      toast.error("Failed to add catalog service.");
    } finally {
      setAddingCatalogServiceId("");
    }
  };

  const deleteLaborLineItem = async (line) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!line?.id) return;

    const ok = await appConfirm({
      title: "Delete Service Line",
      message: "Delete this service line? Tasks and planned service stops stay on the job.",
      confirmLabel: "Delete Service Line",
      variant: "danger",
    });
    if (!ok) return;

    try {
      setSavingLaborLine(true);
      const nextItems = (laborLineItems || []).filter((item) => item.id !== line.id);
      await persistLaborLineItems(nextItems);
      await recordJobHistory({
        eventType: "Service Line",
        title: `Service line deleted: ${line.name || line.id}`,
        description: line.description || "",
        metadata: { laborLineId: line.id },
        severity: "danger",
      });

      if (editingLaborLineId === line.id) clearLaborLineEditor({ force: true });
      toast.success("Deleted service line");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete service line");
    } finally {
      setSavingLaborLine(false);
    }
  };

  const removeTaskFromLaborLines = async (taskId) => {
    const nextItems = (laborLineItems || []).map((line) => ({
      ...line,
      taskIds: getLaborLineTaskIds(line).filter((id) => id !== taskId),
      laborLineTaskIds: getLaborLineTaskIds(line).filter((id) => id !== taskId),
    }));
    const changed = JSON.stringify(nextItems) !== JSON.stringify(laborLineItems || []);
    if (changed) await persistLaborLineItems(nextItems);
  };

  const removePlannedStopFromLaborLines = async (plannedStopId) => {
    const nextItems = (laborLineItems || []).map((line) => ({
      ...line,
      plannedServiceStopIds: getLaborLinePlannedStopIds(line).filter((id) => id !== plannedStopId),
      laborLinePlannedServiceStopIds: getLaborLinePlannedStopIds(line).filter((id) => id !== plannedStopId),
    }));
    const changed = JSON.stringify(nextItems) !== JSON.stringify(laborLineItems || []);
    if (changed) await persistLaborLineItems(nextItems);
  };

  const attachTaskToLaborLine = async (laborLineId, taskId) => {
    if (!laborLineId || !taskId) return;

    const nextItems = (laborLineItems || []).map((line) => {
      if (line.id !== laborLineId) return line;

      const taskIds = Array.from(new Set([...getLaborLineTaskIds(line), taskId]));
      return {
        ...line,
        taskIds,
        laborLineTaskIds: taskIds,
      };
    });

    const changed = JSON.stringify(nextItems) !== JSON.stringify(laborLineItems || []);
    if (changed) await persistLaborLineItems(nextItems);
  };

  const attachPlannedStopToLaborLine = async (laborLineId, plannedStopId) => {
    if (!laborLineId || !plannedStopId) return;

    const nextItems = (laborLineItems || []).map((line) => {
      if (line.id !== laborLineId) return line;

      const plannedServiceStopIds = Array.from(new Set([...getLaborLinePlannedStopIds(line), plannedStopId]));
      return {
        ...line,
        plannedServiceStopIds,
        laborLinePlannedServiceStopIds: plannedServiceStopIds,
      };
    });

    const changed = JSON.stringify(nextItems) !== JSON.stringify(laborLineItems || []);
    if (changed) await persistLaborLineItems(nextItems);
  };

  const showNewTaskItem = () => {
    clearLaborLineEditor({ force: true });
    setShowServiceCatalogPicker(false);
    setNewTaskLaborLineId("");
    setNewPlannedStopLaborLineId("");
    setNewTask(true);
  };

  const showNewTaskForLaborLine = (laborLineId) => {
    if (!requireUpdateCurrentJob("update jobs")) return;

    clearNewTask({ preventDefault: () => { } });
    clearLaborLineEditor({ force: true });
    setShowServiceCatalogPicker(false);
    setEditingTaskId("");
    setNewTaskLaborLineId(laborLineId || "");
    setNewTask(true);
  };

  const handleTaskEquipmentStatusDraftChange = (taskId, status) => {
    setTaskEquipmentStatusDrafts((prev) => ({
      ...prev,
      [taskId]: status,
    }));
  };

  const clearNewTask = (e) => {
    e.preventDefault();
    setSelectedTaskType(null);
    setTaskDescription("");
    setTaskLaborCost("0");
    setTaskBillingLaborPrice("0");
    setEstimatedTime("0");
    setSelectedTaskBodyOfWater(null);
    setSelectedTaskEquipment(null);
    setSelectedTaskDbItem(null);
    setTaskQuantity("1");
    setNewTaskLaborLineId("");
    setNewTask(false);
  };

  const buildTaskEditForm = (task) => {
    const linkedMaterial = getLinkedShoppingItemsForTask(task)[0] || null;

    return {
      ...EMPTY_TASK_EDIT_FORM,
      name: task?.name || task?.description || "",
      type: task?.type || "",
      status: task?.status || "Unassigned",
      laborCost: dollarsFromCents(task?.contractedRate),
      billingLaborPrice: dollarsFromCents(getTaskBillingLaborPriceCents(task)),
      estimatedTime: String(Number(task?.estimatedTime || 0)),
      bodyOfWaterId: task?.bodyOfWaterId || "",
      equipmentId: task?.equipmentId || "",
      dataBaseItemId: task?.dataBaseItemId || linkedMaterial?.dbItemId || linkedMaterial?.itemId || "",
      quantity: String(linkedMaterial?.quantity || task?.quantity || "1"),
      customerApproval: Boolean(task?.customerApproval),
    };
  };

  const cancelTaskEdit = () => {
    setEditingTaskId("");
    setTaskEditForm(EMPTY_TASK_EDIT_FORM);
  };

  const startTaskEdit = (e, task) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;

    setNewTask(false);
    clearLaborLineEditor({ force: true });
    setEditingTaskId(task.id);
    setTaskEditForm(buildTaskEditForm(task));
  };

  const updateTaskEditForm = (field, value) => {
    setTaskEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateTaskEditType = (type) => {
    setTaskEditForm((prev) => ({
      ...prev,
      type,
      bodyOfWaterId: BODY_OF_WATER_JOB_TASK_TYPES.has(type) ? prev.bodyOfWaterId : "",
      equipmentId: EQUIPMENT_JOB_TASK_TYPES.has(type) ? prev.equipmentId : "",
      dataBaseItemId: INSTALL_ITEM_JOB_TASK_TYPES.has(type) ? prev.dataBaseItemId : "",
      quantity: INSTALL_ITEM_JOB_TASK_TYPES.has(type) ? prev.quantity || "1" : "1",
    }));
  };

  const syncEditedTaskToScheduledStop = async (taskId, serviceStopId, taskUpdates) => {
    if (!serviceStopId) return;

    const scheduledTasksRef = collection(
      db,
      "companies",
      recentlySelectedCompany,
      "serviceStops",
      serviceStopId,
      "tasks"
    );

    const [jobTaskSnap, workOrderTaskSnap] = await Promise.all([
      getDocs(query(scheduledTasksRef, where("jobTaskId", "==", taskId))),
      getDocs(query(scheduledTasksRef, where("workOrderTaskId", "==", taskId))),
    ]);

    const scheduledTaskRefs = new Map();
    [...jobTaskSnap.docs, ...workOrderTaskSnap.docs].forEach((taskDoc) => {
      scheduledTaskRefs.set(taskDoc.id, taskDoc.ref);
    });

    await Promise.all(
      [...scheduledTaskRefs.values()].map((taskRef) =>
        updateDoc(taskRef, {
          ...taskUpdates,
          jobTaskId: taskId,
          workOrderTaskId: taskId,
        })
      )
    );
  };

  const syncEditedTaskToLinkedMaterials = async (task, taskUpdates, selectedDbItem, quantity) => {
    const linkedMaterials = getLinkedShoppingItemsForTask(task);
    if (!linkedMaterials.length) {
      if (!editingTaskNeedsInstallItem || !selectedDbItem) return [];

      const linkedShoppingListItemId = "comp_shop_" + uuidv4();
      const plannedUnitCostCents = Number(selectedDbItem.rate || selectedDbItem.cost || 0);
      const plannedUnitPriceCents = Number(
        selectedDbItem.sellPrice ||
        selectedDbItem.rate ||
        selectedDbItem.cost ||
        0
      );
      const plannedTotalCostCents = Math.round(plannedUnitCostCents * quantity);
      const plannedTotalPriceCents = Math.round(plannedUnitPriceCents * quantity);
      const materialName = selectedDbItem.name || "";
      const materialDescription = selectedDbItem.description || "";
      const materialPhotoFields = itemPhotoFieldsFromSource(selectedDbItem, materialName || "Shopping item photo");
      const materialStatus = initialJobMaterialStatus();

      await setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", linkedShoppingListItemId), {
        id: linkedShoppingListItemId,
        category: "Job",
        subCategory: "Data Base",
        status: materialStatus,
        purchaserId: "",
        purchaserName: "",
        genericItemId: selectedDbItem.genericItemId || "",
        name: materialName,
        description: materialDescription,
        datePurchased: null,
        quantity: String(quantity),
        jobId: jobId || "",
        jobName: job.internalId || "Job",
        linkedTaskId: task.id,
        linkedTaskName: taskUpdates.name,
        linkedTaskType: taskUpdates.type,
        customerId: job.customerId || "",
        customerName:
          job.customerName ||
          [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          "",
        userId: "",
        userName: "",
        serviceStopId: "",
        serviceStopInternalId: "",
        serviceLocationId: job.serviceLocationId || "",
        serviceLocationName: serviceLocation.nickName || "",
        scheduledDate: null,
        prepKeys: [
          jobId ? `job:${jobId}` : "",
          job.customerId ? `customer:${job.customerId}` : "",
          job.serviceLocationId ? `serviceLocation:${job.serviceLocationId}` : "",
          task.id ? `jobTask:${task.id}` : "",
        ].filter(Boolean),
        needsAction: true,
        actionDate: Timestamp.fromDate(new Date()),
        assignedTechIds: [],
        dbItemId: selectedDbItem.id || "",
        dbItemName: selectedDbItem.name || "",
        ...materialPhotoFields,
        purchasedItem: "",
        invoiced: false,
        customerApprovalRequired: false,
        customerApprovalStatus: "notRequired",
        customerApprovalRequestedAt: null,
        approvalRequestId: "",
        partApprovalRequestId: "",
        estimateAccepted: isJobAcceptedForMaterials(),
        jobBillingStatus: isJobAcceptedForMaterials() ? "accepted" : String(job.billingStatus || "draft").toLowerCase(),
        itemId: selectedDbItem.id || "",
        itemType: "Data Base",
        cost: plannedUnitCostCents,
        price: plannedUnitPriceCents,
        plannedUnitCostCents,
        plannedUnitPriceCents,
        plannedTotalCostCents,
        plannedTotalPriceCents,
      });

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), {
        shoppingListItemId: linkedShoppingListItemId,
        shoppingListItemIds: arrayUnion(linkedShoppingListItemId),
      });

      return [linkedShoppingListItemId];
    }

    const materialUpdates = {
      linkedTaskName: taskUpdates.name,
      linkedTaskType: taskUpdates.type,
      linkedTaskStatus: taskUpdates.status,
      updatedAt: serverTimestamp(),
    };

    if (editingTaskNeedsInstallItem && selectedDbItem) {
      const plannedUnitCostCents = Number(selectedDbItem.rate || selectedDbItem.cost || 0);
      const plannedUnitPriceCents = Number(
        selectedDbItem.sellPrice ||
        selectedDbItem.rate ||
        selectedDbItem.cost ||
        0
      );

      materialUpdates.genericItemId = selectedDbItem.genericItemId || "";
      materialUpdates.name = selectedDbItem.name || "";
      materialUpdates.description = selectedDbItem.description || "";
      materialUpdates.quantity = String(quantity);
      materialUpdates.dbItemId = selectedDbItem.id || "";
      materialUpdates.dbItemName = selectedDbItem.name || "";
      materialUpdates.itemId = selectedDbItem.id || "";
      materialUpdates.itemType = "Data Base";
      materialUpdates.cost = plannedUnitCostCents;
      materialUpdates.price = plannedUnitPriceCents;
      materialUpdates.plannedUnitCostCents = plannedUnitCostCents;
      materialUpdates.plannedUnitPriceCents = plannedUnitPriceCents;
      materialUpdates.plannedTotalCostCents = Math.round(plannedUnitCostCents * quantity);
      materialUpdates.plannedTotalPriceCents = Math.round(plannedUnitPriceCents * quantity);
    }

    const updatedMaterialIds = linkedMaterials.map((item) => item.id || item.docId || "").filter(Boolean);

    await Promise.all(
      updatedMaterialIds.map((materialId) =>
        updateDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", materialId), materialUpdates)
      )
    );

    return updatedMaterialIds;
  };

  const saveTaskEdit = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;

    const originalTask = (taskList || []).find((task) => task.id === editingTaskId);
    if (!originalTask) return toast.error("Task no longer exists.");

    const nextName = taskEditForm.name.trim();
    const nextType = taskEditForm.type.trim();
    const nextStatus = taskEditForm.status.trim() || "Unassigned";
    const nextLaborCents = centsFromCurrencyInput(taskEditForm.laborCost);
    const nextBillingLaborPriceCents = centsFromCurrencyInput(taskEditForm.billingLaborPrice);
    const nextEstimatedMinutes = Number(taskEditForm.estimatedTime || 0);
    const nextQuantity = Number(taskEditForm.quantity || 0);
    const selectedDbItem = shoppingDbItemById.get(taskEditForm.dataBaseItemId);

    if (!nextName) return toast.error("Add a task description.");
    if (!nextType) return toast.error("Pick a task type.");
    if (!Number.isFinite(nextLaborCents) || nextLaborCents < 0) {
      return toast.error("Labor cost cannot be negative.");
    }
    if (!Number.isFinite(Number(taskEditForm.billingLaborPrice || 0)) || nextBillingLaborPriceCents < 0) {
      return toast.error("Billing labor price cannot be negative.");
    }
    if (!Number.isFinite(nextEstimatedMinutes) || nextEstimatedMinutes < 0) {
      return toast.error("Estimated time cannot be negative.");
    }
    if (editingTaskNeedsBodyOfWater && !taskEditForm.bodyOfWaterId) {
      return toast.error("Select a body of water.");
    }
    if (editingTaskNeedsEquipment && !taskEditForm.equipmentId) {
      return toast.error("Select equipment.");
    }
    if (editingTaskNeedsInstallItem && !selectedDbItem) {
      return toast.error("Select an item.");
    }
    if (editingTaskNeedsInstallItem && (!Number.isFinite(nextQuantity) || nextQuantity <= 0)) {
      return toast.error("Quantity must be greater than 0.");
    }

    const taskUpdates = {
      name: nextName,
      description: nextName,
      type: nextType,
      status: nextStatus,
      contractedRate: nextLaborCents,
      billingLaborPriceCents: nextBillingLaborPriceCents,
      estimatedTime: nextEstimatedMinutes,
      customerApproval: Boolean(taskEditForm.customerApproval),
      bodyOfWaterId: editingTaskNeedsBodyOfWater ? taskEditForm.bodyOfWaterId : "",
      equipmentId: editingTaskNeedsEquipment ? taskEditForm.equipmentId : "",
      dataBaseItemId: editingTaskNeedsInstallItem ? taskEditForm.dataBaseItemId : "",
      updatedAt: serverTimestamp(),
      updatedByUserId: getUserId(),
      updatedByUserName: getUserName(),
    };

    try {
      setSavingTaskEdit(true);

      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", editingTaskId),
        taskUpdates
      );

      const scheduledServiceStopId =
        idValue(originalTask.serviceStopId) ||
        originalTask.serviceStopIdString ||
        "";

      await syncEditedTaskToScheduledStop(editingTaskId, scheduledServiceStopId, taskUpdates);
      const linkedShoppingItemIds = await syncEditedTaskToLinkedMaterials(
        originalTask,
        taskUpdates,
        selectedDbItem,
        nextQuantity
      );

      await recordJobHistory({
        eventType: "Task",
        title: `Task updated: ${nextName}`,
        changes: [
          buildHistoryChange("name", "Name", originalTask.name || originalTask.description || "—", nextName),
          buildHistoryChange("type", "Task Type", originalTask.type || "—", nextType),
          buildHistoryChange("status", "Status", originalTask.status || "—", nextStatus),
          buildHistoryChange("contractedRate", "Tech Labor Cost", moneyFromCents(originalTask.contractedRate), moneyFromCents(nextLaborCents)),
          buildHistoryChange("billingLaborPriceCents", "Billing Labor Price", moneyFromCents(getTaskBillingLaborPriceCents(originalTask)), moneyFromCents(nextBillingLaborPriceCents)),
          buildHistoryChange("estimatedTime", "Estimated Time", `${Number(originalTask.estimatedTime || 0)} minutes`, `${nextEstimatedMinutes} minutes`),
          buildHistoryChange("customerApproval", "Customer Approval", Boolean(originalTask.customerApproval), Boolean(taskEditForm.customerApproval)),
          buildHistoryChange("bodyOfWaterId", "Body Of Water", originalTask.bodyOfWaterId || "—", taskUpdates.bodyOfWaterId || "—"),
          buildHistoryChange("equipmentId", "Equipment", originalTask.equipmentId || "—", taskUpdates.equipmentId || "—"),
          buildHistoryChange("dataBaseItemId", "Item", originalTask.dataBaseItemId || "—", taskUpdates.dataBaseItemId || "—"),
        ],
        metadata: {
          taskId: editingTaskId,
          serviceStopId: scheduledServiceStopId,
          linkedShoppingItemIds,
        },
      });

      const [tasksSnap, shoppingSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks")),
        getDocs(
          query(
            collection(db, "companies", recentlySelectedCompany, "shoppingList"),
            where("jobId", "==", jobId)
          )
        ),
      ]);
      const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const updatedShoppingList = shoppingSnap.docs.map(withFirestoreDocId);

      setTaskList(tasks);
      setShoppingList(updatedShoppingList);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: tasks,
        currentShoppingList: updatedShoppingList,
      });

      cancelTaskEdit();
      toast.success("Updated task");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update task");
    } finally {
      setSavingTaskEdit(false);
    }
  };

  useEffect(() => {
    if (!taskNeedsBodyOfWater) setSelectedTaskBodyOfWater(null);
    if (!taskNeedsEquipment) setSelectedTaskEquipment(null);
    if (!taskNeedsInstallItem) {
      setSelectedTaskDbItem(null);
      setTaskQuantity("1");
    }
  }, [taskNeedsBodyOfWater, taskNeedsEquipment, taskNeedsInstallItem]);

  const handleAddTask = async (e) => {
    e.preventDefault();
    try {
      const targetLaborLineId = newTaskLaborLineId;
      if (!selectedTaskType?.value) return toast.error("Pick a task type");
      if (!taskDescription) return toast.error("Add a description");
      const laborCostNumber = Number(taskLaborCost || 0);
      const billingLaborPriceNumber = Number(taskBillingLaborPrice || 0);
      const estimatedTimeNumber = Number(estimatedTime || 0);
      if (!Number.isFinite(laborCostNumber) || laborCostNumber < 0) {
        return toast.error("Labor cost cannot be negative.");
      }
      if (!Number.isFinite(billingLaborPriceNumber) || billingLaborPriceNumber < 0) {
        return toast.error("Billing labor price cannot be negative.");
      }
      if (!Number.isFinite(estimatedTimeNumber) || estimatedTimeNumber < 0) {
        return toast.error("Estimated time cannot be negative.");
      }
      if (taskNeedsBodyOfWater && !selectedTaskBodyOfWater?.id) {
        return toast.error("Select a body of water");
      }
      if (taskNeedsEquipment && !selectedTaskEquipment?.id) {
        return toast.error("Select equipment");
      }
      if (taskNeedsInstallItem && !selectedTaskDbItem?.id) {
        return toast.error("Select an item");
      }
      if (taskNeedsInstallItem) {
        const qty = parseFloat(taskQuantity);
        if (!qty || qty <= 0) return toast.error("Quantity must be greater than 0");
      }

      const id = "comp_wo_tas_" + uuidv4();
      const costCents = centsFromCurrencyInput(taskLaborCost || "0");
      const billingLaborPriceCents = centsFromCurrencyInput(taskBillingLaborPrice || "0");
      const estMin = estimatedTimeNumber;
      const linkedShoppingListItemId = taskNeedsInstallItem ? "comp_shop_" + uuidv4() : "";
      const quantity = taskNeedsInstallItem ? parseFloat(taskQuantity) : 0;

      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id), {
        id,
        name: taskDescription,
        type: selectedTaskType.value,
        contractedRate: costCents,
        billingLaborPriceCents,
        estimatedTime: estMin,
        status: "Unassigned",

        customerApproval: false,
        actualTime: 0,

        workerId: "",
        workerType: "Not Assigned",
        workerName: "",

        laborContractId: "",

        // iOS uses IdInfo. Store object instead of plain string.
        serviceStopId: {
          id: "",
          internalId: "",
        },

        equipmentId: taskNeedsEquipment ? selectedTaskEquipment?.id || "" : "",
        serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
        bodyOfWaterId: taskNeedsBodyOfWater ? selectedTaskBodyOfWater?.id || "" : "",
        dataBaseItemId: taskNeedsInstallItem ? selectedTaskDbItem?.id || "" : "",
        shoppingListItemId: linkedShoppingListItemId,
        shoppingListItemIds: linkedShoppingListItemId ? [linkedShoppingListItemId] : [],
        customerApprovalRequired: false,
        customerApprovalStatus: "notRequired",
        customerApprovalRequestId: "",
      });

      if (taskNeedsInstallItem) {
        const plannedUnitCostCents = Number(selectedTaskDbItem?.rate || selectedTaskDbItem?.cost || 0);
        const plannedUnitPriceCents = Number(
          selectedTaskDbItem?.sellPrice ||
          selectedTaskDbItem?.rate ||
          selectedTaskDbItem?.cost ||
          0
        );
        const plannedTotalCostCents = Math.round(plannedUnitCostCents * quantity);
        const plannedTotalPriceCents = Math.round(plannedUnitPriceCents * quantity);

        const materialName = selectedTaskDbItem?.name || "";
        const materialDescription = selectedTaskDbItem?.description || "";
        const materialPhotoFields = itemPhotoFieldsFromSource(selectedTaskDbItem, materialName || "Shopping item photo");
        const materialStatus = initialJobMaterialStatus();

        await setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", linkedShoppingListItemId), {
          id: linkedShoppingListItemId,
          category: "Job",
          subCategory: "Data Base",
          status: materialStatus,
          purchaserId: "",
          purchaserName: "",
          genericItemId: selectedTaskDbItem?.genericItemId || "",
          name: materialName,
          description: materialDescription,
          datePurchased: null,
          quantity: String(quantity),
          jobId: jobId || "",
          jobName: job.internalId || "Job",
          linkedTaskId: id,
          linkedTaskName: taskDescription,
          linkedTaskType: selectedTaskType.value,
          customerId: job.customerId || "",
          customerName:
            job.customerName ||
            [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
            "",
          userId: "",
          userName: "",
          serviceStopId: "",
          serviceStopInternalId: "",
          serviceLocationId: job.serviceLocationId || "",
          serviceLocationName: serviceLocation.nickName || "",
          scheduledDate: null,
          prepKeys: [
            jobId ? `job:${jobId}` : "",
            job.customerId ? `customer:${job.customerId}` : "",
            job.serviceLocationId ? `serviceLocation:${job.serviceLocationId}` : "",
            `jobTask:${id}`,
          ].filter(Boolean),
          needsAction: true,
          actionDate: Timestamp.fromDate(new Date()),
          assignedTechIds: [],
          dbItemId: selectedTaskDbItem?.id || "",
          dbItemName: selectedTaskDbItem?.name || "",
          ...materialPhotoFields,
          purchasedItem: "",
          invoiced: false,
          customerApprovalRequired: false,
          customerApprovalStatus: "notRequired",
          customerApprovalRequestedAt: null,
          approvalRequestId: "",
          partApprovalRequestId: "",
          estimateAccepted: isJobAcceptedForMaterials(),
          jobBillingStatus: isJobAcceptedForMaterials() ? "accepted" : String(job.billingStatus || "draft").toLowerCase(),
          itemId: selectedTaskDbItem?.id || "",
          itemType: "Data Base",
          cost: plannedUnitCostCents,
          price: plannedUnitPriceCents,
          plannedUnitCostCents,
          plannedUnitPriceCents,
          plannedTotalCostCents,
          plannedTotalPriceCents,
        });

      }

      if (targetLaborLineId) {
        await attachTaskToLaborLine(targetLaborLineId, id);
      }

      await recordJobHistory({
        eventType: "Task",
        title: targetLaborLineId ? `Task added to service line: ${taskDescription}` : `Task added: ${taskDescription}`,
        changes: [
          buildHistoryChange("type", "Task Type", "—", selectedTaskType.value),
          buildHistoryChange("contractedRate", "Tech Labor Cost", "—", moneyFromCents(costCents)),
          buildHistoryChange("billingLaborPriceCents", "Billing Labor Price", "—", moneyFromCents(billingLaborPriceCents)),
          buildHistoryChange("estimatedTime", "Estimated Time", "—", `${estMin} minutes`),
          ...(taskNeedsBodyOfWater
            ? [buildHistoryChange("bodyOfWaterId", "Body Of Water", "—", selectedTaskBodyOfWater?.label || selectedTaskBodyOfWater?.name || "—")]
            : []),
          ...(taskNeedsEquipment
            ? [buildHistoryChange("equipmentId", "Equipment", "—", selectedTaskEquipment?.label || selectedTaskEquipment?.name || "—")]
            : []),
          ...(taskNeedsInstallItem
            ? [buildHistoryChange("dataBaseItemId", "Item", "—", selectedTaskDbItem?.label || selectedTaskDbItem?.name || "—")]
            : []),
        ],
        metadata: { taskId: id, laborLineId: targetLaborLineId || "" },
      });

      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const shoppingSnap = await getDocs(
        query(
          collection(db, "companies", recentlySelectedCompany, "shoppingList"),
          where("jobId", "==", jobId)
        )
      );
      const updatedShoppingList = shoppingSnap.docs.map(withFirestoreDocId);
      setTaskList(tasks);
      setShoppingList(updatedShoppingList);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: tasks,
        currentShoppingList: updatedShoppingList,
      });

      toast.success(targetLaborLineId ? "Added task to service line" : "Added task");
      clearNewTask({ preventDefault: () => { } });
    } catch (err) {
      console.error(err);
      toast.error("Failed to add task");
    }
  };

  const openNewPlannedStopModal = (laborLineId = "") => {
    if (!requireUpdateCurrentJob("update jobs")) return;

    const targetLaborLineId = typeof laborLineId === "string" ? laborLineId : "";
    setNewPlannedStopLaborLineId(targetLaborLineId);
    setPlannedStopForm({
      ...EMPTY_PLANNED_STOP_FORM,
      serviceStopTypeId: companyServiceStopTypes?.[0]?.id || "",
    });
    setNewPlannedStop(true);
  };

  const clearNewPlannedStop = (e, { force = false } = {}) => {
    e?.preventDefault?.();
    if (savingPlannedStop && !force) return;
    setNewPlannedStop(false);
    setNewPlannedStopLaborLineId("");
    setPlannedStopForm(EMPTY_PLANNED_STOP_FORM);
  };

  const updatePlannedStopForm = (field, value) => {
    setPlannedStopForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const togglePlannedStopTask = (taskId) => {
    setPlannedStopForm((prev) => {
      const currentTaskIds = new Set(prev.taskIds || []);
      if (currentTaskIds.has(taskId)) {
        currentTaskIds.delete(taskId);
      } else {
        currentTaskIds.add(taskId);
      }

      return {
        ...prev,
        taskIds: Array.from(currentTaskIds),
      };
    });
  };

  const handleAddPlannedServiceStop = async (e) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;
    if (!recentlySelectedCompany || !jobId) return toast.error("Missing job context.");
    if (!selectedPlannedStopType) return toast.error("Select a service stop type.");
    const targetLaborLineId = newPlannedStopLaborLineId;

    const estimatedMinutesNumber = Number(plannedStopForm.estimatedMinutes || 0);
    if (!Number.isFinite(estimatedMinutesNumber) || estimatedMinutesNumber < 0) {
      return toast.error("Estimated time cannot be negative.");
    }

    try {
      setSavingPlannedStop(true);

      const id = "comp_job_plan_stop_" + uuidv4();
      const selectedTaskIds = Array.isArray(plannedStopForm.taskIds) ? plannedStopForm.taskIds : [];
      const typeName =
        selectedPlannedStopType.name ||
        selectedPlannedStopType.label ||
        selectedPlannedStopType.type ||
        "Planned Service Stop";
      const stopName = plannedStopForm.name.trim() || typeName;
      const plannedLaborCostCents = cents(plannedStopFormPayRange.maxAmountCents);
      const plannedLaborNotes = plannedStopFormPayRange.highestWorkerName
        ? `Planning cost uses highest matching technician rate: ${plannedStopFormPayRange.highestWorkerName}.`
        : "No active technician rate matched. Review payroll rates before relying on this planned labor cost.";
      const nowMillis = Date.now();

      const payload = {
        id,
        companyId: recentlySelectedCompany,
        jobId,
        name: stopName,
        description: plannedStopForm.description.trim(),
        type: typeName,
        serviceStopTypeId: selectedPlannedStopType.id || "",
        serviceStopTypeName: typeName,
        serviceStopTypeImage: selectedPlannedStopType.image || selectedPlannedStopType.typeImage || "",
        serviceStopTypeUseCaseRawValue:
          selectedPlannedStopType.serviceStopTypeUseCaseRawValue ||
          selectedPlannedStopType.useCase ||
          "jobVisit",
        defaultWorkTypeIds: selectedPlannedStopType.defaultWorkTypeIds || [],
        estimatedMinutes: estimatedMinutesNumber,
        plannedLaborCostCents,
        estimatedLaborCostCents: plannedLaborCostCents,
        payrollEstimateMinAmountCents: cents(plannedStopFormPayRange.minAmountCents),
        payrollEstimateMaxAmountCents: plannedLaborCostCents,
        payrollEstimateNeedsReview: Boolean(plannedStopFormPayRange.needsReview),
        payrollEstimateHighestWorkerName: plannedStopFormPayRange.highestWorkerName || "",
        plannedLaborNotes,
        taskIds: selectedTaskIds,
        status: "Planned",
        sortOrder: plannedServiceStops.length,
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
        createdByUserId: getUserId() || "",
        createdByUserName: getAuditUserName(),
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      };

      await setDoc(doc(plannedServiceStopsPath(recentlySelectedCompany, jobId), id), payload);

      if (targetLaborLineId) {
        await attachPlannedStopToLaborLine(targetLaborLineId, id);
      }

      await recordJobHistory({
        eventType: "Planned Service Stop",
        title: targetLaborLineId ? `Planned stop added to service line: ${stopName}` : `Planned stop added: ${stopName}`,
        description: payload.description,
        changes: [
          buildHistoryChange("serviceStopTypeId", "Service Stop Type", "—", typeName),
          buildHistoryChange("estimatedMinutes", "Estimated Time", "—", `${estimatedMinutesNumber} minutes`),
          buildHistoryChange("plannedLaborCostCents", "Planning Labor Cost", "—", moneyFromCents(plannedLaborCostCents)),
          buildHistoryChange("taskIds", "Linked Tasks", "—", selectedTaskIds.length ? String(selectedTaskIds.length) : "All current tasks"),
        ],
        metadata: {
          plannedStopId: id,
          serviceStopTypeId: selectedPlannedStopType.id || "",
          highestWorkerName: plannedStopFormPayRange.highestWorkerName || "",
          laborLineId: targetLaborLineId || "",
        },
        severity: "success",
      });

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: taskList,
        currentShoppingList: shoppingList,
      });

      toast.success(targetLaborLineId ? "Added planned stop to service line" : "Added planned stop");
      clearNewPlannedStop({ preventDefault: () => { } }, { force: true });
    } catch (err) {
      console.error(err);
      toast.error("Failed to add planned stop");
    } finally {
      setSavingPlannedStop(false);
    }
  };

  const deletePlannedServiceStop = async (plannedStopId) => {
    try {
      if (!recentlySelectedCompany || !jobId || !plannedStopId) return;

      const ok = await appConfirm({
        title: "Delete Planned Stop",
        message: "Delete this planned stop? This only removes the planned visit. It does not delete scheduled service stops or tasks.",
        confirmLabel: "Delete Planned Stop",
        variant: "danger",
      });

      if (!ok) return;

      const deletedPlannedStop = (plannedServiceStops || []).find((stop) => stop.id === plannedStopId);

      await deleteDoc(
        doc(
          db,
          "companies",
          recentlySelectedCompany,
          "workOrders",
          jobId,
          "plannedServiceStops",
          plannedStopId
        )
      );
      await removePlannedStopFromLaborLines(plannedStopId);

      await recordJobHistory({
        eventType: "Planned Service Stop",
        title: `Planned stop deleted: ${deletedPlannedStop?.name || deletedPlannedStop?.serviceStopTypeName || plannedStopId}`,
        description: deletedPlannedStop?.description || "",
        metadata: { plannedStopId },
        severity: "danger",
      });

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: taskList,
        currentShoppingList: shoppingList,
      });

      toast.success("Deleted planned stop");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete planned stop");
    }
  };
  const deleteTaskItem = async (e, id) => {
    e.preventDefault();
    try {
      const deletedTask = (taskList || []).find((task) => task.id === id);
      const linkedShoppingItemIds = Array.from(
        new Set(
          [
            deletedTask?.shoppingListItemId,
            ...(Array.isArray(deletedTask?.shoppingListItemIds) ? deletedTask.shoppingListItemIds : []),
          ].filter(Boolean)
        )
      );

      for (const shoppingListItemId of linkedShoppingItemIds) {
        await deleteDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", shoppingListItemId));
      }

      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id));
      await removeTaskFromLaborLines(id);
      await recordJobHistory({
        eventType: "Task",
        title: `Task deleted: ${deletedTask?.name || deletedTask?.type || id}`,
        description: deletedTask?.name || "",
        metadata: { taskId: id, deletedShoppingListItemIds: linkedShoppingItemIds },
        severity: "danger",
      });

      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const remainingShoppingList = (shoppingList || []).filter(
        (item) => !linkedShoppingItemIds.includes(item.id)
      );
      setTaskList(tasks);
      setShoppingList(remainingShoppingList);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: tasks,
        currentShoppingList: remainingShoppingList,
      });

      toast.success("Deleted task");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete task");
    }
  };

  const resetShoppingDbItemCreator = () => {
    setShowShoppingDbItemCreator(false);
    setSavingShoppingDbItem(false);
    setShoppingDbItemForm(createEmptyShoppingDbItemForm(shoppingDbItemVendorList[0] || null));
  };

  const showNewShoppingListItem = () => {
    setShowServiceCatalogPicker(false);
    setNewShoppingList(true);
    if (!shoppingFormData.quantity) {
      handleShoppingFormChange("quantity", "1");
    }
    if (!shoppingFormData.subCategory) {
      handleShoppingSubCategoryChange("Data Base");
    }
  };

  const handleShoppingFormChange = (field, value) => {
    setShoppingFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleShoppingDbItemFormChange = (field, value) => {
    setShoppingDbItemForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleShoppingSubCategoryChange = (value) => {
    const nextData = {
      ...shoppingFormData,
      subCategory: value,
    };

    if (value === "Data Base") {
      nextData.name = "";
      nextData.description = "";
      nextData.plannedUnitCost = "";
      nextData.plannedUnitPrice = "";
    } else {
      nextData.dbItemId = "";
      nextData.genericItemId = "";
      setSelectedShoppingDbItem(null);
      resetShoppingDbItemCreator();
    }

    setShoppingFormData(nextData);
  };

  const handleShoppingPurchaserChange = (option) => {
    setSelectedPurchaser(option);
    setShoppingFormData((prev) => ({
      ...prev,
      purchaserId: option?.id || "",
      purchaserName: option?.name || "",
    }));
  };

  const handleShoppingDbItemChange = (option) => {
    setSelectedShoppingDbItem(option);
    const photoFields = option ? itemPhotoFieldsFromSource(option, option.name || "Shopping item photo") : {};
    const plannedUnitCost = option ? dollarsFromCents(option.rate || option.cost || 0) : "";
    const plannedUnitPrice = option
      ? dollarsFromCents(option.sellPrice || option.rate || option.cost || 0)
      : "";
    setShoppingFormData((prev) => ({
      ...prev,
      dbItemId: option?.id || "",
      genericItemId: option?.genericItemId || "",
      name: option?.name || "",
      description: option?.description || "",
      plannedUnitCost,
      plannedUnitPrice,
      ...photoFields,
    }));
  };

  const handleCreateShoppingDatabaseItem = async (e) => {
    e.preventDefault();
    if (!requirePermission("852", "create database items")) return;
    if (!recentlySelectedCompany) return toast.error("Select a company first");

    const nextName = shoppingDbItemForm.name.trim();
    if (!nextName) return toast.error("Enter item name");

    const rateValue = Number(shoppingDbItemForm.rate || 0);
    const sellPriceValue = Number(shoppingDbItemForm.sellPrice || 0);
    if (!Number.isFinite(rateValue) || rateValue < 0) return toast.error("Unit cost cannot be negative");
    if (!Number.isFinite(sellPriceValue) || sellPriceValue < 0) return toast.error("Sell price cannot be negative");

    try {
      setSavingShoppingDbItem(true);

      const id = "com_sett_db_" + uuidv4();
      const selectedVendor = shoppingDbItemForm.vendor || {};
      const selectedVendorId = selectedVendor.id || "";
      const selectedVendorName = selectedVendor.label || selectedVendor.name || "";
      const rateCents = centsFromCurrencyInput(shoppingDbItemForm.rate);
      const sellPriceCents = shoppingDbItemForm.billable
        ? centsFromCurrencyInput(shoppingDbItemForm.sellPrice)
        : 0;
      const item = {
        UOM: shoppingDbItemForm.uom?.label || "Unit",
        id,
        billable: Boolean(shoppingDbItemForm.billable),
        category: shoppingDbItemForm.category?.label || "Misc",
        color: shoppingDbItemForm.color,
        dateUpdated: new Date(),
        description: shoppingDbItemForm.description,
        name: nextName,
        rate: rateCents,
        size: shoppingDbItemForm.size,
        sku: shoppingDbItemForm.sku,
        storeName: selectedVendorName,
        subCategory: shoppingDbItemForm.subcategory?.label || "Misc",
        timesPurchased: 0,
        venderId: selectedVendorId,
        vendorId: selectedVendorId,
        sellPrice: sellPriceCents,
        billingRate: sellPriceCents,
        tracking: shoppingDbItemForm.tracking,
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", id), item);

      const option = buildShoppingDbItemOption(item, id);
      setShoppingDbItemList((prev) =>
        [...(prev || []).filter((existing) => existing.id !== id), option].sort((left, right) =>
          String(left.name || "").localeCompare(String(right.name || ""))
        )
      );
      handleShoppingDbItemChange(option);
      setShoppingFormData((prev) => ({
        ...prev,
        subCategory: "Data Base",
        dbItemId: id,
        genericItemId: "",
        name: option.name,
        description: option.description,
      }));
      resetShoppingDbItemCreator();
      toast.success("Database item created");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create database item");
    } finally {
      setSavingShoppingDbItem(false);
    }
  };

  const clearNewShoppingListItem = (e) => {
    e.preventDefault();
    setNewShoppingList(false);
    setSelectedPurchaser(null);
    setSelectedShoppingDbItem(null);
    resetShoppingDbItemCreator();
    setShoppingFormData({
      category: "Job",
      subCategory: "Data Base",
      status: initialJobMaterialStatus(),
      purchaserId: "",
      purchaserName: "",
      genericItemId: "",
      name: "",
      description: "",
      plannedUnitCost: "",
      plannedUnitPrice: "",
      datePurchased: "",
      quantity: "1",
      jobId: jobId || "",
      jobName: job.internalId || "",
      dbItemId: "",
      linkedTaskId: "",
      customerApprovalRequired: false,
    });
  };

  const buildShoppingEditForm = (item = {}) => ({
    ...EMPTY_SHOPPING_EDIT_FORM,
    name: getMaterialName(item),
    description: item.description || "",
    status: item.status || initialJobMaterialStatus({
      customerApprovalRequired: Boolean(item.customerApprovalRequired),
      requestedStatus: item.status || "",
    }),
    quantity: String(item.quantity ?? item.quantityString ?? "1"),
    plannedUnitCost: dollarsFromCents(item.plannedUnitCostCents ?? item.cost),
    plannedUnitPrice: dollarsFromCents(item.plannedUnitPriceCents ?? item.price),
    linkedTaskId: linkedTaskIdForPlanMaterial(item),
    customerApprovalRequired: Boolean(item.customerApprovalRequired),
    updateDatabaseItem: false,
  });

  const startPlannedMaterialEdit = (item) => {
    if (!requireUpdateCurrentJob("update jobs")) return;
    const itemId = getFirestoreDocId(item);
    if (!itemId) return;

    setNewShoppingList(false);
    setEditingShoppingItemId(itemId);
    setShoppingEditForm(buildShoppingEditForm(item));
  };

  const cancelPlannedMaterialEdit = ({ force = false } = {}) => {
    if (savingShoppingEdit && !force) return;
    setEditingShoppingItemId("");
    setShoppingEditForm(EMPTY_SHOPPING_EDIT_FORM);
  };

  const updateShoppingEditForm = (field, value) => {
    setShoppingEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const savePlannedMaterialEdit = async (e, item) => {
    e.preventDefault();
    if (!requireUpdateCurrentJob("update jobs")) return;

    const itemId = getFirestoreDocId(item);
    if (!recentlySelectedCompany || !jobId || !itemId) return toast.error("Missing planned product context.");

    const nextName = shoppingEditForm.name.trim();
    const nextQuantity = Number(shoppingEditForm.quantity || 0);
    const nextUnitCostCents = centsFromCurrencyInput(shoppingEditForm.plannedUnitCost || "0");
    const nextUnitPriceCents = centsFromCurrencyInput(shoppingEditForm.plannedUnitPrice || "0");
    const nextLinkedTask =
      (taskList || []).find((task) => task.id === shoppingEditForm.linkedTaskId) || null;
    const existingLinkedTaskId = linkedTaskIdForPlanMaterial(item);
    const databaseItemId = item.dbItemId || item.itemId || item.dataBaseItemId || "";

    if (!nextName) return toast.error("Enter product name.");
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      return toast.error("Quantity must be greater than 0.");
    }
    if (nextUnitCostCents < 0) return toast.error("Unit cost cannot be negative.");
    if (nextUnitPriceCents < 0) return toast.error("Unit billing price cannot be negative.");
    if (shoppingEditForm.updateDatabaseItem && !databaseItemId) {
      return toast.error("This planned product is not linked to a database item.");
    }
    if (shoppingEditForm.updateDatabaseItem && !requirePermission("852", "update database items")) return;

    const nextTotalCostCents = Math.round(nextUnitCostCents * nextQuantity);
    const nextTotalPriceCents = Math.round(nextUnitPriceCents * nextQuantity);
    const nextCustomerApprovalRequired = Boolean(shoppingEditForm.customerApprovalRequired);
    const nextCustomerApprovalStatus = nextCustomerApprovalRequired
      ? item.customerApprovalStatus === "approved"
        ? "approved"
        : "pending"
      : "notRequired";
    const nextStatus = shoppingEditForm.status || initialJobMaterialStatus({
      customerApprovalRequired: nextCustomerApprovalRequired,
      requestedStatus: item.status || "",
    });
    const nowMillis = Date.now();

    const materialUpdates = {
      name: nextName,
      description: shoppingEditForm.description,
      status: nextStatus,
      quantity: String(nextQuantity),
      linkedTaskId: nextLinkedTask?.id || "",
      linkedTaskName: nextLinkedTask?.name || "",
      linkedTaskType: nextLinkedTask?.type || "",
      customerApprovalRequired: nextCustomerApprovalRequired,
      customerApprovalStatus: nextCustomerApprovalStatus,
      customerApprovalRequestedAt: nextCustomerApprovalRequired && !item.customerApprovalRequired
        ? Timestamp.fromDate(new Date())
        : item.customerApprovalRequestedAt || null,
      cost: nextUnitCostCents,
      price: nextUnitPriceCents,
      plannedUnitCostCents: nextUnitCostCents,
      plannedUnitPriceCents: nextUnitPriceCents,
      plannedTotalCostCents: nextTotalCostCents,
      plannedTotalPriceCents: nextTotalPriceCents,
      billable: nextTotalPriceCents > 0,
      updatedAt: serverTimestamp(),
      updatedAtMillis: nowMillis,
      updatedByUserId: getUserId() || "",
      updatedByUserName: getAuditUserName(),
    };

    try {
      setSavingShoppingEdit(true);

      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "shoppingList", itemId),
        materialUpdates
      );

      const taskLinkWrites = [];
      if (existingLinkedTaskId && existingLinkedTaskId !== nextLinkedTask?.id) {
        const previousLinkedTask = (taskList || []).find((task) => task.id === existingLinkedTaskId);
        if (previousLinkedTask) {
          taskLinkWrites.push(
            updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", existingLinkedTaskId), {
              ...(previousLinkedTask.shoppingListItemId === itemId ? { shoppingListItemId: "" } : {}),
              shoppingListItemIds: arrayRemove(itemId),
            })
          );
        }
      }

      if (nextLinkedTask?.id && existingLinkedTaskId !== nextLinkedTask.id) {
        taskLinkWrites.push(
          updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", nextLinkedTask.id), {
            shoppingListItemId: itemId,
            shoppingListItemIds: arrayUnion(itemId),
          })
        );
      }

      if (taskLinkWrites.length) await Promise.all(taskLinkWrites);

      if (shoppingEditForm.updateDatabaseItem && databaseItemId) {
        const databaseUpdates = {
          name: nextName,
          description: shoppingEditForm.description,
          rate: nextUnitCostCents,
          sellPrice: nextUnitPriceCents,
          billingRate: nextUnitPriceCents,
          billable: nextUnitPriceCents > 0,
          dateUpdated: new Date(),
          updatedAt: serverTimestamp(),
          updatedAtMillis: nowMillis,
        };

        await updateDoc(
          doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", databaseItemId),
          databaseUpdates
        );

        setShoppingDbItemList((prev) =>
          (prev || []).map((dbItem) =>
            dbItem.id === databaseItemId
              ? buildShoppingDbItemOption({
                ...dbItem,
                ...databaseUpdates,
                updatedAt: new Date(),
              }, databaseItemId)
              : dbItem
          )
        );
      }

      await recordJobHistory({
        eventType: "Planned Product",
        title: `Planned product updated: ${nextName}`,
        description: shoppingEditForm.description || "",
        changes: [
          buildHistoryChange("name", "Name", getMaterialName(item), nextName),
          buildHistoryChange("quantity", "Quantity", getMaterialQuantity(item), String(nextQuantity)),
          buildHistoryChange("status", "Status", item.status || "—", nextStatus),
          buildHistoryChange("plannedUnitCostCents", "Unit Cost", moneyFromCents(item.plannedUnitCostCents ?? item.cost), moneyFromCents(nextUnitCostCents)),
          buildHistoryChange("plannedUnitPriceCents", "Unit Billing Price", moneyFromCents(item.plannedUnitPriceCents ?? item.price), moneyFromCents(nextUnitPriceCents)),
          buildHistoryChange("plannedTotalCostCents", "Planned Cost", moneyFromCents(getShoppingPlannedTotalCostCents(item)), moneyFromCents(nextTotalCostCents)),
          buildHistoryChange("plannedTotalPriceCents", "Planned Billable", moneyFromCents(getShoppingPlannedTotalPriceCents(item)), moneyFromCents(nextTotalPriceCents)),
          buildHistoryChange("linkedTaskId", "Linked Task", existingLinkedTaskId || "—", nextLinkedTask?.id || "—"),
          buildHistoryChange("databaseItem", "Updated Database Item", "No", shoppingEditForm.updateDatabaseItem ? "Yes" : "No"),
        ],
        metadata: {
          shoppingListItemId: itemId,
          linkedTaskId: nextLinkedTask?.id || "",
          databaseItemId,
          updatedDatabaseItem: Boolean(shoppingEditForm.updateDatabaseItem && databaseItemId),
        },
      });

      const [itemsSnap, tasksSnap] = await Promise.all([
        getDocs(query(collection(db, "companies", recentlySelectedCompany, "shoppingList"), where("jobId", "==", jobId))),
        getDocs(collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks")),
      ]);
      const items = itemsSnap.docs.map(withFirestoreDocId);
      const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }));

      setShoppingList(items);
      setTaskList(tasks);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: tasks,
        currentShoppingList: items,
      });

      cancelPlannedMaterialEdit({ force: true });
      toast.success("Updated planned product");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update planned product");
    } finally {
      setSavingShoppingEdit(false);
    }
  };

  const handleAddShoppingListItem = async (e) => {
    e.preventDefault();

    try {
      if (!shoppingFormData.quantity) return toast.error("Add quantity");

      const qty = parseFloat(shoppingFormData.quantity);
      if (!qty || qty <= 0) return toast.error("Quantity must be greater than 0");

      if (requiresShoppingManualDetails && !shoppingFormData.name.trim()) {
        return toast.error("Enter item name");
      }

      if (requiresShoppingDbItem && !shoppingFormData.dbItemId) {
        return toast.error("Select a database item");
      }

      if (
        shoppingFormData.plannedUnitCost !== "" &&
        (!Number.isFinite(Number(shoppingFormData.plannedUnitCost)) || Number(shoppingFormData.plannedUnitCost) < 0)
      ) {
        return toast.error("Unit cost cannot be negative");
      }

      if (
        shoppingFormData.plannedUnitPrice !== "" &&
        (!Number.isFinite(Number(shoppingFormData.plannedUnitPrice)) || Number(shoppingFormData.plannedUnitPrice) < 0)
      ) {
        return toast.error("Unit price cannot be negative");
      }

      let plannedUnitCostCents = 0;
      let plannedUnitPriceCents = 0;

      if (requiresShoppingDbItem) {
        plannedUnitCostCents = shoppingFormData.plannedUnitCost !== ""
          ? centsFromCurrencyInput(shoppingFormData.plannedUnitCost)
          : Number(selectedShoppingDbItem?.rate || selectedShoppingDbItem?.cost || 0);
        plannedUnitPriceCents = shoppingFormData.plannedUnitPrice !== ""
          ? centsFromCurrencyInput(shoppingFormData.plannedUnitPrice)
          : Number(
            selectedShoppingDbItem?.sellPrice ||
            selectedShoppingDbItem?.rate ||
            selectedShoppingDbItem?.cost ||
            0
          );
      } else {
        plannedUnitCostCents = centsFromCurrencyInput(shoppingFormData.plannedUnitCost);
        plannedUnitPriceCents = centsFromCurrencyInput(shoppingFormData.plannedUnitPrice);
      }

      const plannedTotalCostCents = Math.round(plannedUnitCostCents * qty);
      const plannedTotalPriceCents = Math.round(plannedUnitPriceCents * qty);
      const id = "comp_shop_" + uuidv4();
      const materialName = requiresShoppingDbItem
        ? selectedShoppingDbItem?.name || shoppingFormData.name || ""
        : shoppingFormData.name.trim();
      const materialDescription = requiresShoppingDbItem
        ? selectedShoppingDbItem?.description || shoppingFormData.description || ""
        : shoppingFormData.description || "";
      const materialPhotoFields = requiresShoppingDbItem
        ? itemPhotoFieldsFromSource(selectedShoppingDbItem, materialName || "Shopping item photo")
        : {};
      const linkedTask =
        (taskList || []).find((task) => task.id === shoppingFormData.linkedTaskId) || null;
      const customerApprovalRequired = Boolean(shoppingFormData.customerApprovalRequired);
      const materialStatus = initialJobMaterialStatus({
        customerApprovalRequired,
        requestedStatus: shoppingFormData.status,
      });
      const prepKeys = Array.from(
        new Set(
          [
            jobId ? `job:${jobId}` : "",
            job.customerId ? `customer:${job.customerId}` : "",
            job.serviceLocationId ? `serviceLocation:${job.serviceLocationId}` : "",
            linkedTask?.id ? `jobTask:${linkedTask.id}` : "",
          ].filter(Boolean)
        )
      );

      await setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", id), {
        id,
        category: "Job",
        subCategory: shoppingFormData.subCategory,
        status: materialStatus,
        purchaserId: shoppingFormData.purchaserId || "",
        purchaserName: shoppingFormData.purchaserName || "",
        genericItemId: shoppingFormData.genericItemId || "",
        name: materialName,
        description: materialDescription,
        datePurchased: shoppingFormData.datePurchased
          ? Timestamp.fromDate(new Date(shoppingFormData.datePurchased))
          : null,

        // iOS: var quantity: String?
        quantity: String(qty),

        // Job
        jobId: jobId || "",
        jobName: job.internalId || "Job",
        linkedTaskId: linkedTask?.id || "",
        linkedTaskName: linkedTask?.name || "",
        linkedTaskType: linkedTask?.type || "",

        // Customer
        customerId: job.customerId || "",
        customerName:
          job.customerName ||
          [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          "",

        // Personal
        userId: "",
        userName: "",

        serviceStopId: "",
        serviceStopInternalId: "",
        serviceLocationId: job.serviceLocationId || "",
        serviceLocationName: serviceLocation.nickName || "",
        scheduledDate: null,
        prepKeys,
        needsAction: true,
        actionDate: Timestamp.fromDate(new Date()),
        assignedTechIds: [],

        // DataBaseItem
        dbItemId: requiresShoppingDbItem ? shoppingFormData.dbItemId || "" : "",
        dbItemName: requiresShoppingDbItem ? materialName : "",
        ...materialPhotoFields,
        purchasedItem: "",
        invoiced: false,
        customerApprovalRequired,
        customerApprovalStatus: customerApprovalRequired ? "pending" : "notRequired",
        customerApprovalRequestedAt: customerApprovalRequired ? Timestamp.fromDate(new Date()) : null,
        approvalRequestId: "",
        partApprovalRequestId: "",
        estimateAccepted: isJobAcceptedForMaterials(),
        jobBillingStatus: isJobAcceptedForMaterials() ? "accepted" : String(job.billingStatus || "draft").toLowerCase(),

        // Legacy web fields for backward compatibility
        itemId: requiresShoppingDbItem ? shoppingFormData.dbItemId || "" : "",
        itemType: shoppingFormData.subCategory,
        cost: plannedUnitCostCents,
        price: plannedUnitPriceCents,

        // iOS-compatible planned material pricing snapshot
        plannedUnitCostCents,
        plannedUnitPriceCents,
        plannedTotalCostCents,
        plannedTotalPriceCents,
      });

      if (linkedTask?.id) {
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", linkedTask.id), {
          shoppingListItemId: id,
          shoppingListItemIds: arrayUnion(id),
        });
        setTaskList((prev) =>
          prev.map((task) =>
            task.id === linkedTask.id
              ? {
                ...task,
                shoppingListItemId: id,
                shoppingListItemIds: Array.from(new Set([...(task.shoppingListItemIds || []), id])),
              }
              : task
          )
        );
      }

      await recordJobHistory({
        eventType: "Planned Product",
        title: `Planned product added: ${materialName || "Unnamed Product"}`,
        description: materialDescription || "",
        changes: [
          buildHistoryChange("quantity", "Quantity", "—", qty),
          buildHistoryChange("status", "Status", "—", materialStatus),
          buildHistoryChange("plannedTotalCostCents", "Planned Cost", "—", moneyFromCents(plannedTotalCostCents)),
          buildHistoryChange("plannedTotalPriceCents", "Planned Billable", "—", moneyFromCents(plannedTotalPriceCents)),
        ],
        metadata: {
          shoppingListItemId: id,
          subCategory: shoppingFormData.subCategory,
          linkedTaskId: linkedTask?.id || "",
        },
      });

      const itemsRef = query(
        collection(db, "companies", recentlySelectedCompany, "shoppingList"),
        where("jobId", "==", jobId)
      );
      const itemsSnap = await getDocs(itemsRef);
      const items = itemsSnap.docs.map(withFirestoreDocId);
      setShoppingList(items);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: taskList,
        currentShoppingList: items,
      });

      toast.success("Added item");
      clearNewShoppingListItem({ preventDefault: () => { } });
    } catch (err) {
      console.error(err);
      toast.error("Failed to add item");
    }
  };

  const deleteShoppingListItem = async (e, id) => {
    e.preventDefault();
    try {
      const deletedItem = (shoppingList || []).find((item) => item.id === id);
      const linkedTaskId =
        deletedItem?.linkedTaskId ||
        deletedItem?.linkedJobTaskId ||
        deletedItem?.jobTaskId ||
        deletedItem?.sourceTaskId ||
        "";

      // fixed path bug: delete from shoppingList collection, not workOrders/{jobId}/items
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", id));

      if (linkedTaskId) {
        await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", linkedTaskId), {
          shoppingListItemId: "",
          shoppingListItemIds: arrayRemove(id),
        });
      }

      await recordJobHistory({
        eventType: "Planned Product",
        title: `Planned product deleted: ${deletedItem ? getMaterialName(deletedItem) : id}`,
        description: deletedItem?.description || "",
        metadata: { shoppingListItemId: id, linkedTaskId },
        severity: "danger",
      });

      const itemsRef = query(
        collection(db, "companies", recentlySelectedCompany, "shoppingList"),
        where("jobId", "==", jobId)
      );
      const itemsSnap = await getDocs(itemsRef);
      const items = itemsSnap.docs.map(withFirestoreDocId);
      setShoppingList(items);
      if (linkedTaskId) {
        setTaskList((prev) =>
          prev.map((task) =>
            task.id === linkedTaskId
              ? {
                ...task,
                shoppingListItemId: task.shoppingListItemId === id ? "" : task.shoppingListItemId,
                shoppingListItemIds: (task.shoppingListItemIds || []).filter((itemId) => itemId !== id),
              }
              : task
          )
        );
      }

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: taskList,
        currentShoppingList: items,
      });

      toast.success("Deleted item");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete item");
    }
  };

  const isShoppingListItemPurchased = (item) => {
    const status = String(item?.status || "").toLowerCase();
    return status === "purchased" || isShoppingListStatusClosed(status);
  };

  const markShoppingListItemPurchased = async (e, item) => {
    e.preventDefault();

    const shoppingListItemId = getFirestoreDocId(item);
    if (!recentlySelectedCompany || !jobId || !shoppingListItemId) return;
    if (isShoppingListItemPurchased(item)) return;

    const purchasedAt = new Date();
    const purchaserId = item.purchaserId || dataBaseUser?.id || dataBaseUser?.userId || getUserId() || "";
    const purchaserName = item.purchaserName || getAuditUserName();

    const firestoreUpdates = {
      status: "Purchased",
      datePurchased: Timestamp.fromDate(purchasedAt),
      purchasedAt: serverTimestamp(),
      purchasedByUserId: purchaserId,
      purchasedByUserName: purchaserName,
      purchaserId,
      purchaserName,
      needsAction: false,
      updatedAt: serverTimestamp(),
    };

    const stateUpdates = {
      status: "Purchased",
      datePurchased: purchasedAt,
      purchasedAt,
      purchasedByUserId: purchaserId,
      purchasedByUserName: purchaserName,
      purchaserId,
      purchaserName,
      needsAction: false,
      updatedAt: purchasedAt,
    };

    try {
      setMarkingPurchasedShoppingItemId(shoppingListItemId);

      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "shoppingList", shoppingListItemId),
        firestoreUpdates
      );

      const nextShoppingList = (shoppingList || []).map((shoppingItem) =>
        getFirestoreDocId(shoppingItem) === shoppingListItemId ? { ...shoppingItem, ...stateUpdates } : shoppingItem
      );
      setShoppingList(nextShoppingList);

      await recordJobHistory({
        eventType: "Planned Product",
        title: `Planned product purchased: ${getMaterialName(item)}`,
        description: item.description || "",
        changes: [
          buildHistoryChange("status", "Status", item.status || "Need to Purchase", "Purchased"),
          buildHistoryChange("datePurchased", "Date Purchased", item.datePurchased, purchasedAt),
          buildHistoryChange("purchaserName", "Purchaser", item.purchaserName || "—", purchaserName || "—"),
        ],
        metadata: {
          shoppingListItemId,
          linkedTaskId: item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.sourceTaskId || "",
        },
      });

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: taskList,
        currentShoppingList: nextShoppingList,
      });

      toast.success("Marked planned product as purchased");
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark product as purchased");
    } finally {
      setMarkingPurchasedShoppingItemId("");
    }
  };

  const getMaterialStatusClass = (status) => {
    switch (status) {
      case "Installed":
      case "installed":
      case "Delivered":
      case "delivered":
        return "bg-green-100 text-green-800 border-green-200";
      case "Purchased":
      case "purchased":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "Need to Purchase":
      case "Need To Purchase":
      case "needToPurchase":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "Needs Customer Approval":
      case "needsCustomerApproval":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "Ready to Purchase":
      case "readyToPurchase":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "Customer Rejected":
      case "customerRejected":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getShoppingDbItemById = (itemId) => {
    if (!itemId) return null;
    return (shoppingDbItemList || []).find((dbItem) => {
      return dbItem.id === itemId || dbItem.dbItemId === itemId || dbItem.value === itemId;
    }) || null;
  };

  const getMaterialName = (item) => {
    const dbItem = getShoppingDbItemById(item?.dbItemId || item?.itemId || item?.genericItemId);
    return item.name || item.dbItemName || item.itemName || dbItem?.name || "Unnamed Product";
  };

  const getMaterialQuantity = (item) => {
    const value = item.quantity ?? item.quantityString ?? "";
    return value === "" || value === null || value === undefined ? "—" : String(value);
  };

  const getPurchasedItemTotalCents = (item) => {
    const price = cents(item.price);
    const qty = quantityNumber(item.quantityString ?? item.quantity);
    return Math.round(price * qty);
  };

  const getPurchasedItemBillableTotalCents = (item) => {
    const isHandledByJob = item.billingOwner === "job" || item.assignedToJob || item.jobId || item.workOrderId;
    const isJobBillable = item.jobBillable ?? item.billable;
    if (!isHandledByJob || !isJobBillable) return 0;

    const unit =
      item.jobBillingRate !== undefined && item.jobBillingRate !== null
        ? cents(item.jobBillingRate)
        : item.billingRate !== undefined && item.billingRate !== null
          ? cents(item.billingRate)
          : cents(item.price);

    const qty = quantityNumber(item.quantityString ?? item.quantity);
    return Math.round(unit * qty);
  };

  const getPurchasedItemCategory = (item) => {
    return (
      item.category ||
      item.subCategory ||
      item.materialCategory ||
      item.itemCategory ||
      item.type ||
      "Uncategorized"
    );
  };

  const getPurchasedItemDateMillis = (item) => {
    const value = item.date || item.datePurchased || item.purchasedAt || item.createdAt || item.updatedAt;
    const date = value?.toDate?.() || (value instanceof Date ? value : value ? new Date(value) : null);
    const millis = date?.getTime?.();
    return Number.isFinite(millis) ? millis : 0;
  };

  const comparePurchasedItemText = (a, b, getValue) =>
    String(getValue(a) || "").localeCompare(String(getValue(b) || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });

  const getPurchasedItemPurchaserName = (item) => (
    item.purchaserName ||
    item.purchasedByUserName ||
    item.purchasedByName ||
    item.techName ||
    item.tech ||
    item.userName ||
    item.createdByUserName ||
    item.buyerName ||
    ""
  );

  const isPurchasedItemBillable = (item) => {
    return item.billable === true;
  };

  const isPurchasedItemNotBillable = (item) => {
    return item.billable === false;
  };

  const isPurchasedItemInvoiced = (item) => {
    if (item.jobInvoiced !== undefined && item.jobInvoiced !== null) return Boolean(item.jobInvoiced);
    if (item.invoiced !== undefined && item.invoiced !== null) return Boolean(item.invoiced);

    const invoiceStatus = String(item.invoiceStatus || item.billingStatus || "").toLowerCase();
    return invoiceStatus === "invoiced" || invoiceStatus === "paid" || Boolean(item.invoiceId || item.invoiceDocId);
  };

  const getPurchasedItemStandaloneStatus = (item = {}) => {
    if (item.returned) return "Returned";
    if (item.billable) return item.invoiced ? "Invoiced" : "Needs invoice";
    return "Non-billable";
  };

  const removePurchasedItemFromJob = async (item) => {
    const purchasedItemId = getFirestoreDocId(item);
    if (!recentlySelectedCompany || !jobId || !purchasedItemId) return;

    const ok = await appConfirm({
      title: "Remove Purchased Product",
      message: "Remove this purchased product from the job? The purchased item and receipt will stay in Purchases.",
      confirmLabel: "Remove Product",
      variant: "danger",
    });

    if (!ok) return;

    const linkedShoppingListItemId =
      item.shoppingListItemId || item.shoppingItemId || item.sourceShoppingListItemId || "";
    const nextStatus = getPurchasedItemStandaloneStatus(item);
    const purchaseStateUpdates = {
      jobId: "",
      workOrderId: "",
      assignedJobId: "",
      assignedToJob: false,
      assignmentStatus: "unassigned",
      billingOwner: "purchasedItem",
      jobBillingStatus: "",
      jobBillable: false,
      jobBillingRate: 0,
      jobInternalId: "",
      jobName: "",
      shoppingListItemId: "",
      status: nextStatus,
      updatedAt: new Date(),
    };
    const purchaseFirestoreUpdates = {
      ...purchaseStateUpdates,
      updatedAt: serverTimestamp(),
    };

    try {
      setRemovingPurchasedItemId(purchasedItemId);

      await updateDoc(
        doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchasedItemId),
        purchaseFirestoreUpdates
      );

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
        purchasedItemsIds: arrayRemove(purchasedItemId),
        ...(linkedShoppingListItemId ? { shoppingListItemIds: arrayRemove(linkedShoppingListItemId) } : {}),
      });

      if (linkedShoppingListItemId) {
        try {
          await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "shoppingList", linkedShoppingListItemId),
            {
              purchasedItem: "",
              purchasedItemId: "",
              updatedAt: serverTimestamp(),
            }
          );
        } catch (shoppingItemError) {
          console.warn("Could not clear linked planned material purchase reference:", shoppingItemError);
        }
      }

      setPurchasedItems((prev) =>
        (prev || []).filter((purchase) => getFirestoreDocId(purchase) !== purchasedItemId)
      );

      if (linkedShoppingListItemId) {
        setShoppingList((prev) =>
          (prev || []).map((shoppingItem) =>
            getFirestoreDocId(shoppingItem) === linkedShoppingListItemId
              ? {
                ...shoppingItem,
                purchasedItem: "",
                purchasedItemId: "",
                updatedAt: new Date(),
              }
              : shoppingItem
          )
        );
      }

      await recordJobHistory({
        eventType: "Purchased Product",
        title: "Purchased product removed",
        description: item.name || purchasedItemId,
        changes: [
          buildHistoryChange("purchasedItemsIds", "Purchased Product", item.name || purchasedItemId, "Removed"),
          buildHistoryChange("actualMaterialCost", "Actual Product Cost", moneyFromCents(getPurchasedItemTotalCents(item)), "—"),
          buildHistoryChange("status", "Purchase Status", item.status || "Connected to Job", nextStatus),
        ],
        metadata: {
          purchasedItemIds: [purchasedItemId],
          shoppingListItemId: linkedShoppingListItemId,
        },
        severity: "warning",
      });

      toast.success("Purchased product removed from job.");
    } catch (error) {
      console.error("Error removing purchased item from job:", error);
      toast.error("Failed to remove purchased product.");
    } finally {
      setRemovingPurchasedItemId("");
    }
  };

  const purchasedItemCategoryOptions = useMemo(() => {
    const categories = new Set(
      (availablePurchasedItems || [])
        .map(getPurchasedItemCategory)
        .filter(Boolean)
    );

    return ["All", ...Array.from(categories).sort((a, b) => a.localeCompare(b))];
  }, [availablePurchasedItems]);

  const filteredAvailablePurchasedItems = useMemo(() => {
    const normalizedSearchTerm = purchasedItemSearchTerm.trim().toLowerCase();
    const getSortTotalCents = (item) => {
      const price = Number(item.price || 0);
      const qty = Number(item.quantityString ?? item.quantity ?? 0);
      return Math.round((Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 0));
    };

    const filteredItems = (availablePurchasedItems || []).filter((item) => {
      const searchableText = [
        item.name,
        item.description,
        item.notes,
        item.venderName,
        item.vendorName,
        getPurchasedItemPurchaserName(item),
        item.invoiceNum,
        item.receiptNumber,
        item.sku,
        getPurchasedItemCategory(item),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const searchMatches = !normalizedSearchTerm || searchableText.includes(normalizedSearchTerm);
      const categoryMatches =
        purchasedItemCategoryFilter === "All" ||
        getPurchasedItemCategory(item) === purchasedItemCategoryFilter;
      const billableMatches =
        purchasedItemBillableFilter === "All" ||
        (purchasedItemBillableFilter === "Billable" && isPurchasedItemBillable(item)) ||
        (purchasedItemBillableFilter === "Not Billable" && isPurchasedItemNotBillable(item));
      const invoicedMatches =
        purchasedItemInvoicedFilter === "All" ||
        (purchasedItemInvoicedFilter === "Invoiced" && isPurchasedItemInvoiced(item)) ||
        (purchasedItemInvoicedFilter === "Not Invoiced" && !isPurchasedItemInvoiced(item));

      return searchMatches && categoryMatches && billableMatches && invoicedMatches;
    });

    return [...filteredItems].sort((a, b) => {
      const nameCompare = comparePurchasedItemText(a, b, (item) => item.name || "Purchased Item");

      if (purchasedItemSortBy === "date-asc") {
        return getPurchasedItemDateMillis(a) - getPurchasedItemDateMillis(b) || nameCompare;
      }
      if (purchasedItemSortBy === "name-asc") {
        return nameCompare || getPurchasedItemDateMillis(b) - getPurchasedItemDateMillis(a);
      }
      if (purchasedItemSortBy === "vendor-asc") {
        return comparePurchasedItemText(a, b, (item) => item.venderName || item.vendorName || "Vendor") || nameCompare;
      }
      if (purchasedItemSortBy === "total-desc") {
        return getSortTotalCents(b) - getSortTotalCents(a) || nameCompare;
      }
      if (purchasedItemSortBy === "total-asc") {
        return getSortTotalCents(a) - getSortTotalCents(b) || nameCompare;
      }

      return getPurchasedItemDateMillis(b) - getPurchasedItemDateMillis(a) || nameCompare;
    });
  }, [
    availablePurchasedItems,
    purchasedItemCategoryFilter,
    purchasedItemBillableFilter,
    purchasedItemInvoicedFilter,
    purchasedItemSearchTerm,
    purchasedItemSortBy,
  ]);

  const renderPlannedMaterialCard = (item) => {
    const itemId = getFirestoreDocId(item);
    const totalCostCents = getShoppingPlannedTotalCostCents(item);
    const totalPriceCents = getShoppingPlannedTotalPriceCents(item);
    const databaseItemId = item.dbItemId || item.itemId || item.dataBaseItemId || "";
    const linkedTaskId =
      item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.sourceTaskId || "";
    const linkedTask = linkedTaskId
      ? (taskList || []).find((task) => task.id === linkedTaskId)
      : null;
    const materialPurchased = isShoppingListItemPurchased(item);
    const isMarkingPurchased = markingPurchasedShoppingItemId === itemId;
    const isEditingMaterial = editingShoppingItemId === itemId;
    const materialStatusOptions = Array.from(
      new Set([shoppingEditForm.status, item.status, ...PLANNED_MATERIAL_STATUS_OPTIONS].filter(Boolean))
    );

    return (
      <div key={itemId} className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,auto)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${getMaterialStatusClass(item.status)}`}>
                {item.status || "Need to Purchase"}
              </span>

              {item.dbItemId && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                  Database
                </span>
              )}

              {item.invoiced && (
                <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                  Invoiced
                </span>
              )}

              {item.customerApprovalRequired && (
                <Link
                  to="/company/part-approvals"
                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
                >
                  Approval: {formatStatusLabel(item.customerApprovalStatus || "pending")}
                </Link>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate(`/company/shopping-list/detail/${itemId}`)}
              className="mt-1 block max-w-full truncate text-left text-sm font-bold text-slate-900 transition hover:text-blue-700"
            >
              {getMaterialName(item)}
            </button>

            <p className="mt-0.5 truncate text-xs text-slate-500">
              {item.subCategory || "Product"} • Qty: {getMaterialQuantity(item)}
              {(linkedTask || item.linkedTaskName) ? ` • Task: ${linkedTask?.name || item.linkedTaskName}` : ""}
            </p>

            {item.description && (
              <p className="mt-1 max-h-8 overflow-hidden text-xs text-slate-600">
                {item.description}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[340px]">
            <div className="rounded bg-slate-50 px-2 py-1.5">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Unit Cost</p>
              <p className="mt-0.5 font-bold text-slate-900">{moneyFromCents(item.plannedUnitCostCents ?? item.cost)}</p>
            </div>

            <div className="rounded bg-slate-50 px-2 py-1.5">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Total Cost</p>
              <p className="mt-0.5 font-bold text-slate-900">{moneyFromCents(totalCostCents)}</p>
            </div>

            <div className="rounded bg-blue-50 px-2 py-1.5">
              <p className="font-semibold uppercase tracking-wide text-blue-600">Unit Bill</p>
              <p className="mt-0.5 font-bold text-blue-900">{moneyFromCents(item.plannedUnitPriceCents ?? item.price)}</p>
            </div>

            <div className="rounded bg-blue-50 px-2 py-1.5">
              <p className="font-semibold uppercase tracking-wide text-blue-600">Total Bill</p>
              <p className="mt-0.5 font-bold text-blue-900">{moneyFromCents(totalPriceCents)}</p>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-1.5">
            {canUpdateCurrentJob && !isEditingMaterial && (
              <button
                type="button"
                onClick={() => startPlannedMaterialEdit(item)}
                disabled={savingShoppingEdit}
                className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Edit
              </button>
            )}

            {!materialPurchased && (
              <button
                type="button"
                onClick={(e) => markShoppingListItemPurchased(e, item)}
                disabled={isMarkingPurchased}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMarkingPurchased ? "Marking..." : "Purchased"}
              </button>
            )}

            <button
              type="button"
              onClick={(e) => deleteShoppingListItem(e, itemId)}
              className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
            >
              Delete
            </button>
          </div>
        </div>

        {isEditingMaterial && (
          <form onSubmit={(event) => savePlannedMaterialEdit(event, item)} className="mt-3 border-t border-blue-100 pt-3">
            <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Name
                  <input
                    type="text"
                    value={shoppingEditForm.name}
                    onChange={(event) => updateShoppingEditForm("name", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Status
                  <select
                    value={shoppingEditForm.status}
                    onChange={(event) => updateShoppingEditForm("status", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  >
                    {materialStatusOptions.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Quantity
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={shoppingEditForm.quantity}
                    onChange={(event) => updateShoppingEditForm("quantity", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Linked Task
                  <select
                    value={shoppingEditForm.linkedTaskId}
                    onChange={(event) => updateShoppingEditForm("linkedTaskId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  >
                    <option value="">No linked task</option>
                    {(taskList || []).map((task) => (
                      <option key={task.id} value={task.id}>
                        {[task.name || task.type || "Task", task.status || ""].filter(Boolean).join(" - ")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Unit Cost
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={shoppingEditForm.plannedUnitCost}
                    onChange={(event) => updateShoppingEditForm("plannedUnitCost", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Unit Billing Price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={shoppingEditForm.plannedUnitPrice}
                    onChange={(event) => updateShoppingEditForm("plannedUnitPrice", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  />
                </label>

                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 md:col-span-2">
                  Description
                  <input
                    type="text"
                    value={shoppingEditForm.description}
                    onChange={(event) => updateShoppingEditForm("description", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(shoppingEditForm.customerApprovalRequired)}
                      onChange={(event) => updateShoppingEditForm("customerApprovalRequired", event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Require customer approval
                  </label>

                  {databaseItemId && (
                    <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      <input
                        type="checkbox"
                        checked={Boolean(shoppingEditForm.updateDatabaseItem)}
                        onChange={(event) => updateShoppingEditForm("updateDatabaseItem", event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      />
                      Update database item
                    </label>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => cancelPlannedMaterialEdit()}
                    disabled={savingShoppingEdit}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingShoppingEdit}
                    className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingShoppingEdit ? "Saving..." : "Save Product"}
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}

        {(item.purchaserName || (materialPurchased && item.datePurchased)) && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
            {item.purchaserName && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                Purchaser: {item.purchaserName}
              </span>
            )}

            {materialPurchased && item.datePurchased && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                Purchased: {formatDateValue(item.datePurchased)}
              </span>
            )}
          </div>
        )}

      </div>
    );
  };

  const renderPurchasedMaterialCard = (item) => {
    const totalCostCents = getPurchasedItemTotalCents(item);
    const billableTotalCents = getPurchasedItemBillableTotalCents(item);
    const databaseItemId =
      item.itemId || item.dataBaseItemId || item.databaseItemId || item.dbItemId || item.genericItemId || "";
    const purchasedItemId = getFirestoreDocId(item);
    const purchasedItemPath = purchasedItemId ? `/company/purchased-items/detail/${purchasedItemId}` : "";
    const databaseItemPath = databaseItemId ? `/company/items/detail/${databaseItemId}` : "";
    const salesInvoiceId = item.invoiceId || item.invoiceRef || item.invoiceDocId || "";
    const invoicePath = item.receiptId
      ? `/company/receipts/detail/${item.receiptId}`
      : salesInvoiceId
        ? `/company/sales/invoices/${salesInvoiceId}`
        : "";
    const invoiceLabel = item.invoiceNum || item.invoiceNumber || salesInvoiceId;
    const billingRateLabel = moneyFromCents(billableTotalCents);
    const isRemoving = removingPurchasedItemId === purchasedItemId;

    return (
      <div
        key={item.id}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Purchased Product
            </p>

            <p className="mt-1 text-base font-bold text-gray-800">
              {purchasedItemPath ? (
                <Link to={purchasedItemPath} className="text-blue-700 hover:text-blue-900 hover:underline">
                  {item.name || "Purchased Item"}
                </Link>
              ) : (
                item.name || "Purchased Item"
              )}
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
              <span>{item.venderName || item.vendorName || "Vendor"}</span>
              <span aria-hidden="true">•</span>
              <span>Qty: {item.quantityString || item.quantity || "—"}</span>
              <span aria-hidden="true">•</span>
              <span>Unit Cost: {moneyFromCents(item.price)}</span>
              <span aria-hidden="true">•</span>
              <span>Total Cost: {moneyFromCents(totalCostCents)}</span>
              <span aria-hidden="true">•</span>
              <span>Total Billing Rate: {billingRateLabel}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {(item.jobBillable ?? item.billable) && (
              <span className="px-3 py-1 text-xs font-bold rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                Job Billable
              </span>
            )}

            <span className="px-3 py-1 text-xs font-bold rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
              Billing By Job
            </span>

            <button
              type="button"
              onClick={() => removePurchasedItemFromJob(item)}
              disabled={isRemoving}
              title="Remove purchased product from this job"
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {isRemoving ? "Removing..." : "Remove"}
            </button>
          </div>
        </div>

        {(invoiceLabel || item.sku) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {invoiceLabel && (
              invoicePath ? (
                <Link
                  to={invoicePath}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-blue-700 border border-gray-200 hover:bg-blue-50 hover:border-blue-200"
                >
                  Invoice: {invoiceLabel}
                </Link>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                  Invoice: {invoiceLabel}
                </span>
              )
            )}

            {item.sku && (
              databaseItemPath ? (
                <Link
                  to={databaseItemPath}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-blue-700 border border-gray-200 hover:bg-blue-50 hover:border-blue-200"
                >
                  SKU: {item.sku}
                </Link>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                  SKU: {item.sku}
                </span>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  const dateRangeBounds = (startValue, endValue) => {
    const start = new Date(`${startValue}T00:00:00`);
    const end = new Date(`${endValue}T23:59:59.999`);
    return { start, end };
  };

  const loadAvailablePurchasedItems = async () => {
    if (!recentlySelectedCompany) return;

    try {
      setLoadingAvailablePurchasedItems(true);
      setSelectedPurchasedItemIds([]);

      const { start, end } = dateRangeBounds(purchasedItemStartDate, purchasedItemEndDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        toast.error("Select a valid purchased item date range.");
        return;
      }

      const itemsQ = query(
        purchasedItemsPath(recentlySelectedCompany),
        where("date", ">=", start),
        where("date", "<=", end),
        orderBy("date", "desc")
      );

      const snap = await getDocs(itemsQ);
      setAvailablePurchasedItems(
        snap.docs
          .map(withFirestoreDocId)
          .filter((item) => !(item.jobId || item.workOrderId || item.assignedToJob || item.assignmentStatus === "assignedToJob"))
      );
    } catch (error) {
      console.error("Error loading unassigned purchased items:", error);
      toast.error("Failed to load unassigned purchased items.");
    } finally {
      setLoadingAvailablePurchasedItems(false);
    }
  };

  const openPurchasedItemPicker = () => {
    setShowPurchasedItemPicker(true);
    if (availablePurchasedItems.length === 0) {
      loadAvailablePurchasedItems();
    }
  };

  const closePurchasedItemPicker = () => {
    setShowPurchasedItemPicker(false);
    setSelectedPurchasedItemIds([]);
    setPurchasedItemSearchTerm("");
  };

  const togglePurchasedItemSelection = (itemId) => {
    setSelectedPurchasedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const attachPurchasedItemsToJob = async () => {
    if (!recentlySelectedCompany || !jobId) return;
    if (!selectedPurchasedItemIds.length) return toast.error("Select at least one purchased item.");

    try {
      const selectedItems = availablePurchasedItems.filter((item) => selectedPurchasedItemIds.includes(item.id));
      const shouldMarkInvoiced = jobBillingIsInvoiced();
      const invoiceId = job.salesInvoiceId || job.invoiceRef || "";
      const invoiceState = shouldMarkInvoiced
        ? purchasedItemInvoiceState({ invoiceId, invoiceType: job.invoiceType || "job" })
        : {};

      await Promise.all(
        selectedItems.map(async (item) => {
          const purchasedItemId = getFirestoreDocId(item);
          const itemUpdates = {
            jobId,
            workOrderId: jobId,
            assignedJobId: jobId,
            assignedToJob: true,
            assignmentStatus: "assignedToJob",
            billingOwner: "job",
            jobBillingStatus: shouldMarkInvoiced ? "invoiced" : "handledByJob",
            jobBillable: Boolean(item.jobBillable ?? item.billable ?? true),
            jobBillingRate: cents(item.jobBillingRate ?? item.billingRate ?? item.price),
            status: shouldMarkInvoiced ? "Invoiced" : "Connected to Job",
            ...(shouldMarkInvoiced
              ? purchasedItemInvoiceUpdates({ invoiceId, invoiceType: job.invoiceType || "job" })
              : {}),
          };

          await updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", purchasedItemId), itemUpdates);

          if (item.shoppingListItemId) {
            await syncLinkedShoppingPurchase({
              db,
              companyId: recentlySelectedCompany,
              purchasedItemId,
              shoppingItemId: item.shoppingListItemId,
              purchasedItemData: {
                ...item,
                ...itemUpdates,
                ...invoiceState,
                id: purchasedItemId,
              },
              invoiced: shouldMarkInvoiced ? true : undefined,
              preferPurchasedContext: true,
            });
          }
        })
      );

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
        purchasedItemsIds: arrayUnion(...selectedPurchasedItemIds),
      });

      setPurchasedItems((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        return [
          ...selectedItems.map((item) => ({
            ...item,
            jobId,
            workOrderId: jobId,
            assignedJobId: jobId,
            assignedToJob: true,
            assignmentStatus: "assignedToJob",
            billingOwner: "job",
            jobBillingStatus: shouldMarkInvoiced ? "invoiced" : "handledByJob",
            jobBillable: Boolean(item.jobBillable ?? item.billable ?? true),
            jobBillingRate: cents(item.jobBillingRate ?? item.billingRate ?? item.price),
            status: shouldMarkInvoiced ? "Invoiced" : "Connected to Job",
            ...invoiceState,
          })),
          ...prev.filter((item) => !selectedPurchasedItemIds.includes(item.id)),
        ].filter((item) => {
          if (!existingIds.has(item.id)) return true;
          return !selectedPurchasedItemIds.includes(item.id);
        });
      });
      setAvailablePurchasedItems((prev) => prev.filter((item) => !selectedPurchasedItemIds.includes(item.id)));
      await recordJobHistory({
        eventType: "Purchased Product",
        title: `${selectedItems.length} purchased product item(s) attached`,
        description: selectedItems.map((item) => item.name || item.id).filter(Boolean).join(", "),
        changes: [
          buildHistoryChange(
            "actualMaterialCost",
            "Actual Product Cost",
            "—",
            moneyFromCents(selectedItems.reduce((total, item) => total + getPurchasedItemTotalCents(item), 0))
          ),
        ],
        metadata: { purchasedItemIds: selectedPurchasedItemIds },
      });
      setSelectedPurchasedItemIds([]);
      setShowPurchasedItemPicker(false);
      setPurchasedItemSearchTerm("");
      toast.success("Purchased item attached to job.");
    } catch (error) {
      console.error("Error attaching purchased items:", error);
      toast.error("Failed to attach purchased items.");
    }
  };

  const renderAvailablePurchasedItemPickerRow = (item) => {
    const checked = selectedPurchasedItemIds.includes(item.id);
    const date = item.date?.toDate ? item.date.toDate() : item.date;
    const dateLabel = date ? format(new Date(date), "MMM d, yyyy") : "No date";
    const purchaserName = getPurchasedItemPurchaserName(item) || "—";

    return (
      <label
        key={item.id}
        className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:bg-blue-50 transition cursor-pointer"
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => togglePurchasedItemSelection(item.id)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div>
              <p className="font-bold text-gray-800">{item.name || "Purchased Item"}</p>
              <p className="text-sm text-gray-600">
                {item.venderName || item.vendorName || "Vendor"} • {dateLabel} • Qty: {item.quantityString || item.quantity || "—"}
              </p>
              <p className="mt-0.5 text-xs font-medium text-gray-500">
                Purchased by: {purchaserName}
              </p>
            </div>
            <p className="font-semibold text-gray-800">{moneyFromCents(getPurchasedItemTotalCents(item))}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
              {getPurchasedItemCategory(item)}
            </span>
            <span
              className={[
                "px-2 py-1 rounded-full text-xs font-semibold border",
                isPurchasedItemBillable(item)
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-gray-100 text-gray-700 border-gray-200",
              ].join(" ")}
            >
              {isPurchasedItemBillable(item) ? "Billable" : "Not Billable"}
            </span>
            <span
              className={[
                "px-2 py-1 rounded-full text-xs font-semibold border",
                isPurchasedItemInvoiced(item)
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-amber-50 text-amber-700 border-amber-200",
              ].join(" ")}
            >
              {isPurchasedItemInvoiced(item) ? "Invoiced" : "Not Invoiced"}
            </span>
          </div>
          {(item.invoiceNum || item.sku) && (
            <p className="mt-2 text-xs text-gray-500">
              {[item.invoiceNum ? `Invoice: ${item.invoiceNum}` : "", item.sku ? `SKU: ${item.sku}` : ""].filter(Boolean).join(" • ")}
            </p>
          )}
        </div>
      </label>
    );
  };

  const openInMaps = () => {
    const address = `${serviceLocation.streetAddress} ${serviceLocation.city} ${serviceLocation.state} ${serviceLocation.zip}`.trim();
    const urlAddress = encodeURIComponent(address);
    const url = `https://www.google.com/maps/place/${urlAddress}`;
    window.open(url, "_blank");
  };

  const createDraftServiceAgreement = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;
      const draftSource = {
        ...draftContractData,
        status: SalesAgreementStatus.draft,
        rateAmountCents: centsFromCurrencyInput(draftContractData.rate),
        totalAmountCents: centsFromCurrencyInput(draftContractData.rate),
      };

      const salesAgreement = await ensureJobSalesAgreement({
        sourceRecord: draftSource,
        forceNew: true,
        status: SalesAgreementStatus.draft,
      });

      await recordJobHistory({
        eventType: "Billing",
        title: "Service agreement draft created",
        description: salesAgreement.description || salesAgreement.termsSummary || "",
        changes: [
          buildHistoryChange("rate", "Agreement Total", "—", moneyFromCents(salesAgreement.totalAmountCents || 0)),
          buildHistoryChange("version", "Version", "—", draftContractData.version || 1),
        ],
        metadata: { salesAgreementId: salesAgreement.id },
      });

      toast.success("Draft service agreement created");
      setSelectedSalesAgreementId(salesAgreement.id);
      setShowCreateContractModal(false);
      handleJobTabChange("Billing");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create draft service agreement");
    }
  };

  const handleSendEstimate = async () => {
    if (salesWorkflowEnabled) {
      if (sendingEstimateEmail) return;

      try {
        if (!recentlySelectedCompany || !jobId) return;

        setSendingEstimateEmail(true);
        const refreshedPlan = await refreshEditorPlanBeforeEstimate();
        const salesAgreement = await ensureJobSalesAgreement({
          planOptionOverrides: refreshedPlan ? [refreshedPlan] : [],
        });
        const sendCallable = httpsCallable(functions, "sendServiceAgreementEmail");
        const authPayload = await getCallableAuthPayload();
        const sendResult = await sendCallable({
          companyId: recentlySelectedCompany,
          agreementId: salesAgreement.id,
          agreementBaseUrl: window.location.origin,
          ...authPayload,
        });

        const nextOperationStatus = suggestOperationForBilling(
          "Estimate",
          job.operationStatus || "Estimate Pending"
        );
        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

        await updateDoc(jobRef, {
          billingStatus: "Estimate",
          operationStatus: nextOperationStatus,
          salesAgreementId: salesAgreement.id,
          salesEstimateAgreementId: salesAgreement.id,
        });

        if (selectedContract?.id) {
          await updateDoc(doc(db, "contracts", selectedContract.id), {
            status: "Sent",
            dateSent: serverTimestamp(),
            salesAgreementId: salesAgreement.id,
            updatedAt: serverTimestamp(),
          });
        }

        setJob((prev) => ({
          ...prev,
          billingStatus: "Estimate",
          operationStatus: nextOperationStatus,
          salesAgreementId: salesAgreement.id,
          salesEstimateAgreementId: salesAgreement.id,
        }));
        setSelectedBillingStatus({ value: "Estimate", label: "Estimate" });
        setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
        await recordJobHistory({
          eventType: "Billing",
          title: "Estimate emailed through Sales",
          description: sendResult.data?.testMode
            ? `Test email sent to ${sendResult.data.to}. Intended customer: ${sendResult.data.intendedTo}.`
            : `Estimate sent to ${sendResult.data?.to || getCustomerEmail()}.`,
          changes: [
            buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Estimate"),
            buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", nextOperationStatus),
          ],
          metadata: {
            salesAgreementId: salesAgreement.id,
            contractId: selectedContract?.id || "",
            emailResult: sendResult.data || {},
            featureFlagId: "feature_flag_004",
            salesWorkflowFeatureFlagId: "feature_flag_004",
            realEmailsFeatureFlagId: sendResult.data?.realEmailsFeatureFlagId || "feature_flag_012",
            realEmailsEnabled: sendResult.data?.realEmailsEnabled === true,
          },
        });

        if (sendResult.data?.testMode) {
          toast.success(`Sales estimate test email sent to ${sendResult.data.to}.`);
        } else {
          toast.success("Sales estimate email sent to customer.");
        }
      } catch (err) {
        console.error(err);
        toast.error(err.message || "Failed to send sales estimate email");
      } finally {
        setSendingEstimateEmail(false);
      }
      return;
    }

    try {
      if (!recentlySelectedCompany || !jobId) return;
      if (!selectedContract) return toast.error("Select a contract first");

      const contractRef = doc(
        db,
        "contracts",
        selectedContract.id
      );

      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

      await updateDoc(contractRef, {
        status: "Sent",
        dateSent: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const nextOperationStatus = suggestOperationForBilling(
        "Estimate",
        job.operationStatus || "Estimate Pending"
      );

      await updateDoc(jobRef, {
        billingStatus: "Estimate",
        operationStatus: nextOperationStatus,
      });

      setJob((prev) => ({
        ...prev,
        billingStatus: "Estimate",
        operationStatus: nextOperationStatus,
      }));
      setSelectedBillingStatus({ value: "Estimate", label: "Estimate" });
      setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
      await recordJobHistory({
        eventType: "Billing",
        title: "Estimate sent",
        changes: [
          buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Estimate"),
          buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", nextOperationStatus),
        ],
        metadata: { contractId: selectedContract.id },
      });

      toast.success("Estimate marked as sent");
    } catch (err) {
      console.error(err);
      toast.error("Failed to send estimate");
    }
  };
  const loadJobWorkflowData = async ({
    companyId,
    currentJobId,
    currentTaskList = [],
    currentShoppingList = [],
    currentServiceStops = serviceStops,
  }) => {
    const plannedStopsSnap = await getDocs(plannedServiceStopsPath(companyId, currentJobId));
    const plannedStops = plannedStopsSnap.docs
      .map(withFirestoreDocId)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

    setPlannedServiceStops(plannedStops);

    const workOffersQ = query(
      workOffersPath(companyId),
      where("jobId", "==", currentJobId)
    );

    const workOffersSnap = await getDocs(workOffersQ);
    const offers = workOffersSnap.docs
      .map(withFirestoreDocId)
      .sort((a, b) => {
        const aDate = a.createdAt?.toDate?.()?.getTime?.() || 0;
        const bDate = b.createdAt?.toDate?.()?.getTime?.() || 0;
        return bDate - aDate;
      });

    setWorkOffers(offers);

    const purchasedItemsQ = query(
      purchasedItemsPath(companyId),
      where("jobId", "==", currentJobId)
    );

    const purchasedItemsSnap = await getDocs(purchasedItemsQ);
    const purchased = purchasedItemsSnap.docs.map(withFirestoreDocId);

    setPurchasedItems(purchased);

    const serviceStopIdsForPayroll = Array.from(
      new Set((currentServiceStops || []).map((stop) => stop.id).filter(Boolean))
    );
    const payrollLines = [];

    for (let i = 0; i < serviceStopIdsForPayroll.length; i += 10) {
      const idChunk = serviceStopIdsForPayroll.slice(i, i + 10);
      if (!idChunk.length) continue;

      const payrollSnap = await getDocs(
        query(
          payLineItemsPath(companyId),
          where("serviceStopId", "in", idChunk)
        )
      );

      payrollSnap.docs.forEach((d) => {
        payrollLines.push({ ...d.data(), id: d.data().id || d.id });
      });
    }

    setActualPayLineItems(
      payrollLines.sort((a, b) => {
        const aDate = a.completedDate?.toDate?.()?.getTime?.() || 0;
        const bDate = b.completedDate?.toDate?.()?.getTime?.() || 0;
        return bDate - aDate;
      })
    );


    return {
      plannedStops,
      offers,
      purchased,
      payrollLines,
    };
  };

  const promoteAcceptedPlanForEstimate = async (agreementRecord = {}) => {
    const selectedPlanId =
      agreementRecord.selectedPlanId ||
      agreementRecord.selectedSolutionId ||
      agreementRecord.acceptedPlanId ||
      agreementRecord.acceptedSolutionId ||
      job.acceptedPlanId ||
      job.acceptedSolutionId ||
      job.activePlanId ||
      job.activeSolutionId ||
      activePlan?.id ||
      "";
    const solution =
      (jobPlans || []).find((option) => option.id === selectedPlanId) ||
      activePlan ||
      null;

    if (!solution) {
      return markShoppingItemsReadyForAcceptedEstimate();
    }

    const result = await promotePlanToActiveWork(solution, {
      updateBillingStatus: false,
      historyTitle: `Accepted plan promoted: ${getJobPlanDisplayName(solution, "Untitled Plan")}`,
    });

    return result.readyShoppingItemCount || 0;
  };

  const handleMarkEstimateAccepted = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;

      if (salesWorkflowEnabled) {
        const salesAgreement = selectedSalesAgreement || await ensureJobSalesAgreement();
        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        const nextOperationStatus =
          !job.operationStatus || job.operationStatus === "Estimate Pending"
            ? "Unscheduled"
            : job.operationStatus;

        await updateDoc(doc(db, salesCollectionNames.agreements, salesAgreement.id), {
          status: SalesAgreementStatus.accepted,
          acceptedAt: serverTimestamp(),
          acceptedByUserId: getUserId() || "",
          acceptedByUserName: getUserName(),
          updatedAt: serverTimestamp(),
        });

        if (selectedContract?.id) {
          await updateDoc(doc(db, "contracts", selectedContract.id), {
            status: "Accepted",
            receiverAcceptance: true,
            dateAccepted: serverTimestamp(),
            salesAgreementId: salesAgreement.id,
            updatedAt: serverTimestamp(),
          });
        }

        await updateDoc(jobRef, {
          billingStatus: "Accepted",
          operationStatus: nextOperationStatus,
          salesAgreementId: salesAgreement.id,
          salesEstimateAgreementId: salesAgreement.id,
        });
        const readyShoppingItemCount = await promoteAcceptedPlanForEstimate(salesAgreement);

        setJob((prev) => ({
          ...prev,
          billingStatus: "Accepted",
          operationStatus: !prev.operationStatus || prev.operationStatus === "Estimate Pending"
            ? "Unscheduled"
            : prev.operationStatus,
          salesAgreementId: salesAgreement.id,
          salesEstimateAgreementId: salesAgreement.id,
        }));
        setLinkedSalesAgreement({
          ...salesAgreement,
          status: SalesAgreementStatus.accepted,
        });
        setSelectedSalesAgreementId(salesAgreement.id);
        setSelectedBillingStatus({ value: "Accepted", label: "Accepted" });
        if (!job.operationStatus || job.operationStatus === "Estimate Pending") {
          setSelectedOperationStatus({ value: "Unscheduled", label: "Unscheduled" });
        }
        await recordJobHistory({
          eventType: "Billing",
          title: "Service agreement accepted",
          changes: [
            buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Accepted"),
            buildHistoryChange(
              "operationStatus",
              "Operation Status",
              job.operationStatus || "—",
              nextOperationStatus
            ),
          ],
          metadata: {
            salesAgreementId: salesAgreement.id,
            contractId: selectedContract?.id || "",
            readyShoppingItemCount,
          },
        });
        await addEstimateAcceptedJobComment({
          title: "Service agreement accepted",
          salesAgreementId: salesAgreement.id,
          contractId: selectedContract?.id || "",
          readyShoppingItemCount,
        });

        toast.success("Service agreement marked as accepted");
        return;
      }

      if (selectedContract) {
        const contractRef = doc(
          db,
          "contracts",
          selectedContract.id
        );
        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

        await updateDoc(contractRef, {
          status: "Accepted",
          receiverAcceptance: true,
          dateAccepted: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await updateDoc(jobRef, {
          billingStatus: "Accepted",
          operationStatus: job.operationStatus === "Estimate Pending" ? "Unscheduled" : job.operationStatus,
        });
        const readyShoppingItemCount = await promoteAcceptedPlanForEstimate(selectedContract);

        setJob((prev) => ({
          ...prev,
          billingStatus: "Accepted",
          operationStatus:
            prev.operationStatus === "Estimate Pending" ? "Unscheduled" : prev.operationStatus,
        }));
        setSelectedBillingStatus({ value: "Accepted", label: "Accepted" });
        if (job.operationStatus === "Estimate Pending") {
          setSelectedOperationStatus({ value: "Unscheduled", label: "Unscheduled" });
        }
        await recordJobHistory({
          eventType: "Billing",
          title: "Estimate accepted",
          changes: [
            buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Accepted"),
            buildHistoryChange(
              "operationStatus",
              "Operation Status",
              job.operationStatus || "—",
              job.operationStatus === "Estimate Pending" ? "Unscheduled" : job.operationStatus
            ),
          ],
          metadata: { contractId: selectedContract.id, readyShoppingItemCount },
        });
        await addEstimateAcceptedJobComment({
          contractId: selectedContract.id,
          readyShoppingItemCount,
        });

        toast.success("Estimate marked as accepted");
      } else {
        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        await updateDoc(jobRef, { billingStatus: "Accepted", operationStatus: "Unscheduled" });
        const readyShoppingItemCount = await promoteAcceptedPlanForEstimate();
        setJob((prev) => ({ ...prev, billingStatus: "Accepted", operationStatus: "Unscheduled" }));
        setSelectedBillingStatus({ value: "Accepted", label: "Accepted" });
        setSelectedOperationStatus({ value: "Unscheduled", label: "Unscheduled" });
        await recordJobHistory({
          eventType: "Billing",
          title: "Estimate accepted",
          changes: [
            buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Accepted"),
            buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", "Unscheduled"),
          ],
          metadata: { readyShoppingItemCount },
        });
        await addEstimateAcceptedJobComment({
          readyShoppingItemCount,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark estimate accepted");
    }
  };

  const StatCard = ({ title, value, subtitle, tone = "gray" }) => {
    const toneClass =
      tone === "green"
        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
        : tone === "red"
          ? "bg-rose-50 border-rose-200 text-rose-800"
          : tone === "blue"
            ? "bg-blue-50 border-blue-200 text-blue-800"
            : tone === "amber"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-slate-50 border-slate-200 text-slate-800";

    return (
      <div className={`min-w-0 rounded-md border px-2.5 py-2 ${toneClass}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {title}
        </p>
        <p className="mt-0.5 truncate text-sm font-bold leading-tight">
          {value}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[11px] leading-snug opacity-80">
            {subtitle}
          </p>
        )}
      </div>
    );
  };

  const SectionSkeleton = ({ title = "Loading section", rows = 3 }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="animate-pulse space-y-3">
        <div>
          <div className="h-4 w-36 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-56 rounded bg-slate-100" />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={`${title}-${index}`} className="rounded-md border border-slate-100 bg-slate-50 p-3">
              <div className="h-3 w-16 rounded bg-slate-200" />
              <div className="mt-2 h-4 w-24 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-20 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const DetailDisclosure = useCallback(({ panelId, title, helper = "", count = "", children }) => {
    const isOpen = Boolean(openDetailPanels[panelId]);

    return (
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setOpenDetailPanels((prev) => ({ ...prev, [panelId]: !isOpen }))}
          className={[
            "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left shadow-sm transition",
            isOpen
              ? "border-blue-200 bg-blue-50 text-blue-900"
              : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
          ].join(" ")}
          aria-expanded={isOpen}
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{title}</span>
              {count !== "" && count !== null && count !== undefined && (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                  {count}
                </span>
              )}
            </span>
            {helper && <span className="mt-0.5 block text-xs font-medium text-slate-500">{helper}</span>}
          </span>
          <ChevronDownIcon
            className={[
              "h-5 w-5 shrink-0 text-slate-500 transition-transform",
              isOpen ? "rotate-180" : "",
            ].join(" ")}
            aria-hidden="true"
          />
        </button>
        <div className={isOpen ? "space-y-2" : "hidden"}>{children}</div>
      </section>
    );
  }, [openDetailPanels]);

  const renderShoppingDatabaseItemCreator = () => (
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h5 className="text-sm font-bold text-slate-950">New Database Item</h5>
          <p className="mt-1 text-xs text-slate-600">
            Create a catalog item, then use it for this planned product.
          </p>
        </div>
        <button
          type="button"
          onClick={resetShoppingDbItemCreator}
          disabled={savingShoppingDbItem}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel New Item
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className={fieldLabelClass}>
          Item Name
          <input
            className={fieldInputClass}
            type="text"
            value={shoppingDbItemForm.name}
            onChange={(e) => handleShoppingDbItemFormChange("name", e.target.value)}
            placeholder="Chlorine tabs"
          />
        </label>

        <label className={fieldLabelClass}>
          SKU
          <input
            className={fieldInputClass}
            type="text"
            value={shoppingDbItemForm.sku}
            onChange={(e) => handleShoppingDbItemFormChange("sku", e.target.value)}
            placeholder="SKU-1234"
          />
        </label>

        <label className={fieldLabelClass}>
          Unit Cost
          <input
            className={fieldInputClass}
            type="number"
            min="0"
            step="0.01"
            value={shoppingDbItemForm.rate}
            onChange={(e) => handleShoppingDbItemFormChange("rate", e.target.value)}
            placeholder="0.00"
          />
        </label>

        <label className="flex items-center gap-3 self-end rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(shoppingDbItemForm.billable)}
            onChange={(e) => handleShoppingDbItemFormChange("billable", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Billable to customer
        </label>

        {shoppingDbItemForm.billable && (
          <label className={fieldLabelClass}>
            Sell Price
            <input
              className={fieldInputClass}
              type="number"
              min="0"
              step="0.01"
              value={shoppingDbItemForm.sellPrice}
              onChange={(e) => handleShoppingDbItemFormChange("sellPrice", e.target.value)}
              placeholder="0.00"
            />
          </label>
        )}

        <label className={fieldLabelClass}>
          Vendor
          <div className="mt-1 normal-case tracking-normal">
            <Select
              value={shoppingDbItemForm.vendor}
              options={shoppingDbItemVendorList}
              onChange={(option) => handleShoppingDbItemFormChange("vendor", option)}
              isSearchable
              isClearable
              placeholder="Select vendor"
              theme={selectTheme}
              styles={selectStyles}
            />
          </div>
        </label>

        <label className={fieldLabelClass}>
          U.O.M.
          <div className="mt-1 normal-case tracking-normal">
            <Select
              value={shoppingDbItemForm.uom}
              options={UOM_OPTIONS}
              onChange={(option) => handleShoppingDbItemFormChange("uom", option || DEFAULT_UOM)}
              isSearchable
              placeholder="Select UOM"
              theme={selectTheme}
              styles={selectStyles}
            />
          </div>
        </label>

        <label className={fieldLabelClass}>
          Category
          <div className="mt-1 normal-case tracking-normal">
            <Select
              value={shoppingDbItemForm.category}
              options={CATEGORY_OPTIONS}
              onChange={(option) => handleShoppingDbItemFormChange("category", option || DEFAULT_CATEGORY)}
              isSearchable
              placeholder="Select category"
              theme={selectTheme}
              styles={selectStyles}
            />
          </div>
        </label>

        <label className={fieldLabelClass}>
          Sub-category
          <div className="mt-1 normal-case tracking-normal">
            <Select
              value={shoppingDbItemForm.subcategory}
              options={SUBCATEGORY_OPTIONS}
              onChange={(option) => handleShoppingDbItemFormChange("subcategory", option || DEFAULT_SUBCATEGORY)}
              isSearchable
              placeholder="Select sub-category"
              theme={selectTheme}
              styles={selectStyles}
            />
          </div>
        </label>

        <label className={fieldLabelClass}>
          Color
          <input
            className={fieldInputClass}
            type="text"
            value={shoppingDbItemForm.color}
            onChange={(e) => handleShoppingDbItemFormChange("color", e.target.value)}
            placeholder="White"
          />
        </label>

        <label className={fieldLabelClass}>
          Size
          <input
            className={fieldInputClass}
            type="text"
            value={shoppingDbItemForm.size}
            onChange={(e) => handleShoppingDbItemFormChange("size", e.target.value)}
            placeholder="25 lb"
          />
        </label>

        <label className={fieldLabelClass}>
          Tracking
          <input
            className={fieldInputClass}
            type="text"
            value={shoppingDbItemForm.tracking}
            onChange={(e) => handleShoppingDbItemFormChange("tracking", e.target.value)}
            placeholder="Optional tracking/template ID"
          />
        </label>

        <label className={`${fieldLabelClass} md:col-span-2`}>
          Description
          <textarea
            className={`${fieldInputClass} min-h-[88px]`}
            value={shoppingDbItemForm.description}
            onChange={(e) => handleShoppingDbItemFormChange("description", e.target.value)}
            placeholder="Short description"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={resetShoppingDbItemCreator}
          disabled={savingShoppingDbItem}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreateShoppingDatabaseItem}
          disabled={!canCreateShoppingDbItem}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          {savingShoppingDbItem ? "Creating..." : "Create Database Item"}
        </button>
      </div>
    </div>
  );


  const getOfferStatusClass = (status) => {
    switch (status) {
      case "Accepted":
      case "accepted":
        return "bg-green-100 text-green-800 border-green-200";
      case "Posted":
      case "posted":
      case "Sent":
      case "sent":
      case "Viewed":
      case "viewed":
      case "Draft":
      case "draft":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "Declined":
      case "declined":
      case "Canceled":
      case "cancelled":
        return "bg-red-100 text-red-800 border-red-200";
      case "Pending":
      case "pending":
      case "Open":
      case "open":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "Scheduled":
      case "scheduled":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getOfferTargetText = (offer) => {
    if (offer.offeredToUserName) return offer.offeredToUserName;
    if (offer.receiverName) return offer.receiverName;
    if (offer.workerName) return offer.workerName;
    if (offer.companyUserName) return offer.companyUserName;
    if (offer.boardName) return offer.boardName;
    if (offer.postedToBoard || offer.isBoardPost || offer.offerType === "Board" || offer.offerType === "Internal Board") return "Internal Board";
    return "Unassigned";
  };

  const getOfferTaskCount = (offer) => {
    if (Array.isArray(offer.taskIds)) return offer.taskIds.length;
    if (Array.isArray(offer.jobTaskIds)) return offer.jobTaskIds.length;
    if (Array.isArray(offer.tasks)) return offer.tasks.length;
    return 0;
  };

  const getOfferEstimatedPayCents = (offer) => {
    return cents(
      offer.estimatedPayCents ??
      offer.estimatedPayTotalCents ??
      offer.estimatedLaborCents ??
      offer.payEstimateCents ??
      offer.totalEstimatedPayCents ??
      offer.offeredAmountCents ??
      offer.rate ??
      0
    );
  };

  const getOfferCanSelfSchedule = (offer) => {
    return Boolean(
      offer.canTechnicianSchedule ||
      offer.allowsTechnicianSelfScheduling ||
      offer.allowTechnicianScheduling ||
      offer.technicianCanSchedule
    );
  };

  const renderWorkOfferCard = (offer) => {
    const taskCount = getOfferTaskCount(offer);
    const estimatedPayCents = getOfferEstimatedPayCents(offer);
    const targetText = getOfferTargetText(offer);
    const status = offer.status || "Pending";

    return (
      <div
        key={offer.id}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Work Offer
            </p>

            <p className="mt-1 text-base font-bold text-gray-800">
              {offer.title || offer.name || offer.serviceStopTypeName || "Offered Work"}
            </p>

            <p className="mt-1 text-sm text-gray-600">
              Offered to: <span className="font-semibold">{targetText}</span>
            </p>
          </div>

          <span
            className={`px-3 py-1 text-xs font-bold rounded-full border ${getOfferStatusClass(
              status
            )}`}
          >
            {status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Service Type
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {offer.serviceStopTypeName || offer.companyServiceStopTypeName || "—"}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Tasks
            </p>
            <p className="mt-1 font-semibold text-gray-800">{taskCount}</p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Est. Pay
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(estimatedPayCents)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Scheduling
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {getOfferCanSelfSchedule(offer) ? "Tech can schedule" : "Admin schedules"}
            </p>
          </div>
        </div>

        {(offer.notes || offer.description) && (
          <p className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
            {offer.notes || offer.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {(offer.postedToBoard || offer.isBoardPost) && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              Board Post
            </span>
          )}

          {(offer.scheduledServiceStopId || offer.serviceStopId) && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Scheduled
            </span>
          )}

          {offer.acceptedAt && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
              Accepted {formatDateValue(offer.acceptedAt)}
            </span>
          )}

          {offer.createdAt && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
              Created {formatDateValue(offer.createdAt)}
            </span>
          )}
        </div>
      </div>
    );
  };

  const getHistoryToneClass = (severity) => {
    switch (severity) {
      case "warning":
        return "border-amber-200 bg-amber-50";
      case "danger":
        return "border-red-200 bg-red-50";
      case "success":
        return "border-green-200 bg-green-50";
      default:
        return "border-gray-200 bg-gray-50";
    }
  };

  const getChangeOrderStatusClass = (status) => {
    switch (status) {
      case "Approved":
      case "Completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "Rejected":
      case "Cancelled":
        return "bg-red-100 text-red-800 border-red-200";
      case "In Review":
      case "Needs Approval":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-amber-100 text-amber-800 border-amber-200";
    }
  };

  const openChangeOrders = useMemo(
    () =>
      (changeOrders || []).filter(
        (order) => !["Completed", "Rejected", "Cancelled"].includes(order.status)
      ),
    [changeOrders]
  );

  const renderHistoryEventCard = (event, { isCurrent = false } = {}) => (
    <div
      key={event.id}
      className={`rounded-xl border p-4 ${getHistoryToneClass(event.severity)}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {event.eventType || "Job Updated"}
          </p>
          <p className="mt-1 text-base font-bold text-gray-800">
            {event.title || "Job updated"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {event.actorUserName || "Unknown"} • {formatDateTimeValue(event.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isCurrent && (
            <span className="px-3 py-1 text-xs font-bold rounded-full border bg-green-100 text-green-800 border-green-200">
              Current
            </span>
          )}
          {event.changeOrderId && (
            <span className="px-3 py-1 text-xs font-bold rounded-full border bg-amber-100 text-amber-800 border-amber-200">
              Change Order
            </span>
          )}
        </div>
      </div>

      {event.description && (
        <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">
          {event.description}
        </p>
      )}

      {!!event.changes?.length && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {event.changes.map((change, index) => (
            <div key={`${event.id}_${change.field || index}`} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {change.label || change.field || "Field"}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                <span className="font-semibold text-gray-700">{change.before || "—"}</span>
                {" → "}
                <span className="font-semibold text-gray-900">{change.after || "—"}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderChangeOrderCard = (order) => (
    <div key={order.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Change Order
          </p>
          <p className="mt-1 text-base font-bold text-gray-800">
            {order.title || "Change Order"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Requested by {order.requestedBy || "—"} • {formatDateTimeValue(order.createdAt)}
          </p>
        </div>

        <span className={`px-3 py-1 text-xs font-bold rounded-full border ${getChangeOrderStatusClass(order.status)}`}>
          {order.status || "Requested"}
        </span>
      </div>

      {order.description && (
        <p className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
          {order.description}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <div className="rounded-lg bg-white border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Price Impact
          </p>
          <p className="mt-1 font-semibold text-gray-800">
            {moneyFromCents(order.priceImpactCents)}
          </p>
        </div>

        <div className="rounded-lg bg-white border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Labor Impact
          </p>
          <p className="mt-1 font-semibold text-gray-800">
            {moneyFromCents(order.laborCostImpactCents)}
          </p>
        </div>

        <div className="rounded-lg bg-white border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Product Impact
          </p>
          <p className="mt-1 font-semibold text-gray-800">
            {moneyFromCents(order.materialCostImpactCents)}
          </p>
        </div>

        <div className="rounded-lg bg-white border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Approval
          </p>
          <p className="mt-1 font-semibold text-gray-800">
            {order.approvalStatus || (order.customerApprovalRequired ? "Needs Approval" : "Internal")}
          </p>
        </div>
      </div>

      {(order.reason || order.scheduleImpact || order.internalNotes) && (
        <div className="mt-4 space-y-2 text-sm text-gray-700">
          {order.reason && <p><span className="font-semibold">Reason:</span> {order.reason}</p>}
          {order.scheduleImpact && <p><span className="font-semibold">Schedule:</span> {order.scheduleImpact}</p>}
          {order.internalNotes && <p className="whitespace-pre-wrap"><span className="font-semibold">Internal:</span> {order.internalNotes}</p>}
        </div>
      )}
    </div>
  );

  const markJobAndRelatedItemsInvoiced = async ({
    salesAgreement = null,
    salesInvoice = null,
    contract = selectedContract,
    invoiceId = "",
    invoiceType = "",
    historyTitle = "Job marked as invoiced",
    historyDescription = "",
    historyMetadata = {},
  } = {}) => {
    if (!recentlySelectedCompany || !jobId) {
      return { invoicedPurchasedItemCount: 0, invoicedShoppingItemCount: 0 };
    }

    const resolvedInvoiceId =
      invoiceId ||
      salesInvoice?.id ||
      contract?.salesInvoiceId ||
      contract?.invoiceId ||
      job.salesInvoiceId ||
      job.invoiceRef ||
      job.invoiceId ||
      "";
    const resolvedInvoiceType =
      invoiceType ||
      (salesInvoice?.id ? "salesInvoice" : "") ||
      (contract?.salesInvoiceId ? "salesInvoice" : "") ||
      (contract?.id ? "contract" : "") ||
      job.invoiceType ||
      "job";
    const resolvedSalesAgreementId =
      salesAgreement?.id ||
      selectedSalesAgreement?.id ||
      linkedSalesAgreement?.id ||
      job.salesAgreementId ||
      "";
    const resolvedSalesInvoiceId =
      salesInvoice?.id ||
      (resolvedInvoiceType === "salesInvoice" ? resolvedInvoiceId : "") ||
      job.salesInvoiceId ||
      "";
    const nextOperationStatus = suggestOperationForBilling(
      "Invoiced",
      job.operationStatus || "Estimate Pending"
    );

    if (contract?.id) {
      const contractUpdates = {
        status: "Invoiced",
        invoicedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (resolvedSalesAgreementId) contractUpdates.salesAgreementId = resolvedSalesAgreementId;
      if (resolvedSalesInvoiceId) contractUpdates.salesInvoiceId = resolvedSalesInvoiceId;

      await updateDoc(doc(db, "contracts", contract.id), contractUpdates);
    }

    const jobUpdates = {
      billingStatus: "Invoiced",
      operationStatus: nextOperationStatus,
      invoiceDate: serverTimestamp(),
      invoiceRef: resolvedInvoiceId,
      invoiceType: resolvedInvoiceType,
    };

    if (resolvedSalesAgreementId) jobUpdates.salesAgreementId = resolvedSalesAgreementId;
    if (resolvedSalesInvoiceId) jobUpdates.salesInvoiceId = resolvedSalesInvoiceId;

    await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), jobUpdates);

    const invoicedPurchasedItemCount = await markPurchasedItemsInvoicedForJob({
      invoiceId: resolvedInvoiceId,
      invoiceType: resolvedInvoiceType,
    });
    const invoicedShoppingItemCount = await markShoppingItemsInvoicedForJob({
      invoiceId: resolvedInvoiceId,
      invoiceType: resolvedInvoiceType,
    });

    setJob((prev) => ({
      ...prev,
      billingStatus: "Invoiced",
      operationStatus: nextOperationStatus,
      invoiceDate: new Date(),
      invoiceRef: resolvedInvoiceId,
      invoiceType: resolvedInvoiceType,
      ...(resolvedSalesAgreementId ? { salesAgreementId: resolvedSalesAgreementId } : {}),
      ...(resolvedSalesInvoiceId ? { salesInvoiceId: resolvedSalesInvoiceId } : {}),
    }));
    setSelectedBillingStatus({ value: "Invoiced", label: "Invoiced" });
    setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });

    if (salesInvoice?.id) setLinkedSalesInvoice(salesInvoice);
    if (salesAgreement?.id) {
      setLinkedSalesAgreement(salesAgreement);
      setSelectedSalesAgreementId(salesAgreement.id);
    }

    await recordJobHistory({
      eventType: "Billing",
      title: historyTitle,
      description: historyDescription,
      changes: [
        buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Invoiced"),
        buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", nextOperationStatus),
      ],
      metadata: {
        salesAgreementId: resolvedSalesAgreementId,
        salesInvoiceId: resolvedSalesInvoiceId,
        contractId: contract?.id || "",
        invoiceId: resolvedInvoiceId,
        invoiceType: resolvedInvoiceType,
        invoicedPurchasedItemCount,
        invoicedShoppingItemCount,
        ...historyMetadata,
      },
    });

    return {
      invoicedPurchasedItemCount,
      invoicedShoppingItemCount,
      invoiceId: resolvedInvoiceId,
      invoiceType: resolvedInvoiceType,
    };
  };

  const handleEmailInvoice = async () => {
    if (sendingInvoiceEmail) return;

    if (!salesWorkflowEnabled) return;

    try {
      if (!recentlySelectedCompany || !jobId) return;

      setSendingInvoiceEmail(true);
      const salesAgreement = await ensureJobSalesAgreement();
      const salesInvoice = await ensureJobSalesInvoice(salesAgreement, { requireEmail: true });
      const sendCallable = httpsCallable(functions, "sendSalesInvoiceEmail");
      const authPayload = await getCallableAuthPayload();
      const sendResult = await sendCallable({
        companyId: recentlySelectedCompany,
        invoiceId: salesInvoice.id,
        invoiceBaseUrl: window.location.origin,
        ...authPayload,
      });

      await markJobAndRelatedItemsInvoiced({
        salesAgreement,
        salesInvoice,
        invoiceId: salesInvoice.id,
        invoiceType: "salesInvoice",
        historyTitle: "Invoice emailed through Sales",
        historyDescription: sendResult.data?.testMode
          ? `Test email sent to ${sendResult.data.to}. Intended customer: ${sendResult.data.intendedTo}.`
          : `Invoice sent to ${sendResult.data?.to || getCustomerEmail()}.`,
        historyMetadata: {
          emailResult: sendResult.data || {},
          featureFlagId: "feature_flag_004",
          salesWorkflowFeatureFlagId: "feature_flag_004",
          realEmailsFeatureFlagId: sendResult.data?.realEmailsFeatureFlagId || "feature_flag_012",
          realEmailsEnabled: sendResult.data?.realEmailsEnabled === true,
        },
      });

      if (sendResult.data?.testMode) {
        toast.success(`Sales invoice test email sent to ${sendResult.data.to}.`);
      } else {
        toast.success("Sales invoice email sent to customer.");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to send sales invoice email");
    } finally {
      setSendingInvoiceEmail(false);
    }
  };

  const handleMarkAsInvoiced = async () => {
    if (markingJobInvoiced || sendingInvoiceEmail) return;

    try {
      if (!recentlySelectedCompany || !jobId) return;

      setMarkingJobInvoiced(true);
      const salesAgreement = salesWorkflowEnabled ? await ensureJobSalesAgreement() : null;
      const existingSalesInvoice = salesWorkflowEnabled ? await findLinkedSalesInvoice() : null;
      const salesInvoice = salesWorkflowEnabled
        ? existingSalesInvoice || await ensureJobSalesInvoice(salesAgreement, { requireEmail: false })
        : null;
      const invoiceId =
        salesInvoice?.id ||
        selectedContract?.salesInvoiceId ||
        selectedContract?.invoiceId ||
        selectedContract?.id ||
        job.salesInvoiceId ||
        job.invoiceRef ||
        job.invoiceId ||
        "";
      const invoiceType =
        salesInvoice?.id || selectedContract?.salesInvoiceId || job.salesInvoiceId
          ? "salesInvoice"
          : selectedContract?.id
            ? "contract"
            : job.invoiceType || "job";

      const result = await markJobAndRelatedItemsInvoiced({
        salesAgreement,
        salesInvoice,
        invoiceId,
        invoiceType,
        historyTitle: "Job marked as invoiced",
        historyMetadata: {
          manual: true,
          createdSalesInvoice: Boolean(salesWorkflowEnabled && salesInvoice?.id && !existingSalesInvoice?.id),
        },
      });

      toast.success(
        `Job marked as invoiced. ${result.invoicedPurchasedItemCount} purchased item(s) and ${result.invoicedShoppingItemCount} shopping item(s) updated.`
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark as invoiced");
    } finally {
      setMarkingJobInvoiced(false);
    }
  };
  const renderPlannedServiceStopCard = (stop) => {
    const linkedTaskCount = Array.isArray(stop.taskIds) ? stop.taskIds.length : 0;
    const payRange = getPlannedStopPayRange(stop);
    const rangeLabel =
      payRange.minAmountCents === payRange.maxAmountCents
        ? moneyFromCents(payRange.maxAmountCents)
        : `${moneyFromCents(payRange.minAmountCents)} - ${moneyFromCents(payRange.maxAmountCents)}`;
    const topPayLine = payRange.summaries
      ?.find((summary) => summary.worker && summary.totalAmountCents === payRange.maxAmountCents)
      ?.lines?.find((line) => line.calculationStatus === "calculated");

    return (
      <div
        key={stop.id}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Planned Stop
            </p>
            <p className="mt-1 text-base font-bold text-gray-800">
              {stop.name || stop.serviceStopTypeName || "Planned Visit"}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {stop.serviceStopTypeName || "Company Service Stop Type"}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Link
              to={`/company/serviceStops/createNew/${jobId}?plannedStopId=${stop.id}&category=jobVisit`}
              className="px-3 py-1 text-xs font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
            >
              Schedule
            </Link>

            <button
              type="button"
              onClick={() => deletePlannedServiceStop(stop.id)}
              className="px-3 py-1 text-xs font-bold rounded-full bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Estimated Time
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {formatDurationMinutes(stop.estimatedMinutes)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Pay Range
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {rangeLabel}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Highest used for planning
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Planning Cost
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(getPlannedStopCostCents(stop))}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {payRange.highestWorkerName || "No rate match"}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Linked Tasks
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {linkedTaskCount}
            </p>
          </div>
        </div>

        {stop.description && (
          <p className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
            {stop.description}
          </p>
        )}

        {stop.plannedLaborNotes && (
          <p className="mt-3 text-xs text-gray-500">
            Labor notes: {stop.plannedLaborNotes}
          </p>
        )}

        {topPayLine && (
          <p className="mt-3 text-xs text-gray-500">
            Pay source: {topPayLine.workTypeName || topPayLine.title} • {formatPayRate(topPayLine)}
          </p>
        )}

        {payRange.needsReview && (
          <p className="mt-3 text-xs font-semibold text-amber-700">
            Some technician rates need review before this range is complete.
          </p>
        )}
      </div>
    );
  };
  const renderServiceStopCard = (stop) => {
    const scheduledLaborCents = getScheduledStopEstimatedLaborCents(stop);
    const timeRange = [formatTimeValue(stop.startTime), formatTimeValue(stop.endTime)]
      .filter((value) => value && value !== "—")
      .join(" - ");
    const duration = formatDurationMinutes(stop.duration || stop.estimatedDuration);

    return (
      <button
        key={stop.id}
        type="button"
        onClick={() => openServiceStopDetail(stop.id)}
        className="w-full rounded-md border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-sm"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Service Stop
            </p>
            <p className="mt-0.5 truncate text-sm font-bold text-slate-900">
              {stop.internalId || stop.type || "Service Stop"}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 lg:justify-end">
            {stop.includeReadings && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                Readings
              </span>
            )}
            {stop.includeDosages && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                Dosages
              </span>
            )}
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${getStatusClass(stop.operationStatus)}`}>
              {stop.operationStatus || "—"}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${getStatusClass(stop.billingStatus)}`}>
              {stop.billingStatus || "—"}
            </span>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date</p>
            <p className="mt-0.5 truncate font-semibold text-slate-800">{formatDateValue(stop.serviceDate)}</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Time</p>
            <p className="mt-0.5 truncate font-semibold text-slate-800">{timeRange || "—"}</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Duration</p>
            <p className="mt-0.5 truncate font-semibold text-slate-800">{duration}</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tech</p>
            <p className="mt-0.5 truncate font-semibold text-slate-800">{stop.tech || "—"}</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Labor</p>
            <p className="mt-0.5 truncate font-semibold text-slate-800">{moneyFromCents(scheduledLaborCents)}</p>
          </div>
        </div>

        {(stop.description || stop.isInvoiced || stop.otherCompany) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {stop.description && (
              <span className="max-w-full truncate rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                {stop.description}
              </span>
            )}
            {stop.isInvoiced && (
              <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                Invoiced
              </span>
            )}
            {stop.otherCompany && (
              <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                Other Company
              </span>
            )}
          </div>
        )}
      </button>
    );
  };

  const formattedDateCreated = job.dateCreated ? format(job.dateCreated, "MMMM d, yyyy") : "N/A";
  const formattedLastUpdated = formatDateTimeValue(
    job.updatedAt || job.lastUpdatedAt || job.updatedAtMillis || job.lastUpdatedAtMillis || job.dateCreated
  );

  const commentFilters = ["All", "Open", "Resolved"];
  const renderCommentFilters = (className = "mt-3 flex flex-wrap gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-1.5") => (
    <div className={className}>
      {commentFilters.map((filter) => {
        const active = filter === commentFilter;
        return (
          <button
            key={filter}
            type="button"
            onClick={() => setCommentFilter(filter)}
            className={[
              "rounded-md px-2 py-1 text-xs font-semibold transition",
              active ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            {filter}
          </button>
        );
      })}
    </div>
  );

  const renderCommentComposer = (expanded = false) => (
    <div className={expanded ? "rounded-lg border border-slate-200 bg-white p-4 shadow-sm" : "mt-3 space-y-2"}>
      {expanded && (
        <div className="mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">New Comment</h3>
          <p className="mt-1 text-xs text-slate-500">Add job notes or follow-ups without squeezing into the sidebar.</p>
        </div>
      )}
      <textarea
        className={[
          "w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500",
          expanded ? "min-h-[180px]" : "min-h-[72px]",
        ].join(" ")}
        placeholder="Write a comment..."
        value={newComment}
        onChange={(event) => setNewComment(event.target.value)}
      />
      <button
        type="button"
        onClick={addComment}
        disabled={addingComment || !newComment.trim()}
        className={[
          "w-full rounded-md px-3 py-2 text-xs font-semibold transition",
          addingComment || !newComment.trim()
            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700",
        ].join(" ")}
      >
        {addingComment ? "Adding..." : "Add Comment"}
      </button>
    </div>
  );

  const renderCommentsList = (expanded = false) => (
    <div
      className={
        expanded
          ? "max-h-[58vh] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4"
          : "mt-4 max-h-80 space-y-2 overflow-y-auto pr-1"
      }
    >
      {commentsLoading ? (
        <div className="text-xs text-slate-500">Loading comments...</div>
      ) : !filteredComments?.length ? (
        <div className="text-xs text-slate-500">No comments in this filter.</div>
      ) : (
        filteredComments.map((comment) => {
          const dt = comment.date?.toDate?.() || null;
          const when = dt ? format(dt, "MMM d, h:mm a") : "-";

          return (
            <div
              key={comment.id}
              className={[
                "border border-slate-200 bg-white",
                expanded ? "rounded-lg p-4 shadow-sm" : "rounded-md bg-slate-50 p-3",
              ].join(" ")}
            >
              <div className="text-xs font-semibold text-slate-800">
                {comment.userName || "Unknown"}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{when}</div>
              <div className={expanded ? "mt-3 whitespace-pre-wrap text-sm text-slate-700" : "mt-2 whitespace-pre-wrap text-xs text-slate-700"}>
                {comment.comment}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={!!comment.resolved}
                  onChange={(event) => setCommentResolved(comment.id, event.target.checked)}
                />
                Resolved
              </label>
            </div>
          );
        })
      )}
    </div>
  );

  const renderPlanOptionCard = (solution) => {
    const isActive = solution.id === activePlan?.id;
    const isAccepted = solution.id === acceptedPlan?.id || solution.isAccepted;
    const tier = normalizeJobPlanTier(solution.planTier || solution.solutionTier);
    const lineItems = planLineItems(solution);
    const scope = planScopeArrays(solution);
    const total = planOptionTotalCents(solution);
    const laborCost = planOptionLaborCents(solution);
    const materialCost = planOptionMaterialCostCents(solution);
    const profit = total - laborCost - materialCost;
    const scopeOfWork = solution.scopeOfWork || {};
    const taskSummaries = Array.isArray(scopeOfWork.taskSummaries) && scopeOfWork.taskSummaries.length
      ? scopeOfWork.taskSummaries
      : scope.tasks;
    const plannedStopSummaries = Array.isArray(scopeOfWork.plannedStopSummaries) && scopeOfWork.plannedStopSummaries.length
      ? scopeOfWork.plannedStopSummaries
      : scope.plannedServiceStops;
    const laborLineSummaries = Array.isArray(scopeOfWork.laborLineSummaries) && scopeOfWork.laborLineSummaries.length
      ? scopeOfWork.laborLineSummaries
      : scope.laborLineItems;
    const materialSummaries = Array.isArray(scopeOfWork.materialSummaries) && scopeOfWork.materialSummaries.length
      ? scopeOfWork.materialSummaries
      : scope.shoppingItems;

    return (
      <div
        key={solution.id}
        className={[
          "rounded-lg border bg-white p-4 shadow-sm",
          isAccepted
            ? "border-emerald-200"
            : isActive
              ? "border-blue-200"
              : "border-slate-200",
        ].join(" ")}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PlanTierBadge tier={tier} />
              <StatusBadge status={solution.status || JOB_PLAN_STATUS.DRAFT} />
              {isAccepted && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  Accepted
                </span>
              )}
              {isActive && !isAccepted && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                  Active Plan
                </span>
              )}
            </div>
            <h4 className="mt-3 text-base font-bold text-slate-950">
              {getJobPlanDisplayName(solution, "Untitled Plan")}
            </h4>
            {solution.description && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{solution.description}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {canUpdateCurrentJob && (
              <button
                type="button"
                onClick={() => loadPlanIntoEditor(solution)}
                disabled={loadingPlanEditorId === solution.id}
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingPlanEditorId === solution.id ? "Loading..." : "Edit In Planned"}
              </button>
            )}
            {canUpdateCurrentJob && (
              <button
                type="button"
                onClick={() => openPlanModal(solution)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Refresh From Current Work
              </button>
            )}
            {canUpdateCurrentJob && (
              <button
                type="button"
                onClick={() => acceptPlanOption(solution)}
                disabled={acceptingPlanId === solution.id || isAccepted}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {acceptingPlanId === solution.id ? "Promoting..." : isAccepted ? "Accepted" : "Accept Plan"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
          <StatCard title="Price" value={moneyFromCents(total)} subtitle="Calculated estimate" tone="blue" />
          <StatCard title="Services" value={moneyFromCents(laborCost)} subtitle="Internal planned labor" />
          <StatCard title="Product Cost" value={moneyFromCents(materialCost)} subtitle={moneyFromCents(solution.materialPriceCents || solution.costSummary?.plannedMaterialPriceCents || 0) + " billable"} />
          <StatCard title="Profit" value={moneyFromCents(profit)} subtitle="Projected" tone={profit < 0 ? "red" : "green"} />
          <StatCard title="Tasks" value={String(scope.tasks.length || solution.taskCount || 0)} subtitle="Saved scope" />
          <StatCard title="Service Lines" value={String(scope.laborLineItems.length || solution.laborLineCount || 0)} subtitle={`${lineItems.length} estimate lines`} />
          <StatCard title="Visits/Products" value={`${scope.plannedServiceStops.length || solution.plannedStopCount || 0}/${scope.shoppingItems.length || solution.materialCount || 0}`} subtitle="Saved scope" />
        </div>

        {(laborLineSummaries.length > 0 || taskSummaries.length > 0 || plannedStopSummaries.length > 0 || materialSummaries.length > 0) && (
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Service Lines</p>
              <div className="mt-2 space-y-2">
                {laborLineSummaries.slice(0, 3).map((line, index) => (
                  <div key={line.id || `${solution.id}-labor-${index}`} className="text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">{line.name || `Service ${index + 1}`}</p>
                    <p>{moneyFromCents(line.totalPriceCents || line.totalAmountCents || line.amount || 0)} • Cost {moneyFromCents(line.internalCostCents || line.internalLaborCostCents || 0)}</p>
                  </div>
                ))}
                {!laborLineSummaries.length && <p className="text-xs text-slate-500">Generated from work scope.</p>}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Task Scope</p>
              <div className="mt-2 space-y-2">
                {taskSummaries.slice(0, 3).map((task, index) => (
                  <div key={task.id || `${solution.id}-task-${index}`} className="text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">{task.name || task.description || `Task ${index + 1}`}</p>
                    <p>{task.type || "Task"}{task.estimatedMinutes || task.estimatedTime ? ` • ${Number(task.estimatedMinutes || task.estimatedTime || 0)} min` : ""}</p>
                  </div>
                ))}
                {!taskSummaries.length && <p className="text-xs text-slate-500">No tasks saved.</p>}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Planned Visits</p>
              <div className="mt-2 space-y-2">
                {plannedStopSummaries.slice(0, 3).map((stop, index) => (
                  <div key={stop.id || `${solution.id}-stop-${index}`} className="text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">{stop.name || stop.serviceStopTypeName || `Visit ${index + 1}`}</p>
                    <p>{stop.serviceStopTypeName || stop.type || "Planned visit"}{stop.estimatedMinutes ? ` • ${Number(stop.estimatedMinutes || 0)} min` : ""}</p>
                  </div>
                ))}
                {!plannedStopSummaries.length && <p className="text-xs text-slate-500">No visits saved.</p>}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Products</p>
              <div className="mt-2 space-y-2">
                {materialSummaries.slice(0, 3).map((item, index) => (
                  <div key={item.id || `${solution.id}-material-${index}`} className="text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">{item.name || item.dbItemName || `Product ${index + 1}`}</p>
                    <p>{item.quantity ? `Qty ${item.quantity}` : "Product"} • {moneyFromCents(item.plannedTotalPriceCents || getShoppingPlannedTotalPriceCents(item))}</p>
                  </div>
                ))}
                {!materialSummaries.length && <p className="text-xs text-slate-500">No products saved.</p>}
              </div>
            </div>
          </div>
        )}

        {lineItems.length > 0 && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Estimate Preview</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {lineItems.slice(0, 4).map((item, index) => (
                <div key={item.id || `${solution.id}-line-${index}`} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-800">{item.name || item.title || "Line item"}</p>
                    <p className="font-bold text-slate-900">{moneyFromCents(item.totalAmountCents || item.amount || 0)}</p>
                  </div>
                  {item.description && <p className="mt-1 text-slate-500">{item.description}</p>}
                </div>
              ))}
            </div>
            {lineItems.length > 4 && (
              <p className="mt-2 text-xs text-slate-500">
                {lineItems.length - 4} more service/product item{lineItems.length - 4 === 1 ? "" : "s"} saved in this plan.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const normalizedSelectedTerms = selectedSalesAgreement?.termsList?.length
    ? normalizeTerms(selectedSalesAgreement.termsList)
    : selectedSalesAgreement?.termsSummary
      ? [{
        id: "agreement_terms_summary",
        title: "Agreement Terms",
        description: selectedSalesAgreement.termsSummary,
        value: "",
      }]
      : normalizeTerms(selectedContract?.terms || []);
  const billingRecordDisplay = {
    sender: selectedSalesAgreement?.companyName || selectedContract?.senderName || "—",
    receiver: selectedSalesAgreement?.customerName || selectedContract?.receiverName || "—",
    customerId: selectedSalesAgreement?.customerId || selectedContract?.customerId || selectedContract?.receiverId || job.customerId || customer.id || "",
    sentAt: selectedSalesAgreement?.sentAt || selectedSalesAgreement?.emailDelivery?.lastSentAt || selectedContract?.dateSent,
    acceptedAt: selectedSalesAgreement?.acceptedAt || selectedContract?.dateAccepted,
    acceptBy: selectedSalesAgreement?.expiresAt || selectedContract?.lastDateToAccept,
    totalAmountCents: contractTotalCents,
    notes: selectedSalesAgreement?.description || selectedSalesAgreement?.termsSummary || selectedContract?.notes || "—",
    status: selectedSalesAgreement?.status || selectedContract?.status || "",
    detailUrl: selectedSalesAgreement?.id
      ? `/company/sales/agreements/${selectedSalesAgreement.id}`
      : selectedContract?.id
        ? `/company/contract/detail/${selectedContract.id}`
        : "",
    detailLabel: selectedSalesAgreement?.id ? "View Service Agreement" : "View Legacy Estimate",
  };
  const selectedSection = tabs.find((tab) => tab === activeTab) || "Planned";
  const sectionMeta = {
    Plans: {
      label: "Overview",
      helper: "Customer options for solving this job",
      count: String(jobPlans?.length || 0),
    },
	    Planned: {
	      label: "Create Plans",
	      helper: "Create estimates based on services and products",
	      count: String(
	        (taskList?.length || 0) +
	        (plannedServiceStops?.length || 0) +
	        (laborLineItems?.length || 0) +
	        (shoppingList?.length || 0)
	      ),
	    },
	    Actual: {
	      label: "Actual",
	      helper: "Service stops, payroll, and purchased parts",
	      count: String(
	        (serviceStops?.length || 0) +
	        (actualPayLineItems?.length || 0) +
	        (purchasedItems?.length || 0) +
	        (workOffers?.length || 0)
	      ),
	    },
    Billing: {
      label: "Billing",
      helper: "Estimate, invoice, and payment lifecycle",
      count: selectedBillingRecord ? "1" : "",
    },
    History: {
      label: "History",
      helper: "Change orders and job audit trail",
      count: String((jobHistory?.length || 0) + (changeOrders?.length || 0)),
    },
  };
  const currentDetailPanelIds = DETAIL_PANEL_IDS_BY_SECTION[selectedSection] || [];
  const currentOpenDetailCount = currentDetailPanelIds.filter((panelId) => openDetailPanels[panelId]).length;
  const setCurrentDetailPanelsOpen = (open) => {
    setOpenDetailPanels((prev) => {
      const next = { ...prev };
      currentDetailPanelIds.forEach((panelId) => {
        next[panelId] = open;
      });
      return next;
    });
  };
  const siteAddress = [serviceLocation.streetAddress, serviceLocation.city, serviceLocation.state, serviceLocation.zip]
    .filter(Boolean)
    .join(", ");
  const isInitialShellLoading = loading && sectionLoading.shell;
  const visiblePlannedMaterials = showAllPlannedMaterials ? shoppingList : shoppingList.slice(0, 5);
  const hiddenPlannedMaterialCount = Math.max(shoppingList.length - 5, 0);
  const newPlannedStopTargetLaborLine = (laborLineItems || []).find((line) => line.id === newPlannedStopLaborLineId) || null;
  const shoppingPreviewQuantity = quantityNumber(shoppingFormData.quantity);
  const shoppingPreviewUnitCostCents = requiresShoppingDbItem
    ? shoppingFormData.plannedUnitCost !== ""
      ? centsFromCurrencyInput(shoppingFormData.plannedUnitCost)
      : Number(selectedShoppingDbItem?.rate || selectedShoppingDbItem?.cost || 0)
    : centsFromCurrencyInput(shoppingFormData.plannedUnitCost);
  const shoppingPreviewUnitPriceCents = requiresShoppingDbItem
    ? shoppingFormData.plannedUnitPrice !== ""
      ? centsFromCurrencyInput(shoppingFormData.plannedUnitPrice)
      : Number(
        selectedShoppingDbItem?.sellPrice ||
        selectedShoppingDbItem?.rate ||
        selectedShoppingDbItem?.cost ||
        0
      )
    : centsFromCurrencyInput(shoppingFormData.plannedUnitPrice);
  const shoppingPreviewTotalCostCents = Math.round(shoppingPreviewUnitCostCents * shoppingPreviewQuantity);
  const shoppingPreviewTotalPriceCents = Math.round(shoppingPreviewUnitPriceCents * shoppingPreviewQuantity);
  const visibleWorkOffers = showAllWorkOffers ? workOffers : workOffers.slice(0, 5);
  const hiddenWorkOfferCount = Math.max(workOffers.length - 5, 0);
  const visibleActualServiceStops = showAllActualServiceStops ? serviceStops : serviceStops.slice(0, 5);
  const hiddenActualServiceStopCount = Math.max(serviceStops.length - 5, 0);
  const currentPlanInvoiceLineItems = (() => {
    const explicitLaborLines = normalizeJobLaborLineItems(laborLineItems);
    const laborLines = explicitLaborLines.length
      ? explicitLaborLines.map((line, index) => ({
        id: `labor-${line.id || index}`,
        sourceId: line.id || "",
        group: "Labor",
        generated: false,
        name: line.name || `Labor ${index + 1}`,
        description: [line.description, laborLineScopeLabel(line)].filter(Boolean).join(" • "),
        quantity: Number(line.quantity || 1),
        unitPriceCents: cents(line.unitPriceCents),
        totalPriceCents: cents(line.totalPriceCents),
        internalCostCents: cents(line.internalCostCents),
        profitCents: cents(line.totalPriceCents) - cents(line.internalCostCents),
        taskIds: getLaborLineTaskIds(line),
        plannedServiceStopIds: getLaborLinePlannedStopIds(line),
      }))
      : (() => {
        const taskIds = (taskList || []).map((task) => task.id).filter(Boolean);
        const plannedServiceStopIds = (plannedServiceStops || []).map((stop) => stop.id).filter(Boolean);
        const totalPriceCents = plannedLaborPriceCents;
        const internalCostCents = plannedTotalLaborCents;

        if (!taskIds.length && !plannedServiceStopIds.length && !totalPriceCents && !internalCostCents) return [];

        return [{
          id: "labor-generated-current",
          sourceId: "",
          group: "Labor",
          generated: true,
          name: "Labor",
          description: [
            taskIds.length ? `${taskIds.length} task${taskIds.length === 1 ? "" : "s"}` : "",
            plannedServiceStopIds.length ? `${plannedServiceStopIds.length} planned stop${plannedServiceStopIds.length === 1 ? "" : "s"}` : "",
          ].filter(Boolean).join(" • "),
          quantity: 1,
          unitPriceCents: totalPriceCents,
          totalPriceCents,
          internalCostCents,
          profitCents: totalPriceCents - internalCostCents,
          taskIds,
          plannedServiceStopIds,
        }];
      })();

    const materialLines = (shoppingList || []).map((item, index) => {
      const quantity = quantityNumber(item.quantity ?? item.quantityString ?? 1) || 1;
      const totalPriceCents = getShoppingPlannedTotalPriceCents(item);
      const totalCostCents = getShoppingPlannedTotalCostCents(item);
      const unitPriceCents =
        item?.plannedUnitPriceCents !== undefined && item?.plannedUnitPriceCents !== null
          ? cents(item.plannedUnitPriceCents)
          : quantity
            ? Math.round(totalPriceCents / quantity)
            : totalPriceCents;

	      return {
	        id: `material-${getFirestoreDocId(item) || index}`,
	        sourceId: getFirestoreDocId(item) || "",
	        group: "Material",
        name: getMaterialName(item),
        description: [
          item.subCategory || "Product",
          item.linkedTaskName ? `Task: ${item.linkedTaskName}` : "",
        ].filter(Boolean).join(" • "),
        quantity,
        unitPriceCents,
        totalPriceCents,
        internalCostCents: totalCostCents,
        profitCents: totalPriceCents - totalCostCents,
      };
    });

    return [...laborLines, ...materialLines];
  })();
  const currentPlanLaborLineItems = currentPlanInvoiceLineItems.filter((line) => line.group === "Labor");
  const currentPlanMaterialLineItems = currentPlanInvoiceLineItems.filter((line) => line.group === "Material");
  const assignedLaborTaskIds = new Set((laborLineItems || []).flatMap((line) => getLaborLineTaskIds(line)));
  const assignedLaborPlannedStopIds = new Set((laborLineItems || []).flatMap((line) => getLaborLinePlannedStopIds(line)));
  const unassignedLaborTasks = (laborLineItems || []).length
    ? (taskList || []).filter((task) => task.id && !assignedLaborTaskIds.has(task.id))
    : [];
  const unassignedLaborPlannedStops = (laborLineItems || []).length
    ? (plannedServiceStops || []).filter((stop) => stop.id && !assignedLaborPlannedStopIds.has(stop.id))
    : [];
  const currentPlanLaborPriceCents = currentPlanLaborLineItems.reduce(
    (total, item) => total + cents(item.totalPriceCents),
    0
  );
  const currentPlanLaborCostCents = currentPlanLaborLineItems.reduce(
    (total, item) => total + cents(item.internalCostCents),
    0
  );
  const currentPlanMaterialPriceCents = currentPlanMaterialLineItems.reduce(
    (total, item) => total + cents(item.totalPriceCents),
    0
  );
  const currentPlanMaterialCostCents = currentPlanMaterialLineItems.reduce(
    (total, item) => total + cents(item.internalCostCents),
    0
  );
  const currentPlanInvoiceSubtotalCents = currentPlanInvoiceLineItems.reduce(
    (total, item) => total + cents(item.totalPriceCents),
    0
  );
  const currentPlanInvoicePriceCents = currentPlanInvoiceSubtotalCents;
  const currentPlanInvoiceInternalCostCents = currentPlanInvoiceLineItems.reduce(
    (total, item) => total + cents(item.internalCostCents),
    0
  );
  const currentPlanInvoiceProfitCents = currentPlanInvoicePriceCents - currentPlanInvoiceInternalCostCents;
  const plannedStopFormRangeLabel =
    plannedStopFormPayRange.minAmountCents === plannedStopFormPayRange.maxAmountCents
      ? moneyFromCents(plannedStopFormPayRange.maxAmountCents)
      : `${moneyFromCents(plannedStopFormPayRange.minAmountCents)} - ${moneyFromCents(plannedStopFormPayRange.maxAmountCents)}`;
  const selectedEditorTier = normalizeJobPlanTier(selectedEditorPlan?.planTier || selectedEditorPlan?.solutionTier || DEFAULT_JOB_PLAN_TIER);
  const selectedEditorPlanTotalCents = selectedEditorPlan ? planOptionTotalCents(selectedEditorPlan) : 0;
  const plannedStopsToSchedule = (plannedServiceStops || []).filter(
    (stop) => !stop.serviceStopId && !stop.scheduledServiceStopId && !stop.convertedServiceStopId
  );
  const plannedMaterialsToPurchase = (shoppingList || []).filter((item) => !isShoppingListItemPurchased(item));
  const acceptedWorkflowIsReady = Boolean(acceptedPlan) || isJobAcceptedForMaterials();
  const canUpdateJobs = canUpdateCurrentJob;
  const headerActionItems = [
    {
      label: salesWorkflowEnabled
        ? (sendingEstimateEmail ? "Sending Estimate..." : "Email Estimate")
        : "Send Estimate",
      icon: EnvelopeIcon,
      tone: "amber",
      onClick: handleSendEstimate,
      disabled: sendingEstimateEmail,
    },
    {
      label: "Mark Accepted",
      icon: CheckCircleIcon,
      tone: "emerald",
      onClick: handleMarkEstimateAccepted,
    },
    {
      label: markingJobFinished ? "Marking Finished..." : "Mark As Finished",
      icon: CheckCircleIcon,
      tone: "emerald",
      onClick: markJobAsFinished,
      disabled: markingJobFinished,
    },
    ...(salesWorkflowEnabled
      ? [{
        label: sendingInvoiceEmail ? "Sending Invoice..." : "Email Invoice",
        icon: DocumentTextIcon,
        tone: "blue",
        onClick: handleEmailInvoice,
        disabled: sendingInvoiceEmail,
      }]
      : []),
    {
      label: markingJobInvoiced ? "Marking Invoiced..." : "Mark As Invoiced",
      icon: CurrencyDollarIcon,
      onClick: handleMarkAsInvoiced,
      disabled: markingJobInvoiced || sendingInvoiceEmail,
    },
    ...(canUpdateJobs
      ? [{
        label: "Create Template",
        icon: DocumentDuplicateIcon,
        tone: "emerald",
        onClick: openCreateTemplateModal,
      }]
      : []),
    {
      label: "Create Customer Notes",
      icon: ChatBubbleLeftRightIcon,
      tone: "violet",
      onClick: openCreateCustomerNoteModal,
    },
    ...(canUpdateJobs
      ? [{
        label: "Edit",
        icon: PencilSquareIcon,
        onClick: editJob,
      }]
      : []),
  ];

  const renderLaborLineScopePicker = () => (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tasks</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {(laborLineForm.taskIds || []).length}
          </span>
        </div>
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
          {!taskList.length ? (
            <p className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">No tasks yet.</p>
          ) : (
            taskList.map((task) => {
              const checked = (laborLineForm.taskIds || []).includes(task.id);
              return (
                <label
                  key={task.id}
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition",
                    checked ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50 hover:bg-white",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLaborLineTask(task.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-slate-900">{task.name || task.description || task.type || "Task"}</span>
                    <span className="mt-0.5 block text-slate-500">
                      {[task.type || "", task.estimatedTime ? formatDurationMinutes(task.estimatedTime) : "", taskContextLabel(task)].filter(Boolean).join(" • ") || "Task"}
                    </span>
                    <span className="mt-1 block font-semibold text-slate-700">
                      Cost {moneyFromCents(task.contractedRate)} • Task billing {moneyFromCents(getTaskBillingLaborPriceCents(task))}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Planned Stops</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {(laborLineForm.plannedServiceStopIds || []).length}
          </span>
        </div>
        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
          {!plannedServiceStops.length ? (
            <p className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">No planned stops yet.</p>
          ) : (
            plannedServiceStops.map((stop) => {
              const checked = (laborLineForm.plannedServiceStopIds || []).includes(stop.id);
              return (
                <label
                  key={stop.id}
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition",
                    checked ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50 hover:bg-white",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLaborLinePlannedStop(stop.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-slate-900">{stop.name || stop.serviceStopTypeName || "Planned Stop"}</span>
                    <span className="mt-0.5 block text-slate-500">
                      {[stop.serviceStopTypeName || stop.type || "", stop.estimatedMinutes ? formatDurationMinutes(stop.estimatedMinutes) : ""].filter(Boolean).join(" • ") || "Planned stop"}
                    </span>
                    <span className="mt-1 block font-semibold text-slate-700">
                      Planned cost {moneyFromCents(getPlannedStopCostCents(stop))}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  const renderPlanInvoiceLaborLineForm = () => {
    const quantity = Math.max(Number(laborLineForm.quantity || 1), 1);
    const unitPriceCents = centsFromCurrencyInput(laborLineForm.unitPrice);
    const totalPriceCents = Math.round(unitPriceCents * quantity);
    const internalCostCents = centsFromCurrencyInput(laborLineForm.internalCost);
    const formProfitCents = totalPriceCents - internalCostCents;
    const scopeTotals = laborLineScopeTotals(laborLineForm);

    return (
      <form onSubmit={saveLaborLineItem} className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 md:col-span-2">
            Service Line
            <input
              type="text"
              value={laborLineForm.name}
              onChange={(event) => updateLaborLineForm("name", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              placeholder="Service"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Qty
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={laborLineForm.quantity}
              onChange={(event) => updateLaborLineForm("quantity", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Unit Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={laborLineForm.unitPrice}
              onChange={(event) => updateLaborLineForm("unitPrice", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Internal Cost
            <input
              type="number"
              min="0"
              step="0.01"
              value={laborLineForm.internalCost}
              onChange={(event) => updateLaborLineForm("internalCost", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 md:col-span-2 xl:col-span-5">
            Description
            <textarea
              value={laborLineForm.description}
              onChange={(event) => updateLaborLineForm("description", event.target.value)}
              className="mt-1 min-h-[72px] w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              placeholder="Customer-facing service description"
            />
          </label>
        </div>

        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-600">
              <span className="font-bold text-slate-900">Selected work totals:</span>{" "}
              Price {moneyFromCents(scopeTotals.priceCents)} • Cost {moneyFromCents(scopeTotals.costCents)}
            </div>
            <button
              type="button"
              onClick={syncLaborLineFormToScopeTotals}
              className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
            >
              Use Selected Totals
            </button>
          </div>
          <div className="mt-3">{renderLaborLineScopePicker()}</div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700">
              Total {moneyFromCents(totalPriceCents)}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700">
              Cost {moneyFromCents(internalCostCents)}
            </span>
            <span className={formProfitCents < 0 ? "rounded-full border border-rose-200 bg-white px-2.5 py-1 font-bold text-rose-700" : "rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-bold text-emerald-700"}>
              Profit {moneyFromCents(formProfitCents)}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => clearLaborLineEditor()}
              disabled={savingLaborLine}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingLaborLine}
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingLaborLine ? "Saving..." : editingLaborLineId ? "Save Service" : "Add Service"}
            </button>
          </div>
        </div>
      </form>
    );
  };

  const renderServiceCatalogPicker = () => (
    <div className="border-b border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Prebuilt Service Lines</p>
          <p className="mt-1 text-sm text-slate-600">
            Add reusable service building blocks with their task checklist, estimated time, and billing price.
          </p>
        </div>
        <Link
          to="/company/sales/catalog-items"
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
        >
          Manage Service Catalog
        </Link>
      </div>

      {loadingServiceCatalogItems ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Loading service catalog...
        </div>
      ) : !serviceCatalogItems.length ? (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-center">
          <p className="text-sm font-semibold text-slate-800">No prebuilt services yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Create services in the catalog, then add them here as job building blocks.
          </p>
          <Link
            to="/company/sales/catalog-items"
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Add first service
          </Link>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {serviceCatalogItems.map((item) => {
            const taskTemplates = getCatalogServiceTaskTemplates(item);
            const isAdding = addingCatalogServiceId === item.id;
            return (
              <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{item.name || "Service"}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {item.description || "No service description"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">
                        Price {moneyFromCents(item.unitAmountCents)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">
                        Cost {moneyFromCents(item.unitCostCents)}
                      </span>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">
                        {taskTemplates.length} task{taskTemplates.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addCatalogServiceToJob(item)}
                    disabled={Boolean(addingCatalogServiceId)}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PlusIcon className="h-4 w-4" aria-hidden="true" />
                    {isAdding ? "Adding..." : "Add"}
                  </button>
                </div>
                {taskTemplates.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-slate-200 pt-2">
                    {taskTemplates.slice(0, 3).map((template, index) => (
                      <p key={`${item.id}-task-${template.id || index}`} className="text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {template.name || template.title || template.description || `Task ${index + 1}`}
                        </span>
                        {catalogTemplateMinutes(template) ? ` • ${formatDurationMinutes(catalogTemplateMinutes(template))}` : ""}
                      </p>
                    ))}
                    {taskTemplates.length > 3 && (
                      <p className="text-[11px] font-semibold text-slate-500">
                        +{taskTemplates.length - 3} more task{taskTemplates.length - 3 === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderPlanInvoiceTaskEditForm = () => (
    <form onSubmit={saveTaskEdit} className="rounded-md border border-blue-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Description
          <input
            type="text"
            value={taskEditForm.name}
            onChange={(event) => updateTaskEditForm("name", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Type
          <select
            value={taskEditForm.type}
            onChange={(event) => updateTaskEditType(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          >
            <option value="">Select task type</option>
            {taskTypeSelectOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Status
          <select
            value={taskEditForm.status}
            onChange={(event) => updateTaskEditForm("status", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          >
            {taskStatusSelectOptions.map((statusOption) => (
              <option key={statusOption} value={statusOption}>{statusOption}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Tech Labor Cost
          <input
            type="number"
            min="0"
            step="0.01"
            value={taskEditForm.laborCost}
            onChange={(event) => updateTaskEditForm("laborCost", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Billing Labor
          <input
            type="number"
            min="0"
            step="0.01"
            value={taskEditForm.billingLaborPrice}
            onChange={(event) => updateTaskEditForm("billingLaborPrice", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Estimated Time
          <input
            type="number"
            min="0"
            step="1"
            value={taskEditForm.estimatedTime}
            onChange={(event) => updateTaskEditForm("estimatedTime", event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        {editingTaskNeedsBodyOfWater && (
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Body of Water
            <select
              value={taskEditForm.bodyOfWaterId}
              onChange={(event) => updateTaskEditForm("bodyOfWaterId", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            >
              <option value="">Select body of water</option>
              {taskBodyOfWaterList.map((body) => (
                <option key={body.id} value={body.id}>{body.label || body.name || "Body Of Water"}</option>
              ))}
            </select>
          </label>
        )}
        {editingTaskNeedsEquipment && (
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Equipment
            <select
              value={taskEditForm.equipmentId}
              onChange={(event) => updateTaskEditForm("equipmentId", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            >
              <option value="">Select equipment</option>
              {editingTaskEquipmentOptions.map((equipment) => (
                <option key={equipment.id} value={equipment.id}>{equipment.label || equipment.name || "Equipment"}</option>
              ))}
            </select>
          </label>
        )}
        {editingTaskNeedsInstallItem && (
          <>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Item
              <select
                value={taskEditForm.dataBaseItemId}
                onChange={(event) => updateTaskEditForm("dataBaseItemId", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              >
                <option value="">Select item</option>
                {shoppingDbItemList.map((item) => (
                  <option key={item.id} value={item.id}>{item.label || item.name || "Item"}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Quantity
              <input
                type="number"
                min="0"
                step="0.01"
                value={taskEditForm.quantity}
                onChange={(event) => updateTaskEditForm("quantity", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-2 self-end rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(taskEditForm.customerApproval)}
            onChange={(event) => updateTaskEditForm("customerApproval", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Customer approval
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelTaskEdit}
          disabled={savingTaskEdit}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={savingTaskEdit}
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {savingTaskEdit ? "Saving..." : "Save Task"}
        </button>
      </div>
    </form>
  );

  const renderPlanInvoiceNewTaskForm = () => (
    <form onSubmit={handleAddTask} className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Description
          <input
            type="text"
            value={taskDescription}
            onChange={(event) => setTaskDescription(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            placeholder="Task description"
          />
        </label>
        <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Type
          <div className="mt-1 text-sm font-medium normal-case tracking-normal">
            <Select
              value={selectedTaskType}
              options={taskTypeList}
              onChange={setSelectedTaskType}
              isSearchable
              placeholder="Select a task type"
              theme={selectTheme}
              styles={selectStyles}
            />
          </div>
        </div>
        {taskNeedsBodyOfWater && (
          <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Body of Water
            <div className="mt-1 text-sm font-medium normal-case tracking-normal">
              <Select
                value={selectedTaskBodyOfWater}
                options={taskBodyOfWaterList}
                onChange={setSelectedTaskBodyOfWater}
                isSearchable
                placeholder="Select body of water"
                theme={selectTheme}
                styles={selectStyles}
              />
            </div>
          </div>
        )}
        {taskNeedsEquipment && (
          <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Equipment
            <div className="mt-1 text-sm font-medium normal-case tracking-normal">
              <Select
                value={selectedTaskEquipment}
                options={taskEquipmentOptions}
                onChange={setSelectedTaskEquipment}
                isSearchable
                placeholder="Select equipment"
                theme={selectTheme}
                styles={selectStyles}
              />
            </div>
          </div>
        )}
        {taskNeedsInstallItem && (
          <>
            <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Item
              <div className="mt-1 text-sm font-medium normal-case tracking-normal">
                <Select
                  value={selectedTaskDbItem}
                  options={shoppingDbItemList}
                  onChange={setSelectedTaskDbItem}
                  isSearchable
                  placeholder="Select item"
                  theme={selectTheme}
                  styles={selectStyles}
                />
              </div>
            </div>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              Quantity
              <input
                type="number"
                min="0"
                step="0.01"
                value={taskQuantity}
                onChange={(event) => setTaskQuantity(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              />
            </label>
          </>
        )}
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Tech Labor Cost
          <input
            type="number"
            min="0"
            step="0.01"
            value={taskLaborCost}
            onChange={(event) => setTaskLaborCost(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Billing Labor
          <input
            type="number"
            min="0"
            step="0.01"
            value={taskBillingLaborPrice}
            onChange={(event) => setTaskBillingLaborPrice(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
          Estimated Time
          <input
            type="number"
            min="0"
            step="1"
            value={estimatedTime}
            onChange={(event) => setEstimatedTime(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={clearNewTask}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
        >
          Add Task
        </button>
      </div>
    </form>
  );

  const renderPlanInvoiceNewMaterialForm = () => (
    <form onSubmit={handleAddShoppingListItem} className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Sub Category
            <select
              value={shoppingFormData.subCategory}
              onChange={(event) => handleShoppingSubCategoryChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            >
              {shoppingSubCategoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {requiresShoppingDbItem && (
            <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span>Database Item</span>
                {!showShoppingDbItemCreator && (
                  <button
                    type="button"
                    onClick={() => setShowShoppingDbItemCreator(true)}
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold normal-case tracking-normal text-blue-700 transition hover:bg-blue-100"
                  >
                    <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    New Item
                  </button>
                )}
              </div>
              <div className="text-sm font-medium normal-case tracking-normal">
                <Select
                  value={selectedShoppingDbItem}
                  options={shoppingDbItemList}
                  onChange={handleShoppingDbItemChange}
                  isSearchable
                  isClearable
                  placeholder="Select a database item"
                  theme={selectTheme}
                  styles={selectStyles}
                />
              </div>
            </div>
          )}
          {showShoppingDbItemCreator && requiresShoppingDbItem && (
            <div className="md:col-span-2">{renderShoppingDatabaseItemCreator()}</div>
          )}
          {requiresShoppingManualDetails && (
            <>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                Name
                <input
                  type="text"
                  value={shoppingFormData.name}
                  onChange={(event) => handleShoppingFormChange("name", event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  placeholder="Product name"
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 md:col-span-2">
                Description
                <textarea
                  value={shoppingFormData.description}
                  onChange={(event) => handleShoppingFormChange("description", event.target.value)}
                  className="mt-1 min-h-[72px] w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                  placeholder="Product description"
                />
              </label>
            </>
          )}
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Quantity
            <input
              type="text"
              value={shoppingFormData.quantity}
              onChange={(event) => handleShoppingFormChange("quantity", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Unit Cost
            <input
              type="number"
              min="0"
              step="0.01"
              value={shoppingFormData.plannedUnitCost}
              onChange={(event) => handleShoppingFormChange("plannedUnitCost", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              placeholder="0.00"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Unit Billing
            <input
              type="number"
              min="0"
              step="0.01"
              value={shoppingFormData.plannedUnitPrice}
              onChange={(event) => handleShoppingFormChange("plannedUnitPrice", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
              placeholder="0.00"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
            Linked Task
            <select
              value={shoppingFormData.linkedTaskId}
              onChange={(event) => handleShoppingFormChange("linkedTaskId", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
            >
              <option value="">No linked task</option>
              {(taskList || []).map((task) => (
                <option key={task.id} value={task.id}>
                  {[task.name || task.type || "Task", task.status || ""].filter(Boolean).join(" - ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(shoppingFormData.customerApprovalRequired)}
              onChange={(event) => handleShoppingFormChange("customerApprovalRequired", event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block font-bold text-amber-900">Require customer approval</span>
              <span className="mt-1 block text-amber-800">Keeps this product out of Ready to Purchase until approved.</span>
            </span>
          </label>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <h5 className="text-sm font-bold text-slate-900">Line Preview</h5>
          <div className="mt-3 space-y-2 text-xs">
            {[
              ["Unit Cost", shoppingPreviewUnitCostCents],
              ["Unit Billing", shoppingPreviewUnitPriceCents],
              ["Total Cost", shoppingPreviewTotalCostCents],
              ["Total Billing", shoppingPreviewTotalPriceCents],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0">
                <span className="font-semibold text-slate-500">{label}</span>
                <span className="font-bold text-slate-900">{moneyFromCents(value)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={clearNewShoppingListItem}
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSaveShoppingItem}
              className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  const renderUnassignedLaborScopeRow = () => {
    if (!unassignedLaborTasks.length && !unassignedLaborPlannedStops.length) return null;
    const editingUnassignedTask = unassignedLaborTasks.find((task) => editingTaskId === task.id) || null;

    return (
      <React.Fragment>
        <tr className="bg-amber-50/70">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Unassigned Work</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  Attach these tasks or planned stops to a service line so they are included in the customer-facing service scope.
                </p>
              </div>
              {canUpdateCurrentJob && (
                <button
                  type="button"
                  onClick={showNewLaborLineItem}
                  disabled={savingLaborLine || Boolean(editingLaborLineId) || newLaborLine}
                  className="rounded-md border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  New Service Line
                </button>
              )}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                {unassignedLaborTasks.map((task) => (
                  <div key={`unassigned-task-${task.id}`} className="flex flex-col gap-2 rounded-md border border-amber-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900">{task.name || task.description || task.type || "Task"}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {[task.type || "", task.estimatedTime ? formatDurationMinutes(task.estimatedTime) : "", moneyFromCents(task.contractedRate)].filter(Boolean).join(" • ")}
                      </p>
                    </div>
                    {canUpdateCurrentJob && (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={(event) => startTaskEdit(event, task)}
                          disabled={savingTaskEdit}
                          className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(event) => deleteTaskItem(event, task.id)}
                          disabled={savingTaskEdit}
                          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {unassignedLaborPlannedStops.map((stop) => (
                  <div key={`unassigned-stop-${stop.id}`} className="flex flex-col gap-2 rounded-md border border-amber-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900">{stop.name || stop.serviceStopTypeName || "Planned Stop"}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {[stop.serviceStopTypeName || stop.type || "", stop.estimatedMinutes ? formatDurationMinutes(stop.estimatedMinutes) : "", moneyFromCents(getPlannedStopCostCents(stop))].filter(Boolean).join(" • ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Link
                        to={`/company/serviceStops/createNew/${jobId}?plannedStopId=${stop.id}&category=jobVisit`}
                        className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                      >
                        Schedule
                      </Link>
                      {canUpdateCurrentJob && (
                        <button
                          type="button"
                          onClick={() => deletePlannedServiceStop(stop.id)}
                          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
        {editingUnassignedTask && (
          <tr>
            <td colSpan={7} className="bg-blue-50/60 px-4 py-3">
              {renderPlanInvoiceTaskEditForm()}
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const renderPlanInvoiceLaborLine = (line) => {
    const laborLine = (laborLineItems || []).find((item) => item.id === line.sourceId) || null;
    const isEditingLaborLine = Boolean(laborLine?.id && editingLaborLineId === laborLine.id);
    const linkedTasks = (taskList || []).filter((task) => (line.taskIds || []).includes(task.id));
    const linkedStops = (plannedServiceStops || []).filter((stop) => (line.plannedServiceStopIds || []).includes(stop.id));
    const editingLinkedTask = linkedTasks.find((task) => editingTaskId === task.id) || null;
    const showLaborLineWorkDetails = Boolean(
      laborLine && !isEditingLaborLine && (linkedTasks.length || linkedStops.length || canUpdateCurrentJob)
    );

    return (
      <React.Fragment key={line.id}>
        <tr className={isEditingLaborLine ? "bg-blue-50" : "bg-white"}>
          <td className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {line.generated ? "Generated Service" : "Service"}
              </span>
              <span className="font-semibold text-slate-950">{line.name}</span>
            </div>
            {line.description && <p className="mt-1 max-w-xl text-xs text-slate-500">{line.description}</p>}
            {(linkedTasks.length > 0 || linkedStops.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {linkedTasks.slice(0, 4).map((task) => (
                  <span
                    key={`labor-task-${line.id}-${task.id}`}
                    className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                  >
                    {task.name || task.type || "Task"}
                  </span>
                ))}
                {linkedStops.slice(0, 4).map((stop) => (
                  <span
                    key={`labor-stop-${line.id}-${stop.id}`}
                    className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
                  >
                    {stop.name || stop.serviceStopTypeName || "Planned Stop"}
                  </span>
                ))}
                {linkedTasks.length + linkedStops.length > 8 && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    +{linkedTasks.length + linkedStops.length - 8} more
                  </span>
                )}
              </div>
            )}
          </td>
          <td className="px-4 py-3 text-right font-semibold text-slate-700">{line.quantity}</td>
          <td className="px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(line.unitPriceCents)}</td>
          <td className="px-4 py-3 text-right font-bold text-slate-950">{moneyFromCents(line.totalPriceCents)}</td>
          <td className="px-4 py-3 text-right font-semibold text-slate-700">{moneyFromCents(line.internalCostCents)}</td>
          <td className={line.profitCents < 0 ? "px-4 py-3 text-right font-bold text-rose-700" : "px-4 py-3 text-right font-bold text-emerald-700"}>
            {moneyFromCents(line.profitCents)}
          </td>
          <td className="px-4 py-3 text-right">
            <div className="flex flex-wrap justify-end gap-2">
              {line.generated && canUpdateCurrentJob && (
                <button
                  type="button"
                  onClick={() => editGeneratedLaborLine(line)}
                  disabled={savingLaborLine || newLaborLine}
                  className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Make Editable
                </button>
              )}
              {laborLine && canUpdateCurrentJob && (
                <button
                  type="button"
                  onClick={() => startLaborLineEdit(laborLine)}
                  disabled={savingLaborLine}
                  className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
              )}
              {laborLine && canUpdateCurrentJob && (
                <button
                  type="button"
                  onClick={() => deleteLaborLineItem(laborLine)}
                  disabled={savingLaborLine}
                  className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
          </td>
        </tr>
        {isEditingLaborLine && (
          <tr>
            <td colSpan={7} className="bg-blue-50/60 px-4 py-3">
              {renderPlanInvoiceLaborLineForm()}
            </td>
          </tr>
        )}
        {newTask && laborLine?.id && newTaskLaborLineId === laborLine.id && (
          <tr>
            <td colSpan={7} className="bg-blue-50/60 px-4 py-3">
              {renderPlanInvoiceNewTaskForm()}
            </td>
          </tr>
        )}
        {showLaborLineWorkDetails && (
          <tr className="bg-slate-50">
            <td colSpan={7} className="px-4 py-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tasks</p>
                    {canUpdateCurrentJob && (
                      <button
                        type="button"
                        onClick={() => showNewTaskForLaborLine(laborLine.id)}
                        disabled={Boolean(editingTaskId) || newTask || newLaborLine || Boolean(editingLaborLineId)}
                        className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add Task
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    {!linkedTasks.length ? (
                      <p className="rounded-md border border-dashed border-slate-300 bg-white p-2 text-xs text-slate-500">No tasks attached.</p>
                    ) : (
                      linkedTasks.map((task) => (
                        <div key={`labor-detail-task-${line.id}-${task.id}`} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-900">{task.name || task.description || task.type || "Task"}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {[task.type || "", task.estimatedTime ? formatDurationMinutes(task.estimatedTime) : "", moneyFromCents(task.contractedRate)].filter(Boolean).join(" • ")}
                            </p>
                          </div>
                          {canUpdateCurrentJob && (
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => startTaskEdit(event, task)}
                                disabled={savingTaskEdit}
                                className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(event) => deleteTaskItem(event, task.id)}
                                disabled={savingTaskEdit}
                                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Planned Stops</p>
                    {canUpdateCurrentJob && (
                      <button
                        type="button"
                        onClick={() => openNewPlannedStopModal(laborLine.id)}
                        disabled={savingPlannedStop}
                        className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add Planned Stop
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    {!linkedStops.length ? (
                      <p className="rounded-md border border-dashed border-slate-300 bg-white p-2 text-xs text-slate-500">No planned stops attached.</p>
                    ) : (
                      linkedStops.map((stop) => (
                        <div key={`labor-detail-stop-${line.id}-${stop.id}`} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-900">{stop.name || stop.serviceStopTypeName || "Planned Stop"}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {[stop.serviceStopTypeName || stop.type || "", stop.estimatedMinutes ? formatDurationMinutes(stop.estimatedMinutes) : "", moneyFromCents(getPlannedStopCostCents(stop))].filter(Boolean).join(" • ")}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Link
                              to={`/company/serviceStops/createNew/${jobId}?plannedStopId=${stop.id}&category=jobVisit`}
                              className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              Schedule
                            </Link>
                            {canUpdateCurrentJob && (
                              <button
                                type="button"
                                onClick={() => deletePlannedServiceStop(stop.id)}
                                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
        {editingLinkedTask && (
          <tr>
            <td colSpan={7} className="bg-blue-50/60 px-4 py-3">
              {renderPlanInvoiceTaskEditForm()}
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="job-detail-view min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              {isInitialShellLoading ? (
                <div className="animate-pulse space-y-3">
                  <Link
                    to="/company/jobs"
                    className="app-back-link"
                  >
                    &larr; Back to Jobs
                  </Link>
                  <div className="flex flex-wrap gap-2">
                    <div className="h-7 w-24 rounded-full bg-slate-200" />
                    <div className="h-7 w-28 rounded-full bg-slate-200" />
                    <div className="h-7 w-32 rounded-full bg-slate-200" />
                  </div>
                  <div className="h-8 w-64 rounded bg-slate-200" />
                  <div className="h-4 w-80 rounded bg-slate-100" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/company/jobs"
                      className="app-back-link"
                    >
                      &larr; Back to Jobs
                    </Link>
                    {job.internalId && (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                        {job.internalId}
                      </span>
                    )}
                    {edit ? (
                      <>
                        <div className="min-w-[180px]">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Billing</p>
                          <Select
                            value={selectedBillingStatus}
                            options={billingStatusOptions}
                            onChange={handleSelectedBillingStatus}
                            isSearchable
                            placeholder="Billing status"
                            theme={selectTheme}
                            styles={selectStyles}
                          />
                        </div>
                        <div className="min-w-[190px]">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Operations</p>
                          <Select
                            value={selectedOperationStatus}
                            options={operationStatusOptions}
                            onChange={handleSelectedOperationStatus}
                            isSearchable
                            placeholder="Operations status"
                            theme={selectTheme}
                            styles={selectStyles}
                          />
                        </div>
                        <div className="min-w-[220px]">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Admin</p>
                          <Select
                            value={selectedAdmin}
                            options={adminList}
                            onChange={setSelectedAdmin}
                            isSearchable
                            placeholder="Select admin"
                            theme={selectTheme}
                            styles={selectStyles}
                          />
                        </div>
                        <div className="min-w-[170px]">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Issue Priority</p>
                          <Select
                            value={selectedSolutionTier}
                            options={issuePriorityOptions}
                            onChange={setSelectedSolutionTier}
                            isSearchable={false}
                            placeholder="Issue priority"
                            theme={selectTheme}
                            styles={selectStyles}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <StatusBadge status={job.billingStatus} />
                        <StatusBadge status={job.operationStatus} />
                        <IssuePriorityBadge priority={job.issuePriorityLevel || job.priorityLevel || job.solutionTier} />
                      </>
                    )}
                  </div>
                  <h1 className="mt-3 text-3xl font-bold text-slate-950">{job.type || "Job Details"}</h1>
                  <div className="mt-2 flex max-w-3xl flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      {renderCustomerDetailLink(getCustomerDisplayName())} · Created {formattedDateCreated}
                    </p>

                    <div className="inline-flex items-center gap-2 sm:justify-end">
                      <span>Last updated {formattedLastUpdated}</span>
                      <button
                        type="button"
                        onClick={() => setShowJobHistoryModal(true)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 transition hover:bg-blue-100 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                        aria-label="View job history"
                        title="View job history"
                      >
                        <GoHistory className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap justify-start gap-2 lg:justify-end lg:pl-4">
              {!isInitialShellLoading && (
                <ShareItemButton
                  type="job"
                  recordId={jobId}
                  title={job.type || job.title || "Job"}
                  subtitle={[getCustomerDisplayName(), job.billingStatus, job.operationStatus].filter(Boolean).join(" - ")}
                  companyId={recentlySelectedCompany}
                  customerId={job.customerId}
                  customerUserId={job.customerUserId}
                  collectionPath={`companies/${recentlySelectedCompany}/workOrders`}
                  webPath={`/company/jobs/detail/${jobId}`}
                />
              )}
              {!edit ? (
                <Menu as="div" className="relative inline-block text-left">
                  <MenuButton className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                    <EllipsisVerticalIcon className="h-4 w-4" aria-hidden="true" />
                    <span>Actions</span>
                    <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
                  </MenuButton>
                  <MenuItems className="absolute right-0 z-30 mt-2 w-64 origin-top-right overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                    {headerActionItems.map((action) => (
                      <JobHeaderActionMenuItem
                        key={action.label}
                        label={action.label}
                        icon={action.icon}
                        tone={action.tone}
                        onClick={action.onClick}
                        disabled={action.disabled}
                      />
                    ))}
                  </MenuItems>
                </Menu>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={saveEditChanges}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEditJob}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[450px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
              <div className="mt-3 space-y-2">
                {JOB_DETAIL_SECTIONS.map((sectionOption) => {
                  const meta = sectionMeta[sectionOption.tab] || {
                    label: sectionOption.label,
                    helper: sectionOption.helper,
                    count: "",
                  };
                  const active = sectionOption.tab === selectedSection;
                  return (
                    <button
                      key={sectionOption.id}
                      type="button"
                      onClick={() => handleJobTabChange(sectionOption.tab)}
                      className={[
                        "w-full rounded-md border px-3 py-2 text-left transition",
                        active
                          ? "border-blue-200 bg-blue-50 text-blue-800"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{meta.label}</span>
                        {meta.count && (
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                            {meta.count}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">{meta.helper}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Job Snapshot</h2>
              {sectionLoading.snapshot ? (
                <div className="mt-3 animate-pulse space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={`snapshot-loading-${index}`}>
                      <div className="h-3 w-20 rounded bg-slate-200" />
                      <div className="mt-2 h-4 w-36 rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              ) : (
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {renderCustomerDetailLink(getCustomerDisplayName("Not set"), {}, "", "Not set")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{job.adminName || "Not set"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issue Priority</dt>
                    <dd className="mt-1">
                      <IssuePriorityBadge priority={job.issuePriorityLevel || job.priorityLevel || job.solutionTier} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Site</dt>
                    <dd className="mt-1 text-slate-700">{siteAddress || "Not set"}</dd>
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimate Price</dt>
                    <dd className="mt-1 text-lg font-bold text-slate-950">{moneyFromCents(estimateCustomerPriceCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Projected Profit</dt>
                    <dd className={projectedProfitCents < 0 ? "mt-1 font-bold text-rose-700" : "mt-1 font-bold text-emerald-700"}>
                      {moneyFromCents(projectedProfitCents)}
                    </dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Comments</h2>
                  <p className="mt-1 text-xs text-slate-500">Notes and open follow-ups</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCommentsModal(true)}
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  Expand
                </button>
              </div>

              {renderCommentFilters()}
              {renderCommentComposer()}
              {renderCommentsList()}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            {selectedSection !== "Planned" && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900">{sectionMeta[selectedSection]?.label || selectedSection}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {currentOpenDetailCount}/{currentDetailPanelIds.length} open
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{sectionMeta[selectedSection]?.helper}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentDetailPanelsOpen(true)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentDetailPanelsOpen(false)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Collapse all
                  </button>
                </div>
              </div>
              </div>
            )}

            {activeTab === "Plans" && (
              <div className="space-y-3">
                <DetailDisclosure
                  panelId="plans-overview"
                  title="Summary"
                  helper="Core job details and financial snapshot"
                  count="Summary"
                >
                  {sectionLoading.plannedOverview ? (
                    <SectionSkeleton title="Loading overview" rows={6} />
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">Summary</h3>
                          <p className="mt-0.5 text-xs text-slate-500">Core job details and statuses</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        {!edit ? (
                          <StatCard
                            title="Estimate Price"
                            value={moneyFromCents(plannedEstimatePriceCents || job.rate)}
                            subtitle={plannedEstimatePriceCents ? "Services + products billing" : "Saved job rate"}
                            tone="blue"
                          />
                        ) : (
                          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                              Customer Price
                            </p>

                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-sm font-bold">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={customerPriceInput}
                                onChange={(e) => setCustomerPriceInput(e.target.value)}
                                className="w-full rounded-md border border-blue-200 bg-white px-2 py-1.5 text-sm font-bold text-gray-800"
                                placeholder="0.00"
                              />
                            </div>

                            <p className="mt-0.5 text-xs opacity-80">
                              Saves to job.rate as cents
                            </p>
                          </div>
                        )}

                        <StatCard
                          title="Services"
                          value={moneyFromCents(plannedTotalLaborCents)}
                          subtitle={(laborLineItems || []).length
                            ? `${moneyFromCents(plannedLaborPriceCents)} customer price • ${laborLineItems.length} service line${laborLineItems.length === 1 ? "" : "s"}`
                            : `${moneyFromCents(plannedStopLaborCents)} stops • ${moneyFromCents(plannedTaskLaborCents)} tech tasks • ${moneyFromCents(plannedTaskBillingLaborCents)} billable tasks`}
                        />

                        <StatCard
                          title="Products"
                          value={moneyFromCents(plannedMaterialCostCents)}
                          subtitle={`${moneyFromCents(plannedMaterialPriceCents)} billable`}
                        />

                        <StatCard
                          title="Profit"
                          value={moneyFromCents(projectedProfitCents)}
                          subtitle="Price minus planned cost"
                          tone={projectedProfitCents < 0 ? "red" : "green"}
                        />

                        <StatCard
                          title="Stops"
                          value={String(plannedServiceStops.length)}
                          subtitle="Expected visits before scheduling"
                        />

                        <StatCard
                          title="Work Offers"
                          value={String(workOffers.length)}
                          subtitle="Direct offers and board posts"
                          tone="amber"
                        />

                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3">
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</p>

                            <button
                              type="button"
                              onClick={saveDescription}
                              disabled={savingDescription || descriptionDraft === (job.description || "")}
                              className={[
                                "rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                                savingDescription || descriptionDraft === (job.description || "")
                                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                              ].join(" ")}
                            >
                              {savingDescription ? "Saving…" : "Save"}
                            </button>
                          </div>

                          <textarea
                            className="mt-2 w-full min-h-[88px] rounded-md border border-slate-300 bg-white p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder="Add job description…"
                            value={descriptionDraft}
                            onChange={(e) => setDescriptionDraft(e.target.value)}
                            onBlur={() => {
                              if (descriptionDraft !== (job.description || "")) saveDescription();
                            }}
                          />
                        </div>

                        {job.repairRequestId && (
                          <Link
                            to={`/company/repair-requests/detail/${job.repairRequestId}`}
                            state={{ sourcePath: job.repairRequestSourcePath || "company" }}
                            className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source Repair Request</p>
                            <p className="mt-1 text-sm font-semibold text-blue-700">Open repair request</p>
                            <p className="mt-0.5 text-xs text-slate-500">Converted to this job</p>
                          </Link>
                        )}
                      </div>
                    </div>
                  )}
                </DetailDisclosure>

                <DetailDisclosure
                  panelId="plans-options"
                  title="Plan Options"
                  helper="Customer choices and saved plan snapshots"
                  count={jobPlans.length}
                >
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-bold text-slate-900">Plan Options</h3>
                            <IssuePriorityBadge priority={job.issuePriorityLevel || job.priorityLevel || job.solutionTier} />
                          </div>
                          <p className="mt-1 max-w-3xl text-xs text-slate-500">
                            A job is the issue. Plans are the different ways the customer can choose to solve it.
                          </p>
                        </div>

                        {canUpdateCurrentJob && (
                          <button
                            type="button"
                            onClick={() => openPlanModal()}
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                          >
                            Save Current Work As Plan
                          </button>
                        )}
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
                        <StatCard title="Options" value={String(jobPlans.length)} subtitle="Saved plans" />
                        <StatCard
                          title="Accepted"
                          value={acceptedPlan ? getJobPlanDisplayName(acceptedPlan, "Untitled Plan") : "None"}
                          subtitle={acceptedPlan ? getJobPlanRecommendationDisplay(acceptedPlan.planTier || acceptedPlan.solutionTier) : "No customer choice yet"}
                          tone={acceptedPlan ? "green" : "gray"}
                        />
                        <StatCard
                          title="Active Plan"
                          value={activePlan ? getJobPlanDisplayName(activePlan, "Untitled Plan") : "Current"}
                          subtitle={activePlan ? getJobPlanRecommendationDisplay(activePlan.planTier || activePlan.solutionTier) : "Using job plan"}
                          tone="blue"
                        />
                        <StatCard
                          title="Proposal"
                          value={jobPlans.length > 1 ? "Options" : "Single"}
                          subtitle="Stored on service agreement"
                          tone="amber"
                        />
                      </div>
                    </div>

                    {plansLoading ? (
                      <SectionSkeleton title="Loading plans" rows={4} />
                    ) : !jobPlans.length ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                        <p className="text-base font-semibold text-slate-800">No plans saved yet.</p>
                        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
                          Save the current planned work as the first plan, then adjust the work and save additional repair, replacement, or upgrade plans.
                        </p>
                        {canUpdateCurrentJob && (
                          <button
                            type="button"
                            onClick={() => openPlanModal()}
                            className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                          >
                            Create First Plan
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {jobPlans.map((solution) => renderPlanOptionCard(solution))}
                      </div>
                    )}
                  </div>
                </DetailDisclosure>
              </div>
            )}

            {activeTab === "Planned" && (
              <DetailDisclosure
                panelId="planned-editor"
                title="Plan Editor"
                helper="Build the estimate workspace before saving or sending"
                count={selectedEditorPlan ? "Saved" : "Draft"}
              >
                <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">Plan Editor</h3>
                        {selectedEditorPlan ? (
                          <>
                            <PlanTierBadge tier={selectedEditorTier} />
                            <StatusBadge status={selectedEditorPlan.status || JOB_PLAN_STATUS.DRAFT} />
                            {hasUnsavedPlanEditorChanges && (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                                Unsaved Changes
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">
                            Unsaved
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {planEditorDraft.title.trim()
                          ? planEditorDraft.title.trim()
                          : selectedEditorPlan
                            ? getJobPlanDisplayName(selectedEditorPlan, "Untitled Plan")
                            : "Current planned work has not been saved as a plan yet."}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={selectedPlanEditorId}
                        onChange={(event) => handlePlanEditorSelection(event.target.value)}
                        disabled={!jobPlans.length || savingPlanEditor || Boolean(loadingPlanEditorId)}
                        className="min-w-[220px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {!jobPlans.length && <option value="">No saved plans</option>}
                        {jobPlans.map((solution) => {
                          const tier = normalizeJobPlanTier(solution.planTier || solution.solutionTier);
                          return (
                            <option key={solution.id} value={solution.id}>
                              {getJobPlanRecommendationDisplay(tier)} - {getJobPlanDisplayName(solution, "Untitled Plan")}
                            </option>
                          );
                        })}
                      </select>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={saveSelectedEditorPlan}
                          disabled={
                            savingPlanEditor ||
                            Boolean(loadingPlanEditorId) ||
                            (Boolean(selectedEditorPlan) && !hasUnsavedPlanEditorChanges)
                          }
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingPlanEditor
                            ? "Saving..."
                            : hasUnsavedPlanEditorChanges
                              ? "Save Changes"
                              : selectedEditorPlan
                                ? "Saved"
                                : "Save Plan"}
                        </button>
                        <button
                          type="button"
                          onClick={createPlanFromEditor}
                          disabled={savingPlanEditor || Boolean(loadingPlanEditorId)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          New Plan From Current
                        </button>
                        <button
                          type="button"
                          onClick={handleSendEstimate}
                          disabled={sendingEstimateEmail || savingPlanEditor || Boolean(loadingPlanEditorId)}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {sendingEstimateEmail ? "Sending..." : "Email Estimate"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                    <label className="block text-sm font-semibold text-slate-700">
                      Plan Name
                      <input
                        type="text"
                        value={planEditorDraft.title}
                        onChange={(event) => setPlanEditorDraft((prev) => ({ ...prev, title: event.target.value }))}
                        disabled={savingPlanEditor || Boolean(loadingPlanEditorId)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                        placeholder="Repair existing pump"
                      />
                    </label>

                    <label className="block text-sm font-semibold text-slate-700">
                      Plan Description
                      <textarea
                        value={planEditorDraft.description}
                        onChange={(event) => setPlanEditorDraft((prev) => ({ ...prev, description: event.target.value }))}
                        disabled={savingPlanEditor || Boolean(loadingPlanEditorId)}
                        className="mt-1 min-h-[86px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                        placeholder="Describe what this plan includes for the customer."
                      />
                    </label>
                  </div>

	                  <div className="mt-5 overflow-hidden rounded-lg border border-slate-300 bg-white">
	                    <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,auto)]">
	                      <div>
	                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Live Plan Invoice</p>
	                        <h4 className="mt-1 text-2xl font-bold text-slate-950">
	                          {moneyFromCents(currentPlanInvoicePriceCents)}
	                        </h4>
	                        <p className="mt-1 max-w-2xl text-xs text-slate-500">
	                          {currentPlanInvoiceLineItems.length
	                            ? `${currentPlanLaborLineItems.length} service line${currentPlanLaborLineItems.length === 1 ? "" : "s"} and ${currentPlanMaterialLineItems.length} product line${currentPlanMaterialLineItems.length === 1 ? "" : "s"}`
	                            : "No plan line items yet"}
	                        </p>
	                      </div>
	
	                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:text-right">
	                        <div>
	                          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Billed To</dt>
	                          <dd className="mt-0.5 font-semibold text-slate-900">{getCustomerDisplayName("Not set")}</dd>
	                        </div>
	                        <div>
	                          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Job</dt>
	                          <dd className="mt-0.5 font-semibold text-slate-900">{job.internalId || jobId}</dd>
	                        </div>
	                        <div>
	                          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Saved Plan</dt>
	                          <dd className="mt-0.5 font-semibold text-slate-900">
	                            {selectedEditorPlan ? moneyFromCents(selectedEditorPlanTotalCents) : "Draft"}
	                          </dd>
	                        </div>
	                        <div>
	                          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Profit</dt>
	                          <dd className={currentPlanInvoiceProfitCents < 0 ? "mt-0.5 font-bold text-rose-700" : "mt-0.5 font-bold text-emerald-700"}>
	                            {moneyFromCents(currentPlanInvoiceProfitCents)}
	                          </dd>
	                        </div>
	                      </dl>
	                    </div>
	
	                    <div className="space-y-4 p-4">
	                      <section className="overflow-hidden rounded-md border border-slate-200">
	                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
	                          <div>
	                            <h4 className="text-sm font-bold text-slate-950">Services</h4>
	                            <p className="mt-0.5 text-xs text-slate-500">
	                              Billable service price with tasks and planned stops underneath.
	                            </p>
	                          </div>
	                          <div className="flex flex-wrap items-center gap-2">
	                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
	                              Price {moneyFromCents(currentPlanLaborPriceCents)}
	                            </span>
	                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
	                              Cost {moneyFromCents(currentPlanLaborCostCents)}
	                            </span>
	                            {canUpdateCurrentJob && (
	                              <>
	                                <button
	                                  type="button"
	                                  onClick={toggleServiceCatalogPicker}
	                                  disabled={Boolean(addingCatalogServiceId) || newLaborLine || Boolean(editingLaborLineId)}
	                                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
	                                >
	                                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                  From Catalog
	                                </button>
	                                <button
	                                  type="button"
	                                  onClick={showNewLaborLineItem}
	                                  disabled={savingLaborLine || Boolean(editingLaborLineId) || newLaborLine}
	                                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
	                                >
	                                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                  Service Line
	                                </button>
	                                <button
	                                  type="button"
	                                  onClick={showNewTaskItem}
	                                  disabled={Boolean(editingTaskId) || newTask || newLaborLine || Boolean(editingLaborLineId)}
	                                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
	                                >
	                                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                  Task
	                                </button>
	                                <button
	                                  type="button"
	                                  onClick={openNewPlannedStopModal}
	                                  disabled={savingPlannedStop}
	                                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
	                                >
	                                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                  Planned Stop
	                                </button>
	                              </>
	                            )}
	                          </div>
	                        </div>

	                        {showServiceCatalogPicker && renderServiceCatalogPicker()}
	
	                        <div className="overflow-x-auto">
	                          <table className="min-w-full text-sm">
	                            <thead>
	                              <tr className="border-b border-slate-200 bg-white">
	                                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Item</th>
	                                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Qty</th>
	                                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Unit Price</th>
	                                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Total</th>
	                                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Cost</th>
	                                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Profit</th>
	                                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Actions</th>
	                              </tr>
	                            </thead>
	                            <tbody className="divide-y divide-slate-200">
	                              {!currentPlanLaborLineItems.length && !newTask && !newLaborLine ? (
	                                <tr>
	                                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
	                                    <div className="flex flex-col items-center gap-3">
	                                      <div>
	                                        <p className="font-semibold text-slate-700">No services added yet.</p>
	                                        <p className="mt-1 text-xs text-slate-500">
	                                          Add a service line to price the work, then attach tasks and planned stops underneath it.
	                                        </p>
	                                      </div>
	                                      {canUpdateCurrentJob && (
	                                        <button
	                                          type="button"
	                                          onClick={showNewLaborLineItem}
	                                          disabled={savingLaborLine || Boolean(editingLaborLineId) || newLaborLine}
	                                          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
	                                        >
	                                          <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                          Add first service
	                                        </button>
	                                      )}
	                                    </div>
	                                  </td>
	                                </tr>
	                              ) : (
	                                currentPlanLaborLineItems.map((line) => renderPlanInvoiceLaborLine(line))
	                              )}
	                              {newLaborLine && (
	                                <tr>
	                                  <td colSpan={7} className="bg-blue-50/60 px-4 py-3">
	                                    {renderPlanInvoiceLaborLineForm()}
	                                  </td>
	                                </tr>
	                              )}
	                              {newTask && !newTaskLaborLineId && (
	                                <tr>
	                                  <td colSpan={7} className="bg-blue-50/60 px-4 py-3">
	                                    {renderPlanInvoiceNewTaskForm()}
	                                  </td>
	                                </tr>
	                              )}
	                              {renderUnassignedLaborScopeRow()}
	                            </tbody>
	                          </table>
	                        </div>
	                      </section>
	
	                      <section className="overflow-hidden rounded-md border border-slate-200">
	                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
	                          <div>
	                            <h4 className="text-sm font-bold text-slate-950">Products</h4>
	                            <p className="mt-0.5 text-xs text-slate-500">
	                              Products needed for the job, purchase prep, and customer billing.
	                            </p>
	                          </div>
	                          <div className="flex flex-wrap items-center gap-2">
	                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
	                              Price {moneyFromCents(currentPlanMaterialPriceCents)}
	                            </span>
	                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
	                              Cost {moneyFromCents(currentPlanMaterialCostCents)}
	                            </span>
	                            {canUpdateCurrentJob && (
	                              <button
	                                type="button"
	                                onClick={showNewShoppingListItem}
	                                disabled={Boolean(editingShoppingItemId) || newShoppingList}
	                                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
	                              >
	                                <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                Product Line
	                              </button>
	                            )}
	                          </div>
	                        </div>
	
	                        <div className="space-y-2 bg-white p-4">
	                          {!shoppingList.length && !newShoppingList ? (
	                            <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
	                              <p className="text-sm font-medium text-slate-700">No planned products yet.</p>
	                              <p className="mt-0.5 text-xs text-slate-500">
	                                Add products to estimate purchase cost and billing.
	                              </p>
	                              {canUpdateCurrentJob && (
	                                <button
	                                  type="button"
	                                  onClick={showNewShoppingListItem}
	                                  disabled={Boolean(editingShoppingItemId) || newShoppingList}
	                                  className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
	                                >
	                                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
	                                  Add first product
	                                </button>
	                              )}
	                            </div>
	                          ) : (
	                            visiblePlannedMaterials.map((item) => renderPlannedMaterialCard(item))
	                          )}
	
	                          {hiddenPlannedMaterialCount > 0 && (
	                            <div className="pt-2 text-center">
	                              <button
	                                type="button"
	                                onClick={() => setShowAllPlannedMaterials((prev) => !prev)}
	                                className="text-sm font-semibold text-blue-700 hover:text-blue-900"
	                              >
	                                {showAllPlannedMaterials
	                                  ? "Show first 5 planned products"
	                                  : `Show ${hiddenPlannedMaterialCount} more planned product${hiddenPlannedMaterialCount === 1 ? "" : "s"}`}
	                              </button>
	                            </div>
	                          )}
	
	                          {newShoppingList && renderPlanInvoiceNewMaterialForm()}
	                        </div>
	                      </section>
	                    </div>
	
	                    <div className="grid gap-3 border-t border-slate-300 bg-slate-950 px-4 py-4 text-white md:grid-cols-3">
	                      <div>
	                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Plan Price</p>
	                        <p className="mt-1 text-xl font-bold">{moneyFromCents(currentPlanInvoicePriceCents)}</p>
	                      </div>
	                      <div>
	                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Planned Cost</p>
	                        <p className="mt-1 text-xl font-bold">{moneyFromCents(currentPlanInvoiceInternalCostCents)}</p>
	                      </div>
	                      <div>
	                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Projected Profit</p>
	                        <p className="mt-1 text-xl font-bold">{moneyFromCents(currentPlanInvoiceProfitCents)}</p>
	                      </div>
	                    </div>
	                  </div>

                  {acceptedWorkflowIsReady && (
                    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-bold text-emerald-900">
                            Accepted Plan: {getJobPlanDisplayName(acceptedPlan, "Untitled Plan")}
                          </p>
                          <p className="mt-0.5 text-xs text-emerald-800">
                            Use the sections below to schedule visits and move accepted products into purchasing.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-[320px]">
                          <div className="rounded-md border border-emerald-200 bg-white p-2">
                            <p className="font-bold text-emerald-900">{plannedStopsToSchedule.length}</p>
                            <p className="text-emerald-700">Stops to schedule</p>
                          </div>
                          <div className="rounded-md border border-emerald-200 bg-white p-2">
                            <p className="font-bold text-emerald-900">{plannedMaterialsToPurchase.length}</p>
                            <p className="text-emerald-700">Items to purchase</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </DetailDisclosure>
            )}

            {false && activeTab === "Planned" && (
              <DetailDisclosure
                panelId="planned-work"
                title="Tasks and Planned Stops"
                helper="Work items, expected visits, costs, and assignments"
                count={(taskList?.length || 0) + (plannedServiceStops?.length || 0)}
              >
                {sectionLoading.plannedWork ? (
                  <SectionSkeleton title="Loading planned work" rows={4} />
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Tasks</h3>
                        <p className="mt-0.5 text-xs text-slate-500">Track work items, costs, and assignments</p>
                      </div>
                      <div className="flex gap-2">
                        {!newTask && !editingTaskId && (
                          <button
                            onClick={showNewTaskItem}
                            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                          >
                            + Add Task
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">Planned Service Stops</h4>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Expected visits for this job before scheduling actual service stops.
                          </p>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                            {plannedServiceStops.length}
                          </span>
                          {canUpdateCurrentJob && (
                            <button
                              type="button"
                              onClick={openNewPlannedStopModal}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                            >
                              <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              Add Stop
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {!plannedServiceStops.length ? (
                          <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500">
                            No planned service stops yet.
                          </div>
                        ) : (
                          plannedServiceStops.map((stop) => renderPlannedServiceStopCard(stop))
                        )}
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full bg-white text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                            <th className="hidden p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 xl:table-cell">
                              Equipment Result
                            </th>
                            <th className="hidden p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                              Worker
                            </th>
                            <th className="hidden p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                              Worker Type
                            </th>
                            <th className="hidden p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">
                              Customer Approval
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Tech Labor</th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Labor</th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Time (Hr)</th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {taskList?.map((task) => {
                            const isEditingTask = editingTaskId === task.id;
                            const taskBillingLaborPriceCents = getTaskBillingLaborPriceCents(task);

                            return (
                              <React.Fragment key={task.id}>
                                <tr className={`${isEditingTask ? "bg-blue-50" : "hover:bg-gray-50"} transition-colors`}>
                                  <td className="whitespace-nowrap p-3 font-medium text-slate-800">
                                    <div>{task.name}</div>
                                    {taskContextLabel(task) && (
                                      <div className="mt-1 max-w-xs truncate text-xs font-normal text-gray-500">
                                        {taskContextLabel(task)}
                                      </div>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap p-3 text-slate-700">{task.type}</td>
                                  <td className="whitespace-nowrap p-3">
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                                      {task.status || "—"}
                                    </span>
                                  </td>
                                  <td className="hidden whitespace-nowrap p-3 xl:table-cell">
                                    {task.equipmentId ? (
                                      <select
                                        value={taskEquipmentStatusDrafts[task.id] || EQUIPMENT_STATUS.OPERATIONAL}
                                        onChange={(e) => handleTaskEquipmentStatusDraftChange(task.id, e.target.value)}
                                        disabled={task.status === "Finished"}
                                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                      >
                                        {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                                          <option key={statusOption} value={statusOption}>
                                            {statusOption}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="text-gray-500">—</span>
                                    )}
                                  </td>
                                  <td className="hidden whitespace-nowrap p-3 text-slate-700 md:table-cell">{task.workerName || "—"}</td>
                                  <td className="hidden whitespace-nowrap p-3 text-slate-700 md:table-cell">{task.workerType || "—"}</td>
                                  <td className="hidden whitespace-nowrap p-3 text-slate-700 lg:table-cell">
                                    {String(task.customerApproval)}
                                  </td>
                                  <td className="whitespace-nowrap p-3 text-slate-800">
                                    {formatCurrency((Number(task.contractedRate || 0) / 100) || 0)}
                                  </td>
                                  <td className="whitespace-nowrap p-3 text-slate-800">
                                    {moneyFromCents(taskBillingLaborPriceCents)}
                                  </td>
                                  <td className="whitespace-nowrap p-3 text-slate-700">
                                    {((Number(task.estimatedTime || 0) / 60) || 0).toFixed(2)}
                                  </td>
                                  <td className="whitespace-nowrap p-3 text-right">
                                    <div className="flex justify-end gap-3">
                                      {canUpdateCurrentJob && (
                                        <button
                                          type="button"
                                          onClick={(e) => startTaskEdit(e, task)}
                                          disabled={savingTaskEdit}
                                          className="text-sm font-semibold text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          Edit
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={(e) => deleteTaskItem(e, task.id)}
                                        disabled={savingTaskEdit}
                                        className="text-sm font-semibold text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>

                                {isEditingTask && (
                                  <tr>
                                    <td colSpan={11} className="bg-blue-50/60 p-3">
                                      <form
                                        onSubmit={saveTaskEdit}
                                        className="rounded-md border border-blue-200 bg-white p-3 shadow-sm"
                                      >
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Description
                                            <input
                                              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                              type="text"
                                              value={taskEditForm.name}
                                              onChange={(e) => updateTaskEditForm("name", e.target.value)}
                                            />
                                          </label>

                                          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Type
                                            <select
                                              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                              value={taskEditForm.type}
                                              onChange={(e) => updateTaskEditType(e.target.value)}
                                            >
                                              <option value="">Select task type</option>
                                              {taskTypeSelectOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                  {option.label}
                                                </option>
                                              ))}
                                            </select>
                                          </label>

                                          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Status
                                            <select
                                              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                              value={taskEditForm.status}
                                              onChange={(e) => updateTaskEditForm("status", e.target.value)}
                                            >
                                              {taskStatusSelectOptions.map((statusOption) => (
                                                <option key={statusOption} value={statusOption}>
                                                  {statusOption}
                                                </option>
                                              ))}
                                            </select>
                                          </label>

                                          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Tech Labor Cost (USD)
                                            <input
                                              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={taskEditForm.laborCost}
                                              onChange={(e) => updateTaskEditForm("laborCost", e.target.value)}
                                            />
                                          </label>

                                          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Billing Labor Price (USD)
                                            <input
                                              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={taskEditForm.billingLaborPrice}
                                              onChange={(e) => updateTaskEditForm("billingLaborPrice", e.target.value)}
                                            />
                                          </label>

                                          <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Estimated Time (Min)
                                            <input
                                              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                              type="number"
                                              min="0"
                                              step="1"
                                              value={taskEditForm.estimatedTime}
                                              onChange={(e) => updateTaskEditForm("estimatedTime", e.target.value)}
                                            />
                                          </label>

                                          {editingTaskNeedsBodyOfWater && (
                                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                              Body of Water
                                              <select
                                                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                                value={taskEditForm.bodyOfWaterId}
                                                onChange={(e) => updateTaskEditForm("bodyOfWaterId", e.target.value)}
                                              >
                                                <option value="">Select body of water</option>
                                                {taskBodyOfWaterList.map((body) => (
                                                  <option key={body.id} value={body.id}>
                                                    {body.label || body.name || "Body Of Water"}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                          )}

                                          {editingTaskNeedsEquipment && (
                                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                              Equipment
                                              <select
                                                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                                value={taskEditForm.equipmentId}
                                                onChange={(e) => updateTaskEditForm("equipmentId", e.target.value)}
                                              >
                                                <option value="">Select equipment</option>
                                                {editingTaskEquipmentOptions.map((equipment) => (
                                                  <option key={equipment.id} value={equipment.id}>
                                                    {equipment.label || equipment.name || "Equipment"}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                          )}

                                          {editingTaskNeedsInstallItem && (
                                            <>
                                              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                                Item
                                                <select
                                                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                                  value={taskEditForm.dataBaseItemId}
                                                  onChange={(e) => updateTaskEditForm("dataBaseItemId", e.target.value)}
                                                >
                                                  <option value="">Select item</option>
                                                  {shoppingDbItemList.map((item) => (
                                                    <option key={item.id} value={item.id}>
                                                      {item.label || item.name || "Item"}
                                                    </option>
                                                  ))}
                                                </select>
                                              </label>

                                              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                                Quantity
                                                <input
                                                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:ring-blue-500"
                                                  type="number"
                                                  min="0"
                                                  step="0.01"
                                                  value={taskEditForm.quantity}
                                                  onChange={(e) => updateTaskEditForm("quantity", e.target.value)}
                                                />
                                              </label>
                                            </>
                                          )}

                                          <label className="flex items-center gap-2 self-end rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                                            <input
                                              type="checkbox"
                                              checked={Boolean(taskEditForm.customerApproval)}
                                              onChange={(e) => updateTaskEditForm("customerApproval", e.target.checked)}
                                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            Customer approval
                                          </label>
                                        </div>

                                        <div className="mt-3 flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={cancelTaskEdit}
                                            disabled={savingTaskEdit}
                                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="submit"
                                            disabled={savingTaskEdit}
                                            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {savingTaskEdit ? "Saving..." : "Save Task"}
                                          </button>
                                        </div>
                                      </form>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                          {!taskList?.length && (
                            <tr>
                              <td className="p-4 text-slate-500" colSpan={11}>
                                No tasks yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {newTask && (
                      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-col items-stretch gap-2 lg:flex-row">
                          <div className="flex items-center justify-between lg:hidden">
                            <h4 className="text-sm font-bold text-slate-900">Add Task</h4>
                            <button
                              onClick={clearNewTask}
                              className="rounded-md bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-300"
                            >
                              Cancel
                            </button>
                          </div>

                          <input
                            className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                            type="text"
                            placeholder="Description"
                            value={taskDescription}
                            onChange={(e) => setTaskDescription(e.target.value)}
                          />

                          <div className="w-full">
                            <Select
                              value={selectedTaskType}
                              options={taskTypeList}
                              onChange={setSelectedTaskType}
                              isSearchable
                              placeholder="Select a Task Type"
                              theme={selectTheme}
                              styles={selectStyles}
                            />
                          </div>

                          {taskNeedsBodyOfWater && (
                            <div className="w-full">
                              <Select
                                value={selectedTaskBodyOfWater}
                                options={taskBodyOfWaterList}
                                onChange={setSelectedTaskBodyOfWater}
                                isSearchable
                                placeholder="Select Body of Water"
                                theme={selectTheme}
                                styles={selectStyles}
                              />
                            </div>
                          )}

                          {taskNeedsEquipment && (
                            <div className="w-full">
                              <Select
                                value={selectedTaskEquipment}
                                options={taskEquipmentOptions}
                                onChange={setSelectedTaskEquipment}
                                isSearchable
                                placeholder="Select Equipment"
                                theme={selectTheme}
                                styles={selectStyles}
                              />
                            </div>
                          )}

                          {taskNeedsInstallItem && (
                            <>
                              <div className="w-full">
                                <Select
                                  value={selectedTaskDbItem}
                                  options={shoppingDbItemList}
                                  onChange={setSelectedTaskDbItem}
                                  isSearchable
                                  placeholder="Select Item"
                                  theme={selectTheme}
                                  styles={selectStyles}
                                />
                              </div>

                              <input
                                className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                                type="text"
                                placeholder="Quantity"
                                value={taskQuantity}
                                onChange={(e) => setTaskQuantity(e.target.value)}
                              />
                            </>
                          )}

                          <input
                            className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Tech Labor Cost (USD)"
                            value={taskLaborCost}
                            onChange={(e) => setTaskLaborCost(e.target.value)}
                          />

                          <input
                            className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Billing Labor Price (USD)"
                            value={taskBillingLaborPrice}
                            onChange={(e) => setTaskBillingLaborPrice(e.target.value)}
                          />

                          <input
                            className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Estimated Time (Min)"
                            value={estimatedTime}
                            onChange={(e) => setEstimatedTime(e.target.value)}
                          />

                          <div className="flex gap-2">
                            <button
                              onClick={handleAddTask}
                              className="w-full rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                            >
                              Add
                            </button>
                            <button
                              onClick={clearNewTask}
                              className="hidden w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 lg:block"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={openCreateWorkOfferModal}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Create Work Offer
                      </button>
                    </div>
                  </div>
                )}
              </DetailDisclosure>
            )}

            {false && activeTab === "Planned" && (
              <DetailDisclosure
                panelId="planned-materials"
                title="Planned Products"
                helper="Expected product cost, billable pricing, and purchase readiness"
                count={shoppingList.length}
              >
                {sectionLoading.plannedMaterials ? (
                  <SectionSkeleton title="Loading planned products" rows={2} />
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">Planned Products</h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Products expected before purchasing.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                            {shoppingList.length}
                          </span>

                          {!newShoppingList && (
                            <button
                              onClick={showNewShoppingListItem}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                            >
                              <PlusIcon className="h-4 w-4" aria-hidden="true" />
                              Add Planned Product
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <StatCard
                          title="Cost"
                          value={moneyFromCents(plannedMaterialCostCents)}
                          subtitle={`${shoppingList.length} planned item(s)`}
                        />

                        <StatCard
                          title="Billable"
                          value={moneyFromCents(plannedMaterialPriceCents)}
                          subtitle="Expected customer charge"
                          tone="blue"
                        />
                      </div>

                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <div className="space-y-2">
                          {!shoppingList.length ? (
                            <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
                              <p className="text-sm font-medium text-slate-700">No planned products yet.</p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                Add planned products to estimate job cost and billing.
                              </p>
                              {canUpdateCurrentJob && (
                                <button
                                  type="button"
                                  onClick={showNewShoppingListItem}
                                  className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                                >
                                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
                                  Add first product
                                </button>
                              )}
                            </div>
                          ) : (
                            visiblePlannedMaterials.map((item) => renderPlannedMaterialCard(item))
                          )}
                        </div>

                        {hiddenPlannedMaterialCount > 0 && (
                          <div className="pt-2 text-center">
                            <button
                              type="button"
                              onClick={() => setShowAllPlannedMaterials((prev) => !prev)}
                              className="text-sm font-semibold text-blue-700 hover:text-blue-900"
                            >
                              {showAllPlannedMaterials
                                ? "Show first 5 planned products"
                                : `Show ${hiddenPlannedMaterialCount} more planned product${hiddenPlannedMaterialCount === 1 ? "" : "s"}`}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {newShoppingList && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                        <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
                            <div>
                              <h4 className="text-lg font-bold text-slate-950">
                                Add Planned Product
                              </h4>
                              <p className="mt-1 text-sm text-slate-600">
                                Add a reusable planned product snapshot for this job.
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={clearNewShoppingListItem}
                              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-50"
                              aria-label="Close add planned product"
                            >
                              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-3">
                            <div className="space-y-3 lg:col-span-2">
                              <div>
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Sub Category
                                </label>
                                <select
                                  value={shoppingFormData.subCategory}
                                  onChange={(e) => handleShoppingSubCategoryChange(e.target.value)}
                                  className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                                >
                                  {shoppingSubCategoryOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {requiresShoppingDbItem && (
                                <div>
                                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Database Item
                                    </label>
                                    {!showShoppingDbItemCreator && (
                                      <button
                                        type="button"
                                        onClick={() => setShowShoppingDbItemCreator(true)}
                                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                                      >
                                        <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                        New Database Item
                                      </button>
                                    )}
                                  </div>
                                  <Select
                                    value={selectedShoppingDbItem}
                                    options={shoppingDbItemList}
                                    onChange={handleShoppingDbItemChange}
                                    isSearchable
                                    isClearable
                                    placeholder="Select a database item"
                                    theme={selectTheme}
                                    styles={selectStyles}
                                  />
                                  {showShoppingDbItemCreator && (
                                    <div className="mt-3">
                                      {renderShoppingDatabaseItemCreator()}
                                    </div>
                                  )}
                                </div>
                              )}

                              {requiresShoppingDbItem && (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <div>
                                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Planning Unit Cost
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={shoppingFormData.plannedUnitCost}
                                      onChange={(e) => handleShoppingFormChange("plannedUnitCost", e.target.value)}
                                      className="w-full rounded-md border border-slate-300 p-2 text-sm"
                                      placeholder="0.00"
                                    />
                                  </div>

                                  <div>
                                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Planning Unit Billing Price
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={shoppingFormData.plannedUnitPrice}
                                      onChange={(e) => handleShoppingFormChange("plannedUnitPrice", e.target.value)}
                                      className="w-full rounded-md border border-slate-300 p-2 text-sm"
                                      placeholder="0.00"
                                    />
                                  </div>
                                </div>
                              )}

                              {requiresShoppingManualDetails && (
                                <>
                                  <div>
                                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Name
                                    </label>
                                    <input
                                      type="text"
                                      value={shoppingFormData.name}
                                      onChange={(e) => handleShoppingFormChange("name", e.target.value)}
                                      className="w-full rounded-md border border-slate-300 p-2 text-sm"
                                      placeholder="Enter custom product name"
                                    />
                                  </div>

                                  <div>
                                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Description
                                    </label>
                                    <textarea
                                      value={shoppingFormData.description}
                                      onChange={(e) => handleShoppingFormChange("description", e.target.value)}
                                      className="w-full min-h-[88px] rounded-md border border-slate-300 p-2 text-sm"
                                      placeholder="Enter custom product description"
                                    />
                                  </div>

                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Unit Cost
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={shoppingFormData.plannedUnitCost}
                                        onChange={(e) => handleShoppingFormChange("plannedUnitCost", e.target.value)}
                                        className="w-full rounded-md border border-slate-300 p-2 text-sm"
                                        placeholder="0.00"
                                      />
                                    </div>

                                    <div>
                                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Unit Price
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={shoppingFormData.plannedUnitPrice}
                                        onChange={(e) => handleShoppingFormChange("plannedUnitPrice", e.target.value)}
                                        className="w-full rounded-md border border-slate-300 p-2 text-sm"
                                        placeholder="0.00"
                                      />
                                    </div>
                                  </div>
                                </>
                              )}

                              <div>
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Quantity
                                </label>
                                <input
                                  type="text"
                                  value={shoppingFormData.quantity}
                                  onChange={(e) => handleShoppingFormChange("quantity", e.target.value)}
                                  className="w-full rounded-md border border-slate-300 p-2 text-sm"
                                  placeholder="Quantity"
                                />
                              </div>

                              <div>
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Linked Task
                                </label>
                                <select
                                  value={shoppingFormData.linkedTaskId}
                                  onChange={(e) => handleShoppingFormChange("linkedTaskId", e.target.value)}
                                  className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                                >
                                  <option value="">No linked task</option>
                                  {(taskList || []).map((task) => (
                                    <option key={task.id} value={task.id}>
                                      {[task.name || task.type || "Task", task.status || ""].filter(Boolean).join(" - ")}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
                                <input
                                  type="checkbox"
                                  checked={Boolean(shoppingFormData.customerApprovalRequired)}
                                  onChange={(e) => handleShoppingFormChange("customerApprovalRequired", e.target.checked)}
                                  className="mt-1"
                                />
                                <span>
                                  <span className="block font-bold text-amber-900">Require customer approval</span>
                                  <span className="mt-1 block text-amber-800">
                                    Creates a client-visible approval request and keeps this product out of Ready to Purchase until approved.
                                  </span>
                                </span>
                              </label>

                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <h5 className="text-sm font-bold text-slate-900">Pricing Snapshot</h5>
                              <p className="mt-0.5 text-xs text-slate-500">
                                Unit pricing is stored as cents and copied into this product.
                              </p>

                              <div className="mt-3 space-y-2">
                                <div className="rounded-md border border-slate-200 bg-white p-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Unit Cost
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-800">
                                    {moneyFromCents(shoppingPreviewUnitCostCents)}
                                  </p>
                                </div>

                                <div className="rounded-md border border-slate-200 bg-white p-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Unit Price
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-800">
                                    {moneyFromCents(shoppingPreviewUnitPriceCents)}
                                  </p>
                                </div>

                                <div className="rounded-md border border-slate-200 bg-white p-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Quantity
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-800">
                                    {shoppingFormData.quantity || "—"}
                                  </p>
                                </div>

                                <div className="rounded-md border border-slate-200 bg-white p-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Total Cost
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-800">
                                    {moneyFromCents(shoppingPreviewTotalCostCents)}
                                  </p>
                                </div>

                                <div className="rounded-md border border-slate-200 bg-white p-2.5">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Total Price
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-800">
                                    {moneyFromCents(shoppingPreviewTotalPriceCents)}
                                  </p>
                                </div>
                              </div>

                              <button
                                onClick={handleAddShoppingListItem}
                                disabled={!canSaveShoppingItem}
                                className="mt-3 block w-full rounded-md bg-blue-600 px-4 py-2 text-center text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                              >
                                Add Product
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </DetailDisclosure>
            )}

            {activeTab === "Actual" && (
              <DetailDisclosure
                panelId="actual-offers"
                title="Work Offers"
                helper="Technician offers and internal board posts connected to this job"
                count={workOffers.length}
              >
                {sectionLoading.workOffers ? (
                  <SectionSkeleton title="Loading work offers" rows={4} />
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">Work Offers</h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Offers and internal board posts connected to this job.
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={openCreateWorkOfferModal}
                            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                          >
                            Create Work Offer
                          </button>

                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                            {workOffers.length} total
                          </span>

                          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-bold text-green-700">
                            {workOffers.filter((offer) => offer.status === "Accepted" || offer.status === "accepted").length} accepted
                          </span>

                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                            {workOffers.filter((offer) => !offer.status || ["Pending", "pending", "Open", "open", "Posted", "posted", "Sent", "sent", "Viewed", "viewed", "Draft", "draft"].includes(offer.status)).length} open
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                        <StatCard
                          title="Offers"
                          value={String(workOffers.length)}
                          subtitle="Total offers for this job"
                        />

                        <StatCard
                          title="Accepted"
                          value={String(
                            workOffers.filter((offer) => offer.status === "Accepted" || offer.status === "accepted").length
                          )}
                          subtitle="Accepted by technician"
                          tone="green"
                        />

                        <StatCard
                          title="Board Posts"
                          value={String(workOffers.filter((offer) => offer.postedToBoard || offer.isBoardPost).length)}
                          subtitle="Posted internally"
                          tone="amber"
                        />

                        <StatCard
                          title="Self-Schedule"
                          value={String(workOffers.filter((offer) => getOfferCanSelfSchedule(offer)).length)}
                          subtitle="Tech can schedule"
                          tone="blue"
                        />
                      </div>

                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <div className="space-y-2">
                          {!workOffers.length ? (
                            <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
                              <p className="text-sm font-medium text-slate-700">No work offers yet.</p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                Create an offer to send this work to a technician or post it to the internal board.
                              </p>
                            </div>
                          ) : (
                            visibleWorkOffers.map((offer) => renderWorkOfferCard(offer))
                          )}
                        </div>

                        {hiddenWorkOfferCount > 0 && (
                          <div className="pt-2 text-center">
                            <button
                              type="button"
                              onClick={() => setShowAllWorkOffers((prev) => !prev)}
                              className="text-sm font-semibold text-blue-700 hover:text-blue-900"
                            >
                              {showAllWorkOffers
                                ? "Show first 5 work offers"
                                : `Show ${hiddenWorkOfferCount} more work offer${hiddenWorkOfferCount === 1 ? "" : "s"}`}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </DetailDisclosure>
            )}

            {activeTab === "Actual" && (
              <DetailDisclosure
                panelId="actual-service-stops"
                title="Service Stops"
                helper="Scheduled and completed visits recorded for this job"
                count={serviceStops.length}
              >
                {sectionLoading.actual ? (
                  <SectionSkeleton title="Loading service stops" rows={3} />
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Service Stops</h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {serviceStops.length} recorded for this job
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={markJobAsFinished}
                          disabled={markingJobFinished}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {markingJobFinished ? "Marking..." : "Mark Job as Finished"}
                        </button>
                        <Link
                          to={`/company/serviceStops/createNew/${jobId}?category=jobEstimate`}
                          className="inline-flex items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                        >
                          Schedule Job Estimate
                        </Link>
                        <Link
                          to={`/company/serviceStops/createNew/${jobId}?category=jobVisit`}
                          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                        >
                          Schedule Service Stop
                        </Link>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {!serviceStops.length ? (
                        <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
                          <p className="text-sm font-medium text-slate-700">No service stops yet.</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Schedule a stop to record actual work for this job.
                          </p>
                        </div>
                      ) : (
                        visibleActualServiceStops.map((stop) => renderServiceStopCard(stop))
                      )}

                      {hiddenActualServiceStopCount > 0 && (
                        <div className="pt-1 text-center">
                          <button
                            type="button"
                            onClick={() => setShowAllActualServiceStops((prev) => !prev)}
                            className="text-sm font-semibold text-blue-700 hover:text-blue-900"
                          >
                            {showAllActualServiceStops
                              ? "Show first 5 service stops"
                              : `Show ${hiddenActualServiceStopCount} more service stop${hiddenActualServiceStopCount === 1 ? "" : "s"}`}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </DetailDisclosure>
            )}


            {activeTab === "Actual" && (
              <DetailDisclosure
                panelId="actual-work"
                title="Actual Work"
                helper="Payroll, purchased products, and plan comparison"
                count={(actualPayLineItems?.length || 0) + (purchasedItems?.length || 0)}
              >
                {sectionLoading.actual ? (
                  <SectionSkeleton title="Loading actual work" rows={4} />
                ) : (
                  <div className="space-y-6">
                    <div className="bg-white shadow-lg rounded-xl p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-gray-800">Actual Work</h3>
                          <p className="text-gray-600 mt-1">
                            Actual labor and purchased product cost connected to this job.
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                            {actualPayLineItems.length} payroll line(s)
                          </span>

                          <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                            {serviceStops.length} service stop(s)
                          </span>

                          <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                            {purchasedItems.length} purchased item(s)
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                        <StatCard
                          title="Estimate Price"
                          value={moneyFromCents(estimateCustomerPriceCents)}
                          subtitle={`${moneyFromCents(plannedLaborPriceCents)} services • ${moneyFromCents(plannedMaterialPriceCents)} products`}
                          tone="blue"
                        />

                        <StatCard
                          title="Actual Labor"
                          value={moneyFromCents(actualLaborTotalCents)}
                          subtitle={`${moneyFromCents(actualPayrollTotalCents)} payroll • ${moneyFromCents(scheduledStopLaborEstimateCents)} stop labor`}
                          tone="amber"
                        />

                        <StatCard
                          title="Actual Products"
                          value={moneyFromCents(actualPurchasedMaterialCostCents)}
                          subtitle="Purchased product cost"
                          tone="amber"
                        />

                        <StatCard
                          title="Actual Profit"
                          value={moneyFromCents(actualProfitCents)}
                          subtitle="Estimate price minus actual services and products"
                          tone={actualProfitCents < 0 ? "red" : "green"}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="bg-white shadow-lg rounded-xl p-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-lg font-bold text-gray-800">Actual Payroll</h4>
                            <p className="text-gray-600 mt-1 text-sm">
                              Payroll line items created from service stops, tasks, or adjustments. Stops without payroll lines are estimated in the labor total.
                            </p>

                          </div>

                          <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                            {moneyFromCents(actualPayrollTotalCents)}
                          </span>
                        </div>

                        <div className="mt-6 space-y-3">
                          {!actualPayLineItems.length ? (
                            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                              <p className="text-gray-700 font-medium">Payroll line items not connected yet.</p>
                              <p className="text-sm text-gray-500 mt-1">
                                This tab is ready, but the exact web payroll line item path still needs to be confirmed.
                              </p>
                            </div>
                          ) : (
                            actualPayLineItems.map((line) => renderActualPayrollLineCard(line))
                          )}
                        </div>
                      </div>

                      <div className="bg-white shadow-lg rounded-xl p-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-lg font-bold text-gray-800">Purchased Products</h4>
                            <p className="text-gray-600 mt-1 text-sm">
                              Actual vendor receipt items attached to this job.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                              {moneyFromCents(actualPurchasedMaterialCostCents)}
                            </span>
                            <button
                              type="button"
                              onClick={openPurchasedItemPicker}
                              className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                            >
                              + Attach Purchased Item
                            </button>
                          </div>
                        </div>

                        <div className="mt-6 space-y-3">
                          {!purchasedItems.length ? (
                            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                              <p className="text-gray-700 font-medium">No purchased products yet.</p>
                              <p className="text-sm text-gray-500 mt-1">
                                Purchased items from vendor receipts will appear here when tied to this job.
                              </p>
                            </div>
                          ) : (
                            purchasedItems.map((item) => renderPurchasedMaterialCard(item))
                          )}
                        </div>
                      </div>

                      {showPurchasedItemPicker && (
                        <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="attach-purchased-items-title"
                        >
                          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
                              <div>
                                <h4 id="attach-purchased-items-title" className="text-lg font-bold text-slate-950">
                                  Attach Purchased Items
                                </h4>
                                <p className="mt-1 text-sm text-slate-600">
                                  Showing {filteredAvailablePurchasedItems.length} of {availablePurchasedItems.length} unassigned item{availablePurchasedItems.length === 1 ? "" : "s"}.
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={closePurchasedItemPicker}
                                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-50"
                                aria-label="Close attach purchased items"
                              >
                                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                              </button>
                            </div>

                            <div className="space-y-4 overflow-y-auto p-5">
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                                <div className="xl:col-span-2">
                                  <label className="block text-xs font-bold text-gray-600 mb-1">Search</label>
                                  <input
                                    type="search"
                                    value={purchasedItemSearchTerm}
                                    onChange={(e) => setPurchasedItemSearchTerm(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm"
                                    placeholder="Item, vendor, SKU, invoice"
                                    autoFocus
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">Sort</label>
                                  <select
                                    value={purchasedItemSortBy}
                                    onChange={(e) => setPurchasedItemSortBy(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                                  >
                                    <option value="date-desc">Newest First</option>
                                    <option value="date-asc">Oldest First</option>
                                    <option value="name-asc">Name A-Z</option>
                                    <option value="vendor-asc">Vendor A-Z</option>
                                    <option value="total-desc">Total High-Low</option>
                                    <option value="total-asc">Total Low-High</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">Start Date</label>
                                  <input
                                    type="date"
                                    value={purchasedItemStartDate}
                                    onChange={(e) => setPurchasedItemStartDate(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">End Date</label>
                                  <input
                                    type="date"
                                    value={purchasedItemEndDate}
                                    onChange={(e) => setPurchasedItemEndDate(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">Category</label>
                                  <select
                                    value={purchasedItemCategoryFilter}
                                    onChange={(e) => setPurchasedItemCategoryFilter(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                                  >
                                    {purchasedItemCategoryOptions.map((category) => (
                                      <option key={category} value={category}>
                                        {category}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">Billable</label>
                                  <select
                                    value={purchasedItemBillableFilter}
                                    onChange={(e) => setPurchasedItemBillableFilter(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                                  >
                                    <option value="All">All</option>
                                    <option value="Billable">Billable</option>
                                    <option value="Not Billable">Not Billable</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">Invoiced</label>
                                  <select
                                    value={purchasedItemInvoicedFilter}
                                    onChange={(e) => setPurchasedItemInvoicedFilter(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 bg-white"
                                  >
                                    <option value="All">All</option>
                                    <option value="Invoiced">Invoiced</option>
                                    <option value="Not Invoiced">Not Invoiced</option>
                                  </select>
                                </div>

                                <div className="flex items-end">
                                  <button
                                    type="button"
                                    onClick={loadAvailablePurchasedItems}
                                    disabled={loadingAvailablePurchasedItems}
                                    className="w-full rounded-lg bg-white border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 transition disabled:opacity-60"
                                  >
                                    {loadingAvailablePurchasedItems ? "Loading..." : "Load Items"}
                                  </button>
                                </div>
                              </div>

                              <div className="max-h-[52vh] overflow-y-auto space-y-2 pr-1">
                                {loadingAvailablePurchasedItems ? (
                                  <div className="rounded-xl border border-dashed border-blue-200 bg-white p-5 text-center text-sm text-gray-600">
                                    Loading unassigned purchased items...
                                  </div>
                                ) : filteredAvailablePurchasedItems.length ? (
                                  filteredAvailablePurchasedItems.map((item) => renderAvailablePurchasedItemPickerRow(item))
                                ) : (
                                  <div className="rounded-xl border border-dashed border-blue-200 bg-white p-5 text-center">
                                    <p className="font-semibold text-gray-700">
                                      {availablePurchasedItems.length
                                        ? "No purchased items match these filters."
                                        : "No unassigned purchased items found."}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-500">
                                      Adjust the date range or filters to search more receipt items.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-sm font-semibold text-slate-600">
                                {selectedPurchasedItemIds.length} selected
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                <button
                                  type="button"
                                  onClick={closePurchasedItemPicker}
                                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={attachPurchasedItemsToJob}
                                  disabled={!selectedPurchasedItemIds.length}
                                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Attach {selectedPurchasedItemIds.length || ""}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-white shadow-lg rounded-xl p-6">
                      <div>
                        <h4 className="text-lg font-bold text-gray-800">Plan vs Actual</h4>
                        <p className="text-gray-600 mt-1 text-sm">
                          Compare the original plan against actual recorded cost.
                        </p>
                      </div>

                      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Estimate Services
                          </p>
                          <p className="mt-1 text-lg font-bold text-gray-800">
                            {moneyFromCents(plannedLaborPriceCents)}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            {moneyFromCents(plannedTotalLaborCents)} planned cost
                          </p>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Estimate Products
                          </p>
                          <p className="mt-1 text-lg font-bold text-gray-800">
                            {moneyFromCents(plannedMaterialPriceCents)}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            {moneyFromCents(plannedMaterialCostCents)} planned cost
                          </p>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Actual Cost Delta
                          </p>
                          <p
                            className={[
                              "mt-1 text-lg font-bold",
                              actualCostVarianceCents > 0 ? "text-red-700" : "text-green-700",
                            ].join(" ")}
                          >
                            {moneyFromCents(actualCostVarianceCents)}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            Actual cost minus planned cost
                          </p>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Profit Movement
                          </p>
                          <p
                            className={[
                              "mt-1 text-lg font-bold",
                              actualProfitCents < projectedProfitCents ? "text-red-700" : "text-green-700",
                            ].join(" ")}
                          >
                            {moneyFromCents(actualProfitCents - projectedProfitCents)}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            Actual profit minus projected profit
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </DetailDisclosure>
            )}
            {activeTab === "History" && (
              <div className="space-y-6">
                <DetailDisclosure
                  panelId="history-summary"
                  title="History Summary"
                  helper="Change-order totals and tracked update counts"
                  count={(jobHistory?.length || 0) + (changeOrders?.length || 0)}
                >
                  <div className="bg-white shadow-lg rounded-xl p-6">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-gray-800">History</h3>
                        <p className="text-gray-600 mt-1">
                          Change orders and job updates for this work order.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={openChangeOrderModal}
                        className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                      >
                        New Change Order
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                      <StatCard
                        title="History Events"
                        value={String(jobHistory.length)}
                        subtitle="Tracked job changes"
                      />
                      <StatCard
                        title="Change Orders"
                        value={String(changeOrders.length)}
                        subtitle={`${openChangeOrders.length} open`}
                        tone="amber"
                      />
                      <StatCard
                        title="Price Impact"
                        value={moneyFromCents(changeOrders.reduce((total, order) => total + cents(order.priceImpactCents), 0))}
                        subtitle="All change orders"
                        tone="blue"
                      />
                      <StatCard
                        title="Cost Impact"
                        value={moneyFromCents(
                          changeOrders.reduce(
                            (total, order) => total + cents(order.laborCostImpactCents) + cents(order.materialCostImpactCents),
                            0
                          )
                        )}
                        subtitle="Services plus products"
                        tone="red"
                      />
                    </div>
                  </div>
                </DetailDisclosure>

                <DetailDisclosure
                  panelId="history-change-orders"
                  title="Change Orders"
                  helper="Scope, price, services, products, and schedule changes"
                  count={changeOrders.length}
                >
                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                    <div className="xl:col-span-2 bg-white shadow-lg rounded-xl p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-gray-800">Change Orders</h4>
                          <p className="text-gray-600 mt-1 text-sm">
                            Requests that change scope, price, services, products, or schedule.
                          </p>
                        </div>
                      </div>

                      <div className="mt-6 space-y-3">
                        {changeOrdersLoading ? (
                          <div className="text-gray-500">Loading change orders…</div>
                        ) : !changeOrders.length ? (
                          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                            <p className="text-gray-700 font-medium">No change orders yet.</p>
                            <button
                              type="button"
                              onClick={openChangeOrderModal}
                              className="mt-4 px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                            >
                              Create Change Order
                            </button>
                          </div>
                        ) : (
                          changeOrders.map((order) => renderChangeOrderCard(order))
                        )}
                      </div>
                    </div>
                  </div>
                </DetailDisclosure>
              </div>
            )}
            {activeTab === "Billing" && (
              <div className="space-y-6">
                <DetailDisclosure
                  panelId="billing-summary"
                  title="Billing Lifecycle"
                  helper="Estimate, acceptance, invoicing, payment, and margin"
                  count={job.billingStatus || "Draft"}
                >
                  <div className="bg-white shadow-lg rounded-xl p-6">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-bold text-gray-800">Billing</h3>
                          <button
                            type="button"
                            onClick={() => setShowBillingLifecycleHelp(true)}
                            aria-label="Open billing lifecycle guidance"
                            title="Billing lifecycle guidance"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
                          >
                            i
                          </button>
                        </div>
                        <p className="text-gray-600 mt-1">
                          Estimate, acceptance, invoicing, and payment lifecycle
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={openCreateContractModal}
                          className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                        >
                          New Service Agreement
                        </button>

                        <button
                          onClick={handleSendEstimate}
                          disabled={sendingEstimateEmail || (!salesWorkflowEnabled && !selectedContract)}
                          className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition disabled:opacity-50"
                        >
                          {salesWorkflowEnabled ? (sendingEstimateEmail ? "Sending..." : "Email Estimate") : "Send Estimate"}
                        </button>
                        <button
                          onClick={handleMarkEstimateAccepted}
                          disabled={!salesWorkflowEnabled && !selectedContract}
                          className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition disabled:opacity-50"
                        >
                          Mark Accepted
                        </button>
                        {salesWorkflowEnabled && (
                          <button
                            onClick={handleEmailInvoice}
                            disabled={sendingInvoiceEmail}
                            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
                          >
                            {sendingInvoiceEmail ? "Sending..." : "Email Invoice"}
                          </button>
                        )}
                        <button
                          onClick={handleMarkAsInvoiced}
                          disabled={markingJobInvoiced || sendingInvoiceEmail}
                          className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                        >
                          {markingJobInvoiced ? "Marking..." : "Mark As Invoiced"}
                        </button>
                      </div>


                    </div>
                    <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-gray-800">Billing Lifecycle</h4>
                          <p className="text-sm text-gray-600 mt-1">
                            Job billing and operation status should move together as the job progresses.
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.billingStatus)}`}>
                            {job.billingStatus || "—"}
                          </span>

                          <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.operationStatus)}`}>
                            {job.operationStatus || "—"}
                          </span>
                        </div>
                      </div>

                      <div className={`mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 ${salesWorkflowEnabled ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
                        <button
                          type="button"
                          onClick={openCreateContractModal}
                          className="px-4 py-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                        >
                          Create Agreement Draft
                        </button>

                        <button
                          type="button"
                          onClick={handleSendEstimate}
                          disabled={sendingEstimateEmail || (!salesWorkflowEnabled && !selectedContract)}
                          className="px-4 py-3 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition disabled:opacity-50"
                        >
                          {salesWorkflowEnabled ? (sendingEstimateEmail ? "Sending..." : "Email Estimate") : "Send Estimate"}
                        </button>

                        <button
                          type="button"
                          onClick={handleMarkEstimateAccepted}
                          disabled={!salesWorkflowEnabled && !selectedContract}
                          className="px-4 py-3 text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition disabled:opacity-50"
                        >
                          Mark Accepted
                        </button>

                        {salesWorkflowEnabled && (
                          <button
                            type="button"
                            onClick={handleEmailInvoice}
                            disabled={sendingInvoiceEmail}
                            className="px-4 py-3 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
                          >
                            {sendingInvoiceEmail ? "Sending..." : "Email Invoice"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={handleMarkAsInvoiced}
                          disabled={markingJobInvoiced || sendingInvoiceEmail}
                          className="px-4 py-3 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                        >
                          {markingJobInvoiced ? "Marking..." : "Mark As Invoiced"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <StatCard
                        title="Estimate Price"
                        value={moneyFromCents(estimateCustomerPriceCents)}
                        subtitle={plannedEstimatePriceCents ? "Current plan services + products" : "Saved job rate"}
                        tone="blue"
                      />

                      <StatCard
                        title="Product Cost"
                        value={moneyFromCents(actualPurchasedMaterialCostCents)}
                        subtitle={`${purchasedItems.length} purchased product item(s)`}
                        tone="red"
                      />

                      <StatCard
                        title="Labor Cost"
                        value={moneyFromCents(actualLaborTotalCents)}
                        subtitle={`${moneyFromCents(actualPayrollTotalCents)} payroll • ${moneyFromCents(scheduledStopLaborEstimateCents)} stop labor`}
                        tone="red"
                      />

                      <StatCard
                        title="Profit"
                        value={moneyFromCents(actualProfitCents)}
                        subtitle={`${actualMarginPercent}% margin vs estimate`}
                        tone={actualProfitCents < 0 ? "red" : "green"}
                      />
                    </div>
                  </div>
                </DetailDisclosure>

                <DetailDisclosure
                  panelId="billing-agreements"
                  title="Agreements and Snapshot"
                  helper="Drafts, sent agreements, legacy contracts, terms, and line items"
                  count={(jobSalesAgreements?.length || 0) + (contracts?.length || 0)}
                >
                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                    <div className="xl:col-span-2 bg-white shadow-lg rounded-xl p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-gray-800">Service Agreements</h4>
                          <p className="text-gray-600 mt-1 text-sm">Drafts and sent agreements tied to this job</p>
                        </div>
                      </div>

                      <div className="mt-6 space-y-3">
                        {salesAgreementsLoading ? (
                          <div className="text-gray-500">Loading service agreements…</div>
                        ) : !jobSalesAgreements.length ? (
                          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                            <p className="text-gray-700 font-medium">No service agreements yet.</p>
                            <p className="text-sm text-gray-500 mt-1">
                              Create a draft agreement to start the billing lifecycle for this job.
                            </p>
                            <button
                              onClick={openCreateContractModal}
                              className="mt-4 px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                            >
                              Create Agreement Draft
                            </button>
                          </div>
                        ) : (
                          jobSalesAgreements.map((agreement, index) => {
                            const active = selectedSalesAgreement?.id === agreement.id;
                            return (
                              <div
                                key={agreement.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setSelectedSalesAgreementId(agreement.id);
                                  setLinkedSalesAgreement(agreement);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedSalesAgreementId(agreement.id);
                                    setLinkedSalesAgreement(agreement);
                                  }
                                }}
                                className={[
                                  "w-full cursor-pointer text-left p-4 rounded-xl border transition",
                                  active
                                    ? "border-blue-300 bg-blue-50 shadow-sm"
                                    : "border-gray-200 bg-gray-50 hover:bg-white",
                                ].join(" ")}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                      Agreement {agreement.version || jobSalesAgreements.length - index}
                                    </p>
                                    <p className="mt-1 text-base font-bold text-gray-800">
                                      {formatCurrency((Number(agreement.totalAmountCents ?? agreement.rateAmountCents ?? 0) / 100) || 0)}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-600">
                                      Sent: {formatDateTimeValue(agreement.sentAt || agreement.emailDelivery?.lastSentAt)}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-600">
                                      Accept By: {formatDateValue(agreement.expiresAt)}
                                    </p>
                                  </div>

                                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(agreement.status)}`}>
                                    {formatStatusLabel(agreement.status) || "—"}
                                  </span>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    <Link
                                      to={`/company/sales/agreements/${agreement.id}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition"
                                    >
                                      Open Agreement
                                    </Link>
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</p>
                                    <p className="mt-1 text-gray-800">
                                      {renderCustomerDetailLink(agreement.customerName || customer.firstName || "—", agreement, "")}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Accepted</p>
                                    <p className="mt-1 text-gray-800">
                                      {agreement.status === SalesAgreementStatus.accepted ? "Yes" : "No"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}

                        {contractsLoading ? (
                          <div className="pt-4 text-sm text-gray-500">Loading legacy contracts…</div>
                        ) : contracts.length ? (
                          <div className="pt-4 border-t border-gray-200 space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                              Legacy Contracts
                            </p>
                            {contracts.map((contract, index) => (
                              <div key={contract.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                      Legacy Version {contract.version || contracts.length - index}
                                    </p>
                                    <p className="mt-1 text-base font-bold text-gray-800">
                                      {formatCurrency((Number(contract.rate || 0) / 100) || 0)}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-600">
                                      Sent: {formatDateTimeValue(contract.dateSent)}
                                    </p>
                                  </div>
                                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(contract.status)}`}>
                                    {formatStatusLabel(contract.status) || "—"}
                                  </span>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedContractId(contract.id);
                                      openContractModal(contract);
                                    }}
                                    className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition"
                                  >
                                    Edit Legacy
                                  </button>
                                  <Link
                                    to={`/company/contract/detail/${contract.id}`}
                                    className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition"
                                  >
                                    Open Legacy
                                  </Link>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="xl:col-span-3 space-y-6">
                      <div className="bg-white shadow-lg rounded-xl p-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-lg font-bold text-gray-800">Agreement Snapshot</h4>
                            <p className="text-gray-600 mt-1 text-sm">
                              Snapshot of the selected service agreement
                            </p>
                          </div>
                          <div>
                            {billingRecordDisplay.detailUrl && (
                              <Link
                                to={billingRecordDisplay.detailUrl}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition"
                              >
                                {billingRecordDisplay.detailLabel}
                              </Link>
                            )}
                          </div>
                          {selectedBillingRecord && (
                            <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(billingRecordDisplay.status)}`}>
                              {formatStatusLabel(billingRecordDisplay.status) || "—"}
                            </span>
                          )}
                        </div>

                        {!selectedBillingRecord ? (
                          <div className="mt-6 text-gray-500">Select or create a service agreement to see its snapshot.</div>
                        ) : (
                          <>
                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sender</p>
                                <p className="mt-1 text-gray-800 font-semibold">{billingRecordDisplay.sender}</p>
                              </div>

                              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Receiver</p>
                                <p className="mt-1 text-gray-800 font-semibold">
                                  {renderCustomerDetailLink(
                                    billingRecordDisplay.receiver,
                                    { customerId: billingRecordDisplay.customerId },
                                    ""
                                  )}
                                </p>
                              </div>

                              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Sent</p>
                                <p className="mt-1 text-gray-800 font-semibold">{formatDateTimeValue(billingRecordDisplay.sentAt)}</p>
                              </div>

                              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Accepted On</p>
                                <p className="mt-1 text-gray-800 font-semibold">{formatDateTimeValue(billingRecordDisplay.acceptedAt)}</p>
                              </div>

                              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Date To Accept</p>
                                <p className="mt-1 text-gray-800 font-semibold">{formatDateValue(billingRecordDisplay.acceptBy)}</p>
                              </div>

                              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Estimate</p>
                                <p className="mt-1 text-gray-800 font-bold text-lg">
                                  {formatCurrency((billingRecordDisplay.totalAmountCents / 100) || 0)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-6">
                              <h5 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Scope / Terms</h5>

                              {!normalizedSelectedTerms.length ? (
                                <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                                  No terms added to this agreement.
                                </div>
                              ) : (
                                <div className="mt-3 space-y-3">
                                  {normalizedSelectedTerms.map((term) => (
                                    <div
                                      key={term.id}
                                      className="p-4 rounded-xl bg-gray-50 border border-gray-200"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="font-semibold text-gray-800">{term.title}</p>
                                          <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                                            {term.description || "—"}
                                          </p>
                                        </div>

                                        {term.value !== "" && term.value !== null && term.value !== undefined && (
                                          <div className="text-sm font-semibold text-gray-700">
                                            {typeof term.value === "number"
                                              ? formatCurrency((Number(term.value) / 100) || 0)
                                              : String(term.value)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="mt-6">
                              <h5 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Estimate Snapshot</h5>

                              {!billingSnapshotItems.length ? (
                                <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                                  No line items found.
                                </div>
                              ) : (
                                <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
                                  <table className="min-w-full bg-white">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                          Type
                                        </th>
                                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                          Name
                                        </th>
                                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                          Description
                                        </th>
                                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                          Qty
                                        </th>
                                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                                          Amount
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {billingSnapshotItems.map((item) => (
                                        <tr key={item.id}>
                                          <td className="p-4 text-sm text-gray-700">{item.type || "—"}</td>
                                          <td className="p-4 text-sm font-medium text-gray-800">{item.name || "—"}</td>
                                          <td className="p-4 text-sm text-gray-700">{item.description || "—"}</td>
                                          <td className="p-4 text-sm text-gray-700">{item.quantity || 1}</td>
                                          <td className="p-4 text-sm font-semibold text-gray-800">{item.displayAmount}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            <div className="mt-6 p-4 rounded-xl bg-gray-50 border border-gray-200">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</p>
                              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                                {billingRecordDisplay.notes}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </DetailDisclosure>
              </div>
            )}

          </div>
        </section>
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={() => setShowJobHistoryModal(true)}
            className="text-sm font-semibold text-blue-700 underline-offset-4 hover:text-blue-900 hover:underline"
          >
            View job history
          </button>
        </div>
      </div>
      {edit && (canUpdateCurrentJob || can("26")) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {canUpdateCurrentJob && (
            <button
              type="button"
              onClick={cancelJob}
              disabled={expiringJob || resolvingCustomerHandledJob || deletingJob}
              className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {expiringJob ? "Canceling..." : isJobExpired ? "Refresh Expired Note" : "Cancel Job"}
            </button>
          )}
          {canUpdateCurrentJob && (
            <button
              type="button"
              onClick={markCustomerTookCareOfJob}
              disabled={expiringJob || resolvingCustomerHandledJob || deletingJob}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resolvingCustomerHandledJob
                ? "Closing..."
                : isJobCustomerResolved
                  ? "Refresh Customer Resolution"
                  : "Customer Took Care Of It"}
            </button>
          )}
          {can("26") && (
            <button
              type="button"
              onClick={deleteJob}
              disabled={deletingJob || expiringJob || resolvingCustomerHandledJob}
              className="w-full rounded-xl border border-red-300 bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletingJob ? "Deleting..." : "Delete Job"}
            </button>
          )}
        </div>
      )}
      {showCreateTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <form onSubmit={saveJobAsTemplate}>
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Create Job Template</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Save this prebuilt job's service lines, planned stops, tasks, products, and pricing for reuse.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateTemplateModal}
                  disabled={savingJobTemplate}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  Close
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Template Name
                  </label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Template name"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                  <StatCard title="Tasks" value={String(taskList.length)} subtitle="Planned work" />
                  <StatCard title="Stops" value={String(plannedServiceStops.length)} subtitle="Planned visits" />
                  <StatCard title="Service Lines" value={String(laborLineItems.length)} subtitle="Editable estimate" />
                  <StatCard title="Products" value={String(shoppingList.length)} subtitle="Planned items" />
                  <StatCard
                    title="Price"
                    value={moneyFromCents(plannedEstimatePriceCents || job.rate)}
                    subtitle={plannedEstimatePriceCents ? "Services + products billing" : "Default rate"}
                    tone="blue"
                  />
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Actual service stops, invoices, payroll, purchased receipt items, comments, and work offers are not copied into the template.
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCreateTemplateModal}
                  disabled={savingJobTemplate}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingJobTemplate}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingJobTemplate ? "Creating..." : "Create Template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showCustomerNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Create Customer Note</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Review the pre-filled job summary before saving it to the customer notes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomerNoteModal(false)}
                disabled={savingCustomerNote}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Audience
                  </label>
                  <select
                    value={customerNoteAudience}
                    onChange={(event) => setCustomerNoteAudience(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {CUSTOMER_NOTE_AUDIENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Body Of Water
                  </label>
                  <select
                    value={customerNoteBodyOfWaterId}
                    onChange={(event) => setCustomerNoteBodyOfWaterId(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">All customer pools</option>
                    {taskBodyOfWaterList.map((body) => (
                      <option key={body.id} value={body.id}>
                        {body.label || body.name || "Body Of Water"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Note
                </label>
                <textarea
                  value={customerNoteDraft}
                  onChange={(event) => setCustomerNoteDraft(event.target.value)}
                  rows={10}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Write a customer note..."
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowCustomerNoteModal(false)}
                disabled={savingCustomerNote}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCustomerNoteFromJob}
                disabled={savingCustomerNote || !customerNoteDraft.trim()}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {savingCustomerNote ? "Saving..." : "Create Customer Note"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showJobHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Job History</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Changes recorded for {job.internalId || job.type || "this job"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowJobHistoryModal(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <StatCard
                  title="History Events"
                  value={String(jobHistory.length)}
                  subtitle="Tracked job changes"
                />
                <StatCard
                  title="Change Orders"
                  value={String(changeOrders.length)}
                  subtitle={`${openChangeOrders.length} open`}
                  tone="amber"
                />
                <StatCard
                  title="Price Impact"
                  value={moneyFromCents(changeOrders.reduce((total, order) => total + cents(order.priceImpactCents), 0))}
                  subtitle="All change orders"
                  tone="blue"
                />
                <StatCard
                  title="Last Updated"
                  value={formattedLastUpdated}
                  subtitle={job.lastHistoryEventTitle || "Most recent event"}
                  tone="green"
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 xl:col-span-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-bold text-slate-900">Change Orders</h4>
                      <p className="mt-1 text-sm text-slate-600">
                        Scope, price, services, products, and schedule changes.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openChangeOrderModal}
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
                    >
                      New Change Order
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {changeOrdersLoading ? (
                      <div className="text-sm text-slate-500">Loading change orders...</div>
                    ) : !changeOrders.length ? (
                      <div className="rounded-md border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600">
                        No change orders yet.
                      </div>
                    ) : (
                      changeOrders.map((order) => renderChangeOrderCard(order))
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 xl:col-span-3">
                  <div>
                    <h4 className="text-base font-bold text-slate-900">Timeline</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      Who changed what and when.
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    {jobHistoryLoading ? (
                      <div className="text-sm text-slate-500">Loading history...</div>
                    ) : !jobHistory.length ? (
                      <div className="rounded-md border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600">
                        No history events recorded yet.
                      </div>
                    ) : (
                      jobHistory.map((event, index) => renderHistoryEventCard(event, { isCurrent: index === 0 }))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {newPlannedStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-xl font-bold text-slate-950">Add Planned Service Stop</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Plan an expected visit before it becomes a scheduled service stop.
                </p>
                {newPlannedStopTargetLaborLine && (
                  <p className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800">
                    Attaches to {newPlannedStopTargetLaborLine.name || "this service line"}.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={clearNewPlannedStop}
                disabled={savingPlannedStop}
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close planned stop form"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleAddPlannedServiceStop} className="grid grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  Service Stop Type
                  <select
                    value={plannedStopForm.serviceStopTypeId}
                    onChange={(event) => updatePlannedStopForm("serviceStopTypeId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select service stop type</option>
                    {(companyServiceStopTypes || []).map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name || type.label || type.type || "Service Stop Type"}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Stop Name
                    <input
                      type="text"
                      value={plannedStopForm.name}
                      onChange={(event) => updatePlannedStopForm("name", event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder={selectedPlannedStopType?.name || "Planned visit"}
                    />
                  </label>

                  <label className="block text-sm font-semibold text-slate-700">
                    Estimated Time (Min)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={plannedStopForm.estimatedMinutes}
                      onChange={(event) => updatePlannedStopForm("estimatedMinutes", event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="block text-sm font-semibold text-slate-700">
                  Description
                  <textarea
                    value={plannedStopForm.description}
                    onChange={(event) => updatePlannedStopForm("description", event.target.value)}
                    className="mt-1 min-h-[96px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Notes for this planned visit."
                  />
                </label>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">Linked Tasks</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Leave all unchecked to estimate this stop against all current tasks.
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                      {plannedStopForm.taskIds.length || "All"}
                    </span>
                  </div>

                  <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                    {!taskList.length ? (
                      <div className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                        No tasks are available yet.
                      </div>
                    ) : (
                      taskList.map((task) => (
                        <label key={task.id} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm">
                          <input
                            type="checkbox"
                            checked={plannedStopForm.taskIds.includes(task.id)}
                            onChange={() => togglePlannedStopTask(task.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">{task.name || task.description || "Task"}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {[task.type || "Task", task.estimatedTime ? formatDurationMinutes(task.estimatedTime) : ""].filter(Boolean).join(" • ")}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-bold text-slate-900">Payroll Planning Snapshot</h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  Profit planning uses the highest matching technician rate.
                </p>

                <div className="mt-3 space-y-2">
                  <div className="rounded-md border border-slate-200 bg-white p-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Pay Range</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{plannedStopFormRangeLabel}</p>
                  </div>

                  <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Planning Cost</p>
                    <p className="mt-1 text-lg font-bold text-blue-950">
                      {moneyFromCents(plannedStopFormPayRange.maxAmountCents)}
                    </p>
                    <p className="mt-1 text-xs text-blue-800">
                      {plannedStopFormPayRange.highestWorkerName || "No rate match"}
                    </p>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-white p-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tasks Estimated</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      {plannedStopFormTasks.length}
                    </p>
                  </div>

                  {plannedStopFormPayRange.needsReview && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">
                      Some payroll mappings or technician rates need review for this estimate.
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="submit"
                    disabled={savingPlannedStop}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingPlannedStop ? "Saving..." : "Add Planned Stop"}
                  </button>
                  <button
                    type="button"
                    onClick={clearNewPlannedStop}
                    disabled={savingPlannedStop}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-xl font-bold text-slate-950">
                  {planForm.id ? "Refresh Plan" : "Save Current Work As Plan"}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  This saves the current job tasks, planned stops, products, and pricing as a selectable customer option.
                </p>
              </div>
              <button
                type="button"
                onClick={closePlanModal}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700">
                  Recommendation Rank
                  <select
                    value={planForm.planTier || planForm.solutionTier}
                    onChange={(event) => {
                      const nextTier = normalizeJobPlanTier(event.target.value);
                      setPlanForm((prev) => ({ ...prev, planTier: nextTier, solutionTier: nextTier }));
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {JOB_PLAN_TIER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {getJobPlanRecommendationDisplay(option.value)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-semibold text-slate-700">
                  Status
                  <select
                    value={planForm.status}
                    onChange={(event) => setPlanForm((prev) => ({ ...prev, status: normalizeJobPlanStatus(event.target.value) }))}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {Object.values(JOB_PLAN_STATUS).map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-semibold text-slate-700 md:col-span-2">
                  Plan Name
                  <input
                    value={planForm.title}
                    onChange={(event) => setPlanForm((prev) => ({ ...prev, title: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Repair existing pump"
                  />
                </label>

                <label className="block text-sm font-semibold text-slate-700">
                  Calculated Customer Price
                  <div className="mt-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-900">
                    {moneyFromCents(currentPlanInvoicePriceCents)}
                  </div>
                </label>

                <label className="block text-sm font-semibold text-slate-700">
                  Planned Internal Cost
                  <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900">
                    {moneyFromCents(currentPlanInvoiceInternalCostCents)}
                  </div>
                </label>

                <label className="block text-sm font-semibold text-slate-700 md:col-span-2">
                  Customer-Facing Description
                  <textarea
                    value={planForm.description}
                    onChange={(event) => setPlanForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="mt-1 min-h-[120px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Describe what this plan includes."
                  />
                </label>
              </div>

              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-6">
                <StatCard title="Tasks" value={String(taskList.length)} subtitle="Current plan" />
                <StatCard title="Stops" value={String(plannedServiceStops.length)} subtitle="Current plan" />
                <StatCard title="Service Lines" value={String(laborLineItems.length)} subtitle="Current plan" />
                <StatCard title="Products" value={String(shoppingList.length)} subtitle="Current plan" />
                <StatCard title="Services & Products" value={String(currentPlanInvoiceLineItems.length)} subtitle="Generated estimate" />
                <StatCard
                  title="Profit"
                  value={moneyFromCents(currentPlanInvoiceProfitCents)}
                  subtitle="Calculated"
                  tone={currentPlanInvoiceProfitCents < 0 ? "red" : "green"}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closePlanModal}
                disabled={savingPlan}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePlanOption}
                disabled={savingPlan}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {savingPlan ? "Saving..." : "Save Plan"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showBillingLifecycleHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Lifecycle Guidance</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Billing and operation statuses should move together as the job progresses.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBillingLifecycleHelp(false)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex flex-wrap gap-2">
                <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.billingStatus)}`}>
                  Billing: {job.billingStatus || "Draft"}
                </span>
                <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.operationStatus)}`}>
                  Operation: {job.operationStatus || "Estimate Pending"}
                </span>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900">Paired-status rules</p>
                <p className="mt-1 text-sm text-blue-800">
                  Billing Invoiced, Paid, Comped, or Customer Resolved marks operation Finished. Billing Expired or Rejected moves unfinished work back to Estimate Pending. Operation Finished leaves billing In Progress until invoiced, paid, comped, or customer-resolved.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {billingLifecycleSteps.map((step) => {
                  const active = (job.billingStatus || "Draft") === step.status;

                  return (
                    <div
                      key={step.status}
                      className={[
                        "p-4 rounded-xl border",
                        active ? "bg-blue-50 border-blue-200 shadow-sm" : "bg-gray-50 border-gray-200",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-gray-800">{step.title}</p>
                        <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(step.status)}`}>
                          {step.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Operation: {step.operation}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        {step.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {showChangeOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">New Change Order</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Capture a scope, price, services, products, or schedule change for this job.
                </p>
              </div>
              <button
                type="button"
                onClick={closeChangeOrderModal}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={changeOrderForm.title}
                    onChange={(e) => handleChangeOrderFormChange("title", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    placeholder="Add spa heater replacement"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Requested By
                  </label>
                  <select
                    value={changeOrderForm.requestedBy}
                    onChange={(e) => handleChangeOrderFormChange("requestedBy", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="Customer">Customer</option>
                    <option value="Field Technician">Field Technician</option>
                    <option value="Admin">Admin</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Status
                  </label>
                  <select
                    value={changeOrderForm.status}
                    onChange={(e) => handleChangeOrderFormChange("status", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="Requested">Requested</option>
                    <option value="In Review">In Review</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Request Source
                  </label>
                  <select
                    value={changeOrderForm.requestSource}
                    onChange={(e) => handleChangeOrderFormChange("requestSource", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="Customer">Customer</option>
                    <option value="Field">Field</option>
                    <option value="Office">Office</option>
                    <option value="Estimate Review">Estimate Review</option>
                  </select>
                </div>

                <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-700">
                  <input
                    type="checkbox"
                    checked={changeOrderForm.customerApprovalRequired}
                    onChange={(e) => handleChangeOrderFormChange("customerApprovalRequired", e.target.checked)}
                    className="h-4 w-4"
                  />
                  Customer approval required
                </label>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-2">
                  Description
                </label>
                <textarea
                  value={changeOrderForm.description}
                  onChange={(e) => handleChangeOrderFormChange("description", e.target.value)}
                  className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                  placeholder="What changed from the original job scope?"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Price Impact
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={changeOrderForm.priceImpact}
                    onChange={(e) => handleChangeOrderFormChange("priceImpact", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Labor Cost Impact
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={changeOrderForm.laborCostImpact}
                    onChange={(e) => handleChangeOrderFormChange("laborCostImpact", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Product Cost Impact
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={changeOrderForm.materialCostImpact}
                    onChange={(e) => handleChangeOrderFormChange("materialCostImpact", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Reason
                  </label>
                  <textarea
                    value={changeOrderForm.reason}
                    onChange={(e) => handleChangeOrderFormChange("reason", e.target.value)}
                    className="w-full min-h-[90px] p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Schedule Impact
                  </label>
                  <textarea
                    value={changeOrderForm.scheduleImpact}
                    onChange={(e) => handleChangeOrderFormChange("scheduleImpact", e.target.value)}
                    className="w-full min-h-[90px] p-3 border border-gray-300 rounded-lg"
                    placeholder="Adds one visit, delays until parts arrive..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-2">
                  Internal Notes
                </label>
                <textarea
                  value={changeOrderForm.internalNotes}
                  onChange={(e) => handleChangeOrderFormChange("internalNotes", e.target.value)}
                  className="w-full min-h-[90px] p-3 border border-gray-300 rounded-lg"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={closeChangeOrderModal}
                className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveChangeOrder}
                disabled={savingChangeOrder}
                className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-semibold hover:bg-amber-100 transition disabled:opacity-50"
              >
                {savingChangeOrder ? "Creating..." : "Create Change Order"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCreateWorkOfferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Create Work Offer</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Send selected job tasks to a technician or post them to the internal board.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateWorkOfferModal}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Offer Type
                  </label>
                  <select
                    value={workOfferForm.offerType}
                    onChange={(e) => handleWorkOfferFormChange("offerType", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="Direct User">Direct User</option>
                    <option value="Internal Board">Internal Board</option>
                  </select>
                </div>

                {workOfferForm.offerType === "Direct User" ? (
                  <div>
                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                      Technician
                    </label>
                    <select
                      value={workOfferForm.workerId}
                      onChange={(e) => handleWorkOfferFormChange("workerId", e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                    >
                      <option value="">Select Technician</option>
                      {(companyUserList || []).map((user) => {
                        const userId = getCompanyUserId(user);
                        return (
                          <option key={userId || user.id} value={userId}>
                            {getCompanyUserName(user)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                      Board Visibility
                    </label>
                    <select
                      value={workOfferForm.boardVisibility}
                      onChange={(e) => handleWorkOfferFormChange("boardVisibility", e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                    >
                      <option value="Contractors Only">Contractors Only</option>
                      <option value="Employees Only">Employees Only</option>
                      <option value="Employees & Contractors">Employees & Contractors</option>
                      <option value="Admins Only">Admins Only</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={workOfferForm.title}
                    onChange={(e) => handleWorkOfferFormChange("title", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Service Stop Type
                  </label>
                  <select
                    value={workOfferForm.serviceStopTypeId}
                    onChange={(e) => handleWorkOfferFormChange("serviceStopTypeId", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="">No type selected</option>
                    {(companyServiceStopTypes || []).map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name || type.type || "Service Stop"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Pay Source
                  </label>
                  <select
                    value={workOfferForm.paySource}
                    onChange={(e) => handleWorkOfferFormChange("paySource", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="Technician Rate">Technician Rate</option>
                    <option value="Task Contracted Rates">Task Contracted Rates</option>
                    <option value="Offered Amount">Offered Amount</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>

                {workOfferForm.paySource === "Offered Amount" && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-500 mb-2">
                      Offered Amount
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={workOfferForm.offeredAmount}
                      onChange={(e) => handleWorkOfferFormChange("offeredAmount", e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-2">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={workOfferForm.notes}
                  onChange={(e) => handleWorkOfferFormChange("notes", e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-gray-800">Work Scope</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {selectedWorkOfferTasks.length} selected • {formatDurationMinutes(selectedWorkOfferMinutes)} • {moneyFromCents(
                        workOfferForm.paySource === "Offered Amount"
                          ? Math.round(Number(workOfferForm.offeredAmount || 0) * 100)
                          : workOfferForm.paySource === "Unpaid"
                            ? 0
                            : selectedWorkOfferLaborCents
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleWorkOfferFormChange(
                        "selectedTaskIds",
                        workOfferForm.selectedTaskIds.length === availableWorkOfferTasks.length
                          ? []
                          : availableWorkOfferTasks.map((task) => task.id)
                      )
                    }
                    className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-100 transition"
                  >
                    {workOfferForm.selectedTaskIds.length === availableWorkOfferTasks.length ? "Deselect Available" : "Select Available"}
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {!availableWorkOfferTasks.length ? (
                    <p className="text-sm text-gray-600">
                      No available tasks. Tasks already in active offers are locked until those offers are rejected, cancelled, or expired.
                    </p>
                  ) : (
                    availableWorkOfferTasks.map((task) => {
                      const checked = workOfferForm.selectedTaskIds.includes(task.id);
                      return (
                        <label
                          key={task.id}
                          className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:bg-blue-50 transition cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWorkOfferTask(task.id)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <p className="font-bold text-gray-800">{task.name || task.type || "Task"}</p>
                            <p className="text-sm text-gray-600">
                              {task.type || "Task"} • {Number(task.estimatedTime || 0)} min • {moneyFromCents(task.contractedRate)} tech labor
                            </p>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <input
                    type="checkbox"
                    checked={workOfferForm.includeDate}
                    onChange={(e) => handleWorkOfferFormChange("includeDate", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-700">Include proposed date</span>
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <input
                    type="checkbox"
                    checked={workOfferForm.allowsTechnicianSelfScheduling}
                    onChange={(e) => handleWorkOfferFormChange("allowsTechnicianSelfScheduling", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-700">Allow technician self-scheduling</span>
                </label>
              </div>

              {workOfferForm.includeDate && (
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Proposed Start
                  </label>
                  <input
                    type="datetime-local"
                    value={workOfferForm.proposedStartDate}
                    onChange={(e) => handleWorkOfferFormChange("proposedStartDate", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex flex-col sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={closeCreateWorkOfferModal}
                disabled={savingWorkOffer}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-100 transition disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveWorkOffer}
                disabled={savingWorkOffer || !selectedWorkOfferTasks.length}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-60"
              >
                {savingWorkOffer ? "Creating..." : "Create Offer"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCreateContractModal && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Service Agreement Details</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Review and edit the service agreement before sending
                </p>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Receiver Name
                  </label>
                  <h1
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  >
                    {renderCustomerDetailLink(
                      draftContractData.receiverName,
                      { receiverId: draftContractData.receiverId },
                      ""
                    )}
                  </h1>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Status
                  </label>
                  <select
                    value={normalizeSalesAgreementStatus(draftContractData.status)}
                    onChange={(e) => handleDraftContractDataChange("status", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    {Object.values(SalesAgreementStatus).map((status) => (
                      <option key={status} value={status}>
                        {formatStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Rate (USD)
                  </label>
                  <input
                    type="text"
                    value={draftContractData.rate}
                    onChange={(e) => handleDraftContractDataChange("rate", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Last Date To Accept
                  </label>
                  <input
                    type="date"
                    value={draftContractData.lastDateToAccept}
                    onChange={(e) => handleDraftContractDataChange("lastDateToAccept", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-2">
                  Notes
                </label>
                <textarea
                  value={draftContractData.notes}
                  onChange={(e) => handleDraftContractDataChange("notes", e.target.value)}
                  className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
                  Terms
                </h4>

                {!draftContractData.terms?.length ? (
                  <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                    No terms found.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {draftContractData.terms.map((term, index) => (
                      <div
                        key={term?.id || index}
                        className="p-4 rounded-xl bg-gray-50 border border-gray-200"
                      >
                        <p className="font-semibold text-gray-800">
                          {term?.title || `Term ${index + 1}`}
                        </p>
                        <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                          {term?.description || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
                  Services & Products
                </h4>

                {!draftContractData.lineItems?.length ? (
                  <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                    No line items found.
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
                    <table className="min-w-full bg-white">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Type
                          </th>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Qty
                          </th>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {draftContractData.lineItems.map((item, index) => (
                          <tr key={item?.id || index}>
                            <td className="p-4 text-sm text-gray-700">{item?.type || "—"}</td>
                            <td className="p-4 text-sm font-medium text-gray-800">{item?.name || "—"}</td>
                            <td className="p-4 text-sm text-gray-700">{item?.quantity || 1}</td>
                            <td className="p-4 text-sm text-gray-700">
                              {formatCurrency((Number(item?.amount || 0) / 100) || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={closeCreateContractModal}
                className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createDraftServiceAgreement}
                className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-semibold hover:bg-amber-100 transition"
              >
                Confirm & Create Agreement
              </button>
            </div>
          </div>
        </div>
      )}
      {showCommentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-6xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-950">Job Comments</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Review notes, add follow-ups, and resolve comments for this job.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCommentsModal(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-5">
              {renderCommentFilters("flex flex-wrap gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-1.5")}
              <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                {renderCommentComposer(true)}
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Comment Thread</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {filteredComments.length} {filteredComments.length === 1 ? "comment" : "comments"} shown
                      </p>
                    </div>
                  </div>
                  {renderCommentsList(true)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* For Editing the contracts */}
      {showContractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Contract Details</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Review, edit, or delete this contract.
                </p>
              </div>

              <button
                type="button"
                onClick={closeContractModal}
                className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Receiver Name
                  </label>
                  <input
                    type="text"
                    value={contractForm.receiverName}
                    onChange={(e) => handleContractFormChange("receiverName", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Status
                  </label>
                  <select
                    value={contractForm.status}
                    onChange={(e) => handleContractFormChange("status", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                  >
                    {contractStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Rate (USD)
                  </label>
                  <input
                    type="text"
                    value={contractForm.rate}
                    onChange={(e) => handleContractFormChange("rate", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Last Date To Accept
                  </label>
                  <input
                    type="date"
                    value={contractForm.lastDateToAccept}
                    onChange={(e) => handleContractFormChange("lastDateToAccept", e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Job
                  </label>
                  <h1 className="w-full p-3 border border-gray-300 rounded-lg">{job.internalId || "Linked job"}</h1>
                </div>

                <div className="flex items-end">
                  <Link
                    to={`/company/contract/detail/${contractForm.id}`}
                    className="w-full text-center px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100 transition"
                  >
                    View Estimate Detail
                  </Link>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-500 mb-2">
                  Notes
                </label>
                <textarea
                  value={contractForm.notes}
                  onChange={(e) => handleContractFormChange("notes", e.target.value)}
                  className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
                  Terms
                </h4>

                {!contractForm.terms?.length ? (
                  <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                    No terms found.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {contractForm.terms.map((term, index) => (
                      <div
                        key={term?.id || index}
                        className="p-4 rounded-xl bg-gray-50 border border-gray-200"
                      >
                        <p className="font-semibold text-gray-800">
                          {term?.title || `Term ${index + 1}`}
                        </p>
                        <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                          {term?.description || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
                  Services & Products
                </h4>

                {!contractForm.lineItems?.length ? (
                  <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                    No line items found.
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
                    <table className="min-w-full bg-white">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Type
                          </th>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Qty
                          </th>
                          <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {contractForm.lineItems.map((item, index) => (
                          <tr key={item?.id || index}>
                            <td className="p-4 text-sm text-gray-700">{item?.type || "—"}</td>
                            <td className="p-4 text-sm font-medium text-gray-800">{item?.name || "—"}</td>
                            <td className="p-4 text-sm text-gray-700">{item?.quantity || 1}</td>
                            <td className="p-4 text-sm text-gray-700">
                              {formatCurrency((Number(item?.amount || 0) / 100) || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex flex-col sm:flex-row gap-3 sm:justify-between">
              <button
                type="button"
                onClick={deleteContractItem}
                disabled={deletingContract}
                className="px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 font-semibold hover:bg-red-100 transition disabled:opacity-50"
              >
                {deletingContract ? "Deleting..." : "Delete Contract"}
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeContractModal}
                  className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveContractChanges}
                  disabled={savingContract}
                  className="px-4 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition disabled:opacity-50"
                >
                  {savingContract ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobDetailView;
