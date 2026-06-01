import React, { useState, useEffect, useContext } from 'react';
import { Context } from "../../../context/AuthContext";
import { db, functions } from "../../../utils/config";
import { Link } from 'react-router-dom';
import { fetchCompanyVendors } from '../../../utils/vendors';
import { httpsCallable } from "firebase/functions";

const Vendors = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const [vendorList, setVendorList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [migrating, setMigrating] = useState(false);
    const [migrationMessage, setMigrationMessage] = useState("");
    const [migrationError, setMigrationError] = useState("");

    useEffect(() => {
        (async () => {
            if (!recentlySelectedCompany) {
                setVendorList([]);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const vendors = await fetchCompanyVendors(db, recentlySelectedCompany);
                setVendorList(vendors);
            } catch (error) {
                console.error('Error loading vendors:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [recentlySelectedCompany])

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

    return (
        // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white
        // 1D2E76 - Pool Blue
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green

        <div className='px-2 md:px-7 py-5'>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold">Vendors</h2>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={migrateLegacyVendors}
                        disabled={migrating || !recentlySelectedCompany}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {migrating ? "Migrating..." : "Migrate Legacy Vendors"}
                    </button>
                    <Link
                        className='rounded-md bg-yellow-300 px-3 py-2 text-sm font-semibold text-[#000000]'
                        to={`/company/vendors/create-new`}>Create New Vendor</Link>
                </div>
            </div>
            {migrationMessage ? <div className="mb-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{migrationMessage}</div> : null}
            {migrationError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{migrationError}</div> : null}
            <div className='w-full rounded-md mt-3'>
                <div className='relative overflow-x-auto'>
                    <table className="min-w-full bg-white border border-gray-200">
                        <thead>
                            <tr>
                                <th className='py-3 px-4 text-left'>Name</th>
                                <th className='py-3 px-4 text-left'>Address</th>
                                <th className='py-3 px-4 text-left'>Phone</th>
                                <th className='py-3 px-4 text-left'>Email</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td className='py-6 px-4 text-gray-500' colSpan="4">Loading vendors...</td>
                                </tr>
                            ) : vendorList.length === 0 ? (
                                <tr>
                                    <td className='py-6 px-4 text-gray-500' colSpan="4">No vendors found.</td>
                                </tr>
                            ) : (
                                vendorList.map(vendor => (
                                    <tr key={vendor.id} className="border-t">
                                        <td className='py-3 px-4 font-medium whitespace-nowrap'>{vendor.name}</td>
                                        <td className='py-3 px-4 whitespace-nowrap'>
                                            {[vendor.streetAddress, vendor.city, vendor.state, vendor.zip].filter(Boolean).join(', ') || '-'}
                                        </td>
                                        <td className='py-3 px-4 whitespace-nowrap'>{vendor.phoneNumber || '-'}</td>
                                        <td className='py-3 px-4 whitespace-nowrap'>{vendor.email || '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Vendors;
