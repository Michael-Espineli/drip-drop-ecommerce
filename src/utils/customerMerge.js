import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { buildCustomerDuplicateKeys, getCustomerDuplicateDisplayName } from "./customerDuplicates";
import { salesCollectionNames } from "./models/Sales";

const MAX_WRITES_PER_BATCH = 450;

const customerIdTargets = [
  { scope: "company", collectionName: "serviceLocations", label: "Service locations" },
  { scope: "company", collectionName: "bodiesOfWater", label: "Bodies of water" },
  { scope: "company", collectionName: "equipment", label: "Equipment" },
  { scope: "company", collectionName: "serviceStops", label: "Service stops" },
  { scope: "company", collectionName: "stopData", label: "Stop data" },
  { scope: "company", collectionName: "recurringServiceStop", label: "Recurring service stops" },
  { scope: "company", collectionName: "workOrders", label: "Jobs" },
  { scope: "company", collectionName: "repairRequests", label: "Repair requests" },
  { scope: "company", collectionName: "purchasedItems", label: "Purchased items" },
  { scope: "company", collectionName: "shoppingList", label: "Shopping list items" },
  { scope: "root", collectionName: "homeownerRepairRequests", companyField: "companyId", label: "Homeowner repair requests" },
  { scope: "root", collectionName: "homeownerServiceRequests", companyField: "companyId", label: "Homeowner service requests" },
  { scope: "root", collectionName: "linkedInvite", companyField: "companyId", label: "Customer account invites" },
  { scope: "root", collectionName: "customerPartApprovals", companyField: "companyId", label: "Part approvals" },
  { scope: "root", collectionName: "contracts", companyField: "companyId", label: "Legacy contracts" },
  { scope: "root", collectionName: salesCollectionNames.billingProfiles, companyField: "companyId", label: "Billing profiles" },
  { scope: "root", collectionName: salesCollectionNames.agreements, companyField: "companyId", label: "Sales agreements" },
  { scope: "root", collectionName: salesCollectionNames.billingSubscriptions, companyField: "companyId", label: "Billing subscriptions" },
  { scope: "root", collectionName: salesCollectionNames.invoices, companyField: "companyId", label: "Sales invoices" },
  { scope: "root", collectionName: salesCollectionNames.payments, companyField: "companyId", label: "Sales payments" },
].map((target) => ({ ...target, field: "customerId" }));

const otherReferenceTargets = [
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
    collectionName: "recurringContracts",
    companyField: "senderId",
    field: "receiverId",
    label: "Recurring contracts",
    nameFields: ["receiverName", "internalCustomerName", "customerName"],
  },
  {
    scope: "company",
    collectionName: "todoItems",
    field: "relatedEntity.id",
    label: "Customer todo links",
    shouldUpdate: (data) => data.relatedEntity?.type === "customer",
    buildPayload: ({ data, primaryCustomerId, primaryCustomerName, duplicateCustomerId, mergeId }) => ({
      relatedEntity: {
        ...(data.relatedEntity || {}),
        id: primaryCustomerId,
        label: primaryCustomerName,
      },
      mergedFromCustomerId: duplicateCustomerId,
      customerMergeId: mergeId,
      updatedAt: serverTimestamp(),
    }),
  },
  {
    scope: "company",
    collectionName: "alerts",
    field: "relatedEntity.id",
    label: "Customer alert links",
    shouldUpdate: (data) => data.relatedEntity?.type === "customer",
    buildPayload: ({ data, primaryCustomerId, primaryCustomerName, duplicateCustomerId, mergeId }) => ({
      relatedEntity: {
        ...(data.relatedEntity || {}),
        id: primaryCustomerId,
        label: primaryCustomerName,
      },
      mergedFromCustomerId: duplicateCustomerId,
      customerMergeId: mergeId,
      updatedAt: serverTimestamp(),
    }),
  },
];

const referenceTargets = [...customerIdTargets, ...otherReferenceTargets];

const cleanString = (value) => String(value ?? "").trim();

