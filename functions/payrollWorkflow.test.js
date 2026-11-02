const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayrollWorkflow } = require('./payrollWorkflow');

const { MemoryFirestore } = require('./testSupport/memoryFirestore');

const companyPath = "companies/company";
const stopPath = `${companyPath}/serviceStops/stop`;
const payPath = `${companyPath}/technicianPayLineItems/`;
function fixture(extra = {}) {
  const db = new MemoryFirestore({
    [companyPath]: { ownerId: "owner" },
    [`${companyPath}/paySettings/main`]: { taskPaySource: "technicianRate" },
    [`${companyPath}/companyPayTypes/filter`]: { name: "Filter clean", category: "repair", defaultRateType: "flatPerTask", isActive: true },
    [`${companyPath}/companyWorkTypes/filter`]: { name: "Outdated filter", category: "route", isActive: true },
    [`${companyPath}/technicianRates/a`]: { technicianId: "a", payTypeId: "filter", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents: 5000, status: "active" },
    [`${companyPath}/technicianRates/b`]: { technicianId: "b", payTypeId: "filter", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents: 8000, status: "active" },
    [`${companyPath}/companyUsers/a`]: { userId: "a", userName: "Alex" },
    [`${companyPath}/companyUsers/b`]: { userId: "b", userName: "Blair" },
    [stopPath]: { operationStatus: "Finished", techId: "a", typeId: "filter", jobId: "job", serviceDate: new Date("2026-10-23") },
    [`${stopPath}/tasks/task`]: { status: "Finished", name: "Clean filter", payTypeId: "filter", jobTaskId: "task" },
    ...extra,
  });
  return { db, workflow: createPayrollWorkflow(db, { debounceMs: 0 }) };
}
const lines = (db) => [...db.records].filter(([path]) => path.startsWith(payPath)).map(([, value]) => value);
const active = (db) => lines(db).filter((line) => line.calculationStatus !== "voided");
const event = (db, path, before, params, eventId = "event") => ({ id: eventId, params,
  data: { before: { exists: Boolean(before), data: () => before, ref: db.doc(path) }, after: db.read(db.doc(path)) } });

async function drain(db, workflow) {
  for (let i = 0; i < 300; i++) {
    const coordinator = [...db.records].find(([, value]) => value.kind === 'coordinator' && !value.activeRunId && value.pendingScopes?.length);
    if (coordinator) await workflow.processRefresh(event(db, coordinator[0], null, { companyId: 'company' }));
    const page = [...db.records].find(([, value]) => value.kind === 'page' && value.status === 'queued');
    if (!page) return;
    await workflow.processRefresh(event(db, page[0], null, { companyId: 'company' }));
  }
  throw new Error('Queue did not drain');
}

const zeroLine = (extra = {}) => ({ id: 'zero', companyId: 'company', source: 'serviceStopTask', serviceStopId: 'stop',
  serviceStopTaskId: 'task', jobId: 'job', jobTaskId: 'task', payrollComponentId: 'job:job:task',
  technicianId: 'a', payTypeId: 'filter', totalAmountCents: 0, calculationStatus: 'needsReview', ...extra });
const clearRequest = (uid = 'owner', ids = ['zero'], companyId = 'company') => ({ auth: uid ? { uid } : null, data: { companyId, lineItemIds: ids } });

test('zero custom stop pay is absent from persisted earnings and previews, and retries preserve protected history', async () => {
  for (const protection of [{}, { calculationStatus: 'approved', approvedAt: new Date() }, { payStatementId: 'statement' }, { paidAt: new Date() }]) {
    const old = { id: 'old-zero', source: 'manualAdjustment', serviceStopId: 'stop',
      payrollComponentId: 'stop:stop:base', technicianId: 'a', totalAmountCents: 0, calculationStatus: 'calculated', ...protection };
    const { db, workflow } = fixture({ [stopPath]: { operationStatus: 'Finished', techId: 'a', typeId: 'filter',
      serviceDate: new Date('2026-10-23'), payrollMode: 'custom', manualPayOverrideCents: 0 },
      [payPath + old.id]: old });
    await workflow.reconcileStop('company', 'stop');
    await workflow.reconcileStop('company', 'stop');
    assert.deepEqual(db.records.get(stopPath).estimatedPayLines, []);
    const protectedHistory = Object.keys(protection).length > 0;
    assert.equal(active(db).length, protectedHistory ? 1 : 0);
    if (protectedHistory) assert.deepEqual(db.records.get(payPath + old.id), old);
    else assert.equal(db.records.get(payPath + old.id).calculationStatus, 'voided');
  }
});

test('zero task clearance is audited, idempotent, and does not modify operational tasks or service pay', async () => {
  const { db, workflow } = fixture({ [payPath + 'zero']: zeroLine({ adminReviewNotes: 'Existing note' }),
    [payPath + 'service']: { source: 'serviceStop', totalAmountCents: 5000, calculationStatus: 'approved' } });
  const taskBefore = db.records.get(stopPath + '/tasks/task');
  const result = await workflow.clearZeroDollarTasks(clearRequest());
  const first = db.records.get(payPath + 'zero');
  assert.deepEqual(result.clearedLineItemIds, ['zero']); assert.equal(first.calculationStatus, 'voided');
  assert.equal(first.voidReason, 'adminVoided'); assert.equal(first.voidedByUserId, 'owner');
  assert.equal(first.autoReconciled, false); assert.equal(first.zeroDollarTaskCleared, true);
  assert.match(first.adminReviewNotes, /^Existing note\nReviewed \$0 task/);
  const retry = await workflow.clearZeroDollarTasks(clearRequest());
  assert.equal(retry.updates.length, 0); assert.deepEqual(db.records.get(payPath + 'zero'), first);
  assert.deepEqual(db.records.get(stopPath + '/tasks/task'), taskBefore);
  assert.equal(db.records.get(payPath + 'service').totalAmountCents, 5000);
});

