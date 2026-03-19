import React, { useState, useEffect, useContext } from "react";
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { query, collection, getDocs, doc, getDoc, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { v4 as uuidv4 } from 'uuid';
import Select from 'react-select';
import CreateNewTaskGroup from '../settings/TaskGroups/CreateNewTaskGroup';

const CreateNewJob = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { recentlySelectedCompany } = useContext(Context);
    const { customerId: customerIdParam, locationId: locationIdParam } = useParams();

    const repairRequest = location.state?.repairRequest || null;

    const [taskList, setTaskList] = useState([]);
    const [taskTypeList, setTaskTypeList] = useState([]);
    const [taskGroupList, setTaskGroupList] = useState([]);
    const [taskToEdit, setTaskToEdit] = useState({});

    const [adminList, setAdminList] = useState([]);
    const [customerList, setCustomerList] = useState([]);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);

    const [selectedAdmin, setSelectedAdmin] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedServiceLocation, setSelectedServiceLocation] = useState(null);
    const [selectedTaskGroup, setSelectedTaskGroup] = useState(null);
    const [selectedTaskType, setSelectedTaskType] = useState(null);
    const [selectedBodyOfWater, setSelectedBodyOfWater] = useState(null);
    const [selectedEquipment, setSelectedEquipment] = useState(null);

    const [taskDescription, setTaskDescription] = useState('');
    const [taskLaborCost, setTaskLaborCost] = useState('');
    const [estimatedTime, setEstimatedTime] = useState('');
    const [description, setDescription] = useState('');
    
    const [offeredRate, setOfferedRate] = useState('');
    const [estimatedRate, setEstimatedRate] = useState('1200.00');
    const [materialCost, setMaterialCost] = useState(500.00);
    const [employeeLaborCost, setEmployeeLaborCost] = useState('32.50');
    const [subcontractorCost, setSubcontractorCost] = useState('50');
    const estimatedLaborCost = taskList.reduce((acc, task) => acc + (task.contractedRate || 0), 0);
    const estimatedProfit = parseFloat(offeredRate || estimatedRate) - materialCost - estimatedLaborCost;
    const estimatedProfitPercentage = ((estimatedProfit / parseFloat(offeredRate || estimatedRate)) * 100).toFixed(2);

    const [showNewTaskGroupModel, setShowNewTaskGroupModel] = useState(false);
    
    // Fetch initial data
    useEffect(() => {
        const fetchData = async () => {
            if (!recentlySelectedCompany) return;

            const [admins, customers, taskTypes, taskGroups] = await Promise.all([
                getDocs(query(collection(db, "companies", recentlySelectedCompany, 'companyUsers'))),
                getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'customers'), where('active', '==', true))),
                getDocs(query(collection(db, 'universal', 'settings', 'taskTypes'))),
                getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'settings', 'taskGroups', 'taskGroups')))
            ]);

            setAdminList(
                admins.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    label: `${doc.data().userName} - ${doc.data().roleName}`
                }))
            );

            setCustomerList(
                customers.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        value: doc.id,
                        ...data,
                        label: data.displayAsCompany && data.companyName
                            ? data.companyName
                            : `${data.firstName || ''} ${data.lastName || ''}`.trim()
                    };
                })
            );

            setTaskTypeList(
                taskTypes.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    label: doc.data().name
                }))
            );

            setTaskGroupList(
                taskGroups.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    label: doc.data().groupName
                }))
            );
        };

        fetchData();
    }, [recentlySelectedCompany]);

    // Preselect customer from route param or repairRequest once customerList is loaded
    useEffect(() => {
        if (!customerList.length) return;

        const initialCustomerId = customerIdParam || repairRequest?.customerId;
        if (!initialCustomerId) return;

        const matchedCustomer = customerList.find(customer => customer.id === initialCustomerId);
        if (matchedCustomer) {
            setSelectedCustomer(matchedCustomer);
        }
    }, [customerList, customerIdParam, repairRequest]);

    // Prefill description from repairRequest
    useEffect(() => {
        if (repairRequest?.description) {
            setDescription(repairRequest.description);
        }
    }, [repairRequest]);

    // Fetch service locations when customer changes
    useEffect(() => {
        if (!selectedCustomer || !recentlySelectedCompany) {
            setServiceLocationList([]);
            setSelectedServiceLocation(null);
            return;
        }

        const fetchServiceLocations = async () => {
            try {
                const q = query(
                    collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),
                    where('customerId', '==', selectedCustomer.id)
                );

                const snapshot = await getDocs(q);

                const locations = snapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        value: doc.id,
                        ...data,
                        label: data.nickName || `${data.address?.streetAddress || ''}, ${data.address?.city || ''}`.trim()
                    };
                });

                setServiceLocationList(locations);

                const initialLocationId =
                    locationIdParam ||
                    repairRequest?.locationId ||
                    repairRequest?.serviceLocationId;

                if (initialLocationId) {
                    const matchedLocation = locations.find(loc => loc.id === initialLocationId);
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

    // Fetch bodies of water and equipment when location changes
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
                            collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),
                            where('serviceLocationId', '==', selectedServiceLocation.id)
                        )
                    ),
                    getDocs(
                        query(
                            collection(db, 'companies', recentlySelectedCompany, 'equipment'),
                            where('serviceLocationId', '==', selectedServiceLocation.id)
                        )
                    )
                ]);

                const bodies = bodySnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        value: doc.id,
                        ...data,
                        label: data.name || `Body Of Water`
                    };
                });

                const equipment = equipmentSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        value: doc.id,
                        ...data,
                        label: data.name
                            ? `${data.name}${data.model ? ` - ${data.model}` : ''}`
                            : (data.model || 'Equipment')
                    };
                });

                setBodyOfWaterList(bodies);
                setEquipmentList(equipment);

                const initialBodyOfWaterId = repairRequest?.bodyOfWaterId;
                const initialEquipmentId = repairRequest?.equipmentId;

                if (initialBodyOfWaterId) {
                    const matchedBody = bodies.find(item => item.id === initialBodyOfWaterId);
                    if (matchedBody) setSelectedBodyOfWater(matchedBody);
                }

                if (initialEquipmentId) {
                    const matchedEquipment = equipment.find(item => item.id === initialEquipmentId);
                    if (matchedEquipment) setSelectedEquipment(matchedEquipment);
                }
            } catch (error) {
                console.error("Error fetching location details:", error);
            }
        };

        fetchLocationDetails();
    }, [selectedServiceLocation, recentlySelectedCompany, repairRequest]);

    // Fetch tasks when task group changes
    useEffect(() => {
        if (selectedTaskGroup) {
            const fetchTasks = async () => {
                const q = query(collection(db, "companies", recentlySelectedCompany, "settings", 'taskGroups', 'taskGroups', selectedTaskGroup.id, 'tasks'));
                const snapshot = await getDocs(q);
                setTaskList(snapshot.docs.map(doc => doc.data()));
            };
            fetchTasks();
        }
    }, [selectedTaskGroup, recentlySelectedCompany]);

    const handleAddTask = () => {
        if (!taskDescription || !selectedTaskType) return;

        const newTask = {
            id: `comp_wo_tas_${uuidv4()}`,
            name: taskDescription,
            type: selectedTaskType.name,
            status: 'Unassigned',
            contractedRate: parseFloat(taskLaborCost) || 0,
            estimatedTime: parseFloat(estimatedTime) || 0,
            workerId: '',
            workerName: '',
        };

        setTaskList([...taskList, newTask]);
        setTaskDescription('');
        setSelectedTaskType(null);
        setTaskLaborCost('');
        setEstimatedTime('');
    };

    const removeTask = (taskId) => {
        setTaskList(taskList.filter(task => task.id !== taskId));
    };

    const createNewJob = async () => {
        if (!selectedAdmin || !selectedCustomer || !selectedServiceLocation) {
            alert("Please fill all required fields: Admin, Customer, and Service Location.");
            return;
        }

        const jobId = `com_wo_${uuidv4()}`;
        
        try {
            const settingsRef = doc(db, "companies", recentlySelectedCompany, 'settings', 'workOrders');
            const settingsSnap = await getDoc(settingsRef);
            let internalId = 'WO1';
            let WOCount = 1;

            if (settingsSnap.exists()) {
                WOCount = settingsSnap.data().increment + 1;
                internalId = `WO${WOCount}`;
            }

            await setDoc(settingsRef, { increment: WOCount }, { merge: true });

            const jobData = {
                id: jobId,
                internalId: internalId,
                adminId: selectedAdmin.id,
                adminName: selectedAdmin.userName,
                customerId: selectedCustomer.id,
                customerName: `${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim(),
                serviceLocationId: selectedServiceLocation.id,
                serviceLocationName: selectedServiceLocation.label || '',
                bodyOfWaterId: selectedBodyOfWater?.id || '',
                bodyOfWaterName: selectedBodyOfWater?.label || '',
                equipmentId: selectedEquipment?.id || '',
                equipmentName: selectedEquipment?.label || '',
                description: description,
                dateCreated: new Date(),
                billingStatus: 'Draft',
                operationStatus: 'Estimate Pending',
                rate: parseFloat(offeredRate) * 100 || 0,
                laborCost: estimatedLaborCost,
                serviceStopIds: [],
                laborContractIds: [],
                type: "",
                otherCompany: false,
                repairRequestId: repairRequest?.id || '',
            };

            await setDoc(doc(db, "companies", recentlySelectedCompany, 'workOrders', jobId), jobData);

            for (const task of taskList) {
                await setDoc(doc(db, "companies", recentlySelectedCompany, 'workOrders', jobId, 'tasks', task.id), task);
            }

            navigate(`/company/jobs/detail/${jobId}`);
        } catch (error) {
            console.error("Error creating new job: ", error);
            alert("Failed to create job. Please try again.");
        }
    };

    const selectStyles = {
        control: (provided) => ({
            ...provided,
            backgroundColor: 'white',
            border: '1px solid #d1d5db',
            borderRadius: '0.5rem',
            padding: '0.3rem'
        }),
        menu: (provided) => ({
            ...provided,
            zIndex: 50,
            borderRadius: '0.5rem'
        }),
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-bold text-gray-800">Create New Job</h2>
                    <Link to={'/company/jobs'} className='py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition'>
                        Back to Jobs
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4">Job Details</h3>
                            <div className="space-y-4">
                                <Select
                                    options={adminList}
                                    value={selectedAdmin}
                                    onChange={setSelectedAdmin}
                                    placeholder="Select An Admin"
                                    styles={selectStyles}
                                />

                                <Select
                                    options={customerList}
                                    value={selectedCustomer}
                                    onChange={setSelectedCustomer}
                                    placeholder="Select A Customer"
                                    styles={selectStyles}
                                    isDisabled={!!customerIdParam || !!repairRequest?.customerId}
                                />

                                <Select
                                    options={serviceLocationList}
                                    value={selectedServiceLocation}
                                    onChange={setSelectedServiceLocation}
                                    placeholder="Select a Service Location"
                                    styles={selectStyles}
                                    isDisabled={!selectedCustomer || !!locationIdParam || !!repairRequest?.locationId || !!repairRequest?.serviceLocationId}
                                />

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

                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="Job Description..."
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4">Tasks</h3>
                            <Select
                                options={taskGroupList}
                                value={selectedTaskGroup}
                                onChange={setSelectedTaskGroup}
                                placeholder="Select a Task Group to Pre-fill Tasks"
                                styles={selectStyles}
                                className="mb-4"
                            />
                            
                            {taskList.length > 0 && (
                                <div className="divide-y divide-gray-200 mb-4">
                                    {taskList.map(task => (
                                        <div key={task.id} className="flex justify-between items-center py-3">
                                            <div>
                                                <p className="font-semibold">{task.name}</p>
                                                <p className="text-sm text-gray-600">{task.type} - Est. Time: {task.estimatedTime} min</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-medium">${task.contractedRate.toFixed(2)}</p>
                                                <button onClick={() => removeTask(task.id)} className="text-red-500 hover:text-red-700 text-sm font-semibold">Remove</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
                                <input
                                    value={taskDescription}
                                    onChange={e => setTaskDescription(e.target.value)}
                                    placeholder="New Task Description"
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                />
                                <Select
                                    options={taskTypeList}
                                    value={selectedTaskType}
                                    onChange={setSelectedTaskType}
                                    placeholder="Select Task Type"
                                    styles={selectStyles}
                                />
                                <input
                                    value={taskLaborCost}
                                    onChange={e => setTaskLaborCost(e.target.value)}
                                    placeholder="Labor Cost"
                                    type="number"
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                />
                                <input
                                    value={estimatedTime}
                                    onChange={e => setEstimatedTime(e.target.value)}
                                    placeholder="Estimated Time (min)"
                                    type="number"
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                />
                            </div>
                            <button onClick={handleAddTask} className="mt-4 w-full py-2 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition">Add Task</button>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4">Estimated PNL</h3>
                            <div className="space-y-3 text-gray-700">
                                <div className="flex justify-between">
                                    <span>Rate:</span>
                                    <input
                                        value={offeredRate}
                                        onChange={e => setOfferedRate(e.target.value)}
                                        placeholder={`Est: $${estimatedRate}`}
                                        type="number"
                                        className="w-1/2 p-2 border border-gray-300 rounded-lg text-right"
                                    />
                                </div>
                                <div className="flex justify-between"><span>Material Cost:</span> <span>${materialCost.toFixed(2)}</span></div>
                                <div className="flex justify-between font-semibold border-t pt-2"><span>Total Labor Cost:</span> <span>${estimatedLaborCost.toFixed(2)}</span></div>
                                <div className="flex justify-between font-bold text-lg text-gray-800 border-t pt-2">
                                    <span>Profit:</span>
                                    <span>${estimatedProfit.toFixed(2)} ({estimatedProfitPercentage}%)</span>
                                </div>
                            </div>
                        </div>
                        <button onClick={createNewJob} className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition">Create Job</button>
                    </div>
                </div>
            </div>
            {showNewTaskGroupModel && <CreateNewTaskGroup onClose={() => setShowNewTaskGroupModel(false)} />}
        </div>
    );
}

export default CreateNewJob;