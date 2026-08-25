import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { canonicalJobTaskType } from "./jobTaskTypes";

const numberValue = (...values) => {
  const found = values.find((value) => value !== undefined && value !== null && value !== "");
  const parsed = Number(found || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const taskGroupOptionFromDoc = (docSnap, sourcePath) => {
  const data = docSnap.data() || {};
  const id = data.id || docSnap.id;
  const label = data.name || data.groupName || "Task Group";

  return {
    ...data,
    id,
    value: `${sourcePath}:${id}`,
    label,
    sourcePath,
  };
};

export const fetchRecurringTaskGroupOptions = async ({ db, companyId }) => {
  if (!db || !companyId) return [];

  const [legacyTaskGroupsSnap, taskGroupsSnap] = await Promise.all([
    getDocs(collection(db, "companies", companyId, "settings", "taskGroup", "taskGroup")),
    getDocs(collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups")),
  ]);

  return [
    ...legacyTaskGroupsSnap.docs.map((docSnap) => taskGroupOptionFromDoc(docSnap, "legacy")),
    ...taskGroupsSnap.docs.map((docSnap) => taskGroupOptionFromDoc(docSnap, "current")),
  ].sort((a, b) => a.label.localeCompare(b.label));
};

export const fetchTaskGroupTasks = async ({ db, companyId, taskGroup }) => {
  if (!db || !companyId || !taskGroup?.id) return [];

  const taskCollections = taskGroup.sourcePath === "legacy"
    ? [
      collection(db, "companies", companyId, "settings", "taskGroup", "taskGroup", taskGroup.id, "taskItems"),
      collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups", taskGroup.id, "tasks"),
    ]
    : [
      collection(db, "companies", companyId, "settings", "taskGroups", "taskGroups", taskGroup.id, "tasks"),
      collection(db, "companies", companyId, "settings", "taskGroup", "taskGroup", taskGroup.id, "taskItems"),
    ];

  for (const taskCollection of taskCollections) {
    const snapshot = await getDocs(taskCollection);
    if (snapshot.docs.length) {
      return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    }
  }

  return [];
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
