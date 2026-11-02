const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");
const { createPayrollStatements } = require("./payrollStatements");

const company = "companies/company", pay = `${company}/technicianPayLineItems/`, settings = `${company}/settings/payStatements`;
const start = Date.UTC(2026, 9, 1), end = Date.UTC(2026, 10, 1);
const row = (extra = {}) => ({ companyId: "company", technicianId: "tech", technicianName: "Alex", totalAmountCents: 5000,
  calculationStatus: "approved", completedDate: new Date(start), ...extra });
const request = (extra = {}, uid = "owner") => ({ auth: uid ? { uid } : null,
  data: { companyId: "company", startDateMillis: start, endDateExclusiveMillis: end, ...extra } });
const creation = (extra = {}, uid = "owner") => request({ technicianId: "tech", lineItemIds: ["one"], requestId: "request-1", expectedTotalCents: 5000, expectedLineAmountsCents: [5000], ...extra }, uid);
const fixture = (extra = {}) => {
  const db = new MemoryFirestore({ [company]: { ownerId: "owner" }, ...extra });
  return { db, ...createPayrollStatements(db) };
};
const summaryState = lines => ({
  technicianIds: [...new Set(lines.map(line => line.technicianId).filter(Boolean))],
  serviceStopIds: [...new Set(lines.map(line => line.serviceStopId).filter(Boolean))],
  totalAmountCents: lines.reduce((sum, line) => sum + Number(line.totalAmountCents), 0),
});

test("previews collect every eligible approved item beyond the first page and only record completion at the end", async () => {
  const { db, preview } = fixture(Object.fromEntries(Array.from({ length: 405 }, (_, i) => [pay + String(i).padStart(4, "0"), row({
    technicianId: i % 2 ? "other" : "tech", serviceStopId: `stop-${Math.floor(i / 3)}`, totalAmountCents: i === 404 ? -500 : 5000,
  })])));
  const first = await preview(request());
  assert.equal(first.lineItems.length, 200); assert.equal(first.generatedAtMillis, null);
  assert.equal(db.records.has(settings), false);
  let cursor = first.nextCursor, items = [...first.lineItems], final;
  while (cursor) {
    final = await preview(request({ cursor, summaryBeforePage: summaryState(items) })); items.push(...final.lineItems); cursor = final.nextCursor;
  }
  assert.equal(items.length, 405); assert.equal(new Set(items.map(item => item.id)).size, 405);
  assert.equal(items[0].completedDate, start);
  assert.equal(final.generatedAtMillis, db.records.get(settings).lastPreviewGeneratedAt.getTime());
  assert.equal(db.records.get(settings).lastPreviewStartDate.getTime(), start);
  assert.equal(db.records.get(settings).increment, 0);
  assert.equal(db.records.get(settings).category, "payStatements");
  assert.equal(db.records.get(settings).lastPreviewEndDateExclusive.getTime(), end);
  assert.deepEqual(final.summary, { technicianCount: 2, totalAmountCents: 2019500, stopCount: 135 });
  assert.deepEqual(db.records.get(settings).lastPreviewSummary, final.summary);
  assert.equal([...db.records.keys()].some(path => path.includes("/technicianPayStatements/")), false);
  assert.ok([...db.records].filter(([path]) => path.startsWith(pay)).every(([, line]) => !line.payStatementId));
});

test("recording preview history preserves the shared web/iOS statement counter", async () => {
  const { db, preview } = fixture({ [settings]: { category: "payStatements", increment: 37 } });
  await preview(request());
  assert.equal(db.records.get(settings).increment, 37);
  assert.equal(db.records.get(settings).category, "payStatements");
  assert.deepEqual(db.records.get(settings).lastPreviewSummary, { technicianCount: 0, totalAmountCents: 0, stopCount: 0 });
});

test("preview eligibility protects paid, exported, statement-linked, invalid, and zero items while retaining deductions", async () => {
  const changes = [{ paidAt: new Date() }, { payStatementId: "existing" }, { exportBatchId: "export" }, { voidedAt: new Date() },
    { calculationStatus: "needsReview" }, { calculationStatus: "adjusted" }, { totalAmountCents: 0 },
    { totalAmountCents: null }, { totalAmountCents: "bad" }, { technicianId: "" }, { companyId: "foreign" }];
  const { preview } = fixture({ [pay + "positive"]: row(), [pay + "deduction"]: row({ totalAmountCents: -500 }),
    ...Object.fromEntries(changes.map((change, i) => [pay + i, row(change)])) });
  const result = await preview(request());
  assert.deepEqual(result.lineItems.map(item => item.id), ["deduction", "positive"]);
  assert.equal(result.skippedCount, 9);
  assert.deepEqual(result.summary, { technicianCount: 1, totalAmountCents: 4500, stopCount: 0 });
});

