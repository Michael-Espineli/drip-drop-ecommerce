// Run with Auth, Firestore, and Functions emulators on demo-payroll-stop-completion.
const { randomUUID } = require("node:crypto");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: pause } = require("node:timers/promises");
const admin = require("firebase-admin");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp, writeBatch } = require("firebase/firestore");
const { COMPANY_ID } = require("./payrollStopCompletion");

const projectId = "demo-payroll-stop-completion";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const functionsHost = process.env.DRIP_PAYROLL_FUNCTIONS_EMULATOR || "127.0.0.1:5001";
const enabled = Boolean(firestoreHost && authHost);
if (enabled && [firestoreHost, authHost, functionsHost].some(value => !/^127\.0\.0\.1:\d+$/.test(value))) {
  throw new Error("Use localhost emulators for the isolated payroll completion demo.");
}
const sandbox = enabled ? admin.initializeApp({ projectId }, "payroll-completion-demo") : null;
const db = sandbox?.firestore();
const clients = [];
after(async () => {
  await Promise.all(clients.map(app => deleteApp(app)));
  if (sandbox) await sandbox.delete();
});

const serviceDate = new Date("2026-10-27T07:00:00Z");
const clockIn = new Date("2026-10-27T17:00:00Z");
const clockOut = new Date("2026-10-27T17:30:00Z");
const range = { startDate: "2026-10-27", endDate: "2026-10-27" };

async function client() {
  const app = initializeApp({ apiKey: "demo-key", appId: "payroll-demo", projectId }, randomUUID());
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const { user } = await createUserWithEmailAndPassword(auth, `${app.name}@example.test`, "local-test-password");
  const [, firestorePort] = firestoreHost.split(":");
  const [, functionsPort] = functionsHost.split(":");
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", Number(firestorePort));
  const functions = getFunctions(app);
  connectFunctionsEmulator(functions, "127.0.0.1", Number(functionsPort));
  const invoke = httpsCallable(functions, "managePayrollStopCompletion");
  return { uid: user.uid, firestore, call: async (action, data = {}) => (await invoke({ companyId: COMPANY_ID, action, ...data })).data };
}

async function until(check, label) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await pause(325);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const comparablePay = line => [line.technicianId, line.completedDate?.toMillis?.() ?? line.completedDateMillis,
  line.rateAmountCents, line.quantity, line.quantityUnit, line.totalAmountCents, line.calculationStatus];

