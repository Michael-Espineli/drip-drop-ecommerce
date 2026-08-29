import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import {
    query,
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    where,
    arrayUnion,
    Timestamp,
    serverTimestamp,
    orderBy,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import Select from "react-select";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { REPAIR_REQUEST_STATUS } from "../../../utils/models/RepairRequest";
import {
    canonicalJobTaskType,
    isInstallOrReplaceTaskType,
    jobTaskTypeOptionsFromDocs,
    taskTypeRequiresBodyOfWater,
    taskTypeRequiresEquipment,
    taskTypeRequiresInstallItem,
} from "../../../utils/jobTaskTypes";
import {
    SUGGESTED_WORK_STATUS,
} from "../../../utils/models/SuggestedWork";
import {
    DEFAULT_ISSUE_PRIORITY,
    ISSUE_PRIORITY_OPTIONS,
    JOB_PLAN_TIER,
    JOB_PLAN_STATUS,
    JOB_PLAN_TIER_OPTIONS,
    getIssuePriorityLabel,
    getJobPlanRecommendationDisplay,
    getJobPlanRecommendationLabel,
    normalizeIssuePriority,
    normalizeJobPlanTier,
} from "../../../utils/models/JobPlan";
import {
    SalesCatalogBillingBehavior,
    SalesCatalogItemType,
    SalesCatalogSourceType,
} from "../../../utils/models/Sales";
import { appAlert, appConfirm } from "../../../utils/appDialog";
import { itemPhotoFieldsFromSource } from "../../../utils/itemPhotos";
import {
    filterCompanyUserAdminOptions,
    getCompanyUserDisplayName,
    sortCompanyUsersByName,
} from "../../../utils/companyUsers";
import EquipmentCatalogPicker from "../../components/equipment/EquipmentCatalogPicker";
import {
    EQUIPMENT_DATABASE_CATEGORY,
    databaseEquipmentMappingFromItem,
    databaseEquipmentMappingPatch,
    emptyDatabaseEquipmentMapping,
    equipmentDatabaseItemLabel,
    hasDatabaseEquipmentMapping,
    isEquipmentDatabaseItem,
} from "../../../utils/databaseEquipmentItems";

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
        <div className={`rounded-lg border p-4 ${toneClass}`}>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
                {title}
            </p>
            <p className="mt-1 text-xl font-bold">{value}</p>
            {subtitle && <p className="mt-1 text-sm opacity-80">{subtitle}</p>}
        </div>
    );
};

