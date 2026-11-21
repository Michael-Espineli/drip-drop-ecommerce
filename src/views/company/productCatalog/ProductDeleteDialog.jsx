import React, { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { getProductDisplayName, getVendorItemDisplayName } from "../../../utils/productCatalog";

export default function ProductDeleteDialog({ product, vendorItems, busy, onClose, onDelete }) {
  const [selected, setSelected] = useState([]);
  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="relative z-[70]">
    <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
      <DialogPanel className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div>
          <DialogTitle className="text-lg font-bold text-slate-950">Delete product</DialogTitle>
          <p className="mt-1 text-sm text-slate-600">Permanently delete <strong>{getProductDisplayName(product)}</strong>?</p>
        </div>
        {vendorItems.length > 0 && <fieldset disabled={busy} className="space-y-2">
          <legend className="text-sm font-semibold text-slate-900">Also delete vendor items</legend>
          <p className="text-sm text-slate-600">Unchecked vendor items will be kept and disconnected from this product.</p>
          <ul className="max-h-56 divide-y overflow-y-auto rounded-md border border-slate-200 px-3">
            {vendorItems.map(item => <li key={item.id}>
              <label className="flex items-start gap-3 py-2 text-sm">
                <input type="checkbox" className="mt-1 rounded border-slate-300"
                  disabled={Boolean(item.mergedSourceIds?.length)} checked={selected.includes(item.id)}
                  onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
                <span>
                  <span className="block font-semibold">{getVendorItemDisplayName(item)}</span>
                  <span className="block text-slate-600">{[item.storeName || item.vendorName, item.sku].filter(Boolean).join(" · ")}</span>
                  {Boolean(item.mergedSourceIds?.length) && <span className="block text-slate-600">Kept for merge history</span>}
                </span>
              </label>
            </li>)}
          </ul>
        </fieldset>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" className={workspaceButtonClass({ tone: "slate" })} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={workspaceButtonClass({ tone: "rose" })} disabled={busy} onClick={() => onDelete(selected)}>
            {busy ? "Deleting…" : selected.length ? `Delete product and ${selected.length} vendor ${selected.length === 1 ? "item" : "items"}` : "Delete product"}
          </button>
        </div>
      </DialogPanel>
    </div>
  </Dialog>;
}
