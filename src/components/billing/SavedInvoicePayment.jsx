import React,{useEffect,useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../../utils/config';
import {getCallableAuthPayload} from '../../utils/callableAuth';

export default function SavedInvoicePayment({invoice,userId}){
 const storageKey=`saved-invoice-payment:${userId}:${invoice.companyId}:${invoice.id}`;
 const empty=()=>({requestId:uuidv4(),paymentMethodId:'',authorizationReference:'',authorizationConfirmed:false,frozen:false});
 const [draft,setDraft]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey))||empty();}catch(_){return empty();}});
 const [methods,setMethods]=useState([]),[pending,setPending]=useState([]),[methodType,setMethodType]=useState('card'),[setupRequest,setSetupRequest]=useState(()=>uuidv4());
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[setupUrl,setSetupUrl]=useState('');
 const call=async(name,data={})=>(await httpsCallable(functions,name)({...await getCallableAuthPayload(),companyId:invoice.companyId,invoiceId:invoice.id,...data})).data;
 const refresh=async()=>{setBusy(true);setError('');try{const result=await call('listSavedPaymentMethods');setMethods(result.methods);setPending(result.pending);}catch(err){setError(err.message||'Could not load saved methods.');}finally{setBusy(false);}};
 // Load on demand: invoice review should continue to work for companies without Stripe enabled.
 useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch(_){/* Retain retry details in memory. */}},[draft,storageKey]);
 const setup=async()=>{setBusy(true);setError('');try{const result=await call('createSavedPaymentSetup',{requestId:setupRequest,paymentMethodType:methodType,returnUrl:window.location.href});setSetupUrl(result.url);setMessage(result.url?'Share this secure Stripe setup link with the customer. No payment is taken during setup.':'This setup is complete or expired. Refresh saved methods or create another link.');}catch(err){setError(err.message||'Could not create the setup link. Retry with the same selection.');}finally{setBusy(false);}};
 const charge=async event=>{
  event.preventDefault();setBusy(true);setError('');setDraft(current=>({...current,frozen:true}));
  try{const result=await call('chargeSavedInvoice',draft);setMessage(result.status==='succeeded'?'Payment collected.':result.status==='customerActionRequired'?'The saved method needs customer attention. Send the invoice payment link.':result.status==='paymentReview'?'A previously collected payment needs review. Confirm its Stripe return or reversal before collecting again.':'Payment is processing. Wait for confirmation before collecting another payment.');setDraft(empty());}
  catch(err){if(err.details?.safeToRevise)setDraft(current=>({...current,requestId:uuidv4(),frozen:false}));setError(err.message||'Payment could not be confirmed. Retry the same request to check it.');}
  finally{setBusy(false);}
 };
 if(!invoice.customerId||invoice.stripeInvoiceId||invoice.stripeSubscriptionId)return null;
 return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
  <h2 className="text-lg font-bold text-slate-950">Saved customer payment methods</h2>
  <p className="mt-2 text-sm text-slate-600">Save a card or bank account through Stripe, then collect an authorized invoice. Bank payments can take several business days to confirm.</p>
  <div className="mt-4 flex flex-wrap items-end gap-3">
   <label className="text-sm font-semibold">Method to save<select aria-label="Method to save" value={methodType} disabled={busy} onChange={e=>{setMethodType(e.target.value);setSetupRequest(uuidv4());setSetupUrl('');}} className="ml-2 min-h-[44px] rounded border p-2"><option value="card">Credit or debit card</option><option value="ach">US bank account (ACH)</option></select></label>
   <button type="button" disabled={busy} onClick={setup} className="min-h-[44px] rounded border px-4 font-semibold">Create secure setup link</button>
   <button type="button" disabled={busy} onClick={()=>{setSetupRequest(uuidv4());setSetupUrl('');setMessage('Ready to create a new setup link.');}} className="min-h-[44px] rounded border px-4">New setup</button>
   <button type="button" disabled={busy} onClick={refresh} className="min-h-[44px] rounded border px-4 font-semibold">Refresh saved methods</button>
  </div>
  {setupUrl&&<label className="mt-3 block text-sm font-semibold">Customer setup link<input readOnly aria-label="Customer setup link" value={setupUrl} onFocus={e=>e.target.select()} className="mt-1 min-h-[44px] w-full rounded border p-2"/></label>}
  {pending.map((item,index)=><p key={index} className="mt-3 text-sm text-amber-800">Bank verification is pending. {item.verificationUrl&&<a href={item.verificationUrl} target="_blank" rel="noreferrer" className="underline">Open Stripe verification</a>}</p>)}
  {(methods.length>0||draft.frozen)&&<form onSubmit={charge} className="mt-4 space-y-3">
   <label className="block text-sm font-semibold">Saved method<select required aria-label="Saved method" value={draft.paymentMethodId} disabled={busy||draft.frozen} onChange={e=>setDraft({...draft,paymentMethodId:e.target.value})} className="mt-1 min-h-[44px] w-full rounded border p-2"><option value="">Choose a saved method</option>{methods.map(method=><option key={method.id} value={method.id}>{method.bankName||method.brand||method.type} ending {method.last4}</option>)}</select></label>
   <label className="block text-sm font-semibold">Authorization reference<input required minLength={8} maxLength={1000} value={draft.authorizationReference} disabled={busy||draft.frozen} onChange={e=>setDraft({...draft,authorizationReference:e.target.value})} placeholder="Agreement number or dated customer approval" className="mt-1 min-h-[44px] w-full rounded border p-2"/></label>
   <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={draft.authorizationConfirmed} disabled={busy||draft.frozen} onChange={e=>setDraft({...draft,authorizationConfirmed:e.target.checked})}/><span>I have customer authorization to collect this invoice’s outstanding balance using the selected method.</span></label>
   <button type="submit" disabled={busy||!draft.paymentMethodId} className="min-h-[44px] rounded bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">{busy?'Confirming payment…':draft.frozen?'Confirm original payment':'Collect invoice balance'}</button>
  </form>}
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
 </section>;
}
