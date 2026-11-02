import React from "react";
import { groupStatementLinesByDay } from "../../../utils/payroll/payStatementSummary";

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);

export default function PayStatementDailySummary({ lines, subtotalCents, adjustmentCents, totalCents, loading, expectedLineCount = 0 }) {
  const days = groupStatementLinesByDay(lines);
  const incomplete = !loading && lines.length < expectedLineCount;

  return (
    <aside aria-label="Pay by day" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 lg:sticky lg:top-32 lg:order-last">
      <div className="rounded-t-xl bg-slate-900 p-5 text-white">
        <p className="text-sm font-medium text-slate-300">Statement total</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{money(totalCents)}</p>
      </div>
      <div className="p-5">
        <h3 className="font-bold text-slate-900">Pay by day</h3>
        <p className="mt-1 text-xs text-slate-500">Grouped by work completion date.</p>
        {loading ? (
          <p role="status" className="mt-4 text-sm text-slate-600">Loading daily breakdown...</p>
        ) : (
          <>
            {incomplete ? <p role="status" className="mt-3 text-sm text-amber-800">Some statement line items could not be loaded. Daily totals are incomplete.</p> : null}
            {days.length ? (
              <dl className="mt-3 max-h-80 divide-y divide-slate-200 overflow-y-auto">
                {days.map((day) => (
                  <div key={day.key} className="flex items-start justify-between gap-3 py-3">
                    <dt className="min-w-0 text-sm font-medium text-slate-700">
                      {day.label}
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">{day.lineCount} pay item{day.lineCount === 1 ? "" : "s"}</span>
                    </dt>
                    <dd className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(day.totalCents)}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="mt-4 text-sm text-slate-500">No pay items to summarize.</p>}
          </>
        )}
        <dl className="mt-3 space-y-3 border-t border-slate-300 pt-4 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-slate-600">Subtotal</dt><dd className="font-semibold tabular-nums text-slate-900">{money(subtotalCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-600">Statement adjustments</dt><dd className="font-semibold tabular-nums text-slate-900">{money(adjustmentCents)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-slate-200 pt-3 font-bold text-slate-900"><dt>Total pay</dt><dd className="tabular-nums">{money(totalCents)}</dd></div>
        </dl>
      </div>
    </aside>
  );
}
