import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where,
} from "firebase/firestore";
import Select from "react-select";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
    CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
    CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID,
    CREATE_JOBS_PERMISSION_ID,
    CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
    SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID,
} from "../../../utils/companyPermissions";
import {
    filterCustomersByRegionalAccess,
    getCustomerTagAccessList,
    normalizeCustomerTags,
} from "../../../utils/customerTags";
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from "../../../utils/models/FeatureFlag";
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
import { appAlert } from "../../../utils/appDialog";
import {
    filterCompanyUserAdminOptions,
    getCompanyUserDisplayName,
    isActiveCompanyUser,
    sortCompanyUsersByName,
} from "../../../utils/companyUsers";
import {
    canonicalJobTaskType,
    taskTypeRequiresBodyOfWater,
    taskTypeRequiresEquipment,
} from "../../../utils/jobTaskTypes";
import { REPAIR_REQUEST_STATUS } from "../../../utils/models/RepairRequest";

const selectStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: "42px",
        borderColor: state.isFocused ? "#2563eb" : "#cbd5e1",
        borderRadius: "0.5rem",
        boxShadow: state.isFocused ? "0 0 0 3px rgba(37, 99, 235, 0.12)" : "none",
        "&:hover": {
            borderColor: state.isFocused ? "#2563eb" : "#94a3b8",
        },
    }),
    menu: (base) => ({ ...base, zIndex: 40 }),
};

const inputBase = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100";

const moneyFromCents = (value) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format((Number(value || 0) || 0) / 100);

const centsFromMoney = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100);
};

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

const getCustomerDisplayName = (customer = {}) => {
    if (customer.displayAsCompany && customer.companyName) return customer.companyName;
    return (
        customer.customerName ||
        customer.displayName ||
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
        customer.companyName ||
        "Customer"
    );
};

const getServiceLocationLabel = (location = {}) => (
    location.nickName ||
    location.name ||
    [location.address?.streetAddress, location.address?.city].filter(Boolean).join(", ") ||
    "Service Location"
);

const getBodyOfWaterLabel = (body = {}) => (
    body.name ||
    body.nickName ||
    body.type ||
    "Body Of Water"
);

const getEquipmentLabel = (equipment = {}) => (
    equipment.name
        ? `${equipment.name}${equipment.model ? ` - ${equipment.model}` : ""}`
        : [equipment.type, equipment.make, equipment.model].filter(Boolean).join(" ") ||
          equipment.model ||
          "Equipment"
);

const templateContextValues = (item = {}) => [
    item.name,
    item.title,
    item.type,
    item.jobType,
    item.taskType,
    item.taskTypeName,
    item.catalogItemName,
].filter(Boolean);

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

