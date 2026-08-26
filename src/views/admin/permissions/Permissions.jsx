import React, { useMemo, useState } from "react";
import {
  CheckCircleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  companyPermissionCategoryGroups,
  companyPermissions,
} from "../../../utils/companyPermissions";

const ADMIN_YELLOW = "#efb12f";

const categoryDescriptions = {
  Operations: "Customer, job, repair, location, equipment, and daily operations access.",
  Management: "Routing, service stop, company user, fleet, messaging, todo, and offered work controls.",
  Finance: "Financial workspace access, billing records, job financials, and payroll visibility.",
  Marketing: "Lead, estimate, and customer pipeline access.",
  Settings: "Company setup, catalogs, reports, templates, subscriptions, uploads, and role configuration.",
};

const childPermissionPrefixes = [
  "Create",
  "Update",
  "Delete",
  "Respond",
  "Split",
  "Incentivize",
  "Approve",
  "View All",
  "Accept",
  "Schedule",
  "Edit",
];

const permissionStatusFilters = [
  { id: "all", label: "All" },
  { id: "web", label: "Web Guarded" },
  { id: "ios", label: "iOS Guarded" },
];

function getActionPrefix(name = "") {
  return childPermissionPrefixes.find((prefix) =>
    name.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
  );
}

function stripActionPrefix(name = "") {
  const prefix = getActionPrefix(name);
  return prefix ? name.slice(prefix.length).trim() : name;
}

