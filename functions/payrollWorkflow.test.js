const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayrollWorkflow } = require('./payrollWorkflow');

class MemoryFirestore {
  constructor(records) { this.records = new Map(Object.entries(records)); this.version = 0; }
  doc(path) {
    return { path, id: path.split('/').pop(), collection: (name) => this.collection(`${path}/${name}`), get: async () => this.read({ path, document: true }),
      set: async (data, options) => this.set(path, data, options), document: true };
  }
  collection(path) {
    const query = (constraints = []) => ({ path, constraints, doc: (name) => this.doc(`${path}/${name}`),
      where: (field, operator, value) => query([...constraints, [field, value]]), orderBy: () => query(constraints),
      limit: (count) => query([...constraints, ["__limit", count]]), startAfter: (cursor) => query([...constraints, ["__cursor", cursor]]), get: async () => this.read({ path, constraints }) });
    return query();
  }
  read(ref, records = this.records) {
    if (ref.document) {
      const data = records.get(ref.path);
      return { exists: records.has(ref.path), id: ref.id || ref.path.split('/').pop(), ref: this.doc(ref.path), data: () => data };
    }
    const docs = [...records].filter(([path, data]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/') && (ref.constraints || []).every(([field, value]) => field === "__limit" || (field === "__cursor" ? path.split("/").pop() > value : data[field] === value)))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, ref.constraints?.find(([key]) => key === "__limit")?.[1] ?? Infinity)
      .map(([path]) => this.read(this.doc(path), records));
    return { docs, size: docs.length, empty: !docs.length };
  }
  set(path, data, options) {
    this.records.set(path, options?.merge ? { ...this.records.get(path), ...data } : { ...data }); this.version += 1;
  }
  async runTransaction(callback) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const version = this.version, records = new Map(this.records), writes = [];
      const transaction = {
        get: async (ref) => { assert.equal(writes.length, 0, 'transaction reads must precede writes'); return this.read(ref, records); },
        set: (ref, data, options) => writes.push({ ref, data, options }), delete: (ref) => writes.push({ ref, remove: true }),
      };
      const result = await callback(transaction);
      if (this.beforeCommit) { const hook = this.beforeCommit; this.beforeCommit = null; hook(); }
      if (version !== this.version) continue;
      if (this.commitError) throw this.commitError;
      writes.forEach(({ ref, data, options, remove }) => remove ? this.records.delete(ref.path) : this.set(ref.path, data, options));
      return result;
    }
    throw new Error('Transaction retry limit');
  }
}

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
  return { db, workflow: createPayrollWorkflow(db) };
}
const lines = (db) => [...db.records].filter(([path]) => path.startsWith(payPath)).map(([, value]) => value);
const active = (db) => lines(db).filter((line) => line.calculationStatus !== "voided");
const event = (db, path, before, params, eventId = "event") => ({ id: eventId, params,
  data: { before: { exists: Boolean(before), data: () => before, ref: db.doc(path) }, after: db.read(db.doc(path)) } });

test("normal stop completion uses the canonical catalog, deduplicates matching tasks, and retries idempotently", async () => {
  const { db, workflow } = fixture();
  const e = event(db, stopPath, { operationStatus: "In Progress" }, { companyId: "company", serviceStopId: "stop" });
  await workflow.onStopWrite(e); await workflow.onStopWrite(e);
  assert.equal(active(db).length, 1); assert.equal(active(db)[0].totalAmountCents, 5000);
  assert.equal(active(db)[0].payTypeName, "Filter clean");
  assert.equal(db.records.get(stopPath).estimatedPayCents, 5000);
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
  const workPath = `${companyPath}/payrollReconcileWork/refresh_0`;
  const request = event(db, workPath, null, { companyId: "company" });
  db.commitError = new Error("retry page"); await assert.rejects(workflow.processRefresh(request), /retry page/);
  assert.equal(db.records.get(workPath).status, "queued");
  db.commitError = null; await workflow.processRefresh(request); await workflow.processRefresh(request);
  assert.equal(db.records.get(workPath).status, "completed"); assert.equal(active(db)[0].totalAmountCents, 5000);
  assert.equal(db.records.get(stopPath).estimatedPayCents, 6000);
  const next = `${companyPath}/payrollReconcileWork/refresh_1`;
  await workflow.processRefresh(event(db, next, null, { companyId: "company" }));
  assert.equal(db.records.get(next).status, "completed");
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
  for (let index = 0; index < 3; index += 1) {
    const path = `${companyPath}/payrollReconcileWork/many_${index}`;
    await workflow.processRefresh(event(db, path, null, { companyId: "company" }));
    assert.equal(db.records.get(path).status, "completed");
  }
  assert.equal(db.records.get(`${companyPath}/serviceStops/stop-40`).estimatedPayCents, 5000);
  assert.equal(active(db).length, 42);
});


test("changing rates does not backfill previously unprocessed historical work", async () => {
  const { db, workflow } = fixture({ [`${companyPath}/workOrders/old-job`]: {}, [`${companyPath}/workOrders/old-job/tasks/old-task`]: { status: "Finished", workerId: "a", payTypeId: "filter" } });
  assert.equal((await workflow.reconcileStop("company", "stop", { ratesChanged: true })).skippedHistoricalWork, true);
  assert.equal((await workflow.reconcileJob("company", "old-job", { ratesChanged: true })).skippedHistoricalWork, true);
  assert.equal(lines(db).length, 0);
  await workflow.refreshRequestedStop({ auth: { uid: "owner" }, data: { companyId: "company", serviceStopId: "stop" } });
  assert.equal(active(db).length, 1);
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
