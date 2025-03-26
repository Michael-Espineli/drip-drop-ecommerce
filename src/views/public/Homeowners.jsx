import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';
import PublicHeader from "../../layout/PublicHeader";

export default function Homeowners() {
   return (
        <div className=' w-full bg-cover h-full bg-[#0e245c]'>
            <PublicHeader/>
            <div className='flex px-7 py-5 text-[#cfcfcf] px-[200px] pt-[225px]'>

                <Link to='/homeOwnerSignIn' className={`px-[12px] py-[9px] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all  mb-1 line-clamp-1 text-lg font-serif`}>
                    Sign In
                </Link>
                
                <Link to='/homeOwnerSignUp' className={`px-[12px] py-[9px] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all  mb-1 line-clamp-1 text-lg font-serif`}>
                    Sign Up
                </Link>
            </div>
        </div>
    );
}