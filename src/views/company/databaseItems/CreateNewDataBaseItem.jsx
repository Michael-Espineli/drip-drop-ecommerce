import React, { useState,useEffect, useContext } from "react";
import {Link, useParams,Navigate } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library
import {v4 as uuidv4} from 'uuid';
import { useNavigate } from 'react-router-dom';

import Select from 'react-select';

const CreateNewDataBaseItem = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const navigate = useNavigate()

    const [purchase, setPurchase] = useState({
    });
    const [edit, setEdit] = useState(false);

    
        const [billable, setBillable] = useState(false);
    
        const [rate, setRate] = useState('0');
    
        const [rateUSD, setRateUSD] = useState('0');
    
        const [billingRate, setBillingRate] = useState('0');
    
        const [billingRateUSD, setBillingRateUSD] = useState('0');
    
        const [sku, setSku] = useState('');
    
        const [uom, setUom] = useState('');
    
        const [category, setCategory] = useState('');
            
        const [subcategory, setSubcategory] = useState('');
    
        const [color, setColor] = useState('');
    
        const [description, setDescription] = useState('');
    
        const [itemName, setItemName] = useState('');
    
        const [size, setSize] = useState('');
        
        const [venderList, setVenderList] = useState([]);
    
        const [vender, setVender] = useState('');
    
        const [venderName, setVenderName] = useState('');
    
        const [venderId, setVenderId] = useState('');

        const [uomList, setUomList] = useState([
            {
                id:1,
                label:'Gallon'
            }
            ,
            {
                id:2,
                label:'Pounds'
            }
            ,
            {
                id:3,
                label:'Oz'
            }
            ,
            {
                id:4,
                label:'Feet'
            }
            ,
            {
                id:5,
                label:'Square Feet'
            }
            ,
            {
                id:6,
                label:'Liter'
            }
            ,
            {
                id:7,
                label:'Inch'
            }
            ,
            {
                id:8,
                label:'Quart'
            }
            ,
            {
                id:9,
                label:'Tab'
            }
            ,
            {
                id:10,
                label:'Unit'
            }
            ,
        ]);

        const [categoryList, setCategoryList] = useState([
            {
                id:1,
                label:'PVC'
            }
            ,
            {
                id:2,
                label:'Galvanized'
            }
            ,
            {
                id:3,
                label:'Chemicals'
            }
            ,
            {
                id:4,
                label:'Useables'
            }
            ,
            {
                id:5,
                label:'Equipment'
            }
            ,
            {
                id:6,
                label:'Parts'
            }
            ,
            {
                id:7,
                label:'Electrical'
            }
            ,
            {
                id:8,
                label:'Tools'
            }
            ,
            {
                id:9,
                label:'Misc'
            }
        ]);

        const [subcategoryList, setSubcategoryList] = useState([
            {
                id:1,
                label:'Please Update'
            }
        ]);
        
        const handleUOMChange = (selectedOption2) => {

            (async () => {
                setUom(selectedOption2)
            })();
        };

        const handleCategoryChange = (selectedOption2) => {

            (async () => {
                setCategory(selectedOption2)
            })();
        };

        const handleSubcategoryChange = (selectedOption2) => {

            (async () => {
                setSubcategory(selectedOption2)
            })();
        };

        const handleVenderChange = (selectedOption2) => {

            (async () => {
                setVenderName(selectedOption2.label)
                setVenderId(selectedOption2.id)
                setVender(selectedOption2)
            })();
        };

    useEffect(() => {
        (async () => {
            try{
    
                //Venders
                    let qv;
                    qv = query(collection(db, 'companies',recentlySelectedCompany,'settings','venders','vender'));
                    const querySnapshotv = await getDocs(qv);
                    let count = 1 
                    setVenderList([])  
                    querySnapshotv.forEach((doc) => {
                        const venderData = doc.data()
                        const vender = {
                            id:venderData.id,
                            name:venderData.name,
                            email:venderData.email,
                            phoneNumber:venderData.phoneNumber,
                            streetAddress: venderData.address.streetAddress,
                            city:venderData.address.city,
                            state:venderData.address.state,
                            zip:venderData.address.zip,
                            label:venderData.name
                        }
                        count = count + 1
                        setVenderList(venderList => [...venderList, vender]); 
                    });
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

    async function cancelEdit(e) {
        e.preventDefault()
        try{
            setEdit(false);
        } catch(error){
            console.log(error)
        }
    }

    async function rateInput(e) {
        e.preventDefault()
        try{
            //Original

            let value = e.target.value.replace(/[^\d.]/g, '');
            
            setRate(value)
            const parts = value.split('.');
            if (parts.length > 1) {
                parts[1] = parts[1].slice(0, 2);
                value = parts.join('.');
            }
            // e.target.value = value;

            // let value = parseFloat(e.target.value);
            if (!isNaN(value)) {
                let newRate = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
                // setRateUSD(newRate)
                setRateUSD(value)
            } else {
                let newRate = '0';
                setRateUSD(newRate)

            }

        } catch(error){
            console.log(error)
        }
    }

    async function billingRateInput(e) {
        e.preventDefault()
        try{
            //Original

            let value = e.target.value.replace(/[^\d.]/g, '');
            
            setBillingRate(value)
            const parts = value.split('.');
            if (parts.length > 1) {
                parts[1] = parts[1].slice(0, 2);
                value = parts.join('.');
            }
            // e.target.value = value;

            // let value = parseFloat(e.target.value);
            if (!isNaN(value)) {
                let newRate = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
                // setRateUSD(newRate)
                setBillingRateUSD(value)
            } else {
                let newRate = '0';
                setBillingRateUSD(newRate)

            }

        } catch(error){
            console.log(error)
        }
    }
    
    async function billableTrue(e) {
        setBillable(true)
    }
    
    async function billableFalse(e) {
        setBillable(false)
    }

    async function createNewItem(e) {
        e.preventDefault()
        try{
            //Create New Item
            let id = 'com_sett_db_' + uuidv4()
    
            console.log('Added Receipt ' + id)
            let rateCents = rateUSD*100
            
            let billingRateCents = billingRateUSD*100

            let item = {
                UOM : uom,
                id : id,
                billable : billable,
                category : category,
                color : color,
                dateUpdated : new Date(),
                description : description,
                name : itemName,
                rate : rateCents,
                size : size,
                sku : sku, 
                storeName : "",
                subCategory : subcategory,
                timesPurchased : 0,
                venderId : "",
                billingRate : billingRateCents
            }
            console.log(item)
            await setDoc(doc(db,"companies",recentlySelectedCompany,"settings",'dataBase','dataBase', id), item);
            
            navigate('/company/items/detail/' + id)
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
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to={`/company/items`}
                >Go Back</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#ffffff]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between py-1'>
                        <p className='font-bold text-lg'>Item Detail View</p>
                    </div>
                    <div>
                        <div className="flex py-1 ">
                            <p className="px-2 items-center line-clamp-1 w-[150px]">Item Name</p>
                            <input 
                            className='w-full py-1 px-2 rounded-md text-[#000000]'
                            onChange={(e) => {setItemName(e.target.value)}} type="text" placeholder='Item Name' value={itemName}>
                            </input>
                        </div>
                        <div className="flex  py-1">
                            <p className="px-2 items-center">Rate</p>
                            <div className='flex w-full py-1 px-2 rounded-md text-[#000000] bg-[#ffffff]'>
                                
                                <p className="px-2">$</p>
                                <input 
                                className='flex w-full'
                                onChange={(e) => {rateInput(e)}} type="text" placeholder='Rate' value={rate}>
                                </input>
                            </div>
                        </div>
                        {
                            billable ? <div className="py-1">
                                <button
                                onClick={(e) =>{billableFalse(e)}}
                                className='py-1 px-2 bg-[#2B600F] rounded-md text-[#ffffff] w-full'>
                                    Billable
                                </button>
                                <div className="flex  py-1">
                                    <p className="px-2 items-center line-clamp-1 w-[150px]">Billing Rate</p>
                                    <div className='flex w-full py-1 px-2 rounded-md text-[#000000] bg-[#ffffff] items-center'>
                                        
                                        <p className="px-2">$</p>
                                        <input 
                                        className='flex w-full'
                                        onChange={(e) => {billingRateInput(e)}} type="text" placeholder='Billing Rate' value={billingRate}>
                                        </input>
                                    </div>
                                </div>
                            </div> : <div className="flex  py-1">
                                <button
                                onClick={(e) =>{billableTrue(e)}}
                                className='py-1 px-2 bg-[#9C0D38] rounded-md text-[#ffffff] w-full'>
                                    Not Billable
                                </button>
                            </div>
                        }
                        
                        <div className="flex py-1">
                            <p className="px-2 items-center">SKU</p>
                            <input 
                            className='w-full py-1 px-2 rounded-md text-[#000000]'
                            onChange={(e) => {setSku(e.target.value)}} type="text" placeholder='sku' value={sku}>
                            </input>
                        </div>
                        <div className="flex py-1 justify-between items-center">
                            <p className="px-2">Vender</p>
                                <Select
                                    value={vender}
                                    options={venderList}
                                    onChange={handleVenderChange}
                                    isSearchable
                                    placeholder="Select a Vender"
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
                        <div className="flex py-1 justify-between items-center">
                            <p className="px-2 ">U.O.M. <p className="text-sm px-5">unit of measurment</p></p>
                            <Select
                                value={uom}
                                options={uomList}
                                onChange={handleUOMChange}
                                isSearchable
                                placeholder="Select a UOM"
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
                        
                        <div className="flex py-1 justify-between items-center">
                            <p className="px-2">Category</p>
                            <Select
                                value={category}
                                options={categoryList}
                                onChange={handleCategoryChange}
                                isSearchable
                                placeholder="Select a Category"
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
                        <div className="flex py-1 justify-between items-center">
                            <p className="px-2 line-clamp-1 w-[150px]">Sub-category</p>
                            <Select
                                value={subcategory}
                                options={subcategoryList}
                                onChange={handleSubcategoryChange}
                                isSearchable
                                placeholder="Select a Sub-category"
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
                        <div className="flex  py-1">
                            <p className="px-2 items-center">Color</p>
                            <input 
                            className='w-full py-1 px-2 rounded-md text-[#000000]'
                            onChange={(e) => {setColor(e.target.value)}} type="text" placeholder='Color' value={color}>
                            </input>
                        </div>
                        <div className="flex py-1 ">
                            <p className="px-2 items-center">Size</p>
                            <input 
                            className='w-full py-1 px-2 rounded-md text-[#000000]'
                            onChange={(e) => {setSize(e.target.value)}} type="text" placeholder='Size' value={size}>
                            </input>
                        </div>
                        <div className="flex py-1 ">
                            <p className="px-2 items-center">Description</p>
                            <input 
                            className='w-full py-1 px-2 rounded-md text-[#000000]'
                            onChange={(e) => {setDescription(e.target.value)}} type="text" placeholder='Description' value={description}>
                            </input>
                        </div>
                        <button
                            onClick={(e) =>{createNewItem(e)}}
                            className='py-1 px-2 bg-[#2B600F] rounded-md text-[#ffffff] w-full'>
                                Create New
                        </button>
        
                    </div>   

                </div>
            </div>
        </div>
    );
}
    export default CreateNewDataBaseItem;
