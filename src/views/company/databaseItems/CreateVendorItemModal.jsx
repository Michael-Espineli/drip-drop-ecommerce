import React, { useEffect, useRef, useState } from "react";
import CreateNewDataBaseItem from "./CreateNewDataBaseItem";

export default function CreateVendorItemModal({ onCreated, onClose }) {
  const dialog = useRef(null);
  const previousFocus = useRef(document.activeElement);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const returnFocus = previousFocus.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const close = () => { if (!saving) onClose(); };
  const handleKeyDown = (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      close();
    }
    if (event.key === "Tab") {
      const fields = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex='0']")]
        .filter((field) => field.getClientRects().length && !field.closest("fieldset:disabled"));
      const first = fields[0], last = fields[fields.length - 1];
      if (!fields.length) event.preventDefault();
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-3 py-4 sm:px-6" onKeyDown={handleKeyDown}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="create-vendor-item-title" className="w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
      <CreateNewDataBaseItem compact onCreated={onCreated} onCancel={close} onSavingChange={setSaving} />
    </div>
  </div>;
}
