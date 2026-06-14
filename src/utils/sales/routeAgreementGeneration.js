import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  SalesAgreement,
  SalesAgreementSourceType,
  SalesAgreementStatus,
  SalesInvoiceDeliveryMethod,
  SalesInvoiceLineItem,
  salesCollectionNames,
} from '../models/Sales';
import { recurringFrequencyToAgreementService } from './agreementCadence';
import { saveSalesModel } from './salesFirestore';

const closedAgreementStatuses = new Set(['canceled', 'cancelled', 'rejected', 'expired']);

const normalizeKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const isActiveAgreement = (agreement = {}) => !closedAgreementStatuses.has(normalizeKey(agreement.status));

const routeTechnicianLabel = (route = {}) => (
  route.techName ||
  route.technicianName ||
  route.tech ||
  route.userName ||
  'Technician'
);

export const routeAgreementRouteTitle = (route = {}) => (
  route.description ||
  route.name ||
  route.routeName ||
  `${routeTechnicianLabel(route)} ${route.day || ''} Route`.trim()
);

const routeOrderItems = (route = {}) => (
  Array.isArray(route.order)
    ? [...route.order].sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
    : []
);

export const getRouteRecurringServiceStopIds = (route = {}) => {
  const ids = new Set();

  routeOrderItems(route).forEach((item) => {
    const recurringServiceStopId = item?.recurringServiceStopId;
    if (recurringServiceStopId) ids.add(String(recurringServiceStopId));
  });

  if (Array.isArray(route.rssIds)) {
    route.rssIds.forEach((id) => {
      if (id) ids.add(String(id));
    });
  }

  return [...ids];
};

const routeStopEntriesForRoutes = (routes = []) => {
  const entriesByStopId = new Map();

  routes.filter(Boolean).forEach((route) => {
    routeOrderItems(route).forEach((item) => {
      const recurringServiceStopId = item?.recurringServiceStopId;
      if (!recurringServiceStopId || entriesByStopId.has(String(recurringServiceStopId))) return;
      entriesByStopId.set(String(recurringServiceStopId), { route, routeStop: item });
    });

    getRouteRecurringServiceStopIds(route).forEach((recurringServiceStopId) => {
      if (entriesByStopId.has(String(recurringServiceStopId))) return;
      entriesByStopId.set(String(recurringServiceStopId), {
        route,
        routeStop: { recurringServiceStopId },
      });
    });
  });

  return [...entriesByStopId.values()];
};

const customerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || customer.name || '';
  }

  return (
    customer.customerName ||
    customer.name ||
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
    customer.company ||
    customer.email ||
    ''
  );
};

const customerUserId = (customer = {}) => (
  customer.customerUserId ||
  customer.userId ||
  customer.linkedCustomerUserId ||
  customer.linkedHomeownerUserId ||
  (Array.isArray(customer.linkedCustomerIds) ? customer.linkedCustomerIds[0] : null) ||
  null
);

const customerRelationshipId = (customer = {}) => (
  customer.relationshipId ||
  customer.customerCompanyRelationshipId ||
  customer.linkedRelationshipId ||
  ''
);

const customerEmail = (customer = {}, recurringStop = {}) => (
  customer.email ||
  customer.billingEmail ||
  customer.mainContact?.email ||
  customer.contact?.email ||
  recurringStop.email ||
  recurringStop.billingEmail ||
  ''
);

const locationAddress = (location = {}) => {
  const address = location.address || location.billingAddress || {};
  return {
    streetAddress: address.streetAddress || location.streetAddress || '',
    address02: address.address02 || location.address02 || '',
    city: address.city || location.city || '',
    state: address.state || location.state || '',
    zip: address.zip || location.zip || '',
  };
};

const locationSnapshot = (location = {}, recurringStop = {}) => {
  const address = locationAddress({
    ...recurringStop,
    ...location,
    address: location.address || recurringStop.address || {},
  });

  return {
    id: location.id || recurringStop.serviceLocationId || '',
    nickName: location.nickName || location.name || recurringStop.locationName || '',
    streetAddress: address.streetAddress,
    address02: address.address02,
    city: address.city,
    state: address.state,
    zip: address.zip,
  };
};

const locationLabel = (snapshot = {}) => (
  [
    snapshot.nickName,
    snapshot.streetAddress,
    snapshot.city,
    snapshot.state,
    snapshot.zip,
  ]
    .filter(Boolean)
    .join(' ')
);

const numberFromMoney = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const centsFromField = (...values) => {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined && candidate !== '');
  return Math.max(Math.round(numberFromMoney(value)), 0);
};

const dollarsFromField = (...values) => {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined && candidate !== '');
  return Math.max(Math.round(numberFromMoney(value) * 100), 0);
};

