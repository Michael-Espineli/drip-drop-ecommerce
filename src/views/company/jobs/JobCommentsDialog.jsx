import React, { useContext, useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID, JOBS_PERMISSION_ID, UPDATE_JOBS_PERMISSION_ID } from "../../../utils/companyPermissions";
import { displayReferenceValue } from "../../../utils/displayReferences";
import { resolveJobCreator } from "../../../utils/jobHistory";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";

const commentTime = (comment) => {
  const value = comment.date || comment.createdAt || comment.dateMillis || comment.createdAtMillis;
  const date = value?.toDate ? value.toDate() : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

export default function JobCommentsDialog({ companyId, job, onClose, onCommentCountChange }) {
  const { user, dataBaseUser } = useContext(Context);
  const { can } = useCompanyPermissions();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState("Open");
  const [draft, setDraft] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const saving = useRef(false);
  const actor = resolveJobCreator({ user: user || {}, profile: dataBaseUser || {} });
  const jobLabel = displayReferenceValue(job.internalId, "Job");
  const isTemplateJob = Boolean(job.sourceTemplateId || job.jobTemplateId ||
    (job.createdFromBasicWorkOrderForm && job.basicWorkOrderMode === "template"));
  const canEditJob = can(UPDATE_JOBS_PERMISSION_ID) || (isTemplateJob && can(EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID));
  const canComment = Boolean(actor.userId && (can(JOBS_PERMISSION_ID) || canEditJob));
  const canResolve = (comment) => canComment && (canEditJob || comment.userId === actor.userId);
  const openCount = comments.filter((comment) => !comment.resolved).length;
  const shownComments = comments.filter((comment) => filter === "All" || (filter === "Resolved" ? comment.resolved : !comment.resolved));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    const unsubscribe = onSnapshot(
      collection(db, "companies", companyId, "workOrders", job.id, "comments"),
      (snapshot) => {
        if (!active) return;
        const next = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }))
          .sort((left, right) => commentTime(right) - commentTime(left));
        setComments(next);
        setLoading(false);
        onCommentCountChange(job.id, next.filter((comment) => !comment.resolved).length);
      },
      (error) => {
        if (!active) return;
        setLoading(false);
        setLoadError(userFacingErrorMessage(error, "Unable to load comments. Please try again."));
      }
    );
    return () => { active = false; unsubscribe(); };
  }, [companyId, job.id, loadAttempt, onCommentCountChange]);

  const addHistory = (batch, { title, description = "", commentId }) => {
    // Job viewers can comment; updating history and job metadata requires job edit access.
    if (!canEditJob) return;
    const historyRef = doc(collection(db, "companies", companyId, "workOrders", job.id, "history"));
    const now = Date.now();
    batch.set(historyRef, {
      id: historyRef.id, companyId, jobId: job.id, jobInternalId: job.internalId || "",
      eventType: "Comment", title, description, changes: [], metadata: { commentId },
      changeOrderId: "", severity: "info", actorUserId: actor.userId,
      actorUserName: actor.userName, actorCompanyUserId: dataBaseUser?.id || "",
      createdAt: serverTimestamp(), createdAtMillis: now,
    });
    batch.update(doc(db, "companies", companyId, "workOrders", job.id), {
      updatedAt: serverTimestamp(), updatedAtMillis: now,
      lastHistoryEventId: historyRef.id, lastHistoryEventTitle: title, lastHistoryEventType: "Comment",
    });
  };

  const addComment = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!canComment || !text || saving.current) return;
    saving.current = true;
    setPendingAction("add");
    setActionError("");
    try {
      const commentRef = doc(collection(db, "companies", companyId, "workOrders", job.id, "comments"));
      const batch = writeBatch(db);
      batch.set(commentRef, {
        id: commentRef.id, companyId, jobId: job.id, userId: actor.userId, userName: actor.userName,
        authorId: actor.userId, authorName: actor.userName, date: serverTimestamp(), dateMillis: Date.now(),
        comment: text, resolved: false, sourceType: "", metadata: {},
      });
      addHistory(batch, { title: "Comment added", description: text, commentId: commentRef.id });
      await batch.commit();
      setDraft("");
      if (filter === "Resolved") setFilter("Open");
      toast.success("Comment added");
    } catch (error) {
      setActionError(userFacingErrorMessage(error, "Unable to add this comment. Your draft is still here; please try again."));
    } finally {
      saving.current = false;
      setPendingAction("");
    }
  };

  const toggleResolved = async (comment) => {
    if (!canResolve(comment) || saving.current) return;
    saving.current = true;
    setPendingAction(comment.id);
    setActionError("");
    const resolved = !comment.resolved;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "companies", companyId, "workOrders", job.id, "comments", comment.id), { resolved });
      addHistory(batch, { title: resolved ? "Comment resolved" : "Comment reopened", commentId: comment.id });
      await batch.commit();
      toast.success(resolved ? "Comment resolved" : "Comment reopened");
    } catch (error) {
      setActionError(userFacingErrorMessage(error, "Unable to update this comment. Please try again."));
    } finally {
      saving.current = false;
      setPendingAction("");
    }
  };

  return (
    <Dialog open onClose={() => { if (!saving.current) onClose(); }} className="relative z-50">
      <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-5">
        <DialogPanel className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold">Comments · {jobLabel}</DialogTitle>
              <p className="mt-1 break-words text-sm text-slate-600">{[job.customerName, job.description].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" onClick={onClose} disabled={Boolean(pendingAction)} aria-label="Close job comments" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5" role="group" aria-label="Filter comments">
            {["Open", "Resolved", "All"].map((value) => (
              <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${filter === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}>
                {value}{!loading && !loadError && ` (${value === "All" ? comments.length : value === "Open" ? openCount : comments.length - openCount})`}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" aria-busy={loading}>
            {loading ? <p role="status" className="text-sm text-slate-500">Loading comments...</p> : loadError ? (
              <div role="alert" className="text-sm text-red-700">
                <p>{loadError}</p>
                <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mt-2 rounded-md border border-red-200 px-3 py-1.5 font-semibold hover:bg-red-50">Try again</button>
              </div>
            ) : shownComments.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">{comments.length === 0 ? "No comments yet. Add the first comment below." : `No ${filter.toLowerCase()} comments.`}</p>
            ) : (
              <ul className="space-y-3" aria-label="Job comments">
                {shownComments.map((comment) => (
                  <li key={comment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">{comment.userName || comment.authorName || "Unknown"}</span>
                      {commentTime(comment) > 0 && <time dateTime={new Date(commentTime(comment)).toISOString()}>{new Date(commentTime(comment)).toLocaleString()}</time>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{comment.comment || comment.note || comment.text}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${comment.resolved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{comment.resolved ? "Resolved" : "Open"}</span>
                      <button type="button" onClick={() => toggleResolved(comment)} disabled={!canResolve(comment) || Boolean(pendingAction)}
                        title={canResolve(comment) ? undefined : "You need permission to update this job to resolve other people's comments"}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                        {pendingAction === comment.id ? "Saving..." : comment.resolved ? "Reopen" : "Resolve"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form onSubmit={addComment} className="border-t border-slate-200 p-4 sm:p-5">
            {actionError && <p role="alert" className="mb-3 text-sm text-red-700">{actionError}</p>}
            <label htmlFor="quick-job-comment" className="text-sm font-semibold text-slate-800">New comment</label>
            <textarea id="quick-job-comment" data-autofocus rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!canComment || Boolean(pendingAction)}
              placeholder="Write a comment..." className="mt-2 block w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:opacity-50" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">{canComment ? "Saved to this job's comment thread." : "You need access to Jobs to add comments."}</p>
              <button type="submit" disabled={!canComment || !draft.trim() || Boolean(pendingAction)} className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {pendingAction === "add" ? "Adding..." : "Add comment"}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
