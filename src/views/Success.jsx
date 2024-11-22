import React from 'react';
import { Link, useParams } from 'react-router-dom';

const Success = () => {
    const {sessionId} = useParams();

    return (
        <div>
        <Link to='/dashboard' className="w-[180px] h-[50px]">
          <h1 className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] p-2'>Back To home</h1>
        </Link>
        <h1>{sessionId}</h1>
        </div>
    );
};

export default Success;