import React, { useId } from 'react';
import { agreementPlanId } from '../../hooks/useAgreementPlanSelection';
import { getJobPlanDisplayName, getJobPlanRecommendationDisplay } from '../../utils/models/JobPlan';

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format((Number(amount) || 0) / 100);

export default function AgreementPlanPicker({
  options, selectedPlanId, onSelect, isAccepted, isClosed, busy, recordLabel = 'Estimate',
}) {
  const id = useId();
  if (!options.length) return null;
  const locked = isAccepted || isClosed || busy;

  return (
    <section aria-labelledby={`${id}-heading`} className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id={`${id}-heading`} className="text-lg font-bold text-slate-950">
        {isAccepted ? 'Accepted Plan' : isClosed ? 'Plan Options' : 'Choose a Plan'}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {isAccepted
          ? 'Your approved plan is shown below.'
          : isClosed
            ? `This ${recordLabel.toLowerCase()} is closed for selection.`
            : `Compare the plans below, then choose one to review its services, products, and total. Your choice is confirmed when you accept the ${recordLabel.toLowerCase()}.`}
      </p>
      <fieldset disabled={Boolean(locked)} className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
        <legend className="sr-only">Available plans</legend>
        {options.map((option, index) => {
          const optionId = agreementPlanId(option);
          const selected = optionId === selectedPlanId;
          const tier = option.planTier || option.solutionTier || option.recommendationRank;
          const labelId = `${id}-plan-${index}`;
          return (
            <label key={optionId} className={`min-w-0 rounded-lg border p-4 transition ${locked ? '' : 'cursor-pointer'} ${selected ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 bg-white'}`}>
              <span className="flex items-start gap-3">
                <input type="radio" name={`${id}-plan`} value={optionId} checked={selected}
                  onChange={() => onSelect(optionId)} aria-labelledby={labelId}
                  className="mt-1 h-4 w-4 flex-none border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="min-w-0 flex-1 break-words">
                  {tier && <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{getJobPlanRecommendationDisplay(tier)}</span>}
                  <span id={labelId} className="block text-base font-bold text-slate-950">{getJobPlanDisplayName(option, 'Plan Option')}</span>
                  {option.description && <span className="mt-1 block whitespace-pre-wrap text-sm text-slate-600">{option.description}</span>}
                  <span className="mt-3 block text-lg font-bold text-slate-950">{formatCurrency(option.totalAmountCents ?? option.rateAmountCents)}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {Number(option.taskCount || 0)} tasks · {Number(option.plannedStopCount || 0)} visits · {Number(option.materialCount || 0)} products
                  </span>
                  {selected && <span className="mt-3 inline-flex rounded-full border border-blue-200 bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">{isAccepted ? 'Accepted' : 'Selected'}</span>}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
