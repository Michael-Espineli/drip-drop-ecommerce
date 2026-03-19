import {DripDropStoredImage} from "./DripDropStoredImage";
import { format } from 'date-fns/format'; 

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
    lastServiceDate = null,
    make = "",
    makeId = "",
    model = "",
    modelId = "",
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
    this.lastServiceDate = lastServiceDate;
    this.make = make;
    this.makeId = makeId;
    this.model = model;
    this.modelId = modelId;
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
      typeId: this.typeId,
      cleanFilterPressure: this.cleanFilterPressure,
      currentPressure: this.currentPressure,
      customerId: this.customerId,
      customerName: this.customerName,
      dateInstalled: this.dateInstalled,
      lastServiceDate: this.lastServiceDate,
      make: this.make,
      makeId: this.makeId,
      model: this.model,
      modelId: this.modelId,
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

    return new Equipment({
      id: snapshot.id,
      bodyOfWaterId: data.bodyOfWaterId || "",
      type: data.type || "",
      typeId: data.typeId || "",
      cleanFilterPressure: data.cleanFilterPressure || 0,
      currentPressure: data.currentPressure || 0,
      customerId: data.customerId || "",
      customerName: data.customerName || "",
      dateInstalled: data.dateInstalled ? data.dateInstalled.toDate() : null,
      lastServiceDate: data.lastServiceDate ? data.lastServiceDate.toDate() : null,
      make: data.make || "",
      makeId: data.makeId || "",
      model: data.model || "",
      modelId: data.modelId || "",
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