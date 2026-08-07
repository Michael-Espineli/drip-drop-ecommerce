import { arrayRemove, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { syncLinkedShoppingPurchase } from "./shoppingPurchaseSync";

const compactString = (value) => String(value || "").trim();

export const getShoppingItemPartApprovalId = (item = {}) => compactString(
  item.partApprovalRequestId ||
  item.approvalRequestId ||
  item.customerApprovalRequestId
);

export const isShoppingItemFromPartApproval = (item = {}) => Boolean(getShoppingItemPartApprovalId(item));

const getLinkedTaskId = (item = {}) => compactString(
  item.linkedTaskId ||
  item.linkedJobTaskId ||
  item.jobTaskId ||
  item.sourceTaskId
);

export const deleteShoppingListItemWithLinks = async ({
  db,
  companyId,
  itemId,
  item = {},
  collectionName = "shoppingList",
} = {}) => {
  const shoppingListItemId = compactString(itemId || item.id);
  const companyDocId = compactString(companyId);
  const shoppingCollectionName = compactString(collectionName) || "shoppingList";

  if (!db || !companyDocId || !shoppingListItemId) {
    throw new Error("Missing shopping list item delete context.");
  }

  const partApprovalRequestId = getShoppingItemPartApprovalId(item);
  const purchasedItemId = compactString(item.purchasedItem || item.purchasedItemId);
  const jobId = compactString(item.jobId || item.workOrderId);
  const linkedTaskId = getLinkedTaskId(item);

  if (purchasedItemId) {
    await syncLinkedShoppingPurchase({
      db,
      companyId: companyDocId,
      previousPurchasedItemId: purchasedItemId,
    });
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, "companies", companyDocId, shoppingCollectionName, shoppingListItemId));

  if (partApprovalRequestId) {
    const approvalRef = doc(db, "customerPartApprovals", partApprovalRequestId);
    const approvalSnap = await getDoc(approvalRef);

    if (approvalSnap.exists()) {
      batch.delete(approvalRef);
    }
  }

  if (jobId && linkedTaskId) {
    const taskRef = doc(db, "companies", companyDocId, "workOrders", jobId, "tasks", linkedTaskId);
    const taskSnap = await getDoc(taskRef);

    if (taskSnap.exists()) {
      batch.update(taskRef, {
        shoppingListItemId: "",
        shoppingListItemIds: arrayRemove(shoppingListItemId),
        updatedAt: serverTimestamp(),
      });
    }
  }

  await batch.commit();

  return {
    shoppingListItemId,
    partApprovalRequestId,
    purchasedItemId,
    linkedTaskId,
  };
};