test('zero task clearance requires active company payroll management and validates scoped IDs', async () => {
  const { db, workflow } = fixture({ [payPath + 'zero']: zeroLine(),
    'users/manager/userAccess/company': { roleId: 'finance' },
    [companyPath + '/roles/finance']: { permissionIdList: ['424'] },
    'users/viewer/userAccess/company': { roleId: 'read' },
    [companyPath + '/roles/read']: { permissionIdList: ['420'] },
    'users/revoked/userAccess/company': { roleName: 'Manager', status: 'revoked' } });
  for (const uid of [null, 'outsider', 'viewer', 'revoked']) {
    await assert.rejects(workflow.clearZeroDollarTasks(clearRequest(uid)), error => ['permission-denied', 'unauthenticated'].includes(error.code));
    assert.equal(db.records.get(payPath + 'zero').calculationStatus, 'needsReview');
  }
  for (const request of [clearRequest('owner', ['../zero']), clearRequest('owner', []), clearRequest('owner', ['zero'], '..'),
    clearRequest('owner', Array(201).fill('zero')), clearRequest('owner', ['zero'], 'other')]) {
    await assert.rejects(workflow.clearZeroDollarTasks(request));
  }
  await workflow.clearZeroDollarTasks(clearRequest('manager'));
  assert.equal(db.records.get(payPath + 'zero').voidedByUserId, 'manager');
});

test('clearance rejects protected or changed amounts atomically and rolls back on transaction failure', async () => {
  for (const change of [{ totalAmountCents: 1 }, { totalAmountCents: null }, { paidAt: new Date() }, { exportBatchId: 'export' },
    { payStatementId: 'statement' }, { calculationStatus: 'adjusted' }, { source: 'serviceStop', serviceStopTaskId: null, jobTaskId: null },
    { payrollSource: 'workOfferIncentive' }, { companyId: 'other' }]) {
    const { db, workflow } = fixture({ [payPath + 'zero']: zeroLine(), [payPath + 'changed']: zeroLine({ id: 'changed', ...change }) });
    await assert.rejects(workflow.clearZeroDollarTasks(clearRequest('owner', ['zero', 'changed'])));
    assert.equal(db.records.get(payPath + 'zero').calculationStatus, 'needsReview');
  }
  const { db, workflow } = fixture({ [payPath + 'zero']: zeroLine() });
  db.commitError = new Error('unavailable');
  await assert.rejects(workflow.clearZeroDollarTasks(clearRequest()), /unavailable/);
  assert.equal(db.records.get(payPath + 'zero').calculationStatus, 'needsReview');
  db.commitError = null;
  db.beforeCommit = () => db.set(payPath + 'zero', { totalAmountCents: 5000 }, { merge: true });
  await assert.rejects(workflow.clearZeroDollarTasks(clearRequest()), /Only unpaid/);
  assert.equal(db.records.get(payPath + 'zero').calculationStatus, 'needsReview');
});

test('cleared missing-setup tasks stay out of review on retries; later positive pay requires an adjustment', async () => {
  const { db, workflow } = fixture({ [companyPath + '/paySettings/main']: { routePaySource: 'completedTasks', taskPaySource: 'technicianRate' },
    [companyPath + '/companyPayTypes/filter']: { name: 'Filter clean', isActive: false } });
  await workflow.reconcileStop('company', 'stop');
  const line = active(db)[0];
  await workflow.clearZeroDollarTasks(clearRequest('owner', [line.id]));
  await workflow.onPayLineWrite(event(db, payPath + line.id, line, { companyId: 'company' }));
  await workflow.reconcileStop('company', 'stop');
  assert.equal(active(db).length, 0); assert.equal(db.records.get(stopPath).payrollNeedsReviewCount, 0);
  assert.equal(db.records.get(stopPath).estimatedPayNeedsReview, false);
  assert.equal(db.records.get(stopPath).payrollReconcileStatus, 'current');
  db.set(companyPath + '/companyPayTypes/filter', { isActive: true }, { merge: true });
  await workflow.reconcileStop('company', 'stop');
  assert.equal(active(db).length, 0); assert.equal(db.records.get(stopPath).payrollReconcileStatus, 'adjustmentRequired');
});

test('explicit zero task policy retires an old unapproved placeholder without changing base pay', async () => {
  const { db, workflow } = fixture({ [companyPath + '/paySettings/main']: { routePaySource: 'serviceStopAndCompletedTasks' },
    [stopPath + '/tasks/task']: { status: 'Finished', payrollMode: 'custom', manualPayOverrideCents: 0, payrollStackBehavior: 'stackable' },
    [payPath + 'zero']: zeroLine() });
  await workflow.reconcileStop('company', 'stop');
  assert.equal(db.records.get(payPath + 'zero').calculationStatus, 'voided');
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].source, 'serviceStop');
  assert.equal(active(db)[0].totalAmountCents, 5000);
});

