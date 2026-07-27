export const TODO_LIST_FEATURE_FLAG_ID = "feature_flag_010";

export const TODO_STATUS = {
  open: "open",
  inProgress: "inProgress",
  done: "done",
  archived: "archived",
};

export const TODO_DONE_BOARD_LOOKBACK_DAYS = 14;

export const TODO_STATUS_LABELS = {
  [TODO_STATUS.open]: "Open",
  [TODO_STATUS.inProgress]: "In Progress",
  [TODO_STATUS.done]: "Done",
  [TODO_STATUS.archived]: "Archived",
};

export const TODO_SCOPE = {
  me: "me",
  team: "team",
  specific: "specific",
};

export const TODO_PRIORITY = {
  low: "low",
  normal: "normal",
  high: "high",
  urgent: "urgent",
};

export const TODO_PRIORITY_LABELS = {
  [TODO_PRIORITY.low]: "Low",
  [TODO_PRIORITY.normal]: "Normal",
  [TODO_PRIORITY.high]: "High",
  [TODO_PRIORITY.urgent]: "Urgent",
};

export const TODO_RELATED_ENTITY_TYPES = [
  { value: "", label: "No linked record" },
  { value: "customer", label: "Customer" },
  { value: "serviceLocation", label: "Service Location" },
  { value: "bodyOfWater", label: "Body of Water" },
  { value: "equipment", label: "Equipment" },
  { value: "job", label: "Job" },
  { value: "repairRequest", label: "Repair Request" },
  { value: "invoice", label: "Invoice" },
  { value: "other", label: "Other" },
];

export const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const toMillis = (value) => {
  const date = toDate(value);
  return date ? date.getTime() : 0;
};

export const formatShortDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "No date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export const dateTimeInputValue = (value) => {
  const date = toDate(value);
  if (!date) return "";

  const pad = (part) => String(part).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const dateInputValue = (value) => {
  const date = toDate(value);
  if (!date) return "";

  const pad = (part) => String(part).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
};

export const startOfDay = (value) => {
  const date = toDate(value);
  if (!date) return null;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
};

export const endOfDay = (value) => {
  const date = toDate(value);
  if (!date) return null;

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
};

export const defaultTodoHistoryDateRange = (now = new Date(), dayCount = TODO_DONE_BOARD_LOOKBACK_DAYS) => {
  const endDate = endOfDay(now);
  const startDate = startOfDay(now);
  startDate.setDate(startDate.getDate() - Math.max(dayCount - 1, 0));

  return {
    startDate,
    endDate,
    startInput: dateInputValue(startDate),
    endInput: dateInputValue(endDate),
  };
};

export const normalizeTodoHistoryDateRange = ({ start, end, now = new Date(), dayCount = TODO_DONE_BOARD_LOOKBACK_DAYS } = {}) => {
  const fallback = defaultTodoHistoryDateRange(now, dayCount);
  let startDate = startOfDay(start) || fallback.startDate;
  let endDate = endOfDay(end) || fallback.endDate;

  if (startDate > endDate) {
    endDate = endOfDay(startDate);
  }

  return {
    startDate,
    endDate,
    startInput: dateInputValue(startDate),
    endInput: dateInputValue(endDate),
  };
};

export const todoIsDone = (todo = {}) => (
  todo.status === TODO_STATUS.done || todo.status === TODO_STATUS.archived
);

export const todoIsOpen = (todo = {}) => !todoIsDone(todo);

export const todoDueState = (todo = {}, now = new Date()) => {
  if (!todoIsOpen(todo)) return "complete";

  const dueDate = toDate(todo.dueAt);
  if (!dueDate) return "none";

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (dueDate < todayStart) return "overdue";
  if (dueDate < tomorrowStart) return "today";
  return "upcoming";
};

export const todoNeedsAttention = (todo = {}, now = new Date()) => {
  const state = todoDueState(todo, now);
  const reminderAt = toDate(todo.reminderAt);

  return (
    state === "overdue" ||
    state === "today" ||
    (todo.reminderEnabled && reminderAt && reminderAt <= now && todoIsOpen(todo))
  );
};

export const todoCompletionDate = (todo = {}) => (
  toDate(todo.completedAt || todo.completedDate || todo.doneAt || todo.updatedAt || todo.createdAt)
);

export const todoCompletedInDateRange = (todo = {}, startDate, endDate) => {
  if (todo.status !== TODO_STATUS.done) return false;

  const completedDate = todoCompletionDate(todo);
  if (!completedDate) return false;

  return (!startDate || completedDate >= startDate) && (!endDate || completedDate <= endDate);
};

const priorityRank = {
  [TODO_PRIORITY.urgent]: 0,
  [TODO_PRIORITY.high]: 1,
  [TODO_PRIORITY.normal]: 2,
  [TODO_PRIORITY.low]: 3,
};

const dueStateRank = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  none: 3,
  complete: 4,
};

export const compareTodosByUrgency = (left = {}, right = {}) => {
  const leftDueState = dueStateRank[todoDueState(left)] ?? 5;
  const rightDueState = dueStateRank[todoDueState(right)] ?? 5;
  if (leftDueState !== rightDueState) return leftDueState - rightDueState;

  const leftDue = toMillis(left.dueAt) || Number.MAX_SAFE_INTEGER;
  const rightDue = toMillis(right.dueAt) || Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;

  const leftPriority = priorityRank[left.priority] ?? priorityRank[TODO_PRIORITY.normal];
  const rightPriority = priorityRank[right.priority] ?? priorityRank[TODO_PRIORITY.normal];
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  return toMillis(right.createdAt || right.updatedAt) - toMillis(left.createdAt || left.updatedAt);
};

export const normalizeTodo = (documentSnapshot) => ({
  id: documentSnapshot.id,
  status: TODO_STATUS.open,
  scope: TODO_SCOPE.team,
  priority: TODO_PRIORITY.normal,
  boardId: "",
  boardName: "",
  reminderEnabled: false,
  relatedEntity: null,
  ...documentSnapshot.data(),
});

export const buildTodoAlertText = (todo = {}) => {
  const pieces = [];

  if (todo.assignedToName) pieces.push(`Assigned to ${todo.assignedToName}`);
  if (todo.dueAt) pieces.push(`Due ${formatShortDateTime(todo.dueAt)}`);
  if (todo.relatedEntity?.type && todo.relatedEntity?.id) {
    pieces.push(`${todo.relatedEntity.type}: ${todo.relatedEntity.label || todo.relatedEntity.id}`);
  }

  return pieces.length > 0 ? pieces.join(" | ") : "Todo reminder";
};
