import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import Select from 'react-select';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, where, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../../utils/config";
import {v4 as uuidv4} from 'uuid';
import { Context } from "../../../../context/AuthContext";
import toast from "react-hot-toast";
import { useNavigate } from 'react-router-dom';

const TaskGroupDetails = () => {
    const navigate = useNavigate()

    const {name,recentlySelectedCompany} = useContext(Context);

    const {taskGroupId} = useParams();

    const [taskList, setTaskList] = useState([]);

    const [taskGroup, setTaskGroup] = useState({
        id : '',
        groupName : '',
        numberOfTasks : '',
    });
    const [taskName, setTaskName] = useState('');

    const [taskDescription, setTaskDescription] = useState('');

    const [taskToEdit, setTaskToEdit] = useState([]);

    const [taskLaborCost, setTaskLaborCost] = useState();

    const [taskTime, setTaskTime] = useState();

    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });

    const [taskTypeList, setTaskTypeList] = useState([]);

    useEffect(() => {
        (async () => {
            try{
                let docSnap = await getDoc(doc(db, 'companies',recentlySelectedCompany,'settings','taskGroups','taskGroups',taskGroupId));
                if (docSnap.exists()) {
                    console.log('Has Item')
                    const data = docSnap.data()

                    setTaskGroup((taskGroup) => ({
                        ...taskGroup,
                        id : data.id,
                        groupName : data.groupName,
                        numberOfTasks : data.numberOfTasks,
                    }))
                }
                
                //Get Task List
                let taskListQ = query(collection(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId,'tasks'));
                const taskListQSnapshot = await getDocs(taskListQ);       
                setTaskList([])      
                taskListQSnapshot.forEach((doc) => {
                    const taskData = doc.data()
                    const taskType = {
                        id : taskData.id,
                        name : taskData.name,
                        description : taskData.description,
                        typeId : taskData.typeId,
                        type : taskData.type,
                        contractedRate : taskData.contractedRate,
                        estimatedTime : taskData.estimatedTime
                    }
                    setTaskList(taskList => [...taskList, taskType]); 
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
                
            } catch(error){
                console.log(error)
                console.log('Error')
            }
        })();
    },[])
    const handleSelectedTaskTypeChange = (option) => {

        (async () => {
            setSelectedTaskType(option)
            
        })();
    };
    async function cancelEditTask(e,taskId) {
        e.preventDefault()

        setTaskToEdit({})
    }
    async function editTask(e,taskId) {
        e.preventDefault()
        const task = taskList.find(item => item.id === taskId);

        setTaskToEdit(task)
    }
    async function handleAddTask(e) {
        e.preventDefault()

        try{
            let taskId = 'com_set_tg_tas_' + uuidv4();
            console.log('Adding Task: ' + taskId)
            let labor = parseFloat(taskLaborCost);
            labor = labor*100
            let time = parseFloat(taskTime);

            // let task = {
            //     id : taskId,
            //     name : taskName,
            //     description : taskDescription,
            //     typeId : selectedTaskType.id,
            //     type : selectedTaskType.name,
            //     contractedRate : labor,
            //     estimatedTime : time
            // }

            // setTaskList(taskList => [...taskList, task]); 
            // console.log(5)

            //Update Task
            await setDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId,'tasks',taskId), {
                id : taskId,
                name : taskName,
                description : taskDescription,
                typeId : selectedTaskType.id,
                type : selectedTaskType.name,
                contractedRate : labor,
                estimatedTime : time
            });

            //Update Task Group
            await updateDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId), {
                numberOfTasks: taskList.length + 1
            });

            //Get Updated Task Group
            let docSnap = await getDoc(doc(db, 'companies',recentlySelectedCompany,'settings','taskGroups','taskGroups',taskGroupId));
            if (docSnap.exists()) {
                console.log('Has Item')
                const data = docSnap.data()

                setTaskGroup((taskGroup) => ({
                    ...taskGroup,
                    id : data.id,
                    groupName : data.groupName,
                    numberOfTasks : data.numberOfTasks,
                }))
            }
            toast.success("Successfully Added Task")
            //Get Updated Task List
                let taskListQ = query(collection(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId,'tasks'));
                const taskListQSnapshot = await getDocs(taskListQ);       
                setTaskList([])      
                taskListQSnapshot.forEach((doc) => {
                    const taskData = doc.data()
                    const taskType = {
                        id : taskData.id,
                        name : taskData.name,
                        description : taskData.description,
                        typeId : taskData.typeId,
                        type : taskData.type,
                        contractedRate : taskData.contractedRate,
                        estimatedTime : taskData.estimatedTime
                    }
                    setTaskList(taskList => [...taskList, taskType]); 
                });
            setSelectedTaskType({})
            setTaskDescription('')
            setTaskName('')
            setTaskTime('')
            setTaskLaborCost('')

          } catch(error){
              console.log('Error : ' + error)
          }
    }
    async function removeTask(e,taskId) {
        e.preventDefault()
        console.log('Remove')
        // //Remove From list
        // console.log(taskId)
        // const newArr = taskList.filter(obj => obj.id !== taskId); // Keep all objects except the one with id 2
        // console.log(newArr)
        // setTaskList(newArr)
        try {
            await deleteDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId,'tasks',taskId));
            await updateDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId), {
                numberOfTasks: taskList.length - 1
            });
            toast.success("Successfully Removed Task")

            //Get Updated Task Group
            let docSnap = await getDoc(doc(db, 'companies',recentlySelectedCompany,'settings','taskGroups','taskGroups',taskGroupId));
            if (docSnap.exists()) {
                console.log('Has Item')
                const data = docSnap.data()

                setTaskGroup((taskGroup) => ({
                    ...taskGroup,
                    id : data.id,
                    groupName : data.groupName,
                    numberOfTasks : data.numberOfTasks,
                }))
            }

            //Get Updated Task List
                let taskListQ = query(collection(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId,'tasks'));
                const taskListQSnapshot = await getDocs(taskListQ);       
                setTaskList([])      
                taskListQSnapshot.forEach((doc) => {
                    const taskData = doc.data()
                    const taskType = {
                        id : taskData.id,
                        name : taskData.name,
                        description : taskData.description,
                        typeId : taskData.typeId,
                        type : taskData.type,
                        contractedRate : taskData.contractedRate,
                        estimatedTime : taskData.estimatedTime
                    }
                    setTaskList(taskList => [...taskList, taskType]); 
                });
        } catch(error){
            console.log('Error : ' + error)

        }

        
    }
    async function deleteTaskGroup(e,t) {
        e.preventDefault()
        try{
            console.log('deleteTaskGroup')

            await deleteDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId));
            toast.dismiss(t.id)
            toast.success("Successfully Deleted Task Group")
            navigate('/company/taskGroups')

        } catch (error){
            console.log('Error ' + error)
        }

    }

      const customToast = () => toast(
        (t) => (
          <div>
            Are you sure you want to delete Task Group?{' '}
            <div className=' flex justify-between py-1'>
                <button 
                className='bg-[#2B600F] cursor-pointer rounded'
                onClick={(e) => { deleteTaskGroup(e,t) } }>
                    <h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Yes</h1>
                </button>
                <button 
                className='bg-[#9C0D38] cursor-pointer rounded'
                onClick={() => {toast.dismiss(t.id)}}>
                    <h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>No</h1>
                </button>
            </div>
          </div>
        ),
        {
          duration: 10000,
        }
      );

    async function clearNewTask(e) {
        e.preventDefault()
        setSelectedTaskType({})
        setTaskDescription('')
        setTaskLaborCost('')

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
            <div className='py-2'> 
                <Link 
                className=' font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#1D2E76] cursor-pointer rounded mt-3'
                to={`/company/taskGroups`}>Back</Link>
            </div>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                <div className="flex w-full justify-between">
                    <div>
                        <h1 className='text-[#000000] font-bold'>Task Group Details</h1>
                        <p>Group Name : {taskGroup.groupName}</p>
                        <p>Number Of Items : {taskGroup.numberOfTasks}</p>
                    </div>
                    <div>
                        <button className="bg-[#9C0D38] cursor-pointer rounded" onClick={customToast}><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Delete</h1></button>

                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4 mt-2'>
                <h1 className='text-[#000000] font-bold'>Task List</h1>
                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Contracted Rate</th>
                                <th className='py-3 px-4'>Estimated Time</th>
                                <th className='py-3 px-4'>Description</th>

                            </tr>
                        </thead>
                        <tbody>
                        {
                            taskList?.map(task => (
                                <tr key={task.id}>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.name}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.type}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        <p>{(task.contractedRate/100).toFixed(2)}</p>
                                        <input 
                                        className='w-full py-1 px-2 rounded-md mt-2'

                                        onChange={(e) => {setTaskDescription(e.target.value)}} type="text" placeholder='Rate' value={taskDescription}></input>
                                    </td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.estimatedTime}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.description}</td>

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
                    <div className='py-2 flex justify-between items-center gap-2 text-[#000000]'>
                        
                        <input onChange={(e) => {setTaskName(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Name' value={taskName}></input>

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
                        <input onChange={(e) => {setTaskLaborCost(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Contracted Rate' value={taskLaborCost}></input>
                        <input onChange={(e) => {setTaskTime(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Estimated Time' value={taskTime}></input>
                        <div>
                            <button onClick={(e) => clearNewTask(e)} 
                            className='py-1 px-2 rounded-md bg-[#9C0D38] text-[#ffffff]'
                            >Clear</button>
                            <button onClick={(e) => handleAddTask(e)} 
                            className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000] mt-2'
                            >Add</button>
                        </div>
                        
                    </div>
                    <input onChange={(e) => {setTaskDescription(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description' value={taskDescription}></input>

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
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Fill Water')&&<div>
                                <p>Fill Water</p>
                                <p>Select Body Of Water</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Install')&&<div>
                                <p>Install</p>
                                <p>Select New Piece of Equipment to Install</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Remove')&&<div>
                                <p>Remove</p>
                                <p>Select Equipment To remove</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Replace')&&<div>
                                <p>Replace</p>
                                <p>Select Equipment To remove</p>
                                <p>Select New Piece of Equipment to Install</p>
                            </div>
                        }
                    </div>
            </div>
            <div className='py-2 flex justify-between items-center gap-2 text-[#000000]'>
                <button onClick={(e) => clearNewTask(e)} 
                className=' w-full py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff]'
                >Update Task Group</button>
            </div>

        </div>
    );
};

export default TaskGroupDetails;