const resolveRateAmountCents = (recurringStop = {}, location = {}) => {
  const centsValue = centsFromField(
    recurringStop.rateAmountCents,
    recurringStop.amountCents,
    recurringStop.monthlyRateCents,
    recurringStop.priceCents,
    location.rateAmountCents,
    location.amountCents,
    location.monthlyRateCents,
    location.priceCents
  );

  if (centsValue > 0) return centsValue;

  return dollarsFromField(
    recurringStop.rateAmount,
    recurringStop.amount,
    recurringStop.monthlyRate,
    recurringStop.price,
    recurringStop.rate,
    location.rateAmount,
    location.amount,
    location.monthlyRate,
    location.price,
    location.rate
  );
};

const readCompanyDoc = async ({ db, companyId, collectionName, id, cache }) => {
  if (!id) return null;
  const cacheKey = String(id);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const docSnap = await getDoc(doc(db, 'companies', companyId, collectionName, cacheKey));
  const value = docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
  cache.set(cacheKey, value);
  return value;
};

const agreementStopId = (agreement = {}) => {
  if (agreement.recurringServiceStopId) return String(agreement.recurringServiceStopId);
  if (normalizeKey(agreement.sourceType) === normalizeKey(SalesAgreementSourceType.recurringService) && agreement.sourceId) {
    return String(agreement.sourceId);
  }
  return '';
};

