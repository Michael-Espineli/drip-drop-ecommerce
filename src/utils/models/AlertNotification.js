import { toDate, toMillis } from "./TodoItem";

export const ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID = "feature_flag_011";

export const ALERT_STATUS = {
  unread: "unread",
  read: "read",
  archived: "archived",
};

export const ALERT_SEVERITY = {
  info: "info",
  success: "success",
  warning: "warning",
  critical: "critical",
};

export const ALERT_RELATED_ENTITY_TYPES = [
  { value: "", label: "No linked record" },
  { value: "customer", label: "Customer" },
  { value: "serviceLocation", label: "Service Location" },
  { value: "bodyOfWater", label: "Body of Water" },
  { value: "equipment", label: "Equipment" },
  { value: "job", label: "Job" },
  { value: "repairRequest", label: "Repair Request" },
  { value: "invoice", label: "Invoice" },
  { value: "todo", label: "Todo" },
  { value: "other", label: "Other" },
];

export const normalizeAlertNotification = (documentSnapshot) => {
  const data = documentSnapshot.data ? documentSnapshot.data() : documentSnapshot;
  const id = documentSnapshot.id || data.id;
  const status = data.status || (data.read ? ALERT_STATUS.read : ALERT_STATUS.unread);
  const title = data.title || data.name || "Alert";
  const message = data.message || data.description || "";
  const relatedEntity = data.relatedEntity || (
    data.hasItem || data.itemId
      ? {
        type: data.route || "legacy",
        id: data.itemId || "",
        label: data.itemName || "",
      }
      : null
  );

  return {
    id,
    ...data,
    title,
    name: data.name || title,
    message,
    description: data.description || message,
    status,
    severity: data.severity || ALERT_SEVERITY.info,
    relatedEntity,
  };
};

export const alertIsUnread = (alert = {}) => (
  alert.status !== ALERT_STATUS.archived &&
  (alert.status === ALERT_STATUS.unread || alert.read === false || (!alert.status && !alert.readAt))
);

export const alertIsScheduled = (alert = {}, now = new Date()) => {
  const scheduledFor = toDate(alert.scheduledFor || alert.deliveryAt || alert.dueAt);
  return Boolean(scheduledFor && scheduledFor > now && alert.status !== ALERT_STATUS.archived);
};

export const alertNeedsAttention = (alert = {}, now = new Date()) => {
  if (alert.status === ALERT_STATUS.archived) return false;

  const scheduledFor = toDate(alert.scheduledFor || alert.deliveryAt || alert.dueAt);
  return alertIsUnread(alert) && (!scheduledFor || scheduledFor <= now);
};

export const compareAlertsFresh = (left = {}, right = {}) => {
  const leftTime = toMillis(left.scheduledFor || left.deliveryAt || left.dueAt || left.createdAt || left.updatedAt);
  const rightTime = toMillis(right.scheduledFor || right.deliveryAt || right.dueAt || right.createdAt || right.updatedAt);

  return rightTime - leftTime;
};

export const alertDisplayTime = (alert = {}) => (
  alert.scheduledFor || alert.deliveryAt || alert.dueAt || alert.createdAt || alert.updatedAt
);
