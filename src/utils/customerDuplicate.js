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
import { v4 as uuidv4 } from "uuid";
import {
  getCustomerDisplayName,
  normalizeContact,
  normalizeCustomerForFirestore,
  normalizeServiceLocationForFirestore,
} from "./customerLocationData";

const MAX_WRITES_PER_BATCH = 450;

const generatedId = (prefix) => `${prefix}${uuidv4()}`;

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

  return {
    set: async (ref, data, options) => {
      batch.set(ref, data, options);
      writeCount += 1;
      await commitIfNeeded();
    },
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

const uniqueDocsById = (docs = []) => Array.from(
  new Map(docs.map((snapshot) => [snapshot.id, snapshot])).values()
);

const safeQuery = async (queryRef) => {
  try {
    return await getDocs(queryRef);
  } catch (error) {
    console.warn("Unable to load customer duplicate source records.", error);
    return { docs: [] };
  }
};

const cleanObject = (value) => {
  if (Array.isArray(value)) {
    return value.map(cleanObject);
  }

  if (
    !value ||
    typeof value !== "object" ||
    typeof value.toDate === "function" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return value;
  }

  return Object.entries(value).reduce((next, [key, entry]) => {
    if (entry !== undefined) {
      next[key] = cleanObject(entry);
    }
    return next;
  }, {});
};

const remapRecordIds = (value, idMaps) => {
  if (Array.isArray(value)) {
    return value.map((entry) => remapRecordIds(entry, idMaps));
  }

  if (!value || typeof value !== "object" || typeof value.toDate === "function") {
    if (typeof value !== "string") return value;

    return (
      idMaps.serviceLocations.get(value) ||
      idMaps.bodiesOfWater.get(value) ||
      idMaps.equipment.get(value) ||
      value
    );
  }

  return Object.entries(value).reduce((next, [key, entry]) => {
    next[key] = remapRecordIds(entry, idMaps);
    return next;
  }, {});
};

const stripLinkedAccountAndBillingFields = (customer = {}) => {
  const {
    customerUserId,
    userId,
    linkedCustomerUserId,
    linkedHomeownerUserId,
    homeownerUserId,
    homeownerId,
    relationshipId,
    customerCompanyRelationshipId,
    linkedStatus,
    linkedEmail,
    linkedAt,
    linkedInviteId,
    linkedCustomerIds,
    customerAccountInviteUrl,
    customerAccountInviteToken,
    customerAccountInviteCreatedAt,
    customerAccountInviteExpiresAt,
    stripeCustomerId,
    stripeConnectedAccountId,
    defaultPaymentMethodId,
    paymentMethodId,
    billingProfileId,
    billingSubscriptionId,
    ...rest
  } = customer;

  return rest;
};

const stripOperationalSourceRefs = (record = {}) => {
  const {
    jobId,
    jobTaskId,
    sourceJobId,
    serviceStopId,
    serviceStopTaskId,
    sourceServiceStopId,
    taskId,
    sourceTaskId,
    sourceTaskType,
    workOrderId,
    workOrderTaskId,
    routeId,
    routeStopId,
    payrollStatementId,
    payrollLineItemId,
    salesInvoiceId,
    invoiceId,
    purchasedItemId,
    shoppingListItemId,
    shoppingListItemIds,
    sourcePurchasedItemId,
    sourceShoppingListItemId,
    ...rest
  } = record;

  return rest;
};

export const loadCustomerDuplicateSource = async ({ db, companyId, customerId }) => {
  if (!db || !companyId || !customerId) {
    throw new Error("Missing customer duplicate source context.");
  }

  const customerRef = doc(db, "companies", companyId, "customers", customerId);
  const customerSnapshot = await getDoc(customerRef);
  if (!customerSnapshot.exists()) {
    throw new Error("Customer not found.");
  }

  const serviceLocationsSnapshot = await getDocs(query(
    collection(db, "companies", companyId, "serviceLocations"),
    where("customerId", "==", customerId)
  ));
  const serviceLocationIds = serviceLocationsSnapshot.docs.map((locationDoc) => locationDoc.id);

  const [
    bodiesByCustomerSnapshot,
    equipmentByCustomerSnapshot,
    locationBodiesSnapshots,
    locationEquipmentSnapshots,
    stopDataSnapshot,
  ] = await Promise.all([
    safeQuery(query(collection(db, "companies", companyId, "bodiesOfWater"), where("customerId", "==", customerId))),
    safeQuery(query(collection(db, "companies", companyId, "equipment"), where("customerId", "==", customerId))),
    Promise.all(serviceLocationIds.map((locationId) => safeQuery(query(
      collection(db, "companies", companyId, "bodiesOfWater"),
      where("serviceLocationId", "==", locationId)
    )))),
    Promise.all(serviceLocationIds.map((locationId) => safeQuery(query(
      collection(db, "companies", companyId, "equipment"),
      where("serviceLocationId", "==", locationId)
    )))),
    safeQuery(query(collection(db, "companies", companyId, "stopData"), where("customerId", "==", customerId))),
  ]);

  const bodiesOfWaterSnapshots = uniqueDocsById([
    ...bodiesByCustomerSnapshot.docs,
    ...locationBodiesSnapshots.flatMap((snapshot) => snapshot.docs),
  ]);
  const equipmentSnapshots = uniqueDocsById([
    ...equipmentByCustomerSnapshot.docs,
    ...locationEquipmentSnapshots.flatMap((snapshot) => snapshot.docs),
  ]);

  const [bodyWaterHistorySnapshots, equipmentPartsSnapshots, equipmentServiceHistorySnapshots, equipmentScheduledWorkSnapshots] = await Promise.all([
    Promise.all(bodiesOfWaterSnapshots.map((bodyDoc) => safeQuery(collection(bodyDoc.ref, "waterHistory")))),
    Promise.all(equipmentSnapshots.map((equipmentDoc) => safeQuery(collection(equipmentDoc.ref, "parts")))),
    Promise.all(equipmentSnapshots.map((equipmentDoc) => safeQuery(collection(equipmentDoc.ref, "serviceHistory")))),
    Promise.all(equipmentSnapshots.map((equipmentDoc) => safeQuery(collection(equipmentDoc.ref, "scheduledWork")))),
  ]);

  return {
    customer: { id: customerSnapshot.id, ...customerSnapshot.data() },
    serviceLocations: serviceLocationsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    bodiesOfWater: bodiesOfWaterSnapshots.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    equipment: equipmentSnapshots.map((snapshot) => ({
      id: snapshot.id,
      ...snapshot.data(),
      parts: equipmentPartsSnapshots[equipmentSnapshots.indexOf(snapshot)]?.docs.map((partDoc) => ({ id: partDoc.id, ...partDoc.data() })) || [],
      serviceHistory: equipmentServiceHistorySnapshots[equipmentSnapshots.indexOf(snapshot)]?.docs.map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() })) || [],
      scheduledWork: equipmentScheduledWorkSnapshots[equipmentSnapshots.indexOf(snapshot)]?.docs.map((workDoc) => ({ id: workDoc.id, ...workDoc.data() })) || [],
    })),
    bodyWaterHistory: bodiesOfWaterSnapshots.reduce((historyByBodyId, bodyDoc, index) => ({
      ...historyByBodyId,
      [bodyDoc.id]: bodyWaterHistorySnapshots[index]?.docs.map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() })) || [],
    }), {}),
    stopData: stopDataSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
  };
};

