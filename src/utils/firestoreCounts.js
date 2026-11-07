import { getCountFromServer, getDocs } from "firebase/firestore";

export const getServerCount = async (queryRef) => {
  const snapshot = await getCountFromServer(queryRef);
  return Number(snapshot.data().count || 0);
};

export const getFilteredDocsCount = async (queryRef, predicate = () => true) => {
  const snapshot = await getDocs(queryRef);
  return snapshot.docs.filter((itemDoc) => predicate(itemDoc)).length;
};

export const sumServerCounts = async (queryRefs = []) => {
  const counts = await Promise.all(queryRefs.map(getServerCount));
  return counts.reduce((total, count) => total + count, 0);
};

export const listenForForegroundRefresh = (callback) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  let timer;
  let refreshing = false;
  let disposed = false;

  // Browsers commonly emit visibilitychange and focus together. Coalesce them
  // and wait for an in-flight refresh before allowing another one.
  const refresh = async () => {
    timer = undefined;
    if (disposed || refreshing || document.visibilityState === "hidden") return;
    refreshing = true;
    try {
      await callback();
    } catch (error) {
      console.error("Unable to refresh foreground counts:", error);
    } finally {
      refreshing = false;
    }
  };
  const handleFocus = () => {
    if (disposed || refreshing || timer !== undefined) return;
    timer = window.setTimeout(refresh, 250);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") handleFocus();
  };

  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
};
