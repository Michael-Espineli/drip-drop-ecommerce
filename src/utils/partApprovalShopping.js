import { itemPhotoFieldsFromSource } from "./itemPhotos";

const unique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const numberValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizePartApprovalStatus = (value) =>
  String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

export const isPartApprovalPending = (approval = {}) =>
  normalizePartApprovalStatus(approval.status || approval.approvalStatus || "pending") === "pending";

export const isShoppingItemDelivered = (item = {}) => {
  const status = normalizePartApprovalStatus(item.status || item.deliveryStatus || item.fulfillmentStatus);
  return ["delivered", "installed", "resolved", "invoiced"].includes(status);
};

export const partApprovalUnitPriceCents = (approval = {}) => {
  const explicitUnit = numberValue(approval.plannedUnitPriceCents || approval.unitPriceCents || approval.price, 0);
  if (explicitUnit > 0) return explicitUnit;

  const quantity = Number.parseFloat(approval.quantity || "1") || 1;
  const total = numberValue(approval.plannedTotalPriceCents || approval.totalPriceCents, 0);
  return quantity > 0 ? Math.round(total / quantity) : total;
};

export const partApprovalTotalPriceCents = (approval = {}) => {
  const explicitTotal = numberValue(approval.plannedTotalPriceCents || approval.totalPriceCents, 0);
  if (explicitTotal > 0) return explicitTotal;

  const quantity = Number.parseFloat(approval.quantity || "1") || 1;
  return Math.round(partApprovalUnitPriceCents(approval) * quantity);
};

export const buildPartApprovalShoppingItemPayload = ({
  approval = {},
  shoppingListItemId,
  now,
  generated = false,
  status = "Ready to Purchase",
} = {}) => {
  const quantity = String(approval.quantity || "1");
  const numericQuantity = Number.parseFloat(quantity) || 1;
  const plannedUnitCostCents = numberValue(approval.plannedUnitCostCents || approval.unitCostCents || approval.cost, 0);
  const plannedUnitPriceCents = partApprovalUnitPriceCents(approval);
  const plannedTotalCostCents =
    numberValue(approval.plannedTotalCostCents, 0) || Math.round(plannedUnitCostCents * numericQuantity);
  const plannedTotalPriceCents = partApprovalTotalPriceCents(approval);
  const approvalId = approval.id || approval.approvalRequestId || approval.partApprovalRequestId || "";
  const jobId = approval.jobId || "";
  const serviceStopId = approval.serviceStopId || approval.scheduledServiceStopId || "";
  const serviceStopInternalId = approval.serviceStopInternalId || approval.scheduledServiceStopInternalId || "";
  const scheduledDate = approval.scheduledDate || approval.serviceDate || null;
  const linkedTaskId = approval.linkedTaskId || "";
  const techId =
    approval.techId ||
    approval.assignedTechId ||
    approval.assignedToUserId ||
    approval.userId ||
    approval.purchaserId ||
    "";
  const techName =
    approval.techName ||
    approval.assignedTechName ||
    approval.assignedToUserName ||
    approval.userName ||
    approval.purchaserName ||
    "";
  const assignedTechIds = unique([
    ...(Array.isArray(approval.assignedTechIds) ? approval.assignedTechIds : []),
    techId,
    approval.assignedTechId,
    approval.assignedToUserId,
  ]);
  const assignedTechNames = unique([
    ...(Array.isArray(approval.assignedTechNames) ? approval.assignedTechNames : []),
    techName,
    approval.assignedTechName,
    approval.assignedToUserName,
  ]);
  const photoFields = itemPhotoFieldsFromSource(approval, approval.itemName || approval.name || "Part photo");

  return {
    id: shoppingListItemId,
    category: jobId ? "Job" : "Customer",
    subCategory: approval.subCategory || (approval.dbItemId ? "Data Base" : "Part"),
    status,
    purchaserId: approval.purchaserId || techId || "",
    purchaserName: approval.purchaserName || techName || "",
    genericItemId: approval.genericItemId || "",
    name: approval.itemName || approval.name || approval.dbItemName || "Pool Part",
    description: approval.description || "",
    quantity,
    jobId,
    jobName: approval.jobName || approval.jobInternalId || "",
    linkedTaskId,
    linkedTaskName: approval.linkedTaskName || "",
    linkedTaskType: approval.linkedTaskType || "",
    customerId: approval.customerId || "",
    customerName: approval.customerName || "",
    customerUserId: approval.customerUserId || "",
    userId: approval.userId || techId || "",
    userName: approval.userName || techName || "",
    serviceStopId,
    serviceStopInternalId,
    scheduledServiceStopId: serviceStopId,
    scheduledServiceStopInternalId: serviceStopInternalId,
    serviceLocationId: approval.serviceLocationId || "",
    serviceLocationName: approval.serviceLocationName || "",
    serviceLocationAddress: approval.serviceLocationAddress || "",
    scheduledDate,
    prepKeys: unique([
      ...(Array.isArray(approval.prepKeys) ? approval.prepKeys : []),
      jobId ? `job:${jobId}` : "",
      approval.customerId ? `customer:${approval.customerId}` : "",
      approval.serviceLocationId ? `serviceLocation:${approval.serviceLocationId}` : "",
      serviceStopId ? `serviceStop:${serviceStopId}` : "",
      linkedTaskId ? `jobTask:${linkedTaskId}` : "",
      techId ? `user:${techId}` : "",
    ]),
    needsAction: !isShoppingItemDelivered({ status }),
    actionDate: scheduledDate || now,
    assignedTechIds,
    assignedTechNames,
    assignedTechId: techId,
    assignedTechName: techName,
    assignedToUserId: techId,
    assignedToUserName: techName,
    dbItemId: approval.dbItemId || "",
    dbItemName: approval.dbItemName || approval.itemName || approval.name || "",
    itemId: approval.dbItemId || "",
    itemType: approval.subCategory || (approval.dbItemId ? "Data Base" : "Part"),
    purchasedItem: approval.purchasedItem || "",
    invoiced: false,
    cost: plannedUnitCostCents,
    price: plannedUnitPriceCents,
    plannedUnitCostCents,
    plannedUnitPriceCents,
    plannedTotalCostCents,
    plannedTotalPriceCents,
    customerApprovalRequired: true,
    customerApprovalStatus: "approved",
    customerApprovalResponse: "approved",
    customerApprovalResponseNote: approval.responseNote || "",
    customerApprovalRespondedAt: approval.respondedAt || now,
    customerApprovalRespondedByUserId: approval.respondedByUserId || "",
    customerApprovalRespondedByUserName: approval.respondedByUserName || "",
    customerApprovalRespondedByEmail: approval.respondedByEmail || "",
    fulfillmentStatus: approval.fulfillmentStatus || "approvedAwaitingPurchase",
    approvalRequestId: approvalId,
    partApprovalRequestId: approvalId,
    sourceType: approval.sourceType || "partApprovalRequest",
    ...photoFields,
    updatedAt: now,
    ...(generated ? { datePurchased: null, createdAt: now } : {}),
  };
};
