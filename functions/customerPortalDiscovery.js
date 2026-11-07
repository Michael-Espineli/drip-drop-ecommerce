const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { customerPortalEmail } = require('./customerAccountInvites');

const syncCustomerPortalEmail = async snapshot => {
  if (!snapshot?.exists) return;
  const customer = snapshot.data() || {};
  const email = customerPortalEmail(customer);
  if (customer.portalEmailNormalized === email) return;
  await snapshot.ref.set({ portalEmailNormalized: email }, { merge: true });
};

exports.syncCustomerPortalEmail = syncCustomerPortalEmail;
exports.indexCustomerPortalEmail = onDocumentWritten('companies/{companyId}/customers/{customerId}', event => (
  syncCustomerPortalEmail(event.data?.after)
));
