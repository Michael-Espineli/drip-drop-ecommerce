import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import {
    doc,
    query,
    collection,
    getDocs,
    orderBy,
    serverTimestamp,
    where,
    writeBatch
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { Job } from "../../../utils/models/Job";
import { format } from "date-fns";
import { useNavigate, useParams } from "react-router-dom";
import { FaSort, FaSortAmountDown, FaSortAmountUp } from "react-icons/fa";
import toast from "react-hot-toast";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
    JOB_BILLING_STATUS,
    JOB_OPERATION_STATUS,
    isAcceptedNotScheduledJob,
    isDraftOperationJob,
    isFinishedOutstandingJob,
} from "../../../utils/jobStatusFilters";
import {
    getIssuePriorityLabel,
    getIssuePriorityTone,
    normalizeIssuePriority,
} from "../../../utils/models/JobPlan";
import { appAlert, appConfirm } from "../../../utils/appDialog";
import { filterRecordsByCustomerTags } from "../../../utils/customerTags";
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from "../../../utils/models/FeatureFlag";

const OPERATIONS_QUICK_OPERATION_STATUSES = [
    "Estimate Pending",
    "Unscheduled",
    "Scheduled",
    "Waiting for Parts",
    "In Progress"
];

const OPERATIONS_QUICK_BILLING_STATUSES = [
    JOB_BILLING_STATUS.draft,
    JOB_BILLING_STATUS.estimate,
    JOB_BILLING_STATUS.accepted,
    JOB_BILLING_STATUS.inProgress
];

const BILLING_QUICK_OPERATION_STATUSES = [JOB_OPERATION_STATUS.finished];

const BILLING_QUICK_BILLING_STATUSES = [
    JOB_BILLING_STATUS.draft,
    JOB_BILLING_STATUS.estimate,
    JOB_BILLING_STATUS.accepted,
    JOB_BILLING_STATUS.inProgress,
    JOB_BILLING_STATUS.expired,
    JOB_BILLING_STATUS.rejected
];

const JOB_LIST_VIEWS = ["operations", "billing"];
const DEFAULT_JOB_LIST_VIEW = "operations";

const OPERATION_STATUS_OPTIONS = [
    "Draft",
    "Estimate Pending",
    "Unscheduled",
    "Scheduled",
    "Waiting for Parts",
    "In Progress",
    "Finished"
];

const BILLING_STATUS_OPTIONS = [
    "Draft",
    "Estimate",
    "Accepted",
    "In Progress",
    "Invoiced",
    "Paid",
    "Comped",
    "Expired",
    "Rejected"
];

const JOB_SORT_OPTIONS = [
    { value: "dateCreated-desc", label: "Date Created: Newest First" },
    { value: "dateCreated-asc", label: "Date Created: Oldest First" },
    { value: "customerName-asc", label: "Customer: A to Z" },
    { value: "customerName-desc", label: "Customer: Z to A" },
    { value: "adminName-asc", label: "Admin: A to Z" },
    { value: "adminName-desc", label: "Admin: Z to A" },
    { value: "billingStatus-asc", label: "Billing Status: Workflow Order" },
    { value: "billingStatus-desc", label: "Billing Status: Reverse Order" },
    { value: "operationStatus-asc", label: "Operation Status: Workflow Order" },
    { value: "operationStatus-desc", label: "Operation Status: Reverse Order" },
    { value: "solutionTier-asc", label: "Priority: Critical to Optional" },
    { value: "solutionTier-desc", label: "Priority: Optional to Critical" },
    { value: "rate-desc", label: "Rate: High to Low" },
    { value: "rate-asc", label: "Rate: Low to High" },
];

const DEFAULT_SORT_DIRECTIONS = {
    dateCreated: "desc",
    customerName: "asc",
    adminName: "asc",
    billingStatus: "asc",
    operationStatus: "asc",
    solutionTier: "asc",
    rate: "desc",
};

const billingStatusOrder = BILLING_STATUS_OPTIONS.reduce((acc, status, index) => {
    acc[status.toLowerCase()] = index;
    return acc;
}, {});

const operationStatusOrder = OPERATION_STATUS_OPTIONS.reduce((acc, status, index) => {
    acc[status.toLowerCase()] = index;
    return acc;
}, {});

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const compareText = (leftValue, rightValue, direction) => {
    const left = String(leftValue || "").trim();
    const right = String(rightValue || "").trim();

    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;

    const result = left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
    });

    return direction === "asc" ? result : -result;
};

const compareStatus = (leftValue, rightValue, direction, statusOrder) => {
    const left = String(leftValue || "").trim().toLowerCase();
    const right = String(rightValue || "").trim().toLowerCase();

    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;

    const leftRank = statusOrder[left] ?? 999;
    const rightRank = statusOrder[right] ?? 999;

    if (leftRank !== rightRank) {
        return direction === "asc" ? leftRank - rightRank : rightRank - leftRank;
    }

    return compareText(leftValue, rightValue, direction);
};

const compareDateCreated = (leftValue, rightValue, direction) => {
    const left = toMillis(leftValue);
    const right = toMillis(rightValue);

    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;

    return direction === "asc" ? left - right : right - left;
};

const compareNumber = (leftValue, rightValue, direction) => {
    const left = Number(leftValue || 0);
    const right = Number(rightValue || 0);
    const result = left - right;

    return direction === "asc" ? result : -result;
};

const sortJobs = (jobList, sortBy) => {
    const [sortField, sortDirection = "asc"] = sortBy.split("-");
    const direction = sortDirection === "desc" ? "desc" : "asc";

    return [...jobList].sort((left, right) => {
        let result = 0;

        switch (sortField) {
            case "dateCreated":
                result = compareDateCreated(left.dateCreated, right.dateCreated, direction);
                break;
            case "customerName":
                result = compareText(left.customerName, right.customerName, direction);
                break;
            case "adminName":
                result = compareText(left.adminName, right.adminName, direction);
                break;
            case "billingStatus":
                result = compareStatus(left.billingStatus, right.billingStatus, direction, billingStatusOrder);
                break;
            case "operationStatus":
                result = compareStatus(left.operationStatus, right.operationStatus, direction, operationStatusOrder);
                break;
            case "solutionTier":
                result = compareNumber(
                    normalizeIssuePriority(left.issuePriorityLevel || left.priorityLevel || left.solutionTier),
                    normalizeIssuePriority(right.issuePriorityLevel || right.priorityLevel || right.solutionTier),
                    direction
                );
                break;
            case "rate":
                result = compareNumber(left.rate, right.rate, direction);
                break;
            default:
                result = compareDateCreated(left.dateCreated, right.dateCreated, "desc");
        }

        if (result !== 0) return result;

        return (
            compareDateCreated(left.dateCreated, right.dateCreated, "desc") ||
            compareText(left.internalId, right.internalId, "asc")
        );
    });
};

const getStatusKey = (value) => String(value || "").trim().toLowerCase();

const statusInFilter = (value, filters) => {
    if (!filters.length) return true;
    const allowed = new Set(filters.map(getStatusKey));
    return allowed.has(getStatusKey(value));
};

const statusConstraint = (field, filters) => {
    if (!filters.length) return null;
    return filters.length === 1
        ? where(field, "==", filters[0])
        : where(field, "in", filters);
};

const chooseServerStatusConstraint = (operationFilters, billingFilters) => {
    if (operationFilters.length && billingFilters.length) {
        return operationFilters.length <= billingFilters.length
            ? statusConstraint("operationStatus", operationFilters)
            : statusConstraint("billingStatus", billingFilters);
    }

    if (operationFilters.length) return statusConstraint("operationStatus", operationFilters);
    if (billingFilters.length) return statusConstraint("billingStatus", billingFilters);

    return null;
};

const SortHeaderButton = ({ children, sortKey, activeSortKey, sortDirection, onSort }) => {
    const active = activeSortKey === sortKey;
    const Icon = active
        ? (sortDirection === "asc" ? FaSortAmountUp : FaSortAmountDown)
        : FaSort;

    return (
        <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={`inline-flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide transition ${active ? "text-blue-700" : "text-slate-500 hover:text-slate-900"}`}
            aria-label={`Sort jobs by ${children}`}
        >
            {children}
            <Icon className="text-[0.65rem]" aria-hidden="true" />
        </button>
    );
};

const outlinedButtonToneClasses = {
    blue: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 focus-visible:ring-blue-500",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:ring-emerald-500",
    amber: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-500",
    slate: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-500",
};

const activeOutlinedButtonToneClasses = {
    blue: "border-blue-300 bg-blue-100 text-blue-800 ring-1 ring-blue-200 focus-visible:ring-blue-500",
    emerald: "border-emerald-300 bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 focus-visible:ring-emerald-500",
    amber: "border-amber-300 bg-amber-100 text-amber-900 ring-1 ring-amber-200 focus-visible:ring-amber-500",
    slate: "border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-200 focus-visible:ring-slate-500",
};

const getOutlinedButtonClass = ({ tone = "blue", active = false, className = "" } = {}) => {
    const toneClass = active
        ? activeOutlinedButtonToneClasses[tone] || activeOutlinedButtonToneClasses.blue
        : outlinedButtonToneClasses[tone] || outlinedButtonToneClasses.blue;

    return [
        "rounded-md border px-4 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        toneClass,
        className,
    ].filter(Boolean).join(" ");
};

