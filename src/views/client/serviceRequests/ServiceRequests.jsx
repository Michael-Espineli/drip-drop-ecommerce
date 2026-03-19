
import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const ServiceRequests = () => {
    const { user } = useContext(Context);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const requestsRef = collection(db, 'homeOwnerServiceRequests');
        const q = query(requestsRef, where('userId', '==', user.uid));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                setRequests([]);
                setLoading(false);
                return;
            }

            const requestsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate().toLocaleDateString()
            }));

            setRequests(requestsData);
            setLoading(false);
        }, (err) => {
            console.error("Snapshot listener error: ", err);
            setError('Failed to listen for real-time updates.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleRequestClick = (requestId) => {
        navigate(`/client/service-requests/${requestId}`);
    };
    
    if (loading) {
        return <div className="p-8">Loading your service requests...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">Error: {error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">My Service Requests</h1>
                    <p className="mt-1 text-lg text-gray-600">Track the status of all your service requests.</p>
                </div>

                {requests.length === 0 ? (
                    <div className="text-center bg-white p-12 rounded-lg shadow-md">
                        <h3 className="text-xl font-medium text-gray-900">No requests found</h3>
                        <p className="mt-1 text-sm text-gray-500">You haven't made any service requests yet.</p>
                        <button
                            onClick={() => navigate('/client/companies')}
                            className="mt-6 inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                            Browse Companies to Get Started
                        </button>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow-md overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th scope="col" className="relative px-6 py-3">
                                        <span className="sr-only">View</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {requests.map(request => (
                                    <tr key={request.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{request.companyName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.createdAt}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                                                request.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                'bg-red-100 text-red-800'
                                            }`}>
                                                {request.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button onClick={() => handleRequestClick(request.id)} className="text-blue-600 hover:text-blue-900">View</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServiceRequests;
