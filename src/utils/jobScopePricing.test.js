import { completeJobLaborLines, isTaskChargeLine, jobLaborTotals } from "./jobScopePricing";

const scope = () => ({
  laborLineItems: [{ id: "service", totalPriceCents: 10000, internalCostCents: 2000, taxable: true, taskIds: ["included"] }],
  tasks: [{ id: "included", billingLaborPriceCents: 7500, contractedRate: 2000 }, { id: "extra", name: "Extra work", billingLaborPriceCents: 5000, contractedRate: 1000, taxable: true }],
  plannedServiceStops: [],
});

test("a $100 service keeps its charge when a linked or uncovered task has a saved price", () => {
  expect(jobLaborTotals(scope())).toEqual({ priceCents: 10000, costCents: 0 });
  expect(completeJobLaborLines(scope()).map((line) => [line.totalPriceCents, line.taxable])).toEqual([[10000, true]]);
});

test("a service covering a visit includes its tasks; independent visits remain billable", () => {
  const input = scope();
  input.laborLineItems[0].plannedServiceStopIds = ["visit"];
  input.plannedServiceStops = [{ id: "visit", taskIds: ["included", "extra"], plannedLaborCostCents: 2500 }, { id: "other", plannedLaborCostCents: 1500 }];
  expect(jobLaborTotals(input)).toEqual({ priceCents: 11500, costCents: 4000 });
});

test("task-only scope produces no labor lines and explicit zero service prices are retained", () => {
  const lines = completeJobLaborLines({ tasks: [{ id: "free", billingLaborPriceCents: 0, contractedRate: 5000, taxable: false }] });
  expect(lines).toEqual([]);
  expect(jobLaborTotals({ laborLineItems: [{ id: "free-service", totalPriceCents: 0, taxable: false }] }).priceCents).toBe(0);
});

test("legacy generated task lines are removed even after the task price changes", () => {
  const input = scope();
  input.laborLineItems.push({ id: "scope_task_extra", generatedFromTaskId: "extra", totalPriceCents: 5000 });
  expect(isTaskChargeLine(input.laborLineItems[1])).toBe(true);
  expect(jobLaborTotals(input).priceCents).toBe(10000);
  input.tasks[1].billingLaborPriceCents = 6000;
  expect(jobLaborTotals(input).priceCents).toBe(10000);
  input.laborLineItems[0].taskIds.push("extra");
  expect(jobLaborTotals(input).priceCents).toBe(10000);
  input.tasks = [];
  expect(completeJobLaborLines(input)).toHaveLength(1);
});

test("template links use the same coverage as job links", () => {
  expect(jobLaborTotals({ laborLineItems: [{ id: "service", totalPriceCents: 10000, taskTemplateIds: ["task"] }], tasks: [{ id: "task", contractedRate: 5000 }] }).priceCents).toBe(10000);
});


test("computed visit pay changes internal cost without changing the customer charge", () => {
  expect(jobLaborTotals({ plannedServiceStops: [{ id: "visit", plannedLaborCostCents: 0 }], plannedStopCost: () => 5000 })).toEqual({ priceCents: 0, costCents: 5000 });
});


test("legacy task budgets never become an implicit customer charge", () => {
  expect(jobLaborTotals({ tasks: [{ id: "legacy", billingLaborPriceCents: "", contractedRate: 5000 }] }).priceCents).toBe(0);
});


test("assigned technician costs refresh service margins without changing prices or counting visit tasks twice", () => {
  const input = scope();
  expect(jobLaborTotals({ ...input, taskCost: () => 8000 })).toEqual({ priceCents: 10000, costCents: 0 });
  input.plannedServiceStops = [{ id: "visit", taskIds: ["included", "extra"], billingLaborPriceCents: 0 }];
  input.laborLineItems[0].plannedServiceStopIds = ["visit"];
  expect(jobLaborTotals({ ...input, taskCost: () => 8000, plannedStopCost: () => 9000 })).toEqual({ priceCents: 10000, costCents: 9000 });
  input.laborLineItems[0].internalCostMode = "fixed";
  expect(jobLaborTotals({ ...input, taskCost: () => 8000, plannedStopCost: () => 9000 }).costCents).toBe(2000);
});

test("a visit's explicit customer price, including zero, takes priority over its labor budget", () => {
  const stops = [
    { id: "included", plannedLaborCostCents: 3500, billingLaborPriceCents: 0 },
    { id: "quoted", plannedLaborCostCents: 4500, customerLaborPriceCents: 7500 },
    { id: "legacy", plannedLaborCostCents: 2000 },
  ];
  expect(jobLaborTotals({ plannedServiceStops: stops })).toEqual({ priceCents: 9500, costCents: 10000 });
});
