
import React, { useState, useEffect, useContext, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, setDoc, Timestamp, updateDoc, arrayUnion, where } from "firebase/firestore";
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

const SERVICE_STOP_CATEGORY_OPTIONS = [
    {
        id: "jobVisit",
        label: "Job",
        helper: "Work connected to a job or work order.",
        useCase: SERVICE_STOP_TYPE_USE_CASES.jobVisit,
        category: "Job",
        sourceId: "system_job_service_stop",
        fallbackType: "Job Visit",
        fallbackImage: "briefcase",
    },
    {
        id: "jobEstimate",
        label: "Job Estimate",
        helper: "Fact finding for requested work before quoting.",
        useCase: SERVICE_STOP_TYPE_USE_CASES.jobEstimate,
        category: "Job Estimate",
        sourceId: "system_job_estimate_service_stop",
        fallbackType: "Job Estimate",
        fallbackImage: "doc.text.magnifyingglass",
    },
    {
        id: "serviceAgreementEstimate",
        label: "Service Agreement Estimate",
        helper: "Survey a location before recurring service.",
        useCase: SERVICE_STOP_TYPE_USE_CASES.serviceAgreementEstimate,
        category: "Service Agreement Estimate",
        sourceId: "system_service_agreement_estimate_service_stop",
        fallbackType: "Service Agreement Estimate",
        fallbackImage: "list.clipboard",
    },
    {
        id: "customerRelationship",
        label: "Customer Relationship",
        helper: "Open-ended customer visit, follow-up, or correction.",
        useCase: SERVICE_STOP_TYPE_USE_CASES.customerRelationship,
        category: "Customer Relationship",
        sourceId: "system_customer_relationship_service_stop",
        fallbackType: "Customer Relationship",
        fallbackImage: "person.wave.2",
    },
];

const normalizeCategory = (value = "") =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[_/-]/g, "");

const categoryOptionForParam = (value, hasJob = false) => {
    const normalized = normalizeCategory(value);
    const matched = SERVICE_STOP_CATEGORY_OPTIONS.find((option) => (
        normalizeCategory(option.id) === normalized ||
        normalizeCategory(option.label) === normalized ||
        normalizeCategory(option.category) === normalized ||
        normalizeCategory(option.useCase) === normalized
    ));

    if (matched) {
        if (hasJob && !["jobVisit", "jobEstimate"].includes(matched.id)) {
            return SERVICE_STOP_CATEGORY_OPTIONS[0];
        }

        return matched;
    }

    return hasJob ? SERVICE_STOP_CATEGORY_OPTIONS[0] : SERVICE_STOP_CATEGORY_OPTIONS[2];
};

const serviceStopTypeMatchesCategory = (type, categoryOption) => {
    const typeValues = [
        type?.category,
        type?.serviceStopCategory,
        type?.serviceStopTypeCategory,
        type?.useCase,
        type?.serviceStopTypeUseCase,
        type?.serviceStopTypeUseCaseRawValue,
        type?.typeUseCase,
        type?.id,
    ].map(normalizeCategory).filter(Boolean);
    const categoryValues = [
        categoryOption.category,
        categoryOption.label,
        categoryOption.id,
        categoryOption.useCase,
        categoryOption.sourceId,
    ].map(normalizeCategory).filter(Boolean);

    return typeValues.some((value) => categoryValues.includes(value));
};

const addressLine = (address = {}) => [
    address.streetAddress,
    address.city,
    address.state,
    address.zip || address.zipCode,
].filter(Boolean).join(", ");

