import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    BeakerIcon,
    BuildingOffice2Icon,
    CalendarDaysIcon,
    CheckCircleIcon,
    ClipboardDocumentIcon,
    ClockIcon,
    EnvelopeIcon,
    ExclamationTriangleIcon,
    GlobeAltIcon,
    HomeIcon,
    LifebuoyIcon,
    MapPinIcon,
    PhoneIcon,
    PlusIcon,
    QuestionMarkCircleIcon,
    SparklesIcon,
    TrashIcon,
    WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { functions } from '../../utils/config';
import AddressAutocomplete from '../components/AddressAutocomplete';

const serviceOptions = [
    {
        value: 'Weekly pool service',
        title: 'Weekly service',
        description: 'Recurring cleaning, chemicals, and checkups',
        icon: CalendarDaysIcon,
    },
    {
        value: 'Pool repair',
        title: 'Repair or equipment',
        description: 'Pumps, filters, heaters, automation, or leaks',
        icon: WrenchScrewdriverIcon,
    },
    {
        value: 'One-time cleanup',
        title: 'One-time cleanup',
        description: 'After storms, move-ins, parties, or catch-up care',
        icon: SparklesIcon,
    },
    {
        value: 'Green pool rescue',
        title: 'Green pool rescue',
        description: 'Algae cleanup and a recovery plan',
        icon: ExclamationTriangleIcon,
    },
    {
        value: 'New service estimate',
        title: 'Service estimate',
        description: 'Have a pro inspect the pool and build a plan',
        icon: ClipboardDocumentIcon,
    },
    {
        value: 'Other',
        title: 'Something else',
        description: 'Tell the company what is going on',
        icon: QuestionMarkCircleIcon,
    },
];

const propertyTypeOptions = [
    {
        value: 'Residential',
        title: 'Residential',
        description: 'Home pool or spa for personal use',
        icon: HomeIcon,
    },
    {
        value: 'Commercial',
        title: 'Commercial',
        description: 'HOA, apartment, hotel, or business property',
        icon: BuildingOffice2Icon,
    },
];

const bodyOfWaterOptions = [
    {
        value: 'Pool',
        title: 'Pool only',
        description: 'A swimming pool without an attached spa',
        icon: LifebuoyIcon,
    },
    {
        value: 'Pool + Spa Combo',
        title: 'Pool + spa',
        description: 'Pool with an attached spa or hot tub',
        icon: SparklesIcon,
    },
    {
        value: 'Spa',
        title: 'Spa only',
        description: 'Standalone spa or hot tub',
        icon: BeakerIcon,
    },
    {
        value: 'Other',
        title: 'Something else',
        description: 'Water feature, fountain, or not sure',
        icon: QuestionMarkCircleIcon,
    },
];

const poolSizeOptions = [
    { value: 'Unknown', title: 'Not sure', description: 'The tech can estimate it' },
    { value: 'Small', title: 'Small', description: 'Up to 10k gallons' },
    { value: 'Medium', title: 'Medium', description: '10k to 20k gallons' },
    { value: 'Large', title: 'Large', description: '20k to 40k gallons' },
    { value: 'Extra Large', title: 'Extra large', description: '40k+ gallons' },
];

const contactMethods = ['Email', 'Phone', 'Text'];
const urgencyOptions = ['Normal', 'Soon', 'Emergency'];
const waterTypes = ['Chlorine', 'Saltwater', 'Mineral', 'Not sure'];
const waterConditions = ['Crystal clear', 'Slightly cloudy', 'Cloudy', 'Green', 'Not sure'];
const treeDebrisLevels = ['None', 'Light', 'Moderate', 'Heavy'];

const newEquipment = () => ({
    id: `equipment_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: '',
    type: '',
    make: '',
    model: '',
    needsService: false,
    notes: '',
});

const newBodyOfWater = (index = 0) => ({
    id: `body_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: index === 0 ? 'Main Pool' : `Pool / Spa ${index + 1}`,
    type: 'Pool',
    sizeCategory: 'Unknown',
    gallons: '',
    length: '',
    width: '',
    depth: '',
    waterType: 'Chlorine',
    condition: 'Crystal clear',
    material: '',
    notes: '',
    equipment: [],
});

