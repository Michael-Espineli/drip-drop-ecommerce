
import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { writeBatch, doc, setDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { ServiceLocationHO } from '../../../utils/models/ServiceLocationHO';
import { BodyOfWaterHO } from '../../../utils/models/BodyOfWaterHO';
import { EquipmentHO } from '../../../utils/models/EquipmentHO';

const CreateServiceLocation = () => {
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    // Service Location State
    const [serviceLocation, setServiceLocation] = useState(new ServiceLocationHO());

    // Bodies of Water State
    const [bodiesOfWater, setBodiesOfWater] = useState([new BodyOfWaterHO({ name: 'Main Pool' })]);

    // Equipment State
    const [equipment, setEquipment] = useState([
        []
    ]);
    const [formData, setFormData] = useState({
        homeownerName: '',
        homeownerEmail: '',
        homeownerPhone: '',
        serviceName: '',
        serviceDescription: '',
        streetAddress: '',
        city: '',
        state: '',
        zip: '',
        latitude: null,
        longitude: null,
    });
    const handleAddressSelect = (address) => {
        setFormData(prev => ({
            ...prev,
            streetAddress: address.streetAddress,
            city: address.city,
            state: address.state,
            zip: address.zipCode,
            latitude: address.latitude,
            longitude: address.longitude,
        }));
    };

    const handleBodyOfWaterChange = (index, field, value) => {
        const newBodiesOfWater = [...bodiesOfWater];
        newBodiesOfWater[index] = new BodyOfWaterHO({ ...newBodiesOfWater[index], [field]: value });
        setBodiesOfWater(newBodiesOfWater);
    };

    const addBodyOfWater = () => {
        setBodiesOfWater([...bodiesOfWater, new BodyOfWaterHO()]);
        setEquipment([...equipment, []]);
    };

    const removeBodyOfWater = (index) => {
        if (bodiesOfWater.length > 1) {
            const newBodiesOfWater = bodiesOfWater.filter((_, i) => i !== index);
            setBodiesOfWater(newBodiesOfWater);
            const newEquipment = equipment.filter((_, i) => i !== index);
            setEquipment(newEquipment);
        }
    };

    const handleEquipmentChange = (bodyIndex, equipIndex, field, value) => {
        const newEquipment = [...equipment];
        const updatedEquip = { ...newEquipment[bodyIndex][equipIndex], [field]: value };
        newEquipment[bodyIndex][equipIndex] = new EquipmentHO(updatedEquip);
        setEquipment(newEquipment);
    };

    const addEquipment = (bodyIndex) => {
        const newEquipment = [...equipment];
        newEquipment[bodyIndex] = [...newEquipment[bodyIndex], new EquipmentHO()];
        setEquipment(newEquipment);
    };

    const removeEquipment = (bodyIndex, equipIndex) => {
        const newEquipment = [...equipment];
        newEquipment[bodyIndex] = newEquipment[bodyIndex].filter((_, i) => i !== equipIndex);
        setEquipment(newEquipment);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        console.log("Service Location: ", serviceLocation)
        if (!serviceLocation.address?.streetAddress) {
            setError("Please enter a service address.");
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const batch = writeBatch(db);
            
            const serviceLocationId = 'hosl_' + uuidv4();
            const serviceLocationRef = doc(db, 'homeOwnerServiceLocations', serviceLocationId);
            const serviceLocationData = {
                ...serviceLocation.toFirestore(),
                id: serviceLocationId,
                userId: user.uid,
                createdAt: new Date(),
                address: {
                    streetAddress: formData.streetAddress,
                    city: formData.city,
                    state: formData.state,
                    zip: formData.zip,
                    latitude: formData.latitude,
                    longitude: formData.longitude,
                },
            };
            batch.set(serviceLocationRef, serviceLocationData);

            for (let i = 0; i < bodiesOfWater.length; i++) {
                const bodyOfWaterId = 'hobow_' + uuidv4();
                const bodyOfWaterRef = doc(db, 'homeOwnerBodiesOfWater', bodyOfWaterId);
                const bodyData = {
                    ...bodiesOfWater[i].toFirestore(),
                    id: bodyOfWaterId,
                    serviceLocationId: serviceLocationId,
                    userId: user.uid,
                    createdAt: new Date()
                };
                batch.set(bodyOfWaterRef, bodyData);

                if (equipment[i]) {
                    for (const equip of equipment[i]) {
                        const equipmentId = 'hoe_' + uuidv4();
                        const equipmentRef = doc(db, 'homeOwnerEquipment', equipmentId);
                        const equipData = {
                            ...equip.toFirestore(),
                            id: equipmentId,
                            bodyOfWaterId: bodyOfWaterId,
                            serviceLocationId: serviceLocationId,
                            userId: user.uid,
                            createdAt: new Date()
                        };
                        batch.set(equipmentRef, equipData);
                    }
                }
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

    const inputClasses = "w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm";
    const formInputClasses = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => navigate(-1)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">Add New Pool Service Location</h1>
                </div>

                <form onSubmit={handleSave} className="space-y-8 bg-white rounded-lg shadow-md p-6 md:p-8">
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-800">Service Location</h2>
                        <AddressAutocomplete onAddressSelect={handleAddressSelect} placeholder="Enter service address" customClasses={inputClasses} />
                    </div>

                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-gray-800">Pools & Spas</h2>
                        {bodiesOfWater.map((body, index) => (
                            <div key={index} className="p-4 border rounded-lg space-y-4 relative">
                                <input type="text" placeholder="Pool or Spa Name (e.g., Main Pool)" value={body.name} onChange={(e) => handleBodyOfWaterChange(index, 'name', e.target.value)} className={formInputClasses} />
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input type="text" placeholder="Shape (e.g., Kidney, Rectangular)" value={body.shape} onChange={(e) => handleBodyOfWaterChange(index, 'shape', e.target.value)} className={formInputClasses} />
                                    <input type="text" placeholder="Material (e.g., Plaster, Vinyl)" value={body.material} onChange={(e) => handleBodyOfWaterChange(index, 'material', e.target.value)} className={formInputClasses} />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <input type="number" placeholder="Length (ft)" value={body.length} onChange={(e) => handleBodyOfWaterChange(index, 'length', e.target.value)} className={formInputClasses} />
                                    <input type="number" placeholder="Width (ft)" value={body.width} onChange={(e) => handleBodyOfWaterChange(index, 'width', e.target.value)} className={formInputClasses} />
                                    <input type="number" placeholder="Avg. Depth (ft)" value={body.depth} onChange={(e) => handleBodyOfWaterChange(index, 'depth', e.target.value)} className={formInputClasses} />
                                </div>

                                <input type="number" placeholder="Volume in Gallons" value={body.gallons} onChange={(e) => handleBodyOfWaterChange(index, 'gallons', e.target.value)} className={formInputClasses} />

                                <textarea placeholder="Notes (e.g., has a solar cover, dog access)" value={body.notes} onChange={(e) => handleBodyOfWaterChange(index, 'notes', e.target.value)} className={`${formInputClasses} h-24`}></textarea>

                                <div className="space-y-4 pl-4 border-l-2">
                                    <h3 className="text-lg font-semibold">Equipment</h3>
                                    {equipment[index]?.map((equip, equipIndex) => (
                                        <div key={equipIndex} className="p-3 border rounded-lg space-y-3">
                                            <div className="flex gap-4 items-center">
                                                <input
                                                    type="text"
                                                    placeholder="Equipment Name (e.g., Main Filter)"
                                                    value={equip.name}
                                                    onChange={(e) => handleEquipmentChange(index, equipIndex, 'name', e.target.value)}
                                                    className={`flex-grow ${formInputClasses}`}
                                                />
                                                <button type="button" onClick={() => removeEquipment(index, equipIndex)} className="p-2 text-red-500 hover:text-red-700"><TrashIcon className="w-5 h-5" /></button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <input type="text" placeholder="Category (e.g., Filter)" value={equip.category} onChange={(e) => handleEquipmentChange(index, equipIndex, 'category', e.target.value)} className={formInputClasses} />
                                                <input type="text" placeholder="Make (e.g., Pentair)" value={equip.make} onChange={(e) => handleEquipmentChange(index, equipIndex, 'make', e.target.value)} className={formInputClasses} />
                                                <input type="text" placeholder="Model (e.g., FNS Plus 60)" value={equip.model} onChange={(e) => handleEquipmentChange(index, equipIndex, 'model', e.target.value)} className={formInputClasses} />
                                                 <input type="text" placeholder="Date Installed" onFocus={(e) => e.target.type='date'} onBlur={(e) => e.target.type='text'} value={equip.dateInstalled} onChange={(e) => handleEquipmentChange(index, equipIndex, 'dateInstalled', e.target.value)} className={formInputClasses} />

                                            </div>
                                            <textarea placeholder="Notes" value={equip.notes} onChange={(e) => handleEquipmentChange(index, equipIndex, 'notes', e.target.value)} className={`${formInputClasses} h-20`}></textarea>
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => addEquipment(index)} className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800"><PlusIcon className="w-5 h-5" /> Add Equipment</button>
                                </div>
                                {bodiesOfWater.length > 1 && (
                                    <button type="button" onClick={() => removeBodyOfWater(index)} className="absolute top-2 right-2 p-1 text-red-500 hover:text-red-700"><TrashIcon className="w-5 h-5" /></button>
                                )}
                            </div>
                        ))}
                        <button type="button" onClick={addBodyOfWater} className="flex items-center gap-2 font-semibold text-blue-600 hover:text-blue-800"><PlusIcon className="w-5 h-5" /> Add Another Pool or Spa</button>
                    </div>

                    {error && <p className="text-red-500 text-center p-3 bg-red-50 rounded-md">{error}</p>}
                    <div className="flex justify-end pt-4">
                        <button type="submit" disabled={loading} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400">
                            {loading ? 'Saving...' : 'Save Location'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateServiceLocation;
