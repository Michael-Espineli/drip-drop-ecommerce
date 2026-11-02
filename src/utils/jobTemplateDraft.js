import { v4 as uuidv4 } from "uuid";
import { jobPayFields } from "./payroll/payCalculation";
import { canonicalJobTaskType } from "./jobTaskTypes";
import { getJobMaterialVendorItemId } from "./productCatalog";

export const emptyJobTemplateScope = () => ({ tasks: [], plannedServiceStops: [], laborLineItems: [], shoppingItems: [] });
const id = (type) => `comp_job_template_${type}_${uuidv4()}`;
const cents = (...values) => Math.round(Number(values.find((value) => value !== undefined && value !== null && value !== "") ?? 0));
const vendorId = (product) => getJobMaterialVendorItemId(product) || (!product.genericItemId ? product.id : null);

export const templateDraftProduct = (product, quantity = 1) => ({
  id: id("shop_item"), name: product.name || product.label || "Product", description: product.description || "",
  genericItemId: product.genericItemId || null,
  dbItemId: vendorId(product) || null,
  dataBaseItemId: vendorId(product) || null,
  subCategory: product.subCategory || product.category || "Misc",
  quantity: String(quantity), billable: product.billable !== false, taxable: Boolean(product.taxable),
  plannedUnitCostCents: cents(product.rate, product.unitCostCents, product.cost),
  plannedUnitPriceCents: cents(product.sellPrice, product.billingRate, product.unitAmountCents, product.price),
  linkedTaskIds: [], sourceType: "databaseItem",
});

export const addServiceToTemplateDraft = (scope, service, products = []) => {
  const lineId = id("labor_line");
  const quantity = Math.max(Number(service.defaultQuantity || 1), 1);
  const sources = service.metadata?.taskTemplates || service.metadata?.tasks || service.taskTemplates || [];
  const tasks = (sources.length ? sources : [{ name: service.name, type: "Basic", payrollMode: "included" }]).map((task, index) => {
    const pay = jobPayFields(task, service);
    return {
      id: id("task"), name: task.name || task.title || task.description || `Task ${index + 1}`,
      type: canonicalJobTaskType(task.type || task.taskType || "Basic"), description: task.description || "",
      contractedRate: cents(task.laborCostCents, task.contractRateCents, task.contractedRateCents, task.contractedRate, task.costCents),
      billingLaborPriceCents: cents(task.billingLaborPriceCents, task.unitAmountCents, task.priceCents, task.rateCents),
      estimatedTime: Number(task.estimatedMinutes ?? task.estimatedTime ?? task.minutes ?? task.durationMinutes ?? 0) * quantity,
      ...pay, payQuantity: pay.payQuantity * quantity,
      manualPayOverrideCents: pay.manualPayOverrideCents === null ? null : Math.round(pay.manualPayOverrideCents * quantity),
      customerApproval: Boolean(task.customerApproval || task.customerApprovalRequired),
      genericItemId: task.genericItemId || "", dataBaseItemId: task.dataBaseItemId || "", productQuantity: Number(task.productQuantity || 1),
      laborLineId: lineId, laborLineIds: [lineId], sourceType: "serviceCatalog", sourceCatalogItemId: service.id,
      sourceCatalogTaskTemplateId: task.id || "", sortOrder: scope.tasks.length + index,
    };
  });
  const shoppingItems = scope.shoppingItems.map((product) => ({ ...product, linkedTaskIds: [...(product.linkedTaskIds || [])] }));
  for (const task of tasks) {
    if (!task.genericItemId) continue;
    const catalogProduct = products.find((product) => product.genericItemId === task.genericItemId);
    if (!catalogProduct) throw new Error(`The product required by ${task.name} is unavailable. Update the service catalog before adding this service.`);
    task.dataBaseItemId = task.dataBaseItemId || vendorId(catalogProduct) || "";
    let product = shoppingItems.find((item) => item.genericItemId === task.genericItemId);
    if (!product) {
      product = templateDraftProduct(catalogProduct, task.productQuantity * quantity);
      shoppingItems.push(product);
    }
    product.linkedTaskIds.push(task.id);
    product.linkedTaskId = product.linkedTaskIds[0];
    task.shoppingListItemId = product.id;
    task.shoppingListItemIds = [product.id];
  }
  const taskIds = tasks.map((task) => task.id);
  const line = {
    id: lineId, laborLineId: lineId, name: service.name || "Service", description: service.description || "",
    quantity, unitPriceCents: cents(service.unitAmountCents), totalPriceCents: cents(service.unitAmountCents) * quantity,
    internalCostCents: Math.round(cents(service.unitCostCents) * quantity), taxable: Boolean(service.taxable),
    internalCostMode: "fixed",
    payTypeId: jobPayFields(service).payTypeId, payTypeName: service.payTypeName || "",
    taskTemplateIds: taskIds, taskIds, laborLineTaskIds: taskIds,
    plannedServiceStopTemplateIds: [], plannedServiceStopIds: [], laborLinePlannedServiceStopIds: [],
    salesItemType: service.type || "service", billingBehavior: service.billingBehavior || "oneTime",
    sourceType: service.sourceType || "manual", sourceId: service.sourceId || "",
    catalogItemId: service.id, salesCatalogItemId: service.id, catalogItemName: service.name || "",
    stripeProductId: service.stripeProductId || "", stripePriceId: service.stripePriceId || "", sortOrder: scope.laborLineItems.length,
  };
  return { ...scope, tasks: [...scope.tasks, ...tasks], laborLineItems: [...scope.laborLineItems, line], shoppingItems };
};

