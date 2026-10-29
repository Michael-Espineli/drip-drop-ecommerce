import { buildJobProductCatalog } from "./productCatalog";
import { buildTaskProductOptions, findTaskProduct, linkTaskToPlanProduct, unlinkTaskFromPlanProduct } from "./jobPlanProducts";
import { stageJobTaskProduct } from "./jobTaskProductWrites";

jest.mock("firebase/firestore", () => ({ doc: (_, ...parts) => parts.join("/"), collection: jest.fn() }));
const vendor = { id: "db-pump", name: "Supplier pump", category: "Equipment", rate: 80000, equipmentType: "Pump", equipmentMake: "Pentair", equipmentModel: "VS" };
const product = { id: "sell-pump", name: "Variable speed pump", sellPrice: 150000, preferredVendorItemId: vendor.id, taxable: true };
const catalog = buildJobProductCatalog([product], [vendor]);
const material = { id: "plan-pump", genericItemId: product.id, dbItemId: vendor.id, name: "Quoted pump", quantity: "2", plannedUnitPriceCents: 120000, plannedUnitCostCents: 70000, status: "Purchased", purchasedItem: "receipt-pump", invoiced: true };
const optionsFor = (materials = [material]) => buildTaskProductOptions({ materials, products: catalog.products, databaseItems: catalog.vendorItems, equipmentOnly: true });
const task = { id: "install", name: "Install pump", type: "Install" };
const writer = (overrides = {}) => {
  const batch = { set: jest.fn(), update: jest.fn() };
  const result = stageJobTaskProduct({ batch, db: {}, companyId: "company", job: { id: "job", customerId: "customer", serviceLocationId: "site" },
    task, materials: [material], products: catalog.products, databaseItems: catalog.vendorItems,
    product: optionsFor().planned[0], newMaterialId: "new-product", createTask: true, ...overrides });
  return { batch, ...result };
};

test("plan choices preserve quoted prices and automatically carry product, supplier, and equipment identities", () => {
  const options = optionsFor();
  expect(options.planned[0]).toEqual(expect.objectContaining({ genericItemId: "sell-pump", id: "db-pump", dbItemId: "db-pump", planMaterialId: "plan-pump", sellPrice: 120000, rate: 70000, equipmentMake: "Pentair", equipmentModel: "VS" }));
  expect(options.catalog[0]).toEqual(expect.objectContaining({ genericItemId: "sell-pump", id: "db-pump", sellPrice: 150000 }));
  expect(findTaskProduct({ genericItemId: "sell-pump" }, options).planMaterialId).toBe("plan-pump");
  expect(findTaskProduct({}, options, { allowSoleProduct: true }).planMaterialId).toBe("plan-pump");
});

test("ambiguous plan rows and similar names are never silently guessed", () => {
  const options = optionsFor([material, { ...material, id: "another-pump" }]);
  expect(findTaskProduct({ genericItemId: "sell-pump" }, options)).toBeNull();
  expect(findTaskProduct({}, options, { allowSoleProduct: true })).toBeNull();
  expect(findTaskProduct({ name: material.name }, options)).toBeNull();
  expect(findTaskProduct({ shoppingListItemId: "another-pump" }, options).planMaterialId).toBe("another-pump");
  expect(() => writer({ materials: [material, { ...material, id: "another-pump" }], product: options.catalog[0] })).toThrow("Choose which product row");
});

test("reusing a plan product stages both links without repricing, requantifying, or rewriting fulfillment", () => {
  const { batch, task: saved, materials } = writer();
  expect(saved).toEqual(expect.objectContaining({ genericItemId: "sell-pump", dataBaseItemId: "db-pump", shoppingListItemId: "plan-pump", shoppingListItemIds: ["plan-pump"] }));
  expect(batch.set.mock.calls).toHaveLength(1); // the task, no new billable product
  expect(batch.set.mock.calls[0][0]).toBe("companies/company/workOrders/job/tasks/install");
  expect(batch.update.mock.calls[0][1]).not.toHaveProperty("plannedUnitPriceCents");
  expect(batch.update.mock.calls[0][1]).not.toHaveProperty("quantity");
  expect(materials[0]).toEqual(expect.objectContaining({ quantity: "2", plannedUnitPriceCents: 120000, status: "Purchased", purchasedItem: "receipt-pump", invoiced: true, linkedTaskIds: ["install"] }));
});

test("a product chosen from a task is added to Products with selling price and supplier cost", () => {
  const { batch, task: saved, materials } = writer({ materials: [], product: optionsFor([]).catalog[0], quantity: 3 });
  expect(batch.set).toHaveBeenCalledTimes(2);
  expect(materials[0]).toEqual(expect.objectContaining({ id: "new-product", genericItemId: "sell-pump", dbItemId: "db-pump", itemId: "db-pump", quantity: "3", plannedTotalPriceCents: 450000, plannedTotalCostCents: 240000, linkedTaskId: "install" }));
  expect(saved.shoppingListItemId).toBe("new-product");
  expect(materials[0].itemId).not.toBe(product.id);
});

test("a second task reuses the newly staged product and removing either link preserves the product", () => {
  const first = writer({ materials: [], product: optionsFor([]).catalog[0] });
  const secondTask = { id: "configure", name: "Configure pump", type: "Install" };
  const second = writer({ task: secondTask, materials: first.materials, tasks: [first.task], product: optionsFor([]).catalog[0] });
  expect(second.materials).toHaveLength(1);
  expect(second.materials[0].linkedTaskIds).toEqual(["install", "configure"]);
  expect(second.batch.set).toHaveBeenCalledTimes(1);
  expect(unlinkTaskFromPlanProduct(second.materials[0], "install", [first.task, second.task])).toEqual(expect.objectContaining({ linkedTaskId: "configure", linkedTaskIds: ["configure"] }));
  expect(linkTaskToPlanProduct(second.materials[0], secondTask).linkedTaskId).toBe("install");
});

test("switching a task to another plan row detaches the old row and leaves both product snapshots intact", () => {
  const old = { ...material, linkedTaskId: "install", linkedTaskIds: ["install", "other-task"] };
  const next = { ...material, id: "other-row", name: "Second pump" };
  const { materials, task: saved } = writer({ task: { ...task, shoppingListItemId: old.id, shoppingListItemIds: [old.id] }, materials: [old, next], tasks: [task, { id: "other-task", name: "Other task" }], product: optionsFor([next]).planned[0] });
  expect(materials).toHaveLength(2);
  expect(materials[0].linkedTaskIds).toEqual(["other-task"]);
  expect(saved.shoppingListItemIds).toEqual(["other-row"]);
  expect(materials[0].purchasedItem).toBe("receipt-pump");
});

test("products without a database link remain visible but cannot be saved as install items", () => {
  const options = buildTaskProductOptions({ products: buildJobProductCatalog([product], []).products, equipmentOnly: true });
  expect(options.catalog).toHaveLength(1);
  expect(options.catalog[0].dbItemId).toBe("");
  expect(() => writer({ materials: [], product: options.catalog[0], products: buildJobProductCatalog([product], []).products, databaseItems: [] })).toThrow("Connect this product to a database item");
});
