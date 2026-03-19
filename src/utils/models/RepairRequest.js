
import { v4 as uuidv4 } from 'uuid';
import { DripDropStoredImage } from './DripDropStoredImage';
import { format } from 'date-fns';

export class RepairRequest {
  constructor({
    id = 'rep_req_' + uuidv4(),
    customerId = '',
    customerName = '',
    requesterId = '',
    requesterName = '',
    date = new Date(),
    formattedDate = 'NA',
    status = 'Unresolved',
    description = '',
    jobIds = [],
    photoUrls = [], // Expecting an array of DripDropStoredImage objects or URL strings
    locationId = null,
    bodyOfWaterId = null,
    equipmentId = null,
    userId = '' // Added this line
  } = {}) {
    this.id = id;
    this.customerId = customerId;
    this.customerName = customerName;
    this.requesterId = requesterId;
    this.requesterName = requesterName;
    this.date = date;
    this.formattedDate = formattedDate;
    this.status = status;
    this.description = description;
    this.jobIds = jobIds;
    this.photoUrls = photoUrls.map(urlOrObject => 
        urlOrObject instanceof DripDropStoredImage ? urlOrObject : new DripDropStoredImage(urlOrObject)
    );
    this.locationId = locationId;
    this.bodyOfWaterId = bodyOfWaterId;
    this.equipmentId = equipmentId;
    this.userId = userId; // Added this line
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
      photoUrls: this.photoUrls.map(image => image.toFirestore()),
      locationId: this.locationId,
      bodyOfWaterId: this.bodyOfWaterId,
      equipmentId: this.equipmentId,
      userId: this.userId // Added this line
    };
  }
  
  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options);
    const date = data.date ? data.date.toDate() : null;
    const formattedDate = date ? format(date, "MMMM d, yyyy") : "N/A";

    return new RepairRequest({
      id: data.id,
      customerId: data.customerId,
      customerName: data.customerName,
      requesterId: data.requesterId,
      requesterName: data.requesterName,
      date: date,
      formattedDate: formattedDate,
      status: data.status,
      description: data.description,
      jobIds: data.jobIds,
      photoUrls: data.photoUrls.map(image => image.toFirestore()),
      locationId: data.locationId,
      bodyOfWaterId: data.bodyOfWaterId,
      equipmentId: data.equipmentId,
      userId: data.userId // Added this line
    });
  }
}
