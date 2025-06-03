import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { IoMdCheckboxOutline } from "react-icons/io";
import { MdCheckBoxOutlineBlank } from "react-icons/md";
import {v4 as uuidv4} from 'uuid';
import { useNavigate } from 'react-router-dom';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns'; // Or any other date formatting library


const CreateNewServiceStop = () => {
    const navigate = useNavigate()

    const {name,recentlySelectedCompany,recentlySelectedCompanyName} = useContext(Context);
    const {jobId} = useParams();
    const [job,setJob] = useState({
        adminId : '',
        adminName : '',
        billingStatus : '',
        bodyOfWaterId : '',
        bodyOfWaterName : '',
        chemicals : '',
        customerId : '',
        customerName : '',
        description : '',
        electricalParts : '',
        equipmentId : '',
        equipmentName : '',
        id : '',
        internalId : '',
        installationParts : '',
        jobTemplateId : '',
        laborCost : '',
        miscParts : '',
        operationStatus : '',
        pvcParts : '',
        rate : '',
        serviceLocationId : '',
        serviceStopIds : '',
        type : ''
    });
    const [serviceLocation,setServiceLocation] = useState({
        id :  '', 
        streetAddress : '',
        state :  '', 
        city :  '', 
        zip :  '', 
        latitude : '', 
        longitude :  '', 
        bodiesOfWaterId :  '', 
        chemicalCost :  '', 
        customerId :  '', 
        customerName : '', 
        gateCode :  '', 
        laborCost : '', //Maybe Remove
        laborType : '', //Maybe Remove
        mainContactEmail : '',
        mainContactId : '',
        mainContactName : '',
        mainContactNotes : '',
        mainContactPhoneNumber : '',
        nickName : '',
        preText : '',
        rate : '', //Maybe Remove
        rateType : '', //Maybe Remove
        verified : ''
    })
    const [selectedUser,setSelectedUser] = useState({})
    const [userList, setUserList] = useState([]);
    const [selectedTaskList, setSelectedTaskList] = useState([]);
    const [taskList, setTaskList] = useState([]);
    const [serviceDate, setServiceDate] = useState(new Date());
    const [description,setDescription] = useState('')
    const [estimatedDuration,setEstimatedDuration] = useState(0)

    const [formattedServiceDate,setFormattedServiceDate] = useState('')
    

    useEffect(() => {
        (async () => {
            try{
                    if (jobId!=='NA') {

                        let serviceLocationId;
                        //Get Job Info
                        const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                            console.log("Document data:", docSnap.data());
                            setJob((prevJob) => ({
                                ...prevJob,
                                adminId: docSnap.data().adminId,
                                adminName: docSnap.data().adminName,
                                billingStatus: docSnap.data().billingStatus,
                                bodyOfWaterId: docSnap.data().bodyOfWaterId,
                                bodyOfWaterName : docSnap.data().bodyOfWaterName,
                                chemicals : docSnap.data().chemicals,
                                customerId : docSnap.data().customerId,
                                customerName : docSnap.data().customerName,
                                description : docSnap.data().description,
                                electricalParts : docSnap.data().electricalParts,
                                equipmentId : docSnap.data().equipmentId,
                                equipmentName : docSnap.data().equipmentName,
                                id : docSnap.data().id,
                                internalId : docSnap.data().internalId,
                                installationParts : docSnap.data().installationParts,
                                jobTemplateId : docSnap.data().jobTemplateId,
                                laborCost : docSnap.data().laborCost,
                                miscParts : docSnap.data().miscParts,
                                operationStatus : docSnap.data().operationStatus,
                                pvcParts : docSnap.data().pvcParts,
                                rate : docSnap.data().rate,
                                serviceLocationId : docSnap.data().serviceLocationId,
                                serviceStopIds : docSnap.data().serviceStopIds,
                                type : docSnap.data().type,

                            }));
                            setDescription(docSnap.data().description)
                            serviceLocationId = docSnap.data().serviceLocationId
                        } else {
                        console.log("No such document!");
                        }
                        
                        //Get Task Info By Job ID
                        let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'tasks'));
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

                        //Get Service Location Info
                        if (serviceLocationId!=='') {
                            const serviceLocationRef = doc(db, "companies",recentlySelectedCompany,'serviceLocations',serviceLocationId);
                            const serviceLocationDocSnap = await getDoc(serviceLocationRef);
                            if (serviceLocationDocSnap.exists()) {
                                console.log("Document data:", serviceLocationDocSnap.data());
                                const serviceLocationData = serviceLocationDocSnap.data()
                                setServiceLocation((prevServiceLocation) => ({
                                    ...prevServiceLocation,
                                    id : serviceLocationData.id,
                                    streetAddress : serviceLocationData.address.streetAddress,
                                    state : serviceLocationData.address.state,
                                    city : serviceLocationData.address.city,
                                    zip : serviceLocationData.address.zip,
                                    latitude : serviceLocationData.address.latitude,
                                    longitude : serviceLocationData.address.longitude,
                                    bodiesOfWaterId : serviceLocationData.bodiesOfWaterId,
                                    chemicalCost : serviceLocationData.chemicalCost,
                                    customerId : serviceLocationData.customerId,
                                    customerName : serviceLocationData.customerName,
                                    gateCode : serviceLocationData.gateCode,
                                    laborCost : serviceLocationData.laborCost, //Maybe Remove
                                    laborType : serviceLocationData.laborType, //Maybe Remove
                                    mainContactEmail : serviceLocationData.mainContact.email,
                                    mainContactId : serviceLocationData.mainContact.id,
                                    mainContactName : serviceLocationData.mainContact.name,
                                    mainContactNotes : serviceLocationData.mainContact.notes,
                                    mainContactPhoneNumber : serviceLocationData.mainContact.phoneNumber,
                                    nickName : serviceLocationData.nickName,
                                    preText : serviceLocationData.preText,
                                    rate : serviceLocationData.rate, //Maybe Remove
                                    rateType : serviceLocationData.rateType, //Maybe Remove
                                    verified : serviceLocationData.verified,
                                }));
                            } else {
                            console.log("No such document!");
                            }
                        }
                        //Get Company Users
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
                                label : taskData.userName + ' - ' + taskData.roleName
                            }
                            setUserList(userList => [...userList, user]); 
                        });
                    } else {
                        console.log('Get Service Stop Info When no JobID')
                    }
                
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    
    async function createNewServiceStop(e) {
        e.preventDefault()
        let serviceStopId = 'comp_ss_' + uuidv4();
        let internalId = ''
        //Guard Statments
        //If not tasks are selected do not allow completion
        //if Draft Do not Update Job/Do not Notify Receiver / Please do on google function

        //Check if service Location Has been gotten

        //Upload Contract
        if (selectedTaskList.length!==0){

            const currentTimeStamp = Timestamp.now();
            const serviceTimeStamp = Timestamp.fromDate(serviceDate);

            await setDoc(doc(db,"companies",recentlySelectedCompany,'serviceStops',serviceStopId), {
                id : serviceStopId,
                address : {
                    streetAddress : serviceLocation.streetAddress,
                    state : serviceLocation.state,
                    city : serviceLocation.city,
                    zip : serviceLocation.zip,
                    latitude : serviceLocation.latitude,
                    longitude : serviceLocation.longitude,
                },
                companyId : recentlySelectedCompany,
                companyName : recentlySelectedCompanyName, // Get Company Name
                contractedCompanyId : '',
                customerId : job.customerId,
                customerName : job.customerName,
                dateCreated : currentTimeStamp,
                description : description,
                estimatedDuration : estimatedDuration,
                actualDuration : 0,
                status : 'Not Finished', //Finished	Not Finished	Skipped
                billingStatus: 'Not Invoiced', //Invoiced	Paid	Not Invoiced
                serviceStopId : '',//Maybe Remove
                includeDosages : true,
                includeReadings : true,
                jobId : jobId,
                otherCompany : false,
                rate : '', //Maybe Remove
                recurringServiceStopId : '',
                serviceDate : serviceDate,
                serviceLocationId : serviceLocation.id,
                tech : selectedUser.userName,
                techId : selectedUser.userId,
                type : '', //Maybe Remove
                typeId : '', //Maybe Remove
                typeImage : '', //Maybe Remove
                internalId:'SS'
            });
            // //Upload Tasks
            for (let i = 0; i < selectedTaskList.length; i++) {
                let taskId = 'comp_ss_tas_' + uuidv4();
                let task = selectedTaskList[i]
                console.log('Create Task' + taskId)
                //Create Service Stop Task List 
                await setDoc(doc(db,"companies",recentlySelectedCompany,'serviceStops',serviceStopId,'tasks',taskId), {
                    id : taskId,
                    name : task.name,
                    type : task.type, //Enum : workOrderTaskType
                    workerType : 'Employee',
                    workerId : selectedUser.userId,
                    workerName : selectedUser.userName,
                    status : 'Scheduled', //Enum : laborContractTaskStatus
                    customerApproval : task.customerApproval,
                    laborContractId : '',
                    serviceStopId : serviceStopId,
                    contractedRate : task.contractedRate,
                    estimatedTime : task.estimatedTime,
                    actualTime : task.actualTime,
                    equipmentId : task.equipmentId,
                    serviceLocationId : task.serviceLocationId,
                    bodyOfWaterId : task.bodyOfWaterId,
                    workOrderTaskId : task.id

                });
                //Update Job Tasks
                await updateDoc(doc(db,'companies',recentlySelectedCompany,"workOrders",jobId,'tasks',task.id), {
                    status : 'Scheduled',
                    workerType : 'Employee',
                    workerId : selectedUser.userId,
                    workerName : selectedUser.userName,
                    serviceStopId : serviceStopId,
                });
            }

            //Maybe have google function update these. 
            //Update Job
            navigate(`/company/jobs/detail/${jobId}`)
        } else {
            console.log('No Selected Tasks')
        }
    }
    async function selectAllTasks(e) {
        e.preventDefault()
        //Check to make sure it is not already on Selected List
        //Check to make sure it has not already been assigned
        //Add To list
        setSelectedTaskList(taskList)
        setEstimatedDuration(0)
        let durationCounter = 0
        for (let i = 0; i < taskList.length; i++) {
            let task = taskList[i]
            durationCounter = durationCounter + task.estimatedTime
            setEstimatedDuration(durationCounter)
        }
    }
    async function deselectAllTasks(e) {
        e.preventDefault()
        setSelectedTaskList([])
        setEstimatedDuration(0)

    }
    async function removeTask(e,taskId) {
        e.preventDefault()
        console.log('Remove')
        //Check to make sure it has not already been assigned
        //Remove From list
        console.log(taskId)

        const newArr = selectedTaskList.filter(obj => obj.id !== taskId); // Keep all objects except the one with id 2
        console.log(newArr)
        // setSelectedTaskList([])
        setSelectedTaskList(newArr)


        //Updates Time
        const taskRemoving = taskList.find(item => item.id === taskId);
        setEstimatedDuration(0)
        let durationCounter = estimatedDuration
        durationCounter = durationCounter - taskRemoving.estimatedTime
        setEstimatedDuration(durationCounter)
        
    }
    async function selectTask(e,taskId) {
        e.preventDefault()
        console.log('Select')

        console.log(taskId)
        //Check to make sure it is not already on Selected List
        const foundObj = taskList.find(item => item.id === taskId);
        console.log(foundObj)
        //Check to make sure it has not already been assigned
        //Add To list
        setSelectedTaskList(selectedTaskList => [...selectedTaskList, foundObj]); 

        //Updates Time
        setEstimatedDuration(0)
        let durationCounter = estimatedDuration
        console.log(foundObj)
        durationCounter = durationCounter + foundObj.estimatedTime
        setEstimatedDuration(durationCounter)
    }
    const handleUserChange = (selectedOption2) => {

        (async () => {
            setSelectedUser(selectedOption2)
            
        })();
    };
    const handleDateChange = (dateOption) => {
        setServiceDate(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        setFormattedServiceDate(formattedDate)
        
    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <form>
                <div className='w-full bg-[#747e79] p-4 rounded-md'>
                    <div className='flex left-0 w-full justify-between'>
                        <p className='font-bold'>Create New Service Stop</p>
                    </div>
                    <p>{job.internalId} - {job.customerName}</p>
                    <hr/>
                    <p className=' font-bold'>Site Info</p>
                    <p>{serviceLocation.customerName}</p>
                    <p>{serviceLocation.streetAddress}</p>
                    <div className='flex justify-between'>
                        <p>{serviceLocation.state}</p>
                        <p>{serviceLocation.city}</p>
                        <p>{serviceLocation.zip}</p>
                    </div>
                    <p>Gate Code: {serviceLocation.gateCode}</p>
                    <div className='flex justify-start'>
                        Pretext : 
                        {
                            (serviceLocation.preText)&&<p> True</p>
                        }
                        {
                            (!serviceLocation.preText)&&<p> False</p>
                        }
                        
                    </div>
                    <p>{serviceLocation.gateCode}</p>
                    <p>{serviceLocation.gateCode}</p>

                    <hr/>
                    <p className=' font-bold'>Site Contact Info</p>
                    <p>{serviceLocation.mainContactName}</p>
                    <p>{serviceLocation.mainContactPhoneNumber}</p>
                    <p>{serviceLocation.mainContactEmail}</p>

                </div>
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='flex left-0 w-full justify-between'>
                        <p className='font-bold'>Job Info</p>
                    </div>
                    <hr/>
                    <p>Description: {job.description}</p>
                    <input 
                    className='w-full py-1 px-2 rounded-md mt-2'
                    onChange={(e) => {setDescription(e.target.value)}} type="text" placeholder='Description' value={description}></input>
                    <p>Estimated Duration : {estimatedDuration}</p>
                </div>
                <div className='w-full flex justify-between py-2 gap-2'>
                    <div className='w-full lg:w-5/12 '>
                        <div className=' w-full h-full bg-[#747e79] p-4 rounded-md'>
                            <p>Users</p>
                            <hr/>
                            <div className='py-2 w-full'>

                            <Select
                                value={selectedUser}
                                options={userList}
                                onChange={handleUserChange}
                                isSearchable
                                placeholder="Select a User"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'green',
                                    primary: 'black',
                                },
                                })}
                            />
                            </div>
                            <p>Date</p>
                            <div className='w-full justify-center items-center'>
                                <DatePicker 
                                selected={serviceDate} 
                                // onChange={(e) => {setEmail(e.target.value)}}
                                onChange={(serviceDate) => handleDateChange(serviceDate)}
                                // onChange={(date) => setDate(date)} 
                                />
                            </div>
                        </div>
                    </div>
                    <div className='w-full lg:w-7/12'>
                        <div className='w-full h-full bg-[#747e79] p-4 rounded-md'>

                                <p>{selectedUser.userName} - {formattedServiceDate}</p>
                                <hr/>
                                <p>Get Route From This Day so you can see how much work They have to do / how much work they have done</p>
                        </div>
                    </div>
                </div>
                <div className='py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md'>
                        <div className='flex jw-full justify-between'>
                            <p>Task List</p>
                            <button>Select Task Group</button>
                        </div>
                        <p>Select Specific Tasks to Connect to Labor Contract. Add A button that selects all unassigned Tasks</p>
                        <p>Need to Update Task Status updates through the Labor Contract Work Flow</p>
                        <p></p>
                        <hr/>
                        <div className='flex justify-between'>
                            <button 
                            onClick={(e) => selectAllTasks(e)} 
                            className='py-1 px-2 rounded-md bg-[#CDC07B]'>
                                Select All 
                            </button>
                            <button 
                            onClick={(e) => deselectAllTasks(e)} 
                            className='py-1 px-2 rounded-md bg-[#CDC07B]'>
                                Deselect - {selectedTaskList.length} 
                            </button>
                        </div>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'></th>
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
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        {       
                                            (selectedTaskList.find(item => item.id === task.id))&&<button
                                            onClick={(e) => removeTask(e,task.id)}
                                            >
                                                <IoMdCheckboxOutline />
                                            </button>
                                        }
                                        {       
                                            (!selectedTaskList.find(item => item.id === task.id))&&<button
                                            onClick={(e) => selectTask(e,task.id)} 
                                            >
                                                <MdCheckBoxOutlineBlank />
                                            </button>
                                        }
                                    </td>

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
                    <div>
                        <button
                        className='w-full py-1 px-2 rounded-md bg-[#2B600F] mt-2 text-[#ffffff]'
                        onClick={(e) => createNewServiceStop(e)} 
                        >Schedule</button>
                    </div>
                </div>
            </form>
        </div>
    );
}
    export default CreateNewServiceStop;
