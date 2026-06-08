import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
    ArrowLeftIcon,
    ArrowTopRightOnSquareIcon,
    BuildingOffice2Icon,
    ChatBubbleBottomCenterTextIcon,
    CheckCircleIcon,
    EnvelopeIcon,
    GlobeAltIcon,
    MapPinIcon,
    PhoneIcon,
    StarIcon,
    UserGroupIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../context/AuthContext';
import { db } from '../../utils/config';

const toDate = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'number' || typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const formatDate = (value) => {
    const date = toDate(value);
    if (!date) return 'Recently';
    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
};

const listFromValue = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
};

const averageRating = (reviews) => {
    const ratings = reviews.map(review => Number(review.rating)).filter(Number.isFinite);
    if (!ratings.length) return null;
    return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
};

const safeExternalHref = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text) || /^mailto:/i.test(text) || /^tel:/i.test(text)) return text;
    return `https://${text}`;
};

const DetailItem = ({ icon: Icon, label, value, href }) => {
    const formattedValue = String(value || '').trim();
    if (!formattedValue) return null;

    return (
        <div className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <Icon className="mt-0.5 h-5 w-5 flex-none text-slate-400" />
            <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="mt-1 block break-words text-sm font-semibold text-blue-600 hover:text-blue-700">
                        {formattedValue}
                    </a>
                ) : (
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{formattedValue}</div>
                )}
            </div>
        </div>
    );
};

const CompanyDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useContext(Context);
    const [company, setCompany] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const fetchCompany = async () => {
            if (!id) {
                setLoading(false);
                setError('Company not found.');
                return;
            }

            setLoading(true);
            setError('');

            try {
                const companyDocSnap = await getDoc(doc(db, 'companies', id));

                if (!companyDocSnap.exists()) {
                    if (!cancelled) {
                        setCompany(null);
                        setReviews([]);
                        setError('Company not found.');
                    }
                    return;
                }

                const reviewsSnapshot = await getDocs(collection(db, 'companies', id, 'reviews'));
                const reviewsList = reviewsSnapshot.docs
                    .map(reviewDoc => ({ id: reviewDoc.id, ...reviewDoc.data() }))
                    .sort((a, b) => {
                        const bTime = toDate(b.createdAt || b.dateCreated)?.getTime() || 0;
                        const aTime = toDate(a.createdAt || a.dateCreated)?.getTime() || 0;
                        return bTime - aTime;
                    });

                if (!cancelled) {
                    setCompany({ id: companyDocSnap.id, ...companyDocSnap.data() });
                    setReviews(reviewsList);
                }
            } catch (err) {
                console.error('Error fetching company details: ', err);
                if (!cancelled) {
                    setCompany(null);
                    setReviews([]);
                    setError('Company details could not be loaded.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchCompany();

        return () => {
            cancelled = true;
        };
    }, [id]);

    const services = useMemo(() => listFromValue(company?.services), [company?.services]);
    const serviceAreas = useMemo(
        () => listFromValue(company?.serviceZipCodes || company?.serviceAreas || company?.serviceArea),
        [company?.serviceArea, company?.serviceAreas, company?.serviceZipCodes]
    );
    const rating = useMemo(() => averageRating(reviews), [reviews]);
    const description = company?.bio || company?.description || company?.about || '';
    const website = company?.websiteURL || company?.website || '';

    const handleInitiateChat = () => {
        if (!user || !company) return;
        navigate(`/company/chat/initiate/${company.ownerId}`);
    };

    if (loading) {
        return (
            <div className="flex min-h-screen w-full items-center justify-center bg-slate-50">
                <p className="text-lg text-slate-600">Loading company details...</p>
            </div>
        );
    }

    if (!company) {
        return (
            <div className="flex min-h-screen w-full items-center justify-center bg-slate-50">
                <div className="text-center">
                    <p className="mb-4 text-lg text-slate-600">{error || 'Company not found.'}</p>
                    <Link to="/browse-companies" className="text-blue-600 hover:underline">
                        Back to Browse Companies
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl space-y-6">
                <Link to="/browse-companies" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
                    <ArrowLeftIcon className="h-4 w-4" />
                    Back to Browse
                </Link>

                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-900 px-6 py-8 text-white lg:px-8">
                        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex min-w-0 gap-5">
                                <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white/10">
                                    {company.logoUrl ? (
                                        <img src={company.logoUrl} alt={`${company.name || 'Company'} logo`} className="h-full w-full object-cover" />
                                    ) : (
                                        <BuildingOffice2Icon className="h-10 w-10 text-white/70" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h1 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">{company.name || company.companyName || 'Company'}</h1>
                                    {description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200 sm:text-base">{description}</p> : null}
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        {rating ? (
                                            <span className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-sm font-semibold">
                                                <StarIcon className="h-4 w-4" />
                                                {rating.toFixed(1)} average rating
                                            </span>
                                        ) : null}
                                        <span className="inline-flex items-center rounded-md bg-white/10 px-3 py-1.5 text-sm font-semibold">
                                            {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
                                        </span>
                                        {company.hiring ? (
                                            <span className="inline-flex items-center gap-2 rounded-md bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-100">
                                                <CheckCircleIcon className="h-4 w-4" />
                                                Actively hiring
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            {company.ownerId ? (
                                <button
                                    type="button"
                                    onClick={handleInitiateChat}
                                    className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                                >
                                    <ChatBubbleBottomCenterTextIcon className="h-5 w-5" />
                                    Chat with this Company
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-8">
                        <div className="space-y-6">
                            <div className="grid gap-3 md:grid-cols-2">
                                <DetailItem icon={BuildingOffice2Icon} label="Industry" value={company.industry} />
                                <DetailItem icon={UserGroupIcon} label="Company Size" value={company.size} />
                                <DetailItem icon={MapPinIcon} label="Region" value={company.region || serviceAreas.slice(0, 4).join(', ')} />
                                <DetailItem icon={StarIcon} label="Reviews" value={rating ? `${rating.toFixed(1)} average from ${reviews.length} reviews` : `${reviews.length} reviews`} />
                            </div>

                            <section className="rounded-lg border border-slate-200 bg-white p-5">
                                <h2 className="text-lg font-semibold text-slate-950">Services</h2>
                                {services.length > 0 ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {services.map(service => (
                                            <span key={service} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
                                                {service}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-2 text-sm text-slate-500">No public services listed.</p>
                                )}
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h2 className="text-lg font-semibold text-slate-950">Reviews</h2>
                                    {rating ? <span className="text-sm font-semibold text-slate-500">{rating.toFixed(1)} / 5</span> : null}
                                </div>
                                <div className="mt-4 space-y-3">
                                    {reviews.length > 0 ? (
                                        reviews.map(review => (
                                            <article key={review.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <h3 className="font-semibold text-slate-950">{review.reviewerName || review.reviewer || 'Customer'}</h3>
                                                        {review.verified ? <p className="mt-0.5 text-xs font-semibold text-emerald-600">Verified Customer</p> : null}
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm font-bold text-amber-600">{review.rating || 'N/A'} / 5</div>
                                                        <div className="text-xs text-slate-500">{formatDate(review.createdAt || review.dateCreated)}</div>
                                                    </div>
                                                </div>
                                                {review.description ? <p className="mt-3 text-sm leading-6 text-slate-600">{review.description}</p> : null}
                                            </article>
                                        ))
                                    ) : (
                                        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No public reviews yet.</p>
                                    )}
                                </div>
                            </section>
                        </div>

                        <aside className="space-y-4">
                            <section className="rounded-lg border border-slate-200 bg-white p-5">
                                <h2 className="text-lg font-semibold text-slate-950">Contact Information</h2>
                                <div className="mt-4 space-y-3">
                                    <DetailItem icon={PhoneIcon} label="Phone" value={company.phoneNumber || company.phone} href={company.phoneNumber || company.phone ? `tel:${company.phoneNumber || company.phone}` : ''} />
                                    <DetailItem icon={EnvelopeIcon} label="Email" value={company.email} href={company.email ? `mailto:${company.email}` : ''} />
                                    <DetailItem icon={GlobeAltIcon} label="Website" value={website} href={safeExternalHref(website)} />
                                    <DetailItem icon={StarIcon} label="Yelp" value={company.yelpURL} href={safeExternalHref(company.yelpURL)} />
                                </div>
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5">
                                <h2 className="text-lg font-semibold text-slate-950">Owner</h2>
                                <p className="mt-2 text-sm font-semibold text-slate-700">{company.ownerName || 'Not provided'}</p>
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5">
                                <h2 className="text-lg font-semibold text-slate-950">Service Area</h2>
                                {serviceAreas.length > 0 ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {serviceAreas.map(area => (
                                            <span key={area} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                                {area}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-2 text-sm text-slate-500">No public service area listed.</p>
                                )}
                            </section>

                            <Link
                                to={`/companies-detail/${company.id}`}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                                Shareable company detail
                                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                            </Link>
                        </aside>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default CompanyDetail;
