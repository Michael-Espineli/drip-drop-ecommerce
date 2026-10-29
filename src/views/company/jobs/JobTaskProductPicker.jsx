import React from "react";

export default function JobTaskProductPicker({ options, value, onChange, quantity, onQuantityChange }) {
  const all = [...options.planned, ...options.catalog];
  const availableCatalog = options.catalog.filter((item) => !options.planned.some((planned) => item.genericItemId
    ? planned.genericItemId === item.genericItemId : item.dbItemId && planned.dbItemId === item.dbItemId));
  return <div className="space-y-2 md:col-span-2">
    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Product for this task
      <select className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm font-medium normal-case tracking-normal text-slate-800"
        value={value?.value || ""} onChange={(event) => onChange(all.find((item) => item.value === event.target.value) || null)}>
        <option value="">Select a product</option>
        <optgroup label="Products already on this plan">{options.planned.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup>
        <optgroup label="Add a product from the catalog">{availableCatalog.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup>
      </select>
    </label>
    {value?.planMaterialId ? <p className="text-xs text-emerald-700">Connected to the plan product. Its quantity and quoted price are managed in Products.</p>
      : <p className="text-xs text-slate-500">Choosing a catalog product adds it to Products when you save this task.</p>}
    {value && !value.dbItemId && <p role="alert" className="text-xs text-amber-700">This product needs a linked database item before it can be used for installation. Connect it in Products first.</p>}
    {value?.dbItemId && <p className="text-xs text-slate-500">Database item connected{[value.equipmentMake || value.make, value.equipmentModel || value.model].filter(Boolean).length ? ` · ${[value.equipmentMake || value.make, value.equipmentModel || value.model].filter(Boolean).join(" ")}` : ""}</p>}
    {!value?.planMaterialId && onQuantityChange && <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Product quantity
      <input type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-medium normal-case tracking-normal text-slate-800" />
    </label>}
  </div>;
}
