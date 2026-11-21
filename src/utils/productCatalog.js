import { collection, doc, getDocs } from "firebase/firestore";
import { databaseEquipmentMappingFromItem, databaseEquipmentMappingPatch } from "./databaseEquipmentItems";

export const PRODUCT_CATALOG_SETTINGS_DOC = "genericItems";
export const PRODUCT_CATALOG_COLLECTION = "genericItems";
export const VENDOR_ITEM_SETTINGS_DOC = "dataBase";
export const VENDOR_ITEM_COLLECTION = "dataBase";

export const isMergedCatalogRecord = (row) => Boolean(row?.mergedIntoProductId || row?.mergedIntoVendorItemId);
const isSelectableCatalogRecord = (row) => row.active !== false && !row.archived && !isMergedCatalogRecord(row);

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

export const getVendorItemCostCents = (vendorItem = {}) => Number(vendorItem.rate ?? vendorItem.cost ?? 0);

export const productVendorItemIds = (product = {}) => [...new Set([
  ...(Array.isArray(product.vendorItemIds) ? product.vendorItemIds : []),
  ...(Array.isArray(product.storeItemsIds) ? product.storeItemsIds : []),
  product.preferredVendorItemId,
].filter(Boolean))];

// Explicit supplier links take precedence over stale product-side arrays.
// Names are suggestions only: two suppliers can sell different items with the same name.
export const findLinkedProductForVendorItem = (vendorItem = {}, products = []) => {
  if (isMergedCatalogRecord(vendorItem)) return null;
  const explicitId = vendorItem.productId || vendorItem.genericItemId;
  if (explicitId) return products.find((product) => product.id === explicitId && !isMergedCatalogRecord(product)) || null;
  const matches = products.filter((product) => !isMergedCatalogRecord(product) && productVendorItemIds(product).includes(vendorItem.id));
  return matches.length === 1 ? matches[0] : null;
};

export const linkedVendorItemsForProduct = (product = {}, vendorItems = [], products = [product]) =>
  vendorItems.filter((vendor) => findLinkedProductForVendorItem(vendor, products)?.id === product.id);

export const getProductDefaultCostCents = (product = {}) =>
  Number(product.defaultCostCents ?? product.cost ?? product.rate ?? 0);

export const getProductCostInfo = (product = {}, vendorItems = [], products = [product]) => {
  const linked = linkedVendorItemsForProduct(product, vendorItems, products);
  const available = linked.filter(isSelectableCatalogRecord);
  const vendor = available.find((item) => item.id === product.preferredVendorItemId)
    || available.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  const vendorCosts = available.map(getVendorItemCostCents).filter(Number.isFinite);
  return {
    costCents: vendor ? getVendorItemCostCents(vendor) : getProductDefaultCostCents(product),
    vendorItem: vendor || null,
    linkedVendorItems: linked,
    minVendorCostCents: vendorCosts.length ? Math.min(...vendorCosts) : null,
    maxVendorCostCents: vendorCosts.length ? Math.max(...vendorCosts) : null,
    source: vendor ? "vendor" : "manual",
  };
};

export const buildProductCostIndex = (products = [], vendorItems = []) => {
  const byId = new Map(products.map((product) => [product.id, product]));
  const reverse = new Map();
  for (const product of products) for (const id of isMergedCatalogRecord(product) ? [] : productVendorItemIds(product)) {
    if (!reverse.has(id)) reverse.set(id, new Set());
    reverse.get(id).add(product.id);
  }
  const vendors = new Map(products.map((product) => [product.id, []]));
  for (const vendor of vendorItems) {
    if (isMergedCatalogRecord(vendor)) continue;
    const explicit = vendor.productId || vendor.genericItemId;
    const owners = reverse.get(vendor.id);
    const owner = explicit || (owners?.size === 1 ? [...owners][0] : "");
    if (byId.has(owner) && !isMergedCatalogRecord(byId.get(owner))) vendors.get(owner).push(vendor);
  }
  return new Map(products.map((product) => [product.id, getProductCostInfo(product, vendors.get(product.id))]));
};

// Some older iOS product rows put the product ID in itemId. It must never
// become a supplier document ID when editing a quote or updating catalog cost.
export const getJobMaterialVendorItemId = (item = {}) =>
  [item?.dbItemId, item?.dataBaseItemId, item?.itemId].find((id) =>
    id && id !== item?.genericItemId && id !== item?.productId
  ) || "";

export const isProductAvailableForPartPurchase = (product = {}) =>
  product.availableForPartPurchase ??
  product.partPurchaseAvailable ??
  product.availableForPurchase ??
  product.active !== false;

export const isProductAvailableForPartApproval = (product = {}) =>
  product.availableForPartApproval ??
  product.partApprovalAvailable ??
  product.availableForCustomerSale ??
  product.customerSaleAvailable ??
  product.directSaleAvailable ??
  product.active !== false;

export const isProductAvailableForJobs = (product = {}) =>
  product.availableForJobs ??
  product.availableForJob ??
  product.jobProductAvailable ??
  product.availableForWorkOrders ??
  product.active !== false;

export const productPartPurchaseAvailabilityFields = (product = {}) => ({
  active: product.active ?? true,
  availableForPartPurchase: isProductAvailableForPartPurchase(product),
  partPurchaseAvailable: isProductAvailableForPartPurchase(product),
});

