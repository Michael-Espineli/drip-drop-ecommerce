import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import {v4 as uuidv4} from 'uuid';

const CreateNewCustomer = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    // Customer Fields
    const [email, setEmail] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [billingAddressStreetAddress, setBillingAddressStreetAddress] = useState("");
    const [billingAddressCity, setBillingAddressCity] = useState("");
    const [billingAddressState, setBillingAddressState] = useState("");
    const [billingAddressZip, setBillingAddressZip] = useState("");
    const [billingNotes, setBillingNotes] = useState("");
    const navigate = useNavigate()
    // Service Location Fields

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
        let customerId = 'com_c_' + uuidv4();
        //Guard Statments
        //If not tasks are selected do not allow completion
        //if Draft Do not Update Job/Do not Notify Receiver / Please do on google function
        //Upload Contract
        
        if (customerId!=='') {

                await setDoc(doc(db,"companies",recentlySelectedCompany,'customers',customerId), {
                    active : false,
                    billingAddress : {
                        city : billingAddressCity,
                        latitude : 0,
                        longitude : 0,
                        state : billingAddressState,
                        streetAddress : billingAddressStreetAddress,
                        zip : billingAddressZip,
                    },
                    billingNotes : billingNotes,
                    company : "Company",
                    displayAsCompany : false,
                    email : email,
                    firstName : firstName,
                    hireDate : 'Estimate Pending',
                    id : customerId,
                    lastName : lastName,
                    linkedInviteId : "",
                    phoneNumber : phoneNumber,
                });
        } else {
            console.log('Location Guard Statement')
        }

        //Maybe have google function update these. 
        //Navigate To customer Detail View
        navigate('/company/customers')
    }
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='px-2 py-2'>
                <Link 
                className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
                to={`/company/customers`}>Back</Link>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <h2>Create New Customer</h2>
                    <form className='gap-2'>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setFirstName(e.target.value)}} type="text" placeholder='First Name' value={firstName}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setLastName(e.target.value)}} type="text" placeholder='Last Name' value={lastName}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setPhoneNumber(e.target.value)}} type="text" placeholder='Phone Number' value={phoneNumber}></input>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setEmail(e.target.value)}} type="text" placeholder='Email' value={email}></input>
                        <p>Billing Address</p>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setBillingAddressStreetAddress(e.target.value)}} type="text" placeholder='Street Address' value={billingAddressStreetAddress}></input>
                        <div className='flex justify-between w-full items-center gap-2'>
                            <input 
                            className='w-full py-1 px-2 rounded-md mt-2'
                            onChange={(e) => {setBillingAddressCity(e.target.value)}} type="text" placeholder='City' value={billingAddressCity}></input>
                            <input 
                            className='w-full py-1 px-2 rounded-md mt-2'
                            onChange={(e) => {setBillingAddressState(e.target.value)}} type="text" placeholder='State' value={billingAddressState}></input>
                            <input 
                            className='w-full py-1 px-2 rounded-md mt-2'
                            onChange={(e) => {setBillingAddressZip(e.target.value)}} type="text" placeholder='Zip' value={billingAddressZip}></input>
                        </div>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setBillingNotes(e.target.value)}} type="text" placeholder='Billing Notes' value={billingNotes}></input>

                        <hr className='mt-2'/>
                        <p>Set Up First Service Location</p>
                        <hr className='mt-2'/>

                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setBillingNotes(e.target.value)}} type="text" placeholder='Billing Notes' value={billingNotes}></input>
                        <hr className='mt-2'/>
                        <p>Set Body Of Water</p>
                        <hr className='mt-2'/>

                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setBillingNotes(e.target.value)}} type="text" placeholder='billingNotes' value={billingNotes}></input>

                        <hr className='mt-2'/>
                        <p>Set Up Equipment</p>
                        <hr className='mt-2'/>
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
    export default CreateNewCustomer;
