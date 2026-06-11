import React, { useState, useEffect, useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Select from 'react-select';
import { query, collection, getDocs, where, updateDoc, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Customer } from '../../../utils/models/Customer';
import { Equipment } from '../../../utils/models/Equipment';
import { ClipLoader } from 'react-spinners';
import toast from 'react-hot-toast';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import {
    describeDuplicateCustomerMatch,
    findDuplicateCustomerMatches,
    getCustomerDuplicateDisplayName,
} from '../../../utils/customerDuplicates';
import { mergeDuplicateCustomers, previewCustomerMerge } from '../../../utils/customerMerge';
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

const getCustomerEmail = (customer = {}) => (
    customer.email ||
    customer.billingEmail ||
    customer.mainContact?.email ||
    customer.contact?.email ||
    ''
);

const getCustomerPhone = (customer = {}) => (
    customer.phoneNumber ||
    customer.phone ||
    customer.mainContact?.phoneNumber ||
    customer.contact?.phoneNumber ||
    ''
);

const getCustomerAddressLine = (customer = {}) => {
    const address = customer.billingAddress || customer.address || {};
    return [
        address.streetAddress || customer.streetAddress,
        address.city || customer.city,
        address.state || customer.state,
        address.zip || customer.zip,
    ]
        .filter(Boolean)
        .join(' ');
};

const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 6,
    colors: {
        ...theme.colors,
        primary25: '#EFF6FF',
        primary: '#2563EB',
        neutral20: '#CBD5E1',
        neutral30: '#94A3B8',
    },
});

const selectStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: 42,
        borderColor: state.isFocused ? '#2563EB' : '#CBD5E1',
        boxShadow: state.isFocused ? '0 0 0 2px rgba(37, 99, 235, 0.15)' : 'none',
        '&:hover': {
            borderColor: state.isFocused ? '#2563EB' : '#94A3B8',
        },
    }),
    menu: (base) => ({
        ...base,
        zIndex: 40,
    }),
    option: (base, state) => ({
        ...base,
        backgroundColor: state.isFocused ? '#EFF6FF' : '#FFFFFF',
        color: '#0F172A',
    }),
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
    const [primaryCustomerId, setPrimaryCustomerId] = useState('');
    const [duplicateCustomerId, setDuplicateCustomerId] = useState('');
    const [mergePreview, setMergePreview] = useState(null);
    const [mergeLoading, setMergeLoading] = useState(false);
    const [merging, setMerging] = useState(false);

    const visibleCustomers = useMemo(
        () => filterCustomersByRoleTagAccess(allCustomers, companyRole),
        [allCustomers, companyRole]
    );

    const availableTags = useMemo(() => getCustomerTagOptions(visibleCustomers), [visibleCustomers]);
    const roleTagAccess = useMemo(() => getRoleCustomerTagAccess(companyRole), [companyRole]);
    const duplicateSuggestions = useMemo(() => {
        const seenPairs = new Set();
        const suggestions = [];

        visibleCustomers.forEach((customer) => {
            findDuplicateCustomerMatches(customer, visibleCustomers).forEach((match) => {
                const pairKey = [customer.id, match.customer.id].sort().join(':');
                if (seenPairs.has(pairKey)) return;
                seenPairs.add(pairKey);
                suggestions.push({
                    primary: customer,
                    duplicate: match.customer,
                    reason: describeDuplicateCustomerMatch(match),
                });
            });
        });

        return suggestions.slice(0, 6);
    }, [visibleCustomers]);
    const mergeCustomerOptions = useMemo(
        () => visibleCustomers.map((customer) => {
            const name = getCustomerDuplicateDisplayName(customer);
            const email = getCustomerEmail(customer);
            const phone = getCustomerPhone(customer);
            const address = getCustomerAddressLine(customer);
            const tags = normalizeCustomerTags(customer.tags);
            const statusLabel = customer.active === false ? 'Inactive' : 'Active';

            return {
                value: customer.id,
                label: [name, email].filter(Boolean).join(' - '),
                name,
                email,
                phone,
                address,
                tags,
                statusLabel,
                customer,
                searchText: [
                    name,
                    email,
                    phone,
                    address,
                    customer.id,
                    customer.migrationSource?.sourceCustomerKey,
                    customer.migrationSource?.sourceLocationKey,
                    ...tags,
                ]
                    .filter(Boolean)
                    .join(' '),
            };
        }),
        [visibleCustomers]
    );
    const selectedPrimaryCustomer = useMemo(
        () => allCustomers.find((customer) => customer.id === primaryCustomerId) || null,
        [allCustomers, primaryCustomerId]
    );
    const selectedDuplicateCustomer = useMemo(
        () => allCustomers.find((customer) => customer.id === duplicateCustomerId) || null,
        [allCustomers, duplicateCustomerId]
    );
    const selectedPrimaryCustomerOption = useMemo(
        () => mergeCustomerOptions.find((option) => option.value === primaryCustomerId) || null,
        [mergeCustomerOptions, primaryCustomerId]
    );
    const selectedDuplicateCustomerOption = useMemo(
        () => mergeCustomerOptions.find((option) => option.value === duplicateCustomerId) || null,
        [mergeCustomerOptions, duplicateCustomerId]
    );
    const canMergeCustomers = can("14") && can("16");

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
    const handlePreviewMerge = async () => {
        if (!recentlySelectedCompany || !primaryCustomerId || !duplicateCustomerId) {
            toast.error('Select both customers before previewing a merge.');
            return;
        }

        if (primaryCustomerId === duplicateCustomerId) {
            toast.error('Choose two different customers.');
            return;
        }

        setMergeLoading(true);
        try {
            const preview = await previewCustomerMerge({
                db,
                companyId: recentlySelectedCompany,
                duplicateCustomerId,
            });
            setMergePreview(preview);
        } catch (error) {
            console.error('Failed to preview customer merge:', error);
            toast.error('Could not preview this merge.');
        } finally {
            setMergeLoading(false);
        }
    };

    const handleMergeCustomers = async () => {
        if (!canMergeCustomers) {
            toast.error('You need update and delete customer permissions to merge customers.');
            return;
        }

        if (!selectedPrimaryCustomer || !selectedDuplicateCustomer) {
            toast.error('Select both customers before merging.');
            return;
        }

        const primaryName = getCustomerDuplicateDisplayName(selectedPrimaryCustomer);
        const duplicateName = getCustomerDuplicateDisplayName(selectedDuplicateCustomer);
        const confirmed = window.confirm(
            `Merge ${duplicateName} into ${primaryName}?\n\nThe duplicate customer record will be removed after its linked records are moved.`
        );
        if (!confirmed) return;

        setMerging(true);
        try {
            const result = await mergeDuplicateCustomers({
                db,
                companyId: recentlySelectedCompany,
                primaryCustomerId,
                duplicateCustomerId,
            });
            setAllCustomers((currentCustomers) => currentCustomers.filter((customer) => customer.id !== duplicateCustomerId));
            setPrimaryCustomerId('');
            setDuplicateCustomerId('');
            setMergePreview(null);
            toast.success(
                `Merged customer. Moved ${result.totalReferences} linked record(s) and ${result.contacts} contact(s).`
            );
        } catch (error) {
            console.error('Failed to merge customers:', error);
            toast.error(error.message || 'Customer merge failed.');
        } finally {
            setMerging(false);
        }
    };

    const selectSuggestedMerge = (suggestion) => {
        setPrimaryCustomerId(suggestion.primary.id);
        setDuplicateCustomerId(suggestion.duplicate.id);
        setMergePreview(null);
    };

    const formatMergeCustomerOption = (option, meta) => {
        if (meta.context === 'value') {
            return option.name;
        }

        return (
            <div>
                <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{option.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${option.statusLabel === 'Inactive' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                        {option.statusLabel}
                    </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                    {[option.email, option.phone, option.address].filter(Boolean).join(' | ') || 'No contact details saved'}
                </p>
                {option.tags.length > 0 && (
                    <p className="mt-1 truncate text-xs text-slate-400">
                        {option.tags.slice(0, 4).join(' | ')}
                        {option.tags.length > 4 ? ` +${option.tags.length - 4}` : ''}
                    </p>
                )}
            </div>
        );
    };

    const renderSelectedMergeCustomerSummary = (option, fallbackText) => {
        if (!option) {
            return (
                <div className="mt-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    {fallbackText}
                </div>
            );
        }

        return (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950">{option.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${option.statusLabel === 'Inactive' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                        {option.statusLabel}
                    </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                    {[option.email, option.phone, option.address].filter(Boolean).join(' | ') || 'No contact details saved'}
                </p>
                {option.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {option.tags.slice(0, 5).map((tag) => (
                            <span key={tag} className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                                {tag}
                            </span>
                        ))}
                        {option.tags.length > 5 && (
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                                +{option.tags.length - 5}
                            </span>
                        )}
                    </div>
                )}
            </div>
        );
    };

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

                {canMergeCustomers && (
                    <div className="mb-6 border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-slate-950">Merge Duplicate Customers</h2>
                                <p className="mt-1 text-sm text-slate-600">
                                    Choose the customer to keep, then choose the duplicate whose linked records should move over.
                                </p>
                            </div>
                            {duplicateSuggestions.length > 0 && (
                                <div className="text-sm text-slate-500">
                                    {duplicateSuggestions.length} possible duplicate pair{duplicateSuggestions.length === 1 ? '' : 's'} found
                                </div>
                            )}
                        </div>

                        {duplicateSuggestions.length > 0 && (
                            <div className="mt-4 grid gap-2 lg:grid-cols-2">
                                {duplicateSuggestions.map((suggestion) => (
                                    <button
                                        key={`${suggestion.primary.id}:${suggestion.duplicate.id}`}
                                        type="button"
                                        onClick={() => selectSuggestedMerge(suggestion)}
                                        className="border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm transition hover:bg-amber-100"
                                    >
                                        <span className="block font-semibold text-amber-950">
                                            {getCustomerDuplicateDisplayName(suggestion.primary)} + {getCustomerDuplicateDisplayName(suggestion.duplicate)}
                                        </span>
                                        <span className="mt-1 block text-xs text-amber-800">Matched by {suggestion.reason}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-start">
                            <div>
                                <label htmlFor="mergePrimaryCustomerId" className="block text-sm font-semibold text-slate-700">
                                    Keep this customer
                                </label>
                                <div className="mt-1">
                                    <Select
                                        inputId="mergePrimaryCustomerId"
                                        value={selectedPrimaryCustomerOption}
                                        onChange={(option) => {
                                            setPrimaryCustomerId(option?.value || '');
                                            setMergePreview(null);
                                        }}
                                        options={mergeCustomerOptions}
                                        isClearable
                                        isLoading={loading}
                                        placeholder={loading ? 'Loading customers...' : 'Search by name, email, phone, address, or tag'}
                                        noOptionsMessage={() => 'No customers found'}
                                        formatOptionLabel={formatMergeCustomerOption}
                                        filterOption={(option, inputValue) => (
                                            option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                                        )}
                                        isOptionDisabled={(option) => option.value === duplicateCustomerId}
                                        theme={selectTheme}
                                        styles={selectStyles}
                                    />
                                </div>
                                {renderSelectedMergeCustomerSummary(selectedPrimaryCustomerOption, 'Choose the record that should stay active after the merge.')}
                            </div>

                            <div>
                                <label htmlFor="mergeDuplicateCustomerId" className="block text-sm font-semibold text-slate-700">
                                    Merge and remove this duplicate
                                </label>
                                <div className="mt-1">
                                    <Select
                                        inputId="mergeDuplicateCustomerId"
                                        value={selectedDuplicateCustomerOption}
                                        onChange={(option) => {
                                            setDuplicateCustomerId(option?.value || '');
                                            setMergePreview(null);
                                        }}
                                        options={mergeCustomerOptions}
                                        isClearable
                                        isLoading={loading}
                                        placeholder={loading ? 'Loading customers...' : 'Search by name, email, phone, address, or tag'}
                                        noOptionsMessage={() => 'No customers found'}
                                        formatOptionLabel={formatMergeCustomerOption}
                                        filterOption={(option, inputValue) => (
                                            option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                                        )}
                                        isOptionDisabled={(option) => option.value === primaryCustomerId}
                                        theme={selectTheme}
                                        styles={selectStyles}
                                    />
                                </div>
                                {renderSelectedMergeCustomerSummary(selectedDuplicateCustomerOption, 'Choose the duplicate record whose linked info should move over.')}
                            </div>

                            <div className="flex flex-col gap-2 xl:min-w-[150px] xl:pt-6">
                                <button
                                    type="button"
                                    onClick={handlePreviewMerge}
                                    disabled={mergeLoading || merging || !primaryCustomerId || !duplicateCustomerId}
                                    className="inline-flex justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                                >
                                    {mergeLoading ? 'Previewing...' : 'Preview'}
                                </button>

                                <button
                                    type="button"
                                    onClick={handleMergeCustomers}
                                    disabled={merging || mergeLoading || !primaryCustomerId || !duplicateCustomerId || primaryCustomerId === duplicateCustomerId}
                                    className="inline-flex justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                    {merging ? 'Merging...' : 'Merge'}
                                </button>
                            </div>
                        </div>

                        {mergePreview && (
                            <div className="mt-4 border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900">
                                <p className="font-semibold">
                                    Preview: {mergePreview.totalReferences} linked record(s) and {mergePreview.contacts} contact(s) will move.
                                </p>
                                {mergePreview.targets.length > 0 && (
                                    <p className="mt-1 text-xs text-blue-800">
                                        {mergePreview.targets.map((target) => `${target.label}: ${target.count}`).join(' | ')}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
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
