import React from 'react';
import { FaCheckCircle } from "react-icons/fa";
import { IoStarSharp } from "react-icons/io5";
import { IoStarOutline } from "react-icons/io5";
import { IoStarHalfSharp } from "react-icons/io5";

const ReviewCard = (props) => {

    return (
        <div className='py-1'>
            <div className='py-1 px-2 bg-[#454b39] rounded-lg shadow-sm'>
                <div className='flex justify-center items-center'>
                    <img className='w-[40px] h-[40px] rounded-full bg-white' src='https://firebasestorage.googleapis.com/v0/b/the-pool-app-3e652.appspot.com/o/duck128.jpg?alt=media&token=549d29cd-0565-4fa4-a682-3e0816cd2fdb' alt="profile" />
                    <div className='w-full px-2'>
                        <div className='flex justify-between items-center mb-2 '>
                            <h1 className='text-[#ffffff]'>{props.reviewer}</h1>
                            <div className='flex justify-between items-center'>
                        
                            <time className='mb-1 text-sm font-normal sm:order-last sm:mb-0 text-[#ffffff]'>{props.time}</time>
                            </div>
                        </div>
                        <div className='p-2 text-xs font-normal bg-[#ededed] rounded-lg border border-slate-800'>
                            {props.description}
                        </div >
                        <div className=' flex justify-between p-0 text-xs font-normal items-center text-[#ffffff]'>
                            <div className=' flex justify-between p-0 text-base font-normal items-center text-[#dbbd23]'>
                            {(() => {
                                    switch (props.rating) {
                                    case '0.5':
                                        return <><IoStarHalfSharp /><IoStarOutline /><IoStarOutline /><IoStarOutline /><IoStarOutline /></>
                                    case '1':
                                        return <><IoStarSharp /><IoStarOutline /><IoStarOutline /><IoStarOutline /><IoStarOutline /></>
                                    case '1.5':
                                        return <><IoStarSharp /><IoStarHalfSharp /><IoStarOutline /><IoStarOutline /><IoStarOutline /></>
                                    case '2':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarOutline /><IoStarOutline /><IoStarOutline /></>
                                    case '2.5':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarHalfSharp /><IoStarOutline /><IoStarOutline /></>
                                    case '3':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarOutline /><IoStarOutline /></>
                                    case '3.5':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarHalfSharp /><IoStarOutline /></>
                                    case '4':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarOutline /></>
                                    case '4.5':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarHalfSharp /></>
                                    case '5':
                                        return <><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarSharp /><IoStarSharp /></>
                                    default:
                                        return <><IoStarHalfSharp /><IoStarOutline /><IoStarOutline /><IoStarOutline /><IoStarOutline /></>
                                }
                            })()}
                            </div>
                            { props.verified ? <div className=' flex justify-end p-0 text-xs font-normal rounded-lg items-center text-[#ffffff] gap-3'>
                                <FaCheckCircle className='text-[#5190f5]'/>
                                <h1>Verified Customer </h1>
                            </div>:<div>
                            </div>}
                            
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReviewCard;