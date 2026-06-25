import { IdInfo } from './IdInfo'; // Assuming IdInfo is also a model
import { ServiceStopTaskTemplate } from './ServiceStopTaskTemplate'; // Assuming ServiceStopTaskTemplate is also a model

const docData = (snapshot = {}) => (
  typeof snapshot?.data === 'function' ? snapshot.data() : snapshot
);

const docId = (snapshot = {}) => (
  snapshot?.id || docData(snapshot)?.id || ''
);

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

export class Job {
  constructor(
    id,
    internalId,
    type,
    dateCreated,
    description,
    operationStatus,
    billingStatus,
    customerId,
    customerName,
    serviceLocationId,
    serviceStopIds,
    laborContractIds,
    adminId,
    adminName,
    purchasedItemsIds,
    tasks,
    rate,
    laborCost,
    otherCompany,
    receivedLaborContractId,
    receiverId,
    senderId,
    dateEstimateAccepted,
    estimateAcceptedById,
    estimateRef,
    estimateAcceptType,
    estimateAcceptedNotes,
    invoiceDate,
    invoiceRef,
    invoiceType,
    invoiceNotes
  ) {
    this.id = id;
    this.internalId = internalId;
    this.type = type;
    this.dateCreated = dateCreated;
    this.description = description;
    this.operationStatus = operationStatus;
    this.billingStatus = billingStatus;
    this.customerId = customerId;
    this.customerName = customerName;
    this.serviceLocationId = serviceLocationId;
    this.serviceStopIds = serviceStopIds;
    this.laborContractIds = laborContractIds;
    this.adminId = adminId;
    this.adminName = adminName;
    this.purchasedItemsIds = purchasedItemsIds;
    this.tasks = tasks;
    this.rate = rate;
    this.laborCost = laborCost;
    this.otherCompany = otherCompany;
    this.receivedLaborContractId = receivedLaborContractId;
    this.receiverId = receiverId;
    this.senderId = senderId;
    this.dateEstimateAccepted = dateEstimateAccepted;
    this.estimateAcceptedById = estimateAcceptedById;
    this.estimateRef = estimateRef;
    this.estimateAcceptType = estimateAcceptType;
    this.estimateAcceptedNotes = estimateAcceptedNotes;
    this.invoiceDate = invoiceDate;
    this.invoiceRef = invoiceRef;
    this.invoiceType = invoiceType;
    this.invoiceNotes = invoiceNotes;
  }

  get cost() {
    return this.laborCost;
  }

  get profit() {
    return this.rate - this.cost;
  }

  static fromFirestore(doc) {
    const data = docData(doc);

    // Handle potential null or undefined values and convert dates
    const dateCreated = toDate(data.dateCreated);
    const dateEstimateAccepted = toDate(data.dateEstimateAccepted);
    const invoiceDate = toDate(data.invoiceDate);

    // Map nested objects if they exist
    const estimateRef = data.estimateRef ? IdInfo.fromFirestore(data.estimateRef) : null;
    const invoiceRef = data.invoiceRef ? IdInfo.fromFirestore(data.invoiceRef) : null;

    // Map array of nested objects if they exist
    const tasks = Array.isArray(data.tasks)
      ? data.tasks.map(taskData => ServiceStopTaskTemplate.fromFirestore(taskData))
      : [];


    return new Job(
      docId(doc),
      data.internalId ?? '',
      data.type ?? '',
      dateCreated,
      data.description ?? '',
      data.operationStatus ?? '',
      data.billingStatus ?? '',
      data.customerId ?? '',
      data.customerName ?? '',
      data.serviceLocationId ?? '',
      data.serviceStopIds ?? [],
      data.laborContractIds ?? [],
      data.adminId ?? '',
      data.adminName ?? '',
      data.purchasedItemsIds ?? [],
      tasks,
      data.rate ?? 0,
      data.laborCost ?? 0,
      data.otherCompany ?? false,
      data.receivedLaborContractId ?? null,
      data.receiverId ?? null,
      data.senderId ?? null,
      dateEstimateAccepted,
      data.estimateAcceptedById ?? null,
      estimateRef,
      data.estimateAcceptType ?? null,
      data.estimateAcceptedNotes ?? null,
      invoiceDate,
      invoiceRef,
      data.invoiceType ?? null,
      data.invoiceNotes ?? null
    );
  }
}
