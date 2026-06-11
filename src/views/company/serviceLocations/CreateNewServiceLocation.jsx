import React, { useState, useContext, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, query, getDocs, setDoc, doc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { toast } from 'react-hot-toast';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import EquipmentCatalogPicker from '../../components/equipment/EquipmentCatalogPicker';
import {
    normalizeAddress,
    normalizeContact,
    normalizeServiceLocationForFirestore,
} from '../../../utils/customerLocationData';

const nextServiceDate = (date, amount, unit) => {
    const next = new Date(date);
    switch (unit) {
        case 'Day':
            next.setDate(next.getDate() + amount);
            break;
        case 'Week':
            next.setDate(next.getDate() + (amount * 7));
            break;
        case 'Year':
            next.setFullYear(next.getFullYear() + amount);
            break;
        case 'Month':
        default:
            next.setMonth(next.getMonth() + amount);
            break;
    }
    return next;
};

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

const FormSelect = ({ label, name, value, onChange, children, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <select name={name} value={value} onChange={onChange} className="w-full mt-1 p-2 border border-gray-300 rounded-lg" {...props}>
            {children}
        </select>
    </div>
);

const CreateNewServiceLocation = () => {
    const navigate = useNavigate();
    const { customerId } = useParams();
    const { recentlySelectedCompany } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [customerContacts, setCustomerContacts] = useState([]);
    const [contactMode, setContactMode] = useState('existing');
    const [selectedContactId, setSelectedContactId] = useState('');

    // Form state based on the new model
    const [address, setAddress] = useState({ streetAddress: '', city: '', state: '', zip: '', latitude: 0, longitude: 0 });
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
    
    const [bodiesOfWater, setBodiesOfWater] = useState([
        { id: uuidv4(), name: 'Main', gallons: '16000', material: 'Plaster', notes: '', shape: '', length: ['', ''], depth: ['', ''], width: ['', ''] }
    ]);
    const [equipment, setEquipment] = useState([
        { id: uuidv4(), name: 'Pump 1', category: 'Pump', typeId: 'qr1d9eefis1VNdIyX6Xq', make: '', makeId: '', model: '', modelId: '', notes: '', needsService: false, serviceFrequency: '', serviceFrequencyEvery: '' },
        { id: uuidv4(), name: 'Filter 1', category: 'Filter', typeId: 'BYpNgrzHyVjIMQFAiFyO', make: '', makeId: '', model: '', modelId: '', notes: '', needsService: true, serviceFrequency: 6, serviceFrequencyEvery: 'Month' }
    ]);

    // Fetch customers for the dropdown
    useEffect(() => {
        const fetchCustomers = async () => {
            if (!recentlySelectedCompany) return;
            const q = query(collection(db, 'companies', recentlySelectedCompany, 'customers'));
            const snap = await getDocs(q);
            const customerList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCustomers(customerList);
            if (customerId && customerList.some(customer => customer.id === customerId)) {
                setSelectedCustomer(customerId);
            }
        };
        fetchCustomers();
    }, [recentlySelectedCompany, customerId]);

    useEffect(() => {
        const fetchCustomerContacts = async () => {
            if (!recentlySelectedCompany || !selectedCustomer) {
                setCustomerContacts([]);
                setSelectedContactId('');
                return;
            }

            const contactsSnap = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers', selectedCustomer, 'contacts'));
            const contacts = contactsSnap.docs.map(contactDoc => ({ id: contactDoc.id, ...contactDoc.data() }));
            setCustomerContacts(contacts);

            if (contacts.length > 0) {
                setContactMode('existing');
                setSelectedContactId(currentId => contacts.some(contact => contact.id === currentId) ? currentId : contacts[0].id);
                return;
            }

            const customerData = customers.find(customer => customer.id === selectedCustomer);
            setContactMode('new');
            setSelectedContactId('');
            setMainContact({
                id: "com_cus_con_" + uuidv4(),
                name: customerData?.displayAsCompany ? (customerData.company || customerData.companyName || '') : `${customerData?.firstName || ''} ${customerData?.lastName || ''}`.trim(),
                email: customerData?.email || '',
                phoneNumber: customerData?.phoneNumber || customerData?.phone || '',
                notes: ''
            });
        };

        fetchCustomerContacts();
    }, [recentlySelectedCompany, selectedCustomer, customers]);

    const handleStateChange = (setter, name, value) => setter(prev => ({ ...prev, [name]: value }));

    const handlePlaceSelected = (place) => {
        if (!place) return;
        setAddress(normalizeAddress({
            streetAddress: place.streetAddress, city: place.city, state: place.state, zip: place.zipCode, 
            latitude: place.latitude, longitude: place.longitude 
        }));
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!requirePermission("42", "create service locations")) return;

        if (!recentlySelectedCompany || !selectedCustomer) {
            toast.error('Please select a customer.');
            return;
        }

        if (!address.streetAddress || !address.city || !address.state || !address.zip) {
            toast.error('Please select a service location address.');
            return;
        }

        const toastId = toast.loading('Creating service location...');
        try {
            const serviceLocationId = 'com_sl_' + uuidv4();
            const customerData = customers.find(c => c.id === selectedCustomer);
            const customerName = customerData?.displayAsCompany
                ? (customerData.company || customerData.companyName || '')
                : `${customerData?.firstName || ''} ${customerData?.lastName || ''}`.trim();
            let finalMainContact = customerContacts.find(contact => contact.id === selectedContactId) || mainContact;

            if (contactMode === 'new') {
                finalMainContact = {
                    ...mainContact,
                    id: mainContact.id || "com_cus_con_" + uuidv4(),
                };
            }
            finalMainContact = normalizeContact(finalMainContact);
            await setDoc(
                doc(db, 'companies', recentlySelectedCompany, 'customers', selectedCustomer, 'contacts', finalMainContact.id),
                finalMainContact,
                { merge: true }
            );

            // Process bodies of water and equipment
            const bodiesOfWaterIds = [];
            const createdBodyOfWaterIds = [];
            for (const bow of bodiesOfWater) {
                if (!bow.name) continue;
                const bowId = 'com_bow_' + uuidv4();
                bodiesOfWaterIds.push(bowId);
                createdBodyOfWaterIds.push(bowId);
                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bowId), {
                    id: bowId,
                    name: bow.name,
                    gallons: bow.gallons || '',
                    material: bow.material || '',
                    customerId: selectedCustomer,
                    serviceLocationId,
                    notes: bow.notes || '',
                    shape: bow.shape || '',
                    length: bow.length || ['', ''],
                    depth: bow.depth || ['', ''],
                    width: bow.width || ['', ''],
                    photoUrls: [],
                    lastFilled: new Date(),
                    isActive: true,
                });
            }

            for (const eq of equipment) {
                if (eq.name) {
                     const equipmentId = 'com_equ_' + uuidv4();
                     const finalType = eq.type || eq.category || '';
                     const lastServiceDate = eq.needsService ? new Date() : null;
                     const serviceFrequency = eq.needsService ? Number(eq.serviceFrequency || 6) : null;
                     const serviceFrequencyEvery = eq.needsService ? (eq.serviceFrequencyEvery || 'Month') : null;
                     await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), {
                         id: equipmentId,
                         name: eq.name,
                         notes: eq.notes || '',
                         needsService: !!eq.needsService,
                         type: finalType,
                         typeId: eq.typeId || '',
                         make: eq.make || '',
                         makeId: eq.makeId || '',
                         model: eq.model || '',
                         modelId: eq.modelId || '',
                         universalEquipmentId: eq.universalEquipmentId || eq.modelId || '',
                         manualPdfLink: eq.manualPdfLink || '',
                         customerId: selectedCustomer,
                         serviceLocationId,
                         bodyOfWaterId: createdBodyOfWaterIds[0] || '',
                         customerName,
                         dateInstalled: new Date(),
                         dateUninstalled: null,
                         active: true,
                         isActive: true,
                         status: 'Operational',
                         cleanFilterPressure: null,
                         currentPressure: null,
                         lastServiceDate,
                         serviceFrequency,
                         serviceFrequencyEvery,
                         nextServiceDate: lastServiceDate && serviceFrequency && serviceFrequencyEvery
                             ? nextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery)
                             : null,
                         photoUrls: [],
                         verified: false,
                     });
                }
            }

            // Create Service Location
            const serviceLocationPayload = normalizeServiceLocationForFirestore({
                id: serviceLocationId,
                nickName: details.nickName,
                address: normalizeAddress(address),
                gateCode: details.gateCode,
                dogName: dogNames.split(',').map(s => s.trim()).filter(Boolean),
                estimatedTime: Number(details.estimatedTime || 0),
                mainContact: finalMainContact,
                notes: details.notes,
                bodiesOfWaterId: bodiesOfWaterIds,
                rateType: '',
                laborType: '',
                chemicalCost: '',
                laborCost: '',
                rate: '',
                customerId: selectedCustomer,
                customerName,
                backYardTree: [],
                backYardBushes: [],
                backYardOther: [],
                preText: details.preText,
                verified: details.verified,
                photoUrls: details.photoUrls,
                isActive: true,
                active: true,
            });
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId), serviceLocationPayload);

            toast.success('Service location created successfully!', { id: toastId });
            navigate(`/company/customers/details/${selectedCustomer}/operations`);

        } catch (error) {
            toast.error('Error creating service location.', { id: toastId });
            console.error("Error: ", error);
        }
    };

    // Functions to add new body of water or equipment item
    const addBodyOfWater = () => {
        setBodiesOfWater([...bodiesOfWater, { id: uuidv4(), name: 'Main', gallons: '16000', material: 'Plaster', notes: '', shape: '', length: ['', ''], depth: ['', ''], width: ['', ''] }]);
    };

    const addEquipment = () => {
        setEquipment([...equipment, { id: uuidv4(), name: '', category: '', typeId: '', make: '', makeId: '', model: '', modelId: '', notes: '', needsService: false, serviceFrequency: '', serviceFrequencyEvery: '' }]);
    };
    const updateEquipmentCatalog = (index, nextEquipment) => {
        const next = [...equipment];
        next[index] = nextEquipment;
        setEquipment(next);
    };
    const inputClasses = "w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm";

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <h1 className='text-3xl font-bold text-gray-900 mb-6'>Create New Service Location</h1>
                <form onSubmit={handleCreate} className="bg-white p-8 rounded-2xl shadow-lg space-y-8">
                    
                    <InfoSection title="Basic Information">
                        <FormSelect label="Customer" value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} required disabled={!!customerId && selectedCustomer === customerId}>
                            <option value="">Select a Customer</option>
                            {customers.map(c => <option key={c.id} value={c.id}>{c.displayAsCompany ? (c.company || c.companyName) : `${c.firstName} ${c.lastName}`}</option>)}
                        </FormSelect>
                        <AddressAutocomplete onAddressSelect={handlePlaceSelected} customClasses={inputClasses}/>
                        <FormInput label="Location Nickname" name="nickName" value={details.nickName} onChange={e => handleStateChange(setDetails, 'nickName', e.target.value)} required />
                    </InfoSection>

                    <InfoSection title="Access Details">
                        <div className='grid md:grid-cols-2 gap-4'>
                            <FormInput label="Gate Code" name="gateCode" value={details.gateCode} onChange={e => handleStateChange(setDetails, 'gateCode', e.target.value)} />
                            <FormInput label="Dog Names (comma-separated)" name="dogNames" value={dogNames} onChange={e => setDogNames(e.target.value)} />
                        </div>
                        <FormTextarea label="General Notes" name="notes" value={details.notes} onChange={e => handleStateChange(setDetails, 'notes', e.target.value)} />
                    </InfoSection>

                    <InfoSection title="Main Contact">
                        <div className="flex flex-wrap gap-3">
                            <label className="flex items-center">
                                <input type="radio" checked={contactMode === 'existing'} onChange={() => setContactMode('existing')} disabled={customerContacts.length === 0} className="mr-2 h-4 w-4" />
                                Select existing contact
                            </label>
                            <label className="flex items-center">
                                <input type="radio" checked={contactMode === 'new'} onChange={() => setContactMode('new')} className="mr-2 h-4 w-4" />
                                Create new contact
                            </label>
                        </div>

                        {contactMode === 'existing' && customerContacts.length > 0 ? (
                            <FormSelect label="Customer Contact" value={selectedContactId} onChange={e => setSelectedContactId(e.target.value)}>
                                {customerContacts.map(contact => (
                                    <option key={contact.id} value={contact.id}>
                                        {contact.name || 'Unnamed Contact'}{contact.phoneNumber ? ` - ${contact.phoneNumber}` : ''}
                                    </option>
                                ))}
                            </FormSelect>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                <FormInput label="Name" name="name" value={mainContact.name} onChange={(e) => handleStateChange(setMainContact, 'name', e.target.value)} />
                                <FormInput label="Email" name="email" value={mainContact.email} onChange={(e) => handleStateChange(setMainContact, 'email', e.target.value)} />
                                <FormInput label="Phone" name="phoneNumber" value={mainContact.phoneNumber} onChange={(e) => handleStateChange(setMainContact, 'phoneNumber', e.target.value)} />
                                <div className="md:col-span-2">
                                    <FormTextarea label="Notes" name="notes" value={mainContact.notes} onChange={(e) => handleStateChange(setMainContact, 'notes', e.target.value)} />
                                </div>
                            </div>
                        )}
                    </InfoSection>

                    <InfoSection title="Settings">
                        <FormInput label="Estimated Time (minutes)" name="estimatedTime" type="number" value={details.estimatedTime} onChange={e => handleStateChange(setDetails, 'estimatedTime', e.target.value)} required />
                        <label className="flex items-center"><input type="checkbox" name="preText" checked={details.preText} onChange={e => handleStateChange(setDetails, 'preText', e.target.checked)} className="mr-2 h-4 w-4"/> Send Pre-Service Text Message</label>
                        <label className="flex items-center"><input type="checkbox" name="verified" checked={details.verified} onChange={e => handleStateChange(setDetails, 'verified', e.target.checked)} className="mr-2 h-4 w-4"/> Location Verified</label>
                    </InfoSection>

                    <InfoSection title="Bodies of Water">
                        {bodiesOfWater.map((bow, index) => (
                            <div key={bow.id} className="p-4 border rounded-lg mt-4 space-y-3 bg-gray-50">
                                <FormInput label="Name" value={bow.name} onChange={e => { const next = [...bodiesOfWater]; next[index].name = e.target.value; setBodiesOfWater(next); }} />
                                <div className="grid md:grid-cols-2 gap-4">
                                    <FormInput label="Volume (gallons)" type="number" value={bow.gallons} onChange={e => { const next = [...bodiesOfWater]; next[index].gallons = e.target.value; setBodiesOfWater(next); }} />
                                    <FormInput label="Material" value={bow.material} onChange={e => { const next = [...bodiesOfWater]; next[index].material = e.target.value; setBodiesOfWater(next); }} />
                                    <FormInput label="Shape" value={bow.shape} onChange={e => { const next = [...bodiesOfWater]; next[index].shape = e.target.value; setBodiesOfWater(next); }} />
                                    <FormInput label="Length" value={bow.length?.[0] || ''} onChange={e => { const next = [...bodiesOfWater]; next[index].length = [e.target.value, next[index].length?.[1] || '']; setBodiesOfWater(next); }} />
                                    <FormInput label="Depth" value={bow.depth?.[0] || ''} onChange={e => { const next = [...bodiesOfWater]; next[index].depth = [e.target.value, next[index].depth?.[1] || '']; setBodiesOfWater(next); }} />
                                    <FormInput label="Width" value={bow.width?.[0] || ''} onChange={e => { const next = [...bodiesOfWater]; next[index].width = [e.target.value, next[index].width?.[1] || '']; setBodiesOfWater(next); }} />
                                </div>
                                <FormTextarea label="Notes" value={bow.notes} onChange={e => { const next = [...bodiesOfWater]; next[index].notes = e.target.value; setBodiesOfWater(next); }} />
                            </div>
                        ))}
                        <button type="button" onClick={addBodyOfWater} className="mt-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg shadow-sm hover:bg-green-700">+ Add Body of Water</button>
                    </InfoSection>

                    <InfoSection title="Equipment">
                        {equipment.map((eq, index) => (
                            <div key={eq.id} className="p-4 border rounded-lg mt-4 space-y-3 bg-gray-50">
                                <FormInput label="Name" value={eq.name} onChange={e => { const next = [...equipment]; next[index].name = e.target.value; setEquipment(next); }} />
                                <EquipmentCatalogPicker
                                    value={eq}
                                    onChange={(nextEquipment) => updateEquipmentCatalog(index, nextEquipment)}
                                    onModelSelected={(selectedModel) => {
                                        if (!eq.name?.trim()) {
                                            updateEquipmentCatalog(index, {
                                                ...eq,
                                                model: selectedModel.model || selectedModel.name || '',
                                                modelId: selectedModel.id || '',
                                                universalEquipmentId: selectedModel.id || '',
                                                manualPdfLink: selectedModel.manualPdfLink || '',
                                                name: selectedModel.name || selectedModel.model || '',
                                            });
                                        }
                                    }}
                                />
                                <FormTextarea label="Notes" value={eq.notes} onChange={e => { const next = [...equipment]; next[index].notes = e.target.value; setEquipment(next); }} />
                                <label className="flex items-center"><input type="checkbox" name="needsService" checked={eq.needsService} onChange={e => { const next = [...equipment]; next[index].needsService = e.target.checked; setEquipment(next); }} className="mr-2 h-4 w-4" />Needs Service</label>
                                {eq.needsService && (
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <FormInput label="Service Frequency" type="number" value={eq.serviceFrequency || ''} onChange={e => { const next = [...equipment]; next[index].serviceFrequency = e.target.value; setEquipment(next); }} />
                                        <FormSelect label="Frequency Unit" value={eq.serviceFrequencyEvery || 'Month'} onChange={e => { const next = [...equipment]; next[index].serviceFrequencyEvery = e.target.value; setEquipment(next); }}>
                                            <option value="Day">Day</option>
                                            <option value="Week">Week</option>
                                            <option value="Month">Month</option>
                                            <option value="Year">Year</option>
                                        </FormSelect>
                                    </div>
                                )}
                            </div>
                        ))}
                        <button type="button" onClick={addEquipment} className="mt-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg shadow-sm hover:bg-green-700">+ Add Equipment</button>
                    </InfoSection>

                    <div className="flex justify-end gap-4 pt-4">
                        <button type="button" onClick={() => navigate(selectedCustomer ? `/company/customers/details/${selectedCustomer}/operations` : '/company/customers')} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700">Create Service Location</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateNewServiceLocation;
