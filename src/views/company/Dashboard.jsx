import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    collection,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import {
    FaCalendarAlt,
    FaClipboardCheck,
    FaExclamationTriangle,
    FaFileContract,
    FaMapMarkedAlt,
    FaTasks,
    FaTools,
    FaUser,
    FaUsers,
} from 'react-icons/fa';
import { MdConstruction, MdOutlineLocalOffer } from 'react-icons/md';
import Chart from 'react-apexcharts';
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import { TODO_ALL_BOARDS_PERMISSION_ID } from '../../utils/companyPermissions';
import { roleHasCompanyPermission } from '../../utils/companyPermissionAccess';
import { SalesAgreementSourceType, SalesAgreementStatus, salesCollectionNames } from '../../utils/models/Sales';
import { SERVICE_STOP_TYPE_USE_CASES, normalizeServiceStopTypeBucket } from '../../utils/serviceStopTypes/serviceStopTypeResolver';
import { normalizeEquipmentStatus } from '../../utils/models/Equipment';
import { isOpenRepairRequestStatus } from '../../utils/models/RepairRequest';
import {
    customerHasAnyTag,
    getCustomerTagAccessList,
    getCustomerTagOptions,
    getEffectiveCustomerRegionAccess,
    normalizeCustomerTag,
    normalizeCustomerTags,
} from '../../utils/customerTags';
import {
    DASHBOARD_SCOPE_ACCESS_OPTIONS,
    getEffectiveDashboardScopeAccess,
} from '../../utils/dashboardAccess';
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from '../../utils/models/FeatureFlag';
import RecentChatsWidget from '../dashboard/components/RecentChatsWidget';
import {
    TODO_LIST_FEATURE_FLAG_ID,
    compareTodosByUrgency,
    normalizeTodo,
    todoIsOpen,
    todoNeedsAttention,
    todoVisibleToUser,
} from '../../utils/models/TodoItem';
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    ALERT_STATUS,
    alertIsUnread,
    alertNeedsAttention,
    compareAlertsFresh,
    normalizeAlertNotification,
} from '../../utils/models/AlertNotification';

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const dayNumberFormatter = new Intl.DateTimeFormat('en-US', { day: 'numeric' });
const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const shortDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const appPaymentMethods = new Set(['stripeCard', 'stripeAch']);
const activeJobStatuses = new Set(["Estimate Pending", "Unscheduled", "Scheduled", "In Progress"]);
const finishedRouteStatuses = new Set(['finished', 'complete', 'completed', 'done']);
const pendingAgreementStatuses = new Set([
    SalesAgreementStatus.draft,
    SalesAgreementStatus.sent,
    SalesAgreementStatus.revised,
]);
const agreementMonthlyStatuses = new Set(['accepted', 'active']);
const serviceAgreementSurveyBuckets = new Set([
    SERVICE_STOP_TYPE_USE_CASES.serviceAgreementEstimate,
    'serviceagreementestimate',
    'serviceestimate',
    'newserviceestimate',
    'recurringserviceestimate',
    'startup',
    'startupservice',
    'startups',
    'newpool',
    'systemserviceagreementestimateservicestop',
].map(normalizeServiceStopTypeBucket));

const dashboardScopeIcons = {
    personal: FaUser,
    regional: FaMapMarkedAlt,
    company: FaUsers,
};

const DASHBOARD_SCOPE_OPTIONS = DASHBOARD_SCOPE_ACCESS_OPTIONS.map((scope) => ({
    ...scope,
    icon: dashboardScopeIcons[scope.id] || FaUser,
}));

const DASHBOARD_SCOPE_COPY = {
    personal: {
        label: "Personal",
        description: "My assigned routes, jobs, tasks, purchases, and alerts.",
    },
    regional: {
        label: "Tag / Regional",
        description: "Customer-tag rollup for the selected region.",
    },
    company: {
        label: "Whole Company",
        description: "All company work and financial activity.",
    },
};

const DASHBOARD_SCOPE_VIEW_OPTIONS = DASHBOARD_SCOPE_OPTIONS.map((scope) => ({
    ...scope,
    ...(DASHBOARD_SCOPE_COPY[scope.id] || {}),
}));

const REGIONAL_COMPANY_TOP_STAT_IDS = [
    'pendingLeads',
    'surveys',
    'pendingServiceAgreements',
    'needsRouting',
    'routedCustomers',
    'todayRoutes',
    'openRepairRequests',
    'openJobs',
];

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

const formatShortDate = (value) => {
    const millis = toMillis(value);
    return millis ? shortDateFormatter.format(new Date(millis)) : 'Not set';
};

const startOfLocalDay = (value = new Date()) => {
    const date = value instanceof Date ? new Date(value) : new Date(toMillis(value));
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
};

const endOfLocalDay = (value = new Date()) => {
    const date = startOfLocalDay(value);
    if (!date) return null;
    date.setHours(23, 59, 59, 999);
    return date;
};

const addDays = (value, days) => {
    const date = startOfLocalDay(value);
    if (!date) return null;
    date.setDate(date.getDate() + days);
    return date;
};

