import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { appCustomDialog } from '../utils/appDialog';
import { userFacingErrorMessage } from '../utils/permissionErrors';

const dateLabel = key => key && new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(new Date(key + 'T12:00:00Z'));

const stateLabel = {
  history: 'Recorded outcome will stay as shown.',
  started: 'Work has started. This visit will stay as scheduled.',
  coverage: 'This visit has a coverage or pay agreement. Transfer that work separately.',
  previousMove: 'This visit was moved separately and will keep its assignment.',
};
const inputClass = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900';

function CurrentWeekRouteReview({ initialPreview, refresh, save, close }) {
  const dialog = useRef(null);
  const request = useRef({ id: uuid() });
  const [preview, setPreview] = useState(initialPreview);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element.showModal) element.showModal();
    else element.setAttribute('open', '');
    return () => { if (element.close) element.close(); };
  }, []);

  const openVisits = preview.schedules.flatMap(schedule => schedule.visits.filter(visit => visit.state === 'open'));
  const valid = !stale && !preview.schedules.some(schedule => schedule.conflict) &&
    openVisits.every(({ id }) => choices[id]?.action === 'keep' || (
      choices[id]?.action === 'move' && choices[id].dateKey >= preview.today &&
      choices[id].dateKey <= preview.weekEnd && choices[id].techId
    ));
  const setChoice = (id, patch) => setChoices(existing => ({ ...existing, [id]: { ...existing[id], ...patch } }));

  const reload = async () => {
    setBusy(true);
    try {
      const next = await refresh();
      if (!next.reviewRequired) {
        close(null);
        return;
      }
      setPreview(next);
      setChoices({});
      setStale(false);
      setError('');
    } catch (failure) {
      setError(userFacingErrorMessage(failure, failure?.message || 'Could not refresh the schedule review.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async event => {
    event.preventDefault();
    if (!valid || busy) return;
    const selected = openVisits.map(({ id }) => ({ stopId: id, ...choices[id] }));
    const fingerprint = JSON.stringify([preview.previewId, selected]);
    if (request.current.fingerprint !== fingerprint) request.current = { id: uuid(), fingerprint };
    setError('');
    setBusy(true);
    try {
      close(await save({ action: 'commit', previewId: preview.previewId, requestId: request.current.id, choices: selected }));
    } catch (failure) {
      const message = userFacingErrorMessage(failure, failure?.message || 'Could not confirm the schedule change.');
      setError(message);
      setStale(/refresh the review|schedule or visit changed/i.test(message));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="current-week-route-review-heading"
      className="m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[90vh] rounded-xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/70"
      onCancel={event => { event.preventDefault(); if (!busy) close(null); }}
    >
      <form onSubmit={submit} className="flex max-h-[90vh] flex-col">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 id="current-week-route-review-heading" className="text-lg font-semibold">What should happen to this week’s stops?</h2>
          <p className="text-sm text-slate-600">{dateLabel(preview.weekStart)} – {dateLabel(preview.weekEnd)}</p>
        </header>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {preview.schedules.map(schedule => (
            <section key={schedule.id} aria-label={schedule.customer} className="rounded-lg border border-slate-200 p-3">
              <h3 className="font-semibold">{schedule.customer}{schedule.location && ` · ${schedule.location}`}</h3>
              <p className="mt-1 text-sm">From {dateLabel(preview.effectiveDate)} · {schedule.nextDay} · {schedule.nextTech}</p>
              <p className="text-sm text-slate-600">
                {schedule.nextDates.length ? `Next visits: ${schedule.nextDates.map(dateLabel).join(', ')}` : 'No future visits before the service end date.'}
              </p>
              {schedule.conflict && <p role="alert" className="mt-2 text-sm text-rose-700">{schedule.conflict}</p>}
              {!schedule.conflict && !schedule.visits.length && <p className="mt-2 text-sm">No visit is due this week.</p>}
              {schedule.visits.map(visit => {
                const choice = choices[visit.id] || {};
                const technician = preview.technicians.find(tech => tech.id === choice.techId);
                return (
                  <fieldset key={visit.id} className="mt-3 rounded border border-slate-200 p-2" disabled={busy}>
                    <legend className="px-1 text-sm font-semibold">{dateLabel(visit.dateKey)} · {visit.technician}</legend>
                    <p className="text-sm text-slate-600">{visit.status}{visit.state === 'open' && visit.dateKey < preview.today && ' · Overdue'}</p>
                    {visit.state !== 'open' ? <p className="mt-1 text-sm">{stateLabel[visit.state]}</p> : (
                      <div className="mt-2 space-y-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="radio" name={visit.id} checked={choice.action === 'keep'} onChange={() => setChoice(visit.id, { action: 'keep' })} />
                          Keep as scheduled
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name={visit.id} checked={choice.action === 'move'} onChange={() => setChoice(visit.id, { action: 'move' })} />
                          Move this week
                        </label>
                        {choice.action === 'move' && (
                          <>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="grid gap-1">New visit date
                                <input className={inputClass} type="date" min={preview.today} max={preview.weekEnd} value={choice.dateKey || ''} onChange={event => setChoice(visit.id, { dateKey: event.target.value })} required />
                              </label>
                              <label className="grid gap-1">Technician for this visit
                                <select className={inputClass} value={choice.techId || ''} onChange={event => setChoice(visit.id, { techId: event.target.value })} required>
                                  <option value="">Select a technician</option>
                                  {preview.technicians.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
                                </select>
                              </label>
                            </div>
                            {technician && choice.dateKey && <p>This visit moves to {dateLabel(choice.dateKey)} with {technician.name}.</p>}
                          </>
                        )}
                        {choice.action === 'keep' && <p>This visit stays on {dateLabel(visit.dateKey)} with {visit.technician}.</p>}
                      </div>
                    )}
                  </fieldset>
                );
              })}
            </section>
          ))}
        </div>
        <footer className="space-y-2 border-t border-slate-200 px-5 py-4">
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {stale && <button type="button" disabled={busy} onClick={reload} className={inputClass}>Refresh review</button>}
            <button type="button" disabled={busy} onClick={() => close(null)} className={inputClass}>Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Working…' : 'Save change'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

export async function saveWithCurrentWeekReview(callable, payload) {
  const run = async review => {
    const { data } = await callable({ ...payload, ...(review && { currentWeekReview: review }) });
    if (data?.success === false || Number(data?.status) >= 400 || !data) throw new Error(data?.error || 'The schedule change was not confirmed.');
    return data;
  };
  const refresh = () => run({ action: 'preview' });
  const initialPreview = await refresh();
  if (initialPreview.reviewRequired === false) return run();
  if (!initialPreview.previewId) throw new Error('The server did not return a current-week review.');
  return appCustomDialog(close => <CurrentWeekRouteReview initialPreview={initialPreview} refresh={refresh} save={run} close={close} />);
}
