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

  const handleFocus = () => callback();
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") callback();
  };

  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
};
