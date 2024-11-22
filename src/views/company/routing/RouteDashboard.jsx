import React, {useState, useEffect, useContext} from 'react';
import { Link } from 'react-router-dom';

const RouteDashboard = () => {
    const serviceStops = [
        {
            id:1,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'In Progress'
        }
        ,
        {
            id:2,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'Incomplete'

        }
        ,
        {
            id:3,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'Finished'

        }
        ,
        {
            id:4,
            jobType:'Weekly Cleaning',
            customerName:'Delyse Espineli',
            streetAddress:'6160 Broadmoor Drive',
            status:'Incomplete'

        },

    ]
    const users = [
        {
            id:1,
            userName:'Caleb Short',
            totalStops:'7',
            finishedStops:'5',
            milage:'4',
            duration:'5:32',
            status:'On Break'
        }
        ,
        {
            id:2,
            userName:'Kaden Browsnberg',
            totalStops:'12',
            finishedStops:'8',
            milage:'4',
            duration:'5:32',
            status:'On Break'

        }
        ,
        {
            id:3,
            userName:'Gabe Keller',
            totalStops:'13',
            finishedStops:'5',
            milage:'4',
            duration:'5:32',
            status:'On Break'

        }
        ,
        {
            id:4,
            userName:'Keller Smith',
            totalStops:'2',
            finishedStops:'11',
            milage:'4',
            duration:'5:32',
            status:'On Break'

        },

    ]
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                    <h1 className='text-[#000000] font-bold'>Route Dashboard</h1>
                </div>
            </div>
            <div className='py-2'>
                <div className='w-full flex flex-wrap'>

                    {/* Chart */}
                    <div className='w-full lg:w-8/12 lg:pr-3'>
                        <div className='w-full bg-[#747e79] p-4 rounded-md h-full'>
                            <h1 className='text-[#000000] font-bold'>Map</h1>
                            <div className='w-full h-3/4 rounded-md bg-[#ffffff] flex justify-center items-center'>
                            <h1 className='text-[#000000] font-bold '>Map</h1>
                            </div>
                        </div>
                    </div>


                    {/* Recent Seller Message */}
                    <div className='w-full lg:w-4/12 lg:pl-4 mt-6 lg:mt-0'>
                        <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6] h-full'>
                            <h1 className='text-[#000000] font-bold'>Users</h1>
                            {
                                users?.map(user => (
                                    <div key={user.id}>
                                        <p>{user.userName} - {user.status}</p>
                                        <p>{user.finishedStops} / {user.totalStops}</p>
                                        <p>{user.milage}</p>
                                        <p>{user.duration}</p>
                                        <hr/>
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                </div>
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                    <h1 className='text-[#000000] font-bold'>Table</h1>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Customer NAMe</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Job Type</th>
                                    <th className='py-3 px-4'>Satus</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                serviceStops?.map(serviceStop => (
                                        <tr key={serviceStop.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link>{serviceStop.customerName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.streetAddress}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.jobType}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.status}</td>
                                        </tr>
                                    
                                ))
                            }
                            </tbody>
                        </table>
                </div>
            </div>
        </div>
    );
};

export default RouteDashboard;