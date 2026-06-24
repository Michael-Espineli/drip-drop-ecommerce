import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs } from "firebase/firestore";
import { Link, useNavigate } from 'react-router-dom';
import { FaPlus, FaSearch, FaSyncAlt } from "react-icons/fa";
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';

const serviceLocationAddress = (location = {}) => {
    const address = location.address || {};
    return [
        address.streetAddress,
        [address.city, address.state].filter(Boolean).join(', '),
        address.zip,
    ].filter(Boolean).join(' ');
};

const serviceLocationContact = (location = {}) => location.mainContact || location.contact || {};

const isLocationActive = (location = {}) => location.active !== false && location.isActive !== false;

const serviceLocationSearchText = (location = {}) => {
    const address = location.address || {};
    const contact = serviceLocationContact(location);

    return [
        location.id,
        location.nickName,
        location.label,
        location.customerName,
        location.gateCode,
        location.dogName,
        location.notes,
        address.streetAddress,
        address.city,
        address.state,
        address.zip,
        contact.name,
        contact.phoneNumber,
        contact.email,
    ].filter(Boolean).join(' ').toLowerCase();
};

const toSortableValue = (value) => String(value || '').toLowerCase();

const compareSortValues = (left, right) => {
    if (left === right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left > right ? 1 : -1;
};

export default function ServiceLocations() {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { can } = useCompanyPermissions();
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tableSort, setTableSort] = useState({ key: "nickName", direction: "asc" });

    const fetchServiceLocations = useCallback(async () => {
        if (!recentlySelectedCompany) {
            setServiceLocationList([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const serviceLocationQuery = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'));
            const querySnapshot = await getDocs(serviceLocationQuery);
            const locations = querySnapshot.docs.map((docSnap) => ServiceLocation.fromFirestore(docSnap));

            setServiceLocationList(locations);
        } catch (fetchError) {
            console.error('Service location data error:', fetchError);
            setError('Failed to load service locations.');
        } finally {
            setLoading(false);
        }
    }, [recentlySelectedCompany]);

    useEffect(() => {
        fetchServiceLocations();
    }, [fetchServiceLocations]);

    const filteredServiceLocations = useMemo(() => {
        const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();

        if (!lowerCaseSearchTerm) return serviceLocationList;

        return serviceLocationList.filter((location) =>
            serviceLocationSearchText(location).includes(lowerCaseSearchTerm)
        );
    }, [serviceLocationList, searchTerm]);

    const summary = useMemo(() => {
        const activeLocations = serviceLocationList.filter(isLocationActive);
        const customerIds = new Set(serviceLocationList.map((location) => location.customerId).filter(Boolean));
        const withGateCode = serviceLocationList.filter((location) => Boolean(location.gateCode)).length;
        const withContact = serviceLocationList.filter((location) => {
            const contact = serviceLocationContact(location);
            return Boolean(contact.name || contact.phoneNumber || contact.email);
        }).length;

        return {
            total: serviceLocationList.length,
            active: activeLocations.length,
            inactive: serviceLocationList.length - activeLocations.length,
            customers: customerIds.size,
            withGateCode,
            withContact,
        };
    }, [serviceLocationList]);

    const sortedServiceLocations = useMemo(() => {
        const valueForKey = (location, key) => {
            const contact = serviceLocationContact(location);

            switch (key) {
                case "status":
                    return isLocationActive(location) ? "active" : "inactive";
                case "address":
                    return serviceLocationAddress(location);
                case "contactName":
                    return contact.name;
                case "phone":
                    return contact.phoneNumber;
                case "email":
                    return contact.email;
                case "customerName":
                    return location.customerName;
                default:
                    return location[key];
            }
        };

        return [...filteredServiceLocations].sort((left, right) => {
            const result = compareSortValues(
                toSortableValue(valueForKey(left, tableSort.key)),
                toSortableValue(valueForKey(right, tableSort.key))
            );
            return tableSort.direction === "asc" ? result : -result;
        });
    }, [filteredServiceLocations, tableSort]);

    const setSort = (key) => {
        setTableSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
        }));
    };

    const SortHeader = ({ label, keyName, className = "" }) => (
        <th className={`p-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-600 ${className}`}>
            <button
                type="button"
                onClick={() => setSort(keyName)}
                className="inline-flex items-center gap-1 text-left uppercase tracking-wider hover:text-gray-900"
            >
                {label}
                <span className="text-xs text-gray-400">
                    {tableSort.key === keyName ? (tableSort.direction === "asc" ? "ASC" : "DESC") : "--"}
                </span>
            </button>
        </th>
    );

    return (
        <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
            <div className="w-full">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Service Locations</h1>
                        <p className="mt-1 text-gray-600">Manage customer service sites, contacts, access details, and active status.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                        <button
                            type="button"
                            onClick={fetchServiceLocations}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={loading}
                            title="Refresh service locations"
                        >
                            <FaSyncAlt className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                        {can("42") && (
                            <Link
                                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition hover:bg-blue-100"
                                to="/company/serviceLocations/createNew"
                            >
                                <FaPlus />
                                Create New
                            </Link>
                        )}
                    </div>
                </div>

                <div className="rounded-lg bg-white p-6 shadow-lg">
                    <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <label className="relative w-full sm:w-2/5">
                            <span className="sr-only">Search service locations</span>
                            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                onChange={(e) => setSearchTerm(e.target.value)}
                                value={searchTerm}
                                className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                type="text"
                                placeholder="Search name, customer, address, contact, gate code..."
                            />
                        </label>
                        <div className="text-sm text-gray-500">
                            Showing <span className="font-semibold text-gray-900">{filteredServiceLocations.length}</span> of <span className="font-semibold text-gray-900">{serviceLocationList.length}</span>
                        </div>
                    </div>

                    <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Locations</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{summary.total}</p>
                            <p className="text-sm text-gray-500">{summary.customers} customer{summary.customers === 1 ? '' : 's'}</p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{summary.active}</p>
                            <p className="text-sm text-gray-500">{summary.inactive} inactive</p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Gate Codes</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{summary.withGateCode}</p>
                            <p className="text-sm text-gray-500">Locations with access notes</p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contacts</p>
                            <p className="mt-1 text-xl font-bold text-gray-900">{summary.withContact}</p>
                            <p className="text-sm text-gray-500">Primary contact on file</p>
                        </div>
                    </div>

                    {loading && <p className="py-4 text-gray-600">Loading...</p>}
                    {error && <p className="py-4 text-red-500">{error}</p>}

                    {!loading && !error && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white">
                                <thead className="bg-gray-100">
                                <tr>
                                    <SortHeader label="Status" keyName="status" />
                                    <SortHeader label="Name" keyName="nickName" />
                                    <SortHeader label="Customer" keyName="customerName" />
                                    <SortHeader label="Address" keyName="address" />
                                    <SortHeader label="Contact" keyName="contactName" />
                                    <SortHeader label="Phone" keyName="phone" />
                                    <SortHeader label="Email" keyName="email" />
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {sortedServiceLocations.map((location) => {
                                        const contact = serviceLocationContact(location);
                                        const address = serviceLocationAddress(location);
                                        const active = isLocationActive(location);

                                        return (
                                            <tr
                                                key={location.id}
                                                onClick={() => navigate(`/company/serviceLocations/detail/${location.id}`)}
                                                className="cursor-pointer transition-colors hover:bg-gray-50"
                                            >
                                                <td className="p-4 whitespace-nowrap text-gray-700">
                                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                                                        {active ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td className="p-4 whitespace-nowrap">
                                                    <p className="font-semibold text-gray-900">{location.nickName || location.label || 'Service Location'}</p>
                                                    {location.gateCode ? <p className="mt-1 text-xs text-gray-500">Gate code on file</p> : null}
                                                </td>
                                                <td className="p-4 whitespace-nowrap text-gray-700">{location.customerName || <span className="text-gray-400">N/A</span>}</td>
                                                <td className="p-4 min-w-[260px] text-gray-700">{address || <span className="text-gray-400">No address</span>}</td>
                                                <td className="p-4 whitespace-nowrap text-gray-700">{contact.name || <span className="text-gray-400">N/A</span>}</td>
                                                <td className="p-4 whitespace-nowrap text-gray-700">{contact.phoneNumber || <span className="text-gray-400">N/A</span>}</td>
                                                <td className="p-4 whitespace-nowrap text-gray-700">{contact.email || <span className="text-gray-400">N/A</span>}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {!loading && !error && filteredServiceLocations.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
                            No service locations match the current search.
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
