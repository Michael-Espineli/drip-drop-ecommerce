import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    query,
    updateDoc,
    where,
} from "firebase/firestore";
import {
    FaBell,
    FaChevronDown,
    FaChevronUp,
    FaCog,
    FaCreditCard,
    FaFileContract,
    FaFileInvoiceDollar,
    FaHouseUser,
    FaMoneyBillWave,
    FaReceipt,
    FaRoute,
    FaTasks,
    FaTools,
} from 'react-icons/fa';
import { MdConstruction, MdOutlineLocalOffer } from 'react-icons/md';
import toast from 'react-hot-toast';
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import { SalesAgreementSourceType, SalesAgreementStatus, salesCollectionNames } from '../../utils/models/Sales';
import { isOpenRepairRequestStatus } from '../../utils/models/RepairRequest';
import RecentChatsWidget from '../dashboard/components/RecentChatsWidget';
import {
    TODO_LIST_FEATURE_FLAG_ID,
    compareTodosByUrgency,
    formatShortDateTime,
    normalizeTodo,
    todoIsOpen,
    todoNeedsAttention,
} from '../../utils/models/TodoItem';
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    ALERT_STATUS,
    alertDisplayTime,
    alertIsUnread,
    alertNeedsAttention,
    compareAlertsFresh,
    normalizeAlertNotification,
} from '../../utils/models/AlertNotification';

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

const appPaymentMethods = new Set(['stripeCard', 'stripeAch']);
const activeJobStatuses = new Set(["Estimate Pending", "Unscheduled", "Scheduled", "In Progress"]);
const pendingAgreementStatuses = new Set([
    SalesAgreementStatus.draft,
    SalesAgreementStatus.sent,
    SalesAgreementStatus.revised,
]);

const DASHBOARD_STAT_ITEMS = [
    { id: 'invoiced', title: 'Invoiced', description: 'Issued sales invoices' },
    { id: 'received', title: 'Received', description: 'Posted customer payments' },
    { id: 'openAr', title: 'Open AR', description: 'Outstanding customer balance' },
    { id: 'recurring', title: 'Recurring', description: 'Active subscription amount' },
    { id: 'pendingLeads', title: 'Leads', description: 'New homeowner requests' },
    { id: 'pendingServiceAgreements', title: 'Pending Service Agreements', description: 'Draft, sent, or revised agreements' },
    { id: 'needsRouting', title: 'Needs Routing', description: 'Accepted service agreements' },
    { id: 'routes', title: 'Routes', description: 'Planned recurring routes' },
    { id: 'customers', title: 'Customers', description: 'Active customer accounts' },
    { id: 'activeJobs', title: 'Jobs', description: 'Open operational work' },
    { id: 'openTodos', title: 'Open Todos', description: 'Open task count' },
    { id: 'notifications', title: 'Notifications', description: 'Unread and active alerts' },
];

const DASHBOARD_WIDGET_ITEMS = [
    { id: 'currentWork', title: 'Current Work', description: 'Open jobs needing action' },
    { id: 'recentLeads', title: 'Recent Leads', description: 'Pending homeowner requests' },
    { id: 'recentPayments', title: 'Recently Paid', description: 'Posted customer payments' },
    { id: 'operationsAlerts', title: 'Operations Alerts', description: 'Repairs and route pressure' },
    { id: 'tasks', title: 'Tasks and Reminders', description: 'Open todos by urgency' },
    { id: 'alerts', title: 'Alerts and Notifications', description: 'Latest notification activity' },
    { id: 'messages', title: 'Recent Messages', description: 'Unread and recent conversations' },
];

const DEFAULT_DASHBOARD_STAT_ORDER = DASHBOARD_STAT_ITEMS.map((item) => item.id);
const DEFAULT_DASHBOARD_WIDGET_ORDER = DASHBOARD_WIDGET_ITEMS.map((item) => item.id);
const dashboardStatItemsById = new Map(DASHBOARD_STAT_ITEMS.map((item) => [item.id, item]));
const dashboardWidgetItemsById = new Map(DASHBOARD_WIDGET_ITEMS.map((item) => [item.id, item]));

