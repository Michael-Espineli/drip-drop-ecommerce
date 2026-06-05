
import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, deleteDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { ClipLoader } from 'react-spinners';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

import { RepairRequest, displayRepairRequestStatus } from '../../../utils/models/RepairRequest';
import { loadCustomerTimeline } from '../../../utils/customerTimeline';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import CustomerTimelineGraph from './CustomerTimelineGraph';
import { salesCollectionNames } from '../../../utils/models/Sales';

const customerSections = [
    { id: 'profile', label: 'Profile', helper: 'Contact, billing address, notes, and account status' },
    { id: 'locations', label: 'Service Locations', helper: 'Properties, bodies of water, equipment, and recent stops' },
    { id: 'operations', label: 'Operations', helper: 'Jobs, repair requests, sales, recurring service, and leads' },
    { id: 'history', label: 'History', helper: 'Service, job, chemistry, equipment, and notes timeline' },
];
const validCustomerTabs = customerSections.map((section) => section.id);

// Reusable Components
const InfoCard = ({ title, children, actions }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-slate-950">{title}</h3>
            {actions && <div className="flex-shrink-0">{actions}</div>}
        </div>
        <div className="space-y-4">{children}</div>
    </div>
);

const formatCurrency = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "—";
};

const formatCents = (value) => {
    const amount = Number(value || 0) / 100;
    return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "$0.00";
};

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDateValue = (value) => {
    const millis = toMillis(value);
    return millis ? format(new Date(millis), 'MMM d, yyyy') : 'Not set';
};

