import React from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";

export default function JobDeleteOptionsDialog({
  open,
  onClose,
  canUpdate,
  canDelete,
  deleteLocked,
  busy,
  onCancelToPotential,
  onCancelOnly,
  onCustomerResolved,
  onDelete,
}) {
  const choose = (action) => (event) => {
    onClose();
    action(event);
  };
  const optionClass = "w-full rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} className="relative z-50">
      <div className="fixed inset-0 bg-slate-950/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
        <DialogPanel className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <DialogTitle className="text-lg font-bold text-slate-950">Cancel or delete job</DialogTitle>
              <p className="mt-1 text-sm text-slate-600">Choose how to close this job.</p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close job options" className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3 p-5">
            {canUpdate && <>
              <button type="button" onClick={choose(onCancelToPotential)} disabled={busy} className={`${optionClass} border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100`}>
                <span className="block text-sm font-semibold">Cancel to Potential Work</span>
                <span className="mt-1 block text-xs">Keep the job in history and save the scope as potential customer work.</span>
              </button>
              <button type="button" onClick={choose(onCancelOnly)} disabled={busy} className={`${optionClass} border-slate-200 text-slate-800 hover:bg-slate-50`}>
                <span className="block text-sm font-semibold">Cancel Job Only</span>
                <span className="mt-1 block text-xs">Keep the job in history without creating potential work.</span>
              </button>
              <button type="button" onClick={choose(onCustomerResolved)} disabled={busy} className={`${optionClass} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
                <span className="block text-sm font-semibold">Customer Took Care Of It</span>
                <span className="mt-1 block text-xs">Close the job with a customer resolution note.</span>
              </button>
            </>}
            {canDelete && (
              <button type="button" onClick={choose(onDelete)} disabled={busy || deleteLocked} className={`${optionClass} border-red-200 bg-red-50 text-red-800 hover:bg-red-100`}>
                <span className="block text-sm font-semibold">Delete Job</span>
                <span className="mt-1 block text-xs">{deleteLocked ? "Finished jobs cannot be deleted." : "Permanently remove an accidental or duplicate job. You will be asked to confirm."}</span>
              </button>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
