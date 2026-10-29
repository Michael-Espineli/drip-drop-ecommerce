const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const admin = require("firebase-admin");
const { createHandlers, validateSubmission, getPublicRepairRequestCompany, getPublicRepairRequestOptions, submitPublicRepairRequest } = require("./publicRepairRequests");
const express = require("express");

assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/, "Run these tests with the Firestore emulator.");
admin.initializeApp({ projectId: "demo-public-repair-requests" });
const firestore = admin.firestore();
let companyId;
let payload;
let handlers;
let savedFiles;
let failUpload;
const clock = { value: Date.now() };
const png = { name: "pool.png", contentType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" };

const seedCompany = async (id) => {
  const batch = firestore.batch();
  const fixtures = {
    "": { name: "Test Pool Company", ownerId: "private-owner", billingEmail: "private@example.com" },
    "/companyUsers/tech-alex": { firstName: "Alex", lastName: "Technician", userId: "auth-tech-alex", status: "Active", email: "private-tech@example.com", salary: 12345 },
    "/customers/customer-taylor": { firstName: "Taylor", lastName: "Homeowner", email: "private-customer@example.com", billingNotes: "Private notes" },
    "/serviceLocations/location-main": { customerId: "customer-taylor", nickName: "Backyard", address: { streetAddress: "123 Example Street", city: "Sample City", state: "CA", zip: "90001" }, gateCode: "private-code" },
    "/bodiesOfWater/pool-main": { name: "Main pool", customerId: "customer-taylor", serviceLocationId: "location-main", notes: "Private pool notes" },
    "/equipment/pump-main": { name: "Main pump", model: "Model A", customerId: "customer-taylor", serviceLocationId: "location-main", status: "Operational", notes: "Private equipment notes" },
  };
  for (const [suffix, data] of Object.entries(fixtures)) batch.set(firestore.doc(`companies/${id}${suffix}`), data);
  await batch.commit();
};

beforeEach(async () => {
  companyId = `company_${randomUUID()}`;
  await seedCompany(companyId);
  payload = {
    companyId, submissionId: randomUUID(), requesterCompanyUserId: "tech-alex", customerId: "customer-taylor",
    locationId: "location-main", bodyOfWaterId: "pool-main", equipmentId: "pump-main", equipmentStatusUpdate: "Needs Repair",
    description: "The pool pump is making an unusual sound.", photos: [],
  };
  savedFiles = [];
  failUpload = false;
  handlers = createHandlers({
    firestore, now: () => clock.value,
    getBucket: () => ({
      name: "test-bucket",
      file: (name) => {
        const file = { name, deleted: false, save: async (buffer, options) => {
          file.buffer = buffer;
          file.options = options;
          if (failUpload) throw new Error("Simulated upload failure");
        }, delete: async () => { file.deleted = true; } };
        savedFiles.push(file);
        return file;
      },
    }),
  });
});

const submit = (data = payload) => handlers.submit({ data, rawRequest: { ip: "192.0.2.10" } });
const requestRef = (requestId, id = companyId) => firestore.doc(`companies/${id}/repairRequests/${requestId}`);
const companyRequests = () => firestore.collection(`companies/${companyId}/repairRequests`).get();

test("the technician form returns only active user names and customer names", async () => {
  await firestore.doc(`companies/${companyId}/companyUsers/tech-inactive`).set({ userName: "Inactive user", status: "Inactive" });
  await firestore.doc(`companies/${companyId}/companyUsers/tech-revoked`).set({ userName: "Revoked user", status: "Revoked" });
  await firestore.doc(`companies/${companyId}/companyUsers/tech-flagged`).set({ userName: "Disabled user", status: "Active", active: false });
  await firestore.doc(`companies/${companyId}/companyUsers/tech-deleted`).set({ userName: "Deleted user", status: "Active", deleted: true });
  await firestore.doc(`companies/${companyId}/companyUsers/tech-zoe`).set({ userName: "Zoe Technician", status: "Active", email: "private@example.com" });
  await firestore.doc(`companies/${companyId}/customers/customer-business`).set({ firstName: "Business", displayAsCompany: true, companyName: "Acme Pools", billingEmail: "private@example.com" });
  await firestore.doc(`companies/${companyId}/customers/customer-deleted`).set({ firstName: "Deleted", deleted: true });
  assert.deepEqual(await handlers.getCompany({ data: { companyId } }), {
    company: { id: companyId, name: "Test Pool Company" },
    users: [{ id: "tech-alex", label: "Alex Technician" }, { id: "tech-zoe", label: "Zoe Technician" }],
    customers: [{ id: "customer-business", label: "Acme Pools" }, { id: "customer-taylor", label: "Taylor Homeowner" }],
  });
});

test("missing or disabled companies cannot receive anonymous submissions", async () => {
  await assert.rejects(submit({ ...payload, companyId: "missing-company" }), { code: "not-found" });
  for (const flag of ["deleted", "publicProfileDisabled", "publicRepairRequestsDisabled"]) {
    await firestore.doc(`companies/${companyId}`).set({ [flag]: true });
    await assert.rejects(submit(), { code: "not-found" });
    await assert.rejects(handlers.getCompany({ data: { companyId } }), { code: "not-found" });
  }
  assert.equal((await companyRequests()).size, 0);
});

test("dependent pickers return only names within the selected customer and location", async () => {
  await firestore.doc(`companies/${companyId}/serviceLocations/location-other`).set({ customerId: "other-customer", nickName: "Other customer location" });
  await firestore.doc(`companies/${companyId}/equipment/pump-other`).set({ serviceLocationId: "location-other", name: "Other pump" });
  assert.deepEqual(await handlers.getOptions({ data: { companyId, customerId: "customer-taylor" } }), {
    serviceLocations: [{ id: "location-main", label: "Backyard" }], bodiesOfWater: [], equipment: [],
  });
  assert.deepEqual(await handlers.getOptions({ data: { companyId, customerId: "customer-taylor", locationId: "location-main" } }), {
    bodiesOfWater: [{ id: "pool-main", label: "Main pool" }], equipment: [{ id: "pump-main", label: "Main pump - Model A" }],
  });
  await assert.rejects(handlers.getOptions({ data: { companyId, customerId: "customer-taylor", locationId: "location-other" } }), { code: "invalid-argument" });
});

test("submission rechecks active users and rejects mismatched or cross-company selections", async () => {
  await firestore.doc(`companies/${companyId}/companyUsers/tech-inactive`).set({ userName: "Inactive", status: "Inactive" });
  await firestore.doc(`companies/${companyId}/serviceLocations/location-other`).set({ customerId: "other-customer" });
  await firestore.doc(`companies/${companyId}/equipment/pump-other`).set({ serviceLocationId: "location-other", customerId: "other-customer" });
  await firestore.doc(`companies/${companyId}/bodiesOfWater/pool-other`).set({ serviceLocationId: "location-other" });
  const otherCompany = `company_${randomUUID()}`;
  await seedCompany(otherCompany);
  await firestore.doc(`companies/${otherCompany}/companyUsers/foreign-tech`).set({ userName: "Foreign", status: "Active" });
  await firestore.doc(`companies/${otherCompany}/customers/foreign-customer`).set({ firstName: "Foreign" });
  for (const change of [
    { requesterCompanyUserId: "tech-inactive" }, { requesterCompanyUserId: "foreign-tech" }, { customerId: "foreign-customer" },
    { locationId: "location-other" }, { equipmentId: "pump-other" }, { bodyOfWaterId: "pool-other" },
  ]) await assert.rejects(submit({ ...payload, ...change }), { code: "invalid-argument" });
  await firestore.doc(`companies/${companyId}/companyUsers/tech-alex`).update({ status: "Inactive" });
  await assert.rejects(submit(), { code: "invalid-argument" });
  assert.equal((await companyRequests()).size, 0);
  assert.equal((await firestore.doc(`companies/${companyId}/equipment/pump-main`).get()).data().status, "Operational");
});

test("a signed-out request is stored as external and creates an office alert atomically", async () => {
  const { requestId } = await submit({ ...payload, requesterId: "victim", requesterName: "Spoofed", userId: "victim", customerName: "Spoofed", status: "Resolved", companyName: "Spoofed" });
  const record = (await requestRef(requestId).get()).data();
  assert.equal(record.status, "Unresolved");
  assert.equal(record.issuePriorityLevel, 2);
  assert.equal(record.issuePriorityLabel, "Recommended");
  assert.equal(record.companyName, "Test Pool Company");
  assert.equal(record.companyId, companyId);
  assert.equal(record.customerId, "customer-taylor");
  assert.equal(record.customerName, "Taylor Homeowner");
  assert.equal(record.requesterId, "auth-tech-alex");
  assert.equal(record.requesterName, "Alex Technician");
  assert.equal(record.requesterIdentityVerified, false);
  assert.equal(record.submittedByUserId, "");
  assert.equal(record.userId, "");
  assert.equal(record.equipmentId, "pump-main");
  assert.equal(record.equipmentName, "Main pump - Model A");
  assert.equal(record.customerEmail, undefined);
  assert.equal(record.source, "publicTechnician");
  assert.equal(record.serviceLocationAddress, "123 Example Street, Sample City, CA, 90001");
  assert.equal(record.date.toMillis(), clock.value);
  const alert = (await firestore.doc(`companies/${companyId}/alerts/repair_request_created_${requestId}`).get()).data();
  assert.equal(alert.route, `/company/repair-requests/detail/${requestId}`);
  assert.equal(alert.relatedEntity.collectionPath, `companies/${companyId}/repairRequests`);
  assert.equal((await firestore.doc(`companies/${companyId}/equipment/pump-main`).get()).data().status, "Needs Repair");
});

test("selected priorities are validated and saved with server-derived labels", async () => {
  for (const [level, label] of [[1, "Critical"], [2, "Recommended"], [3, "Preventive"], [4, "Optional Upgrade"]]) {
    const { requestId } = await submit({ ...payload, submissionId: randomUUID(), issuePriorityLevel: level, issuePriorityLabel: "Forged", priorityLevel: 999 });
    const record = (await requestRef(requestId).get()).data();
    assert.equal(record.issuePriorityLevel, level);
    assert.equal(record.priorityLevel, level);
    assert.equal(record.issuePriorityLabel, label);
    assert.equal(record.priorityLabel, label);
  }
  for (const level of [0, 5, 1.5, "1", true, {}, []]) {
    assert.throws(() => validateSubmission({ ...payload, issuePriorityLevel: level }), { code: "invalid-argument" });
  }
});

test("default-priority submissions preserve pre-priority retry receipts and reject a changed priority", async () => {
  const { requestId } = await submit();
  const oldInput = validateSubmission(payload);
  delete oldInput.issuePriorityLevel;
  const receiptId = createHash("sha256").update(`${companyId}:${payload.submissionId}`).digest("hex");
  const receipt = (await firestore.doc(`publicRepairRequestSubmissions/${receiptId}`).get()).data();
  assert.equal(receipt.fingerprint, createHash("sha256").update(JSON.stringify(oldInput)).digest("hex"));
  assert.deepEqual(await submit({ ...payload, issuePriorityLevel: 2 }), { requestId });
  await assert.rejects(submit({ ...payload, issuePriorityLevel: 1 }), { code: "invalid-argument" });
  assert.equal((await companyRequests()).size, 1);
});

test("requires technician and customer selections, description, a valid link and a submission id", () => {
  for (const change of [
    { requesterCompanyUserId: "" }, { customerId: "" }, { requesterCompanyUserId: "bad/path" }, { customerId: {} }, { description: " " },
    { locationId: "" }, { equipmentId: "" }, { equipmentStatusUpdate: "Invalid" },
    { description: "a".repeat(5001) }, { companyId: "bad/path" }, { submissionId: "invalid" },
    { website: "bot.example.com" },
  ]) assert.throws(() => validateSubmission({ ...payload, ...change }), { code: "invalid-argument" });
  assert.equal(validateSubmission({ ...payload, locationId: "", bodyOfWaterId: "", equipmentId: "", equipmentStatusUpdate: "" }).customerId, "customer-taylor");
});

test("retries return the same reference without creating another request or alert", async () => {
  const first = await submit();
  assert.deepEqual(await submit(), first);
  assert.equal((await companyRequests()).size, 1);
  assert.equal((await firestore.collection(`companies/${companyId}/alerts`).get()).size, 1);
  await assert.rejects(submit({ ...payload, description: "Different request" }), { code: "invalid-argument" });
});

test("concurrent retries cannot create duplicate requests", async () => {
  const results = await Promise.allSettled([submit(), submit()]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal((await companyRequests()).size, 1);
  assert.equal((await firestore.collection(`companies/${companyId}/alerts`).get()).size, 1);
});

test("rate limits anonymous submissions and permits requests after the window resets", async () => {
  const clientKey = createHash("sha256").update(`${companyId}:192.0.2.10`).digest("hex");
  await firestore.doc(`publicRepairRequestLimits/client_${clientKey}`).set({ count: 29, windowStart: clock.value });
  await submit({ ...payload, submissionId: randomUUID() });
  await assert.rejects(submit({ ...payload, submissionId: randomUUID() }), { code: "resource-exhausted" });
  assert.equal((await companyRequests()).size, 1);
  clock.value += 60 * 60 * 1000 + 1;
  await submit({ ...payload, submissionId: randomUUID() });
  assert.equal((await companyRequests()).size, 2);
});

test("company-wide limit also applies when a visitor uses a new IP", async () => {
  const key = createHash("sha256").update(companyId).digest("hex");
  await firestore.doc(`publicRepairRequestLimits/company_${key}`).set({ count: 1000, windowStart: clock.value });
  await assert.rejects(submit(), { code: "resource-exhausted" });
  assert.equal((await companyRequests()).size, 0);
});

test("checks photo type, content, count, individual size and total size", () => {
  for (const photos of [
    [png, png, png, png],
    [{ ...png, contentType: "image/svg+xml" }],
    [{ ...png, data: Buffer.from("not an image").toString("base64") }],
    [{ ...png, data: png.data + "!" }],
    [{ ...png, data: "A".repeat(3 * 1024 * 1024) }],
    [png, png, png].map((photo) => ({ ...photo, data: Buffer.concat([Buffer.from(png.data, "base64"), Buffer.alloc(1800 * 1024)]).toString("base64") })),
  ]) assert.throws(() => validateSubmission({ ...payload, photos }), { code: "invalid-argument" });
});

test("photos are uploaded through the server and saved in the existing attachment format", async () => {
  const { requestId } = await submit({ ...payload, photos: [png] });
  const record = (await requestRef(requestId).get()).data();
  assert.equal(savedFiles.length, 1);
  assert.equal(savedFiles[0].deleted, false);
  assert.equal(savedFiles[0].options.metadata.contentType, "image/png");
  assert.match(savedFiles[0].name, new RegExp(`^companies/${companyId}/publicRepairRequests/${requestId}/`));
  assert.equal(record.photoUrls[0].description, png.name);
  assert.match(record.photoUrls[0].imageURL, /^https:\/\/firebasestorage.googleapis.com\/v0\/b\/test-bucket\/o\//);
  assert.match(record.photoUrls[0].imageURL, /token=/);
  assert.equal(record.photoUrls[0].data, undefined);
});

test("failed uploads leave no request, clean up files and allow the same submission to retry", async () => {
  failUpload = true;
  await assert.rejects(submit({ ...payload, photos: [png] }), { code: "internal" });
  assert.equal((await companyRequests()).size, 0);
  assert.equal((await firestore.collection(`companies/${companyId}/alerts`).get()).size, 0);
  assert.equal(savedFiles[0].deleted, true);
  failUpload = false;
  await submit({ ...payload, photos: [png] });
  assert.equal((await companyRequests()).size, 1);
});

test("identical submission ids in different companies stay isolated", async () => {
  const first = await submit();
  const otherCompanyId = `company_${randomUUID()}`;
  await seedCompany(otherCompanyId);
  const second = await submit({ ...payload, companyId: otherCompanyId });
  assert.notEqual(first.requestId, second.requestId);
  assert.equal((await requestRef(second.requestId, otherCompanyId).get()).data().companyId, otherCompanyId);
});

test("public submissions do not grant anonymous database reads or writes", async () => {
  const { requestId } = await submit();
  const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-public-repair-requests/databases/(default)/documents`;
  for (const resource of [
    `companies/${companyId}`, `companies/${companyId}/customers`,
    `companies/${companyId}/repairRequests/${requestId}`, `companies/${companyId}/repairRequests`,
    `companies/${companyId}/companyUsers`, "homeownerRepairRequests",
    "publicRepairRequestSubmissions", "publicRepairRequestLimits",
  ]) {
    const response = await fetch(`${base}/${resource}`);
    assert.equal(response.status, 403, `Anonymous read should be denied: ${resource}`);
  }
  const response = await fetch(`${base}/companies/${companyId}/repairRequests/forged-request`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { companyId: { stringValue: companyId }, status: { stringValue: "Unresolved" } } }),
  });
  assert.equal(response.status, 403);
  for (const method of ["PATCH", "DELETE"]) {
    const response = await fetch(`${base}/companies/${companyId}/repairRequests/${requestId}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify({ fields: { status: { stringValue: "Resolved" } } }) } : {}),
    });
    assert.equal(response.status, 403, `Anonymous ${method} should be denied.`);
  }
  assert.equal((await requestRef(requestId).get()).data().status, "Unresolved");
});

