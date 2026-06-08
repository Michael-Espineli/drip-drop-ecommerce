import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { recordBodyOfWaterTaskHistory } from "./bodyOfWaterHistory";
import { EQUIPMENT_STATUS } from "./models/Equipment";

const EQUIPMENT_HISTORY_TYPES = {
  INSTALL: "Install",
  MAINTENANCE: "Maintenance",
  REPAIR: "Repair",
};

const FINISHED_STATUS = "Finished";

const cleanId = (sourceId = "") =>
  String(sourceId || fallbackId()).replaceAll("/", "_").replace(/\s/g, "_");

const fallbackId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const toDate = (value) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
};

const normalizeTaskType = (type = "") => String(type || "").trim();

const taskTypeToEquipmentHistoryType = (taskType) => {
  switch (normalizeTaskType(taskType).toLowerCase()) {
    case "clean filter":
    case "maintenance":
      return EQUIPMENT_HISTORY_TYPES.MAINTENANCE;
    case "repair":
    case "replace":
    case "replacement":
      return EQUIPMENT_HISTORY_TYPES.REPAIR;
    default:
      return null;
  }
};

const isReplacementTaskType = (taskType) =>
  ["replace", "replacement"].includes(normalizeTaskType(taskType).toLowerCase());

const replacementEquipmentIdFor = (task = {}) =>
  task.replacementEquipmentId || task.newEquipmentId || task.installedEquipmentId || "";

const equipmentStatusOnCompletionFor = (task = {}) =>
  task.equipmentStatusOnCompletion ||
  task.completedEquipmentStatus ||
  task.resolvedEquipmentStatus ||
  "";

const installDataBaseItemIdFor = (task = {}) =>
  task.dataBaseItemId || task.dbItemId || task.itemId || task.installedDataBaseItemId || "";

const fetchDataBaseItem = async ({ db, companyId, dataBaseItemId }) => {
  if (!db || !companyId || !dataBaseItemId) return null;

  const dataBaseItemRef = doc(
    db,
    "companies",
    companyId,
    "settings",
    "dataBase",
    "dataBase",
    dataBaseItemId
  );
  const dataBaseItemSnap = await getDoc(dataBaseItemRef);
  if (!dataBaseItemSnap.exists()) return null;

  return { id: dataBaseItemSnap.id, ...dataBaseItemSnap.data() };
};

const fetchShoppingListItem = async ({ db, companyId, shoppingListItemId }) => {
  if (!db || !companyId || !shoppingListItemId) return null;

  const shoppingItemRef = doc(db, "companies", companyId, "shoppingList", shoppingListItemId);
  const shoppingItemSnap = await getDoc(shoppingItemRef);
  if (!shoppingItemSnap.exists()) return null;

  return { id: shoppingItemSnap.id, ...shoppingItemSnap.data() };
};

const fetchPurchasedItem = async ({ db, companyId, purchasedItemId }) => {
  if (!db || !companyId || !purchasedItemId) return null;

  const purchasedItemRef = doc(db, "companies", companyId, "purchasedItems", purchasedItemId);
  const purchasedItemSnap = await getDoc(purchasedItemRef);
  if (!purchasedItemSnap.exists()) return null;

  return { id: purchasedItemSnap.id, ...purchasedItemSnap.data() };
};

const fetchPurchasedItemForTask = async ({
  db,
  companyId,
  jobId,
  task,
  dataBaseItemId,
}) => {
  if (!db || !companyId) return null;

  const explicitPurchasedItemId =
    task?.purchasedItemId ||
    task?.installedPurchasedItemId ||
    task?.sourcePurchasedItemId ||
    "";

  if (explicitPurchasedItemId) {
    return fetchPurchasedItem({ db, companyId, purchasedItemId: explicitPurchasedItemId });
  }

  if (!jobId || !dataBaseItemId) return null;

  const purchasedItemsRef = collection(db, "companies", companyId, "purchasedItems");
  const purchasedQueries = [
    query(purchasedItemsRef, where("jobId", "==", jobId)),
    query(purchasedItemsRef, where("workOrderId", "==", jobId)),
    query(purchasedItemsRef, where("assignedJobId", "==", jobId)),
  ];

  const snapshots = await Promise.all(
    purchasedQueries.map((purchasedQuery) => getDocs(purchasedQuery))
  );
  const itemsById = new Map();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((purchasedDoc) => {
      itemsById.set(purchasedDoc.id, { id: purchasedDoc.id, ...purchasedDoc.data() });
    });
  });

  return (
    Array.from(itemsById.values()).find((item) =>
      [item.itemId, item.dbItemId, item.dataBaseItemId, item.genericItemId]
        .filter(Boolean)
        .includes(dataBaseItemId)
    ) || null
  );
};

