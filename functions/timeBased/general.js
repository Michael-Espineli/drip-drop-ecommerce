const { onSchedule } = require("firebase-functions/scheduler");
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onTaskDispatched } = require("firebase-functions/v2/tasks");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFunctions } = require("firebase-admin/functions");
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { sendSalesInvoiceEmailForAutomation } = require("../sendGrid/general");

// Initialize admin SDK if not already done
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = getFirestore();
const mySecret = defineSecret('stripe_secret_key');
const salesCollectionNames = {
  billingSubscriptions: "salesBillingSubscriptions",
  invoices: "salesInvoices",
};
const APP_ERRORS_COLLECTION = "appErrors";
const RECURRING_SERVICE_STOP_TASK_FUNCTION = "processRecurringServiceStopTask";
const RECURRING_SERVICE_STOP_TASK_DISPATCH_DEADLINE_SECONDS = 1800;
const RSS_TASK_ENQUEUE_BATCH_SIZE = 25;
const ADMIN_CALLABLE_CORS_ORIGINS = [
  "https://dripdrop-poolapp.com",
  "https://www.dripdrop-poolapp.com",
  "https://the-pool-app-dev.web.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

/**
 * Runs every Sunday at 00:00 America/New_York (explicit).
 */
exports.weeklySundayRSSCreate = onSchedule(
  { schedule: "every sunday 00:00", timeZone: "America/New_York", timeoutSeconds: 1800 },
  async (event) => {
    const runContext = {
      runId: buildWeeklyRssRunId(event),
      jobName: event?.jobName || "",
      scheduleTime: event?.scheduleTime || "",
    };

    console.log("Weekly Service Stop Generator Started");
    logRecurringServiceStopEvent("log", "run-start", {
      ...runContext,
    });

    const db = getFirestore();
    const companiesSnap = await db.collection("companies").get();
    const runSummary = {
      totalCompanies: companiesSnap.size,
      companiesVisited: 0,
      failedCompanies: 0,
      totalFetched: 0,
      enqueued: 0,
      alreadyQueued: 0,
      enqueueFailed: 0,
    };

    for (const companyDoc of companiesSnap.docs) {
      const companyId = companyDoc.id;
      try {
        console.log("  Company Id: " + companyId);
        logRecurringServiceStopEvent("log", "company-start", {
          ...runContext,
          companyId,
        });

        const companySummary = await processCompanyRecurringStops(companyId, runContext);
        runSummary.companiesVisited += 1;
        runSummary.totalFetched += companySummary.totalFetched;
        runSummary.enqueued += companySummary.enqueued;
        runSummary.alreadyQueued += companySummary.alreadyQueued;
        runSummary.enqueueFailed += companySummary.enqueueFailed;
      } catch (err) {
        runSummary.failedCompanies += 1;
        console.error(`Company ${companyId} failed`, err);
        logRecurringServiceStopEvent("error", "company-error", {
          ...runContext,
          companyId,
          error: summarizeError(err),
        });
        await reportCloudFunctionError(err, {
          ...runContext,
          companyId,
          eventName: "company-dispatch-error",
          title: `weeklySundayRSSCreate failed for company ${companyId}`,
          description: "The scheduled RSS dispatcher could not enqueue tasks for this company.",
          severity: "critical",
        });
      }
    }

    logRecurringServiceStopEvent("log", "run-complete", {
      ...runContext,
      ...runSummary,
    });
    console.log("Weekly Service Stop Generator Finished");
    return null;
  }
);

exports.processRecurringServiceStopTask = onTaskDispatched(
  {
    timeoutSeconds: RECURRING_SERVICE_STOP_TASK_DISPATCH_DEADLINE_SECONDS,
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 300,
      maxDoublings: 3,
    },
    rateLimits: {
      maxConcurrentDispatches: 6,
      maxDispatchesPerSecond: 3,
    },
  },
  async (request) => {
    const taskData = request.data || {};
    const taskContext = {
      taskId: request.id || "",
      queueName: request.queueName || "",
      retryCount: Number(request.retryCount || 0),
      executionCount: Number(request.executionCount || 0),
      scheduledTime: request.scheduledTime || "",
      previousResponse: request.previousResponse || "",
      retryReason: request.retryReason || "",
    };
    const companyId = taskData.companyId || "";
    const rssId = taskData.recurringServiceStopId || "";
    const startedAt = Date.now();

    if (!companyId || !rssId) {
      const error = new Error("Recurring service stop task is missing companyId or recurringServiceStopId.");
      logRecurringServiceStopEvent("error", "rss-task-invalid", {
        ...taskData,
        ...taskContext,
        error: summarizeError(error),
      });
      await reportCloudFunctionError(error, {
        ...taskData,
        ...taskContext,
        companyId,
        recurringServiceStopId: rssId,
        eventName: "rss-task-invalid",
        title: "Invalid weeklySundayRSSCreate task payload",
        description: "A Cloud Task was dispatched without the IDs required to process an RSS.",
        severity: "critical",
      });
      return;
    }

    logRecurringServiceStopEvent("log", "rss-worker-start", {
      ...taskData,
      ...taskContext,
    });

    try {
      const db = getFirestore();
      const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssId);
      const rssDoc = await rssRef.get();

      if (!rssDoc.exists) {
        logRecurringServiceStopEvent("warn", "rss-skipped", {
          ...taskData,
          ...taskContext,
          elapsedMs: Date.now() - startedAt,
          status: "skipped",
          reason: "rss_doc_not_found",
        });
        return;
      }

      const rssData = {
        ...rssDoc.data(),
        id: rssDoc.data()?.id || rssDoc.id,
      };
      const result = await expandRecurringServiceStop({
        companyId,
        rssData,
      });
      const normalizedResult = result?.status
        ? result
        : makeRssOutcome("skipped", "missing_expander_outcome", {
          rawOutcomeType: typeof result,
        });
      const logDetails = {
        ...taskData,
        ...taskContext,
        companyId,
        recurringServiceStopId: rssData.id,
        docId: rssDoc.id,
        elapsedMs: Date.now() - startedAt,
        ...getRssLogContext(rssData),
        ...normalizedResult,
      };

      if (normalizedResult.status === "skipped") {
        logRecurringServiceStopEvent("warn", "rss-skipped", logDetails);
      } else {
        logRecurringServiceStopEvent("log", "rss-created", logDetails);
      }
    } catch (error) {
      const errorDetails = {
        ...taskData,
        ...taskContext,
        companyId,
        recurringServiceStopId: rssId,
        elapsedMs: Date.now() - startedAt,
        error: summarizeError(error),
      };

      logRecurringServiceStopEvent("error", "rss-error", errorDetails);
      await reportCloudFunctionError(error, {
        ...errorDetails,
        eventName: "rss-worker-error",
        title: `RSS worker failed for ${rssId}`,
        description: "A weeklySundayRSSCreate Cloud Task failed while creating service stops.",
        severity: "error",
      });

      if (isPermanentRssError(error)) {
        return;
      }

      throw error;
    }
  }
);

