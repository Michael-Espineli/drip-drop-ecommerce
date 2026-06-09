import { SalesAgreementSourceType } from '../models/Sales';

export const normalizeSalesStatusKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

export const AgreementBillingType = {
  all: 'all',
  recurring: 'recurring',
  oneTime: 'oneTime',
};

export const getAgreementBillingType = (agreement = {}) => {
  const serviceCadenceKey = normalizeSalesStatusKey(agreement.serviceCadence);
  const rateTypeKey = normalizeSalesStatusKey(agreement.rateType);
  const sourceTypeKey = normalizeSalesStatusKey(agreement.sourceType);
  const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  const hasRecurringLineItem = lineItems.some((item) => (
    normalizeSalesStatusKey(item.billingBehavior || item.metadata?.billingBehavior) === AgreementBillingType.recurring
  ));

  if (serviceCadenceKey === 'onetime' || rateTypeKey === 'onetime' || sourceTypeKey === 'oneoffjob') {
    return AgreementBillingType.oneTime;
  }

  if (
    sourceTypeKey === normalizeSalesStatusKey(SalesAgreementSourceType.recurringService) ||
    agreement.billingSubscriptionId ||
    hasRecurringLineItem
  ) {
    return AgreementBillingType.recurring;
  }

  if (serviceCadenceKey || rateTypeKey) return AgreementBillingType.recurring;

  return AgreementBillingType.oneTime;
};

const normalizeDays = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((day) => day.trim())
      .filter(Boolean);
  }
  return [];
};

export const recurringStopHasAssignedRoute = (stop = {}) => {
  const days = normalizeDays(stop.daysOfWeek);
  const hasDay = days.length > 0 || Boolean(stop.day);
  const hasTech = Boolean(stop.techId || stop.tech);
  return hasDay && hasTech;
};

export const buildRecurringRoutingIndex = (recurringStops = []) => {
  const serviceLocationIds = new Set();
  const customerIds = new Set();

  recurringStops.forEach((stop) => {
    if (!recurringStopHasAssignedRoute(stop)) return;
    if (stop.serviceLocationId) serviceLocationIds.add(stop.serviceLocationId);
    if (stop.customerId) customerIds.add(stop.customerId);
  });

  return {
    serviceLocationIds,
    customerIds,
  };
};

export const agreementNeedsRecurringRouting = (agreement = {}, routingIndex = {}) => {
  if (normalizeSalesStatusKey(agreement.status) !== 'accepted') return false;
  if (getAgreementBillingType(agreement) !== AgreementBillingType.recurring) return false;
  if (agreement.recurringServiceStopId || agreement.recurringRouteId) return false;

  const setupStatus = normalizeSalesStatusKey(agreement.operationsSetupStatus);
  if (setupStatus && !['needsrecurringservicestop', 'needsrouting', 'notstarted'].includes(setupStatus)) {
    return false;
  }

  const routedServiceLocationIds = routingIndex.serviceLocationIds || new Set();
  const routedCustomerIds = routingIndex.customerIds || new Set();
  const serviceLocationIds = Array.isArray(agreement.serviceLocationIds)
    ? agreement.serviceLocationIds.filter(Boolean)
    : [];
  const hasLocationMatch = serviceLocationIds.some((serviceLocationId) => routedServiceLocationIds.has(serviceLocationId));
  const hasCustomerFallbackMatch = serviceLocationIds.length === 0 && agreement.customerId && routedCustomerIds.has(agreement.customerId);

  return !hasLocationMatch && !hasCustomerFallbackMatch;
};
