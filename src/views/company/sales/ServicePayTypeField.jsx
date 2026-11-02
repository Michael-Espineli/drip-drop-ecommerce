import React from "react";

export default function ServicePayTypeField({ value = "", payTypes = [], onChange, loading = false }) {
  const active = payTypes.filter((type) => type.active !== false && type.isActive !== false && !type.archived);
  const selected = payTypes.find((type) => type.id === value);
  return <div>
    <label className="block text-sm font-semibold text-slate-700">Technician pay type
      <select value={value} disabled={loading} onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900">
        <option value="">No service-level pay type</option>
        {value && !active.some((type) => type.id === value) && <option value={value}>{selected?.name || value} (unavailable)</option>}
        {active.map((type) => <option key={type.id} value={type.id}>{type.name || type.id}</option>)}
      </select>
    </label>
    <p className="mt-1 text-xs font-normal text-slate-500">Sets the service-level technician pay and the default pay type for its tasks. Included tasks do not add a second payment. Apply the estimate below to update internal cost.</p>
  </div>;
}
