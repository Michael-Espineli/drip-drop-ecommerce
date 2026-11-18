import { buildJobProductCatalog, getJobMaterialVendorItemId, getProductCostInfo, findLinkedProductForVendorItem, getVendorItemCostCents } from "./productCatalog";

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

test("manual cost flows into job products without using the selling price", () => {
  const result = buildJobProductCatalog([{ id: "manual", name: "Seal", defaultCostCents: 1750, sellPrice: 4500 }], []);
  expect(result.products[0]).toMatchObject({ rate: 1750, cost: 1750, sellPrice: 4500, dbItemId: "" });
});

test("preferred supplier cost is used rather than the first or cheapest supplier", () => {
  const vendors = [{ id: "a", productId: "p", rate: 100 }, { id: "z", productId: "p", rate: 700 }];
  expect(getProductCostInfo({ id: "p", preferredVendorItemId: "z", defaultCostCents: 999 }, vendors)).toMatchObject({ costCents: 700, vendorItem: { id: "z" }, source: "vendor", minVendorCostCents: 100, maxVendorCostCents: 700 });
});

test("a free supplier cost remains zero and manual cost takes over after disconnecting", () => {
  expect(getVendorItemCostCents({ rate: 0, cost: 999 })).toBe(0);
  expect(getProductCostInfo({ id: "p", defaultCostCents: 500 }, [{ id: "v", productId: "p", rate: 0 }])).toMatchObject({ costCents: 0, minVendorCostCents: 0, maxVendorCostCents: 0 });
  expect(getProductCostInfo({ id: "p", defaultCostCents: 500 }, [{ id: "v", productId: "other", rate: 0 }])).toMatchObject({ costCents: 500, minVendorCostCents: null, maxVendorCostCents: null });
});

test("explicit links override obsolete reverse arrays and identical names do not create links", () => {
  const a = { id: "a", name: "Seal", vendorItemIds: ["v"] }, b = { id: "b", name: "Other seal" };
  expect(findLinkedProductForVendorItem({ id: "v", productId: "b", name: "Seal" }, [a, b])).toBe(b);
  expect(findLinkedProductForVendorItem({ id: "unlinked", name: "Seal" }, [a, b])).toBeNull();
  expect(findLinkedProductForVendorItem({ id: "v" }, [a, { ...b, vendorItemIds: ["v"] }])).toBeNull();
});
