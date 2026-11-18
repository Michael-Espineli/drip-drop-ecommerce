import { getDocsFromServer, runTransaction } from "firebase/firestore";
import { deleteCatalogProduct, saveVendorProductConnection } from "./productVendorConnections";

jest.mock("firebase/firestore", () => ({
  getDocsFromServer: jest.fn(),
  query: (collection, filters) => ({ collection, filters }),
  or: (...filters) => filters,
  where: (field, operator, value) => ({ field, operator, value }),
  runTransaction: jest.fn(), collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"),
}));
const productPath = (id) => `companies/company/settings/genericItems/genericItems/${id}`;
const vendorCollection = "companies/company/settings/dataBase/dataBase";
const vendorPath = `${vendorCollection}/vendor`;
let records, staged;
beforeEach(() => {
  records = new Map([
    [vendorPath, { id: "vendor", name: "Supplier seal", productId: "old", genericItemId: "old", rate: 1250 }],
    [productPath("old"), { id: "old", name: "Old seal", preferredVendorItemId: "vendor", vendorItemIds: ["vendor", "other"], storeItemsIds: ["vendor", "other"], storeItems: ["Supplier seal"], sellPrice: 3000 }],
    [productPath("new"), { id: "new", name: "New seal", sellPrice: 4500, defaultCostCents: 500 }],
  ]);
  staged = [];
  getDocsFromServer.mockImplementation(async ({ collection, filters }) => ({
    docs: [...records].filter(([path, record]) => path.startsWith(`${collection}/`) &&
      filters.some(({ field, value }) => record[field] === value))
      .map(([path]) => ({ id: path.split("/").pop() })),
  }));
  runTransaction.mockImplementation(async (_, callback) => {
    const result = await callback({
      get: async (path) => {
        if (staged.length) throw new Error("Transaction attempted a read after writing.");
        return { id: path.split("/").pop(), exists: () => records.has(path), data: () => records.get(path) };
      },
      update: (path, data) => staged.push([path, data]), set: (path, data) => staged.push([path, data]),
      delete: (path) => staged.push([path]),
    });
    for (const [path, patch] of staged) {
      if (patch) records.set(path, { ...records.get(path), ...patch });
      else records.delete(path);
    }
    return result;
  });
});
const save = (extra = {}) => saveVendorProductConnection({ db: {}, companyId: "company", vendorItemId: "vendor", productId: "new", knownProducts: [...records.values()].filter((item) => ["old", "new"].includes(item.id)), ...extra });

test("moving a vendor updates both products, repairs both ID arrays and leaves costs/prices intact", async () => {
  await save({ makePreferred: true });
  expect(records.get(vendorPath)).toMatchObject({ productId: "new", genericItemId: "new", productName: "New seal", rate: 1250 });
  expect(records.get(productPath("old"))).toMatchObject({ vendorItemIds: ["other"], storeItemsIds: ["other"], preferredVendorItemId: "other", sellPrice: 3000 });
  expect(records.get(productPath("new"))).toMatchObject({ vendorItemIds: ["vendor"], preferredVendorItemId: "vendor", sellPrice: 4500, defaultCostCents: 500 });
  expect(staged.every(([path]) => path.includes("/settings/"))).toBe(true);
});

test("disconnect clears both supplier aliases without deleting historical data", async () => {
  await save({ productId: "" });
  expect(records.get(vendorPath)).toMatchObject({ productId: "", genericItemId: "", productName: "", rate: 1250 });
  expect(records.get(productPath("old")).vendorItemIds).not.toContain("vendor");
});

test("a concurrent connection change is rejected before writing", async () => {
  await expect(save({ expectedProductId: "different" })).rejects.toThrow("connection changed");
  expect(staged).toEqual([]);
});

test("missing target cannot leave a supplier pointing at a nonexistent product", async () => {
  await expect(save({ productId: "missing" })).rejects.toThrow("no longer exists");
  expect(staged).toEqual([]);
});

test("reconciliation creates its product and repairs the supplier in the same transaction", async () => {
  await save({ productId: "created", newProduct: { id: "created", name: "Created seal", sellPrice: 5000 } });
  expect(records.get(productPath("created"))).toMatchObject({ name: "Created seal", vendorItemIds: ["vendor"] });
  expect(records.get(vendorPath).productId).toBe("created");
});

test("deleting a product clears live vendor connections and preserves supplier and purchase records", async () => {
  const legacyPath = `${vendorCollection}/legacy`;
  const conflictPath = `${vendorCollection}/conflict`;
  const otherPath = `${vendorCollection}/other`;
  const purchasePath = "companies/company/purchasedItems/receipt-line";
  const purchase = { productId: "old", genericItemId: "old", cost: 1100 };
  const otherVendor = { productId: "new", genericItemId: "new", rate: 1800 };
  records.set(legacyPath, { genericItemId: "old", genericItemName: "Old seal", rate: 1000 });
  records.set(conflictPath, { productId: "new", productName: "New seal", genericItemId: "old", genericItemName: "Old seal" });
  records.set(otherPath, otherVendor);
  records.set(purchasePath, purchase);

  await deleteCatalogProduct({ db: {}, companyId: "company", productId: "old" });

  expect(records.has(productPath("old"))).toBe(false);
  expect(records.get(vendorPath)).toMatchObject({ productId: "", genericItemId: "", rate: 1250 });
  expect(records.get(legacyPath)).toMatchObject({ productId: "", genericItemId: "", genericItemName: "", rate: 1000 });
  expect(records.get(conflictPath)).toMatchObject({ productId: "new", productName: "New seal", genericItemId: "", genericItemName: "" });
  expect(records.get(otherPath)).toEqual(otherVendor);
  expect(records.get(purchasePath)).toEqual(purchase);
  expect(records.has(productPath("new"))).toBe(true);
});

test("deletion rechecks vendor connections and includes items linked after the lookup", async () => {
  const lateVendorPath = `${vendorCollection}/late`;
  getDocsFromServer.mockImplementationOnce(async () => {
    records.set(vendorPath, { productId: "new", genericItemId: "new", rate: 1250 });
    records.set(lateVendorPath, { productId: "old", genericItemId: "old", rate: 1400 });
    records.set(productPath("old"), { ...records.get(productPath("old")), vendorItemIds: ["late"] });
    return { docs: [{ id: "vendor" }] };
  });

  await deleteCatalogProduct({ db: {}, companyId: "company", productId: "old" });

  expect(records.get(vendorPath)).toEqual({ productId: "new", genericItemId: "new", rate: 1250 });
  expect(records.get(lateVendorPath)).toMatchObject({ productId: "", genericItemId: "", rate: 1400 });
  expect(records.has(productPath("old"))).toBe(false);
});