const CreateNewServiceStop = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const { jobId } = useParams();
    const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const plannedStopId = searchParams.get("plannedStopId") || "";
    const queryCustomerId = searchParams.get("customerId") || "";
    const queryServiceLocationId = searchParams.get("serviceLocationId") || "";
    const queryLeadId = searchParams.get("leadId") || "";
    const queryCategory = searchParams.get("category") || "";
    const isJobScheduler = Boolean(jobId);

    const [activeTab, setActiveTab] = useState('site-info');
    const [job, setJob] = useState(null);
    const [customerList, setCustomerList] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [serviceLocation, setServiceLocation] = useState(null);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [leadContext, setLeadContext] = useState(null);
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
    const [estimatedDuration, setEstimatedDuration] = useState(60);
    const [plannedServiceStops, setPlannedServiceStops] = useState([]);
    const [selectedPlannedStop, setSelectedPlannedStop] = useState(null);
    const [paySettings, setPaySettings] = useState(null);
    const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
    const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
    const [workTypeMappings, setWorkTypeMappings] = useState([]);
    const [technicianRates, setTechnicianRates] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(() => categoryOptionForParam(queryCategory, Boolean(jobId)));
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

    const allServiceStopTypeOptions = useMemo(
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

    const serviceStopTypeOptions = useMemo(() => {
        return allServiceStopTypeOptions.filter((type) => serviceStopTypeMatchesCategory(type, selectedCategory));
    }, [allServiceStopTypeOptions, selectedCategory]);

    const categoryFallbackServiceStopType = useMemo(() => ({
        id: selectedCategory.sourceId,
        name: selectedCategory.fallbackType,
        imageName: selectedCategory.fallbackImage,
        category: selectedCategory.category,
        defaultWorkTypeIds: [],
        value: selectedCategory.sourceId,
        label: selectedCategory.fallbackType,
    }), [selectedCategory]);

    const selectedServiceStopType = useMemo(() => {
        if (selectedPlannedStop) return getPlannedStopType(selectedPlannedStop);
        return selectedManualServiceStopType || serviceStopTypeOptions[0] || categoryFallbackServiceStopType;
    }, [
        selectedPlannedStop,
        getPlannedStopType,
        selectedManualServiceStopType,
        serviceStopTypeOptions,
        categoryFallbackServiceStopType,
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
            serviceStopUseCaseSourceId: selectedCategory.sourceId,
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
        selectedCategory,
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
        setSelectedCategory(categoryOptionForParam(queryCategory, Boolean(jobId)));
        setSelectedManualServiceStopType(null);
    }, [queryCategory, jobId]);

    useEffect(() => {
        const fetchSharedData = async () => {
            if (!recentlySelectedCompany) return;

            try {
                const [
                    usersSnapshot,
                    paySettingsSnap,
                    serviceStopTypesSnap,
                    workTypesSnap,
                    mappingsSnap,
                    ratesSnap,
                    taskTypesSnap,
                    legacyTaskGroupsSnap,
                    taskGroupsSnap,
                ] = await Promise.all([
                    getDocs(collection(db, "companies", recentlySelectedCompany, 'companyUsers')),
                    getDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyServiceStopTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyWorkTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "workTypeMappings")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "technicianRates")),
                    getDocs(collection(db, "universal", "settings", "taskTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "taskGroup", "taskGroup")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "taskGroups", "taskGroups")),
                ]);

                setUserList(usersSnapshot.docs.map(docSnap => {
                    const data = docSnap.data();
                    const label =
                        data.userName ||
                        data.displayName ||
                        `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
                        data.name ||
                        "Unnamed User";

                    return {
                        ...data,
                        id: data.id || docSnap.id,
                        userId: data.userId || data.id || docSnap.id,
                        userName: data.userName || label,
                        value: data.userId || data.id || docSnap.id,
                        label,
                    };
                }));

                setPaySettings(paySettingsSnap.exists() ? paySettingsSnap.data() : null);
                setCompanyServiceStopTypes(serviceStopTypesSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
                setCompanyWorkTypes(workTypesSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
                setWorkTypeMappings(mappingsSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
                setTechnicianRates(ratesSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
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
            } catch (error) {
                console.error("Failed to load service stop scheduler settings:", error);
                toast.error("Failed to load scheduler settings.");
            }
        };

        fetchSharedData();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        const fetchJobData = async () => {
            if (!jobId || !recentlySelectedCompany) return;

            try {
                const jobRef = doc(db, "companies", recentlySelectedCompany, 'workOrders', jobId);
                const jobSnap = await getDoc(jobRef);
                if (!jobSnap.exists()) {
                    console.log("No such job document!");
                    return;
                }

                const jobData = { id: jobSnap.id, ...jobSnap.data() };
                setJob(jobData);
                setSelectedCustomer({
                    id: jobData.customerId,
                    value: jobData.customerId,
                    label: jobData.customerName || "Customer",
                    firstName: jobData.customerName || "",
                    lastName: "",
                });
                setDescription(jobData.description || "");

                const locRef = doc(db, "companies", recentlySelectedCompany, 'serviceLocations', jobData.serviceLocationId);
                const locSnap = await getDoc(locRef);
                if (locSnap.exists()) setServiceLocation({ id: locSnap.id, ...locSnap.data() });

                const tasksQuery = query(collection(db, "companies", recentlySelectedCompany, 'workOrders', jobId, 'tasks'));
                const tasksSnapshot = await getDocs(tasksQuery);
                const tasks = tasksSnapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
                setTaskList(tasks);

                const plannedStopsSnapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, 'workOrders', jobId, 'plannedServiceStops'));
                const plannedStops = plannedStopsSnapshot.docs
                    .map(docSnap => ({ ...docSnap.data(), id: docSnap.data().id || docSnap.id }))
                    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
                setPlannedServiceStops(plannedStops);

                const preferredPlannedStop = plannedStops.find((stop) => stop.id === plannedStopId) || null;
                if (preferredPlannedStop) {
                    setSelectedPlannedStop(preferredPlannedStop);
                    setDescription(preferredPlannedStop.description || jobData.description || "");

                    const taskIds = Array.isArray(preferredPlannedStop.taskIds) ? preferredPlannedStop.taskIds : [];
                    setSelectedTasks(taskIds.length ? tasks.filter((task) => taskIds.includes(task.id)) : tasks);
                }
            } catch (error) {
                console.error("Failed to load job service stop data:", error);
                toast.error("Failed to load job details.");
            }
        };

        fetchJobData();
    }, [jobId, recentlySelectedCompany, plannedStopId]);

    useEffect(() => {
        const fetchStandaloneContext = async () => {
            if (jobId || !recentlySelectedCompany) return;

            try {
                setJob(null);
                setTaskList([]);
                setSelectedTasks([]);
                setPlannedServiceStops([]);
                setSelectedPlannedStop(null);

                let nextLead = null;
                if (queryLeadId) {
                    const leadSnap = await getDoc(doc(db, "homeownerServiceRequests", queryLeadId));
                    if (leadSnap.exists()) {
                        nextLead = { id: leadSnap.id, ...leadSnap.data() };
                        setLeadContext(nextLead);
                        setDescription(nextLead.serviceDescription || "");
                        setSelectedCategory(categoryOptionForParam(queryCategory || "serviceAgreementEstimate", false));
                    }
                } else {
                    setLeadContext(null);
                }

                const customersSnapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, "customers"));
                const customers = customersSnapshot.docs
                    .map((docSnap) => {
                        const data = docSnap.data();
                        const label =
                            data.displayName ||
                            data.customerName ||
                            `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
                            data.company ||
                            "Unnamed Customer";

                        return {
                            ...data,
                            id: data.id || docSnap.id,
                            value: data.id || docSnap.id,
                            label,
                        };
                    })
                    .sort((a, b) => a.label.localeCompare(b.label));

                setCustomerList(customers);

                const preferredCustomerId = queryCustomerId || nextLead?.customerId || "";
                const preferredCustomer = customers.find((customer) => customer.id === preferredCustomerId) || null;
                setSelectedCustomer(preferredCustomer);
            } catch (error) {
                console.error("Failed to load standalone service stop context:", error);
                toast.error("Failed to load customer context.");
            }
        };

        fetchStandaloneContext();
    }, [jobId, recentlySelectedCompany, queryCustomerId, queryLeadId, queryCategory]);

    useEffect(() => {
        const fetchServiceLocationsForCustomer = async () => {
            if (jobId || !recentlySelectedCompany || !selectedCustomer?.id) {
                if (!jobId) {
                    setServiceLocationList([]);
                    setServiceLocation(null);
                }
                return;
            }

            try {
                const locationsSnapshot = await getDocs(query(
                    collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
                    where("customerId", "==", selectedCustomer.id)
                ));
                const locations = locationsSnapshot.docs
                    .map((docSnap) => {
                        const data = docSnap.data();
                        const label = data.nickName || data.name || addressLine(data.address) || "Service Location";
                        return {
                            ...data,
                            id: data.id || docSnap.id,
                            value: data.id || docSnap.id,
                            label,
                        };
                    })
                    .sort((a, b) => a.label.localeCompare(b.label));

                setServiceLocationList(locations);

                const preferredLocationId = queryServiceLocationId || leadContext?.serviceLocationId || leadContext?.companyServiceLocationId || "";
                const preferredLocation = locations.find((item) => item.id === preferredLocationId) || locations[0] || null;
                setServiceLocation(preferredLocation);
            } catch (error) {
                console.error("Failed to load service locations:", error);
                toast.error("Failed to load service locations.");
            }
        };

        fetchServiceLocationsForCustomer();
    }, [
        jobId,
        recentlySelectedCompany,
        selectedCustomer?.id,
        queryServiceLocationId,
        leadContext?.serviceLocationId,
        leadContext?.companyServiceLocationId,
    ]);

    useEffect(() => {
        const duration = selectedTasks.reduce((acc, task) => acc + (task.estimatedTime || 0), 0);
        if (selectedTasks.length) {
            setEstimatedDuration(duration);
        }
    }, [selectedTasks]);

    useEffect(() => {
        if (selectedManualServiceStopType || selectedPlannedStop || !serviceStopTypeOptions.length) return;

        const suggestedType = serviceStopTypeOptions[0];

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

    const addLocalTasks = (tasksToAdd, { selectAfterSave = true } = {}) => {
        const savedTasks = tasksToAdd.map((task) => {
            const id = task.id || `comp_ss_tas_${uuidv4()}`;
            return buildJobTaskPayload({
                ...task,
                id,
                status: task.status || "Unassigned",
            });
        });

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
            if (!recentlySelectedCompany) return;
            if (!taskDescription.trim()) return toast.error("Add a task description.");
            if (!selectedTaskType?.value && !selectedTaskType?.name) return toast.error("Pick a task type.");

            setAddingTask(true);

            const tasksToAdd = [
                {
                    id: jobId ? `comp_wo_tas_${uuidv4()}` : `comp_ss_tas_${uuidv4()}`,
                    name: taskDescription.trim(),
                    description: taskDescription.trim(),
                    typeId: selectedTaskType.id || "",
                    type: selectedTaskType.value || selectedTaskType.name,
                    contractedRate: dollarsToCents(taskLaborCost),
                    estimatedTime: Number(taskEstimatedTime || 0),
                    status: "Unassigned",
                },
            ];

            const savedTasks = jobId
                ? await saveJobTasks(tasksToAdd)
                : addLocalTasks(tasksToAdd);

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
        if (!taskGroup || !recentlySelectedCompany) return;

        try {
            setApplyingTaskGroup(true);

            const groupTasks = await getTaskGroupTasks(taskGroup);
            if (!groupTasks.length) {
                toast.error("This task group does not have any tasks.");
                return;
            }

            const tasksToSave = groupTasks.map((task) => ({
                ...task,
                id: jobId ? `comp_wo_tas_${uuidv4()}` : `comp_ss_tas_${uuidv4()}`,
                status: "Unassigned",
                workerId: "",
                workerType: "Not Assigned",
                workerName: "",
                serviceStopId: {
                    id: "",
                    internalId: "",
                },
            }));

            const savedTasks = jobId
                ? await saveJobTasks(tasksToSave)
                : addLocalTasks(tasksToSave);
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

        const activeCustomer = job
            ? {
                id: job.customerId,
                label: job.customerName,
            }
            : selectedCustomer;
        const activeServiceLocation = serviceLocation;

        if (!selectedUser) {
            alert("Please select a technician.");
            return;
        }

        if (!activeCustomer?.id || !activeServiceLocation?.id) {
            alert("Please select a customer and service location.");
            return;
        }

        if (jobId && selectedCategory.id === "jobVisit" && selectedTasks.length === 0) {
            alert("Please select at least one task for the job stop.");
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
        await setDoc(ref, { increment: updatedRecurringServiceStopCount }, { merge: true });

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
            fallbackName: selectedPlannedStop?.serviceStopTypeName || selectedPlannedStop?.type || selectedCategory.fallbackType,
            fallbackImage: selectedPlannedStop?.serviceStopTypeImage || "",
            useCase: selectedCategory.useCase,
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
            address: activeServiceLocation.address || leadContext?.serviceLocationAddress || {},
            companyId: recentlySelectedCompany,
            companyName: recentlySelectedCompanyName,
            customerId: activeCustomer.id,
            customerName: activeCustomer.label || activeCustomer.customerName || activeCustomer.displayName || "",
            dateCreated: Timestamp.now(),
            serviceDate: Timestamp.fromDate(serviceDate),
            description,
            estimatedDuration,
            operationStatus: 'Not Finished',
            billingStatus: 'Not Invoiced',
            isInvoiced: false,
            contractedCompanyId: "",
            jobId: jobId || "",
            jobName: job?.description || job?.internalId || leadContext?.serviceName || "",
            serviceLocationId: activeServiceLocation.id,
            tech: selectedUser.userName,
            techId: selectedUser.userId,
            internalId: internalId,
            checkList: [],
            mainCompanyId: "",
            otherCompany: false,
            laborContractId: "",
            endTime: null,
            startTime: null,
            includeDosages: selectedCategory.id === "serviceAgreementEstimate" || selectedCategory.id === "jobVisit",
            includeReadings: selectedCategory.id === "serviceAgreementEstimate" || selectedCategory.id === "jobVisit",
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
            leadId: leadContext?.id || queryLeadId || "",
            source: jobId ? "CreateNewServiceStopJob" : "CreateNewServiceStopStandalone",
            serviceNotes: "",
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
                    id: jobId || "",
                    internalId: job?.internalId || "",
                },
                recurringServiceStopId: {
                    id: "",
                    internalId: "",
                },
                jobTaskId: task.id,
                workTypeId: task.workTypeId || payWorkTypeId,
                workTypeName: task.workTypeName || payWorkTypeName,
                workOrderTaskId: jobId ? task.id : "",
            });
            rate += Number(task.rate || task.contractedRate || 0)
            if (jobId) {
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
        }
        await updateDoc(serviceStopRef, { rate: rate });

        //Update Job to have ids
        if (jobId && job) {

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

        if (leadContext?.id || queryLeadId) {
            await updateDoc(doc(db, "homeownerServiceRequests", leadContext?.id || queryLeadId), {
                serviceEstimateServiceStopId: serviceStopId,
                initialEstimateServiceStopId: serviceStopId,
            }).catch((error) => {
                console.warn("Unable to update lead with service stop id.", error);
            });
        }

        navigate(jobId ? `/company/jobs/detail/${jobId}` : `/company/serviceStops/detail/${serviceStopId}`, {
            state: {
                scheduledServiceStopId: serviceStopId,
                scheduledServiceStopInternalId: internalId,
            },
        });
    };

    const handleCategoryChange = (categoryOption) => {
        setSelectedCategory(categoryOption);
        setSelectedManualServiceStopType(null);
        setSelectedPlannedStop(null);
    };

    const handleCustomerChange = (customerOption) => {
        setSelectedCustomer(customerOption || null);
        setServiceLocation(null);
    };

    const activeCustomer = job
        ? {
            id: job.customerId,
            label: job.customerName,
        }
        : selectedCustomer;
    const requiresTasksForSchedule = Boolean(jobId && selectedCategory.id === "jobVisit");
    const categoryOptionsForScheduler = isJobScheduler
        ? SERVICE_STOP_CATEGORY_OPTIONS.filter((option) => ["jobVisit", "jobEstimate"].includes(option.id))
        : SERVICE_STOP_CATEGORY_OPTIONS;

    const canSchedule = Boolean(
        selectedUser &&
        activeCustomer?.id &&
        serviceLocation?.id &&
        (!requiresTasksForSchedule || selectedTasks.length > 0)
    );

    const cancelPath = jobId ? `/company/jobs/detail/${jobId}` : "/company/serviceStops";

    const renderTabContent = () => {
        switch (activeTab) {
            case 'site-info': return (
                <SiteInfoTab
                    isJobScheduler={isJobScheduler}
                    job={job}
                    location={serviceLocation}
                    description={description}
                    setDescription={setDescription}
                    plannedServiceStops={plannedServiceStops}
                    selectedPlannedStop={selectedPlannedStop}
                    setSelectedPlannedStop={setSelectedPlannedStop}
                    taskList={taskList}
                    setSelectedTasks={setSelectedTasks}
                    selectedPlannedStopPayRange={selectedPlannedStopPayRange}
                    moneyFromCents={moneyFromCents}
                    categoryOptions={categoryOptionsForScheduler}
                    selectedCategory={selectedCategory}
                    setSelectedCategory={handleCategoryChange}
                    customerOptions={customerList}
                    selectedCustomer={selectedCustomer}
                    setSelectedCustomer={handleCustomerChange}
                    serviceLocationOptions={serviceLocationList}
                    selectedServiceLocation={serviceLocation}
                    setSelectedServiceLocation={setServiceLocation}
                    leadContext={leadContext}
                    serviceStopTypeOptions={serviceStopTypeOptions}
                    selectedServiceStopType={selectedServiceStopType}
                    selectedManualServiceStopType={selectedManualServiceStopType}
                    setSelectedManualServiceStopType={setSelectedManualServiceStopType}
                />
            );
            case 'assign-tech': return (
                <AssignTechTab
                    users={userList}
                    selectedUser={selectedUser}
                    setSelectedUser={setSelectedUser}
                    date={serviceDate}
                    setDate={setServiceDate}
                    estimatedDuration={estimatedDuration}
                    setEstimatedDuration={setEstimatedDuration}
                    workTypeOptions={workTypeOptions}
                    selectedPayWorkType={selectedPayWorkType}
                    setSelectedPayWorkType={setSelectedPayWorkType}
                    selectedPaySummary={selectedPaySummary}
                    moneyFromCents={moneyFromCents}
                />
            );
            case 'select-tasks': return (
                <TasksTab
                    isJobScheduler={isJobScheduler}
                    requiresTasksForSchedule={requiresTasksForSchedule}
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
            case 'review': return (
                <ReviewTab
                    isJobScheduler={isJobScheduler}
                    job={job}
                    customer={activeCustomer}
                    location={serviceLocation}
                    selectedCategory={selectedCategory}
                    description={description}
                    tech={selectedUser?.userName}
                    date={serviceDate}
                    tasks={selectedTasks}
                    duration={estimatedDuration}
                    selectedServiceStopType={selectedServiceStopType}
                    selectedPayWorkType={selectedPayWorkType}
                    selectedPaySummary={selectedPaySummary}
                    moneyFromCents={moneyFromCents}
                />
            );
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
                    <button onClick={() => navigate(cancelPath)} className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition">Cancel</button>
                    <button
                        onClick={createServiceStop}
                        className="py-2 px-6 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canSchedule}
                    >
                        Schedule Service Stop
                    </button>
                </div>
            </div>
        </div>
    );
};

const TabNavigation = ({ activeTab, setActiveTab }) => (
    <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            {[
                { id: 'site-info', name: 'Site & Stop Info' },
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
    isJobScheduler,
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
    categoryOptions,
    selectedCategory,
    setSelectedCategory,
    customerOptions,
    selectedCustomer,
    setSelectedCustomer,
    serviceLocationOptions,
    selectedServiceLocation,
    setSelectedServiceLocation,
    leadContext,
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

    const locationAddress = location?.address
        ? addressLine(location.address)
        : addressLine(leadContext?.serviceLocationAddress || {});
    const serviceLocationName = location?.nickName || location?.name || leadContext?.serviceLocationName || "Service Location";
    const leadCustomerName = leadContext?.customerName || leadContext?.homeownerName || leadContext?.name || "";

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
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3">
                <h3 className="text-base font-bold text-gray-900">Service Stop Category</h3>
                <p className="mt-1 text-sm text-gray-600">
                    {selectedCategory.helper}
                </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {categoryOptions.map((option) => {
                    const selected = selectedCategory.id === option.id;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => setSelectedCategory(option)}
                            className={[
                                "rounded-lg border p-4 text-left transition",
                                selected
                                    ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                                    : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/40",
                            ].join(" ")}
                        >
                            <span className="block text-sm font-bold text-gray-900">{option.label}</span>
                            <span className="mt-1 block text-xs text-gray-600">{option.helper}</span>
                        </button>
                    );
                })}
            </div>
        </div>

        {leadContext && (
            <InfoCard
                title="Lead Context"
                data={{
                    Lead: leadContext.serviceName || leadContext.title || "Service request",
                    Customer: leadCustomerName,
                    Status: leadContext.status,
                    Source: leadContext.source || (leadContext.publicLead ? "Public" : ""),
                }}
            />
        )}

        {!isJobScheduler && (
            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Customer
                    </label>
                    <Select
                        options={customerOptions}
                        value={selectedCustomer}
                        onChange={setSelectedCustomer}
                        placeholder="Select customer"
                        isClearable
                        styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }}
                    />
                    <p className="mt-2 text-xs text-gray-500">
                        Standalone service stops still need a customer account before they can be scheduled.
                    </p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Service Location
                    </label>
                    <Select
                        options={serviceLocationOptions}
                        value={selectedServiceLocation}
                        onChange={setSelectedServiceLocation}
                        placeholder={selectedCustomer ? "Select service location" : "Select a customer first"}
                        isClearable
                        isDisabled={!selectedCustomer}
                        styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }}
                    />
                    <p className="mt-2 text-xs text-gray-500">
                        The location sets the address and lets the field app collect visit information in the right place.
                    </p>
                </div>
            </div>
        )}

        {isJobScheduler && (
            <InfoCard title="Job Details" data={job ? { Job: job.internalId || "Job", Customer: job.customerName, Type: job.type } : {}} />
        )}

        <InfoCard
            title="Service Location"
            data={location ? { Name: serviceLocationName, Address: locationAddress } : {}}
        />

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
        {isJobScheduler && plannedServiceStops.length > 0 && (
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
        )}
        <div>
            <label className="block text-sm font-medium text-gray-700">Planned Work / Visit Notes</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 rounded-lg" rows="3" />
        </div>
    </div>
    );
};

