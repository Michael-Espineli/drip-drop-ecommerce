// Snapshot events handled by stripeWebHooks / stripeLifecycle. Keep setup,
// deployment checks, and endpoint configuration on this same explicit policy.
const billingEvents=Object.freeze([
 'setup_intent.succeeded','setup_intent.setup_failed','setup_intent.requires_action','setup_intent.canceled',
 'payment_intent.succeeded','payment_intent.processing','payment_intent.payment_failed','payment_intent.requires_action','payment_intent.canceled',
 'checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
 'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed',
 'invoice.created','invoice.updated','invoice.finalized','invoice.finalization_failed','invoice.paid','invoice.payment_succeeded','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.marked_uncollectible',
 'charge.refunded','charge.failed','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated',
 'refund.created','refund.updated','refund.failed','credit_note.created','credit_note.updated','credit_note.voided',
]);
const connectedEvents=Object.freeze([...billingEvents,'account.updated','account.external_account.updated','payout.created','payout.updated','payout.paid','payout.failed','payout.canceled','payout.reconciliation_completed']);
const platformEvents=billingEvents;
function missingEvents(actual,required){return actual.includes('*')?[]:required.filter(event=>!actual.includes(event));}
module.exports={connectedEvents,platformEvents,missingEvents,snapshotApiVersion:'2025-10-29.clover'};
