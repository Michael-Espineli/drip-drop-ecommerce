
import React, { useState, useContext, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, addDoc, doc, getDoc, query, where, getDocs, orderBy, setDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { Customer } from '../../../utils/models/Customer';
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';

const CreateNewEquipment = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { customerId: customerIdParam, locationId: locationIdParam, bodyOfWaterId: bodyOfWaterIdParam } = useParams();

    // Form State
    const [name, setName] = useState('');
    const [category, setCategory] = useState(null);
    const [customCategory, setCustomCategory] = useState('');
    const [make, setMake] = useState(null);
    const [customMake, setCustomMake] = useState('');
    const [model, setModel] = useState(null);
    const [customModel, setCustomModel] = useState('');
    const [dateInstalled, setDateInstalled] = useState(new Date().toISOString().split('T')[0]);
    const [cleanFilterPressure, setCleanFilterPressure] = useState('');
    const [serviceFrequency, setServiceFrequency] = useState('Months');
    const [serviceFrequencyEvery, setServiceFrequencyEvery] = useState(6);
    const [notes, setNotes] = useState('');

    // Relational Data State
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
    
    // Lists for Selects
    const [customers, setCustomers] = useState([]);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipmentTypes, setEquipmentTypes] = useState([]);
    const [equipmentMakes, setEquipmentMakes] = useState([]);
    const [equipmentModels, setEquipmentModels] = useState([]);

    // Fetch initial data for selects
    useEffect(() => {
        const fetchData = async () => {
            if (recentlySelectedCompany) {
                // Fetch customers if no specific customer is passed in params
                if (!customerIdParam) {
                    const custQuery = query(collection(db, 'companies', recentlySelectedCompany, 'customers'), orderBy("firstName"), where('active', '==', true));
                    const custSnapshot = await getDocs(custQuery);
                    const customerData = custSnapshot.docs.map(doc => ({ ...Customer.fromFirestore(doc), value: doc.id, label: `${doc.data().firstName} ${doc.data().lastName}` }));
                    setCustomers(customerData);
                }
            // Fetch all universal equipment types
            const typesQuery = query(collection(db, 'universal', 'equipment', 'equipmentTypes'));
                const typesSnapshot = await getDocs(typesQuery);
                setEquipmentTypes(typesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), value: doc.data().name, label: doc.data().name })));
            }
        };
        fetchData();
    }, [recentlySelectedCompany, customerIdParam]);

    // Handle param-based data loading
    useEffect(() => {
        const loadParamData = async () => {
            if (customerIdParam && recentlySelectedCompany) {
                const custRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customerIdParam);
                const custSnap = await getDoc(custRef);
                if (custSnap.exists()) setSelectedCustomer({ ...custSnap.data(), value: custSnap.id, label: `${custSnap.data().firstName} ${custSnap.data().lastName}` });
            }
            if (locationIdParam && recentlySelectedCompany) {
                const locRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', locationIdParam);
                const locSnap = await getDoc(locRef);
                if (locSnap.exists()) {
                    setSelectedLocation({ ...locSnap.data(), value: locSnap.id, label: locSnap.data().address.streetAddress });
                }
            }
            if (bodyOfWaterIdParam && recentlySelectedCompany) {
                const bowRef = doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWaterIdParam);
                const bowSnap = await getDoc(bowRef);
                if (bowSnap.exists()) setSelectedBodyOfWater({ ...bowSnap.data(), value: bowSnap.id, label: bowSnap.data().name });
            }
        };
        loadParamData();
    }, [customerIdParam, locationIdParam, bodyOfWaterIdParam, recentlySelectedCompany]);
    

    // Dependent dropdown logic
    useEffect(() => {
        if (selectedCustomer && recentlySelectedCompany && !locationIdParam) {
            const fetchLocations = async () => {
                const locQuery = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where('customerId', '==', selectedCustomer.value));
                const locSnapshot = await getDocs(locQuery);
                let list = locSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), value: doc.id, label: doc.data().address.streetAddress }))
                setServiceLocations(list);
                if (list.length>0) setSelectedLocation(list[0])
            };
            fetchLocations();
        }
    }, [selectedCustomer, recentlySelectedCompany, locationIdParam]);

    useEffect(() => {
        if (selectedLocation && recentlySelectedCompany && !bodyOfWaterIdParam) {
            const fetchBOWs = async () => {
                const bowQuery = query(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'), where('serviceLocationId', '==', selectedLocation.value));
                const bowSnapshot = await getDocs(bowQuery);
                let list = bowSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), value: doc.id, label: doc.data().name }))
                setBodiesOfWater(list);
                if (list.length>0) setSelectedBodyOfWater(list[0])

            };
            fetchBOWs();
        }
    }, [selectedLocation, recentlySelectedCompany, bodyOfWaterIdParam]);

    useEffect(() => {
        if (category && category.value !== 'Other') {
            const fetchMakes = async () => {
                const q = query(collection(db, 'universal', 'equipment', 'equipmentMakes'), where('types', 'array-contains', category.id));
                const snapshot = await getDocs(q);
                setEquipmentMakes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), value: doc.data().name, label: doc.data().name })));
            };
            fetchMakes();
        } else {
            setEquipmentMakes([]);
            setMake(null);
        }
    }, [category]);

    useEffect(() => {
        if (category && make && category.value !== 'Other' && make.value !== 'Other') {
            const fetchModels = async () => {
                const q = query(collection(db, 'universal', 'equipment', 'equipment'), where('typeId', '==', category.id), where('makeId', '==', make.id));
                const snapshot = await getDocs(q);
                setEquipmentModels(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), value: doc.data().model, label: doc.data().model })));
            };
            fetchModels();
        } else {
            setEquipmentModels([]);
            setModel(null);
        }
    }, [category, make]);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!recentlySelectedCompany || !selectedCustomer) {
            alert('A customer must be selected.');
            return;
        }

        try {
            const equipmentId = "com_equ_" + uuidv4()
            const newEquipment = {
                id:equipmentId,
                name,
                type: (category && category.value === 'Other') ? customCategory : (category && category.label) || '',
                typeId: (category && category.id) || '',
                make: (make && make.value === 'Other') ? customMake : (make && make.label) || '',
                makeId: (make && make.id) || '',
                model: (model && model.value === 'Other') ? customModel : (model && model.label) || '',
                modelId: (model && model.id) || '',
                dateInstalled: new Date(dateInstalled),
                cleanFilterPressure,
                serviceFrequency,
                serviceFrequencyEvery: Number(serviceFrequencyEvery),
                notes,
                customerId: selectedCustomer?.value || '',
                customerName: selectedCustomer?.label || '',
                serviceLocationId: selectedLocation?.value || '',
                bodyOfWaterId: selectedBodyOfWater?.value || '',
                lastServiceDate: null,
                nextServiceDate: null,
                active: true,
                needsService: false,
                status: 'Operational',
                currentPressure: ''
            };
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment',equipmentId), newEquipment);
            navigate('/company/equipment');
        } catch (error) {
            console.error("Error creating new equipment: ", error);
            alert("Failed to create equipment. Please check the console for details.");
        }
    }; 
    
    const selectStyles = {
        control: (provided) => ({ ...provided, backgroundColor: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', padding: '0.3rem' }),
        menu: (provided) => ({ ...provided, zIndex: 20 }),
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-bold text-gray-800">Create New Equipment</h2>
                    <Link to={'/company/equipment'} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition'>
                        Cancel
                    </Link>
                </div>

                <form onSubmit={handleCreate} className="bg-white shadow-lg rounded-xl p-6 space-y-6">
                    {/* Section 1: Customer and Location */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-b pb-6">
                        <h3 className="text-lg font-semibold text-gray-700 md:col-span-3">Owner Details</h3>
                        <Select
                            value={selectedCustomer}
                            options={customers}
                            onChange={setSelectedCustomer}
                            placeholder="Select a Customer..."
                            styles={selectStyles}
                            isDisabled={!!customerIdParam}
                        />
                        <Select
                            value={selectedLocation}
                            options={serviceLocations}
                            onChange={setSelectedLocation}
                            placeholder="Select a Service Location..."
                            styles={selectStyles}
                            isDisabled={!selectedCustomer || !!locationIdParam}
                        />
                        <Select
                            value={selectedBodyOfWater}
                            options={bodiesOfWater}
                            onChange={setSelectedBodyOfWater}
                            placeholder="Select a Body of Water..."
                            styles={selectStyles}
                            isDisabled={!selectedLocation || !!bodyOfWaterIdParam}
                        />
                    </div>

                    {/* Section 2: Equipment Details */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-b pb-6">
                        <h3 className="text-lg font-semibold text-gray-700 md:col-span-3">Equipment Specifications</h3>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <Select options={[...equipmentTypes, { value: 'Other', label: 'Other' }]} value={category} onChange={setCategory} styles={selectStyles} placeholder="Select Category..." />
                            {category?.value === 'Other' && <input type="text" value={customCategory} onChange={e => setCustomCategory(e.target.value)} className="mt-2 w-full p-2 border border-gray-300 rounded-lg" placeholder="Custom Category Name" />} 
                        </div>
                        <div>
                             <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                             <Select options={[...equipmentMakes, { value: 'Other', label: 'Other' }]} value={make} onChange={setMake} styles={selectStyles} placeholder="Select Make..." isDisabled={!category} />
                             {make?.value === 'Other' && <input type="text" value={customMake} onChange={e => setCustomMake(e.target.value)} className="mt-2 w-full p-2 border border-gray-300 rounded-lg" placeholder="Custom Make Name" />} 
                        </div>
                        <div>
                             <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                             <Select options={[...equipmentModels, { value: 'Other', label: 'Other' }]} value={model} onChange={setModel} styles={selectStyles} placeholder="Select Model..." isDisabled={!make} />
                             {model?.value === 'Other' && <input type="text" value={customModel} onChange={e => setCustomModel(e.target.value)} className="mt-2 w-full p-2 border border-gray-300 rounded-lg" placeholder="Custom Model Name" />} 
                        </div>
                    </div>

                     {/* Section 3: Additional Info */}
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <h3 className="text-lg font-semibold text-gray-700 md:col-span-3">Service & Installation</h3>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Equipment Nickname</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" placeholder="e.g., Main Pool Pump" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Date Installed</label>
                            <input type="date" value={dateInstalled} onChange={e => setDateInstalled(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Clean Filter Pressure (PSI)</label>
                            <input type="text" value={cleanFilterPressure} onChange={e => setCleanFilterPressure(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" placeholder="e.g., 25"/>
                        </div>
                        <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Service Frequency</label>
                            <div className='flex gap-4'>
                                <input type="number" value={serviceFrequencyEvery} onChange={e => setServiceFrequencyEvery(e.target.value)} className="w-1/3 p-2 border border-gray-300 rounded-lg" />
                                <select value={serviceFrequency} onChange={e => setServiceFrequency(e.target.value)} className="w-2/3 p-2 border border-gray-300 rounded-lg bg-white">
                                    <option>Days</option>
                                    <option>Weeks</option>
                                    <option>Months</option>
                                    <option>Years</option>
                                </select>
                            </div>
                        </div>
                        <div className='md:col-span-3'>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" rows="4" placeholder="Add any relevant notes here..."></textarea>
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <button type="submit" className="py-2 px-6 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition">
                            Create Equipment
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateNewEquipment;