const uniqueStrings = (values = []) => {
  const seen = new Set();

  return values
    .map(cleanString)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const hasAddress = (address = {}) =>
  Boolean(cleanString(address.streetAddress ?? address.address) || cleanString(address.city) || cleanString(address.zip ?? address.zipCode));

const createBatchWriter = (db) => {
  let batch = writeBatch(db);
  let writeCount = 0;
  let committedWrites = 0;

  const commitIfNeeded = async () => {
    if (writeCount < MAX_WRITES_PER_BATCH) return;
    await batch.commit();
    committedWrites += writeCount;
    batch = writeBatch(db);
    writeCount = 0;
  };

  const addWrite = async (operation) => {
    operation(batch);
    writeCount += 1;
    await commitIfNeeded();
  };

  return {
    set: (ref, data, options) => addWrite((currentBatch) => currentBatch.set(ref, data, options)),
    delete: (ref) => addWrite((currentBatch) => currentBatch.delete(ref)),
    commit: async () => {
      if (writeCount > 0) {
        await batch.commit();
        committedWrites += writeCount;
        writeCount = 0;
      }
      return committedWrites;
    },
  };
};

const collectionForTarget = (db, companyId, target) => {
  if (target.scope === "company") {
    return collection(db, "companies", companyId, target.collectionName);
  }

  return collection(db, target.collectionName);
};

const queryTargetDocs = async (db, companyId, target, duplicateCustomerId) => {
  const constraints = [where(target.field, "==", duplicateCustomerId)];
  if (target.scope === "root" && target.companyField) {
    constraints.unshift(where(target.companyField, "==", companyId));
  }

  const snapshot = await getDocs(query(collectionForTarget(db, companyId, target), ...constraints));
  const docs = target.shouldUpdate
    ? snapshot.docs.filter((snapshotDoc) => target.shouldUpdate(snapshotDoc.data() || {}))
    : snapshot.docs;

  return {
    target,
    docs,
  };
};

const getCustomerContacts = (db, companyId, customerId) =>
  getDocs(collection(db, "companies", companyId, "customers", customerId, "contacts"));

const getMergeReferenceDocs = async (db, companyId, duplicateCustomerId) =>
  Promise.all(referenceTargets.map((target) => queryTargetDocs(db, companyId, target, duplicateCustomerId)));

const buildReferencePayload = ({
  target,
  data,
  primaryCustomerId,
  primaryCustomerName,
  duplicateCustomerId,
  mergeId,
}) => {
  if (target.buildPayload) {
    return target.buildPayload({
      data,
      primaryCustomerId,
      primaryCustomerName,
      duplicateCustomerId,
      mergeId,
    });
  }

  const payload = {
    [target.field]: primaryCustomerId,
    mergedFromCustomerId: duplicateCustomerId,
    customerMergeId: mergeId,
    updatedAt: serverTimestamp(),
  };

  if (target.field === "customerId" || Object.prototype.hasOwnProperty.call(data, "customerName")) {
    payload.customerName = primaryCustomerName;
  }

  (target.nameFields || []).forEach((field) => {
    payload[field] = primaryCustomerName;
  });

  return payload;
};

const buildMergedBillingNotes = (primaryCustomer = {}, duplicateCustomer = {}, duplicateCustomerName = "") => {
  const primaryNotes = cleanString(primaryCustomer.billingNotes);
  const duplicateNotes = cleanString(duplicateCustomer.billingNotes);
  if (!duplicateNotes || duplicateNotes === primaryNotes) return primaryNotes;

  return uniqueStrings([
    primaryNotes,
    `Merged from ${duplicateCustomerName || duplicateCustomer.id}: ${duplicateNotes}`,
  ]).join("\n\n");
};

const buildPrimaryCustomerPayload = (primaryCustomer = {}, duplicateCustomer = {}, mergeId = "") => {
  const duplicateCustomerName = getCustomerDuplicateDisplayName(duplicateCustomer);
  const payload = {
    tags: uniqueStrings([...(primaryCustomer.tags || []), ...(duplicateCustomer.tags || [])]),
    duplicateKeys: uniqueStrings([
      ...(primaryCustomer.duplicateKeys || []),
      ...(duplicateCustomer.duplicateKeys || []),
      ...buildCustomerDuplicateKeys(primaryCustomer),
      ...buildCustomerDuplicateKeys(duplicateCustomer),
    ]),
    mergedCustomerIds: uniqueStrings([
      ...(primaryCustomer.mergedCustomerIds || []),
      ...(duplicateCustomer.mergedCustomerIds || []),
      duplicateCustomer.id,
    ]),
    mergeHistory: [
      ...(Array.isArray(primaryCustomer.mergeHistory) ? primaryCustomer.mergeHistory : []),
      {
        mergeId,
        mergedCustomerId: duplicateCustomer.id,
        mergedCustomerName: duplicateCustomerName,
        mergedAt: new Date().toISOString(),
      },
    ],
    billingNotes: buildMergedBillingNotes(primaryCustomer, duplicateCustomer, duplicateCustomerName),
    active: primaryCustomer.active !== false || duplicateCustomer.active === true,
    isActive: primaryCustomer.isActive !== false || duplicateCustomer.isActive === true,
    lastMergedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  [
    "firstName",
    "lastName",
    "email",
    "phoneNumber",
    "phoneLabel",
    "company",
    "linkedCustomerUserId",
    "linkedHomeownerUserId",
    "relationshipId",
    "customerCompanyRelationshipId",
    "linkedStatus",
    "linkedEmail",
    "linkedInviteId",
  ].forEach((field) => {
    if (!cleanString(primaryCustomer[field]) && cleanString(duplicateCustomer[field])) {
      payload[field] = duplicateCustomer[field];
    }
  });

  if (!hasAddress(primaryCustomer.billingAddress) && hasAddress(duplicateCustomer.billingAddress)) {
    payload.billingAddress = duplicateCustomer.billingAddress;
  }

  if (!primaryCustomer.linkedAt && duplicateCustomer.linkedAt) {
    payload.linkedAt = duplicateCustomer.linkedAt;
  }

  if (!primaryCustomer.displayAsCompany && duplicateCustomer.displayAsCompany && !cleanString(primaryCustomer.firstName)) {
    payload.displayAsCompany = true;
  }

  return payload;
};

export const previewCustomerMerge = async ({ db, companyId, duplicateCustomerId }) => {
  if (!db || !companyId || !duplicateCustomerId) {
    return { targets: [], contacts: 0, totalReferences: 0 };
  }

  const [targetResults, contactsSnapshot] = await Promise.all([
    getMergeReferenceDocs(db, companyId, duplicateCustomerId),
    getCustomerContacts(db, companyId, duplicateCustomerId),
  ]);
  const targets = targetResults
    .map(({ target, docs }) => ({
      label: target.label,
      collectionName: target.collectionName,
      count: docs.length,
    }))
    .filter((item) => item.count > 0);

  return {
    targets,
    contacts: contactsSnapshot.docs.length,
    totalReferences: targets.reduce((total, item) => total + item.count, 0),
  };
};

export const mergeDuplicateCustomers = async ({
  db,
  companyId,
  primaryCustomerId,
  duplicateCustomerId,
}) => {
  if (!db || !companyId || !primaryCustomerId || !duplicateCustomerId) {
    throw new Error("Select a primary and duplicate customer before merging.");
  }

  if (primaryCustomerId === duplicateCustomerId) {
    throw new Error("The primary and duplicate customer must be different records.");
  }

  const primaryRef = doc(db, "companies", companyId, "customers", primaryCustomerId);
  const duplicateRef = doc(db, "companies", companyId, "customers", duplicateCustomerId);
  const [primarySnapshot, duplicateSnapshot, targetResults, contactsSnapshot] = await Promise.all([
    getDoc(primaryRef),
    getDoc(duplicateRef),
    getMergeReferenceDocs(db, companyId, duplicateCustomerId),
    getCustomerContacts(db, companyId, duplicateCustomerId),
  ]);

  if (!primarySnapshot.exists()) {
    throw new Error("Primary customer no longer exists.");
  }

  if (!duplicateSnapshot.exists()) {
    throw new Error("Duplicate customer no longer exists.");
  }

  const primaryCustomer = { id: primarySnapshot.id, ...primarySnapshot.data() };
  const duplicateCustomer = { id: duplicateSnapshot.id, ...duplicateSnapshot.data() };
  const primaryCustomerName = getCustomerDuplicateDisplayName(primaryCustomer);
  const duplicateCustomerName = getCustomerDuplicateDisplayName(duplicateCustomer);
  const mergeId = `customer_merge_${Date.now().toString(36)}`;
  const writer = createBatchWriter(db);

  await writer.set(primaryRef, buildPrimaryCustomerPayload(primaryCustomer, duplicateCustomer, mergeId), { merge: true });

  for (const { target, docs } of targetResults) {
    for (const snapshot of docs) {
      await writer.set(
        snapshot.ref,
        buildReferencePayload({
          target,
          data: snapshot.data() || {},
          primaryCustomerId,
          primaryCustomerName,
          duplicateCustomerId,
          mergeId,
        }),
        { merge: true }
      );
    }
  }

  for (const contactSnapshot of contactsSnapshot.docs) {
    const contact = contactSnapshot.data() || {};
    const contactId = contact.id || contactSnapshot.id;
    await writer.set(
      doc(db, "companies", companyId, "customers", primaryCustomerId, "contacts", contactId),
      {
        ...contact,
        id: contactId,
        mergedFromCustomerId: duplicateCustomerId,
        customerMergeId: mergeId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await writer.delete(contactSnapshot.ref);
  }

  await writer.set(
    doc(db, "companies", companyId, "mergedCustomers", duplicateCustomerId),
    {
      ...duplicateCustomer,
      id: duplicateCustomerId,
      mergedIntoCustomerId: primaryCustomerId,
      mergedIntoCustomerName: primaryCustomerName,
      mergedCustomerName: duplicateCustomerName,
      customerMergeId: mergeId,
      mergedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await writer.delete(duplicateRef);

  const writeCount = await writer.commit();
  const targetCounts = targetResults
    .map(({ target, docs }) => ({ label: target.label, count: docs.length }))
    .filter((item) => item.count > 0);

  return {
    mergeId,
    writeCount,
    contacts: contactsSnapshot.docs.length,
    targets: targetCounts,
    totalReferences: targetCounts.reduce((total, item) => total + item.count, 0),
  };
};
