
import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { EquipmentHO } from '../../../utils/models/EquipmentHO';

const NewEquipment = () => {
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState('');
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState('');
    const [equipment, setEquipment] = useState(new EquipmentHO());

    useEffect(() => {
        if (!user) return;
        const fetchLocations = async () => {
            const q = query(collection(db, 'homeOwnerServiceLocations'), where("userId", "==", user.uid));
            const querySnapshot = await getDocs(q);
            const locations = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setServiceLocations(locations);
        };
        fetchLocations();
    }, [user]);

    useEffect(() => {
        if (!selectedLocation) {
            setBodiesOfWater([]);
            return;
        }
        const fetchBodiesOfWater = async () => {
            const q = query(collection(db, 'homeOwnerBodiesOfWater'), where("serviceLocationId", "==", selectedLocation));
            const querySnapshot = await getDocs(q);
            const bow = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBodiesOfWater(bow);
        };
        fetchBodiesOfWater();
    }, [selectedLocation]);

    const handleEquipmentChange = (field, value) => {
        setEquipment(new EquipmentHO({ ...equipment, [field]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!selectedLocation || !selectedBodyOfWater) {
            setError("Please select a service location and a body of water.");
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const equipmentId = 'hoe_' + uuidv4();
            const equipmentRef = doc(db, 'homeOwnerEquipment', equipmentId);

            await setDoc(equipmentRef, {
                ...equipment.toFirestore(),
                id: equipmentId,
                serviceLocationId: selectedLocation,
                bodyOfWaterId: selectedBodyOfWater,
                userId: user.uid,
                customerName: user.firstName + " " + user.lastName,
                customerId: user.uid,
                createdAt: new Date(),
            });
            navigate('/client/my-pool');
        } catch (err) {
            setError('Failed to save equipment. Please try again.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const formInputClasses = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => navigate(-1)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">Add New Equipment</h1>
                </div>

                <form onSubmit={handleSave} className="space-y-8 bg-white rounded-lg shadow-md p-6 md:p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <select
                            value={selectedLocation}
                            onChange={(e) => setSelectedLocation(e.target.value)}
                            className={formInputClasses}
                        >
                            <option value="" disabled>Select a location</option>
                            {serviceLocations.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.address.streetAddress || loc.name}</option>
                            ))}
                        </select>
                        <select
                            value={selectedBodyOfWater}
                            onChange={(e) => setSelectedBodyOfWater(e.target.value)}
                            className={formInputClasses}
                            disabled={!selectedLocation}
                        >
                            <option value="" disabled>Select a pool or spa</option>
                            {bodiesOfWater.map(bow => (
                                <option key={bow.id} value={bow.id}>{bow.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="p-3 border rounded-lg space-y-3">
                        <input type="text" placeholder="Equipment Name (e.g., Main Filter)" value={equipment.name} onChange={(e) => handleEquipmentChange('name', e.target.value)} className={formInputClasses} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input type="text" placeholder="Category (e.g., Filter)" value={equipment.category} onChange={(e) => handleEquipmentChange('category', e.target.value)} className={formInputClasses} />
                            <input type="text" placeholder="Make (e.g., Pentair)" value={equipment.make} onChange={(e) => handleEquipmentChange('make', e.target.value)} className={formInputClasses} />
                            <input type="text" placeholder="Model (e.g., FNS Plus 60)" value={equipment.model} onChange={(e) => handleEquipmentChange('model', e.target.value)} className={formInputClasses} />
                            <input type="date" placeholder="Date Installed" value={equipment.dateInstalled} onChange={(e) => handleEquipmentChange('dateInstalled', e.target.value)} className={formInputClasses} />
                        </div>
                        <textarea placeholder="Notes" value={equipment.notes} onChange={(e) => handleEquipmentChange('notes', e.target.value)} className={`${formInputClasses} h-20`}></textarea>
                    </div>

                    {error && <p className="text-red-500 text-center p-3 bg-red-50 rounded-md">{error}</p>}
                    <div className="flex justify-end pt-4">
                        <button type="submit" disabled={loading} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400">
                            {loading ? 'Saving...' : 'Save Equipment'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NewEquipment;
