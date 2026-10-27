import React, { useContext, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { formatJobHistoryDate, jobHistoryActorName, jobHistoryDate } from "../../../utils/jobHistory";

const JobHistoryView = () => {
  const { jobId } = useParams();
  const { recentlySelectedCompany } = useContext(Context);
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setJob(null);
    setEvents([]);
    setError("");
    if (!recentlySelectedCompany || !jobId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
    const unsubscribeJob = onSnapshot(jobRef, (snapshot) => setJob(snapshot.exists() ? snapshot.data() : null), () => {
      setError("Could not load the job. Please try again.");
      setLoading(false);
    });
    const unsubscribeHistory = onSnapshot(collection(jobRef, "history"), (snapshot) => {
      setEvents(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
        .sort((a, b) => (jobHistoryDate(b)?.getTime() || 0) - (jobHistoryDate(a)?.getTime() || 0)));
      setLoading(false);
    }, () => {
      setError("Could not load job history. Please try again.");
      setLoading(false);
    });
    return () => { unsubscribeJob(); unsubscribeHistory(); };
  }, [recentlySelectedCompany, jobId]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-7">
      <Link to={`/company/jobs/detail/${jobId}`} className="text-sm font-semibold text-blue-700 hover:underline">Back to Job</Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Job History{job?.internalId ? ` · ${job.internalId}` : ""}</h1>
      <p className="mt-1 text-sm text-slate-600">Who created this job and what changed afterward.</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {loading ? <p role="status" className="mt-6 text-slate-500">Loading job history…</p>
        : !recentlySelectedCompany ? <p className="mt-6 text-slate-500">Select a company to view job history.</p>
          : !events.length && !error ? <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-slate-600">No history has been recorded for this job.</p>
            : <ol className="mt-6 space-y-4" aria-label="Job history">
              {events.map((event) => (
                <li key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{event.eventType || "Job Updated"}</p>
                  <h2 className="mt-1 font-bold text-slate-900">{event.title || event.eventType || "Job updated"}</h2>
                  <p className="mt-1 text-sm text-slate-600">{jobHistoryActorName(event)} · {formatJobHistoryDate(event)}</p>
                  {event.description && <p className="mt-3 text-sm text-slate-700">{event.description}</p>}
                  {Array.isArray(event.changes) && event.changes.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm text-slate-600">
                      {event.changes.map((change, index) => <li key={`${event.id}-${index}`}>{typeof change === "string" ? change : `${change.label || change.field || "Change"}: ${change.before ?? "—"} → ${change.after ?? "—"}`}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>}
    </main>
  );
};
export default JobHistoryView;
