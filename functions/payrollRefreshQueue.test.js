const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayrollRefreshQueue, rateScopes } = require('./payrollRefreshQueue');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');

const companyId = 'company', root = 'companies/company/payrollReconcileWork/';
const makeEvent = (db, path, saved) => ({ params: { companyId }, data: { after: saved || db.read(db.doc(path)) } });

test('closing a superseded rate refreshes only its changed effective interval', () => {
  const before = { technicianId: 'a', amountCents: 5000, payBasis: 'serviceStop', status: 'active', effectiveStartDate: new Date('2025-01-01') };
  const after = { ...before, status: 'expired', effectiveEndDate: new Date('2026-10-28T23:59:59.999Z') };
  assert.deepEqual(rateScopes(before, after), [{ kind: 'rate', technicianId: 'a', fromMillis: Date.parse('2026-10-29'), toMillis: null }]);
  assert.deepEqual(rateScopes(null, { ...before, technicianId: 'base_technician_default' }), []);
  assert.deepEqual(rateScopes(null, { ...before, status: 'draft' }), []);
});

test('the debounce collects separate changes and concurrent deliveries start one run', async () => {
  const db = new MemoryFirestore({});
  let clock = Date.parse('2026-10-29'), waits = 0;
  const queue = createPayrollRefreshQueue(db, {}, { now: () => new Date(clock), wait: async ms => { waits++; clock += ms; } });
  await queue.enqueue(companyId, 'one', [{ kind: 'rate', technicianId: 'a', fromMillis: null, toMillis: null }]);
  await queue.enqueue(companyId, 'two', [{ kind: 'rate', technicianId: 'b', fromMillis: null, toMillis: null }]);
  await Promise.all([queue.process(makeEvent(db, root + 'pending_refresh')), queue.process(makeEvent(db, root + 'pending_refresh'))]);
  const pages = [...db.records.values()].filter(v => v.kind === 'page');
  assert.equal(waits, 1);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].scopes.map(s => s.technicianId).sort(), ['a', 'b']);
});

test('partial failure retries with backoff, and a crashed page recovers after its lease', async () => {
  const db = new MemoryFirestore({});
  let clock = Date.parse('2026-10-29'), fail = true, calls = 0;
  const queue = createPayrollRefreshQueue(db, { loadContext: async () => ({}), reconcileStop: async () => {
    calls++;
    if (fail) throw new Error('transient');
  } }, { debounceMs: 0, now: () => new Date(clock) });
  await queue.enqueue(companyId, 'bulk', [{ kind: 'stop', stopId: 'a' }]);
  await queue.process(makeEvent(db, root + 'pending_refresh'));
  const [path] = [...db.records].find(([, v]) => v.kind === 'page');
  const queued = makeEvent(db, path);
  await assert.rejects(queue.process(queued), /transient/);
  assert.equal(db.records.get(path).status, 'processing');
  assert.equal(db.records.get(path).leaseUntil.getTime(), 0);
  fail = false;
  // Simulate a process dying after acquiring a lease, without running its catch.
  db.set(path, { leaseUntil: new Date(clock + 600000), leaseId: 'dead-process' }, { merge: true });
  await assert.rejects(queue.process(queued), /already processing/);
  assert.equal(calls, 1);
  clock += 600001;
  await queue.process(queued);
  await queue.process(queued);
  assert.equal(calls, 2);
  assert.equal(db.records.get(path).status, 'completed');
});

test('queued pages from the old implementation migrate to one shared refresh', async () => {
  const db = new MemoryFirestore({});
  const queue = createPayrollRefreshQueue(db, {}, { debounceMs: 0 });
  for (const id of ['old-1', 'old-2']) {
    const path = root + id;
    db.set(path, { status: 'queued', phase: 'serviceStops', requestId: id });
    await queue.process(makeEvent(db, path));
    assert.equal(db.records.get(path).status, 'superseded');
  }
  await queue.process(makeEvent(db, root + 'pending_refresh'));
  assert.equal([...db.records.values()].filter(v => v.kind === 'page').length, 1);
});
