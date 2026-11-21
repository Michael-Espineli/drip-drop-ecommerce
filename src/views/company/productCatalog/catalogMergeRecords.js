import { getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import {
  getProductDisplayName, getVendorItemDisplayName, isMergedCatalogRecord, normalizeProductKey,
  productCatalogCollectionRef, vendorItemsCollectionRef,
} from "../../../utils/productCatalog";

export const catalogDuplicatesPath = "/company/product-catalog/duplicates";

export const catalogRecordName = (kind, record) =>
  kind === "product" ? getProductDisplayName(record) : getVendorItemDisplayName(record);

export const loadMergeRecords = async (companyId, kind) => {
  const ref = kind === "product" ? productCatalogCollectionRef(db, companyId) : vendorItemsCollectionRef(db, companyId);
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }))
    .filter(record => !isMergedCatalogRecord(record) && !record.archived)
    .sort((a, b) => catalogRecordName(kind, a).localeCompare(catalogRecordName(kind, b)) || a.id.localeCompare(b.id));
};

export const catalogRecordMatches = (kind, row, search) => {
  const searchable = normalizeProductKey([
    catalogRecordName(kind, row), row.commonName, row.specificName, row.description, row.sku,
    row.storeName, row.vendorName, row.UOM, row.uom, row.size, row.id,
  ].filter(Boolean).join(" "));
  return normalizeProductKey(search).split(" ").every(term => searchable.includes(term));
};

export const duplicateGroups = (records, kind) => {
  const byKey = new Map();
  records.forEach(row => {
    const name = normalizeProductKey(kind === "product" ? row.name || row.commonName || row.specificName : row.name);
    const sku = String(row.sku || "").trim().toLowerCase();
    const unit = normalizeProductKey(row.UOM || row.uom);
    const size = normalizeProductKey(row.size);
    const supplier = row.vendorId || row.venderId || normalizeProductKey(row.storeName || row.vendorName);
    if (kind === "vendorItem" && !supplier) return;
    [[sku, "Same SKU"], [name, "Same name"]].forEach(([value, reason]) => {
      if (!value) return;
      const key = JSON.stringify([kind === "vendorItem" ? supplier : "", unit, size, reason, value]);
      if (!byKey.has(key)) byKey.set(key, { key, reason, members: [] });
      byKey.get(key).members.push(row);
    });
  });
  const groups = new Set();
  return [...byKey.values()].filter(group => {
    if (group.members.length < 2) return false;
    const signature = JSON.stringify(group.members.map(row => row.id).sort());
    if (groups.has(signature)) return false;
    groups.add(signature);
    return true;
  });
};
