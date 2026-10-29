import { useCallback, useEffect, useRef, useState } from "react";

// Keep writes in order and retain the newest edit if another save is in flight.
export default function usePlanEditorAutosave({ documentKey, snapshot, dirty, enabled, save, delay = 500 }) {
  const pending = useRef(null);
  const active = useRef(null);
  const inFlight = useRef(null);
  const saved = useRef(null);
  const observedDocument = useRef(null);
  const latestSave = useRef(save);
  latestSave.current = save;
  const [status, setStatus] = useState("saved");

  const flush = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    if (!pending.current) return Promise.resolve();
    inFlight.current = Promise.resolve().then(async () => {
      while (pending.current) {
        const edit = pending.current;
        pending.current = null;
        setStatus("saving");
        active.current = edit;
        try {
          await edit.save();
          saved.current = edit;
        } catch (error) {
          pending.current = pending.current || edit;
          setStatus("error");
          throw error;
        } finally {
          active.current = null;
        }
      }
      setStatus("saved");
    }).finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (observedDocument.current !== documentKey) {
      // Hydrating existing scope is a read, even if its saved snapshot is older.
      observedDocument.current = documentKey;
      saved.current = { documentKey, snapshot };
      return undefined;
    }
    const matches = (edit) => edit?.documentKey === documentKey && edit.snapshot === snapshot;
    if ((!dirty || matches(saved.current)) && !active.current) {
      // Reverting an edit also cancels its queued write.
      if (!active.current && pending.current?.documentKey === documentKey) {
        pending.current = null;
        setStatus("saved");
      }
      return undefined;
    }
    if (matches(active.current)) {
      pending.current = null;
      return undefined;
    }
    pending.current = { documentKey, snapshot, save: latestSave.current };
    if (!active.current) setStatus("pending");
    const timeout = setTimeout(() => { flush().catch(() => {}); }, delay);
    return () => clearTimeout(timeout);
  }, [delay, dirty, documentKey, enabled, flush, snapshot]);

  // Internal navigation can unmount the editor before the debounce expires.
  useEffect(() => () => { flush().catch(() => {}); }, [flush]);

  return { status, flush, saving: status === "saving", hasPendingChanges: status !== "saved" };
}
