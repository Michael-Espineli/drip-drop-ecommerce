import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import RouteWorkOfferSummary from './RouteWorkOfferSummary';
import React, { useCallback, useEffect, useRef, useState } from "react";
import WorkOfferReturnDialog from "./WorkOfferReturnDialog";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { FiBriefcase, FiCalendar, FiCheckSquare, FiDollarSign, FiGift, FiRefreshCw, FiUser, FiX, FiFileText } from "react-icons/fi";
import toast from "react-hot-toast";
import { db } from "../../../utils/config";
import { manageTechnicianWork } from "../../../utils/technicianWorkflow";
import { getWorkOfferTargetText, normalizeWorkOfferIncentive } from "../../../utils/workOffers";

const EMPTY = [];
const inputClass = "mt-1 min-h-10 w-full rounded-md border border-theme bg-surface px-3 py-2 text-sm font-normal text-theme outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-theme bg-surface px-3 py-2 text-sm font-semibold text-theme-muted transition hover:bg-surface-soft disabled:opacity-50";
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
const Detail = ({ label, children }) => <div className="min-w-0"><dt className="text-sm font-semibold text-theme-muted">{label}</dt><dd className="mt-1 min-h-10 whitespace-pre-wrap break-words rounded-md bg-surface-soft px-3 py-2 text-sm text-theme">{children ?? "—"}</dd></div>;
const OfferSection = ({ title, icon: Icon, children }) => <section aria-label={title} className="min-w-0 overflow-hidden rounded-lg border border-theme bg-surface"><div className="flex items-center gap-2 border-b border-theme bg-surface-soft px-4 py-3"><Icon aria-hidden="true" className="h-4 w-4 text-blue-600" /><h3 className="text-sm font-bold text-theme">{title}</h3></div><div className="space-y-4 p-4">{children}</div></section>;
const ScopeList = ({ kind, items = [] }) => <section aria-label={`Offer ${kind}`}><h4 className="text-xs font-bold uppercase tracking-wide text-theme-subtle">{kind} · {items.length}</h4>{items.length ? <ul className="mt-2 divide-y divide-slate-200">{items.map(item => <li className="py-2 text-sm" key={item.id}><p className="font-semibold text-theme">{item.name || item.itemName || item.dbItemName || "Work item"}</p>{item.description && <p className="mt-1 whitespace-pre-wrap text-theme-subtle">{item.description}</p>}<p className="mt-1 text-xs text-theme-subtle">{[item.status, kind === "products" && `Quantity: ${item.quantity ?? 1}`, item.estimatedTime > 0 && `${item.estimatedTime} min`].filter(Boolean).join(" · ")}</p></li>)}</ul> : <p className="mt-2 text-sm text-theme-subtle">No {kind} in this offer.</p>}</section>;

