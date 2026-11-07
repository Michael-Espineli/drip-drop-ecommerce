import { jobPayFields } from "./payroll/payCalculation";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { canonicalJobTaskType } from "./jobTaskTypes";

const numberValue = (...values) => {
  const found = values.find((value) => value !== undefined && value !== null && value !== "");
  const parsed = Number(found || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const taskGroupOptionFromDoc = (docSnap, sourcePath) => {
  const data = docSnap.data() || {};
  const id = docSnap.id;
  const label = data.name || data.groupName || "Task Group";

  return {
    ...data,
    id,
    name: label,
    value: id,
    label,
    sourcePath,
  };
};

export const fetchRecurringTaskGroupOptions = async ({ db, companyId }) => {
  if (!db || !companyId) return [];

  const [canonicalSnap, pluralSnap] = await Promise.all([
    getDocs(collection(db, "companies", companyId, "settings", "taskGroup", "taskGroup")),
    getDocs(collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups")),
  ]);

  const groups = new Map();
  for (const snapshot of pluralSnap.docs) groups.set(snapshot.id, taskGroupOptionFromDoc(snapshot, "plural"));
  for (const snapshot of canonicalSnap.docs) groups.set(snapshot.id, taskGroupOptionFromDoc(snapshot, "canonical"));
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
};

export const fetchTaskGroupTasks = async ({ db, companyId, taskGroup }) => {
  if (!db || !companyId || !taskGroup?.id) return [];

  const canonical = doc(db, "companies", companyId, "settings", "taskGroup", "taskGroup", taskGroup.id);
  const [groupSnapshot, items] = await Promise.all([
    getDoc(canonical),
    getDocs(collection(canonical, "taskItems")),
  ]);
  // An existing empty canonical group is intentional, not a reason to resurrect old tasks.
  if (groupSnapshot.exists() || items.docs.length) {
    return items.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }));
  }
  const plural = doc(db, "companies", companyId, "settings", "taskGroups", "taskGroups", taskGroup.id);
  const snapshots = await Promise.all([
    getDocs(collection(plural, "taskItems")),
    getDocs(collection(plural, "tasks")),
  ]);
  const tasks = new Map();
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) tasks.set(item.id, { ...item.data(), id: item.id });
  }
  return [...tasks.values()];
};

export const loadRecurringServiceStopTasks = async ({
  db,
  companyId,
  recurringServiceStopId,
  recurringServiceStop = {},
}) => {
  if (!db || !companyId || !recurringServiceStopId) return [];

  const tasksSnap = await getDocs(
    collection(db, "companies", companyId, "recurringServiceStop", recurringServiceStopId, "tasks")
  );

  if (tasksSnap.docs.length) {
    return tasksSnap.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }));
  }

  const inlineTasks = [
    recurringServiceStop.tasks,
    recurringServiceStop.serviceTasks,
    recurringServiceStop.recurringServiceStopTasks,
  ].find((value) => Array.isArray(value));

  return inlineTasks || [];
};

export const buildRecurringTaskFromTemplate = ({
  task = {},
  taskGroup = {},
  recurringServiceStop = {},
} = {}) => {
  const taskGroupTaskId = task.id || task.taskGroupTaskId || "";
  const type = canonicalJobTaskType(task.type || task.taskType || task.typeName || "");
  const name = String(task.name || task.taskName || "Task").trim();

  return {
    id: `com_rss_tas_${uuidv4()}`,
    name,
    description: String(task.description || "").trim(),
    typeId: task.typeId || "",
    type,
    contractedRate: numberValue(task.contractedRate, task.laborCost, task.rate),
    ...jobPayFields(task),
    estimatedTime: numberValue(task.estimatedTime, task.estimatedMinutes, task.minutes, task.durationMinutes),
    status: task.status || "Accepted",
    equipmentId: task.equipmentId || "",
    serviceLocationId: recurringServiceStop.serviceLocationId || task.serviceLocationId || "",
    bodyOfWaterId: task.bodyOfWaterId || "",
    dataBaseItemId: task.dataBaseItemId || task.databaseItemId || task.dbItemId || "",
    shoppingListItemId: task.shoppingListItemId || "",
    customerApproval: Boolean(task.customerApproval),
    isTaskGroup: true,
    taskGroupId: taskGroup.id || "",
    taskGroupName: taskGroup.label || taskGroup.name || taskGroup.groupName || "",
    taskGroupTaskId,
  };
};