const sameLocalDay = (left, right) => {
    const leftStart = startOfLocalDay(left);
    const rightStart = startOfLocalDay(right);
    return Boolean(leftStart && rightStart && leftStart.getTime() === rightStart.getTime());
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

const getRecordCustomerIds = (record = {}) => normalizeCustomerTags([
    getRecordCustomerId(record),
    record.customerID,
    record.homeownerCustomerID,
    record.relationshipCustomerId,
    ...(Array.isArray(record.customerIds) ? record.customerIds : []),
    ...(Array.isArray(record.customerIDList) ? record.customerIDList : []),
]);

const getRecordUserIds = (record = {}) => normalizeCustomerTags([
    record.adminId,
    record.admin?.id,
    record.admin?.userId,
    record.assignedAdminId,
    record.assignedAdminUserId,
    record.userId,
    record.uid,
    record.techId,
    record.technicianId,
    record.assignedTechId,
    record.workerId,
    record.assignedTo,
    record.assignedTo?.id,
    record.assignedTo?.userId,
    record.assignedToId,
    record.assignedToUserId,
    record.assignedToCompanyUserDocId,
    record.assignedUserId,
    record.companyUserId,
    ...(Array.isArray(record.boardMemberUserIds) ? record.boardMemberUserIds : []),
    ...(Array.isArray(record.boardMemberCompanyUserDocIds) ? record.boardMemberCompanyUserDocIds : []),
    record.ownerId,
    record.createdBy,
    record.createdById,
    record.createdByUid,
    record.createdByUserId,
    record.requesterId,
    record.requestedBy,
    record.requestedByUid,
    record.requestedByUserId,
    record.homeownerId,
    record.submittedBy,
    record.submittedByUserId,
    record.authorId,
    record.purchaserId,
    ...(Array.isArray(record.assignedUserIds) ? record.assignedUserIds : []),
    ...(Array.isArray(record.techIds) ? record.techIds : []),
    ...(Array.isArray(record.participantIds) ? record.participantIds : []),
]);

const getRecordAdminNames = (record = {}) => normalizeCustomerTags([
    record.adminName,
    record.admin?.name,
    record.admin?.userName,
    record.assignedAdminName,
]);

const getRecordSubmitterIds = (record = {}) => normalizeCustomerTags([
    record.requesterId,
    record.userId,
    record.uid,
    record.homeownerId,
    record.createdBy,
    record.createdById,
    record.createdByUid,
    record.createdByUserId,
    record.requestedBy,
    record.requestedByUid,
    record.requestedByUserId,
    record.submittedBy,
    record.submittedByUserId,
    record.authorId,
]);

const recordBelongsToUser = (record = {}, userIds = []) => {
    const normalizedUserIds = normalizeCustomerTags(userIds).map((id) => id.toLowerCase());
    if (normalizedUserIds.length === 0) return false;

    const recordUserIds = getRecordUserIds(record).map((id) => id.toLowerCase());
    return recordUserIds.some((id) => normalizedUserIds.includes(id));
};

const jobAdminAssignedToUser = (job = {}, userIds = [], userTags = []) => {
    const normalizedUserIds = normalizeCustomerTags(userIds).map((id) => id.toLowerCase());
    const normalizedUserTags = normalizeCustomerTags(userTags).map((tag) => tag.toLowerCase());
    const jobAdminIds = normalizeCustomerTags([
        job.adminId,
        job.admin?.id,
        job.admin?.userId,
        job.assignedAdminId,
        job.assignedAdminUserId,
    ]).map((id) => id.toLowerCase());
    const jobAdminNames = getRecordAdminNames(job).map((name) => name.toLowerCase());

    return (
        jobAdminIds.some((id) => normalizedUserIds.includes(id)) ||
        jobAdminNames.some((name) => normalizedUserTags.includes(name))
    );
};

const recordSubmittedByUser = (record = {}, userIds = []) => {
    const normalizedUserIds = normalizeCustomerTags(userIds).map((id) => id.toLowerCase());
    if (normalizedUserIds.length === 0) return false;

    const submitterIds = getRecordSubmitterIds(record).map((id) => id.toLowerCase());
    return submitterIds.some((id) => normalizedUserIds.includes(id));
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

const recordMatchesCustomerIds = (record = {}, customerIds = new Set()) => {
    if (!customerIds?.size) return false;
    return getRecordCustomerIds(record).some((customerId) => customerIds.has(customerId));
};

const recordMatchesPersonalAssignment = (record = {}, customersById = new Map(), userIds = [], customerIds = new Set(), userTags = []) => (
    recordBelongsToUser(record, userIds) ||
    jobAdminAssignedToUser(record, userIds, userTags) ||
    recordMatchesCustomerIds(record, customerIds) ||
    (normalizeCustomerTags(userTags).length > 0 && recordMatchesCustomerTags(record, customersById, userTags))
);

const getNameParts = (...values) => normalizeCustomerTags(values)
    .flatMap((value) => String(value || '').split(/\s+/))
    .filter((part) => part.length > 1);

const buildCurrentUserTagAliases = ({ user, dataBaseUser, companyUserAccess } = {}) => {
    const fullNames = normalizeCustomerTags([
        companyUserAccess?.displayName,
        companyUserAccess?.name,
        dataBaseUser?.displayName,
        `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`,
        user?.displayName,
    ]);
    const emailValues = normalizeCustomerTags([
        companyUserAccess?.email,
        dataBaseUser?.email,
        user?.email,
    ]);
    const emailPrefixes = emailValues
        .map((email) => email.split('@')[0])
        .filter(Boolean);

    return normalizeCustomerTags([
        user?.uid,
        dataBaseUser?.uid,
        dataBaseUser?.id,
        companyUserAccess?.id,
        companyUserAccess?.userId,
        companyUserAccess?.uid,
        companyUserAccess?.companyUserId,
        companyUserAccess?.companyUserDocId,
        ...fullNames,
        ...getNameParts(...fullNames),
        ...emailValues,
        ...emailPrefixes,
        ...emailPrefixes.map((prefix) => `@${prefix}`),
        ...getCustomerTagAccessList(companyUserAccess),
    ]);
};

const isRouteFinished = (route = {}) => finishedRouteStatuses.has(normalizeStatus(route.status || route.routeStatus || route.operationStatus));

const getServiceStopDate = (stop = {}) => {
    const millis = toMillis(stop.serviceDate || stop.scheduledDate || stop.date);
    return millis ? new Date(millis) : null;
};

const isServiceStopFinished = (stop = {}) => (
    finishedRouteStatuses.has(normalizeStatus(stop.operationStatus || stop.status || stop.routeStatus))
);

const isServiceAgreementSurveyStop = (stop = {}) => {
    const bucketValues = [
        stop.serviceStopTypeUseCaseRawValue,
        stop.serviceStopUseCaseSourceId,
        stop.serviceStopTypeUseCase,
        stop.typeUseCase,
        stop.category,
        stop.serviceStopCategory,
        stop.serviceStopTypeCategory,
        stop.typeId,
        stop.serviceStopTypeId,
        stop.type,
        stop.serviceStopTypeName,
        stop.sourceId,
        stop.stopPayCategory,
        stop.stopPayBucketId,
        stop.serviceStopBucketId,
        stop.serviceStopBucket,
    ].map(normalizeServiceStopTypeBucket).filter(Boolean);

    return bucketValues.some((value) => (
        serviceAgreementSurveyBuckets.has(value) ||
        value.includes('serviceagreementestimate') ||
        value.includes('serviceestimate') ||
        value.includes('newpool') ||
        value.includes('startup')
    ));
};

const serviceStopHasLinkedAgreement = (stop = {}, linkedSurveyIds = new Set()) => (
    Boolean(
        stop.serviceAgreementId ||
        stop.serviceAgreementTitle ||
        stop.salesAgreementId ||
        stop.agreementId ||
        (stop.id && linkedSurveyIds.has(stop.id))
    )
);

const getRecordDate = (record = {}, fields = []) => {
    const candidateFields = fields.length ? fields : [
        'date',
        'serviceDate',
        'scheduledDate',
        'completedDate',
        'completedAt',
        'receivedAt',
        'issuedAt',
        'createdAt',
        'updatedAt',
    ];

    for (const field of candidateFields) {
        const millis = toMillis(record[field]);
        if (millis) return new Date(millis);
    }

    return null;
};

const formatTime = (value) => {
    const millis = toMillis(value);
    if (millis) return timeFormatter.format(new Date(millis));
    const text = String(value || '').trim();
    return text || 'Not started';
};

const centsField = (...values) => {
    for (const value of values) {
        if (value === undefined || value === null || value === '') continue;
        const amount = Number(value);
        if (Number.isFinite(amount) && amount !== 0) return Math.round(amount);
    }

    return 0;
};

const lineItemsAmountCents = (lineItems = []) => (
    (Array.isArray(lineItems) ? lineItems : []).reduce((total, item) => {
        const quantity = Number(item.quantity || 1) || 1;
        const explicitTotal = centsField(item.totalAmountCents, item.amountCents, item.totalCents);
        if (explicitTotal) return total + explicitTotal;
        return total + Math.round(centsField(item.unitAmountCents, item.rateAmountCents, item.priceCents) * quantity);
    }, 0)
);

const agreementAmountCents = (agreement = {}) => (
    centsField(
        agreement.totalAmountCents,
        agreement.rateAmountCents,
        agreement.subtotalAmountCents,
        agreement.amountCents,
        agreement.monthlyAmountCents,
        agreement.monthlyRateCents
    ) || lineItemsAmountCents(agreement.lineItems)
);

const agreementMonthlyAmountCents = (agreement = {}) => {
    const amountCents = agreementAmountCents(agreement);
    if (!amountCents) return 0;

    const cadence = normalizeStatus(
        agreement.billingFrequency ||
        agreement.billingCadence ||
        agreement.invoiceFrequency ||
        agreement.interval ||
        agreement.rateInterval ||
        agreement.rateType ||
        'monthly'
    );
    const count = Math.max(
        Number(agreement.billingFrequencyCount || agreement.billingCadenceCount || agreement.invoiceFrequencyCount || 1),
        1
    );

    if (cadence.includes('one') && cadence.includes('time')) return 0;
    if (cadence.includes('annual') || cadence.includes('year')) return Math.round(amountCents / (12 * count));
    if (cadence.includes('quarter')) return Math.round(amountCents / (3 * count));
    if (cadence.includes('biweek')) return Math.round(amountCents * (2.172 / count));
    if (cadence.includes('week')) return Math.round(amountCents * (4.345 / count));
    if (cadence.includes('day')) return Math.round(amountCents * (30.4375 / count));
    return Math.round(amountCents / count);
};

const isCurrentMonthlyAgreement = (agreement = {}) => {
    const status = normalizeStatus(agreement.status);
    const sourceType = agreement.sourceType || '';
    const isOneTime =
        sourceType === SalesAgreementSourceType.oneOffJob ||
        agreement.rateType === 'oneTime' ||
        agreement.serviceCadence === 'oneTime' ||
        Boolean(agreement.jobId || agreement.workOrderId);

    return agreementMonthlyStatuses.has(status) && !isOneTime;
};

const purchaseCostCents = (purchase = {}) => (
    centsField(
        purchase.totalCostCents,
        purchase.costCents,
        purchase.purchaseTotalCents,
        purchase.extendedCostCents,
        purchase.totalAmountCents,
        purchase.amountCents,
        purchase.priceCents
    ) || lineItemsAmountCents(purchase.lineItems || purchase.items)
);

const workCostCents = (record = {}) => (
    centsField(
        record.actualCostCents,
        record.totalCostCents,
        record.laborCostCents,
        record.payrollCostCents,
        record.approvedPayCents,
        record.actualPayCents,
        record.estimatedPayCents,
        record.estimatedPayTotalCents,
        record.totalPayCents,
        record.payCents,
        record.costCents
    ) ||
    centsField(record.estimatedPay?.totalAmountCents, record.paySummary?.totalAmountCents) ||
    lineItemsAmountCents(record.costLineItems || record.payLines || record.estimatedPay?.lines)
);

const monthKey = (date) => (
    date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : ''
);

const monthSeriesSkeleton = (monthsBack = 5) => {
    const today = startOfLocalDay(new Date());
    return Array.from({ length: monthsBack + 1 }, (_, index) => {
        const date = new Date(today.getFullYear(), today.getMonth() - monthsBack + index, 1);
        return {
            key: monthKey(date),
            label: monthFormatter.format(date),
            revenueCents: 0,
            collectedCents: 0,
            costCents: 0,
            pnlCents: 0,
        };
    });
};

const buildFinancialMonthSeries = ({ invoices = [], payments = [], purchases = [], jobs = [], serviceStops = [] } = {}) => {
    const rows = monthSeriesSkeleton(5);
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));
    const addCents = (date, key, amountCents) => {
        const row = rowsByKey.get(monthKey(date));
        if (!row || !amountCents) return;
        row[key] += amountCents;
    };

    invoices
        .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)))
        .forEach((invoice) => {
            addCents(
                getRecordDate(invoice, ['issuedAt', 'invoiceDate', 'createdAt', 'updatedAt']),
                'revenueCents',
                Number(invoice.totalAmountCents || invoice.totalCents || 0)
            );
        });

    payments
        .filter((payment) => normalizeStatus(payment.status) === 'posted')
        .forEach((payment) => {
            addCents(
                getRecordDate(payment, ['receivedAt', 'postedAt', 'createdAt']),
                'collectedCents',
                Number(payment.amountCents || 0)
            );
        });

    purchases.forEach((purchase) => {
        addCents(
            getRecordDate(purchase, ['purchasedAt', 'purchaseDate', 'createdAt', 'updatedAt']),
            'costCents',
            purchaseCostCents(purchase)
        );
    });

    jobs.forEach((job) => {
        addCents(
            getRecordDate(job, ['completedDate', 'completedAt', 'serviceDate', 'createdAt', 'updatedAt']),
            'costCents',
            workCostCents(job)
        );
    });

    serviceStops.forEach((stop) => {
        addCents(
            getRecordDate(stop, ['completedDate', 'completedAt', 'serviceDate', 'scheduledDate', 'createdAt']),
            'costCents',
            workCostCents(stop)
        );
    });

    return rows.map((row) => ({
        ...row,
        pnlCents: row.revenueCents - row.costCents,
    }));
};

