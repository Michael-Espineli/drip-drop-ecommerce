import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';
import PublicHeader from "../../layout/PublicHeader";

export default function Company() {
   return (
        <div className=' w-full bg-cover h-full'>
            <PublicHeader/>
            <div className='px-7 py-5 pt-[150px]'>
                <div className='login-form flex'>
                    <Link to='/signIn' className={`px-[2] py-[2] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all  mb-1 line-clamp-1 text-lg font-serif`}>
                        Sign In
                    </Link>
                    
                    <Link to='/signUp' className={`px-[2] py-[2] rounded-sm w-[100px] flex justify-end gap-[1px] hover:pl-4 transition-all  mb-1 line-clamp-1 text-lg font-serif`}>
                        Sign Up
                    </Link>
                    <Link to='/reedemInviteCode' className={`px-[2] py-[2] rounded-sm w-[200px] flex justify-end gap-[1px] hover:pl-4 transition-all  mb-1 line-clamp-1 text-lg font-serif`}>
                        Reedem Invite Code
                    </Link>

                </div>
            </div>
        </div>
    );
}