test("an older paged client does not replace the saved summary with final-page-only totals", async () => {
  const { db, preview } = fixture({ [pay + "one"]: row(), [settings]: {
    increment: 2, lastPreviewSummary: { technicianCount: 5, totalAmountCents: 10000, stopCount: 6 },
  } });
  const result = await preview(request({ cursor: { id: "before-one", seconds: start / 1000, nanoseconds: 0 } }));
  assert.equal(result.summary, null);
  assert.equal(db.records.get(settings).lastPreviewSummary, null);
});

test("dates, company, technician, and nanosecond cursors bound preview scope", async () => {
  const lastNanosecond = new Timestamp(end / 1000 - 1, 999999999);
  const { preview } = fixture({ [pay + "first"]: row(), [pay + "last"]: row({ completedDate: lastNanosecond }),
    [pay + "before"]: row({ completedDate: new Date(start - 1) }), [pay + "after"]: row({ completedDate: new Date(end) }),
    [pay + "other-tech"]: row({ technicianId: "other" }), "companies/other/technicianPayLineItems/foreign": row() });
  const result = await preview(request({ technicianId: "tech" }));
  assert.deepEqual(result.lineItems.map(item => item.id), ["first", "last"]);
  const empty = await preview(request({ technicianId: "tech", cursor: { id: "last", seconds: lastNanosecond.seconds, nanoseconds: lastNanosecond.nanoseconds } }));
  assert.equal(empty.lineItems.length, 0);
});

test("active owners and payroll managers generate; readers, inactive members, and outsiders cannot", async () => {
  for (const member of [{ roleName: "Owner" }, { roleName: "Admin" }, { roleName: "Manager" }, { roleId: "finance" }]) {
    const { preview, create } = fixture({ [pay + "one"]: row(), "users/staff/userAccess/company": member,
      [`${company}/roles/finance`]: { permissionIdList: [424] } });
    await preview(request({}, "staff")); await create(creation({}, "staff"));
  }
  for (const member of [null, { roleId: "reader" }, { roleName: "Manager", active: false }, { roleName: "Admin", status: "revoked" }]) {
    const { preview, create } = fixture({ [pay + "one"]: row(), ...(member ? { "users/staff/userAccess/company": member } : {}),
      [`${company}/roles/reader`]: { permissionIdList: [420] } });
    await assert.rejects(preview(request({}, "staff")), error => error.code === "permission-denied");
    await assert.rejects(create(creation({}, "staff")), error => error.code === "permission-denied");
  }
  await assert.rejects(fixture().preview(request({}, null)), error => error.code === "unauthenticated");
});

test("invalid scopes, cursors, creation requests, and excessive statement parts are rejected before writing", async () => {
  const { db, preview, create } = fixture({ [pay + "one"]: row() });
  for (const extra of [{ companyId: "../company" }, { startDateMillis: end }, { startDateMillis: "date" },
    { technicianId: "../tech" }, { cursor: { id: "one", seconds: end / 1000, nanoseconds: 0 } },
    { cursor: { id: "one", seconds: start / 1000, nanoseconds: -1 } },
    { summaryBeforePage: { technicianIds: [], serviceStopIds: [], totalAmountCents: 0 } },
    { cursor: { id: "one", seconds: start / 1000, nanoseconds: 0 }, summaryBeforePage: { technicianIds: ["../tech"], serviceStopIds: [], totalAmountCents: 0 } },
    { cursor: { id: "one", seconds: start / 1000, nanoseconds: 0 }, summaryBeforePage: { technicianIds: [], serviceStopIds: [], totalAmountCents: "bad" } }]) {
    await assert.rejects(preview(request(extra)), error => error.code === "invalid-argument");
  }
  for (const extra of [{ requestId: "../bad" }, { lineItemIds: [] }, { lineItemIds: ["one", "one"] },
    { lineItemIds: ["../one"] }, { technicianId: "" }, { expectedTotalCents: "5000" },
    { lineItemIds: Array.from({ length: 401 }, (_, i) => String(i)) }]) {
    await assert.rejects(create(creation(extra)), error => error.code === "invalid-argument");
  }
  assert.equal(db.records.has(settings), false); assert.equal(db.records.get(pay + "one").payStatementId, undefined);
});

