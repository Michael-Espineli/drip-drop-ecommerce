import React, {useState, useEffect, useContext} from 'react';
import { useParams } from 'react-router-dom';
import { query, collection, getDocs, doc, updateDoc, getDoc, startAfter, where, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { format } from 'date-fns'; // Or any other date formatting library

const ContractDetailView = () => {
    const {contractId} = useParams();
    const [contract,setContract] = useState({
        chemType : '',
        companyId : '',
        companyName : '',
        customerId : '',
        customerName : '',
        dateSent : '',
        dateToAccept : '',
        id : '',
        laborRate : '',
        laborType : '',
        locations : '',
        notes : '',
        rate : '',
        rateType : '',
        startDate : '',
        status : '',
        serviceLocationIds: [],
        terms : '',
        rateInterval : '',
        rateIntervalAmount : '',
        stripeCustomerId : '',
        productId : '',
        connectedAccountId : '',
    });
    const [serviceLocationList,setServiceLocationList] = useState()

    const [formattedDateSent,setFormattedDateSent] = useState()
    const [formattedDateToAccept,setFormattedDateToAccept] = useState()
    const [formattedStartDate,setFormattedStartDate] = useState()

    useEffect(() => {
        (async () => {
             try{
                const contractRef = doc(db, "contracts",contractId);
                const contractDoc = await getDoc(contractRef);
                if (contractDoc.exists()) {
                    setContract((prevContract) => ({
                        ...prevContract,
                        chemType: contractDoc.data().chemType,
                        companyId: contractDoc.data().companyId,
                        companyName: contractDoc.data().companyName,
                        customerId: contractDoc.data().customerId,
                        customerName : contractDoc.data().customerName,
                        dateSent : contractDoc.data().dateSent ,
                        dateToAccept : contractDoc.data().dateToAccept ,
                        id : contractDoc.data().id,
                        laborRate : contractDoc.data().laborRate,
                        laborType : contractDoc.data().laborType,
                        locations : contractDoc.data().locations,
                        notes : contractDoc.data().notes,
                        rate : contractDoc.data().rate,
                        rateType : contractDoc.data().rateType,
                        serviceLocationIds : contractDoc.data().serviceLocationIds,
                        startDate : contractDoc.data().startDate,
                        status : contractDoc.data().status,
                        terms : contractDoc.data().terms,
                        rateInterval : contractDoc.data().rateInterval,
                        rateIntervalAmount : contractDoc.data().rateIntervalAmount,
                        stripeCustomerId : contractDoc.data().stripeCustomerId,
                        productId : contractDoc.data().productId,
                        connectedAccountId : contractDoc.data().connectedAccountId,
                    }));
                    
                    const dateSent = contractDoc.data().dateToAccept.toDate();
                    const formattedDateSent = format(dateSent, 'MMMM d, yyyy'); 
                    setFormattedDateSent(formattedDateSent)

                    const dateToAccept = contractDoc.data().dateToAccept.toDate();
                    const formattedDateToAccept = format(dateToAccept, 'MMMM d, yyyy'); 
                    setFormattedDateToAccept(formattedDateToAccept)

                    const startDate = contractDoc.data().dateToAccept.toDate();
                    const formattedStartDate = format(startDate, 'MMMM d, yyyy'); 
                    setFormattedStartDate(formattedStartDate)
                    setServiceLocationList([]);
                    contractDoc.data().serviceLocationIds.forEach( async (serviceLocationId) => {
                        const serviceLocationRef = doc(db, "companies",contractDoc.data().companyId,'serviceLocations',serviceLocationId);
                        const serviceLocationDoc = await getDoc(serviceLocationRef);
                        if (serviceLocationDoc.exists()) {
                            const data = serviceLocationDoc.data()
                            const serviceLocationData = {
                                id : data.id,
                                nickName : data.nickName,
                                streetAddress : data.address.streetAddress,
                                city : data.address.city,
                                state : data.address.state,
                                zip : data.address.zip
                            }
                            setServiceLocationList(serviceLocationList => [...serviceLocationList, serviceLocationData]); 
                        } else {
                            console.log("No such Service Locationdocument!");
                        }
                    })
                   
                
                  } else {
                    console.log("No such Contract document!");
                  }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    async function acceptContract(e) {
        e.preventDefault()
        const contractRef = doc(db, "contracts", contractId);
        // Set the "capital" field of the city 'DC'
        await updateDoc(contractRef, {
            status: 'Accepted'
        });
    };
    async function rejectContract(e) {
        e.preventDefault()
        const contractRef = doc(db, "contracts", contractId);
        // Set the "capital" field of the city 'DC'
        await updateDoc(contractRef, {
            status: 'Rejected'
        });
    };
    async function postComment(e) {
        e.preventDefault()
    };
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

        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <div className='flex justify-between items-center'>
                    <p><h1 className='font-bold'> {contract.companyName}</h1> is offering a contract With the Following Terms</p>
                    

                        {/* Status */}
                    <div>
                        {
                            (contract.status=='Pending')&&
                            <div className='p-2'>
                                <span className='bg-[#CDC07B] px-2 py-1 rounded-md text-[#ededed]'>
                                    {contract.status}
                                </span>
                            </div>
                        }
                                    {
                            (contract.status=='Accepted')&&
                            <div className='p-2'>
                                <span className='bg-[#2B600F] px-2 py-1 rounded-md text-[#ededed]'>
                                    {contract.status}
                                </span>
                            </div>
                        }
                                    {
                            (contract.status=='Rejected')&&
                            <div className='p-2'>
                                <span className='bg-[#9C0D38] px-2 py-1 rounded-md text-[#ededed]'>
                                    {contract.status}
                                </span>
                            </div>
                        }
                    </div>
                </div>
                <h1>Date Sent : {formattedDateSent}</h1>  
                <h1>Contract Valid Through : {formattedDateToAccept}</h1>  
                <hr/>
                <p className=''> Contract Amount {contract.rate} </p>
                <p className=''> Billed Every {contract.rateIntervalAmount} {contract.rateInterval} </p>
                <hr/>
                <h1 className='font-bold '>Service Location Address(es)</h1>
                {
                    serviceLocationList?.map( serviceLocation => (
                        <div>
                            <h1>{serviceLocation.streetAddress}</h1>
                            <div className='flex justify items center gap-2'>
                                <h1>{serviceLocation.city}</h1>
                                <h1>{serviceLocation.state}</h1>
                                <h1>{serviceLocation.zip}</h1>

                            </div>
                        </div>
                    ))

                }
                <hr/>
                <h1>Cleaning plan : {contract.chemType}</h1>
                <p>Surge Pricing. Handle how to deal will will excessively dirty pools. Due to Weather.</p>
                <h1>Chemical plan : {contract.chemType}</h1>
                <h1>Repair plan : {contract.chemType}</h1>
                <h1>Filter Service plan : {contract.chemType}</h1>
                <hr/>
                <p>serviceFrequency</p>
                <p>serviceFrequencyAmount</p>
                <p>The Above Service Locations Will be served 1 every Week</p>
                <hr/>
                <p>While {contract.companyName} will uphold the contract until {formattedStartDate} this is an at will contract. After the length of the contract.{contract.companyName} may offer a new contract </p>
                {/* <h1>Start Date : {formattedStartDate}</h1> */}
            </div>
            {
                (contract.status=='Pending')&&<div className='py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                        <div className='flex justify-between items-center gap-2'>
                            <button className='py-1 px-2 bg-[#2B600F] rounded-md'
                            onClick={(e) => acceptContract(e)}
                            ><p>Accept Contract</p></button>
                            <button className='py-1 px-2 bg-[#9C0D38] rounded-md'
                            onClick={(e) => rejectContract(e)}
                            ><p>Reject Contract</p></button>
                        </div>
                    </div>
                </div>
            }
            {
                (contract.status=='Accepted')&&<div className='py-2'>
                    <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6] '>
                        <p className='font-bold'> End Contract</p>
                        <div className='flex items-center justify-between'>
                        <button className='py-1 px-2 bg-[#1D2E76] rounded-md'>At End of Billing Cycle</button>
                        <button className='py-1 px-2 bg-[#9C0D38] rounded-md'>Immediately</button>
                        </div>
                        <p>Please add Pop up to offer reason for Ending the contract</p>
                        <p>Require putting a reason if you end the contract Immediately</p>
                    </div>
                </div>

            }
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <div className='flex justify-between items-center gap-2'>
                        <input
                        className='by-1 px-2 rounded-md'
                        placeholder='Comment...'
                        ></input>
                        <button 
                        onClick={(e) => postComment(e)}
                        className='py-1 px-2 bg-[#9C0D38] rounded-md'><p>Send Comment</p></button>
                    </div>
                </div>
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <p>Terms</p>
                    <p>{contract.terms}</p>
                    <p>Murdock Pool Service is offering a contract With the Following Terms</p>
                    <p>To Clean your Pool once every week. You will be billed every month at the rate of 185 USD per month</p>
                    <hr/>
                    <p className='font-bold'>Services Included under the Service Contract</p>
                    <p></p>
                    <p className='font-bold'>Services Not Included under the Service Contract</p>
                    <p>Please note that all services not specifically named under the service contract are not included.</p>
                    <hr/>
                    <p className='font-Bold'>Exceptions</p>
                    <p>Please note that the following contract will be upheld by {contract.companyName} except under the following circumstances. 
                    </p>
                    <p>Weather: For the safety of our technicians we will offer an adjusted service in the following conditions. During rain, snow, hail, and thunderstorms. We will do the following Tasks</p>
                    <p>Testing The Water</p>
                    <p>Dosing The Chemicals</p>
                    <p>Emptying Baskets</p>
                    <p>Weeks off: We as a company do not service any pools during the last week of the calendar year, between Christmas and New Years.</p>

                </div>
            </div>
        </div>
    );
};

export default ContractDetailView;