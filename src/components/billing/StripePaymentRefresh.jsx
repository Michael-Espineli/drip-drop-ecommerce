import React,{useState} from 'react';
import {v4 as uuidv4} from 'uuid';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../../utils/config';
import {getCallableAuthPayload} from '../../utils/callableAuth';
export default function StripePaymentRefresh({payment}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[requestId,setRequestId]=useState(uuidv4),[message,setMessage]=useState('');
 if(!payment.stripePaymentIntentId || !['posted','partiallyRefunded','refunded','disputed','reversed'].includes(payment.status))return null;
 const refresh=async()=>{setBusy(true);setError('');setMessage('');try{await httpsCallable(functions,'manageSalesPayment')({...await getCallableAuthPayload(),companyId:payment.companyId,paymentId:payment.id,requestId,action:'refreshStripeStatus'});setRequestId(uuidv4());setMessage('Payment status updated.');}catch(err){setError(err.message || 'Could not refresh the payment. Retry to confirm its status.');}finally{setBusy(false);}};
 return <div><button type="button" disabled={busy} onClick={refresh} className="min-h-[44px] text-sm font-semibold text-blue-700 disabled:opacity-50">{busy?'Refreshing…':'Refresh Stripe status'}</button>{message&&<p role="status" className="text-xs text-slate-600">{message}</p>}{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}</div>;
}
