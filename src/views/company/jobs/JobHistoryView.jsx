import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const JobHistoryView = () => {
    const {jobId} = useParams();

    useEffect(() => {
        (async () => {
            try{
    
            } catch(error){
                console.log('Error Location useEffect Job Detail View')
            }
        })();
    },[])
    return (
        // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white
        // 1D2E76 - Pool Blue
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green
        // 919191 = gray
        <div className='px-2 md:px-7 py-5'>
            <div>
                <Link 
                className=' font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#1D2E76] cursor-pointer rounded mt-3'
                to={`/company/jobs/detail/${jobId}`}>Back</Link>
                <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <p className="font-bold py-2">Job History</p>
                    <div className='left-0 w-full justify-between'>
                        <div className="py-2">
                            <div className="flex justify-between">
                                <p className="font-bold">3/8/2025 13:51 PST : John Draney : (Updated)</p>
                                <p>Current</p>
                            </div>
                            <p>Admin: Brett Murdock -> Admin: Sydney Espineli </p>
                            <hr/>                    
                        </div>
                        <div className="py-2">
                            <div className="flex justify-between">
                                <p className="font-bold">3/5/2025 11:17 PST : Sydney Espineli : (Updated)</p>
                                <p>Revert Changes</p>
                            </div>
                            <p>Admin: Michael Espineli -> Admin: Brett Murdock </p>
                            <hr/>                    
                        </div>
                        <div className="py-2">
                            <div className="flex justify-between">
                                <p className="font-bold">3/1/2025  12:05 PST : Michael Espineli : (Initially Created)</p>
                                <p>Revert Changes</p>
                            </div>

                            <p>-> Admin: Michael Espineli </p>
                            <p>-> Customer: Ron Palace </p>
                            <p>-> Tasks: Clean Filter </p>
                            <p>-> Add De </p>
                            <p>-> Brush Pool</p>

                            <hr/>                    
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
export default JobHistoryView;