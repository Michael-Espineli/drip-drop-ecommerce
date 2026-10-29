import { calculatePayLines, jobPayFields, selectPayRate } from "./payCalculation";
import { canonicalJobTaskType, JOB_TASK_TYPE_NAMES } from "../jobTaskTypes";

export const moneyInputCents = (value) => value === "" || value === null || value === undefined || !Number.isFinite(Number(value))
  ? null : Math.round(Number(value) * 100);
const present = (value) => value !== "" && value !== null && value !== undefined;
const workerId = (worker) => worker.userId || worker.uid || worker.id || "";
const workerName = (worker) => worker.userName || worker.name || worker.displayName || [worker.firstName, worker.lastName].filter(Boolean).join(" ") || "Technician";
const suggestedTaskType = (item) => {
  if (!item) return "General";
  const canonicalName = canonicalJobTaskType(item.name || "");
  const knownName = canonicalName !== item.name && JOB_TASK_TYPE_NAMES.includes(canonicalName) ? canonicalName
    : JOB_TASK_TYPE_NAMES.find((name) => String(item.name || "").toLowerCase().includes(name.toLowerCase()));
  const categoryType = { repair: "Repair", installation: "Install", maintenance: "Maintenance", inspection: "Inspection" }[item.category];
  return canonicalJobTaskType(item.taskType || item.defaultTaskType || knownName || categoryType || "General");
};

export function taskDefaultsFromPayItem(task, item, previousItem = null) {
  if (!item) return task;
  const next = { ...task };
  const mayFill = (field, previous) => !present(task[field]) || task[field] === previous;
  if (mayFill("name", previousItem?.taskName || previousItem?.name)) next.name = item.taskName || item.name || "";
  if (mayFill("description", previousItem?.taskDescription || previousItem?.description)) next.description = item.taskDescription || item.description || "";
  if (!task.type || ["General", "Basic"].includes(task.type) || (previousItem && task.type === suggestedTaskType(previousItem))) {
    next.type = suggestedTaskType(item);
  }
  if (!task.payTypeId) next.payTypeName = item.name || "";
  const minutes = item.estimatedMinutes ?? item.defaultEstimatedMinutes ?? item.estimatedTime;
  const previousMinutes = previousItem?.estimatedMinutes ?? previousItem?.defaultEstimatedMinutes ?? previousItem?.estimatedTime;
  if (present(minutes) && (!present(task.estimatedMinutes) || (present(previousMinutes) && Number(task.estimatedMinutes) === Number(previousMinutes)))) next.estimatedMinutes = String(minutes);
  if (!present(task.payQuantity) && present(item.defaultPayQuantity)) next.payQuantity = Number(item.defaultPayQuantity);
  return next;
}

export function updateServiceTaskPayrollField(task, field, value, payTypes = [], inheritedPayTypeId = "") {
  if (field !== "payTypeId") return { ...task, [field]: value };
  const item = payTypes.find((type) => type.id === (value || inheritedPayTypeId));
  const previousItem = payTypes.find((type) => type.id === (task.payTypeId || inheritedPayTypeId));
  return { ...taskDefaultsFromPayItem(task, item, previousItem), payTypeId: value, payTypeName: item?.name || "" };
}

export function serializeServiceTasks(tasks = []) {
  return tasks.filter((task) => String(task.name || "").trim()).map((task) => ({
    ...jobPayFields(task), id: task.id, name: task.name.trim(), title: task.name.trim(),
    type: canonicalJobTaskType(task.type || "General"), taskType: canonicalJobTaskType(task.type || "General"),
    description: String(task.description || "").trim(),
    estimatedMinutes: Math.max(Number(task.estimatedMinutes || 0), 0),
    laborCostCents: moneyInputCents(task.laborCost) || 0,
    billingLaborPriceCents: moneyInputCents(task.billingLaborPrice) || 0,
    customerApprovalRequired: Boolean(task.customerApprovalRequired),
    genericItemId: task.genericItemId || "", dataBaseItemId: task.dataBaseItemId || "",
    productQuantity: Math.max(Number(task.productQuantity || 1), 0.01),
  }));
}

