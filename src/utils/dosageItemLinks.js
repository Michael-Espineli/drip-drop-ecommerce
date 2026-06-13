import { doc } from "firebase/firestore";
import { db } from "./config";

export const normalizeLinkedItemIds = (...values) =>
  Array.from(new Set(
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    })
  ));

export const dosageLinkedItemIds = (dosage = {}) =>
  normalizeLinkedItemIds(dosage.linkedItemIds, dosage.linkedItemId, dosage.linkedItem);

export const dosageLabel = (dosage = {}) =>
  [
    dosage.name || dosage.chemType || "Unnamed dosage",
    Array.isArray(dosage.amount) ? dosage.amount.join(", ") : dosage.amount,
    dosage.UOM || dosage.uom,
  ].filter(Boolean).join(" | ");

export const sortDosageTemplates = (dosages = []) =>
  [...dosages].sort((first, second) => {
    const firstOrder = Number(first.order);
    const secondOrder = Number(second.order);
    const bothHaveOrder = Number.isFinite(firstOrder) && Number.isFinite(secondOrder);
    if (bothHaveOrder && firstOrder !== secondOrder) return firstOrder - secondOrder;
    return dosageLabel(first).localeCompare(dosageLabel(second));
  });

export const linkedDosageIdsForItem = (dosages = [], itemId) =>
  dosages
    .filter((dosage) => dosageLinkedItemIds(dosage).includes(itemId))
    .map((dosage) => dosage.id)
    .filter(Boolean);

export const queueDatabaseItemDosageLinkUpdates = (batch, { companyId, itemId, dosages = [], selectedDosageIds = [] }) => {
  const selectedIds = new Set(selectedDosageIds.filter(Boolean));
  let updateCount = 0;

  dosages.forEach((dosage) => {
    if (!dosage?.id) return;

    const currentIds = dosageLinkedItemIds(dosage);
    const currentlyLinked = currentIds.includes(itemId);
    const shouldBeLinked = selectedIds.has(dosage.id);
    if (currentlyLinked === shouldBeLinked) return;

    const nextIds = shouldBeLinked
      ? normalizeLinkedItemIds(currentIds, itemId)
      : currentIds.filter((currentId) => currentId !== itemId);

    batch.update(doc(db, "companies", companyId, "settings", "dosages", "dosages", dosage.id), {
      linkedItem: "",
      linkedItemId: nextIds[0] || "",
      linkedItemIds: nextIds,
    });
    updateCount += 1;
  });

  return updateCount;
};

export const applyDatabaseItemDosageLinksLocally = (dosages = [], itemId, selectedDosageIds = []) => {
  const selectedIds = new Set(selectedDosageIds.filter(Boolean));

  return dosages.map((dosage) => {
    const currentIds = dosageLinkedItemIds(dosage);
    const nextIds = selectedIds.has(dosage.id)
      ? normalizeLinkedItemIds(currentIds, itemId)
      : currentIds.filter((currentId) => currentId !== itemId);

    return {
      ...dosage,
      linkedItem: "",
      linkedItemId: nextIds[0] || "",
      linkedItemIds: nextIds,
    };
  });
};
