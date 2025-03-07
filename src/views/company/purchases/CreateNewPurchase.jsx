import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import DatePicker from "react-datepicker";
import Select from 'react-select';

const CreateNewPurchase = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const navigate = useNavigate()

    // Customer Fields
    const [email, setEmail] = useState();
    const [refrence, setRefrence] = useState();
    const [quantity, setQuantity] = useState();
    const [phoneNumber, setPhoneNumber] = useState();
    const [billingAddressStreetAddress, setBillingAddressStreetAddress] = useState();
    const [billingAddressCity, setBillingAddressCity] = useState();
    const [billingAddressState, setBillingAddressState] = useState();
    const [billingAddressZip, setBillingAddressZip] = useState();
    const [billingNotes, setBillingNotes] = useState();
    const [purchaseDate, setPurchaseDate] = useState(new Date());
    const [formattedPurchaseDate,setFormattedPurchaseDate] = useState('')

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

        navigate('/company/customers')

    }

    const handlePurchaseDateChange = (dateOption) => {
        setPurchaseDate(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        setFormattedPurchaseDate(formattedDate)

    }

    const handleSelectedTaskTypeChange = (selectedOption2) => {

        (async () => {
            setSelectedTaskType(selectedOption2)
            
        })();
    };
    const [taskTypeList, setTaskTypeList] = useState([]);

    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });
    return (
        <div className='px-2 md:px-7 py-5'>
            <Link 
            
            className='py-1 px-2 bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6]'
            to={`/company/customers`}>Back</Link>

            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                Use Quickbooks as template
                <div className='left-0 w-full justify-between'>
                    <h2>Create New Receipt</h2>
                    <form className='gap-2'>
                        <div className='flex justify-between w-full items-center gap-2'>
                            <h2>Purchase Date</h2>
                            <DatePicker 
                                selected={purchaseDate} 
                                onChange={(purchaseDate) => handlePurchaseDateChange(purchaseDate)}
                            />
                        </div>
                        <div className='flex justify-between w-full items-center gap-2'>
                                <h2>Refrence</h2>
                                <input 
                                className='w-full py-1 px-2 rounded-md mt-2'
                                onChange={(e) => {setRefrence(e.target.value)}} type="text" placeholder='refrence' value={refrence}></input>
                                
                        </div>
                        <hr className='mt-2'/>
                        <div className='flex justify-between w-full items-center gap-2'>
                            <div className='w-full'>
                                <Select
                                    value={selectedTaskType}
                                    options={taskTypeList}
                                    onChange={handleSelectedTaskTypeChange}
                                    isSearchable
                                    placeholder="Select a Task Type"
                                    theme={(theme) => ({
                                    ...theme,
                                    borderRadius: 0,
                                    colors: {
                                        ...theme.colors,
                                        primary25: 'green',
                                        primary: 'gray',
                                    },
                                    })}
                                />
                                </div>
                                <div className='w-full'>

                                <Select
                                    value={selectedTaskType}
                                    options={taskTypeList}
                                    onChange={handleSelectedTaskTypeChange}
                                    isSearchable
                                    placeholder="Select a Task Type"
                                    theme={(theme) => ({
                                    ...theme,
                                    borderRadius: 0,
                                    colors: {
                                        ...theme.colors,
                                        primary25: 'green',
                                        primary: 'gray',
                                    },
                                    })}
                                />
                            </div>
                        </div>
                        <button
                        className='w-full py-1 px-2 rounded-md bg-[#1D2E76] text-[#ffffff] mt-2'
                        >Add First Line Item</button>
                        <div className='w-full'>
                        <h2>Select Purchase Item</h2>
                            <Select
                                value={selectedTaskType}
                                options={taskTypeList}
                                onChange={handleSelectedTaskTypeChange}
                                isSearchable
                                placeholder="Select a Task Type"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'green',
                                    primary: 'gray',
                                },
                                })}
                            />
                        </div>
                        <input 
                        className='w-full py-1 px-2 rounded-md mt-2'
                        onChange={(e) => {setQuantity(e.target.value)}} type="text" placeholder='quantity' value={quantity}></input>
                        <div className='flex justify-between w-full items-center gap-2'>
                            <div className='w-full'>
                                <button
                                className='w-full py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff] mt-2'
                                >Submit</button>
                                <button
                                className='w-full py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff] mt-2'
                                >Submit and Add Another</button>
                            </div>
                        </div>

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
    export default CreateNewPurchase;
