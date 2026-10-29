import { estimateServicePayroll, serializeServiceTasks, taskDefaultsFromPayItem, updateServiceTaskPayrollField } from "./servicePayrollPreview";

const date = new Date("2026-10-28T12:00:00Z");
const workers = [{ id: "company-a", userId: "a", userName: "Alex", status: "Active" }, { id: "company-b", userId: "b", userName: "Blair", status: "Active" }];
const clean = { id: "clean", name: "Filter clean", category: "maintenance", defaultRateType: "flatPerTask", defaultStackBehavior: "stackable", description: "Open, clean, and inspect", defaultEstimatedMinutes: 30 };
const rate = (technicianId, amountCents, extra = {}) => ({ id: `rate-${technicianId}`, companyId: "company", technicianId, payTypeId: "clean", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents, status: "Active", ...extra });
const args = (overrides = {}) => ({ companyId: "company", date, companyUsers: workers, payTypes: [clean], rates: [rate("a", 2000), rate("b", 4000)], settings: { taskPaySource: "technicianRate", routePaySource: "completedTasks" }, tasks: [{ id: "task", payTypeId: "clean", estimatedMinutes: 30 }], ...overrides });

test("uses current workers, effective rates, and the lowest/highest complete technician totals", () => {
  const estimate = estimateServicePayroll(args({ companyUsers: [...workers, { userId: "inactive", active: false }, { userId: "base", isRateTemplate: true }], rates: [
    rate("a", 2000), rate("b", 4000), rate("a", 99000, { id: "future", effectiveStartDate: "2027-01-01" }),
    rate("b", 90000, { id: "expired", effectiveEndDate: "2026-01-01" }), rate("inactive", 100000), rate("base", 100000),
  ] }));
  expect(estimate).toEqual(expect.objectContaining({ minAmountCents: 2000, maxAmountCents: 4000, technicianCount: 2, completeCount: 2, needsReview: false }));
  expect(estimate.configuredRates[0]).toEqual(expect.objectContaining({ minAmountCents: 2000, maxAmountCents: 4000, technicianCount: 2 }));
});

test("totals the same service for each worker before finding the range", () => {
  const other = { ...clean, id: "repair", name: "Repair" };
  const estimate = estimateServicePayroll(args({ payTypes: [clean, other], tasks: [{ id: "one", payTypeId: "clean" }, { id: "two", payTypeId: "repair" }],
    rates: [rate("a", 1000), rate("b", 10000), rate("a", 10000, { id: "a-repair", payTypeId: "repair" }), rate("b", 1000, { id: "b-repair", payTypeId: "repair" })],
  }));
  expect(estimate.minAmountCents).toBe(11000);
  expect(estimate.maxAmountCents).toBe(11000);
});

test("stop pay and selected task extras are forecast separately without balancing checklist amounts", () => {
  const visit = { id: "visit", name: "Service stop", category: "repair", defaultRateType: "flatPerStop" };
  const setup = args({ includeServiceStopPay: true, inheritedPayTypeId: "visit",
    settings: { routePaySource: "serviceStopAndCompletedTasks", taskPaySource: "technicianRate" }, payTypes: [visit, clean],
    rates: [rate("a", 1500), rate("b", 2000), rate("a", 5000, { id: "a-stop", payTypeId: "visit", payBasis: "serviceStop", rateType: "flatPerStop" }), rate("b", 6000, { id: "b-stop", payTypeId: "visit", payBasis: "serviceStop", rateType: "flatPerStop" })],
    tasks: Array.from({ length: 10 }, (_, index) => ({ id: `routine-${index}`, payrollMode: "included", laborCost: "0" })),
  });
  const ordinary = estimateServicePayroll(setup);
  expect(ordinary).toEqual(expect.objectContaining({ minAmountCents: 5000, maxAmountCents: 6000, needsReview: false, stopPayRange: [5000, 6000], taskPayRange: [0, 0] }));
  const extra = estimateServicePayroll({ ...setup, tasks: [...setup.tasks, { id: "extra", payTypeId: "clean", payrollMode: "automatic", payrollStackBehavior: "stackable" }] });
  expect(extra).toEqual(expect.objectContaining({ minAmountCents: 6500, maxAmountCents: 8000, stopPayRange: [5000, 6000], taskPayRange: [1500, 2000] }));
  const custom = estimateServicePayroll({ ...setup, tasks: [...setup.tasks, { id: "extra", payrollMode: "custom", manualPayOverrideCents: 1200, payrollStackBehavior: "stackable" }] });
  expect(custom).toEqual(expect.objectContaining({ minAmountCents: 6200, maxAmountCents: 7200, taskPayRange: [1200, 1200] }));
});

test("hourly rate ranges are distinct from the cost of the estimated task minutes", () => {
  const estimate = estimateServicePayroll(args({ payTypes: [{ ...clean, defaultRateType: "hourly" }], rates: [rate("a", 6000, { payBasis: "technicianHourly", rateType: "hourly" }), rate("b", 9000, { payBasis: "technicianHourly", rateType: "hourly" })] }));
  expect(estimate).toEqual(expect.objectContaining({ minAmountCents: 3000, maxAmountCents: 4500, needsReview: false }));
  expect(estimate.configuredRates[0]).toEqual(expect.objectContaining({ minAmountCents: 6000, maxAmountCents: 9000, rateType: "hourly" }));
  const noMinutes = estimateServicePayroll(args({ payTypes: [{ ...clean, defaultRateType: "hourly" }], tasks: [{ payTypeId: "clean" }], rates: [rate("a", 6000, { payBasis: "technicianHourly", rateType: "hourly" })] }));
  expect(noMinutes.minAmountCents).toBeNull();
  expect(noMinutes.needsReview).toBe(true);
});

