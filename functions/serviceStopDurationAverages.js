const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const { reportCloudFunctionError } = require("./appErrorReporting");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = getFirestore();
const MAX_REASONABLE_STOP_DURATION_MINUTES = 24 * 60;

const finishedStatuses = new Set([
  "complete",
  "completed",
  "done",
  "finished",
]);

function normalizeCallableData(request) {
  return request?.data?.data ?? request?.data ?? {};
}

function cleanString(value) {
  return String(value || "").trim();
}

function durationFailureSeverity(error) {
  return ["invalid-argument", "unauthenticated", "permission-denied", "not-found"].includes(error?.code)
    ? "warning"
    : "error";
}

async function reportDurationFunctionError(error, {
  functionName,
  eventName,
  data = {},
  auth = null,
  title,
  description,
} = {}) {
  await reportCloudFunctionError(error, {
    functionName,
    eventName,
    companyId: cleanString(data.companyId),
    recurringServiceStopId: cleanString(data.recurringServiceStopId),
    userId: auth?.uid || "",
    title,
    description,
    severity: durationFailureSeverity(error),
    data,
  });
}

function normalizeRecurringServiceStopId(value) {
  if (typeof value === "string") return cleanString(value);
  if (value && typeof value === "object") return cleanString(value.id || value.recurringServiceStopId);
  return "";
}

function numberFrom(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function dateFromValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  if (typeof value === "object") {
    if (typeof value._seconds === "number") return new Date(value._seconds * 1000);
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function millisFromValue(value) {
  return dateFromValue(value)?.getTime() || 0;
}

function firstPresentDate(...values) {
  for (const value of values) {
    const date = dateFromValue(value);
    if (date) return date;
  }
  return null;
}

function isFinishedServiceStop(serviceStop = {}) {
  const status = cleanString(serviceStop.operationStatus || serviceStop.status).toLowerCase();
  return finishedStatuses.has(status)
    || Boolean(dateFromValue(serviceStop.finishedAt))
    || Boolean(dateFromValue(serviceStop.completedAt))
    || Boolean(dateFromValue(serviceStop.endTime));
}

function normalizeDurationMinutes(serviceStop = {}) {
  const explicitDuration = numberFrom(serviceStop.duration);
  if (explicitDuration !== null && explicitDuration > 0) {
    return Math.round(explicitDuration);
  }

  const start = dateFromValue(serviceStop.startTime);
  const end = firstPresentDate(serviceStop.endTime, serviceStop.finishedAt, serviceStop.completedAt);
  if (!start || !end) return null;

  const computed = Math.round((end.getTime() - start.getTime()) / 60000);
  return computed > 0 ? computed : null;
}

function isValidDurationMinutes(durationMinutes) {
  return Number.isFinite(durationMinutes)
    && durationMinutes > 0
    && durationMinutes <= MAX_REASONABLE_STOP_DURATION_MINUTES;
}

function didCompletionDurationChange(before = {}, after = {}) {
  const beforeFinished = isFinishedServiceStop(before);
  const afterFinished = isFinishedServiceStop(after);
  if (!afterFinished) return false;
  if (!beforeFinished) return true;

  return normalizeRecurringServiceStopId(before.recurringServiceStopId) !== normalizeRecurringServiceStopId(after.recurringServiceStopId)
    || normalizeDurationMinutes(before) !== normalizeDurationMinutes(after)
    || millisFromValue(before.completedAt || before.finishedAt || before.endTime) !== millisFromValue(after.completedAt || after.finishedAt || after.endTime);
}

function durationHistoryCollection(companyId, recurringServiceStopId) {
  return db
    .collection("companies")
    .doc(companyId)
    .collection("recurringServiceStop")
    .doc(recurringServiceStopId)
    .collection("durationHistory");
}

function recurringServiceStopRef(companyId, recurringServiceStopId) {
  return db
    .collection("companies")
    .doc(companyId)
    .collection("recurringServiceStop")
    .doc(recurringServiceStopId);
}

function serviceStopsCollection(companyId) {
  return db
    .collection("companies")
    .doc(companyId)
    .collection("serviceStops");
}

async function assertCompanyAccess(companyId, auth) {
  const uid = auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to manage recurring service stop duration history.");
  }

  const [userSnap, accessSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("users").doc(uid).collection("userAccess").doc(companyId).get(),
  ]);

  if (accessSnap.exists || userSnap.data()?.accountType === "Admin") {
    return;
  }

  throw new HttpsError("permission-denied", "You do not have access to this company.");
}

