import {DripDropStoredImage} from "./DripDropStoredImage";
import { format } from 'date-fns/format'; 

export class EquipmentHO {
  constructor({
    id = null,
    bodyOfWaterId = "",
    category = "",
    cleanFilterPressure = 0,
    currentPressure = 0,
    userId = "",
    dateInstalled = null,
    lastServiceDate = null,
    make = "",
    model = "",
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
    this.dateInstalled = dateInstalled;
    this.lastServiceDate = lastServiceDate;
    this.isActive = isActive;
    this.make = make;
    this.model = model;
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
      make: this.make,
      model: this.model,
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
      dateInstalled: data.dateInstalled ? data.dateInstalled.toDate() : null,
      lastServiceDate: data.lastServiceDate ? data.lastServiceDate.toDate() : null,
      make: data.make || "",
      model: data.model || "",
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