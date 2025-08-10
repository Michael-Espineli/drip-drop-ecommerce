import React, {useState, useEffect, useContext} from 'react';
import Select from 'react-select';
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where, setDoc, doc,Timestamp  } from "firebase/firestore";
import { db } from "../../../utils/config";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../../context/AuthContext";
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { id } from './../../../../node_modules/webpack/lib/util/concatenate';
import { Link, useParams } from 'react-router-dom';
import { FaChevronLeft } from "react-icons/fa";
import { ServiceLocation } from '../../../utils/models/ServiceLocation';

const functions = getFunctions();

const CreateNewRecurringContract = () => {
    const {customerId} = useParams();
    const {stripeConnectedAccountId, user, recentlySelectedCompany, recentlySelectedCompanyName} = useContext(Context);

    const [customerList, setCustomerList] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');

    const [productList, setProductList] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState('');

    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [serviceLocation, setServiceLocation] = useState('');

    const [pageCount, setPageCount] = useState(5);
    const [firstDoc, setFirstDoc] = useState();
    const [lastDoc, setLastDoc] = useState();

    const [chemType, setChemType] = useState('');
    const [notes, setNotes] = useState('');
    const [terms, setTerms] = useState('');
    const [laborType, setLaborType] = useState('');
    const [email, setEmail] = useState('Michaelespineli2000@gmail.com');
    const [rate, setRate] = useState('180');
    const [rateInterval, setRateInterval] = useState('');
    const [rateIntervalAmount, setRateIntervalAmount] = useState('');

    const [laborRate, setLaborRate] = useState('11');
    const [defaultPrice, setDefaultPrice] = useState('11');

     useEffect(() => {
        (async () => {
            if (customerList.length < 3) {
                
                try{
                    let q;
            
                        // q = query(collection(db, 'companies',recentlySelectedCompany,'customers'),limit(10));
                        q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"), where('active','==',true));

                    const querySnapshot = await getDocs(q);       
                    let count = 1   
                    setCustomerList([])      
                    querySnapshot.forEach((doc) => {
                        if (count == 1) {
                            setFirstDoc(doc)
                        } else {
                            setLastDoc(doc)
                        }
                        const customerDoc = doc.data()
                        const customerData = {
                            id:customerDoc.id,
                            name:customerDoc.firstName + ' ' + customerDoc.lastName,
                            streetAddress:customerDoc.billingAddress.streetAddress,
                            phoneNumber: customerDoc.phoneNumber,
                            email:customerDoc.email,
                            label:customerDoc.firstName + ' ' + customerDoc.lastName,
                        }
                        count = count + 1

                        setCustomerList(customerList => [...customerList, customerData]); 
                   
                    });
                    if (customerId != 'NA'){
                        console.log('Customer Selected')
                        querySnapshot.forEach((doc) => {
                            const customerDocData = doc.data()
                            if (customerDocData.id == customerId){
                                console.log('Found it')
                                console.log(customerDocData.id)

                                const customerData1 = {
                                    id:customerDocData.id,
                                    name:customerDocData.firstName + ' ' + customerDocData.lastName,
                                    streetAddress:customerDocData.billingAddress.streetAddress,
                                    phoneNumber: customerDocData.phoneNumber,
                                    email:customerDocData.email,
                                    label:customerDocData.firstName + ' ' + customerDocData.lastName,
                                }
                                console.log(customerData1)
                                setSelectedCustomer(customerData1)
                                console.log(customerData1.email)
                                setEmail(customerData1.email)
                            }
                        });                        
                        try{
                            let q;
                    
                                q = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'), where('customerId','==',customerId));
                            
                            const querySnapshot = await getDocs(q);       
                            let count = 1   
                            setServiceLocationList([])      
                            querySnapshot.forEach((doc) => {
            
                                const serviceLocationData = doc.data()
                                const serviceLocationDoc = {
                                    id:serviceLocationData.id,
                                    bodiesOfWaterId:serviceLocationData.bodiesOfWaterId,
                                    streetAddress:serviceLocationData.address.streetAddress,
                                    nickName: serviceLocationData.nickName,
                                    label:serviceLocationData.address.streetAddress + ' ' + serviceLocationData.address.city + ' ' +  serviceLocationData.address.state + ' ' + serviceLocationData.address.zip 
                                }
                                count = count + 1
                                setServiceLocationList(serviceLocationList => [...serviceLocationList, serviceLocationDoc]); 
                            });
                        } catch(error){
                            console.log('Error')
                        }
                    } else {
                        console.log('No Customer Selected')
                    }
                } catch(error){
                    console.log('Error')
                }
            }
            const getProductList = httpsCallable(functions, 'getProductList');
            getProductList({ 
                active: true,
                connectedAccount:stripeConnectedAccountId,
                method: "POST",
            })
            .then((result) => result.data.productList.data)            
            .then((list) => {
                setProductList([])
                list.forEach((doc) => {
                    //Here i wil have to do something to get the price options / default Price
                    doc.label = doc.name + ' ' + doc.description
                    setProductList(productList => [...productList, doc]); 

                })
                console.log('----- Product List ------')
                console.log(productList)
                
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
        })();

    },[])
    const handleCustomerChange = (selectedOption2) => {

        (async () => {
            console.log(`Option selected:`, selectedOption2);
            setSelectedCustomer(selectedOption2)
            console.log(selectedOption2.email)
            setEmail(selectedOption2.email)
            try{

                
                //   Get service Locations By Customer
           
                setServiceLocationList([])  
                let locationQuery = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'),where("customerId",'==',customerId));
     
                const locationSnapShot = await getDocs(locationQuery);    
                const serviceLocations = locationSnapShot.docs.map(doc => ServiceLocation.fromFirestore(doc));
                console.log("Received " + serviceLocations.length + " Service Locations");
                setServiceLocationList(serviceLocations)
                if (serviceLocations.length > 0 ){
                    setServiceLocation(serviceLocations[0])
                }
            } catch(error){
                console.log('Error')
            }
            
        })();
    };
    
    const handleProductChange = (selectedOption2) => {
        console.log(`Option selected:`, selectedOption2);
        setSelectedProduct(selectedOption2)
        //Get Default Price For Product
        const getDefaultPrice = httpsCallable(functions, 'getDefaultPrice');
        getDefaultPrice({ 
            priceId: selectedOption2.default_price,
            connectedAccount:stripeConnectedAccountId,
            method: "POST",
        })
        .then((result) => result.data.price)            
        .then((price) => {
            console.log(price)
            setDefaultPrice(price);  
            setRate(price.unit_amount/100)   
            setRateInterval(price.recurring.interval)
            setRateIntervalAmount(price.recurring.interval_count)
        })
        .catch((error) => {
            // Handle any errors
            console.error(error);
        });
    };
    const handleServiceLocationChange = (selectedOption2) => {
        console.log(`Option selected:`, selectedOption2);
        setServiceLocation(selectedOption2)

    };
    const handleLaborTypeChange = (event) => {

        (async () => {
            console.log('Change in setLaborType ' + event.target.value)
            setLaborType(event.target.value);
        })();
    }
    const handleChemTypeChange = (event) => {

        (async () => {
            console.log('Change in setChemType ' + event.target.value)
            setChemType(event.target.value);
        })();
    }

    async function submitContract(e) {
        e.preventDefault()
        //Guard Email For customer / client Id
        if (email != '') {
        
            let id = 'cont_' + uuidv4();

            console.log('Contract Submitted   ' + id)
            const currentTime = Timestamp.now();
            // if (defaultPrice.id != '') {
                let serviceLocationIdList = [];
                for (let i = 0; i < serviceLocation.length; i++) {
                    serviceLocationIdList.push(serviceLocation[i].id)
                }
                //Guard At Least one location Selected
                if (serviceLocationIdList.length != 0){
                await setDoc(doc(db, "contracts", id), {
                    chemType: chemType,
                    companyId: recentlySelectedCompany,
                    companyName: recentlySelectedCompanyName,
                    customerId: selectedCustomer.id,
                    customerName: selectedCustomer.name,
                    clientId: "wfqlrhuEyeahEpbf0MYY2UgHujE2", // Linked Client id?
                    dateSent: currentTime,
                    dateToAccept: currentTime,
                    id: id,
                    laborRate: parseInt(laborRate),
                    laborType: "",
                    locations: serviceLocationIdList.length,
                    notes: notes,
                    rate: parseInt(rate),
                    rateInterval:rateInterval,
                    rateIntervalAmount:rateIntervalAmount,
                    serviceLocationIds: serviceLocationIdList,
                    startDate:currentTime,
                    status: "Pending",
                    terms: terms,
                    // priceId: defaultPrice.id, 
                    // productId:selectedProduct.id,

                    priceId: 'price_1QJN3JPPLD20PPKnO8w5XHVa', 

                    productId:'acct_1QIep2PPLD20PPKn',
                    stripeCustomerId: "",
                    connectedAccountId: "",
                });
                console.log('Successfully Uploaded. ')
                            //Navigate Back to Contract PAGe
                // }
            }
        }
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
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div>
                    <div className='flex'>
                        <Link 
                        className='bg-[#454b39] rounded-md py-1 px-2 text-[#d0d2d6] justify-start items-center gap-3 flex'
                        to='/company/recurringContracts'>
                                <FaChevronLeft />
                                <p>
                                 Contract List
                                </p>                    
                        </Link>
                    </div>   
                    <p>Create New Recurring Service Contract</p>
                </div>
                <form>
                    
                    <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                        <div className='py-2'>

                            <Select
                                value={selectedCustomer}
                                options={customerList}
                                onChange={handleCustomerChange}
                                isSearchable
                                placeholder="Select a Customer"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'green',
                                    primary: 'black',
                                },
                                })}
                            />
                        </div>
                        <div className='flex justify-between gap-3 items-center py-2'>

                            <h1>Email : </h1>  

                            <input className="w-3/4 px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                            text-[#030811] focus:border-[#ededed] overflow-hidden" 
                            value={email}
                            onChange={(e) => {setEmail(e.target.value)}}
                            type="text" name='search' placeholder='Email'  />
                        </div>

                        <h1>Service Locations </h1>
                        <div className='py-2'>
                            <Select
                            value={serviceLocation}
                            options={serviceLocationList}
                            onChange={handleServiceLocationChange}
                            isSearchable
                            isMulti
                            placeholder="Select Service Location"
                            theme={(theme) => ({
                            ...theme,
                            borderRadius: 0,
                            colors: {
                                ...theme.colors,
                                primary25: 'green',
                                primary: 'black',
                            },
                            })}
                            />
                        </div>
                        <div className='py-2'>
                            <Select
                            value={selectedProduct}
                            options={productList}
                            onChange={handleProductChange}
                            isSearchable
                            placeholder="Select a Product"
                            theme={(theme) => ({
                            ...theme,
                            borderRadius: 0,
                            colors: {
                                ...theme.colors,
                                primary25: 'green',
                                primary: 'black',
                            },
                            })}
                            />
                        </div>
                        
                        <div className='flex justify-between gap-3 items-center py-2'>

                            <h1>Rate: </h1>  
                            <input 
                            value={rate}
                            onChange={(e) => {setRate(e.target.value)}}
                            className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                            text-[#030811] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Rate'  />
                        </div>
                        <div className='flex justify-between'>
                            <h1>Rate Type : </h1>  
                            <p>{rateInterval}</p>
                            <p>{rateIntervalAmount}</p>
                        </div>
                        <p>Offer how many times to Clean the pool</p>
                        <div className='flex justify-between gap-3 items-center py-2'>
                            <h1>Chem Type : </h1>    

                            <select 
                            value={chemType } onChange={(e) => handleChemTypeChange(e)}
                            className='p-2 rounded-md bg-[#ededed] text-[#030811]'>
                                <option value="5">All Inclusive</option>
                                <option value="10">Without Chems</option>
                                <option value="25">Includes Specific Chems</option>
                                <option value="50">Excludes Specific Chems</option>
                            </select>
                        </div>
                        <hr/>
                        <p className='text-xs'><bold className='font-bold text-base'>Internal Notes</bold> ( Your client will not see these )</p>
                        <div className='flex justify-between gap-3 items-center py-2'>

                            <p className='flex justify-between gap-3 items-center'>Labor Rate: </p>  

                            <input 
                            value={laborRate}
                            onChange={(e) => {setLaborRate(e.target.value)}}
                            className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                            text-[#030811] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Labor Rate'  />
                        </div>
                        <div className='flex justify-between gap-3 items-center py-2'>

                            <h1>laborType : </h1>    

                            <select 
                            value={laborType} onChange={(e) => handleLaborTypeChange(e)}
                            className='p-2 rounded-md bg-[#ededed] text-[#030811]'>
                                <option value="5">per Stop</option>
                                <option value="10">per Week</option>
                                <option value="25">per Month</option>
                            </select>
                        </div>  
                        <h1>Internal Notes : </h1>  
                        <textarea className="w-full px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#030811] focus:border-[#ededed] overflow-hidden resize-y" type="text" name='search' placeholder='Internal Notes'/>
                        <button onClick={(e) => submitContract(e)} className='w-full mt-7 bg-[#2B600F] rounded-md py-1 px-2'>Offer</button>
                    </div>  
                </form>  
            </div>    
        </div>
    );
};

export default CreateNewRecurringContract;