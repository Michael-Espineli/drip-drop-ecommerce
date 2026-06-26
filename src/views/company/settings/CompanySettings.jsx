import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
} from '@heroicons/react/24/outline';
import { BiPurchaseTagAlt } from 'react-icons/bi';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Context } from "../../../context/AuthContext";
import { db, functions } from '../../../utils/config';
import { allNav } from '../../../navigation/allNav';
import { COMPANY_PINNED_CATEGORY, DEFAULT_COMPANY_CATEGORY_ORDER } from '../../../navigation';

const SettingsLink = ({ to, icon, title, description, accent = "default" }) => {
    const isAccounting = accent === "accounting";

    return (
        <Link
            to={to}
            className={`group flex items-center gap-4 px-4 py-3 transition-colors sm:px-5 ${isAccounting
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-white hover:bg-slate-50"
                }`}
        >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${isAccounting ? "bg-white/15 text-white ring-1 ring-white/20" : "bg-slate-100 text-slate-600"
                }`}>
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <p className={`font-semibold ${isAccounting ? "text-white" : "text-slate-900"}`}>{title}</p>
                <p className={`mt-0.5 text-sm ${isAccounting ? "text-emerald-50" : "text-slate-500"}`}>{description}</p>
            </div>
            <ChevronRightIcon className={`h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 ${isAccounting ? "text-white/80" : "text-slate-400"
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
                                                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition ${isSelected
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
        recentlySelectedCompany,
    } = useContext(Context);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [companyLoading, setCompanyLoading] = useState(false);

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
            ...(ownerCanManageStripe ? [{
                to: '/company/settings/stripe-billing',
                icon: <CreditCardIcon className="w-6 h-6" />,
                title: 'Stripe Billing Snapshot',
                description: 'Review connected account setup, webhook sync, platform fee, and recent payouts.'
            }] : []),
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
        <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
            <div className="w-full">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
                    <p className="text-gray-600 mt-1">Manage your company's information, users, billing, and integrations.</p>
                </div>

                <SettingsSection title="General" items={settings.general} />
                <SettingsSection title="Company" items={settings.company} />
                <SettingsSection title="Billing & Payroll" items={settings.billing} />

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
