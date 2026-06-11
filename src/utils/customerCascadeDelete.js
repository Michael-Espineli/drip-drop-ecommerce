import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { salesCollectionNames } from "./models/Sales";

const MAX_WRITES_PER_BATCH = 450;

const companyCustomerTargets = [
  { collectionName: "serviceLocations", label: "Service locations" },
  { collectionName: "bodiesOfWater", label: "Bodies of water", subcollections: ["waterHistory"] },
  { collectionName: "equipment", label: "Equipment", subcollections: ["parts", "serviceHistory"] },
  { collectionName: "serviceStops", label: "Service stops", subcollections: ["tasks"] },
  { collectionName: "stopData", label: "Stop data" },
  { collectionName: "recurringServiceStop", label: "Recurring service stops", subcollections: ["tasks", "history"] },
  { collectionName: "workOrders", label: "Jobs", subcollections: ["history", "changeOrders", "tasks", "comments", "workOfferRefs", "plannedServiceStops"] },
  { collectionName: "repairRequests", label: "Repair requests" },
  { collectionName: "purchasedItems", label: "Purchased items" },
  { collectionName: "shoppingList", label: "Shopping list items" },
].map((target) => ({ ...target, scope: "company", field: "customerId" }));

const rootCustomerTargets = [
  { collectionName: "homeownerRepairRequests", companyField: "companyId", label: "Homeowner repair requests" },
  { collectionName: "homeownerServiceRequests", companyField: "companyId", label: "Homeowner service requests" },
  { collectionName: "linkedInvite", companyField: "companyId", label: "Customer account invites" },
  { collectionName: "customerPartApprovals", companyField: "companyId", label: "Part approvals" },
  { collectionName: "contracts", companyField: "companyId", label: "Legacy contracts" },
  { collectionName: salesCollectionNames.billingProfiles, companyField: "companyId", label: "Billing profiles" },
  { collectionName: salesCollectionNames.agreements, companyField: "companyId", label: "Sales agreements" },
  { collectionName: salesCollectionNames.billingSubscriptions, companyField: "companyId", label: "Billing subscriptions" },
  { collectionName: salesCollectionNames.invoices, companyField: "companyId", label: "Sales invoices" },
  { collectionName: salesCollectionNames.payments, companyField: "companyId", label: "Sales payments" },
  { collectionName: salesCollectionNames.paymentEvents, companyField: "companyId", label: "Sales payment events" },
].map((target) => ({ ...target, scope: "root", field: "customerId" }));

const otherReferenceTargets = [
  {
    scope: "root",
    collectionName: "customerCompanyRelationships",
    companyField: "companyId",
    field: "companyCustomerId",
    label: "Customer account relationships",
  },
  {
    scope: "root",
    collectionName: "homeownerServiceLocations",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner service locations",
  },
  {
    scope: "root",
    collectionName: "homeownerBodiesOfWater",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner bodies of water",
  },
  {
    scope: "root",
    collectionName: "homeownerEquipment",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner equipment",
  },
  {
    scope: "root",
    collectionName: "homeownerServiceStops",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner service stops",
  },
  {
    scope: "root",
    collectionName: "homeownerStopData",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Homeowner stop data",
  },
  {
    scope: "root",
    collectionName: "stopData",
    companyField: "linkedCompanyId",
    field: "linkedCompanyCustomerId",
    label: "Linked homeowner stop data",
  },
  {
    scope: "root",
    collectionName: "recurringContracts",
    companyField: "companyId",
    field: "customerId",
    label: "Recurring contracts",
  },
  {
    scope: "root",
    collectionName: "recurringContracts",
    companyField: "senderId",
    field: "receiverId",
    label: "Recurring contract recipients",
  },
  {
    scope: "root",
    collectionName: "contracts",
    companyField: "senderId",
    field: "receiverId",
    label: "Legacy estimate recipients",
  },
  {
    scope: "company",
    collectionName: "todoItems",
    field: "relatedEntity.id",
    label: "Customer todo links",
    shouldDelete: (data) => data.relatedEntity?.type === "customer",
  },
  {
    scope: "company",
    collectionName: "alerts",
    field: "relatedEntity.id",
    label: "Customer alert links",
    shouldDelete: (data) => data.relatedEntity?.type === "customer",
  },
  {
    scope: "company",
    collectionName: "toDos",
    field: "linkedCustomerId",
    label: "Legacy to-dos",
  },
];

const deleteTargets = [...companyCustomerTargets, ...rootCustomerTargets, ...otherReferenceTargets];

