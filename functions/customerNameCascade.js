const functions1 = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const MAX_WRITES_PER_BATCH = 450;

const salesCollectionNames = {
  billingProfiles: "salesBillingProfiles",
  agreements: "salesAgreements",
  billingSubscriptions: "salesBillingSubscriptions",
  invoices: "salesInvoices",
  payments: "salesPayments",
  paymentEvents: "salesPaymentEvents",
};

const defaultNameFields = ["customerName"];

const companyCustomerNameTargets = [
  { collectionName: "serviceLocations", label: "Service locations" },
  { collectionName: "bodiesOfWater", label: "Bodies of water" },
  { collectionName: "equipment", label: "Equipment" },
  { collectionName: "serviceStops", label: "Future service stops", shouldUpdate: shouldUpdateFutureOrOpenServiceStop },
  { collectionName: "stopData", label: "Stop data" },
  { collectionName: "recurringServiceStop", label: "Recurring service stops" },
  { collectionName: "workOrders", label: "Jobs" },
  { collectionName: "repairRequests", label: "Repair requests" },
  { collectionName: "suggestedWork", label: "Suggested work" },
  { collectionName: "workOffers", label: "Work offers" },
  { collectionName: "purchasedItems", label: "Purchased items" },
  { collectionName: "shoppingList", label: "Shopping list items" },
  { collectionName: "customerPipeline", label: "Customer pipeline rows" },
].map((target) => ({
  ...target,
  scope: "company",
  field: "customerId",
  nameFields: target.nameFields || defaultNameFields,
}));

const rootCustomerNameTargets = [
  { collectionName: "homeownerRepairRequests", companyField: "companyId", label: "Homeowner repair requests" },
  { collectionName: "homeownerServiceRequests", companyField: "companyId", label: "Homeowner service requests" },
  { collectionName: "linkedInvite", companyField: "companyId", label: "Customer account invites" },
  { collectionName: "customerPartApprovals", companyField: "companyId", label: "Part approvals" },
  { collectionName: "contracts", companyField: "companyId", label: "Legacy contracts" },
  { collectionName: salesCollectionNames.billingProfiles, companyField: "companyId", label: "Billing profiles" },
  { collectionName: salesCollectionNames.agreements, companyField: "companyId", label: "Sales agreements" },
  {
    collectionName: salesCollectionNames.billingSubscriptions,
    companyField: "companyId",
    label: "Billing subscriptions",
    optionalNameFields: ["agreementSnapshot.customerName"],
  },
  { collectionName: salesCollectionNames.invoices, companyField: "companyId", label: "Sales invoices" },
  { collectionName: salesCollectionNames.payments, companyField: "companyId", label: "Sales payments" },
  { collectionName: salesCollectionNames.paymentEvents, companyField: "companyId", label: "Sales payment events" },
  { collectionName: "chats", companyField: "companyId", label: "Customer chats" },
  { collectionName: "chats", companyField: "publicToCompanyId", label: "Customer chats" },
].map((target) => ({
  ...target,
  scope: "root",
  field: "customerId",
  nameFields: target.nameFields || defaultNameFields,
}));

const otherReferenceNameTargets = [
  {
    scope: "root",
    collectionName: "customerCompanyRelationships",
    companyField: "companyId",
    field: "companyCustomerId",
    label: "Customer account relationships",
    nameFields: ["companyCustomerName"],
  },
  {
    scope: "root",
    collectionName: "homeownerServiceLocations",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner service locations",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "homeownerBodiesOfWater",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner bodies of water",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "homeownerEquipment",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner equipment",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "homeownerServiceStops",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner service stops",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "homeownerStopData",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner stop data",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "stopData",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Linked homeowner stop data",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "homeownerServiceRequests",
    companyField: "companyId",
    field: "companyCustomerId",
    label: "Linked homeowner service requests",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "recurringContracts",
    companyField: "companyId",
    field: "customerId",
    label: "Recurring contracts",
    nameFields: ["customerName"],
  },
  {
    scope: "root",
    collectionName: "recurringContracts",
    companyField: "senderId",
    field: "receiverId",
    label: "Recurring contract recipients",
    nameFields: ["receiverName", "internalCustomerName", "customerName"],
  },
  {
    scope: "root",
    collectionName: "contracts",
    companyField: "senderId",
    field: "receiverId",
    label: "Legacy estimate recipients",
    nameFields: ["receiverName", "internalCustomerName", "customerName"],
  },
  {
    scope: "company",
    collectionName: "toDos",
    field: "linkedCustomerId",
    label: "Legacy to-dos",
    nameFields: ["customerName", "linkedCustomerName"],
  },
  {
    scope: "company",
    collectionName: "todoItems",
    field: "relatedEntity.id",
    label: "Customer todo links",
    shouldUpdate: (data) => data.relatedEntity?.type === "customer",
    buildPayload: ({ data, customerName }) => ({
      relatedEntity: {
        ...(data.relatedEntity || {}),
        label: customerName,
      },
      updatedAt: FieldValue.serverTimestamp(),
      customerNameCascadeUpdatedAt: FieldValue.serverTimestamp(),
    }),
  },
  {
    scope: "company",
    collectionName: "alerts",
    field: "relatedEntity.id",
    label: "Customer alert links",
    shouldUpdate: (data) => data.relatedEntity?.type === "customer",
    buildPayload: ({ data, customerName }) => {
      const payload = {
        relatedEntity: {
          ...(data.relatedEntity || {}),
          label: customerName,
        },
        updatedAt: FieldValue.serverTimestamp(),
        customerNameCascadeUpdatedAt: FieldValue.serverTimestamp(),
      };

      if (data.itemName) {
        payload.itemName = customerName;
      }

      return payload;
    },
  },
];

