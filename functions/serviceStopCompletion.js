const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { sendServiceReportOnFinishCore } = require("./sendGrid/general");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const SERVICE_STOP_FINISHED = "Finished";
const ACTIVE_ROUTE_FINISHED = "Finished";
const ACTIVE_ROUTE_IN_PROGRESS = "In Progress";
const ACTIVE_ROUTE_DID_NOT_START = "Did Not Start";
const ACTIVE_ROUTE_TRAVELING = "Traveling";
const ACTIVE_ROUTE_ON_BREAK = "Break";

const SERVICE_STOP_CATEGORIES = {
  route: "Route",
  job: "Job",
  jobEstimate: "Job Estimate",
  serviceAgreementEstimate: "Service Agreement Estimate",
  customerRelationship: "Customer Relationship",
};

const PAYROLL_SOURCE_IDS = {
  recurringServiceStop: "system_recurring_service_stop",
  commercialRoute: "system_recurring_commercial_pay_type",
  jobServiceStop: "system_job_service_stop",
  jobSaltCellCleaning: "system_job_salt_cell_cleaning_pay_type",
  jobEstimateServiceStop: "system_job_estimate_service_stop",
  serviceAgreementEstimateServiceStop: "system_service_agreement_estimate_service_stop",
  customerRelationshipServiceStop: "system_customer_relationship_service_stop",
};

const blankToNull = (value) => {
  const text = cleanString(value);
  return text.length > 0 ? text : null;
};

function cleanString(value) {
  return String(value || "").trim();
}

function normalizedKey(value) {
  return cleanString(value).toLowerCase().replace(/[\s_/-]+/g, "");
}

