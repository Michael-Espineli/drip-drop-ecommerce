import { arrayUnion, doc, getDoc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { v4 as uuidv4 } from "uuid";
import {
  SHOPPING_LIST_INVOICED_STATUS,
} from "../shoppingListStatus";
import { SHOPPING_ITEM_INSTALL_INVOICE_AUTOMATION_FIELD } from "./billingSettings";

const cleanString = (value) => String(value || "").trim();

const numericValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const quantityValue = (item = {}) => {
  const parsed = Number.parseFloat(item.quantity || item.quantityString || "1");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const moneyCentsValue = (...values) => {
  for (const value of values) {
    const amount = numericValue(value, 0);
    if (amount > 0) return Math.round(amount);
  }

  return 0;
};

const compactPartApprovalId = (item = {}) => cleanString(
  item.partApprovalRequestId ||
  item.approvalRequestId ||
  item.customerApprovalRequestId
);

const actorName = (user = {}) => (
  user.displayName ||
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.userName ||
  user.name ||
  user.email ||
  ""
);

export const shoppingItemAutoInvoiceOnInstallEnabled = (item = {}, companyData = {}) => {
  if (item.autoInvoiceOnInstall === true) return true;
  if (item.autoInvoiceOnInstall === false) return false;
  return companyData?.[SHOPPING_ITEM_INSTALL_INVOICE_AUTOMATION_FIELD] === true;
};

export const shoppingItemInvoiceTotalCents = (item = {}) => {
  const quantity = quantityValue(item);
  const unitAmountCents = moneyCentsValue(
    item.plannedUnitPriceCents,
    item.unitPriceCents,
    item.customerUnitPriceCents,
    item.price
  );

  return moneyCentsValue(
    item.plannedTotalPriceCents,
    item.totalPriceCents,
    unitAmountCents > 0 ? Math.round(unitAmountCents * quantity) : 0
  );
};

export const updateLinkedPartApprovalForManualShoppingInvoice = async ({
  db,
  shoppingItem = {},
  note = "",
  user = {},
} = {}) => {
  const approvalId = compactPartApprovalId(shoppingItem);
  if (!db || !approvalId) return false;

  const approvalRef = doc(db, "customerPartApprovals", approvalId);
  const approvalSnap = await getDoc(approvalRef);
  if (!approvalSnap.exists()) return false;

  const historyEvent = {
    id: `cpa_hist_${uuidv4()}`,
    action: "markedInvoicedFromShoppingList",
    status: "invoiced",
    note: note || "Marked invoiced from shopping list.",
    source: "companyWeb",
    sourceLabel: "Company web app",
    actorUserId: user?.uid || "",
    actorUserName: actorName(user),
    actorEmail: user?.email || "",
    createdAt: Timestamp.now(),
  };

  await updateDoc(approvalRef, {
    invoiced: true,
    manuallyInvoiced: true,
    manualInvoiceNote: note || "",
    invoiceStatus: "manual",
    invoiceType: "manual",
    manualInvoiceStatus: "invoiced",
    manualInvoicedAt: serverTimestamp(),
    manualInvoicedByUserId: user?.uid || "",
    manualInvoicedByUserName: actorName(user),
    shoppingListItemStatus: SHOPPING_LIST_INVOICED_STATUS,
    fulfillmentStatus: "invoiced",
    updatedAt: serverTimestamp(),
    history: arrayUnion(historyEvent),
  });

  return true;
};

// The server re-reads approval, customer, fulfillment, price and company settings.
// Every entry point uses the same invoice identity; clients never mark a draft as sent.
export const createAndSendShoppingItemInstallInvoice = async ({
  functions, companyId, shoppingCollectionName = "shoppingList", shoppingItem = {}, getCallableAuthPayload,
} = {}) => {
  if (!functions || !companyId || !shoppingItem.id) return { status: "skipped", reason: "missing_context" };
  const auth = getCallableAuthPayload ? await getCallableAuthPayload() : {};
  const result = await httpsCallable(functions, "ensurePartApprovalInvoice")({
    ...auth, companyId, shoppingItemId: shoppingItem.id, shoppingCollectionName,
  });
  return result.data;
};
