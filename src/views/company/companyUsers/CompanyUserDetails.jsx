import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { addDoc, doc, query, where, collection, getDocs, getDoc, limit, updateDoc, orderBy, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import Select from "react-select";
import {
    ArrowLeftIcon,
    BriefcaseIcon,
    CheckIcon,
    ChatBubbleBottomCenterTextIcon,
    ClipboardDocumentCheckIcon,
    ClipboardDocumentListIcon,
    ClockIcon,
    CurrencyDollarIcon,
    DocumentTextIcon,
    EyeIcon,
    EyeSlashIcon,
    ListBulletIcon,
    MapIcon,
    PaperClipIcon,
    PencilSquareIcon,
    PlusIcon,
    SparklesIcon,
    StarIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import toast from "react-hot-toast";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { CompanyUserStatus, WorkerTypeEnum } from "../../../utils/models/CompanyUser";

const VEHICLE_TYPES = ["Car", "Truck", "Van"];

const emptyPersonalVehicle = {
    nickName: "",
    vehicalType: "Car",
    year: "",
    make: "",
    model: "",
    color: "",
    plate: "",
    miles: "",
};

const workerTypeOptions = [
    { value: WorkerTypeEnum.employee, label: WorkerTypeEnum.employee },
    { value: WorkerTypeEnum.contractor, label: WorkerTypeEnum.contractor },
];

const statusOptions = [
    { value: CompanyUserStatus.active, label: CompanyUserStatus.active },
    { value: CompanyUserStatus.pending, label: CompanyUserStatus.pending },
    { value: CompanyUserStatus.past, label: CompanyUserStatus.past },
];

const companyUserSections = [
    { id: "general", label: "General", helper: "Profile, role, route access, and rate sheet" },
    { id: "activity", label: "Activity", helper: "Recent service stops, routes, and statements" },
    { id: "onboarding", label: "Onboarding", helper: "Setup list and completion tracking" },
    { id: "performance", label: "Performance", helper: "Internal reviews, references, and shared reports", permissionId: "260" },
];

const validCompanyUserTabs = companyUserSections.map((section) => section.id);

const performanceLineTypes = [
    { value: "kudo", label: "Praise" },
    { value: "complaint", label: "Complaint" },
    { value: "coaching", label: "Coaching" },
    { value: "observation", label: "Observation" },
];

const emptyPerformanceDraft = {
    type: "kudo",
    note: "",
    referenceStopIds: [],
    referenceJobIds: [],
    reportTitle: "",
    reportUrl: "",
    reportNotes: "",
    reportTechnicianVisible: false,
};

const emptySummaryDraft = {
    title: "Technician Performance Summary",
    body: "",
    technicianVisible: true,
};

const DEFAULT_ONBOARDING_TEMPLATE_ITEMS = [
    {
        id: "default_invite_access",
        name: "Confirm company access",
        description: "Verify the user accepted the invite and can access the selected company.",
        sortOrder: 10,
    },
    {
        id: "default_profile",
        name: "Complete profile",
        description: "Confirm name, email, phone, photo, and basic profile details are filled in.",
        sortOrder: 20,
    },
    {
        id: "default_role_permissions",
        name: "Review role and permissions",
        description: "Assign the correct company role and confirm the user has the access they need.",
        sortOrder: 30,
    },
    {
        id: "default_payroll",
        name: "Review payroll setup",
        description: "Confirm worker type, rate sheet, payroll settings, and any required tax paperwork.",
        sortOrder: 40,
    },
    {
        id: "default_field_training",
        name: "Complete field orientation",
        description: "Review route workflow, service stop expectations, photos, notes, safety, and chemical handling.",
        sortOrder: 50,
    },
];

const selectStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: "40px",
        borderColor: state.isFocused ? "#2563eb" : "#cbd5e1",
        borderRadius: "0.5rem",
        boxShadow: state.isFocused ? "0 0 0 3px rgba(37, 99, 235, 0.12)" : "none",
        "&:hover": {
            borderColor: state.isFocused ? "#2563eb" : "#94a3b8",
        },
    }),
    menu: (base) => ({ ...base, zIndex: 20 }),
};

const inputBase = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100";

const normalizeStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "active") return CompanyUserStatus.active;
    if (normalized === "pending") return CompanyUserStatus.pending;
    if (normalized === "past" || normalized === "inactive") return CompanyUserStatus.past;
    return status || CompanyUserStatus.active;
};

const normalizeWorkerType = (workerType) => {
    const normalized = String(workerType || "").trim().toLowerCase();
    if (normalized.includes("contractor")) return WorkerTypeEnum.contractor;
    if (normalized.includes("employee")) return WorkerTypeEnum.employee;
    return workerType || WorkerTypeEnum.employee;
};

const getStatusClass = (status) => {
    switch (normalizeStatus(status)) {
        case CompanyUserStatus.active:
            return "bg-emerald-50 text-emerald-700 ring-emerald-200";
        case CompanyUserStatus.pending:
            return "bg-amber-50 text-amber-700 ring-amber-200";
        case CompanyUserStatus.past:
            return "bg-slate-100 text-slate-600 ring-slate-200";
        default:
            return "bg-slate-100 text-slate-700 ring-slate-200";
    }
};

const getDisplayName = (user) => {
    const safeUser = user || {};

    return (
        safeUser.userName ||
        safeUser.displayName ||
        [safeUser.firstName, safeUser.lastName].filter(Boolean).join(" ") ||
        safeUser.email ||
        safeUser.userId ||
        "Company User"
    );
};

const getInitials = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CU";
};

const toDate = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
    const date = toDate(value);
    return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Not set";
};

const formatDateTime = (value) => {
    const date = toDate(value);
    return date
        ? date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        })
        : "Not set";
};

const formatMoneyFromCents = (value) => {
    const amount = Number(value || 0) / 100;
    return Number.isFinite(amount)
        ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" })
        : "$0.00";
};

const formatDollarAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" })
        : "Not set";
};

const labelize = (value) => (
    String(value || "Unknown")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())
);

const getRateStatusClass = (status) => {
    const normalized = String(status || "active").trim().toLowerCase();
    if (normalized === "active") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    if (normalized === "scheduled" || normalized === "offered") return "bg-blue-50 text-blue-700 ring-blue-200";
    if (normalized === "draft" || normalized === "pending") return "bg-amber-50 text-amber-700 ring-amber-200";
    if (normalized === "expired" || normalized === "past" || normalized === "inactive" || normalized === "archived") return "bg-slate-100 text-slate-600 ring-slate-200";
    if (normalized === "rejected") return "bg-rose-50 text-rose-700 ring-rose-200";
    return "bg-slate-100 text-slate-700 ring-slate-200";
};

const activeRateRank = (rate = {}) => {
    const status = String(rate.status || "active").toLowerCase();
    if (status === "active") return 0;
    if (status === "scheduled") return 1;
    if (status === "draft") return 2;
    if (status === "expired") return 3;
    if (status === "archived") return 4;
    return 5;
};

const compareRates = (left = {}, right = {}) => {
    const statusDiff = activeRateRank(left) - activeRateRank(right);
    if (statusDiff !== 0) return statusDiff;
    return (toDate(right.effectiveStartDate)?.getTime() || 0) - (toDate(left.effectiveStartDate)?.getTime() || 0);
};

const sortByRecentDate = (items = [], dateGetter = (item) => item.date) => (
    [...items].sort((left, right) => (toDate(dateGetter(right))?.getTime() || 0) - (toDate(dateGetter(left))?.getTime() || 0))
);

const getCompanyUserLookupIds = (companyUser, routeId) => (
    [...new Set([
        companyUser?.userId,
        companyUser?.id,
        companyUser?.docId,
        routeId,
    ].filter(Boolean).map(String))]
);

const getPrimaryTechnicianId = (companyUser, routeId) => (
    companyUser?.userId || companyUser?.id || routeId || ""
);

const getServiceStopDate = (stop) => (
    stop.serviceDate || stop.date || stop.completedDate || stop.finishedAt || stop.updatedAt || stop.dateCreated
);

const getServiceStopTitle = (stop = {}) => (
    stop.type ||
    stop.serviceStopTypeName ||
    stop.jobName ||
    stop.customerName ||
    "Service Stop"
);

const getServiceStopSubtitle = (stop = {}) => {
    const address = stop.address || {};
    const location = stop.serviceLocationAddress || [
        address.streetAddress,
        address.city,
        address.state,
        address.zip || address.zipCode,
    ].filter(Boolean).join(", ");

    return [stop.customerName, location, stop.operationStatus || stop.status].filter(Boolean).join(" - ");
};

const getRouteDate = (route) => (
    route.date || route.routeDate || route.startTime || route.createdAt || route.updatedAt
);

const getRouteTitle = (route = {}) => (
    route.name ||
    route.routeName ||
    route.techName ||
    "Route"
);

const getRouteSubtitle = (route = {}) => {
    const stops = route.totalStops || route.finishedStops
        ? `${Number(route.finishedStops || 0)}/${Number(route.totalStops || 0)} stops`
        : "";
    const miles = Number(route.distanceMiles ?? route.distance ?? 0);
    const mileage = Number.isFinite(miles) && miles > 0
        ? `${miles.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`
        : "";

    return [route.status, stops, mileage].filter(Boolean).join(" - ");
};

const getStatementDate = (statement) => (
    statement.paidAt || statement.approvedAt || statement.endDate || statement.startDate || statement.createdAt
);

const getStatementTitle = (statement = {}) => (
    statement.statementReference ||
    statement.reference ||
    statement.technicianName ||
    "Pay Statement"
);

const getStatementSubtitle = (statement = {}) => {
    const dateRange = [formatDate(statement.startDate), formatDate(statement.endDate)]
        .filter((value) => value && value !== "Not set")
        .join(" - ");
    const total = statement.totalCents !== undefined
        ? formatMoneyFromCents(statement.totalCents)
        : "";
    const lineCount = statement.lineItemIds?.length
        ? `${statement.lineItemIds.length} line item${statement.lineItemIds.length === 1 ? "" : "s"}`
        : "";

    return [dateRange, total, statement.status ? labelize(statement.status) : "", lineCount].filter(Boolean).join(" - ");
};

const getJobDate = (job) => (
    job.updatedAt || job.dateCreated || job.createdAt || job.dateEstimateAccepted || job.invoiceDate
);

const getJobTitle = (job = {}) => (
    job.internalId
        ? `Job #${job.internalId}`
        : job.type || job.sourceTemplateName || job.customerName || "Job"
);

const getJobSubtitle = (job = {}) => (
    [job.customerName, job.serviceLocationName, job.operationStatus || job.billingStatus].filter(Boolean).join(" - ")
);

const getPerformanceTypeLabel = (type) => (
    type === "sharedReport"
        ? "Shared Report"
        : performanceLineTypes.find((option) => option.value === type)?.label || labelize(type || "note")
);

const getPerformanceTypeClass = (type) => {
    switch (type) {
        case "kudo":
            return "bg-emerald-50 text-emerald-700 ring-emerald-200";
        case "complaint":
            return "bg-rose-50 text-rose-700 ring-rose-200";
        case "coaching":
            return "bg-amber-50 text-amber-700 ring-amber-200";
        case "summary":
        case "sharedReport":
            return "bg-blue-50 text-blue-700 ring-blue-200";
        default:
            return "bg-slate-100 text-slate-700 ring-slate-200";
    }
};

