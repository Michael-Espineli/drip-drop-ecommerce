import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
    FaArrowRight,
    FaDatabase,
    FaEnvelope,
    FaMapMarkerAlt,
    FaPhone,
    FaPlus,
    FaSearch,
    FaStore,
} from 'react-icons/fa';
import { Context } from "../../../context/AuthContext";
import { db, functions } from "../../../utils/config";
import { fetchCompanyVendors } from '../../../utils/vendors';

const formatAddress = (vendor) => [
    vendor.streetAddress,
    vendor.city,
    vendor.state,
    vendor.zip,
].filter(Boolean).join(', ');

const StatTile = ({ label, value, helper, icon: Icon }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
            </div>
            <span className="rounded-md bg-slate-100 p-2 text-slate-600">
                <Icon className="h-4 w-4" />
            </span>
        </div>
        {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
);

const Vendors = () => {
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
    const [vendorList, setVendorList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [migrating, setMigrating] = useState(false);
    const [migrationMessage, setMigrationMessage] = useState("");
    const [migrationError, setMigrationError] = useState("");
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        let cancelled = false;

        (async () => {
            if (!recentlySelectedCompany) {
                setVendorList([]);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const vendors = await fetchCompanyVendors(db, recentlySelectedCompany);
                if (!cancelled) setVendorList(vendors);
            } catch (error) {
                console.error('Error loading vendors:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany]);

    const migrateLegacyVendors = async () => {
        if (!recentlySelectedCompany || migrating) return;

        setMigrating(true);
        setMigrationMessage("");
        setMigrationError("");

        try {
            const callable = httpsCallable(functions, "migrateLegacyVendorsToCanonical");
            const result = await callable({ companyId: recentlySelectedCompany });
            const data = result.data || {};

            if (data.status && data.status !== 200) {
                throw new Error(data.error || "Migration failed.");
            }

            const vendors = await fetchCompanyVendors(db, recentlySelectedCompany);
            setVendorList(vendors);
            setMigrationMessage(`Copied ${data.copied || 0} legacy vendor(s). Skipped ${data.skipped || 0} existing vendor(s).`);
        } catch (error) {
            console.error("Error migrating vendors:", error);
            setMigrationError(error.message || "Could not migrate vendors.");
        } finally {
            setMigrating(false);
        }
    };

    const filteredVendors = useMemo(() => {
        const queryText = searchTerm.trim().toLowerCase();
        if (!queryText) return vendorList;

        return vendorList.filter((vendor) => [
            vendor.name,
            vendor.email,
            vendor.phoneNumber,
            formatAddress(vendor),
            vendor.billingNotes,
        ].some((value) => String(value || '').toLowerCase().includes(queryText)));
    }, [searchTerm, vendorList]);

    const summary = useMemo(() => ({
        total: vendorList.length,
        withEmail: vendorList.filter((vendor) => vendor.email).length,
        withPhone: vendorList.filter((vendor) => vendor.phoneNumber).length,
        legacy: vendorList.filter((vendor) => vendor.source === 'legacy').length,
    }), [vendorList]);

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                {recentlySelectedCompanyName || 'Selected company'}
                            </p>
                            <h1 className="mt-2 text-3xl font-bold text-slate-950">Vendors</h1>
                            <p className="mt-2 text-sm text-slate-600">
                                Suppliers, billing contacts, purchase sources, and vendor records used across purchasing and inventory.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={migrateLegacyVendors}
                                disabled={migrating || !recentlySelectedCompany}
                                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <FaDatabase className="text-xs" />
                                {migrating ? "Migrating..." : "Migrate Legacy"}
                            </button>
                            <Link
                                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                                to="/company/vendors/create-new"
                            >
                                <FaPlus className="text-xs" />
                                New Vendor
                            </Link>
                        </div>
                    </div>
                </section>

                {migrationMessage && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                        {migrationMessage}
                    </div>
                )}
                {migrationError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                        {migrationError}
                    </div>
                )}

                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile icon={FaStore} label="Vendors" value={summary.total} helper="Total vendor records" />
                    <StatTile icon={FaEnvelope} label="Email Ready" value={summary.withEmail} helper="Have an email saved" />
                    <StatTile icon={FaPhone} label="Phone Ready" value={summary.withPhone} helper="Have a phone saved" />
                    <StatTile icon={FaDatabase} label="Legacy" value={summary.legacy} helper="Still sourced from old path" />
                </section>

                <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-slate-950">Vendor Directory</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                {filteredVendors.length} vendor{filteredVendors.length === 1 ? '' : 's'} shown.
                            </p>
                        </div>
                        <label className="relative w-full lg:w-80">
                            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                            <input
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                placeholder="Search vendors"
                            />
                        </label>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-5 py-3">Vendor</th>
                                    <th className="px-5 py-3">Contact</th>
                                    <th className="px-5 py-3">Address</th>
                                    <th className="px-5 py-3">Source</th>
                                    <th className="px-5 py-3 text-right">Open</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {loading ? (
                                    <tr>
                                        <td className="px-5 py-8 text-slate-500" colSpan="5">Loading vendors...</td>
                                    </tr>
                                ) : filteredVendors.length === 0 ? (
                                    <tr>
                                        <td className="px-5 py-8 text-slate-500" colSpan="5">No vendors found.</td>
                                    </tr>
                                ) : (
                                    filteredVendors.map((vendor) => (
                                        <tr key={`${vendor.source}-${vendor.id}`} className="transition hover:bg-slate-50">
                                            <td className="px-5 py-4">
                                                <Link to={`/company/vendors/detail/${vendor.id}`} className="font-semibold text-slate-950 hover:text-blue-700">
                                                    {vendor.name}
                                                </Link>
                                                {vendor.billingNotes && (
                                                    <p className="mt-1 max-w-sm truncate text-xs text-slate-500">{vendor.billingNotes}</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="space-y-1 text-slate-600">
                                                    <p>{vendor.phoneNumber || 'No phone'}</p>
                                                    <p className="break-all">{vendor.email || 'No email'}</p>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4 text-slate-600">
                                                <span className="inline-flex items-start gap-2">
                                                    <FaMapMarkerAlt className="mt-0.5 shrink-0 text-slate-400" />
                                                    {formatAddress(vendor) || 'No address'}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={[
                                                    'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold',
                                                    vendor.source === 'legacy'
                                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                                                ].join(' ')}>
                                                    {vendor.source === 'legacy' ? 'Legacy' : 'Canonical'}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-right">
                                                <Link
                                                    to={`/company/vendors/detail/${vendor.id}`}
                                                    className="inline-flex items-center justify-end gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"
                                                >
                                                    Details
                                                    <FaArrowRight className="text-xs" />
                                                </Link>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Vendors;