const labelize = (value) => {
    if (!value) return 'Unknown';
    return String(value)
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const StatusBadge = ({ children, tone = 'slate' }) => {
    const tones = {
        blue: 'border-blue-200 bg-blue-50 text-blue-700',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        rose: 'border-rose-200 bg-rose-50 text-rose-700',
        slate: 'border-slate-200 bg-slate-50 text-slate-700',
    };

    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const statusToneFor = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (['accepted', 'active', 'paid', 'posted'].includes(normalized)) return 'emerald';
    if (['sent', 'open', 'invoiced', 'viewed', 'estimate'].includes(normalized)) return 'blue';
    if (['draft', 'pending', 'pastdue', 'past due', 'overdue'].includes(normalized)) return 'amber';
    if (['rejected', 'canceled', 'cancelled', 'failed', 'void'].includes(normalized)) return 'rose';
    return 'slate';
};

const getCustomerName = (customer = {}) => (
    customer.displayAsCompany
        ? customer.companyName
        : `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
);

const formatRecurringDays = (stop) => {
    const days = stop.daysOfWeek ?? stop.day;

    if (Array.isArray(days)) {
        return days.filter(Boolean).join(', ') || 'Unscheduled';
    }

    if (typeof days === 'string') {
        return days.split(',').map((day) => day.trim()).filter(Boolean).join(', ') || 'Unscheduled';
    }

    return 'Unscheduled';
};

const timelineTypeStyles = {
    serviceStop: {
        dot: 'bg-blue-600',
        chip: 'bg-blue-50 text-blue-700 border-blue-100',
    },
    chemistry: {
        dot: 'bg-cyan-600',
        chip: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    },
    equipmentMaintenance: {
        dot: 'bg-amber-500',
        chip: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    equipmentRepair: {
        dot: 'bg-red-500',
        chip: 'bg-red-50 text-red-700 border-red-100',
    },
    waterFill: {
        dot: 'bg-indigo-500',
        chip: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    },
    waterEmpty: {
        dot: 'bg-orange-500',
        chip: 'bg-orange-50 text-orange-700 border-orange-100',
    },
    workOrder: {
        dot: 'bg-violet-500',
        chip: 'bg-violet-50 text-violet-700 border-violet-100',
    },
    note: {
        dot: 'bg-emerald-500',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
    toDo: {
        dot: 'bg-slate-500',
        chip: 'bg-slate-50 text-slate-700 border-slate-100',
    },
};

const timelineFilters = [
    { id: 'all', label: 'All', types: [] },
    { id: 'service', label: 'Service', types: ['serviceStop'] },
    { id: 'jobs', label: 'Jobs', types: ['workOrder'] },
    { id: 'notes', label: 'Notes', types: ['note', 'toDo'] },
    { id: 'chemistry', label: 'Chemistry', types: ['chemistry'] },
    { id: 'equipment', label: 'Equipment', types: ['equipmentMaintenance', 'equipmentRepair'] },
    { id: 'water', label: 'Water', types: ['waterFill', 'waterEmpty'] },
];

// Profile Tab
const ProfileTab = ({ customer }) => {
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState(customer);

    useEffect(() => setFormData(customer), [customer]);

    const handleInputChange = e => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleBillingAddressChange = e => setFormData(prev => ({ ...prev, billingAddress: { ...prev.billingAddress, [e.target.name]: e.target.value } }));

    const handleSave = async () => {
        if (!requirePermission("14", "update customer details")) return;

        const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customer.id);
        try {
            await updateDoc(customerRef, formData);
            toast.success('Customer details updated!');
            setIsEditing(false);
        } catch (error) {
            toast.error('Failed to update customer.');
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
                <InfoCard
                    title="Contact Information"
                    actions={can("14") &&
                        <button
                            onClick={() => setIsEditing(!isEditing)}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                            type="button"
                        >
                            {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                    }
                >
                    {isEditing ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input name="firstName" value={formData.firstName} onChange={handleInputChange} placeholder="First Name" className="w-full px-3 py-2 border rounded-md" />
                                <input name="lastName" value={formData.lastName} onChange={handleInputChange} placeholder="Last Name" className="w-full px-3 py-2 border rounded-md" />
                            </div>
                            <input type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="Email" className="w-full px-3 py-2 border rounded-md" />
                            <input name="phoneNumber" value={formData.phoneNumber} onChange={handleInputChange} placeholder="Phone Number" className="w-full px-3 py-2 border rounded-md" />
                        </div>
                    ) : (
                        <dl className="space-y-2">
                            <div className="flex justify-between"><dt className="text-gray-500">Name</dt><dd className="text-gray-900 font-medium">{customer.firstName} {customer.lastName}</dd></div>
                            <div className="flex justify-between"><dt className="text-gray-500">Email</dt><dd className="text-gray-900">{customer.email}</dd></div>
                            <div className="flex justify-between"><dt className="text-gray-500">Phone</dt><dd className="text-gray-900">{customer.phoneNumber}</dd></div>
                        </dl>
                    )}
                </InfoCard>
                <InfoCard title="Notes">
                    <textarea name="notes" value={isEditing ? formData.notes : customer.notes} onChange={handleInputChange} rows="6" className="w-full px-3 py-2 border rounded-md" readOnly={!isEditing}></textarea>
                </InfoCard>
            </div>
            <div className="space-y-8">
                <InfoCard title="Billing Address">
                    {isEditing ? (
                        <div className="space-y-4">
                            <input name="streetAddress" value={formData.billingAddress?.streetAddress} onChange={handleBillingAddressChange} placeholder="Street" className="w-full px-3 py-2 border rounded-md" />
                            <input name="city" value={formData.billingAddress?.city} onChange={handleBillingAddressChange} placeholder="City" className="w-full px-3 py-2 border rounded-md" />
                            <div className="grid grid-cols-2 gap-4">
                                <input name="state" value={formData.billingAddress?.state} onChange={handleBillingAddressChange} placeholder="State" className="w-full px-3 py-2 border rounded-md" />
                                <input name="zip" value={formData.billingAddress?.zip} onChange={handleBillingAddressChange} placeholder="ZIP Code" className="w-full px-3 py-2 border rounded-md" />
                            </div>
                        </div>
                    ) : (
                        <address className="not-italic text-gray-700">
                            {customer.billingAddress?.streetAddress}<br />
                            {customer.billingAddress?.city}, {customer.billingAddress?.state} {customer.billingAddress?.zip}
                        </address>
                    )}
                </InfoCard>
                <InfoCard title="Status">
                    <div className="flex items-center">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${customer.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {customer.active ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                </InfoCard>
                {isEditing && (
                    <div className="flex justify-end space-x-4">
                        <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50" type="button">Cancel</button>
                        <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700" type="button">Save Changes</button>
                    </div>
                )}
            </div>
        </div>
    );
};

// Locations Tab
const ServiceLocationsTab = ({ customer }) => {
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchLocations = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where("customerId", "==", customer.id));
                const snapshot = await getDocs(q);
                const fetchedLocations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setLocations(fetchedLocations);
                if (fetchedLocations.length > 0) {
                    setSelectedLocation(fetchedLocations[0]);
                }
            } catch (error) {
                toast.error("Failed to fetch service locations.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchLocations();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
                <InfoCard
                    title="Service Locations"
                    actions={
                        <Link
                            to={`/company/serviceLocations/createNew/${customer.id}`}
                            className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm"
                        >
                            + Add
                        </Link>
                    }
                >
                    {loading ? <ClipLoader size={30} /> : (
                        <ul className="divide-y divide-gray-200">
                            {locations.map(loc => (
                                <li
                                    key={loc.id}
                                    onClick={() => setSelectedLocation(loc)}
                                    className={`py-3 px-3 rounded-xl cursor-pointer border transition
                                        ${selectedLocation?.id === loc.id ? 'bg-blue-50 border-blue-200' : 'hover:bg-slate-50 border-transparent'}
                                    `}
                                >
                                    <p className="font-semibold text-gray-800">{loc.nickName}</p>
                                    <p className="text-sm text-gray-600">{loc.address.streetAddress}, {loc.address.city}</p>
                                </li>
                            ))}
                            {locations.length === 0 && <p className="text-gray-500">No locations found.</p>}
                        </ul>
                    )}
                </InfoCard>
                {selectedLocation !== null &&
                    <InfoCard
                        title="Service Location"
                        actions={
                            <button className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm transition">
                                Edit
                            </button>
                        }
                    >

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                    Main Contact
                                </p>
                                <p className="text-sm text-slate-900">{selectedLocation.mainContact?.name || "—"}</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                    Email
                                </p>
                                <p className="text-sm text-slate-900">{selectedLocation.mainContact?.email || "—"}</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                    Phone Number
                                </p>
                                <p className="text-sm text-slate-900">{selectedLocation.mainContact?.phoneNumber || "—"}</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                    Gate Code
                                </p>
                                <p className="text-sm text-slate-900">{selectedLocation.gateCode || "—"}</p>
                            </div>
                        </div>


                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Contact Notes
                            </p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">
                                {selectedLocation.mainContact?.notes || "No contact notes added."}
                            </p>
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Dogs on Property
                            </p>

                            {selectedLocation.dogName?.length > 0 ? (
                                <ul className="flex flex-wrap gap-2">
                                    {selectedLocation.dogName.map((dog) => (
                                        <li
                                            key={dog}
                                            className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 border border-blue-100"
                                        >
                                            {dog}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-500">None found.</p>
                            )}
                        </div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Location Notes
                            </p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">
                                {selectedLocation.notes || "No location notes added."}
                            </p>
                        </div>

                    </InfoCard>
                }

            </div>
            <div className="lg:col-span-2 space-y-8">
                {selectedLocation && <LocationDetails location={selectedLocation} customerId={customer.id} />}
            </div>


        </div>
    );
};

const LocationDetails = ({ location, customerId }) => {
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipment, setEquipment] = useState([]);
    const [serviceHistory, setServiceHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchDetails = async () => {
            setLoading(true);
            try {
                const bowQ = query(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'), where("serviceLocationId", "==", location.id));
                const bowSnap = await getDocs(bowQ);
                setBodiesOfWater(bowSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                const equipQ = query(collection(db, 'companies', recentlySelectedCompany, 'equipment'), where("serviceLocationId", "==", location.id));
                const equipSnap = await getDocs(equipQ);
                setEquipment(equipSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                const historyQ = query(collection(db, 'companies', recentlySelectedCompany, 'serviceStops'), where("serviceLocationId", "==", location.id), orderBy("serviceDate", "desc"), limit(5));
                const historySnap = await getDocs(historyQ);
                setServiceHistory(historySnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                toast.error("Failed to load location details.");
            } finally {
                setLoading(false);
            }
        };
        if (location.id && recentlySelectedCompany) {
            fetchDetails();
        }
    }, [location.id, recentlySelectedCompany, db]);

    return (<div className="space-y-8">


        <InfoCard
            title="Bodies of Water"
            actions={
                <Link
                    to={`/company/bodiesOfWater/createNew/${customerId}/${location.id}`}
                    className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm transition"
                >
                    + Add
                </Link>
            }
        >
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <ul className="space-y-3">
                    {bodiesOfWater.map((bow) => (
                        <li key={bow.id}>
                            <Link
                                to={`/company/bodiesOfWater/detail/${bow.id}`}
                                className="block rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-200 hover:bg-slate-50 transition"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-slate-900">
                                            {bow.name || "Unnamed Body of Water"}
                                        </h3>
                                        <p className="mt-1 text-sm text-slate-500">
                                            Body of water profile
                                        </p>
                                    </div>

                                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-100 whitespace-nowrap">
                                        {bow.gallons ? `${Number(bow.gallons).toLocaleString()} gal` : "No volume"}
                                    </span>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Material
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {bow.material || "Not specified"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Last Filled
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {bow.lastFilled
                                                ? format(bow.lastFilled.toDate(), "PPP")
                                                : "Not recorded"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Service Location
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {bow.serviceLocationId || "—"}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                        Notes
                                    </p>
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">
                                        {bow.notes || "No notes added."}
                                    </p>
                                </div>
                            </Link>
                        </li>
                    ))}

                    {bodiesOfWater.length === 0 && (
                        <p className="text-sm text-slate-500">None found.</p>
                    )}
                </ul>
            )}
        </InfoCard>

        <InfoCard
            title="Equipment"
            actions={
                <Link
                    to={`/company/equipment/createNew/${customerId}/${location.id}`}
                    className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm transition"
                >
                    + Add
                </Link>
            }
        >
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <ul className="space-y-3">
                    {equipment.map((eq) => (
                        <li key={eq.id}>
                            <Link
                                to={`/company/equipment/detail/${eq.id}`}
                                className="block rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-200 hover:bg-slate-50 transition"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-slate-900">
                                            {eq.name || "Unnamed Equipment"}
                                        </h3>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {eq.type || "Unknown Type"}
                                            {eq.model ? ` • ${eq.model}` : ""}
                                            {eq.make ? ` • ${eq.make}` : ""}
                                        </p>
                                    </div>

                                    <div className="flex flex-col items-end gap-2">
                                        <span
                                            className={`rounded-full px-3 py-1 text-xs font-semibold border ${eq.status === "Operational"
                                                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                                : "bg-amber-50 text-amber-700 border-amber-100"
                                                }`}
                                        >
                                            {eq.status || "Unknown"}
                                        </span>

                                        {eq.needsService && (
                                            <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 border border-red-100">
                                                Needs Service
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Type
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">{eq.type || "Not specified"}</p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Make / Model
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {[eq.make, eq.model].filter(Boolean).join(" / ") || "Not specified"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Body of Water
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {eq.bodyOfWaterId || "Unassigned"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Pressure
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            Current: {eq.currentPressure ?? "—"} PSI
                                            <br />
                                            Clean: {eq.cleanFilterPressure ?? "—"} PSI
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Last Service
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {eq.lastServiceDate
                                                ? format(eq.lastServiceDate.toDate(), "PPP")
                                                : "Not recorded"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Next Service
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {eq.nextServiceDate
                                                ? format(eq.nextServiceDate.toDate(), "PPP")
                                                : "Not scheduled"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Service Frequency
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            Every {eq.serviceFrequency || "—"} {eq.serviceFrequencyEvery || ""}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Installed
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {eq.dateInstalled
                                                ? format(eq.dateInstalled.toDate(), "PPP")
                                                : "Not recorded"}
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Active
                                        </p>
                                        <p className="mt-1 text-sm text-slate-800">
                                            {eq.isActive ? "Yes" : "No"}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                        Notes
                                    </p>
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">
                                        {eq.notes || "No notes added."}
                                    </p>
                                </div>
                            </Link>
                        </li>
                    ))}

                    {equipment.length === 0 && (
                        <p className="text-sm text-slate-500">None found.</p>
                    )}
                </ul>
            )}
        </InfoCard>

        <InfoCard title="Recent Service History">
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <ul className="divide-y divide-slate-200">
                    {serviceHistory.map((stop) => (
                        <li key={stop.id} className="py-3 flex items-center justify-between gap-4">
                            <span className="text-sm font-medium text-slate-800">
                                {format(stop.serviceDate.toDate(), "PPP")}
                            </span>
                            <span className="text-sm text-slate-500">{stop.tech}</span>
                        </li>
                    ))}
                    {serviceHistory.length === 0 && (
                        <p className="text-sm text-slate-500">No recent stops.</p>
                    )}
                </ul>
            )}
        </InfoCard>
    </div>
    );
};

// Contracts Tab
const ContractsTab = ({ customer }) => {
    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchContracts = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'contracts'), where("receiverId", "==", customer.userId || customer.id));
                const snapshot = await getDocs(q);
                setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                toast.error("Failed to fetch contracts.");
            } finally {
                setLoading(false);
            }
        };
        if (customer && recentlySelectedCompany) {
            fetchContracts();
        }
    }, [customer, recentlySelectedCompany, db]);

    return (
        <InfoCard title="Contracts & Estimates" actions={<Link to={`/company/contracts/create-for-customer/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ New Estimate</Link>}>
            {loading ? <ClipLoader size={30} /> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b">
                                <th className="py-2 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                                <th className="py-2 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                                <th className="py-2 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Date Sent</th>
                                <th className="py-2 px-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {contracts.map(c => (
                                <tr key={c.id} className="hover:bg-slate-50">
                                    <td className="py-3 px-4">
                                        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">{c.status}</span>
                                    </td>
                                    <td className="py-3 px-4">{formatCurrency(c.rate)}</td>
                                    <td className="py-3 px-4">{c.dateSent ? format(c.dateSent.toDate(), 'PPP') : 'N/A'}</td>
                                    <td className="py-3 px-4 text-right">
                                        <Link to={`/company/contract/detail/${c.id}`} className="font-semibold text-blue-600 hover:underline">View</Link>
                                    </td>
                                </tr>
                            ))}
                            {contracts.length === 0 && <tr><td colSpan="4" className="text-center py-8 text-gray-500">No contracts found.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
        </InfoCard>
    );
};

