import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library

const JobDetailView = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const {jobId} = useParams();
    const [job,setJob] = useState({
        adminId : '',
        adminName : '',
        billingStatus : '',
        bodyOfWaterId : '',
        bodyOfWaterName : '',
        chemicals : '',
        customerId : '',
        description : '',
        electricalParts : '',
        equipmentId : '',
        equipmentName : '',
        id : '',
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

    const [customer,setCustomer] = useState({
        firstName : '',
        lastName : '',
        phoneNumber : '',
        email : '',
        billingStreetAddress : '',
        billingCity : '',
        billingState : '',
        billingZip : '',
        billingNotes : '',
        displayAsCompany : '',
        company : '',
        verified : false,
        hireDate : '',
        active : true,
        notes : '',
    });
    
    const [serviceLocation,setServiceLocation] = useState({
        bodiesOfWaterId : '',
        gateCode : '',
        nickName : '',
        streetAddress : '',
        city : '',
        state : '',
        zip : '',
        billingNotes:  '',
        active : '',
        id : '',
    });

    const [selectedBodyOfWater,setSelectedBodyOfWater] = useState({
        bodiesOfWaterId : '',
        gateCode : '',
        nickName : '',
        streetAddress : '',
        city : '',
        state : '',
        zip : '',
        billingNotes:  '',
        active : '',
        id : '',
    });

    const [selectedEquipment,setSelectedEquipment] = useState({
        bodiesOfWaterId : '',
        gateCode : '',
        nickName : '',
        streetAddress : '',
        city : '',
        state : '',
        zip : '',
        billingNotes:  '',
        active : '',
        id : '',
    });

    const [formattedDateCreated,setFormattedDateCreated] = useState()

    const [description, setDescription] = useState();
    const [taskLaborCost, setTaskLaborCost] = useState();

    const [taskTypeList, setTaskTypeList] = useState([]);

    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });
    const [taskList, setTaskList] = useState([]);
    const [shoppingList, setShoppingList] = useState([]);

    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    
    // handleBodyOfWaterListChange
    // handleEquipmentListChange
    const tasks = [
        {
            id:0,
            name:'Clean Pool',
            type:'Basic',
            workerType:'subContractor',
            worker:'Michael Espineli',
            status:'In Progress',
            customerApproval:'Approved',


        },
        {
            id:1,
            name:'Clean Filter',
            type:'Basic',
            workerType:'employee',
            worker:'Michael Espineli',
            status:'Finished',
            customerApproval:'Approved',

        }
        ,
        {
            id:2,
            name:'Clean Filter',
            type:'Replcing Equipment',
            workerType:'',
            worker:'',
            status:'Unassigned',
            customerApproval:'Not Approved',

        }
    ]
    const shoppingList1 = [
        {
            id:0,
            name:'Clean Pool',
            type:'Basic',
            workerType:'subContractor',
            worker:'Michael Espineli',
            status:'In Progress',
            taskId:1


        },
        {
            id:1,
            name:'Clean Filter',
            type:'Basic',
            workerType:'employee',
            worker:'Michael Espineli',
            status:'Finished',
            taskId:1
        }
        ,
        {
            id:2,
            name:'Clean Filter',
            type:'Replcing Equipment',
            workerType:'',
            worker:'',
            status:'Unassigned',
            taskId:1

        }
    ]
    useEffect(() => {
        (async () => {
            try{
                //Get Job Information
                const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
                const docSnap = await getDoc(docRef);
                let customerId;
                let serviceLocationId;

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
                        description : docSnap.data().description,
                        electricalParts : docSnap.data().electricalParts,
                        equipmentId : docSnap.data().equipmentId,
                        equipmentName : docSnap.data().equipmentName,
                        id : docSnap.data().id,
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
                    const dateCreated = docSnap.data().dateCreated.toDate();
                    const formattedDateCreated = format(dateCreated, 'MMMM d, yyyy'); 
                    setFormattedDateCreated(formattedDateCreated)
                    customerId = docSnap.data().customerId
                    serviceLocationId = docSnap.data().serviceLocationId
                } else {
                  console.log("No such document!");
                }
                
                //Get Customer Information
                const customerDocRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
                const customerDocSnap = await getDoc(customerDocRef);
                if (customerDocSnap.exists()) {
                    setCustomer((prevCustomer) => ({
                        ...prevCustomer,
                        firstName: customerDocSnap.data().firstName,
                        lastName: customerDocSnap.data().lastName,
                        phoneNumber: customerDocSnap.data().phoneNumber,
                        email: customerDocSnap.data().email,
                        billingStreetAddress : customerDocSnap.data().billingAddress.streetAddress,
                        billingCity : customerDocSnap.data().billingAddress.city,
                        billingState : customerDocSnap.data().billingAddress.state,
                        billingZip : customerDocSnap.data().billingAddress.zip,
                        billingNotes : customerDocSnap.data().billingNotes,
                        active : customerDocSnap.data().active,
                        verified : customerDocSnap.data().verified,
                    }));
                } else {
                    console.log("No such document!");
                }

                //Get Site Information
                const serviceLocationDocRef = doc(db, "companies",recentlySelectedCompany,'serviceLocations',serviceLocationId);
                const serviceLocationDocSnap = await getDoc(serviceLocationDocRef);
                if (serviceLocationDocSnap.exists()) {
                    setServiceLocation((prevServiceLocation) => ({
                        ...prevServiceLocation,
                        bodiesOfWaterId: serviceLocationDocSnap.data().bodiesOfWaterId,
                        gateCode: serviceLocationDocSnap.data().gateCode,
                        nickName: serviceLocationDocSnap.data().nickName,
                        streetAddress : serviceLocationDocSnap.data().address.streetAddress,
                        city : serviceLocationDocSnap.data().address.city,
                        state : serviceLocationDocSnap.data().address.state,
                        zip : serviceLocationDocSnap.data().address.zip,
                        billingNotes : serviceLocationDocSnap.data().address,
                        active : serviceLocationDocSnap.data().active,
                    }));
                } else {
                    console.log("No such document!");
                }

                //Get Task Types
                let taskTypeQuery = query(collection(db, 'universal','settings','taskTypes'));
                const taskTypeQuerySnapshot = await getDocs(taskTypeQuery);       
                setTaskTypeList([])      
                taskTypeQuerySnapshot.forEach((doc) => {
                    const taskTypeData = doc.data()
                    const taskType = {
                        id:taskTypeData.id,
                        name:taskTypeData.name,
                        label:taskTypeData.name,

                    }
                    setTaskTypeList(taskTypeList => [...taskTypeList, taskType]); 
                });
                //Get Task List
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
                        workerName : taskData.workerName,
                        status : taskData.status,
                        customerApproval : taskData.customerApproval,
                        laborContractId : taskData.laborContractId,
                        serviceStopId : taskData.serviceStopId
                    }
                    setTaskList(taskList => [...taskList, task]); 
                });
                //Get Shopping List
                let shoppingListQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'shoppingList'));
                const shoppingListQuerySnapshot = await getDocs(shoppingListQuery);       
                setShoppingList([])      
                shoppingListQuerySnapshot.forEach((doc) => {
                    const shoppingListItemData = doc.data()
                    const shoppingListItem = {
                        id : shoppingListItemData.id,
                        name : shoppingListItemData.name,
                        type : shoppingListItemData.type,
                        workerType : shoppingListItemData.workerType,
                        workerName : shoppingListItemData.workerName,
                        status : shoppingListItemData.status,
                        customerApproval : shoppingListItemData.customerApproval,
                    }
                    setShoppingList(shoppingList => [...shoppingList, shoppingListItem]); 
                });
                //Calculate Labor Cost
                // Calculate PNL
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    const handleCustomerChange = (selectedOption2) => {

        (async () => {
            setSelectedTaskType(selectedOption2)
            
        })();
    };

    const handleBodyOfWaterListChange = (selectedOption2) => {

        (async () => {
            setBodyOfWaterList(selectedOption2)
            
        })();
    };

    const handleEquipmentListChange = (selectedOption2) => {

        (async () => {
            setEquipmentList(selectedOption2)
            
        })();
    };
    async function clearNewTask(e) {
        e.preventDefault()
        setSelectedTaskType({})
        setDescription('')
        setTaskLaborCost('')

    }
    async function handleAddTask(e) {
        e.preventDefault()
        try{
            // Create New Task
            let id = 'comp_wo_tas_' + uuidv4();

            //Guard Statments Based on Task
            //Switch Statment Based ON TaskType

            await setDoc(doc(db, "companies",recentlySelectedCompany, "workOrders",jobId,'tasks',id), {
                id : id,
                name : description,
                type : selectedTaskType.name,
                workerType : '',
                workerId : '',
                workerName : '',
                status : 'Unassigned',
                customerApproval : false,
                contractedRate : taskLaborCost,
                laborContractId : '',
                estimatedTime : '',
                actualTime : '',
                equipmentId : '',
                serviceLocationId : '',
                bodyOfWaterId : ''
              });
            //Get Task
            let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'tasks'));
            const querySnapshot = await getDocs(taskQuery);       
            setTaskList([])      
            querySnapshot.forEach((doc) => {
                const taskData = doc.data()
                const task = {
                    id : taskData.id,
                    name : taskData.name,
                    type : taskData.type, //Enum : workOrderTaskType
                    workerType : taskData.workerType,
                    workerId : taskData.workerId,
                    workerName : taskData.workerName,
                    status : taskData.status, //Enum : laborContractTaskStatus
                    customerApproval : taskData.customerApproval,
                    laborContractId : taskData.laborContractId,
                    contractedRate : taskData.contractedRate,
                    estimatedTime : taskData.estimatedTime,
                    actualTime : '',
                    equipmentId : '',
                    serviceLocationId : '',
                    bodyOfWaterId : '',
                    serviceStopId : taskData.serviceStopId
                }
                setTaskList(taskList => [...taskList, task]); 
            });
            setSelectedTaskType({})
            setDescription('')
            setTaskLaborCost('')

          } catch(error){
              console.log('Error')
          }
    }

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
            <Link 
            className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
            to={`/company/jobs`}>Back</Link>

            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Job Over View</p>
                    <hr/>
                    

                    <p>Date Created : {formattedDateCreated}</p>
                    <p>Customer : {customer.firstName} {customer.lastName}</p>
                    <p>Admin : {job.adminName}</p>
                    <div className='flex w-full justify-start items-center py-2'>
                        <p>Billing Status : </p>
                        {
                            (job.billingStatus==='Draft')&&<div>
                                <p className='py-1 px-2 bg-[#919191] text-[#] rounded-md'>Draft</p>

                            </div>
                        }
                        {
                            (job.billingStatus==='Estimate')&&<div>
                                <p className='py-1 px-2 bg-[#CDC07B] text-[#] rounded-md'>Estimate</p>

                            </div>
                        }
                        {
                            (job.billingStatus==='Accepted')&&<div>
                                <p className='py-1 px-2 bg-[#2B600F] text-[#] rounded-md'>Accepted</p>
                            </div>
                        }
                        {
                            (job.billingStatus==='In Progress')&&<div>
                                <p className='py-1 px-2 bg-[#CDC07B] text-[#] rounded-md'>In Progress</p>

                            </div>
                        }
                        {
                            (job.billingStatus==='Invoiced')&&<div>
                                <p className='py-1 px-2 bg-[#1D2E76] text-[#] rounded-md'>Invoiced</p>

                            </div>
                        }
                        {
                            (job.billingStatus==='Paid')&&<div>
                                <p className='py-1 px-2 bg-[#2B600F] text-[#] rounded-md'>Paid</p>

                            </div>
                        }
                    </div>
                    <div className='flex w-full justify-start items-center py-2'>
                        <p>Operational Status : </p>
                        {
                            (job.operationStatus==='Estimate Pending')&&<div>
                                <p className='py-1 px-2 bg-[#919191] text-[#000000] rounded-md'>Estimate Pending</p>
                            </div>
                        }
                        {
                            (job.operationStatus==='Unscheduled')&&<div>
                                <p className='py-1 px-2 bg-[#CDC07B] text-[#] rounded-md'>Unscheduled</p>
                            </div>
                        }
                        {
                            (job.operationStatus==='Scheduled')&&<div>
                                <p className='py-1 px-2 bg-[#1D2E76] text-[#] rounded-md'>Scheduled</p>
                            </div>
                        }
                        {
                            (job.operationStatus==='In Progress')&&<div>
                                <p className='py-1 px-2 bg-[#1D2E76] text-[#] rounded-md'>In Progress</p>
                            </div>
                        }
                        {
                            (job.operationStatus==='Finished')&&<div>
                                <p className='py-1 px-2 bg-[#2B600F] text-[#] rounded-md'>Finished</p>
                            </div>
                        }
                    </div>
                </div>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Site Information</p>
                    <hr/>
                    <div>
                    <button                 
                    onClick={async () => {
                        const address = serviceLocation.streetAddress + ' ' + serviceLocation.city + ' ' + serviceLocation.state + ' ' + serviceLocation.zip
                        const urlAddress = address.replace(" ", "+")
                        const url = 'https://www.google.com/maps/place/' + urlAddress
    
                        if (url) {
                            window.location.href = url;
                        }
                    }}>{serviceLocation.streetAddress} {serviceLocation.city} {serviceLocation.state} {serviceLocation.zip}</button>
                    </div>
                    <p>Gate Code : {serviceLocation.gateCode}</p>
                    <p>Description : {job.description}</p>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between'>
                        <p className='font-bold'>Task List</p>
                        <div className='py-1'>
                            <p className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>
                                <Link to={`/company/laborContracts/createNew/${jobId}`}>Create Labor Contract</Link>  
                            </p>
                            <p className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000] mt-2'>
                                <Link to={`/company/serviceStops/createNew/${jobId}`}>Schedule Service Stop</Link>  
                            </p>
                        </div>
                    </div>
                    <hr/>
                    <p>Process: Creates New Labor Contract. 
                        Has List of Tasks. Assigns Task to Labor Contract. 
                        Offers to Individual Contractor Or Posts on board (private Board or public Board)
                        please track Phases Unassigned Offered accepted scheduled in Progress finished
                    </p>
                    <hr/>
                    <p>On Task List Change. The Customer Has to Approve the Change Order and the New Cost</p>
                    <hr/>
                    <p>Should I prevent Offering or scheduling until I have the customer Approval</p>
                    <hr/>
                    <p>{job.serviceStopIds} - serviceStopIds</p>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Status</th>
                                <th className='py-3 px-4'>Worker</th>
                                <th className='py-3 px-4 s:hidden'>Worker Type</th>
                                <th className='py-3 px-4'>Customer Approval</th>
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
                                                Unassigned
                                            </button>
                                        }
                                            {
                                            (task.status!=='Unassigned')&&<p className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>
                                                {task.status}
                                                </p>
                                        }
                                    </td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.workerName}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap s:hidden'>{task.workerType}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.customerApproval}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                    {
                                        (task.workerType==='Independent Contractor')&&<div>
                                            {
                                                (task.laborContractId!=='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    <Link to={`/company/laborContracts/details/${task.laborContractId}`}>Details</Link>
                                                    </p>
                                            }
                                            {
                                                (task.laborContractId==='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    NA
                                                </p>
                                            }
                                        </div>
                                    }
                                    {
                                        (task.workerType==='Employee')&&<div>
                                            {
                                                (task.serviceStopId!=='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    <Link to={`/company/serviceStops/detail/${task.serviceStopId}`}>Details</Link>

                                                </p>
                                            }
                                            {
                                                (task.serviceStopId==='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    NA
                                                </p>
                                            }
                                        </div>
                                    }
                                    </td>
                                </tr>
                            ))
                        }
                        </tbody>
                    </table>
                    <hr/>
                    <div className='py-2 flex justify-between items-center gap-2'>
                        <button onClick={(e) => clearNewTask(e)} 
                        className='py-1 px-2 rounded-md bg-[#9C0D38] text-[#ffffff]'
                        >Clear</button>
                        <input onChange={(e) => {setDescription(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description' value={description}></input>

                        <div className='w-full'>
                            <Select
                                value={selectedTaskType}
                                options={taskTypeList}
                                onChange={handleCustomerChange}
                                isSearchable
                                placeholder="Select a Task Type"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'green',
                                    primary: 'gray',
                                },
                                })}
                            />
                        </div>
                        <input onChange={(e) => {setTaskLaborCost(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='laborCost' value={taskLaborCost}></input>

                        <button onClick={(e) => handleAddTask(e)} 
                        className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'
                        >Add</button>
                    </div>
                    <hr/>
                    <div>
                        <p className='font-bold'>Details</p>
                        {
                            (selectedTaskType.name=='Basic')&&<div>
                                <p>Basic</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Clean')&&<div>
                                <p>Clean</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Empty Water')&&<div>
                                <p>Empty Water</p>
                                <p>Select Body Of Water</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedBodyOfWater}
                                        options={bodyOfWaterList}
                                        onChange={handleBodyOfWaterListChange}
                                        isSearchable
                                        placeholder="Select a Body Of Water"
                                        theme={(theme) => ({
                                        ...theme,
                                        borderRadius: 0,
                                        colors: {
                                            ...theme.colors,
                                            primary25: 'green',
                                            primary: 'gray',
                                        },
                                        })}
                                    />
                                </div>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Fill Water')&&<div>
                                <p>Fill Water</p>
                                <p>Select Body Of Water</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedBodyOfWater}
                                        options={bodyOfWaterList}
                                        onChange={handleBodyOfWaterListChange}
                                        isSearchable
                                        placeholder="Select a Body Of Water"
                                        theme={(theme) => ({
                                        ...theme,
                                        borderRadius: 0,
                                        colors: {
                                            ...theme.colors,
                                            primary25: 'green',
                                            primary: 'gray',
                                        },
                                        })}
                                    />
                                </div>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Install')&&<div>
                                <p>Install</p>
                                <p>Select New Piece of Equipment to Install</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedEquipment}
                                        options={equipmentList}
                                        onChange={handleEquipmentListChange}
                                        isSearchable
                                        placeholder="Select a Task Type"
                                        theme={(theme) => ({
                                        ...theme,
                                        borderRadius: 0,
                                        colors: {
                                            ...theme.colors,
                                            primary25: 'green',
                                            primary: 'gray',
                                        },
                                        })}
                                    />
                                </div>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Remove')&&<div>
                                <p>Remove</p>
                                <p>Select Equipment To remove</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedEquipment}
                                        options={equipmentList}
                                        onChange={handleEquipmentListChange}
                                        isSearchable
                                        placeholder="Select a Task Type"
                                        theme={(theme) => ({
                                        ...theme,
                                        borderRadius: 0,
                                        colors: {
                                            ...theme.colors,
                                            primary25: 'green',
                                            primary: 'gray',
                                        },
                                        })}
                                    />
                                </div>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Replace')&&<div>
                                <p>Replace</p>
                                <p>Select Equipment To remove</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedEquipment}
                                        options={equipmentList}
                                        onChange={handleEquipmentListChange}
                                        isSearchable
                                        placeholder="Select a Task Type"
                                        theme={(theme) => ({
                                        ...theme,
                                        borderRadius: 0,
                                        colors: {
                                            ...theme.colors,
                                            primary25: 'green',
                                            primary: 'gray',
                                        },
                                        })}
                                    />
                                </div>
                                <p>Select New Piece of Equipment to Install</p>
                                
                            </div>
                        }
                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Shopping List</p>
                    <hr/>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>id</th>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>type</th>
                                    <th className='py-3 px-4'>worker</th>

                                    <th className='py-3 px-4'>workerType</th>
                                    <th className='py-3 px-4'>taskId</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                shoppingList?.map(item => (
                                        <tr key={item.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.id}</td>

                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.name}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.type}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.worker}</td>

                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.workerType}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.taskId}</td>
                                        </tr>
                                ))
                            }
                            </tbody>
                        </table>
                </div>
            </div>
            {/* Second Section Of Body */}
            <div className='w-full flex flex-wrap mt-7'>
                <div className='w-full  lg:w-5/12 lg:pl-4 mt-6 lg:mt-0'>
                    <div className='w-full h-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <p className='font-bold'>Customer Status</p>
                    <hr/>

                    </div>
                </div>
                <div className='w-full lg:w-7/12 lg:pl-4 mt-6 lg:mt-0'>
                    <div className='w-full h-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <p className='font-bold'>Monies</p>
                    <hr/>
                    <div className='flex justify-between'>
                        <p>Suggested Rate : {job.rate}</p>
                        <button className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>Use Suggested Rate</button>
                    </div>
                    <hr/>
                    <p>Check to see if the Rate Has Already Been Approved</p>
                    <p>Maybe I should have a few versions of rate. Accepted Rate. Suggested Rate. Offered Rate</p>
                    <hr/>

                    <p>Rate: {job.rate}</p>

                    </div>
                </div>
            </div>
           
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p>Scheduling</p>
                    <p>{job.laborCost} - laborCost</p>
                    <p>Hours - Rate - Total</p>
                    <p>15 - 20 - 300</p>

                    <hr/>
                    <p>Labor Contracts</p>
                    <p>Hours - Rate - Total</p>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p>PNL</p>
                    <p>Rate - 1200</p>
                    <hr className='w-1/2'/>

                    <p>Material Cost - 500</p>
                    <hr className='w-1/4'/>
                    <p>Employee Cost - 300</p>
                    <p>Sub Contractor Cost - 100</p>
                    <hr className='w-1/4'/>

                    <p>Total Labor Cost - 400</p>
                    <hr className='w-3/4'/>
                    <p>Profit - 300  (25%)</p>
                </div>
            </div>
        </div>
    );
}
    export default JobDetailView;