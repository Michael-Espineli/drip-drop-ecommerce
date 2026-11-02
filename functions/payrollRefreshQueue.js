const { createHash, randomUUID } = require('node:crypto');

const COORDINATOR_ID = 'pending_refresh';
const PAGE_SIZE = 40;
const millis = value => {
  if (value == null || value === '') return null;
  const result = value?.toMillis?.() ?? new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
};
const companyScope = { kind: 'company' };

function mergeScopes(scopes) {
  const targets = [...new Map(scopes.filter(s => s.kind === 'stop').map(s => [s.stopId, s])).values()];
  if (scopes.some(s => s.kind === 'company')) return [companyScope, ...targets];
  return [...new Map(scopes.map(s => [JSON.stringify(s), s])).values()];
}

// Closing an old rate and creating its replacement should only refresh the
// changed interval, rather than the technician's entire historical schedule.
function rateScopes(before, after) {
  const eligible = r => r && r.technicianId && r.technicianId !== 'base_technician_default' &&
    !['draft', 'archived', 'inactive', 'deleted'].includes(String(r.status || '').toLowerCase());
  const window = r => ({ kind: 'rate', technicianId: r.technicianId,
    fromMillis: millis(r.effectiveStartDate), toMillis: millis(r.effectiveEndDate) });
  const terms = r => JSON.stringify([r?.technicianId, r?.payTypeId || r?.workTypeId || null,
    r?.amountCents, r?.rateType, r?.payBasis]);
  if (eligible(before) && eligible(after) && terms(before) === terms(after)) {
    const a = window(before), b = window(after);
    if (a.fromMillis === b.fromMillis && a.toMillis !== b.toMillis) {
      const ends = [a.toMillis ?? Infinity, b.toMillis ?? Infinity];
      return [{ ...a, fromMillis: Math.min(...ends) + 1, toMillis: Math.max(...ends) === Infinity ? null : Math.max(...ends) }];
    }
    if (a.toMillis === b.toMillis && a.fromMillis !== b.fromMillis) {
      const starts = [a.fromMillis ?? -Infinity, b.fromMillis ?? -Infinity];
      return [{ ...a, fromMillis: Math.min(...starts) === -Infinity ? null : Math.min(...starts), toMillis: Math.max(...starts) - 1 }];
    }
  }
  return mergeScopes([before, after].filter(eligible).map(window));
}

function matchesScopes(record, tasks, scopes) {
  if (!scopes?.length || scopes.some(s => s.kind === 'company' || s.kind === 'stop' && s.stopId === record?.id)) return true;
  const when = millis(record?.serviceDate);
  const workers = new Set([record?.techId, record?.technicianId, ...tasks.map(t => t.workerId)].filter(Boolean));
  return scopes.some(s => s.kind === 'rate' && workers.has(s.technicianId) &&
    (when === null || (s.fromMillis === null || when >= s.fromMillis) && (s.toMillis === null || when <= s.toMillis)));
}

function plansFor(scopes) {
  const plans = [];
  const targets = scopes.filter(s => s.kind === 'stop').map(s => s.stopId);
  for (let i = 0; i < targets.length; i += PAGE_SIZE) plans.push({ collection: 'targets', stopIds: targets.slice(i, i + PAGE_SIZE) });
  if (scopes.some(s => s.kind === 'company')) return [...plans, { collection: 'serviceStops' }, { collection: 'workOrders' }];
  const workers = new Map();
  for (const s of scopes.filter(s => s.kind === 'rate')) {
    const old = workers.get(s.technicianId);
    workers.set(s.technicianId, { technicianId: s.technicianId,
      fromMillis: old ? old.fromMillis === null || s.fromMillis === null ? null : Math.min(old.fromMillis, s.fromMillis) : s.fromMillis,
      toMillis: old ? old.toMillis === null || s.toMillis === null ? null : Math.max(old.toMillis, s.toMillis) : s.toMillis });
  }
  for (const worker of workers.values()) {
    plans.push({ collection: 'serviceStops', ...worker });
    // Older visits can use technicianId or have no service date. Keep those
    // records eligible without widening the normal dated query to all workers.
    plans.push({ collection: 'serviceStops', technicianId: worker.technicianId, workerField: 'technicianId' });
    if (worker.fromMillis != null || worker.toMillis != null) {
      plans.push({ collection: 'serviceStops', technicianId: worker.technicianId, missingDateOnly: true });
    }
    // Independently assigned tasks can belong to another technician's visit.
    plans.push({ collection: 'tasks', technicianId: worker.technicianId });
  }
  return plans;
}

