import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where, or } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { RecurringLaborContract } from '../../../utils/models/RecurringLaborContract';
import { Customer } from '../../../utils/models/Customer';

const LaborContracts = () => {
    const [laborContractlist, setLaborContractlist] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
                try{
                    setLaborContractlist([])    


                    let q = query(collection(db,'recurringLaborContracts'),
                    or(where('senderId','==',recentlySelectedCompany),where('receiverId','==',recentlySelectedCompany)));
                    const querySnapshot = await getDocs(q);  
                    const data = querySnapshot.docs.map(doc => RecurringLaborContract.fromFirestore(doc));

                    setLaborContractlist(data);

                } catch(error){
                    console.log('Error', error)
                }
            
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <Link 
            className='py-1 px-2 green-bg white-fg rounded-md'
            to={`/company/recurringLaborContracts/createNew`}>Create New</Link>
            Recurring Labor Contracts
            <div className='w-full white-bg p-4 rounded-md mt-4'>
                    <div className='left-0 w-full justify-between'>
                        <div className='relative overflow-x-auto'>
                            <table className="min-w-full bg-white border border-gray-200">
                                <thead>
                                <tr>
                                    <th className='py-3 px-4 border-b'>At Will</th>
                                    <th className='py-3 px-4 border-b'>Sender Name</th>
                                    <th className='py-3 px-4 border-b'>Receiver Name</th>
                                    <th className='py-3 px-4 border-b'>Receiver Acceptance</th>
                                    <th className='py-3 px-4 border-b'>Status</th>
                                    <th className='py-3 px-4 border-b'>Notes</th>
                                    <th className='py-3 px-4 border-b'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                laborContractlist?.map((laborContract) => (
                                        <tr key={laborContract.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>{laborContract.atWill}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>{laborContract.senderName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>{laborContract.receiverName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>{laborContract.receiverAcceptance}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>{laborContract.status}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>{laborContract.notes}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap border-b'><Link to={`/company/recurringLaborContracts/${laborContract.id}`}>Details</Link></td>

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
    export default LaborContracts;
