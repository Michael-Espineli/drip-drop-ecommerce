const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");
admin.initializeApp({ projectId: "demo-service-report-email" });
const db = new MemoryFirestore({});
admin.firestore().collection = (...args) => db.collection(...args);
process.env.SEND_GRID_API_KEY = "SG.test.test";
const messages = [];
require("@sendgrid/mail").send = async message => { messages.push(message); return [{}]; };
const { sendServiceReportOnFinishCore, sendJobEstimateEmail } = require("./sendGrid/general");
const company = "companies/company", settings = `${company}/settings/emailConfiguration`;
const preferences = `${settings}/customerConfiguration`;
function fixture(extra = {}) {
  db.records.clear(); messages.length = 0;
  for (const [path, data] of Object.entries({
    [company]: { name: "Pool Company", email: "office@example.test" },
    [settings]: { emailIsOn: true, serviceStopCategorySettings: { Route: { sendEmailOnFinish: true } } },
    [`${company}/customers/customer`]: { email: "customer@example.test", customerUserId: "homeowner" },
    [`${company}/serviceStops/stop`]: { customerId: "customer", category: "Route", customerName: "Customer" },
    "featureFlags/feature_flag_012": { enabled: false },
    ...extra,
  })) db.set(path, data);
}
const send = () => sendServiceReportOnFinishCore({ companyId: "company", serviceStopId: "stop" });

test("a new customer with no preference record gets a report through the existing test routing", async () => {
  fixture();
  const result = await send();
  assert.equal(result.status, 200);
  assert.equal(result.account, "Successfully Sent");
  assert.equal(result.testMode, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "mespineli@dripdrop-poolapp.com");
  assert.equal(messages[0].dynamicTemplateData.intendedCustomerEmail, "customer@example.test");
});
test("company-wide off blocks reports even when the category and customer are enabled", async () => {
  fixture({ [settings]: { emailIsOn: false, serviceStopCategorySettings: { Route: { sendEmailOnFinish: true } } }, [`${preferences}/customer`]: { customerId: "customer", emailIsOn: true } });
  assert.equal((await send()).account, "Company email is turned off");
  assert.equal(messages.length, 0);
});
test("company-wide off also blocks the legacy customer estimate email", async () => {
  fixture({ [settings]: { emailIsOn: false } });
  const result = await sendJobEstimateEmail.run({ companyId: "company", serviceStopId: "stop" }, {});
  assert.equal(result.account, "Company email is turned off");
  assert.equal(messages.length, 0);
});
test("turning the company back on uses the customer's existing enabled preference", async () => {
  fixture({ [settings]: { emailIsOn: false, serviceStopCategorySettings: { Route: { sendEmailOnFinish: true } } } });
  await send();
  db.set(settings, { emailIsOn: true }, { merge: true });
  assert.equal((await send()).account, "Successfully Sent");
  assert.equal(messages.length, 1);
});
test("explicit customer off is honored, including conflicting legacy duplicates", async () => {
  fixture({ [`${preferences}/a`]: { customerId: "customer", emailIsOn: true }, [`${preferences}/z`]: { customerId: "customer", emailIsOn: false } });
  assert.equal((await send()).account, "Customer email is turned off");
  assert.equal(messages.length, 0);
});
test("the new default still honors disabled categories and homeowner notification preferences", async () => {
  fixture({ [settings]: { emailIsOn: true, serviceStopCategorySettings: { Route: { sendEmailOnFinish: false } } } });
  assert.equal((await send()).account, "Category email is turned off");
  assert.equal(messages.length, 0);
  fixture({ [`${company}/customers/customer`]: { email: "customer@example.test", linkedCustomerIds: ["homeowner"] }, "users/homeowner": { settings: { emailNotifications: false } } });
  assert.equal((await send()).account, "Homeowner service update emails are turned off");
  assert.equal(messages.length, 0);
});
after(() => admin.app().delete());
