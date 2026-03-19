
import React, { useEffect, useState, useContext } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { RepairRequest } from '../../../utils/models/RepairRequest';
import { Context } from "../../../context/AuthContext";
import { Link,useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

const RepairRequests = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [customerRequests, setCustomerRequests] = useState([]);
    const [internalRequests, setInternalRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('internal');

    const navigate = useNavigate();
    useEffect(() => {
        const fetchRepairRequests = async () => {
            if (recentlySelectedCompany) {
                setLoading(true);
                try {
                    const companyUsersQuery = query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
                    const companyUsersSnapshot = await getDocs(companyUsersQuery);
                    const companyUserIds = companyUsersSnapshot.docs.map(doc => doc.data().userId);
                    
                    const requestsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'repairRequests'));
                    const requestsSnapshot = await getDocs(requestsQuery);
                    
                    const allRequests = requestsSnapshot.docs.map(doc => RepairRequest.fromFirestore(doc));

                    setInternalRequests(allRequests);

                    
                    const customerRequestsQuery = query(collection(db, 'homeOwnerRepairRequests'),where("companyId","==",recentlySelectedCompany));
                    const customerRequestsSnapshot = await getDocs(customerRequestsQuery);
                    
                    const customerRequests = customerRequestsSnapshot.docs.map(doc => RepairRequest.fromFirestore(doc));

                    setCustomerRequests(customerRequests);


                } catch (error) {
                    console.error("Error fetching repair requests:", error);
                } finally {
                    setLoading(false);
                }
            }
        };

        fetchRepairRequests();
    }, [recentlySelectedCompany]);

    const renderList = (requests) => (
        <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                    <tr>
                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase">Date</th>
                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase">Customer</th>
                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase">Requester</th>
                        <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {requests.map(req => (
                        <tr key={req.id} className="hover:bg-gray-50"
                        onClick={() => navigate(`/company/repair-requests/detail/${req.id}`)}
                        >
                            <td className="p-4 whitespace-nowrap text-gray-700">{req.date ? format(req.date, 'PP') : 'N/A'}</td>
                            <td className="p-4 whitespace-nowrap text-gray-800 font-medium">{req.customerName}</td>
                            <td className="p-4 whitespace-nowrap text-gray-700">{req.requesterName}</td>
                            <td className="p-4 whitespace-nowrap"><span className={`px-3 py-1 text-xs font-bold rounded-full ${req.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{req.status}</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-bold text-gray-800">Repair Requests</h2>
                    <Link to={'/company/repair-requests/create'} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition'>
                        Create New
                    </Link>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-6">
                    <div className="border-b border-gray-200">
                        <nav className="-mb-px flex space-x-8">
                            <button onClick={() => setActiveTab('internal')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'internal' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>
                                Internal Requests
                            </button>
                            <button onClick={() => setActiveTab('customer')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'customer' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>
                                Customer Requests
                            </button>
                        </nav>
                    </div>
                    
                    {loading ? <p className="text-center p-8">Loading...</p> : 
                        <div className="pt-4">
                            {activeTab === 'customer' ? renderList(customerRequests) : renderList(internalRequests)}
                        </div>
                    }
                </div>
            </div>
        </div>
    );
};

export default RepairRequests;
