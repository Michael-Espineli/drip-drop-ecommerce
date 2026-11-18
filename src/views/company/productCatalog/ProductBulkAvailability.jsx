import React, { useContext, useEffect, useRef, useState } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";
import { PRODUCT_AVAILABILITY_FIELDS, updateProductAvailability } from "../../../utils/productAvailability";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";

export default function ProductBulkAvailability({ productIds, onSaved, onClose }) {
  const { recentlySelectedCompany: companyId } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const [changes, setChanges] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const scope = useRef(companyId);
  const currentCompany = useRef(companyId);
  currentCompany.current = companyId;
  const dialog = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus(); };
  }, []);
  const save = async (event) => {
    event.preventDefault();
    if (saving || companyId !== scope.current || !requirePermission("854", "update product availability")) return;
    setSaving(true);
    setError("");
    try {
      const patch = await updateProductAvailability({ db, companyId, productIds, changes });
      if (mounted.current && currentCompany.current === scope.current) onSaved(patch);
    } catch (failure) {
      if (mounted.current && currentCompany.current === scope.current) setError(userFacingErrorMessage(failure, "Could not update product availability."));
    } finally { if (mounted.current && currentCompany.current === scope.current) setSaving(false); }
  };
  const handleKeyDown = (event) => {
    if (event.key === "Escape") { event.stopPropagation(); if (!saving) onClose(); }
    if (event.key === "Tab") {
      const fields = [...dialog.current.querySelectorAll("button:not(:disabled), select:not(:disabled)")];
      const first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6" onKeyDown={handleKeyDown}>
    <form ref={dialog} role="dialog" aria-modal="true" aria-labelledby="bulk-availability-title" onSubmit={save} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="border-b border-slate-200 p-5">
        <h2 id="bulk-availability-title" className="text-lg font-bold text-slate-950">Bulk Edit Availability</h2>
        <p className="mt-2 text-sm text-slate-500">Apply changes to {productIds.length} selected product{productIds.length === 1 ? "" : "s"}. Choose which settings to update.</p>
      </div>
      <div className="space-y-4 p-5">
        {PRODUCT_AVAILABILITY_FIELDS.map((field, index) => <label key={field.id} htmlFor={`bulk-availability-${field.id}`} className="block text-sm font-semibold text-slate-700">
          {field.label}
          <select id={`bulk-availability-${field.id}`} autoFocus={index === 0} disabled={saving} value={changes[field.id] || "keep"} onChange={(event) => setChanges((current) => ({ ...current, [field.id]: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2">
            <option value="keep">Keep current</option>
            <option value="yes">{field.id === "active" ? "Active" : "Available"}</option>
            <option value="no">{field.id === "active" ? "Inactive" : "Not available"}</option>
          </select>
        </label>)}
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-5">
        <button type="button" disabled={saving} onClick={onClose} className={workspaceButtonClass({ tone: "slate" })}>Cancel</button>
        <button type="submit" disabled={saving || !can("854") || !Object.values(changes).some((value) => value !== "keep")} className={workspaceButtonClass({ tone: "blue" })}>{saving ? "Saving..." : `Apply to ${productIds.length} product${productIds.length === 1 ? "" : "s"}`}</button>
      </div>
    </form>
  </div>;
}
