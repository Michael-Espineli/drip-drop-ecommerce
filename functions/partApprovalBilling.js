const admin = require('firebase-admin');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { companyActor, documentId, fail } = require('./companyActor');
const { billingActor } = require('./billingAccess');
const { hash, key, money } = require('./billingMath');

const AUTO_SEND_FIELD = 'partApprovalAutoSendInvoices';
const text = value => String(value ?? '').trim();
const approvalIdFor = item => text(item.partApprovalRequestId || item.approvalRequestId || item.customerApprovalRequestId);
const invoiceIdFor = row => text(row.salesInvoiceId || row.invoiceId);
const approved = row => ['approved', 'resolved'].includes(key(row.approvalStatus || row.status));
const delivered = row => ['delivered', 'installed', 'invoiced'].includes(key(row.status || row.fulfillmentStatus));
const preference = row => ['paynow', 'invoiceimmediately'].includes(key(row.paymentPreference || row.paymentCollectionPreference)) ? 'immediate' : 'delivery';
const issued = invoice => Boolean(invoice.sentAt) || ['open', 'partiallypaid', 'paid', 'uncollectible'].includes(key(invoice.status));
const closed = invoice => ['void', 'voided', 'canceled', 'cancelled', 'uncollectible'].includes(key(invoice.status));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function createPartApprovalBilling(db, { now = () => new Date(), sendInvoice } = {}) {
  const companyRef = companyId => db.collection('companies').doc(companyId);
  const shoppingRef = (companyId, itemId, collection = 'shoppingList') => companyRef(companyId).collection(collection).doc(itemId);
  const patch = (tx, snap, fields) => {
    if (Object.entries(fields).some(([field, value]) => !same(snap.data()?.[field], value))) {
      tx.set(snap.ref, { ...fields, updatedAt: now() }, { merge: true });
    }
  };

  async function reconcile({ companyId, approvalId = '', shoppingItemId = '', shoppingCollectionName = 'shoppingList', manualDraft = false, auth }) {
    documentId(companyId, 'Company');
    if (!['shoppingList', 'shoppingListItems'].includes(shoppingCollectionName)) fail('invalid-argument', 'Invalid shopping collection.');
    if (approvalId) documentId(approvalId, 'Part approval');
    if (shoppingItemId) documentId(shoppingItemId, 'Shopping item');
    return db.runTransaction(async tx => {
      if (auth) {
        if (manualDraft) await billingActor(db, tx, companyId, auth.uid);
        else await companyActor(db, tx, companyId, auth.uid, auth.token);
      }
      const companySnap = await tx.get(companyRef(companyId));
      const settingsSnap = await tx.get(companyRef(companyId).collection('settings').doc('companyWide'));
      if (!companySnap.exists) fail('not-found', 'Company not found.');
      let itemSnap = shoppingItemId ? await tx.get(shoppingRef(companyId, shoppingItemId, shoppingCollectionName)) : null;
      if (shoppingItemId && !itemSnap.exists) return { status: 'skipped', reason: 'shopping_item_not_found' };
      const linkedApprovalId = approvalIdFor(itemSnap?.data() || {});
      if (approvalId && linkedApprovalId && linkedApprovalId !== approvalId) fail('failed-precondition', 'Shopping item belongs to a different approval.');
      approvalId = approvalId || linkedApprovalId;
      const approvalSnap = approvalId ? await tx.get(db.collection('customerPartApprovals').doc(documentId(approvalId, 'Approval'))) : null;
      const approval = approvalSnap?.data() || {};
      if (approvalId && (!approvalSnap.exists || approval.companyId !== companyId)) fail('permission-denied', 'Approval does not belong to this company.');
      if (approvalSnap) {
        const linkedItemId = text(approval.shoppingListItemId || approval.shoppingItemId);
        if (shoppingItemId && linkedItemId !== shoppingItemId) fail('failed-precondition', 'Approval and shopping links must agree before billing.');
        shoppingItemId = shoppingItemId || linkedItemId;
        if (!itemSnap && shoppingItemId) itemSnap = await tx.get(shoppingRef(companyId, shoppingItemId, shoppingCollectionName));
        if (!approved(approval)) return { status: 'skipped', reason: 'not_approved' };
      }
      const item = itemSnap?.data() || {};
      if (approvalSnap && itemSnap?.exists && (approvalIdFor(item) !== approvalId || item.customerId && item.customerId !== approval.customerId)) {
        fail('failed-precondition', 'Approval and shopping customer links must agree before billing.');
      }
      if (!approvalSnap && (!itemSnap?.exists || item.autoInvoiceOnInstall !== true || key(item.status) !== 'installed')) {
        return { status: 'skipped', reason: 'not_eligible' };
      }
      const source = approvalSnap ? approval : item;
      const targets = [approvalSnap, itemSnap].filter(snap => snap?.exists);
      const needsReview = reason => {
        for (const snap of targets) patch(tx, snap, { billingAutomationStatus: 'needsReview', billingAutomationError: reason });
        return { status: 'needsReview', reason };
      };
      if (source.manuallyInvoiced || source.invoiceType === 'manual' || source.invoiced && !invoiceIdFor(source)) {
        return needsReview('Previously marked invoiced without a sales invoice. Review existing billing before creating another invoice.');
      }
      if (source.returned === true || item.returned === true || item.personalPurchase === true) return { status: 'skipped', reason: 'returned_or_personal' };
      if (!manualDraft && approvalSnap && preference(approval) === 'delivery' && !delivered(item) && !delivered({ status: approval.fulfillmentStatus })) {
        for (const snap of targets) patch(tx, snap, { billingAutomationStatus: 'awaitingDelivery', billingAutomationError: '' });
        return { status: 'waiting', reason: 'awaiting_delivery' };
      }
      if (approvalSnap && require('./recurringPartCharges').nextBill(approval)) {
        return require('./recurringPartCharges').createRecurringPartCharges(db, null, now).stage(tx, { companyId, approvalSnap, itemSnap });
      }
      const customerId = text(source.customerId);
      if (!customerId) return needsReview('Add the approved customer before creating this invoice.');
      const customerSnap = await tx.get(companyRef(companyId).collection('customers').doc(documentId(customerId, 'Customer')));
      if (!customerSnap.exists) return needsReview('The approved customer record is missing. Restore the customer before billing.');
      const customer = customerSnap.data() || {}, company = companySnap.data();
      const sourceType = approvalSnap ? 'partApproval' : 'shoppingListItem';
      const sourceId = approvalId || shoppingItemId;
      const linkedIds = [...new Set(targets.map(snap => invoiceIdFor(snap.data())).filter(Boolean))];
      if (linkedIds.length > 1) return needsReview('Conflicting invoice links need billing review.');
      const deterministicId = `si_part_${hash(`${companyId}:${sourceType}:${sourceId}`)}`;
      const invoiceRef = db.collection('salesInvoices').doc(linkedIds[0] || deterministicId);
      const invoiceSnap = await tx.get(invoiceRef);
      // Recover pre-existing conversion invoices as well as deterministic retries.
      const legacy = await tx.get(db.collection('salesInvoices').where('companyId', '==', companyId).where(approvalSnap ? 'partApprovalRequestId' : 'shoppingListItemId', '==', sourceId));
      const existing = [...new Map([...(invoiceSnap.exists ? [invoiceSnap] : []), ...legacy.docs].map(snap => [snap.id, snap])).values()];
      if (existing.length > 1) return needsReview('Multiple invoices already reference this item. Review them before billing again.');
      const current = existing[0];
      if (linkedIds.length && !current) return needsReview('The linked invoice is missing. Review billing before replacing it.');
      if (current && (current.data().companyId !== companyId || current.data().customerId !== customerId)) return needsReview('The linked invoice belongs to a different customer or company.');
      if (current && !(approvalId && current.data().partApprovalRequestId === approvalId || shoppingItemId && current.data().shoppingListItemId === shoppingItemId)) return needsReview('The linked invoice does not identify this approved part. Review the source before billing.');
      if (current && closed(current.data())) return needsReview('The linked invoice is closed. Review it instead of issuing a duplicate.');
      const jobId = text(source.jobId || item.jobId);
      const jobInvoices = jobId ? await tx.get(db.collection('salesInvoices').where('companyId', '==', companyId).where('jobId', '==', jobId)) : { docs: [] };
      if (!current && jobInvoices.docs.some(snap => snap.data().billingScope !== 'approvedPart' && !closed(snap.data()))) {
        return needsReview('This job already has an invoice. Review its materials before issuing a separate part invoice.');
      }
      const purchaseId = text(item.purchasedItem || source.purchasedItem || source.purchasedItemId);
      const purchaseSnap = purchaseId ? await tx.get(companyRef(companyId).collection('purchasedItems').doc(documentId(purchaseId, 'Purchase'))) : null;
      if (purchaseSnap?.exists && purchaseSnap.data().shoppingListItemId && purchaseSnap.data().shoppingListItemId !== shoppingItemId) return needsReview('Purchase and shopping links do not agree.');
      if (purchaseSnap?.exists) {
        const purchase = purchaseSnap.data();
        if (purchase.returned === true || purchase.personalPurchase === true) return needsReview('The reconciled purchase is returned or personal. Review it before billing.');
        if (purchase.customerId && purchase.customerId !== customerId) return needsReview('The reconciled purchase belongs to a different customer.');
        if (invoiceIdFor(purchase) && invoiceIdFor(purchase) !== (current?.id || deterministicId) || purchase.invoiced && !invoiceIdFor(purchase)) return needsReview('The purchase already has other billing. Review it before creating another invoice.');
      }
      let invoice = current?.data(), id = current?.id;
      if (!current) {
        const pricingSource = approval.approvedPricingSnapshot || source;
        const quantity = Number(pricingSource.quantity ?? pricingSource.quantityString ?? 1);
        const unit = Number(pricingSource.plannedUnitPriceCents ?? pricingSource.unitPriceCents ?? pricingSource.customerUnitPriceCents ?? pricingSource.price ?? 0);
        const total = Number(pricingSource.plannedTotalPriceCents ?? pricingSource.totalPriceCents ?? Math.round(unit * quantity));
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(unit) || unit < 0) return needsReview('The approved item needs a valid customer price and quantity.');
        money(total);
        // Keep the approved quantity whenever integer-cent unit pricing reproduces its total.
        // Otherwise use an extended-price line to avoid losing approved cents in division.
        const effectiveUnit = unit > 0 && Math.round(unit * quantity) === total ? unit : Math.round(total / quantity);
        const preserveQuantity = Math.round(effectiveUnit * quantity) === total;
        id = deterministicId;
        const email = text(customer.billingEmail || customer.email || source.customerEmail || source.billingEmail || source.email);
        const timestamp = now(), dueDate = new Date(timestamp); dueDate.setDate(dueDate.getDate() + 14);
        invoice = { id, companyId, companyName: company.name || company.companyName || '', customerId,
          customerUserId: customer.customerUserId || source.customerUserId || null,
          customerName: source.customerName || customer.displayName || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Customer',
          email, customerEmail: email, billingEmail: email, relationshipId: customer.relationshipId || source.relationshipId || '',
          customerCompanyRelationshipId: customer.customerCompanyRelationshipId || source.customerCompanyRelationshipId || '',
          jobId, sourceType, sourceId, partApprovalRequestId: approvalId, shoppingListItemId: shoppingItemId, shoppingCollectionName,
          billingScope: 'approvedPart', invoiceNumber: `PART-${hash(id).slice(0, 10).toUpperCase()}`, type: 'oneTime', status: 'draft', currency: 'usd',
          stripeConnectedAccountId: company.stripeConnectedAccountId || company.stripeConnectAccountId || '',
          lineItems: [{ id: `part_${hash(sourceId)}`, name: source.itemName || source.name || 'Approved part',
            description: [source.description, preserveQuantity ? '' : `Approved quantity: ${quantity}`].filter(Boolean).join('\n'), quantity: preserveQuantity ? quantity : 1, unitAmountCents: preserveQuantity ? effectiveUnit : total, totalAmountCents: total, type: 'material', taxable: false,
            sourceType, sourceId, metadata: { partApprovalRequestId: approvalId, shoppingListItemId: shoppingItemId, approvedQuantity: quantity, approvedUnitPriceCents: unit } }],
          subtotalAmountCents: total, discountAmountCents: 0, taxAmountCents: 0, totalAmountCents: total, amountDueCents: total, amountPaidCents: 0, writeOffAmountCents: 0,
          dueDate, deliveryMethod: 'email', autoSendSuppressed: manualDraft, createdAt: timestamp, updatedAt: timestamp,
          createdByUserId: auth?.uid || 'partApprovalAutomation',
          serviceLocationSnapshots: source.serviceLocationId ? [{ id: source.serviceLocationId, name: source.serviceLocationName || '', address: source.serviceLocationAddress || '' }] : [] };
        tx.set(db.collection('salesInvoices').doc(id), invoice);
        tx.set(db.collection('salesInvoiceEvents').doc(`part_${hash(id)}`), { companyId, invoiceId: id, action: 'createFromApprovedPart', partApprovalRequestId: approvalId, shoppingListItemId: shoppingItemId, createdAt: timestamp });
      }
      if (current && shoppingItemId && !invoice.shoppingListItemId) {
        tx.set(current.ref, { shoppingListItemId: shoppingItemId, shoppingCollectionName, updatedAt: now() }, { merge: true });
      }
      const queueRef = db.collection('billingEmailQueue').doc(`part_${hash(id)}`);
      const status = invoice.automationEmailStatus === 'needsReview' ? 'emailNeedsReview' : issued(invoice) ? 'invoiced' : 'draft';
      const links = { invoiceId: id, salesInvoiceId: id, invoiceRef: id, invoiceType: 'salesInvoice', invoiceStatus: invoice.status,
        invoiced: issued(invoice), billingAutomationStatus: status, billingAutomationError: invoice.automationEmailError || '' };
      for (const snap of [...targets, purchaseSnap].filter(snap => snap?.exists)) patch(tx, snap, {
        ...links,
        ...(snap === approvalSnap && ['delivered', 'installed'].includes(key(item.status)) ? { shoppingListItemStatus: item.status, fulfillmentStatus: key(item.status) } : {}),
      });
      return { status: current ? 'existing' : 'created', invoiceId: id, queueId: queueRef.id, autoSend: settingsSnap.data()?.[AUTO_SEND_FIELD] === true && !invoice.autoSendSuppressed && !issued(invoice), shoppingPayload: links };
    });
  }

  async function ensure(options) {
    const result = await reconcile(options);
    if (result.recurringPartChargeId && result.invoiceId) await require('./recurringPartCharges').createRecurringPartCharges(db, null, now).syncInvoice(result.invoiceId);
    if (result.autoSend) await db.runTransaction(async tx => {
      const ref = db.collection('billingEmailQueue').doc(result.queueId);
      const snap = await tx.get(ref);
      if (!snap.exists) tx.set(ref, { companyId: options.companyId, invoiceId: result.invoiceId, status: 'pending', source: 'partApproval', createdAt: now() });
    });
    return result;
  }

  async function processEmail(queueId) {
    const ref = db.collection('billingEmailQueue').doc(documentId(queueId, 'Delivery'));
    const reserved = await db.runTransaction(async tx => {
      const queue = await tx.get(ref), data = queue.data();
      if (!queue.exists || data.source !== 'partApproval' || data.status !== 'pending') return null;
      const invoiceRef = db.collection('salesInvoices').doc(documentId(data.invoiceId, 'Invoice'));
      const invoiceSnap = await tx.get(invoiceRef), invoice = invoiceSnap.data();
      const settings = await tx.get(companyRef(data.companyId).collection('settings').doc('companyWide'));
      const approvalSnap = invoice?.partApprovalRequestId ? await tx.get(db.collection('customerPartApprovals').doc(invoice.partApprovalRequestId)) : null;
      const itemSnap = invoice?.shoppingListItemId ? await tx.get(shoppingRef(data.companyId, invoice.shoppingListItemId, invoice.shoppingCollectionName || 'shoppingList')) : null;
      const item = itemSnap?.data() || {};
      const purchaseSnap = item.purchasedItem ? await tx.get(companyRef(data.companyId).collection('purchasedItems').doc(item.purchasedItem)) : null;
      if (approvalSnap && (!approvalSnap.exists || !approved(approvalSnap.data())) || item.returned === true || item.personalPurchase === true || purchaseSnap?.data()?.returned === true || purchaseSnap?.data()?.personalPurchase === true) {
        tx.set(ref, { status: 'cancelled', updatedAt: now() }, { merge: true });
        if (invoiceSnap.exists) tx.set(invoiceRef, { automationEmailStatus: 'needsReview', automationEmailError: 'Fulfillment changed before sending. Review this invoice in Sales.', updatedAt: now() }, { merge: true });
        return null;
      }
      if (!invoiceSnap.exists || invoice.companyId !== data.companyId || settings.data()?.[AUTO_SEND_FIELD] !== true || invoice.autoSendSuppressed || invoice.billingMutation || invoice.paymentProcessing || closed(invoice) || issued(invoice)) {
        tx.set(ref, { status: issued(invoice || {}) ? 'complete' : 'cancelled', updatedAt: now() }, { merge: true }); return null;
      }
      tx.set(ref, { status: 'sending', startedAt: now() }, { merge: true });
      tx.set(invoiceRef, { automationEmailStatus: 'sending', automationDeliveryKey: queueId, automationEmailStartedAt: now(), updatedAt: now() }, { merge: true });
      return data;
    });
    if (!reserved) return;
    const invoiceRef = db.collection('salesInvoices').doc(reserved.invoiceId);
    try {
      await sendInvoice({ companyId: reserved.companyId, invoiceId: reserved.invoiceId, automationDeliveryKey: queueId });
      await ref.set({ status: 'complete', completedAt: now() }, { merge: true });
      await invoiceRef.set({ automationEmailStatus: 'sent', automationEmailError: '', updatedAt: now() }, { merge: true });
    } catch (error) {
      const invoice = (await invoiceRef.get()).data();
      const sent = Boolean(invoice?.sentAt);
      await ref.set({ status: sent ? 'complete' : 'needsReview', error: text(error.message).slice(0, 500), updatedAt: now() }, { merge: true });
      await invoiceRef.set({ automationEmailStatus: sent ? 'sent' : 'needsReview', automationEmailError: sent ? '' : 'Invoice created; email failed or delivery is uncertain. Review and send from Sales.', updatedAt: now() }, { merge: true });
    }
    await syncInvoice(reserved.invoiceId);
  }

  async function syncInvoice(id) {
    return db.runTransaction(async tx => {
      const invoiceSnap = await tx.get(db.collection('salesInvoices').doc(id));
      const invoice = invoiceSnap.data();
      if (!invoiceSnap.exists || invoice.billingScope !== 'approvedPart') return;
      const targets = [];
      if (invoice.partApprovalRequestId) targets.push(await tx.get(db.collection('customerPartApprovals').doc(invoice.partApprovalRequestId)));
      let itemSnap;
      if (invoice.shoppingListItemId) { itemSnap = await tx.get(shoppingRef(invoice.companyId, invoice.shoppingListItemId, invoice.shoppingCollectionName || 'shoppingList')); targets.push(itemSnap); }
      const purchaseId = text(itemSnap?.data()?.purchasedItem);
      if (purchaseId) targets.push(await tx.get(companyRef(invoice.companyId).collection('purchasedItems').doc(documentId(purchaseId, 'Purchase'))));
      for (const snap of targets.filter(snap => snap.exists)) {
        if (invoiceIdFor(snap.data()) && invoiceIdFor(snap.data()) !== id) continue;
        if (snap.data().companyId && snap.data().companyId !== invoice.companyId || snap.data().customerId && snap.data().customerId !== invoice.customerId) continue;
        patch(tx, snap, { invoiceId: id, salesInvoiceId: id, invoiceRef: id, invoiceType: 'salesInvoice', invoiceStatus: invoice.status,
          invoiced: issued(invoice), billingAutomationStatus: invoice.automationEmailStatus === 'needsReview' ? 'emailNeedsReview' : issued(invoice) ? 'invoiced' : 'draft', billingAutomationError: invoice.automationEmailError || '' });
      }
    });
  }

  return { ensure, processEmail, syncInvoice };
}

