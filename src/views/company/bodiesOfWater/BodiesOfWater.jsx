import React, { useState } from "react";
import {Link } from 'react-router-dom';

export default function BodiesOfWater() {
    return (
        <div className='px-2 md:px-7 py-5'>
            <Link 
            className='py-1 px-2 bg-[#1D2E76] rounded-md'
            to={`/company/bodiesOfWater/createNew`}>Create New</Link>
            <h2>BodiesOfWater Page</h2>
        </div>
    );
}