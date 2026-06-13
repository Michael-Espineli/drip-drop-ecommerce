import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";

const fallbackId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const cleanId = (sourceId = "") =>
  String(sourceId || fallbackId()).replaceAll("/", "_").replace(/\s/g, "_");

const compact = (items = []) =>
  items.filter((item) => item !== undefined && item !== null && item !== "");

const toDateValue = (value) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const stopDataIdFor = ({ serviceStopId = "", bodyOfWaterId = "" }) =>
  `com_sd_${cleanId(serviceStopId || "manual")}_${cleanId(bodyOfWaterId || "general")}`;

export const normalizeReadingForStopData = (template = {}, amount = "", bodyOfWaterId = "") => ({
  id: template.stopDataReadingId || `reading_${cleanId(template.id || template.readingsTemplateId || fallbackId())}`,
  templateId: template.templateId || template.id || "",
  universalTemplateId: template.universalTemplateId || template.readingsTemplateId || template.id || "",
  dosageType: template.dosageType || template.chemType || "",
  name: template.name || "",
  amount: amount === null || amount === undefined ? "" : String(amount),
  UOM: template.UOM || template.uom || "",
  bodyOfWaterId,
});

export const normalizeDosageForStopData = (template = {}, amount = "", bodyOfWaterId = "") => {
  const linkedItemIds = compact([
    ...(Array.isArray(template.linkedItemIds) ? template.linkedItemIds : []),
    template.linkedItemId,
    template.linkedItem,
    template.linkedDosage,
    template.itemId,
  ]);

  return {
    id: template.stopDataDosageId || `dosage_${cleanId(template.id || template.dosageTemplateId || fallbackId())}`,
    templateId: template.templateId || template.id || "",
    universalTemplateId: template.universalTemplateId || template.dosageTemplateId || template.id || "",
    name: template.name || "",
    amount: amount === null || amount === undefined ? "" : String(amount),
    UOM: template.UOM || template.uom || "",
    rate: template.rate || "",
    linkedItem: linkedItemIds[0] || "",
    linkedItemIds,
    bodyOfWaterId,
  };
};

export const buildStopDataRecord = ({
  existingStopData = null,
  serviceStop = {},
  serviceStopId = "",
  bodyOfWaterId = "",
  readings = [],
  dosages = [],
  observation = [],
  userId = "",
  date = new Date(),
  equipmentMeasurements = null,
} = {}) => {
  const resolvedServiceStopId = serviceStopId || serviceStop?.id || "";
  const resolvedBodyOfWaterId = bodyOfWaterId || existingStopData?.bodyOfWaterId || "";
  const id =
    existingStopData?.id ||
    stopDataIdFor({
      serviceStopId: resolvedServiceStopId,
      bodyOfWaterId: resolvedBodyOfWaterId,
    });

  return {
    id,
    date: toDateValue(date || existingStopData?.date),
    serviceStopId: resolvedServiceStopId,
    readings: readings.filter((item) => item.amount !== ""),
    dosages: dosages.filter((item) => item.amount !== ""),
    observation: compact(Array.isArray(observation) ? observation : [observation]),
    bodyOfWaterId: resolvedBodyOfWaterId,
    customerId: serviceStop?.customerId || existingStopData?.customerId || "",
    serviceLocationId: serviceStop?.serviceLocationId || existingStopData?.serviceLocationId || "",
    userId: userId || serviceStop?.techId || existingStopData?.userId || "",
    equipmentMeasurements:
      equipmentMeasurements ||
      existingStopData?.equipmentMeasurements ||
      [],
  };
};

export const saveStopDataRecord = async ({
  db,
  companyId,
  stopData,
  writeHomeownerCopies = true,
} = {}) => {
  if (!db || !companyId || !stopData?.id) {
    throw new Error("Missing company, database, or stop data id.");
  }

  await setDoc(doc(db, "companies", companyId, "stopData", stopData.id), stopData, { merge: true });

  if (writeHomeownerCopies) {
    await Promise.allSettled([
      setDoc(doc(db, "homeownerStopData", stopData.id), stopData, { merge: true }),
      setDoc(doc(db, "stopData", stopData.id), stopData, { merge: true }),
    ]);
  }

  return stopData;
};

export const fetchStopDataForServiceStop = async ({ db, companyId, serviceStopId } = {}) => {
  if (!db || !companyId || !serviceStopId) return [];

  const snapshot = await getDocs(
    query(
      collection(db, "companies", companyId, "stopData"),
      where("serviceStopId", "==", serviceStopId)
    )
  );

  return snapshot.docs.map((stopDataDoc) => ({
    id: stopDataDoc.id,
    ...stopDataDoc.data(),
  }));
};