const Jobs = () => {
    const { view } = useParams();
    const [jobs, setJobs] = useState([]);
    const [jobQueueCounts, setJobQueueCounts] = useState({
        draftOperations: 0,
        acceptedNotScheduled: 0,
        finishedOutstanding: 0,
    });
    const [jobTemplates, setJobTemplates] = useState([]);
    const [commentCounts, setCommentCounts] = useState({});

    const {
        recentlySelectedCompany,
        companyRole,
        companyUserAccess,
        selectedCustomerRegionTag,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const navigate = useNavigate();

    const [searchTerm, setSearchTerm] = useState("");
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [showCreateOptionsModal, setShowCreateOptionsModal] = useState(false);
    const [showTemplatePickerModal, setShowTemplatePickerModal] = useState(false);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedJobIds, setSelectedJobIds] = useState(() => new Set());
    const [bulkOperationStatus, setBulkOperationStatus] = useState("");
    const [bulkBillingStatus, setBulkBillingStatus] = useState("");
    const [bulkUpdating, setBulkUpdating] = useState(false);
    const [customFiltersActive, setCustomFiltersActive] = useState(false);
    const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);

    // Filter and Sort States
    const [operationStatusFilter, setOperationStatusFilter] = useState([
        ...OPERATIONS_QUICK_OPERATION_STATUSES
    ]);

    const [billingStatusFilter, setBillingStatusFilter] = useState([
        ...OPERATIONS_QUICK_BILLING_STATUSES
    ]);

    const [sortBy, setSortBy] = useState("dateCreated-desc");

    const getInitialJobListView = useCallback((viewValue) => {
        return JOB_LIST_VIEWS.includes(viewValue) ? viewValue : DEFAULT_JOB_LIST_VIEW;
    }, []);

    const currentJobListView = useMemo(
        () => getInitialJobListView(view),
        [view, getInitialJobListView]
    );

    const applyJobListViewFilters = useCallback((nextView) => {
        setCustomFiltersActive(false);

        if (nextView === "billing") {
            setOperationStatusFilter([...BILLING_QUICK_OPERATION_STATUSES]);
            setBillingStatusFilter([...BILLING_QUICK_BILLING_STATUSES]);
            return;
        }

        setOperationStatusFilter([...OPERATIONS_QUICK_OPERATION_STATUSES]);
        setBillingStatusFilter([...OPERATIONS_QUICK_BILLING_STATUSES]);
    }, []);

    useEffect(() => {
        const nextView = getInitialJobListView(view);
        applyJobListViewFilters(nextView);
    }, [view, getInitialJobListView, applyJobListViewFilters]);

    useEffect(() => {
        if (!view || !JOB_LIST_VIEWS.includes(view)) {
            navigate(`/company/jobs/${DEFAULT_JOB_LIST_VIEW}`, { replace: true });
        }
    }, [view, navigate]);

    const fetchJobs = useCallback(async () => {
        if (!recentlySelectedCompany) {
            setJobs([]);
            return;
        }

        try {
            const workOrdersRef = collection(db, "companies", recentlySelectedCompany, "workOrders");
            const customerSnapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, "customers"));
            const customersById = new Map(customerSnapshot.docs.map((customerDoc) => [
                customerDoc.id,
                { id: customerDoc.id, ...customerDoc.data() },
            ]));
            const filterJobsForRegionalAccess = (records) => filterRecordsByCustomerTags({
                records,
                customersById,
                role: companyRole,
                userAccess: companyUserAccess,
                selectedRegionTag: selectedCustomerRegionTag,
                regionalAccessEnabled: customerAreaFilteringEnabled,
            });

            if (!customFiltersActive && currentJobListView === "billing") {
                const finishedSnapshot = await getDocs(
                    query(workOrdersRef, where("operationStatus", "==", JOB_OPERATION_STATUS.finished))
                );

                setJobs(
                    filterJobsForRegionalAccess(finishedSnapshot.docs
                        .map(doc => Job.fromFirestore(doc))
                        .filter(isFinishedOutstandingJob))
                );
                return;
            }

            const serverConstraint = chooseServerStatusConstraint(
                operationStatusFilter,
                billingStatusFilter
            );
            const jobsQuery = serverConstraint ? query(workOrdersRef, serverConstraint) : workOrdersRef;

            const querySnapshot = await getDocs(jobsQuery);
            const jobsList = querySnapshot.docs
                .map(doc => Job.fromFirestore(doc))
                .filter((job) => (
                    statusInFilter(job.operationStatus, operationStatusFilter) &&
                    statusInFilter(job.billingStatus, billingStatusFilter)
                ));
            setJobs(filterJobsForRegionalAccess(jobsList));
        } catch (error) {
            console.error("Error fetching jobs: ", error);
        }
    }, [
        recentlySelectedCompany,
        operationStatusFilter,
        billingStatusFilter,
        currentJobListView,
        customFiltersActive,
        companyRole,
        companyUserAccess,
        selectedCustomerRegionTag,
        customerAreaFilteringEnabled
    ]);

    useEffect(() => {
        fetchJobs();
    }, [fetchJobs]);

    const visibleJobs = useMemo(() => {
        const normalizedSearchTerm = searchTerm.trim().toLowerCase();

        const filteredJobs = normalizedSearchTerm
            ? jobs.filter(job =>
                [
                    job.customerName,
                    job.adminName,
                    job.internalId,
                    job.description,
                    job.billingStatus,
                    job.operationStatus,
                    getIssuePriorityLabel(job.issuePriorityLevel || job.priorityLevel || job.solutionTier),
                ].some((value) => String(value || "").toLowerCase().includes(normalizedSearchTerm))
            )
            : jobs;

        return sortJobs(filteredJobs, sortBy);
    }, [jobs, searchTerm, sortBy]);

    useEffect(() => {
        setSelectedJobIds((previousIds) => {
            if (previousIds.size === 0) return previousIds;

            const availableJobIds = new Set(jobs.map((job) => job.id));
            const nextIds = new Set(
                [...previousIds].filter((jobId) => availableJobIds.has(jobId))
            );

            return nextIds.size === previousIds.size ? previousIds : nextIds;
        });
    }, [jobs]);

    const selectedJobs = useMemo(
        () => jobs.filter((job) => selectedJobIds.has(job.id)),
        [jobs, selectedJobIds]
    );

    const selectedVisibleCount = useMemo(
        () => visibleJobs.filter((job) => selectedJobIds.has(job.id)).length,
        [visibleJobs, selectedJobIds]
    );

    const allVisibleJobsSelected = visibleJobs.length > 0 &&
        visibleJobs.every((job) => selectedJobIds.has(job.id));

    const toggleJobSelection = useCallback((jobId) => {
        setSelectedJobIds((previousIds) => {
            const nextIds = new Set(previousIds);

            if (nextIds.has(jobId)) {
                nextIds.delete(jobId);
            } else {
                nextIds.add(jobId);
            }

            return nextIds;
        });
    }, []);

    const handleSelectAllVisibleJobs = useCallback((checked) => {
        setSelectedJobIds((previousIds) => {
            const nextIds = new Set(previousIds);

            visibleJobs.forEach((job) => {
                if (checked) {
                    nextIds.add(job.id);
                } else {
                    nextIds.delete(job.id);
                }
            });

            return nextIds;
        });
    }, [visibleJobs]);

    const clearBatchSelection = useCallback(() => {
        setSelectedJobIds(new Set());
        setBulkOperationStatus("");
        setBulkBillingStatus("");
    }, []);

    const fetchAllJobs = useCallback(async () => {
        if (!recentlySelectedCompany) {
            setJobQueueCounts({
                draftOperations: 0,
                acceptedNotScheduled: 0,
                finishedOutstanding: 0,
            });
            return;
        }

        try {
            const [querySnapshot, customerSnapshot] = await Promise.all([
                getDocs(collection(db, "companies", recentlySelectedCompany, "workOrders")),
                getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
            ]);
            const rawJobs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const customersById = new Map(customerSnapshot.docs.map((customerDoc) => [
                customerDoc.id,
                { id: customerDoc.id, ...customerDoc.data() },
            ]));
            const visibleJobsForCounts = filterRecordsByCustomerTags({
                records: rawJobs,
                customersById,
                role: companyRole,
                userAccess: companyUserAccess,
                selectedRegionTag: selectedCustomerRegionTag,
                regionalAccessEnabled: customerAreaFilteringEnabled,
            });
            setJobQueueCounts({
                draftOperations: visibleJobsForCounts.filter(isDraftOperationJob).length,
                acceptedNotScheduled: visibleJobsForCounts.filter(isAcceptedNotScheduledJob).length,
                finishedOutstanding: visibleJobsForCounts.filter(isFinishedOutstandingJob).length,
            });
        } catch (error) {
            console.error("Error fetching job summary data: ", error);
            setJobQueueCounts({
                draftOperations: 0,
                acceptedNotScheduled: 0,
                finishedOutstanding: 0,
            });
        }
    }, [recentlySelectedCompany, companyRole, companyUserAccess, selectedCustomerRegionTag, customerAreaFilteringEnabled]);

    useEffect(() => {
        fetchAllJobs();
    }, [fetchAllJobs]);

    useEffect(() => {
        const fetchCommentCounts = async () => {
            if (!recentlySelectedCompany || visibleJobs.length === 0) {
                setCommentCounts({});
                return;
            }

            try {
                const countsArray = await Promise.all(
                    visibleJobs.map(async (job) => {
                        const commentsRef = collection(
                            db,
                            "companies",
                            recentlySelectedCompany,
                            "workOrders",
                            job.id,
                            "comments"
                        );

                        const unresolvedCommentsQ = query(
                            commentsRef,
                            where("resolved", "==", false)
                        );

                        const snap = await getDocs(unresolvedCommentsQ);

                        return {
                            jobId: job.id,
                            count: snap.size,
                        };
                    })
                );

                const countsMap = countsArray.reduce((acc, item) => {
                    acc[item.jobId] = item.count;
                    return acc;
                }, {});

                setCommentCounts(countsMap);
            } catch (error) {
                console.error("Error fetching comment counts: ", error);
            }
        };

        fetchCommentCounts();
    }, [visibleJobs, recentlySelectedCompany]);

    const fetchJobTemplates = async () => {
        if (!recentlySelectedCompany) return;

        try {
            setLoadingTemplates(true);

            const templateSnap = await getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "jobTemplates"),
                    orderBy("name", "asc")
                )
            );

            const templates = templateSnap.docs.map((docSnap) => {
                const data = docSnap.data();
                const id = data.id || docSnap.id;

                return {
                    ...data,
                    id,
                };
            });

            setJobTemplates(templates);
        } catch (error) {
            console.error("Error fetching job templates:", error);
            appAlert("Failed to load job templates.");
        } finally {
            setLoadingTemplates(false);
        }
    };

    const openCreateOptions = () => {
        if (!requirePermission("22", "create jobs")) return;
        setShowCreateOptionsModal(true);
    };

    const handleCreateBlankJob = () => {
        setShowCreateOptionsModal(false);
        navigate("/company/jobs/createNew");
    };

    const handleOpenTemplatePicker = async () => {
        setShowCreateOptionsModal(false);
        setShowTemplatePickerModal(true);
        await fetchJobTemplates();
    };

    const handleCreateFromTemplate = (template) => {
        setShowTemplatePickerModal(false);

        navigate("/company/jobs/createNew", {
            state: {
                startingTemplate: template,
                template,
                templateId: template.id,
            },
        });
    };

    const handleApplyFilters = (newOperationFilters, newBillingFilters) => {
        setCustomFiltersActive(true);
        setOperationStatusFilter(newOperationFilters);
        setBillingStatusFilter(newBillingFilters);
        setShowFilterModal(false);
    };

    const handleJobListViewChange = (nextView) => {
        applyJobListViewFilters(nextView);
        navigate(`/company/jobs/${nextView}`);
    };

    const activeQuickFilter = useMemo(() => {
        return customFiltersActive ? "custom" : currentJobListView;
    }, [currentJobListView, customFiltersActive]);

    const [activeSortKey, activeSortDirection = "asc"] = sortBy.split("-");
    const canCreateJobs = can("22");
    const canUpdateJobs = can("24");

    const handleHeaderSort = (nextSortKey) => {
        if (activeSortKey === nextSortKey) {
            setSortBy(`${nextSortKey}-${activeSortDirection === "asc" ? "desc" : "asc"}`);
            return;
        }

        setSortBy(`${nextSortKey}-${DEFAULT_SORT_DIRECTIONS[nextSortKey] || "asc"}`);
    };

    const handleApplyBatchStatusUpdate = async () => {
        if (!requirePermission("24", "update jobs")) return;

        if (selectedJobs.length === 0) {
            toast.error("Select at least one job.");
            return;
        }

        if (!recentlySelectedCompany) {
            toast.error("Select a company before updating jobs.");
            return;
        }

        if (!bulkOperationStatus && !bulkBillingStatus) {
            toast.error("Choose at least one status to update.");
            return;
        }

        const selectedLabels = [
            bulkOperationStatus ? `operation status to ${bulkOperationStatus}` : null,
            bulkBillingStatus ? `billing status to ${bulkBillingStatus}` : null,
        ].filter(Boolean);

        const ok = await appConfirm({
            title: "Update Selected Jobs",
            message: `Update ${selectedJobs.length} selected job${selectedJobs.length === 1 ? "" : "s"}: ${selectedLabels.join(" and ")}?`,
            confirmLabel: "Update Jobs",
        });

        if (!ok) return;

        const toastId = toast.loading(`Updating ${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"}...`);

        try {
            setBulkUpdating(true);

            const nowMillis = Date.now();
            const updates = {
                updatedAt: serverTimestamp(),
                updatedAtMillis: nowMillis,
            };

            if (bulkOperationStatus) {
                updates.operationStatus = bulkOperationStatus;
            }

            if (bulkBillingStatus) {
                updates.billingStatus = bulkBillingStatus;
            }

            const writeChunkSize = 450;

            for (let index = 0; index < selectedJobs.length; index += writeChunkSize) {
                const chunk = selectedJobs.slice(index, index + writeChunkSize);
                const batch = writeBatch(db);

                chunk.forEach((job) => {
                    batch.update(
                        doc(db, "companies", recentlySelectedCompany, "workOrders", job.id),
                        updates
                    );
                });

                await batch.commit();
            }

            clearBatchSelection();
            await Promise.all([fetchJobs(), fetchAllJobs()]);
            toast.success("Selected jobs updated.", { id: toastId });
        } catch (error) {
            console.error("Error applying batch job status update:", error);
            toast.error(error?.message || "Failed to update selected jobs.", { id: toastId });
        } finally {
            setBulkUpdating(false);
        }
    };

    const uniqueJobsCount = useMemo(() => {
        const ids = new Set(
            (visibleJobs || [])
                .map((e) => (e?.internalId ?? "").toString().trim())
                .filter(Boolean)
        );

        return ids.size;
    }, [visibleJobs]);

    const jobSummary = useMemo(() => {
        return {
            visibleRateCents: visibleJobs.reduce((total, job) => total + Number(job.rate || 0), 0),
            draftOperationCount: jobQueueCounts.draftOperations,
            acceptedNotScheduledCount: jobQueueCounts.acceptedNotScheduled,
            finishedOutstandingCount: jobQueueCounts.finishedOutstanding,
        };
    }, [jobQueueCounts, visibleJobs]);

    const primaryQueueMetric = useMemo(() => {
        if (currentJobListView === "billing") {
            return {
                label: "Finished Not Invoiced",
                value: jobSummary.finishedOutstandingCount,
                detail: "Finished jobs needing billing action",
                tone: "blue",
            };
        }

        return {
            label: "Draft Operations",
            value: jobSummary.draftOperationCount,
            detail: "Billing or operation status Draft",
            tone: "red",
        };
    }, [currentJobListView, jobSummary]);

    const getStatusClass = (status) => {
        switch (status) {
            case "Draft":
            case "Unscheduled":
                return "bg-red-50 text-red-700";
            case "Estimate":
            case "In Progress":
            case "Estimate Pending":
                return "bg-amber-50 text-amber-700";
            case "Accepted":
            case "Scheduled":
            case "Finished":
            case "Paid":
            case "Comped":
                return "bg-emerald-50 text-emerald-700";
            case "Invoiced":
                return "bg-blue-50 text-blue-700";
            case "Waiting for Parts":
                return "bg-violet-50 text-violet-700";
            case "Expired":
                return "bg-slate-100 text-slate-700";
            default:
                return "bg-slate-100 text-slate-700";
        }
    };

    const getSolutionTierClass = (tier) => {
        switch (getIssuePriorityTone(tier)) {
            case "red":
                return "bg-red-100 text-red-800";
            case "amber":
                return "bg-amber-100 text-amber-800";
            case "blue":
                return "bg-blue-100 text-blue-800";
            case "emerald":
                return "bg-emerald-100 text-emerald-800";
            default:
                return "bg-slate-100 text-slate-700";
        }
    };

    const renderSolutionTier = (tier) => {
        const normalizedTier = normalizeIssuePriority(tier);
        return (
            <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getSolutionTierClass(normalizedTier)}`}>
                {normalizedTier} - {getIssuePriorityLabel(normalizedTier)}
            </span>
        );
    };

    const moneyFromCents = (value) => {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format((Number(value || 0) || 0) / 100);
    };

    const formatTemplateMoney = (template) => {
        const rate = Number(template.defaultRateCents || template.rate || 0);
        return moneyFromCents(rate);
    };

    const JobMetricCard = ({ label, value, detail, tone = "slate" }) => {
        const toneClasses = {
            slate: "border-slate-200 bg-slate-50 text-slate-950",
            blue: "border-blue-200 bg-slate-50 text-slate-950",
            amber: "border-amber-200 bg-slate-50 text-slate-950",
            red: "border-red-200 bg-red-50 text-red-950",
            green: "border-emerald-200 bg-slate-50 text-slate-950",
        };

        return (
            <div className={`rounded-lg border p-4 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold leading-tight">{value}</p>
                {detail && (
                    <p className="mt-1 text-sm text-slate-600">{detail}</p>
                )}
            </div>
        );
    };

    const FilterModal = ({ onClose, applyFilters }) => {
        const [tempOperationFilters, setTempOperationFilters] = useState(operationStatusFilter);
        const [tempBillingFilters, setTempBillingFilters] = useState(billingStatusFilter);

        const handleOperationChange = (status) => {
            setTempOperationFilters(prev =>
                prev.includes(status)
                    ? prev.filter(s => s !== status)
                    : [...prev, status]
            );
        };

        const handleBillingChange = (status) => {
            setTempBillingFilters(prev =>
                prev.includes(status)
                    ? prev.filter(s => s !== status)
                    : [...prev, status]
            );
        };

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-5 text-xl font-bold text-slate-950">Filter & Sort</h3>

                    <div className="space-y-5">
                        <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Sort</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            >
                                {JOB_SORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                Operational Status
                            </label>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {OPERATION_STATUS_OPTIONS.map(status => (
                                    <label key={status} className="flex cursor-pointer items-center space-x-3">
                                        <input
                                            type="checkbox"
                                            checked={tempOperationFilters.includes(status)}
                                            onChange={() => handleOperationChange(status)}
                                            className="form-checkbox h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-slate-700">{status}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="mb-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                Billing Status
                            </label>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {BILLING_STATUS_OPTIONS.map(status => (
                                    <label key={status} className="flex cursor-pointer items-center space-x-3">
                                        <input
                                            type="checkbox"
                                            checked={tempBillingFilters.includes(status)}
                                            onChange={() => handleBillingChange(status)}
                                            className="form-checkbox h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-slate-700">{status}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                            Cancel
                        </button>

                        <button
                            onClick={() => applyFilters(tempOperationFilters, tempBillingFilters)}
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                        >
                            Apply
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const CreateJobOptionsModal = () => {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-950">Create Job</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    Start blank or use a reusable job template.
                                </p>
                            </div>

                            <button
                                onClick={() => setShowCreateOptionsModal(false)}
                                className="h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3 p-5">
                        <button
                            type="button"
                            onClick={handleCreateBlankJob}
                            className="w-full rounded-md border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-slate-100"
                        >
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white">
                                    <span className="text-lg">＋</span>
                                </div>

                                <div>
                                    <p className="font-bold text-slate-900">Blank Job</p>
                                    <p className="mt-1 text-sm text-slate-500">
                                        Build a job manually from scratch.
                                    </p>
                                </div>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={handleOpenTemplatePicker}
                            className="w-full rounded-md border border-blue-200 bg-blue-50 p-4 text-left transition hover:bg-blue-100"
                        >
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-blue-200 bg-white">
                                    <span className="text-lg">▣</span>
                                </div>

                                <div>
                                    <p className="font-bold text-blue-900">From Template</p>
                                    <p className="mt-1 text-sm text-blue-800">
                                        Copy planned stops, tasks, materials, and pricing into a new job.
                                    </p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const TemplatePickerModal = () => {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-950">Choose Template</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    Select a template to prefill the new job.
                                </p>
                            </div>

                            <button
                                onClick={() => setShowTemplatePickerModal(false)}
                                className="h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[65vh] overflow-y-auto p-5">
                        {loadingTemplates ? (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
                                <p className="font-semibold text-slate-800">Loading templates...</p>
                            </div>
                        ) : jobTemplates.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                                <p className="font-semibold text-slate-800">No templates found.</p>
                                <p className="mt-1 text-sm text-slate-500">
                                    Create a job template first, then return here.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {jobTemplates.map((template) => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        onClick={() => handleCreateFromTemplate(template)}
                                        className="rounded-md border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-bold text-slate-900">
                                                    {template.name || "Job Template"}
                                                </p>

                                                {template.description && (
                                                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                                                        {template.description}
                                                    </p>
                                                )}
                                            </div>

                                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">
                                                {formatTemplateMoney(template)}
                                            </span>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {template.type && (
                                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                                    {template.type}
                                                </span>
                                            )}

                                            {template.defaultLaborCostCents !== undefined && (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                                    Labor {moneyFromCents(template.defaultLaborCostCents)}
                                                </span>
                                            )}

                                            {template.locked && (
                                                <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                                                    Locked
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company operations</p>
                            <h2 className="mt-1 text-3xl font-bold text-slate-950">Jobs</h2>

                            <p className="mt-1 text-sm text-slate-500">
                                Track jobs, service schedules, and operational status.
                            </p>

                            <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                    Jobs: {visibleJobs.length}
                                </span>

                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                    Unique IDs: {uniqueJobsCount}
                                </span>
                            </div>
                        </div>

                        {canCreateJobs && (
                            <button
                                type="button"
                                onClick={openCreateOptions}
                                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                Create Job
                            </button>
                        )}
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <JobMetricCard
                        label="Shown Rate"
                        value={moneyFromCents(jobSummary.visibleRateCents)}
                        detail={`${visibleJobs.length} jobs in this view`}
                        tone="blue"
                    />

                    <JobMetricCard
                        label={primaryQueueMetric.label}
                        value={primaryQueueMetric.value}
                        detail={primaryQueueMetric.detail}
                        tone={primaryQueueMetric.tone}
                    />

                    {currentJobListView === "operations" && (
                        <JobMetricCard
                            label="Accepted Not Scheduled"
                            value={jobSummary.acceptedNotScheduledCount}
                            detail="Billing accepted without Scheduled operation"
                            tone="green"
                        />
                    )}
                </section>

                <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap gap-2 border-b border-slate-200 p-5">
                        <button
                            type="button"
                            onClick={() => handleJobListViewChange("operations")}
                            className={getOutlinedButtonClass({
                                tone: "emerald",
                                active: activeQuickFilter === "operations",
                            })}
                        >
                            Operations
                        </button>
                        <button
                            type="button"
                            onClick={() => handleJobListViewChange("billing")}
                            className={getOutlinedButtonClass({
                                tone: "blue",
                                active: activeQuickFilter === "billing",
                            })}
                        >
                            Finished Not Invoiced
                        </button>
                    </div>
                    <div className="grid gap-3 border-b border-slate-200 p-5 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-center">
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            type="text"
                            placeholder="Search by customer, admin, ID, status, or description..."
                        />

                        <button
                            onClick={() => setShowFilterModal(true)}
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                            Filter & Sort
                        </button>
                    </div>

                    {canUpdateJobs && selectedJobIds.size > 0 && (
                        <div className="border-b border-blue-100 bg-blue-50 p-5">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                                <div>
                                    <p className="text-sm font-bold text-blue-950">
                                        {selectedJobIds.size} selected
                                    </p>
                                    <p className="mt-1 text-sm text-blue-800">
                                        {selectedVisibleCount} selected in the current view.
                                    </p>
                                </div>

                                <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:max-w-2xl">
                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-wide text-blue-900">
                                            Operation Status
                                        </span>
                                        <select
                                            value={bulkOperationStatus}
                                            onChange={(event) => setBulkOperationStatus(event.target.value)}
                                            disabled={bulkUpdating}
                                            className="mt-1 w-full rounded-md border border-blue-200 bg-white p-2.5 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <option value="">Leave unchanged</option>
                                            {OPERATION_STATUS_OPTIONS.map((status) => (
                                                <option key={status} value={status}>
                                                    {status}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="block">
                                        <span className="text-xs font-bold uppercase tracking-wide text-blue-900">
                                            Billing Status
                                        </span>
                                        <select
                                            value={bulkBillingStatus}
                                            onChange={(event) => setBulkBillingStatus(event.target.value)}
                                            disabled={bulkUpdating}
                                            className="mt-1 w-full rounded-md border border-blue-200 bg-white p-2.5 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <option value="">Leave unchanged</option>
                                            {BILLING_STATUS_OPTIONS.map((status) => (
                                                <option key={status} value={status}>
                                                    {status}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <div className="flex flex-col gap-2 sm:flex-row xl:flex-none">
                                    <button
                                        type="button"
                                        onClick={handleApplyBatchStatusUpdate}
                                        disabled={bulkUpdating || (!bulkOperationStatus && !bulkBillingStatus)}
                                        className={getOutlinedButtonClass({ tone: "blue", className: "py-2.5 font-bold" })}
                                    >
                                        {bulkUpdating ? "Updating..." : "Update Selected"}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={clearBatchSelection}
                                        disabled={bulkUpdating}
                                        className={getOutlinedButtonClass({ tone: "slate", className: "py-2.5 font-bold" })}
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                        <div>Showing {visibleJobs.length} of {jobs.length} job{jobs.length === 1 ? "" : "s"}</div>
                        <div>{currentJobListView === "billing" ? "Finished not invoiced" : "Operations"} - {customFiltersActive ? "Custom filters" : "Default filters"}</div>
                    </div>

                    <div className="overflow-x-auto border-t border-slate-200">
                        <table className="min-w-full bg-white">
                            <thead className="bg-slate-50">
                                <tr>
                                    {canUpdateJobs && (
                                        <th className="w-12 border-b border-slate-200 px-5 py-3 text-left">
                                            <input
                                                type="checkbox"
                                                aria-label="Select all visible jobs"
                                                checked={allVisibleJobsSelected}
                                                disabled={visibleJobs.length === 0 || bulkUpdating}
                                                onChange={(event) => handleSelectAllVisibleJobs(event.target.checked)}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                            />
                                        </th>
                                    )}
                                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Job</th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left">
                                        <SortHeaderButton sortKey="dateCreated" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Date Created
                                        </SortHeaderButton>
                                    </th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left">
                                        <SortHeaderButton sortKey="customerName" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Customer
                                        </SortHeaderButton>
                                    </th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left">
                                        <SortHeaderButton sortKey="adminName" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Admin
                                        </SortHeaderButton>
                                    </th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left">
                                        <SortHeaderButton sortKey="billingStatus" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Billing Status
                                        </SortHeaderButton>
                                    </th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left">
                                        <SortHeaderButton sortKey="operationStatus" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Operation Status
                                        </SortHeaderButton>
                                    </th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left">
                                        <SortHeaderButton sortKey="solutionTier" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Priority
                                        </SortHeaderButton>
                                    </th>
                                    <th className="hidden border-b border-slate-200 px-5 py-3 text-left sm:table-cell">
                                        <SortHeaderButton sortKey="rate" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Rate
                                        </SortHeaderButton>
                                    </th>
                                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-slate-200">
                                {visibleJobs.length === 0 ? (
                                    <tr>
                                        <td colSpan={canUpdateJobs ? 10 : 9} className="px-6 py-12 text-center">
                                            <p className="font-semibold text-slate-800">No jobs found.</p>
                                            <p className="mt-1 text-sm text-slate-500">
                                                Create a blank job or start from a template.
                                            </p>

                                            {canCreateJobs && (
                                                <button
                                                    type="button"
                                                    onClick={openCreateOptions}
                                                    className={getOutlinedButtonClass({ tone: "blue", className: "mt-4" })}
                                                >
                                                    Create First Job
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    visibleJobs.map(job => (
                                        <tr
                                            key={job.id}
                                            className={[
                                                selectedJobIds.has(job.id) ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50",
                                                "transition-colors cursor-pointer",
                                            ].join(" ")}
                                            onClick={() => navigate(`/company/jobs/detail/${job.id}`)}
                                        >
                                            {canUpdateJobs && (
                                                <td
                                                    className="px-5 py-3"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Select job ${job.internalId || job.id}`}
                                                        checked={selectedJobIds.has(job.id)}
                                                        disabled={bulkUpdating}
                                                        onChange={() => toggleJobSelection(job.id)}
                                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                                    />
                                                </td>
                                            )}
                                            <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-900">
                                                <div className="flex items-center gap-2">
                                                    <span>{job.internalId}</span>

                                                    {(commentCounts[job.id] || 0) > 0 && (
                                                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                                                            {commentCounts[job.id]} unresolved
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                                                {job.dateCreated ? format(job.dateCreated, "MM/dd/yyyy") : "N/A"}
                                            </td>

                                            <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-800">
                                                {job.customerName}
                                            </td>

                                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                                                {job.adminName || "Unassigned"}
                                            </td>

                                            <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-900">
                                                <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(job.billingStatus)}`}>
                                                    {job.billingStatus}
                                                </span>
                                            </td>

                                            <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-900">
                                                <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(job.operationStatus)}`}>
                                                    {job.operationStatus}
                                                </span>
                                            </td>

                                            <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-900">
                                                {renderSolutionTier(job.issuePriorityLevel || job.priorityLevel || job.solutionTier)}
                                            </td>

                                            <td className="hidden whitespace-nowrap px-5 py-3 text-sm text-slate-800 sm:table-cell">
                                                {moneyFromCents(job.rate)}
                                            </td>

                                            <td
                                                className="max-w-xs whitespace-nowrap px-5 py-3 text-sm text-slate-700 truncate"
                                                title={job.description}
                                            >
                                                {job.description}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {showFilterModal && (
                <FilterModal
                    onClose={() => setShowFilterModal(false)}
                    applyFilters={handleApplyFilters}
                />
            )}

            {showCreateOptionsModal && <CreateJobOptionsModal />}

            {showTemplatePickerModal && <TemplatePickerModal />}
        </div>
    );
};

export default Jobs;
