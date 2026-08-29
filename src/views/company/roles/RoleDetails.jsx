import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import {
  ArrowLeftIcon,
  CheckIcon,
  MinusIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  SwatchIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {
  OFFERED_WORK_PERMISSION_ID,
  companyPermissionCategoryGroups,
  getCategorySelectionState,
  normalizePermissionSelection,
  togglePermissionCategorySelection,
  togglePermissionSelection,
} from "../../../utils/companyPermissions";
import { getCustomerTagOptions, normalizeCustomerTag, normalizeCustomerTags } from "../../../utils/customerTags";
import {
  DASHBOARD_SCOPE_ACCESS_OPTIONS,
  getDashboardScopeAccessList,
  normalizeDashboardScopeAccess,
} from "../../../utils/dashboardAccess";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const safeColorValue = (value) =>
  /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#0ea5e9";

const permissionActionColumns = [
  { key: "view", label: "View", helper: "Open or see this area" },
  { key: "create", label: "Create", helper: "Add new records" },
  { key: "update", label: "Update", helper: "Change existing records" },
  { key: "delete", label: "Delete", helper: "Remove records" },
  { key: "special", label: "Special", helper: "Workflow-specific actions" },
];

const actionPrefixColumnMap = [
  ["Create", "create"],
  ["Schedule", "create"],
  ["Update", "update"],
  ["Edit", "update"],
  ["Delete", "delete"],
];

const labelPrefixes = [
  "Create",
  "Schedule",
  "Update",
  "Edit",
  "Delete",
  "Respond",
  "Split",
  "Incentivize",
  "Approve",
  "View All",
  "Accept",
];

const getPermissionActionColumnKey = (permission) => {
  const permissionName = permission?.name || "";
  const match = actionPrefixColumnMap.find(([prefix]) =>
    permissionName.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
  );

  return match?.[1] || "special";
};

const getStandalonePermissionColumnKey = (permission) => {
  const permissionName = permission?.name || "";
  if (/^view(?: all)?\s/i.test(permissionName)) return "view";
  return getPermissionActionColumnKey(permission);
};

const normalizeLabelText = (value = "") =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const formatCompactPermissionLabel = (permission, parent, fallbackLabel) => {
  const permissionName = permission?.name || fallbackLabel;
  if (permission?.id && permission.id === parent?.id) return fallbackLabel;

  const matchedPrefix = labelPrefixes.find((prefix) =>
    permissionName.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
  );

  if (!matchedPrefix) return fallbackLabel;

  const remainder = permissionName.slice(matchedPrefix.length).trim();
  if (!remainder || normalizeLabelText(remainder) === normalizeLabelText(parent?.name)) {
    return matchedPrefix;
  }

  return remainder;
};

const categoryAnchorId = (category = "") =>
  `role-permissions-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const getCategoryPermissionCount = (categoryGroup, selectedIds = []) =>
  categoryGroup.permissions.filter((permission) => selectedIds.includes(permission.id)).length;

const createEmptyPermissionCells = () =>
  permissionActionColumns.reduce((acc, column) => {
    acc[column.key] = [];
    return acc;
  }, {});

const createPermissionRow = ({
  id,
  label,
  description,
  parentPermission,
  permissions,
  cells,
  isSubRow = false,
}) => ({
  id,
  label,
  description,
  parentPermission,
  permissions,
  cells,
  isSubRow,
  totalCount: permissions.length,
});

const getStandardPermissionRow = (group) => {
  const cells = createEmptyPermissionCells();

  if (group.children.length === 0) {
    cells[getStandalonePermissionColumnKey(group.parent)].push(group.parent);
  } else {
    cells.view.push(group.parent);

    group.children.forEach((child) => {
      cells[getPermissionActionColumnKey(child)].push(child);
    });
  }

  return createPermissionRow({
    id: group.parent.id,
    label: group.parent.name,
    description: group.parent.description,
    parentPermission: group.parent,
    permissions: [group.parent, ...group.children],
    cells,
  });
};

const getOfferedWorkRows = (group) => {
  const standardChildren = group.children.filter(
    (child) => getPermissionActionColumnKey(child) !== "special"
  );
  const specialChildren = group.children.filter(
    (child) => getPermissionActionColumnKey(child) === "special"
  );

  const mainCells = createEmptyPermissionCells();
  mainCells.view.push(group.parent);
  standardChildren.forEach((child) => {
    mainCells[getPermissionActionColumnKey(child)].push(child);
  });

  return [
    createPermissionRow({
      id: group.parent.id,
      label: group.parent.name,
      description: group.parent.description,
      parentPermission: group.parent,
      permissions: [group.parent, ...standardChildren],
      cells: mainCells,
    }),
    ...specialChildren.map((child) => {
      const childCells = createEmptyPermissionCells();
      childCells.special.push(child);

      return createPermissionRow({
        id: child.id,
        label: child.name,
        description: child.description,
        parentPermission: group.parent,
        permissions: [child],
        cells: childCells,
        isSubRow: true,
      });
    }),
  ];
};

const getPermissionRows = (categoryGroup) =>
  categoryGroup.groups.flatMap((group) => {
    if (group.parent.id === OFFERED_WORK_PERMISSION_ID) {
      return getOfferedWorkRows(group);
    }

    return getStandardPermissionRow(group);
  });

const getAllPermissionRowsByCategory = () =>
  companyPermissionCategoryGroups.map((categoryGroup) => ({
    categoryGroup,
    rows: getPermissionRows(categoryGroup),
  }));

const getRoleScopeLabel = (tags = []) => {
  const normalizedTags = normalizeCustomerTags(tags);
  if (normalizedTags.length === 0) return "All customer tags";
  if (normalizedTags.length === 1) return "1 customer tag";
  return `${normalizedTags.length} customer tags`;
};

const getDashboardScopeLabel = (scopes) => {
  const normalizedScopes = normalizeDashboardScopeAccess(scopes);
  if (normalizedScopes.length === 1) return "1 dashboard view";
  return `${normalizedScopes.length} dashboard views`;
};

const RoleDetails = () => {
  const { recentlySelectedCompany, companyRole, setCompanyRole } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const { roleId } = useParams();

  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({});
  const [availableCustomerTags, setAvailableCustomerTags] = useState([]);
  const [newCustomerTag, setNewCustomerTag] = useState("");

  useEffect(() => {
    if (!recentlySelectedCompany || !roleId) {
      setError("Company or Role ID is missing.");
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      setLoading(true);
      try {
        const docRef = doc(db, "companies", recentlySelectedCompany, "roles", roleId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const roleData = docSnap.data();
          const normalizedRole = {
            ...roleData,
            permissionIdList: normalizePermissionSelection(roleData.permissionIdList || []),
            customerTagAccess: normalizeCustomerTags(roleData.customerTagAccess || []),
            dashboardScopeAccess: getDashboardScopeAccessList(roleData),
          };
          setRole(normalizedRole);
          setFormData(normalizedRole);
        } else {
          setError("Role not found.");
        }
      } catch (err) {
        setError("Failed to fetch role data.");
        console.error("Error fetching role:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [recentlySelectedCompany, roleId]);

  useEffect(() => {
    if (!recentlySelectedCompany) return;

    const fetchCustomerTags = async () => {
      try {
        const customerSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "customers"));
        const customers = customerSnap.docs.map((customerDoc) => ({
          id: customerDoc.id,
          ...customerDoc.data(),
        }));
        setAvailableCustomerTags(getCustomerTagOptions(customers));
      } catch (err) {
        console.error("Error fetching customer tags:", err);
      }
    };

    fetchCustomerTags();
  }, [recentlySelectedCompany]);

  const selectedPermissionIds = formData.permissionIdList || [];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePermissionChange = (permissionId) => {
    setFormData((prev) => ({
      ...prev,
      permissionIdList: togglePermissionSelection(permissionId, prev.permissionIdList || []),
    }));
  };

  const handleCategoryChange = (category) => {
    setFormData((prev) => ({
      ...prev,
      permissionIdList: togglePermissionCategorySelection(category, prev.permissionIdList || []),
    }));
  };

  const handleCustomerTagAccessToggle = (tag) => {
    setFormData((prev) => {
      const currentTags = normalizeCustomerTags(prev.customerTagAccess || []);
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag];

      return {
        ...prev,
        customerTagAccess: normalizeCustomerTags(nextTags),
      };
    });
  };

  const handleAddCustomerTagAccess = () => {
    const tagToAdd = normalizeCustomerTag(newCustomerTag);
    if (!tagToAdd) return;

    setAvailableCustomerTags((currentTags) => normalizeCustomerTags([...currentTags, tagToAdd]).sort((a, b) => a.localeCompare(b)));
    setFormData((prev) => ({
      ...prev,
      customerTagAccess: normalizeCustomerTags([...(prev.customerTagAccess || []), tagToAdd]),
    }));
    setNewCustomerTag("");
  };

  const handleClearCustomerTagAccess = () => {
    setFormData((prev) => ({ ...prev, customerTagAccess: [] }));
  };

  const handleDashboardScopeAccessToggle = (scopeId) => {
    setFormData((prev) => {
      const currentScopes = normalizeDashboardScopeAccess(prev.dashboardScopeAccess);
      if (currentScopes.length === 1 && currentScopes.includes(scopeId)) return prev;
      const nextScopes = currentScopes.includes(scopeId)
        ? currentScopes.filter((currentScopeId) => currentScopeId !== scopeId)
        : [...currentScopes, scopeId];

      return {
        ...prev,
        dashboardScopeAccess: normalizeDashboardScopeAccess(nextScopes),
      };
    });
  };

  const handleSave = async () => {
    if (!requirePermission("864", "update user roles")) return;

    const payload = {
      ...formData,
      permissionIdList: normalizePermissionSelection(formData.permissionIdList || []),
      customerTagAccess: normalizeCustomerTags(formData.customerTagAccess || []),
      dashboardScopeAccess: normalizeDashboardScopeAccess(formData.dashboardScopeAccess),
    };

    const docRef = doc(db, "companies", recentlySelectedCompany, "roles", roleId);
    try {
      await updateDoc(docRef, payload);
      setRole(payload);
      setFormData(payload);
      if (companyRole?.id === roleId) {
        setCompanyRole({ ...payload, id: roleId });
      }
      setEditMode(false);
    } catch (err) {
      setError("Failed to update role.");
      console.error("Error updating role:", err);
    }
  };

  const handleCancel = () => {
    setFormData(role);
    setNewCustomerTag("");
    setEditMode(false);
  };

  if (loading) {
    return <CenteredState title="Loading role..." />;
  }

  if (error) {
    return <CenteredState title="Error" message={error} tone="error" />;
  }

  if (!role) {
    return <CenteredState title="No role data found." />;
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/company/roles" className="app-back-link">
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to Roles
                </Link>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {selectedPermissionIds.length} permissions
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {getDashboardScopeLabel(formData.dashboardScopeAccess)}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {getRoleScopeLabel(formData.customerTagAccess)}
                </span>
              </div>

              <div className="mt-3 flex min-w-0 items-start gap-4">
                <div
                  className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-white shadow-sm"
                  style={{ backgroundColor: safeColorValue(formData.color || role.color) }}
                >
                  <ShieldCheckIcon className="h-6 w-6" />
                </div>

                <div className="min-w-0">
                  {editMode ? (
                    <input
                      type="text"
                      name="name"
                      value={formData.name || ""}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-2xl font-semibold tracking-tight text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-[520px]"
                    />
                  ) : (
                    <h1 className="truncate text-3xl font-bold tracking-tight text-slate-950">
                      {role.name}
                    </h1>
                  )}
                  <p className="mt-2 max-w-3xl text-sm text-slate-600">
                    {editMode
                      ? "Update the role profile and adjust access by category, row, or workflow action."
                      : role.description || "Review this role's permission coverage, customer visibility, and dashboard access."}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {!editMode ? (
                can("864") && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                    Edit Role
                  </button>
                )
              ) : (
                <>
                  <button
                    onClick={handleSave}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    <CheckIcon className="h-4 w-4" />
                    Save Role
                  </button>
                  <button
                    onClick={handleCancel}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    <XMarkIcon className="h-4 w-4" />
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeader title="Role Details" />

              {editMode ? (
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Description</span>
                    <textarea
                      name="description"
                      value={formData.description || ""}
                      onChange={handleInputChange}
                      className="mt-2 min-h-[120px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Color</span>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="color"
                        name="color"
                        value={safeColorValue(formData.color)}
                        onChange={handleInputChange}
                        className="h-11 w-14 rounded-lg border border-slate-200 bg-white"
                      />
                      <span className="font-mono text-sm text-slate-600">
                        {safeColorValue(formData.color)}
                      </span>
                    </div>
                  </label>
                </div>
              ) : (
                <dl className="mt-4 space-y-4 text-sm">
                  <div>
                    <dt className="font-semibold text-slate-500">Description</dt>
                    <dd className="mt-1 text-slate-800">{role.description || "No description"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">Color</dt>
                    <dd className="mt-1 flex items-center gap-2 text-slate-800">
                      <span
                        className="h-4 w-4 rounded border border-slate-200"
                        style={{ backgroundColor: role.color || "#0ea5e9" }}
                      />
                      <span className="font-mono">{role.color || "Default"}</span>
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <PermissionCoverageSection selectedIds={selectedPermissionIds} />

            <CustomerTagAccessSection
              editMode={editMode}
              availableTags={availableCustomerTags}
              selectedTags={formData.customerTagAccess || []}
              newTag={newCustomerTag}
              onNewTagChange={setNewCustomerTag}
              onAddTag={handleAddCustomerTagAccess}
              onClearTags={handleClearCustomerTagAccess}
              onToggleTag={handleCustomerTagAccessToggle}
            />

            <DashboardScopeAccessSection
              editMode={editMode}
              selectedScopes={formData.dashboardScopeAccess}
              onToggleScope={handleDashboardScopeAccessToggle}
            />
          </aside>

          <PermissionMatrixPanel
            editMode={editMode}
            selectedIds={selectedPermissionIds}
            onToggleCategory={handleCategoryChange}
            onTogglePermission={handlePermissionChange}
          />
        </div>
      </div>
    </div>
  );
};

const CenteredState = ({ title, message, tone = "default" }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div
      className={`w-full max-w-md rounded-lg border bg-white p-6 shadow-sm ${
        tone === "error" ? "border-red-200" : "border-slate-200"
      }`}
    >
      <div className={`text-sm font-semibold ${tone === "error" ? "text-red-700" : "text-slate-800"}`}>
        {title}
      </div>
      {message ? <div className="mt-1 text-sm text-slate-600">{message}</div> : null}
    </div>
  </div>
);

const Metric = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <div className="text-2xl font-semibold text-slate-950">{value}</div>
    <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
  </div>
);

const SectionHeader = ({ title, icon: Icon }) => (
  <div className="flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-white">
    {Icon ? <Icon className="h-4 w-4 shrink-0 text-slate-200" /> : null}
    <h2 className="text-sm font-semibold uppercase text-white">{title}</h2>
  </div>
);

const PermissionCoverageSection = ({ selectedIds }) => {
  const totalPermissions = companyPermissionCategoryGroups.reduce(
    (total, group) => total + group.permissions.length,
    0
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeader title="Permission Coverage" icon={Squares2X2Icon} />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="Selected" value={selectedIds.length} />
        <Metric label="Available" value={totalPermissions} />
      </div>

      <div className="mt-5 space-y-2">
        {companyPermissionCategoryGroups.map((categoryGroup) => {
          const selectedCount = getCategoryPermissionCount(categoryGroup, selectedIds);
          const percent = categoryGroup.permissions.length
            ? Math.round((selectedCount / categoryGroup.permissions.length) * 100)
            : 0;

          return (
            <a
              key={categoryGroup.category}
              href={`#${categoryAnchorId(categoryGroup.category)}`}
              className="group block rounded-lg border border-transparent px-2 py-2 transition hover:border-slate-200 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-800">{categoryGroup.category}</span>
                <span className="shrink-0 text-xs font-semibold text-slate-500">
                  {selectedCount}/{categoryGroup.permissions.length}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
};

