import React from "react";
import { normalizeLaborMultiplier, suggestedLaborPriceCents } from "../../../utils/laborPricing";
import { moneyInputCents } from "../../../utils/payroll/servicePayrollPreview";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function ServicePriceSuggestion({ data, costInput, onApply }) {
  if (data?.companySettingsLoading) return <p role="status" className="mt-3 text-xs text-slate-500">Loading company labor multiplier...</p>;
  if (data?.companySettingsError) return <p role="alert" className="mt-3 text-xs text-amber-800">The company labor multiplier could not be loaded. Customer price is still editable.</p>;
  const multiplier = normalizeLaborMultiplier(data?.companySettings?.laborMultiplier);
  const cost = moneyInputCents(costInput);
  const suggestion = suggestedLaborPriceCents(cost, multiplier);
  return <section aria-label="Suggested customer price" className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
    <p className="font-semibold text-slate-900">Suggested customer price{suggestion !== null ? `: ${money(suggestion)}` : ""}</p>
    <p className="text-xs text-slate-600">{suggestion !== null ? `${money(cost)} internal labor cost × ${multiplier} = ${money(suggestion)}` : `Enter an internal cost to suggest a customer price using the company’s ${multiplier}× labor multiplier.`}</p>
    <button type="button" disabled={suggestion === null} onClick={() => onApply(suggestion)}
      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">Use suggested customer price</button>
  </section>;
}
