import React, { useEffect, useMemo, useState, useContext } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
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
import { getCallableAuthPayload } from "../../../utils/callableAuth";
import {
  salesCollectionNames,
  SalesCatalogBillingBehavior,
  SalesCatalogItemType,
  SalesCatalogSourceType,
} from "../../../utils/models/Sales";

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

const JobDetailView = () => {
  const { jobId } = useParams();
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
    dateCreated: null,
  });

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
  const [plannedServiceStops, setPlannedServiceStops] = useState([]);
  const [workOffers, setWorkOffers] = useState([]);
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
  const [purchasedItemBillableFilter, setPurchasedItemBillableFilter] = useState("All");
  const [purchasedItemInvoicedFilter, setPurchasedItemInvoicedFilter] = useState("All");
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
      ["Draft", "Estimate", "Accepted", "In Progress", "Invoiced", "Paid", "Expired"].map((s) => ({
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

  const [selectedBillingStatus, setSelectedBillingStatus] = useState({
    value: "Draft",
    label: "Draft",
  });
  const [selectedOperationStatus, setSelectedOperationStatus] = useState({
    value: "Estimate Pending",
    label: "Estimate Pending",
  });

  // Sections
  const tabs = ["Info", "Tasks", "Materials", "Offers", "Schedule", "Billing", "Actual", "History"];
  const [activeTab, setActiveTab] = useState("Info");

  // Tasks
  const [taskTypeList, setTaskTypeList] = useState([]);
  const [taskList, setTaskList] = useState([]);
  const [taskEquipmentStatusDrafts, setTaskEquipmentStatusDrafts] = useState({});
  const [newTask, setNewTask] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState(null);
  const [taskDescription, setTaskDescription] = useState("");
  const [taskLaborCost, setTaskLaborCost] = useState("");
  const [estimatedTime, setEstimatedTime] = useState("");

  // Shopping list
  const [shoppingList, setShoppingList] = useState([]);
  const [newShoppingList, setNewShoppingList] = useState(false);

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

  const [shoppingFormData, setShoppingFormData] = useState({
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
    linkedTaskId: "",
  });

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
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [followUpDescription, setFollowUpDescription] = useState("");
  const [followUpAssignedTechId, setFollowUpAssignedTechId] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  // Billing / Contracts
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState("");
  const [sendingEstimateEmail, setSendingEstimateEmail] = useState(false);
  const [sendingInvoiceEmail, setSendingInvoiceEmail] = useState(false);
  const [linkedSalesAgreement, setLinkedSalesAgreement] = useState(null);
  const [linkedSalesInvoice, setLinkedSalesInvoice] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(true);
  const [changeOrders, setChangeOrders] = useState([]);
  const [changeOrdersLoading, setChangeOrdersLoading] = useState(true);
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
        status: "Expired",
        operation: "Estimate Pending",
        title: "Expired",
        description: "The estimate or billing window expired; unfinished work returns to estimate pending.",
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
      case "Expired":
        return currentOperationStatus !== "Finished" ? "Estimate Pending" : currentOperationStatus;
      default:
        return currentOperationStatus;
    }
  };
  const [customerPriceInput, setCustomerPriceInput] = useState("");
  const requiresShoppingDbItem = shoppingFormData.subCategory === "Data Base";
  const requiresShoppingManualDetails = !requiresShoppingDbItem;

  const canSaveShoppingItem = useMemo(() => {
    const hasQuantity =
      shoppingFormData.quantity !== "" && !Number.isNaN(Number(shoppingFormData.quantity));
    const hasName = requiresShoppingDbItem
      ? shoppingFormData.dbItemId.trim() !== ""
      : shoppingFormData.name.trim() !== "";

    return hasQuantity && hasName;
  }, [shoppingFormData, requiresShoppingDbItem]);
  const cents = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  };

  const idValue = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return value.id || value.value || value.docId || "";
  };

  const quantityNumber = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  };

  const moneyFromCents = (value) => formatCurrency(cents(value) / 100);

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
      await setDoc(doc(jobHistoryPath(recentlySelectedCompany, jobId), historyId), {
        id: historyId,
        companyId: recentlySelectedCompany,
        jobId,
        jobInternalId: job.internalId || "",
        eventType,
        title,
        description,
        changes: (changes || []).filter(Boolean),
        metadata,
        changeOrderId,
        severity,
        actorUserId: getUserId() || "",
        actorUserName: getAuditUserName(),
        actorCompanyUserId: dataBaseUser?.id || "",
        createdAt: serverTimestamp(),
        createdAtMillis: Date.now(),
      });
    } catch (err) {
      console.warn("[JobDetailView] Failed to record job history", err);
    }
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
          buildHistoryChange("materialCostImpactCents", "Material Cost Impact", "—", moneyFromCents(materialCostImpactCents)),
          buildHistoryChange("scheduleImpact", "Schedule Impact", "—", payload.scheduleImpact || "—"),
        ],
        metadata: {
          requestedBy: payload.requestedBy,
          requestSource: payload.requestSource,
          customerApprovalRequired: payload.customerApprovalRequired,
        },
      });

      toast.success("Change order created");
      setShowChangeOrderModal(false);
      resetChangeOrderForm();
      setActiveTab("History");
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
    const explicitAmount = Math.max(
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

  const getStatusClass = (status) => {
    switch (status) {
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
        return "bg-green-100 text-green-800";
      case "Invoiced":
        return "bg-blue-100 text-blue-800";
      case "Rejected":
        return "bg-gray-200 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const statusTone = (status) => {
    switch (status) {
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
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "Invoiced":
        return "border-blue-200 bg-blue-50 text-blue-700";
      case "Rejected":
        return "border-rose-200 bg-rose-50 text-rose-700";
      default:
        return "border-slate-200 bg-slate-50 text-slate-700";
    }
  };

  const StatusBadge = ({ status }) => (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}>
      {status || "Not set"}
    </span>
  );

  const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 12,
    colors: {
      ...theme.colors,
      primary25: "#EFF6FF",
      primary: "#2563EB",
      neutral0: "#FFFFFF",
      neutral20: "#D1D5DB",
      neutral30: "#9CA3AF",
    },
  });

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
      "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
    }),
    menu: (base) => ({ ...base, borderRadius: 12, overflow: "hidden" }),
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

  const buildSuggestedContractSnapshot = () => {
    const plannedStopItems = (plannedServiceStops || []).map((stop) => ({
      id: stop.id,
      catalogItemId: stop.salesCatalogItemId || "",
      sourceType: SalesCatalogSourceType.serviceStopType,
      sourceId: stop.serviceStopTypeId || stop.typeId || stop.id,
      salesItemType: SalesCatalogItemType.service,
      billingBehavior: SalesCatalogBillingBehavior.oneTime,
      type: "Planned Stop",
      name: stop.name || stop.serviceStopTypeName || "Planned Service Stop",
      description: stop.description || stop.plannedLaborNotes || "",
      quantity: 1,
      unitAmountCents: getPlannedStopCostCents(stop),
      totalAmountCents: getPlannedStopCostCents(stop),
      amount: getPlannedStopCostCents(stop),
      taxable: false,
      stripeProductId: stop.stripeProductId || "",
      stripePriceId: stop.stripePriceId || "",
      displayAmount: moneyFromCents(getPlannedStopCostCents(stop)),
    }));

    const laborItems = (taskList || []).map((task) => ({
      id: task.id,
      catalogItemId: task.salesCatalogItemId || "",
      sourceType: SalesCatalogSourceType.task,
      sourceId: task.id,
      salesItemType: SalesCatalogItemType.labor,
      billingBehavior: SalesCatalogBillingBehavior.oneTime,
      type: "Task",
      name: task.name || task.type || "Task",
      description: task.type || "",
      quantity: 1,
      unitAmountCents: cents(task.contractedRate),
      totalAmountCents: cents(task.contractedRate),
      amount: cents(task.contractedRate),
      taxable: false,
      stripeProductId: task.stripeProductId || "",
      stripePriceId: task.stripePriceId || "",
      displayAmount: moneyFromCents(task.contractedRate),
    }));

    const materialItems = (shoppingList || []).map((item) => {
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
        name: item.name || "Material",
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

    return [...plannedStopItems, ...laborItems, ...materialItems];
  };

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
    shoppingList,
    companyUserList,
    paySettings,
    companyServiceStopTypes,
    companyWorkTypes,
    workTypeMappings,
    technicianRates,
  ]);

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

  const plannedTotalLaborCents = useMemo(() => {
    return plannedStopLaborCents + plannedTaskLaborCents;
  }, [plannedStopLaborCents, plannedTaskLaborCents]);

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
    invoiceId: invoiceId || "",
    invoiceRef: invoiceId || "",
    invoiceType,
    invoicedAt: new Date(),
    jobInvoicedAt: new Date(),
  });

  const markPurchasedItemsInvoicedForJob = async ({ invoiceId = "", invoiceType = "job" } = {}) => {
    if (!recentlySelectedCompany || !jobId) return 0;

    const itemsById = new Map((purchasedItems || []).map((item) => [item.id, item]));

    const addSnapDocs = (snap) => {
      snap.docs.forEach((itemDoc) => {
        const data = itemDoc.data();
        itemsById.set(data.id || itemDoc.id, { id: data.id || itemDoc.id, ...data });
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
    await Promise.all(
      items.map((item) =>
        updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", item.id), updates)
      )
    );

    const stateUpdates = purchasedItemInvoiceState({ invoiceId, invoiceType });
    setPurchasedItems((prev) =>
      (prev || []).map((item) => (itemsById.has(item.id) ? { ...item, ...stateUpdates } : item))
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
    return cents(job.rate) - plannedTotalLaborCents - plannedMaterialCostCents;
  }, [job.rate, plannedTotalLaborCents, plannedMaterialCostCents]);

  const actualProfitCents = useMemo(() => {
    return cents(job.rate) - actualLaborTotalCents - actualPurchasedMaterialCostCents;
  }, [job.rate, actualLaborTotalCents, actualPurchasedMaterialCostCents]);

  const contractTotalCents = useMemo(() => {
    if (selectedContract?.rate !== undefined && selectedContract?.rate !== null) {
      return Number(selectedContract.rate || 0);
    }
    return Number(job.rate || 0);
  }, [selectedContract, job.rate]);

  const getCustomerEmail = () => (
    customer.email ||
    customer.billingEmail ||
    customer.mainContact?.email ||
    customer.contact?.email ||
    selectedContract?.receiverEmail ||
    ""
  );

  const getCustomerDisplayName = () => (
    job.customerName ||
    customer.customerName ||
    customer.name ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    selectedContract?.receiverName ||
    "Customer"
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

  const getSalesLineItemsFromSnapshot = () => {
    const snapshotItems = contractSnapshotItems?.length
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

  const findLinkedSalesAgreement = async () => {
    if (!recentlySelectedCompany || !jobId) return null;

    if (linkedSalesAgreement?.id) {
      const linkedSnap = await getDoc(doc(db, salesCollectionNames.agreements, linkedSalesAgreement.id));
      if (linkedSnap.exists()) return { id: linkedSnap.id, ...linkedSnap.data() };
    }

    const agreementId =
      selectedContract?.salesAgreementId ||
      selectedContract?.agreementId ||
      job.salesAgreementId ||
      job.salesEstimateAgreementId ||
      "";

    if (agreementId) {
      const agreementSnap = await getDoc(doc(db, salesCollectionNames.agreements, agreementId));
      if (agreementSnap.exists()) return { id: agreementSnap.id, ...agreementSnap.data() };
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
      : { id: agreementsSnap.docs[0].id, ...agreementsSnap.docs[0].data() };
  };

  const ensureJobSalesAgreement = async () => {
    const email = getCustomerEmail();
    if (!email) throw new Error("Customer email is required before sending an estimate.");

    const lineItems = getSalesLineItemsFromSnapshot();
    if (!lineItems.length) throw new Error("Add at least one line item or job price before sending.");

    const existingAgreement = await findLinkedSalesAgreement();
    const id = existingAgreement?.id || `sa_${uuidv4()}`;
    const subtotalAmountCents = lineItems.reduce((total, item) => total + cents(item.totalAmountCents), 0);
    const totalAmountCents = cents(selectedContract?.rate || 0) || subtotalAmountCents || cents(job.rate);
    const selectedTerms = normalizeTerms(selectedContract?.terms || []);
    const termsList = selectedTerms
      .map((term) => term.description || term.title)
      .filter(Boolean);
    const fallbackTerms =
      selectedContract?.notes ||
      selectedContract?.termsText ||
      job.description ||
      "Customer approval is required before work begins.";

    const payload = {
      ...(existingAgreement || {}),
      id,
      companyId: recentlySelectedCompany,
      companyName: authCtx?.recentlySelectedCompanyName || selectedContract?.senderName || "",
      customerId: job.customerId || customer.id || "",
      customerUserId: customer.customerUserId || customer.userId || null,
      customerName: getCustomerDisplayName(),
      email,
      serviceLocationIds: [job.serviceLocationId || serviceLocation.id || ""].filter(Boolean),
      serviceLocationSnapshots: [getServiceLocationSnapshot()].filter((location) => location.id || location.streetAddress),
      sourceType: "oneOffJob",
      sourceId: jobId,
      title: selectedContract?.title || `${job.internalId || "Job"} Estimate`,
      description: selectedContract?.notes || job.description || "",
      terms: selectedTerms.length ? "" : fallbackTerms,
      termsTemplateId: selectedContract?.termsTemplateId || "",
      termsTemplateName: selectedContract?.termsTemplateName || "Job Estimate Terms",
      termsTemplateDescription: selectedContract?.termsTemplateDescription || "",
      termsList: termsList.length ? termsList : [fallbackTerms],
      lineItems,
      status: existingAgreement?.status || "draft",
      billingProfileId: existingAgreement?.billingProfileId || "",
      billingSubscriptionId: existingAgreement?.billingSubscriptionId || "",
      rateAmountCents: totalAmountCents,
      subtotalAmountCents,
      taxAmountCents: existingAgreement?.taxAmountCents || 0,
      totalAmountCents,
      rateType: "oneTime",
      serviceCadence: "oneTime",
      serviceCadenceCount: 1,
      paymentTerms: existingAgreement?.paymentTerms || "dueOnReceipt",
      invoiceDeliveryMethod: "email",
      includedServices: [],
      excludedServices: [],
      startDate: existingAgreement?.startDate || null,
      endDate: existingAgreement?.endDate || null,
      expiresAt: selectedContract?.lastDateToAccept || existingAgreement?.expiresAt || null,
      atWill: false,
      createdByUserId: existingAgreement?.createdByUserId || getUserId() || dataBaseUser?.id || "",
      emailDelivery: existingAgreement?.emailDelivery || {},
      updatedAt: serverTimestamp(),
      createdAt: existingAgreement?.createdAt || serverTimestamp(),
      jobId,
      contractId: selectedContract?.id || "",
    };

    await setDoc(doc(db, salesCollectionNames.agreements, id), payload, { merge: true });
    await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
      salesAgreementId: id,
      salesEstimateAgreementId: id,
    });

    if (selectedContract?.id) {
      await updateDoc(doc(db, "contracts", selectedContract.id), {
        salesAgreementId: id,
        updatedAt: serverTimestamp(),
      });
    }

    setLinkedSalesAgreement(payload);
    return payload;
  };

  const findLinkedSalesInvoice = async () => {
    if (!recentlySelectedCompany || !jobId) return null;

    if (linkedSalesInvoice?.id) {
      const linkedSnap = await getDoc(doc(db, salesCollectionNames.invoices, linkedSalesInvoice.id));
      if (linkedSnap.exists()) return { id: linkedSnap.id, ...linkedSnap.data() };
    }

    const invoiceId =
      selectedContract?.salesInvoiceId ||
      selectedContract?.invoiceId ||
      job.salesInvoiceId ||
      "";

    if (invoiceId) {
      const invoiceSnap = await getDoc(doc(db, salesCollectionNames.invoices, invoiceId));
      if (invoiceSnap.exists()) return { id: invoiceSnap.id, ...invoiceSnap.data() };
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
      : { id: invoicesSnap.docs[0].id, ...invoicesSnap.docs[0].data() };
  };

  const ensureJobSalesInvoice = async (agreementId = "") => {
    const email = getCustomerEmail();
    if (!email) throw new Error("Customer email is required before sending an invoice.");

    const lineItems = getSalesLineItemsFromSnapshot();
    if (!lineItems.length) throw new Error("Add at least one line item or job price before invoicing.");

    const existingInvoice = await findLinkedSalesInvoice();
    const id = existingInvoice?.id || `si_${uuidv4()}`;
    const subtotalAmountCents = lineItems.reduce((total, item) => total + cents(item.totalAmountCents), 0);
    const totalAmountCents = cents(selectedContract?.rate || 0) || subtotalAmountCents || cents(job.rate);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const payload = {
      ...(existingInvoice || {}),
      id,
      companyId: recentlySelectedCompany,
      companyName: authCtx?.recentlySelectedCompanyName || selectedContract?.senderName || "",
      customerId: job.customerId || customer.id || "",
      customerUserId: customer.customerUserId || customer.userId || null,
      customerName: getCustomerDisplayName(),
      email,
      agreementId: agreementId || existingInvoice?.agreementId || linkedSalesAgreement?.id || "",
      jobId,
      contractId: selectedContract?.id || "",
      billingSubscriptionId: existingInvoice?.billingSubscriptionId || "",
      stripeConnectedAccountId: authCtx?.stripeConnectedAccountId || "",
      stripeInvoiceId: existingInvoice?.stripeInvoiceId || "",
      stripePaymentIntentId: existingInvoice?.stripePaymentIntentId || "",
      stripeHostedInvoiceUrl: existingInvoice?.stripeHostedInvoiceUrl || "",
      stripeInvoicePdfUrl: existingInvoice?.stripeInvoicePdfUrl || "",
      invoiceNumber: existingInvoice?.invoiceNumber || `${job.internalId || "JOB"}-${String(Date.now()).slice(-6)}`,
      type: "oneTime",
      status: existingInvoice?.status === "paid" ? "paid" : "open",
      deliveryMethod: "email",
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
      memo: selectedContract?.notes || job.description || "",
      lineItems,
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
    const rate = cents(job.rate);
    if (rate <= 0) return "0.0";

    return ((actualProfitCents / rate) * 100).toFixed(1);
  }, [job.rate, actualProfitCents]);

  const billingReadyCents = useMemo(() => {
    return cents(job.rate);
  }, [job.rate]);

  const estimateProfitAgainstBillablePlanCents = useMemo(() => {
    return cents(job.rate) - plannedTotalLaborCents - plannedMaterialCostCents;
  }, [job.rate, plannedTotalLaborCents, plannedMaterialCostCents]);

  const estimateDifferenceCents = useMemo(() => {
    return contractTotalCents - cents(job.rate);
  }, [contractTotalCents, job.rate]);

  const markJobAsFinished = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;

      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      const previousBillingStatus = job.billingStatus || "—";
      const nextBillingStatus =
        job.billingStatus === "Draft" || !job.billingStatus ? "In Progress" : job.billingStatus;
      const finishedTasks = [];

      for (const task of taskList || []) {
        if (!task?.id) continue;

        const installDetails = promptForReplacementInstallDetails(task);
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

      toast.success("Job marked as finished");
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark job as finished");
    }
  };


  const openCreateContractModal = () => {
    setShowCreateContractModal(true);
    //init contract details
    const id = "con_" + uuidv4();

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
        value: cents(job.rate),
      },
      {
        id: uuidv4(),
        title: "Planned Labor",
        description: "Internal planned labor cost",
        value: plannedTotalLaborCents,
      },
      {
        id: uuidv4(),
        title: "Planned Materials",
        description: "Internal planned material cost",
        value: plannedMaterialCostCents,
      },
      {
        id: uuidv4(),
        title: "Planned Billable Materials",
        description: "Planned customer-facing material value included for estimate review",
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
      senderId: recentlySelectedCompany, // important so this matches your contracts query
      senderUserId: getUserId() || "",
      senderAcceptance: true,
      receiverName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "",
      receiverId: customer.id || "",
      receiverAcceptance: false,
      dateSent: null,
      lastDateToAccept: Timestamp.fromDate(
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      ),
      dateAccepted: null,
      status: "Draft",
      terms: defaultTerms,
      notes: job.description || "",
      rate: Number(job.rate || 0),
      lineItems,
      jobId: jobId || "", // requested
      jobInternalId: job.internalId || "",
      customerName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: (contracts?.length || 0) + 1,
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
        workOfferForm.paySource === "Offered Amount" ? offeredAmountCents : selectedWorkOfferLaborCents;
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

      await updateDoc(contractRef, {
        receiverName: contractForm.receiverName || "",
        notes: contractForm.notes || "",
        rate: Math.round(Number(contractForm.rate || 0) * 100),
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
          buildHistoryChange("rate", "Contract Total", moneyFromCents(selectedContract?.rate || 0), moneyFromCents(Math.round(Number(contractForm.rate || 0) * 100))),
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

      const ok = window.confirm("Delete this contract? This cannot be undone.");
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

        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        const jobSnap = await getDoc(jobRef);
        if (!jobSnap.exists()) throw new Error("Job not found");

        const j = jobSnap.data();
        const dateCreated = j.dateCreated?.toDate?.() ?? null;

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
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            phoneNumber: c.phoneNumber,
            email: c.email,
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

        const taskTypeQuery = query(collection(db, "universal", "settings", "taskTypes"));
        const taskTypeSnap = await getDocs(taskTypeQuery);
        const types = taskTypeSnap.docs.map((d) => {
          const t = d.data();
          return { value: t.name, label: t.name, id: t.id };
        });
        setTaskTypeList(types);

        const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
        const tasksSnap = await getDocs(tasksRef);
        const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setTaskList(tasks);

        const itemsRef = query(
          collection(db, "companies", recentlySelectedCompany, "shoppingList"),
          where("jobId", "==", jobId)
        );
        const itemsSnap = await getDocs(itemsRef);
        const items = itemsSnap.docs.map((d) => d.data());
        setShoppingList(items);

        const companyUsersQ = query(
          collection(db, "companies", recentlySelectedCompany, "companyUsers"),
          orderBy("firstName")
        );
        const companyUsersSnap = await getDocs(companyUsersQ);
        const companyUsers = companyUsersSnap.docs.map((docSnap) => {
          const data = docSnap.data();
          const name =
            data.displayName ||
            `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
            data.userName ||
            data.name ||
            "Unnamed User";

          return {
            ...data,
            id: data.id || docSnap.id,
            userId: data.userId || data.id || docSnap.id,
            userName: data.userName || name,
            name,
            label: name,
            value: data.id || docSnap.id,
          };
        });
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
        const dbItems = dbItemsSnap.docs.map((docSnap) => {
          const data = docSnap.data();
          const name = data.name || "Unnamed Item";

          return {
            id: data.id || docSnap.id,
            name,
            description: data.description || "",
            genericItemId: data.genericItemId || "",
            dbItemId: data.id || docSnap.id,
            rate: Number(data.rate || 0),
            sellPrice: Number(data.sellPrice || 0),
            cost: Number(data.cost || data.rate || 0),
            label: name,
            value: data.id || docSnap.id,
          };
        });
        setShoppingDbItemList(dbItems);

        await loadJobWorkflowData({
          companyId: recentlySelectedCompany,
          currentJobId: jobId,
          currentTaskList: tasks,
          currentShoppingList: items,
          currentServiceStops: stops,
        });

      } catch (e) {
        console.error(e);
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


  const saveDescription = async () => {
    if (!requirePermission("24", "update jobs")) return;

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

  const addComment = async () => {
    try {
      const userId = getUserId();

      if (!userId) return toast.error("Missing userId (not signed in?)");
      if (!newComment.trim()) return toast.error("Write a comment first");
      if (!recentlySelectedCompany || !jobId) return;

      setAddingComment(true);

      const id = "comp_wo_com_" + uuidv4();
      const commentRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments", id);

      await setDoc(commentRef, {
        id,
        userId,
        userName: `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() || getUserName(),
        date: serverTimestamp(),
        comment: newComment.trim(),
        resolved: false,
      });
      await recordJobHistory({
        eventType: "Comment",
        title: "Comment added",
        description: newComment.trim(),
        metadata: { commentId: id },
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

  const createLinkedFollowUp = async () => {
    try {
      const creatorId = getUserId();

      if (!creatorId) return toast.error("Missing userId (not signed in?)");
      if (!followUpTitle.trim()) return toast.error("Add a follow-up title");
      if (!followUpAssignedTechId) return toast.error("Assign the follow-up");
      if (!recentlySelectedCompany || !jobId) return;

      setSavingFollowUp(true);

      const assignee = (companyUserList || []).find((user) => {
        const userId = user.userId || user.id || user.uid || "";
        return userId === followUpAssignedTechId || user.id === followUpAssignedTechId;
      });
      const id = "comp_todo_" + uuidv4();
      const payload = {
        id,
        title: followUpTitle.trim(),
        status: "To Do",
        description: followUpDescription.trim(),
        dateCreated: serverTimestamp(),
        dateFinished: null,
        linkedCustomerId: job.customerId || customer.id || "",
        linkedJobId: jobId,
        assignedTechId: followUpAssignedTechId,
        creatorId,
        linkedJobInternalId: job.internalId || "",
        linkedCustomerName: job.customerName || [customer.firstName, customer.lastName].filter(Boolean).join(" "),
        assignedTechName: assignee?.userName || assignee?.name || assignee?.fullName || "",
        source: "jobDetail",
      };

      await setDoc(doc(db, "companies", recentlySelectedCompany, "toDos", id), payload);
      await recordJobHistory({
        eventType: "Follow Up",
        title: `Follow-up created: ${payload.title}`,
        description: payload.description,
        metadata: {
          toDoId: id,
          assignedTechId: followUpAssignedTechId,
          assignedTechName: payload.assignedTechName,
        },
      });

      setFollowUpTitle("");
      setFollowUpDescription("");
      setFollowUpAssignedTechId("");
      toast.success("Follow-up created");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create follow-up");
    } finally {
      setSavingFollowUp(false);
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
    if (!requirePermission("24", "update jobs")) return;

    try {
      setEdit(true);

      const userQuery = query(collection(db, "companies", recentlySelectedCompany, "companyUsers"));
      const userSnap = await getDocs(userQuery);
      const admins = userSnap.docs.map((d) => {
        const u = d.data();
        return {
          value: u.id,
          label: `${u.userName}${u.roleName ? ` — ${u.roleName}` : ""}`,
          id: u.id,
          name: u.userName,
        };
      });
      setAdminList(admins);

      const current = admins.find((a) => a.id === job.adminId) || null;
      setSelectedAdmin(current);
      setCustomerPriceInput(((Number(job.rate || 0) / 100) || 0).toFixed(2));
    } catch (err) {
      console.error(err);
      toast.error("Failed to enter edit mode");
    }
  };

  const cancelEditJob = () => {
    setEdit(false);
    setSelectedAdmin(null);
    setCustomerPriceInput(((Number(job.rate || 0) / 100) || 0).toFixed(2));
  };

  const saveEditChanges = async (e) => {
    e.preventDefault();
    if (!requirePermission("24", "update jobs")) return;

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

      if (Object.keys(updates).length) {
        await updateDoc(jobRef, updates);
        await recordJobHistory({
          title: "Job details updated",
          changes: [
            buildHistoryChange("adminName", "Admin", job.adminName, updates.adminName ?? job.adminName),
            buildHistoryChange("rate", "Customer Price", moneyFromCents(job.rate), moneyFromCents(updates.rate ?? job.rate)),
          ],
        });
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
          rate: Number(j.rate || 0),
        }));

        setCustomerPriceInput(((Number(j.rate || 0) / 100) || 0).toFixed(2));
      }

      setEdit(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save changes");
    }
  };

  const deleteJob = async (e) => {
    e.preventDefault();
    if (!requirePermission("26", "delete jobs")) return;

    try {
      const ok = window.confirm("Delete this job? This cannot be undone.");
      if (!ok) return;

      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId));
      toast.success("Deleted");
      navigate("/company/jobs");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete job");
    }
  };

  const handleSelectedOperationStatus = async (opt) => {
    if (!requirePermission("24", "update jobs")) return;

    try {
      setSelectedOperationStatus(opt);
      const nextBillingStatus = suggestBillingForOperation(
        opt.value,
        job.billingStatus || "Draft"
      );
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      await updateDoc(jobRef, {
        operationStatus: opt.value,
        billingStatus: nextBillingStatus,
      });
      setJob((prev) => ({
        ...prev,
        operationStatus: opt.value,
        billingStatus: nextBillingStatus,
      }));
      setSelectedBillingStatus({ value: nextBillingStatus, label: nextBillingStatus });
      await recordJobHistory({
        eventType: "Status Change",
        title: "Operation status updated",
        changes: [
          buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", opt.value),
          buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", nextBillingStatus),
        ],
      });
      toast.success("Updated operation status");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update operation status");
    }
  };

  const handleSelectedBillingStatus = async (opt) => {
    if (!requirePermission("24", "update jobs")) return;

    try {
      setSelectedBillingStatus(opt);
      const nextOperationStatus = suggestOperationForBilling(
        opt.value,
        job.operationStatus || "Estimate Pending"
      );
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      await updateDoc(jobRef, {
        billingStatus: opt.value,
        operationStatus: nextOperationStatus,
      });
      setJob((prev) => ({
        ...prev,
        billingStatus: opt.value,
        operationStatus: nextOperationStatus,
      }));
      setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
      await recordJobHistory({
        eventType: "Status Change",
        title: "Billing status updated",
        changes: [
          buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", opt.value),
          buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", nextOperationStatus),
        ],
      });
      toast.success("Updated billing status");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update billing status");
    }
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
  const showNewTaskItem = () => setNewTask(true);

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
    setTaskLaborCost("");
    setEstimatedTime("");
    setNewTask(false);
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    try {
      if (!selectedTaskType?.value) return toast.error("Pick a task type");
      if (!taskDescription) return toast.error("Add a description");
      if (!taskLaborCost) return toast.error("Add labor cost");
      if (!estimatedTime) return toast.error("Add estimated time (minutes)");

      const id = "comp_wo_tas_" + uuidv4();
      const costCents = Math.round(parseFloat(taskLaborCost) * 100);
      const estMin = parseFloat(estimatedTime);

      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id), {
        id,
        name: taskDescription,
        type: selectedTaskType.value,
        contractedRate: costCents,
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

        equipmentId: job.equipmentId || "",
        serviceLocationId: job.serviceLocationId || serviceLocation.id || "",
        bodyOfWaterId: job.bodyOfWaterId || "",
        dataBaseItemId: "",
        shoppingListItemId: "",
        shoppingListItemIds: [],
      });
      await recordJobHistory({
        eventType: "Task",
        title: `Task added: ${taskDescription}`,
        changes: [
          buildHistoryChange("type", "Task Type", "—", selectedTaskType.value),
          buildHistoryChange("contractedRate", "Labor Cost", "—", moneyFromCents(costCents)),
          buildHistoryChange("estimatedTime", "Estimated Time", "—", `${estMin} minutes`),
        ],
        metadata: { taskId: id },
      });

      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTaskList(tasks);

      await loadJobWorkflowData({
        companyId: recentlySelectedCompany,
        currentJobId: jobId,
        currentTaskList: tasks,
        currentShoppingList: shoppingList,
      });

      toast.success("Added task");
      clearNewTask({ preventDefault: () => { } });
    } catch (err) {
      console.error(err);
      toast.error("Failed to add task");
    }
  };
  const deletePlannedServiceStop = async (plannedStopId) => {
    try {
      if (!recentlySelectedCompany || !jobId || !plannedStopId) return;

      const ok = window.confirm(
        "Delete this planned stop? This only removes the planned visit. It does not delete scheduled service stops or tasks."
      );

      if (!ok) return;

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
      await recordJobHistory({
        eventType: "Task",
        title: `Task deleted: ${deletedTask?.name || deletedTask?.type || id}`,
        description: deletedTask?.name || "",
        metadata: { taskId: id, deletedShoppingListItemIds: linkedShoppingItemIds },
        severity: "danger",
      });

      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  const showNewShoppingListItem = () => setNewShoppingList(true);

  const handleShoppingFormChange = (field, value) => {
    setShoppingFormData((prev) => ({
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
    } else {
      nextData.dbItemId = "";
      nextData.genericItemId = "";
      setSelectedShoppingDbItem(null);
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
    setShoppingFormData((prev) => ({
      ...prev,
      dbItemId: option?.id || "",
      genericItemId: option?.genericItemId || "",
      name: option?.name || "",
      description: option?.description || "",
    }));
  };

  const clearNewShoppingListItem = (e) => {
    e.preventDefault();
    setNewShoppingList(false);
    setSelectedPurchaser(null);
    setSelectedShoppingDbItem(null);
    setShoppingFormData({
      category: "Job",
      subCategory: "Custom",
      status: "Need to Purchase",
      purchaserId: "",
      purchaserName: "",
      genericItemId: "",
      name: "",
      description: "",
      datePurchased: "",
      quantity: "",
      jobId: jobId || "",
      jobName: job.internalId || "",
      dbItemId: "",
      linkedTaskId: "",
    });
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

      let plannedUnitCostCents = 0;
      let plannedUnitPriceCents = 0;

      if (requiresShoppingDbItem) {
        plannedUnitCostCents = Number(selectedShoppingDbItem?.rate || selectedShoppingDbItem?.cost || 0);
        plannedUnitPriceCents = Number(
          selectedShoppingDbItem?.sellPrice ||
          selectedShoppingDbItem?.rate ||
          selectedShoppingDbItem?.cost ||
          0
        );
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
      const linkedTask =
        (taskList || []).find((task) => task.id === shoppingFormData.linkedTaskId) || null;
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
        status: shoppingFormData.status,
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
        purchasedItem: "",
        invoiced: false,

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
        eventType: "Planned Material",
        title: `Planned material added: ${materialName || "Unnamed Material"}`,
        description: materialDescription || "",
        changes: [
          buildHistoryChange("quantity", "Quantity", "—", qty),
          buildHistoryChange("status", "Status", "—", shoppingFormData.status),
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
      const items = itemsSnap.docs.map((d) => d.data());
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
        eventType: "Planned Material",
        title: `Planned material deleted: ${deletedItem ? getMaterialName(deletedItem) : id}`,
        description: deletedItem?.description || "",
        metadata: { shoppingListItemId: id, linkedTaskId },
        severity: "danger",
      });

      const itemsRef = query(
        collection(db, "companies", recentlySelectedCompany, "shoppingList"),
        where("jobId", "==", jobId)
      );
      const itemsSnap = await getDocs(itemsRef);
      const items = itemsSnap.docs.map((d) => d.data());
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
  const getMaterialStatusClass = (status) => {
    switch (status) {
      case "Installed":
      case "installed":
        return "bg-green-100 text-green-800 border-green-200";
      case "Purchased":
      case "purchased":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "Need to Purchase":
      case "Need To Purchase":
      case "needToPurchase":
        return "bg-amber-100 text-amber-800 border-amber-200";
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
    return item.name || item.dbItemName || item.itemName || dbItem?.name || "Unnamed Material";
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

  const isPurchasedItemBillable = (item) => {
    if (item.jobBillable !== undefined && item.jobBillable !== null) return Boolean(item.jobBillable);
    if (item.billable !== undefined && item.billable !== null) return Boolean(item.billable);

    const billingType = String(item.billingType || item.billableType || "").toLowerCase();
    if (billingType.includes("non") || billingType.includes("not") || billingType.includes("unbill")) return false;
    return billingType.includes("billable");
  };

  const isPurchasedItemInvoiced = (item) => {
    if (item.jobInvoiced !== undefined && item.jobInvoiced !== null) return Boolean(item.jobInvoiced);
    if (item.invoiced !== undefined && item.invoiced !== null) return Boolean(item.invoiced);

    const invoiceStatus = String(item.invoiceStatus || item.billingStatus || "").toLowerCase();
    return invoiceStatus === "invoiced" || invoiceStatus === "paid" || Boolean(item.invoiceId || item.invoiceDocId);
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
    return (availablePurchasedItems || []).filter((item) => {
      const categoryMatches =
        purchasedItemCategoryFilter === "All" ||
        getPurchasedItemCategory(item) === purchasedItemCategoryFilter;
      const billableMatches =
        purchasedItemBillableFilter === "All" ||
        (purchasedItemBillableFilter === "Billable" && isPurchasedItemBillable(item)) ||
        (purchasedItemBillableFilter === "Not Billable" && !isPurchasedItemBillable(item));
      const invoicedMatches =
        purchasedItemInvoicedFilter === "All" ||
        (purchasedItemInvoicedFilter === "Invoiced" && isPurchasedItemInvoiced(item)) ||
        (purchasedItemInvoicedFilter === "Not Invoiced" && !isPurchasedItemInvoiced(item));

      return categoryMatches && billableMatches && invoicedMatches;
    });
  }, [
    availablePurchasedItems,
    purchasedItemCategoryFilter,
    purchasedItemBillableFilter,
    purchasedItemInvoicedFilter,
  ]);

  const renderPlannedMaterialCard = (item) => {
    const totalCostCents = getShoppingPlannedTotalCostCents(item);
    const totalPriceCents = getShoppingPlannedTotalPriceCents(item);
    const linkedTaskId =
      item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.sourceTaskId || "";
    const linkedTask = linkedTaskId
      ? (taskList || []).find((task) => task.id === linkedTaskId)
      : null;

    return (
      <div
        key={item.id}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Planned Material
            </p>

            <button
              type="button"
              onClick={() => navigate(`/company/shopping-list/detail/${item.id}`)}
              className="mt-1 text-left text-base font-bold text-gray-800 hover:text-blue-700 transition"
            >
              {getMaterialName(item)}
            </button>

            <p className="mt-1 text-sm text-gray-600">
              {item.subCategory || "Material"} • Qty: {getMaterialQuantity(item)}
            </p>
          </div>

          <span
            className={`px-3 py-1 text-xs font-bold rounded-full border ${getMaterialStatusClass(
              item.status
            )}`}
          >
            {item.status || "Need to Purchase"}
          </span>
        </div>

        {item.description && (
          <p className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">
            {item.description}
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Unit Cost
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(item.plannedUnitCostCents ?? item.cost)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Cost
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(totalCostCents)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Unit Billable
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(item.plannedUnitPriceCents ?? item.price)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Billable
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(totalPriceCents)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {item.dbItemId && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Database Item
            </span>
          )}

          {item.invoiced && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
              Invoiced
            </span>
          )}

          {item.purchaserName && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
              Purchaser: {item.purchaserName}
            </span>
          )}

          {(linkedTask || item.linkedTaskName) && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              Task: {linkedTask?.name || item.linkedTaskName}
            </span>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={(e) => deleteShoppingListItem(e, item.id)}
            className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition"
          >
            Delete Material
          </button>
        </div>
      </div>
    );
  };

  const renderPurchasedMaterialCard = (item) => {
    const totalCostCents = getPurchasedItemTotalCents(item);
    const billableTotalCents = getPurchasedItemBillableTotalCents(item);

    return (
      <div
        key={item.id}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Purchased Material
            </p>

            <p className="mt-1 text-base font-bold text-gray-800">
              {item.name || "Purchased Item"}
            </p>

            <p className="mt-1 text-sm text-gray-600">
              {item.venderName || "Vendor"} • Qty: {item.quantityString || item.quantity || "—"}
            </p>
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
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Unit Cost
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(item.price)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Cost
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(totalCostCents)}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Job Billing Rate
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {item.jobBillingRate || item.billingRate ? moneyFromCents(item.jobBillingRate ?? item.billingRate) : "—"}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Job Billable Total
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {moneyFromCents(billableTotalCents)}
            </p>
          </div>
        </div>

        {(item.notes || item.sku || item.invoiceNum) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {item.invoiceNum && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                Invoice: {item.invoiceNum}
              </span>
            )}

            {item.sku && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                SKU: {item.sku}
              </span>
            )}

            {item.notes && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                {item.notes}
              </span>
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
          .map((d) => ({
            ...d.data(),
            id: d.data().id || d.id,
          }))
          .filter((item) => !(item.jobId || item.workOrderId || item.assignedToJob || item.assignmentStatus === "assignedToJob"))
      );
    } catch (error) {
      console.error("Error loading unassigned purchased items:", error);
      toast.error("Failed to load unassigned purchased items.");
    } finally {
      setLoadingAvailablePurchasedItems(false);
    }
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
        selectedItems.map((item) =>
          updateDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", item.id), {
            jobId,
            workOrderId: jobId,
            assignedJobId: jobId,
            assignedToJob: true,
            assignmentStatus: "assignedToJob",
            billingOwner: "job",
            jobBillingStatus: shouldMarkInvoiced ? "invoiced" : "handledByJob",
            jobBillable: Boolean(item.jobBillable ?? item.billable),
            jobBillingRate: cents(item.jobBillingRate ?? item.billingRate ?? item.price),
            ...(shouldMarkInvoiced
              ? purchasedItemInvoiceUpdates({ invoiceId, invoiceType: job.invoiceType || "job" })
              : {}),
          })
        )
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
            jobBillable: Boolean(item.jobBillable ?? item.billable),
            jobBillingRate: cents(item.jobBillingRate ?? item.billingRate ?? item.price),
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
        eventType: "Purchased Material",
        title: `${selectedItems.length} purchased material item(s) attached`,
        description: selectedItems.map((item) => item.name || item.id).filter(Boolean).join(", "),
        changes: [
          buildHistoryChange(
            "actualMaterialCost",
            "Actual Material Cost",
            "—",
            moneyFromCents(selectedItems.reduce((total, item) => total + getPurchasedItemTotalCents(item), 0))
          ),
        ],
        metadata: { purchasedItemIds: selectedPurchasedItemIds },
      });
      setSelectedPurchasedItemIds([]);
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

  const createDraftContract = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;
      const contractRef = doc(db, "contracts", draftContractData.id);

      await setDoc(contractRef, draftContractData);
      await recordJobHistory({
        eventType: "Billing",
        title: "Estimate draft created",
        description: draftContractData.notes || "",
        changes: [
          buildHistoryChange("rate", "Contract Total", "—", moneyFromCents(draftContractData.rate || 0)),
          buildHistoryChange("version", "Version", "—", draftContractData.version || 1),
        ],
        metadata: { contractId: draftContractData.id },
      });

      toast.success("Draft contract created");
      setShowCreateContractModal(false);
      setActiveTab("Billing");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create draft contract");
    }
  };

  const handleSendEstimate = async () => {
    if (salesWorkflowEnabled) {
      if (sendingEstimateEmail) return;

      try {
        if (!recentlySelectedCompany || !jobId) return;

        setSendingEstimateEmail(true);
        const salesAgreement = await ensureJobSalesAgreement();
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
      .map((d) => ({ ...d.data(), id: d.data().id || d.id }))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

    setPlannedServiceStops(plannedStops);

    const workOffersQ = query(
      workOffersPath(companyId),
      where("jobId", "==", currentJobId)
    );

    const workOffersSnap = await getDocs(workOffersQ);
    const offers = workOffersSnap.docs
      .map((d) => ({ ...d.data(), id: d.data().id || d.id }))
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
    const purchased = purchasedItemsSnap.docs.map((d) => ({
      ...d.data(),
      id: d.data().id || d.id,
    }));

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
  const handleMarkEstimateAccepted = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;
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
          metadata: { contractId: selectedContract.id },
        });

        toast.success("Estimate marked as accepted");
      } else {

        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        await updateDoc(jobRef, { billingStatus: "Accepted", operationStatus: "Unscheduled" });
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
      <div className={`rounded-md border px-3 py-2.5 ${toneClass}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
          {title}
        </p>
        <p className="mt-1 text-base font-bold leading-tight">
          {value}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs leading-snug opacity-80">
            {subtitle}
          </p>
        )}
      </div>
    );
  };


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

  const renderHistoryEventCard = (event) => (
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

        {event.changeOrderId && (
          <span className="px-3 py-1 text-xs font-bold rounded-full border bg-amber-100 text-amber-800 border-amber-200">
            Change Order
          </span>
        )}
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
            Material Impact
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

  const handleMarkAsInvoiced = async () => {
    if (salesWorkflowEnabled) {
      if (sendingInvoiceEmail) return;

      try {
        if (!recentlySelectedCompany || !jobId) return;

        setSendingInvoiceEmail(true);
        const salesAgreement = await ensureJobSalesAgreement();
        const salesInvoice = await ensureJobSalesInvoice(salesAgreement.id);
        const sendCallable = httpsCallable(functions, "sendSalesInvoiceEmail");
        const authPayload = await getCallableAuthPayload();
        const sendResult = await sendCallable({
          companyId: recentlySelectedCompany,
          invoiceId: salesInvoice.id,
          invoiceBaseUrl: window.location.origin,
          ...authPayload,
        });

        if (selectedContract?.id) {
          await updateDoc(doc(db, "contracts", selectedContract.id), {
            status: "Invoiced",
            invoicedAt: serverTimestamp(),
            salesAgreementId: salesAgreement.id,
            salesInvoiceId: salesInvoice.id,
            updatedAt: serverTimestamp(),
          });
        }

        const nextOperationStatus = suggestOperationForBilling(
          "Invoiced",
          job.operationStatus || "Estimate Pending"
        );
        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

        await updateDoc(jobRef, {
          billingStatus: "Invoiced",
          operationStatus: nextOperationStatus,
          salesAgreementId: salesAgreement.id,
          salesInvoiceId: salesInvoice.id,
          invoiceDate: serverTimestamp(),
          invoiceRef: salesInvoice.id,
          invoiceType: "salesInvoice",
        });

        const invoicedPurchasedItemCount = await markPurchasedItemsInvoicedForJob({
          invoiceId: salesInvoice.id,
          invoiceType: "salesInvoice",
        });

        setJob((prev) => ({
          ...prev,
          billingStatus: "Invoiced",
          operationStatus: nextOperationStatus,
          salesAgreementId: salesAgreement.id,
          salesInvoiceId: salesInvoice.id,
          invoiceRef: salesInvoice.id,
          invoiceType: "salesInvoice",
        }));
        setSelectedBillingStatus({ value: "Invoiced", label: "Invoiced" });
        setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
        await recordJobHistory({
          eventType: "Billing",
          title: "Invoice emailed through Sales",
          description: sendResult.data?.testMode
            ? `Test email sent to ${sendResult.data.to}. Intended customer: ${sendResult.data.intendedTo}.`
            : `Invoice sent to ${sendResult.data?.to || getCustomerEmail()}.`,
          changes: [
            buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Invoiced"),
            buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", nextOperationStatus),
          ],
          metadata: {
            salesAgreementId: salesAgreement.id,
            salesInvoiceId: salesInvoice.id,
            contractId: selectedContract?.id || "",
            emailResult: sendResult.data || {},
            featureFlagId: "feature_flag_004",
            invoicedPurchasedItemCount,
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
        status: "Invoiced",
        invoicedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const nextOperationStatus = suggestOperationForBilling(
        "Invoiced",
        job.operationStatus || "Estimate Pending"
      );

      await updateDoc(jobRef, {
        billingStatus: "Invoiced",
        operationStatus: nextOperationStatus,
        invoiceDate: serverTimestamp(),
        invoiceRef: selectedContract.id,
        invoiceType: "contract",
      });

      const invoicedPurchasedItemCount = await markPurchasedItemsInvoicedForJob({
        invoiceId: selectedContract.id,
        invoiceType: "contract",
      });

      setJob((prev) => ({
        ...prev,
        billingStatus: "Invoiced",
        operationStatus: nextOperationStatus,
        invoiceRef: selectedContract.id,
        invoiceType: "contract",
      }));
      setSelectedBillingStatus({ value: "Invoiced", label: "Invoiced" });
      setSelectedOperationStatus({ value: nextOperationStatus, label: nextOperationStatus });
      await recordJobHistory({
        eventType: "Billing",
        title: "Job marked as invoiced",
        changes: [
          buildHistoryChange("billingStatus", "Billing Status", job.billingStatus || "—", "Invoiced"),
          buildHistoryChange("operationStatus", "Operation Status", job.operationStatus || "—", nextOperationStatus),
        ],
        metadata: { contractId: selectedContract.id, invoicedPurchasedItemCount },
      });

      toast.success("Job marked as invoiced");
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark as invoiced");
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
              to={`/company/serviceStops/createNew/${jobId}?plannedStopId=${stop.id}`}
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
  const renderServiceStopCard = (stop) => (
    <button
      key={stop.id}
      type="button"
      onClick={() => openServiceStopDetail(stop.id)}
      className="w-full text-left rounded-xl border border-gray-200 bg-gray-50 p-4 hover:bg-white hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Service Stop
          </p>
          <p className="mt-1 text-base font-bold text-gray-800">
            {stop.internalId || stop.type || "Service Stop"}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(stop.operationStatus)}`}>
            {stop.operationStatus || "—"}
          </span>
          <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(stop.billingStatus)}`}>
            {stop.billingStatus || "—"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Service Date</p>
          <p className="mt-1 font-medium text-gray-800">{formatDateValue(stop.serviceDate)}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Start Time</p>
          <p className="mt-1 font-medium text-gray-800">{formatTimeValue(stop.startTime)}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">End Time</p>
          <p className="mt-1 font-medium text-gray-800">{formatTimeValue(stop.endTime)}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Duration</p>
          <p className="mt-1 font-medium text-gray-800">{formatDurationMinutes(stop.duration)}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Estimated Duration</p>
          <p className="mt-1 font-medium text-gray-800">{formatDurationMinutes(stop.estimatedDuration)}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Technician</p>
          <p className="mt-1 font-medium text-gray-800">{stop.tech || "—"}</p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>
          <p className="mt-1 text-gray-700 whitespace-pre-wrap">{stop.description || "—"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {stop.includeReadings && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Readings
          </span>
        )}
        {stop.includeDosages && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            Dosages
          </span>
        )}
        {stop.isInvoiced && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
            Invoiced
          </span>
        )}
        {stop.otherCompany && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
            Other Company
          </span>
        )}
      </div>
    </button>
  );

  const formattedDateCreated = job.dateCreated ? format(job.dateCreated, "MMMM d, yyyy") : "N/A";

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-2 sm:p-3 lg:p-4">
        <div className="w-full">
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-4 bg-gray-200 rounded w-2/3" />
              <div className="h-40 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const commentFilters = ["All", "Open", "Resolved"];
  const normalizedSelectedTerms = normalizeTerms(selectedContract?.terms || []);
  const selectedSection = tabs.find((tab) => tab === activeTab) || "Info";
  const sectionMeta = {
    Info: {
      label: "Overview",
      helper: "Core job, customer, site, and notes",
      count: "",
    },
    Tasks: {
      label: "Work Plan",
      helper: "Tasks and planned service stops",
      count: String((taskList?.length || 0) + (plannedServiceStops?.length || 0)),
    },
    Materials: {
      label: "Materials",
      helper: "Planned and purchased job materials",
      count: String((shoppingList?.length || 0) + (purchasedItems?.length || 0)),
    },
    Offers: {
      label: "Work Offers",
      helper: "Technician offers and board posts",
      count: String(workOffers?.length || 0),
    },
    Schedule: {
      label: "Schedule",
      helper: "Scheduled service stops",
      count: String(serviceStops?.length || 0),
    },
    Billing: {
      label: "Billing",
      helper: "Estimate, invoice, and payment lifecycle",
      count: selectedContract ? "1" : "",
    },
    Actual: {
      label: "Actuals",
      helper: "Labor, payroll, material cost, and profit",
      count: String((actualPayLineItems?.length || 0) + (purchasedItems?.length || 0)),
    },
    History: {
      label: "History",
      helper: "Change orders and timeline",
      count: String((jobHistory?.length || 0) + (changeOrders?.length || 0)),
    },
  };
  const siteAddress = [serviceLocation.streetAddress, serviceLocation.city, serviceLocation.state, serviceLocation.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              to="/company/jobs"
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Back to Jobs
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {job.internalId && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {job.internalId}
                </span>
              )}
              <StatusBadge status={job.billingStatus} />
              <StatusBadge status={job.operationStatus} />
            </div>
            <h1 className="mt-3 text-3xl font-bold text-slate-950">{job.type || "Job Details"}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              {job.customerName || "Customer"} · Created {formattedDateCreated}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!edit ? (
              <>
                <button
                  onClick={handleSendEstimate}
                  disabled={sendingEstimateEmail}
                  className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {salesWorkflowEnabled ? (sendingEstimateEmail ? "Sending..." : "Email Estimate") : "Send Estimate"}
                </button>
                <button
                  onClick={handleMarkEstimateAccepted}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  Mark Accepted
                </button>
                <button
                  onClick={handleMarkAsInvoiced}
                  disabled={sendingInvoiceEmail}
                  className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {salesWorkflowEnabled ? (sendingInvoiceEmail ? "Sending..." : "Email Invoice") : "Mark As Invoiced"}
                </button>
                {can("24") && (
                  <button
                    onClick={editJob}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Edit
                  </button>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
              <div className="mt-3 space-y-2">
                {tabs.map((tab) => {
                  const meta = sectionMeta[tab] || { label: tab, helper: "", count: "" };
                  const active = tab === selectedSection;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
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
              <dl className="mt-3 space-y-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{job.customerName || "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{job.adminName || "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Site</dt>
                  <dd className="mt-1 text-slate-700">{siteAddress || "Not set"}</dd>
                </div>
                <div className="border-t border-slate-200 pt-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Price</dt>
                  <dd className="mt-1 text-lg font-bold text-slate-950">{moneyFromCents(job.rate)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Projected Profit</dt>
                  <dd className={projectedProfitCents < 0 ? "mt-1 font-bold text-rose-700" : "mt-1 font-bold text-emerald-700"}>
                    {moneyFromCents(projectedProfitCents)}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
        {activeTab === "Info" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white shadow-lg rounded-xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Overview</h3>
                  <p className="text-gray-600 mt-1">Core job details and statuses</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.billingStatus)}`}>
                    {job.billingStatus || "—"}
                  </span>
                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.operationStatus)}`}>
                    {job.operationStatus || "—"}
                  </span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {!edit ? (
                  <StatCard
                    title="Customer Price"
                    value={moneyFromCents(job.rate)}
                    subtitle="Saved job rate"
                    tone="blue"
                  />
                ) : (
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-blue-800">
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
                  title="Planned Labor"
                  value={moneyFromCents(plannedTotalLaborCents)}
                  subtitle={`${moneyFromCents(plannedStopLaborCents)} stops • ${moneyFromCents(plannedTaskLaborCents)} tasks`}
                />

                <StatCard
                  title="Planned Materials"
                  value={moneyFromCents(plannedMaterialCostCents)}
                  subtitle={`${moneyFromCents(plannedMaterialPriceCents)} billable`}
                />

                <StatCard
                  title="Projected Profit"
                  value={moneyFromCents(projectedProfitCents)}
                  subtitle="Customer price minus saved labor and planned materials"
                  tone={projectedProfitCents < 0 ? "red" : "green"}
                />

                <StatCard
                  title="Scheduled Stops"
                  value={String(serviceStops.length)}
                  subtitle="Actual scheduled service stops"
                />

                <StatCard
                  title="Planned Stops"
                  value={String(plannedServiceStops.length)}
                  subtitle="Expected visits before scheduling"
                />

                <StatCard
                  title="Work Offers"
                  value={String(workOffers.length)}
                  subtitle="Direct offers and board posts"
                  tone="amber"
                />

                <StatCard
                  title="Actual Materials"
                  value={moneyFromCents(actualPurchasedMaterialCostCents)}
                  subtitle={`${moneyFromCents(billablePurchasedMaterialPriceCents)} billable pending`}
                />
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Link to={`/company/customers/details/${customer.id}`}>
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</p>
                    <p className="mt-1 text-gray-800 font-semibold">
                      {customer.firstName} {customer.lastName}
                    </p>
                  </div>
                </Link>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</p>
                  <p className="mt-1 text-gray-800 font-semibold">{job.type || "—"}</p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Admin</p>
                  {!edit ? (
                    <p className="mt-1 text-gray-800 font-semibold">{job.adminName || "—"}</p>
                  ) : (
                    <div className="mt-2">
                      <Select
                        value={selectedAdmin}
                        options={adminList}
                        onChange={setSelectedAdmin}
                        isSearchable
                        placeholder="Select an admin"
                        theme={selectTheme}
                        styles={selectStyles}
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Created</p>
                  <p className="mt-1 text-gray-800 font-semibold">{formattedDateCreated}</p>
                </div>

                {job.repairRequestId && (
                  <Link
                    to={`/company/repair-requests/detail/${job.repairRequestId}`}
                    state={{ sourcePath: job.repairRequestSourcePath || "company" }}
                    className="p-4 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 transition"
                  >
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Source Repair Request</p>
                    <p className="mt-1 text-blue-700 font-semibold">{job.repairRequestId}</p>
                    <p className="mt-1 text-xs text-gray-500">Converted to this job</p>
                  </Link>
                )}
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Billing Status</p>
                      <div className="w-full max-w-sm">
                        <Select
                          value={selectedBillingStatus}
                          options={billingStatusOptions}
                          onChange={handleSelectedBillingStatus}
                          isSearchable
                          placeholder="Select billing status"
                          theme={selectTheme}
                          styles={selectStyles}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Operation Status</p>
                      <div className="w-full max-w-sm">
                        <Select
                          value={selectedOperationStatus}
                          options={operationStatusOptions}
                          onChange={handleSelectedOperationStatus}
                          isSearchable
                          placeholder="Select operation status"
                          theme={selectTheme}
                          styles={selectStyles}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>

                    <button
                      type="button"
                      onClick={saveDescription}
                      disabled={savingDescription || descriptionDraft === (job.description || "")}
                      className={[
                        "px-3 py-1 rounded-lg text-sm font-semibold transition border",
                        savingDescription || descriptionDraft === (job.description || "")
                          ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                      ].join(" ")}
                    >
                      {savingDescription ? "Saving…" : "Save"}
                    </button>
                  </div>

                  <textarea
                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                    placeholder="Add job description…"
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onBlur={() => {
                      if (descriptionDraft !== (job.description || "")) saveDescription();
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white shadow-lg rounded-xl p-6">
                <h3 className="text-xl font-bold text-gray-800">Site Information</h3>
                <p className="text-gray-600 mt-1">Service location and access details</p>

                <div className="mt-6 space-y-4">
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Address</p>
                    <button
                      onClick={openInMaps}
                      className="mt-1 text-left text-blue-600 hover:text-blue-800 font-semibold"
                      title="Open in Google Maps"
                    >
                      {serviceLocation.streetAddress} {serviceLocation.city} {serviceLocation.state}{" "}
                      {serviceLocation.zip}
                    </button>
                  </div>

                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Gate Code</p>
                    <p className="mt-1 text-gray-800 font-semibold">{serviceLocation.gateCode || "—"}</p>
                  </div>

                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Service Stops</p>

                    {!serviceStops.length ? (
                      <p className="mt-1 text-gray-700">—</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {serviceStops.map((stop) => renderServiceStopCard(stop))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link
                      to={`/company/serviceStops/createNew/${jobId}`}
                      className="w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition text-center"
                    >
                      Schedule Service Stop
                    </Link>
                    <button
                      onClick={openCreateWorkOfferModal}
                      className="w-full py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition text-center"
                    >
                      Create Work Offer
                    </button>
                    <button
                      onClick={openCreateContractModal}
                      className="w-full py-2 px-4 bg-amber-50 border border-amber-200 text-amber-800 font-semibold rounded-lg hover:bg-amber-100 transition text-center"
                    >
                      Create Estimate / Contract
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Comments</h3>
                    <p className="text-gray-600 mt-1">Add notes, track follow-ups, mark resolved</p>
                  </div>
                </div>

                <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-2 flex gap-2 flex-wrap">
                  {commentFilters.map((f) => {
                    const active = f === commentFilter;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setCommentFilter(f)}
                        className={[
                          "px-4 py-2 rounded-full text-sm font-semibold transition border",
                          active
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100",
                        ].join(" ")}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 space-y-3">
                  <textarea
                    className="w-full min-h-[90px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Write a comment…"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={addComment}
                      disabled={addingComment || !newComment.trim()}
                      className={[
                        "py-2 px-4 font-semibold rounded-lg shadow-md transition",
                        addingComment || !newComment.trim()
                          ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                          : "bg-blue-600 text-white hover:bg-blue-700",
                      ].join(" ")}
                    >
                      {addingComment ? "Adding…" : "Add Comment"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 pt-5 border-t border-gray-200 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-bold text-gray-800">Create Follow-Up</h4>
                    <span className="text-xs font-semibold text-gray-500">
                      {job.internalId || "Job"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <input
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      type="text"
                      placeholder="Title"
                      value={followUpTitle}
                      onChange={(e) => setFollowUpTitle(e.target.value)}
                    />

                    <select
                      value={followUpAssignedTechId}
                      onChange={(e) => setFollowUpAssignedTechId(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                    >
                      <option value="">Assign to</option>
                      {(companyUserList || []).map((user) => {
                        const userId = user.userId || user.id || user.uid || "";
                        const label = user.userName || user.name || user.fullName || user.email || "Assigned user";
                        return (
                          <option key={user.id || userId} value={userId}>
                            {label}
                          </option>
                        );
                      })}
                    </select>

                    <button
                      type="button"
                      onClick={createLinkedFollowUp}
                      disabled={savingFollowUp || !followUpTitle.trim() || !followUpAssignedTechId}
                      className={[
                        "py-3 px-4 font-semibold rounded-lg shadow-md transition",
                        savingFollowUp || !followUpTitle.trim() || !followUpAssignedTechId
                          ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                          : "bg-gray-800 text-white hover:bg-gray-900",
                      ].join(" ")}
                    >
                      {savingFollowUp ? "Creating…" : "Create"}
                    </button>
                  </div>

                  <textarea
                    className="w-full min-h-[72px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Details"
                    value={followUpDescription}
                    onChange={(e) => setFollowUpDescription(e.target.value)}
                  />
                </div>

                <div className="mt-6">
                  {commentsLoading ? (
                    <div className="text-gray-500">Loading comments…</div>
                  ) : !filteredComments?.length ? (
                    <div className="text-gray-500">No comments in this filter.</div>
                  ) : (
                    <div className="space-y-3">
                      {filteredComments.map((c) => {
                        const dt = c.date?.toDate?.() || null;
                        const when = dt ? format(dt, "MMM d, yyyy • h:mm a") : "—";

                        return (
                          <div key={c.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-gray-800">
                                  {c.userName || "Unknown"}{" "}
                                  <span className="text-gray-400 font-normal">• {when}</span>
                                </div>
                                <div className="mt-2 text-gray-700 whitespace-pre-wrap">{c.comment}</div>
                              </div>

                              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 select-none">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={!!c.resolved}
                                  onChange={(e) => setCommentResolved(c.id, e.target.checked)}
                                />
                                Resolved
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Tasks" && (
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Tasks</h3>
                <p className="text-gray-600 mt-1">Track work items, costs, and assignments</p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/company/jobs/history/${jobId}`}
                  className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                >
                  See History
                </Link>
                {!newTask && (
                  <button
                    onClick={showNewTaskItem}
                    className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  >
                    + Add Task
                  </button>
                )}
              </div>
            </div>
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-bold text-gray-800">Planned Service Stops</h4>
                  <p className="text-gray-600 mt-1">
                    Expected visits for this job before scheduling actual service stops.
                  </p>
                </div>

                <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                  {plannedServiceStops.length}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {!plannedServiceStops.length ? (
                  <div className="text-gray-500 rounded-xl border border-dashed border-gray-300 p-4">
                    No planned service stops yet.
                  </div>
                ) : (
                  plannedServiceStops.map((stop) => renderPlannedServiceStopCard(stop))
                )}
              </div>
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden xl:table-cell">
                      Equipment Result
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">
                      Worker
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">
                      Worker Type
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden lg:table-cell">
                      Customer Approval
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Labor</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Time (Hr)</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {taskList?.map((task) => (
                    <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 whitespace-nowrap text-gray-800 font-medium">{task.name}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700">{task.type}</td>
                      <td className="p-4 whitespace-nowrap">
                        <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800">
                          {task.status || "—"}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap hidden xl:table-cell">
                        {task.equipmentId ? (
                          <select
                            value={taskEquipmentStatusDrafts[task.id] || EQUIPMENT_STATUS.OPERATIONAL}
                            onChange={(e) => handleTaskEquipmentStatusDraftChange(task.id, e.target.value)}
                            disabled={task.status === "Finished"}
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-400"
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
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden md:table-cell">{task.workerName || "—"}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden md:table-cell">{task.workerType || "—"}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden lg:table-cell">
                        {String(task.customerApproval)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-800">
                        {formatCurrency((Number(task.contractedRate || 0) / 100) || 0)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {((Number(task.estimatedTime || 0) / 60) || 0).toFixed(2)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-right">
                        <button
                          onClick={(e) => deleteTaskItem(e, task.id)}
                          className="text-sm font-semibold text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!taskList?.length && (
                    <tr>
                      <td className="p-6 text-gray-500" colSpan={10}>
                        No tasks yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {newTask && (
              <div className="mt-6 p-4 rounded-xl border border-gray-200 bg-gray-50">
                <div className="flex flex-col lg:flex-row gap-3 items-stretch">
                  <div className="flex items-center justify-between lg:hidden">
                    <h4 className="font-bold text-gray-800">Add Task</h4>
                    <button
                      onClick={clearNewTask}
                      className="py-2 px-3 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                    >
                      Cancel
                    </button>
                  </div>

                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
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

                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    type="text"
                    placeholder="Labor Cost (USD)"
                    value={taskLaborCost}
                    onChange={(e) => setTaskLaborCost(e.target.value)}
                  />

                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    type="text"
                    placeholder="Estimated Time (Min)"
                    value={estimatedTime}
                    onChange={(e) => setEstimatedTime(e.target.value)}
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={handleAddTask}
                      className="w-full py-3 px-5 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                    >
                      Add
                    </button>
                    <button
                      onClick={clearNewTask}
                      className="w-full py-3 px-5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition hidden lg:block"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Link
                to={`/company/serviceStops/createNew/${jobId}`}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition text-center"
              >
                Schedule Service Stop
              </Link>
              <button
                onClick={openCreateWorkOfferModal}
                className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition text-center"
              >
                Create Work Offer
              </button>
            </div>
          </div>
        )}

        {activeTab === "Materials" && (
          <div className="space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Materials</h3>
                  <p className="text-gray-600 mt-1">
                    Planned job materials and purchased items connected to this job.
                  </p>
                </div>

                {!newShoppingList && (
                  <button
                    onClick={showNewShoppingListItem}
                    className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  >
                    + Add Planned Material
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <StatCard
                  title="Planned Cost"
                  value={moneyFromCents(plannedMaterialCostCents)}
                  subtitle={`${shoppingList.length} planned item(s)`}
                />

                <StatCard
                  title="Planned Billable"
                  value={moneyFromCents(plannedMaterialPriceCents)}
                  subtitle="Expected customer material charge"
                  tone="blue"
                />

                <StatCard
                  title="Actual Purchased"
                  value={moneyFromCents(actualPurchasedMaterialCostCents)}
                  subtitle={`${purchasedItems.length} purchased item(s)`}
                  tone="amber"
                />

                <StatCard
                  title="Billable Pending"
                  value={moneyFromCents(billablePurchasedMaterialPriceCents)}
                  subtitle="Billable purchased material not invoiced"
                  tone="green"
                />
              </div>
            </div>

            {newShoppingList && (
              <div className="bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800">
                      Add Planned Material
                    </h4>
                    <p className="text-gray-600 mt-1 text-sm">
                      Add a reusable planned material snapshot for this job.
                    </p>
                  </div>

                  <button
                    onClick={clearNewShoppingListItem}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
                  >
                    Cancel
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-2">
                        Sub Category
                      </label>
                      <select
                        value={shoppingFormData.subCategory}
                        onChange={(e) => handleShoppingSubCategoryChange(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg bg-white"
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
                        <label className="block text-sm font-semibold text-gray-500 mb-2">
                          Database Item
                        </label>
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
                    )}

                    {requiresShoppingManualDetails && (
                      <>
                        <div>
                          <label className="block text-sm font-semibold text-gray-500 mb-2">
                            Name
                          </label>
                          <input
                            type="text"
                            value={shoppingFormData.name}
                            onChange={(e) => handleShoppingFormChange("name", e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            placeholder="Enter custom material name"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-500 mb-2">
                            Description
                          </label>
                          <textarea
                            value={shoppingFormData.description}
                            onChange={(e) => handleShoppingFormChange("description", e.target.value)}
                            className="w-full min-h-[120px] p-3 border border-gray-300 rounded-lg"
                            placeholder="Enter custom material description"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-2">
                        Quantity
                      </label>
                      <input
                        type="text"
                        value={shoppingFormData.quantity}
                        onChange={(e) => handleShoppingFormChange("quantity", e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg"
                        placeholder="Quantity"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-2">
                        Linked Task
                      </label>
                      <select
                        value={shoppingFormData.linkedTaskId}
                        onChange={(e) => handleShoppingFormChange("linkedTaskId", e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                      >
                        <option value="">No linked task</option>
                        {(taskList || []).map((task) => (
                          <option key={task.id} value={task.id}>
                            {[task.name || task.type || "Task", task.status || ""].filter(Boolean).join(" - ")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <h5 className="font-bold text-gray-800">Pricing Snapshot</h5>
                    <p className="text-sm text-gray-600 mt-1">
                      Database item pricing is stored as cents and copied into this material.
                    </p>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg bg-white border border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Unit Cost
                        </p>
                        <p className="mt-1 font-semibold text-gray-800">
                          {moneyFromCents(selectedShoppingDbItem?.rate || selectedShoppingDbItem?.cost || 0)}
                        </p>
                      </div>

                      <div className="rounded-lg bg-white border border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Unit Billable
                        </p>
                        <p className="mt-1 font-semibold text-gray-800">
                          {moneyFromCents(
                            selectedShoppingDbItem?.sellPrice ||
                            selectedShoppingDbItem?.rate ||
                            selectedShoppingDbItem?.cost ||
                            0
                          )}
                        </p>
                      </div>

                      <div className="rounded-lg bg-white border border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Quantity
                        </p>
                        <p className="mt-1 font-semibold text-gray-800">
                          {shoppingFormData.quantity || "—"}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleAddShoppingListItem}
                      disabled={!canSaveShoppingItem}
                      className="mt-4 block w-full text-center py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      Add Material
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800">Planned Materials</h4>
                    <p className="text-gray-600 mt-1 text-sm">
                      Materials expected before purchasing.
                    </p>
                  </div>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {shoppingList.length}
                  </span>

                  {!newShoppingList && (
                    <button
                      onClick={showNewShoppingListItem}
                      className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                    >
                      + Add Planned Material
                    </button>
                  )}
                </div>

                <div className="mt-6 space-y-3">
                  {!shoppingList.length ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                      <p className="text-gray-700 font-medium">No planned materials yet.</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Add planned materials to estimate job cost and billing.
                      </p>
                    </div>
                  ) : (
                    shoppingList.map((item) => renderPlannedMaterialCard(item))
                  )}
                </div>
              </div>

              <div className="bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800">Purchased Materials</h4>
                    <p className="text-gray-600 mt-1 text-sm">
                      Actual vendor receipt items connected to this job.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                      {purchasedItems.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPurchasedItemPicker((prev) => !prev);
                        if (!showPurchasedItemPicker && availablePurchasedItems.length === 0) {
                          loadAvailablePurchasedItems();
                        }
                      }}
                      className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                    >
                      + Attach Purchased Item
                    </button>
                  </div>
                </div>

                {showPurchasedItemPicker && (
                  <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
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

                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={loadAvailablePurchasedItems}
                            disabled={loadingAvailablePurchasedItems}
                            className="flex-1 rounded-lg bg-white border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 transition disabled:opacity-60"
                          >
                            {loadingAvailablePurchasedItems ? "Loading..." : "Load Items"}
                          </button>
                          <button
                            type="button"
                            onClick={attachPurchasedItemsToJob}
                            disabled={!selectedPurchasedItemIds.length}
                            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 transition disabled:opacity-50"
                          >
                            Attach {selectedPurchasedItemIds.length || ""}
                          </button>
                        </div>
                      </div>

                      <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
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
                  </div>
                )}

                <div className="mt-6 space-y-3">
                  {!purchasedItems.length ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                      <p className="text-gray-700 font-medium">No purchased materials yet.</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Purchased items from vendor receipts will appear here when tied to this job.
                      </p>
                    </div>
                  ) : (
                    purchasedItems.map((item) => renderPurchasedMaterialCard(item))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Offers" && (
          <div className="space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Work Offers</h3>
                  <p className="text-gray-600 mt-1">
                    Offers and internal board posts connected to this job.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={openCreateWorkOfferModal}
                    className="px-4 py-2 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition"
                  >
                    Create Work Offer
                  </button>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {workOffers.length} total
                  </span>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-green-50 text-green-700 border border-green-200">
                    {workOffers.filter((offer) => offer.status === "Accepted" || offer.status === "accepted").length} accepted
                  </span>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {workOffers.filter((offer) => !offer.status || ["Pending", "pending", "Open", "open", "Posted", "posted", "Sent", "sent", "Viewed", "viewed", "Draft", "draft"].includes(offer.status)).length} open
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
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
            </div>

            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-bold text-gray-800">Offer List</h4>
                  <p className="text-gray-600 mt-1 text-sm">
                    Create direct technician offers or internal board posts for the selected job tasks.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {!workOffers.length ? (
                  <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                    <p className="text-gray-700 font-medium">No work offers yet.</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Create an offer to send this work to a technician or post it to the internal board.
                    </p>
                  </div>
                ) : (
                  workOffers.map((offer) => renderWorkOfferCard(offer))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "Schedule" && (
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Schedule</h3>
                <p className="text-gray-600 mt-1">Service stops and accepted work offers</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                  onClick={markJobAsFinished}>Mark Job as Finished</button>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl border border-gray-200 bg-gray-50">
                <h4 className="font-bold text-gray-800">Service Stops</h4>
                <p className="text-gray-600 mt-1 text-sm">Use the button below to schedule a service stop.</p>

                <div className="mt-4">
                  <Link
                    to={`/company/serviceStops/createNew/${jobId}`}
                    className="inline-flex items-center justify-center py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  >
                    Schedule Service Stop
                  </Link>
                </div>

                <div className="mt-4">
                  <p className="font-semibold text-gray-700 text-sm">Scheduled Service Stops</p>

                  {!serviceStops.length ? (
                    <p className="mt-1 text-sm text-gray-600">—</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {serviceStops.map((stop) => renderServiceStopCard(stop))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-5 rounded-xl border border-gray-200 bg-gray-50">
                <h4 className="font-bold text-gray-800">Work Offers</h4>
                <p className="text-gray-600 mt-1 text-sm">Create offers for job tasks or review accepted offers before scheduling.</p>

                <div className="mt-4">
                  <button
                    onClick={openCreateWorkOfferModal}
                    className="inline-flex items-center justify-center py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                  >
                    Create Work Offer
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {!workOffers.length ? (
                    <p className="mt-1 text-sm text-gray-600">No work offers yet.</p>
                  ) : (
                    workOffers.slice(0, 3).map((offer) => renderWorkOfferCard(offer))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}


        {activeTab === "Actual" && (
          <div className="space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Actual Work</h3>
                  <p className="text-gray-600 mt-1">
                    Actual labor and purchased material cost connected to this job.
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
                  title="Customer Price"
                  value={moneyFromCents(job.rate)}
                  subtitle="Saved job rate"
                  tone="blue"
                />

                <StatCard
                  title="Actual Labor"
                  value={moneyFromCents(actualLaborTotalCents)}
                  subtitle={`${moneyFromCents(actualPayrollTotalCents)} payroll • ${moneyFromCents(scheduledStopLaborEstimateCents)} stop labor`}
                  tone="amber"
                />

                <StatCard
                  title="Actual Materials"
                  value={moneyFromCents(actualPurchasedMaterialCostCents)}
                  subtitle="Purchased material cost"
                  tone="amber"
                />

                <StatCard
                  title="Actual Profit"
                  value={moneyFromCents(actualProfitCents)}
                  subtitle="Customer price minus actual labor and materials"
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
                    <h4 className="text-lg font-bold text-gray-800">Purchased Materials</h4>
                    <p className="text-gray-600 mt-1 text-sm">
                      Actual vendor receipt items attached to this job.
                    </p>
                  </div>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {moneyFromCents(actualPurchasedMaterialCostCents)}
                  </span>
                </div>

                <div className="mt-6 space-y-3">
                  {!purchasedItems.length ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                      <p className="text-gray-700 font-medium">No purchased materials yet.</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Purchased items from vendor receipts will appear here when tied to this job.
                      </p>
                    </div>
                  ) : (
                    purchasedItems.map((item) => renderPurchasedMaterialCard(item))
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl p-6">
              <div>
                <h4 className="text-lg font-bold text-gray-800">Plan vs Actual</h4>
                <p className="text-gray-600 mt-1 text-sm">
                  Compare the original plan against actual recorded cost.
                </p>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Planned Labor
                  </p>
                  <p className="mt-1 text-lg font-bold text-gray-800">
                    {moneyFromCents(plannedTotalLaborCents)}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {moneyFromCents(plannedStopLaborCents)} stops • {moneyFromCents(plannedTaskLaborCents)} tasks
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Planned Materials
                  </p>
                  <p className="mt-1 text-lg font-bold text-gray-800">
                    {moneyFromCents(plannedMaterialCostCents)}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {moneyFromCents(plannedMaterialPriceCents)} planned billable
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
        {activeTab === "History" && (
          <div className="space-y-6">
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
                  subtitle="Labor plus materials"
                  tone="red"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
              <div className="xl:col-span-2 bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800">Change Orders</h4>
                    <p className="text-gray-600 mt-1 text-sm">
                      Requests that change scope, price, labor, materials, or schedule.
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

              <div className="xl:col-span-3 bg-white shadow-lg rounded-xl p-6">
                <div>
                  <h4 className="text-lg font-bold text-gray-800">Job Timeline</h4>
                  <p className="text-gray-600 mt-1 text-sm">
                    Who changed what and when.
                  </p>
                </div>

                <div className="mt-6 space-y-3">
                  {jobHistoryLoading ? (
                    <div className="text-gray-500">Loading history…</div>
                  ) : !jobHistory.length ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                      <p className="text-gray-700 font-medium">No history events recorded yet.</p>
                    </div>
                  ) : (
                    jobHistory.map((event) => renderHistoryEventCard(event))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === "Billing" && (
          <div className="space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Billing</h3>
                  <p className="text-gray-600 mt-1">
                    Estimate, acceptance, invoicing, and payment lifecycle
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={openCreateContractModal}
                    className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                  >
                    New Estimate Draft
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
                    disabled={!selectedContract}
                    className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition disabled:opacity-50"
                  >
                    Mark Accepted
                  </button>
                  <button
                    onClick={handleMarkAsInvoiced}
                    disabled={sendingInvoiceEmail || (!salesWorkflowEnabled && !selectedContract)}
                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
                  >
                    {salesWorkflowEnabled ? (sendingInvoiceEmail ? "Sending..." : "Email Invoice") : "Mark Invoiced"}
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

                <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={openCreateContractModal}
                    className="px-4 py-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                  >
                    Create Estimate Draft
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
                    disabled={!selectedContract}
                    className="px-4 py-3 text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition disabled:opacity-50"
                  >
                    Mark Accepted
                  </button>

                  <button
                    type="button"
                    onClick={handleMarkAsInvoiced}
                    disabled={sendingInvoiceEmail || (!salesWorkflowEnabled && !selectedContract)}
                    className="px-4 py-3 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
                  >
                    {salesWorkflowEnabled ? (sendingInvoiceEmail ? "Sending..." : "Email Invoice") : "Mark Invoiced"}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="Customer Price"
                  value={moneyFromCents(job.rate)}
                  subtitle="Saved job rate"
                  tone="blue"
                />

                <StatCard
                  title="Material Cost"
                  value={moneyFromCents(actualPurchasedMaterialCostCents)}
                  subtitle={`${purchasedItems.length} purchased material item(s)`}
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
                  subtitle={`${actualMarginPercent}% margin`}
                  tone={actualProfitCents < 0 ? "red" : "green"}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
              <div className="xl:col-span-2 bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800">Estimate History</h4>
                    <p className="text-gray-600 mt-1 text-sm">Every version tied to this job</p>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {contractsLoading ? (
                    <div className="text-gray-500">Loading contracts…</div>
                  ) : !contracts.length ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                      <p className="text-gray-700 font-medium">No estimates or contracts yet.</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Create a draft to start the billing lifecycle for this job.
                      </p>
                      <button
                        onClick={openCreateContractModal}
                        className="mt-4 px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
                      >
                        Create Draft
                      </button>
                    </div>
                  ) : (
                    contracts.map((contract, index) => {
                      const active = selectedContract?.id === contract.id;
                      return (
                        <button
                          key={contract.id}
                          type="button"
                          onClick={() => setSelectedContractId(contract.id)}
                          className={[
                            "w-full text-left p-4 rounded-xl border transition",
                            active
                              ? "border-blue-300 bg-blue-50 shadow-sm"
                              : "border-gray-200 bg-gray-50 hover:bg-white",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Version {contract.version || contracts.length - index}
                              </p>
                              <p className="mt-1 text-base font-bold text-gray-800">
                                {formatCurrency((Number(contract.rate || 0) / 100) || 0)}
                              </p>
                              <p className="mt-1 text-sm text-gray-600">
                                Sent: {formatDateTimeValue(contract.dateSent)}
                              </p>
                              <p className="mt-1 text-sm text-gray-600">
                                Accept By: {formatDateValue(contract.lastDateToAccept)}
                              </p>
                            </div>

                            <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(contract.status)}`}>
                              {contract.status || "—"}
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedContractId(contract.id);
                                  openContractModal(contract);
                                }}
                                className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition"
                              >
                                View / Edit
                              </button>

                              <Link
                                to={`/company/contract/detail/${contract.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition"
                              >
                                Open Detail
                              </Link>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Receiver</p>
                              <p className="mt-1 text-gray-800">
                                {contract.receiverName || customer.firstName || "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Accepted</p>
                              <p className="mt-1 text-gray-800">
                                {contract.receiverAcceptance ? "Yes" : "No"}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="xl:col-span-3 space-y-6">
                <div className="bg-white shadow-lg rounded-xl p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-bold text-gray-800">Contract Snapshot</h4>
                      <p className="text-gray-600 mt-1 text-sm">
                        Snapshot of the selected estimate / contract
                      </p>
                    </div>
                    <div>
                      {selectedContract && (
                        <Link
                          to={`/company/contract/detail/${selectedContract.id}`}
                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition"
                        >
                          View Estimate Detail
                        </Link>
                      )}
                    </div>
                    {selectedContract && (
                      <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(selectedContract.status)}`}>
                        {selectedContract.status || "—"}
                      </span>
                    )}
                  </div>

                  {!selectedContract ? (
                    <div className="mt-6 text-gray-500">Select a contract to see its snapshot.</div>
                  ) : (
                    <>
                      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sender</p>
                          <p className="mt-1 text-gray-800 font-semibold">{selectedContract.senderName || "—"}</p>
                        </div>

                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Receiver</p>
                          <p className="mt-1 text-gray-800 font-semibold">{selectedContract.receiverName || "—"}</p>
                        </div>

                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Sent</p>
                          <p className="mt-1 text-gray-800 font-semibold">{formatDateTimeValue(selectedContract.dateSent)}</p>
                        </div>

                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Accepted On</p>
                          <p className="mt-1 text-gray-800 font-semibold">{formatDateTimeValue(selectedContract.dateAccepted)}</p>
                        </div>

                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Date To Accept</p>
                          <p className="mt-1 text-gray-800 font-semibold">{formatDateValue(selectedContract.lastDateToAccept)}</p>
                        </div>

                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Estimate</p>
                          <p className="mt-1 text-gray-800 font-bold text-lg">
                            {formatCurrency((contractTotalCents / 100) || 0)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-6">
                        <h5 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Scope / Terms</h5>

                        {!normalizedSelectedTerms.length ? (
                          <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-500">
                            No terms added to this contract.
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

                        {!contractSnapshotItems.length ? (
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
                                {contractSnapshotItems.map((item) => (
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
                          {selectedContract.notes || "—"}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                <div className="bg-white shadow-lg rounded-xl p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-bold text-gray-800">Lifecycle Guidance</h4>
                      <p className="text-gray-600 mt-1 text-sm">
                        Matches the iOS job billing and operation status workflow.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.billingStatus)}`}>
                        Billing: {job.billingStatus || "Draft"}
                      </span>
                      <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.operationStatus)}`}>
                        Operation: {job.operationStatus || "Estimate Pending"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <p className="text-sm font-semibold text-blue-900">iOS paired-status rules</p>
                    <p className="mt-1 text-sm text-blue-800">
                      Billing Invoiced or Paid marks operation Finished. Billing Expired moves unfinished work back to Estimate Pending. Operation Finished leaves billing In Progress until invoiced or paid.
                    </p>
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {billingLifecycleSteps.map((step) => {
                      const active = (job.billingStatus || "Draft") === step.status;

                      return (
                        <div
                          key={step.status}
                          className={[
                            "p-4 rounded-xl border",
                            active
                              ? "bg-blue-50 border-blue-200 shadow-sm"
                              : "bg-gray-50 border-gray-200",
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
          </div>
        )}

      </div>
        </section>
      </div>
      {edit && can("26") && (
        <button
          onClick={deleteJob}
          className="w-full px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
        >
          Delete
        </button>
      )}
      {showChangeOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">New Change Order</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Capture a scope, price, labor, material, or schedule change for this job.
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
                    Material Cost Impact
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
                              {task.type || "Task"} • {Number(task.estimatedTime || 0)} min • {moneyFromCents(task.contractedRate)} planned labor
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
                <h3 className="text-xl font-bold text-gray-800">Contract Details</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Review and Edit Contract Before Sending
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
                  >{draftContractData.receiverName}</h1>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-500 mb-2">
                    Status
                  </label>
                  <select
                    value={draftContractData.status}
                    onChange={(e) => handleDraftContractDataChange("status", e.target.value)}
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
                  Line Items
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
                onClick={createDraftContract}
                className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-semibold hover:bg-amber-100 transition"
              >
                Confirm & Create Draft
              </button>
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
                  Line Items
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
