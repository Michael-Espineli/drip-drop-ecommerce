import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
    ArrowRightIcon,
    BuildingOffice2Icon,
    CheckCircleIcon,
    ClipboardDocumentIcon,
    EnvelopeIcon,
    GlobeAltIcon,
    MapPinIcon,
    PhoneIcon,
    SparklesIcon,
    WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { functions } from '../../utils/config';

const safeExternalHref = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(https?:|mailto:|tel:)/i.test(text)) return text;
    return `https://${text}`;
};

const InfoLink = ({ icon: Icon, label, value, href }) => {
    if (!value) return null;
    const content = (
        <>
            <Icon className="h-5 w-5 flex-none text-cyan-600" />
            <span className="min-w-0">
                <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
                <span className="mt-1 block break-words text-sm font-semibold text-slate-950">{value}</span>
            </span>
        </>
    );

    if (!href) {
        return (
            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4">
                {content}
            </div>
        );
    }

    return (
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noopener noreferrer' : undefined} className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4 transition hover:border-cyan-200 hover:bg-cyan-50">
            {content}
        </a>
    );
};

export default function CompanyPublicProfile() {
    const { companyId } = useParams();
    const [company, setCompany] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const requestUrl = useMemo(() => (
        companyId && typeof window !== 'undefined'
            ? `${window.location.origin}/request-service/${companyId}`
            : ''
    ), [companyId]);
    const profileUrl = useMemo(() => (
        companyId && typeof window !== 'undefined'
            ? `${window.location.origin}/companies/profile/${companyId}`
            : ''
    ), [companyId]);

    useEffect(() => {
        let cancelled = false;

        const loadCompany = async () => {
            if (!companyId) {
                setError('This company profile link is missing the company id.');
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
                    throw new Error(response.error || 'Could not load this company profile.');
                }

                if (!cancelled) setCompany(response.company || {});
            } catch (loadError) {
                console.error('Failed to load public company profile', loadError);
                if (!cancelled) setError(loadError.message || 'Could not load this company profile.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadCompany();

        return () => {
            cancelled = true;
        };
    }, [companyId]);

    const copyRequestLink = async () => {
        try {
            await navigator.clipboard.writeText(requestUrl);
            toast.success('Request link copied.');
        } catch (copyError) {
            console.error('Could not copy company request link', copyError);
            toast.error('Could not copy the request link.');
        }
    };

    const copyProfileLink = async () => {
        try {
            await navigator.clipboard.writeText(profileUrl);
            toast.success('Public profile link copied.');
        } catch (copyError) {
            console.error('Could not copy company profile link', copyError);
            toast.error('Could not copy the profile link.');
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
                Loading company profile...
            </div>
        );
    }

    if (error || !company) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
                <div className="w-full max-w-md rounded-md border border-rose-200 bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-bold text-slate-950">Company profile unavailable</h1>
                    <p className="mt-2 text-sm text-slate-600">{error || 'This company profile could not be loaded.'}</p>
                    <Link to="/" className="mt-5 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        Drip Drop home
                    </Link>
                </div>
            </div>
        );
    }

    const websiteHref = safeExternalHref(company.website || company.websiteURL);
    const services = Array.isArray(company.services) ? company.services : [];
    const serviceAreas = Array.isArray(company.serviceAreas) ? company.serviceAreas : [];
    const zipCodes = Array.isArray(company.serviceZipCodes) ? company.serviceZipCodes : [];
    const headerImageUrl = company.publicHeaderImageUrl || company.headerImageUrl || company.coverPhotoUrl || company.coverImageUrl || '';
    const logoUrl = company.logoUrl || company.photoUrl || '';
    const heroStyle = headerImageUrl
        ? { backgroundImage: `linear-gradient(90deg, rgba(15, 23, 42, 0.78), rgba(8, 145, 178, 0.45)), url("${headerImageUrl}")` }
        : { backgroundImage: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)' };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
                    <Link to="/" className="text-xl font-bold text-cyan-700">Drip Drop</Link>
                    <div className="flex items-center gap-2">
                        <Link to="/companies" className="hidden rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 md:inline-flex">
                            Companies
                        </Link>
                        <Link to={`/request-service/${company.id}`} className="hidden rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100 sm:inline-flex">
                            Request service
                        </Link>
                        <button
                            type="button"
                            onClick={copyProfileLink}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            <ClipboardDocumentIcon className="h-4 w-4" />
                            Copy profile
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
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
                                    <Link to={`/request-service/${company.id}`} className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-cyan-800 shadow-sm hover:bg-cyan-50">
                                        Request service
                                        <ArrowRightIcon className="h-4 w-4" />
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={copyRequestLink}
                                        className="inline-flex items-center justify-center gap-2 rounded-md border border-white/40 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20"
                                    >
                                        Copy request link
                                        <ClipboardDocumentIcon className="h-4 w-4" />
                                    </button>
                                    {websiteHref && (
                                        <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-md border border-white/40 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20">
                                            Visit website
                                            <GlobeAltIcon className="h-4 w-4" />
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <div className="space-y-6">
                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <WrenchScrewdriverIcon className="h-5 w-5 text-cyan-600" />
                                <h2 className="text-lg font-bold text-slate-950">Services</h2>
                            </div>
                            {services.length > 0 ? (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {services.map((service) => (
                                        <span key={service} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-semibold text-cyan-900">
                                            {service}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-slate-600">Service details have not been published yet.</p>
                            )}
                        </section>

                        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-2">
                                <MapPinIcon className="h-5 w-5 text-cyan-600" />
                                <h2 className="text-lg font-bold text-slate-950">Service area</h2>
                            </div>
                            <div className="mt-4 space-y-3">
                                {company.region && <p className="text-sm font-semibold text-slate-900">{company.region}</p>}
                                {serviceAreas.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {serviceAreas.map((area) => (
                                            <span key={area} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
                                                {area}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {zipCodes.length > 0 && (
                                    <p className="text-sm text-slate-600">Zip codes: {zipCodes.slice(0, 12).join(', ')}{zipCodes.length > 12 ? '...' : ''}</p>
                                )}
                                {!company.region && serviceAreas.length === 0 && zipCodes.length === 0 && (
                                    <p className="text-sm text-slate-600">Service area details have not been published yet.</p>
                                )}
                            </div>
                        </section>
                    </div>

                    <aside className="space-y-4">
                        <InfoLink icon={PhoneIcon} label="Phone" value={company.phone || company.phoneNumber} href={company.phone ? `tel:${company.phone}` : ''} />
                        <InfoLink icon={EnvelopeIcon} label="Email" value={company.email} href={company.email ? `mailto:${company.email}` : ''} />
                        <InfoLink icon={GlobeAltIcon} label="Website" value={company.website || company.websiteURL} href={websiteHref} />

                        <div className="rounded-md border border-amber-200 bg-amber-50 p-5">
                            <div className="flex items-start gap-2">
                                <SparklesIcon className="mt-0.5 h-5 w-5 flex-none text-amber-700" />
                                <p className="text-sm font-semibold text-amber-950">
                                    You can request service without creating an account first. Drip Drop sends an email link after submission so the homeowner can connect the request later.
                                </p>
                            </div>
                        </div>
                    </aside>
                </section>
            </main>
        </div>
    );
}
