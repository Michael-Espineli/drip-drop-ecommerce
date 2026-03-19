import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs } from "firebase/firestore";
import { db } from "../../../../utils/config";
import { Link } from "react-router-dom";
import { Context } from "../../../../context/AuthContext";

const TaskGroups = () => {
  const [companyUserList, setCompanyUserList] = useState([]);
  const { name, recentlySelectedCompany } = useContext(Context);

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
            groupName: data.groupName,
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
      <div className="mx-auto max-w-6xl space-y-6">
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
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
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
                  <th className="px-5 py-3 border-b border-slate-200">Group Name</th>
                  <th className="px-5 py-3 border-b border-slate-200">Tasks</th>
                  <th className="px-5 py-3 border-b border-slate-200 text-right">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {companyUserList?.map((group) => (
                  <tr key={group.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-4">
                      <Link
                        to={`/company/taskGroups/details/${group.id}`}
                        className="block font-semibold text-slate-900"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {group.groupName}
                        <div className="text-sm text-slate-500 font-normal mt-0.5">
                          Task group template
                        </div>
                      </Link>
                    </td>

                    <td className="px-5 py-4">
                      <Link
                        to={`/company/taskGroups/details/${group.id}`}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700"
                        style={{ display: "inline-flex" }}
                      >
                        {group.numberOfTasks ?? 0} tasks
                      </Link>
                    </td>

                    <td className="px-5 py-4 text-right">
                      <Link
                        to={`/company/taskGroups/details/${group.id}`}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                        style={{ display: "inline-flex" }}
                      >
                        Details →
                      </Link>
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
