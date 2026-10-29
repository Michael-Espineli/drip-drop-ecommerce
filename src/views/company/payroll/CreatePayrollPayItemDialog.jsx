import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  buildCompanyPayType,
  emptyWorkTypeForm,
  rateTypeOptions,
  resolveStopPayCategories,
  stackBehaviorOptions,
  workCategoryOptions,
} from "../../../utils/payroll/payTypeSetup";

const optionLabel = (value) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (letter) => letter.toUpperCase());
const inputClassName = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

export default function CreatePayrollPayItemDialog({ companyId, userId, initialName = "", onClose, onCreated }) {
  const { requirePermission } = useCompanyPermissions();
  const [form, setForm] = useState(() => ({ ...emptyWorkTypeForm(), name: initialName }));
  const [buckets, setBuckets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    getDocs(collection(db, "companies", companyId, "companyStopPayBuckets")).then((snapshot) => {
      if (canceled) return;
      const options = resolveStopPayCategories(snapshot.docs.map((row) => ({ ...row.data(), id: row.id })));
      setBuckets(options);
      setForm((current) => {
        const bucket = options.find((option) => option.id === current.stopPayCategoryId) || options[0];
        return bucket ? { ...current, stopPayCategoryId: bucket.id, category: bucket.defaultWorkCategory, defaultRateType: bucket.defaultRateType } : current;
      });
    }).catch(() => {
      if (!canceled) setLoadError("Could not load payroll setup. Close this popup and try again.");
    }).finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [companyId]);

  const updateField = (field, value) => {
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (savingRef.current || loading || loadError || !companyId || !requirePermission("424", "create payroll pay items")) return;
    const name = form.name.trim();
    if (!name) return setError("Add a payroll pay item name.");
    const bucket = buckets.find((option) => option.id === form.stopPayCategoryId);
    if (!bucket) return setError("Select a stop bucket.");

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const snapshot = await getDocs(collection(db, "companies", companyId, "companyPayTypes"));
      const payItems = snapshot.docs.map((row) => ({ ...row.data(), id: row.id }));
      if (payItems.some((item) => item.isActive !== false && item.active !== false && String(item.name || "").trim().toLowerCase() === name.toLowerCase())) {
        setError(`A payroll pay item named ${name} already exists. Select it from the picker.`);
        return;
      }
      const payload = buildCompanyPayType({
        id: `comp_work_type_${uuidv4()}`,
        companyId,
        form: { ...form, name },
        bucket,
        sortOrder: payItems.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), 0) + 10,
        userId,
      });
      await setDoc(doc(db, "companies", companyId, "companyPayTypes", payload.id), payload, { merge: true });
      onCreated(payload);
    } catch (err) {
      setError("Could not create the payroll pay item. Your service draft is still open. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={() => !saving && onClose()} className="relative z-[60]">
      <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
        <DialogPanel className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
          <form onSubmit={save}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <DialogTitle className="text-lg font-bold text-slate-950">Create payroll pay item</DialogTitle>
                <p className="mt-1 text-sm text-slate-500">Save a company pay item and use it for this service. Technician rates are configured in Payroll Setup.</p>
              </div>
              <button type="button" onClick={onClose} disabled={saving} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-600 disabled:opacity-50">Close</button>
            </div>
            <fieldset disabled={loading || saving || Boolean(loadError)} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                Name
                <input value={form.name} onChange={(event) => updateField("name", event.target.value)} className={inputClassName} placeholder="Filter cleaning" autoFocus required />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Stop bucket
                <select value={form.stopPayCategoryId} onChange={(event) => {
                  const bucket = buckets.find((option) => option.id === event.target.value);
                  setForm((current) => ({ ...current, stopPayCategoryId: bucket.id, category: bucket.defaultWorkCategory, defaultRateType: bucket.defaultRateType, iconName: "" }));
                  setError("");
                }} className={inputClassName}>
                  {buckets.map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.label}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Pay category
                <select value={form.category} onChange={(event) => updateField("category", event.target.value)} className={inputClassName}>
                  {workCategoryOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Rate type
                <select value={form.defaultRateType} onChange={(event) => updateField("defaultRateType", event.target.value)} className={inputClassName}>
                  {rateTypeOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Stack
                <select value={form.defaultStackBehavior} onChange={(event) => updateField("defaultStackBehavior", event.target.value)} className={inputClassName}>
                  {stackBehaviorOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
                </select>
              </label>
            </fieldset>
            {loading && <p role="status" className="mt-3 text-sm text-slate-500">Loading payroll setup...</p>}
            {(loadError || error) && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError || error}</p>}
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={loading || saving || Boolean(loadError) || !form.name.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Creating..." : "Create & select"}</button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
