import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';

const DEFAULT_EQUIPMENT = [
    {
        name: 'Pump 1',
        type: 'Pump',
        typeId: 'qr1d9eefis1VNdIyX6Xq',
        needsService: false,
        serviceFrequency: '',
        serviceFrequencyEvery: '',
    },
    {
        name: 'Filter 1',
        type: 'Filter',
        typeId: 'BYpNgrzHyVjIMQFAiFyO',
        needsService: true,
        serviceFrequency: 6,
        serviceFrequencyEvery: 'Month',
    },
];

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const Field = ({ label, children }) => (
    <label className="space-y-1">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {children}
    </label>
);

const CreateBodyOfWater = () => {
    const { customerId: customerIdParam, serviceLocationId: serviceLocationIdParam } = useParams();
    const { recentlySelectedCompany } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const navigate = useNavigate();

    const [customers, setCustomers] = useState([]);
    const [locations, setLocations] = useState([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState(customerIdParam || '');
    const [selectedLocationId, setSelectedLocationId] = useState(serviceLocationIdParam || '');
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedLocation, setSelectedLocation] = useState(null);

    const [name, setName] = useState('Main');
    const [gallons, setGallons] = useState('16000');
    const [material, setMaterial] = useState('Plaster');
    const [shape, setShape] = useState('');
    const [waterType, setWaterType] = useState('Chlorine');
    const [lastFilled, setLastFilled] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');
    const [createDefaultEquipment, setCreateDefaultEquipment] = useState(true);
    const [loading, setLoading] = useState(false);
    const [contextLoading, setContextLoading] = useState(true);

    const customerName = useMemo(() => {
        if (selectedCustomer?.displayAsCompany) return selectedCustomer.companyName || 'Customer';
        const fullName = `${selectedCustomer?.firstName || ''} ${selectedCustomer?.lastName || ''}`.trim();
        return fullName || selectedLocation?.customerName || 'Customer';
    }, [selectedCustomer, selectedLocation]);

    useEffect(() => {
        const loadCustomers = async () => {
            if (!recentlySelectedCompany || customerIdParam) return;

            const customersQuery = query(
                collection(db, 'companies', recentlySelectedCompany, 'customers'),
                where('active', '==', true),
                orderBy('firstName')
            );
            const snapshot = await getDocs(customersQuery);
            setCustomers(snapshot.docs.map((customerDoc) => ({
                id: customerDoc.id,
                ...customerDoc.data(),
            })));
        };

        loadCustomers();
    }, [customerIdParam, recentlySelectedCompany]);

    useEffect(() => {
        const loadContext = async () => {
            if (!recentlySelectedCompany) return;
            setContextLoading(true);

            try {
                if (selectedCustomerId) {
                    const customerSnap = await getDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', selectedCustomerId));
                    setSelectedCustomer(customerSnap.exists() ? { id: customerSnap.id, ...customerSnap.data() } : null);
                } else {
                    setSelectedCustomer(null);
                }

                if (selectedCustomerId && !serviceLocationIdParam) {
                    const locationsQuery = query(
                        collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),
                        where('customerId', '==', selectedCustomerId)
                    );
                    const snapshot = await getDocs(locationsQuery);
                    const nextLocations = snapshot.docs.map((locationDoc) => ({
                        id: locationDoc.id,
                        ...locationDoc.data(),
                    }));
                    setLocations(nextLocations);

                    if (!selectedLocationId && nextLocations.length > 0) {
                        setSelectedLocationId(nextLocations[0].id);
                    }
                }

                if (selectedLocationId) {
                    const locationSnap = await getDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', selectedLocationId));
                    setSelectedLocation(locationSnap.exists() ? { id: locationSnap.id, ...locationSnap.data() } : null);
                } else {
                    setSelectedLocation(null);
                }
            } catch (error) {
                console.error(error);
                toast.error('Unable to load customer/location context.');
            } finally {
                setContextLoading(false);
            }
        };

        loadContext();
    }, [recentlySelectedCompany, selectedCustomerId, selectedLocationId, serviceLocationIdParam]);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!requirePermission('52', 'create bodies of water')) return;

        if (!recentlySelectedCompany) {
            toast.error('No company selected.');
            return;
        }

        if (!selectedCustomerId || !selectedLocationId) {
            toast.error('Select a customer and service location.');
            return;
        }

        if (!name.trim()) {
            toast.error('Body of water name is required.');
            return;
        }

        setLoading(true);
        const toastId = toast.loading('Creating body of water...');

        try {
            const bodyOfWaterId = `com_bow_${uuidv4()}`;
            const serviceLocationRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', selectedLocationId);

            const bodyOfWater = {
                id: bodyOfWaterId,
                name: name.trim(),
                gallons,
                material,
                shape,
                waterType,
                notes,
                customerId: selectedCustomerId,
                serviceLocationId: selectedLocationId,
                lastFilled: lastFilled ? new Date(lastFilled) : new Date(),
                photoUrls: [],
                isActive: true,
            };

            await setDoc(
                doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWaterId),
                bodyOfWater
            );

            await updateDoc(serviceLocationRef, {
                bodiesOfWaterId: arrayUnion(bodyOfWaterId),
            });

            if (createDefaultEquipment) {
                await Promise.all(DEFAULT_EQUIPMENT.map((equipment) => {
                    const equipmentId = `com_equ_${uuidv4()}`;
                    return setDoc(
                        doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId),
                        {
                            id: equipmentId,
                            name: equipment.name,
                            type: equipment.type,
                            typeId: equipment.typeId,
                            make: '',
                            makeId: '',
                            model: '',
                            modelId: '',
                            universalEquipmentId: '',
                            manualPdfLink: '',
                            notes: '',
                            customerId: selectedCustomerId,
                            customerName,
                            serviceLocationId: selectedLocationId,
                            bodyOfWaterId,
                            dateInstalled: new Date(),
                            active: true,
                            isActive: true,
                            needsService: equipment.needsService,
                            lastServiceDate: equipment.needsService ? new Date() : null,
                            nextServiceDate: null,
                            serviceFrequency: equipment.serviceFrequency,
                            serviceFrequencyEvery: equipment.serviceFrequencyEvery,
                            cleanFilterPressure: null,
                            currentPressure: null,
                            status: 'Operational',
                            verified: false,
                        }
                    );
                }));
            }

            toast.success('Body of water created.', { id: toastId });
            navigate(`/company/bodiesOfWater/detail/${bodyOfWaterId}`);
        } catch (error) {
            console.error('Error creating body of water: ', error);
            toast.error('Failed to create body of water.', { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
            <div className="w-full space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <Link
                            to={selectedCustomerId ? `/company/customers/details/${selectedCustomerId}/locations` : '/company/bodiesOfWater'}
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back
                        </Link>
                        <h1 className="mt-2 text-3xl font-bold text-slate-950">Create Body of Water</h1>
                        <p className="mt-1 text-sm text-slate-500">
                            Add a body of water to a service location and seed the standard equipment.
                        </p>
                    </div>

                    <Link
                        to={selectedCustomerId ? `/company/customers/details/${selectedCustomerId}/locations` : '/company/bodiesOfWater'}
                        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                        Cancel
                    </Link>
                </div>

                <form onSubmit={handleCreate} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-6">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4">
                                <h2 className="text-lg font-bold text-slate-950">Owner Details</h2>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                {!customerIdParam && (
                                    <Field label="Customer">
                                        <select
                                            value={selectedCustomerId}
                                            onChange={(event) => {
                                                setSelectedCustomerId(event.target.value);
                                                setSelectedLocationId('');
                                            }}
                                            className={inputClass}
                                        >
                                            <option value="">Select customer...</option>
                                            {customers.map((customer) => (
                                                <option key={customer.id} value={customer.id}>
                                                    {customer.displayAsCompany
                                                        ? customer.companyName
                                                        : `${customer.firstName || ''} ${customer.lastName || ''}`.trim()}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                )}

                                {!serviceLocationIdParam && (
                                    <Field label="Service Location">
                                        <select
                                            value={selectedLocationId}
                                            onChange={(event) => setSelectedLocationId(event.target.value)}
                                            className={inputClass}
                                            disabled={!selectedCustomerId || contextLoading}
                                        >
                                            <option value="">Select service location...</option>
                                            {locations.map((location) => (
                                                <option key={location.id} value={location.id}>
                                                    {location.nickName || location.address?.streetAddress || 'Service Location'}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                )}

                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">{customerName}</p>
                                </div>

                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service Location</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">
                                        {selectedLocation?.nickName || selectedLocation?.address?.streetAddress || 'Select a location'}
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4">
                                <h2 className="text-lg font-bold text-slate-950">Body of Water Details</h2>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Name">
                                    <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required />
                                </Field>

                                <Field label="Gallons">
                                    <input value={gallons} onChange={(event) => setGallons(event.target.value)} className={inputClass} inputMode="numeric" />
                                </Field>

                                <Field label="Water Type">
                                    <select value={waterType} onChange={(event) => setWaterType(event.target.value)} className={inputClass}>
                                        <option value="Chlorine">Chlorine</option>
                                        <option value="Salt">Salt</option>
                                        <option value="Bromine">Bromine</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </Field>

                                <Field label="Material">
                                    <input value={material} onChange={(event) => setMaterial(event.target.value)} className={inputClass} />
                                </Field>

                                <Field label="Shape">
                                    <select value={shape} onChange={(event) => setShape(event.target.value)} className={inputClass}>
                                        <option value="">Not specified</option>
                                        <option value="Rectangle">Rectangle</option>
                                        <option value="Square">Square</option>
                                        <option value="Kidney">Kidney</option>
                                        <option value="Circular">Circular</option>
                                    </select>
                                </Field>

                                <Field label="Last Filled">
                                    <input type="date" value={lastFilled} onChange={(event) => setLastFilled(event.target.value)} className={inputClass} />
                                </Field>

                                <div className="md:col-span-2">
                                    <Field label="Notes">
                                        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className={inputClass} />
                                    </Field>
                                </div>
                            </div>
                        </section>
                    </div>

                    <aside className="space-y-6">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-950">Default Equipment</h2>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={createDefaultEquipment}
                                    onChange={(event) => setCreateDefaultEquipment(event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                            </div>

                            <div className="space-y-3">
                                {DEFAULT_EQUIPMENT.map((equipment) => (
                                    <div key={equipment.type} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-slate-900">{equipment.name}</p>
                                                <p className="text-sm text-slate-500">{equipment.type}</p>
                                            </div>
                                            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                                Operational
                                            </span>
                                        </div>
                                        {equipment.needsService && (
                                            <p className="mt-3 text-sm text-slate-500">
                                                Service every {equipment.serviceFrequency} {equipment.serviceFrequencyEvery}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>

                        <button
                            type="submit"
                            disabled={loading || contextLoading}
                            className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? 'Creating...' : 'Create Body of Water'}
                        </button>
                    </aside>
                </form>
            </div>
        </div>
    );
};

export default CreateBodyOfWater;
