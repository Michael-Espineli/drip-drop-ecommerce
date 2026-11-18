import React from "react";

const dotToneClasses = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  indigo: "bg-indigo-500",
};

export const DetailRow = ({ label, value, children }) => {
  const content = children ?? value;
  const hasContent = content !== null && content !== undefined && content !== "";

  return (
    <div className="grid gap-1 border-b border-slate-100 py-4 last:border-b-0 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold leading-6 text-slate-900">{hasContent ? content : "--"}</dd>
    </div>
  );
};

export const SummaryRow = ({ label, value }) => {
  const hasValue = value !== null && value !== undefined && value !== "";

  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-sm font-semibold text-slate-500">{label}</span>
      <span className="max-w-[190px] break-words text-right text-sm font-semibold text-slate-900">{hasValue ? value : "--"}</span>
    </div>
  );
};

export const AvailabilityRow = ({ label, description, available, tone = "blue" }) => (
  <li className="flex gap-3 py-3">
    <span className={`mt-2 h-2.5 w-2.5 flex-none rounded-full ${available ? dotToneClasses[tone] || dotToneClasses.blue : "bg-slate-300"}`} />
    <span className="min-w-0">
      <span className="block text-sm font-bold text-slate-900">{label}</span>
      <span className="mt-0.5 block text-sm leading-6 text-slate-500">{available ? description : "Not available for this workflow."}</span>
    </span>
  </li>
);

