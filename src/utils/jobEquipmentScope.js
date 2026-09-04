import {
  taskTypeRequiresBodyOfWater,
  taskTypeRequiresEquipment,
} from "./jobTaskTypes";

const compactString = (value) => String(value || "").trim();

export const uniqueStringList = (values = []) => (
  Array.from(new Set(values.map(compactString).filter(Boolean)))
);

export const getRecordEquipmentIds = (record = {}) => uniqueStringList([
  record.equipmentId,
  record.companyEquipmentId,
  ...(Array.isArray(record.equipmentIds) ? record.equipmentIds : []),
  ...(Array.isArray(record.companyEquipmentIds) ? record.companyEquipmentIds : []),
]);

export const getRecordBodyOfWaterIds = (record = {}) => uniqueStringList([
  record.bodyOfWaterId,
  ...(Array.isArray(record.bodyOfWaterIds) ? record.bodyOfWaterIds : []),
]);

export const jobScopeItemContextValues = (item = {}) => [
  item.type,
  item.taskType,
  item.taskTypeName,
  item.jobType,
  item.name,
  item.title,
  item.catalogItemName,
  item.serviceStopTypeName,
].filter(Boolean);

export const jobScopeItemRequiresEquipment = (item = {}) => (
  Boolean(item.requiresEquipment || item.equipmentRequired || item.requiresEquipmentAssignment) ||
  jobScopeItemContextValues(item).some((value) => taskTypeRequiresEquipment(value))
);

export const jobScopeItemRequiresBodyOfWater = (item = {}) => (
  Boolean(item.requiresBodyOfWater || item.bodyOfWaterRequired || item.requiresBodyOfWaterAssignment) ||
  jobScopeItemContextValues(item).some((value) => taskTypeRequiresBodyOfWater(value))
);

export const equipmentLabelFromRecord = (equipment = {}) => (
  equipment.label ||
  equipment.name ||
  [equipment.type, equipment.make, equipment.model].filter(Boolean).join(" ") ||
  equipment.model ||
  "Equipment"
);

export const bodyOfWaterLabelFromRecord = (body = {}) => (
  body.label ||
  body.name ||
  body.nickName ||
  body.type ||
  "Body Of Water"
);

export const recordOptionById = (records = [], id = "") => (
  records.find((record) => String(record.id || record.value || "") === String(id || "")) || null
);

export const equipmentAssignmentPatch = (equipment = {}, bodyOfWater = null) => {
  const equipmentId = equipment?.id || equipment?.value || "";
  const bodyOfWaterId = equipment?.bodyOfWaterId || bodyOfWater?.id || bodyOfWater?.value || "";

  return {
    equipmentId,
    equipmentName: equipmentId ? equipmentLabelFromRecord(equipment) : "",
    bodyOfWaterId,
    bodyOfWaterName: bodyOfWaterId
      ? equipment?.bodyOfWaterName || bodyOfWaterLabelFromRecord(bodyOfWater || {})
      : "",
  };
};

export const getJobScopeEquipmentIds = ({
  primaryEquipmentId = "",
  tasks = [],
  plannedServiceStops = [],
  laborLineItems = [],
  shoppingItems = [],
} = {}) => uniqueStringList([
  primaryEquipmentId,
  ...tasks.flatMap(getRecordEquipmentIds),
  ...plannedServiceStops.flatMap(getRecordEquipmentIds),
  ...laborLineItems.flatMap(getRecordEquipmentIds),
  ...shoppingItems.flatMap(getRecordEquipmentIds),
]);

export const getJobScopeBodyOfWaterIds = ({
  primaryBodyOfWaterId = "",
  tasks = [],
  plannedServiceStops = [],
  laborLineItems = [],
  shoppingItems = [],
} = {}) => uniqueStringList([
  primaryBodyOfWaterId,
  ...tasks.flatMap(getRecordBodyOfWaterIds),
  ...plannedServiceStops.flatMap(getRecordBodyOfWaterIds),
  ...laborLineItems.flatMap(getRecordBodyOfWaterIds),
  ...shoppingItems.flatMap(getRecordBodyOfWaterIds),
]);

export const equipmentSummaryForIds = ({
  equipmentIds = [],
  equipmentById = new Map(),
  primaryEquipmentId = "",
  primaryEquipmentName = "",
} = {}) => {
  const ids = uniqueStringList([primaryEquipmentId, ...equipmentIds]);
  const firstId = primaryEquipmentId || ids[0] || "";
  const names = ids
    .map((id) => {
      const equipment = equipmentById.get(id);
      return equipment ? equipmentLabelFromRecord(equipment) : "";
    })
    .filter(Boolean);

  return {
    equipmentId: firstId,
    equipmentIds: ids,
    companyEquipmentIds: ids,
    equipmentName: primaryEquipmentName || names[0] || "",
    equipmentNames: uniqueStringList(names),
  };
};

export const getMissingEquipmentAssignments = ({
  tasks = [],
  laborLineItems = [],
  plannedServiceStops = [],
  fallbackEquipmentId = "",
  validEquipmentIds = null,
  requireAllTasks = false,
  requireAllLaborLineItems = false,
  requireAllPlannedServiceStops = false,
} = {}) => {
  const missing = [];
  const validEquipmentIdSet = Array.isArray(validEquipmentIds)
    ? new Set(validEquipmentIds.map(compactString).filter(Boolean))
    : null;
  const isValidEquipmentId = (equipmentId) => (
    Boolean(compactString(equipmentId)) &&
    (!validEquipmentIdSet || validEquipmentIdSet.has(compactString(equipmentId)))
  );
  const hasEquipment = (item) => (
    getRecordEquipmentIds(item).some(isValidEquipmentId) ||
    isValidEquipmentId(fallbackEquipmentId)
  );

  tasks.forEach((task, index) => {
    if ((requireAllTasks || jobScopeItemRequiresEquipment(task)) && !hasEquipment(task)) {
      missing.push({ kind: "Task", name: task.name || task.description || `Task ${index + 1}` });
    }
  });

  laborLineItems.forEach((line, index) => {
    if ((requireAllLaborLineItems || jobScopeItemRequiresEquipment(line)) && !hasEquipment(line)) {
      missing.push({ kind: "Service Line", name: line.name || line.title || `Service ${index + 1}` });
    }
  });

  plannedServiceStops.forEach((stop, index) => {
    if ((requireAllPlannedServiceStops || jobScopeItemRequiresEquipment(stop)) && !hasEquipment(stop)) {
      missing.push({ kind: "Planned Stop", name: stop.name || stop.serviceStopTypeName || `Visit ${index + 1}` });
    }
  });

  return missing;
};
