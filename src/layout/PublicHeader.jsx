import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';

const PublicHeader = ({showSidebar, setShowSidebar}) => {

   return (
        <div className=' w-full bg-cover h-full bg-[#0e245c]'>
            <div className='flex px-[300px] pt-[100px] pb-12 text-[#cfcfcf] bg-[#0e245c] w-full justify-start shadow-md shadow-[#cfcfcf] fixed top-0 left-0'>
                <Link to='/'>
                    <h2 className='w-[300px] px-[20px] font-bold text-4xl line-clamp-1'>
                        Drip Drop
                    </h2>
                </Link>
                
                <div className='flex w-full justify-end'>
                    <Link to='/products' className={`px-[12px] py-[9px] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all mb-1 line-clamp-1 text-lg`}>
                        Products
                    </Link>
                    <Link to='/about' className={`px-[12px] py-[9px] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all mb-1 line-clamp-1 text-lg`}>
                        About
                    </Link>
                    <Link to='/info' className={`px-[12px] py-[9px] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all mb-1 line-clamp-1 text-lg`}>
                        Info
                    </Link>
                    <Link to='/contact' className={`px-[12px] py-[9px] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all mb-1 line-clamp-1 text-lg`}>
                        Contact
                    </Link>
                    <Link to='/homeowners' className={`px-[12px] py-[9px] rounded-sm w-[150px] flex justify-end gap-[1px] hover:pl-4 transition-all mb-1 line-clamp-1 text-lg`}>
                        Home Owners
                    </Link>
                    <Link to='/company' className={`px-[12px] py-[9px] rounded-sm w-[150px] flex justify-end gap-[1px] hover:pl-4 transition-all mb-1 line-clamp-1 text-lg`}>
                        Pool Company
                    </Link>
                </div>
            </div>
        </div>
    );
}
export default PublicHeader;