import React,{useEffect,useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../../utils/config';
import {getCallableAuthPayload} from '../../utils/callableAuth';

export default function StripeInvoiceActions({invoice,userId}){
 const storageKey=`stripe-invoice-command:${userId}:${invoice.companyId}:${invoice.id}`;
 const empty=()=>({requestId:uuidv4(),action:'refresh',reason:'',amount:'',method:'check',referenceNumber:'',receivedDate:new Date().toLocaleDateString('en-CA'),memo:'',lines:(invoice.lineItems||[]).map(line=>({id:line.id,description:line.name||line.description||'',amount:((line.totalAmountCents||0)/100).toFixed(2)})),frozen:false});
 const [draft,setDraft]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey))||empty();}catch(_){return empty();}}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch(_){/* Keep request details in memory. */}},[draft,storageKey]);
 if(!invoice.stripeInvoiceId)return null;
 const set=(key,value)=>setDraft(current=>({...current,[key]:value}));
 const submit=async event=>{
  event.preventDefault();setBusy(true);setError('');setDraft(current=>({...current,frozen:true}));
  try{
   const payload={companyId:invoice.companyId,invoiceId:invoice.id,requestId:draft.requestId,action:draft.action,reason:draft.reason,expectedTotalAmountCents:draft.expectedTotalAmountCents ?? invoice.totalAmountCents};
   setDraft(current=>({...current,expectedTotalAmountCents:payload.expectedTotalAmountCents}));
   if(draft.action==='credit')payload.amountCents=Math.round(Number(draft.amount)*100);
   if(draft.action==='updateDraftLines')payload.lines=draft.lines.map(line=>({...line,amount:Math.round(Number(line.amount)*100)}));
   if(draft.action==='recordExternalPayment')payload.payment={amountCents:Math.round(Number(draft.amount)*100),method:draft.method,receivedAtMillis:new Date(`${draft.receivedDate}T12:00:00`).getTime(),referenceNumber:draft.referenceNumber,memo:draft.memo};
   await httpsCallable(functions,'manageStripeInvoice')({...await getCallableAuthPayload(),...payload});setMessage('Stripe invoice synchronized.');setDraft(empty());
  }catch(err){if(err.details?.safeToRevise)setDraft(current=>({...current,requestId:uuidv4(),frozen:false,expectedTotalAmountCents:undefined}));setError(err.message||'Could not confirm this change. Retry the original request.');}finally{setBusy(false);}
 };
 return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
  <h2 className="text-lg font-bold text-slate-950">Manage Stripe invoice</h2>
  <p className="mt-2 text-sm text-slate-600">Draft line changes apply to this invoice. Pause automatic finalization before editing, then finalize when ready. Credits here reduce unpaid balances. Use the refund control to return collected money.</p>
  <form onSubmit={submit} className="mt-4 space-y-3">
   <label className="block text-sm font-semibold">Invoice action<select aria-label="Stripe invoice action" value={draft.action} disabled={busy||draft.frozen} onChange={e=>setDraft({...empty(),action:e.target.value})} className="mt-1 min-h-[44px] w-full rounded border p-2"><option value="refresh">Refresh from Stripe</option>{invoice.status==='draft'?<><option value="pauseDraft">Pause automatic finalization</option><option value="updateDraftLines">Edit draft lines</option><option value="finalize">Finalize draft for collection</option></>:<><option value="void">Void unpaid invoice</option><option value="writeOff">Write off unpaid invoice</option><option value="credit">Credit unpaid balance</option><option value="recordExternalPayment">Record full external payment</option></>}</select></label>
   {draft.action==='updateDraftLines'&&draft.lines.map((line,index)=><div key={line.id} className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Line description<input required value={line.description} disabled={busy||draft.frozen} onChange={e=>set('lines',draft.lines.map((item,i)=>i===index?{...item,description:e.target.value}:item))} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label><label className="text-sm">Line total<input required type="number" step="0.01" value={line.amount} disabled={busy||draft.frozen} onChange={e=>set('lines',draft.lines.map((item,i)=>i===index?{...item,amount:e.target.value}:item))} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label></div>)}
   {['credit','recordExternalPayment'].includes(draft.action)&&<label className="block text-sm font-semibold">Amount<input required type="number" min="0.01" step="0.01" value={draft.amount} disabled={busy||draft.frozen} onChange={e=>set('amount',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label>}
   {draft.action==='recordExternalPayment'&&<><p className="text-sm text-slate-600">Record money already received outside Stripe. This action marks an unpaid invoice paid in Stripe and does not debit the customer. Partial or mixed payments require review in Stripe.</p><label className="block text-sm font-semibold">Payment method<select value={draft.method} disabled={busy||draft.frozen} onChange={e=>set('method',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2">{['cash','check','externalCard','bankTransfer','other'].map(method=><option key={method} value={method}>{method}</option>)}</select></label><label className="block text-sm font-semibold">Received date<input required type="date" value={draft.receivedDate} disabled={busy||draft.frozen} onChange={e=>set('receivedDate',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label><label className="block text-sm font-semibold">Payment reference<input value={draft.referenceNumber} disabled={busy||draft.frozen} onChange={e=>set('referenceNumber',e.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label></>}
   {draft.action!=='refresh'&&<label className="block text-sm font-semibold">Reason<textarea required minLength={8} maxLength={1000} value={draft.reason} disabled={busy||draft.frozen} onChange={e=>set('reason',e.target.value)} className="mt-1 w-full rounded border p-2"/></label>}
   <button type="submit" disabled={busy} className="min-h-[44px] rounded bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">{busy?'Confirming…':draft.frozen?'Confirm original change':'Apply invoice action'}</button>
  </form>
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
 </section>;
}
