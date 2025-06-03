
import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc,updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import Select from 'react-select';
import { IoMdCheckboxOutline } from "react-icons/io";
import { MdCheckBoxOutlineBlank } from "react-icons/md";
import {v4 as uuidv4} from 'uuid';


const CreateNewOneTimeLaborContract = () => {
    const navigate = useNavigate()

    const {name,recentlySelectedCompany} = useContext(Context);

    const {jobId} = useParams();
    const [jobList, setJobList] = useState([]);
    const [selectedJob,setSelectedJob] = useState({
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
        internalId : "",
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
    const [selectedBoard,setSelectedBoard] = useState({
        adminId : ''
    })
    const [selectedUser,setSelectedUser] = useState({
        adminId : ''
    })
    const [boardList, setBoardList] = useState([
        {
            label:'Murdock Pool Service - Private'
        },
        {
            label:'Global - Public'
        },
    ]);
    const [userList, setUserList] = useState([
        {
            label:'Gabrial Keller'
        },
        {
            label:'Keller Smith'
        },
    ]);

    const [taskList, setTaskList] = useState([]);
    const [selectedTaskList, setSelectedTaskList] = useState([]);

    const [postingType, setPostingType] = useState('User');

    const [daysToAccept, setDaysToAccept] = useState('15');


    const [description, setDescription] = useState('');
    const [rate, setRate] = useState('');


    useEffect(() => {
        (async () => {
            try{
                if (jobId==='NA') {
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'workOrders'));
                    const querySnapshot = await getDocs(q);       
                    setJobList([])      
                    querySnapshot.forEach((doc) => {
                        const laborContractData = doc.data()
                        const laborContract = {
                            id:laborContractData.id,
                            adminId:laborContractData.adminId,
                            adminName:laborContractData.adminName,
                            billingStatus: laborContractData.billingStatus,
                            bodyOfWaterName: laborContractData.bodyOfWaterName,
                            chemicals:laborContractData.chemicals,
                            customerId:laborContractData.customerId,
                            customerName:laborContractData.customerName,
                            dateCreated:laborContractData.dateCreated,
                            description:laborContractData.description,
                            electricalParts:laborContractData.electricalParts,
                            equipmentId:laborContractData.equipmentId,
                            equipmentName:laborContractData.equipmentName,
                            jobTemplateId:laborContractData.jobTemplateId,
                            laborCost:laborContractData.laborCost,
                            miscParts:laborContractData.miscParts,
                            operationStatus:laborContractData.operationStatus,
                            pvcParts:laborContractData.pvcParts,
                            rate:laborContractData.rate,
                            serviceLocationId:laborContractData.serviceLocationId,
                            serviceStopIds:laborContractData.serviceStopIds,
                            type:laborContractData.type,
                            label : laborContractData.id + ' - ' + laborContractData.customerName  

                        }
                        setJobList(jobList => [...jobList, laborContract]); 
                    });
                } else {
                    //Get Job Information
                    const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
                    const docSnap = await getDoc(docRef);
                    let customerId;
                    let serviceLocationId;

                    if (docSnap.exists()) {
                        console.log("Document data:", docSnap.data());
                        setSelectedJob((prevJob) => ({
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
                    } else {
                    console.log("No such document!");
                    }
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
                }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    async function createNewLaborContract(e) {
        e.preventDefault()
        let laborContractId = 'lc_' + uuidv4();
        //Guard Statments
        //If not tasks are selected do not allow completion
        //if Draft Do not Update Job/Do not Notify Receiver / Please do on google function
        //Upload Contract
        await setDoc(doc(db,"laborContracts",laborContractId), {
            id : laborContractId,
            dateSent : '',
            lastDateToAccept : '',
            dateAccepted : '',
            notes : '',
            description : description,
            receiverAcceptance : '',
            receiverId : '',
            receiverName : '',
            senderAcceptance : '',
            senderId : recentlySelectedCompany,
            senderName : '',
            status : 'Offered',
            terms : '',
            rateOffered : '',
            jobId : jobId,
            serviceStopId : '',//Maybe Remove
            postingType : postingType,
            boardId : '',
        });
        //Upload Tasks
        for (let i = 0; i < selectedTaskList.length; i++) {
            let taskId = 'lc_tas_' + uuidv4();
            let task = selectedTaskList[i]
            await setDoc(doc(db,"laborContracts",laborContractId,'tasks',taskId), {
                id : taskId,
                name : task.name,
                type : task.type, //Enum : workOrderTaskType
                workerType : 'Independent Contractor',
                workerId : task.workerId,
                workerName : task.workerName,
                status : 'Offered', //Enum : laborContractTaskStatus
                customerApproval : task.customerApproval,
                laborContractId : laborContractId,
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
            status : 'Offered',
            laborContractId : laborContractId,
            workerType : 'Independent Contractor',
            workerName : task.workerName,
        });
        }

        //Maybe have google function update these. 
        //Update Job
        navigate('/company/laborContracts')
    }
    //CHANGES IN SELECT PICKERS
    const handleSelectedJobChange = (selectedOption2) => {

        (async () => {
            setSelectedJob(selectedOption2)
            setDescription(selectedOption2.description)
        })();
    };
    const handleUserChange = (selectedOption2) => {

        (async () => {
            setSelectedUser(selectedOption2)
            
        })();
    };
    const handleBoardChange = (selectedOption2) => {

        (async () => {
            setSelectedBoard(selectedOption2)
            
        })();
    };

    async function selectAllTasks(e) {
        e.preventDefault()
        //Check to make sure it is not already on Selected List
        //Check to make sure it has not already been assigned
        //Add To list
        setSelectedTaskList(taskList)

    }
    async function deselectAllTasks(e) {
        e.preventDefault()
        setSelectedTaskList([])

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
    }
    const handlePostingType = (event) => {

        (async () => {
            setPostingType(event.target.value);
        })();
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
            to={`/company/laborContracts`}>Back</Link>
            <form className='gap-2'>
                <div className='py-2'>

                    <div className='w-full bg-[#747e79] p-4 rounded-md'>
                        <div className='left-0 w-full justify-between'>
                            <h2>Create New Labor Contract</h2>
                            <h1>{selectedJob.internalId}: {selectedJob.customerName}</h1>
                            {
                                (jobId==='NA')&&<div className='w-full'>
                                <Select
                                    value={selectedJob}
                                    options={jobList}
                                    onChange={handleSelectedJobChange}
                                    isSearchable
                                    placeholder="Select Job"
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
                            }
                            
                            <select 
                            value={postingType} onChange={(e) => handlePostingType(e)}
                            className='p-2 rounded-md bg-[#ededed] text-[#030811] mt-2'>
                                <option value="User">User</option>
                                <option value="Board">Board</option>
                            </select>
                            {
                                (postingType=='Board')&&<div className='w-full mt-2'>
                                <Select
                                    value={selectedBoard}
                                    options={boardList}
                                    onChange={handleBoardChange}
                                    isSearchable
                                    placeholder="Select Board"
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
                            }
                            {
                                (postingType=='User')&&<div className='w-full mt-2'>
                                <Select
                                    value={selectedUser}
                                    options={userList}
                                    onChange={handleUserChange}
                                    isSearchable
                                    placeholder="Select User"
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
                            }
                            <div className='flex jw-full justify-between items-center gap-2'>
                                <p>Rate Offered</p>
                                <input 
                                className='w-full py-1 px-2 rounded-md mt-2'
                                onChange={(e) => {setRate(e.target.value)}} type="text" placeholder='Rate Offered' value={rate}></input>
                            </div>
                            <div className='flex jw-full justify-between items-center gap-2'>
                                <p>Days To accept</p>
                                <input 
                                className='w-full py-1 px-2 rounded-md mt-2'
                                onChange={(e) => {setDaysToAccept(e.target.value)}} type="text" placeholder='Days To Accept' value={daysToAccept}></input>
                            </div>
                        </div>
                    </div>
                </div>
                <div>
                    
                </div>
                <div className='py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md'>
                        <div className='flex jw-full justify-between items-center gap-2'>
                            <p>Description</p>
                            <input 
                                className='w-full py-1 px-2 rounded-md mt-2'
                                onChange={(e) => {setDescription(e.target.value)}} type="text" placeholder='Description' value={description}></input>
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
                                    <th className='py-3 px-4'>Rate Offered</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                taskList?.map(task => (
                                    <tr key={task.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                            {
                                                (task.status=="Unassigned")&& <div>
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
                                                </div>
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
                                            <p>$ {(task.contractedRate/100).toFixed(2)}</p>
                                            <input 
                                            className='w-full py-1 px-2 rounded-md mt-2'

                                            onChange={(e) => {setDescription(e.target.value)}} type="text" placeholder='Rate' value={description}></input>
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
                        onClick={(e) => createNewLaborContract(e)} 
                        >Save</button>
                    </div>
                    <div>
                        <button
                        className='w-full py-1 px-2 rounded-md bg-[#2B600F] mt-2 text-[#ffffff]'
                        onClick={(e) => createNewLaborContract(e)} 
                        >Save and Send</button>
                    </div>
                </div>
            </form>
        </div>
    );
}
    export default CreateNewOneTimeLaborContract;
