import { v4 as uuidv4 } from 'uuid';
import { DripDropStoredImage } from './DripDropStoredImage'; // Assuming DripDropStoredImage is also a class

export class RepairRequest {
  constructor({
    id = 'rr_' + uuidv4(),
    customerId = '',
    customerName = '',
    requesterId = '',
    requesterName = '',
    date = new Date(),
    status = 'pending', // Assuming a default status
    description = '',
    jobIds = [],
    photoUrls = [],
    locationId = null,
    bodyOfWaterId = null,
    equipmentId = null,
  } = {}) {
    this.id = id;
    this.customerId = customerId;
    this.customerName = customerName;
    this.requesterId = requesterId;
    this.requesterName = requesterName;
    this.date = date;
    this.status = status;
    this.description = description;
    this.jobIds = jobIds;
    this.photoUrls = photoUrls.map(url => new DripDropStoredImage(url)); // Assuming DripDropStoredImage constructor
    this.locationId = locationId;
    this.bodyOfWaterId = bodyOfWaterId;
    this.equipmentId = equipmentId;
  }

  toFirestore() {
    return {
      id: this.id,
      customerId: this.customerId,
      customerName: this.customerName,
      requesterId: this.requesterId,
      requesterName: this.requesterName,
      date: this.date,
      status: this.status,
      description: this.description,
      jobIds: this.jobIds,
      photoUrls: this.photoUrls.map(image => image.toFirestore()), // Assuming DripDropStoredImage has toFirestore
      locationId: this.locationId,
      bodyOfWaterId: this.bodyOfWaterId,
      equipmentId: this.equipmentId,
    };
  }
}