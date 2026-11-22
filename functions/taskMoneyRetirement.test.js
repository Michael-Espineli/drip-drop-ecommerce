const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calculatePayLines, reconcilePayLines } = require("./payrollCalculation");
const { createPayrollWorkflow } = require("./payrollWorkflow");
const { MemoryFirestore } = require("./testSupport/memoryFirestore");

const stop = { id: "visit", jobId: "job", techId: "tech", payTypeId: "visit-item", operationStatus: "Finished", duration: 90, estimatedMinutes: 60 };
const task = { id: "task", status: "Finished", workerId: "different-tech", payTypeId: "task-item",
  contractedRate: 5000, payrollMode: "custom", manualPayOverrideCents: 5000, actualTime: 15 };
const workTypes = [{ id: "visit-item", name: "Visit", defaultRateType: "flatPerStop" }];
const rates = [
  { id: "visit-rate", technicianId: "tech", payTypeId: "visit-item", payBasis: "serviceStop", rateType: "flatPerStop", amountCents: 3500 },
  { id: "hourly-rate", technicianId: "tech", payBasis: "technicianHourly", rateType: "hourly", amountCents: 2400 },
  { id: "task-rate", technicianId: "different-tech", payTypeId: "task-item", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents: 8000 },
];
const calculate = overrides => calculatePayLines({ companyId: "company", serviceStop: stop, workTypes, rates, tasks: [task], ...overrides });

test("legacy task budgets, custom overrides, and worker assignments never generate earnings", () => {
  for (const mode of ["preview", "actual"]) {
    const lines = calculate({ mode, settings: { routePaySource: "completedTasks", taskPaySource: "taskContractedRate" } });
    assert.deepEqual(lines.map(line => [line.source, line.technicianId, line.totalAmountCents]), [["serviceStop", "tech", 3500]]);
    assert.deepEqual(calculate({ mode, jobTaskSource: true }), []);
  }
  assert.deepEqual(calculate({ serviceStop: { ...stop, operationStatus: "In Progress" } }), []);
});

test("legacy task-hourly settings resolve pay from the visit duration", () => {
  const settings = { payMode: "hourlyOnly", hourlyPaySource: "taskActualTime" };
  const [actual] = calculate({ settings });
  assert.deepEqual([actual.rateType, actual.quantity, actual.totalAmountCents], ["hourly", 90, 3600]);
  const [forecast] = calculate({ settings, mode: "preview" });
  assert.equal(forecast.totalAmountCents, 2400);
  assert.deepEqual(calculate({ settings: { payMode: "hourlyOnly", hourlyPaySource: "workLogs" } }), []);
});

test("accepted fixed pay is earned once on the completed visit", () => {
  const payrollAgreement = { workerId: "tech", rateDate: new Date(), rates: [], paySource: "Offered Amount",
    fixedAmountCents: 5750, offerId: "offer", claimId: "claim", taskIds: ["task"], completionReady: true };
  const lines = calculate({ serviceStop: { ...stop, payrollAgreement } });
  assert.deepEqual(lines.map(line => [line.serviceStopId, line.jobTaskId, line.totalAmountCents]), [["visit", null, 5750]]);
  assert.deepEqual(calculate({ jobTaskSource: true, serviceStop: { ...stop, payrollAgreement } }), []);
});

test("reconciliation retires open task earnings and preserves protected history", () => {
  const pending = { id: "pending-task", serviceStopId: "visit", serviceStopTaskId: "task", calculationStatus: "calculated", totalAmountCents: 5000 };
  const approved = { ...pending, id: "approved-task", calculationStatus: "approved" };
  const generated = calculate();
  const first = reconcilePayLines({ generated, existing: [pending], preserveCalculated: true });
  assert.equal(first.writes.find(line => line.id === pending.id).voidReason, "taskPayRetired");
  assert.equal(first.writes.find(line => line.source === "serviceStop").totalAmountCents, 3500);
  const locked = reconcilePayLines({ generated, existing: [approved] });
  assert.deepEqual(locked, { writes: [], conflicts: [approved.id] });
});

test("the normal visit and job reconcilers persist no new task earnings", async () => {
  const prefix = "companies/company";
  const earnings = prefix + "/technicianPayLineItems";
  const db = new MemoryFirestore({
    [prefix + "/serviceStops/visit"]: stop,
    [prefix + "/serviceStops/visit/tasks/task"]: task,
    [prefix + "/workOrders/job"]: { id: "job" },
    [prefix + "/workOrders/job/tasks/task"]: task,
    [prefix + "/companyPayTypes/visit-item"]: workTypes[0],
    ...Object.fromEntries(rates.map(rate => [prefix + "/technicianRates/" + rate.id, rate])),
    [earnings + "/old-job-task"]: { payrollSource: "jobTask", jobId: "job", jobTaskId: "task", calculationStatus: "needsReview" },
  });
  const workflow = createPayrollWorkflow(db);
  for (let run = 0; run < 2; run += 1) {
    await workflow.reconcileJob("company", "job");
    await workflow.reconcileStop("company", "visit");
  }
  const rows = (await db.collection(earnings).get()).docs.map(doc => doc.data());
  assert.deepEqual(rows.filter(line => line.calculationStatus !== "voided").map(line => [line.source, line.totalAmountCents]), [["serviceStop", 3500]]);
  assert.equal(rows.find(line => line.payrollSource === "jobTask").voidReason, "taskPayRetired");
});
