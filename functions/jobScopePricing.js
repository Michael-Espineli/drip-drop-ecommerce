const cents = (value) => Math.round(Number(value) || 0);
const ids = (values) => (Array.isArray(values) ? values : []).map((value) => typeof value === "string" ? value : value?.id).filter(Boolean);

const isTaskChargeLine = (line = {}) => Boolean(line.generatedFromTaskId || line.metadata?.generatedFromTaskId || line.metadata?.legacyTaskCharge ||
  [line.id, line.laborLineId, line.sourceId, line.metadata?.laborLineId].some((value) => String(value || "").startsWith("scope_task_")) ||
  [line.sourceType, line.type].some((value) => /^(job|servicestop)?task$/i.test(String(value || "").replace(/[^a-z]/gi, ""))) ||
  (line.metadata?.generatedFromPlannedWork && (line.taskIds?.length || line.metadata.taskIds?.length)));

const hasDraftTaskCharges = (invoice = {}) => String(invoice.status || "").toLowerCase() === "draft" &&
  Array.isArray(invoice.lineItems) && invoice.lineItems.some(isTaskChargeLine);
const draftTaskChargeMessage = "Remove legacy task charges from this draft invoice before issuing it.";

const visitCustomerPriceCents = (stop = {}) => {
  const explicit = [stop.billingLaborPriceCents, stop.customerLaborPriceCents]
    .find((value) => value !== undefined && value !== null && value !== "");
  return cents(explicit ?? stop.plannedLaborCostCents ?? stop.cost);
};

const completeJobLaborLines = ({ laborLineItems = [], plannedServiceStops = [], plannedStopCost = (stop) => cents(stop.plannedLaborCostCents) } = {}) => {
  const linkedStops = (line) => ids(line.plannedServiceStopIds?.length ? line.plannedServiceStopIds
    : line.laborLinePlannedServiceStopIds?.length ? line.laborLinePlannedServiceStopIds : line.plannedServiceStopTemplateIds);
  const lines = laborLineItems.filter((line) => !isTaskChargeLine(line) && !line.generatedFromPlannedStopId).map((line) => {
    const stopIds = linkedStops(line);
    const taskIds = ids(line.taskIds?.length ? line.taskIds : line.laborLineTaskIds?.length ? line.laborLineTaskIds : line.taskTemplateIds);
    if (line.internalCostMode === "fixed" || (!stopIds.length && !taskIds.length)) return line;
    const internalCostCents = plannedServiceStops.filter((stop) => stopIds.includes(stop.id))
      .reduce((sum, stop) => sum + cents(plannedStopCost(stop)), 0);
    return { ...line, internalCostMode: "payroll", internalCostCents };
  });
  const coveredStops = new Set(lines.flatMap(linkedStops));
  const extraStops = plannedServiceStops.filter((stop) => !coveredStops.has(stop.id)).map((stop) => {
    const cost = cents(plannedStopCost(stop));
    const price = visitCustomerPriceCents(stop);
    const id = `scope_visit_${stop.id}`;
    return { id, laborLineId: id, name: stop.name || stop.description || "Additional visit",
      description: stop.description || "", quantity: 1, unitPriceCents: price, totalPriceCents: price,
      internalCostCents: cost, taxable: Boolean(stop.taxable), taskIds: [], plannedServiceStopIds: [stop.id], generatedFromPlannedStopId: stop.id };
  });
  return [...lines, ...extraStops.filter((line) => line.totalPriceCents || line.internalCostCents)];
};

const jobLaborTotals = (scope) => completeJobLaborLines(scope).reduce((totals, line) => ({
  priceCents: totals.priceCents + cents(line.totalPriceCents ?? line.totalAmountCents ?? Number(line.unitPriceCents ?? line.unitAmountCents ?? 0) * Number(line.quantity ?? 1)),
  costCents: totals.costCents + cents(line.internalCostCents ?? line.internalLaborCostCents ?? line.unitCostCents),
}), { priceCents: 0, costCents: 0 });

module.exports = { isTaskChargeLine, hasDraftTaskCharges, draftTaskChargeMessage, visitCustomerPriceCents, completeJobLaborLines, jobLaborTotals };
