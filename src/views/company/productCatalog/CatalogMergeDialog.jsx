import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../utils/config";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { catalogRecordMatches, catalogRecordName, loadMergeRecords } from "./catalogMergeRecords";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fieldClass = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const secondary = workspaceButtonClass({ tone: "slate" });
const primary = workspaceButtonClass({ tone: "blue" });

function RecordPicker({ label, kind, records, value, onChange, exclude }) {
  const [search, setSearch] = useState("");
  const options = useMemo(() => {
    const selected = records.find(record => record.id === value);
    const matches = records.filter(record => record.id !== exclude && catalogRecordMatches(kind, record, search)).slice(0, 80);
    if (selected && !matches.includes(selected)) matches.unshift(selected);
    return matches;
  }, [records, kind, search, exclude, value]);

  return <div className="space-y-2">
    <label className="block text-sm font-semibold">
      Search for {label.toLowerCase()}
      <input value={search} onChange={event => setSearch(event.target.value)}
        className={`mt-1 ${fieldClass}`} placeholder="Name, SKU, vendor, or ID" />
    </label>
    <label className="block text-sm font-semibold">
      {label}
      <select className={`mt-1 ${fieldClass}`} value={value} onChange={event => onChange(event.target.value)}>
        <option value="">Choose a record</option>
        {options.map(row => <option key={row.id} value={row.id}>
          {[catalogRecordName(kind, row), row.storeName || row.vendorName, row.sku, row.UOM || row.uom, row.size, row.id].filter(Boolean).join(" · ")}
        </option>)}
      </select>
    </label>
  </div>;
}

function RecordSummary({ record, label, kind }) {
  const fields = [
    ["SKU", record.sku], ["Unit", record.unit], ["Size", record.size],
    ...(kind === "vendorItem" ? [["Supplier", record.supplier]] : []),
    ["Status", record.active ? "Active" : "Inactive"],
    [kind === "product" ? "Sell price" : "Unit cost", money.format(record.priceCents / 100)],
    ["Record ID", record.id],
  ];
  return <section className="rounded-lg border border-slate-200 p-4">
    <h3 className="text-sm font-semibold text-slate-600">{label}</h3>
    <p className="mt-1 break-words text-lg font-bold text-slate-950">{record.name}</p>
    <dl className="mt-3 space-y-1 text-sm">
      {fields.map(([key, value]) => <div key={key} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
        <dt className="text-slate-500">{key}</dt><dd className="break-words">{value || "—"}</dd>
      </div>)}
    </dl>
  </section>;
}

export default function CatalogMergeDialog({ kind, companyId, initialKeepId = "", initialSourceId = "", onClose, onMerged }) {
  const [records, setRecords] = useState(null);
  const [keepId, setKeepId] = useState(initialKeepId);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    loadMergeRecords(companyId, kind).then(rows => {
      if (current) setRecords(rows);
    }).catch(failure => {
      if (current) setError(userFacingErrorMessage(failure, "Could not load catalog records."));
    });
    return () => { current = false; };
  }, [kind, companyId, reload]);

  const submit = async action => {
    if (busy) return;
    setBusy(action);
    setError("");
    try {
      const callable = httpsCallable(functions, "mergeCatalogDuplicates");
      const { data } = await callable({
        action, companyId, kind, keepId, sourceId, ...(preview && { reviewToken: preview.reviewToken }),
      });
      if (action === "preview") setPreview(data);
      else onMerged(data.keepId);
    } catch (failure) {
      if (failure.code === "functions/aborted" || failure.code === "functions/failed-precondition") setPreview(null);
      const knownError = ["functions/aborted", "functions/failed-precondition", "functions/not-found", "functions/invalid-argument"].includes(failure.code);
      setError(userFacingErrorMessage(failure, knownError ? failure.message : "Could not complete the catalog merge."));
    } finally {
      setBusy("");
    }
  };

  const ready = records?.some(row => row.id === keepId) && records.some(row => row.id === sourceId) && keepId !== sourceId;
  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="relative z-[70]">
    <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
    <div className="fixed inset-0 overflow-y-auto p-4">
      <div className="flex min-h-full items-center justify-center">
        <DialogPanel className="w-full max-w-2xl space-y-5 rounded-xl bg-white p-5 shadow-xl sm:p-6">
          <div>
            <DialogTitle className="text-xl font-bold text-slate-950">Merge {kind === "product" ? "products" : "vendor items"}</DialogTitle>
            <p className="mt-1 text-sm text-slate-600">Choose the record to keep. The duplicate will be archived and its catalog links will move to the keeper.</p>
          </div>
          {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          {preview ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <RecordSummary record={preview.keep} label="Keep in catalog" kind={kind} />
              <RecordSummary record={preview.source} label="Archive as duplicate" kind={kind} />
            </div>
            <div className="space-y-1 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
              {kind === "product" ? <>
                <p>Vendor items to link to the keeper <strong>{preview.summary.vendorItemsToMove}</strong></p>
                {preview.summary.preferredVendorItem && <p>Preferred vendor item <strong>{preview.summary.preferredVendorItem}</strong></p>}
              </> : <>
                {preview.summary.connectedProduct && <p>Connected product <strong>{preview.summary.connectedProduct}</strong></p>}
                <p>Dosage templates to update <strong>{preview.summary.dosageTemplates}</strong></p>
              </>}
              <p>Past purchases, estimates, jobs, and invoices retain their original records.</p>
            </div>
          </> : records ? <fieldset disabled={Boolean(busy)} className="space-y-4">
            <RecordPicker label="Record to keep" kind={kind} records={records} value={keepId} exclude={sourceId} onChange={setKeepId} />
            <RecordPicker label="Duplicate to archive" kind={kind} records={records} value={sourceId} exclude={keepId} onChange={setSourceId} />
            {keepId && sourceId && <button type="button" className={secondary} onClick={() => { setKeepId(sourceId); setSourceId(keepId); setError(""); }}>Swap records</button>}
          </fieldset> : error ? <button type="button" className={secondary} onClick={() => { setError(""); setReload(value => value + 1); }}>Retry</button>
            : <p role="status" className="text-sm text-slate-600">Loading catalog records…</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" className={secondary} disabled={Boolean(busy)} onClick={onClose}>Cancel</button>
            {preview ? <>
              <button type="button" className={secondary} disabled={Boolean(busy)} onClick={() => { setPreview(null); setError(""); }}>Change selection</button>
              <button type="button" className={primary} disabled={Boolean(busy)} onClick={() => submit("merge")}>{busy ? "Merging…" : "Confirm merge"}</button>
            </> : <button type="button" className={primary} disabled={!ready || Boolean(busy)} onClick={() => submit("preview")}>{busy ? "Checking links…" : "Review merge"}</button>}
          </div>
        </DialogPanel>
      </div>
    </div>
  </Dialog>;
}
