import React from 'react';
import { Link, useParams } from 'react-router-dom';

const SuccessfulSubscription = () => {
    const {subscriptionId} = useParams();

    return (
      <div className=' w-full bg-cover h-full black-fg'>
          <div className="max-w-5xl mx-auto p-6 text-gray-800 ">
              <h1 className="text-4xl font-bold mb-6 text-center">Successfull</h1>

            <Link to='/dashboard' className="w-[180px] h-[50px]">
              <h1 className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] p-2'>Back To home</h1>
            </Link>
            <h1>{subscriptionId}</h1>
          </div>
        </div>
    );
};

export default SuccessfulSubscription;