const nameReferenceTargets = [
  ...companyCustomerNameTargets,
  ...rootCustomerNameTargets,
  ...otherReferenceNameTargets,
];

const routeArrayTargets = [
  { collectionName: "activeRoutes", arrayFields: ["order", "stops"] },
  { collectionName: "recurringRoutes", arrayFields: ["order", "recurringRouteOrder", "stops"] },
  { collectionName: "recurringRoute", arrayFields: ["order", "recurringRouteOrder", "stops"] },
];

const jobNameSubcollectionTargets = [
  {
    collectionName: "plans",
    label: "Job plans",
    nameFields: ["customerName"],
    arrayFields: ["plannedServiceStops", "shoppingItems"],
  },
  {
    collectionName: "solutions",
    label: "Job solutions",
    nameFields: ["customerName"],
    arrayFields: ["plannedServiceStops", "shoppingItems"],
  },
  {
    collectionName: "plannedServiceStops",
    label: "Job planned service stops",
    nameFields: ["customerName"],
  },
  {
    collectionName: "workOfferRefs",
    label: "Job work offer refs",
    nameFields: ["customerName"],
  },
];

const cleanString = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const comparableText = (value) => cleanString(value).toLowerCase();

const asBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return false;
};

const customerDisplayName = (customer = {}, fallbackId = "") => {
  const personName = [customer.firstName, customer.lastName]
    .map(cleanString)
    .filter(Boolean)
    .join(" ");

  if (asBoolean(customer.displayAsCompany)) {
    return (
      cleanString(customer.company || customer.companyName || customer.businessName) ||
      cleanString(customer.customerName || customer.displayName || customer.name) ||
      personName ||
      cleanString(customer.email) ||
      cleanString(fallbackId)
    );
  }

  return (
    personName ||
    cleanString(customer.customerName || customer.displayName || customer.name) ||
    cleanString(customer.company || customer.companyName || customer.businessName) ||
    cleanString(customer.email) ||
    cleanString(fallbackId)
  );
};

const isPlainObject = (value) => (
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  value.constructor === Object
);

const mergePlainObjects = (base = {}, next = {}) => {
  const merged = { ...base };

  Object.entries(next).forEach(([key, value]) => {
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = mergePlainObjects(merged[key], value);
    } else {
      merged[key] = value;
    }
  });

  return merged;
};

const setNestedValue = (target, path, value) => {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return;

  let current = target;
  parts.slice(0, -1).forEach((part) => {
    current[part] = isPlainObject(current[part]) ? current[part] : {};
    current = current[part];
  });

  current[parts[parts.length - 1]] = value;
};

const getNestedValue = (source, path) => {
  const parts = String(path || "").split(".").filter(Boolean);
  let current = source;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }

  return current;
};

const queueSet = (writes, ref, data) => {
  if (!ref?.path || !data || Object.keys(data).length === 0) return;

  const existing = writes.get(ref.path);
  writes.set(ref.path, {
    ref,
    data: existing ? mergePlainObjects(existing.data, data) : data,
  });
};

const collectionForTarget = (db, companyId, target) => {
  if (target.scope === "company") {
    return db.collection("companies").doc(companyId).collection(target.collectionName);
  }

  return db.collection(target.collectionName);
};

