import React, {useState, useEffect, useContext} from 'react';
import { Link } from 'react-router-dom';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library

const RouteDashboard = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    
    const [serviceDate, setServiceDate] = useState(new Date());

    const [formattedServiceDate,setFormattedServiceDate] = useState('')

    const [userList, setUserList] = useState([]);

    const [userSnapshotList, setUserSnapshotList] = useState([]);

    const [serviceStopList, setServiceStopList] = useState([]);

    const serviceStops = [
        {
            id:1,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'In Progress'
        }
        ,
        {
            id:2,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'Incomplete'

        }
        ,
        {
            id:3,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'Finished'

        }
        ,
        {
            id:4,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'Incomplete'

        },

    ]
    const addDays = (date, days) => {
        const newDate = new Date(date);
        newDate.setDate(newDate.getDate() + days);
        return newDate;
    };
    useEffect(() => {
        (async () => {
            try{                       
                //Get Service Stops for Today
                
                //Set Up Map For Service Stop

                let startOfDay = new Date()
        
                startOfDay.setHours(0);
                console.log('start of day')
                console.log(startOfDay)
        
                let day = new Date()
                day.setHours(0);
                let endOfDay = addDays(day,1)
                console.log('end of day')
                console.log(endOfDay)
        
                let ssCount = 0 

                let serviceStopQ = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'), where("serviceDate", ">", startOfDay), where("serviceDate", "<", endOfDay)); 
                const serviceStopQuerySnapshot = await getDocs(serviceStopQ);       
                setServiceStopList([])   
                let workingSSList = []      

                serviceStopQuerySnapshot.forEach((doc) => {
                    const serviceStopData = doc.data()
                    
                    const date = serviceStopData.serviceDate.toDate();
                    const formattedDate = format(date, 'MMMM d, yyyy'); 

                    const serviceStop = {
                        id:serviceStopData.id,
                        techId:serviceStopData.techId,
                        tech:serviceStopData.tech,
                        type:serviceStopData.type,
                        customerName:serviceStopData.customerName,
                        serviceDate:formattedDate,
                        streetAddress: serviceStopData.address.streetAddress,
                        tech: serviceStopData.tech,
                        jobId:serviceStopData.jobId
                    }
                    ssCount = ssCount + 1
                    setServiceStopList(serviceStopList => [...serviceStopList, serviceStop]); 
                    workingSSList.push(serviceStop)
                });
                console.log('Received Service Stops: ' + ssCount)

                // Get Company Users For Company
                let companyUserCount = 0 

                let userQuery = query(collection(db, "companies",recentlySelectedCompany,'companyUsers'));//.where('workerType','==','Employee')
                const userQuerySnapshot = await getDocs(userQuery);       
                setUserList([])      
                userQuerySnapshot.forEach((doc) => {
                    const taskData = doc.data()
                    const user = {
                        id : taskData.id,
                        name : taskData.name,
                        dateCreated : taskData.dateCreated,
                        linkedCompanyId : taskData.linkedCompanyId,
                        linkedCompanyName : taskData.linkedCompanyName,
                        roleId : taskData.roleId,
                        roleName : taskData.roleName,
                        status : taskData.status,
                        userId : taskData.userId,
                        userName : taskData.userName,
                        workerType : taskData.workerType,
                        label : taskData.userName
                    }
                    companyUserCount = companyUserCount + 1
                    setUserList(userList => [...userList, user]); 
                });                    
                console.log('Received Company Users: ' + companyUserCount)

                console.log('Service Stop List: ' + workingSSList.length)

                //Get Today Info For User   
                setUserSnapshotList([])
                for (let i = 0; i < userList.length; i++) {

                    let user = userList[i]
                    let totalStops = 0 ;
                    let finishedStops = 0;
                    let milage;
                    let duration; // min
                    let status;

                    //Get Active Route?

                    //Get Service Stops
                    const stops = workingSSList.filter(item => item.techId === user.userId);
                    console.log(stops)
                    
                    //Compile information

                    //Add to list
                    if (stops.length > 0) {
                        totalStops = stops.length
                        for (let i = 0; i < stops.length; i++) {
                            let stop = stops[i]
                            console.log(stop)
                            //Change from checking if finished is true, to checking the status
                            if (stop.finished){
                                finishedStops = finishedStops + 1
                            } 
                        }
                        let userSnapshot = {
                            id:user.id,
                            userName:user.userName,
                            totalStops:totalStops,
                            finishedStops:finishedStops,
                            milage:'4',
                            duration:'5:32',
                            status:'On Break'
                        }
                        setUserSnapshotList(userSnapshotList => [...userSnapshotList, userSnapshot]); 
                    }
                }
            } catch(error){
                console.log('Error ' + error)
            }
        })();
    },[])
    async function handleDateChange(dateOption) {
        setServiceDate(dateOption)

        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        setFormattedServiceDate(formattedDate)
        console.log('selected day')
        console.log(dateOption)

        //Get Updated Service Stop Info 

        let startOfDay = dateOption

        startOfDay.setHours(0);
        console.log('start of day')
        console.log(startOfDay)

        let day = dateOption
        day.setHours(0);
        let endOfDay = addDays(day,1)
        console.log('end of day')
        console.log(endOfDay)

        let serviceStopQ = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'), where("serviceDate", ">", startOfDay), where("serviceDate", "<", endOfDay)); 
        const serviceStopQuerySnapshot = await getDocs(serviceStopQ);       
        setServiceStopList([])
        let workingSSList = []      

        serviceStopQuerySnapshot.forEach((doc) => {
            const serviceStopData = doc.data()
            
            const date = serviceStopData.serviceDate.toDate();
            const formattedDate = format(date, 'MMMM d, yyyy'); 

            const serviceStop = {
                id:serviceStopData.id,
                techId:serviceStopData.techId,
                tech:serviceStopData.tech,
                type:serviceStopData.type,
                customerName:serviceStopData.customerName,
                serviceDate:formattedDate,
                streetAddress: serviceStopData.address.streetAddress,
                tech: serviceStopData.tech,
                jobId:serviceStopData.jobId,
                status:serviceStopData.status,
                finished:serviceStopData.finished,
            }
            setServiceStopList(serviceStopList => [...serviceStopList, serviceStop]); 
            workingSSList.push(serviceStop)
        });
        console.log('Received Service Stops ')
        endOfDay.setHours(0);
        console.log('Set day')
        console.log(endOfDay)

        // Get Company Users For Company
        let userQuery = query(collection(db, "companies",recentlySelectedCompany,'companyUsers'));//.where('workerType','==','Employee')
        const userQuerySnapshot = await getDocs(userQuery);       
        setUserList([])      
        userQuerySnapshot.forEach((doc) => {
            const taskData = doc.data()
            const user = {
                id : taskData.id,
                name : taskData.name,
                dateCreated : taskData.dateCreated,
                linkedCompanyId : taskData.linkedCompanyId,
                linkedCompanyName : taskData.linkedCompanyName,
                roleId : taskData.roleId,
                roleName : taskData.roleName,
                status : taskData.status,
                userId : taskData.userId,
                userName : taskData.userName,
                workerType : taskData.workerType,
                label : taskData.userName
            }
            setUserList(userList => [...userList, user]); 
        });                    
        console.log('Received Company Users: ' + userList.length)

        console.log('Service Stop List: ' + workingSSList.length)

        //Get Today Info For User   
        setUserSnapshotList([])
        for (let i = 0; i < userList.length; i++) {

            let user = userList[i]

            //Get Active Route?

            //Get Service Stops
            const stops = workingSSList.filter(item => item.techId === user.userId);

            //compile information

            //Add to list
            if (stops.length != 0 ) {
                let totalStops;
                let finishedStops;
                let milage;
                let duration; // min
                let status;
                for (let i = 0; i < stops.length; i++) {
                    let stop = stops[i]
                    console.log(stop)
                    //Change from checking if finished is true, to checking the status
                    if (stop.finished){
                        finishedStops = finishedStops + 1
                    } else {
                        finishedStops = finishedStops + 10

                    }
                }
                let userSnapshot = {
                    id:user.id,
                    userName:user.userName,
                    totalStops:stops.length,
                    finishedStops:finishedStops,
                    milage:'4',
                    duration:'5:32',
                    status:'On Break'
                }
                setUserSnapshotList(userSnapshotList => [...userSnapshotList, userSnapshot]); 
            }
        }
    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='flex justify-between w-full bg-[#0e245c] rounded-md text-[#cfcfcf] p-4'>
                    <h1 className='text-[#cfcfcf] font-bold'>Route Dashboard</h1>
                    <div className='text-[#000000]'>
                        <DatePicker 
                            selected={serviceDate} 
                            onChange={(serviceDate) => handleDateChange(serviceDate)}
                        />
                    </div>
                </div>
            </div> 
            <div className='py-2'>
                <div className='w-full flex flex-wrap'>

                    {/* Map */}
                    <div className='w-full lg:w-8/12 lg:pr-3'>
                        <div className='w-full bg-[#0e245c] p-4 rounded-md h-full'>
                            <h1 className='text-[#cfcfcf] font-bold'>Map</h1>
                            <div className='w-full h-3/4 rounded-md bg-[#ffffff] flex justify-center items-center'>
                            <h1 className='text-[#000000] font-bold '>Map</h1>
                            </div>
                        </div>
                    </div>

                    {/* User Snap Shots */}
                    <div className='w-full lg:w-4/12 lg:pl-4 mt-6 lg:mt-0'>
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6] h-full'>
                            <h1 className='text-[#cfcfcf] font-bold'>Users</h1>
                            <hr/>
                            {
                                userSnapshotList?.map(user => (
                                    <div key={user.id}>
                                        <p className='font-bold'>{user.userName} - {user.status}</p>
                                        <p>{user.finishedStops} / {user.totalStops}</p>
                                        <p>{user.milage}</p>
                                        <p>{user.duration}</p>
                                        <hr/>
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                </div>
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#d0d2d6] p-4'>
                    <h1 className='text-[#cfcfcf] font-bold'>Service Stop Table - {serviceStopList.length}</h1>
                    <hr/>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Customer Name</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Tech</th>
                                    <th className='py-3 px-4'>Job Type</th>
                                    <th className='py-3 px-4'>Status</th>
                                    <th className='py-3 px-4'>Service Date</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                serviceStopList?.map(serviceStop => (
                                    <tr key={serviceStop.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.customerName}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.streetAddress}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.tech}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.type}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.status}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.serviceDate}</Link></td>
                                    </tr>
                                ))
                            }
                            </tbody>
                        </table>
                </div>
            </div>
        </div>
    );
};

export default RouteDashboard;