test('approved zero tasks and legacy task identities clear durably with the first audit record', async () => {
  const { db, workflow } = fixture({ [companyPath + '/paySettings/main']: { routePaySource: 'completedTasks', taskPaySource: 'technicianRate' },
    [companyPath + '/companyPayTypes/filter']: { name: 'Filter clean', isActive: false },
    [payPath + 'legacy']: zeroLine({ id: 'legacy', payrollComponentId: undefined, calculationStatus: 'approved', approvedAt: new Date() }) });
  await workflow.clearZeroDollarTasks(clearRequest('owner', ['legacy', 'legacy']));
  const first = db.records.get(payPath + 'legacy');
  await workflow.reconcileStop('company', 'stop');
  await workflow.reconcileStop('company', 'stop');
  assert.equal(active(db).length, 0);
  assert.equal(db.records.get(stopPath).estimatedPayNeedsReview, false);
  assert.equal(db.records.get(stopPath).payrollNeedsReviewCount, 0);
  assert.deepEqual(db.records.get(payPath + 'legacy'), first);
});

test('composite payroll document IDs longer than 200 characters can be cleared', async () => {
  const lineId = 'comp_pay_line_serviceStopTask_' + 'scope_'.repeat(50);
  const { db, workflow } = fixture({ [payPath + lineId]: zeroLine({ id: lineId }) });
  await workflow.clearZeroDollarTasks(clearRequest('owner', [lineId]));
  assert.equal(db.records.get(payPath + lineId).calculationStatus, 'voided');
});

test("normal stop completion uses the canonical catalog, deduplicates matching tasks, and retries idempotently", async () => {
  const { db, workflow } = fixture();
  const e = event(db, stopPath, { operationStatus: "In Progress" }, { companyId: "company", serviceStopId: "stop" });
  await workflow.onStopWrite(e); await workflow.onStopWrite(e);
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].totalAmountCents, 5000);
  assert.equal(active(db)[0].payTypeName, "Filter clean");
  assert.equal(db.records.get(stopPath).estimatedPayCents, 5000);
});

function bodyFixture(extra = {}) {
  return fixture({
    [`${companyPath}/paySettings/main`]: { routePaySource: 'serviceStopAndCompletedTasks', taskPaySource: 'technicianRate' },
    [`${companyPath}/companyPayTypes/filter`]: { name: 'Commercial route', category: 'commercial', defaultRateType: 'perBodyOfWater', isActive: true },
    [`${companyPath}/technicianRates/a`]: { technicianId: 'a', payTypeId: 'filter', payBasis: 'serviceStop', rateType: 'perBodyOfWater', amountCents: 2500, status: 'active' },
    [stopPath]: { operationStatus: 'Finished', techId: 'a', typeId: 'filter', serviceLocationId: 'site', serviceDate: new Date('2026-10-23') },
    [`${stopPath}/tasks/task`]: { status: 'Finished', payrollMode: 'included' },
    [`${companyPath}/bodiesOfWater/pool`]: { serviceLocationId: 'site', isActive: true },
    [`${companyPath}/bodiesOfWater/spa`]: { serviceLocationId: 'site', isActive: true },
    [`${companyPath}/bodiesOfWater/fountain`]: { serviceLocationId: 'site' },
    [`${companyPath}/bodiesOfWater/inactive`]: { serviceLocationId: 'site', isActive: false },
    [`${companyPath}/bodiesOfWater/other-site`]: { serviceLocationId: 'other' },
    ['companies/other/bodiesOfWater/foreign']: { serviceLocationId: 'site' },
    ...extra,
  });
}

test('iOS endTime, web manual, bulk, and explicit refresh paths all pay rate times active location BOWs', async () => {
  for (const path of ['native', 'web', 'bulk', 'explicit']) {
    const { db, workflow } = bodyFixture();
    const before = { ...db.records.get(stopPath), operationStatus: 'Not Finished' };
    const endTime = new Date('2026-10-24T20:00:00Z');
    const patch = path === 'native' ? { endTime } : { completedAt: endTime, manualFinishSource: path === 'bulk' ? 'payroll_setup_bulk_finish' : 'admin_web' };
    db.set(stopPath, patch, { merge: true });
    if (path === 'explicit') await workflow.refreshRequestedStop({ auth: { uid: 'owner' }, data: { companyId: 'company', serviceStopId: 'stop' } });
    else {
      await workflow.onStopWrite(event(db, stopPath, before, { companyId: 'company', serviceStopId: 'stop' }, path));
      if (path === 'bulk') { assert.equal(active(db).length, 0); await drain(db, workflow); }
    }
    assert.equal(active(db).length, 1, path);
    const line = active(db)[0];
    assert.equal(line.totalAmountCents, 7500, path); assert.equal(line.quantity, 3);
    assert.equal(line.rateAmountCents, 2500); assert.equal(line.quantityUnit, 'bodyOfWater');
    assert.equal(line.completedDate.getTime(), endTime.getTime());
    assert.equal(db.records.get(stopPath).estimatedPayCents, 7500);
    assert.equal(db.records.get(stopPath).payrollReconcileStatus, 'current');
    const version = db.version;
    await workflow.reconcileStop('company', 'stop');
    assert.equal(active(db).length, 1); assert.equal(db.version, version);
    assert.equal(db.readLog.some(read => read.path.startsWith('companies/other/')), false);
  }
});

