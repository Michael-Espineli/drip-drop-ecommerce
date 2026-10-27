import { collection, doc, getDocs } from "firebase/firestore";

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
  const productForVendor = (vendor) => products.find((product) =>
    product.id === (vendor.genericItemId || vendor.productId) ||
    [...(product.vendorItemIds || []), ...(product.storeItemsIds || []), product.preferredVendorItemId].includes(vendor.id)
  );
  const linkedVendors = vendorItems.map((vendor) => {
    const product = productForVendor(vendor);
    return product ? { ...vendor, genericItemId: product.id, sellPrice: getProductSellPriceCents(product), billingRate: getProductSellPriceCents(product), taxable: Boolean(product.taxable), billable: product.billable ?? true } : vendor;
  });
  const options = products.filter((product) => product.active !== false && !product.archived && isProductAvailableForJobs(product)).map((product) => {
    const vendor = linkedVendors.find((item) => item.id === product.preferredVendorItemId) || linkedVendors.find((item) => item.genericItemId === product.id);
    return {
      ...product, name: getProductDisplayName(product), genericItemId: product.id,
      dbItemId: vendor?.id || "", dataBaseItemId: vendor?.id || "",
      rate: getVendorItemCostCents(vendor), cost: getVendorItemCostCents(vendor),
      sellPrice: getProductSellPriceCents(product), billingRate: getProductSellPriceCents(product),
      billable: product.billable ?? true, catalogSource: "product",
    };
  });
  const legacy = linkedVendors.filter((vendor) => !productForVendor(vendor) && vendor.active !== false && !vendor.archived).map((vendor) => ({ ...vendor, dbItemId: vendor.id, catalogSource: "legacyVendor" }));
  return { products: [...options, ...legacy], vendorItems: linkedVendors.filter((vendor) => {
    const product = productForVendor(vendor);
    return vendor.active !== false && !vendor.archived && (!product || (product.active !== false && !product.archived && isProductAvailableForJobs(product)));
  }) };
};

export const loadJobProductCatalog = async (db, companyId) => {
  const [products, vendors] = await Promise.all([
    getDocs(productCatalogCollectionRef(db, companyId)), getDocs(vendorItemsCollectionRef(db, companyId)),
  ]);
  const records = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
  return buildJobProductCatalog(records(products), records(vendors));
};
