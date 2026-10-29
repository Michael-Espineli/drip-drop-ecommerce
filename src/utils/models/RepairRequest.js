
import { v4 as uuidv4 } from 'uuid';
import { DripDropStoredImage } from './DripDropStoredImage';
import { format } from 'date-fns';
import { DEFAULT_ISSUE_PRIORITY, getIssuePriorityLabel, normalizeIssuePriority } from './JobPlan';

export const getRepairRequestIssuePriority = (request, fallback = DEFAULT_ISSUE_PRIORITY) => (
  normalizeIssuePriority(request?.issuePriorityLevel ?? request?.priorityLevel, fallback)
);

export const REPAIR_REQUEST_STATUS = {
  UNRESOLVED: 'Unresolved',
  CONVERTED_TO_JOB: 'Converted To Job',
  SUGGESTED_WORK: 'Suggested Work',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
  LEGACY_IN_PROGRESS: 'In Progress',
  LEGACY_PENDING: 'pending',
  LEGACY_IN_PROGRESS_SLUG: 'in-progress',
};

export const REPAIR_REQUEST_STATUS_OPTIONS = [
  REPAIR_REQUEST_STATUS.UNRESOLVED,
  REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
  REPAIR_REQUEST_STATUS.SUGGESTED_WORK,
  REPAIR_REQUEST_STATUS.RESOLVED,
  REPAIR_REQUEST_STATUS.CANCELLED,
];

export const DEFAULT_REPAIR_REQUEST_FILTER_STATUSES = [
  REPAIR_REQUEST_STATUS.UNRESOLVED,
];

export const normalizeRepairRequestStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (!value || value === 'pending') return 'unresolved';
  if (value === 'in progress' || value === 'in-progress') return 'converted to job';
  return value;
};

export const isLegacyPendingRepairRequestStatus = (status) => (
  String(status || '').trim().toLowerCase() === REPAIR_REQUEST_STATUS.LEGACY_PENDING
);

export const repairRequestStatusForSelection = (status) => {
  return REPAIR_REQUEST_STATUS_OPTIONS.find((option) => (
    normalizeRepairRequestStatus(option) === normalizeRepairRequestStatus(status)
  )) || status;
};

export const displayRepairRequestStatus = (status) => (
  repairRequestStatusForSelection(status)
);

export const isOpenRepairRequestStatus = (status) => (
  normalizeRepairRequestStatus(status) === 'unresolved'
);

// Ownership follows the submitter, independently of customer/route assignments.
export const isRepairRequestSubmittedByUser = (request = {}, userIds = []) => {
  const ids = new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean));
  const requesterId = String(request.requesterId || '').trim();
  const submitters = requesterId ? [requesterId] : [
    request.userId, request.uid, request.homeownerId,
    request.createdBy, request.createdById, request.createdByUid, request.createdByUserId,
    request.requestedBy, request.requestedByUid, request.requestedByUserId,
    request.submittedBy, request.submittedByUserId, request.authorId,
  ];
  return submitters.some((id) => ids.has(String(id || '').trim()));
};

export const compareRepairRequestsByDate = (left, right) => {
  const millis = (request) => {
    const value = request.date || request.dateCreated || request.createdAt;
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  };
  const difference = millis(right) - millis(left);
  if (difference) return difference;
  const key = (request) => `${request.sourcePath || 'company'}:${request.id}`;
  return key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
};

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
    issuePriorityLevel,
    priorityLevel,
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
    this.issuePriorityLevel = getRepairRequestIssuePriority({ issuePriorityLevel, priorityLevel });
    this.issuePriorityLabel = getIssuePriorityLabel(this.issuePriorityLevel);
    this.priorityLevel = this.issuePriorityLevel;
    this.priorityLabel = this.issuePriorityLabel;
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
      issuePriorityLevel: this.issuePriorityLevel,
      issuePriorityLabel: this.issuePriorityLabel,
      priorityLevel: this.issuePriorityLevel,
      priorityLabel: this.issuePriorityLabel,
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
    const dateValue = data.date || data.dateCreated || data.createdAt;
    const parsedDate = dateValue?.toDate ? dateValue.toDate() : dateValue ? new Date(dateValue) : null;
    const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
    const formattedDate = date ? format(date, "MMMM d, yyyy") : "N/A";

    return new RepairRequest({
      id: snapshot.id || data.id,
      customerId: data.customerId,
      customerName: data.customerName,
      requesterId: data.requesterId,
      requesterName: data.requesterName,
      date: date,
      formattedDate: formattedDate,
      status: data.status,
      description: data.description,
      issuePriorityLevel: getRepairRequestIssuePriority(data),
      jobIds: data.jobIds,
      photoUrls: (data.photoUrls || []),
      locationId: data.locationId,
      bodyOfWaterId: data.bodyOfWaterId,
      equipmentId: data.equipmentId,
      userId: data.userId // Added this line
    });
  }
}
