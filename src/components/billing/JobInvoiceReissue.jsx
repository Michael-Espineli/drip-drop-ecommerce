import React,{useEffect,useState} from 'react';
import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {Link} from 'react-router-dom';
import {db,functions} from '../../utils/config';
export default function JobInvoiceReissue({invoice}){
  const [agreements,setAgreements]=useState([]),[agreementId,setAgreementId]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState('');
  useEffect(()=>{
    if(!invoice.jobId||!['void','voided'].includes(invoice.status))return undefined;
    return onSnapshot(query(collection(db,'salesAgreements'),where('companyId','==',invoice.companyId),where('jobId','==',invoice.jobId)),snapshot=>setAgreements(snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).filter(agreement=>agreement.status==='accepted')),err=>setError(err.message));
  },[invoice.companyId,invoice.jobId,invoice.status]);
  if(!invoice.jobId||!['void','voided'].includes(invoice.status)||!invoice.acceptedPricingSnapshotHash)return null;
  const submit=async event=>{
    event.preventDefault();setBusy(true);setError('');
    try{const result=await httpsCallable(functions,'createJobSalesInvoice')({companyId:invoice.companyId,jobId:invoice.jobId,agreementId,contractId:invoice.contractId||'',replaceClosedInvoiceId:invoice.id,reason});setCreated(result.data.id);}
    catch(err){setError(err.message||'Could not reissue this invoice.');}finally{setBusy(false);}
  };
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Reissue from an accepted revision</h2><p className="mt-2 text-sm text-slate-600">Select a newly accepted estimate and explain the change. The original invoice remains void. Invoices with receipts or write-offs require separate resolution.</p>
    {created?<Link to={`/company/sales/invoices/${created}`} className="mt-4 block font-semibold text-blue-700">Open reissued invoice</Link>:<form className="mt-4 space-y-3" onSubmit={submit}>
      <label className="block text-sm font-semibold">Accepted estimate<select required value={agreementId} disabled={busy} onChange={event=>setAgreementId(event.target.value)} className="mt-1 min-h-[44px] w-full rounded border p-2"><option value="">Choose a revision</option>{agreements.map(agreement=><option key={agreement.id} value={agreement.id}>{agreement.title||agreement.agreementNumber||'Estimate'} · Revision {agreement.revisionNumber||0}</option>)}</select></label>
      <label className="block text-sm font-semibold">Reason<textarea required minLength={8} maxLength={2000} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <button disabled={busy} type="submit" className="min-h-[44px] rounded bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">{busy?'Creating…':'Create revised invoice'}</button>
    </form>}{error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>;
}
