import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import { v4 as uuidv4 } from 'uuid';

const CreateCustomerFromLead = () => {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form states from CreateNewCustomer
    const [displayAsCompany, setDisplayAsCompany] = useState(false);
    const [useDifferentBillingAddress, setUseDifferentBillingAddress] = useState(false);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        companyName: '',
        email: '',
        phone: '',
        billingNotes: '',
    });
    const [billingAddress, setBillingAddress] = useState({ streetAddress: '', city: '', state: '', zip: '' });

    // Service Location, BOW, Equipment states
    const [addServiceLocation, setAddServiceLocation] = useState(true);
    const [addBodyOfWater, setAddBodyOfWater] = useState(false);
    const [addEquipment, setAddEquipment] = useState(false);

    const [serviceLocationData, setServiceLocationData] = useState({ nickName: 'Main', gateCode: '', dogName: '', notes: '', preText: false });
    const [bodyOfWaterData, setBodyOfWaterData] = useState({ name: 'Main Pool', gallons: '15000', material: 'Plaster', notes: '' });
    const [equipmentData, setEquipmentData] = useState([
        { name: 'Pump', type: 'Pump', typeId: '', make: '', makeId: '', model: '', modelId: '', manualPdfLink: '', notes: '', needsService: false },
        { name: 'Filter', type: 'Filter', typeId: '', make: '', makeId: '', model: '', modelId: '', manualPdfLink: '', notes: '', needsService: true }
    ]);
    const [equipmentTypes, setEquipmentTypes] = useState([]);
    const [equipmentMakes, setEquipmentMakes] = useState([[], []]);
    const [equipmentModels, setEquipmentModels] = useState([[], []]);
    const equipmentLookupKey = equipmentData
        .map(equipment => `${equipment.typeId || ''}:${equipment.makeId || ''}`)
        .join('|');

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) return;
        const fetchLead = async () => {
            setLoading(true);
            const leadRef = doc(db, 'homeownerServiceRequests', leadId);
            try {
                const docSnap = await getDoc(leadRef);
                if (docSnap.exists()) {
                    const leadData = { id: docSnap.id, ...docSnap.data() };
                    setLead(leadData);
                    // Pre-fill form
                    const nameParts = (leadData.homeownerName || '').split(' ');
                    setFormData({
                        firstName: nameParts[0] || '',
                        lastName: nameParts.slice(1).join(' ') || '',
                        email: leadData.homeownerEmail || '',
                        phone: leadData.homeownerPhone || '',
                        companyName: '', billingNotes: ''
                    });

                } else {
                    toast.error("Lead not found.");
                    navigate('/company/leads');
                }
            } catch (error) {
                toast.error("Failed to fetch lead details.");
            } finally {
                setLoading(false);
            }
        };
        fetchLead();
    }, [leadId, recentlySelectedCompany, db, navigate]);

    useEffect(() => {
        const fetchEquipmentTypes = async () => {
            const snap = await getDocs(query(collection(db, 'universal', 'equipment', 'equipmentTypes')));
            setEquipmentTypes(snap.docs.map(typeDoc => ({ id: typeDoc.id, ...typeDoc.data() })));
        };

        fetchEquipmentTypes();
    }, [db]);

    useEffect(() => {
        if (!equipmentTypes.length) return;

        setEquipmentData(currentEquipment => currentEquipment.map(equipment => {
            if (equipment.typeId) return equipment;

            const matchedType = equipmentTypes.find(type => type.name === equipment.type);
            if (!matchedType) return equipment;

            return {
                ...equipment,
                typeId: matchedType.id,
            };
        }));
    }, [equipmentTypes]);

    useEffect(() => {
        const loadEquipmentOptions = async () => {
            const makesByIndex = [[], []];
            const modelsByIndex = [[], []];
            const selectedLookups = equipmentLookupKey
                .split('|')
                .map(value => {
                    const [typeId = '', makeId = ''] = value.split(':');
                    return { typeId, makeId };
                });

            await Promise.all(selectedLookups.map(async (equipment, index) => {
                if (!equipment.typeId) return;

                const makesSnap = await getDocs(
                    query(collection(db, 'universal', 'equipment', 'equipmentMakes'), where('types', 'array-contains', equipment.typeId))
                );
                const makes = makesSnap.docs.map(makeDoc => ({ id: makeDoc.id, ...makeDoc.data() }));
                makesByIndex[index] = makes;

                if (!equipment.makeId) return;

                const modelsSnap = await getDocs(
                    query(
                        collection(db, 'universal', 'equipment', 'equipment'),
                        where('typeId', '==', equipment.typeId),
                        where('makeId', '==', equipment.makeId)
                    )
                );
                modelsByIndex[index] = modelsSnap.docs.map(modelDoc => ({ id: modelDoc.id, ...modelDoc.data() }));
            }));

            setEquipmentMakes(makesByIndex);
            setEquipmentModels(modelsByIndex);
        };

        loadEquipmentOptions();
    }, [db, equipmentLookupKey]);

    const handleInputChange = (e, setter, nestedField) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;
        if (setter) {
            setter(prev => nestedField ? { ...prev, [nestedField]: { ...prev[nestedField], [name]: val } } : { ...prev, [name]: val });
        } else {
            setFormData(prev => ({ ...prev, [name]: val }));
        }
    };

    const handleEquipmentListChange = (index, e) => {
        const { name, value, type, checked } = e.target;
        const fieldValue = type === 'checkbox' ? checked : value;
        const newList = [...equipmentData];
        const nextEquipment = { ...newList[index], [name]: fieldValue };

        if (name === 'typeId') {
            const selectedType = equipmentTypes.find(type => type.id === fieldValue);
            nextEquipment.type = selectedType?.name || '';
            nextEquipment.make = '';
            nextEquipment.makeId = '';
            nextEquipment.model = '';
            nextEquipment.modelId = '';
            nextEquipment.manualPdfLink = '';
        }

        if (name === 'makeId') {
            const selectedMake = equipmentMakes[index]?.find(make => make.id === fieldValue);
            nextEquipment.make = selectedMake?.name || '';
            nextEquipment.model = '';
            nextEquipment.modelId = '';
            nextEquipment.manualPdfLink = '';
        }

        if (name === 'modelId') {
            const selectedModel = equipmentModels[index]?.find(model => model.id === fieldValue);
            nextEquipment.model = selectedModel?.model || selectedModel?.name || '';
            nextEquipment.manualPdfLink = selectedModel?.manualPdfLink || '';
            if (!nextEquipment.name && selectedModel) {
                nextEquipment.name = selectedModel.name || selectedModel.model || '';
            }
        }

        newList[index] = nextEquipment;
        setEquipmentData(newList);
    };

    const normalizeAddress = (address = {}) => ({
        streetAddress: address.streetAddress || '',
        city: address.city || '',
        state: address.state || '',
        zip: address.zip || address.zipCode || '',
        zipCode: address.zipCode || address.zip || '',
        latitude: address.latitude ?? null,
        longitude: address.longitude ?? null,
    });

    const getCustomerDisplayName = () => (
        displayAsCompany
            ? formData.companyName.trim()
            : `${formData.firstName} ${formData.lastName}`.trim()
    );

    const copyCatalogPartsToEquipment = async (equipmentId, catalogEquipmentId, equipment) => {
        if (!catalogEquipmentId || !recentlySelectedCompany) return;

        const partsSnapshot = await getDocs(
            collection(db, 'universal', 'equipment', 'equipment', catalogEquipmentId, 'parts')
        );

        const writes = partsSnapshot.docs.map((partDoc) => {
            const part = partDoc.data();
            const partId = 'com_equ_par_' + uuidv4();

            return setDoc(
                doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId, 'parts', partId),
                {
                    id: partId,
                    name: part.name || '',
                    sku: part.sku || '',
                    make: part.make || equipment.make || '',
                    model: part.model || equipment.model || '',
                    manualPdfLink: part.manualPdfLink || '',
                    universalPartId: part.id || partDoc.id,
                    universalEquipmentId: catalogEquipmentId,
                    createdAt: new Date(),
                }
            );
        });

        await Promise.all(writes);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !lead) return;

        setIsSubmitting(true);
        const toastId = toast.loading('Creating customer and assets...');

        const customerId = 'com_cus_' + uuidv4();
        const serviceLocationId = 'com_sl_' + uuidv4();
        const bodyOfWaterId = 'com_bow_' + uuidv4();
        const equipmentIds = [];

        const serviceAddress = normalizeAddress(lead.serviceLocationAddress);
        const finalBillingAddress = useDifferentBillingAddress ? normalizeAddress(billingAddress) : serviceAddress;
        const customerName = getCustomerDisplayName();

        try {
            // 1. Create Customer
            const customerData = {
                id: customerId,
                createdAt: new Date(),
                firstName: formData.firstName,
                lastName: formData.lastName,
                company: displayAsCompany ? formData.companyName : '',
                displayAsCompany,
                active: true,
                email: formData.email,
                phoneNumber: formData.phone,
                phoneLabel: "",
                billingAddress: finalBillingAddress,
                billingNotes: formData.billingNotes,
                hireDate: new Date(),
                linkedCustomerIds: [],
                linkedInviteId: ""
            };
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', customerId), customerData);

            // 2. Create Service Location (if checked)
            if (addServiceLocation) {
                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocationId), {
                    id: serviceLocationId,
                    nickName: serviceLocationData.nickName,
                    address: serviceAddress,
                    gateCode: serviceLocationData.gateCode,
                    dogName: serviceLocationData.dogName ? [serviceLocationData.dogName] : [],
                    estimatedTime: 15,
                    mainContact: {
                        id: 'com_cus_con_' + uuidv4(),
                        name: customerName,
                        email: formData.email,
                        phoneNumber: formData.phone,
                        notes: '',
                    },
                    notes: serviceLocationData.notes,
                    bodiesOfWaterId: addBodyOfWater ? [bodyOfWaterId] : [],
                    rateType: "",
                    laborType: "",
                    chemicalCost: "",
                    laborCost: "",
                    rate: "",
                    customerId,
                    customerName,
                    backYardTree: [],
                    backYardBushes: [],
                    backYardOther: [],
                    preText: serviceLocationData.preText,
                    verified: false,
                    photoUrls: [],
                    isActive: true,
                });

                // 3. Create Body of Water (if checked)
                if (addBodyOfWater) {
                    await setDoc(doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWaterId), {
                        id: bodyOfWaterId,
                        name: bodyOfWaterData.name,
                        gallons: bodyOfWaterData.gallons,
                        waterType: bodyOfWaterData.waterType || 'Chlorine',
                        material: bodyOfWaterData.material,
                        customerId,
                        serviceLocationId,
                        notes: bodyOfWaterData.notes || '',
                        shape: bodyOfWaterData.shape || '',
                        length: null,
                        depth: null,
                        width: null,
                        photoUrls: [],
                        lastFilled: new Date(),
                        isActive: true,
                    });

                    // 4. Create Equipment (if checked)
                    if (addEquipment) {
                        for (const equip of equipmentData) {
                            if (equip.name) { // Only add if name is present
                                const equipmentId = 'com_equ_' + uuidv4();
                                equipmentIds.push(equipmentId);
                                const catalogEquipmentId = equip.modelId || '';
                                const equipmentRecord = {
                                    id: equipmentId,
                                    name: equip.name,
                                    type: equip.type || '',
                                    typeId: equip.typeId || '',
                                    make: equip.make || '',
                                    makeId: equip.makeId || '',
                                    model: equip.model || '',
                                    modelId: catalogEquipmentId,
                                    universalEquipmentId: catalogEquipmentId,
                                    manualPdfLink: equip.manualPdfLink || '',
                                    dateInstalled: new Date(),
                                    cleanFilterPressure: null,
                                    currentPressure: null,
                                    serviceFrequency: null,
                                    serviceFrequencyEvery: '',
                                    notes: equip.notes || '',
                                    customerId,
                                    customerName,
                                    serviceLocationId,
                                    bodyOfWaterId,
                                    lastServiceDate: null,
                                    nextServiceDate: null,
                                    isActive: true,
                                    needsService: Boolean(equip.needsService),
                                    status: 'Operational',
                                    verified: false,
                                    photoUrls: [],
                                };
                                await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), {
                                    ...equipmentRecord
                                });
                                await copyCatalogPartsToEquipment(equipmentId, catalogEquipmentId, equipmentRecord);
                            }
                        }
                    }
                }
            }

            // 5. Update Lead
            await updateDoc(doc(db, 'homeownerServiceRequests', leadId), {
                customerId,
                customerName,
                serviceLocationId: addServiceLocation ? serviceLocationId : '',
                bodyOfWaterId: addServiceLocation && addBodyOfWater ? bodyOfWaterId : '',
                equipmentIds,
            });
            //6. Update lead to add customerId and customerName

            toast.success('Successfully converted lead to customer!', { id: toastId });
            navigate(`/company/leads/${leadId}`);

        } catch (error) {
            console.error("Error creating customer from lead:", error);
            toast.error('Conversion failed.', { id: toastId });
            setIsSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Create Customer from Lead</h1>
                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-lg space-y-8">

                    {/* Customer Details */}
                    <div className="border-b pb-6">
                        <div className="flex justify-between items-center">
                            <h2 className="text-xl font-bold">Customer Details</h2>
                            <label className="flex items-center"><input type="checkbox" checked={displayAsCompany} onChange={e => setDisplayAsCompany(e.target.checked)} className="mr-2" />Display as Company</label>
                        </div>
                        {displayAsCompany ? (
                            <div><label className="block text-sm font-medium text-gray-700">Company Name</label><input type="text" name="companyName" value={formData.companyName} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" required /></div>
                        ) : (
                            <div className="grid md:grid-cols-2 gap-4 mt-4">
                                <div><label className="block text-sm font-medium">First Name</label><input type="text" name="firstName" value={formData.firstName} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" required /></div>
                                <div><label className="block text-sm font-medium">Last Name</label><input type="text" name="lastName" value={formData.lastName} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" /></div>
                            </div>
                        )}
                        <div className="grid md:grid-cols-2 gap-4 mt-4">
                            <div><label className="block text-sm font-medium">Email</label><input type="email" name="email" value={formData.email} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" required /></div>
                            <div><label className="block text-sm font-medium">Phone</label><input type="tel" name="phone" value={formData.phone} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" /></div>
                        </div>
                        <div className="mt-4"><label className="block text-sm font-medium">Billing Notes</label><textarea name="billingNotes" value={formData.billingNotes} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" /></div>
                        <label className="flex items-center mt-4"><input type="checkbox" checked={useDifferentBillingAddress} onChange={e => setUseDifferentBillingAddress(e.target.checked)} className="mr-2" />Use different billing address</label>
                        {useDifferentBillingAddress && (
                            <div className="mt-2 p-4 border rounded-lg bg-gray-50">
                                <h3 className="font-semibold mb-2">Billing Address</h3>
                                <input type="text" name="streetAddress" placeholder="Street Address" value={billingAddress.streetAddress} onChange={e => handleInputChange(e, setBillingAddress)} className="w-full mt-2 p-2 border rounded-md" required />
                                <div className="grid md:grid-cols-3 gap-4 mt-2">
                                    <input type="text" name="city" placeholder="City" value={billingAddress.city} onChange={e => handleInputChange(e, setBillingAddress)} className="w-full p-2 border rounded-md" required />
                                    <input type="text" name="state" placeholder="State" value={billingAddress.state} onChange={e => handleInputChange(e, setBillingAddress)} className="w-full p-2 border rounded-md" required />
                                    <input type="text" name="zip" placeholder="Zip Code" value={billingAddress.zip} onChange={e => handleInputChange(e, setBillingAddress)} className="w-full p-2 border rounded-md" required />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Service Location, BOW, Equipment */}
                    <div className="border-b pb-6">
                        <label className="flex items-center font-bold"><input type="checkbox" checked={addServiceLocation} onChange={e => setAddServiceLocation(e.target.checked)} className="mr-2 h-5 w-5" />Add Service Location</label>
                        {addServiceLocation && (
                            <div className="pl-6 mt-4 space-y-4">
                                <p className="p-4 bg-blue-50 rounded-lg">Service Address will be pre-filled from the lead: <br /><b>{lead?.serviceLocationAddress?.streetAddress}, {lead?.serviceLocationAddress?.city}</b></p>
                                <div><label className="block text-sm font-medium">Location Nickname</label><input type="text" name="nickName" value={serviceLocationData.nickName} onChange={e => handleInputChange(e, setServiceLocationData)} className="w-full mt-1 p-2 border rounded-md" /></div>

                                <label className="flex items-center font-semibold"><input type="checkbox" checked={addBodyOfWater} onChange={e => setAddBodyOfWater(e.target.checked)} className="mr-2 h-5 w-5" />Add Body of Water</label>
                                {addBodyOfWater && (
                                    <div className="pl-6 mt-2 space-y-4 p-4 border-l-2">
                                        <div><label className="block text-sm font-medium">Pool Name</label><input type="text" name="name" value={bodyOfWaterData.name} onChange={e => handleInputChange(e, setBodyOfWaterData)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                        <div><label className="block text-sm font-medium">Volume (Gallons)</label><input type="number" name="gallons" value={bodyOfWaterData.gallons} onChange={e => handleInputChange(e, setBodyOfWaterData)} className="w-full mt-1 p-2 border rounded-md" /></div>

                                        <label className="flex items-center font-semibold"><input type="checkbox" checked={addEquipment} onChange={e => setAddEquipment(e.target.checked)} className="mr-2 h-5 w-5" />Add Equipment</label>
                                        {addEquipment && (
                                            <div className="pl-6 mt-2 space-y-4 p-4 border-l-2">
                                                {[0, 1].map(index => (
                                                    <div key={index} className="p-2 border rounded-md">
                                                        <h4 className="font-medium mb-1">Equipment #{index + 1}</h4>
                                                        <input placeholder="Name (e.g., Pump)" name="name" value={equipmentData[index].name} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md" />
                                                        <select name="typeId" value={equipmentData[index].typeId} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md">
                                                            <option value="">Select Category</option>
                                                            {equipmentTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                                                        </select>
                                                        <select name="makeId" value={equipmentData[index].makeId} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md">
                                                            <option value="">Select Make</option>
                                                            {equipmentMakes[index]?.map(make => <option key={make.id} value={make.id}>{make.name}</option>)}
                                                        </select>
                                                        <select name="modelId" value={equipmentData[index].modelId} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md">
                                                            <option value="">Select Model</option>
                                                            {equipmentModels[index]?.map(model => <option key={model.id} value={model.id}>{model.model || model.name}</option>)}
                                                        </select>
                                                        <textarea placeholder="Notes" name="notes" value={equipmentData[index].notes} onChange={e => handleEquipmentListChange(index, e)} className="w-full mb-2 p-2 border rounded-md" />
                                                        <label className="flex items-center">
                                                            <input type="checkbox" name="needsService" checked={equipmentData[index].needsService} onChange={e => handleEquipmentListChange(index, e)} className="mr-2 h-4 w-4" />
                                                            Needs Service
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-4">
                        <Link to={`/company/leads/${leadId}`} className="px-4 py-2 mr-3 text-sm font-medium text-gray-700 bg-white border rounded-md shadow-sm hover:bg-gray-50">Cancel</Link>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                            {isSubmitting ? 'Converting...' : 'Convert Lead to Customer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateCustomerFromLead;
