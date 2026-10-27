const { calculatePayLines, reconcilePayLines } = require("./payrollCalculation");

const data = (snap) => snap.exists ? { ...snap.data(), id: snap.id } : null;
const rows = (snap) => snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
const id = (value) => String(typeof value === "object" ? value?.id || "" : value || "").trim();
const payKeys = ["status", "operationStatus", "techId", "tech", "workerId", "workerName", "workerType", "serviceDate", "completedAt", "finishedAt",
  "jobId", "jobTaskId", "workOrderTaskId", "serviceStopId", "typeId", "type", "payTypeId", "payTypeName", "payWorkTypeId", "workTypeId",
  "contractedRate", "manualPayOverrideCents", "manualPayOverrideNotes", "payrollMode", "payrollStackBehavior", "payQuantity",
  "workerAssignmentMode", "payrollAgreement", "workOfferId", "workOfferClaimId", "estimatedTime", "estimatedMinutes", "estimatedDuration", "actualTime", "duration", "bodyOfWaterIds", "bodyOfWaterId", "bodyOfWaterCount",
  "serviceLocationIds", "serviceLocationId", "serviceLocationCount", "payrollBaseAmountCents", "defaultWorkTypeIds", "name", "description"];
const signature = (record) => JSON.stringify(payKeys.map((key) => record?.[key] ?? null));
const changed = (before, after) => signature(before) !== signature(after);

