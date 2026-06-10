import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { writeBatch, doc } from 'firebase/firestore';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { v4 as uuidv4 } from 'uuid';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { BodyOfWaterHO } from '../../../utils/models/BodyOfWaterHO';
import { EquipmentHO } from '../../../utils/models/EquipmentHO';
import { ServiceLocationHO } from '../../../utils/models/ServiceLocationHO';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import EquipmentCatalogPicker from '../../components/equipment/EquipmentCatalogPicker';

const BODY_OF_WATER_MATERIAL_OPTIONS = ['Plaster', 'Fiber Glass', 'Vinyl', 'Pebble', 'Tile'];
const BODY_OF_WATER_SHAPE_OPTIONS = ['Square', 'Rectangle', 'Circle', 'Roman'];
const EQUIPMENT_FREQUENCY_OPTIONS = ['Day', 'Week', 'Month', 'Year'];
const EQUIPMENT_STATUS_OPTIONS = [
    { value: 'Operational', label: 'Operational' },
    { value: 'Nonoperational', label: 'Non-Operational' },
    { value: 'Needs Repair', label: 'Needs Repair' },
    { value: 'Needs Maintenance', label: 'Needs Maintenance' },
    { value: 'Replaced', label: 'Replaced' },
];

const createDefaultBodyOfWater = (name = 'Main') => new BodyOfWaterHO({
    name,
    gallons: '',
    material: '',
    notes: '',
    shape: '',
    length: '',
    depth: '',
    width: '',
    isActive: true,
});

const createBlankHomeownerEquipment = (overrides = {}) => new EquipmentHO({
    name: '',
    category: '',
    make: '',
    model: '',
    notes: '',
    dateInstalled: null,
    needsService: false,
    serviceFrequency: '',
    serviceFrequencyEvery: '',
    status: 'Operational',
    isActive: true,
    ...overrides,
});

const createDefaultHomeownerEquipment = () => ([
    createBlankHomeownerEquipment({
        name: 'Pump 1',
        category: 'Pump',
    }),
    createBlankHomeownerEquipment({
        name: 'Filter 1',
        category: 'Filter',
        needsService: true,
        serviceFrequency: 6,
        serviceFrequencyEvery: 'Month',
    }),
]);

const renderOptions = (options, placeholder) => (
    <>
        <option value="">{placeholder}</option>
        {options.map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return <option key={value} value={value}>{label}</option>;
        })}
    </>
);

const getDateInputValue = (value) => (typeof value === 'string' ? value : '');

