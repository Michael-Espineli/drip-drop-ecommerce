import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowLeftIcon,
    ArrowPathIcon,
    ArrowTopRightOnSquareIcon,
    CheckCircleIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    XCircleIcon,
} from '@heroicons/react/24/outline';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import { auth, db, functions } from '../../../utils/config';

const normalizeStripeAccountId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    return id.startsWith('acct_') ? id : '';
};

const getCompanyConnectedAccountId = (companyData) => {
    const data = companyData || {};
    return (
        normalizeStripeAccountId(data.stripeConnectedAccountId) ||
        normalizeStripeAccountId(data.stripeConnectAccountId)
    );
};

const buttonBaseClass = "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass = `${buttonBaseClass} bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus:ring-blue-100`;
const secondaryButtonClass = `${buttonBaseClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:ring-blue-100`;

const labelize = (value) => {
    if (!value) return "Unknown";
    return String(value)
        .replace(/([A-Z])/g, " $1")
        .replace(/[_-]/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatRequirement = (requirement) => {
    if (!requirement) return "";
    if (typeof requirement === "string") return labelize(requirement);
    return labelize(requirement.reason || requirement.code || requirement.requirement || "");
};

const formatCurrencyFromCents = (amountCents = 0, currency = "usd") => (
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: String(currency || "usd").toUpperCase(),
    }).format(Number(amountCents || 0) / 100)
);

const dateFromValue = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatShortDate = (value) => {
    const date = dateFromValue(value);
    return date ? date.toLocaleDateString() : "-";
};

const readinessValueClass = (ready) => (
    ready ? "text-emerald-700" : "text-amber-700"
);

const StripeStatusBadge = ({ ready, neutral = false, children }) => {
    const className = neutral
        ? "border-slate-200 bg-slate-100 text-slate-700"
        : ready
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700";

    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
            {children}
        </span>
    );
};

const StripeStatusMetric = ({ label, value, ready, helper }) => (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700">{label}</p>
            <span className={`text-sm font-bold ${readinessValueClass(ready)}`}>{value}</span>
        </div>
        {helper ? <p className="mt-2 text-xs text-slate-500">{helper}</p> : null}
    </div>
);

const StripeChecklistItem = ({ complete, label, detail }) => {
    const Icon = complete === true ? CheckCircleIcon : complete === false ? XCircleIcon : ClockIcon;
    const iconClass = complete === true
        ? "text-emerald-600"
        : complete === false
            ? "text-amber-600"
            : "text-slate-400";

    return (
        <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3">
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} />
            <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                <p className="mt-1 text-xs text-slate-500">{detail}</p>
            </div>
        </div>
    );
};

