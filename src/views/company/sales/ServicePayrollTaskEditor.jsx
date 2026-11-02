import React from "react";
import { v4 as uuidv4 } from "uuid";
import useServicePayrollData from "../../../hooks/useServicePayrollData";
import { JOB_TASK_TYPE_NAMES } from "../../../utils/jobTaskTypes";
import { taskDefaultsFromPayItem, updateServiceTaskPayrollField } from "../../../utils/payroll/servicePayrollPreview";
import JobPayrollFields from "../jobs/JobPayrollFields";
import ServicePayrollCostPreview from "./ServicePayrollCostPreview";
import ServicePayrollCostEditor from "./ServicePayrollCostEditor";
import ServicePayTypeField from "./ServicePayTypeField";
import useJobProductCatalog from "../../../hooks/useJobProductCatalog";
import ServiceTaskProductFields from "../jobs/ServiceTaskProductFields";

export default function ServicePayrollTaskEditor({ companyId, form, setForm, showInternalCost = false }) {
  const isService = !["material", "product", "discount", "tax"].includes(form.type);
  const data = useServicePayrollData(companyId, isService);
  const productData = useJobProductCatalog(companyId, isService && (form.taskTemplates || []).some((task) => ["Install", "Replace"].includes(task.type)));
  if (!isService) return null;
  const tasks = form.taskTemplates || [];
  const updateTask = (id, field, value) => setForm((current) => ({ ...current, taskTemplates: (current.taskTemplates || []).map((task) => task.id === id
    ? updateServiceTaskPayrollField(task, field, value, data.payTypes, current.payTypeId) : task) }));
  const fieldClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900";
  const CostPreview = showInternalCost ? ServicePayrollCostEditor : ServicePayrollCostPreview;
  return <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <ServicePayTypeField value={form.payTypeId} payTypes={data.payTypes} loading={data.loading} onChange={(id) => {
        setForm((current) => {
          const item = data.payTypes.find((type) => type.id === id);
          const previous = data.payTypes.find((type) => type.id === current.payTypeId);
          return { ...current, payTypeId: id, name: current.name || item?.name || "", taskTemplates: (current.taskTemplates || []).map((task) => task.payTypeId ? task : taskDefaultsFromPayItem(task, item, previous)) };
        });
      }} />
    <CostPreview data={data} tasks={tasks} inheritedPayTypeId={form.payTypeId} priceInput={form.unitAmount} costInput={form.unitCost}
      {...(showInternalCost ? {
        onCostChange: (unitCost) => setForm((current) => ({ ...current, unitCost })),
        onUseSuggestedPrice: (cents) => setForm((current) => ({ ...current, unitAmount: (cents / 100).toFixed(2) })),
      } : {})}
      onUseHighCost={(cents) => setForm((current) => ({ ...current, unitCost: (cents / 100).toFixed(2) }))} />
    <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-800">Task Building Blocks</p>
      <button type="button" className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700" onClick={() => setForm((current) => ({ ...current, taskTemplates: [...(current.taskTemplates || []), taskDefaultsFromPayItem({ payrollMode: "included", id: `service_task_template_${uuidv4()}`, name: "", type: "General", description: "", estimatedMinutes: "", laborCost: "", billingLaborPrice: "" }, data.payTypes.find((type) => type.id === current.payTypeId))] }))}>Add Task</button>
    </div>
    {tasks.map((task, index) => <div key={task.id} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-500">Task {index + 1}</p><button type="button" className="text-xs font-semibold text-red-700" onClick={() => setForm((current) => ({ ...current, taskTemplates: current.taskTemplates.filter((item) => item.id !== task.id) }))}>Remove task {index + 1}</button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Task name<input className={fieldClass} value={task.name} onChange={(event) => updateTask(task.id, "name", event.target.value)} /></label>
        <label className="text-sm font-semibold text-slate-700">Task type<select className={fieldClass} value={task.type} onChange={(event) => updateTask(task.id, "type", event.target.value)}>{[...new Set([task.type, ...JOB_TASK_TYPE_NAMES])].filter(Boolean).map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Estimated minutes<input className={fieldClass} type="number" min="0" value={task.estimatedMinutes} onChange={(event) => updateTask(task.id, "estimatedMinutes", event.target.value)} /></label>
      </div>
      <label className="block text-sm font-semibold text-slate-700">Task notes<textarea className={fieldClass} value={task.description} onChange={(event) => updateTask(task.id, "description", event.target.value)} /></label>
      <ServiceTaskProductFields task={task} {...productData} onChange={(field, value) => updateTask(task.id, field, value)} />
      <JobPayrollFields value={task} payTypes={data.payTypes} inheritedPayTypeId={form.payTypeId} previewData={data} previewPrice={form.unitAmount}
        taskCostField={<label className="block text-sm font-semibold text-slate-700">Tech Labor Cost<input className={fieldClass} type="number" min="0" step="0.01" value={task.laborCost} onChange={(event) => updateTask(task.id, "laborCost", event.target.value)} /></label>}
        onChange={(field, value) => updateTask(task.id, field, value)} />
    </div>)}
  </div>;
}
