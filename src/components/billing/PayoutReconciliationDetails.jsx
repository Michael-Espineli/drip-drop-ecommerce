import React,{useState} from 'react';
import {collection,documentId,getDocs,limit,orderBy,query,startAfter,where} from 'firebase/firestore';
import {db} from '../../utils/config';
const cell=value=>{
  const text=typeof value==='number'?String(value):String(value??'').replace(/^[=+@\-\t\r]/,"'$&");
  return `"${text.replace(/"/g,'""')}"`;
};
export const payoutTransactionsCsv=rows=>[['Transaction','Type','Source','Currency','Gross cents','Fee cents','Net cents','Match','Invoice IDs'],...rows.map(row=>[row.id,row.type,row.stripeSourceId,row.currency,row.grossAmountCents,row.feeAmountCents,row.netAmountCents,row.reconciliationStatus,(row.matchedInvoiceIds||[]).join(' ')])].map(row=>row.map(cell).join(',')).join('\r\n');
export default function PayoutReconciliationDetails({payout,companyId}){
  const [rows,setRows]=useState([]),[opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[hasMore,setHasMore]=useState(false),[error,setError]=useState('');
  const fetchPage=async cursor=>getDocs(query(collection(db,'companies',companyId,'stripeBalanceTransactions'),where('stripePayoutId','==',payout.stripePayoutId||payout.id),orderBy(documentId()),...(cursor?[startAfter(cursor)]:[]),limit(100)));
  const load=async()=>{
    setBusy(true);setError('');
    try{const page=await fetchPage(opened?rows.at(-1)?.id:null),next=page.docs.map(doc=>({...doc.data(),id:doc.id}));setRows(current=>opened?[...current,...next]:next);setOpened(true);setHasMore(page.size===100);}
    catch(err){setError(err.message||'Could not load payout transactions.');}finally{setBusy(false);}
  };
  const exportCsv=async()=>{
    setBusy(true);setError('');
    try{let cursor=null,all=[];do{const page=await fetchPage(cursor);all.push(...page.docs.map(doc=>({...doc.data(),id:doc.id})));cursor=page.size===100?page.docs.at(-1).id:null;}while(cursor);
      const url=URL.createObjectURL(new Blob([payoutTransactionsCsv(all)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`payout-${String(payout.id).replace(/[^a-zA-Z0-9_-]/g,'')}.csv`;link.click();URL.revokeObjectURL(url);
    }catch(err){setError(err.message||'Could not export payout transactions.');}finally{setBusy(false);}
  };
  return <div className="mt-2 space-y-2 text-xs">
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} className="min-h-[44px] font-semibold text-blue-700 disabled:opacity-50" onClick={load}>{busy?'Loading…':opened?'Load more transactions':'Review transactions'}</button><button type="button" disabled={busy} className="min-h-[44px] font-semibold text-blue-700 disabled:opacity-50" onClick={exportCsv}>Export transactions CSV</button></div>
    {opened&&<div className="space-y-2">{rows.length===0&&<p>No allocated transactions are available. Refresh reconciliation or review this payout in Stripe.</p>}{rows.map(row=><div key={row.id} className="break-words rounded border bg-slate-50 p-2"><p className="font-semibold">{row.id} · {row.type}</p><p>{row.currency?.toUpperCase()} gross {(row.grossAmountCents/100).toFixed(2)} · fee {(row.feeAmountCents/100).toFixed(2)} · net {(row.netAmountCents/100).toFixed(2)}</p><p>{row.reconciliationStatus} · {row.stripeSourceId||'No source'}</p>{(row.matchedInvoiceIds||[]).map(id=><a key={id} href={`/company/sales/invoices/${encodeURIComponent(id)}`} className="mr-3 inline-block min-h-[44px] py-3 font-semibold text-blue-700">View invoice</a>)}</div>)}{!hasMore&&rows.length>0&&<p>All allocated transactions loaded.</p>}</div>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
