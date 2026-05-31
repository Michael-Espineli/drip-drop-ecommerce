import React, { useState, useEffect, useContext, useMemo } from "react";
import {
    query,
    collection,
    getDocs,
    orderBy,
    where
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { Job } from "../../../utils/models/Job";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

const Jobs = () => {
    const [jobs, setJobs] = useState([]);
    const [jobTemplates, setJobTemplates] = useState([]);
    const [commentCounts, setCommentCounts] = useState({});

    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();

    const [searchTerm, setSearchTerm] = useState("");
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [showCreateOptionsModal, setShowCreateOptionsModal] = useState(false);
    const [showTemplatePickerModal, setShowTemplatePickerModal] = useState(false);
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    // Filter and Sort States
    const [operationStatusFilter, setOperationStatusFilter] = useState([
        "Estimate Pending",
        "Unscheduled",
        "Scheduled",
        "Waiting for Parts",
        "In Progress"
    ]);

    const [billingStatusFilter, setBillingStatusFilter] = useState([
        "Draft",
        "Estimate",
        "Accepted",
        "In Progress"
    ]);

    const [sortBy, setSortBy] = useState("dateCreated-desc");

    const operationStatusOptions = [
        "Estimate Pending",
        "Unscheduled",
        "Scheduled",
        "Waiting for Parts",
        "In Progress",
        "Finished"
    ];

    const billingStatusOptions = [
        "Draft",
        "Estimate",
        "Accepted",
        "In Progress",
        "Invoiced",
        "Paid",
        "Expired"
    ];

    useEffect(() => {
        const fetchJobs = async () => {
            if (!recentlySelectedCompany) return;

            try {
                let q = collection(db, "companies", recentlySelectedCompany, "workOrders");
                let queries = [];

                if (operationStatusFilter.length > 0) {
                    queries.push(where("operationStatus", "in", operationStatusFilter));
                }

                if (billingStatusFilter.length > 0) {
                    queries.push(where("billingStatus", "in", billingStatusFilter));
                }

                const [sortField, sortDirection] = sortBy.split("-");
                queries.push(orderBy(sortField, sortDirection));

                q = query(q, ...queries);

                const querySnapshot = await getDocs(q);
                const jobsList = querySnapshot.docs.map(doc => Job.fromFirestore(doc));

                const filteredJobs = jobsList.filter(job =>
                    job.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    job.internalId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    job.description?.toLowerCase().includes(searchTerm.toLowerCase())
                );

                setJobs(filteredJobs);
            } catch (error) {
                console.error("Error fetching jobs: ", error);
            }
        };

        fetchJobs();
    }, [
        recentlySelectedCompany,
        searchTerm,
        operationStatusFilter,
        billingStatusFilter,
        sortBy
    ]);

    useEffect(() => {
        const fetchCommentCounts = async () => {
            if (!recentlySelectedCompany || jobs.length === 0) {
                setCommentCounts({});
                return;
            }

            try {
                const countsArray = await Promise.all(
                    jobs.map(async (job) => {
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
    }, [jobs, recentlySelectedCompany]);

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
        setOperationStatusFilter(newOperationFilters);
        setBillingStatusFilter(newBillingFilters);
        setShowFilterModal(false);
    };

    const uniqueJobsCount = useMemo(() => {
        const ids = new Set(
            (jobs || [])
                .map((e) => (e?.internalId ?? "").toString().trim())
                .filter(Boolean)
        );

        return ids.size;
    }, [jobs]);

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
                            <label className="block mb-2 font-semibold text-gray-700">Sort by Date</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="dateCreated-desc">Newest First</option>
                                <option value="dateCreated-asc">Oldest First</option>
                            </select>
                        </div>

                        <div>
                            <label className="block mb-3 font-semibold text-gray-700">
                                Operational Status
                            </label>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {operationStatusOptions.map(status => (
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
                                {billingStatusOptions.map(status => (
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
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-800">Jobs</h2>

                        <p className="text-gray-600 mt-1">
                            Track jobs, service schedules, and operational status.
                        </p>

                        <div className="mt-2 inline-flex items-center gap-3 text-sm text-gray-700">
                            <span className="text-gray-600">
                                Jobs: <span className="font-semibold text-gray-800">{jobs.length}</span>
                            </span>

                            <span className="text-gray-600">
                                Unique IDs: <span className="font-semibold text-gray-800">{uniqueJobsCount}</span>
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={openCreateOptions}
                        className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                    >
                        Create Job
                    </button>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-6">
                    <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full sm:w-2/5 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            type="text"
                            placeholder="Search by customer, ID, or description..."
                        />

                        <button
                            onClick={() => setShowFilterModal(true)}
                            className="w-full sm:w-auto py-3 px-5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                        >
                            Filter & Sort
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Id</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Date Created</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Customer</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Billing Status</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Operation Status</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden sm:table-cell">Rate</th>
                                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-200">
                                {jobs.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="p-8 text-center">
                                            <p className="font-semibold text-gray-700">No jobs found.</p>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Create a blank job or start from a template.
                                            </p>

                                            <button
                                                type="button"
                                                onClick={openCreateOptions}
                                                className="mt-4 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                                            >
                                                Create First Job
                                            </button>
                                        </td>
                                    </tr>
                                ) : (
                                    jobs.map(job => (
                                        <tr
                                            key={job.id}
                                            className="hover:bg-gray-50 transition-colors cursor-pointer"
                                            onClick={() => navigate(`/company/jobs/detail/${job.id}`)}
                                        >
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
                                                {job.type}
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