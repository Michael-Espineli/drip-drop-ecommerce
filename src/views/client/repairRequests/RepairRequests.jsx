
import React, { useState, useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { PlusIcon, TruckIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const RepairRequests = () => {
    const { user } = useContext(Context);
    const [repairRequests, setRepairRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        const fetchRepairRequests = async () => {
            setLoading(true);
            try {
                const q = query(
                    collection(db, 'homeOwnerRepairRequests'),
                    where('userId', '==', user.uid),
                    orderBy('date', 'desc') // Order by the main date field
                );
                const querySnapshot = await getDocs(q);
                const requests = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRepairRequests(requests);
            } catch (error) {
                console.error("Error fetching repair requests: ", error);
            } finally {
                setLoading(false);
            }
        };

        fetchRepairRequests();
    }, [user]);

    if (loading) {
        return (
            <div className="p-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">Repair Requests</h1>
                <p>Loading repair requests...</p>
            </div>
        );
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Repair Requests</h1>
                    <Link
                        to="/client/repair-requests/new"
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700"
                    >
                        <PlusIcon className="w-5 h-5" />
                        <span>New Request</span>
                    </Link>
                </div>

                {repairRequests.length === 0 ? (
                    <NoRepairRequests />
                ) : (
                    <RepairRequestList requests={repairRequests} />
                )}
            </div>
        </div>
    );
};

const NoRepairRequests = () => (
    <div className="text-center bg-white p-12 rounded-lg shadow-md">
        <TruckIcon className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-xl font-medium text-gray-900">No repair requests found</h3>
        <p className="mt-1 text-sm text-gray-500">Get started by creating a new repair request.</p>
        <div className="mt-6">
            <Link
                to="/client/repair-requests/new"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                Create New Repair Request
            </Link>
        </div>
    </div>
);

const RepairRequestList = ({ requests }) => (
    <div className="bg-white shadow-md rounded-lg overflow-hidden">
        <ul className="divide-y divide-gray-200">
            {requests.map((req) => {
                const requestDate = req.date?.toDate ? req.date.toDate() : (req.createdAt?.toDate ? req.createdAt.toDate() : new Date());
                return (
                    <li key={req.id}>
                        <Link to={`/client/repair-requests/${req.id}`} className="block hover:bg-gray-50">
                            <div className="px-4 py-4 sm:px-6">
                                <div className="flex items-center justify-between">
                                    <p className="text-md font-medium text-blue-600 truncate">{req.description || "No description"}</p>
                                    <div className="ml-2 flex-shrink-0 flex">
                                        <p className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                            req.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                            req.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                                            'bg-green-100 text-green-800'
                                        }`}>
                                            {req.status}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-2 sm:flex sm:justify-between">
                                    <div className="sm:flex">
                                        {/* Can add more details here later */}
                                    </div>
                                    <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                                        <p>
                                            Requested on {format(requestDate, 'MMM d, yyyy')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </li>
                );
            })}
        </ul>
    </div>
);

export default RepairRequests;