const HomeownerServiceLocationForm = ({ title = 'Add New Pool Service Location' }) => {
    const { user } = useContext(Context);
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [serviceLocation] = useState(new ServiceLocationHO());
    const [bodiesOfWater, setBodiesOfWater] = useState([createDefaultBodyOfWater()]);
    const [equipment, setEquipment] = useState([createDefaultHomeownerEquipment()]);
    const [formData, setFormData] = useState({
        streetAddress: '',
        city: '',
        state: '',
        zip: '',
        latitude: null,
        longitude: null,
    });

    const handleAddressSelect = (address) => {
        setFormData((prev) => ({
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
        setBodiesOfWater([...bodiesOfWater, createDefaultBodyOfWater(`Body ${bodiesOfWater.length + 1}`)]);
        setEquipment([...equipment, createDefaultHomeownerEquipment()]);
    };

    const removeBodyOfWater = (index) => {
        if (bodiesOfWater.length <= 1) return;
        setBodiesOfWater(bodiesOfWater.filter((_, i) => i !== index));
        setEquipment(equipment.filter((_, i) => i !== index));
    };

    const handleEquipmentChange = (bodyIndex, equipIndex, field, value) => {
        const newEquipment = [...equipment];
        const updatedEquip = { ...newEquipment[bodyIndex][equipIndex], [field]: value };
        newEquipment[bodyIndex][equipIndex] = new EquipmentHO(updatedEquip);
        setEquipment(newEquipment);
    };

    const handleEquipmentCatalogChange = (bodyIndex, equipIndex, nextCatalogEquipment) => {
        const newEquipment = [...equipment];
        newEquipment[bodyIndex][equipIndex] = new EquipmentHO(nextCatalogEquipment);
        setEquipment(newEquipment);
    };

    const addEquipment = (bodyIndex) => {
        const newEquipment = [...equipment];
        newEquipment[bodyIndex] = [...newEquipment[bodyIndex], createBlankHomeownerEquipment()];
        setEquipment(newEquipment);
    };

    const removeEquipment = (bodyIndex, equipIndex) => {
        const newEquipment = [...equipment];
        newEquipment[bodyIndex] = newEquipment[bodyIndex].filter((_, i) => i !== equipIndex);
        setEquipment(newEquipment);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.streetAddress) {
            setError('Please enter a service address.');
            return;
        }
        setLoading(true);
        setError(null);

        try {
            const batch = writeBatch(db);
            const serviceLocationId = 'hosl_' + uuidv4();
            const serviceLocationRef = doc(db, 'homeownerServiceLocations', serviceLocationId);
            batch.set(serviceLocationRef, {
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
            });

            for (let i = 0; i < bodiesOfWater.length; i++) {
                const bodyOfWaterId = 'hobow_' + uuidv4();
                const bodyOfWaterRef = doc(db, 'homeownerBodiesOfWater', bodyOfWaterId);
                batch.set(bodyOfWaterRef, {
                    ...bodiesOfWater[i].toFirestore(),
                    id: bodyOfWaterId,
                    serviceLocationId,
                    userId: user.uid,
                    createdAt: new Date(),
                });

                if (equipment[i]) {
                    for (const equip of equipment[i]) {
                        const equipmentId = 'hoe_' + uuidv4();
                        const equipmentRef = doc(db, 'homeownerEquipment', equipmentId);
                        batch.set(equipmentRef, {
                            ...equip.toFirestore(),
                            id: equipmentId,
                            bodyOfWaterId,
                            serviceLocationId,
                            userId: user.uid,
                            createdAt: new Date(),
                        });
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

    const inputClasses = 'w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm';
    const formInputClasses = 'w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
    const labelClasses = 'block text-xs font-semibold uppercase text-gray-500 mb-1';

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button type="button" onClick={() => navigate(-1)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
                </div>

                <form onSubmit={handleSave} className="space-y-8 bg-white rounded-lg shadow-md p-6 md:p-8">
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-800">Service Location</h2>
                        <AddressAutocomplete onAddressSelect={handleAddressSelect} placeholder="Enter service address" customClasses={inputClasses} />
                    </div>

                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-gray-800">Pools & Spas</h2>
                        {bodiesOfWater.map((body, index) => (
                            <section key={index} className="p-4 border rounded-lg space-y-4 relative">
                                <div>
                                    <label className={labelClasses}>Name</label>
                                    <input
                                        type="text"
                                        placeholder="Main"
                                        value={body.name || ''}
                                        onChange={(e) => handleBodyOfWaterChange(index, 'name', e.target.value)}
                                        className={formInputClasses}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className={labelClasses}>Material</label>
                                        <select value={body.material || ''} onChange={(e) => handleBodyOfWaterChange(index, 'material', e.target.value)} className={formInputClasses}>
                                            {renderOptions(BODY_OF_WATER_MATERIAL_OPTIONS, 'Select material')}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Shape</label>
                                        <select value={body.shape || ''} onChange={(e) => handleBodyOfWaterChange(index, 'shape', e.target.value)} className={formInputClasses}>
                                            {renderOptions(BODY_OF_WATER_SHAPE_OPTIONS, 'Select shape')}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Gallons</label>
                                        <input
                                            type="number"
                                            placeholder="Leave blank if unknown"
                                            value={body.gallons || ''}
                                            onChange={(e) => handleBodyOfWaterChange(index, 'gallons', e.target.value)}
                                            className={formInputClasses}
                                        />
                                    </div>
                                </div>

                                <details className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                                    <summary className="cursor-pointer text-sm font-semibold text-gray-700">Optional pool details</summary>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                                        <input type="number" placeholder="Length (ft)" value={body.length || ''} onChange={(e) => handleBodyOfWaterChange(index, 'length', e.target.value)} className={formInputClasses} />
                                        <input type="number" placeholder="Width (ft)" value={body.width || ''} onChange={(e) => handleBodyOfWaterChange(index, 'width', e.target.value)} className={formInputClasses} />
                                        <input type="number" placeholder="Avg. Depth (ft)" value={body.depth || ''} onChange={(e) => handleBodyOfWaterChange(index, 'depth', e.target.value)} className={formInputClasses} />
                                    </div>
                                    <textarea
                                        placeholder="Notes"
                                        value={body.notes || ''}
                                        onChange={(e) => handleBodyOfWaterChange(index, 'notes', e.target.value)}
                                        className={`${formInputClasses} h-24 mt-4`}
                                    />
                                </details>

                                <div className="space-y-4 pl-4 border-l-2">
                                    <h3 className="text-lg font-semibold">Equipment</h3>
                                    {equipment[index]?.map((equip, equipIndex) => (
                                        <div key={equipIndex} className="p-3 border rounded-lg space-y-3 bg-white">
                                            <div className="flex gap-4 items-start">
                                                <div className="flex-grow">
                                                    <label className={labelClasses}>Name</label>
                                                    <input
                                                        type="text"
                                                        placeholder="Equipment name"
                                                        value={equip.name || ''}
                                                        onChange={(e) => handleEquipmentChange(index, equipIndex, 'name', e.target.value)}
                                                        className={formInputClasses}
                                                    />
                                                </div>
                                                <button type="button" onClick={() => removeEquipment(index, equipIndex)} className="p-2 mt-5 text-red-500 hover:text-red-700">
                                                    <TrashIcon className="w-5 h-5" />
                                                </button>
                                            </div>

                                            <EquipmentCatalogPicker
                                                value={equip}
                                                onChange={(nextCatalogEquipment) => handleEquipmentCatalogChange(index, equipIndex, nextCatalogEquipment)}
                                                onModelSelected={(selectedModel) => {
                                                    if (!equip.name?.trim()) {
                                                        handleEquipmentCatalogChange(index, equipIndex, new EquipmentHO({
                                                            ...equip,
                                                            model: selectedModel.model || selectedModel.name || '',
                                                            modelId: selectedModel.id || '',
                                                            universalEquipmentId: selectedModel.id || '',
                                                            manualPdfLink: selectedModel.manualPdfLink || '',
                                                            name: selectedModel.name || selectedModel.model || '',
                                                        }));
                                                    }
                                                }}
                                                gridClassName="grid grid-cols-1 gap-4 md:grid-cols-3"
                                            />

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className={labelClasses}>Status</label>
                                                    <select value={equip.status || ''} onChange={(e) => handleEquipmentChange(index, equipIndex, 'status', e.target.value)} className={formInputClasses}>
                                                        {renderOptions(EQUIPMENT_STATUS_OPTIONS, 'Select status')}
                                                    </select>
                                                </div>
                                            </div>

                                            <label className="flex items-center gap-3 text-sm font-semibold text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(equip.needsService)}
                                                    onChange={(e) => handleEquipmentChange(index, equipIndex, 'needsService', e.target.checked)}
                                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                Needs regular service
                                            </label>

                                            {equip.needsService && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className={labelClasses}>Every</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            placeholder="6"
                                                            value={equip.serviceFrequency ?? ''}
                                                            onChange={(e) => handleEquipmentChange(index, equipIndex, 'serviceFrequency', e.target.value)}
                                                            className={formInputClasses}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={labelClasses}>Unit</label>
                                                        <select value={equip.serviceFrequencyEvery || ''} onChange={(e) => handleEquipmentChange(index, equipIndex, 'serviceFrequencyEvery', e.target.value)} className={formInputClasses}>
                                                            {renderOptions(EQUIPMENT_FREQUENCY_OPTIONS, 'Select unit')}
                                                        </select>
                                                    </div>
                                                </div>
                                            )}

                                            <details className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                                                <summary className="cursor-pointer text-sm font-semibold text-gray-700">Optional equipment details</summary>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                                                    <input type="date" value={getDateInputValue(equip.dateInstalled)} onChange={(e) => handleEquipmentChange(index, equipIndex, 'dateInstalled', e.target.value)} className={formInputClasses} />
                                                </div>
                                                <textarea
                                                    placeholder="Notes"
                                                    value={equip.notes || ''}
                                                    onChange={(e) => handleEquipmentChange(index, equipIndex, 'notes', e.target.value)}
                                                    className={`${formInputClasses} h-20 mt-4`}
                                                />
                                            </details>
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => addEquipment(index)} className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800">
                                        <PlusIcon className="w-5 h-5" /> Add Equipment
                                    </button>
                                </div>

                                {bodiesOfWater.length > 1 && (
                                    <button type="button" onClick={() => removeBodyOfWater(index)} className="absolute top-2 right-2 p-1 text-red-500 hover:text-red-700">
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                )}
                            </section>
                        ))}
                        <button type="button" onClick={addBodyOfWater} className="flex items-center gap-2 font-semibold text-blue-600 hover:text-blue-800">
                            <PlusIcon className="w-5 h-5" /> Add Another Pool or Spa
                        </button>
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

export default HomeownerServiceLocationForm;
