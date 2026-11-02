import { estimateServiceStopPaySummary } from './payEstimate';

const day = new Date('2026-10-30T19:00:00Z');
const type = { id: 'route', name: 'Commercial route', category: 'commercial', defaultRateType: 'perBodyOfWater' };
const rate = { id: 'rate', companyId: 'company', technicianId: 'tech', payTypeId: 'route', payBasis: 'serviceStop', rateType: 'perBodyOfWater', amountCents: 2500, status: 'active' };
const args = extra => ({ companyId: 'company', date: day, settings: { taskPaySource: 'technicianRate' },
  serviceStop: { id: 'stop', typeId: 'route', serviceLocationId: 'site', operationStatus: 'Finished', estimatedDuration: 90, duration: 60 },
  worker: { userId: 'tech', userName: 'Alex' }, workTypes: [type], rates: [rate],
  bodiesOfWater: [{ id: 'pool', serviceLocationId: 'site' }, { id: 'spa', serviceLocationId: 'site' },
    { id: 'pool', serviceLocationId: 'site' }, { id: 'inactive', serviceLocationId: 'site', isActive: false },
    { id: 'other', serviceLocationId: 'elsewhere' }], ...extra });

test.each(['preview', 'actual'])('%s BOW estimates use active distinct bodies at the work location', mode => {
  const summary = estimateServiceStopPaySummary(args({ mode }));
  expect(summary).toEqual(expect.objectContaining({ totalAmountCents: 5000, needsReview: false }));
  expect(summary.lines[0]).toEqual(expect.objectContaining({ quantity: 2, quantityUnit: 'bodyOfWater', rateAmountCents: 2500 }));
});

test('explicit BOW task pay stays separate and only pays its own BOW', () => {
  const summary = estimateServiceStopPaySummary(args({
    rates: [rate, { ...rate, id: 'task-rate', payBasis: 'serviceStopTask', amountCents: 1000 }],
    tasks: [{ id: 'task', status: 'Finished', payTypeId: 'route', bodyOfWaterId: 'pool', payrollStackBehavior: 'stackable' }],
  }));
  expect(summary.totalAmountCents).toBe(6000);
  expect(summary.lines.map(line => [line.source, line.quantity])).toEqual([['serviceStop', 2], ['serviceStopTask', 1]]);
});

test('missing or failed BOW data stays reviewable and custom pay replaces the automatic BOW total', () => {
  for (const bodiesOfWater of [null, []]) {
    expect(estimateServiceStopPaySummary(args({ bodiesOfWater }))).toEqual(expect.objectContaining({ totalAmountCents: 0, needsReview: true }));
  }
  const input = args();
  expect(estimateServiceStopPaySummary({ ...input, serviceStop: { ...input.serviceStop, payrollMode: 'custom', manualPayOverrideCents: 3500 } }))
    .toEqual(expect.objectContaining({ totalAmountCents: 3500, needsReview: false }));
});

test.each([
  ['flatPerStop', 2500], ['flatPerTask', 2500], ['perServiceLocation', 2500], ['manual', 2500], ['percentage', 5000],
])('%s keeps its own quantity rules beside location BOW data', (rateType, expected) => {
  const input = args({ rates: [{ ...rate, rateType }] });
  const summary = estimateServiceStopPaySummary({ ...input, serviceStop: { ...input.serviceStop, payrollBaseAmountCents: 20000 } });
  expect(summary.totalAmountCents).toBe(expected); expect(summary.needsReview).toBe(false);
});

test('hourly previews use planned minutes and earned pay uses actual minutes', () => {
  const input = args({ rates: [{ ...rate, payBasis: 'technicianHourly', rateType: 'hourly', amountCents: 6000 }],
    workTypes: [{ ...type, defaultRateType: 'hourly' }] });
  expect(estimateServiceStopPaySummary(input).totalAmountCents).toBe(9000);
  expect(estimateServiceStopPaySummary({ ...input, mode: 'actual' }).totalAmountCents).toBe(6000);
});