const getVisibilityClass = (visibleToTechnician) => (
    visibleToTechnician
        ? "bg-blue-50 text-blue-700 ring-blue-200"
        : "bg-slate-100 text-slate-600 ring-slate-200"
);

const inactiveStatusValues = new Set(["inactive", "past", "archived", "deleted", "canceled", "cancelled"]);

const isActiveRecurringServiceStop = (stop = {}) => (
    !inactiveStatusValues.has(String(stop.status || stop.operationStatus || "").trim().toLowerCase())
);

const performancePreviewStyle = {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
};

const buildServiceStopReference = (stop = {}) => ({
    id: stop.id,
    type: "serviceStop",
    label: getServiceStopTitle(stop),
    description: getServiceStopSubtitle(stop),
    date: getServiceStopDate(stop) || null,
    path: stop.id ? `/company/serviceStops/detail/${stop.id}` : "",
});

const buildJobReference = (job = {}) => ({
    id: job.id,
    type: "job",
    label: getJobTitle(job),
    description: getJobSubtitle(job),
    date: getJobDate(job) || null,
    path: job.id ? `/company/jobs/detail/${job.id}` : "",
});

const isNonEmptyString = (value) => String(value || "").trim().length > 0;

const performanceReviewsRef = (companyId, companyUserId) => (
    collection(db, "companyUserPerformanceReviews", companyId, "companyUsers", companyUserId, "reviews")
);

const onboardingTemplateItemsRef = (companyId) => (
    collection(db, "companies", companyId, "settings", "onboardingChecklist", "items")
);

const companyUserOnboardingItemsRef = (companyId, companyUserId) => (
    collection(db, "companies", companyId, "companyUsers", companyUserId, "onboardingChecklist")
);

const normalizeOnboardingItem = (item = {}, fallbackOrder = 0) => ({
    id: item.id || "",
    templateItemId: item.templateItemId || item.id || "",
    name: String(item.name || "").trim(),
    description: String(item.description || "").trim(),
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : fallbackOrder,
    active: item.active !== false,
    isComplete: item.isComplete === true,
    dateCompleted: item.dateCompleted || item.completedAt || null,
    completedAt: item.completedAt || item.dateCompleted || null,
    completedByUserId: item.completedByUserId || "",
    completedByName: item.completedByName || "",
});

const safeStorageFileName = (name) => (
    String(name || "attachment")
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 140) || "attachment"
);

const EmptyState = ({ title, description }) => (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
);

const StatTile = ({ icon: Icon, title, value, subtitle }) => (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {Icon && <Icon className="h-4 w-4" />}
            {title}
        </div>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
);

const buildPersonalVehicleForm = (companyUser) => ({
    ...emptyPersonalVehicle,
    ...(companyUser?.personalVehicle || {}),
    miles: companyUser?.personalVehicle?.miles?.toString() || "",
});

const buildProfileDraft = (companyUser) => ({
    roleId: companyUser?.roleId || "",
    roleName: companyUser?.roleName || "",
    status: normalizeStatus(companyUser?.status),
    workerType: normalizeWorkerType(companyUser?.workerType),
});

const Section = ({ title, description, action, children }) => (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h2 className="text-base font-semibold text-slate-950">{title}</h2>
                {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
            {action}
        </div>
        <div className="mt-4">
            {children}
        </div>
    </section>
);

const DetailField = ({ label, value }) => (
    <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-sm font-medium text-slate-900">{value || "Not set"}</p>
    </div>
);

const Badge = ({ children, className = "" }) => (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}>
        {children}
    </span>
);

