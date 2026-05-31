import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import {
    query,
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    where,
    arrayUnion,
    Timestamp,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import Select from "react-select";

const CreateNewJob = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const { recentlySelectedCompany, dataBaseUser, currentUser, user } = useContext(Context);
    const {
        customerId: customerIdParam,
        locationId: locationIdParam,
        templateId: templateIdParam,
    } = useParams();

    const repairRequest = location.state?.repairRequest || null;
    const startingTemplateFromState =
        location.state?.startingTemplate ||
        location.state?.jobTemplate ||
        location.state?.template ||
        null;

    const loggedInUser = currentUser || user || {};
    const createdByUserId = dataBaseUser?.id || loggedInUser?.uid || loggedInUser?.id || "";
    const createdByUserName =
        `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
        loggedInUser?.displayName ||
        loggedInUser?.userName ||
        "Unknown";

    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    const [jobId] = useState(() => `comp_wo_${uuidv4()}`);
    const [internalId, setInternalId] = useState("");

    const [adminList, setAdminList] = useState([]);
    const [customerList, setCustomerList] = useState([]);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);

    const [jobTemplateList, setJobTemplateList] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [templateApplied, setTemplateApplied] = useState(false);
    const [loadingTemplate, setLoadingTemplate] = useState(false);

    const [taskTypeList, setTaskTypeList] = useState([]);
    const [taskGroupList, setTaskGroupList] = useState([]);
    const [selectedTaskGroup, setSelectedTaskGroup] = useState(null);

    const [selectedAdmin, setSelectedAdmin] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedServiceLocation, setSelectedServiceLocation] = useState(null);
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
    const [selectedEquipment, setSelectedEquipment] = useState(null);

    const [description, setDescription] = useState("");
    const [rate, setRate] = useState("0");
    const [laborCost, setLaborCost] = useState("0");

    const [taskList, setTaskList] = useState([]);
    const [plannedServiceStops, setPlannedServiceStops] = useState([]);
    const [shoppingList, setShoppingList] = useState([]);

    const [selectedTaskType, setSelectedTaskType] = useState(null);
    const [taskDescription, setTaskDescription] = useState("");
    const [taskLaborCost, setTaskLaborCost] = useState("");
    const [estimatedTime, setEstimatedTime] = useState("");

    const [activeStep, setActiveStep] = useState("Info");

    const steps = ["Info", "Template", "Tasks", "Materials", "Schedule", "Review"];

    const moneyFromCents = (value) =>
        new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format((Number(value || 0) || 0) / 100);

    const dollarsToCents = (value) => {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) return 0;
        return Math.round(n * 100);
    };

    const rateCents = useMemo(() => dollarsToCents(rate), [rate]);
    const laborCostCents = useMemo(() => dollarsToCents(laborCost), [laborCost]);

    const plannedStopLaborCents = useMemo(() => {
        return plannedServiceStops.reduce(
            (total, stop) => total + Number(stop.plannedLaborCostCents || 0),
            0
        );
    }, [plannedServiceStops]);

    const plannedTaskLaborCents = useMemo(() => {
        return taskList.reduce(
            (total, task) => total + Number(task.contractedRate || 0),
            0
        );
    }, [taskList]);

    const plannedTotalLaborCents = useMemo(() => {
        return plannedStopLaborCents + plannedTaskLaborCents;
    }, [plannedStopLaborCents, plannedTaskLaborCents]);

    const plannedMaterialCostCents = useMemo(() => {
        return shoppingList.reduce(
            (total, item) => total + Number(item.plannedTotalCostCents || 0),
            0
        );
    }, [shoppingList]);

    const plannedMaterialPriceCents = useMemo(() => {
        return shoppingList.reduce(
            (total, item) => total + Number(item.plannedTotalPriceCents || 0),
            0
        );
    }, [shoppingList]);

    const projectedProfitCents = useMemo(() => {
        return rateCents - laborCostCents - plannedMaterialCostCents;
    }, [rateCents, laborCostCents, plannedMaterialCostCents]);

    const canCreateJob =
        !!recentlySelectedCompany &&
        !!selectedAdmin?.id &&
        !!selectedCustomer?.id &&
        !!selectedServiceLocation?.id &&
        Number.isFinite(Number(rate)) &&
        Number.isFinite(Number(laborCost));

    const selectStyles = {
        control: (provided, state) => ({
            ...provided,
            backgroundColor: "white",
            border: state.isFocused ? "1px solid #2563eb" : "1px solid #d1d5db",
            borderRadius: "0.75rem",
            minHeight: 46,
            boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.18)" : "none",
            "&:hover": {
                borderColor: state.isFocused ? "#2563eb" : "#9ca3af",
            },
        }),
        menu: (provided) => ({
            ...provided,
            zIndex: 50,
            borderRadius: "0.75rem",
            overflow: "hidden",
        }),
    };

    const getCustomerDisplayName = (customer) => {
        if (!customer) return "";
        if (customer.displayAsCompany && customer.companyName) return customer.companyName;
        return `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
    };

    const getAdminIdForJob = (admin) => {
        return admin?.userId || admin?.id || "";
    };

    const getAdminNameForJob = (admin) => {
        return admin?.userName || admin?.name || admin?.label || "";
    };

    const normalizeJobTask = (task, overrides = {}) => {
        return {
            id: task.id || `comp_job_task_${uuidv4()}`,
            name: task.name || task.description || "",
            type: task.type || "",
            contractedRate: Number(task.contractedRate || 0),
            estimatedTime: Number(task.estimatedTime || 0),
            status: task.status || "Draft",

            customerApproval: Boolean(task.customerApproval || false),
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
            serviceLocationId: task.serviceLocationId || "",
            bodyOfWaterId: task.bodyOfWaterId || "",
            dataBaseItemId: task.dataBaseItemId || "",

            ...overrides,
        };
    };

    const normalizeShoppingItemForJob = (item, overrides = {}) => {
        return {
            id: item.id || `comp_shop_${uuidv4()}`,

            category: "Job",
            subCategory: item.subCategory || "Custom",
            status: item.status || "Need to Purchase",
            purchaserId: item.purchaserId || createdByUserId || "",
            purchaserName: item.purchaserName || createdByUserName || "",

            genericItemId: item.genericItemId || "",
            name: item.name || "",
            description: item.description || "",
            datePurchased: null,
            quantity: item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : "",

            jobId,
            customerId: "",
            customerName: "",

            userId: "",
            userName: "",

            dbItemId: item.dbItemId || "",
            purchasedItem: "",
            invoiced: false,

            plannedUnitCostCents: item.plannedUnitCostCents ?? null,
            plannedUnitPriceCents: item.plannedUnitPriceCents ?? null,
            plannedTotalCostCents: item.plannedTotalCostCents ?? null,
            plannedTotalPriceCents: item.plannedTotalPriceCents ?? null,

            // Legacy web fields for compatibility
            cost: item.plannedUnitCostCents ?? item.cost ?? 0,
            price: item.plannedUnitPriceCents ?? item.price ?? 0,
            itemId: item.dbItemId || item.itemId || "",
            itemType: item.subCategory || item.itemType || "Custom",

            ...overrides,
        };
    };

    const normalizePlannedStopForJob = (stop, taskIdMap = {}) => {
        const originalTaskIds = Array.isArray(stop.taskTemplateIds)
            ? stop.taskTemplateIds
            : Array.isArray(stop.taskIds)
                ? stop.taskIds
                : [];

        return {
            id: `comp_job_plan_stop_${uuidv4()}`,
            companyId: recentlySelectedCompany,
            jobId,

            name: stop.name || stop.serviceStopTypeName || "Planned Stop",
            description: stop.description || "",

            serviceStopTypeId: stop.serviceStopTypeId || "",
            serviceStopTypeName: stop.serviceStopTypeName || "",
            serviceStopTypeImage: stop.serviceStopTypeImage || "",

            serviceStopTypeUseCaseRawValue: stop.serviceStopTypeUseCaseRawValue || "",

            estimatedMinutes: Number(stop.estimatedMinutes || 0),
            sortOrder: Number(stop.sortOrder || 0),

            taskIds: originalTaskIds.map((id) => taskIdMap[id]).filter(Boolean),

            plannedLaborCostCents:
                stop.plannedLaborCostCents !== undefined && stop.plannedLaborCostCents !== null
                    ? Number(stop.plannedLaborCostCents)
                    : null,
            plannedLaborNotes: stop.plannedLaborNotes || "",

            createdAt: Timestamp.fromDate(new Date()),
            createdByUserId: createdByUserId || "",
        };
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!recentlySelectedCompany) return;

            try {
                setLoading(true);

                const settingsRef = doc(db, "companies", recentlySelectedCompany, "settings", "workOrders");
                const settingsSnap = await getDoc(settingsRef);
                const nextCount = settingsSnap.exists()
                    ? Number(settingsSnap.data().increment || 0) + 1
                    : 1;

                setInternalId(`J${nextCount}`);

                const [
                    adminsSnap,
                    customersSnap,
                    taskTypesSnap,
                    taskGroupsSnap,
                    templatesSnap,
                ] = await Promise.all([
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "companyUsers"))),
                    getDocs(
                        query(
                            collection(db, "companies", recentlySelectedCompany, "customers"),
                            where("active", "==", true)
                        )
                    ),
                    getDocs(query(collection(db, "universal", "settings", "taskTypes"))),
                    getDocs(
                        query(
                            collection(
                                db,
                                "companies",
                                recentlySelectedCompany,
                                "settings",
                                "taskGroup",
                                "taskGroup"
                            )
                        )
                    ),
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "jobTemplates"))),
                ]);

                const admins = adminsSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const name =
                        data.userName ||
                        data.name ||
                        `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
                        "Admin";

                    return {
                        ...data,
                        id: data.id || docSnap.id,
                        userId: data.userId || data.id || docSnap.id,
                        userName: name,
                        label: `${name}${data.roleName ? ` — ${data.roleName}` : ""}`,
                        value: data.id || docSnap.id,
                    };
                });

                setAdminList(admins);

                const customers = customersSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;
                    const label = getCustomerDisplayName({ ...data, id }) || "Customer";

                    return {
                        ...data,
                        id,
                        value: id,
                        label,
                    };
                });

                setCustomerList(customers);

                setTaskTypeList(
                    taskTypesSnap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        return {
                            ...data,
                            id: data.id || docSnap.id,
                            name: data.name,
                            label: data.name,
                            value: data.name,
                        };
                    })
                );

                setTaskGroupList(
                    taskGroupsSnap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        const id = data.id || docSnap.id;
                        const label = data.name || data.groupName || "Task Group";

                        return {
                            ...data,
                            id,
                            label,
                            value: id,
                        };
                    })
                );

                const templates = templatesSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        label: data.name || "Job Template",
                        value: id,
                    };
                });

                setJobTemplateList(templates);

                const startingTemplateId =
                    startingTemplateFromState?.id ||
                    templateIdParam ||
                    location.state?.templateId ||
                    "";

                if (startingTemplateId) {
                    const matched = templates.find((template) => template.id === startingTemplateId);

                    if (matched) {
                        setSelectedTemplate(matched);
                    } else if (startingTemplateFromState?.id) {
                        setSelectedTemplate({
                            ...startingTemplateFromState,
                            label: startingTemplateFromState.name || "Job Template",
                            value: startingTemplateFromState.id,
                        });
                    }
                }
            } catch (error) {
                console.error("Error loading create job data:", error);
                alert("Failed to load create job data.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany, templateIdParam]);

    useEffect(() => {
        if (!customerList.length) return;

        const initialCustomerId = customerIdParam || repairRequest?.customerId;
        if (!initialCustomerId) return;

        const matchedCustomer = customerList.find((customer) => customer.id === initialCustomerId);
        if (matchedCustomer) {
            setSelectedCustomer(matchedCustomer);
        }
    }, [customerList, customerIdParam, repairRequest]);

    useEffect(() => {
        if (repairRequest?.description) {
            setDescription(repairRequest.description);
        }
    }, [repairRequest]);

    useEffect(() => {
        if (!selectedCustomer || !recentlySelectedCompany) {
            setServiceLocationList([]);
            setSelectedServiceLocation(null);
            return;
        }

        const fetchServiceLocations = async () => {
            try {
                const q = query(
                    collection(db, "companies", recentlySelectedCompany, "serviceLocations"),
                    where("customerId", "==", selectedCustomer.id)
                );

                const snapshot = await getDocs(q);

                const locations = snapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;
                    const label =
                        data.nickName ||
                        `${data.address?.streetAddress || ""}, ${data.address?.city || ""}`.trim() ||
                        "Service Location";

                    return {
                        ...data,
                        id,
                        value: id,
                        label,
                    };
                });

                setServiceLocationList(locations);

                const initialLocationId =
                    locationIdParam ||
                    repairRequest?.locationId ||
                    repairRequest?.serviceLocationId;

                if (initialLocationId) {
                    const matchedLocation = locations.find((loc) => loc.id === initialLocationId);
                    if (matchedLocation) {
                        setSelectedServiceLocation(matchedLocation);
                        return;
                    }
                }

                if (locations.length > 0 && !selectedServiceLocation) {
                    setSelectedServiceLocation(locations[0]);
                }
            } catch (error) {
                console.error("Error fetching service locations:", error);
            }
        };

        fetchServiceLocations();
    }, [selectedCustomer, recentlySelectedCompany, locationIdParam, repairRequest]);

    useEffect(() => {
        if (!selectedServiceLocation || !recentlySelectedCompany) {
            setBodyOfWaterList([]);
            setEquipmentList([]);
            setSelectedBodyOfWater(null);
            setSelectedEquipment(null);
            return;
        }

        const fetchLocationDetails = async () => {
            try {
                const [bodySnap, equipmentSnap] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, "companies", recentlySelectedCompany, "bodiesOfWater"),
                            where("serviceLocationId", "==", selectedServiceLocation.id)
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, "companies", recentlySelectedCompany, "equipment"),
                            where("serviceLocationId", "==", selectedServiceLocation.id)
                        )
                    ),
                ]);

                const bodies = bodySnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        value: id,
                        label: data.name || "Body Of Water",
                    };
                });

                const equipment = equipmentSnap.docs.map((docSnap) => {
                    const data = docSnap.data();
                    const id = data.id || docSnap.id;

                    return {
                        ...data,
                        id,
                        value: id,
                        label: data.name
                            ? `${data.name}${data.model ? ` — ${data.model}` : ""}`
                            : data.model || "Equipment",
                    };
                });

                setBodyOfWaterList(bodies);
                setEquipmentList(equipment);

                if (repairRequest?.bodyOfWaterId) {
                    const matchedBody = bodies.find((item) => item.id === repairRequest.bodyOfWaterId);
                    if (matchedBody) setSelectedBodyOfWater(matchedBody);
                }

                if (repairRequest?.equipmentId) {
                    const matchedEquipment = equipment.find((item) => item.id === repairRequest.equipmentId);
                    if (matchedEquipment) setSelectedEquipment(matchedEquipment);
                }
            } catch (error) {
                console.error("Error fetching location details:", error);
            }
        };

        fetchLocationDetails();
    }, [selectedServiceLocation, recentlySelectedCompany, repairRequest]);

    useEffect(() => {
        if (!selectedTemplate || templateApplied) return;

        applyTemplate(selectedTemplate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTemplate]);

    const applyTemplate = async (template) => {
        if (!recentlySelectedCompany || !template?.id) return;

        try {
            setLoadingTemplate(true);

            const templateId = template.id;

            const [tasksSnap, plannedStopsSnap, shoppingSnap] = await Promise.all([
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "tasks"
                    )
                ),
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "plannedServiceStops"
                    )
                ),
                getDocs(
                    collection(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "jobTemplates",
                        templateId,
                        "shoppingItems"
                    )
                ),
            ]);

            const templateTasks = tasksSnap.docs.map((docSnap) => ({
                ...docSnap.data(),
                id: docSnap.data().id || docSnap.id,
            }));

            const copiedTasks = templateTasks.map((task) =>
                normalizeJobTask(task, {
                    id: `comp_job_task_${uuidv4()}`,
                    status: "Draft",
                    actualTime: 0,
                    workerId: "",
                    workerType: "Not Assigned",
                    workerName: "",
                    laborContractId: "",
                    serviceStopId: {
                        id: "",
                        internalId: "",
                    },
                    serviceLocationId: "",
                })
            );

            const taskIdMap = Object.fromEntries(
                templateTasks.map((task, index) => [task.id, copiedTasks[index].id])
            );

            const copiedStops = plannedStopsSnap.docs.map((docSnap) =>
                normalizePlannedStopForJob(
                    {
                        ...docSnap.data(),
                        id: docSnap.data().id || docSnap.id,
                    },
                    taskIdMap
                )
            );

            const copiedShopping = shoppingSnap.docs.map((docSnap) =>
                normalizeShoppingItemForJob({
                    ...docSnap.data(),
                    id: `comp_shop_${uuidv4()}`,
                })
            );

            setTaskList(copiedTasks);
            setPlannedServiceStops(copiedStops);
            setShoppingList(copiedShopping);

            setDescription(template.description || "");
            setRate(((Number(template.defaultRateCents || 0) / 100) || 0).toFixed(2));
            setLaborCost(((Number(template.defaultLaborCostCents || 0) / 100) || 0).toFixed(2));

            setTemplateApplied(true);
        } catch (error) {
            console.error("Error applying job template:", error);
            alert("Failed to apply job template.");
        } finally {
            setLoadingTemplate(false);
        }
    };

    const handleTemplateChange = async (template) => {
        const shouldReplace =
            !template ||
            !templateApplied ||
            window.confirm(
                "Apply this template and replace current planned tasks, stops, and materials?"
            );

        if (!shouldReplace) return;

        setSelectedTemplate(template);
        setTemplateApplied(false);

        if (!template) {
            setTaskList([]);
            setPlannedServiceStops([]);
            setShoppingList([]);
            setDescription("");
            setRate("0");
            setLaborCost("0");
            return;
        }

        await applyTemplate(template);
    };

    const handleTaskGroupChange = async (taskGroup) => {
        setSelectedTaskGroup(taskGroup);

        if (!taskGroup || !recentlySelectedCompany) return;

        const ok =
            taskList.length === 0 ||
            window.confirm("Replace current tasks with tasks from this task group?");

        if (!ok) return;

        try {
            const snapshot = await getDocs(
                collection(
                    db,
                    "companies",
                    recentlySelectedCompany,
                    "settings",
                    "taskGroup",
                    "taskGroup",
                    taskGroup.id,
                    "taskItems"
                )
            );

            const tasks = snapshot.docs.map((docSnap) => {
                const data = docSnap.data();

                return normalizeJobTask(data, {
                    id: `comp_job_task_${uuidv4()}`,
                    status: "Draft",
                    actualTime: 0,
                    workerId: "",
                    workerType: "Not Assigned",
                    workerName: "",
                    laborContractId: "",
                    serviceStopId: {
                        id: "",
                        internalId: "",
                    },
                    equipmentId: selectedEquipment?.id || "",
                    serviceLocationId: selectedServiceLocation?.id || "",
                    bodyOfWaterId: selectedBodyOfWater?.id || "",
                });
            });

            setTaskList(tasks);
        } catch (error) {
            console.error("Error loading task group:", error);
            alert("Failed to load task group.");
        }
    };

    const handleAddTask = () => {
        if (!taskDescription.trim()) return alert("Add a task description.");
        if (!selectedTaskType?.value && !selectedTaskType?.name) return alert("Pick a task type.");

        const newTask = normalizeJobTask(
            {
                id: `comp_job_task_${uuidv4()}`,
                name: taskDescription.trim(),
                type: selectedTaskType.value || selectedTaskType.name,
                contractedRate: dollarsToCents(taskLaborCost),
                estimatedTime: Number(estimatedTime || 0),
                status: "Draft",
            },
            {
                customerApproval: false,
                actualTime: 0,
                workerId: "",
                workerType: "Not Assigned",
                workerName: "",
                laborContractId: "",
                serviceStopId: {
                    id: "",
                    internalId: "",
                },
                equipmentId: selectedEquipment?.id || "",
                serviceLocationId: selectedServiceLocation?.id || "",
                bodyOfWaterId: selectedBodyOfWater?.id || "",
            }
        );

        setTaskList((prev) => [...prev, newTask]);

        setTaskDescription("");
        setSelectedTaskType(null);
        setTaskLaborCost("");
        setEstimatedTime("");
    };

    const removeTask = (taskId) => {
        setTaskList((prev) => prev.filter((task) => task.id !== taskId));

        setPlannedServiceStops((prev) =>
            prev.map((stop) => ({
                ...stop,
                taskIds: Array.isArray(stop.taskIds)
                    ? stop.taskIds.filter((id) => id !== taskId)
                    : [],
            }))
        );
    };

    const removePlannedStop = (plannedStopId) => {
        setPlannedServiceStops((prev) => prev.filter((stop) => stop.id !== plannedStopId));
    };

    const removeShoppingItem = (itemId) => {
        setShoppingList((prev) => prev.filter((item) => item.id !== itemId));
    };

    const createNewJob = async () => {
        if (!canCreateJob) {
            alert("Please fill all required fields: Admin, Customer, Service Location, Rate, and Labor Cost.");
            return;
        }

        try {
            setCreating(true);

            const settingsRef = doc(db, "companies", recentlySelectedCompany, "settings", "workOrders");
            const settingsSnap = await getDoc(settingsRef);

            let nextCount = 1;
            let nextInternalId = internalId || "J1";

            if (settingsSnap.exists()) {
                nextCount = Number(settingsSnap.data().increment || 0) + 1;
                nextInternalId = `J${nextCount}`;
            }

            await setDoc(settingsRef, { increment: nextCount }, { merge: true });

            const customerName = getCustomerDisplayName(selectedCustomer);
            const adminId = getAdminIdForJob(selectedAdmin);
            const adminName = getAdminNameForJob(selectedAdmin);

            const jobData = {
                id: jobId,
                internalId: nextInternalId,
                type: "",
                dateCreated: Timestamp.fromDate(new Date()),
                description: description || "",

                operationStatus: "Estimate Pending",
                billingStatus: "Draft",

                customerId: selectedCustomer.id,
                customerName,
                serviceLocationId: selectedServiceLocation.id,
                serviceLocationName: selectedServiceLocation.label || "",

                serviceStopIds: [],
                laborContractIds: [],

                adminId,
                adminName,

                purchasedItemsIds: [],

                rate: rateCents,
                laborCost: laborCostCents,

                otherCompany: false,
                receivedLaborContractId: "",
                receiverId: "",
                senderId: recentlySelectedCompany,

                dateEstimateAccepted: null,
                estimateAcceptedById: null,
                estimateAcceptType: null,
                estimateAcceptedNotes: "",

                invoiceDate: null,
                invoiceRef: "",
                invoiceType: null,
                invoiceNotes: "",

                // Legacy / web convenience fields
                bodyOfWaterId: selectedBodyOfWater?.id || "",
                bodyOfWaterName: selectedBodyOfWater?.label || "",
                equipmentId: selectedEquipment?.id || "",
                equipmentName: selectedEquipment?.label || "",
                repairRequestId: repairRequest?.id || "",
                sourceTemplateId: selectedTemplate?.id || "",
                sourceTemplateName: selectedTemplate?.name || "",
            };

            await setDoc(
                doc(db, "companies", recentlySelectedCompany, "workOrders", jobId),
                jobData
            );

            for (const plannedStop of plannedServiceStops) {
                const stopData = {
                    ...plannedStop,
                    companyId: recentlySelectedCompany,
                    jobId,
                    createdAt: plannedStop.createdAt || Timestamp.fromDate(new Date()),
                    createdByUserId: plannedStop.createdByUserId || createdByUserId || "",
                };

                await setDoc(
                    doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "workOrders",
                        jobId,
                        "plannedServiceStops",
                        stopData.id
                    ),
                    stopData
                );
            }

            for (const task of taskList) {
                const taskData = normalizeJobTask(task, {
                    serviceLocationId: task.serviceLocationId || selectedServiceLocation.id || "",
                    bodyOfWaterId: task.bodyOfWaterId || selectedBodyOfWater?.id || "",
                    equipmentId: task.equipmentId || selectedEquipment?.id || "",
                });

                await setDoc(
                    doc(
                        db,
                        "companies",
                        recentlySelectedCompany,
                        "workOrders",
                        jobId,
                        "tasks",
                        taskData.id
                    ),
                    taskData
                );
            }

            for (const item of shoppingList) {
                const itemData = normalizeShoppingItemForJob(item, {
                    jobId,
                    customerId: selectedCustomer.id,
                    customerName,
                    purchaserId: item.purchaserId || createdByUserId || "",
                    purchaserName: item.purchaserName || createdByUserName || "",
                });

                await setDoc(
                    doc(db, "companies", recentlySelectedCompany, "shoppingList", itemData.id),
                    itemData
                );
            }

            if (repairRequest?.id) {
                await updateDoc(
                    doc(db, "companies", recentlySelectedCompany, "repairRequests", repairRequest.id),
                    {
                        jobIds: arrayUnion(jobId),
                        status: "In Progress",
                    }
                );
            }

            navigate(`/company/jobs/detail/${jobId}`);
        } catch (error) {
            console.error("Error creating new job:", error);
            alert("Failed to create job. Please try again.");
        } finally {
            setCreating(false);
        }
    };

    const goNext = () => {
        const currentIndex = steps.indexOf(activeStep);
        const next = steps[Math.min(currentIndex + 1, steps.length - 1)];
        setActiveStep(next);
    };

    const goBackStep = () => {
        const currentIndex = steps.indexOf(activeStep);
        const previous = steps[Math.max(currentIndex - 1, 0)];
        setActiveStep(previous);
    };

    const StatCard = ({ title, value, subtitle, tone = "gray" }) => {
        const toneClass =
            tone === "green"
                ? "bg-green-50 border-green-200 text-green-800"
                : tone === "red"
                    ? "bg-red-50 border-red-200 text-red-800"
                    : tone === "blue"
                        ? "bg-blue-50 border-blue-200 text-blue-800"
                        : tone === "amber"
                            ? "bg-amber-50 border-amber-200 text-amber-800"
                            : "bg-gray-50 border-gray-200 text-gray-800";

        return (
            <div className={`rounded-xl border p-4 ${toneClass}`}>
                <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
                    {title}
                </p>
                <p className="mt-1 text-xl font-bold">{value}</p>
                {subtitle && <p className="mt-1 text-sm opacity-80">{subtitle}</p>}
            </div>
        );
    };

    const SectionCard = ({ title, subtitle, children, action }) => (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                    {subtitle && <p className="text-gray-600 mt-1">{subtitle}</p>}
                </div>
                {action}
            </div>
            <div className="mt-6">{children}</div>
        </div>
    );

    const emptyState = (title, message) => (
        <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
            <p className="font-semibold text-gray-700">{title}</p>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
        </div>
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
                <div className="max-w-screen-xl mx-auto">
                    <div className="bg-white shadow-lg rounded-xl p-6 animate-pulse">
                        <div className="h-7 bg-gray-200 rounded w-1/3" />
                        <div className="h-4 bg-gray-200 rounded w-1/2 mt-4" />
                        <div className="h-64 bg-gray-200 rounded mt-6" />
                    </div>
                </div>
            </div>
        );
    }

    const renderStepContent = () => {
        switch (activeStep) {
            case "Info":
                return (
                    <SectionCard
                        title="Job Info"
                        subtitle="Select the admin, customer, service location, and base pricing."
                    >
                        <div className="space-y-4">
                            <Select
                                options={adminList}
                                value={selectedAdmin}
                                onChange={setSelectedAdmin}
                                placeholder="Select Admin"
                                styles={selectStyles}
                            />

                            <Select
                                options={customerList}
                                value={selectedCustomer}
                                onChange={setSelectedCustomer}
                                placeholder="Select Customer"
                                styles={selectStyles}
                                isDisabled={!!customerIdParam || !!repairRequest?.customerId}
                            />

                            <Select
                                options={serviceLocationList}
                                value={selectedServiceLocation}
                                onChange={setSelectedServiceLocation}
                                placeholder="Select Service Location"
                                styles={selectStyles}
                                isDisabled={
                                    !selectedCustomer ||
                                    !!locationIdParam ||
                                    !!repairRequest?.locationId ||
                                    !!repairRequest?.serviceLocationId
                                }
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Select
                                    options={bodyOfWaterList}
                                    value={selectedBodyOfWater}
                                    onChange={setSelectedBodyOfWater}
                                    placeholder="Select Body Of Water"
                                    styles={selectStyles}
                                    isDisabled={!selectedServiceLocation}
                                    isClearable
                                />

                                <Select
                                    options={equipmentList}
                                    value={selectedEquipment}
                                    onChange={setSelectedEquipment}
                                    placeholder="Select Equipment"
                                    styles={selectStyles}
                                    isDisabled={!selectedServiceLocation}
                                    isClearable
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-semibold text-gray-500">
                                        Customer Price
                                    </label>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="font-bold text-gray-600">$</span>
                                        <input
                                            value={rate}
                                            onChange={(e) => setRate(e.target.value)}
                                            placeholder="0.00"
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-semibold text-gray-500">
                                        Saved Labor Cost
                                    </label>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="font-bold text-gray-600">$</span>
                                        <input
                                            value={laborCost}
                                            onChange={(e) => setLaborCost(e.target.value)}
                                            placeholder="0.00"
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className="w-full p-3 border border-gray-300 rounded-lg"
                                        />
                                    </div>
                                </div>
                            </div>

                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Job description..."
                                className="w-full min-h-[130px] p-3 border border-gray-300 rounded-lg"
                            />
                        </div>
                    </SectionCard>
                );

            case "Template":
                return (
                    <SectionCard
                        title="Template"
                        subtitle="Optional. Start this job from a saved job template."
                    >
                        <Select
                            options={jobTemplateList}
                            value={selectedTemplate}
                            onChange={handleTemplateChange}
                            placeholder="Select Job Template"
                            styles={selectStyles}
                            isClearable
                            isLoading={loadingTemplate}
                        />

                        {selectedTemplate ? (
                            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
                                <p className="text-sm font-bold text-blue-800">
                                    Template Applied: {selectedTemplate.name}
                                </p>
                                <p className="text-sm text-blue-700 mt-1">
                                    Tasks, planned stops, materials, rate, and labor cost were copied into this new job.
                                </p>
                            </div>
                        ) : (
                            <div className="mt-6">
                                {emptyState(
                                    "No template selected.",
                                    "You can skip this step or choose a template to prefill this job."
                                )}
                            </div>
                        )}
                    </SectionCard>
                );

            case "Tasks":
                return (
                    <SectionCard
                        title="Tasks"
                        subtitle="Plan the labor scope. Values save as cents to match iOS."
                        action={
                            <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                                {taskList.length}
                            </span>
                        }
                    >
                        <Select
                            options={taskGroupList}
                            value={selectedTaskGroup}
                            onChange={handleTaskGroupChange}
                            placeholder="Select a Task Group to Prefill Tasks"
                            styles={selectStyles}
                            className="mb-4"
                            isClearable
                        />

                        {plannedServiceStops.length > 0 && (
                            <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h4 className="font-bold text-gray-800">Planned Service Stops</h4>
                                        <p className="text-sm text-gray-600 mt-1">
                                            Copied from the selected template.
                                        </p>
                                    </div>

                                    <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                                        {plannedServiceStops.length}
                                    </span>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {plannedServiceStops
                                        .slice()
                                        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
                                        .map((stop) => (
                                            <div
                                                key={stop.id}
                                                className="rounded-xl border border-gray-200 bg-white p-4"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="font-bold text-gray-800">
                                                            {stop.name || stop.serviceStopTypeName}
                                                        </p>
                                                        <p className="text-sm text-gray-600 mt-1">
                                                            {stop.serviceStopTypeName || "Service Type"} •{" "}
                                                            {stop.estimatedMinutes || 0} min
                                                        </p>
                                                        <p className="text-sm text-gray-600 mt-1">
                                                            Planned labor: {moneyFromCents(stop.plannedLaborCostCents)}
                                                        </p>
                                                        {Array.isArray(stop.taskIds) && stop.taskIds.length > 0 && (
                                                            <p className="text-xs text-gray-500 mt-1">
                                                                {stop.taskIds.length} linked task(s)
                                                            </p>
                                                        )}
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => removePlannedStop(stop.id)}
                                                        className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-100"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

                        {taskList.length > 0 ? (
                            <div className="divide-y divide-gray-200 mb-6">
                                {taskList.map((task) => (
                                    <div key={task.id} className="flex justify-between items-center py-3 gap-4">
                                        <div>
                                            <p className="font-semibold text-gray-800">{task.name}</p>
                                            <p className="text-sm text-gray-600">
                                                {task.type} • Est. Time: {task.estimatedTime || 0} min
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                Status: {task.status || "Draft"} • Worker: {task.workerType || "Not Assigned"}
                                            </p>
                                        </div>

                                        <div className="text-right">
                                            <p className="font-medium">
                                                {moneyFromCents(task.contractedRate)}
                                            </p>
                                            <button
                                                onClick={() => removeTask(task.id)}
                                                className="text-red-600 hover:text-red-800 text-sm font-semibold"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="mb-6">
                                {emptyState("No tasks yet.", "Add tasks manually or apply a template/task group.")}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border-t pt-4">
                            <input
                                value={taskDescription}
                                onChange={(e) => setTaskDescription(e.target.value)}
                                placeholder="Task Description"
                                className="w-full p-3 border border-gray-300 rounded-lg"
                            />

                            <Select
                                options={taskTypeList}
                                value={selectedTaskType}
                                onChange={setSelectedTaskType}
                                placeholder="Task Type"
                                styles={selectStyles}
                            />

                            <input
                                value={taskLaborCost}
                                onChange={(e) => setTaskLaborCost(e.target.value)}
                                placeholder="Labor Cost"
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-full p-3 border border-gray-300 rounded-lg"
                            />

                            <input
                                value={estimatedTime}
                                onChange={(e) => setEstimatedTime(e.target.value)}
                                placeholder="Estimated Time Min"
                                type="number"
                                min="0"
                                className="w-full p-3 border border-gray-300 rounded-lg"
                            />
                        </div>

                        <button
                            onClick={handleAddTask}
                            className="mt-4 w-full py-3 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                        >
                            Add Task
                        </button>
                    </SectionCard>
                );

            case "Materials":
                return (
                    <SectionCard
                        title="Materials"
                        subtitle="Template materials are copied as planned shopping list items."
                        action={
                            <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700">
                                {shoppingList.length}
                            </span>
                        }
                    >
                        {shoppingList.length ? (
                            <div className="space-y-3">
                                {shoppingList.map((item) => (
                                    <div
                                        key={item.id}
                                        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-bold text-gray-800">{item.name || "Material"}</p>
                                                <p className="text-sm text-gray-600 mt-1">
                                                    {item.subCategory || "Custom"} • Qty: {item.quantity || "—"}
                                                </p>
                                                <p className="text-sm text-gray-600 mt-1">
                                                    Cost: {moneyFromCents(item.plannedTotalCostCents)} • Billable:{" "}
                                                    {moneyFromCents(item.plannedTotalPriceCents)}
                                                </p>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => removeShoppingItem(item.id)}
                                                className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-100"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            emptyState(
                                "No planned materials.",
                                "Materials can be copied from templates or added later from the job detail page."
                            )
                        )}
                    </SectionCard>
                );

            case "Schedule":
                return (
                    <SectionCard
                        title="Schedule"
                        subtitle="Scheduling from web can happen after the job is created."
                    >
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <p className="font-semibold text-gray-800">Service Stops</p>
                            <p className="text-sm text-gray-600 mt-1">
                                This create flow saves planned service stops from templates. Actual service stops can be scheduled from the Job Detail page after creation.
                            </p>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mt-4">
                            <p className="font-semibold text-gray-800">Work Offers</p>
                            <p className="text-sm text-gray-600 mt-1">
                                Work offers can be created after the job exists, so they can reference saved job tasks and planned stops.
                            </p>
                        </div>
                    </SectionCard>
                );

            case "Review":
            default:
                return (
                    <SectionCard
                        title="Review"
                        subtitle="Confirm the job before creating it."
                    >
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <StatCard
                                title="Customer Price"
                                value={moneyFromCents(rateCents)}
                                subtitle="Saved to job.rate"
                                tone="blue"
                            />

                            <StatCard
                                title="Saved Labor Cost"
                                value={moneyFromCents(laborCostCents)}
                                subtitle="Saved to job.laborCost"
                            />

                            <StatCard
                                title="Planned Total Labor"
                                value={moneyFromCents(plannedTotalLaborCents)}
                                subtitle={`${moneyFromCents(plannedStopLaborCents)} stops • ${moneyFromCents(plannedTaskLaborCents)} tasks`}
                                tone="amber"
                            />

                            <StatCard
                                title="Projected Profit"
                                value={moneyFromCents(projectedProfitCents)}
                                subtitle="Rate - saved labor - planned material cost"
                                tone={projectedProfitCents < 0 ? "red" : "green"}
                            />
                        </div>

                        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Admin
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {getAdminNameForJob(selectedAdmin) || "—"}
                                </p>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Customer
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {getCustomerDisplayName(selectedCustomer) || "—"}
                                </p>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Service Location
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {selectedServiceLocation?.label || "—"}
                                </p>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Template
                                </p>
                                <p className="mt-1 font-bold text-gray-800">
                                    {selectedTemplate?.name || "None"}
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <p className="font-semibold text-gray-800">Job Contents</p>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                                <StatCard
                                    title="Planned Stops"
                                    value={String(plannedServiceStops.length)}
                                />
                                <StatCard
                                    title="Tasks"
                                    value={String(taskList.length)}
                                />
                                <StatCard
                                    title="Materials"
                                    value={String(shoppingList.length)}
                                />
                            </div>
                        </div>
                    </SectionCard>
                );
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                        <Link
                            to="/company/jobs"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Jobs
                        </Link>

                        <h2 className="text-3xl font-bold text-gray-800">Create New Job</h2>

                        <p className="text-gray-600 mt-1">
                            {selectedTemplate
                                ? `Started from template: ${selectedTemplate.name}`
                                : "Build the job scope, materials, pricing, and review before submitting."}
                        </p>
                    </div>

                    <button
                        onClick={createNewJob}
                        disabled={!canCreateJob || creating}
                        className={[
                            "py-3 px-5 rounded-xl font-bold shadow-md transition",
                            canCreateJob && !creating
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-gray-200 text-gray-500 cursor-not-allowed",
                        ].join(" ")}
                    >
                        {creating ? "Creating..." : "Create Job"}
                    </button>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-4">
                    <div className="flex flex-wrap gap-2">
                        {steps.map((step) => {
                            const active = step === activeStep;
                            const completed = steps.indexOf(step) < steps.indexOf(activeStep);

                            return (
                                <button
                                    key={step}
                                    type="button"
                                    onClick={() => setActiveStep(step)}
                                    className={[
                                        "px-4 py-2 rounded-full text-sm font-semibold transition border",
                                        active
                                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                                            : completed
                                                ? "bg-green-50 text-green-700 border-green-200"
                                                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                                    ].join(" ")}
                                >
                                    {completed ? "✓ " : ""}
                                    {step}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {renderStepContent()}

                <div className="bg-white shadow-lg rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={goBackStep}
                            disabled={activeStep === steps[0]}
                            className="py-3 px-5 rounded-xl font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Back
                        </button>

                        {activeStep === "Review" ? (
                            <button
                                type="button"
                                onClick={createNewJob}
                                disabled={!canCreateJob || creating}
                                className={[
                                    "py-3 px-5 rounded-xl font-bold shadow-md transition",
                                    canCreateJob && !creating
                                        ? "bg-blue-600 text-white hover:bg-blue-700"
                                        : "bg-gray-200 text-gray-500 cursor-not-allowed",
                                ].join(" ")}
                            >
                                {creating ? "Creating..." : "Create Job"}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={goNext}
                                className="py-3 px-5 rounded-xl font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                            >
                                Next
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CreateNewJob;