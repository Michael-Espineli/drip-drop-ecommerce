import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import WorkspaceHeader from '../../../components/workspace/WorkspaceHeader';
import React, { useState, useContext, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db, storage, functions } from '../../../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { v4 as uuidv4 } from 'uuid';
import RepairRequestPriority from '../../../components/RepairRequestPriority';
import { DEFAULT_ISSUE_PRIORITY } from '../../../utils/models/JobPlan';
import { readClientDraft, saveClientDraft, clearClientDraft } from '../../../utils/clientDrafts';
export default function NewRepairRequest() {
  const {
      user
    } = useContext(Context),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const draftKey = `client-repair:${user?.uid}`,
    draft = useRef(readClientDraft(draftKey)).current;
  const [locations, setLocations] = useState([]),
    [relationships, setRelationships] = useState([]),
    [bodies, setBodies] = useState([]),
    [equipment, setEquipment] = useState([]);
  const [locationId, setLocationId] = useState(params.get('locationId') || draft.locationId || ''),
    [bodyId, setBodyId] = useState(''),
    [equipmentId, setEquipmentId] = useState('');
  const [companyId, setCompanyId] = useState(draft.companyId || ''),
    [description, setDescription] = useState(draft.description || '');
  const [priority, setPriority] = useState(draft.priority || DEFAULT_ISSUE_PRIORITY),
    [files, setFiles] = useState([]),
    [previews, setPreviews] = useState([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('');
  const submissionId = useRef(draft.submissionId || uuidv4()),
    submitting = useRef(false),
    uploaded = useRef(null);
  useEffect(() => {
    saveClientDraft(draftKey, {
      description,
      locationId,
      companyId,
      priority,
      submissionId: submissionId.current
    });
  }, [draftKey, description, locationId, companyId, priority]);
  useEffect(() => {
    let active = true;
    if (!user?.uid) return;
    Promise.all([getDocs(query(collection(db, 'homeownerServiceLocations'), where('userId', '==', user.uid))), getDocs(query(collection(db, 'customerCompanyRelationships'), where('homeownerUserId', '==', user.uid)))]).then(([l, r]) => {
      if (!active) return;
      const list = l.docs.map(d => ({
        ...d.data(),
        id: d.id
      }));
      setLocations(list);
      setRelationships(r.docs.map(d => ({
        ...d.data(),
        id: d.id
      })).filter(r => r.status === 'active'));
      if (list.length === 1) setLocationId(current => current || list[0].id);
    }).catch(() => {
      if (active) setError('Could not load your addresses and companies. Reopen this page to try again.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user?.uid]);
  const location = locations.find(l => l.id === locationId);
  const companies = [...new Map(relationships.filter(r => !location?.linkedCompanyId || r.companyId === location.linkedCompanyId).map(r => [r.companyId, r])).values()];
  useEffect(() => {
    setCompanyId(current => companies.some(c => c.companyId === current) ? current : companies.length === 1 ? companies[0].companyId : '');
  }, [relationships, locationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    setBodies([]);
    setBodyId('');
    setEquipment([]);
    setEquipmentId('');
    if (locationId && user?.uid) getDocs(query(collection(db, 'homeownerBodiesOfWater'), where('serviceLocationId', '==', locationId), where('userId', '==', user.uid))).then(s => {
      if (active) setBodies(s.docs.map(d => ({
        ...d.data(),
        id: d.id
      })));
    }).catch(() => {
      if (active) setError('Could not load pools. You can send the request without choosing a pool.');
    });
    return () => {
      active = false;
    };
  }, [locationId, user?.uid]);
  useEffect(() => {
    let active = true;
    setEquipment([]);
    setEquipmentId('');
    if (bodyId && user?.uid) getDocs(query(collection(db, 'homeownerEquipment'), where('bodyOfWaterId', '==', bodyId), where('userId', '==', user.uid))).then(s => {
      if (active) setEquipment(s.docs.map(d => ({
        ...d.data(),
        id: d.id
      })));
    }).catch(() => {
      if (active) setError('Could not load equipment. You can send without selecting equipment.');
    });
    return () => {
      active = false;
    };
  }, [bodyId, user?.uid]);
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  const chooseFiles = event => {
    const next = Array.from(event.target.files || []);
    event.target.value = '';
    if (next.length > 3 || next.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 10 * 1024 * 1024)) {
      setError('Choose up to three JPG, PNG, or WebP photos, each under 10 MB.');
      return;
    }
    uploaded.current = null;
    setFiles(next);
    setError('');
  };
  const submit = async event => {
    event.preventDefault();
    if (submitting.current) return;
    if (!locationId || !companyId || !description.trim()) {
      setError('Choose the address and company, and describe the issue.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      let photoUrls = uploaded.current;
      if (!photoUrls) {
        photoUrls = [];
        for (let index = 0; index < files.length; index++) {
          setProgress(`Uploading photo ${index + 1} of ${files.length}…`);
          const file = files[index];
          const fileRef = ref(storage, `repair-requests/${user.uid}/${submissionId.current}/${index}`);
          await uploadBytes(fileRef, file, {
            contentType: file.type
          });
          photoUrls.push(await getDownloadURL(fileRef));
        }
        uploaded.current = photoUrls;
      }
      setProgress('Sending request…');
      const {
        data
      } = await httpsCallable(functions, 'submitHomeownerRepairRequest')({
        ...(await getCallableAuthPayload()),
        submissionId: submissionId.current,
        companyId,
        locationId,
        bodyOfWaterId: bodyId,
        equipmentId,
        description: description.trim(),
        issuePriorityLevel: priority,
        photoUrls,
        equipmentStatusUpdate: equipmentId ? 'Needs Repair' : ''
      });
      clearClientDraft(draftKey);
      navigate(`/client/repair-requests/${data.requestId}`, {
        replace: true
      });
    } catch (err) {
      setError(userFacingErrorMessage(err, err.message || 'Could not send your request. Your details are kept here; please try again.'));
    } finally {
      submitting.current = false;
      setBusy(false);
      setProgress('');
    }
  };
  const input = 'mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base';
  const picker = (label, value, set, items, placeholder) => <label className="block text-sm font-semibold">{label}<select disabled={busy} className={input} value={value} onChange={event => set(event.target.value)}><option value="">{placeholder}</option>{items.map(item => <option key={item.id} value={item.id}>{item.label || item.name || item.nickName || item.address?.streetAddress || 'Saved item'}</option>)}</select></label>;
  return <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6"><Link to="/client/repair-requests" className="inline-flex min-h-[44px] items-center text-blue-700">Back to requests</Link><WorkspaceHeader title={<>Report a pool problem</>} eyebrow="Your pool care" /><p className="text-slate-600">Send a repair request directly to your pool company.</p>{loading ? <p role="status">Loading your account…</p> : <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-5">
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        {picker('Service address', locationId, setLocationId, locations, 'Choose an address')}
        {!locations.length && <Link to={`/serviceLocation/create?returnTo=${encodeURIComponent('/client/repair-requests/new')}`} className="inline-flex min-h-[44px] items-center font-semibold text-blue-700">Add a service address</Link>}
        {picker('Receiving company', companyId, setCompanyId, companies.map(c => ({
        id: c.companyId,
        label: c.companyName || 'Pool company'
      })), 'Choose your company')}
        {!companies.length && <p className="text-sm text-slate-600">Ask your pool company for an account invitation, or <Link className="font-semibold text-blue-700" to="/client/companies">find a company and request service</Link>.</p>}
        {bodies.length > 0 && picker('Pool or spa (optional)', bodyId, setBodyId, bodies, 'Any pool at this address')}
        {equipment.length > 0 && picker('Equipment (optional)', equipmentId, setEquipmentId, equipment, 'No specific equipment')}
        <RepairRequestPriority value={priority} onChange={setPriority} disabled={busy} />
        <label className="block text-sm font-semibold">Describe the issue<textarea value={description} disabled={busy} maxLength={5000} required rows={5} onChange={e => setDescription(e.target.value)} className={`${input} py-3`} /></label>
        <label className="block text-sm font-semibold">Photos (optional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={chooseFiles} className="mt-2 block w-full text-sm" /></label><p className="text-xs text-slate-500">Up to three photos, 10 MB each. Photos must be selected again if you leave this page.</p>
        <div className="grid grid-cols-3 gap-2">{previews.map((url, index) => <img key={url} src={url} alt={`Selected attachment ${index + 1}`} className="h-24 w-full rounded-lg object-cover" />)}</div>
        {progress && <p role="status" className="text-sm text-slate-600">{progress}</p>}<button disabled={busy || !companyId || !locationId} className="min-h-[48px] w-full rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send repair request'}</button>
    </form>}</div>;
}
