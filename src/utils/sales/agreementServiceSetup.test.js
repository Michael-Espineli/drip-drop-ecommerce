import { agreementServiceSetup } from './agreementServiceSetup';

const accepted = { status: 'accepted', companyName: 'Pool Company' };
test('detail setup supports existing billing-subscription stop and route references', () => {
  const started = agreementServiceSetup(accepted, { recurringServiceStopId: 'stop', operationsSetupUpdatedAt: 123 });
  expect(started).toEqual(expect.objectContaining({ pending: true, started: true, updatedAt: 123 }));
  expect(agreementServiceSetup(accepted, { recurringRouteId: 'route' }).pending).toBe(false);
});
test.each(['recurringServiceStopCreated', 'serviceStopCreated'])('%s leaves route planning in progress', operationsSetupStatus => {
  expect(agreementServiceSetup({ ...accepted, operationsSetupStatus })).toEqual(expect.objectContaining({ pending: true, started: true }));
});
test.each(['recurringServiceStopAndRouteCreated', 'recurringRouteCreated', 'recurringRouteAssigned', 'ready', 'complete', 'completed'])('%s completes dashboard setup', operationsSetupStatus => {
  expect(agreementServiceSetup({ ...accepted, operationsSetupStatus }).pending).toBe(false);
});
