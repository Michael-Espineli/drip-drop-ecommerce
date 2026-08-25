import { DripDropStoredImage } from "./DripDropStoredImage";

export const EQUIPMENT_STATUS = {
  OPERATIONAL: "Operational",
  NEEDS_REPAIR: "Needs Repair",
  NON_OPERATIONAL: "Non-Operational",
  LEGACY_NONOPERATIONAL: "Nonoperational",
  NEEDS_MAINTENANCE: "Needs Maintenance",
  UNINSTALLED: "Uninstalled",
  REPLACED: "Replaced",
};

export const EQUIPMENT_STATUS_OPTIONS = [
  EQUIPMENT_STATUS.OPERATIONAL,
  EQUIPMENT_STATUS.NEEDS_REPAIR,
  EQUIPMENT_STATUS.NON_OPERATIONAL,
  EQUIPMENT_STATUS.NEEDS_MAINTENANCE,
];

export const normalizeEquipmentStatus = (status) => (
  String(status || "").trim().toLowerCase().replace(/[-_\s]/g, "")
);

const finalInactiveEquipmentStatusKeys = new Set([
  EQUIPMENT_STATUS.UNINSTALLED,
  EQUIPMENT_STATUS.REPLACED,
].map(normalizeEquipmentStatus));

export const isFinalInactiveEquipmentStatus = (status) => (
  finalInactiveEquipmentStatusKeys.has(normalizeEquipmentStatus(status))
);

export const isFinalInactiveEquipment = (equipment = {}) => (
  isFinalInactiveEquipmentStatus(equipment.status || equipment.operationStatus || equipment.equipmentStatus) ||
  Boolean(equipment.dateUninstalled) ||
  Boolean(equipment.replacedByEquipmentId)
);

export const canReactivateEquipmentWithCustomer = (equipment = {}) => (
  !isFinalInactiveEquipment(equipment)
);

export const displayEquipmentStatus = (status) => {
  if (normalizeEquipmentStatus(status) === normalizeEquipmentStatus(EQUIPMENT_STATUS.NON_OPERATIONAL)) {
    return EQUIPMENT_STATUS.NON_OPERATIONAL;
  }

  return status || "";
};

