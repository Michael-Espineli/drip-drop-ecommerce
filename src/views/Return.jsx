import React, { useEffect} from "react";
import { useParams} from 'react-router-dom';
import { Link, useNavigate } from 'react-router-dom';

export default function Return() {
  const {connectedAccountId} = useParams();


    const navigate = useNavigate()
  useEffect(() => {
    if ("maxTouchPoints" in navigator && navigator.maxTouchPoints > 0) {
      console.log("Touch-enabled device detected.");
      navigate("/dashboard")
    } else {
      console.log("No touch-enabled device detected.");
      window.location.href = 'com.dripdroppoolapp://';

    }
  },[])
  return (
    <div className='px-2 md:px-7 py-5'>
      <div className="content">
        <h2>Connected Account Submitted</h2>
        <p>That's everything we need for now</p>
        <Link to='/company/profile' className="w-[180px] h-[50px]">
          <h1 className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] p-2'>Back To home</h1>
        </Link>
        <Link to={{ pathname: "com.dripdroppoolapp://" }}className="w-[180px] h-[50px]">
          <h1 className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] p-2'>Back To App</h1>
        </Link>
      </div>
    </div>
  );
}