const CustomerTagAccessSection = ({
  editMode,
  availableTags,
  selectedTags,
  newTag,
  onNewTagChange,
  onAddTag,
  onClearTags,
  onToggleTag,
}) => {
  const normalizedSelectedTags = normalizeCustomerTags(selectedTags);
  const tagOptions = normalizeCustomerTags([...availableTags, ...normalizedSelectedTags]).sort((a, b) => a.localeCompare(b));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SectionHeader title="Customer Tag Visibility" />
          <p className="mt-3 text-sm text-slate-500">
            {normalizedSelectedTags.length
              ? "This role can only view customers with at least one selected tag."
              : "No tag restriction. This role can view all customers allowed by its customer permission."}
          </p>
        </div>
        {editMode && normalizedSelectedTags.length > 0 ? (
          <button
            type="button"
            onClick={onClearTags}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Clear
          </button>
        ) : null}
      </div>

      {editMode ? (
        <div className="mt-4 space-y-4">
          <div className="flex gap-2">
            <input
              value={newTag}
              onChange={(event) => onNewTagChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddTag();
                }
              }}
              placeholder="Add tag, e.g. R1"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={onAddTag}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {tagOptions.map((tag) => {
              const selected = normalizedSelectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selected
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                  }`}
                >
                  {tag}
                </button>
              );
            })}

            {tagOptions.length === 0 ? (
              <span className="text-sm text-slate-500">No customer tags found yet.</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {normalizedSelectedTags.length > 0 ? (
            normalizedSelectedTags.map((tag) => (
              <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {tag}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              All customer tags
            </span>
          )}
        </div>
      )}
    </section>
  );
};

const DashboardScopeAccessSection = ({
  editMode,
  selectedScopes,
  onToggleScope,
}) => {
  const normalizedScopes = normalizeDashboardScopeAccess(selectedScopes);
  const selectedSet = new Set(normalizedScopes);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <SectionHeader title="Dashboard Views" />
        <p className="mt-3 text-sm text-slate-500">
          Choose which dashboard scopes this role can open.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {DASHBOARD_SCOPE_ACCESS_OPTIONS.map((scope) => {
          const selected = selectedSet.has(scope.id);

          if (!editMode) {
            return (
              <div
                key={scope.id}
                className={`rounded-lg border px-3 py-2 ${selected ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50 opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-semibold ${selected ? "text-blue-800" : "text-slate-600"}`}>{scope.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{scope.description}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selected ? "bg-white text-blue-700" : "bg-white text-slate-500"}`}>
                    {selected ? "Allowed" : "Hidden"}
                  </span>
                </div>
              </div>
            );
          }

          return (
            <label
              key={scope.id}
              className={`block cursor-pointer rounded-lg border px-3 py-2 transition ${
                selected
                  ? "border-blue-600 bg-blue-50 text-blue-900"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-blue-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleScope(scope.id)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <span className="block text-sm font-semibold">{scope.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{scope.description}</span>
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
};

const PermissionMatrixPanel = ({
  editMode,
  selectedIds,
  onToggleCategory,
  onTogglePermission,
}) => {
  const rowsByCategory = getAllPermissionRowsByCategory();

  return (
    <main className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-700 bg-slate-800 px-5 py-4 text-white sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Permissions Matrix</h2>
          <p className="mt-1 text-sm text-slate-200">
            {editMode
              ? "Turn on an entire category or tune each access level across the row."
              : "Scan what this role can view, create, update, delete, and do through special workflows."}
          </p>
        </div>

        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm font-semibold text-slate-100">
          <SwatchIcon className="h-4 w-4" />
          {selectedIds.length} selected
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[940px] table-fixed text-left">
          <colgroup>
            <col className="w-[30%]" />
            {permissionActionColumns.map((column) => (
              <col key={column.key} className={column.key === "special" ? "w-[22%]" : "w-[12%]"} />
            ))}
          </colgroup>
          <thead className="border-b border-slate-200 bg-slate-100">
            <tr>
              <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                Area
              </th>
              {permissionActionColumns.map((column) => (
                <th key={column.key} scope="col" className="px-4 py-3 align-top">
                  <span className="block text-xs font-semibold uppercase text-slate-600">{column.label}</span>
                  <span className="mt-1 block text-[11px] font-medium normal-case leading-4 text-slate-400">
                    {column.helper}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {rowsByCategory.map(({ categoryGroup, rows }) => (
              <React.Fragment key={categoryGroup.category}>
                <PermissionMatrixCategoryDivider
                  categoryGroup={categoryGroup}
                  editMode={editMode}
                  selectedIds={selectedIds}
                  onToggleCategory={onToggleCategory}
                />
                {rows.map((row) => (
                  <PermissionMatrixRow
                    key={row.id}
                    row={row}
                    editMode={editMode}
                    selectedIds={selectedIds}
                    onTogglePermission={onTogglePermission}
                  />
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
};

const PermissionMatrixCategoryDivider = ({
  categoryGroup,
  editMode,
  selectedIds,
  onToggleCategory,
}) => {
  const state = getCategorySelectionState(categoryGroup, selectedIds);
  const selectedCount = getCategoryPermissionCount(categoryGroup, selectedIds);

  return (
    <tr id={categoryAnchorId(categoryGroup.category)} className="scroll-mt-6 bg-slate-800">
      <th colSpan={permissionActionColumns.length + 1} scope="rowgroup" className="px-5 py-4 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">{categoryGroup.category}</h3>
            <p className="mt-1 text-sm font-normal text-slate-200">
              {selectedCount} of {categoryGroup.permissions.length} permissions enabled
            </p>
          </div>

          {editMode ? (
            <button
              type="button"
              onClick={() => onToggleCategory(categoryGroup.category)}
              className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                state === "selected"
                  ? "border border-white/25 bg-slate-700 text-white hover:bg-slate-600"
                  : "bg-white text-slate-900 hover:bg-slate-100"
              }`}
            >
              {state === "selected" ? <XMarkIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
              {state === "selected" ? "Clear Category" : "Allow Category"}
            </button>
          ) : null}
        </div>
      </th>
    </tr>
  );
};

