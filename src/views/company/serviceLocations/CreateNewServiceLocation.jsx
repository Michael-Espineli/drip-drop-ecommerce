import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, query, where, getDocs, setDoc, doc, getDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { toast } from 'react-hot-toast';

const InfoSection = ({ title, children }) => (
    <div className="border-b border-gray-200 pb-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
        <div className="space-y-4">{children}</div>
    </div>
);

const FormInput = ({ label, name, value, onChange, required = false, type = 'text' }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <input type={type} name={name} value={value} onChange={onChange} required={required} className="w-full mt-1 p-2 border border-gray-300 rounded-lg" />
    </div>
);

const FormTextarea = ({ label, name, value, onChange }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <textarea name={name} value={value} onChange={onChange} rows="3" className="w-full mt-1 p-2 border border-gray-300 rounded-lg"></textarea>
    </div>
);

const FormSelect = ({ label, name, value, onChange, children }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <select name={name} value={value} onChange={onChange} className="w-full mt-1 p-2 border border-gray-300 rounded-lg">
            {children}
        </select>
    </div>
);

const CreateNewServiceLocation = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');

    // Form state based on the new model
    const [address, setAddress] = useState({ streetAddress: '', city: '', state: '', zip: '', latitude: null, longitude: null });
    const [details, setDetails] = useState({
        nickName: 'Main',
        gateCode: '',
        estimatedTime: 15,
        notes: '',
        preText: false,
        verified: false,
        photoUrls: [] // For photo uploads in the future
    });
    const [dogNames, setDogNames] = useState(''); // Simplified to a single string for now
    const [mainContact, setMainContact] = useState({ id: "com_cus_con_"+uuidv4(), name: '', email: '', phoneNumber: '', notes: '' });
    
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipment, setEquipment] = useState([]);

    const [equipmentTypes, setEquipmentTypes] = useState([]);
    const [equipmentMakes, setEquipmentMakes] = useState([]);
    const [equipmentModels, setEquipmentModels] = useState([]);

    // Fetch customers for the dropdown
    useEffect(() => {
        const fetchCustomers = async () => {
            if (!recentlySelectedCompany) return;
            const q = query(collection(db, 'companies', recentlySelectedCompany, 'customers'));
            const snap = await getDocs(q);
            setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        };
        fetchCustomers();
    }, [recentlySelectedCompany]);

    // Fetch universal equipment types
    useEffect(() => {
        const fetchEquipmentTypes = async () => {
            const q = query(collection(db, 'universal', 'equipment', 'equipmentTypes'));
            const snap = await getDocs(q);
            setEquipmentTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        };
        fetchEquipmentTypes();
    }, []);

    const handleStateChange = (setter, name, value) => setter(prev => ({ ...prev, [name]: value }));

    const handlePlaceSelected = (place) => {
        if (!place) return;
        setAddress({ 
            streetAddress: place.streetAddress, city: place.city, state: place.state, zip: place.zipCode, 
            latitude: place.latitude, longitude: place.longitude 
        });
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!recentlySelectedCompany || !selectedCustomer) {
            toast.error('Please select a customer.');
            return;
        }

        const toastId = toast.loading('Creating service location...');
        try {
            const serviceLocationId = 'com_sl_' + uuidv4();
            const customerData = customers.find(c => c.id === selectedCustomer);

            // Process bodies of water and equipment
            const bodiesOfWaterIds = [];
            for (const bow of bodiesOfWater) {
                const bowId = 'com_bow_' + uuidv4();
                bodiesOfWaterIds.push(bowId);
                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bowId), {
                    ...bow, id: bowId, customerId: selectedCustomer, serviceLocationId
                });
            }

            for (const eq of equipment) {
                if (eq.name) {
                     const equipmentId = 'com_equ_' + uuidv4();
                     await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), {
                         ...eq, id: equipmentId, customerId: selectedCustomer, serviceLocationId, bodyOfWaterId: bodiesOfWaterIds[0] || '' // Link to first BOW for now
                     });
                }
            }

            // Create Service Location
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId), {
                id: serviceLocationId,
                nickName: details.nickName,
                address,
                gateCode: details.gateCode,
                dogName: dogNames.split(',').map(s => s.trim()),
                estimatedTime: details.estimatedTime,
                mainContact,
                notes: details.notes,
                bodiesOfWaterId: bodiesOfWaterIds,
                customerId: selectedCustomer,
                customerName: customerData.displayAsCompany ? customerData.company : `${customerData.firstName} ${customerData.lastName}`,
                backYardTree: [], // Default empty arrays
                backYardBushes: [],
                backYardOther: [],
                preText: details.preText,
                verified: details.verified,
                photoUrls: details.photoUrls,
            });

            toast.success('Service location created successfully!', { id: toastId });
            navigate('/company/service-locations');

        } catch (error) {
            toast.error('Error creating service location.', { id: toastId });
            console.error("Error: ", error);
        }
    };

    // Functions to add new body of water or equipment item
    const addBodyOfWater = () => {
        setBodiesOfWater([...bodiesOfWater, { id: uuidv4(), name: 'New Pool', gallons: '15000', waterType: 'Chlorine', material: 'Plaster', notes: '', shape: '' }]);
    };

    const addEquipment = () => {
        setEquipment([...equipment, { id: uuidv4(), name: '', category: '', make: '', model: '', notes: '', needsService: false }]);
    };
    const inputClasses = "w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm";

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <h1 className='text-3xl font-bold text-gray-900 mb-6'>Create New Service Location</h1>
                <form onSubmit={handleCreate} className="bg-white p-8 rounded-2xl shadow-lg space-y-8">
                    
                    <InfoSection title="Basic Information">
                        <FormSelect label="Customer" value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} required>
                            <option value="">Select a Customer</option>
                            {customers.map(c => <option key={c.id} value={c.id}>{c.displayAsCompany ? c.company : `${c.firstName} ${c.lastName}`}</option>)}
                        </FormSelect>
                        <AddressAutocomplete onAddressSelect={handlePlaceSelected} customClasses={inputClasses}/>
                        <FormInput label="Location Nickname" name="nickName" value={details.nickName} onChange={e => handleStateChange(setDetails, 'nickName', e.target.value)} required />
                    </InfoSection>

                    <InfoSection title="Access Details">
                        <div class='grid md:grid-cols-2 gap-4'>
                            <FormInput label="Gate Code" name="gateCode" value={details.gateCode} onChange={e => handleStateChange(setDetails, 'gateCode', e.target.value)} />
                            <FormInput label="Dog Names (comma-separated)" name="dogNames" value={dogNames} onChange={e => setDogNames(e.target.value)} />
                        </div>
                        <FormTextarea label="General Notes" name="notes" value={details.notes} onChange={e => handleStateChange(setDetails, 'notes', e.target.value)} />
                    </InfoSection>

                    <InfoSection title="Main Contact">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                            <FormInput label="Name" name="name" value={mainContact.name} onChange={(e) => handleStateChange(setMainContact, 'name', e.target.value)} />
                            <FormInput label="Email" name="email" value={mainContact.email} onChange={(e) => handleStateChange(setMainContact, 'email', e.target.value)} />
                            <FormInput label="Phone" name="phoneNumber" value={mainContact.phoneNumber} onChange={(e) => handleStateChange(setMainContact, 'phoneNumber', e.target.value)} />
                            <div className="md:col-span-2">
                                <FormTextarea label="Notes" name="notes" value={mainContact.notes} onChange={(e) => handleStateChange(setMainContact, 'notes', e.target.value)} />
                            </div>
                        </div>
                    </InfoSection>

                    <InfoSection title="Settings">
                        <FormInput label="Estimated Time (minutes)" name="estimatedTime" type="number" value={details.estimatedTime} onChange={e => handleStateChange(setDetails, 'estimatedTime', e.target.value)} required />
                        <label className="flex items-center"><input type="checkbox" name="preText" checked={details.preText} onChange={e => handleStateChange(setDetails, 'preText', e.target.checked)} className="mr-2 h-4 w-4"/> Send Pre-Service Text Message</label>
                        <label className="flex items-center"><input type="checkbox" name="verified" checked={details.verified} onChange={e => handleStateChange(setDetails, 'verified', e.target.checked)} className="mr-2 h-4 w-4"/> Location Verified</label>
                    </InfoSection>

                    <InfoSection title="Bodies of Water">
                        {bodiesOfWater.map((bow, index) => (
                            <div key={bow.id} className="p-4 border rounded-lg mt-4 space-y-3 bg-gray-50">
                                {/* Inputs for body of water properties */}
                                <FormInput label="Name" value={bow.name} onChange={e => { const next = [...bodiesOfWater]; next[index].name = e.target.value; setBodiesOfWater(next); }} />
                            </div>
                        ))}
                        <button type="button" onClick={addBodyOfWater} className="mt-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg shadow-sm hover:bg-green-700">+ Add Body of Water</button>
                    </InfoSection>

                    <InfoSection title="Equipment">
                        {equipment.map((eq, index) => (
                            <div key={eq.id} className="p-4 border rounded-lg mt-4 space-y-3 bg-gray-50">
                                <FormInput label="Name" value={eq.name} onChange={e => { const next = [...equipment]; next[index].name = e.target.value; setEquipment(next); }} />
                                {/* Inputs for other equipment properties */}
                            </div>
                        ))}
                        <button type="button" onClick={addEquipment} className="mt-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg shadow-sm hover:bg-green-700">+ Add Equipment</button>
                    </InfoSection>

                    <div className="flex justify-end gap-4 pt-4">
                        <button type="button" onClick={() => navigate('/company/service-locations')} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700">Create Service Location</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateNewServiceLocation;
