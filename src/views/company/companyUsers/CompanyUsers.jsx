
import React, { useState, useEffect, useContext, useMemo } from "react";
import { addDoc, collection, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { useNavigate } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { Link } from 'react-router-dom';
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import toast from "react-hot-toast";
import {
    canUsePersonalRouteVehicle,
    routeVehicleAccessLabel,
} from "../../../utils/models/CompanyUser";
import {
    MdAdd,
    MdHistory,
    MdChecklist,
    MdMailOutline,
    MdManageAccounts,
    MdNoteAdd,
    MdPayment,
    MdSettings,
} from "react-icons/md";

const normalizeStatus = (status) => (status || '').toString().trim().toLowerCase();

const formatStatus = (status) => {
    if (!status) return 'Unknown';
    return status.toString().charAt(0).toUpperCase() + status.toString().slice(1);
};

const getStatusClass = (status) => {
    switch (normalizeStatus(status)) {
        case 'active': return 'bg-green-100 text-green-800';
        case 'pending': return 'bg-yellow-100 text-yellow-800';
        case 'inactive': return 'bg-red-100 text-red-800';
        case 'past': return 'bg-slate-100 text-slate-700';
        default: return 'bg-gray-100 text-gray-800';
    }
};

const getUserDisplayName = (user = {}) => (
    user.userName ||
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.name ||
    user.email ||
    user.userId ||
    'Unknown User'
);

const getUserInitials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
};

const getUserPhotoUrl = (user = {}) => (
    user.photoUrl ||
    user.profileImageUrl ||
    user.profileImageURL ||
    user.userImage ||
    user.photoURL ||
    ''
);

const performanceLineTypes = [
    { value: "kudo", label: "Praise" },
    { value: "complaint", label: "Complaint" },
    { value: "coaching", label: "Coaching" },
    { value: "observation", label: "Observation" },
];

const emptyPerformanceNoteDraft = {
    companyUserId: "",
    type: "kudo",
    date: "",
    note: "",
};

