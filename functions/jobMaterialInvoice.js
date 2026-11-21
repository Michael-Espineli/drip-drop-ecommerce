const { fail, key } = require('./companyActor');

const materialId = line => line.metadata?.shoppingListItemId || line.shoppingListItemId ||
  (key(line.sourceType) === 'shoppinglistitem' ? line.sourceId : '') || line.id;
const isMaterial = line => ['material', 'product'].includes(key(line.type || line.salesItemType)) ||
  Boolean(line.metadata?.shoppingListItemId || line.shoppingListItemId) ||
  key(line.sourceType) === 'shoppinglistitem';

function invoiceMaterialLines(lines = []) {
  return new Map(lines.filter(isMaterial).map(line => [materialId(line), line]).filter(([id]) => id));
}

async function assertApprovedJobPartsCovered(tx, db, { companyId, jobId, lines }) {
  const approvals = await tx.get(db.collection('customerPartApprovals').where('companyId', '==', companyId).where('jobId', '==', jobId));
  const materials = invoiceMaterialLines(lines);
  const missing = approvals.docs.filter(snap => {
    const approval = snap.data();
    if (!['approved', 'resolved'].includes(key(approval.approvalStatus || approval.status))) return false;
    const line = materials.get(approval.shoppingListItemId || approval.shoppingItemId);
    const price = approval.approvedPricingSnapshot || approval;
    const quantity = Number(price.quantity || 1);
    const total = price.plannedTotalPriceCents ?? price.totalPriceCents ??
      Math.round(Number(price.plannedUnitPriceCents ?? price.unitPriceCents ?? 0) * quantity);
    return !line || line.quantity !== quantity || line.totalAmountCents !== Number(total);
  });
  if (missing.length) {
    const names = missing.slice(0, 4).map(snap => snap.data().itemName || snap.data().name || 'Approved part');
    fail('failed-precondition', `Review approved add-ons in the accepted estimate before creating this invoice: ${names.join(', ')}.`);
  }
}

async function syncJobMaterialInvoice(tx, db, invoice, now) {
  if (!invoice.companyId || !invoice.jobId) return;
  const company = db.collection('companies').doc(invoice.companyId);
  const materials = invoiceMaterialLines(invoice.lineItems);
  if (!materials.size) return;

  // Exact line IDs own billing coverage. Receipt matching may happen after the invoice.
  const all = await tx.get(company.collection('shoppingList').where('jobId', '==', invoice.jobId));
  const targets = new Map();
  for (const item of all.docs) {
    const row = item.data();
    if (!materials.has(item.id) || row.materialUsageOnly || row.returned || row.offlineBillingStatus ||
        row.customerId && row.customerId !== invoice.customerId) continue;
    targets.set(item.ref.path, item);
    const approvalId = row.partApprovalRequestId || row.approvalRequestId || row.customerApprovalRequestId;
    const approval = approvalId && await tx.get(db.collection('customerPartApprovals').doc(approvalId));
    if (approval?.exists && approval.data().companyId === invoice.companyId && approval.data().jobId === invoice.jobId &&
        (approval.data().shoppingListItemId || approval.data().shoppingItemId) === item.id) targets.set(approval.ref.path, approval);
    const purchaseId = row.purchasedItem || row.purchasedItemId;
    const purchase = purchaseId && await tx.get(company.collection('purchasedItems').doc(purchaseId));
    if (purchase?.exists && purchase.data().shoppingListItemId === item.id && purchase.data().jobId === invoice.jobId &&
        !purchase.data().returned && !purchase.data().personalPurchase) targets.set(purchase.ref.path, purchase);
  }
  const status = key(invoice.status);
  const invoiced = ['open', 'paid', 'partiallypaid', 'uncollectible'].includes(status);
  for (const snap of targets.values()) {
    const row = snap.data();
    const existingInvoice = row.salesInvoiceId || row.invoiceId;
    if (existingInvoice && existingInvoice !== invoice.id || row.offlineBillingStatus) continue;
    const fields = {
      salesInvoiceId: invoice.id, invoiceId: invoice.id, invoiceRef: invoice.id, invoiceType: 'salesInvoice',
      jobBillingStatus: invoiced ? 'invoiced' : status, invoiceStatus: invoice.status, invoiced,
      billingAutomationStatus: invoiced ? 'includedOnJobInvoice' : 'awaitingJobInvoice',
    };
    if (Object.entries(fields).some(([name, value]) => row[name] !== value)) tx.set(snap.ref, { ...fields, updatedAt: now() }, { merge: true });
  }
}

module.exports = { assertApprovedJobPartsCovered, syncJobMaterialInvoice };