const InfoCard = ({ title, data }) => (
    <div className="p-4 border rounded-lg">
        <h4 className="font-bold text-lg mb-2">{title}</h4>
        {Object.entries(data || {})
            .filter(([, value]) => value !== undefined && value !== null && value !== "")
            .map(([key, value]) => <p key={key}><strong>{key}:</strong> {value}</p>)}
        {!Object.entries(data || {}).some(([, value]) => value !== undefined && value !== null && value !== "") && (
            <p className="text-sm text-gray-500">Not selected yet.</p>
        )}
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
    estimatedDuration,
    setEstimatedDuration,
    workTypeOptions,
    selectedPayWorkType,
    setSelectedPayWorkType,
    selectedPaySummary,
    moneyFromCents,
}) => (
    <div className="grid md:grid-cols-4 gap-6">
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign Technician</label>
            <Select options={users} value={selectedUser} onChange={setSelectedUser} placeholder="Select a technician..." styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }} />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
            <DatePicker selected={date} onChange={setDate} className="w-full p-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Duration</label>
            <input
                type="number"
                min="0"
                step="5"
                value={estimatedDuration}
                onChange={(event) => setEstimatedDuration(Number(event.target.value || 0))}
                className="w-full rounded-lg border border-gray-300 p-2"
            />
            <p className="mt-1 text-xs text-gray-500">Minutes scheduled for the field visit.</p>
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
    isJobScheduler,
    requiresTasksForSchedule,
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
                    <h3 className="text-xl font-semibold">
                        {isJobScheduler ? "Select Job Tasks for this Stop" : "Tasks for this Stop"}
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">
                        {isJobScheduler && requiresTasksForSchedule
                            ? "Select or add the job tasks that should be scheduled on this visit."
                            : isJobScheduler
                                ? "Tasks are optional for job estimate visits. Add them only when the estimate needs checklist-level detail."
                            : "Tasks are optional for standalone visits. Add them when you want checklist-level detail."}
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
                    Selecting a task group adds those tasks and selects them for this service stop.
                </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h4 className="font-semibold text-gray-800">Add New Task</h4>
                        <p className="text-xs text-gray-500">
                            {isJobScheduler ? "Saved to the job and selected for this stop." : "Saved directly on this service stop when scheduled."}
                        </p>
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
                        <p className="text-sm font-semibold text-gray-800">
                            {isJobScheduler ? "Job Tasks" : "Service Stop Tasks"}
                        </p>
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
                                        {isJobScheduler && requiresTasksForSchedule
                                            ? "No tasks on this job yet. Add one above or select a task group."
                                            : isJobScheduler
                                                ? "No tasks selected. Job estimate service stops can be scheduled without tasks."
                                            : "No tasks added yet. Standalone service stops can be scheduled without tasks."}
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

