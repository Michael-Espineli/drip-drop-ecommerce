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
  { value: "serviceRequest", label: "Service Request" },
  { value: "serviceStop", label: "Service Stop" },
  { value: "recurringServiceStop", label: "Recurring Stop" },
  { value: "estimate", label: "Estimate" },
  { value: "serviceAgreement", label: "Service Agreement" },
  { value: "invoice", label: "Invoice" },
  { value: "purchase", label: "Purchase" },
  { value: "shoppingListItem", label: "Shopping Item" },
  { value: "databaseItem", label: "Database Item" },
  { value: "receipt", label: "Receipt" },
  { value: "vendor", label: "Vendor" },
  { value: "companyUser", label: "Company User" },
  { value: "todo", label: "Todo" },
  { value: "chat", label: "Chat" },
  { value: "other", label: "Other" },
];

export const normalizeAlertNotification = (documentSnapshot) => {
  const data = documentSnapshot.data ? documentSnapshot.data() : documentSnapshot;
  const id = documentSnapshot.id || data.id;
  const status = data.status || (data.read ? ALERT_STATUS.read : ALERT_STATUS.unread);
  const title = data.title || data.name || "Alert";
  const message = data.message || data.description || "";
  const share = data.share || data.conversationLink || null;
  const relatedEntity = data.relatedEntity || (
    share?.type && (share.recordId || share.id)
      ? {
        type: share.type,
        id: share.recordId || share.id,
        label: share.title || share.label || "",
        companyId: share.companyId || data.companyId || "",
        webPath: share.webPath || "",
        deeplinkUrl: share.deeplinkUrl || "",
      }
      : null
  ) || (
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
    share,
  };
};

export const attachAlertNotificationSource = (documentSnapshot, scope = "company") => {
  const alert = normalizeAlertNotification(documentSnapshot);

  return {
    ...alert,
    notificationScope: scope,
    notificationSources: [
      {
        scope,
        id: alert.id,
      },
    ],
  };
};

export const alertBelongsToCompany = (alert = {}, companyId = "") => {
  const cleanCompanyId = String(companyId || "").trim();
  if (!cleanCompanyId) return true;

  return [
    alert.companyId,
    alert.recipientCompanyId,
    alert.createdByCompanyId,
    alert.relatedEntity?.companyId,
    alert.share?.companyId,
  ].some((value) => String(value || "").trim() === cleanCompanyId);
};

const alertMergeKey = (alert = {}) => {
  const sourceId = String(alert.sourceId || "").trim();
  if (sourceId) return `${alert.source || "source"}:${sourceId}`;

  const chatId = String(alert.chatId || "").trim();
  const sharedRecordId = String(alert.share?.recordId || alert.share?.id || alert.relatedEntity?.id || "").trim();
  if (chatId && sharedRecordId) return `chat:${chatId}:${sharedRecordId}`;

  return `${alert.notificationScope || "alert"}:${alert.id}`;
};

export const mergeAlertNotifications = (alerts = []) => {
  const byKey = new Map();

  alerts.filter(Boolean).forEach((alert) => {
    const key = alertMergeKey(alert);
    const sources = Array.isArray(alert.notificationSources) && alert.notificationSources.length > 0
      ? alert.notificationSources
      : [{ scope: alert.notificationScope || "company", id: alert.id }];
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...alert, notificationSources: sources });
      return;
    }

    const nextSources = [...existing.notificationSources];
    sources.forEach((source) => {
      const alreadyIncluded = nextSources.some((existingSource) => (
        existingSource.scope === source.scope && existingSource.id === source.id
      ));
      if (!alreadyIncluded) nextSources.push(source);
    });

    byKey.set(key, {
      ...existing,
      notificationSources: nextSources,
    });
  });

  return Array.from(byKey.values());
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
