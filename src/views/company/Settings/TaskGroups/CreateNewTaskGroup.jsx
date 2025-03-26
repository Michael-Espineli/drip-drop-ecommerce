import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, where, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../../utils/config";
import { Context } from "../../../../context/AuthContext";
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const CreateNewTaskGroup = () => {
    const navigate = useNavigate()

    const {name,recentlySelectedCompany} = useContext(Context);

    const [groupName, setGroupName] = useState();

    const [taskList, setTaskList] = useState([]);

    const [taskLaborCost, setTaskLaborCost] = useState();
    
    const [taskName, setTaskName] = useState();
    
    const [description, setDescription] = useState();
        
    const [estimatedTime, setEstimatedTime] = useState();
        
    const [taskTypeList, setTaskTypeList] = useState([]);

    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });

    const handleSelectedTaskTypeChange = (selectedOption2) => {

        (async () => {
            setSelectedTaskType(selectedOption2)
            
        })();
    };

    useEffect(() => {
        (async () => {
            try{
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
                    
                console.log("Retrived Task Types")
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    async function clearNewTask(e) {
        e.preventDefault()
        setSelectedTaskType({})
        setDescription('')
        setTaskName('')
        setEstimatedTime('')
        setTaskLaborCost('')

    }
    async function createNewTaskGroup(e) {
        e.preventDefault()
        let taskGroupId = 'com_set_tg_' + uuidv4();
        //Guard Statments
        //Create Task Group

        await setDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId), {
            id : taskGroupId,
            groupName : groupName,
            numberOfTasks: taskList.length

        });
        //Add Tasks to Task Group 
        for (let i = 0; i < taskList.length; i++) {
            let task = taskList[i]

            await setDoc(doc(db, "companies",recentlySelectedCompany, "settings",'taskGroups','taskGroups',taskGroupId,'tasks',task.id), {
                
                id : task.id,
                name : task.name,
                description : task.description,
                typeId : task.typeId,
                type : task.type,
                contractedRate : task.contractedRate,
                estimatedTime : task.estimatedTime
            });
        }
        //Navigate To Task Group Detail View
        navigate('/company/taskGroups/details/'+taskGroupId)

    }

    async function AddTaskToGroup(e) {
        e.preventDefault()

        let taskId = 'com_set_tg_tas_' + uuidv4();
              
        let labor = parseFloat(taskLaborCost);
        labor = labor*100
        let time = parseFloat(estimatedTime);

        let task = {
            id : taskId,
            name : taskName,
            description : description,
            typeId : selectedTaskType.id,
            type : selectedTaskType.name,
            contractedRate : labor,
            estimatedTime : time
        }
        setTaskList(taskList => [...taskList, task]); 
        toast.success('Successfully Added Task')
        setSelectedTaskType({})
        setDescription('')
        setTaskName('')
        setEstimatedTime('')
        setTaskLaborCost('')
    }
    async function deleteTaskItem(e,task) {
        e.preventDefault()
        try{
            //Delete Task
            console.log('Deleting Task')
            let oldTaskList = taskList
            console.log(oldTaskList)
            let newTaskList = oldTaskList.filter(item => item !== task);
            console.log(newTaskList)

            setTaskList(newTaskList); 
            toast.success('Successfully Deleted Task')

            console.log('Successfully deleted Task')

            } catch(error){
                console.log('Error: ' + error)
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
        <div className='px-2 md:px-7 py-5'>
            <div className='flex justify-between'>
                <Link 
                className='font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#CDC07B] cursor-pointer rounded mt-3'
                to={`/company/taskGroups`}>Back To List</Link>
                <p className='font-bold text-lg'>Create New Task Groups</p>
            </div>

            <form>
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-between'>
                        <p>Group Name</p>
                        <input 
                            className='w-full py-1 px-2 rounded-md mt-2'
                            onChange={(e) => {setGroupName(e.target.value)}} type="text" placeholder='Description' value={groupName}></input>
                    </div>
                </div>

                {/* Task List */}
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-between'>
                        <div className='flex justify-between'>
                            <p className='font-bold'>Task List</p>
                        </div>
                    
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Type</th>
                                    <th className='py-3 px-4'>Description</th>
                                    <th className='py-3 px-4 sm:hidden md:hidden'>Customer Approval</th>
                                    <th className='py-3 px-4'>Labor Cost</th>
                                    <th className='py-3 px-4'>Time (Hr)</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                taskList?.map(task => (
                                    <tr key={task.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.name}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.type}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.description}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>${(task.contractedRate/100).toFixed(2)}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{(task.estimatedTime/60).toFixed(2)}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                   
                                        </td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                            <button
                                            onClick={(e) => deleteTaskItem(e,task)} 
                                            >Delete</button>
                                        </td>

                                    </tr>
                                ))
                            }
                            </tbody>
                        </table><div>
                            <div className='py-2 flex justify-between items-center gap-2'>
                                <button onClick={(e) => clearNewTask(e)} 
                                className='px-2 rounded-md bg-[#9C0D38] text-[#ffffff]'>
                                    X
                                </button>
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
                                <input onChange={(e) => {setTaskLaborCost(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Labor Cost' value={taskLaborCost}></input>
                                <input onChange={(e) => {setEstimatedTime(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Estimated Time (Min)' value={estimatedTime}></input>

                                <button onClick={(e) => AddTaskToGroup(e)} 
                                className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'
                                >Add</button>
                            </div>
                            <input onChange={(e) => {setDescription(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description' value={description}></input>
                        </div>
                    </div>
                </div>
            </form>

                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                    <div className='left-0 w-full justify-between'>
                        <button
                        className='text-[#ededed] w-full bg-[#2B600F] py-1 px-2 rounded-md'
                        onClick={(e) => createNewTaskGroup(e)} 
                        >Create New Task Group</button>
                    </div>
                </div>
        </div>
    );
}
    export default CreateNewTaskGroup;