export default function WorkOfferManagementDialog({ companyId, offer, workers = EMPTY, tasks = EMPTY, boards = EMPTY, initialTab = "details", onClose, onChanged }) {
  const [details, setDetails] = useState(null);
  const [mode, setMode] = useState(initialTab === "delete" ? "details" : initialTab);
  const [form, setForm] = useState(() => formFor(offer));
  const [incentive, setIncentive] = useState(() => incentiveFor(offer));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnClaim, setReturnClaim] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(initialTab === "delete");
  const deleteConfirmationRef = useRef(null);
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
    } catch (failure) { setError(userFacingErrorMessage(failure, failure.message || "Could not load this work offer.")); }
    finally { setLoading(false); }
  }, [companyId, offer]);
  useEffect(() => { setDetails(null); load(); }, [load]);
  useEffect(() => {
    if (confirmDelete && !loading) deleteConfirmationRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [confirmDelete, loading]);

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
    } catch (failure) { setError(userFacingErrorMessage(failure, failure.message || "Could not save this work offer.")); }
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
    } catch (failure) { setError(userFacingErrorMessage(failure, failure.message || "Could not save the incentive.")); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!capabilities.canDelete || busy || loading) return;
    setBusy(true); setError("");
    try {
      const result = await manageTechnicianWork(companyId, "delete", { offerId: current.id, revision: current.revision || 1 });
      toast.success("Work offer deleted."); await notify({ ...result, type: "deleted" }); onClose();
    } catch (failure) { setError(userFacingErrorMessage(failure, failure.message || "Could not delete this work offer.")); }
    finally { setBusy(false); }
  };

  const editing = mode === "edit" && capabilities.canEdit;
  const editTerms = editing && !locked;
  const bonus = normalizeWorkOfferIncentive(current);
  const bonusLabel = bonus.type === "flat" ? money(bonus.amountCents) : bonus.type === "percentage" ? `${bonus.percentage}%` : "No incentive added";
  const changeMode = tab => { setMode(tab); setError(""); setConfirmDelete(false); };

  return <>
    {returnClaim && <WorkOfferReturnDialog companyId={companyId} offer={current} claim={returnClaim} onClose={() => setReturnClaim(null)} onReturned={async result => { await load(); await notify({ ...result, type: "returned" }); }} />}
    <Dialog open onClose={() => { if (!busy && !returnClaim) onClose(); }} className="relative z-50">
      <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-theme bg-surface text-theme shadow-xl">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-theme px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 sm:flex"><FiBriefcase className="h-5 w-5" aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-theme-subtle">Work offer</p>
                <DialogTitle className="mt-1 break-words text-xl font-bold text-theme">{current.title || "Offered Work"}</DialogTitle>
                <p className="mt-1 break-words text-sm text-theme-subtle">{[current.jobInternalId, current.customerName || current.routeName].filter(Boolean).join(" · ") || "Offer details and assignment"}</p>
              </div>
            </div>
            <button type="button" disabled={busy} onClick={onClose} aria-label="Close work offer" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-theme-subtle transition hover:bg-surface-soft disabled:opacity-50"><FiX className="h-5 w-5" aria-hidden="true" /></button>
          </header>
          <nav className="flex shrink-0 items-center justify-between gap-3 border-b border-theme px-5" aria-label="Work offer sections">
            <div className="flex flex-wrap gap-5">
              {[["details", "Details", true], ["edit", "Edit offer", capabilities.canEdit], ["incentive", "Incentive", capabilities.canIncentivize]].filter(([, , visible]) => visible).map(([tab, label]) => <button type="button" key={tab} disabled={busy || loading} aria-pressed={mode === tab} onClick={() => changeMode(tab)} className={`min-h-12 border-b-2 py-3 text-sm font-semibold transition disabled:opacity-50 ${mode === tab ? "border-blue-600 text-blue-600" : "border-transparent text-theme-subtle hover:text-theme"}`}>{label}</button>)}
            </div>
            <button type="button" disabled={busy || loading} onClick={load} aria-label="Refresh offer" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-theme-subtle hover:bg-surface-soft disabled:opacity-50"><FiRefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /></button>
          </nav>
          <div className="min-h-0 space-y-4 overflow-y-auto bg-page p-4 sm:p-5">
            {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {loading ? <p role="status" className="py-12 text-center text-sm text-theme-subtle">Loading offer details…</p> : details && <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-theme bg-surface px-4 py-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm"><p className="text-theme-subtle">From <span className="font-semibold text-theme">{current.createdByUserName || "Company office"}</span></p><p className="text-theme-subtle">Sent <span className="font-medium text-theme">{dateLabel(current.sentAt || current.postedAt || current.createdAt)}</span></p></div>
                <span className="rounded-full border border-theme bg-surface-soft px-3 py-1 text-xs font-bold text-theme-muted">{current.status || "Draft"}</span>
              </div>
              {locked && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Agreed pay, scope, assignment, and timing are locked. {capabilities.canEdit ? "You can update the offer title, description, and notes." : "Accepted terms are preserved."}</p>}
              {details.scopeChanged && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The job plan has changed since this offer was prepared. Review the scope before changing or accepting work.</p>}
              {mode !== "incentive" && <form id={editing ? "work-offer-edit" : undefined} onSubmit={editing ? save : event => event.preventDefault()}>
                <fieldset disabled={busy} className="grid min-w-0 gap-4 lg:grid-cols-3">
                  <div className="min-w-0 space-y-4 lg:col-span-2">
                    <OfferSection title="Offer details" icon={FiBriefcase}>
                      {editing ? <>
                        <Field label="Offer title"><input required value={form.title} onChange={event => change("title", event.target.value)} className={inputClass} /></Field>
                        <Field label="Description"><textarea rows={3} value={form.description} onChange={event => change("description", event.target.value)} className={inputClass} /></Field>
                      </> : <dl className="space-y-4"><Detail label="Offer title">{current.title || "Offered Work"}</Detail><Detail label="Description">{current.description || "No description added"}</Detail></dl>}
                    </OfferSection>
                    <OfferSection title="Recipient & location" icon={FiUser}>
                      {editTerms ? <>
                        {optionsError && <p role="status" className="text-sm text-amber-800">{optionsError}</p>}
                        <Field label="Offer type"><select value={form.offerType} onChange={event => change("offerType", event.target.value)} className={inputClass}><option>Direct User</option><option>Internal Board</option>{form.offerType === "External Company" && <option>External Company</option>}</select></Field>
                        {form.offerType === "Direct User" && <Field label="Technician"><select required value={form.offeredToUserId} onChange={event => change("offeredToUserId", event.target.value)} className={inputClass}><option value="">Choose a technician</option>{!options.workers.some(row => workerId(row) === form.offeredToUserId) && form.offeredToUserId && <option value={form.offeredToUserId}>{current.offeredToUserName || form.offeredToUserId}</option>}{options.workers.map(worker => <option key={workerId(worker)} value={workerId(worker)}>{workerName(worker)}</option>)}</select></Field>}
                        {form.offerType === "Internal Board" && <>
                          <Field label="Board visibility"><select value={form.boardVisibility} onChange={event => change("boardVisibility", event.target.value)} className={inputClass}>{["Employees Only", "Contractors Only", "Employees & Contractors", "Admins Only"].map(value => <option key={value}>{value}</option>)}</select></Field>
                          {!!options.boards.length && <fieldset className="rounded-md border border-theme p-3"><legend className="px-1 text-sm font-semibold">Boards</legend>{options.boards.map(board => <label key={board.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={form.boardIds.includes(board.id)} onChange={event => change("boardIds", event.target.checked ? [...form.boardIds, board.id] : form.boardIds.filter(id => id !== board.id))} />{board.name}</label>)}</fieldset>}
                        </>}
                      </> : <dl className="grid gap-4 sm:grid-cols-2"><Detail label="Offer type">{current.offerType || "Direct User"}</Detail><Detail label="Recipient">{getWorkOfferTargetText(current)}</Detail></dl>}
                      <dl className="grid gap-4 sm:grid-cols-2"><Detail label="Customer">{current.customerName || current.routeName || "Not set"}</Detail><Detail label="Location">{current.serviceLocationName || current.address?.streetAddress || "Not set"}</Detail></dl>
                    </OfferSection>
                    <OfferSection title="Work scope" icon={FiCheckSquare}>
                      <RouteWorkOfferSummary offer={current} summary={details.routeSummary ?? current.routeSummary}/>
                      {editTerms && current.jobId && current.workPurpose !== "diagnostic" ? <fieldset><legend className="mb-2 text-xs font-bold uppercase tracking-wide text-theme-subtle">Offered tasks</legend><div className="divide-y divide-slate-200">{options.tasks.filter(task => form.jobTaskIds.includes(task.id) || ((!task.claimedWorkOfferId || task.claimedWorkOfferId === current.id) && !["Finished", "Completed", "Cancelled"].includes(task.status))).map(task => <label className="flex items-start gap-3 py-3 text-sm" key={task.id}><input className="mt-0.5 h-4 w-4 rounded border-theme" type="checkbox" checked={form.jobTaskIds.includes(task.id)} onChange={event => change("jobTaskIds", event.target.checked ? [...form.jobTaskIds, task.id] : form.jobTaskIds.filter(id => id !== task.id))} /><span>{task.name || task.description || task.id}</span></label>)}</div></fieldset> : <ScopeList kind="tasks" items={details.scope?.tasks} />}
                      {["services", "products", "stops"].map(kind => <ScopeList key={kind} kind={kind} items={details.scope?.[kind]} />)}
                    </OfferSection>
                    <OfferSection title="Notes" icon={FiFileText}>
                      {editing ? <Field label="Admin notes"><textarea rows={3} value={form.adminNotes} onChange={event => change("adminNotes", event.target.value)} className={inputClass} /></Field> : <dl><Detail label="Admin notes">{current.adminNotes || "No admin notes"}</Detail></dl>}
                      <dl><Detail label="Worker notes">{current.workerNotes || "No worker notes"}</Detail></dl>
                    </OfferSection>
                  </div>
                  <div className="min-w-0 space-y-4">
                    <OfferSection title="Timeline & scheduling" icon={FiCalendar}>
                      {editTerms ? <>
                        <Field label="Available from"><input type="datetime-local" value={form.proposedStartDate} onChange={event => change("proposedStartDate", event.target.value)} className={inputClass} /></Field>
                        <Field label="Completion deadline"><input type="datetime-local" value={form.completionDeadlineAt} onChange={event => change("completionDeadlineAt", event.target.value)} className={inputClass} /></Field>
                        <Field label="Estimated minutes"><input type="number" min="0" required value={form.estimatedMinutes} onChange={event => change("estimatedMinutes", event.target.value)} className={inputClass} /></Field>
                        <Field label="Timeline notes"><textarea rows={2} value={form.timelineNotes} onChange={event => change("timelineNotes", event.target.value)} className={inputClass} /></Field>
                        <label className="flex items-start gap-3 text-sm font-semibold text-theme-muted"><input className="mt-0.5 h-4 w-4 rounded border-theme" type="checkbox" checked={form.allowsTechnicianSelfScheduling} onChange={event => change("allowsTechnicianSelfScheduling", event.target.checked)} />Technician can self-schedule</label>
                      </> : <dl className="space-y-4"><Detail label="Available from">{dateLabel(current.proposedStartDate)}</Detail><Detail label="Completion deadline">{dateLabel(current.completionDeadlineAt || current.proposedEndDate)}</Detail><Detail label="Estimated time">{`${current.estimatedMinutes || 0} minutes`}</Detail><Detail label="Scheduling">{current.allowsTechnicianSelfScheduling ? "Technician can schedule" : "Management schedules"}</Detail>{current.timelineNotes && <Detail label="Timeline notes">{current.timelineNotes}</Detail>}</dl>}
                    </OfferSection>
                    <OfferSection title="Pay & incentive" icon={FiDollarSign}>
                      {editTerms ? <>
                        <Field label="Pay source"><select value={form.paySource} onChange={event => change("paySource", event.target.value)} className={inputClass}>{["Technician Rate", "Task Contracted Rates", "Offered Amount", "Unpaid"].map(value => <option key={value}>{value}</option>)}</select></Field>
                        {form.paySource === "Offered Amount" && <Field label="Offered amount"><input type="number" min="0" step="0.01" required value={form.offeredAmount} onChange={event => change("offeredAmount", event.target.value)} className={inputClass} /></Field>}
                      </> : <dl className="space-y-4"><Detail label={details.pay ? "Agreed pay" : "Offered pay"}>{details.pay?.totalCents != null ? money(details.pay.totalCents) : current.paySource === "Offered Amount" ? money(current.offeredAmountCents) : current.paySource || "Technician Rate"}</Detail><Detail label="Pay source">{current.paySource || "Technician Rate"}</Detail></dl>}
                      <dl><Detail label="Incentive">{bonusLabel}</Detail></dl>
                      {bonus.notes && <p className="whitespace-pre-wrap text-sm text-theme-subtle">{bonus.notes}</p>}
                      {!!details.pay?.lines?.length && <ul className="space-y-2 border-t border-theme pt-3">{details.pay.lines.map(line => <li className="flex flex-wrap justify-between gap-2 text-sm" key={line.id}><span className="text-theme-subtle">{line.title || line.taskName || line.workTypeName || "Work pay"}</span><span className="font-semibold">{money(line.totalAmountCents)}</span></li>)}</ul>}
                    </OfferSection>
                    {!!current.claims?.length && <OfferSection title="Claims & activity" icon={FiUser}>{current.claims.map(claim => <div key={claim.id} className="space-y-2 border-b border-theme pb-3 last:border-0 last:pb-0"><p className="text-sm font-semibold">{claim.workerName || claim.workerId}</p><p className="text-xs text-theme-subtle">{claim.status}{claim.agreement?.totalCents != null ? ` · ${money(claim.agreement.totalCents)}` : ""}</p>{claim.withdrawnAt && <p className="text-xs text-theme-subtle">Returned {dateLabel(claim.withdrawnAt)}: {claim.withdrawalReason}</p>}{capabilities.returnableClaimIds?.includes(claim.id) && <button type="button" disabled={busy} onClick={() => setReturnClaim(claim)} className={`${buttonClass} !text-red-700`}>Return {claim.workerName}'s work</button>}</div>)}</OfferSection>}
                  </div>
                </fieldset>
              </form>}
              {mode === "incentive" && capabilities.canIncentivize && <OfferSection title="Incentive" icon={FiGift}>
                <form id="work-offer-incentive" onSubmit={saveIncentive}>
                  <fieldset disabled={busy} className="max-w-xl space-y-4">
                    {capabilities.incentiveLocked ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">This offer is fully claimed. Accepted incentives are preserved; use a separate payroll adjustment for an additional bonus.</p> : <>
                      {!!current.claims?.length && <p className="text-sm text-theme-subtle">Changes apply to the remaining unclaimed work. Existing claims retain their agreed incentive.</p>}
                      <Field label="Incentive type"><select value={incentive.type} onChange={event => setIncentive(previous => ({ ...previous, type: event.target.value }))} className={inputClass}><option value="none">No incentive</option><option value="flat">Flat bonus</option><option value="percentage">Percentage bonus</option></select></Field>
                      {incentive.type === "flat" && <Field label="Incentive amount"><input type="number" min="0" step="0.01" required value={incentive.amount} onChange={event => setIncentive(previous => ({ ...previous, amount: event.target.value }))} className={inputClass} /></Field>}
                      {incentive.type === "percentage" && <Field label="Incentive percentage"><input type="number" min="0" step="0.01" required value={incentive.percentage} onChange={event => setIncentive(previous => ({ ...previous, percentage: event.target.value }))} className={inputClass} /></Field>}
                      <Field label="Incentive notes"><textarea rows={3} value={incentive.notes} onChange={event => setIncentive(previous => ({ ...previous, notes: event.target.value }))} className={inputClass} /></Field>
                    </>}
                  </fieldset>
                </form>
              </OfferSection>}
              {confirmDelete && capabilities.canDelete && <section ref={deleteConfirmationRef} aria-label="Confirm offer deletion" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"><h3 className="font-bold">Delete this work offer?</h3><p className="mt-1 text-sm">The offer will be permanently removed. Pending task and stop reservations will be released. The job, its tasks, and service stops will remain.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={remove} className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete permanently"}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className={buttonClass}>Keep offer</button></div></section>}
            </>}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-theme bg-surface-soft px-5 py-4">
            <div className="flex flex-wrap gap-2">{current.jobId && <Link className={buttonClass} to={`/company/jobs/detail/${current.jobId}/actual`} onClick={event => { if (busy) event.preventDefault(); else onClose(); }}>Open job</Link>}{capabilities.canDelete && <button type="button" disabled={busy || loading} onClick={() => setConfirmDelete(true)} className={`${buttonClass} !text-red-700`}>Delete offer</button>}</div>
            <div className="flex flex-wrap gap-2">
              {editing && <><button type="button" disabled={busy} onClick={() => { setForm(formFor(current)); changeMode("details"); }} className={buttonClass}>Cancel editing</button><button type="submit" form="work-offer-edit" disabled={busy || loading} className="min-h-10 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">{busy ? "Saving…" : "Save offer"}</button></>}
              {mode === "incentive" && capabilities.canIncentivize && !capabilities.incentiveLocked && <button type="submit" form="work-offer-incentive" disabled={busy || loading} className="min-h-10 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">{busy ? "Saving…" : "Save incentive"}</button>}
              {!editing && mode !== "incentive" && <button type="button" disabled={busy} onClick={onClose} className={buttonClass}>Done</button>}
            </div>
          </footer>
        </DialogPanel>
      </div>
    </Dialog>
  </>;
}
