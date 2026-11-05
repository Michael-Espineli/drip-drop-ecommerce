import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import "./JobTemplateTheme.css";
import React, { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import Select from "react-select";
import { ISSUE_PRIORITY_OPTIONS } from "../../../utils/models/JobPlan";
import { JOB_TASK_TYPE_NAMES } from "../../../utils/jobTaskTypes";
import { jobLaborTotals } from "../../../utils/jobScopePricing";
import {
  addServiceToTemplateDraft, emptyJobTemplateScope, newTemplateTask, newTemplateVisit,
  removeTemplateDraftItem, templateDraftProduct,
} from "../../../utils/jobTemplateDraft";

const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
const amount = (value) => Math.round(Number(value) * 100);

function Field({ label, children, helper }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}{children}{helper && <span className="mt-1 block text-xs font-normal text-slate-500">{helper}</span>}</label>;
}

function ScopeSection({ title, helper, action, children }) {
  return <section className="space-y-3 rounded-xl border border-slate-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-500">{helper}</p></div>{action}</div>
    {children}
  </section>;
}

export default function JobTemplateDialog({ mode, form, setForm, services, products, payTypes, loadingCatalogs, saving, deleting, error, onSave, onClose, onDelete }) {
  const [scope, setScope] = useState(emptyJobTemplateScope);
  const [draftError, setDraftError] = useState("");
  const isCreate = mode === "create";
  const busy = saving || deleting;
  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateItem = (type, itemId, patch) => setScope((current) => ({ ...current, [type]: current[type].map((item) => item.id === itemId ? { ...item, ...patch } : item) }));
  const remove = (type, itemId) => setScope((current) => removeTemplateDraftItem(current, type, itemId));
  const removeButton = (type, item) => <button type="button" onClick={() => remove(type, item.id)} aria-label={`Remove ${item.name || (type === "tasks" ? "task" : "visit")}`} className="text-sm font-semibold text-red-700 hover:text-red-900">Remove</button>;
  const taskChoices = (selected, onChange) => scope.tasks.length ? <div className="mt-2 flex flex-wrap gap-2">{scope.tasks.map((task) => <label key={task.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700">
    <input type="checkbox" checked={selected.includes(task.id)} onChange={(event) => onChange(event.target.checked ? [...selected, task.id] : selected.filter((value) => value !== task.id))} />{task.name || "Unnamed task"}
  </label>)}</div> : <p className="text-xs text-slate-500">Add tasks above to include them in this visit.</p>;
  const labor = jobLaborTotals(scope);
  const price = labor.priceCents + scope.shoppingItems.reduce((total, item) => total + Number(item.quantity || 0) * item.plannedUnitPriceCents, 0);
  const hasScopePrice = scope.laborLineItems.length || price !== 0;

  return <Dialog open onClose={() => !busy && onClose()} className="job-template-theme relative z-50">
    <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
    <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
      <DialogPanel className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <form onSubmit={(event) => onSave(event, isCreate ? scope : null)} className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
            <div><DialogTitle className="text-xl font-bold text-slate-950">{isCreate ? "New Job Template" : "Edit Job Template"}</DialogTitle>
              <p className="mt-1 text-sm text-slate-500">{isCreate ? "Build the reusable scope now. Everything saves together when you create the template." : "Update the template details and availability."}</p></div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close template editor" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50">Close</button>
          </div>
          <fieldset disabled={busy} className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <section className="space-y-4">
              <Field label="Template name"><input autoFocus required value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="e.g. Cartridge filter cleaning" className={input} /></Field>
              <Field label="Scope description" helper="Describe the work that should be copied into each new job."><textarea rows={2} value={form.description} onChange={(event) => updateForm("description", event.target.value)} className={input} /></Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Default job priority"><select value={form.defaultIssuePriorityLevel} onChange={(event) => updateForm("defaultIssuePriorityLevel", Number(event.target.value))} className={input}>{ISSUE_PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                <Field label="Fallback customer price" helper="Starting price for a template with no priced scope."><input type="number" min="0" step="0.01" value={form.defaultRate} onChange={(event) => updateForm("defaultRate", event.target.value)} className={input} /></Field>
                <Field label="Fallback labor cost" helper="Internal labor estimate, separate from the customer price."><input type="number" min="0" step="0.01" value={form.defaultLaborCost} onChange={(event) => updateForm("defaultLaborCost", event.target.value)} className={input} /></Field>
              </div>
            </section>

            {isCreate && <>
              <ScopeSection title="Services" helper="Add catalog services with their included tasks and pricing.">
                <Select classNamePrefix="template-select" aria-label="Add a catalog service" value={null} options={services.map((service) => ({ ...service, value: service.id, label: `${service.name} · ${money(service.unitAmountCents)}` }))} isLoading={loadingCatalogs} isDisabled={loadingCatalogs || busy}
                  placeholder="Search services to add…" noOptionsMessage={() => "No available services"}
                  onChange={(service) => { try { setScope(addServiceToTemplateDraft(scope, service, products)); setDraftError(""); } catch (failure) { setDraftError(userFacingErrorMessage(failure, failure.message)); } }} menuPosition="fixed" styles={{ menuPortal: (base) => ({ ...base, zIndex: 70 }) }} />
                {scope.laborLineItems.map((line) => <div key={line.id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{line.name}</p><p className="text-xs text-slate-500">{line.quantity} × {money(line.unitPriceCents)} · {line.taskTemplateIds.length} included tasks</p></div>{removeButton("laborLineItems", line)}</div>
                  <div className="mt-2"><span className="text-xs font-semibold text-slate-600">Included tasks</span>{taskChoices(line.taskTemplateIds, (taskIds) => updateItem("laborLineItems", line.id, { taskTemplateIds: taskIds, taskIds, laborLineTaskIds: taskIds }))}</div>
                </div>)}
              </ScopeSection>

              <ScopeSection title="Tasks" helper="Add or refine the technician’s work steps. Service tasks are included here."
                action={<button type="button" onClick={() => setScope((current) => ({ ...current, tasks: [...current.tasks, newTemplateTask()] }))} className="text-sm font-semibold text-blue-700">+ Add task</button>}>
                {!scope.tasks.length && <p className="text-sm text-slate-500">No tasks yet. Add a service or a custom task.</p>}
                {scope.tasks.map((task, index) => <div key={task.id} className="space-y-3 rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase text-slate-500">Task {index + 1}</span>{removeButton("tasks", task)}</div>
                  <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                    <Field label={`Task ${index + 1} name`}><input required value={task.name} onChange={(event) => updateItem("tasks", task.id, { name: event.target.value })} className={input} /></Field>
                    <Field label={`Task ${index + 1} type`}><select value={task.type} onChange={(event) => updateItem("tasks", task.id, { type: event.target.value })} className={input}>{JOB_TASK_TYPE_NAMES.map((type) => <option key={type}>{type}</option>)}</select></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={`Task ${index + 1} minutes`}><input type="number" min="0" value={task.estimatedTime} onChange={(event) => updateItem("tasks", task.id, { estimatedTime: Number(event.target.value) })} className={input} /></Field>
                    <Field label={`Task ${index + 1} customer price`} helper="Included tasks use their service’s price."><input type="number" min="0" step="0.01" value={task.billingLaborPriceCents / 100} onChange={(event) => updateItem("tasks", task.id, { billingLaborPriceCents: amount(event.target.value) })} className={input} /></Field>
                    <Field label={`Task ${index + 1} notes`}><input value={task.description} onChange={(event) => updateItem("tasks", task.id, { description: event.target.value })} className={input} /></Field>
                  </div>
                </div>)}
              </ScopeSection>

              <ScopeSection title="Planned visits" helper="Group tasks into visits. Dates and technicians are chosen when creating a job."
                action={<button type="button" onClick={() => setScope((current) => ({ ...current, plannedServiceStops: [...current.plannedServiceStops, newTemplateVisit()] }))} className="text-sm font-semibold text-blue-700">+ Add visit</button>}>
                {!scope.plannedServiceStops.length && <p className="text-sm text-slate-500">No planned visits yet. Create and Schedule Job can still schedule a first visit.</p>}
                {scope.plannedServiceStops.map((stop, index) => <div key={stop.id} className="space-y-3 rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase text-slate-500">Visit {index + 1}</span>{removeButton("plannedServiceStops", stop)}</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={`Visit ${index + 1} name`}><input required value={stop.name} onChange={(event) => updateItem("plannedServiceStops", stop.id, { name: event.target.value })} className={input} /></Field>
                    <Field label={`Visit ${index + 1} minutes`}><input type="number" min="1" value={stop.estimatedMinutes} onChange={(event) => updateItem("plannedServiceStops", stop.id, { estimatedMinutes: Number(event.target.value) })} className={input} /></Field>
                    <Field label={`Visit ${index + 1} work type`}><select className={input} value={stop.serviceStopTypeId} onChange={(event) => { const type = payTypes.find((item) => item.id === event.target.value); updateItem("plannedServiceStops", stop.id, { serviceStopTypeId: type?.id || "", serviceStopTypeName: type?.name || "", payTypeId: type?.id || "" }); }}><option value="">Job visit</option>{payTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">Tasks for this visit</span>{taskChoices(stop.taskTemplateIds, (taskTemplateIds) => updateItem("plannedServiceStops", stop.id, { taskTemplateIds }))}
                </div>)}
              </ScopeSection>

              <ScopeSection title="Products" helper="Choose products for purchasing and customer billing. Service requirements are added automatically.">
                <Select classNamePrefix="template-select" aria-label="Add a catalog product" value={null} options={products.map((product) => ({ ...product, value: product.id, label: product.name || product.label }))} isLoading={loadingCatalogs} isDisabled={loadingCatalogs || busy} placeholder="Search products to add…" noOptionsMessage={() => "No available products"}
                  onChange={(product) => setScope((current) => ({ ...current, shoppingItems: [...current.shoppingItems, templateDraftProduct(product)] }))} menuPosition="fixed" styles={{ menuPortal: (base) => ({ ...base, zIndex: 70 }) }} />
                {scope.shoppingItems.map((product, index) => <div key={product.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3"><div className="min-w-32 flex-1"><p className="text-sm font-semibold">{product.name}</p><p className="text-xs text-slate-500">{money(product.plannedUnitPriceCents)} each</p></div><div className="w-24"><Field label={`Product ${index + 1} quantity`}><input type="number" min="0.01" step="any" value={product.quantity} onChange={(event) => updateItem("shoppingItems", product.id, { quantity: event.target.value })} className={input} /></Field></div>{removeButton("shoppingItems", product)}</div>)}
              </ScopeSection>
            </>}

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="font-bold text-slate-900">Availability</h3>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => updateForm("isActive", event.target.checked)} className="mt-1" /><span><span className="block font-semibold">Active template</span><span className="text-slate-500">Available for new jobs. Turn off to keep it in the library without offering it for new work.</span></span></label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.technicianCanAdd} onChange={(event) => updateForm("technicianCanAdd", event.target.checked)} className="mt-1" /><span><span className="block font-semibold">Available to Technicians</span><span className="text-slate-500">Allow technicians with the required permission to create and schedule jobs from this template.</span></span></label>
              {!form.isActive && form.technicianCanAdd && <p className="text-xs text-amber-700">Technicians can use this template once it is active again.</p>}
              {!isCreate && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.locked} onChange={(event) => updateForm("locked", event.target.checked)} className="mt-1" /><span><span className="block font-semibold">Mark as locked</span><span className="text-slate-500">A reminder to review changes carefully. This marker does not restrict editing permissions.</span></span></label>}
            </section>
          </fieldset>
          {(draftError || error) && <p role="alert" className="shrink-0 border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{draftError || error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
            {isCreate ? <div className="text-sm"><p className="font-semibold text-slate-900">Template price: {money(hasScopePrice ? price : amount(form.defaultRate))}</p><p className="text-xs text-slate-500">{scope.laborLineItems.length} services · {scope.tasks.length} tasks · {scope.plannedServiceStops.length} visits · {scope.shoppingItems.length} products</p></div> : <button type="button" disabled={busy} onClick={onDelete} className="text-sm font-semibold text-red-700">Delete Template</button>}
            <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button><button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving…" : isCreate ? "Create Template" : "Save Template"}</button></div>
          </div>
        </form>
      </DialogPanel>
    </div>
  </Dialog>;
}
