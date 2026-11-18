import { runTransaction } from "firebase/firestore";
import { productCatalogDocRef } from "./productCatalog";

export const PRODUCT_BULK_EDIT_LIMIT = 450;
export const PRODUCT_AVAILABILITY_FIELDS = [
  { id: "active", label: "Active in catalog", aliases: ["active"] },
  { id: "jobs", label: "Jobs", aliases: ["availableForJobs", "availableForJob", "jobProductAvailable"] },
  { id: "approvals", label: "Part Approval Sales", aliases: ["availableForPartApproval", "partApprovalAvailable", "availableForCustomerSale"] },
  { id: "purchasing", label: "Part Purchase", aliases: ["availableForPartPurchase", "partPurchaseAvailable"] },
];

export const canBulkEditProduct = (product) => !product.mergedIntoProductId && !product.archived;

export const productAvailabilityPatch = (changes) => {
  const patch = {};
  for (const key of Object.keys(changes)) {
    if (!PRODUCT_AVAILABILITY_FIELDS.some((field) => field.id === key)) throw new Error("Unsupported availability field.");
  }
  for (const field of PRODUCT_AVAILABILITY_FIELDS) {
    const value = changes[field.id] ?? "keep";
    if (!["keep", "yes", "no"].includes(value)) throw new Error("Choose an availability option for each field.");
    if (value !== "keep") for (const alias of field.aliases) patch[alias] = value === "yes";
  }
  if (!Object.keys(patch).length) throw new Error("Choose at least one availability change.");
  return patch;
};

export const updateProductAvailability = async ({ db, companyId, productIds, changes }) => {
  const ids = [...new Set(productIds)];
  if (!companyId || !ids.length || ids.some((id) => typeof id !== "string" || !id || id.includes("/"))) throw new Error("Select products in the current company first.");
  if (ids.length > PRODUCT_BULK_EDIT_LIMIT) throw new Error(`Select up to ${PRODUCT_BULK_EDIT_LIMIT} products at a time.`);
  const patch = productAvailabilityPatch(changes);
  await runTransaction(db, async (transaction) => {
    const refs = ids.map((id) => productCatalogDocRef(db, companyId, id));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot) => !snapshot.exists() || !canBulkEditProduct(snapshot.data()))) {
      throw new Error("A selected product was removed or consolidated. Refresh the catalog and select the products again.");
    }
    const now = new Date();
    refs.forEach((ref) => transaction.update(ref, { ...patch, updatedAt: now, dateUpdated: now }));
  });
  return patch;
};
