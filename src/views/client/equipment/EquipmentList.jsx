import React from 'react';
import { Link } from 'react-router-dom';

const EquipmentList = () => {
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <h1>EquipmentList</h1>
                </div>
            </div>
            <div className='w-full flex flex-wrap py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md h-full'>
                    <h1 className='font-bold'>Equipment</h1>

                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Type</th>
                                    <th className='py-3 px-4'>Status</th>
                                    <th className='py-3 px-4'>Lift Span</th>
                                    <th className='py-3 px-4'>Cost</th>
                                    <th className='py-3 px-4'>Warrenty</th>
                                </tr>
                            </thead>
                            <tbody> 
                                <tr>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Main Pump</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Pump</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Operational</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>5-10 Years</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>$2,800</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>No</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to='/equipment/equipmentId' >Details</Link></td>

                                </tr>
                                <tr>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Main Filter</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Pump</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Needs Repair</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>10-20 Years</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>$1,800</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>No</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to='/equipment/equipmentId' >Details</Link></td>

                                </tr>
                                <tr>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Main Heater</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Heater</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>Out of Service</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>5-10 Years</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>$3,800</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>No</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to='/equipment/equipmentId' >Details</Link></td>

                                </tr>
                            </tbody>
                        </table>
                    </div>                
                </div>   
        </div>
    );
};

export default EquipmentList;