const CompanyUserDetails = () => {
    const { recentlySelectedCompany, user: authUser, dataBaseUser } = useContext(Context);
    const { can, requirePermission, permissionsReady } = useCompanyPermissions();
    const { companyUserId, tab } = useParams();
    const navigate = useNavigate();

    const getInitialTab = useCallback((tabValue) => (
        validCompanyUserTabs.includes(tabValue) ? tabValue : "general"
    ), []);

    const [user, setUser] = useState(null);
    const [activeTab, setActiveTab] = useState(getInitialTab(tab));
    const [isLoading, setIsLoading] = useState(true);
    const [roleList, setRoleList] = useState([]);
    const [areRolesLoading, setAreRolesLoading] = useState(true);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [profileDraft, setProfileDraft] = useState(buildProfileDraft(null));
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [allowPersonalVehicle, setAllowPersonalVehicle] = useState(false);
    const [personalVehicle, setPersonalVehicle] = useState(emptyPersonalVehicle);
    const [isSavingVehicleAccess, setIsSavingVehicleAccess] = useState(false);
    const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
    const [technicianRates, setTechnicianRates] = useState([]);
    const [legacyRateSheets, setLegacyRateSheets] = useState([]);
    const [isRateSheetLoading, setIsRateSheetLoading] = useState(false);
    const [rateSheetError, setRateSheetError] = useState("");
    const [recentServiceStops, setRecentServiceStops] = useState([]);
    const [assignedRecurringServiceStops, setAssignedRecurringServiceStops] = useState([]);
    const [recentRoutes, setRecentRoutes] = useState([]);
    const [recentJobs, setRecentJobs] = useState([]);
    const [recentStatements, setRecentStatements] = useState([]);
    const [isActivityLoading, setIsActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState("");
    const [performanceReviews, setPerformanceReviews] = useState([]);
    const [isPerformanceLoading, setIsPerformanceLoading] = useState(false);
    const [performanceError, setPerformanceError] = useState("");
    const [performanceDraft, setPerformanceDraft] = useState(emptyPerformanceDraft);
    const [performanceFiles, setPerformanceFiles] = useState([]);
    const [isPerformanceLineModalOpen, setIsPerformanceLineModalOpen] = useState(false);
    const [isSummaryReportModalOpen, setIsSummaryReportModalOpen] = useState(false);
    const [selectedPerformanceReview, setSelectedPerformanceReview] = useState(null);
    const [showAllPerformanceHistory, setShowAllPerformanceHistory] = useState(false);
    const [summaryDraft, setSummaryDraft] = useState(emptySummaryDraft);
    const [isSavingPerformance, setIsSavingPerformance] = useState(false);
    const [isUploadingPerformanceFiles, setIsUploadingPerformanceFiles] = useState(false);
    const [isSavingSummary, setIsSavingSummary] = useState(false);
    const [onboardingItems, setOnboardingItems] = useState([]);
    const [isOnboardingLoading, setIsOnboardingLoading] = useState(false);
    const [onboardingError, setOnboardingError] = useState("");
    const [isInitializingOnboarding, setIsInitializingOnboarding] = useState(false);
    const [updatingOnboardingItemId, setUpdatingOnboardingItemId] = useState("");

    const handleTabChange = useCallback((nextTab) => {
        const normalizedTab = getInitialTab(nextTab);
        setActiveTab(normalizedTab);
        navigate(`/company/companyUsers/${companyUserId}/${normalizedTab}`);
    }, [companyUserId, getInitialTab, navigate]);

    useEffect(() => {
        setActiveTab(getInitialTab(tab));
    }, [tab, getInitialTab]);

    useEffect(() => {
        if (!companyUserId) return;
        if (!tab || !validCompanyUserTabs.includes(tab)) {
            navigate(`/company/companyUsers/${companyUserId}/general`, { replace: true });
        }
    }, [companyUserId, navigate, tab]);

    useEffect(() => {
        if (!recentlySelectedCompany || !companyUserId) return;

        const applyFetchedUser = (userDoc) => {
            const fetchedUser = { ...userDoc.data(), id: userDoc.id };
            setUser(fetchedUser);
            setProfileDraft(buildProfileDraft(fetchedUser));
            setAllowPersonalVehicle(Boolean(fetchedUser.allowPersonalVehicle));
            setPersonalVehicle(buildPersonalVehicleForm(fetchedUser));
        };

        const fetchUser = async () => {
            setIsLoading(true);
            try {
                const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
                const q = query(usersRef, where("userId", "==", companyUserId), limit(1));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    applyFetchedUser(querySnapshot.docs[0]);
                    return;
                }

                const userDoc = await getDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", companyUserId));
                if (userDoc.exists()) {
                    applyFetchedUser(userDoc);
                } else {
                    toast.error("User not found in this company.");
                    navigate("/company/companyUsers");
                }
            } catch (error) {
                console.error("Error fetching user details: ", error);
                toast.error("Failed to load user details.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchUser();
    }, [recentlySelectedCompany, companyUserId, navigate]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setRoleList([]);
            setAreRolesLoading(false);
            return;
        }

        const fetchRoles = async () => {
            setAreRolesLoading(true);
            try {
                const rolesSnapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, "roles"));
                const roles = rolesSnapshot.docs.map((roleDoc) => {
                    const roleData = roleDoc.data();
                    return {
                        ...roleData,
                        id: roleDoc.id,
                        value: roleDoc.id,
                        label: roleData.name || roleData.roleName || "Unnamed Role",
                    };
                });
                setRoleList(roles);
            } catch (error) {
                console.error("Error fetching roles:", error);
                toast.error("Could not load company roles.");
            } finally {
                setAreRolesLoading(false);
            }
        };

        fetchRoles();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user?.id) {
            setCompanyWorkTypes([]);
            setTechnicianRates([]);
            setLegacyRateSheets([]);
            setRateSheetError("");
            setIsRateSheetLoading(false);
            return;
        }

        let cancelled = false;

        const fetchRateSheet = async () => {
            setIsRateSheetLoading(true);
            setRateSheetError("");

            try {
                const lookupIds = getCompanyUserLookupIds(user, companyUserId);
                const technicianRatesRef = collection(db, "companies", recentlySelectedCompany, "technicianRates");
                const rateQuery = lookupIds.length === 1
                    ? query(technicianRatesRef, where("technicianId", "==", lookupIds[0]))
                    : query(technicianRatesRef, where("technicianId", "in", lookupIds.slice(0, 10)));

                const [
                    workTypesSnapshot,
                    technicianRatesSnapshot,
                    legacyRateSheetSnapshot,
                ] = await Promise.all([
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyWorkTypes")),
                    lookupIds.length > 0 ? getDocs(rateQuery) : Promise.resolve({ docs: [] }),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers", user.id, "rateSheet")),
                ]);

                if (cancelled) return;

                setCompanyWorkTypes(
                    workTypesSnapshot.docs
                        .map((workTypeDoc) => ({ id: workTypeDoc.id, ...workTypeDoc.data() }))
                        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.name || "").localeCompare(String(right.name || "")))
                );
                setTechnicianRates(
                    technicianRatesSnapshot.docs
                        .map((rateDoc) => ({ id: rateDoc.id, ...rateDoc.data() }))
                        .sort(compareRates)
                );
                setLegacyRateSheets(
                    sortByRecentDate(
                        legacyRateSheetSnapshot.docs.map((rateDoc) => ({ id: rateDoc.id, ...rateDoc.data() })),
                        (rateSheet) => rateSheet.dateImplemented || rateSheet.createdAt
                    )
                );
            } catch (error) {
                if (cancelled) return;
                console.error("Error loading company user rate sheet:", error);
                setRateSheetError("Could not load this user's rate sheet.");
                setCompanyWorkTypes([]);
                setTechnicianRates([]);
                setLegacyRateSheets([]);
            } finally {
                if (!cancelled) setIsRateSheetLoading(false);
            }
        };

        fetchRateSheet();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany, user, companyUserId]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user?.id) {
            setRecentServiceStops([]);
            setAssignedRecurringServiceStops([]);
            setRecentRoutes([]);
            setRecentJobs([]);
            setRecentStatements([]);
            setActivityError("");
            setIsActivityLoading(false);
            return;
        }

        let cancelled = false;

        const fetchActivity = async () => {
            setIsActivityLoading(true);
            setActivityError("");

            const lookupIds = getCompanyUserLookupIds(user, companyUserId);
            const errors = [];

            const safeGet = async (label, loader) => {
                try {
                    return await loader();
                } catch (error) {
                    console.error(`Error loading ${label}:`, error);
                    errors.push(label);
                    return { docs: [] };
                }
            };

            const buildLookupQuery = (collectionName, fieldName, orderFieldName, maxItems = 8) => {
                const targetIds = lookupIds.slice(0, 10);
                if (targetIds.length === 0) return null;

                const ref = collection(db, "companies", recentlySelectedCompany, collectionName);
                const idFilter = targetIds.length === 1
                    ? where(fieldName, "==", targetIds[0])
                    : where(fieldName, "in", targetIds);

                return query(ref, idFilter, orderBy(orderFieldName, "desc"), limit(maxItems));
            };

            const serviceStopsQuery = buildLookupQuery("serviceStops", "techId", "serviceDate", 8);
            const recurringServiceStopsQuery = (() => {
                const targetIds = lookupIds.slice(0, 10);
                if (targetIds.length === 0) return null;
                const ref = collection(db, "companies", recentlySelectedCompany, "recurringServiceStop");
                const idFilter = targetIds.length === 1
                    ? where("techId", "==", targetIds[0])
                    : where("techId", "in", targetIds);
                return query(ref, idFilter, limit(500));
            })();
            const routesQuery = buildLookupQuery("activeRoutes", "techId", "date", 8);

            const [
                serviceStopsSnapshot,
                recurringServiceStopsSnapshot,
                routesSnapshot,
                statementsSnapshot,
            ] = await Promise.all([
                serviceStopsQuery ? safeGet("recent service stops", () => getDocs(serviceStopsQuery)) : Promise.resolve({ docs: [] }),
                recurringServiceStopsQuery ? safeGet("assigned recurring service stops", () => getDocs(recurringServiceStopsQuery)) : Promise.resolve({ docs: [] }),
                routesQuery ? safeGet("recent routes", () => getDocs(routesQuery)) : Promise.resolve({ docs: [] }),
                safeGet("recent statements", () => getDocs(collection(db, "companies", recentlySelectedCompany, "technicianPayStatements"))),
            ]);

            if (cancelled) return;

            const serviceStops = serviceStopsSnapshot.docs.map((stopDoc) => ({ id: stopDoc.id, ...stopDoc.data() }));
            const linkedJobIds = [...new Set(
                serviceStops
                    .map((stop) => stop.jobId || stop.workOrderId || stop.assignedJobId)
                    .filter(Boolean)
                    .map(String)
            )].slice(0, 10);
            const jobResults = await Promise.all(
                linkedJobIds.map(async (jobId) => {
                    try {
                        const jobSnapshot = await getDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId));
                        return jobSnapshot.exists() ? { id: jobSnapshot.id, ...jobSnapshot.data() } : null;
                    } catch (error) {
                        console.error("Error loading linked job:", error);
                        errors.push("linked jobs");
                        return null;
                    }
                })
            );

            if (cancelled) return;

            setRecentServiceStops(
                serviceStops
            );
            setAssignedRecurringServiceStops(
                recurringServiceStopsSnapshot.docs.map((rssDoc) => ({ id: rssDoc.id, ...rssDoc.data() }))
            );
            setRecentRoutes(
                routesSnapshot.docs.map((routeDoc) => ({ id: routeDoc.id, ...routeDoc.data() }))
            );
            setRecentJobs(
                sortByRecentDate(jobResults.filter(Boolean), getJobDate).slice(0, 8)
            );
            setRecentStatements(
                sortByRecentDate(
                    statementsSnapshot.docs
                        .map((statementDoc) => ({ id: statementDoc.id, ...statementDoc.data() }))
                        .filter((statement) => lookupIds.includes(String(statement.technicianId || ""))),
                    getStatementDate
                ).slice(0, 8)
            );
            const uniqueErrors = [...new Set(errors)];
            setActivityError(uniqueErrors.length > 0 ? `Some work activity sources could not be loaded: ${uniqueErrors.join(", ")}.` : "");
            setIsActivityLoading(false);
        };

        fetchActivity();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany, user, companyUserId]);

    useEffect(() => {
        if (!permissionsReady || activeTab !== "performance" || can("260")) return;

        setActiveTab("general");
        navigate(`/company/companyUsers/${companyUserId}/general`, { replace: true });
    }, [activeTab, can, companyUserId, navigate, permissionsReady]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user?.id || !can("260")) {
            setPerformanceReviews([]);
            setPerformanceError("");
            setIsPerformanceLoading(false);
            return;
        }

        let cancelled = false;

        const fetchPerformanceReviews = async () => {
            setIsPerformanceLoading(true);
            setPerformanceError("");

            try {
                const reviewsSnapshot = await getDocs(query(
                    performanceReviewsRef(recentlySelectedCompany, user.id),
                    orderBy("date", "desc"),
                    limit(50)
                ));

                if (cancelled) return;

                setPerformanceReviews(
                    reviewsSnapshot.docs.map((reviewDoc) => ({ id: reviewDoc.id, ...reviewDoc.data() }))
                );
            } catch (error) {
                if (cancelled) return;
                console.error("Error loading performance reviews:", error);
                setPerformanceError("Could not load performance review history.");
                setPerformanceReviews([]);
            } finally {
                if (!cancelled) setIsPerformanceLoading(false);
            }
        };

        fetchPerformanceReviews();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany, user?.id, can]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user?.id) {
            setOnboardingItems([]);
            setOnboardingError("");
            setIsOnboardingLoading(false);
            return;
        }

        let cancelled = false;

        const fetchOnboardingItems = async () => {
            setIsOnboardingLoading(true);
            setOnboardingError("");

            try {
                const onboardingSnapshot = await getDocs(query(
                    companyUserOnboardingItemsRef(recentlySelectedCompany, user.id),
                    orderBy("sortOrder", "asc")
                ));

                if (cancelled) return;

                setOnboardingItems(
                    onboardingSnapshot.docs.map((itemDoc, index) => (
                        normalizeOnboardingItem({ id: itemDoc.id, ...itemDoc.data() }, index * 10)
                    ))
                );
            } catch (error) {
                if (cancelled) return;
                console.error("Error loading onboarding checklist:", error);
                setOnboardingError("Could not load onboarding checklist.");
                setOnboardingItems([]);
            } finally {
                if (!cancelled) setIsOnboardingLoading(false);
            }
        };

        fetchOnboardingItems();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany, user?.id]);

    const roleOptions = useMemo(() => {
        const options = roleList.map((role) => ({
            ...role,
            value: role.id || role.value,
            label: role.label || role.name || "Unnamed Role",
        }));

        if (user?.roleId && !options.some((option) => option.value === user.roleId)) {
            options.unshift({
                value: user.roleId,
                label: user.roleName || "Current Role",
            });
        }

        return options;
    }, [roleList, user?.roleId, user?.roleName]);

    const selectedRoleOption = useMemo(
        () => roleOptions.find((role) => role.value === profileDraft.roleId) || null,
        [roleOptions, profileDraft.roleId]
    );

    const hasProfileChanges = useMemo(() => {
        if (!user) return false;
        const currentProfile = buildProfileDraft(user);
        return (
            currentProfile.roleId !== profileDraft.roleId ||
            currentProfile.status !== profileDraft.status ||
            currentProfile.workerType !== profileDraft.workerType
        );
    }, [profileDraft, user]);

    const displayName = getDisplayName(user);
    const isContractor = normalizeWorkerType(user?.workerType) === WorkerTypeEnum.contractor;
    const canViewPerformanceReviews = can("260");
    const canEditPerformanceReviews = can("264");
    const canEditOnboardingChecklist = can("264");
    const visibleCompanyUserSections = useMemo(
        () => companyUserSections.filter((section) => !section.permissionId || can(section.permissionId)),
        [can]
    );
    const selectedSection = visibleCompanyUserSections.find((section) => section.id === activeTab) || visibleCompanyUserSections[0] || companyUserSections[0];
    const primaryTechnicianId = getPrimaryTechnicianId(user, companyUserId);
    const reviewerName = (
        dataBaseUser?.userName ||
        dataBaseUser?.displayName ||
        dataBaseUser?.firstName ||
        authUser?.displayName ||
        authUser?.email ||
        "Management"
    );
    const workTypesById = useMemo(
        () => new Map(companyWorkTypes.map((workType) => [workType.id, workType])),
        [companyWorkTypes]
    );
    const rateStats = useMemo(() => {
        const activeRates = technicianRates.filter((rate) => String(rate.status || "active").toLowerCase() === "active").length;
        const scheduledRates = technicianRates.filter((rate) => String(rate.status || "").toLowerCase() === "scheduled").length;

        return {
            activeRates,
            scheduledRates,
            totalRates: technicianRates.length + legacyRateSheets.length,
        };
    }, [technicianRates, legacyRateSheets]);
    const activityItems = useMemo(() => {
        const serviceStopItems = recentServiceStops.map((stop) => ({
            id: `stop-${stop.id}`,
            tone: "emerald",
            type: "Service Stop",
            title: getServiceStopTitle(stop),
            subtitle: getServiceStopSubtitle(stop),
            date: getServiceStopDate(stop),
            actionLabel: "Open",
            actionPath: `/company/serviceStops/detail/${stop.id}`,
        }));
        const routeItems = recentRoutes.map((route) => ({
            id: `route-${route.id}`,
            tone: "blue",
            type: "Route",
            title: getRouteTitle(route),
            subtitle: getRouteSubtitle(route),
            date: getRouteDate(route),
            actionLabel: "Routes",
            actionPath: "/company/routing",
        }));
        const jobItems = recentJobs.map((job) => ({
            id: `job-${job.id}`,
            tone: "indigo",
            type: "Job",
            title: getJobTitle(job),
            subtitle: getJobSubtitle(job),
            date: getJobDate(job),
            actionLabel: "Job",
            actionPath: `/company/jobs/detail/${job.id}`,
        }));
        const statementItems = recentStatements.map((statement) => ({
            id: `statement-${statement.id}`,
            tone: "amber",
            type: "Statement",
            title: getStatementTitle(statement),
            subtitle: getStatementSubtitle(statement),
            date: getStatementDate(statement),
            actionLabel: "Payroll",
            actionPath: "/company/payroll?tab=statements",
        }));

        return sortByRecentDate([...serviceStopItems, ...routeItems, ...jobItems, ...statementItems], (item) => item.date).slice(0, 18);
    }, [recentServiceStops, recentRoutes, recentJobs, recentStatements]);

    const serviceStopReferenceOptions = useMemo(
        () => recentServiceStops.map(buildServiceStopReference),
        [recentServiceStops]
    );
    const jobReferenceOptions = useMemo(
        () => recentJobs.map(buildJobReference),
        [recentJobs]
    );
    const selectedServiceStopReferences = useMemo(
        () => serviceStopReferenceOptions.filter((reference) => performanceDraft.referenceStopIds.includes(reference.id)),
        [performanceDraft.referenceStopIds, serviceStopReferenceOptions]
    );
    const selectedJobReferences = useMemo(
        () => jobReferenceOptions.filter((reference) => performanceDraft.referenceJobIds.includes(reference.id)),
        [performanceDraft.referenceJobIds, jobReferenceOptions]
    );
    const activeAssignedRecurringServiceStops = useMemo(
        () => assignedRecurringServiceStops.filter(isActiveRecurringServiceStop),
        [assignedRecurringServiceStops]
    );
    const performanceStats = useMemo(() => {
        const praise = performanceReviews.filter((review) => review.type === "kudo").length;
        const complaints = performanceReviews.filter((review) => review.type === "complaint").length;
        const sharedReports = performanceReviews.reduce((total, review) => {
            const attachedReports = Array.isArray(review.attachedReports) ? review.attachedReports : [];
            return total + (review.visibleToTechnician ? 1 : attachedReports.filter((report) => report.isTechnicianVisible).length);
        }, 0);

        return {
            total: performanceReviews.length,
            praise,
            complaints,
            summaries: performanceReviews.filter((review) => review.type === "summary" || review.isSummaryReport).length,
            sharedReports,
            activeRss: activeAssignedRecurringServiceStops.length,
            totalRss: assignedRecurringServiceStops.length,
        };
    }, [activeAssignedRecurringServiceStops, assignedRecurringServiceStops, performanceReviews]);
    const complaintTimelineItems = useMemo(
        () => sortByRecentDate(
            performanceReviews.filter((review) => review.type === "complaint"),
            (review) => review.date || review.createdAt
        ),
        [performanceReviews]
    );
    const onboardingStats = useMemo(() => {
        const completed = onboardingItems.filter((item) => item.isComplete).length;

        return {
            total: onboardingItems.length,
            completed,
            remaining: Math.max(onboardingItems.length - completed, 0),
        };
    }, [onboardingItems]);

    const workTypeNameForRate = (rate) => {
        if (rate.payBasis === "technicianHourly" && !rate.workTypeId) return "General Hourly";
        return (
            rate.workTypeName ||
            workTypesById.get(rate.workTypeId)?.name ||
            rate.workTypeId ||
            "General"
        );
    };

    const updatePersonalVehicleField = (field, value) => {
        setPersonalVehicle((current) => ({ ...current, [field]: value }));
    };

    const handleCancelProfileEdit = () => {
        setProfileDraft(buildProfileDraft(user));
        setIsEditingProfile(false);
    };

    const handleSaveProfile = async () => {
        if (!requirePermission("264", "update company users")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        const selectedRole = roleOptions.find((role) => role.value === profileDraft.roleId);
        if (!selectedRole) {
            toast.error("Please select a role.");
            return;
        }

        setIsSavingProfile(true);
        try {
            const payload = {
                roleId: selectedRole.value,
                roleName: selectedRole.label,
                status: profileDraft.status,
                workerType: profileDraft.workerType,
            };

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", user.id), payload);
            setUser((current) => ({ ...current, ...payload }));
            setIsEditingProfile(false);
            toast.success("Company user updated.");
        } catch (error) {
            console.error("Error updating company user:", error);
            toast.error("Failed to update company user.");
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleSaveVehicleAccess = async () => {
        if (!requirePermission("264", "update company users")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        setIsSavingVehicleAccess(true);
        try {
            const payload = {
                allowPersonalVehicle,
                personalVehicle: {
                    nickName: personalVehicle.nickName.trim(),
                    vehicalType: personalVehicle.vehicalType || "Car",
                    year: personalVehicle.year.trim(),
                    make: personalVehicle.make.trim(),
                    model: personalVehicle.model.trim(),
                    color: personalVehicle.color.trim(),
                    plate: personalVehicle.plate.trim().toUpperCase(),
                    miles: Number(personalVehicle.miles || 0),
                },
            };

            await updateDoc(doc(db, "companies", recentlySelectedCompany, "companyUsers", user.id), payload);
            setUser((current) => ({
                ...current,
                ...payload,
            }));
            toast.success("Vehicle access updated.");
        } catch (error) {
            console.error("Error updating vehicle access:", error);
            toast.error("Failed to update vehicle access.");
        } finally {
            setIsSavingVehicleAccess(false);
        }
    };

    const handleInitializeOnboardingChecklist = async () => {
        if (!requirePermission("264", "initialize onboarding checklist")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        setIsInitializingOnboarding(true);
        try {
            const [templateSnapshot, existingSnapshot] = await Promise.all([
                getDocs(query(onboardingTemplateItemsRef(recentlySelectedCompany), orderBy("sortOrder", "asc"))),
                getDocs(companyUserOnboardingItemsRef(recentlySelectedCompany, user.id)),
            ]);
            const templateItems = templateSnapshot.docs
                .map((templateDoc, index) => normalizeOnboardingItem({ id: templateDoc.id, ...templateDoc.data() }, index * 10))
                .filter((item) => item.name && item.active !== false);
            const sourceItems = templateItems.length
                ? templateItems
                : DEFAULT_ONBOARDING_TEMPLATE_ITEMS.map((item) => normalizeOnboardingItem(item, item.sortOrder));
            const existingTemplateIds = new Set(
                existingSnapshot.docs
                    .map((itemDoc) => {
                        const item = itemDoc.data() || {};
                        return item.templateItemId || item.id || itemDoc.id;
                    })
                    .filter(Boolean)
            );
            const batch = writeBatch(db);
            const userChecklistRef = companyUserOnboardingItemsRef(recentlySelectedCompany, user.id);
            const localNow = Timestamp.fromDate(new Date());
            const newItems = [];

            sourceItems.forEach((item, index) => {
                const templateItemId = item.templateItemId || item.id || `onboarding_${index + 1}`;
                if (!templateItemId || existingTemplateIds.has(templateItemId)) return;

                const itemRef = doc(userChecklistRef, templateItemId);
                const payload = {
                    id: itemRef.id,
                    templateItemId,
                    name: item.name,
                    description: item.description,
                    sortOrder: Number(item.sortOrder || (index + 1) * 10),
                    isComplete: false,
                    dateCompleted: null,
                    completedAt: null,
                    completedByUserId: "",
                    completedByName: "",
                    companyId: recentlySelectedCompany,
                    companyUserId: user.id,
                    copiedFromTemplate: true,
                    createdAt: serverTimestamp(),
                    createdByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
                    updatedAt: serverTimestamp(),
                    updatedByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
                };

                batch.set(itemRef, payload, { merge: true });
                existingTemplateIds.add(templateItemId);
                newItems.push({
                    ...payload,
                    createdAt: localNow,
                    updatedAt: localNow,
                });
            });

            if (newItems.length === 0) {
                toast.success("Onboarding checklist is already current.");
                return;
            }

            await batch.commit();
            setOnboardingItems((current) => (
                [...current, ...newItems].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
            ));
            toast.success("Onboarding checklist copied to user.");
        } catch (error) {
            console.error("Error initializing onboarding checklist:", error);
            toast.error("Could not copy onboarding checklist.");
        } finally {
            setIsInitializingOnboarding(false);
        }
    };

    const handleToggleOnboardingItem = async (item, isComplete) => {
        if (!requirePermission("264", "update onboarding checklist")) return;
        if (!recentlySelectedCompany || !user?.id || !item?.id) return;

        const actorUserId = dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "";
        const completedDate = isComplete ? Timestamp.fromDate(new Date()) : null;
        const payload = isComplete
            ? {
                isComplete: true,
                dateCompleted: completedDate,
                completedAt: completedDate,
                completedByUserId: actorUserId,
                completedByName: reviewerName,
                updatedAt: serverTimestamp(),
                updatedByUserId: actorUserId,
            }
            : {
                isComplete: false,
                dateCompleted: null,
                completedAt: null,
                completedByUserId: "",
                completedByName: "",
                updatedAt: serverTimestamp(),
                updatedByUserId: actorUserId,
            };

        setUpdatingOnboardingItemId(item.id);
        try {
            await updateDoc(doc(companyUserOnboardingItemsRef(recentlySelectedCompany, user.id), item.id), payload);
            setOnboardingItems((current) => (
                current.map((currentItem) => (
                    currentItem.id === item.id
                        ? { ...currentItem, ...payload, updatedAt: completedDate || Timestamp.fromDate(new Date()) }
                        : currentItem
                ))
            ));
            toast.success(isComplete ? "Onboarding item completed." : "Onboarding item reopened.");
        } catch (error) {
            console.error("Error updating onboarding item:", error);
            toast.error("Could not update onboarding item.");
        } finally {
            setUpdatingOnboardingItemId("");
        }
    };

    const updatePerformanceDraftField = (field, value) => {
        setPerformanceDraft((current) => ({ ...current, [field]: value }));
    };

    const togglePerformanceReference = (field, referenceId) => {
        setPerformanceDraft((current) => {
            const currentIds = current[field] || [];
            const hasReference = currentIds.includes(referenceId);
            return {
                ...current,
                [field]: hasReference
                    ? currentIds.filter((id) => id !== referenceId)
                    : [...currentIds, referenceId],
            };
        });
    };

    const handlePerformanceFilesChange = (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        setPerformanceFiles((current) => [...current, ...files]);
        event.target.value = "";
    };

    const removePerformanceFile = (fileIndex) => {
        setPerformanceFiles((current) => current.filter((_, index) => index !== fileIndex));
    };

    const handleSavePerformanceLine = async () => {
        if (!requirePermission("264", "create performance review lines")) return;
        if (!recentlySelectedCompany || !user?.id) return;

        const hasNote = isNonEmptyString(performanceDraft.note);
        const hasReportDetails = [performanceDraft.reportTitle, performanceDraft.reportUrl, performanceDraft.reportNotes].some(isNonEmptyString);
        const hasFileAttachments = performanceFiles.length > 0;

        if (!hasNote && !hasReportDetails && !hasFileAttachments) {
            toast.error("Add a note or attach a report before saving.");
            return;
        }

        setIsSavingPerformance(true);
        setIsUploadingPerformanceFiles(hasFileAttachments);
        try {
            const reviewDate = Timestamp.fromDate(new Date());
            const filesVisibleToTechnician = Boolean(performanceDraft.reportTechnicianVisible);
            const uploadedAttachments = [];

            for (const [index, file] of performanceFiles.entries()) {
                const attachmentId = `file_${Date.now()}_${index}`;
                const visibilityFolder = filesVisibleToTechnician ? "shared" : "internal";
                const storagePath = [
                    "companies",
                    recentlySelectedCompany,
                    "performanceReviews",
                    user.id,
                    visibilityFolder,
                    `${attachmentId}_${safeStorageFileName(file.name)}`,
                ].join("/");
                const storageRef = ref(storage, storagePath);

                await uploadBytes(storageRef, file, {
                    contentType: file.type || "application/octet-stream",
                });
                const url = await getDownloadURL(storageRef);

                uploadedAttachments.push({
                    id: attachmentId,
                    name: file.name || "Attachment",
                    title: file.name || "Attachment",
                    url,
                    contentType: file.type || "",
                    size: file.size || 0,
                    storagePath,
                    isTechnicianVisible: filesVisibleToTechnician,
                    attachedAt: reviewDate,
                });
            }

            const attachedReports = hasReportDetails || uploadedAttachments.length
                ? [{
                    id: `report_${Date.now()}`,
                    title: performanceDraft.reportTitle.trim() || (uploadedAttachments.length ? "Uploaded attachments" : "Attached report"),
                    url: performanceDraft.reportUrl.trim(),
                    notes: performanceDraft.reportNotes.trim(),
                    isTechnicianVisible: filesVisibleToTechnician,
                    attachments: uploadedAttachments,
                    attachedAt: reviewDate,
                }]
                : [];
            const payload = {
                type: performanceDraft.type,
                note: performanceDraft.note.trim(),
                date: reviewDate,
                references: {
                    serviceStops: selectedServiceStopReferences,
                    jobs: selectedJobReferences,
                },
                attachedReports,
                attachments: uploadedAttachments,
                visibleToTechnician: false,
                isSummaryReport: false,
                companyInternal: true,
                companyId: recentlySelectedCompany,
                companyUserId: user.id,
                technicianUserId: user.userId || "",
                technicianName: displayName,
                createdByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
                createdByName: reviewerName,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            const reviewsCollectionRef = performanceReviewsRef(recentlySelectedCompany, user.id);
            const batch = writeBatch(db);
            const reviewRef = doc(reviewsCollectionRef);
            const visibleReports = attachedReports.filter((report) => report.isTechnicianVisible);
            const localRecords = [{
                ...payload,
                id: reviewRef.id,
                createdAt: reviewDate,
                updatedAt: reviewDate,
            }];

            batch.set(reviewRef, payload);

            if (visibleReports.length > 0) {
                const sharedReportRef = doc(reviewsCollectionRef);
                const sharedReportPayload = {
                    type: "sharedReport",
                    title: visibleReports.length === 1 ? visibleReports[0].title : "Shared Performance Reports",
                    note: visibleReports.map((report) => (
                        [
                            report.title,
                            report.notes,
                            report.url,
                        ].filter(Boolean).join("\n")
                    )).join("\n\n"),
                    date: reviewDate,
                    references: payload.references,
                    attachedReports: visibleReports,
                    attachments: uploadedAttachments.filter((attachment) => attachment.isTechnicianVisible),
                    visibleToTechnician: true,
                    isSummaryReport: false,
                    companyInternal: true,
                    companyId: recentlySelectedCompany,
                    companyUserId: user.id,
                    technicianUserId: user.userId || "",
                    technicianName: displayName,
                    sourcePerformanceReviewId: reviewRef.id,
                    createdByUserId: payload.createdByUserId,
                    createdByName: reviewerName,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                };

                batch.set(sharedReportRef, sharedReportPayload);
                localRecords.unshift({
                    ...sharedReportPayload,
                    id: sharedReportRef.id,
                    createdAt: reviewDate,
                    updatedAt: reviewDate,
                });
            }

            await batch.commit();
            setPerformanceReviews((current) => [...localRecords, ...current]);
            setPerformanceDraft(emptyPerformanceDraft);
            setPerformanceFiles([]);
            setIsPerformanceLineModalOpen(false);
            toast.success("Performance line saved.");
        } catch (error) {
            console.error("Error saving performance line:", error);
            toast.error("Failed to save performance line.");
        } finally {
            setIsSavingPerformance(false);
            setIsUploadingPerformanceFiles(false);
        }
    };

    const buildSummaryBody = () => {
        const reviewLines = performanceReviews.filter((review) => !review.isSummaryReport && review.type !== "summary");
        const sharedReportSourceIds = new Set(
            performanceReviews
                .filter((review) => review.type === "sharedReport" && review.sourcePerformanceReviewId)
                .map((review) => review.sourcePerformanceReviewId)
        );
        const visibleReports = performanceReviews.flatMap((review) => {
            const attachedReports = Array.isArray(review.attachedReports) ? review.attachedReports : [];

            if (review.type === "sharedReport") {
                return [{
                    title: review.title || "Shared Report",
                    url: attachedReports.find((report) => report.url)?.url || "",
                    reviewDate: review.date,
                }];
            }

            if (sharedReportSourceIds.has(review.id)) return [];

            return attachedReports
                .filter((report) => report.isTechnicianVisible)
                .map((report) => ({ ...report, reviewDate: review.date }));
        });
        const recentLineText = reviewLines.slice(0, 8).map((review) => {
            const references = [
                ...((review.references?.serviceStops || []).map((reference) => reference.label)),
                ...((review.references?.jobs || []).map((reference) => reference.label)),
            ].filter(Boolean);
            const referenceText = references.length ? ` References: ${references.slice(0, 3).join(", ")}.` : "";
            return `- ${getPerformanceTypeLabel(review.type)} (${formatDate(review.date)}): ${review.note || "No note recorded."}${referenceText}`;
        });

        return [
            `${summaryDraft.title || "Technician Performance Summary"} for ${displayName}`,
            `Generated ${formatDateTime(new Date())}`,
            "",
            `Review lines: ${reviewLines.length}`,
            `Praise: ${performanceStats.praise}`,
            `Complaints: ${performanceStats.complaints}`,
            "",
            "Manager notes:",
            ...(recentLineText.length ? recentLineText : ["- No saved performance lines yet."]),
            "",
            "Technician-facing reports:",
            ...(visibleReports.length
                ? visibleReports.slice(0, 6).map((report) => `- ${report.title || "Report"}${report.url ? ` (${report.url})` : ""}`)
                : ["- No reports have been marked visible to the technician."]),
            "",
            "Summary:",
            "Review this with the technician and edit this section before saving if you want a more polished handoff.",
        ].join("\n");
    };

    const handleGenerateSummaryReport = () => {
        setSummaryDraft((current) => ({
            ...current,
            body: buildSummaryBody(),
        }));
    };

    const handleSaveSummaryReport = async () => {
        if (!requirePermission("264", "save technician performance summaries")) return;
        if (!recentlySelectedCompany || !user?.id) return;
        if (!isNonEmptyString(summaryDraft.body)) {
            toast.error("Generate or write a summary before saving.");
            return;
        }

        const reviewDate = Timestamp.fromDate(new Date());
        const payload = {
            type: "summary",
            title: summaryDraft.title.trim() || "Technician Performance Summary",
            note: summaryDraft.body.trim(),
            date: reviewDate,
            references: {
                serviceStops: [],
                jobs: [],
            },
            attachedReports: [],
            visibleToTechnician: Boolean(summaryDraft.technicianVisible),
            isSummaryReport: true,
            companyInternal: true,
            companyId: recentlySelectedCompany,
            companyUserId: user.id,
            technicianUserId: user.userId || "",
            technicianName: displayName,
            createdByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
            createdByName: reviewerName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        setIsSavingSummary(true);
        try {
            const reviewRef = await addDoc(
                performanceReviewsRef(recentlySelectedCompany, user.id),
                payload
            );
            setPerformanceReviews((current) => [
                {
                    ...payload,
                    id: reviewRef.id,
                    createdAt: reviewDate,
                    updatedAt: reviewDate,
                },
                ...current,
            ]);
            setIsSummaryReportModalOpen(false);
            toast.success("Summary report saved.");
        } catch (error) {
            console.error("Error saving summary report:", error);
            toast.error("Failed to save summary report.");
        } finally {
            setIsSavingSummary(false);
        }
    };

    const renderReferencePicker = ({ title, icon: Icon, references, fieldName, emptyTitle }) => (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                {Icon && <Icon className="h-4 w-4 text-slate-500" />}
                {title}
            </div>
            {references.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{emptyTitle}</p>
            ) : (
                <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
                    {references.map((reference) => {
                        const checked = (performanceDraft[fieldName] || []).includes(reference.id);
                        return (
                            <label
                                key={reference.id}
                                className={[
                                    "flex cursor-pointer gap-3 rounded-lg border bg-white p-3 text-sm transition",
                                    checked ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300",
                                ].join(" ")}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePerformanceReference(fieldName, reference.id)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="min-w-0">
                                    <span className="block truncate font-semibold text-slate-900">{reference.label}</span>
                                    <span className="mt-0.5 block truncate text-xs text-slate-500">{reference.description || "No details"}</span>
                                    <span className="mt-1 block text-xs font-medium text-slate-500">{formatDate(reference.date)}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const renderPerformanceReviewCard = (review) => {
        const references = [
            ...(review.references?.serviceStops || []),
            ...(review.references?.jobs || []),
        ];
        const attachedReports = Array.isArray(review.attachedReports) ? review.attachedReports : [];
        const attachedFiles = [
            ...(Array.isArray(review.attachments) ? review.attachments : []),
            ...attachedReports.flatMap((report) => Array.isArray(report.attachments) ? report.attachments : []),
        ].filter((attachment, index, attachments) => (
            attachment?.url && attachments.findIndex((candidate) => candidate.url === attachment.url) === index
        ));

        return (
            <article key={review.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge className={getPerformanceTypeClass(review.type)}>{getPerformanceTypeLabel(review.type)}</Badge>
                            <Badge className={getVisibilityClass(review.visibleToTechnician)}>
                                {review.visibleToTechnician ? (
                                    <span className="inline-flex items-center gap-1"><EyeIcon className="h-3.5 w-3.5" /> Technician</span>
                                ) : (
                                    <span className="inline-flex items-center gap-1"><EyeSlashIcon className="h-3.5 w-3.5" /> Internal</span>
                                )}
                            </Badge>
                        </div>
                        {review.title && <h3 className="mt-3 text-base font-semibold text-slate-950">{review.title}</h3>}
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{review.note || "No notes recorded."}</p>
                    </div>
                    <div className="shrink-0 text-left md:text-right">
                        <p className="text-xs font-semibold text-slate-500">{formatDateTime(review.date || review.createdAt)}</p>
                        <p className="mt-1 text-xs text-slate-500">{review.createdByName || "Management"}</p>
                    </div>
                </div>

                {references.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {references.map((reference) => (
                            <button
                                key={`${reference.type}-${reference.id}`}
                                type="button"
                                onClick={() => reference.path && navigate(reference.path)}
                                className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                                {reference.type === "job" ? <BriefcaseIcon className="h-4 w-4" /> : <ListBulletIcon className="h-4 w-4" />}
                                <span className="truncate">{reference.label}</span>
                            </button>
                        ))}
                    </div>
                )}

                {attachedReports.length > 0 && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                            <PaperClipIcon className="h-4 w-4" />
                            Attached Reports
                        </div>
                        <div className="mt-3 space-y-2">
                            {attachedReports.map((report) => (
                                <div key={report.id || report.title} className="flex flex-col gap-2 rounded-md bg-white p-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        {report.url ? (
                                            <a href={report.url} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-blue-700 hover:text-blue-900">
                                                {report.title || "Report"}
                                            </a>
                                        ) : (
                                            <p className="truncate text-sm font-semibold text-slate-900">{report.title || "Report"}</p>
                                        )}
                                        {report.notes && <p className="mt-1 text-xs text-slate-500">{report.notes}</p>}
                                    </div>
                                    <Badge className={getVisibilityClass(report.isTechnicianVisible)}>
                                        {report.isTechnicianVisible ? "Technician" : "Internal"}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {attachedFiles.length > 0 && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                            <PaperClipIcon className="h-4 w-4" />
                            Files & Photos
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {attachedFiles.map((attachment) => {
                                const isImage = String(attachment.contentType || "").startsWith("image/");
                                return (
                                    <a
                                        key={attachment.id || attachment.url}
                                        href={attachment.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="group overflow-hidden rounded-md border border-slate-200 bg-white transition hover:border-blue-200 hover:bg-blue-50"
                                    >
                                        {isImage && (
                                            <img
                                                src={attachment.url}
                                                alt={attachment.name || "Performance attachment"}
                                                className="h-28 w-full object-cover"
                                            />
                                        )}
                                        <div className="flex items-center gap-2 p-3">
                                            <PaperClipIcon className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-blue-500" />
                                            <span className="min-w-0 truncate text-sm font-semibold text-slate-700 group-hover:text-blue-700">
                                                {attachment.name || attachment.title || "Attachment"}
                                            </span>
                                        </div>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}
            </article>
        );
    };

    const renderPerformanceHistoryRow = (review) => {
        const references = [
            ...(review.references?.serviceStops || []),
            ...(review.references?.jobs || []),
        ];
        const attachedReports = Array.isArray(review.attachedReports) ? review.attachedReports : [];
        const attachedFiles = [
            ...(Array.isArray(review.attachments) ? review.attachments : []),
            ...attachedReports.flatMap((report) => Array.isArray(report.attachments) ? report.attachments : []),
        ].filter((attachment, index, attachments) => (
            attachment?.url && attachments.findIndex((candidate) => candidate.url === attachment.url) === index
        ));

        return (
            <tr key={review.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500">
                    {formatDateTime(review.date || review.createdAt)}
                </td>
                <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge className={getPerformanceTypeClass(review.type)}>{getPerformanceTypeLabel(review.type)}</Badge>
                        <Badge className={getVisibilityClass(review.visibleToTechnician)}>
                            {review.visibleToTechnician ? "Technician" : "Internal"}
                        </Badge>
                    </div>
                    {review.title && <p className="mt-2 text-sm font-semibold text-slate-950">{review.title}</p>}
                </td>
                <td className="min-w-[260px] px-4 py-3">
                    <p className="text-sm leading-6 text-slate-700" style={performancePreviewStyle}>
                        {review.note || "No notes recorded."}
                    </p>
                    <button
                        type="button"
                        onClick={() => setSelectedPerformanceReview(review)}
                        className="mt-2 text-xs font-semibold text-blue-700 transition hover:text-blue-900"
                    >
                        View detail
                    </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {references.length.toLocaleString()} ref{references.length === 1 ? "" : "s"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {(attachedReports.length + attachedFiles.length).toLocaleString()} item{attachedReports.length + attachedFiles.length === 1 ? "" : "s"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {review.createdByName || "Management"}
                </td>
            </tr>
        );
    };

    const renderComplaintTimeline = () => (
        <Section
            title="Complaint Timeline"
            description="All saved complaint entries for this technician, shown newest first."
        >
            {complaintTimelineItems.length === 0 ? (
                <EmptyState
                    title="No complaints recorded"
                    description="Complaint entries will appear here as a running performance timeline."
                />
            ) : (
                <ol className="relative space-y-3 before:absolute before:left-3 before:top-3 before:h-[calc(100%-1.5rem)] before:w-px before:bg-rose-100">
                    {complaintTimelineItems.map((review) => (
                        <li key={`complaint-${review.id}`} className="relative pl-9">
                            <span className="absolute left-0 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 ring-4 ring-white">
                                <ChatBubbleBottomCenterTextIcon className="h-3.5 w-3.5 text-rose-700" />
                            </span>
                            <div className="rounded-lg border border-rose-100 bg-white p-4">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge className={getPerformanceTypeClass(review.type)}>{getPerformanceTypeLabel(review.type)}</Badge>
                                            <span className="text-xs font-semibold text-slate-500">{review.createdByName || "Management"}</span>
                                        </div>
                                        {review.title && <p className="mt-2 text-sm font-semibold text-slate-950">{review.title}</p>}
                                        <p className="mt-2 text-sm leading-6 text-slate-700" style={performancePreviewStyle}>
                                            {review.note || "No notes recorded."}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedPerformanceReview(review)}
                                            className="mt-2 text-xs font-semibold text-blue-700 transition hover:text-blue-900"
                                        >
                                            View full complaint
                                        </button>
                                    </div>
                                    <p className="shrink-0 text-xs font-semibold text-slate-500">{formatDateTime(review.date || review.createdAt)}</p>
                                </div>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
        </Section>
    );

    const renderRateSheetSection = () => (
        <Section
            title="Rate Sheet"
            description="Current payroll rates and legacy iOS rate sheet entries for this company user."
            action={can("400") && (
                <button
                    type="button"
                    onClick={() => navigate("/company/settings/payroll-setup?tab=rates")}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                >
                    <CurrencyDollarIcon className="h-4 w-4" />
                    Payroll Rates
                </button>
            )}
        >
            {isRateSheetLoading ? (
                <p className="text-sm text-slate-500">Loading rate sheet...</p>
            ) : (
                <div className="space-y-5">
                    {rateSheetError && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {rateSheetError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <StatTile
                            icon={CurrencyDollarIcon}
                            title="Active Rates"
                            value={rateStats.activeRates}
                            subtitle="Available now"
                        />
                        <StatTile
                            icon={ClockIcon}
                            title="Scheduled"
                            value={rateStats.scheduledRates}
                            subtitle="Future changes"
                        />
                        <StatTile
                            icon={DocumentTextIcon}
                            title="Total Entries"
                            value={rateStats.totalRates}
                            subtitle="Payroll and legacy"
                        />
                    </div>

                    {technicianRates.length === 0 && legacyRateSheets.length === 0 ? (
                        <EmptyState
                            title="No rate sheet entries found"
                            description="Rates can be managed from payroll setup when this technician is ready for pay calculations."
                        />
                    ) : (
                        <div className="space-y-5">
                            {technicianRates.length > 0 && (
                                <div>
                                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                                        <div>
                                            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Payroll Rates</h3>
                                            <p className="text-sm text-slate-500">These rates are used by the current payroll engine.</p>
                                        </div>
                                        <span className="text-xs font-semibold text-slate-500">{technicianRates.length} rate{technicianRates.length === 1 ? "" : "s"}</span>
                                    </div>
                                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                                            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                <tr>
                                                    <th className="px-4 py-3 text-left">Work Type</th>
                                                    <th className="px-4 py-3 text-left">Pay Basis</th>
                                                    <th className="px-4 py-3 text-left">Rate Type</th>
                                                    <th className="px-4 py-3 text-right">Amount</th>
                                                    <th className="px-4 py-3 text-left">Effective</th>
                                                    <th className="px-4 py-3 text-left">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {technicianRates.map((rate) => (
                                                    <tr key={rate.id} className="align-top">
                                                        <td className="px-4 py-3">
                                                            <p className="font-semibold text-slate-900">{workTypeNameForRate(rate)}</p>
                                                            <p className="mt-1 max-w-[220px] truncate text-xs text-slate-500">{rate.workTypeId || rate.ratePlanId || "General rate"}</p>
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-700">{labelize(rate.payBasis)}</td>
                                                        <td className="px-4 py-3 text-slate-700">{labelize(rate.rateType)}</td>
                                                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">{formatMoneyFromCents(rate.amountCents)}</td>
                                                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(rate.effectiveStartDate)}</td>
                                                        <td className="px-4 py-3">
                                                            <Badge className={getRateStatusClass(rate.status)}>{labelize(rate.status || "active")}</Badge>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {legacyRateSheets.length > 0 && (
                                <div>
                                    <div className="mb-3">
                                        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Legacy Rate Sheet</h3>
                                        <p className="text-sm text-slate-500">Entries from the original company-user rate sheet path.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        {legacyRateSheets.map((rateSheet) => (
                                            <div key={rateSheet.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-semibold text-slate-950">{rateSheet.templateName || "Rate Sheet Item"}</p>
                                                        <p className="mt-1 truncate text-xs text-slate-500">{rateSheet.templateId || "No template id"}</p>
                                                    </div>
                                                    <Badge className={getRateStatusClass(rateSheet.status)}>{labelize(rateSheet.status)}</Badge>
                                                </div>
                                                <p className="mt-4 text-2xl font-bold text-slate-950">{formatDollarAmount(rateSheet.rate)}</p>
                                                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                                    <div>
                                                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Labor Type</dt>
                                                        <dd className="mt-1 font-medium text-slate-900">{rateSheet.laborType || "Not set"}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Starts</dt>
                                                        <dd className="mt-1 font-medium text-slate-900">{formatDate(rateSheet.dateImplemented)}</dd>
                                                    </div>
                                                </dl>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </Section>
    );

    const renderGeneralTab = () => (
        <>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                <Section
                    title="User Information"
                    description={isEditingProfile ? "Update the fields that drive assignments, permissions, and payroll grouping." : "Current company relationship details."}
                    action={isEditingProfile && (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleCancelProfileEdit}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                            >
                                <XMarkIcon className="h-4 w-4" />
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveProfile}
                                disabled={isSavingProfile || areRolesLoading || !hasProfileChanges}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <CheckIcon className="h-4 w-4" />
                                {isSavingProfile ? "Saving..." : "Save"}
                            </button>
                        </div>
                    )}
                >
                    {isEditingProfile ? (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-slate-700">Role</span>
                                <Select
                                    value={selectedRoleOption}
                                    options={roleOptions}
                                    onChange={(selected) => setProfileDraft((current) => ({
                                        ...current,
                                        roleId: selected?.value || "",
                                        roleName: selected?.label || "",
                                    }))}
                                    isLoading={areRolesLoading}
                                    isDisabled={areRolesLoading}
                                    placeholder="Select role..."
                                    styles={selectStyles}
                                />
                            </label>

                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-slate-700">Worker Type</span>
                                <select
                                    value={profileDraft.workerType}
                                    onChange={(event) => setProfileDraft((current) => ({ ...current, workerType: event.target.value }))}
                                    className={inputBase}
                                >
                                    {workerTypeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>

                            <label className="space-y-1.5">
                                <span className="text-sm font-semibold text-slate-700">Status</span>
                                <select
                                    value={profileDraft.status}
                                    onChange={(event) => setProfileDraft((current) => ({ ...current, status: event.target.value }))}
                                    className={inputBase}
                                >
                                    {statusOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <DetailField label="Full Name" value={displayName} />
                            <DetailField label="Role" value={user.roleName} />
                            <DetailField label="Worker Type" value={normalizeWorkerType(user.workerType)} />
                            <DetailField label="Date Created" value={formatDate(user.dateCreated || user.createdAt)} />
                        </div>
                    )}
                </Section>

                <Section title="Access Snapshot" description="High level employment state for this company.">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-700">Status</span>
                            <Badge className={getStatusClass(user.status)}>{normalizeStatus(user.status)}</Badge>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-700">Company User ID</span>
                            <span className="max-w-[190px] truncate text-right text-xs font-medium text-slate-500">{user.id}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-700">Auth User ID</span>
                            <span className="max-w-[190px] truncate text-right text-xs font-medium text-slate-500">{user.userId || "Not linked"}</span>
                        </div>
                    </div>
                </Section>
            </div>

            {isContractor && (
                <Section title="Linked Company" description="Contractor relationship information.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DetailField label="Company Name" value={user.linkedCompanyName} />
                        <DetailField label="Company Reference" value={user.linkedCompanyId || (user.linkedCompanyName ? "Linked company" : "")} />
                    </div>
                </Section>
            )}

            {renderRateSheetSection()}

            <Section
                title="Route Vehicle Access"
                description="Permit this technician to use a personal vehicle when starting or managing active routes."
                action={can("264") && (
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                            type="checkbox"
                            checked={allowPersonalVehicle}
                            onChange={(event) => setAllowPersonalVehicle(event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        Allow personal vehicle
                    </label>
                )}
            >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Nickname</span>
                        <input
                            value={personalVehicle.nickName}
                            onChange={(event) => updatePersonalVehicleField("nickName", event.target.value)}
                            readOnly={!can("264")}
                            className={inputBase}
                            placeholder="Mike's truck"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Type</span>
                        <select
                            value={personalVehicle.vehicalType}
                            onChange={(event) => updatePersonalVehicleField("vehicalType", event.target.value)}
                            disabled={!can("264")}
                            className={inputBase}
                        >
                            {VEHICLE_TYPES.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Year</span>
                        <input
                            value={personalVehicle.year}
                            onChange={(event) => updatePersonalVehicleField("year", event.target.value)}
                            readOnly={!can("264")}
                            className={inputBase}
                            placeholder="2021"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Make</span>
                        <input
                            value={personalVehicle.make}
                            onChange={(event) => updatePersonalVehicleField("make", event.target.value)}
                            readOnly={!can("264")}
                            className={inputBase}
                            placeholder="Toyota"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Model</span>
                        <input
                            value={personalVehicle.model}
                            onChange={(event) => updatePersonalVehicleField("model", event.target.value)}
                            readOnly={!can("264")}
                            className={inputBase}
                            placeholder="Tacoma"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Color</span>
                        <input
                            value={personalVehicle.color}
                            onChange={(event) => updatePersonalVehicleField("color", event.target.value)}
                            readOnly={!can("264")}
                            className={inputBase}
                            placeholder="White"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Plate</span>
                        <input
                            value={personalVehicle.plate}
                            onChange={(event) => updatePersonalVehicleField("plate", event.target.value)}
                            readOnly={!can("264")}
                            className={`${inputBase} uppercase`}
                            placeholder="ABC123"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Current Miles</span>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={personalVehicle.miles}
                            onChange={(event) => updatePersonalVehicleField("miles", event.target.value)}
                            readOnly={!can("264")}
                            className={inputBase}
                            placeholder="0"
                        />
                    </label>
                </div>

                {can("264") && (
                    <div className="mt-5 flex justify-end">
                        <button
                            type="button"
                            onClick={handleSaveVehicleAccess}
                            disabled={isSavingVehicleAccess}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSavingVehicleAccess ? "Saving..." : "Save Vehicle Access"}
                        </button>
                    </div>
                )}
            </Section>
        </>
    );

    const renderActivityTab = () => (
        <Section
            title="Work Activity"
            description="Recent service stops, routes, and pay statements connected to this company user."
        >
            <div className="space-y-5">
                {activityError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {activityError}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile
                        icon={ListBulletIcon}
                        title="Service Stops"
                        value={recentServiceStops.length}
                        subtitle="Latest assigned stops"
                    />
                    <StatTile
                        icon={MapIcon}
                        title="Routes"
                        value={recentRoutes.length}
                        subtitle="Latest route records"
                    />
                    <StatTile
                        icon={BriefcaseIcon}
                        title="Jobs"
                        value={recentJobs.length}
                        subtitle="Linked from stops"
                    />
                    <StatTile
                        icon={DocumentTextIcon}
                        title="Statements"
                        value={recentStatements.length}
                        subtitle="Latest pay statements"
                    />
                </div>

                {isActivityLoading ? (
                    <p className="text-sm text-slate-500">Loading activity...</p>
                ) : activityItems.length === 0 ? (
                    <EmptyState
                        title="No recent work activity found"
                        description="Work activity will appear here after this user is assigned service stops, runs routes, or receives pay statements."
                    />
                ) : (
                    <ol className="relative space-y-3">
                        {activityItems.map((item) => {
                            const dotClass = {
                                blue: "bg-blue-600",
                                emerald: "bg-emerald-600",
                                amber: "bg-amber-500",
                                indigo: "bg-indigo-600",
                            }[item.tone] || "bg-slate-500";
                            const chipClass = {
                                blue: "border-blue-100 bg-blue-50 text-blue-700",
                                emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
                                amber: "border-amber-100 bg-amber-50 text-amber-700",
                                indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
                            }[item.tone] || "border-slate-100 bg-slate-50 text-slate-700";

                            return (
                                <li key={item.id} className="relative pl-7">
                                    <span className={`absolute left-0 top-5 h-2.5 w-2.5 rounded-full ${dotClass}`} />
                                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0">
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${chipClass}`}>{item.type}</span>
                                                <h3 className="mt-2 truncate text-sm font-semibold text-slate-950">{item.title}</h3>
                                                <p className="mt-1 text-sm text-slate-500">{item.subtitle || "No additional details"}</p>
                                            </div>
                                            <div className="flex shrink-0 flex-col gap-2 text-left md:items-end md:text-right">
                                                <span className="text-xs font-semibold text-slate-500">{formatDateTime(item.date)}</span>
                                                {item.actionPath && (
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate(item.actionPath)}
                                                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                                    >
                                                        {item.actionLabel}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </Section>
    );

    const renderOnboardingTab = () => (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile
                    icon={ClipboardDocumentCheckIcon}
                    title="Checklist Items"
                    value={onboardingStats.total}
                    subtitle="Copied to user"
                />
                <StatTile
                    icon={CheckIcon}
                    title="Completed"
                    value={onboardingStats.completed}
                    subtitle="Marked done"
                />
                <StatTile
                    icon={ClockIcon}
                    title="Remaining"
                    value={onboardingStats.remaining}
                    subtitle="Still open"
                />
            </div>

            <Section
                title="Onboarding Checklist"
                description="Per-user setup items copied from the company onboarding template."
                action={canEditOnboardingChecklist && (
                    <button
                        type="button"
                        onClick={handleInitializeOnboardingChecklist}
                        disabled={isInitializingOnboarding}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <ClipboardDocumentCheckIcon className="h-4 w-4" />
                        {isInitializingOnboarding ? "Copying..." : "Copy Company Template"}
                    </button>
                )}
            >
                <div className="space-y-4">
                    {onboardingError && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {onboardingError}
                        </div>
                    )}

                    {isOnboardingLoading ? (
                        <p className="text-sm text-slate-500">Loading onboarding checklist...</p>
                    ) : onboardingItems.length === 0 ? (
                        <EmptyState
                            title="No onboarding checklist copied yet"
                            description="Copy the company template to start tracking this user's setup items."
                        />
                    ) : (
                        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                            {onboardingItems.map((item) => {
                                const isUpdating = updatingOnboardingItemId === item.id;

                                return (
                                    <article key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                                        <label className="flex min-w-0 flex-1 items-start gap-3">
                                            <input
                                                type="checkbox"
                                                checked={item.isComplete}
                                                onChange={(event) => handleToggleOnboardingItem(item, event.target.checked)}
                                                disabled={!canEditOnboardingChecklist || isUpdating}
                                                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                            />
                                            <span className="min-w-0">
                                                <span className={`block text-sm font-semibold ${item.isComplete ? "text-slate-500 line-through" : "text-slate-950"}`}>
                                                    {item.name}
                                                </span>
                                                <span className="mt-1 block text-sm text-slate-500">{item.description || "No description"}</span>
                                            </span>
                                        </label>
                                        <div className="shrink-0 text-left sm:text-right">
                                            <Badge className={item.isComplete ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}>
                                                {item.isComplete ? "Complete" : "Open"}
                                            </Badge>
                                            <p className="mt-2 text-xs font-semibold text-slate-500">
                                                {item.isComplete ? `Completed ${formatDate(item.dateCompleted)}` : "Date completed: Not set"}
                                            </p>
                                            {item.isComplete && (
                                                <p className="mt-1 text-xs text-slate-500">
                                                    By {item.completedByName || item.completedByUserId || "Management"}
                                                </p>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Section>
        </div>
    );

    const renderPerformanceLineForm = ({ onCancel }) => (
        <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <label className="space-y-1.5">
                    <span className="text-sm font-semibold text-slate-700">Line Type</span>
                    <select
                        value={performanceDraft.type}
                        onChange={(event) => updatePerformanceDraftField("type", event.target.value)}
                        className={inputBase}
                    >
                        {performanceLineTypes.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1.5">
                    <span className="text-sm font-semibold text-slate-700">Notes</span>
                    <textarea
                        value={performanceDraft.note}
                        onChange={(event) => updatePerformanceDraftField("note", event.target.value)}
                        rows={4}
                        className={`${inputBase} min-h-[120px]`}
                        placeholder="Document the performance line..."
                    />
                </label>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {renderReferencePicker({
                    title: "Service Stop References",
                    icon: ListBulletIcon,
                    references: serviceStopReferenceOptions,
                    fieldName: "referenceStopIds",
                    emptyTitle: "No recent service stops found for this technician.",
                })}
                {renderReferencePicker({
                    title: "Job References",
                    icon: BriefcaseIcon,
                    references: jobReferenceOptions,
                    fieldName: "referenceJobIds",
                    emptyTitle: "No linked jobs found from recent service stops.",
                })}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <PaperClipIcon className="h-4 w-4 text-slate-500" />
                    Attach Report
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Report Title</span>
                        <input
                            value={performanceDraft.reportTitle}
                            onChange={(event) => updatePerformanceDraftField("reportTitle", event.target.value)}
                            className={inputBase}
                            placeholder="Reading performance report"
                        />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-sm font-semibold text-slate-700">Report Link</span>
                        <input
                            type="url"
                            value={performanceDraft.reportUrl}
                            onChange={(event) => updatePerformanceDraftField("reportUrl", event.target.value)}
                            className={inputBase}
                            placeholder="https://..."
                        />
                    </label>
                </div>
                <label className="mt-4 block space-y-1.5">
                    <span className="text-sm font-semibold text-slate-700">Report Notes</span>
                    <textarea
                        value={performanceDraft.reportNotes}
                        onChange={(event) => updatePerformanceDraftField("reportNotes", event.target.value)}
                        rows={3}
                        className={`${inputBase} min-h-[92px]`}
                        placeholder="Optional report context..."
                    />
                </label>

                <div className="mt-4 space-y-3">
                    <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Files & Photos</span>
                        <input
                            type="file"
                            multiple
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                            onChange={handlePerformanceFilesChange}
                            className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
                        />
                    </label>
                    {performanceFiles.length > 0 && (
                        <div className="space-y-2">
                            {performanceFiles.map((file, index) => (
                                <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-800">{file.name}</p>
                                        <p className="text-xs text-slate-500">{Math.ceil((file.size || 0) / 1024).toLocaleString()} KB</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removePerformanceFile(index)}
                                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                        aria-label={`Remove ${file.name}`}
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <label className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                        type="checkbox"
                        checked={performanceDraft.reportTechnicianVisible}
                        onChange={(event) => updatePerformanceDraftField("reportTechnicianVisible", event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Share attached report with technician
                </label>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isSavingPerformance}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSavePerformanceLine}
                    disabled={isSavingPerformance}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <PlusIcon className="h-4 w-4" />
                    {isSavingPerformance
                        ? (isUploadingPerformanceFiles ? "Uploading..." : "Saving...")
                        : "Add Line"}
                </button>
            </div>
        </div>
    );

    const renderSummaryReportForm = ({ onCancel }) => (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
                <div>
                    <p className="text-sm font-semibold text-blue-950">Build from saved performance history</p>
                    <p className="mt-1 text-sm text-blue-700">Generate a draft, edit the full summary, then save it to this technician.</p>
                </div>
                <button
                    type="button"
                    onClick={handleGenerateSummaryReport}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                    <SparklesIcon className="h-4 w-4" />
                    Generate Draft
                </button>
            </div>

            <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Summary Title</span>
                <input
                    value={summaryDraft.title}
                    onChange={(event) => setSummaryDraft((current) => ({ ...current, title: event.target.value }))}
                    className={inputBase}
                />
            </label>
            <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Summary Body</span>
                <textarea
                    value={summaryDraft.body}
                    onChange={(event) => setSummaryDraft((current) => ({ ...current, body: event.target.value }))}
                    rows={12}
                    className={`${inputBase} min-h-[300px] font-mono text-xs leading-5`}
                    placeholder="Generate or write a performance summary..."
                />
            </label>
            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                        type="checkbox"
                        checked={summaryDraft.technicianVisible}
                        onChange={(event) => setSummaryDraft((current) => ({ ...current, technicianVisible: event.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Make summary available to technician
                </label>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isSavingSummary}
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveSummaryReport}
                        disabled={isSavingSummary || !isNonEmptyString(summaryDraft.body)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <ClipboardDocumentListIcon className="h-4 w-4" />
                        {isSavingSummary ? "Saving..." : "Save Summary"}
                    </button>
                </div>
            </div>
        </div>
    );

    const renderPerformanceTab = () => {
        if (!canViewPerformanceReviews) {
            return (
                <Section title="Performance Reviews" description="Management access is required.">
                    <EmptyState
                        title="Performance reviews are restricted"
                        description="This tab is only available to company roles that can view company users."
                    />
                </Section>
            );
        }

        const displayedPerformanceReviews = showAllPerformanceHistory
            ? performanceReviews
            : performanceReviews.slice(0, 10);
        const hiddenPerformanceReviewCount = performanceReviews.length - displayedPerformanceReviews.length;

        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <StatTile
                        icon={StarIcon}
                        title="Review Lines"
                        value={performanceStats.total}
                        subtitle="Saved history"
                    />
                    <StatTile
                        icon={ChatBubbleBottomCenterTextIcon}
                        title="Praise"
                        value={performanceStats.praise}
                        subtitle="Positive notes"
                    />
                    <StatTile
                        icon={ClipboardDocumentListIcon}
                        title="Summaries"
                        value={performanceStats.summaries}
                        subtitle="Generated reports"
                    />
                    <StatTile
                        icon={EyeIcon}
                        title="Shared"
                        value={performanceStats.sharedReports}
                        subtitle="Visible items"
                    />
                    <StatTile
                        icon={ListBulletIcon}
                        title="Assigned RSS"
                        value={performanceStats.activeRss}
                        subtitle={`${performanceStats.totalRss.toLocaleString()} total`}
                    />
                </div>

                <Section
                    title="Performance Lines"
                    description="Capture praise, complaints, coaching notes, supporting work references, and attachments."
                    action={canEditPerformanceReviews && (
                        <button
                            type="button"
                            onClick={() => setIsPerformanceLineModalOpen(true)}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                        >
                            <PlusIcon className="h-4 w-4" />
                            Add Performance Line
                        </button>
                    )}
                >
                    {!canEditPerformanceReviews ? (
                        <EmptyState
                            title="Update permission required"
                            description="You can review history, but cannot add performance lines with this role."
                        />
                    ) : (
                        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-slate-900">Ready for the next performance line.</p>
                                <p className="mt-1 text-sm text-slate-500">References and attachments are saved with the line.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsPerformanceLineModalOpen(true)}
                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                                <PlusIcon className="h-4 w-4" />
                                Add Line
                            </button>
                        </div>
                    )}
                </Section>

                <Section
                    title="Summary Report"
                    description="Generate and save a technician-facing review summary from saved history."
                    action={canEditPerformanceReviews && (
                        <button
                            type="button"
                            onClick={() => setIsSummaryReportModalOpen(true)}
                            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                        >
                            <SparklesIcon className="h-4 w-4" />
                            Create Summary
                        </button>
                    )}
                >
                    {!canEditPerformanceReviews ? (
                        <EmptyState
                            title="Update permission required"
                            description="You can review saved summaries, but cannot create a new one with this role."
                        />
                    ) : (
                        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-slate-900">Summary builder is ready.</p>
                                <p className="mt-1 text-sm text-slate-500">Open the builder to generate, edit, and save a technician-facing summary.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsSummaryReportModalOpen(true)}
                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                                <SparklesIcon className="h-4 w-4" />
                                Open Summary Builder
                            </button>
                        </div>
                    )}
                </Section>

                <Section title="Recent Performance History" description="Recent saved review lines, summaries, and profile-attached reports.">
                    <div className="space-y-4">
                        {performanceError && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                {performanceError}
                            </div>
                        )}

                        {isPerformanceLoading ? (
                            <p className="text-sm text-slate-500">Loading performance history...</p>
                        ) : performanceReviews.length === 0 ? (
                            <EmptyState
                                title="No performance history"
                                description="Praise, complaints, coaching notes, and summaries will appear here after they are saved."
                            />
                        ) : (
                            <div className="space-y-3">
                                <div className="overflow-x-auto rounded-lg border border-slate-200">
                                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="px-4 py-3 text-left">Date</th>
                                                <th className="px-4 py-3 text-left">Type</th>
                                                <th className="px-4 py-3 text-left">Note Preview</th>
                                                <th className="px-4 py-3 text-left">Refs</th>
                                                <th className="px-4 py-3 text-left">Files</th>
                                                <th className="px-4 py-3 text-left">By</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {displayedPerformanceReviews.map(renderPerformanceHistoryRow)}
                                        </tbody>
                                    </table>
                                </div>
                                {hiddenPerformanceReviewCount > 0 && (
                                    <div className="flex justify-center">
                                        <button
                                            type="button"
                                            onClick={() => setShowAllPerformanceHistory(true)}
                                            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                        >
                                            See {hiddenPerformanceReviewCount.toLocaleString()} more
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </Section>

                {renderComplaintTimeline()}

                {isPerformanceLineModalOpen && canEditPerformanceReviews && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
                        <div
                            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="performance-line-modal-title"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                                <div>
                                    <h2 id="performance-line-modal-title" className="text-lg font-semibold text-slate-950">Add Performance Line</h2>
                                    <p className="mt-1 text-sm text-slate-500">Internal by default. Shared reports become visible to the technician.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPerformanceLineModalOpen(false)}
                                    disabled={isSavingPerformance}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                    aria-label="Close performance line modal"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="overflow-y-auto p-5">
                                {renderPerformanceLineForm({
                                    onCancel: () => setIsPerformanceLineModalOpen(false),
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {isSummaryReportModalOpen && canEditPerformanceReviews && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
                        <div
                            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="summary-report-modal-title"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                                <div>
                                    <h2 id="summary-report-modal-title" className="text-lg font-semibold text-slate-950">Summary Report</h2>
                                    <p className="mt-1 text-sm text-slate-500">Generate, edit, and save a technician-facing summary.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsSummaryReportModalOpen(false)}
                                    disabled={isSavingSummary}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                    aria-label="Close summary report modal"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="overflow-y-auto p-5">
                                {renderSummaryReportForm({
                                    onCancel: () => setIsSummaryReportModalOpen(false),
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {selectedPerformanceReview && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
                        <div
                            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="performance-detail-modal-title"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                                <div>
                                    <h2 id="performance-detail-modal-title" className="text-lg font-semibold text-slate-950">Performance Detail</h2>
                                    <p className="mt-1 text-sm text-slate-500">Full note, references, reports, and attachments.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedPerformanceReview(null)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                    aria-label="Close performance detail modal"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="overflow-y-auto bg-slate-50 p-5">
                                {renderPerformanceReviewCard(selectedPerformanceReview)}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50">
                <p className="text-sm text-slate-500">Loading user details...</p>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:px-4 lg:px-6">
            <div className="w-full space-y-4">
                <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <button
                            type="button"
                            onClick={() => navigate("/company/companyUsers")}
                            className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                        >
                            <ArrowLeftIcon className="h-4 w-4" />
                            Back
                        </button>
                        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{displayName}</h1>
                        <p className="mt-1 text-sm text-slate-500">Company user profile, rate sheet, recent activity, and performance history.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge className={getStatusClass(user.status)}>{normalizeStatus(user.status)}</Badge>
                        <Badge className="bg-blue-50 text-blue-700 ring-blue-200">{normalizeWorkerType(user.workerType)}</Badge>
                    </div>
                </header>

                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white">
                                {getInitials(displayName)}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-lg font-semibold text-slate-950">{displayName}</p>
                                <p className="truncate text-sm text-slate-500">{user.roleName || "No role assigned"}</p>
                            </div>
                        </div>
                        {can("264") && !isEditingProfile && (
                            <button
                                type="button"
                                onClick={() => {
                                    handleTabChange("general");
                                    setIsEditingProfile(true);
                                }}
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                            >
                                <PencilSquareIcon className="h-4 w-4" />
                                Edit User
                            </button>
                        )}
                    </div>
                </section>

                <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <aside className="space-y-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
                            <div className="mt-3 space-y-2">
                                {visibleCompanyUserSections.map((section) => {
                                    const active = section.id === activeTab;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => handleTabChange(section.id)}
                                            className={[
                                                "w-full rounded-md border px-3 py-2 text-left transition",
                                                active
                                                    ? "border-blue-200 bg-blue-50 text-blue-800"
                                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                            ].join(" ")}
                                        >
                                            <span className="text-sm font-semibold">{section.label}</span>
                                            <span className="mt-1 block text-xs text-slate-500">{section.helper}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">User Snapshot</h2>
                            <dl className="mt-3 space-y-3">
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current View</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">{selectedSection.label}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</dt>
                                    <dd className="mt-1 text-slate-700">{user.roleName || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primary Technician ID</dt>
                                    <dd className="mt-1 break-all text-slate-700">{primaryTechnicianId || "Not linked"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate Entries</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">{rateStats.totalRates}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity Items</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">{activityItems.length}</dd>
                                </div>
                                <div className="border-t border-slate-200 pt-3">
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Company User ID</dt>
                                    <dd className="mt-1 break-all text-slate-700">{user.id}</dd>
                                </div>
                            </dl>
                        </div>
                    </aside>

                    <main className="min-w-0 space-y-4">
                        {activeTab === "general"
                            ? renderGeneralTab()
                            : activeTab === "activity"
                                ? renderActivityTab()
                                : activeTab === "onboarding"
                                    ? renderOnboardingTab()
                                    : renderPerformanceTab()}
                    </main>
                </section>
            </div>
        </div>
    );
};

export default CompanyUserDetails;
