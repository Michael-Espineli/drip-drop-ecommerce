import { completeJobLaborLines, jobLaborTotals } from "./jobScopePricing";

const scope = () => ({
  laborLineItems: [{ id: "service", totalPriceCents: 10000, internalCostCents: 2000, taxable: true, taskIds: ["included"] }],
  tasks: [{ id: "included", billingLaborPriceCents: 7500, contractedRate: 2000 }, { id: "extra", name: "Extra work", billingLaborPriceCents: 5000, contractedRate: 1000, taxable: true }],
  plannedServiceStops: [],
});

test("a $100 service plus an uncovered $50 task totals $150, with each cost counted once", () => {
  expect(jobLaborTotals(scope())).toEqual({ priceCents: 15000, costCents: 3000 });
  expect(completeJobLaborLines(scope()).map((line) => [line.totalPriceCents, line.taxable])).toEqual([[10000, true], [5000, true]]);
});

test("a service covering a visit includes its tasks; independent visits remain billable", () => {
  const input = scope();
  input.laborLineItems[0].plannedServiceStopIds = ["visit"];
  input.plannedServiceStops = [{ id: "visit", taskIds: ["included", "extra"], plannedLaborCostCents: 2500 }, { id: "other", plannedLaborCostCents: 1500 }];
  expect(jobLaborTotals(input)).toEqual({ priceCents: 11500, costCents: 3500 });
});

test("explicit zero customer prices and false tax flags survive internal cost fallback", () => {
  const lines = completeJobLaborLines({ tasks: [{ id: "free", billingLaborPriceCents: 0, contractedRate: 5000, taxable: false }] });
  expect(lines[0]).toEqual(expect.objectContaining({ totalPriceCents: 0, internalCostCents: 5000, taxable: false }));
  expect(jobLaborTotals({ laborLineItems: [{ id: "free-service", totalPriceCents: 0, taxable: false }] }).priceCents).toBe(0);
});

test("generated lines follow task price edits, reassignment, deletion, and repeated snapshots", () => {
  const input = scope();
  input.laborLineItems = completeJobLaborLines(input);
  expect(jobLaborTotals(input).priceCents).toBe(15000);
  input.tasks[1].billingLaborPriceCents = 6000;
  expect(jobLaborTotals(input).priceCents).toBe(16000);
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


test("empty legacy task price fields retain their fallback instead of becoming a free task", () => {
  expect(jobLaborTotals({ tasks: [{ id: "legacy", billingLaborPriceCents: "", contractedRate: 5000 }] }).priceCents).toBe(5000);
});


test("assigned technician costs refresh service margins without changing prices or counting visit tasks twice", () => {
  const input = scope();
  expect(jobLaborTotals({ ...input, taskCost: () => 8000 })).toEqual({ priceCents: 15000, costCents: 16000 });
  input.plannedServiceStops = [{ id: "visit", taskIds: ["included", "extra"], billingLaborPriceCents: 0 }];
  input.laborLineItems[0].plannedServiceStopIds = ["visit"];
  expect(jobLaborTotals({ ...input, taskCost: () => 8000, plannedStopCost: () => 9000 })).toEqual({ priceCents: 10000, costCents: 9000 });
  input.laborLineItems[0].internalCostMode = "fixed";
  expect(jobLaborTotals({ ...input, taskCost: () => 8000, plannedStopCost: () => 9000 }).costCents).toBe(2000);
});
