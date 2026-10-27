import { v4 as uuidv4 } from "uuid";
import { canonicalJobTaskType } from "./jobTaskTypes";
import { jobScopeItemRequiresBodyOfWater, jobScopeItemRequiresEquipment } from "./jobEquipmentScope";
import { itemPhotoFieldsFromSource } from "./itemPhotos";
import { canonicalShoppingListStatus, SHOPPING_LIST_STATUS } from "./shoppingListStatus";
import { jobPayFields } from "./payroll/payCalculation";

const idValue = (value) => typeof value === "object" ? value?.id || value?.value || "" : String(value || "");
const ids = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(idValue).filter(Boolean);
const remap = (value, mapping) => ids(value).map((id) => mapping.get(id)).filter(Boolean);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const taskPrice = (task) => number(task.billingLaborPriceCents ?? task.customerLaborPriceCents ?? task.billingLaborRateCents ?? task.laborBillingRateCents ?? task.billableLaborCents ?? task.contractedRate);
const fields = (source, keys) => Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
const ordered = (items = []) => [...items].sort((a, b) => number(a.sortOrder) - number(b.sortOrder));

export function copyJobTemplateScope({ template, scope, job, companyId, planId, userId = "", userName = "", newId = (prefix) => `${prefix}_${uuidv4()}` }) {
  scope = Object.fromEntries(Object.entries(scope).map(([key, items]) => [key, items.map((item, index) => ({ ...item, id: item.id || `template_${key}_${index}` }))]));
  const taskIds = new Map(scope.tasks.map((task) => [task.id, newId("comp_job_task")]));
  const stopIds = new Map(scope.plannedServiceStops.map((stop) => [stop.id, newId("comp_job_plan_stop")]));
  const materialIds = new Map(scope.shoppingItems.map((item) => [item.id, newId("comp_shop")]));
  const base = {
    companyId, jobId: job.id, customerId: job.customerId || "", customerName: job.customerName || "",
    serviceLocationId: job.serviceLocationId || "", sourceTemplateId: template.id,
    sourcePlanId: planId, sourceSolutionId: planId,
  };
  const context = (item) => ({
    equipmentId: jobScopeItemRequiresEquipment(item) || jobScopeItemRequiresEquipment(template) ? job.equipmentId || "" : "",
    bodyOfWaterId: jobScopeItemRequiresBodyOfWater(item) || jobScopeItemRequiresBodyOfWater(template) ? job.bodyOfWaterId || "" : "",
  });
  const shoppingItems = ordered(scope.shoppingItems).map((item, index) => {
    const linkedTaskId = remap(item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.taskId, taskIds)[0] || "";
    return {
      ...fields(item, ["name", "description", "subCategory", "dbItemId", "genericItemId", "plannedUnitCostCents", "plannedUnitPriceCents", "plannedTotalCostCents", "plannedTotalPriceCents", "cost", "price", "taxable", "billable", "customerApprovalRequired"]),
      ...itemPhotoFieldsFromSource(item, item.name || "Shopping item photo"), ...base, ...context(item),
      id: materialIds.get(item.id), sourceTemplateShoppingItemId: item.id,
      quantity: String(item.quantity ?? "1"), category: "Job", status: SHOPPING_LIST_STATUS.needToPurchase,
      purchaserId: userId, purchaserName: userName, invoiced: false, purchasedItem: "", datePurchased: null,
      planId, solutionId: planId, planWorkspaceOnly: true, needsAction: false, estimateAccepted: false,
      linkedTaskId, sortOrder: index,
      prepKeys: [`job:${job.id}`, job.customerId && `customer:${job.customerId}`, job.serviceLocationId && `serviceLocation:${job.serviceLocationId}`, linkedTaskId && `jobTask:${linkedTaskId}`].filter(Boolean),
    };
  });
  const tasks = ordered(scope.tasks).map((task, index) => {
    const id = taskIds.get(task.id);
    const shoppingListItemIds = [...new Set([
      ...remap([task.shoppingListItemId, ...ids(task.shoppingListItemIds)], materialIds),
      ...shoppingItems.filter((item) => item.linkedTaskId === id).map((item) => item.id),
    ])];
    return {
      ...fields(task, ["name", "description", "contractedRate", "billingLaborPriceCents", "estimatedTime", "customerApproval", "dataBaseItemId", "requiresEquipment", "requiresBodyOfWater"]),
      ...jobPayFields(task),
      ...base, ...context(task), id, sourceTemplateTaskId: task.id,
      name: task.name || task.description || "Task", type: canonicalJobTaskType(task.type || ""),
      billingLaborPriceCents: taskPrice(task),
      status: "Draft", actualTime: 0, workerId: "", workerName: "", workerType: "Not Assigned",
      laborContractId: "", serviceStopId: { id: "", internalId: "" },
      shoppingListItemId: shoppingListItemIds[0] || "", shoppingListItemIds, sortOrder: index,
    };
  });
  const plannedServiceStops = ordered(scope.plannedServiceStops).map((stop, index) => ({
    ...fields(stop, ["name", "description", "serviceStopTypeId", "serviceStopTypeName", "serviceStopTypeImage", "serviceStopTypeUseCaseRawValue", "estimatedMinutes", "plannedLaborCostCents", "billingLaborPriceCents", "plannedLaborNotes", "requiresEquipment", "requiresBodyOfWater"]),
    ...jobPayFields(stop, { payTypeId: stop.serviceStopTypeId, payTypeName: stop.serviceStopTypeName }),
    ...base, ...context(stop), id: stopIds.get(stop.id), sourceTemplatePlannedStopId: stop.id,
    taskIds: remap(stop.taskTemplateIds?.length ? stop.taskTemplateIds : stop.taskIds, taskIds), sortOrder: index,
  }));
  const laborLineItems = ordered(scope.laborLineItems).map((line, index) => {
    const id = newId("comp_job_labor_line");
    const quantity = Math.max(number(line.quantity || line.defaultQuantity || 1), 1);
    const totalPriceCents = number(line.totalPriceCents ?? line.totalAmountCents ?? line.amount ?? (number(line.unitPriceCents) * quantity));
    const mappedTaskIds = remap(line.taskTemplateIds?.length ? line.taskTemplateIds : (line.taskIds?.length ? line.taskIds : line.laborLineTaskIds), taskIds);
    const mappedStopIds = remap(line.plannedServiceStopTemplateIds?.length ? line.plannedServiceStopTemplateIds : (line.plannedServiceStopIds?.length ? line.plannedServiceStopIds : line.laborLinePlannedServiceStopIds), stopIds);
    return {
      ...fields(line, ["name", "description", "salesItemType", "billingBehavior", "sourceType", "sourceId", "catalogItemId", "salesCatalogItemId", "sourceCatalogItemId", "catalogItemName", "stripeConnectedAccountId", "stripeProductId", "stripePriceId", "taxable", "internalCostMode", "payTypeId", "payTypeName", "requiresEquipment", "requiresBodyOfWater"]),
      ...base, ...context(line), id, laborLineId: id, completionStatus: null, completedAt: null, completedByUserId: null, sourceTemplateLaborLineId: line.id,
      quantity, totalPriceCents, unitPriceCents: number(line.unitPriceCents ?? Math.round(totalPriceCents / quantity)),
      internalCostCents: number(line.internalCostCents ?? line.unitCostCents ?? line.cost),
      generatedFromTaskId: taskIds.get(line.generatedFromTaskId) || "",
      generatedFromPlannedStopId: stopIds.get(line.generatedFromPlannedStopId) || "",
      taskIds: mappedTaskIds, laborLineTaskIds: mappedTaskIds,
      plannedServiceStopIds: mappedStopIds, laborLinePlannedServiceStopIds: mappedStopIds, sortOrder: index,
    };
  });
  const explicitPrice = laborLineItems.reduce((sum, line) => sum + line.totalPriceCents, 0)
    + tasks.reduce((sum, task) => sum + taskPrice(task), 0)
    + plannedServiceStops.reduce((sum, stop) => sum + number(stop.plannedLaborCostCents), 0)
    + shoppingItems.reduce((sum, item) => sum + number(item.plannedTotalPriceCents ?? number(item.plannedUnitPriceCents ?? item.price) * number(item.quantity)), 0);
  if (!laborLineItems.length && !explicitPrice && number(template.defaultRateCents) > 0) {
    const id = newId("comp_job_labor_line");
    laborLineItems.push({
      ...base, id, laborLineId: id, name: template.name || "Template service", description: template.description || "",
      quantity: 1, unitPriceCents: number(template.defaultRateCents), totalPriceCents: number(template.defaultRateCents),
      internalCostCents: number(template.defaultLaborCostCents), taskIds: tasks.map((task) => task.id),
      laborLineTaskIds: tasks.map((task) => task.id), plannedServiceStopIds: [], laborLinePlannedServiceStopIds: [], sortOrder: laborLineItems.length,
    });
  }
  return { tasks, plannedServiceStops, laborLineItems, shoppingItems };
}