export const getCustomerDuplicateSummary = (source = {}) => {
  const waterHistoryCount = Object.values(source.bodyWaterHistory || {})
    .reduce((total, items) => total + items.length, 0);
  const equipmentPartsCount = (source.equipment || [])
    .reduce((total, item) => total + (item.parts || []).length, 0);
  const equipmentHistoryCount = (source.equipment || [])
    .reduce((total, item) => total + (item.serviceHistory || []).length, 0);
  const scheduledWorkCount = (source.equipment || [])
    .reduce((total, item) => total + (item.scheduledWork || []).length, 0);

  return {
    serviceLocations: source.serviceLocations?.length || 0,
    bodiesOfWater: source.bodiesOfWater?.length || 0,
    equipment: source.equipment?.length || 0,
    waterHistory: waterHistoryCount,
    equipmentParts: equipmentPartsCount,
    equipmentHistory: equipmentHistoryCount,
    scheduledWork: scheduledWorkCount,
    chemistryHistory: source.stopData?.length || 0,
  };
};

export const duplicateCustomer = async ({
  db,
  companyId,
  source,
  customerDetails,
  equipmentOverrides = {},
}) => {
  if (!db || !companyId || !source?.customer?.id) {
    throw new Error("Missing customer duplicate context.");
  }

  const newCustomerId = generatedId("com_cus_");
  const sourceCustomer = stripLinkedAccountAndBillingFields(source.customer);
  const displayAsCompany = Boolean(customerDetails.displayAsCompany);
  const customerName = displayAsCompany
    ? String(customerDetails.company || "").trim()
    : [customerDetails.firstName, customerDetails.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const primaryContact = normalizeContact({
    id: generatedId("com_cus_con_"),
    name: customerName,
    email: customerDetails.email,
    phoneNumber: customerDetails.phoneNumber,
  });
  const idMaps = {
    serviceLocations: new Map(),
    bodiesOfWater: new Map(),
    equipment: new Map(),
  };

  (source.serviceLocations || []).forEach((location) => {
    idMaps.serviceLocations.set(location.id, generatedId("com_sl_"));
  });
  (source.bodiesOfWater || []).forEach((body) => {
    idMaps.bodiesOfWater.set(body.id, generatedId("com_bow_"));
  });
  (source.equipment || []).forEach((equipment) => {
    idMaps.equipment.set(equipment.id, generatedId("com_equ_"));
  });

  const writer = createBatchWriter(db);
  const newCustomerRef = doc(db, "companies", companyId, "customers", newCustomerId);
  const customerPayload = normalizeCustomerForFirestore({
    ...sourceCustomer,
    ...customerDetails,
    id: newCustomerId,
    firstName: customerDetails.firstName,
    lastName: customerDetails.lastName,
    company: customerDetails.company,
    displayAsCompany,
    email: customerDetails.email,
    phoneNumber: customerDetails.phoneNumber,
    active: true,
    isActive: true,
    duplicateKeys: [],
    sourceContactFields: {},
    linkedCustomerIds: [],
    linkedInviteId: "",
    linkedCustomerUserId: "",
    linkedHomeownerUserId: "",
    relationshipId: "",
    customerCompanyRelationshipId: "",
    linkedStatus: "",
    linkedEmail: "",
    linkedAt: null,
    duplicatedFromCustomerId: source.customer.id,
    duplicatedAt: serverTimestamp(),
  });

  await writer.set(newCustomerRef, cleanObject(customerPayload));

  await writer.set(
    doc(db, "companies", companyId, "customers", newCustomerId, "contacts", primaryContact.id),
    { ...primaryContact, id: primaryContact.id, duplicatedFromCustomerId: source.customer.id, createdAt: serverTimestamp() }
  );

  for (const location of source.serviceLocations || []) {
    const locationId = idMaps.serviceLocations.get(location.id);
    const locationPayload = normalizeServiceLocationForFirestore({
      ...location,
      id: locationId,
      customerId: newCustomerId,
      customerName,
      bodiesOfWaterId: (location.bodiesOfWaterId || []).map((bodyId) => idMaps.bodiesOfWater.get(bodyId) || bodyId),
      mainContact: primaryContact,
      duplicatedFromServiceLocationId: location.id,
      duplicatedFromCustomerId: source.customer.id,
    });

    await writer.set(
      doc(db, "companies", companyId, "serviceLocations", locationId),
      cleanObject({
        ...locationPayload,
        duplicatedAt: serverTimestamp(),
      })
    );
  }

  for (const bodyOfWater of source.bodiesOfWater || []) {
    const bodyOfWaterId = idMaps.bodiesOfWater.get(bodyOfWater.id);
    const bodyPayload = remapRecordIds({
      ...bodyOfWater,
      id: bodyOfWaterId,
      customerId: newCustomerId,
      customerName,
      serviceLocationId: idMaps.serviceLocations.get(bodyOfWater.serviceLocationId) || bodyOfWater.serviceLocationId || "",
      duplicatedFromBodyOfWaterId: bodyOfWater.id,
      duplicatedFromCustomerId: source.customer.id,
      duplicatedAt: serverTimestamp(),
    }, idMaps);

    await writer.set(doc(db, "companies", companyId, "bodiesOfWater", bodyOfWaterId), cleanObject(bodyPayload));

    for (const history of source.bodyWaterHistory?.[bodyOfWater.id] || []) {
      const historyId = generatedId("com_bow_his_");
      await writer.set(
        doc(db, "companies", companyId, "bodiesOfWater", bodyOfWaterId, "waterHistory", historyId),
        cleanObject(stripOperationalSourceRefs(remapRecordIds({
          ...history,
          id: historyId,
          bodyOfWaterId,
          customerId: newCustomerId,
          customerName,
          serviceLocationId: bodyPayload.serviceLocationId || "",
          duplicatedFromHistoryId: history.id,
          duplicatedFromCustomerId: source.customer.id,
          duplicatedAt: serverTimestamp(),
        }, idMaps)))
      );
    }
  }

  for (const equipment of source.equipment || []) {
    const equipmentId = idMaps.equipment.get(equipment.id);
    const override = equipmentOverrides[equipment.id] || {};
    const equipmentPayload = remapRecordIds({
      ...equipment,
      ...override,
      id: equipmentId,
      customerId: newCustomerId,
      customerName,
      serviceLocationId: idMaps.serviceLocations.get(equipment.serviceLocationId) || equipment.serviceLocationId || "",
      bodyOfWaterId: idMaps.bodiesOfWater.get(equipment.bodyOfWaterId) || equipment.bodyOfWaterId || "",
      duplicatedFromEquipmentId: equipment.id,
      duplicatedFromCustomerId: source.customer.id,
      duplicatedAt: serverTimestamp(),
    }, idMaps);
    delete equipmentPayload.parts;
    delete equipmentPayload.serviceHistory;
    delete equipmentPayload.scheduledWork;

    await writer.set(doc(db, "companies", companyId, "equipment", equipmentId), cleanObject(equipmentPayload));

    for (const part of equipment.parts || []) {
      const partId = generatedId("com_equ_par_");
      await writer.set(
        doc(db, "companies", companyId, "equipment", equipmentId, "parts", partId),
        cleanObject({
          ...part,
          id: partId,
          equipmentId,
          duplicatedFromPartId: part.id,
          duplicatedFromEquipmentId: equipment.id,
          duplicatedFromCustomerId: source.customer.id,
          createdAt: part.createdAt || serverTimestamp(),
          duplicatedAt: serverTimestamp(),
        })
      );
    }

    for (const history of equipment.serviceHistory || []) {
      const historyId = generatedId("com_equ_his_");
      await writer.set(
        doc(db, "companies", companyId, "equipment", equipmentId, "serviceHistory", historyId),
        cleanObject(stripOperationalSourceRefs(remapRecordIds({
          ...history,
          id: historyId,
          equipmentId,
          customerId: newCustomerId,
          customerName,
          serviceLocationId: equipmentPayload.serviceLocationId || "",
          bodyOfWaterId: equipmentPayload.bodyOfWaterId || "",
          duplicatedFromHistoryId: history.id,
          duplicatedFromEquipmentId: equipment.id,
          duplicatedFromCustomerId: source.customer.id,
          duplicatedAt: serverTimestamp(),
        }, idMaps)))
      );
    }

    for (const work of equipment.scheduledWork || []) {
      const workId = generatedId("com_equ_sch_");
      await writer.set(
        doc(db, "companies", companyId, "equipment", equipmentId, "scheduledWork", workId),
        cleanObject(stripOperationalSourceRefs(remapRecordIds({
          ...work,
          id: workId,
          equipmentId,
          customerId: newCustomerId,
          customerName,
          serviceLocationId: equipmentPayload.serviceLocationId || "",
          bodyOfWaterId: equipmentPayload.bodyOfWaterId || "",
          duplicatedFromScheduledWorkId: work.id,
          duplicatedFromEquipmentId: equipment.id,
          duplicatedFromCustomerId: source.customer.id,
          duplicatedAt: serverTimestamp(),
        }, idMaps)))
      );
    }
  }

  for (const stopData of source.stopData || []) {
    const stopDataId = generatedId("com_stop_data_");
    const serviceLocationId = idMaps.serviceLocations.get(stopData.serviceLocationId) || stopData.serviceLocationId || "";
    const bodyOfWaterId = idMaps.bodiesOfWater.get(stopData.bodyOfWaterId) || stopData.bodyOfWaterId || "";
    await writer.set(
      doc(db, "companies", companyId, "stopData", stopDataId),
      cleanObject(stripOperationalSourceRefs(remapRecordIds({
        ...stopData,
        id: stopDataId,
        customerId: newCustomerId,
        customerName,
        serviceLocationId,
        bodyOfWaterId,
        duplicatedFromStopDataId: stopData.id,
        duplicatedFromCustomerId: source.customer.id,
        duplicatedAt: serverTimestamp(),
      }, idMaps)))
    );
  }

  const writes = await writer.commit();

  return {
    customerId: newCustomerId,
    customerName: getCustomerDisplayName(customerPayload),
    writes,
    summary: getCustomerDuplicateSummary(source),
  };
};
