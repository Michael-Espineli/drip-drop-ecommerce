import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const permissionsList = [
  { id: "0", name: "Operations", description: "Can See the Operations Tabs", category: "Operations" },
  { id: "10", name: "Customer", description: "", category: "Operations" },
  { id: "12", name: "Create Customer", description: "", category: "Operations" },
  { id: "14", name: "Update Customer", description: "", category: "Operations" },
  { id: "16", name: "Delete Customer", description: "", category: "Operations" },
  { id: "20", name: "Jobs", description: "", category: "Operations" },
  { id: "22", name: "Create Jobs", description: "", category: "Operations" },
  { id: "24", name: "Update Jobs", description: "", category: "Operations" },
  { id: "26", name: "Delete Jobs", description: "", category: "Operations" },
  { id: "30", name: "Repair Requests", description: "", category: "Operations" },
  { id: "32", name: "Create Repair Requests", description: "", category: "Operations" },
  { id: "34", name: "Update Repair Requests", description: "", category: "Operations" },
  { id: "36", name: "Delete Repair Requests", description: "", category: "Operations" },
  { id: "40", name: "Service Location", description: "", category: "Operations" },
  { id: "42", name: "Create Service Location", description: "", category: "Operations" },
  { id: "44", name: "Update Service Location", description: "", category: "Operations" },
  { id: "46", name: "Delete Service Location", description: "", category: "Operations" },
  { id: "50", name: "Bodies of Water", description: "", category: "Operations" },
  { id: "52", name: "Create Bodies of Water", description: "", category: "Operations" },
  { id: "54", name: "Update Bodies of Water", description: "", category: "Operations" },
  { id: "56", name: "Delete Bodies of Water", description: "", category: "Operations" },
  { id: "60", name: "Equipment", description: "", category: "Operations" },
  { id: "62", name: "Create Equipment", description: "", category: "Operations" },
  { id: "64", name: "Update Equipment", description: "", category: "Operations" },
  { id: "66", name: "Delete Equipment", description: "", category: "Operations" },

  { id: "200", name: "Management", description: "", category: "Operations" },
  { id: "210", name: "Route Over View", description: "", category: "Management" },
  { id: "220", name: "Live Route Access", description: "", category: "Management" },
  { id: "230", name: "Routes", description: "", category: "Management" },
  { id: "232", name: "Create Routes", description: "", category: "Management" },
  { id: "234", name: "Update Routes", description: "", category: "Management" },
  { id: "236", name: "Delete Routes", description: "", category: "Management" },
  { id: "240", name: "ServiceStops", description: "", category: "Management" },
  { id: "242", name: "Create Service Stops", description: "", category: "Management" },
  { id: "244", name: "Update Service Stops", description: "", category: "Management" },
  { id: "246", name: "Delete Service Stops", description: "", category: "Management" },
  { id: "250", name: "ServiceStops For Others", description: "", category: "Management" },
  { id: "252", name: "Create Service Stops For Others", description: "", category: "Management" },
  { id: "254", name: "Update Service Stops For Others", description: "", category: "Management" },
  { id: "256", name: "Delete Service Stops For Others", description: "", category: "Management" },
  { id: "260", name: "Company Users", description: "", category: "Management" },
  { id: "262", name: "Create Company Users", description: "", category: "Management" },
  { id: "264", name: "Update Company Users", description: "", category: "Management" },
  { id: "266", name: "Delete Company Users", description: "", category: "Management" },
  { id: "280", name: "WorkLogs", description: "", category: "Management" },
  { id: "282", name: "Create Work Logs", description: "", category: "Management" },
  { id: "284", name: "Update Work Logs", description: "", category: "Management" },
  { id: "286", name: "Delete Work Logs", description: "", category: "Management" },
  { id: "290", name: "Fleet", description: "", category: "Management" },
  { id: "292", name: "Create Fleet", description: "", category: "Management" },
  { id: "294", name: "Update Fleet", description: "", category: "Management" },
  { id: "296", name: "Delete Fleet", description: "", category: "Management" },

  { id: "400", name: "Finance", description: "", category: "Finance" },
  { id: "410", name: "Finished Jobs", description: "", category: "Finance" },
  { id: "412", name: "Create Finished Jobs", description: "", category: "Finance" },
  { id: "414", name: "Update Finished Jobs", description: "", category: "Finance" },
  { id: "416", name: "Delete Finished Jobs", description: "", category: "Finance" },

  { id: "600", name: "Marketing", description: "", category: "Marketing" },
  { id: "610", name: "Leads", description: "", category: "Marketing" },
  { id: "612", name: "Respond Leads", description: "", category: "Marketing" },
  { id: "614", name: "Update Leads", description: "", category: "Marketing" },
  { id: "616", name: "Delete Leads", description: "", category: "Marketing" },
  { id: "620", name: "Estimates", description: "", category: "Marketing" },
  { id: "622", name: "Respond Estimates", description: "", category: "Marketing" },
  { id: "624", name: "Update Estimates", description: "", category: "Marketing" },
  { id: "626", name: "Delete Estimates", description: "", category: "Marketing" },

  { id: "800", name: "Settings", description: "", category: "Settings" },
  { id: "810", name: "Company Information", description: "", category: "Settings" },
  { id: "812", name: "Create Company Information", description: "", category: "Settings" },
  { id: "814", name: "Update Company Information", description: "", category: "Settings" },
  { id: "816", name: "Delete Company Information", description: "", category: "Settings" },
  { id: "820", name: "Task Groups", description: "", category: "Settings" },
  { id: "822", name: "Create Task Groups", description: "", category: "Settings" },
  { id: "824", name: "Update Task Groups", description: "", category: "Settings" },
  { id: "826", name: "Delete Task Groups", description: "", category: "Settings" },
  { id: "830", name: "Email Configuration", description: "", category: "Settings" },
  { id: "832", name: "Create Email Configuration", description: "", category: "Settings" },
  { id: "834", name: "Update Email Configuration", description: "", category: "Settings" },
  { id: "836", name: "Delete Email Configuration", description: "", category: "Settings" },
  { id: "840", name: "Readings and Dosages", description: "", category: "Settings" },
  { id: "842", name: "Create Readings and Dosages", description: "", category: "Settings" },
  { id: "844", name: "Update Readings and Dosages", description: "", category: "Settings" },
  { id: "846", name: "Delete Readings and Dosages", description: "", category: "Settings" },
  { id: "850", name: "Database Items", description: "", category: "Settings" },
  { id: "852", name: "Create Database Items", description: "", category: "Settings" },
  { id: "854", name: "Update Database Items", description: "", category: "Settings" },
  { id: "856", name: "Delete Database Items", description: "", category: "Settings" },
  { id: "860", name: "User Roles", description: "", category: "Settings" },
  { id: "862", name: "Create User Roles", description: "", category: "Settings" },
  { id: "864", name: "Update User Roles", description: "", category: "Settings" },
  { id: "866", name: "Delete User Roles", description: "", category: "Settings" },
  { id: "870", name: "Reports", description: "", category: "Settings" },
  { id: "872", name: "Create Reports", description: "", category: "Settings" },
  { id: "874", name: "Update Reports", description: "", category: "Settings" },
  { id: "876", name: "Delete Reports", description: "", category: "Settings" },
  { id: "880", name: "Terms Templates", description: "", category: "Settings" },
  { id: "882", name: "Create Terms Templates", description: "", category: "Settings" },
  { id: "884", name: "Update Terms Templates", description: "", category: "Settings" },
  { id: "886", name: "Delete Terms Templates", description: "", category: "Settings" },
  { id: "890", name: "Manage Subscriptions", description: "", category: "Settings" },
  { id: "892", name: "Create Manage Subscriptions", description: "", category: "Settings" },
  { id: "894", name: "Update Manage Subscriptions", description: "", category: "Settings" },
  { id: "896", name: "Delete Manage Subscriptions", description: "", category: "Settings" }
];

const permissionsByCategory = permissionsList.reduce((acc, permission) => {
  if (!acc[permission.category]) acc[permission.category] = [];
  acc[permission.category].push(permission);
  return acc;
}, {});

const RoleDetails = () => {
  const { recentlySelectedCompany } = useContext(Context);
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
              <button
                onClick={() => setEditMode(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
              >
                Edit
              </button>
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
