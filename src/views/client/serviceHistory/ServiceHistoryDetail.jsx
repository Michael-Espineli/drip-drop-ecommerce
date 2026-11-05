import WorkspaceHeader from '../../../components/workspace/WorkspaceHeader';
import React, { useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { clientServiceDate } from '../../../utils/clientServiceHistory';
export default function ServiceHistoryDetail() {
  const {
      serviceStopId
    } = useParams(),
    {
      user
    } = useContext(Context);
  const [stop, setStop] = useState(null),
    [records, setRecords] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    if (!user?.uid) return;
    const stopListen = onSnapshot(doc(db, 'homeownerServiceStops', serviceStopId), snapshot => {
      if (!snapshot.exists() || snapshot.data().userId !== user.uid) {
        setError('This service report is unavailable.');
        setLoading(false);
        return;
      }
      setStop({
        ...snapshot.data(),
        id: snapshot.id
      });
      setLoading(false);
    }, () => {
      setError('Could not load this service report. Please try reopening it.');
      setLoading(false);
    });
    const readingsListen = onSnapshot(query(collection(db, 'stopData'), where('userId', '==', user.uid), where('serviceStopId', '==', serviceStopId)), snapshot => setRecords(snapshot.docs.map(d => ({
      ...d.data(),
      id: d.id
    }))), () => setError('Some water readings could not be loaded. Please try reopening this report.'));
    return () => {
      stopListen();
      readingsListen();
    };
  }, [serviceStopId, user?.uid]);
  const readings = records.flatMap(r => r.readings || []),
    dosages = records.flatMap(r => r.dosages || []),
    tasks = stop?.tasks || [];
  const photos = (stop?.photoUrls || []).map(photo => typeof photo === 'string' ? photo : photo.imageURL || photo.url).filter(Boolean);
  const measurements = (title, items) => <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">{title}</h2>{items.length ? <dl className="mt-3 divide-y">{items.map((item, index) => <div key={item.id || index} className="flex justify-between gap-4 py-3"><dt className="min-w-0 break-words text-sm text-slate-600">{item.name || item.label || 'Reading'}</dt><dd className="shrink-0 font-semibold">{item.amount ?? item.value} {item.UOM || item.unit || ''}</dd></div>)}</dl> : <p className="mt-2 text-sm text-slate-500">None recorded for this visit.</p>}</section>;
  return <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6"><Link to="/client/my-pool" className="inline-flex min-h-[44px] items-center font-semibold text-blue-700">Back to my pool</Link>{loading ? <p role="status">Loading service report…</p> : <>{error && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{error}</p>}{stop && <><header><p className="text-sm font-semibold text-blue-700">{stop.companyName}</p><WorkspaceHeader title={<>Service report</>} eyebrow="Your pool care" /><p className="mt-2 text-sm text-slate-500">{clientServiceDate(stop.serviceDate)?.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            }) || 'Date not recorded'}{stop.techName ? ` · ${stop.techName}` : ''}</p></header><section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Visit notes</h2><p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{stop.notes || 'No notes were recorded.'}</p></section>{tasks.length > 0 && <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Work performed</h2><ul className="mt-3 space-y-3">{tasks.map((task, index) => <li key={task.id || index} className="flex justify-between gap-3 text-sm"><span>{task.name}</span><span className="font-semibold text-slate-500">{task.completed ? 'Completed' : task.status || 'Not recorded'}</span></li>)}</ul></section>}{measurements('Water readings', readings)}{measurements('Chemicals added', dosages)}{photos.length > 0 && <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Visit photos</h2><div className="mt-3 grid grid-cols-2 gap-3">{photos.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} loading="lazy" alt={`Service visit attachment ${index + 1}`} className="h-40 w-full rounded-lg object-cover" /></a>)}</div></section>}</>}</>}</div>;
}
