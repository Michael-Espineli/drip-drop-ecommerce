import React from "react";
import { useParams} from 'react-router-dom';
import { Link } from 'react-router-dom';

export default function Return() {
  const {connectedAccountId} = useParams();

  return (
    <div className='px-2 md:px-7 py-5'>
      <div className="content">
        <h2>Details submitted</h2>
        <p>That's everything we need for now</p>
        <Link to='/company/profile' className="w-[180px] h-[50px]">
          <h1 className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] p-2'>Back To home</h1>
        </Link>
        <div>
            <p className='font-bold'>Return URl</p>
            <p>No state is passed through this URL. After a user is redirected to your return_url, check the state of the details_submitted parameter on their account by doing either of the following:
Listening to account.updated webhooks
Calling the Accounts API and inspecting the returned object</p>
            <div className='px-5'>
                <code>https://docs.stripe.com/connect/enable-payment-acceptance-guide</code>
            </div>
        </div>
      </div>
    </div>
  );
}