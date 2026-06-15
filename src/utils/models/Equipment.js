import { DripDropStoredImage } from "./DripDropStoredImage";

export const EQUIPMENT_STATUS = {
  OPERATIONAL: "Operational",
  NEEDS_REPAIR: "Needs Repair",
  NON_OPERATIONAL: "Non-Operational",
  LEGACY_NONOPERATIONAL: "Nonoperational",
  NEEDS_MAINTENANCE: "Needs Maintenance",
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

export const displayEquipmentStatus = (status) => {
  if (normalizeEquipmentStatus(status) === normalizeEquipmentStatus(EQUIPMENT_STATUS.NON_OPERATIONAL)) {
    return EQUIPMENT_STATUS.NON_OPERATIONAL;
  }

  return status || "";
};

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
      dateInstalled: data.dateInstalled ? data.dateInstalled.toDate() : null,
      dateUninstalled: data.dateUninstalled ? data.dateUninstalled.toDate() : null,
      lastServiceDate: data.lastServiceDate ? data.lastServiceDate.toDate() : null,
      make: data.make || "",
      makeId: data.makeId || "",
      model: data.model || "",
      modelId: data.modelId || "",
      universalEquipmentId: data.universalEquipmentId || data.modelId || "",
      manualPdfLink: data.manualPdfLink || "",
      name: data.name || "",
      needsService: data.needsService || false,
      isActive: data.isActive ?? data.active ?? false,
      nextServiceDate: data.nextServiceDate ? data.nextServiceDate.toDate() : null,
      notes: data.notes || "",
      photoUrls: data.photoUrls ? data.photoUrls.map(url => new DripDropStoredImage(url)) : [],
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
      status: data.status || "",
      verified: data.verified || false,
    });
  }
}
