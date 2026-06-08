const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const { getFirestore } = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");
const {
  ensureCustomerAccountInvite,
  getCustomerAccountInvitePreview,
} = require("../customerAccountInvites");

const db = admin.firestore();

const mySecret = defineSecret('stripe_secret_key');

const DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID = "d-a987a065df0e43378dafd14c1b7ee419";
const DEFAULT_JOB_ESTIMATE_TEMPLATE_ID = "d-566087cd96864db0a07167e8a080cc12";
const DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID = "d-866f4368544048aeabf108413f8b8c52";

const defaultServiceStopCategoryEmailSettings = (companyName = "your pool company") => ({
  "Route": {
    category: "Route",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    emailSubject: `${companyName} Service Report`,
    emailBody: `Thank you for letting ${companyName} service your pool. Here is a summary of today's visit.`,
    emailFooter: "Please contact us with any questions.",
    sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
  },
  "Job": {
    category: "Job",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    emailSubject: `${companyName} Job Visit Summary`,
    emailBody: `Thank you for choosing ${companyName}. Here is a summary of the work completed during this visit.`,
    emailFooter: "Please contact us with any questions.",
    sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
  },
  "Job Estimate": {
    category: "Job Estimate",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    emailSubject: `${companyName} Estimate Visit Recap`,
    emailBody: `Thank you for meeting with ${companyName}. Here is a recap of the information gathered for your estimate.`,
    emailFooter: "Please contact us with any questions.",
    sendGridTemplateId: DEFAULT_JOB_ESTIMATE_TEMPLATE_ID,
  },
  "Service Agreement Estimate": {
    category: "Service Agreement Estimate",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    emailSubject: `${companyName} Service Agreement Visit Recap`,
    emailBody: `Thank you for considering ${companyName} for recurring service. Here is a recap of the service location information we gathered.`,
    emailFooter: "Please contact us with any questions.",
    sendGridTemplateId: DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID,
  },
  "Customer Relationship": {
    category: "Customer Relationship",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    emailSubject: `${companyName} Visit Recap`,
    emailBody: `Thank you for taking the time to meet with ${companyName}. Here is a recap of the visit and any follow-up notes.`,
    emailFooter: "Please contact us with any questions.",
    sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
  },
});

//Live
// const publishableStripeKey = defineSecret('pk_live_51SR0FQAarMCMczenzad9KHz2dWM4tcMlSN1aquZVdN83md983TatYFy02H3usQAWeWldDMmlnPbVw5PvmhdjsXbn00sJx5TPCF');
//Test

const stripe = require("stripe")(process.env.STRIPE_API_KEY || 'sk_test_dummyApiKey');

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const getVerifiedCallableAuth = async (payload = {}, context = {}) => {
  if (context.auth?.uid) {
    return {
      uid: context.auth.uid,
      token: context.auth.token || {},
    };
  }

  const authorizationHeader =
    context.rawRequest?.headers?.authorization ||
    context.rawRequest?.headers?.Authorization ||
    "";
  const bearerToken = String(authorizationHeader).startsWith("Bearer ")
    ? String(authorizationHeader).slice("Bearer ".length).trim()
    : "";
  const idToken = [
    payload.idToken,
    payload.auth?.idToken,
    payload.data?.idToken,
    bearerToken,
  ].find((candidate) => String(candidate || "").trim());

  if (!idToken) return null;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    return {
      uid: decodedToken.uid,
      token: decodedToken,
    };
  } catch (error) {
    console.error("Unable to verify callable auth token", error);
    return null;
  }
};

