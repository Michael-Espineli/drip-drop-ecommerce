import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  BuildingOffice2Icon,
  ShieldCheckIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const Roles = () => {
  const navigate = useNavigate();
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { name, recentlySelectedCompany } = useContext(Context);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setRoleList([]);
      setLoading(false);
      return;
    }

    const fetchRoles = async () => {
      setLoading(true);
      setError("");

      try {
        const q = query(collection(db, "companies", recentlySelectedCompany, "roles"));
        const querySnapshot = await getDocs(q);
        const roles = querySnapshot.docs
          .map((doc) => {
            const roleData = doc.data();
            return {
              id: roleData.id || doc.id,
              color: roleData.color,
              description: roleData.description,
              listOfUserIdsToManage: roleData.listOfUserIdsToManage || [],
              name: roleData.name,
              permissionIdList: roleData.permissionIdList || [],
            };
          })
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        setRoleList(roles);
      } catch (fetchError) {
        console.error("Failed to load roles:", fetchError);
        setError("Failed to load company roles.");
      } finally {
        setLoading(false);
      }
    };

    fetchRoles();
  }, [recentlySelectedCompany]);

  const totalPermissions = roleList.reduce(
    (total, role) => total + (role.permissionIdList?.length || 0),
    0
  );

  return (
    <div className="min-h-screen w-full bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">User Roles</h1>
            <p className="mt-1 text-sm text-slate-500">
              Review access levels for {name || "the selected company"}.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex">
            <SummaryPill
              icon={<Squares2X2Icon className="h-4 w-4" />}
              label="Roles"
              value={roleList.length}
            />
            <SummaryPill
              icon={<ShieldCheckIcon className="h-4 w-4" />}
              label="Permissions"
              value={totalPermissions}
            />
            <SummaryPill
              icon={<BuildingOffice2Icon className="h-4 w-4" />}
              label="Company"
              value={name || "Selected"}
              wide
            />
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.2fr_120px_1fr_44px] gap-4 border-b border-slate-200 bg-slate-100 px-5 py-3 text-xs font-semibold uppercase text-slate-500 max-md:hidden">
            <div>Role</div>
            <div>Permissions</div>
            <div>Description</div>
            <div />
          </div>

          {loading ? (
            <div className="p-8 text-sm font-semibold text-slate-600">Loading roles...</div>
          ) : error ? (
            <div className="p-8 text-sm font-semibold text-red-700">{error}</div>
          ) : roleList.length === 0 ? (
            <div className="p-8">
              <div className="text-sm font-semibold text-slate-800">No roles found</div>
              <div className="mt-1 text-sm text-slate-500">
                Roles will appear after they are created for this company.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {roleList.map((role) => (
                <button
                  key={role.id}
                  onClick={() => navigate(`/company/roles/${role.id}`)}
                  className="grid w-full grid-cols-1 gap-3 px-5 py-4 text-left transition hover:bg-slate-50 md:grid-cols-[1.2fr_120px_1fr_44px] md:items-center md:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-white shadow-sm"
                      style={{ backgroundColor: role.color || "#0ea5e9" }}
                    >
                      <ShieldCheckIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-950">
                        {role.name || "Untitled Role"}
                      </div>
                      <div className="text-xs text-slate-500 md:hidden">
                        {role.permissionIdList?.length || 0} permissions
                      </div>
                    </div>
                  </div>

                  <div className="hidden md:block">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {role.permissionIdList?.length || 0}
                    </span>
                  </div>

                  <div className="line-clamp-2 text-sm text-slate-500">
                    {role.description || "No description"}
                  </div>

                  <div className="hidden justify-end text-slate-400 md:flex">
                    <ArrowRightIcon className="h-5 w-5" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const SummaryPill = ({ icon, label, value, wide = false }) => (
  <div
    className={`flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm ${
      wide ? "col-span-2 sm:min-w-[220px]" : "sm:min-w-[130px]"
    }`}
  >
    <span className="shrink-0 text-slate-500">{icon}</span>
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-900">{value}</div>
    </div>
  </div>
);

export default Roles;
