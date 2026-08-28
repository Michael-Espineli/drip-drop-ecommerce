import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { FaBell, FaCheckCircle, FaExclamationTriangle, FaRegBell } from "react-icons/fa";
import { MdNotificationsActive, MdNotificationsOff, MdOutlineSchedule } from "react-icons/md";
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import {
  getConversationLinkLabel,
  getConversationLinkRoute,
  normalizeConversationLink,
} from "../../utils/chatMessaging";
import { compareCompanyUsersByName, getCompanyUserDisplayName, sortCompanyUsersByName } from "../../utils/companyUsers";
import {
  ALERT_RELATED_ENTITY_TYPES,
  ALERT_SEVERITY,
  ALERT_STATUS,
  alertBelongsToCompany,
  alertDisplayTime,
  alertIsArchived,
  alertIsScheduled,
  alertIsUnread,
  alertNeedsAttention,
  attachAlertNotificationSource,
  compareAlertsFresh,
  mergeAlertNotifications,
} from "../../utils/models/AlertNotification";
import { formatShortDateTime } from "../../utils/models/TodoItem";

const filters = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "unread", label: "Unread" },
  { id: "scheduled", label: "Scheduled" },
];

const emptyAlertForm = () => ({
  title: "",
  message: "",
  severity: ALERT_SEVERITY.info,
  targetScope: "team",
  assignedToUserId: "",
  scheduledFor: "",
  relatedEntityType: "",
  relatedEntityId: "",
  relatedEntityLabel: "",
});

const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const timestampFromInput = (value) => {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
};

const severityTone = (severity) => {
  const tones = {
    critical: "border-rose-200 bg-rose-50 text-rose-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
  };

  return tones[severity] || tones.info;
};

const statusTone = (alert) => {
  if (alertIsArchived(alert)) return "border-slate-200 bg-slate-50 text-slate-500";
  if (alertIsScheduled(alert)) return "border-purple-200 bg-purple-50 text-purple-700";
  if (alertNeedsAttention(alert)) return "border-amber-200 bg-amber-50 text-amber-700";
  if (alertIsUnread(alert)) return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
};

const statusLabel = (alert) => {
  if (alertIsArchived(alert)) return "Dismissed";
  if (alertIsScheduled(alert)) return "Scheduled";
  if (alertNeedsAttention(alert)) return "Active";
  if (alertIsUnread(alert)) return "Unread";
  return "Read";
};

const StatCard = ({ icon: Icon, label, value, helper, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
  );
};

