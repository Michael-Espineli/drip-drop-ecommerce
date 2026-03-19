
import React, { useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const ServiceRequests = () => {
    const { user } = useContext(Context); 
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    //This needs to be changed to get the company Id from the user
    const companyId = "";

    useEffect(() => {
        if (!companyId) {
            setLoading(false);
            // Optional: You might want to handle this case, e.g., show a message
            return;
        }

        setLoading(true);
        const requestsRef = collection(db, 'serviceRequests');
        const q = query(requestsRef, where('companyId', '==', companyId));

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            if (snapshot.empty) {
                setRequests([]);
                setLoading(false);
                return;
            }

            try {
                const requestsData = await Promise.all(snapshot.docs.map(async (requestDoc) => {
                    const requestData = requestDoc.data();
                    let locationAddress = 'N/A';

                    if (requestData.serviceLocationId) {
                        const locationRef = doc(db, 'serviceLocations', requestData.serviceLocationId);
                        const locationSnap = await getDoc(locationRef);
                        if (locationSnap.exists()) {
                            locationAddress = locationSnap.data().address || 'Address not specified';
                        }
                    }

                    return {
                        id: requestDoc.id,
                        ...requestData,
                        locationAddress,
                        createdAt: requestData.createdAt?.toDate().toLocaleDateString()
                    };
                }));

                setRequests(requestsData);
            } catch (err) {
                console.error("Error processing snapshot: ", err);
                setError("Failed to process service requests.");
            } finally {
                setLoading(false);
            }
        }, (err) => {
            console.error("Snapshot listener error: ", err);
            setError('Failed to listen for real-time updates.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [companyId]);

    const handleRequestClick = (requestId) => {
        //Update this to the correct route
        navigate(`/company/service-requests/${requestId}`);
    };

    if (loading) {
        return <div className="p-8">Loading service requests...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">Error: {error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Incoming Service Requests</h1>
                    <p className="mt-1 text-lg text-gray-600">View and manage new requests from clients.</p>
                </div>

                {requests.length === 0 ? (
                    <div className="text-center bg-white p-12 rounded-lg shadow-md">
                        <h3 className="text-xl font-medium text-gray-900">No new requests</h3>
                        <p className="mt-1 text-sm text-gray-500">You don't have any pending service requests at the moment.</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow-md overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
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
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{request.userDisplayName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.locationAddress}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.createdAt}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
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
