import { arrayUnion, doc, getDoc, Timestamp, updateDoc } from "firebase/firestore";

export const SHOPPING_LIST_INVOICED_STATUS = "Invoiced";
export const shoppingListClosedStatuses = ["Delivered", "Installed", SHOPPING_LIST_INVOICED_STATUS];

const cleanString = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return value ? "true" : "";
  if (value?.id) return String(value.id).trim();
  return "";
};

const firstString = (...values) => {
  for (const value of values) {
    const cleanValue = cleanString(value);
    if (cleanValue) return cleanValue;
  }

  return "";
};

const normalizeStatus = (value) =>
  cleanString(value).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const isInvoicedValue = (value) => {
  const normalizedValue = normalizeStatus(value);
  return normalizedValue === "invoiced" || normalizedValue === "paid";
};

export const isShoppingListStatusClosed = (status) =>
  shoppingListClosedStatuses.some((closedStatus) => normalizeStatus(closedStatus) === normalizeStatus(status));

export const shoppingItemNeedsAction = (status) => !isShoppingListStatusClosed(status);

const truthyBoolean = (...values) => values.some((value) => Boolean(value));

const linkedJobIdFrom = (shoppingItem = {}, purchasedItem = {}, preferPurchasedContext = false) =>
  preferPurchasedContext
    ? firstString(purchasedItem.jobId, purchasedItem.workOrderId, purchasedItem.assignedJobId, shoppingItem.jobId, shoppingItem.workOrderId)
    : firstString(shoppingItem.jobId, shoppingItem.workOrderId, purchasedItem.jobId, purchasedItem.workOrderId, purchasedItem.assignedJobId);

const jobBillingIsInvoiced = (jobData = {}) =>
  truthyBoolean(
    jobData.invoiced,
    isInvoicedValue(jobData.billingStatus),
    isInvoicedValue(jobData.invoiceStatus),
    isInvoicedValue(jobData.status)
  );

const firestoreDocRef = (db, companyId, collectionName, itemId) =>
  doc(db, "companies", companyId, collectionName, itemId);

const shoppingDocRef = (db, companyId, shoppingItemId, shoppingCollectionName = "shoppingList") =>
  firestoreDocRef(db, companyId, shoppingCollectionName, shoppingItemId);

const purchaseDocRef = (db, companyId, purchasedItemId) =>
  firestoreDocRef(db, companyId, "purchasedItems", purchasedItemId);

const jobDocRef = (db, companyId, jobId) =>
  firestoreDocRef(db, companyId, "workOrders", jobId);

