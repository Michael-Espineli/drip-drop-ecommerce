
import { v4 as uuidv4 } from 'uuid';
import { DripDropStoredImage } from './DripDropStoredImage';
import { format } from 'date-fns';

export const REPAIR_REQUEST_STATUS = {
  UNRESOLVED: 'Unresolved',
  CONVERTED_TO_JOB: 'Converted To Job',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
  LEGACY_IN_PROGRESS: 'In Progress',
  LEGACY_PENDING: 'pending',
  LEGACY_IN_PROGRESS_SLUG: 'in-progress',
};

export const REPAIR_REQUEST_STATUS_OPTIONS = [
  REPAIR_REQUEST_STATUS.UNRESOLVED,
  REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
  REPAIR_REQUEST_STATUS.RESOLVED,
  REPAIR_REQUEST_STATUS.CANCELLED,
];

export const DEFAULT_REPAIR_REQUEST_FILTER_STATUSES = [
  REPAIR_REQUEST_STATUS.UNRESOLVED,
];

const OPEN_REPAIR_REQUEST_STATUSES = new Set([
  REPAIR_REQUEST_STATUS.UNRESOLVED.toLowerCase(),
]);

export const normalizeRepairRequestStatus = (status) => (
  String(status || REPAIR_REQUEST_STATUS.UNRESOLVED).trim().toLowerCase()
);

export const isLegacyPendingRepairRequestStatus = (status) => (
  normalizeRepairRequestStatus(status) === REPAIR_REQUEST_STATUS.LEGACY_PENDING
);

export const repairRequestStatusForSelection = (status) => {
  if (!status || isLegacyPendingRepairRequestStatus(status)) {
    return REPAIR_REQUEST_STATUS.UNRESOLVED;
  }

  return status;
};

export const displayRepairRequestStatus = (status) => (
  repairRequestStatusForSelection(status)
);

export const isOpenRepairRequestStatus = (status) => (
  OPEN_REPAIR_REQUEST_STATUSES.has(normalizeRepairRequestStatus(status))
);

export class RepairRequest {
  constructor({
    id = 'rep_req_' + uuidv4(),
    customerId = '',
    customerName = '',
    requesterId = '',
    requesterName = '',
    date = new Date(),
    formattedDate = 'NA',
    status = REPAIR_REQUEST_STATUS.UNRESOLVED,
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
      photoUrls: (data.photoUrls || []),
      locationId: data.locationId,
      bodyOfWaterId: data.bodyOfWaterId,
      equipmentId: data.equipmentId,
      userId: data.userId // Added this line
    });
  }
}
