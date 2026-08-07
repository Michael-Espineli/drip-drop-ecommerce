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
    FaBoxOpen,
    FaChevronDown,
    FaChevronUp,
    FaClipboardCheck,
    FaCog,
    FaCreditCard,
    FaFileContract,
    FaFileInvoiceDollar,
    FaHouseUser,
    FaMapMarkedAlt,
    FaMoneyBillWave,
    FaReceipt,
    FaRoute,
    FaShoppingCart,
    FaTasks,
    FaTools,
    FaUser,
    FaUsers,
} from 'react-icons/fa';
import { MdConstruction, MdOutlineLocalOffer } from 'react-icons/md';
import Chart from 'react-apexcharts';
import toast from 'react-hot-toast';
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import { SalesAgreementSourceType, SalesAgreementStatus, salesCollectionNames } from '../../utils/models/Sales';
import { isOpenRepairRequestStatus } from '../../utils/models/RepairRequest';
import {
    customerHasAnyTag,
    getCustomerTagAccessList,
    getCustomerTagOptions,
    getEffectiveCustomerRegionAccess,
    normalizeCustomerTag,
    normalizeCustomerTags,
} from '../../utils/customerTags';
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from '../../utils/models/FeatureFlag';
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
const finishedRouteStatuses = new Set(['finished', 'complete', 'completed', 'done']);
const pendingAgreementStatuses = new Set([
    SalesAgreementStatus.draft,
    SalesAgreementStatus.sent,
    SalesAgreementStatus.revised,
]);

const DASHBOARD_SCOPE_OPTIONS = [
    {
        id: 'personal',
        label: 'Personal',
        icon: FaUser,
        description: 'My assigned routes, jobs, tasks, purchases, and alerts.',
    },
    {
        id: 'regional',
        label: 'Tag / Regional',
        icon: FaMapMarkedAlt,
        description: 'Customer-tag rollup for the selected region.',
    },
    {
        id: 'company',
        label: 'Whole Company',
        icon: FaUsers,
        description: 'All company work and financial activity.',
    },
];

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
    { id: 'routeCompletion', title: 'Route Completion', description: 'Finished active routes' },
    { id: 'shoppingItems', title: 'Shopping List', description: 'Open materials and parts' },
    { id: 'purchasedItems', title: 'Purchased Items', description: 'Unassigned purchased items' },
    { id: 'openTodos', title: 'Open Todos', description: 'Open task count' },
    { id: 'notifications', title: 'Notifications', description: 'Unread and active alerts' },
];

const DASHBOARD_WIDGET_ITEMS = [
    { id: 'currentWork', title: 'Current Work', description: 'Open jobs needing action' },
    { id: 'recentLeads', title: 'Recent Leads', description: 'Pending homeowner requests' },
    { id: 'recentPayments', title: 'Recently Paid', description: 'Posted customer payments' },
    { id: 'operationsAlerts', title: 'Operations Alerts', description: 'Repairs and route pressure' },
    { id: 'dailyActionBoard', title: 'Daily Action Board', description: 'Route, materials, purchases, and reminders' },
    { id: 'tasks', title: 'Tasks and Reminders', description: 'Open todos by urgency' },
    { id: 'alerts', title: 'Alerts and Notifications', description: 'Latest notification activity' },
    { id: 'messages', title: 'Recent Messages', description: 'Unread and recent conversations' },
];

const DEFAULT_DASHBOARD_STAT_ORDER = DASHBOARD_STAT_ITEMS.map((item) => item.id);
const DEFAULT_DASHBOARD_WIDGET_ORDER = DASHBOARD_WIDGET_ITEMS.map((item) => item.id);
const DASHBOARD_PRIMARY_STAT_LIMIT = 6;
const dashboardStatItemsById = new Map(DASHBOARD_STAT_ITEMS.map((item) => [item.id, item]));
const dashboardWidgetItemsById = new Map(DASHBOARD_WIDGET_ITEMS.map((item) => [item.id, item]));

