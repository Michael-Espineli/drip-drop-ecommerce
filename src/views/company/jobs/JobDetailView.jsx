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
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import Select from "react-select";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import {
  estimatePlannedServiceStopPayRange,
  formatPayRate,
} from "../../../utils/payroll/payEstimate";
import { recordBodyOfWaterTaskHistory } from "../../../utils/bodyOfWaterHistory";

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

  // Tabs
  const tabs = ["Info", "Tasks", "Offers", "Schedule", "Materials", "Actual", "Billing"];
  const [activeTab, setActiveTab] = useState("Info");

  // Tasks
  const [taskTypeList, setTaskTypeList] = useState([]);
  const [taskList, setTaskList] = useState([]);
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
  });

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

  // Billing / Contracts
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState("");
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

  const latestContract = useMemo(() => contracts[0] || null, [contracts]);

  const contractStatusOptions = useMemo(
    () => ["Draft", "Sent", "Viewed", "Accepted", "Rejected", "Expired", "Invoiced", "Paid"],
    []
  );
  const [customerPriceInput, setCustomerPriceInput] = useState("");
  const requiresShoppingCustomDetails = shoppingFormData.subCategory === "Custom";
  const requiresShoppingDbItem = shoppingFormData.subCategory !== "Custom";

  const canSaveShoppingItem = useMemo(() => {
    const hasQuantity =
      shoppingFormData.quantity !== "" && !Number.isNaN(Number(shoppingFormData.quantity));
    const hasName = requiresShoppingCustomDetails
      ? shoppingFormData.name.trim() !== ""
      : shoppingFormData.dbItemId.trim() !== "";

    return hasQuantity && hasName;
  }, [shoppingFormData, requiresShoppingCustomDetails]);
  const cents = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
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
    collection(db, "companies", companyId, "payLineItems");

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
      type: "Planned Stop",
      name: stop.name || stop.serviceStopTypeName || "Planned Service Stop",
      description: stop.description || stop.plannedLaborNotes || "",
      quantity: 1,
      amount: getPlannedStopCostCents(stop),
      displayAmount: moneyFromCents(getPlannedStopCostCents(stop)),
    }));

    const laborItems = (taskList || []).map((task) => ({
      id: task.id,
      type: "Task",
      name: task.name || task.type || "Task",
      description: task.type || "",
      quantity: 1,
      amount: cents(task.contractedRate),
      displayAmount: moneyFromCents(task.contractedRate),
    }));

    const materialItems = (shoppingList || []).map((item) => {
      const amount = getShoppingPlannedTotalPriceCents(item);

      return {
        id: item.id,
        type: "Material",
        name: item.name || "Material",
        description: item.description || "",
        quantity: Number(item.quantity || 0),
        amount,
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
        amount: Number(item?.amount || item?.price || 0),
        displayAmount: formatCurrency((Number(item?.amount || item?.price || 0) / 100) || 0),
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

  const plannedTotalCostCents = useMemo(() => {
    return plannedTotalLaborCents + plannedMaterialCostCents;
  }, [plannedTotalLaborCents, plannedMaterialCostCents]);

  const actualPurchasedMaterialCostCents = useMemo(() => {
    return (purchasedItems || []).reduce((total, item) => {
      const price = cents(item.price);
      const qty = quantityNumber(item.quantityString ?? item.quantity);
      return total + Math.round(price * qty);
    }, 0);
  }, [purchasedItems]);

  const billablePurchasedMaterialPriceCents = useMemo(() => {
    return (purchasedItems || []).reduce((total, item) => {
      if (!item.billable || item.invoiced) return total;

      const unit = item.billingRate !== undefined && item.billingRate !== null
        ? cents(item.billingRate)
        : cents(item.price);

      const qty = quantityNumber(item.quantityString ?? item.quantity);

      return total + Math.round(unit * qty);
    }, 0);
  }, [purchasedItems]);

  const actualPayrollTotalCents = useMemo(() => {
    return (actualPayLineItems || []).reduce((total, line) => {
      return total + cents(line.amountCents ?? line.totalCents ?? line.payCents);
    }, 0);
  }, [actualPayLineItems]);

  const savedLaborCostCents = useMemo(() => {
    return cents(job.laborCost);
  }, [job.laborCost]);

  const projectedProfitCents = useMemo(() => {
    return cents(job.rate) - plannedTotalLaborCents - plannedMaterialCostCents;
  }, [job.rate, plannedTotalLaborCents, plannedMaterialCostCents]);

  const actualProfitCents = useMemo(() => {
    return cents(job.rate) - actualPayrollTotalCents - actualPurchasedMaterialCostCents;
  }, [job.rate, actualPayrollTotalCents, actualPurchasedMaterialCostCents]);

  const contractTotalCents = useMemo(() => {
    if (selectedContract?.rate !== undefined && selectedContract?.rate !== null) {
      return Number(selectedContract.rate || 0);
    }
    return Number(job.rate || 0);
  }, [selectedContract, job.rate]);

  const pendingAcceptanceContract = useMemo(
    () => contracts.find((c) => c.status === "Sent" || c.status === "Viewed") || null,
    [contracts]
  );
  const toInputDateValue = (value) => {
    if (!value) return "";
    const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
    if (Number.isNaN(date?.getTime?.())) return "";
    return format(date, "yyyy-MM-dd");
  };
  const projectedMarginPercent = useMemo(() => {
    const rate = cents(job.rate);
    if (rate <= 0) return "0.0";

    return ((projectedProfitCents / rate) * 100).toFixed(1);
  }, [job.rate, projectedProfitCents]);

  const actualMarginPercent = useMemo(() => {
    const rate = cents(job.rate);
    if (rate <= 0) return "0.0";

    return ((actualProfitCents / rate) * 100).toFixed(1);
  }, [job.rate, actualProfitCents]);

  const billingReadyCents = useMemo(() => {
    return cents(job.rate);
  }, [job.rate]);

  const plannedBillingSupportCents = useMemo(() => {
    return plannedTotalLaborCents + plannedMaterialPriceCents;
  }, [plannedTotalLaborCents, plannedMaterialPriceCents]);

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

      await updateDoc(jobRef, {
        operationStatus: "Finished",
        billingStatus:
          job.billingStatus === "Draft" || !job.billingStatus
            ? "In Progress"
            : job.billingStatus,
      });

      await Promise.all(
        (taskList || []).map(async (task) => {
          if (!task?.id) return;

          await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id),
            { status: "Finished" }
          );

          await recordBodyOfWaterTaskHistory({
            db,
            companyId: recentlySelectedCompany,
            task: { ...task, status: "Finished" },
            jobId,
          });
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
      setTaskList((prev) => prev.map((task) => ({ ...task, status: "Finished" })));

      setSelectedOperationStatus({
        value: "Finished",
        label: "Finished",
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
      type: item.type,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      amount: item.amount,
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

        const serviceStopIds = Array.isArray(j.serviceStopIds)
          ? j.serviceStopIds
          : j.serviceStopIds
            ? [j.serviceStopIds]
            : [];

        setJob((prev) => ({
          ...prev,
          ...j,
          dateCreated,
          serviceStopIds,
        }));

        if (serviceStopIds.length) {
          const stopSnapshots = await Promise.all(
            serviceStopIds.map((stopId) =>
              getDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", stopId))
            )
          );

          const stops = stopSnapshots
            .filter((snap) => snap.exists())
            .map((snap) => {
              const data = snap.data();
              return {
                ...data,
                id: data.id || snap.id,
              };
            });

          setServiceStops(stops);
        } else {
          setServiceStops([]);
        }

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
          jobName: j.internalId || j.id || "",
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


  const saveDescription = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;

      setSavingDescription(true);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

      await updateDoc(jobRef, { description: descriptionDraft });

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

      toast.success(resolved ? "Marked resolved" : "Re-opened");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update comment");
    }
  };

  const editJob = async (e) => {
    e.preventDefault();
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
    try {
      setSelectedOperationStatus(opt);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      await updateDoc(jobRef, { operationStatus: opt.value });
      setJob((prev) => ({ ...prev, operationStatus: opt.value }));
      toast.success("Updated operation status");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update operation status");
    }
  };

  const handleSelectedBillingStatus = async (opt) => {
    try {
      setSelectedBillingStatus(opt);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      await updateDoc(jobRef, { billingStatus: opt.value });
      setJob((prev) => ({ ...prev, billingStatus: opt.value }));
      toast.success("Updated billing status");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update billing status");
    }
  };
  const getPayrollLineAmountCents = (line) => {
    return cents(
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

        equipmentId: "",
        serviceLocationId: "",
        bodyOfWaterId: "",
        dataBaseItemId: "",
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
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id));

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

    if (value === "Custom") {
      nextData.dbItemId = "";
      nextData.genericItemId = "";
      setSelectedShoppingDbItem(null);
    } else {
      nextData.name = "";
      nextData.description = "";
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
    });
  };

  const handleAddShoppingListItem = async (e) => {
    e.preventDefault();

    try {
      if (!shoppingFormData.quantity) return toast.error("Add quantity");

      const qty = parseFloat(shoppingFormData.quantity);
      if (!qty || qty <= 0) return toast.error("Quantity must be greater than 0");

      if (requiresShoppingCustomDetails && !shoppingFormData.name.trim()) {
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

      await setDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", id), {
        id,
        category: "Job",
        subCategory: shoppingFormData.subCategory,
        status: shoppingFormData.status,
        purchaserId: shoppingFormData.purchaserId || "",
        purchaserName: shoppingFormData.purchaserName || "",
        genericItemId: shoppingFormData.genericItemId || "",
        name: shoppingFormData.name || "",
        description: shoppingFormData.description || "",
        datePurchased: shoppingFormData.datePurchased
          ? Timestamp.fromDate(new Date(shoppingFormData.datePurchased))
          : null,

        // iOS: var quantity: String?
        quantity: String(qty),

        // Job
        jobId: jobId || "",

        // Customer
        customerId: job.customerId || "",
        customerName: job.customerName || "",

        // Personal
        userId: "",
        userName: "",

        // DataBaseItem
        dbItemId: requiresShoppingDbItem ? shoppingFormData.dbItemId || "" : "",
        purchasedItem: "",
        invoiced: false,

        // Legacy web fields for backward compatibility
        itemId: requiresShoppingDbItem ? shoppingFormData.dbItemId || "" : "",
        itemType: requiresShoppingDbItem ? "Data Base" : "Custom",
        cost: plannedUnitCostCents,
        price: plannedUnitPriceCents,

        // iOS-compatible planned material pricing snapshot
        plannedUnitCostCents,
        plannedUnitPriceCents,
        plannedTotalCostCents,
        plannedTotalPriceCents,
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
      // fixed path bug: delete from shoppingList collection, not workOrders/{jobId}/items
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "shoppingList", id));

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

  const getMaterialName = (item) => {
    return item.name || item.dbItemName || item.itemName || "Unnamed Material";
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
    if (!item.billable || item.invoiced) return 0;

    const unit =
      item.billingRate !== undefined && item.billingRate !== null
        ? cents(item.billingRate)
        : cents(item.price);

    const qty = quantityNumber(item.quantityString ?? item.quantity);
    return Math.round(unit * qty);
  };

  const renderPlannedMaterialCard = (item) => {
    const totalCostCents = getShoppingPlannedTotalCostCents(item);
    const totalPriceCents = getShoppingPlannedTotalPriceCents(item);

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
            {item.billable && (
              <span className="px-3 py-1 text-xs font-bold rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                Billable
              </span>
            )}

            {item.invoiced && (
              <span className="px-3 py-1 text-xs font-bold rounded-full border bg-green-50 text-green-700 border-green-200">
                Invoiced
              </span>
            )}
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
              Billing Rate
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {item.billingRate ? moneyFromCents(item.billingRate) : "—"}
            </p>
          </div>

          <div className="rounded-lg bg-white border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Billable Pending
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

      toast.success("Draft contract created");
      setShowCreateContractModal(false);
      setActiveTab("Billing");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create draft contract");
    }
  };

  const handleSendEstimate = async () => {
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

      await updateDoc(jobRef, {
        billingStatus: "Estimate",
      });

      setJob((prev) => ({ ...prev, billingStatus: "Estimate" }));
      setSelectedBillingStatus({ value: "Estimate", label: "Estimate" });

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

    // Leave this empty until we confirm the exact payroll line item path.
    setActualPayLineItems([]);



    return {
      plannedStops,
      offers,
      purchased,
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

        toast.success("Estimate marked as accepted");
      } else {

        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        await updateDoc(jobRef, { billingStatus: "Accepted", operationStatus: "Unscheduled" });
        setJob((prev) => ({ ...prev, billingStatus: "Accepted", operationStatus: "Unscheduled" }));
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark estimate accepted");
    }
  };

  const StatCard = ({ title, value, subtitle, tone = "gray" }) => {
    const toneClass =
      tone === "green"
        ? "bg-green-50 border-green-200 text-green-800"
        : tone === "red"
          ? "bg-red-50 border-red-200 text-red-800"
          : tone === "blue"
            ? "bg-blue-50 border-blue-200 text-blue-800"
            : tone === "amber"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-gray-50 border-gray-200 text-gray-800";

    return (
      <div className={`rounded-xl border p-4 ${toneClass}`}>
        <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
          {title}
        </p>
        <p className="mt-1 text-xl font-bold">
          {value}
        </p>
        {subtitle && (
          <p className="mt-1 text-sm opacity-80">
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
    if (offer.receiverName) return offer.receiverName;
    if (offer.workerName) return offer.workerName;
    if (offer.companyUserName) return offer.companyUserName;
    if (offer.boardName) return offer.boardName;
    if (offer.isBoardPost || offer.offerType === "Board") return "Internal Board";
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
      offer.payEstimateCents ??
      offer.totalEstimatedPayCents ??
      offer.rate ??
      0
    );
  };

  const getOfferCanSelfSchedule = (offer) => {
    return Boolean(
      offer.canTechnicianSchedule ||
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
          {offer.isBoardPost && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              Board Post
            </span>
          )}

          {offer.scheduledServiceStopId && (
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

  const handleMarkAsInvoiced = async () => {
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

      await updateDoc(jobRef, {
        billingStatus: "Invoiced",
      });

      setJob((prev) => ({ ...prev, billingStatus: "Invoiced" }));
      setSelectedBillingStatus({ value: "Invoiced", label: "Invoiced" });

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
            {stop.internalId || stop.type || stop.id}
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
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-screen-xl mx-auto">
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <Link
              to="/company/jobs"
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              &larr; Back to Jobs
            </Link>
            <h2 className="text-3xl font-bold text-gray-800">Job Details</h2>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">{job.internalId || "Job"}</span>{" "}
              <span className="font-semibold text-gray-800">•</span> Customer {job.customerName}{" "}
              <span className="text-gray-400">•</span> Created {formattedDateCreated}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!edit ? (
              <>
                <button
                  onClick={handleSendEstimate}
                  className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl shadow-sm hover:bg-amber-100 transition"
                >
                  Send Estimate
                </button>
                <button
                  onClick={handleMarkEstimateAccepted}
                  className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl shadow-sm hover:bg-green-100 transition"
                >
                  Mark Estimate As Accepted
                </button>
                <button
                  onClick={handleMarkAsInvoiced}
                  className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                >
                  Mark As Invoiced
                </button>
                <button
                  onClick={editJob}
                  className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                >
                  Edit
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={saveEditChanges}
                  className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                >
                  Save
                </button>
                <button
                  onClick={cancelEditJob}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-100 transition"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => {
              const active = t === activeTab;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={[
                    "px-4 py-2 rounded-full text-sm font-semibold transition border",
                    active
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                  ].join(" ")}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

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
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {!edit ? (
                  <StatCard
                    title="Customer Price"
                    value={moneyFromCents(job.rate)}
                    subtitle="Saved job rate"
                    tone="blue"
                  />
                ) : (
                  <div className="rounded-xl border p-4 bg-blue-50 border-blue-200 text-blue-800">
                    <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
                      Customer Price
                    </p>

                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm font-bold">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customerPriceInput}
                        onChange={(e) => setCustomerPriceInput(e.target.value)}
                        className="w-full rounded-lg border border-blue-200 bg-white p-2 text-gray-800 font-bold"
                        placeholder="0.00"
                      />
                    </div>

                    <p className="mt-1 text-sm opacity-80">
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

              <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800">Projected PNL</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      Based on customer price, planned labor, and planned material cost.
                    </p>
                  </div>

                  <span
                    className={[
                      "px-3 py-1 text-xs font-bold rounded-full border",
                      projectedProfitCents < 0
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-green-50 text-green-700 border-green-200",
                    ].join(" ")}
                  >
                    {projectedProfitCents < 0 ? "Projected Loss" : "Projected Profit"}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <StatCard
                    title="Customer Price"
                    value={moneyFromCents(job.rate)}
                    subtitle="Job rate"
                    tone="blue"
                  />

                  <StatCard
                    title="Planned Labor"
                    value={moneyFromCents(plannedTotalLaborCents)}
                    subtitle={`${moneyFromCents(plannedStopLaborCents)} stops • ${moneyFromCents(plannedTaskLaborCents)} tasks`}
                  />

                  <StatCard
                    title="Planned Materials"
                    value={moneyFromCents(plannedMaterialCostCents)}
                    subtitle={`${moneyFromCents(plannedMaterialPriceCents)} planned billable`}
                    tone="amber"
                  />

                  <StatCard
                    title="Projected Profit"
                    value={moneyFromCents(projectedProfitCents)}
                    subtitle={`${cents(job.rate) > 0 ? ((projectedProfitCents / cents(job.rate)) * 100).toFixed(1) : "0.0"}% margin`}
                    tone={projectedProfitCents < 0 ? "red" : "green"}
                  />
                </div>
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
                    <Link
                      to={`/company/laborContracts/createNew/${jobId}`}
                      className="w-full py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition text-center"
                    >
                      Create Labor Contract
                    </Link>
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
                      <td className="p-6 text-gray-500" colSpan={9}>
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
              <Link
                to={`/company/laborContracts/createNew/${jobId}`}
                className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition text-center"
              >
                Create Labor Contract
              </Link>
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

              <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
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

                    {requiresShoppingCustomDetails && (
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

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {purchasedItems.length}
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
                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {workOffers.length} total
                  </span>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-green-50 text-green-700 border border-green-200">
                    {workOffers.filter((offer) => offer.status === "Accepted" || offer.status === "accepted").length} accepted
                  </span>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {workOffers.filter((offer) => !offer.status || offer.status === "Pending" || offer.status === "pending" || offer.status === "Open" || offer.status === "open").length} pending
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
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
                  value={String(workOffers.filter((offer) => offer.isBoardPost).length)}
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
                    Display-only for now. Create and edit work offers from iOS until the web form is built.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {!workOffers.length ? (
                  <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                    <p className="text-gray-700 font-medium">No work offers yet.</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Offers created on iOS will appear here once connected to this job.
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
                <p className="text-gray-600 mt-1">Service stops and labor contracts</p>
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
                <h4 className="font-bold text-gray-800">Labor Contracts</h4>
                <p className="text-gray-600 mt-1 text-sm">Create a labor contract for contractors.</p>

                <div className="mt-4">
                  <Link
                    to={`/company/laborContracts/createNew/${jobId}`}
                    className="inline-flex items-center justify-center py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                  >
                    Create Labor Contract
                  </Link>
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
                    Actual payroll and purchased material cost connected to this job.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {actualPayLineItems.length} payroll line(s)
                  </span>

                  <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                    {purchasedItems.length} purchased item(s)
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard
                  title="Customer Price"
                  value={moneyFromCents(job.rate)}
                  subtitle="Saved job rate"
                  tone="blue"
                />

                <StatCard
                  title="Actual Payroll"
                  value={moneyFromCents(actualPayrollTotalCents)}
                  subtitle="Payroll line items"
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
                  subtitle="Customer price minus actual payroll and materials"
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
                      Payroll line items created from service stops, tasks, or adjustments.
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
                    disabled={!selectedContract}
                    className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition disabled:opacity-50"
                  >
                    Send Estimate
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
                    disabled={!selectedContract}
                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
                  >
                    Mark Invoiced
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
                    disabled={!selectedContract}
                    className="px-4 py-3 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition disabled:opacity-50"
                  >
                    Send Estimate
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
                    disabled={!selectedContract}
                    className="px-4 py-3 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition disabled:opacity-50"
                  >
                    Mark Invoiced
                  </button>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                  title="Customer Price"
                  value={moneyFromCents(job.rate)}
                  subtitle="Saved job rate"
                  tone="blue"
                />

                <StatCard
                  title="Projected Cost"
                  value={moneyFromCents(plannedTotalCostCents)}
                  subtitle={`${moneyFromCents(plannedTotalLaborCents)} labor • ${moneyFromCents(plannedMaterialCostCents)} materials`}
                  tone="amber"
                />

                <StatCard
                  title="Projected Profit"
                  value={moneyFromCents(projectedProfitCents)}
                  subtitle={`${projectedMarginPercent}% margin`}
                  tone={projectedProfitCents < 0 ? "red" : "green"}
                />

                <StatCard
                  title="Latest Estimate"
                  value={latestContract ? moneyFromCents(latestContract.rate) : "—"}
                  subtitle={`${contracts.length} estimate version(s)`}
                />
                <StatCard
                  title="Planned Support"
                  value={moneyFromCents(plannedBillingSupportCents)}
                  subtitle={`${moneyFromCents(plannedTotalLaborCents)} labor • ${moneyFromCents(plannedMaterialPriceCents)} billable materials`}
                  tone="blue"
                />

                <StatCard
                  title="Planned Billable Materials"
                  value={moneyFromCents(plannedMaterialPriceCents)}
                  subtitle={`${shoppingList.length} planned material item(s)`}
                  tone="blue"
                />

                <StatCard
                  title="Actual Cost"
                  value={moneyFromCents(actualPayrollTotalCents + actualPurchasedMaterialCostCents)}
                  subtitle={`${moneyFromCents(actualPayrollTotalCents)} payroll • ${moneyFromCents(actualPurchasedMaterialCostCents)} materials`}
                  tone="amber"
                />

                <StatCard
                  title="Actual Profit"
                  value={moneyFromCents(actualProfitCents)}
                  subtitle={`${actualMarginPercent}% margin`}
                  tone={actualProfitCents < 0 ? "red" : "green"}
                />

                <StatCard
                  title="Pending Acceptance"
                  value={pendingAcceptanceContract ? "Yes" : "No"}
                  subtitle={pendingAcceptanceContract ? "Estimate is out for approval" : "No pending estimate"}
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
                  <h4 className="text-lg font-bold text-gray-800">Lifecycle Guidance</h4>
                  <p className="text-gray-600 mt-1 text-sm">
                    Recommended progression for this job
                  </p>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {contractStatusOptions.map((status) => (
                      <span
                        key={status}
                        className={`px-3 py-2 rounded-full text-xs font-bold ${getStatusClass(status)}`}
                      >
                        {status}
                      </span>
                    ))}
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="font-semibold text-gray-800">1. Draft / Send</p>
                      <p className="mt-1 text-sm text-gray-600">
                        Build the scope, total, terms, and send the estimate.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="font-semibold text-gray-800">2. Accept / Schedule</p>
                      <p className="mt-1 text-sm text-gray-600">
                        Once accepted, move job into scheduling and execution.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="font-semibold text-gray-800">3. Invoice / Paid</p>
                      <p className="mt-1 text-sm text-gray-600">
                        Convert the accepted contract into invoice and payment tracking.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
      {edit && (
        <button
          onClick={deleteJob}
          className="w-full px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
        >
          Delete
        </button>
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
                    Job Id
                  </label>
                  <h1 className="w-full p-3 border border-gray-300 rounded-lg">{contractForm.jobId}</h1>
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
