const admin = require('firebase-admin');
const { onCall } = require('firebase-functions/v2/https');
const { companyActor, can, documentId, fail, key } = require('./companyActor');

const recordId = value => typeof value === 'string' ? value : value?.id || '';
const jobIdOf = row => recordId(row.jobId) || recordId(row.workOrderId) || recordId(row.assignedJobId);
const purchaseRecorded = row => Boolean(row.purchasedItem || row.purchasedItemId || row.datePurchased || row.purchasedAt)
  || ['purchased', 'delivered'].includes(key(row.status));

function createJobStopMaterials(db, now = () => new Date()) {
  return async function record(request) {
    const data = request.data || {};
    const companyId = documentId(data.companyId, 'Company');
    const serviceStopId = documentId(data.serviceStopId, 'Service stop');
    const install = data.action === 'install';
    if (!install && data.action !== 'useExtra') fail('invalid-argument', 'Choose a material action.');
    const id = install ? documentId(data.shoppingItemId, 'Shopping item') : `comp_shop_usage_${documentId(data.requestId, 'Usage request')}`;
    const name = String(data.name || '').trim().slice(0, 180);
    const quantity = Number(data.quantity);
    if (!install && (!name || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000)) {
      fail('invalid-argument', 'Enter a part name and a positive quantity.');
    }

    return db.runTransaction(async tx => {
      const actor = await companyActor(db, tx, companyId, request.auth?.uid, request.auth?.token);
      const company = db.collection('companies').doc(companyId);
      const stopSnap = await tx.get(company.collection('serviceStops').doc(serviceStopId));
      const stop = stopSnap.data() || {};
      if (!stopSnap.exists) fail('not-found', 'Service stop not found.');
      if (!can(actor, '244') && ![actor.uid, actor.user.id].filter(Boolean).includes(stop.techId || stop.userId)) {
        fail('permission-denied', 'Only the assigned technician or a service-stop manager can record materials.');
      }
      const jobId = documentId(jobIdOf(stop), 'Job on this service stop');
      const ref = company.collection('shoppingList').doc(id);
      const [jobSnap, snap] = await Promise.all([
        tx.get(company.collection('workOrders').doc(jobId)),
        tx.get(ref),
      ]);
      if (!jobSnap.exists) fail('not-found', 'This stop is no longer linked to a job.');
      const item = snap.data() || {};
      const itemStopId = recordId(item.serviceStopId) || recordId(item.scheduledServiceStopId);
      const timestamp = now();
      const fields = {
        status: 'Installed', fulfillmentStatus: 'installed', needsAction: false,
        serviceStopId, serviceStopInternalId: stop.internalId || '',
        installedAt: timestamp, installedByUserId: actor.uid, installedByUserName: actor.name,
        updatedAt: timestamp,
      };

      if (install) {
        if (!snap.exists || jobIdOf(item) !== jobId || itemStopId && itemStopId !== serviceStopId) {
          fail('failed-precondition', 'This material is not assigned to this job stop.');
        }
        if (item.installedAt || key(item.status) === 'installed') return { id, status: 'Installed' };
        if (item.shoppingListActive === false || item.planWorkspaceOnly || item.returned || !purchaseRecorded(item)) {
          fail('failed-precondition', 'Mark this material purchased before recording installation.');
        }
        const approvalId = item.partApprovalRequestId || item.approvalRequestId;
        const approval = approvalId ? await tx.get(db.collection('customerPartApprovals').doc(documentId(approvalId, 'Approval'))) : null;
        if (approval && (!approval.exists || approval.data().companyId !== companyId ||
          !['approved', 'resolved'].includes(key(approval.data().approvalStatus || approval.data().status)))) {
          fail('failed-precondition', 'This material needs a valid customer approval before installation.');
        }
        const count = Number(item.quantity ?? item.quantityString);
        if (Number.isFinite(count) && count > 0) fields.installedQuantity = count;
        tx.set(ref, fields, { merge: true });
        if (approval) tx.set(approval.ref, { ...fields, status: approval.data().status || 'approved', shoppingListItemStatus: 'Installed' }, { merge: true });
      } else {
        if (snap.exists) {
          if (item.materialUsageOnly === true && itemStopId === serviceStopId && item.installedByUserId === actor.uid) return { id, status: 'Installed' };
          fail('already-exists', 'This material request is already in use.');
        }
        const productId = data.productId ? documentId(data.productId, 'Product') : '';
        const productSnap = productId ? await tx.get(company.collection('settings').doc('genericItems').collection('genericItems').doc(productId)) : null;
        if (productSnap && !productSnap.exists) fail('not-found', 'This product is no longer in the catalog.');
        const job = jobSnap.data();
        const customerId = stop.customerId || job.customerId || '';
        const serviceLocationId = stop.serviceLocationId || job.serviceLocationId || '';
        tx.set(ref, {
          ...fields, id, companyId, jobId, jobName: job.internalId || '', category: 'Job',
          subCategory: productId ? 'Product' : 'Part', name, productId, genericItemId: productId,
          description: String(data.note || '').trim().slice(0, 1000),
          quantity: String(quantity), installedQuantity: quantity, materialUsageOnly: true,
          customerId, customerName: stop.customerName || job.customerName || '', serviceLocationId,
          shoppingListActive: true, autoInvoiceOnInstall: false, invoiced: false,
          prepKeys: [`job:${jobId}`, `serviceStop:${serviceStopId}`, customerId && `customer:${customerId}`, serviceLocationId && `serviceLocation:${serviceLocationId}`].filter(Boolean),
          createdAt: timestamp,
        });
      }
      return { id, status: 'Installed' };
    });
  };
}

