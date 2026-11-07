const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { createPayrollWorkflow } = require('./payrollWorkflow');
const { createTechnicianPayRequests } = require('./technicianPayRequests');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (enabled && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8199') throw new Error('Use the isolated payroll-zero emulator on port 8199.');
const app = enabled ? admin.initializeApp({ projectId: 'demo-payroll-zero-generation' }, 'zero-generation-tests') : null;
const db = app?.firestore();
after(async () => { if (app) await app.delete(); });
const at = new Date('2026-11-05T12:00:00Z');

async function fixture(suffix, withRate = true) {
  const companyId = `zero-${suffix}-${Date.now()}`;
  const company = db.collection('companies').doc(companyId);
  const batch = db.batch();
  batch.set(company, { ownerId: 'owner' });
  batch.set(company.collection('paySettings').doc('main'), { routePaySource: 'serviceStopAndCompletedTasks', taskPaySource: 'technicianRate' });
  batch.set(company.collection('companyPayTypes').doc('visit'), { name: 'Pool service', category: 'route', defaultRateType: 'flatPerStop', isActive: true });
  batch.set(company.collection('companyUsers').doc('tech'), { userId: 'tech', userName: 'Sample tech', workerType: 'Employee' });
  batch.set(company.collection('roles').doc('tech'), { permissionIdList: [] });
  batch.set(db.doc(`users/tech/userAccess/${companyId}`), { roleId: 'tech', status: 'Active' });
  const stop = company.collection('serviceStops').doc('stop');
  batch.set(stop, { operationStatus: 'Finished', techId: 'tech', payTypeId: 'visit', serviceDate: at });
  batch.set(stop.collection('tasks').doc('included'), { status: 'Finished', name: 'Included checklist', payrollMode: 'included', contractedRate: 0 });
  batch.set(stop.collection('tasks').doc('zero-extra'), { status: 'Finished', name: 'Explicit zero extra', payrollMode: 'custom', manualPayOverrideCents: 0, payrollStackBehavior: 'stackable' });
  if (withRate) batch.set(company.collection('technicianRates').doc('visit'), { technicianId: 'tech', payTypeId: 'visit', payBasis: 'serviceStop', rateType: 'flatPerStop', amountCents: 5000, status: 'active', effectiveStartDate: new Date('2026-01-01') });
  await batch.commit();
  return { companyId, company, stop, payroll: createPayrollWorkflow(db, { debounceMs: 0 }) };
}

test('actual Firestore generation saves positive visit pay once and skips routine/custom zero tasks', { skip: !enabled }, async () => {
  const f = await fixture('positive');
  await f.payroll.reconcileStop(f.companyId, f.stop.id);
  await f.payroll.reconcileStop(f.companyId, f.stop.id);
  const lines = await f.company.collection('technicianPayLineItems').get();
  assert.equal(lines.size, 1);
  assert.equal(lines.docs[0].data().totalAmountCents, 5000);
  assert.equal(lines.docs[0].data().calculationStatus, 'calculated');
  assert.equal((await f.stop.get()).data().payrollReconcileStatus, 'current');
});

test('actual Firestore keeps unresolved rate review while explicit zero earnings create no ledger row', { skip: !enabled }, async () => {
  const review = await fixture('missing-rate', false);
  const result = await review.payroll.reconcileStop(review.companyId, review.stop.id);
  const issues = await review.company.collection('technicianPayLineItems').get();
  assert.equal(result.needsReviewCount, 1);
  assert.equal(issues.size, 1);
  assert.equal(issues.docs[0].data().calculationStatus, 'needsReview');
  assert.equal(issues.docs[0].data().totalAmountCents, 0);
  const zero = await fixture('custom-zero');
  await zero.stop.set({ payrollMode: 'custom', manualPayOverrideCents: 0 }, { merge: true });
  await zero.payroll.reconcileStop(zero.companyId, zero.stop.id);
  assert.equal((await zero.company.collection('technicianPayLineItems').get()).size, 0);
});

test('concurrent Firestore corrections reach one intended total without zero adjustments or rewrites of paid history', { skip: !enabled }, async () => {
  const f = await fixture('corrections');
  const original = f.company.collection('technicianPayLineItems').doc('original');
  await original.set({ technicianId: 'tech', totalAmountCents: 5000, calculationStatus: 'paid', paidAt: at });
  const commands = createTechnicianPayRequests(db, () => at);
  const create = async (id, total) => commands.command({ auth: { uid: 'tech' }, data: { companyId: f.companyId, action: 'create', clientRequestId: id, type: 'payCorrection', payLineItemId: 'original', amountCents: total, reason: 'Review total' } });
  const approve = request => commands.command({ auth: { uid: 'owner' }, data: { companyId: f.companyId, action: 'approve', requestId: request.requestId } });
  const unchanged = await create('unchanged', 5000);
  await approve(unchanged);
  assert.equal((await f.company.collection('technicianPayLineItems').get()).size, 1);
  const [first, second] = await Promise.all([create('first', 6000), create('second', 6000)]);
  await Promise.all([approve(first), approve(second)]);
  await approve(second);
  const decrease = await create('decrease', 5500);
  await approve(decrease);
  const lines = (await f.company.collection('technicianPayLineItems').get()).docs.map(doc => doc.data());
  assert.equal(lines.length, 3);
  assert.ok(lines.every(line => line.totalAmountCents !== 0));
  assert.equal(lines.reduce((sum, line) => sum + line.totalAmountCents, 0), 5500);
  assert.equal((await original.get()).data().totalAmountCents, 5000);
  assert.equal((await original.get()).data().calculationStatus, 'paid');
  for (const request of [unchanged, first, second, decrease]) assert.equal((await f.company.collection('payChangeRequests').doc(request.requestId).get()).data().status, 'Approved');
});
