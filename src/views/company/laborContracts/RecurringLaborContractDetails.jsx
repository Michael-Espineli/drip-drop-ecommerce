import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const RecurringLaborContractDetails = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const {laborContractId} = useParams();
    const [laborContract,setLaborContract] = useState({
        atWill : '',
        dateSent : '',
        id : '',
        endDate : '',
        lastDateToAccept : '',
        notes : '',
        receiverAcceptance : '',
        receiverId : '',
        receiverName : '',
        senderAcceptance : '',
        senderId : '',
        senderName : '',
        startDate : '',
        status : '',
        terms : ''
    });
    useEffect(() => {
        (async () => {
            try{
                const docRef = doc(db, "recurringLaborContracts",laborContractId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    setLaborContract((laborContract) => ({
                        ...laborContract,
                        atWill: docSnap.data().atWill,
                        dateSent: docSnap.data().dateSent,
                        id: docSnap.data().id,
                        endDate: docSnap.data().endDate,
                        lastDateToAccept : docSnap.data().lastDateToAccept,
                        notes : docSnap.data().notes,
                        receiverAcceptance : docSnap.data().receiverAcceptance,
                        receiverId : docSnap.data().receiverId,
                        receiverName : docSnap.data().receiverName,
                        senderAcceptance : docSnap.data().senderAcceptance ,
                        senderId : docSnap.data().senderId,
                        senderName : docSnap.data().senderName,
                        startDate : docSnap.data().startDate,
                        status : docSnap.data().status ,
                        terms : docSnap.data().terms 
                    }));

                  } else {
                    console.log("No such document!");
                  }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <p>{laborContractId}</p>
                    <p>{laborContract.atWill}</p>
                    {/* <p>{laborContract.dateSent}</p> */}
                    {/* <p>{laborContract.endDate}</p> */}
                    {/* <p>{companyUser.lastDateToAccept}</p> */}
                    <p>{laborContract.notes}</p>
                    <p>{laborContract.receiverAcceptance}</p>
                    <p>{laborContract.receiverId}</p>
                    <p>{laborContract.receiverName}</p>
                    <p>{laborContract.senderAcceptance}</p>
                    <p>{laborContract.senderId}</p>
                    <p>{laborContract.senderName}</p>
                    {/* <p>{laborContract.startDate}</p> */}
                    <p>{laborContract.status}</p>
                    <p>terms</p>
                </div>
            </div>
        </div>
    );
}
    export default RecurringLaborContractDetails;
