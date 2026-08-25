import { collection, doc } from "firebase/firestore";

export const PRODUCT_CATALOG_SETTINGS_DOC = "genericItems";
export const PRODUCT_CATALOG_COLLECTION = "genericItems";
export const VENDOR_ITEM_SETTINGS_DOC = "dataBase";
export const VENDOR_ITEM_COLLECTION = "dataBase";

export const productCatalogCollectionRef = (db, companyId) =>
  collection(db, "companies", companyId, "settings", PRODUCT_CATALOG_SETTINGS_DOC, PRODUCT_CATALOG_COLLECTION);

export const productCatalogDocRef = (db, companyId, productId) =>
  doc(db, "companies", companyId, "settings", PRODUCT_CATALOG_SETTINGS_DOC, PRODUCT_CATALOG_COLLECTION, productId);

export const vendorItemsCollectionRef = (db, companyId) =>
  collection(db, "companies", companyId, "settings", VENDOR_ITEM_SETTINGS_DOC, VENDOR_ITEM_COLLECTION);

export const vendorItemDocRef = (db, companyId, vendorItemId) =>
  doc(db, "companies", companyId, "settings", VENDOR_ITEM_SETTINGS_DOC, VENDOR_ITEM_COLLECTION, vendorItemId);

export const normalizeProductKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const getProductDisplayName = (product = {}) =>
  product.name || product.commonName || product.specificName || product.description || "Product";

export const getVendorItemDisplayName = (vendorItem = {}) =>
  vendorItem.name || vendorItem.description || vendorItem.sku || "Vendor item";

export const getProductSellPriceCents = (product = {}) =>
  Number(product.sellPrice ?? product.billingRate ?? product.defaultSellPrice ?? 0);

export const getVendorItemCostCents = (vendorItem = {}) => Number(vendorItem.rate || vendorItem.cost || 0);

export const productOptionSearchText = (product = {}) =>
  [
    product.id,
    product.name,
    product.commonName,
    product.specificName,
    product.description,
    product.category,
    product.subCategory,
    product.UOM,
    product.sku,
  ]
    .filter(Boolean)
    .join(" ");

export const buildProductFromVendorItem = ({
  productId,
  vendorItem = {},
  overrides = {},
  source = "vendorItem",
  now = new Date(),
}) => {
  const vendorItemId = vendorItem.id || "";
  const name = String(overrides.name || vendorItem.name || vendorItem.description || vendorItem.sku || "Product").trim();
  const description = String(overrides.description || vendorItem.description || vendorItem.name || "").trim();
  const sellPrice = Number(
    overrides.sellPrice ??
    overrides.billingRate ??
    vendorItem.sellPrice ??
    vendorItem.billingRate ??
    0
  );

  return {
    id: productId,
    commonName: name,
    specificName: description || name,
    name,
    category: overrides.category || vendorItem.category || "Misc",
    subCategory: overrides.subCategory || vendorItem.subCategory || "Misc",
    description,
    dateUpdated: now,
    createdAt: now,
    updatedAt: now,
    sku: overrides.sku || vendorItem.sku || "",
    rate: 0,
    sellPrice,
    billingRate: sellPrice,
    billable: Boolean(overrides.billable ?? vendorItem.billable ?? sellPrice),
    UOM: overrides.UOM || overrides.uom || vendorItem.UOM || vendorItem.uom || "",
    storeItems: vendorItemId ? [getVendorItemDisplayName(vendorItem)] : [],
    storeItemsIds: vendorItemId ? [vendorItemId] : [],
    vendorItemIds: vendorItemId ? [vendorItemId] : [],
    preferredVendorItemId: vendorItemId,
    source,
    active: true,
  };
};

export const buildVendorItemProductPatch = (product = {}, now = new Date()) => {
  const productId = product.id || "";
  const productName = getProductDisplayName(product);

  return {
    productId,
    productName,
    genericItemId: productId,
    genericItemName: productName,
    dateUpdated: now,
  };
};

export const findSuggestedProductForVendorItem = (vendorItem = {}, products = []) => {
  const existingProductId = vendorItem.productId || vendorItem.genericItemId || "";
  if (existingProductId) {
    const linkedProduct = products.find((product) => product.id === existingProductId);
    if (linkedProduct) return linkedProduct;
  }

  const vendorNameKey = normalizeProductKey(getVendorItemDisplayName(vendorItem));
  if (!vendorNameKey) return null;

  return (
    products.find((product) => normalizeProductKey(getProductDisplayName(product)) === vendorNameKey) ||
    products.find((product) => normalizeProductKey(product.specificName) === vendorNameKey) ||
    null
  );
};
