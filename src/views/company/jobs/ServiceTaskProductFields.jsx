import React from "react";
import { taskTypeRequiresInstallItem } from "../../../utils/jobTaskTypes";
import { buildTaskProductOptions, findTaskProduct } from "../../../utils/jobPlanProducts";
import JobTaskProductPicker from "./JobTaskProductPicker";

export default function ServiceTaskProductFields({ task, onChange, products = [], databaseItems = [], materials = [], loading, error }) {
  if (!taskTypeRequiresInstallItem(task.type || task.taskType)) return null;
  const options = buildTaskProductOptions({ materials, products, databaseItems, equipmentOnly: true });
  const selected = findTaskProduct(task, options);
  return <div className="mt-3 space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
    {loading ? <p role="status" className="text-xs text-slate-600">Loading products…</p> : error ? <p role="alert" className="text-xs text-amber-700">{error}</p>
      : <JobTaskProductPicker options={options} value={selected} quantity={task.productQuantity || "1"}
        onQuantityChange={(quantity) => onChange("productQuantity", quantity)}
        onChange={(product) => { onChange("genericItemId", product?.genericItemId || ""); onChange("dataBaseItemId", product?.dbItemId || ""); }} />}
    <p className="text-xs text-slate-600">The service remembers this product requirement. Existing plan products are reused; missing products are added to the plan. Product pricing stays in Products.</p>
  </div>;
}
