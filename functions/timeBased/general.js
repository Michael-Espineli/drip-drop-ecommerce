const {onSchedule} = require("firebase-functions/scheduler");
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
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

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
    await expandRecurringServiceStop({ companyId, rssData });
  }
}

// ---------- Core Expander ----------
async function expandRecurringServiceStop({ companyId, rssData }) {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 28); // rolling 4-week lookahead

  const lastCreated = parseDate(rssData.lastCreated);
  if (!lastCreated) {
    // If missing, treat as "startDate - 1 day" for daily-ish so we create starting at startDate.
    // This is safer than doing nothing.
    console.log(`RSS ${rssData.id}: missing lastCreated`);
  } else {
    // Stop early if already ahead
    if (lastCreated >= horizon) return;
  }

  switch (rssData.frequency) {
    case "Daily":
      await createDailyStops(companyId, rssData, lastCreated, horizon);
      break;

    case "Week Day":
      await createWeekdayStops(companyId, rssData, lastCreated, horizon);
      break;

    case "Weekly":
      await createWeeklyStops(companyId, rssData, lastCreated, horizon, 7);
      break;

    case "Bi-Weekly":
      await createWeeklyStops(companyId, rssData, lastCreated, horizon, 14);
      break;

    case "Monthly":
      // iOS monthly helper is currently broken (infinite loop). If you fix iOS monthly, we can implement it here too.
      break;

    default:
      break;
  }
}

