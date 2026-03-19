import React, { useState, useContext, useEffect } from "react";
import { Link, useParams } from 'react-router-dom';
import Chart from 'react-apexcharts';
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, doc, startAt, getDoc, where } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";

import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import toast from 'react-hot-toast';

import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import { BodyOfWater } from '../../../utils/models/BodyOfWater';

const ConnectServiceLocation = () => {
    const {user} = useContext(Context);

    const { linkedInviteId } = useParams();
    const [ newLinkedInviteId, setNewLinkedInviteId] = useState('');
    const [invite,setInvite] = useState({
        accepted : false,
        companyId : '',
        customerId : '',
        id : '',
    });

    const [company, setCompany] = useState({
        companyName : '',
        ownerName : '',
        id : '',
    });

    const [customer, setCustomer] = useState({
        name : '',
        id : '',
    });

    const [locationList, setLocationList] = useState(['6160 Broadmoor Drive ']);

   
    useEffect(() => {
        (async () => {
            try{
                if (linkedInviteId!=='NA') {
                    setNewLinkedInviteId(linkedInviteId)
                    const inviteRef = doc(db, "linkedInvite",linkedInviteId);
                    const inviteDoc = await getDoc(inviteRef);
                    if (inviteDoc.exists()) {
                        let companyId = inviteDoc.data().companyId
                        let customerId = inviteDoc.data().customerId
                        setInvite((prevInvite) => ({
                            ...prevInvite,
                            accepted: inviteDoc.data().accepted,
                            companyId: inviteDoc.data().companyId,
                            customerId: inviteDoc.data().customerId,
                            id: inviteDoc.data().id,
                        }));

                        //Get Company information 
                        const companyRef = doc(db, "companies",companyId);
                        const companyDoc = await getDoc(companyRef);
                        if (companyDoc.exists()) {
                            setCompany((prevInvite) => ({
                                ...prevInvite,
                                name : companyDoc.data().name,
                                ownerName : companyDoc.data().ownerName,
                                id : companyDoc.data().id,
                            }));
                        } else {
                            console.log("No such Contract document!");
                        }
        
                        //Get Customer information 
                        const customerRef = doc(db, "companies",companyId,'customers',customerId);
                        const customerDoc = await getDoc(customerRef);
                        if (customerDoc.exists()) {
                            let name = ''
                            if (customerDoc.data().displayAsCompany) {
                                name =  customerDoc.data().companyName
                            } else {
                                name = customerDoc.data().firstName + ' ' + customerDoc.data().lastName
                            }
                            console.log(customerDoc.data())
                            console.log('Name: ',name)
                            setCustomer((prevInvite) => ({
                                ...prevInvite,
                                name: name,
                                id: customerDoc.data().id,
                            }));
                        } else {
                            console.log("No such Contract document!");
                        }
        
                        //Get Location information 
                        let q = query(collection(db, 'companies',companyId,'serviceLocations'),where('customerId','==',customerId));
                        const querySnapshot = await getDocs(q);       
                        let count = 1   
                        setLocationList([])      
                        querySnapshot.forEach((doc) => {
                            const companyData = doc.data()
                            const  company = {
                                id:companyData.id,
                                address:companyData.address.streetAddress + ' ' + companyData.address.city + ' ' + companyData.address.state + ' ' + companyData.address.zip,
                            }
                            count = count + 1
                            setLocationList(companies => [...companies, company]); 
                        });
                    } else {
                        console.log("No such Contract document!");
                    }
                }
            } catch(error){
                console.log('Error')
                console.log(error)
            }
        })();
    },[])

    async function searchForLinkedInvite(e) {
        e.preventDefault()
        if (newLinkedInviteId!=''){
            const inviteRef = doc(db, "linkedInvite",newLinkedInviteId);
            const inviteDoc = await getDoc(inviteRef);
            if (inviteDoc.exists()) {
                let companyId = inviteDoc.data().companyId
                let customerId = inviteDoc.data().customerId
                setInvite((prevInvite) => ({
                    ...prevInvite,
                    accepted: inviteDoc.data().accepted,
                    companyId: inviteDoc.data().companyId,
                    customerId: inviteDoc.data().customerId,
                    id: inviteDoc.data().id,
                }));

                //Get Company information 
                const companyRef = doc(db, "companies",companyId);
                const companyDoc = await getDoc(companyRef);
                if (companyDoc.exists()) {
                    setCompany((prevInvite) => ({
                        ...prevInvite,
                        name : companyDoc.data().name,
                        ownerName : companyDoc.data().ownerName,
                        id : companyDoc.data().id,
                    }));
                } else {
                    console.log("No such Contract document!");
                }

                //Get Customer information 
                const customerRef = doc(db, "companies",companyId,'customers',customerId);
                const customerDoc = await getDoc(customerRef);
                if (customerDoc.exists()) {
                    let name = ''
                    if (customerDoc.data().displayAsCompany) {
                        name =  customerDoc.data().companyName
                    } else {
                        name = customerDoc.data().firstName + ' ' + customerDoc.data().lastName
                    }
                    console.log(customerDoc.data())
                    console.log('Name: ',name)
                    setCustomer((prevInvite) => ({
                        ...prevInvite,
                        name: name,
                        id: customerDoc.data().id,
                    }));
                } else {
                    console.log("No such Contract document!");
                }

                //Get Location information 
                let q = query(collection(db, 'companies',companyId,'serviceLocations'),where('customerId','==',customerId));
                const querySnapshot = await getDocs(q);       
                let count = 1   
                setLocationList([])      
                querySnapshot.forEach((doc) => {
                    const companyData = doc.data()
                    const  company = {
                        id:companyData.id,
                        address:companyData.address.streetAddress + ' ' + companyData.address.city + ' ' + companyData.address.state + ' ' + companyData.address.zip,
                    }
                    count = count + 1
                    setLocationList(companies => [...companies, company]); 
                });
            } else {
                console.log("No such Contract document!");
            }
        }
    }
    async function acceptLinkedInvite(e) {
        e.preventDefault()
        if (invite.id!==''){

            toast.success('Successfully Added Customer Locations To Account')
        }
    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='w-full light-blue-grey-bg p-4 rounded-md text-[#d0d2d6]'>

                    <Link to='/serviceLocation/create' className={` text-[#cfcfcf] px-[12px] py-[9px] rounded-sm flex justify-start items-center gap-[12px] hover:text-[#de3c6d] transition-all w-full mb-1 underline`}>
                        <span>
                            <p>Create a Service Location</p>
                        </span>
                    </Link>
                    <form>
                        <div className='p-2'>
                            <input onChange={(e) => {setNewLinkedInviteId(e.target.value)}} className='w-full p-2 rounded-md black-fg' type="text"placeholder='Linked Invite Id'></input>
                        </div>

                        <div className='p-2 blue-bg white-fg rounded-md'>
                            <button onClick={(e) => searchForLinkedInvite(e)} >Search</button>
                        </div>
                    </form>
                    {
                        invite.id !== '' && <div>
                            <h1 className='font-bold'>Invite Information</h1>
                            {
                                invite.accepted === false && <p>Invite has not been accepted</p>
                            }
                            {
                                invite.accepted === true && <p>Invite has been accepted</p>
                            }
                            <h1>"Should Customer be able to add after invite has been accepted"</h1>
                            <h1>Company Name: {company.name}</h1>
                            <h1>Customer Name: {customer.name}</h1>
    
                            <div className='py-2'>
                                <h1 className='font-bold'>Service Locations</h1>
                                {
                                    locationList?.map(location => (
                                        <h1 key={location.id}>{location.address}</h1>
                                    ))
                                }
                            </div>
                            <form>
                                <div className='p-2 blue-bg white-fg rounded-md'>
                                    <button onClick={(e) => acceptLinkedInvite(e)} >Add Customer Locations To Account</button>
                                </div>
                            </form>
                        </div>
                    }
                </div>
            </div>
        </div>
    ); 
};

export default ConnectServiceLocation;