const StripeBillingSnapshotPanel = ({
    accountId,
    error,
    loading,
    onManageStripe,
    onRefreshPayouts,
    onRefresh,
    payoutError,
    payouts = [],
    payoutsLoading,
    readiness,
    stripeLoading,
}) => {
    const hasConnectedAccount = Boolean(accountId);
    const requirements = [
        ...(readiness?.currentlyDue || []),
        ...(readiness?.pastDue || []),
        ...(readiness?.pendingVerification || []),
        ...(readiness?.errors || []).map(formatRequirement),
    ].filter(Boolean);
    const hasBlockingRequirements = Boolean(
        readiness?.currentlyDue?.length ||
        readiness?.pastDue?.length ||
        readiness?.errors?.length ||
        readiness?.disabledReason
    );
    const canBillCustomers = Boolean(readiness?.canBillCustomers);
    const canRunLiveBilling = Boolean(readiness?.canRunLiveBilling);
    const webhookConfigured = Boolean(readiness?.platform?.webhookSigningSecretConfigured);
    const transfersActive = readiness?.capabilities?.transfers === "active";
    const applicationFeePercent = readiness?.platform?.applicationFeePercent;
    const applicationFeeSource = readiness?.platform?.applicationFeeSource;

    const checklist = [
        {
            complete: hasConnectedAccount,
            label: "Connected account exists",
            detail: hasConnectedAccount ? "This company has a Stripe connected account saved." : "Connect Stripe before customer billing can start.",
        },
        {
            complete: readiness ? readiness.detailsSubmitted : false,
            label: "Stripe onboarding submitted",
            detail: readiness?.detailsSubmitted ? "Business details have been submitted to Stripe." : "The owner still needs to finish Stripe onboarding.",
        },
        {
            complete: readiness ? readiness.chargesEnabled && readiness.cardPaymentsEnabled : false,
            label: "Card payments and charges enabled",
            detail: readiness?.chargesEnabled && readiness?.cardPaymentsEnabled
                ? "Stripe says this account can collect card payments."
                : "Stripe must approve card payments before Checkout can collect money.",
        },
        {
            complete: readiness ? readiness.payoutsEnabled && transfersActive : false,
            label: "Payouts and transfers enabled",
            detail: readiness?.payoutsEnabled && transfersActive
                ? "Funds can be transferred and paid out to the business."
                : "Finish payout/bank setup so collected funds can move to the company.",
        },
        {
            complete: readiness ? !hasBlockingRequirements : false,
            label: "No blocking Stripe requirements",
            detail: hasBlockingRequirements
                ? "Open Stripe and complete the required fields listed below."
                : "No currently due or past-due requirements were returned.",
        },
        {
            complete: readiness ? webhookConfigured : false,
            label: "Webhook signing secret configured",
            detail: webhookConfigured
                ? "Stripe events can be verified before syncing invoices and subscriptions."
                : "Add the Stripe webhook signing secret before relying on live invoice/subscription sync.",
        },
        {
            complete: readiness ? readiness.livemode : false,
            label: "Live mode account",
            detail: readiness?.livemode ? "The connected account is running in live mode." : "Use live mode before charging real customers.",
        },
        {
            complete: null,
            label: "Billable services and agreements prepared",
            detail: "Create Sales Catalog Items and service agreement line items before starting Checkout for a customer.",
        },
        {
            complete: applicationFeePercent ? true : null,
            label: "Platform fee policy selected",
            detail: applicationFeePercent
                ? `Drip Drop will collect ${applicationFeePercent}% as the platform fee on Stripe subscriptions.`
                : "No platform application fee is configured yet; billing can run, but Drip Drop will not take a payment fee.",
        },
    ];

    return (
        <section>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">Stripe Billing Snapshot</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Review what Stripe still needs before this company can run real customer billing.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={!hasConnectedAccount || loading}
                        className={secondaryButtonClass}
                    >
                        <ArrowPathIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        {loading ? "Checking..." : "Refresh"}
                    </button>
                    <button
                        type="button"
                        onClick={onManageStripe}
                        disabled={stripeLoading}
                        className={primaryButtonClass}
                    >
                        {stripeLoading ? "Opening..." : hasConnectedAccount ? "Manage Stripe" : "Connect Stripe"}
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-slate-900">
                                {canRunLiveBilling
                                    ? "Ready for live billing"
                                    : canBillCustomers
                                        ? "Payment collection is ready"
                                        : hasConnectedAccount
                                            ? "Stripe setup needs attention"
                                            : "Stripe is not connected"}
                            </p>
                            <StripeStatusBadge ready={canRunLiveBilling} neutral={!readiness && !hasConnectedAccount}>
                                {canRunLiveBilling ? "Live ready" : canBillCustomers ? "Stripe billing ready" : "Action needed"}
                            </StripeStatusBadge>
                        </div>
                        <p className="mt-2 break-all text-sm text-slate-500">
                            {hasConnectedAccount ? accountId : "No connected account saved for this company yet."}
                        </p>
                    </div>
                    {readiness?.country || readiness?.defaultCurrency || readiness?.businessType ? (
                        <div className="grid gap-1 text-sm text-slate-500 sm:text-right">
                            {readiness.country ? <span>Country: {readiness.country}</span> : null}
                            {readiness.defaultCurrency ? <span>Currency: {String(readiness.defaultCurrency).toUpperCase()}</span> : null}
                            {readiness.businessType ? <span>Type: {labelize(readiness.businessType)}</span> : null}
                        </div>
                    ) : null}
                </div>

                {error ? (
                    <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
                        {error}
                    </div>
                ) : null}

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <StripeStatusMetric
                        label="Onboarding"
                        value={readiness?.detailsSubmitted ? "Submitted" : "Not finished"}
                        ready={Boolean(readiness?.detailsSubmitted)}
                        helper="Business profile, representative, and ownership details."
                    />
                    <StripeStatusMetric
                        label="Charges"
                        value={readiness?.chargesEnabled ? "Enabled" : "Disabled"}
                        ready={Boolean(readiness?.chargesEnabled)}
                        helper="Required to collect customer payments."
                    />
                    <StripeStatusMetric
                        label="Card payments"
                        value={readiness?.cardPaymentsEnabled ? "Active" : labelize(readiness?.capabilities?.cardPayments)}
                        ready={Boolean(readiness?.cardPaymentsEnabled)}
                        helper="Stripe capability for online card payments."
                    />
                    <StripeStatusMetric
                        label="Payouts"
                        value={readiness?.payoutsEnabled ? "Enabled" : "Pending"}
                        ready={Boolean(readiness?.payoutsEnabled)}
                        helper="Required for the company to receive funds."
                    />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <StripeStatusMetric
                        label="Transfers"
                        value={transfersActive ? "Active" : labelize(readiness?.capabilities?.transfers)}
                        ready={transfersActive}
                        helper="Required for connected-account funds movement."
                    />
                    <StripeStatusMetric
                        label="Webhook sync"
                        value={webhookConfigured ? "Configured" : "Missing"}
                        ready={webhookConfigured}
                        helper="Needed for invoice, payment, and subscription status updates."
                    />
                    <StripeStatusMetric
                        label="Charge model"
                        value="Direct charges"
                        ready
                        helper="Customer payments are created on the company connected account."
                    />
                    <StripeStatusMetric
                        label="Platform fee"
                        value={applicationFeePercent ? `${applicationFeePercent}%` : "None"}
                        ready={Boolean(applicationFeePercent)}
                        helper={applicationFeePercent
                            ? `Collected from Stripe subscription invoices. Source: ${labelize(applicationFeeSource)}.`
                            : "Optional Drip Drop fee collected from Stripe subscription invoices."
                        }
                    />
                </div>

                {hasBlockingRequirements || requirements.length > 0 ? (
                    <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-start gap-3">
                            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                            <div>
                                <p className="text-sm font-semibold text-amber-900">Stripe requirements need attention</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {requirements.length > 0 ? requirements.slice(0, 8).map((requirement) => (
                                        <span key={String(requirement)} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                                            {formatRequirement(requirement)}
                                        </span>
                                    )) : (
                                        <span className="text-sm text-amber-800">
                                            {readiness?.disabledReason ? labelize(readiness.disabledReason) : "Open Stripe to review the required information."}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="mt-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Before Real Billing</h3>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {checklist.map((item) => (
                            <StripeChecklistItem key={item.label} {...item} />
                        ))}
                    </div>
                </div>

                <div className="mt-6 border-t border-slate-200 pt-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent Payouts</h3>
                            <p className="mt-1 text-sm text-slate-500">
                                Payout rows appear after Stripe sends payout webhooks for this connected account.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onRefreshPayouts}
                            disabled={!hasConnectedAccount || payoutsLoading}
                            className={secondaryButtonClass}
                        >
                            <ArrowPathIcon className={`h-4 w-4 ${payoutsLoading ? "animate-spin" : ""}`} />
                            {payoutsLoading ? "Loading..." : "Refresh payouts"}
                        </button>
                    </div>

                    {payoutError ? (
                        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
                            {payoutError}
                        </div>
                    ) : null}

                    {payouts.length > 0 ? (
                        <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
                            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-[1fr_120px_120px_120px]">
                                <span>Payout</span>
                                <span className="text-right">Amount</span>
                                <span className="hidden text-right sm:block">Arrival</span>
                                <span className="hidden text-right sm:block">Status</span>
                            </div>
                            {payouts.map((payout) => (
                                <div key={payout.id || payout.stripePayoutId} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_120px_120px_120px]">
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-900">{payout.stripePayoutId || payout.id}</p>
                                        <p className="mt-0.5 text-xs text-slate-500">{labelize(payout.method || payout.type || "standard payout")}</p>
                                    </div>
                                    <div className="text-right font-semibold text-slate-900">
                                        {formatCurrencyFromCents(payout.amountCents, payout.currency)}
                                    </div>
                                    <div className="hidden text-right text-slate-600 sm:block">
                                        {formatShortDate(payout.arrivalDate || payout.stripeCreatedAt)}
                                    </div>
                                    <div className="hidden text-right sm:block">
                                        <StripeStatusBadge
                                            ready={payout.status === "paid"}
                                            neutral={!["paid", "failed", "canceled"].includes(String(payout.status || ""))}
                                        >
                                            {labelize(payout.status)}
                                        </StripeStatusBadge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                            No Stripe payout records have synced yet.
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};

const StripeBillingSnapshotPage = () => {
    const {
        user,
        dataBaseUser,
        recentlySelectedCompany,
        stripeConnectedAccountId,
        setStripeConnectedAccountId,
    } = useContext(Context);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [companyLoading, setCompanyLoading] = useState(false);
    const [stripeLoading, setStripeLoading] = useState(false);
    const [stripeReadiness, setStripeReadiness] = useState(null);
    const [stripeReadinessLoading, setStripeReadinessLoading] = useState(false);
    const [stripeReadinessError, setStripeReadinessError] = useState("");
    const [stripePayouts, setStripePayouts] = useState([]);
    const [stripePayoutsLoading, setStripePayoutsLoading] = useState(false);
    const [stripePayoutsError, setStripePayoutsError] = useState("");

    useEffect(() => {
        let cancelled = false;

        const loadSelectedCompany = async () => {
            setSelectedCompany(null);

            if (!recentlySelectedCompany) return;

            setCompanyLoading(true);

            try {
                const companySnapshot = await getDoc(doc(db, "companies", recentlySelectedCompany));
                if (!cancelled) {
                    setSelectedCompany(companySnapshot.exists()
                        ? { id: companySnapshot.id, ...companySnapshot.data() }
                        : null
                    );
                }
            } catch (error) {
                console.error("Failed to load selected company for Stripe billing snapshot:", error);
                if (!cancelled) {
                    toast.error("Could not load company billing settings.");
                }
            } finally {
                if (!cancelled) {
                    setCompanyLoading(false);
                }
            }
        };

        loadSelectedCompany();

        return () => {
            cancelled = true;
        };
    }, [recentlySelectedCompany]);

    const ownerCanManageStripe = Boolean(
        !companyLoading &&
        selectedCompany?.ownerId &&
        user?.uid &&
        selectedCompany.ownerId === user.uid
    );
    const currentConnectedAccountId = getCompanyConnectedAccountId(selectedCompany) || stripeConnectedAccountId;

    const loadStripePayouts = useCallback(async ({ showToast = false } = {}) => {
        if (!ownerCanManageStripe || !recentlySelectedCompany || !currentConnectedAccountId) {
            setStripePayouts([]);
            setStripePayoutsError("");
            return;
        }

        setStripePayoutsLoading(true);
        setStripePayoutsError("");

        try {
            const payoutsQuery = query(
                collection(db, "companies", recentlySelectedCompany, "stripePayouts"),
                orderBy("stripeCreatedAt", "desc"),
                limit(5)
            );
            const payoutsSnapshot = await getDocs(payoutsQuery);
            const payouts = payoutsSnapshot.docs
                .map((payoutDoc) => ({ id: payoutDoc.id, ...payoutDoc.data() }))
                .sort((first, second) => {
                    const firstDate = dateFromValue(first.stripeCreatedAt || first.createdAt)?.getTime() || 0;
                    const secondDate = dateFromValue(second.stripeCreatedAt || second.createdAt)?.getTime() || 0;
                    return secondDate - firstDate;
                })
                .slice(0, 5);

            setStripePayouts(payouts);
            if (showToast) {
                toast.success("Stripe payouts refreshed.");
            }
        } catch (error) {
            console.error("Unable to load Stripe payouts:", error);
            const message = error.message || "Unable to load Stripe payouts.";
            setStripePayoutsError(message);
            if (showToast) {
                toast.error(message);
            }
        } finally {
            setStripePayoutsLoading(false);
        }
    }, [currentConnectedAccountId, ownerCanManageStripe, recentlySelectedCompany]);

    const verifyStripeReadiness = useCallback(async ({ showToast = false } = {}) => {
        if (!ownerCanManageStripe || !recentlySelectedCompany || !currentConnectedAccountId) {
            setStripeReadiness(null);
            setStripeReadinessError("");
            return;
        }

        const activeUser = auth.currentUser;
        if (!activeUser) {
            setStripeReadinessError("Sign in again before checking Stripe readiness.");
            return;
        }

        setStripeReadinessLoading(true);
        setStripeReadinessError("");

        try {
            const idToken = await activeUser.getIdToken(true);
            const verifyCallable = httpsCallable(functions, "verifyConnectedAccountBillingReadiness");
            const result = await verifyCallable({
                companyId: recentlySelectedCompany,
                accountId: currentConnectedAccountId,
                connectedAccount: currentConnectedAccountId,
                stripeConnectedAccountId: currentConnectedAccountId,
                idToken,
            });

            setStripeReadiness(result.data || null);
            if (showToast) {
                toast.success("Stripe billing snapshot refreshed.");
            }
        } catch (error) {
            console.error("Unable to verify Stripe billing readiness:", error);
            const message = error.details?.message || error.message || "Unable to verify Stripe billing readiness.";
            setStripeReadinessError(message);
            if (showToast) {
                toast.error(message);
            }
        } finally {
            setStripeReadinessLoading(false);
        }
    }, [currentConnectedAccountId, ownerCanManageStripe, recentlySelectedCompany]);

    useEffect(() => {
        if (!ownerCanManageStripe || !currentConnectedAccountId) {
            setStripeReadiness(null);
            setStripeReadinessError("");
            return;
        }

        verifyStripeReadiness();
    }, [currentConnectedAccountId, ownerCanManageStripe, verifyStripeReadiness]);

    useEffect(() => {
        loadStripePayouts();
    }, [loadStripePayouts]);

    const handleStripeAccountLink = async () => {
        if (!recentlySelectedCompany) {
            toast.error("Select a company before managing Stripe.");
            return;
        }

        const activeUser = auth.currentUser;
        if (!activeUser) {
            toast.error("Your session expired. Sign in again before managing Stripe.");
            return;
        }

        if (user?.uid && activeUser.uid !== user.uid) {
            toast.error("Your session changed. Refresh the page before managing Stripe.");
            return;
        }

        setStripeLoading(true);
        const toastId = toast.loading("Opening Stripe setup...");

        try {
            const idToken = await activeUser.getIdToken(true);
            let accountId = currentConnectedAccountId;

            if (!accountId) {
                const createAccount = httpsCallable(functions, "createNewStripeAccount");
                const createResponse = await createAccount({
                    companyId: recentlySelectedCompany,
                    email: selectedCompany?.email || dataBaseUser?.email || user?.email || "",
                    idToken,
                });

                accountId = createResponse.data?.account;

                if (accountId) {
                    setStripeReadiness(null);
                    setStripeConnectedAccountId(accountId);
                    setSelectedCompany((company) => company
                        ? {
                            ...company,
                            stripeConnectedAccountId: accountId,
                            stripeConnectAccountId: accountId,
                        }
                        : company
                    );
                }
            }

            if (!accountId) {
                throw new Error("Stripe connected account was not found.");
            }

            const createAccountLink = httpsCallable(functions, "createStripeAccountLink");
            const response = await createAccountLink({
                companyId: recentlySelectedCompany,
                accountId,
                returnUrl: window.location.href,
                refreshUrl: window.location.href,
                idToken,
            });

            const { error, accountLink, url } = response.data || {};

            if (error) throw new Error(error.message || "An unknown error occurred.");

            if (accountLink || url) {
                toast.success("Redirecting to Stripe...", { id: toastId });
                window.location.href = accountLink || url;
                return;
            }

            throw new Error("Stripe did not return an onboarding link.");
        } catch (error) {
            console.error("Stripe settings link error:", error);
            const errorMessage = error.code === "functions/unauthenticated"
                ? "Your session expired. Sign in again before managing Stripe."
                : error.details?.message || error.message || "Unable to open Stripe setup.";
            toast.error(errorMessage, { id: toastId });
        } finally {
            setStripeLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="w-full">
                <Link to="/company/settings" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
                    <ArrowLeftIcon className="h-4 w-4" />
                    Settings
                </Link>

                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Stripe Billing</h1>
                    <p className="mt-1 text-gray-600">Manage connected-account readiness, billing sync, platform fees, and payout status.</p>
                </div>

                {companyLoading ? (
                    <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
                        Loading Stripe billing settings...
                    </div>
                ) : ownerCanManageStripe ? (
                    <StripeBillingSnapshotPanel
                        accountId={currentConnectedAccountId}
                        error={stripeReadinessError}
                        loading={stripeReadinessLoading}
                        onManageStripe={handleStripeAccountLink}
                        onRefresh={() => verifyStripeReadiness({ showToast: true })}
                        onRefreshPayouts={() => loadStripePayouts({ showToast: true })}
                        payoutError={stripePayoutsError}
                        payouts={stripePayouts}
                        payoutsLoading={stripePayoutsLoading}
                        readiness={stripeReadiness}
                        stripeLoading={stripeLoading}
                    />
                ) : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-sm">
                        Stripe billing setup is only available to the company owner.
                    </div>
                )}
            </div>
        </div>
    );
};

export default StripeBillingSnapshotPage;