const createInstalledEquipmentFromTask = async ({
  db,
  companyId,
  oldEquipment,
  task,
  jobId,
  completedAt,
}) => {
  if (!isReplacementTaskType(task?.type)) return null;

  const existingReplacementEquipmentId = replacementEquipmentIdFor(task);
  if (existingReplacementEquipmentId) {
    return { id: existingReplacementEquipmentId, status: "Linked" };
  }

  const shoppingItem = await fetchShoppingListItem({
    db,
    companyId,
    shoppingListItemId: task?.shoppingListItemId || "",
  });

  const dataBaseItemId =
    installDataBaseItemIdFor(task) ||
    shoppingItem?.dbItemId ||
    shoppingItem?.itemId ||
    shoppingItem?.dataBaseItemId ||
    "";
  const shoppingPurchasedItemId =
    shoppingItem?.purchasedItem ||
    shoppingItem?.purchasedItemId ||
    shoppingItem?.sourcePurchasedItemId ||
    "";
  const purchasedItemFromShoppingItem = await fetchPurchasedItem({
    db,
    companyId,
    purchasedItemId: shoppingPurchasedItemId,
  });
  const purchasedItem =
    purchasedItemFromShoppingItem ||
    (await fetchPurchasedItemForTask({
      db,
      companyId,
      jobId,
      task,
      dataBaseItemId,
    }));
  const resolvedDataBaseItemId =
    dataBaseItemId || purchasedItem?.itemId || purchasedItem?.dbItemId || "";
  const dataBaseItem = await fetchDataBaseItem({
    db,
    companyId,
    dataBaseItemId: resolvedDataBaseItemId,
  });

  const installedName =
    task?.installedEquipmentName ||
    task?.replacementEquipmentName ||
    dataBaseItem?.name ||
    purchasedItem?.name ||
    shoppingItem?.name ||
    "";

  if (!installedName) return null;

  const sourceTaskId = sourceTaskIdFor(task);
  const installedEquipmentId = `com_equ_installed_${cleanId(sourceTaskId)}`;
  const installedType =
    task?.installedEquipmentType ||
    task?.replacementEquipmentType ||
    dataBaseItem?.equipmentType ||
    dataBaseItem?.type ||
    dataBaseItem?.subCategory ||
    oldEquipment?.type ||
    "";

  const installedEquipment = {
    id: installedEquipmentId,
    name: installedName,
    type: installedType,
    category: installedType,
    typeId: task?.installedEquipmentTypeId || dataBaseItem?.equipmentTypeId || dataBaseItem?.typeId || oldEquipment?.typeId || "",
    make: task?.installedEquipmentMake || dataBaseItem?.equipmentMake || dataBaseItem?.make || "",
    makeId: task?.installedEquipmentMakeId || dataBaseItem?.equipmentMakeId || dataBaseItem?.makeId || "",
    model: task?.installedEquipmentModel || dataBaseItem?.equipmentModel || dataBaseItem?.model || dataBaseItem?.name || installedName,
    modelId:
      task?.installedEquipmentModelId ||
      dataBaseItem?.equipmentModelId ||
      dataBaseItem?.modelId ||
      dataBaseItem?.universalEquipmentId ||
      "",
    universalEquipmentId:
      task?.universalEquipmentId ||
      dataBaseItem?.universalEquipmentId ||
      dataBaseItem?.modelId ||
      "",
    manualPdfLink: dataBaseItem?.manualPdfLink || task?.manualPdfLink || "",
    dateInstalled: completedAt,
    status: EQUIPMENT_STATUS.OPERATIONAL,
    needsService: false,
    isActive: true,
    active: true,
    customerId: oldEquipment?.customerId || task?.customerId || "",
    customerName: oldEquipment?.customerName || task?.customerName || "",
    serviceLocationId: oldEquipment?.serviceLocationId || task?.serviceLocationId || "",
    bodyOfWaterId: task?.bodyOfWaterId || oldEquipment?.bodyOfWaterId || "",
    notes: task?.installedEquipmentNotes || "",
    replacesEquipmentId: oldEquipment?.id || task?.equipmentId || "",
    installedFromJobId: jobId || "",
    installedFromTaskId: sourceTaskId,
    sourceDataBaseItemId: dataBaseItem?.id || resolvedDataBaseItemId || "",
    sourceShoppingListItemId: shoppingItem?.id || task?.shoppingListItemId || "",
    sourcePurchasedItemId: purchasedItem?.id || task?.purchasedItemId || "",
    source: "replacementTask",
    createdAt: completedAt,
  };

  await setDoc(
    doc(db, "companies", companyId, "equipment", installedEquipmentId),
    installedEquipment,
    { merge: true }
  );

  if (shoppingItem?.id) {
    await updateDoc(doc(db, "companies", companyId, "shoppingList", shoppingItem.id), {
      status: "Installed",
      linkedTaskStatus: FINISHED_STATUS,
      installedEquipmentId,
      installedAt: completedAt,
    });
  }

  if (purchasedItem?.id) {
    await updateDoc(doc(db, "companies", companyId, "purchasedItems", purchasedItem.id), {
      installedEquipmentId,
      installedAt: completedAt,
      installationJobId: jobId || "",
      installationTaskId: sourceTaskId,
      assignmentStatus: "installed",
      jobMaterialStatus: "Installed",
    });
  }

  return {
    id: installedEquipmentId,
    status: "Created",
    dataBaseItemId: dataBaseItem?.id || resolvedDataBaseItemId || "",
    shoppingListItemId: shoppingItem?.id || task?.shoppingListItemId || "",
    purchasedItemId: purchasedItem?.id || task?.purchasedItemId || "",
  };
};

