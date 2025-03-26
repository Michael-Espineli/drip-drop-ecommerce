import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
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

                    const startDate1 = docSnap.data().startDate.toDate();
                    const formattedDateCreated1 = format(startDate1, 'MMMM d, yyyy'); 
                    setStartDate(formattedDateCreated1)

                    const dateCreated = docSnap.data().endDate.toDate();
                    const formattedDateCreated = format(dateCreated, 'MMMM d, yyyy'); 
                    setEndDate(formattedDateCreated)
                } else {
                    console.log("No such document!");
                }
            } catch(error){
                console.log('Error')
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
                    </div>:<div className="flex justify-end">
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
                    <h1>{recurringServiceStop.internalId}</h1>
                    <h1>{recurringServiceStop.type}</h1>
                    <h1>{recurringServiceStop.customerName}</h1>
                    <h1>{recurringServiceStop.streetAddress}</h1>
                    <h1>{recurringServiceStop.tech}</h1>
                    <h1>{startDate}</h1>
                    <h1>{endDate}</h1>
                    <h1>{recurringServiceStop.frequency}</h1>
                    <h1>{recurringServiceStop.daysOfWeek}</h1>
                    <h1>{recurringServiceStop.serviceLocationId}</h1>
                    <h1>{recurringServiceStop.estimatedTime}</h1>
                </div>
            </div>
        </div>
    );
}
export default RecurringServiceStopDetails;