async function commitBatches(operations) {
  let committed = 0;

  for (let index = 0; index < operations.length; index += 450) {
    const batch = db.batch();
    const chunk = operations.slice(index, index + 450);

    chunk.forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });

    await batch.commit();
    committed += chunk.length;
  }

  return committed;
}

async function syncFutureServiceStopEstimates({
  companyId,
  recurringServiceStopId,
  estimateMinutes,
  source,
}) {
  if (!isValidDurationMinutes(estimateMinutes)) {
    return 0;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const futureStopsSnap = await serviceStopsCollection(companyId)
    .where("recurringServiceStopId", "==", recurringServiceStopId)
    .where("serviceDate", ">=", Timestamp.fromDate(today))
    .get();

  const operations = futureStopsSnap.docs
    .filter((serviceStopDoc) => !isFinishedServiceStop(serviceStopDoc.data() || {}))
    .map((serviceStopDoc) => ({
      ref: serviceStopDoc.ref,
      data: {
        duration: estimateMinutes,
        estimatedDuration: estimateMinutes,
        adaptiveEstimatedDuration: estimateMinutes,
        durationEstimateSource: source,
        durationEstimateUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    }));

  return commitBatches(operations);
}

async function recalculateRecurringServiceStopDurationEstimate({
  companyId,
  recurringServiceStopId,
  updateEstimateFromAverage = true,
  backfillFromServiceStops = false,
}) {
  const rssRef = recurringServiceStopRef(companyId, recurringServiceStopId);
  const rssSnap = await rssRef.get();

  if (!rssSnap.exists) {
    return {
      success: false,
      reason: "recurring_service_stop_not_found",
      recurringServiceStopId,
      sampleCount: 0,
    };
  }

  const backfilledCount = backfillFromServiceStops
    ? await backfillDurationHistoryFromCompletedServiceStops({ companyId, recurringServiceStopId })
    : 0;
  const historySnap = await durationHistoryCollection(companyId, recurringServiceStopId).get();
  const includedPoints = historySnap.docs
    .map((pointDoc) => ({ id: pointDoc.id, ...pointDoc.data() }))
    .filter((point) => point.includedInAverage !== false)
    .map((point) => ({
      ...point,
      durationMinutes: Math.round(Number(point.durationMinutes || 0)),
    }))
    .filter((point) => isValidDurationMinutes(point.durationMinutes));

  const sampleCount = includedPoints.length;
  const totalMinutes = includedPoints.reduce((total, point) => total + point.durationMinutes, 0);
  const averageMinutesExact = sampleCount ? totalMinutes / sampleCount : null;
  const averageMinutes = sampleCount ? Math.round(averageMinutesExact) : null;
  const latestPoint = includedPoints
    .slice()
    .sort((left, right) => millisFromValue(right.completedAt || right.serviceDate || right.createdAt) - millisFromValue(left.completedAt || left.serviceDate || left.createdAt))[0];

  const durationStats = {
    averageMinutes,
    averageMinutesExact: averageMinutesExact === null ? null : Number(averageMinutesExact.toFixed(2)),
    sampleCount,
    totalMinutes,
    lastDurationMinutes: latestPoint?.durationMinutes ?? null,
    lastServiceStopId: latestPoint?.serviceStopId || "",
    updatedAt: FieldValue.serverTimestamp(),
  };

  const updateData = {
    durationStats,
    historicalAverageDuration: averageMinutes,
    historicalDurationSampleCount: sampleCount,
    adaptiveDurationUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  let updatedFutureServiceStops = 0;
  if (sampleCount && updateEstimateFromAverage) {
    updateData.estimatedTime = averageMinutes;
    updateData.estimatedDuration = averageMinutes;
    updateData.adaptiveEstimatedDuration = averageMinutes;
    updateData.durationEstimateSource = "durationHistory";
    updateData.durationEstimateUpdatedAt = FieldValue.serverTimestamp();
  } else if (!sampleCount) {
    updateData.durationEstimateSource = "manual";
    updateData.durationEstimateUpdatedAt = FieldValue.serverTimestamp();
  }

  await rssRef.set(updateData, { merge: true });

  if (sampleCount && updateEstimateFromAverage) {
    updatedFutureServiceStops = await syncFutureServiceStopEstimates({
      companyId,
      recurringServiceStopId,
      estimateMinutes: averageMinutes,
      source: "durationHistory",
    });
  }

  return {
    success: true,
    recurringServiceStopId,
    averageMinutes,
    averageMinutesExact: durationStats.averageMinutesExact,
    sampleCount,
    totalMinutes,
    lastDurationMinutes: durationStats.lastDurationMinutes,
    updatedFutureServiceStops,
    backfilledCount,
  };
}

async function backfillDurationHistoryFromCompletedServiceStops({ companyId, recurringServiceStopId }) {
  const serviceStopsSnap = await serviceStopsCollection(companyId)
    .where("recurringServiceStopId", "==", recurringServiceStopId)
    .get();

  let backfilledCount = 0;
  for (const serviceStopDoc of serviceStopsSnap.docs) {
    const serviceStop = serviceStopDoc.data() || {};
    if (!isFinishedServiceStop(serviceStop)) continue;

    const durationMinutes = normalizeDurationMinutes(serviceStop);
    if (!isValidDurationMinutes(durationMinutes)) continue;

    const result = await writeDurationPointForFinishedStop({
      companyId,
      serviceStopId: serviceStopDoc.id,
      serviceStop,
    });
    if (result) backfilledCount += 1;
  }

  return backfilledCount;
}

async function writeDurationPointForFinishedStop({ companyId, serviceStopId, serviceStop }) {
  const recurringServiceStopId = normalizeRecurringServiceStopId(serviceStop.recurringServiceStopId);
  const durationMinutes = normalizeDurationMinutes(serviceStop);

  if (!recurringServiceStopId || !isValidDurationMinutes(durationMinutes)) {
    return null;
  }

  const completedAt = firstPresentDate(serviceStop.completedAt, serviceStop.finishedAt, serviceStop.endTime);
  const serviceDate = dateFromValue(serviceStop.serviceDate);
  const pointRef = durationHistoryCollection(companyId, recurringServiceStopId).doc(serviceStopId);
  const existingPointSnap = await pointRef.get();

  await pointRef.set({
    id: serviceStopId,
    serviceStopId,
    serviceStopInternalId: serviceStop.internalId || "",
    recurringServiceStopId,
    companyId,
    customerId: serviceStop.customerId || "",
    customerName: serviceStop.customerName || "",
    serviceLocationId: serviceStop.serviceLocationId || "",
    techId: serviceStop.techId || "",
    techName: serviceStop.tech || serviceStop.techName || "",
    durationMinutes,
    estimatedDurationAtCompletion: Number(serviceStop.estimatedDuration || serviceStop.estimatedTime || 0),
    serviceDate: serviceDate ? Timestamp.fromDate(serviceDate) : null,
    completedAt: completedAt ? Timestamp.fromDate(completedAt) : FieldValue.serverTimestamp(),
    includedInAverage: existingPointSnap.exists
      ? existingPointSnap.data()?.includedInAverage !== false
      : true,
    source: "service_stop_finished",
    createdAt: existingPointSnap.exists
      ? existingPointSnap.data()?.createdAt || FieldValue.serverTimestamp()
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    recurringServiceStopId,
    durationMinutes,
  };
}

exports.onServiceStopDurationCompleted = onDocumentUpdated(
  "companies/{companyId}/serviceStops/{serviceStopId}",
  async (event) => {
    const companyId = event.params.companyId;
    const serviceStopId = event.params.serviceStopId;
    let recurringServiceStopId = "";

    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      recurringServiceStopId = normalizeRecurringServiceStopId(after.recurringServiceStopId);

      if (!didCompletionDurationChange(before, after)) {
        return null;
      }

      const result = await writeDurationPointForFinishedStop({
        companyId,
        serviceStopId,
        serviceStop: after,
      });

      if (!result) {
        return null;
      }

      recurringServiceStopId = result.recurringServiceStopId;
      await recalculateRecurringServiceStopDurationEstimate({
        companyId,
        recurringServiceStopId: result.recurringServiceStopId,
        updateEstimateFromAverage: true,
        backfillFromServiceStops: true,
      });

      return null;
    } catch (error) {
      await reportDurationFunctionError(error, {
        functionName: "onServiceStopDurationCompleted",
        eventName: "service-stop-duration-completed",
        title: "Service stop duration completion sync failed",
        description: "The Firestore trigger that writes recurring service stop duration history failed.",
        data: {
          companyId,
          recurringServiceStopId,
          serviceStopId,
        },
      });
      throw error;
    }
  }
);

exports.onServiceStopDurationDeleted = onDocumentDeleted(
  "companies/{companyId}/serviceStops/{serviceStopId}",
  async (event) => {
    const companyId = event.params.companyId;
    const serviceStopId = event.params.serviceStopId;
    let recurringServiceStopId = "";

    try {
      const serviceStop = event.data?.data() || {};
      recurringServiceStopId = normalizeRecurringServiceStopId(serviceStop.recurringServiceStopId);

      if (!recurringServiceStopId) {
        return null;
      }

      await durationHistoryCollection(companyId, recurringServiceStopId).doc(serviceStopId).delete();
      await recalculateRecurringServiceStopDurationEstimate({
        companyId,
        recurringServiceStopId,
        updateEstimateFromAverage: true,
      });

      return null;
    } catch (error) {
      await reportDurationFunctionError(error, {
        functionName: "onServiceStopDurationDeleted",
        eventName: "service-stop-duration-deleted",
        title: "Service stop duration delete sync failed",
        description: "The Firestore trigger that removes recurring service stop duration history failed.",
        data: {
          companyId,
          recurringServiceStopId,
          serviceStopId,
        },
      });
      throw error;
    }
  }
);

exports.deleteRecurringServiceStopDurationPoint = onCall(async (request) => {
  const data = normalizeCallableData(request);
  const companyId = cleanString(data.companyId);
  const recurringServiceStopId = cleanString(data.recurringServiceStopId);
  const durationPointId = cleanString(data.durationPointId);

  try {
    if (!companyId || !recurringServiceStopId || !durationPointId) {
      throw new HttpsError("invalid-argument", "companyId, recurringServiceStopId, and durationPointId are required.");
    }

    await assertCompanyAccess(companyId, request.auth);
    await durationHistoryCollection(companyId, recurringServiceStopId).doc(durationPointId).set({
      includedInAverage: false,
      excludedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return await recalculateRecurringServiceStopDurationEstimate({
      companyId,
      recurringServiceStopId,
      updateEstimateFromAverage: true,
    });
  } catch (error) {
    await reportDurationFunctionError(error, {
      functionName: "deleteRecurringServiceStopDurationPoint",
      eventName: "delete-duration-point",
      auth: request.auth,
      title: "Recurring service stop duration point delete failed",
      description: "The callable that excludes a recurring service stop duration point failed.",
      data: {
        companyId,
        recurringServiceStopId,
        durationPointId,
      },
    });
    throw error;
  }
});

exports.clearRecurringServiceStopDurationHistory = onCall(async (request) => {
  const data = normalizeCallableData(request);
  const companyId = cleanString(data.companyId);
  const recurringServiceStopId = cleanString(data.recurringServiceStopId);

  try {
    if (!companyId || !recurringServiceStopId) {
      throw new HttpsError("invalid-argument", "companyId and recurringServiceStopId are required.");
    }

    await assertCompanyAccess(companyId, request.auth);

    const snap = await durationHistoryCollection(companyId, recurringServiceStopId).get();
    let deletedCount = snap.size;
    for (let index = 0; index < snap.docs.length; index += 450) {
      const batch = db.batch();
      snap.docs.slice(index, index + 450).forEach((pointDoc) => {
        batch.set(pointDoc.ref, {
          includedInAverage: false,
          excludedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
    }

    const result = await recalculateRecurringServiceStopDurationEstimate({
      companyId,
      recurringServiceStopId,
      updateEstimateFromAverage: false,
    });

    return {
      ...result,
      deletedCount,
    };
  } catch (error) {
    await reportDurationFunctionError(error, {
      functionName: "clearRecurringServiceStopDurationHistory",
      eventName: "clear-duration-history",
      auth: request.auth,
      title: "Recurring service stop duration history clear failed",
      description: "The callable that excludes all duration history for a recurring service stop failed.",
      data: {
        companyId,
        recurringServiceStopId,
      },
    });
    throw error;
  }
});

exports.recalculateRecurringServiceStopDurationEstimate = onCall(async (request) => {
  const data = normalizeCallableData(request);
  const companyId = cleanString(data.companyId);
  const recurringServiceStopId = cleanString(data.recurringServiceStopId);

  try {
    if (!companyId || !recurringServiceStopId) {
      throw new HttpsError("invalid-argument", "companyId and recurringServiceStopId are required.");
    }

    await assertCompanyAccess(companyId, request.auth);

    return await recalculateRecurringServiceStopDurationEstimate({
      companyId,
      recurringServiceStopId,
      updateEstimateFromAverage: true,
      backfillFromServiceStops: true,
    });
  } catch (error) {
    await reportDurationFunctionError(error, {
      functionName: "recalculateRecurringServiceStopDurationEstimate",
      eventName: "recalculate-duration-estimate",
      auth: request.auth,
      title: "Recurring service stop duration estimate recalculation failed",
      description: "The callable that recalculates a recurring service stop duration estimate failed.",
      data: {
        companyId,
        recurringServiceStopId,
      },
    });
    throw error;
  }
});

exports.setRecurringServiceStopEstimatedDuration = onCall(async (request) => {
  const data = normalizeCallableData(request);
  const companyId = cleanString(data.companyId);
  const recurringServiceStopId = cleanString(data.recurringServiceStopId);
  const estimateMinutes = Math.round(Number(data.estimatedMinutes));

  try {
    if (!companyId || !recurringServiceStopId) {
      throw new HttpsError("invalid-argument", "companyId and recurringServiceStopId are required.");
    }

    if (!isValidDurationMinutes(estimateMinutes)) {
      throw new HttpsError("invalid-argument", "Estimated duration must be between 1 and 1,440 minutes.");
    }

    await assertCompanyAccess(companyId, request.auth);

    const rssRef = recurringServiceStopRef(companyId, recurringServiceStopId);
    const rssSnap = await rssRef.get();
    if (!rssSnap.exists) {
      throw new HttpsError("not-found", "Recurring service stop was not found.");
    }

    await rssRef.set({
      estimatedTime: estimateMinutes,
      estimatedDuration: estimateMinutes,
      adaptiveEstimatedDuration: estimateMinutes,
      durationEstimateSource: "manual",
      durationEstimateUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const updatedFutureServiceStops = await syncFutureServiceStopEstimates({
      companyId,
      recurringServiceStopId,
      estimateMinutes,
      source: "manual",
    });

    return {
      success: true,
      recurringServiceStopId,
      estimateMinutes,
      updatedFutureServiceStops,
    };
  } catch (error) {
    await reportDurationFunctionError(error, {
      functionName: "setRecurringServiceStopEstimatedDuration",
      eventName: "set-manual-duration-estimate",
      auth: request.auth,
      title: "Recurring service stop manual duration save failed",
      description: "The callable that saves a manual recurring service stop duration estimate failed.",
      data: {
        companyId,
        recurringServiceStopId,
        estimateMinutes,
      },
    });
    throw error;
  }
});