function createPayrollRefreshQueue(db, handlers, options = {}) {
  const now = options.now || (() => new Date());
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const debounceMs = options.debounceMs ?? 10000;
  const company = companyId => db.collection('companies').doc(companyId);
  const coordinator = companyId => company(companyId).collection('payrollReconcileWork').doc(COORDINATOR_ID);
  async function enqueue(companyId, eventId, scopes) {
    if (!scopes.length) return;
    const control = coordinator(companyId);
    const receipt = company(companyId).collection('payrollReconcileWork').doc('event_' + createHash('sha256').update(eventId).digest('hex'));
    await db.runTransaction(async t => {
      const [seen, state] = await Promise.all([t.get(receipt), t.get(control)]);
      if (seen.exists) return;
      const old = state.data() || {}, pending = old.pendingScopes || [];
      t.set(receipt, { kind: 'receipt', status: 'recorded', createdAt: now() });
      t.set(control, { kind: 'coordinator', pendingScopes: mergeScopes([...pending, ...scopes]),
        activeRunId: old.activeRunId || null, readyAt: pending.length ? old.readyAt : new Date(now().getTime() + debounceMs), updatedAt: now() }, { merge: true });
    });
  }
  function firstPage(companyId, scopes, runId) {
    return { kind: 'page', companyId, runId, page: 0, planIndex: 0, cursor: null,
      scopes, plans: plansFor(scopes), status: 'queued', createdAt: now() };
  }
  function pageRef(companyId, runId, page) {
    return company(companyId).collection('payrollReconcileWork').doc(`batch_${runId}_${page}`);
  }
  async function start(companyId) {
    const ref = coordinator(companyId), initial = (await ref.get()).data();
    if (!initial?.pendingScopes?.length || initial.activeRunId) return;
    const delay = Math.max(0, millis(initial.readyAt) - now().getTime());
    if (delay) await wait(delay);
    await db.runTransaction(async t => {
      const fresh = (await t.get(ref)).data();
      if (!fresh?.pendingScopes?.length || fresh.activeRunId) return;
      const runId = randomUUID(), scopes = fresh.pendingScopes;
      t.set(pageRef(companyId, runId, 0), firstPage(companyId, scopes, runId));
      t.set(ref, { pendingScopes: [], activeRunId: runId, updatedAt: now() }, { merge: true });
    });
  }
  function queryFor(companyId, plan, cursor) {
    const c = company(companyId);
    let query;
    if (plan.collection === 'tasks') {
      query = db.collectionGroup('tasks').where('workerId', '==', plan.technicianId)
        .where('__name__', '>=', c).where('__name__', '<', db.doc(`${c.path}/\uf8ff/\uf8ff`)).orderBy('__name__');
      if (cursor) query = query.startAfter(db.doc(cursor.path));
    } else {
      query = c.collection(plan.collection);
      if (plan.technicianId) query = query.where(plan.workerField || 'techId', '==', plan.technicianId);
      const byDate = plan.fromMillis != null || plan.toMillis != null;
      if (plan.fromMillis != null) query = query.where('serviceDate', '>=', new Date(plan.fromMillis));
      if (plan.toMillis != null) query = query.where('serviceDate', '<=', new Date(plan.toMillis));
      if (byDate) query = query.orderBy('serviceDate');
      query = query.orderBy('__name__');
      if (cursor) query = byDate ? query.startAfter(new Date(cursor.dateMillis), cursor.id) : query.startAfter(cursor.id);
    }
    return query.limit(PAGE_SIZE);
  }
  async function process(event) {
    if (!event.data?.after?.exists) return;
    const payload = event.data.after.data(), companyId = event.params.companyId;
    if (payload.kind === 'coordinator') return start(companyId);
    if (payload.status !== 'queued') return;
    const ref = event.data.after.ref;
    if (payload.kind !== 'page') {
      // Drain pre-upgrade queued pages through the shared coordinator, so a
      // deployment does not restart one company scan per legacy event.
      await enqueue(companyId, 'legacy:' + ref.id, [companyScope]);
      await ref.set({ status: 'superseded', finishedAt: now() }, { merge: true });
      return;
    }
    const leaseId = randomUUID();
    const work = await db.runTransaction(async t => {
      const snap = await t.get(ref), current = snap.data();
      if (!current || !['queued', 'processing'].includes(current.status)) return null;
      if (current.status === 'processing' && millis(current.leaseUntil) > now().getTime()) throw new Error('Payroll page is already processing; retry after its lease.');
      t.set(ref, { status: 'processing', leaseId, leaseUntil: new Date(now().getTime() + 600000) }, { merge: true });
      return current;
    });
    if (!work) return;
    try {
      const plan = work.plans[work.planIndex];
      const page = plan.collection === 'targets' ? null : await queryFor(companyId, plan, work.cursor).get();
      const targets = new Map();
      const add = (type, value) => { if (value) targets.set(type + ':' + value, { type, id: value }); };
      if (plan.collection === 'targets') plan.stopIds.forEach(value => add('stop', value));
      else for (const doc of page.docs) {
        if (plan.missingDateOnly && millis(doc.data().serviceDate) !== null) continue;
        if (plan.collection === 'tasks') {
          const parts = doc.ref.path.split('/');
          if (parts.length !== 6 || parts[0] !== 'companies' || parts[1] !== companyId) continue;
          if (parts[2] === 'serviceStops') add('stop', parts[3]);
          if (parts[2] === 'workOrders') {
            add('job', parts[3]);
            const linked = doc.data().serviceStopId;
            add('stop', typeof linked === 'object' ? linked?.id : linked);
          }
        } else add(plan.collection === 'serviceStops' ? 'stop' : 'job', doc.id);
      }
      let catalog;
      const loadBatchContext = () => catalog ||= handlers.loadContext(companyId);
      for (const target of targets.values()) {
        const explicit = target.type === 'stop' && work.scopes.some(s => s.kind === 'stop' && s.stopId === target.id);
        await handlers[target.type === 'stop' ? 'reconcileStop' : 'reconcileJob'](companyId, target.id,
          { ratesChanged: !explicit, scopes: explicit ? null : work.scopes, loadBatchContext });
      }
      const more = page?.size === PAGE_SIZE;
      const nextPlan = more ? work.planIndex : work.planIndex + 1;
      const last = page?.docs.at(-1);
      await db.runTransaction(async t => {
        const current = (await t.get(ref)).data();
        if (current?.status !== 'processing' || current.leaseId !== leaseId) throw new Error('Payroll page lease changed.');
        const controlRef = coordinator(companyId);
        const state = nextPlan >= work.plans.length ? (await t.get(controlRef)).data() : null;
        if (nextPlan < work.plans.length) t.set(pageRef(companyId, work.runId, work.page + 1), {
          ...work, page: work.page + 1, planIndex: nextPlan, status: 'queued', leaseId: null, leaseUntil: null, createdAt: now(),
          cursor: more ? { id: last.id, path: last.ref.path, dateMillis: millis(last.data().serviceDate) } : null,
        });
        else if (state?.activeRunId === work.runId) {
          // A change arriving during a run becomes one follow-up run. It cannot
          // be lost behind an already processed cursor or launch a parallel scan.
          t.set(controlRef, { activeRunId: null, updatedAt: now() }, { merge: true });
        }
        t.set(ref, { status: 'completed', leaseId: null, leaseUntil: null, finishedAt: now(), processedCount: targets.size }, { merge: true });
      });
    } catch (error) {
      await db.runTransaction(async t => {
        const fresh = (await t.get(ref)).data();
        // Let the original queued event retry with backoff. Writing "queued"
        // here would create an immediate trigger loop on a persistent error.
        if (fresh?.status === 'processing' && fresh.leaseId === leaseId) t.set(ref, { leaseId: null, leaseUntil: new Date(0) }, { merge: true });
      });
      throw error;
    }
  }
  return { enqueue, process };
}

module.exports = { createPayrollRefreshQueue, rateScopes, matchesScopes };