test('task-triggered partial work uses its own BOW before the location and the whole stop', async () => {
  const { db, workflow } = bodyFixture({
    [stopPath]: { operationStatus: 'In Progress', techId: 'a', typeId: 'filter', serviceLocationId: 'site', bodyOfWaterCount: 3 },
    [`${companyPath}/technicianRates/task`]: { technicianId: 'a', payTypeId: 'filter', payBasis: 'serviceStopTask', rateType: 'perBodyOfWater', amountCents: 1000, status: 'active' },
    [`${stopPath}/tasks/task`]: { status: 'Finished', payTypeId: 'filter', bodyOfWaterId: 'pool', payrollStackBehavior: 'stackable' },
  });
  await workflow.onStopTaskWrite(event(db, `${stopPath}/tasks/task`, { status: 'Scheduled' }, { companyId: 'company', serviceStopId: 'stop' }));
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].totalAmountCents, 1000);
  db.set(stopPath, { operationStatus: 'Finished' }, { merge: true });
  await workflow.reconcileStop('company', 'stop');
  assert.deepEqual(active(db).map(line => [line.source, line.quantity, line.totalAmountCents]).sort(), [
    ['serviceStop', 3, 7500], ['serviceStopTask', 1, 1000],
  ]);
});

test('direct job tasks resolve BOWs from their own site or the parent job site', async () => {
  const jobPath = `${companyPath}/workOrders/direct`;
  const { db, workflow } = bodyFixture({
    [jobPath]: { serviceLocationId: 'site' },
    [`${companyPath}/technicianRates/task`]: { technicianId: 'a', payTypeId: 'filter', payBasis: 'serviceStopTask', rateType: 'perBodyOfWater', amountCents: 1000, status: 'active' },
    [`${jobPath}/tasks/all`]: { status: 'Finished', workerId: 'a', payTypeId: 'filter' },
    [`${jobPath}/tasks/one`]: { status: 'Finished', workerId: 'a', payTypeId: 'filter', bodyOfWaterId: 'pool' },
    [`${jobPath}/tasks/other`]: { status: 'Finished', workerId: 'a', payTypeId: 'filter', serviceLocationId: 'other' },
  });
  await workflow.reconcileJob('company', 'direct');
  assert.deepEqual(active(db).map(line => [line.jobTaskId, line.quantity, line.totalAmountCents]).sort(), [
    ['all', 3, 3000], ['one', 1, 1000], ['other', 1, 1000],
  ]);
});

test('missing BOW setup heals on explicit refresh and protected pay requires adjustment', async () => {
  for (const protection of [{}, { approvedAt: new Date(), calculationStatus: 'approved' }, { paidAt: new Date() },
    { payStatementId: 'statement' }, { exportBatchId: 'export' }, { calculationStatus: 'adjusted' }]) {
    const { db, workflow } = bodyFixture();
    for (const key of ['pool', 'spa', 'fountain']) db.records.delete(`${companyPath}/bodiesOfWater/${key}`);
    await workflow.reconcileStop('company', 'stop');
    const line = active(db)[0];
    assert.equal(line.calculationStatus, 'needsReview'); assert.equal(line.totalAmountCents, 0);
    db.set(payPath + line.id, protection, { merge: true });
    const protectedLine = db.records.get(payPath + line.id);
    db.set(`${companyPath}/bodiesOfWater/pool`, { serviceLocationId: 'site', isActive: true });
    await workflow.refreshRequestedStop({ auth: { uid: 'owner' }, data: { companyId: 'company', serviceStopId: 'stop' } });
    assert.equal(active(db).length, 1);
    if (Object.keys(protection).length) {
      assert.deepEqual(db.records.get(payPath + line.id), protectedLine);
      assert.equal(db.records.get(stopPath).payrollReconcileStatus, 'adjustmentRequired');
    } else { assert.equal(active(db)[0].totalAmountCents, 2500); assert.equal(active(db)[0].calculationStatus, 'calculated'); }
  }
});

test('BOW read/commit failures cannot leave partial payroll and flat routes need no BOW reads', async () => {
  const { db, workflow } = bodyFixture();
  const read = db.read.bind(db);
  db.read = (ref, records) => { if (ref.path.endsWith('/bodiesOfWater')) throw new Error('BOW read failed'); return read(ref, records); };
  await assert.rejects(workflow.reconcileStop('company', 'stop'), /BOW read failed/);
  assert.equal(active(db).length, 0); assert.equal(db.records.get(stopPath).estimatedPayCents, undefined);
  db.read = read;
  db.commitError = new Error('commit failed');
  await assert.rejects(workflow.reconcileStop('company', 'stop'), /commit failed/);
  assert.equal(active(db).length, 0); assert.equal(db.records.get(stopPath).estimatedPayCents, undefined);
  db.commitError = null;
  db.beforeCommit = () => db.set(`${companyPath}/bodiesOfWater/spa`, { isActive: false }, { merge: true });
  await workflow.reconcileStop('company', 'stop');
  assert.equal(active(db)[0].totalAmountCents, 5000);
  const normal = fixture(); await normal.workflow.reconcileStop('company', 'stop');
  assert.equal(normal.db.readLog.some(read => read.path.endsWith('/bodiesOfWater')), false);
  assert.equal(active(normal.db)[0].totalAmountCents, 5000);
});

test("metadata-only trigger deliveries do not recalculate pay", async () => {
  const { db, workflow } = fixture();
  const before = db.records.get(stopPath);
  db.set(stopPath, { payrollLastProcessedAt: new Date() }, { merge: true });
  await workflow.onStopWrite(event(db, stopPath, before, { companyId: "company", serviceStopId: "stop" }));
  assert.equal(lines(db).length, 0);
});

