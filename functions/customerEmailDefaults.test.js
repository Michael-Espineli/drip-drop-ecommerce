const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");
const { createCustomerEmailDefaults } = require("./customerEmailDefaults");
const company = "companies/company";
const preferences = `${company}/settings/emailConfiguration/customerConfiguration`;
const timestamp = new Date("2026-11-05T20:00:00Z");
const request = { companyId: "company", customerId: "new" };
const fixture = (extra = {}) => new MemoryFirestore({
  [`${company}/customers/new`]: { email: "customer@example.test" },
  [`${company}/settings/emailConfiguration`]: { emailIsOn: false },
  ...extra,
});

test("new customers get an enabled preference without changing company delivery", async () => {
  const db = fixture();
  assert.deepEqual(await createCustomerEmailDefaults(db, () => timestamp)(request), { created: true });
  assert.equal(db.records.get(`${preferences}/new`).emailIsOn, true);
  assert.equal(db.records.get(`${preferences}/new`).customerId, "new");
  assert.equal(db.records.get(`${company}/settings/emailConfiguration`).emailIsOn, false);
  assert.equal(db.records.size, 3);
});
test("repeated customer-created events never re-enable a subsequently disabled customer", async () => {
  const db = fixture(), initialize = createCustomerEmailDefaults(db);
  await initialize(request);
  db.set(`${preferences}/new`, { emailIsOn: false }, { merge: true });
  const before = new Map(db.records);
  assert.deepEqual(await initialize(request), { created: false });
  assert.deepEqual(db.records, before);
});
test("legacy preferences with generated IDs retain their saved choice", async () => {
  for (const emailIsOn of [false, true]) {
    const db = fixture({ [`${preferences}/legacy`]: { customerId: "new", emailIsOn } });
    assert.deepEqual(await createCustomerEmailDefaults(db)(request), { created: false });
    assert.equal(db.records.has(`${preferences}/new`), false);
    assert.equal(db.records.get(`${preferences}/legacy`).emailIsOn, emailIsOn);
  }
});
test("an opt-out saved concurrently with initialization wins after transaction retry", async () => {
  const db = fixture();
  db.beforeCommit = () => db.set(`${preferences}/new`, { customerId: "new", emailIsOn: false });
  assert.deepEqual(await createCustomerEmailDefaults(db)(request), { created: false });
  assert.equal(db.records.get(`${preferences}/new`).emailIsOn, false);
});
test("a delayed event for a deleted customer creates no orphan preference", async () => {
  const db = fixture();
  db.records.delete(`${company}/customers/new`);
  assert.deepEqual(await createCustomerEmailDefaults(db)(request), { created: false });
  assert.equal(db.records.has(`${preferences}/new`), false);
});
