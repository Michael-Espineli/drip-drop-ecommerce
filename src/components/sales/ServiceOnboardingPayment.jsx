import React, {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {httpsCallable} from 'firebase/functions';
import {Context} from '../../context/AuthContext';
import {functions} from '../../utils/config';
import {getCallableAuthPayload} from '../../utils/callableAuth';

export default function ServiceOnboardingPayment({agreement, email = '', accessToken = ''}) {
  const {user} = useContext(Context);
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('card'), [authorized, setAuthorized] = useState(false);
  const requestIds = useRef({});
  const generation = useRef(0);
  const payload = useCallback(async () => ({companyId: agreement.companyId, agreementId: agreement.id,
    email: email || agreement.email || '', accessToken, ...(user?.uid ? await getCallableAuthPayload() : {})}),
  [agreement.companyId, agreement.id, agreement.email, email, accessToken, user?.uid]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await httpsCallable(functions, 'manageServiceOnboarding')({...await payload(), action: 'status'});
      if (generation.current === current) setStatus(result.data);
    } catch (e) { if (generation.current === current) setError(e.message || 'Could not check billing setup.'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [payload]);
  useEffect(() => { const requests = generation; refresh(); return () => { requests.current++; }; }, [refresh]);
  async function setup() {
    if (!authorized || busy) return;
    const current = ++generation.current;
    setBusy(true); setError('');
    requestIds.current[method] ||= `onboarding_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      const result = await httpsCallable(functions, 'createServiceOnboardingCheckout')({...await payload(), requestId: requestIds.current[method], paymentMethodType: method, returnUrl: window.location.href});
      if (generation.current !== current) return;
      if (result.data?.url) window.location.assign(result.data.url);
      else { requestIds.current[method] = null; await refresh(); }
    } catch (e) { if (generation.current === current) { setError(e.message || 'Could not open secure payment setup.'); setBusy(false); } }
  }
  const invoice = status?.config?.collectionMethod === 'invoice';
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-label="Service signup billing">
    <h2 className="text-lg font-bold text-slate-950">Complete service signup</h2>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {status?.prorationReviewRequired && <p className="mt-3 text-sm text-amber-800">Your company needs to review the updated first billing period. Contact the office to finish signup.</p>}
    {status?.verificationUrl && <a href={status.verificationUrl} className="mt-3 inline-flex min-h-[44px] items-center rounded-md bg-amber-100 px-3 py-2 font-semibold text-amber-900">Complete Bank Verification</a>}
    {invoice ? <p className="mt-3 text-sm text-slate-700">{status.billingReady ? 'The office approved invoice billing.' : 'The office is completing your invoice arrangement.'} Your invoice sends on day {status.config.invoiceSendDay}, using the last day in shorter months. Payment terms: {status.config.paymentTerms === 'dueOnReceipt' ? 'due on receipt' : status.config.paymentTerms.replace('net', 'Net ')}.</p>
      : status?.billingReady ? <p className="mt-3 font-semibold text-emerald-700">Billing information and payment authorization are complete.</p>
      : <>
        <p className="mt-3 text-sm text-slate-700">Securely add a card or bank account. The first payment starts monthly service billing in advance. Renewal uses your signup day, falls on month-end in shorter months, and returns to the original day afterward. Proration applies only to an office-approved arrangement.</p>
        <label className="mt-4 block text-sm font-semibold">Payment method<select aria-label="Signup payment method" value={method} onChange={e => { setMethod(e.target.value); setAuthorized(false); }} disabled={busy} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="card">Card</option><option value="ach">US bank account</option></select></label>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} disabled={busy} className="mt-1" />I authorize the first service payment and recurring monthly payments under this agreement. I will review the amount and billing address in secure payment setup.</label>
        <button type="button" onClick={setup} disabled={busy || !authorized || !status || status.prorationReviewRequired} className="mt-4 min-h-[44px] w-full rounded-md bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Checking billing setup…' : 'Continue to Secure Payment Setup'}</button>
        {method === 'ach' && <p className="mt-2 text-sm text-slate-600">Bank verification must finish before billing setup is complete.</p>}
      </>}
    <button type="button" onClick={refresh} disabled={busy} className="mt-3 min-h-[44px] rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">Refresh signup status</button>
    {status?.billingReady && <p className="mt-2 text-sm text-slate-600">{status.released ? 'Your company has released your first service.' : 'Your company is completing service scheduling.'}</p>}
  </section>;
}
