const crypto = require("crypto");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const APP_ERRORS_COLLECTION = "appErrors";
const APP_ERROR_SEVERITIES = ["info", "warning", "error", "critical"];

function truncateString(value, maxLength = 1000) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function hashString(value, length = 32) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, length);
}

function summarizeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || "",
    code: error?.code || "",
    details: error?.details || "",
  };
}

function safeSerializeForAdminError(value, maxLength = 10000) {
  try {
    return truncateString(JSON.stringify(value || {}, (_key, nestedValue) => {
      if (nestedValue instanceof Date) return nestedValue.toISOString();
      if (typeof nestedValue?.toDate === "function") return nestedValue.toDate().toISOString();
      if (nestedValue instanceof Error) return summarizeError(nestedValue);
      if (typeof nestedValue === "function") return `[Function ${nestedValue.name || "anonymous"}]`;
      return nestedValue;
    }, 2), maxLength);
  } catch (error) {
    return truncateString(String(value || ""), maxLength);
  }
}

async function reportCloudFunctionError(error, context = {}) {
  try {
    const db = getFirestore();
    const normalizedError = summarizeError(error);
    const functionName = context.functionName || "cloudFunction";
    const eventName = context.eventName || "cloud-function-error";
    const companyId = context.companyId || "";
    const companyName = context.companyName || "";
    const recurringServiceStopId = context.recurringServiceStopId || "";
    const source = context.source || "cloud-function";
    const severity = APP_ERROR_SEVERITIES.includes(context.severity)
      ? context.severity
      : "error";
    const fingerprint = [
      functionName,
      eventName,
      companyId,
      recurringServiceStopId,
      normalizedError.code,
      normalizedError.message,
    ].join("|").toLowerCase();
    const errorRef = db
      .collection(APP_ERRORS_COLLECTION)
      .doc(`cf_${hashString(fingerprint, 40)}`);
    const existingSnap = await errorRef.get();
    const existingStatus = existingSnap.exists ? existingSnap.data()?.status : "";
    const basePayload = {
      title: truncateString(context.title || `${functionName}: ${normalizedError.message}`, 220),
      description: truncateString(
        context.description || `A Cloud Function error was captured from ${functionName}.`,
        5000
      ),
      message: truncateString(normalizedError.message, 5000),
      where: truncateString(`${functionName}.${eventName}`, 500),
      severity,
      source,
      userId: truncateString(context.userId || "", 320),
      userEmail: truncateString(context.userEmail || "", 320),
      accountType: truncateString(context.accountType || "system", 320),
      companyId: truncateString(companyId, 320),
      companyName: truncateString(companyName, 320),
      location: truncateString(`cloud-functions://${functionName}/${eventName}`, 1000),
      pathname: "/admin/errors",
      data: safeSerializeForAdminError({
        ...context,
        errorCode: normalizedError.code,
        recurringServiceStopId,
      }),
      stack: truncateString(normalizedError.stack, 15000),
      fingerprint: truncateString(fingerprint, 500),
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    };

    if (existingSnap.exists) {
      await errorRef.set({
        ...basePayload,
        status: existingStatus === "Ignored" ? "Ignored" : "New",
        occurrenceCount: FieldValue.increment(1),
      }, { merge: true });
      return;
    }

    await errorRef.set({
      ...basePayload,
      status: "New",
      occurrenceCount: 1,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (loggingError) {
    console.error("Unable to report Cloud Function error to appErrors", loggingError);
  }
}

module.exports = {
  reportCloudFunctionError,
  summarizeError,
};
