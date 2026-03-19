import React, { useEffect, useMemo, useState, useContext } from "react";
import { Link } from "react-router-dom";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
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
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") return new Date(value);
  } catch (e) {}
  return null;
}

const CompanyUserDashboard = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const db = getFirestore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [companyUsers, setCompanyUsers] = useState([]);
  const [workLogs, setWorkLogs] = useState([]);

  // Simple UI helpers
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");

  useEffect(() => {
    if (!recentlySelectedCompany) return;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        // --- Company Users ---
        // NOTE: Adjust collection name if your project uses a different path.
        // Common patterns: companies/{companyId}/companyUsers OR companies/{companyId}/users
        const usersQ = query(
          collection(db, "companies", recentlySelectedCompany, "companyUsers"),
          orderBy("lastName"),
          limit(250)
        );

        const usersSnap = await getDocs(usersQ);
        const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCompanyUsers(users);

        // --- Work Logs ---
        // NOTE: Adjust collection name/path if needed.
        // Common patterns: companies/{companyId}/workLogs OR companies/{companyId}/worklogs
        const logsQ = query(
          collection(db, "companies", recentlySelectedCompany, "workLogs"),
          orderBy("dateCreated", "desc"),
          limit(50)
        );

        const logsSnap = await getDocs(logsQ);
        const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  const filteredUsers = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return companyUsers;

    return companyUsers.filter((u) => {
      const full =
        `${u.firstName || ""} ${u.lastName || ""} ${u.name || ""} ${u.email || ""}`.toLowerCase();
      return full.includes(s);
    });
  }, [companyUsers, search]);

  const selectedUser = useMemo(
    () => companyUsers.find((u) => u.id === selectedUserId) || null,
    [companyUsers, selectedUserId]
  );

  const visibleWorkLogs = useMemo(() => {
    if (!selectedUserId) return workLogs;
    return workLogs.filter((wl) => {
      // Works with different naming conventions you might have:
      // userId / techId / employeeId / createdById
      return (
        wl.userId === selectedUserId ||
        wl.techId === selectedUserId ||
        wl.employeeId === selectedUserId ||
        wl.createdById === selectedUserId
      );
    });
  }, [workLogs, selectedUserId]);

  const stats = useMemo(() => {
    const totalUsers = companyUsers.length;
    const totalLogs = workLogs.length;

    const activeUsers = companyUsers.filter((u) => {
      // common patterns: active boolean, isActive, disabled
      if (typeof u.active === "boolean") return u.active;
      if (typeof u.isActive === "boolean") return u.isActive;
      if (typeof u.disabled === "boolean") return !u.disabled;
      return true; // assume active if unknown
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
      <div className="mx-auto max-w-6xl space-y-6">
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
                  Viewing:{" "}
                  {selectedUser.displayName ||
                    `${selectedUser.firstName || ""} ${selectedUser.lastName || ""}`.trim() ||
                    selectedUser.email ||
                    selectedUser.id}
                </Chip>
              ) : (
                <Chip>All Users</Chip>
              )}
            </div>

            <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              User Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Overview of Company Users, associated business, and Work Logs.
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
          <StatCard title="Active Users" value={stats.activeUsers} sub="Based on active/isActive/disabled flags" />
          <StatCard title="Recent Work Logs" value={stats.totalLogs} sub="Last 50 loaded" />
          <StatCard
            title={selectedUserId ? "Work Logs (Selected)" : "Work Logs (Filter)"}
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
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  placeholder="Search users (name, email)"
                />

                <div className="space-y-2">
                  {filteredUsers.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                      No users match your search.
                    </div>
                  ) : (
                    filteredUsers.slice(0, 30).map((u) => {
                      const label =
                        u.displayName ||
                        `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
                        u.name ||
                        u.email ||
                        u.id;

                      const isSelected = selectedUserId === u.id;

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
                                {label}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500 truncate">
                                {u.email || "No email"}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 justify-end">
                              {typeof u.active === "boolean" ? (
                                <span
                                  className={`rounded-full px-2 py-1 text-xs font-semibold
                                    ${u.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                                >
                                  {u.active ? "Active" : "Inactive"}
                                </span>
                              ) : null}
                              {u.roleName ? <Chip>{u.roleName}</Chip> : null}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {filteredUsers.length > 30 ? (
                  <div className="text-xs text-slate-500">
                    Showing 30 of {filteredUsers.length}. Refine search to narrow.
                  </div>
                ) : null}
              </div>
            </SectionCard>

            {/* Associated Business */}
            <SectionCard
              title="Associated Business"
              actions={
                <Link
                  to="/company/customers"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Open Customers
                </Link>
              }
            >
              <div className="text-sm text-slate-600">
                {selectedUser ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Selected User
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {selectedUser.displayName ||
                          `${selectedUser.firstName || ""} ${selectedUser.lastName || ""}`.trim() ||
                          selectedUser.email ||
                          selectedUser.id}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {selectedUser.email || "No email on file"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      Hook this section to whatever you consider “associated business” for a user:
                      <ul className="mt-2 list-disc pl-5 space-y-1">
                        <li>Customers assigned to the user</li>
                        <li>Service locations managed by the user</li>
                        <li>Routes, stops, or territories</li>
                      </ul>
                      <div className="mt-3 text-xs text-slate-500">
                        (This page keeps functions simple—style first. Add your query once you confirm the collection/path.)
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    Select a user to show their associated business.
                  </div>
                )}
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
                    const d =
                      safeDate(wl.dateCreated) ||
                      safeDate(wl.date) ||
                      safeDate(wl.createdAt) ||
                      safeDate(wl.workDate);

                    const dateLabel = d ? format(d, "PPP") : "Unknown date";

                    const title =
                      wl.title ||
                      wl.summary ||
                      wl.taskName ||
                      wl.type ||
                      "Work Log";

                    const who =
                      wl.techName ||
                      wl.userName ||
                      wl.createdByName ||
                      (wl.userId || wl.techId || wl.employeeId ? "Assigned" : "Unknown");

                    const minutes =
                      typeof wl.minutes === "number"
                        ? wl.minutes
                        : typeof wl.durationMinutes === "number"
                          ? wl.durationMinutes
                          : null;

                    const durationLabel =
                      minutes != null ? `${(minutes / 60).toFixed(2)} hr` : null;

                    return (
                      <RowLink key={wl.id} to={`/company/workLogs/details/${wl.id}`}>
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