const performedByForWorkerType = (workerType) => {
  const normalized = String(workerType || "").toLowerCase();
  if (normalized.includes("contractor")) return "Contractor";
  if (normalized.includes("employee")) return "Company";
  if (normalized.includes("customer")) return "Customer";
  return "";
};

const sourceTaskIdFor = (task = {}) =>
  task.jobTaskId ||
  task.workOrderTaskId ||
  task.sourceTaskId ||
  task.id ||
  fallbackId();

const linkedJobTaskIdFor = (task = {}) =>
  task.jobTaskId || task.workOrderTaskId || task.sourceTaskId || "";

const serviceStopIdFor = ({ task = {}, serviceStop = null }) => {
  if (serviceStop?.id) return serviceStop.id;
  if (typeof task.serviceStopId === "string") return task.serviceStopId;
  return task.serviceStopId?.id || "";
};

const jobIdFor = ({ task = {}, serviceStop = null, jobId = "" }) => {
  if (jobId) return jobId;
  if (typeof task.jobId === "string") return task.jobId;
  return task.jobId?.id || serviceStop?.jobId || task.workOrderId || "";
};

const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
  if (!lastServiceDate) return null;

  const amount = Number(serviceFrequency);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const base = toDate(lastServiceDate);
  if (Number.isNaN(base.getTime())) return null;

  const next = new Date(base);
  const unit = String(serviceFrequencyEvery || "").toLowerCase();

  if (unit.startsWith("day")) {
    next.setDate(next.getDate() + amount);
    return next;
  }
  if (unit.startsWith("week")) {
    next.setDate(next.getDate() + amount * 7);
    return next;
  }
  if (unit.startsWith("month")) {
    next.setMonth(next.getMonth() + amount);
    return next;
  }
  if (unit.startsWith("year")) {
    next.setFullYear(next.getFullYear() + amount);
    return next;
  }

  return null;
};

