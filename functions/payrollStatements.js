const { HttpsError } = require("firebase-functions/v2/https");
const { Timestamp } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");

const PREVIEW_PAGE_SIZE = 200;
const STATEMENT_LINE_LIMIT = 400;
const fail = (code, message) => { throw new HttpsError(code, message); };
const validId = value => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 1500 && ![".", ".."].includes(value) && !value.includes("/");
const asTimestamp = value => value instanceof Date ? Timestamp.fromDate(value) : value;
const eligible = line => line.calculationStatus === "approved" && validId(line.technicianId) &&
  !line.paidAt && !line.voidedAt && !line.payStatementId && !line.exportBatchId &&
  ["number", "string"].includes(typeof line.totalAmountCents) && String(line.totalAmountCents).trim() !== "" &&
  Number.isSafeInteger(Number(line.totalAmountCents)) && Number(line.totalAmountCents) !== 0;
const jsonValue = value => value instanceof Date ? value.getTime() : value?.toMillis ? value.toMillis()
  : Array.isArray(value) ? value.map(jsonValue) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, jsonValue(v)])) : value;

function createPayrollStatements(db) {
  function scope(request) {
    if (!request.auth?.uid) fail("unauthenticated", "Sign in to generate payroll statements.");
    const { companyId, startDateMillis, endDateExclusiveMillis, technicianId = "" } = request.data || {};
    const validDate = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
    if (!validId(companyId) || !validDate(startDateMillis) || !validDate(endDateExclusiveMillis) ||
      startDateMillis >= endDateExclusiveMillis || technicianId !== "" && !validId(technicianId)) {
      fail("invalid-argument", "Choose a company, valid payroll dates, and a technician.");
    }
    return { companyId, startDateMillis, endDateExclusiveMillis, technicianId };
  }

  async function authorize(transaction, companyRef, uid) {
    const [company, access] = await Promise.all([transaction.get(companyRef),
      transaction.get(db.collection("users").doc(uid).collection("userAccess").doc(companyRef.id))]);
    const member = access.data() || {};
    const active = access.exists && member.active !== false && member.isActive !== false && member.revoked !== true &&
      !["inactive", "revoked", "past", "deleted", "declined", "pending", "invited", "rejected", "cancelled", "canceled", "expired"].includes(String(member.status || member.userStatus || member.companyUserStatus || "").trim().toLowerCase());
    if (!company.exists || company.data().ownerId !== uid && !active) fail("permission-denied", "Active company payroll access is required.");
    const administrator = company.data().ownerId === uid || ["owner", "admin", "manager"].includes(String(member.roleName || "").trim().toLowerCase());
    const role = !administrator && active && validId(member.roleId) ? await transaction.get(companyRef.collection("roles").doc(member.roleId)) : null;
    if (!administrator && !(role?.data()?.permissionIdList || []).map(String).includes("424")) fail("permission-denied", "Manage Payroll permission is required to generate statements.");
  }

  async function preview(request) {
    const selected = scope(request), { companyId, startDateMillis, endDateExclusiveMillis, technicianId } = selected;
    const { cursor = null, summaryBeforePage } = request.data;
    if (summaryBeforePage !== undefined && (!cursor || !summaryBeforePage ||
      !Array.isArray(summaryBeforePage.technicianIds) || !summaryBeforePage.technicianIds.every(validId) ||
      !Array.isArray(summaryBeforePage.serviceStopIds) || !summaryBeforePage.serviceStopIds.every(validId) ||
      !Number.isSafeInteger(summaryBeforePage.totalAmountCents))) {
      fail("invalid-argument", "Invalid preview summary. Generate previews again.");
    }
    let after = null;
    if (cursor !== null) {
      if (!cursor || !validId(cursor.id) || !Number.isInteger(cursor.seconds) || !Number.isInteger(cursor.nanoseconds) || cursor.nanoseconds < 0 || cursor.nanoseconds >= 1e9) fail("invalid-argument", "Invalid preview cursor. Generate previews again.");
      try { after = new Timestamp(cursor.seconds, cursor.nanoseconds); } catch (_) { fail("invalid-argument", "Invalid preview cursor."); }
      if (after.toMillis() < startDateMillis || after.toMillis() >= endDateExclusiveMillis) fail("invalid-argument", "Preview cursor is outside the selected dates.");
    }
    const companyRef = db.collection("companies").doc(companyId);
    return db.runTransaction(async transaction => {
      await authorize(transaction, companyRef, request.auth.uid);
      let query = companyRef.collection("technicianPayLineItems").where("calculationStatus", "==", "approved")
        .where("completedDate", ">=", new Date(startDateMillis)).where("completedDate", "<", new Date(endDateExclusiveMillis));
      if (technicianId) query = query.where("technicianId", "==", technicianId);
      query = query.orderBy("completedDate", "asc").orderBy("__name__", "asc").limit(PREVIEW_PAGE_SIZE);
      if (after) query = query.startAfter(after, cursor.id);
      const page = await transaction.get(query);
      const lineItems = page.docs.filter(doc => eligible(doc.data()) && (!doc.data().companyId || doc.data().companyId === companyId))
        .map(doc => jsonValue({ ...doc.data(), id: doc.id }));
      const last = page.docs.at(-1), date = last ? asTimestamp(last.data().completedDate) : null;
      const nextCursor = page.size === PREVIEW_PAGE_SIZE ? { id: last.id, seconds: date.seconds, nanoseconds: date.nanoseconds } : null;
      const generatedAt = new Date();
      // Carry the already-returned pages' display totals, avoiding a second read
      // of the full range. This metadata never determines payable earnings.
      let summary = null;
      if (!nextCursor && (!cursor || summaryBeforePage)) {
        const technicianIds = new Set(summaryBeforePage?.technicianIds || []);
        const serviceStopIds = new Set(summaryBeforePage?.serviceStopIds || []);
        let totalAmountCents = summaryBeforePage?.totalAmountCents || 0;
        lineItems.forEach(line => {
          technicianIds.add(line.technicianId);
          if (validId(line.serviceStopId)) serviceStopIds.add(line.serviceStopId);
          totalAmountCents += Number(line.totalAmountCents);
        });
        if (!Number.isSafeInteger(totalAmountCents)) fail("invalid-argument", "The preview total is invalid. Generate previews again.");
        summary = { technicianCount: technicianIds.size, totalAmountCents, stopCount: serviceStopIds.size };
      }
      if (!nextCursor) {
        const settingsRef = companyRef.collection("settings").doc("payStatements");
        const settings = await transaction.get(settingsRef);
        transaction.set(settingsRef, {
          category: "payStatements", ...(settings.data()?.increment === undefined ? { increment: 0 } : {}),
          lastPreviewGeneratedAt: generatedAt, lastPreviewGeneratedByUserId: request.auth.uid,
          lastPreviewStartDate: new Date(startDateMillis), lastPreviewEndDateExclusive: new Date(endDateExclusiveMillis),
          lastPreviewTechnicianId: technicianId || null,
          lastPreviewSummary: summary,
        }, { merge: true });
      }
      return { lineItems, processedCount: page.size, skippedCount: page.size - lineItems.length, nextCursor,
        generatedAtMillis: nextCursor ? null : generatedAt.getTime(), summary };
    });
  }

  async function create(request) {
    const { companyId, startDateMillis, endDateExclusiveMillis, technicianId } = scope(request);
    const { lineItemIds, requestId, expectedTotalCents, expectedLineAmountsCents } = request.data;
    if (!validId(technicianId) || typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId) ||
      !Array.isArray(lineItemIds) || !lineItemIds.length || lineItemIds.length > STATEMENT_LINE_LIMIT ||
      !lineItemIds.every(validId) || new Set(lineItemIds).size !== lineItemIds.length || !Number.isSafeInteger(expectedTotalCents) ||
      !Array.isArray(expectedLineAmountsCents) || expectedLineAmountsCents.length !== lineItemIds.length || !expectedLineAmountsCents.every(Number.isSafeInteger)) {
      fail("invalid-argument", "Choose a generated preview containing up to 400 pay items.");
    }
    const companyRef = db.collection("companies").doc(companyId);
    const statementRef = companyRef.collection("technicianPayStatements").doc(`comp_pay_stmt_${requestId}`);
    const fingerprint = createHash("sha256").update(JSON.stringify([startDateMillis, endDateExclusiveMillis, technicianId,
      lineItemIds.map((id, index) => [id, expectedLineAmountsCents[index]]).sort((a, b) => a[0].localeCompare(b[0])), expectedTotalCents])).digest("hex");
    return db.runTransaction(async transaction => {
      await authorize(transaction, companyRef, request.auth.uid);
      const previous = await transaction.get(statementRef);
      if (previous.exists) {
        if (previous.data().generationFingerprint !== fingerprint || previous.data().createdByUserId !== request.auth.uid) fail("already-exists", "This statement request was already used. Generate previews again.");
        return { statement: jsonValue({ ...previous.data(), id: previous.id }), alreadyCreated: true };
      }
      const settingsRef = companyRef.collection("settings").doc("payStatements");
      const [settings, ...lineDocs] = await Promise.all([transaction.get(settingsRef),
        ...lineItemIds.map(id => transaction.get(companyRef.collection("technicianPayLineItems").doc(id)))]);
      const lines = lineDocs.map((doc, index) => {
        const line = doc.data() || {};
        const completed = asTimestamp(line.completedDate)?.toMillis?.();
        if (!doc.exists || !eligible(line) || line.companyId && line.companyId !== companyId || line.technicianId !== technicianId ||
          !Number.isFinite(completed) || completed < startDateMillis || completed >= endDateExclusiveMillis ||
          Number(line.totalAmountCents) !== expectedLineAmountsCents[index]) {
          fail("failed-precondition", "A previewed pay item changed or belongs to a statement already. Generate previews again before creating this statement.");
        }
        return line;
      });
      const subtotalCents = lines.reduce((sum, line) => sum + Number(line.totalAmountCents), 0);
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents !== expectedTotalCents) fail("failed-precondition", "Pay amounts changed after the preview. Generate previews again.");
      const increment = Number(settings.data()?.increment || 0);
      if (!Number.isSafeInteger(increment) || increment < 0) fail("failed-precondition", "The statement number needs correction before creating statements.");
      const now = new Date(), statementNumber = increment + 1;
      const statement = {
        id: statementRef.id, companyId, technicianId, technicianName: lines.find(line => line.technicianName)?.technicianName || technicianId,
        workerType: lines.find(line => line.workerType)?.workerType || "notAssigned",
        startDate: new Date(startDateMillis), endDate: new Date(endDateExclusiveMillis - 1), lineItemIds,
        subtotalCents, adjustmentCents: 0, totalCents: subtotalCents, status: "draft",
        createdAt: now, createdByUserId: request.auth.uid, approvedAt: null, approvedByUserId: null, paidAt: null, paidByUserId: null,
        exportedAt: null, exportProvider: null, externalReferenceId: null, notes: null, paymentReference: null, paidNotes: null,
        statementNumber, statementReference: `PS-${String(statementNumber).padStart(6, "0")}`,
        generationRequestId: requestId, generationFingerprint: fingerprint,
      };
      transaction.set(settingsRef, { category: "payStatements", increment: statementNumber,
        lastStatementsGeneratedAt: now, lastStatementsGeneratedByUserId: request.auth.uid }, { merge: true });
      transaction.set(statementRef, statement);
      lineDocs.forEach(doc => transaction.set(doc.ref, { payStatementId: statement.id }, { merge: true }));
      return { statement: jsonValue(statement), alreadyCreated: false };
    });
  }

  return { preview, create };
}

module.exports = { createPayrollStatements, PREVIEW_PAGE_SIZE, STATEMENT_LINE_LIMIT };