const DASHBOARD_LAYOUT_PRESETS = [
    {
        id: 'default',
        title: 'Default',
        description: 'Leads, agreements, routing, customers, jobs, and open todos.',
        statOrder: ['pendingLeads', 'pendingServiceAgreements', 'needsRouting', 'routes', 'customers', 'activeJobs', 'openTodos'],
        widgetOrder: DEFAULT_DASHBOARD_WIDGET_ORDER,
        hiddenStatIds: ['invoiced', 'received', 'openAr', 'recurring', 'notifications'],
        hiddenWidgetIds: [],
    },
    {
        id: 'operations',
        title: 'Operations',
        description: 'Prioritizes jobs, routing, repairs, tasks, and messages.',
        statOrder: ['activeJobs', 'routes', 'needsRouting', 'pendingLeads', 'pendingServiceAgreements', 'customers', 'openTodos', 'notifications', 'openAr', 'invoiced', 'received', 'recurring'],
        widgetOrder: ['currentWork', 'operationsAlerts', 'tasks', 'messages', 'alerts', 'recentLeads', 'recentPayments'],
        hiddenStatIds: ['recurring'],
        hiddenWidgetIds: ['recentPayments'],
    },
    {
        id: 'sales',
        title: 'Sales',
        description: 'Starts with revenue, payments, leads, and agreements.',
        statOrder: ['pendingLeads', 'pendingServiceAgreements', 'needsRouting', 'invoiced', 'received', 'openAr', 'recurring', 'customers', 'activeJobs', 'routes', 'notifications', 'openTodos'],
        widgetOrder: ['recentLeads', 'recentPayments', 'currentWork', 'messages', 'alerts', 'tasks', 'operationsAlerts'],
        hiddenStatIds: [],
        hiddenWidgetIds: ['operationsAlerts'],
    },
    {
        id: 'team',
        title: 'Team',
        description: 'Centers daily work, reminders, notifications, and conversations.',
        statOrder: ['openTodos', 'notifications', 'activeJobs', 'routes', 'needsRouting', 'pendingServiceAgreements', 'customers', 'pendingLeads', 'openAr', 'received', 'invoiced', 'recurring'],
        widgetOrder: ['tasks', 'messages', 'alerts', 'currentWork', 'operationsAlerts', 'recentLeads', 'recentPayments'],
        hiddenStatIds: ['recurring'],
        hiddenWidgetIds: ['recentPayments'],
    },
];

const dashboardPresetById = new Map(DASHBOARD_LAYOUT_PRESETS.map((preset) => [preset.id, preset]));

const normalizeIdOrder = (savedOrder, fallbackOrder) => {
    const allowedIds = new Set(fallbackOrder);
    const ordered = Array.isArray(savedOrder)
        ? savedOrder.filter((id) => allowedIds.has(id))
        : [];

    return [
        ...new Set([
            ...ordered,
            ...fallbackOrder.filter((id) => !ordered.includes(id)),
        ]),
    ];
};

const normalizeHiddenIds = (savedIds, allowedOrder) => {
    const allowedIds = new Set(allowedOrder);

    return Array.isArray(savedIds)
        ? [...new Set(savedIds.filter((id) => allowedIds.has(id)))]
        : [];
};

const normalizeDashboardLayout = (layout) => ({
    presetId: typeof layout?.presetId === 'string' ? layout.presetId : 'default',
    statOrder: normalizeIdOrder(layout?.statOrder, DEFAULT_DASHBOARD_STAT_ORDER),
    widgetOrder: normalizeIdOrder(layout?.widgetOrder, DEFAULT_DASHBOARD_WIDGET_ORDER),
    hiddenStatIds: normalizeHiddenIds(layout?.hiddenStatIds, DEFAULT_DASHBOARD_STAT_ORDER),
    hiddenWidgetIds: normalizeHiddenIds(layout?.hiddenWidgetIds, DEFAULT_DASHBOARD_WIDGET_ORDER),
});

const dashboardLayoutFromPreset = (presetId) => {
    const preset = dashboardPresetById.get(presetId) || dashboardPresetById.get('default');

    return normalizeDashboardLayout({
        presetId: preset.id,
        statOrder: preset.statOrder,
        widgetOrder: preset.widgetOrder,
        hiddenStatIds: preset.hiddenStatIds,
        hiddenWidgetIds: preset.hiddenWidgetIds,
    });
};

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const formatDate = (value) => {
    const millis = toMillis(value);
    if (!millis) return 'Not set';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(millis));
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const invoiceBalanceCents = (invoice) => {
    if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;
    const total = Number(invoice.totalAmountCents || 0);
    const paid = Number(invoice.amountPaidCents || 0);
    const writtenOff = Number(invoice.writeOffAmountCents || 0);
    return Math.max(total - paid - writtenOff, 0);
};

const sortFresh = (records) => (
    [...records].sort((left, right) => (
        toMillis(right.updatedAt || right.receivedAt || right.createdAt || right.dateCreated || right.dueDate)
        - toMillis(left.updatedAt || left.receivedAt || left.createdAt || left.dateCreated || left.dueDate)
    ))
);

