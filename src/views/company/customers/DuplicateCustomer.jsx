import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import {
    getCustomerDuplicateSummary,
    duplicateCustomer,
    loadCustomerDuplicateSource,
} from '../../../utils/customerDuplicate';
import {
    describeDuplicateCustomerMatch,
    findDuplicateCustomerMatches,
} from '../../../utils/customerDuplicates';
import {
    getCustomerDisplayName,
    normalizeAddress,
    normalizeCustomerForFirestore,
} from '../../../utils/customerLocationData';
import EquipmentCatalogPicker from '../../components/equipment/EquipmentCatalogPicker';

const FormInput = ({ label, name, value, onChange, required = false, type = 'text' }) => (
    <label className="block">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <input
            type={type}
            name={name}
            value={value}
            onChange={onChange}
            required={required}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
    </label>
);

const FormTextarea = ({ label, name, value, onChange }) => (
    <label className="block">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <textarea
            name={name}
            value={value}
            onChange={onChange}
            rows="3"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
    </label>
);

const Section = ({ title, children }) => (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        <div className="mt-4 space-y-4">{children}</div>
    </section>
);

const Stat = ({ label, value }) => (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xl font-bold text-slate-950">{value}</div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
);

const emptyAddress = {
    streetAddress: '',
    city: '',
    state: '',
    zip: '',
    zipCode: '',
    latitude: 0,
    longitude: 0,
};

