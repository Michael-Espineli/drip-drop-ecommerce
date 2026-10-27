import React, { useId } from "react";

const displayLabel = (value) => String(value || "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_-]/g, " ")
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());
const labelKey = (value) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");
const payrollBucketLabels = {
  route: "Routes", routes: "Routes", job: "Jobs", jobs: "Jobs",
  jobEstimate: "Job Estimates", serviceAgreementEstimate: "Service Agreement Estimates",
  customerRelationship: "Customer Relationship",
};
const rateTypeLabels = {
  flatPerStop: "Per Stop", flatPerTask: "Per Task", hourly: "Hourly",
  perBodyOfWater: "Per Body of Water", perServiceLocation: "Per Service Location",
  percentage: "Percentage", manual: "Manual",
};
const payItemDetails = (item) => {
  const bucketId = item.stopPayBucketId || item.bucketId || item.serviceStopBucketId || item.serviceStopCategory || "";
  const knownBucket = Object.entries(payrollBucketLabels).find(([key]) => labelKey(key) === labelKey(bucketId))?.[1];
  const bucket = item.stopPayBucketLabel || item.bucketLabel || knownBucket || displayLabel(bucketId);
  const category = displayLabel(item.category);
  const group = bucket || category || "Other Pay Items";
  const categoryDetail = category && labelKey(category) !== labelKey(group) ? category : "";
  const rateType = item.defaultRateType || item.rateType;
  const rateLabel = rateTypeLabels[rateType] || displayLabel(rateType) || "Rate Type Not Set";
  return { group, category: categoryDetail, rateLabel, label: item.name || item.label || item.id };
};

export default function JobPayrollFields({ value = {}, onChange, payTypes = [], inheritedPayTypeId = "", showPayType = true }) {
  const payItemDetailsId = useId();
  const mode = value.payrollMode || (value.manualPayOverrideCents !== undefined && value.manualPayOverrideCents !== null ? "custom" : "automatic");
  const active = payTypes.filter((type) => type.isActive !== false && type.active !== false && type.archived !== true);
  const groups = new Map();
  active.forEach((item) => {
    const details = payItemDetails(item);
    if (!groups.has(details.group)) groups.set(details.group, []);
    groups.get(details.group).push({ item, ...details });
  });
  const selectedItem = payTypes.find((item) => item.id === (value.payTypeId || inheritedPayTypeId));
  const selectedDetails = selectedItem ? payItemDetails(selectedItem) : null;
  const fieldClass = "mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900";
  return (
    <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50/40 p-3 text-sm normal-case tracking-normal">
      <p className="font-semibold text-slate-800">Technician pay</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {showPayType && <div className="min-w-0">
          <label className="block font-semibold text-slate-700">
          Payroll pay item
          <select value={value.payTypeId || ""} onChange={(event) => {
            onChange("payTypeId", event.target.value);
            onChange("payTypeName", active.find((type) => type.id === event.target.value)?.name || "");
          }} className={fieldClass} aria-describedby={selectedDetails ? payItemDetailsId : undefined}>
            <option value="">{inheritedPayTypeId ? "Use service pay item" : "Select a pay item"}</option>
            {value.payTypeId && !active.some((type) => type.id === value.payTypeId) && <option value={value.payTypeId}>{value.payTypeName || "Inactive or missing pay item"}</option>}
            {[...groups].sort(([left], [right]) => left.localeCompare(right)).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.sort((left, right) => Number(left.item.sortOrder || 0) - Number(right.item.sortOrder || 0) || left.label.localeCompare(right.label)).map(({ item, label, category, rateLabel }) => (
                  <option key={item.id} value={item.id}>{[label, category, rateLabel].filter(Boolean).join(" · ")}</option>
                ))}
              </optgroup>
            ))}
          </select>
          </label>
          {selectedDetails && <p id={payItemDetailsId} className="mt-1 break-words text-xs font-normal text-slate-600">
            {!value.payTypeId && inheritedPayTypeId ? `Service pay item: ${selectedDetails.label} · ` : ""}
            {[selectedDetails.group, selectedDetails.category, `Default rate: ${selectedDetails.rateLabel}`].filter(Boolean).join(" · ")}
          </p>}
        </div>}
        <label className="min-w-0 font-semibold text-slate-700">
          Pay calculation
          <select value={mode} onChange={(event) => {
            onChange("payrollMode", event.target.value);
            if (event.target.value !== "custom") onChange("manualPayOverrideCents", null);
          }} className={fieldClass}>
            <option value="automatic">Assigned technician's rate</option>
            <option value="custom">Custom amount</option>
            <option value="included">Included in another payment</option>
            <option value="unpaid">Unpaid work</option>
          </select>
        </label>
        {mode === "automatic" && <>
          <label className="min-w-0 font-semibold text-slate-700">
            Payroll quantity
            <input type="number" min="0.01" step="0.01" value={value.payQuantity ?? 1} onChange={(event) => onChange("payQuantity", event.target.value === "" ? null : Number(event.target.value))} className={fieldClass} />
          </label>
          <label className="min-w-0 font-semibold text-slate-700">
            Payment alongside visit pay
            <select value={value.payrollStackBehavior || ""} onChange={(event) => onChange("payrollStackBehavior", event.target.value)} className={fieldClass}>
              <option value="">Use company rules; pay matching work once</option>
              <option value="stackable">Additional payment</option>
              <option value="replacesBase">Replace this technician's visit pay</option>
              <option value="exclusive">Use highest payment for this technician</option>
            </select>
          </label>
        </>}
        {mode === "custom" && <>
          <label className="min-w-0 font-semibold text-slate-700">
            Custom pay amount
            <input type="number" min="0" step="0.01" required
              value={value.manualPayOverrideCents === undefined || value.manualPayOverrideCents === null ? "" : value.manualPayOverrideCents / 100}
              onChange={(event) => onChange("manualPayOverrideCents", event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))} className={fieldClass} />
          </label>
          <label className="min-w-0 font-semibold text-slate-700">
            Custom pay note
            <input value={value.manualPayOverrideNotes || ""} onChange={(event) => onChange("manualPayOverrideNotes", event.target.value)} className={fieldClass} placeholder="Reason for this amount" />
          </label>
        </>}
      </div>
      <p className="text-xs font-normal text-slate-600">Automatic pay uses the assigned technician's rate on the work date. Custom pay replaces automatic pay for this work. Customer pricing stays separate.</p>
      {mode === "automatic" && !value.payTypeId && !inheritedPayTypeId && <p className="text-xs font-semibold text-amber-800">A pay item is needed to calculate technician pay.</p>}
    </div>
  );
}
