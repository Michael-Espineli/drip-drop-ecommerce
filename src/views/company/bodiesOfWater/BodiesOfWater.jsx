import React, { useState } from "react";
import {Link } from 'react-router-dom';

export default function BodiesOfWater() {
   const [equipmentList, setEquipmentList] = useState([]);
    
    return (
        <div className='px-2 md:px-7 py-5'>
            <h2 className="text-2xl font-bold mb-4">Bodies Of Water - IP</h2>

            <Link 
            className='py-1 px-2 yellow-bg rounded-md text-[#000000]'
            to={`/company/bodiesOfWater/createNew`}>Create New</Link>

            <div className='w-full rounded-md mt-3'>
                <div className='relative overflow-x-auto'>
                    <table className="min-w-full bg-white border border-gray-200">
                        <thead>
                            <tr>
                                <th className='px-4 py-2 border-b'>Customer Name</th>
                                <th className='px-4 py-2 border-b sm:hidden'>Street Address</th>
                                <th className='px-4 py-2 border-b sm:hidden'>BOW</th>
                                <th className='px-4 py-2 border-b sm:hidden'>Make</th>
                                <th className='px-4 py-2 border-b sm:hidden'>Model</th>
                                <th className='px-4 py-2 border-b'>Type</th>
                                <th className='px-4 py-2 border-b'>Needs Service</th>
                                <th className='px-4 py-2 border-b'>Frequency</th>
                                <th className='px-4 py-2 border-b'>Last Service</th>
                                <th className='px-4 py-2 border-b'>Next Service</th>
                                <th className='px-4 py-2 border-b'>Status</th>
                                <th className='px-4 py-2 border-b'>Notes</th>
                                <th className='px-4 py-2 border-b'>Tech</th>
                                <th className='px-4 py-2 border-b'>Day</th>
                                <th className='px-4 py-2 border-b'>Repair History</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            equipmentList?.map(laborContract => (
                                    <tr key={laborContract.id} className="border-b border-slate-700">
                                        <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.formattedDateCreated}</Link></td>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.customerName}</Link></td>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/jobs/detail/${laborContract.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>{laborContract.type}</Link></td>
     
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
    );
}