import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";

const Jobs = () => {
    const [laborContractlist, setLaborContractlist] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
            try{
                let q = query(collection(db, 'companies',recentlySelectedCompany,'workOrders'));
                const querySnapshot = await getDocs(q);       
                setLaborContractlist([])
                querySnapshot.forEach((doc) => {
                    const laborContractData = doc.data()
                    const laborContract = {
                        id:laborContractData.id,
                        internalId : laborContractData.internalId,
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

                    }
                    setLaborContractlist(laborContractlist => [...laborContractlist, laborContract]); 
                });
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
            <div className='py-2'>
                <Link 
                className='py-1 px-2 bg-[#CDC07B] rounded-md text-[#000000]'
                to={`/company/jobs/createNew`}>
                    Create New
                </Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                <th className='py-3 px-4'>Id</th>

                                    <th className='py-3 px-4'>Customer Name</th>
                                    <th className='py-3 px-4'>Admin Name</th>
                                    <th className='py-3 px-4'>Billing Status</th>
                                    <th className='py-3 px-4'>Operation Status</th>
                                    <th className='py-3 px-4 sm:hidden'>Labor Cost</th>
                                    <th className='py-3 px-4 sm:hidden'>Rate</th>
                                    <th className='py-3 px-4'></th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                laborContractlist?.map(laborContract => (
                                        <tr key={laborContract.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.internalId}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.customerName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.adminName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.billingStatus}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.operationStatus}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap sm:hidden'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.laborCost}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap sm:hidden'><Link to={`/company/jobs/detail/${laborContract.id}`}>{laborContract.rate}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/detail/${laborContract.id}`}>Details</Link></td>
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
export default Jobs;