test("creation rechecks current pay, numbers the statement, preserves preview dates, and retries idempotently", async () => {
  const previewDate = new Date(start + 1000);
  const { db, create } = fixture({ [pay + "one"]: row(), [settings]: { increment: 12, lastPreviewGeneratedAt: previewDate } });
  const first = await create(creation());
  assert.equal(first.statement.statementReference, "PS-000013"); assert.equal(first.statement.totalCents, 5000);
  assert.equal(db.records.get(pay + "one").payStatementId, first.statement.id);
  const audit = db.records.get(settings);
  assert.deepEqual(audit.lastPreviewGeneratedAt, previewDate);
  assert.equal(audit.lastStatementsGeneratedAt.getTime(), first.statement.createdAt);
  const retry = await create(creation());
  assert.equal(retry.alreadyCreated, true); assert.deepEqual(retry.statement, first.statement);
  assert.deepEqual(db.records.get(settings), audit);
  await assert.rejects(create(creation({ expectedTotalCents: 100 })), error => error.code === "already-exists");
});

test("stale, foreign, paid, exported, and changed-amount previews cannot create partial statements", async () => {
  for (const change of [{ paidAt: new Date() }, { payStatementId: "other" }, { exportBatchId: "export" },
    { calculationStatus: "calculated" }, { totalAmountCents: 0 }, { totalAmountCents: 8000 },
    { technicianId: "other" }, { companyId: "other" }, { completedDate: new Date(end) }]) {
    const { db, create } = fixture({ [pay + "one"]: row(), [pay + "two"]: row(change) });
    await assert.rejects(create(creation({ lineItemIds: ["one", "two"], expectedLineAmountsCents: [5000, 5000], expectedTotalCents: 10000 })), error => error.code === "failed-precondition");
    assert.equal(db.records.get(pay + "one").payStatementId, undefined); assert.equal(db.records.has(settings), false);
  }
});

test("offsetting amount changes cannot silently reuse a stale preview with the same total", async () => {
  const { db, create } = fixture({ [pay + "one"]: row({ totalAmountCents: 6000 }), [pay + "two"]: row({ totalAmountCents: 4000 }) });
  await assert.rejects(create(creation({ lineItemIds: ["one", "two"], expectedLineAmountsCents: [5000, 5000], expectedTotalCents: 10000 })), error => error.code === "failed-precondition");
  assert.equal(db.records.has(settings), false);
});

test("concurrent overlapping requests can attach a pay item only once", async () => {
  const { db, create } = fixture({ [pay + "one"]: row() });
  const results = await Promise.allSettled([create(creation()), create(creation({ requestId: "request-2" }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(db.records.get(settings).increment, 1);
  assert.equal([...db.records.keys()].filter(path => path.includes("/technicianPayStatements/")).length, 1);
});

test("a failed transaction leaves pay items, statement numbering, and generation dates intact", async () => {
  const { db, create } = fixture({ [pay + "one"]: row(), [settings]: { increment: 5 } });
  db.commitError = new Error("offline");
  await assert.rejects(create(creation()), /offline/);
  assert.deepEqual(db.records.get(settings), { increment: 5 }); assert.equal(db.records.get(pay + "one").payStatementId, undefined);
  db.commitError = null;
  const result = await create(creation()); assert.equal(result.statement.statementNumber, 6);
});

test("a concurrently changed pay item is revalidated on transaction retry", async () => {
  const { db, create } = fixture({ [pay + "one"]: row() });
  db.beforeCommit = () => db.set(pay + "one", { paidAt: new Date() }, { merge: true });
  await assert.rejects(create(creation()), error => error.code === "failed-precondition");
  assert.equal(db.records.has(settings), false);
});

test("a full 400-item statement includes every earning and deduction within one atomic write", async () => {
  const records = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [pay + i, row({ totalAmountCents: i === 399 ? -500 : 5000 })]));
  const { db, create } = fixture(records);
  const result = await create(creation({ lineItemIds: Object.keys(records).map(path => path.slice(pay.length)),
    expectedLineAmountsCents: Object.values(records).map(line => line.totalAmountCents), expectedTotalCents: 399 * 5000 - 500 }));
  assert.equal(result.statement.lineItemIds.length, 400);
  assert.ok(Object.keys(records).every(path => db.records.get(path).payStatementId === result.statement.id));
});
