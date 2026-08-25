import { itemPhotoFieldsFromSource } from "./itemPhotos";
import { SHOPPING_LIST_STATUS, shoppingItemNeedsAction } from "./shoppingListStatus";

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
  status = SHOPPING_LIST_STATUS.needToPurchase,
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
  const productId = approval.productId || approval.genericItemId || "";
  const productName = approval.productName || (productId ? approval.itemName || approval.name || "" : "");
  const vendorItemId = productId ? "" : approval.dbItemId || "";
  const itemType = productId ? "Product" : approval.subCategory || (vendorItemId ? "Data Base" : "Part");
  const photoFields = itemPhotoFieldsFromSource(approval, approval.itemName || approval.name || productName || "Part photo");

  return {
    id: shoppingListItemId,
    category: jobId ? "Job" : "Customer",
    subCategory: itemType,
    status,
    purchaserId: approval.purchaserId || techId || "",
    purchaserName: approval.purchaserName || techName || "",
    genericItemId: productId,
    productId,
    productName,
    name: approval.itemName || approval.name || productName || approval.dbItemName || "Pool Part",
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
    needsAction: shoppingItemNeedsAction(status),
    actionDate: scheduledDate || now,
    assignedTechIds,
    assignedTechNames,
    assignedTechId: techId,
    assignedTechName: techName,
    assignedToUserId: techId,
    assignedToUserName: techName,
    dbItemId: vendorItemId,
    dbItemName: vendorItemId ? approval.dbItemName || "" : "",
    itemId: productId || vendorItemId,
    itemType,
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
    autoInvoiceOnInstall: approval.autoInvoiceOnInstall === true,
    paymentCollectionPreference: approval.paymentCollectionPreference || approval.paymentPreference || "sendInvoice",
    paymentPreference: approval.paymentPreference || approval.paymentCollectionPreference || "sendInvoice",
    ...photoFields,
    updatedAt: now,
    ...(generated ? { datePurchased: null, createdAt: now } : {}),
  };
};