test("reassignment voids obsolete unapproved pay and refreshes the expected cost", async () => {
  const { db, workflow } = fixture(); await workflow.reconcileStop("company", "stop");
  db.set(stopPath, { techId: "b" }, { merge: true }); await workflow.reconcileStop("company", "stop");
  assert.equal(lines(db).length, 2); assert.equal(active(db)[0].technicianId, "b");
  assert.equal(active(db)[0].totalAmountCents, 8000); assert.equal(db.records.get(stopPath).estimatedPayCents, 8000);
  db.set(stopPath, { operationStatus: "Scheduled" }, { merge: true });
  db.set(`${stopPath}/tasks/task`, { status: "Scheduled" }, { merge: true });
  await workflow.reconcileStop("company", "stop"); assert.equal(active(db).length, 0);
});

test("locked or statement-linked pay is preserved and conflicting work changes are flagged", async () => {
  for (const protection of [{ approvedAt: new Date(), calculationStatus: "approved" }, { paidAt: new Date() }, { payStatementId: "statement" }, { calculationStatus: "adjusted" }]) {
    const { db, workflow } = fixture(); await workflow.reconcileStop("company", "stop");
    const old = active(db)[0]; db.set(payPath + old.id, protection, { merge: true });
    db.set(stopPath, { techId: "b" }, { merge: true }); await workflow.reconcileStop("company", "stop");
    assert.equal(active(db).length, 1); assert.equal(active(db)[0].totalAmountCents, 5000);
    assert.equal(db.records.get(stopPath).payrollReconcileStatus, "adjustmentRequired");
  }
});

test("missing and inactive pay setup stays visible, heals on correction, and honors the payroll switch", async () => {
  const { db, workflow } = fixture({ [`${companyPath}/companyPayTypes/filter`]: { name: "Inactive", isActive: false } });
  await workflow.reconcileStop("company", "stop"); assert.equal(active(db)[0].calculationStatus, "needsReview");
  assert.equal(active(db)[0].totalAmountCents, 0); assert.equal(db.records.get(stopPath).payrollNeedsReviewCount, 1);
  db.set(`${companyPath}/companyPayTypes/filter`, { isActive: true }, { merge: true });
  await workflow.reconcileStop("company", "stop"); assert.equal(active(db)[0].totalAmountCents, 5000);
  db.set(`${companyPath}/settings/companyWide`, { payrollEnabled: false });
  await workflow.reconcileStop("company", "stop"); assert.equal(active(db).length, 1);
  assert.equal(active(db)[0].totalAmountCents, 5000); assert.equal(db.records.get(stopPath).payrollReconcileStatus, "disabled");
  db.set(`${companyPath}/serviceStops/new-stop`, { operationStatus: "Finished", techId: "a", typeId: "filter" });
  await workflow.reconcileStop("company", "new-stop"); assert.equal(active(db).length, 1);
});

test("unscheduled job completion creates payroll and moving that task into a visit does not pay twice", async () => {
  const jobPath = `${companyPath}/workOrders/job`, taskPath = `${jobPath}/tasks/task`;
  const { db, workflow } = fixture({ [jobPath]: { internalId: "J1" }, [taskPath]: { status: "Finished", workerId: "a", payTypeId: "filter" } });
  await workflow.reconcileJob("company", "job"); assert.equal(active(db).length, 1);
  assert.equal(active(db)[0].payrollSource, "jobTask");
  db.set(taskPath, { serviceStopId: { id: "stop" } }, { merge: true });
  await workflow.reconcileStop("company", "stop"); await workflow.reconcileJob("company", "job");
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].serviceStopId, "stop");
});

test("task edits propagate pay choices to scheduled copies, and removed links retire their old copy", async () => {
  const jobPath = `${companyPath}/workOrders/job`, taskPath = `${jobPath}/tasks/task`;
  const original = { status: "Finished", serviceStopId: { id: "stop" }, payTypeId: "filter" };
  const { db, workflow } = fixture({ [jobPath]: {}, [taskPath]: { ...original, payrollMode: "custom", manualPayOverrideCents: 9000 } });
  await workflow.onJobTaskWrite(event(db, taskPath, original, { companyId: "company", jobId: "job", taskId: "task" }));
  assert.equal(db.records.get(`${stopPath}/tasks/task`).manualPayOverrideCents, 9000);
  assert.equal(active(db).reduce((sum, line) => sum + line.totalAmountCents, 0), 9000);
  const before = db.records.get(taskPath); db.records.delete(taskPath);
  await workflow.onJobTaskWrite(event(db, taskPath, before, { companyId: "company", jobId: "job", taskId: "task" }));
  assert.equal(db.records.get(`${stopPath}/tasks/task`).status, "Deleted");
  // Removing a task does not remove the separately configured visit payment.
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].source, "serviceStop");
});

test("a failed transaction leaves no partial payroll or estimates, and a concurrent assignment retries", async () => {
  const { db, workflow } = fixture(); db.commitError = new Error("write unavailable");
  await assert.rejects(workflow.reconcileStop("company", "stop"), /write unavailable/);
  assert.equal(lines(db).length, 0); assert.equal(db.records.get(stopPath).estimatedPayCents, undefined);
  db.commitError = null; db.beforeCommit = () => db.set(stopPath, { techId: "b" }, { merge: true });
  await workflow.reconcileStop("company", "stop"); assert.equal(active(db)[0].technicianId, "b");
});

