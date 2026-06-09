import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
    ArrowRightIcon,
    BuildingOffice2Icon,
    CheckCircleIcon,
    ClipboardDocumentIcon,
    GlobeAltIcon,
    MagnifyingGlassIcon,
    MapPinIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { functions } from '../../utils/config';

const safeExternalHref = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(https?:|mailto:|tel:)/i.test(text)) return text;
    return `https://${text}`;
};

const companyLocationLabel = (company = {}) => {
    const areas = Array.isArray(company.serviceAreas) ? company.serviceAreas : [];
    const zips = Array.isArray(company.serviceZipCodes) ? company.serviceZipCodes : [];

    if (company.region) return company.region;
    if (areas.length > 0) return areas.slice(0, 3).join(', ');
    if (zips.length > 0) return `Zip codes: ${zips.slice(0, 4).join(', ')}`;
    return 'Service area listed on profile';
};

const filterCompanies = (companies, searchTerm) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return companies;

    return companies.filter((company) => {
        const searchableText = [
            company.name,
            company.bio,
            company.region,
            ...(company.services || []),
            ...(company.serviceAreas || []),
            ...(company.serviceZipCodes || []),
        ].join(' ').toLowerCase();

        return searchableText.includes(term);
    });
};

const CompanyLogo = ({ company }) => (
    <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-md border border-cyan-100 bg-cyan-50">
        {company.logoUrl || company.photoUrl ? (
            <img src={company.logoUrl || company.photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
            <BuildingOffice2Icon className="h-9 w-9 text-cyan-600" />
        )}
    </div>
);

const SkeletonCard = () => (
    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex animate-pulse gap-4">
            <div className="h-16 w-16 rounded-md bg-slate-200" />
            <div className="flex-1 space-y-3">
                <div className="h-5 w-3/5 rounded bg-slate-200" />
                <div className="h-4 w-4/5 rounded bg-slate-200" />
                <div className="h-4 w-2/3 rounded bg-slate-200" />
            </div>
        </div>
    </div>
);

export default function Companies() {
    const [companies, setCompanies] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const loadCompanies = async () => {
            setLoading(true);
            setError('');

            try {
                const callable = httpsCallable(functions, 'listPublicCompanies');
                const result = await callable({
                    baseUrl: window.location.origin,
                    limit: 120,
                });
                const response = result.data || {};

                if (response.status !== 200) {
                    throw new Error(response.error || 'Could not load companies.');
                }

                if (!cancelled) setCompanies(Array.isArray(response.companies) ? response.companies : []);
            } catch (loadError) {
                console.error('Failed to load public companies', loadError);
                if (!cancelled) setError(loadError.message || 'Could not load companies.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadCompanies();

        return () => {
            cancelled = true;
        };
    }, []);

    const visibleCompanies = useMemo(() => (
        filterCompanies(companies, searchTerm)
    ), [companies, searchTerm]);

    const copyProfileLink = async (event, profileUrl) => {
        event.preventDefault();
        event.stopPropagation();

        try {
            await navigator.clipboard.writeText(profileUrl);
            toast.success('Public profile link copied.');
        } catch (copyError) {
            console.error('Could not copy public profile link', copyError);
            toast.error('Could not copy the profile link.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <header className="fixed left-0 right-0 top-0 z-50 bg-cyan-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <main className="pt-24">
                <section className="bg-gradient-to-b from-cyan-600 to-blue-700 text-white">
                    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
                        <p className="text-sm font-bold uppercase tracking-wide text-cyan-100">Company directory</p>
                        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
                            <div>
                                <h1 className="max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
                                    Find a pool company that runs on Drip Drop.
                                </h1>
                                <p className="mt-4 max-w-2xl text-base leading-7 text-cyan-50 sm:text-lg">
                                    Browse public company profiles, review service details, and request service without creating an account first.
                                </p>
                            </div>
                            <div className="rounded-md border border-white/20 bg-white/10 p-5 shadow-sm backdrop-blur">
                                <div className="flex items-start gap-3">
                                    <SparklesIcon className="mt-0.5 h-5 w-5 flex-none text-cyan-100" />
                                    <p className="text-sm font-semibold leading-6 text-cyan-50">
                                        Public profiles include the company request link, so homeowners can start from a directory, profile page, email, or shared link.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="border-b border-slate-200 bg-white">
                    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
                        <label htmlFor="company-search" className="sr-only">Search companies</label>
                        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 focus-within:border-cyan-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-cyan-100">
                            <MagnifyingGlassIcon className="h-5 w-5 flex-none text-cyan-600" />
                            <input
                                id="company-search"
                                type="search"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Search by company, service, city, region, or zip code"
                                className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                            />
                        </div>
                    </div>
                </section>

                <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
                    {error && (
                        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
                            {error}
                        </div>
                    )}

                    {!error && (
                        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-slate-950">Companies</h2>
                                <p className="mt-1 text-sm text-slate-600">
                                    {loading ? 'Loading public profiles...' : `${visibleCompanies.length} public profile${visibleCompanies.length === 1 ? '' : 's'} found`}
                                </p>
                            </div>
                            <Link to="/homeowners" className="text-sm font-semibold text-cyan-700 hover:text-cyan-900">
                                Homeowner portal
                            </Link>
                        </div>
                    )}

                    {loading ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <SkeletonCard key={index} />
                            ))}
                        </div>
                    ) : visibleCompanies.length === 0 && !error ? (
                        <div className="rounded-md border border-slate-200 bg-white p-8 text-center shadow-sm">
                            <BuildingOffice2Icon className="mx-auto h-12 w-12 text-cyan-600" />
                            <h2 className="mt-4 text-xl font-bold text-slate-950">No companies found</h2>
                            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
                                Try a different company name, service area, or zip code.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            {visibleCompanies.map((company) => {
                                const profilePath = `/companies/profile/${company.id}`;
                                const requestPath = `/request-service/${company.id}`;
                                const websiteHref = safeExternalHref(company.website || company.websiteURL);
                                const services = Array.isArray(company.services) ? company.services.slice(0, 4) : [];

                                return (
                                    <article key={company.id} className="flex h-full flex-col rounded-md border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-200 hover:shadow-md">
                                        <div className="flex items-start gap-4">
                                            <CompanyLogo company={company} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="truncate text-xl font-bold text-slate-950">{company.name || 'Pool company'}</h3>
                                                    {company.verified && (
                                                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                                            <CheckCircleIcon className="h-3.5 w-3.5" />
                                                            Verified
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                                                    {company.bio || 'This company can receive pool and spa service requests through Drip Drop.'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-start gap-2 text-sm font-semibold text-slate-700">
                                            <MapPinIcon className="mt-0.5 h-4 w-4 flex-none text-cyan-600" />
                                            <span>{companyLocationLabel(company)}</span>
                                        </div>

                                        {services.length > 0 && (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {services.map((service) => (
                                                    <span key={service} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-900">
                                                        {service}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="mt-auto pt-5">
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <Link to={profilePath} className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700">
                                                    Public profile
                                                    <ArrowRightIcon className="h-4 w-4" />
                                                </Link>
                                                <Link to={requestPath} className="inline-flex items-center justify-center rounded-md border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-semibold text-cyan-900 hover:bg-cyan-100">
                                                    Request service
                                                </Link>
                                            </div>

                                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                                                <button
                                                    type="button"
                                                    onClick={(event) => copyProfileLink(event, company.profileUrl)}
                                                    className="inline-flex items-center gap-1.5 text-slate-600 hover:text-cyan-800"
                                                >
                                                    <ClipboardDocumentIcon className="h-4 w-4" />
                                                    Copy public link
                                                </button>
                                                {websiteHref && (
                                                    <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-cyan-800">
                                                        <GlobeAltIcon className="h-4 w-4" />
                                                        Website
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            <Footer />
        </div>
    );
}