export function estimateServicePayroll({ companyId, companyUsers = [], payTypes = [], rates = [], settings = {}, tasks = [], inheritedPayTypeId = "", customerPriceCents = null, date = new Date(), includeServiceStopPay = false }) {
  const people = new Map();
  companyUsers.forEach((worker) => {
    const id = workerId(worker);
    if (!id || worker.isRateTemplate || worker.active === false || worker.isActive === false || worker.archived === true ||
      ["inactive", "archived", "deleted", "invited", "pending", "suspended"].includes(String(worker.status || worker.userStatus || "").toLowerCase())) return;
    people.set(id, { ...worker, userId: id, userName: workerName(worker) });
  });
  const workers = [...people.values()];
  const activeRates = rates.filter((rate) => rate.active !== false && rate.isActive !== false);
  const sourceTasks = tasks.length || includeServiceStopPay ? tasks : inheritedPayTypeId ? [{ id: "service-pay-preview", name: "Service", payTypeId: inheritedPayTypeId }] : [];
  const normalizedTasks = sourceTasks.map((task, index) => ({
    ...jobPayFields(task, { payTypeId: inheritedPayTypeId }),
    id: task.id || `service-task-${index}`, name: task.name || `Task ${index + 1}`,
    estimatedTime: Number(task.estimatedMinutes ?? task.estimatedTime ?? 0),
    contractedRate: present(task.laborCost) ? moneyInputCents(task.laborCost) : Number(task.contractedRate ?? task.laborCostCents ?? 0),
    payrollBaseAmountCents: task.payrollBaseAmountCents ?? customerPriceCents,
    bodyOfWaterId: task.bodyOfWaterId || "", bodyOfWaterIds: task.bodyOfWaterIds || [], bodyOfWaterCount: task.bodyOfWaterCount,
    serviceLocationId: task.serviceLocationId || "", serviceLocationIds: task.serviceLocationIds || [], serviceLocationCount: task.serviceLocationCount,
  }));
  const disabled = settings.payrollEnabled === false || settings.companyPayrollEnabled === false || settings.payrollDisabled === true;
  const clockBased = settings.payMode === "hourlyOnly" && ["workLogs", "activeRouteDuration", "activeRouteLogs"].includes(settings.hourlyPaySource);
  const summaries = workers.map((worker) => {
    const lines = calculatePayLines({
      companyId, settings, workTypes: payTypes, rates: activeRates, workers, date, mode: "preview", jobTaskSource: !includeServiceStopPay,
      serviceStop: { id: "service-cost-preview", techId: worker.userId, serviceDate: date,
        payTypeId: inheritedPayTypeId, payrollBaseAmountCents: customerPriceCents,
        estimatedMinutes: normalizedTasks.reduce((sum, task) => sum + task.estimatedTime, 0) },
      tasks: normalizedTasks.map((task) => ({ ...task, workerId: worker.userId, workerName: worker.userName })),
    });
    const reasons = [...new Set(lines.filter((line) => line.calculationStatus === "needsReview").map((line) => line.notes))];
    if (clockBased) reasons.push("Pay is based on tracked work time; service tasks do not provide those hours.");
    const calculated = lines.filter((line) => line.calculationStatus !== "needsReview");
    const sum = (items) => items.reduce((total, line) => total + Number(line.totalAmountCents || 0), 0);
    return { worker, lines, reasons, needsReview: reasons.length > 0, totalAmountCents: sum(calculated),
      stopPayCents: sum(calculated.filter((line) => line.source === "serviceStop")),
      taskPayCents: sum(calculated.filter((line) => line.source === "serviceStopTask")) };
  });
  const complete = summaries.filter((summary) => !summary.needsReview);
  const selectedPayIds = [...new Set([...normalizedTasks.filter((task) => !["included", "unpaid"].includes(task.payrollMode)).map((task) => task.payTypeId), includeServiceStopPay ? inheritedPayTypeId : ""].filter(Boolean))];
  const rateGroups = new Map();
  selectedPayIds.forEach((payTypeId) => {
    const payType = payTypes.find((type) => type.id === payTypeId);
    if (!payType || payType.isActive === false || payType.active === false || payType.archived) return;
    const bases = new Set(activeRates.filter((rate) => (rate.payTypeId || rate.payWorkTypeId || rate.workTypeId) === payTypeId).map((rate) => rate.payBasis));
    if (payType.defaultRateType === "hourly" || settings.payMode === "hourlyOnly") bases.add("technicianHourly");
    workers.forEach((worker) => bases.forEach((basis) => {
      const rate = selectPayRate({ companyId, technicianId: worker.userId, workTypeId: payTypeId, basis, rates: activeRates, date, hourlyFallback: basis === "technicianHourly" });
      if (!rate || !(Number(rate.amountCents) > 0)) return;
      const key = `${payTypeId}:${basis}:${rate.rateType}`;
      const group = rateGroups.get(key) || { key, payTypeId, name: payType.name || payTypeId, rateType: rate.rateType, payBasis: basis, amounts: [] };
      group.amounts.push(Number(rate.amountCents));
      rateGroups.set(key, group);
    }));
  });
  const configuredRates = [...rateGroups.values()].map(({ amounts, ...group }) => ({ ...group, minAmountCents: Math.min(...amounts), maxAmountCents: Math.max(...amounts), technicianCount: amounts.length }));
  const hasScope = sourceTasks.length > 0 || Boolean(includeServiceStopPay && inheritedPayTypeId);
  return {
    disabled, hasScope, summaries, configuredRates,
    usesCustomerPriceBase: normalizedTasks.some((task, index) => !present(sourceTasks[index].payrollBaseAmountCents) && configuredRates.some((rate) => rate.payTypeId === task.payTypeId && rate.rateType === "percentage")),
    minAmountCents: !disabled && hasScope && complete.length ? Math.min(...complete.map((summary) => summary.totalAmountCents)) : null,
    maxAmountCents: !disabled && hasScope && complete.length ? Math.max(...complete.map((summary) => summary.totalAmountCents)) : null,
    stopPayRange: complete.length ? [Math.min(...complete.map((summary) => summary.stopPayCents)), Math.max(...complete.map((summary) => summary.stopPayCents))] : null,
    taskPayRange: complete.length ? [Math.min(...complete.map((summary) => summary.taskPayCents)), Math.max(...complete.map((summary) => summary.taskPayCents))] : null,
    completeCount: complete.length, technicianCount: workers.length, missingCount: summaries.length - complete.length,
    needsReview: !hasScope || !workers.length || summaries.some((summary) => summary.needsReview),
    noSeparatePay: !disabled && hasScope && summaries.length > 0 && summaries.every((summary) => !summary.lines.length && !summary.needsReview),
    reasons: [...new Set(summaries.flatMap((summary) => summary.reasons))],
  };
}
