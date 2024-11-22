import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, updateDoc, startAfter, doc, getDoc, where, setDoc,Timestamp, deleteDoc  } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';

const LaborContractDetails = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const navigate = useNavigate()

    const {laborContractId} = useParams();
    const [taskList,setTaskList] = useState([])
    const [formattedDateCreated,setFormattedDateCreated] = useState()

    const [laborContract,setLaborContract] = useState({
        id : '',
        dateSent : '',
        lastDateToAccept : '',
        dateAccepted : '',
        notes : '',
        description : '',
        receiverAcceptance : '',
        receiverId : '',
        receiverName : '',
        senderAcceptance : '',
        senderId : '',
        senderName : '',
        status : '',
        terms : '',
        rateOffered : '',
        jobId : '',
        serviceStopId : '',//Maybe Remove
        postingType : '',
        boardId : '',
        workOrderTaskId : ''
    });
    

    useEffect(() => {
        (async () => {
            try{
                //Get Labor Contract Info
                const docRef = doc(db, "laborContracts",laborContractId);
                const docSnap = await getDoc(docRef);
                let customerId;
                let serviceLocationId;

                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    setLaborContract((prevLaborContract) => ({
                        ...prevLaborContract,
                        id : docSnap.data().id,
                        dateSent : docSnap.data().dateSent,
                        lastDateToAccept : docSnap.data().lastDateToAccept,
                        dateAccepted : docSnap.data().dateAccepted,
                        notes : docSnap.data().notes,
                        description : docSnap.data().description,
                        receiverAcceptance : docSnap.data().receiverAcceptance,
                        receiverId : docSnap.data().receiverId,
                        receiverName : docSnap.data().receiverName,
                        senderAcceptance : docSnap.data().senderAcceptance,
                        senderId : docSnap.data().senderId,
                        senderName : docSnap.data().senderName,
                        status : docSnap.data().status,
                        terms : docSnap.data().terms,
                        rateOffered : docSnap.data().rateOffered,
                        senderId : docSnap.data().senderId,
                        jobId : docSnap.data().jobId,
                        senderId : docSnap.data().senderId,
                        serviceStopId : docSnap.data().serviceStopId,
                        postingType : docSnap.data().postingType,
                        boardId : docSnap.data().boardId,

                    }));
                    // const dateCreated = docSnap.data().dateCreated.toDate();
                    // const formattedDateCreated = format(dateCreated, 'MMMM d, yyyy'); 
                    // setFormattedDateCreated(formattedDateCreated)
                    // customerId = docSnap.data().customerId
                    // serviceLocationId = docSnap.data().serviceLocationId
                } else {
                console.log("No such document!");
                }
                //Get Tasks
                let taskQuery = query(collection(db, "laborContracts",laborContractId,'tasks'));
                const querySnapshot = await getDocs(taskQuery);       
                setTaskList([])      
                querySnapshot.forEach((doc) => {
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
                        bodyOfWaterId : taskData.bodyOfWaterId,
                        workOrderTaskId : taskData.workOrderTaskId
                    }
                    setTaskList(taskList => [...taskList, task]); 
                });

            
            } catch(error){
                console.log('Error')

                console.log(error)

            }
        })();
    },[])
    async function sendLaborContract(e) {
        e.preventDefault()
    }
    async function deleteLaborContract(e) {
        e.preventDefault()
        if (laborContract.status==='Draft'||laborContract.status==='Offered'){
            //Delete Contract
            await deleteDoc (doc(db,"laborContracts",laborContractId));
            console.log('Deleted Labor Contract')
            //Update Job

            // await updateDoc(doc(db,'companies',recentlySelectedCompany,"workOrders",laborContract.jobId), {
            //     status : 'Offered',
            //     laborContractId : laborContractId
            // });
            //Update Job Status
            await updateDoc(doc(db,'companies',recentlySelectedCompany,"workOrders",laborContract.jobId), {
                operationStatus : 'Unscheduled',
            });
            console.log('Updated Job')

            //Update Job Tasks
            for (let i = 0; i < taskList.length; i++) {
                let taskId = 'lc_tas_' + uuidv4();
                let task = taskList[i]
                await updateDoc(doc(db,'companies',recentlySelectedCompany,"workOrders",laborContract.jobId,'tasks',task.workOrderTaskId), {
                    status : 'Unassigned',
                    laborContractId : ''
                });
                console.log('Updated Job Task')

            }
        }
        //Maybe have google function update these. 
        //Update Job
        navigate('/company/laborContracts')
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
            <div className='flex justify-between items-center'>
                <Link 
                
                className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
                to={`/company/laborContracts`}>Back</Link>
                <p>Edit if not accepted</p>
                {
                    (laborContract.status==='Draft')&&<div className='flex justify-between items-center gap-2'>
                        <button 
                        onClick={(e) => sendLaborContract(e)} 
                        className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Edit</button>
                        <button 
                        onClick={(e) => sendLaborContract(e)} 
                        className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Send</button>
                        <button 
                        onClick={(e) => deleteLaborContract(e)} 
                        className='py-1 px-2 bg-[#9C0D38] rounded-md py-1 px-2 text-[#]'
                        >Delete</button>

                    </div>
                }
                {
                    (laborContract.status==='Offered')&&<div className='flex justify-between items-center gap-2'>
                        <button  
                        onClick={(e) => sendLaborContract(e)} 
                        className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Edit</button>
                        <button 
                        onClick={(e) => sendLaborContract(e)} 
                        className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Send</button>
                        <button 
                        onClick={(e) => deleteLaborContract(e)} 
                        className='py-1 px-2 bg-[#9C0D38] rounded-md py-1 px-2 text-[#]'
                        >Delete</button>
                    </div>
                }
                {
                    (laborContract.status==='Rejected')&&<div className='flex justify-between items-center gap-2'>
                    
                    </div>
                }
                {
                    (laborContract.status==='Accepted')&&<div className='flex justify-between items-center gap-2'>
                    
                    </div>
                }
                {
                    (laborContract.status==='Completed')&&<div className='flex justify-between items-center gap-2'>
                    
                    </div>
                }
                {
                    (laborContract.status==='Unassigned')&&<div className='flex justify-between items-center gap-2'>
                    
                    </div>
                }
            </div>
            <p>Red Flag. Might be able to access Labor Contracts that arent yours</p>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                <div className='flex justify-between items-center'>
                    {
                        (laborContract.status==='Draft')&&<p className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Draft</p>
                    }
                    {
                        (laborContract.status==='Offered')&&<p className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Offered</p>
                    }
                    {
                        (laborContract.status==='Rejected')&&<p className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Rejected</p>
                    }
                    {
                        (laborContract.status==='Accepted')&&<p className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Accepted</p>
                    }
                    {
                        (laborContract.status==='Completed')&&<p className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Completed</p>
                    }
                    {
                        (laborContract.status==='Unassigned')&&<p className='py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#]'>Unassigned</p>
                    }
                    </div>
                    <h2>Labor Contract Detail View {laborContractId}</h2>
                    <p>id {laborContract.id}</p>
                    <p>dateSent {laborContract.dateSent}</p>
                    <p>lastDateToAccept {laborContract.lastDateToAccept}</p>
                    <p>dateAccepted {laborContract.dateAccepted}</p>
                    <p>notes {laborContract.notes}</p>
                    <p>description {laborContract.description}</p>
                    <p>receiverAcceptance {laborContract.receiverAcceptance}</p>
                    <p>receiverId {laborContract.receiverId}</p>
                    <p>receiverName {laborContract.receiverName}</p>
                    <p>senderAcceptance {laborContract.senderAcceptance}</p>
                    <p>senderId {laborContract.senderId}</p>
                    <p>senderName {laborContract.senderName}</p>
                    <p>status {laborContract.status}</p>
                    <p>terms {laborContract.terms}</p>
                    <p>rateOffered {laborContract.rateOffered}</p>
                    <p>jobId <Link 
                    className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
                    to={`/company/jobs/detail/${laborContract.jobId}`}>{laborContract.jobId}</Link></p>
                    <p>serviceStopId {laborContract.serviceStopId}</p>
                    <p>postingType {laborContract.postingType}</p>
                    <p>boardId {laborContract.boardId}</p>
                    <p>TaskList {taskList.length}</p>

                    <hr/>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                            <th className='py-3 px-4'>id</th>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Status</th>
                                <th className='py-3 px-4'>Contracted Rate</th>

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
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.contractedRate}</td>
                                    

                                </tr>
                            ))
                        }
                        </tbody>
                    </table>
                    <form>
                        <input
                        placeholder='Place Holder'
                        ></input>
                        <button>Submit</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
    export default LaborContractDetails;