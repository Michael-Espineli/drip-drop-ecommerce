import React from "react";
import { estimateServicePayroll, moneyInputCents } from "../../../utils/payroll/servicePayrollPreview";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const range = (low, high) => `${money(low)} – ${money(high)}`;
const rateLabel = (rate) => {
  if (rate.rateType === "percentage") return `${rate.minAmountCents / 100}% – ${rate.maxAmountCents / 100}%`;
  const unit = { hourly: "hour", flatPerTask: "task", flatPerStop: "visit", perBodyOfWater: "body of water", perServiceLocation: "location" }[rate.rateType] || "item";
  return `${range(rate.minAmountCents, rate.maxAmountCents)} / ${unit}`;
};

export default function ServicePayrollCostPreview({ data, tasks = [], inheritedPayTypeId = "", priceInput = "", costInput = "", onUseHighCost, compact = false, scopeLabel = "Per service unit" }) {
  if (!data) return null;
  if (data.loading) return <p role="status" className="mt-3 text-xs text-slate-500">Loading technician pay preview...</p>;
  if (data.error) return <p role="alert" className="mt-3 text-xs text-amber-800">{data.error}</p>;
  const includeServiceStopPay = !compact && Boolean(inheritedPayTypeId);
  const estimate = estimateServicePayroll({ ...data, tasks, inheritedPayTypeId, customerPriceCents: moneyInputCents(priceInput), includeServiceStopPay });
  const available = estimate.minAmountCents !== null;
  const price = moneyInputCents(priceInput);
  const cost = moneyInputCents(costInput);
  return (
    <section aria-label={compact ? "Task technician pay preview" : "Service technician pay preview"} className="mt-3 space-y-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 text-sm font-normal normal-case tracking-normal">
      <p className="font-semibold text-slate-900">{compact ? "Task pay preview" : "Technician labor estimate"}</p>
      {!compact && <p className="text-xs text-slate-500">{scopeLabel}</p>}
      {estimate.disabled ? <p className="text-xs text-slate-600">Payroll is disabled for this company. No automatic technician pay is being estimated.</p> : <>
        {!estimate.hasScope ? <p className="text-xs text-slate-600">Select a payroll pay item or add tasks to preview technician pay.</p> : <>
          {available ? <p className="text-base font-bold text-blue-900">{range(estimate.minAmountCents, estimate.maxAmountCents)}</p>
            : <p className="text-xs font-semibold text-amber-800">No complete technician estimate is available.</p>}
          {available && includeServiceStopPay && <div className="text-xs text-slate-700">
            <p>Service stop pay: {range(...estimate.stopPayRange)}</p>
            <p>Additional Task pay: {range(...estimate.taskPayRange)}</p>
            <p>Stop pay and task pay are calculated separately. Task amounts do not need to add up to stop pay.</p>
          </div>}
          <p className="text-xs text-slate-600">{estimate.completeCount} of {estimate.technicianCount} current team members have a complete estimate. Lowest to highest for the same work.</p>
          {!estimate.technicianCount && <p className="text-xs text-amber-800">No active technicians are available in this company.</p>}
          {estimate.noSeparatePay && <p className="text-xs text-slate-600">This work does not create a separate task payment under the current pay rules.</p>}
          {estimate.missingCount > 0 && <div className="text-xs text-amber-800">
            <p>{estimate.missingCount} technician estimate{estimate.missingCount === 1 ? " needs" : "s need"} review. The range includes complete estimates only.</p>
            {estimate.reasons.slice(0, 3).map((reason) => <p key={reason}>{reason}</p>)}
          </div>}
        </>}
        {estimate.configuredRates.length > 0 && <div className="rounded border border-slate-200 bg-white p-2 text-xs">
          <p className="mb-1 font-semibold text-slate-700">Configured technician rates</p>
          {estimate.configuredRates.map((rate) => <div key={rate.key} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-0.5">
            <span>{rate.name}</span><span className="font-semibold text-slate-900">{rateLabel(rate)}</span>
          </div>)}
        </div>}
        {estimate.usesCustomerPriceBase && <p className="text-xs text-slate-600">Percentage estimates use the entered customer price as the preview base. Actual work needs an explicit payroll base before pay is calculated.</p>}
        {!compact && available && price !== null && <p className="text-xs text-slate-700">Customer price {money(price)} · Price less technician pay {range(price - estimate.maxAmountCents, price - estimate.minAmountCents)} before other costs.</p>}
        {!compact && available && cost !== null && cost < estimate.maxAmountCents && <p className="text-xs text-amber-800">The internal cost entered is below the high technician estimate.</p>}
        {onUseHighCost && <button type="button" disabled={!available || estimate.needsReview} onClick={() => onUseHighCost(estimate.maxAmountCents)}
          className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50">
          {compact ? "Use high estimate for task cost" : "Use high estimate for internal cost"}
        </button>}
        {!compact && estimate.summaries.length > 0 && <details className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Technician estimates</summary>
          <ul className="mt-2 space-y-1">{estimate.summaries.map((summary) => <li key={summary.worker.userId} className="flex flex-wrap justify-between gap-2"><span>{summary.worker.userName}</span><span>{summary.needsReview ? "Needs review" : money(summary.totalAmountCents)}</span></li>)}</ul>
        </details>}
      </>}
    </section>
  );
}
