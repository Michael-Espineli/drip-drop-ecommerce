import React, {useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../../utils/config';
import {getCallableAuthPayload} from '../../utils/callableAuth';
import {netPaymentCents} from '../../utils/sales/financialMetrics';

export default function StripePaymentRefund({invoice,payments,userId}) {
  const storageKey=`stripe-refund:${userId}:${invoice.companyId}:${invoice.id}`;
  const empty=()=>({requestId:uuidv4(),paymentId:'',amount:'',reason:'',uncertain:false});
  const [draft,setDraft]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)) || empty();}catch(_){return empty();}});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  const eligible=payments.filter(p=>p.stripePaymentIntentId && ['posted','partiallyRefunded'].includes(p.status) && netPaymentCents(p)>0);
  const selected=eligible.find(p=>p.id===draft.paymentId);
  const money=amount=>new Intl.NumberFormat('en-US',{style:'currency',currency:invoice.currency || 'usd'}).format(amount/100);
  const save=next=>{
    setDraft(next);
    try{sessionStorage.setItem(storageKey,JSON.stringify(next));}catch(_){/* Keep failed requests available in memory. */}
  };
  const change=(field,value)=>save({...draft,[field]:value});
  const submit=async event=>{
    event.preventDefault();setBusy(true);setError('');setResult('');
    try {
      const {data}=await httpsCallable(functions,'manageSalesPayment')({...await getCallableAuthPayload(),action:'refund',companyId:invoice.companyId,paymentId:draft.paymentId,requestId:draft.requestId,amountCents:Math.round(Number(draft.amount)*100),reason:draft.reason});
      setResult(data.status==='succeeded'?`Refund issued: ${money(data.amountCents)}.`:`Refund ${data.status}: ${money(data.amountCents)}. Payment history updates when Stripe confirms it.`);
      setDraft(empty());try{sessionStorage.removeItem(storageKey);}catch(_){}
    } catch(err){save(err.details?.safeToRevise?{...draft,requestId:uuidv4(),uncertain:false}:{...draft,uncertain:true});setError(err.message || 'Refund could not be confirmed. Retry with the same details.');}
    finally{setBusy(false);}
  };
  if(!eligible.length && !busy && !error && !result && !draft.uncertain)return null;
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-slate-950">Refund a Stripe payment</h2>
    <p className="mt-2 text-sm text-slate-600">Return all or part of a settled payment to the customer’s original payment method. The refund stays in the invoice history and does not create another bill.</p>
    <form onSubmit={submit} className="mt-4 space-y-3">
      <label className="block text-sm font-semibold">Payment to refund<select required value={draft.paymentId} disabled={busy || draft.uncertain} onChange={e=>change('paymentId',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"><option value="">Choose a payment</option>{eligible.map(p=><option key={p.id} value={p.id}>{p.method} · {money(netPaymentCents(p))} available</option>)}</select></label>
      <label className="block text-sm font-semibold">Refund amount<input required type="number" min="0.01" max={selected?netPaymentCents(selected)/100:undefined} step="0.01" value={draft.amount} disabled={busy || draft.uncertain} onChange={e=>change('amount',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label>
      <label className="block text-sm font-semibold">Refund reason<textarea required minLength={8} maxLength={1000} value={draft.reason} disabled={busy || draft.uncertain} onChange={e=>change('reason',e.target.value)} className="mt-1 w-full rounded border p-2"/></label>
      <button type="submit" disabled={busy || !selected} className="min-h-[44px] rounded bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">{busy?'Processing refund…':'Issue refund'}</button>
      {draft.uncertain && !selected && <button type="button" disabled={busy} onClick={()=>submit({preventDefault:()=>{}})} className="min-h-[44px] rounded border px-4 font-semibold">Confirm refund status</button>}
    </form>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{result&&<p role="status" className="mt-3 text-sm text-emerald-700">{result}</p>}
  </section>;
}
