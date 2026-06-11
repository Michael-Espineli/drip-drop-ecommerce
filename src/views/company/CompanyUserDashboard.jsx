import React, { useEffect, useMemo, useState, useContext } from "react";
import { Link } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
} from "firebase/firestore";
import { Context } from "../../context/AuthContext";
import { ClipLoader } from "react-spinners";
import { format } from "date-fns";

const StatCard = ({ title, value, sub }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="text-sm font-semibold text-slate-700">{title}</div>
    <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    {sub ? <div className="mt-1 text-sm text-slate-500">{sub}</div> : null}
  </div>
);

const SectionCard = ({ title, actions, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
      <div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const Chip = ({ children }) => (
  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
    {children}
  </span>
);

const RowLink = ({ to, children }) => (
  <Link
    to={to}
    className="group block rounded-xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition"
  >
    {children}
  </Link>
);

function safeDate(value) {
  try {
    // Firestore Timestamp support
    const date = value?.toDate
      ? value.toDate()
      : value instanceof Date
        ? value
        : typeof value === "number" || typeof value === "string"
          ? new Date(value)
          : null;

    return date && !Number.isNaN(date.getTime()) ? date : null;
  } catch (e) { }
  return null;
}

function toMillis(value) {
  return safeDate(value)?.getTime() || 0;
}

const normalizeText = (value) => (value || "").toString().trim().toLowerCase();

const getCompanyUserName = (user = {}) => (
  user.userName ||
  user.displayName ||
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.name ||
  user.email ||
  user.userId ||
  user.id ||
  "Unknown User"
);

const getCompanyUserMeta = (user = {}) => [
  user.roleName || "No role assigned",
  user.workerType || "No worker type"
].filter(Boolean).join(" / ");

const getStatusClass = (status) => {
  switch (normalizeText(status)) {
    case "active":
      return "bg-green-100 text-green-800";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "inactive":
      return "bg-red-100 text-red-800";
    case "past":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const getStatusLabel = (status) => {
  if (!status) return "Unknown";
  return status.toString().charAt(0).toUpperCase() + status.toString().slice(1);
};

const getWorkLogDate = (workLog = {}) => (
  safeDate(workLog.dateCreated) ||
  safeDate(workLog.date) ||
  safeDate(workLog.createdAt) ||
  safeDate(workLog.workDate) ||
  safeDate(workLog.startTime) ||
  safeDate(workLog.clockInAt) ||
  safeDate(workLog.startedAt)
);

const getWorkLogTitle = (workLog = {}) => (
  workLog.jobName ||
  workLog.taskName ||
  workLog.title ||
  workLog.summary ||
  workLog.type ||
  "Work Log"
);

const getWorkLogPerson = (workLog = {}) => (
  workLog.userName ||
  workLog.techName ||
  workLog.employeeName ||
  workLog.createdByName ||
  "Unknown User"
);

const getWorkLogDuration = (workLog = {}) => {
  if (workLog.hoursWorked || workLog.hoursWorked === 0) return `${Number(workLog.hoursWorked || 0)} hr`;
  const start = safeDate(workLog.startTime || workLog.clockInAt || workLog.startedAt);
  const end = safeDate(workLog.endTime || workLog.clockOutAt || workLog.endedAt || workLog.completedAt);

  if (start && end) {
    const minutesBetween = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    const hours = Math.floor(minutesBetween / 60);
    const minutes = minutesBetween % 60;

    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes}m`;
  }

  const minutes = typeof workLog.minutes === "number"
    ? workLog.minutes
    : typeof workLog.durationMinutes === "number"
      ? workLog.durationMinutes
      : null;

  return minutes != null ? `${(minutes / 60).toFixed(2)} hr` : null;
};

const workLogMatchesUser = (workLog = {}, user = {}) => {
  if (!user?.id && !user?.userId) return false;

  const userIds = [user.id, user.userId].filter(Boolean).map(normalizeText);
  const workLogIds = [
    workLog.userId,
    workLog.techId,
    workLog.employeeId,
    workLog.createdById,
    workLog.companyUserId,
    workLog.technicianId,
  ].filter(Boolean).map(normalizeText);

  if (workLogIds.some((id) => userIds.includes(id))) return true;

  const userNames = [getCompanyUserName(user), user.userName, user.displayName]
    .filter(Boolean)
    .map(normalizeText);
  const workLogNames = [workLog.userName, workLog.techName, workLog.employeeName, workLog.createdByName]
    .filter(Boolean)
    .map(normalizeText);

  return workLogNames.some((name) => userNames.includes(name));
};

const CompanyUserDashboard = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const db = getFirestore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [companyUsers, setCompanyUsers] = useState([]);
  const [workLogs, setWorkLogs] = useState([]);

  const [selectedUserId, setSelectedUserId] = useState("");

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCompanyUsers([]);
      setWorkLogs([]);
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const [usersSnap, logsSnap, activeRouteLogsSnap] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "workLogs")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "activeRouteLogs")),
        ]);

        const users = usersSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((left, right) => getCompanyUserName(left).localeCompare(getCompanyUserName(right)));

        const logs = [
          ...logsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          ...activeRouteLogsSnap.docs.map((d) => ({ id: d.id, ...d.data(), sourceCollection: "activeRouteLogs" })),
        ]
          .sort((left, right) => (
            toMillis(right.dateCreated || right.date || right.createdAt || right.workDate || right.startTime || right.clockInAt || right.startedAt) -
            toMillis(left.dateCreated || left.date || left.createdAt || left.workDate || left.startTime || left.clockInAt || left.startedAt)
          ))
          .slice(0, 50);

        setCompanyUsers(users);
        setWorkLogs(logs);
      } catch (e) {
        console.error(e);
        setError("Failed to load user dashboard data.");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [recentlySelectedCompany, db]);

  const selectedUser = useMemo(
    () => companyUsers.find((u) => u.id === selectedUserId || u.userId === selectedUserId) || null,
    [companyUsers, selectedUserId]
  );

  const visibleWorkLogs = useMemo(() => {
    if (!selectedUser) return workLogs;
    return workLogs.filter((wl) => workLogMatchesUser(wl, selectedUser));
  }, [workLogs, selectedUser]);

  const stats = useMemo(() => {
    const totalUsers = companyUsers.length;
    const totalLogs = workLogs.length;

    const activeUsers = companyUsers.filter((u) => {
      if (typeof u.active === "boolean") return u.active;
      if (typeof u.isActive === "boolean") return u.isActive;
      if (typeof u.disabled === "boolean") return !u.disabled;
      if (u.status) return normalizeText(u.status) === "active";
      return true;
    }).length;

    const selectedLogsCount = selectedUserId ? visibleWorkLogs.length : totalLogs;

    return { totalUsers, activeUsers, totalLogs, selectedLogsCount };
  }, [companyUsers, workLogs, selectedUserId, visibleWorkLogs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8">
        <div className="mx-auto max-w-6xl flex items-center justify-center py-24">
          <ClipLoader size={40} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
            <div className="font-semibold">Error</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link
                to="/company"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                ← Back
              </Link>
              <Chip>Users</Chip>
              {selectedUser ? (
                <Chip>
                  Viewing: {getCompanyUserName(selectedUser)}
                </Chip>
              ) : (
                <Chip>All Users</Chip>
              )}
            </div>

            <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              User Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Overview of company users and recent work log activity.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/companyUsers"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
            >
              Company Users
            </Link>
            <Link
              to="/company/workLogs"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Work Logs
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Users" value={stats.totalUsers} />
          <StatCard title="Active Users" value={stats.activeUsers} sub="Based on status and active flags" />
          <StatCard title="Recent Work Logs" value={stats.totalLogs} sub="Last 50 loaded" />
          <StatCard
            title={selectedUserId ? "Selected User Logs" : "User Log Filter"}
            value={stats.selectedLogsCount}
            sub={selectedUserId ? "Filtered by selected user" : "Select a user to filter"}
          />
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Users */}
          <div className="lg:col-span-1 space-y-6">
            <SectionCard
              title="Company Users"
              actions={
                <>
                  <Link
                    to="/company/companyUsers/createNew"
                    className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition"
                  >
                    + Add
                  </Link>
                </>
              }
            >
              <div className="space-y-3">
                <div className="space-y-2">
                  {companyUsers.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                      No company users found.
                    </div>
                  ) : (
                    companyUsers.slice(0, 30).map((u) => {
                      const isSelected = selectedUserId === u.id || selectedUserId === u.userId;

                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setSelectedUserId(isSelected ? "" : u.id)}
                          className={`w-full text-left rounded-xl border px-4 py-3 transition
                            ${isSelected
                              ? "border-blue-200 bg-blue-50"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">
                                {getCompanyUserName(u)}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500 truncate">
                                {u.email || u.userId || "No email on file"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500 truncate">
                                {getCompanyUserMeta(u)}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 justify-end">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(u.status)}`}>
                                {getStatusLabel(u.status)}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {companyUsers.length > 30 ? (
                  <div className="text-xs text-slate-500">
                    Showing 30 of {companyUsers.length}. Open Company Users to view the full list.
                  </div>
                ) : null}
              </div>
            </SectionCard>
          </div>

          {/* Right: Work Logs */}
          <div className="lg:col-span-2 space-y-6">
            <SectionCard
              title="Work Logs"
              actions={
                <div className="flex items-center gap-2">
                  {selectedUserId ? (
                    <button
                      type="button"
                      onClick={() => setSelectedUserId("")}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      Clear Filter
                    </button>
                  ) : null}
                  <Link
                    to="/company/workLogs"
                    className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
                  >
                    Open All
                  </Link>
                </div>
              }
            >
              {visibleWorkLogs.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                  <div className="text-sm font-semibold text-slate-900">
                    No work logs found
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {selectedUserId ? "Try clearing the user filter." : "Create your first work log to see it here."}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleWorkLogs.slice(0, 12).map((wl) => {
                    const d = getWorkLogDate(wl);
                    const dateLabel = d ? format(d, "PPP") : "Unknown date";
                    const title = getWorkLogTitle(wl);
                    const who = getWorkLogPerson(wl);
                    const durationLabel = getWorkLogDuration(wl);
                    const payLabel = wl.rate && wl.hoursWorked
                      ? `$${(Number(wl.hoursWorked || 0) * Number(wl.rate || 0)).toFixed(2)}`
                      : null;

                    return (
                      <RowLink key={wl.id} to={`/company/workLogs/${wl.id}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {title}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{dateLabel}</span>
                              <span className="opacity-50">•</span>
                              <span>{who}</span>
                              {durationLabel ? (
                                <>
                                  <span className="opacity-50">•</span>
                                  <span>{durationLabel}</span>
                                </>
                              ) : null}
                              {wl.status ? (
                                <>
                                  <span className="opacity-50">•</span>
                                  <span>{wl.status}</span>
                                </>
                              ) : null}
                              {payLabel ? (
                                <>
                                  <span className="opacity-50">•</span>
                                  <span>{payLabel}</span>
                                </>
                              ) : null}
                            </div>
                            {wl.notes || wl.description ? (
                              <div className="mt-2 text-sm text-slate-600 line-clamp-2">
                                {wl.notes || wl.description}
                              </div>
                            ) : null}
                          </div>
                          <span className="text-sm font-semibold text-blue-600 group-hover:underline">
                            View
                          </span>
                        </div>
                      </RowLink>
                    );
                  })}

                  {visibleWorkLogs.length > 12 ? (
                    <div className="pt-2 flex justify-end">
                      <Link
                        to="/company/workLogs"
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                      >
                        View more ({visibleWorkLogs.length})
                      </Link>
                    </div>
                  ) : null}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Quick Links">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link
                  to="/company/companyUsers"
                  className="rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50 transition"
                >
                  <div className="text-sm font-semibold text-slate-900">Company Users</div>
                  <div className="mt-1 text-sm text-slate-500">Create, edit, and manage users</div>
                </Link>
                <Link
                  to="/company/workLogs"
                  className="rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50 transition"
                >
                  <div className="text-sm font-semibold text-slate-900">Work Logs</div>
                  <div className="mt-1 text-sm text-slate-500">Review recent activity and entries</div>
                </Link>
                <Link
                  to="/company/roles"
                  className="rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50 transition"
                >
                  <div className="text-sm font-semibold text-slate-900">Roles</div>
                  <div className="mt-1 text-sm text-slate-500">Permissions & access control</div>
                </Link>
                <Link
                  to="/company/settings"
                  className="rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50 transition"
                >
                  <div className="text-sm font-semibold text-slate-900">Settings</div>
                  <div className="mt-1 text-sm text-slate-500">Company configuration</div>
                </Link>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
export default CompanyUserDashboard;