exports.catchUpRecurringServiceStops = onCall(
  {
    cors: ADMIN_CALLABLE_CORS_ORIGINS,
    timeoutSeconds: 1800,
  },
  async (request) => {
    const payload = request.data || {};
    const authUserId = request.auth?.uid || "";
    const firestore = getFirestore();

    if (!authUserId) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const adminUserData = await getPlatformAdminUserData(firestore, authUserId);

    if (!adminUserData) {
      throw new HttpsError("permission-denied", "Only platform admins can run RSS catch-up.");
    }

    const companyIds = await resolveCatchUpCompanyIds(firestore, payload);
    const rssIds = normalizeStringArray([
      payload.recurringServiceStopId,
      payload.rssId,
      ...(Array.isArray(payload.recurringServiceStopIds) ? payload.recurringServiceStopIds : []),
      ...(Array.isArray(payload.rssIds) ? payload.rssIds : []),
    ]);

    if (rssIds.length > 0 && companyIds.length !== 1) {
      throw new HttpsError(
        "invalid-argument",
        "RSS ID filters require exactly one companyId so the catch-up can find the RSS documents."
      );
    }

    const runContext = {
      runId: buildManualRssRunId("catchup"),
      jobName: "manual-catch-up",
      scheduleTime: new Date().toISOString(),
      mode: "catch-up",
      requestedByUserId: authUserId,
      requestedByEmail: adminUserData.email || adminUserData.userEmail || "",
    };
    const summary = {
      ...runContext,
      totalCompanies: companyIds.length,
      companiesVisited: 0,
      failedCompanies: 0,
      totalFetched: 0,
      totalSelected: 0,
      enqueued: 0,
      alreadyQueued: 0,
      enqueueFailed: 0,
    };

    logRecurringServiceStopEvent("log", "catchup-start", {
      ...summary,
      companyIds,
      recurringServiceStopIds: rssIds,
    });

    for (const companyId of companyIds) {
      try {
        const companySummary = await processCompanyRecurringStops(companyId, runContext, {
          recurringServiceStopIds: rssIds,
        });
        summary.companiesVisited += 1;
        summary.totalFetched += companySummary.totalFetched;
        summary.totalSelected += companySummary.totalSelected;
        summary.enqueued += companySummary.enqueued;
        summary.alreadyQueued += companySummary.alreadyQueued;
        summary.enqueueFailed += companySummary.enqueueFailed;
      } catch (error) {
        summary.failedCompanies += 1;
        logRecurringServiceStopEvent("error", "catchup-company-error", {
          ...runContext,
          companyId,
          error: summarizeError(error),
        });
        await reportCloudFunctionError(error, {
          ...runContext,
          companyId,
          eventName: "catchup-company-error",
          title: `RSS catch-up failed for company ${companyId}`,
          description: "The manual RSS catch-up dispatcher could not enqueue tasks for this company.",
          severity: "critical",
        });
      }
    }

    logRecurringServiceStopEvent("log", "catchup-complete", summary);
    return summary;
  }
);

function logRecurringServiceStopEvent(level, eventName, details = {}) {
  const payload = {
    functionName: "weeklySundayRSSCreate",
    event: eventName,
    ...details,
  };

  let serializedPayload;
  try {
    serializedPayload = JSON.stringify(payload, (_key, value) => {
      if (value instanceof Date) return value.toISOString();
      if (typeof value?.toDate === "function") return value.toDate().toISOString();
      return value;
    });
  } catch (error) {
    serializedPayload = JSON.stringify({
      functionName: "weeklySundayRSSCreate",
      event: "log-serialization-error",
      originalEvent: eventName,
      error: summarizeError(error),
    });
  }

  const message = `[weeklySundayRSSCreate][${eventName}] ${serializedPayload}`;
  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else {
    console.log(message);
  }
}

function summarizeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || "",
    code: error?.code || "",
  };
}

function hashString(value, length = 32) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, length);
}

function buildWeeklyRssRunId(event) {
  const scheduleTime = event?.scheduleTime || new Date().toISOString();
  return `weekly_sunday_rss_${hashString(scheduleTime, 16)}`;
}

function buildManualRssRunId(label) {
  return `manual_${String(label || "rss").replace(/[^a-z0-9_-]/gi, "_")}_${hashString(`${Date.now()}|${uuidv4()}`, 16)}`;
}

function buildRssTaskId({ runId, companyId, recurringServiceStopId }) {
  return `rss_${hashString(`${runId}|${companyId}|${recurringServiceStopId}`, 40)}`;
}

function isTaskAlreadyExistsError(error) {
  return (
    error?.code === "functions/task-already-exists" ||
    /already exists/i.test(String(error?.message || ""))
  );
}

function isPermanentRssError(error) {
  return /^Invalid rssData\.day:/i.test(String(error?.message || ""));
}

function truncateString(value, maxLength = 1000) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function safeSerializeForAdminError(value, maxLength = 10000) {
  try {
    return truncateString(JSON.stringify(value || {}, (_key, nestedValue) => {
      if (nestedValue instanceof Date) return nestedValue.toISOString();
      if (typeof nestedValue?.toDate === "function") return nestedValue.toDate().toISOString();
      if (nestedValue instanceof Error) return summarizeError(nestedValue);
      if (typeof nestedValue === "function") return `[Function ${nestedValue.name || "anonymous"}]`;
      return nestedValue;
    }, 2), maxLength);
  } catch (error) {
    return truncateString(String(value || ""), maxLength);
  }
}