const SectionCard = ({ title, subtitle, children, action }) => (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
            <div>
                <h3 className="text-base font-semibold text-slate-950">{title}</h3>
                {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
            </div>
            {action}
        </div>
        <div className="mt-4">{children}</div>
    </section>
);

const buildEquipmentDatabaseItemOption = (data = {}, docId = "") => {
    const id = data.id || docId;
    return {
        id,
        value: id,
        label: equipmentDatabaseItemLabel({ ...data, id }),
        name: data.name || "Equipment item",
        category: data.category || "",
        dbItemId: id,
        itemId: id,
        ...databaseEquipmentMappingPatch(databaseEquipmentMappingFromItem(data)),
    };
};

const templateContextValues = (item = {}) => [
    item.name,
    item.title,
    item.type,
    item.jobType,
    item.taskType,
    item.taskTypeName,
    item.catalogItemName,
].filter(Boolean);

const itemRequiresEquipmentContext = (item = {}) => (
    templateContextValues(item).some((value) => taskTypeRequiresEquipment(value))
);

const itemRequiresBodyOfWaterContext = (item = {}) => (
    templateContextValues(item).some((value) => taskTypeRequiresBodyOfWater(value))
);

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

const getTemplateDefaultIssuePriority = (template = {}) => normalizeIssuePriority(
    template.defaultIssuePriorityLevel ??
    template.issuePriorityLevel ??
    template.priorityLevel ??
    template.solutionTier ??
    DEFAULT_ISSUE_PRIORITY
);

const DEFAULT_STARTER_PLAN_TIER = JOB_PLAN_TIER.MINIMUM_REPAIR;

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

const laborLineQuantityNumber = (value) => {
    const amount = Number(value || 1);
    return Number.isFinite(amount) && amount > 0 ? amount : 1;
};

const laborLineTotalPriceCents = (line = {}) => {
    const quantity = laborLineQuantityNumber(line.quantity || line.defaultQuantity || 1);
    const explicitTotal = line.totalPriceCents ?? line.totalAmountCents ?? line.amount ?? line.price;
    if (explicitTotal !== undefined && explicitTotal !== null && explicitTotal !== "") return Number(explicitTotal || 0);
    return Math.round(Number(line.unitPriceCents ?? line.unitAmountCents ?? line.rateAmountCents ?? line.rate ?? 0) * quantity);
};

const laborLineUnitPriceCents = (line = {}) => {
    const quantity = laborLineQuantityNumber(line.quantity || line.defaultQuantity || 1);
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

const CreateNewJob = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const { recentlySelectedCompany, dataBaseUser, currentUser, user } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const {
        customerId: customerIdParam,
        locationId: locationIdParam,
        templateId: templateIdParam,
    } = useParams();

    const repairRequest = location.state?.repairRequest || null;
    const suggestedWork = location.state?.suggestedWork || null;
    const repairRequestSourcePath =
        location.state?.repairRequestSourcePath ||
        repairRequest?.sourcePath ||
        "company";
    const equipmentContext = location.state?.equipmentContext || null;
    const customerContext = location.state?.customerContext || null;
    const leadContext = location.state?.leadContext || null;
    const leadSourcePath = location.state?.leadSourcePath || (leadContext?.id ? "homeownerServiceRequests" : "");
    const jobIntent = location.state?.jobIntent || equipmentContext?.jobIntent || "";
    const createdFromCustomerDetail = Boolean(location.state?.createdFromCustomerDetail);
    const createdFromEquipmentCard = Boolean(location.state?.createdFromEquipmentCard);
    const createdFromEquipmentDetail = Boolean(location.state?.createdFromEquipmentDetail);
    const startingTemplateFromState =
        location.state?.startingTemplate ||
        location.state?.jobTemplate ||
        location.state?.template ||
        null;
    const startingTemplateIdFromState = location.state?.templateId || "";

    const loggedInUser = currentUser || user || {};
    const createdByUserId = dataBaseUser?.id || loggedInUser?.uid || loggedInUser?.id || "";
    const createdByUserName =
        `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
        loggedInUser?.displayName ||
        loggedInUser?.userName ||
        "Unknown";

    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showMissingJobInfoModal, setShowMissingJobInfoModal] = useState(false);

    const [jobId] = useState(() => `comp_wo_${uuidv4()}`);
    const [internalId, setInternalId] = useState("");

    const [adminList, setAdminList] = useState([]);
    const [customerList, setCustomerList] = useState([]);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [equipmentDatabaseItems, setEquipmentDatabaseItems] = useState([]);

    const [jobTemplateList, setJobTemplateList] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [templateApplied, setTemplateApplied] = useState(false);
    const [loadingTemplate, setLoadingTemplate] = useState(false);

    const [taskTypeList, setTaskTypeList] = useState([]);
    const [taskGroupList, setTaskGroupList] = useState([]);
    const [selectedTaskGroup, setSelectedTaskGroup] = useState(null);

    const [selectedAdmin, setSelectedAdmin] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedServiceLocation, setSelectedServiceLocation] = useState(null);
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
    const [selectedEquipment, setSelectedEquipment] = useState(null);

    const [description, setDescription] = useState("");
    const [rate, setRate] = useState("0");
    const [laborCost, setLaborCost] = useState("0");
    const [issuePriorityLevel, setIssuePriorityLevel] = useState(
        normalizeIssuePriority(suggestedWork?.priorityLevel || suggestedWork?.solutionTier || DEFAULT_ISSUE_PRIORITY)
    );
    const [starterPlanTier, setStarterPlanTier] = useState(DEFAULT_STARTER_PLAN_TIER);

    const [taskList, setTaskList] = useState([]);
    const [plannedServiceStops, setPlannedServiceStops] = useState([]);
    const [shoppingList, setShoppingList] = useState([]);
    const [laborLineItems, setLaborLineItems] = useState([]);

    const [selectedTaskType, setSelectedTaskType] = useState(null);
    const [selectedTaskBodyOfWater, setSelectedTaskBodyOfWater] = useState(null);
    const [selectedTaskEquipment, setSelectedTaskEquipment] = useState(null);
    const [taskDescription, setTaskDescription] = useState("");
    const [taskLaborCost, setTaskLaborCost] = useState("");
    const [taskBillingLaborPrice, setTaskBillingLaborPrice] = useState("");
    const [estimatedTime, setEstimatedTime] = useState("");
    const [selectedTaskDbItemId, setSelectedTaskDbItemId] = useState("");
    const [selectedTaskDbItemEquipmentMapping, setSelectedTaskDbItemEquipmentMapping] = useState(() => emptyDatabaseEquipmentMapping());

    const createJobSections = ["Info", "Template", "Tasks", "Materials", "Schedule", "Review"];
    const [activeCreateSection, setActiveCreateSection] = useState("Info");

    const moneyFromCents = (value) =>
        new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format((Number(value || 0) || 0) / 100);

    const dollarsToCents = (value) => {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) return 0;
        return Math.round(n * 100);
    };

    const equipmentDatabaseItemById = useMemo(() => (
        new Map(equipmentDatabaseItems.map((item) => [item.id, item]))
    ), [equipmentDatabaseItems]);
    const selectedTaskTypeValue = canonicalJobTaskType(selectedTaskType?.value || selectedTaskType?.name || "");
    const taskNeedsBodyOfWater = taskTypeRequiresBodyOfWater(selectedTaskTypeValue);
    const taskNeedsEquipment = taskTypeRequiresEquipment(selectedTaskTypeValue);
    const taskNeedsInstallItem = taskTypeRequiresInstallItem(selectedTaskTypeValue);
    const taskNeedsEquipmentDatabaseItem = isInstallOrReplaceTaskType(selectedTaskTypeValue);
    const selectedTaskDbItem = selectedTaskDbItemId
        ? equipmentDatabaseItemById.get(selectedTaskDbItemId) || null
        : null;
    const taskBodyOfWaterOptions = bodyOfWaterList;
    const taskEquipmentOptions = equipmentList;
    const bodyOfWaterById = useMemo(() => (
        new Map(bodyOfWaterList.map((item) => [item.id, item]))
    ), [bodyOfWaterList]);
    const equipmentById = useMemo(() => (
        new Map(equipmentList.map((item) => [item.id, item]))
    ), [equipmentList]);

    const rateCents = useMemo(() => dollarsToCents(rate), [rate]);
    const laborCostCents = useMemo(() => dollarsToCents(laborCost), [laborCost]);

    const plannedStopLaborCents = useMemo(() => {
        return plannedServiceStops.reduce(
            (total, stop) => total + Number(stop.plannedLaborCostCents || 0),
            0
        );
    }, [plannedServiceStops]);

    const plannedTaskLaborCents = useMemo(() => {
        return taskList.reduce(
            (total, task) => total + Number(task.contractedRate || 0),
            0
        );
    }, [taskList]);

    const plannedTaskBillingLaborCents = useMemo(() => {
        return taskList.reduce(
            (total, task) => total + getTaskBillingLaborPriceCents(task),
            0
        );
    }, [taskList]);

    const plannedLaborLinePriceCents = useMemo(() => {
        return laborLineItems.reduce(
            (total, line) => total + laborLineTotalPriceCents(line),
            0
        );
    }, [laborLineItems]);

    const plannedLaborLineCostCents = useMemo(() => {
        return laborLineItems.reduce(
            (total, line) => total + laborLineInternalCostCents(line),
            0
        );
    }, [laborLineItems]);

    const plannedTotalLaborCents = useMemo(() => {
        return laborLineItems.length ? plannedLaborLineCostCents : plannedStopLaborCents + plannedTaskLaborCents;
    }, [laborLineItems.length, plannedLaborLineCostCents, plannedStopLaborCents, plannedTaskLaborCents]);

    const plannedMaterialCostCents = useMemo(() => {
        return shoppingList.reduce(
            (total, item) => total + Number(item.plannedTotalCostCents || 0),
            0
        );
    }, [shoppingList]);

    const plannedMaterialPriceCents = useMemo(() => {
        return shoppingList.reduce(
            (total, item) => total + Number(item.plannedTotalPriceCents || 0),
            0
        );
    }, [shoppingList]);

    const calculatedPlanPriceCents = useMemo(() => {
        const laborPrice = laborLineItems.length
            ? plannedLaborLinePriceCents
            : plannedStopLaborCents + plannedTaskBillingLaborCents;
        const calculated = laborPrice + plannedMaterialPriceCents;
        return calculated || rateCents;
    }, [
        laborLineItems.length,
        plannedLaborLinePriceCents,
        plannedStopLaborCents,
        plannedTaskBillingLaborCents,
        plannedMaterialPriceCents,
        rateCents,
    ]);

    const calculatedPlanInternalCostCents = useMemo(() => {
        return plannedTotalLaborCents + plannedMaterialCostCents;
    }, [plannedTotalLaborCents, plannedMaterialCostCents]);

    const projectedProfitCents = useMemo(() => {
        return calculatedPlanPriceCents - calculatedPlanInternalCostCents;
    }, [calculatedPlanPriceCents, calculatedPlanInternalCostCents]);

    const selectedTemplateRequiresEquipment = useMemo(() => {
        if (!selectedTemplate) return false;
        return (
            itemRequiresEquipmentContext(selectedTemplate) ||
            taskList.some(itemRequiresEquipmentContext) ||
            laborLineItems.some(itemRequiresEquipmentContext)
        );
    }, [laborLineItems, selectedTemplate, taskList]);

    const selectedTemplateRequiresBodyOfWater = useMemo(() => {
        if (!selectedTemplate) return false;
        return (
            itemRequiresBodyOfWaterContext(selectedTemplate) ||
            taskList.some(itemRequiresBodyOfWaterContext) ||
            laborLineItems.some(itemRequiresBodyOfWaterContext)
        );
    }, [laborLineItems, selectedTemplate, taskList]);

    const resolvedBodyOfWaterId = selectedBodyOfWater?.id || selectedEquipment?.bodyOfWaterId || "";

    const canCreateJob =
        !!recentlySelectedCompany &&
        !!selectedAdmin?.id &&
        !!selectedCustomer?.id &&
        !!selectedServiceLocation?.id &&
        (!selectedTemplateRequiresEquipment || !!selectedEquipment?.id) &&
        (!selectedTemplateRequiresBodyOfWater || !!resolvedBodyOfWaterId);

    const missingJobInfo = useMemo(() => {
        const missing = [];

        if (!recentlySelectedCompany) {
            missing.push("Company");
        }

        if (!selectedAdmin?.id) {
            missing.push("Admin");
        }

        if (!selectedCustomer?.id) {
            missing.push("Customer");
        }

        if (!selectedServiceLocation?.id) {
            missing.push("Service Location");
        }

        if (selectedTemplateRequiresEquipment && !selectedEquipment?.id) {
            missing.push("Equipment");
        }

        if (selectedTemplateRequiresBodyOfWater && !resolvedBodyOfWaterId) {
            missing.push("Body Of Water");
        }

        return missing;
    }, [
        recentlySelectedCompany,
        resolvedBodyOfWaterId,
        selectedAdmin,
        selectedCustomer,
        selectedEquipment,
        selectedServiceLocation,
        selectedTemplateRequiresBodyOfWater,
        selectedTemplateRequiresEquipment,
    ]);

    const createJobSectionDetails = {
        Info: {
            label: "Job Info",
            helper: "Assignment, customer, location, asset context, and pricing",
            count: missingJobInfo.length ? String(missingJobInfo.length) : "Ready",
        },
        Template: {
            label: "Template",
            helper: "Reusable job scope, services, tasks, and planned products",
            count: selectedTemplate ? "1" : "",
        },
        Tasks: {
            label: "Tasks",
            helper: "Labor tasks and task-specific pool or equipment context",
            count: String(taskList.length),
        },
        Materials: {
            label: "Materials",
            helper: "Planned shopping list items and material pricing",
            count: String(shoppingList.length),
        },
        Schedule: {
            label: "Schedule",
            helper: "Planned service stops copied or staged for this job",
            count: String(plannedServiceStops.length),
        },
        Review: {
            label: "Review",
            helper: "Confirm the job before creating it",
            count: canCreateJob ? "Ready" : String(missingJobInfo.length),
        },
    };
    const createJobSectionMeta = createJobSections.map((sectionName) => ({
        id: sectionName,
        ...createJobSectionDetails[sectionName],
    }));
    const activeCreateSectionMeta =
        createJobSectionMeta.find((section) => section.id === activeCreateSection) ||
        createJobSectionMeta[0];
    const activeCreateSectionIndex = createJobSections.indexOf(activeCreateSection);
    const previousCreateSection =
        activeCreateSectionIndex > 0 ? createJobSections[activeCreateSectionIndex - 1] : "";
    const nextCreateSection =
        activeCreateSectionIndex >= 0 && activeCreateSectionIndex < createJobSections.length - 1
            ? createJobSections[activeCreateSectionIndex + 1]
            : "";

    const selectStyles = {
        control: (provided, state) => ({
            ...provided,
            backgroundColor: "white",
            border: state.isFocused ? "1px solid #2563eb" : "1px solid #d1d5db",
            borderRadius: "0.375rem",
            minHeight: 42,
            boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.18)" : "none",
            "&:hover": {
                borderColor: state.isFocused ? "#2563eb" : "#9ca3af",
            },
        }),
        menu: (provided) => ({
            ...provided,
            zIndex: 50,
            borderRadius: "0.375rem",
            overflow: "hidden",
        }),
    };

    const fieldLabelClasses = "mb-2 block text-sm font-semibold text-slate-700";
    const fieldInputClasses = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

    const getCustomerDisplayName = (customer) => {
        if (!customer) return "";
        if (customer.displayAsCompany && customer.companyName) return customer.companyName;
        return `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
    };

    const getAdminIdForJob = (admin) => {
        return admin?.userId || admin?.id || "";
    };

    const getAdminNameForJob = (admin) => {
        return admin?.userName || admin?.name || admin?.label || "";
    };

    const normalizeJobTask = (task, overrides = {}) => {
        return {
            id: task.id || `comp_job_task_${uuidv4()}`,
            name: task.name || task.description || "",
            type: canonicalJobTaskType(task.type || ""),
            contractedRate: Number(task.contractedRate || 0),
            billingLaborPriceCents: getTaskBillingLaborPriceCents(task),
            estimatedTime: Number(task.estimatedTime || 0),
            status: task.status || "Draft",

            customerApproval: Boolean(task.customerApproval || false),
            actualTime: Number(task.actualTime || 0),

            workerId: task.workerId || "",
            workerType: task.workerType || "Not Assigned",
            workerName: task.workerName || "",

            laborContractId: task.laborContractId || "",
            serviceStopId: task.serviceStopId || {
                id: "",
                internalId: "",
            },

            equipmentId: task.equipmentId || "",
            serviceLocationId: task.serviceLocationId || "",
            bodyOfWaterId: task.bodyOfWaterId || "",
            dataBaseItemId: task.dataBaseItemId || "",
            shoppingListItemId: task.shoppingListItemId || "",
            shoppingListItemIds: Array.isArray(task.shoppingListItemIds) ? task.shoppingListItemIds : [],

            ...overrides,
        };
    };

    const normalizeShoppingItemForJob = (item, overrides = {}) => {
        const photoFields = itemPhotoFieldsFromSource(item, item.name || item.dbItemName || "Shopping item photo");

        return {
            id: item.id || `comp_shop_${uuidv4()}`,

            category: "Job",
            subCategory: item.subCategory || "Custom",
            status: "Need to Purchase",
            purchaserId: item.purchaserId || createdByUserId || "",
            purchaserName: item.purchaserName || createdByUserName || "",

            genericItemId: item.genericItemId || "",
            name: item.name || "",
            description: item.description || "",
            datePurchased: null,
            quantity: item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "",

            jobId,
            customerId: "",
            customerName: "",

            userId: "",
            userName: "",

            dbItemId: item.dbItemId || "",
            purchasedItem: "",
            invoiced: false,

            plannedUnitCostCents: item.plannedUnitCostCents ?? null,
            plannedUnitPriceCents: item.plannedUnitPriceCents ?? null,
            plannedTotalCostCents: item.plannedTotalCostCents ?? null,
            plannedTotalPriceCents: item.plannedTotalPriceCents ?? null,

            // Legacy web fields for compatibility
            cost: item.plannedUnitCostCents ?? item.cost ?? 0,
            price: item.plannedUnitPriceCents ?? item.price ?? 0,
            itemId: item.dbItemId || item.itemId || "",
            itemType: item.subCategory || item.itemType || "Custom",
            ...photoFields,

            ...overrides,
        };
    };

    const normalizePlannedStopForJob = (stop, taskIdMap = {}) => {
        const originalTaskIds = Array.isArray(stop.taskTemplateIds)
            ? stop.taskTemplateIds
            : Array.isArray(stop.taskIds)
                ? stop.taskIds
                : [];

        return {
            id: `comp_job_plan_stop_${uuidv4()}`,
            companyId: recentlySelectedCompany,
            jobId,
            sourceTemplateId: stop.sourceTemplateId || selectedTemplate?.id || "",
            sourceTemplatePlannedStopId: stop.sourceTemplatePlannedStopId || stop.sourcePlannedStopId || stop.id || "",

            name: stop.name || stop.serviceStopTypeName || "Planned Stop",
            description: stop.description || "",

            serviceStopTypeId: stop.serviceStopTypeId || "",
            serviceStopTypeName: stop.serviceStopTypeName || "",
            serviceStopTypeImage: stop.serviceStopTypeImage || "",

            serviceStopTypeUseCaseRawValue: stop.serviceStopTypeUseCaseRawValue || "",

            estimatedMinutes: Number(stop.estimatedMinutes || 0),
            sortOrder: Number(stop.sortOrder || 0),

            taskIds: originalTaskIds.map((id) => taskIdMap[id]).filter(Boolean),

            plannedLaborCostCents:
                stop.plannedLaborCostCents !== undefined && stop.plannedLaborCostCents !== null
                    ? Number(stop.plannedLaborCostCents)
                    : null,
            plannedLaborNotes: stop.plannedLaborNotes || "",
            equipmentId: stop.equipmentId || "",
            serviceLocationId: stop.serviceLocationId || "",
            bodyOfWaterId: stop.bodyOfWaterId || "",

            createdAt: Timestamp.fromDate(new Date()),
            createdByUserId: createdByUserId || "",
        };
    };

    const quantityNumber = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };

    const plannedMaterialTotalCostCents = (item) => {
        if (item.plannedTotalCostCents !== undefined && item.plannedTotalCostCents !== null) {
            return Number(item.plannedTotalCostCents || 0);
        }

        return Math.round(Number(item.plannedUnitCostCents || item.cost || 0) * quantityNumber(item.quantity));
    };

    const plannedMaterialTotalPriceCents = (item) => {
        if (item.plannedTotalPriceCents !== undefined && item.plannedTotalPriceCents !== null) {
            return Number(item.plannedTotalPriceCents || 0);
        }

        return Math.round(Number(item.plannedUnitPriceCents || item.price || 0) * quantityNumber(item.quantity));
    };

    const buildStarterPlanLineItems = ({
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
                    id: `${planId}_${line.id || "labor_line"}`,
                    catalogItemId,
                    salesCatalogItemId: catalogItemId,
                    sourceType: line.sourceType || SalesCatalogSourceType.manual,
                    sourceId: line.sourceId || catalogItemId || line.id || "",
                    salesItemType,
                    billingBehavior: line.billingBehavior || SalesCatalogBillingBehavior.oneTime,
                    type: line.type || lineType,
                    name: line.name || `Service ${index + 1}`,
                    description: [
                        line.description || "",
                        line.taskIds?.length ? `${line.taskIds.length} task${line.taskIds.length === 1 ? "" : "s"}` : "",
                    ].filter(Boolean).join(" - "),
                    quantity,
                    unitAmountCents: Number(line.unitPriceCents || 0),
                    totalAmountCents: amount,
                    amount,
                    billingLaborPriceCents: amount,
                    internalLaborCostCents: Number(line.internalCostCents || 0),
                    taskIds: line.taskIds || [],
                    plannedServiceStopIds: line.plannedServiceStopIds || [],
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
                        id: `${planId}_${stop.id || "planned_stop"}`,
                        sourceType: SalesCatalogSourceType.serviceStopType,
                        sourceId: stop.serviceStopTypeId || stop.id || "",
                        salesItemType: SalesCatalogItemType.service,
                        billingBehavior: SalesCatalogBillingBehavior.oneTime,
                        type: "Planned Stop",
                        name: stop.name || stop.serviceStopTypeName || "Planned Service Stop",
                        description: stop.description || stop.plannedLaborNotes || "",
                        quantity: 1,
                        unitAmountCents: amount,
                        totalAmountCents: amount,
                        amount,
                        taxable: false,
                        displayAmount: moneyFromCents(amount),
                    };
                }),
                ...normalizedTasks.map((task) => {
                    const amount = getTaskBillingLaborPriceCents(task);
                    const internalLaborCostCents = Number(task.contractedRate || 0);
                    return {
                        id: `${planId}_${task.id || "task"}`,
                        sourceType: SalesCatalogSourceType.task,
                        sourceId: task.id || "",
                        salesItemType: SalesCatalogItemType.labor,
                        billingBehavior: SalesCatalogBillingBehavior.oneTime,
                        type: "Task",
                        name: task.name || task.description || task.type || "Task",
                        description: task.type || "",
                        quantity: 1,
                        unitAmountCents: amount,
                        totalAmountCents: amount,
                        amount,
                        billingLaborPriceCents: amount,
                        internalLaborCostCents,
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
                id: `${planId}_${item.id || "material"}`,
                sourceType: item.dbItemId || item.itemId ? "databaseItem" : "shoppingListItem",
                sourceId: item.dbItemId || item.itemId || item.id || "",
                salesItemType: "material",
                billingBehavior: "oneTime",
                type: "Material",
                name: item.name || "Material",
                description: item.description || "",
                quantity,
                unitAmountCents,
                totalAmountCents: amount,
                amount,
                taxable: Boolean(item.taxable),
                displayAmount: moneyFromCents(amount),
            };
        }),
    ]).filter((item) => item.totalAmountCents > 0 || item.name);

    const buildStarterPlanRecord = ({
        planId,
        nextInternalId,
        customerName,
        issuePriority,
        issuePriorityLabel,
        planTierValue,
        planTierLabel,
        normalizedTasks,
        normalizedPlannedStops,
        normalizedShoppingItems,
        normalizedLaborLineItems = [],
        nowTimestamp,
        nowMillis,
    }) => {
        const lineItems = buildStarterPlanLineItems({
            planId,
            normalizedTasks,
            normalizedPlannedStops,
            normalizedShoppingItems,
            normalizedLaborLineItems,
        });
        const subtotalAmountCents = lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
        const totalAmountCents = subtotalAmountCents || rateCents;
        const planLaborCostCents = normalizedLaborLineItems.length
            ? normalizedLaborLineItems.reduce((total, line) => total + Number(line.internalCostCents || 0), 0)
            : normalizedTasks.reduce((total, task) => total + Number(task.contractedRate || 0), 0)
                + normalizedPlannedStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
        const planLaborPriceCents = normalizedLaborLineItems.length
            ? normalizedLaborLineItems.reduce((total, line) => total + Number(line.totalPriceCents || 0), 0)
            : normalizedTasks.reduce((total, task) => total + getTaskBillingLaborPriceCents(task), 0)
                + normalizedPlannedStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
        const materialCostCents = normalizedShoppingItems.reduce((total, item) => total + plannedMaterialTotalCostCents(item), 0);
        const materialPriceCents = normalizedShoppingItems.reduce((total, item) => total + plannedMaterialTotalPriceCents(item), 0);
        const internalCostCents = planLaborCostCents + materialCostCents;
        const projectedProfitCents = totalAmountCents - internalCostCents;
        const profitMarginPercent = totalAmountCents > 0
            ? Math.round((projectedProfitCents / totalAmountCents) * 1000) / 10
            : 0;
        const starterPlanName = selectedTemplate?.name
            ? `${selectedTemplate.name} Plan`
            : "Starter Plan";

        return {
            id: planId,
            planId,
            solutionId: planId,
            companyId: recentlySelectedCompany,
            jobId,
            jobInternalId: nextInternalId,
            customerId: selectedCustomer.id,
            customerName,
            serviceLocationId: selectedServiceLocation.id,
            serviceLocationName: selectedServiceLocation.label || "",
            bodyOfWaterId: resolvedBodyOfWaterId,
            bodyOfWaterName: selectedBodyOfWater?.label || selectedBodyOfWater?.name || selectedEquipment?.bodyOfWaterName || "",
            equipmentId: selectedEquipment?.id || "",
            equipmentName: selectedEquipment?.label || "",
            sourceType: selectedTemplate?.id ? "template" : "initialJobPlan",
            sourceTemplateId: selectedTemplate?.id || "",
            sourceTemplateName: selectedTemplate?.name || "",
            title: starterPlanName,
            name: starterPlanName,
            planName: starterPlanName,
            description: description || "",
            status: JOB_PLAN_STATUS.DRAFT,
            planTier: planTierValue,
            planTierLabel,
            solutionTier: planTierValue,
            solutionTierLabel: planTierLabel,
            recommendationRank: planTierValue,
            recommendationRankLabel: planTierLabel,
            issuePriorityLevel: issuePriority,
            issuePriorityLabel,
            isActivePlan: true,
            isAccepted: false,
            rateAmountCents: totalAmountCents,
            totalAmountCents,
            subtotalAmountCents,
            laborCostCents: planLaborCostCents || laborCostCents,
            plannedLaborCostCents: planLaborCostCents,
            plannedLaborPriceCents: planLaborPriceCents,
            materialCostCents,
            materialPriceCents,
            internalCostCents,
            projectedProfitCents,
            profitMarginPercent,
            scopeOfWork: {
                title: starterPlanName,
                customerDescription: description || "",
                issueDescription: description || "",
                taskSummaries: normalizedTasks.map((task, index) => ({
                    id: task.id || "",
                    sortOrder: Number(task.sortOrder ?? index),
                    name: task.name || task.description || `Task ${index + 1}`,
                    type: task.type || "",
                    estimatedMinutes: Number(task.estimatedTime || 0),
                    plannedLaborCostCents: Number(task.contractedRate || 0),
                    billingLaborPriceCents: getTaskBillingLaborPriceCents(task),
                })),
                plannedStopSummaries: normalizedPlannedStops.map((stop, index) => ({
                    id: stop.id || "",
                    sortOrder: Number(stop.sortOrder ?? index),
                    name: stop.name || stop.serviceStopTypeName || `Planned Visit ${index + 1}`,
                    serviceStopTypeId: stop.serviceStopTypeId || "",
                    serviceStopTypeName: stop.serviceStopTypeName || "",
                    estimatedMinutes: Number(stop.estimatedMinutes || 0),
                    plannedLaborCostCents: Number(stop.plannedLaborCostCents || 0),
                    taskIds: Array.isArray(stop.taskIds) ? stop.taskIds : [],
                })),
                laborLineSummaries: normalizedLaborLineItems.map((line, index) => ({
                    id: line.id || "",
                    sortOrder: Number(line.sortOrder ?? index),
                    name: line.name || `Service ${index + 1}`,
                    description: line.description || "",
                    quantity: Number(line.quantity || 1),
                    unitPriceCents: Number(line.unitPriceCents || 0),
                    totalPriceCents: Number(line.totalPriceCents || 0),
                    internalCostCents: Number(line.internalCostCents || 0),
                    catalogItemId: laborLineCatalogItemId(line),
                    taskIds: Array.isArray(line.taskIds) ? line.taskIds : [],
                    plannedServiceStopIds: [],
                })),
                materialSummaries: normalizedShoppingItems.map((item, index) => ({
                    id: item.id || "",
                    sortOrder: Number(item.sortOrder ?? index),
                    name: item.name || item.dbItemName || `Material ${index + 1}`,
                    description: item.description || "",
                    quantity: item.quantity || "1",
                    plannedTotalCostCents: plannedMaterialTotalCostCents(item),
                    plannedTotalPriceCents: plannedMaterialTotalPriceCents(item),
                })),
                counts: {
                    tasks: normalizedTasks.length,
                    plannedServiceStops: normalizedPlannedStops.length,
                    shoppingItems: normalizedShoppingItems.length,
                    laborLineItems: normalizedLaborLineItems.length,
                    lineItems: lineItems.length,
                },
            },
            costSummary: {
                plannedLaborCostCents: planLaborCostCents,
                plannedLaborPriceCents: planLaborPriceCents,
                plannedTaskLaborCents,
                plannedTaskBillingLaborCents,
                plannedServiceStopLaborCostCents: plannedStopLaborCents,
                plannedMaterialCostCents: materialCostCents,
                plannedMaterialPriceCents: materialPriceCents,
                internalCostCents,
            },
            billingSummary: {
                pricingSource: lineItems.length ? "plannedScopeLineItems" : "jobFallbackRate",
                lineItemCount: lineItems.length,
                subtotalAmountCents,
                totalAmountCents,
                plannedLaborPriceCents: planLaborPriceCents,
                plannedTaskBillingLaborCents,
                projectedProfitCents,
                profitMarginPercent,
            },
            tasks: normalizedTasks.map((task, index) => ({
                ...task,
                sortOrder: Number(task.sortOrder ?? index),
                sourcePlanId: planId,
                sourceSolutionId: planId,
            })),
            plannedServiceStops: normalizedPlannedStops.map((stop, index) => ({
                ...stop,
                sortOrder: Number(stop.sortOrder ?? index),
                sourcePlanId: planId,
                sourceSolutionId: planId,
            })),
            shoppingItems: normalizedShoppingItems.map((item, index) => ({
                ...item,
                sortOrder: Number(item.sortOrder ?? index),
                planId,
                sourcePlanId: planId,
                sourceSolutionId: planId,
            })),
            laborLineItems: normalizedLaborLineItems.map((line, index) => ({
                ...line,
                sortOrder: Number(line.sortOrder ?? index),
                sourcePlanId: planId,
                sourceSolutionId: planId,
            })),
            estimateLaborLineItems: normalizedLaborLineItems.map((line, index) => ({
                ...line,
                sortOrder: Number(line.sortOrder ?? index),
                sourcePlanId: planId,
                sourceSolutionId: planId,
            })),
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
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!recentlySelectedCompany) return;

            try {
                setLoading(true);

                const settingsRef = doc(db, "companies", recentlySelectedCompany, "settings", "workOrders");
                const settingsSnap = await getDoc(settingsRef);
                const nextCount = settingsSnap.exists()
                    ? Number(settingsSnap.data().increment || 0) + 1
                    : 1;

                setInternalId(`J${nextCount}`);

                const [
                    adminsSnap,
                    customersSnap,
                    taskTypesSnap,
                    taskGroupsSnap,
                    templatesSnap,
                ] = await Promise.all([
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "companyUsers"))),
                    getDocs(
                        query(
                            collection(db, "companies", recentlySelectedCompany, "customers"),
                            where("active", "==", true)
                        )
                    ),
                    getDocs(query(collection(db, "universal", "settings", "taskTypes"))),
                    getDocs(
                        query(
                            collection(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "settings",
                                "taskGroup",
                                "taskGroup"
                            )
                        )
                    ),
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "jobTemplates"))),
                ]);

                const companyUserOptions = sortCompanyUsersByName(adminsSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const name = getCompanyUserDisplayName(data, "Admin");
                    const id = data.id || docSnap.id;
                    const userId = data.userId || data.uid || id;

                    return {
                        ...data,
                        id,
                        userId,
                        userName: name,
                        label: `${name}${data.roleName ? ` — ${data.roleName}` : ""}`,
                        value: userId,
                    };
                }));
                const admins = filterCompanyUserAdminOptions(companyUserOptions);

                setAdminList(admins);
                setSelectedAdmin((currentAdmin) => {
                    const currentAdminId = currentAdmin?.userId || currentAdmin?.id || "";
                    return admins.find((admin) => admin.userId === currentAdminId || admin.id === currentAdminId) || admins[0] || null;
                });

                const customers = customersSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;
                    const label = getCustomerDisplayName({ ...data, id }) || "Customer";

                    return {
                        ...data,
                        id,
                        value: id,
                        label,
                    };
                });

                setCustomerList(customers);

                setTaskTypeList(jobTaskTypeOptionsFromDocs(taskTypesSnap.docs));

                setTaskGroupList(
                    taskGroupsSnap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        const id = data.id || docSnap.id;
                        const label = data.name || data.groupName || "Task Group";

                        return {
                            ...data,
                            id,
                            label,
                            value: id,
                        };
                    })
                );

                const templates = templatesSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        label: data.name || "Job Template",
                        value: id,
                    };
                });

                setJobTemplateList(templates);

                const startingTemplateId =
                    startingTemplateFromState?.id ||
                    templateIdParam ||
                    startingTemplateIdFromState ||
                    "";

                if (startingTemplateId) {
                    const matched = templates.find((template) => template.id === startingTemplateId);

                    if (matched) {
                        setSelectedTemplate(matched);
                    } else if (startingTemplateFromState?.id) {
                        setSelectedTemplate({
                            ...startingTemplateFromState,
                            label: startingTemplateFromState.name || "Job Template",
                            value: startingTemplateFromState.id,
                        });
                    }
                }
            } catch (error) {
                console.error("Error loading create job data:", error);
                appAlert("Failed to load create job data.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany, startingTemplateFromState, startingTemplateIdFromState, templateIdParam]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setEquipmentDatabaseItems([]);
            return;
        }

        let cancelled = false;

        const loadEquipmentDatabaseItems = async () => {
            try {
                const itemSnap = await getDocs(
                    query(
                        collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
                        orderBy("name")
                    )
                );

                if (cancelled) return;
                setEquipmentDatabaseItems(
                    itemSnap.docs
                        .map((itemDoc) => buildEquipmentDatabaseItemOption(itemDoc.data(), itemDoc.id))
                        .filter(isEquipmentDatabaseItem)
                );
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to load equipment database items:", error);
                    setEquipmentDatabaseItems([]);
                }
            }
        };

        loadEquipmentDatabaseItems();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany]);

    useEffect(() => {
        if (!taskNeedsInstallItem) {
            if (selectedTaskDbItemId) setSelectedTaskDbItemId("");
            setSelectedTaskDbItemEquipmentMapping(emptyDatabaseEquipmentMapping());
            return;
        }

        setSelectedTaskDbItemEquipmentMapping(
            selectedTaskDbItem
                ? databaseEquipmentMappingFromItem(selectedTaskDbItem)
                : emptyDatabaseEquipmentMapping()
        );
    }, [selectedTaskDbItem, selectedTaskDbItemId, taskNeedsInstallItem]);

    useEffect(() => {
        if (!taskNeedsBodyOfWater) setSelectedTaskBodyOfWater(null);
        if (!taskNeedsEquipment) setSelectedTaskEquipment(null);
    }, [taskNeedsBodyOfWater, taskNeedsEquipment]);

    useEffect(() => {
        if (!taskNeedsBodyOfWater || selectedTaskBodyOfWater?.id || !selectedBodyOfWater?.id) return;
        setSelectedTaskBodyOfWater(selectedBodyOfWater);
    }, [selectedBodyOfWater, selectedTaskBodyOfWater?.id, taskNeedsBodyOfWater]);

    useEffect(() => {
        setSelectedTaskBodyOfWater(null);
        setSelectedTaskEquipment(null);
    }, [selectedServiceLocation?.id]);

    useEffect(() => {
        if (!taskNeedsEquipment || selectedTaskEquipment?.id || !selectedEquipment?.id) return;
        setSelectedTaskEquipment(selectedEquipment);
    }, [selectedEquipment, selectedTaskEquipment?.id, taskNeedsEquipment]);

    useEffect(() => {
        if (!taskNeedsBodyOfWater || selectedTaskBodyOfWater?.id || !selectedTaskEquipment?.bodyOfWaterId) return;

        const matchedBody = bodyOfWaterList.find((item) => item.id === selectedTaskEquipment.bodyOfWaterId);
        if (matchedBody) setSelectedTaskBodyOfWater(matchedBody);
    }, [
        bodyOfWaterList,
        selectedTaskBodyOfWater?.id,
        selectedTaskEquipment,
        taskNeedsBodyOfWater,
    ]);

    useEffect(() => {
        if (!customerList.length) return;

        const initialCustomerId =
            customerIdParam ||
            customerContext?.customerId ||
            customerContext?.id ||
            repairRequest?.customerId ||
            suggestedWork?.customerId ||
            equipmentContext?.customerId;
        if (!initialCustomerId) return;

        const matchedCustomer = customerList.find((customer) => customer.id === initialCustomerId);
        if (matchedCustomer) {
            setSelectedCustomer(matchedCustomer);
        }
    }, [customerContext, customerList, customerIdParam, repairRequest, suggestedWork, equipmentContext]);

    useEffect(() => {
        if (repairRequest?.description) {
            setDescription(repairRequest.description);
            return;
        }

        if (suggestedWork?.description || suggestedWork?.title) {
            setDescription((current) => current || [suggestedWork.title, suggestedWork.description].filter(Boolean).join("\n\n"));
            setRate(((Number(suggestedWork.estimatedPriceCents || suggestedWork.jobRateCents || 0) / 100) || 0).toFixed(2));
            setLaborCost(((Number(suggestedWork.estimatedCostCents || suggestedWork.jobLaborCostCents || 0) / 100) || 0).toFixed(2));
            setIssuePriorityLevel(normalizeIssuePriority(suggestedWork.priorityLevel || suggestedWork.solutionTier));
            return;
        }

        if (leadContext?.serviceDescription || leadContext?.serviceName) {
            const leadDescription = [
                leadContext.serviceName,
                leadContext.serviceDescription,
            ].filter(Boolean).join("\n\n");
            setDescription((current) => current || leadDescription);
            return;
        }

        if (equipmentContext?.equipmentId && jobIntent) {
            const label = jobIntent === "maintenance" ? "maintenance" : "repair";
            const equipmentName = equipmentContext.equipmentName || "equipment";
            setDescription((current) => current || `Create ${label} job for ${equipmentName}.`);
        }
    }, [repairRequest, suggestedWork, leadContext, equipmentContext, jobIntent]);

    useEffect(() => {
        if (!selectedCustomer || !recentlySelectedCompany) {
            setServiceLocationList([]);
            setSelectedServiceLocation(null);
            return;
        }

        const fetchServiceLocations = async () => {
            try {
                const q = query(
                    collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
                    where("customerId", "==", selectedCustomer.id)
                );

                const snapshot = await getDocs(q);

                const locations = snapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;
                    const label =
                        data.nickName ||
                        `${data.address?.streetAddress || ""}, ${data.address?.city || ""}`.trim() ||
                        "Service Location";

                    return {
                        ...data,
                        id,
                        value: id,
                        label,
                    };
                });

                setServiceLocationList(locations);

                const initialLocationId =
                    locationIdParam ||
                    repairRequest?.locationId ||
                    repairRequest?.serviceLocationId ||
                    suggestedWork?.serviceLocationId ||
                    customerContext?.serviceLocationId ||
                    customerContext?.locationId ||
                    equipmentContext?.serviceLocationId;

                if (initialLocationId) {
                    const matchedLocation = locations.find((loc) => loc.id === initialLocationId);
                    if (matchedLocation) {
                        setSelectedServiceLocation(matchedLocation);
                        return;
                    }
                }

                if (locations.length > 0) {
                    setSelectedServiceLocation((currentLocation) => currentLocation || locations[0]);
                }
            } catch (error) {
                console.error("Error fetching service locations:", error);
            }
        };

        fetchServiceLocations();
    }, [selectedCustomer, recentlySelectedCompany, locationIdParam, repairRequest, suggestedWork, customerContext, equipmentContext]);

    useEffect(() => {
        if (!selectedServiceLocation || !recentlySelectedCompany) {
            setBodyOfWaterList([]);
            setEquipmentList([]);
            setSelectedBodyOfWater(null);
            setSelectedEquipment(null);
            return;
        }

        const fetchLocationDetails = async () => {
            try {
                const [bodySnap, equipmentSnap] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, "companies", recentlySelectedCompany, "bodiesOfWater"),
                            where("serviceLocationId", "==", selectedServiceLocation.id)
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, "companies", recentlySelectedCompany, "equipment"),
                            where("serviceLocationId", "==", selectedServiceLocation.id)
                        )
                    ),
                ]);

                const bodies = bodySnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        value: id,
                        label: data.name || "Body Of Water",
                    };
                });

                const equipment = equipmentSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        value: id,
                        label: data.name
                            ? `${data.name}${data.model ? ` — ${data.model}` : ""}`
                            : data.model || "Equipment",
                    };
                });

                setBodyOfWaterList(bodies);
                setEquipmentList(equipment);

                const initialBodyOfWaterId =
                    customerContext?.bodyOfWaterId ||
                    repairRequest?.bodyOfWaterId ||
                    suggestedWork?.bodyOfWaterId ||
                    equipmentContext?.bodyOfWaterId;
                if (initialBodyOfWaterId) {
                    const matchedBody = bodies.find((item) => item.id === initialBodyOfWaterId);
                    if (matchedBody) setSelectedBodyOfWater(matchedBody);
                }

                const initialEquipmentId =
                    customerContext?.equipmentId ||
                    repairRequest?.equipmentId ||
                    suggestedWork?.equipmentId ||
                    equipmentContext?.equipmentId;
                if (initialEquipmentId) {
                    const matchedEquipment = equipment.find((item) => item.id === initialEquipmentId);
                    if (matchedEquipment) setSelectedEquipment(matchedEquipment);
                }
            } catch (error) {
                console.error("Error fetching location details:", error);
            }
        };

        fetchLocationDetails();
    }, [selectedServiceLocation, recentlySelectedCompany, customerContext, repairRequest, suggestedWork, equipmentContext]);

    useEffect(() => {
        if (!selectedEquipment?.bodyOfWaterId || !bodyOfWaterList.length) return;
        const matchedBody = bodyOfWaterList.find((item) => item.id === selectedEquipment.bodyOfWaterId);
        if (matchedBody && selectedBodyOfWater?.id !== matchedBody.id) {
            setSelectedBodyOfWater(matchedBody);
        }
    }, [bodyOfWaterList, selectedBodyOfWater?.id, selectedEquipment]);

    useEffect(() => {
        if (!selectedTemplate || templateApplied) return;

        applyTemplate(selectedTemplate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTemplate]);

    const applyTemplate = async (template) => {
        if (!recentlySelectedCompany || !template?.id) return;

        try {
            setLoadingTemplate(true);

            const templateId = template.id;

            const [tasksSnap, plannedStopsSnap, shoppingSnap, laborLinesSnap] = await Promise.all([
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "tasks"
                    )
                ),
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "plannedServiceStops"
                    )
                ),
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "shoppingItems"
                    )
                ),
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "laborLineItems"
                    )
                ),
            ]);

            const templateTasks = tasksSnap.docs.map((docSnap) => ({
                ...docSnap.data(),
                id: docSnap.data().id || docSnap.id,
            }));

            const copiedTasks = templateTasks.map((task) =>
                normalizeJobTask(task, {
                    id: `comp_job_task_${uuidv4()}`,
                    status: "Draft",
                    actualTime: 0,
                    workerId: "",
                    workerType: "Not Assigned",
                    workerName: "",
                    laborContractId: "",
                    serviceStopId: {
                        id: "",
                        internalId: "",
                    },
                    serviceLocationId: "",
                })
            );

            const taskIdMap = Object.fromEntries(
                templateTasks.map((task, index) => [task.id, copiedTasks[index].id])
            );

            const templatePlannedStops = plannedStopsSnap.docs.map((docSnap) => ({
                ...docSnap.data(),
                id: docSnap.data().id || docSnap.id,
            }));
            const copiedStops = templatePlannedStops.map((plannedStop) =>
                normalizePlannedStopForJob(plannedStop, taskIdMap)
            );
            const plannedStopIdMap = Object.fromEntries(
                templatePlannedStops.map((plannedStop, index) => [plannedStop.id, copiedStops[index]?.id])
            );
            const copiedLaborLines = laborLinesSnap.docs
                .map((docSnap) => ({
                    ...docSnap.data(),
                    id: docSnap.data().id || docSnap.id,
                }))
                .map((line, index) => {
                    const quantity = laborLineQuantityNumber(line.quantity || line.defaultQuantity || 1);
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
                        sourceTemplateId: templateId,
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
                    };
                });

            const copiedShopping = shoppingSnap.docs.map((docSnap) =>
                normalizeShoppingItemForJob({
                    ...docSnap.data(),
                    id: `comp_shop_${uuidv4()}`,
                })
            );

            setTaskList(copiedTasks);
            setPlannedServiceStops(copiedStops);
            setShoppingList(copiedShopping);
            setLaborLineItems(copiedLaborLines);

            setDescription(template.description || "");
            setRate(((Number(template.defaultRateCents || 0) / 100) || 0).toFixed(2));
            setLaborCost(((Number(template.defaultLaborCostCents || 0) / 100) || 0).toFixed(2));
            setIssuePriorityLevel(getTemplateDefaultIssuePriority(template));

            setTemplateApplied(true);
        } catch (error) {
            console.error("Error applying job template:", error);
            appAlert("Failed to apply job template.");
        } finally {
            setLoadingTemplate(false);
        }
    };

    const handleTemplateChange = async (template) => {
        const shouldReplace = !template || !templateApplied || await appConfirm({
            title: "Apply Job Template",
            message: "Apply this template and replace current planned tasks, stops, and materials?",
            confirmLabel: "Apply Template",
        });

        if (!shouldReplace) return;

        setSelectedTemplate(template);
        setTemplateApplied(false);

            if (!template) {
                setTaskList([]);
                setPlannedServiceStops([]);
                setShoppingList([]);
                setLaborLineItems([]);
                setDescription("");
                setRate("0");
                setLaborCost("0");
            return;
        }

        await applyTemplate(template);
    };

    const handleTaskGroupChange = async (taskGroup) => {
        setSelectedTaskGroup(taskGroup);

        if (!taskGroup || !recentlySelectedCompany) return;

        const ok = taskList.length === 0 || await appConfirm({
            title: "Replace Tasks",
            message: "Replace current tasks with tasks from this task group?",
            confirmLabel: "Replace Tasks",
        });

        if (!ok) return;

        try {
            const snapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "settings",
                    "taskGroup",
                    "taskGroup",
                    taskGroup.id,
                    "taskItems"
                )
            );

            const tasks = snapshot.docs.map((docSnap) => {
                const data = docSnap.data();

                return normalizeJobTask(data, {
                    id: `comp_job_task_${uuidv4()}`,
                    status: "Draft",
                    actualTime: 0,
                    workerId: "",
                    workerType: "Not Assigned",
                    workerName: "",
                    laborContractId: "",
                    serviceStopId: {
                        id: "",
                        internalId: "",
                    },
                    equipmentId: selectedEquipment?.id || "",
                    serviceLocationId: selectedServiceLocation?.id || "",
                    bodyOfWaterId: selectedBodyOfWater?.id || "",
                });
            });

            setTaskList(tasks);
        } catch (error) {
            console.error("Error loading task group:", error);
            appAlert("Failed to load task group.");
        }
    };

    const saveEquipmentMappingForDatabaseItem = async (dbItem, mapping) => {
        if (!dbItem?.id) return null;

        if (!hasDatabaseEquipmentMapping(mapping)) {
            await appAlert("Connect this database item to equipment type, make, and model.");
            return null;
        }

        const patch = {
            ...databaseEquipmentMappingPatch(mapping),
            category: EQUIPMENT_DATABASE_CATEGORY,
            dateUpdated: serverTimestamp(),
        };
        const nextItem = {
            ...dbItem,
            ...patch,
            label: equipmentDatabaseItemLabel({ ...dbItem, ...patch }),
        };

        await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase", dbItem.id),
            patch
        );
        setEquipmentDatabaseItems((current) =>
            current.map((item) => (item.id === dbItem.id ? nextItem : item))
        );

        return nextItem;
    };

    const handleAddTask = async () => {
        if (!taskDescription.trim()) {
            await appAlert("Add a task description.");
            return;
        }
        if (!selectedTaskType?.value && !selectedTaskType?.name) {
            await appAlert("Pick a task type.");
            return;
        }
        if (!Number.isFinite(Number(taskLaborCost || 0)) || Number(taskLaborCost || 0) < 0) {
            await appAlert("Tech labor cost cannot be negative.");
            return;
        }
        if (!Number.isFinite(Number(taskBillingLaborPrice || 0)) || Number(taskBillingLaborPrice || 0) < 0) {
            await appAlert("Billing labor price cannot be negative.");
            return;
        }

        const resolvedTaskBodyOfWaterId =
            selectedTaskBodyOfWater?.id ||
            selectedTaskEquipment?.bodyOfWaterId ||
            selectedBodyOfWater?.id ||
            selectedEquipment?.bodyOfWaterId ||
            "";

        if (taskNeedsBodyOfWater && !resolvedTaskBodyOfWaterId) {
            await appAlert("Select a body of water for this task.");
            return;
        }

        if (taskNeedsEquipment && !selectedTaskEquipment?.id) {
            await appAlert("Select equipment for this task.");
            return;
        }

        let taskDbItem = selectedTaskDbItem;
        let equipmentMapping = selectedTaskDbItemEquipmentMapping;

        if (taskNeedsEquipmentDatabaseItem) {
            if (!taskDbItem || !isEquipmentDatabaseItem(taskDbItem)) {
                await appAlert("Select an equipment database item for this task.");
                return;
            }

            if (!hasDatabaseEquipmentMapping(equipmentMapping)) {
                equipmentMapping = databaseEquipmentMappingFromItem(taskDbItem);
            }

            if (!hasDatabaseEquipmentMapping(equipmentMapping)) {
                await appAlert("Connect this database item to equipment type, make, and model.");
                return;
            }

            taskDbItem = await saveEquipmentMappingForDatabaseItem(taskDbItem, equipmentMapping);
            if (!taskDbItem) return;
        }

        const techLaborCents = dollarsToCents(taskLaborCost);
        const billingLaborPriceCents = taskBillingLaborPrice === ""
            ? techLaborCents
            : dollarsToCents(taskBillingLaborPrice);
        const newTaskType = canonicalJobTaskType(selectedTaskType.value || selectedTaskType.name);

        const newTask = normalizeJobTask(
            {
                id: `comp_job_task_${uuidv4()}`,
                name: taskDescription.trim(),
                type: newTaskType,
                contractedRate: techLaborCents,
                billingLaborPriceCents,
                estimatedTime: Number(estimatedTime || 0),
                status: "Draft",
            },
            {
                customerApproval: false,
                actualTime: 0,
                workerId: "",
                workerType: "Not Assigned",
                workerName: "",
                laborContractId: "",
                serviceStopId: {
                    id: "",
                    internalId: "",
                },
                equipmentId: taskNeedsEquipment ? selectedTaskEquipment?.id || "" : "",
                serviceLocationId: selectedServiceLocation?.id || "",
                bodyOfWaterId: taskNeedsBodyOfWater ? resolvedTaskBodyOfWaterId : "",
                dataBaseItemId: taskNeedsInstallItem ? taskDbItem?.id || selectedTaskDbItemId || "" : "",
            }
        );

        setTaskList((prev) => [...prev, newTask]);

        setTaskDescription("");
        setSelectedTaskType(null);
        setTaskLaborCost("");
        setTaskBillingLaborPrice("");
        setEstimatedTime("");
        setSelectedTaskBodyOfWater(null);
        setSelectedTaskEquipment(null);
        setSelectedTaskDbItemId("");
        setSelectedTaskDbItemEquipmentMapping(emptyDatabaseEquipmentMapping());
    };

    const removeTask = (taskId) => {
        setTaskList((prev) => prev.filter((task) => task.id !== taskId));

        setPlannedServiceStops((prev) =>
            prev.map((stop) => ({
                ...stop,
                taskIds: Array.isArray(stop.taskIds)
                    ? stop.taskIds.filter((id) => id !== taskId)
                    : [],
            }))
        );
    };

    const removePlannedStop = (plannedStopId) => {
        setPlannedServiceStops((prev) => prev.filter((stop) => stop.id !== plannedStopId));
    };

    const removeShoppingItem = (itemId) => {
        setShoppingList((prev) => prev.filter((item) => item.id !== itemId));
    };

    const createNewJob = async () => {
        if (!requirePermission("22", "create jobs")) return;

        if (!canCreateJob) {
            setShowMissingJobInfoModal(true);
            return;
        }

        try {
            setCreating(true);

            const settingsRef = doc(db, "companies", recentlySelectedCompany, "settings", "workOrders");
            const settingsSnap = await getDoc(settingsRef);

            let nextCount = 1;
            let nextInternalId = internalId || "J1";

            if (settingsSnap.exists()) {
                nextCount = Number(settingsSnap.data().increment || 0) + 1;
                nextInternalId = `J${nextCount}`;
            }

            await setDoc(settingsRef, { increment: nextCount }, { merge: true });

            const customerName = getCustomerDisplayName(selectedCustomer);
            const adminId = getAdminIdForJob(selectedAdmin);
            const adminName = getAdminNameForJob(selectedAdmin);
            const now = new Date();
            const nowTimestamp = Timestamp.fromDate(now);
            const nowMillis = now.getTime();
            const normalizedIssuePriority = normalizeIssuePriority(issuePriorityLevel);
            const issuePriorityLabel = getIssuePriorityLabel(normalizedIssuePriority);
            const normalizedStarterPlanTier = normalizeJobPlanTier(starterPlanTier);
            const starterPlanTierLabel = getJobPlanRecommendationLabel(normalizedStarterPlanTier);
            const starterPlanId = `comp_job_plan_${uuidv4()}`;
            const normalizedPlannedStops = plannedServiceStops.map((plannedStop) => ({
                ...plannedStop,
                companyId: recentlySelectedCompany,
                jobId,
                createdAt: plannedStop.createdAt || nowTimestamp,
                createdByUserId: plannedStop.createdByUserId || createdByUserId || "",
                sourcePlanId: starterPlanId,
                sourceSolutionId: starterPlanId,
                serviceLocationId: plannedStop.serviceLocationId || selectedServiceLocation.id || "",
                bodyOfWaterId: plannedStop.bodyOfWaterId || resolvedBodyOfWaterId,
                equipmentId: plannedStop.equipmentId || selectedEquipment?.id || "",
            }));
            const normalizedTasks = taskList.map((task) =>
                normalizeJobTask(task, {
                    companyId: recentlySelectedCompany,
                    jobId,
                    serviceLocationId: task.serviceLocationId || selectedServiceLocation.id || "",
                    bodyOfWaterId: task.bodyOfWaterId || resolvedBodyOfWaterId,
                    equipmentId: task.equipmentId || selectedEquipment?.id || "",
                    sourcePlanId: starterPlanId,
                    sourceSolutionId: starterPlanId,
                })
            );
            const normalizedShoppingItems = shoppingList.map((item) =>
                normalizeShoppingItemForJob(item, {
                    companyId: recentlySelectedCompany,
                    jobId,
                    customerId: selectedCustomer.id,
                    customerName,
                    purchaserId: item.purchaserId || createdByUserId || "",
                    purchaserName: item.purchaserName || createdByUserName || "",
                    status: "Need to Purchase",
                    planId: starterPlanId,
                    sourcePlanId: starterPlanId,
                    solutionId: starterPlanId,
                    sourceSolutionId: starterPlanId,
                })
            );
            const normalizedLaborLineItems = laborLineItems.map((line, index) => {
                const catalogItemId = laborLineCatalogItemId(line);
                const laborLineId = line.id || line.laborLineId || `comp_job_labor_line_${uuidv4()}`;
                return {
                    ...line,
                    id: laborLineId,
                    laborLineId,
                    companyId: recentlySelectedCompany,
                    jobId,
                    sourcePlanId: starterPlanId,
                    sourceSolutionId: starterPlanId,
                    sourceTemplateId: line.sourceTemplateId || selectedTemplate?.id || "",
                    quantity: laborLineQuantityNumber(line.quantity || line.defaultQuantity || 1),
                    unitPriceCents: laborLineUnitPriceCents(line),
                    totalPriceCents: laborLineTotalPriceCents(line),
                    internalCostCents: laborLineInternalCostCents(line),
                    unitCostCents: laborLineInternalCostCents(line),
                    taskIds: getLaborLineTaskIds(line),
                    laborLineTaskIds: getLaborLineTaskIds(line),
                    plannedServiceStopIds: getLaborLinePlannedStopIds(line),
                    laborLinePlannedServiceStopIds: getLaborLinePlannedStopIds(line),
                    equipmentId: line.equipmentId || selectedEquipment?.id || "",
                    serviceLocationId: line.serviceLocationId || selectedServiceLocation.id || "",
                    bodyOfWaterId: line.bodyOfWaterId || resolvedBodyOfWaterId,
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
                    createdAt: line.createdAt || nowTimestamp,
                    createdAtMillis: line.createdAtMillis || nowMillis,
                    createdByUserId: line.createdByUserId || createdByUserId || "",
                    createdByUserName: line.createdByUserName || createdByUserName || "",
                    updatedAt: nowTimestamp,
                    updatedAtMillis: nowMillis,
                };
            });
            const starterPlanRecord = buildStarterPlanRecord({
                planId: starterPlanId,
                nextInternalId,
                customerName,
                issuePriority: normalizedIssuePriority,
                issuePriorityLabel,
                planTierValue: normalizedStarterPlanTier,
                planTierLabel: starterPlanTierLabel,
                normalizedTasks,
                normalizedPlannedStops,
                normalizedShoppingItems,
                normalizedLaborLineItems,
                nowTimestamp,
                nowMillis,
            });

            const jobData = {
                id: jobId,
                internalId: nextInternalId,
                type: "",
                dateCreated: nowTimestamp,
                updatedAt: nowTimestamp,
                updatedAtMillis: nowMillis,
                lastHistoryEventTitle: "Job initially created",
                lastHistoryEventType: "Created",
                description: description || "",

                operationStatus: "Estimate Pending",
                billingStatus: "Draft",
                issuePriorityLevel: normalizedIssuePriority,
                issuePriorityLabel,
                priorityLevel: normalizedIssuePriority,
                priorityLabel: issuePriorityLabel,
                solutionTier: normalizedIssuePriority,
                solutionTierLabel: issuePriorityLabel,
                activePlanId: starterPlanId,
                activePlanTier: normalizedStarterPlanTier,
                activePlanTierLabel: starterPlanTierLabel,
                acceptedPlanId: "",
                activeSolutionId: starterPlanId,
                activeSolutionTier: normalizedStarterPlanTier,
                activeSolutionTierLabel: starterPlanTierLabel,
                acceptedSolutionId: "",
                planSelectionStatus: "Draft",
                solutionSelectionStatus: "Draft",

                customerId: selectedCustomer.id,
                customerName,
                serviceLocationId: selectedServiceLocation.id,
                serviceLocationName: selectedServiceLocation.label || "",

                serviceStopIds: [],
                laborContractIds: [],

                adminId,
                adminName,

                purchasedItemsIds: [],

                rate: starterPlanRecord.totalAmountCents || rateCents,
                laborCost: starterPlanRecord.plannedLaborCostCents || laborCostCents,
                plannedLaborPriceCents: starterPlanRecord.plannedLaborPriceCents || 0,
                plannedMaterialCostCents: starterPlanRecord.materialCostCents || 0,
                plannedMaterialPriceCents: starterPlanRecord.materialPriceCents || 0,
                estimateSubtotalCents: starterPlanRecord.subtotalAmountCents || 0,
                estimateTotalCents: starterPlanRecord.totalAmountCents || rateCents,
                estimateLineItems: starterPlanRecord.estimateLineItems || [],
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

                // Legacy / web convenience fields
                bodyOfWaterId: resolvedBodyOfWaterId,
                bodyOfWaterName: selectedBodyOfWater?.label || selectedBodyOfWater?.name || selectedEquipment?.bodyOfWaterName || "",
                equipmentId: selectedEquipment?.id || "",
                equipmentIds: selectedEquipment?.id ? [selectedEquipment.id] : [],
                companyEquipmentIds: selectedEquipment?.id ? [selectedEquipment.id] : [],
                equipmentName: selectedEquipment?.label || "",
                equipmentContext: equipmentContext || null,
                customerContext: customerContext || null,
                jobIntent,
                createdFromCustomerDetail,
                createdFromEquipmentCard,
                createdFromEquipmentDetail,
                repairRequestId: repairRequest?.id || "",
                repairRequestSourcePath: repairRequest?.id ? repairRequestSourcePath : "",
                suggestedWorkId: suggestedWork?.id || "",
                sourceSuggestedWorkId: suggestedWork?.id || "",
                leadId: leadContext?.id || "",
                sourceLeadId: leadContext?.id || "",
                leadSourcePath: leadContext?.id ? leadSourcePath : "",
                sourceLeadName: leadContext?.serviceName || "",
                sourceLeadStatus: leadContext?.status || "",
                createdFromLead: Boolean(leadContext?.id),
                sourceTemplateId: selectedTemplate?.id || "",
                sourceTemplateName: selectedTemplate?.name || "",
            };

            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "workOrders", jobId),
                jobData
            );

            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plans", starterPlanId),
                starterPlanRecord
            );

            for (const stopData of normalizedPlannedStops) {
                await setDoc(
                    doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "workOrders",
                        jobId,
                        "plannedServiceStops",
                        stopData.id
                    ),
                    stopData
                );
            }

            for (const taskData of normalizedTasks) {
                await setDoc(
                    doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "workOrders",
                        jobId,
                        "tasks",
                        taskData.id
                    ),
                    taskData
                );
            }

            for (const lineData of normalizedLaborLineItems) {
                await setDoc(
                    doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "workOrders",
                        jobId,
                        "laborLineItems",
                        lineData.id
                    ),
                    lineData
                );
            }

            for (const itemData of normalizedShoppingItems) {
                await setDoc(
                    doc(db, "companies", recentlySelectedCompany, "shoppingList", itemData.id),
                    itemData
                );
            }

            if (repairRequest?.id) {
                const repairRequestRef = repairRequestSourcePath === "homeowner"
                    ? doc(db, "homeownerRepairRequests", repairRequest.id)
                    : doc(db, "companies", recentlySelectedCompany, "repairRequests", repairRequest.id);

                await updateDoc(
                    repairRequestRef,
                    {
                        jobIds: arrayUnion(jobId),
                        status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
                    }
                );
            }

            if (suggestedWork?.id) {
                try {
                    await updateDoc(
                        doc(db, "companies", recentlySelectedCompany, "suggestedWork", suggestedWork.id),
                        {
                            status: SUGGESTED_WORK_STATUS.CONVERTED_TO_JOB,
                            convertedToJobId: jobId,
                            convertedToJobInternalId: nextInternalId,
                            jobIds: arrayUnion(jobId),
                            updatedAt: serverTimestamp(),
                            updatedAtMillis: nowMillis,
                        }
                    );
                } catch (suggestionUpdateError) {
                    console.warn("Job created, but the source suggested work could not be updated.", suggestionUpdateError);
                }
            }

            if (leadContext?.id) {
                try {
                    await updateDoc(
                        doc(db, "homeownerServiceRequests", leadContext.id),
                        {
                            jobIds: arrayUnion(jobId),
                            latestJobId: jobId,
                            latestJobInternalId: nextInternalId,
                            updatedAt: serverTimestamp(),
                        }
                    );
                } catch (leadUpdateError) {
                    console.warn("Job created, but the source lead could not be updated.", leadUpdateError);
                }
            }

            const historyDescription = selectedTemplate?.name
                ? `Started from template: ${selectedTemplate.name}`
                : leadContext?.id
                    ? `Created from lead: ${leadContext.serviceName || leadContext.id}`
                    : "Created from the web job flow.";

            const historyId = "comp_job_hist_" + uuidv4();
            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "history", historyId),
                {
                    id: historyId,
                    companyId: recentlySelectedCompany,
                    jobId,
                    jobInternalId: nextInternalId,
                    eventType: "Created",
                    title: "Job initially created",
                    description: historyDescription,
                    changes: [
                        { field: "adminName", label: "Admin", before: "—", after: adminName || "—" },
                        { field: "customerName", label: "Customer", before: "—", after: customerName || "—" },
                        { field: "serviceLocationName", label: "Service Location", before: "—", after: selectedServiceLocation.label || "—" },
                        { field: "issuePriority", label: "Issue Priority", before: "—", after: `${normalizedIssuePriority} - ${issuePriorityLabel}` },
                        { field: "starterPlan", label: "Starter Plan Recommendation Rank", before: "—", after: getJobPlanRecommendationDisplay(normalizedStarterPlanTier) },
                        { field: "rate", label: "Calculated Customer Price", before: "—", after: `$${(Number(starterPlanRecord.totalAmountCents || 0) / 100).toFixed(2)}` },
                        { field: "tasks", label: "Tasks", before: "—", after: String(normalizedTasks.length) },
                        { field: "laborLineItems", label: "Service Lines", before: "—", after: String(normalizedLaborLineItems.length) },
                        { field: "plannedServiceStops", label: "Planned Stops", before: "—", after: String(normalizedPlannedStops.length) },
                        { field: "shoppingItems", label: "Planned Materials", before: "—", after: String(normalizedShoppingItems.length) },
                    ],
                    metadata: {
                        sourceTemplateId: selectedTemplate?.id || "",
                        sourceTemplateName: selectedTemplate?.name || "",
                        starterPlanId,
                        activePlanId: starterPlanId,
                        activeSolutionId: starterPlanId,
                        repairRequestId: repairRequest?.id || "",
                        suggestedWorkId: suggestedWork?.id || "",
                        leadId: leadContext?.id || "",
                        leadSourcePath: leadContext?.id ? leadSourcePath : "",
                        equipmentId: selectedEquipment?.id || "",
                        bodyOfWaterId: resolvedBodyOfWaterId,
                        jobIntent,
                        createdFromCustomerDetail,
                        createdFromEquipmentCard,
                        createdFromEquipmentDetail,
                    },
                    severity: "success",
                    actorUserId: createdByUserId || "",
                    actorUserName: createdByUserName,
                    actorCompanyUserId: dataBaseUser?.id || "",
                    createdAt: serverTimestamp(),
                    createdAtMillis: nowMillis,
                }
            );

            navigate(`/company/jobs/detail/${jobId}`);
        } catch (error) {
            console.error("Error creating new job:", error);
            appAlert("Failed to create job. Please try again.");
        } finally {
            setCreating(false);
        }
    };

    const emptyState = (title, message) => (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
            <p className="font-semibold text-gray-700">{title}</p>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
        </div>
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
                <div className="w-full">
                    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm animate-pulse">
                        <div className="h-7 bg-gray-200 rounded w-1/3" />
                        <div className="h-4 bg-gray-200 rounded w-1/2 mt-4" />
                        <div className="h-64 bg-gray-200 rounded mt-6" />
                    </div>
                </div>
            </div>
        );
    }

    const renderStepContent = (sectionName) => {
        switch (sectionName) {
            case "Info":
                return (
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                        <div className="space-y-6">
                            <SectionCard
                                title="Assignment"
                                subtitle="Choose who owns the job and who it is for."
                            >
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div>
                                        <label className={fieldLabelClasses}>Admin</label>
                                        <Select
                                            options={adminList}
                                            value={selectedAdmin}
                                            onChange={setSelectedAdmin}
                                            placeholder="Select Admin"
                                            styles={selectStyles}
                                        />
                                    </div>

                                    <div>
                                        <label className={fieldLabelClasses}>Customer</label>
	                                        <Select
	                                            options={customerList}
	                                            value={selectedCustomer}
	                                            onChange={(option) => {
                                                    setSelectedCustomer(option);
                                                    setSelectedServiceLocation(null);
                                                    setSelectedBodyOfWater(null);
                                                    setSelectedEquipment(null);
                                                }}
	                                            placeholder="Select Customer"
	                                            styles={selectStyles}
	                                            isDisabled={!!customerIdParam || !!repairRequest?.customerId}
                                        />
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                title="Location & Assets"
                                subtitle="Tie the job to the service location and any related pool or equipment."
                            >
                                <div className="grid gap-4 lg:grid-cols-3">
                                    <div>
                                        <label className={fieldLabelClasses}>Service Location</label>
	                                        <Select
	                                            options={serviceLocationList}
	                                            value={selectedServiceLocation}
	                                            onChange={(option) => {
                                                    setSelectedServiceLocation(option);
                                                    setSelectedBodyOfWater(null);
                                                    setSelectedEquipment(null);
                                                }}
	                                            placeholder="Select Service Location"
	                                            styles={selectStyles}
                                            isDisabled={
                                                !selectedCustomer ||
                                                !!locationIdParam ||
                                                !!repairRequest?.locationId ||
                                                !!repairRequest?.serviceLocationId
                                            }
                                        />
                                    </div>

                                    <div>
	                                        <label className={fieldLabelClasses}>
                                                Body Of Water {selectedTemplateRequiresBodyOfWater ? <span className="text-rose-600">*</span> : null}
                                            </label>
	                                        <Select
	                                            options={bodyOfWaterList}
	                                            value={selectedBodyOfWater}
	                                            onChange={setSelectedBodyOfWater}
	                                            placeholder="Select Body Of Water"
	                                            styles={selectStyles}
	                                            isDisabled={!selectedServiceLocation}
	                                            isClearable={!selectedTemplateRequiresBodyOfWater}
	                                        />
	                                    </div>

	                                    <div>
	                                        <label className={fieldLabelClasses}>
                                                Equipment {selectedTemplateRequiresEquipment ? <span className="text-rose-600">*</span> : null}
                                            </label>
	                                        <Select
	                                            options={equipmentList}
	                                            value={selectedEquipment}
	                                            onChange={setSelectedEquipment}
	                                            placeholder="Select Equipment"
	                                            styles={selectStyles}
	                                            isDisabled={!selectedServiceLocation}
	                                            isClearable={!selectedTemplateRequiresEquipment}
	                                        />
	                                    </div>
	                                </div>
                                    {selectedTemplate && (selectedTemplateRequiresEquipment || selectedTemplateRequiresBodyOfWater) && (
                                        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                            This template needs {[
                                                selectedTemplateRequiresEquipment ? "equipment" : "",
                                                selectedTemplateRequiresBodyOfWater ? "body of water" : "",
                                            ].filter(Boolean).join(" and ")} before it can be created.
                                        </p>
                                    )}
	                            </SectionCard>

                            <SectionCard
                                title="Plan Pricing"
                                subtitle="Calculated from planned labor, visits, and billable materials."
                            >
                                <div className="grid gap-4 lg:grid-cols-3">
                                    <StatCard
                                        title="Estimated Price"
                                        value={moneyFromCents(calculatedPlanPriceCents)}
                                        subtitle="Labor plus billable materials"
                                        tone="blue"
                                    />
                                    <StatCard
                                        title="Internal Cost"
                                        value={moneyFromCents(calculatedPlanInternalCostCents)}
                                        subtitle="Labor plus material cost"
                                    />
                                    <StatCard
                                        title="Projected Profit"
                                        value={moneyFromCents(projectedProfitCents)}
                                        subtitle="Calculated"
                                        tone={projectedProfitCents < 0 ? "red" : "green"}
                                    />
                                </div>

                                <dl className="mt-5 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-3">
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                            Materials
                                        </dt>
                                        <dd className="mt-1 text-sm font-bold text-slate-900">
                                            {moneyFromCents(plannedMaterialCostCents)}
                                        </dd>
                                    </div>

                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                            Planned Labor
                                        </dt>
                                        <dd className="mt-1 text-sm font-bold text-slate-900">
                                            {moneyFromCents(plannedTotalLaborCents)}
                                        </dd>
                                    </div>

                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                            Projected Profit
                                        </dt>
                                        <dd
                                            className={[
                                                "mt-1 text-sm font-bold",
                                                projectedProfitCents < 0 ? "text-red-700" : "text-green-700",
                                            ].join(" ")}
                                        >
                                            {moneyFromCents(projectedProfitCents)}
                                        </dd>
                                    </div>
                                </dl>
                            </SectionCard>

                            <SectionCard
                                title="Priority & Plan"
                                subtitle="Set the problem priority and the starter plan recommendation rank."
                            >
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div>
                                        <label className={fieldLabelClasses}>Issue Priority</label>
                                        <select
                                            value={issuePriorityLevel}
                                            onChange={(e) => setIssuePriorityLevel(normalizeIssuePriority(e.target.value))}
                                            className={fieldInputClasses}
                                        >
                                            {ISSUE_PRIORITY_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.value} - {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className={fieldLabelClasses}>Starter Plan Recommendation Rank</label>
                                        <select
                                            value={starterPlanTier}
                                            onChange={(e) => setStarterPlanTier(normalizeJobPlanTier(e.target.value))}
                                            className={fieldInputClasses}
                                        >
                                            {JOB_PLAN_TIER_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {getJobPlanRecommendationDisplay(option.value)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </SectionCard>
                        </div>

                        <section className="flex min-h-[24rem] flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6 xl:min-h-[calc(100vh-20rem)]">
                            <div className="border-b border-slate-200 pb-4">
                                <h3 className="text-xl font-bold text-slate-950">Scope Notes</h3>
                                <p className="mt-1 text-sm text-slate-600">
                                    Add the job description and anything the crew should know.
                                </p>
                            </div>

                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Job description..."
                                className="mt-5 min-h-[18rem] flex-1 resize-none rounded-md border border-slate-300 px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 xl:min-h-0"
                            />
                        </section>
                    </div>
                );

            case "Template":
                return (
                    <SectionCard
                        title="Template"
                        subtitle="Optional. Start this job from a saved job template."
                    >
                        <Select
                            options={jobTemplateList}
                            value={selectedTemplate}
                            onChange={handleTemplateChange}
                            placeholder="Select Job Template"
                            styles={selectStyles}
                            isClearable
                            isLoading={loadingTemplate}
                        />

                        {selectedTemplate ? (
                            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                                <p className="text-sm font-bold text-blue-800">
                                    Template Applied: {selectedTemplate.name}
                                </p>
                                <p className="text-sm text-blue-700 mt-1">
                                    Service lines, tasks, planned stops, materials, and calculated plan pricing were copied into this new job.
                                </p>
                            </div>
                        ) : (
                            <div className="mt-6">
                                {emptyState(
                                    "No template selected.",
                                    "You can skip this step or choose a template to prefill this job."
                                )}
                            </div>
                        )}
                    </SectionCard>
                );

            case "Tasks":
                return (
                    <SectionCard
                        title="Tasks"
                        subtitle="Plan the labor scope. Values save as cents to match iOS."
                        action={
                            <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                                {taskList.length}
                            </span>
                        }
                    >
                        <Select
                            options={taskGroupList}
                            value={selectedTaskGroup}
                            onChange={handleTaskGroupChange}
                            placeholder="Select a Task Group to Prefill Tasks"
                            styles={selectStyles}
                            className="mb-4"
                            isClearable
                        />

                        {plannedServiceStops.length > 0 && (
                            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h4 className="font-bold text-gray-800">Planned Service Stops</h4>
                                        <p className="text-sm text-gray-600 mt-1">
                                            Copied from the selected template.
                                        </p>
                                    </div>

                                    <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                                        {plannedServiceStops.length}
                                    </span>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {plannedServiceStops
                                        .slice()
                                        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
                                        .map((stop) => (
                                            <div
                                                key={stop.id}
                                                className="rounded-lg border border-gray-200 bg-white p-4"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="font-bold text-gray-800">
                                                            {stop.name || stop.serviceStopTypeName}
                                                        </p>
                                                        <p className="text-sm text-gray-600 mt-1">
                                                            {stop.serviceStopTypeName || "Service Type"} •{" "}
                                                            {stop.estimatedMinutes || 0} min
                                                        </p>
                                                        <p className="text-sm text-gray-600 mt-1">
                                                            Planned labor: {moneyFromCents(stop.plannedLaborCostCents)}
                                                        </p>
                                                        {Array.isArray(stop.taskIds) && stop.taskIds.length > 0 && (
                                                            <p className="text-xs text-gray-500 mt-1">
                                                                {stop.taskIds.length} linked task(s)
                                                            </p>
                                                        )}
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => removePlannedStop(stop.id)}
                                                        className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-100"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

                        {taskList.length > 0 ? (
                            <div className="divide-y divide-gray-200 mb-6">
                                {taskList.map((task) => {
                                    const taskEquipment = equipmentById.get(task.equipmentId) || null;
                                    const taskBodyOfWater = bodyOfWaterById.get(task.bodyOfWaterId) || null;

                                    return (
                                        <div key={task.id} className="flex justify-between items-center py-3 gap-4">
                                            <div>
                                                <p className="font-semibold text-gray-800">{task.name}</p>
                                                <p className="text-sm text-gray-600">
                                                    {task.type} • Est. Time: {task.estimatedTime || 0} min
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    Status: {task.status || "Draft"} • Worker: {task.workerType || "Not Assigned"}
                                                </p>
                                                {(taskEquipment || taskBodyOfWater) && (
                                                    <p className="text-xs text-slate-500">
                                                        {[taskBodyOfWater?.label || taskBodyOfWater?.name, taskEquipment?.label || taskEquipment?.name]
                                                            .filter(Boolean)
                                                            .join(" • ")}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="text-right">
                                                <p className="text-sm font-semibold text-slate-800">
                                                    Tech: {moneyFromCents(task.contractedRate)}
                                                </p>
                                                <p className="text-sm font-semibold text-blue-700">
                                                    Billing: {moneyFromCents(getTaskBillingLaborPriceCents(task))}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => removeTask(task.id)}
                                                    className="text-red-600 hover:text-red-800 text-sm font-semibold"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="mb-6">
                                {emptyState("No tasks yet.", "Add tasks manually or apply a template/task group.")}
                            </div>
                        )}

                        <div className="border-t pt-4">
                            <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                        Description
                                        <input
                                            value={taskDescription}
                                            onChange={(e) => setTaskDescription(e.target.value)}
                                            placeholder="Task description"
                                            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                        Type
                                        <div className="mt-1 text-sm font-medium normal-case tracking-normal">
                                            <Select
                                                options={taskTypeList}
                                                value={selectedTaskType}
                                                onChange={(option) => {
                                                    setSelectedTaskType(option);
                                                    if (!taskTypeRequiresInstallItem(option?.value || option?.name || "")) {
                                                        setSelectedTaskDbItemId("");
                                                        setSelectedTaskDbItemEquipmentMapping(emptyDatabaseEquipmentMapping());
                                                    }
                                                }}
                                                placeholder="Select a task type"
                                                styles={selectStyles}
                                                isSearchable
                                            />
                                        </div>
                                    </div>

                                    {taskNeedsBodyOfWater && (
                                        <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Body of Water
                                            <div className="mt-1 text-sm font-medium normal-case tracking-normal">
                                                <Select
                                                    options={taskBodyOfWaterOptions}
                                                    value={selectedTaskBodyOfWater}
                                                    onChange={setSelectedTaskBodyOfWater}
                                                    placeholder="Select body of water"
                                                    styles={selectStyles}
                                                    isSearchable
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {taskNeedsEquipment && (
                                        <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Equipment
                                            <div className="mt-1 text-sm font-medium normal-case tracking-normal">
                                                <Select
                                                    options={taskEquipmentOptions}
                                                    value={selectedTaskEquipment}
                                                    onChange={setSelectedTaskEquipment}
                                                    placeholder="Select equipment"
                                                    styles={selectStyles}
                                                    isSearchable
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {taskNeedsInstallItem && (
                                        <div className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                            {taskNeedsEquipmentDatabaseItem ? "Equipment Item" : "Item"}
                                            <div className="mt-1 text-sm font-medium normal-case tracking-normal">
                                                <Select
                                                    options={equipmentDatabaseItems}
                                                    value={selectedTaskDbItem}
                                                    onChange={(option) => setSelectedTaskDbItemId(option?.id || option?.value || "")}
                                                    placeholder={taskNeedsEquipmentDatabaseItem ? "Select equipment item" : "Select item"}
                                                    styles={selectStyles}
                                                    isSearchable
                                                    isClearable
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                        Tech Labor Cost
                                        <input
                                            value={taskLaborCost}
                                            onChange={(e) => setTaskLaborCost(e.target.value)}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                        Billing Labor
                                        <input
                                            value={taskBillingLaborPrice}
                                            onChange={(e) => setTaskBillingLaborPrice(e.target.value)}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                                        Estimated Time
                                        <input
                                            value={estimatedTime}
                                            onChange={(e) => setEstimatedTime(e.target.value)}
                                            type="number"
                                            min="0"
                                            step="1"
                                            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>
                                </div>

                                {taskNeedsEquipmentDatabaseItem && selectedTaskDbItem && (
                                    <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
                                        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                                            Equipment Mapping
                                        </p>
                                        <EquipmentCatalogPicker
                                            value={selectedTaskDbItemEquipmentMapping}
                                            onChange={setSelectedTaskDbItemEquipmentMapping}
                                            preferCustom
                                            inputClassName="w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
                                            labelClassName="block text-xs font-bold uppercase tracking-wide text-slate-600"
                                            gridClassName="grid grid-cols-1 gap-3 md:grid-cols-3"
                                            labels={{ type: "Equipment Type", make: "Make", model: "Model" }}
                                        />
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={handleAddTask}
                                    className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                                >
                                    Add Task
                                </button>
                            </div>
                        </div>
                    </SectionCard>
                );

            case "Materials":
                return (
                    <SectionCard
                        title="Materials"
                        subtitle="Template materials are copied as planned shopping list items."
                        action={
                            <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                                {shoppingList.length}
                            </span>
                        }
                    >
                        {shoppingList.length ? (
                            <div className="space-y-3">
                                {shoppingList.map((item) => (
                                    <div
                                        key={item.id}
                                        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-bold text-gray-800">{item.name || "Material"}</p>
                                                <p className="text-sm text-gray-600 mt-1">
                                                    {item.subCategory || "Custom"} • Qty: {item.quantity || "—"}
                                                </p>
                                                <p className="text-sm text-gray-600 mt-1">
                                                    Cost: {moneyFromCents(item.plannedTotalCostCents)} • Billable:{" "}
                                                    {moneyFromCents(item.plannedTotalPriceCents)}
                                                </p>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => removeShoppingItem(item.id)}
                                                className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-100"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            emptyState(
                                "No planned materials.",
                                "Materials can be copied from templates or added later from the job detail page."
                            )
                        )}
                    </SectionCard>
                );

            case "Schedule":
                return (
                    <SectionCard
                        title="Schedule"
                        subtitle="Scheduling from web can happen after the job is created."
                    >
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="font-semibold text-gray-800">Service Stops</p>
                            <p className="text-sm text-gray-600 mt-1">
                                This create flow saves planned service stops from templates. Actual service stops can be scheduled from the Job Detail page after creation.
                            </p>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mt-4">
                            <p className="font-semibold text-gray-800">Work Offers</p>
                            <p className="text-sm text-gray-600 mt-1">
                                Work offers can be created after the job exists, so they can reference saved job tasks and planned stops.
                            </p>
                        </div>
                    </SectionCard>
                );

            case "Review":
            default:
                return (
                    <SectionCard
                        title="Review"
                        subtitle="Confirm the job before creating it."
                    >
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <StatCard
                                title="Estimated Price"
                                value={moneyFromCents(calculatedPlanPriceCents)}
                                subtitle="From starter plan scope"
                                tone="blue"
                            />

                            <StatCard
                                title="Internal Cost"
                                value={moneyFromCents(calculatedPlanInternalCostCents)}
                                subtitle="Labor plus material cost"
                            />

                            <StatCard
                                title="Planned Total Labor"
                                value={moneyFromCents(plannedTotalLaborCents)}
                                subtitle={laborLineItems.length
                                    ? `${laborLineItems.length} service line${laborLineItems.length === 1 ? "" : "s"} • ${moneyFromCents(plannedLaborLinePriceCents)} billable`
                                    : `${moneyFromCents(plannedStopLaborCents)} stops - ${moneyFromCents(plannedTaskLaborCents)} tech tasks - ${moneyFromCents(plannedTaskBillingLaborCents)} billable tasks`}
                                tone="amber"
                            />

                            <StatCard
                                title="Projected Profit"
                                value={moneyFromCents(projectedProfitCents)}
                                subtitle="Rate - saved labor - planned material cost"
                                tone={projectedProfitCents < 0 ? "red" : "green"}
                            />
                        </div>

                        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Admin
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {getAdminNameForJob(selectedAdmin) || "—"}
                                </p>
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Customer
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {getCustomerDisplayName(selectedCustomer) || "—"}
                                </p>
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Service Location
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {selectedServiceLocation?.label || "—"}
                                </p>
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Template
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {selectedTemplate?.name || "None"}
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="font-semibold text-gray-800">Job Contents</p>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                                <StatCard
                                    title="Planned Stops"
                                    value={String(plannedServiceStops.length)}
                                />
                                <StatCard
                                    title="Tasks"
                                    value={String(taskList.length)}
                                />
                                <StatCard
                                    title="Materials"
                                    value={String(shoppingList.length)}
                                />
                            </div>
                        </div>
                    </SectionCard>
                );
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-950 sm:px-3 lg:px-4">
            <div className="w-full space-y-5">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <Link
                                to="/company/jobs"
                                className="app-back-link"
                            >
                                &larr; Back to Jobs
                            </Link>
                            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">Company Operations</p>
                            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Create New Job</h1>
                            <p className="mt-1 max-w-3xl text-sm text-slate-500">
                                {selectedTemplate
                                    ? `Started from template: ${selectedTemplate.name}`
                                    : "Build the job scope, materials, pricing, and review before submitting."}
                            </p>
                        </div>

                        <div className="flex flex-col gap-2 sm:items-end">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated Price</p>
                                <p className="mt-1 text-2xl font-bold text-slate-950">{moneyFromCents(calculatedPlanPriceCents)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={createNewJob}
                                disabled={creating}
                                aria-disabled={!canCreateJob || creating}
                                className={[
                                    "w-full rounded-md px-4 py-2.5 text-sm font-semibold shadow-sm transition sm:w-auto",
                                    canCreateJob && !creating
                                        ? "bg-blue-600 text-white hover:bg-blue-700"
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70",
                                ].join(" ")}
                            >
                                {creating ? "Creating..." : "Create Job"}
                            </button>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
                            <div className="mt-3 space-y-2">
                                {createJobSectionMeta.map((sectionOption) => {
                                    const active = sectionOption.id === activeCreateSection;
                                    return (
                                        <button
                                            key={sectionOption.id}
                                            type="button"
                                            onClick={() => setActiveCreateSection(sectionOption.id)}
                                            className={[
                                                "w-full rounded-md border px-3 py-2 text-left transition",
                                                active
                                                    ? "border-blue-200 bg-blue-50 text-blue-800"
                                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                            ].join(" ")}
                                        >
                                            <span className="flex items-center justify-between gap-3">
                                                <span className="text-sm font-semibold">{sectionOption.label}</span>
                                                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                                                    {sectionOption.count}
                                                </span>
                                            </span>
                                            <span className="mt-1 block text-xs text-slate-500">{sectionOption.helper}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Job Snapshot</h2>
                            <dl className="mt-3 space-y-3">
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</dt>
                                    <dd className="mt-0.5 font-semibold text-slate-800">{getAdminNameForJob(selectedAdmin) || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</dt>
                                    <dd className="mt-0.5 font-semibold text-slate-800">{getCustomerDisplayName(selectedCustomer) || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Site</dt>
                                    <dd className="mt-0.5 font-semibold text-slate-800">{selectedServiceLocation?.label || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Template</dt>
                                    <dd className="mt-0.5 font-semibold text-slate-800">{selectedTemplate?.name || "None"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Price</dt>
                                    <dd className="mt-0.5 text-lg font-bold text-slate-950">{moneyFromCents(calculatedPlanPriceCents)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Projected Profit</dt>
                                    <dd className={projectedProfitCents < 0 ? "mt-0.5 font-bold text-rose-700" : "mt-0.5 font-bold text-emerald-700"}>
                                        {moneyFromCents(projectedProfitCents)}
                                    </dd>
                                </div>
                            </dl>
                        </div>

                        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <button
                                type="button"
                                onClick={createNewJob}
                                disabled={creating}
                                aria-disabled={!canCreateJob || creating}
                                className={[
                                    "w-full rounded-md px-4 py-2.5 text-sm font-semibold shadow-sm transition",
                                    canCreateJob && !creating
                                        ? "bg-blue-600 text-white hover:bg-blue-700"
                                        : "bg-slate-200 text-slate-500 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70",
                                ].join(" ")}
                            >
                                {creating ? "Creating..." : "Create Job"}
                            </button>
                            <Link
                                to="/company/jobs"
                                className="mt-2 block w-full rounded-md border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                                Cancel
                            </Link>
                        </section>
                    </aside>

                    <div className="min-w-0 space-y-4">
                        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-sm font-bold text-slate-900">
                                            {activeCreateSectionMeta?.label || "Job Info"}
                                        </h2>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                                            New Job
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-slate-500">{activeCreateSectionMeta?.helper}</p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {previousCreateSection && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveCreateSection(previousCreateSection)}
                                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                        >
                                            Previous
                                        </button>
                                    )}
                                    {nextCreateSection ? (
                                        <button
                                            type="button"
                                            onClick={() => setActiveCreateSection(nextCreateSection)}
                                            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                                        >
                                            Next
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={createNewJob}
                                            disabled={creating}
                                            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {creating ? "Creating..." : "Create Job"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div id={`create-job-${activeCreateSection.toLowerCase()}`}>
                            {renderStepContent(activeCreateSection)}
                        </div>
                    </div>
                </section>
            </div>

            {showMissingJobInfoModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
                        <h2 className="text-xl font-bold text-slate-950">Missing Job Information</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            This job cannot be saved yet because the following required information is missing.
                        </p>
                        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <ul className="space-y-2 text-sm font-semibold text-slate-800">
                                {missingJobInfo.map((item) => (
                                    <li key={item} className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setShowMissingJobInfoModal(false)}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowMissingJobInfoModal(false);
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                Review Info
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateNewJob;
