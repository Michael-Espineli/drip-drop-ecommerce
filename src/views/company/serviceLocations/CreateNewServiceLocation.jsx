import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';

const CreateNewServiceLocation = () => {
    const {customerId} = useParams();

    const {name,recentlySelectedCompany} = useContext(Context);

    const [email, setEmail] = useState();
    const [firstName, setFirstName] = useState();
    const [lastName, setLastName] = useState();
    const [phoneNumber, setPhoneNumber] = useState();

    const [addressStreetAddress, setAddressStreetAddress] = useState();
    const [addressCity, setAddressCity] = useState();
    const [addressState, setAddressState] = useState();
    const [addressZip, setAddressZip] = useState();

    const [billingNotes, setBillingNotes] = useState();
    const navigate = useNavigate()

    useEffect(() => {
        (async () => {
            try{
              
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    async function createNewCustomer(e) {
        e.preventDefault()

        navigate('/company/customers')

    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <Link 
            
            className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
            to={`/company/customers`}>Back</Link>

            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <h2>Create New Service Location - {customerId}</h2>
                    <form className='gap-2'>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setFirstName(e.target.value)}} type="text" placeholder='firstName' value={firstName}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setLastName(e.target.value)}} type="text" placeholder='lastName' value={lastName}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setPhoneNumber(e.target.value)}} type="text" placeholder='phoneNumber' value={phoneNumber}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setEmail(e.target.value)}} type="text" placeholder='Email' value={email}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setAddressStreetAddress(e.target.value)}} type="text" placeholder='addressStreetAddress' value={addressStreetAddress}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setAddressCity(e.target.value)}} type="text" placeholder='addressCity' value={addressCity}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setAddressState(e.target.value)}} type="text" placeholder='addressState' value={addressState}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setAddressZip(e.target.value)}} type="text" placeholder='addressZip' value={addressZip}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'

                        onChange={(e) => {setBillingNotes(e.target.value)}} type="text" placeholder='billingNotes' value={billingNotes}></input>

                        <button
                        className='w-full py-1 px-2 rounded-md bg-[#ffffff] mt-2'
                        onClick={(e) => createNewCustomer(e)} 
                        >Submit</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
    export default CreateNewServiceLocation;
