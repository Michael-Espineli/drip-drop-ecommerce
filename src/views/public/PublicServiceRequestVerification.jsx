import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
    ArrowRightIcon,
    BuildingOffice2Icon,
    CheckCircleIcon,
    EnvelopeIcon,
    ExclamationTriangleIcon,
    MapPinIcon,
} from '@heroicons/react/24/outline';
import { functions } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { getCallableAuthPayload } from '../../utils/callableAuth';

const StatusNotice = ({ tone = 'blue', icon: Icon, title, children }) => {
    const tones = {
        blue: 'border-cyan-200 bg-cyan-50 text-cyan-900',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        amber: 'border-amber-200 bg-amber-50 text-amber-900',
        rose: 'border-rose-200 bg-rose-50 text-rose-900',
    };

    return (
        <div className={`rounded-md border p-4 ${tones[tone] || tones.blue}`}>
            <div className="flex items-start gap-3">
                {Icon && <Icon className="mt-0.5 h-5 w-5 flex-none" />}
                <div>
                    <h2 className="font-bold">{title}</h2>
                    <div className="mt-1 text-sm">{children}</div>
                </div>
            </div>
        </div>
    );
};

export default function PublicServiceRequestVerification() {
    const { verificationId } = useParams();
    const navigate = useNavigate();
    const { user, accountType } = useContext(Context);
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [claiming, setClaiming] = useState(false);
    const [error, setError] = useState('');

    const redirectPath = useMemo(() => (
        `/public-service-request/verify/${verificationId || ''}`
    ), [verificationId]);

    const authLinks = useMemo(() => {
        const redirect = encodeURIComponent(redirectPath);
        const email = preview?.verification?.email ? `&email=${encodeURIComponent(preview.verification.email)}` : '';

        return {
            signIn: `/homeownerSignIn?redirect=${redirect}${email}`,
            signUp: `/homeownerSignUp?redirect=${redirect}${email}`,
        };
    }, [preview?.verification?.email, redirectPath]);

    useEffect(() => {
        let cancelled = false;

        const loadPreview = async () => {
            if (!verificationId) {
                setError('This verification link is missing its id.');
                setLoading(false);
                return;
            }

            try {
                const callable = httpsCallable(functions, 'getPublicLeadVerificationPreview');
                const result = await callable({
                    verificationId,
                    baseUrl: window.location.origin,
                });
                const response = result.data || {};

                if (response.status !== 200) {
                    throw new Error(response.error || 'Could not load this verification link.');
                }

                if (!cancelled) setPreview(response);
            } catch (loadError) {
                console.error('Failed to load public service request verification', loadError);
                if (!cancelled) setError(loadError.message || 'Could not load this verification link.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadPreview();

        return () => {
            cancelled = true;
        };
    }, [verificationId]);

    const claimRequest = async () => {
        if (!user?.uid) {
            navigate(authLinks.signIn);
            return;
        }

        if (accountType && accountType !== 'Client') {
            toast.error('Sign in with a homeowner account to connect this request.');
            return;
        }

        setClaiming(true);

        try {
            const authPayload = await getCallableAuthPayload();
            const callable = httpsCallable(functions, 'claimPublicServiceRequestLead');
            const result = await callable({
                ...authPayload,
                auth: authPayload,
                verificationId,
            });
            const response = result.data || {};

            if (response.status !== 200) {
                throw new Error(response.error || 'Could not connect this request.');
            }

            toast.success('Service request connected.');
            navigate(response.clientWebPath || `/client/service-requests/${response.leadId}`);
        } catch (claimError) {
            console.error('Failed to claim public service request', claimError);
            toast.error(claimError.message || 'Could not connect this request.');
        } finally {
            setClaiming(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
                Loading verification link...
            </div>
        );
    }

    if (error || !preview) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
                <div className="w-full max-w-md rounded-md border border-rose-200 bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-bold text-slate-950">Verification unavailable</h1>
                    <p className="mt-2 text-sm text-slate-600">{error || 'This verification link could not be loaded.'}</p>
                    <Link to="/homeowners" className="mt-5 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        Homeowner portal
                    </Link>
                </div>
            </div>
        );
    }

    const company = preview.company || {};
    const request = preview.request || {};
    const verification = preview.verification || {};

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
                    <Link to="/" className="text-xl font-bold text-cyan-700">Drip Drop</Link>
                    {company.id && (
                        <Link to={`/request-service/${company.id}`} className="text-sm font-semibold text-slate-600 hover:text-slate-950">
                            Request service
                        </Link>
                    )}
                </div>
            </header>

            <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="space-y-5">
                    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                            <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                                {company.logoUrl || company.photoUrl ? (
                                    <img src={company.logoUrl || company.photoUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <BuildingOffice2Icon className="h-9 w-9 text-slate-400" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">Service request verification</p>
                                <h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">{company.name || 'Pool company'}</h1>
                                <p className="mt-2 text-sm text-slate-600">
                                    Connect this request to a homeowner account so it can be tracked from the client side.
                                </p>
                            </div>
                        </div>
                    </div>

                    {verification.claimed && (
                        <StatusNotice tone="emerald" icon={CheckCircleIcon} title="Request already connected">
                            This service request has already been connected to a homeowner account.
                        </StatusNotice>
                    )}

                    {verification.expired && (
                        <StatusNotice tone="amber" icon={ExclamationTriangleIcon} title="Verification expired">
                            Submit a new service request or contact the company for a fresh link.
                        </StatusNotice>
                    )}

                    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-950">Request</h2>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</p>
                                <p className="mt-2 font-semibold text-slate-900">{request.serviceName}</p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{request.serviceDescription}</p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted by</p>
                                <p className="mt-2 font-semibold text-slate-900">{request.submittedName || 'Homeowner'}</p>
                                <p className="mt-1 inline-flex items-center gap-2 text-sm text-slate-600">
                                    <EnvelopeIcon className="h-4 w-4 text-slate-400" />
                                    {verification.maskedEmail || 'Email on request'}
                                </p>
                            </div>
                            {request.addressSummary && (
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service address</p>
                                    <p className="mt-2 inline-flex items-start gap-2 font-semibold text-slate-900">
                                        <MapPinIcon className="mt-0.5 h-4 w-4 text-slate-400" />
                                        {request.addressSummary}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <aside className="space-y-4">
                    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-950">Homeowner account</h2>

                        {!user ? (
                            <div className="mt-5 space-y-3">
                                <Link to={authLinks.signIn} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700">
                                    Sign in to connect
                                    <ArrowRightIcon className="h-4 w-4" />
                                </Link>
                                <Link to={authLinks.signUp} className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                                    Create homeowner account
                                </Link>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-3">
                                <button
                                    type="button"
                                    onClick={claimRequest}
                                    disabled={!preview.canClaim || claiming || accountType !== 'Client'}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {claiming ? 'Connecting...' : 'Connect this request'}
                                    <ArrowRightIcon className="h-4 w-4" />
                                </button>
                                <Link to="/client/service-requests" className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                                    View service requests
                                </Link>
                            </div>
                        )}

                        {accountType && accountType !== 'Client' && (
                            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                                Sign out and use a homeowner account to connect this request.
                            </p>
                        )}
                    </div>
                </aside>
            </main>
        </div>
    );
}
