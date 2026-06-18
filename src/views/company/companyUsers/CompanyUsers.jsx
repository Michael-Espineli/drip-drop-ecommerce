
import React, { useState, useEffect, useContext, useMemo } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import { useNavigate } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { Link } from 'react-router-dom';
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

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

const formatDate = (value) => {
    const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : 'N/A';
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
                {user.allowPersonalVehicle ? (
                    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                        Personal vehicle allowed
                    </span>
                ) : 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{formatDate(user.dateCreated || user.createdAt)}</td>
            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold text-blue-600">View</td>
        </tr>
    );
};

const CompanyUsers = () => {
    const [allUsers, setAllUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const { can } = useCompanyPermissions();
    const navigate = useNavigate();

    // Filtering state
    const [statusFilter, setStatusFilter] = useState(null);
    const [roleFilter, setRoleFilter] = useState(null);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setAllUsers([]);
            setIsLoading(false);
            return;
        }

        const fetchUsers = async () => {
            setIsLoading(true);
            try {
                const querySnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
                const userList = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                setAllUsers(userList);
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

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Company Users</h1>
                        <p className="text-gray-600 mt-1">Manage all users associated with your company.</p>
                    </div>

                    <div className="flex space-x-4">
                        <Link to="/company/invites/pending" className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                            See Pending Invites
                        </Link>
                        {can("262") && (
                            <Link to="/company/companyUsers/createNew"
                                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                            >
                                + Create New User
                            </Link>
                        )}
                    </div>
                </header>

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
