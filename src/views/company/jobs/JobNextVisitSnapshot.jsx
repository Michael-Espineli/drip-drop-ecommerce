import React from "react";
import { Link } from "react-router-dom";
import { CalendarDaysIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { getCompanyUserDisplayName } from "../../../utils/companyUsers";

const id = value => String(typeof value === "object" ? value?.id || "" : value || "").trim();
const key = value => String(value || "").replace(/[^a-z]/gi, "").toLowerCase();
const closed = value => ["finished", "completed", "complete", "done", "cancelled", "canceled", "skipped", "deleted", "rejected", "expired"].includes(key(value));
const asDate = value => {
  if (value == null || value === "") return null;
  const date = value?.toDate?.() || (typeof value === "object" && (value.seconds ?? value._seconds) != null
    ? new Date((value.seconds ?? value._seconds) * 1000) : new Date(value));
  return Number.isFinite(date.getTime()) ? date : null;
};
const inProgress = stop => ["inprogress", "started"].includes(key(stop.operationStatus || stop.status));
const personName = value => ["", "unassigned", "notassigned", "notset", "notechnicianselected"].includes(key(value)) ? "" : String(value).trim();

// Read execution assignments, never the job's administrative owner or an unaccepted offer.
export function getJobNextAssignment({ serviceStops = [], tasks = [], offers = [], companyUsers = [] }) {
  const stop = serviceStops.filter(value => !closed(value.operationStatus || value.status)).slice().sort((a, b) =>
    Number(inProgress(b)) - Number(inProgress(a))
    || (asDate(a.serviceDate)?.getTime() ?? Infinity) - (asDate(b.serviceDate)?.getTime() ?? Infinity)
    || id(a.id).localeCompare(id(b.id))
  )[0] || null;
  const people = [];
  const addPerson = (workerId, name, role) => {
    const rawId = id(workerId);
    const user = rawId ? companyUsers.find(value => [value.userId, value.uid, value.id, value.docId, value.value].some(valueId => id(valueId) === rawId)) : null;
    const resolvedId = id(user?.userId || user?.uid || user?.id || rawId);
    const resolvedName = personName(user ? getCompanyUserDisplayName(user, "") : name);
    if (!resolvedId && !resolvedName) return;
    if (people.some(person => (resolvedId && person.id === resolvedId) || ((!resolvedId || !person.id) && key(person.name) === key(resolvedName)))) return;
    people.push({ id: resolvedId, name: resolvedName || "Technician name unavailable", role });
  };
  const openTasks = tasks.filter(task => !closed(task.status));
  if (stop) {
    addPerson(stop.techId || stop.technicianId || stop.userId || stop.workerId, stop.tech || stop.techName || stop.technicianName || stop.workerName, "Visit technician");
    openTasks.filter(task => id(task.serviceStopId || task.serviceStopID) === id(stop.id) && task.workerAssignmentMode !== "stop")
      .forEach(task => addPerson(task.workerId, task.workerName, "Task assignee"));
    return { stop, people, date: asDate(stop.serviceDate), state: inProgress(stop) ? "In progress" : "Scheduled" };
  }
  let accepted = false;
  offers.filter(offer => !closed(offer.status)).forEach(offer => {
    const claims = Array.isArray(offer.claims) ? offer.claims : [];
    const candidates = claims.length ? claims : key(offer.status) === "accepted" ? [{ status: "Accepted", workerId: offer.acceptedByUserId, workerName: offer.acceptedByUserName, taskIds: offer.jobTaskIds, serviceStopId: offer.serviceStopId }] : [];
    candidates.filter(claim => key(claim.status) === "accepted" && !id(claim.serviceStopId) && !(claim.stopIds || []).length).forEach(claim => {
      const scopedTasks = tasks.filter(task => (claim.taskIds || []).includes(task.id));
      if (scopedTasks.length && scopedTasks.every(task => closed(task.status))) return;
      if (!id(claim.workerId) && !personName(claim.workerName)) return;
      accepted = true;
      addPerson(claim.workerId, claim.workerName, "Accepted work");
    });
  });
  openTasks.filter(task => !id(task.serviceStopId || task.serviceStopID)).forEach(task => addPerson(task.workerId, task.workerName, "Assigned work"));
  return { stop: null, people, date: null, state: accepted ? "Accepted · needs scheduling" : people.length ? "Assigned · needs scheduling" : "Not scheduled" };
}

export default function JobNextVisitSnapshot({ jobId, serviceStops, tasks, offers, companyUsers, loading = false }) {
  const assignment = getJobNextAssignment({ serviceStops, tasks, offers, companyUsers });
  const { stop, people, date, state } = assignment;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdue = stop && date && date < today && state !== "In progress";
  return (
    <section aria-label="Next work assignment" className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600"><UserGroupIcon className="h-4 w-4" aria-hidden="true" />Who’s doing the work?</h3>
          {loading ? <p role="status" className="mt-2 text-sm text-slate-500">Loading next assignment…</p> : <>
            <div className="mt-2 flex flex-wrap gap-2">
              {people.map(person => <div key={person.id || person.name} className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{person.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span>
                <div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-950">{person.name}</p><p className="text-[11px] text-slate-500">{person.role}</p></div>
              </div>)}
              {!people.length && <p className="text-sm font-semibold text-slate-700">No technician assigned yet</p>}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
              <CalendarDaysIcon className="h-4 w-4" aria-hidden="true" />
              {stop ? <><span className="font-semibold">{state === "In progress" ? "Current visit" : "Next visit"}:</span><span>{date ? format(date, "EEE, MMM d, yyyy") : "Date not set"}</span><span>· {stop.type || stop.serviceStopTypeName || "Job visit"}</span></> : <span>{people.length ? state : "Schedule a visit and assign a technician to see them here."}</span>}
              {overdue && <span className="font-semibold text-amber-800">Overdue</span>}
              {stop && !people.some(person => person.role === "Visit technician") && <span className="font-semibold text-amber-800">Visit technician needed</span>}
            </p>
          </>}
        </div>
        {!loading && <Link to={stop ? `/company/serviceStops/detail/${encodeURIComponent(stop.id)}` : `/company/jobs/detail/${encodeURIComponent(jobId)}/actual`} className="shrink-0 self-start rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50">{stop ? "View visit" : "View work & scheduling"}</Link>}
      </div>
    </section>
  );
}
