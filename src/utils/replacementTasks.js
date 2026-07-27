import { appPrompt } from "./appDialog";

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

export const promptForReplacementInstallDetails = async (task = {}) => {
  if (!isReplacementTask(task) || hasReplacementInstallSource(task)) return {};

  const oldEquipmentLabel = task.equipmentName || task.name || "this equipment";
  const installedEquipmentName = await appPrompt({
    title: "Replacement Equipment",
    message: `What equipment is being installed to replace ${oldEquipmentLabel}?`,
    inputLabel: "Installed equipment",
    confirmLabel: "Continue",
  });

  if (!installedEquipmentName || !installedEquipmentName.trim()) return null;

  const installedEquipmentType = await appPrompt({
    title: "Replacement Equipment",
    inputLabel: "Equipment type",
    defaultValue: task.installedEquipmentType || task.equipmentType || "Pump",
    required: false,
    confirmLabel: "Continue",
  }) || "";
  const installedEquipmentMake = await appPrompt({
    title: "Replacement Equipment",
    inputLabel: "Make",
    defaultValue: task.installedEquipmentMake || task.equipmentMake || "",
    required: false,
    confirmLabel: "Continue",
  }) || "";
  const installedEquipmentModel = await appPrompt({
    title: "Replacement Equipment",
    inputLabel: "Model",
    defaultValue: task.installedEquipmentModel || task.equipmentModel || "",
    required: false,
    confirmLabel: "Continue",
  }) || "";
  const installedEquipmentNotes = await appPrompt({
    title: "Replacement Equipment",
    inputLabel: "Install notes",
    defaultValue: task.installedEquipmentNotes || "",
    required: false,
    confirmLabel: "Done",
  }) || "";

  return {
    installedEquipmentName: installedEquipmentName.trim(),
    installedEquipmentType: installedEquipmentType.trim(),
    installedEquipmentMake: installedEquipmentMake.trim(),
    installedEquipmentModel: installedEquipmentModel.trim(),
    installedEquipmentNotes: installedEquipmentNotes.trim(),
  };
};
