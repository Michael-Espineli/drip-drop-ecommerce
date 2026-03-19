
import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { writeBatch, doc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { BodyOfWaterHO } from '../../../utils/models/BodyOfWaterHO';
import { EquipmentHO } from '../../../utils/models/EquipmentHO';

const NewBodyOfWater = () => {
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState('');

    const [bodyOfWater, setBodyOfWater] = useState(new BodyOfWaterHO({ name: 'Main Pool' }));
    const [equipment, setEquipment] = useState([]);

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

    const handleBodyOfWaterChange = (field, value) => {
        setBodyOfWater(new BodyOfWaterHO({ ...bodyOfWater, [field]: value }));
    };

    const handleEquipmentChange = (index, field, value) => {
        const newEquipment = [...equipment];
        newEquipment[index] = new EquipmentHO({ ...newEquipment[index], [field]: value });
        setEquipment(newEquipment);
    };

    const addEquipment = () => {
        setEquipment([...equipment, new EquipmentHO()]);
    };

    const removeEquipment = (index) => {
        const newEquipment = equipment.filter((_, i) => i !== index);
        setEquipment(newEquipment);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!selectedLocation) {
            setError("Please select a service location.");
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const batch = writeBatch(db);
            const bodyOfWaterId = 'hobow_' + uuidv4();
            const bodyOfWaterRef = doc(db, 'homeOwnerBodiesOfWater', bodyOfWaterId);
            const bodyData = {
                ...bodyOfWater.toFirestore(),
                id: bodyOfWaterId,
                serviceLocationId: selectedLocation,
                userId: user.uid,
                createdAt: new Date()
            };
            batch.set(bodyOfWaterRef, bodyData);

            for (const equip of equipment) {
                const equipmentId = 'hoe_' + uuidv4();
                const equipmentRef = doc(db, 'homeOwnerEquipment', equipmentId);
                const equipData = {
                    ...equip.toFirestore(),
                    id: equipmentId,
                    bodyOfWaterId: bodyOfWaterId,
                    serviceLocationId: selectedLocation,
                    userId: user.uid,
                    createdAt: new Date()
                };
                batch.set(equipmentRef, equipData);
            }

            await batch.commit();
            navigate('/client/my-pool');
        } catch (err) {
            setError('Failed to save. Please try again.');
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
                    <h1 className="text-3xl font-bold text-gray-900">Add New Pool or Spa</h1>
                </div>

                <form onSubmit={handleSave} className="space-y-8 bg-white rounded-lg shadow-md p-6 md:p-8">
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-800">Service Location</h2>
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
                    </div>

                    <div className="p-4 border rounded-lg space-y-4">
                        <input type="text" placeholder="Pool or Spa Name (e.g., Main Pool)" value={bodyOfWater.name} onChange={(e) => handleBodyOfWaterChange('name', e.target.value)} className={formInputClasses} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input type="text" placeholder="Shape (e.g., Kidney, Rectangular)" value={bodyOfWater.shape} onChange={(e) => handleBodyOfWaterChange('shape', e.target.value)} className={formInputClasses} />
                            <input type="text" placeholder="Material (e.g., Plaster, Vinyl)" value={bodyOfWater.material} onChange={(e) => handleBodyOfWaterChange('material', e.target.value)} className={formInputClasses} />
                        </div>
                        <input type="number" placeholder="Volume in Gallons" value={bodyOfWater.gallons} onChange={(e) => handleBodyOfWaterChange('gallons', e.target.value)} className={formInputClasses} />
                        <textarea placeholder="Notes (e.g., has a solar cover, dog access)" value={bodyOfWater.notes} onChange={(e) => handleBodyOfWaterChange('notes', e.target.value)} className={`${formInputClasses} h-24`}></textarea>

                        <div className="space-y-4 pl-4 border-l-2">
                            <h3 className="text-lg font-semibold">Equipment</h3>
                            {equipment.map((equip, index) => (
                                <div key={index} className="p-3 border rounded-lg space-y-3">
                                     <div className="flex gap-4 items-center">
                                        <input
                                            type="text"
                                            placeholder="Equipment Name (e.g., Main Filter)"
                                            value={equip.name}
                                            onChange={(e) => handleEquipmentChange(index, 'name', e.target.value)}
                                            className={`flex-grow ${formInputClasses}`}
                                        />
                                        <button type="button" onClick={() => removeEquipment(index)} className="p-2 text-red-500 hover:text-red-700"><TrashIcon className="w-5 h-5" /></button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <input type="text" placeholder="Category (e.g., Filter)" value={equip.category} onChange={(e) => handleEquipmentChange(index, 'category', e.target.value)} className={formInputClasses} />
                                        <input type="text" placeholder="Make (e.g., Pentair)" value={equip.make} onChange={(e) => handleEquipmentChange(index, 'make', e.target.value)} className={formInputClasses} />
                                        <input type="text" placeholder="Model (e.g., FNS Plus 60)" value={equip.model} onChange={(e) => handleEquipmentChange(index, 'model', e.target.value)} className={formInputClasses} />
                                        <input type="text" placeholder="Date Installed" onFocus={(e) => e.target.type='date'} onBlur={(e) => e.target.type='text'} value={equip.dateInstalled} onChange={(e) => handleEquipmentChange(index, 'dateInstalled', e.target.value)} className={formInputClasses} />
                                    </div>
                                </div>
                            ))}
                            <button type="button" onClick={addEquipment} className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800"><PlusIcon className="w-5 h-5" /> Add Equipment</button>
                        </div>
                    </div>

                    {error && <p className="text-red-500 text-center p-3 bg-red-50 rounded-md">{error}</p>}
                    <div className="flex justify-end pt-4">
                        <button type="submit" disabled={loading} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400">
                            {loading ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NewBodyOfWater;