function sentenceCase(value = "") {
  if (!value) return value;
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function generatedDescription(permission) {
  const name = permission.name || "this area";
  const subject = stripActionPrefix(name);
  const subjectText = sentenceCase(subject);
  const action = getActionPrefix(name);

  if (action === "Create") return `Can add new ${subjectText} records or configuration for the company.`;
  if (action === "Update" || action === "Edit") return `Can edit existing ${subjectText} records or configuration.`;
  if (action === "Delete") return `Can remove existing ${subjectText} records or configuration.`;
  if (action === "Respond") return `Can respond to ${subjectText} and move that workflow forward.`;
  if (action === "Schedule") return `Can schedule ${subjectText} for available company users.`;
  if (action === "Split") return `Can split ${subjectText} into smaller assignable pieces.`;
  if (action === "Incentivize") return `Can add incentive pay or rewards to ${subjectText}.`;
  if (action === "Approve") return `Can approve ${subjectText} when approval is required.`;
  if (action === "View All") return `Can see all ${subjectText}, including records they are not directly assigned to.`;
  if (action === "Accept") return `Can accept eligible ${subjectText}.`;

  return `Can open and view the ${name} area for the company.`;
}

function permissionDescription(permission) {
  return permission.description?.trim() || generatedDescription(permission);
}

function StatusPill({ active, label }) {
  const Icon = active ? CheckCircleIcon : XCircleIcon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        active
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          : "border-slate-700 bg-slate-900/70 text-slate-500"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function StatCard({ label, value, helper }) {
  return (
    <div className="border border-slate-800/60 bg-slate-900/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

function PermissionRow({ permission, compact = false }) {
  return (
    <div
      className={`grid gap-3 border-t border-slate-800/60 px-4 py-4 first:border-t-0 lg:grid-cols-[88px_minmax(180px,260px)_1fr_190px] ${
        compact ? "bg-slate-900/30 lg:pl-10" : "bg-slate-950"
      }`}
    >
      <div>
        <span className="inline-flex min-w-12 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs font-bold text-slate-300">
          {permission.id}
        </span>
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-100">{permission.name}</h3>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {compact ? "Action permission" : "Area permission"}
        </p>
      </div>

      <p className="text-sm leading-6 text-slate-300">
        {permissionDescription(permission)}
      </p>

      <div className="flex flex-wrap items-start gap-2 lg:justify-end">
        <StatusPill active={permission.web} label="Web" />
        <StatusPill active={permission.ios} label="iOS" />
      </div>
    </div>
  );
}

function PermissionGroup({ group, searchTerm, statusFilter }) {
  const allGroupPermissions = [group.parent, ...group.children];
  const filteredPermissions = allGroupPermissions.filter((permission) => {
    const searchable = [
      permission.id,
      permission.name,
      permission.category,
      permissionDescription(permission),
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !searchTerm || searchable.includes(searchTerm);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "web" && permission.web) ||
      (statusFilter === "ios" && permission.ios);

    return matchesSearch && matchesStatus;
  });

  if (filteredPermissions.length === 0) return null;

  const parentVisible = filteredPermissions.some((permission) => permission.id === group.parent.id);
  const visibleChildren = filteredPermissions.filter((permission) => permission.id !== group.parent.id);

  return (
    <div className="overflow-hidden border border-slate-800/60 bg-slate-950">
      {parentVisible ? <PermissionRow permission={group.parent} /> : null}
      {visibleChildren.map((permission) => (
        <PermissionRow key={permission.id} permission={permission} compact />
      ))}
    </div>
  );
}

function Permissions() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [statusFilter, setStatusFilter] = useState("all");

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const categoryNames = useMemo(
    () => companyPermissionCategoryGroups.map((group) => group.category),
    []
  );

  const visibleCategoryGroups = useMemo(() => {
    return companyPermissionCategoryGroups.filter((group) => {
      if (selectedCategory !== "All" && group.category !== selectedCategory) return false;

      return group.permissions.some((permission) => {
        const searchable = [
          permission.id,
          permission.name,
          permission.category,
          permissionDescription(permission),
        ]
          .join(" ")
          .toLowerCase();

        const matchesSearch = !normalizedSearchTerm || searchable.includes(normalizedSearchTerm);
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "web" && permission.web) ||
          (statusFilter === "ios" && permission.ios);

        return matchesSearch && matchesStatus;
      });
    });
  }, [normalizedSearchTerm, selectedCategory, statusFilter]);

  const totalWebGuarded = companyPermissions.filter((permission) => permission.web).length;
  const totalIosGuarded = companyPermissions.filter((permission) => permission.ios).length;
  const actionPermissionCount = companyPermissions.filter((permission) =>
    Boolean(getActionPrefix(permission.name))
  ).length;

  return (
    <div className="min-h-screen bg-slate-900 px-2 py-5 text-slate-100 md:px-7">
      <div className="w-full border border-slate-800/60 bg-slate-950 p-4 shadow-2xl md:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-md"
                style={{ backgroundColor: `${ADMIN_YELLOW}1f`, color: ADMIN_YELLOW }}
              >
                <ShieldCheckIcon className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: ADMIN_YELLOW }}>
                  Company Role Reference
                </p>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-100">
                  Permissions
                </h1>
              </div>
            </div>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">
              These are the current permission options companies can assign to roles. Role documents store selected
              permissions as a <span className="font-mono text-slate-300">permissionIdList</span>, and each option below
              shows what access it represents plus whether the web app or iOS app currently guards it.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:min-w-[560px]">
            <StatCard label="Options" value={companyPermissions.length} helper="Assignable permissions" />
            <StatCard label="Categories" value={categoryNames.length} helper="Role editor groups" />
            <StatCard label="Web Guarded" value={totalWebGuarded} helper="Checked in React" />
            <StatCard label="Actions" value={actionPermissionCount} helper="Create, update, delete, and workflow controls" />
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto_auto] lg:items-center">
          <label className="relative block">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by ID, permission, category, or description"
              className="w-full rounded-md border border-slate-800/60 bg-slate-900/70 py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30"
            />
          </label>

          <select
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
            className="rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2.5 text-sm font-semibold text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30"
          >
            <option value="All">All Categories</option>
            {categoryNames.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <div className="inline-flex overflow-hidden rounded-md border border-slate-800/60">
            {permissionStatusFilters.map((filter) => {
              const selected = statusFilter === filter.id;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-[#efb12f] text-slate-950"
                      : "bg-slate-900/70 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {visibleCategoryGroups.map((categoryGroup) => (
          <section key={categoryGroup.category} className="border border-slate-800/60 bg-slate-950 shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-slate-800/60 bg-slate-900/50 px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">{categoryGroup.category}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {categoryDescriptions[categoryGroup.category] || "Company role access options."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-300">
                  {categoryGroup.permissions.length} permissions
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-300">
                  {categoryGroup.permissions.filter((permission) => permission.web).length} web guarded
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-300">
                  {categoryGroup.permissions.filter((permission) => permission.ios).length} iOS guarded
                </span>
              </div>
            </div>

            <div className="space-y-3 p-3">
              {categoryGroup.groups.map((group) => (
                <PermissionGroup
                  key={group.parent.id}
                  group={group}
                  searchTerm={normalizedSearchTerm}
                  statusFilter={statusFilter}
                />
              ))}
            </div>
          </section>
        ))}

        {visibleCategoryGroups.length === 0 ? (
          <div className="border border-dashed border-slate-700 bg-slate-950 p-8 text-center text-sm text-slate-400">
            No permissions match the current filters.
          </div>
        ) : null}
      </div>

      <div className="mt-5 border border-slate-800/60 bg-slate-950 p-4 text-sm leading-6 text-slate-400">
        <p>
          Web guarded means the React app currently checks the permission for a route or action. iOS guarded means the
          mobile app has a matching enforcement point. Unguarded options are still assignable to company roles so the
          catalog can stay consistent across apps while enforcement is filled in.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          iOS guarded total: {totalIosGuarded}
        </p>
      </div>
    </div>
  );
}

export default Permissions;
