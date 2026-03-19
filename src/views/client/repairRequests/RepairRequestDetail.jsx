
import React, { useState, useEffect, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { Context } from '../../../context/AuthContext';
import { DripDropStoredImage } from '../../../utils/models/DripDropStoredImage';

const RepairRequestDetail = () => {
    const { user } = useContext(Context);
    const { repairRequestId } = useParams();
    const [request, setRequest] = useState(null);
    const [location, setLocation] = useState(null);
    const [bodyOfWater, setBodyOfWater] = useState(null);
    const [equipment, setEquipment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchRequestDetails = async () => {
            if (!user) {
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
                console.log("Getting Repair Requets: ", repairRequestId)
                const requestRef = doc(db, 'homeOwnerRepairRequests', repairRequestId);
                const requestSnap = await getDoc(requestRef);

                if (requestSnap.exists()) {
                    console.log("Got Repair Requets")
                    const requestData = requestSnap.data();
                    setRequest({ id: requestSnap.id, ...requestData });

                
                    // Fetch related data
                    if (requestData.locationId) {
                        const locationRef = doc(db, 'homeOwnerServiceLocations', requestData.locationId);
                        const locationSnap = await getDoc(locationRef);
                        if (locationSnap.exists()) {
                            setLocation(locationSnap.data());
                        }
                    }
                    if (requestData.bodyOfWaterId) {
                        const bodyOfWaterRef = doc(db, 'homeOwnerBodiesOfWater', requestData.bodyOfWaterId);
                        const bodyOfWaterSnap = await getDoc(bodyOfWaterRef);
                        if (bodyOfWaterSnap.exists()) {
                            setBodyOfWater(bodyOfWaterSnap.data());
                        }
                    }
                    if (requestData.equipmentId) {
                        const equipmentRef = doc(db, 'homeOwnerEquipment', requestData.equipmentId);
                        const equipmentSnap = await getDoc(equipmentRef);
                        if (equipmentSnap.exists()) {
                            setEquipment(equipmentSnap.data());
                        }
                    }
                    
                } else {
                    setError('Repair request not found.');
                }
            } catch (err) {
                console.error("Error fetching repair request details:", err);
                setError('Failed to fetch repair request details.');
            } finally {
                setLoading(false);
            }
        };

        fetchRequestDetails();
    }, [repairRequestId, user]);

    if (loading) {
        return <div className="p-8">Loading...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">{error}</div>;
    }

    if (!request) {
        return null;
    }

    const images = request.photoUrls.map(data => new DripDropStoredImage(data));

    return (
        <div className="bg-gray-100 min-h-screen">
            <div className="max-w-4xl mx-auto p-4 md:p-8">
                <div className="bg-white shadow-lg rounded-lg overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <h1 className="text-3xl font-bold text-gray-800">Repair Request Details</h1>
                        <p className="text-sm text-gray-500 mt-1">Submitted on {new Date(request.date.seconds * 1000).toLocaleDateString()}</p>
                    </div>
                    
                    <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h3 className="font-semibold text-lg text-gray-700 mb-2">Issue Description</h3>
                                <p className="text-gray-600">{request.description}</p>
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg text-gray-700 mb-2">Request Status</h3>
                                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                    request.status === 'pending' ? 'bg-yellow-200 text-yellow-800' :
                                    request.status === 'in-progress' ? 'bg-blue-200 text-blue-800' :
                                    'bg-green-200 text-green-800'
                                }`}>
                                    {request.status}
                                </span>
                            </div>
                            {location && (
                                <div>
                                    <h3 className="font-semibold text-lg text-gray-700 mb-2">Service Location</h3>
                                    <p className="text-gray-600">{location.nickName || location.address.streetAddress}</p>
                                </div>
                            )}
                            {bodyOfWater && (
                                <div>
                                    <h3 className="font-semibold text-lg text-gray-700 mb-2">Body of Water</h3>
                                    <p className="text-gray-600">{bodyOfWater.name}</p>
                                </div>
                            )}
                            {equipment && (
                                <div>
                                    <h3 className="font-semibold text-lg text-gray-700 mb-2">Equipment</h3>
                                    <p className="text-gray-600">{equipment.name}</p>
                                </div>
                            )}
                        </div>

                        {images.length > 0 && (
                            <div className="mt-8">
                                <h3 className="font-semibold text-lg text-gray-700 mb-4">Attached Photos</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {images.map(image => (
                                        <div key={image.id} className="relative">
                                            <img 
                                                src={image.imageURL} 
                                                alt={image.description || 'Repair request photo'}
                                                className="w-full h-32 object-cover rounded-lg shadow-md"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RepairRequestDetail;
