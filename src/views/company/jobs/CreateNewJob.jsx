import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';

const CreateNewJob = () => {
    const navigate = useNavigate()
    const {name,recentlySelectedCompany} = useContext(Context);

    const [taskList, setTaskList] = useState([]);
    const [taskTypeList, setTaskTypeList] = useState([]);
    const [taskGroupList, setTaskGroupList] = useState([]);
    const [taskToEdit, setTaskToEdit] = useState([]);

    const [adminList, setAdminList] = useState([]);
    const [customerList, setCustomerList] = useState([]);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [shoppingList, setShoppingList] = useState([]);
    const [userList, setUserList] = useState([]);

    const [selectedAdmin, setSelectedAdmin] = useState(''); //Object
    const [selectedCustomer, setSelectedCustomer] = useState(''); //Object
    const [selectedServiceLocation, setSelectedServiceLocation] = useState(''); //Object
    const [selectedTaskGroup, setSelectedTaskGroup] = useState(''); //Object
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
    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });
    const [taskLaborCost, setTaskLaborCost] = useState();

    const [description, setDescription] = useState('');
    const [taskDescription, setTaskDescription] = useState('');


    //PNL
    const [offeredRate, setOfferedRate] = useState('');

    const [estimatedDuration, setEstimatedDuration] = useState('1 : 20');

    const [employeeLaborCost, setEmployeeLaborCost] = useState('32.50');
    const [subcontractorCost, setSubcontractorCost] = useState('50');
    const [estimatedLaborCost, setEstimatedLaborCost] = useState('50');

    const [estimatedRate, setEstimatedRate] = useState('1200.00');
    const [materialCost, setMaterialCost] = useState(500.00);
    const [estimatedProfit, setEstimatedProfit] = useState('$ 650.00 - $668.00');
    const [estimatedProfitPercentage, setEstimatedProfitPercentage] = useState('25% - 28%');

    useEffect(() => {
        (async () => {
            try{
                //Get Customers
                    let q;
                        // q = query(collection(db, 'companies',recentlySelectedCompany,'customers'),limit(10));
                     q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"), where('active','==',true));

                    const querySnapshot = await getDocs(q);       
                    setCustomerList([])      
                    querySnapshot.forEach((doc) => {
                        const customerDoc = doc.data()
                        const customerData = {
                            id:customerDoc.id,
                            name:customerDoc.firstName + ' ' + customerDoc.lastName,
                            streetAddress:customerDoc.billingAddress.streetAddress,
                            phoneNumber: customerDoc.phoneNumber,
                            email:customerDoc.email,
                            label:customerDoc.firstName + ' ' + customerDoc.lastName,
                        }
                        setCustomerList(customerList => [...customerList, customerData]); 
                    });
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
                
                //Get Company Task Groups
                let taskGroupQuery = query(collection(db, 'companies',recentlySelectedCompany,'settings','taskGroups','taskGroups'));
                const taskGroupQuerySnapshot = await getDocs(taskGroupQuery);       
                setTaskGroupList([])      
                taskGroupQuerySnapshot.forEach((doc) => {
                    const taskGroupData = doc.data()
                    const taskGroup = {
                        id:taskGroupData.id,
                        groupName:taskGroupData.groupName,
                        label:taskGroupData.groupName,
                    }
                    setTaskGroupList(taskGroups => [...taskGroups, taskGroup]); 
                });

                //Get Company Users
                let userQuery = query(collection(db, "companies",recentlySelectedCompany,'companyUsers'));//.where('workerType','==','Employee')
                const userQuerySnapshot = await getDocs(userQuery);       
                setAdminList([])      
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
                    setAdminList(adminList => [...adminList, user]); 
                });
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    const handleAdminChange = (option) => {

        (async () => {
            setSelectedAdmin(option)
            
        })();
    };
    const handleCustomerChange = (option) => {

        (async () => {
            setSelectedCustomer(option)
            try{
                let q;
        
                    q = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'), where('customerId','==',option.id));
                
                const querySnapshot = await getDocs(q);       
                let count = 0   
                setServiceLocationList([])      
                querySnapshot.forEach((doc) => {

                    const serviceLocationData = doc.data()
                    const serviceLocationDoc = {
                        id:serviceLocationData.id,
                        bodiesOfWaterId:serviceLocationData.bodiesOfWaterId,
                        streetAddress:serviceLocationData.address.streetAddress,
                        nickName: serviceLocationData.nickName,
                        label:serviceLocationData.address.streetAddress + ' ' + serviceLocationData.address.city + ' ' +  serviceLocationData.address.state + ' ' + serviceLocationData.address.zip 
                    }
                    count = count + 1
                    setServiceLocationList(serviceLocationList => [...serviceLocationList, serviceLocationDoc]); 
                });
                if (count!==0) {
                    setSelectedServiceLocation(serviceLocationList[0])
                }
            } catch(error){
                console.log('Error')
            }
        })();
    };
    const handleUserChange = (option) => {

        (async () => {
            setSelectedAdmin(option)
            
        })();
    };
    const handleServiceLocationChange = (option) => {

        (async () => {
            setSelectedServiceLocation(option)
            
        })();
    };
    const handleTaskGroupChange = (option) => {

        (async () => {
            setSelectedTaskGroup(option)
            //Get Tasks From Task Group
        })();
    };
    const handleBodyOfWaterListChange = (option) => {

        (async () => {
            setBodyOfWaterList(option)
            
        })();
    };

    const handleEquipmentListChange = (option) => {

        (async () => {
            setEquipmentList(option)
            
        })();
    };
    const handleSelectedTaskTypeChange = (option) => {

        (async () => {
            setSelectedTaskType(option)
            
        })();
    };
    async function handleAddTask(e) {
        e.preventDefault()
        let taskId = 'lc_tas_' + uuidv4();
        try{
            let task = {
                id : taskId,
                name : taskDescription,
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
                bodyOfWaterId : '',
                serviceStopId : ''
            }
            setTaskList(taskList => [...taskList, task]); 

            setSelectedTaskType({})
            setTaskDescription('')
            setTaskLaborCost('')

          } catch(error){
              console.log('Error')
          }
    }
    async function saveEditTask(e,taskId) {
        e.preventDefault()

        setTaskToEdit({})
    }
    async function cancelEditTask(e,taskId) {
        e.preventDefault()

        setTaskToEdit({})
    }
    async function editTask(e,taskId) {
        e.preventDefault()
        const task = taskList.find(item => item.id === taskId);

        setTaskToEdit(task)
    }
    async function removeTask(e,taskId) {
        e.preventDefault()
        console.log('Remove')
        //Check to make sure it has not already been assigned
        //Remove From list
        console.log(taskId)

        const newArr = taskList.filter(obj => obj.id !== taskId); // Keep all objects except the one with id 2
        console.log(newArr)
        // setSelectedTaskList([])
        setTaskList(newArr)


        //Updates Time
        // const taskRemoving = taskList.find(item => item.id === taskId);
        // setEstimatedDuration(0)
        // let durationCounter = estimatedDuration
        // durationCounter = durationCounter - taskRemoving.estimatedTime
        // setEstimatedDuration(durationCounter)
        
    }
    async function clearTaskList(e) {
        e.preventDefault()
        setSelectedTaskType({})
        setTaskDescription('')
        setTaskLaborCost('')

    }
    async function clearNewTask(e) {
        e.preventDefault()
        setSelectedTaskType({})
        setTaskDescription('')
        setTaskLaborCost('')

    }
    async function updateOfferedRate(e) {
        e.preventDefault()
        setOfferedRate(estimatedRate)
    }
    async function createNewJob(e) {
        e.preventDefault()
        let jobId = 'com_wo_' + uuidv4();
        //Guard Statments
        //If not tasks are selected do not allow completion
        //if Draft Do not Update Job/Do not Notify Receiver / Please do on google function
        //Upload Contract
        
        if (selectedAdmin.id!=='') {
            if (selectedCustomer.id!=='') {
                if (selectedServiceLocation.id!=='') {
                    if (taskList.length!==0) {

                        await setDoc(doc(db,"companies",recentlySelectedCompany,'workOrders',jobId), {
                            adminId : selectedAdmin.id,
                            adminName : selectedAdmin.userName,
                            billingStatus : 'Draft',
                            customerId : selectedCustomer.id,
                            description : description,
                            id : jobId,
                            laborCost : estimatedLaborCost,
                            operationStatus : 'Estimate Pending',
                            rate : offeredRate,
                            serviceLocationId : selectedServiceLocation.id,
                            serviceStopIds : [],
                        });
                        //Upload Tasks
                        for (let i = 0; i < taskList.length; i++) {
                            let taskId = 'lc_tas_' + uuidv4();
                            let task = taskList[i]
                            await setDoc(doc(db,"companies",recentlySelectedCompany,'workOrders',jobId,'tasks',taskId), {
                                id : taskId,
                                name : task.name,
                                type : task.type, //Enum : workOrderTaskType
                                workerType : '',
                                workerId : task.workerId,
                                workerName : task.workerName,
                                status : 'Unassigned', //Enum : laborContractTaskStatus
                                customerApproval : false,
                                laborContractId : '',
                                contractedRate : task.contractedRate,
                                estimatedTime : task.estimatedTime,
                                actualTime : task.actualTime,
                                equipmentId : task.equipmentId,
                                serviceLocationId : task.serviceLocationId,
                                bodyOfWaterId : task.bodyOfWaterId,
                            });
                        }
                    } else {
                        console.log('Task List')
                    }
                } else {
                    console.log('Location Guard Statement')
                }
            } else {
                console.log('Customer Guard Statement')
            }
            
            //End Of Guard Statments
        } else {
            console.log('Admin Guard Statement')
        }
        //Maybe have google function update these. 
        //Navigate To Job Detail View
        navigate(`/company/jobs/detail/${jobId}`)
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
        <div className='px-2 md:px-7 py-5'>
            <div className='flex justify-between'>
                <Link 
                className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
                to={`/company/laborContracts`}>Back</Link>
                <p className='font-bold text-lg'>Create New Job</p>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                        <Select
                            value={selectedAdmin}
                            options={adminList}
                            onChange={handleAdminChange}
                            isSearchable
                            placeholder="Select An Admin"
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
                        <hr/>
                        <p>customerId</p>

                        <Select
                            value={selectedCustomer}
                            options={customerList}
                            onChange={handleCustomerChange }
                            isSearchable
                            placeholder="Select A Customer"
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
                        <hr/>
                        <p>serviceLocationId</p>

                        <Select
                            value={selectedServiceLocation}
                            options={serviceLocationList}
                            onChange={handleServiceLocationChange}
                            isSearchable
                            placeholder="Select a Service Location"
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
                        <hr/>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Select Task Group</p>
                    <Select
                        value={selectedTaskGroup}
                        options={taskGroupList}
                        onChange={handleTaskGroupChange}
                        isSearchable
                        placeholder="Select a Task Group"
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
                    <form>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Status</th>
                                <th className='py-3 px-4'>Rate Offered</th>
                                <th className='py-3 px-4'>Estimated Time</th>

                                <th className='py-3 px-4'></th>
                                <th className='py-3 px-4'>Customer Cost</th>


                            </tr>
                        </thead>
                        <tbody>
                        {
                            taskList?.map(task => (
                                <tr key={task.id}>
                                    
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.id}</td>

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
                                        <p>{task.contractedRate}</p>
                                        <input 
                                        className='w-full py-1 px-2 rounded-md mt-2'

                                        onChange={(e) => {setTaskDescription(e.target.value)}} type="text" placeholder='Rate' value={taskDescription}></input>
                                    </td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        {
                                            (taskToEdit.id===task.id)&&<div>
                                                <button
                                                onClick={(e) => removeTask(e,task.id)}
                                                >
                                                    Save 
                                                </button>
                                                <button
                                                onClick={(e) => cancelEditTask(e,task.id)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        }
                                        {
                                            (taskToEdit. id!==task.id)&&<div>
                                                <button
                                                onClick={(e) => removeTask(e,task.id)}
                                                >
                                                    Delete
                                                </button>
                                                <button
                                                onClick={(e) => editTask(e,task.id)}
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        }
                                        
                                    </td>

                                </tr>
                            ))
                        }
                        </tbody>
                    </table>
                    </form>
                    <div className='py-2 flex justify-between items-center gap-2'>
                        <button onClick={(e) => clearNewTask(e)} 
                        className='py-1 px-2 rounded-md bg-[#9C0D38] text-[#ffffff]'
                        >Clear</button>
                        <input onChange={(e) => {setTaskDescription(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description' value={taskDescription}></input>

                        <div className='w-full'>
                            <Select
                                value={selectedTaskType}
                                options={taskTypeList}
                                onChange={handleSelectedTaskTypeChange}
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
                    <hr/>
                    <div className='flex justify-between gap-2 py-2'>
                        <button
                        className='py-1 px-2 rounded-md bg-[#CDC07B]'
                        >Update Task Group</button>
                        <button
                        className='py-1 px-2 rounded-md bg-[#CDC07B]'
                        >Create New Task Group</button>

                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-between'>
                        <p>Shoppings List</p>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Status</th>
                                <th className='py-3 px-4'>Rate Offered</th>
                                <th className='py-3 px-4'>Estimated Time</th>

                                <th className='py-3 px-4'></th>
                                <th className='py-3 px-4'>Customer Cost</th>


                            </tr>
                        </thead>
                        <tbody>
                        {
                            taskList?.map(task => (
                                <tr key={task.id}>
                                    
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.id}</td>

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
                                        <p>{task.contractedRate}</p>
                                        <input 
                                        className='w-full py-1 px-2 rounded-md mt-2'

                                        onChange={(e) => {setTaskDescription(e.target.value)}} type="text" placeholder='Rate' value={taskDescription}></input>
                                    </td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        {
                                            (taskToEdit.id===task.id)&&<div>
                                                <button
                                                onClick={(e) => removeTask(e,task.id)}
                                                >
                                                    Save 
                                                </button>
                                                <button
                                                onClick={(e) => cancelEditTask(e,task.id)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        }
                                        {
                                            (taskToEdit. id!==task.id)&&<div>
                                                <button
                                                onClick={(e) => removeTask(e,task.id)}
                                                >
                                                    Delete
                                                </button>
                                                <button
                                                onClick={(e) => editTask(e,task.id)}
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        }
                                        
                                    </td>

                                </tr>
                            ))
                        }
                        </tbody>
                    </table>
                    </div>
                </div>
            <form>

                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-between'>
                        <p>Tasg - Not Added Yet</p>
                        <input 
                            className='w-full py-1 px-2 rounded-md mt-2'
                            onChange={(e) => {setDescription(e.target.value)}} type="text" placeholder='Description' value={description}></input>
                    </div>
                </div>
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-end'>
                        <p className='font-bold'>Time</p>
                        <p>Estimated Duration - {estimatedDuration}</p>
                        <hr className='w-1/2'/>
                        <p>Estimated Hourly Cost ($25.00) - $32.50</p>
                        <p>Book Rate ($35.00) - $35.00</p>
                        <p>Contracted Rate Offering ($50.00) - $50.00</p>
                    </div>
                </div>
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-end'>
                        <p className='font-bold'> Estimated PNL</p>
                        <div className='flex justify-between'>
                            <p>Rate - $ {estimatedRate}</p>
                            <div className='flex justify-end gap-2'>
                                <input 
                                className='py-1 px-2 rounded-md mt-2 bg-[#ededed]'
                                onChange={(e) => {setOfferedRate(e.target.value)}} type="text" placeholder='Offered Rate' value={offeredRate}></input>
                                <button
                                className='bg-[#CDC07B] py-1 px-2 rounded-md'
                                onClick={(e) => updateOfferedRate(e)} 
                                >Use Offered Rate</button>
                            </div>
                        </div>
                        <hr className='w-1/2'/>
                        <p>Material Cost - $ {materialCost}</p>
                        <hr className='w-1/4'/>
                        <p>Employee Cost - $ {employeeLaborCost}</p>
                        <p>Sub Contractor Cost - $ {subcontractorCost}</p>
                        <hr className='w-1/4'/>

                        <p>Total Labor Cost - {estimatedLaborCost}</p>
                        <hr className='w-3/4'/>
                        <p>Profit - {estimatedProfit}  ({estimatedProfitPercentage})</p>
                    </div>
                </div>
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-between'>
                        <button
                        className='text-[#ededed] w-full bg-[#2B600F] py-1 px-2 rounded-md'
                        onClick={(e) => createNewJob(e)} 
                        >Create New Job</button>
                    </div>
                </div>
            </form>
        </div>
    );
}
    export default CreateNewJob;