// Leads Tab
const LeadsTab = ({ customer }) => {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchLeads = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'homeownerServiceRequests'), where("customerId", "==", customer.id));
                const snapshot = await getDocs(q);
                setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                toast.error("Failed to fetch leads.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchLeads();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <InfoCard title="Lead History">
            {loading ? <ClipLoader size={30} /> : (
                <ul className="divide-y divide-gray-200">
                    {leads.map(lead => (
                        <li key={lead.id} className="py-4 flex justify-between items-center">
                            <div className="min-w-0">
                                <p className="font-semibold text-gray-800 truncate">{lead.serviceName}</p>
                                <p className="text-sm text-gray-600">Status: {lead.status}</p>
                            </div>
                            <Link to={`/company/leads/${lead.id}`} className="text-sm font-semibold text-blue-600 hover:underline">View Details</Link>
                        </li>
                    ))}
                    {leads.length === 0 && <p className="text-gray-500">No leads found.</p>}
                </ul>
            )}
        </InfoCard>
    );
};

// Recurring Tab
const RecurringTab = ({ customer }) => {
    const [recurringContracts, setRecurringContracts] = useState([]);
    const [recurringStops, setRecurringStops] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchRecurring = async () => {
            setLoading(true);
            try {
                const contractQ = query(collection(db, 'recurringContracts'), where("customerId", "==", customer.id));
                const contractSnap = await getDocs(contractQ);
                setRecurringContracts(contractSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                const stopQ = query(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop'), where("customerId", "==", customer.id));
                const stopSnap = await getDocs(stopQ);
                setRecurringStops(stopSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (e) {
                toast.error("Could not fetch recurring items.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchRecurring();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <InfoCard title="Recurring Contracts" actions={<Link to={`/company/recurring-contracts/createNew/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ Add</Link>}>
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {recurringContracts.map(rc => (
                            <li key={rc.id} className="py-2 flex justify-between">
                                <span>{rc.status || '—'}</span> <span>{formatCurrency(rc.rate)}</span>
                            </li>
                        ))}
                        {recurringContracts.length === 0 && <p className="text-gray-500">None found.</p>}
                    </ul>
                )}
            </InfoCard>
            <InfoCard title="Recurring Service Stops" actions={<Link to={`/company/recurring-service-stops/create/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ Add</Link>}>
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {recurringStops.map(rs => (
                            <li key={rs.id} className="py-2 flex justify-between">
                                <span>{rs.frequency || '—'}</span> <span>{formatRecurringDays(rs)}</span>
                            </li>
                        ))}
                        {recurringStops.length === 0 && <p className="text-gray-500">None found.</p>}
                    </ul>
                )}
            </InfoCard>
        </div>
    );
};

const WorkOrdersTab = ({ customer }) => {
    const [workOrders, setWorkOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchWorkOrders = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'companies', recentlySelectedCompany, 'workOrders'), where("customerId", "==", customer.id));
                const snapshot = await getDocs(q);
                setWorkOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                toast.error("Failed to fetch work orders.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchWorkOrders();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <InfoCard title="Jobs" actions={<Link to={`/company/jobs/createNew/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ Add</Link>}>
            {loading ? <ClipLoader size={30} /> : (
                <ul className="divide-y divide-gray-200">
                    {workOrders.map(order => (
                        <li key={order.id} className="py-4 flex justify-between items-center">
                            <div className="min-w-0">
                                <p className="font-semibold text-gray-800 truncate">{order.description}</p>
                                <p className="text-sm text-gray-600">Status: {order.operationStatus}</p>
                            </div>
                            <Link to={`/company/jobs/detail/${order.id}`} className="text-sm font-semibold text-blue-600 hover:underline">View Details</Link>
                        </li>
                    ))}
                    {workOrders.length === 0 && <p className="text-gray-500">No jobs found.</p>}
                </ul>
            )}
        </InfoCard>
    );
};

const RepairRequestsSection = ({ customer }) => {
    const [internalRepairRequests, setInternalRepairRequests] = useState([]);
    const [externalRepairRequests, setExternalRepairRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchRepairRequests = async () => {
            setLoading(true);
            try {
                const internalResults = await fetchInternalRepairRequests();
                const externalResults = await fetchExternalRepairRequests();

                setInternalRepairRequests(internalResults || []);
                setExternalRepairRequests(externalResults || []);
            } catch (error) {
                toast.error('Failed to fetch repair requests.');
            } finally {
                setLoading(false);
            }
        };

        if (customer.id && recentlySelectedCompany) {
            fetchRepairRequests();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    const fetchInternalRepairRequests = async () => {

        const requestsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'repairRequests'), where("customerId", "==", customer.id));
        const requestsSnapshot = await getDocs(requestsQuery);

        const allRequests = requestsSnapshot.docs.map((requestDoc) => {
            const request = RepairRequest.fromFirestore(requestDoc);
            return { ...request, id: request.id || requestDoc.id };
        });

        // TODO: add your internal repair request query here
        return allRequests;
    };

    const fetchExternalRepairRequests = async () => {
        const requests = [
            getDocs(query(
                collection(db, 'homeownerRepairRequests'),
                where("companyId", "==", recentlySelectedCompany),
                where("customerId", "==", customer.id)
            )),
            customer.userId
                ? getDocs(query(
                    collection(db, 'homeownerRepairRequests'),
                    where("companyId", "==", recentlySelectedCompany),
                    where("userId", "==", customer.userId)
                ))
                : Promise.resolve({ docs: [] }),
            customer.userId
                ? getDocs(query(
                    collection(db, 'homeownerRepairRequests'),
                    where("companyId", "==", recentlySelectedCompany),
                    where("requesterId", "==", customer.userId)
                ))
                : Promise.resolve({ docs: [] }),
        ];

        const snapshots = await Promise.all(requests);

        const customerRequests = uniqueById(
            snapshots
                .flatMap((snapshot) => snapshot.docs)
                .map((requestDoc) => {
                    const request = RepairRequest.fromFirestore(requestDoc);
                    return { ...request, id: request.id || requestDoc.id };
                })
        );

        return customerRequests;
    };

    const renderRequestRow = request => (
        <li key={request.id} className="py-4 flex justify-between items-center">
            <div className="min-w-0">
                <p className="font-semibold text-gray-800 truncate">{request.title || request.description || 'Repair Request'}</p>
                <p className="text-sm text-gray-600">
                    Status: {displayRepairRequestStatus(request.status)}
                </p>
            </div>
            {request.id && (
                <Link
                    to={`/company/repair-requests/${request.id}`}
                    className="text-sm font-semibold text-blue-600 hover:underline"
                >
                    View Details
                </Link>
            )}
        </li>
    );

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <InfoCard
                title="Internal Repair Requests"
                actions={
                    <Link
                        to={`/company/repair-requests/internal/create/${customer.id}`}
                        className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm"
                    >
                        + Add
                    </Link>
                }
            >
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {internalRepairRequests.map(renderRequestRow)}
                        {internalRepairRequests.length === 0 && <p className="text-gray-500">No internal repair requests found.</p>}
                    </ul>
                )}
            </InfoCard>

            <InfoCard
                title="External Repair Requests"
                actions={
                    <Link
                        to={`/company/repair-requests/external/create/${customer.id}`}
                        className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm"
                    >
                        + Add
                    </Link>
                }
            >
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {externalRepairRequests.map(renderRequestRow)}
                        {externalRepairRequests.length === 0 && <p className="text-gray-500">No external repair requests found.</p>}
                    </ul>
                )}
            </InfoCard>
        </div>
    );
};

