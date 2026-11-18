import React from "react";

const fields = [
  { key: "active", label: "Active", description: "Shown in catalog pickers." },
  { key: "availableForJobs", label: "Jobs", description: "Selectable for job materials and work orders." },
  { key: "availableForPartApproval", label: "Part Approval Sales", description: "Sell directly to customers without a job." },
  { key: "availableForPartPurchase", label: "Part Purchase", description: "Selectable for purchasing." },
];

export default function ProductAvailabilityFields({ value, onChange, className, disabled }) {
  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="mb-2 text-sm font-bold text-slate-900">Availability</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map(({ key, label, description }) => (
          <label key={key} className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={value?.[key] ?? true}
              onChange={(event) => onChange({ [key]: event.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              aria-label={label}
            />
            <span>
              <span className="block font-semibold text-slate-900">{label}</span>
              <span className="block text-xs text-slate-600">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ProductAvailabilityDisclosure({ label = "Product Availability", ...props }) {
  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-white p-2">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{label}</summary>
      <ProductAvailabilityFields className="mt-2" {...props} />
    </details>
  );
}