const initialFormData = {
    homeownerName: '',
    homeownerEmail: '',
    homeownerPhone: '',
    preferredContactMethod: 'Email',
    bestTimeToContact: '',
    streetAddress: '',
    city: '',
    state: '',
    zip: '',
    latitude: null,
    longitude: null,
    propertyType: 'Residential',
    treeTypes: '',
    treeDebrisLevel: 'Moderate',
    overhangingTrees: '',
    gateCode: '',
    accessNotes: '',
    petsOnProperty: '',
    serviceType: 'Weekly pool service',
    urgency: 'Normal',
    preferredStartDate: '',
    currentProvider: '',
    serviceDescription: '',
    bodiesOfWater: [newBodyOfWater(0)],
};

const safeExternalHref = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(https?:|mailto:|tel:)/i.test(text)) return text;
    return `https://${text}`;
};

const combineAddress = (formData) => (
    [formData.city, formData.state, formData.zip].filter(Boolean).join(', ')
);

const summarizeBody = (body = {}) => (
    [
        body.type,
        body.sizeCategory && body.sizeCategory !== 'Unknown' ? body.sizeCategory : '',
        body.condition,
    ].filter(Boolean).join(' / ')
);

const buildFallbackDescription = (formData) => {
    const firstBody = formData.bodiesOfWater[0] || {};
    return [
        `${formData.serviceType} request`,
        formData.urgency ? `Urgency: ${formData.urgency}` : '',
        formData.propertyType ? `Property: ${formData.propertyType}` : '',
        summarizeBody(firstBody) ? `Pool/spa: ${summarizeBody(firstBody)}` : '',
        formData.treeDebrisLevel ? `Tree debris: ${formData.treeDebrisLevel}` : '',
    ].filter(Boolean).join('\n');
};

