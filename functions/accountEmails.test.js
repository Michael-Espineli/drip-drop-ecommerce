const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");
const { createAccountEmailSender } = require("./accountEmails");

function fixture({ type = "Client", enabled = false, missingProfile = false, disabled = false, verified = false } = {}) {
  const db = new MemoryFirestore(missingProfile ? {} : { "users/recipient": { accountType: type } });
  const emails = [], links = [], lookups = [];
  const user = { uid: "recipient", email: "recipient@example.test", disabled, emailVerified: verified };
  let timestamp = 1000000;
  const accountAuth = {
    getUserByEmail: async email => { lookups.push(email); return user; },
    getUser: async uid => { lookups.push(uid); return user; },
    generatePasswordResetLink: async (email, settings) => { links.push({ email, settings }); return "https://auth.example.test/action?mode=resetPassword&oobCode=private"; },
    generateEmailVerificationLink: async (email, settings) => { links.push({ email, settings }); return "https://auth.example.test/action?mode=verifyEmail&oobCode=private"; },
  };
  const sender = createAccountEmailSender({
    db, accountAuth, now: () => timestamp,
    sendMail: async message => emails.push(message),
    resolveCustomerDelivery: async email => ({ intendedTo: email, actualTo: enabled ? email : "mespineli@dripdrop-poolapp.com", testMode: !enabled }),
  });
  return { db, emails, links, accountAuth, lookups, sender, advance: ms => { timestamp += ms; } };
}
const reset = (data = {}) => ({ data: { kind: "passwordReset", email: "recipient@example.test", ...data }, rawRequest: { ip: "192.0.2.1" } });
const verify = (data = {}) => ({ auth: { uid: "recipient" }, data: { kind: "verifyEmail", ...data }, rawRequest: { ip: "192.0.2.1" } });

test("client reset and verification go to the test inbox while links still target the intended account", async () => {
  for (const request of [reset(), verify()]) {
    const f = fixture();
    assert.deepEqual(await f.sender(request), { accepted: true });
    assert.equal(f.emails[0].to, "mespineli@dripdrop-poolapp.com");
    assert.equal(f.links[0].email, "recipient@example.test");
    assert.match(f.emails[0].text, /TEST MODE: intended recipient recipient@example.test/);
    const stored = JSON.stringify([...f.db.records]);
    assert.doesNotMatch(stored, /recipient@example|192\.0\.2|oobCode|private/);
  }
});
test("all company/staff account types stay live with the customer flag off", async () => {
  for (const type of ["Company", "Technician", "Admin", "Seller", "Tech", "Employee", "Contractor"]) {
    for (const request of [reset(), verify()]) {
      const f = fixture({ type });
      await f.sender(request);
      assert.equal(f.emails[0].to, "recipient@example.test", type);
      assert.doesNotMatch(f.emails[0].text, /TEST MODE/);
    }
  }
});
test("client emails become live only when the customer delivery resolver enables them", async () => {
  const f = fixture({ enabled: true });
  await f.sender(reset());
  assert.equal(f.emails[0].to, "recipient@example.test");
});
test("missing/unknown profiles stay gated and caller-supplied audience/recipient overrides are ignored", async () => {
  for (const options of [{ missingProfile: true }, { type: "Unknown" }]) {
    const f = fixture(options);
    await f.sender(reset({ audience: "company", actualTo: "outside@example.test", testMode: false }));
    assert.equal(f.emails[0].to, "mespineli@dripdrop-poolapp.com");
  }
});
test("verification requires authentication and uses the authenticated account rather than a supplied email/uid", async () => {
  const f = fixture();
  await assert.rejects(f.sender({ data: { kind: "verifyEmail" } }), { code: "unauthenticated" });
  await f.sender(verify({ uid: "someone-else", email: "someone-else@example.test" }));
  assert.deepEqual(f.lookups, ["recipient"]);
  assert.equal(f.links[0].email, "recipient@example.test");
});
test("unknown reset accounts return generic success without sending or exposing account existence", async () => {
  const f = fixture();
  f.accountAuth.getUserByEmail = async () => { throw Object.assign(new Error("not found"), { code: "auth/user-not-found" }); };
  assert.deepEqual(await f.sender(reset()), { accepted: true });
  assert.equal(f.emails.length, 0);
});
test("per-email throttling is atomic, case-insensitive, and releases after the cooldown", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.sender(reset()), f.sender(reset({ email: "RECIPIENT@example.test" }))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.emails.length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "resource-exhausted");
  f.advance(60000);
  await f.sender(reset());
  assert.equal(f.emails.length, 2);
});
test("IP throttling limits requests for different addresses", async () => {
  const f = fixture();
  f.accountAuth.getUserByEmail = async () => { throw Object.assign(new Error("not found"), { code: "auth/user-not-found" }); };
  for (let i = 0; i < 30; i++) await f.sender(reset({ email: `test${i}@example.test` }));
  await assert.rejects(f.sender(reset({ email: "last@example.test" })), { code: "resource-exhausted" });
  f.advance(60 * 60 * 1000);
  await f.sender(reset({ email: "last@example.test" }));
});
test("action links allow client return paths but never caller-controlled origins", async () => {
  for (const continuePath of ["https://evil.example.test", "//evil.example.test", "/\\evil.example.test", "/company/dashboard"]) {
    const f = fixture();
    await f.sender(verify({ continuePath }));
    assert.equal(f.links[0].settings.url, "https://dripdrop-poolapp.com/client/verify-email");
  }
  const f = fixture();
  await f.sender(verify({ continuePath: "/client/verify-email?redirect=%2Fclient%2Fdashboard" }));
  assert.equal(f.links[0].settings.url, "https://dripdrop-poolapp.com/client/verify-email?redirect=%2Fclient%2Fdashboard");
});
test("disabled and already verified accounts do not send verification or reset messages", async () => {
  const disabled = fixture({ disabled: true });
  await disabled.sender(reset());
  await assert.rejects(disabled.sender(verify()), { code: "failed-precondition" });
  assert.equal(disabled.emails.length, 0);
  const verified = fixture({ verified: true });
  assert.deepEqual(await verified.sender(verify()), { accepted: true });
  assert.equal(verified.emails.length, 0);
});
