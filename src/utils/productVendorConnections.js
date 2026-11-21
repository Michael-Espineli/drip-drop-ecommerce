import { getDocsFromServer, or, query, runTransaction, where } from "firebase/firestore";
import {
  getProductDisplayName, getVendorItemDisplayName, productVendorItemIds, isMergedCatalogRecord,
  productCatalogDocRef, vendorItemDocRef, vendorItemsCollectionRef,
} from "./productCatalog";

// Re-read both sides before writing. Moving a supplier never changes historical purchases.
export const saveVendorProductConnection = async ({
  db, companyId, vendorItemId, productId = "", knownProducts = [], makePreferred = false, newProduct = null,
  expectedProductId,
}) => runTransaction(db, async (transaction) => {
  const vendorRef = vendorItemDocRef(db, companyId, vendorItemId);
  const vendorSnap = await transaction.get(vendorRef);
  if (!vendorSnap.exists()) throw new Error("This vendor item no longer exists. Refresh and try again.");
  const vendor = { ...vendorSnap.data(), id: vendorSnap.id };
  if (isMergedCatalogRecord(vendor)) throw new Error("This vendor item has been merged. Use the kept vendor item.");
  const actualProductId = vendor.productId || vendor.genericItemId || "";
  if (expectedProductId !== undefined && actualProductId !== expectedProductId) {
    throw new Error("This vendor item's product connection changed. Refresh before saving again.");
  }
  const oldProductIds = knownProducts.filter((p) => productVendorItemIds(p).includes(vendorItemId)).map((p) => p.id);
  const ids = [...new Set([productId, vendor.productId, vendor.genericItemId, ...oldProductIds].filter(Boolean))];
  const snapshots = await Promise.all(ids.map((id) => transaction.get(productCatalogDocRef(db, companyId, id))));
  const records = snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }));
  if (newProduct && !records.some((record) => record.id === newProduct.id)) records.push(newProduct);
  const target = records.find((record) => record.id === productId);
  if (productId && !target) throw new Error("This product no longer exists. Refresh and choose another product.");
  if (target && isMergedCatalogRecord(target)) throw new Error("This product has been merged. Use the kept product.");
  const now = new Date();
  for (const product of records) {
    if (isMergedCatalogRecord(product)) continue;
    const previousIds = productVendorItemIds(product);
    const nextIds = previousIds.filter((id) => id !== vendorItemId);
    const connecting = product.id === productId;
    if (connecting) nextIds.push(vendorItemId);
    const names = Array.isArray(product.storeItems) ? product.storeItems : [];
    const patch = {
      vendorItemIds: nextIds,
      storeItemsIds: nextIds,
      storeItems: connecting ? [...new Set([...names, getVendorItemDisplayName(vendor)])]
        : names.filter((name) => name !== getVendorItemDisplayName(vendor)),
      preferredVendorItemId: connecting && makePreferred ? vendorItemId
        : nextIds.includes(product.preferredVendorItemId) ? product.preferredVendorItemId : nextIds[0] || "",
      updatedAt: now, dateUpdated: now,
    };
    if (newProduct?.id === product.id) transaction.set(productCatalogDocRef(db, companyId, product.id), { ...newProduct, ...patch });
    else transaction.update(productCatalogDocRef(db, companyId, product.id), patch);
  }
  transaction.update(vendorRef, {
    productId, genericItemId: productId,
    productName: target ? getProductDisplayName(target) : "",
    genericItemName: target ? getProductDisplayName(target) : "",
    updatedAt: now, dateUpdated: now,
  });
});

export const deleteCatalogProduct = async ({ db, companyId, productId }) => {
  const productRef = productCatalogDocRef(db, companyId, productId);
  const linkedVendors = await getDocsFromServer(query(
    vendorItemsCollectionRef(db, companyId),
    or(where("productId", "==", productId), where("genericItemId", "==", productId))
  ));

  await runTransaction(db, async (transaction) => {
    const product = await transaction.get(productRef);
    if (isMergedCatalogRecord(product.data()) || product.data()?.mergedSourceIds?.length) {
      throw new Error("Products in a merge are kept for catalog history.");
    }
    const vendorIds = new Set([
      ...linkedVendors.docs.map((vendor) => vendor.id),
      ...productVendorItemIds(product.data()).filter((id) => typeof id === "string" && !id.includes("/")),
    ]);
    const vendorRefs = [...vendorIds].map((id) => vendorItemDocRef(db, companyId, id));
    const vendors = await Promise.all(vendorRefs.map((ref) => transaction.get(ref)));
    const now = new Date();
    vendors.forEach((vendor, index) => {
      if (!vendor.exists()) return;
      const current = vendor.data();
      if (isMergedCatalogRecord(current)) return;
      if (current.productId !== productId && current.genericItemId !== productId) return;

      const nextProductId = current.productId === productId ? "" : current.productId || "";
      const nextGenericItemId = current.genericItemId === productId ? "" : current.genericItemId || "";
      transaction.update(vendorRefs[index], {
        productId: nextProductId,
        genericItemId: nextGenericItemId,
        ...(!nextProductId && { productName: "" }),
        ...(!nextGenericItemId && { genericItemName: "" }),
        updatedAt: now,
        dateUpdated: now,
      });
    });
    if (product.exists()) transaction.delete(productRef);
  });
};
