import {onboardingPipelineComplete} from './onboardingPipeline';
import {agreementServiceSetup} from './agreementServiceSetup';
const indexes = (agreements = [], stops = []) => ({agreementsByLeadId: new Map([['lead', agreements]]), agreementsByCustomerId: new Map([['customer', agreements]]),
  recurringByCustomerId: new Map([['customer', stops]]), estimateStopsById: new Map([['visit', {operationStatus: 'Scheduled'}]])});
const row = {leadId: 'lead', customerId: 'customer', raw: {initialEstimateServiceStopId: 'visit', recurringServiceStopId: 'stop'}};
test('scheduled visits, draft agreements and unassigned stops do not complete onboarding stages', () => {
  const index = indexes([{status: 'draft'}], [{id: 'stop'}]);
  for (const stage of ['initialEstimate', 'serviceAgreement', 'routing', 'billingSetup']) expect(onboardingPipelineComplete(row, stage, index)).toBe(false);
});
test('accepted and server-ready agreement state completes the matching lead billing stage', () => {
  const index = indexes([{status: 'accepted', onboardingReadiness: {billingReady: true, surveyReady: true}}], [{techId: 'tech', day: 'Monday'}]);
  for (const stage of ['initialEstimate', 'serviceAgreement', 'routing', 'billingSetup']) expect(onboardingPipelineComplete(row, stage, index)).toBe(true);
});
test('monthly service originating in a lead keeps recurring setup progress visible', () => {
  expect(agreementServiceSetup({status: 'accepted', sourceType: 'lead', serviceCadence: 'weekly', rateType: 'perMonth'}).pending).toBe(true);
  expect(agreementServiceSetup({status: 'accepted', sourceType: 'lead', rateType: 'oneTime'}).visible).toBe(false);
});
