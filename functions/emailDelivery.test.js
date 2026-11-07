const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");
admin.initializeApp({ projectId: "demo-email-delivery" });
const db = new MemoryFirestore({});
admin.firestore().collection = (...args) => db.collection(...args);
const { resolveEmailDeliveryRecipient, resolveCompanyEmailDeliveryRecipient } = require("./emailDelivery");
process.env.SEND_GRID_API_KEY = "SG.test.test";
process.env.SEND_GRID_COMPANY_USER_INVITE_TEMPLATE_ID = "test-company-invite";
const sgMail = require("@sendgrid/mail");
const messages = [];
sgMail.send = async message => { messages.push(message); return [{}]; };
const { sendCompanyUserInviteEmailInternal } = require("./sendGrid/general");

test("company invitations always resolve directly without reading the customer flag", async () => {
  const before = db.readLog.length;
  const result = resolveCompanyEmailDeliveryRecipient("  staff@example.test  ");
  assert.equal(result.actualTo, "staff@example.test");
  assert.equal(result.testMode, false);
  assert.equal(result.realEmailsFeatureFlagId, null);
  assert.equal(db.readLog.length, before);
  assert.throws(() => resolveCompanyEmailDeliveryRecipient(" "));
});
test("customer emails default to the internal inbox with a missing or disabled flag", async () => {
  for (const flag of [null, { enabled: false }, { enabled: "true" }]) {
    db.records.clear();
    if (flag) db.set("featureFlags/feature_flag_012", flag);
    const result = await resolveEmailDeliveryRecipient("client@example.test");
    assert.equal(result.actualTo, "mespineli@dripdrop-poolapp.com");
    assert.equal(result.testMode, true);
  }
});
test("customer delivery responds to flag changes without a cached live mode", async () => {
  db.set("featureFlags/feature_flag_012", { enabled: true });
  assert.equal((await resolveEmailDeliveryRecipient("client@example.test")).actualTo, "client@example.test");
  db.set("featureFlags/feature_flag_012", { enabled: false });
  assert.equal((await resolveEmailDeliveryRecipient("client@example.test")).actualTo, "mespineli@dripdrop-poolapp.com");
});
test("the company invitation sender delivers live while customer messages remain redirected", async () => {
  db.set("featureFlags/feature_flag_012", { enabled: false });
  const result = await sendCompanyUserInviteEmailInternal({
    invite: { id: "invite", email: "staff@example.test", companyId: "company" },
    companyData: { name: "Test Company" },
  });
  assert.equal(messages.at(-1).to, "staff@example.test");
  assert.equal(messages.at(-1).dynamicTemplateData.deliveryMode, "real");
  assert.equal(result.testMode, false);
  assert.equal((await resolveEmailDeliveryRecipient("client@example.test")).actualTo, "mespineli@dripdrop-poolapp.com");
});
after(() => admin.app().delete());
test('development override redirects company and customer messages even when live email flags are enabled',async()=>{
 const previous=process.env.FORCE_TEST_EMAIL_DELIVERY;
 process.env.FORCE_TEST_EMAIL_DELIVERY='true';
 try{
  db.set('featureFlags/feature_flag_012',{enabled:true});
  assert.equal((await resolveEmailDeliveryRecipient('client@example.test')).actualTo,'mespineli@dripdrop-poolapp.com');
  const company=resolveCompanyEmailDeliveryRecipient('staff@example.test');assert.equal(company.actualTo,'mespineli@dripdrop-poolapp.com');assert.equal(company.testMode,true);
 }finally{if(previous===undefined)delete process.env.FORCE_TEST_EMAIL_DELIVERY;else process.env.FORCE_TEST_EMAIL_DELIVERY=previous;}
});