const routeTechKey = (record = {}) => (
    normalizeCustomerTags([
        record.techId,
        record.technicianId,
        record.assignedTechId,
        record.workerId,
        record.userId,
        record.assignedToId,
        record.assignedUserId,
        record.techName,
        record.technicianName,
        record.assignedToName,
        record.workerName,
    ])[0] || 'unassigned'
);

const routeTechName = (record = {}) => (
    record.techName ||
    record.technicianName ||
    record.assignedTechName ||
    record.workerName ||
    record.userName ||
    record.assignedToName ||
    record.assignedTo?.name ||
    record.adminName ||
    'Unassigned'
);

const routeStartValue = (record = {}) => (
    record.startTime ||
    record.routeStartTime ||
    record.scheduledStartTime ||
    record.startedAt ||
    record.startDate
);

const numericRouteField = (record = {}, fields = []) => {
    for (const field of fields) {
        const value = Number(record[field]);
        if (Number.isFinite(value) && value >= 0) return value;
    }

    return null;
};

const buildTodayRouteRows = ({ activeRoutes = [], serviceStops = [] } = {}) => {
    const today = new Date();
    const todayStops = serviceStops.filter((stop) => {
        const serviceDate = getServiceStopDate(stop);
        return serviceDate && sameLocalDay(serviceDate, today);
    });
    const stopsByTech = new Map();

    todayStops.forEach((stop) => {
        const key = routeTechKey(stop);
        const existing = stopsByTech.get(key) || {
            key,
            techName: routeTechName(stop),
            startValue: routeStartValue(stop),
            total: 0,
            completed: 0,
        };

        existing.total += 1;
        existing.completed += isServiceStopFinished(stop) ? 1 : 0;
        if (!existing.startValue) existing.startValue = routeStartValue(stop);
        stopsByTech.set(key, existing);
    });

    const activeTodayRoutes = activeRoutes.filter((route) => {
        const routeDate = getRecordDate(route, ['routeDate', 'serviceDate', 'scheduledDate', 'date', 'startedAt', 'createdAt']);
        return !routeDate || sameLocalDay(routeDate, today);
    });
    const usedTechKeys = new Set();
    const routeRows = activeTodayRoutes.map((route) => {
        const key = routeTechKey(route);
        const stopGroup = stopsByTech.get(key);
        usedTechKeys.add(key);

        const total = numericRouteField(route, ['totalStops', 'stopCount', 'routeStopCount', 'plannedStops']) ??
            (Array.isArray(route.stops) ? route.stops.length : null) ??
            stopGroup?.total ??
            0;
        const completed = numericRouteField(route, ['completedStops', 'finishedStops', 'stopsCompleted', 'completedStopCount']) ??
            stopGroup?.completed ??
            (isRouteFinished(route) ? total : 0);

        return {
            id: route.id || key,
            techName: routeTechName(route),
            startLabel: formatTime(routeStartValue(route) || stopGroup?.startValue),
            completed: Math.min(completed, total),
            total,
            status: route.status || route.routeStatus || route.operationStatus || 'Active',
        };
    });

    const stopRows = [...stopsByTech.values()]
        .filter((group) => !usedTechKeys.has(group.key))
        .map((group) => ({
            id: group.key,
            techName: group.techName,
            startLabel: formatTime(group.startValue),
            completed: group.completed,
            total: group.total,
            status: 'Service Stops',
        }));

    return [...routeRows, ...stopRows]
        .sort((left, right) => right.total - left.total || String(left.techName).localeCompare(String(right.techName)))
        .slice(0, 6);
};

const isUnfinishedJob = (job = {}) => {
    const status = normalizeStatus(job.operationStatus || job.status || job.billingStatus);
    return !['finished', 'complete', 'completed', 'done', 'cancelled', 'canceled', 'expired', 'rejected'].includes(status);
};

const equipmentDateIsDue = (value) => {
    const millis = toMillis(value);
    const dueThrough = endOfLocalDay(new Date());
    return Boolean(millis && dueThrough && millis <= dueThrough.getTime());
};

const equipmentNeedsMaintenance = (equipment = {}) => {
    const status = normalizeEquipmentStatus(equipment.status || equipment.operationStatus || equipment.equipmentStatus);
    if (status === 'nonoperational') return false;
    return ['needsmaintenance', 'maintenance', 'needsservice'].includes(status) ||
        (equipment.needsService === true && equipmentDateIsDue(equipment.nextServiceDate));
};

const equipmentNeedsRepair = (equipment = {}) => (
    normalizeEquipmentStatus(equipment.status || equipment.operationStatus || equipment.equipmentStatus) === 'needsrepair'
);

const equipmentIsNonOperational = (equipment = {}) => (
    normalizeEquipmentStatus(equipment.status || equipment.operationStatus || equipment.equipmentStatus) === 'nonoperational'
);

const isOpenShoppingItem = (item = {}) => {
    const status = normalizeStatus(item.status || item.purchaseStatus || item.state);
    return !['purchased', 'ordered', 'complete', 'completed', 'closed', 'cancelled', 'canceled'].includes(status);
};

const isUnassignedPurchasedItem = (item = {}) => {
    const status = normalizeStatus(item.status || item.assignmentStatus || item.state);
    return !item.jobId && !item.workOrderId && !item.customerId && !['assigned', 'installed', 'complete', 'completed', 'closed'].includes(status);
};

const recurringStopIsRouted = (stop = {}) => (
    Boolean(
        (stop.techId || stop.tech || stop.assignedTechId || stop.assignedToId) &&
        (stop.day || stop.daysOfWeek || stop.routeId || stop.recurringRouteId || stop.recurringRouteDocId)
    )
);

