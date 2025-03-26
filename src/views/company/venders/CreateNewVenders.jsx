import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import DatePicker from "react-datepicker";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
// import { console } from "inspector";

const CreateNewVenders = () => {
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

    const [companyUserList, setCompanyUserList] = useState([]);
    
    const [selectedUser,setSelectedUser] = useState({})

    const [venderList, setVenderList] = useState([]);
    
    const [selectedVender,setSelectedVender] = useState({})

    const [genericItemList, setGenericItemList] = useState([]);
    
    const [selectedGenericItem,setSelectedGenericItem] = useState({})
    
    const [purchaseItemlist, setPurchaseItemList] = useState([]);

    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });
    // Service Location Fields

    useEffect(() => {
        (async () => {
            try{
                let q = query(collection(db, 'companies',recentlySelectedCompany,'companyUsers'));
                const querySnapshot = await getDocs(q);       
                setCompanyUserList([])      
                querySnapshot.forEach((doc) => {
                    const companyUserData = doc.data()
                    const companyUser = {
                        id:companyUserData.id,
                        userName:companyUserData.userName,
                        roleName:companyUserData.roleName,
                        status: companyUserData.status,
                        workerType: companyUserData.workerType,
                        linkedCompanyId: companyUserData.linkedCompanyId,
                        linkedCompanyName:companyUserData.linkedCompanyName,
                        label:companyUserData.userName
                    }
                    setCompanyUserList(companyUserList => [...companyUserList, companyUser]); 
                });

                //Get Generic Data Base Items
                let genericItemQuery = query(collection(db, "companies",recentlySelectedCompany,'settings','dataBase','dataBase'));
                const genericItemQuerySnapshot = await getDocs(genericItemQuery);       
                setGenericItemList([])
                genericItemQuerySnapshot.forEach((doc) => {
                    const itemData = doc.data()
                    const genericItem = {
                        UOM : itemData.id,
                        billable : itemData.billable,
                        category : itemData.category,
                        color : itemData.color,
                        dateUpdated : itemData.dateUpdated,
                        description : itemData.description,
                        id : itemData.id,
                        name : itemData.name,
                        rate : itemData.rate,
                        size : itemData.size,
                        sku : itemData.sku,
                        storeName : itemData.storeName,
                        subCategory : itemData.subCategory,
                        timesPurchased : itemData.timesPurchased,
                        venderId : itemData.venderId,
                        label: itemData.name + ' ' + itemData.rate
                    }
                    setGenericItemList(genericItemList => [...genericItemList, genericItem]); 
                });

            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    async function createNewCustomer(e) {
        e.preventDefault()

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
    const handleSelectedGenericItemChange = (selectedOption2) => {

        (async () => {
            setSelectedGenericItem(selectedOption2)
            // setItemId(selectedOption2.id)
            // setItemCost(selectedOption2.rate)
            // setItemPrice(selectedOption2.rate)
            // setItemName(selectedOption2.name)
        })();
    };
    const handleSelectedUserChange = (selectedOption2) => {

        (async () => {

            setSelectedUser(selectedOption2)
            
        })();
    };
    

    const handleSelectedVenderChange = (selectedOption2) => {

        (async () => {

            setSelectedVender(selectedOption2)
            
        })();
    };
    

    async function addNewItem(e) {
        e.preventDefault()
        let rate = parseFloat( selectedGenericItem.rate)*100//Need to Change to *100. because I store all numbers as cents, rather than dollars
        let quantityFloat = parseFloat( quantity)

        let totalCost = rate*quantityFloat

        let id = uuidv4()

        let newItem = {
            id: id,
            sku: selectedGenericItem.sku,
            name: selectedGenericItem.name,
            rate: rate.toFixed(2),
            quantity: quantityFloat,
            description: selectedGenericItem.description,
            totalCost: totalCost.toFixed(2),
        }
        
        setPurchaseItemList(purchaseItemlist => [...purchaseItemlist, newItem]); 
        setQuantity('')
        setSelectedGenericItem({})
    }

    async function removeItem(e,itemId) {
        e.preventDefault()
        console.log(itemId)

        let workingList = purchaseItemlist
        console.log(workingList)
        workingList = workingList.filter(item => item.id !== itemId);
        console.log(workingList)
        
        setPurchaseItemList(workingList); 
    }

    async function submitReceipt(e) {
        e.preventDefault()

        navigate('/company/customers')
    }
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
                                onChange={(e) => {setRefrence(e.target.value)}} type="text" placeholder='Refrence' value={refrence}></input>
                                
                        </div>
                        <hr className='mt-2'/>
                        <div className='flex justify-between w-full items-center gap-2'>
                            <div className='w-full'>
                                <h1>Store</h1>
                                <Select
                                    value={selectedVender}
                                    options={venderList}
                                    onChange={handleSelectedVenderChange}
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
                                <h1>Tech</h1>

                                <Select
                                    value={selectedUser}
                                    options={companyUserList}
                                    onChange={handleSelectedUserChange}
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
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Sku</th>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Description</th>
                                    <th className='py-3 px-4'>Cost</th>
                                    <th className='py-3 px-4'>Quantity</th>
                                    <th className='py-3 px-4'>Total Cost</th>
                                    <th className='py-3 px-4'></th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                purchaseItemlist?.map( item => (
                                    <tr key={item.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.sku}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.name}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.description}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.rate}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.quantity}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.totalCost}</td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                            <button
                                            onClick={(e) => removeItem(e,item.id)} 
                                            className='w-full py-1 px-2 rounded-md bg-[#9C0D38] text-[#ffffff] mt-2'
                                            >Remove</button>
                                        </td>
                                    </tr>
                                ))
                            }
                            </tbody>
                        </table>
                        {/* <button
                        className='w-full py-1 px-2 rounded-md bg-[#1D2E76] text-[#ffffff] mt-2'
                        >Add First Line Item</button> */}
                        <div className='w-full'>
                        <h2>Select Purchase Item</h2>
                            <Select
                                value={selectedGenericItem}
                                options={genericItemList}
                                onChange={handleSelectedGenericItemChange}
                                isSearchable
                                placeholder="Select a Generic Item"
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
                        onChange={(e) => {setQuantity(e.target.value)}} type="text" placeholder='Quantity' value={quantity}></input>
                        <div className='flex justify-between w-full items-center gap-2'>
                            <div className='w-full'>
                                <button
                                onClick={(e) => addNewItem(e)} 
                                className='w-full py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff] mt-2'
                                >Add Item</button>
                            </div>
                        </div>

                        <button
                        className='w-full py-1 px-2 rounded-md bg-[#ffffff] mt-2'
                        onClick={(e) => submitReceipt(e)} 
                        >Submit</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
    export default CreateNewVenders;
