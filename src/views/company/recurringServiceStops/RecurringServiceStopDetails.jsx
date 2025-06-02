import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, where, deleteDoc, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const RecurringServiceStopDetails = () => {

    const {name,recentlySelectedCompany} = useContext(Context);

    const {recurringServiceStopId} = useParams();

    const navigate = useNavigate()

    const [startDate, setStartDate] = useState("");
    
    const [endDate, setEndDate] = useState("");
    
    const [edit, setEdit] = useState(false);
    
    const [serviceStopList, setServiceStopList] = useState([]);
    
    const [pastServiceStopList, setPastServiceStopList] = useState([]);
        
    const [recurringServiceStop,setRecurringServiceStop] = useState({
        id: "",
        internalId : "",
        type: "",
        typeId: "",
        typeImage: "",
        customerId: "",
        customerName: "",

        streetAddress: "",
        city: "",
        state: "",
        zip: "",
        latitude: "",
        longitude: "",

        tech: "",
        techId: "",
        dateCreated: "",
        startDate: "",
        endDate: "",
        noEndDate: "",
        frequency: "",
        daysOfWeek: "",
        lastCreated: "",

        serviceLocationId: "",
        estimatedTime: "",
        otherCompany: "",
        laborContractId: "",
        contractedCompanyId:""
    });
    useEffect(() => {
        (async () => {
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany,'recurringServiceStop',recurringServiceStopId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    let rssData = docSnap.data()
                    setRecurringServiceStop((prevRecurringServiceStop) => ({
                        ...prevRecurringServiceStop,
                        id:rssData.id,
                        internalId : rssData.internalId,
                        type:rssData.type,
                        typeId:rssData.typeId,
                        typeImage: rssData.typeImage,
                        customerId:rssData.customerId,
                        customerName: rssData.customerName,

                        streetAddress:rssData.address.streetAddress,
                        city:rssData.address.city,
                        state:rssData.address.state,
                        zip:rssData.address.zip,
                        latitude:rssData.address.latitude,
                        longitude:rssData.address.longitude,

                        tech:rssData.tech,
                        techId:rssData.techId,
                        dateCreated:rssData.dateCreated,
                        startDate:rssData.startDate,
                        endDate:rssData.endDate,
                        noEndDate:rssData.noEndDate,
                        frequency:rssData.frequency,
                        daysOfWeek:rssData.daysOfWeek,
                        lastCreated:rssData.lastCreated,

                        serviceLocationId:rssData.serviceLocationId,
                        estimatedTime:rssData.estimatedTime,
                        otherCompany:rssData.otherCompany,
                        laborContractId:rssData.laborContractId,
                        contractedCompanyId:rssData.contractedCompanyId
                    }));

                    // const startDate1 = rssData.startDate.toDate();
                    // const formattedDateCreated1 = format(startDate1, 'MMMM d, yyyy'); 
                    // setStartDate(formattedDateCreated1)

                    // const dateCreated = rssData.endDate.toDate();
                    // const formattedDateCreated = format(dateCreated, 'MMMM d, yyyy'); 
                    // setEndDate(formattedDateCreated)

                    // Get Service Stops Future
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'), where('recurringServiceStopId','==',recurringServiceStopId), where('serviceDate','>=',new Date()),limit(5) ); //,limit(10)
                    const querySnapshot = await getDocs(q);       
                    setServiceStopList([])      
                    querySnapshot.forEach((doc) => {

                        const serviceStopData = doc.data()
                        const date = serviceStopData.serviceDate.toDate();
                        const formattedDate = format(date, 'MMMM d, yyyy'); 

                        const serviceStop = {
                            id:serviceStopData.id,
                            tech:serviceStopData.tech,
                            customerName:serviceStopData.customerName,
                            streetAddress: serviceStopData.address.streetAddress,
                            jobId:serviceStopData.jobId,
                            date:formattedDate
                        }
                        setServiceStopList(serviceStopList => [...serviceStopList, serviceStop]); 
                    });
                    
                    // Get Service Past Future
                    let q1 = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'), where('recurringServiceStopId','==',recurringServiceStopId), where('serviceDate','<',new Date()),limit(5) ); //,limit(10)
                    const querySnapshot1 = await getDocs(q1);       
                    setPastServiceStopList([])      
                    querySnapshot1.forEach((doc) => {

                        const serviceStopData = doc.data()
                        const date = serviceStopData.serviceDate.toDate();
                        const formattedDate = format(date, 'MMMM d, yyyy'); 

                        const serviceStop = {
                            id:serviceStopData.id,
                            tech:serviceStopData.tech,
                            customerName:serviceStopData.customerName,
                            streetAddress: serviceStopData.address.streetAddress,
                            jobId:serviceStopData.jobId,
                            date:formattedDate
                        }
                        setPastServiceStopList(pastServiceStopList => [...pastServiceStopList, serviceStop]); 
                    });
                } else {
                    console.log("No such document!");
                }
            } catch(error){
                console.log('Error')
                console.log(error)
            }
        })();
    },[])

    
    async function deleteRSS(e) {
        e.preventDefault()
        await deleteDoc(doc(db, "companies",recentlySelectedCompany, "recurringServiceStop",recurringServiceStopId));
        navigate('/company/recurringServiceStop')
    }

    async function editRSS(e) {
        e.preventDefault()
        setEdit(true)
    }

    async function cancelEdit(e) {
        e.preventDefault()
        setEdit(false)
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
            <div className='py-2'>
                <h1 className=' font-bold'>Recurring Service Stop Detail</h1>
                   
                {
                    edit ? <div className="flex justify-between">
                        <div className='bg-[#9C0D38] rounded-md text-[#cfcfcf] px-2 py-1'>
                                        
                            <button
                                onClick={(e) => deleteRSS(e)} >
                                    Delete
                            </button>
                        </div>
                        <div className='bg-[#0e245c] rounded-md text-[#cfcfcf] px-2 py-1'>
                    
                            <button
                            onClick={(e) => cancelEdit(e)} >
                                Cancel
                            </button>
                        </div>
                    </div>:<div className="flex justify-between">
                        <div className='bg-[#0e245c] rounded-md text-[#cfcfcf] px-2 py-1'>
                            <Link 
                            className=''
                            to={`/company/recurringServiceStop`}>Back</Link>
                        </div>
                        <div className='bg-[#0e245c] rounded-md text-[#cfcfcf] px-2 py-1'>
                    
                            <button
                            onClick={(e) => editRSS(e)} >
                                Edit
                            </button>
                        </div>
                    </div>
                }
                
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#cfcfcf] p-4'>
                    <h1>Internal Id - {recurringServiceStop.internalId}</h1>
                    <h1>type - {recurringServiceStop.type}</h1>
                    <h1>customerName - {recurringServiceStop.customerName}</h1>
                    <h1>streetAddress - {recurringServiceStop.streetAddress}</h1>
                    <h1>tech - {recurringServiceStop.tech}</h1>
                    <h1>startDate - {startDate}</h1>
                    <h1>endDate - {endDate}</h1>
                    <h1>frequency - {recurringServiceStop.frequency}</h1>
                    <h1>daysOfWeek - {recurringServiceStop.daysOfWeek}</h1>
                    <h1>serviceLocationId - {recurringServiceStop.serviceLocationId}</h1>
                    <h1>estimatedTime - {recurringServiceStop.estimatedTime}</h1>
                </div>
            </div>
            
            <div className='py-2 text-[#00000] font-bold'>
                <p>Upcoming Jobs</p>
            </div>
            
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#cfcfcf] p-4'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Date</th>
                                    <th className='py-3 px-4'>Tech</th>
                                    <th className='py-3 px-4'>Customer Name</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Job Id</th>
                                    <th className='py-3 px-4'>Status</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                serviceStopList?.map(serviceStop => (
                                        <tr key={serviceStop.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.date}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.tech}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.customerName}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.streetAddress}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.jobId}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.status}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>Details</Link></td>
                                        </tr>
                                    
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <div className='py-2 text-[#00000] font-bold'>
                <p>Most Recent Jobs</p>
            </div>
            
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#cfcfcf] p-4'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Date</th>
                                    <th className='py-3 px-4'>Tech</th>
                                    <th className='py-3 px-4'>Customer Name</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Job Id</th>
                                    <th className='py-3 px-4'>Status</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                pastServiceStopList?.map(serviceStop => (
                                        <tr key={serviceStop.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.date}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.tech}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.customerName}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.streetAddress}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.jobId}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.status}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>Details</Link></td>
                                        </tr>
                                    
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
    );
}
export default RecurringServiceStopDetails;