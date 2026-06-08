import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import {
  ArrowLeftIcon,
  CheckIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  SwatchIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {
  companyPermissionCategoryGroups,
  getCategorySelectionState,
  getPermissionSelectionState,
  normalizePermissionSelection,
  togglePermissionCategorySelection,
  togglePermissionSelection,
} from "../../../utils/companyPermissions";
import { getCustomerTagOptions, normalizeCustomerTag, normalizeCustomerTags } from "../../../utils/customerTags";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const safeColorValue = (value) =>
  /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#0ea5e9";

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

  const handleSave = async () => {
    if (!requirePermission("864", "update user roles")) return;

    const payload = {
      ...formData,
      permissionIdList: normalizePermissionSelection(formData.permissionIdList || []),
      customerTagAccess: normalizeCustomerTags(formData.customerTagAccess || []),
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
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-white shadow-sm"
              style={{ backgroundColor: formData.color || role.color || "#0ea5e9" }}
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
                <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {role.name}
                </h1>
              )}
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                {editMode
                  ? "Update the role details, select categories, or tune individual permission groups."
                  : role.description || "Review assigned permissions by category."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!editMode ? (
              can("864") && (
                <button
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  <PencilSquareIcon className="h-4 w-4" />
                  Edit
                </button>
              )
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  <CheckIcon className="h-4 w-4" />
                  Save
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

            <Link
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              to="/company/roles"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Roles
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase text-slate-500">Role Details</h2>

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

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase text-slate-500">Coverage</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric label="Selected" value={selectedPermissionIds.length} />
                <Metric
                  label="Available"
                  value={companyPermissionCategoryGroups.reduce(
                    (total, group) => total + group.permissions.length,
                    0
                  )}
                />
              </div>
            </section>

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
          </aside>

          <main className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Permissions</h2>
                <p className="text-sm text-slate-500">
                  {editMode
                    ? "Use category controls for broad access, or select view and action permissions one by one."
                    : "Assigned access is organized by category and permission group."}
                </p>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                <SwatchIcon className="h-4 w-4" />
                {selectedPermissionIds.length} selected
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {companyPermissionCategoryGroups.map((categoryGroup) =>
                editMode ? (
                  <EditablePermissionCategory
                    key={categoryGroup.category}
                    categoryGroup={categoryGroup}
                    selectedIds={selectedPermissionIds}
                    onToggleCategory={handleCategoryChange}
                    onTogglePermission={handlePermissionChange}
                  />
                ) : (
                  <ReadOnlyPermissionCategory
                    key={categoryGroup.category}
                    categoryGroup={categoryGroup}
                    selectedIds={selectedPermissionIds}
                  />
                )
              )}
            </div>
          </main>
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
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-500">Customer Tag Visibility</h2>
          <p className="mt-1 text-sm text-slate-500">
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

const EditablePermissionCategory = ({
  categoryGroup,
  selectedIds,
  onToggleCategory,
  onTogglePermission,
}) => {
  const state = getCategorySelectionState(categoryGroup, selectedIds);
  const selectedCount = categoryGroup.permissions.filter((permission) =>
    selectedIds.includes(permission.id)
  ).length;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h3 className="font-semibold text-slate-900">{categoryGroup.category}</h3>
          <p className="text-xs text-slate-500">
            {selectedCount}/{categoryGroup.permissions.length} selected
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggleCategory(categoryGroup.category)}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
            state === "selected"
              ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {state === "selected" ? "Clear" : "Select All"}
        </button>
      </div>

      <div className="space-y-3 p-3">
        {categoryGroup.groups.map((group) => (
          <PermissionGroupEditor
            key={group.parent.id}
            group={group}
            selectedIds={selectedIds}
            onTogglePermission={onTogglePermission}
          />
        ))}
      </div>
    </section>
  );
};

const PermissionGroupEditor = ({ group, selectedIds, onTogglePermission }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <PermissionCheckRow
      permission={group.parent}
      selectedIds={selectedIds}
      onTogglePermission={onTogglePermission}
      isParent={group.children.length > 0}
    />

    {group.children.length > 0 ? (
      <div className="mt-3 space-y-2 border-l border-slate-200 pl-4">
        {group.children.map((child) => (
          <PermissionCheckRow
            key={child.id}
            permission={child}
            selectedIds={selectedIds}
            onTogglePermission={onTogglePermission}
            compact
          />
        ))}
      </div>
    ) : null}
  </div>
);

const PermissionCheckRow = ({ permission, selectedIds, onTogglePermission, isParent = false, compact = false }) => {
  const state = getPermissionSelectionState(permission, selectedIds);
  const isChecked = state === "selected";
  const isPartial = state === "partial";

  return (
    <label
      htmlFor={`perm-${permission.id}`}
      className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50 ${
        isPartial ? "bg-blue-50" : ""
      }`}
    >
      <input
        type="checkbox"
        id={`perm-${permission.id}`}
        checked={isChecked}
        onChange={() => onTogglePermission(permission.id)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${compact ? "text-slate-700" : "text-slate-900"}`}>
          {permission.name}
          {isPartial ? <span className="ml-2 text-xs font-semibold text-blue-600">Partial</span> : null}
        </div>
        {permission.description ? (
          <div className="mt-0.5 text-xs text-slate-500">{permission.description}</div>
        ) : null}
      </div>
      {isParent ? (
        <span className="mt-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
          View
        </span>
      ) : null}
    </label>
  );
};

const ReadOnlyPermissionCategory = ({ categoryGroup, selectedIds }) => {
  const selectedGroups = categoryGroup.groups
    .map((group) => ({
      ...group,
      parentSelected: selectedIds.includes(group.parent.id),
      selectedChildren: group.children.filter((child) => selectedIds.includes(child.id)),
    }))
    .filter((group) => group.parentSelected || group.selectedChildren.length > 0);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h3 className="font-semibold text-slate-900">{categoryGroup.category}</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {selectedGroups.length} groups
        </span>
      </div>

      <div className="space-y-3 p-3">
        {selectedGroups.length > 0 ? (
          selectedGroups.map((group) => (
            <div key={group.parent.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900">{group.parent.name}</div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  {group.parentSelected ? "View" : "Actions"}
                </span>
              </div>

              {group.selectedChildren.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {group.selectedChildren.map((child) => (
                    <span
                      key={child.id}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {child.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No permissions assigned in this category.
          </div>
        )}
      </div>
    </section>
  );
};

export default RoleDetails;
