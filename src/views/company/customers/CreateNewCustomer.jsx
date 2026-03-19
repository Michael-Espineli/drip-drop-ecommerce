import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, query, where, getDocs, setDoc, doc, getDoc, getCountFromServer } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import MapComponent from '../../components/MapComponent';
import UpgradeModal from '../../components/modals/UpgradeModal';
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

const CreateNewCustomer = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);

    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    // Form state
    const [displayAsCompany, setDisplayAsCompany] = useState(false);
    const [useDifferentBillingAddress, setUseDifferentBillingAddress] = useState(false);
    
    const [formData, setFormData] = useState({ firstName: '', lastName: '', company: '', email: '', phoneNumber: '', billingNotes: '' });
    const [serviceAddress, setServiceAddress] = useState({ streetAddress: '', city: '', state: '', zip: '', latitude: null, longitude: null });
    const [billingAddress, setBillingAddress] = useState({ streetAddress: '', city: '', state: '', zip: '', latitude: null, longitude: null });
    const [serviceLocationDetails, setServiceLocationDetails] = useState({ gateCode: '', notes: '', preText: false, estimatedTime:15,nickName:"Main", verified:false, rateType:"", laborType:"", chemicalCost:"", laborCost:"", rate:"", 
        photoUrls:[]  });
    const [mainContact, setMainContact] = useState({ id: "com_cus_con_"+uuidv4() ,name: '', email: '', phoneNumber: '', notes: '' });
    const [dogName, setDogName] = useState("");

    const [bodyOfWater, setBodyOfWater] = useState({ name: 'Main', gallons: '16000', waterType: 'Chlorine', material: 'Plaster', notes: '', shape: '' });
    const [equipment, setEquipment] = useState([
        { name: 'Pump', category: 'Pump', typeId: 'qr1d9eefis1VNdIyX6Xq', make: '', makeId: '', model: '', modelId: '', notes: '', needsService: false, customCategory: '', customMake: '', customModel: '' },
        { name: 'Filter', category: 'Filter', typeId: 'BYpNgrzHyVjIMQFAiFyO', make: '', makeId: '', model: '', modelId: '', notes: '', needsService: true, customCategory: '', customMake: '', customModel: '' }
    ]);
    
    const [equipmentTypes, setEquipmentTypes] = useState([]);
    const [equipmentMakes, setEquipmentMakes] = useState([[], []]);
    const [equipmentModels, setEquipmentModels] = useState([[], []]);

    // Generic handler for simple state updates
    const handleStateChange = (setter, name, value) => setter(prev => ({ ...prev, [name]: value }));

    // Fetch universal equipment types
    useEffect(() => {
        const fetchEquipmentTypes = async () => {
            const q = query(collection(db, 'universal', 'equipment', 'equipmentTypes'));
            const snap = await getDocs(q);
            setEquipmentTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        };
        fetchEquipmentTypes();
    }, []);

    const fetchMakesAndModels = async (category, make, index) => {
        // Fetch Makes
        if (category && category !== 'Other') {
            const type = equipmentTypes.find(t => t.name === category);
            if (type) {
                const makesQuery = query(collection(db, 'universal', 'equipment', 'equipmentMakes'), where('types', 'array-contains', type.id));
                const makesSnap = await getDocs(makesQuery);
                const makesList = makesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setEquipmentMakes(prev => { const next = [...prev]; next[index] = makesList; return next; });

                // Fetch Models
                if (make && make !== 'Other') {
                    const makeData = makesList.find(m => m.name === make);
                    if (makeData) {
                        const modelsQuery = query(collection(db, 'universal', 'equipment', 'equipment'), where('typeId', '==', type.id), where('makeId', '==', makeData.id));
                        const modelsSnap = await getDocs(modelsQuery);
                        const modelsList = modelsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        setEquipmentModels(prev => { const next = [...prev]; next[index] = modelsList; return next; });
                    }
                }
            }
        } else {
             setEquipmentMakes(prev => { const next = [...prev]; next[index] = []; return next; });
             setEquipmentModels(prev => { const next = [...prev]; next[index] = []; return next; });
        }
    };

    useEffect(() => { fetchMakesAndModels(equipment[0].category, equipment[0].make, 0); }, [equipment[0].category, equipment[0].make, equipmentTypes]);
    useEffect(() => { fetchMakesAndModels(equipment[1].category, equipment[1].make, 1); }, [equipment[1].category, equipment[1].make, equipmentTypes]);

    const handleEquipmentChange = (index, field, value) => {
        setEquipment(prev => {
            const next = [...prev];
            let item = { ...next[index], [field]: value };

            if (field === 'category') {
                item.make = ''; item.model = ''; item.customCategory = '';
                if (value === 'Other') { item.make = 'Other'; item.model = 'Other'; }
            }
            if (field === 'make') { item.model = ''; item.customMake = ''; }
            if (field === 'model') { item.customModel = ''; }

            next[index] = item;
            return next;
        });
    };
    
    const handlePlaceSelected = (place, type) => {
        if (!place) return;
        const address = { 
            streetAddress: place.streetAddress, city: place.city, state: place.state, zip: place.zipCode, 
            latitude: place.latitude, longitude: place.longitude 
        };
        if (type === 'billing') setBillingAddress(address);
        else setServiceAddress(address);
    };

    const useCustomerAsMainContact = () => {
        setMainContact({
            name: displayAsCompany ? formData.company : `${formData.firstName} ${formData.lastName}`,
            email: formData.email,
            phoneNumber: formData.phoneNumber,
            notes: mainContact.notes
        });
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!recentlySelectedCompany) return;

        const toastId = toast.loading('Creating customer...');
        try {
            const customerId = 'com_cus_' + uuidv4();
            const serviceLocationId = 'com_sl_' + uuidv4();
            const bodyOfWaterId = 'com_bow_' + uuidv4();

            const finalBillingAddress = useDifferentBillingAddress ? billingAddress : serviceAddress;

            // 1. Create Customer
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', customerId), {
                id: customerId, ...formData, 
                displayAsCompany, 
                active: true, 
                billingAddress: finalBillingAddress, 
                linkedCustomerIds: [],
                linkedInviteId: "",
                hireDate: new Date(),
                phoneLabel:""
            });

            // 2. Create Service Location
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId), {
                id: serviceLocationId, 
                customerId, 
                address: serviceAddress, 
                mainContact, ...serviceLocationDetails, 
                bodiesOfWaterId: [bodyOfWaterId],
                dogName:[dogName]
            });

            // 3. Create Body of Water
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWaterId), {
                id: bodyOfWaterId, ...bodyOfWater, customerId, serviceLocationId
            });

            // 4. Create Equipment
            for (const eq of equipment) {
                if (eq.name) {
                    const equipmentId = 'com_equ_' + uuidv4();
                    const finalCategory = eq.category === 'Other' ? eq.customCategory : eq.category;
                    const finalMake = eq.make === 'Other' ? eq.customMake : eq.make;
                    const finalModel = eq.model === 'Other' ? eq.customModel : eq.model;

                    await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), { 
                        id: equipmentId, name: eq.name, notes: eq.notes, needsService: eq.needsService,
                        type: finalCategory, 
                        typeId: "",
                        make: finalMake, 
                        makeId: "",
                        model: finalModel,
                        modelId: "",
                        customerId, 
                        serviceLocationId, 
                        bodyOfWaterId, 
                        customerName: displayAsCompany ? formData.company : `${formData.firstName} ${formData.lastName}`,
                        dateInstalled: new Date(), active: true, status: 'Operational'
                    });
                }
            }
            
            toast.success('Customer created successfully!', { id: toastId });
            navigate('/company/customers');
        } catch (error) {
            toast.error('Error creating customer.', { id: toastId });
            console.error("Error: ", error);
        }
    };
    const inputClasses = "w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm";

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <UpgradeModal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} featureName="Active Customers" />
                <h1 className='text-3xl font-bold text-gray-900 mb-6'>Create New Customer</h1>
                <form onSubmit={handleCreate} className="bg-white p-8 rounded-2xl shadow-lg space-y-8">
                    
                    <InfoSection title="Customer Details">
                        <div className="flex justify-end">
                            <label className="flex items-center"><input type="checkbox" checked={displayAsCompany} onChange={(e) => setDisplayAsCompany(e.target.checked)} className="mr-2 h-4 w-4"/>Display as Company</label>
                        </div>
                        {displayAsCompany ? (
                           <FormInput label="Company Name" name="company" value={formData.company} onChange={e => handleStateChange(setFormData, 'company', e.target.value)} required />
                        ) : (
                            <div className='grid md:grid-cols-2 gap-4'>
                                <FormInput label="First Name" name="firstName" value={formData.firstName} onChange={e => handleStateChange(setFormData, 'firstName', e.target.value)} required />
                                <FormInput label="Last Name" name="lastName" value={formData.lastName} onChange={e => handleStateChange(setFormData, 'lastName', e.target.value)} required />
                            </div>
                        )}
                         <div className='grid md:grid-cols-2 gap-4'>
                            <FormInput label="Email" name="email" type="email" value={formData.email} onChange={e => handleStateChange(setFormData, 'email', e.target.value)} />
                            <FormInput label="Phone" name="phoneNumber" type="tel" value={formData.phoneNumber} onChange={e => handleStateChange(setFormData, 'phoneNumber', e.target.value)} />
                        </div>
                        <FormTextarea label="Billing Notes" name="billingNotes" value={formData.billingNotes} onChange={e => handleStateChange(setFormData, 'billingNotes', e.target.value)} />
                    </InfoSection>

                    <InfoSection title="Service Location">
                         <label className="flex items-center mb-4"><input type="checkbox" checked={useDifferentBillingAddress} onChange={(e) => setUseDifferentBillingAddress(e.target.checked)} className="mr-2"/>Use different billing address</label>
                         <AddressAutocomplete onAddressSelect={(p) => handlePlaceSelected(p, 'service')} customClasses={inputClasses} />
                         <FormInput label="Nick Name" name="nickName" value={serviceLocationDetails.nickName} onChange={e => handleStateChange(setServiceLocationDetails, 'nickName', e.target.value)} />

                         <div className='grid md:grid-cols-2 gap-4'>
                            <FormInput label="Gate Code" name="gateCode" value={serviceLocationDetails.gateCode} onChange={e => handleStateChange(setServiceLocationDetails, 'gateCode', e.target.value)} />
                            <FormInput label="Dog Name" name="dogName" value={dogName} onChange={e => setDogName(e.target.value)} />
                        </div>
                        <FormTextarea label="Service Location Notes" name="notes" value={serviceLocationDetails.notes} onChange={e => handleStateChange(setServiceLocationDetails, 'notes', e.target.value)} />
                        <label className="flex items-center"><input type="checkbox" name="preText" checked={serviceLocationDetails.preText} onChange={e => handleStateChange(setServiceLocationDetails, 'preText', e.target.checked)} className="mr-2 h-4 w-4"/>Pre-Service Text Message</label>
                        
                        <div className="mt-6">
                            <div className="flex justify-between items-center mb-2">
                                <h3 class="text-lg font-semibold">Main Contact</h3>
                                <button type="button" onClick={useCustomerAsMainContact} className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700">Use Customer Details</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                <FormInput label="Name" name="name" value={mainContact.name} onChange={(e) => handleStateChange(setMainContact, 'name', e.target.value)} />
                                <FormInput label="Email" name="email" value={mainContact.email} onChange={(e) => handleStateChange(setMainContact, 'email', e.target.value)} />
                                <FormInput label="Phone" name="phoneNumber" value={mainContact.phoneNumber} onChange={(e) => handleStateChange(setMainContact, 'phoneNumber', e.target.value)} />
                                <div className="md:col-span-2">
                                    <FormTextarea label="Notes" name="notes" value={mainContact.notes} onChange={(e) => handleStateChange(setMainContact, 'notes', e.target.value)} />
                                </div>
                            </div>
                        </div>
                    </InfoSection>

                     {useDifferentBillingAddress && (
                        <InfoSection title="Billing Address">
                            <AddressAutocomplete onAddressSelect={(p) => handlePlaceSelected(p, 'billing')} customClasses={inputClasses} />
                        </InfoSection>
                    )}

                    <InfoSection title="Body of Water">
                         <div className='grid md:grid-cols-2 gap-4'>
                            <FormInput label="Name" name="name" value={bodyOfWater.name} onChange={e => handleStateChange(setBodyOfWater, 'name', e.target.value)} required />
                            <FormInput label="Volume (gallons)" name="gallons" type="number" value={bodyOfWater.gallons} onChange={e => handleStateChange(setBodyOfWater, 'gallons', e.target.value)} />
                            <FormInput label="Shape" name="shape" value={bodyOfWater.shape} onChange={e => handleStateChange(setBodyOfWater, 'shape', e.target.value)} />
                            <FormInput label="Material" name="material" value={bodyOfWater.material} onChange={e => handleStateChange(setBodyOfWater, 'material', e.target.value)} />
                             <FormSelect label="Water Type" name="waterType" value={bodyOfWater.waterType} onChange={e => handleStateChange(setBodyOfWater, 'waterType', e.target.value)}>
                                 <option value="Chlorine">Chlorine</option>
                                 <option value="Saltwater">Saltwater</option>
                                 <option value="Mineral">Mineral</option>
                             </FormSelect>
                             <div className="md:col-span-2"><FormTextarea label="Notes" name="notes" value={bodyOfWater.notes} onChange={e => handleStateChange(setBodyOfWater, 'notes', e.target.value)} /></div>
                         </div>
                     </InfoSection>

                     <InfoSection title="Equipment">
                        {equipment.map((eq, index) => (
                            <div key={index} className="p-4 border rounded-lg mt-4 space-y-3 bg-gray-50">
                                <h3 className="font-bold">Equipment #{index + 1}</h3>
                                <FormInput label="Name" name="name" value={eq.name} onChange={(e) => handleEquipmentChange(index, 'name', e.target.value)} />
                                
                                <FormSelect label="Category" name="category" value={eq.category} onChange={(e) => handleEquipmentChange(index, 'category', e.target.value)}>
                                     <option value="">Select a Category</option>
                                     {equipmentTypes.map(type => <option key={type.id} value={type.name}>{type.name}</option>)}
                                     <option value="Other">Other</option>
                                </FormSelect>
                                {eq.category === 'Other' && <FormInput label="Custom Category" name="customCategory" value={eq.customCategory} onChange={(e) => handleEquipmentChange(index, 'customCategory', e.target.value)} />} 
                                
                                <FormSelect label="Make" name="make" value={eq.make} onChange={(e) => handleEquipmentChange(index, 'make', e.target.value)}>
                                     <option value="">Select a Make</option>
                                     {equipmentMakes[index].map(make => <option key={make.id} value={make.name}>{make.name}</option>)}
                                     <option value="Other">Other</option>
                                </FormSelect>
                                {eq.make === 'Other' && <FormInput label="Custom Make" name="customMake" value={eq.customMake} onChange={(e) => handleEquipmentChange(index, 'customMake', e.target.value)} />} 

                                <FormSelect label="Model" name="model" value={eq.model} onChange={(e) => handleEquipmentChange(index, 'model', e.target.value)}>
                                     <option value="">Select a Model</option>
                                     {equipmentModels[index].map(model => <option key={model.id} value={model.model}>{model.model}</option>)}
                                     <option value="Other">Other</option>
                                </FormSelect>
                                {eq.model === 'Other' && <FormInput label="Custom Model" name="customModel" value={eq.customModel} onChange={(e) => handleEquipmentChange(index, 'customModel', e.target.value)} />} 

                                <FormTextarea label="Notes" name="notes" value={eq.notes} onChange={(e) => handleEquipmentChange(index, 'notes', e.target.value)} />
                                <label className="flex items-center"><input type="checkbox" name="needsService" checked={eq.needsService} onChange={(e) => handleEquipmentChange(index, 'needsService', e.target.checked)} className="mr-2 h-4 w-4"/>Needs Service</label>
                            </div>
                        ))}
                     </InfoSection>

                    <div className="flex justify-end gap-4 pt-4">
                        <button type="button" onClick={() => navigate('/company/customers')} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700">Create Customer</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateNewCustomer;