const dateInputValue = (date = new Date()) => {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = safeDate.getFullYear();
    const month = String(safeDate.getMonth() + 1).padStart(2, "0");
    const day = String(safeDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const dateFromInputValue = (value) => {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const performanceReviewsRef = (companyId, companyUserId) => (
    collection(db, "companyUserPerformanceReviews", companyId, "companyUsers", companyUserId, "reviews")
);

const formatDate = (value) => {
    const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : 'N/A';
};

const isActiveCompanyUser = (user = {}) => {
    if (typeof user.active === 'boolean') return user.active;
    if (typeof user.isActive === 'boolean') return user.isActive;
    if (typeof user.disabled === 'boolean') return !user.disabled;
    if (user.status) return normalizeStatus(user.status) === 'active';
    return true;
};

const StatCard = ({ title, value, sub }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
        {sub ? <div className="mt-1 text-sm text-slate-500">{sub}</div> : null}
    </div>
);

const ActionLink = ({ to, children, icon: Icon, variant = 'secondary' }) => {
    const classes = variant === 'primary'
        ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

    return (
        <Link
            to={to}
            className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition ${classes}`}
        >
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
            <span>{children}</span>
        </Link>
    );
};

const ActionButton = ({ onClick, children, icon: Icon, variant = 'secondary', disabled = false }) => {
    const classes = variant === 'primary'
        ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:hover:bg-blue-50'
        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:hover:bg-white';

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${classes}`}
        >
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
            <span>{children}</span>
        </button>
    );
};

const UserAvatar = ({ user, displayName }) => {
    const [imageFailed, setImageFailed] = useState(false);
    const photoUrl = getUserPhotoUrl(user);

    return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-sm font-semibold text-white">
            {photoUrl && !imageFailed ? (
                <img
                    src={photoUrl}
                    alt={`${displayName} profile`}
                    className="h-full w-full object-cover"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <span>{getUserInitials(displayName)}</span>
            )}
        </div>
    );
};

const UserRow = ({ user, onClick }) => {
    const displayName = getUserDisplayName(user);
    const hasPersonalVehicleAccess = canUsePersonalRouteVehicle(user);

    return (
        <tr onClick={onClick} className="cursor-pointer border-b border-gray-100 transition hover:bg-blue-50/60">
            <td className="whitespace-nowrap px-4 py-4">
                <div className="flex items-center gap-3">
                    <UserAvatar user={user} displayName={displayName} />
                    <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-900">{displayName}</div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">{user.email || 'No email on file'}</div>
                    </div>
                </div>
            </td>
            <td className="whitespace-nowrap px-4 py-4">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(user.status)}`}>
                    {formatStatus(user.status)}
                </span>
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{user.roleName || 'Not Assigned'}</td>
            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{user.workerType || 'N/A'}</td>
            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{user.linkedCompanyName || 'N/A'}</td>
            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${hasPersonalVehicleAccess ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                    {routeVehicleAccessLabel(user)}
                </span>
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{formatDate(user.dateCreated || user.createdAt)}</td>
            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold text-blue-600">View</td>
        </tr>
    );
};

const CompanyUsers = () => {
    const [allUsers, setAllUsers] = useState([]);
    const [recentWorkLogCount, setRecentWorkLogCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const { recentlySelectedCompany, user: authUser, dataBaseUser } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const navigate = useNavigate();

    // Filtering state
    const [statusFilter, setStatusFilter] = useState(null);
    const [roleFilter, setRoleFilter] = useState(null);
    const [isPerformanceNoteModalOpen, setIsPerformanceNoteModalOpen] = useState(false);
    const [performanceNoteDraft, setPerformanceNoteDraft] = useState(emptyPerformanceNoteDraft);
    const [isSavingPerformanceNote, setIsSavingPerformanceNote] = useState(false);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setAllUsers([]);
            setRecentWorkLogCount(0);
            setIsLoading(false);
            return;
        }

        const fetchUsers = async () => {
            setIsLoading(true);
            try {
                const [usersResult, workLogsResult, activeRouteLogsResult] = await Promise.allSettled([
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'companyUsers')),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'workLogs')),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'activeRouteLogs')),
                ]);
                if (usersResult.status === 'rejected') throw usersResult.reason;

                const querySnapshot = usersResult.value;
                const userList = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                const workLogsSize = workLogsResult.status === 'fulfilled' ? workLogsResult.value.size : 0;
                const activeRouteLogsSize = activeRouteLogsResult.status === 'fulfilled' ? activeRouteLogsResult.value.size : 0;

                if (workLogsResult.status === 'rejected' || activeRouteLogsResult.status === 'rejected') {
                    console.warn("Could not load all work log stats for company users.");
                }

                setAllUsers(userList);
                setRecentWorkLogCount(Math.min(workLogsSize + activeRouteLogsSize, 50));
            } catch (error) {
                console.error("Error fetching company users: ", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchUsers();
    }, [recentlySelectedCompany]);

    const roleOptions = useMemo(() => {
        const roles = [...new Set(allUsers.map(u => u.roleName).filter(Boolean))];
        return roles.map(role => ({ value: role, label: role }));
    }, [allUsers]);

    const statusOptions = useMemo(() => {
        const statuses = [...new Set(allUsers.map(u => u.status).filter(Boolean))];
        return statuses.map(status => ({ value: status, label: formatStatus(status) }));
    }, [allUsers]);

    const filteredUsers = useMemo(() => {
        return allUsers.filter(user => {
            const statusMatch = !statusFilter || normalizeStatus(user.status) === normalizeStatus(statusFilter.value);
            const roleMatch = !roleFilter || user.roleName === roleFilter.value;
            return statusMatch && roleMatch;
        }).sort((left, right) => getUserDisplayName(left).localeCompare(getUserDisplayName(right)));
    }, [allUsers, statusFilter, roleFilter]);

    const stats = useMemo(() => ({
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter(isActiveCompanyUser).length,
        recentWorkLogs: recentWorkLogCount,
        filteredUsers: filteredUsers.length,
    }), [allUsers, filteredUsers.length, recentWorkLogCount]);

    const performanceUserOptions = useMemo(() => (
        allUsers
            .slice()
            .sort((left, right) => getUserDisplayName(left).localeCompare(getUserDisplayName(right)))
            .map((user) => ({
                value: user.id,
                label: getUserDisplayName(user),
                user,
            }))
    ), [allUsers]);

    const selectedPerformanceUserOption = performanceUserOptions.find((option) => (
        option.value === performanceNoteDraft.companyUserId
    )) || null;
    const selectedPerformanceUser = selectedPerformanceUserOption?.user || null;
    const reviewerName = (
        dataBaseUser?.userName ||
        dataBaseUser?.displayName ||
        dataBaseUser?.firstName ||
        authUser?.displayName ||
        authUser?.email ||
        "Management"
    );

    const openPerformanceNoteModal = () => {
        setPerformanceNoteDraft({
            ...emptyPerformanceNoteDraft,
            date: dateInputValue(new Date()),
        });
        setIsPerformanceNoteModalOpen(true);
    };

    const closePerformanceNoteModal = () => {
        if (isSavingPerformanceNote) return;
        setIsPerformanceNoteModalOpen(false);
        setPerformanceNoteDraft(emptyPerformanceNoteDraft);
    };

    const updatePerformanceNoteDraft = (field, value) => {
        setPerformanceNoteDraft((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const handleSavePerformanceNote = async () => {
        if (!requirePermission("264", "create performance notes")) return;
        if (!recentlySelectedCompany) {
            toast.error("Please select a company.");
            return;
        }
        if (!selectedPerformanceUser?.id) {
            toast.error("Select a user before saving.");
            return;
        }
        if (!performanceNoteDraft.note.trim()) {
            toast.error("Add a description before saving.");
            return;
        }

        const selectedDate = dateFromInputValue(performanceNoteDraft.date);
        const reviewDate = Timestamp.fromDate(selectedDate || new Date());

        setIsSavingPerformanceNote(true);
        try {
            await addDoc(performanceReviewsRef(recentlySelectedCompany, selectedPerformanceUser.id), {
                type: performanceNoteDraft.type,
                note: performanceNoteDraft.note.trim(),
                date: reviewDate,
                references: {
                    serviceStops: [],
                    jobs: [],
                },
                attachedReports: [],
                attachments: [],
                visibleToTechnician: false,
                isSummaryReport: false,
                companyInternal: true,
                companyId: recentlySelectedCompany,
                companyUserId: selectedPerformanceUser.id,
                technicianUserId: selectedPerformanceUser.userId || "",
                technicianName: getUserDisplayName(selectedPerformanceUser),
                createdByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
                createdByName: reviewerName,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            toast.success("Performance note saved.");
            setIsPerformanceNoteModalOpen(false);
            setPerformanceNoteDraft(emptyPerformanceNoteDraft);
        } catch (error) {
            console.error("Error saving performance note from company users:", error);
            toast.error("Failed to save performance note.");
        } finally {
            setIsSavingPerformanceNote(false);
        }
    };

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="mx-auto">
                <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Users</h1>
                        <p className="text-gray-600 mt-1">Manage company users, roles, payroll, and recent activity.</p>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                        <ActionLink to="/company/invites/pending" icon={MdMailOutline}>
                            Pending Invites
                        </ActionLink>
                        <ActionLink to="/company/workLogs" icon={MdHistory}>
                            Work Logs
                        </ActionLink>
                        <ActionLink to="/Company/Roles" icon={MdManageAccounts}>
                            Roles
                        </ActionLink>
                        <ActionLink to="/company/settings" icon={MdSettings}>
                            Settings
                        </ActionLink>
                        <ActionLink to="/company/settings/onboarding-checklist" icon={MdChecklist}>
                            User Onboarding Checklist
                        </ActionLink>
                        <ActionLink to="/company/payroll" icon={MdPayment}>
                            Payroll
                        </ActionLink>
                        {can("264") && (
                            <ActionButton onClick={openPerformanceNoteModal} icon={MdNoteAdd} variant="primary">
                                Add Performance Note
                            </ActionButton>
                        )}
                        {can("262") && (
                            <ActionLink
                                to="/company/companyUsers/createNew"
                                icon={MdAdd}
                                variant="primary"
                            >
                                Create New User
                            </ActionLink>
                        )}
                    </div>
                </header>

                {isPerformanceNoteModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
                        <div
                            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="company-users-performance-note-title"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                                <div>
                                    <h2 id="company-users-performance-note-title" className="text-lg font-semibold text-slate-950">Add Performance Note</h2>
                                    <p className="mt-1 text-sm text-slate-500">Create an internal performance note for a selected company user.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closePerformanceNoteModal}
                                    disabled={isSavingPerformanceNote}
                                    className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="overflow-y-auto p-5">
                                <div className="space-y-5">
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
                                        <label className="space-y-1.5">
                                            <span className="text-sm font-semibold text-slate-700">User</span>
                                            <Select
                                                options={performanceUserOptions}
                                                value={selectedPerformanceUserOption}
                                                onChange={(option) => updatePerformanceNoteDraft("companyUserId", option?.value || "")}
                                                placeholder="Select a user..."
                                                isClearable
                                                isDisabled={isSavingPerformanceNote}
                                            />
                                        </label>

                                        <label className="space-y-1.5">
                                            <span className="text-sm font-semibold text-slate-700">Note Type</span>
                                            <select
                                                value={performanceNoteDraft.type}
                                                onChange={(event) => updatePerformanceNoteDraft("type", event.target.value)}
                                                disabled={isSavingPerformanceNote}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                                            >
                                                {performanceLineTypes.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="space-y-1.5">
                                            <span className="text-sm font-semibold text-slate-700">Date</span>
                                            <input
                                                type="date"
                                                value={performanceNoteDraft.date || dateInputValue(new Date())}
                                                onChange={(event) => updatePerformanceNoteDraft("date", event.target.value)}
                                                disabled={isSavingPerformanceNote}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                                            />
                                        </label>
                                    </div>

                                    <label className="block space-y-1.5">
                                        <span className="text-sm font-semibold text-slate-700">Description</span>
                                        <textarea
                                            value={performanceNoteDraft.note}
                                            onChange={(event) => updatePerformanceNoteDraft("note", event.target.value)}
                                            disabled={isSavingPerformanceNote}
                                            rows={6}
                                            className="min-h-[160px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                                            placeholder="Document the performance note..."
                                        />
                                    </label>

                                    <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                                        <button
                                            type="button"
                                            onClick={closePerformanceNoteModal}
                                            disabled={isSavingPerformanceNote}
                                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSavePerformanceNote}
                                            disabled={isSavingPerformanceNote}
                                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <MdNoteAdd className="h-4 w-4" aria-hidden="true" />
                                            {isSavingPerformanceNote ? "Saving..." : "Add Note"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Total Users" value={stats.totalUsers} />
                    <StatCard title="Active Users" value={stats.activeUsers} sub="Based on status and active flags" />
                    <StatCard title="Recent Work Logs" value={stats.recentWorkLogs} sub="Last 50 loaded" />
                    <StatCard title="Filtered Users" value={stats.filteredUsers} sub="Matches status and role filters" />
                </div>

                <div className="bg-white p-4 rounded-xl shadow-lg mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Select options={statusOptions} value={statusFilter} onChange={setStatusFilter} placeholder="Filter by status..." isClearable />
                        <Select options={roleOptions} value={roleFilter} onChange={setRoleFilter} placeholder="Filter by role..." isClearable isLoading={isLoading} />
                    </div>
                </div>

                {isLoading ? (
                    <div className="text-center py-10"><p className="text-gray-500">Loading users...</p></div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                        {filteredUsers.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">User</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Role</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Linked To</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Vehicle</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Created</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {filteredUsers.map(user => (
                                            <UserRow key={user.id} user={user} onClick={() => navigate(`/company/companyUsers/${user.userId || user.id}/general`)} />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <h3 className="text-xl font-semibold text-gray-700">No Users Found</h3>
                                <p className="text-gray-500 mt-2">Click "Create New User" to add a user or adjust your filters.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default CompanyUsers;