const createBatchWriter = (db) => {
  let batch = writeBatch(db);
  let writeCount = 0;
  let committedWrites = 0;
  const queuedPaths = new Set();
  const deletedPaths = new Set();

  const commitIfNeeded = async () => {
    if (writeCount < MAX_WRITES_PER_BATCH) return;
    await batch.commit();
    committedWrites += writeCount;
    batch = writeBatch(db);
    writeCount = 0;
    queuedPaths.clear();
  };

  const deleteRef = async (ref) => {
    if (!ref?.path || deletedPaths.has(ref.path)) return false;

    batch.delete(ref);
    queuedPaths.add(ref.path);
    deletedPaths.add(ref.path);
    writeCount += 1;
    await commitIfNeeded();
    return true;
  };

  return {
    delete: deleteRef,
    commit: async () => {
      if (writeCount > 0) {
        await batch.commit();
        committedWrites += writeCount;
        writeCount = 0;
        queuedPaths.clear();
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

const queryTargetDocs = async (db, companyId, target, customerId) => {
  const constraints = [where(target.field, "==", customerId)];
  if (target.scope === "root" && target.companyField) {
    constraints.unshift(where(target.companyField, "==", companyId));
  }

  const snapshot = await getDocs(query(collectionForTarget(db, companyId, target), ...constraints));
  const docs = target.shouldDelete
    ? snapshot.docs.filter((snapshotDoc) => target.shouldDelete(snapshotDoc.data() || {}))
    : snapshot.docs;

  return { target, docs };
};

const getCustomerContacts = (db, companyId, customerId) =>
  getDocs(collection(db, "companies", companyId, "customers", customerId, "contacts"));

const getDeleteTargetDocs = async (db, companyId, customerId) =>
  Promise.all(deleteTargets.map((target) => queryTargetDocs(db, companyId, target, customerId)));

const deleteSubcollections = async (writer, parentSnapshot, subcollectionNames = []) => {
  let count = 0;

  for (const subcollectionName of subcollectionNames) {
    const snapshot = await getDocs(collection(parentSnapshot.ref, subcollectionName));
    for (const subDoc of snapshot.docs) {
      const deleted = await writer.delete(subDoc.ref);
      if (deleted) count += 1;
    }
  }

  return count;
};

export const previewCustomerCascadeDelete = async ({ db, companyId, customerId }) => {
  if (!db || !companyId || !customerId) {
    return { targets: [], contacts: 0, totalReferences: 0 };
  }

  const [targetResults, contactsSnapshot] = await Promise.all([
    getDeleteTargetDocs(db, companyId, customerId),
    getCustomerContacts(db, companyId, customerId),
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

export const deleteCustomerCascade = async ({ db, companyId, customerId }) => {
  if (!db || !companyId || !customerId) {
    throw new Error("Missing customer deletion context.");
  }

  const customerRef = doc(db, "companies", companyId, "customers", customerId);
  const [customerSnapshot, targetResults, contactsSnapshot] = await Promise.all([
    getDoc(customerRef),
    getDeleteTargetDocs(db, companyId, customerId),
    getCustomerContacts(db, companyId, customerId),
  ]);

  if (!customerSnapshot.exists()) {
    throw new Error("Customer no longer exists.");
  }

  const writer = createBatchWriter(db);
  const targetCounts = [];
  let deletedSubcollectionDocs = 0;
  let deletedContactDocs = 0;

  for (const { target, docs } of targetResults) {
    let deletedForTarget = 0;

    for (const snapshot of docs) {
      deletedSubcollectionDocs += await deleteSubcollections(writer, snapshot, target.subcollections || []);
      const deleted = await writer.delete(snapshot.ref);
      if (deleted) deletedForTarget += 1;
    }

    if (deletedForTarget > 0) {
      targetCounts.push({ label: target.label, count: deletedForTarget });
    }
  }

  for (const contactSnapshot of contactsSnapshot.docs) {
    const deleted = await writer.delete(contactSnapshot.ref);
    if (deleted) deletedContactDocs += 1;
  }

  await writer.delete(customerRef);
  const writeCount = await writer.commit();
  const deletedTargetDocs = targetCounts.reduce((total, item) => total + item.count, 0);

  return {
    writeCount,
    contacts: deletedContactDocs,
    targets: targetCounts,
    deletedSubcollectionDocs,
    totalDeleted: deletedTargetDocs + deletedSubcollectionDocs + deletedContactDocs + 1,
  };
};
