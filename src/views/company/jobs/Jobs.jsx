import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library

const Jobs = () => {
    const [laborContractlist, setLaborContractlist] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        (async () => {                
            try{
                console.log("Recently Selected Company: " + recentlySelectedCompany)
                let q = query(collection(db, 'companies',recentlySelectedCompany,'workOrders'));
                const querySnapshot = await getDocs(q);       
                setLaborContractlist([])
                querySnapshot.forEach((doc) => {
                    const jobData = doc.data()

                    const dateCreated = jobData.dateCreated.toDate();
                    const formattedDateCreated = format(dateCreated, 'MM / d / yyyy'); 
                    const laborContract = {
                        id:jobData.id,
                        internalId : jobData.internalId,
                        type: jobData.type,
                        adminId: jobData.adminId,
                        adminName: jobData.adminName,
                        billingStatus: jobData.billingStatus,
                        bodyOfWaterName: jobData.bodyOfWaterName,
                        chemicals: jobData.chemicals,
                        customerId: jobData.customerId,
                        customerName: jobData.customerName,
                        dateCreated: jobData.dateCreated,
                        formattedDateCreated: formattedDateCreated,
                        description: jobData.description,
                        equipmentId: jobData.equipmentId,
                        equipmentName: jobData.equipmentName,
                        jobTemplateId: jobData.jobTemplateId,
                        laborCost: jobData.laborCost,
                        operationStatus: jobData.operationStatus,
                        rate: jobData.rate,
                        serviceLocationId: jobData.serviceLocationId,
                        serviceStopIds: jobData.serviceStopIds,
                    }
                    setLaborContractlist(laborContractlist => [...laborContractlist, laborContract]); 
                });
            } catch(error){
                console.log('Job Board Error: ' + error)
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
            <div className='w-full rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex w-full justify-between items-center py-2'>
                        <input 
                            // onChange={(e) => {searchHandler(e)}}
                            value={searchTerm}
                            className="text-field w-full p-2 border rounded"
                            type="text" 
                            name='search' 
                            placeholder="Search..."
                        />
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className="min-w-full bg-white border border-gray-200">
                            <thead>
                                <tr>
                                    <th className='px-4 py-2 border-b'>Id</th>
                                    <th className='px-4 py-2 border-b'>Date Created</th>
                                    <th className='px-4 py-2 border-b'>Customer Name</th>
                                    <th className='px-4 py-2 border-b'>Type</th>
                                    <th className='px-4 py-2 border-b'>Billing Status</th>
                                    <th className='px-4 py-2 border-b'>Operation Status</th>
                                    <th className='px-4 py-2 border-b sm:hidden'>Labor Cost</th>
                                    <th className='px-4 py-2 border-b sm:hidden'>Rate</th>
                                    <th className='px-4 py-2 border-b'>Admin Name</th>
                                    <th className='px-4 py-2 border-b'>Description</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                laborContractlist?.map(laborContract => (
                                        <tr key={laborContract.id} className="border-b border-slate-700">
                                            <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.internalId}</Link></td>
                                            <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.formattedDateCreated}</Link></td>
                                            <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.customerName}</Link></td>
                                            <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.type}</Link></td>
                                            <td className='px-4 py-2 border-b'>
                                                <Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                                                {laborContract.billingStatus == "Draft" && <h1 className="rounded-md red-bg px-2 items-center white-fg">{laborContract.billingStatus}</h1>}
                                                {laborContract.billingStatus == "Estimate" && <h1 className="rounded-md yellow-bg px-2 items-center black-fg">{laborContract.billingStatus}</h1>}
                                                {laborContract.billingStatus == "Accepted" && <h1 className="rounded-md green-bg px-2 items-center white-fg">{laborContract.billingStatus}</h1>}
                                                {laborContract.billingStatus == "In Progress" && <h1 className="rounded-md yellow-bg px-2 items-center black-fg">{laborContract.billingStatus}</h1>}
                                                {laborContract.billingStatus == "Invoiced" && <h1 className="rounded-md blue-bg px-2 items-center white-fg">{laborContract.billingStatus}</h1>}
                                                {laborContract.billingStatus == "Paid" && <h1 className="rounded-md green-bg px-2 items-center white-fg">{laborContract.billingStatus}</h1>}
                                                </Link>
                                            </td>
                                            <td className='px-4 py-2 border-b'>
                                                <Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                                                {laborContract.operationStatus == "Estimate Pending" && <h1 className="rounded-md red-bg px-2 items-center white-fg">{laborContract.operationStatus}</h1>}
                                                {laborContract.operationStatus == "Unscheduled" && <h1 className="rounded-md red-bg px-2 items-center white-fg">{laborContract.operationStatus}</h1>}
                                                {laborContract.operationStatus == "Scheduled" && <h1 className="rounded-md green-bg px-2 items-center white-fg">{laborContract.operationStatus}</h1>}
                                                {laborContract.operationStatus == "In Progress" && <h1 className="rounded-md yellow-bg px-2 items-center black-fg">{laborContract.operationStatus}</h1>}
                                                {laborContract.operationStatus == "Finished" && <h1 className="rounded-md green-bg px-2 items-center white-fg">{laborContract.operationStatus}</h1>}
                                                </Link>
                                            </td>
                                            <td className='px-4 py-2 border-b sm:hidden'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.laborCost}</Link></td>
                                            <td className='px-4 py-2 border-b sm:hidden'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.rate}</Link></td>
                                            <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.adminName}</Link></td>
                                            <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.description}</Link></td>
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
export default Jobs;

