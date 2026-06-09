import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
    ArrowTopRightOnSquareIcon,
    BuildingOffice2Icon,
    CheckCircleIcon,
    ClipboardDocumentIcon,
    EyeSlashIcon,
    GlobeAltIcon,
    MapPinIcon,
    PhotoIcon,
} from '@heroicons/react/24/outline';
import useCompanyProfile from '../../hooks/useCompanyProfile';
import { Context } from '../../context/AuthContext';
import { db } from '../../utils/config';
import { MultiLocationMap } from '../components/MultiLocationMap';

const GOOGLE_MAPS_GEOCODE_KEY = 'AIzaSyCeLjQNGFZ6W7pIYIXECBq7N47TBNKhivE';

const emptyCompany = {
    name: '',
    bio: '',
    services: [],
    serviceAreas: [],
    serviceZipCodes: [],
    region: '',
    phoneNumber: '',
    email: '',
    websiteURL: '',
    yelpURL: '',
    photoUrl: '',
    logoUrl: '',
    publicHeaderImageUrl: '',
    hideFromBrowse: false,
};

const toList = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }

    return [];
};

const listToText = (value) => toList(value).join(', ');

const firstText = (...values) => {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }

    return '';
};

const safeExternalHref = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(https?:|mailto:|tel:)/i.test(text)) return text;
    return `https://${text}`;
};

const normalizeCompany = (company = {}, companyId = '') => ({
    ...emptyCompany,
    ...company,
    id: company.id || companyId,
    services: toList(company.services),
    serviceAreas: toList(company.serviceAreas),
    serviceZipCodes: toList(company.serviceZipCodes),
    publicHeaderImageUrl: firstText(
        company.publicHeaderImageUrl,
        company.headerImageUrl,
        company.coverPhotoUrl,
        company.coverImageUrl,
        company.backgroundImageUrl
    ),
});

const TextInput = ({ label, name, value, onChange, type = 'text', placeholder = '' }) => (
    <label className="block">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <input
            type={type}
            name={name}
            value={value || ''}
            onChange={onChange}
            placeholder={placeholder}
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
    </label>
);

const TextArea = ({ label, name, value, onChange, rows = 4, placeholder = '' }) => (
    <label className="block">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <textarea
            name={name}
            value={value || ''}
            onChange={onChange}
            rows={rows}
            placeholder={placeholder}
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
    </label>
);

