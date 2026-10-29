import React, { useEffect, useMemo, useState, useContext } from "react";
import {
    collection,
    onSnapshot,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import {
    DEFAULT_REPAIR_REQUEST_FILTER_STATUSES,
    REPAIR_REQUEST_STATUS,
    REPAIR_REQUEST_STATUS_OPTIONS,
    displayRepairRequestStatus,
    isOpenRepairRequestStatus,
    normalizeRepairRequestStatus,
    getRepairRequestIssuePriority,
    compareRepairRequestsByDate,
    isRepairRequestSubmittedByUser,
} from "../../../utils/models/RepairRequest";
import { Context } from "../../../context/AuthContext";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import useCompanyRepairRequests from "../../../hooks/useCompanyRepairRequests";
import PublicRepairRequestLink from "../../../components/PublicRepairRequestLink";
import { getIssuePriorityLabel } from "../../../utils/models/JobPlan";

const getRequestDateValue = (request) => (
    request.date || request.dateCreated || request.createdAt || null
);

const toDate = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getRequestCommentKey = (request, companyId) => `${companyId}:${request.sourcePath}:${request.id}`;

const RepairRequests = () => {
    const { recentlySelectedCompany, user, dataBaseUser, companyUserAccess } = useContext(Context);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const onlyMyRequests = searchParams.get('submittedBy') === 'me';
    const currentUserIds = useMemo(() => [
        user?.uid, dataBaseUser?.uid, dataBaseUser?.id,
        companyUserAccess?.id, companyUserAccess?.userId, companyUserAccess?.uid,
        companyUserAccess?.companyUserId, companyUserAccess?.companyUserDocId,
    ], [user, dataBaseUser, companyUserAccess]);
    const { can } = useCompanyPermissions();

    const { requests, loading, refresh: refreshRequests } = useCompanyRepairRequests(recentlySelectedCompany);
    const internalRequests = useMemo(() => requests.filter((request) => request.source === "internal"), [requests]);
    const externalRequests = useMemo(() => requests.filter((request) => request.source === "external"), [requests]);
    const [commentCounts, setCommentCounts] = useState({});

    const [activeTab, setActiveTab] = useState("all");

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedStatuses, setSelectedStatuses] = useState(DEFAULT_REPAIR_REQUEST_FILTER_STATUSES);
    const [dateSortDirection, setDateSortDirection] = useState("desc");

    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    const statusOptions = REPAIR_REQUEST_STATUS_OPTIONS;

    const selectedRequests = useMemo(() => {
        const selected = activeTab === "all" ? requests : activeTab === "internal" ? internalRequests : externalRequests;
        return onlyMyRequests ? selected.filter((request) => isRepairRequestSubmittedByUser(request, currentUserIds)) : selected;
    }, [activeTab, requests, internalRequests, externalRequests, onlyMyRequests, currentUserIds]);

    const filteredRequests = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();

        const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
        const end = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
        const selectedStatusSet = new Set(selectedStatuses.map(normalizeRepairRequestStatus));

        return selectedRequests.filter((request) => {
            const requestDate = toDate(getRequestDateValue(request));

            const matchesDate =
                !requestDate ||
                ((!start || requestDate >= start) && (!end || requestDate <= end));

            const requestStatus = request.status || REPAIR_REQUEST_STATUS.UNRESOLVED;
            const normalizedRequestStatus = normalizeRepairRequestStatus(requestStatus);
            const matchesStatus =
                selectedStatuses.length === 0 ||
                selectedStatusSet.has(normalizedRequestStatus);

            const searchable = [
                request.customerName,
                request.requesterName,
                request.description,
                request.notes,
                displayRepairRequestStatus(request.status),
                getIssuePriorityLabel(getRepairRequestIssuePriority(request)),
                request.serviceLocationName,
                request.serviceLocationAddress,
                request.customerEmail,
                request.customerPhone,
                request.id,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            const matchesSearch =
                term.length === 0 || searchable.includes(term);

            return matchesDate && matchesStatus && matchesSearch;
        }).sort((left, right) => {
            const result = compareRepairRequestsByDate(left, right);
            return dateSortDirection === "asc" ? -result : result;
        });
    }, [selectedRequests, selectedStatuses, searchTerm, startDate, endDate, dateSortDirection]);

    useEffect(() => {
        setCommentCounts({});
        if (!recentlySelectedCompany) return undefined;
        let canceled = false;
        const unsubscribers = filteredRequests.map((request) => {
            const key = getRequestCommentKey(request, recentlySelectedCompany);
            const commentsRef = request.sourcePath === "homeowner"
                ? collection(db, "homeownerRepairRequests", request.id, "comments")
                : collection(db, "companies", recentlySelectedCompany, "repairRequests", request.id, "comments");

            return onSnapshot(commentsRef, (snapshot) => {
                if (canceled) return;
                const count = snapshot.docs.filter((comment) => !comment.data().resolved).length;
                setCommentCounts((previous) => ({ ...previous, [key]: count }));
            }, (error) => {
                console.error("Error loading repair request comment counts:", error);
                if (!canceled) setCommentCounts((previous) => ({ ...previous, [key]: 0 }));
            });
        });

        return () => {
            canceled = true;
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [filteredRequests, recentlySelectedCompany]);

    const internalNeedsActionCount = useMemo(() => {
        return internalRequests.filter((request) => {
            return isOpenRepairRequestStatus(request.status);
        }).length;
    }, [internalRequests]);

    const externalNeedsActionCount = useMemo(() => {
        return externalRequests.filter((request) => {
            return isOpenRepairRequestStatus(request.status);
        }).length;
    }, [externalRequests]);

    const getStatusClass = (status) => {
        const value = normalizeRepairRequestStatus(status);

        if (value === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.RESOLVED)) return "bg-emerald-50 text-emerald-700";
        if (value === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.CANCELLED) || value === "canceled") return "bg-red-100 text-red-800";
        if (value === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB)) return "bg-slate-100 text-slate-700";
        if (value === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.SUGGESTED_WORK)) return "bg-blue-100 text-blue-800";
        if (value === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.LEGACY_IN_PROGRESS)) return "bg-blue-100 text-blue-800";

        return "bg-yellow-100 text-yellow-800";
    };

    const formatDate = (date) => {
        const value = toDate(date);

        if (!value) return "N/A";

        try {
            return format(value, "PP");
        } catch {
            return "N/A";
        }
    };

    const handleOpenRequest = (request) => {
        navigate(`/company/repair-requests/detail/${request.id}`, {
            state: {
                repairRequest: request,
                source: request.source,
                sourcePath: request.sourcePath,
            },
        });
    };

    const toggleStatus = (status) => {
        setSelectedStatuses((prev) => {
            if (prev.includes(status)) {
                return prev.filter((item) => item !== status);
            }

            return [...prev, status];
        });
    };

    const toggleDateSortDirection = () => {
        setDateSortDirection((current) => current === "asc" ? "desc" : "asc");
    };

    const renderRequestTable = (requests) => {
        if (requests.length === 0) {
            return (
                <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                    <p className="text-lg font-bold text-slate-900">No repair requests found.</p>
                    <p className="mt-1 text-sm text-slate-500">
                        Try changing the filters or date range.
                    </p>
                </div>
            );
        }

        return (
            <div className="overflow-x-auto border-t border-slate-200">
                <table className="min-w-full bg-white">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <button
                                    type="button"
                                    onClick={toggleDateSortDirection}
                                    className="inline-flex items-center gap-1 text-left uppercase tracking-wide hover:text-slate-900"
                                >
                                    Date
                                    <span className="text-[10px] text-slate-400">
                                        {dateSortDirection === "asc" ? "ASC" : "DESC"}
                                    </span>
                                </button>
                            </th>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Customer
                            </th>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Requester
                            </th>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Description
                            </th>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Priority</th>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Status
                            </th>
                            <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Source
                            </th>
                        </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                        {requests.map((request) => (
                            <tr
                                key={getRequestCommentKey(request, recentlySelectedCompany)}
                                className="cursor-pointer transition hover:bg-slate-50"
                                onClick={() => handleOpenRequest(request)}
                            >
                                <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                                    <div className="flex items-center gap-2">
                                        <span>{formatDate(getRequestDateValue(request))}</span>
                                        {(commentCounts[getRequestCommentKey(request, recentlySelectedCompany)] || 0) > 0 && (
                                            <span
                                                className="inline-flex shrink-0 items-center rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-semibold text-white"
                                                aria-label={`${commentCounts[getRequestCommentKey(request, recentlySelectedCompany)]} unresolved comments`}
                                            >
                                                {commentCounts[getRequestCommentKey(request, recentlySelectedCompany)]}
                                            </span>
                                        )}
                                    </div>
                                </td>

                                <td className="whitespace-nowrap px-5 py-3">
                                    <div className="text-sm font-semibold text-slate-900">
                                        {request.customerName || "No customer"}
                                    </div>

                                    {request.serviceLocationName && (
                                        <div className="text-xs text-slate-500">
                                            {request.serviceLocationName}
                                        </div>
                                    )}
                                </td>

                                <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                                    {request.requesterName || "Unknown"}
                                </td>

                                <td className="max-w-md px-5 py-3">
                                    <p className="line-clamp-2 text-sm text-slate-700">
                                        {request.description || request.notes || "No description"}
                                    </p>
                                </td>

                                <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-700">
                                    {getRepairRequestIssuePriority(request)} - {getIssuePriorityLabel(getRepairRequestIssuePriority(request))}
                                </td>

                                <td className="whitespace-nowrap px-5 py-3">
                                    <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(request.status)}`}
                                    >
                                        {displayRepairRequestStatus(request.status)}
                                    </span>
                                </td>

                                <td className="whitespace-nowrap px-5 py-3">
                                    <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${request.source === "internal"
                                                ? "bg-blue-50 text-blue-700"
                                                : "bg-cyan-100 text-cyan-800"
                                            }`}
                                    >
                                        {request.source === "internal" ? "Internal" : "External"}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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
                            <h2 className="mt-1 text-3xl font-bold text-slate-950">
                                Repair Requests
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                Review internal technician requests and external homeowner requests.
                            </p>

                            <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                    Internal: {internalNeedsActionCount}
                                </span>

                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                    External: {externalNeedsActionCount}
                                </span>

                                <span className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-800">
                                    Needs action: {internalNeedsActionCount + externalNeedsActionCount}
                                </span>
                            </div>
                        </div>

                        {can("32") && (
                            <Link
                                to="/company/repair-requests/create"
                                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                Create New
                            </Link>
                        )}
                    </div>
                </section>

                <PublicRepairRequestLink companyId={recentlySelectedCompany} />

                <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-5 pt-4">
                        <nav className="-mb-px flex gap-8">
                            <button
                                type="button"
                                onClick={() => setActiveTab("all")}
                                className={`whitespace-nowrap border-b-2 px-1 pb-4 text-sm font-bold ${activeTab === "all"
                                    ? "border-blue-500 text-blue-600"
                                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
                            >
                                All Requests
                                <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                                    {internalNeedsActionCount + externalNeedsActionCount}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("internal")}
                                className={`whitespace-nowrap border-b-2 px-1 pb-4 text-sm font-bold ${activeTab === "internal"
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                                    }`}
                            >
                                Internal Requests
                                {internalNeedsActionCount > 0 && (
                                    <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                                        {internalNeedsActionCount}
                                    </span>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab("external")}
                                className={`whitespace-nowrap border-b-2 px-1 pb-4 text-sm font-bold ${activeTab === "external"
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                                    }`}
                            >
                                External Requests
                                {externalNeedsActionCount > 0 && (
                                    <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                                        {externalNeedsActionCount}
                                    </span>
                                )}
                            </button>
                        </nav>
                    </div>

                    <div>
                        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-5 xl:grid-cols-[1fr_auto_auto_auto]">
                            <input
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                placeholder="Search customer, requester, description..."
                            />

                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    aria-label="Repair requests start date"
                                    value={startDate}
                                    onChange={(event) => setStartDate(event.target.value)}
                                    className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />

                                <span className="text-sm text-slate-400">to</span>

                                <input
                                    type="date"
                                    aria-label="Repair requests end date"
                                    value={endDate}
                                    onChange={(event) => setEndDate(event.target.value)}
                                    className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </div>

                            <select
                                value={dateSortDirection}
                                onChange={(event) => setDateSortDirection(event.target.value)}
                                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                aria-label="Sort repair requests by date"
                            >
                                <option value="desc">Newest first</option>
                                <option value="asc">Oldest first</option>
                            </select>

                            <button
                                type="button"
                                onClick={refreshRequests}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                            >
                                Refresh
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 py-4">
                            <label className="mr-3 inline-flex items-center gap-2 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={onlyMyRequests}
                                    onChange={(event) => {
                                        const next = new URLSearchParams(searchParams);
                                        if (event.target.checked) next.set('submittedBy', 'me');
                                        else next.delete('submittedBy');
                                        setSearchParams(next, { replace: true });
                                    }}
                                />
                                Only requests I submitted
                            </label>
                            <button
                                type="button"
                                onClick={() => setSelectedStatuses(statusOptions)}
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                                All
                            </button>

                            <button
                                type="button"
                                onClick={() => setSelectedStatuses([])}
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                                Clear
                            </button>

                            {statusOptions.map((status) => {
                                const selected = selectedStatuses.includes(status);

                                return (
                                    <button
                                        key={status}
                                        type="button"
                                        onClick={() => toggleStatus(status)}
                                        className={`rounded-full border px-3 py-1 text-xs font-bold ${selected
                                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                            }`}
                                    >
                                        {status}
                                    </button>
                                );
                            })}
                        </div>

                        <p className="px-5 py-3 text-sm text-slate-500" aria-live="polite">{filteredRequests.length} requests showing</p>
                        {loading ? (
                            <div className="p-10 text-center">
                                <p className="font-semibold text-slate-700">
                                    Loading repair requests...
                                </p>
                            </div>
                        ) : (
                            renderRequestTable(filteredRequests)
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default RepairRequests;
