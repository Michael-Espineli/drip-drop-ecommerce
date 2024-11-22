import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const CreateNewLaborContract = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {
            try{
              
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <Link 
            
            className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
            to={`/company/laborContracts`}>Back</Link>

            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <h2>Create New Labor Contract</h2>
                    <form>
                        <input
                        placeholder='Place Holder'
                        ></input>
                        <button>Submit</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
    export default CreateNewLaborContract;