import React, { useCallback, useEffect, useId, useRef } from "react";
import toast from "react-hot-toast";

export default function usePayrollNotifications(scopeKey) {
  const notificationId = useId();
  const currentScope = useRef(scopeKey);
  const mounted = useRef(true);
  currentScope.current = scopeKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      toast.remove(notificationId);
    };
  }, [scopeKey, notificationId]);

  return useCallback((type, message = "") => {
    if (!mounted.current || currentScope.current !== scopeKey) return;
    if (!message) {
      toast.dismiss(notificationId);
      return;
    }
    const show = type === "error" ? toast.error : toast.success;
    show(notification => (
      <div className="flex items-start gap-3">
        <span className="min-w-0 break-words">{message}</span>
        <button type="button" aria-label="Dismiss payroll alert" onClick={() => toast.dismiss(notification.id)}
          className="shrink-0 rounded px-1 text-lg leading-none opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    ), {
      id: notificationId,
      position: "top-right",
      duration: type === "error" ? 8000 : 5000,
      ariaProps: { role: type === "error" ? "alert" : "status", "aria-live": type === "error" ? "assertive" : "polite" },
      style: { maxWidth: "min(32rem, calc(100vw - 2rem))" },
    });
  }, [scopeKey, notificationId]);
}
