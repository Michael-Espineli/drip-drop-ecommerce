import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {
  companyPermissions as permissionsList,
  companyPermissionsByCategory as permissionsByCategory
} from "../../../utils/companyPermissions";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const RoleDetails = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const { roleId } = useParams();

  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({});

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
          setRole(roleData);
          setFormData(roleData);
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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePermissionChange = (permissionId) => {
    const currentPermissions = formData.permissionIdList || [];
    const newPermissions = currentPermissions.includes(permissionId)
      ? currentPermissions.filter((id) => id !== permissionId)
      : [...currentPermissions, permissionId];
    setFormData((prev) => ({ ...prev, permissionIdList: newPermissions }));
  };

  const handleSave = async () => {
    if (!requirePermission("864", "update user roles")) return;

    const docRef = doc(db, "companies", recentlySelectedCompany, "roles", roleId);
    try {
      await updateDoc(docRef, formData);
      setRole(formData);
      setEditMode(false);
    } catch (err) {
      setError("Failed to update role.");
      console.error("Error updating role:", err);
    }
  };

  const handleCancel = () => {
    setFormData(role);
    setEditMode(false);
  };

  const getAssignedPermissionsByCategory = () => {
    const assigned = formData.permissionIdList || [];
    return permissionsList.reduce((acc, p) => {
      if (assigned.includes(p.id)) {
        if (!acc[p.category]) acc[p.category] = [];
        acc[p.category].push(p);
      }
      return acc;
    }, {});
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm p-6 text-slate-700">
          Loading...
        </div>
      </div>
    );

  if (error)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white shadow-sm p-6">
          <div className="text-sm font-semibold text-red-700">Error</div>
          <div className="text-sm text-slate-600 mt-1">{error}</div>
        </div>
      </div>
    );

  if (!role)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm p-6 text-slate-700">
          No role data found.
        </div>
      </div>
    );

  const assignedCategorized = getAssignedPermissionsByCategory();

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {editMode ? (
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="w-full sm:w-[520px] text-2xl sm:text-3xl font-semibold tracking-tight bg-white border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {role.name}
              </h2>
            )}
            <p className="text-sm text-slate-500 mt-1">
              Manage role details and assigned permissions.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!editMode ? (
              can("864") && (
              <button
                onClick={() => setEditMode(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
              >
                Edit
              </button>
              )
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 transition border border-slate-200"
                >
                  Cancel
                </button>
              </>
            )}

            <Link
              className="px-4 py-2 rounded-xl bg-white text-slate-700 font-medium hover:bg-slate-50 transition border border-slate-200"
              to={`/Company/roles`}
            >
              Back to Roles
            </Link>
          </div>
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">

          {/* Role Meta */}
          <div className="px-6 py-5 border-b border-slate-200">
            {editMode ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    Description
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    className="w-full mt-2 min-h-[96px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    Color
                  </label>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="color"
                      name="color"
                      value={formData.color}
                      onChange={handleInputChange}
                      className="h-10 w-14 rounded-lg border border-slate-200 bg-white"
                    />
                    <div className="text-sm text-slate-600">
                      <span className="font-medium">Selected:</span>{" "}
                      <span className="font-mono" style={{ color: formData.color }}>
                        {formData.color}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Description
                  </div>
                  <div className="text-sm text-slate-700 mt-1">
                    {role.description || "—"}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Color
                  </div>
                  <div className="text-sm mt-1 flex items-center gap-2">
                    <span
                      className="inline-flex h-3 w-3 rounded-full border border-slate-200"
                      style={{ backgroundColor: role.color }}
                    />
                    <span className="font-mono" style={{ color: role.color }}>
                      {role.color}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Permissions */}
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Permissions</h3>
              <div className="text-sm text-slate-500">
                {editMode ? "Select permissions to assign." : "Assigned permissions by category."}
              </div>
            </div>

            <div className="mt-4">
              {editMode ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.keys(permissionsByCategory).map((category) => (
                    <div
                      key={category}
                      className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                        <h4 className="font-semibold text-slate-800">{category}</h4>
                      </div>

                      <div className="p-4 space-y-2">
                        {permissionsByCategory[category].map((p) => (
                          <label
                            key={p.id}
                            htmlFor={`perm-${p.id}`}
                            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 transition cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              id={`perm-${p.id}`}
                              checked={(formData.permissionIdList || []).includes(p.id)}
                              onChange={() => handlePermissionChange(p.id)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800">
                                {p.name}
                              </div>
                              {p.description ? (
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {p.description}
                                </div>
                              ) : null}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.keys(assignedCategorized).length > 0 ? (
                    Object.keys(assignedCategorized).map((category) => (
                      <div
                        key={category}
                        className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                          <h4 className="font-semibold text-slate-800">{category}</h4>
                        </div>

                        <div className="p-4 flex flex-wrap gap-2">
                          {assignedCategorized[category].map((p) => (
                            <span
                              key={p.id}
                              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 text-slate-600">
                      No permissions assigned.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default RoleDetails;
