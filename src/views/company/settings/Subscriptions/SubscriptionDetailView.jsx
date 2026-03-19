import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../../utils/config";
import { Context } from "../../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

const SubscriptionDetailView = () => {
    const {subscriptionId} = useParams();

    const {name,recentlySelectedCompany} = useContext(Context);

    const [edit,setEdit] = useState(false);

    const navigate = useNavigate()

    const [job,setJob] = useState(null);
    // {
    //     id: "",
    //     description : "",
    //     dripDropSubscriptionId: "",
    //     lastPaid: "",
    //     formattedLastPaid: "",
    //     name: "",
    //     price: "",
    //     started: "",
    //     formattedStarted: "",
    //     stripePriceId: "",
    //     stripeProductId: "",
    //     stripeSubscriptionId: "",
    // }

    const [daysUntilDue,setDaysUntilDue] = useState("");

    useEffect(() => {
        (async () => {
            try{
                //Get Job Information
                const docRef = doc(db, "companies",recentlySelectedCompany,'subscriptions',subscriptionId);
                const docSnap = await getDoc(docRef);
                let customerId;
                let serviceLocationId;
                
                let totalRate = 0
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    const subscriptionData = docSnap.data()

                    const lastPaid = subscriptionData.lastPaid.toDate();
                    const formattedLastPaid = format(lastPaid, 'MM / d / yyyy'); 

                    const started = subscriptionData.started.toDate();
                    const formattedStarted = format(started, 'MM / d / yyyy'); 
                    setJob((prevJob) => ({
                        ...prevJob,
                        id:subscriptionData.id,
                        description : subscriptionData.description,
                        dripDropSubscriptionId: subscriptionData.dripDropSubscriptionId,
                        lastPaid: subscriptionData.lastPaid,
                        formattedLastPaid: formattedLastPaid,
                        name: subscriptionData.name,
                        price: subscriptionData.price,
                        started: subscriptionData.started,
                        formattedStarted: formattedStarted,
                        stripePriceId: subscriptionData.stripePriceId,
                        stripeProductId: subscriptionData.stripeProductId,
                        stripeSubscriptionId: subscriptionData.stripeSubscriptionId,
                    }));
                    //Get Subscription Information From Stripe
                    console.log('getStripeSubscriptionInformation')
            
                    const functionName = httpsCallable(functions, 'getStripeSubscriptionInformation');
                    functionName({ 
                        subscriptionId: subscriptionData.stripeSubscriptionId
                    })
                    .then((result) => {
                        console.log(result)
                        // Handle the result from the function
                    
                    })
                    .catch((error) => {
                        // Handle any errors
                        console.error(error);
                    });
                } else {
                  console.log("No such subscription document!");
                }
            } catch(error){
                console.log('Error - [SubscriptionDetailView] ', error)
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
        // 919191 - gray
        <>
        {
            (job == null) &&<div className=' w-full bg-cover h-full black-fg'>
                <div className="max-w-5xl mx-auto p-6 text-gray-800 ">
                    <h1 className="text-4xl font-bold mb-6 text-center">No Subscription Found</h1>
                    <p className="text-center text-gray-600 mb-12">
                        There was no subscription Found
                    </p>
                </div>
            </div>
        }
        {
            (job !== null)&&
            <div className='px-2 md:px-7 py-5'>
                <div className='w-full flex justify-between py-1'>
                    <Link 
                    className=' font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#1D2E76] cursor-pointer rounded mt-3'
                    to={`/company/settings/subscriptions`}>
                        Back
                    </Link>
                </div>
    
                {/* First Section Of Body */}
                <div className='w-full flex flex-wrap mt-2 pt-4 border border-gray-200 border-b'>
                    <div className='w-full'>
                        <p className='font-bold'>Membership Details</p>
                        <hr/>
                        <p>Name: {job.name}</p>
                        <p>Description: {job.description}</p>
                        <p>Price: {job.price/100}</p>
                        <p>Member Since: {job.formattedStarted}</p>
                    </div>
                </div>
                
                {/* Second Section Of Body */}
                <div className='w-full flex flex-wrap mt-2 pt-4 border border-gray-200 border-b'>
                    <div className='w-full'>
                        <p className='font-bold'>Billing Cycle</p>
                        <hr/>
                        <p>Days Until Due: {daysUntilDue}</p>
                        <p>Next Payment: </p>
                        <p>Price: {job.price}</p>
                        <p>Card On File: {job.name}</p>
                    </div>
                </div>

                {/* Third Section Of Body */}
                <div className='w-full flex flex-wrap mt-2 pt-4'>
                    <div className='w-full'>
                        <p className='font-bold'>Quick Links</p>
                        <hr/>
                        <div className='px-4 py-2 border-b'>
                            <Link to={`/Company/ManageSubscriptions/Update/${subscriptionId}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                                Change Plan
                            </Link>
                        </div>
                    </div>
                </div>

                <Link 
                className=' font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 red-bg cursor-pointer rounded mt-3'
                to={`/Company/ManageSubscriptions/Cancel/${job.id}`}>
                    Cancel Membership
                </Link>
            </div>
        }
        </>
    );
}
    export default SubscriptionDetailView;