test("missing rates are review cases, and inactive items cannot supply an estimate", () => {
  const missing = estimateServicePayroll(args({ rates: [rate("a", 2000)] }));
  expect(missing).toEqual(expect.objectContaining({ minAmountCents: 2000, maxAmountCents: 2000, completeCount: 1, missingCount: 1, needsReview: true }));
  expect(estimateServicePayroll(args({ payTypes: [{ ...clean, isActive: false }] }))).toEqual(expect.objectContaining({ minAmountCents: null, maxAmountCents: null, needsReview: true }));
});

test("custom, included, unpaid, quantity, and disabled modes follow the shared calculator", () => {
  expect(estimateServicePayroll(args({ tasks: [{ payTypeId: "clean", payrollMode: "custom", manualPayOverrideCents: 0 }] })).maxAmountCents).toBe(0);
  expect(estimateServicePayroll(args({ tasks: [{ payTypeId: "clean", payrollMode: "included" }] })).maxAmountCents).toBe(0);
  expect(estimateServicePayroll(args({ tasks: [{ payTypeId: "clean", payrollMode: "unpaid" }] })).maxAmountCents).toBe(0);
  expect(estimateServicePayroll(args({ tasks: [{ payTypeId: "clean", payQuantity: 2 }] })).maxAmountCents).toBe(8000);
  expect(estimateServicePayroll(args({ settings: { payrollEnabled: false } }))).toEqual(expect.objectContaining({ disabled: true, maxAmountCents: null }));
  expect(estimateServicePayroll(args({ settings: { payMode: "hourlyOnly", hourlyPaySource: "workLogs" } }))).toEqual(expect.objectContaining({ needsReview: true, maxAmountCents: null }));
});

test("percentage pay uses the explicit customer-price base and does not invent one", () => {
  const setup = { rates: [rate("a", 1000, { rateType: "percentage" }), rate("b", 1500, { rateType: "percentage" })], customerPriceCents: 20000 };
  expect(estimateServicePayroll(args(setup))).toEqual(expect.objectContaining({ minAmountCents: 2000, maxAmountCents: 3000 }));
  expect(estimateServicePayroll(args({ ...setup, customerPriceCents: null })).minAmountCents).toBeNull();
  expect(estimateServicePayroll(args({ ...setup, customerPriceCents: 0 })).maxAmountCents).toBe(0);
});

test("per-body pay requires actual scope counts and inherited service pay items work", () => {
  const setup = { rates: [rate("a", 2000, { rateType: "perBodyOfWater" }), rate("b", 4000, { rateType: "perBodyOfWater" })], inheritedPayTypeId: "clean" };
  expect(estimateServicePayroll(args({ ...setup, tasks: [{ bodyOfWaterCount: 2 }] })).maxAmountCents).toBe(8000);
  expect(estimateServicePayroll(args({ ...setup, tasks: [{}] })).minAmountCents).toBeNull();
  expect(estimateServicePayroll(args({ tasks: [], inheritedPayTypeId: "clean" })).maxAmountCents).toBe(4000);
});

test("pay items fill blank task details and refresh generated details without replacing custom text", () => {
  const blank = { id: "task", name: "", type: "General", description: "", estimatedMinutes: "" };
  const filled = updateServiceTaskPayrollField(blank, "payTypeId", "clean", [clean]);
  expect(filled).toEqual(expect.objectContaining({ name: "Filter clean", type: "Maintenance", description: "Open, clean, and inspect", estimatedMinutes: "30", payTypeId: "clean" }));
  const next = { id: "repair", name: "Repair pump", category: "repair", description: "Diagnose and repair", defaultEstimatedMinutes: 60 };
  expect(updateServiceTaskPayrollField(filled, "payTypeId", "repair", [clean, next])).toEqual(expect.objectContaining({ name: "Repair pump", type: "Repair", description: "Diagnose and repair", estimatedMinutes: "60" }));
  const custom = { ...filled, name: "Custom name", type: "Inspection", description: "Custom notes", estimatedMinutes: "45" };
  expect(taskDefaultsFromPayItem(custom, next, clean)).toEqual(expect.objectContaining({ name: "Custom name", type: "Inspection", description: "Custom notes", estimatedMinutes: "45" }));
  expect(blank.name).toBe("");
});

test("saved task metadata keeps the selected pay policy and explicit zero override", () => {
  const [saved] = serializeServiceTasks([{ id: "task", name: " Filter clean ", payTypeId: "clean", payrollMode: "custom", manualPayOverrideCents: 0, payQuantity: 2, estimatedMinutes: "30", laborCost: "25.00", billingLaborPrice: "60.00" }]);
  expect(saved).toEqual(expect.objectContaining({ name: "Filter clean", payTypeId: "clean", manualPayOverrideCents: 0, payQuantity: 2, estimatedMinutes: 30, laborCostCents: 2500, billingLaborPriceCents: 6000 }));
});