export const productCatalogAvailabilityFields = (product = {}) => ({
  ...productPartPurchaseAvailabilityFields(product),
  availableForPartApproval: isProductAvailableForPartApproval(product),
  partApprovalAvailable: isProductAvailableForPartApproval(product),
  availableForCustomerSale: isProductAvailableForPartApproval(product),
  availableForJobs: isProductAvailableForJobs(product),
  availableForJob: isProductAvailableForJobs(product),
  jobProductAvailable: isProductAvailableForJobs(product),
});

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
    isProductAvailableForPartApproval(product) ? "part approval customer sale direct sale" : "job only",
    isProductAvailableForJobs(product) ? "job work order service" : "sales only",
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
    rate: Number(overrides.defaultCostCents ?? overrides.cost ?? overrides.rate ?? 0),
    defaultCostCents: Number(overrides.defaultCostCents ?? overrides.cost ?? overrides.rate ?? 0),
    sellPrice,
    billingRate: sellPrice,
    billable: Boolean(overrides.billable ?? vendorItem.billable ?? sellPrice),
    UOM: overrides.UOM || overrides.uom || vendorItem.UOM || vendorItem.uom || "",
    storeItems: vendorItemId ? [getVendorItemDisplayName(vendorItem)] : [],
    storeItemsIds: vendorItemId ? [vendorItemId] : [],
    vendorItemIds: vendorItemId ? [vendorItemId] : [],
    preferredVendorItemId: vendorItemId,
    source,
    ...productCatalogAvailabilityFields({
      active: overrides.active,
      availableForPartPurchase: overrides.availableForPartPurchase ?? true,
      partPurchaseAvailable: overrides.partPurchaseAvailable ?? true,
      availableForPartApproval: overrides.availableForPartApproval ?? true,
      partApprovalAvailable: overrides.partApprovalAvailable ?? true,
      availableForCustomerSale: overrides.availableForCustomerSale ?? true,
      availableForJobs: overrides.availableForJobs ?? true,
      availableForJob: overrides.availableForJob ?? true,
      jobProductAvailable: overrides.jobProductAvailable ?? true,
    }),
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
    active: true,
    availableForPartPurchase: true,
    partPurchaseAvailable: true,
  };
};

export const findSuggestedProductForVendorItem = (vendorItem = {}, products = []) => {
  const linked = findLinkedProductForVendorItem(vendorItem, products);
  if (linked) return linked;
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

export const buildJobProductCatalog = (products = [], vendorItems = []) => {
  const costs = buildProductCostIndex(products, vendorItems);
  const vendorProducts = new Map(products.flatMap((product) => costs.get(product.id).linkedVendorItems.map((vendor) => [vendor.id, product])));
  const productForVendor = (vendor) => vendorProducts.get(vendor.id);
  const linkedVendors = vendorItems.map((vendor) => {
    const product = productForVendor(vendor);
    return product ? { ...vendor, genericItemId: product.id, sellPrice: getProductSellPriceCents(product), billingRate: getProductSellPriceCents(product), taxable: Boolean(product.taxable), billable: product.billable ?? true } : vendor;
  });
  const availableForJobs = (product) => isSelectableCatalogRecord(product) && isProductAvailableForJobs(product);
  const options = products.filter(availableForJobs).map((product) => {
    const { vendorItem: vendor, costCents } = costs.get(product.id);
    return {
      ...vendor, ...product, name: getProductDisplayName(product), genericItemId: product.id,
      category: vendor?.category || product.category || "",
      ...databaseEquipmentMappingPatch(databaseEquipmentMappingFromItem(vendor || product)),
      dbItemId: vendor?.id || "", dataBaseItemId: vendor?.id || "",
      rate: costCents, cost: costCents,
      sellPrice: getProductSellPriceCents(product), billingRate: getProductSellPriceCents(product),
      billable: product.billable ?? true, catalogSource: "product",
    };
  });
  const legacy = linkedVendors.filter((vendor) => isSelectableCatalogRecord(vendor) &&
    !productForVendor(vendor) && !vendor.productId && !vendor.genericItemId)
    .map((vendor) => ({ ...vendor, dbItemId: vendor.id, catalogSource: "legacyVendor" }));
  return { products: [...options, ...legacy], vendorItems: linkedVendors.filter((vendor) => {
    const product = productForVendor(vendor);
    return isSelectableCatalogRecord(vendor) && (product ? availableForJobs(product) : !vendor.productId && !vendor.genericItemId);
  }) };
};

export const loadJobProductCatalog = async (db, companyId) => {
  const [products, vendors] = await Promise.all([
    getDocs(productCatalogCollectionRef(db, companyId)), getDocs(vendorItemsCollectionRef(db, companyId)),
  ]);
  const records = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
  return buildJobProductCatalog(records(products), records(vendors));
};

export const loadProductsWithCosts = async (db, companyId) => {
  const [productSnap, vendorSnap] = await Promise.all([
    getDocs(productCatalogCollectionRef(db, companyId)), getDocs(vendorItemsCollectionRef(db, companyId)),
  ]);
  const products = productSnap.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
  const vendors = vendorSnap.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
  const costs = buildProductCostIndex(products, vendors);
  return products.filter(product => !isMergedCatalogRecord(product)).map((product) => ({ ...product, rate: costs.get(product.id).costCents, cost: costs.get(product.id).costCents }));
};
