import React, { useState, useEffect, useContext } from "react";
import { Link } from "react-router-dom";
import { query, collection, getDocs, setDoc, doc } from "firebase/firestore";
import { db } from "../../../../utils/config";
import { Context } from "../../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import Select from "react-select";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

const CreateNewTaskGroup = () => {
  const navigate = useNavigate();

  const { name, recentlySelectedCompany } = useContext(Context);

  const [groupName, setGroupName] = useState();

  const [taskList, setTaskList] = useState([]);

  const [taskLaborCost, setTaskLaborCost] = useState();

  const [taskName, setTaskName] = useState();

  const [description, setDescription] = useState();

  const [estimatedTime, setEstimatedTime] = useState();

  const [taskTypeList, setTaskTypeList] = useState([]);

  const [selectedTaskType, setSelectedTaskType] = useState({
    id: "",
    name: "",
  });

  const handleSelectedTaskTypeChange = (selectedOption2) => {
    (async () => {
      setSelectedTaskType(selectedOption2);
    })();
  };

  useEffect(() => {
    (async () => {
      try {
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

        console.log("Retrived Task Types");
      } catch (error) {
        console.log("Error");
      }
    })();
  }, []);

  async function clearNewTask(e) {
    e.preventDefault();
    setSelectedTaskType({});
    setDescription("");
    setTaskName("");
    setEstimatedTime("");
    setTaskLaborCost("");
  }

  async function createNewTaskGroup(e) {
    e.preventDefault();
    let taskGroupId = "com_set_tg_" + uuidv4();
    //Guard Statments
    //Create Task Group

    await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId), {
      id: taskGroupId,
      groupName: groupName,
      numberOfTasks: taskList.length,
    });

    //Add Tasks to Task Group
    for (let i = 0; i < taskList.length; i++) {
      let task = taskList[i];

      await setDoc(
        doc(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroupId, "tasks", task.id),
        {
          id: task.id,
          name: task.name,
          description: task.description,
          typeId: task.typeId,
          type: task.type,
          contractedRate: task.contractedRate,
          estimatedTime: task.estimatedTime,
        }
      );
    }
    //Navigate To Task Group Detail View
    navigate("/company/taskGroups/details/" + taskGroupId);
  }

  async function AddTaskToGroup(e) {
    e.preventDefault();

    let taskId = "com_set_tg_tas_" + uuidv4();

    let labor = parseFloat(taskLaborCost);
    labor = labor * 100;
    let time = parseFloat(estimatedTime);

    let task = {
      id: taskId,
      name: taskName,
      description: description,
      typeId: selectedTaskType.id,
      type: selectedTaskType.name,
      contractedRate: labor,
      estimatedTime: time,
    };
    setTaskList((taskList) => [...taskList, task]);
    toast.success("Successfully Added Task");
    setSelectedTaskType({});
    setDescription("");
    setTaskName("");
    setEstimatedTime("");
    setTaskLaborCost("");
  }

  async function deleteTaskItem(e, task) {
    e.preventDefault();
    try {
      console.log("Deleting Task");
      let oldTaskList = taskList;
      let newTaskList = oldTaskList.filter((item) => item !== task);
      setTaskList(newTaskList);
      toast.success("Successfully Deleted Task");
      console.log("Successfully deleted Task");
    } catch (error) {
      console.log("Error: " + error);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                to={`/company/taskGroups`}
              >
                ← Back to List
              </Link>
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-3">Create New Task Group</h2>
            <p className="text-sm text-slate-500 mt-1">Build a reusable group by adding tasks below.</p>
          </div>

          <button
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
            onClick={(e) => createNewTaskGroup(e)}
          >
            Create Task Group
          </button>
        </div>

        {/* Group Name Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
            <div className="text-sm font-semibold text-slate-700">Group Details</div>
          </div>

          <div className="p-5">
            <label className="block text-sm font-semibold text-slate-700">Group Name</label>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              onChange={(e) => {
                setGroupName(e.target.value);
              }}
              type="text"
              placeholder="e.g. Weekly Pool Service"
              value={groupName}
            />
          </div>
        </div>

        {/* Task List Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-700">Task List</div>
              <div className="text-xs text-slate-500 mt-1">Add tasks and review them in the table.</div>
            </div>
            <div className="text-sm text-slate-500">{taskList.length} tasks</div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-white">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 px-5 border-b border-slate-200">Name</th>
                  <th className="py-3 px-5 border-b border-slate-200">Type</th>
                  <th className="py-3 px-5 border-b border-slate-200">Description</th>
                  <th className="py-3 px-5 border-b border-slate-200">Labor</th>
                  <th className="py-3 px-5 border-b border-slate-200">Time (Hr)</th>
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

                    <td className="py-3 px-5 text-sm text-slate-600">{task.description}</td>

                    <td className="py-3 px-5 text-sm text-slate-700 whitespace-nowrap">
                      ${(task.contractedRate / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-5 text-sm text-slate-700 whitespace-nowrap">
                      {(task.estimatedTime / 60).toFixed(2)}
                    </td>

                    <td className="py-3 px-5 text-right">
                      <button
                        onClick={(e) => deleteTaskItem(e, task)}
                        className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}

                {taskList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="text-sm font-semibold text-slate-800">No tasks added yet</div>
                        <div className="text-sm text-slate-500 mt-1">Use the form below to add your first task.</div>
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
              <button
                onClick={(e) => clearNewTask(e)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition md:w-auto"
                title="Clear"
              >
                Clear
              </button>

              <input
                onChange={(e) => {
                  setTaskName(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                type="text"
                placeholder="Task name"
                value={taskName}
              />

              <div className="w-full">
                <Select
                  value={selectedTaskType}
                  options={taskTypeList}
                  onChange={handleSelectedTaskTypeChange}
                  isSearchable
                  placeholder="Select a task type"
                  styles={{
                    control: (base, state) => ({
                      ...base,
                      minHeight: "48px",
                      borderRadius: "12px",
                      borderColor: state.isFocused ? "#93C5FD" : "#E2E8F0",
                      boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
                      "&:hover": { borderColor: "#CBD5E1" },
                    }),
                    valueContainer: (base) => ({ ...base, padding: "0 12px" }),
                    menu: (base) => ({ ...base, borderRadius: "12px", overflow: "hidden" }),
                    option: (base, state) => ({
                      ...base,
                      backgroundColor: state.isFocused ? "rgba(59,130,246,0.10)" : "white",
                      color: "#0F172A",
                    }),
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
                placeholder="Labor cost"
                value={taskLaborCost}
              />

              <input
                onChange={(e) => {
                  setEstimatedTime(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                type="text"
                placeholder="Estimated time (min)"
                value={estimatedTime}
              />

              <button
                onClick={(e) => AddTaskToGroup(e)}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition md:w-auto"
              >
                Add
              </button>
            </div>

            <input
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              type="text"
              placeholder="Task description"
              value={description}
            />
          </div>
        </div>

        {/* Footer Action */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <button
            className="w-full inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition"
            onClick={(e) => createNewTaskGroup(e)}
          >
            Create New Task Group
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateNewTaskGroup;
