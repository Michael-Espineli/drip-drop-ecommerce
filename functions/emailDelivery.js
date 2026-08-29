const admin = require("firebase-admin");

const REAL_EMAILS_FEATURE_FLAG_ID = "feature_flag_012";
const EMAIL_TEST_RECIPIENT = process.env.SEND_GRID_TEST_RECIPIENT || "mespineli@dripdrop-poolapp.com";

const isFeatureFlagEnabled = async (flagId) => {
  const flagDoc = await admin.firestore().collection("featureFlags").doc(flagId).get();

  if (!flagDoc.exists) return false;

  return flagDoc.data()?.enabled === true;
};

const resolveEmailDeliveryRecipient = async (intendedTo) => {
  const realEmailsEnabled = await isFeatureFlagEnabled(REAL_EMAILS_FEATURE_FLAG_ID);
  const normalizedIntendedTo = String(intendedTo || "").trim();

  return {
    realEmailsEnabled,
    intendedTo: normalizedIntendedTo,
    actualTo: realEmailsEnabled && normalizedIntendedTo ? normalizedIntendedTo : EMAIL_TEST_RECIPIENT,
    testMode: !realEmailsEnabled || !normalizedIntendedTo,
    realEmailsFeatureFlagId: REAL_EMAILS_FEATURE_FLAG_ID,
  };
};

const addDeliveryModeTemplateData = (templateData, emailDelivery) => ({
  ...templateData,
  deliveryMode: emailDelivery.testMode ? "test" : "real",
  intendedCustomerEmail: emailDelivery.intendedTo,
  actualRecipientEmail: emailDelivery.actualTo,
});

module.exports = {
  REAL_EMAILS_FEATURE_FLAG_ID,
  EMAIL_TEST_RECIPIENT,
  isFeatureFlagEnabled,
  resolveEmailDeliveryRecipient,
  addDeliveryModeTemplateData,
};
