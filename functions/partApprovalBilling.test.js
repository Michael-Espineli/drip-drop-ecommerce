const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { createPartApprovalBilling } = require('./partApprovalBilling');
const c = 'companies/company', a = 'customerPartApprovals/approval', s = `${c}/shoppingList/shopping`;
const at = new Date('2026-11-06T19:00:00Z');
function fixture(extra = {}) {
  const db = new MemoryFirestore({
    [c]: { ownerId: 'owner', name: 'Pool company' },
    [`${c}/customers/customer`]: { billingEmail: 'billing@example.test', customerUserId: 'homeowner' },
    [a]: { companyId: 'company', customerId: 'customer', customerName: 'Customer', approvalStatus: 'approved', status: 'approved', shoppingListItemId: 'shopping', itemName: 'Pump kit', quantity: '2', plannedUnitPriceCents: 5000, plannedTotalPriceCents: 10000, paymentPreference: 'payNow' },
    [s]: { customerId: 'customer', partApprovalRequestId: 'approval', status: 'Need to Purchase', quantity: '2', price: 10 }, ...extra,
  });
  const emails = [];
  const service = createPartApprovalBilling(db, { now: () => at, sendInvoice: async payload => {
    emails.push(payload); db.set(`salesInvoices/${payload.invoiceId}`, { status: 'open', sentAt: at }, { merge: true });
  } });
  return { db, service, emails, ensure: options => service.ensure({ companyId: 'company', approvalId: 'approval', ...options }), row: path => db.records.get(path), invoices: () => [...db.records].filter(([path]) => /^salesInvoices\/[^/]+$/.test(path)) };
}
test('immediate approval creates a real draft at approved price and preserves physical fulfillment', async () => {
  const f = fixture(), r = await f.ensure(), invoice = f.row(`salesInvoices/${r.invoiceId}`);
  assert.equal(r.status, 'created'); assert.equal(invoice.status, 'draft'); assert.equal(invoice.totalAmountCents, 10000); assert.equal(invoice.lineItems[0].quantity, 2);
  assert.equal(invoice.email, 'billing@example.test'); assert.equal(invoice.customerUserId, 'homeowner');
  assert.equal(f.row(s).status, 'Need to Purchase'); assert.equal(f.row(s).invoiced, false); assert.equal(f.row(a).invoiceStatus, 'draft'); assert.equal(f.emails.length, 0);
});
test('request-invoice approval waits for delivery, per the customer workflow', async () => {
  const f = fixture(); f.db.set(a, { paymentPreference: 'sendInvoice' }, { merge: true }); assert.equal((await f.ensure()).status, 'waiting');
  f.db.set(s, { status: 'Delivered' }, { merge: true }); assert.equal((await f.ensure()).status, 'created');
});
test('delivery preference waits through purchase, then creates once at Delivered or Installed', async () => {
  for (const status of ['Delivered', 'Installed']) {
    const f = fixture(); f.db.set(a, { paymentPreference: 'payOnceDelivered' }, { merge: true }); assert.equal((await f.ensure()).status, 'waiting');
    f.db.set(s, { status: 'Purchased' }, { merge: true }); assert.equal((await f.ensure()).status, 'waiting');
    f.db.set(s, { status }, { merge: true }); const first = await f.ensure(); assert.equal(first.status, 'created'); assert.equal((await f.ensure()).invoiceId, first.invoiceId); assert.equal(f.invoices().length, 1);
  }
});
test('concurrent approval/shopping retries create one invoice and dispatch one automatic email', async () => {
  const f = fixture({ [`${c}/settings/companyWide`]: { partApprovalAutoSendInvoices: true } });
  const [one, two] = await Promise.all([f.ensure(), f.service.ensure({ companyId: 'company', shoppingItemId: 'shopping' })]);
  assert.equal(one.invoiceId, two.invoiceId); assert.equal(f.invoices().length, 1); assert.equal(one.queueId, two.queueId);
  await Promise.all([f.service.processEmail(one.queueId), f.service.processEmail(two.queueId)]);
  assert.equal(f.emails.length, 1); assert.equal(f.row(a).invoiced, true); assert.equal(f.row(s).invoiceStatus, 'open'); assert.equal(f.row(s).status, 'Need to Purchase');
  await f.ensure(); await f.service.processEmail(one.queueId); assert.equal(f.emails.length, 1);
});
test('automatic sending off after enqueue cancels pending email and preserves the draft', async () => {
  const f = fixture({ [`${c}/settings/companyWide`]: { partApprovalAutoSendInvoices: true } }), r = await f.ensure();
  f.db.set(`${c}/settings/companyWide`, { partApprovalAutoSendInvoices: false }); await f.service.processEmail(r.queueId);
  assert.equal(f.emails.length, 0); assert.equal(f.row(`salesInvoices/${r.invoiceId}`).status, 'draft');
});
test('missing email still creates a draft; failure is visible and never blindly resent', async () => {
  const f = fixture({ [`${c}/settings/companyWide`]: { partApprovalAutoSendInvoices: true }, [`${c}/customers/customer`]: {} }); let attempts = 0;
  const service = createPartApprovalBilling(f.db, { now: () => at, sendInvoice: async () => { attempts++; throw new Error('Missing email'); } });
  const r = await service.ensure({ companyId: 'company', approvalId: 'approval' }); await service.processEmail(r.queueId);
  assert.equal(f.invoices().length, 1); assert.equal(f.row(a).billingAutomationStatus, 'emailNeedsReview'); assert.equal(f.row(a).invoiced, false);
  await service.ensure({ companyId: 'company', approvalId: 'approval' }); await service.processEmail(r.queueId); assert.equal(attempts, 1);
});
test('provider success followed by bookkeeping failure cannot send a second email', async () => {
  const f = fixture({ [`${c}/settings/companyWide`]: { partApprovalAutoSendInvoices: true } }); let sends = 0;
  const service = createPartApprovalBilling(f.db, { now: () => at, sendInvoice: async payload => { sends++; f.db.set(`salesInvoices/${payload.invoiceId}`, { sentAt: at, status: 'open' }, { merge: true }); throw new Error('post-send failure'); } });
  const r = await service.ensure({ companyId: 'company', approvalId: 'approval' }); await service.processEmail(r.queueId); await service.processEmail(r.queueId);
  assert.equal(sends, 1); assert.equal(f.row(a).invoiced, true);
});
test('late purchase reconciliation inherits the invoice instead of creating another bill', async () => {
  const f = fixture(), r = await f.ensure(); f.db.set(`${c}/purchasedItems/purchase`, { shoppingListItemId: 'shopping', customerId: 'customer' }); f.db.set(s, { purchasedItem: 'purchase' }, { merge: true });
  await f.service.ensure({ companyId: 'company', shoppingItemId: 'shopping' }); assert.equal(f.row(`${c}/purchasedItems/purchase`).salesInvoiceId, r.invoiceId); assert.equal(f.invoices().length, 1);
});
test('foreign approval and mismatched links cannot write invoices', async () => {
  for (const change of [{ companyId: 'foreign' }, { shoppingListItemId: 'other' }]) {
    const f = fixture(); f.db.set(a, change, { merge: true }); await assert.rejects(f.service.ensure({ companyId: 'company', shoppingItemId: 'shopping' })); assert.equal(f.invoices().length, 0);
  }
});
test('rejected, returned, personal and invalid-price records cannot create invoices', async () => {
  for (const [path, data] of [[a, { approvalStatus: 'rejected' }], [s, { personalPurchase: true }], [s, { returned: true }], [a, { plannedTotalPriceCents: 0 }], [a, { quantity: '-1' }]]) {
    const f = fixture(); f.db.set(path, data, { merge: true }); await f.ensure(); assert.equal(f.invoices().length, 0);
  }
});
test('failed creation commits no invoice or source link and retries safely', async () => {
  const f = fixture(); f.db.commitError = new Error('offline'); await assert.rejects(f.ensure(), /offline/); assert.equal(f.invoices().length, 0); assert.equal(f.row(a).salesInvoiceId, undefined);
  delete f.db.commitError; assert.equal((await f.ensure()).status, 'created');
});
test('manual-invoiced history and closed invoices require review instead of duplicate collection', async () => {
  const f = fixture(); f.db.set(a, { invoiced: true, manuallyInvoiced: true }, { merge: true }); assert.equal((await f.ensure()).status, 'needsReview'); assert.equal(f.invoices().length, 0);
  const g = fixture(), r = await g.ensure(); g.db.set(`salesInvoices/${r.invoiceId}`, { status: 'void' }, { merge: true }); assert.equal((await g.ensure()).status, 'needsReview'); assert.equal(g.invoices().length, 1);
});
test('existing job invoice blocks a second automatic part invoice', async () => {
  const f = fixture({ 'salesInvoices/job-invoice': { companyId: 'company', jobId: 'job', status: 'open' } }); f.db.set(a, { jobId: 'job' }, { merge: true }); assert.equal((await f.ensure()).status, 'needsReview'); assert.equal(f.invoices().length, 1);
});
test('manual draft override requires billing authority and does not queue email', async () => {
  const f = fixture({ [`${c}/settings/companyWide`]: { partApprovalAutoSendInvoices: true } }); await assert.rejects(f.ensure({ manualDraft: true, auth: { uid: 'technician' } }), /billing access/);
  const r = await f.ensure({ manualDraft: true, auth: { uid: 'owner' } }); assert.equal(r.status, 'created'); assert.equal(r.autoSend, false);
});
test('opt-in standalone installed shopping uses the same deterministic server pipeline', async () => {
  const f = fixture(); f.db.set(s, { name: 'PVC', customerId: 'customer', quantity: '2', price: 500, autoInvoiceOnInstall: true, status: 'Installed' });
  const r = await f.service.ensure({ companyId: 'company', shoppingItemId: 'shopping' }); assert.equal(r.status, 'created'); assert.equal(f.row(`salesInvoices/${r.invoiceId}`).totalAmountCents, 1000);
});