export const newTemplateTask = () => ({
  id: id("task"), name: "", description: "", type: "Basic", estimatedTime: 0,
  contractedRate: 0, billingLaborPriceCents: 0, customerApproval: false, ...jobPayFields({ payrollMode: "included" }),
});

export const newTemplateVisit = () => ({
  id: id("plan_stop"), name: "", description: "", estimatedMinutes: 60,
  serviceStopTypeId: "", serviceStopTypeName: "", serviceStopTypeImage: "briefcase",
  serviceStopTypeUseCaseRawValue: "jobVisit", taskTemplateIds: [], plannedLaborCostCents: 0,
  ...jobPayFields({ payrollMode: "included" }),
});

export const removeTemplateDraftItem = (scope, type, itemId) => {
  const next = { ...scope, [type]: scope[type].filter((item) => item.id !== itemId) };
  if (type === "tasks") {
    next.plannedServiceStops = scope.plannedServiceStops.map((stop) => ({ ...stop, taskTemplateIds: stop.taskTemplateIds.filter((value) => value !== itemId) }));
    next.laborLineItems = scope.laborLineItems.map((line) => {
      const taskIds = line.taskTemplateIds.filter((value) => value !== itemId);
      return { ...line, taskTemplateIds: taskIds, taskIds, laborLineTaskIds: taskIds };
    });
    next.shoppingItems = scope.shoppingItems.map((product) => {
      const linkedTaskIds = (product.linkedTaskIds || []).filter((value) => value !== itemId);
      return { ...product, linkedTaskIds, linkedTaskId: linkedTaskIds[0] || "" };
    });
  }
  if (type === "laborLineItems") next.tasks = scope.tasks.map((task) => ({
    ...task, laborLineId: task.laborLineId === itemId ? "" : task.laborLineId,
    laborLineIds: (task.laborLineIds || []).filter((value) => value !== itemId),
  }));
  if (type === "shoppingItems") next.tasks = scope.tasks.map((task) => ({
    ...task, shoppingListItemId: task.shoppingListItemId === itemId ? "" : task.shoppingListItemId,
    shoppingListItemIds: (task.shoppingListItemIds || []).filter((value) => value !== itemId),
  }));
  return next;
};

export const prepareJobTemplateScope = (scope, companyId, templateId) => Object.fromEntries(
  Object.entries(scope).map(([type, items]) => [type, items.map((item, sortOrder) => {
    if (!item.name.trim()) throw new Error("Give every service, task, visit, and product a name, or remove the empty row.");
    for (const field of ["quantity", "estimatedTime", "estimatedMinutes", "unitPriceCents", "plannedUnitPriceCents", "plannedUnitCostCents", "billingLaborPriceCents", "contractedRate", "internalCostCents", "totalPriceCents", "plannedLaborCostCents"]) {
      if (item[field] !== undefined && (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0 || (field === "quantity" && Number(item[field]) === 0))) {
        throw new Error("Enter valid quantities, prices, and durations before saving the template.");
      }
    }
    return {
      ...item, companyId, templateId, name: item.name.trim(), sortOrder,
      ...(type === "shoppingItems" ? {
        plannedTotalPriceCents: Math.round(Number(item.quantity) * item.plannedUnitPriceCents),
        plannedTotalCostCents: Math.round(Number(item.quantity) * item.plannedUnitCostCents),
      } : {}),
    };
  })])
);
