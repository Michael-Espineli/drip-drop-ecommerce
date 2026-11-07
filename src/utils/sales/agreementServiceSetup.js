const normalize = value => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const firstText = (...values) => values.map(value => String(value || '').trim()).find(Boolean) || '';

// The agreement is the operational source; the subscription supports older records.
export function agreementServiceSetup(agreement = {}, subscription = {}) {
  const recurringServiceStopId = firstText(agreement.recurringServiceStopId, subscription.recurringServiceStopId);
  const recurringRouteId = firstText(agreement.recurringRouteId, subscription.recurringRouteId);
  const setupStatus = normalize(agreement.operationsSetupStatus || subscription.operationsSetupStatus);
  const isEstimate = ['oneoffjob', 'workoffer', 'lead'].includes(normalize(agreement.sourceType)) ||
    normalize(agreement.rateType) === 'onetime' || normalize(agreement.serviceCadence) === 'onetime';
  const visible = normalize(agreement.status) === 'accepted' && !isEstimate;
  const routeReady = Boolean(recurringRouteId || [
    'recurringservicestopandroutecreated', 'recurringroutecreated', 'recurringrouteassigned',
    'ready', 'complete', 'completed',
  ].includes(setupStatus));
  const started = Boolean(recurringServiceStopId || routeReady || [
    'recurringservicestopcreated', 'servicestopcreated',
  ].includes(setupStatus));
  const companyName = agreement.companyName || 'Pool company';

  return {
    visible,
    pending: visible && !routeReady,
    started,
    recurringServiceStopId,
    recurringRouteId,
    label: started ? 'Recurring service setup started' : 'Waiting on company setup',
    message: started
      ? `${companyName} created your recurring service stop${routeReady ? ' and added it to a recurring route.' : '. Route planning is still in progress.'}`
      : `${companyName} is setting up your recurring service stop and route.`,
    updatedAt: agreement.operationsSetupUpdatedAt || subscription.operationsSetupUpdatedAt ||
      agreement.recurringServiceStopCreatedAt || subscription.recurringServiceStopCreatedAt ||
      agreement.acceptedAt || agreement.updatedAt,
  };
}
