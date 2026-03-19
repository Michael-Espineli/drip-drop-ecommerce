import React, { useState, useContext, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
const functions = getFunctions();

function Contracts () { 
    const {stripeConnectedAccountId, user} = useContext(Context);
    const [ contractList, setContractList] = useState([]);
    const [contracts, setContracts] = useState([]);
    const [contractsPending, setContractsPending] = useState([]);
    const [contractsAccepted, setContractsAccepted] = useState([]);
    const [contractsRejected, setContractsRejected] = useState([]);
    const [contractsPast, setContractsPast] = useState([]);

    const [firstDoc, setFirstDoc] = useState();
    const [lastDoc, setLastDoc] = useState();
    useEffect(() => {
        (async () => {
            console.log('On Load')
            //Fire base
            try{
                //Accepted
                let q = query(collection(db, 'contracts'),where('status','==','Pending'));
                const querySnapshot = await getDocs(q);       
                let count = 1   
                setContractsPending([])      
                querySnapshot.forEach((doc) => {
                    if (count == 1) {
                        setFirstDoc(doc)
                    } else {
                        setLastDoc(doc)
                    }
                    const contractData = doc.data()
                    const  contract = {
                        id:contractData.id,
                        companyName:contractData.companyName,
                        rate:contractData.rate,
                        status: contractData.status
                    }
                    count = count + 1
                    setContractsPending(contractsPending => [...contractsPending, contract]); 
                });
                //Pending
                let q2 = query(collection(db, 'contracts'),where('status','==','Accepted'));
                const querySnapshot2 = await getDocs(q2);       
                let count2 = 1   
                setContractsAccepted([])      
                querySnapshot2.forEach((doc2) => {
                    if (count2 == 1) {
                        setFirstDoc(doc2)
                    } else {
                        setLastDoc(doc2)
                    }
                    const contractData2 = doc2.data()
                    const  contract2 = {
                        id:contractData2.id,
                        companyName:contractData2.companyName,
                        rate:contractData2.rate,
                        status: contractData2.status
                    }
                    count2 = count2 + 1
                    setContractsAccepted(contractsAccepted => [...contractsAccepted, contract2]); 
                });
            } catch (error){

            }

            //From Stripe
            const getSubcriptionList = httpsCallable(functions, 'getSubcriptionList');
            getSubcriptionList({ 
                customerId: 'cus_RBsy3ZCArWYVkW',
                connectedAccount:'acct_1QIep2PPLD20PPKn',
                method: "POST",
            })
            .then((result) => result.data.subscriptions.data)            
            .then((subscriptions) => {
                console.log(subscriptions)
                // Handle the result from the function
                setContractList(subscriptions)
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
        })();
    },[])

    async function acceptContract(e) {
        e.preventDefault()
        console.log('acceptContract')

        const acceptContract = httpsCallable(functions, 'acceptContract');
        acceptContract({ 
            name: 'name',
            description: 'description',
            customerId: 'cus_RBsy3ZCArWYVkW',
            priceId: 'price_1QJN3JPPLD20PPKnO8w5XHVa',
            connectedAccount:'acct_1QIep2PPLD20PPKn',
            method: "POST",
        })
        .then((result) => result.data.subscription)            
        .then((session) => {
            console.log(session)
            console.log(session.id)
            // Handle the result from the function
        
        })
        .catch((error) => {
            // Handle any errors
            console.error(error);
        });
    }
    
    async function acceptContract2(e) {
        e.preventDefault()
        console.log('acceptContract2')

        const acceptContract2 = httpsCallable(functions, 'acceptContract2');
        acceptContract2({ 
            name: 'name',
            description: 'description',
            customerId: 'cus_RBsy3ZCArWYVkW',
            priceId: 'price_1QJN3JPPLD20PPKnO8w5XHVa',
            connectedAccount:'acct_1QIep2PPLD20PPKn', 
            method: "POST",
        })
        .then((result) => result.data.session)            
        .then((session) => {
                console.log(session)
                console.log(session.id)
                // Handle the result from the function
                const url = session.url
                if (url) {
                    window.location.href = url;
                }
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
    }
    async function setUpCustomer(e) {
        e.preventDefault()
        console.log('setUpCustomer')

        const setUpCustomer = httpsCallable(functions, 'setUpCustomer');
        setUpCustomer({ 
            name: 'name',
            description: 'description',
            connectedAccount:'acct_1QIep2PPLD20PPKn',
            method: "POST",
        })
        .then((result) => result.data.customer)            
        .then((customer) => {
                console.log(customer)
                console.log(customer.id)
                // Handle the result from the function
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
    }

    return (
        <div className='px-2 md:px-7 py-5'>

            <h2 className="text-2xl font-bold mb-4">Contracts</h2>
                    

                <div className='py-2'>
                    <div className='flex justify-between items-center'>
                        <Link 
                        to='/company/contracts/createNew/NA'
                        className='py-1 px-2 yellow-bg rounded-md text-[#000000]'
                        >Send New Contract</Link>
                        <Link className='red-fg rounded-md py-1 px-2'>See Past and Rejected Contracts</Link>
                    </div>
                </div>
                {/* <div className='flex justify-between'>
                    <button onClick={(e) => {acceptContract(e)}} 
                    className='bg-[#000000] p-2 rounded-md'
                    >Accept Contract</button>
                    <button onClick={(e) => {acceptContract2(e)}} 
                    className='bg-[#000000] p-2 rounded-md'
                    >Accept Contract 2</button>
                    <button onClick={(e) => {setUpCustomer(e)}} 
                    className='bg-[#000000] p-2 rounded-md'
                    >Set Up Customer</button>
                </div> */}
                <h1  className='text-xl font-bold mb-4'>Accepted Contracts</h1>
                <div className='relative overflow-x-auto'>

                    <table className="min-w-full bg-white border border-gray-200">
                        <thead>
                            <tr>
                                <th className='px-4 py-2 border-b'>Company Name</th>
                                <th className='px-4 py-2 border-b'>Amount</th>
                                <th className='px-4 py-2 border-b'>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            contractsAccepted?.map( contract => (
                                    <tr key={contract.id}>
                                        <td className='px-4 py-2 border-b'>{contract.companyName}</td>
                                        <td className='px-4 py-2 border-b'>{contract.rate/100}</td>
                                        <td className='px-4 py-2 border-b'>{contract.status}</td>
                                        <td>
                                            <Link 
                                            className='bg-[#454b39] rounded-md py-1 px-2'
                                            to={`/company/contracts/contract/${contract.id}`}>Detail</Link>
                                        </td>
                                    </tr>
                                
                            ))
                        }
                        </tbody>
                    </table>
                </div>
                <hr/>
                <h1  className='text-xl font-bold mb-4'>Pending Contracts</h1>
                <table className="min-w-full bg-white border border-gray-200">
                    <thead>
                        <tr>
                            <th className='px-4 py-2 border-b'>Company Name</th>
                            <th className='px-4 py-2 border-b'>Amount</th>
                            <th className='px-4 py-2 border-b'>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                    {
                        contractsPending?.map( contract => (
                                <tr key={contract.id}>
                                    <td className='px-4 py-2 border-b'>{contract.companyName}</td>
                                    <td className='px-4 py-2 border-b'>{contract.rate/100}</td>
                                    <td className='px-4 py-2 border-b'>{contract.status}</td>
                                    <td>
                                        <Link 
                                        className='bg-[#454b39] rounded-md py-1 px-2'
                                        to={`/company/contracts/contract/${contract.id}`}>Detail</Link>
                                    </td>
                                </tr>
                            
                        ))
                    }
                    </tbody>
                </table>
            <div className='py-2'>

                <div className='relative overflow-x-auto'>
                    <h1 className='text-xl font-bold mb-4'>Stripe Subscriptions</h1>
                    <table className="min-w-full bg-white border border-gray-200">
                        <thead>
                            <tr>
                                <th className='px-4 py-2 border-b'>id</th>
                                <th className='px-4 py-2 border-b'>Name</th>
                                <th className='px-4 py-2 border-b'>Interval</th>
                                <th className='px-4 py-2 border-b'>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            contractList?.map(subscription => (
                                <tr key={subscription.id}>
                                    <td className='px-4 py-2 border-b'>{subscription.id}</td>
                                    <td className='px-4 py-2 border-b'>{subscription.plan.nickName}</td>
                                    <td className='px-4 py-2 border-b'>{subscription.plan.interval}</td>
                                    <td className='px-4 py-2 border-b'>{subscription.plan.amount/100}</td>
                                    <td className='px-4 py-2 border-b'>Edit</td>
                                </tr>
                                
                            ))
                        }
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
};

export default Contracts;