const buildRoutedCustomerCoverage = (recurringStops = [], customerCount = 0) => {
    const customerIds = new Set();
    const serviceLocationIds = new Set();
    const technicianIds = new Set();

    recurringStops.filter(recurringStopIsRouted).forEach((stop) => {
        const customerId = stop.customerId || stop.customer?.id;
        const serviceLocationId = stop.serviceLocationId || stop.locationId;
        const technicianId = stop.techId || stop.assignedTechId || stop.tech || stop.assignedToId;

        if (customerId) customerIds.add(customerId);
        if (serviceLocationId) serviceLocationIds.add(serviceLocationId);
        if (technicianId) technicianIds.add(technicianId);
    });

    return {
        routedCustomerCount: customerIds.size,
        routedServiceLocationCount: serviceLocationIds.size,
        routedTechnicianCount: technicianIds.size,
        unroutedCustomerCount: Math.max(Number(customerCount || 0) - customerIds.size, 0),
    };
};

const equipmentAttentionLabel = (equipment = {}) => {
    if (equipmentIsNonOperational(equipment)) return 'Non-operational';
    if (equipmentNeedsRepair(equipment)) return 'Needs repair';
    if (equipmentNeedsMaintenance(equipment)) return 'Needs maintenance';
    return equipment.status || equipment.operationStatus || equipment.equipmentStatus || 'Equipment';
};

const ScopeButton = ({ scope, isActive, onClick }) => {
    const Icon = scope.icon;

    return (
        <button
            type="button"
            onClick={onClick}
            title={scope.description}
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                isActive
                    ? 'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
        >
            <span className={`${isActive ? 'text-blue-700' : 'text-slate-500'}`}>
                <Icon className="h-3.5 w-3.5" />
            </span>
            <span>{scope.label}</span>
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

const EmptyRow = ({ children }) => (
    <div className="p-5 text-sm text-slate-500">{children}</div>
);

const MoneyMetric = ({ label, value, helper, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-950',
        blue: 'border-blue-100 bg-blue-50 text-blue-950',
        emerald: 'border-emerald-100 bg-emerald-50 text-emerald-950',
        amber: 'border-amber-100 bg-amber-50 text-amber-950',
        rose: 'border-rose-100 bg-rose-50 text-rose-950',
    };

    return (
        <div className={`rounded-lg border p-3 ${tones[tone] || tones.slate}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {helper && <p className="mt-1 truncate text-xs font-semibold text-slate-500">{helper}</p>}
        </div>
    );
};

const FinancialOverviewPanel = ({ summary, moneySeries }) => {
    const categories = moneySeries.map((row) => row.label);
    const chartSeries = [
        { name: 'Revenue', data: moneySeries.map((row) => Math.round(row.revenueCents / 100)) },
        { name: 'Collected', data: moneySeries.map((row) => Math.round(row.collectedCents / 100)) },
        { name: 'Known Costs', data: moneySeries.map((row) => Math.round(row.costCents / 100)) },
    ];
    const hasData = chartSeries.some((series) => series.data.some((value) => value !== 0));
    const options = {
        chart: {
            toolbar: { show: false },
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        },
        colors: ['#2563eb', '#059669', '#f59e0b'],
        dataLabels: { enabled: false },
        grid: {
            borderColor: '#e2e8f0',
            strokeDashArray: 3,
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                columnWidth: '48%',
            },
        },
        xaxis: {
            categories,
            labels: { style: { colors: '#64748b', fontSize: '11px' } },
            axisBorder: { show: false },
            axisTicks: { show: false },
        },
        yaxis: {
            labels: {
                style: { colors: '#64748b', fontSize: '11px' },
                formatter: (value) => `$${Math.round(value).toLocaleString()}`,
            },
        },
        legend: {
            position: 'top',
            horizontalAlign: 'right',
            fontSize: '12px',
            labels: { colors: '#475569' },
        },
        tooltip: {
            y: { formatter: (value) => currencyFormatter.format(Number(value || 0)) },
        },
    };

    return (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h2 className="text-sm font-bold text-slate-950">Money Overview</h2>
                    <p className="mt-1 text-xs text-slate-500">Service agreement run rate, business done, and known PNL.</p>
                </div>
                <Link to="/company/accounting" className="text-xs font-bold text-blue-700 hover:text-blue-900">Accounting</Link>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
                <MoneyMetric
                    label="Monthly Agreements"
                    value={formatCurrency(summary.currentMonthlyAgreementCents)}
                    helper={`${summary.currentMonthlyAgreementCount} active agreements`}
                    tone="blue"
                />
                <MoneyMetric
                    label="Business Done"
                    value={formatCurrency(summary.issuedInvoiceCents)}
                    helper={`${formatCurrency(summary.currentMonthInvoiceCents)} this month`}
                    tone="emerald"
                />
                <MoneyMetric
                    label="Company PNL"
                    value={formatCurrency(summary.currentMonthPnlCents)}
                    helper={`${formatCurrency(summary.currentMonthKnownCostCents)} known costs this month`}
                    tone={summary.currentMonthPnlCents >= 0 ? 'slate' : 'rose'}
                />
            </div>
            <div className="mt-4">
                {hasData ? (
                    <Chart options={options} series={chartSeries} type="bar" height={250} />
                ) : (
                    <div className="flex h-[250px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                        No money data in this scope.
                    </div>
                )}
            </div>
        </section>
    );
};

const RouteOverviewPanel = ({ routeRows = [] }) => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
                <h2 className="text-sm font-bold text-slate-950">Today's Routes</h2>
                <p className="mt-1 text-xs text-slate-500">Active route and service stop progress.</p>
            </div>
            <Link to="/company/route-day-management" className="text-xs font-bold text-blue-700 hover:text-blue-900">Routes</Link>
        </div>
        <div className="divide-y divide-slate-100">
            {routeRows.length === 0 ? (
                <EmptyRow>No routes or service stops scheduled today.</EmptyRow>
            ) : routeRows.map((row) => {
                const percent = row.total ? Math.round((row.completed / row.total) * 100) : 0;

                return (
                    <div key={row.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{row.techName}</p>
                                <p className="mt-0.5 text-xs text-slate-500">{row.startLabel} · {row.status}</p>
                            </div>
                            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700">
                                {row.completed}/{row.total}
                            </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(percent, 100)}%` }} />
                        </div>
                    </div>
                );
            })}
        </div>
    </section>
);

const OperationsMetric = ({ label, value, tone = 'slate' }) => {
    const tones = {
        slate: 'text-slate-950',
        amber: 'text-amber-700',
        rose: 'text-rose-700',
        emerald: 'text-emerald-700',
        blue: 'text-blue-700',
    };

    return (
        <div className="px-4 py-3">
            <p className={`text-xl font-bold ${tones[tone] || tones.slate}`}>{value}</p>
            <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
        </div>
    );
};

const OperationsPreviewPanel = ({ title, helper, count, to, children }) => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 truncate text-xs text-slate-500">{helper}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                    {count}
                </span>
                {to && <Link to={to} className="text-xs font-bold text-blue-700 hover:text-blue-900">View</Link>}
            </div>
        </div>
        {children}
    </section>
);

