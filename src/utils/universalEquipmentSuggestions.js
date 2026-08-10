import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

export const CATALOG_READY_STATUS = 'Catalog Ready';
export const RECONCILED_STATUS = 'Reconciled';

const cleanText = (value) => String(value || '').trim();

export const catalogEquipmentIdFor = (equipment = {}) => (
  cleanText(equipment.universalEquipmentId || equipment.modelId)
);

export const getCustomEquipmentSuggestionFlags = (equipment = {}) => {
  const type = cleanText(equipment.type || equipment.category);
  const make = cleanText(equipment.make);
  const model = cleanText(equipment.model);

  return {
    isCustomType: Boolean(type && !cleanText(equipment.typeId)),
    isCustomMake: Boolean(make && !cleanText(equipment.makeId)),
    isCustomModel: Boolean(model && !catalogEquipmentIdFor(equipment)),
  };
};

export const hasCustomEquipmentCatalogValue = (equipment = {}, flags = getCustomEquipmentSuggestionFlags(equipment)) => (
  Boolean(flags.isCustomType || flags.isCustomMake || flags.isCustomModel)
);

export const universalEquipmentSuggestionIdForEquipment = (equipmentId) => `unv_equ_sug_${equipmentId}`;

export const queueUniversalEquipmentSuggestion = async ({
  db,
  companyId,
  companyName = '',
  user = null,
  equipment = {},
  source = 'companyEquipment',
  flags = getCustomEquipmentSuggestionFlags(equipment),
}) => {
  const equipmentId = cleanText(equipment.id);
  if (!db || !companyId || !equipmentId || !hasCustomEquipmentCatalogValue(equipment, flags)) {
    return false;
  }

  const suggestionId = universalEquipmentSuggestionIdForEquipment(equipmentId);
  const suggestionRef = doc(db, 'universalEquipmentSuggestions', suggestionId);
  const existingSuggestion = await getDoc(suggestionRef);
  const existingStatus = existingSuggestion.exists() ? cleanText(existingSuggestion.data().status) : '';

  await setDoc(suggestionRef, {
    id: suggestionId,
    status: existingStatus && existingStatus !== RECONCILED_STATUS ? existingStatus : 'New',
    source,
    companyId,
    companyName,
    createdByUserId: cleanText(user?.uid),
    createdByUserEmail: cleanText(user?.email),
    ...(existingSuggestion.exists() ? {} : {
      createdAt: serverTimestamp(),
      createdAtMillis: Date.now(),
    }),
    updatedAt: serverTimestamp(),
    equipmentId,
    equipmentName: cleanText(equipment.name),
    customerId: cleanText(equipment.customerId),
    customerName: cleanText(equipment.customerName),
    serviceLocationId: cleanText(equipment.serviceLocationId),
    bodyOfWaterId: cleanText(equipment.bodyOfWaterId),
    type: cleanText(equipment.type || equipment.category),
    typeId: cleanText(equipment.typeId),
    make: cleanText(equipment.make),
    makeId: cleanText(equipment.makeId),
    model: cleanText(equipment.model),
    modelId: catalogEquipmentIdFor(equipment),
    customCategoryRequested: Boolean(flags.isCustomType),
    customMakeRequested: Boolean(flags.isCustomMake),
    customModelRequested: Boolean(flags.isCustomModel),
    notes: cleanText(equipment.notes),
  }, { merge: true });

  return true;
};

export const markUniversalEquipmentSuggestionReconciled = async ({
  db,
  user = null,
  equipment = {},
  match = equipment,
}) => {
  const equipmentId = cleanText(equipment.id);
  const universalEquipmentId = catalogEquipmentIdFor(match);
  if (!db || !equipmentId || !universalEquipmentId) return false;

  const suggestionRef = doc(db, 'universalEquipmentSuggestions', universalEquipmentSuggestionIdForEquipment(equipmentId));
  const suggestionSnap = await getDoc(suggestionRef);
  if (!suggestionSnap.exists()) return false;

  await updateDoc(suggestionRef, {
    status: RECONCILED_STATUS,
    reconciledAt: serverTimestamp(),
    reconciledByUserId: cleanText(user?.uid),
    reconciledByEmail: cleanText(user?.email),
    reconciledEquipmentId: equipmentId,
    reconciledUniversalEquipmentId: universalEquipmentId,
    reconciledType: cleanText(match.type || match.category),
    reconciledTypeId: cleanText(match.typeId),
    reconciledMake: cleanText(match.make),
    reconciledMakeId: cleanText(match.makeId),
    reconciledModel: cleanText(match.model),
    reconciledModelId: universalEquipmentId,
    reconciledManualPdfLink: cleanText(match.manualPdfLink),
    updatedAt: serverTimestamp(),
  });

  return true;
};

export const syncUniversalEquipmentSuggestionForEquipment = async ({
  db,
  companyId,
  companyName = '',
  user = null,
  equipment = {},
  source = 'companyEquipment',
}) => {
  const flags = getCustomEquipmentSuggestionFlags(equipment);
  if (hasCustomEquipmentCatalogValue(equipment, flags)) {
    return queueUniversalEquipmentSuggestion({
      db,
      companyId,
      companyName,
      user,
      equipment,
      source,
      flags,
    });
  }

  if (catalogEquipmentIdFor(equipment)) {
    return markUniversalEquipmentSuggestionReconciled({
      db,
      user,
      equipment,
      match: equipment,
    });
  }

  return false;
};