const uniqueById = (items) => {
    const records = new Map();
    items.forEach((item) => {
        if (item?.id) records.set(item.id, item);
    });
    return [...records.values()];
};

const fetchCustomerSalesRecords = async ({ db, collectionName, companyId, customer }) => {
    const snapshots = await Promise.all([
        getDocs(query(
            collection(db, collectionName),
            where("companyId", "==", companyId),
            where("customerId", "==", customer.id)
        )),
        customer.userId
            ? getDocs(query(
                collection(db, collectionName),
                where("companyId", "==", companyId),
                where("customerUserId", "==", customer.userId)
            ))
            : Promise.resolve({ docs: [] }),
    ]);

    return uniqueById(
        snapshots
            .flatMap((snapshot) => snapshot.docs)
            .map((record) => ({ id: record.id, ...record.data() }))
    ).sort((left, right) => toMillis(right.updatedAt || right.createdAt || right.sentAt || right.dueDate) - toMillis(left.updatedAt || left.createdAt || left.sentAt || left.dueDate));
};

const SalesRecordList = ({ title, children, empty }) => {
    const visibleChildren = React.Children.toArray(children).filter(Boolean);

    return (
        <div>
            <h4 className="mb-2 text-sm font-bold text-slate-900">{title}</h4>
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {visibleChildren.length > 0 ? visibleChildren : <div className="p-4 text-sm text-slate-500">{empty}</div>}
            </div>
        </div>
    );
};

