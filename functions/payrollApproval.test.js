const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");
const { createPayrollApproval } = require("./payrollApproval");

const company = "companies/company", pay = company + "/technicianPayLineItems/";
const start = Date.UTC(2026, 9, 1), end = Date.UTC(2026, 10, 1);
const row = extra => ({ companyId: "company", technicianId: "tech", source: "serviceStopTask", totalAmountCents: 5000,
  calculationStatus: "calculated", completedDate: new Date(start), ...extra });
const request = (extra = {}, uid = "owner") => ({ auth: uid ? { uid } : null,
  data: { companyId: "company", startDateMillis: start, endDateExclusiveMillis: end, ...extra } });
const fixture = extra => {
  const db = new MemoryFirestore({ [company]: { ownerId: "owner" }, ...extra });
  return { db, approve: createPayrollApproval(db).approveDateRange };
};

test("approval traverses more than two pages with tied completion dates and retains first approval on retries", async () => {
  const records = Object.fromEntries(Array.from({ length: 405 }, (_, i) => [pay + String(i).padStart(4, "0"), row()]));
  const { db, approve } = fixture(records);
  let cursor = null, approved = [], pages = 0;
  do {
    const result = await approve(request({ cursor }));
    approved.push(...result.approvedLineItemIds); cursor = result.nextCursor; pages += 1;
  } while (cursor);
  assert.equal(pages, 3); assert.equal(new Set(approved).size, 405);
  assert.equal(db.records.get(pay + "0404").approvedByUserId, "owner");
  const first = db.records.get(pay + "0000");
  const retry = await approve(request());
  assert.equal(retry.approvedLineItemIds.length, 0); assert.equal(retry.processedCount, 200);
  assert.deepEqual(db.records.get(pay + "0000"), first);
  assert.ok(db.readLog.filter(read => read.path === pay.slice(0, -1)).every(read => read.reads <= 200));
});

test("selected dates, technician, and company bound the approval scope", async () => {
  const { db, approve } = fixture({
    [pay + "start"]: row(), [pay + "last-millisecond"]: row({ completedDate: new Date(end - 1) }),
    [pay + "before"]: row({ completedDate: new Date(start - 1) }), [pay + "after"]: row({ completedDate: new Date(end) }),
    [pay + "other-tech"]: row({ technicianId: "other" }), [pay + "foreign-reference"]: row({ companyId: "foreign" }),
    ["companies/foreign/technicianPayLineItems/foreign"]: row({ companyId: "foreign" }),
  });
  const result = await approve(request({ technicianId: "tech" }));
  assert.deepEqual(result.approvedLineItemIds.sort(), ["last-millisecond", "start"]);
  for (const id of ["before", "after", "other-tech", "foreign-reference"]) assert.equal(db.records.get(pay + id).calculationStatus, "calculated");
  assert.equal(db.records.get("companies/foreign/technicianPayLineItems/foreign").calculationStatus, "calculated");
});

test("review and protected earnings remain intact, while calculated zero tasks clear with an audit", async () => {
  const protectedRows = { approved: { calculationStatus: "approved" }, paid: { calculationStatus: "paid" },
    voided: { calculationStatus: "voided" }, adjusted: { calculationStatus: "adjusted" }, review: { calculationStatus: "needsReview" },
    approvedAt: { approvedAt: new Date() }, paidAt: { paidAt: new Date() }, voidedAt: { voidedAt: new Date() },
    statement: { payStatementId: "statement" }, export: { exportBatchId: "export" }, noAmount: { totalAmountCents: null },
    invalid: { totalAmountCents: "invalid" } };
  const records = Object.fromEntries(Object.entries(protectedRows).map(([id, fields]) => [pay + id, row(fields)]));
  const { db, approve } = fixture({ ...records, [pay + "positive"]: row(), [pay + "zero"]: row({ totalAmountCents: 0, adminReviewNotes: "Existing note" }),
    [pay + "base"]: row({ source: "serviceStop", totalAmountCents: 0 }), [pay + "deduction"]: row({ source: "manualAdjustment", totalAmountCents: -500 }) });
  const result = await approve(request());
  assert.deepEqual(result.approvedLineItemIds.sort(), ["base", "deduction", "positive"]);
  assert.deepEqual(result.clearedLineItemIds, ["zero"]); assert.equal(result.needsReviewCount, 1);
  for (const [path, line] of Object.entries(records)) assert.deepEqual(db.records.get(path), line);
  const cleared = db.records.get(pay + "zero");
  assert.equal(cleared.calculationStatus, "voided"); assert.equal(cleared.voidReason, "adminVoided");
  assert.equal(cleared.zeroDollarTaskCleared, true); assert.equal(cleared.autoReconciled, false);
  assert.equal(cleared.voidedByUserId, "owner"); assert.match(cleared.adminReviewNotes, /^Existing note\nReviewed \$0 task/);
  await approve(request()); assert.deepEqual(db.records.get(pay + "zero"), cleared);
});

