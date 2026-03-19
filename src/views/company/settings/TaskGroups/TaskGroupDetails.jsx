import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import Select from "react-select";
import {
  query,
  collection,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../../utils/config";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../../context/AuthContext";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

const TaskGroupDetails = () => {
  const navigate = useNavigate();

  const { name, recentlySelectedCompany } = useContext(Context);

  const { taskGroupId } = useParams();

  const [taskList, setTaskList] = useState([]);

  const [taskGroup, setTaskGroup] = useState({
    id: "",
    groupName: "",
    numberOfTasks: "",
  });
  const [taskName, setTaskName] = useState("");

  const [taskDescription, setTaskDescription] = useState("");

  const [taskToEdit, setTaskToEdit] = useState([]);

  const [taskLaborCost, setTaskLaborCost] = useState();

  const [taskTime, setTaskTime] = useState();

  const [selectedTaskType, setSelectedTaskType] = useState({
    id: "",
    name: "",
  });

  const [taskTypeList, setTaskTypeList] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        let docSnap = await getDoc(
          doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId)
        );
        if (docSnap.exists()) {
          const data = docSnap.data();

          setTaskGroup((taskGroup) => ({
            ...taskGroup,
            id: data.id,
            groupName: data.groupName,
            numberOfTasks: data.numberOfTasks,
          }));
        }

        //Get Task List
        let taskListQ = query(
          collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId, "tasks")
        );
        const taskListQSnapshot = await getDocs(taskListQ);
        setTaskList([]);
        taskListQSnapshot.forEach((doc) => {
          const taskData = doc.data();
          const taskType = {
            id: taskData.id,
            name: taskData.name,
            description: taskData.description,
            typeId: taskData.typeId,
            type: taskData.type,
            contractedRate: taskData.contractedRate,
            estimatedTime: taskData.estimatedTime,
          };
          setTaskList((taskList) => [...taskList, taskType]);
        });

        //Get Task Types
        let taskTypeQuery = query(collection(db, "universal", "settings", "taskTypes"));
        const taskTypeQuerySnapshot = await getDocs(taskTypeQuery);
        setTaskTypeList([]);
        taskTypeQuerySnapshot.forEach((doc) => {
          const taskTypeData = doc.data();
          const taskType = {
            id: taskTypeData.id,
            name: taskTypeData.name,
            label: taskTypeData.name,
          };
          setTaskTypeList((taskTypeList) => [...taskTypeList, taskType]);
        });
      } catch (error) {
        console.log(error);
      }
    })();
  }, []);

  const handleSelectedTaskTypeChange = (option) => {
    (async () => {
      setSelectedTaskType(option);
    })();
  };

  async function cancelEditTask(e, taskId) {
    e.preventDefault();

    setTaskToEdit({});
  }

  async function editTask(e, taskId) {
    e.preventDefault();
    const task = taskList.find((item) => item.id === taskId);

    setTaskToEdit(task);
  }

  async function handleAddTask(e) {
    e.preventDefault();

    try {
      let taskId = "com_set_tg_tas_" + uuidv4();

      let labor = parseFloat(taskLaborCost);
      labor = labor * 100;
      let time = parseFloat(taskTime);

      await setDoc(
        doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId, "tasks", taskId),
        {
          id: taskId,
          name: taskName,
          description: taskDescription,
          typeId: selectedTaskType.id,
          type: selectedTaskType.name,
          contractedRate: labor,
          estimatedTime: time,
        }
      );

      await updateDoc(doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId), {
        numberOfTasks: taskList.length + 1,
      });

      //Get Updated Task Group
      let docSnap = await getDoc(
        doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId)
      );
      if (docSnap.exists()) {
        const data = docSnap.data();

        setTaskGroup((taskGroup) => ({
          ...taskGroup,
          id: data.id,
          groupName: data.groupName,
          numberOfTasks: data.numberOfTasks,
        }));
      }

      toast.success("Successfully Added Task");

      //Get Updated Task List
      let taskListQ = query(
        collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId, "tasks")
      );
      const taskListQSnapshot = await getDocs(taskListQ);
      setTaskList([]);
      taskListQSnapshot.forEach((doc) => {
        const taskData = doc.data();
        const taskType = {
          id: taskData.id,
          name: taskData.name,
          description: taskData.description,
          typeId: taskData.typeId,
          type: taskData.type,
          contractedRate: taskData.contractedRate,
          estimatedTime: taskData.estimatedTime,
        };
        setTaskList((taskList) => [...taskList, taskType]);
      });

      setSelectedTaskType({});
      setTaskDescription("");
      setTaskName("");
      setTaskTime("");
      setTaskLaborCost("");
    } catch (error) {
      console.log("Error : " + error);
    }
  }

  async function removeTask(e, taskId) {
    e.preventDefault();
    try {
      await deleteDoc(
        doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId, "tasks", taskId)
      );
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId), {
        numberOfTasks: taskList.length - 1,
      });
      toast.success("Successfully Removed Task");

      //Get Updated Task Group
      let docSnap = await getDoc(
        doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId)
      );
      if (docSnap.exists()) {
        const data = docSnap.data();

        setTaskGroup((taskGroup) => ({
          ...taskGroup,
          id: data.id,
          groupName: data.groupName,
          numberOfTasks: data.numberOfTasks,
        }));
      }

      //Get Updated Task List
      let taskListQ = query(
        collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId, "tasks")
      );
      const taskListQSnapshot = await getDocs(taskListQ);
      setTaskList([]);
      taskListQSnapshot.forEach((doc) => {
        const taskData = doc.data();
        const taskType = {
          id: taskData.id,
          name: taskData.name,
          description: taskData.description,
          typeId: taskData.typeId,
          type: taskData.type,
          contractedRate: taskData.contractedRate,
          estimatedTime: taskData.estimatedTime,
        };
        setTaskList((taskList) => [...taskList, taskType]);
      });
    } catch (error) {
      console.log("Error : " + error);
    }
  }

  async function deleteTaskGroup(e, t) {
    e.preventDefault();
    try {
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId));
      toast.dismiss(t.id);
      toast.success("Successfully Deleted Task Group");
      navigate("/company/taskGroups");
    } catch (error) {
      console.log("Error " + error);
    }
  }

  const customToast = () =>
    toast(
      (t) => (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-900">Delete task group?</div>
          <div className="text-sm text-slate-600">This will remove the task group. (Tasks may still exist depending on your rules.)</div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              onClick={() => toast.dismiss(t.id)}
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center justify-center rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
              onClick={(e) => {
                deleteTaskGroup(e, t);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );

  async function clearNewTask(e) {
    e.preventDefault();
    setSelectedTaskType({});
    setTaskDescription("");
    setTaskLaborCost("");
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              to={`/company/taskGroups`}
            >
              ← Back
            </Link>
            <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">Task Group Details</h1>
            <p className="mt-1 text-sm text-slate-500">
              Group Name: <span className="font-semibold text-slate-700">{taskGroup.groupName}</span> •{" "}
              <span className="font-semibold text-slate-700">{taskGroup.numberOfTasks}</span> tasks
            </p>
          </div>

          <button
            className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
            onClick={customToast}
          >
            Delete Group
          </button>
        </div>

        {/* Task List */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Task List</div>
              <div className="text-xs text-slate-500 mt-1">Review tasks and manage items below.</div>
            </div>
            <div className="text-sm text-slate-500">{taskList.length} tasks</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-white">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 px-5 border-b border-slate-200">Name</th>
                  <th className="py-3 px-5 border-b border-slate-200">Type</th>
                  <th className="py-3 px-5 border-b border-slate-200">Contracted Rate</th>
                  <th className="py-3 px-5 border-b border-slate-200">Estimated Time</th>
                  <th className="py-3 px-5 border-b border-slate-200">Description</th>
                  <th className="py-3 px-5 border-b border-slate-200 text-right"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {taskList?.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-5 text-sm font-semibold text-slate-900 whitespace-nowrap">{task.name}</td>

                    <td className="py-3 px-5 text-sm text-slate-700 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {task.type}
                      </span>
                    </td>

                    <td className="py-3 px-5 text-sm text-slate-700 whitespace-nowrap">
                      ${(task.contractedRate / 100).toFixed(2)}
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                        onChange={(e) => {
                          setTaskDescription(e.target.value);
                        }}
                        type="text"
                        placeholder="Rate"
                        value={taskDescription}
                      />
                    </td>

                    <td className="py-3 px-5 text-sm text-slate-700 whitespace-nowrap">{task.estimatedTime}</td>

                    <td className="py-3 px-5 text-sm text-slate-600">{task.description}</td>

                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      {(taskToEdit.id === task.id) && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={(e) => removeTask(e, task.id)}
                            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={(e) => cancelEditTask(e, task.id)}
                            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {(taskToEdit.id !== task.id) && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={(e) => removeTask(e, task.id)}
                            className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                          >
                            Delete
                          </button>
                          <button
                            onClick={(e) => editTask(e, task.id)}
                            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}

                {taskList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="text-sm font-semibold text-slate-800">No tasks yet</div>
                        <div className="text-sm text-slate-500 mt-1">Add a task using the form below.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Add Task Form */}
          <div className="border-t border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                onChange={(e) => {
                  setTaskName(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                type="text"
                placeholder="Name"
                value={taskName}
              />

              <div className="w-full">
                <Select
                  value={selectedTaskType}
                  options={taskTypeList}
                  onChange={handleSelectedTaskTypeChange}
                  isSearchable
                  placeholder="Select a Task Type"
                  styles={{
                    control: (base, state) => ({
                      ...base,
                      minHeight: "48px",
                      borderRadius: "12px",
                      borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
                      boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                      "&:hover": { borderColor: "#CBD5E1" },
                    }),
                    menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
                  }}
                  theme={(theme) => ({
                    ...theme,
                    borderRadius: 12,
                    colors: {
                      ...theme.colors,
                      primary25: "rgba(59,130,246,0.10)",
                      primary: "#2563EB",
                      neutral0: "#FFFFFF",
                      neutral80: "#0F172A",
                      neutral20: "#E2E8F0",
                      neutral30: "#CBD5E1",
                    },
                  })}
                />
              </div>

              <input
                onChange={(e) => {
                  setTaskLaborCost(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                type="text"
                placeholder="Contracted Rate"
                value={taskLaborCost}
              />

              <input
                onChange={(e) => {
                  setTaskTime(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                type="text"
                placeholder="Estimated Time"
                value={taskTime}
              />

              <div className="flex gap-2 md:flex-col md:w-auto">
                <button
                  onClick={(e) => clearNewTask(e)}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Clear
                </button>
                <button
                  onClick={(e) => handleAddTask(e)}
                  className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition"
                >
                  Add
                </button>
              </div>
            </div>

            <input
              onChange={(e) => {
                setTaskDescription(e.target.value);
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              type="text"
              placeholder="Description"
              value={taskDescription}
            />

            {/* Keep your existing “Details” block, just restyled */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Details</div>
              <div className="mt-2 text-sm text-slate-600 space-y-2">
                {(selectedTaskType.name === "Basic") && <p>Basic</p>}
                {(selectedTaskType.name === "Clean") && <p>Clean</p>}
                {(selectedTaskType.name === "Empty Water") && (
                  <div>
                    <p className="font-semibold">Empty Water</p>
                    <p>Select Body Of Water</p>
                  </div>
                )}
                {(selectedTaskType.name === "Fill Water") && (
                  <div>
                    <p className="font-semibold">Fill Water</p>
                    <p>Select Body Of Water</p>
                  </div>
                )}
                {(selectedTaskType.name === "Install") && (
                  <div>
                    <p className="font-semibold">Install</p>
                    <p>Select New Piece of Equipment to Install</p>
                  </div>
                )}
                {(selectedTaskType.name === "Remove") && (
                  <div>
                    <p className="font-semibold">Remove</p>
                    <p>Select Equipment To remove</p>
                  </div>
                )}
                {(selectedTaskType.name === "Replace") && (
                  <div>
                    <p className="font-semibold">Replace</p>
                    <p>Select Equipment To remove</p>
                    <p>Select New Piece of Equipment to Install</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Button */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <button
            onClick={(e) => clearNewTask(e)}
            className="w-full inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
          >
            Update Task Group
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskGroupDetails;
