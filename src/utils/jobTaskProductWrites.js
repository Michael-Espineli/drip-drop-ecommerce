import { doc } from "firebase/firestore";
import { itemPhotoFieldsFromSource } from "./itemPhotos";
import { buildTaskProductOptions, findTaskProduct, linkTaskToPlanProduct, planProductId, productFieldsForTask, taskProductIds, unlinkTaskFromPlanProduct } from "./jobPlanProducts";

// Stage the task and product together in the caller's batch. Returns the updated
// material list so another task in this batch can reuse a newly added product.
export const stageJobTaskProduct = ({ batch, db, companyId, job, task, product = null,
  materials = [], tasks = [], products = [], databaseItems = [], quantity = 1,
  newMaterialId, materialDefaults = {}, createTask = false }) => {
  let nextMaterials = [...materials];
  let selected = product;
  if (selected && !selected.planMaterialId) {
    const options = buildTaskProductOptions({ materials, products, databaseItems });
    selected = findTaskProduct({ genericItemId: selected.genericItemId, dataBaseItemId: selected.dbItemId }, options) || selected;
    const duplicates = options.planned.filter((item) => selected.genericItemId
      ? item.genericItemId === selected.genericItemId : item.dbItemId === selected.dbItemId);
    if (duplicates.length > 1) throw new Error("Choose which product row on the plan this task should use.");
  }
  if (selected && !selected.dbItemId) throw new Error("Connect this product to a database item in Products first.");
  let material = selected?.planMaterialId ? materials.find((item) => planProductId(item) === selected.planMaterialId) : null;
  if (selected?.planMaterialId && !material) throw new Error("The selected plan product is no longer available. Select it again.");
  if (selected && !material) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Product quantity must be greater than 0.");
    const cost = Number(selected.rate ?? selected.cost ?? 0);
    const price = Number(selected.sellPrice ?? selected.billingRate ?? 0);
    material = { ...materialDefaults, id: newMaterialId, category: "Job", subCategory: "Data Base",
      genericItemId: selected.genericItemId || "", dbItemId: selected.dbItemId, dataBaseItemId: selected.dbItemId,
      dbItemName: selected.name || "", itemId: selected.dbItemId, itemType: "Data Base",
      name: selected.name || "Product", description: selected.description || "", quantity: String(qty),
      taxable: Boolean(selected.taxable), cost, price, plannedUnitCostCents: cost, plannedUnitPriceCents: price,
      plannedTotalCostCents: Math.round(cost * qty), plannedTotalPriceCents: Math.round(price * qty),
      ...itemPhotoFieldsFromSource(selected, selected.name || "Product"),
      jobId: job.id, jobName: job.internalId || "Job", customerId: job.customerId || "",
      customerName: job.customerName || "", serviceLocationId: job.serviceLocationId || "",
      prepKeys: [`job:${job.id}`, job.customerId && `customer:${job.customerId}`, job.serviceLocationId && `serviceLocation:${job.serviceLocationId}`].filter(Boolean) };
    Object.assign(material, linkTaskToPlanProduct(material, task));
    batch.set(doc(db, "companies", companyId, "shoppingList", newMaterialId), material);
    nextMaterials.push(material);
  } else if (material) {
    const updates = { ...linkTaskToPlanProduct(material, task),
      genericItemId: material.genericItemId || selected.genericItemId || "",
      dbItemId: selected.dbItemId, dataBaseItemId: selected.dbItemId, itemId: selected.dbItemId };
    batch.update(doc(db, "companies", companyId, "shoppingList", planProductId(material)), updates);
    nextMaterials = nextMaterials.map((item) => planProductId(item) === planProductId(material) ? { ...item, ...updates } : item);
  }
  const materialId = material ? planProductId(material) : "";
  const oldPrimary = task.shoppingListItemId || "";
  if (oldPrimary && oldPrimary !== materialId) {
    const previous = materials.find((item) => planProductId(item) === oldPrimary);
    if (previous) {
      const updates = unlinkTaskFromPlanProduct(previous, task.id, tasks);
      batch.update(doc(db, "companies", companyId, "shoppingList", oldPrimary), updates);
      nextMaterials = nextMaterials.map((item) => planProductId(item) === oldPrimary ? { ...item, ...updates } : item);
    }
  }
  const nextTask = { ...task, ...productFieldsForTask(selected, materialId), shoppingListItemIds: [...new Set([
    ...taskProductIds(task).filter((id) => id !== oldPrimary), materialId,
  ].filter(Boolean))] };
  const ref = doc(db, "companies", companyId, "workOrders", job.id, "tasks", task.id);
  if (createTask) batch.set(ref, nextTask);
  else batch.update(ref, nextTask);
  return { task: nextTask, materials: nextMaterials };
};