test("rate refresh pages recover from a failure and duplicate delivery, and preserve unapproved rates when configured", async () => {
  const { db, workflow } = fixture(); await workflow.reconcileStop("company", "stop");
  db.set(`${companyPath}/paySettings/main`, { recalculateUnapprovedPayWhenRatesChange: false }, { merge: true });
  const ratePath = `${companyPath}/technicianRates/a`, before = db.records.get(ratePath);
  db.set(ratePath, { amountCents: 6000 }, { merge: true });
  await workflow.onRateWrite(event(db, ratePath, before, { companyId: "company", rateId: "a" }, "refresh"));
  await workflow.processRefresh(event(db, `${companyPath}/payrollReconcileWork/pending_refresh`, null, { companyId: 'company' }));
  const [workPath] = [...db.records].find(([, value]) => value.kind === 'page' && value.status === 'queued');
  const request = event(db, workPath, null, { companyId: 'company' });
  db.commitError = new Error('retry page'); await assert.rejects(workflow.processRefresh(request), /retry page/);
  assert.equal(db.records.get(workPath).status, 'queued');
  db.commitError = null; await workflow.processRefresh(request); await workflow.processRefresh(request);
  await drain(db, workflow);
  assert.equal(db.records.get(workPath).status, 'completed'); assert.equal(active(db)[0].totalAmountCents, 5000);
  assert.equal(db.records.get(stopPath).estimatedPayCents, 6000);
});


test("the explicit refresh endpoint requires company access and accepts no client-supplied earnings", async () => {
  const { db, workflow } = fixture();
  const request = { auth: { uid: "owner" }, data: { companyId: "company", serviceStopId: "stop", manualPayOverrideCents: 99999 } };
  await assert.rejects(workflow.refreshRequestedStop({ ...request, auth: null }), { code: "unauthenticated" });
  await assert.rejects(workflow.refreshRequestedStop({ ...request, auth: { uid: "other-company-user" } }), { code: "permission-denied" });
  await assert.rejects(workflow.refreshRequestedStop({ ...request, data: { ...request.data, serviceStopId: "bad/path" } }), { code: "invalid-argument" });
  await assert.rejects(workflow.refreshRequestedStop({ ...request, data: { ...request.data, serviceStopId: "missing" } }), { code: "not-found" });
  await workflow.refreshRequestedStop(request); assert.equal(active(db)[0].totalAmountCents, 5000);
  db.set("users/member/userAccess/company", { roleId: "tech" });
  await workflow.refreshRequestedStop({ ...request, auth: { uid: "member" } }); assert.equal(active(db).length, 1);
});

test("rate refresh advances across more than forty stops without skipping a page", async () => {
  const { db, workflow } = fixture();
  for (let index = 0; index < 41; index += 1) db.set(`${companyPath}/serviceStops/stop-${String(index).padStart(2, "0")}`, { operationStatus: "Finished", techId: "a", typeId: "filter", payrollLastProcessedAt: new Date() });
  await workflow.reconcileStop("company", "stop");
  const settings = `${companyPath}/paySettings/main`;
  await workflow.onSettingsWrite(event(db, settings, null, { companyId: "company" }, "many"));
  await drain(db, workflow);
  assert.equal(db.records.get(`${companyPath}/serviceStops/stop-40`).estimatedPayCents, 5000);
  assert.equal(active(db).length, 42);
});


test("changing rates does not backfill previously unprocessed historical work", async () => {
  const { db, workflow } = fixture({ [`${companyPath}/workOrders/old-job`]: {}, [`${companyPath}/workOrders/old-job/tasks/old-task`]: { status: "Finished", workerId: "a", payTypeId: "filter" } });
  assert.equal((await workflow.reconcileStop("company", "stop", { ratesChanged: true })).skippedHistoricalWork, true);
  assert.equal((await workflow.reconcileJob("company", "old-job", { ratesChanged: true })).skippedHistoricalWork, true);
  assert.equal(lines(db).length, 0);
  assert.equal(db.readLog.some(read => /technicianRates|companyUsers|companyPayTypes|\/tasks$/.test(read.path)), false);
  await workflow.refreshRequestedStop({ auth: { uid: "owner" }, data: { companyId: "company", serviceStopId: "stop" } });
  assert.equal(active(db).length, 1);
});

test('twelve related rate events share one refresh and catalog reads stay bounded by pages', async () => {
  const { db, workflow } = fixture();
  for (let i = 0; i < 220; i++) db.set(`${companyPath}/technicianRates/unrelated-${i}`, {
    technicianId: 'unrelated', payBasis: 'serviceStop', amountCents: i + 1,
  });
  for (let i = 0; i < 80; i++) db.set(`${companyPath}/serviceStops/load-${String(i).padStart(3, '0')}`, {
    operationStatus: 'Finished', techId: 'a', typeId: 'filter', serviceDate: new Date('2026-10-23'), payrollLastProcessedAt: new Date(),
  });
  const ratePath = `${companyPath}/technicianRates/a`;
  let lastEvent;
  for (let i = 0; i < 12; i++) {
    const before = db.records.get(ratePath);
    db.set(ratePath, { amountCents: 5100 + i }, { merge: true });
    lastEvent = event(db, ratePath, before, { companyId: 'company', rateId: 'a' }, `edit-${i}`);
    await workflow.onRateWrite(lastEvent);
  }
  db.readLog = [];
  await drain(db, workflow);
  const pages = [...db.records.values()].filter(v => v.kind === 'page');
  assert.equal(new Set(pages.map(v => v.runId)).size, 1);
  assert.equal(db.records.get(`${companyPath}/serviceStops/load-079`).estimatedPayCents, 5111);
  const catalogReads = db.readLog.filter(read => read.path.endsWith('/technicianRates'));
  assert.ok(catalogReads.length <= 3, `Expected at most one catalog read per nonempty page, got ${catalogReads.length}`);
  const reads = db.readLog.reduce((total, read) => total + read.reads, 0);
  assert.ok(reads < 2500, `Batched scenario used ${reads} reads`);
  console.log(`Payroll read regression: 12 edits, 80 visits, 222 rates: ${reads} simulated reads; ${catalogReads.length} rate-table queries.`);
  await workflow.onRateWrite(lastEvent);
  await drain(db, workflow);
  assert.equal([...db.records.values()].filter(v => v.kind === 'page').length, pages.length);
});

