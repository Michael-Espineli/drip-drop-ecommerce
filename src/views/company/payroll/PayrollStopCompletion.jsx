import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { technicianWorkflow } from "../../../utils/technicianWorkflow";
import { appConfirm } from "../../../utils/appDialog";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const buttonStyle = "rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const statusLabel = {
  queued: "Queued",
  processing: "Processing",
  recorded: "Payroll recorded",
  needsReview: "Needs review",
  noPay: "No payable lines",
  failed: "Payroll needs retry",
  superseded: "Completion replaced",
};

const call = (companyId, action, payload) => technicianWorkflow("managePayrollStopCompletion", { companyId, action, ...payload });
const storedRun = (key, value) => {
  try {
    if (value === undefined) return sessionStorage.getItem(key) || "";
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { return ""; }
  return "";
};
const totalPay = items => [...new Map(items.flatMap(item => item.pay?.lineItems || [])
  .filter(line => line.calculationStatus !== "needsReview")
  .map(line => [line.id, line.totalAmountCents])).values()].reduce((sum, cents) => sum + cents, 0);

function StopPay({ pay }) {
  if (!pay) return null;
  if (pay.payrollDisabled) return <p className="text-sm text-slate-700">Payroll is disabled in company settings.</p>;
  return (
    <>
      {pay.lineItems.length === 0 ? <p className="text-sm text-slate-700">The current pay rules produced no payable lines for this stop.</p> : (
        <ul className="mt-1 space-y-1 text-sm text-slate-800">
          {pay.lineItems.map(line => (
            <li key={line.id}>
              <span className="font-semibold">{money.format(line.totalAmountCents / 100)}</span>{" · "}
              {line.title}{line.technicianName && ` · ${line.technicianName}`}
              {line.calculationStatus === "needsReview" ? ` · Needs review. ${line.notes}` : ""}
            </li>
          ))}
        </ul>
      )}
      {pay.conflictLineItemIds.length > 0 && <p className="mt-1 text-sm text-amber-900">Existing locked pay requires an adjustment review.</p>}
    </>
  );
}

function StopLabel({ item }) {
  return (
    <span>
      <span className="font-semibold text-slate-950">{item.title}</span>
      <span className="block text-sm text-slate-700">
        {[item.serviceDate, item.customerName, item.technicianName || item.technicianId || "Unassigned technician"].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

export default function PayrollStopCompletion({
  companyId, startDate, endDate, onStartDateChange, onEndDateChange, permissionsReady, canPreview, canFinish,
  otherAction, onPayrollProcessed,
}) {
  const [preview, setPreview] = useState(null);
  const [selectedStops, setSelectedStops] = useState(new Set());
  const [taskChoices, setTaskChoices] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const storageKey = `payroll-stop-completion:${companyId}`;
  const [runId, setRunId] = useState(() => storedRun(storageKey));
  const [run, setRun] = useState(null);
  const [pollVersion, setPollVersion] = useState(0);
  const requestId = useRef("");
  const lastCompleted = useRef(null);
  const scope = JSON.stringify([startDate, endDate]);
  const current = preview?.scope === scope ? preview : null;
  const currentChoices = current ? taskChoices : {};
  const taskSelection = Object.entries(currentChoices).filter(([, ids]) => ids.length)
    .map(([stopId, taskIds]) => ({ stopId, taskIds: [...taskIds].sort() })).sort((a, b) => a.stopId.localeCompare(b.stopId));
  const choicesKey = JSON.stringify(taskSelection);
  const needsUpdate = Boolean(current && current.choicesKey !== choicesKey);
  const selected = current?.items.filter(item => !item.blockedReason && selectedStops.has(item.stopId)) || [];
  const available = current?.items.filter(item => !item.blockedReason) || [];
  const validRange = Boolean(startDate && endDate && startDate <= endDate);
  const pending = Boolean(runId && (!run || run.pending));
  const blocked = busy || otherAction || !permissionsReady;
  const cannotFinish = !canFinish || blocked || pending || !validRange || needsUpdate || !selected.length;

  useEffect(() => {
    if (!runId || !canPreview || !permissionsReady) return undefined;
    let cancelled = false;
    let timer;
    const refresh = async () => {
      try {
        const next = await call(companyId, "status", { runId });
        if (cancelled) return;
        setRun(next);
        setStatusError("");
        if (next.pending) timer = setTimeout(refresh, 1800);
        else if (lastCompleted.current !== `${runId}:${pollVersion}`) {
          lastCompleted.current = `${runId}:${pollVersion}`;
          onPayrollProcessed();
        }
      } catch (reason) {
        if (cancelled) return;
        setStatusError(reason.message || "Could not check payroll processing.");
        if (reason.code?.endsWith("/not-found")) {
          setRunId("");
          storedRun(storageKey, "");
        } else {
          timer = setTimeout(refresh, 4000);
        }
      }
    };
    refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [companyId, runId, canPreview, permissionsReady, pollVersion, storageKey, onPayrollProcessed]);

  const loadPreview = async () => {
    if (blocked || !validRange || !canPreview || pending) return;
    setBusy("preview");
    setError("");
    requestId.current = "";
    try {
      const next = await call(companyId, "preview", { startDate, endDate, stops: taskSelection });
      setPreview({ ...next, scope, choicesKey });
      if (!current) {
        setTaskChoices({});
        setSelectedStops(new Set());
      }
    } catch (reason) {
      setError(reason.message || "Could not preview payroll.");
    } finally {
      setBusy("");
    }
  };

  const finish = async () => {
    if (cannotFinish) return;
    setBusy("finish");
    setError("");
    try {
      const count = selected.reduce((total, item) => total + item.selectedTaskIds.length, 0);
      const confirmed = await appConfirm({
        title: "Finish confirmed service stops?",
        message: `Confirm that the work was performed on ${selected.length} selected stop(s) and ${count} selected task(s). Payroll will be calculated and customer emails are disabled for this run.`,
        confirmText: "Finish Confirmed Stops",
      });
      if (!confirmed) return;
      const id = requestId.current || uuidv4();
      requestId.current = id;
      const next = await call(companyId, "finish", {
        runId: id, startDate, endDate,
        stops: selected.map(item => ({ stopId: item.stopId, version: item.version, taskIds: item.selectedTaskIds })),
      });
      storedRun(storageKey, id);
      setRun(next);
      setRunId(id);
      setPreview(null);
      setTaskChoices({});
      setSelectedStops(new Set());
    } catch (reason) {
      setError(reason.message || "Could not confirm these stops.");
      if (reason.code?.endsWith("/failed-precondition")) setPreview(null);
    } finally {
      setBusy("");
    }
  };

  const retry = async stopId => {
    if (blocked || !canFinish) return;
    setBusy(`retry-${stopId}`);
    setError("");
    try {
      const next = await call(companyId, "retry", { runId, stopId });
      setRun(next);
      setPollVersion(value => value + 1);
    } catch (reason) {
      setError(reason.message || "Could not retry payroll.");
    } finally {
      setBusy("");
    }
  };

  const toggleStop = stopId => {
    setSelectedStops(previous => {
      const next = new Set(previous);
      if (next.has(stopId)) next.delete(stopId);
      else next.add(stopId);
      return next;
    });
  };
  const toggleTask = (stopId, taskId) => {
    setTaskChoices(previous => {
      const ids = previous[stopId] || [];
      return { ...previous, [stopId]: ids.includes(taskId) ? ids.filter(id => id !== taskId) : [...ids, taskId] };
    });
  };

  return (
    <section className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm" aria-labelledby="stop-payroll-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="stop-payroll-heading" className="text-base font-bold text-slate-950">Finish Unfinished Stops and Generate Payroll</h2>
          <p className="mt-1 text-sm text-slate-700">Preview the pay for a service date range, then confirm the stops and tasks that were performed. Customer emails are disabled.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold text-slate-800">
            Service start date
            <input type="date" value={startDate} onChange={event => onStartDateChange(event.target.value)} disabled={Boolean(busy)} className={buttonStyle} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-800">
            Service end date
            <input type="date" value={endDate} onChange={event => onEndDateChange(event.target.value)} disabled={Boolean(busy)} className={buttonStyle} />
          </label>
          <button type="button" className={buttonStyle} onClick={loadPreview} disabled={Boolean(blocked || !canPreview || !validRange || pending)}>
            {busy === "preview" ? "Calculating…" : current ? "Update Preview" : "Preview Payroll"}
          </button>
        </div>
      </div>
      {!permissionsReady && <p className="text-sm text-slate-700">Loading service stop permissions…</p>}
      {permissionsReady && !canPreview && <p className="text-sm text-slate-700">You need View Payroll and View Service Stops access to preview payroll.</p>}
      {permissionsReady && canPreview && !canFinish && <p className="text-sm text-slate-700">You need Edit Service Stops access to confirm stops or retry payroll.</p>}
      {error && <p className="rounded-md border border-red-200 bg-white p-2 text-sm text-red-800" role="alert">{error}</p>}
      {statusError && <p className="rounded-md border border-red-200 bg-white p-2 text-sm text-red-800" role="alert">{statusError}</p>}

      {current && (
        <div className="space-y-3">
          {current.items.length === 0 && <p className="text-sm text-slate-700">No eligible unfinished stops were found for these service dates.</p>}
          {current.items.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{selected.length} of {available.length} eligible stops selected</span>
                {selected.length > 0 && !needsUpdate && (
                  <span className="text-sm font-semibold text-slate-800">{money.format(totalPay(selected) / 100)} previewed for selection</span>
                )}
                <button type="button" className={buttonStyle} disabled={Boolean(blocked || !canFinish || !available.length)} onClick={() => setSelectedStops(new Set(available.slice(0, current.maxStops).map(item => item.stopId)))}>
                  {available.length > current.maxStops ? `Select first ${current.maxStops} stops` : "Select eligible stops"}
                </button>
                <button type="button" className={buttonStyle} onClick={finish} disabled={Boolean(cannotFinish)}>
                  {busy === "finish" ? "Confirming…" : "Finish Confirmed Stops"}
                </button>
              </div>
              {needsUpdate && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-amber-900">Task selections changed. Update the preview before confirming.</p>
                  <button type="button" className={buttonStyle} disabled={Boolean(blocked || !canFinish)} onClick={() => setTaskChoices({})}>Clear task selections</button>
                </div>
              )}
              <ul className="max-h-[32rem] divide-y divide-amber-100 overflow-auto rounded-md border border-amber-200 bg-white">
                {current.items.map(item => (
                  <li key={item.stopId} className="space-y-2 p-3">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" aria-label={`Confirm stop ${item.customerName || item.title}`} className="mt-1" checked={selectedStops.has(item.stopId) && !item.blockedReason}
                        onChange={() => toggleStop(item.stopId)} disabled={Boolean(blocked || !canFinish || item.blockedReason ||
                          (selected.length >= current.maxStops && !selectedStops.has(item.stopId)))} />
                      <StopLabel item={item} />
                    </label>
                    {item.blockedReason && <p className="text-sm text-amber-900">{item.blockedReason}</p>}
                    <StopPay pay={item.pay} />
                    {item.offeredWork && <p className="text-sm text-slate-700">Accepted offer pay may depend on other work being finished.</p>}
                    {item.tasks.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-slate-700">Confirm tasks performed on this stop</summary>
                        {item.tasks.map(task => (
                          <label key={task.id} className="mt-2 flex items-start gap-2 text-sm text-slate-800">
                            <input type="checkbox" className="mt-1" checked={Boolean(currentChoices[item.stopId]?.includes(task.id))}
                              disabled={Boolean(blocked || !canFinish || task.reason || item.blockedReason)} onChange={() => toggleTask(item.stopId, task.id)} />
                            <span>{task.title}{task.technicianName && ` · ${task.technicianName}`}{task.reason && <span className="block text-amber-900">{task.reason}</span>}</span>
                          </label>
                        ))}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {runId && <div aria-live="polite" className="space-y-2">
        <h3 className="font-bold text-slate-950">Payroll Results</h3>
        {pending && <p className="text-sm text-slate-700" role="status">Payroll is processing confirmed stops. Results update automatically.</p>}
        {run && !pending && <p className="text-sm font-semibold text-slate-800">{money.format(totalPay(run.items) / 100)} recorded across {run.items.length} confirmed stop(s)</p>}
        {run && <ul className="divide-y divide-amber-100 rounded-md border border-amber-200 bg-white">
          {run.items.map(item => (
            <li key={item.stopId} className="space-y-1 p-3">
              <StopLabel item={item} />
              <p className="text-sm font-semibold text-slate-800">{statusLabel[item.status]} · {item.finishedTaskCount} confirmed task(s)</p>
              <StopPay pay={item.pay} />
              {item.errorMessages.map(message => <p key={message} className="text-sm text-red-800">{message}</p>)}
              {item.status === "failed" && (
                <button type="button" className={buttonStyle} disabled={Boolean(blocked || !canFinish)} onClick={() => retry(item.stopId)}>
                  {busy === `retry-${item.stopId}` ? "Retrying…" : "Retry Payroll"}
                </button>
              )}
            </li>
          ))}
        </ul>}
      </div>}
    </section>
  );
}
