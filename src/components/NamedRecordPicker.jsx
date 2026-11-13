import React, { useEffect, useState } from 'react';
import { db } from '../utils/config';
import { fetchConversationLinkPickerItems } from '../utils/chatMessaging';
import { displayReferenceValue } from '../utils/displayReferences';

export default function NamedRecordPicker({ companyId, type, value = '', currentLabel = '', label = 'Record', onChange, disabled = false }) {
  const scope = `${companyId || ''}/${type || ''}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ scope: '', items: [], loading: true, error: '' });
  const state = result.scope === scope ? result : { items: [], loading: true, error: '' };
  useEffect(() => {
    let active = true;
    if (!companyId || !type || disabled) return undefined;
    setResult({ scope, items: [], loading: true, error: '' });
    fetchConversationLinkPickerItems({ db, companyId, type, audience: 'company', maxResults: null })
      .then((items) => { if (active) setResult({ scope, items, loading: false, error: '' }); })
      .catch(() => { if (active) setResult({ scope, items: [], loading: false, error: 'Records could not be loaded.' }); });
    return () => { active = false; };
  }, [companyId, type, disabled, scope, attempt]);
  const enabled = Boolean(companyId && type && !disabled);
  return (
    <div>
      <select aria-label={label} value={value} disabled={!enabled || state.loading} onChange={(event) => onChange(state.items.find((item) => (item.recordId || item.id) === event.target.value) || null)} className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
        <option value="">{enabled && state.loading ? 'Loading…' : 'Choose a record'}</option>
        {value && !state.items.some((item) => (item.recordId || item.id) === value) && <option value={value}>{displayReferenceValue(currentLabel || 'Current record', 'Current record')}</option>}
        {state.items.map((item) => <option key={item.recordId || item.id} value={item.recordId || item.id}>{displayReferenceValue(item.title || item.label || 'Record', 'Record')}</option>)}
      </select>
      {enabled && !state.loading && state.items.length === 0 && !state.error && <p className="mt-1 text-xs text-slate-500">No records available for selection.</p>}
      {state.error && <p role="alert" className="mt-2 text-sm text-rose-700">{state.error} <button type="button" onClick={() => setAttempt((current) => current + 1)} className="min-h-[44px] font-semibold underline">Try again</button></p>}
    </div>
  );
}
