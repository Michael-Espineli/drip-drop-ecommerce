import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs } from "firebase/firestore";
import { db } from "../../../../utils/config";
import { Link, useNavigate } from "react-router-dom";
import { Context } from "../../../../context/AuthContext";

const TaskGroups = () => {
  const [companyUserList, setCompanyUserList] = useState([]);
  const { name, recentlySelectedCompany } = useContext(Context);

  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        let q = query(
          collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups")
        );
        const querySnapshot = await getDocs(q);
        setCompanyUserList([]);
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const companyUser = {
            id: data.id,
            name: data.name,
            description: data.description,
            canDelete: data.canDelete,
            numberOfTasks: data.numberOfTasks,
          };
          setCompanyUserList((companyUserList) => [...companyUserList, companyUser]);
        });
      } catch (error) {
        console.log("Error");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Task Groups</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage reusable task templates for your team.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              className="px-4 py-2 text-sm font-medium text-black-700 bg-black-50 border border-black-200 rounded-xl shadow-sm hover:bg-black-100 transition"
              to="/company/taskGroups/createNew"
            >
              + Create New Task Group
            </Link>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">Groups</div>
            <div className="text-sm text-slate-500">{companyUserList.length} total</div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-white">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 border-b border-slate-200">Name</th>
                  <th className="px-5 py-3 border-b border-slate-200">Tasks</th>
                  <th className="px-5 py-3 border-b border-slate-200 text-right">Description</th>
                  <th className="px-5 py-3 border-b border-slate-200 text-right">Can Edit</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {companyUserList?.map((group) => (
                  <tr key={group.id} className="hover:bg-slate-50 transition"
                    onClick={() => navigate(`/company/taskGroups/details/${group.id}`)}

                  >
                    <td className="px-5 py-4">
                      {group.name}
                    </td>
                    <td className="px-5 py-4">
                      {group.numberOfTasks ?? 0} tasks
                    </td>
                    <td className="px-5 py-4">
                      {group.description}
                    </td>
                  </tr>
                ))}

                {(!companyUserList || companyUserList.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="text-sm font-semibold text-slate-800">
                          No task groups found
                        </div>
                        <div className="text-sm text-slate-500 mt-1">
                          Create your first task group to reuse common workflows.
                        </div>
                        <div className="mt-4">
                          <Link
                            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition"
                            to="/company/taskGroups/createNew"
                          >
                            + Create New Task Group
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer hint */}
          <div className="px-5 py-4 border-t border-slate-200 bg-white text-xs text-slate-500">
            Click a group to view details and manage tasks.
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskGroups;