const hasActualWork = (record) => Boolean(
  ["finished", "completed", "complete", "done", "inprogress", "scheduled"].includes(String(record.status || record.operationStatus || "").replace(/[^a-z]/gi, "").toLowerCase()) ||
  record.finishedAt || record.completedAt || number(record.actualTime) > 0 || idValue(record.serviceStopId) || record.laborContractId || record.workerId
);
const hasPurchasedMaterial = (item) => Boolean(
  canonicalShoppingListStatus(item.status) !== SHOPPING_LIST_STATUS.needToPurchase ||
  item.purchasedItem || item.purchasedItemId || item.installedEquipmentId || item.datePurchased || item.invoiced
);

export function combineJobTemplateScope(existing, incoming, mode) {
  if (!["add", "overwrite"].includes(mode)) throw new Error("Choose whether to add or overwrite the planned scope.");
  const protectedTaskIds = new Set(existing.tasks.filter(hasActualWork).map((task) => task.id));
  existing.shoppingItems.filter(hasPurchasedMaterial).forEach((item) => {
    const linkedTaskId = idValue(item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.taskId);
    if (linkedTaskId) protectedTaskIds.add(linkedTaskId);
  });
  const protectedStopIds = new Set();
  let previousSize;
  do {
    previousSize = protectedTaskIds.size + protectedStopIds.size;
    existing.plannedServiceStops.forEach((stop) => {
      if (hasActualWork(stop) || protectedStopIds.has(stop.id) || ids(stop.taskIds).some((id) => protectedTaskIds.has(id))) {
        protectedStopIds.add(stop.id);
        ids(stop.taskIds).forEach((id) => protectedTaskIds.add(id));
      }
    });
    existing.laborLineItems.forEach((line) => {
      const taskIds = ids(line.taskIds?.length ? line.taskIds : line.laborLineTaskIds);
      const stopIds = ids(line.plannedServiceStopIds?.length ? line.plannedServiceStopIds : line.laborLinePlannedServiceStopIds);
      if (taskIds.some((id) => protectedTaskIds.has(id)) || stopIds.some((id) => protectedStopIds.has(id))) {
        taskIds.forEach((id) => protectedTaskIds.add(id));
        stopIds.forEach((id) => protectedStopIds.add(id));
      }
    });
  } while (protectedTaskIds.size + protectedStopIds.size !== previousSize);
  const keepStops = existing.plannedServiceStops.filter((stop) => protectedStopIds.has(stop.id));
  const keep = mode === "add" ? existing : {
    tasks: existing.tasks.filter((task) => protectedTaskIds.has(task.id)),
    plannedServiceStops: keepStops,
    laborLineItems: existing.laborLineItems.filter((line) => ids(line.taskIds?.length ? line.taskIds : line.laborLineTaskIds).some((id) => protectedTaskIds.has(id)) || ids(line.plannedServiceStopIds?.length ? line.plannedServiceStopIds : line.laborLinePlannedServiceStopIds).some((id) => protectedStopIds.has(id))),
    shoppingItems: existing.shoppingItems.filter((item) => hasPurchasedMaterial(item) || protectedTaskIds.has(idValue(item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.taskId))),
  };
  // The plan invoice uses explicit service lines when present. Keep legacy task/visit pricing visible when combining scopes.
  const withServiceLines = (scope, name) => {
    if (scope.laborLineItems.length) return scope;
    const price = scope.tasks.reduce((sum, task) => sum + taskPrice(task), 0)
      + scope.plannedServiceStops.reduce((sum, stop) => sum + number(stop.plannedLaborCostCents), 0);
    if (!price) return scope;
    const id = `comp_job_labor_line_${uuidv4()}`;
    const taskIds = scope.tasks.map((task) => task.id);
    const plannedServiceStopIds = scope.plannedServiceStops.map((stop) => stop.id);
    return { ...scope, laborLineItems: [{
      id, laborLineId: id, name, quantity: 1, unitPriceCents: price, totalPriceCents: price,
      internalCostCents: scope.tasks.reduce((sum, task) => sum + number(task.contractedRate), 0)
        + scope.plannedServiceStops.reduce((sum, stop) => sum + number(stop.plannedLaborCostCents), 0),
      taskIds, laborLineTaskIds: taskIds, plannedServiceStopIds, laborLinePlannedServiceStopIds: plannedServiceStopIds, sortOrder: 0,
    }] };
  };
  const hasServiceLines = keep.laborLineItems.length || incoming.laborLineItems.length;
  const keptScope = hasServiceLines ? withServiceLines(keep, "Existing planned services") : keep;
  const addedScope = hasServiceLines ? withServiceLines(incoming, "Template services") : incoming;
  return Object.fromEntries(Object.keys(incoming).map((key) => {
    const offset = Math.max(-1, ...keptScope[key].map((item) => number(item.sortOrder))) + 1;
    return [key, [...keptScope[key], ...addedScope[key].map((item, index) => ({ ...item, sortOrder: offset + index }))]];
  }));
}
