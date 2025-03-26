import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, updateDoc, doc, getDoc, where, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { format } from 'date-fns'; // Or any other date formatting library

const PurchaseDetailView = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const {purchaseId} = useParams();

    const [purchase, setPurchase] = useState({
    });

    const [notes, setNotes] = useState('');

    const [updating, setUpdating] = useState(false);
    
    const [customerList, setCustomerList] = useState([]);

    const [selectedCustomer, setSelectedCustomer] = useState(); 

    useEffect(() => {
        (async () => {
            try{

                const docRef = doc(db, "companies",recentlySelectedCompany,'purchasedItems',purchaseId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const purchaseData = docSnap.data()
                    const dateCreated = purchaseData.date.toDate();
                    const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                    let customerId = ''
                    setPurchase((purchase) => ({
                        ...purchase,
                        id:purchaseData.id,
                        name:purchaseData.name,
                        receiptId:purchaseData.receiptId,
                        invoiceNum:purchaseData.invoiceNum,
                        price:formatCurrency(purchaseData.price/100),
                        total:formatCurrency((purchaseData.price/100)*parseFloat(purchaseData.quantityString)),
                        billingRate:formatCurrency(purchaseData.billingRate/100),
                        billable:purchaseData.billable,
                        quantityString: purchaseData.quantityString,
                        techName:purchaseData.techName,
                        venderName:purchaseData.venderName,
                        date:formattedDate1,
                        itemId: purchaseData.itemId,
                        notes: purchaseData.notes,
                        description: purchaseData.description,
                        invoiced:purchaseData.invoiced,
                    }));
                    setNotes(purchaseData.notes)

                    customerId=purchaseData.customerId
                    //Get Customers
                    let q;
                        // q = query(collection(db, 'companies',recentlySelectedCompany,'customers'),limit(10));
                        q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"), where('active','==',true));
    
                    const querySnapshot = await getDocs(q);    
                    let list = []   
                    setCustomerList([])      
                    querySnapshot.forEach((doc) => {
                        const customerDoc = doc.data()
                        
                        let name = ''
                        if (customerDoc.displayAsCompany){
                            name = customerDoc.company
                        } else {
                            name = customerDoc.firstName + ' ' + customerDoc.lastName
                        }
                        const customerData = {
                            id:customerDoc.id,
                            name: name,
                            streetAddress:customerDoc.billingAddress.streetAddress,
                            phoneNumber: customerDoc.phoneNumber,
                            email:customerDoc.email,
                            label:name,
                        }
                        setCustomerList(customerList => [...customerList, customerData]); 
                        list.push(customerData)
                    });
                    if (customerId!=''){
                        console.log('new customer ID')
                        const newArr = list.filter(obj => obj.id == customerId); // Keep all objects except the one with id 2

                        console.log(newArr)
                        let selectedCustomer = newArr[0]
                        console.log(selectedCustomer)

                        setSelectedCustomer(selectedCustomer)
                    }
                } else {
                    console.log("No such document!");
                }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    const handleCustomerChange = (option) => {

        (async () => {
            if (option ==null) {
                setSelectedCustomer(option)
                try {   
                    setUpdating(true)
                    const docRef = doc(db, "companies",recentlySelectedCompany,'purchasedItems',purchaseId);
        
                    await updateDoc(docRef, {
                    customerId: "",
                    customerName: "",
    
                    });
                    setUpdating(false)
                } catch(error){
                    console.log(error)
                    console.log('Purchase Detail View Customer')
                    setUpdating(false)
                }

            } else {
                setSelectedCustomer(option)
                try {   
                    setUpdating(true)
                    const docRef = doc(db, "companies",recentlySelectedCompany,'purchasedItems',purchaseId);
        
                    await updateDoc(docRef, {
                    customerId: option.id,
                    customerName: option.name,
    
                    });
                    setUpdating(false)
                } catch(error){
                    console.log(error)
                    console.log('Purchase Detail View Customer')
                    setUpdating(false)
                }

            }
        })();
    };
    
    async function updateNotes(e) {
        e.preventDefault()
        setNotes(e.target.value)
        try {   
            setUpdating(true)
            const docRef = doc(db, "companies",recentlySelectedCompany,'purchasedItems',purchaseId);

            await updateDoc(docRef, {
            notes: e.target.value
            });
            setUpdating(false)
        } catch(error){
            console.log(error)
            console.log('Purchase Detail View Notes')
            setUpdating(false)
        }
    }
    
    
    async function updateInvoiced(e) {
        e.preventDefault()
        
        try {   
            console.log('Updating to true')
            setPurchase((purchase) => ({
                ...purchase,
                invoiced:true,
            }));
            const docRef = doc(db, "companies",recentlySelectedCompany,'purchasedItems',purchaseId);

            await updateDoc(docRef, {
                invoiced:true,
            });
            setUpdating(false)
        } catch(error){
            console.log(error)
            console.log('Purchase Detail View Invoiced')
            setUpdating(false)
        }
    } 
    
    async function updateNotInvoiced(e) {
        e.preventDefault()
        
        try {   
            console.log('Updating to false')
            setPurchase((purchase) => ({
                ...purchase,
                invoiced:false,
            }));
            const docRef = doc(db, "companies",recentlySelectedCompany,'purchasedItems',purchaseId);

            await updateDoc(docRef, {
                invoiced:false,
            });
            setUpdating(false)
        } catch(error){
            console.log(error)            
            console.log('Purchase Detail View Invoiced')

            setUpdating(false)
        }
    }

    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency
        }).format(number);
    }

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
        // 919191 = gray
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2 flex justify-between'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md py-1 px-2 text-[#d0d2d6]'
                to={`/company/purchasedItems`}>
                    Back
                </Link>
            </div>
            <p className='font-bold text-3xl'>Purchase Detail View</p>
            <div className='w-full flex justify-between bg-[#1D2E76] text-[#cfcfcf] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div>
                        <p className='font-bold text-lg flex justify-center'>Item Information </p>
                        <Link 
                        to={`/company/receipts/detail/${purchase.receiptId}`}
                        >
                            <p className=" w-1/4 py-1 px-2 bg-[#CDC07B] text-[#030811] rounded-md">{purchase.invoiceNum}</p> 
                        </Link>
                        <p>Vender  - {purchase.venderName}</p>
                        <p>Tech  - {purchase.techName}</p>
                        <p>Date  - {purchase.date}</p>
                        
                    <hr className="w-1/2"/>
                        <p>Item </p>
                        <Link
                        
                        to={`/company/items/detail/${purchase.receiptId}`}
                        >
                            <p className=" w-1/4 py-1 px-2 bg-[#CDC07B] text-[#030811] rounded-md">{purchase.name}</p>
                        </Link>
                    </div>
                    <p>Rate -  {purchase.price}</p>
                    <p>Quantity - {purchase.quantityString}  {purchase.total}</p>
                    <hr className="w-1/4"/>
                    <p>Total -  {purchase.total}</p>
                    <p>Description  - {purchase.description}</p>
                </div>
                {/* Vertical Line */}
                <div
                className="inline-block h-[250px] min-h-[1em] w-0.5 self-stretch bg-neutral-100 dark:bg-white/10"></div>
                <div className='left-0 w-full justify-between'>
                    {/* Customer Section */}

                    {
                        !purchase.billable ? <div className="">
                            <p>Not Billable</p>
                        </div>:<div>
                            <p>Billable</p>
                            <p>Billable Rate -  {purchase.billingRate}</p>

                            {/* Customer Selection */}
                            <p>Customer</p>
                            <div className="text-[#000000]">
                                <Select
                                    value={selectedCustomer}
                                    options={customerList}
                                    onChange={handleCustomerChange }
                                    isSearchable
                                    isRtl
                                    isClearable
                                    placeholder="Select A Customer"
                                    theme={(theme) => ({
                                    ...theme,
                                    borderRadius: 15,
                                    colors: {
                                        ...theme.colors,
                                        primary: '#747e79',
                                        primary25: '#747e79',
                                        neutral0: '#ffffff',
                                        neutra: '#ffffff',
                                        neutral10: '#ffffff',
                                        neutral5: '#ffffff',
                                        neutral20: '#030811',
                                        neutral50: '#030811',
                                        neutral80: '#030811',
                                    },
                                    })}
                                    
                                    styles={{
                                        control: (baseStyles, state) => ({
                                            ...baseStyles,
                                            borderColor: state.isFocused ? 'grey' : 'grey',
                                        }),
                                    }}
                                />
        
                            </div>
                            {/* Mark As invoiced */}
                            {
                                purchase.invoiced ? <div className='p-2'>
                                    <button
                                    onClick={(e) => {updateNotInvoiced(e)}}
                                    >
                                        <p className='bg-[#2B600F] rounded-md items-center flex justify-center px-2'>Invoiced</p>
                                        
                                    </button>
                                </div>:
                                <div className='p-2'>
                                    <button
                                    onClick={(e) => {updateInvoiced(e)}}
                                    >
                                        <p className='bg-[#9C0D38] rounded-md items-center flex justify-center px-2'>Not Invoiced</p>
                                    </button>
                                </div>
                            }
                        </div>
                    }
                    {updating?<p>Notes: ...Updating</p>:<p>Notes:</p>}

                    <div className='p-2'>
                        <textarea 
                        className='block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500' 
                        name="Text1" 
                        cols="40" 
                        rows="5"
                        placeholder='Notes...'
                        onChange={(e) => {updateNotes(e)}}
                        value={notes}
                        ></textarea>        
                    </div>

                </div>
            </div>
        </div>
    );
}
    export default PurchaseDetailView;