test("the actual HTTP callables accept signed-out requests with no auth or App Check token", async () => {
  const app = express();
  app.use(express.json());
  app.all("/company", getPublicRepairRequestCompany);
  app.all("/options", getPublicRepairRequestOptions);
  app.all("/submit", submitPublicRepairRequest);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = { "Content-Type": "application/json", Origin: "https://dripdrop-poolapp.com" };
    const companyResponse = await fetch(`${base}/company`, {
      method: "POST", headers, body: JSON.stringify({ data: { companyId } }),
    });
    assert.equal(companyResponse.status, 200);
    assert.equal(companyResponse.headers.get("access-control-allow-origin"), headers.Origin);
    assert.deepEqual(await companyResponse.json(), { result: {
      company: { id: companyId, name: "Test Pool Company" },
      users: [{ id: "tech-alex", label: "Alex Technician" }],
      customers: [{ id: "customer-taylor", label: "Taylor Homeowner" }],
    } });
    const optionsResponse = await fetch(`${base}/options`, { method: "POST", headers, body: JSON.stringify({ data: { companyId, customerId: payload.customerId } }) });
    assert.equal(optionsResponse.status, 200);
    assert.deepEqual((await optionsResponse.json()).result.serviceLocations, [{ id: "location-main", label: "Backyard" }]);

    const submitResponse = await fetch(`${base}/submit`, { method: "POST", headers, body: JSON.stringify({ data: payload }) });
    assert.equal(submitResponse.status, 200);
    const { result } = await submitResponse.json();
    const record = (await requestRef(result.requestId).get()).data();
    assert.equal(record.requesterId, "auth-tech-alex");
    assert.equal(record.requesterIdentityVerified, false);
    assert.equal(record.userId, "");
    assert.equal(record.status, "Unresolved");
    assert.equal(record.companyId, companyId);

    for (const origin of ["https://dripdrop-poolapp.com", "https://www.dripdrop-poolapp.com", "https://the-pool-app-dev.web.app", "http://localhost:3020"]) {
      const preflight = await fetch(`${base}/submit`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a lost commit response still returns success and keeps the uploaded photos", async () => {
  let transactionCount = 0;
  const flakyFirestore = {
    doc: (value) => firestore.doc(value),
    runTransaction: async (callback) => {
      const result = await firestore.runTransaction(callback);
      transactionCount += 1;
      if (transactionCount === 2) throw new Error("Simulated lost commit response");
      return result;
    },
  };
  const file = { name: "test.png", deleted: false, save: async () => {}, delete: async () => { file.deleted = true; } };
  const flakyHandlers = createHandlers({ firestore: flakyFirestore, getBucket: () => ({ name: "test-bucket", file: () => file }) });
  const { requestId } = await flakyHandlers.submit({ data: { ...payload, photos: [png] } });
  assert.equal((await requestRef(requestId).get()).exists, true);
  assert.equal(file.deleted, false);
});
