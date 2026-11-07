import React,{useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../../utils/config';
import {getCallableAuthPayload} from '../../utils/callableAuth';
export default function SalesPaymentReceiptButton({payment,userId}){
 const key=`receipt:${userId}:${payment.companyId}:${payment.id}`;
 const [requestId,setRequestId]=useState(()=>{try{const id=sessionStorage.getItem(key) || uuidv4();sessionStorage.setItem(key,id);return id;}catch(_){return uuidv4();}});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[another,setAnother]=useState(false);
 if(!payment.grossPosted && !['posted','partiallyRefunded','refunded','disputed','reversed'].includes(payment.status))return null;
 const send=async()=>{setBusy(true);setError('');let currentId=requestId;if(another){currentId=uuidv4();setRequestId(currentId);setAnother(false);try{sessionStorage.setItem(key,currentId);}catch(_){}}try{const {data}=await httpsCallable(functions,'sendSalesPaymentReceipt')({...await getCallableAuthPayload(),companyId:payment.companyId,paymentId:payment.id,requestId:currentId});setAnother(['sent','reviewRequired'].includes(data.status));
  setMessage(data.status==='skipped'?'Receipt email is turned off for this invoice.':data.status==='reviewRequired'?'The previous delivery needs review. Check whether it arrived before sending another receipt.':data.status==='sent'?'Receipt sent.':'Receipt email requested.');
 }catch(err){setError(err.message || 'Could not request the receipt. Retry to confirm its status.');}finally{setBusy(false);}};
 return <div className="mt-2"><button type="button" onClick={send} disabled={busy} className="min-h-[44px] text-sm font-semibold text-blue-700 disabled:opacity-50">{busy?'Requesting receipt…':another?'Send another receipt':'Email receipt'}</button>{message&&<p role="status" className="text-xs text-slate-600">{message}</p>}{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}</div>;
}
