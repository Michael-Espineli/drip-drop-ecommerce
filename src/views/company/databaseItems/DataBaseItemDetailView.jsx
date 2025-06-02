import React, { useState,useEffect, useContext } from "react";
import {Link, useParams,Navigate } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, deleteDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';

const DataBaseItemDetailView = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const navigate = useNavigate()

    const {id} = useParams();

    const [purchase, setPurchase] = useState({
    });

    const [edit, setEdit] = useState(false);

    const [rate, setRate] = useState('');

    const [uom, setUom] = useState('');

    const [category, setCategory] = useState('');
    
    const [subcategory, setSubcategory] = useState('');

    const [color, setColor] = useState('');

    const [description, setDescription] = useState('');

    const [itemName, setItemName] = useState('');

    const [size, setSize] = useState('');

    const [billingRate, setBillingRate] = useState('');
    
    const [sku, setSku] = useState('');

    useEffect(() => { 
        (async () => {
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany,'settings','dataBase','dataBase',id);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const itemData = docSnap.data()
                    const dateUpdated = itemData.dateUpdated.toDate();
                    const formattedDate1 = format(dateUpdated, 'MM / d / yyyy'); 
                    
                    let rateDouble = itemData.rate/100
                    let formattedRateUSD = formatCurrency(rateDouble);
                    
                    let billingRateDouble = itemData.billingRate/100
                    let formattedBillingRateUSD = formatCurrency(billingRateDouble);
                
                    setPurchase((purchase) => ({
                        ...purchase,
                        UOM : itemData.UOM,
                        billable : itemData.billable,
                        category : itemData.category,
                        color : itemData.color,
                        dateUpdated : formattedDate1,
                        description : itemData.description,
                        id : itemData.id,
                        name : itemData.name,
                        rateFormatted : formattedRateUSD,
                        rate : itemData.rate/100,
                        size : itemData.size,
                        sku : itemData.sku,
                        storeName : itemData.storeName,
                        subCategory : itemData.subCategory,
                        timesPurchased : itemData.timesPurchased,
                        venderId : itemData.venderId,
                        label: itemData.name + ' ' + itemData.rate + ' ' + itemData.sku,
                        billingRate : formattedBillingRateUSD
                    }));
                } else {
                console.log("No such document!");
                }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    
    async function editItem(e) {
        e.preventDefault()
        try{
            setEdit(true);
            setRate(purchase.rate)
            setUom(purchase.UOM)
            setCategory(purchase.category)
            setColor(purchase.color)
            setDescription(purchase.description)
            setItemName(purchase.name)
            setSize(purchase.size)
            setBillingRate(purchase.billingRate)

        } catch(error){
            console.log(error)

        }
    }

    async function deleteItem(e) {
        e.preventDefault()
        try{
            await deleteDoc(doc(db, "companies",recentlySelectedCompany, "settings",'dataBase','dataBase',id));

            navigate('/company/items')
        } catch(error){
            console.log(error)
        }
    }

    async function cancelEdit(e) {
        e.preventDefault()
        try{
            setEdit(false);
        } catch(error){
            console.log(error)
        }
    }

    async function saveEdit(e) {
        e.preventDefault()
        try{
            setEdit(false);
            //Update Rate

        } catch(error){
            console.log(error)
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
            <div className='px-2 py-2 flex justify-between'>
                
                {
                    edit ? <button
                    onClick={(e) =>{deleteItem(e)}}
                    className='py-1 px-2 bg-[#9C0D38] rounded-md text-[#ffffff]'>
                        Delete
                    </button> :<Link 
                    className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                    to={`/company/items`}
                    >Go Back</Link>
                }
                {
                    edit ? <button
                    onClick={(e) =>{cancelEdit(e)}}
                    className='py-1 px-2 bg-[#9C0D38] rounded-md text-[#ffffff]'>
                        Cancel
                    </button> :<button
                    onClick={(e) =>{editItem(e)}}
                    className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'>
                        Edit
                    </button>
                }
                
                
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#ffffff]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between py-1'>
                        <p className='font-bold text-lg'>Item Detail View</p>
                    </div>
                    {
                        edit ? <div>
                                <div className="flex py-1 ">
                                    <p className="px-2 items-center">Item Name</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setItemName(e.target.value)}} type="text" placeholder='QuantitemNameity' value={itemName}>
                                    </input>
                                </div>
                                <div className="flex  py-1">
                                    <p className="px-2 items-center">Rate</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setRate(e.target.value)}} type="text" placeholder='Quantity' value={rate}>
                                    </input>
                                </div>
                                <div className="flex  py-1">
                                    <p className="px-2 items-center">billing Rate</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setBillingRate(e.target.value)}} type="text" placeholder='billingRate' value={billingRate}>
                                    </input>
                                </div>
                                <div className="flex py-1">
                                    <p className="px-2 items-center">SKU</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setSku(e.target.value)}} type="text" placeholder='sku' value={sku}>
                                    </input>
                                </div>
                                <div className="flex py-1">
                                    <p className="px-2 items-center">UOM</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setUom(e.target.value)}} type="text" placeholder='uom' value={uom}>
                                    </input>
                                </div>
                                <div className="flex  py-1">
                                    <p className="px-2 items-center">category</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setCategory(e.target.value)}} type="text" placeholder='category' value={category}>
                                    </input>
                                </div>
                                <div className="flex  py-1">
                                    <p className="px-2 items-center">Subcategory</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setSubcategory(e.target.value)}} type="text" placeholder='Subcategory PICKER' value={subcategory}>
                                    </input>
                                </div> 
                                <div className="flex  py-1">
                                    <p className="px-2 items-center">color</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setColor(e.target.value)}} type="text" placeholder='color' value={color}>
                                    </input>
                                </div>
                                <div className="flex py-1 ">
                                    <p className="px-2 items-center">size</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setSize(e.target.value)}} type="text" placeholder='size' value={size}>
                                    </input>
                                </div>
                                <div className="flex py-1 ">
                                    <p className="px-2 items-center">description</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setDescription(e.target.value)}} type="text" placeholder='description' value={description}>
                                    </input>
                                </div>
                                <button
                                    onClick={(e) =>{saveEdit(e)}}
                                    className='py-1 px-2 bg-[#2B600F] rounded-md text-[#ffffff] w-full'>
                                        Save
                                </button>
                
                            </div>
                             : <div>
                                <p>name -  {purchase.name}</p>
                                <p>Rate -  {purchase.rateFormatted}</p>
                                <p>Billing Rate -  {purchase.billingRate}</p>
                                <p>UOM -  {purchase.UOM}</p>
                                <p>category -  {purchase.category}</p>
                                <p>color -  {purchase.color}</p>
                                <p>dateUpdated -  {purchase.dateUpdated}</p>
                                <p>description -  {purchase.description}</p>
                                <p>size -  {purchase.size}</p>
                                <p>sku -  {purchase.sku}</p>
                                <p>storeName -  {purchase.storeName}</p>
                                <p>Times Purchased -  {purchase.timesPurchased}</p>
                             </div>

                    }
                </div>
            </div>
        </div>
    );
}
    export default DataBaseItemDetailView;