// ---------- Helpers (match iOS semantics) ----------
function parseDate(d) {
  if (!d) return null;
  if (typeof d?.toDate === "function") return d.toDate(); // Firestore Timestamp
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWeekend(date) {
  const dow = date.getDay(); // 0=Sun ... 6=Sat
  return dow === 0 || dow === 6;
}

const weekdayArry = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function dayNameToIndex(name) {
  return weekdayArry.indexOf(name);
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
  return {
    id: idss,                       // iOS: "comp_ss_" + UUID
    internalId: internalId,         // iOS: "S" + count (weekly uses SettingsManager, others use settings doc)
    companyId: companyId,           // iOS includes companyId in the model
    companyName: "",

    customerId: rssData.customerId,
    customerName: rssData.customerName,
    address: rssData.address,

    dateCreated: new Date(),
    serviceDate: serviceDate,

    startTime: null,
    endTime: null,

    duration: rssData.estimatedTime ?? 0,          // closer to iOS daily helper (uses estimatedTime)
    estimatedDuration: rssData.estimatedTime ?? 0, // iOS has estimatedDuration

    tech: rssData.tech,
    techId: rssData.techId,

    recurringServiceStopId: rssData.id,

    description: rssData.description,
    serviceLocationId: rssData.serviceLocationId,

    typeId: rssData.typeId,
    type: rssData.type,
    typeImage: rssData.typeImage,

    jobId: "",
    jobName: "", // iOS standard

    operationStatus: "Not Started", // iOS is enum .notFinished; DB string used elsewhere
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

// ---------- Daily ----------
async function createDailyStops(companyId, rssData, lastCreated, horizon) {
  const db = getFirestore();
  const serviceStopsCol = `companies/${companyId}/serviceStops`;
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  // Next date is lastCreated + 1 day; if lastCreated missing, start at startDate
  const startBase = lastCreated ? new Date(lastCreated) : (parseDate(rssData.startDate) || new Date());
  let cursor = lastCreated ? addDays(startBase, 1) : new Date(startBase);

  // Collect dates to create up to horizon
  const dates = [];
  while (cursor <= horizon) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  if (dates.length === 0) return;

  // Allocate internal IDs in one transaction
  const internalIds = await allocateInternalIds(db, companyId, dates.length);

  let last = lastCreated ? new Date(lastCreated) : null;

  // Write stops sequentially
  for (let i = 0; i < dates.length; i++) {
    const serviceDate = dates[i];
    const idss = "comp_ss_" + uuidv4();

    const serviceStop = buildServiceStopIOSShape({
      companyId,
      rssData,
      serviceDate,
      idss,
      internalId: internalIds[i],
    });

    await db.collection(serviceStopsCol).doc(idss).set(serviceStop);
    last = serviceDate;
  }

  if (last) await rssRef.update({ lastCreated: new Date() });
}

// ---------- Weekday ----------
async function createWeekdayStops(companyId, rssData, lastCreated, horizon) {
  const db = getFirestore();
  const serviceStopsCol = `companies/${companyId}/serviceStops`;
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  const startBase = lastCreated ? new Date(lastCreated) : (parseDate(rssData.startDate) || new Date());
  let cursor = lastCreated ? addDays(startBase, 1) : new Date(startBase);

  const dates = [];
  while (cursor <= horizon) {
    if (!isWeekend(cursor)) dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  if (dates.length === 0) return;

  const internalIds = await allocateInternalIds(db, companyId, dates.length);

  let last = lastCreated ? new Date(lastCreated) : null;

  for (let i = 0; i < dates.length; i++) {
    const serviceDate = dates[i];
    const idss = "comp_ss_" + uuidv4();

    const serviceStop = buildServiceStopIOSShape({
      companyId,
      rssData,
      serviceDate,
      idss,
      internalId: internalIds[i],
    });

    await db.collection(serviceStopsCol).doc(idss).set(serviceStop);
    last = serviceDate;
  }

  if (last) await rssRef.update({ lastCreated: last });
}

// ---------- Weekly / Biweekly ----------
async function createWeeklyStops(companyId, rssData, lastCreated, horizon, intervalDays) {
  const db = getFirestore();
  const serviceStopsCol = `companies/${companyId}/serviceStops`;
  const rssRef = db.collection(`companies/${companyId}/recurringServiceStop`).doc(rssData.id);

  // Base cursor: lastCreated + interval, or align from startDate if lastCreated missing
  let serviceDate;

  if (lastCreated) {
    serviceDate = new Date(lastCreated);
    console.log('      [creakWeeklyStops] lastCreated: ' + lastCreated)
  } else {
    // Align first date to rssData.day on/after startDate (iOS intended behavior)
    const startDate = parseDate(rssData.startDate) || new Date();
    const targetDow = dayNameToIndex(rssData.day);
    if (targetDow < 0) throw new Error(`Invalid rssData.day: ${rssData.day}`);

    const startDow = startDate.getDay();
    let diff = targetDow - startDow;
    if (diff < 0) diff += 7;
    console.log('      [creakWeeklyStops] targetDow: ' + targetDow)
    console.log('      [creakWeeklyStops] startDow: ' + startDow)
    console.log('      [creakWeeklyStops] diff: ' + diff)
    serviceDate = addDays(startDate, diff);
    // We want to CREATE this first aligned occurrence if it's not beyond horizon.
    // So set lastCreated to "serviceDate - interval" so loop creates serviceDate first.
    serviceDate = addDays(serviceDate, -intervalDays);
  }

  // Collect dates to create up to horizon
  const dates = [];

  console.log('      [creakWeeklyStops] serviceDate: ' + serviceDate)
  while (true) {
    console.log('      [creakWeeklyStops] horizon: ' + horizon)
    serviceDate = addDays(serviceDate, intervalDays);
    console.log('      [creakWeeklyStops] serviceDate: ' + serviceDate)
    if (serviceDate > horizon) break;
    dates.push(new Date(serviceDate));
  }
  if (dates.length === 0) {
    console.log('      [creakWeeklyStops] dates.length: Empty')
    return;
  }
  const internalIds = await allocateInternalIds(db, companyId, dates.length);

  let last = lastCreated ? new Date(lastCreated) : null;
  console.log('      [creakWeeklyStops] dates.length: ' + dates.length)
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const idss = "comp_ss_" + uuidv4();

    const serviceStop = buildServiceStopIOSShape({
      companyId,
      rssData,
      serviceDate: d,
      idss,
      internalId: internalIds[i],
    });

    await db.collection(serviceStopsCol).doc(idss).set(serviceStop);

    last = d;
  }
  console.log('      [creakWeeklyStops] Last Created: ' + last)
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
    console.log("Called onRssCreated ",rssId)
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
    console.log("Called onRssUpdated ",rssId)

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
    console.log("Called onRssDeleted ",rssId)

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