async function reportCloudFunctionError(error, context = {}) {
  try {
    const db = getFirestore();
    const normalizedError = summarizeError(error);
    const functionName = context.functionName || "weeklySundayRSSCreate";
    const eventName = context.eventName || "cloud-function-error";
    const recurringServiceStopId = context.recurringServiceStopId || "";
    const companyId = context.companyId || "";
    const fingerprint = [
      functionName,
      eventName,
      companyId,
      recurringServiceStopId,
      normalizedError.message,
    ].join("|").toLowerCase();
    const errorRef = db
      .collection(APP_ERRORS_COLLECTION)
      .doc(`cf_${hashString(fingerprint, 40)}`);
    const existingSnap = await errorRef.get();
    const existingStatus = existingSnap.exists ? existingSnap.data()?.status : "";
    const basePayload = {
      title: truncateString(context.title || `${functionName}: ${normalizedError.message}`, 220),
      description: truncateString(
        context.description || `A Cloud Function error was captured from ${functionName}.`,
        5000
      ),
      message: truncateString(normalizedError.message, 5000),
      where: truncateString(`${functionName}.${eventName}`, 500),
      severity: ["info", "warning", "error", "critical"].includes(context.severity)
        ? context.severity
        : "error",
      source: "cloud-function",
      userId: "",
      userEmail: "",
      accountType: "system",
      companyId: truncateString(companyId, 320),
      companyName: truncateString(context.companyName || "", 320),
      location: truncateString(`cloud-functions://${functionName}/${eventName}`, 1000),
      pathname: "/admin/errors",
      data: safeSerializeForAdminError({
        ...context,
        errorCode: normalizedError.code,
        recurringServiceStopId,
      }),
      stack: truncateString(normalizedError.stack, 15000),
      fingerprint: truncateString(fingerprint, 500),
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    };

    if (existingSnap.exists) {
      await errorRef.set({
        ...basePayload,
        status: existingStatus === "Ignored" ? "Ignored" : "New",
        occurrenceCount: FieldValue.increment(1),
      }, { merge: true });
    } else {
      await errorRef.set({
        ...basePayload,
        status: "New",
        occurrenceCount: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (loggingError) {
    console.error("Unable to report Cloud Function error to appErrors", loggingError);
  }
}

function dateToLog(value) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

function getRssLogContext(rssData = {}) {
  return {
    frequency: rssData.frequency || "",
    day: rssData.day || "",
    startDate: dateToLog(rssData.startDate),
    endDate: dateToLog(rssData.endDate),
    noEndDate: Boolean(rssData.noEndDate),
    lastCreated: dateToLog(rssData.lastCreated),
    serviceLocationId: rssData.serviceLocationId || "",
    customerId: rssData.customerId || "",
  };
}

function makeRssOutcome(status, reason, details = {}) {
  return {
    status,
    reason,
    ...details,
  };
}

function normalizeStringArray(values) {
  return Array.from(new Set(
    (values || [])
      .flat()
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

async function getPlatformAdminUserData(firestore, authUserId) {
  if (!authUserId) return null;

  const userSnap = await firestore.collection("users").doc(authUserId).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};

  return userData.accountType === "Admin" ? userData : null;
}

async function resolveCatchUpCompanyIds(firestore, payload = {}) {
  const requestedCompanyIds = normalizeStringArray([
    payload.companyId,
    ...(Array.isArray(payload.companyIds) ? payload.companyIds : []),
  ]);

  if (requestedCompanyIds.length > 0) {
    return requestedCompanyIds;
  }

  const companiesSnap = await firestore.collection("companies").get();
  return companiesSnap.docs.map((companyDoc) => companyDoc.id);
}

async function processCompanyRecurringStops(companyId, runContext = {}, options = {}) {
  const db = getFirestore();

  const rssSnap = await db
    .collection(`companies/${companyId}/recurringServiceStop`)
    .get();
  const selectedRssIds = new Set(normalizeStringArray(options.recurringServiceStopIds || []));
  const rssDocs = selectedRssIds.size
    ? rssSnap.docs.filter((rssDoc) => {
      const data = rssDoc.data() || {};
      return selectedRssIds.has(rssDoc.id) || selectedRssIds.has(data.id || "");
    })
    : rssSnap.docs;

  const summary = {
    ...runContext,
    companyId,
    totalFetched: rssSnap.size,
    totalSelected: rssDocs.length,
    enqueued: 0,
    alreadyQueued: 0,
    enqueueFailed: 0,
  };

  if (rssSnap.empty || rssDocs.length === 0) {
    logRecurringServiceStopEvent("log", "company-complete", summary);
    return summary;
  }

  console.log(`    [processCompanyRecurringStops]RSS Count: ${rssSnap.size}`);
  logRecurringServiceStopEvent("log", "company-rss-count", {
    ...runContext,
    companyId,
    totalFetched: rssSnap.size,
  });

  const taskQueue = getFunctions().taskQueue(RECURRING_SERVICE_STOP_TASK_FUNCTION);
  const results = await mapInBatches(
    rssDocs,
    RSS_TASK_ENQUEUE_BATCH_SIZE,
    async (rssDoc, index) => enqueueRecurringServiceStopTask({
      taskQueue,
      companyId,
      rssDoc,
      index: index + 1,
      totalFetched: rssSnap.size,
      totalSelected: rssDocs.length,
      runContext,
    })
  );

  for (const result of results) {
    if (result.status === "enqueued") summary.enqueued += 1;
    if (result.status === "alreadyQueued") summary.alreadyQueued += 1;
    if (result.status === "enqueueFailed") summary.enqueueFailed += 1;
  }

  logRecurringServiceStopEvent("log", "company-complete", summary);
  return summary;
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const batchResults = await Promise.all(batch.map((item, offset) => mapper(item, start + offset)));
    results.push(...batchResults);
  }

  return results;
}

async function enqueueRecurringServiceStopTask({
  taskQueue,
  companyId,
  rssDoc,
  index,
  totalFetched,
  totalSelected,
  runContext = {},
}) {
  const rssData = rssDoc.data();
  const rssId = rssData.id || rssDoc.id;
  const taskId = buildRssTaskId({
    runId: runContext.runId || "manual",
    companyId,
    recurringServiceStopId: rssId,
  });
  const taskPayload = {
    runId: runContext.runId || "",
    jobName: runContext.jobName || "",
    scheduleTime: runContext.scheduleTime || "",
    companyId,
    recurringServiceStopId: rssId,
    docId: rssDoc.id,
    index,
    totalFetched,
    totalSelected,
  };
  const logContext = {
    ...taskPayload,
    taskId,
    ...getRssLogContext(rssData),
  };

  try {
    await taskQueue.enqueue(taskPayload, {
      id: taskId,
      dispatchDeadlineSeconds: RECURRING_SERVICE_STOP_TASK_DISPATCH_DEADLINE_SECONDS,
    });
    logRecurringServiceStopEvent("log", "rss-task-enqueued", logContext);
    return { status: "enqueued", recurringServiceStopId: rssId };
  } catch (error) {
    if (isTaskAlreadyExistsError(error)) {
      logRecurringServiceStopEvent("warn", "rss-task-already-queued", {
        ...logContext,
        error: summarizeError(error),
      });
      return { status: "alreadyQueued", recurringServiceStopId: rssId };
    }

    logRecurringServiceStopEvent("error", "rss-task-enqueue-error", {
      ...logContext,
      error: summarizeError(error),
    });
    await reportCloudFunctionError(error, {
      ...logContext,
      eventName: "rss-task-enqueue-error",
      title: `Failed to enqueue RSS task for ${rssId}`,
      description: "The scheduled RSS dispatcher could not enqueue this RSS into Cloud Tasks.",
      severity: "critical",
    });
    return { status: "enqueueFailed", recurringServiceStopId: rssId };
  }
}

// ---------- Core Expander ----------
async function expandRecurringServiceStop({ companyId, rssData }) {
  const db = getFirestore();
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 28); // rolling 4-week lookahead
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);
  const recurringServiceStopTypeFields = normalizeServiceStopTypeFields(
    rssData,
    "weeklySundayRSSCreate.expandRecurringServiceStop"
  );

  if (
    rssData.typeId !== recurringServiceStopTypeFields.typeId ||
    rssData.type !== recurringServiceStopTypeFields.type ||
    rssData.typeImage !== recurringServiceStopTypeFields.typeImage ||
    rssData.category !== recurringServiceStopTypeFields.category
  ) {
    await rssRef.set(recurringServiceStopTypeFields, { merge: true });
    rssData = {
      ...rssData,
      ...recurringServiceStopTypeFields,
    };
  }

  const startDate = normalizeToNoon(parseDate(rssData.startDate) || now);
  const endDate = parseDate(rssData.endDate);
  const noEndDate = Boolean(rssData.noEndDate);
  let effectiveHorizon = normalizeToNoon(horizon);

  if (!noEndDate && endDate) {
    const normalizedEndDate = normalizeToNoon(endDate);
    if (normalizedEndDate < startDate) {
      return makeRssOutcome("skipped", "end_date_before_start_date", {
        startDate: dateToLog(startDate),
        endDate: dateToLog(normalizedEndDate),
      });
    }

    if (normalizedEndDate < effectiveHorizon) {
      effectiveHorizon = normalizedEndDate;
    }
  }

  if (startDate > effectiveHorizon) {
    return makeRssOutcome("skipped", "start_date_after_horizon", {
      startDate: dateToLog(startDate),
      effectiveHorizon: dateToLog(effectiveHorizon),
    });
  }

  const lastCreated = parseDate(rssData.lastCreated);
  const missingLastCreated = !lastCreated;
  if (!lastCreated) {
    // If missing, treat as "startDate - 1 day" for daily-ish so we create starting at startDate.
    // This is safer than doing nothing.
    logRecurringServiceStopEvent("warn", "rss-warning", {
      companyId,
      recurringServiceStopId: rssData.id || "",
      reason: "missing_last_created",
      ...getRssLogContext(rssData),
    });
  } else {
    // Stop early if already ahead
    if (normalizeToNoon(lastCreated) >= effectiveHorizon) {
      return makeRssOutcome("skipped", "last_created_on_or_after_horizon", {
        lastCreated: dateToLog(lastCreated),
        effectiveHorizon: dateToLog(effectiveHorizon),
      });
    }
  }

  let outcome;
  switch (rssData.frequency) {
    case "Daily":
      outcome = await createDailyStops(companyId, rssData, lastCreated, effectiveHorizon);
      break;

    case "Week Day":
      outcome = await createWeekdayStops(companyId, rssData, lastCreated, effectiveHorizon);
      break;

    case "Weekly":
      outcome = await createWeeklyStops(companyId, rssData, lastCreated, effectiveHorizon, 7);
      break;

    case "Twice Weekly":
      outcome = await createWeeklyStops(companyId, rssData, lastCreated, effectiveHorizon, 7);
      break;

    case "Three Times Weekly":
      outcome = await createWeeklyStops(companyId, rssData, lastCreated, effectiveHorizon, 7);
      break;

    case "Bi-Weekly":
      outcome = await createWeeklyStops(companyId, rssData, lastCreated, effectiveHorizon, 14);
      break;

    case "Monthly":
      outcome = await createMonthlyStops(companyId, rssData, lastCreated, effectiveHorizon);
      break;

    default:
      outcome = makeRssOutcome("skipped", "unsupported_frequency", {
        frequency: rssData.frequency || "",
      });
      break;
  }

  return {
    ...outcome,
    missingLastCreated,
    effectiveHorizon: dateToLog(effectiveHorizon),
  };
}

// ---------- Helpers (match iOS semantics) ----------
function parseDate(d) {
  if (!d) return null;
  if (typeof d?.toDate === "function") return d.toDate(); // Firestore Timestamp
  if (typeof d?._seconds === "number") return new Date(d._seconds * 1000);
  if (typeof d?.seconds === "number") return new Date(d.seconds * 1000);
  if (typeof d === "number") return new Date(d);
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [year, month, day] = d.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function normalizeToNoon(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

function isWeekend(date) {
  const dow = date.getDay(); // 0=Sun ... 6=Sat
  return dow === 0 || dow === 6;
}

const weekdayArry = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function normalizeDayName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function dayNameToIndex(name) {
  const normalized = normalizeDayName(name);
  return weekdayArry.findIndex((day) => normalizeDayName(day) === normalized);
}

function alignDateToDayOnOrAfter(date, dayName) {
  const targetDow = dayNameToIndex(dayName);

  if (targetDow < 0) {
    throw new Error(`Invalid rssData.day: ${dayName}`);
  }

  const aligned = normalizeToNoon(date);
  const diff = (targetDow - aligned.getDay() + 7) % 7;
  aligned.setDate(aligned.getDate() + diff);
  return aligned;
}

function normalizeServiceStopTypeFields(source, contextLabel) {
  const hasTypeId = typeof source?.typeId === "string" && source.typeId.trim().length > 0;
  const hasType = typeof source?.type === "string" && source.type.trim().length > 0;
  const fallback = {
    typeId: "system_recurring_service_stop",
    type: "Recurring Service Stop",
    typeImage: "figure.pool.swim",
    category: "Route",
  };

  const fields = {
    typeId: hasTypeId ? source.typeId : fallback.typeId,
    type: hasType ? source.type : fallback.type,
    typeImage: typeof source?.typeImage === "string" && source.typeImage.trim().length > 0
      ? source.typeImage
      : fallback.typeImage,
    category: typeof source?.category === "string" && source.category.trim().length > 0
      ? source.category
      : fallback.category,
  };

  if (!hasTypeId || !hasType) {
    logRecurringServiceStopEvent("warn", "rss-type-fallback", {
      context: contextLabel,
      recurringServiceStopId: source?.id || "",
      incomingTypeId: source?.typeId || "",
      incomingType: source?.type || "",
      resolvedTypeId: fields.typeId,
      resolvedType: fields.type,
    });
  }

  return fields;
}

// Fetch counter once, write once, but still safe under concurrency via transaction.
async function allocateInternalIds(db, companyId, countNeeded) {
  const settingsRef = db.collection(`companies/${companyId}/settings`).doc("serviceStops");

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(settingsRef);
    const current = snap.exists ? Number(snap.data()?.increment ?? 0) : 0;

    // iOS looks like it uses current increment as the number; your other function uses +1 style.
    // We'll follow your existing backend pattern of allocating sequential IDs starting at current+1.
    const start = current + 1;
    const end = current + countNeeded;

    tx.set(settingsRef, { increment: end, category: "serviceStops" }, { merge: true });

    const ids = [];
    for (let n = start; n <= end; n++) ids.push("S" + String(n));
    return ids;
  });
}

function buildServiceStopIOSShape({ companyId, rssData, serviceDate, idss, internalId }) {
  const serviceStopTypeFields = normalizeServiceStopTypeFields(
    rssData,
    "weeklySundayRSSCreate.buildServiceStopIOSShape"
  );

  return {
    id: idss,
    internalId: internalId,
    companyId: companyId,
    companyName: "",

    customerId: rssData.customerId ?? "",
    customerName: rssData.customerName ?? "",
    address: {
      city: rssData.address?.city ?? "",
      state: rssData.address?.state ?? "",
      streetAddress: rssData.address?.streetAddress ?? "",
      zip: rssData.address?.zip ?? "",
      latitude: rssData.address?.latitude ?? 0,
      longitude: rssData.address?.longitude ?? 0,
    },

    dateCreated: new Date(),
    serviceDate: normalizeToNoon(serviceDate),

    startTime: null,
    endTime: null,

    duration: rssData.estimatedTime ?? 15,
    estimatedDuration: rssData.estimatedTime ?? 15,

    tech: rssData.tech ?? "",
    techId: rssData.techId ?? "",

    recurringServiceStopId: rssData.id ?? "",
    recurringServiceStopDateKey: buildServiceDateKey(serviceDate),
    recurringServiceStopDedupKey: `${rssData.id ?? ""}|${buildServiceDateKey(serviceDate)}`,

    description: rssData.description ?? "",
    serviceLocationId: rssData.serviceLocationId ?? "",

    typeId: serviceStopTypeFields.typeId,
    type: serviceStopTypeFields.type,
    typeImage: serviceStopTypeFields.typeImage,
    payTypeId: rssData.payTypeId || serviceStopTypeFields.typeId,
    payTypeName: rssData.payTypeName || serviceStopTypeFields.type,
    defaultWorkTypeIds: Array.isArray(rssData.defaultWorkTypeIds) ? rssData.defaultWorkTypeIds : [],
    category: serviceStopTypeFields.category,

    jobId: "",
    jobName: "",

    operationStatus: "Not Finished",
    billingStatus: "Not Invoiced",

    includeReadings: true,
    includeDosages: true,

    otherCompany: Boolean(rssData.otherCompany),
    laborContractId: rssData.laborContractId ?? "",
    contractedCompanyId: rssData.contractedCompanyId ?? "",

    isInvoiced: false,
    checkList: [],
    rate: 0,
  };
}

async function loadRecurringServiceStopTasks(db, companyId, rssData) {
  const recurringTasksSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("recurringServiceStop")
    .doc(rssData.id)
    .collection("tasks")
    .get();

  if (!recurringTasksSnap.empty) {
    return recurringTasksSnap.docs.map((taskDoc) => ({
      id: taskDoc.id,
      ...taskDoc.data(),
    }));
  }

  const taskGroupId = "com_set_tg_recurring_service_stops";
  const taskGroupSnap = await db.collection("companies")
    .doc(companyId)
    .collection("settings")
    .doc("taskGroup")
    .collection("taskGroup")
    .doc(taskGroupId)
    .collection("taskItems")
    .get();

  return taskGroupSnap.docs.map((taskDoc) => ({
    id: taskDoc.id,
    taskGroupId,
    taskGroupTaskId: taskDoc.id,
    ...taskDoc.data(),
  }));
}

function buildServiceDateKey(serviceDate) {
  return normalizeToNoon(serviceDate).toISOString().slice(0, 10);
}

function buildServiceStopIdForRssDate(companyId, rssId, serviceDate) {
  return `com_ss_rss_${hashString(`${companyId}|${rssId}|${buildServiceDateKey(serviceDate)}`, 32)}`;
}

function buildServiceStopTaskId(serviceStopId, task) {
  return `com_ss_tas_${hashString(`${serviceStopId}|${task.id || task.taskGroupTaskId || task.name || ""}`, 32)}`;
}

function isAlreadyExistsFirestoreError(error) {
  return (
    error?.code === 6 ||
    error?.code === "already-exists" ||
    /already exists/i.test(String(error?.message || ""))
  );
}

function buildServiceStopFromExistingSnapshot(serviceStopId, data = {}, rssData = {}) {
  return {
    ...data,
    id: data.id || serviceStopId,
    internalId: data.internalId || "",
    serviceLocationId: data.serviceLocationId || rssData.serviceLocationId || "",
  };
}

async function findExistingServiceStopForRssDate({ db, companyId, rssData, serviceDate }) {
  const serviceStopsCol = `companies/${companyId}/serviceStops`;
  const deterministicServiceStopId = buildServiceStopIdForRssDate(companyId, rssData.id, serviceDate);
  const deterministicRef = db.collection(serviceStopsCol).doc(deterministicServiceStopId);
  const deterministicSnap = await deterministicRef.get();

  if (deterministicSnap.exists) {
    return {
      serviceDate,
      serviceStopId: deterministicSnap.id,
      serviceStopRef: deterministicRef,
      exists: true,
      existingData: deterministicSnap.data(),
    };
  }

  const duplicateSnap = await db
    .collection(serviceStopsCol)
    .where("recurringServiceStopId", "==", rssData.id)
    .where("serviceDate", "==", normalizeToNoon(serviceDate))
    .limit(1)
    .get();

  if (!duplicateSnap.empty) {
    const duplicateDoc = duplicateSnap.docs[0];
    return {
      serviceDate,
      serviceStopId: duplicateDoc.id,
      serviceStopRef: duplicateDoc.ref,
      exists: true,
      existingData: duplicateDoc.data(),
    };
  }

  return {
    serviceDate,
    serviceStopId: deterministicServiceStopId,
    serviceStopRef: deterministicRef,
    exists: false,
    existingData: null,
  };
}

function buildServiceStopTask({ task, serviceStop, rssData, serviceStopTaskId }) {
  return {
    id: serviceStopTaskId || "com_ss_tas_" + uuidv4(),
    name: String(task.name || "").trim(),
    type: task.type,
    status: task.status || "Not Finished",
    contractedRate: Number(task.contractedRate || 0),
    estimatedTime: Number(task.estimatedTime || 0),

    customerApproval: false,
    actualTime: 0,

    workerId: "",
    workerType: "",
    workerName: "",

    laborContractId: "",

    serviceStopId: {
      id: serviceStop.id,
      internalId: serviceStop.internalId || "",
    },

    jobId: {
      id: "",
      internalId: "",
    },

    recurringServiceStopId: {
      id: rssData.id ?? "",
      internalId: rssData.internalId || "",
    },

    jobTaskId: "",
    recurringServiceStopTaskId: task.id,

    equipmentId: "",
    serviceLocationId: serviceStop.serviceLocationId || rssData.serviceLocationId || "",
    bodyOfWaterId: "",
    shoppingListItemId: "",
  };
}

async function ensureServiceStopTasks({ serviceStopRef, serviceStop, rssData, taskList }) {
  for (const task of taskList) {
    const serviceStopTaskId = buildServiceStopTaskId(serviceStop.id, task);
    const serviceStopTask = buildServiceStopTask({
      task,
      serviceStop,
      rssData,
      serviceStopTaskId,
    });
    await serviceStopRef.collection("tasks").doc(serviceStopTask.id).set(serviceStopTask, { merge: true });
  }
}

async function uploadServiceStopFromRss({
  db,
  companyId,
  rssData,
  serviceDate,
  internalId,
  taskList,
  serviceStopId,
}) {
  const serviceStopsCol = `companies/${companyId}/serviceStops`;
  const idss = serviceStopId || "com_ss_" + uuidv4();
  const serviceStop = buildServiceStopIOSShape({
    companyId,
    rssData,
    serviceDate,
    idss,
    internalId,
  });
  const serviceStopRef = db.collection(serviceStopsCol).doc(idss);

  try {
    await serviceStopRef.create(serviceStop);
    await ensureServiceStopTasks({ serviceStopRef, serviceStop, rssData, taskList });
    return { serviceStop, created: true };
  } catch (error) {
    if (!serviceStopId || !isAlreadyExistsFirestoreError(error)) {
      throw error;
    }

    const existingSnap = await serviceStopRef.get();
    const existingServiceStop = buildServiceStopFromExistingSnapshot(
      idss,
      existingSnap.data(),
      rssData
    );
    await ensureServiceStopTasks({
      serviceStopRef,
      serviceStop: existingServiceStop,
      rssData,
      taskList,
    });
    return { serviceStop: existingServiceStop, created: false };
  }
}

async function createServiceStopsForDates({
  companyId,
  rssData,
  dates,
  lastCreated,
  horizon,
  noDatesReason = "no_service_dates_within_horizon",
  outcomeDetails = {},
}) {
  const db = getFirestore();
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  if (dates.length === 0) {
    return makeRssOutcome("skipped", noDatesReason, {
      frequency: rssData.frequency || "",
      lastCreated: dateToLog(lastCreated),
      horizon: dateToLog(horizon),
      serviceStopsCreated: 0,
      ...outcomeDetails,
    });
  }

  const taskList = await loadRecurringServiceStopTasks(db, companyId, rssData);
  const dateEntries = await Promise.all(dates.map((serviceDate) => (
    findExistingServiceStopForRssDate({ db, companyId, rssData, serviceDate })
  )));
  const datesToCreate = dateEntries.filter((entry) => !entry.exists);
  const internalIds = datesToCreate.length
    ? await allocateInternalIds(db, companyId, datesToCreate.length)
    : [];
  const internalIdsByServiceStopId = new Map(
    datesToCreate.map((entry, index) => [entry.serviceStopId, internalIds[index]])
  );
  let serviceStopsCreated = 0;
  let existingServiceStops = 0;
  let last = lastCreated ? new Date(lastCreated) : null;

  for (const entry of dateEntries) {
    if (entry.exists) {
      existingServiceStops += 1;
      const existingServiceStop = buildServiceStopFromExistingSnapshot(
        entry.serviceStopId,
        entry.existingData,
        rssData
      );
      await ensureServiceStopTasks({
        serviceStopRef: entry.serviceStopRef,
        serviceStop: existingServiceStop,
        rssData,
        taskList,
      });
    } else {
      const uploadResult = await uploadServiceStopFromRss({
        db,
        companyId,
        rssData,
        serviceDate: entry.serviceDate,
        internalId: internalIdsByServiceStopId.get(entry.serviceStopId),
        taskList,
        serviceStopId: entry.serviceStopId,
      });

      if (uploadResult.created) {
        serviceStopsCreated += 1;
      } else {
        existingServiceStops += 1;
      }
    }

    last = entry.serviceDate;
  }

  if (last) await rssRef.update({ lastCreated: last });

  return makeRssOutcome("created", serviceStopsCreated > 0
    ? "service_stops_created"
    : "service_stops_already_existed", {
    frequency: rssData.frequency || "",
    serviceStopsCreated,
    existingServiceStops,
    serviceDatesConsidered: dates.length,
    firstServiceDate: dateToLog(dates[0]),
    lastServiceDate: dateToLog(last),
    horizon: dateToLog(horizon),
    ...outcomeDetails,
  });
}

// ---------- Daily ----------
async function createDailyStops(companyId, rssData, lastCreated, horizon) {
  // Next date is lastCreated + 1 day; if lastCreated missing, start at startDate
  const startBase = normalizeToNoon(lastCreated || parseDate(rssData.startDate) || new Date());
  let cursor = lastCreated ? addDays(startBase, 1) : new Date(startBase);

  // Collect dates to create up to horizon
  const dates = [];
  while (normalizeToNoon(cursor) <= horizon) {
    dates.push(normalizeToNoon(cursor));
    cursor = addDays(cursor, 1);
  }
  return createServiceStopsForDates({
    companyId,
    rssData,
    dates,
    lastCreated,
    horizon,
  });
}

// ---------- Weekday ----------
async function createWeekdayStops(companyId, rssData, lastCreated, horizon) {
  const startBase = normalizeToNoon(lastCreated || parseDate(rssData.startDate) || new Date());
  let cursor = lastCreated ? addDays(startBase, 1) : new Date(startBase);

  const dates = [];
  while (normalizeToNoon(cursor) <= horizon) {
    if (!isWeekend(cursor)) dates.push(normalizeToNoon(cursor));
    cursor = addDays(cursor, 1);
  }
  return createServiceStopsForDates({
    companyId,
    rssData,
    dates,
    lastCreated,
    horizon,
    noDatesReason: "no_weekdays_within_horizon",
  });
}

// ---------- Weekly / Biweekly ----------
async function createWeeklyStops(companyId, rssData, lastCreated, horizon, intervalDays) {
  // Base cursor: lastCreated + interval, or align from startDate if lastCreated missing
  let serviceDate;

  if (lastCreated) {
    const nextAlignedDate = alignDateToDayOnOrAfter(addDays(lastCreated, 1), rssData.day);
    serviceDate = addDays(nextAlignedDate, -intervalDays);
  } else {
    const startDate = normalizeToNoon(parseDate(rssData.startDate) || new Date());
    const alignedStartDate = alignDateToDayOnOrAfter(startDate, rssData.day);
    const targetDow = dayNameToIndex(rssData.day);

    if (alignedStartDate.getTime() !== startDate.getTime()) {
      logRecurringServiceStopEvent("warn", "rss-warning", {
        companyId,
        recurringServiceStopId: rssData.id || "",
        reason: "weekly_start_date_day_mismatch",
        rssDay: rssData.day,
        targetDow,
        startDow: startDate.getDay(),
        alignedDow: alignedStartDate.getDay(),
        startDate: startDate.toISOString(),
        alignedStartDate: alignedStartDate.toISOString(),
      });
    }

    serviceDate = addDays(alignedStartDate, -intervalDays);
  }

  // Collect dates to create up to horizon
  const dates = [];

  while (true) {
    serviceDate = addDays(serviceDate, intervalDays);
    const normalizedServiceDate = normalizeToNoon(serviceDate);
    if (normalizedServiceDate > horizon) break;
    dates.push(normalizedServiceDate);
  }
  return createServiceStopsForDates({
    companyId,
    rssData,
    dates,
    lastCreated,
    horizon,
    outcomeDetails: {
      intervalDays,
      day: rssData.day || "",
    },
  });
}

// ---------- Monthly ----------
async function createMonthlyStops(companyId, rssData, lastCreated, horizon) {
  let cursor = normalizeToNoon(lastCreated || parseDate(rssData.startDate) || new Date());

  if (lastCreated) {
    cursor = addMonths(cursor, 1);
  }

  const dates = [];
  while (normalizeToNoon(cursor) <= horizon) {
    dates.push(normalizeToNoon(cursor));
    cursor = addMonths(cursor, 1);
  }

  return createServiceStopsForDates({
    companyId,
    rssData,
    dates,
    lastCreated,
    horizon,
  });
}

// --------- CONFIG / HELPERS ---------

const ROUTES_COL = (companyId) => `companies/${companyId}/recurringRoutes`;
const RSS_COL = (companyId) => `companies/${companyId}/recurringServiceStop`;

function toDateOrNull(v) {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Convert your DaysOfWeek stored value into a comparable string/number.
// You must match your Firestore representation.
// Common options are "Monday" string, or {rawValue:"Monday"} etc.
// Adjust this to your actual stored format.
function normalizeDay(day) {
  if (!day) return null;
  if (typeof day === "string") return day;
  if (typeof day?.rawValue === "string") return day.rawValue;
  return null;
}

function comparableRssRouteField(rss = {}, field) {
  if (field === "day") return normalizeDay(rss.day) || "";
  return String(rss[field] ?? "").trim();
}

function didRouteRelevantRssChange(before = {}, after = {}) {
  return ["customerId", "customerName", "serviceLocationId", "techId", "tech", "day"].some(
    (field) => comparableRssRouteField(before, field) !== comparableRssRouteField(after, field)
  );
}

// Build a patch for one route based on current RSS docs.
// This keeps route.order entries consistent and removes missing references.
async function reconcileRouteForRssChange({ db, companyId, routeRef, routeData, changedRssId }) {
  const order = Array.isArray(routeData.order) ? routeData.order : [];
  const rssIds = Array.isArray(routeData.rssIds) ? routeData.rssIds : order.map(o => o.recurringServiceStopId).filter(Boolean);

  // Fetch all RSS docs referenced by this route (bounded by the route size)
  const uniqueRssIds = Array.from(new Set(order.map(o => o.recurringServiceStopId).filter(Boolean)));

  const rssSnaps = await Promise.all(
    uniqueRssIds.map(id => db.doc(`${RSS_COL(companyId)}/${id}`).get())
  );

  const rssMap = new Map();
  for (const snap of rssSnaps) {
    if (snap.exists) rssMap.set(snap.id, snap.data());
  }

  // Remove order entries whose RSS no longer exists
  const filteredOrder = order.filter(o => rssMap.has(o.recurringServiceStopId));

  // Optional: update denormalized fields in order[] from the RSS doc
  const reconciledOrder = filteredOrder.map((o) => {
    const rss = rssMap.get(o.recurringServiceStopId);
    if (!rss) return o;

    return {
      ...o,
      customerId: rss.customerId ?? o.customerId ?? "",
      customerName: rss.customerName ?? o.customerName ?? "",
      locationId: rss.serviceLocationId ?? o.locationId ?? "",
      // keep o.order and o.id as-is
    };
  });

  // Optional: ensure order.order values are unique + ascending.
  // If you want to force contiguous 0..n-1, enable this block.
  // const sorted = [...reconciledOrder].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
  // const normalized = sorted.map((o, idx) => ({ ...o, order: idx }));

  // Compute rssIds derived field
  const newRssIds = reconciledOrder.map(o => o.recurringServiceStopId);

  // Optional: validate/derive route tech/day from RSS set
  // Rule suggestion: if all RSS share same techId/day, keep route aligned. If mismatch, mark invalid.
  let isValid = true;
  let mismatchReason = null;

  const routeTechId = routeData.techId ?? "";
  const routeDay = normalizeDay(routeData.day);

  for (const [rssId, rss] of rssMap.entries()) {
    const rssTechId = rss.techId ?? "";
    const rssDay = normalizeDay(rss.day);
    // If your RSS doc doesn't store day/techId, remove these checks.
    if (rssTechId && routeTechId && rssTechId !== routeTechId) {
      isValid = false;
      mismatchReason = `techId mismatch: route=${routeTechId} rss(${rssId})=${rssTechId}`;
      break;
    }
    if (rssDay && routeDay && rssDay !== routeDay) {
      isValid = false;
      mismatchReason = `day mismatch: route=${routeDay} rss(${rssId})=${rssDay}`;
      break;
    }
  }

  const patch = {
    order: reconciledOrder,
    rssIds: newRssIds,
    isValid,
    invalidReason: mismatchReason,
    lastValidatedAt: FieldValue.serverTimestamp(),
    lastValidatedBy: "cf_rss_listener",
    lastValidatedRssId: changedRssId,
  };

  // Only write if something materially changed (optional optimization).
  // Simplest safe approach: always merge patch.
  await routeRef.set(patch, { merge: true });
}

// Find all routes that reference rssId using rssIds array-contains.
async function findRoutesContainingRss({ db, companyId, rssId }) {
  const routesSnap = await db
    .collection(ROUTES_COL(companyId))
    .where("rssIds", "array-contains", rssId)
    .get();

  return routesSnap.docs;
}

// --------- SALES MANUAL RECURRING INVOICES ---------

function normalizeSalesStatus(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function toDate(value, fallback = new Date()) {
  if (!value) return fallback === null ? null : new Date(fallback);
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value._seconds === "number") return new Date(value._seconds * 1000);
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return fallback === null ? null : new Date(fallback);
}

function startOfDay(value) {
  const date = toDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toTimestamp(value) {
  return Timestamp.fromDate(startOfDay(value));
}

function dateKey(value) {
  return startOfDay(value).toISOString().slice(0, 10).replace(/-/g, "");
}

function addBillingInterval(value, interval = "month", intervalCount = 1) {
  const date = startOfDay(value);
  const count = Math.max(Number(intervalCount || 1), 1);
  const key = normalizeSalesStatus(interval);

  if (key.includes("day")) date.setDate(date.getDate() + count);
  else if (key.includes("week")) date.setDate(date.getDate() + (count * 7));
  else if (key.includes("year")) date.setFullYear(date.getFullYear() + count);
  else date.setMonth(date.getMonth() + count);

  return date;
}

function addBillingIntervalDateTime(value, interval = "month", intervalCount = 1) {
  const date = toDate(value);
  const count = Math.max(Number(intervalCount || 1), 1);
  const key = normalizeSalesStatus(interval);

  if (key.includes("day")) date.setDate(date.getDate() + count);
  else if (key.includes("week")) date.setDate(date.getDate() + (count * 7));
  else if (key.includes("year")) date.setFullYear(date.getFullYear() + count);
  else date.setMonth(date.getMonth() + count);

  return date;
}

function paymentTermsDueDays(paymentTerms = "") {
  const key = normalizeSalesStatus(paymentTerms);
  if (key === "net7") return 7;
  if (key === "net14") return 14;
  if (key === "net15") return 15;
  if (key === "net30") return 30;
  return 0;
}

function dueDateForTerms(paymentTerms, baseDate = new Date()) {
  const date = startOfDay(baseDate);
  date.setDate(date.getDate() + paymentTermsDueDays(paymentTerms));
  return date;
}

function copySubscriptionLineItems(subscription = {}) {
  const sourceItems = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  const lineItems = sourceItems
    .map((item) => {
      const quantity = Math.max(Number(item.quantity || 1), 0);
      const unitAmountCents = Number(item.unitAmountCents || 0);
      const totalAmountCents = Number(item.totalAmountCents || Math.round(unitAmountCents * quantity));

      return {
        id: item.id || item.catalogItemId || `sili_${uuidv4()}`,
        catalogItemId: item.catalogItemId || "",
        sourceType: item.sourceType || "recurringService",
        sourceId: item.sourceId || item.catalogItemId || "",
        name: item.name || item.description || "Recurring service",
        description: item.description || "",
        quantity,
        unitAmountCents,
        totalAmountCents,
        taxable: Boolean(item.taxable),
        type: item.type || "recurringService",
        stripeProductId: item.stripeProductId || "",
        stripePriceId: item.stripePriceId || "",
        metadata: item.metadata || {},
      };
    })
    .filter((item) => item.name && item.quantity > 0);

  if (lineItems.length) return lineItems;

  const amountCents = Number(subscription.amountCents || 0);
  return amountCents > 0
    ? [{
      id: `sili_${uuidv4()}`,
      catalogItemId: "",
      sourceType: "recurringService",
      sourceId: subscription.agreementId || subscription.id || "",
      name: subscription.agreementSnapshot?.title || "Recurring service",
      description: subscription.serviceCadence || subscription.rateType || "",
      quantity: 1,
      unitAmountCents: amountCents,
      totalAmountCents: amountCents,
      taxable: false,
      type: "recurringService",
      stripeProductId: "",
      stripePriceId: "",
      metadata: {},
    }]
    : [];
}

function getManualBillingPeriod(subscription = {}) {
  const fallbackDate =
    subscription.currentPeriodStart ||
    subscription.agreementSnapshot?.acceptedAt ||
    subscription.createdAt ||
    new Date();
  const invoiceSendAt = toDate(
    subscription.manualBillingNextInvoiceAt ||
    subscription.manualBillingNextPeriodStart ||
    fallbackDate
  );
  const start = startOfDay(subscription.manualBillingNextPeriodStart || fallbackDate);
  const interval = subscription.interval || "month";
  const intervalCount = Math.max(Number(subscription.intervalCount || 1), 1);
  const existingEnd = toDate(subscription.manualBillingNextPeriodEnd || subscription.currentPeriodEnd, null);
  const end = existingEnd && existingEnd.getTime() > start.getTime()
    ? startOfDay(existingEnd)
    : addBillingInterval(start, interval, intervalCount);
  const nextPeriodStart = end;
  const nextPeriodEnd = addBillingInterval(end, interval, intervalCount);
  const nextInvoiceAt = addBillingIntervalDateTime(invoiceSendAt, interval, intervalCount);
  const dueDate = dueDateForTerms(subscription.paymentTerms, invoiceSendAt);

  return {
    invoiceSendAt,
    periodStart: start,
    periodEnd: end,
    nextPeriodStart,
    nextPeriodEnd,
    nextInvoiceAt,
    nextDueDate: dueDateForTerms(subscription.paymentTerms, nextInvoiceAt),
    dueDate,
    invoiceId: `si_${subscription.id}_${dateKey(start)}`,
    invoiceNumber: `REC-${dateKey(start)}-${String(subscription.id || "").slice(-6).toUpperCase()}`,
  };
}

function shouldSkipScheduledManualInvoice(subscription = {}, now = new Date()) {
  const statusKey = normalizeSalesStatus(subscription.status);
  const stripeStatusKey = normalizeSalesStatus(subscription.stripeStatus);
  const activeStripeStates = new Set(["active", "trialing"]);
  const stripeManagedStates = new Set(["active", "trialing", "pastdue", "unpaid", "paused"]);
  const invoiceAt = toDate(
    subscription.manualBillingNextInvoiceAt ||
    subscription.manualBillingNextPeriodStart ||
    subscription.currentPeriodStart ||
    subscription.createdAt,
    null
  );

  if (subscription.manualBillingEnabled === false) return "manualBillingDisabled";
  if (statusKey === "canceled" || statusKey === "superseded" || statusKey === "paused") return "subscriptionNotBillable";
  if (subscription.autopayEnabled === true) return "autopayEnabled";
  if (subscription.billingCollectionMethod === "automaticStripe") return "stripeManagedBilling";
  if (activeStripeStates.has(stripeStatusKey)) return "stripeAutopayActive";
  if (subscription.stripeSubscriptionId && stripeManagedStates.has(stripeStatusKey)) return "stripeSubscriptionManaged";
  if (Number(subscription.amountCents || 0) <= 0 && (!Array.isArray(subscription.lineItems) || !subscription.lineItems.length)) return "missingAmount";
  if (invoiceAt && invoiceAt.getTime() > now.getTime()) return "notDueYet";

  return "";
}

async function createScheduledManualSubscriptionInvoice(db, subscription = {}) {
  if (!subscription?.id) throw new Error("Missing billing subscription id.");
  if (!subscription.companyId) throw new Error("Billing subscription is missing a company id.");
  if (!subscription.customerId) throw new Error("Billing subscription is missing a customer.");

  const period = getManualBillingPeriod(subscription);
  const lineItems = copySubscriptionLineItems(subscription);
  const subtotalAmountCents = lineItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
  const totalAmountCents = subtotalAmountCents;

  if (totalAmountCents <= 0 || !lineItems.length) {
    throw new Error("Billing subscription needs an amount or line items before an invoice can be created.");
  }

  const invoiceRef = db.collection(salesCollectionNames.invoices).doc(period.invoiceId);
  const subscriptionRef = db.collection(salesCollectionNames.billingSubscriptions).doc(subscription.id);
  let created = false;
  let shouldSendEmail = false;

  await db.runTransaction(async (transaction) => {
    const invoiceSnap = await transaction.get(invoiceRef);
    const now = FieldValue.serverTimestamp();
    const receiptDeliveryMethod = subscription.receiptDeliveryMethod || subscription.invoiceDeliveryMethod || "email";
    const receiptsEnabled = subscription.receiptsEnabled !== false;

    if (!invoiceSnap.exists) {
      created = true;
      shouldSendEmail = subscription.manualBillingAutoSendEnabled === true &&
        ["email", "customerPortal"].includes(subscription.invoiceDeliveryMethod || "email");

      transaction.set(invoiceRef, {
        id: period.invoiceId,
        companyId: subscription.companyId,
        companyName: subscription.companyName || "",
        customerId: subscription.customerId || "",
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || "",
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || "",
        customerName: subscription.customerName || "",
        email: subscription.email || "",
        serviceLocationIds: Array.isArray(subscription.serviceLocationIds) ? subscription.serviceLocationIds : [],
        serviceLocationSnapshots: Array.isArray(subscription.serviceLocationSnapshots) ? subscription.serviceLocationSnapshots : [],
        agreementId: subscription.agreementId || "",
        jobId: "",
        billingProfileId: subscription.billingProfileId || "",
        billingSubscriptionId: subscription.id,
        stripeConnectedAccountId: subscription.stripeConnectedAccountId || "",
        invoiceNumber: period.invoiceNumber,
        type: "subscription",
        sourceType: "scheduledManualBillingSubscription",
        status: "open",
        deliveryMethod: subscription.invoiceDeliveryMethod || "email",
        billingCollectionMethod: subscription.billingCollectionMethod || "manualUntilAutopay",
        autopayStatus: subscription.autopayStatus || (subscription.stripeConnectedAccountId ? "available" : "unavailable"),
        receiptDeliveryMethod,
        receiptsEnabled,
        currency: subscription.currency || "usd",
        scheduledSendAt: Timestamp.fromDate(period.invoiceSendAt),
        billingPeriodStart: toTimestamp(period.periodStart),
        billingPeriodEnd: toTimestamp(period.periodEnd),
        dueDate: toTimestamp(period.dueDate),
        subtotalAmountCents,
        discountAmountCents: 0,
        taxAmountCents: 0,
        totalAmountCents,
        amountPaidCents: 0,
        amountDueCents: totalAmountCents,
        writeOffAmountCents: 0,
        memo: subscription.manualInvoiceMemo || "",
        lineItems,
        recurringManualInvoice: true,
        manualBilling: {
          generatedFromSubscriptionId: subscription.id,
          periodStartKey: dateKey(period.periodStart),
          interval: subscription.interval || "month",
          intervalCount: Math.max(Number(subscription.intervalCount || 1), 1),
          autoGenerated: true,
        },
        createdByUserId: "scheduled-manual-invoice",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const invoiceData = invoiceSnap.data() || {};
      shouldSendEmail = subscription.manualBillingAutoSendEnabled === true &&
        ["email", "customerPortal"].includes(invoiceData.deliveryMethod || subscription.invoiceDeliveryMethod || "email") &&
        !invoiceData.sentAt;
    }

    transaction.set(subscriptionRef, {
      manualBillingLastInvoiceId: period.invoiceId,
      manualBillingLastInvoiceNumber: period.invoiceNumber,
      manualBillingLastInvoiceAt: now,
      manualBillingLastInvoiceDueDate: toTimestamp(period.dueDate),
      manualBillingLastPeriodStart: toTimestamp(period.periodStart),
      manualBillingLastPeriodEnd: toTimestamp(period.periodEnd),
      manualBillingNextPeriodStart: toTimestamp(period.nextPeriodStart),
      manualBillingNextPeriodEnd: toTimestamp(period.nextPeriodEnd),
      manualBillingNextInvoiceAt: Timestamp.fromDate(period.nextInvoiceAt),
      manualBillingNextDueDate: toTimestamp(period.nextDueDate),
      billingCollectionMethod: subscription.billingCollectionMethod || "manualUntilAutopay",
      manualBillingEnabled: true,
      manualBillingAutoSendEnabled: subscription.manualBillingAutoSendEnabled === true,
      manualBillingStatus: created ? "invoiceCreated" : "invoiceAlreadyExisted",
      manualBillingReason: subscription.manualBillingReason || "scheduledManualRecurringInvoice",
      manualBillingUpdatedAt: now,
      manualBillingLastAutoRunAt: now,
      manualBillingLastAutoRunStatus: created ? "created" : "alreadyExisted",
      receiptDeliveryMethod,
      receiptsEnabled,
      lastBillingSource: "scheduledManualRecurringInvoice",
      updatedAt: now,
    }, { merge: true });
  });

  return {
    invoiceId: period.invoiceId,
    invoiceNumber: period.invoiceNumber,
    created,
    shouldSendEmail,
    period,
  };
}

exports.dailySalesManualInvoiceCreate = onSchedule(
  { schedule: "every day 06:00", timeZone: "America/New_York" },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const snapshot = await db
      .collection(salesCollectionNames.billingSubscriptions)
      .where("manualBillingEnabled", "==", true)
      .limit(1000)
      .get();

    let processedCount = 0;
    let createdCount = 0;
    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const docSnap of snapshot.docs) {
      const subscription = { id: docSnap.id, ...docSnap.data() };
      const skipReason = shouldSkipScheduledManualInvoice(subscription, now);

      if (skipReason) {
        skippedCount += 1;
        continue;
      }

      processedCount += 1;
      let invoiceResult = null;

      try {
        const result = await createScheduledManualSubscriptionInvoice(db, subscription);
        invoiceResult = result;
        if (result.created) createdCount += 1;

        if (!result.shouldSendEmail) {
          await docSnap.ref.set({
            manualBillingStatus: result.created ? "invoiceCreated" : "invoiceAlreadyExisted",
            manualBillingLastAutoRunStatus: result.created ? "invoiceCreatedEmailSkipped" : "invoiceAlreadyExistedEmailSkipped",
            manualBillingLastAutoRunAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          continue;
        }

        const sendResult = await sendSalesInvoiceEmailForAutomation({
          companyId: subscription.companyId,
          invoiceId: result.invoiceId,
        });

        sentCount += 1;
        await docSnap.ref.set({
          manualBillingStatus: "invoiceSent",
          manualBillingLastAutoRunStatus: "sent",
          manualBillingLastInvoiceEmailSentAt: FieldValue.serverTimestamp(),
          manualBillingLastInvoiceEmailTo: sendResult.to || "",
          manualBillingLastInvoiceEmailIntendedTo: sendResult.intendedTo || subscription.email || "",
          manualBillingLastEmailError: "",
          manualBillingUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        failedCount += 1;
        const retryAt = new Date(Date.now() + 60 * 60 * 1000);
        const retryPatch = invoiceResult?.period
          ? {
            manualBillingNextPeriodStart: toTimestamp(invoiceResult.period.periodStart),
            manualBillingNextPeriodEnd: toTimestamp(invoiceResult.period.periodEnd),
            manualBillingNextInvoiceAt: Timestamp.fromDate(retryAt),
            manualBillingNextDueDate: toTimestamp(invoiceResult.period.dueDate),
          }
          : {};

        console.error("Scheduled manual invoice failed", {
          billingSubscriptionId: subscription.id,
          companyId: subscription.companyId,
          error: error.message,
        });
        await docSnap.ref.set({
          manualBillingStatus: "autoSendFailed",
          manualBillingLastAutoRunStatus: "failed",
          manualBillingLastAutoRunAt: FieldValue.serverTimestamp(),
          manualBillingLastEmailError: error.message || "Scheduled invoice failed.",
          manualBillingUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          ...retryPatch,
        }, { merge: true });
      }
    }

    console.log("Daily sales manual invoice create finished", {
      scannedCount: snapshot.size,
      processedCount,
      createdCount,
      sentCount,
      skippedCount,
      failedCount,
    });

    return null;
  }
);

// --------- TRIGGERS ---------

exports.onRssCreated = onDocumentCreated(
  "companies/{companyId}/recurringServiceStop/{rssId}",
  async (event) => {
    const db = getFirestore();
    const companyId = event.params.companyId;
    const rssId = event.params.rssId;
    console.log("Called onRssCreated ", rssId)
    // Usually create won't affect any routes unless you add it to a route separately.
    // But if you do create+attach in one batch, this can still be helpful.
    const routeDocs = await findRoutesContainingRss({ db, companyId, rssId });
    for (const routeDoc of routeDocs) {
      await reconcileRouteForRssChange({
        db,
        companyId,
        routeRef: routeDoc.ref,
        routeData: routeDoc.data(),
        changedRssId: rssId,
      });
    }
  }
);

exports.onRssUpdated = onDocumentUpdated(
  "companies/{companyId}/recurringServiceStop/{rssId}",
  async (event) => {
    const db = getFirestore();
    const companyId = event.params.companyId;
    const rssId = event.params.rssId;
    console.log("Called onRssUpdated ", rssId)

    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!didRouteRelevantRssChange(before, after)) {
      console.log("Skipping recurring route reconciliation for non-route RSS update", rssId);
      return null;
    }

    const routeDocs = await findRoutesContainingRss({ db, companyId, rssId });
    for (const routeDoc of routeDocs) {
      await reconcileRouteForRssChange({
        db,
        companyId,
        routeRef: routeDoc.ref,
        routeData: routeDoc.data(),
        changedRssId: rssId,
      });
    }
  }
);

exports.onRssDeleted = onDocumentDeleted(
  "companies/{companyId}/recurringServiceStop/{rssId}",
  async (event) => {
    const db = getFirestore();
    const companyId = event.params.companyId;
    const rssId = event.params.rssId;
    console.log("Called onRssDeleted ", rssId)

    const routeDocs = await findRoutesContainingRss({ db, companyId, rssId });

    for (const routeDoc of routeDocs) {
      const routeRef = routeDoc.ref;
      const routeData = routeDoc.data();
      const order = Array.isArray(routeData.order) ? routeData.order : [];

      // Remove entries referencing deleted RSS
      const newOrder = order.filter((o) => o.recurringServiceStopId !== rssId);
      const newRssIds = newOrder.map(o => o.recurringServiceStopId);

      await routeRef.set(
        {
          order: newOrder,
          rssIds: newRssIds,
          lastValidatedAt: FieldValue.serverTimestamp(),
          lastValidatedBy: "cf_rss_listener",
          lastValidatedRssId: rssId,
        },
        { merge: true }
      );
    }
  }
);
