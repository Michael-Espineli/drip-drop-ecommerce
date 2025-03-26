import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';
import PublicHeader from "../../layout/PublicHeader";

export default function Products() {
   return (
        <div className=' w-full bg-cover h-full bg-[#0e245c]'>
            <PublicHeader/>
        </div>
    );
}