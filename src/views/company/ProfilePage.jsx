
import React, { useState, useContext, useEffect } from "react";
import { signOut, getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../context/AuthContext";
import { getFirestore,  doc, updateDoc  } from "firebase/firestore";
import { db } from '../../utils/config';

const functions = getFunctions();


export default function ProfilePage() {
    const {stripeConnectedAccountId, setStripeConnectedAccountId, name, photoUrl, user} = useContext(Context);
    const [accountCreatePending, setAccountCreatePending] = useState(false);
    const [accountLinkCreatePending, setAccountLinkCreatePending] = useState(false);
    const [error, setError] = useState(false);
    const [connectedAccountId, setConnectedAccountId] = useState();
    const [edit,setEdit] = useState(false);
    const auth= getAuth()
    //Test
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (stripeConnectedAccountId == '') {

        }
    },[])

    const callHelloWorld = async () => {
        console.log('callHelloWorld')

        const helloWorldFunction = httpsCallable(functions, 'helloWorldTest');
        helloWorldFunction({ 
            name: 'John',
            method: "POST",

        })
            .then((result) => {
                // Handle the result from the function
                setMessage(result.data.message);

            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
        // try {
        //   const helloWorldFunction = httpsCallable(functions, 'helloWorldTest');
        //   const result = await helloWorldFunction({ name: 'John' });
        //   setMessage(result.data.message);
        // } catch (error) {
        //   console.error('Error calling function:', error);
        // }
      };
    async function createAnAccount(){
        const createNewStripeAccount = httpsCallable(functions, 'createNewStripeAccount');
        
        setAccountCreatePending(true);
        setError(false);
        console.log('Create Account')

        //On Call Function
        createNewStripeAccount({
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            },
        })
        .then((response) => response.data)
        .then( async (data) => {
            setAccountCreatePending(false);
            const { account } = data;
            console.log('1')

            if (account) {
                setConnectedAccountId(account)
                setAccountLinkCreatePending(true);
                console.log('2')
                console.log(account)
                console.log('3')
                 console.log(user)
                // Update Firebase 
                const userDocRef = doc(db,'users', user.uid);
                console.log('4')

                await updateDoc(userDocRef, {
                    stripeConnectedAccountId: account
                });
                console.log('5')

            }
        })
        .catch((error) => {
            console.log('Create Account Error')
            console.error(error);
        });

        // Express API Function
        // fetch("http://127.0.0.1:5001/the-pool-app-3e652/us-central1/widgets/account", {
        //     method: "POST",
        // })
        // .then((response) => response.json())
        // .then((json) => {
        // setAccountCreatePending(false);

        // const { account, error } = json;

        // if (account) {
        //     setStripeConnectedAccountId(account);
        //     // Update Firebase 
        // }

        // if (error) {
        //     setError(true);
        // }
        // });
    }

    const editUser = (event) => {
        setEdit(true);
    } 

    async function setUpAccountDetails(){
        const createStripeAccountLink = httpsCallable(functions, 'createStripeAccountLink');

        setAccountLinkCreatePending(true);
        setError(false);
        console.log('Create Account Link')

        //On Call Function
        createStripeAccountLink({
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            },
            account: stripeConnectedAccountId,
        })
        .then((response) => response.data)
        .then((json) => {
            setAccountLinkCreatePending(false);
        
            const { error, accountLink } = json;
            console.log(accountLink)
            const url = accountLink.url
            if (url) {
                window.location.href = url;
            }

            if (error) {
                setError(true);
            }
        })
        .catch((error) => {
            console.log('Create Account Link Error')

            console.error(error);
        });

        //Express API Function
        // fetch("http://127.0.0.1:5001/the-pool-app-3e652/us-central1/widgets/account_link", {
        //     method: "POST",
        //     headers: {
        //     "Content-Type": "application/json",
        //     },
        //     body: JSON.stringify({
        //     account: stripeConnectedAccountId,
        //     }),
        // })
        // .then((response) => response.json())
        // .then((json) => {
        // setAccountLinkCreatePending(false);

        // const { url, error } = json;
        // if (url) {
        //     window.location.href = url;
        // }

        // if (error) {
        //     setError(true);
        // }
        // });
    }

    return (
        <div className='px-2 md:px-7 py-5'>
            <div className="w-full flex justify-center">
                <img className='s:w-[50px] s:h-[50px] lg:w-[300px] lg:h-[300px] rounded-full' src={photoUrl} alt="profile" />
            </div>
                <div className='w-fullflex flex-wrap w-full lg:pr-3'>
                    <div className="w-full py-2">
                        <div className='w-full bg-[#747e79] rounded-md text-[#d0d2d6] p-4'>
                            <div className="w-full flex justify-between">
                                <button onClick={callHelloWorld}>Call Function</button>
                                <h2>{message}</h2>

                                <h2 className="text-[#000000] font-bold">Account Info</h2>
                                <button  onClick={()=>{editUser()}} className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Edit</h1></button>
                            </div>
                            <div className="text-[#000000] font-bold">
                                {
                                    edit ? <div>

                                    </div>:<div>
                                        <div className="w-full flex justify-start items-center gap-4">
                                            <p className="font-bold">Name : </p>
                                            <p className=""> {name}</p>
                                        </div>
                                        <div className="w-full flex justify-start items-center gap-4">
                                            <p className="font-bold">Email : </p>
                                            <p className=""> michael@espinelicapital.com</p>
                                        </div>
                                        <div className="w-full flex justify-start items-center gap-4">
                                            <p className="font-bold">Phone : </p>
                                            <p className="">(123) 456-7890</p>
                                        </div>
                                    </div>
                                }
                            </div>
                        </div>
                    </div>
                    <div className='w-full py-2 '>
                        <div className="bg-[#747e79] rounded-md text-[#d0d2d6] p-4">
                            <h2 className="text-[#000000] font-bold">External Account Info</h2>
                                <div className="py-2">
                                    <div className=" w-full flex justify-start items-center">
                                        <p className="font-bold">Stripe Account : </p>
                                        {!accountCreatePending && !stripeConnectedAccountId && (
                                            <div className="py-2">
                                                <button className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] px-2'
                                                    onClick={async () => {createAnAccount()}}>
                                                    Create Stripe account
                                                </button>
                                            </div>
                                        )}
                                        {(stripeConnectedAccountId || accountCreatePending || accountLinkCreatePending) && (
                                            <div className="py-2">
                                                {stripeConnectedAccountId && <p className='bg-[#82D173] text-[#000000] font-normal ml-2 rounded text-[#ffffff] px-2'>Account Connected</p>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="py-2">
                                    <div className=" w-full flex justify-start items-center">
                                        <p className="font-bold">Account Status : </p>
                                        {stripeConnectedAccountId && (
                                        <div className="py-2">
                                            <button className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] px-2'
                                                onClick={async () => {setUpAccountDetails()}}>
                                                Set Up Account
                                            </button>
                                        </div>
                                        )}
                                    </div>
                                </div>

                                <p>I need to display Account Status</p>
                                <p>Restricted</p>
                                <p>Restricted soon</p>
                                <p>Pending</p>
                                <p>Enabled</p>
                                <p>Complete</p>
                                <p>Rejected</p>

                                <div className="py-2">
                                    <div className=" w-full flex justify-start items-center">
                                        <p className="font-bold">Quickbooks : </p>
                                        <div className="py-2">
                                            <button className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded text-[#ffffff] px-2'>
                                                Set Up Account
                                            </button>
                                        </div>
                                    </div>
                                </div>
                        </div>
                    </div>
                </div>
        </div>
    );
}