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

const recordKey = (record = {}) =>
  record.id ||
  stopDataIdFor({
    serviceStopId: record.serviceStopId || "",
    bodyOfWaterId: record.bodyOfWaterId || "",
  });

const dateMillis = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const mergeStopDataRecords = (records = []) => {
  const merged = new Map();

  records.forEach((record) => {
    const key = recordKey(record);
    const current = merged.get(key) || {};
    merged.set(key, {
      ...current,
      ...record,
      id: record.id || current.id || key,
      readings: Array.isArray(record.readings) ? record.readings : current.readings || [],
      dosages: Array.isArray(record.dosages) ? record.dosages : current.dosages || [],
      observation: Array.isArray(record.observation)
        ? record.observation
        : Array.isArray(record.observations)
          ? record.observations
          : current.observation || [],
      equipmentMeasurements: Array.isArray(record.equipmentMeasurements)
        ? record.equipmentMeasurements
        : current.equipmentMeasurements || [],
      testerStripScans: Array.isArray(record.testerStripScans)
        ? record.testerStripScans
        : current.testerStripScans || [],
    });
  });

  return Array.from(merged.values()).sort((left, right) => dateMillis(right.date) - dateMillis(left.date));
};

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
    rate: template.rate || template.cost || "",
    cost: template.cost || template.rate || "",
    price: template.price || "",
    costCents: template.costCents || template.unitCostCents || 0,
    unitCostCents: template.unitCostCents || template.costCents || 0,
    priceCents: template.priceCents || template.unitPriceCents || 0,
    unitPriceCents: template.unitPriceCents || template.priceCents || 0,
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
    testerStripScans: Array.isArray(existingStopData?.testerStripScans)
      ? existingStopData.testerStripScans
      : [],
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

  const compatibilityWrites = [];

  if (stopData.serviceStopId) {
    compatibilityWrites.push(
      setDoc(
        doc(db, "companies", companyId, "serviceStops", stopData.serviceStopId, "stores", stopData.id),
        stopData,
        { merge: true }
      )
    );
  }

  if (writeHomeownerCopies) {
    const customerVisibleStopData = { ...stopData };
    delete customerVisibleStopData.testerStripScans;

    compatibilityWrites.push(
      setDoc(doc(db, "homeownerStopData", stopData.id), customerVisibleStopData, { merge: true }),
      setDoc(doc(db, "stopData", stopData.id), customerVisibleStopData, { merge: true })
    );
  }

  if (compatibilityWrites.length) {
    const results = await Promise.allSettled(compatibilityWrites);
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.warn("Stop data compatibility copy failed:", result.reason);
      }
    });
  }

  return stopData;
};

export const fetchStopDataForServiceStop = async ({ db, companyId, serviceStopId } = {}) => {
  if (!db || !companyId || !serviceStopId) return [];

  const [companyStopDataResult, serviceStopStoreResult] = await Promise.allSettled([
    getDocs(
      query(
        collection(db, "companies", companyId, "stopData"),
        where("serviceStopId", "==", serviceStopId)
      )
    ),
    getDocs(collection(db, "companies", companyId, "serviceStops", serviceStopId, "stores")),
  ]);

  const companyRecords = companyStopDataResult.status === "fulfilled"
    ? companyStopDataResult.value.docs.map((stopDataDoc) => ({
      id: stopDataDoc.id,
      ...stopDataDoc.data(),
    }))
    : [];

  const storeRecords = serviceStopStoreResult.status === "fulfilled"
    ? serviceStopStoreResult.value.docs.map((storeDoc) => ({
      id: storeDoc.id,
      serviceStopId,
      ...storeDoc.data(),
    }))
    : [];

  [companyStopDataResult, serviceStopStoreResult].forEach((result) => {
    if (result.status === "rejected") {
      console.warn("Failed to load service stop data:", result.reason);
    }
  });

  return mergeStopDataRecords([...storeRecords, ...companyRecords]);
};
