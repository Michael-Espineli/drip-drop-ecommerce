import { buildJobProductCatalog, getJobMaterialVendorItemId } from "./productCatalog";

const vendor = { id: "vendor", name: "Old supplier name", rate: 3500, sellPrice: 9000, genericItemId: "product" };
const product = { id: "product", name: "Current product", sellPrice: 12000, preferredVendorItemId: "vendor", taxable: true, availableForJobs: true };

test("job products use Products selling prices and supplier costs, with distinct IDs", () => {
  const result = buildJobProductCatalog([product], [vendor]);
  expect(result.products).toHaveLength(1);
  expect(result.products[0]).toEqual(expect.objectContaining({ id: "product", genericItemId: "product", dbItemId: "vendor", name: "Current product", rate: 3500, sellPrice: 12000, taxable: true }));
  expect(result.vendorItems[0]).toEqual(expect.objectContaining({ id: "vendor", rate: 3500, sellPrice: 12000 }));
});

test("new products are selectable without a supplier and zero selling prices stay zero", () => {
  const result = buildJobProductCatalog([{ ...product, sellPrice: 0 }], []);
  expect(result.products[0]).toEqual(expect.objectContaining({ dbItemId: "", genericItemId: "product", sellPrice: 0, rate: 0 }));
});

test.each([{ active: false }, { archived: true }, { availableForJobs: false }])("unavailable products do not reappear through their supplier: %p", (flags) => {
  expect(buildJobProductCatalog([{ ...product, ...flags }], [vendor]).products).toEqual([]);
});

test("explicit product links resolve both legacy link directions without matching names", () => {
  const result = buildJobProductCatalog([{ ...product, vendorItemIds: ["vendor"], preferredVendorItemId: "" }], [{ ...vendor, genericItemId: "" }, { id: "legacy", name: "Current product", rate: 25 }]);
  expect(result.products.map((item) => item.id)).toEqual(["product", "legacy"]);
  expect(result.products[0].dbItemId).toBe("vendor");
});


test("legacy product IDs cannot become supplier IDs when editing material catalog prices", () => {
  expect(getJobMaterialVendorItemId({ genericItemId: "product", itemId: "product" })).toBe("");
  expect(getJobMaterialVendorItemId({ genericItemId: "product", dbItemId: "vendor", itemId: "product" })).toBe("vendor");
  expect(getJobMaterialVendorItemId({ itemId: "legacy-vendor" })).toBe("legacy-vendor");
});
