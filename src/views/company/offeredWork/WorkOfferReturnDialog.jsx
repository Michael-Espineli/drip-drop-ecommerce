import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import React, { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { manageTechnicianWork } from "../../../utils/technicianWorkflow";

export default function WorkOfferReturnDialog({ companyId, offer, claim, onClose, onReturned }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async event => {
    event.preventDefault();
    if (busy || !reason.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await manageTechnicianWork(companyId, "withdraw", { offerId: offer.id, claimId: claim.id, reason: reason.trim() });
      await onReturned(result);
      onClose();
    } catch (failure) { setError(userFacingErrorMessage(failure, failure.message || "Could not return this work.")); }
    finally { setBusy(false); }
  };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="relative z-[60]">
    <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel as="form" onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-xl border border-theme bg-surface p-6 text-theme shadow-xl">
        <DialogTitle className="text-xl font-bold">Return accepted work</DialogTitle>
        <p className="font-semibold">{offer.title} · {claim.workerName}</p>
        <p className="text-sm">Unstarted work returns to the office for reassignment. Your acceptance, agreed pay, and return reason stay in the offer history. Recorded work or payroll requires management review.</p>
        <label className="block text-sm font-semibold">Reason (required)<textarea required disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-md border border-theme bg-surface p-3" rows={3} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-theme px-4 py-2">Keep work</button>
          <button disabled={busy || !reason.trim()} className="rounded-md bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Returning…" : "Return work"}</button>
        </div>
      </DialogPanel>
    </div>
  </Dialog>;
}
