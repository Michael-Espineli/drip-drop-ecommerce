import {DripDropStoredImage} from "./DripDropStoredImage";
import { format } from 'date-fns/format'; 

export class BodyOfWater {
  constructor({
    id = null,
    name = "",
    gallons = "",
    material = "",
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
  } = {}) {
    this.id = id;
    this.name = name;
    this.gallons = gallons;
    this.material = material;
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
  }

  toFirestore() {
    return {
      name: this.name,
      gallons: this.gallons,
      material: this.material,
      customerId: this.customerId,
      serviceLocationId: this.serviceLocationId,
      notes: this.notes,
      shape: this.shape,
      length: this.length,
      depth: this.depth,
      width: this.width,
      photoUrls: this.photoUrls,
      lastFilled: this.lastFilled,

    };
  }

  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options);

    const lastFilled = data.lastFilled.toDate()
    const lastFilledFormatted = format(lastFilled, 'MM / d / yyyy');
    console.log(lastFilledFormatted) 
    return new BodyOfWater({
      id: snapshot.id,
      name: data.name || "",
      gallons: data.gallons || "",
      material: data.material || "",
      customerId: data.customerId || "",
      serviceLocationId: data.serviceLocationId || "",
      notes: data.notes || null,
      shape: data.shape || null,
      length: data.length || null,
      depth: data.depth || null,
      width: data.width || null,
      photoUrls: data.photoUrls ? data.photoUrls.map(url => new DripDropStoredImage(url)) : [],
      lastFilled: data.lastFilled ? data.lastFilled.toDate() : new Date(),
      lastFilledFormatted: lastFilledFormatted,
      label: data.name + ' ' + data.shape + ' ' + data.material,
    });
  }


}

