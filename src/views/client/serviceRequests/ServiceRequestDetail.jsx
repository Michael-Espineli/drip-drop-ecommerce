
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';

const ServiceRequestDetail = () => {
    const { requestId } = useParams();
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [request, setRequest] = useState(null);
    const [serviceLocation, setServiceLocation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        const docRef = doc(db, 'serviceRequests', requestId);

        const unsubscribe = onSnapshot(docRef, async (docSnap) => {
            if (docSnap.exists()) {
                const requestData = { id: docSnap.id, ...docSnap.data() };

                if (requestData.userId !== user.uid) {
                    setError("You don't have permission to view this request.");
                    setLoading(false);
                    return;
                }

                setRequest(requestData);

                if (requestData.serviceLocationId) {
                    const locRef = doc(db, 'homeOwnerServiceLocations', requestData.serviceLocationId);
                    const locSnap = await getDoc(locRef);
                    if (locSnap.exists()) {
                        setServiceLocation(locSnap.data());
                    }
                }
            } else {
                setError('Service request not found.');
            }
            setLoading(false);
        }, (err) => {
            console.error("Error fetching service request:", err);
            setError('Failed to load the service request.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [requestId, user, navigate]);

    const handleDelete = async () => {
        if (window.confirm('Are you sure you want to delete this service request?')) {
            try {
                await deleteDoc(doc(db, 'serviceRequests', requestId));
                navigate('/client/service-requests');
            } catch (err) {
                console.error("Error deleting document: ", err);
                setError('Failed to delete the request.');
            }
        }
    };

    const handleEdit = () => {
        navigate(`/client/service-requests/edit/${requestId}`);
    };

    if (loading) {
        return <div className="p-8">Loading request details...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">Error: {error}</div>;
    }

    if (!request) {
        return <div className="p-8">No request details to display.</div>;
    }

    const { companyName, createdAt, description, status, userId } = request;

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8 mb-6">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">{companyName}</h1>
                            <p className="text-sm text-gray-500">
                                Requested on: {createdAt ? new Date(createdAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                            </p>
                        </div>
                        <span className={`px-4 py-2 text-sm font-semibold rounded-full ${
                            status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            status === 'approved' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                        }`}>
                            {status}
                        </span>
                    </div>

                    <div className="mt-6 border-t border-gray-200 pt-6">
                        <h3 className="text-xl font-semibold text-gray-800 mb-3">Description</h3>
                        <p className="text-gray-600 whitespace-pre-wrap">{description}</p>
                    </div>

                    {serviceLocation && (
                        <div className="mt-6 border-t border-gray-200 pt-6">
                            <h3 className="text-xl font-semibold text-gray-800 mb-3">Service Location</h3>
                            <div className="bg-gray-50 p-4 rounded-lg">
                                <p className="font-bold text-gray-700">{serviceLocation.name}</p>
                                <p className="text-gray-600">{serviceLocation.address?.streetAddress}</p>
                                <p className="text-gray-600">{serviceLocation.address?.city}, {serviceLocation.address?.state} {serviceLocation.address?.zipCode}</p>
                            </div>
                        </div>
                    )}

                    {user && user.uid === userId && (
                        <div className="mt-8 border-t border-gray-200 pt-6 flex justify-end space-x-4">
                            <button onClick={handleEdit} className="px-6 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                                Edit
                            </button>
                            <button onClick={handleDelete} className="px-6 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ServiceRequestDetail;
