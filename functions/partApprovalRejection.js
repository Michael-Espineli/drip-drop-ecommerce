const admin = require('firebase-admin');
const { onCall } = require('firebase-functions/v2/https');
const { randomUUID } = require('node:crypto');
const { companyActor, can, documentId, fail, key } = require('./companyActor');

function assertPartCanBeRejected(approval, item = {}) {
  const started = [approval, item].some(row => row.purchasedItem || row.purchasedItemId || row.datePurchased ||
    row.purchasedAt || row.deliveredAt || row.installedAt || row.invoiced || row.invoiceId || row.salesInvoiceId ||
    ['purchased', 'delivered', 'installed', 'invoiced', 'paid'].includes(key(row.status)) ||
    ['purchased', 'delivered', 'installed', 'invoiced'].includes(key(row.fulfillmentStatus)));
  if (started) fail('failed-precondition', 'Purchasing, fulfillment, or billing has started. Review the item before rejecting the request.');
}

function createPartApprovalRejection(db, { now = () => new Date(), append = value => admin.firestore.FieldValue.arrayUnion(value) } = {}) {
  return async function reject(request) {
    const data = request.data || {};
    const companyId = documentId(data.companyId, 'Company');
    const id = documentId(data.approvalId, 'Approval');
    return db.runTransaction(async tx => {
      const actor = await companyActor(db, tx, companyId, request.auth?.uid, request.auth?.token);
      const company = db.collection('companies').doc(companyId);
      const ref = db.collection('customerPartApprovals').doc(id);
      const snap = await tx.get(ref), approval = snap.data() || {};
      if (!snap.exists || approval.companyId !== companyId) fail('not-found', 'Part approval not found.');
      const ids = [actor.uid, actor.user.id].filter(Boolean);
      const assigned = [approval.techId, approval.assignedTechId, approval.assignedToUserId, ...(approval.assignedTechIds || [])].some(value => ids.includes(value));
      if (!assigned && !['244', '24', '400', '404'].some(permission => can(actor, permission))) fail('permission-denied', 'You cannot reject this approval.');
      if (key(approval.approvalStatus || approval.status) === 'rejected') return { status: 'rejected' };
      const itemId = approval.shoppingListItemId || approval.shoppingItemId;
      const itemSnap = itemId ? await tx.get(company.collection('shoppingList').doc(documentId(itemId, 'Shopping item'))) : null;
      if (itemSnap?.exists && ![itemSnap.data().partApprovalRequestId, itemSnap.data().approvalRequestId, itemSnap.data().customerApprovalRequestId].includes(id)) {
        fail('failed-precondition', 'Review the linked shopping item before rejecting the approval.');
      }
      assertPartCanBeRejected(approval, itemSnap?.data());
      if (itemId && (await tx.get(company.collection('purchasedItems').where('shoppingListItemId', '==', itemId).limit(1))).size) {
        fail('failed-precondition', 'A purchase is linked to this material. Review it before rejecting the request.');
      }
      let taskSnap;
      if (approval.jobId && approval.linkedTaskId) {
        taskSnap = await tx.get(company.collection('workOrders').doc(documentId(approval.jobId, 'Job'))
          .collection('tasks').doc(documentId(approval.linkedTaskId, 'Task')));
      }
      const timestamp = now(), note = String(data.note || 'Declined on behalf of customer').trim().slice(0, 2000);
      const history = {
        id: `cpa_hist_${randomUUID()}`, action: 'staffRejected', status: 'rejected', note, createdAt: timestamp,
        source: 'staffOnBehalfOfCustomer', sourceLabel: 'Staff on behalf of customer', actorUserId: actor.uid, actorUserName: actor.name,
      };
      tx.set(ref, {
        status: 'rejected', approvalStatus: 'rejected', response: 'rejected', fulfillmentStatus: 'rejected',
        responseNote: note, respondedAt: timestamp, respondedByUserId: actor.uid, respondedByUserName: actor.name,
        responseSource: history.source, responseSourceLabel: history.sourceLabel, respondedOnBehalfOfCustomer: true,
        shoppingListItemId: '', shoppingItemId: '', shoppingListPath: '', history: append(history), updatedAt: timestamp,
      }, { merge: true });
      if (itemSnap?.exists) tx.delete(itemSnap.ref);
      if (taskSnap?.exists && taskSnap.data().customerApprovalRequestId === id) {
        const items = (taskSnap.data().shoppingListItemIds || []).filter(value => value !== itemId);
        tx.set(taskSnap.ref, {
          customerApproval: false, customerApprovalStatus: 'rejected', customerApprovalRespondedAt: timestamp,
          shoppingListItemIds: items,
          ...(taskSnap.data().shoppingListItemId === itemId ? { shoppingListItemId: items[0] || '' } : {}),
          updatedAt: timestamp,
        }, { merge: true });
      }
      return { status: 'rejected' };
    });
  };
}

exports.assertPartCanBeRejected = assertPartCanBeRejected;
exports.createPartApprovalRejection = createPartApprovalRejection;
exports.rejectPartApproval = onCall({ cors: true }, request => createPartApprovalRejection(admin.firestore())(request));
