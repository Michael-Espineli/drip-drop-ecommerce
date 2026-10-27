const cents = (value) => Math.round(Number(value) || 0);
const ids = (values) => (Array.isArray(values) ? values : []).map((v) => typeof v === "string" ? v : v?.id).filter(Boolean);

const taskCustomerPriceCents = (task = {}) => {
  const explicit = [task.billingLaborPriceCents, task.customerLaborPriceCents, task.billingLaborRateCents,
    task.laborBillingRateCents, task.billableLaborCents].find((value) => value !== undefined && value !== null && value !== "");
  return cents(explicit ?? task.contractedRate);
};

// Generated lines are derived again so task edits and service assignments cannot
// leave stale charges behind. A service covering a visit also covers its tasks.
const completeJobLaborLines = ({ laborLineItems = [], tasks = [], plannedServiceStops = [], plannedStopCost = (stop) => cents(stop.plannedLaborCostCents), taskCost } = {}) => {
  const taskIdsFor = (stop) => ids(stop.taskIds?.length ? stop.taskIds : stop.taskTemplateIds);
  const visitTaskIds = new Set(plannedServiceStops.flatMap(taskIdsFor));
  const costForTask = (task) => visitTaskIds.has(task.id) ? 0 : cents(taskCost ? taskCost(task) : task.contractedRate);
  const lines = laborLineItems.filter((line) => !line.generatedFromTaskId && !line.generatedFromPlannedStopId).map((line) => {
    if (!taskCost || line.internalCostMode === "fixed") return line;
    const linkedTasks = new Set(ids(line.taskIds?.length ? line.taskIds : line.laborLineTaskIds?.length ? line.laborLineTaskIds : line.taskTemplateIds));
    const linkedStops = new Set(ids(line.plannedServiceStopIds?.length ? line.plannedServiceStopIds : line.laborLinePlannedServiceStopIds?.length ? line.laborLinePlannedServiceStopIds : line.plannedServiceStopTemplateIds));
    if (!linkedTasks.size && !linkedStops.size) return line;
    return { ...line, internalCostMode: "payroll", internalCostCents: tasks.filter((task) => linkedTasks.has(task.id)).reduce((sum, task) => sum + costForTask(task), 0)
      + plannedServiceStops.filter((stop) => linkedStops.has(stop.id)).reduce((sum, stop) => sum + cents(plannedStopCost(stop)), 0) };
  });
  const coveredTasks = new Set(lines.flatMap((line) => ids(line.taskIds?.length ? line.taskIds : line.laborLineTaskIds?.length ? line.laborLineTaskIds : line.taskTemplateIds)));
  const coveredStops = new Set(lines.flatMap((line) => ids(line.plannedServiceStopIds?.length ? line.plannedServiceStopIds : line.laborLinePlannedServiceStopIds?.length ? line.laborLinePlannedServiceStopIds : line.plannedServiceStopTemplateIds)));
  plannedServiceStops.filter((stop) => coveredStops.has(stop.id)).forEach((stop) => {
    ids(stop.taskIds?.length ? stop.taskIds : stop.taskTemplateIds).forEach((id) => coveredTasks.add(id));
  });
  const generated = (scope, kind, price, cost) => ({
    id: `scope_${kind}_${scope.id}`, laborLineId: `scope_${kind}_${scope.id}`,
    name: scope.name || scope.description || (kind === "task" ? "Additional task" : "Additional visit"),
    description: scope.description || "", quantity: 1, unitPriceCents: price,
    totalPriceCents: price, internalCostCents: cost, taxable: Boolean(scope.taxable),
    taskIds: kind === "task" ? [scope.id] : [],
    plannedServiceStopIds: kind === "visit" ? [scope.id] : [],
    ...(kind === "task" ? { generatedFromTaskId: scope.id } : { generatedFromPlannedStopId: scope.id }),
  });
  const extraTasks = tasks.filter((task) => !coveredTasks.has(task.id)).map((task) => (
    generated(task, "task", taskCustomerPriceCents(task), costForTask(task))
  ));
  const extraStops = plannedServiceStops.filter((stop) => !coveredStops.has(stop.id)).map((stop) => {
    const cost = cents(plannedStopCost(stop));
    const price = cents(stop.billingLaborPriceCents ?? stop.customerLaborPriceCents ?? stop.plannedLaborCostCents ?? 0);
    return generated(stop, "visit", price, cost);
  });
  return [...lines, ...extraTasks, ...extraStops].filter((line) => !line.generatedFromTaskId && !line.generatedFromPlannedStopId || line.totalPriceCents || line.internalCostCents);
};

const jobLaborTotals = (scope) => completeJobLaborLines(scope).reduce((totals, line) => ({
  priceCents: totals.priceCents + cents(line.totalPriceCents ?? line.totalAmountCents ?? Number(line.unitPriceCents ?? line.unitAmountCents ?? 0) * Number(line.quantity ?? 1)),
  costCents: totals.costCents + cents(line.internalCostCents ?? line.internalLaborCostCents ?? line.unitCostCents),
}), { priceCents: 0, costCents: 0 });

module.exports = { taskCustomerPriceCents, completeJobLaborLines, jobLaborTotals };
