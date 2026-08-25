const cleanText = (value) => {
  if (value && typeof value === "object") {
    return String(value.label || value.value || value.name || value.id || "").trim();
  }

  return String(value || "").trim();
};

const normalizedKey = (value) =>
  cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }

  return "";
};

export const EQUIPMENT_DATABASE_CATEGORY = "Equipment";

export const isEquipmentDatabaseCategory = (category) =>
  normalizedKey(category) === normalizedKey(EQUIPMENT_DATABASE_CATEGORY);

export const isEquipmentDatabaseItem = (item = {}) =>
  isEquipmentDatabaseCategory(item.category || item.itemCategory);

export const emptyDatabaseEquipmentMapping = () => ({
  type: "",
  category: "",
  typeId: "",
  make: "",
  makeId: "",
  model: "",
  modelId: "",
  universalEquipmentId: "",
  manualPdfLink: "",
});

export const databaseEquipmentMappingFromItem = (item = {}) => {
  const type = firstText(
    item.equipmentType,
    item.equipmentCategory,
    item.type,
    isEquipmentDatabaseItem(item) ? item.subCategory : ""
  );
  const make = firstText(item.equipmentMake, item.make, item.manufacturer, item.brand);
  const model = firstText(item.equipmentModel, item.model, item.modelName);
  const universalEquipmentId = firstText(
    item.universalEquipmentId,
    item.equipmentUniversalEquipmentId,
    item.equipmentModelId,
    item.modelId
  );

  return {
    type,
    category: type,
    typeId: firstText(item.equipmentTypeId, item.typeId),
    make,
    makeId: firstText(item.equipmentMakeId, item.makeId),
    model,
    modelId: universalEquipmentId,
    universalEquipmentId,
    manualPdfLink: firstText(item.manualPdfLink, item.equipmentManualPdfLink),
  };
};

export const hasDatabaseEquipmentMapping = (itemOrMapping = {}) => {
  const mapping = databaseEquipmentMappingFromItem(itemOrMapping);

  return Boolean(mapping.type && mapping.make && mapping.model);
};

export const databaseEquipmentMappingPatch = (mapping = {}) => {
  const type = firstText(mapping.type, mapping.category);
  const make = firstText(mapping.make);
  const model = firstText(mapping.model, mapping.name);
  const modelId = firstText(mapping.universalEquipmentId, mapping.modelId);

  return {
    equipmentType: type,
    equipmentTypeId: firstText(mapping.typeId),
    equipmentMake: make,
    equipmentMakeId: firstText(mapping.makeId),
    equipmentModel: model,
    equipmentModelId: modelId,
    type,
    typeId: firstText(mapping.typeId),
    make,
    makeId: firstText(mapping.makeId),
    model,
    modelId,
    universalEquipmentId: modelId,
    manualPdfLink: firstText(mapping.manualPdfLink),
  };
};

export const equipmentDatabaseItemLabel = (item = {}) => {
  const mapping = databaseEquipmentMappingFromItem(item);
  const details = [mapping.make, mapping.model].filter(Boolean).join(" ");

  return [item.name || item.label || "Equipment item", details].filter(Boolean).join(" - ");
};
