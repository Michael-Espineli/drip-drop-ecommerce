const { onSchedule } = require("firebase-functions/scheduler");
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const { v4: uuidv4 } = require("uuid");

// Initialize admin SDK if not already done
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = getFirestore();
const mySecret = defineSecret('stripe_secret_key');
const stripe = require("stripe")(process.env.STRIPE_API_KEY || 'sk_test_dummyApiKey');

/**
 * Runs every Sunday at 00:00 America/New_York (explicit).
 */
exports.weeklySundayRSSCreate = onSchedule(
  { schedule: "every sunday 00:00", timeZone: "America/New_York" },
  async (event) => {
    console.log("Weekly Service Stop Generator Started");

    const db = getFirestore();
    const companiesSnap = await db.collection("companies").get();

    for (const companyDoc of companiesSnap.docs) {
      const companyId = companyDoc.id;
      try {
        console.log("  Company Id: " + companyId);

        await processCompanyRecurringStops(companyId);
      } catch (err) {
        console.error(`Company ${companyId} failed`, err);
      }
    }

    console.log("Weekly Service Stop Generator Finished");
    return null;
  }
);

async function processCompanyRecurringStops(companyId) {
  const db = getFirestore();

  const rssSnap = await db
    .collection(`companies/${companyId}/recurringServiceStop`)
    .get();

  if (rssSnap.empty) return;
  console.log(`    [processCompanyRecurringStops]RSS Count: ${rssSnap.size}`);

  for (const rssDoc of rssSnap.docs) {
    const rssData = rssDoc.data();
    try {
      await expandRecurringServiceStop({
        companyId,
        rssData: {
          ...rssData,
          id: rssData.id || rssDoc.id,
        },
      });
    } catch (error) {
      console.error(`    RSS ${rssDoc.id} failed`, error);
    }
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
    rssData.typeImage !== recurringServiceStopTypeFields.typeImage
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
      console.log(`RSS ${rssData.id}: endDate is before startDate. Skipping.`);
      return;
    }

    if (normalizedEndDate < effectiveHorizon) {
      effectiveHorizon = normalizedEndDate;
    }
  }

  if (startDate > effectiveHorizon) {
    console.log(`RSS ${rssData.id}: startDate is beyond the 4-week horizon. Skipping.`);
    return;
  }

  const lastCreated = parseDate(rssData.lastCreated);
  if (!lastCreated) {
    // If missing, treat as "startDate - 1 day" for daily-ish so we create starting at startDate.
    // This is safer than doing nothing.
    console.log(`RSS ${rssData.id}: missing lastCreated`);
  } else {
    // Stop early if already ahead
    if (normalizeToNoon(lastCreated) >= effectiveHorizon) return;
  }

  switch (rssData.frequency) {
    case "Daily":
      await createDailyStops(companyId, rssData, lastCreated, effectiveHorizon);
      break;

    case "Week Day":
      await createWeekdayStops(companyId, rssData, lastCreated, effectiveHorizon);
      break;

    case "Weekly":
      await createWeeklyStops(companyId, rssData, lastCreated, effectiveHorizon, 7);
      break;

    case "Bi-Weekly":
      await createWeeklyStops(companyId, rssData, lastCreated, effectiveHorizon, 14);
      break;

    case "Monthly":
      await createMonthlyStops(companyId, rssData, lastCreated, effectiveHorizon);
      break;

    default:
      break;
  }
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
  };

  const fields = {
    typeId: hasTypeId ? source.typeId : fallback.typeId,
    type: hasType ? source.type : fallback.type,
    typeImage: typeof source?.typeImage === "string" && source.typeImage.trim().length > 0
      ? source.typeImage
      : fallback.typeImage,
  };

  if (!hasTypeId || !hasType) {
    console.warn("[ServiceStopTypeFunction][fallback]", {
      context: contextLabel,
      recurringServiceStopId: source?.id || "",
      incomingTypeId: source?.typeId || "",
      incomingType: source?.type || "",
      resolvedTypeId: fields.typeId,
      resolvedType: fields.type,
    });
  } else {
    console.log("[ServiceStopTypeFunction][resolved]", {
      context: contextLabel,
      recurringServiceStopId: source?.id || "",
      typeId: fields.typeId,
      type: fields.type,
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

    description: rssData.description ?? "",
    serviceLocationId: rssData.serviceLocationId ?? "",

    typeId: serviceStopTypeFields.typeId,
    type: serviceStopTypeFields.type,
    typeImage: serviceStopTypeFields.typeImage,

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

function buildServiceStopTask({ task, serviceStop, rssData }) {
  const serviceStopTaskId = "com_ss_tas_" + uuidv4();

  return {
    id: serviceStopTaskId,
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

async function uploadServiceStopFromRss({ db, companyId, rssData, serviceDate, internalId, taskList }) {
  const serviceStopsCol = `companies/${companyId}/serviceStops`;
  const idss = "com_ss_" + uuidv4();
  const serviceStop = buildServiceStopIOSShape({
    companyId,
    rssData,
    serviceDate,
    idss,
    internalId,
  });
  const serviceStopRef = db.collection(serviceStopsCol).doc(idss);

  await serviceStopRef.set(serviceStop);

  for (const task of taskList) {
    const serviceStopTask = buildServiceStopTask({ task, serviceStop, rssData });
    await serviceStopRef.collection("tasks").doc(serviceStopTask.id).set(serviceStopTask);
  }

  return serviceStop;
}

// ---------- Daily ----------
async function createDailyStops(companyId, rssData, lastCreated, horizon) {
  const db = getFirestore();
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  // Next date is lastCreated + 1 day; if lastCreated missing, start at startDate
  const startBase = normalizeToNoon(lastCreated || parseDate(rssData.startDate) || new Date());
  let cursor = lastCreated ? addDays(startBase, 1) : new Date(startBase);

  // Collect dates to create up to horizon
  const dates = [];
  while (normalizeToNoon(cursor) <= horizon) {
    dates.push(normalizeToNoon(cursor));
    cursor = addDays(cursor, 1);
  }
  if (dates.length === 0) return;

  // Allocate internal IDs in one transaction
  const internalIds = await allocateInternalIds(db, companyId, dates.length);
  const taskList = await loadRecurringServiceStopTasks(db, companyId, rssData);

  let last = lastCreated ? new Date(lastCreated) : null;

  // Write stops sequentially
  for (let i = 0; i < dates.length; i++) {
    await uploadServiceStopFromRss({
      db,
      companyId,
      rssData,
      serviceDate: dates[i],
      internalId: internalIds[i],
      taskList,
    });

    last = dates[i];
  }

  if (last) await rssRef.update({ lastCreated: last });
}

// ---------- Weekday ----------
async function createWeekdayStops(companyId, rssData, lastCreated, horizon) {
  const db = getFirestore();
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  const startBase = normalizeToNoon(lastCreated || parseDate(rssData.startDate) || new Date());
  let cursor = lastCreated ? addDays(startBase, 1) : new Date(startBase);

  const dates = [];
  while (normalizeToNoon(cursor) <= horizon) {
    if (!isWeekend(cursor)) dates.push(normalizeToNoon(cursor));
    cursor = addDays(cursor, 1);
  }
  if (dates.length === 0) return;

  const internalIds = await allocateInternalIds(db, companyId, dates.length);
  const taskList = await loadRecurringServiceStopTasks(db, companyId, rssData);

  let last = lastCreated ? new Date(lastCreated) : null;

  for (let i = 0; i < dates.length; i++) {
    await uploadServiceStopFromRss({
      db,
      companyId,
      rssData,
      serviceDate: dates[i],
      internalId: internalIds[i],
      taskList,
    });

    last = dates[i];
  }

  if (last) await rssRef.update({ lastCreated: last });
}

// ---------- Weekly / Biweekly ----------
async function createWeeklyStops(companyId, rssData, lastCreated, horizon, intervalDays) {
  const db = getFirestore();
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  // Base cursor: lastCreated + interval, or align from startDate if lastCreated missing
  let serviceDate;

  if (lastCreated) {
    const nextAlignedDate = alignDateToDayOnOrAfter(addDays(lastCreated, 1), rssData.day);
    serviceDate = addDays(nextAlignedDate, -intervalDays);
    console.log('      [createWeeklyStops] lastCreated: ' + lastCreated)
  } else {
    const startDate = normalizeToNoon(parseDate(rssData.startDate) || new Date());
    const alignedStartDate = alignDateToDayOnOrAfter(startDate, rssData.day);
    const targetDow = dayNameToIndex(rssData.day);

    if (alignedStartDate.getTime() !== startDate.getTime()) {
      console.warn("Weekly RSS startDate day does not match selected day", {
        recurringServiceStopId: rssData.id || "",
        rssDay: rssData.day,
        targetDow,
        startDow: startDate.getDay(),
        alignedDow: alignedStartDate.getDay(),
        startDate: startDate.toISOString(),
        alignedStartDate: alignedStartDate.toISOString(),
      });
    }

    console.log('      [createWeeklyStops] targetDow: ' + targetDow)
    console.log('      [createWeeklyStops] startDow: ' + startDate.getDay())
    serviceDate = addDays(alignedStartDate, -intervalDays);
  }

  // Collect dates to create up to horizon
  const dates = [];

  console.log('      [createWeeklyStops] serviceDate: ' + serviceDate)
  while (true) {
    console.log('      [createWeeklyStops] horizon: ' + horizon)
    serviceDate = addDays(serviceDate, intervalDays);
    console.log('      [createWeeklyStops] serviceDate: ' + serviceDate)
    const normalizedServiceDate = normalizeToNoon(serviceDate);
    if (normalizedServiceDate > horizon) break;
    dates.push(normalizedServiceDate);
  }
  if (dates.length === 0) {
    console.log('      [createWeeklyStops] dates.length: Empty')
    return;
  }
  const internalIds = await allocateInternalIds(db, companyId, dates.length);
  const taskList = await loadRecurringServiceStopTasks(db, companyId, rssData);

  let last = lastCreated ? new Date(lastCreated) : null;
  console.log('      [createWeeklyStops] dates.length: ' + dates.length)
  for (let i = 0; i < dates.length; i++) {
    await uploadServiceStopFromRss({
      db,
      companyId,
      rssData,
      serviceDate: dates[i],
      internalId: internalIds[i],
      taskList,
    });

    last = dates[i];
  }
  console.log('      [createWeeklyStops] Last Created: ' + last)
  if (last) await rssRef.update({ lastCreated: last });
}

// ---------- Monthly ----------
async function createMonthlyStops(companyId, rssData, lastCreated, horizon) {
  const db = getFirestore();
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);
  let cursor = normalizeToNoon(lastCreated || parseDate(rssData.startDate) || new Date());

  if (lastCreated) {
    cursor = addMonths(cursor, 1);
  }

  const dates = [];
  while (normalizeToNoon(cursor) <= horizon) {
    dates.push(normalizeToNoon(cursor));
    cursor = addMonths(cursor, 1);
  }

  if (dates.length === 0) return;

  const internalIds = await allocateInternalIds(db, companyId, dates.length);
  const taskList = await loadRecurringServiceStopTasks(db, companyId, rssData);
  let last = lastCreated ? new Date(lastCreated) : null;

  for (let i = 0; i < dates.length; i++) {
    await uploadServiceStopFromRss({
      db,
      companyId,
      rssData,
      serviceDate: dates[i],
      internalId: internalIds[i],
      taskList,
    });

    last = dates[i];
  }

  if (last) await rssRef.update({ lastCreated: last });
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
