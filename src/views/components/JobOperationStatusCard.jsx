import React, {useState, useEffect} from 'react';
// import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
// import { db } from "../../utils/config";

const JobOperationStatusCard = (props) => {
    const status = props.status
    return (
        <div className='py-3 px-4 font-medium whitespace-nonwrap white-fg'>
   
            {status === "Estimate Pending" && <h1 className="rounded-md red-bg px-2 items-center">{status}</h1>}
            {status === "Unscheduled" && <h1 className="rounded-md red-bg px-2 items-center">{status}</h1>}
            {status === "Scheduled" && <h1 className="rounded-md green-bg px-2 items-center">{status}</h1>}
            {status === "In Progress" && <h1 className="rounded-md yellow-bg px-2 items-center black-fg">{status}</h1>}
            {status === "Finished" && <h1 className="rounded-md green-bg px-2 items-center">{status}</h1>}
                                                
        </div>
    );
};

export default JobOperationStatusCard;