test("active payroll managers and legacy administrators can approve, while readers and revoked access cannot", async () => {
  for (const access of [{ roleName: "Owner" }, { roleName: "Admin" }, { roleName: "Manager" }, { roleId: "finance" }]) {
    const { db, approve } = fixture({ [pay + "line"]: row(), "users/staff/userAccess/company": access,
      [company + "/roles/finance"]: { permissionIdList: [424] } });
    await approve(request({}, "staff")); assert.equal(db.records.get(pay + "line").approvedByUserId, "staff");
  }
  for (const access of [null, { roleId: "reader" }, { roleName: "Manager", status: "revoked" }, { roleName: "Admin", active: false }]) {
    const { db, approve } = fixture({ [pay + "line"]: row(), ...(access ? { "users/staff/userAccess/company": access } : {}),
      [company + "/roles/reader"]: { permissionIdList: [420] } });
    await assert.rejects(approve(request({}, "staff")), error => error.code === "permission-denied");
    assert.equal(db.records.get(pay + "line").calculationStatus, "calculated");
  }
  await assert.rejects(fixture({}).approve(request({}, null)), error => error.code === "unauthenticated");
});

test("invalid dates, foreign paths, and malformed cursors are rejected before writing", async () => {
  const { db, approve } = fixture({ [pay + "line"]: row() });
  for (const extra of [{ companyId: "../company" }, { startDateMillis: end }, { startDateMillis: "2026-10-01" },
    { endDateExclusiveMillis: Infinity }, { technicianId: "../tech" }, { cursor: { id: "line", seconds: start / 1000, nanoseconds: -1 } },
    { cursor: { id: "line", seconds: end / 1000, nanoseconds: 0 } }]) {
    await assert.rejects(approve(request(extra)), error => error.code === "invalid-argument");
  }
  assert.equal(db.records.get(pay + "line").calculationStatus, "calculated");
});

test("transaction failure rolls back its page and concurrent protection changes are rechecked", async () => {
  const { db, approve } = fixture({ [pay + "one"]: row(), [pay + "two"]: row() });
  db.commitError = new Error("unavailable"); await assert.rejects(approve(request()), /unavailable/);
  assert.equal(db.records.get(pay + "one").calculationStatus, "calculated");
  db.commitError = null;
  db.beforeCommit = () => db.set(pay + "one", { payStatementId: "new-statement" }, { merge: true });
  const result = await approve(request());
  assert.deepEqual(result.approvedLineItemIds, ["two"]);
  assert.equal(db.records.get(pay + "one").calculationStatus, "calculated");
});

test("a failed later page leaves completed pages safe and a restart completes only remaining earnings", async () => {
  const { db, approve } = fixture(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [pay + String(i).padStart(4, "0"), row()])));
  const first = await approve(request()), audit = db.records.get(pay + "0000");
  db.commitError = new Error("interrupted"); await assert.rejects(approve(request({ cursor: first.nextCursor })), /interrupted/);
  assert.equal(db.records.get(pay + "0200").calculationStatus, "calculated");
  db.commitError = null;
  const restart = await approve(request()); assert.equal(restart.approvedLineItemIds.length, 0);
  const last = await approve(request({ cursor: restart.nextCursor }));
  assert.deepEqual(last.approvedLineItemIds, ["0200"]); assert.deepEqual(db.records.get(pay + "0000"), audit);
});

test("approval cursors preserve nanoseconds and accept the last nanosecond inside the range", async () => {
  const time = new Timestamp(start / 1000, 123456789);
  const { approve } = fixture(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [pay + String(i).padStart(4, "0"), row({ completedDate: time })])));
  const first = await approve(request()); assert.equal(first.nextCursor.nanoseconds, 123456789);
  const last = await approve(request({ cursor: first.nextCursor })); assert.deepEqual(last.approvedLineItemIds, ["0200"]);
  const empty = await approve(request({ cursor: { id: "last", seconds: end / 1000 - 1, nanoseconds: 999999999 } }));
  assert.equal(empty.processedCount, 0);
});
