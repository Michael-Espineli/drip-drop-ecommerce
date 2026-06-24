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
    isActionableOperationsJob,
    isDraftOperationJob,
    isFinishedOutstandingJob,
} from "../../../utils/jobStatusFilters";

const OPERATIONS_QUICK_OPERATION_STATUSES = [
    JOB_OPERATION_STATUS.draft
];

const OPERATIONS_QUICK_BILLING_STATUSES = [
    JOB_BILLING_STATUS.accepted
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
    { value: "rate-desc", label: "Rate: High to Low" },
    { value: "rate-asc", label: "Rate: Low to High" },
];

const DEFAULT_SORT_DIRECTIONS = {
    dateCreated: "desc",
    customerName: "asc",
    adminName: "asc",
    billingStatus: "asc",
    operationStatus: "asc",
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

const SortHeaderButton = ({ children, sortKey, activeSortKey, sortDirection, onSort }) => {
    const active = activeSortKey === sortKey;
    const Icon = active
        ? (sortDirection === "asc" ? FaSortAmountUp : FaSortAmountDown)
        : FaSort;

    return (
        <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={`inline-flex items-center gap-1.5 text-left text-sm font-semibold uppercase tracking-wider transition ${active ? "text-blue-700" : "text-gray-600 hover:text-gray-800"}`}
            aria-label={`Sort jobs by ${children}`}
        >
            {children}
            <Icon className="text-[0.65rem]" aria-hidden="true" />
        </button>
    );
};

const Jobs = () => {
    const { view } = useParams();
    const [jobs, setJobs] = useState([]);
    const [allJobs, setAllJobs] = useState([]);
    const [jobTemplates, setJobTemplates] = useState([]);
    const [commentCounts, setCommentCounts] = useState({});

    const { recentlySelectedCompany } = useContext(Context);
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

            if (!customFiltersActive && currentJobListView === "operations") {
                const [draftOperationSnapshot, acceptedSnapshot] = await Promise.all([
                    getDocs(query(workOrdersRef, where("operationStatus", "==", JOB_OPERATION_STATUS.draft))),
                    getDocs(query(workOrdersRef, where("billingStatus", "==", JOB_BILLING_STATUS.accepted))),
                ]);

                const jobsById = new Map();

                [...draftOperationSnapshot.docs, ...acceptedSnapshot.docs].forEach((jobDoc) => {
                    const job = Job.fromFirestore(jobDoc);
                    if (isActionableOperationsJob(job)) {
                        jobsById.set(job.id, job);
                    }
                });

                setJobs([...jobsById.values()]);
                return;
            }

            if (!customFiltersActive && currentJobListView === "billing") {
                const finishedSnapshot = await getDocs(
                    query(workOrdersRef, where("operationStatus", "==", JOB_OPERATION_STATUS.finished))
                );

                setJobs(
                    finishedSnapshot.docs
                        .map(doc => Job.fromFirestore(doc))
                        .filter(isFinishedOutstandingJob)
                );
                return;
            }

            let q = workOrdersRef;
            let queries = [];

            if (operationStatusFilter.length > 0) {
                queries.push(where("operationStatus", "in", operationStatusFilter));
            }

            if (billingStatusFilter.length > 0) {
                queries.push(where("billingStatus", "in", billingStatusFilter));
            }

            q = query(q, ...queries);

            const querySnapshot = await getDocs(q);
            const jobsList = querySnapshot.docs.map(doc => Job.fromFirestore(doc));
            setJobs(jobsList);
        } catch (error) {
            console.error("Error fetching jobs: ", error);
        }
    }, [
        recentlySelectedCompany,
        operationStatusFilter,
        billingStatusFilter,
        currentJobListView,
        customFiltersActive
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
            setAllJobs([]);
            return;
        }

        try {
            const querySnapshot = await getDocs(
                collection(db, "companies", recentlySelectedCompany, "workOrders")
            );
            const jobsList = querySnapshot.docs.map(doc => Job.fromFirestore(doc));
            setAllJobs(jobsList);
        } catch (error) {
            console.error("Error fetching job summary data: ", error);
            setAllJobs([]);
        }
    }, [recentlySelectedCompany]);

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
            alert("Failed to load job templates.");
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

        const ok = window.confirm(
            `Update ${selectedJobs.length} selected job${selectedJobs.length === 1 ? "" : "s"}: ${selectedLabels.join(" and ")}?`
        );

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
        const summaryJobs = allJobs.length > 0 ? allJobs : visibleJobs;

        const actionableJobsCount = summaryJobs.filter(isActionableOperationsJob).length;
        const draftOperationCount = summaryJobs.filter(isDraftOperationJob).length;
        const acceptedNotScheduledCount = summaryJobs.filter(isAcceptedNotScheduledJob).length;
        const finishedOutstandingCount = summaryJobs.filter(isFinishedOutstandingJob).length;

        return {
            totalRateCents: summaryJobs.reduce((total, job) => total + Number(job.rate || 0), 0),
            visibleRateCents: visibleJobs.reduce((total, job) => total + Number(job.rate || 0), 0),
            totalJobsCount: summaryJobs.length,
            actionableJobsCount,
            draftOperationCount,
            acceptedNotScheduledCount,
            finishedOutstandingCount,
        };
    }, [allJobs, visibleJobs]);

    const getStatusClass = (status) => {
        switch (status) {
            case "Draft":
            case "Unscheduled":
                return "bg-red-100 text-red-800";
            case "Estimate":
            case "In Progress":
            case "Estimate Pending":
                return "bg-yellow-100 text-yellow-800";
            case "Accepted":
            case "Scheduled":
            case "Finished":
            case "Paid":
            case "Comped":
                return "bg-green-100 text-green-800";
            case "Invoiced":
                return "bg-blue-100 text-blue-800";
            case "Waiting for Parts":
                return "bg-purple-100 text-purple-800";
            case "Expired":
                return "bg-gray-100 text-gray-800";
            default:
                return "bg-gray-100 text-gray-800";
        }
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
            slate: "border-slate-200 bg-white text-slate-950",
            blue: "border-blue-200 bg-blue-50 text-blue-950",
            amber: "border-amber-200 bg-amber-50 text-amber-950",
            red: "border-red-200 bg-red-50 text-red-950",
            green: "border-green-200 bg-green-50 text-green-950",
        };

        return (
            <div className={`rounded-lg border p-4 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-bold leading-tight">{value}</p>
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
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
                <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-lg">
                    <h3 className="text-2xl font-bold mb-6 text-gray-800">Filter & Sort</h3>

                    <div className="space-y-6">
                        <div>
                            <label className="block mb-2 font-semibold text-gray-700">Sort</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500"
                            >
                                {JOB_SORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block mb-3 font-semibold text-gray-700">
                                Operational Status
                            </label>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {OPERATION_STATUS_OPTIONS.map(status => (
                                    <label key={status} className="flex items-center space-x-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={tempOperationFilters.includes(status)}
                                            onChange={() => handleOperationChange(status)}
                                            className="form-checkbox h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-gray-700">{status}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block mb-3 font-semibold text-gray-700">
                                Billing Status
                            </label>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {BILLING_STATUS_OPTIONS.map(status => (
                                    <label key={status} className="flex items-center space-x-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={tempBillingFilters.includes(status)}
                                            onChange={() => handleBillingChange(status)}
                                            className="form-checkbox h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-gray-700">{status}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end space-x-4 mt-8">
                        <button
                            onClick={onClose}
                            className="py-2 px-6 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                        >
                            Cancel
                        </button>

                        <button
                            onClick={() => applyFilters(tempOperationFilters, tempBillingFilters)}
                            className="py-2 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
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
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-2xl font-bold text-gray-800">Create Job</h3>
                                <p className="text-gray-600 mt-1">
                                    Start blank or use a reusable job template.
                                </p>
                            </div>

                            <button
                                onClick={() => setShowCreateOptionsModal(false)}
                                className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    <div className="p-6 space-y-3">
                        <button
                            type="button"
                            onClick={handleCreateBlankJob}
                            className="w-full text-left rounded-xl border border-gray-200 bg-gray-50 p-4 hover:bg-gray-100 transition"
                        >
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                                    <span className="text-lg">＋</span>
                                </div>

                                <div>
                                    <p className="font-bold text-gray-800">Blank Job</p>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Build a job manually from scratch.
                                    </p>
                                </div>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={handleOpenTemplatePicker}
                            className="w-full text-left rounded-xl border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100 transition"
                        >
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-full bg-white border border-blue-200 flex items-center justify-center">
                                    <span className="text-lg">▣</span>
                                </div>

                                <div>
                                    <p className="font-bold text-blue-900">From Template</p>
                                    <p className="text-sm text-blue-800 mt-1">
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
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-2xl font-bold text-gray-800">Choose Template</h3>
                                <p className="text-gray-600 mt-1">
                                    Select a template to prefill the new job.
                                </p>
                            </div>

                            <button
                                onClick={() => setShowTemplatePickerModal(false)}
                                className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    <div className="p-6 overflow-y-auto max-h-[65vh]">
                        {loadingTemplates ? (
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
                                <p className="font-semibold text-gray-700">Loading templates...</p>
                            </div>
                        ) : jobTemplates.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                                <p className="font-semibold text-gray-700">No templates found.</p>
                                <p className="text-sm text-gray-500 mt-1">
                                    Create a job template first, then return here.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {jobTemplates.map((template) => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        onClick={() => handleCreateFromTemplate(template)}
                                        className="text-left rounded-xl border border-gray-200 bg-gray-50 p-4 hover:bg-blue-50 hover:border-blue-200 transition"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-bold text-gray-800">
                                                    {template.name || "Job Template"}
                                                </p>

                                                {template.description && (
                                                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                                        {template.description}
                                                    </p>
                                                )}
                                            </div>

                                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-white border border-gray-200 text-gray-700">
                                                {formatTemplateMoney(template)}
                                            </span>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {template.type && (
                                                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                                                    {template.type}
                                                </span>
                                            )}

                                            {template.defaultLaborCostCents !== undefined && (
                                                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                                    Labor {moneyFromCents(template.defaultLaborCostCents)}
                                                </span>
                                            )}

                                            {template.locked && (
                                                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
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
        <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
            <div className="w-full">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-800">Jobs</h2>

                        <p className="text-gray-600 mt-1">
                            Track jobs, service schedules, and operational status.
                        </p>

                        <div className="mt-2 inline-flex items-center gap-3 text-sm text-gray-700">
                            <span className="text-gray-600">
                                Jobs: <span className="font-semibold text-gray-800">{visibleJobs.length}</span>
                            </span>

                            <span className="text-gray-600">
                                Unique IDs: <span className="font-semibold text-gray-800">{uniqueJobsCount}</span>
                            </span>
                        </div>
                    </div>

                    {canCreateJobs && (
                        <button
                            type="button"
                            onClick={openCreateOptions}
                            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                        >
                            Create Job
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6 mb-6">
                    <JobMetricCard
                        label="Total Rate"
                        value={moneyFromCents(jobSummary.totalRateCents)}
                        detail={`${jobSummary.totalJobsCount} total jobs`}
                    />

                    <JobMetricCard
                        label="Shown Rate"
                        value={moneyFromCents(jobSummary.visibleRateCents)}
                        detail={`${visibleJobs.length} jobs in this view`}
                        tone="blue"
                    />

                    <JobMetricCard
                        label="Actionable Jobs"
                        value={jobSummary.actionableJobsCount}
                        detail="Draft operations or accepted jobs not scheduled"
                        tone="amber"
                    />

                    <JobMetricCard
                        label="Finished Not Invoiced"
                        value={jobSummary.finishedOutstandingCount}
                        detail="Finished jobs needing billing action"
                        tone="blue"
                    />

                    <JobMetricCard
                        label="Draft Operations"
                        value={jobSummary.draftOperationCount}
                        detail="Operation status Draft"
                        tone="red"
                    />

                    <JobMetricCard
                        label="Accepted Not Scheduled"
                        value={jobSummary.acceptedNotScheduledCount}
                        detail="Billing accepted without Scheduled operation"
                        tone="green"
                    />
                </div>

                <div className="rounded-lg bg-white p-6 shadow-lg">
                    <div className="mb-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => handleJobListViewChange("operations")}
                            className={[
                                "rounded-md px-4 py-2 text-sm font-semibold transition",
                                activeQuickFilter === "operations"
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                        >
                            Actionable Jobs
                        </button>
                        <button
                            type="button"
                            onClick={() => handleJobListViewChange("billing")}
                            className={[
                                "rounded-md px-4 py-2 text-sm font-semibold transition",
                                activeQuickFilter === "billing"
                                    ? "bg-blue-600 text-white shadow-sm"
                                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                        >
                            Finished Not Invoiced
                        </button>
                    </div>
                    <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full sm:w-2/5 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            type="text"
                            placeholder="Search by customer, admin, ID, status, or description..."
                        />

                        <button
                            onClick={() => setShowFilterModal(true)}
                            className="w-full sm:w-auto py-3 px-5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                        >
                            Filter & Sort
                        </button>
                    </div>

                    {canUpdateJobs && selectedJobIds.size > 0 && (
                        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
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
                                            className="mt-1 w-full rounded-lg border border-blue-200 bg-white p-2.5 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
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
                                            className="mt-1 w-full rounded-lg border border-blue-200 bg-white p-2.5 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
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
                                        className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {bulkUpdating ? "Updating..." : "Update Selected"}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={clearBatchSelection}
                                        disabled={bulkUpdating}
                                        className="rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100">
                                <tr>
                                    {canUpdateJobs && (
                                        <th className="w-12 p-4 text-left">
                                            <input
                                                type="checkbox"
                                                aria-label="Select all visible jobs"
                                                checked={allVisibleJobsSelected}
                                                disabled={visibleJobs.length === 0 || bulkUpdating}
                                                onChange={(event) => handleSelectAllVisibleJobs(event.target.checked)}
                                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                            />
                                        </th>
                                    )}
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Job</th>
                                    <th className="p-4 text-left">
                                        <SortHeaderButton sortKey="dateCreated" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Date Created
                                        </SortHeaderButton>
                                    </th>
                                    <th className="p-4 text-left">
                                        <SortHeaderButton sortKey="customerName" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Customer
                                        </SortHeaderButton>
                                    </th>
                                    <th className="p-4 text-left">
                                        <SortHeaderButton sortKey="adminName" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Admin
                                        </SortHeaderButton>
                                    </th>
                                    <th className="p-4 text-left">
                                        <SortHeaderButton sortKey="billingStatus" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Billing Status
                                        </SortHeaderButton>
                                    </th>
                                    <th className="p-4 text-left">
                                        <SortHeaderButton sortKey="operationStatus" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Operation Status
                                        </SortHeaderButton>
                                    </th>
                                    <th className="p-4 text-left hidden sm:table-cell">
                                        <SortHeaderButton sortKey="rate" activeSortKey={activeSortKey} sortDirection={activeSortDirection} onSort={handleHeaderSort}>
                                            Rate
                                        </SortHeaderButton>
                                    </th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-200">
                                {visibleJobs.length === 0 ? (
                                    <tr>
                                        <td colSpan={canUpdateJobs ? 9 : 8} className="p-8 text-center">
                                            <p className="font-semibold text-gray-700">No jobs found.</p>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Create a blank job or start from a template.
                                            </p>

                                            {canCreateJobs && (
                                                <button
                                                    type="button"
                                                    onClick={openCreateOptions}
                                                    className="mt-4 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
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
                                                selectedJobIds.has(job.id) ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-gray-50",
                                                "transition-colors cursor-pointer",
                                            ].join(" ")}
                                            onClick={() => navigate(`/company/jobs/detail/${job.id}`)}
                                        >
                                            {canUpdateJobs && (
                                                <td
                                                    className="p-4"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Select job ${job.internalId || job.id}`}
                                                        checked={selectedJobIds.has(job.id)}
                                                        disabled={bulkUpdating}
                                                        onChange={() => toggleJobSelection(job.id)}
                                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                                    />
                                                </td>
                                            )}
                                            <td className="p-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <span>{job.internalId}</span>

                                                    {(commentCounts[job.id] || 0) > 0 && (
                                                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                                                            {commentCounts[job.id]} unresolved
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="p-4 whitespace-nowrap text-gray-700">
                                                {job.dateCreated ? format(job.dateCreated, "MM/dd/yyyy") : "N/A"}
                                            </td>

                                            <td className="p-4 whitespace-nowrap text-gray-800 font-medium">
                                                {job.customerName}
                                            </td>

                                            <td className="p-4 whitespace-nowrap text-gray-700">
                                                {job.adminName || "Unassigned"}
                                            </td>

                                            <td className="p-4 whitespace-nowrap">
                                                <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(job.billingStatus)}`}>
                                                    {job.billingStatus}
                                                </span>
                                            </td>

                                            <td className="p-4 whitespace-nowrap">
                                                <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(job.operationStatus)}`}>
                                                    {job.operationStatus}
                                                </span>
                                            </td>

                                            <td className="p-4 whitespace-nowrap text-gray-800 hidden sm:table-cell">
                                                {moneyFromCents(job.rate)}
                                            </td>

                                            <td
                                                className="p-4 whitespace-nowrap max-w-xs truncate text-gray-700"
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
                </div>
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
