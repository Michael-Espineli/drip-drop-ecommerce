import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import { functions } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import EquipmentCatalogPicker from '../../components/equipment/EquipmentCatalogPicker';

const firstText = (...values) => {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }

    return '';
};

const splitName = (name = '') => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);

    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' '),
    };
};

const getLeadHomeownerId = (lead = {}) => (
    lead.homeownerId ||
    lead.customerUserId ||
    lead.homeownerUserId ||
    lead.userId ||
    ''
);

const getRequesterName = (lead = {}, userProfile = {}) => firstText(
    lead.homeownerName,
    lead.creatorName,
    lead.customerName,
    userProfile.displayName,
    userProfile.name,
    `${userProfile.firstName || ''} ${userProfile.lastName || ''}`
);

const getRequesterEmail = (lead = {}, userProfile = {}) => firstText(
    lead.homeownerEmail,
    lead.creatorEmail,
    lead.customerEmail,
    lead.email,
    userProfile.email
);

const getRequesterPhone = (lead = {}, userProfile = {}) => firstText(
    lead.homeownerPhone,
    lead.creatorPhone,
    lead.customerPhone,
    lead.phoneNumber,
    lead.phone,
    userProfile.phoneNumber,
    userProfile.phone
);

const formatAddress = (address = {}) => [
    address.streetAddress || address.address,
    address.city,
    address.state,
    address.zip || address.zipCode,
].filter(Boolean).join(', ');

const normalizeDogName = (value) => (
    Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '')
);

const mapHomeownerEquipmentToForm = (equipment = {}) => ({
    id: equipment.id || '',
    homeownerEquipmentId: equipment.id || '',
    linkedHomeownerEquipmentId: equipment.id || '',
    sourceHomeownerBodyOfWaterId: equipment.bodyOfWaterId || '',
    name: equipment.name || equipment.category || equipment.type || 'Equipment',
    type: equipment.type || equipment.category || '',
    typeId: equipment.typeId || '',
    make: equipment.make || '',
    makeId: equipment.makeId || '',
    model: equipment.model || '',
    modelId: equipment.modelId || equipment.universalEquipmentId || '',
    universalEquipmentId: equipment.universalEquipmentId || equipment.modelId || '',
    manualPdfLink: equipment.manualPdfLink || '',
    cleanFilterPressure: equipment.cleanFilterPressure ?? null,
    currentPressure: equipment.currentPressure ?? null,
    serviceFrequency: equipment.serviceFrequency ?? null,
    serviceFrequencyEvery: equipment.serviceFrequencyEvery || '',
    dateInstalled: equipment.dateInstalled || null,
    lastServiceDate: equipment.lastServiceDate || null,
    nextServiceDate: equipment.nextServiceDate || null,
    notes: equipment.notes || '',
    needsService: Boolean(equipment.needsService),
    status: equipment.status || 'Operational',
    verified: Boolean(equipment.verified),
    photoUrls: Array.isArray(equipment.photoUrls) ? equipment.photoUrls : [],
});

const defaultBodyOfWaterData = {
    name: 'Main Pool',
    gallons: '15000',
    waterType: 'Chlorine',
    material: 'Plaster',
    notes: '',
};

const defaultEquipmentData = [
    { name: 'Pump', type: 'Pump', typeId: '', make: '', makeId: '', model: '', modelId: '', manualPdfLink: '', notes: '', needsService: false },
    { name: 'Filter', type: 'Filter', typeId: '', make: '', makeId: '', model: '', modelId: '', manualPdfLink: '', notes: '', needsService: true },
];

const blankEquipmentData = {
    name: '',
    type: '',
    typeId: '',
    make: '',
    makeId: '',
    model: '',
    modelId: '',
    universalEquipmentId: '',
    manualPdfLink: '',
    notes: '',
    needsService: false,
};

const mapPublicEquipmentToForm = (equipment = {}) => ({
    ...blankEquipmentData,
    name: equipment.name || equipment.type || '',
    type: equipment.type || equipment.category || '',
    typeId: equipment.typeId || '',
    make: equipment.make || '',
    makeId: equipment.makeId || '',
    model: equipment.model || '',
    modelId: equipment.modelId || equipment.universalEquipmentId || '',
    universalEquipmentId: equipment.universalEquipmentId || equipment.modelId || '',
    manualPdfLink: equipment.manualPdfLink || '',
    notes: equipment.notes || equipment.description || '',
    needsService: Boolean(equipment.needsService),
});

