const { HttpsError } = require("firebase-functions/v2/https");
const { Timestamp } = require("firebase-admin/firestore");
const { canClearZeroTask } = require("./payrollCalculation");

const PAGE_SIZE = 200;
const fail = (code, message) => { throw new HttpsError(code, message); };
const validId = value => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 1500 && ![".", ".."].includes(value) && !value.includes("/");
const timestamp = value => value instanceof Date ? Timestamp.fromDate(value) : value;
const compareTimestamp = (left, right) => left.seconds - right.seconds || left.nanoseconds - right.nanoseconds;
const eligible = line => ["pending", "calculated"].includes(line.calculationStatus) &&
  !line.approvedAt && !line.paidAt && !line.voidedAt && !line.payStatementId && !line.exportBatchId &&
  ["number", "string"].includes(typeof line.totalAmountCents) && String(line.totalAmountCents).trim() !== "" && Number.isFinite(Number(line.totalAmountCents));

function createPayrollApproval(db) {
  async function approveDateRange(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in to approve payroll.");
    const { companyId, startDateMillis, endDateExclusiveMillis, technicianId = "", cursor = null } = request.data || {};
    const validDate = value => Number.isInteger(value) && Number.isFinite(new Date(value).getTime());
    if (!validId(companyId) || !validDate(startDateMillis) || !validDate(endDateExclusiveMillis) ||
      startDateMillis >= endDateExclusiveMillis || technicianId !== "" && !validId(technicianId)) {
      fail("invalid-argument", "Choose a company and a valid payroll date range and technician.");
    }
    let after = null;
    if (cursor !== null) {
      if (!cursor || !validId(cursor.id) || !Number.isInteger(cursor.seconds) || !Number.isInteger(cursor.nanoseconds) || cursor.nanoseconds < 0 || cursor.nanoseconds >= 1e9) {
        fail("invalid-argument", "The payroll approval cursor is invalid. Start approval again.");
      }
      try { after = new Timestamp(cursor.seconds, cursor.nanoseconds); } catch (_) { fail("invalid-argument", "The payroll approval cursor is invalid."); }
      if (compareTimestamp(after, Timestamp.fromMillis(startDateMillis)) < 0 || compareTimestamp(after, Timestamp.fromMillis(endDateExclusiveMillis)) >= 0) fail("invalid-argument", "The approval cursor is outside the selected dates.");
    }
    const companyRef = db.collection("companies").doc(companyId);
    return db.runTransaction(async transaction => {
      const [company, access] = await Promise.all([transaction.get(companyRef),
        transaction.get(db.collection("users").doc(uid).collection("userAccess").doc(companyId))]);
      const member = access.data() || {};
      const active = access.exists && member.active !== false && member.isActive !== false && member.revoked !== true &&
        !["inactive", "revoked", "past", "deleted", "declined", "pending", "invited", "rejected", "cancelled", "canceled", "expired"].includes(String(member.status || member.userStatus || member.companyUserStatus || "").trim().toLowerCase());
      if (!company.exists || company.data().ownerId !== uid && !active) fail("permission-denied", "Active company payroll access is required.");
      const role = active && validId(member.roleId) ? await transaction.get(companyRef.collection("roles").doc(member.roleId)) : null;
      const administrator = company.data().ownerId === uid || ["owner", "admin", "manager"].includes(String(member.roleName || "").trim().toLowerCase());
      if (!administrator && !(role?.data()?.permissionIdList || []).map(String).includes("424")) fail("permission-denied", "Manage Payroll permission is required to approve payroll.");

      let query = companyRef.collection("technicianPayLineItems")
        .where("completedDate", ">=", new Date(startDateMillis)).where("completedDate", "<", new Date(endDateExclusiveMillis));
      if (technicianId) query = query.where("technicianId", "==", technicianId);
      query = query.orderBy("completedDate", "asc").orderBy("__name__", "asc").limit(PAGE_SIZE);
      if (after) query = query.startAfter(after, cursor.id);
      const page = await transaction.get(query);
      const now = new Date(), updates = [], approvedLineItemIds = [], clearedLineItemIds = [];
      let needsReviewCount = 0;
      page.docs.forEach(doc => {
        const line = doc.data();
        if (line.companyId && line.companyId !== companyId) return;
        if (line.calculationStatus === "needsReview") needsReviewCount += 1;
        if (!eligible(line)) return;
        const clear = canClearZeroTask(line);
        const payload = clear ? {
          calculationStatus: "voided", voidReason: "adminVoided", autoReconciled: false, zeroDollarTaskCleared: true,
          voidedAt: now, voidedByUserId: uid,
          adminReviewNotes: [line.adminReviewNotes, "Reviewed $0 task: no additional task pay. Cleared from payroll."].filter(Boolean).join("\n"),
        } : { calculationStatus: "approved", approvedAt: now, approvedByUserId: uid };
        transaction.set(doc.ref, payload, { merge: true });
        (clear ? clearedLineItemIds : approvedLineItemIds).push(doc.id);
        const { approvedAt, voidedAt, ...fields } = payload;
        updates.push({ id: doc.id, ...fields, ...(approvedAt ? { approvedAtMillis: approvedAt.getTime() } : {}), ...(voidedAt ? { voidedAtMillis: voidedAt.getTime() } : {}) });
      });
      const last = page.docs.at(-1), date = last ? timestamp(last.data().completedDate) : null;
      const nextCursor = page.size === PAGE_SIZE ? { id: last.id, seconds: date.seconds, nanoseconds: date.nanoseconds } : null;
      return { approvedLineItemIds, clearedLineItemIds, updates, processedCount: page.size, needsReviewCount,
        skippedCount: page.size - updates.length, nextCursor };
    });
  }
  return { approveDateRange };
}

module.exports = { createPayrollApproval };