export const recordEquipmentTaskHistory = async ({
  db,
  companyId,
  task,
  serviceStop = null,
  jobId = "",
  completedAt = new Date(),
}) => {
  const type = taskTypeToEquipmentHistoryType(task?.type);
  const equipmentId = task?.equipmentId || "";

  if (!db || !companyId || !type || !equipmentId) return null;

  const equipmentRef = doc(db, "companies", companyId, "equipment", equipmentId);
  const equipmentSnap = await getDoc(equipmentRef);
  if (!equipmentSnap.exists()) return null;

  const equipment = equipmentSnap.data() || {};

  const taskType = normalizeTaskType(task?.type);
  const sourceTaskId = sourceTaskIdFor(task);
  const serviceStopId = serviceStopIdFor({ task, serviceStop });
  const resolvedJobId = jobIdFor({ task, serviceStop, jobId });
  const techId = task?.workerId || serviceStop?.techId || "";
  const techName = task?.workerName || serviceStop?.tech || "";
  const createdReplacement = await createInstalledEquipmentFromTask({
    db,
    companyId,
    oldEquipment: { id: equipmentId, ...equipment },
    task,
    jobId: resolvedJobId,
    completedAt,
  });
  const replacementEquipmentId = replacementEquipmentIdFor(task) || createdReplacement?.id || "";

  const history = {
    id: `auto_equ_sh_${cleanId(sourceTaskId)}`,
    name: task?.name || taskType || `${equipment.name || equipment.type || "Equipment"} service`,
    type,
    date: completedAt,
    description: serviceStop
      ? `Auto-created from finished ${taskType} service stop task.`
      : `Auto-created from finished ${taskType} task.`,
    performedBy: performedByForWorkerType(task?.workerType),
    addedBy: "Auto",
    techId,
    techName,
    jobId: resolvedJobId,
    partIds: Array.isArray(task?.partIds) ? task.partIds : [],
    sourceTaskId,
    taskId: sourceTaskId,
    serviceStopId,
    serviceStopTaskId: serviceStop ? task?.id || "" : "",
    jobTaskId: serviceStop ? linkedJobTaskIdFor(task) : task?.id || sourceTaskId,
    sourceTaskType: taskType,
    equipmentId,
    replacementEquipmentId,
    installedDataBaseItemId: createdReplacement?.dataBaseItemId || installDataBaseItemIdFor(task),
    installedShoppingListItemId: createdReplacement?.shoppingListItemId || task?.shoppingListItemId || "",
    installedPurchasedItemId: createdReplacement?.purchasedItemId || task?.purchasedItemId || "",
    replacementStatus:
      isReplacementTaskType(taskType)
        ? replacementEquipmentId
          ? createdReplacement?.status || "Linked"
          : "Needs Equipment Selection"
        : "",
  };

  await setDoc(doc(equipmentRef, "serviceHistory", history.id), history, { merge: true });

  if (type === EQUIPMENT_HISTORY_TYPES.MAINTENANCE) {
    const nextServiceDate = computeNextServiceDate(
      completedAt,
      equipment.serviceFrequency,
      equipment.serviceFrequencyEvery
    );
    const statusOnCompletion = equipmentStatusOnCompletionFor(task);
    const maintenanceUpdates = {
      lastServiceDate: completedAt,
      nextServiceDate,
      needsService: false,
    };

    if (statusOnCompletion) {
      maintenanceUpdates.status = statusOnCompletion;
    }

    await updateDoc(equipmentRef, maintenanceUpdates);
  } else if (!isReplacementTaskType(taskType)) {
    const statusOnCompletion = equipmentStatusOnCompletionFor(task);

    if (statusOnCompletion) {
      await updateDoc(equipmentRef, {
        status: statusOnCompletion,
      });
    }
  }

  if (isReplacementTaskType(taskType) && replacementEquipmentId) {
    await updateReplacementEquipmentLinks({
      db,
      companyId,
      oldEquipmentRef: equipmentRef,
      oldEquipment: { id: equipmentId, ...equipment },
      replacementEquipmentId,
      task,
      jobId: resolvedJobId,
      completedAt,
    });
  }

  return history;
};

