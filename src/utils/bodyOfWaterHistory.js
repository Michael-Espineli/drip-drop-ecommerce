import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";

export const WATER_HISTORY_TYPES = {
  FILL: "Fill",
  EMPTY: "Empty",
};

const taskTypeToWaterHistoryType = (taskType) => {
  switch (taskType) {
    case "Fill Water":
      return WATER_HISTORY_TYPES.FILL;
    case "Empty Water":
      return WATER_HISTORY_TYPES.EMPTY;
    default:
      return null;
  }
};

const performedByForWorkerType = (workerType) => {
  const normalizedWorkerType = String(workerType || "").toLowerCase();
  if (normalizedWorkerType.includes("contractor")) return "Contractor";
  if (normalizedWorkerType.includes("employee")) return "Company";
  return "";
};

const cleanId = (sourceId = "") =>
  String(sourceId).replaceAll("/", "_").replace(/\s/g, "_");

const toDate = (value) => {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
};

export const recordBodyOfWaterTaskHistory = async ({
  db,
  companyId,
  task,
  serviceStop = null,
  jobId = "",
  completedAt = new Date(),
}) => {
  const type = taskTypeToWaterHistoryType(task?.type);
  const bodyOfWaterId = task?.bodyOfWaterId || "";

  if (!type || !companyId || !bodyOfWaterId) return null;

  const bodyOfWaterRef = doc(db, "companies", companyId, "bodiesOfWater", bodyOfWaterId);
  const bodyOfWaterSnap = await getDoc(bodyOfWaterRef);
  const bodyOfWater = bodyOfWaterSnap.exists() ? bodyOfWaterSnap.data() : {};

  const sourceId = task?.jobTaskId || task?.id || crypto.randomUUID();
  const serviceStopId = serviceStop?.id || task?.serviceStopId?.id || "";
  const taskJobId = task?.jobId?.id || jobId || serviceStop?.jobId || "";
  const techId = task?.workerId || serviceStop?.techId || "";
  const techName = task?.workerName || serviceStop?.tech || "";

  const history = {
    id: `auto_bow_hist_${cleanId(sourceId)}`,
    type,
    date: completedAt,
    description: `Auto-created from finished ${task.type} task.`,
    addedBy: "Auto",
    performedBy: performedByForWorkerType(task?.workerType),
    techId,
    techName,
    jobId: taskJobId,
    serviceStopId,
    taskId: sourceId,
    gallons: bodyOfWater.gallons || "",
  };

  await setDoc(doc(bodyOfWaterRef, "waterHistory", history.id), history, { merge: true });

  if (type === WATER_HISTORY_TYPES.FILL) {
    await updateDoc(bodyOfWaterRef, {
      lastFilled: completedAt,
    });
  }

  return history;
};

export const fetchBodyOfWaterHistory = async ({ db, companyId, bodyOfWaterId }) => {
  if (!companyId || !bodyOfWaterId) return [];

  const historyQuery = query(
    collection(db, "companies", companyId, "bodiesOfWater", bodyOfWaterId, "waterHistory"),
    orderBy("date", "desc")
  );

  const snapshot = await getDocs(historyQuery);
  return snapshot.docs.map((historyDoc) => {
    const data = historyDoc.data();
    return {
      id: historyDoc.id,
      ...data,
      date: toDate(data.date),
    };
  });
};
