import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {doc, getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {db, functions} from '../../../../utils/config';
import {getCallableAuthPayload} from '../../../../utils/callableAuth';
import {onboardingSchedule} from '../../../../utils/sales/onboardingPolicy';

const money = amount => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(Number(amount || 0) / 100);
const defaults = agreement => ({collectionMethod: 'autopay', scheduleMode: 'signup', billingDay: '1', invoiceSendDay: '1',
  prorationEnabled: false, surveyWaived: false, paymentTerms: 'dueOnReceipt', autoSend: true, reason: '', contact: {name: agreement.customerName || '', email: agreement.email || '', address: {}}, ...agreement.onboardingBilling});

export default function ServiceOnboardingPanel({agreement, canManage}) {
  const [form, setForm] = useState(() => defaults(agreement));
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const generation = useRef(0);
  const call = useCallback(async (action, extra = {}) => {
    const result = await httpsCallable(functions, 'manageServiceOnboarding')({...await getCallableAuthPayload(), companyId: agreement.companyId, agreementId: agreement.id, action, ...extra});
    return result.data;
  }, [agreement.companyId, agreement.id]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError('');
    try { const value = await call('status'); if (generation.current === current) setStatus(value); }
    catch (e) { if (generation.current === current) setError(e.message || 'Could not load onboarding.'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [call]);
  useEffect(() => { const requests = generation; refresh(); return () => { requests.current++; }; }, [refresh, agreement.status, agreement.onboardingReadiness]);
  const {id: agreementId, companyId, customerId, customerName, email, onboardingBilling} = agreement;
  useEffect(() => {
    let alive = true;
    setForm(defaults({customerName, email, onboardingBilling})); setReviewed(false);
    if (!onboardingBilling?.contact) getDoc(doc(db, 'companies', companyId, 'customers', customerId)).then(snapshot => {
      if (!alive || !snapshot.exists()) return;
      const customer = snapshot.data();
      setForm(current => ({...current, contact: {...current.contact, address: customer.billingAddress || {}, email: current.contact.email || customer.email || ''}}));
    }).catch(() => {});
    return () => { alive = false; };
  }, [agreementId, companyId, customerId, customerName, email, onboardingBilling]);
  const locked = Boolean(status?.released || (status?.billingReady && form.collectionMethod !== 'invoice'));
  const preview = useMemo(() => {
    if (locked && status?.preview) return status.preview;
    try { return onboardingSchedule({...agreement, onboardingBilling: {...form, timeZone: status?.preview?.timeZone}}, {timeZone: status?.preview?.timeZone || 'UTC'}, new Date()); }
    catch { return null; }
  }, [agreement, form, status?.preview, locked]);
  const date = value => value ? new Date(value).toLocaleDateString('en-US', {timeZone: preview?.timeZone || 'UTC'}) : 'Not set';
  const change = (field, value) => { setForm(current => ({...current, [field]: value})); setReviewed(false); };
  const contact = (field, value) => { setForm(current => ({...current, contact: {...current.contact, [field]: value}})); setReviewed(false); };
  const address = (field, value) => { setForm(current => ({...current, contact: {...current.contact, address: {...current.contact?.address, [field]: value}}})); setReviewed(false); };
  async function save() {
    if (!canManage || busy || (form.prorationEnabled && !reviewed)) return;
    setBusy(true); setError(''); setMessage('');
    try { await call('configure', {config: form, confirmedInitialAmountCents: reviewed ? preview?.initialAmountCents : null}); setMessage('Billing arrangement saved.'); await refresh(); }
    catch (e) { setError(e.message || 'Could not save billing arrangement.'); setBusy(false); }
  }
  async function release() {
    setBusy(true); setError('');
    try { await call('release'); setMessage('First service released.'); await refresh(); }
    catch (e) { setError(e.message || 'Could not release the first service.'); setBusy(false); }
  }
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-label="New customer onboarding">
    <h2 className="text-lg font-bold text-slate-950">New Customer Onboarding</h2>
    <p className="mt-2 text-sm text-slate-600">Agreement acceptance, billing readiness, and service setup are checked separately.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {status?.prorationReviewRequired && <p className="mt-3 text-sm text-amber-800">Review and save today's prorated amount and dates before billing can start.</p>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
    <ul className="mt-4 space-y-2 text-sm">{status?.checks?.map(check => <li key={check.id}><span className={check.complete ? 'font-semibold text-emerald-700' : 'text-amber-800'}>{check.complete ? 'Complete' : 'Needed'}</span> · {check.label}</li>)}</ul>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={refresh} disabled={busy} className="min-h-[44px] rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">Refresh readiness</button>
      {canManage && <button type="button" onClick={release} disabled={busy || !status?.ready || status?.released} className="min-h-[44px] rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{status?.released ? 'First Service Released' : 'Release First Service'}</button>}
      <Link to="/company/sales/agreements/needs-routing" className="min-h-[44px] rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">Review Routing</Link></div>
    <fieldset disabled={!canManage || busy || locked} className="mt-5 space-y-4 border-t border-slate-200 pt-4">
      <legend className="font-semibold">Billing Arrangement</legend>
      <label className="block text-sm font-semibold">Collection<select aria-label="Onboarding collection method" value={form.collectionMethod} onChange={e => change('collectionMethod', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="autopay">Customer authorizes a card or bank account</option><option value="invoice">Office-approved invoice customer</option></select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Billing name<input aria-label="Billing contact name" value={form.contact?.name || ''} onChange={e => contact('name', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label><label className="text-sm font-semibold">Billing email<input type="email" aria-label="Billing contact email" value={form.contact?.email || ''} onChange={e => contact('email', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label></div>
      <label className="block text-sm font-semibold">Billing street address<input aria-label="Billing street address" value={form.contact?.address?.streetAddress || ''} onChange={e => address('streetAddress', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>
      <div className="grid gap-3 sm:grid-cols-3">{[['city', 'City'], ['state', 'State'], ['zip', 'ZIP']].map(([field, label]) => <label key={field} className="text-sm font-semibold">{label}<input aria-label={`Billing ${label}`} value={form.contact?.address?.[field] || ''} onChange={e => address(field, e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>)}</div>
      <label className="block text-sm font-semibold">Billing schedule<select aria-label="Onboarding billing schedule" value={form.scheduleMode} onChange={e => { change('scheduleMode', e.target.value); if (e.target.value === 'signup') change('prorationEnabled', false); }} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="signup">Signup date · full monthly price in advance</option><option value="companyOverride">Company override · choose billing day</option></select></label>
      {form.scheduleMode === 'companyOverride' && <><label className="block text-sm font-semibold">Monthly billing day<select aria-label="Monthly billing day" value={form.billingDay || '1'} onChange={e => change('billingDay', Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 p-2">{Array.from({length: 31}, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.prorationEnabled} onChange={e => change('prorationEnabled', e.target.checked)} />Prorate the first partial period using actual calendar days</label></>}
      {form.collectionMethod === 'invoice' && <><label className="block text-sm font-semibold">Invoice-send day<select aria-label="Invoice-send day" value={form.invoiceSendDay || '1'} onChange={e => change('invoiceSendDay', Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 p-2">{Array.from({length: 31}, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label><label className="block text-sm font-semibold">Payment terms<select aria-label="Onboarding payment terms" value={form.paymentTerms} onChange={e => change('paymentTerms', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2">{['dueOnReceipt', 'net7', 'net15', 'net30'].map(value => <option key={value} value={value}>{value === 'dueOnReceipt' ? 'Due on receipt' : value.replace('net', 'Net ')}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoSend} onChange={e => change('autoSend', e.target.checked)} />Send invoices automatically on the selected day</label></>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.surveyWaived} onChange={e => change('surveyWaived', e.target.checked)} />Office reviewed this property and a site visit is unnecessary</label>
      {(form.collectionMethod === 'invoice' || form.scheduleMode === 'companyOverride' || form.surveyWaived) && <label className="block text-sm font-semibold">Office approval reason<textarea aria-label="Billing override reason" value={form.reason} onChange={e => change('reason', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>}
      {preview && <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-800"><p>Initial charge: <strong>{money(preview.initialAmountCents)}</strong>{preview.prorated ? ` · ${preview.initialDays} of ${preview.periodDays} calendar days` : ' · full monthly amount'}</p><p className="mt-1">Covered period: {date(preview.start)} to {date(preview.periodEnd)}.</p><p className="mt-1">Next renewals: {preview.renewals.map(date).join(' · ')}.</p>{form.collectionMethod === 'invoice' && <p className="mt-1">First invoice sends: {date(preview.firstInvoiceAt)}.</p>}<p className="mt-1">Days 29–31 use month-end when needed and return to the original day afterward.</p></div>}
      {form.prorationEnabled && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-1" />I reviewed the initial prorated amount and service dates.</label>}
      <button type="button" onClick={save} disabled={!preview || (form.prorationEnabled && !reviewed)} className="min-h-[44px] rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Save Billing Arrangement</button>
    </fieldset>
    {locked && <p className="mt-3 text-sm text-slate-600">Billing setup is complete. Changes to an active arrangement require a reviewed billing change.</p>}
    {!canManage && <p className="mt-3 text-sm text-slate-600">A billing manager can approve invoice arrangements, proration, and first-service release.</p>}
  </section>;
}
