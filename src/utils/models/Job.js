import { IdInfo } from './IdInfo'; // Assuming IdInfo is also a model
import { ServiceStopTaskTemplate } from './ServiceStopTaskTemplate'; // Assuming ServiceStopTaskTemplate is also a model

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
    const data = doc.data();

    // Handle potential null or undefined values and convert dates
    const dateCreated = data.dateCreated ? data.dateCreated.toDate() : null;
    const dateEstimateAccepted = data.dateEstimateAccepted ? data.dateEstimateAccepted.toDate() : null;
    const invoiceDate = data.invoiceDate ? data.invoiceDate.toDate() : null;

    // Map nested objects if they exist
    const estimateRef = data.estimateRef ? IdInfo.fromFirestore(data.estimateRef) : null;
    const invoiceRef = data.invoiceRef ? IdInfo.fromFirestore(data.invoiceRef) : null;

    // Map array of nested objects if they exist
    const tasks = data.tasks ? data.tasks.map(taskData => ServiceStopTaskTemplate.fromFirestore(taskData)) : [];


    return new Job(
      doc.id,
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