const safeDocIdPart = (value) => String(value || "")
  .trim()
  .replace(/\//g, "_")
  .replace(/[^a-zA-Z0-9_-]/g, "_")
  .slice(0, 140);

const linkedHomeownerDocId = (prefix, companyId, sourceId) => (
  `${prefix}_${safeDocIdPart(companyId)}_${safeDocIdPart(sourceId)}`
);

const customerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany && customer.company) return customer.company;
  if (customer.displayAsCompany && customer.companyName) return customer.companyName;

  return `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
};

const removeUndefinedDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedDeep).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (typeof value.toDate === "function") return value;
    if (value.constructor && value.constructor.name !== "Object") return value;

    return Object.entries(value).reduce((clean, [key, item]) => {
      const cleanedValue = removeUndefinedDeep(item);
      if (cleanedValue !== undefined) {
        clean[key] = cleanedValue;
      }
      return clean;
    }, {});
  }

  return value === undefined ? undefined : value;
};

const commitFirestoreWrites = async (firestore, writes) => {
  for (let index = 0; index < writes.length; index += 450) {
    const batch = firestore.batch();
    const chunk = writes.slice(index, index + 450);

    chunk.forEach((write) => {
      if (write.type === "update") {
        batch.update(write.ref, write.data);
      } else {
        batch.set(write.ref, write.data, { merge: write.merge !== false });
      }
    });

    await batch.commit();
  }
};

const getLinkedCustomerIds = (customer = {}) => (
  Array.isArray(customer.linkedCustomerIds)
    ? customer.linkedCustomerIds.filter(Boolean)
    : []
);

const getHomeownerRelationshipId = (companyId, customerId, homeownerId) => (
  `ccr_${safeDocIdPart(companyId)}_${safeDocIdPart(customerId)}_${safeDocIdPart(homeownerId)}`
);

const createCompanyScopedId = (prefix) => `${prefix}_${uuidv4()}`;

const normalizeLeadConversionAddress = (address = {}) => removeUndefinedDeep({
  streetAddress: address.streetAddress || address.address || "",
  city: address.city || "",
  state: address.state || "",
  zip: address.zip || address.zipCode || "",
  zipCode: address.zipCode || address.zip || "",
  latitude: address.latitude ?? null,
  longitude: address.longitude ?? null,
});

const hasLeadConversionAddress = (address = {}) => Boolean(
  address &&
  (
    address.streetAddress ||
    address.address ||
    address.city ||
    address.state ||
    address.zip ||
    address.zipCode
  )
);

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
};

const splitLeadConversionName = (name = "") => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
};

const toArrayOfStrings = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  const text = String(value || "").trim();
  return text ? [text] : [];
};

const homeownerRecordBelongsToUser = (record = {}, homeownerId = "") => {
  if (!homeownerId) return true;

  return [
    record.userId,
    record.homeownerId,
    record.customerId,
    record.customerUserId,
  ].filter(Boolean).includes(homeownerId);
};

const readHomeownerOwnedRecord = async (firestore, collectionName, recordId, homeownerId) => {
  if (!recordId) return null;

  const recordSnap = await firestore.collection(collectionName).doc(recordId).get();
  if (!recordSnap.exists) return null;

  const record = { id: recordSnap.id, ...recordSnap.data() };
  if (!homeownerRecordBelongsToUser(record, homeownerId)) {
    console.warn("[leadConversion] Ignoring homeowner record with mismatched owner", {
      collectionName,
      recordId,
      homeownerId,
      recordUserId: record.userId || "",
      recordHomeownerId: record.homeownerId || "",
      recordCustomerId: record.customerId || "",
      recordCustomerUserId: record.customerUserId || "",
    });
    return null;
  }

  return record;
};

const queryHomeownerEquipmentForBody = async (firestore, bodyOfWaterId, homeownerId) => {
  if (!bodyOfWaterId) return [];

  const equipmentSnap = await firestore
    .collection("homeownerEquipment")
    .where("bodyOfWaterId", "==", bodyOfWaterId)
    .get();

  return equipmentSnap.docs
    .map((equipmentDoc) => ({ id: equipmentDoc.id, ...equipmentDoc.data() }))
    .filter((equipment) => homeownerRecordBelongsToUser(equipment, homeownerId));
};

const mapHomeownerEquipmentToCompanyDraft = (equipment = {}) => ({
  id: equipment.id || "",
  name: equipment.name || equipment.category || equipment.type || "Equipment",
  type: equipment.type || equipment.category || "",
  typeId: equipment.typeId || "",
  make: equipment.make || "",
  makeId: equipment.makeId || "",
  model: equipment.model || "",
  modelId: equipment.modelId || equipment.universalEquipmentId || "",
  universalEquipmentId: equipment.universalEquipmentId || equipment.modelId || "",
  manualPdfLink: equipment.manualPdfLink || "",
  cleanFilterPressure: equipment.cleanFilterPressure ?? null,
  currentPressure: equipment.currentPressure ?? null,
  serviceFrequency: equipment.serviceFrequency ?? null,
  serviceFrequencyEvery: equipment.serviceFrequencyEvery || "",
  dateInstalled: equipment.dateInstalled || null,
  lastServiceDate: equipment.lastServiceDate || null,
  nextServiceDate: equipment.nextServiceDate || null,
  notes: equipment.notes || "",
  needsService: Boolean(equipment.needsService),
  status: equipment.status || "Operational",
  verified: Boolean(equipment.verified),
  photoUrls: Array.isArray(equipment.photoUrls) ? equipment.photoUrls : [],
  linkedHomeownerEquipmentId: equipment.id || "",
});

const isDefaultLeadConversionEquipment = (equipmentList = []) => {
  if (!equipmentList.length) return true;

  return equipmentList.every((equipment = {}) => {
    const name = String(equipment.name || "").trim().toLowerCase();
    const type = String(equipment.type || equipment.category || "").trim().toLowerCase();
    const isDefaultName = ["pump", "filter", "pump 1", "filter 1"].includes(name);
    const isDefaultType = ["pump", "filter"].includes(type) || !type;
    const hasSpecificInfo = Boolean(
      equipment.make ||
      equipment.makeId ||
      equipment.model ||
      equipment.modelId ||
      equipment.universalEquipmentId ||
      equipment.manualPdfLink ||
      equipment.notes
    );

    return isDefaultName && isDefaultType && !hasSpecificInfo;
  });
};

const userCanAccessCompany = async (firestore, userId, companyId) => {
  if (!userId || !companyId) return false;

  const [userSnap, accessSnap] = await Promise.all([
    firestore.collection("users").doc(userId).get(),
    firestore.collection("users").doc(userId).collection("userAccess").doc(companyId).get(),
  ]);

  const userData = userSnap.exists ? userSnap.data() || {} : {};
  return userData.accountType === "Admin" || accessSnap.exists;
};

const MAX_LINKED_SERVICE_HISTORY_RECORDS = 104;
const SERVICE_HISTORY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 365 * 2;

const timestampMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const firstTimestampMillis = (source = {}, fields = []) => {
  for (const field of fields) {
    const millis = timestampMillis(source[field]);
    if (millis) return millis;
  }

  return 0;
};

const recentHistoryEntries = (documents = [], dateFields = []) => {
  const nowMs = Date.now();
  const cutoffMs = nowMs - SERVICE_HISTORY_LOOKBACK_MS;

  return documents
    .map((document) => {
      const data = document.data() || {};
      const millis = firstTimestampMillis(data, dateFields);

      return { document, data, millis };
    })
    .filter((entry) => entry.millis && entry.millis >= cutoffMs && entry.millis <= nowMs)
    .sort((left, right) => right.millis - left.millis);
};

const isFinishedServiceStopForHomeownerHistory = (serviceStop = {}, hasStopData = false) => {
  if (hasStopData) return true;

  const statusText = [
    serviceStop.operationStatus,
    serviceStop.status,
    serviceStop.serviceStatus,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    statusText.includes("finished") ||
    statusText.includes("complete") ||
    Boolean(serviceStop.finishedAt || serviceStop.completedAt || serviceStop.endTime)
  );
};

async function linkHomeownerToCompanyCustomer({
  companyId,
  customerId,
  homeownerId,
  authEmail,
  inviteId = "",
  source = "companyInvite",
  requestedByUserId = "",
}) {
  const firestore = getFirestore();
  const normalizedAuthEmail = normalizeEmail(authEmail);

  if (!companyId || !customerId || !homeownerId) {
    return {
      status: 400,
      error: "Missing companyId, customerId, or homeownerId"
    };
  }

  if (!normalizedAuthEmail) {
    return {
      status: 403,
      error: "A verified email is required to link this customer account"
    };
  }

  const companyRef = firestore.collection("companies").doc(companyId);
  const customerRef = companyRef.collection("customers").doc(customerId);
  const [companySnap, customerSnap] = await Promise.all([
    companyRef.get(),
    customerRef.get(),
  ]);

  if (!companySnap.exists) {
    return { status: 404, error: "Company not found" };
  }

  if (!customerSnap.exists) {
    return { status: 404, error: "Company customer not found" };
  }

  const company = companySnap.data() || {};
  const customer = customerSnap.data() || {};
  let invite = null;

  if (inviteId) {
    const inviteSnap = await firestore.collection("linkedInvite").doc(inviteId).get();
    if (!inviteSnap.exists) {
      return { status: 404, error: "Linked invite not found" };
    }
    invite = inviteSnap.data() || {};

    if (invite.companyId && invite.companyId !== companyId) {
      return { status: 403, error: "Invite belongs to a different company" };
    }

    if (invite.customerId && invite.customerId !== customerId) {
      return { status: 403, error: "Invite belongs to a different customer" };
    }
  }

  const expectedEmail = normalizeEmail(invite?.email || invite?.customerEmail || customer.email);
  const tokenOnlyInviteClaimAllowed = Boolean(inviteId && invite?.allowTokenClaim === true && !expectedEmail);
  if (!expectedEmail && !tokenOnlyInviteClaimAllowed) {
    return {
      status: 400,
      error: "The company customer needs an email before it can be linked"
    };
  }

  if (expectedEmail && expectedEmail !== normalizedAuthEmail) {
    return {
      status: 403,
      error: "Authenticated email does not match the customer invite email"
    };
  }

  const linkedCustomerIds = getLinkedCustomerIds(customer);
  const linkedToDifferentHomeowner = linkedCustomerIds.some((linkedId) => linkedId !== homeownerId);
  if (linkedToDifferentHomeowner) {
    return {
      status: 409,
      error: "This customer is already linked to another homeowner account"
    };
  }

  const relationshipId = getHomeownerRelationshipId(companyId, customerId, homeownerId);
  const relationshipRef = firestore.collection("customerCompanyRelationships").doc(relationshipId);
  const customerName = customerDisplayName(customer);
  const companyName = company.name || company.companyName || "";
  const now = admin.firestore.FieldValue.serverTimestamp();

  const [serviceLocationsSnap, bodiesOfWaterSnap, equipmentSnap, serviceStopsSnap, stopDataSnap] = await Promise.all([
    companyRef.collection("serviceLocations").where("customerId", "==", customerId).get(),
    companyRef.collection("bodiesOfWater").where("customerId", "==", customerId).get(),
    companyRef.collection("equipment").where("customerId", "==", customerId).get(),
    companyRef.collection("serviceStops").where("customerId", "==", customerId).get(),
    companyRef.collection("stopData").where("customerId", "==", customerId).get(),
  ]);

  const serviceLocationIdMap = new Map();
  const bodyOfWaterIdMap = new Map();
  const serviceStopIdMap = new Map();
  const bodyIdsByLocationId = new Map();

  serviceLocationsSnap.docs.forEach((locationDoc) => {
    const location = locationDoc.data() || {};
    const sourceLocationId = location.id || locationDoc.id;
    const homeownerLocationId = linkedHomeownerDocId("hosl", companyId, sourceLocationId);
    serviceLocationIdMap.set(sourceLocationId, homeownerLocationId);
    serviceLocationIdMap.set(locationDoc.id, homeownerLocationId);
  });

  bodiesOfWaterSnap.docs.forEach((bodyDoc) => {
    const bodyOfWater = bodyDoc.data() || {};
    const sourceBodyId = bodyOfWater.id || bodyDoc.id;
    const sourceLocationId = bodyOfWater.serviceLocationId || "";
    const homeownerBodyId = linkedHomeownerDocId("hobow", companyId, sourceBodyId);
    const homeownerLocationId = serviceLocationIdMap.get(sourceLocationId) || "";

    bodyOfWaterIdMap.set(sourceBodyId, homeownerBodyId);
    bodyOfWaterIdMap.set(bodyDoc.id, homeownerBodyId);

    if (homeownerLocationId) {
      const bodyIds = bodyIdsByLocationId.get(homeownerLocationId) || [];
      bodyIds.push(homeownerBodyId);
      bodyIdsByLocationId.set(homeownerLocationId, bodyIds);
    }
  });

  serviceStopsSnap.docs.forEach((serviceStopDoc) => {
    const serviceStop = serviceStopDoc.data() || {};
    const sourceServiceStopId = serviceStop.id || serviceStopDoc.id;
    const homeownerServiceStopId = linkedHomeownerDocId("hoss", companyId, sourceServiceStopId);
    serviceStopIdMap.set(sourceServiceStopId, homeownerServiceStopId);
    serviceStopIdMap.set(serviceStopDoc.id, homeownerServiceStopId);
  });

  const recentStopDataEntries = recentHistoryEntries(
    stopDataSnap.docs,
    ["date", "serviceDate", "createdAt"]
  ).slice(0, MAX_LINKED_SERVICE_HISTORY_RECORDS);
  const stopDataByServiceStopId = new Map();

  recentStopDataEntries.forEach(({ data }) => {
    const sourceServiceStopId = data.serviceStopId || "";
    if (sourceServiceStopId && !stopDataByServiceStopId.has(sourceServiceStopId)) {
      stopDataByServiceStopId.set(sourceServiceStopId, data);
    }
  });

  const recentServiceStopEntries = recentHistoryEntries(
    serviceStopsSnap.docs,
    ["serviceDate", "date", "finishedAt", "completedAt", "createdAt"]
  )
    .filter(({ data, document }) => {
      const sourceServiceStopId = data.id || document.id;
      return isFinishedServiceStopForHomeownerHistory(
        data,
        stopDataByServiceStopId.has(sourceServiceStopId)
      );
    })
    .slice(0, MAX_LINKED_SERVICE_HISTORY_RECORDS);

  const writes = [
    {
      ref: relationshipRef,
      data: removeUndefinedDeep({
        id: relationshipId,
        companyId,
        companyName,
        companyCustomerId: customerId,
        companyCustomerName: customerName,
        homeownerUserId: homeownerId,
        homeownerEmail: normalizedAuthEmail,
        status: "active",
        source,
        inviteId: inviteId || customer.linkedInviteId || "",
        inviteEmail: expectedEmail || normalizedAuthEmail,
        tokenOnlyInviteClaim: tokenOnlyInviteClaimAllowed,
        emailVerifiedAt: now,
        linkedAt: now,
        updatedAt: now,
        createdAt: now,
        createdByUserId: requestedByUserId || homeownerId,
        permissions: {
          companyCanUpdateSharedFields: true,
          companyCanDeleteHomeownerOwnedRecords: false,
          homeownerCanEditPortalRecords: true,
        },
      }),
    },
    {
      ref: customerRef,
      data: removeUndefinedDeep({
        linkedCustomerIds: admin.firestore.FieldValue.arrayUnion(homeownerId),
        linkedCustomerUserId: homeownerId,
        linkedHomeownerUserId: homeownerId,
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        linkedStatus: "active",
        linkedEmail: normalizedAuthEmail,
        customerAccountInviteStatus: "accepted",
        linkedAt: now,
        linkedInviteId: inviteId || customer.linkedInviteId || relationshipId,
      }),
    },
  ];

  serviceLocationsSnap.docs.forEach((locationDoc) => {
    const location = locationDoc.data() || {};
    const sourceLocationId = location.id || locationDoc.id;
    const homeownerLocationId = serviceLocationIdMap.get(sourceLocationId);

    writes.push({
      ref: firestore.collection("homeownerServiceLocations").doc(homeownerLocationId),
      data: removeUndefinedDeep({
        ...location,
        id: homeownerLocationId,
        userId: homeownerId,
        homeownerId,
        customerId: homeownerId,
        customerName,
        companyCustomerId: customerId,
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        verified: true,
        source: "company",
        linkedCompanyId: companyId,
        linkedCompanyName: companyName,
        linkedCompanyCustomerId: customerId,
        linkedCompanyServiceLocationId: sourceLocationId,
        sourceCompanyServiceLocationId: sourceLocationId,
        bodiesOfWaterId: bodyIdsByLocationId.get(homeownerLocationId) || [],
        updatedAt: now,
        linkedAt: now,
      }),
    });
  });

  bodiesOfWaterSnap.docs.forEach((bodyDoc) => {
    const bodyOfWater = bodyDoc.data() || {};
    const sourceBodyId = bodyOfWater.id || bodyDoc.id;
    const sourceLocationId = bodyOfWater.serviceLocationId || "";
    const homeownerBodyId = bodyOfWaterIdMap.get(sourceBodyId);

    writes.push({
      ref: firestore.collection("homeownerBodiesOfWater").doc(homeownerBodyId),
      data: removeUndefinedDeep({
        ...bodyOfWater,
        id: homeownerBodyId,
        userId: homeownerId,
        homeownerId,
        customerId: homeownerId,
        companyCustomerId: customerId,
        serviceLocationId: serviceLocationIdMap.get(sourceLocationId) || "",
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        verified: true,
        source: "company",
        linkedCompanyId: companyId,
        linkedCompanyName: companyName,
        linkedCompanyCustomerId: customerId,
        linkedCompanyServiceLocationId: sourceLocationId,
        linkedCompanyBodyOfWaterId: sourceBodyId,
        sourceCompanyBodyOfWaterId: sourceBodyId,
        updatedAt: now,
        linkedAt: now,
      }),
    });
  });

  equipmentSnap.docs.forEach((equipmentDoc) => {
    const equipment = equipmentDoc.data() || {};
    const sourceEquipmentId = equipment.id || equipmentDoc.id;
    const homeownerEquipmentId = linkedHomeownerDocId("hoequ", companyId, sourceEquipmentId);

    writes.push({
      ref: firestore.collection("homeownerEquipment").doc(homeownerEquipmentId),
      data: removeUndefinedDeep({
        ...equipment,
        id: homeownerEquipmentId,
        userId: homeownerId,
        homeownerId,
        customerId: homeownerId,
        companyCustomerId: customerId,
        serviceLocationId: serviceLocationIdMap.get(equipment.serviceLocationId || "") || "",
        bodyOfWaterId: bodyOfWaterIdMap.get(equipment.bodyOfWaterId || "") || "",
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        verified: true,
        source: "company",
        linkedCompanyId: companyId,
        linkedCompanyName: companyName,
        linkedCompanyCustomerId: customerId,
        linkedCompanyServiceLocationId: equipment.serviceLocationId || "",
        linkedCompanyBodyOfWaterId: equipment.bodyOfWaterId || "",
        linkedCompanyEquipmentId: sourceEquipmentId,
        sourceCompanyEquipmentId: sourceEquipmentId,
        updatedAt: now,
        linkedAt: now,
      }),
    });
  });

  recentServiceStopEntries.forEach(({ document, data: serviceStop }) => {
    const sourceServiceStopId = serviceStop.id || document.id;
    const homeownerServiceStopId = serviceStopIdMap.get(sourceServiceStopId);
    const stopDataForStop = stopDataByServiceStopId.get(sourceServiceStopId) || {};
    const sourceServiceLocationId = serviceStop.serviceLocationId || stopDataForStop.serviceLocationId || "";
    const sourceBodyOfWaterId = serviceStop.bodyOfWaterId || stopDataForStop.bodyOfWaterId || "";

    writes.push({
      ref: firestore.collection("homeownerServiceStops").doc(homeownerServiceStopId),
      data: removeUndefinedDeep({
        ...serviceStop,
        id: homeownerServiceStopId,
        userId: homeownerId,
        homeownerId,
        customerId: homeownerId,
        companyCustomerId: customerId,
        customerName,
        companyId,
        companyName,
        serviceLocationId: serviceLocationIdMap.get(sourceServiceLocationId) || "",
        bodyOfWaterId: bodyOfWaterIdMap.get(sourceBodyOfWaterId) || "",
        techName: serviceStop.techName || serviceStop.tech || "",
        notes: serviceStop.notes || serviceStop.serviceNotes || serviceStop.description || "",
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        source: "company",
        linkedCompanyId: companyId,
        linkedCompanyName: companyName,
        linkedCompanyCustomerId: customerId,
        linkedCompanyServiceStopId: sourceServiceStopId,
        sourceCompanyServiceStopId: sourceServiceStopId,
        sourceCompanyServiceLocationId: sourceServiceLocationId,
        sourceCompanyBodyOfWaterId: sourceBodyOfWaterId,
        updatedAt: now,
        linkedAt: now,
      }),
    });
  });

  recentStopDataEntries.forEach(({ document, data: stopData }) => {
    const sourceStopDataId = stopData.id || document.id;
    const sourceServiceStopId = stopData.serviceStopId || "";
    const sourceServiceLocationId = stopData.serviceLocationId || "";
    const sourceBodyOfWaterId = stopData.bodyOfWaterId || "";
    const homeownerStopDataId = linkedHomeownerDocId("hostop", companyId, sourceStopDataId);

    writes.push({
      ref: firestore.collection("stopData").doc(homeownerStopDataId),
      data: removeUndefinedDeep({
        ...stopData,
        id: homeownerStopDataId,
        userId: homeownerId,
        homeownerId,
        customerId: homeownerId,
        companyCustomerId: customerId,
        companyId,
        companyName,
        serviceStopId: serviceStopIdMap.get(sourceServiceStopId) || "",
        serviceLocationId: serviceLocationIdMap.get(sourceServiceLocationId) || "",
        bodyOfWaterId: bodyOfWaterIdMap.get(sourceBodyOfWaterId) || "",
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        source: "company",
        linkedCompanyId: companyId,
        linkedCompanyName: companyName,
        linkedCompanyCustomerId: customerId,
        linkedCompanyStopDataId: sourceStopDataId,
        linkedCompanyServiceStopId: sourceServiceStopId,
        sourceCompanyStopDataId: sourceStopDataId,
        sourceCompanyServiceStopId: sourceServiceStopId,
        sourceCompanyServiceLocationId: sourceServiceLocationId,
        sourceCompanyBodyOfWaterId: sourceBodyOfWaterId,
        updatedAt: now,
        linkedAt: now,
      }),
    });
  });

  if (inviteId) {
    writes.push({
      ref: firestore.collection("linkedInvite").doc(inviteId),
      data: {
        accepted: true,
        status: "accepted",
        acceptedAt: now,
        acceptedByUserId: homeownerId,
        relationshipId,
      },
    });
  }

  const collectionsToBackfill = [
    "salesAgreements",
    "salesBillingProfiles",
    "salesBillingSubscriptions",
    "salesInvoices",
    "salesPayments",
    "homeownerServiceRequests",
    "homeownerRepairRequests",
  ];

  for (const collectionName of collectionsToBackfill) {
    try {
      const snapshots = [];
      snapshots.push(await firestore.collection(collectionName)
        .where("companyId", "==", companyId)
        .where("customerId", "==", customerId)
        .get());

      if (expectedEmail) {
        snapshots.push(await firestore.collection(collectionName)
          .where("companyId", "==", companyId)
          .where("email", "==", expectedEmail)
          .get());
      }

      const seenDocIds = new Set();
      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((document) => {
          if (seenDocIds.has(document.id)) return;
          seenDocIds.add(document.id);
          writes.push({
            ref: document.ref,
            data: {
              customerId,
              companyCustomerId: customerId,
              customerUserId: homeownerId,
              homeownerUserId: homeownerId,
              homeownerId,
              relationshipId,
              customerCompanyRelationshipId: relationshipId,
              updatedAt: now,
            },
          });
        });
      });
    } catch (error) {
      console.warn("[CustomerCompanyRelationship] Unable to backfill collection", collectionName, error.message);
    }
  }

  await commitFirestoreWrites(firestore, writes);

  return {
    status: 200,
    relationshipId,
    companyId,
    customerId,
    homeownerId,
    copied: {
      serviceLocations: serviceLocationsSnap.size,
      bodiesOfWater: bodiesOfWaterSnap.size,
      equipment: equipmentSnap.size,
      serviceStops: recentServiceStopEntries.length,
      stopData: recentStopDataEntries.length,
    },
    account: "Successfully linked homeowner account"
  };
}

function normalizeRecurringStopTypeFieldsForFunction(source, contextLabel) {
  const hasTypeId = typeof source?.typeId === "string" && source.typeId.trim().length > 0;
  const hasType = typeof source?.type === "string" && source.type.trim().length > 0;
  const fields = {
    typeId: hasTypeId ? source.typeId : "system_recurring_service_stop",
    type: hasType ? source.type : "Recurring Service Stop",
    typeImage: typeof source?.typeImage === "string" && source.typeImage.trim().length > 0
      ? source.typeImage
      : "figure.pool.swim",
  };

  if (!hasTypeId || !hasType) {
    console.warn("[ServiceStopTypeFunction][fallback]", {
      context: contextLabel,
      recurringServiceStopId: source?.id || "",
      incomingTypeId: source?.typeId || "",
      incomingType: source?.type || "",
      resolvedTypeId: fields.typeId,
      resolvedType: fields.type,
    });
  } else {
    console.log("[ServiceStopTypeFunction][resolved]", {
      context: contextLabel,
      recurringServiceStopId: source?.id || "",
      typeId: fields.typeId,
      type: fields.type,
    });
  }

  return fields;
}

// Build to replace createFirstRecurringServiceStop
exports.createFirstRecurringServiceStop2 = functions.https.onCall(async (data, context) => {
  console.log("createFirstRecurringServiceStop2 (refactored, seed 4 weeks)");

  try {
    const companyId = data?.data?.companyId;
    const rssData = data?.data?.recurringServiceStop;

    if (!companyId) throw new Error("Missing Company Id");
    if (!rssData?.id) throw new Error("Missing Recurring Service Stop Id");

    const db = getFirestore();

    const SSIncrementCol = `companies/${companyId}/settings`;
    const RSSCol = `companies/${companyId}/recurringServiceStop`;
    const serviceStopsCol = `companies/${companyId}/serviceStops`;

    const recurringServiceStopDoc = db.collection(RSSCol).doc(rssData.id);

    // MARK: - Date Helpers

    const parseDate = (value) => {
      if (!value) return null;

      // Firestore Timestamp from Admin SDK or client SDK
      if (typeof value?.toDate === "function") {
        return value.toDate();
      }

      // Firestore Timestamp-like object sent over HTTPS callable
      if (typeof value?._seconds === "number") {
        return new Date(value._seconds * 1000);
      }

      if (typeof value?.seconds === "number") {
        return new Date(value.seconds * 1000);
      }

      // Milliseconds
      if (typeof value === "number") {
        return new Date(value);
      }

      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day, 12, 0, 0, 0);
      }

      // ISO string or Date-compatible string
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const toFirestoreTimestamp = (value, fallbackDate = null) => {
      const parsed = parseDate(value) || fallbackDate;

      if (!parsed) {
        return null;
      }

      return admin.firestore.Timestamp.fromDate(parsed);
    };

    const normalizeToNoon = (date) => {
      const d = new Date(date);
      d.setHours(12, 0, 0, 0);
      return d;
    };

    const normalizeServiceStopTypeFields = (source, contextLabel) => {
      const hasTypeId = typeof source?.typeId === "string" && source.typeId.trim().length > 0;
      const hasType = typeof source?.type === "string" && source.type.trim().length > 0;
      const fallback = {
        typeId: "system_recurring_service_stop",
        type: "Recurring Service Stop",
        typeImage: "figure.pool.swim",
      };

      const fields = {
        typeId: hasTypeId ? source.typeId : fallback.typeId,
        type: hasType ? source.type : fallback.type,
        typeImage: typeof source?.typeImage === "string" && source.typeImage.trim().length > 0
          ? source.typeImage
          : fallback.typeImage,
      };

      if (!hasTypeId || !hasType) {
        console.warn("[ServiceStopTypeFunction][fallback]", {
          context: contextLabel,
          recurringServiceStopId: source?.id || "",
          incomingTypeId: source?.typeId || "",
          incomingType: source?.type || "",
          resolvedTypeId: fields.typeId,
          resolvedType: fields.type,
        });
      } else {
        console.log("[ServiceStopTypeFunction][resolved]", {
          context: contextLabel,
          recurringServiceStopId: source?.id || "",
          typeId: fields.typeId,
          type: fields.type,
        });
      }

      return fields;
    };

    const recurringServiceStopTypeFields = normalizeServiceStopTypeFields(
      rssData,
      "createFirstRecurringServiceStop2.recurringServiceStop"
    );

    // MARK: - Start / End Dates

    const startDate = parseDate(rssData.startDate) || new Date();
    const endDate = parseDate(rssData.endDate);
    const noEndDate = Boolean(rssData.noEndDate);

    const functionalStartDate = normalizeToNoon(startDate);

    let functionalEndDate;

    if (noEndDate) {
      functionalEndDate = new Date(functionalStartDate);
      functionalEndDate.setDate(functionalEndDate.getDate() + 28);
    } else {
      if (!endDate) {
        throw new Error("No endDate provided but noEndDate is false");
      }

      functionalEndDate = normalizeToNoon(endDate);

      // Seed-only 4 weeks: cap at start + 28 days if endDate extends longer.
      const cap = new Date(functionalStartDate);
      cap.setDate(cap.getDate() + 28);

      if (functionalEndDate > cap) {
        functionalEndDate = cap;
      }
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysBetween = Math.max(
      0,
      Math.floor((functionalEndDate.getTime() - functionalStartDate.getTime()) / msPerDay)
    );

    // MARK: - Load Counter

    let counterPush = 0;

    const settingsDoc = await db.collection(SSIncrementCol).doc("serviceStops").get();

    if (settingsDoc.exists) {
      counterPush = Number(settingsDoc.data()?.increment ?? 0);
    }

    // MARK: - Save RSS Doc

    const upLoadRSSData = {
      ...rssData,
      typeId: recurringServiceStopTypeFields.typeId,
      type: recurringServiceStopTypeFields.type,
      typeImage: recurringServiceStopTypeFields.typeImage,
    };

    upLoadRSSData.dateCreated =
      toFirestoreTimestamp(rssData.dateCreated, new Date()) ||
      admin.firestore.Timestamp.now();

    upLoadRSSData.startDate =
      toFirestoreTimestamp(rssData.startDate, functionalStartDate) ||
      admin.firestore.Timestamp.fromDate(functionalStartDate);

    if (rssData.endDate) {
      upLoadRSSData.endDate = toFirestoreTimestamp(rssData.endDate);
    } else {
      upLoadRSSData.endDate = null;
    }

    await recurringServiceStopDoc.set(upLoadRSSData, { merge: true });

    // MARK: - Create Tasks For Recurring Service Stop

    console.log("create Tasks For Recurring Service Stops");

    const taskGroupId = "com_set_tg_recurring_service_stops";

    const tasksDoc = await db.collection("companies")
      .doc(companyId)
      .collection("settings")
      .doc("taskGroup")
      .collection("taskGroup")
      .doc(taskGroupId)
      .collection("taskItems")
      .get();

    const taskList = [];

    console.log("tasksDoc.length: ", tasksDoc.docs.length);

    for (const taskDoc of tasksDoc.docs) {
      const task = taskDoc.data();

      const taskId = "com_rss_tas_" + uuidv4();

      const recurringServiceStopTask = {
        id: taskId,
        name: String(task.name || "").trim(),
        description: String(task.description || "").trim(),
        type: task.type,
        contractedRate: Number(task.contractedRate || 0),
        estimatedTime: Number(task.estimatedTime || 0),
        status: "Accepted",
        isTaskGroup: true,
        taskGroupId: taskGroupId,
        taskGroupTaskId: task.id,
      };

      taskList.push(recurringServiceStopTask);

      await db.collection("companies")
        .doc(companyId)
        .collection("recurringServiceStop")
        .doc(rssData.id)
        .collection("tasks")
        .doc(taskId)
        .set(recurringServiceStopTask);
    }

    // MARK: - Shared Helpers

    const weekdayArray = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const normalizeDayName = (value) => {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, "");
    };

    const dayNameToIndex = (name) => {
      const normalized = normalizeDayName(name);

      return weekdayArray.findIndex((day) => {
        return normalizeDayName(day) === normalized;
      });
    };

    const alignDateToDayOnOrAfter = (date, dayName) => {
      const targetDow = dayNameToIndex(dayName);

      if (targetDow < 0) {
        throw new Error(`Invalid rssData.day: ${dayName}`);
      }

      const aligned = normalizeToNoon(date);
      const diff = (targetDow - aligned.getDay() + 7) % 7;
      aligned.setDate(aligned.getDate() + diff);
      return aligned;
    };

    const buildServiceStop = (serviceDate) => {
      const idss = "com_ss_" + uuidv4();
      const internalId = "S" + String(counterPush + 1);
      counterPush += 1;

      return {
        id: idss,
        internalId,

        address: {
          city: rssData.address?.city ?? "",
          state: rssData.address?.state ?? "",
          streetAddress: rssData.address?.streetAddress ?? "",
          zip: rssData.address?.zip ?? "",
          latitude: rssData.address?.latitude ?? 0,
          longitude: rssData.address?.longitude ?? 0,
        },

        customerId: rssData.customerId ?? "",
        customerName: rssData.customerName ?? "",

        companyName: "",
        companyId: companyId,

        description: rssData.description ?? "",
        duration: rssData.estimatedTime ?? 15,
        estimatedDuration: rssData.estimatedTime ?? 15,

        isInvoiced: false,
        dateCreated: new Date(),
        serviceDate,

        operationStatus: "Not Finished",
        billingStatus: "Not Invoiced",
        rate: 0,

        recurringServiceStopId: rssData.id,
        tech: rssData.tech ?? "",
        techId: rssData.techId ?? "",

        serviceLocationId: rssData.serviceLocationId ?? "",

        type: recurringServiceStopTypeFields.type,
        typeId: recurringServiceStopTypeFields.typeId,
        typeImage: recurringServiceStopTypeFields.typeImage,

        jobId: "",
        jobName: "",

        checkList: [],
        includeReadings: true,
        includeDosages: true,

        contractedCompanyId: rssData.contractedCompanyId ?? "",
        laborContractId: rssData.laborContractId ?? "",
        otherCompany: Boolean(rssData.otherCompany),
      };
    };

    const uploadStop = async (serviceDate) => {
      const normalizedServiceDate = normalizeToNoon(serviceDate);
      const stop = buildServiceStop(normalizedServiceDate);

      await db.collection(serviceStopsCol).doc(stop.id).set(stop);

      for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i];

        const serviceStopTaskId = "com_ss_tas_" + uuidv4();

        const serviceStopTask = {
          id: serviceStopTaskId,
          name: String(task.name || "").trim(),
          type: task.type,
          status: task.status || "Not Finished",
          contractedRate: Number(task.contractedRate || 0),
          estimatedTime: Number(task.estimatedTime || 0),

          customerApproval: false,
          actualTime: 0,

          workerId: "",
          workerType: "",
          workerName: "",

          laborContractId: "",

          serviceStopId: {
            id: stop.id,
            internalId: stop.internalId || "",
          },

          jobId: {
            id: "",
            internalId: "",
          },

          recurringServiceStopId: {
            id: rssData.id ?? "",
            internalId: rssData.internalId || "",
          },

          jobTaskId: "",
          recurringServiceStopTaskId: task.id,

          equipmentId: "",
          serviceLocationId: stop.serviceLocationId || rssData.serviceLocationId || "",
          bodyOfWaterId: "",
          shoppingListItemId: "",
        };

        await db.collection(serviceStopsCol)
          .doc(stop.id)
          .collection("tasks")
          .doc(serviceStopTaskId)
          .set(serviceStopTask);
      }

      return normalizedServiceDate;
    };

    // MARK: - Frequency Helpers

    const seedDaily = async () => {
      let lastCreated = null;

      for (let counter = 0; counter <= daysBetween; counter++) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter);

        if (d.getTime() > functionalEndDate.getTime()) break;

        lastCreated = await uploadStop(d);
      }

      return lastCreated;
    };

    const seedWeekDay = async () => {
      let lastCreated = null;

      for (let counter = 0; counter <= daysBetween; counter++) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter);

        if (d.getTime() > functionalEndDate.getTime()) break;

        const dow = d.getDay();

        if (dow === 0 || dow === 6) {
          continue;
        }

        lastCreated = await uploadStop(d);
      }

      return lastCreated;
    };

    const seedWeekly = async () => {
      const firstServiceDate = alignDateToDayOnOrAfter(functionalStartDate, rssData.day);
      const targetDow = dayNameToIndex(rssData.day);
      const firstServiceDateDow = firstServiceDate.getDay();

      if (firstServiceDate.getTime() !== normalizeToNoon(functionalStartDate).getTime()) {
        console.warn("Weekly RSS startDate day does not match selected day", {
          rssDay: rssData.day,
          targetDow,
          startDateDow: normalizeToNoon(functionalStartDate).getDay(),
          firstServiceDate: firstServiceDate.toISOString(),
        });
      }

      console.log("Weekly seed debug:", {
        rssDay: rssData.day,
        targetDow,
        firstServiceDateDow,
        firstServiceDate: firstServiceDate.toISOString(),
        functionalEndDate: functionalEndDate.toISOString(),
      });

      let lastCreated = null;

      for (
        let d = new Date(firstServiceDate);
        d.getTime() <= functionalEndDate.getTime();
        d.setDate(d.getDate() + 7)
      ) {
        const serviceDate = normalizeToNoon(d);
        lastCreated = await uploadStop(serviceDate);
      }

      return lastCreated;
    };

    const seedBiWeekly = async () => {
      let lastCreated = null;
      const firstServiceDate = alignDateToDayOnOrAfter(functionalStartDate, rssData.day);

      for (
        let d = new Date(firstServiceDate);
        d.getTime() <= functionalEndDate.getTime();
        d.setDate(d.getDate() + 14)
      ) {
        const serviceDate = normalizeToNoon(d);
        lastCreated = await uploadStop(serviceDate);
      }

      return lastCreated;
    };

    const seedMonthly = async () => {
      let lastCreated = null;

      const first = normalizeToNoon(functionalStartDate);

      if (first.getTime() <= functionalEndDate.getTime()) {
        lastCreated = await uploadStop(first);
      }

      const second = new Date(functionalStartDate);
      second.setMonth(second.getMonth() + 1);
      const normalizedSecond = normalizeToNoon(second);

      if (normalizedSecond.getTime() <= functionalEndDate.getTime()) {
        lastCreated = await uploadStop(normalizedSecond);
      }

      return lastCreated;
    };

    // MARK: - Dispatch

    let lastCreated = null;

    let frequency = String(rssData.frequency || "");

    switch (frequency) {
      case "Daily":
        lastCreated = await seedDaily();
        break;

      case "Week Day":
        lastCreated = await seedWeekDay();
        break;

      case "Weekly":
        lastCreated = await seedWeekly();
        break;

      case "Bi-Weekly":
        lastCreated = await seedBiWeekly();
        break;

      case "Monthly":
        lastCreated = await seedMonthly();
        break;

      case "Yearly":
        // Seed within 4 weeks usually means no yearly seed unless startDate is desired.
        // If you want yearly to create the startDate, uncomment:
        // lastCreated = await uploadStop(functionalStartDate);
        lastCreated = null;
        break;

      default:
        throw new Error(`Unsupported frequency: ${rssData.frequency}`);
    }

    // MARK: - Persist Last Created

    if (lastCreated) {
      await recurringServiceStopDoc.update({
        lastCreated: admin.firestore.Timestamp.fromDate(lastCreated),
      });
    }

    // MARK: - Persist Counter

    await db.collection(SSIncrementCol).doc("serviceStops").set(
      {
        increment: counterPush,
        category: "serviceStops",
      },
      { merge: true }
    );

    // MARK: - Update Recurring Route

    await updateRecurringRoute({ db, companyId, rss: rssData });

    return {
      status: 200,
      rssId: rssData.id,
      lastCreated,
    };
  } catch (error) {
    console.error("Error in createFirstRecurringServiceStop2", error);

    return {
      status: 500,
      error: error?.message ?? String(error),
    };
  }
});
// exports.createFirstRecurringServiceStop2 = functions.https.onCall(async (data, context) => {
//   console.log("createFirstRecurringServiceStop2 (refactored, seed 4 weeks)");

//   try {
//     const companyId = data?.data?.companyId;
//     const rssData = data?.data?.recurringServiceStop;

//     console.log("check mark: " + 1)
//     if (!companyId) throw new Error("Missing Company Id");
//     if (!rssData?.id) throw new Error("Missing Recurring Service Stop Id");

//     console.log("check mark: " + 2)
//     const db = getFirestore();

//     const SSIncrementCol = `companies/${companyId}/settings`;
//     const RSSCol = `companies/${companyId}/recurringServiceStop`;
//     const serviceStopsCol = `companies/${companyId}/serviceStops`;

//     const recurringServiceStopDoc = db.collection(RSSCol).doc(rssData.id);
//     console.log("check mark: " + 3)
//     // ---- Parse Firestore Timestamp / ISO / Date ----
//     const parseDate = (d) => {
//       if (!d) return null;
//       if (typeof d?.toDate === "function") return d.toDate();
//       const dt = new Date(d);
//       return isNaN(dt.getTime()) ? null : dt;
//     };
//     console.log("check mark: " + 4)
//     const startDate = parseDate(rssData.startDate) || new Date(); // iOS uses startDate
//     const endDate = parseDate(rssData.endDate); // optional
//     const noEndDate = Boolean(rssData.noEndDate);
//     console.log("check mark: " + 5)
//     // ---- Determine functionalEndDate like iOS helpers ----
//     // iOS: if noEndDate -> end = start + 28 days
//     // else -> require endDate (but you said seed-only 4 weeks; we will cap anyway)
//     const functionalStartDate = new Date(startDate);
//     functionalStartDate.setHours(12, 0, 0, 0);
//     console.log("check mark: " + 6)
//     let functionalEndDate;
//     if (noEndDate) {
//       functionalEndDate = new Date(functionalStartDate);
//       functionalEndDate.setDate(functionalEndDate.getDate() + 28);
//     } else {
//       if (!endDate) throw new Error("No endDate provided but noEndDate is false");
//       functionalEndDate = new Date(endDate);
//       // Seed-only 4 weeks: cap at start+28 if endDate extends longer
//       const cap = new Date(functionalStartDate);
//       cap.setDate(cap.getDate() + 28);
//       if (functionalEndDate > cap) functionalEndDate = cap;
//     }
//     console.log("check mark: " + 7)

//     // daysBetween like iOS: dateComponents day difference
//     const msPerDay = 24 * 60 * 60 * 1000;
//     const daysBetween = Math.max(
//       0,
//       Math.floor((functionalEndDate.getTime() - functionalStartDate.getTime()) / msPerDay)
//     );

//     console.log("check mark: " + 8)
//     // ---- Load counter ----
//     let counterPush = 0;
//     const settingsDoc = await db.collection(SSIncrementCol).doc("serviceStops").get();
//     if (settingsDoc.exists) {
//       counterPush = Number(settingsDoc.data()?.increment ?? 0);
//     }

//     console.log("check mark: " + 9)
//     // ---- Save RSS doc (merge) ----

//     let upLoadRSSData = rssData
//     upLoadRSSData.dateCreated = admin.firestore.Timestamp.fromMillis(rssData.dateCreated);
//     upLoadRSSData.startDate = admin.firestore.Timestamp.fromMillis(rssData.startDate);
//     upLoadRSSData.endDate = admin.firestore.Timestamp.fromMillis(rssData.endDate);
//     await recurringServiceStopDoc.set(upLoadRSSData, { merge: true });


//     //Create Tasks for Recurring service stops
//     console.log("create Tasks For Recurring Service Stops")
//     let taskGroupId = "com_set_tg_recurring_service_stops"
//     console.log("create Tasks For Recurring Service Stops: " + 1)
//     //Get task group settings
//     // get tasks from task subcollection
//     const tasksDoc = await db.collection("companies")
//       .doc(companyId)
//       .collection("settings")
//       .doc("taskGroup")
//       .collection("taskGroup")
//       .doc(taskGroupId)
//       .collection("taskItems")
//       .get();
//     let taskList = []

//     console.log("create Tasks For Recurring Service Stops: " + 2)
//     console.log(tasksDoc)

//     //Add Tasks to Task Group

//     console.log("tasksDoc.length: ", tasksDoc.docs.length)
//     for (const taskDoc of tasksDoc.docs) {
//       const task = taskDoc.data();
//       console.log("task: ", task)
//       let taskId = "com_rss_tas_" + uuidv4()
//       let recurringServiceStopTask = {
//         id: taskId,
//         name: task.name.trim(),
//         description: task.description.trim(),
//         type: task.type,
//         contractedRate: Number(task.contractedRate || 0),
//         estimatedTime: Number(task.estimatedTime || 0),
//         status: "Accepted",
//         isTaskGroup: true,
//         taskGroupId: taskGroupId,
//         taskGroupTaskId: task.id
//       }
//       taskList.push(recurringServiceStopTask)

//       await db.collection("companies").doc(companyId)
//         .collection("recurringServiceStop").doc(rssData.id)
//         .collection("tasks").doc(taskId).set(recurringServiceStopTask);
//     }

//     //create recurring service stop tasks

//     // ---- shared helpers ----
//     const weekdayArry = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
//     const dayNameToIndex = (name) => weekdayArry.indexOf(name);

//     const buildServiceStop = (serviceDate) => {
//       const idss = "com_ss_" + uuidv4();
//       const internalId = "S" + String(counterPush + 1);
//       counterPush += 1;

//       return {
//         id: idss,
//         internalId,
//         address: {
//           city: rssData.address?.city,
//           state: rssData.address?.state,
//           streetAddress: rssData.address?.streetAddress,
//           zip: rssData.address?.zip,
//           latitude: rssData.address?.latitude,
//           longitude: rssData.address?.longitude,
//         },
//         customerId: rssData.customerId,
//         customerName: rssData.customerName,
//         companyName: "",
//         contractedCompanyId: "",
//         companyId: companyId,
//         customerName: rssData.customerName,
//         description: rssData.description,
//         duration: rssData.estimatedTime ?? 15,
//         estimatedDuration: rssData.estimatedTime ?? 15,
//         isInvoiced: false,
//         dateCreated: new Date(),
//         serviceDate,
//         operationStatus: "Not Finished",
//         billingStatus: "Not Invoiced",
//         rate: 0,
//         recurringServiceStopId: rssData.id,
//         tech: rssData.tech,
//         serviceLocationId: rssData.serviceLocationId,
//         techId: rssData.techId,
//         type: rssData.type,
//         typeId: rssData.typeId,
//         typeImage: rssData.typeImage,
//         jobId: "",
//         jobName: "",
//         checkList: [],
//         includeReadings: true,
//         includeDosages: true,
//         contractedCompanyId: rssData.contractedCompanyId ?? "",
//         laborContractId: rssData.laborContractId ?? "",
//         otherCompany: Boolean(rssData.otherCompany) ?? false,
//       };
//     };

//     const uploadStop = async (serviceDate) => {
//       //upload service stop
//       const stop = buildServiceStop(serviceDate);
//       await db.collection(serviceStopsCol).doc(stop.id).set(stop);

//       //upload tasks
//       for (let i = 0; i < taskList.length; i++) {
//         console.log("task: ", taskList[i])
//         let task = taskList[i];
//         const serviceStopTaskId = "com_ss_tas_" + uuidv4();
//         const serviceStopTask = {
//           id: serviceStopTaskId,
//           name: task.name.trim(),
//           type: task.type,
//           status: task.status || "Not Finished",
//           contractedRate: Number(task.contractedRate || 0),
//           estimatedTime: Number(task.estimatedTime || 0),
//           customerApproval: false,
//           actualTime: 0,

//           workerId: "",
//           workerType: "",
//           workerName: "",

//           laborContractId: "",

//           serviceStopId: {
//             id: stop.id,
//             internalId: stop.internalId || "",
//           },
//           jobId: {
//             id: "",
//             internalId: "",
//           },
//           recurringServiceStopId: {
//             id: rssData.id ?? "",
//             internalId: rssData.internalId || "",
//           },
//           jobTaskId: "",
//           recurringServiceStopTaskId: task.id,
//           equipmentId: "",
//           serviceLocationId: stop.serviceLocationId || rssData.serviceLocationId || "",
//           bodyOfWaterId: "",
//           shoppingListItemId: "",
//         };
//         await db.collection(serviceStopsCol).doc(stop.id).collection("tasks").doc(serviceStopTaskId).set(serviceStopTask);
//       }
//       return serviceDate;
//     };

//     // ---- Frequency helpers (mirror iOS) ----
//     const seedDaily = async () => {
//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter++) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + counter); // startDate + counter
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     const seedWeekDay = async () => {
//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter++) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + counter);
//         const dow = d.getDay();
//         if (dow === 0 || dow === 6) continue; // skip Sat/Sun
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     // Intended iOS weekly behavior: choose next occurrence of rssData.day from startDate, then +7 each time
//     const seedWeekly = async () => {
//       const targetDow = dayNameToIndex(rssData.day);
//       if (targetDow < 0) throw new Error(`Invalid rssData.day: ${rssData.day}`);

//       const startDow = functionalStartDate.getDay();
//       let diff = targetDow - startDow;
//       if (diff < 0) diff += 7;

//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter += 7) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + diff + counter);
//         if (d.getTime() > functionalEndDate.getTime()) break;
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     const seedBiWeekly = async () => {
//       // iOS biweekly: startDate + 0, +14, (+28 if within range)
//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter += 14) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + counter);
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     const seedMonthly = async () => {
//       // Fix iOS infinite loop: create startDate, then +1 month if still within window
//       let lastCreated = null;

//       const first = new Date(functionalStartDate);
//       if (first.getTime() <= functionalEndDate.getTime()) {
//         lastCreated = await uploadStop(first);
//       }

//       const second = new Date(functionalStartDate);
//       second.setMonth(second.getMonth() + 1);

//       if (second.getTime() <= functionalEndDate.getTime()) {
//         lastCreated = await uploadStop(second);
//       }

//       return lastCreated;
//     };

//     // ---- Dispatch ----
//     let lastCreated = null;
//     switch (String(rssData.frequency)) {
//       case "Daily":
//         lastCreated = await seedDaily();
//         break;
//       case "Week Day":
//         lastCreated = await seedWeekDay();
//         break;
//       case "Weekly":
//         lastCreated = await seedWeekly();
//         break;
//       case "Bi-Weekly":
//         lastCreated = await seedBiWeekly();
//         break;
//       case "Monthly":
//         lastCreated = await seedMonthly();
//         break;
//       case "Yearly":
//         // Not in iOS; seed within 4 weeks usually means just startDate if you want it.
//         // Keep as no-op unless you want otherwise.
//         lastCreated = null;
//         break;
//       default:
//         throw new Error(`Unsupported frequency: ${rssData.frequency}`);
//     }

//     // ---- Persist lastCreated consistently (recommended) ----
//     if (lastCreated) {

//       await recurringServiceStopDoc.update({ lastCreated });
//     }

//     // ---- Persist counter ----
//     await db.collection(SSIncrementCol).doc("serviceStops").set(
//       { increment: counterPush, category: "serviceStops" },
//       { merge: true }
//     );


//     //Call Update Recrurring Route.
//     updateRecurringRoute(db, companyId, rssData)

//     return {
//       status: 200,
//       rssId: rssData.id,
//       createdCount:
//         String(rssData.frequency) === "Daily"
//           ? daysBetween
//           : undefined, // optional: you can compute exact count if you want
//       lastCreated,
//     };
//   } catch (error) {
//     console.error("Error in createFirstRecurringServiceStop", error);
//     return { status: 500, error: error?.message ?? String(error) };
//   }
// });

async function updateRecurringRoute({ db, companyId, rss } = {}) {
  try {
    if (!db || typeof db.collection !== "function") {
      throw new Error("updateRecurringRoute requires a valid Firestore instance.");
    }

    if (!companyId || !rss?.id) {
      console.log("[updateRecurringRoute] Missing companyId or recurring service stop id. Skipping route update.", {
        companyId,
        recurringServiceStopId: rss?.id || "",
      });
      return [];
    }

    if (!rss.day || !rss.techId) {
      console.log("[updateRecurringRoute] Missing day or techId. Skipping route update.", {
        recurringServiceStopId: rss.id,
        day: rss.day || "",
        techId: rss.techId || "",
      });
      return [];
    }

    // Match the same collection/fields used by handleSaveTemplate
    const recurringRoutesRef = db
      .collection("companies")
      .doc(companyId)
      .collection("recurringRoutes");

    const querySnapshot = await recurringRoutesRef
      .where("day", "==", rss.day)
      .where("techId", "==", rss.techId)
      .get();

    const updatedRouteIds = [];

    for (const routeDoc of querySnapshot.docs) {
      const documentData = routeDoc.data();
      const currentOrder = Array.isArray(documentData.order) ? documentData.order : [];

      // Avoid duplicate insertion if this RSS is already present
      const alreadyExists = currentOrder.some(
        (item) => item.recurringServiceStopId === rss.id
      );

      if (alreadyExists) {
        continue;
      }

      const addedOrder = {
        id: uuidv4(),
        order: currentOrder.length + 1,
        recurringServiceStopId: rss.id,
        customerId: rss.customerId,
        customerName: rss.customerName,
        locationId: rss.serviceLocationId,
      };

      const updatedOrder = [...currentOrder, addedOrder];

      const routeRef = recurringRoutesRef.doc(routeDoc.id);

      await routeRef.update({
        order: updatedOrder,
        rssIds: admin.firestore.FieldValue.arrayUnion(rss.id),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      updatedRouteIds.push(routeDoc.id);
    }

    return updatedRouteIds;
  } catch (error) {
    console.log("Error updating recurring route:", error);
    throw error;
  }
}

exports.createFirstRecurringServiceStop = functions.https.onCall(async (data, context) => {

  console.log('create FirstRecurring ServiceStop')
  console.log(data)

  let weekdayArry = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  let companyId = data.data.companyId
  let rssData = data.data.recurringServiceStop
  const rssTypeFields = normalizeRecurringStopTypeFieldsForFunction(
    rssData,
    "createFirstRecurringServiceStop.legacy"
  );
  rssData = {
    ...rssData,
    typeId: rssTypeFields.typeId,
    type: rssTypeFields.type,
    typeImage: rssTypeFields.typeImage,
  };

  console.log(rssData)
  try {

    console.log("Creating More Service Stops For Rss", rssData.id);
    // const counter = 0;
    // const monthCounter = 0;
    let numFrequency = 0;
    // const lastCreated = new Date();
    const standardFrequency = rssData.frequency;
    // const customFrequencyType = rssData.customFrequencyType;
    // let custom = false;
    // let skipWeekEnds = false;

    let counterPush = 0;

    let serviceDate = new Date()
    let date = new Date()
    let currentDayOfWeek = 0
    let serviceDayOfWeek = 0


    const SSIncrementCol = "companies/" + companyId + "/settings";
    const RSSCol = "companies/" + companyId + "/recurringServiceStop";
    const rssDocRef = "companies/" + companyId + "/recurringServiceStop";
    const docRef = "companies/" + companyId + "/serviceStops";

    let recurringServiceStopDoc = getFirestore().collection(RSSCol).doc(rssData.id);
    //Gets Internal Service Stop Count

    await getFirestore()
      .collection(SSIncrementCol)
      .doc("serviceStops")
      .get().then((doc) => {
        if (doc.exists) {
          console.log("Settings data:", doc.data());
          counterPush = doc.data().increment
        } else {
          // doc.data() will be undefined in this case
          console.log("No Service Stop Setting Docuement");
        }
      }).catch((error) => {
        console.log("Error getting document:", error);
      });

    //Uploads Recurring Service Stop 
    await getFirestore()
      .collection(rssDocRef).doc(rssData.id)
      .set(rssData);

    switch (standardFrequency) {
      // Daily
      case "Daily":
        console.log('Creating Daily')
        numFrequency = 7;
        let date1 = new Date(rssData.lastCreated);

        let serviceDate1 = date1

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({ lastCreated: date1 });


        for (let i = 0; i < 28; i++) {

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //

          serviceDate1.setDate(serviceDate1.getDate() + 1);


          console.log('Week Day ', weekdayArry[serviceDate1.getDay()])
          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({ lastCreated: serviceDate1 });

          const idss = 'com_ss_' + uuidv4()

          let serviceStop = {
            address: {
              city: rssData.address.city,
              state: rssData.address.state,
              streetAddress: rssData.address.streetAddress,
              zip: rssData.address.zip,
              latitude: rssData.address.latitude,
              longitude: rssData.address.longitude,
            },
            customerId: rssData.customerId,
            customerName: rssData.customerName,
            description: rssData.description,
            duration: rssData.estimatedTime ?? 15,
            // duration: 15,
            dateCreated: new Date(),
            serviceDate: serviceDate1,
            operationStatus: "Not Started",
            billingStatus: "Not Invoiced",
            rate: 0,
            recurringServiceStopId: rssData.id,
            tech: rssData.tech,
            serviceLocationId: rssData.serviceLocationId,
            techId: rssData.techId,
            type: rssData.type,
            typeId: rssData.typeId,
            typeImage: rssData.typeImage,
            jobId: "",
            jobName: "Cleaning - Update",
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings: true,
            includeDosages: true,
            contractedCompanyId: rssData.contractedCompanyId,
            laborContractId: rssData.laborContractId,
            otherCompany: rssData.otherCompany,

          }

          //
          //Uploading the service Stop
          //

          await getFirestore()
            .collection(docRef).doc(idss)
            .set(serviceStop);
        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate2);
        break;
      case "Week Day":
        console.log('Creating Week Day')
        numFrequency = 7;
        let date2 = new Date(rssData.lastCreated);

        let serviceDate2 = date2

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({ lastCreated: date2 });


        for (let i = 0; i < 28; i++) {

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //

          serviceDate2.setDate(serviceDate2.getDate() + 1);

          if (serviceDate2.getDay() != 0 && serviceDate2.getDay() != 6) {

            console.log('Week Day ', weekdayArry[serviceDate2.getDay()])
            const newInternalId = "S" + String(counterPush + 1);

            counterPush = counterPush + 1;

            //
            //Update Recurring Service Stop with last Created Service Stop 
            //

            await recurringServiceStopDoc.update({ lastCreated: serviceDate2 });

            const idss = 'com_ss_' + uuidv4()

            let serviceStop = {
              address: {
                city: rssData.address.city,
                state: rssData.address.state,
                streetAddress: rssData.address.streetAddress,
                zip: rssData.address.zip,
                latitude: rssData.address.latitude,
                longitude: rssData.address.longitude,
              },
              customerId: rssData.customerId,
              customerName: rssData.customerName,
              description: rssData.description,
              //duration: Int(rssData.estimatedTime),
              duration: rssData.estimatedTime ?? 15,
              dateCreated: new Date(),
              serviceDate: serviceDate2,
              operationStatus: "Not Started",
              billingStatus: "Not Invoiced",
              rate: 0,
              recurringServiceStopId: rssData.id,
              tech: rssData.tech,
              serviceLocationId: rssData.serviceLocationId,
              techId: rssData.techId,
              type: rssData.type,
              typeId: rssData.typeId,
              typeImage: rssData.typeImage,
              jobId: "",
              jobName: "Cleaning - Update",
              internalId: newInternalId,
              id: idss,
              checkList: [],
              includeReadings: true,
              includeDosages: true,
              contractedCompanyId: rssData.contractedCompanyId,
              laborContractId: rssData.laborContractId,
              otherCompany: rssData.otherCompany,

            }

            //
            //Uploading the service Stop
            //

            await getFirestore()
              .collection(docRef).doc(idss)
              .set(serviceStop);
          } else {
            console.log('Weekend  ', weekdayArry[serviceDate2.getDay()], ' - Skip')
          }
        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate2);
        break;
      case "Weekly":
        console.log("Creating Weekly")
        date = new Date(rssData.lastCreated);

        serviceDate = date

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({ lastCreated: date });

        //
        //  Get Day of week represented as number 0 - 6 (Sunday - Saturday)
        //
        currentDayOfWeek = date.getDay();

        //
        //  Gets Service Day as number
        //
        serviceDayOfWeek = 0

        console.log('Switch')

        switch (rssData.day) {
          case 'Sunday':
            console.log('Sunday - ', rssData.day)
            serviceDayOfWeek = 0
            break;
          case 'Monday':
            console.log('Monday - ', rssData.day)
            serviceDayOfWeek = 1
            break;
          case 'Tuesday':
            console.log('Tuesday - ', rssData.day)
            serviceDayOfWeek = 2
            break;
          case 'Wednesday':
            console.log('Wednesday - ', rssData.day)
            serviceDayOfWeek = 3
            break;
          case 'Thursday':
            console.log('Thursday - ', rssData.day)
            serviceDayOfWeek = 4
            break;
          case 'Friday':
            console.log('Friday - ', rssData.day)
            serviceDayOfWeek = 5
            break;
          case 'Saturday':
            console.log('Saturday - ', rssData.day)
            serviceDayOfWeek = 6
            break;
          default:
            console.log('Default - ', rssData.day)
            serviceDayOfWeek = 6
            break;
        }

        for (let i = 0; i < 4; i++) {

          //
          //  Compare the two to determine how to create the first service stop. If the difference is negative that day of week has already passed and creating the service stops will start next week by adding 6
          //  if it is positive, add the difference to count which should create the service stop this week
          //
          let differenceInServiceDays = (serviceDayOfWeek + 1) - (currentDayOfWeek + 1)
          let amountToIncrease = 0

          if (differenceInServiceDays < 0) {

            amountToIncrease = differenceInServiceDays + 7
            // } else if (differenceInServiceDays == 0) {
            //   amountToIncrease = 0
          } else {
            amountToIncrease = differenceInServiceDays
          }

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          let amountToIncreaseThisWeek = (amountToIncrease + (i * 7))

          // serviceDate.setFullYear(year, month, day + amountToIncreaseThisWeek );
          let updatedDate = new Date()
          updatedDate.setDate(updatedDate.getDate() + amountToIncreaseThisWeek);
          serviceDate = updatedDate

          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;


          console.log('Service Day Of Week: ', weekdayArry[serviceDate.getDay()], ' - Service Date: ', serviceDate)

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({ lastCreated: serviceDate });


          const idss = 'com_ss_' + uuidv4()

          let serviceStop = {
            address: {
              city: rssData.address.city,
              state: rssData.address.state,
              streetAddress: rssData.address.streetAddress,
              zip: rssData.address.zip,
              latitude: rssData.address.latitude,
              longitude: rssData.address.longitude,
            },
            customerId: rssData.customerId,
            customerName: rssData.customerName,
            description: rssData.description,
            //duration: Int(rssData.estimatedTime),
            duration: rssData.estimatedTime ?? 15,
            dateCreated: new Date(),
            serviceDate: serviceDate,
            operationStatus: "Not Started",
            billingStatus: "Not Invoiced",
            rate: 0,
            recurringServiceStopId: rssData.id,
            tech: rssData.tech,
            serviceLocationId: rssData.serviceLocationId,
            techId: rssData.techId,
            type: rssData.type,
            typeId: rssData.typeId,
            typeImage: rssData.typeImage,
            jobId: "",
            jobName: "Cleaning - Update",
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings: true,
            includeDosages: true,
            contractedCompanyId: rssData.contractedCompanyId,
            laborContractId: rssData.laborContractId,
            otherCompany: rssData.otherCompany,

          }
          console.log("Service Stop: ", serviceStop)
          //
          //Uploading the service Stop
          //

          await getFirestore()
            .collection(docRef).doc(idss)
            .set(serviceStop);
          console.log("Successfully Adding New Service Stop")
        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate);
        break;
      case "Bi-Weekly":
        console.log("Creating Bi-Weekly")
        date = new Date(rssData.lastCreated);

        serviceDate = date

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({ lastCreated: date });

        //
        //  Get Day of week represented as number 0 - 6 (Sunday - Saturday)
        //
        currentDayOfWeek = date.getDay();

        //
        //  Gets Service Day as number
        //
        serviceDayOfWeek = 0

        console.log('Switch')

        switch (rssData.day) {
          case 'Sunday':
            console.log('Sunday - ', rssData.day)
            serviceDayOfWeek = 0
            break;
          case 'Monday':
            console.log('Monday - ', rssData.day)
            serviceDayOfWeek = 1
            break;
          case 'Tuesday':
            console.log('Tuesday - ', rssData.day)
            serviceDayOfWeek = 2
            break;
          case 'Wednesday':
            console.log('Wednesday - ', rssData.day)
            serviceDayOfWeek = 3
            break;
          case 'Thursday':
            console.log('Thursday - ', rssData.day)
            serviceDayOfWeek = 4
            break;
          case 'Friday':
            console.log('Friday - ', rssData.day)
            serviceDayOfWeek = 5
            break;
          case 'Saturday':
            console.log('Saturday - ', rssData.day)
            serviceDayOfWeek = 6
            break;
          default:
            console.log('Default - ', rssData.day)
            serviceDayOfWeek = 6
            break;
        }

        for (let i = 0; i < 4; i++) {

          //
          //  Compare the two to determine how to create the first service stop. If the difference is negative that day of week has already passed and creating the service stops will start next week by adding 6
          //  if it is positive, add the difference to count which should create the service stop this week
          //
          let differenceInServiceDays = (serviceDayOfWeek + 1) - (currentDayOfWeek + 1)
          let amountToIncrease = 0

          if (differenceInServiceDays < 0) {

            amountToIncrease = differenceInServiceDays + 7
            // } else if (differenceInServiceDays == 0) {
            //   amountToIncrease = 0
          } else {
            amountToIncrease = differenceInServiceDays
          }

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          let amountToIncreaseThisWeek = (amountToIncrease + (i * 14))

          // serviceDate.setFullYear(year, month, day + amountToIncreaseThisWeek );
          let updatedDate = new Date()
          updatedDate.setDate(updatedDate.getDate() + amountToIncreaseThisWeek);
          serviceDate = updatedDate

          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;


          console.log('Service Day Of Week - Check - ', weekdayArry[serviceDate.getDay()], ' ', serviceDate)
          console.log()

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({ lastCreated: serviceDate });


          const idss = 'com_ss_' + uuidv4()

          let serviceStop = {
            address: {
              city: rssData.address.city,
              state: rssData.address.state,
              streetAddress: rssData.address.streetAddress,
              zip: rssData.address.zip,
              latitude: rssData.address.latitude,
              longitude: rssData.address.longitude,
            },
            customerId: rssData.customerId,
            customerName: rssData.customerName,
            description: rssData.description,
            //duration: Int(rssData.estimatedTime),
            duration: rssData.estimatedTime ?? 15,
            dateCreated: new Date(),
            serviceDate: serviceDate,
            operationStatus: "Not Started",
            billingStatus: "Not Invoiced",
            rate: 0,
            recurringServiceStopId: rssData.id,
            tech: rssData.tech,
            serviceLocationId: rssData.serviceLocationId,
            techId: rssData.techId,
            type: rssData.type,
            typeId: rssData.typeId,
            typeImage: rssData.typeImage,
            jobId: "",
            jobName: "Cleaning - Update",
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings: true,
            includeDosages: true,
            contractedCompanyId: rssData.contractedCompanyId,
            laborContractId: rssData.laborContractId,
            otherCompany: rssData.otherCompany,

          }
          //
          //Uploading the service Stop
          //
          await getFirestore()
            .collection(docRef).doc(idss)
            .set(serviceStop);

        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate);
        break;
      case "Monthly":
        numFrequency = 30;
        // everyweekday
        break;
      case "Yearly":
        numFrequency = 1;
        // skipWeekEnds = true;
        // Custom
        break;

      default:
        numFrequency = 100;
    }
    await getFirestore()
      .collection(SSIncrementCol)
      .doc("serviceStops")
      .set({
        increment: counterPush,
        category: "serviceStops",
      });
    console.log("New Service Stop Count ", counterPush);


    console.log('Successfully Created')
    return {
      status: 200,
      rssId: rssData.id
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Create New Recurring Service Stop API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

exports.deleteUser = functions.https.onCall(async (data, context) => {
  try {
    console.log('Deleting User NOt Up and running')
  } catch {
    console.log(error)
  }
})

exports.createCompanyAfterSignUp = functions.https.onCall(async (data, context) => {
  /*
  Should Receive User Id, Company Name, Owner Name
  */

  console.log('Creating All functions for company')
  let receivedData = data.data
  console.log("Received Data")
  console.log(receivedData)
  let ownerId = receivedData.ownerId
  let ownerName = receivedData.ownerName
  let companyName = receivedData.companyName
  let email = receivedData.email
  let phoneNumber = receivedData.phoneNumber
  let zipCodes = receivedData.zipCodes
  let services = receivedData.services
  const companyId = 'com_' + uuidv4()
  try {
    //Body Of function

    //Create Company
    let company = {
      id: companyId,
      ownerId: ownerId,
      ownerName: ownerName,
      name: companyName,
      photoUrl: null,
      dateCreated: new Date(),
      email: email,
      phoneNumber: phoneNumber,
      verified: false,
      hideFromBrowse: false,
      serviceZipCodes: zipCodes,
      services: services,
      accountType: "Free",
      paidUntil: new Date(),
      status: "Free",
      stripeConnectAccountStatus: "Not Started",
      yelpURL: "",
      websiteURL: ""

    }
    await getFirestore()
      .collection("companies").doc(companyId)
      .set(company);
    console.log("Finished Creating Company")

    //Create First Company User
    const companyUserId = 'com_cu' + uuidv4()
    let companyUser = {
      id: companyUserId,
      userId: ownerId,
      userName: ownerName,
      roleId: "1",
      roleName: "Owner",
      dateCreated: new Date(),
      status: "Active",
      workerType: "Employee"
    }
    await getFirestore()
      .collection("companies").doc(companyId).collection("companyUsers").doc(companyUserId)
      .set(companyUser);
    console.log("Finished Creating Company User")

    //Create Company Settings
    //Pay Statements
    const PayStatementsIncrement = { category: "payStatements", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("payStatements").set(PayStatementsIncrement);
    //Pay Line Items
    const PayLineItemsIncrement = { category: "payLineItems", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("payLineItems").set(PayLineItemsIncrement);
    //Payroll Settings
    const CompanyPaySettings = {
      companyId: companyId,
      payMode: "productionOnly",
      routePaySource: "serviceStopAndCompletedTasks",
      taskPaySource: "technicianRateThenTaskContractedRate",
      hourlyPaySource: "none",
      allowMultipleWorkTypesPerStop: true,
      defaultStackBehavior: "stackable",
      allowTechnicianRateOverrides: true,
      allowManualPayAdjustments: false,
      payCommercialAsSeparateWorkType: true,
      paySpaAsSeparateWorkType: true,
      payPerBodyOfWater: true,
      commercialMultiBodyPayStyle: "basePlusAdditionalBodyRate",
      lockPayAfterApproval: true,
      recalculateUnapprovedPayWhenRatesChange: true
    }
    await getFirestore().collection("companies").doc(companyId).collection("paySettings").doc("main").set(CompanyPaySettings);
    //WO
    const WOIncrement = { category: "workOrders", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("workOrders").set(WOIncrement);

    //SS
    const SSIncrement = { category: "serviceStops", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("serviceStops").set(SSIncrement);

    //RSS
    const RIncrement = { category: "receipts", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("receipts").set(RIncrement);

    //Route
    const RountIncrement = { category: "recurringServiceStops", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("recurringServiceStops").set(RountIncrement);

    // Vendor
    const StoreIncrement = { category: "vendors", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("vendors").set(StoreIncrement);

    //To Do
    const ToDoIncrement = { category: "toDos", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("toDos").set(ToDoIncrement);
    console.log("Finished Creating Company Settings")

    // Create initial work-order settings, readings, and dosages.
    // Reusable job templates live at companies/{companyId}/jobTemplates.
    // Internal work-order identifiers/increments live under settings/workOrders.

    //Initial Service Stops 
    // "companies/\(companyId)/settings/serviceStops/serviceStops"

    //Inital Readings
    console.log("Initial Reading Template Created")

    //Get Universal Readings Templates "universal/settings/readingTemplates
    await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("readingTemplates")
      .get().then((querySnapshot) => {
        querySnapshot.forEach(async (doc) => {
          console.log("Reading Template:", doc.id, " => ", doc.data());

          let documentData = doc.data()
          //Then Make local reaings
          let readingsTemplate = {
            id: 'com_set_rt_' + uuidv4(),
            readingsTemplateId: documentData.id,
            name: documentData.name,
            amount: documentData.amount,
            UOM: documentData.UOM,
            chemType: documentData.chemType,
            linkedDosage: documentData.linkedDosage,
            editable: documentData.editable,
            order: documentData.order,
            highWarning: documentData.highWarning,
            lowWarning: documentData.lowWarning,
          }
          //companies/\(companyId)/settings/readings/readings
          await getFirestore().collection("companies").doc(companyId).collection("settings").doc("readings").collection("readings").doc(readingsTemplate.id).set(readingsTemplate);

        });
      })
      .catch((error) => {
        console.log("Error getting Universal Readings documents: ", error);
      });
    console.log("Initial Dosage Template Created")

    //Inital Dosages
    //Get Universal Dosages Templates "universal/settings/dosageTemplates
    await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("dosageTemplates")
      .get().then((querySnapshot) => {
        querySnapshot.forEach(async (doc) => {
          console.log("Dosage Template:", doc.id, " => ", doc.data());

          let documentData = doc.data()

          let dosageTemplate = {
            id: 'com_set_dt_' + uuidv4(),
            dosageTemplateId: documentData.id,
            name: documentData.name,
            amount: documentData.amount,
            UOM: documentData.UOM,
            rate: documentData.rate,
            linkedItemId: "",
            strength: documentData.strength,
            editable: documentData.editable,
            chemType: documentData.chemType,
            order: documentData.order,
          }
          //"companies/\(companyId)/settings/dosages/dosages
          await getFirestore().collection("companies").doc(companyId).collection("settings").doc("dosages").collection("dosages").doc(dosageTemplate.id).set(dosageTemplate);

        });
      })
      .catch((error) => {
        console.log("Error getting Universal Dosages documents: ", error);
      });

    //Create Generic Billing Templates
    //Create Generic Training Templates

    //Creat first set of task groups
    console.log("Initial Task Group Created")
    const taskList = [
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Brush",
        description: "Brush pool surface",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Skim",
        description: "Skim pool surface",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Vacuum",
        description: "Vacuum pool surface",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Empty Baskets",
        description: "Empty skimmer and pump baskets",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Check Equipment",
        description: "Check equipment",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
    ]

    console.log("Number of tasks: ", taskList.length)
    const groupId = 'com_set_tg_recurring_service_stops'

    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("taskGroups").collection("taskGroups").doc(groupId).set({
      id: groupId,
      groupName: "Weekly Service",
      numberOfTasks: taskList.length,
      canDelete: false,
    });

    console.log("Add Tasks to Task Group")
    //Add Tasks to Task Group
    for (let i = 0; i < taskList.length; i++) {
      let task = taskList[i];
      console.log("Tasks:", task.id, " => ", task);
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("taskGroups").collection("taskGroups").doc(groupId).collection("taskItems").doc(task.id).set({
        id: task.id,
        name: task.name,
        description: task.description,
        typeId: task.typeId,
        type: task.type,
        contractedRate: task.contractedRate,
        estimatedTime: task.estimatedTime,
      });
    }
    //Create Generic Roles

    let ownerRole = {
      id: "1",
      name: "Owner",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "All Permissions Enabled"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(ownerRole.id).set(ownerRole);
    console.log("Role Created =>", ownerRole)

    let techRole = {
      id: "comp_role_" + uuidv4(),
      name: "Tech",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Techs"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(techRole.id).set(techRole);
    console.log("Role Created =>", techRole)

    let managerRole = {
      id: "comp_role_" + uuidv4(),
      name: "Manager",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Manager"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(managerRole.id).set(managerRole);
    console.log("Role Created =>", managerRole)

    let adminRole = {
      id: "comp_role_" + uuidv4(),
      name: "Admin",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Admin"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(adminRole.id).set(adminRole);
    console.log("Role Created =>", adminRole)

    let officeRole = {
      id: "comp_role_" + uuidv4(),
      name: "Office",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Office Personal"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(officeRole.id).set(officeRole);
    console.log("Role Created =>", officeRole)

    //Create User Access
    let userAccess = {
      id: companyId,
      companyId: companyId,
      companyName: companyName,
      roleId: "1",
      roleName: "Owner",
      dateCreated: new Date()
    }
    await getFirestore().collection("users").doc(ownerId).collection("userAccess").doc(userAccess.id).set(userAccess);

    //Set Up Company Email COnfiguration
    let emailConfiguration = {
      id: uuidv4(),
      emailIsOn: false,
      emailBody: "Thank you For letting " + companyName + " service your pool",
      requirePhoto: false,
      serviceStopCategorySettings: defaultServiceStopCategoryEmailSettings(companyName)
    }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("emailConfiguration").set(emailConfiguration);
    console.log("Set Up email Confirmation")
    // Moves to stripe function that does on user create. 

    // //Create Stripe Customer. Check out createStripeCustomer for refrence
    // 1. Create a customer in Stripe
    const customer = await stripe.customers.create({
      email: email,
      name: ownerName,
    });

    const compDocRef2 = db.collection('companies').doc(companyId);
    await compDocRef2.set({
      stripeId: customer.id, // CORRECTED FIELD NAME
    }, { merge: true });

    console.log(`Successfully Created Stripe customer: ${customer.id}`);
    //2. Create Connected Account. Check out createNewStripeAccount for refrence
    const account = await stripe.accounts.create({
      type: 'express', // or 'standard', 'custom'
      country: 'US', // or the relevant country
      email: email, // Collect email from your React app
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      // ... other account details as needed

    });
    console.log('account: ', account)

    console.log('Successfully Created New Stripe Connected Account: ', account.id)
    // 3. Save the Stripe customer ID to the user's document in Firestore
    await compDocRef2.set({
      stripeConnectedAccountId: account.id,
    }, { merge: true });

    console.log(`Stripe customer ID ${customer.id} saved for user ${ownerId}`);

    //Get Subscriptions Start Company With Basic 
    await getFirestore()
      .collection("subscriptions")
      .where("name", "==", "Free")
      .limit(1)
      .get().then((querySnapshot) => {
        querySnapshot.forEach(async (doc) => {
          console.log("SubscriptionData:", doc.id, " => ", doc.data());

          let documentData = doc.data()
          //Then Make local reaings
          let startingSubscription = {
            currentPeriodEnd: null,
            currentPeriodStart: new Date(),
            description: "",
            dripDropSubscriptionId: documentData.id,
            id: 'com_s_' + uuidv4(),
            lastPaid: null,
            name: "Free",
            status: "active",
            price: 0,
            started: new Date(),
            status: "active",
            stripeCustomerId: "",
            stripePriceId: "",
            stripeProductId: "",
            stripeSubscriptionId: "",
            userId: ownerId,
          }
          //companies/\(companyId)/settings/readings/readings
          await getFirestore().collection("companies").doc(companyId).collection("subscriptions").doc(startingSubscription.id).set(startingSubscription);
          console.log("Sucessfully Created first Subscription")

        });
      })
      .catch((error) => {
        console.log("Error getting Universal Readings documents: ", error);
      });
    console.log("Sucessfully Created Company")

    return {
      status: 200,
      companyId: companyId
    };
  } catch (error) {

    console.error(
      "An error occurred when calling the Create Company After Sign up Stop API: Deleting Company",
    );

    console.error(
      error
    );

    //Delete Company
    await getFirestore()
      .collection("companies")
      .doc(companyId)
      .delete()

    return {
      status: 500,
      error: error.message
    };
  }
});

exports.updateCompanyHistory = functions.https.onCall(async (data, context) => {
  try {
    console.log('Updating Company History')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let updaterId = receivedData.updaterId
    let updaterName = receivedData.updaterName
    let companyId = receivedData.companyId
    let description = receivedData.description
    let tags = receivedData.tags

    //Body Of function

    //Create Company
    const id = 'com_his_' + uuidv4()
    let company = {
      id: id,
      updaterId: updaterId,
      updaterName: ownerName,
      date: new Date(),
      description: description,
      tags: ownerName,

    }
    await getFirestore()
      .collection("companies").doc(companyId).collection("companyHistory")
      .set(company);
    console.log("Finished Creating Company History")
    return {
      status: 200,
      companyId: companyId
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Create New Recurring Service Stop API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});
exports.createCompanyAdminNotes = functions.https.onCall(async (data, context) => {
  try {
    console.log('Updating Company History')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let updaterId = receivedData.updaterId
    let updaterName = receivedData.updaterName
    let companyId = receivedData.companyId
    let description = receivedData.description
    let tags = receivedData.tags
    let needsResolution = receivedData.needsResolution
    let resolved = receivedData.resolved
    let resoloverId = receivedData.resoloverId
    let resolverName = receivedData.resolverName
    let dateResolved = receivedData.dateResolved


    //Body Of function

    //Create Company Notes
    const id = 'com_an_' + uuidv4()
    let company = {
      id: id,
      updaterId: updaterId,
      updaterName: updaterName,
      date: new Date(),
      description: description,
      tags: tags,
      needsResolution: needsResolution,
      resolved: resolved,
      resoloverId: resoloverId,
      resolverName: resolverName,
      dateResolved: dateResolved,
    }
    await getFirestore()
      .collection("companies").doc(companyId).collection("adminNotes").doc(id)
      .set(company);
    console.log("Finished Creating Company History")
    return {
      status: 200,
      companyId: companyId
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Create New Recurring Service Stop API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

exports.updateCompanyAdminFlags = functions.https.onCall(async (data, context) => {
  const payload = data?.data ?? data ?? {};
  const verifiedAuth = await getVerifiedCallableAuth(payload, context);
  const authUserId = verifiedAuth?.uid;
  const companyId = String(payload.companyId || "").trim();

  if (!authUserId) {
    throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
  }

  if (!companyId) {
    throw new functions.https.HttpsError("invalid-argument", "companyId is required.");
  }

  const firestore = getFirestore();
  const userSnap = await firestore.collection("users").doc(authUserId).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};

  if (userData.accountType !== "Admin") {
    throw new functions.https.HttpsError("permission-denied", "Only platform admins can update company admin flags.");
  }

  const companyRef = firestore.collection("companies").doc(companyId);
  const companySnap = await companyRef.get();

  if (!companySnap.exists) {
    throw new functions.https.HttpsError("not-found", "Company not found.");
  }

  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    adminFlagsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    adminFlagsUpdatedBy: authUserId,
    adminFlagsUpdatedByName: userData.name || userData.displayName || "",
  };

  const responseCompany = {};

  if (Object.prototype.hasOwnProperty.call(payload, "hideFromBrowse")) {
    const hideFromBrowse = payload.hideFromBrowse === true;
    updates.hideFromBrowse = hideFromBrowse;
    responseCompany.hideFromBrowse = hideFromBrowse;
  }

  if (payload.verified === true) {
    updates.verified = true;
    updates.needToVerify = false;
    updates.lastVerified = admin.firestore.FieldValue.serverTimestamp();
    updates.verifiedByAdminId = authUserId;
    updates.verifiedByAdminName = userData.name || userData.displayName || "";
    responseCompany.verified = true;
    responseCompany.needToVerify = false;
  }

  if (!Object.prototype.hasOwnProperty.call(updates, "hideFromBrowse") && updates.verified !== true) {
    throw new functions.https.HttpsError("invalid-argument", "No supported company flag was provided.");
  }

  await companyRef.update(updates);

  return {
    status: 200,
    companyId,
    company: responseCompany,
  };
});

const getAdminUserData = async (firestore, authUserId) => {
  if (!authUserId) return null;

  const userSnap = await firestore.collection("users").doc(authUserId).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};

  return userData.accountType === "Admin" ? userData : null;
};

const getQueryCount = async (queryRef) => {
  const snap = await queryRef.get();
  return snap.size;
};

const serializeCallableDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

const ADMIN_CALLABLE_CORS_ORIGINS = [
  "https://dripdrop-poolapp.com",
  "https://www.dripdrop-poolapp.com",
  "https://the-pool-app-3e652.web.app",
  "https://the-pool-app-3e652.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

exports.getAdminCompanyListStats = onCall({ cors: ADMIN_CALLABLE_CORS_ORIGINS }, async (request) => {
  const payload = request.data ?? {};
  const verifiedAuth = await getVerifiedCallableAuth(payload, { auth: request.auth });
  const authUserId = verifiedAuth?.uid;

  if (!authUserId) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const firestore = getFirestore();
  const adminUserData = await getAdminUserData(firestore, authUserId);

  if (!adminUserData) {
    throw new HttpsError("permission-denied", "Only platform admins can view company stats.");
  }

  const companiesSnap = await firestore.collection("companies").get();

  const companies = await Promise.all(companiesSnap.docs.map(async (companyDoc) => {
    const company = companyDoc.data() || {};
    const companyRef = companyDoc.ref;
    const [companyUserCount, activeCustomerCount, totalCustomerCount] = await Promise.all([
      getQueryCount(companyRef.collection("companyUsers")),
      getQueryCount(companyRef.collection("customers").where("active", "==", true)),
      getQueryCount(companyRef.collection("customers")),
    ]);

    return {
      id: companyDoc.id,
      ownerId: company.ownerId || "",
      ownerName: company.ownerName || "",
      name: company.name || "",
      email: company.email || "",
      phoneNumber: company.phoneNumber || "",
      verified: company.verified === true,
      needToVerify: company.needToVerify === true,
      hideFromBrowse: company.hideFromBrowse === true,
      status: company.status || "",
      paidUntil: serializeCallableDate(company.paidUntil),
      dateCreated: serializeCallableDate(company.dateCreated),
      companyUserCount,
      activeCustomerCount,
      totalCustomerCount,
    };
  }));

  const summary = companies.reduce((acc, company) => {
    acc.totalCompanies += 1;
    acc.hiddenCompanies += company.hideFromBrowse ? 1 : 0;
    acc.visibleCompanies += company.hideFromBrowse ? 0 : 1;
    acc.verifiedCompanies += company.verified ? 1 : 0;
    acc.unverifiedCompanies += company.verified ? 0 : 1;
    acc.needsVerification += company.needToVerify ? 1 : 0;
    acc.totalCompanyUsers += company.companyUserCount || 0;
    acc.totalActiveCustomers += company.activeCustomerCount || 0;
    acc.totalCustomers += company.totalCustomerCount || 0;
    return acc;
  }, {
    totalCompanies: 0,
    hiddenCompanies: 0,
    visibleCompanies: 0,
    verifiedCompanies: 0,
    unverifiedCompanies: 0,
    needsVerification: 0,
    totalCompanyUsers: 0,
    totalActiveCustomers: 0,
    totalCustomers: 0,
  });

  companies.sort((a, b) => a.name.localeCompare(b.name));

  return {
    status: 200,
    companies,
    summary,
  };
});

exports.acceptLinkedInvite = functions.https.onCall(async (data, context) => {

  try {
    const payload = data?.data ?? data ?? {};
    const authContext = await getVerifiedCallableAuth(payload, context);
    const authUserId = authContext?.uid;

    if (!authUserId) {
      return {
        status: 401,
        error: "You must be signed in to accept a linked invite"
      };
    }

    const homeownerId = payload.homeownerId || payload.userId || authUserId;
    if (homeownerId !== authUserId) {
      return {
        status: 403,
        error: "Authenticated user does not match the homeowner account"
      };
    }

    const inviteId = payload.inviteId || payload.linkedInviteId || payload.id || "";
    let companyId = payload.companyId || "";
    let customerId = payload.customerId || "";

    if (inviteId && (!companyId || !customerId)) {
      const inviteSnap = await getFirestore().collection("linkedInvite").doc(inviteId).get();
      if (!inviteSnap.exists) {
        return {
          status: 404,
          error: "Linked invite not found"
        };
      }

      const invite = inviteSnap.data() || {};
      companyId = companyId || invite.companyId || "";
      customerId = customerId || invite.customerId || "";
    }

    return await linkHomeownerToCompanyCustomer({
      companyId,
      customerId,
      homeownerId,
      authEmail: authContext?.token?.email || payload.email || "",
      inviteId,
      source: "companyInvite",
      requestedByUserId: authUserId,
    });
  } catch (error) {
    console.error(
      "An error occurred when accepting a linked invite",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

exports.createCustomerAccountInvite = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const authContext = await getVerifiedCallableAuth(payload, context);
    const authUserId = authContext?.uid;

    if (!authUserId) {
      return {
        status: 401,
        error: "You must be signed in to create a customer account invite"
      };
    }

    const companyId = payload.companyId || "";
    const customerId = payload.customerId || "";

    if (!companyId || !customerId) {
      return {
        status: 400,
        error: "Missing companyId or customerId"
      };
    }

    const canAccessCompany = await userCanAccessCompany(getFirestore(), authUserId, companyId);
    if (!canAccessCompany) {
      return {
        status: 403,
        error: "You do not have access to this company"
      };
    }

    return await ensureCustomerAccountInvite({
      companyId,
      customerId,
      createdByUserId: authUserId,
      source: payload.source || "companyCustomerInvite",
      baseUrl: payload.baseUrl || payload.appBaseUrl || "",
      email: payload.email || "",
      forceNew: payload.forceNew === true,
    });
  } catch (error) {
    console.error("Error creating customer account invite", error);
    return {
      status: 500,
      error: error.message || "Could not create customer account invite"
    };
  }
});

exports.getCustomerAccountInvitePreview = functions.https.onCall(async (data) => {
  try {
    const payload = data?.data ?? data ?? {};
    const inviteId = payload.inviteId || payload.linkedInviteId || payload.id || "";

    if (!inviteId) {
      return {
        status: 400,
        error: "Missing customer account invite id"
      };
    }

    return await getCustomerAccountInvitePreview({
      inviteId,
      baseUrl: payload.baseUrl || payload.appBaseUrl || "",
    });
  } catch (error) {
    console.error("Error loading customer account invite preview", error);
    return {
      status: 500,
      error: error.message || "Could not load customer account invite"
    };
  }
});

exports.convertHomeownerServiceRequestToCompanyCustomer = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const authContext = await getVerifiedCallableAuth(payload, context);
    const authUserId = authContext?.uid;
    const companyId = payload.companyId || "";
    const leadId = payload.leadId || payload.requestId || "";

    if (!authUserId) {
      console.warn("[leadConversion][unauthenticated]", {
        companyId,
        leadId,
        hasContextAuth: Boolean(context.auth?.uid),
        hasPayloadToken: Boolean(payload.idToken || payload.auth?.idToken || payload.data?.idToken),
        hasAuthorizationHeader: Boolean(context.rawRequest?.headers?.authorization),
      });
      return {
        status: 401,
        error: "You must be signed in to convert a service request. Auth token did not reach the deployed function."
      };
    }

    if (!companyId || !leadId) {
      return {
        status: 400,
        error: "Missing companyId or leadId"
      };
    }

    const firestore = getFirestore();
    const hasAccess = await userCanAccessCompany(firestore, authUserId, companyId);
    if (!hasAccess) {
      return {
        status: 403,
        error: "You do not have access to this company"
      };
    }

    const companyRef = firestore.collection("companies").doc(companyId);
    const leadRef = firestore.collection("homeownerServiceRequests").doc(leadId);
    const [companySnap, leadSnap] = await Promise.all([
      companyRef.get(),
      leadRef.get(),
    ]);

    if (!companySnap.exists) {
      return {
        status: 404,
        error: "Company not found"
      };
    }

    if (!leadSnap.exists) {
      return {
        status: 404,
        error: "Service request not found"
      };
    }

    const company = companySnap.data() || {};
    const lead = leadSnap.data() || {};

    if (lead.companyId && lead.companyId !== companyId) {
      return {
        status: 403,
        error: "This service request belongs to a different company"
      };
    }

    const formData = payload.formData || payload.customer || {};
    const serviceLocationData = payload.serviceLocationData || {};
    const bodyOfWaterData = payload.bodyOfWaterData || {};
    const payloadEquipmentData = Array.isArray(payload.equipmentData) ? payload.equipmentData : [];
    const displayAsCompany = Boolean(payload.displayAsCompany ?? formData.displayAsCompany);
    const submittedHomeownerName = firstNonEmptyString(
      lead.homeownerName,
      lead.creatorName,
      lead.customerName,
      lead.name
    );
    const submittedNameParts = splitLeadConversionName(submittedHomeownerName);
    const firstName = String(formData.firstName || lead.firstName || submittedNameParts.firstName || "").trim();
    const lastName = String(formData.lastName || lead.lastName || submittedNameParts.lastName || "").trim();
    const companyCustomerName = String(formData.companyName || formData.company || "").trim();
    const email = normalizeEmail(
      formData.email ||
      lead.homeownerEmail ||
      lead.creatorEmail ||
      lead.customerEmail ||
      lead.email ||
      ""
    );
    const phoneNumber = String(
      formData.phone ||
      formData.phoneNumber ||
      lead.homeownerPhone ||
      lead.creatorPhone ||
      lead.customerPhone ||
      lead.phoneNumber ||
      lead.phone ||
      ""
    ).trim();
    const customerName = (
      displayAsCompany
        ? companyCustomerName
        : `${firstName} ${lastName}`.trim()
    ) || submittedHomeownerName || email || "New Customer";
    const homeownerId = (
      lead.homeownerId ||
      lead.customerUserId ||
      lead.homeownerUserId ||
      lead.userId ||
      payload.homeownerId ||
      ""
    );
    const homeownerServiceLocationId = (
      lead.homeownerServiceLocationId ||
      lead.homeownerserviceLocationId ||
      payload.homeownerServiceLocationId ||
      ""
    );
    const homeownerBodyOfWaterId = lead.homeownerBodyOfWaterId || payload.homeownerBodyOfWaterId || "";
    const homeownerEquipmentIds = [
      lead.homeownerEquipmentId,
      payload.homeownerEquipmentId,
      ...(Array.isArray(lead.homeownerEquipmentIds) ? lead.homeownerEquipmentIds : []),
      ...(Array.isArray(payload.homeownerEquipmentIds) ? payload.homeownerEquipmentIds : []),
    ].filter(Boolean);
    const homeownerEquipmentId = homeownerEquipmentIds[0] || "";

    const [
      homeownerServiceLocation,
      homeownerBodyOfWater,
      ...homeownerEquipmentRecordsFromIds
    ] = await Promise.all([
      readHomeownerOwnedRecord(firestore, "homeownerServiceLocations", homeownerServiceLocationId, homeownerId),
      readHomeownerOwnedRecord(firestore, "homeownerBodiesOfWater", homeownerBodyOfWaterId, homeownerId),
      ...[...new Set(homeownerEquipmentIds)].map((equipmentId) => (
        readHomeownerOwnedRecord(firestore, "homeownerEquipment", equipmentId, homeownerId)
      )),
    ]);

    const homeownerEquipmentRecords = homeownerEquipmentRecordsFromIds.filter(Boolean);
    const homeownerEquipmentForBody = homeownerEquipmentRecords.length
      ? []
      : await queryHomeownerEquipmentForBody(firestore, homeownerBodyOfWaterId, homeownerId);
    const sourceHomeownerEquipment = homeownerEquipmentRecords.length
      ? homeownerEquipmentRecords
      : homeownerEquipmentForBody;
    const equipmentData = (
      sourceHomeownerEquipment.length && isDefaultLeadConversionEquipment(payloadEquipmentData)
        ? sourceHomeownerEquipment.map(mapHomeownerEquipmentToCompanyDraft)
        : payloadEquipmentData
    );
    const payloadBodyOfWaterEntries = Array.isArray(payload.bodyOfWaterEntries)
      ? payload.bodyOfWaterEntries
      : [];
    const normalizedBodyOfWaterEntries = payloadBodyOfWaterEntries.length
      ? payloadBodyOfWaterEntries.map((entry = {}) => {
        const entryData = entry.bodyOfWaterData || entry.data || entry;
        return {
          bodyOfWaterData: entryData,
          equipmentData: Array.isArray(entry.equipmentData) ? entry.equipmentData : [],
          sourceHomeownerBodyOfWaterId:
            entry.sourceHomeownerBodyOfWaterId ||
            entry.linkedHomeownerBodyOfWaterId ||
            entry.homeownerBodyOfWaterId ||
            entryData.sourceHomeownerBodyOfWaterId ||
            entryData.linkedHomeownerBodyOfWaterId ||
            entryData.homeownerBodyOfWaterId ||
            "",
          companyBodyOfWaterId: entry.companyBodyOfWaterId || entry.bodyOfWaterId || "",
        };
      })
      : [{
        bodyOfWaterData,
        equipmentData,
        sourceHomeownerBodyOfWaterId: homeownerBodyOfWaterId,
        companyBodyOfWaterId: payload.bodyOfWaterId || "",
      }];
    const customerId = payload.customerId || createCompanyScopedId("com_cus");
    const existingRelationshipId = (
      payload.relationshipId ||
      payload.customerCompanyRelationshipId ||
      lead.relationshipId ||
      lead.customerCompanyRelationshipId ||
      ""
    );
    const relationshipId = (
      existingRelationshipId ||
      (homeownerId ? getHomeownerRelationshipId(companyId, customerId, homeownerId) : "")
    );
    const serviceAddressSource = [
      payload.serviceLocationAddress,
      lead.serviceLocationAddress,
      homeownerServiceLocation?.address,
    ].find(hasLeadConversionAddress) || {};
    const serviceAddress = normalizeLeadConversionAddress(serviceAddressSource);
    const billingAddress = payload.useDifferentBillingAddress
      ? normalizeLeadConversionAddress(payload.billingAddress || {})
      : serviceAddress;
    const addServiceLocation = payload.addServiceLocation !== false;
    const addBodyOfWater = addServiceLocation && Boolean(payload.addBodyOfWater);
    const addEquipment = addBodyOfWater && Boolean(payload.addEquipment);
    const serviceLocationId = addServiceLocation
      ? (payload.serviceLocationId || createCompanyScopedId("com_sl"))
      : "";
    const bodyOfWaterEntries = addBodyOfWater ? normalizedBodyOfWaterEntries : [];
    const bodyOfWaterIds = bodyOfWaterEntries.map((entry, index) => (
      entry.companyBodyOfWaterId || (index === 0 && payload.bodyOfWaterId) || createCompanyScopedId("com_bow")
    ));
    const bodyOfWaterId = bodyOfWaterIds[0] || "";
    const companyName = company.name || company.companyName || payload.companyName || "";
    const now = admin.firestore.FieldValue.serverTimestamp();
    const writes = [];
    const equipmentIds = [];

    writes.push({
      ref: companyRef.collection("customers").doc(customerId),
      data: removeUndefinedDeep({
        id: customerId,
        createdAt: now,
        updatedAt: now,
        firstName,
        lastName,
        company: displayAsCompany ? companyCustomerName : "",
        companyName: displayAsCompany ? companyCustomerName : "",
        displayAsCompany,
        active: true,
        email,
        phoneNumber,
        phoneLabel: "",
        billingAddress,
        billingNotes: formData.billingNotes || "",
        hireDate: now,
        linkedCustomerIds: homeownerId ? [homeownerId] : [],
        linkedCustomerUserId: homeownerId || "",
        linkedHomeownerUserId: homeownerId || "",
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        linkedStatus: homeownerId ? "active" : "",
        linkedEmail: email,
        linkedAt: homeownerId ? now : null,
        linkedInviteId: relationshipId || "",
        source: "homeownerServiceRequest",
        sourceHomeownerServiceRequestId: leadId,
      }),
    });

    if (relationshipId && homeownerId) {
      writes.push({
        ref: firestore.collection("customerCompanyRelationships").doc(relationshipId),
        data: removeUndefinedDeep({
          id: relationshipId,
          companyId,
          companyName,
          companyCustomerId: customerId,
          companyCustomerName: customerName,
          homeownerUserId: homeownerId,
          homeownerEmail: email || lead.homeownerEmail || "",
          status: "active",
          source: "homeownerServiceRequest",
          serviceRequestId: leadId,
          linkedAt: now,
          updatedAt: now,
          createdAt: now,
          createdByUserId: authUserId,
          permissions: {
            companyCanUpdateSharedFields: true,
            companyCanDeleteHomeownerOwnedRecords: false,
            homeownerCanEditPortalRecords: true,
          },
        }),
      });
    }

    if (addServiceLocation) {
      writes.push({
        ref: companyRef.collection("serviceLocations").doc(serviceLocationId),
        data: removeUndefinedDeep({
          id: serviceLocationId,
          nickName: serviceLocationData.nickName || homeownerServiceLocation?.nickName || homeownerServiceLocation?.name || "Main",
          address: serviceAddress,
          gateCode: serviceLocationData.gateCode || homeownerServiceLocation?.gateCode || "",
          dogName: toArrayOfStrings(serviceLocationData.dogName).length
            ? toArrayOfStrings(serviceLocationData.dogName)
            : toArrayOfStrings(homeownerServiceLocation?.dogName),
          estimatedTime: serviceLocationData.estimatedTime || homeownerServiceLocation?.estimatedTime || 15,
          mainContact: {
            id: createCompanyScopedId("com_cus_con"),
            name: customerName,
            email,
            phoneNumber,
            notes: "",
          },
          notes: serviceLocationData.notes || homeownerServiceLocation?.notes || "",
          bodiesOfWaterId: addBodyOfWater ? bodyOfWaterIds : [],
          rateType: "",
          laborType: "",
          chemicalCost: "",
          laborCost: "",
          rate: "",
          customerId,
          customerName,
          relationshipId,
          customerCompanyRelationshipId: relationshipId,
          linkedHomeownerUserId: homeownerId || "",
          linkedHomeownerServiceLocationId: homeownerServiceLocationId,
          sourceHomeownerServiceLocationId: homeownerServiceLocation?.id || homeownerServiceLocationId,
          source: "homeownerServiceRequest",
          sourceHomeownerServiceRequestId: leadId,
          backYardTree: homeownerServiceLocation?.backYardTree || [],
          backYardBushes: homeownerServiceLocation?.backYardBushes || [],
          backYardOther: homeownerServiceLocation?.backYardOther || [],
          preText: Boolean(serviceLocationData.preText ?? homeownerServiceLocation?.preText),
          verified: Boolean(homeownerServiceLocation?.verified),
          photoUrls: Array.isArray(homeownerServiceLocation?.photoUrls) ? homeownerServiceLocation.photoUrls : [],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }),
      });
    }

    if (addBodyOfWater) {
      for (const [bodyIndex, entry] of bodyOfWaterEntries.entries()) {
        const entryBodyOfWaterId = bodyOfWaterIds[bodyIndex];
        const entryBodyOfWaterData = entry.bodyOfWaterData || {};
        const sourceHomeownerBodyOfWaterId = entry.sourceHomeownerBodyOfWaterId || "";
        const sourceHomeownerBodyOfWater = (
          sourceHomeownerBodyOfWaterId &&
          sourceHomeownerBodyOfWaterId === (homeownerBodyOfWater?.id || homeownerBodyOfWaterId)
        )
          ? homeownerBodyOfWater
          : null;

        writes.push({
          ref: companyRef.collection("bodiesOfWater").doc(entryBodyOfWaterId),
          data: removeUndefinedDeep({
            id: entryBodyOfWaterId,
            name: entryBodyOfWaterData.name || sourceHomeownerBodyOfWater?.name || "Main Pool",
            gallons: entryBodyOfWaterData.gallons || sourceHomeownerBodyOfWater?.gallons || "",
            waterType: entryBodyOfWaterData.waterType || sourceHomeownerBodyOfWater?.waterType || "Chlorine",
            material: entryBodyOfWaterData.material || sourceHomeownerBodyOfWater?.material || "",
            customerId,
            customerName,
            serviceLocationId,
            relationshipId,
            customerCompanyRelationshipId: relationshipId,
            linkedHomeownerUserId: homeownerId || "",
            linkedHomeownerBodyOfWaterId: sourceHomeownerBodyOfWaterId,
            sourceHomeownerBodyOfWaterId: sourceHomeownerBodyOfWater?.id || sourceHomeownerBodyOfWaterId,
            source: "homeownerServiceRequest",
            sourceHomeownerServiceRequestId: leadId,
            notes: entryBodyOfWaterData.notes || sourceHomeownerBodyOfWater?.notes || "",
            shape: entryBodyOfWaterData.shape || sourceHomeownerBodyOfWater?.shape || "",
            length: entryBodyOfWaterData.length ?? sourceHomeownerBodyOfWater?.length ?? null,
            depth: entryBodyOfWaterData.depth ?? sourceHomeownerBodyOfWater?.depth ?? null,
            width: entryBodyOfWaterData.width ?? sourceHomeownerBodyOfWater?.width ?? null,
            photoUrls: Array.isArray(sourceHomeownerBodyOfWater?.photoUrls) ? sourceHomeownerBodyOfWater.photoUrls : [],
            lastFilled: sourceHomeownerBodyOfWater?.lastFilled || now,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          }),
        });

        if (addEquipment) {
          const entryEquipmentData = Array.isArray(entry.equipmentData) ? entry.equipmentData : [];

          for (const equipment of entryEquipmentData) {
            if (!equipment?.name) continue;

            const equipmentId = createCompanyScopedId("com_equ");
            const catalogEquipmentId = equipment.modelId || equipment.universalEquipmentId || "";
            const sourceHomeownerEquipmentId =
              equipment.linkedHomeownerEquipmentId ||
              equipment.homeownerEquipmentId ||
              equipment.sourceHomeownerEquipmentId ||
              equipment.id ||
              (bodyIndex === 0 ? homeownerEquipmentId : "");
            equipmentIds.push(equipmentId);

            const equipmentRecord = removeUndefinedDeep({
              id: equipmentId,
              name: equipment.name,
              type: equipment.type || equipment.category || "",
              typeId: equipment.typeId || "",
              make: equipment.make || "",
              makeId: equipment.makeId || "",
              model: equipment.model || "",
              modelId: catalogEquipmentId,
              universalEquipmentId: catalogEquipmentId,
              manualPdfLink: equipment.manualPdfLink || "",
              dateInstalled: equipment.dateInstalled || now,
              cleanFilterPressure: equipment.cleanFilterPressure ?? null,
              currentPressure: equipment.currentPressure ?? null,
              serviceFrequency: equipment.serviceFrequency ?? null,
              serviceFrequencyEvery: equipment.serviceFrequencyEvery || "",
              notes: equipment.notes || "",
              customerId,
              customerName,
              serviceLocationId,
              bodyOfWaterId: entryBodyOfWaterId,
              relationshipId,
              customerCompanyRelationshipId: relationshipId,
              linkedHomeownerUserId: homeownerId || "",
              linkedHomeownerEquipmentId: sourceHomeownerEquipmentId,
              sourceHomeownerEquipmentId,
              source: "homeownerServiceRequest",
              sourceHomeownerServiceRequestId: leadId,
              lastServiceDate: equipment.lastServiceDate || null,
              nextServiceDate: equipment.nextServiceDate || null,
              isActive: true,
              needsService: Boolean(equipment.needsService),
              status: equipment.status || "Operational",
              verified: Boolean(equipment.verified),
              photoUrls: Array.isArray(equipment.photoUrls) ? equipment.photoUrls : [],
              createdAt: now,
              updatedAt: now,
            });

            const equipmentRef = companyRef.collection("equipment").doc(equipmentId);
            writes.push({
              ref: equipmentRef,
              data: equipmentRecord,
            });

            if (catalogEquipmentId) {
              const partsSnapshot = await firestore
                .collection("universal")
                .doc("equipment")
                .collection("equipment")
                .doc(catalogEquipmentId)
                .collection("parts")
                .get();

              partsSnapshot.docs.forEach((partDoc) => {
                const part = partDoc.data() || {};
                const partId = createCompanyScopedId("com_equ_par");
                writes.push({
                  ref: equipmentRef.collection("parts").doc(partId),
                  data: removeUndefinedDeep({
                    id: partId,
                    name: part.name || "",
                    sku: part.sku || "",
                    make: part.make || equipmentRecord.make || "",
                    model: part.model || equipmentRecord.model || "",
                    manualPdfLink: part.manualPdfLink || "",
                    universalPartId: part.id || partDoc.id,
                    universalEquipmentId: catalogEquipmentId,
                    createdAt: now,
                  }),
                });
              });
            }
          }
        }
      }
    }

    writes.push({
      ref: leadRef,
      data: removeUndefinedDeep({
        customerId,
        companyCustomerId: customerId,
        customerName,
        customerUserId: homeownerId || lead.customerUserId || "",
        homeownerUserId: homeownerId || "",
        homeownerId: homeownerId || lead.homeownerId || "",
        serviceLocationId,
        companyServiceLocationId: serviceLocationId,
        bodyOfWaterId,
        companyBodyOfWaterId: bodyOfWaterId,
        bodyOfWaterIds,
        companyBodyOfWaterIds: bodyOfWaterIds,
        equipmentIds,
        companyEquipmentIds: equipmentIds,
        relationshipId,
        customerCompanyRelationshipId: relationshipId,
        convertedAt: now,
        convertedByUserId: authUserId,
        conversionSource: "companyLeadConversion",
        updatedAt: now,
      }),
    });

    await commitFirestoreWrites(firestore, writes);

    return {
      status: 200,
      leadId,
      companyId,
      customerId,
      customerName,
      serviceLocationId,
      bodyOfWaterId,
      bodyOfWaterIds,
      equipmentIds,
      relationshipId,
    };
  } catch (error) {
    console.error("Error converting homeowner service request to company customer", error);
    return {
      status: 500,
      error: error.message || "Could not convert service request"
    };
  }
});

exports.acceptTechInvite = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const inviteId = payload.inviteId;
    const requestedUserId = payload.userId;
    const authContext = await getVerifiedCallableAuth(payload, context);
    const authUserId = authContext?.uid;
    const userId = requestedUserId || authUserId;
    const profile = payload.profile || {};

    if (!authUserId) {
      return {
        status: 401,
        error: "You must be signed in to accept an invite"
      };
    }

    if (!inviteId || !userId) {
      return {
        status: 400,
        error: "Missing inviteId or userId"
      };
    }

    if (authUserId !== userId) {
      return {
        status: 403,
        error: "Authenticated user does not match invite user"
      };
    }

    const db = getFirestore();
    const inviteRef = db.collection("invites").doc(inviteId);
    const inviteSnap = await inviteRef.get();

    if (!inviteSnap.exists) {
      return {
        status: 404,
        error: "No Invite Found"
      };
    }

    const invite = inviteSnap.data();
    const status = String(invite.status || "").toLowerCase();

    if (status !== "pending") {
      return {
        status: 409,
        error: "Invite Already Accepted"
      };
    }

    if (invite.userId && invite.userId !== userId) {
      return {
        status: 403,
        error: "Invite is assigned to a different user"
      };
    }

    const authEmail = authContext?.token?.email?.toLowerCase();
    const inviteEmail = invite.email?.toLowerCase();

    if (authEmail && inviteEmail && authEmail !== inviteEmail) {
      return {
        status: 403,
        error: "Authenticated email does not match invite email"
      };
    }

    const acceptedStatus = "accepted";
    const now = admin.firestore.FieldValue.serverTimestamp();
    const fullName = `${profile.firstName || invite.firstName || ""} ${profile.lastName || invite.lastName || ""}`.trim();
    const workerType = invite.workerType || "Employee";
    const batch = db.batch();

    if (profile.email || invite.email) {
      const userRef = db.collection("users").doc(userId);
      batch.set(userRef, {
        id: userId,
        email: profile.email || invite.email,
        firstName: profile.firstName || invite.firstName || "",
        lastName: profile.lastName || invite.lastName || "",
        accountType: profile.accountType || "Company",
        photoUrl: profile.photoUrl || null,
        profileImagePath: profile.profileImagePath || null,
        color: profile.color || null,
        bio: profile.bio || "",
        exp: profile.exp || 0,
        dateCreated: now,
      }, { merge: true });
    }

    const companyUserRef = db
      .collection("companies")
      .doc(invite.companyId)
      .collection("companyUsers")
      .doc(userId);

    batch.set(companyUserRef, {
      id: userId,
      userId: userId,
      userName: fullName || invite.email || userId,
      roleId: invite.roleId,
      roleName: invite.roleName,
      dateCreated: now,
      status: "Active",
      workerType: workerType,
      linkedCompanyId: invite.linkedCompanyId || null,
      linkedCompanyName: invite.linkedCompanyName || null,
    }, { merge: true });

    const userAccessRef = db
      .collection("users")
      .doc(userId)
      .collection("userAccess")
      .doc(invite.companyId);

    batch.set(userAccessRef, {
      id: invite.companyId,
      companyId: invite.companyId,
      companyName: invite.companyName,
      roleId: invite.roleId,
      roleName: invite.roleName,
      dateCreated: now,
    }, { merge: true });

    batch.update(inviteRef, {
      status: acceptedStatus,
      userId: userId,
      acceptedAt: now,
    });

    await batch.commit();

    return {
      status: 200,
      inviteId: inviteId,
      userId: userId,
      companyId: invite.companyId,
      account: "Successfully Accepted"
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Accept Tech Invite API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

exports.migrateLegacyVendorsToCanonical = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const companyId = payload.companyId;
    const dryRun = Boolean(payload.dryRun);
    const deleteLegacy = Boolean(payload.deleteLegacy);
    const authUserId = context.auth?.uid;

    if (!authUserId) {
      return { status: 401, error: "You must be signed in to migrate vendors." };
    }

    if (!companyId) {
      return { status: 400, error: "Missing companyId." };
    }

    const db = getFirestore();
    const userSnap = await db.collection("users").doc(authUserId).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isCompanyUser = userData.accountType === "Company" && userData.recentlySelectedCompany === companyId;
    const isAdmin = userData.accountType === "Admin";

    if (!isCompanyUser && !isAdmin) {
      return { status: 403, error: "You do not have permission to migrate this company's vendors." };
    }

    const legacyRef = db.collection("companies").doc(companyId).collection("settings").doc("venders").collection("vender");
    const canonicalRef = db.collection("companies").doc(companyId).collection("settings").doc("vendors").collection("vendor");
    const legacySnap = await legacyRef.get();

    let copied = 0;
    let skipped = 0;
    let deleted = 0;
    const preview = [];
    let batch = db.batch();
    let writes = 0;

    const commitIfNeeded = async (force = false) => {
      if (!dryRun && writes > 0 && (force || writes >= 400)) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    };

    for (const legacyDoc of legacySnap.docs) {
      const legacyData = legacyDoc.data();
      const canonicalId = legacyData.id || legacyDoc.id;
      const canonicalDocRef = canonicalRef.doc(canonicalId);
      const canonicalSnap = await canonicalDocRef.get();

      if (canonicalSnap.exists) {
        skipped += 1;
        continue;
      }

      const nextVendor = {
        ...legacyData,
        id: canonicalId,
        migratedFromLegacyVendorPath: true,
        legacyVendorDocId: legacyDoc.id,
        migratedAt: new Date(),
        migratedByUserId: authUserId,
      };

      copied += 1;
      if (preview.length < 20) {
        preview.push({ id: canonicalId, name: nextVendor.name || "" });
      }

      if (!dryRun) {
        batch.set(canonicalDocRef, nextVendor, { merge: true });
        writes += 1;

        if (deleteLegacy) {
          batch.delete(legacyDoc.ref);
          writes += 1;
          deleted += 1;
        }

        await commitIfNeeded();
      }
    }

    await commitIfNeeded(true);

    if (!dryRun) {
      await db.collection("companies").doc(companyId).collection("settings").doc("vendors").set({
        category: "vendors",
        migratedFromLegacyVendorsAt: new Date(),
        migratedFromLegacyVendorsByUserId: authUserId,
      }, { merge: true });
    }

    return {
      status: 200,
      copied,
      skipped,
      deleted,
      dryRun,
      deleteLegacy,
      preview,
    };
  } catch (error) {
    console.error("Error migrating legacy vendors:", error);
    return { status: 500, error: error.message || "Could not migrate vendors." };
  }
});

exports.updateServiceStopDayPermanently = functions.https.onCall(async (data, context) => {

  const db = getFirestore();

  try {
    console.log("[updateServiceStopDayPermanently] Received request");

    const receivedData = data?.data ?? data ?? {};
    const companyId = receivedData.companyId;
    const serviceStopList = Array.isArray(receivedData.serviceStopList)
      ? receivedData.serviceStopList
      : [];
    const newTech = receivedData.newTech || {};
    const newDay = receivedData.newDay;

    const dayIndexes = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6
    };

    const newDayOfWeek = dayIndexes[newDay];

    if (!companyId) {
      throw new functions.https.HttpsError("invalid-argument", "companyId is required.");
    }

    if (!newTech.userId || !newTech.userName) {
      throw new functions.https.HttpsError("invalid-argument", "newTech.userId and newTech.userName are required.");
    }

    if (newDayOfWeek === undefined) {
      throw new functions.https.HttpsError("invalid-argument", "newDay must be a valid day of week.");
    }

    const selectedStopIds = [
      ...new Set(
        serviceStopList
          .map((stop) => stop?.id)
          .filter((id) => typeof id === "string" && id.trim().length > 0)
      )
    ];

    if (!selectedStopIds.length) {
      throw new functions.https.HttpsError("invalid-argument", "At least one service stop id is required.");
    }

    const companyRef = db.collection("companies").doc(companyId);
    const serviceStopsRef = companyRef.collection("serviceStops");
    const recurringStopsRef = companyRef.collection("recurringServiceStop");
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    const parseDate = (value) => {
      if (!value) return null;
      if (typeof value.toDate === "function") return value.toDate();
      if (value instanceof Date) return value;
      if (typeof value === "number") return new Date(value);

      if (typeof value._seconds === "number") {
        return new Date(value._seconds * 1000);
      }

      if (typeof value.seconds === "number") {
        return new Date(value.seconds * 1000);
      }

      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const startOfDay = (date) => {
      const workingDate = new Date(date);
      workingDate.setHours(0, 0, 0, 0);
      return workingDate;
    };

    const nextSunday = () => {
      const today = startOfDay(new Date());
      const daysUntilNextSunday = today.getDay() === 0 ? 7 : 7 - today.getDay();
      today.setDate(today.getDate() + daysUntilNextSunday);
      return today;
    };

    const dateForDayOnOrAfter = (date, targetDayIndex) => {
      const workingDate = startOfDay(date || new Date());
      const daysUntilTarget = (targetDayIndex - workingDate.getDay() + 7) % 7;
      workingDate.setDate(workingDate.getDate() + daysUntilTarget);
      return workingDate;
    };

    const serviceStopUpdates = new Map();
    const queueServiceStopUpdate = (docRef, patch) => {
      const existing = serviceStopUpdates.get(docRef.path) || { ref: docRef, data: {} };
      serviceStopUpdates.set(docRef.path, {
        ref: docRef,
        data: {
          ...existing.data,
          ...patch
        }
      });
    };

    const selectedSnapshots = await Promise.all(
      selectedStopIds.map((stopId) => serviceStopsRef.doc(stopId).get())
    );

    const selectedStops = selectedSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => ({
        ref: snapshot.ref,
        id: snapshot.id,
        ...snapshot.data()
      }));

    const movableSelectedStops = selectedStops.filter((stop) => {
      return stop.operationStatus === "Not Finished";
    });

    const recurringIds = [
      ...new Set(
        movableSelectedStops
          .map((stop) => stop.recurringServiceStopId)
          .filter((id) => typeof id === "string" && id.trim().length > 0)
      )
    ];

    if (!movableSelectedStops.length || !recurringIds.length) {
      return {
        status: 200,
        companyId,
        selectedServiceStopCount: 0,
        futureServiceStopCount: 0,
        recurringServiceStopCount: 0,
        recurringRouteResults: [],
        message: "No unfinished recurring service stops were selected."
      };
    }

    movableSelectedStops.forEach((stop) => {
      const currentServiceDate = parseDate(stop.serviceDate) || new Date();
      queueServiceStopUpdate(stop.ref, {
        serviceDate: Timestamp.fromDate(dateForDayOnOrAfter(currentServiceDate, newDayOfWeek)),
        techId: newTech.userId,
        tech: newTech.userName,
        updatedAt: serverTimestamp
      });
    });

    const routeUpdateInputs = [];
    let futureServiceStopCount = 0;

    for (const recurringServiceStopId of recurringIds) {
      const recurringRef = recurringStopsRef.doc(recurringServiceStopId);
      const recurringSnap = await recurringRef.get();

      if (!recurringSnap.exists) {
        console.warn("[updateServiceStopDayPermanently] Recurring service stop not found.", {
          companyId,
          recurringServiceStopId
        });
        continue;
      }

      const previousRSS = {
        id: recurringSnap.id,
        ...recurringSnap.data()
      };

      const updatedRSS = {
        ...previousRSS,
        day: newDay,
        techId: newTech.userId,
        tech: newTech.userName
      };

      routeUpdateInputs.push({ previousRSS, updatedRSS });

      await recurringRef.update({
        day: newDay,
        techId: newTech.userId,
        tech: newTech.userName,
        updatedAt: serverTimestamp
      });

      const futureStopsSnapshot = await serviceStopsRef
        .where("recurringServiceStopId", "==", recurringServiceStopId)
        .where("serviceDate", ">=", Timestamp.fromDate(nextSunday()))
        .get();

      futureStopsSnapshot.docs.forEach((doc) => {
        const stop = doc.data() || {};

        if (stop.operationStatus === "Finished") {
          return;
        }

        const currentServiceDate = parseDate(stop.serviceDate) || new Date();

        queueServiceStopUpdate(doc.ref, {
          serviceDate: Timestamp.fromDate(dateForDayOnOrAfter(currentServiceDate, newDayOfWeek)),
          techId: newTech.userId,
          tech: newTech.userName,
          updatedAt: serverTimestamp
        });

        futureServiceStopCount += 1;
      });
    }

    const serviceStopUpdateList = Array.from(serviceStopUpdates.values());
    for (let i = 0; i < serviceStopUpdateList.length; i += 450) {
      const batch = db.batch();
      const chunk = serviceStopUpdateList.slice(i, i + 450);

      chunk.forEach((update) => {
        batch.update(update.ref, update.data);
      });

      await batch.commit();
    }

    const recurringRouteResults = [];
    for (const routeUpdateInput of routeUpdateInputs) {
      recurringRouteResults.push(await updateRecurringRouteOrderForRSS({
        db,
        companyId,
        previousRSS: routeUpdateInput.previousRSS,
        updatedRSS: routeUpdateInput.updatedRSS
      }));
    }

    return {
      status: 200,
      companyId,
      selectedServiceStopCount: movableSelectedStops.length,
      futureServiceStopCount,
      recurringServiceStopCount: routeUpdateInputs.length,
      recurringRouteResults
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the updateServiceStopPermanently API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

//a Test Function
exports.updateCompanyReadingsSettings = functions.https.onCall(async (data, context) => {
  /*
  Should Receive User Id, Company Name, Owner Name
  */

  try {
    console.log('Creating All functions for company')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let companyId = receivedData.companyId

    //Create Company Settings
    //Inital Readings
    //Get Universal Readings Templates "universal/settings/readingTemplates
    await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("readingTemplates")
      .get().then((querySnapshot) => {
        querySnapshot.forEach(async (doc) => {
          console.log("Reading Template:", doc.id, " => ", doc.data());

          let documentData = doc.data()
          //Then Make local reaings
          let readingsTemplate = {
            id: 'com_set_rt_' + uuidv4(),
            readingsTemplateId: documentData.id,
            name: documentData.name,
            amount: documentData.amount,
            UOM: documentData.UOM,
            chemType: documentData.chemType,
            linkedDosage: documentData.linkedDosage,
            editable: documentData.editable,
            order: documentData.order,
            highWarning: documentData.highWarning,
            lowWarning: documentData.lowWarning,
          }
          //companies/\(companyId)/settings/readings/readings
          await getFirestore().collection("companies").doc(companyId).collection("settings").doc("readings").collection("readings").doc(readingsTemplate.id).set(readingsTemplate);
        });
      })
      .catch((error) => {
        console.log("Error getting Universal Readings documents: ", error);
      });
    //Inital Dosages
    //Get Universal Dosages Templates "universal/settings/dosageTemplates
    await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("dosageTemplates")
      .get().then((querySnapshot) => {
        querySnapshot.forEach(async (doc) => {
          console.log("Dosage Template:", doc.id, " => ", doc.data());
          let documentData = doc.data()
          let dosageTemplate = {
            id: 'com_set_dt_' + uuidv4(),
            dosageTemplateId: documentData.id,
            name: documentData.name,
            amount: documentData.amount,
            UOM: documentData.UOM,
            rate: documentData.rate,
            linkedItemId: "",
            strength: documentData.strength,
            editable: documentData.editable,
            chemType: documentData.chemType,
            order: documentData.order,
          }
          await getFirestore().collection("companies").doc(companyId).collection("settings").doc("dosages").collection("dosages").doc(dosageTemplate.id).set(dosageTemplate);
        });
      })
      .catch((error) => {
        console.log("Error getting Universal Dosagesdocuments: ", error);
      });

    return {
      status: 200,
      companyId: companyId
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Create New Recurring Service Stop API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});


exports.updateRecurringRouteOrderPermanently = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let routeId = receivedData.routeId
  let recurringRouteOrder = receivedData.recurringRouteOrder
  let serviceStopOrders = receivedData.serviceStopOrders

  if (!routeId) {
    throw new functions.https.HttpsError("invalid-argument", "routeId required");
  }

  const routeRef = db.collection("companies", companyId, "recurringRoute").doc(routeId);
  const snap = await routeRef.get();

  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Route not found");
  }

  const recurring = recurringRouteOrder || [];
  const active = serviceStopOrders || [];

  // 1. Sort active by order
  const activeSorted = [...active].sort((a, b) => a.order - b.order);

  // 2. Map recurring by recurringServiceStopId
  const recurringMap = new Map(
    recurring.map(r => [r.recurringServiceStopId, { ...r }])
  );

  // 3. Build reordered recurring list
  const reordered = [];

  for (const stop of activeSorted) {
    const match = recurringMap.get(stop.recurringServiceStopId);
    if (match) {
      reordered.push(match);
      recurringMap.delete(stop.recurringServiceStopId);
    }
  }

  // 4. Append remaining recurring stops not in active
  const remaining = Array.from(recurringMap.values())
    .sort((a, b) => a.order - b.order);

  reordered.push(...remaining);

  // 5. Rewrite order indexes
  const finalRecurring = reordered.map((r, index) => ({
    ...r,
    order: index
  }));

  // 6. Save back to Firestore
  await updateDoc(routeRef, {
    recurringRouteOrder: finalRecurring
  });

  return {
    success: true,
    count: finalRecurring.length
  };
});

exports.createHomeOwnerCustomerBasedOnCompany = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const authContext = await getVerifiedCallableAuth(payload, context);
    const authUserId = authContext?.uid;

    if (!authUserId) {
      return {
        status: 401,
        error: "You must be signed in to connect this customer account"
      };
    }

    const homeownerId = payload.homeownerId || payload.userId || authUserId;
    if (homeownerId !== authUserId) {
      return {
        status: 403,
        error: "Authenticated user does not match the homeowner account"
      };
    }

    return await linkHomeownerToCompanyCustomer({
      companyId: payload.companyId,
      customerId: payload.customerId,
      homeownerId,
      authEmail: authContext?.token?.email || payload.email || "",
      inviteId: payload.inviteId || payload.linkedInviteId || "",
      source: payload.source || "companyDirectLink",
      requestedByUserId: authUserId,
    });
  } catch (error) {
    console.error("Error connecting homeowner account to company customer", error);
    return {
      status: 500,
      error: error.message || "Could not connect homeowner account"
    };
  }
});

exports.makeUpdatesToRecurringRoutes = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyUserId
  console.log("companyId ", companyId)

  //Maybe its something like

  // On create of recurring service stop

  //Check to see if recurring Route exists

  // if exists make updates to route. 

  // if does not exist make a new route


  return {
    success: true,
    count: finalRecurring.length
  };
});


exports.deleteRecurringServiceStop = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  // Optional: require auth
  // if (!context.auth) {
  //   throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  // }

  const receivedData = data?.data ?? data; // supports either {data:{...}} or {...}
  const companyId = receivedData?.companyId;
  const stopId = receivedData?.stopId;

  if (!companyId || !stopId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing companyId or stopId."
    );
  }

  console.log("companyId", companyId);
  console.log("stopId", stopId);

  // ---- Customize these to your schema ----
  const SERVICE_STOPS_COL = `companies/${companyId}/serviceStops`;
  const RECURRING_STOPS_COL = `companies/${companyId}/recurringServiceStop`;

  // Field on each generated stop that links back to the recurring template
  const LINK_FIELD = "recurringServiceStopId";

  // Date field on the generated stops (Firestore Timestamp recommended)
  const DATE_FIELD = "serviceDate";
  // ---------------------------------------

  // "Today" (start of day) so we only delete future stops
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayTs = Timestamp.fromDate(startOfToday);

  // 1) Query all future service stops tied to this recurring stop
  // NOTE: If you store date as milliseconds number, use a number compare instead of Timestamp.
  const stopsQuery = db
    .collection(SERVICE_STOPS_COL)
    .where(LINK_FIELD, "==", stopId)
    .where(DATE_FIELD, ">=", todayTs);

  let totalDeleted = 0;

  // Helper: delete in batches of 500
  async function deleteQueryInBatches() {
    while (true) {
      const snap = await stopsQuery.limit(500).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      totalDeleted += snap.size;
    }
  }

  // 2) Delete the generated service stops
  await deleteQueryInBatches();

  // 3) Get the recurring template doc before deleting it.
  // We need this data for removeRSSFromRecurringRoute.
  const recurringRef = db.collection(RECURRING_STOPS_COL).doc(stopId);
  const recurringSnap = await recurringRef.get();

  if (!recurringSnap.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Recurring service stop was not found."
    );
  }

  const rss = {
    id: recurringSnap.id,
    ...recurringSnap.data(),
  };

  // 4) Remove RSS from recurring routes before deleting the template.
  await removeRSSFromRecurringRoute({ db, companyId, rss });

  // 5) Delete the recurring template doc.
  await recurringRef.delete();
  return {
    success: true,
    count: totalDeleted,
  };
});


async function removeRSSFromRecurringRoute({ db, companyId, rss }) {
  try {
    const ROUTES_COL = `companies/${companyId}/recurringRoutes`;
    const routeSnapshots = await Promise.all([
      db.collection(ROUTES_COL).get(),
      db.collection(ROUTES_COL).where("rssIds", "array-contains", rss.id).get(),
    ]);
    const routesById = new Map();

    routeSnapshots.forEach((querySnapshot) => {
      querySnapshot.docs.forEach((routeDoc) => {
        routesById.set(routeDoc.id, routeDoc);
      });
    });

    for (const routeDoc of routesById.values()) {
      const documentData = routeDoc.data();
      const currentOrder = Array.isArray(documentData.order) ? documentData.order : [];

      const filteredOrder = currentOrder.filter(
        (item) => item.recurringServiceStopId !== rss.id
      );

      const hadOrderMatch = filteredOrder.length !== currentOrder.length;
      const hadRssIdMatch = Array.isArray(documentData.rssIds) && documentData.rssIds.includes(rss.id);

      if (!hadOrderMatch && !hadRssIdMatch) {
        continue;
      }

      // Re-index order to keep it aligned with handleSaveTemplate
      const updatedOrder = filteredOrder.map((item, index) => ({
        ...item,
        order: index + 1,
      }));
      const updates = {
        order: updatedOrder,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (Array.isArray(documentData.rssIds)) {
        updates.rssIds = documentData.rssIds.filter((rssId) => rssId !== rss.id);
      }

      const routeRef = db
        .collection("companies")
        .doc(companyId)
        .collection("recurringRoutes")
        .doc(routeDoc.id);

      await routeRef.set(updates, { merge: true });
    }

    return [...routesById.values()];
  } catch (error) {
    console.log("Error removing RSS from recurring route:", error);
    throw error;
  }
}



exports.endRecurringServiceStop = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let stopId = receivedData.stopId
  console.log("companyId ", companyId)
  console.log("stopId ", stopId)




  return {
    success: true,
    count: finalRecurring.length
  };
});


exports.updateRecurringServiceStop = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data;

  const companyId = receivedData.companyId;
  const recurringServiceStop = receivedData.recurringServiceStop;

  if (!companyId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "companyId is required."
    );
  }

  if (!recurringServiceStop || !recurringServiceStop.id) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "recurringServiceStop with a valid id is required."
    );
  }

  const companyRef = db.collection("companies").doc(companyId);

  const recurringServiceStopRef = companyRef
    .collection("recurringServiceStop")
    .doc(recurringServiceStop.id);

  const serviceStopsRef = companyRef.collection("serviceStops");

  function removeUndefinedValues(obj) {
    const cleaned = {};

    Object.keys(obj).forEach((key) => {
      if (obj[key] !== undefined) {
        cleaned[key] = obj[key];
      }
    });

    return cleaned;
  }

  function toFirestoreTimestamp(value) {
    if (value === undefined || value === null) {
      return null;
    }

    if (value && typeof value.toDate === "function") {
      return value;
    }

    if (value instanceof Date) {
      return admin.firestore.Timestamp.fromDate(value);
    }

    if (typeof value === "string") {
      const parsedDate = new Date(value);

      if (!isNaN(parsedDate.getTime())) {
        return admin.firestore.Timestamp.fromDate(parsedDate);
      }
    }

    if (typeof value === "number") {
      return admin.firestore.Timestamp.fromMillis(value);
    }

    if (typeof value === "object") {
      if (
        typeof value._seconds === "number" &&
        typeof value._nanoseconds === "number"
      ) {
        return new admin.firestore.Timestamp(value._seconds, value._nanoseconds);
      }

      if (
        typeof value.seconds === "number" &&
        typeof value.nanoseconds === "number"
      ) {
        return new admin.firestore.Timestamp(value.seconds, value.nanoseconds);
      }

      if (typeof value.seconds === "number") {
        return new admin.firestore.Timestamp(value.seconds, 0);
      }
    }

    return value;
  }

  function normalizeRecurringServiceStopTypeFields(rss, contextLabel) {
    const hasTypeId = typeof rss?.typeId === "string" && rss.typeId.trim().length > 0;
    const hasType = typeof rss?.type === "string" && rss.type.trim().length > 0;
    const fields = {
      typeId: hasTypeId ? rss.typeId : "system_recurring_service_stop",
      type: hasType ? rss.type : "Recurring Service Stop",
      typeImage: typeof rss?.typeImage === "string" && rss.typeImage.trim().length > 0
        ? rss.typeImage
        : "figure.pool.swim",
    };

    if (!hasTypeId || !hasType) {
      console.warn("[ServiceStopTypeFunction][fallback]", {
        context: contextLabel,
        recurringServiceStopId: rss?.id || "",
        incomingTypeId: rss?.typeId || "",
        incomingType: rss?.type || "",
        resolvedTypeId: fields.typeId,
        resolvedType: fields.type,
      });
    }

    return fields;
  }

  function normalizeRecurringServiceStopForFirestore(rss) {
    const serviceStopTypeFields = normalizeRecurringServiceStopTypeFields(
      rss,
      "normalizeRecurringServiceStopForFirestore"
    );

    return removeUndefinedValues({
      id: rss.id,
      internalId: rss.internalId,
      type: serviceStopTypeFields.type,
      typeId: serviceStopTypeFields.typeId,
      typeImage: serviceStopTypeFields.typeImage,
      customerName: rss.customerName,
      customerId: rss.customerId,
      address: rss.address,

      tech: rss.tech,
      techId: rss.techId,

      dateCreated: toFirestoreTimestamp(rss.dateCreated),
      startDate: toFirestoreTimestamp(rss.startDate),
      endDate: rss.noEndDate ? null : toFirestoreTimestamp(rss.endDate),
      noEndDate: rss.noEndDate,

      frequency: rss.frequency,
      day: rss.day,
      description: rss.description,

      lastCreated: toFirestoreTimestamp(rss.lastCreated),
      serviceLocationId: rss.serviceLocationId,
      estimatedTime: rss.estimatedTime,

      otherCompany: rss.otherCompany,
      laborContractId: rss.laborContractId ?? null,
      contractedCompanyId: rss.contractedCompanyId ?? null,
      mainCompanyId: rss.mainCompanyId ?? null,

      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  function buildServiceStopPatch(rss) {
    return removeUndefinedValues({
      tech: rss.tech,
      techId: rss.techId,
      description: rss.description,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  async function commitInBatches(writeOperations) {
    const batchSize = 450;
    let committedWrites = 0;

    for (let i = 0; i < writeOperations.length; i += batchSize) {
      const batch = db.batch();
      const chunk = writeOperations.slice(i, i + batchSize);

      chunk.forEach((operation) => {
        if (operation.type === "set") {
          batch.set(operation.ref, operation.data, operation.options || {});
        }

        if (operation.type === "update") {
          batch.update(operation.ref, operation.data);
        }
      });

      await batch.commit();
      committedWrites += chunk.length;
    }

    return committedWrites;
  }

  try {
    const existingRecurringSnap = await recurringServiceStopRef.get();

    if (!existingRecurringSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Recurring service stop was not found."
      );
    }

    const previousRSS = {
      id: existingRecurringSnap.id,
      ...existingRecurringSnap.data()
    };

    const normalizedRecurringServiceStop =
      normalizeRecurringServiceStopForFirestore(recurringServiceStop);

    const serviceStopPatch = buildServiceStopPatch(recurringServiceStop);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

    const futureServiceStopsSnapshot = await serviceStopsRef
      .where("recurringServiceStopId", "==", recurringServiceStop.id)
      .where("serviceDate", ">=", todayTimestamp)
      .get();

    const writeOperations = [];

    writeOperations.push({
      type: "set",
      ref: recurringServiceStopRef,
      data: normalizedRecurringServiceStop,
      options: { merge: true }
    });

    futureServiceStopsSnapshot.docs.forEach((serviceStopDoc) => {
      writeOperations.push({
        type: "update",
        ref: serviceStopDoc.ref,
        data: serviceStopPatch
      });
    });

    const committedWrites = await commitInBatches(writeOperations);

    const recurringRouteResult = await updateRecurringRouteOrderForRSS({
      db,
      companyId,
      previousRSS,
      updatedRSS: recurringServiceStop
    });

    return {
      success: true,
      recurringServiceStopId: recurringServiceStop.id,
      updatedServiceStopCount: futureServiceStopsSnapshot.size,
      committedWrites: committedWrites,
      recurringRouteResult: recurringRouteResult
    };
  } catch (error) {
    console.error("[updateRecurringServiceStop] Error:", error);

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Unable to update recurring service stop."
    );
  }
});
async function updateRecurringRouteOrderForRSS({
  db,
  companyId,
  previousRSS,
  updatedRSS
}) {
  const recurringRoutesRef = db
    .collection("companies")
    .doc(companyId)
    .collection("recurringRoutes");

  const rssId = updatedRSS.id;

  if (!rssId) {
    throw new Error("Missing updatedRSS.id.");
  }

  const updatedDay = updatedRSS.day;
  const updatedTech = updatedRSS.tech;
  const updatedTechId = updatedRSS.techId;

  if (!updatedDay || !updatedTechId) {
    console.log("[updateRecurringRouteOrderForRSS] Missing day or techId. Skipping route update.", {
      rssId,
      updatedDay,
      updatedTechId
    });

    return {
      skipped: true,
      reason: "Missing day or techId."
    };
  }

  const previousDay = previousRSS?.day;
  const previousTechId = previousRSS?.techId;

  const routeChanged =
    previousDay !== updatedDay ||
    previousTechId !== updatedTechId;

  const updatedOrderItem = {
    id: rssId,
    recurringServiceStopId: rssId,
    customerId: updatedRSS.customerId,
    customerName: updatedRSS.customerName,
    locationId: updatedRSS.serviceLocationId,
    order: 0
  };

  let removedFromRouteIds = [];
  let updatedRouteId = null;
  let createdRouteId = null;

  // 1) Remove this RSS from every route where it currently appears.
  // This prevents duplicates and handles day/tech moves cleanly.
  const allRoutesSnap = await recurringRoutesRef.get();

  for (const routeDoc of allRoutesSnap.docs) {
    const routeData = routeDoc.data();

    const currentOrder = Array.isArray(routeData.order)
      ? routeData.order
      : [];

    const filteredOrder = currentOrder.filter((item) => {
      return item.recurringServiceStopId !== rssId;
    });

    if (filteredOrder.length !== currentOrder.length) {
      const reIndexedOrder = filteredOrder.map((item, index) => ({
        ...item,
        order: index + 1
      }));

      await routeDoc.ref.update({
        order: reIndexedOrder,
        rssIds: admin.firestore.FieldValue.arrayRemove(rssId),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      removedFromRouteIds.push(routeDoc.id);
    }
  }

  // 2) Find the destination route: same day + techId as the updated RSS.
  const destinationRoutesSnap = await recurringRoutesRef
    .where("day", "==", updatedDay)
    .where("techId", "==", updatedTechId)
    .limit(1)
    .get();

  // 3) If destination route exists, add this RSS at the end.
  if (!destinationRoutesSnap.empty) {
    const routeDoc = destinationRoutesSnap.docs[0];
    const routeData = routeDoc.data();

    const currentOrder = Array.isArray(routeData.order)
      ? routeData.order
      : [];

    const nextOrder = [
      ...currentOrder,
      {
        ...updatedOrderItem,
        order: currentOrder.length + 1
      }
    ].map((item, index) => ({
      ...item,
      order: index + 1
    }));

    await routeDoc.ref.update({
      tech: updatedTech,
      techId: updatedTechId,
      day: updatedDay,
      order: nextOrder,
      rssIds: admin.firestore.FieldValue.arrayUnion(rssId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    updatedRouteId = routeDoc.id;
  }

  // 4) If destination route does not exist, create it.
  else {
    const newRouteRef = recurringRoutesRef.doc();

    await newRouteRef.set({
      id: newRouteRef.id,
      tech: updatedTech,
      techId: updatedTechId,
      day: updatedDay,
      description: "",
      order: [
        {
          ...updatedOrderItem,
          order: 1
        }
      ],
      rssIds: [rssId],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    createdRouteId = newRouteRef.id;
  }

  return {
    skipped: false,
    routeChanged,
    removedFromRouteIds,
    updatedRouteId,
    createdRouteId
  };
}
