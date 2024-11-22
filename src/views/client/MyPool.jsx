import React from 'react';
import { Link } from 'react-router-dom';
import Chart from 'react-apexcharts';

const MyPool = () => {
    const state = {
        series : [
            {
                name : "Orders",
                data : [23,34,45,56,78,34,54,18,84,52,54,51]
            },
            {
                name : "Revenue",
                data : [23,34,45,56,78,34,54,18,84,52,54,51]
            },
            {
                name : "Sellers",
                data : [23,34,45,56,78,34,54,18,84,52,54,51]
            }
        ], 
        options : {
            color : ['#181ee8','#181ee8'],
            plotOptions : {
                radius : 30
            },
            chart:{
                background : 'transparent',
                foreColor : '#d0d2d6'
            },
            dataLabels : {
                enabled : false
            },
            strock : {
                show : true, 
                curve : ['smooth','straight','stepline'],
                lineCap : 'butt',
                width : .5,
                dashAraray : 0
            },
            xaxis : {
                categories : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            },
            legend : {
                position : 'top'
            },
            responsive : [
                {
                    breakpoint: 565,
                    yaxis : {
                        categories : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                    },
                    options: {
                        plotOptions : {
                            bar : {
                                horizontal : true
                            }
                        },
                        chart : {
                            height : "550px"
                        }
                    }
                }
            ]
        }
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
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <div className='flex justify-between items-center'>

                        <h1 className='font-bold'>My Pool</h1>
                        {/* Drop Down */}

                        <select className='p-2 rounded-md bg-[#ededed] text-[#030811]'>
                            <option value="5">6160 Broadmoor Dr La Mesa Ca 91942</option>
                            <option value="10">6071 Henderson, La Mesa, CA 91942</option>
                            <option value="25">532 La Barca St Spring Valley 91977</option>
                            <option value="50">9279 Campo Rd. Spring Valley, CA 91977</option>
                        </select>
                    </div>

                    <p>Service Location</p>
                    <div>
                        <p>Under Contract : Murdock Pool Service <Link to='/contracts/contract/123456789' className='font-bold'>Details</Link></p>    
                        <p>Bodies Of Water : 5</p>    

                    </div>

                </div>
                {/* Second Section Of Body */}
                <div className='w-full flex flex-wrap py-2'>
                    {/*  */}
                    <div className='w-full lg:w-6/12 lg:pr-4'>
                        <div className='w-full bg-[#747e79] p-4 rounded-md h-full'>
                            <h1 className='font-bold'>Service History</h1>
                        </div>
                    </div>

                   
                    <div className='w-full lg:w-6/12 lg:pr-4'>

                        <div className='w-full bg-[#747e79] p-4 rounded-md h-full'>
                            <h1 className='font-bold'>Repair Requests</h1>
                        </div>
                    </div>
                </div>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <div className='flex justify-between items-center'>
                        <h1 className='font-bold'>Bodies Of Water</h1>
                        {/* Drop Down */}

                        <select className='p-2 rounded-md bg-[#ededed] text-[#030811]'>
                            <option value="5">Upper Pool</option>
                            <option value="5">Upper Spa</option>
                            <option value="10">Lower Pool</option>
                            <option value="25">Lower Spa</option>
                            <option value="25">Lower Wader</option>
                        </select>
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


                <div className='w-full flex flex-wrap py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                        <h1 className='font-bold'>Readings and Dosages</h1>
                                        {/* Chart */}
            
                        <Chart options={state.options} series={state.series} type='bar' height={350}/>
              
                    </div>
                </div>
                <div className='w-full flex flex-wrap py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                        <h1 className='font-bold'>Gallery</h1>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default MyPool;