const service = () => createPartApprovalBilling(admin.firestore(), { sendInvoice: payload => require('./sendGrid/general').sendSalesInvoiceEmailForAutomation(payload) });
// Permanent data conflicts belong in the review UI, rather than an endless trigger retry.
const reconcileEvent = async (event, options) => {
  try { return await service().ensure(options); }
  catch (error) {
    if (!['invalid-argument', 'failed-precondition', 'permission-denied', 'not-found'].includes(error.code)) throw error;
    const original = event.data?.after;
    if (original?.ref) await admin.firestore().runTransaction(async tx => {
      const current = await tx.get(original.ref);
      if (!current.exists || !current.updateTime?.isEqual(original.updateTime)) return;
      tx.set(original.ref, { billingAutomationStatus: 'needsReview', billingAutomationError: text(error.message).slice(0, 500), updatedAt: new Date() }, { merge: true });
    });
    return { status: 'needsReview' };
  }
};
exports.createPartApprovalBilling = createPartApprovalBilling;
exports.ensurePartApprovalInvoice = onCall({ cors: true }, request => service().ensure({ ...request.data, auth: request.auth || { uid: '' }, manualDraft: request.data?.manualDraft === true }));
exports.reconcilePartApprovalInvoice = onDocumentWritten({ document: 'customerPartApprovals/{approvalId}', retry: true }, event => {
  const data = event.data?.after?.data();
  if (!data?.companyId) return null;
  const fields = ['approvalStatus', 'status', 'paymentPreference', 'paymentCollectionPreference', 'shoppingListItemId', 'fulfillmentStatus', 'plannedUnitPriceCents', 'plannedTotalPriceCents', 'customerId'];
  if (fields.every(field => same(event.data?.before?.data()?.[field], data[field]))) return null;
  return reconcileEvent(event, { companyId: data.companyId, approvalId: event.params.approvalId });
});
exports.reconcileShoppingItemInvoice = onDocumentWritten({ document: 'companies/{companyId}/shoppingList/{shoppingItemId}', retry: true }, event => {
  const data = event.data?.after?.data();
  if (!data) return null;
  const fields = ['status', 'purchasedItem', 'partApprovalRequestId', 'approvalRequestId', 'autoInvoiceOnInstall', 'customerId', 'returned', 'personalPurchase'];
  if (fields.every(field => same(event.data?.before?.data()?.[field], data[field]))) return null;
  return reconcileEvent(event, event.params);
});
exports.processPartInvoiceEmail = onDocumentWritten({ document: 'billingEmailQueue/{queueId}', retry: true, timeoutSeconds: 120 }, event => service().processEmail(event.params.queueId));
exports.syncPartInvoiceLinks = onDocumentWritten({ document: 'salesInvoices/{invoiceId}', retry: true }, event => service().syncInvoice(event.params.invoiceId));
