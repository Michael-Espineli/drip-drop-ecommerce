import { arrayRemove, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { syncLinkedShoppingPurchase } from "./shoppingPurchaseSync";
import { productTaskIds, taskProductIds } from "./jobPlanProducts";

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

  const linkedTaskIds = productTaskIds(item);
  for (const taskId of jobId ? linkedTaskIds : []) {
    const taskRef = doc(db, "companies", companyDocId, "workOrders", jobId, "tasks", taskId);
    const taskSnap = await getDoc(taskRef);

    if (taskSnap.exists()) {
      const task = taskSnap.data();
      const remaining = taskProductIds(task).filter((id) => id !== shoppingListItemId);
      batch.update(taskRef, {
        shoppingListItemId: task.shoppingListItemId === shoppingListItemId ? remaining[0] || "" : task.shoppingListItemId || "",
        shoppingListItemIds: arrayRemove(shoppingListItemId),
        ...(task.shoppingListItemId === shoppingListItemId ? { dataBaseItemId: "", genericItemId: "" } : {}),
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
    linkedTaskIds,
  };
};
