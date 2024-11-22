import React from 'react';
import { Link } from 'react-router-dom';

const Cancel = () => {
    return (
        <div>
            <Link to='/dashboard' className="w-[180px] h-[50px]">
            <h1 className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] p-2'>Back To home</h1>
            </Link>
        </div>
    );
};

export default Cancel;