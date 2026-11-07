const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

function createCustomerEmailDefaults(db, now = () => new Date()) {
  return async ({ companyId, customerId }) => {
    const company = db.collection("companies").doc(companyId);
    const customerRef = company.collection("customers").doc(customerId);
    const preferences = company.collection("settings").doc("emailConfiguration").collection("customerConfiguration");
    const preferenceRef = preferences.doc(customerId);

    return db.runTransaction(async transaction => {
      // Read both document formats so delayed/retried events never overwrite a saved choice.
      const [customer, canonical, legacy] = await Promise.all([
        transaction.get(customerRef),
        transaction.get(preferenceRef),
        transaction.get(preferences.where("customerId", "==", customerId).limit(1)),
      ]);
      if (!customer.exists || canonical.exists || !legacy.empty) return { created: false };

      const record = customer.data() || {};
      const timestamp = now();
      transaction.set(preferenceRef, {
        id: customerId,
        customerId,
        email: String(record.email || record.billingEmail || record.mainContact?.email || "").trim(),
        emailIsOn: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return { created: true };
    });
  };
}

exports.createCustomerEmailDefaults = createCustomerEmailDefaults;
exports.initializeCustomerEmailConfiguration = onDocumentCreated({
  document: "companies/{companyId}/customers/{customerId}",
  retry: true,
}, event => createCustomerEmailDefaults(
  admin.firestore(), () => admin.firestore.FieldValue.serverTimestamp()
)(event.params));
