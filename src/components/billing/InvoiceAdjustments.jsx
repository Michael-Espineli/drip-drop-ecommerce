import React,{useEffect,useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {manageSalesInvoice} from '../../utils/sales/invoiceCommands';

export default function InvoiceAdjustments({invoice,payments,userId}){
  const storageKey=`invoice-adjustment:${userId}:${invoice.companyId}:${invoice.id}`;
  const empty=()=>({requestId:uuidv4(),action:'applyCredit',paymentId:'',amount:'',reason:''});
  const [form,setForm]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey))||empty();}catch(_){return empty();}});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(form));}catch(_){/* Retain the request in memory when storage is unavailable. */}},[storageKey,form]);
  const receipts=payments.filter(payment=>payment.source==='manual'&&payment.status==='posted'&&!payment.stripePaymentIntentId);
  if(invoice.stripeInvoiceId||invoice.stripeSubscriptionId||invoice.paymentReviewRequired||['void','uncollectible','draft'].includes(invoice.status))return null;
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const submit=async event=>{
    event.preventDefault();setBusy(true);setError('');setSuccess('');
    try{await manageSalesInvoice({companyId:invoice.companyId,invoiceId:invoice.id,requestId:form.requestId,action:form.action,
      adjustment:{reason:form.reason,...(form.action==='reversePayment'?{paymentId:form.paymentId}:{amountCents:Math.round(Number(form.amount)*100)})}});
      setSuccess('Adjustment recorded. The original receipt remains in the history.');setForm(empty());
    }catch(err){setError(err.message||'Could not record this adjustment. Retry with the same details.');}finally{setBusy(false);}
  };
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-slate-950">Invoice adjustments</h2>
    <p className="mt-2 text-sm text-slate-600">Correct an external receipt or credit this invoice’s open balance. These entries update your records and do not transfer money.</p>
    <form onSubmit={submit} className="mt-4 space-y-3">
      <label className="block text-sm font-semibold">Adjustment<select className="mt-1 min-h-[44px] w-full rounded border p-2" disabled={busy} value={form.action} onChange={e=>set('action',e.target.value)}><option value="applyCredit">Credit open balance</option><option value="reversePayment">Reverse a manual receipt</option></select></label>
      {form.action==='applyCredit'?<label className="block text-sm font-semibold">Credit amount<input required type="number" min="0.01" step="0.01" value={form.amount} disabled={busy} onChange={e=>set('amount',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2" /></label>:<label className="block text-sm font-semibold">Original receipt<select required value={form.paymentId} disabled={busy} onChange={e=>set('paymentId',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"><option value="">Choose a receipt</option>{receipts.map(payment=><option key={payment.id} value={payment.id}>{payment.referenceNumber||payment.method} · {(payment.amountCents/100).toFixed(2)}</option>)}</select></label>}
      <label className="block text-sm font-semibold">Reason<textarea required minLength={8} maxLength={2000} value={form.reason} disabled={busy} onChange={e=>set('reason',e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <button type="submit" disabled={busy} className="min-h-[44px] rounded bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">{busy?'Saving…':'Record adjustment'}</button>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{success&&<p role="status" className="text-sm text-emerald-700">{success}</p>}
    </form>
  </section>;
}
