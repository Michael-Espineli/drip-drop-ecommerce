import React from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowTopRightOnSquareIcon,
    BuildingOfficeIcon,
    CheckBadgeIcon,
    EnvelopeIcon,
    GlobeAltIcon,
    PhoneIcon,
} from '@heroicons/react/24/outline';

const profilePathFor = (companyId = '') => `/companies/profile/${companyId}`;

const textOrFallback = (value, fallback = '') => String(value || fallback || '').trim();

const safeExternalHref = (value) => {
    const text = textOrFallback(value);
    if (!text) return '';
    if (/^https?:\/\//i.test(text) || /^mailto:/i.test(text) || /^tel:/i.test(text)) return text;
    return `https://${text}`;
};

export const getCompanySummary = (company = {}) => ({
    id: company.id || company.companyId || '',
    name: textOrFallback(company.name || company.companyName, 'Company'),
    ownerName: textOrFallback(company.ownerName),
    photoUrl: company.photoUrl || company.logoUrl || '',
    phoneNumber: textOrFallback(company.phoneNumber || company.phone),
    email: textOrFallback(company.email),
    websiteURL: textOrFallback(company.websiteURL || company.website),
    bio: textOrFallback(company.bio),
    verified: Boolean(company.verified),
    services: Array.isArray(company.services) ? company.services.filter(Boolean) : [],
});

const CompanyAvatar = ({ company }) => (
    <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full border border-gray-200 bg-gray-100">
        {company.photoUrl ? (
            <img src={company.photoUrl} alt={`${company.name} profile`} className="h-full w-full object-cover" />
        ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500">
                <BuildingOfficeIcon className="h-7 w-7" />
            </div>
        )}
    </div>
);

const CompanySummaryCard = ({ company, companyId, compact = false }) => {
    const summary = getCompanySummary({
        ...company,
        id: company?.id || companyId || company?.companyId || '',
    });
    const profilePath = summary.id ? profilePathFor(summary.id) : '';
    const visibleServices = summary.services.slice(0, compact ? 2 : 4);
    const websiteHref = safeExternalHref(summary.websiteURL);

    return (
        <div className={compact ? 'min-w-[18rem]' : 'rounded-lg border border-gray-200 bg-white p-4 shadow-sm'}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-4">
                    <CompanyAvatar company={summary} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            {compact ? (
                                <div className="text-sm font-semibold text-gray-900">{summary.name}</div>
                            ) : (
                                <h2 className="text-lg font-bold text-gray-900">{summary.name}</h2>
                            )}
                            {summary.verified && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                    <CheckBadgeIcon className="h-4 w-4" />
                                    Verified
                                </span>
                            )}
                        </div>
                        {summary.ownerName && (
                            <p className="mt-1 text-sm text-gray-600">Owner: {summary.ownerName}</p>
                        )}
                        {summary.bio && !compact && (
                            <p className="mt-2 line-clamp-2 text-sm text-gray-600">{summary.bio}</p>
                        )}
                    </div>
                </div>

                {profilePath && (
                    <Link
                        to={profilePath}
                        className={compact
                            ? 'inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-800'
                            : 'inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100'}
                    >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                        {compact ? 'Profile' : 'View Profile'}
                    </Link>
                )}
            </div>

            <div className={compact ? 'mt-3 grid gap-1 text-xs text-gray-600' : 'mt-4 grid gap-2 text-sm text-gray-700 sm:grid-cols-2'}>
                {summary.phoneNumber && (
                    <a href={`tel:${summary.phoneNumber}`} className="inline-flex items-center gap-2 hover:text-blue-700">
                        <PhoneIcon className="h-4 w-4 text-gray-400" />
                        {summary.phoneNumber}
                    </a>
                )}
                {summary.email && (
                    <a href={`mailto:${summary.email}`} className="inline-flex items-center gap-2 break-all hover:text-blue-700">
                        <EnvelopeIcon className="h-4 w-4 text-gray-400" />
                        {summary.email}
                    </a>
                )}
                {summary.websiteURL && websiteHref && (
                    <a
                        href={websiteHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 break-all hover:text-blue-700"
                    >
                        <GlobeAltIcon className="h-4 w-4 text-gray-400" />
                        Website
                    </a>
                )}
            </div>

            {visibleServices.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {visibleServices.map((service) => (
                        <span key={service} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                            {service}
                        </span>
                    ))}
                    {summary.services.length > visibleServices.length && (
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">
                            +{summary.services.length - visibleServices.length} more
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default CompanySummaryCard;
