export const FIREBASE_NETWORK_FALLBACK_MS = 3500;

export const browserIsOffline = () => (
  typeof navigator !== "undefined" && navigator.onLine === false
);

export const isFirebaseNetworkError = (error = {}) => {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || "").toLowerCase();

  return (
    browserIsOffline()
    || code === "unavailable"
    || code === "deadline-exceeded"
    || message.includes("client is offline")
    || message.includes("internet_disconnected")
    || message.includes("network")
    || message.includes("transport errored")
  );
};

export const isFirebaseClientStorageError = (error = {}) => {
  const code = String(error.code || "").toLowerCase();
  const name = String(error.name || "").toLowerCase();
  const message = String(error.message || error.reason?.message || error || "").toLowerCase();
  const stack = String(error.stack || error.reason?.stack || "").toLowerCase();
  const errorText = `${name} ${message} ${stack}`;

  return (
    code === "auth/web-storage-unsupported"
    || errorText.includes("indexeddb")
    || errorText.includes("indexeddbtransactionerror")
    || errorText.includes("internal error opening backing store")
    || errorText.includes("failed to persist write")
    || errorText.includes("web storage unsupported")
  );
};
