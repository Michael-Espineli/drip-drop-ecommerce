import React, { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { PRODUCT_AVAILABILITY_FIELDS } from "../../../utils/productAvailability";

export const DEFAULT_PRODUCT_SORT = "nameAsc";

const SORT_OPTIONS = [
  { value: DEFAULT_PRODUCT_SORT, label: "Name A-Z" },
  { value: "nameDesc", label: "Name Z-A" },
  { value: "categoryAsc", label: "Category A-Z" },
  { value: "sellPriceHigh", label: "Sell price high-low" },
  { value: "sellPriceLow", label: "Sell price low-high" },
  { value: "updatedNewest", label: "Recently updated" },
  { value: "updatedOldest", label: "Oldest updated" },
];

const selectClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

function FilterSelect({ label, options, value, onChange, autoFocus }) {
  return (
    <label className="block min-w-0 text-sm font-semibold text-slate-700">
      {label}
      <select
        data-autofocus={autoFocus || undefined}
        className={selectClass}
        value={String(value ?? "")}
        onChange={(event) => {
          const selected = options.find((option) => String(option.value) === event.target.value);
          onChange(selected?.value);
        }}
      >
        <option value="">Any</option>
        {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>
  );
}

export default function ProductCatalogFilters({ filters, sortOption, catalogOptions, onApply, onClose }) {
  const [draft, setDraft] = useState(filters);
  const [draftSort, setDraftSort] = useState(sortOption);

  const changeFilter = (field, value) => {
    setDraft((current) => {
      const next = { ...current };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });
  };

  return (
    <Dialog open onClose={onClose} className="company-theme relative z-50">
      <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          as="form"
          onSubmit={(event) => { event.preventDefault(); onApply(draft, draftSort); }}
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="shrink-0 border-b border-slate-200 px-5 py-4">
            <DialogTitle as="h2" className="text-lg font-bold text-slate-950">Filter products</DialogTitle>
          </div>

          <div className="min-h-0 space-y-5 overflow-y-auto p-5">
            <div className="grid gap-3 min-[380px]:grid-cols-2">
              {catalogOptions.map(({ field, label, values }, index) => {
                const choices = filters[field] ? [...new Set([...values, filters[field]])] : values;
                return (
                  <FilterSelect key={field} label={label} value={draft[field]} autoFocus={index === 0}
                    options={choices.map((choice) => ({ value: choice, label: choice }))}
                    onChange={(value) => changeFilter(field, value)} />
                );
              })}
              <FilterSelect label="Billing" value={draft.billable}
                options={[{ value: true, label: "Billable" }, { value: false, label: "Not billable" }]}
                onChange={(value) => changeFilter("billable", value)} />
            </div>

            <fieldset className="min-w-0 border-t border-slate-200 pt-2">
              <legend className="pr-2 text-sm font-bold text-slate-950">Availability</legend>
              <div className="grid gap-3 min-[380px]:grid-cols-2">
                {PRODUCT_AVAILABILITY_FIELDS.map(({ id, label, aliases: [field] }) => (
                  <FilterSelect key={id} label={label} value={draft[field]}
                    options={[
                      { value: true, label: id === "active" ? "Active" : "Available" },
                      { value: false, label: id === "active" ? "Inactive" : "Unavailable" },
                    ]}
                    onChange={(value) => changeFilter(field, value)} />
                ))}
              </div>
            </fieldset>

            <label className="block text-sm font-semibold text-slate-700">
              Sort products
              <select value={draftSort} onChange={(event) => setDraftSort(event.target.value)} className={selectClass}>
                {SORT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-4 sm:px-5">
            <button type="button" className={workspaceButtonClass({ tone: "slate" })}
              disabled={!Object.keys(draft).length && draftSort === DEFAULT_PRODUCT_SORT}
              onClick={() => { setDraft({}); setDraftSort(DEFAULT_PRODUCT_SORT); }}>
              Reset filters
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onClose} className={workspaceButtonClass({ tone: "slate" })}>Cancel</button>
              <button type="submit" className={workspaceButtonClass({ tone: "blue" })}>Apply filters</button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
