import React, { useCallback, useEffect, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import toast from "react-hot-toast";
import { db } from "../../../utils/config";
import { manageTechnicianWork } from "../../../utils/technicianWorkflow";
import { getWorkOfferTargetText, normalizeWorkOfferIncentive } from "../../../utils/workOffers";

const EMPTY = [];
const inputClass = "mt-1 w-full rounded-md border border-theme bg-surface px-3 py-2 text-sm text-theme disabled:opacity-60";
const buttonClass = "rounded-md border border-theme px-3 py-2 text-sm font-semibold disabled:opacity-50";
const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
const asDate = value => {
  if (!value) return null;
  const date = value.toDate?.() || new Date(value.seconds ? value.seconds * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const dateInput = value => {
  const date = asDate(value);
  if (!date) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const dateLabel = value => asDate(value)?.toLocaleString() || "Not set";
const workerId = worker => worker.userId || worker.id;
const workerName = worker => worker.userName || worker.name || [worker.firstName, worker.lastName].filter(Boolean).join(" ") || worker.email || "Technician";
const formFor = offer => ({
  title: offer.title || "", description: offer.description || "", adminNotes: offer.adminNotes || "",
  proposedStartDate: dateInput(offer.proposedStartDate),
  completionDeadlineAt: dateInput(offer.completionDeadlineAt || offer.proposedEndDate),
  timelineNotes: offer.timelineNotes || "", estimatedMinutes: String(offer.estimatedMinutes || 0),
  allowsTechnicianSelfScheduling: !!offer.allowsTechnicianSelfScheduling,
  paySource: offer.paySource || "Technician Rate", offeredAmount: String(Number(offer.offeredAmountCents || 0) / 100),
  offerType: offer.offerType || "Direct User", offeredToUserId: offer.offeredToUserId || "",
  boardVisibility: offer.boardVisibility || "Employees & Contractors", boardIds: offer.boardIds || [],
  jobTaskIds: offer.jobTaskIds || [],
});
const incentiveFor = offer => {
  const value = normalizeWorkOfferIncentive(offer);
  return { type: value.type, amount: String(value.amountCents / 100), percentage: String(value.percentage), notes: value.notes };
};
const Field = ({ label, children }) => <label className="block text-sm font-semibold text-theme">{label}{children}</label>;
const Detail = ({ label, children }) => <div><dt className="text-xs font-semibold uppercase text-theme-subtle">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-theme">{children || "—"}</dd></div>;

export default function WorkOfferManagementDialog({ companyId, offer, workers = EMPTY, tasks = EMPTY, boards = EMPTY, initialTab = "details", onClose, onChanged }) {
  const [details, setDetails] = useState(null);
  const [mode, setMode] = useState(initialTab === "delete" ? "details" : initialTab);
  const [form, setForm] = useState(() => formFor(offer));
  const [incentive, setIncentive] = useState(() => incentiveFor(offer));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(initialTab === "delete");
  const [options, setOptions] = useState({ workers, tasks, boards });
  const [optionsError, setOptionsError] = useState("");
  const current = details?.offer || offer;
  const capabilities = details?.management || {};
  const locked = !!capabilities.termsLocked;
  const change = (field, value) => setForm(previous => ({ ...previous, [field]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await manageTechnicianWork(companyId, "details", { offerId: offer.id });
      setDetails(result);
      setMode(previous => (previous === "edit" && !result.management?.canEdit) || (previous === "incentive" && !result.management?.canIncentivize) ? "details" : previous);
      setForm(formFor(result.offer || offer));
      setIncentive(incentiveFor(result.offer || offer));
    } catch (failure) { setError(failure.message || "Could not load this work offer."); }
    finally { setLoading(false); }
  }, [companyId, offer]);
  useEffect(() => { setDetails(null); load(); }, [load]);

  useEffect(() => {
    if (mode !== "edit" || locked || !details) return;
    let cancelled = false;
    setOptionsError("");
    const read = async name => (await getDocs(collection(db, "companies", companyId, name))).docs.map(row => ({ ...row.data(), id: row.id }));
    Promise.all([
      workers.length ? workers : read("companyUsers"),
      tasks.length || !current.jobId ? tasks : read(`workOrders/${current.jobId}/tasks`),
      boards.length ? boards : read("workOfferBoards"),
    ]).then(([workerRows, taskRows, boardRows]) => {
      if (!cancelled) setOptions({ workers: workerRows, tasks: taskRows, boards: boardRows });
    }).catch(() => { if (!cancelled) setOptionsError("Some assignment or task options could not load. Refresh before changing the scope or recipient."); });
    return () => { cancelled = true; };
  }, [mode, locked, details, companyId, current.jobId, workers, tasks, boards]);

  const notify = async result => {
    try { await onChanged?.(result); }
    catch { toast.error("The change was saved, but the list could not refresh. Please refresh the page."); }
  };
  const save = async event => {
    event.preventDefault();
    if (!capabilities.canEdit || busy || loading) return;
    const changes = { title: form.title.trim(), description: form.description, adminNotes: form.adminNotes };
    if (!locked) {
      const worker = options.workers.find(row => workerId(row) === form.offeredToUserId);
      const selectedBoards = options.boards.filter(row => form.boardIds.includes(row.id));
      const boardSelectionChanged = JSON.stringify([...form.boardIds].sort()) !== JSON.stringify([...(current.boardIds || [])].sort());
      Object.assign(changes, {
        proposedStartDate: form.proposedStartDate ? new Date(form.proposedStartDate).getTime() : null,
        completionDeadlineAt: form.completionDeadlineAt ? new Date(form.completionDeadlineAt).getTime() : null,
        proposedEndDate: form.completionDeadlineAt ? new Date(form.completionDeadlineAt).getTime() : null,
        timelineNotes: form.timelineNotes, estimatedMinutes: Number(form.estimatedMinutes),
        allowsTechnicianSelfScheduling: form.allowsTechnicianSelfScheduling,
        paySource: form.paySource, offeredAmountCents: form.paySource === "Offered Amount" ? Math.round(Number(form.offeredAmount) * 100) : 0,
        offerType: form.offerType, postedToBoard: form.offerType === "Internal Board",
        offeredToUserId: form.offerType === "Direct User" ? form.offeredToUserId : "",
        offeredToUserName: form.offerType === "Direct User" ? worker ? workerName(worker) : current.offeredToUserName || "" : "",
        offeredToWorkerType: form.offerType === "Direct User" ? (typeof worker?.workerType === "string" ? worker.workerType : worker?.workerType?.rawValue) || current.offeredToWorkerType || "Not Assigned" : "Not Assigned",
        boardVisibility: form.boardVisibility,
        ...(form.offerType === "Internal Board" ? { boardIds: form.boardIds, boardNames: selectedBoards.length ? selectedBoards.map(row => row.name) : boardSelectionChanged ? [] : current.boardNames || [], boardName: selectedBoards.length ? selectedBoards.map(row => row.name).join(", ") : boardSelectionChanged ? "" : current.boardName || "", boardMemberUserIds: selectedBoards.length ? [...new Set(selectedBoards.flatMap(row => row.memberUserIds || []))] : boardSelectionChanged ? [] : current.boardMemberUserIds || [] } : {}),
        ...(current.jobId && current.workPurpose !== "diagnostic" ? { jobTaskIds: form.jobTaskIds } : {}),
      });
    }
    setBusy(true); setError("");
    try {
      const result = await manageTechnicianWork(companyId, "update", { offerId: current.id, revision: current.revision || 1, changes });
      toast.success("Work offer updated."); setMode("details"); await load(); await notify({ ...result, type: "updated" });
    } catch (failure) { setError(failure.message || "Could not save this work offer."); }
    finally { setBusy(false); }
  };
  const saveIncentive = async event => {
    event.preventDefault();
    if (!capabilities.canIncentivize || capabilities.incentiveLocked || busy || loading) return;
    setBusy(true); setError("");
    try {
      const value = { type: incentive.type, amountCents: incentive.type === "flat" ? Math.round(Number(incentive.amount) * 100) : 0, percentage: incentive.type === "percentage" ? Number(incentive.percentage) : 0, notes: incentive.notes };
      const result = await manageTechnicianWork(companyId, "incentive", { offerId: current.id, revision: current.revision || 1, incentive: value });
      toast.success(value.type === "none" ? "Incentive removed." : "Incentive saved."); setMode("details"); await load(); await notify({ ...result, type: "incentive" });
    } catch (failure) { setError(failure.message || "Could not save the incentive."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!capabilities.canDelete || busy || loading) return;
    setBusy(true); setError("");
    try {
      const result = await manageTechnicianWork(companyId, "delete", { offerId: current.id, revision: current.revision || 1 });
      toast.success("Work offer deleted."); await notify({ ...result, type: "deleted" }); onClose();
    } catch (failure) { setError(failure.message || "Could not delete this work offer."); }
    finally { setBusy(false); }
  };

  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="relative z-50">
    <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
    <div className="fixed inset-0 flex items-center justify-center p-3">
      <DialogPanel className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-theme bg-surface text-theme shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-theme p-5">
          <div><p className="text-xs font-bold uppercase text-theme-subtle">Work offer · {current.status || "Draft"}</p><DialogTitle className="mt-1 text-xl font-bold">{current.title || "Offered Work"}</DialogTitle><p className="mt-1 text-sm text-theme-subtle">{[current.jobInternalId, current.customerName || current.routeName, getWorkOfferTargetText(current)].filter(Boolean).join(" · ")}</p></div>
          <button type="button" className={buttonClass} disabled={busy} onClick={onClose} aria-label="Close work offer">Close</button>
        </header>
        <nav className="flex flex-wrap gap-2 border-b border-theme px-5 py-3" aria-label="Work offer sections">
          {[["details", "Details", true], ["edit", "Edit offer", capabilities.canEdit], ["incentive", "Incentive", capabilities.canIncentivize]].filter(([, , visible]) => visible).map(([tab, label]) => <button type="button" key={tab} disabled={busy || loading} aria-pressed={mode === tab} onClick={() => { setMode(tab); setError(""); setConfirmDelete(false); }} className={`${buttonClass} ${mode === tab ? "bg-blue-700 text-white" : "bg-surface"}`}>{label}</button>)}
          <button type="button" className={`${buttonClass} ml-auto`} disabled={busy || loading} onClick={load}>Refresh offer</button>
        </nav>
        <div className="space-y-5 overflow-y-auto p-5">
          {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {loading ? <p role="status">Loading offer details…</p> : details && <>
            {mode === "details" && <>
              <dl className="grid gap-4 rounded-lg border border-theme bg-surface-soft p-4 sm:grid-cols-2">
                <Detail label="Location">{current.serviceLocationName || current.address?.streetAddress}</Detail><Detail label="Recipient">{getWorkOfferTargetText(current)}</Detail>
                <Detail label="Available from">{dateLabel(current.proposedStartDate)}</Detail><Detail label="Complete by">{dateLabel(current.completionDeadlineAt || current.proposedEndDate)}</Detail>
                <Detail label="Duration">{`${current.estimatedMinutes || 0} minutes`}</Detail><Detail label="Scheduling">{current.allowsTechnicianSelfScheduling ? "Technician can schedule" : "Management schedules"}</Detail>
                <Detail label="Description">{current.description}</Detail><Detail label="Timeline notes">{current.timelineNotes}</Detail>
                <Detail label="Admin notes">{current.adminNotes}</Detail><Detail label="Worker notes">{current.workerNotes}</Detail>
              </dl>
              <section aria-label="Offer pay" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <h3 className="font-bold">{details.pay ? "Agreed pay" : "Offered pay"}</h3>
                <p>{details.pay?.totalCents != null ? money(details.pay.totalCents) : current.paySource === "Offered Amount" ? money(current.offeredAmountCents) : current.paySource || "Technician Rate"}</p>
                <p className="text-sm">{(() => { const value = normalizeWorkOfferIncentive(current); return value.type === "flat" ? `Incentive: ${money(value.amountCents)}` : value.type === "percentage" ? `Incentive: ${value.percentage}%` : "No incentive added"; })()}</p>
                {(details.pay?.lines || []).map(line => <p className="mt-1 text-sm" key={line.id}>{line.title || line.taskName || line.workTypeName || "Work pay"} · {money(line.totalAmountCents)}</p>)}
              </section>
              {details.scopeChanged && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">The job plan has changed since this offer was prepared. Review the scope before changing or accepting work.</p>}
              {["services", "tasks", "products", "stops"].map(kind => <section key={kind} aria-label={`Offer ${kind}`} className="rounded-lg border border-theme p-4"><h3 className="font-bold capitalize">{kind}</h3>{details.scope?.[kind]?.length ? <ul className="mt-2 divide-y divide-slate-200">{details.scope[kind].map(item => <li className="py-2 text-sm" key={item.id}><p className="font-semibold">{item.name || item.itemName || item.dbItemName || "Work item"}</p><p className="whitespace-pre-wrap text-theme-subtle">{item.description}</p><p className="text-theme-subtle">{[item.status, kind === "products" && `Quantity: ${item.quantity || 1}`, item.estimatedTime > 0 && `${item.estimatedTime} min`].filter(Boolean).join(" · ")}</p></li>)}</ul> : <p className="mt-2 text-sm text-theme-subtle">No {kind} in this offer.</p>}</section>)}
              {!!current.claims?.length && <section aria-label="Offer claims" className="rounded-lg border border-theme p-4"><h3 className="font-bold">Claims</h3>{current.claims.map(claim => <p className="mt-2 text-sm" key={claim.id}>{claim.workerName || claim.workerId} · {claim.status}{claim.agreement?.totalCents != null ? ` · ${money(claim.agreement.totalCents)}` : ""}</p>)}</section>}
              {locked && <p className="text-sm text-theme-subtle">Accepted and closed terms are protected. You can edit the title, description, and notes. Accepted work cannot be deleted.</p>}
            </>}
            {mode === "edit" && capabilities.canEdit && <form id="work-offer-edit" onSubmit={save} className="space-y-4">
              {locked && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Agreed pay, scope, assignment, and timing are locked. You can update the offer title, description, and notes.</p>}
              <Field label="Offer title"><input required value={form.title} onChange={event => change("title", event.target.value)} className={inputClass} /></Field>
              <Field label="Description"><textarea rows={3} value={form.description} onChange={event => change("description", event.target.value)} className={inputClass} /></Field>
              <Field label="Admin notes"><textarea rows={2} value={form.adminNotes} onChange={event => change("adminNotes", event.target.value)} className={inputClass} /></Field>
              {!locked && <>
                {optionsError && <p role="status" className="text-sm text-amber-800">{optionsError}</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Available from"><input type="datetime-local" value={form.proposedStartDate} onChange={event => change("proposedStartDate", event.target.value)} className={inputClass} /></Field>
                  <Field label="Completion deadline"><input type="datetime-local" value={form.completionDeadlineAt} onChange={event => change("completionDeadlineAt", event.target.value)} className={inputClass} /></Field>
                  <Field label="Estimated minutes"><input type="number" min="0" required value={form.estimatedMinutes} onChange={event => change("estimatedMinutes", event.target.value)} className={inputClass} /></Field>
                  <Field label="Offer type"><select value={form.offerType} onChange={event => change("offerType", event.target.value)} className={inputClass}><option>Direct User</option><option>Internal Board</option>{form.offerType === "External Company" && <option>External Company</option>}</select></Field>
                </div>
                {form.offerType === "Direct User" && <Field label="Technician"><select required value={form.offeredToUserId} onChange={event => change("offeredToUserId", event.target.value)} className={inputClass}><option value="">Choose a technician</option>{!options.workers.some(row => workerId(row) === form.offeredToUserId) && form.offeredToUserId && <option value={form.offeredToUserId}>{current.offeredToUserName || form.offeredToUserId}</option>}{options.workers.map(worker => <option key={workerId(worker)} value={workerId(worker)}>{workerName(worker)}</option>)}</select></Field>}
                {form.offerType === "Internal Board" && <>
                  <Field label="Board visibility"><select value={form.boardVisibility} onChange={event => change("boardVisibility", event.target.value)} className={inputClass}>{["Employees Only", "Contractors Only", "Employees & Contractors", "Admins Only"].map(value => <option key={value}>{value}</option>)}</select></Field>
                  {!!options.boards.length && <fieldset className="rounded-md border border-theme p-3"><legend className="px-1 text-sm font-semibold">Boards</legend>{options.boards.map(board => <label key={board.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={form.boardIds.includes(board.id)} onChange={event => change("boardIds", event.target.checked ? [...form.boardIds, board.id] : form.boardIds.filter(id => id !== board.id))} />{board.name}</label>)}</fieldset>}
                </>}
                <Field label="Timeline notes"><textarea rows={2} value={form.timelineNotes} onChange={event => change("timelineNotes", event.target.value)} className={inputClass} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowsTechnicianSelfScheduling} onChange={event => change("allowsTechnicianSelfScheduling", event.target.checked)} />Technician can self-schedule</label>
                <Field label="Pay source"><select value={form.paySource} onChange={event => change("paySource", event.target.value)} className={inputClass}>{["Technician Rate", "Task Contracted Rates", "Offered Amount", "Unpaid"].map(value => <option key={value}>{value}</option>)}</select></Field>
                {form.paySource === "Offered Amount" && <Field label="Offered amount"><input type="number" min="0" step="0.01" required value={form.offeredAmount} onChange={event => change("offeredAmount", event.target.value)} className={inputClass} /></Field>}
                {!!current.jobId && current.workPurpose !== "diagnostic" && <fieldset className="rounded-md border border-theme p-3"><legend className="px-1 text-sm font-semibold">Offered tasks</legend>{options.tasks.filter(task => form.jobTaskIds.includes(task.id) || ((!task.claimedWorkOfferId || task.claimedWorkOfferId === current.id) && !["Finished", "Completed", "Cancelled"].includes(task.status))).map(task => <label className="flex items-start gap-2 py-2 text-sm" key={task.id}><input type="checkbox" checked={form.jobTaskIds.includes(task.id)} onChange={event => change("jobTaskIds", event.target.checked ? [...form.jobTaskIds, task.id] : form.jobTaskIds.filter(id => id !== task.id))} />{task.name || task.description || task.id}</label>)}</fieldset>}
              </>}
            </form>}
            {mode === "incentive" && capabilities.canIncentivize && <form id="work-offer-incentive" onSubmit={saveIncentive} className="space-y-4">
              {capabilities.incentiveLocked ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">This offer is fully claimed. Accepted incentives are preserved; use a separate payroll adjustment for an additional bonus.</p> : <>
                {!!current.claims?.length && <p className="text-sm text-theme-subtle">Changes apply to the remaining unclaimed work. Existing claims retain their agreed incentive.</p>}
                <Field label="Incentive type"><select value={incentive.type} onChange={event => setIncentive(previous => ({ ...previous, type: event.target.value }))} className={inputClass}><option value="none">No incentive</option><option value="flat">Flat bonus</option><option value="percentage">Percentage bonus</option></select></Field>
                {incentive.type === "flat" && <Field label="Incentive amount"><input type="number" min="0" step="0.01" required value={incentive.amount} onChange={event => setIncentive(previous => ({ ...previous, amount: event.target.value }))} className={inputClass} /></Field>}
                {incentive.type === "percentage" && <Field label="Incentive percentage"><input type="number" min="0" step="0.01" required value={incentive.percentage} onChange={event => setIncentive(previous => ({ ...previous, percentage: event.target.value }))} className={inputClass} /></Field>}
                <Field label="Incentive notes"><textarea rows={3} value={incentive.notes} onChange={event => setIncentive(previous => ({ ...previous, notes: event.target.value }))} className={inputClass} /></Field>
              </>}
            </form>}
            {confirmDelete && capabilities.canDelete && <section aria-label="Confirm offer deletion" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"><h3 className="font-bold">Delete this work offer?</h3><p className="mt-1 text-sm">The offer will be permanently removed. Pending task and stop reservations will be released. The job, its tasks, and service stops will remain.</p><div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={remove} className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete permanently"}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className={buttonClass}>Keep offer</button></div></section>}
          </>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-theme p-4">
          <div className="flex flex-wrap gap-2">{current.jobId && <Link className={buttonClass} to={`/company/jobs/detail/${current.jobId}/actual`} onClick={event => { if (busy) event.preventDefault(); else onClose(); }}>Open job</Link>}{capabilities.canDelete && <button type="button" disabled={busy || loading} onClick={() => setConfirmDelete(true)} className={`${buttonClass} text-red-700`}>Delete offer</button>}</div>
          {mode === "edit" && capabilities.canEdit && <button type="submit" form="work-offer-edit" disabled={busy || loading} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save offer"}</button>}
          {mode === "incentive" && capabilities.canIncentivize && !capabilities.incentiveLocked && <button type="submit" form="work-offer-incentive" disabled={busy || loading} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save incentive"}</button>}
        </footer>
      </DialogPanel>
    </div>
  </Dialog>;
}
