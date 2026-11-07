const admin = require('firebase-admin');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { hash, key, millis, id, invoiceSubscription } = require('./billingMath');
const { fail } = require('./companyActor');

const nextBill = row => ['nextbill', 'includeonnextbill'].includes(key(row.paymentPreference || row.paymentCollectionPreference));
const approved = row => ['approved', 'resolved'].includes(key(row.approvalStatus || row.status));
const delivered = row => ['delivered', 'installed'].includes(key(row.status || row.fulfillmentStatus));
const usable = row => !['canceled', 'cancelled', 'superseded', 'inactive', 'expired', 'paused'].includes(key(row.status)) &&
  (row.stripeSubscriptionId ? Boolean(row.stripeCustomerId && row.stripeConnectedAccountId) && ['active', 'trialing', 'pastdue', 'unpaid'].includes(key(row.stripeStatus || row.status)) : row.manualBillingEnabled === true && row.autopayEnabled !== true && row.billingCollectionMethod !== 'automaticStripe' && !row.checkoutHold);

async function billingOptions(reader, db, approval) {
  const rows = await reader.get(db.collection('salesBillingSubscriptions').where('companyId', '==', approval.companyId).where('customerId', '==', approval.customerId));
  return rows.docs.filter(snap => {
    const row = snap.data(), locations = row.serviceLocationIds || [];
    return usable(row) && (!approval.serviceLocationId || !locations.length || locations.includes(approval.serviceLocationId));
  });
}

async function selectSubscription(reader, db, approval, requestedId) {
  const options = await billingOptions(reader, db, approval);
  const chosen = requestedId ? options.find(row => row.id === requestedId) : options.length === 1 ? options[0] : null;
  if (!chosen) fail('failed-precondition', options.length ? 'Choose the recurring service bill for this part.' : 'No eligible recurring service bill is available. Choose another payment option or contact the company.');
  return chosen;
}

const sourceRefs = (db, row) => [
  db.collection('customerPartApprovals').doc(row.partApprovalRequestId),
  db.collection('companies').doc(row.companyId).collection('shoppingList').doc(row.shoppingListItemId),
];
async function readSources(tx, db, row) {
  const refs = sourceRefs(db, row), snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
  const approval = snapshots[0].data() || {}, item = snapshots[1].data() || {};
  if (item.purchasedItem) snapshots.push(await tx.get(db.collection('companies').doc(row.companyId).collection('purchasedItems').doc(item.purchasedItem)));
  const valid = snapshots[0].exists && snapshots[1].exists && approved(approval) && nextBill(approval) &&
    approval.companyId === row.companyId && approval.customerId === row.customerId && approval.shoppingListItemId === row.shoppingListItemId &&
    (item.partApprovalRequestId || item.approvalRequestId) === row.partApprovalRequestId && (!item.customerId || item.customerId === row.customerId) &&
    (delivered(item) || delivered({ status: approval.fulfillmentStatus })) &&
    snapshots.every(snap => !snap.exists || snap.data().returned !== true && snap.data().personalPurchase !== true && (!snap.data().customerId || snap.data().customerId === row.customerId) && (!snap.data().shoppingListItemId || snap.data().shoppingListItemId === row.shoppingListItemId) && !snap.data().manuallyInvoiced && (!(snap.data().salesInvoiceId || snap.data().invoiceId) || (snap.data().salesInvoiceId || snap.data().invoiceId) === row.invoiceId) && (!snap.data().invoiced || Boolean(row.invoiceId)));
  return { snapshots: snapshots.filter(snap => snap.exists), valid };
}

