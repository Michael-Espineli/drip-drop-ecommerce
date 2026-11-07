const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createTechnicianPaysheet } = require('./technicianPaysheet');
const c = 'companies/north', p = c + '/technicianPayLineItems/', at = new Date('2026-11-05T20:00:00Z');
const stop = (extra = {}) => ({ techId: 'tech', customerName: 'Jones', type: 'Weekly service', serviceDate: at, completedAt: at, operationStatus: 'Finished', ...extra });
const line = (extra = {}) => ({ technicianId: 'tech', totalAmountCents: 5000, rateAmountCents: 5000, quantity: 1, quantityUnit: 'each', calculationStatus: 'calculated', completedDate: at, payTypeName: 'Weekly service', serviceStopId: 'one', source: 'serviceStop', rateType: 'flatPerStop', ...extra });
const req = (data = {}, uid = 'tech') => ({ auth: uid ? { uid } : null, data: { companyId: 'north', ...data } });
const fixture = (extra = {}) => {
  const db = new MemoryFirestore({ [c]: { name: 'North Pools', ownerId: 'owner', timeZone: 'America/Los_Angeles' }, 'users/tech/userAccess/north': { status: 'Active' }, [c + '/companyUsers/tech']: { userId: 'tech', userName: 'Alex' }, ...extra });
  return { db, read: createTechnicianPaysheet(db, () => at) };
};
test('last 30 company calendar days include today and work through its end, across DST', async () => {
  const { read } = fixture({ [p + 'start']: line({ completedDate: new Date('2026-10-07T07:00:00Z') }), [p + 'end']: line({ completedDate: new Date('2026-11-06T07:59:59Z') }), [p + 'too-old']: line({ completedDate: new Date('2026-10-07T06:59:59Z') }), [p + 'tomorrow']: line({ completedDate: new Date('2026-11-06T08:00:00Z') }) });
  const result = await read(req({ mode: 'summary' }));
  assert.equal(result.startDateKey, '2026-10-07'); assert.equal(result.endDateKey, '2026-11-05');
  assert.equal(result.summary.earnedCents, 10000); assert.equal(result.summary.olderUnpaidCents, 5000);
});
test('own-only access ignores management privileges and never returns another technician or company', async () => {
  const { db, read } = fixture({ [p + 'own']: line(), [p + 'other']: line({ technicianId: 'someone' }), 'companies/other/technicianPayLineItems/private': line(), [c + '/serviceStops/one']: stop(), [c + '/serviceStops/one/tasks/other']: { status: 'Finished', workerId: 'someone', completedAt: at, name: 'PRIVATE' }, 'companies/other/serviceStops/one/tasks/mine': { status: 'Finished', workerId: 'tech', completedAt: at, name: 'OTHER COMPANY' } });
  const before = JSON.stringify([...db.records]); const result = await read(req());
  assert.equal(result.lineItems.length, 1); assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result).includes('OTHER COMPANY'));
  assert.equal(JSON.stringify([...db.records]), before, 'read-only query writes nothing');
  await assert.rejects(read(req({ technicianId: 'someone' }, 'owner')), /only view your own/);
  await assert.rejects(read(req({}, null)), /Sign in/);
});
test('inactive access and absent membership fail without financial queries', async () => {
  const { db, read } = fixture({ 'users/tech/userAccess/north': { status: 'Revoked' } });
  await assert.rejects(read(req()), /Active company access/);
  assert.ok(!db.readLog.some(log => log.path.includes('technicianPayLineItems')));
});
test('included tasks remain visible, ordinary zero lines disappear, and missing work is flagged', async () => {
  const { read } = fixture({ [c + '/serviceStops/one']: stop(), [p + 'base']: line(), [p + 'zero']: line({ totalAmountCents: 0 }),
    [c + '/serviceStops/one/tasks/included']: { status: 'Finished', name: 'Water test', payrollMode: 'included' },
    [c + '/serviceStops/one/tasks/missing']: { status: 'Finished', name: 'Filter clean', payrollMode: 'custom', manualPayOverrideCents: 2500 },
    [c + '/serviceStops/two']: stop({ customerName: 'Missing stop' }),
  });
  const result = await read(req()), stops = result.days[0].routes[0].stops;
  assert.equal(result.lineItems.length, 1); assert.equal(result.summary.earnedCents, 5000); assert.equal(result.summary.reviewCount, 2);
  assert.equal(result.summary.completedStops, 2); assert.equal(result.summary.completedTasks, 2);
  assert.equal(stops.find(s => s.id === 'one').tasks.find(t => t.id === 'included').coverageLabel, 'Included in stop pay');
  assert.equal(stops.find(s => s.id === 'one').tasks.find(t => t.id === 'missing').coverageLabel, 'Pay needs review');
});
test('zero custom pay and unpaid work are explained without creating earnings; missing rates stay pending', async () => {
  const { read } = fixture({ [c + '/serviceStops/one']: stop({ payrollMode: 'custom', manualPayOverrideCents: 0 }),
    [c + '/serviceStops/one/tasks/unpaid']: { status: 'Finished', payrollMode: 'unpaid', name: 'No extra' },
    [p + 'review']: line({ serviceStopId: 'two', calculationStatus: 'needsReview', totalAmountCents: 0 }), [c + '/serviceStops/two']: stop() });
  const result = await read(req());
  assert.equal(result.summary.reviewCount, 1); assert.equal(result.summary.earnedCents, 0);
  assert.equal(result.days[0].routes[0].stops.find(s => s.id === 'one').coverageLabel, 'No additional pay');
  assert.equal(result.lineItems[0].needsReview, true);
});
test('preserves route order, separates off-route work, and does not count linked task copies twice', async () => {
  const { read } = fixture({ [c + '/activeRoutes/r']: { techId: 'tech', name: 'Thursday route', date: at, order: [{ serviceStopId: 'two', order: 1 }, { serviceStopId: 'one', order: 2 }] },
    [c + '/serviceStops/one']: stop({ jobId: 'job' }), [c + '/serviceStops/two']: stop({ payrollMode: 'unpaid' }),
    [c + '/serviceStops/one/tasks/a']: { status: 'Finished', workerId: 'tech', completedAt: at, jobTaskId: 'task', name: 'Repair' },
    [c + '/serviceStops/one/tasks/b']: { status: 'Finished', workerId: 'tech', completedAt: at, jobTaskId: 'task', name: 'Repair duplicate' },
    [c + '/workOrders/job/tasks/task']: { status: 'Finished', workerId: 'tech', completedAt: at, name: 'Canonical repair' },
    [c + '/workOrders/solo/tasks/solo']: { status: 'Finished', workerId: 'tech', completedAt: at, name: 'Unscheduled repair', payrollMode: 'unpaid' },
    [p + 'task']: line({ serviceStopTaskId: 'a', jobId: 'job', jobTaskId: 'task', source: 'serviceStopTask' }), [p + 'base']: line(),
  });
  const result = await read(req()), routes = result.days[0].routes;
  assert.deepEqual(routes.find(r => r.id === 'r').stops.map(s => s.id), ['two', 'one']);
  assert.equal(routes.find(r => r.id === 'r').totalCents, 10000); assert.equal(result.summary.completedTasks, 2);
  assert.equal(routes.find(r => r.id === 'outside-route').stops[0].title, 'Unscheduled repair');
});
test('paid statement links and legacy line lists carry payment reference without treating approved as paid', async () => {
  const { read } = fixture({ [p + 'legacy']: line({ calculationStatus: 'approved' }), [p + 'unpaid']: line({ payStatementId: 'approved' }), [p + 'negative']: line({ totalAmountCents: -500, source: 'manualAdjustment', payrollSource: 'payCorrection' }),
    [c + '/technicianPayStatements/paid']: { technicianId: 'tech', status: 'paid', lineItemIds: ['legacy'], subtotalCents: 5000, totalCents: 5000, startDate: at, endDate: at, paidAt: at, paymentReference: 'ACH-123' },
    [c + '/technicianPayStatements/approved']: { technicianId: 'tech', status: 'approved', lineItemIds: ['unpaid'], subtotalCents: 5000, totalCents: 5000, startDate: at, endDate: at },
  });
  const result = await read(req());
  assert.equal(result.summary.earnedCents, 9500); assert.equal(result.summary.recordedPaidCents, 5000); assert.equal(result.summary.remainingCents, 4500);
  assert.equal(result.lineItems.find(l => l.id === 'legacy').paymentReference, 'ACH-123');
});
test('saved statements keep authoritative totals and load older legacy items, reporting missing and foreign IDs', async () => {
  const { read } = fixture({ [p + 'old']: line({ completedDate: new Date('2020-01-01'), totalAmountCents: 3000 }), [p + 'other']: line({ technicianId: 'someone' }),
    [c + '/technicianPayStatements/s']: { technicianId: 'tech', status: 'paid', lineItemIds: ['old', 'missing', 'other'], subtotalCents: 7000, adjustmentCents: -1000, totalCents: 6000, startDate: new Date('2020-01-01'), endDate: new Date('2020-01-31'), paidAt: at },
    [c + '/technicianPayStatements/private']: { technicianId: 'someone', status: 'paid', totalCents: 999999 },
  });
  const result = await read(req({ statementId: 's' }));
  assert.equal(result.statement.totalCents, 6000); assert.equal(result.missingCount, 2); assert.equal(result.lineItems.length, 1); assert.equal(result.lineItems[0].isPaid, true);
  await assert.rejects(read(req({ statementId: 'private' })), /unavailable/);
});
test('independently assigned task on another technician’s stop exposes only the current technician’s task', async () => {
  const { read } = fixture({ [c + '/serviceStops/shared']: stop({ techId: 'other' }), [c + '/serviceStops/shared/tasks/mine']: { workerId: 'tech', completedAt: at, status: 'Finished', name: 'My repair', payrollMode: 'unpaid' }, [c + '/serviceStops/shared/tasks/private']: { workerId: 'other', status: 'Finished', completedAt: at, name: 'PRIVATE TASK' } });
  const result = await read(req());
  assert.ok(JSON.stringify(result).includes('My repair')); assert.ok(!JSON.stringify(result).includes('PRIVATE TASK'));
  assert.equal(result.summary.completedStops, 0); assert.equal(result.summary.completedTasks, 1);
});
test('invalid ranges and invalid stored amounts fail visibly rather than presenting a zero balance', async () => {
  const { read } = fixture({ [p + 'bad']: line({ totalAmountCents: 'invalid' }) });
  await assert.rejects(read(req({ startDateKey: '2026-01-01' })), /at most 93/);
  await assert.rejects(read(req({ startDateKey: '2026-11-06', endDateKey: '2026-11-05' })), /Choose/);
  await assert.rejects(read(req({ mode: 'summary' })), /amount needs management review/);
});
test('statement adjustments stay whole on the ending date and reconcile live earned, paid and older balances', async () => {
  const { read } = fixture({ [p + 'work']: line({ payStatementId: 'paid' }),
    [c + '/technicianPayStatements/paid']: { technicianId: 'tech', status: 'paid', lineItemIds: ['work'], subtotalCents: 5000, adjustmentCents: -500, totalCents: 4500, startDate: at, endDate: at, paidAt: at },
    [c + '/technicianPayStatements/older']: { technicianId: 'tech', status: 'approved', lineItemIds: [], subtotalCents: 0, adjustmentCents: 250, totalCents: 250, startDate: new Date('2026-09-01'), endDate: new Date('2026-09-15') },
  });
  const result = await read(req());
  assert.equal(result.summary.earnedCents, 4500); assert.equal(result.summary.recordedPaidCents, 4500); assert.equal(result.summary.remainingCents, 0); assert.equal(result.summary.olderUnpaidCents, 250);
  assert.equal(result.earnings.find(v => v.label === 'Statement adjustments').amountCents, -500);
});
test('date validation enforces 93 calendar days exactly and rejects malformed end dates', async () => {
  const { read } = fixture();
  const okay = await read(req({ mode: 'summary', startDateKey: '2026-08-05', endDateKey: '2026-11-05' }));
  assert.equal(okay.startDateKey, '2026-08-05');
  await assert.rejects(read(req({ startDateKey: '2026-08-04', endDateKey: '2026-11-05' })), /at most 93/);
  await assert.rejects(read(req({ endDateKey: 'invalid' })), /calendar date/);
});
test('a legacy statement without retrievable work does not claim a complete zero-dollar breakdown', async () => {
  const { read } = fixture({ [c + '/technicianPayStatements/legacy']: { technicianId: 'tech', status: 'paid', startDate: at, endDate: at, subtotalCents: 5000, totalCents: 5000, lineItemIds: [] } });
  const result = await read(req({ statementId: 'legacy' }));
  assert.equal(result.statement.totalCents, 5000); assert.match(result.detailWarning, /does not match/); assert.equal(result.summary.earnedCents, 0);
});