test("real callable and mobile completion trigger agree on actual pay and route progress for test stops", { skip: !enabled, timeout: 90000 }, async () => {
  const reset = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(reset.ok, "reset the dedicated Firestore demo before seeding");
  const [owner, tech, viewer] = await Promise.all([client(), client(), client()]);
  const company = db.collection("companies").doc(COMPANY_ID);
  const stops = company.collection("serviceStops");
  const batch = db.batch();
  const put = (path, value) => batch.set(company.collection(path.split("/")[0]).doc(path.split("/")[1]), value);
  batch.set(company, { ownerId: owner.uid, timeZone: "America/Los_Angeles" });
  put("settings/emailConfiguration", { emailIsOn: true, requirePhoto: false,
    serviceStopCategorySettings: { Job: { sendEmailOnFinish: true, requirePhotoOnFinish: true } } });
  put("paySettings/main", { routePaySource: "serviceStopAndCompletedTasks", taskPaySource: "technicianRate" });
  put("roles/field-tech", { name: "Technician", permissionIdList: [] });
  put("roles/pay-viewer", { name: "Payroll Viewer", permissionIdList: ["240", "420"] });
  batch.set(db.doc(`users/${tech.uid}/userAccess/${COMPANY_ID}`), { roleId: "field-tech", status: "Active" });
  batch.set(db.doc(`users/${viewer.uid}/userAccess/${COMPANY_ID}`), { roleId: "pay-viewer", status: "Active" });
  put("companyUsers/tech", { userId: tech.uid, userName: "Field tech" });
  put("companyPayTypes/pools", { name: "Pool service", defaultRateType: "perBodyOfWater" });
  put("companyPayTypes/extra", { name: "Additional service", defaultRateType: "flatPerTask" });
  put("companyPayTypes/hourly", { name: "Hourly service", defaultRateType: "hourly" });
  for (const [id, rateType, payBasis, amountCents] of [
    ["pools", "perBodyOfWater", "serviceStop", 2500], ["extra", "flatPerTask", "serviceStopTask", 1200], ["hourly", "hourly", "technicianHourly", 3000],
  ]) {
    put(`technicianRates/${id}`, { technicianId: tech.uid, payTypeId: id, status: "active", payBasis, rateType, amountCents,
      effectiveStartDate: new Date("2026-01-01T00:00:00Z") });
  }
  put("bodiesOfWater/pool", { serviceLocationId: "site", isActive: true });
  put("bodiesOfWater/spa", { serviceLocationId: "site", isActive: true });
  put("customers/onboarding", { onboardingRequired: true });
  put("serviceLocations/onboarding", { serviceOnboarding: { required: true, status: "pending" } });
  put("workOrders/bulk-job", { operationStatus: "In Progress" });
  batch.set(company.collection("workOrders").doc("bulk-job").collection("tasks").doc("canonical"),
    { status: "Scheduled", workerId: tech.uid, payTypeId: "extra", serviceStopId: "linked" });

  const routine = { operationStatus: "Scheduled", techId: tech.uid, tech: "Field tech", serviceLocationId: "site",
    type: "Pool service", payTypeId: "pools", serviceDate, category: "Route" };
  const fixtures = {
    mobile: { ...routine, startTime: clockIn, actualDuration: 30 },
    bulk: { ...routine, startTime: clockIn, actualDuration: 30 },
    hourly: { ...routine, payTypeId: "hourly", estimatedDuration: 45, duration: 45 },
    unpaid: { ...routine, payrollMode: "unpaid" },
    linked: { ...routine, jobId: "bulk-job" },
    skipped: { ...routine, operationStatus: "Skipped" },
    cancelled: { ...routine, operationStatus: "Cancelled" },
    photo: { ...routine, category: "Job" },
    onboarding: { ...routine, customerId: "onboarding", serviceLocationId: "onboarding" },
    future: { ...routine, serviceDate: new Date("2099-11-28T20:00:00Z") },
  };
  for (const [id, data] of Object.entries(fixtures)) batch.set(stops.doc(id), data);
  for (const id of ["mobile", "bulk"]) {
    put(`activeRoutes/${id}`, { serviceStopsIds: [id], date: serviceDate, techId: tech.uid, status: "In Progress" });
    batch.set(stops.doc(id).collection("tasks").doc("perform"), { name: "Extra work", status: "Scheduled", payTypeId: "extra" });
    batch.set(stops.doc(id).collection("tasks").doc("leave-open"), { name: "Open work", status: "Scheduled", payTypeId: "extra" });
    batch.set(stops.doc(id).collection("tasks").doc("cancelled"), { name: "Cancelled work", status: "Cancelled", payTypeId: "extra" });
  }
  batch.set(stops.doc("linked").collection("tasks").doc("linked-copy"), { name: "Job task", status: "Scheduled",
    jobTaskId: "canonical", workerId: tech.uid, payTypeId: "extra" });
  await batch.commit();
  await until(async () => (await Promise.all(["bulk", "hourly", "unpaid", "linked"].map(id => stops.doc(id).get())))
    .every(snapshot => snapshot.data()?.payrollLastProcessedAt), "initial stop reconciliation");

  const mobile = doc(tech.firestore, stops.doc("mobile").path);
  const mobileWork = doc(tech.firestore, company.collection("serviceStopCompletionWork").doc("mobile").path);
  const mobileBatch = writeBatch(tech.firestore);
  mobileBatch.update(mobile, { operationStatus: "Finished", endTime: clockOut, duration: 30,
    completionWorkStatus: "queued", completionWorkRequestId: "mobile-test", completionWorkQueuedAt: serverTimestamp(),
    completionWorkQueuedByUserId: tech.uid, completionWorkSendServiceReport: false });
  mobileBatch.set(mobileWork, { id: "mobile", companyId: COMPANY_ID, serviceStopId: "mobile", requestId: "mobile-test",
    status: "queued", operationStatus: "Finished", queuedAt: serverTimestamp(), queuedByUserId: tech.uid,
    sendServiceReport: false, serviceDate, techId: tech.uid, techName: "Field tech", attempts: 0 });
  await setDoc(doc(tech.firestore, stops.doc("mobile").collection("tasks").doc("perform").path), {
    status: "Finished", completedAt: clockOut,
  }, { merge: true });
  await mobileBatch.commit();
  await until(async () => (await company.collection("serviceStopCompletionWork").doc("mobile").get()).data()?.status === "completed", "native completion");

  const parked = await viewer.call("preview", range);
  assert.deepEqual(parked.items.map(row => row.stopId).sort(), ["bulk", "hourly", "linked", "onboarding", "photo", "unpaid"]);
  assert.match(parked.items.find(row => row.stopId === "photo").blockedReason, /photo/i);
  assert.match(parked.items.find(row => row.stopId === "onboarding").blockedReason, /release/i);
  assert.deepEqual((await owner.call("preview", { startDate: "2099-11-28", endDate: "2099-11-28" })).items, []);
  await assert.rejects(tech.call("preview", range), error => error.code === "functions/permission-denied");
  assert.equal((await stops.doc("bulk").get()).data().operationStatus, "Scheduled");
  assert.equal((await company.collection("technicianPayLineItems").where("serviceStopId", "==", "bulk").get()).size, 0);

  const preview = await owner.call("preview", { ...range, stops: [
    { stopId: "bulk", taskIds: ["perform"] }, { stopId: "linked", taskIds: ["linked-copy"] },
  ] });
  const selected = preview.items.filter(row => !row.blockedReason);
  const buy = selected.find(row => row.stopId === "bulk");
  assert.equal(buy.pay.lineItems.reduce((sum, line) => sum + line.totalAmountCents, 0), 6200);
  assert.match(selected.find(row => row.stopId === "hourly").pay.lineItems[0].notes, /work minutes/i);
  assert.deepEqual(selected.find(row => row.stopId === "unpaid").pay.lineItems, []);
  const pick = row => ({ stopId: row.stopId, version: row.version, taskIds: row.selectedTaskIds });
  const payload = { ...range, runId: "bulk-test", stops: selected.map(pick), sendServiceReport: true };
  await assert.rejects(viewer.call("finish", payload), error => error.code === "functions/permission-denied");
  await stops.doc("bulk").collection("tasks").doc("perform").update({ description: "Checked during preview" });
  await assert.rejects(owner.call("finish", payload), error => error.code === "functions/failed-precondition");
  assert.equal((await stops.doc("hourly").get()).data().operationStatus, "Scheduled");
  const fresh = await owner.call("preview", { ...range, stops: [{ stopId: "bulk", taskIds: ["perform"] },
    { stopId: "linked", taskIds: ["linked-copy"] }] });
  payload.stops = fresh.items.filter(row => !row.blockedReason).map(pick);
  await owner.call("finish", payload);
  const status = () => viewer.call("status", { runId: payload.runId });
  const result = await until(async () => { const run = await status(); return !run.pending && run; }, "bulk payroll results");
  const row = id => result.items.find(item => item.stopId === id);
  assert.equal(row("bulk").status, "recorded");
  assert.equal(row("bulk").finishedTaskCount, 1);
  assert.equal(row("hourly").status, "needsReview");
  assert.equal(row("unpaid").status, "noPay");
  assert.equal(row("linked").status, "recorded");
  assert.equal((await stops.doc("hourly").get()).data().duration, null);
  assert.equal((await stops.doc("hourly").get()).data().endTime, undefined);
  assert.equal((await stops.doc("bulk").collection("tasks").doc("leave-open").get()).data().status, "Scheduled");
  assert.equal((await company.collection("workOrders").doc("bulk-job").get()).data().operationStatus, "In Progress");
  assert.equal((await company.collection("workOrders").doc("bulk-job").collection("tasks").doc("canonical").get()).data().status, "Finished");

  const workRef = company.collection("serviceStopCompletionWork").doc("bulk");
  const work = (await workRef.get()).data();
  assert.equal(work.sendServiceReport, false);
  assert.equal(work.result.serviceReportEmail, undefined);
  assert.equal(work.result.payroll.lineItems, undefined);
  const receipt = company.collection("payrollStopCompletionRuns").doc(payload.runId).collection("results").doc("bulk");
  await assert.rejects(getDoc(doc(tech.firestore, receipt.path)), error => error.code === "permission-denied");
  const ledger = id => company.collection("technicianPayLineItems").where("serviceStopId", "==", id).get();
  const details = snap => snap.docs.map(doc => comparablePay(doc.data())).sort();
  const [mobileLedger, bulkLedger] = await Promise.all([ledger("mobile"), ledger("bulk")]);
  assert.equal(bulkLedger.size, 2);
  assert.deepEqual(details(mobileLedger), details(bulkLedger));
  assert.deepEqual(details(bulkLedger), row("bulk").pay.lineItems.map(comparablePay).sort());
  for (const id of ["mobile", "bulk"]) {
    assert.equal((await company.collection("activeRoutes").doc(id).get()).data().finishedStops, 1);
  }

  await owner.call("finish", payload);
  assert.equal((await ledger("bulk")).size, 2);
  const finishedStop = (await stops.doc("bulk").get()).data();
  await workRef.update({ status: "completedWithErrors", result: { payroll: { message: "Injected transient emulator failure" } },
    errorMessages: ["payroll: Injected transient emulator failure"], attempts: 2 });
  assert.equal((await status()).items.find(item => item.stopId === "bulk").status, "failed");
  await owner.call("retry", { runId: payload.runId, stopId: "bulk" });
  const retried = await until(async () => {
    const current = (await status()).items.find(item => item.stopId === "bulk");
    return current.status === "recorded" && current;
  }, "retry receipt");
  assert.deepEqual(retried.pay.lineItems.map(comparablePay).sort(), details(bulkLedger));
  assert.equal((await stops.doc("bulk").get()).data().completedAt.toMillis(), finishedStop.completedAt.toMillis());
  assert.equal((await ledger("bulk")).size, 2);
});