function createRecurringPartCharges(db, stripe, now = () => new Date()) {
  async function stage(tx, { companyId, approvalSnap, itemSnap }) {
    const approval = approvalSnap.data(), item = itemSnap?.data() || {};
    const review = message => {
      for (const snap of [approvalSnap, itemSnap].filter(snap => snap?.exists)) tx.set(snap.ref, { billingAutomationStatus: 'needsReview', billingAutomationError: message, updatedAt: now() }, { merge: true });
      return { status: 'needsReview', reason: message };
    };
    if (!itemSnap?.exists) return review('Connect the approved shopping item before adding it to a recurring bill.');
    const chargeId = `rpc_${hash(`${companyId}:${approvalSnap.id}`)}`, ref = db.collection('recurringPartCharges').doc(chargeId), saved = await tx.get(ref);
    let subscription;
    if (saved.data()?.invoiceId) {
      subscription = await tx.get(db.collection('salesBillingSubscriptions').doc(saved.data().billingSubscriptionId));
      if (!subscription.exists || subscription.data().companyId !== companyId || subscription.data().customerId !== approval.customerId) return review('The billed recurring plan needs ownership review.');
    }
    try { subscription = subscription || await selectSubscription(tx, db, { ...approval, companyId }, approval.nextBillSubscriptionId); }
    catch (error) { if (error.code === 'failed-precondition') return review(error.message); throw error; }
    const pricing = approval.approvedPricingSnapshot || approval, quantity = Number(pricing.quantity || 1);
    const unit = Number(pricing.plannedUnitPriceCents ?? pricing.unitPriceCents ?? pricing.price ?? 0);
    const total = Number(pricing.plannedTotalPriceCents ?? pricing.totalPriceCents ?? Math.round(quantity * unit));
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(unit) || unit < 0 || !Number.isSafeInteger(total) || total <= 0 || total > 999999999999 || (subscription.data().currency || 'usd') !== 'usd') return review('Review the approved price, quantity or billing currency before adding this part.');
    if (saved.exists && saved.data().billingSubscriptionId !== subscription.id) return review('This part is already assigned to another recurring bill. Review its existing billing first.');
    if (!saved.exists && [approval, item].some(row => row.invoiceId || row.salesInvoiceId || row.invoiced || row.manuallyInvoiced)) return review('This part already has billing. Review it before adding it to a recurring bill.');
    const candidate = saved.exists ? saved.data() : { id: chargeId, companyId, customerId: approval.customerId, customerUserId: approval.customerUserId || null,
      billingSubscriptionId: subscription.id, partApprovalRequestId: approvalSnap.id, shoppingListItemId: itemSnap.id,
      name: approval.itemName || approval.name || 'Approved part', quantity, unitAmountCents: unit, amountCents: total, currency: 'usd', readyAt: now(), createdAt: now(), status: 'pending' };
    const sources = await readSources(tx, db, candidate);
    if (!sources.valid) return review('The approved part or reconciled purchase changed. Review it before billing.');
    if (sources.snapshots.some(snap => (snap.data().salesInvoiceId || snap.data().invoiceId) && (snap.data().salesInvoiceId || snap.data().invoiceId) !== candidate.invoiceId)) return review('A source record already has another invoice. Review its billing first.');
    if (!saved.exists) tx.set(ref, candidate);
    else if (candidate.status === 'needsReview' && !candidate.invoiceId && !candidate.stripeInvoiceId) { tx.set(ref, { status: 'pending', error: '', updatedAt: now() }, { merge: true }); candidate.error = ''; candidate.status = 'pending'; }
    const fields = { recurringPartChargeId: chargeId, nextBillSubscriptionId: subscription.id,
      billingAutomationStatus: candidate.invoiceId ? 'nextBillAttached' : 'awaitingNextBill', billingAutomationError: candidate.error || '' };
    for (const snap of sources.snapshots) {
      const payload = { ...fields, ...(snap.ref.path === approvalSnap.ref.path && delivered(item) ? { fulfillmentStatus: key(item.status), shoppingListItemStatus: item.status } : {}) };
      if (!candidate.invoiceId && Object.entries(payload).some(([field, value]) => snap.data()[field] !== value)) tx.set(snap.ref, { ...payload, updatedAt: now() }, { merge: true });
    }
    return { status: candidate.invoiceId ? 'existing' : 'queued', reason: 'awaiting_next_bill', invoiceId: candidate.invoiceId || '', recurringPartChargeId: chargeId, shoppingPayload: fields };
  }

  // All reads occur before the parent invoice transaction writes anything.
  async function readManual(tx, subscription) {
    const rows = await tx.get(db.collection('recurringPartCharges').where('billingSubscriptionId', '==', subscription.id).where('status', '==', 'pending').limit(101));
    if (rows.size > 100) fail('failed-precondition', 'Review the unusually large number of pending parts before billing.');
    const eligible = [], invalid = [];
    for (const snap of rows.docs) {
      const row = snap.data();
      if (row.companyId !== subscription.companyId || row.customerId !== subscription.customerId || row.currency !== (subscription.currency || 'usd')) fail('failed-precondition', 'Pending part ownership or currency does not match the recurring bill.');
      const source = await readSources(tx, db, row);
      if (source.valid) eligible.push(snap); else invalid.push({ snap, source });
    }
    return { eligible, invalid };
  }
  function claimManual(tx, parts, invoiceId) {
    for (const snap of parts.eligible) tx.set(snap.ref, { status: 'invoiced', invoiceId, collectionMethod: 'manual', updatedAt: now() }, { merge: true });
    for (const { snap, source } of parts.invalid) {
      tx.set(snap.ref, { status: 'needsReview', error: 'Fulfillment changed before recurring billing.', updatedAt: now() }, { merge: true });
      for (const target of source.snapshots) tx.set(target.ref, { billingAutomationStatus: 'needsReview', billingAutomationError: 'Fulfillment changed before recurring billing.', updatedAt: now() }, { merge: true });
    }
  }
  const lineFor = snap => { const row = snap.data(); return { id: snap.id, name: row.name, quantity: 1, unitAmountCents: row.amountCents, totalAmountCents: row.amountCents, type: 'material', taxable: false,
    description: `Approved quantity: ${row.quantity}`, metadata: { recurringPartChargeId: snap.id, partApprovalRequestId: row.partApprovalRequestId, shoppingListItemId: row.shoppingListItemId } }; };

  async function applyStripeInvoice(event) {
    if (!event.account) return false;
    let invoice = await stripe.invoices.retrieve(event.data.object.id, {}, { stripeAccount: event.account });
    const subId = invoiceSubscription(invoice);
    if (!subId || !['subscription_cycle', 'subscription_create'].includes(invoice.billing_reason)) return false;
    const rows = await db.collection('salesBillingSubscriptions').where('stripeSubscriptionId', '==', subId).get();
    if (!rows.size) return false;
    if (rows.size !== 1) fail('failed-precondition', 'Multiple billing plans identify this Stripe subscription.');
    const planSnap = rows.docs[0], plan = planSnap.data();
    const company = (await db.collection('companies').doc(plan.companyId).get()).data() || {};
    const sub = await stripe.subscriptions.retrieve(subId, {}, { stripeAccount: event.account });
    if (![company.stripeConnectedAccountId, company.stripeConnectAccountId].includes(event.account) || plan.stripeConnectedAccountId !== event.account || id(invoice.customer) !== plan.stripeCustomerId || id(sub.customer) !== plan.stripeCustomerId) fail('permission-denied', 'Recurring invoice customer or connected account does not match.');
    const charges = await db.collection('recurringPartCharges').where('billingSubscriptionId', '==', planSnap.id).where('status', 'in', ['pending', 'attaching', 'attached']).limit(101).get();
    if (charges.size > 100) fail('failed-precondition', 'Too many pending parts need billing review.');
    const listItems = async () => {
      const result = []; let cursor;
      do {
        const page = await stripe.invoiceItems.list({ invoice: invoice.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, { stripeAccount: event.account });
        result.push(...page.data); cursor = page.has_more ? page.data.at(-1)?.id : null;
      } while (cursor);
      return result;
    };
    let items = await listItems();
    for (const snap of charges.docs) {
      if (snap.data().stripeInvoiceId && snap.data().stripeInvoiceId !== invoice.id || !snap.data().stripeInvoiceId && Math.floor(millis(snap.data().readyAt) / 1000) > Number(invoice.created)) continue;
      const reserved = await db.runTransaction(async tx => {
        const current = await tx.get(snap.ref), row = current.data();
        const latestPlan = (await tx.get(planSnap.ref)).data();
        if (!current.exists || !['pending', 'attaching', 'attached'].includes(row.status) || row.stripeInvoiceId && row.stripeInvoiceId !== invoice.id) return null;
        if (row.companyId !== plan.companyId || row.customerId !== plan.customerId || row.currency !== invoice.currency || !latestPlan || latestPlan.stripeSubscriptionId !== subId || !usable(latestPlan) || !['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) fail('failed-precondition', 'Recurring collection changed before adding this part.');
        const sources = await readSources(tx, db, row);
        if (!sources.valid) {
          tx.set(snap.ref, { status: 'needsReview', error: 'Fulfillment changed before recurring billing.' }, { merge: true });
          for (const target of sources.snapshots) tx.set(target.ref, { billingAutomationStatus: 'needsReview', billingAutomationError: 'Fulfillment changed; review any reserved recurring invoice before billing.' }, { merge: true });
          return null;
        }
        const params = row.stripeParams || { invoice: invoice.id, customer: plan.stripeCustomerId, currency: row.currency, amount: row.amountCents,
          description: `${row.name} (approved quantity ${row.quantity})`, discountable: false, tax_behavior: 'inclusive',
          metadata: { recurringPartChargeId: snap.id, partApprovalRequestId: row.partApprovalRequestId, shoppingListItemId: row.shoppingListItemId } };
        tx.set(snap.ref, { status: row.status === 'attached' ? 'attached' : 'attaching', stripeInvoiceId: invoice.id, invoiceId: `sinv_${invoice.id}`, stripeParams: params, stripeConnectedAccountId: event.account, updatedAt: now() }, { merge: true });
        return { ...row, stripeParams: params };
      });
      if (!reserved) continue;
      let item = items.find(row => row.metadata?.recurringPartChargeId === snap.id);
      if (!item) {
        invoice = await stripe.invoices.retrieve(invoice.id, {}, { stripeAccount: event.account });
        if (invoice.status !== 'draft') {
          // Another delivery may have attached the item after our initial list.
          items = await listItems();
          item = items.find(row => row.metadata?.recurringPartChargeId === snap.id);
          if (!item) {
            await db.runTransaction(async tx => {
              const current = (await tx.get(snap.ref)).data();
              if (!current || current.stripeInvoiceId !== invoice.id || !['attaching', 'attached'].includes(current.status)) return;
              if (current.stripeInvoiceItemId || current.status === 'attached') {
                tx.set(snap.ref, { status: 'needsReview', error: 'The previously attached part is missing from the finalized recurring invoice. Review its billing before retrying.', updatedAt: now() }, { merge: true });
              } else {
                tx.set(snap.ref, { status: 'pending', stripeInvoiceId: '', invoiceId: '', stripeParams: null, error: 'The previous invoice was already finalized; this part remains queued for the next recurring bill.', updatedAt: now() }, { merge: true });
              }
            });
            continue;
          }
        }
        if (!item) {
          item = await stripe.invoiceItems.create(reserved.stripeParams, { stripeAccount: event.account, idempotencyKey: `part_${snap.id}_${invoice.id}` });
          items.push(item);
        }
      }
      if (id(item.invoice) !== invoice.id || item.amount !== reserved.amountCents || item.currency !== reserved.currency) fail('failed-precondition', 'The Stripe part item needs billing review.');
      await db.runTransaction(async tx => {
        const current = (await tx.get(snap.ref)).data();
        if (!current || current.stripeInvoiceId !== invoice.id || !['attaching', 'attached'].includes(current.status)) return;
        tx.set(snap.ref, { status: 'attached', stripeInvoiceItemId: item.id, invoiceId: `sinv_${invoice.id}`, error: '', updatedAt: now() }, { merge: true });
      });
    }
    return true;
  }

  async function syncInvoice(invoiceId) {
    return db.runTransaction(async tx => {
      const invoice = (await tx.get(db.collection('salesInvoices').doc(invoiceId))).data();
      const charges = await tx.get(db.collection('recurringPartCharges').where('invoiceId', '==', invoiceId).limit(101));
      if (charges.size > 100) fail('failed-precondition', 'Recurring part linkage requires review.');
      if (!invoice) {
        const sources = [];
        for (const charge of charges.docs) sources.push({ charge, source: await readSources(tx, db, charge.data()) });
        const error = 'The recurring invoice was removed. Review this part before billing it again.';
        for (const { charge, source } of sources) {
          tx.set(charge.ref, { status: 'needsReview', error, updatedAt: now() }, { merge: true });
          for (const snap of source.snapshots) tx.set(snap.ref, { billingAutomationStatus: 'needsReview', billingAutomationError: error, updatedAt: now() }, { merge: true });
        }
        return;
      }
      const all = [];
      for (const charge of charges.docs) {
        if (charge.data().companyId !== invoice.companyId || charge.data().customerId !== invoice.customerId || charge.data().billingSubscriptionId !== invoice.billingSubscriptionId) fail('permission-denied', 'Recurring part invoice ownership changed.');
        all.push({ charge, sources: await readSources(tx, db, charge.data()) });
      }
      const issued = invoice.status !== 'draft', review = ['void', 'voided', 'uncollectible', 'refunded', 'partiallyRefunded', 'paymentReview'].includes(invoice.status);
      for (const { charge, sources } of all) {
        const line = (invoice.lineItems || []).find(line => line.metadata?.recurringPartChargeId === charge.id || line.id === charge.id);
        if (!line && charge.data().status === 'attaching' && !issued) continue;
        const matchesPrice = line && Number(line.totalAmountCents) === charge.data().amountCents && invoice.currency === charge.data().currency;
        const needsReview = review || !sources.valid || !matchesPrice;
        tx.set(charge.ref, { status: needsReview ? 'needsReview' : issued ? 'invoiced' : 'attached', updatedAt: now() }, { merge: true });
        const fields = { ...(matchesPrice ? { invoiceId, salesInvoiceId: invoiceId, invoiceRef: invoiceId, invoiceType: 'recurringServiceInvoice', invoiceStatus: invoice.status, invoiced: issued } : {}),
          billingAutomationStatus: needsReview ? 'needsReview' : issued ? 'invoiced' : 'nextBillAttached', billingAutomationError: needsReview ? 'The recurring invoice needs billing review. This part will not be added to another bill automatically.' : '' };
        for (const snap of sources.snapshots) {
          if (snap.data().companyId && snap.data().companyId !== invoice.companyId || snap.data().customerId && snap.data().customerId !== invoice.customerId) continue;
          if ((snap.data().salesInvoiceId || snap.data().invoiceId) && (snap.data().salesInvoiceId || snap.data().invoiceId) !== invoiceId) continue;
          if (Object.entries(fields).some(([field, value]) => snap.data()[field] !== value)) tx.set(snap.ref, { ...fields, updatedAt: now() }, { merge: true });
        }
      }
    });
  }
  async function reviewStoppedPlan(subscriptionId) {
    const plan = await db.collection('salesBillingSubscriptions').doc(subscriptionId).get();
    if (plan.exists && !['canceled', 'cancelled', 'superseded', 'inactive', 'expired'].includes(key(plan.data().status))) return;
    const charges = await db.collection('recurringPartCharges').where('billingSubscriptionId', '==', subscriptionId).where('status', '==', 'pending').get();
    for (const charge of charges.docs) await db.runTransaction(async tx => {
      const current = await tx.get(charge.ref);
      const latestPlan = await tx.get(db.collection('salesBillingSubscriptions').doc(subscriptionId));
      if (latestPlan.exists && !['canceled', 'cancelled', 'superseded', 'inactive', 'expired'].includes(key(latestPlan.data().status))) return;
      if (current.data()?.status !== 'pending') return;
      const sources = await readSources(tx, db, current.data());
      const error = 'The selected recurring service bill is no longer active. Review this part before choosing another billing method.';
      tx.set(charge.ref, { status: 'needsReview', error, updatedAt: now() }, { merge: true });
      for (const snap of sources.snapshots) tx.set(snap.ref, { billingAutomationStatus: 'needsReview', billingAutomationError: error, updatedAt: now() }, { merge: true });
    });
  }
  return { stage, readManual, claimManual, lineFor, applyStripeInvoice, syncInvoice, reviewStoppedPlan };
}

exports.nextBill = nextBill;
exports.billingOptions = billingOptions;
exports.selectSubscription = selectSubscription;
exports.createRecurringPartCharges = createRecurringPartCharges;
exports.syncRecurringPartInvoice = onDocumentWritten({ document: 'salesInvoices/{invoiceId}', retry: true }, event => createRecurringPartCharges(admin.firestore()).syncInvoice(event.params.invoiceId));

exports.reviewStoppedPartBillingPlan = onDocumentWritten({ document: 'salesBillingSubscriptions/{subscriptionId}', retry: true }, event => createRecurringPartCharges(admin.firestore()).reviewStoppedPlan(event.params.subscriptionId));
