import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { query, collection, getDocs, where, updateDoc, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Customer } from '../../../utils/models/Customer';
import { Equipment } from '../../../utils/models/Equipment';
import { ClipLoader } from 'react-spinners';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import {
    customerHasAnyTag,
    filterCustomersByRoleTagAccess,
    getCustomerTagOptions,
    getRoleCustomerTagAccess,
    normalizeCustomerTag,
    normalizeCustomerTags,
} from '../../../utils/customerTags';

const FREE_CUSTOMER_LIMIT = 5;
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'pending_cancellation'];

const noConfiguredLimitState = { isUnlimited: true, remaining: Infinity };

const getSearchText = (value) => (value ?? '').toString().toLowerCase();

const getCustomerDisplayName = (customer) => {
    if (customer.displayAsCompany) return customer.company || customer.companyName || '';
    return `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
};

const getCustomerLimitFromPlan = (planData) => {
    const features = Array.isArray(planData?.features) ? planData.features : [];
    const customerCountFeature = features.find(feature => feature?.name === 'customerCount');

    if (customerCountFeature?.limit === undefined || customerCountFeature?.limit === null || customerCountFeature.limit === '') {
        return null;
    }

    const limit = Number(customerCountFeature.limit);
    return Number.isFinite(limit) ? limit : null;
};

const getUpgradeState = (customerLimit, activeCount) => {
    if (customerLimit === null || customerLimit === -1) return noConfiguredLimitState;
    return { isUnlimited: false, remaining: customerLimit - activeCount };
};

const UpgradeBanner = ({ remaining, onUpgrade }) => (
    <div className={`p-4 mb-6 rounded-2xl shadow-lg ${remaining <= 0 ? 'bg-red-100 border-red-500' : 'bg-yellow-100 border-yellow-500'} border-l-4`}>
        <div className="flex items-center justify-between">
            <div>
                <p className={`font-bold ${remaining <= 0 ? 'text-red-800' : 'text-yellow-800'}`}>
                    {remaining <= 0 ? 'Upgrade Required' : 'Approaching Limit'}
                </p>
                <p className={`text-sm ${remaining <= 0 ? 'text-red-700' : 'text-yellow-700'}`}>
                    {remaining <= 0
                        ? 'You have reached your maximum number of customers. Please upgrade your plan to add more.'
                        : `You can only add ${remaining} more customer(s). Please upgrade your plan soon.`}
                </p>
            </div>
            <button onClick={onUpgrade} className={`px-4 py-2 text-sm font-bold text-white rounded-lg shadow-md transition-transform transform hover:scale-105 ${remaining <= 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-500 hover:bg-yellow-600'}`}>
                {remaining <= 0 ? 'Upgrade Now' : 'Upgrade Plan'}
            </button>
        </div>
    </div>
);

export default function Customers() {
    const navigate = useNavigate();
    const { recentlySelectedCompany, companyRole } = useContext(Context);
    const { can } = useCompanyPermissions();
    const [allCustomers, setAllCustomers] = useState([]);
    const [filteredCustomers, setFilteredCustomers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('active');
    const [selectedTags, setSelectedTags] = useState([]);
    const [tagFilterInput, setTagFilterInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [upgradeState, setUpgradeState] = useState({ isUnlimited: false, remaining: Infinity });

    const visibleCustomers = useMemo(
        () => filterCustomersByRoleTagAccess(allCustomers, companyRole),
        [allCustomers, companyRole]
    );

    const availableTags = useMemo(() => getCustomerTagOptions(visibleCustomers), [visibleCustomers]);
    const roleTagAccess = useMemo(() => getRoleCustomerTagAccess(companyRole), [companyRole]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setAllCustomers([]);
            setFilteredCustomers([]);
            setUpgradeState(noConfiguredLimitState);
            setLoading(false);
            return;
        }

        const fetchCustomerData = async () => {
            setLoading(true);
            try {
                // Fetch all customers
                const customerQuery = query(collection(db, 'companies', recentlySelectedCompany, 'customers'), orderBy("firstName"));
                const customerSnapshot = await getDocs(customerQuery);
                const customerData = customerSnapshot.docs.map(doc => Customer.fromFirestore(doc));
                setAllCustomers(customerData);
                setFilteredCustomers(filterCustomersByRoleTagAccess(customerData, companyRole));

                // Check subscription status
                const activeCount = customerData.filter(c => c.active).length;
                const subQuery = query(
                    collection(db, 'companies', recentlySelectedCompany, 'subscriptions'),
                    where('status', 'in', ACTIVE_SUBSCRIPTION_STATUSES)
                );
                const subSnap = await getDocs(subQuery);

                if (!subSnap.empty) {
                    const subData = subSnap.docs[0].data();
                    if (!subData.dripDropSubscriptionId) {
                        setUpgradeState(noConfiguredLimitState);
                        return;
                    }

                    //Get universal subscription info
                    const unSubRef = doc(db, 'subscriptions', subData.dripDropSubscriptionId);

                    const docSnap = await getDoc(unSubRef);
                    if (docSnap.exists()) {
                        const customerLimit = getCustomerLimitFromPlan(docSnap.data());
                        setUpgradeState(getUpgradeState(customerLimit, activeCount));
                    } else {
                        setUpgradeState(noConfiguredLimitState);
                    }
                } else {
                    // Default to a free plan limit if no active subscription
                    setUpgradeState(getUpgradeState(FREE_CUSTOMER_LIMIT, activeCount));
                }

            } catch (error) {
                console.error("Error fetching customer data: ", error);
            } finally {
                setLoading(false);
            }
        };

        fetchCustomerData();
    }, [recentlySelectedCompany, companyRole]);

    useEffect(() => {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        const filtered = visibleCustomers.filter(customer => {
            const searchableFields = [
                getCustomerDisplayName(customer),
                customer.email,
                customer.phoneNumber,
                customer.billingAddress?.streetAddress,
                ...normalizeCustomerTags(customer.tags),
            ];

            const matchesSearch = searchableFields.some(value => getSearchText(value).includes(lowerCaseSearchTerm));
            const matchesStatus =
                statusFilter === 'all' ||
                (statusFilter === 'active' && customer.active === true) ||
                (statusFilter === 'inactive' && customer.active !== true);
            const matchesTags = customerHasAnyTag(customer, selectedTags);

            return matchesSearch && matchesStatus && matchesTags;
        });
        setFilteredCustomers(filtered);
    }, [searchTerm, statusFilter, selectedTags, visibleCustomers]);

    const toggleTagFilter = (tag) => {
        setSelectedTags((currentTags) =>
            currentTags.includes(tag)
                ? currentTags.filter((currentTag) => currentTag !== tag)
                : [...currentTags, tag]
        );
    };

    const addTagFilter = () => {
        const tag = normalizeCustomerTag(tagFilterInput);
        if (!tag) return;

        setSelectedTags((currentTags) => normalizeCustomerTags([...currentTags, tag]));
        setTagFilterInput('');
    };

    const handleUpgradeClick = () => navigate('/company/settings/subscriptions/picker');
    const updateCustomerAndLocations = async () => {
        try {
            const customerQuery = query(collection(db, 'companies', recentlySelectedCompany, 'equipment'));
            const customerSnapshot = await getDocs(customerQuery);
            const customerData = customerSnapshot.docs.map(doc => Equipment.fromFirestore(doc));

            for (const customer of customerData) {
                //update isActiveField
                const customerRef = doc(db, 'companies', recentlySelectedCompany, 'equipment', customer.id);
                await updateDoc(customerRef, { isActive: true });
                console.log("update Equipment: ", customer.name);
            }
            // //get all serviceLocations
            // const serviceLocationsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'));
            // const serviceLocationsSnapshot = await getDocs(serviceLocationsQuery);
            // const serviceLocationsData = serviceLocationsSnapshot.docs.map(doc => ServiceLocation.fromFirestore(doc));
            // for (const serviceLocation of serviceLocationsData) {
            //     //update isActiveField
            //     const serviceLocationRef = doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', serviceLocation.id);
            //     await updateDoc(serviceLocationRef, { isActive: true });
            //     console.log("update: ", serviceLocation.customerName);
            // }
            console.log("done!")
        } catch (error) {
            console.log('Failed to update customer.');
        }
    };
    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
                        <p className="text-gray-600 mt-1">Manage your customers and their information.</p>

                    </div>
                    <div className="flex space-x-4">
                        {can("12") && (
                            <>
                                <Link to="/company/customers/bulk-upload" className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                                    Upload Bulk
                                </Link>
                                <Link to="/company/customers/createNew"
                                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
                                >
                                    + Create New
                                </Link>
                            </>
                        )}
                        {/* <button onClick={updateCustomerAndLocations} className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition">
                            Update Equipment
                        </button> */}
                    </div>
                </div>

                {/* Upgrade Banner */}
                {!upgradeState.isUnlimited && upgradeState.remaining < 10 && (
                    <UpgradeBanner remaining={upgradeState.remaining} onUpgrade={handleUpgradeClick} />
                )}

                {/* Main Content */}
                <div className="bg-white p-6 rounded-2xl shadow-lg">
                    <div className="mb-4 space-y-4">
                        <input
                            type="text"
                            placeholder="Search customers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        />
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto">
                                {[
                                    { value: 'all', label: 'All' },
                                    { value: 'active', label: 'Active' },
                                    { value: 'inactive', label: 'Inactive' },
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setStatusFilter(option.value)}
                                        className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition sm:flex-none ${
                                            statusFilter === option.value
                                                ? 'bg-white text-slate-900 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>

                            <div className="text-sm text-slate-500">
                                Showing {filteredCustomers.length} of {visibleCustomers.length} visible customers
                            </div>
                        </div>

                        {roleTagAccess.length > 0 && (
                            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                                Your role is limited to customers tagged {roleTagAccess.join(', ')}.
                            </div>
                        )}

                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <label className="block text-sm font-semibold text-slate-700" htmlFor="customer-tag-filter">
                                Filter by tag
                            </label>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <input
                                    id="customer-tag-filter"
                                    list="customer-tag-options"
                                    value={tagFilterInput}
                                    onChange={(event) => setTagFilterInput(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            addTagFilter();
                                        }
                                    }}
                                    placeholder="Type a tag, e.g. R1"
                                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                                />
                                <datalist id="customer-tag-options">
                                    {availableTags.map((tag) => (
                                        <option key={tag} value={tag} />
                                    ))}
                                </datalist>
                                <button
                                    type="button"
                                    onClick={addTagFilter}
                                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                                >
                                    Add Filter
                                </button>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                {availableTags.length > 0 && (
                                    <span className="py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Tags
                                    </span>
                                )}
                                {availableTags.map((tag) => {
                                    const selected = selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => toggleTagFilter(tag)}
                                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                                selected
                                                    ? 'border-blue-600 bg-blue-600 text-white'
                                                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'
                                            }`}
                                        >
                                            {tag}
                                        </button>
                                    );
                                })}
                                {selectedTags.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedTags([])}
                                        className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
                                    >
                                        Clear tags
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center items-center py-12">
                            <ClipLoader size={40} color="#4A90E2" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Name</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Contact</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Address</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Tags</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCustomers.map(customer => (
                                        <tr
                                            key={customer.id}
                                            onClick={() => navigate(`/company/customers/details/${customer.id}`)}
                                            className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                                        >
                                            <td className="px-4 py-4">
                                                <p className="font-medium text-gray-900">{getCustomerDisplayName(customer)}</p>
                                            </td>
                                            <td className="px-4 py-4">
                                                <p className="text-sm text-gray-800">{customer.email}</p>
                                                <p className="text-sm text-gray-600">{customer.phoneNumber}</p>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-gray-600">
                                                {customer.billingAddress?.streetAddress}
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex max-w-xs flex-wrap gap-1.5">
                                                    {normalizeCustomerTags(customer.tags).length > 0 ? (
                                                        normalizeCustomerTags(customer.tags).map((tag) => (
                                                            <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                                                {tag}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-sm text-slate-400">No tags</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${customer.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                                    {customer.active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredCustomers.length === 0 && (
                                        <tr>
                                            <td colSpan="5" className="text-center py-12 text-gray-500">
                                                No customers found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
