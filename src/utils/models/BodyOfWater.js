import { DripDropStoredImage } from "./DripDropStoredImage";
import { format } from 'date-fns/format';

export class BodyOfWater {
  constructor({
    id = null,
    name = "",
	    gallons = "",
	    material = "",
	    waterType = "",
	    customerId = "",
    serviceLocationId = "",
    notes = null,
    shape = null,
    length = null,
    depth = null,
    width = null,
    photoUrls = [],
    lastFilled = new Date(),
    label = "",
    isActive = true
  } = {}) {
    this.id = id;
    this.name = name;
	    this.gallons = gallons;
	    this.material = material;
	    this.waterType = waterType;
    this.customerId = customerId;
    this.serviceLocationId = serviceLocationId;
    this.notes = notes;
    this.shape = shape;
    this.length = length;
    this.depth = depth;
    this.width = width;
    this.photoUrls = photoUrls;
    this.lastFilled = lastFilled;
    this.label = label;
    this.isActive = isActive;
  }

  toFirestore() {
    return {
      name: this.name,
	      gallons: this.gallons,
	      material: this.material,
	      waterType: this.waterType,
      customerId: this.customerId,
      serviceLocationId: this.serviceLocationId,
      notes: this.notes,
      shape: this.shape,
      length: this.length,
      depth: this.depth,
      width: this.width,
      photoUrls: this.photoUrls,
      lastFilled: this.lastFilled,
      isActive: this.isActive,

    };
  }

  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options);

    const lastFilled = data.lastFilled?.toDate ? data.lastFilled.toDate() : new Date();
    const lastFilledFormatted = format(lastFilled, 'MM / d / yyyy');
    return new BodyOfWater({
      id: snapshot.id,
      name: data.name || "",
	      gallons: data.gallons || "",
	      material: data.material || "",
	      waterType: data.waterType || "",
      customerId: data.customerId || "",
      serviceLocationId: data.serviceLocationId || "",
      notes: data.notes || null,
      shape: data.shape || null,
      length: data.length || null,
      depth: data.depth || null,
      width: data.width || null,
      photoUrls: data.photoUrls ? data.photoUrls.map(url => new DripDropStoredImage(url)) : [],
      lastFilled,
      lastFilledFormatted: lastFilledFormatted,
      label: data.name + ' ' + data.shape + ' ' + data.material,
      isActive: data.isActive || false
    });
  }


}
