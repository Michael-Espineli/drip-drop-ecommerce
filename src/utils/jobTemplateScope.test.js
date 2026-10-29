import { combineJobTemplateScope, copyJobTemplateScope } from "./jobTemplateScope";

const empty = () => ({ tasks: [], plannedServiceStops: [], laborLineItems: [], shoppingItems: [] });
const job = { id: "job-1", customerId: "customer-1", customerName: "Current Customer", serviceLocationId: "site-1", equipmentId: "pump-1" };
const template = { id: "template-1", name: "Pump repair" };
const source = () => ({
  tasks: [{ id: "task-template", name: "Repair pump", type: "Repair", status: "Finished", actualTime: 90, serviceStopId: { id: "old-stop" }, shoppingListItemIds: ["item-template"], customerId: "old-customer", equipmentId: "old-pump" }],
  plannedServiceStops: [{ id: "stop-template", name: "Visit", taskTemplateIds: ["task-template"], serviceLocationId: "old-site" }],
  laborLineItems: [{ id: "line-template", name: "Pump service", taskTemplateIds: ["task-template"], plannedServiceStopTemplateIds: ["stop-template"], quantity: 2, unitPriceCents: 10000, totalPriceCents: 20000, internalCostCents: 5000, catalogItemId: "catalog-1" }],
  shoppingItems: [{ id: "item-template", name: "Seal", quantity: "2", linkedTaskId: "task-template", status: "Purchased", purchasedItemId: "old-purchase", invoiced: true, plannedUnitPriceCents: 500 }],
});

test("copies scope with new IDs and remaps visits, services, task materials, and current job context", () => {
  let sequence = 0;
  const copied = copyJobTemplateScope({ template, scope: source(), job, companyId: "company-1", planId: "plan-1", newId: (prefix) => `${prefix}_${++sequence}` });
  const [task] = copied.tasks, [stop] = copied.plannedServiceStops, [line] = copied.laborLineItems, [material] = copied.shoppingItems;
  expect(task.id).not.toBe("task-template");
  expect(task).toEqual(expect.objectContaining({ status: "Draft", actualTime: 0, equipmentId: "pump-1", serviceLocationId: "site-1", customerId: "customer-1", serviceStopId: { id: "", internalId: "" }, shoppingListItemIds: [material.id] }));
  expect(stop.taskIds).toEqual([task.id]);
  expect(line).toEqual(expect.objectContaining({ taskIds: [task.id], plannedServiceStopIds: [stop.id], totalPriceCents: 20000, internalCostCents: 5000, catalogItemId: "catalog-1" }));
  expect(material).toEqual(expect.objectContaining({ linkedTaskId: task.id, status: "Need to Purchase", invoiced: false, planWorkspaceOnly: true, jobId: "job-1" }));
  expect(material.purchasedItemId).toBeUndefined();
  expect(source().tasks[0].status).toBe("Finished");
});

test("copying the same template twice produces independent IDs", () => {
  const args = { template, scope: source(), job, companyId: "company-1", planId: "plan-1" };
  expect(copyJobTemplateScope(args).tasks[0].id).not.toBe(copyJobTemplateScope(args).tasks[0].id);
});

test("a template's fallback price becomes an additive billable service", () => {
  const copied = copyJobTemplateScope({ template: { ...template, defaultRateCents: 15000, defaultLaborCostCents: 4000 }, scope: { ...empty(), tasks: [{ id: "task-template", name: "Repair" }] }, job, companyId: "company-1", planId: "plan-1" });
  expect(copied.laborLineItems[0]).toEqual(expect.objectContaining({ totalPriceCents: 15000, internalCostCents: 4000, taskIds: [copied.tasks[0].id] }));
});

test("add preserves existing scope, appends in order, and keeps legacy task prices alongside service lines", () => {
  const existing = { ...empty(), tasks: [{ id: "old-task", billingLaborPriceCents: 1200, sortOrder: 8 }] };
  const incoming = { ...empty(), tasks: [{ id: "new-task" }], laborLineItems: [{ id: "new-line", totalPriceCents: 2000 }] };
  const combined = combineJobTemplateScope(existing, incoming, "add");
  expect(combined.tasks.map((task) => task.id)).toEqual(["old-task", "new-task"]);
  expect(combined.tasks[1].sortOrder).toBe(9);
  expect(combined.laborLineItems.reduce((sum, line) => sum + line.totalPriceCents, 0)).toBe(3200);
});

