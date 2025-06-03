import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, setDoc, collection, getDocs, orderBy } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { useNavigate } from 'react-router-dom';
import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
// import { console } from "inspector";
import toast from 'react-hot-toast';

const CreateNewPurchase = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const navigate = useNavigate()

    // Purchase Fields
    const [showSidebar, setShowSidebar] = useState();
    
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

    const [notes,setNotes] = useState('')
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
    // Add new Data Base Items
    
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

        function formatCurrency(number, locale = 'en-US', currency = 'USD') {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency
            }).format(number);
        }

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
                let genericItemQuery = query(collection(db, "companies",recentlySelectedCompany,'settings','dataBase','dataBase'), orderBy('name') );
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
                        label: itemData.name + ' - ' + formatCurrency(itemData.rate/100) + ' - ' + itemData.sku
                    }
                    setGenericItemList(genericItemList => [...genericItemList, genericItem]); 
                });

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
    

    async function createNewDBItem(e) {
        e.preventDefault()
    }

    async function showSideBar(e) {
        e.preventDefault()
        setShowSidebar(true)
    }

    async function closeSideBar(e) {
        e.preventDefault()
        setShowSidebar(false)
    }


    async function addNewItem(e) {
        e.preventDefault()
        
        toast.dismiss()
        let rate = parseFloat( selectedGenericItem.rate)/100//Need to Change to *100. because I store all numbers as cents, rather than dollars
        let quantityFloat = parseFloat( quantity)

        let totalCost = rate*quantityFloat

        let id = "comp_pi_" + uuidv4()

        let newItem = {
            id: id,
            sku: selectedGenericItem.sku,
            itemId: selectedGenericItem.id,
            name: selectedGenericItem.name,
            billable: selectedGenericItem.billable,
            rate: rate.toFixed(2),
            quantity: quantityFloat,
            description: selectedGenericItem.description,
            totalCost: totalCost.toFixed(2),
            category:selectedGenericItem.category,
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
        let receiptId = 'com_rec_' + uuidv4()

        let cost = 0
        for (let i = 0; i < purchaseItemlist.length; i++) {
            let item = purchaseItemlist[i]
            
            console.log('Added Item ' + item)

            cost = cost + parseFloat(item.totalCost)
            let price = Math.floor(parseFloat(item.rate*100))
            let priceBillable = Math.floor(parseFloat(item.billable*100))
            let purchaseItem = {
                id : item.id,
                receiptId : receiptId,
                invoiceNum : refrence,
                venderId : selectedVender.id,
                venderName : selectedVender.name,
                techId : selectedUser.id,
                techName : selectedUser.userName,
                itemId: item.itemId,
                name: item.name,
                price: price,
                billable: item.billable,
                billingRate: priceBillable,
                invoiced: false,
                returned: false,
                quantityString: item.quantity,
                date : purchaseDate,
                customerId : "",
                customerName : "",
                category:item.category,
                sku : item.sku,
                notes : notes,
                description : item.description,
                jobId : "",
            }
            console.log(purchaseItem)
            await setDoc(doc(db,"companies",recentlySelectedCompany,"purchasedItems",item.id),purchaseItem);
        }
        console.log(cost*100)
        cost = Math.floor(parseFloat(cost*100))
        let costAfterTax = Math.floor(parseFloat(cost*1.085))

        console.log('Added Receipt ' + receiptId)
        let receipt = {
            id : receiptId,
            invoiceNum : refrence,
            date : purchaseDate,
            storeId : selectedVender.id,
            storeName : selectedVender.name,
            techId : selectedUser.id,
            techName : selectedUser.userName,
            purchasedItemIds : [],
            numberOfItems : '',
            cost : cost,
            costAfterTax : costAfterTax,
            pdfUrlList : [],
        }
        console.log(receipt)
        await setDoc(doc(db,"companies",recentlySelectedCompany,"receipts", receiptId),receipt );
        navigate('/company/receipts/detail/' + receiptId)
    }


    //Add new Database Item
    
    
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
    
            console.log('Added New Item ' + id)

            let rateCents = Math.floor(parseFloat(rateUSD*100))

            let billingRateCents = Math.floor(parseFloat(billingRateUSD*100))
            let item = {

                UOM : uom.label,
                id : id,
                billable : billable,
                category : category.label,
                color : color,
                dateUpdated : new Date(),
                description : description,
                name : itemName,
                rate : rateCents,
                size : size,
                sku : sku, 
                storeName : "",
                subCategory : "",
                timesPurchased : 0,
                venderId : "",
                billingRate : billingRateCents
                
            }

            console.log(item)

            console.log('2')

            await setDoc(doc(db,"companies",recentlySelectedCompany,"settings",'dataBase','dataBase', id), item);

            console.log('3')

            setItemName('')
            setBillable(false)
            setRate('')
            setRateUSD('')
            setBillingRate('')
            setBillingRateUSD('')
            setSku('')
            setUom('')
            setCategory('')
            setSubcategory('')
            setColor('')
            setDescription('')
            setSize('')
            console.log('New Item Created')
            //Get Generic Data Base Items
            let genericItemQuery = query(collection(db, "companies",recentlySelectedCompany,'settings','dataBase','dataBase'));

            const genericItemQuerySnapshot = await getDocs(genericItemQuery);    
              
            setGenericItemList([])

            genericItemQuerySnapshot.forEach((doc) => {
                const itemData = doc.data()
                const genericItem = {
                    id : itemData.id,
                    UOM : itemData.id,
                    billable : itemData.billable,
                    category : itemData.category,
                    color : itemData.color,
                    dateUpdated : itemData.dateUpdated,
                    description : itemData.description,
                    name : itemData.name,
                    rate : itemData.rate,
                    size : itemData.size,
                    sku : itemData.sku,
                    storeName : itemData.storeName,
                    subCategory : itemData.subCategory,
                    timesPurchased : itemData.timesPurchased,
                    venderId : itemData.venderId,
                    label: itemData.name + ' - ' + formatCurrency(itemData.rate/100) + ' - ' + itemData.sku
                }
                setGenericItemList(genericItemList => [...genericItemList, genericItem]); 
            });
            console.log('Got New Items')

            toast.dismiss()
            setShowSidebar(false)

        } catch(error){
            console.log('Error From Create New Data Base Item')
            console.log(error)
        }
    }

    return (
        // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white // secondary white cfcfcf
        // 1D2E76 - Pool Blue
        // 0e245c
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green
        // 919191 - gray
        <div className='px-2 md:px-7 py-5'>
            <div className={` ${!showSidebar ? '' : ''} lg:flex`}>
                <div className={` ${!showSidebar ? 'hidden' : 'visible duration-200 w-1/4 sm:w-2/3 shadow-md shadow-[#000000] p-2 bg-[#0e245c] text-[#cfcfcf] rounded-md'} lg:absolute z-141 lg:top-100 lg:right-10 `}>
                    <button 
                    onClick={(e) => closeSideBar(e)}
                    className="py-1 px-2 bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000]">
                        Close
                    </button>
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

                <div className={` ${!showSidebar ? 'w-full' : 'w-2/3 sm:invisible'} flex justify `}>
                    <div className='w-full'>
                        <div className='py-2 flex justify-between'>
                            <Link 
                            className='py-1 px-2 bg-[#0e245c] rounded-md py-1 px-2 text-[#d0d2d6]'
                            to={`/company/purchasedItems`}>
                                Back
                            </Link>
                            <div className="">
                                <button
                                className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'
                                onClick={(e) => submitReceipt(e)} 
                                >Submit</button>

                            </div>
                        </div>
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#ffffff]'>
                            Use Quickbooks as template Purchase
                            <div className='left-0 w-full justify-between'>
                                <h2>Create New Receipt</h2>
                                <form className='gap-2'>
                                    <div className='flex justify-between w-full items-center gap-2 text-[#000000]'>
                                        <h2 className="text-[#ffffff]">Purchase Date</h2>
                                        <div>
                                            <DatePicker 
                                                showIcon
                                                selected={purchaseDate} 
                                                onChange={(purchaseDate) => handlePurchaseDateChange(purchaseDate)}
                                                icon={
                                                  <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    width="1em"
                                                    height="1em"
                                                    viewBox="0 0 48 48"
                                                  >
                                                    <mask id="ipSApplication0">
                                                      <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="4">
                                                        <path strokeLinecap="round" d="M40.04 22v20h-32V22"></path>
                                                        <path
                                                          fill="#fff"
                                                          d="M5.842 13.777C4.312 17.737 7.263 22 11.51 22c3.314 0 6.019-2.686 6.019-6a6 6 0 0 0 6 6h1.018a6 6 0 0 0 6-6c0 3.314 2.706 6 6.02 6c4.248 0 7.201-4.265 5.67-8.228L39.234 6H8.845l-3.003 7.777Z"
                                                        ></path>
                                                      </g>
                                                    </mask>
                                                    <path
                                                      fill="currentColor"
                                                      d="M0 0h48v48H0z"
                                                      mask="url(#ipSApplication0)"
                                                    ></path>
                                                  </svg>
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className='flex justify-between w-full items-center gap-2'>
                                            <h2>Refrence</h2>
                                            <input 
                                            className='w-full py-1 px-2 rounded-md mt-2 text-[#000000]'
                                            onChange={(e) => {setRefrence(e.target.value)}} type="text" placeholder='Refrence' value={refrence}></input>
                                            
                                    </div>
                                    
                                    
                                    <div className='flex justify-between w-full items-center gap-2'>
                                            <h2>Notes</h2>
                                            <input 
                                            className='w-full py-1 px-2 rounded-md mt-2 text-[#000000]'
                                            onChange={(e) => {setNotes(e.target.value)}} type="text" placeholder='Notes' value={notes}></input>
                                            
                                    </div>

                                    <div className='flex justify-between w-full items-center gap-2'>
                                        <div className='w-full'>
                                            <h1>Store</h1>
                                            <Select
                                                value={selectedVender}
                                                options={venderList}
                                                onChange={handleSelectedVenderChange}
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
                                    <hr className='mt-2'/>

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
                                    <div className='flex justify-between items-center py-1'>
                                        <div className='w-full px-1'>
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
                                        <div className="px-2 w-full">
                                            <input 
                                            className='w-full py-1 px-2 rounded-md text-[#000000]'
                                            onChange={(e) => {setQuantity(e.target.value)}} type="text" placeholder='Quantity' value={quantity}>

                                            </input>

                                        </div>
                                        <div className="px-2">
                                        <button
                                        onClick={(e) => showSideBar(e)}
                                        className='py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff]'

                                            >Create New Item</button>
                                        </div>
                                    </div>
                                    <div className='flex justify-between w-full items-center gap-2'>
                                        <div className='w-full'>
                                            <button
                                            onClick={(e) => addNewItem(e)}
                                            className='w-full py-1 px-2 rounded-md bg-[#2B600F] text-[#ffffff] mt-2'
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
    export default CreateNewPurchase;