function numberFrom(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateFromValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === "object" && typeof value._seconds === "number") {
    return new Date(value._seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firestoreTimestamp(value, fallback = new Date()) {
  return Timestamp.fromDate(dateFromValue(value) || fallback);
}

function isFinishedStatus(value) {
  const normalized = normalizedKey(value);
  return normalized === "finished" || normalized === "complete" || normalized === "completed" || normalized === "done";
}

function isFinishedServiceStop(serviceStop = {}) {
  return isFinishedStatus(serviceStop.operationStatus || serviceStop.status);
}

function resolvedServiceStopCategory(serviceStop = {}) {
  const explicit = cleanString(serviceStop.category);
  const explicitKey = normalizedKey(explicit);

  for (const category of Object.values(SERVICE_STOP_CATEGORIES)) {
    if (explicitKey === normalizedKey(category)) {
      return category;
    }
  }

  switch (cleanString(serviceStop.typeId)) {
    case PAYROLL_SOURCE_IDS.recurringServiceStop:
    case PAYROLL_SOURCE_IDS.commercialRoute:
      return SERVICE_STOP_CATEGORIES.route;
    case PAYROLL_SOURCE_IDS.jobServiceStop:
    case PAYROLL_SOURCE_IDS.jobSaltCellCleaning:
      return SERVICE_STOP_CATEGORIES.job;
    case PAYROLL_SOURCE_IDS.jobEstimateServiceStop:
      return SERVICE_STOP_CATEGORIES.jobEstimate;
    case PAYROLL_SOURCE_IDS.serviceAgreementEstimateServiceStop:
      return SERVICE_STOP_CATEGORIES.serviceAgreementEstimate;
    case PAYROLL_SOURCE_IDS.customerRelationshipServiceStop:
      return SERVICE_STOP_CATEGORIES.customerRelationship;
    default:
      break;
  }

  if (cleanString(serviceStop.recurringServiceStopId)) {
    return SERVICE_STOP_CATEGORIES.route;
  }

  if (cleanString(serviceStop.jobId)) {
    return SERVICE_STOP_CATEGORIES.job;
  }

  const searchableText = `${cleanString(serviceStop.type)} ${cleanString(serviceStop.description)}`.toLowerCase();
  if (
    searchableText.includes("service agreement") ||
    searchableText.includes("recurring service estimate") ||
    searchableText.includes("new pool") ||
    searchableText.includes("new service") ||
    searchableText.includes("startup") ||
    searchableText.includes("start up")
  ) {
    return SERVICE_STOP_CATEGORIES.serviceAgreementEstimate;
  }

  if (searchableText.includes("estimate") || searchableText.includes("estiamte")) {
    return SERVICE_STOP_CATEGORIES.jobEstimate;
  }

  return SERVICE_STOP_CATEGORIES.route;
}

const { createPayrollWorkflow } = require("./payrollWorkflow");
const payroll = createPayrollWorkflow(db);
const generatePayForFinishedStop = ({ companyId, serviceStop }) => payroll.reconcileStop(companyId, serviceStop.id);

function routeStatus({ route, totalStops, finishedStops }) {
  if (totalStops > 0 && totalStops === finishedStops) {
    if (route.endMilage != null && route.endTime) {
      return ACTIVE_ROUTE_FINISHED;
    }

    if (route.status === ACTIVE_ROUTE_TRAVELING || route.status === ACTIVE_ROUTE_ON_BREAK) {
      return route.status;
    }

    return ACTIVE_ROUTE_IN_PROGRESS;
  }

  if (
    route.status === ACTIVE_ROUTE_IN_PROGRESS ||
    route.status === ACTIVE_ROUTE_TRAVELING ||
    route.status === ACTIVE_ROUTE_ON_BREAK
  ) {
    return route.status;
  }

  return finishedStops > 0 ? ACTIVE_ROUTE_IN_PROGRESS : ACTIVE_ROUTE_DID_NOT_START;
}

async function syncActiveRouteCounters({ companyId, serviceStopId }) {
  const companyRef = db.collection("companies").doc(companyId);
  const activeRoutesSnap = await companyRef
    .collection("activeRoutes")
    .where("serviceStopsIds", "array-contains", serviceStopId)
    .get();

  if (activeRoutesSnap.empty) {
    return { syncedRouteCount: 0 };
  }

  const batch = db.batch();
  let syncedRouteCount = 0;

  for (const routeDoc of activeRoutesSnap.docs) {
    const route = { ...routeDoc.data(), id: routeDoc.id };
    const serviceStopIds = Array.isArray(route.serviceStopsIds) ? route.serviceStopsIds.filter(Boolean) : [];
    const stopRefs = serviceStopIds.map((id) => companyRef.collection("serviceStops").doc(id));
    const stopDocs = stopRefs.length > 0 ? await db.getAll(...stopRefs) : [];
    const finishedStops = stopDocs.filter((doc) => doc.exists && isFinishedServiceStop(doc.data() || {})).length;
    const totalStops = serviceStopIds.length;

    batch.set(routeDoc.ref, {
      finishedStops,
      totalStops,
      status: routeStatus({ route, totalStops, finishedStops }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    syncedRouteCount += 1;
  }

  await batch.commit();
  return { syncedRouteCount };
}

async function claimCompletionWork(workRef, requestId) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workRef);
    if (!snapshot.exists) return false;

    const fresh = snapshot.data() || {};
    if (fresh.status !== "queued") return false;
    if (requestId && fresh.requestId !== requestId) return false;

    transaction.set(workRef, {
      status: "processing",
      attempts: FieldValue.increment(1),
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return true;
  });
}

async function runCompletionStep(name, work) {
  try {
    return { name, result: await work() };
  } catch (error) {
    console.error(`[serviceStopCompletion][${name}]`, error);
    return {
      name,
      error: {
        message: error.message || String(error),
        code: error.code || null,
      },
    };
  }
}

exports.processServiceStopCompletionWork = onDocumentWritten(
  "companies/{companyId}/serviceStopCompletionWork/{workId}",
  async (event) => {
    if (!event.data?.after?.exists) return null;

    const workRef = event.data.after.ref;
    const work = event.data.after.data() || {};
    if (work.status !== "queued") return null;

    const requestId = cleanString(work.requestId);
    const claimed = await claimCompletionWork(workRef, requestId);
    if (!claimed) return null;

    const companyId = cleanString(event.params.companyId || work.companyId);
    const serviceStopId = cleanString(work.serviceStopId || event.params.workId);
    const serviceStopRef = db.collection("companies").doc(companyId).collection("serviceStops").doc(serviceStopId);

    try {
      const serviceStopDoc = await serviceStopRef.get();
      if (!serviceStopDoc.exists) {
        await workRef.set({
          status: "error",
          errorMessages: ["Service stop not found."],
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
      }

      const serviceStop = {
        ...serviceStopDoc.data(),
        id: cleanString(serviceStopDoc.data()?.id) || serviceStopDoc.id,
        companyId,
      };

      if (
        requestId &&
        cleanString(serviceStop.completionWorkRequestId) &&
        cleanString(serviceStop.completionWorkRequestId) !== requestId
      ) {
        await workRef.set({
          status: "skipped",
          skippedReason: "Stale completion request.",
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
      }

      if (!isFinishedServiceStop(serviceStop)) {
        await Promise.all([
          workRef.set({
            status: "skipped",
            skippedReason: "Service stop is no longer finished.",
            finishedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true }),
          serviceStopRef.set({
            completionWorkStatus: "skipped",
            completionWorkProcessedAt: FieldValue.serverTimestamp(),
            completionWorkErrorMessages: ["Service stop is no longer finished."],
          }, { merge: true }),
        ]);
        return null;
      }

      const shouldSendServiceReport = work.sendServiceReport !== false;
      const steps = [
        runCompletionStep("activeRoute", () => syncActiveRouteCounters({ companyId, serviceStopId })),
        runCompletionStep("payroll", () => generatePayForFinishedStop({ companyId, serviceStop })),
      ];

      if (shouldSendServiceReport) {
        steps.push(runCompletionStep("serviceReportEmail", () => sendServiceReportOnFinishCore({
          companyId,
          serviceStopId,
          serviceReportBaseUrl: work.serviceReportBaseUrl,
        })));
      }

      const stepResults = await Promise.all(steps);
      const errors = stepResults
        .filter((step) => step.error)
        .map((step) => `${step.name}: ${step.error.message}`);
      const stepResultMap = Object.fromEntries(stepResults.map((step) => [step.name, step.result || step.error]));
      const status = errors.length > 0 ? "completedWithErrors" : "completed";

      await Promise.all([
        serviceStopRef.set({
          completionWorkStatus: status,
          completionWorkProcessedAt: FieldValue.serverTimestamp(),
          completionWorkErrorMessages: errors,
          serviceReportLastResult: stepResultMap.serviceReportEmail || null,
          payrollLastProcessedAt: FieldValue.serverTimestamp(),
          payrollLastResult: stepResultMap.payroll || null,
          activeRouteLastSyncResult: stepResultMap.activeRoute || null,
        }, { merge: true }),
        workRef.set({
          status,
          result: stepResultMap,
          errorMessages: errors,
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
      ]);

      return null;
    } catch (error) {
      console.error("[serviceStopCompletion][processServiceStopCompletionWork]", error);

      const message = error.message || String(error);
      await Promise.all([
        workRef.set({
          status: "error",
          errorMessages: [message],
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        serviceStopRef.set({
          completionWorkStatus: "error",
          completionWorkProcessedAt: FieldValue.serverTimestamp(),
          completionWorkErrorMessages: [message],
        }, { merge: true }),
      ]);

      return null;
    }
  }
);

exports.reconcileServiceStopPayroll = onDocumentWritten({ document: "companies/{companyId}/serviceStops/{serviceStopId}", timeoutSeconds: 540, retry: true }, payroll.onStopWrite);
exports.reconcileServiceStopTaskPayroll = onDocumentWritten({ document: "companies/{companyId}/serviceStops/{serviceStopId}/tasks/{taskId}", timeoutSeconds: 540, retry: true }, payroll.onStopTaskWrite);
exports.reconcileJobTaskPayroll = onDocumentWritten({ document: "companies/{companyId}/workOrders/{jobId}/tasks/{taskId}", timeoutSeconds: 540, retry: true }, payroll.onJobTaskWrite);
exports.reconcileTechnicianRatePayroll = onDocumentWritten({ document: "companies/{companyId}/technicianRates/{rateId}", timeoutSeconds: 540, retry: true }, payroll.onRateWrite);
exports.reconcileCompanyPaySettings = onDocumentWritten({ document: "companies/{companyId}/paySettings/main", timeoutSeconds: 540, retry: true }, payroll.onSettingsWrite);
exports.reconcileCompanyPayrollSwitch = onDocumentWritten({ document: "companies/{companyId}/settings/companyWide", timeoutSeconds: 540, retry: true }, payroll.onSettingsWrite);
exports.reconcileCompanyPayType = onDocumentWritten({ document: "companies/{companyId}/companyPayTypes/{payTypeId}", timeoutSeconds: 540, retry: true }, payroll.onSettingsWrite);
exports.processPayrollReconcileWork = onDocumentWritten({ document: "companies/{companyId}/payrollReconcileWork/{workId}", timeoutSeconds: 540, retry: true }, payroll.processRefresh);

// Both apps can await the same authoritative result during explicit payroll actions.
exports.refreshServiceStopPayroll = require("firebase-functions/v2/https").onCall(
  { timeoutSeconds: 120 }, (request) => payroll.refreshRequestedStop(request)
);