test("overwrite replaces drafts and retains actual work, purchased products, and their linked scope", () => {
  const existing = {
    tasks: [{ id: "draft" }, { id: "done", status: "Finished" }, { id: "purchased-task" }],
    plannedServiceStops: [{ id: "draft-stop", taskIds: ["draft"] }, { id: "protected-stop", taskIds: ["done"] }],
    laborLineItems: [{ id: "draft-line", taskIds: ["draft"] }, { id: "protected-line", taskIds: ["done"] }],
    shoppingItems: [{ id: "draft-item", status: "Need to Purchase" }, { id: "bought", status: "Purchased", linkedTaskId: "purchased-task" }],
  };
  const incoming = { ...empty(), tasks: [{ id: "new-task" }] };
  const combined = combineJobTemplateScope(existing, incoming, "overwrite");
  expect(combined.tasks.map((item) => item.id)).toEqual(["done", "purchased-task", "new-task"]);
  expect(combined.plannedServiceStops.map((item) => item.id)).toEqual(["protected-stop"]);
  expect(combined.laborLineItems.map((item) => item.id)).toEqual(["protected-line"]);
  expect(combined.shoppingItems.map((item) => item.id)).toEqual(["bought"]);
  expect(existing.tasks).toHaveLength(3);
});


test("explicit zero services do not restore an older template headline price", () => {
  const copied = copyJobTemplateScope({ template: { ...template, defaultRateCents: 10000 }, scope: { ...empty(), laborLineItems: [{ id: "free", totalPriceCents: 0, taxable: false }] }, job, companyId: "company-1", planId: "plan-1" });
  expect(copied.laborLineItems).toHaveLength(1);
  expect(copied.laborLineItems[0].totalPriceCents).toBe(0);
});

test("generated task billing links are remapped so later task edits stay billable", () => {
  const scope = { ...empty(), tasks: [{ id: "task", billingLaborPriceCents: 5000 }], laborLineItems: [{ id: "derived", totalPriceCents: 5000, taskIds: ["task"], generatedFromTaskId: "task", taxable: true }] };
  const copied = copyJobTemplateScope({ template, scope, job, companyId: "company-1", planId: "plan-1" });
  expect(copied.laborLineItems[0].generatedFromTaskId).toBe(copied.tasks[0].id);
  expect(copied.laborLineItems[0].taxable).toBe(true);
});


test("template copies keep payroll choices and custom zero amounts while clearing assignments", () => {
  const scope = source();
  Object.assign(scope.tasks[0], { payTypeId: "filter", payTypeName: "Filter clean", payrollMode: "custom", manualPayOverrideCents: 0, manualPayOverrideNotes: "Included contract", payrollStackBehavior: "exclusive", payQuantity: 2, workerId: "old-tech" });
  Object.assign(scope.plannedServiceStops[0], { serviceStopTypeId: "visit-pay", payrollMode: "included", billingLaborPriceCents: 7000 });
  const copy = copyJobTemplateScope({ template, scope, job, companyId: "company", planId: "plan" });
  expect(copy.tasks[0]).toEqual(expect.objectContaining({ payTypeId: "filter", payrollMode: "custom", manualPayOverrideCents: 0, payrollStackBehavior: "exclusive", payQuantity: 2, workerId: "" }));
  expect(copy.plannedServiceStops[0]).toEqual(expect.objectContaining({ payTypeId: "visit-pay", payrollMode: "included", billingLaborPriceCents: 7000 }));
});

test("template copies remap a shared product to all its tasks and retain canonical catalog identities", () => {
  const scope = source();
  scope.tasks.push({ id: "configure-template", name: "Configure equipment", type: "Basic" });
  Object.assign(scope.tasks[0], { genericItemId: "sell-pump", dataBaseItemId: "db-pump" });
  Object.assign(scope.shoppingItems[0], { genericItemId: "sell-pump", dbItemId: "db-pump", linkedTaskIds: [scope.tasks[0].id, "configure-template"] });
  const copy = copyJobTemplateScope({ template, scope, job, companyId: "company", planId: "plan" });
  expect(copy.shoppingItems[0].linkedTaskIds).toEqual(copy.tasks.map((task) => task.id));
  expect(copy.tasks[1].shoppingListItemIds).toEqual([copy.shoppingItems[0].id]);
  expect(copy.tasks[0]).toEqual(expect.objectContaining({ genericItemId: "sell-pump", dataBaseItemId: "db-pump" }));
});
