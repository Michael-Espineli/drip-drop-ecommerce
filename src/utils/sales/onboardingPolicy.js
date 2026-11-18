import {parts, zonedDate, dayStart, addInterval} from './billingCalendar';
const key = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const millis = value => value?.toMillis?.() ?? value?.getTime?.() ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : typeof value === 'string' ? Date.parse(value) : Number(value) || 0);
const fail = (code, message) => { throw new Error(message); };

const isNewOnboarding = agreement => Number(agreement?.onboardingWorkflowVersion) === 1;
const isRecurringAgreement = agreement => !['oneoffjob', 'workoffer'].includes(key(agreement?.sourceType)) &&
  !['onetime', 'oneoff'].includes(key(agreement?.rateType)) && !['onetime', 'oneoff'].includes(key(agreement?.serviceCadence));
const calendarDays = (start, end, timeZone) => {
  const a = parts(start, timeZone), b = parts(end, timeZone);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
};
function occurrence(value, day, monthOffset, timeZone) {
  const p = parts(value, timeZone), month = new Date(Date.UTC(p.year, p.month - 1 + monthOffset, 1));
  return zonedDate({year: month.getUTCFullYear(), month: month.getUTCMonth() + 1,
    day: Math.min(day, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate())}, timeZone);
}
function nextOccurrence(value, day, timeZone, inclusive = false) {
  const current = occurrence(value, day, 0, timeZone);
  return current.getTime() > millis(value) || (inclusive && current.getTime() === millis(value))
    ? current : occurrence(value, day, 1, timeZone);
}
function onboardingSchedule(agreement, company = {}, startsAt = new Date()) {
  const config = agreement.onboardingBilling || {}, timeZone = config.timeZone || company.billingTimeZone || company.timeZone || 'UTC';
  const start = dayStart(startsAt, timeZone);
  const anchorDay = config.scheduleMode === 'companyOverride' ? Number(config.billingDay) : parts(start, timeZone).day;
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) fail('invalid-argument', 'Choose a billing day from 1 to 31.');
  const periodEnd = nextOccurrence(start, anchorDay, timeZone);
  const previousAnchor = occurrence(periodEnd, anchorDay, -1, timeZone);
  const periodDays = calendarDays(previousAnchor, periodEnd, timeZone), initialDays = calendarDays(start, periodEnd, timeZone);
  const prorated = config.scheduleMode === 'companyOverride' && config.prorationEnabled === true && initialDays < periodDays;
  const ratio = prorated ? initialDays / periodDays : 1;
  const sourceLines = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  const initialLines = sourceLines.map(item => ({...item, quantity: 1,
    description: [item.description, prorated ? `${initialDays} of ${periodDays} calendar days` : ''].filter(Boolean).join(' · '),
    unitAmountCents: Math.round(Number(item.totalAmountCents ?? Number(item.quantity || 1) * Number(item.unitAmountCents || 0)) * ratio),
    totalAmountCents: Math.round(Number(item.totalAmountCents ?? Number(item.quantity || 1) * Number(item.unitAmountCents || 0)) * ratio)}));
  const initialSubtotal = initialLines.reduce((sum, item) => sum + item.totalAmountCents, 0);
  const initialTax = Math.round(Number(agreement.taxAmountCents || 0) * ratio);
  const initialDiscount = Math.round(Number(agreement.discountAmountCents || 0) * ratio);
  const initialAmount = prorated ? initialSubtotal - initialDiscount + initialTax : Number(agreement.totalAmountCents ?? agreement.rateAmountCents ?? initialSubtotal);
  const sendDay = config.collectionMethod === 'invoice' ? Number(config.invoiceSendDay) : anchorDay;
  if (!Number.isInteger(sendDay) || sendDay < 1 || sendDay > 31) fail('invalid-argument', 'Choose an invoice-send day from 1 to 31.');
  const firstInvoiceAt = config.collectionMethod === 'invoice' ? nextOccurrence(start, sendDay, timeZone, true) : start;
  return {timeZone, start, anchorDay, sendDay, periodEnd, firstInvoiceAt, prorated, initialDays, periodDays,
    initialAmountCents: initialAmount, initialLineItems: initialLines, initialTaxAmountCents: initialTax, initialDiscountAmountCents: initialDiscount,
    renewals: [periodEnd, addInterval(periodEnd, 'month', 1, timeZone, anchorDay), addInterval(periodEnd, 'month', 2, timeZone, anchorDay)]};
}
function billingContactComplete(config = {}) {
  const contact = config.contact || {}, address = contact.address || {};
  return Boolean(String(contact.name || '').trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email || '').trim()) &&
    String(address.streetAddress || '').trim() && String(address.city || '').trim() && String(address.state || '').trim() && String(address.zip || address.zipCode || '').trim());
}
const routeAssigned = stop => Boolean(stop && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek?.length));
function onboardingChecklist(agreement, subscription = {}, locations = [], recurringStops = [], surveyComplete = false) {
  const config = agreement.onboardingBilling || {}, accepted = key(agreement.status) === 'accepted';
  const invoiceApproved = config.collectionMethod === 'invoice' && config.approvedByUserId && billingContactComplete(config) &&
    subscription.onboardingCollectionMethod === 'invoice' && subscription.status === 'active';
  const paymentReady = config.collectionMethod !== 'invoice' && subscription.onboardingPaymentMethodId && subscription.onboardingPaymentAuthorizedAt &&
    subscription.onboardingPaymentProfileId && subscription.status === 'active' && !subscription.canceledAt;
  const billingReady = Boolean(accepted && subscription.onboardingAgreementCurrent !== false && billingContactComplete(config) && (invoiceApproved || paymentReady));
  const ids = (agreement.serviceLocationIds || []).filter(Boolean);
  const routingReady = ids.length > 0 && ids.every(id => recurringStops.some(stop => stop.serviceLocationId === id && routeAssigned(stop) && stop.active !== false && stop.isActive !== false));
  const locationReady = ids.length > 0 && ids.every(id => locations.some(location => location.id === id &&
    String(location.address?.streetAddress || '').trim() && String(location.address?.city || '').trim()));
  const surveyReady = Boolean(surveyComplete || (config.surveyWaived === true && config.approvedByUserId && String(config.reason || '').trim()));
  const checks = [{id: 'survey', label: 'Initial survey completed or office waiver recorded', complete: surveyReady},
    {id: 'agreement', label: 'Agreement accepted', complete: accepted},
    {id: 'billing', label: config.collectionMethod === 'invoice' ? 'Office-approved invoice billing' : 'Billing contact and authorized payment method', complete: billingReady},
    {id: 'routing', label: 'Technician and service day assigned at every location', complete: routingReady},
    {id: 'location', label: 'Service location information saved', complete: locationReady}];
  return {accepted, surveyReady, billingReady, routingReady, locationReady, ready: checks.every(check => check.complete), checks};
}
export {isNewOnboarding, isRecurringAgreement, calendarDays, occurrence, nextOccurrence, onboardingSchedule, billingContactComplete, routeAssigned, onboardingChecklist};