const DuplicateCustomer = () => {
    const { customerId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [source, setSource] = useState(null);
    const [customerForm, setCustomerForm] = useState({
        firstName: '',
        lastName: '',
        company: '',
        displayAsCompany: false,
        email: '',
        phoneNumber: '',
        billingNotes: '',
        billingAddress: emptyAddress,
    });
    const [equipmentForms, setEquipmentForms] = useState({});

    useEffect(() => {
        const loadSource = async () => {
            if (!recentlySelectedCompany || !customerId) return;

            setLoading(true);
            try {
                const duplicateSource = await loadCustomerDuplicateSource({
                    db,
                    companyId: recentlySelectedCompany,
                    customerId,
                });
                const customer = duplicateSource.customer || {};
                const billingAddress = normalizeAddress(customer.billingAddress || customer.address || {});

                setSource(duplicateSource);
                setCustomerForm({
                    firstName: customer.firstName || '',
                    lastName: customer.lastName || '',
                    company: customer.company || customer.companyName || '',
                    displayAsCompany: Boolean(customer.displayAsCompany),
                    email: customer.email || '',
                    phoneNumber: customer.phoneNumber || customer.phone || '',
                    billingNotes: customer.billingNotes || '',
                    billingAddress,
                });
                setEquipmentForms(
                    (duplicateSource.equipment || []).reduce((forms, item) => ({
                        ...forms,
                        [item.id]: {
                            name: item.name || '',
                            type: item.type || item.category || '',
                            category: item.category || item.type || '',
                            typeId: item.typeId || '',
                            make: item.make || '',
                            makeId: item.makeId || '',
                            model: item.model || '',
                            modelId: item.modelId || '',
                            universalEquipmentId: item.universalEquipmentId || item.modelId || '',
                            manualPdfLink: item.manualPdfLink || '',
                            notes: item.notes || '',
                            needsService: Boolean(item.needsService),
                            status: item.status || 'Operational',
                        },
                    }), {})
                );
            } catch (error) {
                toast.error(error.message || 'Unable to load customer.');
                navigate('/company/customers');
            } finally {
                setLoading(false);
            }
        };

        loadSource();
    }, [customerId, recentlySelectedCompany, navigate]);

    const summary = useMemo(() => getCustomerDuplicateSummary(source || {}), [source]);
    const sourceName = useMemo(() => getCustomerDisplayName(source?.customer || {}), [source]);

    const handleCustomerChange = (event) => {
        const { name, value, type, checked } = event.target;
        setCustomerForm((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleBillingAddressChange = (event) => {
        const { name, value } = event.target;
        setCustomerForm((prev) => ({
            ...prev,
            billingAddress: {
                ...(prev.billingAddress || emptyAddress),
                [name]: value,
                ...(name === 'zip' ? { zipCode: value } : {}),
            },
        }));
    };

    const handleEquipmentChange = (equipmentId, field, value) => {
        setEquipmentForms((prev) => ({
            ...prev,
            [equipmentId]: {
                ...(prev[equipmentId] || {}),
                [field]: value,
            },
        }));
    };

    const handleEquipmentCatalogChange = (equipmentId, nextEquipment) => {
        setEquipmentForms((prev) => ({
            ...prev,
            [equipmentId]: {
                ...(prev[equipmentId] || {}),
                ...nextEquipment,
            },
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!source || !recentlySelectedCompany) return;

        setSaving(true);
        const toastId = toast.loading('Duplicating customer...');
        try {
            const customerPayload = normalizeCustomerForFirestore({
                ...customerForm,
                billingAddress: normalizeAddress(customerForm.billingAddress),
                active: true,
                isActive: true,
            });
            const existingCustomersSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers'));
            const duplicateMatches = findDuplicateCustomerMatches(
                customerPayload,
                existingCustomersSnapshot.docs
                    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
                    .filter((customer) => customer.id !== source.customer.id)
            );

            if (duplicateMatches.length > 0) {
                const match = duplicateMatches[0];
                toast.error(
                    `Possible duplicate: ${match.displayName} already matches by ${describeDuplicateCustomerMatch(match)}.`,
                    { id: toastId }
                );
                return;
            }

            const result = await duplicateCustomer({
                db,
                companyId: recentlySelectedCompany,
                source,
                customerDetails: {
                    ...customerPayload,
                    billingAddress: normalizeAddress(customerForm.billingAddress),
                    billingNotes: customerForm.billingNotes,
                },
                equipmentOverrides: equipmentForms,
            });

            toast.success('Customer duplicated.', { id: toastId });
            navigate(`/company/customers/details/${result.customerId}/profile`);
        } catch (error) {
            console.error('Customer duplication failed:', error);
            toast.error(error.message || 'Unable to duplicate customer.', { id: toastId });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50">
                <ClipLoader size={36} />
            </div>
        );
    }

    if (!source) {
        return <div className="p-12 text-center text-slate-600">Customer not found.</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
            <form onSubmit={handleSubmit} className="mx-auto max-w-5xl space-y-6">
                <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <Link
                                to={`/company/customers/details/${customerId}/profile`}
                                className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                            >
                                Back to Customer
                            </Link>
                            <h1 className="mt-3 flex items-center gap-2 text-3xl font-bold text-slate-950">
                                <DocumentDuplicateIcon className="h-7 w-7 text-blue-600" />
                                Duplicate Customer
                            </h1>
                            <p className="mt-2 text-sm text-slate-600">{sourceName}</p>
                        </div>
                        <div className="flex gap-2">
                            <Link
                                to={`/company/customers/details/${customerId}/profile`}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            >
                                Cancel
                            </Link>
                            <button
                                type="submit"
                                disabled={saving}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? 'Duplicating...' : 'Create Duplicate'}
                            </button>
                        </div>
                    </div>
                </header>

                <Section title="New Customer">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <input
                            type="checkbox"
                            name="displayAsCompany"
                            checked={customerForm.displayAsCompany}
                            onChange={handleCustomerChange}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        Display as Company
                    </label>
                    {customerForm.displayAsCompany ? (
                        <FormInput label="Company Name" name="company" value={customerForm.company} onChange={handleCustomerChange} required />
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            <FormInput label="First Name" name="firstName" value={customerForm.firstName} onChange={handleCustomerChange} required />
                            <FormInput label="Last Name" name="lastName" value={customerForm.lastName} onChange={handleCustomerChange} required />
                        </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormInput label="Email" name="email" type="email" value={customerForm.email} onChange={handleCustomerChange} />
                        <FormInput label="Phone" name="phoneNumber" type="tel" value={customerForm.phoneNumber} onChange={handleCustomerChange} />
                    </div>
                    <FormTextarea label="Billing Notes" name="billingNotes" value={customerForm.billingNotes} onChange={handleCustomerChange} />
                </Section>

                <Section title="Billing Address">
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormInput label="Street" name="streetAddress" value={customerForm.billingAddress?.streetAddress || ''} onChange={handleBillingAddressChange} />
                        <FormInput label="City" name="city" value={customerForm.billingAddress?.city || ''} onChange={handleBillingAddressChange} />
                        <FormInput label="State" name="state" value={customerForm.billingAddress?.state || ''} onChange={handleBillingAddressChange} />
                        <FormInput label="ZIP" name="zip" value={customerForm.billingAddress?.zip || ''} onChange={handleBillingAddressChange} />
                    </div>
                </Section>

                <Section title="Copied Records">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Locations" value={summary.serviceLocations} />
                        <Stat label="Bodies" value={summary.bodiesOfWater} />
                        <Stat label="Equipment" value={summary.equipment} />
                        <Stat label="Parts" value={summary.equipmentParts} />
                        <Stat label="Equipment History" value={summary.equipmentHistory} />
                        <Stat label="Water History" value={summary.waterHistory} />
                        <Stat label="Chemistry" value={summary.chemistryHistory} />
                        <Stat label="Scheduled Work" value={summary.scheduledWork} />
                    </div>
                </Section>

                {source.equipment.length > 0 && (
                    <Section title="Equipment">
                        <div className="space-y-4">
                            {source.equipment.map((item) => {
                                const equipmentForm = equipmentForms[item.id] || {};
                                return (
                                    <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <FormInput
                                                label="Name"
                                                name="name"
                                                value={equipmentForm.name || ''}
                                                onChange={(event) => handleEquipmentChange(item.id, 'name', event.target.value)}
                                            />
                                            <FormInput
                                                label="Status"
                                                name="status"
                                                value={equipmentForm.status || ''}
                                                onChange={(event) => handleEquipmentChange(item.id, 'status', event.target.value)}
                                            />
                                        </div>
                                        <div className="mt-4">
                                            <EquipmentCatalogPicker
                                                value={equipmentForm}
                                                onChange={(nextEquipment) => handleEquipmentCatalogChange(item.id, nextEquipment)}
                                                onModelSelected={(selectedModel) => {
                                                    handleEquipmentCatalogChange(item.id, {
                                                        ...equipmentForm,
                                                        model: selectedModel.model || selectedModel.name || '',
                                                        modelId: selectedModel.id || '',
                                                        universalEquipmentId: selectedModel.id || '',
                                                        manualPdfLink: selectedModel.manualPdfLink || '',
                                                        name: equipmentForm.name || selectedModel.name || selectedModel.model || '',
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="mt-4">
                                            <FormTextarea
                                                label="Notes"
                                                name="notes"
                                                value={equipmentForm.notes || ''}
                                                onChange={(event) => handleEquipmentChange(item.id, 'notes', event.target.value)}
                                            />
                                        </div>
                                        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(equipmentForm.needsService)}
                                                onChange={(event) => handleEquipmentChange(item.id, 'needsService', event.target.checked)}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                            />
                                            Needs Service
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                    </Section>
                )}

                <div className="flex justify-end gap-3">
                    <Link
                        to={`/company/customers/details/${customerId}/profile`}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={saving}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? 'Duplicating...' : 'Create Duplicate'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default DuplicateCustomer;
