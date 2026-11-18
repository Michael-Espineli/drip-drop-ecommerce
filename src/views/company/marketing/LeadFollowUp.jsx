import React, {useContext, useEffect, useState} from 'react';
import {doc, onSnapshot, serverTimestamp, setDoc} from 'firebase/firestore';
import {Context} from '../../../context/AuthContext';
import {db} from '../../../utils/config';

const dateInput = value => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
export default function LeadFollowUp({leadId, companyId, canEdit}) {
  const {user, dataBaseUser} = useContext(Context);
  const [form, setForm] = useState({ownerUserId: '', ownerName: '', nextAction: '', nextContactDate: ''});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => {
    setForm({ownerUserId: '', ownerName: '', nextAction: '', nextContactDate: ''}); setError('');
    if (!companyId || !leadId) return undefined;
    return onSnapshot(doc(db, 'companies', companyId, 'leadPrivateNotes', leadId), snapshot => {
      const value = snapshot.data()?.salesFollowUp || {};
      setForm({...value, ownerName: value.ownerName || '', nextAction: value.nextAction || '', nextContactDate: dateInput(value.nextContactAt)});
    }, e => setError(e.message || 'Could not load follow-up.'));
  }, [companyId, leadId]);
  const change = (field, value) => { setSaved(false); setForm(current => ({...current, [field]: value})); };
  async function save() {
    if (!canEdit || busy) return;
    setBusy(true); setError('');
    try {
      await setDoc(doc(db, 'companies', companyId, 'leadPrivateNotes', leadId), {id: leadId, companyId, leadId, visibility: 'companyOnly',
        salesFollowUp: {ownerUserId: form.ownerUserId || '', ownerName: form.ownerName.trim(), nextAction: form.nextAction.trim(),
          nextContactAt: form.nextContactDate ? new Date(`${form.nextContactDate}T12:00:00`) : null, updatedAt: serverTimestamp(), updatedByUserId: user?.uid || ''}}, {merge: true});
      setSaved(true);
    } catch (e) { setError(e.message || 'Could not save follow-up.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-label="Sales follow-up">
    <h3 className="text-lg font-semibold text-slate-900">Sales Follow-up <span className="ml-2 text-xs font-normal text-slate-500">Company only</span></h3>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <fieldset disabled={!canEdit || busy} className="mt-4 space-y-3">
      <label className="block text-sm font-semibold">Assigned salesperson<input aria-label="Assigned salesperson" value={form.ownerName} onChange={e => { change('ownerName', e.target.value); change('ownerUserId', ''); }} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>
      <button type="button" onClick={() => { change('ownerUserId', user?.uid || ''); change('ownerName', dataBaseUser?.userName || user?.displayName || user?.email || ''); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">Assign to Me</button>
      <label className="block text-sm font-semibold">Next action<input aria-label="Next sales action" value={form.nextAction} onChange={e => change('nextAction', e.target.value)} placeholder="Call customer, prepare agreement, collect billing…" className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>
      <label className="block text-sm font-semibold">Next contact date<input aria-label="Next contact date" type="date" value={form.nextContactDate} onChange={e => change('nextContactDate', e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>
      <button type="button" onClick={save} className="min-h-[44px] rounded-md bg-blue-600 px-4 py-2 font-semibold text-white">{busy ? 'Saving…' : 'Save Follow-up'}</button>
    </fieldset>
    {saved && <p role="status" className="mt-2 text-sm text-emerald-700">Follow-up saved.</p>}
  </section>;
}