const DASHBOARD_LAYOUT_PRESETS = [
    {
        id: 'default',
        title: 'Default',
        description: 'A focused pulse: routes, jobs, todos, materials, routing, and leads.',
        statOrder: ['routeCompletion', 'activeJobs', 'openTodos', 'shoppingItems', 'needsRouting', 'pendingLeads', 'purchasedItems', 'pendingServiceAgreements', 'routes', 'customers'],
        widgetOrder: ['dailyActionBoard', 'currentWork', 'operationsAlerts', 'tasks', 'recentLeads', 'alerts', 'messages', 'recentPayments'],
        hiddenStatIds: ['invoiced', 'received', 'openAr', 'recurring', 'notifications'],
        hiddenWidgetIds: [],
    },
    {
        id: 'operations',
        title: 'Operations',
        description: 'Route completion, job load, materials, purchases, routing, and tasks.',
        statOrder: ['routeCompletion', 'activeJobs', 'shoppingItems', 'purchasedItems', 'needsRouting', 'openTodos', 'routes', 'notifications', 'pendingLeads', 'pendingServiceAgreements', 'customers', 'openAr', 'invoiced', 'received', 'recurring'],
        widgetOrder: ['dailyActionBoard', 'currentWork', 'operationsAlerts', 'tasks', 'messages', 'alerts', 'recentLeads', 'recentPayments'],
        hiddenStatIds: ['recurring'],
        hiddenWidgetIds: ['recentPayments'],
    },
    {
        id: 'sales',
        title: 'Sales',
        description: 'Pipeline and cash signals without crowding the operational pulse.',
        statOrder: ['pendingLeads', 'pendingServiceAgreements', 'needsRouting', 'invoiced', 'received', 'openAr', 'recurring', 'customers', 'activeJobs', 'routeCompletion', 'routes', 'notifications', 'openTodos', 'shoppingItems', 'purchasedItems'],
        widgetOrder: ['recentLeads', 'recentPayments', 'currentWork', 'dailyActionBoard', 'messages', 'alerts', 'tasks', 'operationsAlerts'],
        hiddenStatIds: [],
        hiddenWidgetIds: ['operationsAlerts'],
    },
    {
        id: 'team',
        title: 'Team',
        description: 'People-facing work: todos, alerts, route progress, jobs, and materials.',
        statOrder: ['openTodos', 'notifications', 'routeCompletion', 'activeJobs', 'shoppingItems', 'needsRouting', 'purchasedItems', 'routes', 'pendingServiceAgreements', 'customers', 'pendingLeads', 'openAr', 'received', 'invoiced', 'recurring'],
        widgetOrder: ['dailyActionBoard', 'tasks', 'messages', 'alerts', 'currentWork', 'operationsAlerts', 'recentLeads', 'recentPayments'],
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

const getRecordCustomerId = (record = {}) => (
    record.customerId ||
    record.internalCustomerId ||
    record.customer?.id ||
    record.clientId ||
    record.homeownerCustomerId ||
    ''
);

const getRecordUserIds = (record = {}) => normalizeCustomerTags([
    record.userId,
    record.uid,
    record.techId,
    record.technicianId,
    record.assignedTo,
    record.assignedToId,
    record.assignedUserId,
    record.companyUserId,
    record.ownerId,
    record.createdBy,
    record.createdByUid,
    record.requestedByUserId,
    ...(Array.isArray(record.assignedUserIds) ? record.assignedUserIds : []),
    ...(Array.isArray(record.techIds) ? record.techIds : []),
    ...(Array.isArray(record.participantIds) ? record.participantIds : []),
]);

const recordBelongsToUser = (record = {}, userIds = []) => {
    const normalizedUserIds = normalizeCustomerTags(userIds).map((id) => id.toLowerCase());
    if (normalizedUserIds.length === 0) return false;

    const recordUserIds = getRecordUserIds(record).map((id) => id.toLowerCase());
    return recordUserIds.some((id) => normalizedUserIds.includes(id));
};

const getRecordCustomer = (record = {}, customersById = new Map()) => {
    const customerId = getRecordCustomerId(record);
    if (customerId && customersById.has(customerId)) return customersById.get(customerId);

    const customerName = String(record.customerName || record.homeownerName || '').trim().toLowerCase();
    if (!customerName) return null;

    return [...customersById.values()].find((customer) => {
        const names = [
            customer.company,
            customer.companyName,
            customer.customerName,
            `${customer.firstName || ''} ${customer.lastName || ''}`,
        ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

        return names.includes(customerName);
    }) || null;
};

const recordMatchesCustomerTags = (record = {}, customersById = new Map(), tags = []) => {
    const normalizedTags = normalizeCustomerTags(tags);
    if (normalizedTags.length === 0) return true;

    const customer = getRecordCustomer(record, customersById);
    if (customer) return customerHasAnyTag(customer, normalizedTags);

    return customerHasAnyTag({ tags: record.tags || record.customerTags || record.regionalTags }, normalizedTags);
};

const isRouteFinished = (route = {}) => finishedRouteStatuses.has(normalizeStatus(route.status || route.routeStatus || route.operationStatus));

const isOpenShoppingItem = (item = {}) => {
    const status = normalizeStatus(item.status || item.purchaseStatus || item.state);
    return !['purchased', 'ordered', 'complete', 'completed', 'closed', 'cancelled', 'canceled'].includes(status);
};

const isUnassignedPurchasedItem = (item = {}) => {
    const status = normalizeStatus(item.status || item.assignmentStatus || item.state);
    return !item.jobId && !item.workOrderId && !item.customerId && !['assigned', 'installed', 'complete', 'completed', 'closed'].includes(status);
};

const getInitials = (name = '') => String(name || '')
    .split(' ')
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'DD';

const buildStatusSeries = (records = [], statusAccessor, fallback = 'Unknown') => {
    const counts = records.reduce((acc, record) => {
        const status = String(statusAccessor(record) || fallback).trim() || fallback;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    return Object.entries(counts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5);
};

const MiniBarChart = ({ title, helper, data, color = '#2563eb' }) => {
    const categories = data.map(([label]) => label);
    const seriesData = data.map(([, value]) => value);
    const hasData = seriesData.some((value) => value > 0);

    const options = {
        chart: {
            toolbar: { show: false },
            sparkline: { enabled: false },
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        },
        colors: [color],
        dataLabels: { enabled: false },
        grid: {
            borderColor: '#e2e8f0',
            strokeDashArray: 3,
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } },
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                columnWidth: '52%',
            },
        },
        xaxis: {
            categories,
            labels: {
                rotate: -20,
                trim: true,
                style: { colors: '#64748b', fontSize: '11px' },
            },
            axisBorder: { show: false },
            axisTicks: { show: false },
        },
        yaxis: {
            min: 0,
            labels: {
                style: { colors: '#64748b', fontSize: '11px' },
                formatter: (value) => Math.round(value),
            },
        },
        tooltip: { theme: 'light' },
    };

    return (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3">
                <h2 className="text-sm font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
            </div>
            {hasData ? (
                <Chart options={options} series={[{ name: title, data: seriesData }]} type="bar" height={210} />
            ) : (
                <div className="flex h-[210px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                    No data in this scope.
                </div>
            )}
        </section>
    );
};

const ScopeButton = ({ scope, isActive, onClick }) => {
    const Icon = scope.icon;

    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex min-w-[150px] flex-1 items-start gap-3 rounded-md border px-4 py-3 text-left transition ${
                isActive
                    ? 'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
        >
            <span className={`mt-0.5 rounded-md p-2 ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-bold">{scope.label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{scope.description}</span>
            </span>
        </button>
    );
};

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
                        helper={`The first ${DASHBOARD_PRIMARY_STAT_LIMIT} visible cards appear in the focused KPI strip.`}
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
        companyUserAccess,
        companyRole,
        selectedCustomerRegionTag,
        setSelectedCustomerRegionTag,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const [loading, setLoading] = useState(true);
    const [dashboardScope, setDashboardScope] = useState('personal');
    const [customers, setCustomers] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [leads, setLeads] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);
    const [shoppingItems, setShoppingItems] = useState([]);
    const [purchasedItems, setPurchasedItems] = useState([]);
    const [activeRoutes, setActiveRoutes] = useState([]);
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
    const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);
    const dashboardLayout = useMemo(
        () => normalizeDashboardLayout(dataBaseUser?.settings?.companyDashboardLayout),
        [dataBaseUser]
    );
    const currentUserIds = useMemo(() => normalizeCustomerTags([
        user?.uid,
        dataBaseUser?.uid,
        dataBaseUser?.id,
        companyUserAccess?.id,
        companyUserAccess?.userId,
        companyUserAccess?.uid,
        companyUserAccess?.companyUserId,
        companyUserAccess?.companyUserDocId,
    ]), [companyUserAccess, dataBaseUser, user]);
    const currentUserName = useMemo(() => (
        String(
            companyUserAccess?.displayName ||
            companyUserAccess?.name ||
            dataBaseUser?.displayName ||
            `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}` ||
            user?.displayName ||
            'You'
        ).trim() || 'You'
    ), [companyUserAccess, dataBaseUser, user]);

    useEffect(() => {
        if (!recentlySelectedCompany || !user) {
            setCustomers([]);
            setJobs([]);
            setLeads([]);
            setRepairRequests([]);
            setShoppingItems([]);
            setPurchasedItems([]);
            setActiveRoutes([]);
            setInvoices([]);
            setPayments([]);
            setSubscriptions([]);
            setServiceAgreements([]);
            setRecurringServiceStops([]);
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
                    shoppingSnap,
                    purchasedSnap,
                    activeRoutesSnap,
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
                    getDocs(collection(db, "companies", recentlySelectedCompany, "shoppingList")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "purchasedItems")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "activeRoutes")),
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
                setShoppingItems(shoppingSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setPurchasedItems(purchasedSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setActiveRoutes(activeRoutesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
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

    const customersById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
    const customerRegionAccess = useMemo(
        () => getEffectiveCustomerRegionAccess({ userAccess: companyUserAccess, role: companyRole }),
        [companyRole, companyUserAccess]
    );
    const availableCustomerTags = useMemo(() => getCustomerTagOptions(customers), [customers]);
    const accessibleRegionalTags = useMemo(() => (
        customerRegionAccess.fullAccess ? availableCustomerTags : getCustomerTagAccessList(companyUserAccess).concat(getCustomerTagAccessList(companyRole))
    ), [availableCustomerTags, companyRole, companyUserAccess, customerRegionAccess.fullAccess]);
    const regionalScopeTag = useMemo(() => {
        const selectedTag = normalizeCustomerTag(selectedCustomerRegionTag);
        if (selectedTag) return selectedTag;
        return normalizeCustomerTags(accessibleRegionalTags)[0] || '';
    }, [accessibleRegionalTags, selectedCustomerRegionTag]);
    const scopeLabel = dashboardScope === 'personal'
        ? currentUserName
        : dashboardScope === 'regional'
            ? (regionalScopeTag || 'No tag selected')
            : recentlySelectedCompanyName || 'Whole company';
    const scopeHelper = dashboardScope === 'personal'
        ? 'Defaults to your assigned work, matching the iOS daily dashboard pattern.'
        : dashboardScope === 'regional'
            ? 'Uses the current customer tag/area selection where customer-linked records can be matched.'
            : 'Shows all loaded company records for the selected company.';

    const scopedData = useMemo(() => {
        if (dashboardScope === 'company') {
            return {
                customers,
                jobs,
                leads,
                repairRequests,
                shoppingItems,
                purchasedItems,
                activeRoutes,
                invoices,
                payments,
                subscriptions,
                serviceAgreements,
                recurringServiceStops,
                routes,
            };
        }

        if (dashboardScope === 'regional') {
            const tags = regionalScopeTag ? [regionalScopeTag] : [];
            const filterByRegion = (records) => records.filter((record) => recordMatchesCustomerTags(record, customersById, tags));
            const regionalCustomers = tags.length > 0
                ? customers.filter((customer) => customerHasAnyTag(customer, tags))
                : customers;

            return {
                customers: regionalCustomers,
                jobs: filterByRegion(jobs),
                leads: filterByRegion(leads),
                repairRequests: filterByRegion(repairRequests),
                shoppingItems: filterByRegion(shoppingItems),
                purchasedItems: filterByRegion(purchasedItems),
                activeRoutes: filterByRegion(activeRoutes),
                invoices: filterByRegion(invoices),
                payments: filterByRegion(payments),
                subscriptions: filterByRegion(subscriptions),
                serviceAgreements: filterByRegion(serviceAgreements),
                recurringServiceStops: filterByRegion(recurringServiceStops),
                routes: filterByRegion(routes),
            };
        }

        const personalRecordFilter = (records) => records.filter((record) => recordBelongsToUser(record, currentUserIds));

        return {
            customers: customers.filter((customer) => recordBelongsToUser(customer, currentUserIds)),
            jobs: personalRecordFilter(jobs),
            leads: personalRecordFilter(leads),
            repairRequests: personalRecordFilter(repairRequests),
            shoppingItems: personalRecordFilter(shoppingItems),
            purchasedItems: personalRecordFilter(purchasedItems),
            activeRoutes: personalRecordFilter(activeRoutes),
            invoices: personalRecordFilter(invoices),
            payments: personalRecordFilter(payments),
            subscriptions: personalRecordFilter(subscriptions),
            serviceAgreements: personalRecordFilter(serviceAgreements),
            recurringServiceStops: personalRecordFilter(recurringServiceStops),
            routes: personalRecordFilter(routes),
        };
    }, [
        activeRoutes,
        currentUserIds,
        customers,
        customersById,
        dashboardScope,
        invoices,
        jobs,
        leads,
        payments,
        purchasedItems,
        recurringServiceStops,
        regionalScopeTag,
        repairRequests,
        routes,
        serviceAgreements,
        shoppingItems,
        subscriptions,
    ]);

    const scopedTodoItems = useMemo(() => (
        dashboardScope === 'company'
            ? todoItems
            : dashboardScope === 'regional'
                ? todoItems.filter((todo) => recordMatchesCustomerTags(todo, customersById, regionalScopeTag ? [regionalScopeTag] : []))
                : todoItems.filter((todo) => recordBelongsToUser(todo, currentUserIds))
    ), [currentUserIds, customersById, dashboardScope, regionalScopeTag, todoItems]);

    const scopedAlertNotifications = useMemo(() => (
        dashboardScope === 'company'
            ? alertNotifications
            : dashboardScope === 'regional'
                ? alertNotifications.filter((alert) => recordMatchesCustomerTags(alert, customersById, regionalScopeTag ? [regionalScopeTag] : []))
                : alertNotifications.filter((alert) => recordBelongsToUser(alert, currentUserIds) || !getRecordUserIds(alert).length)
    ), [alertNotifications, currentUserIds, customersById, dashboardScope, regionalScopeTag]);

    const summary = useMemo(() => {
        const activeRepairs = scopedData.repairRequests.filter((request) => (
            isOpenRepairRequestStatus(request.status)
        ));
        const issuedInvoiceCents = scopedData.invoices
            .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + Number(invoice.totalAmountCents || 0), 0);
        const openArCents = scopedData.invoices
            .filter((invoice) => ['open', 'partiallypaid', 'overdue'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);
        const postedPayments = scopedData.payments.filter((payment) => normalizeStatus(payment.status) === 'posted');
        const receivedCents = postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const paidThroughAppCents = postedPayments
            .filter((payment) => appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId)
            .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const recurringCents = scopedData.subscriptions
            .filter((subscription) => ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status)))
            .reduce((total, subscription) => total + Number(subscription.amountCents || 0), 0);
        const openShoppingItems = scopedData.shoppingItems.filter(isOpenShoppingItem);
        const unassignedPurchasedItems = scopedData.purchasedItems.filter(isUnassignedPurchasedItem);
        const finishedRoutes = scopedData.activeRoutes.filter(isRouteFinished);
        const activeRouteCount = scopedData.activeRoutes.length;

        return {
            activeRepairs,
            issuedInvoiceCents,
            openArCents,
            receivedCents,
            paidThroughAppCents,
            recurringCents,
            openShoppingItems,
            unassignedPurchasedItems,
            activeRouteCount,
            finishedRoutes,
            routeCompletionRate: activeRouteCount ? Math.round((finishedRoutes.length / activeRouteCount) * 100) : 0,
        };
    }, [scopedData]);

    const recurringStopsByServiceLocation = useMemo(() => {
        const set = new Set();
        scopedData.recurringServiceStops.forEach((stop) => {
            if (stop.serviceLocationId && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek)) {
                set.add(stop.serviceLocationId);
            }
        });
        return set;
    }, [scopedData.recurringServiceStops]);

    const recurringStopsByCustomer = useMemo(() => {
        const set = new Set();
        scopedData.recurringServiceStops.forEach((stop) => {
            if (stop.customerId && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek)) {
                set.add(stop.customerId);
            }
        });
        return set;
    }, [scopedData.recurringServiceStops]);

    const agreementsNeedRouting = useMemo(() => scopedData.serviceAgreements.filter((agreement) => {
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
    }), [recurringStopsByCustomer, recurringStopsByServiceLocation, scopedData.serviceAgreements]);

    const pendingServiceAgreements = useMemo(() => scopedData.serviceAgreements.filter((agreement) => (
        pendingAgreementStatuses.has(normalizeStatus(agreement.status || SalesAgreementStatus.draft))
    )), [scopedData.serviceAgreements]);

    const recentJobs = useMemo(() => sortFresh(scopedData.jobs).slice(0, 5), [scopedData.jobs]);
    const recentLeads = useMemo(() => sortFresh(scopedData.leads).slice(0, 5), [scopedData.leads]);
    const recentPayments = useMemo(() => sortFresh(scopedData.payments.filter((payment) => normalizeStatus(payment.status) === 'posted')).slice(0, 5), [scopedData.payments]);
    const recentShoppingItems = useMemo(() => sortFresh(summary.openShoppingItems).slice(0, 4), [summary.openShoppingItems]);
    const recentPurchasedItems = useMemo(() => sortFresh(summary.unassignedPurchasedItems).slice(0, 4), [summary.unassignedPurchasedItems]);
    const openTodos = useMemo(() => scopedTodoItems.filter(todoIsOpen).sort(compareTodosByUrgency), [scopedTodoItems]);
    const attentionTodos = useMemo(() => openTodos.filter((todo) => todoNeedsAttention(todo)), [openTodos]);
    const activeAlerts = useMemo(() => scopedAlertNotifications.filter((alert) => alertNeedsAttention(alert)).sort(compareAlertsFresh), [scopedAlertNotifications]);
    const unreadAlerts = useMemo(() => scopedAlertNotifications.filter(alertIsUnread), [scopedAlertNotifications]);
    const dashboardAlerts = useMemo(() => scopedAlertNotifications
        .filter((alert) => alert.status !== ALERT_STATUS.archived)
        .sort((left, right) => {
            const attentionDifference = Number(alertNeedsAttention(right)) - Number(alertNeedsAttention(left));
            if (attentionDifference !== 0) return attentionDifference;
            return compareAlertsFresh(left, right);
        })
        .slice(0, 3), [scopedAlertNotifications]);
    const jobStatusSeries = useMemo(() => buildStatusSeries(scopedData.jobs, (job) => job.operationStatus || job.status), [scopedData.jobs]);
    const agreementStatusSeries = useMemo(() => buildStatusSeries(scopedData.serviceAgreements, (agreement) => agreement.status), [scopedData.serviceAgreements]);

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
    const primaryStatIds = useMemo(
        () => visibleStatIds.slice(0, DASHBOARD_PRIMARY_STAT_LIMIT),
        [visibleStatIds]
    );

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
                return <StatTile key={statId} icon={MdConstruction} label="Jobs" value={scopedData.jobs.length} helper="Open operational work" to="/company/jobs" tone="amber" />;
            case 'routeCompletion':
                return <StatTile key={statId} icon={FaClipboardCheck} label="Route Completion" value={`${summary.routeCompletionRate}%`} helper={`${summary.finishedRoutes.length} of ${summary.activeRouteCount} active routes`} to="/company/route-day-management" tone={summary.routeCompletionRate >= 80 ? "emerald" : "blue"} />;
            case 'shoppingItems':
                return <StatTile key={statId} icon={FaShoppingCart} label="Shopping List" value={summary.openShoppingItems.length} helper="Open materials and parts" to="/company/shopping-list" tone={summary.openShoppingItems.length ? "amber" : "emerald"} />;
            case 'purchasedItems':
                return <StatTile key={statId} icon={FaBoxOpen} label="Purchased Items" value={summary.unassignedPurchasedItems.length} helper="Unassigned purchased items" to="/company/purchased-items" tone={summary.unassignedPurchasedItems.length ? "amber" : "emerald"} />;
            case 'pendingLeads':
                return <StatTile key={statId} icon={MdOutlineLocalOffer} label="Leads" value={scopedData.leads.length} helper="New homeowner requests" to="/company/leads" tone="blue" />;
            case 'pendingServiceAgreements':
                return <StatTile key={statId} icon={FaFileContract} label="Pending Service Agreements" value={pendingServiceAgreements.length} helper="Draft, sent, or revised" to="/company/sales/agreements" tone="blue" />;
            case 'needsRouting':
                return <StatTile key={statId} icon={FaFileContract} label="Needs Routing" value={agreementsNeedRouting.length} helper="Accepted service agreements" to="/company/route-dashboard" tone={agreementsNeedRouting.length ? "amber" : "emerald"} />;
            case 'routes':
                return <StatTile key={statId} icon={FaRoute} label="Routes" value={scopedData.routes.length} helper="Planned recurring routes" to="/company/route-management" tone="blue" />;
            case 'customers':
                return <StatTile key={statId} icon={FaHouseUser} label="Customers" value={scopedData.customers.length} helper="Active customer accounts" to="/company/customers" />;
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
                    <ListCard key={widgetId} title="Current Work" helper="Open jobs needing action" count={scopedData.jobs.length} to="/company/jobs">
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
                    <ListCard key={widgetId} title="Recent Leads" helper="Pending homeowner requests" count={scopedData.leads.length} to="/company/leads">
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
                                <p className="mt-3 text-2xl font-bold text-slate-950">{scopedData.jobs.filter((job) => job.operationStatus === 'Scheduled').length}</p>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled Jobs</p>
                            </Link>
                        </div>
                    </ListCard>
                );
            case 'dailyActionBoard':
                return (
                    <ListCard key={widgetId} title="Daily Action Board" helper="Field-work signals pulled from the iOS dashboard pattern" to="/company/operations-dashboard">
                        <div className="grid gap-3 p-5 sm:grid-cols-2">
                            <Link to="/company/route-day-management" className="rounded-md border border-slate-200 bg-slate-50 p-4 transition hover:bg-blue-50">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Routes</p>
                                        <p className="mt-2 text-2xl font-bold text-slate-950">{summary.routeCompletionRate}%</p>
                                    </div>
                                    <FaRoute className="text-blue-600" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">{summary.finishedRoutes.length} finished of {summary.activeRouteCount} active</p>
                            </Link>
                            <Link to="/company/todo-list" className="rounded-md border border-slate-200 bg-slate-50 p-4 transition hover:bg-blue-50">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">To Do</p>
                                        <p className="mt-2 text-2xl font-bold text-slate-950">{openTodos.length}</p>
                                    </div>
                                    <FaTasks className="text-amber-600" />
                                </div>
                                <p className="mt-3 text-sm text-slate-500">{attentionTodos.length} need attention</p>
                            </Link>
                            <Link to="/company/shopping-list" className="rounded-md border border-slate-200 bg-slate-50 p-4 transition hover:bg-blue-50">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shopping List</p>
                                        <p className="mt-2 text-2xl font-bold text-slate-950">{summary.openShoppingItems.length}</p>
                                    </div>
                                    <FaShoppingCart className="text-emerald-600" />
                                </div>
                                <p className="mt-3 truncate text-sm text-slate-500">
                                    {recentShoppingItems[0]?.name || recentShoppingItems[0]?.title || recentShoppingItems[0]?.itemName || 'No open materials'}
                                </p>
                            </Link>
                            <Link to="/company/purchased-items" className="rounded-md border border-slate-200 bg-slate-50 p-4 transition hover:bg-blue-50">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purchased Items</p>
                                        <p className="mt-2 text-2xl font-bold text-slate-950">{summary.unassignedPurchasedItems.length}</p>
                                    </div>
                                    <FaBoxOpen className="text-rose-600" />
                                </div>
                                <p className="mt-3 truncate text-sm text-slate-500">
                                    {recentPurchasedItems[0]?.name || recentPurchasedItems[0]?.title || recentPurchasedItems[0]?.itemName || 'No unassigned purchases'}
                                </p>
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
        <div className="min-h-screen bg-slate-100 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-5">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">
                                    {recentlySelectedCompanyName || 'Selected company'}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                    Scope: {scopeLabel}
                                </span>
                            </div>
                            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                <div>
                                    <h1 className="text-3xl font-bold text-slate-950">Company Dashboard</h1>
                                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                                        Daily work, customer pipeline, routing pressure, and finance signals in one view.
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
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
                                    {getInitials(scopeLabel)}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-slate-950">{scopeLabel}</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">{scopeHelper}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-3 lg:grid-cols-3">
                    {DASHBOARD_SCOPE_OPTIONS.map((scope) => (
                        <ScopeButton
                            key={scope.id}
                            scope={scope}
                            isActive={dashboardScope === scope.id}
                            onClick={() => setDashboardScope(scope.id)}
                        />
                    ))}
                </section>

                {dashboardScope === 'regional' && (
                    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-slate-950">Regional Tag</h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    Pick the customer tag used for this dashboard scope.
                                </p>
                            </div>
                            <select
                                value={selectedCustomerRegionTag || regionalScopeTag || ''}
                                onChange={(event) => setSelectedCustomerRegionTag(event.target.value)}
                                disabled={!customerAreaFilteringEnabled && availableCustomerTags.length === 0}
                                className="h-10 min-w-[220px] rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            >
                                <option value="">All available tags</option>
                                {normalizeCustomerTags(accessibleRegionalTags).map((tag) => (
                                    <option key={tag} value={tag}>{tag}</option>
                                ))}
                            </select>
                        </div>
                    </section>
                )}

                {primaryStatIds.length > 0 && (
                    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                        {primaryStatIds.map(renderStatTile)}
                    </section>
                )}

                <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
                    <MiniBarChart
                        title="Job Status Mix"
                        helper="Top open-work statuses for the active scope."
                        data={jobStatusSeries}
                        color="#2563eb"
                    />
                    <MiniBarChart
                        title="Agreement Funnel"
                        helper="Service agreement states that affect routing and sales."
                        data={agreementStatusSeries}
                        color="#0f766e"
                    />
                </section>

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
