import { DripDropStoredImage } from "./DripDropStoredImage";
import { format } from 'date-fns/format';

export class EquipmentHO {
  constructor({
    id = null,
    bodyOfWaterId = "",
    category = "",
    cleanFilterPressure = 0,
    currentPressure = 0,
    userId = "",
    customerName = "",
    dateInstalled = null,
    lastServiceDate = null,
    type = "",
    typeId = "",
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
    this.category = category;
    this.cleanFilterPressure = cleanFilterPressure;
    this.currentPressure = currentPressure;
    this.userId = userId;
    this.customerName = customerName;
    this.dateInstalled = dateInstalled;
    this.lastServiceDate = lastServiceDate;
    this.isActive = isActive;
    this.type = type;
    this.typeId = typeId;
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
      category: this.category,
      cleanFilterPressure: this.cleanFilterPressure,
      currentPressure: this.currentPressure,
      userId: this.userId,
      customerName: this.customerName,
      dateInstalled: this.dateInstalled,
      lastServiceDate: this.lastServiceDate,
      isActive: this.isActive,
      type: this.type,
      typeId: this.typeId,
      make: this.make,
      makeId: this.makeId,
      model: this.model,
      modelId: this.modelId,
      universalEquipmentId: this.universalEquipmentId,
      manualPdfLink: this.manualPdfLink,
      name: this.name,
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

    return new EquipmentHO({
      id: snapshot.id,
      bodyOfWaterId: data.bodyOfWaterId || "",
      category: data.category || "",
      cleanFilterPressure: data.cleanFilterPressure || 0,
      currentPressure: data.currentPressure || 0,
      userId: data.userId || "",
      customerName: data.customerName || "",
      dateInstalled: data.dateInstalled ? data.dateInstalled.toDate() : null,
      lastServiceDate: data.lastServiceDate ? data.lastServiceDate.toDate() : null,
      type: data.type || data.category || "",
      typeId: data.typeId || "",
      make: data.make || "",
      makeId: data.makeId || "",
      model: data.model || "",
      modelId: data.modelId || data.universalEquipmentId || "",
      universalEquipmentId: data.universalEquipmentId || data.modelId || "",
      manualPdfLink: data.manualPdfLink || "",
      name: data.name || "",
      needsService: data.needsService || false,
      isActive: data.isActive || false,
      nextServiceDate: data.nextServiceDate ? data.nextServiceDate.toDate() : null,
      notes: data.notes || "",
      photoUrls: data.photoUrls ? data.photoUrls.map(url => new DripDropStoredImage(url)) : [],
      serviceFrequency: data.serviceFrequency || "",
      serviceFrequencyEvery: data.serviceFrequencyEvery || "",
      serviceLocationId: data.serviceLocationId || "",
      status: data.status || "",
      verified: data.verified || false,
    });
  }
}