test('a conflicting or returned reconciled purchase cannot acquire another bill', async () => {
 for(const purchase of [{customerId:'different'},{invoiceId:'other-invoice'},{invoiced:true},{returned:true}]) {
  const f=fixture();f.db.set(s,{purchasedItem:'purchase'},{merge:true});f.db.set(`${c}/purchasedItems/purchase`,{shoppingListItemId:'shopping',...purchase});
  assert.equal((await f.ensure()).status,'needsReview');assert.equal(f.invoices().length,0);
 }
});

test('the approved pricing snapshot wins over later shopping or approval price edits', async()=>{
 const f=fixture();f.db.set(a,{approvedPricingSnapshot:{quantity:'2',plannedUnitPriceCents:3000,plannedTotalPriceCents:6000},plannedTotalPriceCents:90000},{merge:true});
 const r=await f.ensure();assert.equal(f.row(`salesInvoices/${r.invoiceId}`).totalAmountCents,6000);
});
test('separate approved parts on the same job can each create their own invoice',async()=>{
 const f=fixture({'salesInvoices/other-part':{companyId:'company',customerId:'customer',jobId:'job',billingScope:'approvedPart',status:'open'}});
 f.db.set(a,{jobId:'job'},{merge:true});assert.equal((await f.ensure()).status,'created');assert.equal(f.invoices().length,2);
});
test('a returned item cancels queued automatic email before sending',async()=>{
 const f=fixture({[`${c}/settings/companyWide`]:{partApprovalAutoSendInvoices:true}}),r=await f.ensure();
 f.db.set(s,{returned:true},{merge:true});await f.service.processEmail(r.queueId);assert.equal(f.emails.length,0);assert.equal(f.row(`billingEmailQueue/${r.queueId}`).status,'cancelled');
});
