
import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, setDoc, Timestamp, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import toast from 'react-hot-toast';
import {
    estimatePlannedServiceStopPayRange,
    estimateServiceStopPaySummary,
    formatPayRate,
} from "../../../utils/payroll/payEstimate";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
    debugServiceStopTypeWrite,
    resolveServiceStopTypeFields,
    SERVICE_STOP_TYPE_USE_CASES,
} from "../../../utils/serviceStopTypes/serviceStopTypeResolver";

const CreateNewServiceStop = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const { jobId } = useParams();
    const plannedStopId = new URLSearchParams(location.search).get("plannedStopId") || "";

    const [activeTab, setActiveTab] = useState('site-info');
    const [job, setJob] = useState(null);
    const [serviceLocation, setServiceLocation] = useState(null);
    const [userList, setUserList] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [serviceDate, setServiceDate] = useState(new Date());
    const [description, setDescription] = useState('');
    const [taskList, setTaskList] = useState([]);
    const [selectedTasks, setSelectedTasks] = useState([]);
    const [taskTypeList, setTaskTypeList] = useState([]);
    const [taskGroupList, setTaskGroupList] = useState([]);
    const [selectedTaskType, setSelectedTaskType] = useState(null);
    const [selectedTaskGroup, setSelectedTaskGroup] = useState(null);
    const [taskDescription, setTaskDescription] = useState("");
    const [taskLaborCost, setTaskLaborCost] = useState("");
    const [taskEstimatedTime, setTaskEstimatedTime] = useState("");
    const [addingTask, setAddingTask] = useState(false);
    const [applyingTaskGroup, setApplyingTaskGroup] = useState(false);
    const [estimatedDuration, setEstimatedDuration] = useState(0);
    const [plannedServiceStops, setPlannedServiceStops] = useState([]);
    const [selectedPlannedStop, setSelectedPlannedStop] = useState(null);
    const [paySettings, setPaySettings] = useState(null);
    const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
    const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
    const [workTypeMappings, setWorkTypeMappings] = useState([]);
    const [technicianRates, setTechnicianRates] = useState([]);
    const [selectedManualServiceStopType, setSelectedManualServiceStopType] = useState(null);
    const [selectedPayWorkType, setSelectedPayWorkType] = useState(null);

    const moneyFromCents = (value) =>
        new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format((Number(value || 0) || 0) / 100);

    const getPlannedStopType = useCallback((stop) => {
        const typeId = stop?.serviceStopTypeId || stop?.typeId || "";
        if (!typeId) return null;

        return (
            companyServiceStopTypes.find((type) => type.id === typeId) || {
                id: typeId,
                name: stop.serviceStopTypeName || stop.type || "Service Stop",
                imageName: stop.serviceStopTypeImage || "",
                defaultWorkTypeIds: stop.defaultWorkTypeIds || [],
            }
        );
    }, [companyServiceStopTypes]);

    const serviceStopTypeOptions = useMemo(
        () =>
            companyServiceStopTypes
                .filter((type) => type.isActive !== false && type.active !== false && type.status !== "Inactive")
                .map((type) => ({
                    ...type,
                    value: type.id,
                    label: type.name || "Unnamed Service Stop Type",
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [companyServiceStopTypes]
    );

    const defaultJobServiceStopType = {
        id: "system_job_service_stop",
        name: "Job Visit",
        imageName: "briefcase",
        defaultWorkTypeIds: [],
        value: "system_job_service_stop",
        label: "Job Visit",
    };

    const selectedServiceStopType = useMemo(() => {
        if (selectedPlannedStop) return getPlannedStopType(selectedPlannedStop);
        return selectedManualServiceStopType || serviceStopTypeOptions[0] || defaultJobServiceStopType;
    }, [
        selectedPlannedStop,
        getPlannedStopType,
        selectedManualServiceStopType,
        serviceStopTypeOptions,
    ]);

    const workTypeOptions = useMemo(
        () =>
            companyWorkTypes
                .filter((type) => type.status !== "Inactive" && type.active !== false)
                .map((type) => ({
                    ...type,
                    value: type.id,
                    label: type.name || type.workTypeName || "Unnamed Work Type",
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [companyWorkTypes]
    );

    const selectedPaySummary = useMemo(() => {
        if (!selectedUser) return { lines: [], totalAmountCents: 0, needsReview: false };

        return estimateServiceStopPaySummary({
            companyId: recentlySelectedCompany,
            settings: paySettings,
            serviceStopType: selectedServiceStopType,
            serviceStopUseCaseSourceId: "system_job_service_stop",
            serviceStopWorkTypeIds: selectedPayWorkType?.id ? [selectedPayWorkType.id] : null,
            tasks: selectedTasks,
            worker: selectedUser,
            workTypes: companyWorkTypes,
            mappings: workTypeMappings,
            rates: technicianRates,
            date: serviceDate,
        });
    }, [
        recentlySelectedCompany,
        paySettings,
        selectedServiceStopType,
        selectedPayWorkType,
        selectedTasks,
        selectedUser,
        companyWorkTypes,
        workTypeMappings,
        technicianRates,
        serviceDate,
    ]);

    const selectedPlannedStopPayRange = useMemo(() => {
        if (!selectedPlannedStop) return null;

        const taskIds = Array.isArray(selectedPlannedStop.taskIds) ? selectedPlannedStop.taskIds : [];
        const tasks = taskIds.length
            ? taskList.filter((task) => taskIds.includes(task.id))
            : taskList;

        return estimatePlannedServiceStopPayRange({
            companyId: recentlySelectedCompany,
            settings: paySettings,
            serviceStopType: getPlannedStopType(selectedPlannedStop),
            serviceStopUseCaseSourceId: "system_job_service_stop",
            tasks,
            companyUsers: userList,
            workTypes: companyWorkTypes,
            mappings: workTypeMappings,
            rates: technicianRates,
            date: serviceDate,
        });
    }, [
        selectedPlannedStop,
        taskList,
        recentlySelectedCompany,
        paySettings,
        userList,
        getPlannedStopType,
        companyWorkTypes,
        workTypeMappings,
        technicianRates,
        serviceDate,
    ]);

    useEffect(() => {
        const fetchData = async () => {
            if (jobId && recentlySelectedCompany) {
                // Fetch Job Details
                const jobRef = doc(db, "companies", recentlySelectedCompany, 'workOrders', jobId);
                const jobSnap = await getDoc(jobRef);
                if (jobSnap.exists()) {
                    const jobData = jobSnap.data();
                    setJob(jobData);
                    setDescription(jobData.description);

                    // Fetch Service Location
                    const locRef = doc(db, "companies", recentlySelectedCompany, 'serviceLocations', jobData.serviceLocationId);
                    const locSnap = await getDoc(locRef);
                    if (locSnap.exists()) setServiceLocation(locSnap.data());

                    // Fetch Tasks
                    const tasksQuery = query(collection(db, "companies", recentlySelectedCompany, 'workOrders', jobId, 'tasks'));
                    const tasksSnapshot = await getDocs(tasksQuery);
                    const tasks = tasksSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                    setTaskList(tasks);

                    const plannedStopsSnapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, 'workOrders', jobId, 'plannedServiceStops'));
                    const plannedStops = plannedStopsSnapshot.docs
                        .map(doc => ({ ...doc.data(), id: doc.data().id || doc.id }))
                        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
                    setPlannedServiceStops(plannedStops);

                    const preferredPlannedStop = plannedStops.find((stop) => stop.id === plannedStopId) || null;
                    if (preferredPlannedStop) {
                        setSelectedPlannedStop(preferredPlannedStop);
                        setDescription(preferredPlannedStop.description || jobData.description || "");

                        const taskIds = Array.isArray(preferredPlannedStop.taskIds) ? preferredPlannedStop.taskIds : [];
                        setSelectedTasks(taskIds.length ? tasks.filter((task) => taskIds.includes(task.id)) : tasks);
                    }
                } else {
                    console.log("No such job document!");
                }

                // Fetch Users
                const usersQuery = query(collection(db, "companies", recentlySelectedCompany, 'companyUsers'));
                const usersSnapshot = await getDocs(usersQuery);
                setUserList(usersSnapshot.docs.map(doc => {
                    const data = doc.data();
                    const label =
                        data.userName ||
                        data.displayName ||
                        `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
                        data.name ||
                        "Unnamed User";

                    return {
                        ...data,
                        id: data.id || doc.id,
                        userId: data.userId || data.id || doc.id,
                        userName: data.userName || label,
                        value: data.id || doc.id,
                        label,
                    };
                }));

                const [
                    paySettingsSnap,
                    serviceStopTypesSnap,
                    workTypesSnap,
                    mappingsSnap,
                    ratesSnap,
                    taskTypesSnap,
                    legacyTaskGroupsSnap,
                    taskGroupsSnap,
                ] = await Promise.all([
                    getDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyServiceStopTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyWorkTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "workTypeMappings")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "technicianRates")),
                    getDocs(collection(db, "universal", "settings", "taskTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "taskGroup", "taskGroup")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups")),
                ]);

                setPaySettings(paySettingsSnap.exists() ? paySettingsSnap.data() : null);
                setCompanyServiceStopTypes(serviceStopTypesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setCompanyWorkTypes(workTypesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setWorkTypeMappings(mappingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setTechnicianRates(ratesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setTaskTypeList(
                    taskTypesSnap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        const name = data.name || "Task";

                        return {
                            ...data,
                            id: data.id || docSnap.id,
                            name,
                            value: name,
                            label: name,
                        };
                    })
                );
                setTaskGroupList([
                    ...legacyTaskGroupsSnap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        const id = data.id || docSnap.id;
                        const label = data.name || data.groupName || "Task Group";

                        return {
                            ...data,
                            id,
                            value: id,
                            label,
                            sourcePath: "legacy",
                        };
                    }),
                    ...taskGroupsSnap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        const id = data.id || docSnap.id;
                        const label = data.name || data.groupName || "Task Group";

                        return {
                            ...data,
                            id,
                            value: id,
                            label,
                            sourcePath: "current",
                        };
                    }),
                ]);
            }
        };
        fetchData();
    }, [jobId, recentlySelectedCompany, plannedStopId]);

    useEffect(() => {
        const duration = selectedTasks.reduce((acc, task) => acc + (task.estimatedTime || 0), 0);
        setEstimatedDuration(duration);
    }, [selectedTasks]);

    useEffect(() => {
        if (selectedManualServiceStopType || selectedPlannedStop || !serviceStopTypeOptions.length) return;

        const suggestedType =
            serviceStopTypeOptions.find((type) => {
                const name = String(type.name || "").toLowerCase();
                return name === "job visit" || name === "service call" || name.includes("job");
            }) || serviceStopTypeOptions[0];

        setSelectedManualServiceStopType(suggestedType);
    }, [selectedManualServiceStopType, selectedPlannedStop, serviceStopTypeOptions]);

    const toggleTaskSelection = (task) => {
        if (task.status === 'Scheduled' || task.status === 'Finished') {
            toast.error("Task is already scheduled or finished.");
            return;
        }
        setSelectedTasks(prev =>
            prev.find(t => t.id === task.id)
                ? prev.filter(t => t.id !== task.id)
                : [...prev, task]
        );
    };

    const dollarsToCents = (value) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.round(parsed * 100);
    };

    const buildJobTaskPayload = (task, overrides = {}) => ({
        id: task.id,
        name: task.name || task.description || "New Task",
        description: task.description || "",
        typeId: task.typeId || task.taskTypeId || "",
        type: task.type || task.taskType || selectedTaskType?.value || selectedTaskType?.name || "Task",
        contractedRate: Number(task.contractedRate || task.rate || task.laborCostCents || 0),
        estimatedTime: Number(task.estimatedTime || task.estimatedMinutes || 0),
        status: task.status || "Unassigned",
        customerApproval: task.customerApproval ?? false,
        actualTime: Number(task.actualTime || 0),
        workerId: task.workerId || "",
        workerType: task.workerType || "Not Assigned",
        workerName: task.workerName || "",
        laborContractId: task.laborContractId || "",
        serviceStopId: task.serviceStopId || {
            id: "",
            internalId: "",
        },
        equipmentId: task.equipmentId || "",
        serviceLocationId: task.serviceLocationId || job?.serviceLocationId || serviceLocation?.id || "",
        bodyOfWaterId: task.bodyOfWaterId || "",
        dataBaseItemId: task.dataBaseItemId || task.databaseItemId || "",
        ...overrides,
    });

    const saveJobTasks = async (tasksToSave, { selectAfterSave = true } = {}) => {
        const savedTasks = [];

        for (const task of tasksToSave) {
            const id = task.id || `comp_wo_tas_${uuidv4()}`;
            const payload = buildJobTaskPayload({ ...task, id });

            await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id), payload);
            savedTasks.push(payload);
        }

        if (!savedTasks.length) return [];

        setTaskList((prev) => [...prev, ...savedTasks]);

        if (selectAfterSave) {
            setSelectedTasks((prev) => {
                const existingIds = new Set(prev.map((task) => task.id));
                return [
                    ...prev,
                    ...savedTasks.filter((task) => !existingIds.has(task.id)),
                ];
            });
        }

        return savedTasks;
    };

    const addInlineTask = async () => {
        try {
            if (!recentlySelectedCompany || !jobId) return;
            if (!taskDescription.trim()) return toast.error("Add a task description.");
            if (!selectedTaskType?.value && !selectedTaskType?.name) return toast.error("Pick a task type.");

            setAddingTask(true);

            const savedTasks = await saveJobTasks([
                {
                    id: `comp_wo_tas_${uuidv4()}`,
                    name: taskDescription.trim(),
                    description: taskDescription.trim(),
                    typeId: selectedTaskType.id || "",
                    type: selectedTaskType.value || selectedTaskType.name,
                    contractedRate: dollarsToCents(taskLaborCost),
                    estimatedTime: Number(taskEstimatedTime || 0),
                    status: "Unassigned",
                },
            ]);

            if (savedTasks.length) {
                toast.success("Task added and selected.");
                setTaskDescription("");
                setSelectedTaskType(null);
                setTaskLaborCost("");
                setTaskEstimatedTime("");
            }
        } catch (error) {
            console.error("Error adding task from service stop:", error);
            toast.error("Failed to add task.");
        } finally {
            setAddingTask(false);
        }
    };

    const getTaskGroupTasks = async (taskGroup) => {
        const taskCollections = taskGroup?.sourcePath === "legacy"
            ? [
                collection(db, "companies", recentlySelectedCompany, "settings", "taskGroup", "taskGroup", taskGroup.id, "taskItems"),
                collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroup.id, "tasks"),
            ]
            : [
                collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups", taskGroup.id, "tasks"),
                collection(db, "companies", recentlySelectedCompany, "settings", "taskGroup", "taskGroup", taskGroup.id, "taskItems"),
            ];

        for (const taskCollection of taskCollections) {
            const snapshot = await getDocs(taskCollection);
            if (snapshot.docs.length) {
                return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
            }
        }

        return [];
    };

    const applyTaskGroupToJob = async (taskGroup) => {
        setSelectedTaskGroup(taskGroup || null);
        if (!taskGroup || !recentlySelectedCompany || !jobId) return;

        try {
            setApplyingTaskGroup(true);

            const groupTasks = await getTaskGroupTasks(taskGroup);
            if (!groupTasks.length) {
                toast.error("This task group does not have any tasks.");
                return;
            }

            const tasksToSave = groupTasks.map((task) => ({
                ...task,
                id: `comp_wo_tas_${uuidv4()}`,
                status: "Unassigned",
                workerId: "",
                workerType: "Not Assigned",
                workerName: "",
                serviceStopId: {
                    id: "",
                    internalId: "",
                },
            }));

            const savedTasks = await saveJobTasks(tasksToSave);
            toast.success(`${savedTasks.length} task${savedTasks.length === 1 ? "" : "s"} added and selected.`);
        } catch (error) {
            console.error("Error applying task group from service stop:", error);
            toast.error("Failed to apply task group.");
        } finally {
            setApplyingTaskGroup(false);
        }
    };

    const createServiceStop = async () => {
        if (!requirePermission("242", "create service stops")) return;

        if (!selectedUser || selectedTasks.length === 0) {
            alert("Please select a technician and at least one task.");
            return;
        }

        const serviceStopId = 'comp_ss_' + uuidv4();
        const serviceStopRef = doc(db, "companies", recentlySelectedCompany, 'serviceStops', serviceStopId);

        let serviceStopCount = 0;

        const ref = doc(db, "companies", recentlySelectedCompany, "settings", "recurringServiceStops");
        const snap = await getDoc(ref);

        if (snap.exists()) {
            const data = snap.data();
            serviceStopCount = typeof data.increment === "number" ? data.increment : 0;
        }
        console.log("");
        console.log(
            `[][] serviceStopCount: ${serviceStopCount}`
        );
        const updatedRecurringServiceStopCount = serviceStopCount + 1;
        await updateDoc(ref, { increment: updatedRecurringServiceStopCount });

        console.log("");
        console.log(
            `[][] RSS Count: ${String(updatedRecurringServiceStopCount)}`
        );
        let rate = 0

        const internalId = "SS" + String(serviceStopCount)
        const payWorkTypeId = selectedPayWorkType?.id || "";
        const payWorkTypeName = selectedPayWorkType?.name || selectedPayWorkType?.label || "";
        const resolvedTypeFields = resolveServiceStopTypeFields({
            companyServiceStopTypes,
            selectedType: selectedServiceStopType,
            selectedTypeId: selectedPlannedStop?.serviceStopTypeId || selectedPlannedStop?.typeId || "",
            fallbackName: selectedPlannedStop?.serviceStopTypeName || selectedPlannedStop?.type || "Job Visit",
            fallbackImage: selectedPlannedStop?.serviceStopTypeImage || "",
            useCase: SERVICE_STOP_TYPE_USE_CASES.jobVisit,
            context: "CreateNewServiceStop.createServiceStop",
        });

        if (selectedPaySummary.needsReview) {
            console.warn("[CreateNewServiceStop][payEstimateNeedsReview]", {
                jobId,
                selectedUserId: selectedUser.userId,
                selectedUserName: selectedUser.userName,
                selectedServiceStopTypeId: resolvedTypeFields.typeId,
                selectedServiceStopTypeName: resolvedTypeFields.type,
                selectedPayWorkTypeId: payWorkTypeId,
                selectedPayWorkTypeName: payWorkTypeName,
                totalAmountCents: selectedPaySummary.totalAmountCents,
                lines: selectedPaySummary.lines,
            });
        }

        const newServiceStop = {
            id: serviceStopId,
            address: serviceLocation.address,
            companyId: recentlySelectedCompany,
            companyName: recentlySelectedCompanyName,
            customerId: job.customerId,
            customerName: job.customerName,
            dateCreated: Timestamp.now(),
            serviceDate: Timestamp.fromDate(serviceDate),
            description,
            estimatedDuration,
            operationStatus: 'Not Finished',
            billingStatus: 'Not Invoiced',
            isInvoiced: false,
            contractedCompanyId: "",
            jobId,
            jobName: "",
            serviceLocationId: serviceLocation.id,
            tech: selectedUser.userName,
            techId: selectedUser.userId,
            internalId: internalId,
            checkList: [],
            mainCompanyId: "",
            otherCompany: false,
            laborContractId: "",
            endTime: null,
            startTime: null,
            includeDosages: true,
            includeReadings: true,
            estimatedPayCents: selectedPaySummary.totalAmountCents,
            estimatedPayLines: selectedPaySummary.lines,
            payWorkTypeId,
            payWorkTypeName,
            workTypeId: payWorkTypeId,
            workTypeName: payWorkTypeName,
            defaultWorkTypeIds: resolvedTypeFields.defaultWorkTypeIds,
            plannedServiceStopId: selectedPlannedStop?.id || "",
            rate: rate ?? 0,
            recurringServiceStopId: "",
            type: resolvedTypeFields.type,
            typeId: resolvedTypeFields.typeId,
            typeImage: resolvedTypeFields.typeImage,
            category: resolvedTypeFields.category,
            serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,
            duration: estimatedDuration || 15


        };

        debugServiceStopTypeWrite({
            context: "CreateNewServiceStop.createServiceStop",
            payload: newServiceStop,
        });
        await setDoc(serviceStopRef, newServiceStop);

        for (const task of selectedTasks) {
            const taskId = 'comp_ss_tas_' + uuidv4();
            const taskRef = doc(db, "companies", recentlySelectedCompany, 'serviceStops', serviceStopId, 'tasks', taskId);
            await setDoc(taskRef, {
                ...task,
                id: taskId,
                workerId: selectedUser.userId,
                workerName: selectedUser.userName,
                status: 'Scheduled',
                serviceStopId: {
                    id: serviceStopId,
                    internalId,
                },
                jobId: {
                    id: jobId,
                    internalId: job?.internalId || "",
                },
                recurringServiceStopId: {
                    id: "",
                    internalId: "",
                },
                jobTaskId: task.id,
                workTypeId: task.workTypeId || payWorkTypeId,
                workTypeName: task.workTypeName || payWorkTypeName,
                workOrderTaskId: task.id,
            });
            rate += Number(task.rate || task.contractedRate || 0)
            const workOrderTaskRef = doc(db, 'companies', recentlySelectedCompany, "workOrders", jobId, 'tasks', task.id);
            await updateDoc(workOrderTaskRef, {
                status: 'Scheduled',
                workerId: selectedUser.userId,
                workerName: selectedUser.userName,
                serviceStopId: {
                    id: serviceStopId,
                    internalId,
                },
                serviceStopIdString: serviceStopId,
            });
        }
        await updateDoc(serviceStopRef, { rate: rate });

        //Update Job to have ids
        if (jobId !== "") {

            const jobRef = doc(db, 'companies', recentlySelectedCompany, "workOrders", jobId);
            const jobUpdates = {
                serviceStopIds: arrayUnion(serviceStopId),
                operationStatus: "Scheduled",
            };

            if (!job.billingStatus || job.billingStatus === "Draft") {
                jobUpdates.billingStatus = "In Progress";
            }

            await updateDoc(jobRef, jobUpdates);
        }
        navigate(`/company/jobs/detail/${jobId}`, {
            state: {
                scheduledServiceStopId: serviceStopId,
                scheduledServiceStopInternalId: internalId,
            },
        });
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'site-info': return <SiteInfoTab job={job} location={serviceLocation} description={description} setDescription={setDescription} plannedServiceStops={plannedServiceStops} selectedPlannedStop={selectedPlannedStop} setSelectedPlannedStop={setSelectedPlannedStop} taskList={taskList} setSelectedTasks={setSelectedTasks} selectedPlannedStopPayRange={selectedPlannedStopPayRange} moneyFromCents={moneyFromCents} serviceStopTypeOptions={serviceStopTypeOptions} selectedServiceStopType={selectedServiceStopType} selectedManualServiceStopType={selectedManualServiceStopType} setSelectedManualServiceStopType={setSelectedManualServiceStopType} />;
            case 'assign-tech': return <AssignTechTab users={userList} selectedUser={selectedUser} setSelectedUser={setSelectedUser} date={serviceDate} setDate={setServiceDate} workTypeOptions={workTypeOptions} selectedPayWorkType={selectedPayWorkType} setSelectedPayWorkType={setSelectedPayWorkType} selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />;
            case 'select-tasks': return (
                <TasksTab
                    tasks={taskList}
                    selectedTasks={selectedTasks}
                    toggleTask={toggleTaskSelection}
                    estimatedDuration={estimatedDuration}
                    taskTypeList={taskTypeList}
                    selectedTaskType={selectedTaskType}
                    setSelectedTaskType={setSelectedTaskType}
                    taskDescription={taskDescription}
                    setTaskDescription={setTaskDescription}
                    taskLaborCost={taskLaborCost}
                    setTaskLaborCost={setTaskLaborCost}
                    taskEstimatedTime={taskEstimatedTime}
                    setTaskEstimatedTime={setTaskEstimatedTime}
                    addInlineTask={addInlineTask}
                    addingTask={addingTask}
                    taskGroupList={taskGroupList}
                    selectedTaskGroup={selectedTaskGroup}
                    applyTaskGroupToJob={applyTaskGroupToJob}
                    applyingTaskGroup={applyingTaskGroup}
                />
            );
            case 'review': return <ReviewTab job={job} location={serviceLocation} tech={selectedUser?.userName} date={serviceDate} tasks={selectedTasks} duration={estimatedDuration} selectedServiceStopType={selectedServiceStopType} selectedPayWorkType={selectedPayWorkType} selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />;
            default: return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto bg-white shadow-lg rounded-xl p-6">
                <h2 className="text-3xl font-bold text-gray-800 mb-6">Create New Service Stop</h2>
                <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
                <div className="py-6">{renderTabContent()}</div>
                <div className="flex justify-between items-center pt-4 border-t">
                    <button onClick={() => navigate(`/company/jobs/detail/${jobId}`)} className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition">Cancel</button>
                    <button onClick={createServiceStop} className="py-2 px-6 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition" disabled={!selectedUser || selectedTasks.length === 0}>Schedule Service Stop</button>
                </div>
            </div>
        </div>
    );
};

const TabNavigation = ({ activeTab, setActiveTab }) => (
    <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            {[
                { id: 'site-info', name: 'Site & Job Info' },
                { id: 'assign-tech', name: 'Assign Tech & Date' },
                { id: 'select-tasks', name: 'Select Tasks' },
                { id: 'review', name: 'Review & Schedule' },
            ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                    {tab.name}
                </button>
            ))}
        </nav>
    </div>
);

const SiteInfoTab = ({
    job,
    location,
    description,
    setDescription,
    plannedServiceStops,
    selectedPlannedStop,
    setSelectedPlannedStop,
    taskList,
    setSelectedTasks,
    selectedPlannedStopPayRange,
    moneyFromCents,
    serviceStopTypeOptions,
    selectedServiceStopType,
    selectedManualServiceStopType,
    setSelectedManualServiceStopType,
}) => {
    const plannedStopOptions = plannedServiceStops.map((stop) => ({
        ...stop,
        value: stop.id,
        label: stop.name || stop.serviceStopTypeName || "Planned Service Stop",
    }));

    const handlePlannedStopChange = (option) => {
        setSelectedPlannedStop(option || null);
        if (!option) return;

        const taskIds = Array.isArray(option.taskIds) ? option.taskIds : [];
        setSelectedTasks(taskIds.length ? taskList.filter((task) => taskIds.includes(task.id)) : taskList);
        if (option.description) setDescription(option.description);
    };

    const rangeLabel =
        selectedPlannedStopPayRange &&
            selectedPlannedStopPayRange.minAmountCents !== selectedPlannedStopPayRange.maxAmountCents
            ? `${moneyFromCents(selectedPlannedStopPayRange.minAmountCents)} - ${moneyFromCents(selectedPlannedStopPayRange.maxAmountCents)}`
            : moneyFromCents(selectedPlannedStopPayRange?.maxAmountCents || 0);

    const selectedServiceStopOption = selectedServiceStopType
        ? {
            ...selectedServiceStopType,
            value: selectedServiceStopType.id,
            label: selectedServiceStopType.name || selectedServiceStopType.label || "Service Stop Type",
        }
        : null;

    return (
    <div className="space-y-4">
        <InfoCard title="Job Details" data={job ? { Job: job.internalId || "Job", Customer: job.customerName, Type: job.type } : {}} />
        <InfoCard title="Service Location" data={location ? { Name: location.nickName, Address: `${location.address.streetAddress}, ${location.address.city}` } : {}} />
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1">
                Service Stop Type
            </label>
            <Select
                options={serviceStopTypeOptions}
                value={selectedPlannedStop ? selectedServiceStopOption : selectedManualServiceStopType || selectedServiceStopOption}
                onChange={setSelectedManualServiceStopType}
                placeholder="Select service stop type"
                isDisabled={Boolean(selectedPlannedStop)}
                styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }}
            />
            <p className="mt-2 text-xs text-gray-500">
                This classifies the stop. Payroll work types are derived from this unless you set a pay override later.
            </p>
            {selectedPlannedStop && (
                <p className="mt-1 text-xs font-semibold text-blue-700">
                    Using the service stop type from the planned service stop.
                </p>
            )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1">
                Planned Service Stop
            </label>
            <Select
                options={plannedStopOptions}
                value={selectedPlannedStop ? { ...selectedPlannedStop, value: selectedPlannedStop.id, label: selectedPlannedStop.name || selectedPlannedStop.serviceStopTypeName || "Planned Service Stop" } : null}
                onChange={handlePlannedStopChange}
                placeholder="Optional: schedule from planned stop"
                isClearable
                styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }}
            />

            {selectedPlannedStop && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg bg-white border border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</p>
                        <p className="mt-1 font-semibold text-gray-800">
                            {selectedPlannedStop.serviceStopTypeName || "Service Stop"}
                        </p>
                    </div>
                    <div className="rounded-lg bg-white border border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pay Range</p>
                        <p className="mt-1 font-semibold text-gray-800">{rangeLabel}</p>
                    </div>
                    <div className="rounded-lg bg-white border border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cost Planning</p>
                        <p className="mt-1 font-semibold text-gray-800">
                            {moneyFromCents(selectedPlannedStopPayRange?.maxAmountCents || 0)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">Uses highest eligible tech pay</p>
                    </div>
                </div>
            )}
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700">Description Override</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 rounded-lg" rows="3" />
        </div>
    </div>
    );
};

const InfoCard = ({ title, data }) => (
    <div className="p-4 border rounded-lg">
        <h4 className="font-bold text-lg mb-2">{title}</h4>
        {Object.entries(data).map(([key, value]) => <p key={key}><strong>{key}:</strong> {value}</p>)}
    </div>
);

const PaySummaryCard = ({ selectedPaySummary, moneyFromCents }) => (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 md:col-span-full">
        <div className="flex items-start justify-between gap-3">
            <div>
                <p className="text-sm font-semibold text-gray-800">Expected Technician Pay</p>
                <p className="text-sm text-gray-600 mt-1">
                    Based on selected technician, service stop type, selected tasks, and active technician rates.
                </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-sm font-bold">
                {moneyFromCents(selectedPaySummary.totalAmountCents)}
            </span>
        </div>

        {selectedPaySummary.needsReview && (
            <p className="mt-3 text-xs font-semibold text-amber-700">
                One or more pay lines needs rate review.
            </p>
        )}

        <div className="mt-4 space-y-2">
            {!selectedPaySummary.lines.length ? (
                <p className="text-sm text-gray-500">Select a technician and tasks to calculate expected pay.</p>
            ) : (
                selectedPaySummary.lines.map((line) => (
                    <div key={line.id} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-gray-800">{line.title}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {line.workTypeName || "Unmapped"} • {formatPayRate(line)}
                                </p>
                            </div>
                            <p className="text-sm font-bold text-gray-800">
                                {moneyFromCents(line.totalAmountCents)}
                            </p>
                        </div>
                        {line.notes && <p className="mt-2 text-xs text-gray-500">{line.notes}</p>}
                    </div>
                ))
            )}
        </div>
    </div>
);

const AssignTechTab = ({
    users,
    selectedUser,
    setSelectedUser,
    date,
    setDate,
    workTypeOptions,
    selectedPayWorkType,
    setSelectedPayWorkType,
    selectedPaySummary,
    moneyFromCents,
}) => (
    <div className="grid md:grid-cols-3 gap-6">
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign Technician</label>
            <Select options={users} value={selectedUser} onChange={setSelectedUser} placeholder="Select a technician..." styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }} />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
            <DatePicker selected={date} onChange={setDate} className="w-full p-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pay Work Type Override</label>
            <Select
                options={workTypeOptions}
                value={selectedPayWorkType}
                onChange={setSelectedPayWorkType}
                placeholder="Use mapped/default type"
                isClearable
                styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }}
            />
            <p className="mt-1 text-xs text-gray-500">
                Overrides service stop pay for this scheduled stop.
            </p>
        </div>
        <PaySummaryCard selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />
    </div>
);

const TasksTab = ({
    tasks,
    selectedTasks,
    toggleTask,
    estimatedDuration,
    taskTypeList,
    selectedTaskType,
    setSelectedTaskType,
    taskDescription,
    setTaskDescription,
    taskLaborCost,
    setTaskLaborCost,
    taskEstimatedTime,
    setTaskEstimatedTime,
    addInlineTask,
    addingTask,
    taskGroupList,
    selectedTaskGroup,
    applyTaskGroupToJob,
    applyingTaskGroup,
}) => {
    const [showAllTasks, setShowAllTasks] = useState(false);
    const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 5);
    const hiddenTaskCount = Math.max(tasks.length - 5, 0);

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 className="text-xl font-semibold">Select Tasks for this Stop</h3>
                    <p className="mt-1 text-sm text-gray-600">
                        Add tasks here without leaving the service stop workflow.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                        {selectedTasks.length} selected
                    </span>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                        {estimatedDuration} mins
                    </span>
                </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <label className="mb-1 block text-sm font-semibold text-gray-700">
                    Add Task Group
                </label>
                <Select
                    options={taskGroupList}
                    value={selectedTaskGroup}
                    onChange={applyTaskGroupToJob}
                    placeholder={applyingTaskGroup ? "Adding task group..." : "Select a task group to add and select tasks"}
                    isClearable
                    isDisabled={applyingTaskGroup}
                    styles={{ control: (p) => ({ ...p, padding: '0.25rem' }) }}
                />
                <p className="mt-2 text-xs text-gray-500">
                    Selecting a task group adds those tasks to the job and selects them for this service stop.
                </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h4 className="font-semibold text-gray-800">Add New Task</h4>
                        <p className="text-xs text-gray-500">Saved to the job and selected for this stop.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)_120px_120px_auto]">
                    <input
                        value={taskDescription}
                        onChange={(e) => setTaskDescription(e.target.value)}
                        placeholder="Task description"
                        className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                    />

                    <Select
                        options={taskTypeList}
                        value={selectedTaskType}
                        onChange={setSelectedTaskType}
                        placeholder="Task type"
                        styles={{ control: (p) => ({ ...p, minHeight: 42 }) }}
                    />

                    <input
                        value={taskLaborCost}
                        onChange={(e) => setTaskLaborCost(e.target.value)}
                        placeholder="Labor $"
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                    />

                    <input
                        value={taskEstimatedTime}
                        onChange={(e) => setTaskEstimatedTime(e.target.value)}
                        placeholder="Mins"
                        type="number"
                        min="0"
                        className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                    />

                    <button
                        type="button"
                        onClick={addInlineTask}
                        disabled={addingTask}
                        className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {addingTask ? "Adding..." : "Add & Select"}
                    </button>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
                    <div>
                        <p className="text-sm font-semibold text-gray-800">Job Tasks</p>
                        <p className="text-xs text-gray-500">Click a row to include it on this service stop.</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-600">
                        {tasks.length} total
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-white">
                            <tr>
                                <th className="p-3 text-left text-xs font-medium uppercase text-gray-500">Task</th>
                                <th className="p-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
                                <th className="p-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                                <th className="p-3 text-left text-xs font-medium uppercase text-gray-500">Est. Time</th>
                                <th className="p-3 text-left text-xs font-medium uppercase text-gray-500">Selected</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleTasks.map((task) => {
                                const selected = selectedTasks.some((selectedTask) => selectedTask.id === task.id);
                                const disabled = task.status === "Scheduled" || task.status === "Finished";

                                return (
                                    <tr
                                        key={task.id}
                                        onClick={() => toggleTask(task)}
                                        className={[
                                            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                                            selected ? "bg-blue-50" : "hover:bg-gray-50",
                                        ].join(" ")}
                                    >
                                        <td className="p-3 font-medium text-gray-900">{task.name}</td>
                                        <td className="p-3 text-sm text-gray-700">{task.type || "—"}</td>
                                        <td className="p-3 whitespace-nowrap">
                                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-800">
                                                {task.status || "—"}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-gray-700">{task.estimatedTime || 0} mins</td>
                                        <td className="p-3 text-sm font-semibold text-gray-700">
                                            {selected ? "Yes" : "No"}
                                        </td>
                                    </tr>
                                );
                            })}

                            {!tasks.length && (
                                <tr>
                                    <td colSpan={5} className="p-6 text-center text-sm text-gray-500">
                                        No tasks on this job yet. Add one above or select a task group.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {hiddenTaskCount > 0 && (
                    <div className="border-t border-gray-200 bg-white px-4 py-3 text-center">
                        <button
                            type="button"
                            onClick={() => setShowAllTasks((prev) => !prev)}
                            className="text-sm font-semibold text-blue-700 hover:text-blue-900"
                        >
                            {showAllTasks ? "Show first 5 tasks" : `Show ${hiddenTaskCount} more task${hiddenTaskCount === 1 ? "" : "s"}`}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const ReviewTab = ({ job, location, tech, date, tasks, duration, selectedServiceStopType, selectedPayWorkType, selectedPaySummary, moneyFromCents }) => (
    <div className="space-y-4">
        <h3 className="text-xl font-semibold">Review & Confirm</h3>
        <div className="p-4 border rounded-lg space-y-2">
            <p><strong>Job:</strong> {job?.internalId} for {job?.customerName}</p>
            <p><strong>Location:</strong> {location?.nickName} at {location?.address.streetAddress}</p>
            <p><strong>Technician:</strong> {tech || 'Not Assigned'}</p>
            <p><strong>Service Date:</strong> {date.toLocaleDateString()}</p>
            <p><strong>Service Stop Type:</strong> {selectedServiceStopType?.label || selectedServiceStopType?.name || "Job Visit"}</p>
            <p><strong>Pay Work Type Override:</strong> {selectedPayWorkType?.label || "Using service stop type defaults"}</p>
            <p><strong>Total Duration:</strong> {duration} minutes</p>
            <p><strong>Expected Pay:</strong> {moneyFromCents(selectedPaySummary.totalAmountCents)}</p>
            <div>
                <h4 className="font-bold mt-2">Selected Tasks:</h4>
                <ul className="list-disc list-inside pl-4">
                    {tasks.map(t => <li key={t.id}>{t.name}</li>)}
                </ul>
            </div>
        </div>
        <PaySummaryCard selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />
    </div>
);

export default CreateNewServiceStop;
