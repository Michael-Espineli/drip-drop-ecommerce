import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';

export default function PurchasesList() {
    return (
        <div className='px-2 md:px-7 py-5'>
            <h2>Purchases List</h2>
        </div>
    );
};