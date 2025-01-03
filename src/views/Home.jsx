import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';

export default function Home() {
    return (
        <div className='px-2 md:px-7 py-5'>
            <h2>Home Page</h2>
            <Link to='signIn' className={`px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:pl-4 transition-all w-full mb-1`}>
            <span>Sign In</span>
            </Link>
        </div>
    );
}