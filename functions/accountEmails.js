const crypto = require("node:crypto");
const { onCall } = require("firebase-functions/v2/https");
const { HttpsError } = require("./appErrors");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const {
  resolveEmailDeliveryRecipient,
  resolveCompanyEmailDeliveryRecipient,
} = require("./emailDelivery");

const COMPANY_ACCOUNT_TYPES = new Set(["company", "seller", "technician", "tech", "employee", "contractor", "admin"]);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const accepted = () => ({ accepted: true });

function createAccountEmailSender({
  db, accountAuth, sendMail,
  resolveCustomerDelivery = resolveEmailDeliveryRecipient,
  resolveCompanyDelivery = resolveCompanyEmailDeliveryRecipient,
  now = () => Date.now(),
  baseUrl = "https://dripdrop-poolapp.com",
  fromEmail = "info@dripdrop-poolapp.com",
}) {
  const origin = new URL(baseUrl).origin;

  async function reserveSend(kind, email, ip) {
    const timestamp = now();
    const emailRef = db.collection("accountEmailRateLimits").doc(hash(`${kind}:email:${email.toLowerCase()}`));
    const ipRef = ip ? db.collection("accountEmailRateLimits").doc(hash(`ip:${ip}`)) : null;
    await db.runTransaction(async transaction => {
      const [emailSnapshot, ipSnapshot] = await Promise.all([
        transaction.get(emailRef), ipRef ? transaction.get(ipRef) : null,
      ]);
      const previousEmail = emailSnapshot.data() || {};
      const previousIp = ipSnapshot?.data() || {};
      const sameWindow = Number.isFinite(previousIp.windowStartedAt) && timestamp - previousIp.windowStartedAt < 60 * 60 * 1000;
      if ((Number.isFinite(previousEmail.lastRequestedAt) && timestamp - previousEmail.lastRequestedAt < 60000)
        || (sameWindow && previousIp.count >= 30)) {
        throw new HttpsError("resource-exhausted", "Please wait before requesting another account email.");
      }
      const expiresAt = new Date(timestamp + 24 * 60 * 60 * 1000);
      transaction.set(emailRef, { lastRequestedAt: timestamp, expiresAt });
      if (ipRef) transaction.set(ipRef, {
        windowStartedAt: sameWindow ? previousIp.windowStartedAt : timestamp,
        count: sameWindow ? previousIp.count + 1 : 1,
        expiresAt,
      });
    });
  }

  return async request => {
    const kind = request.data?.kind;
    if (!["passwordReset", "verifyEmail"].includes(kind)) {
      throw new HttpsError("invalid-argument", "Choose a supported account email.");
    }
    if (kind === "verifyEmail" && !request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to verify your email.");
    }
    let user;
    let email;
    if (kind === "passwordReset") {
      email = String(request.data?.email || "").trim();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpsError("invalid-argument", "Enter a valid email address.");
      }
      await reserveSend(kind, email, request.rawRequest?.ip);
      try {
        user = await accountAuth.getUserByEmail(email);
      } catch (error) {
        if (error.code === "auth/user-not-found") return accepted();
        throw error;
      }
    } else {
      user = await accountAuth.getUser(request.auth.uid);
      email = user.email;
      if (!email || user.disabled) throw new HttpsError("failed-precondition", "This account cannot receive verification email.");
      if (user.emailVerified) return accepted();
      await reserveSend(kind, email, request.rawRequest?.ip);
    }
    if (user.disabled || !user.email) return accepted();
    email = user.email;
    const profile = await db.collection("users").doc(user.uid).get();
    const companyFacing = COMPANY_ACCOUNT_TYPES.has(String(profile.data()?.accountType || "").trim().toLowerCase());
    const delivery = await (companyFacing ? resolveCompanyDelivery(email) : resolveCustomerDelivery(email));
    let continuePath = companyFacing ? "/signIn" : "/client/verify-email";
    if (kind === "verifyEmail" && !companyFacing) {
      const requestedPath = String(request.data?.continuePath || "");
      // A relative, client-only path cannot replace the trusted origin or create an open redirect.
      if (/^\/client\/[a-zA-Z0-9/_?=&%.-]*$/.test(requestedPath) && !/[\\\r\n]/.test(requestedPath)) continuePath = requestedPath;
    }
    const settings = { url: new URL(continuePath, origin).href, handleCodeInApp: false };
    const actionUrl = kind === "passwordReset"
      ? await accountAuth.generatePasswordResetLink(email, settings)
      : await accountAuth.generateEmailVerificationLink(email, settings);
    const action = kind === "passwordReset" ? "Reset your password" : "Verify your email";
    const testNotice = delivery.testMode ? `TEST MODE: intended recipient ${delivery.intendedTo}.\n\n` : "";
    await sendMail({
      to: delivery.actualTo,
      from: fromEmail,
      subject: `Drip Drop: ${action.toLowerCase()}`,
      text: `${testNotice}${action}\n\n${actionUrl}\n\nIf you did not request this email, you can ignore it.`,
      html: `${testNotice ? `<p>${escapeHtml(testNotice)}</p>` : ""}<h1>${action}</h1><p><a href="${escapeHtml(actionUrl)}">${action}</a></p><p>If you did not request this email, you can ignore it.</p>`,
    });
    return accepted();
  };
}

exports.createAccountEmailSender = createAccountEmailSender;
exports.sendAccountEmail = onCall(async request => {
  if (!process.env.SEND_GRID_API_KEY?.startsWith("SG.")) {
    throw new HttpsError("failed-precondition", "Account email delivery is unavailable.");
  }
  sgMail.setApiKey(process.env.SEND_GRID_API_KEY);
  const sender = createAccountEmailSender({
    db: admin.firestore(), accountAuth: admin.auth(), sendMail: message => sgMail.send(message),
    baseUrl: process.env.APP_BASE_URL || (process.env.GCLOUD_PROJECT === "the-pool-app-dev" ? "https://the-pool-app-dev.web.app" : "https://dripdrop-poolapp.com"),
    fromEmail: process.env.SEND_GRID_FROM_EMAIL || "info@dripdrop-poolapp.com",
  });
  try {
    return await sender(request);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    // Provider errors can contain account action URLs; keep them out of logs and responses.
    console.error("Account email delivery failed", { code: error.code || "unknown" });
    throw new HttpsError("internal", "We could not send the account email. Please try again later.");
  }
});