const StepIndicator = ({ currentStep }) => {
    const steps = ['Address', 'Help', 'Pool', 'Review'];

    return (
        <div>
            <div className="grid grid-cols-4 gap-2">
                {steps.map((step, index) => {
                    const active = index === currentStep;
                    const complete = index < currentStep;

                    return (
                        <div key={step} className="min-w-0">
                            <div className={[
                                'h-1.5 rounded-full transition',
                                complete ? 'bg-emerald-500' : active ? 'bg-cyan-500' : 'bg-slate-200',
                            ].join(' ')} />
                            <p className={[
                                'mt-2 truncate text-xs font-semibold',
                                active ? 'text-cyan-700' : complete ? 'text-emerald-700' : 'text-slate-400',
                            ].join(' ')}>
                                {step}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const CompanyHeader = ({ company, intakeUrl, onCopy }) => {
    const websiteHref = safeExternalHref(company.website || company.websiteURL);

    return (
        <section className="border-b border-slate-200 bg-white">
            <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-md border border-cyan-100 bg-cyan-50">
                            {company.logoUrl || company.photoUrl ? (
                                <img src={company.logoUrl || company.photoUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <BuildingOffice2Icon className="h-9 w-9 text-cyan-600" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Drip Drop service request</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">{company.name || 'Service request'}</h1>
                                {company.verified && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                        <CheckCircleIcon className="h-4 w-4" />
                                        Verified
                                    </span>
                                )}
                            </div>
                            {company.bio && (
                                <p className="mt-2 max-w-3xl text-sm text-slate-600">{company.bio}</p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                                {company.services?.slice(0, 5).map((service) => (
                                    <span key={service} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                        {service}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:w-[23rem]">
                        {company.phone && (
                            <a href={`tel:${company.phone}`} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                                <PhoneIcon className="h-4 w-4 text-cyan-600" />
                                {company.phone}
                            </a>
                        )}
                        {company.email && (
                            <a href={`mailto:${company.email}`} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                                <EnvelopeIcon className="h-4 w-4 text-cyan-600" />
                                Email
                            </a>
                        )}
                        {websiteHref && (
                            <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                                <GlobeAltIcon className="h-4 w-4 text-cyan-600" />
                                Website
                            </a>
                        )}
                        {company.id && (
                            <Link to={`/companies/profile/${company.id}`} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                                <BuildingOffice2Icon className="h-4 w-4 text-cyan-600" />
                                Profile
                            </Link>
                        )}
                        {intakeUrl && (
                            <button
                                type="button"
                                onClick={onCopy}
                                className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 font-semibold text-cyan-800 hover:bg-cyan-100 sm:col-span-2"
                            >
                                <ClipboardDocumentIcon className="h-4 w-4" />
                                Copy request link
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

const Field = ({ label, children, helper }) => (
    <div>
        <label className="block text-sm font-semibold text-slate-800">{label}</label>
        <div className="mt-1">{children}</div>
        {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
    </div>
);

const OptionCard = ({ option, selected, onSelect, compact = false }) => {
    const Icon = option.icon || CheckCircleIcon;

    return (
        <button
            type="button"
            onClick={() => onSelect(option.value)}
            className={[
                'group flex h-full min-h-[6rem] items-start gap-3 rounded-md border p-4 text-left transition',
                selected
                    ? 'border-cyan-500 bg-cyan-50 shadow-sm ring-1 ring-cyan-500'
                    : 'border-slate-200 bg-white hover:border-cyan-200 hover:bg-cyan-50/50',
                compact ? 'min-h-[4.75rem]' : '',
            ].join(' ')}
        >
            <span className={[
                'flex h-10 w-10 flex-none items-center justify-center rounded-md border',
                selected ? 'border-cyan-200 bg-white text-cyan-700' : 'border-slate-200 bg-slate-50 text-slate-500',
            ].join(' ')}>
                <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
                <span className="block font-bold text-slate-950">{option.title}</span>
                {option.description && (
                    <span className="mt-1 block text-sm leading-5 text-slate-600">{option.description}</span>
                )}
            </span>
        </button>
    );
};

const SelectPill = ({ value, selected, onSelect }) => (
    <button
        type="button"
        onClick={() => onSelect(value)}
        className={[
            'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
            selected ? 'border-cyan-500 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        ].join(' ')}
    >
        {value}
    </button>
);

export default function PublicServiceRequest() {
    const { companyId } = useParams();
    const [company, setCompany] = useState(null);
    const [formData, setFormData] = useState(initialFormData);
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(null);

    const intakeUrl = useMemo(() => (
        companyId && typeof window !== 'undefined'
            ? `${window.location.origin}/request-service/${companyId}`
            : ''
    ), [companyId]);

    const firstBody = formData.bodiesOfWater[0] || {};

    useEffect(() => {
        let cancelled = false;

        const loadCompany = async () => {
            if (!companyId) {
                setError('This service request link is missing the company id.');
                setLoading(false);
                return;
            }

            try {
                const callable = httpsCallable(functions, 'getPublicLeadIntakeCompany');
                const result = await callable({
                    companyId,
                    baseUrl: window.location.origin,
                });
                const response = result.data || {};

                if (response.status !== 200) {
                    throw new Error(response.error || 'Could not load this company.');
                }

                if (!cancelled) setCompany(response.company || {});
            } catch (loadError) {
                console.error('Failed to load public lead intake company', loadError);
                if (!cancelled) setError(loadError.message || 'Could not load this request form.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadCompany();

        return () => {
            cancelled = true;
        };
    }, [companyId]);

    const updateField = useCallback((field, value) => {
        setFormData((current) => ({ ...current, [field]: value }));
    }, []);

    const handleAddressSelect = useCallback((address) => {
        setFormData((current) => ({
            ...current,
            streetAddress: address.streetAddress || current.streetAddress,
            city: address.city || current.city,
            state: address.state || current.state,
            zip: address.zipCode || address.zip || current.zip,
            latitude: address.latitude ?? current.latitude,
            longitude: address.longitude ?? current.longitude,
        }));
    }, []);

    const updateBody = (bodyId, field, value) => {
        setFormData((current) => ({
            ...current,
            bodiesOfWater: current.bodiesOfWater.map((body) => (
                body.id === bodyId ? { ...body, [field]: value } : body
            )),
        }));
    };

    const addBody = () => {
        setFormData((current) => ({
            ...current,
            bodiesOfWater: [
                ...current.bodiesOfWater,
                newBodyOfWater(current.bodiesOfWater.length),
            ],
        }));
    };

    const removeBody = (bodyId) => {
        setFormData((current) => ({
            ...current,
            bodiesOfWater: current.bodiesOfWater.length <= 1
                ? current.bodiesOfWater
                : current.bodiesOfWater.filter((body) => body.id !== bodyId),
        }));
    };

    const addEquipment = (bodyId) => {
        setFormData((current) => ({
            ...current,
            bodiesOfWater: current.bodiesOfWater.map((body) => (
                body.id === bodyId
                    ? { ...body, equipment: [...body.equipment, newEquipment()] }
                    : body
            )),
        }));
    };

    const updateEquipment = (bodyId, equipmentId, field, value) => {
        setFormData((current) => ({
            ...current,
            bodiesOfWater: current.bodiesOfWater.map((body) => (
                body.id === bodyId
                    ? {
                        ...body,
                        equipment: body.equipment.map((equipment) => (
                            equipment.id === equipmentId ? { ...equipment, [field]: value } : equipment
                        )),
                    }
                    : body
            )),
        }));
    };

    const removeEquipment = (bodyId, equipmentId) => {
        setFormData((current) => ({
            ...current,
            bodiesOfWater: current.bodiesOfWater.map((body) => (
                body.id === bodyId
                    ? { ...body, equipment: body.equipment.filter((equipment) => equipment.id !== equipmentId) }
                    : body
            )),
        }));
    };

    const validateStep = (targetStep = step) => {
        if (targetStep === 0) {
            if (!formData.streetAddress.trim()) return 'Please enter the service address.';
            if (!formData.homeownerName.trim()) return 'Please enter your name.';
            if (!formData.homeownerPhone.trim()) return 'Please enter your phone number.';
            if (!formData.homeownerEmail.trim()) return 'Please enter your email.';
            if (!formData.homeownerEmail.includes('@')) return 'Please enter a valid email address.';
        }

        if (targetStep === 1 && !formData.serviceType) {
            return 'Please choose what you need help with.';
        }

        return '';
    };

    const goNext = () => {
        const validationError = validateStep(step);
        if (validationError) {
            toast.error(validationError);
            return;
        }

        setStep((current) => Math.min(current + 1, 3));
    };

    const copyIntakeLink = async () => {
        try {
            await navigator.clipboard.writeText(intakeUrl);
            toast.success('Public request link copied.');
        } catch (copyError) {
            console.error('Could not copy public request link', copyError);
            toast.error('Could not copy the request link.');
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (step < 3) {
            goNext();
            return;
        }

        const validationError = [0, 1, 2].map(validateStep).find(Boolean);
        if (validationError) {
            toast.error(validationError);
            return;
        }

        setSubmitting(true);
        setError('');

        const serviceDescription = formData.serviceDescription.trim() || buildFallbackDescription(formData);

        try {
            const callable = httpsCallable(functions, 'submitPublicServiceRequestLead');
            const result = await callable({
                companyId,
                baseUrl: window.location.origin,
                submittedFromUrl: window.location.href,
                homeownerName: formData.homeownerName,
                homeownerEmail: formData.homeownerEmail,
                homeownerPhone: formData.homeownerPhone,
                preferredContactMethod: formData.preferredContactMethod,
                bestTimeToContact: formData.bestTimeToContact,
                serviceLocationAddress: {
                    streetAddress: formData.streetAddress,
                    city: formData.city,
                    state: formData.state,
                    zip: formData.zip,
                    latitude: formData.latitude,
                    longitude: formData.longitude,
                },
                propertyType: formData.propertyType,
                treeTypes: formData.treeTypes,
                treeDebrisLevel: formData.treeDebrisLevel,
                overhangingTrees: formData.overhangingTrees,
                gateCode: formData.gateCode,
                accessNotes: formData.accessNotes,
                petsOnProperty: formData.petsOnProperty,
                serviceType: formData.serviceType,
                serviceName: formData.serviceType,
                requestType: formData.serviceType.toLowerCase().includes('repair') ? 'repair' : 'service',
                urgency: formData.urgency,
                preferredStartDate: formData.preferredStartDate,
                currentProvider: formData.currentProvider,
                serviceDescription,
                bodiesOfWater: formData.bodiesOfWater,
            });
            const response = result.data || {};

            if (response.status !== 200) {
                throw new Error(response.error || 'Could not submit this request.');
            }

            setSubmitted(response);
            toast.success('Service request sent.');
        } catch (submitError) {
            console.error('Failed to submit public service request', submitError);
            setError(submitError.message || 'Could not submit this request.');
            toast.error(submitError.message || 'Could not submit this request.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
                Loading service request...
            </div>
        );
    }

    if (error && !company) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
                <div className="w-full max-w-md rounded-md border border-rose-200 bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-bold text-slate-950">Request form unavailable</h1>
                    <p className="mt-2 text-sm text-slate-600">{error}</p>
                    <Link to="/" className="mt-5 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        Drip Drop home
                    </Link>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-slate-50 text-slate-900">
                <CompanyHeader company={company || {}} intakeUrl={intakeUrl} onCopy={copyIntakeLink} />
                <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
                    <div className="rounded-md border border-emerald-200 bg-white p-6 shadow-sm">
                        <div className="flex items-start gap-3">
                            <CheckCircleIcon className="h-8 w-8 flex-none text-emerald-600" />
                            <div>
                                <h1 className="text-2xl font-bold text-slate-950">Request sent</h1>
                                <p className="mt-2 text-sm text-slate-600">
                                    {company?.name || 'The company'} received your service request. {submitted.verificationEmailSent
                                        ? `A verification link was sent to ${submitted.maskedEmail || 'your email'} so you can connect this request to a homeowner account.`
                                        : 'Use the account connection link below to connect this request to a homeowner account.'}
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                            {submitted.verificationUrl && (
                                <Link
                                    to={`/public-service-request/verify/${submitted.verificationId}`}
                                    className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700"
                                >
                                    Connect homeowner account
                                    <ArrowRightIcon className="h-4 w-4" />
                                </Link>
                            )}
                            <Link
                                to="/homeowners"
                                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                            >
                                Homeowner portal
                            </Link>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <CompanyHeader company={company || {}} intakeUrl={intakeUrl} onCopy={copyIntakeLink} />

            <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <form onSubmit={handleSubmit} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <StepIndicator currentStep={step} />

                    {step === 0 && (
                        <section className="mt-6 space-y-6">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Start here</p>
                                <h2 className="mt-1 text-2xl font-bold text-slate-950">Let us know where to send the pool pro</h2>
                                <p className="mt-2 text-sm text-slate-600">Search the service address, then add the best contact for this request.</p>
                            </div>

                            <Field label="Service address">
                                <AddressAutocomplete
                                    initialValue={formData.streetAddress}
                                    onAddressSelect={handleAddressSelect}
                                    onInputChange={(value) => updateField('streetAddress', value)}
                                    placeholder="Search service address"
                                    customClasses="w-full rounded-md border border-slate-300 bg-white py-3 pl-10 pr-3 text-base font-semibold text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                    iconClasses="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-cyan-600"
                                />
                            </Field>

                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field label="City">
                                    <input value={formData.city} onChange={(event) => updateField('city', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                </Field>
                                <Field label="State">
                                    <input value={formData.state} onChange={(event) => updateField('state', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                </Field>
                                <Field label="Zip">
                                    <input value={formData.zip} onChange={(event) => updateField('zip', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                </Field>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Name">
                                    <input value={formData.homeownerName} onChange={(event) => updateField('homeownerName', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" placeholder="First and last name" required />
                                </Field>
                                <Field label="Phone">
                                    <input type="tel" value={formData.homeownerPhone} onChange={(event) => updateField('homeownerPhone', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" placeholder="Best phone number" required />
                                </Field>
                                <Field label="Email" helper="We send a verification link so you can connect the request to a homeowner account.">
                                    <input type="email" value={formData.homeownerEmail} onChange={(event) => updateField('homeownerEmail', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" placeholder="Email address" required />
                                </Field>
                                <Field label="Preferred contact">
                                    <select value={formData.preferredContactMethod} onChange={(event) => updateField('preferredContactMethod', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm">
                                        {contactMethods.map((method) => <option key={method} value={method}>{method}</option>)}
                                    </select>
                                </Field>
                            </div>
                        </section>
                    )}

                    {step === 1 && (
                        <section className="mt-6 space-y-6">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Request</p>
                                <h2 className="mt-1 text-2xl font-bold text-slate-950">What can the company help with?</h2>
                                <p className="mt-2 text-sm text-slate-600">Pick the closest match. You can add a note if there is more to the story.</p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                {serviceOptions.map((option) => (
                                    <OptionCard
                                        key={option.value}
                                        option={option}
                                        selected={formData.serviceType === option.value}
                                        onSelect={(value) => updateField('serviceType', value)}
                                    />
                                ))}
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field label="How urgent?">
                                    <div className="flex flex-wrap gap-2">
                                        {urgencyOptions.map((urgency) => (
                                            <SelectPill key={urgency} value={urgency} selected={formData.urgency === urgency} onSelect={(value) => updateField('urgency', value)} />
                                        ))}
                                    </div>
                                </Field>
                                <Field label="Preferred start date">
                                    <input type="date" value={formData.preferredStartDate} onChange={(event) => updateField('preferredStartDate', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                </Field>
                                <Field label="Best time to contact">
                                    <input value={formData.bestTimeToContact} onChange={(event) => updateField('bestTimeToContact', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Morning, after 4 PM" />
                                </Field>
                            </div>

                            <Field label="Anything specific going on?" helper="Optional, but helpful for pricing and scheduling.">
                                <textarea value={formData.serviceDescription} onChange={(event) => updateField('serviceDescription', event.target.value)} rows={4} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Tell them what you noticed, what changed, or what you want handled." />
                            </Field>
                        </section>
                    )}

                    {step === 2 && (
                        <section className="mt-6 space-y-6">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Pool details</p>
                                <h2 className="mt-1 text-2xl font-bold text-slate-950">A few quick pool basics</h2>
                                <p className="mt-2 text-sm text-slate-600">No need to know everything. The company can fill in the blanks during the visit.</p>
                            </div>

                            <div>
                                <p className="text-sm font-semibold text-slate-800">Property type</p>
                                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                    {propertyTypeOptions.map((option) => (
                                        <OptionCard key={option.value} option={option} selected={formData.propertyType === option.value} onSelect={(value) => updateField('propertyType', value)} compact />
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4 border-t border-slate-200 pt-5">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h3 className="text-base font-bold text-slate-950">Pools and spas</h3>
                                        <p className="mt-1 text-sm text-slate-500">Add more than one if the property has multiple pools or spas.</p>
                                    </div>
                                    <button type="button" onClick={addBody} className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">
                                        <PlusIcon className="h-4 w-4" />
                                        Add pool/spa
                                    </button>
                                </div>

                                {formData.bodiesOfWater.map((body, bodyIndex) => (
                                    <div key={body.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <h4 className="font-semibold text-slate-950">Pool / Spa #{bodyIndex + 1}</h4>
                                            {formData.bodiesOfWater.length > 1 && (
                                                <button type="button" onClick={() => removeBody(body.id)} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                                                    <TrashIcon className="h-4 w-4" />
                                                    Remove
                                                </button>
                                            )}
                                        </div>

                                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                            {bodyOfWaterOptions.map((option) => (
                                                <OptionCard key={option.value} option={option} selected={body.type === option.value} onSelect={(value) => updateBody(body.id, 'type', value)} compact />
                                            ))}
                                        </div>

                                        <div className="mt-5">
                                            <p className="text-sm font-semibold text-slate-800">Approximate size</p>
                                            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                {poolSizeOptions.map((size) => (
                                                    <button
                                                        key={size.value}
                                                        type="button"
                                                        onClick={() => updateBody(body.id, 'sizeCategory', size.value)}
                                                        className={[
                                                            'rounded-md border p-3 text-left transition',
                                                            body.sizeCategory === size.value
                                                                ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500'
                                                                : 'border-slate-200 bg-white hover:border-cyan-200',
                                                        ].join(' ')}
                                                    >
                                                        <span className="block font-bold text-slate-950">{size.title}</span>
                                                        <span className="mt-1 block text-xs text-slate-500">{size.description}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                                            <Field label="Water type">
                                                <div className="flex flex-wrap gap-2">
                                                    {waterTypes.map((type) => (
                                                        <SelectPill key={type} value={type} selected={body.waterType === type} onSelect={(value) => updateBody(body.id, 'waterType', value)} />
                                                    ))}
                                                </div>
                                            </Field>
                                            <Field label="Water condition">
                                                <div className="flex flex-wrap gap-2">
                                                    {waterConditions.map((condition) => (
                                                        <SelectPill key={condition} value={condition} selected={body.condition === condition} onSelect={(value) => updateBody(body.id, 'condition', value)} />
                                                    ))}
                                                </div>
                                            </Field>
                                        </div>

                                        <div className="mt-5 grid gap-4 sm:grid-cols-3">
                                            <Field label="Gallons">
                                                <input value={body.gallons} onChange={(event) => updateBody(body.id, 'gallons', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Unknown is fine" />
                                            </Field>
                                            <Field label="Surface/material">
                                                <input value={body.material} onChange={(event) => updateBody(body.id, 'material', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Pebble, plaster" />
                                            </Field>
                                            <Field label="Nickname">
                                                <input value={body.name} onChange={(event) => updateBody(body.id, 'name', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                            </Field>
                                        </div>

                                        <div className="mt-5 grid gap-4 sm:grid-cols-3">
                                            <Field label="Length">
                                                <input value={body.length} onChange={(event) => updateBody(body.id, 'length', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="ft" />
                                            </Field>
                                            <Field label="Width">
                                                <input value={body.width} onChange={(event) => updateBody(body.id, 'width', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="ft" />
                                            </Field>
                                            <Field label="Depth">
                                                <input value={body.depth} onChange={(event) => updateBody(body.id, 'depth', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="ft" />
                                            </Field>
                                        </div>

                                        <div className="mt-5">
                                            <Field label="Pool/spa notes">
                                                <textarea value={body.notes} onChange={(event) => updateBody(body.id, 'notes', event.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Anything else about this pool or spa." />
                                            </Field>
                                        </div>

                                        <div className="mt-5 border-t border-slate-200 pt-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <p className="text-sm font-semibold text-slate-800">Equipment</p>
                                                <button type="button" onClick={() => addEquipment(body.id)} className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-50">
                                                    <PlusIcon className="h-4 w-4" />
                                                    Add equipment
                                                </button>
                                            </div>
                                            <div className="mt-3 space-y-3">
                                                {body.equipment.length === 0 ? (
                                                    <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">Skip this if you are not sure what equipment is on site.</p>
                                                ) : body.equipment.map((equipment, equipmentIndex) => (
                                                    <div key={equipment.id} className="rounded-md border border-slate-200 bg-white p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <p className="text-sm font-semibold text-slate-800">Equipment #{equipmentIndex + 1}</p>
                                                            <button type="button" onClick={() => removeEquipment(body.id, equipment.id)} className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                                                                Remove
                                                            </button>
                                                        </div>
                                                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                            <Field label="Name">
                                                                <input value={equipment.name} onChange={(event) => updateEquipment(body.id, equipment.id, 'name', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Pump, filter, heater" />
                                                            </Field>
                                                            <Field label="Type">
                                                                <input value={equipment.type} onChange={(event) => updateEquipment(body.id, equipment.id, 'type', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                                            </Field>
                                                            <Field label="Make">
                                                                <input value={equipment.make} onChange={(event) => updateEquipment(body.id, equipment.id, 'make', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                                            </Field>
                                                            <Field label="Model">
                                                                <input value={equipment.model} onChange={(event) => updateEquipment(body.id, equipment.id, 'model', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                                                            </Field>
                                                        </div>
                                                        <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                                            <input type="checkbox" checked={equipment.needsService} onChange={(event) => updateEquipment(body.id, equipment.id, 'needsService', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-cyan-600" />
                                                            Needs service
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2">
                                <Field label="Trees around the pool">
                                    <input value={formData.treeTypes} onChange={(event) => updateField('treeTypes', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Palm, pine, oak, ficus, none" />
                                </Field>
                                <Field label="Tree debris">
                                    <div className="flex flex-wrap gap-2">
                                        {treeDebrisLevels.map((level) => (
                                            <SelectPill key={level} value={level} selected={formData.treeDebrisLevel === level} onSelect={(value) => updateField('treeDebrisLevel', value)} />
                                        ))}
                                    </div>
                                </Field>
                                <Field label="Overhanging trees or landscaping">
                                    <input value={formData.overhangingTrees} onChange={(event) => updateField('overhangingTrees', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Branches over pool, hedges nearby, none" />
                                </Field>
                                <Field label="Access notes">
                                    <input value={formData.accessNotes} onChange={(event) => updateField('accessNotes', event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Gate, parking, lockbox, pets" />
                                </Field>
                            </div>
                        </section>
                    )}

                    {step === 3 && (
                        <section className="mt-6 space-y-5">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Review</p>
                                <h2 className="mt-1 text-2xl font-bold text-slate-950">Send the request</h2>
                                <p className="mt-2 text-sm text-slate-600">The company receives this as a lead and can convert it into a customer record.</p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
                                    <p className="mt-2 font-semibold text-slate-900">{formData.homeownerName}</p>
                                    <p className="text-sm text-slate-600">{formData.homeownerEmail}</p>
                                    <p className="text-sm text-slate-600">{formData.homeownerPhone}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location</p>
                                    <p className="mt-2 font-semibold text-slate-900">{formData.streetAddress}</p>
                                    <p className="text-sm text-slate-600">{combineAddress(formData)}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Request</p>
                                    <p className="mt-2 font-semibold text-slate-900">{formData.serviceType}</p>
                                    {formData.serviceDescription && (
                                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{formData.serviceDescription}</p>
                                    )}
                                    <div className="mt-3 space-y-1 text-sm text-slate-600">
                                        {formData.bodiesOfWater.map((body) => (
                                            <p key={body.id}>
                                                {body.name || 'Pool / Spa'}: {summarizeBody(body)}
                                            </p>
                                        ))}
                                    </div>
                                    {(formData.treeTypes || formData.treeDebrisLevel) && (
                                        <p className="mt-2 text-sm text-slate-600">
                                            Trees: {[formData.treeTypes, formData.treeDebrisLevel ? `${formData.treeDebrisLevel} debris` : ''].filter(Boolean).join(' / ')}
                                        </p>
                                    )}
                                </div>
                            </div>
                            {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
                        </section>
                    )}

                    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                        <button
                            type="button"
                            onClick={() => setStep((current) => Math.max(current - 1, 0))}
                            disabled={step === 0 || submitting}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <ArrowLeftIcon className="h-4 w-4" />
                            Back
                        </button>

                        {step < 3 ? (
                            <button
                                type="button"
                                onClick={goNext}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700"
                            >
                                Next
                                <ArrowRightIcon className="h-4 w-4" />
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={submitting}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {submitting ? 'Sending...' : 'Send service request'}
                                <ArrowRightIcon className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </form>

                <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2">
                            <MapPinIcon className="h-5 w-5 text-cyan-600" />
                            <h2 className="text-base font-bold text-slate-950">Request summary</h2>
                        </div>
                        <dl className="mt-4 space-y-3 text-sm">
                            <div>
                                <dt className="font-semibold text-slate-500">Company</dt>
                                <dd className="mt-1 text-slate-900">{company?.name || 'Company'}</dd>
                            </div>
                            <div>
                                <dt className="font-semibold text-slate-500">Service</dt>
                                <dd className="mt-1 text-slate-900">{formData.serviceType}</dd>
                            </div>
                            <div>
                                <dt className="font-semibold text-slate-500">Location</dt>
                                <dd className="mt-1 text-slate-900">{formData.streetAddress || 'Not entered yet'}</dd>
                                {combineAddress(formData) && <dd className="text-slate-500">{combineAddress(formData)}</dd>}
                            </div>
                            <div>
                                <dt className="font-semibold text-slate-500">Pool/spa</dt>
                                <dd className="mt-1 text-slate-900">{summarizeBody(firstBody) || 'Not entered yet'}</dd>
                            </div>
                            <div>
                                <dt className="font-semibold text-slate-500">Trees</dt>
                                <dd className="mt-1 text-slate-900">{formData.treeTypes || formData.treeDebrisLevel || 'Not entered yet'}</dd>
                            </div>
                        </dl>
                    </div>

                    <div className="rounded-md border border-cyan-200 bg-cyan-50 p-5 text-sm text-cyan-950">
                        <div className="flex items-start gap-2">
                            <EnvelopeIcon className="mt-0.5 h-5 w-5 flex-none text-cyan-700" />
                            <p>
                                After submitting, you will get an email link to connect this request to a homeowner account.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
                        <div className="flex items-start gap-2">
                            <ClockIcon className="mt-0.5 h-5 w-5 flex-none text-amber-700" />
                            <p>
                                A quick estimate visit can confirm pool size, equipment, and water condition.
                            </p>
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    );
}
