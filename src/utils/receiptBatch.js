import { writeBatch } from "firebase/firestore";

// One receipt and its catalog/purchase records must succeed or fail together.
export const createReceiptBatch = (db) => {
  const batch = writeBatch(db);
  let writes = 0;
  const queue = (method, args) => {
    if (++writes > 500) throw new Error("This receipt exceeds the save limit. Reduce its line items or create catalog items before importing it.");
    batch[method](...args);
  };
  return { set: (...args) => queue("set", args), update: (...args) => queue("update", args), commit: () => batch.commit() };
};