const PermissionMatrixRow = ({ row, editMode, selectedIds, onTogglePermission }) => {
  const selectedCount = row.permissions.filter((permission) =>
    selectedIds.includes(permission.id)
  ).length;

  return (
    <tr className={selectedCount > 0 ? "bg-white" : "bg-slate-50/60"}>
      <th scope="row" className="px-5 py-3 align-top">
        <div className={row.isSubRow ? "border-l-2 border-slate-200 pl-3" : ""}>
          <div className={`font-semibold leading-5 ${row.isSubRow ? "text-slate-700" : "text-slate-900"}`}>
            {row.label}
          </div>
          {row.description ? (
            <div className="mt-1 text-xs font-normal leading-5 text-slate-500">
              {row.description}
            </div>
          ) : null}
          <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            {selectedCount}/{row.totalCount} enabled
          </div>
        </div>
      </th>

      {permissionActionColumns.map((column) => (
        <td key={column.key} className="px-4 py-3 align-top">
          <PermissionMatrixCell
            permissions={row.cells[column.key]}
            parent={row.parentPermission}
            column={column}
            editMode={editMode}
            selectedIds={selectedIds}
            onTogglePermission={onTogglePermission}
          />
        </td>
      ))}
    </tr>
  );
};

const PermissionMatrixCell = ({
  permissions,
  parent,
  column,
  editMode,
  selectedIds,
  onTogglePermission,
}) => {
  if (permissions.length === 0) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-300">
        <MinusIcon className="h-4 w-4" />
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {permissions.map((permission) => {
        const selected = selectedIds.includes(permission.id);
        const label = column.key === "view"
          ? "View"
          : formatCompactPermissionLabel(permission, parent, column.label);

        return (
          <PermissionMatrixToken
            key={permission.id}
            permission={permission}
            label={label}
            selected={selected}
            editMode={editMode}
            onTogglePermission={onTogglePermission}
          />
        );
      })}
    </div>
  );
};

const PermissionMatrixToken = ({
  permission,
  label,
  selected,
  editMode,
  onTogglePermission,
}) => {
  const classes = selected
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-slate-200 bg-white text-slate-500";

  if (!editMode) {
    return (
      <span
        title={permission.description || permission.name}
        className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}
      >
        {selected ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <XMarkIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
        <span className="min-w-0 break-words leading-4">{label}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onTogglePermission(permission.id)}
      title={permission.description || permission.name}
      aria-pressed={selected}
      className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
        selected
          ? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700"
          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      }`}
    >
      {selected ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <XMarkIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
      <span className="min-w-0 break-words leading-4">{label}</span>
    </button>
  );
};

export default RoleDetails;
