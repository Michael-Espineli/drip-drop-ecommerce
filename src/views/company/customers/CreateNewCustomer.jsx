import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../utils/config';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import UpgradeModal from '../../components/modals/UpgradeModal';
import { toast } from 'react-hot-toast';
import EquipmentCatalogPicker from '../../components/equipment/EquipmentCatalogPicker';
import {
    normalizeAddress,
    normalizeContact,
    normalizeCustomerForFirestore,
    normalizeServiceLocationForFirestore,
} from '../../../utils/customerLocationData';
import {
    describeDuplicateCustomerMatch,
    findDuplicateCustomerMatches,
} from '../../../utils/customerDuplicates';
import { queueUniversalEquipmentSuggestion } from '../../../utils/universalEquipmentSuggestions';
import { equipmentDefaultsToNeedsService } from '../../../utils/models/Equipment';

const InfoSection = ({ title, children }) => (
    <div className="border-b border-gray-200 pb-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
        <div className="space-y-4">{children}</div>
    </div>
);

const FormInput = ({ label, name, value, onChange, required = false, type = 'text', ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <input type={type} name={name} value={value} onChange={onChange} required={required} className="w-full mt-1 p-2 border border-gray-300 rounded-lg" {...props} />
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

const dateInputToLocalDate = (value) => {
    if (!value) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
};

const formatDateInput = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
    if (!lastServiceDate) return null;

    const amount = Number(serviceFrequency);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const next = new Date(lastServiceDate);
    if (Number.isNaN(next.getTime())) return null;

    if (serviceFrequencyEvery === 'Day') next.setDate(next.getDate() + amount);
    else if (serviceFrequencyEvery === 'Week') next.setDate(next.getDate() + (amount * 7));
    else if (serviceFrequencyEvery === 'Month') next.setMonth(next.getMonth() + amount);
    else if (serviceFrequencyEvery === 'Year') next.setFullYear(next.getFullYear() + amount);
    else return null;

    return next;
};

const getEquipmentNextServiceDateInput = (equipment = {}) => (
    formatDateInput(computeNextServiceDate(
        dateInputToLocalDate(equipment.lastServiceDate),
        equipment.serviceFrequency,
        equipment.serviceFrequencyEvery || 'Month'
    ))
);

const withEquipmentServiceDefaults = (equipment = {}) => ({
    ...equipment,
    needsService: true,
    serviceFrequency: equipment.serviceFrequency || 6,
    serviceFrequencyEvery: equipment.serviceFrequencyEvery || 'Month',
});

const applyEquipmentServiceDefaults = (equipment = {}) => (
    equipmentDefaultsToNeedsService(equipment) || equipment.needsService
        ? withEquipmentServiceDefaults(equipment)
        : equipment
);

const CreateNewCustomer = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany, recentlySelectedCompanyName, user } = useContext(Context);

    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    // Form state
    const [displayAsCompany, setDisplayAsCompany] = useState(false);
    const [useDifferentBillingAddress, setUseDifferentBillingAddress] = useState(false);

    const [formData, setFormData] = useState({ firstName: '', lastName: '', company: '', email: '', phoneNumber: '', billingNotes: '' });
    const [serviceAddress, setServiceAddress] = useState({ streetAddress: '', city: '', state: '', zip: '', latitude: 0, longitude: 0 });
    const [billingAddress, setBillingAddress] = useState({ streetAddress: '', city: '', state: '', zip: '', latitude: 0, longitude: 0 });
    const [serviceLocationDetails, setServiceLocationDetails] = useState({
        gateCode: '', notes: '', preText: false, estimatedTime: 15, nickName: "Main", verified: false, rateType: "", laborType: "", chemicalCost: "", laborCost: "", rate: "",
        photoUrls: []
    });
    const [mainContact, setMainContact] = useState({ id: "com_cus_con_" + uuidv4(), name: '', email: '', phoneNumber: '', notes: '' });
    const [dogName, setDogName] = useState("");

    const [bodyOfWater, setBodyOfWater] = useState({ name: 'Main', gallons: '16000', waterType: 'Chlorine', material: 'Plaster', notes: '', shape: '' });
    const [equipment, setEquipment] = useState([
        { name: 'Pump', category: 'Pump', type: 'Pump', typeId: 'qr1d9eefis1VNdIyX6Xq', make: '', makeId: '', model: '', modelId: '', universalEquipmentId: '', manualPdfLink: '', notes: '', needsService: false, lastServiceDate: '', serviceFrequency: '', serviceFrequencyEvery: '' },
        { name: 'Filter', category: 'Filter', type: 'Filter', typeId: 'BYpNgrzHyVjIMQFAiFyO', make: '', makeId: '', model: '', modelId: '', universalEquipmentId: '', manualPdfLink: '', notes: '', needsService: true, lastServiceDate: '', serviceFrequency: 6, serviceFrequencyEvery: 'Month' }
    ]);

    // Generic handler for simple state updates
    const handleStateChange = (setter, name, value) => setter(prev => ({ ...prev, [name]: value }));

    const handleEquipmentChange = (index, field, value) => {
        setEquipment(prev => {
            const next = [...prev];
            const updatedEquipment = { ...next[index], [field]: value };
            next[index] = applyEquipmentServiceDefaults(updatedEquipment);
            return next;
        });
    };

    const handleEquipmentCatalogChange = (index, nextEquipment) => {
        setEquipment(prev => {
            const next = [...prev];
            const mergedEquipment = { ...next[index], ...nextEquipment };
            next[index] = applyEquipmentServiceDefaults(mergedEquipment);
            return next;
        });
    };

    const handlePlaceSelected = (place, type) => {
        if (!place) return;
        const address = normalizeAddress({
            streetAddress: place.streetAddress, city: place.city, state: place.state, zip: place.zipCode,
            latitude: place.latitude, longitude: place.longitude
        });
        if (type === 'billing') setBillingAddress(address);
        else setServiceAddress(address);
    };

    const useCustomerAsMainContact = () => {
        setMainContact({
            id: mainContact.id || "com_cus_con_" + uuidv4(),
            name: displayAsCompany ? formData.company : `${formData.firstName} ${formData.lastName}`,
            email: formData.email,
            phoneNumber: formData.phoneNumber,
            notes: mainContact.notes
        });
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!recentlySelectedCompany) return;

        for (const eq of equipment) {
            if (!eq.name) continue;

            const finalCategory = eq.type || eq.category || '';
            const finalNeedsService = !!eq.needsService || equipmentDefaultsToNeedsService({ ...eq, type: finalCategory });
            const lastServiceDate = finalNeedsService ? dateInputToLocalDate(eq.lastServiceDate) : null;
            const serviceFrequency = finalNeedsService ? Number(eq.serviceFrequency) : null;
            const serviceFrequencyEvery = finalNeedsService ? (eq.serviceFrequencyEvery || 'Month') : null;
            const calculatedNextServiceDate = finalNeedsService
                ? computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery)
                : null;

            if (finalNeedsService && !lastServiceDate) {
                toast.error(`Add a last service date for ${eq.name}.`);
                return;
            }

            if (finalNeedsService && (!Number.isFinite(serviceFrequency) || serviceFrequency <= 0 || !serviceFrequencyEvery || !calculatedNextServiceDate)) {
                toast.error(`Add a valid service frequency for ${eq.name}.`);
                return;
            }
        }

        const toastId = toast.loading('Creating customer...');
        try {
            const customerId = 'com_cus_' + uuidv4();
            const serviceLocationId = 'com_sl_' + uuidv4();
            const bodyOfWaterId = 'com_bow_' + uuidv4();

            const normalizedServiceAddress = normalizeAddress(serviceAddress);
            const finalBillingAddress = normalizeAddress(useDifferentBillingAddress ? billingAddress : normalizedServiceAddress);
            const customerName = displayAsCompany ? formData.company : `${formData.firstName} ${formData.lastName}`;
            const serviceLocationMainContact = normalizeContact({
                id: mainContact.id || "com_cus_con_" + uuidv4(),
                name: mainContact.name,
                email: mainContact.email,
                phoneNumber: mainContact.phoneNumber,
                notes: mainContact.notes
            });
            const customerPayload = normalizeCustomerForFirestore({
                id: customerId,
                ...formData,
                displayAsCompany,
                active: true,
                isActive: true,
                billingAddress: finalBillingAddress,
                linkedCustomerIds: [],
                linkedInviteId: "",
                hireDate: new Date(),
                phoneLabel: ""
            });
            const existingCustomersSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers'));
            const duplicateMatches = findDuplicateCustomerMatches(
                customerPayload,
                existingCustomersSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
            );

            if (duplicateMatches.length > 0) {
                const match = duplicateMatches[0];
                toast.error(
                    `Possible duplicate: ${match.displayName} already matches by ${describeDuplicateCustomerMatch(match)}.`,
                    { id: toastId }
                );
                return;
            }

            const serviceLocationPayload = normalizeServiceLocationForFirestore({
                id: serviceLocationId,
                customerId,
                customerName,
                address: normalizedServiceAddress,
                mainContact: serviceLocationMainContact,
                ...serviceLocationDetails,
                bodiesOfWaterId: [bodyOfWaterId],
                dogName: dogName ? [dogName] : [],
                isActive: true,
                active: true
            });

            // 1. Create Customer
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', customerId), customerPayload);

            // 2. Create Service Location
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId), serviceLocationPayload);

            // 3. Create Body of Water
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWaterId), {
                id: bodyOfWaterId, ...bodyOfWater, customerId, serviceLocationId
            });

            // 4. Create Equipment
            for (const eq of equipment) {
                if (eq.name) {
                    const equipmentId = 'com_equ_' + uuidv4();
                    const finalCategory = eq.type || eq.category || '';
                    const finalNeedsService = !!eq.needsService || equipmentDefaultsToNeedsService({ ...eq, type: finalCategory });
                    const lastServiceDate = finalNeedsService ? dateInputToLocalDate(eq.lastServiceDate) : null;
                    const serviceFrequency = finalNeedsService ? Number(eq.serviceFrequency) : null;
                    const serviceFrequencyEvery = finalNeedsService ? (eq.serviceFrequencyEvery || 'Month') : null;
                    const calculatedNextServiceDate = finalNeedsService
                        ? computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery)
                        : null;
                    const equipmentPayload = {
                        id: equipmentId, name: eq.name, notes: eq.notes, needsService: finalNeedsService,
                        type: finalCategory,
                        typeId: eq.typeId || "",
                        make: eq.make || "",
                        makeId: eq.makeId || "",
                        model: eq.model || "",
                        modelId: eq.modelId || eq.universalEquipmentId || "",
                        universalEquipmentId: eq.universalEquipmentId || eq.modelId || "",
                        manualPdfLink: eq.manualPdfLink || "",
                        customerId,
                        serviceLocationId,
                        bodyOfWaterId,
                        customerName,
                        dateInstalled: new Date(),
                        lastServiceDate,
                        nextServiceDate: calculatedNextServiceDate,
                        serviceFrequency,
                        serviceFrequencyEvery,
                        active: true,
                        isActive: true,
                        status: 'Operational',
                        cleanFilterPressure: null,
                        currentPressure: null,
                    };

                    await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), equipmentPayload);

                    try {
                        await queueUniversalEquipmentSuggestion({
                            db,
                            companyId: recentlySelectedCompany,
                            companyName: recentlySelectedCompanyName || '',
                            user,
                            equipment: equipmentPayload,
                            source: 'customerCreateEquipment',
                        });
                    } catch (suggestionError) {
                        console.error('Error creating universal equipment suggestion:', suggestionError);
                    }
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
                <div>
                    <h1 className='text-3xl font-bold text-gray-900 mb-6'>Create New Customer</h1>
                    <p className="text-gray-600 mt-1">Create a new customer and add their service locations and bodies of water.</p>
                </div>
                <form onSubmit={handleCreate} className="bg-white p-8 rounded-2xl shadow-lg space-y-8">

                    <InfoSection title="Customer Details">
                        <div className="flex justify-end">
                            <label className="flex items-center"><input type="checkbox" checked={displayAsCompany} onChange={(e) => setDisplayAsCompany(e.target.checked)} className="mr-2 h-4 w-4" />Display as Company</label>
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
                        <label className="flex items-center mb-4"><input type="checkbox" checked={useDifferentBillingAddress} onChange={(e) => setUseDifferentBillingAddress(e.target.checked)} className="mr-2" />Use different billing address</label>
                        {useDifferentBillingAddress && (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <h3 className="mb-3 text-lg font-semibold text-gray-900">Billing Address</h3>
                                <AddressAutocomplete onAddressSelect={(p) => handlePlaceSelected(p, 'billing')} customClasses={inputClasses} />
                            </div>
                        )}
                    </InfoSection>

                    <InfoSection title="Service Location">
                        <AddressAutocomplete onAddressSelect={(p) => handlePlaceSelected(p, 'service')} customClasses={inputClasses} />
                        <FormInput label="Nick Name" name="nickName" value={serviceLocationDetails.nickName} onChange={e => handleStateChange(setServiceLocationDetails, 'nickName', e.target.value)} />

                        <div className='grid md:grid-cols-2 gap-4'>
                            <FormInput label="Gate Code" name="gateCode" value={serviceLocationDetails.gateCode} onChange={e => handleStateChange(setServiceLocationDetails, 'gateCode', e.target.value)} />
                            <FormInput label="Dog Name" name="dogName" value={dogName} onChange={e => setDogName(e.target.value)} />
                        </div>
                        <FormTextarea label="Service Location Notes" name="notes" value={serviceLocationDetails.notes} onChange={e => handleStateChange(setServiceLocationDetails, 'notes', e.target.value)} />
                        <label className="flex items-center"><input type="checkbox" name="preText" checked={serviceLocationDetails.preText} onChange={e => handleStateChange(setServiceLocationDetails, 'preText', e.target.checked)} className="mr-2 h-4 w-4" />Pre-Service Text Message</label>

                        <div className="mt-6">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-lg font-semibold">Main Contact</h3>
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

                                <EquipmentCatalogPicker
                                    value={eq}
                                    onChange={(nextEquipment) => handleEquipmentCatalogChange(index, nextEquipment)}
                                    onModelSelected={(selectedModel) => {
                                        if (!eq.name?.trim()) {
                                            handleEquipmentCatalogChange(index, {
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

	                                <FormTextarea label="Notes" name="notes" value={eq.notes} onChange={(e) => handleEquipmentChange(index, 'notes', e.target.value)} />
	                                <label className="flex items-center"><input type="checkbox" name="needsService" checked={eq.needsService} onChange={(e) => handleEquipmentChange(index, 'needsService', e.target.checked)} className="mr-2 h-4 w-4" />Needs Service</label>
	                                {eq.needsService && (
	                                    <div className="grid md:grid-cols-2 gap-4">
	                                        <FormInput label="Last Service Date" type="date" value={eq.lastServiceDate || ''} onChange={(e) => handleEquipmentChange(index, 'lastServiceDate', e.target.value)} required />
	                                        <FormInput label="Next Service Date" type="date" value={getEquipmentNextServiceDateInput(eq)} readOnly />
	                                        <FormInput label="Service Frequency" type="number" min="1" value={eq.serviceFrequency || ''} onChange={(e) => handleEquipmentChange(index, 'serviceFrequency', e.target.value)} required />
	                                        <FormSelect label="Frequency Unit" value={eq.serviceFrequencyEvery || 'Month'} onChange={(e) => handleEquipmentChange(index, 'serviceFrequencyEvery', e.target.value)} required>
	                                            <option value="Day">Day</option>
	                                            <option value="Week">Week</option>
	                                            <option value="Month">Month</option>
	                                            <option value="Year">Year</option>
	                                        </FormSelect>
	                                    </div>
	                                )}
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
