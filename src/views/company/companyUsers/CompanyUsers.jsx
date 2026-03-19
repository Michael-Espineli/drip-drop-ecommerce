
import React, { useState, useEffect, useContext, useMemo } from "react";
import { query, collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import { useNavigate } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';

const UserCard = ({ user, onClick }) => {
    const getStatusClass = (status) => {
        switch (status) {
            case 'Active': return 'bg-green-100 text-green-800';
            case 'Pending': return 'bg-yellow-100 text-yellow-800';
            case 'Inactive': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    return (
        <div onClick={onClick} className="bg-white p-5 rounded-xl shadow-lg border border-gray-200 hover:shadow-xl hover:border-blue-500 transition-all cursor-pointer">
            <div className="flex justify-between items-start">
                <h3 className="font-bold text-lg text-gray-800">{user.userName}</h3>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getStatusClass(user.status)}`}>{user.status}</span>
            </div>
            <div className="mt-3 text-sm text-gray-600">
                <p><span className="font-semibold">Role:</span> {user.roleName || 'Not Assigned'}</p>
                <p><span className="font-semibold">Type:</span> {user.workerType || 'N/A'}</p>
                {user.linkedCompanyName && <p><span className="font-semibold">Linked To:</span> {user.linkedCompanyName}</p>}
            </div>
        </div>
    );
};

const CompanyUsers = () => {
    const [allUsers, setAllUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();

    // Filtering state
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState(null);
    const [roleFilter, setRoleFilter] = useState(null);

    useEffect(() => {
        if (!recentlySelectedCompany) return;
        
        const fetchUsers = async () => {
            setIsLoading(true);
            try {
                const usersQuery = query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
                const querySnapshot = await getDocs(usersQuery);
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

    const statusOptions = [
        { value: 'Active', label: 'Active' },
        { value: 'Pending', label: 'Pending' },
        { value: 'Inactive', label: 'Inactive' },
    ];

    const filteredUsers = useMemo(() => {
        return allUsers.filter(user => {
            const searchMatch = user.userName.toLowerCase().includes(searchTerm.toLowerCase());
            const statusMatch = !statusFilter || user.status === statusFilter.value;
            const roleMatch = !roleFilter || user.roleName === roleFilter.value;
            return searchMatch && statusMatch && roleMatch;
        });
    }, [allUsers, searchTerm, statusFilter, roleFilter]);

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Company Users</h1>
                        <p className="text-gray-600 mt-1">Manage all users associated with your company.</p>
                    </div>
                    <button
                        onClick={() => navigate('/company/companyUsers/createNew')}
                        className='mt-4 sm:mt-0 py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all'>
                        Create New User
                    </button>
                </header>

                <div className="bg-white p-4 rounded-xl shadow-lg mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input 
                            type="text"
                            placeholder="Search by name..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="md:col-span-1 bg-gray-100 border-2 border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        />
                        <Select options={statusOptions} value={statusFilter} onChange={setStatusFilter} placeholder="Filter by status..." isClearable />
                        <Select options={roleOptions} value={roleFilter} onChange={setRoleFilter} placeholder="Filter by role..." isClearable isLoading={isLoading} />
                    </div>
                </div>

                {isLoading ? (
                    <div className="text-center py-10"><p className="text-gray-500">Loading users...</p></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredUsers.length > 0 ? (
                            filteredUsers.map(user => (
                                <UserCard key={user.id} user={user} onClick={() => navigate(`/company/companyUsers/detail/${user.userId}`)} />
                            ))
                        ) : (
                            <div className="col-span-full text-center py-12 bg-white rounded-xl shadow-lg">
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
