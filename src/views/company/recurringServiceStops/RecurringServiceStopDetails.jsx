import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  query,
  collection,
  getDocs,
  limit,
  where,
  doc,
  getDoc,
  updateDoc,
  setDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from "react-select";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { Description } from "@headlessui/react";
import { removeRecurringServiceStopFromPlannedRoutes } from "../../../utils/recurringRouteSync";

import { v4 as uuidv4 } from 'uuid';
const functions = getFunctions();

const jobTaskTypeOptions = [
  "Basic",
  "Clean",
  "Clean Filter",
  "Maintenance",
  "Repair",
  "Empty Water",
  "Fill Water",
  "Inspection",
  "Install",
  "Remove",
  "Replace",
];

const taskStatusOptions = ["Not Finished", "Finished", "Skipped"];

const RecurringServiceStopDetails = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { recurringServiceStopId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [serviceStopList, setServiceStopList] = useState([]);
  const [pastServiceStopList, setPastServiceStopList] = useState([]);
  const [recurringServiceStopTasks, setRecurringServiceStopTasks] = useState([]);
  const [recurringTaskFieldName, setRecurringTaskFieldName] = useState("tasks");

  const [showAddTask, setShowAddTask] = useState(false);
  const [savingTask, setSavingTask] = useState(false);

  const [newTask, setNewTask] = useState({
    name: "",
    type: "",
    contractedRate: "",
    estimatedTime: "",
    status: "Not Finished",
  });

  const [recurringServiceStop, setRecurringServiceStop] = useState({
    id: "",
    internalId: "",
    type: "",
    typeId: "",
    typeImage: "",
    customerId: "",
    customerName: "",

    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    latitude: "",
    longitude: "",

    tech: "",
    techId: "",
    dateCreated: "",
    startDate: "",
    endDate: "",
    noEndDate: "",
    frequency: "",
    day: "",
    daysOfWeek: "",
    lastCreated: "",

    serviceLocationId: "",
    estimatedTime: "",
    otherCompany: "",
    laborContractId: "",
    contractedCompanyId: "",
  });

  const frequencyOptions = useMemo(
    () =>
      ["Weekly", "Biweekly", "Monthly", "Every 2 Weeks", "Every 4 Weeks", "Custom"].map((v) => ({
        value: v,
        label: v,
      })),
    []
  );

  const daysOptions = useMemo(
    () =>
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({
        value: d,
        label: d,
      })),
    []
  );

  const [selectedFrequency, setSelectedFrequency] = useState(null);
  const [selectedDays, setSelectedDays] = useState([]);

  const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 12,
    colors: {
      ...theme.colors,
      primary25: "#EFF6FF",
      primary: "#2563EB",
      neutral0: "#FFFFFF",
      neutral20: "#D1D5DB",
      neutral30: "#9CA3AF",
    },
  });

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
      "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
    }),
    menu: (base) => ({ ...base, borderRadius: 12, overflow: "hidden" }),
  };

  useEffect(() => {
    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    (async () => {
      try {
        setLoading(true);

        const docRef = doc(
          db,
          "companies",
          recentlySelectedCompany,
          "recurringServiceStop",
          recurringServiceStopId
        );
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          toast.error("Recurring service stop not found");
          setLoading(false);
          return;
        }

        const rssData = docSnap.data();

        setRecurringServiceStop((prev) => ({
          ...prev,
          id: rssData.id,
          internalId: rssData.internalId,
          type: rssData.type,
          typeId: rssData.typeId,
          typeImage: rssData.typeImage,
          customerId: rssData.customerId,
          customerName: rssData.customerName,

          streetAddress: rssData.address?.streetAddress || "",
          city: rssData.address?.city || "",
          state: rssData.address?.state || "",
          zip: rssData.address?.zip || "",
          latitude: rssData.address?.latitude || "",
          longitude: rssData.address?.longitude || "",

          tech: rssData.tech,
          techId: rssData.techId,
          dateCreated: rssData.dateCreated,
          startDate: rssData.startDate,
          endDate: rssData.endDate,
          noEndDate: rssData.noEndDate,
          frequency: rssData.frequency,
          day: rssData.day,
          daysOfWeek: rssData.daysOfWeek || "",
          lastCreated: rssData.lastCreated,

          serviceLocationId: rssData.serviceLocationId,
          estimatedTime: rssData.estimatedTime,
          otherCompany: rssData.otherCompany,
          laborContractId: rssData.laborContractId,
          contractedCompanyId: rssData.contractedCompanyId,
        }));

        let tasks = [];
        let fieldName = "tasks";

        if (Array.isArray(rssData.tasks)) {
          tasks = rssData.tasks;
          fieldName = "tasks";
        } else if (Array.isArray(rssData.serviceTasks)) {
          tasks = rssData.serviceTasks;
          fieldName = "serviceTasks";
        } else if (Array.isArray(rssData.recurringServiceStopTasks)) {
          tasks = rssData.recurringServiceStopTasks;
          fieldName = "recurringServiceStopTasks";
        }

        setRecurringTaskFieldName(fieldName);
        setRecurringServiceStopTasks(tasks);

        const start = rssData.startDate?.toDate?.()
          ? format(rssData.startDate.toDate(), "MMMM d, yyyy")
          : "";
        const end = rssData.endDate?.toDate?.()
          ? format(rssData.endDate.toDate(), "MMMM d, yyyy")
          : "";

        setStartDate(start);
        setEndDate(end);

        const freq = rssData.frequency
          ? { value: rssData.frequency, label: rssData.frequency }
          : null;
        setSelectedFrequency(freq);

        const daysRaw = rssData.daysOfWeek;
        const daysArr = Array.isArray(daysRaw)
          ? daysRaw
          : typeof daysRaw === "string"
            ? daysRaw.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
        setSelectedDays(daysArr.map((d) => ({ value: d, label: d })));

        const qUpcoming = query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          where("serviceDate", ">=", new Date())
        );

        const upSnap = await getDocs(qUpcoming);
        setServiceStopList(
          upSnap.docs.map((d) => {
            const data = d.data();
            const date = data.serviceDate?.toDate?.()
              ? format(data.serviceDate.toDate(), "MMMM d, yyyy")
              : "N/A";
            return {
              id: data.id || d.id,
              tech: data.tech,
              techId: data.techId || "",
              customerName: data.customerName,
              streetAddress: data.address?.streetAddress || "",
              jobId: data.jobId || "",
              jobInternalId: data.jobInternalId || "",
              internalId: data.internalId,
              operationStatus: data.operationStatus || "",
              serviceLocationId: data.serviceLocationId || "",
              laborContractId: data.laborContractId || "",
              date,
            };
          })
        );

        const qPast = query(
          collection(db, "companies", recentlySelectedCompany, "serviceStops"),
          where("recurringServiceStopId", "==", recurringServiceStopId),
          where("serviceDate", "<", new Date()),
          limit(5)
        );

        const pastSnap = await getDocs(qPast);
        setPastServiceStopList(
          pastSnap.docs.map((d) => {
            const data = d.data();
            const date = data.serviceDate?.toDate?.()
              ? format(data.serviceDate.toDate(), "MMMM d, yyyy")
              : "N/A";
            return {
              id: data.id || d.id,
              tech: data.tech,
              customerName: data.customerName,
              streetAddress: data.address?.streetAddress || "",
              jobId: data.jobId,
              operationStatus: data.operationStatus || "",
              internalId: data.internalId,
              date,
            };
          })
        );
      } catch (error) {
        console.error(error);
        toast.error("Failed to load recurring service stop");
      } finally {
        setLoading(false);
      }
    })();
  }, [recentlySelectedCompany, recurringServiceStopId]);

  const deleteRSS = async (e) => {
    e.preventDefault();
    try {
      const ok = window.confirm("Delete this recurring service stop? This cannot be undone.");
      if (!ok) return;

      const callable = httpsCallable(functions, "deleteRecurringServiceStop");
      await callable({
        stopId: recurringServiceStopId,
        companyId: recentlySelectedCompany,
      });
      await removeRecurringServiceStopFromPlannedRoutes({
        db,
        companyId: recentlySelectedCompany,
        recurringServiceStopId,
      });

      toast.success("Deleted");
      navigate("/company/recurringServiceStop");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
    }
  };

  const editRSS = (e) => {
    e.preventDefault();
    setEdit(true);
  };

  const cancelEdit = (e) => {
    e.preventDefault();
    setEdit(false);

    setSelectedFrequency(
      recurringServiceStop.frequency
        ? { value: recurringServiceStop.frequency, label: recurringServiceStop.frequency }
        : null
    );

    const daysRaw = recurringServiceStop.daysOfWeek;
    const daysArr = Array.isArray(daysRaw)
      ? daysRaw
      : typeof daysRaw === "string"
        ? daysRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    setSelectedDays(daysArr.map((d) => ({ value: d, label: d })));
  };

  const saveEdits = async (e) => {
    e.preventDefault();
    try {
      const rssRef = doc(
        db,
        "companies",
        recentlySelectedCompany,
        "recurringServiceStop",
        recurringServiceStopId
      );

      const frequency = selectedFrequency?.value || recurringServiceStop.frequency || "";
      const daysOfWeek = (selectedDays || []).map((d) => d.value).join(",");

      await updateDoc(rssRef, { frequency, daysOfWeek });

      setRecurringServiceStop((prev) => ({
        ...prev,
        frequency,
        daysOfWeek,
      }));

      toast.success("Saved");
      setEdit(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save changes");
    }
  };

  const openInMaps = () => {
    const address = `${recurringServiceStop.streetAddress} ${recurringServiceStop.city} ${recurringServiceStop.state} ${recurringServiceStop.zip}`.trim();
    const url = `https://www.google.com/maps/place/${encodeURIComponent(address)}`;
    window.open(url, "_blank");
  };

  const formatCurrencyFromCents = (cents) => {
    const value = Number(cents || 0) / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatMinutes = (minutes) => {
    if (!minutes && minutes !== 0) return "—";
    return `${minutes} min`;
  };

  const getTaskStatusClasses = (status) => {
    const normalized = String(status || "").toLowerCase();

    if (["completed", "done", "complete", "finished"].includes(normalized)) {
      return "bg-green-100 text-green-700";
    }

    if (["inprogress", "in progress", "active", "not finished"].includes(normalized)) {
      return "bg-blue-100 text-blue-700";
    }

    if (["cancelled", "canceled", "skipped"].includes(normalized)) {
      return "bg-red-100 text-red-700";
    }

    return "bg-gray-100 text-gray-700";
  };

  const Field = ({ label, value, children }) => (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-gray-600">{label}</p>
      {children ? children : <p className="text-gray-800">{value || "—"}</p>}
    </div>
  );

  const handleNewTaskChange = (field, value) => {
    setNewTask((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const resetNewTaskForm = () => {
    setNewTask({
      name: "",
      type: "",
      contractedRate: "",
      estimatedTime: "",
      status: "Not Finished",
    });
  };

  const saveNewRecurringTask = async (e) => {
    e.preventDefault();

    if (!recentlySelectedCompany || !recurringServiceStopId) return;

    if (!newTask.name.trim()) {
      toast.error("Task name is required");
      return;
    }

    if (!newTask.type) {
      toast.error("Task type is required");
      return;
    }

    try {
      setSavingTask(true);
      let recurringTaskId = "com_rss_tas_" + uuidv4()
      const recurringTaskPayload = {
        id: recurringTaskId,
        name: newTask.name.trim(),
        description: newTask.description.trim(),
        type: newTask.type,
        contractedRate: Number(newTask.contractedRate || 0),
        estimatedTime: Number(newTask.estimatedTime || 0),
        status: newTask.status || "Not Finished",
        isTaskGroup: false,
        taskGroupId: "",
        taskGroupTaskId: ""
      };

      const rssRef = doc(
        db,
        "companies",
        recentlySelectedCompany,
        "recurringServiceStop",
        recurringServiceStopId,
        "tasks",
        recurringTaskId
      );

      await setDoc(rssRef, recurringTaskPayload);

      const futureStopsQuery = query(
        collection(db, "companies", recentlySelectedCompany, "serviceStops"),
        where("recurringServiceStopId", "==", recurringServiceStopId),
        where("serviceDate", ">=", new Date())
      );

      const futureStopsSnap = await getDocs(futureStopsQuery);

      await Promise.all(
        futureStopsSnap.docs.map(async (serviceStopDoc) => {
          const stop = serviceStopDoc.data();
          const stopId = stop.id || serviceStopDoc.id;
          let serviceStopTaskId = "com_ss_tas_" + uuidv4()

          const serviceStopTaskPayload = {
            id: serviceStopTaskId,
            name: newTask.name.trim(),
            type: newTask.type,
            status: newTask.status || "Not Finished",
            contractedRate: Number(newTask.contractedRate || 0),
            estimatedTime: Number(newTask.estimatedTime || 0),
            customerApproval: false,
            actualTime: 0,

            workerId: stop.techId || recurringServiceStop.techId || "",
            workerType: stop.workerType || "",
            workerName: stop.tech || recurringServiceStop.tech || "",

            laborContractId: stop.laborContractId || recurringServiceStop.laborContractId || "",

            serviceStopId: {
              id: stopId,
              internalId: stop.internalId || "",
            },
            jobId: {
              id: stop.jobId || "",
              internalId: stop.jobInternalId || "",
            },
            recurringServiceStopId: {
              id: recurringServiceStopId,
              internalId: recurringServiceStop.internalId || "",
            },
            jobTaskId: "",
            recurringServiceStopTaskId: recurringTaskPayload.id,
            equipmentId: "",
            serviceLocationId: stop.serviceLocationId || recurringServiceStop.serviceLocationId || "",
            bodyOfWaterId: "",
            shoppingListItemId: "",
          };

          await setDoc(
            doc(
              db,
              "companies",
              recentlySelectedCompany,
              "serviceStops",
              stopId,
              "tasks",
              serviceStopTaskId
            ),
            serviceStopTaskPayload
          );
        })
      );

      setRecurringServiceStopTasks((prev) => [recurringTaskPayload, ...prev]);
      setShowAddTask(false);
      resetNewTaskForm();

      toast.success(
        `Task added to recurring stop and ${futureStopsSnap.docs.length} future service stop${futureStopsSnap.docs.length === 1 ? "" : "s"
        }`
      );
    } catch (error) {
      console.error(error);
      toast.error("Failed to add recurring task");
    } finally {
      setSavingTask(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-screen-xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-40 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link
              to="/company/recurringServiceStop"
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              &larr; Back to Recurring Service Stops
            </Link>
            <h1 className="text-3xl font-bold text-gray-800">Recurring Service Stop Detail</h1>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">
                {recurringServiceStop.internalId || "—"}
              </span>{" "}
              <span className="text-gray-400">•</span>{" "}
              {recurringServiceStop.customerName || "—"}
            </p>
          </div>

          {!edit ? (
            <div className="flex items-center gap-2">
              <Link
                to="/company/recurringServiceStop"
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-100 transition"
              >
                Back
              </Link>
              <button
                onClick={editRSS}
                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdits}
                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl shadow-sm hover:bg-blue-100 transition"
              >
                Save
              </button>
              <button
                onClick={cancelEdit}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={deleteRSS}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800">Details</h2>
              <p className="text-sm text-gray-600">Core recurring stop information</p>
            </div>

            <button
              onClick={openInMaps}
              className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
              title="Open in Google Maps"
            >
              Open in Maps
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <Field label="Internal Id" value={recurringServiceStop.internalId} />
            <Field label="Customer" value={recurringServiceStop.customerName} />
            <Field label="Street Address" value={recurringServiceStop.streetAddress} />
            <Field label="Tech" value={recurringServiceStop.tech} />
            <Field label="Start Date" value={startDate} />
            <Field label="End Date" value={recurringServiceStop.noEndDate ? "No End Date" : endDate} />

            <Field label="Frequency">
              {!edit ? (
                <p className="text-gray-800">{recurringServiceStop.frequency || "—"}</p>
              ) : (
                <Select
                  value={selectedFrequency}
                  options={frequencyOptions}
                  onChange={setSelectedFrequency}
                  isSearchable
                  placeholder="Select frequency"
                  theme={selectTheme}
                  styles={selectStyles}
                />
              )}
            </Field>

            <Field label="Day of Week">
              {!edit ? (
                <p className="text-gray-800">
                  {recurringServiceStop.daysOfWeek || recurringServiceStop.day || "—"}
                </p>
              ) : (
                <Select
                  value={selectedDays}
                  options={daysOptions}
                  onChange={setSelectedDays}
                  isMulti
                  placeholder="Select days"
                  theme={selectTheme}
                  styles={selectStyles}
                />
              )}
            </Field>

            <Field label="Estimated Time" value={formatMinutes(recurringServiceStop.estimatedTime)} />
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Recurring Service Stop Tasks</h3>
              <p className="text-sm text-gray-600">Tasks configured for this recurring stop</p>
            </div>

            {!showAddTask && (
              <button
                onClick={() => setShowAddTask(true)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
              >
                Add Task
              </button>
            )}
          </div>

          {showAddTask && (
            <form
              onSubmit={saveNewRecurringTask}
              className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-1">
                    Task Name
                  </label>
                  <input
                    type="text"
                    value={newTask.name}
                    onChange={(e) => handleNewTaskChange("name", e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="Brush walls"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-1">
                    Type
                  </label>
                  <select
                    value={newTask.type}
                    onChange={(e) => handleNewTaskChange("type", e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
                  >
                    <option value="">Select task type</option>
                    {jobTaskTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-1">
                    Contracted Rate (cents)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newTask.contractedRate}
                    onChange={(e) => handleNewTaskChange("contractedRate", e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="2500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-1">
                    Estimated Time (mins)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newTask.estimatedTime}
                    onChange={(e) => handleNewTaskChange("estimatedTime", e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="30"
                  />
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                Saving this task will also add it to all future service stops tied to this recurring service stop.
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingTask}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {savingTask ? "Saving..." : "Save Task"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAddTask(false);
                    resetNewTaskForm();
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {!!recurringServiceStopTasks?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                      Task Name
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                      Contracted Rate
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                      Estimated Time
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200">
                  {recurringServiceStopTasks.map((task, index) => (
                    <tr key={task.id || `${task.name}-${index}`} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 whitespace-nowrap text-gray-800 font-medium">
                        {task.name || "—"}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {task.type || "—"}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {formatCurrencyFromCents(task.contractedRate)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {formatMinutes(task.estimatedTime)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-gray-500">
              No recurring service stop tasks found.
            </div>
          )}
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Upcoming Service</h3>
              <p className="text-sm text-gray-600">
                {serviceStopList.length} future service stop{serviceStopList.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Internal Id
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Tech
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Customer Name
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Street Address
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {serviceStopList?.map((serviceStop) => (
                  <tr
                    key={serviceStop.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/company/serviceStops/detail/${serviceStop.id}`)}
                  >
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.internalId}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.date}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.tech}</td>
                    <td className="p-4 whitespace-nowrap text-gray-800 font-medium">
                      {serviceStop.customerName}
                    </td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.streetAddress}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">
                      {serviceStop.operationStatus || "—"}
                    </td>
                  </tr>
                ))}

                {!serviceStopList?.length && (
                  <tr>
                    <td colSpan={7} className="p-6 text-gray-500">
                      No upcoming jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-800">Most Recent Service</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Internal Id
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Tech
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Customer Name
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Street Address
                  </th>
                  <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {pastServiceStopList?.map((serviceStop) => (
                  <tr
                    key={serviceStop.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/company/serviceStops/detail/${serviceStop.id}`)}
                  >
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.internalId}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.date}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.tech}</td>
                    <td className="p-4 whitespace-nowrap text-gray-800 font-medium">
                      {serviceStop.customerName}
                    </td>
                    <td className="p-4 whitespace-nowrap text-gray-700">{serviceStop.streetAddress}</td>
                    <td className="p-4 whitespace-nowrap text-gray-700">
                      {serviceStop.operationStatus || "—"}
                    </td>
                  </tr>
                ))}

                {!pastServiceStopList?.length && (
                  <tr>
                    <td colSpan={7} className="p-6 text-gray-500">
                      No recent jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecurringServiceStopDetails;
