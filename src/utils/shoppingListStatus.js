export const SHOPPING_LIST_STATUS = {
  needToPurchase: "Need to Purchase",
  purchased: "Purchased",
  delivered: "Delivered",
  installed: "Installed",
  invoiced: "Invoiced",
};

export const SHOPPING_LIST_STATUS_OPTIONS = Object.values(SHOPPING_LIST_STATUS);
export const SHOPPING_LIST_INVOICED_STATUS = SHOPPING_LIST_STATUS.invoiced;

export const normalizeShoppingListStatus = (value) =>
  String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

export const canonicalShoppingListStatus = (value) => {
  switch (normalizeShoppingListStatus(value)) {
    case "purchased":
      return SHOPPING_LIST_STATUS.purchased;
    case "delivered":
      return SHOPPING_LIST_STATUS.delivered;
    case "installed":
    case "resolved":
      return SHOPPING_LIST_STATUS.installed;
    case "invoiced":
    case "paid":
      return SHOPPING_LIST_STATUS.invoiced;
    case "needtopurchase":
    case "needpurchase":
    case "needscustomerapproval":
    case "customerapproval":
    case "pendingapproval":
    case "readytopurchase":
    case "approved":
    case "customerrejected":
    case "rejected":
    default:
      return SHOPPING_LIST_STATUS.needToPurchase;
  }
};

export const shoppingListStatusMatches = (value, allowedStatuses = []) => {
  const currentStatus = canonicalShoppingListStatus(value);
  return allowedStatuses.some((status) => canonicalShoppingListStatus(status) === currentStatus);
};

export const isShoppingListStatusClosed = (status) => {
  const canonicalStatus = canonicalShoppingListStatus(status);
  return [
    SHOPPING_LIST_STATUS.delivered,
    SHOPPING_LIST_STATUS.installed,
    SHOPPING_LIST_STATUS.invoiced,
  ].includes(canonicalStatus);
};

export const shoppingItemNeedsAction = (status) => !isShoppingListStatusClosed(status);

const approvalReadyStatusValues = new Set(["approved", "approvedawaitingpurchase"]);
const rejectedShoppingStatusValues = new Set(["customerrejected", "rejected", "denied"]);
const waitingApprovalShoppingStatusValues = new Set([
  "needsapproval",
  "needscustomerapproval",
  "customerapproval",
  "pendingapproval",
  "pendingcustomerapproval",
  "awaitingcustomerapproval",
]);
const partApprovalSourceTypes = new Set([
  "partapproval",
  "partapprovalrequest",
  "customerpartapproval",
  "customerpartapprovalrequest",
]);

const shoppingItemApprovalIsReady = (item, status) => {
  const sourceType = normalizeShoppingListStatus(item.sourceType || item.sourceRecordType || item.sourceRecordTypeLabel);
  const approvalRequired = item.customerApprovalRequired || item.partApprovalRequestId ||
    item.approvalRequestId || item.customerApprovalRequestId || partApprovalSourceTypes.has(sourceType) ||
    waitingApprovalShoppingStatusValues.has(status);
  if (!approvalRequired) return true;

  return [
    item.status,
    item.customerApprovalStatus,
    item.customerApprovalResponse,
    item.approvalStatus,
    item.response,
    item.fulfillmentStatus,
  ].some((value) => approvalReadyStatusValues.has(normalizeShoppingListStatus(value)));
};

export const shoppingItemIsReadyToPurchase = (item = {}) => {
  const status = normalizeShoppingListStatus(item.status);
  return !rejectedShoppingStatusValues.has(status) &&
    canonicalShoppingListStatus(status) === SHOPPING_LIST_STATUS.needToPurchase &&
    shoppingItemApprovalIsReady(item, status);
};