const PublicHeroPreview = ({ company, publicProfilePath, requestServicePath }) => {
    const headerImageUrl = firstText(company.publicHeaderImageUrl);
    const logoUrl = firstText(company.logoUrl, company.photoUrl);
    const heroStyle = headerImageUrl
        ? { backgroundImage: `linear-gradient(90deg, rgba(15, 23, 42, 0.78), rgba(8, 145, 178, 0.45)), url("${headerImageUrl}")` }
        : { backgroundImage: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)' };

    return (
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="min-h-[22rem] bg-cover bg-center" style={heroStyle}>
                <div className="flex min-h-[22rem] items-end px-5 py-8 sm:px-8">
                    <div className="max-w-3xl text-white">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                            <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-md border border-white/40 bg-white/90 shadow-sm">
                                {logoUrl ? (
                                    <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <BuildingOffice2Icon className="h-11 w-11 text-cyan-700" />
                                )}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-bold uppercase tracking-wide text-cyan-50">Public company profile</p>
                                    {company.verified && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
                                            <CheckCircleIcon className="h-4 w-4" />
                                            Verified
                                        </span>
                                    )}
                                </div>
                                <h1 className="mt-2 text-3xl font-bold sm:text-5xl">{company.name || 'Pool service company'}</h1>
                            </div>
                        </div>
                        <p className="mt-5 max-w-2xl text-base leading-7 text-cyan-50">
                            {company.bio || `${company.name || 'This company'} can receive pool and spa service requests through Drip Drop.`}
                        </p>
                        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                            <Link to={requestServicePath} className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-cyan-800 hover:bg-cyan-50">
                                Request service
                            </Link>
                            <Link to={publicProfilePath} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/40 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20">
                                View live profile
                                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

const ServiceAreaMap = ({ company, mapLocations, mapError }) => {
    const hasMap = typeof window !== 'undefined' && window.google?.maps && mapLocations.length > 0;
    const hasServiceAreas = company.region || company.serviceAreas.length > 0 || company.serviceZipCodes.length > 0;

    return (
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
                <MapPinIcon className="h-5 w-5 text-cyan-600" />
                <h2 className="text-lg font-bold text-slate-950">Service area</h2>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-h-[400px] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    {hasMap ? (
                        <MultiLocationMap locations={mapLocations} />
                    ) : (
                        <div className="flex h-[400px] items-center justify-center px-5 text-center text-sm font-semibold text-slate-500">
                            {mapError || (hasServiceAreas ? 'Map preview will appear when the service areas can be geocoded.' : 'Add zip codes or service areas to preview the map.')}
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Region</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{company.region || 'Not listed'}</p>
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Service areas</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {company.serviceAreas.length > 0 ? company.serviceAreas.map((area) => (
                                <span key={area} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{area}</span>
                            )) : <span className="text-sm text-slate-500">Not listed</span>}
                        </div>
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Zip codes</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {company.serviceZipCodes.length > 0 ? company.serviceZipCodes.map((zip) => (
                                <span key={zip} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-900">{zip}</span>
                            )) : <span className="text-sm text-slate-500">Not listed</span>}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default function PublicPage() {
    const { recentlySelectedCompany } = useContext(Context);
    const { company, loading, error } = useCompanyProfile();
    const [formData, setFormData] = useState(() => normalizeCompany({}, recentlySelectedCompany));
    const [originalData, setOriginalData] = useState(() => normalizeCompany({}, recentlySelectedCompany));
    const [saving, setSaving] = useState(false);
    const [mapLocations, setMapLocations] = useState([]);
    const [mapError, setMapError] = useState('');

    useEffect(() => {
        if (!company && !recentlySelectedCompany) return;
        const nextCompany = normalizeCompany(company || {}, recentlySelectedCompany);
        setFormData(nextCompany);
        setOriginalData(nextCompany);
    }, [company, recentlySelectedCompany]);

    const publicProfilePath = useMemo(() => (
        formData.id ? `/companies/profile/${formData.id}` : '/companies'
    ), [formData.id]);

    const requestServicePath = useMemo(() => (
        formData.id ? `/request-service/${formData.id}` : '/companies'
    ), [formData.id]);

    const publicProfileUrl = useMemo(() => (
        typeof window !== 'undefined' ? `${window.location.origin}${publicProfilePath}` : publicProfilePath
    ), [publicProfilePath]);

    const requestServiceUrl = useMemo(() => (
        typeof window !== 'undefined' ? `${window.location.origin}${requestServicePath}` : requestServicePath
    ), [requestServicePath]);

    const serviceAreaQueries = useMemo(() => {
        const zipCodes = toList(formData.serviceZipCodes);
        if (zipCodes.length > 0) return zipCodes;

        return [
            ...toList(formData.serviceAreas),
            formData.region,
        ].map((item) => String(item || '').trim()).filter(Boolean);
    }, [formData.serviceAreas, formData.serviceZipCodes, formData.region]);

    useEffect(() => {
        let cancelled = false;

        const loadMapLocations = async () => {
            setMapError('');

            if (serviceAreaQueries.length === 0) {
                setMapLocations([]);
                return;
            }

            try {
                const locations = await Promise.all(
                    serviceAreaQueries.slice(0, 25).map(async (area) => {
                        const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(area)}&key=${GOOGLE_MAPS_GEOCODE_KEY}`);
                        const data = await response.json();
                        if (data.status !== 'OK') return null;

                        const { lat, lng } = data.results[0].geometry.location;
                        return { latitude: lat, longitude: lng };
                    })
                );

                if (!cancelled) setMapLocations(locations.filter(Boolean));
            } catch (mapLoadError) {
                console.error('Error loading service area map preview', mapLoadError);
                if (!cancelled) {
                    setMapLocations([]);
                    setMapError('Could not load the service area map.');
                }
            }
        };

        loadMapLocations();

        return () => {
            cancelled = true;
        };
    }, [serviceAreaQueries]);

    const hasChanges = useMemo(() => (
        JSON.stringify(formData) !== JSON.stringify(originalData)
    ), [formData, originalData]);

    const handleFieldChange = (event) => {
        const { name, value, type, checked } = event.target;
        setFormData((current) => ({
            ...current,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleListChange = (name) => (event) => {
        setFormData((current) => ({
            ...current,
            [name]: toList(event.target.value),
        }));
    };

    const copyLink = async (url, label) => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success(`${label} copied.`);
        } catch (copyError) {
            console.error(`Could not copy ${label}`, copyError);
            toast.error(`Could not copy ${label}.`);
        }
    };

    const handleReset = () => {
        setFormData(originalData);
    };

    const handleSave = async () => {
        if (!recentlySelectedCompany) {
            toast.error('Select a company before saving.');
            return;
        }

        setSaving(true);
        const toastId = toast.loading('Saving public page...');

        try {
            const payload = {
                name: String(formData.name || '').trim(),
                bio: String(formData.bio || '').trim(),
                services: toList(formData.services),
                serviceAreas: toList(formData.serviceAreas),
                serviceZipCodes: toList(formData.serviceZipCodes),
                region: String(formData.region || '').trim(),
                phoneNumber: String(formData.phoneNumber || '').trim(),
                email: String(formData.email || '').trim(),
                websiteURL: String(formData.websiteURL || '').trim(),
                yelpURL: String(formData.yelpURL || '').trim(),
                photoUrl: String(formData.photoUrl || '').trim(),
                logoUrl: String(formData.logoUrl || '').trim(),
                publicHeaderImageUrl: String(formData.publicHeaderImageUrl || '').trim(),
                hideFromBrowse: Boolean(formData.hideFromBrowse),
                updatedAt: serverTimestamp(),
            };

            await updateDoc(doc(db, 'companies', recentlySelectedCompany), payload);

            const savedData = normalizeCompany({ ...formData, ...payload }, recentlySelectedCompany);
            setFormData(savedData);
            setOriginalData(savedData);
            toast.success('Public page saved.', { id: toastId });
        } catch (saveError) {
            console.error('Error saving public page', saveError);
            toast.error('Could not save public page.', { id: toastId });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
                Loading public page...
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
                <div className="rounded-md border border-rose-200 bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-bold text-slate-950">Public page unavailable</h1>
                    <p className="mt-2 text-sm text-slate-600">{error}</p>
                </div>
            </div>
        );
    }

    const websiteHref = safeExternalHref(formData.websiteURL);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Company public page</p>
                        <h1 className="text-2xl font-bold text-slate-950">Manage public profile</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => copyLink(publicProfileUrl, 'Public profile link')}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            <ClipboardDocumentIcon className="h-4 w-4" />
                            Copy profile
                        </button>
                        <button
                            type="button"
                            onClick={() => copyLink(requestServiceUrl, 'Request service link')}
                            className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100"
                        >
                            <ClipboardDocumentIcon className="h-4 w-4" />
                            Copy request
                        </button>
                        <Link to={publicProfilePath} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                            View live
                        </Link>
                        <button
                            type="button"
                            onClick={handleReset}
                            disabled={!hasChanges || saving}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!hasChanges || saving}
                            className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
                <PublicHeroPreview company={formData} publicProfilePath={publicProfilePath} requestServicePath={requestServicePath} />

                <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
                    <div className="space-y-6">
                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <BuildingOffice2Icon className="h-5 w-5 text-cyan-600" />
                                <h2 className="text-lg font-bold text-slate-950">Profile details</h2>
                            </div>
                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                                <TextInput label="Company name" name="name" value={formData.name} onChange={handleFieldChange} />
                                <TextInput label="Region" name="region" value={formData.region} onChange={handleFieldChange} placeholder="San Diego County" />
                                <div className="md:col-span-2">
                                    <TextArea label="Bio" name="bio" value={formData.bio} onChange={handleFieldChange} rows={5} placeholder="What should homeowners know about your company?" />
                                </div>
                                <div className="md:col-span-2">
                                    <TextArea label="Services" name="services" value={listToText(formData.services)} onChange={handleListChange('services')} rows={3} placeholder="Weekly service, equipment repair, green pool cleanup" />
                                </div>
                            </div>
                        </section>

                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <PhotoIcon className="h-5 w-5 text-cyan-600" />
                                <h2 className="text-lg font-bold text-slate-950">Branding</h2>
                            </div>
                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                                <TextInput label="Logo URL" name="logoUrl" value={formData.logoUrl} onChange={handleFieldChange} placeholder="https://..." />
                                <TextInput label="Profile photo URL" name="photoUrl" value={formData.photoUrl} onChange={handleFieldChange} placeholder="https://..." />
                                <div className="md:col-span-2">
                                    <TextInput label="Header background image URL" name="publicHeaderImageUrl" value={formData.publicHeaderImageUrl} onChange={handleFieldChange} placeholder="https://..." />
                                </div>
                            </div>
                        </section>

                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <GlobeAltIcon className="h-5 w-5 text-cyan-600" />
                                <h2 className="text-lg font-bold text-slate-950">Contact and links</h2>
                            </div>
                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                                <TextInput label="Phone" name="phoneNumber" value={formData.phoneNumber} onChange={handleFieldChange} type="tel" />
                                <TextInput label="Email" name="email" value={formData.email} onChange={handleFieldChange} type="email" />
                                <TextInput label="Website" name="websiteURL" value={formData.websiteURL} onChange={handleFieldChange} type="url" placeholder="https://..." />
                                <TextInput label="Yelp URL" name="yelpURL" value={formData.yelpURL} onChange={handleFieldChange} type="url" placeholder="https://..." />
                            </div>
                        </section>

                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <MapPinIcon className="h-5 w-5 text-cyan-600" />
                                <h2 className="text-lg font-bold text-slate-950">Service area settings</h2>
                            </div>
                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                                <TextArea label="Service areas" name="serviceAreas" value={listToText(formData.serviceAreas)} onChange={handleListChange('serviceAreas')} rows={3} placeholder="La Mesa, El Cajon, Spring Valley" />
                                <TextArea label="Service zip codes" name="serviceZipCodes" value={listToText(formData.serviceZipCodes)} onChange={handleListChange('serviceZipCodes')} rows={3} placeholder="91942, 91941, 92020" />
                            </div>
                        </section>
                    </div>

                    <aside className="space-y-4">
                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 className="text-lg font-bold text-slate-950">Published links</h2>
                            <div className="mt-4 space-y-3">
                                <a href={publicProfileUrl} target="_blank" rel="noopener noreferrer" className="block break-all rounded-md border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 hover:bg-cyan-50">
                                    {publicProfileUrl}
                                </a>
                                <a href={requestServiceUrl} target="_blank" rel="noopener noreferrer" className="block break-all rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm font-semibold text-cyan-900 hover:bg-cyan-100">
                                    {requestServiceUrl}
                                </a>
                                {websiteHref && (
                                    <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 hover:text-cyan-900">
                                        Company website
                                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                    </a>
                                )}
                            </div>
                        </section>

                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <label className="flex items-start gap-3">
                                <input
                                    type="checkbox"
                                    name="hideFromBrowse"
                                    checked={Boolean(formData.hideFromBrowse)}
                                    onChange={handleFieldChange}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                                />
                                <span>
                                    <span className="flex items-center gap-2 text-sm font-bold text-slate-950">
                                        <EyeSlashIcon className="h-4 w-4 text-slate-500" />
                                        Hide from directory
                                    </span>
                                    <span className="mt-1 block text-sm text-slate-600">
                                        Direct profile and request links still work.
                                    </span>
                                </span>
                            </label>
                        </section>
                    </aside>
                </section>

                <ServiceAreaMap company={formData} mapLocations={mapLocations} mapError={mapError} />
            </main>
        </div>
    );
}
