import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";

const LaborContracts = () => {
    const [laborContractlist, setLaborContractlist] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
                try{
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'laborContracts'));
                    const querySnapshot = await getDocs(q);       
                    setLaborContractlist([])      
                    querySnapshot.forEach((doc) => {
                        const laborContractData = doc.data()
                        const laborContract = {
                            id:laborContractData.id,
                            atWill: laborContractData.atWill,
                            dateSent:laborContractData.dateSent,
                            endDate:laborContractData.endDate,
                            lastDateToAccept: laborContractData.lastDateToAccept,
                            notes: laborContractData.notes,
                            receiverAcceptance:laborContractData.receiverAcceptance,
                            receiverId:laborContractData.receiverId,
                            receiverName:laborContractData.receiverName,
                            senderAcceptance:laborContractData.senderAcceptance,
                            senderId:laborContractData.senderId,
                            senderName:laborContractData.senderName,
                            startDate:laborContractData.startDate,
                            status:laborContractData.status,
                            terms:laborContractData.terms

                        }
                        setLaborContractlist(laborContractlist => [...laborContractlist, laborContract]); 
                    });
                } catch(error){
                    console.log('Error')
                }
            
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <Link 
            className='py-1 px-2 bg-[#1D2E76] rounded-md'
            to={`/company/laborContracts/createNew`}>Create New</Link>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        <h2>Please Forgive the Work In Progress</h2>
                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>atWill</th>
                                    <th className='py-3 px-4'>receiverName</th>
                                    <th className='py-3 px-4'>receiverAcceptance</th>
                                    <th className='py-3 px-4'>status</th>
                                    <th className='py-3 px-4'>notes</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                laborContractlist?.map(laborContract => (
                                        <tr key={laborContract.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{laborContract.atWill}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{laborContract.receiverName}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{laborContract.receiverAcceptance}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{laborContract.status}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{laborContract.notes}</td>

                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/laborContracts/${laborContract.id}`}>Details</Link></td>

                                        </tr>
                                    
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
    export default LaborContracts;
