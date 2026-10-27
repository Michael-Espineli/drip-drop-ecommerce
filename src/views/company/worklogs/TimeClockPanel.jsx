import React,{useContext,useEffect,useState} from 'react';
import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {Context} from '../../../context/AuthContext';
import {db} from '../../../utils/config';
import {technicianWorkflow} from '../../../utils/technicianWorkflow';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
const asDate=v=>v?.toDate?.() || new Date(v);
const duration=(start,end)=>{const minutes=Math.max(0,Math.round((asDate(end || new Date())-asDate(start))/60000));return Math.floor(minutes/60)+'h '+minutes%60+'m';};
export default function TimeClockPanel({companyId}) {
 const {user}=useContext(Context),[log,setLog]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[offers,setOffers]=useState([]),[offerId,setOfferId]=useState(''),[,setTick]=useState(0);
 useEffect(()=>{if(!companyId||!user?.uid)return;return onSnapshot(query(collection(db,'companies',companyId,'workLogs'),where('userId','==',user.uid),where('current','==',true)),s=>setLog(s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null),e=>setError(e.message));},[companyId,user?.uid]);
 useEffect(()=>{if(!companyId)return;technicianWorkflow('manageTechnicianWork',{companyId,action:'list'}).then(result=>setOffers(result.offers.filter(o=>o.claims?.some(c=>c.workerId===user?.uid&&['Accepted','Scheduled','In Progress'].includes(c.status))))).catch(e=>setError(e.message));},[companyId,user?.uid]);
 useEffect(()=>{if(log?.workOfferId)setOfferId(log.workOfferId);},[log?.workOfferId]);
 useEffect(()=>{const timer=setInterval(()=>setTick(v=>v+1),30000);return()=>clearInterval(timer);},[]);
 const act=async action=>{setBusy(true);setError('');try{await technicianWorkflow('manageTechnicianClock',{companyId,action,offerId,requestId:crypto.randomUUID()});}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5 text-slate-900"><h2 className="text-xl font-bold">Time Clock</h2><p className="mt-1">{log?log.type+' · '+duration(log.startTime):'Clocked out'}</p>{error&&<p role="alert" className="text-red-700">{error}</p>}<label className="mt-3 block text-sm">Work allocation<select value={offerId} onChange={e=>setOfferId(e.target.value)} disabled={busy} className="ml-2 rounded border p-2"><option value="">General shift / route work</option>{offers.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select></label>{log&&<button disabled={busy} onClick={()=>act('working')} className="mt-2 rounded border px-3 py-2">Switch work allocation</button>}<div className="mt-3 flex flex-wrap gap-2">{(log?log.type==='Working'?[['break','Start break'],['lunch','Start lunch'],['clockOut','Clock out']]:[['working','Back to work'],['clockOut','Clock out']]:[['clockIn','Clock in']]).map(([a,title])=><button key={a} disabled={busy} onClick={()=>act(a)} className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy?'Saving…':title}</button>)}</div><p className="mt-2 text-sm text-slate-500">Shift time is tracked independently of route activity. Pay follows your company’s selected time source and rules.</p></section>;
}
export function ShiftLogHistory({companyId}) {
 const {user}=useContext(Context),{can}=useCompanyPermissions(),manager=can('420'),[logs,setLogs]=useState([]),[error,setError]=useState('');
 useEffect(()=>{if(!companyId||!user?.uid)return;const base=collection(db,'companies',companyId,'workLogs');return onSnapshot(manager?base:query(base,where('userId','==',user.uid)),s=>setLogs(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asDate(b.startTime)-asDate(a.startTime)).slice(0,100)),e=>setError(e.message));},[companyId,user?.uid,manager]);
 return <section className="mb-5 rounded-xl border bg-white p-5 text-slate-900"><h2 className="text-xl font-bold">Shift and clock history</h2>{error&&<p role="alert">{error}</p>}{!logs.length&&<p className="mt-2 text-sm text-slate-500">No shift logs recorded.</p>}<ul className="divide-y">{logs.map(v=><li key={v.id} className="flex flex-wrap justify-between gap-2 py-3"><span>{v.userName} · {v.type}</span><span>{asDate(v.startTime).toLocaleString()} · {duration(v.startTime,v.endTime)}{v.current?' · Active':''}</span></li>)}</ul></section>;
}
