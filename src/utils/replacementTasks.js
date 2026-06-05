const replacementTypes = new Set(["replace", "replacement"]);

export const isReplacementTask = (task = {}) =>
  replacementTypes.has(String(task.type || "").trim().toLowerCase());

export const hasReplacementInstallSource = (task = {}) =>
  !!(
    task.replacementEquipmentId ||
    task.newEquipmentId ||
    task.installedEquipmentId ||
    task.purchasedItemId ||
    task.installedPurchasedItemId ||
    task.dataBaseItemId ||
    task.dbItemId ||
    task.itemId ||
    task.shoppingListItemId ||
    task.installedEquipmentName
  );

export const promptForReplacementInstallDetails = (task = {}) => {
  if (!isReplacementTask(task) || hasReplacementInstallSource(task)) return {};

  const oldEquipmentLabel = task.equipmentName || task.name || "this equipment";
  const installedEquipmentName = window.prompt(
    `What equipment is being installed to replace ${oldEquipmentLabel}?`
  );

  if (!installedEquipmentName || !installedEquipmentName.trim()) return null;

  const installedEquipmentType =
    window.prompt("Equipment type", task.installedEquipmentType || task.equipmentType || "Pump") || "";
  const installedEquipmentMake =
    window.prompt("Make", task.installedEquipmentMake || task.equipmentMake || "") || "";
  const installedEquipmentModel =
    window.prompt("Model", task.installedEquipmentModel || task.equipmentModel || "") || "";
  const installedEquipmentNotes =
    window.prompt("Install notes", task.installedEquipmentNotes || "") || "";

  return {
    installedEquipmentName: installedEquipmentName.trim(),
    installedEquipmentType: installedEquipmentType.trim(),
    installedEquipmentMake: installedEquipmentMake.trim(),
    installedEquipmentModel: installedEquipmentModel.trim(),
    installedEquipmentNotes: installedEquipmentNotes.trim(),
  };
};
