const key = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const accepted = agreement => key(agreement.status) === 'accepted';
export function onboardingPipelineComplete(row, linkType, indexes) {
  const agreements = row.leadId ? indexes.agreementsByLeadId.get(row.leadId) || [] : indexes.agreementsByCustomerId.get(row.customerId) || [];
  if (linkType === 'initialEstimate') {
    if (agreements.some(agreement => agreement.onboardingReadiness?.surveyReady || (agreement.onboardingBilling?.surveyWaived && agreement.onboardingBilling?.approvedByUserId))) return true;
    const id = row.raw?.serviceEstimateServiceStopId || row.raw?.initialEstimateServiceStopId;
    const stop = indexes.estimateStopsById?.get(id);
    return Boolean(stop && (stop.endTime || ['finished', 'completed', 'complete'].includes(key(stop.operationStatus))));
  }
  if (linkType === 'serviceAgreement') return agreements.some(accepted);
  if (linkType === 'billingSetup') return agreements.some(agreement => accepted(agreement) && agreement.onboardingReadiness?.billingReady === true);
  if (linkType === 'routing') {
    const stops = indexes.recurringByCustomerId.get(row.customerId) || [];
    const assigned = stop => Boolean((stop.techId || stop.tech) && (stop.day || stop.daysOfWeek?.length) && stop.active !== false && stop.isActive !== false);
    const locationIds = row.raw?.serviceLocationId ? [row.raw.serviceLocationId] : [...new Set(agreements.filter(accepted).flatMap(agreement => agreement.serviceLocationIds || []))];
    return locationIds.length ? locationIds.every(id => stops.some(stop => stop.serviceLocationId === id && assigned(stop))) : stops.some(assigned);
  }
  return false;
}
