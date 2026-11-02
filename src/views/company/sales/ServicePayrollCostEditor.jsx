import React from "react";
import ServicePayrollCostPreview from "./ServicePayrollCostPreview";
import ServicePriceSuggestion from "./ServicePriceSuggestion";

export default function ServicePayrollCostEditor({ costInput = "", onCostChange, costLabel = "Internal Cost", onUseSuggestedPrice, ...previewProps }) {
  return <section aria-label="Service internal cost" className="rounded-md border border-slate-200 bg-white p-3">
    <label className="block text-sm font-semibold text-slate-700">{costLabel}
      <input type="number" min="0" step="0.01" value={costInput} onChange={(event) => onCostChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900" />
    </label>
    {onUseSuggestedPrice && <ServicePriceSuggestion data={previewProps.data} costInput={costInput} onApply={onUseSuggestedPrice} />}
    <ServicePayrollCostPreview {...previewProps} costInput={costInput} />
  </section>;
}