const updateReplacementEquipmentLinks = async ({
  db,
  companyId,
  oldEquipmentRef,
  oldEquipment,
  replacementEquipmentId,
  task,
  jobId,
  completedAt,
}) => {
  const replacementRef = doc(db, "companies", companyId, "equipment", replacementEquipmentId);
  const replacementSnap = await getDoc(replacementRef);

  await updateDoc(oldEquipmentRef, {
    isActive: false,
    active: false,
    status: "Replaced",
    dateUninstalled: completedAt,
    replacedByEquipmentId: replacementEquipmentId,
    replacementJobId: jobId || "",
    replacementTaskId: sourceTaskIdFor(task),
  });

  if (!replacementSnap.exists()) return;

  const sourceTaskId = sourceTaskIdFor(task);
  const serviceStopId = serviceStopIdFor({ task });
  const replacementData = replacementSnap.data() || {};

  await updateDoc(replacementRef, {
    isActive: true,
    active: true,
    status: replacementData.status || EQUIPMENT_STATUS.OPERATIONAL,
    dateInstalled: replacementData.dateInstalled || completedAt,
    customerId: replacementData.customerId || oldEquipment.customerId || task?.customerId || "",
    customerName: replacementData.customerName || oldEquipment.customerName || task?.customerName || "",
    serviceLocationId:
      replacementData.serviceLocationId || oldEquipment.serviceLocationId || task?.serviceLocationId || "",
    bodyOfWaterId: replacementData.bodyOfWaterId || oldEquipment.bodyOfWaterId || task?.bodyOfWaterId || "",
    replacesEquipmentId: oldEquipment.id || "",
    installedFromJobId: jobId || "",
    installedFromTaskId: sourceTaskId,
  });

  const installHistory = {
    id: `auto_equ_install_${cleanId(sourceTaskId)}`,
    name: `Installed ${replacementData.name || task?.installedEquipmentName || "equipment"}`,
    type: EQUIPMENT_HISTORY_TYPES.INSTALL,
    date: completedAt,
    description: `Auto-created from finished ${normalizeTaskType(task?.type) || "replacement"} task.`,
    performedBy: performedByForWorkerType(task?.workerType),
    addedBy: "Auto",
    techId: task?.workerId || "",
    techName: task?.workerName || "",
    jobId: jobId || "",
    sourceTaskId,
    taskId: sourceTaskId,
    serviceStopId,
    replacedEquipmentId: oldEquipment.id || "",
    installedPurchasedItemId: task?.installedPurchasedItemId || task?.purchasedItemId || "",
    installedShoppingListItemId: task?.shoppingListItemId || "",
  };

  await setDoc(
    doc(replacementRef, "serviceHistory", installHistory.id),
    installHistory,
    { merge: true }
  );
};

export const syncCompletedServiceStopTaskToJobTask = async ({
  db,
  companyId,
  serviceStop,
  task,
  jobId = "",
}) => {
  const resolvedJobId = jobIdFor({ task, serviceStop, jobId });
  const sourceTaskId = linkedJobTaskIdFor(task);

  if (!db || !companyId || !resolvedJobId || !sourceTaskId) return null;

  const jobTaskRef = doc(
    db,
    "companies",
    companyId,
    "workOrders",
    resolvedJobId,
    "tasks",
    sourceTaskId
  );
  const jobTaskSnap = await getDoc(jobTaskRef);
  if (!jobTaskSnap.exists()) return null;

  const updates = {
    status: FINISHED_STATUS,
    workerId: task?.workerId || serviceStop?.techId || "",
    workerName: task?.workerName || serviceStop?.tech || "",
    serviceStopId: {
      id: serviceStop?.id || serviceStopIdFor({ task, serviceStop }),
      internalId: serviceStop?.internalId || "",
    },
  };

  const replacementEquipmentId = replacementEquipmentIdFor(task);
  if (replacementEquipmentId) {
    updates.replacementEquipmentId = replacementEquipmentId;
    updates.installedEquipmentId = replacementEquipmentId;
  }

  [
    "installedEquipmentName",
    "installedEquipmentType",
    "installedEquipmentMake",
    "installedEquipmentModel",
    "installedEquipmentNotes",
    "dataBaseItemId",
    "purchasedItemId",
    "installedPurchasedItemId",
  ].forEach((field) => {
    if (task?.[field]) updates[field] = task[field];
  });

  await updateDoc(jobTaskRef, updates);

  return {
    jobId: resolvedJobId,
    taskId: sourceTaskId,
    updates,
  };
};

