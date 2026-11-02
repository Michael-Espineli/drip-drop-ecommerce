const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { createPayrollWorkflow } = require('./payrollWorkflow');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const app = enabled ? admin.initializeApp({ projectId: 'demo-payroll-readfix' }, 'payroll-readfix-test') : null;
const db = app?.firestore();
after(async () => { if (app) await app.delete(); });

test('real Firestore queries preserve date cursors and independently assigned task scope', { skip: !enabled }, async () => {
  const companyId = 'test-' + Date.now(), company = db.collection('companies').doc(companyId);
  const foreign = db.collection('companies').doc(companyId + '-other');
  const at = new Date('2026-10-24'), marker = new Date('2026-10-25');
  const batch = db.batch();
  batch.set(company.collection('paySettings').doc('main'), { taskPaySource: 'technicianRate', routePaySource: 'completedTasks' });
  batch.set(company.collection('companyPayTypes').doc('filter'), { name: 'Filter', isActive: true });
  batch.set(company.collection('technicianRates').doc('rate'), { technicianId: 'a', payTypeId: 'filter', payBasis: 'serviceStopTask',
    rateType: 'flatPerTask', amountCents: 6000, status: 'active', effectiveStartDate: at });
  for (let i = 0; i < 43; i++) {
    const stop = company.collection('serviceStops').doc('visit-' + String(i).padStart(2, '0'));
    batch.set(stop, { operationStatus: 'Finished', techId: 'a', serviceDate: at, payrollLastProcessedAt: marker });
    batch.set(stop.collection('tasks').doc('task'), { status: 'Finished', workerId: 'a', payTypeId: 'filter' });
  }
  const independent = company.collection('serviceStops').doc('independent');
  batch.set(independent, { operationStatus: 'Finished', techId: 'b', serviceDate: at, payrollLastProcessedAt: marker });
  batch.set(independent.collection('tasks').doc('task'), { status: 'Finished', workerId: 'a', payTypeId: 'filter' });
  batch.set(foreign.collection('serviceStops').doc('visit'), { operationStatus: 'Finished', techId: 'b', serviceDate: at, payrollLastProcessedAt: marker });
  batch.set(foreign.collection('serviceStops').doc('visit').collection('tasks').doc('task'), { status: 'Finished', workerId: 'a', payTypeId: 'filter' });
  await batch.commit();
  const workflow = createPayrollWorkflow(db, { debounceMs: 0 });
  const event = async ref => ({ id: ref.id, params: { companyId }, data: { after: await ref.get() } });
  await workflow.onRateWrite({ ...await event(company.collection('technicianRates').doc('rate')), data: {
    before: { exists: false, data: () => undefined }, after: await company.collection('technicianRates').doc('rate').get(),
  } });
  for (let i = 0; i < 20; i++) {
    const control = company.collection('payrollReconcileWork').doc('pending_refresh');
    const state = (await control.get()).data();
    if (!state.activeRunId && state.pendingScopes.length) await workflow.processRefresh(await event(control));
    const page = await company.collection('payrollReconcileWork').where('status', '==', 'queued').limit(1).get();
    if (page.empty) break;
    await workflow.processRefresh(await event(page.docs[0].ref));
  }
  const earnings = await company.collection('technicianPayLineItems').get();
  assert.equal(earnings.size, 44);
  assert.ok(earnings.docs.every(row => row.data().totalAmountCents === 6000));
  assert.equal((await company.collection('serviceStops').doc('visit-42').get()).data().payrollReconcileStatus, 'current');
  assert.equal((await foreign.collection('serviceStops').doc('visit').get()).data().payrollReconcileStatus, undefined);
  assert.equal((await company.collection('payrollReconcileWork').doc('pending_refresh').get()).data().activeRunId, null);
});