const StatTile = ({ icon: Icon, label, value, helper, to, tone = 'slate' }) => {
    const tones = {
        slate: 'bg-slate-100 text-slate-600',
        blue: 'bg-blue-50 text-blue-700',
        emerald: 'bg-emerald-50 text-emerald-700',
        amber: 'bg-amber-50 text-amber-700',
        rose: 'bg-rose-50 text-rose-700',
    };

    const content = (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
                </div>
                <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
                    <Icon />
                </span>
            </div>
            {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
        </div>
    );

    return to ? <Link to={to}>{content}</Link> : content;
};

const ListCard = ({ title, helper, to, count, actionLabel = 'View all', children }) => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
                <h2 className="text-lg font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {count !== undefined && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {count}
                    </span>
                )}
                {to && <Link to={to} className="text-xs font-semibold text-blue-700 hover:text-blue-900">{actionLabel}</Link>}
            </div>
        </div>
        <div className="divide-y divide-slate-100">{children}</div>
    </section>
);

const EmptyRow = ({ children }) => (
    <div className="p-5 text-sm text-slate-500">{children}</div>
);

const DashboardCustomizeList = ({
    title,
    helper,
    items,
    hiddenIds,
    onToggle,
    onMove,
}) => {
    const hiddenSet = new Set(hiddenIds);

    return (
        <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
                <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
                <p className="mt-1 text-xs text-slate-500">{helper}</p>
            </div>
            <div className="divide-y divide-slate-100">
                {items.map((item, index) => {
                    const isHidden = hiddenSet.has(item.id);

                    return (
                        <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${isHidden ? 'bg-slate-50/70' : ''}`}>
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                                <input
                                    type="checkbox"
                                    checked={!isHidden}
                                    onChange={() => onToggle(item.id)}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                />
                                <span className="min-w-0">
                                    <span className={`block truncate text-sm font-semibold ${isHidden ? 'text-slate-500' : 'text-slate-900'}`}>
                                        {item.title}
                                    </span>
                                    <span className="block truncate text-xs text-slate-500">{item.description}</span>
                                </span>
                            </label>
                            <div className="flex shrink-0 gap-2">
                                <button
                                    type="button"
                                    onClick={() => onMove(item.id, -1)}
                                    disabled={index === 0}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    aria-label={`Move ${item.title} up`}
                                >
                                    <FaChevronUp className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onMove(item.id, 1)}
                                    disabled={index === items.length - 1}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    aria-label={`Move ${item.title} down`}
                                >
                                    <FaChevronDown className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const DashboardCustomizationModal = ({
    draftLayout,
    availableStatIds,
    availableWidgetIds,
    isSaving,
    onApplyPreset,
    onClose,
    onMoveStat,
    onMoveWidget,
    onSave,
    onToggleStat,
    onToggleWidget,
}) => {
    const statItems = draftLayout.statOrder
        .filter((id) => availableStatIds.includes(id))
        .map((id) => dashboardStatItemsById.get(id))
        .filter(Boolean);
    const widgetItems = draftLayout.widgetOrder
        .filter((id) => availableWidgetIds.includes(id))
        .map((id) => dashboardWidgetItemsById.get(id))
        .filter(Boolean);
    const activePresetTitle = dashboardPresetById.get(draftLayout.presetId)?.title || 'Custom';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div
                className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="dashboard-customizer-title"
            >
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                    <div>
                        <h3 id="dashboard-customizer-title" className="text-lg font-semibold text-slate-900">
                            Customize Dashboard
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                            Start from a preset, then choose which cards and widgets appear on your dashboard.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                        Cancel
                    </button>
                </div>

                <div className="max-h-[70vh] space-y-5 overflow-y-auto bg-slate-50 p-5">
                    <div>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-900">Starting Configurations</h4>
                                <p className="mt-1 text-xs text-slate-500">Current starting point: {activePresetTitle}</p>
                            </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            {DASHBOARD_LAYOUT_PRESETS.map((preset) => {
                                const isActive = draftLayout.presetId === preset.id;

                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => onApplyPreset(preset.id)}
                                        className={`rounded-lg border p-4 text-left transition ${
                                            isActive
                                                ? 'border-blue-500 bg-white shadow-sm ring-2 ring-blue-100'
                                                : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <span className="block text-sm font-semibold text-slate-900">{preset.title}</span>
                                        <span className="mt-1 block text-xs text-slate-500">{preset.description}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <DashboardCustomizeList
                        title="Dashboard Cards"
                        helper="These appear in the stat grid under the header."
                        items={statItems}
                        hiddenIds={draftLayout.hiddenStatIds}
                        onToggle={onToggleStat}
                        onMove={onMoveStat}
                    />

                    <DashboardCustomizeList
                        title="Preview Widgets"
                        helper="These appear in the main preview area. The first four visible widgets fill the wider section."
                        items={widgetItems}
                        hiddenIds={draftLayout.hiddenWidgetIds}
                        onToggle={onToggleWidget}
                        onMove={onMoveWidget}
                    />
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-between">
                    <button
                        type="button"
                        onClick={() => onApplyPreset('default')}
                        disabled={isSaving}
                        className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Reset Default
                    </button>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSaving}
                            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={isSaving}
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSaving ? 'Saving...' : 'Save Layout'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Dashboard = () => {
    const {
        dataBaseUser,
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        setDataBaseUser,
        user,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const [loading, setLoading] = useState(true);
    const [customers, setCustomers] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [leads, setLeads] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [payments, setPayments] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [serviceAgreements, setServiceAgreements] = useState([]);
    const [recurringServiceStops, setRecurringServiceStops] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [todoItems, setTodoItems] = useState([]);
    const [alertNotifications, setAlertNotifications] = useState([]);
    const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);
    const [draftLayout, setDraftLayout] = useState(() => dashboardLayoutFromPreset('default'));
    const [isSavingLayout, setIsSavingLayout] = useState(false);

    const todoListEnabled = featureFlagsLoaded && isFeatureEnabled(TODO_LIST_FEATURE_FLAG_ID);
    const alertsEnabled = featureFlagsLoaded && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);
    const dashboardLayout = useMemo(
        () => normalizeDashboardLayout(dataBaseUser?.settings?.companyDashboardLayout),
        [dataBaseUser]
    );

    useEffect(() => {
        if (!recentlySelectedCompany || !user) {
            setRoutes([]);
            setLoading(false);
            return;
        }

        const loadDashboard = async () => {
            setLoading(true);
            try {
                const [
                    customersSnap,
                    jobsSnap,
                    leadsSnap,
                    internalRepairsSnap,
                    externalRepairsSnap,
                    invoicesSnap,
                    paymentsSnap,
                    subscriptionsSnap,
                    agreementsSnap,
                    recurringStopsSnap,
                    routesSnap,
                ] = await Promise.all([
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "customers"), where("active", "==", true))),
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "workOrders"), where("operationStatus", "in", Array.from(activeJobStatuses)))),
                    getDocs(query(collection(db, "homeownerServiceRequests"), where("companyId", "==", recentlySelectedCompany), where("status", "==", "Pending"))),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "repairRequests")),
                    getDocs(query(collection(db, "homeownerRepairRequests"), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.invoices), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.payments), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.billingSubscriptions), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "recurringRoutes")),
                ]);

                setCustomers(customersSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setJobs(jobsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setLeads(leadsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRepairRequests([
                    ...internalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'internal', ...itemDoc.data() })),
                    ...externalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'external', ...itemDoc.data() })),
                ]);
                setInvoices(invoicesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setPayments(paymentsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setSubscriptions(subscriptionsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setServiceAgreements(agreementsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRecurringServiceStops(recurringStopsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRoutes(routesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
            } catch (error) {
                console.error("Error loading company dashboard:", error);
            } finally {
                setLoading(false);
            }
        };

        loadDashboard();
    }, [recentlySelectedCompany, user]);

    useEffect(() => {
        if (!recentlySelectedCompany || !featureFlagsLoaded) {
            setTodoItems([]);
            setAlertNotifications([]);
            return undefined;
        }

        const unsubscribers = [];

        if (todoListEnabled) {
            unsubscribers.push(onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "todoItems"),
                (snapshot) => {
                    setTodoItems(snapshot.docs.map(normalizeTodo));
                },
                (error) => {
                    console.error("Error loading dashboard todo items:", error);
                    setTodoItems([]);
                }
            ));
        } else {
            setTodoItems([]);
        }

        if (alertsEnabled) {
            unsubscribers.push(onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "alerts"),
                (snapshot) => {
                    setAlertNotifications(snapshot.docs.map(normalizeAlertNotification));
                },
                (error) => {
                    console.error("Error loading dashboard alerts:", error);
                    setAlertNotifications([]);
                }
            ));
        } else {
            setAlertNotifications([]);
        }

        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [alertsEnabled, featureFlagsLoaded, recentlySelectedCompany, todoListEnabled]);

    const summary = useMemo(() => {
        const activeRepairs = repairRequests.filter((request) => (
            isOpenRepairRequestStatus(request.status)
        ));
        const issuedInvoiceCents = invoices
            .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + Number(invoice.totalAmountCents || 0), 0);
        const openArCents = invoices
            .filter((invoice) => ['open', 'partiallypaid', 'overdue'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);
        const postedPayments = payments.filter((payment) => normalizeStatus(payment.status) === 'posted');
        const receivedCents = postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const paidThroughAppCents = postedPayments
            .filter((payment) => appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId)
            .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const recurringCents = subscriptions
            .filter((subscription) => ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status)))
            .reduce((total, subscription) => total + Number(subscription.amountCents || 0), 0);

        return {
            activeRepairs,
            issuedInvoiceCents,
            openArCents,
            receivedCents,
            paidThroughAppCents,
            recurringCents,
        };
    }, [invoices, payments, repairRequests, subscriptions]);

    const recurringStopsByServiceLocation = useMemo(() => {
        const set = new Set();
        recurringServiceStops.forEach((stop) => {
            if (stop.serviceLocationId && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek)) {
                set.add(stop.serviceLocationId);
            }
        });
        return set;
    }, [recurringServiceStops]);

    const recurringStopsByCustomer = useMemo(() => {
        const set = new Set();
        recurringServiceStops.forEach((stop) => {
            if (stop.customerId && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek)) {
                set.add(stop.customerId);
            }
        });
        return set;
    }, [recurringServiceStops]);

    const agreementsNeedRouting = useMemo(() => serviceAgreements.filter((agreement) => {
        const status = normalizeStatus(agreement.status);
        const sourceType = agreement.sourceType || '';
        const isJobAgreement =
            sourceType === SalesAgreementSourceType.oneOffJob ||
            agreement.rateType === 'oneTime' ||
            agreement.serviceCadence === 'oneTime' ||
            Boolean(agreement.jobId || agreement.workOrderId);

        if (status !== 'accepted' || isJobAgreement) return false;

        const serviceLocationIds = Array.isArray(agreement.serviceLocationIds)
            ? agreement.serviceLocationIds.filter(Boolean)
            : [];
        const hasLocationMatch = serviceLocationIds.some((serviceLocationId) => recurringStopsByServiceLocation.has(serviceLocationId));
        const hasCustomerFallbackMatch = serviceLocationIds.length === 0 && agreement.customerId && recurringStopsByCustomer.has(agreement.customerId);

        return !agreement.recurringServiceStopId && !hasLocationMatch && !hasCustomerFallbackMatch;
    }), [recurringStopsByCustomer, recurringStopsByServiceLocation, serviceAgreements]);

    const pendingServiceAgreements = useMemo(() => serviceAgreements.filter((agreement) => (
        pendingAgreementStatuses.has(normalizeStatus(agreement.status || SalesAgreementStatus.draft))
    )), [serviceAgreements]);

    const recentJobs = useMemo(() => sortFresh(jobs).slice(0, 5), [jobs]);
    const recentLeads = useMemo(() => sortFresh(leads).slice(0, 5), [leads]);
    const recentPayments = useMemo(() => sortFresh(payments.filter((payment) => normalizeStatus(payment.status) === 'posted')).slice(0, 5), [payments]);
    const openTodos = useMemo(() => todoItems.filter(todoIsOpen).sort(compareTodosByUrgency), [todoItems]);
    const attentionTodos = useMemo(() => openTodos.filter((todo) => todoNeedsAttention(todo)), [openTodos]);
    const activeAlerts = useMemo(() => alertNotifications.filter((alert) => alertNeedsAttention(alert)).sort(compareAlertsFresh), [alertNotifications]);
    const unreadAlerts = useMemo(() => alertNotifications.filter(alertIsUnread), [alertNotifications]);
    const dashboardAlerts = useMemo(() => alertNotifications
        .filter((alert) => alert.status !== ALERT_STATUS.archived)
        .sort((left, right) => {
            const attentionDifference = Number(alertNeedsAttention(right)) - Number(alertNeedsAttention(left));
            if (attentionDifference !== 0) return attentionDifference;
            return compareAlertsFresh(left, right);
        })
        .slice(0, 3), [alertNotifications]);

    const alertHref = (alert) => {
        if (alert.route && alert.route.startsWith('/')) return alert.route;
        if (alert.source === 'todoList' || alert.todoId) return '/company/todo-list';
        return '/company/alerts';
    };

    const availableStatIds = useMemo(() => DEFAULT_DASHBOARD_STAT_ORDER.filter((id) => {
        if (id === 'openTodos') return todoListEnabled;
        if (id === 'notifications') return alertsEnabled;
        return true;
    }), [alertsEnabled, todoListEnabled]);

    const availableWidgetIds = useMemo(() => DEFAULT_DASHBOARD_WIDGET_ORDER.filter((id) => {
        if (id === 'tasks') return todoListEnabled;
        if (id === 'alerts') return alertsEnabled;
        return true;
    }), [alertsEnabled, todoListEnabled]);

    const visibleStatIds = useMemo(() => {
        const hiddenIds = new Set(dashboardLayout.hiddenStatIds);
        return dashboardLayout.statOrder.filter((id) => availableStatIds.includes(id) && !hiddenIds.has(id));
    }, [availableStatIds, dashboardLayout]);

    const visibleWidgetIds = useMemo(() => {
        const hiddenIds = new Set(dashboardLayout.hiddenWidgetIds);
        return dashboardLayout.widgetOrder.filter((id) => availableWidgetIds.includes(id) && !hiddenIds.has(id));
    }, [availableWidgetIds, dashboardLayout]);

    const mainWidgetIds = visibleWidgetIds.slice(0, 4);
    const sidebarWidgetIds = visibleWidgetIds.slice(4);

    const openDashboardCustomizer = () => {
        setDraftLayout(dashboardLayout);
        setIsCustomizerOpen(true);
    };

    const applyPresetToDraft = (presetId) => {
        setDraftLayout(dashboardLayoutFromPreset(presetId));
    };

    const toggleDraftHiddenId = (hiddenKey, itemId) => {
        setDraftLayout((current) => {
            const hiddenIds = new Set(current[hiddenKey]);

            if (hiddenIds.has(itemId)) {
                hiddenIds.delete(itemId);
            } else {
                hiddenIds.add(itemId);
            }

            return normalizeDashboardLayout({
                ...current,
                presetId: 'custom',
                [hiddenKey]: [...hiddenIds],
            });
        });
    };

    const moveDraftItem = (orderKey, itemId, direction, availableIds) => {
        setDraftLayout((current) => {
            const visibleOrder = current[orderKey].filter((id) => availableIds.includes(id));
            const currentIndex = visibleOrder.indexOf(itemId);
            const nextIndex = currentIndex + direction;

            if (currentIndex === -1 || nextIndex < 0 || nextIndex >= visibleOrder.length) {
                return current;
            }

            const nextVisibleOrder = [...visibleOrder];
            [nextVisibleOrder[currentIndex], nextVisibleOrder[nextIndex]] = [nextVisibleOrder[nextIndex], nextVisibleOrder[currentIndex]];

            return normalizeDashboardLayout({
                ...current,
                presetId: 'custom',
                [orderKey]: [
                    ...nextVisibleOrder,
                    ...current[orderKey].filter((id) => !availableIds.includes(id)),
                ],
            });
        });
    };

    const saveDashboardLayout = async () => {
        if (!user?.uid || isSavingLayout) return;

        const nextLayout = normalizeDashboardLayout(draftLayout);
        setIsSavingLayout(true);

        try {
            await updateDoc(doc(db, "users", user.uid), {
                "settings.companyDashboardLayout": nextLayout,
            });
            setDataBaseUser((current) => ({
                ...current,
                settings: {
                    ...(current?.settings || {}),
                    companyDashboardLayout: nextLayout,
                },
            }));
            setIsCustomizerOpen(false);
            toast.success("Dashboard layout updated.");
        } catch (error) {
            console.error("Failed to save dashboard layout:", error);
            toast.error("Failed to save dashboard layout.");
        } finally {
            setIsSavingLayout(false);
        }
    };

    const renderStatTile = (statId) => {
        switch (statId) {
            case 'invoiced':
                return <StatTile key={statId} icon={FaFileInvoiceDollar} label="Invoiced" value={formatCurrency(summary.issuedInvoiceCents)} helper="Issued sales invoices" to="/company/sales/invoices" tone="blue" />;
            case 'received':
                return <StatTile key={statId} icon={FaReceipt} label="Received" value={formatCurrency(summary.receivedCents)} helper={`${formatCurrency(summary.paidThroughAppCents)} paid in app`} to="/company/sales/payments" tone="emerald" />;
            case 'openAr':
                return <StatTile key={statId} icon={FaMoneyBillWave} label="Open AR" value={formatCurrency(summary.openArCents)} helper="Outstanding customer balance" to="/company/sales/invoices" tone="amber" />;
            case 'recurring':
                return <StatTile key={statId} icon={FaCreditCard} label="Recurring" value={formatCurrency(summary.recurringCents)} helper="Active subscription amount" to="/company/sales/subscriptions" tone="blue" />;
            case 'activeJobs':
                return <StatTile key={statId} icon={MdConstruction} label="Jobs" value={jobs.length} helper="Open operational work" to="/company/jobs" tone="amber" />;
            case 'pendingLeads':
                return <StatTile key={statId} icon={MdOutlineLocalOffer} label="Leads" value={leads.length} helper="New homeowner requests" to="/company/leads" tone="blue" />;
            case 'pendingServiceAgreements':
                return <StatTile key={statId} icon={FaFileContract} label="Pending Service Agreements" value={pendingServiceAgreements.length} helper="Draft, sent, or revised" to="/company/sales/agreements" tone="blue" />;
            case 'needsRouting':
                return <StatTile key={statId} icon={FaFileContract} label="Needs Routing" value={agreementsNeedRouting.length} helper="Accepted service agreements" to="/company/route-dashboard" tone={agreementsNeedRouting.length ? "amber" : "emerald"} />;
            case 'routes':
                return <StatTile key={statId} icon={FaRoute} label="Routes" value={routes.length} helper="Planned recurring routes" to="/company/route-management" tone="blue" />;
            case 'customers':
                return <StatTile key={statId} icon={FaHouseUser} label="Customers" value={customers.length} helper="Active customer accounts" to="/company/customers" />;
            case 'openTodos':
                return <StatTile key={statId} icon={FaTasks} label="Open Todos" value={openTodos.length} helper={`${attentionTodos.length} need attention`} to="/company/todo-list" tone={attentionTodos.length ? "amber" : "blue"} />;
            case 'notifications':
                return <StatTile key={statId} icon={FaBell} label="Notifications" value={activeAlerts.length} helper={`${unreadAlerts.length} unread`} to="/company/alerts" tone={activeAlerts.length ? "amber" : "emerald"} />;
            default:
                return null;
        }
    };

    const renderDashboardWidget = (widgetId) => {
        switch (widgetId) {
            case 'currentWork':
                return (
                    <ListCard key={widgetId} title="Current Work" helper="Open jobs needing action" count={jobs.length} to="/company/jobs">
                        {recentJobs.length === 0 ? (
                            <EmptyRow>No current work orders.</EmptyRow>
                        ) : recentJobs.map((job) => (
                            <Link key={job.id} to={`/company/jobs/detail/${job.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{job.internalId || job.customerName || 'Job'}</p>
                                        <p className="mt-1 text-sm text-slate-500">{job.customerName || job.description || 'No customer saved'}</p>
                                    </div>
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                        {job.operationStatus || 'Open'}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </ListCard>
                );
            case 'recentLeads':
                return (
                    <ListCard key={widgetId} title="Recent Leads" helper="Pending homeowner requests" count={leads.length} to="/company/leads">
                        {recentLeads.length === 0 ? (
                            <EmptyRow>No recent leads.</EmptyRow>
                        ) : recentLeads.map((lead) => (
                            <Link key={lead.id} to={`/company/leads/${lead.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{lead.serviceName || 'Service request'}</p>
                                        <p className="mt-1 text-sm text-slate-500">{lead.homeownerName || lead.customerName || lead.email || 'Homeowner'}</p>
                                    </div>
                                    <span className="text-xs font-semibold text-slate-500">{formatDate(lead.createdAt)}</span>
                                </div>
                            </Link>
                        ))}
                    </ListCard>
                );
            case 'recentPayments':
                return (
                    <ListCard key={widgetId} title="Recently Paid" helper="Posted customer payments" to="/company/sales/payments">
                        {recentPayments.length === 0 ? (
                            <EmptyRow>No payments posted yet.</EmptyRow>
                        ) : recentPayments.map((payment) => (
                            <div key={payment.id} className="px-5 py-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{payment.customerName || 'Customer'}</p>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {payment.method || 'payment'} · {formatDate(payment.receivedAt || payment.createdAt)}
                                        </p>
                                    </div>
                                    <p className="text-sm font-bold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                                </div>
                            </div>
                        ))}
                    </ListCard>
                );
            case 'operationsAlerts':
                return (
                    <ListCard key={widgetId} title="Operations Alerts" helper="Repairs and route pressure" to="/company/operations-dashboard">
                        <div className="grid gap-3 p-5 sm:grid-cols-2">
                            <Link to="/company/repair-requests" className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:bg-blue-50">
                                <FaTools className="text-slate-500" />
                                <p className="mt-3 text-2xl font-bold text-slate-950">{summary.activeRepairs.length}</p>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Repairs</p>
                            </Link>
                            <Link to="/company/route-day-management" className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:bg-blue-50">
                                <FaRoute className="text-slate-500" />
                                <p className="mt-3 text-2xl font-bold text-slate-950">{jobs.filter((job) => job.operationStatus === 'Scheduled').length}</p>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled Jobs</p>
                            </Link>
                        </div>
                    </ListCard>
                );
            case 'tasks':
                return (
                    <ListCard key={widgetId} title="Tasks and Reminders" helper={`${attentionTodos.length} need attention`} count={openTodos.length} to="/company/todo-list">
                        {openTodos.length === 0 ? (
                            <EmptyRow>No open todos.</EmptyRow>
                        ) : openTodos.slice(0, 5).map((todo) => (
                            <Link key={todo.id} to="/company/todo-list" className="block px-5 py-4 transition hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{todo.title}</p>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {todo.assignedToName || "Team task"} · {todo.dueAt ? formatShortDateTime(todo.dueAt) : "No due date"}
                                        </p>
                                    </div>
                                    {todoNeedsAttention(todo) && (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                            Alert
                                        </span>
                                    )}
                                </div>
                            </Link>
                        ))}
                    </ListCard>
                );
            case 'alerts':
                return (
                    <ListCard key={widgetId} title="Alerts and Notifications" helper={`${unreadAlerts.length} unread`} count={activeAlerts.length} to="/company/alerts" actionLabel="All notifications">
                        {dashboardAlerts.length === 0 ? (
                            <EmptyRow>No notifications yet.</EmptyRow>
                        ) : dashboardAlerts.map((alert) => (
                            <Link key={alert.id} to={alertHref(alert)} className="block px-5 py-4 transition hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2">
                                            {alertNeedsAttention(alert) && (
                                                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="Needs attention" />
                                            )}
                                            <p className="truncate text-sm font-semibold text-slate-900">{alert.title}</p>
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{alert.message || "Notification"}</p>
                                    </div>
                                    <span className="shrink-0 text-xs font-semibold text-slate-500">{formatShortDateTime(alertDisplayTime(alert))}</span>
                                </div>
                            </Link>
                        ))}
                    </ListCard>
                );
            case 'messages':
                return (
                    <ListCard key={widgetId} title="Recent Messages" helper="Unread and recent conversations" to="/company/messages">
                        <div className="p-4">
                            <RecentChatsWidget />
                        </div>
                    </ListCard>
                );
            default:
                return null;
        }
    };

    if (loading) {
        return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading dashboard...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || 'Selected company'}</p>
                            <h1 className="mt-2 text-3xl font-bold text-slate-950">Dashboard</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                Business overview across operations, sales, finance, customers, and team activity.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={openDashboardCustomizer}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50"
                                aria-label="Customize dashboard"
                                title="Customize dashboard"
                            >
                                <FaCog className="h-4 w-4" />
                            </button>
                            <Link to="/company/operations-dashboard" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                                Operations
                            </Link>
                            <Link to="/company/sales" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
                                Sales Dashboard
                            </Link>
                        </div>
                    </div>
                </section>

                {visibleStatIds.length > 0 && (
                    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {visibleStatIds.map(renderStatTile)}
                    </section>
                )}

                {visibleWidgetIds.length > 0 && (
                    <section className={sidebarWidgetIds.length > 0 ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" : "grid gap-6"}>
                        {mainWidgetIds.length > 0 && (
                            <div className="grid gap-6 lg:grid-cols-2">
                                {mainWidgetIds.map(renderDashboardWidget)}
                            </div>
                        )}

                        {sidebarWidgetIds.length > 0 && (
                            <div className="space-y-6">
                                {sidebarWidgetIds.map(renderDashboardWidget)}
                            </div>
                        )}
                    </section>
                )}

                {isCustomizerOpen && (
                    <DashboardCustomizationModal
                        draftLayout={draftLayout}
                        availableStatIds={availableStatIds}
                        availableWidgetIds={availableWidgetIds}
                        isSaving={isSavingLayout}
                        onApplyPreset={applyPresetToDraft}
                        onClose={() => setIsCustomizerOpen(false)}
                        onMoveStat={(itemId, direction) => moveDraftItem('statOrder', itemId, direction, availableStatIds)}
                        onMoveWidget={(itemId, direction) => moveDraftItem('widgetOrder', itemId, direction, availableWidgetIds)}
                        onSave={saveDashboardLayout}
                        onToggleStat={(itemId) => toggleDraftHiddenId('hiddenStatIds', itemId)}
                        onToggleWidget={(itemId) => toggleDraftHiddenId('hiddenWidgetIds', itemId)}
                    />
                )}
            </div>
        </div>
    );
};

export default Dashboard;
