import { sendPasswordResetEmail } from "firebase/auth";

export const PASSWORD_RESET_RECENTLY_SENT_CODE = "auth/password-reset-recently-sent";
export const DEFAULT_PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

const passwordResetRequestsByEmail = new Map();

export const getPasswordResetRecipientEmail = (...emails) => (
  emails.map((email) => String(email || "").trim()).find(Boolean) || ""
);

const getRequestKey = (email) => email.toLowerCase();

export const clearPasswordResetRequestCache = () => {
  passwordResetRequestsByEmail.clear();
};

export const sendAccountPasswordResetEmail = async (auth, email, options = {}) => {
  const recipientEmail = getPasswordResetRecipientEmail(email);

  if (!recipientEmail) {
    const error = new Error("Password reset requires an account email.");
    error.code = "auth/missing-email";
    throw error;
  }

  const cooldownMs = Number.isFinite(options.cooldownMs)
    ? options.cooldownMs
    : DEFAULT_PASSWORD_RESET_COOLDOWN_MS;
  const requestKey = getRequestKey(recipientEmail);
  const existingRequest = passwordResetRequestsByEmail.get(requestKey);
  const now = Date.now();

  if (existingRequest?.pending) {
    return existingRequest.promise;
  }

  if (
    cooldownMs > 0
    && existingRequest?.sentAt
    && now - existingRequest.sentAt < cooldownMs
  ) {
    const error = new Error("A password reset email was sent recently.");
    error.code = PASSWORD_RESET_RECENTLY_SENT_CODE;
    throw error;
  }

  // Password resets are Firebase Auth account emails, not app SendGrid emails.
  // They intentionally bypass feature_flag_012 ("Turn on real emails").
  const resetPromise = sendPasswordResetEmail(auth, recipientEmail)
    .then(() => {
      passwordResetRequestsByEmail.set(requestKey, {
        pending: false,
        sentAt: Date.now(),
      });
      return recipientEmail;
    })
    .catch((error) => {
      passwordResetRequestsByEmail.delete(requestKey);
      throw error;
    });

  passwordResetRequestsByEmail.set(requestKey, {
    pending: true,
    promise: resetPromise,
  });

  return resetPromise;
};
