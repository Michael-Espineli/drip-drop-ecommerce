import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import { completeJobLaborLines, taskCustomerPriceCents } from "./jobScopePricing";
import { SalesCatalogItemType, SalesCatalogBillingBehavior, SalesCatalogSourceType } from "./models/Sales";

// Execute the actual screen builders so a lost tax flag in any creation path is
// caught without mounting screens that would connect to Firebase.
const screenBuilder = (file, name, context) => {
  const source = fs.readFileSync(path.join(__dirname, "../views/company", file), "utf8");
  let initializer;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id.name === name) initializer = node.init;
    Object.values(node).forEach((child) => Array.isArray(child) ? child.forEach(visit) : visit(child));
  };
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }));
  if (!initializer) throw Error(`Missing ${name}`);
  return Function(...Object.keys(context), `return (${source.slice(initializer.start, initializer.end)});`)(...Object.values(context));
};
const context = {
  completeJobLaborLines, SalesCatalogItemType, SalesCatalogBillingBehavior, SalesCatalogSourceType,
  normalizeJobLaborLineItems: (lines) => lines,
  getTaskBillingLaborPriceCents: taskCustomerPriceCents,
  getTaskCostCents: (task) => task.contractedRate || 0,
  getPlannedStopCostCents: (stop) => stop.plannedLaborCostCents || 0,
  getLaborLineTaskIds: (line) => line.taskIds || [],
  getLaborLinePlannedStopIds: (line) => line.plannedServiceStopIds || [],
  laborLineCatalogItemId: (line) => line.salesCatalogItemId || line.catalogItemId || "",
  laborLineScopeLabel: () => "",
  cents: (n) => Math.round(Number(n) || 0), quantityNumber: Number, moneyFromCents: String,
  jobId: "job", job: { internalId: "J1" },
  getShoppingPlannedTotalPriceCents: (item) => item.plannedTotalPriceCents || 0,
  plannedMaterialTotalPriceCents: (item) => item.plannedTotalPriceCents || 0,
};
const cases = [
  ["jobs/CreateNewJob.jsx", "buildStarterPlanLineItems"],
  ["jobs/BasicWorkOrderCreate.jsx", "buildLineItems"],
  ["equipment/EquipmentList.jsx", "buildScheduleLineItems"],
  ["jobs/JobDetailView.jsx", "buildContractSnapshotFromScope"],
];

test.each(cases)("%s preserves taxable services and adds uncovered work in estimates", (file, name) => {
  const tasks = [{ id: "included", contractedRate: 0, billingLaborPriceCents: 2500 }, { id: "extra", name: "Extra", contractedRate: 0, billingLaborPriceCents: 5000, taxable: false }];
  const laborLines = [{ id: "service", name: "Taxable service", quantity: 1, unitPriceCents: 10000, totalPriceCents: 10000, internalCostCents: 0, taskIds: ["included"], taxable: true, stripeProductId: "prod", stripePriceId: "price" }];
  const build = screenBuilder(file, name, context);
  const result = name === "buildContractSnapshotFromScope"
    ? build({ tasks, laborLines, plannedStops: [], materials: [] })
    : build({ planId: "plan", normalizedTasks: tasks, normalizedPlannedStops: [], normalizedShoppingItems: [], normalizedLaborLineItems: completeJobLaborLines({ tasks, laborLineItems: laborLines }) });
  expect(result.map((line) => [line.totalAmountCents, line.taxable])).toEqual([[10000, true], [5000, false]]);
  expect(result[0]).toEqual(expect.objectContaining({ stripeProductId: "prod", stripePriceId: "price" }));
  expect(result.reduce((sum, line) => sum + line.totalAmountCents, 0)).toBe(15000);
});