const buildServiceStopTaskFromRecurringTask = ({
  recurringTask,
  recurringServiceStop,
  recurringServiceStopId,
  serviceStop,
  serviceStopId,
}) => ({
  id: `com_ss_tas_${uuidv4()}`,
  name: recurringTask.name || "Task",
  description: recurringTask.description || "",
  typeId: recurringTask.typeId || "",
  type: canonicalJobTaskType(recurringTask.type || ""),
  status: "Not Finished",
  contractedRate: numberValue(recurringTask.contractedRate),
  ...jobPayFields(recurringTask),
  estimatedTime: numberValue(recurringTask.estimatedTime),
  customerApproval: Boolean(recurringTask.customerApproval),
  actualTime: 0,
  workerId: serviceStop.techId || recurringServiceStop.techId || "",
  workerType: serviceStop.workerType || "",
  workerName: serviceStop.tech || recurringServiceStop.tech || "",
  laborContractId: serviceStop.laborContractId || recurringServiceStop.laborContractId || "",
  serviceStopId: {
    id: serviceStopId,
    internalId: serviceStop.internalId || "",
  },
  jobId: {
    id: serviceStop.jobId || "",
    internalId: serviceStop.jobInternalId || "",
  },
  recurringServiceStopId: {
    id: recurringServiceStopId,
    internalId: recurringServiceStop.internalId || "",
  },
  jobTaskId: "",
  recurringServiceStopTaskId: recurringTask.id,
  equipmentId: recurringTask.equipmentId || "",
  serviceLocationId: serviceStop.serviceLocationId || recurringServiceStop.serviceLocationId || "",
  bodyOfWaterId: recurringTask.bodyOfWaterId || "",
  dataBaseItemId: recurringTask.dataBaseItemId || "",
  shoppingListItemId: recurringTask.shoppingListItemId || "",
  isTaskGroup: Boolean(recurringTask.isTaskGroup),
  taskGroupId: recurringTask.taskGroupId || "",
  taskGroupTaskId: recurringTask.taskGroupTaskId || "",
});

export const addRecurringTasksToRecurringStopAndFutureStops = async ({
  db,
  companyId,
  recurringServiceStop,
  recurringServiceStopId,
  recurringTasks,
}) => {
  const stopId = recurringServiceStopId || recurringServiceStop?.id;
  if (!db || !companyId || !stopId || !recurringTasks?.length) {
    return { recurringTasks: [], futureStopCount: 0 };
  }

  await Promise.all(
    recurringTasks.map((task) => setDoc(
      doc(db, "companies", companyId, "recurringServiceStop", stopId, "tasks", task.id),
      task
    ))
  );

  const futureStopsSnap = await getDocs(
    query(
      collection(db, "companies", companyId, "serviceStops"),
      where("recurringServiceStopId", "==", stopId),
      where("serviceDate", ">=", new Date())
    )
  );

  await Promise.all(
    futureStopsSnap.docs.flatMap((serviceStopDoc) => {
      const serviceStop = serviceStopDoc.data() || {};
      const serviceStopId = serviceStop.id || serviceStopDoc.id;

      return recurringTasks.map((recurringTask) => {
        const serviceStopTask = buildServiceStopTaskFromRecurringTask({
          recurringTask,
          recurringServiceStop,
          recurringServiceStopId: stopId,
          serviceStop,
          serviceStopId,
        });

        return setDoc(
          doc(db, "companies", companyId, "serviceStops", serviceStopId, "tasks", serviceStopTask.id),
          serviceStopTask
        );
      });
    })
  );

  return {
    recurringTasks,
    futureStopCount: futureStopsSnap.docs.length,
  };
};

export const applyTaskGroupToRecurringServiceStop = async ({
  db,
  companyId,
  recurringServiceStop,
  recurringServiceStopId,
  taskGroup,
}) => {
  const groupTasks = await fetchTaskGroupTasks({ db, companyId, taskGroup });
  if (!groupTasks.length) {
    throw new Error("This task template does not have any tasks.");
  }

  const recurringTasks = groupTasks.map((task) => buildRecurringTaskFromTemplate({
    task,
    taskGroup,
    recurringServiceStop,
  }));

  return addRecurringTasksToRecurringStopAndFutureStops({
    db,
    companyId,
    recurringServiceStop,
    recurringServiceStopId: recurringServiceStopId || recurringServiceStop?.id,
    recurringTasks,
  });
};