const ReviewTab = ({
    isJobScheduler,
    job,
    customer,
    location,
    selectedCategory,
    description,
    tech,
    date,
    tasks,
    duration,
    selectedServiceStopType,
    selectedPayWorkType,
    selectedPaySummary,
    moneyFromCents,
}) => {
    const locationAddress = addressLine(location?.address || {});
    const customerName = customer?.label || customer?.customerName || customer?.displayName || job?.customerName || "Not selected";

    return (
        <div className="space-y-4">
            <h3 className="text-xl font-semibold">Review & Confirm</h3>
            <div className="p-4 border rounded-lg space-y-2">
                <p><strong>Category:</strong> {selectedCategory?.label || "Service Stop"}</p>
                {isJobScheduler && <p><strong>Job:</strong> {job?.internalId || "Job"} for {job?.customerName}</p>}
                <p><strong>Customer:</strong> {customerName}</p>
                <p><strong>Location:</strong> {location?.nickName || location?.name || "Service Location"}{locationAddress ? ` at ${locationAddress}` : ""}</p>
                <p><strong>Technician:</strong> {tech || 'Not Assigned'}</p>
                <p><strong>Service Date:</strong> {date.toLocaleDateString()}</p>
                <p><strong>Service Stop Type:</strong> {selectedServiceStopType?.label || selectedServiceStopType?.name || selectedCategory?.fallbackType || "Service Stop"}</p>
                <p><strong>Pay Work Type Override:</strong> {selectedPayWorkType?.label || "Using service stop type defaults"}</p>
                <p><strong>Total Duration:</strong> {duration} minutes</p>
                <p><strong>Expected Pay:</strong> {moneyFromCents(selectedPaySummary.totalAmountCents)}</p>
                {description && <p><strong>Planned Work:</strong> {description}</p>}
                <div>
                    <h4 className="font-bold mt-2">Selected Tasks:</h4>
                    {tasks.length ? (
                        <ul className="list-disc list-inside pl-4">
                            {tasks.map(t => <li key={t.id}>{t.name || t.description || "Task"}</li>)}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-500">No tasks selected.</p>
                    )}
                </div>
            </div>
            <PaySummaryCard selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />
        </div>
    );
};

export default CreateNewServiceStop;