test('date-scoped rate pages include independently assigned tasks and exclude other companies', async () => {
  const { db, workflow } = fixture();
  for (let i = 0; i < 43; i++) db.set(`${companyPath}/serviceStops/dated-${String(i).padStart(2, '0')}`, {
    operationStatus: 'Finished', techId: 'a', typeId: 'filter', serviceDate: new Date('2026-10-24'), payrollLastProcessedAt: new Date(),
  });
  db.set(`${companyPath}/serviceStops/older`, { operationStatus: 'Finished', techId: 'a', typeId: 'filter', serviceDate: new Date('2026-10-01'), payrollLastProcessedAt: new Date() });
  db.set(`${companyPath}/serviceStops/other-worker`, { operationStatus: 'Finished', techId: 'b', typeId: 'filter', serviceDate: new Date('2026-10-24'), payrollLastProcessedAt: new Date() });
  db.set(`${companyPath}/serviceStops/independent`, { operationStatus: 'Finished', techId: 'b', serviceDate: new Date('2026-10-24'), payrollLastProcessedAt: new Date() });
  db.set(`${companyPath}/serviceStops/independent/tasks/task`, { status: 'Finished', workerId: 'a', payTypeId: 'filter' });
  db.set(`${companyPath}/serviceStops/legacy-worker`, { operationStatus: 'Finished', technicianId: 'a', typeId: 'filter', serviceDate: new Date('2026-10-24'), payrollLastProcessedAt: new Date() });
  db.set('companies/another-company/serviceStops/foreign/tasks/task', { workerId: 'a', status: 'Finished', payTypeId: 'filter' });
  const ratePath = `${companyPath}/technicianRates/a`, before = db.records.get(ratePath);
  db.set(ratePath, { amountCents: 6000, effectiveStartDate: new Date('2026-10-24'), effectiveEndDate: new Date('2026-10-25') }, { merge: true });
  // This is a newly introduced dated rate. An edit to an existing undated rate
  // must also include the old interval, as its historical results can change.
  await workflow.onRateWrite(event(db, ratePath, null, { companyId: 'company', rateId: 'a' }, 'dated-rate'));
  await drain(db, workflow);
  assert.equal(db.records.get(`${companyPath}/serviceStops/dated-42`).estimatedPayCents, 6000);
  assert.equal(db.records.get(`${companyPath}/serviceStops/older`).estimatedPayCents, undefined);
  assert.equal(db.records.get(`${companyPath}/serviceStops/other-worker`).estimatedPayCents, undefined);
  assert.equal(active(db).find(line => line.serviceStopId === 'independent' && line.technicianId === 'a').totalAmountCents, 6000);
  assert.equal(db.records.get(`${companyPath}/serviceStops/legacy-worker`).estimatedPayCents, 6000);
  assert.equal(db.readLog.some(read => read.document && read.path.startsWith('companies/another-company/')), false);
  assert.equal(db.records.get(ratePath).amountCents, 6000);
  assert.equal(before.amountCents, 5000);
});

test('changes arriving during a refresh are applied in one follow-up run', async () => {
  const { db, workflow } = fixture();
  await workflow.reconcileStop('company', 'stop');
  await workflow.onSettingsWrite(event(db, `${companyPath}/paySettings/main`, null, { companyId: 'company' }, 'first'));
  await workflow.processRefresh(event(db, `${companyPath}/payrollReconcileWork/pending_refresh`, null, { companyId: 'company' }));
  const ratePath = `${companyPath}/technicianRates/a`, before = db.records.get(ratePath);
  db.set(ratePath, { amountCents: 9000 }, { merge: true });
  await workflow.onRateWrite(event(db, ratePath, before, { companyId: 'company', rateId: 'a' }, 'during-run'));
  await workflow.onRateWrite(event(db, ratePath, before, { companyId: 'company', rateId: 'a' }, 'during-run-2'));
  await drain(db, workflow);
  assert.equal(new Set([...db.records.values()].filter(v => v.kind === 'page').map(v => v.runId)).size, 2);
  assert.equal(active(db)[0].totalAmountCents, 9000);
  assert.equal(db.records.get(`${companyPath}/payrollReconcileWork/pending_refresh`).activeRunId, null);
});

test('a dated rate change also repairs eligible legacy visits with no service date', async () => {
  const { db, workflow } = fixture();
  const { serviceDate, ...undated } = db.records.get(stopPath);
  db.set(stopPath, { ...undated, payrollLastProcessedAt: new Date() });
  const ratePath = `${companyPath}/technicianRates/a`;
  db.set(ratePath, { amountCents: 6000, effectiveStartDate: new Date('2020-01-01') }, { merge: true });
  await workflow.onRateWrite(event(db, ratePath, null, { companyId: 'company', rateId: 'a' }, 'undated-visit'));
  await drain(db, workflow);
  assert.equal(active(db)[0].totalAmountCents, 6000);
});

