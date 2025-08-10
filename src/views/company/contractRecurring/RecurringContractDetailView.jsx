import React, {useState, useEffect, useContext} from 'react';
import { useParams } from 'react-router-dom';
import { query, collection, getDocs, doc, updateDoc, getDoc, startAfter, where, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { format } from 'date-fns'; // Or any other date formatting library

const RecurringContractDetailView = () => {
    const {contractId} = useParams();
    
    const [contract,setContract] = useState({
        chemType : '',
        companyId : '',
        companyName : '',
        customerId : '',
        customerName : '',
        dateSent : '',
        dateToAccept : '',
        id : '',
        laborRate : '',
        laborType : '',
        locations : '',
        notes : '',
        rate : '',
        rateType : '',
        startDate : '',
        status : '',
        terms : ''
    });

    const [formattedDateSent,setFormattedDateSent] = useState()
    const [formattedDateToAccept,setFormattedDateToAccept] = useState()
    const [formattedStartDate,setFormattedStartDate] = useState()

    useEffect(() => {
        (async () => {
             try{
                const contractRef = doc(db, "contracts",contractId);
                const contractDoc = await getDoc(contractRef);
                if (contractDoc.exists()) {
                    setContract((prevContract) => ({
                        ...prevContract,
                        chemType: contractDoc.data().chemType,
                        companyId: contractDoc.data().companyId,
                        companyName: contractDoc.data().companyName,
                        customerId: contractDoc.data().customerId,
                        customerName : contractDoc.data().customerName,
                        dateSent : contractDoc.data().dateSent ,
                        dateToAccept : contractDoc.data().dateToAccept ,
                        id : contractDoc.data().id,
                        laborRate : contractDoc.data().laborRate,
                        laborType : contractDoc.data().laborType,
                        locations : contractDoc.data().locations,
                        notes : contractDoc.data().notes,
                        rate : contractDoc.data().rate,
                        rateType : contractDoc.data().rateType,
                        serviceLocationId : contractDoc.data().serviceLocationId,
                        startDate : contractDoc.data().startDate,
                        status : contractDoc.data().status,

                        // status : 'Rejected',
                        terms : contractDoc.data().terms
                    }));
                    
                    const dateSent = contractDoc.data().dateToAccept.toDate();
                    const formattedDateSent = format(dateSent, 'MMMM d, yyyy h:mm a'); 
                    setFormattedDateSent(formattedDateSent)

                    const dateToAccept = contractDoc.data().dateToAccept.toDate();
                    const formattedDateToAccept = format(dateToAccept, 'MMMM d, yyyy h:mm a'); 
                    setFormattedDateToAccept(formattedDateToAccept)

                    const startDate = contractDoc.data().dateToAccept.toDate();
                    const formattedStartDate = format(startDate, 'MMMM d, yyyy h:mm a'); 
                    setFormattedStartDate(formattedStartDate)

                  } else {
                    console.log("No such document!");
                  }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
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
            <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <h1 className='font-bold'> Contract Detail View</h1>
                <h1>chemType : {contract.chemType}</h1>    
                <h1>companyId : {contract.companyId}</h1>  
                <h1>companyName : {contract.companyName}</h1>  
                <h1>customerId : {contract.customerId}</h1>  
                <h1>customerName : {contract.customerName}</h1>  
                <h1>dateSent : {formattedDateSent}</h1>  
                <h1>dateToAccept : {formattedDateToAccept}</h1>  
                <h1>id : {contract.id}</h1>  
                <h1>laborRate : {contract.laborRate}</h1>  
                <h1>laborType : {contract.laborType}</h1>  
                <h1>locations : {contract.locations}</h1>  
                <h1>notes : {contract.notes}</h1>  
                <h1>rate : {contract.rate}</h1>  
                <h1>rateType : {contract.rateType}</h1>  
                <h1>serviceLocationId : {contract.serviceLocationId}</h1>
                <h1>startDate : {formattedStartDate}</h1>
                {
                    (contract.status=='Pending')&&
                    <div className='p-2'>
                        <span className='bg-[#CDC07B] px-1 py-2 rounded-md text-[#ededed]'>
                            {contract.status}
                        </span>
                    </div>
                }
                               {
                    (contract.status=='Accepted')&&
                    <div className='p-2'>
                        <span className='bg-[#2B600F] px-1 py-2 rounded-md text-[#ededed]'>
                            {contract.status}
                        </span>
                    </div>
                }
                               {
                    (contract.status=='Rejected')&&
                    <div className='p-2'>
                        <span className='bg-[#9C0D38] px-1 py-2 rounded-md text-[#ededed]'>
                            {contract.status}
                        </span>
                    </div>
                }
                <h1>terms : {contract.terms}</h1>
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <p>Terms</p>
                    <p>{contract.terms}</p>
                </div>
            </div>
        </div>
    );
};

export default RecurringContractDetailView;