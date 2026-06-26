export const JOB_TASK_TYPE_NAMES = [
  "Basic",
  "Clean",
  "Clean Filter",
  "Maintenance",
  "Repair",
  "Empty Water",
  "Fill Water",
  "Inspection",
  "Install",
  "Remove",
  "Replace",
];

const taskTypeKey = (value = "") => (
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
);

export const taskTypeOption = (name, source = {}) => ({
  ...source,
  id: source.id || taskTypeKey(name),
  name,
  value: source.value || name,
  label: source.label || name,
});

export const mergeJobTaskTypeOptions = (options = []) => {
  const optionsByKey = new Map();

  options.forEach((option) => {
    const name = option?.name || option?.value || option?.label;
    const key = taskTypeKey(name);
    if (!key || optionsByKey.has(key)) return;

    optionsByKey.set(key, taskTypeOption(name, option));
  });

  JOB_TASK_TYPE_NAMES.forEach((name) => {
    const key = taskTypeKey(name);
    if (!optionsByKey.has(key)) {
      optionsByKey.set(key, taskTypeOption(name));
    }
  });

  return Array.from(optionsByKey.values());
};

export const jobTaskTypeOptionsFromDocs = (docs = []) => (
  mergeJobTaskTypeOptions(
    docs.map((docSnap) => {
      const data = docSnap.data();
      const name = data.name || data.value || data.label || "Task";

      return taskTypeOption(name, {
        ...data,
        id: data.id || docSnap.id,
      });
    })
  )
);

export const EQUIPMENT_JOB_TASK_TYPES = new Set([
  "Clean Filter",
  "Maintenance",
  "Repair",
  "Remove",
  "Replace",
]);

export const BODY_OF_WATER_JOB_TASK_TYPES = new Set([
  "Empty Water",
  "Fill Water",
  "Install",
  "Replace",
]);

export const INSTALL_ITEM_JOB_TASK_TYPES = new Set(["Install", "Replace"]);
