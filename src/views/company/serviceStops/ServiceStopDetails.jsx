import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const ServiceStopDetails = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const {serviceStopId} = useParams();
    const [taskList, setTaskList] = useState([]);

    const [serviceStop, setServiceStop] = useState({
        id : '',
        address : {
            streetAddress : '',
            state : '',
            city : '',
            zip : '',
            latitude : '',
            longitude : '',
        },
        companyId : '',
        companyName : '',
        contractedCompanyId : '',
        customerId : '',
        dateCreated : '',
        description : '',
        duration : '',
        status : false, //Finished	Not Finished	Skipped
        billingStatus: '', //Invoiced	Paid	Not Invoiced
        serviceStopId : '',//Maybe Remove
        includeDosages : '',
        includeReadings : '',
        jobId : '',
        otherCompany : false,
        rate : '',
        recurringServiceStopId : '',
        serviceDate : '',
        serviceLocationId : '',
        tech : '',
        techId : '',
        type : '', //Maybe Remove
        typeId : '', //Maybe Remove
        typeImage : '' //Maybe Remove
    });
    useEffect(() => {
        (async () => {
            try{
                let jobId;
                const docRef = doc(db, "companies",recentlySelectedCompany,'serviceStops',serviceStopId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    const data = docSnap.data()
                    const address = docSnap.data().address

                    setServiceStop((serviceStop) => ({
                        ...serviceStop,
                        id : data.id,
                        address : {
                            streetAddress : address.streetAddress,
                            state : address.state,
                            city : address.city,
                            zip : address.zip,
                            latitude : address.latitude,
                            longitude : address.longitude,
                        },
                        companyId : data.companyId,
                        companyName : data.companyName,
                        contractedCompanyId : data.contractedCompanyId,
                        customerId : data.customerId,
                        dateCreated : data.dateCreated,
                        description : data.description,
                        duration : data.duration,
                        status : data.status, //Finished	Not Finished	Skipped
                        billingStatus : data.billingStatus, //Invoiced	Paid	Not Invoiced
                        includeDosages : data.includeDosages,
                        includeReadings : data.includeReadings,
                        jobId : data.jobId,
                        otherCompany : data.otherCompany,
                        rate : data.rate,
                        recurringServiceStopId : data.recurringServiceStopId,
                        serviceDate : data.serviceDate,
                        serviceLocationId : data.serviceLocationId,
                        tech : data.tech,
                        techId : data.techId,
                        type : data.type, //Maybe Remove
                        typeId : data.typeId, //Maybe Remove
                        typeImage : data.typeImage,//Maybe Remove
                    }));
                    jobId = data.jobId
                } else {
                console.log("No such document!");
                }
                if (serviceStopId!=='NA'){
                    //Get Task Info By Job ID
                    let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'serviceStops',serviceStopId,'tasks'));
                    const taskQuerySnapshot = await getDocs(taskQuery);       
                    setTaskList([])      
                    taskQuerySnapshot.forEach((doc) => {
                        const taskData = doc.data()
                        const task = {
                            id : taskData.id,
                            name : taskData.name,
                            type : taskData.type,
                            workerType : taskData.workerType,
                            workerId : taskData.workerId,
                            workerName : taskData.workerName,
                            status : taskData.status,
                            customerApproval : taskData.customerApproval,
                            laborContractId : taskData.laborContractId,
                            contractedRate : taskData.contractedRate,
                            estimatedTime : taskData.estimatedTime,
                            actualTime : taskData.actualTime,
                            equipmentId : taskData.equipmentId,
                            serviceLocationId : taskData.serviceLocationId,
                            bodyOfWaterId : taskData.bodyOfWaterId
                        }
                        
                        setTaskList(taskList => [...taskList, task]); 

                    });
                }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    return (
                // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white
        // 1D2E76 - Pool Blue
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green
        // 919191 = gray
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between py-1'>
                        <p className='font-bold text-lg'>Service Stop Detail View</p>
                        {
                            (serviceStop.status=='Finished')&&
                                <p className='py-1 px-2 bg-[#2B600F] rounded-md'>{serviceStop.status}</p>
                        }
                        {
                            (serviceStop.status=='Not Finished')&&
                                <p className='py-1 px-2 bg-[#CDC07B] rounded-md'>{serviceStop.status}</p>
                        }
                        {
                            (serviceStop.status=='Skipped')&&
                                <p className='py-1 px-2 bg-[#9C0D38] rounded-md'>{serviceStop.status}</p>
                        }
                    </div>
                    <p>{serviceStop.billingStatus}</p>
                    <hr/>
                    <div>
                        <p>Job Details</p>
                        <Link to={`/company/jobs/detail/${serviceStop.jobId}`}>
                            <p className="py-1 px-2 bg-[#1D2E76] text-[#919191] rounded-md">{serviceStop.jobId}</p> 
                        </Link>
                    </div>
                    
                    <p>rate -  {serviceStop.rate}</p>
                    <p>recurringServiceStopId -  {serviceStop.recurringServiceStopId}</p>
                    {/* <p>serviceDate  - {serviceStop.serviceDate}</p> */}
                    <p>tech  - {serviceStop.tech}</p>
                    <p>techId  - {serviceStop.techId}</p>
                    <p className='font-bold'>Address</p>

                    <p>{serviceStop.address.streetAddress}</p>
                    <div className='flex justify-between'>
                        <p>{serviceStop.address.state}</p>
                        <p>{serviceStop.address.city}</p>
                        <p>{serviceStop.address.zip}</p>
                    </div>
                    <p>serviceLocationId -  {serviceStop.serviceLocationId}</p>

                    <p className='font-bold'>Site Contact Info</p>
                    <p>companyName -  {serviceStop.companyName}</p>
                    <p>customerId  - {serviceStop.customerId}</p>
                    {
                        (!serviceStop.otherCompany)&&<div>
                            <p className='font-bold' >Company Info</p>
                            <p>companyId  - {serviceStop.companyId}</p>
                            <p>companyName  - {serviceStop.companyName}</p>
                        </div>
                    }
                    {
                        (serviceStop.otherCompany)&&<div>
                            <p className='font-bold' >Other Company Info</p>
                            <p>contractedCompanyId -  {serviceStop.contractedCompanyId}</p>

                        </div>
                    }
                    
                    {/* <p>dateCreated  - {serviceStop.dateCreated}</p> */}
                    
                    
                    
                    
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p>Tasks</p>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Status</th>
                                <th className='py-3 px-4'>Customer Approval</th>
                                <th className='py-3 px-4'>estimatedTime</th>
                                <th className='py-3 px-4'></th>
                            </tr>
                        </thead>
                        <tbody>
                            {
                            taskList?.map(task => (
                            <tr key={task.id}>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.name}</td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.type}</td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                    {
                                        (task.status==='Unassigned')&&<button className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>
                                            Assign
                                        </button>
                                    }
                                    {
                                    (task.status!=='Unassigned')&&<p className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>
                                        {task.status}
                                        </p>
                                    }
                                </td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                </td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                    <p>{task.estimatedTime}</p>
                                </td>
                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                    <button>
                                        Edit
                                    </button>
                                </td>
                            </tr>
                            ))
                            }
                        </tbody>
                    </table>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                <p>description  - {serviceStop.description}</p>
                <p>duration -  {serviceStop.duration}</p>
                {
                    (serviceStop.includeReadings)&&<div>
                        <p className='font-bold' >Readings</p>
                        <hr/>
                    </div>
                }
                {
                    (serviceStop.includeDosages)&&<div>
                        <p className='font-bold' >Dosages</p>
                        <hr/>
                    </div>
                }
                </div>
            </div>
        </div>
    );
}
    export default ServiceStopDetails;