const OperationsOverviewSection = ({ overview }) => (
    <section className="grid gap-3 xl:grid-cols-3">
        <OperationsPreviewPanel
            title="Equipment"
            helper="Maintenance, repair, and non-operational equipment."
            count={overview.equipmentAttentionCount}
            to="/company/equipment"
        >
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                <OperationsMetric label="Maintain" value={overview.equipmentNeedingMaintenance.length} tone="amber" />
                <OperationsMetric label="Repair" value={overview.equipmentNeedingRepair.length} tone="rose" />
                <OperationsMetric label="Down" value={overview.nonOperationalEquipment.length} tone="slate" />
            </div>
            <div className="divide-y divide-slate-100">
                {overview.equipmentAttentionRows.length === 0 ? (
                    <EmptyRow>No equipment needs attention.</EmptyRow>
                ) : overview.equipmentAttentionRows.map((equipment) => (
                    <Link key={equipment.id} to={`/company/equipment/detail/${equipment.id}`} className="block px-4 py-3 transition hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{equipment.name || equipment.type || 'Equipment'}</p>
                                <p className="mt-0.5 truncate text-xs text-slate-500">{equipment.customerName || equipment.serviceLocationName || 'Location not set'}</p>
                            </div>
                            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                {equipmentAttentionLabel(equipment)}
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </OperationsPreviewPanel>

        <OperationsPreviewPanel
            title="Repair Requests"
            helper="Open requests submitted internally or by homeowners."
            count={overview.openRepairRequests.length}
            to="/company/repair-requests"
        >
            <div className="divide-y divide-slate-100">
                {overview.repairRequestRows.length === 0 ? (
                    <EmptyRow>No open repair requests.</EmptyRow>
                ) : overview.repairRequestRows.map((request) => (
                    <Link key={`${request.source || 'repair'}-${request.id}`} to={`/company/repair-requests/detail/${request.id}`} className="block px-4 py-3 transition hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{request.title || request.issue || request.problem || request.equipmentName || 'Repair request'}</p>
                                <p className="mt-0.5 truncate text-xs text-slate-500">{request.customerName || request.homeownerName || 'Customer not set'}</p>
                            </div>
                            <span className="shrink-0 text-xs font-bold text-slate-500">{formatShortDate(request.createdAt || request.dateCreated || request.updatedAt)}</span>
                        </div>
                    </Link>
                ))}
            </div>
        </OperationsPreviewPanel>

        <OperationsPreviewPanel
            title="Jobs"
            helper="Active work orders by operational status."
            count={overview.openJobs.length}
            to="/company/jobs/operations"
        >
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                <OperationsMetric label="Scheduled" value={overview.scheduledJobs.length} tone="blue" />
                <OperationsMetric label="Progress" value={overview.inProgressJobs.length} tone="emerald" />
                <OperationsMetric label="Pending" value={overview.pendingJobs.length} tone="amber" />
            </div>
            <div className="divide-y divide-slate-100">
                {overview.jobRows.length === 0 ? (
                    <EmptyRow>No active jobs.</EmptyRow>
                ) : overview.jobRows.map((job) => (
                    <Link key={job.id} to={`/company/jobs/detail/${job.id}`} className="block px-4 py-3 transition hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{job.internalId || job.jobName || job.customerName || 'Job'}</p>
                                <p className="mt-0.5 truncate text-xs text-slate-500">{job.customerName || job.description || 'Customer not set'}</p>
                            </div>
                            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                {job.operationStatus || job.status || 'Open'}
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </OperationsPreviewPanel>
    </section>
);

const RegionalCompanyDashboardView = ({ renderStatTile, summary, moneySeries, routeRows, operationsOverview }) => (
    <div className="space-y-3">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {REGIONAL_COMPANY_TOP_STAT_IDS.map(renderStatTile)}
        </section>
        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_390px]">
            <FinancialOverviewPanel summary={summary} moneySeries={moneySeries} />
            <RouteOverviewPanel routeRows={routeRows} />
        </section>
        <OperationsOverviewSection overview={operationsOverview} />
    </div>
);

const PersonalStatCard = ({ icon: Icon, title, value, helper, to, tone = 'blue' }) => {
    const tones = {
        blue: 'bg-blue-50 text-blue-700',
        amber: 'bg-amber-50 text-amber-700',
        emerald: 'bg-emerald-50 text-emerald-700',
        rose: 'bg-rose-50 text-rose-700',
        slate: 'bg-slate-100 text-slate-600',
    };
    const content = (
        <div className="h-full rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-200">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
                </div>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tones[tone] || tones.blue}`}>
                    <Icon className="h-4 w-4" />
                </span>
            </div>
            {helper && <p className="mt-2 truncate text-xs font-medium text-slate-500">{helper}</p>}
        </div>
    );

    return to ? <Link to={to}>{content}</Link> : content;
};

const PersonalPanel = ({ title, helper, count, to, actionLabel = 'View', className = '', children }) => (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-0.5 truncate text-xs text-slate-500">{helper}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {count !== undefined && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {count}
                    </span>
                )}
                {to && <Link to={to} className="text-xs font-bold text-blue-700 hover:text-blue-900">{actionLabel}</Link>}
            </div>
        </div>
        {children}
    </section>
);

const PersonalWeekTimeline = ({ days = [] }) => {
    const maxTotal = Math.max(1, ...days.map((day) => Number(day.total || 0)));

    return (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-bold text-slate-950">Service Stops This Week</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Scheduled stops and completed work, starting today.</p>
                </div>
                <Link to="/company/serviceStops" className="text-xs font-bold text-blue-700 hover:text-blue-900">Stops</Link>
            </div>
            <div className="grid grid-cols-7 gap-2">
                {days.map((day) => {
                    const totalPercent = `${Math.max(8, Math.round((day.total / maxTotal) * 100))}%`;
                    const finishedPercent = day.total ? `${Math.round((day.finished / day.total) * 100)}%` : '0%';

                    return (
                        <div key={day.key} className="min-w-0">
                            <div className="flex items-baseline justify-between gap-1">
                                <p className="truncate text-xs font-bold text-slate-700">{day.label}</p>
                                <p className="text-[11px] font-semibold text-slate-400">{day.dateLabel}</p>
                            </div>
                            <div className="mt-2 flex h-20 items-end rounded-md bg-slate-100 p-1">
                                <div className="relative w-full overflow-hidden rounded-sm bg-blue-100" style={{ height: totalPercent }}>
                                    <div className="absolute bottom-0 left-0 w-full bg-emerald-500" style={{ height: finishedPercent }} />
                                </div>
                            </div>
                            <p className="mt-1 text-center text-[11px] font-bold text-slate-700">
                                {day.finished}/{day.total}
                            </p>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

const PersonalDashboardView = ({
    personalDashboard,
    openTodos,
    attentionTodos,
    dashboardAlerts,
    unreadAlerts,
    alertHref,
    personalCustomerIds,
    personalEquipment,
}) => {
    const equipmentRows = [
        {
            label: 'Needs Maintenance',
            count: personalDashboard.equipmentNeedingMaintenance.length,
            valueClass: 'text-amber-700',
        },
        {
            label: 'Needs Repair',
            count: personalDashboard.equipmentNeedingRepair.length,
            valueClass: 'text-rose-700',
        },
        {
            label: 'Non-Operational',
            count: personalDashboard.nonOperationalEquipment.length,
            valueClass: 'text-slate-700',
        },
    ];

    const equipmentCountForCustomer = (customer) => (
        personalEquipment.filter((equipment) => getRecordCustomerIds(equipment).includes(customer.id)).length
    );

    return (
        <div className="space-y-3">
            <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <PersonalWeekTimeline days={personalDashboard.weekTimeline} />
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                    <PersonalStatCard
                        icon={FaCalendarAlt}
                        title="Today's Stops"
                        value={`${personalDashboard.todayFinishedStops.length}/${personalDashboard.todayStops.length}`}
                        helper="finished / scheduled"
                        to="/company/serviceStops"
                        tone={personalDashboard.todayStops.length === personalDashboard.todayFinishedStops.length ? 'emerald' : 'blue'}
                    />
                    <PersonalStatCard
                        icon={FaTools}
                        title="My Repair Requests"
                        value={personalDashboard.submittedRepairRequests.length}
                        helper="open requests I submitted"
                        to="/company/repair-requests"
                        tone={personalDashboard.submittedRepairRequests.length ? 'amber' : 'emerald'}
                    />
                    <PersonalStatCard
                        icon={FaTasks}
                        title="Open Todos"
                        value={openTodos.length}
                        helper={`${attentionTodos.length} need attention`}
                        to="/company/todo-list"
                        tone={attentionTodos.length ? 'amber' : 'blue'}
                    />
                </div>
            </section>

            <section className="grid gap-3 xl:grid-cols-12">
                <PersonalPanel
                    title="Assigned Jobs"
                    helper="Unfinished jobs where I am the admin"
                    count={personalDashboard.assignedJobCount}
                    to="/company/jobs"
                    className="xl:col-span-4"
                >
                    <div className="divide-y divide-slate-100">
                        {personalDashboard.assignedJobs.length === 0 ? (
                            <EmptyRow>No unfinished assigned jobs.</EmptyRow>
                        ) : personalDashboard.assignedJobs.map((job) => (
                            <Link key={job.id} to={`/company/jobs/detail/${job.id}`} className="block px-4 py-3 transition hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-bold text-slate-900">{job.internalId || job.jobName || job.customerName || 'Job'}</p>
                                        <p className="mt-0.5 truncate text-xs text-slate-500">{job.customerName || job.description || 'No customer saved'}</p>
                                    </div>
                                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                        {job.operationStatus || 'Open'}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </PersonalPanel>

                <PersonalPanel
                    title="Recent Messages"
                    helper="Unread badge and latest conversations"
                    to="/company/messages"
                    className="xl:col-span-4"
                >
                    <div className="p-3">
                        <RecentChatsWidget
                            variant="compact"
                            limit={2}
                            personalOnly
                            unreadOnly
                            customerIds={personalCustomerIds}
                        />
                    </div>
                </PersonalPanel>

                <PersonalPanel
                    title="Alerts"
                    helper={`${unreadAlerts.length} unread notifications`}
                    count={dashboardAlerts.length}
                    to="/company/alerts"
                    className="xl:col-span-4"
                    actionLabel="All"
                >
                    <div className="divide-y divide-slate-100">
                        {dashboardAlerts.length === 0 ? (
                            <EmptyRow>No alerts need attention.</EmptyRow>
                        ) : dashboardAlerts.slice(0, 3).map((alert) => (
                            <Link key={alert.id} to={alertHref(alert)} className="block px-4 py-3 transition hover:bg-slate-50">
                                <div className="flex items-start gap-2">
                                    <FaExclamationTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${alertNeedsAttention(alert) ? 'text-amber-500' : 'text-slate-400'}`} />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-bold text-slate-900">{alert.title}</p>
                                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{alert.message || 'Notification'}</p>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </PersonalPanel>

                <PersonalPanel
                    title="Equipment"
                    helper="Assigned customer equipment status"
                    to="/company/equipment"
                    className="xl:col-span-5"
                >
                    <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                        {equipmentRows.map((row) => (
                            <Link key={row.label} to="/company/equipment" className="px-4 py-3 transition hover:bg-slate-50">
                                <p className={`text-xl font-bold ${row.valueClass}`}>{row.count}</p>
                                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{row.label}</p>
                            </Link>
                        ))}
                    </div>
                </PersonalPanel>

                <PersonalPanel
                    title="Assigned Customers"
                    helper="Customers tagged to this user"
                    count={personalDashboard.assignedCustomerCount}
                    to="/company/customers"
                    className="xl:col-span-7"
                >
                    <div className="divide-y divide-slate-100">
                        {personalDashboard.assignedCustomers.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-slate-500">
                                No customers are tagged to this user yet.
                            </div>
                        ) : personalDashboard.assignedCustomers.map((customer) => (
                            <Link key={customer.id} to={`/company/customers/details/${customer.id}`} className="block min-w-0 px-4 py-3 transition hover:bg-blue-50">
                                <p className="truncate text-sm font-bold text-slate-900">
                                    {customer.company || customer.companyName || customer.customerName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer'}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-slate-500">
                                    {equipmentCountForCustomer(customer)} equipment records
                                </p>
                            </Link>
                        ))}
                    </div>
                </PersonalPanel>
            </section>
        </div>
    );
};

const Dashboard = () => {
    const {
        dataBaseUser,
        recentlySelectedCompany,
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
    const [serviceStops, setServiceStops] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [todoItems, setTodoItems] = useState([]);
    const [alertNotifications, setAlertNotifications] = useState([]);

    const todoListEnabled = featureFlagsLoaded && isFeatureEnabled(TODO_LIST_FEATURE_FLAG_ID);
    const alertsEnabled = featureFlagsLoaded && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);
    const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);
    const dashboardScopeAccess = useMemo(
        () => getEffectiveDashboardScopeAccess({ userAccess: companyUserAccess, role: companyRole }),
        [companyRole, companyUserAccess]
    );
    const allowedDashboardScopes = useMemo(
        () => new Set(dashboardScopeAccess.scopes),
        [dashboardScopeAccess.scopes]
    );
    const availableDashboardScopeOptions = useMemo(
        () => DASHBOARD_SCOPE_VIEW_OPTIONS.filter((scope) => allowedDashboardScopes.has(scope.id)),
        [allowedDashboardScopes]
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
    const canViewAllTodoBoards = useMemo(() => (
        roleHasCompanyPermission(companyRole, TODO_ALL_BOARDS_PERMISSION_ID)
    ), [companyRole]);
    const visibleTodoItems = useMemo(() => (
        canViewAllTodoBoards
            ? todoItems
            : todoItems.filter((todo) => todoVisibleToUser(todo, currentUserIds))
    ), [canViewAllTodoBoards, currentUserIds, todoItems]);
    const currentUserTagAliases = useMemo(() => (
        buildCurrentUserTagAliases({ user, dataBaseUser, companyUserAccess })
    ), [companyUserAccess, dataBaseUser, user]);

    useEffect(() => {
        if (allowedDashboardScopes.has(dashboardScope)) return;

        setDashboardScope(availableDashboardScopeOptions[0]?.id || 'personal');
    }, [allowedDashboardScopes, availableDashboardScopeOptions, dashboardScope]);

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
            setServiceStops([]);
            setEquipmentList([]);
            setLoading(false);
            return;
        }

        const loadDashboard = async () => {
            setLoading(true);
            try {
                const todayStart = startOfLocalDay(new Date());
                const weekEnd = endOfLocalDay(addDays(todayStart, 6));
                const dashboardLookbackStart = addDays(todayStart, -185);
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
                    serviceStopsSnap,
                    equipmentSnap,
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
                    getDocs(query(
                        collection(db, "companies", recentlySelectedCompany, "serviceStops"),
                        where("serviceDate", ">=", dashboardLookbackStart),
                        where("serviceDate", "<=", weekEnd),
                        orderBy("serviceDate", "asc")
                    )),
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "equipment"), where("isActive", "==", true))),
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
                setServiceStops(serviceStopsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setEquipmentList(equipmentSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
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
    const personalAssignedCustomers = useMemo(() => (
        customers.filter((customer) => (
            recordBelongsToUser(customer, currentUserIds) ||
            customerHasAnyTag(customer, currentUserTagAliases)
        ))
    ), [currentUserIds, currentUserTagAliases, customers]);
    const personalCustomerIds = useMemo(
        () => personalAssignedCustomers.map((customer) => customer.id).filter(Boolean),
        [personalAssignedCustomers]
    );
    const personalCustomerIdSet = useMemo(() => new Set(personalCustomerIds), [personalCustomerIds]);
    const customerRegionAccess = useMemo(
        () => getEffectiveCustomerRegionAccess({ userAccess: companyUserAccess, role: companyRole }),
        [companyRole, companyUserAccess]
    );
    const availableCustomerTags = useMemo(() => getCustomerTagOptions(customers), [customers]);
    const accessibleRegionalTags = useMemo(() => (
        customerRegionAccess.fullAccess ? availableCustomerTags : customerRegionAccess.tags
    ), [availableCustomerTags, customerRegionAccess.fullAccess, customerRegionAccess.tags]);
    const regionalScopeTag = useMemo(() => {
        const selectedTag = normalizeCustomerTag(selectedCustomerRegionTag);
        if (selectedTag) return selectedTag;
        return normalizeCustomerTags(accessibleRegionalTags)[0] || '';
    }, [accessibleRegionalTags, selectedCustomerRegionTag]);
    const scopeLabel = dashboardScope === 'personal'
        ? 'Personal'
        : dashboardScope === 'regional'
            ? (regionalScopeTag ? `Regional: ${regionalScopeTag}` : 'Regional')
            : 'Whole Company';

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
                serviceStops,
                equipment: equipmentList,
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
                serviceStops: filterByRegion(serviceStops),
                equipment: filterByRegion(equipmentList),
            };
        }

        const personalRecordFilter = (records) => records.filter((record) => (
            recordMatchesPersonalAssignment(
                record,
                customersById,
                currentUserIds,
                personalCustomerIdSet,
                currentUserTagAliases
            )
        ));

        return {
            customers: personalAssignedCustomers,
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
            serviceStops: personalRecordFilter(serviceStops),
            equipment: personalRecordFilter(equipmentList),
        };
    }, [
        activeRoutes,
        currentUserIds,
        currentUserTagAliases,
        customers,
        customersById,
        dashboardScope,
        equipmentList,
        invoices,
        jobs,
        leads,
        payments,
        personalAssignedCustomers,
        personalCustomerIdSet,
        purchasedItems,
        recurringServiceStops,
        regionalScopeTag,
        repairRequests,
        routes,
        serviceAgreements,
        serviceStops,
        shoppingItems,
        subscriptions,
    ]);

    const scopedTodoItems = useMemo(() => (
        dashboardScope === 'company'
            ? visibleTodoItems
            : dashboardScope === 'regional'
                ? visibleTodoItems.filter((todo) => recordMatchesCustomerTags(todo, customersById, regionalScopeTag ? [regionalScopeTag] : []))
                : visibleTodoItems.filter((todo) => recordMatchesPersonalAssignment(
                    todo,
                    customersById,
                    currentUserIds,
                    personalCustomerIdSet,
                    currentUserTagAliases
                ))
    ), [currentUserIds, currentUserTagAliases, customersById, dashboardScope, personalCustomerIdSet, regionalScopeTag, visibleTodoItems]);

    const scopedAlertNotifications = useMemo(() => (
        dashboardScope === 'company'
            ? alertNotifications
            : dashboardScope === 'regional'
                ? alertNotifications.filter((alert) => recordMatchesCustomerTags(alert, customersById, regionalScopeTag ? [regionalScopeTag] : []))
                : alertNotifications.filter((alert) => (
                    recordMatchesPersonalAssignment(
                        alert,
                        customersById,
                        currentUserIds,
                        personalCustomerIdSet,
                        currentUserTagAliases
                    ) || (!getRecordUserIds(alert).length && !getRecordCustomerIds(alert).length)
                ))
    ), [alertNotifications, currentUserIds, currentUserTagAliases, customersById, dashboardScope, personalCustomerIdSet, regionalScopeTag]);

    const summary = useMemo(() => {
        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const isCurrentMonth = (record, fields) => {
            const date = getRecordDate(record, fields);
            return Boolean(date && date >= currentMonthStart && date < nextMonthStart);
        };
        const activeRepairs = scopedData.repairRequests.filter((request) => (
            isOpenRepairRequestStatus(request.status)
        ));
        const issuedInvoices = scopedData.invoices
            .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)));
        const issuedInvoiceCents = issuedInvoices
            .reduce((total, invoice) => total + Number(invoice.totalAmountCents || 0), 0);
        const currentMonthInvoiceCents = issuedInvoices
            .filter((invoice) => isCurrentMonth(invoice, ['issuedAt', 'invoiceDate', 'createdAt', 'updatedAt']))
            .reduce((total, invoice) => total + Number(invoice.totalAmountCents || invoice.totalCents || 0), 0);
        const openArCents = scopedData.invoices
            .filter((invoice) => ['open', 'partiallypaid', 'overdue'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);
        const postedPayments = scopedData.payments.filter((payment) => normalizeStatus(payment.status) === 'posted');
        const receivedCents = postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const currentMonthReceivedCents = postedPayments
            .filter((payment) => isCurrentMonth(payment, ['receivedAt', 'postedAt', 'createdAt']))
            .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const paidThroughAppCents = postedPayments
            .filter((payment) => appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId)
            .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const recurringCents = scopedData.subscriptions
            .filter((subscription) => ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status)))
            .reduce((total, subscription) => total + Number(subscription.amountCents || 0), 0);
        const currentMonthlyAgreements = scopedData.serviceAgreements.filter(isCurrentMonthlyAgreement);
        const currentMonthlyAgreementCents = currentMonthlyAgreements
            .reduce((total, agreement) => total + agreementMonthlyAmountCents(agreement), 0);
        const knownPurchaseCostCents = scopedData.purchasedItems.reduce((total, item) => total + purchaseCostCents(item), 0);
        const knownJobCostCents = scopedData.jobs.reduce((total, job) => total + workCostCents(job), 0);
        const knownServiceStopCostCents = scopedData.serviceStops.reduce((total, stop) => total + workCostCents(stop), 0);
        const currentMonthPurchaseCostCents = scopedData.purchasedItems
            .filter((item) => isCurrentMonth(item, ['purchasedAt', 'purchaseDate', 'createdAt', 'updatedAt']))
            .reduce((total, item) => total + purchaseCostCents(item), 0);
        const currentMonthJobCostCents = scopedData.jobs
            .filter((job) => isCurrentMonth(job, ['completedDate', 'completedAt', 'serviceDate', 'createdAt', 'updatedAt']))
            .reduce((total, job) => total + workCostCents(job), 0);
        const currentMonthServiceStopCostCents = scopedData.serviceStops
            .filter((stop) => isCurrentMonth(stop, ['completedDate', 'completedAt', 'serviceDate', 'scheduledDate', 'createdAt']))
            .reduce((total, stop) => total + workCostCents(stop), 0);
        const knownCostCents = knownPurchaseCostCents + knownJobCostCents + knownServiceStopCostCents;
        const currentMonthKnownCostCents = currentMonthPurchaseCostCents + currentMonthJobCostCents + currentMonthServiceStopCostCents;
        const openShoppingItems = scopedData.shoppingItems.filter(isOpenShoppingItem);
        const unassignedPurchasedItems = scopedData.purchasedItems.filter(isUnassignedPurchasedItem);
        const finishedRoutes = scopedData.activeRoutes.filter(isRouteFinished);
        const activeRouteCount = scopedData.activeRoutes.length;

        return {
            activeRepairs,
            issuedInvoiceCents,
            currentMonthInvoiceCents,
            openArCents,
            receivedCents,
            currentMonthReceivedCents,
            paidThroughAppCents,
            recurringCents,
            currentMonthlyAgreementCents,
            currentMonthlyAgreementCount: currentMonthlyAgreements.length,
            knownCostCents,
            knownPurchaseCostCents,
            knownJobCostCents,
            knownServiceStopCostCents,
            currentMonthKnownCostCents,
            currentMonthPnlCents: currentMonthInvoiceCents - currentMonthKnownCostCents,
            pnlCents: issuedInvoiceCents - knownCostCents,
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

    const linkedSurveyServiceStopIds = useMemo(() => {
        const linkedIds = new Set();
        scopedData.serviceAgreements.forEach((agreement) => {
            [
                agreement.serviceAgreementEstimateServiceStopId,
                agreement.inspectionServiceStopId,
                agreement.sourceServiceStopId,
                agreement.serviceStopId,
                ...(Array.isArray(agreement.serviceStopIds) ? agreement.serviceStopIds : []),
            ].filter(Boolean).forEach((id) => linkedIds.add(id));
        });
        return linkedIds;
    }, [scopedData.serviceAgreements]);

    const pendingSurveys = useMemo(() => (
        scopedData.serviceStops.filter((stop) => (
            isServiceAgreementSurveyStop(stop) &&
            !serviceStopHasLinkedAgreement(stop, linkedSurveyServiceStopIds)
        ))
    ), [linkedSurveyServiceStopIds, scopedData.serviceStops]);

    const completedPendingSurveys = useMemo(() => (
        pendingSurveys.filter(isServiceStopFinished)
    ), [pendingSurveys]);

    const moneySeries = useMemo(() => buildFinancialMonthSeries({
        invoices: scopedData.invoices,
        payments: scopedData.payments,
        purchases: scopedData.purchasedItems,
        jobs: scopedData.jobs,
        serviceStops: scopedData.serviceStops,
    }), [
        scopedData.invoices,
        scopedData.jobs,
        scopedData.payments,
        scopedData.purchasedItems,
        scopedData.serviceStops,
    ]);

    const routeRows = useMemo(() => buildTodayRouteRows({
        activeRoutes: scopedData.activeRoutes,
        serviceStops: scopedData.serviceStops,
    }), [scopedData.activeRoutes, scopedData.serviceStops]);

    const routedCoverage = useMemo(() => (
        buildRoutedCustomerCoverage(scopedData.recurringServiceStops, scopedData.customers.length)
    ), [scopedData.customers.length, scopedData.recurringServiceStops]);

    const todayRouteTotals = useMemo(() => (
        routeRows.reduce((totals, row) => ({
            completed: totals.completed + Number(row.completed || 0),
            total: totals.total + Number(row.total || 0),
        }), { completed: 0, total: 0 })
    ), [routeRows]);

    const operationsOverview = useMemo(() => {
        const equipmentNeedingMaintenance = scopedData.equipment.filter(equipmentNeedsMaintenance);
        const equipmentNeedingRepair = scopedData.equipment.filter(equipmentNeedsRepair);
        const nonOperationalEquipment = scopedData.equipment.filter(equipmentIsNonOperational);
        const equipmentAttentionById = new Map();

        [
            ...nonOperationalEquipment,
            ...equipmentNeedingRepair,
            ...equipmentNeedingMaintenance,
        ].forEach((equipment) => {
            if (equipment.id) equipmentAttentionById.set(equipment.id, equipment);
        });

        const jobStatus = (job) => normalizeStatus(job.operationStatus || job.status || job.billingStatus);
        const scheduledJobs = scopedData.jobs.filter((job) => jobStatus(job) === 'scheduled');
        const inProgressJobs = scopedData.jobs.filter((job) => jobStatus(job) === 'inprogress');
        const pendingJobs = scopedData.jobs.filter((job) => ['estimatepending', 'unscheduled'].includes(jobStatus(job)));

        return {
            equipmentNeedingMaintenance,
            equipmentNeedingRepair,
            nonOperationalEquipment,
            equipmentAttentionCount: equipmentAttentionById.size,
            equipmentAttentionRows: [...equipmentAttentionById.values()]
                .sort((left, right) => (
                    toMillis(left.nextServiceDate || left.updatedAt || left.createdAt) -
                    toMillis(right.nextServiceDate || right.updatedAt || right.createdAt)
                ))
                .slice(0, 4),
            openRepairRequests: summary.activeRepairs,
            repairRequestRows: sortFresh(summary.activeRepairs).slice(0, 4),
            openJobs: scopedData.jobs,
            scheduledJobs,
            inProgressJobs,
            pendingJobs,
            jobRows: sortFresh(scopedData.jobs).slice(0, 4),
        };
    }, [scopedData.equipment, scopedData.jobs, summary.activeRepairs]);

    const openTodos = useMemo(() => scopedTodoItems.filter(todoIsOpen).sort(compareTodosByUrgency), [scopedTodoItems]);
    const attentionTodos = useMemo(() => openTodos.filter((todo) => todoNeedsAttention(todo)), [openTodos]);
    const unreadAlerts = useMemo(() => scopedAlertNotifications.filter(alertIsUnread), [scopedAlertNotifications]);
    const dashboardAlerts = useMemo(() => scopedAlertNotifications
        .filter((alert) => alert.status !== ALERT_STATUS.archived)
        .sort((left, right) => {
            const attentionDifference = Number(alertNeedsAttention(right)) - Number(alertNeedsAttention(left));
            if (attentionDifference !== 0) return attentionDifference;
            return compareAlertsFresh(left, right);
        })
        .slice(0, 3), [scopedAlertNotifications]);
    const personalDashboard = useMemo(() => {
        const today = new Date();
        const todayStops = scopedData.serviceStops.filter((stop) => {
            const serviceDate = getServiceStopDate(stop);
            return serviceDate && sameLocalDay(serviceDate, today);
        });
        const weekTimeline = Array.from({ length: 7 }, (_, index) => {
            const day = addDays(today, index);
            const dayStops = scopedData.serviceStops.filter((stop) => {
                const serviceDate = getServiceStopDate(stop);
                return serviceDate && sameLocalDay(serviceDate, day);
            });

            return {
                key: day?.toISOString() || String(index),
                label: day ? weekdayFormatter.format(day) : '',
                dateLabel: day ? dayNumberFormatter.format(day) : '',
                total: dayStops.length,
                finished: dayStops.filter(isServiceStopFinished).length,
            };
        });
        const submittedRepairRequests = repairRequests.filter((request) => (
            isOpenRepairRequestStatus(request.status) && recordSubmittedByUser(request, currentUserIds)
        ));
        const equipmentNeedingMaintenance = scopedData.equipment.filter(equipmentNeedsMaintenance);
        const equipmentNeedingRepair = scopedData.equipment.filter(equipmentNeedsRepair);
        const nonOperationalEquipment = scopedData.equipment.filter(equipmentIsNonOperational);
        const unfinishedAssignedJobs = sortFresh(scopedData.jobs.filter((job) => (
            isUnfinishedJob(job) && jobAdminAssignedToUser(job, currentUserIds, currentUserTagAliases)
        )));

        return {
            todayStops,
            todayFinishedStops: todayStops.filter(isServiceStopFinished),
            weekTimeline,
            submittedRepairRequests,
            assignedJobs: unfinishedAssignedJobs.slice(0, 4),
            assignedJobCount: unfinishedAssignedJobs.length,
            equipmentNeedingMaintenance,
            equipmentNeedingRepair,
            nonOperationalEquipment,
            assignedCustomers: personalAssignedCustomers.slice(0, 5),
            assignedCustomerCount: personalAssignedCustomers.length,
        };
    }, [
        currentUserIds,
        currentUserTagAliases,
        personalAssignedCustomers,
        repairRequests,
        scopedData.equipment,
        scopedData.jobs,
        scopedData.serviceStops,
    ]);
    const alertHref = (alert) => {
        if (alert.route && alert.route.startsWith('/')) return alert.route;
        if (alert.source === 'todoList' || alert.todoId) return '/company/todo-list';
        return '/company/alerts';
    };

    const renderStatTile = (statId) => {
        switch (statId) {
            case 'pendingLeads':
                return <StatTile key={statId} icon={MdOutlineLocalOffer} label="Leads" value={scopedData.leads.length} helper="New homeowner requests" to="/company/leads" tone="blue" />;
            case 'surveys':
                return <StatTile key={statId} icon={FaClipboardCheck} label="Initial Surveys" value={pendingSurveys.length} helper={`${completedPendingSurveys.length} completed awaiting agreement`} to="/company/initial-estimates" tone={pendingSurveys.length ? "amber" : "emerald"} />;
            case 'pendingServiceAgreements':
                return <StatTile key={statId} icon={FaFileContract} label="Pending Service Agreements" value={pendingServiceAgreements.length} helper="Draft, sent, or revised" to="/company/sales/agreements" tone="blue" />;
            case 'needsRouting':
                return <StatTile key={statId} icon={FaFileContract} label="Needs Routing" value={agreementsNeedRouting.length} helper="Accepted service agreements" to="/company/route-dashboard" tone={agreementsNeedRouting.length ? "amber" : "emerald"} />;
            case 'routedCustomers':
                return <StatTile key={statId} icon={FaUsers} label="Routed Customers" value={routedCoverage.routedCustomerCount} helper={`${routedCoverage.routedServiceLocationCount} locations, ${routedCoverage.unroutedCustomerCount} unrouted`} to="/company/recurringServiceStop" tone={routedCoverage.unroutedCustomerCount ? "blue" : "emerald"} />;
            case 'todayRoutes':
                return <StatTile key={statId} icon={FaCalendarAlt} label="Today's Routes" value={routeRows.length} helper={`${todayRouteTotals.completed}/${todayRouteTotals.total} stops completed`} to="/company/route-day-management" tone={todayRouteTotals.total && todayRouteTotals.completed < todayRouteTotals.total ? "blue" : "emerald"} />;
            case 'openRepairRequests':
                return <StatTile key={statId} icon={FaTools} label="Open Repairs" value={summary.activeRepairs.length} helper="Repair requests needing action" to="/company/repair-requests" tone={summary.activeRepairs.length ? "rose" : "emerald"} />;
            case 'openJobs':
                return <StatTile key={statId} icon={MdConstruction} label="Open Jobs" value={scopedData.jobs.length} helper="Active operational work" to="/company/jobs/operations" tone={scopedData.jobs.length ? "amber" : "emerald"} />;
            default:
                return null;
        }
    };

    if (loading) {
        return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading dashboard...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-100 px-3 py-3 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-3">
                <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <h1 className="text-xl font-bold text-slate-950">Dashboard</h1>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">
                                {scopeLabel}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {availableDashboardScopeOptions.map((scope) => (
                                <ScopeButton
                                    key={scope.id}
                                    scope={scope}
                                    isActive={dashboardScope === scope.id}
                                    onClick={() => setDashboardScope(scope.id)}
                                />
                            ))}
                            <Link to="/company/operations-dashboard" className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                                Operations
                            </Link>
                            <Link to="/company/sales" className="inline-flex h-9 items-center rounded-md bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
                                Sales
                            </Link>
                        </div>
                    </div>
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

                {dashboardScope === 'personal' ? (
                    <PersonalDashboardView
                        personalDashboard={personalDashboard}
                        openTodos={openTodos}
                        attentionTodos={attentionTodos}
                        dashboardAlerts={dashboardAlerts}
                        unreadAlerts={unreadAlerts}
                        alertHref={alertHref}
                        personalCustomerIds={personalCustomerIds}
                        personalEquipment={scopedData.equipment}
                    />
                ) : (
                    <RegionalCompanyDashboardView
                        renderStatTile={renderStatTile}
                        summary={summary}
                        moneySeries={moneySeries}
                        routeRows={routeRows}
                        operationsOverview={operationsOverview}
                    />
                )}
            </div>
        </div>
    );
};

export default Dashboard;
