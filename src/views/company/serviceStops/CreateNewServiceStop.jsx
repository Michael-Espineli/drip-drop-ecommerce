
import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const CreateNewServiceStop = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
    const { jobId } = useParams();

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
                    setTaskList(tasksSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
                } else {
                    console.log("No such job document!");
                }

                // Fetch Users
                const usersQuery = query(collection(db, "companies", recentlySelectedCompany, 'companyUsers'));
                const usersSnapshot = await getDocs(usersQuery);
                setUserList(usersSnapshot.docs.map(doc => ({ ...doc.data(), value: doc.id, label: doc.data().userName })));
            }
        };
        fetchData();
    }, [jobId, recentlySelectedCompany]);

    useEffect(() => {
        const duration = selectedTasks.reduce((acc, task) => acc + (task.estimatedTime || 0), 0);
        setEstimatedDuration(duration);
    }, [selectedTasks]);

    const toggleTaskSelection = (task) => {
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
            status: 'Scheduled',
            billingStatus: 'Not Invoiced',
            jobId,
            serviceLocationId: serviceLocation.id,
            tech: selectedUser.userName,
            techId: selectedUser.userId,
            internalId: 'SS-' + Date.now().toString().slice(-6), // Example internal ID
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

            const workOrderTaskRef = doc(db, 'companies', recentlySelectedCompany, "workOrders", jobId, 'tasks', task.id);
            await updateDoc(workOrderTaskRef, { status: 'Scheduled', workerId: selectedUser.userId, workerName: selectedUser.userName, serviceStopId: serviceStopId });
        }

        navigate(`/company/jobs/detail/${jobId}`);
    };
    
    const renderTabContent = () => {
        switch (activeTab) {
            case 'site-info': return <SiteInfoTab job={job} location={serviceLocation} description={description} setDescription={setDescription} />;
            case 'assign-tech': return <AssignTechTab users={userList} selectedUser={selectedUser} setSelectedUser={setSelectedUser} date={serviceDate} setDate={setServiceDate} />;
            case 'select-tasks': return <TasksTab tasks={taskList} selectedTasks={selectedTasks} toggleTask={toggleTaskSelection} estimatedDuration={estimatedDuration} />;
            case 'review': return <ReviewTab job={job} location={serviceLocation} tech={selectedUser?.userName} date={serviceDate} tasks={selectedTasks} duration={estimatedDuration} />; 
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

const SiteInfoTab = ({ job, location, description, setDescription }) => (
    <div className="space-y-4">
        <InfoCard title="Job Details" data={job ? { ID: job.internalId, Customer: job.customerName, Type: job.type } : {}} />
        <InfoCard title="Service Location" data={location ? { Name: location.nickName, Address: `${location.address.streetAddress}, ${location.address.city}` } : {}} />
        <div>
            <label className="block text-sm font-medium text-gray-700">Description Override</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full p-2 border border-gray-300 rounded-lg" rows="3" />
        </div>
    </div>
);

const InfoCard = ({ title, data }) => (
    <div className="p-4 border rounded-lg">
        <h4 className="font-bold text-lg mb-2">{title}</h4>
        {Object.entries(data).map(([key, value]) => <p key={key}><strong>{key}:</strong> {value}</p>)}
    </div>
);

const AssignTechTab = ({ users, selectedUser, setSelectedUser, date, setDate }) => (
    <div className="grid md:grid-cols-2 gap-6">
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign Technician</label>
            <Select options={users} value={selectedUser} onChange={setSelectedUser} placeholder="Select a technician..." styles={{ control: (p) => ({...p, padding: '0.3rem'})}}/>
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
            <DatePicker selected={date} onChange={setDate} className="w-full p-2 border border-gray-300 rounded-lg" />
        </div>
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
                <thead className="bg-gray-50"><tr><th className="p-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th className="p-3 text-left text-xs font-medium text-gray-500 uppercase">Est. Time</th></tr></thead>
                <tbody>
                    {tasks.map(task => (
                        <tr key={task.id} onClick={() => toggleTask(task)} className={`cursor-pointer ${selectedTasks.find(t => t.id === task.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                            <td className="p-3 font-medium">{task.name}</td>
                            <td className="p-3">{task.estimatedTime} mins</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const ReviewTab = ({ job, location, tech, date, tasks, duration }) => (
    <div className="space-y-4">
        <h3 className="text-xl font-semibold">Review & Confirm</h3>
        <div className="p-4 border rounded-lg space-y-2">
            <p><strong>Job:</strong> {job?.internalId} for {job?.customerName}</p>
            <p><strong>Location:</strong> {location?.nickName} at {location?.address.streetAddress}</p>
            <p><strong>Technician:</strong> {tech || 'Not Assigned'}</p>
            <p><strong>Service Date:</strong> {date.toLocaleDateString()}</p>
            <p><strong>Total Duration:</strong> {duration} minutes</p>
            <div>
                <h4 className="font-bold mt-2">Selected Tasks:</h4>
                <ul className="list-disc list-inside pl-4">
                    {tasks.map(t => <li key={t.id}>{t.name}</li>)}
                </ul>
            </div>
        </div>
    </div>
);

export default CreateNewServiceStop;
