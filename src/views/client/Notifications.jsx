import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  BellIcon,
  CheckCircleIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import {
  ALERT_STATUS,
  alertDisplayTime,
  alertIsScheduled,
  alertIsUnread,
  alertNeedsAttention,
  compareAlertsFresh,
  normalizeAlertNotification,
} from "../../utils/models/AlertNotification";
import { formatShortDateTime } from "../../utils/models/TodoItem";
import {
  getConversationLinkLabel,
  getConversationLinkRoute,
  normalizeConversationLink,
} from "../../utils/chatMessaging";

const filters = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "unread", label: "Unread" },
  { id: "archived", label: "Dismissed" },
];

const statusTone = (alert) => {
  if (alert.status === ALERT_STATUS.archived) return "border-slate-200 bg-slate-50 text-slate-500";
  if (alertNeedsAttention(alert)) return "border-amber-200 bg-amber-50 text-amber-700";
  if (alertIsUnread(alert)) return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
};

const statusLabel = (alert) => {
  if (alert.status === ALERT_STATUS.archived) return "Dismissed";
  if (alertIsScheduled(alert)) return "Scheduled";
  if (alertNeedsAttention(alert)) return "Active";
  if (alertIsUnread(alert)) return "Unread";
  return "Read";
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
      clientWebPath: alert.share?.clientWebPath || "",
    });
    const route = getConversationLinkRoute(link, "client");
    if (route) return route;
  }

  if (alert.route && alert.route.startsWith("/")) return alert.route;
  if (alert.chatId) return `/client/chat/details/${alert.chatId}`;
  return "";
};

const Notifications = () => {
  const { user } = useContext(Context);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!user?.uid) {
      setAlerts([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const alertsRef = collection(db, "users", user.uid, "alerts");
    const unsubscribe = onSnapshot(
      alertsRef,
      (snapshot) => {
        setAlerts(snapshot.docs.map(normalizeAlertNotification));
        setLoading(false);
      },
      (error) => {
        console.error("Error loading client notifications:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const stats = useMemo(() => ({
    active: alerts.filter(alertNeedsAttention).length,
    unread: alerts.filter(alertIsUnread).length,
    archived: alerts.filter((alert) => alert.status === ALERT_STATUS.archived).length,
  }), [alerts]);

  const filteredAlerts = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return alerts
      .filter((alert) => {
        if (filter === "active" && !alertNeedsAttention(alert)) return false;
        if (filter === "unread" && !alertIsUnread(alert)) return false;
        if (filter === "archived" && alert.status !== ALERT_STATUS.archived) return false;
        if (!search) return true;

        return [
          alert.title,
          alert.message,
          alert.relatedEntity?.type,
          alert.relatedEntity?.id,
          alert.relatedEntity?.label,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      })
      .sort(compareAlertsFresh);
  }, [alerts, filter, searchTerm]);

  const updateAlertStatus = async (alert, status) => {
    if (!user?.uid || !alert?.id) return;

    await updateDoc(doc(db, "users", user.uid, "alerts", alert.id), {
      status,
      read: status === ALERT_STATUS.read,
      readAt: status === ALERT_STATUS.read ? serverTimestamp() : null,
      archivedAt: status === ALERT_STATUS.archived ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-500">Loading notifications...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Client</p>
              <h1 className="mt-2 text-2xl font-bold text-slate-950">Notification Center</h1>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-700">
                <p className="text-lg font-bold">{stats.active}</p>
                <p className="text-xs font-semibold">Active</p>
              </div>
              <div className="rounded-md bg-blue-50 px-3 py-2 text-blue-700">
                <p className="text-lg font-bold">{stats.unread}</p>
                <p className="text-xs font-semibold">Unread</p>
              </div>
              <div className="rounded-md bg-slate-100 px-3 py-2 text-slate-600">
                <p className="text-lg font-bold">{stats.archived}</p>
                <p className="text-xs font-semibold">Dismissed</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 md:max-w-xs"
                placeholder="Search notifications"
              />
              <div className="flex flex-wrap gap-2">
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
          </div>

          <div className="divide-y divide-slate-100">
            {filteredAlerts.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No notifications match this view.</div>
            ) : filteredAlerts.map((alert) => {
              const href = alertHref(alert);
              const recordLabel = getConversationLinkLabel(alert.share?.type || alert.relatedEntity?.type || "");

              return (
                <div key={alert.id} className="px-4 py-4 transition hover:bg-slate-50">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(alert)}`}>
                          {statusLabel(alert)}
                        </span>
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {formatShortDateTime(alertDisplayTime(alert))}
                        </span>
                      </div>
                      <h2 className="mt-3 break-words text-base font-bold text-slate-950">{alert.title}</h2>
                      {alert.message && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{alert.message}</p>}
                      {alert.relatedEntity?.id && (
                        <p className="mt-2 text-xs font-semibold text-slate-500">
                          {recordLabel}: {alert.relatedEntity.label || alert.relatedEntity.id}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {href && (
                        <Link
                          to={href}
                          className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                        >
                          <BellIcon className="h-4 w-4" />
                          Open
                        </Link>
                      )}
                      {alert.status !== ALERT_STATUS.read && alert.status !== ALERT_STATUS.archived && (
                        <button
                          type="button"
                          onClick={() => updateAlertStatus(alert, ALERT_STATUS.read)}
                          className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          <CheckCircleIcon className="h-4 w-4" />
                          Read
                        </button>
                      )}
                      {alert.status !== ALERT_STATUS.archived && (
                        <button
                          type="button"
                          onClick={() => updateAlertStatus(alert, ALERT_STATUS.archived)}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          <NoSymbolIcon className="h-4 w-4" />
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
      </div>
    </div>
  );
};

export default Notifications;
