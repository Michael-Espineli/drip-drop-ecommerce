import React, { useState, useEffect, useContext } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where,
    addDoc,
    updateDoc,
    arrayUnion,
    writeBatch,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { ServiceStop } from "../../../utils/models/ServiceStop";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { runWorkCompletionEffects } from "../../../utils/workCompletionEffects";
import { promptForReplacementInstallDetails } from "../../../utils/replacementTasks";
import {
    buildStopDataRecord,
    fetchStopDataForServiceStop,
    normalizeDosageForStopData,
    normalizeReadingForStopData,
    saveStopDataRecord,
} from "../../../utils/stopData";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

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

const equipmentTaskTypes = new Set([
    "Clean Filter",
    "Maintenance",
    "Repair",
    "Remove",
    "Replace",
]);

const taskNeedsEquipment = (type) => equipmentTaskTypes.has(type);

const ServiceStopDetails = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const { serviceStopId } = useParams();
    const navigate = useNavigate();

    const [serviceStop, setServiceStop] = useState(null);
    const [taskList, setTaskList] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [readingTemplates, setReadingTemplates] = useState([]);
    const [dosageTemplates, setDosageTemplates] = useState([]);
    const [stopDataRecords, setStopDataRecords] = useState([]);
    const [selectedBodyOfWaterId, setSelectedBodyOfWaterId] = useState("");
    const [readingDrafts, setReadingDrafts] = useState({});
    const [dosageDrafts, setDosageDrafts] = useState({});
    const [observationDraft, setObservationDraft] = useState("");
    const [savingStopData, setSavingStopData] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

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

                    const [readingTemplatesSnapshot, dosageTemplatesSnapshot, loadedStopData] = await Promise.all([
                        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings")),
                        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages")),
                        fetchStopDataForServiceStop({
                            db,
                            companyId: recentlySelectedCompany,
                            serviceStopId,
                        }),
                    ]);

                    setReadingTemplates(
                        readingTemplatesSnapshot.docs.map((readingDoc) => ({
                            id: readingDoc.id,
                            ...readingDoc.data(),
                        }))
                    );
                    setDosageTemplates(
                        dosageTemplatesSnapshot.docs.map((dosageDoc) => ({
                            id: dosageDoc.id,
                            ...dosageDoc.data(),
                        }))
                    );
                    setStopDataRecords(loadedStopData);

                    if (stopData.serviceLocationId) {
                        const bodyOfWaterQuery = query(
                            collection(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "bodiesOfWater"
                            ),
                            where("serviceLocationId", "==", stopData.serviceLocationId)
                        );
                        const equipmentQuery = query(
                            collection(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "equipment"
                            ),
                            where("serviceLocationId", "==", stopData.serviceLocationId)
                        );
                        const [bodyOfWaterSnapshot, equipmentSnapshot] = await Promise.all([
                            getDocs(bodyOfWaterQuery),
                            getDocs(equipmentQuery),
                        ]);
                        setBodiesOfWater(
                            bodyOfWaterSnapshot.docs.map((doc) => ({
                                id: doc.id,
                                ...doc.data(),
                            }))
                        );
                        setEquipmentList(
                            equipmentSnapshot.docs.map((doc) => ({
                                id: doc.id,
                                ...doc.data(),
                            }))
                        );
                    } else {
                        setBodiesOfWater([]);
                        setEquipmentList([]);
                    }

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

    useEffect(() => {
        if (selectedBodyOfWaterId || !bodiesOfWater.length) return;
        setSelectedBodyOfWaterId(bodiesOfWater[0].id);
    }, [bodiesOfWater, selectedBodyOfWaterId]);

    useEffect(() => {
        if (!selectedBodyOfWaterId) {
            setReadingDrafts({});
            setDosageDrafts({});
            setObservationDraft("");
            return;
        }

        const currentStopData = stopDataRecords.find((record) => record.bodyOfWaterId === selectedBodyOfWaterId);
        const readingsByTemplateId = new Map(
            (currentStopData?.readings || []).map((reading) => [reading.templateId || reading.universalTemplateId, reading])
        );
        const dosagesByTemplateId = new Map(
            (currentStopData?.dosages || []).map((dosage) => [dosage.templateId || dosage.universalTemplateId, dosage])
        );

        setReadingDrafts(
            Object.fromEntries(
                readingTemplates.map((template) => {
                    const reading = readingsByTemplateId.get(template.id) || readingsByTemplateId.get(template.readingsTemplateId);
                    return [template.id, reading?.amount || ""];
                })
            )
        );
        setDosageDrafts(
            Object.fromEntries(
                dosageTemplates.map((template) => {
                    const dosage = dosagesByTemplateId.get(template.id) || dosagesByTemplateId.get(template.dosageTemplateId);
                    return [template.id, dosage?.amount || ""];
                })
            )
        );
        setObservationDraft((currentStopData?.observation || []).join("\n"));
    }, [dosageTemplates, readingTemplates, selectedBodyOfWaterId, stopDataRecords]);

    const selectedStopDataRecord = stopDataRecords.find((record) => record.bodyOfWaterId === selectedBodyOfWaterId) || null;

    const saveStopData = async () => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !selectedBodyOfWaterId) return;

        try {
            setSavingStopData(true);
            const readings = readingTemplates.map((template) =>
                normalizeReadingForStopData(template, readingDrafts[template.id] || "", selectedBodyOfWaterId)
            );
            const dosages = dosageTemplates.map((template) =>
                normalizeDosageForStopData(template, dosageDrafts[template.id] || "", selectedBodyOfWaterId)
            );
            const observation = observationDraft
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
            const stopData = buildStopDataRecord({
                existingStopData: selectedStopDataRecord,
                serviceStop,
                serviceStopId,
                bodyOfWaterId: selectedBodyOfWaterId,
                readings,
                dosages,
                observation,
                userId: serviceStop.techId || "",
                date: new Date(),
            });

            const savedStopData = await saveStopDataRecord({
                db,
                companyId: recentlySelectedCompany,
                stopData,
            });

            setStopDataRecords((current) => {
                const others = current.filter((record) => record.id !== savedStopData.id);
                return [savedStopData, ...others];
            });
            toast.success("Stop data saved");
        } catch (error) {
            console.error("Failed to save stop data:", error);
            toast.error("Failed to save stop data");
        } finally {
            setSavingStopData(false);
        }
    };

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

    const statusForTasks = (tasks = []) => {
        if (!tasks.length) return serviceStop?.operationStatus || "Not Finished";
        const finishedCount = tasks.filter((task) => task.status === "Finished").length;
        if (finishedCount === tasks.length) return "Finished";
        if (finishedCount > 0) return "In Progress";
        return "Not Finished";
    };

    const updateServiceStopStatusFromTasks = async (tasks = []) => {
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return serviceStop?.operationStatus || "";

        const nextStatus = statusForTasks(tasks);
        if (!nextStatus || nextStatus === serviceStop.operationStatus) return nextStatus;

        await updateDoc(
            doc(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId),
            { operationStatus: nextStatus }
        );

        setServiceStop((prev) => ({
            ...prev,
            operationStatus: nextStatus,
        }));

        return nextStatus;
    };

    const handleTaskFieldChange = (field, value) => {
        setNewTask((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const saveNewTask = async (e) => {
        e.preventDefault();
        if (!requirePermission("244", "update service stops")) return;

        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        if (!newTask.name.trim()) {
            toast.error("Task name is required");
            return;
        }

        if (!newTask.type) {
            toast.error("Task type is required");
            return;
        }

        if (["Fill Water", "Empty Water"].includes(newTask.type) && !newTask.bodyOfWaterId) {
            toast.error("Select a body of water for this task");
            return;
        }

        if (taskNeedsEquipment(newTask.type) && !newTask.equipmentId) {
            toast.error("Select equipment for this task");
            return;
        }

        try {
            setSavingTask(true);
            const replacementInstallDetails =
                newTask.status === "Finished" ? promptForReplacementInstallDetails(newTask) : {};

            if (replacementInstallDetails === null) {
                toast.error("Replacement install details are required before finishing this task");
                setSavingTask(false);
                return;
            }

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
                ...(replacementInstallDetails || {}),
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

            if (createdTask.status === "Finished") {
                const effects = await runWorkCompletionEffects({
                    db,
                    companyId: recentlySelectedCompany,
                    task: createdTask,
                    serviceStop,
                    currentJobOperationStatus: serviceStop?.operationStatus || "",
                    syncJobStatus: true,
                });

                if (effects.equipmentHistory?.replacementEquipmentId) {
                    const replacementUpdates = {
                        replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId,
                        installedEquipmentId: effects.equipmentHistory.replacementEquipmentId,
                        ...(effects.equipmentHistory.installedPurchasedItemId
                            ? {
                                purchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                                installedPurchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                            }
                            : {}),
                    };
                    await updateDoc(taskRef, replacementUpdates);
                    Object.assign(createdTask, replacementUpdates);
                }
            }

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
                    bodyOfWaterId: newTask.bodyOfWaterId || "",
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

            const nextTasks = [createdTask, ...taskList];
            await updateServiceStopStatusFromTasks(nextTasks);
            setTaskList(nextTasks);
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

    const markTaskFinished = async (task) => {
        if (!requirePermission("244", "update service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop || !task?.id) return;

        try {
            const taskRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "serviceStops",
                serviceStopId,
                "tasks",
                task.id
            );

            const installDetails = promptForReplacementInstallDetails(task);
            if (installDetails === null) {
                toast.error("Replacement install details are required before finishing this task");
                return;
            }

            const finishedTask = { ...task, ...installDetails, status: "Finished" };

            const effects = await runWorkCompletionEffects({
                db,
                companyId: recentlySelectedCompany,
                task: finishedTask,
                serviceStop,
                currentJobOperationStatus: serviceStop?.operationStatus || "",
                syncJobStatus: true,
            });

            const taskUpdates = {
                status: "Finished",
                ...(installDetails?.installedEquipmentName ? { installedEquipmentName: installDetails.installedEquipmentName } : {}),
                ...(installDetails?.installedEquipmentType ? { installedEquipmentType: installDetails.installedEquipmentType } : {}),
                ...(installDetails?.installedEquipmentMake ? { installedEquipmentMake: installDetails.installedEquipmentMake } : {}),
                ...(installDetails?.installedEquipmentModel ? { installedEquipmentModel: installDetails.installedEquipmentModel } : {}),
                ...(installDetails?.installedEquipmentNotes ? { installedEquipmentNotes: installDetails.installedEquipmentNotes } : {}),
                ...(effects.equipmentHistory?.replacementEquipmentId
                    ? {
                        replacementEquipmentId: effects.equipmentHistory.replacementEquipmentId,
                        installedEquipmentId: effects.equipmentHistory.replacementEquipmentId,
                    }
                    : {}),
                ...(effects.equipmentHistory?.installedPurchasedItemId
                    ? {
                        purchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                        installedPurchasedItemId: effects.equipmentHistory.installedPurchasedItemId,
                    }
                    : {}),
            };

            await updateDoc(taskRef, taskUpdates);

            const syncedFinishedTask = { ...finishedTask, ...taskUpdates };
            const nextTasks = taskList.map((item) =>
                item.id === task.id ? syncedFinishedTask : item
            );
            await updateServiceStopStatusFromTasks(nextTasks);
            setTaskList(nextTasks);

            toast.success("Task marked finished");
        } catch (error) {
            console.error(error);
            toast.error("Failed to finish task");
        }
    };

    const handleDeleteServiceStop = async () => {
        if (!requirePermission("246", "delete service stops")) return;
        if (!recentlySelectedCompany || !serviceStopId || !serviceStop) return;

        try {
            setDeleting(true);

            const batch = writeBatch(db);
            const serviceStopRef = doc(
                db,
                "companies",
                recentlySelectedCompany,
                "serviceStops",
                serviceStopId
            );

            const taskSnapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "tasks"
                )
            );
            taskSnapshot.docs.forEach((taskDoc) => batch.delete(taskDoc.ref));

            const storeSnapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "stores"
                )
            );
            storeSnapshot.docs.forEach((storeDoc) => batch.delete(storeDoc.ref));

            const historySnapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "serviceStops",
                    serviceStopId,
                    "history"
                )
            );
            historySnapshot.docs.forEach((historyDoc) => batch.delete(historyDoc.ref));

            const stopDataSnapshot = await getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "stopData"),
                    where("serviceStopId", "==", serviceStopId)
                )
            );
            stopDataSnapshot.docs.forEach((stopDataDoc) => batch.delete(stopDataDoc.ref));

            const routesSnapshot = await getDocs(
                query(
                    collection(db, "companies", recentlySelectedCompany, "activeRoutes"),
                    where("serviceStopsIds", "array-contains", serviceStopId)
                )
            );
            routesSnapshot.docs.forEach((routeDoc) => {
                const route = routeDoc.data();
                const remainingStopIds = (route.serviceStopsIds || []).filter((id) => id !== serviceStopId);
                const wasFinished = ["finished", "completed", "done", "complete"].includes(
                    String(serviceStop.operationStatus || "").toLowerCase()
                );
                const finishedStops = Math.max(
                    0,
                    Math.min(
                        remainingStopIds.length,
                        Number(route.finishedStops || 0) - (wasFinished ? 1 : 0)
                    )
                );

                batch.update(routeDoc.ref, {
                    serviceStopsIds: remainingStopIds,
                    order: Array.isArray(route.order)
                        ? route.order
                            .filter((item) => (item.serviceStopId || item.id) !== serviceStopId)
                            .map((item, index) => ({ ...item, order: index + 1 }))
                        : [],
                    totalStops: remainingStopIds.length,
                    finishedStops,
                    status: remainingStopIds.length === 0
                        ? "Did Not Start"
                        : finishedStops === remainingStopIds.length
                            ? "Finished"
                            : finishedStops > 0
                                ? "In Progress"
                                : (route.status || "Did Not Start"),
                });
            });

            batch.delete(serviceStopRef);
            await batch.commit();

            toast.success("Service stop deleted");
            navigate("/company/serviceStops");
        } catch (error) {
            console.error("Error deleting service stop:", error);
            toast.error("Failed to delete service stop");
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
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
                    {can("246") && (
                        <button
                            type="button"
                            onClick={() => setShowDeleteConfirm(true)}
                            className="px-4 py-2 rounded-lg border border-red-200 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 transition"
                        >
                            Delete
                        </button>
                    )}
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

                                <Field label="Job">
                                    {serviceStop.jobId ? (
                                        <Link
                                            to={`/company/jobs/detail/${serviceStop.jobId}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {serviceStop.jobInternalId || "Open Job"}
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

                        {(serviceStop.includeReadings || serviceStop.includeDosages || readingTemplates.length || dosageTemplates.length) && (
                            <div className="bg-white shadow-lg rounded-xl p-6">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-800">Stop Data</h3>
                                        <p className="text-sm text-gray-600 mt-1">Readings, dosages, and observations for this service stop.</p>
                                    </div>
                                    <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                                        {selectedStopDataRecord ? "Saved" : "Not saved"}
                                    </span>
                                </div>

                                {bodiesOfWater.length ? (
                                    <div className="mt-5 space-y-5">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-600 mb-1">
                                                Body of Water
                                            </label>
                                            <select
                                                value={selectedBodyOfWaterId}
                                                onChange={(event) => setSelectedBodyOfWaterId(event.target.value)}
                                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                                            >
                                                {bodiesOfWater.map((body) => (
                                                    <option key={body.id} value={body.id}>
                                                        {body.name || body.type || "Unnamed Body Of Water"}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {serviceStop.includeReadings !== false && readingTemplates.length > 0 && (
                                            <div>
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <h4 className="font-semibold text-gray-800">Readings</h4>
                                                    <span className="text-xs font-semibold text-gray-500">
                                                        {Object.values(readingDrafts).filter(Boolean).length}/{readingTemplates.length}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {readingTemplates.map((template) => (
                                                        <label key={template.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                                            <span className="block text-sm font-semibold text-gray-700">
                                                                {template.name || "Reading"}
                                                            </span>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={readingDrafts[template.id] || ""}
                                                                    onChange={(event) =>
                                                                        setReadingDrafts((current) => ({
                                                                            ...current,
                                                                            [template.id]: event.target.value,
                                                                        }))
                                                                    }
                                                                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                                                                    placeholder="Amount"
                                                                />
                                                                {template.UOM && (
                                                                    <span className="shrink-0 text-xs font-semibold text-gray-500">
                                                                        {template.UOM}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {serviceStop.includeDosages !== false && dosageTemplates.length > 0 && (
                                            <div>
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <h4 className="font-semibold text-gray-800">Dosages</h4>
                                                    <span className="text-xs font-semibold text-gray-500">
                                                        {Object.values(dosageDrafts).filter(Boolean).length}/{dosageTemplates.length}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {dosageTemplates.map((template) => (
                                                        <label key={template.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                                            <span className="block text-sm font-semibold text-gray-700">
                                                                {template.name || "Dosage"}
                                                            </span>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={dosageDrafts[template.id] || ""}
                                                                    onChange={(event) =>
                                                                        setDosageDrafts((current) => ({
                                                                            ...current,
                                                                            [template.id]: event.target.value,
                                                                        }))
                                                                    }
                                                                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                                                                    placeholder="Amount"
                                                                />
                                                                {template.UOM && (
                                                                    <span className="shrink-0 text-xs font-semibold text-gray-500">
                                                                        {template.UOM}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <label className="block">
                                            <span className="block text-sm font-semibold text-gray-600 mb-1">Observations</span>
                                            <textarea
                                                value={observationDraft}
                                                onChange={(event) => setObservationDraft(event.target.value)}
                                                rows={3}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="One observation per line"
                                            />
                                        </label>

                                        <div className="flex justify-end">
                                            <button
                                                type="button"
                                                onClick={saveStopData}
                                                disabled={savingStopData || !selectedBodyOfWaterId}
                                                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {savingStopData ? "Saving..." : "Save Stop Data"}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">
                                        Add a body of water to this service location before recording stop data.
                                    </div>
                                )}
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

                                {!showAddTask && can("244") && (
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

                                        {["Fill Water", "Empty Water"].includes(newTask.type) && (
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-600 mb-1">
                                                    Body of Water
                                                </label>
                                                <select
                                                    value={newTask.bodyOfWaterId}
                                                    onChange={(e) => handleTaskFieldChange("bodyOfWaterId", e.target.value)}
                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
                                                >
                                                    <option value="">Select body of water</option>
                                                    {bodiesOfWater.map((body) => (
                                                        <option key={body.id} value={body.id}>
                                                            {body.name || "Unnamed Body Of Water"}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {taskNeedsEquipment(newTask.type) && (
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-600 mb-1">
                                                    Equipment
                                                </label>
                                                <select
                                                    value={newTask.equipmentId}
                                                    onChange={(e) => handleTaskFieldChange("equipmentId", e.target.value)}
                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
                                                >
                                                    <option value="">Select equipment</option>
                                                    {equipmentList.map((equipment) => (
                                                        <option key={equipment.id} value={equipment.id}>
                                                            {equipment.name || equipment.model || equipment.type || "Unnamed Equipment"}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

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

                                            {task.status !== "Finished" && can("244") && (
                                                <div className="mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => markTaskFinished(task)}
                                                        className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition"
                                                    >
                                                        Mark Finished
                                                    </button>
                                                </div>
                                            )}

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
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-xl font-bold text-gray-900">Delete Service Stop</h3>
                        <p className="mt-3 text-sm text-gray-600">
                            This will delete this service stop and its tasks/readings history. This cannot be undone.
                        </p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={deleting}
                                className="px-4 py-2 rounded-lg bg-gray-100 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteServiceStop}
                                disabled={deleting}
                                className="px-4 py-2 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                {deleting ? "Deleting..." : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ServiceStopDetails;