function createPayrollWorkflow(db) {
  const company = (companyId) => db.collection("companies").doc(companyId);
  async function acceptedAgreement(transaction, companyRef, record, cache, source = "stop", jobId = "", parentStopId = "") {
    if (!record) return record;
    const reference = record.payrollAgreement;
    const offerId = record.workOfferId || reference?.offerId;
    const unagreed = { ...record, payrollAgreement: null };
    if (!offerId) return unagreed;
    if (!cache.has(offerId)) cache.set(offerId, transaction.get(companyRef.collection("workOffers").doc(offerId)));
    const snap = await cache.get(offerId), offer = snap.exists ? snap.data() : null;
    const claimId = record.workOfferClaimId || reference?.claimId;
    const claim = (offer?.claims || []).find(v => v.id === claimId || !claimId && v.workerId === (record.workerId || record.techId));
    if (!claim || !["Accepted", "Scheduled", "In Progress", "Completed"].includes(claim.status)) return unagreed;
    const taskId = source === "job" ? record.id : id(record.jobTaskId || record.workOrderTaskId);
    if (source === "job" && (id(offer.jobId) !== jobId || !(claim.taskIds || []).includes(taskId))) return unagreed;
    if (source === "stopTask" && !(claim.taskIds || []).includes(taskId) && !(claim.agreement.stopTasks || []).some(v=>v.stopId===parentStopId && v.taskId===record.id)) return unagreed;
    if (source === "stop" && !(claim.stopIds || []).includes(record.id) && claim.serviceStopId !== record.id) return unagreed;
    const terms = { ...claim.agreement, claimId: claim.id, completionReady: claim.status === "Completed", incentiveReady: claim.status === "Completed", incentivePaymentStopId:claim.stopIds?.[0] || claim.serviceStopId || null };
    if(source === "stop") terms.rateDate = offer.scopeSnapshot?.stops?.find(v=>v.id===record.id)?.serviceDate || terms.rateDate;
    const originalScope = terms.scopeStopIds || claim.stopIds || [];
    const flat = Number(terms.incentive?.amountCents || 0);
    terms.flatIncentiveClaimCents = originalScope.length ? (claim.stopIds || []).reduce((sum,value)=>{const index=originalScope.indexOf(value);return sum+(index<0?0:Math.floor(flat/originalScope.length)+(index<flat%originalScope.length?1:0));},0) : flat;

    const scope = terms.scopeStopIds || claim.stopIds;
    if (source === "stop" && scope.length) {
      const index = scope.indexOf(record.id), count = scope.length;
      const portion = value => Math.floor(value / count) + (index >= 0 && index < value % count ? 1 : 0);
      terms.fixedAmountCents = portion(terms.fixedAmountCents || 0);
      terms.incentiveCents = terms.incentive?.type === "flat" ? portion(terms.incentive.amountCents || 0) : 0;
    }
    return { ...record, payrollAgreement: terms };
  }
  async function context(transaction, companyRef) {
    const [settings, wide, canonical, legacyWork, legacyStops, rates, users] = await Promise.all([
      transaction.get(companyRef.collection("paySettings").doc("main")),
      transaction.get(companyRef.collection("settings").doc("companyWide")),
      transaction.get(companyRef.collection("companyPayTypes")),
      transaction.get(companyRef.collection("companyWorkTypes")),
      transaction.get(companyRef.collection("companyServiceStopTypes")),
      transaction.get(companyRef.collection("technicianRates")),
      transaction.get(companyRef.collection("companyUsers")),
    ]);
    const types = new Map(rows(legacyWork).map((row) => [row.id, row]));
    rows(canonical).forEach((row) => types.set(row.id, row));
    const stopTypes = new Map(rows(legacyStops).map((row) => [row.id, row]));
    const paySettings = { ...(settings.exists ? settings.data() : {}) };
    if (wide.exists && (wide.data().payrollEnabled === false || wide.data().companyPayrollEnabled === false || wide.data().payrollDisabled === true)) paySettings.payrollEnabled = false;
    return { settings: paySettings, workTypes: [...types.values()], rates: rows(rates), workers: rows(users), stopTypes };
  }
  function apply(transaction, companyRef, result) {
    if (result.writes.length > 450) throw new Error("Payroll scope exceeds the atomic reconciliation limit. Split this work into visits.");
    result.writes.forEach((line) => transaction.set(companyRef.collection("technicianPayLineItems").doc(line.id), line, { merge: true }));
  }
  async function reconcileStop(companyId, stopId, { ratesChanged = false } = {}) {
    const companyRef = company(companyId);
    const stopRef = companyRef.collection("serviceStops").doc(stopId);
    return db.runTransaction(async (transaction) => {
      const [stopSnap, tasksSnap, paySnap, ctx] = await Promise.all([
        transaction.get(stopRef), transaction.get(stopRef.collection("tasks")),
        transaction.get(companyRef.collection("technicianPayLineItems").where("serviceStopId", "==", stopId)), context(transaction, companyRef),
      ]);
      let stop = data(stopSnap);
      if (ratesChanged && stop && ["finished", "completed", "complete", "done"].includes(String(stop.status || stop.operationStatus || "").toLowerCase()) && !stop.payrollLastProcessedAt && paySnap.empty) {
        return { generatedLineItemCount: 0, savedLineItemCount: 0, needsReviewCount: 0, conflictLineItemIds: [], skippedHistoricalWork: true };
      }
      if (ctx.settings.payrollEnabled === false || ctx.settings.companyPayrollEnabled === false || ctx.settings.payrollDisabled === true) {
        if (stop) transaction.set(stopRef, { estimatedPayCents: 0, estimatedPayLines: [], estimatedPayNeedsReview: false, payrollReconcileStatus: "disabled", payrollLastProcessedAt: new Date() }, { merge: true });
        return { generatedLineItemCount: 0, savedLineItemCount: 0, needsReviewCount: 0, conflictLineItemIds: [], payrollDisabled: true };
      }
      const agreementCache = new Map();
      stop = await acceptedAgreement(transaction, companyRef, stop, agreementCache);
      const tasks = await Promise.all(rows(tasksSnap).map(task => acceptedAgreement(transaction, companyRef, task, agreementCache, "stopTask", id(stop?.jobId), stopId)));
      const jobId = id(stop?.jobId);
      const jobPaySnap = jobId ? await transaction.get(companyRef.collection("technicianPayLineItems").where("jobId", "==", jobId)) : null;
      if (stop) {
        const legacyType = ctx.stopTypes.get(stop.typeId);
        if (!stop.payTypeId && !ctx.workTypes.some((type) => type.id === stop.typeId)) stop.defaultWorkTypeIds = legacyType?.defaultWorkTypeIds || [];
      }
      const input = { ...ctx, companyId, serviceStop: stop || { id: stopId, operationStatus: "Deleted" }, tasks: stop ? tasks : [] };
      const offerPaySnaps = await Promise.all([...agreementCache.keys()].map(value=>transaction.get(companyRef.collection("technicianPayLineItems").where("workOfferId","==",value))));
      const generated = calculatePayLines({...input, payHistory:offerPaySnaps.flatMap(rows)});
      const components = new Set(generated.map((line) => line.payrollComponentId));
      const existing = new Map(rows(paySnap).map((line) => [line.id, line]));
      if (jobPaySnap) rows(jobPaySnap).filter((line) => components.has(line.payrollComponentId)).forEach((line) => existing.set(line.id, line));
      const result = reconcilePayLines({ generated, existing: [...existing.values()], preserveCalculated: ratesChanged && ctx.settings.recalculateUnapprovedPayWhenRatesChange === false });
      apply(transaction, companyRef, result);
      const preview = stop ? calculatePayLines({ ...input, mode: "preview" }) : [];
      const needsReview = generated.filter((line) => line.calculationStatus === "needsReview").length;
      if (stop) transaction.set(stopRef, {
        estimatedPayCents: preview.reduce((sum, line) => sum + line.totalAmountCents, 0),
        estimatedPayLines: preview, estimatedPayNeedsReview: preview.some((line) => line.calculationStatus === "needsReview"),
        payrollReconcileStatus: result.conflicts.length ? "adjustmentRequired" : needsReview ? "needsReview" : "current",
        payrollReconcileConflictIds: result.conflicts, payrollNeedsReviewCount: needsReview, payrollLastProcessedAt: new Date(),
      }, { merge: true });
      return { generatedLineItemCount: generated.length, savedLineItemCount: result.writes.length,
        needsReviewCount: needsReview, conflictLineItemIds: result.conflicts };
    });
  }
  async function reconcileJob(companyId, jobId, { ratesChanged = false } = {}) {
    const companyRef = company(companyId);
    const jobRef = companyRef.collection("workOrders").doc(jobId);
    return db.runTransaction(async (transaction) => {
      const [jobSnap, tasksSnap, paySnap, ctx] = await Promise.all([
        transaction.get(jobRef), transaction.get(jobRef.collection("tasks")),
        transaction.get(companyRef.collection("technicianPayLineItems").where("jobId", "==", jobId)), context(transaction, companyRef),
      ]);
      const job = data(jobSnap);
      if (ratesChanged && job && !job.payrollLastProcessedAt && paySnap.empty) {
        return { generatedLineItemCount: 0, savedLineItemCount: 0, needsReviewCount: 0, conflictLineItemIds: [], skippedHistoricalWork: true };
      }
      if (ctx.settings.payrollEnabled === false || ctx.settings.companyPayrollEnabled === false || ctx.settings.payrollDisabled === true) {
        if (job) transaction.set(jobRef, { payrollReconcileStatus: "disabled", payrollLastProcessedAt: new Date() }, { merge: true });
        return { generatedLineItemCount: 0, savedLineItemCount: 0, needsReviewCount: 0, conflictLineItemIds: [], payrollDisabled: true };
      }
      const agreementCache = new Map();
      const tasks = await Promise.all(rows(tasksSnap).filter(task => !id(task.serviceStopId)).map(task => acceptedAgreement(transaction, companyRef, task, agreementCache, "job", jobId)));
      const offerPaySnaps = await Promise.all([...agreementCache.keys()].map(value=>transaction.get(companyRef.collection("technicianPayLineItems").where("workOfferId","==",value))));
      const generated = job ? calculatePayLines({ ...ctx, companyId, jobTaskSource: true, payHistory:offerPaySnaps.flatMap(rows),
        serviceStop: { ...job, id: `job_${jobId}`, jobId, jobName: job.internalId, type: "Job task", techId: "" }, tasks }) : [];
      const components = new Set(generated.map((line) => line.payrollComponentId));
      const existing = rows(paySnap).filter((line) => line.payrollSource === "jobTask" || line.payrollSource === "workOfferIncentive" && !line.serviceStopId || components.has(line.payrollComponentId));
      const result = reconcilePayLines({ generated, existing, voidReason: "taskReopened", preserveCalculated: ratesChanged && ctx.settings.recalculateUnapprovedPayWhenRatesChange === false });
      apply(transaction, companyRef, result);
      const needsReview = generated.filter((line) => line.calculationStatus === "needsReview").length;
      if (job) transaction.set(jobRef, { payrollReconcileStatus: result.conflicts.length ? "adjustmentRequired" : needsReview ? "needsReview" : "current",
        payrollReconcileConflictIds: result.conflicts, payrollNeedsReviewCount: needsReview, payrollLastProcessedAt: new Date() }, { merge: true });
      return { generatedLineItemCount: generated.length, savedLineItemCount: result.writes.length, needsReviewCount: needsReview, conflictLineItemIds: result.conflicts };
    });
  }
  async function syncJobTask(companyId, jobId, taskId, task, detached = false) {
    const stopId = id(task?.serviceStopId);
    if (!stopId || !task) return;
    const stopRef = company(companyId).collection("serviceStops").doc(stopId);
    await db.runTransaction(async (transaction) => {
      const [stop, a, b] = await Promise.all([transaction.get(stopRef),
        transaction.get(stopRef.collection("tasks").where("jobTaskId", "==", taskId)),
        transaction.get(stopRef.collection("tasks").where("workOrderTaskId", "==", taskId))]);
      if (!stop.exists) return;
      const matches = new Map([...a.docs, ...b.docs].map((doc) => [doc.id, doc]));
      matches.forEach((doc) => {
        const existing = doc.data();
        const updates = detached ? { status: "Deleted", payrollSourceDetached: true } : Object.fromEntries(payKeys.filter((key) => !["serviceStopId", "jobId", "jobTaskId", "workOrderTaskId", "workerId", "workerName", "workerType", "operationStatus", "serviceDate"].includes(key) && task[key] !== undefined).map((key) => [key, task[key]]));
        if (!detached && task.workerId) Object.assign(updates, { workerId: task.workerId, workerName: task.workerName || "", workerType: task.workerType || existing.workerType || "Not Assigned",
          workerAssignmentMode: task.workerAssignmentMode === "task" || task.workerId !== id(stop.data().techId || stop.data().technicianId) ? "task" : "stop" });
        if (changed(existing, { ...existing, ...updates })) transaction.set(doc.ref, updates, { merge: true });
      });
    });
  }
  async function syncStopAssignment(companyId, stopId, before, after) {
    const previousWorker = id(before?.techId || before?.technicianId);
    const nextWorker = id(after?.techId || after?.technicianId);
    if (!before || !after || previousWorker === nextWorker) return;
    const companyRef = company(companyId), stopRef = companyRef.collection("serviceStops").doc(stopId);
    await db.runTransaction(async (transaction) => {
      // Re-read the stop because trigger deliveries can arrive after a newer assignment.
      const [fresh, tasks] = await Promise.all([transaction.get(stopRef), transaction.get(stopRef.collection("tasks"))]);
      if (!fresh.exists) return;
      const currentWorker = id(fresh.data().techId || fresh.data().technicianId);
      const inherited = tasks.docs.filter((doc) => { const task = doc.data(); return !["finished", "completed", "done"].includes(String(task.status || "").toLowerCase()) && task.workerAssignmentMode !== "task" && (!task.workerId || task.workerId === previousWorker || task.workerAssignmentMode === "stop"); });
      const jobId = id(fresh.data().jobId);
      const jobTasks = await Promise.all(inherited.map((doc) => {
        const taskId = id(doc.data().jobTaskId || doc.data().workOrderTaskId);
        return jobId && taskId ? transaction.get(companyRef.collection("workOrders").doc(jobId).collection("tasks").doc(taskId)) : null;
      }));
      if (inherited.length * 2 > 450) throw new Error("Too many tasks to reassign atomically. Split this work into visits.");
      const updates = { workerId: currentWorker, workerName: fresh.data().tech || fresh.data().technicianName || "", workerAssignmentMode: "stop" };
      inherited.forEach((doc, index) => {
        transaction.set(doc.ref, updates, { merge: true });
        const task = jobTasks[index];
        if (task?.exists && id(task.data().serviceStopId) === stopId && task.data().workerAssignmentMode !== "task" && (!task.data().workerId || task.data().workerId === previousWorker || task.data().workerAssignmentMode === "stop")) transaction.set(task.ref, updates, { merge: true });
      });
    });
  }
  async function onStopWrite(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!changed(before, after)) return;
    await syncStopAssignment(event.params.companyId, event.params.serviceStopId, before, after);
    await reconcileStop(event.params.companyId, event.params.serviceStopId);
  }
  async function onStopTaskWrite(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!changed(before, after)) return;
    await reconcileStop(event.params.companyId, event.params.serviceStopId);
  }
  async function onJobTaskWrite(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!changed(before, after)) return;
    const { companyId, jobId, taskId } = event.params;
    if (before && id(before.serviceStopId) !== id(after?.serviceStopId)) await syncJobTask(companyId, jobId, taskId, before, true);
    await syncJobTask(companyId, jobId, taskId, after);
    await reconcileJob(companyId, jobId);
    for (const stopId of new Set([id(before?.serviceStopId), id(after?.serviceStopId)].filter(Boolean))) await reconcileStop(companyId, stopId);
  }
  async function enqueueRefresh(event, ratesChanged) {
    const requestId = String(event.id || `${Date.now()}_${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "_");
    const ref = company(event.params.companyId).collection("payrollReconcileWork").doc(`${requestId}_0`);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) transaction.set(ref, { requestId, page: 0, companyId: event.params.companyId,
        phase: "serviceStops", cursor: "", ratesChanged, status: "queued", createdAt: new Date() });
    });
  }
  async function processRefresh(event) {
    if (!event.data?.after?.exists || event.data.after.data().status !== "queued") return;
    const ref = event.data.after.ref;
    // Leave work queued until the final commit. A process crash or duplicate delivery
    // can retry the same idempotent page without stranding a processing lease.
    const fresh = await ref.get();
    const work = fresh.exists && fresh.data().status === "queued" ? fresh.data() : null;
    if (!work) return;
    try {
      const companyRef = company(event.params.companyId);
      let query = companyRef.collection(work.phase).orderBy("__name__").limit(40);
      if (work.cursor) query = query.startAfter(work.cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        if (work.phase === "serviceStops") await reconcileStop(event.params.companyId, doc.id, work);
        else await reconcileJob(event.params.companyId, doc.id, work);
      }
      const more = page.docs.length === 40;
      const nextPhase = more ? work.phase : work.phase === "serviceStops" ? "workOrders" : null;
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (!current.exists || current.data().status !== "queued") return;
        if (nextPhase) transaction.set(companyRef.collection("payrollReconcileWork").doc(`${work.requestId}_${work.page + 1}`), {
          ...work, phase: nextPhase, page: work.page + 1, cursor: more ? page.docs[page.docs.length - 1].id : "", status: "queued", createdAt: new Date(),
        });
        transaction.set(ref, { status: "completed", finishedAt: new Date(), processedCount: page.docs.length }, { merge: true });
      });
    } catch (error) {
      throw error;
    }
  }
  async function onRateWrite(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const keys = ["technicianId", "payTypeId", "workTypeId", "amountCents", "rateType", "payBasis", "status", "effectiveStartDate", "effectiveEndDate"];
    if (JSON.stringify(keys.map((key) => before?.[key] ?? null)) === JSON.stringify(keys.map((key) => after?.[key] ?? null))) return;
    const technicians = new Set([before?.technicianId, after?.technicianId].filter((value) => value && value !== "base_technician_default"));
    if (technicians.size) await enqueueRefresh(event, true);
  }
  async function onSettingsWrite(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const wide = event.data?.after?.ref?.path?.endsWith("settings/companyWide");
    const keys = wide ? ["payrollEnabled", "companyPayrollEnabled", "payrollDisabled"] : event.params.payTypeId
      ? ["name", "isActive", "active", "archived", "category", "defaultRateType", "defaultStackBehavior"]
      : ["payrollEnabled", "payMode", "routePaySource", "taskPaySource", "hourlyPaySource", "defaultStackBehavior", "recalculateUnapprovedPayWhenRatesChange"];
    if (JSON.stringify(keys.map((key) => before?.[key] ?? null)) !== JSON.stringify(keys.map((key) => after?.[key] ?? null))) await enqueueRefresh(event, true);
  }
  async function refreshRequestedStop(request) {
    const { HttpsError } = require("firebase-functions/v2/https");
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to refresh payroll.");
    const { companyId, serviceStopId } = request.data || {};
    if (![companyId, serviceStopId].every((value) => typeof value === "string" && value.trim() && value.length <= 200 && !value.includes("/"))) {
      throw new HttpsError("invalid-argument", "Choose a company and service stop.");
    }
    const [owner, access, stop] = await Promise.all([company(companyId).get(),
      db.collection("users").doc(request.auth.uid).collection("userAccess").doc(companyId).get(),
      company(companyId).collection("serviceStops").doc(serviceStopId).get()]);
    if (!owner.exists || owner.data().ownerId !== request.auth.uid && !access.exists) throw new HttpsError("permission-denied", "You do not have access to this company.");
    if (!stop.exists) throw new HttpsError("not-found", "This service stop is no longer available.");
    // This endpoint calculates from stored work and setup only; callers cannot supply rates or earnings.
    return reconcileStop(companyId, serviceStopId);
  }
  async function reconcileOffer(companyId, offerId) {
    if (!offerId) return;
    const snap = await company(companyId).collection("workOffers").doc(offerId).get();
    if (!snap.exists) return;
    const offer = snap.data(), stopIds = new Set();
    for (const claim of offer.claims || []) {
      (claim.stopIds || []).forEach(value=>stopIds.add(value));
      if (claim.serviceStopId) stopIds.add(claim.serviceStopId);
    }
    for (const stopId of stopIds) await reconcileStop(companyId, stopId);
    if (offer.jobId) await reconcileJob(companyId, id(offer.jobId));
  }
  async function onOfferWrite(event) {
    const before=event.data?.before?.data(),after=event.data?.after?.data();
    const states=value=>JSON.stringify((value?.claims || []).map(v=>[v.id,v.status,v.stopIds,v.taskIds,v.serviceStopId]));
    if (states(before)===states(after)) return;
    return reconcileOffer(event.params.companyId,event.params.offerId);
  }
  async function onPayLineWrite(event) {
    const before=event.data?.before?.data(),after=event.data?.after?.data();
    if ((after || before)?.payrollSource === "workOfferIncentive") return;
    const sig=v=>JSON.stringify([v?.workOfferId,v?.workOfferClaimId,v?.technicianId,v?.totalAmountCents,v?.calculationStatus]);
    if (sig(before)===sig(after)) return;
    for(const offerId of new Set([before?.workOfferId,after?.workOfferId].filter(Boolean))) await reconcileOffer(event.params.companyId,offerId);
  }
  return { reconcileOffer, onOfferWrite, onPayLineWrite, refreshRequestedStop, reconcileStop, reconcileJob, onStopWrite, onStopTaskWrite, onJobTaskWrite, onRateWrite, onSettingsWrite, processRefresh };
}

module.exports = { createPayrollWorkflow };
