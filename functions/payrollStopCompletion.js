const { createHash } = require("node:crypto");
const { companyActor, can, documentId, fail, key } = require("./companyActor");
const { addCalendarDays, calendarDate, date, dateKey, finished, timeZone } = require("./routeState");
const { assertServiceOnboardingReady } = require("./serviceOnboardingGate");

const COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";
const SOURCE = "payroll_bulk_completion";
const MAX_STOPS = 40;
const MAX_SCAN = 1000;
const RETRY_AFTER_MS = 180000;
const openStop = stop => ["", "notfinished", "scheduled", "inprogress", "started"].includes(key(stop.operationStatus || stop.status)) &&
  !finished(stop) && !finished({ status: stop.status }) && !stop.cancelledAt && !stop.canceledAt && !stop.skippedAt;
const openTask = task => ["", "notfinished", "scheduled", "inprogress", "accepted", "started"].includes(key(task.status)) &&
  !task.completedAt && !task.finishedAt && !task.cancelledAt && !task.canceledAt;
const asId = value => typeof value === "object" ? value?.id || "" : value || "";
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshotVersion = snap => [snap.id, snap.updateTime?.seconds, snap.updateTime?.nanoseconds];
const readableError = error => error.code === "failed-precondition" ? error.message : null;
const pickTaskIds = values => {
  if (!Array.isArray(values) || values.length > 150) fail("invalid-argument", "Choose up to 150 tasks per stop.");
  return [...new Set(values.map(value => documentId(value, "Task")))].sort();
};
function picksFrom(values, isFinish) {
  if (!Array.isArray(values) || values.length > (isFinish ? MAX_STOPS : 200)) fail("invalid-argument", "Choose up to 40 stops to finish at a time.");
  const picks = new Map();
  for (const value of values) {
    const stopId = documentId(value?.stopId, "Service stop");
    if (picks.has(stopId) || isFinish && !/^[a-f0-9]{64}$/.test(value?.version || "")) {
      fail("invalid-argument", "Refresh the preview and choose each stop once.");
    }
    picks.set(stopId, { stopId, version: value.version, taskIds: pickTaskIds(value.taskIds) });
  }
  if (isFinish && !picks.size) fail("invalid-argument", "Choose at least one stop to finish.");
  return picks;
}
function serviceRange(company, options) {
  const zone = timeZone(company, "America/Los_Angeles");
  const { startDate, endDate } = options;
  const start = calendarDate(startDate, zone, 0);
  calendarDate(endDate, zone, 0);
  const end = calendarDate(addCalendarDays(endDate, 1), zone, 0);
  if (startDate > endDate) fail("invalid-argument", "Choose a valid service date range.");
  return { start, end, zone };
}
function statusFor(work, now, pay) {
  if (["completed", "completedWithErrors"].includes(work.status)) {
    if (!pay) return "failed";
    if (pay.needsReviewCount || pay.conflictLineItemIds?.length) return "needsReview";
    return pay.lineItems.length ? "recorded" : "noPay";
  }
  if (work.status === "error" || work.status === "skipped") return "failed";
  const since = date(work.startedAt) || date(work.queuedAt);
  return since && now - since > RETRY_AFTER_MS ? "failed" : work.status;
}