const safeGetDocData = async (ref) => {
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

const addPurchasedItemToJob = async ({
  db,
  companyId,
  jobId,
  purchasedItemId,
  shoppingItemId = "",
  now,
}) => {
  if (!db || !companyId || !jobId || !purchasedItemId) return;

  const updates = {
    purchasedItemsIds: arrayUnion(purchasedItemId),
    updatedAt: now,
  };

  if (shoppingItemId) {
    updates.shoppingListItemIds = arrayUnion(shoppingItemId);
  }

  try {
    await updateDoc(jobDocRef(db, companyId, jobId), updates);
  } catch (error) {
    console.warn(`Could not add purchased item ${purchasedItemId} to job ${jobId}`, error);
  }
};

export const buildShoppingPurchaseSyncPayloads = ({
  shoppingItem = {},
  purchasedItem = {},
  shoppingItemId = "",
  purchasedItemId = "",
  invoiced,
  preferPurchasedContext = false,
  jobData = {},
} = {}) => {
  const linkedJobIsInvoiced = jobBillingIsInvoiced(jobData);
  const nextInvoiced =
    linkedJobIsInvoiced
      ? true
      : invoiced === undefined
      ? truthyBoolean(
          purchasedItem.invoiced,
          purchasedItem.jobInvoiced,
          shoppingItem.invoiced,
          isInvoicedValue(purchasedItem.invoiceStatus),
          isInvoicedValue(purchasedItem.jobBillingStatus),
          isInvoicedValue(shoppingItem.invoiceStatus),
          isInvoicedValue(shoppingItem.status),
          isInvoicedValue(jobData.billingStatus),
          isInvoicedValue(jobData.invoiceStatus),
          isInvoicedValue(jobData.status)
        )
      : Boolean(invoiced);

  const jobId = firstString(linkedJobIdFrom(shoppingItem, purchasedItem, preferPurchasedContext), jobData.id);
  const jobName = preferPurchasedContext
    ? firstString(purchasedItem.jobName, purchasedItem.jobInternalId, shoppingItem.jobName, shoppingItem.jobInternalId, jobData.jobName, jobData.internalId)
    : firstString(shoppingItem.jobName, shoppingItem.jobInternalId, purchasedItem.jobName, purchasedItem.jobInternalId, jobData.jobName, jobData.internalId);
  const customerId = preferPurchasedContext
    ? firstString(purchasedItem.customerId, purchasedItem.customerID, shoppingItem.customerId, shoppingItem.customerID, jobData.customerId, jobData.customerID)
    : firstString(shoppingItem.customerId, shoppingItem.customerID, purchasedItem.customerId, purchasedItem.customerID, jobData.customerId, jobData.customerID);
  const customerName = preferPurchasedContext
    ? firstString(purchasedItem.customerName, shoppingItem.customerName, jobData.customerName)
    : firstString(shoppingItem.customerName, purchasedItem.customerName, jobData.customerName);
  const serviceLocationId = preferPurchasedContext
    ? firstString(purchasedItem.serviceLocationId, shoppingItem.serviceLocationId, jobData.serviceLocationId)
    : firstString(shoppingItem.serviceLocationId, purchasedItem.serviceLocationId, jobData.serviceLocationId);
  const serviceLocationName = preferPurchasedContext
    ? firstString(purchasedItem.serviceLocationName, shoppingItem.serviceLocationName, jobData.serviceLocationName)
    : firstString(shoppingItem.serviceLocationName, purchasedItem.serviceLocationName, jobData.serviceLocationName);
  const serviceLocationAddress = preferPurchasedContext
    ? firstString(purchasedItem.serviceLocationAddress, shoppingItem.serviceLocationAddress, jobData.serviceLocationAddress)
    : firstString(shoppingItem.serviceLocationAddress, purchasedItem.serviceLocationAddress, jobData.serviceLocationAddress);
  const databaseItemId = preferPurchasedContext
    ? firstString(purchasedItem.itemId, purchasedItem.dbItemId, shoppingItem.dbItemId, shoppingItem.itemId, shoppingItem.genericItemId)
    : firstString(shoppingItem.dbItemId, shoppingItem.itemId, shoppingItem.genericItemId, purchasedItem.itemId, purchasedItem.dbItemId);
  const databaseItemName = preferPurchasedContext
    ? firstString(purchasedItem.dbItemName, shoppingItem.dbItemName, shoppingItem.itemName)
    : firstString(shoppingItem.dbItemName, shoppingItem.itemName, purchasedItem.dbItemName);
  const invoiceId = firstString(
    purchasedItem.invoiceRef,
    purchasedItem.invoiceId,
    purchasedItem.salesInvoiceId,
    shoppingItem.invoiceRef,
    shoppingItem.invoiceId,
    shoppingItem.salesInvoiceId,
    jobData.invoiceRef,
    jobData.invoiceId,
    jobData.salesInvoiceId
  );
  const invoiceType = firstString(
    purchasedItem.invoiceType,
    shoppingItem.invoiceType,
    jobData.invoiceType,
    invoiceId ? "job" : ""
  );
  const nonInvoicedJobBillingStatus = isInvoicedValue(purchasedItem.jobBillingStatus)
    ? "handledByJob"
    : purchasedItem.jobBillingStatus || "handledByJob";
  const existingShoppingStatus = shoppingItem.status || "";
  const existingShoppingStatusIsInvoiced = isInvoicedValue(existingShoppingStatus);
  const linkedShoppingStatus =
    nextInvoiced
      ? SHOPPING_LIST_INVOICED_STATUS
      : existingShoppingStatusIsInvoiced
        ? purchasedItemId ? "Purchased" : ""
        : isShoppingListStatusClosed(existingShoppingStatus)
        ? existingShoppingStatus
        : purchasedItemId
          ? "Purchased"
          : existingShoppingStatus;

  const purchasePayload = {
    shoppingListItemId: shoppingItemId,
    invoiced: nextInvoiced,
    invoiceStatus: nextInvoiced ? "Invoiced" : "",
    status: nextInvoiced ? "Invoiced" : jobId ? "Connected to Job" : purchasedItem.status || "",
  };

  if (jobId) {
    purchasePayload.jobId = jobId;
    purchasePayload.workOrderId = jobId;
    purchasePayload.assignedJobId = jobId;
    purchasePayload.assignedToJob = true;
    purchasePayload.assignmentStatus = "assignedToJob";
    purchasePayload.billingOwner = "job";
    purchasePayload.jobBillingStatus = nextInvoiced ? "invoiced" : nonInvoicedJobBillingStatus;
    purchasePayload.jobBillable = Boolean(purchasedItem.jobBillable ?? purchasedItem.billable);
    purchasePayload.jobBillingRate = purchasedItem.jobBillingRate || purchasedItem.billingRate || purchasedItem.price || 0;
  } else if (purchasePayload.billingOwner !== "job") {
    purchasePayload.billingOwner = purchasedItem.billingOwner || "purchasedItem";
  }

  if (jobName) {
    purchasePayload.jobName = jobName;
    purchasePayload.jobInternalId = jobName;
  }

  if (customerId || customerName) {
    purchasePayload.customerId = customerId;
    purchasePayload.customerName = customerName;
  }

  if (serviceLocationId) purchasePayload.serviceLocationId = serviceLocationId;
  if (serviceLocationName) purchasePayload.serviceLocationName = serviceLocationName;
  if (serviceLocationAddress) purchasePayload.serviceLocationAddress = serviceLocationAddress;
  if (databaseItemId && !purchasedItem.itemId) purchasePayload.itemId = databaseItemId;

  if (nextInvoiced) {
    purchasePayload.invoiceId = invoiceId;
    purchasePayload.invoiceRef = invoiceId;
    purchasePayload.invoiceType = invoiceType || "job";
  }

  const shoppingPayload = {
    purchasedItem: purchasedItemId,
    invoiced: nextInvoiced,
    invoiceStatus: nextInvoiced ? "Invoiced" : "",
    status: linkedShoppingStatus,
    needsAction: shoppingItemNeedsAction(linkedShoppingStatus),
  };

  if (jobId) {
    shoppingPayload.category = "Job";
    shoppingPayload.jobId = jobId;
    shoppingPayload.jobName = jobName || shoppingItem.jobName || purchasedItem.jobName || "";
  } else if (customerId && !shoppingItem.category) {
    shoppingPayload.category = "Customer";
  }

  if (customerId || customerName) {
    shoppingPayload.customerId = customerId;
    shoppingPayload.customerName = customerName;
  }

  if (serviceLocationId) shoppingPayload.serviceLocationId = serviceLocationId;
  if (serviceLocationName) shoppingPayload.serviceLocationName = serviceLocationName;
  if (serviceLocationAddress) shoppingPayload.serviceLocationAddress = serviceLocationAddress;
  if (databaseItemId && !shoppingItem.dbItemId) shoppingPayload.dbItemId = databaseItemId;
  if (databaseItemId && !shoppingItem.itemId) shoppingPayload.itemId = databaseItemId;
  if (databaseItemName && !shoppingItem.dbItemName) shoppingPayload.dbItemName = databaseItemName;
  if (!shoppingItem.name && purchasedItem.name) shoppingPayload.name = purchasedItem.name;

  if (nextInvoiced) {
    shoppingPayload.invoiceId = invoiceId;
    shoppingPayload.invoiceRef = invoiceId;
    shoppingPayload.invoiceType = invoiceType || "job";
  }

  return {
    purchasePayload,
    shoppingPayload,
  };
};

export const syncLinkedShoppingPurchase = async ({
  db,
  companyId,
  shoppingItemId = "",
  purchasedItemId = "",
  shoppingCollectionName = "shoppingList",
  shoppingItemData = null,
  purchasedItemData = null,
  previousShoppingItemId = "",
  previousPurchasedItemId = "",
  invoiced,
  preferPurchasedContext = false,
} = {}) => {
  if (!db || !companyId) return { purchasePayload: {}, shoppingPayload: {} };

  let resolvedShoppingItemId = cleanString(shoppingItemId);
  let resolvedPurchasedItemId = cleanString(purchasedItemId);
  let shoppingItem = shoppingItemData || null;
  let purchasedItem = purchasedItemData || null;

  if (!purchasedItem && resolvedPurchasedItemId) {
    purchasedItem = await safeGetDocData(purchaseDocRef(db, companyId, resolvedPurchasedItemId));
  }

  if (!shoppingItem && resolvedShoppingItemId) {
    shoppingItem = await safeGetDocData(shoppingDocRef(db, companyId, resolvedShoppingItemId, shoppingCollectionName));
  }

  if (!resolvedShoppingItemId && purchasedItem?.shoppingListItemId) {
    resolvedShoppingItemId = cleanString(purchasedItem.shoppingListItemId);
    shoppingItem = await safeGetDocData(shoppingDocRef(db, companyId, resolvedShoppingItemId, shoppingCollectionName));
  }

  if (!resolvedPurchasedItemId && shoppingItem?.purchasedItem) {
    resolvedPurchasedItemId = cleanString(shoppingItem.purchasedItem);
    purchasedItem = await safeGetDocData(purchaseDocRef(db, companyId, resolvedPurchasedItemId));
  }

  const now = Timestamp.now();
  const linkedJobId = linkedJobIdFrom(shoppingItem || {}, purchasedItem || {}, preferPurchasedContext);
  const linkedJob = linkedJobId ? await safeGetDocData(jobDocRef(db, companyId, linkedJobId)) : null;
  const effectiveInvoiced = jobBillingIsInvoiced(linkedJob || {}) ? true : invoiced;

  if (previousPurchasedItemId && previousPurchasedItemId !== resolvedPurchasedItemId) {
    const previousPurchaseRef = purchaseDocRef(db, companyId, previousPurchasedItemId);
    const previousPurchase = await safeGetDocData(previousPurchaseRef);
    if (previousPurchase) {
      await updateDoc(previousPurchaseRef, {
        shoppingListItemId: "",
        updatedAt: now,
      });
    }
  }

  if (previousShoppingItemId && previousShoppingItemId !== resolvedShoppingItemId) {
    const previousShoppingRef = shoppingDocRef(db, companyId, previousShoppingItemId, shoppingCollectionName);
    const previousShopping = await safeGetDocData(previousShoppingRef);
    if (previousShopping) {
      await updateDoc(previousShoppingRef, {
        purchasedItem: "",
        updatedAt: now,
      });
    }
  }

  if ((!resolvedShoppingItemId || !shoppingItem) && resolvedPurchasedItemId && purchasedItem && effectiveInvoiced !== undefined) {
    const nextInvoiced = Boolean(effectiveInvoiced);
    const purchaseJobId = firstString(linkedJobId, purchasedItem.jobId, purchasedItem.workOrderId, purchasedItem.assignedJobId);
    const invoiceId = firstString(
      purchasedItem.invoiceRef,
      purchasedItem.invoiceId,
      purchasedItem.salesInvoiceId,
      linkedJob?.invoiceRef,
      linkedJob?.invoiceId,
      linkedJob?.salesInvoiceId
    );
    const invoiceType = firstString(purchasedItem.invoiceType, linkedJob?.invoiceType, invoiceId ? "job" : "");
    await updateDoc(purchaseDocRef(db, companyId, resolvedPurchasedItemId), {
      invoiced: nextInvoiced,
      invoiceStatus: nextInvoiced ? "Invoiced" : "",
      status: nextInvoiced
        ? "Invoiced"
        : purchasedItem.jobId || purchasedItem.workOrderId || purchasedItem.assignedJobId
          ? "Connected to Job"
          : purchasedItem.status || "",
      jobBillingStatus:
        purchaseJobId
          ? nextInvoiced
            ? "invoiced"
            : isInvoicedValue(purchasedItem.jobBillingStatus)
              ? "handledByJob"
              : purchasedItem.jobBillingStatus || "handledByJob"
          : purchasedItem.jobBillingStatus || "",
      updatedAt: now,
      ...(nextInvoiced ? {
        invoicedAt: purchasedItem.invoicedAt || now,
        ...(purchaseJobId ? { jobInvoicedAt: purchasedItem.jobInvoicedAt || now } : {}),
        invoiceId,
        invoiceRef: invoiceId,
        invoiceType: invoiceType || "job",
      } : {}),
    });

    if (purchaseJobId) {
      await addPurchasedItemToJob({
        db,
        companyId,
        jobId: purchaseJobId,
        purchasedItemId: resolvedPurchasedItemId,
        shoppingItemId: resolvedShoppingItemId,
        now,
      });
    }

    return {
      purchasePayload: {
        invoiced: nextInvoiced,
        invoiceStatus: nextInvoiced ? "Invoiced" : "",
        status: nextInvoiced
          ? "Invoiced"
          : purchasedItem.jobId || purchasedItem.workOrderId || purchasedItem.assignedJobId
            ? "Connected to Job"
            : purchasedItem.status || "",
      },
      shoppingPayload: {},
      shoppingItemId: resolvedShoppingItemId,
      purchasedItemId: resolvedPurchasedItemId,
    };
  }

  if ((!resolvedPurchasedItemId || !purchasedItem) && resolvedShoppingItemId && shoppingItem && effectiveInvoiced !== undefined) {
    const nextInvoiced = Boolean(effectiveInvoiced);
    const nextStatus = nextInvoiced
      ? SHOPPING_LIST_INVOICED_STATUS
      : normalizeStatus(shoppingItem.status) === "invoiced"
        ? "Purchased"
        : shoppingItem.status || "";

    await updateDoc(shoppingDocRef(db, companyId, resolvedShoppingItemId, shoppingCollectionName), {
      invoiced: nextInvoiced,
      invoiceStatus: nextInvoiced ? "Invoiced" : "",
      status: nextStatus,
      needsAction: shoppingItemNeedsAction(nextStatus),
      updatedAt: now,
      ...(nextInvoiced ? {
        invoicedAt: shoppingItem.invoicedAt || now,
        invoiceId: firstString(shoppingItem.invoiceRef, shoppingItem.invoiceId, shoppingItem.salesInvoiceId, linkedJob?.invoiceRef, linkedJob?.invoiceId, linkedJob?.salesInvoiceId),
        invoiceRef: firstString(shoppingItem.invoiceRef, shoppingItem.invoiceId, shoppingItem.salesInvoiceId, linkedJob?.invoiceRef, linkedJob?.invoiceId, linkedJob?.salesInvoiceId),
        invoiceType: firstString(shoppingItem.invoiceType, linkedJob?.invoiceType, "job"),
      } : {}),
    });

    return {
      purchasePayload: {},
      shoppingPayload: {
        invoiced: nextInvoiced,
        invoiceStatus: nextInvoiced ? "Invoiced" : "",
        status: nextStatus,
        needsAction: shoppingItemNeedsAction(nextStatus),
      },
      shoppingItemId: resolvedShoppingItemId,
      purchasedItemId: resolvedPurchasedItemId,
    };
  }

  if (!resolvedShoppingItemId || !resolvedPurchasedItemId || !shoppingItem || !purchasedItem) {
    return { purchasePayload: {}, shoppingPayload: {} };
  }

  const { purchasePayload, shoppingPayload } = buildShoppingPurchaseSyncPayloads({
    shoppingItem,
    purchasedItem,
    shoppingItemId: resolvedShoppingItemId,
    purchasedItemId: resolvedPurchasedItemId,
    invoiced: effectiveInvoiced,
    preferPurchasedContext,
    jobData: linkedJob || {},
  });

  await updateDoc(purchaseDocRef(db, companyId, resolvedPurchasedItemId), {
    ...purchasePayload,
    updatedAt: now,
    ...(purchasePayload.invoiced ? { invoicedAt: purchasedItem.invoicedAt || now } : {}),
  });

  await updateDoc(shoppingDocRef(db, companyId, resolvedShoppingItemId, shoppingCollectionName), {
    ...shoppingPayload,
    updatedAt: now,
    ...(shoppingPayload.invoiced ? { invoicedAt: shoppingItem.invoicedAt || now } : {}),
  });

  if (purchasePayload.jobId) {
    await addPurchasedItemToJob({
      db,
      companyId,
      jobId: purchasePayload.jobId,
      purchasedItemId: resolvedPurchasedItemId,
      shoppingItemId: resolvedShoppingItemId,
      now,
    });
  }

  return {
    purchasePayload,
    shoppingPayload,
    shoppingItemId: resolvedShoppingItemId,
    purchasedItemId: resolvedPurchasedItemId,
  };
};