export const generateServiceAgreementsFromRoutes = async ({
  db,
  companyId,
  companyName = '',
  routes = [],
  createdByUserId = '',
} = {}) => {
  if (!db || !companyId) throw new Error('Missing company context.');

  const routeList = routes.filter(Boolean);
  const routeStopEntries = routeStopEntriesForRoutes(routeList);
  const recurringServiceStopIds = routeStopEntries
    .map((entry) => entry.routeStop?.recurringServiceStopId)
    .filter(Boolean)
    .map(String);

  if (recurringServiceStopIds.length === 0) {
    return {
      routeCount: routeList.length,
      stopCount: 0,
      createdCount: 0,
      skippedExistingCount: 0,
      skippedIncompleteCount: 0,
      missingStopCount: 0,
      createdAgreements: [],
    };
  }

  const [agreementSnapshot, recurringStopSnapshots] = await Promise.all([
    getDocs(query(collection(db, salesCollectionNames.agreements), where('companyId', '==', companyId))),
    Promise.all(
      recurringServiceStopIds.map(async (recurringServiceStopId) => {
        const recurringStopRef = doc(db, 'companies', companyId, 'recurringServiceStop', recurringServiceStopId);
        const recurringStopSnap = await getDoc(recurringStopRef);
        return {
          ref: recurringStopRef,
          id: recurringServiceStopId,
          exists: recurringStopSnap.exists(),
          data: recurringStopSnap.exists() ? { id: recurringStopSnap.id, ...recurringStopSnap.data() } : null,
        };
      })
    ),
  ]);

  const agreements = agreementSnapshot.docs.map((agreementDoc) => ({ id: agreementDoc.id, ...agreementDoc.data() }));
  const agreementsById = new Map(agreements.map((agreement) => [String(agreement.id), agreement]));
  const activeAgreementStopIds = new Set(
    agreements
      .filter(isActiveAgreement)
      .map(agreementStopId)
      .filter(Boolean)
  );
  const recurringStopsById = new Map(recurringStopSnapshots.map((snapshot) => [String(snapshot.id), snapshot]));
  const customersById = new Map();
  const locationsById = new Map();
  const createdAgreements = [];
  const skippedExistingStopIds = [];
  const skippedIncompleteStopIds = [];
  const missingStopIds = [];

  for (const entry of routeStopEntries) {
    const recurringServiceStopId = String(entry.routeStop?.recurringServiceStopId || '');
    const recurringStopSnapshot = recurringStopsById.get(recurringServiceStopId);

    if (!recurringStopSnapshot?.exists) {
      missingStopIds.push(recurringServiceStopId);
      continue;
    }

    const recurringStop = recurringStopSnapshot.data;
    const linkedAgreement = recurringStop.salesAgreementId
      ? agreementsById.get(String(recurringStop.salesAgreementId))
      : null;

    if (activeAgreementStopIds.has(recurringServiceStopId) || (linkedAgreement && isActiveAgreement(linkedAgreement))) {
      skippedExistingStopIds.push(recurringServiceStopId);
      continue;
    }

    const customerId = String(recurringStop.customerId || entry.routeStop?.customerId || '');
    const serviceLocationId = String(
      recurringStop.serviceLocationId ||
      entry.routeStop?.serviceLocationId ||
      entry.routeStop?.locationId ||
      ''
    );

    if (!customerId || !serviceLocationId) {
      skippedIncompleteStopIds.push(recurringServiceStopId);
      continue;
    }

    const [customer, location] = await Promise.all([
      readCompanyDoc({ db, companyId, collectionName: 'customers', id: customerId, cache: customersById }),
      readCompanyDoc({ db, companyId, collectionName: 'serviceLocations', id: serviceLocationId, cache: locationsById }),
    ]);

    const customerName = (
      customerDisplayName(customer || {}) ||
      recurringStop.customerName ||
      entry.routeStop?.customerName ||
      'Customer'
    );
    const routeName = routeAgreementRouteTitle(entry.route);
    const snapshot = locationSnapshot({ ...(location || {}), id: serviceLocationId }, recurringStop);
    const locationText = locationLabel(snapshot);
    const serviceSchedule = recurringFrequencyToAgreementService({
      frequency: recurringStop.frequency || entry.route?.frequency || 'Weekly',
      daysOfWeek: recurringStop.daysOfWeek || entry.route?.daysOfWeek || '',
      day: recurringStop.day || entry.route?.day || '',
    });
    const rateAmountCents = resolveRateAmountCents(recurringStop, location || {});
    const requiresPricing = rateAmountCents <= 0;
    const lineItem = new SalesInvoiceLineItem({
      sourceType: SalesAgreementSourceType.recurringService,
      sourceId: recurringServiceStopId,
      name: 'Recurring pool service',
      description: [
        serviceSchedule.serviceFrequencyLabel || 'Recurring service',
        locationText,
        requiresPricing ? 'Set pricing and terms before sending.' : '',
      ]
        .filter(Boolean)
        .join(' - '),
      quantity: 1,
      unitAmountCents: rateAmountCents,
      totalAmountCents: rateAmountCents,
      taxable: false,
      type: 'recurringService',
      metadata: {
        generatedFromRoute: true,
        recurringRouteId: entry.route?.id || '',
        recurringRouteName: routeName,
        recurringServiceStopId,
        serviceLocationId,
        requiresPricing,
      },
    });

    const agreement = new SalesAgreement({
      companyId,
      companyName,
      customerId,
      customerUserId: customerUserId(customer || {}),
      relationshipId: customerRelationshipId(customer || {}),
      customerCompanyRelationshipId: customerRelationshipId(customer || {}),
      customerName,
      email: customerEmail(customer || {}, recurringStop),
      serviceLocationIds: [serviceLocationId],
      serviceLocationSnapshots: [snapshot],
      sourceType: SalesAgreementSourceType.recurringService,
      sourceId: recurringServiceStopId,
      recurringServiceStopId,
      recurringRouteId: entry.route?.id || '',
      recurringRouteName: routeName,
      operationsSetupStatus: 'recurringServiceStopCreated',
      operationsSetupReason: 'generatedFromRoute',
      title: `${customerName} Service Agreement`,
      description: [
        routeName ? `Generated from ${routeName}.` : 'Generated from planned route.',
        locationText ? `Service location: ${locationText}.` : '',
        requiresPricing ? 'Review pricing and terms before sending.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      terms: '',
      termsList: [],
      lineItems: [lineItem],
      status: SalesAgreementStatus.draft,
      rateAmountCents,
      subtotalAmountCents: rateAmountCents,
      taxAmountCents: 0,
      totalAmountCents: rateAmountCents,
      rateType: 'perMonth',
      serviceCadence: serviceSchedule.serviceCadence,
      serviceCadenceCount: serviceSchedule.serviceCadenceCount,
      serviceDaysOfWeek: serviceSchedule.serviceDaysOfWeek,
      serviceFrequencyLabel: serviceSchedule.serviceFrequencyLabel,
      billingFrequency: 'monthly',
      billingFrequencyCount: 1,
      paymentTerms: 'dueOnReceipt',
      invoiceDeliveryMethod: SalesInvoiceDeliveryMethod.email,
      startDate: recurringStop.startDate || null,
      endDate: recurringStop.endDate || null,
      atWill: recurringStop.noEndDate !== false,
      createdByUserId,
      emailDelivery: {},
    });

    await saveSalesModel(db, 'agreements', agreement);
    await updateDoc(recurringStopSnapshot.ref, {
      salesAgreementId: agreement.id,
      salesAgreementStatus: SalesAgreementStatus.draft,
      recurringRouteId: entry.route?.id || recurringStop.recurringRouteId || '',
      recurringRouteName: routeName,
      updatedAt: serverTimestamp(),
    });

    activeAgreementStopIds.add(recurringServiceStopId);
    createdAgreements.push(agreement);
  }

  return {
    routeCount: routeList.length,
    stopCount: routeStopEntries.length,
    createdCount: createdAgreements.length,
    skippedExistingCount: skippedExistingStopIds.length,
    skippedIncompleteCount: skippedIncompleteStopIds.length,
    missingStopCount: missingStopIds.length,
    createdAgreements,
    skippedExistingStopIds,
    skippedIncompleteStopIds,
    missingStopIds,
  };
};