const mapPublicBodyOfWaterToForm = (bodyOfWater = {}, index = 0) => {
    const sizeNotes = [
        bodyOfWater.type ? `Type: ${bodyOfWater.type}` : '',
        bodyOfWater.sizeCategory ? `Size: ${bodyOfWater.sizeCategory}` : '',
        bodyOfWater.condition ? `Condition: ${bodyOfWater.condition}` : '',
    ].filter(Boolean);
    const submittedNotes = bodyOfWater.notes || bodyOfWater.description || '';

    return {
        ...defaultBodyOfWaterData,
        name: bodyOfWater.name || bodyOfWater.type || `Pool / Spa ${index + 1}`,
        gallons: bodyOfWater.gallons || bodyOfWater.volume || '',
        waterType: bodyOfWater.waterType || defaultBodyOfWaterData.waterType,
        material: bodyOfWater.material || bodyOfWater.surface || '',
        notes: [...sizeNotes, submittedNotes].filter(Boolean).join('\n'),
        shape: bodyOfWater.shape || '',
        length: bodyOfWater.length ?? '',
        depth: bodyOfWater.depth ?? '',
        width: bodyOfWater.width ?? '',
    };
};

const mapHomeownerBodyOfWaterToForm = (bodyOfWater = {}) => ({
    id: bodyOfWater.id || '',
    homeownerBodyOfWaterId: bodyOfWater.id || '',
    linkedHomeownerBodyOfWaterId: bodyOfWater.id || '',
    name: bodyOfWater.name || 'Main Pool',
    gallons: bodyOfWater.gallons || '',
    waterType: bodyOfWater.waterType || 'Chlorine',
    material: bodyOfWater.material || '',
    notes: bodyOfWater.notes || '',
    shape: bodyOfWater.shape || '',
    length: bodyOfWater.length ?? '',
    depth: bodyOfWater.depth ?? '',
    width: bodyOfWater.width ?? '',
});

const createBodyOfWaterEntry = ({ data = {}, equipmentData = [] } = {}) => ({
    data: {
        ...defaultBodyOfWaterData,
        ...data,
    },
    equipmentData: equipmentData.length ? equipmentData : [],
});