test('bulk completion events share payroll processing and unchanged retries emit no payroll writes', async () => {
  const { db, workflow } = fixture();
  const before = db.records.get(stopPath);
  db.set(stopPath, { manualFinishSource: 'payroll_setup_bulk_finish', duration: 45 }, { merge: true });
  db.set(`${stopPath}/tasks/task`, { manualFinishSource: 'payroll_setup_bulk_finish' }, { merge: true });
  await workflow.onStopWrite(event(db, stopPath, before, { companyId: 'company', serviceStopId: 'stop' }, 'bulk-stop'));
  await workflow.onStopTaskWrite(event(db, `${stopPath}/tasks/task`, { status: 'Scheduled' }, { companyId: 'company', serviceStopId: 'stop' }, 'bulk-task'));
  assert.equal(active(db).length, 0);
  await drain(db, workflow);
  assert.equal(active(db).length, 1);
  assert.equal(new Set([...db.records.values()].filter(v => v.kind === 'page').map(v => v.runId)).size, 1);
  const version = db.version;
  await workflow.reconcileStop('company', 'stop');
  assert.equal(db.version, version);
});

test('cached catalogs cannot override a payroll disable switch', async () => {
  const { db, workflow } = fixture();
  db.set(`${companyPath}/settings/companyWide`, { payrollEnabled: false });
  await workflow.reconcileStop('company', 'stop', { loadBatchContext: async () => ({
    settings: { payrollEnabled: true }, workTypes: [], stopTypes: new Map(), rates: [], workers: [],
  }) });
  assert.equal(active(db).length, 0);
  assert.equal(db.records.get(stopPath).payrollReconcileStatus, 'disabled');
});


test("visit reassignment preserves the workers who already performed completed tasks", async () => {
  const jobPath = `${companyPath}/workOrders/job`, jobTaskPath = `${jobPath}/tasks/task`;
  const { db, workflow } = fixture({ [jobPath]: {}, [jobTaskPath]: { serviceStopId: { id: "stop" }, workerId: "a" },
    [`${stopPath}/tasks/task`]: { status: "Finished", workerId: "a", payTypeId: "filter", jobTaskId: "task" },
    [`${stopPath}/tasks/separate`]: { status: "Finished", workerId: "a", workerAssignmentMode: "task", payTypeId: "filter", jobTaskId: "separate" } });
  await workflow.reconcileStop("company", "stop");
  const before = db.records.get(stopPath); db.set(stopPath, { techId: "b", tech: "Blair" }, { merge: true });
  await workflow.onStopWrite(event(db, stopPath, before, { companyId: "company", serviceStopId: "stop" }));
  assert.equal(db.records.get(`${stopPath}/tasks/task`).workerId, "a"); assert.equal(db.records.get(jobTaskPath).workerId, "a");
  assert.equal(db.records.get(`${stopPath}/tasks/separate`).workerId, "a");
  assert.deepEqual(active(db).map((line) => [line.technicianId, line.totalAmountCents]).sort(), [["a", 5000], ["a", 5000], ["b", 8000]]);
});


test("a job task assigned independently remains with its technician during later visit changes", async () => {
  const taskPath = `${companyPath}/workOrders/job/tasks/task`;
  const before = { status: "Finished", serviceStopId: { id: "stop" }, workerId: "a", payTypeId: "filter", workerAssignmentMode: "stop" };
  const { db, workflow } = fixture({ [`${companyPath}/workOrders/job`]: {}, [taskPath]: { ...before, workerId: "b" } });
  await workflow.onJobTaskWrite(event(db, taskPath, before, { companyId: "company", jobId: "job", taskId: "task" }));
  assert.equal(db.records.get(`${stopPath}/tasks/task`).workerAssignmentMode, "task");
  const oldStop = db.records.get(stopPath); db.set(stopPath, { techId: "c" }, { merge: true });
  await workflow.onStopWrite(event(db, stopPath, oldStop, { companyId: "company", serviceStopId: "stop" }));
  assert.equal(db.records.get(`${stopPath}/tasks/task`).workerId, "b"); assert.equal(db.records.get(taskPath).workerId, "b");
});


test("out-of-order visit assignment events converge on the current technician", async () => {
  const { db, workflow } = fixture({ [`${stopPath}/tasks/task`]: { status: "Draft", workerId: "a", payTypeId: "filter", jobTaskId: "task" },
    [`${companyPath}/technicianRates/c`]: { technicianId: "c", payTypeId: "filter", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents: 9000 } });
  const a = db.records.get(stopPath); db.set(stopPath, { techId: "b" }, { merge: true });
  const first = event(db, stopPath, a, { companyId: "company", serviceStopId: "stop" });
  const b = db.records.get(stopPath); db.set(stopPath, { techId: "c" }, { merge: true });
  const second = event(db, stopPath, b, { companyId: "company", serviceStopId: "stop" });
  await workflow.onStopWrite(second); await workflow.onStopWrite(first);
  assert.equal(db.records.get(`${stopPath}/tasks/task`).workerId, "c");
  db.set(`${stopPath}/tasks/task`, { status: "Finished" }, { merge: true });
  await workflow.reconcileStop("company", "stop");
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].totalAmountCents, 9000);
});