const queryTargetDocs = async (db, companyId, target, customerId) => {
  let targetQuery = collectionForTarget(db, companyId, target).where(target.field, "==", customerId);

  if (target.scope === "root" && target.companyField) {
    targetQuery = targetQuery.where(target.companyField, "==", companyId);
  }

  const snapshot = await targetQuery.get();
  const docs = target.shouldUpdate
    ? snapshot.docs.filter((snapshotDoc) => target.shouldUpdate(snapshotDoc.data() || {}))
    : snapshot.docs;

  return { target, docs };
};

const dateMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const firstDateMillis = (source = {}, fields = []) => {
  for (const field of fields) {
    const millis = dateMillis(source[field]);
    if (millis) return millis;
  }

  return 0;
};

const statusText = (data = {}) => [
  data.operationStatus,
  data.status,
  data.serviceStatus,
  data.billingStatus,
].filter(Boolean).join(" ").toLowerCase();

const isFinishedServiceStop = (data = {}) => {
  const normalizedStatus = statusText(data);
  return (
    normalizedStatus.includes("finished") ||
    normalizedStatus.includes("complete") ||
    normalizedStatus.includes("completed") ||
    Boolean(data.finishedAt || data.completedAt || data.endTime)
  );
};

function shouldUpdateFutureOrOpenServiceStop(data = {}) {
  const stopMillis = firstDateMillis(data, ["serviceDate", "date", "scheduledDate", "startDate"]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!stopMillis) return !isFinishedServiceStop(data);
  return stopMillis >= today.getTime() || !isFinishedServiceStop(data);
}

const buildNamePayload = (target, data = {}, customerName) => {
  if (target.buildPayload) {
    return target.buildPayload({ data, customerName });
  }

  const payload = {
    updatedAt: FieldValue.serverTimestamp(),
    customerNameCascadeUpdatedAt: FieldValue.serverTimestamp(),
  };

  (target.nameFields || defaultNameFields).forEach((field) => {
    setNestedValue(payload, field, customerName);
  });

  (target.optionalNameFields || []).forEach((field) => {
    if (getNestedValue(data, field) !== undefined) {
      setNestedValue(payload, field, customerName);
    }
  });

  return payload;
};

const docNeedsNamePatch = (data = {}, target, customerName) => {
  if (target.buildPayload) return true;

  const requiredFieldsChanged = (target.nameFields || defaultNameFields).some(
    (field) => cleanString(getNestedValue(data, field)) !== customerName
  );
  const optionalFieldsChanged = (target.optionalNameFields || []).some(
    (field) => getNestedValue(data, field) !== undefined && cleanString(getNestedValue(data, field)) !== customerName
  );

  return requiredFieldsChanged || optionalFieldsChanged;
};

const routeItemMatchesCustomer = (item = {}, customerId) => (
  cleanString(item.customerId || item.companyCustomerId || item.linkedCustomerId) === customerId
);

const updateCustomerNameInArray = ({
  arrayValue,
  customerId,
  customerName,
  assumeAllItemsBelongToCustomer = false,
}) => {
  if (!Array.isArray(arrayValue)) {
    return { changed: false, value: arrayValue };
  }

  let changed = false;
  const value = arrayValue.map((item) => {
    if (!isPlainObject(item)) return item;

    const hasCustomerName = Object.prototype.hasOwnProperty.call(item, "customerName");
    const shouldPatch = routeItemMatchesCustomer(item, customerId) ||
      (assumeAllItemsBelongToCustomer && hasCustomerName && !cleanString(item.customerId || item.companyCustomerId));

    if (!shouldPatch || item.customerName === customerName) return item;

    changed = true;
    return {
      ...item,
      customerName,
    };
  });

  return { changed, value };
};

const updateRouteArrayReferences = async ({ db, companyId, customerId, customerName, writes }) => {
  const counts = [];

  for (const target of routeArrayTargets) {
    const snapshot = await db.collection("companies").doc(companyId).collection(target.collectionName).get();
    let updated = 0;

    snapshot.docs.forEach((routeDoc) => {
      const data = routeDoc.data() || {};
      const payload = {};

      target.arrayFields.forEach((field) => {
        const result = updateCustomerNameInArray({
          arrayValue: data[field],
          customerId,
          customerName,
        });

        if (result.changed) {
          payload[field] = result.value;
        }
      });

      if (Object.keys(payload).length > 0) {
        payload.updatedAt = FieldValue.serverTimestamp();
        payload.customerNameCascadeUpdatedAt = FieldValue.serverTimestamp();
        queueSet(writes, routeDoc.ref, payload);
        updated += 1;
      }
    });

    if (updated > 0) {
      counts.push({ label: target.collectionName, count: updated });
    }
  }

  return counts;
};

