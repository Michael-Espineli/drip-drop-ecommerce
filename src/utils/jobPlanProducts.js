import { getJobMaterialVendorItemId } from "./productCatalog";
import { isEquipmentDatabaseItem } from "./databaseEquipmentItems";

export const planProductId = (item = {}) => item.docId || item.id || "";
export const taskProductIds = (task = {}) => [...new Set([
  task.shoppingListItemId, ...(task.shoppingListItemIds || []),
].filter(Boolean))];
export const productTaskIds = (item = {}) => [...new Set([
  item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.sourceTaskId,
  ...(item.linkedTaskIds || []),
].filter(Boolean))];

// Product IDs and supplier/database IDs identify different records. Only explicit
// catalog relationships may connect them; similar display names are insufficient.
export const buildTaskProductOptions = ({ materials = [], products = [], databaseItems = [], equipmentOnly = false } = {}) => {
  const catalog = products.map((product) => {
    const productId = product.genericItemId || (product.catalogSource === "product" ? product.id : "");
    const dbId = product.dbItemId || (product.catalogSource === "legacyVendor" ? product.id : "");
    const vendor = databaseItems.find((item) => item.id === dbId) || {};
    return { ...vendor, ...product, id: dbId, dbItemId: dbId, genericItemId: productId,
      category: vendor.category || product.category, value: `catalog:${product.id}`,
      label: product.name || product.label || "Product", planMaterialId: "" };
  });
  const planned = materials.map((material) => {
    const dbId = getJobMaterialVendorItemId(material);
    const product = catalog.find((item) => material.genericItemId && item.genericItemId === material.genericItemId)
      || catalog.find((item) => dbId && item.dbItemId === dbId) || {};
    const resolvedDbId = dbId || product.dbItemId || "";
    const vendor = databaseItems.find((item) => item.id === resolvedDbId) || {};
    const materialId = planProductId(material);
    return { ...product, ...vendor, id: resolvedDbId, dbItemId: resolvedDbId,
      genericItemId: material.genericItemId || product.genericItemId || vendor.genericItemId || "",
      name: material.name || product.name || vendor.name || "Product",
      label: `${material.name || product.name || vendor.name || "Product"} · Qty ${material.quantity ?? "1"}`,
      value: `plan:${materialId}`, planMaterialId: materialId, material,
      rate: material.plannedUnitCostCents ?? material.cost ?? vendor.rate ?? 0,
      sellPrice: material.plannedUnitPriceCents ?? material.price ?? product.sellPrice ?? 0,
      taxable: material.taxable ?? product.taxable ?? false };
  });
  const eligible = (item) => !equipmentOnly || isEquipmentDatabaseItem(item) || !item.dbItemId;
  return { planned: planned.filter(eligible), catalog: catalog.filter(eligible) };
};

export const findTaskProduct = (task = {}, options = {}, { allowSoleProduct = false } = {}) => {
  const planned = options.planned || [];
  const catalog = options.catalog || [];
  const linked = planned.filter((item) => taskProductIds(task).includes(item.planMaterialId)
    || productTaskIds(item.material).includes(task.id));
  if (linked.length === 1) return linked[0];
  const matches = (items) => items.filter((item) => task.genericItemId
    ? item.genericItemId === task.genericItemId
    : (task.dataBaseItemId || task.dbItemId) && item.dbItemId === (task.dataBaseItemId || task.dbItemId));
  const matched = matches(planned);
  if (matched.length === 1) return matched[0];
  // Never guess between two rows for the same product or two supplier choices.
  if (matched.length > 1 || linked.length > 1) return null;
  const catalogMatches = matches(catalog);
  if (catalogMatches.length === 1) return catalogMatches[0];
  if (!task.genericItemId && !task.dataBaseItemId && !task.dbItemId && allowSoleProduct && planned.length === 1) return planned[0];
  return null;
};

export const productFieldsForTask = (product, materialId = product?.planMaterialId || "") => ({
  genericItemId: product?.genericItemId || "",
  dataBaseItemId: product?.dbItemId || product?.id || "",
  shoppingListItemId: materialId,
  shoppingListItemIds: materialId ? [materialId] : [],
});

// Reusing a plan row must not replace its quoted prices, quantity, purchasing,
// approval, or installation data. Many tasks can refer to the same physical item.
export const linkTaskToPlanProduct = (material, task) => ({
  linkedTaskId: material.linkedTaskId || task.id,
  linkedTaskName: material.linkedTaskId && material.linkedTaskId !== task.id ? material.linkedTaskName || "" : task.name || "",
  linkedTaskType: material.linkedTaskId && material.linkedTaskId !== task.id ? material.linkedTaskType || "" : task.type || "",
  linkedTaskIds: [...new Set([...productTaskIds(material), task.id])],
  prepKeys: [...new Set([...(material.prepKeys || []), `jobTask:${task.id}`])],
});

export const unlinkTaskFromPlanProduct = (material, taskId, tasks = []) => {
  const remaining = [...new Set([
    ...productTaskIds(material),
    ...tasks.filter((task) => taskProductIds(task).includes(planProductId(material))).map((task) => task.id),
  ])].filter((id) => id !== taskId);
  const primary = tasks.find((task) => task.id === remaining[0]);
  return { linkedTaskId: remaining[0] || "", linkedTaskIds: remaining,
    linkedTaskName: primary?.name || "", linkedTaskType: primary?.type || "",
    prepKeys: (material.prepKeys || []).filter((key) => key !== `jobTask:${taskId}`) };
};