const SalesActivitySection = ({ customer }) => {
    const [salesData, setSalesData] = useState({
        billingProfiles: [],
        agreements: [],
        invoices: [],
        payments: [],
        subscriptions: [],
    });
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchSalesActivity = async () => {
            setLoading(true);
            try {
                const [billingProfiles, agreements, invoices, payments, subscriptions] = await Promise.all([
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.billingProfiles, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.agreements, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.invoices, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.payments, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.billingSubscriptions, companyId: recentlySelectedCompany, customer }),
                ]);

                setSalesData({ billingProfiles, agreements, invoices, payments, subscriptions });
            } catch (error) {
                console.error('Failed to fetch customer sales activity', error);
                toast.error('Failed to fetch customer sales activity.');
            } finally {
                setLoading(false);
            }
        };

        if (customer.id && recentlySelectedCompany) fetchSalesActivity();
    }, [customer, recentlySelectedCompany, db]);

    const openInvoiceTotalCents = salesData.invoices
        .filter((invoice) => ['open', 'partiallypaid', 'overdue'].includes(String(invoice.status || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()))
        .reduce((total, invoice) => total + Number(invoice.amountDueCents ?? invoice.totalAmountCents ?? 0), 0);
    const postedPaymentCents = salesData.payments
        .filter((payment) => String(payment.status || '').toLowerCase() === 'posted')
        .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const primaryBillingProfile = salesData.billingProfiles[0];
    const latestAgreements = salesData.agreements.slice(0, 4);
    const latestInvoices = salesData.invoices.slice(0, 4);
    const latestSubscriptions = salesData.subscriptions.slice(0, 3);
    const latestPayments = salesData.payments.slice(0, 4);

    return (
        <InfoCard title="Sales & Billing">
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Billing Profiles</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{salesData.billingProfiles.length}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agreements</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{salesData.agreements.length}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Subscriptions</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{salesData.subscriptions.length}</p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Open AR</p>
                            <p className="mt-1 text-base font-bold">{formatCents(openInvoiceTotalCents)}</p>
                        </div>
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Posted Payments</p>
                            <p className="mt-1 text-base font-bold">{formatCents(postedPaymentCents)}</p>
                        </div>
                    </div>

                    {primaryBillingProfile && (
                        <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Billing Profile</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{labelize(primaryBillingProfile.status)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Delivery</p>
                                <p className="mt-1 text-sm text-slate-700">{labelize(primaryBillingProfile.invoiceDeliveryMethod)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment Terms</p>
                                <p className="mt-1 text-sm text-slate-700">{labelize(primaryBillingProfile.paymentTerms)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stripe Customer</p>
                                <p className="mt-1 truncate text-sm text-slate-700">{primaryBillingProfile.stripeCustomerId || 'Not linked'}</p>
                            </div>
                        </div>
                    )}

                    <div className="grid gap-5 xl:grid-cols-2">
                        <SalesRecordList title="Service Agreements" empty="No service agreements found.">
                            {latestAgreements.length > 0 && <div className="mb-2 flex items-center justify-between gap-3 p-3">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest</span>
                                <Link to="/company/sales/agreements" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                                    View all
                                </Link>
                            </div>}
                            {latestAgreements.length > 0 && latestAgreements.map((agreement) => (
                                <Link
                                    key={agreement.id}
                                    to={`/company/sales/agreements/${agreement.id}`}
                                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-slate-50"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{agreement.title || 'Service Agreement'}</p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {formatDateValue(agreement.updatedAt || agreement.sentAt || agreement.createdAt)}
                                            {agreement.totalAmountCents ? ` • ${formatCents(agreement.totalAmountCents)}` : ''}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusToneFor(agreement.status)}>{labelize(agreement.status)}</StatusBadge>
                                </Link>
                            ))}
                        </SalesRecordList>

                        <SalesRecordList title="Invoices" empty="No invoices found.">
                            {latestInvoices.length > 0 && latestInvoices.map((invoice) => (
                                <div key={invoice.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {invoice.invoiceNumber || "Invoice"}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            Due {formatDateValue(invoice.dueDate || invoice.dueAt)}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-slate-900">{formatCents(invoice.amountDueCents ?? invoice.totalAmountCents)}</p>
                                        <StatusBadge tone={statusToneFor(invoice.status)}>{labelize(invoice.status)}</StatusBadge>
                                    </div>
                                </div>
                            ))}
                        </SalesRecordList>

                        <SalesRecordList title="Subscriptions" empty="No billing subscriptions found.">
                            {latestSubscriptions.length > 0 && latestSubscriptions.map((subscription) => (
                                <div key={subscription.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {formatCents(subscription.amountCents)} / {subscription.intervalCount > 1 ? `${subscription.intervalCount} ` : ''}{subscription.interval || 'month'}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            Period ends {formatDateValue(subscription.currentPeriodEnd)}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusToneFor(subscription.status)}>{labelize(subscription.status)}</StatusBadge>
                                </div>
                            ))}
                        </SalesRecordList>

                        <SalesRecordList title="Payments" empty="No payments found.">
                            {latestPayments.length > 0 && latestPayments.map((payment) => (
                                <div key={payment.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {formatCents(payment.amountCents)} via {labelize(payment.method)}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {formatDateValue(payment.receivedAt || payment.createdAt)}
                                            {payment.referenceNumber ? ` • Ref ${payment.referenceNumber}` : ''}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusToneFor(payment.status)}>{labelize(payment.status)}</StatusBadge>
                                </div>
                            ))}
                        </SalesRecordList>
                    </div>
                </div>
            )}
        </InfoCard>
    );
};

// Operations Tab
const OperationsTab = ({ customer }) => {
    return (
        <div className="space-y-8">
            <RepairRequestsSection customer={customer} />
            <SalesActivitySection customer={customer} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="space-y-8">
                    <ContractsTab customer={customer} />
                    <WorkOrdersTab customer={customer} />
                </div>
                <div className="space-y-8">
                    <LeadsTab customer={customer} />
                    <RecurringTab customer={customer} />
                </div>
            </div>
        </div>
    );
};

// History Tab
const HistoryTab = ({ customer }) => {
    const [timeline, setTimeline] = useState([]);
    const [activeTimelineFilter, setActiveTimelineFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();
    const selectedFilter = timelineFilters.find((filter) => filter.id === activeTimelineFilter) || timelineFilters[0];
    const visibleTimeline = selectedFilter.id === 'all'
        ? timeline
        : timeline.filter((event) => selectedFilter.types.includes(event.type));

    useEffect(() => {
        const fetchTimeline = async () => {
            setLoading(true);
            try {
                const events = await loadCustomerTimeline({
                    db,
                    companyId: recentlySelectedCompany,
                    customerId: customer.id,
                });
                setTimeline(events);
            } catch (error) {
                console.error(error);
                toast.error("Failed to fetch customer timeline.");
            } finally {
                setLoading(false);
            }
        };
        if (customer && recentlySelectedCompany) {
            fetchTimeline();
        }
    }, [customer, recentlySelectedCompany, db]);

    return (
        <InfoCard
            title="Customer Timeline"
            actions={
                !loading && timeline.length > 0 ? (
                    <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
                        {timelineFilters.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                onClick={() => setActiveTimelineFilter(filter.id)}
                                className={[
                                    "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                                    activeTimelineFilter === filter.id
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-600 hover:text-slate-900",
                                ].join(" ")}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                ) : null
            }
        >
            {loading ? (
                <div className="flex justify-center py-8">
                    <ClipLoader size={30} />
                </div>
            ) : timeline.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    No service, job, note, chemistry, equipment, or water history found yet.
                </div>
            ) : (
                <div className="space-y-6">
                    <CustomerTimelineGraph timeline={timeline} />
                    {visibleTimeline.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                            No {selectedFilter.label.toLowerCase()} timeline events found yet.
                        </div>
                    ) : (
                        <ol className="relative space-y-5 before:absolute before:left-[13px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200">
                            {visibleTimeline.map((event) => {
                                const styles = timelineTypeStyles[event.type] || timelineTypeStyles.serviceStop;
                                const content = (
                                    <div className="relative flex gap-4">
                                        <span className={`mt-1 h-7 w-7 rounded-full border-4 border-white shadow-sm ${styles.dot}`} />
                                        <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                                                    <p className="mt-1 text-xs font-medium text-slate-500">
                                                        {format(event.date, 'PPP p')}
                                                    </p>
                                                </div>
                                                <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.chip}`}>
                                                    {event.label}
                                                </span>
                                            </div>

                                            {event.subtitle && (
                                                <p className="mt-3 text-sm text-slate-600">{event.subtitle}</p>
                                            )}

                                            {event.detail && (
                                                <p className="mt-2 text-sm text-slate-500 line-clamp-2">{event.detail}</p>
                                            )}
                                        </div>
                                    </div>
                                );

                                return (
                                    <li key={event.id}>
                                        {event.target ? (
                                            <Link to={event.target} className="block hover:opacity-95 transition">
                                                {content}
                                            </Link>
                                        ) : (
                                            content
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>
            )}
        </InfoCard>
    );
};

// Main Component
export default function CustomerDetails() {
    const { customerId, tab } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();

    const getInitialTab = useCallback((tabValue) => {
        return validCustomerTabs.includes(tabValue) ? tabValue : 'profile';
    }, []);

    const [customer, setCustomer] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(getInitialTab(tab));
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showInactiveModal, setShowInactiveModal] = useState(false);

    useEffect(() => {
        setActiveTab(getInitialTab(tab));
    }, [tab, getInitialTab]);

    useEffect(() => {
        if (!customerId || !recentlySelectedCompany) return;
        const fetchCustomer = async () => {
            setLoading(true);
            try {
                const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customerId);
                const docSnap = await getDoc(customerRef);
                if (docSnap.exists()) {
                    const customerData = docSnap.data();
                    if (customerData.email) {
                        const userQuery = query(collection(db, 'users'), where("email", "==", customerData.email));
                        const userSnapshot = await getDocs(userQuery);
                        if (!userSnapshot.empty) {
                            customerData.userId = userSnapshot.docs[0].id;
                        }
                    }
                    setCustomer({ id: docSnap.id, ...customerData });
                } else {
                    toast.error('Customer not found.');
                }
            } catch (error) {
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };
        fetchCustomer();
    }, [customerId, recentlySelectedCompany, db]);

    useEffect(() => {
        if (!tab || !validCustomerTabs.includes(tab)) {
            navigate(`/company/customers/details/${customerId}/profile`, { replace: true });
        }
    }, [tab, customerId, navigate]);

    const handleTabChange = (nextTab) => {
        setActiveTab(nextTab);
        navigate(`/company/customers/details/${customerId}/${nextTab}`);
    };

    const handleDeleteCustomer = async () => {
        if (!requirePermission("16", "delete customers")) return;

        try {
            // Delete subcollections first
            const slQ = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where("customerId", "==", customerId));
            const slSnap = await getDocs(slQ);
            for (const slDoc of slSnap.docs) {
                await deleteDoc(slDoc.ref);
            }

            const bowQ = query(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'), where("customerId", "==", customerId));
            const bowSnap = await getDocs(bowQ);
            for (const bowDoc of bowSnap.docs) {
                await deleteDoc(bowDoc.ref);
            }

            const equipQ = query(collection(db, 'companies', recentlySelectedCompany, 'equipment'), where("customerId", "==", customerId));
            const equipSnap = await getDocs(equipQ);
            for (const equipDoc of equipSnap.docs) {
                await deleteDoc(equipDoc.ref);
            }

            // Finally delete the customer
            const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customerId);
            await deleteDoc(customerRef);

            toast.success('Customer and all associated data deleted.');
            navigate('/company/customers');
        } catch (error) {
            toast.error('Failed to delete customer.');
            console.error("Deletion error: ", error);
        } finally {
            setShowDeleteModal(false);
        }
    };

    const handleMakeInactive = async () => {
        if (!requirePermission("14", "update customers")) return;

        try {
            const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customerId);
            await updateDoc(customerRef, { active: false });

            // Optionally, deactivate related items if needed

            toast.success('Customer has been marked as inactive.');
            setCustomer(prev => ({ ...prev, active: false })); // Update local state
        } catch (error) {
            toast.error('Failed to update customer status.');
        } finally {
            setShowInactiveModal(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
    }

    if (!customer) {
        return <div className="text-center p-12">Customer not found.</div>;
    }

    const customerName = getCustomerName(customer) || 'Customer';
    const selectedSection = customerSections.find((section) => section.id === activeTab) || customerSections[0];
    const billingAddress = [
        customer.billingAddress?.streetAddress || customer.billingStreetAddress,
        customer.billingAddress?.city || customer.billingCity,
        customer.billingAddress?.state || customer.billingState,
        customer.billingAddress?.zip || customer.billingZip,
    ].filter(Boolean).join(', ');

    const ModalShell = ({ title, children, onClose, footer }) => (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-xl">
                <div className="flex items-start justify-between gap-3 mb-5">
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">{title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-10 w-10 rounded-xl bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-700"
                        aria-label="Close"
                        type="button"
                    >
                        ✕
                    </button>
                </div>
                <div className="text-gray-700">{children}</div>
                {footer && <div className="mt-6 pt-6 border-t border-gray-200">{footer}</div>}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Link
                                    to="/company/customers"
                                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                                >
                                    Back to Customers
                                </Link>
                                <StatusBadge tone={customer.active ? 'emerald' : 'rose'}>
                                    {customer.active ? 'Active' : 'Inactive'}
                                </StatusBadge>
                                {customer.userId ? (
                                    <StatusBadge tone="blue">Homeowner Account Linked</StatusBadge>
                                ) : (
                                    <StatusBadge>No Homeowner Account</StatusBadge>
                                )}
                            </div>
                            <h1 className="mt-3 text-3xl font-bold text-slate-950">{customerName}</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                {[customer.email, customer.phoneNumber].filter(Boolean).join(' · ') || 'No contact details saved'}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {can("14") && (
                                <button
                                    onClick={() => setShowInactiveModal(true)}
                                    type="button"
                                    disabled={!customer.active}
                                    className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${customer.active
                                        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                        : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                        }`}
                                >
                                    Make Inactive
                                </button>
                            )}

                            {can("16") && (
                                <button
                                    onClick={() => setShowDeleteModal(true)}
                                    type="button"
                                    className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                                >
                                    Delete Customer
                                </button>
                            )}
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <aside className="space-y-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
                            <div className="mt-3 space-y-2">
                                {customerSections.map((section) => {
                                    const active = section.id === activeTab;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => handleTabChange(section.id)}
                                            className={[
                                                "w-full rounded-md border px-3 py-2 text-left transition",
                                                active
                                                    ? "border-blue-200 bg-blue-50 text-blue-800"
                                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                            ].join(" ")}
                                        >
                                            <span className="text-sm font-semibold">{section.label}</span>
                                            <span className="mt-1 block text-xs text-slate-500">{section.helper}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Customer Snapshot</h2>
                            <dl className="mt-3 space-y-3">
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Reference</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">
                                        {customer.internalId || customer.company || customer.displayName || customer.email || "Customer"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
                                    <dd className="mt-1 break-all text-slate-700">{customer.email || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
                                    <dd className="mt-1 text-slate-700">{customer.phoneNumber || "Not set"}</dd>
                                </div>
                                <div className="border-t border-slate-200 pt-3">
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Address</dt>
                                    <dd className="mt-1 text-slate-700">{billingAddress || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current View</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">{selectedSection.label}</dd>
                                </div>
                            </dl>
                        </div>
                    </aside>

                    <main className="min-w-0 space-y-6">
                        {activeTab === 'profile' && <ProfileTab customer={customer} />}
                        {activeTab === 'locations' && <ServiceLocationsTab customer={customer} />}
                        {activeTab === 'operations' && <OperationsTab customer={customer} />}
                        {activeTab === 'history' && <HistoryTab customer={customer} />}
                    </main>
                </section>
            </div>

            {showDeleteModal && (
                <ModalShell
                    title="Delete Customer"
                    onClose={() => setShowDeleteModal(false)}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition" type="button">
                                Cancel
                            </button>
                            <button onClick={handleDeleteCustomer} className="py-2 px-5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition" type="button">
                                Delete
                            </button>
                        </div>
                    }
                >
                    <p>Are you sure you want to permanently delete this customer and all of their associated data? This action cannot be undone.</p>
                </ModalShell>
            )}

            {showInactiveModal && (
                <ModalShell
                    title="Make Customer Inactive"
                    onClose={() => setShowInactiveModal(false)}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowInactiveModal(false)} className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition" type="button">
                                Cancel
                            </button>
                            <button onClick={handleMakeInactive} className="py-2 px-5 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 transition" type="button">
                                Confirm
                            </button>
                        </div>
                    }
                >
                    <p>Are you sure you want to mark this customer as inactive? This will not delete their data, but may restrict their access and scheduled services.</p>
                </ModalShell>
            )}
        </div>
    );
}
