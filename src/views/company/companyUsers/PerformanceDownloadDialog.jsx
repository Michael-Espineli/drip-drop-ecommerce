import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ArrowDownTrayIcon, XMarkIcon } from "@heroicons/react/24/outline";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";
import { loadPerformanceTimelineReviews } from "../../../utils/performanceTimelineData";
import {
    defaultPerformanceExportSettings, PERFORMANCE_TIME_FRAMES, performanceExportFilename, performanceExportRange,
} from "../../../utils/performanceTimelineExport";

const inputClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

export default function PerformanceDownloadDialog({ companyId, companyUserId, technicianName, onClose }) {
    const { requirePermission } = useCompanyPermissions();
    const [settings, setSettings] = useState(defaultPerformanceExportSettings);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const busyRef = useRef(false);
    const activeRef = useRef(true);
    useEffect(() => {
        activeRef.current = true;
        return () => { activeRef.current = false; };
    }, []);
    const update = (key, value) => {
        setError("");
        setSettings((current) => ({ ...current, [key]: value }));
    };

    const download = async (event) => {
        event.preventDefault();
        if (busyRef.current || !requirePermission("260", "download performance history")) return;
        const generatedAt = new Date();
        let range;
        try { range = performanceExportRange(settings, generatedAt); }
        catch (failure) { setError(failure.message); return; }

        busyRef.current = true;
        setBusy(true);
        setError("");
        try {
            const reviews = await loadPerformanceTimelineReviews({ companyId, companyUserId, settings, range, isCanceled: () => !activeRef.current });
            if (!activeRef.current) return;
            if (!reviews.length) {
                setError("No performance entries match these settings. Choose a wider time frame or a different entry type.");
                return;
            }
            const { createPerformanceTimelinePdf } = await import("../../../utils/performanceTimelinePdf");
            if (!activeRef.current) return;
            const pdf = await createPerformanceTimelinePdf({ reviews, technicianName, settings, range, generatedAt });
            if (!activeRef.current) return;
            await pdf.save(performanceExportFilename(technicianName, settings, generatedAt), { returnPromise: true });
            if (activeRef.current) onClose();
        } catch (failure) {
            if (activeRef.current) setError(userFacingErrorMessage(failure, "Could not download the performance PDF. Check your connection and try again."));
        } finally {
            busyRef.current = false;
            if (activeRef.current) setBusy(false);
        }
    };

    return (
        <Dialog open onClose={() => !busyRef.current && onClose()} className="relative z-[60]">
            <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
            <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
                <DialogPanel className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl">
                    <form onSubmit={download} className="flex min-h-0 flex-col" aria-label="Download performance timeline" aria-busy={busy}>
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <DialogTitle className="text-lg font-semibold text-slate-950">Download Performance Timeline</DialogTitle>
                                <p className="mt-1 break-words text-sm text-slate-500">Prepare a PDF for your review with {technicianName}.</p>
                            </div>
                            <button type="button" onClick={onClose} disabled={busy} aria-label="Close download settings" className={workspaceButtonClass({ tone: "slate", className: "shrink-0 p-2" })}>
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
                            <fieldset disabled={busy} className="space-y-4">
                                <label className="block text-sm font-semibold text-slate-700">
                                    Time frame
                                    <select autoFocus value={settings.timeFrame} onChange={(event) => update("timeFrame", event.target.value)} className={inputClass}>
                                        {PERFORMANCE_TIME_FRAMES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </label>
                                {settings.timeFrame === "custom" && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="block text-sm font-semibold text-slate-700">Start date
                                            <input type="date" required value={settings.startDate} onChange={(event) => update("startDate", event.target.value)} className={inputClass} />
                                        </label>
                                        <label className="block text-sm font-semibold text-slate-700">End date
                                            <input type="date" required value={settings.endDate} onChange={(event) => update("endDate", event.target.value)} className={inputClass} />
                                        </label>
                                        <p className="text-xs text-slate-500 sm:col-span-2">Includes both dates in your local time zone.</p>
                                    </div>
                                )}
                                <label className="block text-sm font-semibold text-slate-700">Entries
                                    <select value={settings.entryType} onChange={(event) => update("entryType", event.target.value)} className={inputClass}>
                                        <option value="all">All performance entries</option>
                                        <option value="complaint">Complaints only</option>
                                    </select>
                                </label>
                                <label className="block text-sm font-semibold text-slate-700">Timeline order
                                    <select value={settings.order} onChange={(event) => update("order", event.target.value)} className={inputClass}>
                                        <option value="desc">Newest first</option>
                                        <option value="asc">Oldest first</option>
                                    </select>
                                </label>
                            </fieldset>
                            <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Includes full notes, dates, authors, saved reference labels, and report details. Attached files are listed by name; their contents are not included.</p>
                            {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
                            {busy && <p role="status" className="text-sm text-slate-600">Preparing your PDF...</p>}
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
                            <button type="button" onClick={onClose} disabled={busy} className={workspaceButtonClass({ tone: "slate" })}>Cancel</button>
                            <button type="submit" disabled={busy} className={workspaceButtonClass()}>
                                <ArrowDownTrayIcon className="h-4 w-4" />{busy ? "Downloading..." : "Confirm Download"}
                            </button>
                        </div>
                    </form>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
