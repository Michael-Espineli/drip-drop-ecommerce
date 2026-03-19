
import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, deleteDoc } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import { ClipLoader } from 'react-spinners';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

import { RepairRequest } from '../../../utils/models/RepairRequest';
// Reusable Components
const TabButton = ({ text, active, onClick }) => (
    <button
        onClick={onClick} 
        className={`relative inline-flex items-center justify-center whitespace-nowrap px-4 py-2 text-sm font-semibold transition
            ${active
                ? 'text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
            }`}
        type="button"
    >
        {text}
        <span
            className={`absolute -bottom-[1px] left-3 right-3 h-[2px] rounded-full transition
                ${active ? 'bg-blue-600' : 'bg-transparent'}
            `}
        />
    </button>
);

const InfoCard = ({ title, children, actions }) => (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg sm:text-xl font-semibold text-slate-900">{title}</h3>
            {actions && <div className="flex-shrink-0">{actions}</div>}
        </div>
        <div className="space-y-4">{children}</div>
    </div>
);

// Small helper: uniform “chip” look used in Operations
const StatChip = ({ children }) => (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
        {children}
    </span>
);

// Profile Tab
const ProfileTab = ({ customer }) => {
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState(customer);

    useEffect(() => setFormData(customer), [customer]);

    const handleInputChange = e => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleBillingAddressChange = e => setFormData(prev => ({ ...prev, billingAddress: { ...prev.billingAddress, [e.target.name]: e.target.value } }));

    const handleSave = async () => {
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
                    actions={
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
                          ID: {bow.id}
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
                          className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                            eq.status === "Operational"
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
        <InfoCard title="Contracts & Estimates" actions={<Link to={`/company/estimates/create-for-customer/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ New Estimate</Link>}>
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
                                    <td className="py-3 px-4">${c.rate.toFixed(2)}</td>
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
                const q = query(collection(db, 'homeOwnerServiceRequests'), where("customerId", "==", customer.id));
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
            <InfoCard title="Recurring Contracts" actions={<Link to={`/company/recurringContract/createNew/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ Add</Link>}>
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {recurringContracts.map(rc => (
                            <li key={rc.id} className="py-2 flex justify-between">
                                <span>{rc.status}</span> <span>${rc.rate.toFixed(2)}</span>
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
                                <span>{rs.frequency}</span> <span>{rs.daysOfWeek.join(', ')}</span>
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
                            <Link to={`/company/jobs/details/${order.id}`} className="text-sm font-semibold text-blue-600 hover:underline">View Details</Link>
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

        const requestsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'repairRequests'));
        const requestsSnapshot = await getDocs(requestsQuery);
        
        const allRequests = requestsSnapshot.docs.map(doc => RepairRequest.fromFirestore(doc));

        // TODO: add your internal repair request query here
        return allRequests;
    };

    const fetchExternalRepairRequests = async () => {
        // TODO: add your external repair request query here
                                    
        const customerRequestsQuery = query(collection(db, 'homeOwnerRepairRequests'),where("companyId","==",recentlySelectedCompany));
        const customerRequestsSnapshot = await getDocs(customerRequestsQuery);
        
        const customerRequests = customerRequestsSnapshot.docs.map(doc => RepairRequest.fromFirestore(doc));

        return customerRequests;
    };

    const renderRequestRow = request => (
        <li key={request.id} className="py-4 flex justify-between items-center">
            <div className="min-w-0">
                <p className="font-semibold text-gray-800 truncate">{request.title || request.description || 'Repair Request'}</p>
                <p className="text-sm text-gray-600">
                    Status: {request.status || 'N/A'}
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

// Operations Tab
const OperationsTab = ({ customer }) => {
    return (
        <div className="space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-sm font-semibold text-slate-900">Operations</div>
                        <div className="text-sm text-slate-500 mt-1">
                            Contracts, leads, work orders, recurring items, and repair requests for this customer.
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <StatChip>ID: {customer.id}</StatChip>
                        <StatChip>{customer.active ? 'Active' : 'Inactive'}</StatChip>
                        {customer.userId ? <StatChip>User Linked</StatChip> : <StatChip>No User</StatChip>}
                    </div>
                </div>
            </div>

            <RepairRequestsSection customer={customer} />

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
        <InfoCard title="Contracts & Estimates" actions={<Link to={`/company/estimates/create-for-customer/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-xl hover:bg-blue-700 shadow-sm">+ New Estimate</Link>}>
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
                                    <td className="py-3 px-4"><span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">{c.status}</span></td>
                                    <td className="py-3 px-4">${c.rate.toFixed(2)}</td>
                                    <td className="py-3 px-4">{c.dateSent ? format(c.dateSent.toDate(), 'PPP') : 'N/A'}</td>
                                    <td className="py-3 px-4 text-right"><Link to={`/company/contract/detail/${c.id}`} className="font-semibold text-blue-600 hover:underline">View</Link></td>
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

// Main Component
export default function CustomerDetails() {
    const { customerId, tab } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const validTabs = ['profile', 'locations', 'operations', 'history'];
    const getInitialTab = useCallback((tabValue) => {
        return validTabs.includes(tabValue) ? tabValue : 'profile';
    }, [validTabs]);

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
        if (!tab || !validTabs.includes(tab)) {
            navigate(`/company/customers/details/${customerId}/profile`, { replace: true });
        }
    }, [tab, customerId, navigate, validTabs]);

    const handleTabChange = (nextTab) => {
        setActiveTab(nextTab);
        navigate(`/company/customers/details/${customerId}/${nextTab}`);
    };

    const handleDeleteCustomer = async () => {
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

    const customerName = customer.displayAsCompany ? customer.companyName : `${customer.firstName} ${customer.lastName}`;

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
        <div className="p-4 sm:p-6 lg:p-8 bg-slate-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <Link 
                            to="/company/customers" 
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >&larr; Back to Customers</Link>
                            <h1 className="text-3xl font-semibold text-slate-900 mt-2">{customerName}</h1>
                            <p className="text-sm text-slate-500">{customer.email}</p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => setShowInactiveModal(true)}
                                type="button"
                                disabled={!customer.active}
                                className={`px-4 py-2 text-sm font-medium rounded-xl shadow-sm border transition ${
                                    customer.active
                                        ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100'
                                        : 'text-slate-400 bg-slate-100 border-slate-200 cursor-not-allowed'
                                }`}
                            >
                                Make Inactive
                            </button>

                            <button
                                onClick={() => setShowDeleteModal(true)}
                                type="button"
                                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                            >
                                Delete Customer
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mb-8">
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-3">
                        <nav className="flex gap-1 overflow-x-auto scrollbar-hide">
                            <TabButton text="Profile" active={activeTab === 'profile'} onClick={() => handleTabChange('profile')} />
                            <TabButton text="Service Locations" active={activeTab === 'locations'} onClick={() => handleTabChange('locations')} />
                            <TabButton text="Operations" active={activeTab === 'operations'} onClick={() => handleTabChange('operations')} />
                            <TabButton text="History" active={activeTab === 'history'} onClick={() => handleTabChange('history')} />
                        </nav>
                    </div>
                </div>

                <div>
                    {activeTab === 'profile' && <ProfileTab customer={customer} />}
                    {activeTab === 'locations' && <ServiceLocationsTab customer={customer} />}
                    {activeTab === 'operations' && <OperationsTab customer={customer} />}
                    {activeTab === 'history' && <HistoryTab customer={customer} />}
                </div>
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