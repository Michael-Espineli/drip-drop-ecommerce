import React from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

const fieldClass = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 lg:text-sm';

export const emptyAgreementAcceptance = () => ({
  note: '', acceptedTerms: false, acceptedPricing: false, acceptedAutopayNotice: false, signatureName: '',
});

export default function ServiceAgreementAcceptanceCard({
  id = 'agreement-response', recordLabel = 'Service Agreement', isEstimate = false,
  fields, isAccepted, isClosed, closedMessage, renewalNotice = '', paymentNotice,
  value, onChange, onAccept, canAccept = true, accepting = false,
  responseNote, onResponseNoteChange, onRespond, canRespond = true, responding = '',
}) {
  const busy = accepting || Boolean(responding);
  const confirmations = [
    ['acceptedTerms', `I reviewed the ${isEstimate ? 'estimate' : 'agreement'}, pricing, and terms.${renewalNotice ? ` ${renewalNotice}` : ''}`],
    ['acceptedPricing', 'I reviewed the price, billing frequency, and invoice terms.'],
    ['acceptedAutopayNotice', paymentNotice || (isEstimate
      ? 'I understand the accepted estimate can be invoiced after the work is complete.'
      : 'I understand this agreement can be used to set up recurring online billing.')],
  ];

  return (
    <section aria-labelledby={id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id={id} tabIndex={-1} className="scroll-mt-20 text-lg font-bold text-slate-950">Acceptance</h2>
      <p className="mt-1 text-sm text-slate-500">
        Accepting records your approval. Payment setup appears only when the company has online billing turned on.
      </p>
      <dl className="mt-5 space-y-4">
        {fields.map(([label, display]) => <div key={label}>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-950">{display || 'Not set'}</dd>
        </div>)}
      </dl>

      {!isAccepted && !isClosed && <div className="mt-5 space-y-4">
        <label className="block text-sm font-semibold text-slate-700" htmlFor={`${id}-note`}>
          Note
          <textarea id={`${id}-note`} value={value.note} onChange={event => onChange({ note: event.target.value })} disabled={busy} className={`${fieldClass} h-24`} placeholder="Optional" />
        </label>
        {confirmations.map(([key, label]) => <label key={key} className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <input type="checkbox" checked={value[key]} onChange={event => onChange({ [key]: event.target.checked })} disabled={busy} className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-slate-700">{label}</span>
        </label>)}
        <label className="block text-sm font-semibold text-slate-700" htmlFor={`${id}-signature`}>
          Signature Name
          <input id={`${id}-signature`} type="text" autoComplete="name" value={value.signatureName} onChange={event => onChange({ signatureName: event.target.value })} disabled={busy} className={fieldClass} placeholder="Full name" />
        </label>
        <button type="button" onClick={onAccept} disabled={!canAccept || busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
          <CheckCircleIcon className="h-5 w-5" />
          {accepting ? 'Accepting...' : `Accept ${recordLabel}`}
        </button>

        {onRespond && <div className="rounded-md border border-slate-200 bg-white p-3">
          <label className="block text-sm font-semibold text-slate-700" htmlFor={`${id}-response`}>
            Questions or requested changes
            <textarea id={`${id}-response`} value={responseNote} onChange={event => onResponseNoteChange(event.target.value)} disabled={busy} className={`${fieldClass} h-24`} placeholder="Tell the company what you would like changed, or why you are declining." />
          </label>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => onRespond('changesRequested')} disabled={!canRespond || busy} className="inline-flex justify-center rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60">
              {responding === 'changesRequested' ? 'Sending...' : 'Request Changes'}
            </button>
            <button type="button" onClick={() => onRespond('rejected')} disabled={!canRespond || busy} className="inline-flex justify-center rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
              {responding === 'rejected' ? 'Sending...' : `Decline ${isEstimate ? 'Estimate' : 'Agreement'}`}
            </button>
          </div>
        </div>}
      </div>}
      {isClosed && <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {closedMessage || `This ${isEstimate ? 'estimate' : 'agreement'} is no longer available for acceptance.`}
      </div>}
    </section>
  );
}
