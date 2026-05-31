import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from "react-router-dom";
import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    addDoc,
    updateDoc,
    arrayUnion,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { ServiceStop } from "../../../utils/models/ServiceStop";
import { format } from "date-fns";
import toast from "react-hot-toast";

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

const ServiceStopDetails = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { serviceStopId } = useParams();

    const [serviceStop, setServiceStop] = useState(null);
    const [taskList, setTaskList] = useState([]);
    const [loading, setLoading] = useState(true);

    const [showAddTask, setShowAddTask] = useState(false);
    const [savingTask, setSavingTask] = useState(false);

    const [newTask, setNewTask] = useState({
        name: "",
        type: "",
        status: "Not Finished",
        contractedRate: "",
        estimatedTime: "",
        customerApproval: false,
        actualTime: "",
        workerId: "",
        workerType: "",
        workerName: "",
        laborContractId: "",
        equipmentId: "",
        serviceLocationId: "",
        bodyOfWaterId: "",
        shoppingListItemId: "",
        addToRecurringServiceStop: false,
    });

    useEffect(() => {
        const fetchServiceStopDetails = async () => {
            if (!recentlySelectedCompany || !serviceStopId) return;

            try {
                setLoading(true);

                const docRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId
                );
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const stopData = ServiceStop.fromFirestore(docSnap);
                    setServiceStop(stopData);

                    const taskQuery = query(
                        collection(
                            db,
                            "companies",
                            recentlySelectedCompany,
                            "serviceStops",
                            serviceStopId,
                            "tasks"
                        )
                    );
                    const taskQuerySnapshot = await getDocs(taskQuery);
                    const tasks = taskQuerySnapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    }));
                    setTaskList(tasks);

                    setNewTask((prev) => ({
                        ...prev,
                        workerId: stopData.techId || "",
                        workerName: stopData.tech || "",
                        serviceLocationId: stopData.serviceLocationId || "",
                    }));
                } else {
                    console.log("No such document!");
                }
            } catch (error) {
                console.error("Error fetching service stop details: ", error);
                toast.error("Failed to load service stop details");
            } finally {
                setLoading(false);
            }
        };

        fetchServiceStopDetails();
    }, [recentlySelectedCompany, serviceStopId]);

    const getStatusClass = (status) => {
        const normalized = String(status || "").toLowerCase();

        if (["finished", "completed", "done", "complete"].includes(normalized)) {
            return "bg-green-100 text-green-800";
        }
        if (["not finished", "in progress", "inprogress", "active"].includes(normalized)) {
            return "bg-yellow-100 text-yellow-800";
        }
        if (["skipped", "cancelled", "canceled"].includes(normalized)) {
            return "bg-red-100 text-red-800";
        }

        return "bg-gray-100 text-gray-800";
    };

    const formatCurrencyFromCents = (cents) => {
        const value = Number(cents || 0) / 100;
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format(value);
    };

    const formatMinutes = (minutes) => {
        if (minutes === null || minutes === undefined || minutes === "") return "—";
        return `${minutes} mins`;
    };

    const yesNo = (value) => (value ? "Yes" : "No");

    const Field = ({ label, value, children }) => (
        <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-600">{label}</p>
            {children ? children : <p className="text-gray-800">{value || "—"}</p>}
        </div>
    );

    const resetTaskForm = () => {
        setNewTask({
            name: "",
            type: "",
            status: "Not Finished",
            contractedRate: "",
            estimatedTime: "",
            customerApproval: false,
            actualTime: "",
            workerId: serviceStop?.techId || "",
            workerType: "",
            workerName: serviceStop?.tech || "",
            laborContractId: "",
            equipmentId: "",
            serviceLocationId: serviceStop?.serviceLocationId || "",
            bodyOfWaterId: "",
            shoppingListItemId: "",
            addToRecurringServiceStop: false,
        });
    };

    const handleTaskFieldChange = (field, value) => {
        setNewTask((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const saveNewTask = async (e) => {
        e.preventDefault();

        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

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

            const serviceStopTaskPayload = {
                name: newTask.name.trim(),
                type: newTask.type,
                status: newTask.status || "Not Finished",
                contractedRate: Number(newTask.contractedRate || 0),
                estimatedTime: Number(newTask.estimatedTime || 0),
                customerApproval: !!newTask.customerApproval,
                actualTime: Number(newTask.actualTime || 0),

                workerId: newTask.workerId || "",
                workerType: newTask.workerType || "",
                workerName: newTask.workerName || "",

                laborContractId: newTask.laborContractId || "",
                serviceStopId: {
                    id: serviceStop.id || serviceStopId,
                    internalId: serviceStop.internalId || "",
                },
                jobId: {
                    id: serviceStop.jobId || "",
                    internalId: serviceStop.jobInternalId || "",
                },
                recurringServiceStopId: {
                    id: serviceStop.recurringServiceStopId || "",
                    internalId: serviceStop.recurringServiceStopInternalId || "",
                },

                jobTaskId: "",
                recurringServiceStopTaskId: "",

                equipmentId: newTask.equipmentId || "",
                serviceLocationId: newTask.serviceLocationId || "",
                bodyOfWaterId: newTask.bodyOfWaterId || "",
                shoppingListItemId: newTask.shoppingListItemId || "",
            };

            const taskRef = await addDoc(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "tasks"
                ),
                serviceStopTaskPayload
            );

            const createdTask = {
                id: taskRef.id,
                ...serviceStopTaskPayload,
            };

            if (
                newTask.addToRecurringServiceStop &&
                serviceStop.recurringServiceStopId
            ) {
                const recurringTaskPayload = {
                    id: `comp_rss_task_${crypto.randomUUID()}`,
                    name: newTask.name.trim(),
                    type: newTask.type,
                    contractedRate: Number(newTask.contractedRate || 0),
                    estimatedTime: Number(newTask.estimatedTime || 0),
                    status: newTask.status || "Not Finished",
                };

                const rssRef = doc(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "recurringServiceStop",
                    serviceStop.recurringServiceStopId
                );

                await updateDoc(rssRef, {
                    tasks: arrayUnion(recurringTaskPayload),
                    // recurringServiceStopTasks: arrayUnion(recurringTaskPayload),
                });
            }

            setTaskList((prev) => [createdTask, ...prev]);
            toast.success("Task added");
            setShowAddTask(false);
            resetTaskForm();
        } catch (error) {
            console.error(error);
            toast.error("Failed to add task");
        } finally {
            setSavingTask(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
                <div className="mx-auto">
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

    if (!serviceStop) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-50">
                <p className="text-lg text-gray-600">Service stop not found.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <Link
                            to="/company/serviceStops"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Service Stops
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">Service Stop Details</h2>
                        <p className="text-sm text-gray-500">#{serviceStop.internalId || "—"}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <div className="flex justify-between items-start gap-4">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">Stop Information</h3>
                                    <p className="text-sm text-gray-600 mt-1">Core service stop details</p>
                                </div>

                                <span
                                    className={`px-3 py-1 text-sm font-bold leading-none rounded-full ${getStatusClass(
                                        serviceStop.operationStatus
                                    )}`}
                                >
                                    {serviceStop.operationStatus || "—"}
                                </span>
                            </div>

                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <Field label="Customer" value={serviceStop.customerName} />
                                <Field label="Technician" value={serviceStop.tech} />

                                <Field label="Recurring Service Stop">
                                    {serviceStop.recurringServiceStopId ? (
                                        <Link
                                            to={`/company/recurringServiceStop/details/${serviceStop.recurringServiceStopId}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {serviceStop.recurringServiceStopId}
                                        </Link>
                                    ) : (
                                        <p className="text-gray-800">—</p>
                                    )}
                                </Field>

                                <Field
                                    label="Date"
                                    value={
                                        serviceStop.serviceDate
                                            ? format(serviceStop.serviceDate, "PP")
                                            : "N/A"
                                    }
                                />

                                <Field
                                    label="Address"
                                    value={`${serviceStop.address?.streetAddress || ""}${serviceStop.address?.city ? `, ${serviceStop.address.city}` : ""
                                        }${serviceStop.address?.state ? `, ${serviceStop.address.state}` : ""}`}
                                />

                                <Field label="Job ID">
                                    {serviceStop.jobId ? (
                                        <Link
                                            to={`/company/jobs/detail/${serviceStop.jobId}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {serviceStop.jobId}
                                        </Link>
                                    ) : (
                                        <p className="text-gray-800">—</p>
                                    )}
                                </Field>

                                <Field label="Billing Status" value={serviceStop.billingStatus} />
                                <Field label="Duration" value={formatMinutes(serviceStop.duration)} />
                                <Field
                                    label="Estimated Duration"
                                    value={formatMinutes(serviceStop.estimatedDuration)}
                                />
                                <Field label="Description" value={serviceStop.description || "None"} />
                            </div>
                        </div>

                        {serviceStop.includeReadings && (
                            <div className="bg-white shadow-lg rounded-xl p-6">
                                <h3 className="text-xl font-bold text-gray-800">Chemical Readings</h3>
                            </div>
                        )}

                        {serviceStop.includeDosages && (
                            <div className="bg-white shadow-lg rounded-xl p-6">
                                <h3 className="text-xl font-bold text-gray-800">Chemical Dosages</h3>
                            </div>
                        )}

                        {serviceStop.photoUrls?.length > 0 && (
                            <div className="bg-white shadow-lg rounded-xl p-6">
                                <h3 className="text-xl font-bold mb-4 text-gray-800">Photos</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {serviceStop.photoUrls.map((photo, index) => (
                                        <img
                                            key={index}
                                            src={photo.url}
                                            alt={`Service stop photo ${index + 1}`}
                                            className="rounded-lg w-full h-40 object-cover"
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">Service Stop Tasks</h3>
                                    <p className="text-sm text-gray-600">
                                        Tasks completed or assigned for this stop
                                    </p>
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
                                    onSubmit={saveNewTask}
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
                                                onChange={(e) => handleTaskFieldChange("name", e.target.value)}
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
                                                onChange={(e) => handleTaskFieldChange("type", e.target.value)}
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
                                                Status
                                            </label>
                                            <select
                                                value={newTask.status}
                                                onChange={(e) => handleTaskFieldChange("status", e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
                                            >
                                                <option value="Not Finished">Not Finished</option>
                                                <option value="Finished">Finished</option>
                                                <option value="Skipped">Skipped</option>
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
                                                onChange={(e) =>
                                                    handleTaskFieldChange("contractedRate", e.target.value)
                                                }
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
                                                onChange={(e) =>
                                                    handleTaskFieldChange("estimatedTime", e.target.value)
                                                }
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                                placeholder="30"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">
                                                Actual Time (mins)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={newTask.actualTime}
                                                onChange={(e) => handleTaskFieldChange("actualTime", e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                                placeholder="0"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">
                                                Worker Name
                                            </label>
                                            <input
                                                type="text"
                                                value={newTask.workerName}
                                                onChange={(e) => handleTaskFieldChange("workerName", e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                                placeholder="Tech name"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">
                                                Worker Type
                                            </label>
                                            <input
                                                type="text"
                                                value={newTask.workerType}
                                                onChange={(e) => handleTaskFieldChange("workerType", e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                                placeholder="employee"
                                            />
                                        </div>
                                    </div>

                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={newTask.customerApproval}
                                            onChange={(e) =>
                                                handleTaskFieldChange("customerApproval", e.target.checked)
                                            }
                                        />
                                        Customer approved
                                    </label>

                                    {!!serviceStop.recurringServiceStopId && (
                                        <label className="flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={newTask.addToRecurringServiceStop}
                                                onChange={(e) =>
                                                    handleTaskFieldChange(
                                                        "addToRecurringServiceStop",
                                                        e.target.checked
                                                    )
                                                }
                                            />
                                            Also add to recurring service stop
                                        </label>
                                    )}

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
                                                resetTaskForm();
                                            }}
                                            className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-300 transition"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            )}

                            {taskList.length > 0 ? (
                                <div className="space-y-4">
                                    {taskList.map((task) => (
                                        <div
                                            key={task.id}
                                            className="rounded-xl border border-gray-200 p-4 hover:bg-gray-50 transition"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-semibold text-gray-900">
                                                        {task.name || "Unnamed Task"}
                                                    </p>
                                                    <p className="text-sm text-gray-500 mt-1">
                                                        {task.type || "—"}
                                                    </p>
                                                </div>

                                                <span
                                                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                                                        task.status
                                                    )}`}
                                                >
                                                    {task.status || "—"}
                                                </span>
                                            </div>

                                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                <div className="rounded-lg bg-gray-50 px-3 py-2">
                                                    <p className="text-gray-500">Contracted Rate</p>
                                                    <p className="font-medium text-gray-800">
                                                        {formatCurrencyFromCents(task.contractedRate)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-gray-50 px-3 py-2">
                                                    <p className="text-gray-500">Estimated Time</p>
                                                    <p className="font-medium text-gray-800">
                                                        {formatMinutes(task.estimatedTime)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-gray-50 px-3 py-2">
                                                    <p className="text-gray-500">Actual Time</p>
                                                    <p className="font-medium text-gray-800">
                                                        {formatMinutes(task.actualTime)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-gray-50 px-3 py-2">
                                                    <p className="text-gray-500">Customer Approval</p>
                                                    <p className="font-medium text-gray-800">
                                                        {yesNo(task.customerApproval)}
                                                    </p>
                                                </div>

                                                <div className="rounded-lg bg-gray-50 px-3 py-2">
                                                    <p className="text-gray-500">Worker</p>
                                                    <p className="font-medium text-gray-800">
                                                        {task.workerName || "—"}
                                                    </p>
                                                    {task.workerType && (
                                                        <p className="text-xs text-gray-500 mt-1">{task.workerType}</p>
                                                    )}
                                                </div>

                                                <div className="rounded-lg bg-gray-50 px-3 py-2">
                                                    <p className="text-gray-500">Worker ID</p>
                                                    <p className="font-medium text-gray-800 break-all">
                                                        {task.workerId || "—"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-gray-500">
                                    No tasks for this service stop.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ServiceStopDetails;