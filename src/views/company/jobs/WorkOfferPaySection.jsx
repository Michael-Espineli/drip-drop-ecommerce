import React from "react";
import { jobPayFields } from "../../../utils/payroll/payCalculation";

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(value) || 0) / 100);
const paySourceLabels = {
  technicianRate: "Technician rate",
  taskContractedRate: "Task contracted amount",
  taskContractedRateThenTechnicianRate: "Task contracted amount, then technician rate",
  technicianRateThenTaskContractedRate: "Technician rate, then task contracted amount",
  hourlyActualTime: "Hourly actual time",
  hourlyEstimatedTime: "Hourly estimated time",
  none: "No automatic task pay",
};

export default function WorkOfferPaySection({ form, onChange, tasks, services = [], payTypes, paySettings, canIncentivize, quote, quoteError }) {
  const diagnostic = form.workPurpose === "diagnostic";
  const incentiveEnabled = form.incentiveType !== "none";
  const fieldClass = "mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 font-normal text-gray-900";
  return (
    <>
      <section aria-labelledby="work-offer-pay-heading" className="rounded-xl border border-gray-200 p-4 space-y-4">
        <div>
          <h4 id="work-offer-pay-heading" className="font-bold text-gray-800">Technician pay</h4>
          <p className="mt-1 text-sm text-gray-600">{diagnostic
            ? "Estimate visits use the job estimate pay type and company pay rules."
            : "Uses the pay items already saved on the selected planned services and their tasks. Amounts follow company pay rules for the selected technician."}</p>
        </div>
        {!diagnostic && !form.overridePay && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="font-semibold text-gray-700">Pay from plan</p>
            {services.some((service) => jobPayFields(service).payTypeId) && <ul className="mt-2 space-y-2 border-b border-gray-200 pb-3">
              {services.filter((service) => jobPayFields(service).payTypeId).map((service) => {
                const fields = jobPayFields(service);
                const type = payTypes.find((item) => item.id === fields.payTypeId);
                return <li key={service.id} className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4"><span className="text-gray-700">{service.name || "Service"} · visit pay item</span><span className="text-gray-600">{type?.name || fields.payTypeName || "Saved service pay item"}</span></li>;
              })}
            </ul>}
            <p className="mt-1 text-gray-600">{paySourceLabels[paySettings.taskPaySource || "technicianRateThenTaskContractedRate"] || "Company pay rules"}</p>
            <ul className="mt-3 divide-y divide-gray-200">
              {tasks.map((task) => {
                const fields = jobPayFields(task);
                const type = payTypes.find((item) => item.id === fields.payTypeId);
                const pay = fields.payrollMode === "custom" ? fields.manualPayOverrideCents == null ? "Custom pay amount needs setup" : `Custom pay: ${money(fields.manualPayOverrideCents)}`
                  : fields.payrollMode === "included" ? "No additional task pay"
                    : fields.payrollMode === "unpaid" ? "Unpaid work"
                      : type?.name || fields.payTypeName || "Pay item needs setup in the plan";
                return <li key={task.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between sm:gap-4"><span className="text-gray-700">{task.name || "Task"}</span><span className="text-gray-600">{pay}</span></li>;
              })}
              {!tasks.length && <li className="py-2 text-gray-600">Select planned tasks to see their pay setup.</li>}
            </ul>
          </div>
        )}
        <label className="flex items-center gap-3 text-sm font-semibold text-gray-700">
          <input type="checkbox" checked={Boolean(form.overridePay)} onChange={(event) => onChange("overridePay", event.target.checked)} aria-controls="work-offer-pay-overrides" className="h-4 w-4 rounded border-gray-300 text-blue-600" />
          Override pay for this offer
          <span className="font-normal text-gray-500">(optional)</span>
        </label>
        {form.overridePay && (
          <div id="work-offer-pay-overrides" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">These settings apply to this offer. A visit pay type uses company rules alongside the tasks’ saved pay items. A fixed amount or unpaid offer replaces the base pay for the selected work.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700">Visit pay type override
                <select value={form.serviceStopTypeId} onChange={(event) => onChange("serviceStopTypeId", event.target.value)} className={fieldClass}>
                  <option value="">{diagnostic ? "Use job estimate pay type" : "Use planned task pay only"}</option>
                  {payTypes.map((type) => <option key={type.id} value={type.id}>{type.name || type.type || "Pay item"}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-700">Pay source override
                <select value={form.paySource} onChange={(event) => onChange("paySource", event.target.value)} className={fieldClass}>
                  <option value="Technician Rate">Use company pay rules</option>
                  <option value="Task Contracted Rates">Task contracted amounts</option>
                  <option value="Offered Amount">Fixed offered amount</option>
                  <option value="Unpaid">Unpaid work</option>
                </select>
              </label>
              {form.paySource === "Offered Amount" && <label className="text-sm font-semibold text-gray-700">Offered amount
                <input type="number" min="0" step="0.01" value={form.offeredAmount} onChange={(event) => onChange("offeredAmount", event.target.value)} className={fieldClass} />
              </label>}
            </div>
          </div>
        )}
      </section>

      {canIncentivize && (
        <section aria-label="Offer incentive" className="rounded-xl border border-gray-200 p-4 space-y-4">
          <div>
            <label className="flex items-center gap-3 font-semibold text-gray-800">
              <input type="checkbox" checked={incentiveEnabled} onChange={(event) => onChange("incentiveType", event.target.checked ? "flat" : "none")} aria-controls="work-offer-incentive-fields" className="h-4 w-4 rounded border-gray-300 text-blue-600" />
              Add incentive
            </label>
            <p className="mt-1 ml-7 text-sm text-gray-600">Offer an optional bonus on top of the base pay.</p>
          </div>
          {incentiveEnabled && (
            <div id="work-offer-incentive-fields" className="space-y-4 border-t border-gray-200 pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-gray-700">Incentive type
                  <select value={form.incentiveType} onChange={(event) => onChange("incentiveType", event.target.value)} className={fieldClass}>
                    <option value="flat">Flat amount</option><option value="percentage">Percentage of base pay</option>
                  </select>
                </label>
                {form.incentiveType === "flat" ? <label className="text-sm font-semibold text-gray-700">Incentive amount
                  <input type="number" min="0" step="0.01" value={form.incentiveAmount} onChange={(event) => onChange("incentiveAmount", event.target.value)} className={fieldClass} />
                </label> : <label className="text-sm font-semibold text-gray-700">Incentive percent
                  <input type="number" min="0" step="0.1" value={form.incentivePercentage} onChange={(event) => onChange("incentivePercentage", event.target.value)} className={fieldClass} />
                </label>}
              </div>
              <label className="block text-sm font-semibold text-gray-700">Incentive notes
                <textarea rows={2} value={form.incentiveNotes} onChange={(event) => onChange("incentiveNotes", event.target.value)} className={fieldClass} placeholder="Describe the bonus or any conditions" />
              </label>
            </div>
          )}
        </section>
      )}

      <div role="status" className={`rounded-xl p-4 text-sm ${quoteError || quote?.needsReview ? "bg-amber-50 text-amber-900" : "bg-blue-50 text-blue-950"}`}>
        {quoteError || (quote?.totalCents == null ? "Each technician reviews their personal pay before accepting." : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><dt>Base pay</dt><dd className="mt-1 font-bold">{money(quote.baseCents)}</dd></div>
            <div><dt>Incentive</dt><dd className="mt-1 font-bold">{money(quote.incentiveCents)}</dd></div>
            <div><dt>Estimated total pay</dt><dd className="mt-1 font-bold">{money(quote.totalCents)}</dd></div>
          </dl>
        ))}
        {quote?.needsReview && <p className="mt-2">Pay setup needs review before creating this offer.</p>}
      </div>
    </>
  );
}
