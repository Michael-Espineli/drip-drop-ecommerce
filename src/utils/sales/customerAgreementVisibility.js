// Drafts and records without a published status stay private to the company.
export const CUSTOMER_VISIBLE_AGREEMENT_STATUSES = Object.freeze([
  'sent', 'revised', 'accepted', 'superseded', 'canceled', 'rejected', 'expired',
]);

export const isCustomerVisibleAgreement = (agreement = {}) => (
  CUSTOMER_VISIBLE_AGREEMENT_STATUSES.includes(String(agreement.status || '').trim().toLowerCase())
);
