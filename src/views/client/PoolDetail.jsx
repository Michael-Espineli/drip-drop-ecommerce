import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

const PoolDetail = () => {
    const { poolId } = useParams();
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [pool, setPool] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user || !poolId) return;

        const fetchPoolDetails = async () => {
            try {
                const docRef = doc(db, 'serviceLocations', poolId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const poolData = docSnap.data();
                    // Security check: Ensure the fetched pool belongs to the current user
                    if (poolData.userId === user.uid) {
                        setPool({ id: docSnap.id, ...poolData });
                    } else {
                        setError("You do not have permission to view this pool.");
                    }
                } else {
                    setError("Pool not found.");
                }
            } catch (err) {
                console.error("Error fetching pool details: ", err);
                setError("Failed to load pool details. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        fetchPoolDetails();
    }, [poolId, user]);

    if (loading) {
        return (
            <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen flex justify-center items-center">
                <p className="text-gray-500">Loading pool details...</p>
            </div>
        );
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button
                        onClick={() => navigate('/client/my-pool')}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-full"
                    >
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">
                        {pool ? pool.name : 'Pool Details'}
                    </h1>
                </div>

                {error ? (
                    <div className="bg-white rounded-lg shadow-md p-8 text-center">
                        <p className="text-red-500">{error}</p>
                    </div>
                ) : pool && (
                    <div className="bg-white rounded-lg shadow-md overflow-hidden">
                        <div className="p-6 md:p-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-2">
                                    <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-4">Address</h3>
                                    <p className="text-gray-800">{`${pool.address}, ${pool.city}, ${pool.state} ${pool.zipCode}`}</p>
                                </div>

                                {/* You can add more sections here, e.g., Equipment, Service History, etc. */}
                                <div className="md:col-span-2">
                                    <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-4">Equipment</h3>
                                    <p className="text-gray-500">Equipment details will be displayed here.</p>
                                </div>

                                <div className="md:col-span-2">
                                    <h3 className="text-lg font-semibold text-gray-700 border-b pb-2 mb-4">Service History</h3>
                                    <p className="text-gray-500">Service history will be displayed here.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PoolDetail;