const normalizedEquipmentText = (equipment = {}) => (
  [
    equipment.type,
    equipment.category,
    equipment.name,
    equipment.make,
    equipment.model,
    equipment.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
);

export const isFilterEquipment = (equipment = {}) => (
  /\b(filter|cartridge|sand\s+filter|d\.?e\.?\s+filter)\b/.test(normalizedEquipmentText(equipment))
);

export const isSaltCellEquipment = (equipment = {}) => (
  /\b(salt\s*cell|salt\s+chlorine|salt\s+chlorinator|chlorine\s+generator|salt\s+generator)\b/.test(
    normalizedEquipmentText(equipment)
  )
);

export const equipmentDefaultsToNeedsService = (equipment = {}) => (
  isFilterEquipment(equipment) || isSaltCellEquipment(equipment)
);

export const buildEquipmentNickname = (equipment = {}) => (
  [equipment.make, equipment.model].filter(Boolean).join(" ").trim()
  || equipment.model
  || equipment.name
  || equipment.type
  || equipment.category
  || ""
);

const equipmentDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.toMillis === "function") {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  const parsed = Number.isFinite(numericValue)
    ? new Date(numericValue < 1000000000000 ? numericValue * 1000 : numericValue)
    : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const equipmentPhotoUrls = (value) => (
  Array.isArray(value) ? value.map(url => new DripDropStoredImage(url)) : []
);

export class Equipment {
  constructor({
    id = null,
    bodyOfWaterId = "",
    type = "",
    typeId = "",
    cleanFilterPressure = 0,
    currentPressure = 0,
    customerId = "",
    customerName = "",
    createdAt = null,
    createdAtMillis = null,
    dateInstalled = null,
    dateUninstalled = null,
    lastServiceDate = null,
    make = "",
    makeId = "",
    model = "",
    modelId = "",
    universalEquipmentId = "",
    manualPdfLink = "",
    name = "",
    needsService = false,
    isActive = false,
    nextServiceDate = null,
    notes = "",
    photoUrls = [],
    serviceFrequency = "",
    serviceFrequencyEvery = "",
    serviceLocationId = "",
    status = "",
    verified = false,
  } = {}) {
    this.id = id;
    this.bodyOfWaterId = bodyOfWaterId;
    this.type = type;
    this.typeId = typeId;
    this.cleanFilterPressure = cleanFilterPressure;
    this.currentPressure = currentPressure;
    this.customerId = customerId;
    this.customerName = customerName;
    this.createdAt = createdAt;
    this.createdAtMillis = createdAtMillis;
    this.isActive = isActive;
    this.dateInstalled = dateInstalled;
    this.dateUninstalled = dateUninstalled;
    this.lastServiceDate = lastServiceDate;
    this.make = make;
    this.makeId = makeId;
    this.model = model;
    this.modelId = modelId;
    this.universalEquipmentId = universalEquipmentId;
    this.manualPdfLink = manualPdfLink;
    this.name = name;
    this.needsService = needsService;
    this.nextServiceDate = nextServiceDate;
    this.notes = notes;
    this.photoUrls = photoUrls;
    this.serviceFrequency = serviceFrequency;
    this.serviceFrequencyEvery = serviceFrequencyEvery;
    this.serviceLocationId = serviceLocationId;
    this.status = status;
    this.verified = verified;
  }

  toFirestore() {
    return {
      bodyOfWaterId: this.bodyOfWaterId,
      type: this.type,
      typeId: this.typeId,
      cleanFilterPressure: this.cleanFilterPressure,
      currentPressure: this.currentPressure,
      customerId: this.customerId,
      customerName: this.customerName,
      createdAt: this.createdAt,
      createdAtMillis: this.createdAtMillis,
      dateInstalled: this.dateInstalled,
      dateUninstalled: this.dateUninstalled,
      lastServiceDate: this.lastServiceDate,
      make: this.make,
      makeId: this.makeId,
      model: this.model,
      modelId: this.modelId,
      universalEquipmentId: this.universalEquipmentId,
      manualPdfLink: this.manualPdfLink,
      name: this.name,
      isActive: this.isActive,
      needsService: this.needsService,
      nextServiceDate: this.nextServiceDate,
      notes: this.notes,
      photoUrls: this.photoUrls.map(photo => photo.toFirestore()),
      serviceFrequency: this.serviceFrequency,
      serviceFrequencyEvery: this.serviceFrequencyEvery,
      serviceLocationId: this.serviceLocationId,
      status: this.status,
      verified: this.verified,
    };
  }

  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options);
    const rawServiceFrequency = data.serviceFrequency;
    const rawServiceFrequencyEvery = data.serviceFrequencyEvery;
    const legacyFrequencyUnits = {
      Days: "Day",
      Weeks: "Week",
      Months: "Month",
      Years: "Year",
    };

    return new Equipment({
      id: snapshot.id,
      bodyOfWaterId: data.bodyOfWaterId || "",
      type: data.type || data.category || "",
      typeId: data.typeId || "",
      cleanFilterPressure: data.cleanFilterPressure || 0,
      currentPressure: data.currentPressure || 0,
      customerId: data.customerId || "",
      customerName: data.customerName || "",
      createdAt: equipmentDateValue(data.createdAt || data.createdAtMillis),
      createdAtMillis: data.createdAtMillis || null,
      dateInstalled: equipmentDateValue(data.dateInstalled),
      dateUninstalled: equipmentDateValue(data.dateUninstalled),
      lastServiceDate: equipmentDateValue(data.lastServiceDate),
      make: data.make || "",
      makeId: data.makeId || "",
      model: data.model || "",
      modelId: data.modelId || "",
      universalEquipmentId: data.universalEquipmentId || data.modelId || "",
      manualPdfLink: data.manualPdfLink || "",
      name: data.name || "",
      needsService: data.needsService || false,
      isActive: data.isActive ?? data.active ?? false,
      nextServiceDate: equipmentDateValue(data.nextServiceDate),
      notes: data.notes || "",
      photoUrls: equipmentPhotoUrls(data.photoUrls),
      serviceFrequency:
        typeof rawServiceFrequency === "number"
          ? rawServiceFrequency
          : typeof rawServiceFrequencyEvery === "number"
            ? rawServiceFrequencyEvery
            : rawServiceFrequency || "",
      serviceFrequencyEvery:
        typeof rawServiceFrequencyEvery === "string"
          ? (legacyFrequencyUnits[rawServiceFrequencyEvery] || rawServiceFrequencyEvery)
          : typeof rawServiceFrequency === "string"
            ? (legacyFrequencyUnits[rawServiceFrequency] || rawServiceFrequency)
            : "",
      serviceLocationId: data.serviceLocationId || "",
      status: data.status || data.operationStatus || data.equipmentStatus || "",
      verified: data.verified || false,
    });
  }
}