function createPayrollStopCompletion(db, { payroll, requirePhoto, now = () => new Date(), serverTimestamp = now }) {
  const reader = { get: ref => ref.get() };
  const payRun = (company, runId) => company.collection("payrollStopCompletionRuns").doc(runId);
  const workFor = (company, stopId) => company.collection("serviceStopCompletionWork").doc(stopId);

  async function authorize(transaction, { auth }, companyId, edit = false) {
    if (companyId !== COMPANY_ID) fail("permission-denied", "This payroll action is available for Murdock Pool Service.");
    const actor = await companyActor(db, transaction, companyId, auth?.uid, auth?.token);
    if (!can(actor, "240") || !can(actor, "420") || edit && !can(actor, "244")) {
      fail("permission-denied", edit ? "View Payroll, View Service Stops, and Edit Service Stops access are required." : "View Payroll and View Service Stops access are required.");
    }
    return actor;
  }

  function execution(stop, zone, now) {
    const serviceDay = dateKey(stop.serviceDate, zone);
    const start = date(stop.startTime);
    const recordedMinutes = Number(stop.actualDuration);
    const hasActualDuration = Number.isFinite(recordedMinutes) && recordedMinutes > 0;
    // A historical service date places flat pay in the correct period. Only a
    // recorded duration can supply actual hours for a historical completion.
    const recordedEnd = start && hasActualDuration ? new Date(start.getTime() + recordedMinutes * 60000) : null;
    const verifiedEnd = recordedEnd && recordedEnd <= now && dateKey(recordedEnd, zone) === serviceDay ? recordedEnd : null;
    const finish = verifiedEnd || (serviceDay === dateKey(now, zone) ? now : date(stop.serviceDate));
    return {
      operationStatus: "Finished",
      completedAt: finish,
      ...(verifiedEnd ? { endTime: verifiedEnd } : {}),
      duration: hasActualDuration ? recordedMinutes : null,
    };
  }

  async function inspect(transaction, company, snapshot, pick, actor, range, config, at) {
    const stop = snapshot.data();
    if (!stop || !openStop(stop)) return null;
    const serviceDate = date(stop.serviceDate);
    const day = serviceDate && dateKey(serviceDate, range.zone);
    if (!day || day > dateKey(at, range.zone) || serviceDate < range.start || serviceDate >= range.end) return null;

    const tasks = (await transaction.get(snapshot.ref.collection("tasks"))).docs;
    const pending = tasks.filter(task => openTask(task.data()));
    const linkedJobId = asId(stop.jobId || stop.workOrderId);
    const jobTasks = company.collection("workOrders").doc(linkedJobId || "_").collection("tasks");
    const choices = await Promise.all(pending.map(async task => {
      const data = task.data();
      const linked = asId(data.jobTaskId || data.workOrderTaskId);
      let reason = "";
      let canonical = null;
      if (["install", "installation", "remove", "removal", "replace", "replacement", "fillwater", "emptywater"].includes(key(data.type))) {
        reason = "Finish this task from the service stop so equipment or water history is recorded.";
      } else if (linked) {
        if (stop.otherCompany === true || !linkedJobId) {
          reason = "Finish this linked task from its job.";
        } else {
          canonical = await transaction.get(jobTasks.doc(linked));
          if (!canonical.exists || !openTask(canonical.data()) && !["finished", "complete", "completed", "done"].includes(key(canonical.data()?.status))) {
            reason = "The linked job task is unavailable for completion.";
          } else if (openTask(canonical.data()) && !can(actor, "24") && canonical.data().workerId !== actor.uid) {
            reason = "Edit Jobs access is required to finish the linked task.";
          } else if (asId(canonical.data().serviceStopId) && asId(canonical.data().serviceStopId) !== snapshot.id) {
            reason = "The linked job task is assigned to another visit.";
          }
        }
      }
      return { task, canonical, reason, title: data.name || data.type || "Service task",
        technicianName: data.workerName || stop.tech || stop.technicianName || "" };
    }));
    const selected = (pick?.taskIds || []).map(taskId => choices.find(choice => choice.task.id === taskId));
    const patch = execution(stop, range.zone, at);
    const version = fingerprint([
      snapshotVersion(snapshot), tasks.map(snapshotVersion),
      selected.map(choice => choice?.canonical ? snapshotVersion(choice.canonical) : null),
      pick?.taskIds || [],
    ]);
    const item = {
      stopId: snapshot.id, version, serviceDate: day, title: stop.type || "Service stop",
      customerName: stop.customerName || "", technicianName: stop.tech || stop.technicianName || "",
      technicianId: asId(stop.techId || stop.technicianId), offeredWork: Boolean(stop.workOfferId || stop.payrollAgreement?.offerId),
      tasks: choices.map(({ task, reason, title, technicianName }) => ({ id: task.id, reason, title, technicianName })),
      selectedTaskIds: pick?.taskIds || [],
    };
    let blockedReason = "";
    if (requirePhoto(config, stop) && (!Array.isArray(stop.photoUrls) || !stop.photoUrls.length)) {
      blockedReason = "A service photo is required to finish this stop.";
    }
    if (!blockedReason) {
      try {
        await assertServiceOnboardingReady(transaction, db, company.id, stop);
      } catch (error) {
        blockedReason = readableError(error);
        if (!blockedReason) throw error;
      }
    }
    if (selected.some(choice => !choice || choice.reason)) blockedReason = "A selected task changed or must be finished from its service stop.";
    const taskPatch = { status: "Finished", completedAt: patch.completedAt };
    return { stop, patch, item: { ...item, blockedReason }, selected, taskPatch, simulation: {
      stop: patch, tasks: new Map(selected.filter(choice => choice && !choice.reason).map(choice => [choice.task.id, taskPatch])),
    } };
  }

  async function preview(company, options, actor) {
    const picks = picksFrom(options.stops || [], false);
    const at = now();
    const range = serviceRange(actor.company, options);
    const configRef = company.collection("settings").doc("emailConfiguration");
    const [snapshot, config, cached] = await Promise.all([
      company.collection("serviceStops").where("serviceDate", ">=", range.start).where("serviceDate", "<", range.end).limit(MAX_SCAN + 1).get(),
      configRef.get(),
      payroll.loadStopPayContext(company.id),
    ]);
    if (snapshot.size > MAX_SCAN) fail("resource-exhausted", "Choose a shorter service date range to preview payroll.");
    const candidates = snapshot.docs.filter(snap => openStop(snap.data()) && dateKey(snap.data().serviceDate, range.zone) <= dateKey(at, range.zone));
    const items = [];
    // Bound the concurrent Firestore work for large date ranges.
    for (let offset = 0; offset < candidates.length; offset += 10) {
      const page = await Promise.all(candidates.slice(offset, offset + 10).map(async snap => {
        const plan = await inspect(reader, company, snap, picks.get(snap.id), actor, range, config.data() || {}, at);
        if (!plan || plan.item.blockedReason) return plan?.item;
        const pay = await payroll.reconcileStop(company.id, snap.id, { simulation: plan.simulation, includeLineItems: true, loadBatchContext: () => cached });
        return { ...plan.item, pay };
      }));
      items.push(...page.filter(Boolean));
    }
    return { items, maxStops: MAX_STOPS, timeZone: range.zone };
  }

  async function finish(company, options, request) {
    const requestId = documentId(options.runId, "Run");
    const picks = picksFrom(options.stops, true);
    const signature = fingerprint([options.startDate, options.endDate, [...picks.values()]]);
    const runRef = payRun(company, requestId);
    const at = now();
    await db.runTransaction(async tx => {
      const actor = await authorize(tx, request, company.id, true);
      const existing = await tx.get(runRef);
      if (existing.exists) {
        if (existing.data().fingerprint !== signature) fail("already-exists", "This run was already submitted with a different selection.");
        return;
      }
      const range = serviceRange(actor.company, options);
      const config = (await tx.get(company.collection("settings").doc("emailConfiguration"))).data() || {};
      const plans = await Promise.all([...picks.values()].map(async pick => {
        const snapshot = await tx.get(company.collection("serviceStops").doc(pick.stopId));
        const plan = await inspect(tx, company, snapshot, pick, actor, range, config, at);
        if (!plan || plan.item.version !== pick.version || plan.item.blockedReason) {
          fail("failed-precondition", plan?.item.blockedReason || "A selected stop or its tasks changed. Refresh the payroll preview.");
        }
        return { ...plan, ref: snapshot.ref };
      }));
      const taskPaths = plans.flatMap(plan => plan.selected.flatMap(({ task, canonical }) => [task.ref.path, ...(canonical && openTask(canonical.data()) ? [canonical.ref.path] : [])]));
      if (taskPaths.length + plans.length * 2 > 400) fail("resource-exhausted", "Confirm fewer stops or tasks at a time.");
      if (new Set(taskPaths).size !== taskPaths.length) fail("failed-precondition", "A linked job task appears on multiple selected stops. Confirm it on one visit.");
      for (const { stop, item, patch, ref, selected, taskPatch } of plans) {
        const queuedAt = serverTimestamp();
        tx.update(ref, {
          ...patch, manuallyFinished: true, manualFinishSource: SOURCE, completedByUserId: actor.uid,
          completedWithoutCustomerEmail: true, updatedAt: queuedAt,
          completionWorkStatus: "queued", completionWorkRequestId: requestId, completionWorkQueuedAt: queuedAt,
          completionWorkQueuedByUserId: actor.uid, completionWorkSendServiceReport: false,
        });
        tx.set(workFor(company, ref.id), {
          id: ref.id, requestId, companyId: company.id, serviceStopId: ref.id, status: "queued",
          source: SOURCE, queuedAt, queuedByUserId: actor.uid, sendServiceReport: false, operationStatus: "Finished",
          serviceDate: stop.serviceDate, techId: item.technicianId, techName: item.technicianName, attempts: 0,
          startedAt: null, result: null, errorMessages: [],
        });
        const taskUpdate = { ...taskPatch, completedByUserId: actor.uid, updatedAt: queuedAt };
        for (const { task, canonical } of selected) {
          if (canonical && openTask(canonical.data())) tx.update(canonical.ref, taskUpdate);
          tx.update(task.ref, taskUpdate);
        }
      }
      tx.create(runRef, {
        requestedBy: actor.uid, fingerprint: signature, createdAt: at,
        items: plans.map(({ item, selected }) => ({
          stopId: item.stopId, title: item.title, customerName: item.customerName, technicianId: item.technicianId,
          technicianName: item.technicianName, serviceDate: item.serviceDate, finishedTaskCount: selected.length,
        })),
      });
    });
    return status(company, requestId);
  }

  async function getRun(company, runId, transaction = reader) {
    const run = (await transaction.get(payRun(company, runId))).data();
    if (!run) fail("not-found", "This completion run is no longer available.");
    return run;
  }

  async function status(company, runId) {
    return db.runTransaction(async tx => {
      const run = await getRun(company, runId, tx);
      const [work, receipts] = await Promise.all([
        tx.getAll(...run.items.map(item => workFor(company, item.stopId))),
        tx.getAll(...run.items.map(item => payRun(company, runId).collection("results").doc(item.stopId))),
      ]);
      const items = run.items.map((item, index) => {
        const data = work[index].data();
        if (data?.requestId !== runId) return { ...item, status: "superseded", errorMessages: ["A newer stop completion replaced this run."] };
        const receipt = receipts[index].data();
        const pay = receipt?.attempt === data.attempts && ["completed", "completedWithErrors"].includes(data.status) ? receipt.pay : null;
        const status = statusFor(data, now(), pay);
        const messages = data.errorMessages || [];
        return { ...item, status, pay, errorMessages: status === "failed" && messages.length === 0
          ? [data.skippedReason || "Payroll did not finish processing. Retry this stop."] : messages };
      });
      return { runId, items, pending: items.some(item => ["queued", "processing"].includes(item.status)) };
    }, { readOnly: true });
  }

  async function retry(company, options, request) {
    const runId = documentId(options.runId, "Run");
    const stopId = documentId(options.stopId, "Service stop");
    await db.runTransaction(async tx => {
      const actor = await authorize(tx, request, company.id, true);
      const run = await getRun(company, runId, tx);
      if (!run.items.some(item => item.stopId === stopId)) fail("not-found", "This stop is outside the selected run.");
      const ref = workFor(company, stopId);
      const [workSnapshot, stopSnapshot, receipt] = await Promise.all([tx.get(ref), tx.get(company.collection("serviceStops").doc(stopId)),
        tx.get(payRun(company, runId).collection("results").doc(stopId))]);
      const work = workSnapshot.data(), stop = stopSnapshot.data();
      if (work?.source !== SOURCE || work.requestId !== runId || stop?.completionWorkRequestId !== runId || stop.operationStatus !== "Finished") {
        fail("failed-precondition", "This completion was changed. Review the current service stop.");
      }
      if (statusFor(work, now(), receipt.data()?.attempt === work.attempts ? receipt.data().pay : null) !== "failed") return;
      tx.update(ref, { status: "queued", queuedAt: serverTimestamp(), retriedByUserId: actor.uid, sendServiceReport: false,
        startedAt: null, errorMessages: [], result: null });
      tx.update(stopSnapshot.ref, { completionWorkStatus: "queued" });
    });
    return status(company, runId);
  }

  return async request => {
    const options = request.data || {};
    const companyId = documentId(options.companyId, "Company");
    const actor = await authorize(reader, request, companyId, ["finish", "retry"].includes(options.action));
    const company = db.collection("companies").doc(companyId);
    switch (options.action) {
      case "preview": return preview(company, options, actor);
      case "finish": return finish(company, options, request);
      case "status": return status(company, documentId(options.runId, "Run"));
      case "retry": return retry(company, options, request);
      default: fail("invalid-argument", "Choose a payroll stop completion action.");
    }
  };
}

module.exports = { createPayrollStopCompletion, SOURCE, COMPANY_ID };
