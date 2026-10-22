import React, { useState } from "react";
import { Link } from "react-router-dom";

export default function PublicRepairRequestLink({ companyId }) {
  const [copyStatus, setCopyStatus] = useState("");
  if (!companyId) return null;
  const path = `/request-repair/${encodeURIComponent(companyId)}`;
  const url = `${window.location.origin}${path}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Link copied.");
    } catch {
      setCopyStatus("Select and copy the link above.");
    }
  };

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
      <p className="font-semibold text-slate-900">External technician repair form</p>
      <p className="mt-1 text-sm text-slate-600">Share this link with technicians. Pick an active company user and customer without logging in. Submissions appear under External Requests.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input aria-label="Public repair request link" readOnly value={url} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700" />
        <button type="button" onClick={copyLink} className="rounded-md border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">Copy link</button>
        <Link to={path} target="_blank" rel="noopener noreferrer" className="rounded-md border border-blue-200 bg-white px-4 py-2 text-center text-sm font-semibold text-blue-700 hover:bg-blue-100">Open form</Link>
      </div>
      <p role="status" className="mt-2 text-xs text-blue-800">{copyStatus}</p>
    </div>
  );
}
