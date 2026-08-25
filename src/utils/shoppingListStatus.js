export const SHOPPING_LIST_STATUS = {
  needToPurchase: "Need to Purchase",
  purchased: "Purchased",
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
    SHOPPING_LIST_STATUS.installed,
    SHOPPING_LIST_STATUS.invoiced,
  ].includes(canonicalStatus);
};

export const shoppingItemNeedsAction = (status) => !isShoppingListStatusClosed(status);