export const syncShoppingItemForCompletedTask = async ({
  db,
  companyId,
  task,
  jobId = "",
  completedAt = new Date(),
}) => {
  const shoppingListItemId = task?.shoppingListItemId || "";
  if (!db || !companyId || !shoppingListItemId) return null;

  const shoppingItemRef = doc(db, "companies", companyId, "shoppingList", shoppingListItemId);
  const shoppingItemSnap = await getDoc(shoppingItemRef);
  if (!shoppingItemSnap.exists()) return null;

  const updates = {
    linkedTaskStatus: FINISHED_STATUS,
    lastTaskCompletedAt: completedAt,
    sourceTaskId: sourceTaskIdFor(task),
    jobId: jobIdFor({ task, jobId }) || task?.jobId?.id || "",
  };

  await updateDoc(shoppingItemRef, updates);
  return { shoppingListItemId, updates };
};

export const updateJobOperationStatusFromTasks = async ({
  db,
  companyId,
  jobId,
  currentOperationStatus = "",
}) => {
  if (!db || !companyId || !jobId) return null;

  const tasksSnap = await getDocs(collection(db, "companies", companyId, "workOrders", jobId, "tasks"));
  const tasks = tasksSnap.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }));
  if (tasks.length === 0) return null;

  const finishedCount = tasks.filter((task) => task.status === FINISHED_STATUS).length;
  const nextStatus =
    finishedCount === tasks.length
      ? "Finished"
      : finishedCount > 0 && currentOperationStatus !== "Finished"
        ? "In Progress"
        : "";

  if (!nextStatus || nextStatus === currentOperationStatus) {
    return { jobId, status: currentOperationStatus, finishedCount, taskCount: tasks.length };
  }

  await updateDoc(doc(db, "companies", companyId, "workOrders", jobId), {
    operationStatus: nextStatus,
  });

  return { jobId, status: nextStatus, finishedCount, taskCount: tasks.length };
};

export const runWorkCompletionEffects = async ({
  db,
  companyId,
  task,
  serviceStop = null,
  jobId = "",
  completedAt = new Date(),
  currentJobOperationStatus = "",
  syncJobStatus = false,
}) => {
  if (!db || !companyId || !task) return {};

  const resolvedJobId = jobIdFor({ task, serviceStop, jobId });
  let finishedTask = { ...task, status: FINISHED_STATUS };
  const effects = {};

  effects.waterHistory = await recordBodyOfWaterTaskHistory({
    db,
    companyId,
    task: finishedTask,
    serviceStop,
    jobId: resolvedJobId,
    completedAt,
  });

  effects.equipmentHistory = await recordEquipmentTaskHistory({
    db,
    companyId,
    task: finishedTask,
    serviceStop,
    jobId: resolvedJobId,
    completedAt,
  });

  if (effects.equipmentHistory?.replacementEquipmentId) {
    finishedTask = {
      ...finishedTask,
      replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId,
      installedEquipmentId: effects.equipmentHistory.replacementEquipmentId,
    };
  }

  if (serviceStop) {
    effects.jobTaskSync = await syncCompletedServiceStopTaskToJobTask({
      db,
      companyId,
      serviceStop,
      task: finishedTask,
      jobId: resolvedJobId,
    });
  }

  effects.shoppingItemSync = await syncShoppingItemForCompletedTask({
    db,
    companyId,
    task: finishedTask,
    jobId: resolvedJobId,
    completedAt,
  });

  if (syncJobStatus && resolvedJobId) {
    effects.jobStatus = await updateJobOperationStatusFromTasks({
      db,
      companyId,
      jobId: resolvedJobId,
      currentOperationStatus: currentJobOperationStatus,
    });
  }

  return effects;
};
