import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowTopRightOnSquareIcon,
    BuildingOffice2Icon,
    UsersIcon,
    CogIcon,
    EnvelopeIcon,
    BeakerIcon,
    ArchiveBoxIcon,
    CreditCardIcon,
    CurrencyDollarIcon,
    ClipboardDocumentCheckIcon,
    DocumentTextIcon,
    BuildingStorefrontIcon,
    TruckIcon,
    ChevronRightIcon,
    ArrowDownIcon,
    ArrowUpIcon,
    XMarkIcon,
    BookmarkIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    XCircleIcon
} from '@heroicons/react/24/outline';
import { BiPurchaseTagAlt } from 'react-icons/bi';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from "../../../context/AuthContext";
import { auth, db, functions } from '../../../utils/config';
import { allNav } from '../../../navigation/allNav';
import { COMPANY_PINNED_CATEGORY, DEFAULT_COMPANY_CATEGORY_ORDER } from '../../../navigation';

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

const StripeBillingSnapshot = ({
    accountId,
    error,
    loading,
    onManageStripe,
    onRefresh,
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
    ];

    return (
        <section className="mb-8">
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
            </div>
        </section>
    );
};

const SettingsLink = ({ to, icon, title, description, accent = "default" }) => {
    const isAccounting = accent === "accounting";

    return (
        <Link
            to={to}
            className={`group flex items-center gap-4 px-4 py-3 transition-colors sm:px-5 ${
                isAccounting
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-white hover:bg-slate-50"
            }`}
        >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
                isAccounting ? "bg-white/15 text-white ring-1 ring-white/20" : "bg-slate-100 text-slate-600"
            }`}>
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <p className={`font-semibold ${isAccounting ? "text-white" : "text-slate-900"}`}>{title}</p>
                <p className={`mt-0.5 text-sm ${isAccounting ? "text-emerald-50" : "text-slate-500"}`}>{description}</p>
            </div>
            <ChevronRightIcon className={`h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 ${
                isAccounting ? "text-white/80" : "text-slate-400"
            }`} />
        </Link>
    );
};

const SettingsSection = ({ title, items }) => {
    return (
        <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white divide-y divide-slate-200">
                {items.map(item => <SettingsLink key={item.to} {...item} />)}
            </div>
        </section>
    );
};

const BOOKMARKS_SECTION_TITLE = 'Book Marks';
const BOOKMARK_EXCLUDED_PATHS = new Set(['/company/setup-guide']);

const normalizeNavigationOrder = (savedOrder) => {
    const ordered = Array.isArray(savedOrder) ? savedOrder : [];
    const normalized = [
        ...ordered.filter((category) => DEFAULT_COMPANY_CATEGORY_ORDER.includes(category)),
        ...DEFAULT_COMPANY_CATEGORY_ORDER.filter((category) => !ordered.includes(category)),
    ];

    return [...new Set(normalized)];
};

const companyBookmarkPaths = new Set(
    allNav
        .filter((item) => item.role === 'Company')
        .filter((item) => item.category !== COMPANY_PINNED_CATEGORY)
        .filter((item) => !BOOKMARK_EXCLUDED_PATHS.has(item.path))
        .map((item) => item.path)
);

const normalizeBookmarkPaths = (savedBookmarks) => {
    const ordered = Array.isArray(savedBookmarks) ? savedBookmarks : [];

    return [...new Set(
        ordered.filter((path) => typeof path === 'string' && companyBookmarkPaths.has(path))
    )];
};

const featureFlagsEnabledForItem = (item, featureFlagsLoaded, isFeatureEnabled) => {
    const featureFlagIds = [
        item.featureFlagId,
        ...(Array.isArray(item.featureFlagIds) ? item.featureFlagIds : []),
    ].filter(Boolean);

    return featureFlagIds.length === 0 || (featureFlagsLoaded && featureFlagIds.every((featureFlagId) => isFeatureEnabled(featureFlagId)));
};

const getBookmarkCandidateItems = ({
    companyRoleLoading,
    hasCompanyPermission,
    featureFlagsLoaded,
    isFeatureEnabled,
}) => {
    return allNav
        .filter((item) => item.role === 'Company')
        .filter((item) => item.category !== COMPANY_PINNED_CATEGORY)
        .filter((item) => !BOOKMARK_EXCLUDED_PATHS.has(item.path))
        .filter((item) => (
            (!item.permissionId || companyRoleLoading || hasCompanyPermission(item.permissionId)) &&
            featureFlagsEnabledForItem(item, featureFlagsLoaded, isFeatureEnabled)
        ));
};

const NavigationOrderSettings = () => {
    const {
        user,
        dataBaseUser,
        setDataBaseUser,
        companyRoleLoading,
        hasCompanyPermission,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const [categoryOrder, setCategoryOrder] = useState(DEFAULT_COMPANY_CATEGORY_ORDER);
    const [selectedBookmarkPaths, setSelectedBookmarkPaths] = useState([]);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingBookmarks, setIsSavingBookmarks] = useState(false);

    useEffect(() => {
        setCategoryOrder(normalizeNavigationOrder(dataBaseUser?.settings?.companyNavigationCategoryOrder));
        setSelectedBookmarkPaths(normalizeBookmarkPaths(dataBaseUser?.settings?.companyNavigationBookmarks));
    }, [dataBaseUser]);

    const bookmarkCandidateItems = getBookmarkCandidateItems({
        companyRoleLoading,
        hasCompanyPermission,
        featureFlagsLoaded,
        isFeatureEnabled,
    });

    const saveCategoryOrder = async (nextOrder) => {
        if (!user?.uid) return;

        setCategoryOrder(nextOrder);
        setIsSaving(true);

        try {
            await updateDoc(doc(db, "users", user.uid), {
                "settings.companyNavigationCategoryOrder": nextOrder,
            });
            setDataBaseUser((current) => ({
                ...current,
                settings: {
                    ...(current?.settings || {}),
                    companyNavigationCategoryOrder: nextOrder,
                },
            }));
            toast.success("Navigation order updated.");
        } catch (error) {
            console.error("Failed to save navigation order:", error);
            toast.error("Failed to save navigation order.");
            setCategoryOrder(normalizeNavigationOrder(dataBaseUser?.settings?.companyNavigationCategoryOrder));
        } finally {
            setIsSaving(false);
        }
    };

    const saveBookmarkPaths = async (nextPaths) => {
        if (!user?.uid) return;

        const normalizedPaths = normalizeBookmarkPaths(nextPaths);
        setSelectedBookmarkPaths(normalizedPaths);
        setIsSavingBookmarks(true);

        try {
            await updateDoc(doc(db, "users", user.uid), {
                "settings.companyNavigationBookmarks": normalizedPaths,
            });
            setDataBaseUser((current) => ({
                ...current,
                settings: {
                    ...(current?.settings || {}),
                    companyNavigationBookmarks: normalizedPaths,
                },
            }));
            toast.success("Book marks updated.");
        } catch (error) {
            console.error("Failed to save book marks:", error);
            toast.error("Failed to save book marks.");
            setSelectedBookmarkPaths(normalizeBookmarkPaths(dataBaseUser?.settings?.companyNavigationBookmarks));
        } finally {
            setIsSavingBookmarks(false);
        }
    };

    const toggleBookmark = (item) => {
        if (isSavingBookmarks) return;

        const isSelected = selectedBookmarkPaths.includes(item.path);
        const nextPaths = isSelected
            ? selectedBookmarkPaths.filter((path) => path !== item.path)
            : [...selectedBookmarkPaths, item.path];

        saveBookmarkPaths(nextPaths);
    };

    const moveCategory = (index, direction) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= categoryOrder.length || isSaving) return;

        const nextOrder = [...categoryOrder];
        [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
        saveCategoryOrder(nextOrder);
    };

    const resetOrder = () => {
        if (isSaving) return;
        saveCategoryOrder(DEFAULT_COMPANY_CATEGORY_ORDER);
    };

    return (
        <section className="mb-10 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800">Navigation Order</h2>
                    <p className="mt-1 text-sm text-gray-500">
                        Set your personal sidebar order and choose Book Marks. Dashboard and Messages stay pinned at the top.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setIsEditorOpen(true)}
                    className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                    Edit Order
                </button>
            </div>

            {isEditorOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div
                        className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="navigation-order-title"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <h3 id="navigation-order-title" className="text-lg font-semibold text-slate-900">
                                    Edit Navigation Order
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    Move each sidebar category into the order you want. Manage Book Marks below.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsEditorOpen(false)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                aria-label="Close navigation order editor"
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="max-h-[60vh] overflow-y-auto p-5">
                            <div className="mb-5 divide-y divide-slate-100 rounded-md border border-slate-200">
                                {categoryOrder.map((category, index) => (
                                    <div key={category} className="flex items-center justify-between gap-3 p-3">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">{category}</p>
                                            <p className="text-xs text-slate-500">Position {index + 1}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => moveCategory(index, -1)}
                                                disabled={index === 0 || isSaving}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label={`Move ${category} up`}
                                            >
                                                <ArrowUpIcon className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveCategory(index, 1)}
                                                disabled={index === categoryOrder.length - 1 || isSaving}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label={`Move ${category} down`}
                                            >
                                                <ArrowDownIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                                <div className="mb-3 flex items-start gap-3">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm ring-1 ring-slate-200">
                                        <BookmarkIcon className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-slate-900">{BOOKMARKS_SECTION_TITLE}</h4>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            Select pages to show below Dashboard and Messages in your sidebar.
                                        </p>
                                    </div>
                                </div>

                                {bookmarkCandidateItems.length > 0 ? (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {bookmarkCandidateItems.map((item) => {
                                            const isSelected = selectedBookmarkPaths.includes(item.path);

                                            return (
                                                <label
                                                    key={item.path}
                                                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition ${
                                                        isSelected
                                                            ? 'border-slate-800 bg-white text-slate-900 shadow-sm'
                                                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                                                    } ${isSavingBookmarks ? 'opacity-70' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        disabled={isSavingBookmarks}
                                                        onChange={() => toggleBookmark(item)}
                                                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                                    />
                                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-500 [&>svg]:h-5 [&>svg]:w-5">
                                                        {item.icon}
                                                    </span>
                                                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                                        No bookmarkable pages are available for this user.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={resetOrder}
                                disabled={isSaving}
                                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Reset Default
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsEditorOpen(false)}
                                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

const CompanySettings = () => {
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
                console.error("Failed to load selected company for settings:", error);
                if (!cancelled) {
                    toast.error("Could not load company settings.");
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

    const settings = {
        general: [
            {
                to: '/company/setup-guide',
                icon: <DocumentTextIcon className="w-6 h-6" />,
                title: 'Setup Guide',
                description: 'Walk through setup from customers to service, routing, agreements, and billing.'
            },
            {
                to: '/company/selector',
                icon: <CogIcon className="w-6 h-6" />,
                title: 'Change Selected Company',
                description: 'Switch between different company profiles.'
            },
            {
                to: '/company/settings/subscriptions',
                icon: <CreditCardIcon className="w-6 h-6" />,
                title: 'Manage Subscriptions',
                description: 'Upgrade, downgrade, or cancel your subscription plans.'
            }
        ],
        company: [
            {
                to: '/Company/CompanyInfo',
                icon: <BuildingOffice2Icon className="w-6 h-6" />,
                title: 'Company Information',
                description: 'Update your company\'s name, address, and other details.'
            },
            {
                to: '/Company/TaskGroups',
                icon: <ArchiveBoxIcon className="w-6 h-6" />,
                title: 'Task Groups',
                description: 'Manage templates for recurring job tasks.'
            },
            {
                to: '/company/settings/job-templates',
                icon: <DocumentTextIcon className="w-6 h-6" />,
                title: 'Job Templates',
                description: 'Review reusable job templates shared with iOS.'
            },
            {
                to: '/Company/EmailConfiguration',
                icon: <EnvelopeIcon className="w-6 h-6" />,
                title: 'Email Configuration',
                description: 'Configure your company\'s email settings.'
            },
            {
                to: '/company/readingsAndDosages',
                icon: <BeakerIcon className="w-6 h-6" />,
                title: 'Reading and Dosages',
                description: 'Set up measurement units and chemical dosages.'
            },
            {
                to: '/Company/Roles',
                icon: <UsersIcon className="w-6 h-6" />,
                title: 'User Roles',
                description: 'Define and manage roles and permissions for your team.'
            },
            {
                to: '/company/settings/onboarding-checklist',
                icon: <ClipboardDocumentCheckIcon className="w-6 h-6" />,
                title: 'Onboarding Checklist',
                description: 'Manage the default setup list copied onto new company users.'
            },
            {
                to: '/company/vendors',
                icon: <BuildingStorefrontIcon className="w-6 h-6" />,
                title: 'Vendors',
                description: 'Manage vendors used for purchases, receipts, parts, and company records.'
            },
            {
                to: '/company/fleet',
                icon: <TruckIcon className="w-6 h-6" />,
                title: 'Fleet',
                description: 'Manage company vehicles used for routing, reports, and route assignments.'
            },
            {
                to: '/company/reports',
                icon: <DocumentTextIcon className="w-6 h-6" />,
                title: 'Reports',
                description: 'Run Reports for all aspects of your company'
            }
        ],
        billing: [
            {
                to: '/company/accounting',
                icon: <CurrencyDollarIcon className="w-6 h-6" />,
                title: 'Switch to Accounting Mode',
                description: 'Open the accountant workspace for AR, reconciliation, payouts, tax, and accounting notes.',
                accent: 'accounting'
            },
            {
                to: '/Company/Items',
                icon: <ArchiveBoxIcon className="w-6 h-6" />,
                title: 'Database Items',
                description: 'Manage your company\'s internal database of items.'
            },
            {
                to: '/company/sales/catalog-items',
                icon: <BiPurchaseTagAlt className="w-6 h-6" />,
                title: 'Sales Catalog Items',
                description: 'Manage billable services, recurring charges, materials, fees, and discounts.'
            },
            // Update 3.1
            // {
            //     to: '/Company/StripeProfile',
            //     icon: <CurrencyDollarIcon className="w-6 h-6" />,
            //     title: 'Stripe Profile',
            //     description: 'Manage your company\'s Stripe account and payment details.'
            // },
            {
                to: '/company/settings/terms-templates',
                icon: <DocumentTextIcon className="w-6 h-6" />,
                title: 'Terms Templates',
                description: 'Create and manage templates for your terms and conditions.'
            },
            {
                to: '/company/settings/payroll-setup',
                icon: <CurrencyDollarIcon className="w-6 h-6" />,
                title: 'Payroll Setup',
                description: 'Configure stop pay, technician rates, and pay rules.'
            }
        ],
        stripe: [
            {
                to: '/company/SubscriptionManagement',
                icon: <BiPurchaseTagAlt className="w-6 h-6" />,
                title: 'Stripe Configuration',
                description: 'Manage customer subscriptions through your Stripe Connected Account.'
            }
        ]
    };
    async function runFunction(e) {
        e.preventDefault()
        try {
            //Get Subscription Information From Stripe
            console.log('cancelStripeSubscription')

            const functionName = httpsCallable(functions, 'updateCompanyReadingsSettings');
            functionName({
                companyId: recentlySelectedCompany,
            })
                .then((result) => {
                    console.log("[CompanySettings][runFunction]")
                    console.log(result)
                    // Handle the result from the function
                })
                .catch((error) => {
                    // Handle any errors
                    console.log("[CompanySettings][runFunction]")
                    console.error(error);
                });
        } catch (error) {
            console.log("[CompanySettings][runFunction]")
            console.error(error);
        }
    }

    return (
        <div className='p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen'>
            <div className="w-full">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
                    <p className="text-gray-600 mt-1">Manage your company's information, users, billing, and integrations.</p>
                </div>

                <SettingsSection title="General" items={settings.general} />
                <SettingsSection title="Company" items={settings.company} />
                <SettingsSection title="Billing & Payroll" items={settings.billing} />

                {ownerCanManageStripe ? (
                    <StripeBillingSnapshot
                        accountId={currentConnectedAccountId}
                        error={stripeReadinessError}
                        loading={stripeReadinessLoading}
                        onManageStripe={handleStripeAccountLink}
                        onRefresh={() => verifyStripeReadiness({ showToast: true })}
                        readiness={stripeReadiness}
                        stripeLoading={stripeLoading}
                    />
                ) : null}

                {/* Stripe Connected Account Settings Update 3.1 */}

                {/* <div>
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Stripe Connected Account</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {settings.stripe.map(item => <SettingsLink key={item.to} {...item} />)}
                    </div>
	                </div> */}

                <NavigationOrderSettings />


                {process.env.NODE_ENV === 'development' && (
                    <div className="p-4 my-4 bg-yellow-900 border-2 border-yellow-500 rounded-lg">
                        <h3 className="text-xl font-bold text-yellow-400">🚧 Development Only:Upload For Developers To Call Different Cloud Functions 🚧</h3>
                        <p className="text-yellow-300">This feature is for testing and will not be in the final product.</p>
                        {/* You can put any component or button here. For example: */}
                        <button
                            onClick={(e) => runFunction(e)}
                            className='font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#9C0D38] cursor-pointer rounded mt-3'>Run updateCompanyReadingsSettings</button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CompanySettings;