const updateJobSubcollectionReferences = async ({ workOrderDocs, customerId, customerName, writes }) => {
  const counts = [];

  for (const target of jobNameSubcollectionTargets) {
    let updated = 0;

    for (const workOrderDoc of workOrderDocs) {
      const snapshot = await workOrderDoc.ref.collection(target.collectionName).get();

      snapshot.docs.forEach((subDoc) => {
        const data = subDoc.data() || {};
        const payload = {};

        (target.nameFields || defaultNameFields).forEach((field) => {
          if (cleanString(getNestedValue(data, field)) !== customerName) {
            setNestedValue(payload, field, customerName);
          }
        });

        (target.arrayFields || []).forEach((field) => {
          const result = updateCustomerNameInArray({
            arrayValue: data[field],
            customerId,
            customerName,
            assumeAllItemsBelongToCustomer: true,
          });

          if (result.changed) {
            payload[field] = result.value;
          }
        });

        if (Object.keys(payload).length > 0) {
          payload.updatedAt = FieldValue.serverTimestamp();
          payload.customerNameCascadeUpdatedAt = FieldValue.serverTimestamp();
          queueSet(writes, subDoc.ref, payload);
          updated += 1;
        }
      });
    }

    if (updated > 0) {
      counts.push({ label: target.label, count: updated });
    }
  }

  return counts;
};

const commitQueuedWrites = async (db, writes) => {
  const queuedWrites = Array.from(writes.values());
  let committedWrites = 0;

  for (let index = 0; index < queuedWrites.length; index += MAX_WRITES_PER_BATCH) {
    const batch = db.batch();
    const chunk = queuedWrites.slice(index, index + MAX_WRITES_PER_BATCH);

    chunk.forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });

    await batch.commit();
    committedWrites += chunk.length;
  }

  return committedWrites;
};

async function syncCustomerNameReferences({ db, companyId, customerId, customerName }) {
  if (!db || !companyId || !customerId || !customerName) {
    return { writeCount: 0, targetCounts: [] };
  }

  const writes = new Map();
  const targetResults = await Promise.all(
    nameReferenceTargets.map((target) => queryTargetDocs(db, companyId, target, customerId))
  );
  const targetCounts = [];
  let workOrderDocs = [];

  targetResults.forEach(({ target, docs }) => {
    let updated = 0;

    docs.forEach((snapshotDoc) => {
      const data = snapshotDoc.data() || {};
      if (!docNeedsNamePatch(data, target, customerName)) return;

      queueSet(writes, snapshotDoc.ref, buildNamePayload(target, data, customerName));
      updated += 1;
    });

    if (target.scope === "company" && target.collectionName === "workOrders") {
      workOrderDocs = docs;
    }

    if (updated > 0) {
      targetCounts.push({ label: target.label, count: updated });
    }
  });

  targetCounts.push(
    ...(await updateRouteArrayReferences({ db, companyId, customerId, customerName, writes })),
    ...(await updateJobSubcollectionReferences({ workOrderDocs, customerId, customerName, writes }))
  );

  const writeCount = await commitQueuedWrites(db, writes);

  return {
    writeCount,
    targetCounts,
  };
}

exports.syncCustomerNameReferencesOnCustomerUpdate = functions1.firestore
  .document("companies/{companyId}/customers/{customerId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const companyId = context.params.companyId;
    const customerId = context.params.customerId;
    const previousName = customerDisplayName(before, customerId);
    const nextName = customerDisplayName(after, customerId);

    if (!nextName || comparableText(previousName) === comparableText(nextName)) {
      return null;
    }

    const db = getFirestore();

    try {
      const result = await syncCustomerNameReferences({
        db,
        companyId,
        customerId,
        customerName: nextName,
      });

      console.log("[syncCustomerNameReferencesOnCustomerUpdate] Synced customer name references", {
        companyId,
        customerId,
        previousName,
        nextName,
        writeCount: result.writeCount,
        targetCounts: result.targetCounts,
      });

      return result;
    } catch (error) {
      console.error("[syncCustomerNameReferencesOnCustomerUpdate] Failed to sync customer name references", {
        companyId,
        customerId,
        previousName,
        nextName,
        error,
      });
      throw error;
    }
  });

exports._private = {
  customerDisplayName,
  shouldUpdateFutureOrOpenServiceStop,
  syncCustomerNameReferences,
  updateCustomerNameInArray,
};