const emptyTemplateDetails = () => ({
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
    return Math.round(Number(line.unitPriceCents ?? line.unitAmountCents ?? line.rate ?? 0) * quantity);
};

const laborLineUnitPriceCents = (line = {}) => {
    const quantity = Math.max(Number(line.quantity || line.defaultQuantity || 1) || 1, 1);
    const explicitUnit = line.unitPriceCents ?? line.unitAmountCents;
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

const getCompanyUserId = (companyUser = {}) => (
    companyUser.userId || companyUser.uid || companyUser.id || ""
);

const getAssignedWorkOrderAdminId = (companyUser = {}) => (
    companyUser.workOrderAdminId ||
    companyUser.assignedWorkOrderAdminId ||
    companyUser.defaultWorkOrderAdminId ||
    companyUser.jobAdminId ||
    ""
);

const getAssignedWorkOrderAdminName = (companyUser = {}) => (
    companyUser.workOrderAdminName ||
    companyUser.assignedWorkOrderAdminName ||
    companyUser.defaultWorkOrderAdminName ||
    companyUser.jobAdminName ||
    ""
);

const buildCompanyUserOption = (docSnap) => {
    const data = docSnap.data();
    const id = data.id || docSnap.id;
    const userId = data.userId || data.uid || id;
    const userName = getCompanyUserDisplayName(data, "Company User");

    return {
        ...data,
        id,
        userId,
        userName,
        label: `${userName}${data.roleName ? ` - ${data.roleName}` : ""}`,
        value: userId,
    };
};

const BasicWorkOrderCreate = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const equipmentContext = location.state?.equipmentContext || null;
    const customerContext = location.state?.customerContext || null;
    const repairRequest = location.state?.repairRequest || null;
    const repairRequestSourcePath =
        location.state?.repairRequestSourcePath ||
        repairRequest?.sourcePath ||
        "company";
    const defaultDescriptionFromState = location.state?.defaultDescription || "";
    const jobIntent = location.state?.jobIntent || equipmentContext?.jobIntent || "";
    const createdFromCustomerDetail = Boolean(location.state?.createdFromCustomerDetail);
    const createdFromEquipmentCard = Boolean(location.state?.createdFromEquipmentCard);
    const createdFromEquipmentDetail = Boolean(location.state?.createdFromEquipmentDetail);
    const {
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        dataBaseUser,
        currentUser,
        user,
        companyUserAccess,
        companyRole,
        featureFlagsLoaded,
        isFeatureEnabled,
        selectedCustomerRegionTag,
    } = useContext(Context);
    const { can, permissionsReady } = useCompanyPermissions();

    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [companyDefaults, setCompanyDefaults] = useState({});
    const [companyUsers, setCompanyUsers] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [templateDetails, setTemplateDetails] = useState(emptyTemplateDetails);
    const [loadingTemplateDetails, setLoadingTemplateDetails] = useState(false);
    const [loadedTemplateDetailsId, setLoadedTemplateDetailsId] = useState("");
    const [loadingLocationAssets, setLoadingLocationAssets] = useState(false);

    const [mode, setMode] = useState("template");
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedServiceLocation, setSelectedServiceLocation] = useState(null);
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
    const [selectedEquipment, setSelectedEquipment] = useState(null);
    const [selectedAssignee, setSelectedAssignee] = useState(null);
    const [description, setDescription] = useState("");
    const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
    const [customPrice, setCustomPrice] = useState("0.00");
    const [customEstimatedMinutes, setCustomEstimatedMinutes] = useState("60");

    const loggedInUser = currentUser || user || {};
    const createdByUserId = dataBaseUser?.id || loggedInUser?.uid || loggedInUser?.id || "";
    const createdByUserName =
        `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
        loggedInUser?.displayName ||
        loggedInUser?.userName ||
        "Unknown";

    const canUseFullCreate = can(CREATE_JOBS_PERMISSION_ID);
    const canTemplateSelf = canUseFullCreate || can(SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID);
    const canTemplateOthers = canUseFullCreate || can(CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID);
    const canCustomSelf = canUseFullCreate || can(CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID);
    const canCustomOthers = canUseFullCreate || can(CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID);
    const canUseTemplate = canTemplateSelf || canTemplateOthers;
    const canUseCustom = canCustomSelf || canCustomOthers;
    const canAssignForSelectedMode = mode === "template" ? canTemplateOthers : canCustomOthers;
    const hasAnyBasicPermission = canUseTemplate || canUseCustom;

    const customerAreaFilteringEnabled = featureFlagsLoaded
        ? isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID)
        : false;

    const currentCompanyUser = useMemo(() => {
        const accessCompanyUserId = companyUserAccess?.companyUserId || companyUserAccess?.companyUserDocId || "";
        const accessUserId = companyUserAccess?.userId || loggedInUser?.uid || dataBaseUser?.id || "";

        return companyUsers.find((companyUser) => (
            companyUser.id === accessCompanyUserId ||
            companyUser.userId === accessUserId ||
            companyUser.id === accessUserId ||
            companyUser.userId === createdByUserId ||
            companyUser.id === createdByUserId
        )) || null;
    }, [companyUserAccess, companyUsers, createdByUserId, dataBaseUser?.id, loggedInUser?.uid]);

    const customerOptions = useMemo(() => {
        const visibleCustomers = filterCustomersByRegionalAccess(customers, {
            userAccess: companyUserAccess,
            role: companyRole,
            selectedRegionTag: selectedCustomerRegionTag,
            regionalAccessEnabled: customerAreaFilteringEnabled,
        });

        return visibleCustomers.map((customer) => ({
            ...customer,
            value: customer.id,
            label: getCustomerDisplayName(customer),
        }));
    }, [companyRole, companyUserAccess, customerAreaFilteringEnabled, customers, selectedCustomerRegionTag]);

    const serviceLocationOptions = useMemo(() => (
        serviceLocations.map((location) => ({
            ...location,
            value: location.id,
            label: getServiceLocationLabel(location),
        }))
    ), [serviceLocations]);

    const bodyOfWaterOptions = useMemo(() => (
        bodyOfWaterList.map((body) => ({
            ...body,
            value: body.id,
            label: getBodyOfWaterLabel(body),
        }))
    ), [bodyOfWaterList]);

    const equipmentOptions = useMemo(() => (
        equipmentList.map((equipment) => ({
            ...equipment,
            value: equipment.id,
            label: getEquipmentLabel(equipment),
        }))
    ), [equipmentList]);

    const templateOptions = useMemo(() => (
        templates
            .filter((template) => template.isActive !== false && template.active !== false && template.technicianCanAdd === true)
            .map((template) => ({
                ...template,
                value: template.id,
                label: template.name || "Job Template",
            }))
    ), [templates]);

    const assigneeOptions = useMemo(() => (
        companyUsers
            .filter(isActiveCompanyUser)
            .map((companyUser) => ({
                ...companyUser,
                value: companyUser.userId,
                label: companyUser.label || companyUser.userName || getCompanyUserDisplayName(companyUser),
            }))
    ), [companyUsers]);

    const adminOptions = useMemo(() => (
        filterCompanyUserAdminOptions(companyUsers)
    ), [companyUsers]);

    const selectedAssigneeRegionalTags = useMemo(
        () => normalizeCustomerTags(getCustomerTagAccessList(selectedAssignee || {})),
        [selectedAssignee]
    );

    const templateDetailsReady = mode !== "template" || Boolean(
        selectedTemplate?.id &&
        loadedTemplateDetailsId === selectedTemplate.id &&
        !loadingTemplateDetails
    );

    const selectedTemplateRequiresEquipment = useMemo(() => {
        if (mode !== "template" || !selectedTemplate) return false;
        return (
            itemRequiresEquipmentContext(selectedTemplate) ||
            templateDetails.tasks.some(itemRequiresEquipmentContext) ||
            templateDetails.laborLineItems.some(itemRequiresEquipmentContext)
        );
    }, [mode, selectedTemplate, templateDetails.laborLineItems, templateDetails.tasks]);

    const selectedTemplateRequiresBodyOfWater = useMemo(() => {
        if (mode !== "template" || !selectedTemplate) return false;
        return (
            itemRequiresBodyOfWaterContext(selectedTemplate) ||
            templateDetails.tasks.some(itemRequiresBodyOfWaterContext) ||
            templateDetails.laborLineItems.some(itemRequiresBodyOfWaterContext)
        );
    }, [mode, selectedTemplate, templateDetails.laborLineItems, templateDetails.tasks]);

    const resolvedBodyOfWaterId = selectedBodyOfWater?.id || selectedEquipment?.bodyOfWaterId || "";
    const resolvedBodyOfWaterName = selectedBodyOfWater?.label || selectedBodyOfWater?.name || selectedEquipment?.bodyOfWaterName || "";
    const selectedEquipmentId = selectedEquipment?.id || "";
    const selectedEquipmentName = selectedEquipment
        ? selectedEquipment.label || getEquipmentLabel(selectedEquipment)
        : "";
    const expectedTemplateLaborLineCount = Number(
        selectedTemplate?.laborLineCount ||
        selectedTemplate?.laborLineItemsCount ||
        selectedTemplate?.serviceLineCount ||
        0
    );
    const selectedTemplateLaborLinesMissing = Boolean(
        mode === "template" &&
        templateDetailsReady &&
        expectedTemplateLaborLineCount > 0 &&
        templateDetails.laborLineItems.length === 0
    );

    const resolvedAdmin = useMemo(() => {
        if (!selectedAssignee) return null;

        const explicitAdminId = getAssignedWorkOrderAdminId(selectedAssignee);
        if (explicitAdminId) {
            const matchedAdmin = companyUsers.find((companyUser) => (
                companyUser.userId === explicitAdminId || companyUser.id === explicitAdminId
            ));
            return {
                id: explicitAdminId,
                name: matchedAdmin?.userName || matchedAdmin?.label || getAssignedWorkOrderAdminName(selectedAssignee) || "Assigned Admin",
                source: "Assigned to user",
            };
        }

        const assigneeTags = getCustomerTagAccessList(selectedAssignee).map((tag) => tag.toLowerCase());
        if (assigneeTags.length > 0) {
            const regionalAdmin = adminOptions.find((companyUser) => {
                if (getCompanyUserId(companyUser) === getCompanyUserId(selectedAssignee)) return false;

                const adminTags = getCustomerTagAccessList(companyUser).map((tag) => tag.toLowerCase());
                return adminTags.some((tag) => assigneeTags.includes(tag));
            });

            if (regionalAdmin) {
                return {
                    id: regionalAdmin.userId || regionalAdmin.id,
                    name: regionalAdmin.userName || regionalAdmin.label || getCompanyUserDisplayName(regionalAdmin),
                    source: "Regional tag match",
                };
            }
        }

        if (companyDefaults.defaultAdminId) {
            const defaultAdmin = adminOptions.find((companyUser) => (
                companyUser.userId === companyDefaults.defaultAdminId || companyUser.id === companyDefaults.defaultAdminId
            ));
            if (defaultAdmin) {
                return {
                    id: defaultAdmin.userId || defaultAdmin.id,
                    name: defaultAdmin.userName || defaultAdmin.label || companyDefaults.defaultAdminName || "Default Admin",
                    source: "Company default",
                };
            }
        }

        const defaultAdmin = adminOptions[0];
        if (defaultAdmin) {
            return {
                id: defaultAdmin.userId || defaultAdmin.id,
                name: defaultAdmin.userName || defaultAdmin.label || getCompanyUserDisplayName(defaultAdmin),
                source: "Admin filter default",
            };
        }

        return null;
    }, [adminOptions, companyDefaults.defaultAdminId, companyDefaults.defaultAdminName, companyUsers, selectedAssignee]);

    const templateGeneratedPriceCents = useMemo(() => {
        if (!selectedTemplate) return 0;

        const laborLineTotal = templateDetails.laborLineItems.reduce(
            (total, line) => total + laborLineTotalPriceCents(line),
            0
        );
        const stopTotal = templateDetails.plannedServiceStops.reduce(
            (total, stop) => total + Number(stop.plannedLaborCostCents || 0),
            0
        );
        const taskTotal = templateDetails.tasks.reduce(
            (total, task) => total + getTaskBillingLaborPriceCents(task),
            0
        );
        const materialTotal = templateDetails.shoppingItems.reduce(
            (total, item) => total + plannedMaterialTotalPriceCents(item),
            0
        );
        const generatedTotal = (templateDetails.laborLineItems.length ? laborLineTotal : stopTotal + taskTotal) + materialTotal;

        return generatedTotal || Number(selectedTemplate.defaultRateCents || selectedTemplate.rate || 0);
    }, [selectedTemplate, templateDetails]);

    const customPriceCents = useMemo(() => centsFromMoney(customPrice), [customPrice]);
    const generatedPriceCents = mode === "template" ? templateGeneratedPriceCents : customPriceCents;
    const generatedInternalCostCents = useMemo(() => {
        if (mode === "custom") return 0;

        const laborLineCost = templateDetails.laborLineItems.reduce((total, line) => total + laborLineInternalCostCents(line), 0);
        const taskCost = templateDetails.tasks.reduce((total, task) => total + Number(task.contractedRate || 0), 0);
        const stopCost = templateDetails.plannedServiceStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
        const materialCost = templateDetails.shoppingItems.reduce((total, item) => total + plannedMaterialTotalCostCents(item), 0);
        return (templateDetails.laborLineItems.length ? laborLineCost : taskCost + stopCost) + materialCost;
    }, [mode, templateDetails]);

    const selectedModeAllowed = mode === "template" ? canUseTemplate : canUseCustom;
    const canCreate = Boolean(
        recentlySelectedCompany &&
        selectedModeAllowed &&
        selectedCustomer?.id &&
        selectedServiceLocation?.id &&
        selectedAssignee?.userId &&
        scheduledAt &&
        resolvedAdmin?.id &&
        (mode === "custom" || selectedTemplate?.id) &&
        templateDetailsReady &&
        !selectedTemplateLaborLinesMissing &&
        (!selectedTemplateRequiresEquipment || selectedEquipment?.id) &&
        (!selectedTemplateRequiresBodyOfWater || resolvedBodyOfWaterId)
    );

    useEffect(() => {
        if (permissionsReady && !canUseTemplate && canUseCustom) {
            setMode("custom");
        }
    }, [canUseCustom, canUseTemplate, permissionsReady]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        let cancelled = false;

        const loadData = async () => {
            setLoading(true);
            try {
                const [companySnap, usersSnap, customersSnap, templatesSnap] = await Promise.all([
                    getDoc(doc(db, "companies", recentlySelectedCompany)),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "customers"), where("active", "==", true))),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates")),
                ]);

                if (cancelled) return;

                setCompanyDefaults(companySnap.exists() ? companySnap.data() : {});
                setCompanyUsers(sortCompanyUsersByName(usersSnap.docs.map(buildCompanyUserOption)));
                setCustomers(customersSnap.docs.map((customerDoc) => ({
                    id: customerDoc.data().id || customerDoc.id,
                    ...customerDoc.data(),
                })));
                setTemplates(templatesSnap.docs.map((templateDoc) => ({
                    id: templateDoc.data().id || templateDoc.id,
                    ...templateDoc.data(),
                })));
            } catch (error) {
                console.error("Error loading basic work order data:", error);
                toast.error("Could not load work order form data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadData();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany]);

    useEffect(() => {
        if (!currentCompanyUser || canAssignForSelectedMode) return;
        setSelectedAssignee(currentCompanyUser);
    }, [canAssignForSelectedMode, currentCompanyUser]);

    useEffect(() => {
        if (!selectedAssignee && currentCompanyUser) {
            setSelectedAssignee(currentCompanyUser);
        }
    }, [currentCompanyUser, selectedAssignee]);

    useEffect(() => {
        const equipmentName = equipmentContext?.equipmentName || selectedEquipmentName || "equipment";
        const intentDescription = equipmentContext?.equipmentId && jobIntent
            ? `${jobIntent === "repair" ? "Repair" : "Maintenance"} for ${equipmentName}`
            : "";
        const nextDescription =
            defaultDescriptionFromState ||
            repairRequest?.description ||
            equipmentContext?.description ||
            intentDescription;

        if (nextDescription) {
            setDescription((current) => current || nextDescription);
        }
    }, [
        defaultDescriptionFromState,
        equipmentContext,
        jobIntent,
        repairRequest?.description,
        selectedEquipmentName,
    ]);

    useEffect(() => {
        const templateId = searchParams.get("templateId");
        if ((!templateId && !jobIntent) || !templateOptions.length || selectedTemplate) return;
        const matchedTemplate = templateId
            ? templateOptions.find((template) => template.id === templateId)
            : templateOptions.find((template) => templateIntentMatches(template, jobIntent)) || templateOptions[0];
        if (matchedTemplate) setSelectedTemplate(matchedTemplate);
    }, [jobIntent, searchParams, selectedTemplate, templateOptions]);

    useEffect(() => {
        const customerId =
            searchParams.get("customerId") ||
            customerContext?.customerId ||
            customerContext?.id ||
            repairRequest?.customerId ||
            equipmentContext?.customerId ||
            "";
        if (!customerId || !customerOptions.length || selectedCustomer) return;
        const matchedCustomer = customerOptions.find((customer) => customer.id === customerId);
        if (matchedCustomer) setSelectedCustomer(matchedCustomer);
    }, [customerContext, customerOptions, equipmentContext, repairRequest?.customerId, searchParams, selectedCustomer]);

    useEffect(() => {
        if (!selectedCustomer?.id || !recentlySelectedCompany) {
            setServiceLocations([]);
            setSelectedServiceLocation(null);
            setBodyOfWaterList([]);
            setEquipmentList([]);
            setSelectedBodyOfWater(null);
            setSelectedEquipment(null);
            return;
        }

        let cancelled = false;

        const loadServiceLocations = async () => {
            try {
                const locationsSnap = await getDocs(query(
                    collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
                    where("customerId", "==", selectedCustomer.id)
                ));

                if (cancelled) return;

                const locations = locationsSnap.docs.map((locationDoc) => ({
                    id: locationDoc.data().id || locationDoc.id,
                    ...locationDoc.data(),
                }));
                setServiceLocations(locations);

                const queryLocationId =
                    searchParams.get("locationId") ||
                    customerContext?.serviceLocationId ||
                    customerContext?.locationId ||
                    repairRequest?.serviceLocationId ||
                    repairRequest?.locationId ||
                    equipmentContext?.serviceLocationId ||
                    "";
                const preferredLocation = locations.find((location) => location.id === queryLocationId) || locations[0] || null;
                setSelectedServiceLocation(preferredLocation ? {
                    ...preferredLocation,
                    value: preferredLocation.id,
                    label: getServiceLocationLabel(preferredLocation),
                } : null);
            } catch (error) {
                console.error("Error loading service locations:", error);
                toast.error("Could not load service locations.");
            }
        };

        loadServiceLocations();

        return () => {
            cancelled = true;
        };
    }, [customerContext, equipmentContext, recentlySelectedCompany, repairRequest, searchParams, selectedCustomer]);

    useEffect(() => {
        if (!selectedServiceLocation?.id || !recentlySelectedCompany) {
            setBodyOfWaterList([]);
            setEquipmentList([]);
            setSelectedBodyOfWater(null);
            setSelectedEquipment(null);
            setLoadingLocationAssets(false);
            return;
        }

        let cancelled = false;

        const loadLocationAssets = async () => {
            setLoadingLocationAssets(true);
            try {
                const [bodySnap, equipmentSnap] = await Promise.all([
                    getDocs(query(
                        collection(db, "companies", recentlySelectedCompany, "bodiesOfWater"),
                        where("serviceLocationId", "==", selectedServiceLocation.id)
                    )),
                    getDocs(query(
                        collection(db, "companies", recentlySelectedCompany, "equipment"),
                        where("serviceLocationId", "==", selectedServiceLocation.id)
                    )),
                ]);

                if (cancelled) return;

                const bodies = bodySnap.docs
                    .map((bodyDoc) => ({
                        id: bodyDoc.data().id || bodyDoc.id,
                        ...bodyDoc.data(),
                    }))
                    .sort((left, right) => getBodyOfWaterLabel(left).localeCompare(getBodyOfWaterLabel(right)));
                const equipment = equipmentSnap.docs
                    .map((equipmentDoc) => ({
                        id: equipmentDoc.data().id || equipmentDoc.id,
                        ...equipmentDoc.data(),
                    }))
                    .sort((left, right) => getEquipmentLabel(left).localeCompare(getEquipmentLabel(right)));

                setBodyOfWaterList(bodies);
                setEquipmentList(equipment);

                const initialBodyOfWaterId =
                    searchParams.get("bodyOfWaterId") ||
                    customerContext?.bodyOfWaterId ||
                    repairRequest?.bodyOfWaterId ||
                    equipmentContext?.bodyOfWaterId ||
                    "";
                const initialEquipmentId =
                    searchParams.get("equipmentId") ||
                    customerContext?.equipmentId ||
                    repairRequest?.equipmentId ||
                    equipmentContext?.equipmentId ||
                    "";

                setSelectedBodyOfWater((current) => {
                    const matchedInitial = initialBodyOfWaterId
                        ? bodies.find((body) => body.id === initialBodyOfWaterId)
                        : null;
                    if (matchedInitial) {
                        return {
                            ...matchedInitial,
                            value: matchedInitial.id,
                            label: getBodyOfWaterLabel(matchedInitial),
                        };
                    }
                    if (current?.id && bodies.some((body) => body.id === current.id)) return current;
                    return null;
                });

                setSelectedEquipment((current) => {
                    const matchedInitial = initialEquipmentId
                        ? equipment.find((item) => item.id === initialEquipmentId)
                        : null;
                    if (matchedInitial) {
                        return {
                            ...matchedInitial,
                            value: matchedInitial.id,
                            label: getEquipmentLabel(matchedInitial),
                        };
                    }
                    if (current?.id && equipment.some((item) => item.id === current.id)) return current;
                    return null;
                });
            } catch (error) {
                console.error("Error loading location assets:", error);
                toast.error("Could not load equipment for this service location.");
            } finally {
                if (!cancelled) setLoadingLocationAssets(false);
            }
        };

        loadLocationAssets();

        return () => {
            cancelled = true;
        };
    }, [customerContext, equipmentContext, recentlySelectedCompany, repairRequest, searchParams, selectedServiceLocation]);

    useEffect(() => {
        if (!selectedEquipment?.bodyOfWaterId || !bodyOfWaterOptions.length) return;
        const matchedBody = bodyOfWaterOptions.find((body) => body.id === selectedEquipment.bodyOfWaterId);
        if (matchedBody && selectedBodyOfWater?.id !== matchedBody.id) {
            setSelectedBodyOfWater(matchedBody);
        }
    }, [bodyOfWaterOptions, selectedBodyOfWater?.id, selectedEquipment]);

    useEffect(() => {
        if (!selectedTemplate?.id || !recentlySelectedCompany) {
            setTemplateDetails(emptyTemplateDetails());
            setLoadedTemplateDetailsId("");
            setLoadingTemplateDetails(false);
            return;
        }

        let cancelled = false;
        const templateId = selectedTemplate.id;

        const loadTemplateDetails = async () => {
            setLoadingTemplateDetails(true);
            setLoadedTemplateDetailsId("");
            setTemplateDetails(emptyTemplateDetails());
            try {
                const [tasksSnap, stopsSnap, shoppingSnap, laborLinesSnap] = await Promise.all([
                    getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "tasks")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "plannedServiceStops")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "shoppingItems")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "jobTemplates", templateId, "laborLineItems")),
                ]);

                if (cancelled) return;

                setTemplateDetails({
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
                setLoadedTemplateDetailsId(templateId);

                setDescription((current) => current || selectedTemplate.description || "");
            } catch (error) {
                console.error("Error loading template details:", error);
                toast.error("Could not load template details.");
            } finally {
                if (!cancelled) setLoadingTemplateDetails(false);
            }
        };

        loadTemplateDetails();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany, selectedTemplate]);

    const normalizeTemplateTaskForJob = (task, jobId, planId) => ({
        id: `comp_job_task_${uuidv4()}`,
        companyId: recentlySelectedCompany,
        jobId,
        sourcePlanId: planId,
        sourceSolutionId: planId,
        sourceTemplateId: selectedTemplate?.id || "",
        sourceTemplateTaskId: task.id || "",
        name: task.name || task.description || "Task",
        type: canonicalJobTaskType(task.type || "General"),
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
        equipmentId: task.equipmentId || selectedEquipmentId,
        serviceLocationId: selectedServiceLocation?.id || "",
        bodyOfWaterId: task.bodyOfWaterId || resolvedBodyOfWaterId,
        dataBaseItemId: task.dataBaseItemId || "",
        shoppingListItemId: task.shoppingListItemId || "",
        shoppingListItemIds: Array.isArray(task.shoppingListItemIds) ? task.shoppingListItemIds : [],
        sortOrder: Number(task.sortOrder || 0),
    });

    const normalizeCustomTaskForJob = (jobId, planId) => ({
        id: `comp_job_task_${uuidv4()}`,
        companyId: recentlySelectedCompany,
        jobId,
        sourcePlanId: planId,
        sourceSolutionId: planId,
        name: "Custom Work",
        type: "General",
        description: description.trim(),
        contractedRate: 0,
        billingLaborPriceCents: customPriceCents,
        estimatedTime: Number(customEstimatedMinutes || 0),
        status: "Draft",
        customerApproval: false,
        actualTime: 0,
        workerId: "",
        workerType: "Not Assigned",
        workerName: "",
        laborContractId: "",
        serviceStopId: { id: "", internalId: "" },
        equipmentId: selectedEquipmentId,
        serviceLocationId: selectedServiceLocation?.id || "",
        bodyOfWaterId: resolvedBodyOfWaterId,
        dataBaseItemId: "",
        shoppingListItemId: "",
        shoppingListItemIds: [],
        sortOrder: 0,
    });

    const buildPlannedStopsForJob = (jobId, planId, taskIdMap, normalizedTasks) => {
        const plannedStops = mode === "template"
            ? templateDetails.plannedServiceStops.map((stop, index) => {
                const originalTaskIds = laborLineIdArray(
                    stop.taskTemplateIds?.length
                        ? stop.taskTemplateIds
                        : stop.taskIds
                );

                return {
                    id: `comp_job_plan_stop_${uuidv4()}`,
                    companyId: recentlySelectedCompany,
                    jobId,
                    sourcePlanId: planId,
                    sourceSolutionId: planId,
                    sourceTemplateId: selectedTemplate?.id || "",
                    sourceTemplatePlannedStopId: stop.id || "",
                    name: stop.name || stop.serviceStopTypeName || selectedTemplate?.name || "Planned Stop",
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
                    equipmentId: stop.equipmentId || selectedEquipmentId,
                    serviceLocationId: selectedServiceLocation?.id || "",
                    bodyOfWaterId: stop.bodyOfWaterId || resolvedBodyOfWaterId,
                    createdAt: Timestamp.now(),
                    createdByUserId: createdByUserId || "",
                };
            })
            : [];

        if (plannedStops.length > 0) return plannedStops;

        return [{
            id: `comp_job_plan_stop_${uuidv4()}`,
            companyId: recentlySelectedCompany,
            jobId,
            sourcePlanId: planId,
            sourceSolutionId: planId,
            sourceTemplateId: selectedTemplate?.id || "",
            name: selectedTemplate?.name || "Work Order Visit",
            description: description.trim() || selectedTemplate?.description || "",
            serviceStopTypeId: "system_job_service_stop",
            serviceStopTypeName: "Job Visit",
            serviceStopTypeImage: "briefcase",
            serviceStopTypeUseCaseRawValue: "jobVisit",
            estimatedMinutes: Number(customEstimatedMinutes || 0) || normalizedTasks.reduce((total, task) => total + Number(task.estimatedTime || 0), 0) || 60,
            sortOrder: 0,
            taskIds: normalizedTasks.map((task) => task.id),
            plannedLaborCostCents: 0,
            plannedLaborNotes: "",
            equipmentId: selectedEquipmentId,
            serviceLocationId: selectedServiceLocation?.id || "",
            bodyOfWaterId: resolvedBodyOfWaterId,
            createdAt: Timestamp.now(),
            createdByUserId: createdByUserId || "",
        }];
    };

    const normalizeTemplateLaborLineForJob = (line, jobId, planId, taskIdMap, plannedStopIdMap, index) => {
        const quantity = Math.max(Number(line.quantity || line.defaultQuantity || 1) || 1, 1);
        const totalPriceCents = laborLineTotalPriceCents(line);
        const unitPriceCents = laborLineUnitPriceCents(line);
        const sourceTaskIds = getLaborLineTaskIds(line);
        const taskIds = sourceTaskIds.map((taskId) => taskIdMap[taskId]).filter(Boolean);
        const sourcePlannedStopIds = getLaborLinePlannedStopIds(line);
        const plannedServiceStopIds = sourcePlannedStopIds.map((stopId) => plannedStopIdMap[stopId]).filter(Boolean);
        const catalogItemId = laborLineCatalogItemId(line);
        const id = `comp_job_labor_line_${uuidv4()}`;

        return {
            id,
            laborLineId: id,
            companyId: recentlySelectedCompany,
            jobId,
            sourcePlanId: planId,
            sourceSolutionId: planId,
            sourceTemplateId: selectedTemplate?.id || "",
            sourceTemplateLaborLineId: line.id || "",
            name: line.name || line.title || `Service ${index + 1}`,
            description: line.description || "",
            quantity,
            unitPriceCents,
            totalPriceCents,
            internalCostCents: laborLineInternalCostCents(line),
            taskIds,
            laborLineTaskIds: taskIds,
            plannedServiceStopIds,
            laborLinePlannedServiceStopIds: plannedServiceStopIds,
            sourceTemplateTaskIds: sourceTaskIds,
            sourceTemplatePlannedServiceStopIds: sourcePlannedStopIds,
            equipmentId: line.equipmentId || selectedEquipmentId,
            serviceLocationId: selectedServiceLocation?.id || "",
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
            sortOrder: Number(line.sortOrder ?? index),
            createdAt: Timestamp.now(),
            createdByUserId: createdByUserId || "",
        };
    };

    const normalizeShoppingItemForJob = (item, jobId, planId, customerName) => {
        const quantity = item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "1";

        return {
            id: `comp_shop_${uuidv4()}`,
            companyId: recentlySelectedCompany,
            jobId,
            customerId: selectedCustomer.id,
            customerName,
            planId,
            sourcePlanId: planId,
            solutionId: planId,
            sourceSolutionId: planId,
            sourceTemplateId: selectedTemplate?.id || "",
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
            sortOrder: Number(item.sortOrder || 0),
        };
    };

    const buildLineItems = ({ planId, normalizedTasks, normalizedPlannedStops, normalizedShoppingItems, normalizedLaborLineItems = [] }) => ([
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
                    ].filter(Boolean).join(" • "),
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
                    taxable: false,
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
                        sourceType: "serviceStopType",
                        sourceId: stop.serviceStopTypeId || stop.id,
                        salesItemType: "service",
                        billingBehavior: "oneTime",
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
                        sourceType: "task",
                        sourceId: task.id,
                        salesItemType: "labor",
                        billingBehavior: "oneTime",
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
                name: item.name || "Product",
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

    const buildPlanRecord = ({
        planId,
        jobId,
        nextInternalId,
        customerName,
        normalizedTasks,
        normalizedPlannedStops,
        normalizedShoppingItems,
        normalizedLaborLineItems = [],
        nowTimestamp,
        nowMillis,
    }) => {
        const lineItems = buildLineItems({
            planId,
            normalizedTasks,
            normalizedPlannedStops,
            normalizedShoppingItems,
            normalizedLaborLineItems,
        });
        const subtotalAmountCents = lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
        const totalAmountCents = subtotalAmountCents || generatedPriceCents;
        const plannedLaborCostCents = normalizedLaborLineItems.length
            ? normalizedLaborLineItems.reduce((total, line) => total + Number(line.internalCostCents || 0), 0)
            : normalizedTasks.reduce((total, task) => total + Number(task.contractedRate || 0), 0)
                + normalizedPlannedStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
        const plannedLaborPriceCents = normalizedLaborLineItems.length
            ? normalizedLaborLineItems.reduce((total, line) => total + Number(line.totalPriceCents || 0), 0)
            : normalizedTasks.reduce((total, task) => total + getTaskBillingLaborPriceCents(task), 0)
                + normalizedPlannedStops.reduce((total, stop) => total + Number(stop.plannedLaborCostCents || 0), 0);
        const materialCostCents = normalizedShoppingItems.reduce((total, item) => total + plannedMaterialTotalCostCents(item), 0);
        const materialPriceCents = normalizedShoppingItems.reduce((total, item) => total + plannedMaterialTotalPriceCents(item), 0);
        const internalCostCents = plannedLaborCostCents + materialCostCents;
        const projectedProfitCents = totalAmountCents - internalCostCents;
        const profitMarginPercent = totalAmountCents > 0
            ? Math.round((projectedProfitCents / totalAmountCents) * 1000) / 10
            : 0;
        const planTier = DEFAULT_JOB_PLAN_TIER;
        const planTierLabel = getJobPlanRecommendationLabel(planTier);
        const issuePriorityLevel = getTemplateDefaultIssuePriority(selectedTemplate);
        const issuePriorityLabel = getIssuePriorityLabel(issuePriorityLevel);
        const planName = selectedTemplate?.name ? `${selectedTemplate.name} Plan` : "Basic Work Order Plan";

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
            bodyOfWaterName: resolvedBodyOfWaterName,
            equipmentId: selectedEquipmentId,
            equipmentName: selectedEquipmentName,
            equipmentIds: selectedEquipmentId ? [selectedEquipmentId] : [],
            sourceType: selectedTemplate?.id ? "template" : "basicCustomWorkOrder",
            sourceTemplateId: selectedTemplate?.id || "",
            sourceTemplateName: selectedTemplate?.name || "",
            title: planName,
            name: planName,
            planName,
            description: description.trim() || selectedTemplate?.description || "",
            status: JOB_PLAN_STATUS.DRAFT,
            planTier,
            planTierLabel,
            solutionTier: planTier,
            solutionTierLabel: planTierLabel,
            recommendationRank: planTier,
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
                pricingSource: selectedTemplate?.id ? "templateGeneratedPrice" : "basicCustomPrice",
                lineItemCount: lineItems.length,
                subtotalAmountCents,
                totalAmountCents,
                projectedProfitCents,
                profitMarginPercent,
            },
            scopeOfWork: {
                title: planName,
                customerDescription: description.trim() || selectedTemplate?.description || "",
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
                    taskIds: Array.isArray(line.taskIds) ? line.taskIds : [],
                    plannedServiceStopIds: [],
                    equipmentId: line.equipmentId || "",
                    serviceLocationId: line.serviceLocationId || "",
                    bodyOfWaterId: line.bodyOfWaterId || "",
                })),
                materialSummaries: normalizedShoppingItems.map((item, index) => ({
                    id: item.id,
                    sortOrder: Number(item.sortOrder ?? index),
                    name: item.name || `Product ${index + 1}`,
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
    };

    const createScheduledServiceStop = async ({
        jobId,
        jobInternalId,
        normalizedTasks,
        selectedPlannedStop,
        scheduledDate,
    }) => {
        const stopId = `comp_ss_${uuidv4()}`;
        const stopRef = doc(db, "companies", recentlySelectedCompany, "serviceStops", stopId);
        const counterRef = doc(db, "companies", recentlySelectedCompany, "settings", "recurringServiceStops");
        const counterSnap = await getDoc(counterRef);
        const currentCount = counterSnap.exists() ? Number(counterSnap.data().increment || 0) : 0;
        const nextCount = currentCount + 1;
        const serviceStopInternalId = `SS${currentCount}`;
        const taskIdsForStop = Array.isArray(selectedPlannedStop?.taskIds) && selectedPlannedStop.taskIds.length
            ? selectedPlannedStop.taskIds
            : normalizedTasks.map((task) => task.id);
        const scheduledTasks = normalizedTasks.filter((task) => taskIdsForStop.includes(task.id));
        const duration = Number(selectedPlannedStop?.estimatedMinutes || 0)
            || scheduledTasks.reduce((total, task) => total + Number(task.estimatedTime || 0), 0)
            || Number(customEstimatedMinutes || 0)
            || 60;
        const payTypeId = selectedPlannedStop?.payTypeId || selectedPlannedStop?.serviceStopTypeId || "system_job_service_stop";
        const payTypeName = selectedPlannedStop?.payTypeName || selectedPlannedStop?.serviceStopTypeName || "Job Visit";

        await setDoc(counterRef, { increment: nextCount }, { merge: true });

        const stopRecord = {
            id: stopId,
            address: selectedServiceLocation.address || {},
            companyId: recentlySelectedCompany,
            companyName: recentlySelectedCompanyName,
            customerId: selectedCustomer.id,
            customerName: selectedCustomer.label || "",
            dateCreated: Timestamp.now(),
            serviceDate: Timestamp.fromDate(scheduledDate),
            description: selectedPlannedStop?.description || description.trim() || selectedTemplate?.description || "",
            estimatedDuration: duration,
            operationStatus: "Not Finished",
            billingStatus: "Not Invoiced",
            isInvoiced: false,
            contractedCompanyId: "",
            jobId,
            jobName: jobInternalId,
            serviceLocationId: selectedServiceLocation.id,
            bodyOfWaterId: resolvedBodyOfWaterId,
            bodyOfWaterName: resolvedBodyOfWaterName,
            equipmentId: selectedEquipmentId,
            equipmentIds: selectedEquipmentId ? [selectedEquipmentId] : [],
            equipmentName: selectedEquipmentName,
            tech: selectedAssignee.userName,
            techId: selectedAssignee.userId,
            internalId: serviceStopInternalId,
            checkList: [],
            mainCompanyId: "",
            otherCompany: false,
            laborContractId: "",
            endTime: null,
            startTime: null,
            includeDosages: true,
            includeReadings: true,
            estimatedPayCents: 0,
            estimatedPayLines: [],
            payTypeId,
            payTypeName,
            manualPayOverrideCents: null,
            manualPayOverrideNotes: "",
            plannedServiceStopId: selectedPlannedStop?.id || "",
            rate: scheduledTasks.reduce((total, task) => total + Number(task.contractedRate || 0), 0),
            recurringServiceStopId: "",
            type: selectedPlannedStop?.serviceStopTypeName || "Job Visit",
            typeId: selectedPlannedStop?.serviceStopTypeId || "system_job_service_stop",
            typeImage: selectedPlannedStop?.serviceStopTypeImage || "briefcase",
            category: "Job",
            serviceStopTypeUseCaseRawValue: selectedPlannedStop?.serviceStopTypeUseCaseRawValue || "jobVisit",
            source: "BasicWorkOrderCreate",
            serviceNotes: "",
            duration,
        };

        await setDoc(stopRef, stopRecord);

        for (const task of scheduledTasks) {
            const serviceStopTaskId = `comp_ss_tas_${uuidv4()}`;
            await setDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", stopId, "tasks", serviceStopTaskId), {
                ...task,
                id: serviceStopTaskId,
                workerId: selectedAssignee.userId,
                workerName: selectedAssignee.userName,
                status: "Scheduled",
                serviceStopId: {
                    id: stopId,
                    internalId: serviceStopInternalId,
                },
                jobId: {
                    id: jobId || "",
                    internalId: jobInternalId || "",
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

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", task.id), {
                status: "Scheduled",
                workerId: selectedAssignee.userId,
                workerName: selectedAssignee.userName,
                workerType: selectedAssignee.workerType || "Assigned",
                serviceStopId: {
                    id: stopId,
                    internalId: serviceStopInternalId,
                },
                serviceStopIdString: stopId,
            });
        }

        if (selectedPlannedStop?.id) {
            await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plannedServiceStops", selectedPlannedStop.id), {
                serviceStopId: stopId,
                scheduledServiceStopId: stopId,
                convertedServiceStopId: stopId,
                scheduledServiceStopInternalId: serviceStopInternalId,
                scheduledDate: Timestamp.fromDate(scheduledDate),
                assignedTechId: selectedAssignee.userId,
                assignedTechName: selectedAssignee.userName,
            });
        }

        await updateDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), {
            serviceStopIds: arrayUnion(stopId),
            scheduledServiceStopId: stopId,
            scheduledServiceStopInternalId: serviceStopInternalId,
            assignedTechId: selectedAssignee.userId,
            assignedTechName: selectedAssignee.userName,
            operationStatus: "Scheduled",
        });

        return { stopId, serviceStopInternalId };
    };

    const handleCreate = async () => {
        if (!hasAnyBasicPermission) {
            await appAlert("You do not have permission to create basic work orders.");
            return;
        }

        if (!selectedModeAllowed) {
            await appAlert("You do not have permission for this work order type.");
            return;
        }

        if (mode === "template" && selectedTemplate?.id && !templateDetailsReady) {
            await appAlert("Template details are still loading. Please wait for the template scope to finish loading before creating the work order.");
            return;
        }

        if (selectedTemplateLaborLinesMissing) {
            await appAlert(`This template says it has ${expectedTemplateLaborLineCount} service line${expectedTemplateLaborLineCount === 1 ? "" : "s"}, but none loaded. Re-select the template and try again.`);
            return;
        }

        if (mode === "template" && selectedTemplateRequiresEquipment && !selectedEquipmentId) {
            await appAlert("Select equipment before creating this template work order.");
            return;
        }

        if (mode === "template" && selectedTemplateRequiresBodyOfWater && !resolvedBodyOfWaterId) {
            await appAlert("Select a body of water before creating this template work order.");
            return;
        }

        if (!canCreate) {
            await appAlert("Pick a template or custom work order, customer, service location, technician, scheduled time, and assigned admin.");
            return;
        }

        if (!canAssignForSelectedMode && selectedAssignee?.userId !== currentCompanyUser?.userId) {
            await appAlert("You can only assign this work order to yourself.");
            setSelectedAssignee(currentCompanyUser);
            return;
        }

        const scheduledDate = new Date(scheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) {
            await appAlert("Choose a valid scheduled date and time.");
            return;
        }

        setCreating(true);

        try {
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
            const customerName = selectedCustomer.label || getCustomerDisplayName(selectedCustomer);

            await setDoc(workOrderCounterRef, { increment: nextCount }, { merge: true });

            const normalizedTasks = mode === "template"
                ? templateDetails.tasks.map((task) => normalizeTemplateTaskForJob(task, jobId, planId))
                : [normalizeCustomTaskForJob(jobId, planId)];
            const taskIdMap = templateDetails.tasks.reduce((map, task, index) => ({
                ...map,
                [task.id]: normalizedTasks[index]?.id,
            }), {});
            const normalizedPlannedStops = buildPlannedStopsForJob(jobId, planId, taskIdMap, normalizedTasks);
            const plannedStopIdMap = normalizedPlannedStops.reduce((map, stop) => ({
                ...map,
                [stop.sourceTemplatePlannedStopId || stop.id]: stop.id,
            }), {});
            const normalizedLaborLineItems = mode === "template"
                ? templateDetails.laborLineItems.map((line, index) => (
                    normalizeTemplateLaborLineForJob(line, jobId, planId, taskIdMap, plannedStopIdMap, index)
                ))
                : [];
            const normalizedShoppingItems = mode === "template"
                ? templateDetails.shoppingItems.map((item) => normalizeShoppingItemForJob(item, jobId, planId, customerName))
                : [];
            const starterPlanRecord = buildPlanRecord({
                planId,
                jobId,
                nextInternalId,
                customerName,
                normalizedTasks,
                normalizedPlannedStops,
                normalizedShoppingItems,
                normalizedLaborLineItems,
                nowTimestamp,
                nowMillis,
            });
            const issuePriorityLevel = getTemplateDefaultIssuePriority(selectedTemplate);
            const issuePriorityLabel = getIssuePriorityLabel(issuePriorityLevel);
            const starterPlanTierLabel = getJobPlanRecommendationLabel(DEFAULT_JOB_PLAN_TIER);
            const jobData = {
                id: jobId,
                internalId: nextInternalId,
                type: selectedTemplate?.jobType || selectedTemplate?.type || (mode === "template" ? "Template Work Order" : "Custom Work Order"),
                dateCreated: nowTimestamp,
                updatedAt: nowTimestamp,
                updatedAtMillis: nowMillis,
                lastHistoryEventTitle: "Basic work order created",
                lastHistoryEventType: "Created",
                description: description.trim() || selectedTemplate?.description || "",
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
                activePlanTierLabel: starterPlanTierLabel,
                acceptedPlanId: "",
                activeSolutionId: planId,
                activeSolutionTier: DEFAULT_JOB_PLAN_TIER,
                activeSolutionTierLabel: starterPlanTierLabel,
                acceptedSolutionId: "",
                planSelectionStatus: "Draft",
                solutionSelectionStatus: "Draft",
                customerId: selectedCustomer.id,
                customerName,
                serviceLocationId: selectedServiceLocation.id,
                serviceLocationName: selectedServiceLocation.label || "",
                bodyOfWaterId: resolvedBodyOfWaterId,
                bodyOfWaterName: resolvedBodyOfWaterName,
                equipmentId: selectedEquipmentId,
                equipmentName: selectedEquipmentName,
                equipmentIds: selectedEquipmentId ? [selectedEquipmentId] : [],
                serviceStopIds: [],
                laborContractIds: [],
                adminId: resolvedAdmin.id,
                adminName: resolvedAdmin.name,
                adminAssignmentSource: resolvedAdmin.source,
                purchasedItemsIds: [],
                rate: starterPlanRecord.totalAmountCents || generatedPriceCents,
                laborCost: starterPlanRecord.plannedLaborCostCents || generatedInternalCostCents,
                plannedLaborPriceCents: starterPlanRecord.plannedLaborPriceCents || 0,
                plannedMaterialCostCents: starterPlanRecord.materialCostCents || 0,
                plannedMaterialPriceCents: starterPlanRecord.materialPriceCents || 0,
                estimateSubtotalCents: starterPlanRecord.subtotalAmountCents || 0,
                estimateTotalCents: starterPlanRecord.totalAmountCents || generatedPriceCents,
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
                repairRequestId: repairRequest?.id || "",
                repairRequestSourcePath: repairRequest?.id ? repairRequestSourcePath : "",
                sourceTemplateId: selectedTemplate?.id || "",
                sourceTemplateName: selectedTemplate?.name || "",
                createdFromBasicWorkOrderForm: true,
                createdFromCustomerDetail,
                createdFromEquipmentCard,
                createdFromEquipmentDetail,
                basicWorkOrderMode: mode,
                equipmentContext: equipmentContext || null,
                customerContext: customerContext || null,
                jobIntent,
                assignedTechId: selectedAssignee.userId,
                assignedTechName: selectedAssignee.userName,
                assignedCompanyUserId: selectedAssignee.id,
                scheduledAt: Timestamp.fromDate(scheduledDate),
                scheduledDate: Timestamp.fromDate(scheduledDate),
                customerRegionTags: normalizeCustomerTags(selectedCustomer.tags || []),
                assignedTechRegionTags: selectedAssigneeRegionalTags,
                createdByUserId,
                createdByUserName,
            };

            await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId), jobData);
            await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "plans", planId), starterPlanRecord);

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

            if (repairRequest?.id) {
                const repairRequestRef = repairRequestSourcePath === "homeowner"
                    ? doc(db, "homeownerRepairRequests", repairRequest.id)
                    : doc(db, "companies", recentlySelectedCompany, "repairRequests", repairRequest.id);

                await updateDoc(repairRequestRef, {
                    jobIds: arrayUnion(jobId),
                    status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
                    updatedAt: serverTimestamp(),
                });
            }

            const preferredPlannedStop = normalizedPlannedStops[0] || null;
            const scheduledStop = await createScheduledServiceStop({
                jobId,
                jobInternalId: nextInternalId,
                normalizedTasks,
                selectedPlannedStop: preferredPlannedStop,
                scheduledDate,
            });

            const historyId = `comp_job_hist_${uuidv4()}`;
            await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "history", historyId), {
                id: historyId,
                companyId: recentlySelectedCompany,
                jobId,
                jobInternalId: nextInternalId,
                eventType: "Created",
                title: "Basic work order created",
                description: repairRequest?.id
                    ? `Created from repair request: ${repairRequest.description || repairRequest.id}`
                    : selectedTemplate?.name
                        ? `Created from technician template: ${selectedTemplate.name}`
                        : "Created from the basic custom work order form.",
                changes: [
                    { field: "adminName", label: "Admin", before: "-", after: resolvedAdmin.name || "-" },
                    { field: "assignedTechName", label: "Technician", before: "-", after: selectedAssignee.userName || "-" },
                    { field: "customerName", label: "Customer", before: "-", after: customerName || "-" },
                    { field: "serviceLocationName", label: "Service Location", before: "-", after: selectedServiceLocation.label || "-" },
                    ...(resolvedBodyOfWaterName
                        ? [{ field: "bodyOfWaterName", label: "Body Of Water", before: "-", after: resolvedBodyOfWaterName }]
                        : []),
                    ...(selectedEquipmentName
                        ? [{ field: "equipmentName", label: "Equipment", before: "-", after: selectedEquipmentName }]
                        : []),
                    { field: "scheduledAt", label: "Scheduled Time", before: "-", after: scheduledDate.toLocaleString() },
                    { field: "laborLineItems", label: "Service Lines", before: "-", after: String(normalizedLaborLineItems.length) },
                    { field: "rate", label: "Generated Price", before: "-", after: moneyFromCents(starterPlanRecord.totalAmountCents || generatedPriceCents) },
                ],
                metadata: {
                    sourceTemplateId: selectedTemplate?.id || "",
                    sourceTemplateName: selectedTemplate?.name || "",
                    repairRequestId: repairRequest?.id || "",
                    repairRequestSourcePath: repairRequest?.id ? repairRequestSourcePath : "",
                    starterPlanId: planId,
                    activePlanId: planId,
                    activeSolutionId: planId,
                    scheduledServiceStopId: scheduledStop.stopId,
                    scheduledServiceStopInternalId: scheduledStop.serviceStopInternalId,
                    bodyOfWaterId: resolvedBodyOfWaterId,
                    bodyOfWaterName: resolvedBodyOfWaterName,
                    equipmentId: selectedEquipmentId,
                    equipmentName: selectedEquipmentName,
                    laborLineCount: normalizedLaborLineItems.length,
                    createdFromBasicWorkOrderForm: true,
                    createdFromCustomerDetail,
                    createdFromEquipmentCard,
                    createdFromEquipmentDetail,
                    basicWorkOrderMode: mode,
                    jobIntent,
                    adminAssignmentSource: resolvedAdmin.source,
                },
                severity: "success",
                actorUserId: createdByUserId || "",
                actorUserName: createdByUserName,
                actorCompanyUserId: currentCompanyUser?.id || "",
                createdAt: serverTimestamp(),
                createdAtMillis: nowMillis,
            });

            toast.success("Work order scheduled.");
            navigate(`/company/jobs/detail/${jobId}`);
        } catch (error) {
            console.error("Error creating basic work order:", error);
            toast.error("Failed to create work order.");
        } finally {
            setCreating(false);
        }
    };

    if (!permissionsReady || loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
                <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm">
                    Loading basic work order form...
                </div>
            </div>
        );
    }

    if (!hasAnyBasicPermission) {
        return (
            <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center bg-slate-50 px-4 text-center">
                <h1 className="text-2xl font-bold text-slate-950">Permission Required</h1>
                <p className="mt-2 text-sm text-slate-600">
                    Your role needs a basic template or custom work-order permission before you can use this form.
                </p>
                <Link to="/company/jobs" className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                    Back to Jobs
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl space-y-5">
                <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <Link to="/company/jobs" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
                            Back to Jobs
                        </Link>
                        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Basic Work Order</h1>
                        <p className="mt-1 text-sm text-slate-500">
                            Schedule technician-safe work orders without the full billing and job setup workflow.
                        </p>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-right shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated Price</p>
                        <p className="mt-1 text-2xl font-bold text-slate-950">{moneyFromCents(generatedPriceCents)}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                    <div className="space-y-5">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div>
                                <h2 className="text-base font-semibold text-slate-950">Work Order Type</h2>
                                <p className="mt-1 text-sm text-slate-500">Choose a technician-enabled template or a small custom work order.</p>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => canUseTemplate && setMode("template")}
                                    disabled={!canUseTemplate}
                                    className={[
                                        "rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                                        mode === "template" ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                                    ].join(" ")}
                                >
                                    <p className="font-semibold">Template</p>
                                    <p className="mt-1 text-sm">Use approved scope, tasks, stops, materials, and generated price.</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => canUseCustom && setMode("custom")}
                                    disabled={!canUseCustom}
                                    className={[
                                        "rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                                        mode === "custom" ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                                    ].join(" ")}
                                >
                                    <p className="font-semibold">Custom</p>
                                    <p className="mt-1 text-sm">Create one simple work item with a basic price and scheduled visit.</p>
                                </button>
                            </div>
                        </section>

                        {mode === "template" ? (
                            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Job Template</span>
                                    <div className="mt-2">
                                        <Select
                                            value={selectedTemplate}
                                            options={templateOptions}
                                            onChange={setSelectedTemplate}
                                            placeholder="Choose a technician-enabled prebuilt job..."
                                            styles={selectStyles}
                                            isLoading={loadingTemplateDetails}
                                        />
                                    </div>
                                </label>
	                                {selectedTemplate && (
	                                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
	                                        <Metric label="Tasks" value={templateDetails.tasks.length} />
	                                        <Metric label="Stops" value={templateDetails.plannedServiceStops.length || 1} />
	                                        <Metric label="Service Lines" value={templateDetails.laborLineItems.length} />
	                                        <Metric label="Products" value={templateDetails.shoppingItems.length} />
	                                        <Metric label="Price" value={moneyFromCents(templateGeneratedPriceCents)} />
	                                    </div>
	                                )}
                                    {selectedTemplate && loadingTemplateDetails && (
                                        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                                            Loading template services, tasks, stops, and materials...
                                        </p>
                                    )}
                                    {selectedTemplateLaborLinesMissing && (
                                        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                            This template reports {expectedTemplateLaborLineCount} service line{expectedTemplateLaborLineCount === 1 ? "" : "s"}, but none loaded.
                                        </p>
                                    )}
                                    {selectedTemplate && (selectedTemplateRequiresEquipment || selectedTemplateRequiresBodyOfWater) && (
                                        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                            This template needs {[
                                                selectedTemplateRequiresEquipment ? "equipment" : "",
                                                selectedTemplateRequiresBodyOfWater ? "body of water" : "",
                                            ].filter(Boolean).join(" and ")} before it can be scheduled.
                                        </p>
                                    )}
	                                {!selectedTemplate && templateOptions.length === 0 && (
	                                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
	                                        No active templates are marked as technician-enabled yet.
	                                    </p>
                                )}
                            </section>
                        ) : (
                            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block">
                                        <span className="text-sm font-semibold text-slate-700">Estimated Customer Price</span>
                                        <input
                                            value={customPrice}
                                            onChange={(event) => setCustomPrice(event.target.value)}
                                            className={inputBase}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-sm font-semibold text-slate-700">Estimated Minutes</span>
                                        <input
                                            value={customEstimatedMinutes}
                                            onChange={(event) => setCustomEstimatedMinutes(event.target.value)}
                                            className={inputBase}
                                            type="number"
                                            min="1"
                                            step="1"
                                        />
                                    </label>
                                </div>
                            </section>
                        )}

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Customer</span>
                                    <div className="mt-2">
                                        <Select
                                            value={selectedCustomer}
                                            options={customerOptions}
                                            onChange={(option) => {
                                                setSelectedCustomer(option);
                                                setSelectedServiceLocation(null);
                                                setSelectedBodyOfWater(null);
                                                setSelectedEquipment(null);
                                            }}
                                            placeholder="Choose customer..."
                                            styles={selectStyles}
                                        />
                                    </div>
                                </label>
	                                <label className="block">
	                                    <span className="text-sm font-semibold text-slate-700">Service Location</span>
	                                    <div className="mt-2">
	                                        <Select
	                                            value={selectedServiceLocation}
	                                            options={serviceLocationOptions}
	                                            onChange={(option) => {
                                                    setSelectedServiceLocation(option);
                                                    setSelectedBodyOfWater(null);
                                                    setSelectedEquipment(null);
                                                }}
	                                            placeholder="Choose service location..."
	                                            styles={selectStyles}
	                                            isDisabled={!selectedCustomer}
	                                        />
	                                    </div>
	                                </label>
                                    <label className="block">
                                        <span className="text-sm font-semibold text-slate-700">
                                            Body Of Water {selectedTemplateRequiresBodyOfWater ? <span className="text-rose-600">*</span> : null}
                                        </span>
                                        <div className="mt-2">
                                            <Select
                                                value={selectedBodyOfWater}
                                                options={bodyOfWaterOptions}
                                                onChange={setSelectedBodyOfWater}
                                                placeholder="Choose body of water..."
                                                styles={selectStyles}
                                                isDisabled={!selectedServiceLocation || loadingLocationAssets}
                                                isLoading={loadingLocationAssets}
                                                isClearable={!selectedTemplateRequiresBodyOfWater}
                                            />
                                        </div>
                                    </label>
                                    <label className="block">
                                        <span className="text-sm font-semibold text-slate-700">
                                            Equipment {selectedTemplateRequiresEquipment ? <span className="text-rose-600">*</span> : null}
                                        </span>
                                        <div className="mt-2">
                                            <Select
                                                value={selectedEquipment}
                                                options={equipmentOptions}
                                                onChange={setSelectedEquipment}
                                                placeholder="Choose equipment..."
                                                styles={selectStyles}
                                                isDisabled={!selectedServiceLocation || loadingLocationAssets}
                                                isLoading={loadingLocationAssets}
                                                isClearable={!selectedTemplateRequiresEquipment}
                                            />
                                        </div>
                                    </label>
	                                <label className="block">
	                                    <span className="text-sm font-semibold text-slate-700">Technician</span>
	                                    <div className="mt-2">
                                        <Select
                                            value={selectedAssignee}
                                            options={assigneeOptions}
                                            onChange={setSelectedAssignee}
                                            placeholder="Choose technician..."
                                            styles={selectStyles}
                                            isDisabled={!canAssignForSelectedMode}
                                        />
                                    </div>
                                </label>
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700">Scheduled Time</span>
                                    <input
                                        value={scheduledAt}
                                        onChange={(event) => setScheduledAt(event.target.value)}
                                        className={`mt-2 ${inputBase}`}
                                        type="datetime-local"
                                    />
                                </label>
                            </div>

                            <label className="mt-4 block">
                                <span className="text-sm font-semibold text-slate-700">Work Notes</span>
                                <textarea
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                    className={`mt-2 min-h-28 ${inputBase}`}
                                    placeholder="What should the technician do?"
                                />
                            </label>
                        </section>
                    </div>

                    <aside className="space-y-5">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="text-base font-semibold text-slate-950">Assignment</h2>
                            <div className="mt-4 space-y-3 text-sm">
                                <Detail label="Technician" value={selectedAssignee?.userName || "Not selected"} />
                                <Detail label="Assigned Admin" value={resolvedAdmin?.name || "Not assigned"} />
                                <Detail label="Admin Source" value={resolvedAdmin?.source || "Set a user admin or company default"} />
                                <Detail label="Regional Tags" value={selectedAssigneeRegionalTags.join(", ") || "Full access or no tags"} />
                            </div>
                            {!resolvedAdmin?.id && (
                                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    Assign a work-order admin to this technician or set a company default admin before creating the work order.
                                </p>
                            )}
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="text-base font-semibold text-slate-950">Summary</h2>
                            <div className="mt-4 space-y-3 text-sm">
	                                <Detail label="Mode" value={mode === "template" ? "Template" : "Custom"} />
	                                <Detail label="Customer" value={selectedCustomer?.label || "Not selected"} />
	                                <Detail label="Location" value={selectedServiceLocation?.label || "Not selected"} />
                                    <Detail label="Body Of Water" value={resolvedBodyOfWaterName || (selectedTemplateRequiresBodyOfWater ? "Required" : "Not selected")} />
                                    <Detail label="Equipment" value={selectedEquipmentName || (selectedTemplateRequiresEquipment ? "Required" : "Not selected")} />
	                                <Detail label="Price" value={moneyFromCents(generatedPriceCents)} />
	                            </div>
	                            <button
	                                type="button"
	                                onClick={handleCreate}
	                                disabled={!canCreate || creating || loadingTemplateDetails}
	                                className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
	                            >
	                                {creating ? "Scheduling..." : loadingTemplateDetails ? "Loading Template..." : "Create and Schedule"}
	                            </button>
                            <Link
                                to="/company/jobs"
                                className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                                Cancel
                            </Link>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
};

const Metric = ({ label, value }) => (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 font-bold text-slate-950">{value}</p>
    </div>
);

const Detail = ({ label, value }) => (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
        <span className="text-slate-500">{label}</span>
        <span className="max-w-[190px] text-right font-semibold text-slate-900">{value || "Not set"}</span>
    </div>
);

export default BasicWorkOrderCreate;
