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
import {
  EQUIPMENT_STATUS,
  equipmentDefaultsToNeedsService,
} from "./models/Equipment";
import {
  databaseEquipmentMappingFromItem,
  hasDatabaseEquipmentMapping,
} from "./databaseEquipmentItems";

const EQUIPMENT_HISTORY_TYPES = {
  INSTALL: "Install",
  MAINTENANCE: "Maintenance",
  REMOVE: "Remove",
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
const normalizeEquipmentStatusValue = (status = "") =>
  String(status || "").trim().toLowerCase().replace(/[-_\s]/g, "");
const cleanText = (value) => String(value || "").trim();
const firstText = (...values) => values.map(cleanText).find(Boolean) || "";

const taskTypeToEquipmentHistoryType = (taskType) => {
  const normalizedTaskType = normalizeTaskType(taskType).toLowerCase();
  switch (normalizedTaskType) {
    case "install":
      return EQUIPMENT_HISTORY_TYPES.INSTALL;
    case "clean filter":
    case "filter clean":
    case "maintenance":
      return EQUIPMENT_HISTORY_TYPES.MAINTENANCE;
    case "repair":
      return EQUIPMENT_HISTORY_TYPES.REPAIR;
    case "remove":
    case "replace":
    case "replacement":
      return EQUIPMENT_HISTORY_TYPES.REMOVE;
    default:
      return null;
  }
};

const isReplacementTaskType = (taskType) =>
  ["replace", "replacement"].includes(normalizeTaskType(taskType).toLowerCase());

const isInstallTaskType = (taskType) =>
  normalizeTaskType(taskType).toLowerCase() === "install";

const isRemoveTaskType = (taskType) =>
  normalizeTaskType(taskType).toLowerCase() === "remove";

const isInstallOrReplacementTaskType = (taskType) =>
  isInstallTaskType(taskType) || isReplacementTaskType(taskType);

const replacementEquipmentIdFor = (task = {}) =>
  task.replacementEquipmentId || task.newEquipmentId || task.installedEquipmentId || "";

const replacedEquipmentUpdatesFor = ({
  completedAt,
  replacementEquipmentId = "",
  task = {},
  jobId = "",
}) => {
  const updates = {
    isActive: false,
    active: false,
    needsService: false,
    nextServiceDate: null,
    status: EQUIPMENT_STATUS.UNINSTALLED,
    dateUninstalled: completedAt,
    replacementTaskId: sourceTaskIdFor(task),
  };

  if (replacementEquipmentId) {
    updates.replacedByEquipmentId = replacementEquipmentId;
  }

  if (jobId) {
    updates.replacementJobId = jobId;
  }

  return updates;
};

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

const fetchUniversalEquipment = async ({ db, universalEquipmentId }) => {
  if (!db || !universalEquipmentId) return null;

  const universalEquipmentSnap = await getDoc(
    doc(db, "universal", "equipment", "equipment", universalEquipmentId)
  );
  if (!universalEquipmentSnap.exists()) return null;

  return { id: universalEquipmentSnap.id, ...universalEquipmentSnap.data() };
};

const fetchJobContext = async ({ db, companyId, jobId }) => {
  if (!db || !companyId || !jobId) return null;

  const jobSnap = await getDoc(doc(db, "companies", companyId, "workOrders", jobId));
  if (!jobSnap.exists()) return null;

  return { id: jobSnap.id, ...jobSnap.data() };
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

const copyUniversalPartsToEquipment = async ({
  db,
  companyId,
  equipmentId,
  universalEquipmentId,
  installedEquipment,
  completedAt,
}) => {
  if (!db || !companyId || !equipmentId || !universalEquipmentId) return 0;

  const partsSnap = await getDocs(
    collection(db, "universal", "equipment", "equipment", universalEquipmentId, "parts")
  );
  const writes = partsSnap.docs.map((partDoc) => {
    const part = partDoc.data() || {};
    const partId = `com_equ_par_${fallbackId()}`;

    return setDoc(
      doc(db, "companies", companyId, "equipment", equipmentId, "parts", partId),
      {
        id: partId,
        name: part.name || "",
        sku: part.sku || "",
        make: part.make || installedEquipment.make || "",
        model: part.model || installedEquipment.model || "",
        manualPdfLink: part.manualPdfLink || "",
        universalPartId: part.id || partDoc.id,
        universalEquipmentId,
        createdAt: completedAt,
      },
      { merge: true }
    );
  });

  await Promise.all(writes);
  return writes.length;
};

const installedEquipmentContextFor = ({
  oldEquipment = null,
  task = {},
  job = null,
  serviceStop = null,
}) => ({
  customerId: firstText(
    oldEquipment?.customerId,
    task?.customerId,
    job?.customerId,
    serviceStop?.customerId
  ),
  customerName: firstText(
    oldEquipment?.customerName,
    task?.customerName,
    job?.customerName,
    serviceStop?.customerName
  ),
  serviceLocationId: firstText(
    oldEquipment?.serviceLocationId,
    task?.serviceLocationId,
    job?.serviceLocationId,
    serviceStop?.serviceLocationId
  ),
  bodyOfWaterId: firstText(
    task?.bodyOfWaterId,
    oldEquipment?.bodyOfWaterId,
    job?.bodyOfWaterId,
    serviceStop?.bodyOfWaterId
  ),
});

const installedEquipmentMappingFor = ({
  task = {},
  dataBaseItem = null,
  universalEquipment = null,
  oldEquipment = null,
}) => {
  const databaseMapping = databaseEquipmentMappingFromItem(dataBaseItem || {});

  return {
    type: firstText(
      task?.installedEquipmentType,
      task?.replacementEquipmentType,
      databaseMapping.type,
      universalEquipment?.type,
      universalEquipment?.category,
      oldEquipment?.type
    ),
    category: firstText(
      task?.installedEquipmentType,
      task?.replacementEquipmentType,
      databaseMapping.type,
      universalEquipment?.type,
      universalEquipment?.category,
      oldEquipment?.type
    ),
    typeId: firstText(
      task?.installedEquipmentTypeId,
      databaseMapping.typeId,
      universalEquipment?.typeId,
      oldEquipment?.typeId
    ),
    make: firstText(
      task?.installedEquipmentMake,
      databaseMapping.make,
      universalEquipment?.make
    ),
    makeId: firstText(
      task?.installedEquipmentMakeId,
      databaseMapping.makeId,
      universalEquipment?.makeId
    ),
    model: firstText(
      task?.installedEquipmentModel,
      databaseMapping.model,
      universalEquipment?.model,
      universalEquipment?.name,
      dataBaseItem?.name
    ),
    modelId: firstText(
      task?.installedEquipmentModelId,
      task?.universalEquipmentId,
      databaseMapping.universalEquipmentId,
      universalEquipment?.id,
      universalEquipment?.modelId
    ),
    universalEquipmentId: firstText(
      task?.universalEquipmentId,
      databaseMapping.universalEquipmentId,
      universalEquipment?.id,
      universalEquipment?.modelId
    ),
    manualPdfLink: firstText(
      task?.manualPdfLink,
      databaseMapping.manualPdfLink,
      universalEquipment?.manualPdfLink
    ),
  };
};

const writeInstallHistoryForEquipment = async ({
  db,
  companyId,
  equipmentId,
  task,
  jobId,
  completedAt,
  serviceStop = null,
  replacedEquipmentId = "",
  installedDataBaseItemId = "",
  installedShoppingListItemId = "",
  installedPurchasedItemId = "",
}) => {
  const sourceTaskId = sourceTaskIdFor(task);
  const history = {
    id: `auto_equ_install_${cleanId(sourceTaskId)}`,
    name: task?.name || task?.installedEquipmentName || "Installed equipment",
    type: EQUIPMENT_HISTORY_TYPES.INSTALL,
    date: completedAt,
    description: `Auto-created from finished ${normalizeTaskType(task?.type) || "install"} task.`,
    performedBy: performedByForWorkerType(task?.workerType),
    addedBy: "Auto",
    techId: task?.workerId || serviceStop?.techId || "",
    techName: task?.workerName || serviceStop?.tech || "",
    jobId: jobId || "",
    sourceTaskId,
    taskId: sourceTaskId,
    serviceStopId: serviceStopIdFor({ task, serviceStop }),
    replacedEquipmentId,
    installedDataBaseItemId,
    installedShoppingListItemId,
    installedPurchasedItemId,
  };

  await setDoc(
    doc(db, "companies", companyId, "equipment", equipmentId, "serviceHistory", history.id),
    history,
    { merge: true }
  );

  return history;
};

const createInstalledEquipmentFromTask = async ({
  db,
  companyId,
  oldEquipment,
  task,
  jobId,
  serviceStop = null,
  completedAt,
}) => {
  if (!isInstallOrReplacementTaskType(task?.type)) return null;

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
  const databaseMapping = databaseEquipmentMappingFromItem(dataBaseItem || {});
  const universalEquipmentId = firstText(
    task?.universalEquipmentId,
    databaseMapping.universalEquipmentId,
    dataBaseItem?.universalEquipmentId,
    dataBaseItem?.modelId
  );
  const universalEquipment = await fetchUniversalEquipment({ db, universalEquipmentId });
  const job = await fetchJobContext({ db, companyId, jobId });

  const installedName =
    task?.installedEquipmentName ||
    task?.replacementEquipmentName ||
    dataBaseItem?.name ||
    purchasedItem?.name ||
    shoppingItem?.name ||
    "";

  if (!installedName) return null;
  if (dataBaseItem && !hasDatabaseEquipmentMapping(dataBaseItem) && !universalEquipment) return null;

  const sourceTaskId = sourceTaskIdFor(task);
  const installedEquipmentId = `com_equ_installed_${cleanId(sourceTaskId)}`;
  const mapping = installedEquipmentMappingFor({
    task,
    dataBaseItem,
    universalEquipment,
    oldEquipment,
  });
  const context = installedEquipmentContextFor({
    oldEquipment,
    task,
    job,
    serviceStop,
  });
  if (!context.bodyOfWaterId) return null;

  const defaultNeedsService = equipmentDefaultsToNeedsService({
    name: installedName,
    type: mapping.type,
    category: mapping.type,
    make: mapping.make,
    model: mapping.model,
  });
  const nextServiceDate = defaultNeedsService
    ? computeNextServiceDate(completedAt, 6, "Month")
    : null;

  const installedEquipment = {
    id: installedEquipmentId,
    name: installedName,
    type: mapping.type,
    category: mapping.type,
    typeId: mapping.typeId,
    make: mapping.make,
    makeId: mapping.makeId,
    model: mapping.model || installedName,
    modelId: mapping.modelId,
    universalEquipmentId: mapping.universalEquipmentId,
    manualPdfLink: mapping.manualPdfLink,
    dateInstalled: completedAt,
    status: EQUIPMENT_STATUS.OPERATIONAL,
    needsService: defaultNeedsService,
    lastServiceDate: defaultNeedsService ? completedAt : null,
    nextServiceDate,
    serviceFrequency: defaultNeedsService ? 6 : null,
    serviceFrequencyEvery: defaultNeedsService ? "Month" : "",
    isActive: true,
    active: true,
    customerId: context.customerId,
    customerName: context.customerName,
    serviceLocationId: context.serviceLocationId,
    bodyOfWaterId: context.bodyOfWaterId,
    notes: task?.installedEquipmentNotes || "",
    replacesEquipmentId: isReplacementTaskType(task?.type) ? oldEquipment?.id || task?.equipmentId || "" : "",
    installedFromJobId: jobId || "",
    installedFromTaskId: sourceTaskId,
    sourceDataBaseItemId: dataBaseItem?.id || resolvedDataBaseItemId || "",
    sourceShoppingListItemId: shoppingItem?.id || task?.shoppingListItemId || "",
    sourcePurchasedItemId: purchasedItem?.id || task?.purchasedItemId || "",
    source: isReplacementTaskType(task?.type) ? "replacementTask" : "installTask",
    createdAt: completedAt,
  };

  await setDoc(
    doc(db, "companies", companyId, "equipment", installedEquipmentId),
    installedEquipment,
    { merge: true }
  );
  await copyUniversalPartsToEquipment({
    db,
    companyId,
    equipmentId: installedEquipmentId,
    universalEquipmentId: installedEquipment.universalEquipmentId,
    installedEquipment,
    completedAt,
  });

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
    installedEquipmentId,
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

  if (!db || !companyId || !type) return null;

  const taskType = normalizeTaskType(task?.type);
  const resolvedJobId = jobIdFor({ task, serviceStop, jobId });

  if (isInstallTaskType(taskType) && !equipmentId) {
    const createdInstall = await createInstalledEquipmentFromTask({
      db,
      companyId,
      oldEquipment: null,
      task,
      jobId: resolvedJobId,
      serviceStop,
      completedAt,
    });

    if (!createdInstall?.id) return null;

    const installHistory = await writeInstallHistoryForEquipment({
      db,
      companyId,
      equipmentId: createdInstall.id,
      task,
      jobId: resolvedJobId,
      completedAt,
      serviceStop,
      installedDataBaseItemId: createdInstall.dataBaseItemId || installDataBaseItemIdFor(task),
      installedShoppingListItemId: createdInstall.shoppingListItemId || task?.shoppingListItemId || "",
      installedPurchasedItemId: createdInstall.purchasedItemId || task?.purchasedItemId || "",
    });

    return {
      ...installHistory,
      equipmentId: createdInstall.id,
      installedEquipmentId: createdInstall.id,
      installedDataBaseItemId: createdInstall.dataBaseItemId || installDataBaseItemIdFor(task),
      installedShoppingListItemId: createdInstall.shoppingListItemId || task?.shoppingListItemId || "",
      installedPurchasedItemId: createdInstall.purchasedItemId || task?.purchasedItemId || "",
      installStatus: createdInstall.status || "Created",
    };
  }

  if (!equipmentId) return null;

  const equipmentRef = doc(db, "companies", companyId, "equipment", equipmentId);
  const equipmentSnap = await getDoc(equipmentRef);
  if (!equipmentSnap.exists()) return null;

  const equipment = equipmentSnap.data() || {};

  const sourceTaskId = sourceTaskIdFor(task);
  const serviceStopId = serviceStopIdFor({ task, serviceStop });
  const techId = task?.workerId || serviceStop?.techId || "";
  const techName = task?.workerName || serviceStop?.tech || "";
  const createdReplacement = await createInstalledEquipmentFromTask({
    db,
    companyId,
    oldEquipment: { id: equipmentId, ...equipment },
    task,
    jobId: resolvedJobId,
    serviceStop,
    completedAt,
  });
  const replacementEquipmentId = replacementEquipmentIdFor(task) || createdReplacement?.id || "";
  const installedEquipmentId = createdReplacement?.installedEquipmentId || replacementEquipmentId || "";

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
    installedEquipmentId,
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
    const currentMaintenanceStatus = normalizeEquipmentStatusValue(equipment.status);
    const statusOnCompletion =
      equipmentStatusOnCompletionFor(task) ||
      (["needsmaintenance", "maintenance", "needsservice"].includes(currentMaintenanceStatus)
        ? EQUIPMENT_STATUS.OPERATIONAL
        : "");
    const maintenanceUpdates = {
      lastServiceDate: completedAt,
      nextServiceDate,
    };

    if (statusOnCompletion) {
      maintenanceUpdates.status = statusOnCompletion;
    }

    await updateDoc(equipmentRef, maintenanceUpdates);
  } else if (isReplacementTaskType(taskType) || isRemoveTaskType(taskType)) {
    await updateDoc(
      equipmentRef,
      replacedEquipmentUpdatesFor({
        completedAt,
        replacementEquipmentId: isReplacementTaskType(taskType) ? replacementEquipmentId : "",
        task,
        jobId: resolvedJobId,
      })
    );
  } else {
    const statusOnCompletion =
      equipmentStatusOnCompletionFor(task) ||
      (type === EQUIPMENT_HISTORY_TYPES.REPAIR ? EQUIPMENT_STATUS.OPERATIONAL : "");

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
  oldEquipment,
  replacementEquipmentId,
  task,
  jobId,
  completedAt,
}) => {
  const replacementRef = doc(db, "companies", companyId, "equipment", replacementEquipmentId);
  const replacementSnap = await getDoc(replacementRef);

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
  } else if (task?.installedEquipmentId) {
    updates.installedEquipmentId = task.installedEquipmentId;
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
    "installedEquipmentId",
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

  const completedInstalledEquipmentId =
    effects.equipmentHistory?.installedEquipmentId ||
    effects.equipmentHistory?.replacementEquipmentId ||
    "";

  if (completedInstalledEquipmentId) {
    finishedTask = {
      ...finishedTask,
      ...(effects.equipmentHistory?.replacementEquipmentId
        ? { replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId }
        : {}),
      installedEquipmentId: completedInstalledEquipmentId,
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