const CreateCustomerFromLead = () => {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [homeownerAssets, setHomeownerAssets] = useState({
        serviceLocation: null,
        bodyOfWater: null,
        bodiesOfWater: [],
        equipment: [],
        previewLoaded: false,
    });
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
    const [bodyOfWaterEntries, setBodyOfWaterEntries] = useState([
        createBodyOfWaterEntry({ equipmentData: defaultEquipmentData })
    ]);
    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) return;
        const fetchLead = async () => {
            setLoading(true);
            const leadRef = doc(db, 'homeownerServiceRequests', leadId);
            try {
                const docSnap = await getDoc(leadRef);
                if (docSnap.exists()) {
                    const leadData = { id: docSnap.id, ...docSnap.data() };
                    const homeownerId = getLeadHomeownerId(leadData);
                    let requesterProfile = {};

                    if (homeownerId) {
                        try {
                            const userSnap = await getDoc(doc(db, 'users', homeownerId));
                            requesterProfile = userSnap.exists() ? userSnap.data() : {};
                        } catch (profileError) {
                            console.warn('Unable to load homeowner profile for lead conversion preview.', profileError);
                        }
                    }

                    const enhancedLead = { ...leadData, requesterProfile };
                    setLead(enhancedLead);

                    const requesterName = getRequesterName(leadData, requesterProfile);
                    const nameParts = splitName(requesterName);
                    setFormData({
                        firstName: leadData.firstName || nameParts.firstName,
                        lastName: leadData.lastName || nameParts.lastName,
                        email: getRequesterEmail(leadData, requesterProfile),
                        phone: getRequesterPhone(leadData, requesterProfile),
                        companyName: '', billingNotes: ''
                    });

                    const assets = {
                        serviceLocation: null,
                        bodyOfWater: null,
                        bodiesOfWater: [],
                        equipment: [],
                        previewLoaded: true,
                    };

                    try {
                        const homeownerServiceLocationId = leadData.homeownerServiceLocationId || leadData.serviceLocationId || '';
                        const homeownerBodyOfWaterIds = [
                            leadData.homeownerBodyOfWaterId,
                            ...(Array.isArray(leadData.homeownerBodyOfWaterIds) ? leadData.homeownerBodyOfWaterIds : []),
                        ].filter(Boolean);
                        const homeownerEquipmentIds = [
                            leadData.homeownerEquipmentId,
                            ...(Array.isArray(leadData.homeownerEquipmentIds) ? leadData.homeownerEquipmentIds : []),
                        ].filter(Boolean);

                        if (homeownerServiceLocationId) {
                            const locationSnap = await getDoc(doc(db, 'homeownerServiceLocations', homeownerServiceLocationId));
                            if (locationSnap.exists()) {
                                assets.serviceLocation = { id: locationSnap.id, ...locationSnap.data() };
                                setServiceLocationData((prev) => ({
                                    ...prev,
                                    nickName: assets.serviceLocation.nickName || assets.serviceLocation.name || prev.nickName,
                                    gateCode: assets.serviceLocation.gateCode || prev.gateCode,
                                    dogName: normalizeDogName(assets.serviceLocation.dogName) || prev.dogName,
                                    notes: assets.serviceLocation.notes || prev.notes,
                                    preText: Boolean(assets.serviceLocation.preText),
                                }));
                            }
                        }

                        if (homeownerBodyOfWaterIds.length) {
                            const bodyDocs = await Promise.all(
                                [...new Set(homeownerBodyOfWaterIds)].map(async (bodyId) => {
                                    const bodySnap = await getDoc(doc(db, 'homeownerBodiesOfWater', bodyId));
                                    return bodySnap.exists() ? { id: bodySnap.id, ...bodySnap.data() } : null;
                                })
                            );
                            assets.bodiesOfWater = bodyDocs.filter(Boolean);
                            assets.bodyOfWater = assets.bodiesOfWater[0] || null;
                        }

                        if (homeownerEquipmentIds.length) {
                            const equipmentDocs = await Promise.all(
                                [...new Set(homeownerEquipmentIds)].map(async (equipmentId) => {
                                    const equipmentSnap = await getDoc(doc(db, 'homeownerEquipment', equipmentId));
                                    return equipmentSnap.exists() ? { id: equipmentSnap.id, ...equipmentSnap.data() } : null;
                                })
                            );
                            assets.equipment = equipmentDocs.filter(Boolean);
                        } else if (homeownerBodyOfWaterIds.length) {
                            const equipmentSnapshots = await Promise.all(
                                [...new Set(homeownerBodyOfWaterIds)].map((bodyId) => {
                                    const equipmentQuery = query(
                                        collection(db, 'homeownerEquipment'),
                                        where('bodyOfWaterId', '==', bodyId),
                                        where('userId', '==', homeownerId)
                                    );
                                    return getDocs(equipmentQuery);
                                })
                            );
                            assets.equipment = equipmentSnapshots.flatMap((equipmentSnap) => (
                                equipmentSnap.docs.map(equipmentDoc => ({ id: equipmentDoc.id, ...equipmentDoc.data() }))
                            ));
                        }

                        const publicIntake = leadData.publicLeadIntake || leadData.leadIntake || {};
                        const publicBodiesOfWater = Array.isArray(publicIntake.bodiesOfWater)
                            ? publicIntake.bodiesOfWater
                            : [];
                        const publicEquipment = Array.isArray(publicIntake.equipment)
                            ? publicIntake.equipment
                            : [];

                        if (assets.bodiesOfWater.length) {
                            setAddEquipment(assets.equipment.length > 0);
                            setAddBodyOfWater(true);
                            setBodyOfWaterEntries(
                                assets.bodiesOfWater.map((bodyOfWater, bodyIndex) => {
                                    const bodyEquipment = assets.equipment
                                        .filter((equipment) => (
                                            equipment.bodyOfWaterId === bodyOfWater.id ||
                                            (!equipment.bodyOfWaterId && bodyIndex === 0)
                                        ))
                                        .map(mapHomeownerEquipmentToForm);

                                    return createBodyOfWaterEntry({
                                        data: mapHomeownerBodyOfWaterToForm(bodyOfWater),
                                        equipmentData: bodyEquipment,
                                    });
                                })
                            );
                        } else if (publicBodiesOfWater.length) {
                            const entries = publicBodiesOfWater.map((bodyOfWater, bodyIndex) => {
                                const bodyEquipment = Array.isArray(bodyOfWater.equipment)
                                    ? bodyOfWater.equipment.map(mapPublicEquipmentToForm)
                                    : [];

                                return createBodyOfWaterEntry({
                                    data: mapPublicBodyOfWaterToForm(bodyOfWater, bodyIndex),
                                    equipmentData: bodyEquipment,
                                });
                            });
                            const hasPublicEquipment = entries.some((entry) => entry.equipmentData.length > 0);
                            setAddBodyOfWater(true);
                            setAddEquipment(hasPublicEquipment);
                            setBodyOfWaterEntries(entries);
                        } else if (assets.equipment.length) {
                            const importedEquipment = assets.equipment.map(mapHomeownerEquipmentToForm);
                            setAddEquipment(true);
                            setBodyOfWaterEntries([
                                createBodyOfWaterEntry({ equipmentData: importedEquipment })
                            ]);
                        } else if (publicEquipment.length) {
                            const importedEquipment = publicEquipment.map(mapPublicEquipmentToForm);
                            setAddBodyOfWater(true);
                            setAddEquipment(true);
                            setBodyOfWaterEntries([
                                createBodyOfWaterEntry({ equipmentData: importedEquipment })
                            ]);
                        }
                    } catch (assetError) {
                        console.warn('Unable to load homeowner pool data for lead conversion preview. The callable will still import it when possible.', assetError);
                    } finally {
                        setHomeownerAssets(assets);
                    }
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

    const handleInputChange = (e, setter, nestedField) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;
        if (setter) {
            setter(prev => nestedField ? { ...prev, [nestedField]: { ...prev[nestedField], [name]: val } } : { ...prev, [name]: val });
        } else {
            setFormData(prev => ({ ...prev, [name]: val }));
        }
    };

    const handleAddBodyOfWaterToggle = (checked) => {
        setAddBodyOfWater(checked);
        if (checked && !bodyOfWaterEntries.length) {
            setBodyOfWaterEntries([createBodyOfWaterEntry()]);
        }
        if (!checked) {
            setAddEquipment(false);
        }
    };

    const handleAddEquipmentToggle = (checked) => {
        setAddEquipment(checked);
        if (checked) {
            setAddBodyOfWater(true);
            setBodyOfWaterEntries((currentEntries) => {
                const entries = currentEntries.length ? currentEntries : [createBodyOfWaterEntry()];
                const hasEquipment = entries.some((entry) => entry.equipmentData.length > 0);
                if (hasEquipment) return entries;

                return entries.map((entry, index) => (
                    index === 0
                        ? { ...entry, equipmentData: [...defaultEquipmentData] }
                        : entry
                ));
            });
        }
    };

    const addBodyOfWaterEntry = () => {
        setAddBodyOfWater(true);
        setBodyOfWaterEntries((currentEntries) => ([
            ...currentEntries,
            createBodyOfWaterEntry({
                data: {
                    ...defaultBodyOfWaterData,
                    name: `Pool / Spa ${currentEntries.length + 1}`,
                    gallons: '',
                    material: '',
                },
            }),
        ]));
    };

    const removeBodyOfWaterEntry = (bodyIndex) => {
        if (bodyOfWaterEntries.length <= 1) {
            setAddBodyOfWater(false);
            setAddEquipment(false);
        }

        setBodyOfWaterEntries((currentEntries) => (
            currentEntries.filter((_, index) => index !== bodyIndex)
        ));
    };

    const handleBodyOfWaterChange = (bodyIndex, e) => {
        const { name, value } = e.target;
        setBodyOfWaterEntries((currentEntries) => currentEntries.map((entry, index) => (
            index === bodyIndex
                ? {
                    ...entry,
                    data: {
                        ...entry.data,
                        [name]: value,
                    },
                }
                : entry
        )));
    };

    const addEquipmentToBody = (bodyIndex) => {
        setAddEquipment(true);
        setBodyOfWaterEntries((currentEntries) => currentEntries.map((entry, index) => (
            index === bodyIndex
                ? {
                    ...entry,
                    equipmentData: [
                        ...entry.equipmentData,
                        { ...blankEquipmentData },
                    ],
                }
                : entry
        )));
    };

    const removeEquipmentFromBody = (bodyIndex, equipmentIndex) => {
        const currentEquipmentCount = bodyOfWaterEntries.reduce(
            (count, entry) => count + entry.equipmentData.length,
            0
        );

        if (currentEquipmentCount <= 1) {
            setAddEquipment(false);
        }

        setBodyOfWaterEntries((currentEntries) => currentEntries.map((entry, index) => (
            index === bodyIndex
                ? {
                    ...entry,
                    equipmentData: entry.equipmentData.filter((_, currentEquipmentIndex) => (
                        currentEquipmentIndex !== equipmentIndex
                    )),
                }
                : entry
        )));
    };

    const handleEquipmentListChange = (bodyIndex, equipmentIndex, e) => {
        const { name, value, type, checked } = e.target;
        const fieldValue = type === 'checkbox' ? checked : value;

        setBodyOfWaterEntries((currentEntries) => currentEntries.map((entry, index) => {
            if (index !== bodyIndex) return entry;

            const nextEquipmentData = entry.equipmentData.map((equipment, currentEquipmentIndex) => {
                if (currentEquipmentIndex !== equipmentIndex) return equipment;

                return { ...equipment, [name]: fieldValue };
            });

            return {
                ...entry,
                equipmentData: nextEquipmentData,
            };
        }));
    };

    const handleEquipmentCatalogChange = (bodyIndex, equipmentIndex, nextCatalogEquipment) => {
        setBodyOfWaterEntries((currentEntries) => currentEntries.map((entry, index) => {
            if (index !== bodyIndex) return entry;

            return {
                ...entry,
                equipmentData: entry.equipmentData.map((equipment, currentEquipmentIndex) => (
                    currentEquipmentIndex === equipmentIndex
                        ? { ...equipment, ...nextCatalogEquipment }
                        : equipment
                )),
            };
        }));
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !lead) return;

        setIsSubmitting(true);
        const toastId = toast.loading('Creating customer and assets...');

        try {
            if (!recentlySelectedCompany) {
                throw new Error('Please select a company before converting this lead.');
            }

            const authPayload = await getCallableAuthPayload();
            const convertLead = httpsCallable(functions, 'convertHomeownerServiceRequestToCompanyCustomer');
            const bodyOfWaterEntriesPayload = addBodyOfWater
                ? bodyOfWaterEntries.map((entry) => ({
                    ...entry.data,
                    equipmentData: addEquipment ? entry.equipmentData : [],
                }))
                : [];
            const primaryBodyOfWaterEntry = bodyOfWaterEntriesPayload[0] || {};
            const result = await convertLead({
                ...authPayload,
                auth: authPayload,
                companyId: recentlySelectedCompany,
                leadId,
                displayAsCompany,
                useDifferentBillingAddress,
                formData,
                billingAddress: normalizeAddress(billingAddress),
                serviceLocationData,
                bodyOfWaterData: primaryBodyOfWaterEntry,
                equipmentData: primaryBodyOfWaterEntry.equipmentData || [],
                bodyOfWaterEntries: bodyOfWaterEntriesPayload,
                addServiceLocation,
                addBodyOfWater,
                addEquipment,
            });

            const response = result.data || {};
            if (response.status && response.status !== 200) {
                throw new Error(response.error || 'Conversion failed.');
            }

            toast.success('Successfully converted lead to customer!', { id: toastId });
            navigate(`/company/leads/${leadId}`);

        } catch (error) {
            console.error("Error creating customer from lead:", error);
            toast.error(error.message || 'Conversion failed.', { id: toastId });
            setIsSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;

    const requesterProfile = lead?.requesterProfile || {};
    const requesterName = getRequesterName(lead, requesterProfile);
    const requesterEmail = getRequesterEmail(lead, requesterProfile);
    const requesterPhone = getRequesterPhone(lead, requesterProfile);
    const sourceAddress = homeownerAssets.serviceLocation?.address || lead?.serviceLocationAddress || {};
    const sourceAddressText = formatAddress(sourceAddress);
    const publicIntake = lead?.publicLeadIntake || lead?.leadIntake || {};
    const publicBodiesOfWater = Array.isArray(publicIntake.bodiesOfWater) ? publicIntake.bodiesOfWater : [];
    const publicEquipment = Array.isArray(publicIntake.equipment) ? publicIntake.equipment : [];
    const sourceBodiesOfWater = homeownerAssets.bodiesOfWater?.length
        ? homeownerAssets.bodiesOfWater
        : homeownerAssets.bodyOfWater
            ? [homeownerAssets.bodyOfWater]
            : publicBodiesOfWater;
    const sourceEquipment = homeownerAssets.equipment?.length
        ? homeownerAssets.equipment
        : publicEquipment.length
            ? publicEquipment
            : publicBodiesOfWater.flatMap((body) => Array.isArray(body.equipment) ? body.equipment : []);
    const hasHomeownerServiceLocation = Boolean(homeownerAssets.serviceLocation);
    const hasHomeownerBodyOfWater = sourceBodiesOfWater.length > 0;
    const hasHomeownerEquipment = sourceEquipment.length > 0;
    const hasLinkedHomeownerBodyOfWater = homeownerAssets.bodiesOfWater?.length > 0 || Boolean(homeownerAssets.bodyOfWater);
    const hasLinkedHomeownerEquipment = homeownerAssets.equipment?.length > 0;
    const serviceLocationCopyLabel = hasHomeownerServiceLocation
        ? 'Copy homeowner service location into company account'
        : 'Create company service location from lead address';
    const bodyOfWaterCopyLabel = hasHomeownerBodyOfWater
        ? `${hasLinkedHomeownerBodyOfWater ? 'Copy' : 'Use'} ${sourceBodiesOfWater.length} ${hasLinkedHomeownerBodyOfWater ? 'homeowner' : 'submitted'} body of water record${sourceBodiesOfWater.length === 1 ? '' : 's'} in the company account`
        : 'Add company body of water manually';
    const equipmentCopyLabel = hasHomeownerEquipment
        ? `${hasLinkedHomeownerEquipment ? 'Copy' : 'Use'} ${sourceEquipment.length} ${hasLinkedHomeownerEquipment ? 'homeowner' : 'submitted'} equipment record${sourceEquipment.length === 1 ? '' : 's'} in the company account`
        : 'Add company equipment manually';

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Create Customer from Lead</h1>

                <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Submitted customer data</p>
                            <h2 className="mt-1 text-xl font-bold text-gray-900">{requesterName || 'Homeowner request'}</h2>
                            <p className="mt-1 text-sm text-gray-700">
                                This information comes from the homeowner service request and will be used to pre-fill the company customer record. Checked pool sections below create linked company-side copies; they do not edit the homeowner's original records.
                            </p>
                        </div>
                        <div className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-blue-700">
                            {lead?.source || 'Lead'} lead
                        </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contact</p>
                            <p className="mt-2 text-sm text-gray-900">{requesterName || 'No name submitted'}</p>
                            <p className="mt-1 text-sm text-gray-700 break-words">{requesterEmail || 'No email submitted'}</p>
                            <p className="mt-1 text-sm text-gray-700">{requesterPhone || 'No phone submitted'}</p>
                        </div>

                        <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Property</p>
                            <p className="mt-2 text-sm text-gray-900">{sourceAddressText || 'No service address submitted'}</p>
                            {(publicIntake.treeTypes || publicIntake.treeDebrisLevel || publicIntake.overhangingTrees) && (
                                <p className="mt-1 text-sm text-gray-700">
                                    Trees: {[publicIntake.treeTypes, publicIntake.treeDebrisLevel ? `${publicIntake.treeDebrisLevel} debris` : '', publicIntake.overhangingTrees].filter(Boolean).join(' / ')}
                                </p>
                            )}
                            {sourceBodiesOfWater.length > 0 && (
                                <p className="mt-1 text-sm text-gray-700">
                                    Bodies of water: {sourceBodiesOfWater.map(body => body.name || 'Pool / Spa').join(', ')}
                                </p>
                            )}
                            {sourceEquipment.length > 0 && (
                                <p className="mt-1 text-sm text-gray-700">
                                    Equipment: {sourceEquipment.map(equipment => equipment.name || equipment.category || equipment.type || 'Equipment').join(', ')}
                                </p>
                            )}
                        </div>
                    </div>

                    {lead?.serviceDescription && (
                        <div className="mt-4 rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Shared request description</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{lead.serviceDescription}</p>
                        </div>
                    )}
                </div>

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
                            <div><label className="block text-sm font-medium">Email <span className="text-xs font-normal text-gray-500">(optional)</span></label><input type="email" name="email" value={formData.email} onChange={handleInputChange} className="w-full mt-1 p-2 border rounded-md" /></div>
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
                        <label className="flex items-center font-bold"><input type="checkbox" checked={addServiceLocation} onChange={e => setAddServiceLocation(e.target.checked)} className="mr-2 h-5 w-5" />{serviceLocationCopyLabel}</label>
                        {addServiceLocation && (
                            <div className="pl-6 mt-4 space-y-4">
                                <p className="p-4 bg-blue-50 rounded-lg">
                                    {hasHomeownerServiceLocation
                                        ? 'A linked service location was found on the homeowner account and will be copied into the company account.'
                                        : 'No linked homeowner service location was found, so this will create a company location from the submitted lead address.'}
                                    <br />
                                    <b>{sourceAddressText || 'No service address submitted'}</b>
                                </p>
                                <div><label className="block text-sm font-medium">Location Nickname</label><input type="text" name="nickName" value={serviceLocationData.nickName} onChange={e => handleInputChange(e, setServiceLocationData)} className="w-full mt-1 p-2 border rounded-md" /></div>

                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <label className="flex items-center font-semibold"><input type="checkbox" checked={addBodyOfWater} onChange={e => handleAddBodyOfWaterToggle(e.target.checked)} className="mr-2 h-5 w-5" />{bodyOfWaterCopyLabel}</label>
                                    <button
                                        type="button"
                                        onClick={addBodyOfWaterEntry}
                                        className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                                    >
                                        + Add Body of Water
                                    </button>
                                </div>
                                {addBodyOfWater && (
                                    <div className="pl-6 mt-2 space-y-4 p-4 border-l-2">
                                        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                                            {hasHomeownerBodyOfWater
                                                ? hasLinkedHomeownerBodyOfWater
                                                    ? 'Body of water fields are pre-filled from the homeowner account and will be saved as company-side copies linked back to homeowner records when available.'
                                                    : 'Body of water fields are pre-filled from the public request form and will be saved as company-side records.'
                                                : 'This body of water is being added as a new company-side record because no pool or spa was attached to the lead.'}
                                        </p>
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <label className="flex items-center font-semibold"><input type="checkbox" checked={addEquipment} onChange={e => handleAddEquipmentToggle(e.target.checked)} className="mr-2 h-5 w-5" />{equipmentCopyLabel}</label>
                                        </div>

                                        {bodyOfWaterEntries.map((entry, bodyIndex) => (
                                            <div key={`body-${bodyIndex}`} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                    <div>
                                                        <h4 className="font-semibold text-gray-900">Body of Water #{bodyIndex + 1}</h4>
                                                        <p className="text-sm text-gray-600">
                                                            {sourceBodiesOfWater[bodyIndex]
                                                                ? `${hasLinkedHomeownerBodyOfWater ? 'Copied from homeowner record' : 'Submitted on public form'}: ${sourceBodiesOfWater[bodyIndex].name || 'Pool / Spa'}`
                                                                : 'New company-side body of water.'}
                                                        </p>
                                                    </div>
                                                    {bodyOfWaterEntries.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeBodyOfWaterEntry(bodyIndex)}
                                                            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>

                                                <div><label className="block text-sm font-medium">Pool / Spa Name</label><input type="text" name="name" value={entry.data.name} onChange={e => handleBodyOfWaterChange(bodyIndex, e)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                                <div className="grid gap-4 md:grid-cols-3">
                                                    <div><label className="block text-sm font-medium">Volume (Gallons)</label><input type="number" name="gallons" value={entry.data.gallons} onChange={e => handleBodyOfWaterChange(bodyIndex, e)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                                    <div><label className="block text-sm font-medium">Water Type</label><input type="text" name="waterType" value={entry.data.waterType || ''} onChange={e => handleBodyOfWaterChange(bodyIndex, e)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                                    <div><label className="block text-sm font-medium">Material</label><input type="text" name="material" value={entry.data.material || ''} onChange={e => handleBodyOfWaterChange(bodyIndex, e)} className="w-full mt-1 p-2 border rounded-md" /></div>
                                                </div>
                                                <div><label className="block text-sm font-medium">Notes</label><textarea name="notes" value={entry.data.notes || ''} onChange={e => handleBodyOfWaterChange(bodyIndex, e)} className="w-full mt-1 p-2 border rounded-md" /></div>

                                                {addEquipment && (
                                                    <div className="space-y-4 border-t border-gray-200 pt-4">
                                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                            <p className="text-sm text-gray-700">
                                                                {entry.equipmentData.length
                                                                    ? `${entry.equipmentData.length} equipment record${entry.equipmentData.length === 1 ? '' : 's'} for this body of water.`
                                                                    : 'No equipment added for this body of water yet.'}
                                                            </p>
                                                            <button
                                                                type="button"
                                                                onClick={() => addEquipmentToBody(bodyIndex)}
                                                                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                                                            >
                                                                + Add Equipment
                                                            </button>
                                                        </div>

                                                        {entry.equipmentData.map((equipment, equipmentIndex) => (
                                                                <div key={`equipment-${bodyIndex}-${equipmentIndex}`} className="rounded-md border border-gray-200 p-3">
                                                                    <div className="mb-2 flex items-center justify-between gap-3">
                                                                        <h5 className="font-medium">Equipment #{equipmentIndex + 1}</h5>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removeEquipmentFromBody(bodyIndex, equipmentIndex)}
                                                                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    </div>
                                                                    <input placeholder="Name (e.g., Pump)" name="name" value={equipment.name} onChange={e => handleEquipmentListChange(bodyIndex, equipmentIndex, e)} className="w-full mb-2 p-2 border rounded-md" />
                                                                    <EquipmentCatalogPicker
                                                                        value={equipment}
                                                                        onChange={(nextCatalogEquipment) => handleEquipmentCatalogChange(bodyIndex, equipmentIndex, nextCatalogEquipment)}
                                                                        onModelSelected={(selectedModel) => {
                                                                            if (!equipment.name?.trim()) {
                                                                                handleEquipmentCatalogChange(bodyIndex, equipmentIndex, {
                                                                                    ...equipment,
                                                                                    model: selectedModel.model || selectedModel.name || '',
                                                                                    modelId: selectedModel.id || '',
                                                                                    universalEquipmentId: selectedModel.id || '',
                                                                                    manualPdfLink: selectedModel.manualPdfLink || '',
                                                                                    name: selectedModel.name || selectedModel.model || '',
                                                                                });
                                                                            }
                                                                        }}
                                                                        inputClassName="w-full rounded-md border p-2 text-sm"
                                                                        labelClassName="block text-xs font-semibold uppercase text-gray-500 mb-1"
                                                                        gridClassName="grid grid-cols-1 gap-2 md:grid-cols-3"
                                                                    />
                                                                    <textarea placeholder="Notes" name="notes" value={equipment.notes} onChange={e => handleEquipmentListChange(bodyIndex, equipmentIndex, e)} className="w-full mb-2 p-2 border rounded-md" />
                                                                    <label className="flex items-center">
                                                                        <input type="checkbox" name="needsService" checked={equipment.needsService} onChange={e => handleEquipmentListChange(bodyIndex, equipmentIndex, e)} className="mr-2 h-4 w-4" />
                                                                        Needs Service
                                                                    </label>
                                                                </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
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
