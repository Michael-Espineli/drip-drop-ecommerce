
import React, { useState, useEffect, useContext } from "react";
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { ServiceStop } from "../../../utils/models/ServiceStop";
import { format } from 'date-fns';

const ServiceStopDetails = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { serviceStopId } = useParams();
    const [serviceStop, setServiceStop] = useState(null);
    const [taskList, setTaskList] = useState([]);

    useEffect(() => {
        const fetchServiceStopDetails = async () => {
            if (recentlySelectedCompany && serviceStopId) {
                try {
                    const docRef = doc(db, "companies", recentlySelectedCompany, 'serviceStops', serviceStopId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const stopData = ServiceStop.fromFirestore(docSnap);
                        setServiceStop(stopData);

                        // Fetch associated tasks
                        const taskQuery = query(collection(db, "companies", recentlySelectedCompany, 'serviceStops', serviceStopId, 'tasks'));
                        const taskQuerySnapshot = await getDocs(taskQuery);
                        const tasks = taskQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        setTaskList(tasks);
                    } else {
                        console.log("No such document!");
                    }
                } catch (error) {
                    console.error('Error fetching service stop details: ', error);
                }
            }
        };
        fetchServiceStopDetails();
    }, [recentlySelectedCompany, serviceStopId]);

    const getStatusClass = (status) => {
        switch (status) {
            case 'Finished': return 'bg-green-100 text-green-800';
            case 'Not Finished': return 'bg-yellow-100 text-yellow-800';
            case 'Skipped': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };
    
    if (!serviceStop) {
        return <div className="flex justify-center items-center h-screen"><p className="text-lg">Loading service stop details...</p></div>;
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>

                        <Link 
                        to={`/company/serviceStops`}
                        className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >&larr; Back to Service Stops</Link>
                        <h2 className="text-3xl font-bold text-gray-800">Service Stop Details</h2>
                        <p className="text-sm text-gray-500">#{serviceStop.internalId}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <div className="flex justify-between items-start">
                                <h3 className="text-xl font-bold text-gray-800">Stop Information</h3>
                                <span className={`px-3 py-1 text-sm font-bold leading-none rounded-full ${getStatusClass(serviceStop.operationStatus)}`}>
                                    {serviceStop.operationStatus}
                                </span>
                                
                            </div>
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
                                <p><strong>Customer:</strong> {serviceStop.customerName}</p>
                                <p><strong>Technician:</strong> {serviceStop.tech}</p>
                                <Link 
                                to={`/company/recurringServiceStop/details/${serviceStop.recurringServiceStopId}`}
                                className="text-slate-600 hover:text-slate-900"
                                ><p><strong>Recurring Service Stop:</strong> </p></Link>
                                <p><strong>Date:</strong> {serviceStop.serviceDate ? format(serviceStop.serviceDate, 'PP') : 'N/A'}</p>
                                <p><strong>Address:</strong> {`${serviceStop.address.streetAddress}, ${serviceStop.address.city}, ${serviceStop.address.state}`}</p>
                                <p><strong>Job ID:</strong> <Link to={`/company/jobs/detail/${serviceStop.jobId}`} className="text-blue-600 hover:underline">{serviceStop.jobId}</Link></p>
                                <p><strong>Billing Status:</strong> {serviceStop.billingStatus}</p>
                                <p><strong>Duration:</strong> {serviceStop.duration} minutes</p>
                                <p><strong>Description:</strong> {serviceStop.description || 'None'}</p>
                            </div>
                        </div>
                        
                        {serviceStop.includeReadings && <div className="bg-white shadow-lg rounded-xl p-6"><h3 className="text-xl font-bold">Chemical Readings</h3> {/* Readings component or data would go here */}</div>}
                        {serviceStop.includeDosages && <div className="bg-white shadow-lg rounded-xl p-6"><h3 className="text-xl font-bold">Chemical Dosages</h3> {/* Dosages component or data would go here */}</div>}

                        {serviceStop.photoUrls.length > 0 && (
                            <div className="bg-white shadow-lg rounded-xl p-6">
                                <h3 className="text-xl font-bold mb-4">Photos</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {serviceStop.photoUrls.map((photo, index) => (
                                        <img key={index} src={photo.url} alt={`Service stop photo ${index + 1}`} className="rounded-lg w-full h-auto object-cover"/>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column */}
                    <div className="space-y-6">
                        <div className="bg-white shadow-lg rounded-xl p-6">
                            <h3 className="text-xl font-bold text-gray-800 mb-4">Tasks</h3>
                            <div className="divide-y divide-gray-200">
                                {taskList.length > 0 ? taskList.map(task => (
                                    <div key={task.id} className="py-3">
                                        <p className="font-semibold">{task.name}</p>
                                        <p className="text-sm text-gray-600">Status: {task.status}</p>
                                        {task.estimatedTime && <p className="text-sm text-gray-600">Est. Time: {task.estimatedTime} mins</p>}
                                    </div>
                                )) : <p>No tasks for this service stop.</p>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ServiceStopDetails;
