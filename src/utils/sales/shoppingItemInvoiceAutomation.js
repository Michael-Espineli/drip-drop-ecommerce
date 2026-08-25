import { arrayUnion, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { v4 as uuidv4 } from "uuid";
import { salesCollectionNames } from "../models/Sales";
import {
  SHOPPING_LIST_INVOICED_STATUS,
  SHOPPING_LIST_STATUS,
  canonicalShoppingListStatus,
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

const buildServiceLocationSnapshots = (item = {}) => {
  const serviceLocationId = cleanString(item.serviceLocationId);
  if (!serviceLocationId && !item.serviceLocationName && !item.serviceLocationAddress) return [];

  return [{
    id: serviceLocationId,
    serviceLocationId,
    name: item.serviceLocationName || "",
    displayName: item.serviceLocationName || item.serviceLocationAddress || "",
    address: item.serviceLocationAddress || "",
  }];
};

const buildShoppingInvoicePayload = ({
  companyId,
  companyData = {},
  customerData = {},
  invoiceId,
  shoppingItem = {},
}) => {
  const quantity = quantityValue(shoppingItem);
  const totalAmountCents = shoppingItemInvoiceTotalCents(shoppingItem);
  const unitAmountCents = Math.round(totalAmountCents / quantity);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  const customerEmail = cleanString(
    shoppingItem.customerEmail ||
    shoppingItem.email ||
    shoppingItem.billingEmail ||
    customerData.email ||
    customerData.billingEmail
  );

  const lineItem = {
    id: `sili_${uuidv4()}`,
    sourceType: "shoppingListItem",
    sourceId: shoppingItem.id,
    catalogItemId: shoppingItem.productId || shoppingItem.genericItemId || shoppingItem.itemId || shoppingItem.dbItemId || "",
    name: shoppingItem.name || shoppingItem.productName || shoppingItem.dbItemName || "Shopping item",
    description: shoppingItem.description || "",
    quantity,
    unitAmountCents,
    totalAmountCents,
    taxable: false,
    type: "material",
    metadata: {
      sourceType: "shoppingListItem",
      shoppingListItemId: shoppingItem.id,
      partApprovalRequestId: compactPartApprovalId(shoppingItem),
    },
  };

  return {
    id: invoiceId,
    companyId,
    companyName: companyData.name || companyData.companyName || companyData.displayName || shoppingItem.companyName || "",
    customerId: shoppingItem.customerId || customerData.id || "",
    customerUserId: shoppingItem.customerUserId || customerData.customerUserId || null,
    customerName: shoppingItem.customerName || customerData.customerName || customerData.displayName || "Customer",
    customerEmail,
    billingEmail: customerEmail,
    customerPhoneNumber: shoppingItem.customerPhoneNumber || customerData.phoneNumber || "",
    relationshipId: shoppingItem.relationshipId || customerData.relationshipId || "",
    customerCompanyRelationshipId: shoppingItem.customerCompanyRelationshipId || customerData.customerCompanyRelationshipId || customerData.relationshipId || "",
    email: customerEmail,
    agreementId: "",
    jobId: shoppingItem.jobId || shoppingItem.workOrderId || "",
    contractId: "",
    billingSubscriptionId: "",
    stripeConnectedAccountId: shoppingItem.stripeConnectedAccountId || companyData.stripeConnectedAccountId || companyData.stripeConnectAccountId || "",
    stripeInvoiceId: "",
    stripePaymentIntentId: "",
    stripeHostedInvoiceUrl: "",
    stripeInvoicePdfUrl: "",
    invoiceNumber: `SHOP-${String(Date.now()).slice(-6)}`,
    type: "oneTime",
    status: "draft",
    deliveryMethod: "email",
    currency: "usd",
    billingPeriodStart: null,
    billingPeriodEnd: null,
    dueDate: Timestamp.fromDate(dueDate),
    subtotalAmountCents: totalAmountCents,
    discountAmountCents: 0,
    taxAmountCents: 0,
    totalAmountCents,
    amountPaidCents: 0,
    amountDueCents: totalAmountCents,
    writeOffAmountCents: 0,
    memo: `Installed shopping item: ${lineItem.name}`,
    lineItems: [lineItem],
    serviceLocationSnapshots: buildServiceLocationSnapshots(shoppingItem),
    sourceType: "shoppingListItem",
    sourceId: shoppingItem.id,
    shoppingListItemId: shoppingItem.id,
    partApprovalRequestId: compactPartApprovalId(shoppingItem),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
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

export const createAndSendShoppingItemInstallInvoice = async ({
  db,
  functions,
  companyId,
  shoppingCollectionName = "shoppingList",
  shoppingItem = {},
  companyData = null,
  user = {},
  getCallableAuthPayload,
  invoiceBaseUrl = typeof window !== "undefined" ? window.location.origin : "",
  sendInvoice = true,
} = {}) => {
  if (!db || !companyId || !shoppingItem?.id) {
    return { status: "skipped", reason: "missing_context" };
  }

  if (shoppingItem.invoiced || shoppingItem.invoiceId || shoppingItem.salesInvoiceId) {
    return { status: "skipped", reason: "already_invoiced" };
  }

  const canonicalStatus = canonicalShoppingListStatus(shoppingItem.status);
  if (canonicalStatus !== SHOPPING_LIST_STATUS.installed) {
    return { status: "skipped", reason: "not_installed" };
  }

  const totalAmountCents = shoppingItemInvoiceTotalCents(shoppingItem);
  if (totalAmountCents <= 0) {
    return { status: "skipped", reason: "missing_billable_amount" };
  }

  const companySnap = companyData
    ? null
    : await getDoc(doc(db, "companies", companyId));
  const resolvedCompanyData = companyData || (companySnap?.exists() ? { id: companySnap.id, ...companySnap.data() } : {});
  const customerId = cleanString(shoppingItem.customerId);
  const customerSnap = customerId
    ? await getDoc(doc(db, "companies", companyId, "customers", customerId))
    : null;
  const customerData = customerSnap?.exists() ? { id: customerSnap.id, ...customerSnap.data() } : {};
  const invoiceId = `si_${uuidv4()}`;
  const invoicePayload = buildShoppingInvoicePayload({
    companyId,
    companyData: resolvedCompanyData,
    customerData,
    invoiceId,
    shoppingItem,
  });

  if (!invoicePayload.email) {
    return { status: "skipped", reason: "missing_customer_email" };
  }

  const shoppingRef = doc(db, "companies", companyId, shoppingCollectionName, shoppingItem.id);
  const shoppingUpdates = {
    invoiced: true,
    invoiceStatus: "Invoiced",
    invoiceType: "salesInvoice",
    invoiceId,
    invoiceRef: invoiceId,
    salesInvoiceId: invoiceId,
    status: SHOPPING_LIST_INVOICED_STATUS,
    needsAction: false,
    autoInvoiceOnInstall: true,
    autoInvoiceStatus: sendInvoice ? "sending" : "created",
    autoInvoiceCreatedAt: serverTimestamp(),
    autoInvoiceCreatedByUserId: user?.uid || "",
    autoInvoiceCreatedByUserName: actorName(user),
    updatedAt: serverTimestamp(),
  };
  const approvalId = compactPartApprovalId(shoppingItem);
  const historyEvent = {
    id: `cpa_hist_${uuidv4()}`,
    action: "invoiceCreatedFromInstall",
    status: "invoiced",
    note: "Invoice created automatically when the shopping item was installed.",
    source: "companyWeb",
    sourceLabel: "Company web app",
    actorUserId: user?.uid || "",
    actorUserName: actorName(user),
    actorEmail: user?.email || "",
    createdAt: Timestamp.now(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, salesCollectionNames.invoices, invoiceId), invoicePayload, { merge: true });
  batch.set(shoppingRef, shoppingUpdates, { merge: true });

  if (approvalId) {
    batch.set(doc(db, "customerPartApprovals", approvalId), {
      status: "resolved",
      approvalStatus: "approved",
      fulfillmentStatus: "invoiced",
      shoppingListItemId: shoppingItem.id,
      shoppingListItemStatus: SHOPPING_LIST_INVOICED_STATUS,
      invoiced: true,
      invoiceId,
      salesInvoiceId: invoiceId,
      invoiceStatus: "draft",
      invoiceType: "salesInvoice",
      autoInvoiceCreatedAt: serverTimestamp(),
      autoInvoiceCreatedByUserId: user?.uid || "",
      autoInvoiceCreatedByUserName: actorName(user),
      updatedAt: serverTimestamp(),
      history: arrayUnion(historyEvent),
    }, { merge: true });
  }

  await batch.commit();

  if (!sendInvoice || !functions || !getCallableAuthPayload) {
    return { status: "created", invoiceId, shoppingPayload: shoppingUpdates };
  }

  try {
    const authPayload = await getCallableAuthPayload();
    const sendCallable = httpsCallable(functions, "sendSalesInvoiceEmail");
    const result = await sendCallable({
      ...authPayload,
      companyId,
      invoiceId,
      invoiceBaseUrl,
    });
    const sentUpdates = {
      autoInvoiceStatus: "sent",
      invoiceStatus: "Invoiced",
      invoiceEmailSentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(shoppingRef, sentUpdates, { merge: true });
    if (approvalId) {
      await setDoc(doc(db, "customerPartApprovals", approvalId), {
        invoiceStatus: "open",
        invoiceEmailSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    return {
      status: "sent",
      invoiceId,
      emailResult: result.data || null,
      shoppingPayload: {
        ...shoppingUpdates,
        ...sentUpdates,
      },
    };
  } catch (error) {
    const errorMessage = error.details?.message || error.message || "Invoice email could not be sent.";
    const failedUpdates = {
      autoInvoiceStatus: "created_email_failed",
      autoInvoiceError: errorMessage,
      updatedAt: serverTimestamp(),
    };

    await setDoc(shoppingRef, failedUpdates, { merge: true });
    if (approvalId) {
      await setDoc(doc(db, "customerPartApprovals", approvalId), {
        autoInvoiceError: errorMessage,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    return {
      status: "created_email_failed",
      reason: errorMessage,
      invoiceId,
      shoppingPayload: {
        ...shoppingUpdates,
        ...failedUpdates,
      },
    };
  }
};