function createJobPurchaseReconciliation(db, now = () => new Date()) {
  return async function connect(request) {
    const data = request.data || {};
    const companyId = documentId(data.companyId, 'Company');
    const itemId = documentId(data.shoppingItemId, 'Shopping item');
    const purchaseId = documentId(data.purchasedItemId, 'Purchase');
    return db.runTransaction(async tx => {
      const actor = await companyActor(db, tx, companyId, request.auth?.uid, request.auth?.token);
      if (!can(actor, '104')) fail('permission-denied', 'Purchase editing permission is required.');
      const company = db.collection('companies').doc(companyId);
      const [itemSnap, purchaseSnap] = await Promise.all([
        tx.get(company.collection('shoppingList').doc(itemId)),
        tx.get(company.collection('purchasedItems').doc(purchaseId)),
      ]);
      if (!itemSnap.exists || !purchaseSnap.exists) fail('not-found', 'The shopping item or purchase was removed.');
      const item = itemSnap.data(), purchase = purchaseSnap.data();
      const jobId = documentId(jobIdOf(item), 'Job');
      const jobSnap = await tx.get(company.collection('workOrders').doc(jobId));
      if (!jobSnap.exists) fail('not-found', 'This material is no longer linked to a job.');
      const existingPurchase = item.purchasedItem || item.purchasedItemId;
      if (existingPurchase && existingPurchase !== purchaseId || purchase.shoppingListItemId && purchase.shoppingListItemId !== itemId ||
          jobIdOf(purchase) && jobIdOf(purchase) !== jobId || purchase.returned || purchase.personalPurchase ||
          purchase.customerId && item.customerId && purchase.customerId !== item.customerId) {
        fail('failed-precondition', 'Review or unlink the existing purchase assignment before matching this line.');
      }
      if (item.shoppingListActive === false || item.planWorkspaceOnly || item.returned) {
        fail('failed-precondition', 'This material is not available for purchase reconciliation.');
      }
      const purchasedQuantity = Number(purchase.quantityString ?? purchase.quantity ?? 1);
      const usedQuantity = Number(item.installedQuantity ?? item.quantity);
      if (item.materialUsageOnly && Number.isFinite(usedQuantity) && Math.abs(usedQuantity - purchasedQuantity) > 0.000001) {
        fail('failed-precondition', 'Split the purchase line to match the quantity used at this stop.');
      }
      const timestamp = now(), purchasedAt = item.datePurchased || purchase.date || purchase.datePurchased || purchase.purchaseDate;
      const lineSubtotal = Math.round(Number(purchase.price) * purchasedQuantity);
      const receipt = purchase.receiptId ? await tx.get(company.collection('receipts').doc(documentId(purchase.receiptId, 'Receipt'))) : null;
      const receiptData = receipt?.data() || {};
      const receiptSubtotal = Number(receiptData.cost);
      const receiptTax = Number(receiptData.tax ?? (Number(receiptData.costAfterTax) - receiptSubtotal));
      const lineTotal = purchase.totalAfterTax ?? purchase.receiptLineTotalCents ??
        (Number.isFinite(lineSubtotal) && receiptSubtotal > 0 && Number.isFinite(receiptTax)
          ? lineSubtotal + Math.round(lineSubtotal / receiptSubtotal * receiptTax) : null);
      const status = item.installedAt || key(item.status) === 'installed' ? 'Installed'
        : key(item.status) === 'delivered' ? 'Delivered' : 'Purchased';
      const jobName = item.jobName || jobSnap.data().internalId || '';
      const covered = item.invoiced === true && item.materialUsageOnly !== true && Boolean(item.salesInvoiceId || item.invoiceId);
      tx.set(itemSnap.ref, { purchasedItem: purchaseId, status,
        ...(purchasedAt ? { datePurchased: purchasedAt } : {}),
        needsAction: status === 'Purchased', updatedAt: timestamp }, { merge: true });
      tx.set(purchaseSnap.ref, {
        shoppingListItemId: itemId, jobId, workOrderId: jobId, assignedJobId: jobId, jobName, assignedToJob: true,
        assignmentStatus: 'assignedToJob', billingOwner: 'job', status: covered ? 'Invoiced' : 'Connected to Job',
        jobBillingStatus: covered ? 'invoiced' : 'handledByJob',
        ...(item.customerId ? { customerId: item.customerId, customerName: item.customerName || '' } : {}),
        ...(item.serviceLocationId ? { serviceLocationId: item.serviceLocationId } : {}),
        ...(item.materialUsageOnly ? { materialUsageOnly: true, jobBillable: false } : {}),
        ...(lineTotal != null && Number.isSafeInteger(Math.round(Number(lineTotal))) ? { receiptLineTotalCents: Math.round(Number(lineTotal)) } : {}),
        ...(covered ? { invoiced: true, salesInvoiceId: item.salesInvoiceId || item.invoiceId, invoiceId: item.salesInvoiceId || item.invoiceId,
          invoiceRef: item.salesInvoiceId || item.invoiceId, invoiceType: 'salesInvoice', invoiceStatus: item.invoiceStatus || 'open' } : {}),
        updatedAt: timestamp,
      }, { merge: true });
      return { id: itemId, jobId, jobName, status, purchaseStatus: covered ? 'Invoiced' : 'Connected to Job' };
    });
  };
}

exports.createJobStopMaterials = createJobStopMaterials;
exports.recordJobStopMaterial = onCall({ cors: true }, request => createJobStopMaterials(admin.firestore())(request));
exports.createJobPurchaseReconciliation = createJobPurchaseReconciliation;
exports.reconcileJobMaterialPurchase = onCall({ cors: true }, request => createJobPurchaseReconciliation(admin.firestore())(request));
