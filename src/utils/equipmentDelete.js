import {
  collection,
  doc,
  getDocs,
  writeBatch,
} from "firebase/firestore";

const MAX_WRITES_PER_BATCH = 450;

const equipmentSubcollections = [
  "parts",
  "serviceHistory",
  "scheduledWork",
  "equipmentMeasurements",
  "equipmentMeasurments",
];

const createBatchDeleter = (db) => {
  let batch = writeBatch(db);
  let writeCount = 0;
  const deletedPaths = new Set();

  const commitIfNeeded = async () => {
    if (writeCount < MAX_WRITES_PER_BATCH) return;
    await batch.commit();
    batch = writeBatch(db);
    writeCount = 0;
  };

  return {
    delete: async (ref) => {
      if (!ref?.path || deletedPaths.has(ref.path)) return;

      batch.delete(ref);
      deletedPaths.add(ref.path);
      writeCount += 1;
      await commitIfNeeded();
    },
    commit: async () => {
      if (writeCount > 0) {
        await batch.commit();
      }
    },
  };
};

export const deleteEquipmentWithSubcollections = async (db, companyId, equipmentId) => {
  if (!db || !companyId || !equipmentId) {
    throw new Error("Missing company, database, or equipment id.");
  }

  const equipmentRef = doc(db, "companies", companyId, "equipment", equipmentId);
  const deleter = createBatchDeleter(db);

  for (const collectionName of equipmentSubcollections) {
    const snapshot = await getDocs(collection(equipmentRef, collectionName));

    for (const childDoc of snapshot.docs) {
      await deleter.delete(childDoc.ref);
    }
  }

  await deleter.delete(equipmentRef);
  await deleter.commit();
};