const Alerts = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, user, name } = useContext(Context);
  const [alertSources, setAlertSources] = useState({ company: [], personal: [] });
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState(emptyAlertForm);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAlertSources({ company: [], personal: [] });
      setCompanyUsers([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const alertsRef = collection(db, "companies", recentlySelectedCompany, "alerts");
    const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");

    const unsubscribeAlerts = onSnapshot(
      alertsRef,
      (snapshot) => {
        setAlertSources((current) => ({
          ...current,
          company: snapshot.docs.map((alertDoc) => attachAlertNotificationSource(alertDoc, "company")),
        }));
        setLoading(false);
      },
      (error) => {
        console.error("Error loading alerts:", error);
        toast.error("Failed to load alerts.");
        setLoading(false);
      }
    );

    const unsubscribePersonalAlerts = user?.uid ? onSnapshot(
      collection(db, "users", user.uid, "alerts"),
      (snapshot) => {
        const personalAlerts = snapshot.docs
          .map((alertDoc) => attachAlertNotificationSource(alertDoc, "personal"))
          .filter((alert) => alertBelongsToCompany(alert, recentlySelectedCompany));

        setAlertSources((current) => ({
          ...current,
          personal: personalAlerts,
        }));
      },
      (error) => {
        console.error("Error loading personal alerts:", error);
      }
    ) : () => {};

    const unsubscribeUsers = onSnapshot(
      usersRef,
      (snapshot) => {
        setCompanyUsers(sortCompanyUsersByName(snapshot.docs.map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        }))));
      },
      (error) => {
        console.error("Error loading company users:", error);
      }
    );

    return () => {
      unsubscribeAlerts();
      unsubscribePersonalAlerts();
      unsubscribeUsers();
    };
  }, [recentlySelectedCompany, user]);

  const alerts = useMemo(() => (
    mergeAlertNotifications([
      ...alertSources.personal,
      ...alertSources.company,
    ]).filter((alert) => alertBelongsToCompany(alert, recentlySelectedCompany))
  ), [alertSources, recentlySelectedCompany]);

  const companyUserOptions = useMemo(() => companyUsers
    .map((companyUser) => ({
      id: companyUser.id,
      userId: companyUser.userId || companyUser.id,
      userName: getCompanyUserDisplayName(companyUser),
      roleName: companyUser.roleName || "",
    }))
    .sort(compareCompanyUsersByName), [companyUsers]);

  const stats = useMemo(() => ({
    active: alerts.filter((alert) => alertNeedsAttention(alert)).length,
    unread: alerts.filter(alertIsUnread).length,
    scheduled: alerts.filter((alert) => alertIsScheduled(alert)).length,
    critical: alerts.filter((alert) => !alertIsArchived(alert) && alert.severity === ALERT_SEVERITY.critical).length,
  }), [alerts]);

  const filteredAlerts = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return alerts
      .filter((alert) => {
        if (alertIsArchived(alert)) return false;
        if (filter === "active" && !alertNeedsAttention(alert)) return false;
        if (filter === "unread" && !alertIsUnread(alert)) return false;
        if (filter === "scheduled" && !alertIsScheduled(alert)) return false;

        if (!search) return true;

        return [
          alert.title,
          alert.message,
          alert.assignedToName,
          alert.relatedEntity?.type,
          alert.relatedEntity?.id,
          alert.relatedEntity?.label,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      })
      .sort(compareAlertsFresh);
  }, [alerts, filter, searchTerm]);

  const updateForm = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "targetScope" && value === "team" ? { assignedToUserId: "" } : {}),
    }));
  };

  const createAlert = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany || !user) {
      toast.error("Select a company before creating an alert.");
      return;
    }

    const title = form.title.trim();
    if (!title) {
      toast.error("Alert title is required.");
      return;
    }

    const assignee = companyUserOptions.find((option) => option.userId === form.assignedToUserId);
    if (form.targetScope === "specific" && !assignee) {
      toast.error("Choose a team member for a specific notification.");
      return;
    }

    const relatedEntity = form.relatedEntityType && form.relatedEntityId.trim()
      ? {
        type: form.relatedEntityType,
        id: form.relatedEntityId.trim(),
        label: form.relatedEntityLabel.trim(),
      }
      : null;

    const scheduledFor = timestampFromInput(form.scheduledFor);
    const alertId = makeId("alert");
    const message = form.message.trim();

    setSaving(true);

    try {
      await setDoc(doc(db, "companies", recentlySelectedCompany, "alerts", alertId), {
        id: alertId,
        companyId: recentlySelectedCompany,
        title,
        name: title,
        message,
        description: message,
        status: ALERT_STATUS.unread,
        read: false,
        severity: form.severity,
        type: "manual_notification",
        source: "alerts",
        sourceId: alertId,
        route: "/company/alerts",
        hasItem: Boolean(relatedEntity),
        itemId: relatedEntity?.id || "",
        itemName: relatedEntity?.label || "",
        targetScope: form.targetScope,
        assignedToUserId: assignee?.userId || "",
        assignedToCompanyUserDocId: assignee?.id || "",
        assignedToName: assignee?.userName || "",
        deliveryTargets: ["web", "ios"],
        channels: {
          dashboard: true,
          ios: true,
          push: true,
        },
        scheduledFor,
        relatedEntity,
        createdByUserId: user.uid,
        createdByName: name || user.email || "Company user",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setForm(emptyAlertForm());
      toast.success("Alert created.");
    } catch (error) {
      console.error("Failed to create alert:", error);
      toast.error("Failed to create alert.");
    } finally {
      setSaving(false);
    }
  };

  const updateAlertStatus = async (alert, status) => {
    if (!recentlySelectedCompany) return;

    try {
      const notificationSources = Array.isArray(alert.notificationSources) && alert.notificationSources.length > 0
        ? alert.notificationSources
        : [{ scope: "company", id: alert.id }];
      const updatePayload = {
        status,
        read: status === ALERT_STATUS.read,
        readAt: status === ALERT_STATUS.read ? serverTimestamp() : null,
        archivedAt: status === ALERT_STATUS.archived ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      };
      const updates = notificationSources.map((source) => {
        const alertRef = source.scope === "personal" && user?.uid
          ? doc(db, "users", user.uid, "alerts", source.id)
          : doc(db, "companies", recentlySelectedCompany, "alerts", source.id);

        return updateDoc(alertRef, updatePayload);
      });

      await Promise.all(updates);
    } catch (error) {
      console.error("Failed to update alert:", error);
      toast.error("Failed to update alert.");
    }
  };

  const alertHref = (alert) => {
    if (alert.share || alert.relatedEntity?.type) {
      const link = normalizeConversationLink({
        ...(alert.share || {}),
        type: alert.share?.type || alert.relatedEntity?.type,
        recordId: alert.share?.recordId || alert.share?.id || alert.relatedEntity?.id,
        title: alert.share?.title || alert.relatedEntity?.label,
        companyId: alert.share?.companyId || alert.relatedEntity?.companyId || alert.companyId,
        webPath: alert.share?.webPath || alert.relatedEntity?.webPath || "",
      });
      const route = getConversationLinkRoute(link, "company");
      if (route) return route;
    }
    if (alert.route && alert.route.startsWith("/")) return alert.route;
    if (alert.source === "todoList" || alert.todoId) return "/company/todo-list";
    return "";
  };

  const alertRecordLabel = (alert) => {
    const type = alert.share?.type || alert.relatedEntity?.type;
    if (!type) return "";

    return getConversationLinkLabel(type);
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading alerts...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || "Selected company"}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-950">Notification Center</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                System alerts, todo reminders, shared records, scheduled notifications, and iOS-ready notification records.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={MdNotificationsActive} label="Active" value={stats.active} helper="Ready for attention" tone={stats.active ? "amber" : "emerald"} />
          <StatCard icon={FaRegBell} label="Unread" value={stats.unread} helper="Not marked read" tone="blue" />
          <StatCard icon={MdOutlineSchedule} label="Scheduled" value={stats.scheduled} helper="Future delivery time" />
          <StatCard icon={FaExclamationTriangle} label="Critical" value={stats.critical} helper="High severity alerts" tone={stats.critical ? "rose" : "emerald"} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={createAlert} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm xl:order-2">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-950">Internal Notification</h2>
              <p className="mt-1 text-sm text-slate-500">For one-off company notices. System events and todos can create notifications automatically.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="alert-title">Title</label>
                <input
                  id="alert-title"
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Important team reminder"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="alert-message">Message</label>
                <textarea
                  id="alert-message"
                  value={form.message}
                  onChange={(event) => updateForm("message", event.target.value)}
                  className="mt-1 min-h-[92px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Add notification details."
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="alert-severity">Severity</label>
                  <select
                    id="alert-severity"
                    value={form.severity}
                    onChange={(event) => updateForm("severity", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value={ALERT_SEVERITY.info}>Info</option>
                    <option value={ALERT_SEVERITY.success}>Success</option>
                    <option value={ALERT_SEVERITY.warning}>Warning</option>
                    <option value={ALERT_SEVERITY.critical}>Critical</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="alert-scheduled">Scheduled for</label>
                  <input
                    id="alert-scheduled"
                    type="datetime-local"
                    value={form.scheduledFor}
                    onChange={(event) => updateForm("scheduledFor", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-700">Target</p>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => updateForm("targetScope", "team")}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${form.targetScope === "team" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                  >
                    Team
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm("targetScope", "specific")}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${form.targetScope === "specific" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                  >
                    Specific
                  </button>
                </div>
              </div>

              {form.targetScope === "specific" && (
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="alert-assignee">Recipient</label>
                  <select
                    id="alert-assignee"
                    value={form.assignedToUserId}
                    onChange={(event) => updateForm("assignedToUserId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Choose team member</option>
                    {companyUserOptions.map((option) => (
                      <option key={option.id} value={option.userId}>
                        {option.userName}{option.roleName ? ` - ${option.roleName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="alert-entity-type">Record type</label>
                  <select
                    id="alert-entity-type"
                    value={form.relatedEntityType}
                    onChange={(event) => updateForm("relatedEntityType", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {ALERT_RELATED_ENTITY_TYPES.map((type) => (
                      <option key={type.value || "none"} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="alert-entity-id">Record ID</label>
                  <input
                    id="alert-entity-id"
                    value={form.relatedEntityId}
                    onChange={(event) => updateForm("relatedEntityId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="customer id"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="alert-entity-label">Label</label>
                  <input
                    id="alert-entity-label"
                    value={form.relatedEntityLabel}
                    onChange={(event) => updateForm("relatedEntityLabel", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="optional"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Creating..." : "Create Alert"}
              </button>
            </div>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm xl:order-1">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Notification Inbox</h2>
                  <p className="mt-1 text-sm text-slate-500">Legacy contract alerts and new notification records appear together.</p>
                </div>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 lg:w-64"
                  placeholder="Search alerts"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${filter === item.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredAlerts.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No alerts match this view.</div>
              ) : filteredAlerts.map((alert) => {
                const href = alertHref(alert);

                return (
                  <div key={alert.id} className="px-5 py-4 transition hover:bg-slate-50">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${severityTone(alert.severity)}`}>
                            {alert.severity || "info"}
                          </span>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(alert)}`}>
                            {statusLabel(alert)}
                          </span>
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            {formatShortDateTime(alertDisplayTime(alert))}
                          </span>
                        </div>

                        <h3 className="mt-3 break-words text-base font-bold text-slate-950">{alert.title}</h3>
                        {alert.message && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{alert.message}</p>}

                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                          <span>{alert.assignedToName ? `Assigned to ${alert.assignedToName}` : "Team alert"}</span>
                          {alert.relatedEntity?.type && alert.relatedEntity?.id && (
                            <span>{alertRecordLabel(alert)}: {alert.relatedEntity.label || alert.relatedEntity.id}</span>
                          )}
                          {Array.isArray(alert.deliveryTargets) && alert.deliveryTargets.length > 0 && (
                            <span>{alert.deliveryTargets.join(" + ")}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        {href && (
                          <Link
                            to={href}
                            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                          >
                            <FaBell className="h-3.5 w-3.5" />
                            Open
                          </Link>
                        )}
                        {alert.status !== ALERT_STATUS.read && !alertIsArchived(alert) && (
                          <button
                            type="button"
                            onClick={() => updateAlertStatus(alert, ALERT_STATUS.read)}
                            className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                          >
                            <FaCheckCircle className="h-3.5 w-3.5" />
                            Read
                          </button>
                        )}
                        {!alertIsArchived(alert) && (
                          <button
                            type="button"
                            onClick={() => updateAlertStatus(alert, ALERT_STATUS.archived)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <MdNotificationsOff className="h-4 w-4" />
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
};

export default Alerts;
