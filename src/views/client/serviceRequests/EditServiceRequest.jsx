
import React, { useState, useContext, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';

const EditServiceRequest = () => {
    const { requestId } = useParams();
    const { user } = useContext(Context);
    const navigate = useNavigate();
    
    const [company, setCompany] = useState(null);
    const [description, setDescription] = useState('');
    const [serviceLocation, setServiceLocation] = useState('');
    const [userLocations, setUserLocations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!user) {
            navigate('/client/service-requests');
            return;
        }

        const fetchRequestAndLocations = async () => {
            setLoading(true);
            try {
                const requestRef = doc(db, 'serviceRequests', requestId);
                const requestSnap = await getDoc(requestRef);

                if (!requestSnap.exists() || requestSnap.data().userId !== user.uid) {
                    setError('Service request not found or you do not have permission to edit it.');
                    setLoading(false);
                    return;
                }

                const requestData = requestSnap.data();
                setDescription(requestData.description);
                setServiceLocation(requestData.serviceLocationId);

                // Fetch company details
                const companyRef = doc(db, 'companies', requestData.companyId);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                    setCompany({ id: companySnap.id, ...companySnap.data() });
                }

                // Fetch user's service locations
                const locationsRef = collection(db, 'homeOwnerServiceLocations');
                const q = query(locationsRef, where("userId", "==", user.uid));
                const querySnapshot = await getDocs(q);
                const locations = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setUserLocations(locations);

            } catch (err) {
                console.error("Error fetching data: ", err);
                setError('Failed to load necessary data.');
            } finally {
                setLoading(false);
            }
        };

        fetchRequestAndLocations();
    }, [requestId, user, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!description || !serviceLocation) {
            setError('Please fill out all fields.');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const requestRef = doc(db, 'serviceRequests', requestId);
            await updateDoc(requestRef, {
                serviceLocationId: serviceLocation,
                description,
            });
            navigate(`/client/service-requests/${requestId}`);
        } catch (err) {
            console.error("Error updating service request: ", err);
            setError('Failed to update your request. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="p-8">Loading...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">Error: {error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Edit Service Request for</h1>
                <h2 className="text-2xl font-semibold text-blue-600 mb-6">{company?.name}</h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="serviceLocation" className="block text-sm font-medium text-gray-700 mb-1">
                            Service Location
                        </label>
                        <select
                            id="serviceLocation"
                            name="serviceLocation"
                            value={serviceLocation}
                            onChange={(e) => setServiceLocation(e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            required
                        >
                            <option value="" disabled>Select a location</option>
                            {userLocations.map(loc => (
                                <option key={loc.id} value={loc.id}>
                                    {loc.name || `Unnamed Location (ID: ${loc.id})`}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                            Describe the Issue
                        </label>
                        <textarea
                            id="description"
                            name="description"
                            rows={6}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Please describe the problem in as much detail as possible..."
                            required
                        />
                    </div>

                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400"
                        >
                            {submitting ? 'Saving Changes...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditServiceRequest;
