const {fail} = require('./companyActor');
const {key} = require('./billingMath');
function estimateOrJob(stop) {
  const category = key(stop.serviceStopTypeUseCaseRawValue || stop.category);
  return Boolean(stop.jobId || stop.workOrderId || ['estimate', 'serviceestimate', 'serviceagreementestimate', 'jobestimate', 'customerrelationship'].includes(category) || /estimate|survey|inspection/.test(key(stop.type)));
}
async function assertServiceOnboardingReady(reader, db, companyId, stop) {
  if (estimateOrJob(stop)) return;
  const company = db.collection('companies').doc(companyId);
  const [customer, location] = await Promise.all([
    stop.customerId ? reader.get(company.collection('customers').doc(stop.customerId)) : null,
    stop.serviceLocationId ? reader.get(company.collection('serviceLocations').doc(stop.serviceLocationId)) : null,
  ]);
  const gate = location?.data()?.serviceOnboarding;
  if ((customer?.data()?.onboardingRequired === true || gate?.required === true) && !customer?.data()?.firstServiceCompletedAt && !['ready', 'active'].includes(gate?.status))
    fail('failed-precondition', 'The office must complete agreement, billing, and service setup and release this customer before the first routine service.');
}
module.exports = {estimateOrJob, assertServiceOnboardingReady};
