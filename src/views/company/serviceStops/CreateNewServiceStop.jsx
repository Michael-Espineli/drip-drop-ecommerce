
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

const CreateNewServiceStop = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
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
    const [estimatedDuration, setEstimatedDuration] = useState(0);
    const [plannedServiceStops, setPlannedServiceStops] = useState([]);
    const [selectedPlannedStop, setSelectedPlannedStop] = useState(null);
    const [paySettings, setPaySettings] = useState(null);
    const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);
    const [companyWorkTypes, setCompanyWorkTypes] = useState([]);
    const [workTypeMappings, setWorkTypeMappings] = useState([]);
    const [technicianRates, setTechnicianRates] = useState([]);

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

    const selectedServiceStopType = useMemo(
        () => getPlannedStopType(selectedPlannedStop),
        [selectedPlannedStop, getPlannedStopType]
    );

    const selectedPaySummary = useMemo(() => {
        if (!selectedUser) return { lines: [], totalAmountCents: 0, needsReview: false };

        return estimateServiceStopPaySummary({
            companyId: recentlySelectedCompany,
            settings: paySettings,
            serviceStopType: selectedServiceStopType,
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
                ] = await Promise.all([
                    getDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyServiceStopTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "companyWorkTypes")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "workTypeMappings")),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "technicianRates")),
                ]);

                setPaySettings(paySettingsSnap.exists() ? paySettingsSnap.data() : null);
                setCompanyServiceStopTypes(serviceStopTypesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setCompanyWorkTypes(workTypesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setWorkTypeMappings(mappingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setTechnicianRates(ratesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
        };
        fetchData();
    }, [jobId, recentlySelectedCompany, plannedStopId]);

    useEffect(() => {
        const duration = selectedTasks.reduce((acc, task) => acc + (task.estimatedTime || 0), 0);
        setEstimatedDuration(duration);
    }, [selectedTasks]);

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

    const createServiceStop = async () => {
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
            plannedServiceStopId: selectedPlannedStop?.id || "",
            rate: rate ?? 0,
            recurringServiceStopId: "",
            type: selectedServiceStopType?.name || selectedPlannedStop?.serviceStopTypeName || "",
            typeId: selectedServiceStopType?.id || selectedPlannedStop?.serviceStopTypeId || "",
            typeImage: selectedServiceStopType?.imageName || selectedPlannedStop?.serviceStopTypeImage || "",
            duration: 15


        };

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
                serviceStopId: serviceStopId,
                workOrderTaskId: task.id,
            });
            rate += task.rate
            const workOrderTaskRef = doc(db, 'companies', recentlySelectedCompany, "workOrders", jobId, 'tasks', task.id);
            await updateDoc(workOrderTaskRef, { status: 'Scheduled', workerId: selectedUser.userId, workerName: selectedUser.userName, serviceStopId: serviceStopId });
        }
        await updateDoc(serviceStopRef, { rate: rate });

        //Update Job to have ids
        if (jobId !== "") {

            const jobRef = doc(db, 'companies', recentlySelectedCompany, "workOrders", jobId);
            await updateDoc(jobRef, { serviceStopIds: arrayUnion(serviceStopId) });
        }
        navigate(`/company/serviceStops/detail/${serviceStopId}`);
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'site-info': return <SiteInfoTab job={job} location={serviceLocation} description={description} setDescription={setDescription} plannedServiceStops={plannedServiceStops} selectedPlannedStop={selectedPlannedStop} setSelectedPlannedStop={setSelectedPlannedStop} taskList={taskList} setSelectedTasks={setSelectedTasks} selectedPlannedStopPayRange={selectedPlannedStopPayRange} moneyFromCents={moneyFromCents} />;
            case 'assign-tech': return <AssignTechTab users={userList} selectedUser={selectedUser} setSelectedUser={setSelectedUser} date={serviceDate} setDate={setServiceDate} selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />;
            case 'select-tasks': return <TasksTab tasks={taskList} selectedTasks={selectedTasks} toggleTask={toggleTaskSelection} estimatedDuration={estimatedDuration} />;
            case 'review': return <ReviewTab job={job} location={serviceLocation} tech={selectedUser?.userName} date={serviceDate} tasks={selectedTasks} duration={estimatedDuration} selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />;
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

    return (
    <div className="space-y-4">
        <InfoCard title="Job Details" data={job ? { ID: job.internalId, Customer: job.customerName, Type: job.type } : {}} />
        <InfoCard title="Service Location" data={location ? { Name: location.nickName, Address: `${location.address.streetAddress}, ${location.address.city}` } : {}} />
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
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 md:col-span-2">
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

const AssignTechTab = ({ users, selectedUser, setSelectedUser, date, setDate, selectedPaySummary, moneyFromCents }) => (
    <div className="grid md:grid-cols-2 gap-6">
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign Technician</label>
            <Select options={users} value={selectedUser} onChange={setSelectedUser} placeholder="Select a technician..." styles={{ control: (p) => ({ ...p, padding: '0.3rem' }) }} />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
            <DatePicker selected={date} onChange={setDate} className="w-full p-2 border border-gray-300 rounded-lg" />
        </div>
        <PaySummaryCard selectedPaySummary={selectedPaySummary} moneyFromCents={moneyFromCents} />
    </div>
);

const TasksTab = ({ tasks, selectedTasks, toggleTask, estimatedDuration }) => (
    <div>
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold">Select Tasks for this Stop</h3>
            <p className="text-gray-600">Total Estimated Duration: <strong>{estimatedDuration} mins</strong></p>
        </div>
        <div className="border rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase">Est. Time</th>
                    </tr>
                </thead>
                <tbody>
                    {tasks.map(task => (
                        <tr key={task.id} onClick={() => toggleTask(task)} className={`cursor-pointer ${selectedTasks.find(t => t.id === task.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                            <td className="p-3 font-medium">{task.name}</td>
                            <td className="p-4 whitespace-nowrap">
                                <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800">
                                    {task.status || "—"}
                                </span>
                            </td>
                            <td className="p-3">{task.estimatedTime} mins</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const ReviewTab = ({ job, location, tech, date, tasks, duration, selectedPaySummary, moneyFromCents }) => (
    <div className="space-y-4">
        <h3 className="text-xl font-semibold">Review & Confirm</h3>
        <div className="p-4 border rounded-lg space-y-2">
            <p><strong>Job:</strong> {job?.internalId} for {job?.customerName}</p>
            <p><strong>Location:</strong> {location?.nickName} at {location?.address.streetAddress}</p>
            <p><strong>Technician:</strong> {tech || 'Not Assigned'}</p>
            <p><strong>Service Date:</strong> {date.toLocaleDateString()}</p>
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
