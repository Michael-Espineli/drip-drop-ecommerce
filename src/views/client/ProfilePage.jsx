import { Context } from "../../context/AuthContext";
import React, { useState, useContext, useEffect } from "react";
import { FaStar, FaStarHalfAlt, FaRegStar } from 'react-icons/fa';

const ProfilePage = () => {
    const {name} = useContext(Context);

    return (
        <div className='px-2 md:px-7 py-5'>

            <div className='w-full flex flex-wrap mt-4'>
                {/* Chart */}
                <div className='w-full lg:w-1/2 lg:pr-3'>

                    <div className='h-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                        <h1 className='font-bold'>Public Page</h1>
                        <h1>Name: {name}</h1>      
                        <div>Verification and Verification Pending</div> 
                        <div className="flex items-center">                 
                            <h1>
                                Rating:
                            </h1>     
                            <FaStar className="yellow-fg"/>
                            <FaStar className="yellow-fg"/>
                            <FaStar className="yellow-fg"/>
                            <FaStarHalfAlt className="yellow-fg"/>
                            <FaRegStar className="yellow-fg"/>
                        </div>     

                        <h1>Phone Number: </h1>   
                        <h1>Email: </h1>     
                        <h1>Bio: Something Something Bio</h1>          
                    </div>
                </div>
                <div className='w-full lg:w-1/2 lg:pr-3'>
                    <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                        <h1>Locations</h1>
                        <h1>2</h1>   
                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4 mt-4'>
                <h1 className="font-bold">Reviews</h1>
            </div>
            <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4 mt-4'>
                <h1 className="font-bold">File Complaint</h1>
            </div>
        </div>
    );
};

export default ProfilePage;