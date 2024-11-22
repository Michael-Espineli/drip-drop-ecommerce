import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const CreateNewJob = () => {
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
                    <form>

            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <h2>Create New Job</h2>
                        <input
                        placeholder='Place Holder'
                        ></input>



                        <p>adminId</p>
                        <p>adminName</p>
                        <p>billingStatus</p>
                        <p>bodyOfWaterId</p>
                        <p>bodyOfWaterName</p>
                        <p>chemicals</p>
                        <p>customerId</p>
                        <p>dateCreated</p>
                        <p>description</p>
                        <p>electrical Parts</p>
                        <p>equipmentId</p>
                        <p>equipmentName</p>
                        <p>id</p>
                        <p>installationParts</p>
                        <p>jobTemplateId</p>
                        <p>laborCost</p>
                        <p>miscParts</p>
                        <p>operationalStatus</p>
                        <p>pvcparts</p>
                        <p>rate</p>
                        <p>serviceLocationId</p>
                        <p>serviceStopIds</p>
                        <p>type</p>
                        <button>Submit</button>

                </div>
            </div>
            </form>
        </div>
    );
}
    export default CreateNewJob;