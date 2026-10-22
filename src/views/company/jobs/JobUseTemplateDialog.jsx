import React, { useEffect, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import Select from "react-select";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";

const countLabel = (count, label) => count != null ? `${count} ${label}${Number(count) === 1 ? "" : "s"}` : "";

export default function JobUseTemplateDialog({ open, companyId, busy, error, onClose, onApply }) {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("add");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!open || !companyId) return;
    let canceled = false;
    setSelected(null);
    setTemplates([]);
    setMode("add");
    setLoading(true);
    setLoadError("");
    getDocs(collection(db, "companies", companyId, "jobTemplates")).then((snapshot) => {
      if (canceled) return;
      setTemplates(snapshot.docs.map((snap) => ({ ...snap.data(), id: snap.id, value: snap.id, label: snap.data().name || "Untitled template" }))
        .filter((template) => template.isActive !== false && template.active !== false)
        .sort((a, b) => a.label.localeCompare(b.label)));
    }).catch(() => {
      if (!canceled) setLoadError("Could not load job templates. Close this popup and try again.");
    }).finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [open, companyId]);

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} className="relative z-50">
      <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
        <DialogPanel className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <DialogTitle className="text-lg font-bold text-slate-950">Use Template</DialogTitle>
              <p className="mt-1 text-sm text-slate-600">Fill the current plan with a saved job template.</p>
            </div>
            <button type="button" disabled={busy} onClick={onClose} aria-label="Close template picker" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 space-y-5 overflow-y-auto p-5">
            <div>
              <label htmlFor="existing-job-template" className="mb-2 block text-sm font-semibold text-slate-700">Job template</label>
              <Select inputId="existing-job-template" value={selected} options={templates} onChange={setSelected}
                isSearchable isLoading={loading} isDisabled={busy || loading || Boolean(loadError)}
                placeholder="Search job templates" noOptionsMessage={() => "No active job templates found"}
                menuPosition="fixed" styles={{ menu: (base) => ({ ...base, zIndex: 60 }) }} />
              {!loading && !loadError && !templates.length && <p className="mt-2 text-sm text-slate-500">No active job templates are available.</p>}
            </div>
            {selected && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-semibold text-slate-900">{selected.label}</p>
                {selected.description && <p className="mt-1 whitespace-pre-wrap text-slate-600">{selected.description}</p>}
                <p className="mt-2 text-xs text-slate-500">
                  {[countLabel(selected.laborLineCount, "service"), countLabel(selected.taskCount, "task"), countLabel(selected.plannedStopCount, "planned visit"), countLabel(selected.shoppingItemCount, "product")].filter(Boolean).join(" · ")}
                </p>
              </div>
            )}
            <fieldset disabled={busy} className="space-y-3">
              <legend className="mb-2 text-sm font-semibold text-slate-700">How should this template be used?</legend>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${mode === "add" ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                <input type="radio" name="template-mode" value="add" checked={mode === "add"} onChange={() => setMode("add")} className="mt-1 h-4 w-4" />
                <span><span className="block text-sm font-semibold text-slate-900">Add to Job</span><span className="mt-1 block text-xs text-slate-600">Keep the current scope and add the template's services, tasks, visits, and products.</span></span>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${mode === "overwrite" ? "border-rose-300 bg-rose-50" : "border-slate-200"}`}>
                <input type="radio" name="template-mode" value="overwrite" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} className="mt-1 h-4 w-4" />
                <span><span className="block text-sm font-semibold text-slate-900">Overwrite Planned Scope</span><span className="mt-1 block text-xs text-slate-600">Replace the current planned work and plan description. Completed or assigned work and purchased products are kept.</span></span>
              </label>
            </fieldset>
            <p className="text-xs text-slate-500">Customer/site details, actual work, and billing history stay in place. Changes to accepted plans create a new draft.</p>
            {(loadError || error) && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError || error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
            <button type="button" disabled={!selected || busy || loading || Boolean(loadError)} onClick={() => onApply(selected.id, mode)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Applying..." : mode === "overwrite" ? "Overwrite Planned Scope" : "Add to Job"}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
