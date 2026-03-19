import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import { useNavigate } from "react-router-dom";
import { Context } from "../../../context/AuthContext";

const Roles = () => {
  const navigate = useNavigate();
  const [roleList, setRoleList] = useState([]);
  const { name, recentlySelectedCompany } = useContext(Context);

  useEffect(() => {
    (async () => {
      try {
        let q = query(collection(db, "companies", recentlySelectedCompany, "roles"));
        const querySnapshot = await getDocs(q);
        setRoleList([]);
        querySnapshot.forEach((doc) => {
          const roleData = doc.data();
          const role = {
            id: roleData.id,
            color: roleData.color,
            description: roleData.description,
            listOfUserIdsToManage: roleData.listOfUserIdsToManage,
            name: roleData.name,
            permissionIdList: roleData.permissionIdList,
          };
          setRoleList((roleList) => [...roleList, role]);
        });
      } catch (error) {
        console.log("Error");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Roles</h2>
            <p className="text-sm text-slate-500 mt-1">
              View and manage your company roles{recentlySelectedCompany ? "." : "."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-medium">Active Company</span>
              <span className="text-slate-400">•</span>
              <span className="truncate max-w-[220px]">{name || "—"}</span>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Role Name</div>
              <div className="text-sm text-slate-500">{roleList.length} total</div>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-200">
            {roleList?.map((role) => (
              <button
                key={role.id}
                onClick={() => navigate(`/company/roles/${role.id}`)}
                className="w-full text-left px-5 py-4 hover:bg-slate-50 transition flex items-center gap-4"
              >
                {/* Color dot */}
                <span
                  className="h-3 w-3 rounded-full border border-slate-200 shrink-0"
                  style={{ backgroundColor: role.color || "#94a3b8" }}
                />

                {/* Main */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-slate-900 truncate">{role.name}</div>
                    {role.permissionIdList?.length ? (
                      <span className="text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                        {role.permissionIdList.length} perms
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                        No perms
                      </span>
                    )}
                  </div>

                  {role.description ? (
                    <div className="text-sm text-slate-500 truncate mt-0.5">
                      {role.description}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400 truncate mt-0.5">
                      No description
                    </div>
                  )}
                </div>

                {/* Chevron */}
                <div className="text-slate-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L10.94 10 7.23 6.29a.75.75 0 111.06-1.06l4.24 4.24a.75.75 0 010 1.06l-4.24 4.24a.75.75 0 01-1.06.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </button>
            ))}

            {/* Empty state */}
            {(!roleList || roleList.length === 0) && (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto max-w-sm">
                  <div className="text-sm font-semibold text-slate-800">No roles found</div>
                  <div className="text-sm text-slate-500 mt-1">
                    Roles will appear here once they’re created.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile hint */}
        <div className="text-xs text-slate-500">
          Tip: Click a role to view details and permissions.
        </div>
      </div>
    </div>
  );
};

export default Roles;
