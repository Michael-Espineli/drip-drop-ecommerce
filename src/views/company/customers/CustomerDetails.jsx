

import React, {useState, useEffect, useContext} from 'react';
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, updateDoc , deleteDoc, doc, getDoc, where } from "firebase/firestore";
import { db } from '../../../utils/config'
import { getAuth } from "firebase/auth";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';


const CustomerDetails = () => {
    const navigate = useNavigate()
    
    const {name,recentlySelectedCompany} = useContext(Context);

    const {customerId} = useParams();
    const [edit,setEdit] = useState(false);

        // Customer Info
    const [customer,setCustomer] = useState({
        firstName : '',
        lastName : '',
        phoneNumber : '',
        email : '',
        billingStreetAddress : '',
        billingCity : '',
        billingState : '',
        billingZip : '',
        billingNotes : '',
        displayAsCompany : '',
        company : '',
        verified : false,
        hireDate : '',
        active : true,
        notes : '',
    });

    // Edit Customer
    const [firstName,setFirstName] = useState('');
    const [lastName,setLastName] = useState('');
    const [phoneNumber,setPhoneNumber] = useState('');
    const [email,setEmail] = useState('');
    const [billingStreetAddress,setBillingStreetAddress] = useState('');
    const [billingCity,setBillingCity] = useState('');
    const [billingState,setbillingState] = useState('');
    const [billingZip,setbillingZip] = useState('');

    const [billingNotes,setbillingNotes] = useState('');
    const [displayAsCompany,setdisplayAsCompany] = useState('');
    const [company,setcompany] = useState(false);
    const [verified,setverified] = useState(false);
    const [active,setactive] = useState(true);
    const [notes,setnotes] = useState('');

    // contracts
    const [contractList, setContractList] = useState([]);

    // service Locations
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [selectedServiceLocation,setSelectedServiceLocation] = useState({
        id:'',
        customerName: '',
        label: '',
        streetAddress:'',
        bodiesOfWaterId:[]
    });

    // Bodies Of Water
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [selectedBodyOfWater,setSelectedBodyOfWater] = useState({
        id : '',
        customerId : '',
        depth : '',
        gallons : '',
        material : '',
        name : '',
        notes : '',
        serviceLocationId : '',
        label : ''
    });
    // Bodies Of Water
    const [equipmentList, setEquipmentList] = useState([]);
    const [selectedEquipment,setEelectedEquipment] = useState({
        id:'',
        customerName: '',
        streetAddress:'',
        bodiesOfWaterId:[]
    });
    //Recurring Service Stop 
    const [recurringServiceStopList, setRecurringServiceStopList] = useState([]);


    const editCustomer = (event) => {
        setEdit(true);
    } 
    const cancelEditCustomer = (event) => {
        setEdit(false);
    }
    async function deleteCustomer(e) {
        e.preventDefault()
        try{
            await deleteDoc(doc(db, "companies",recentlySelectedCompany,'customers',customerId));
            navigate('/company/customers')
            } catch(error){
                console.log('Error')
            }
    }

    async function saveCustomer(e) {
        e.preventDefault()        //Update Local Customer
        setCustomer((prevCustomer) => ({
            ...prevCustomer,
            firstName: firstName,
            lastName: lastName,
            phoneNumber: phoneNumber,
            email: email,
            billingStreetAddress: billingStreetAddress,
            billingCity : billingCity,
            billingState : billingState,
            billingZip : billingZip
        }));
        
        setEdit(false);
        
        //Update Firebase Function

        const docRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
        console.log('Save Edit Changes')

        await updateDoc(docRef, {
            firstName: firstName,
            lastName: lastName,
            phoneNumber: phoneNumber,
            email: email,
            billingStreetAddress: billingStreetAddress,
            billingCity : billingCity,
            billingState : billingState,
            billingZip : billingZip

        });
    } 
    useEffect(() => {
        (async () => {
            try{
                // Get Customer Info
                const docRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    setCustomer((prevCustomer) => ({
                        ...prevCustomer,
                        firstName: docSnap.data().firstName,
                        lastName: docSnap.data().lastName,
                        phoneNumber: docSnap.data().phoneNumber,
                        email: docSnap.data().email,
                        billingStreetAddress : docSnap.data().billingAddress.streetAddress,
                        billingCity : docSnap.data().billingAddress.city,
                        billingState : docSnap.data().billingAddress.state,
                        billingZip : docSnap.data().billingAddress.zip,
                        billingNotes : docSnap.data().billingNotes,
                        active : docSnap.data().active,
                        verified : docSnap.data().verified,
                    }));
                    setFirstName(docSnap.data().firstName)
                    setLastName(docSnap.data().lastName)
                    setPhoneNumber(docSnap.data().phoneNumber)
                    setEmail(docSnap.data().email)
                    setBillingStreetAddress(docSnap.data().billingAddress.streetAddress)
                    setBillingCity(docSnap.data().billingAddress.city)
                    setbillingState(docSnap.data().billingAddress.state)
                    setbillingZip(docSnap.data().billingAddress.zip)

                  } else {
                    console.log("No such document!");
                  }
                //   Get Contracts By Customer
                let q;
                q = query(collection(db, 'contracts'), where("companyId",'==',recentlySelectedCompany),where("customerId",'==',customerId));
            
                const querySnapshot = await getDocs(q);       
                setContractList([])      
                querySnapshot.forEach((doc) => {
                    const contractData = doc.data()
                    const contract = {
                        id:contractData.id,
                        priceId:contractData.priceId,
                        companyName:contractData.companyName,
                        customerName: contractData.customerName,
                        rate:contractData.rate
                    }
                    console.log('contract')
                    console.log(contract)
                    setContractList(contractList => [...contractList, contract]); 
                });
                
                //   Get serviceLocations By Customer

                let q1;
                q1 = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'),where("customerId",'==',customerId));
            
                const querySnapshot1 = await getDocs(q1);       
                setServiceLocationList([])      
                let workingServiceLocationList = []    
                querySnapshot1.forEach((doc) => {
                    const serviceLocationData = doc.data()
                    const serviceLocation = {
                        id:serviceLocationData.id,
                        customerName: serviceLocationData.customerName,
                        streetAddress:serviceLocationData.address.streetAddress,
                        bodiesOfWaterId:serviceLocationData.bodiesOfWaterId,
                        label:serviceLocationData.address.streetAddress

                    }
                    console.log('serviceLocation')
                    console.log(serviceLocation)
                    workingServiceLocationList.push(serviceLocation)
                    setServiceLocationList(serviceLocationList => [...serviceLocationList, serviceLocation]); 
                });

                //Check to see if serviceLocation is not empty
                if (workingServiceLocationList.length>0) {
                    setSelectedServiceLocation(workingServiceLocationList[0])
                }

                //Check if selectedServiceLocation Exists
                if (workingServiceLocationList.length>0) {

                    let q2;
                    q2 = query(collection(db, 'companies',recentlySelectedCompany,'bodiesOfWater'),where("serviceLocationId",'==',workingServiceLocationList[0].id));
                
                    const querySnapshot2 = await getDocs(q2);   
                    let workingBodyOfWaterList = []    
                    setBodyOfWaterList([])      
                    querySnapshot2.forEach((doc) => {
                        const bodyOfWaterData = doc.data()
                        const bodyOfWater = {
                            id : bodyOfWaterData.id,
                            customerId : bodyOfWaterData.customerId,
                            depth : bodyOfWaterData.depth,
                            gallons : bodyOfWaterData.gallons,
                            material : bodyOfWaterData.material,
                            name : bodyOfWaterData.name,
                            notes : bodyOfWaterData.notes ?? "",
                            serviceLocationId : bodyOfWaterData.serviceLocationId,
                            label : bodyOfWaterData.name 
                        }
                        workingBodyOfWaterList.push(bodyOfWater)
                        console.log('bodyOfWater')
                        console.log(bodyOfWater)
                        setBodyOfWaterList(bodyOfWaterList => [...bodyOfWaterList, bodyOfWater]); 

                        if (workingBodyOfWaterList.length>0) {
                            setSelectedBodyOfWater(workingBodyOfWaterList[0])
                        }
                    });
                }
                
                let q5 = query(collection(db, 'companies',recentlySelectedCompany,'recurringServiceStop'),where('customerId','==',customerId));
                const querySnapshot5 = await getDocs(q5);       
                setRecurringServiceStopList([])
                querySnapshot5.forEach((doc) => {
                    const rssData = doc.data()
                    const rss = {
                        id:rssData.id,
                        internalId : rssData.internalId,
                        type:rssData.type,
                        typeId:rssData.typeId,
                        typeImage: rssData.typeImage,
                        customerId:rssData.customerId,
                        customerName: rssData.customerName,

                        streetAddress:rssData.address.streetAddress,
                        city:rssData.address.city,
                        state:rssData.address.state,
                        zip:rssData.address.zip,
                        latitude:rssData.address.latitude,
                        longitude:rssData.address.longitude,

                        tech:rssData.tech,
                        techId:rssData.techId,
                        dateCreated:rssData.dateCreated,
                        startDate:rssData.startDate,
                        endDate:rssData.endDate,
                        noEndDate:rssData.noEndDate,
                        frequency:rssData.frequency,
                        daysOfWeek:rssData.daysOfWeek,
                        lastCreated:rssData.lastCreated,

                        serviceLocationId:rssData.serviceLocationId,
                        estimatedTime:rssData.estimatedTime,
                        otherCompany:rssData.otherCompany,
                        laborContractId:rssData.laborContractId,
                        contractedCompanyId:rssData.contractedCompanyId
                    }
                    setRecurringServiceStopList(recurringServiceStopList => [...recurringServiceStopList, rss]); 
                });
                console.log('Successful')
            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    const handleServiceLocationChange = (selectedOption2) => {

        (async () => {
            if (selectedOption2.id!==''){

                let q2;
                q2 = query(collection(db, 'companies',recentlySelectedCompany,'bodiesOfWater'),where("serviceLocationId",'==',selectedOption2.id));
            
                const querySnapshot2 = await getDocs(q2);       
                setBodyOfWaterList([])      
                querySnapshot2.forEach((doc) => {
                    const bodyOfWaterData = doc.data()
                    const bodyOfWater = {
                        id : bodyOfWaterData.id,
                        customerId : bodyOfWaterData.customerId,
                        depth : bodyOfWaterData.depth,
                        gallons : bodyOfWaterData.gallons,
                        material : bodyOfWaterData.material,
                        name : bodyOfWaterData.name,
                        notes : bodyOfWaterData.notes,
                        serviceLocationId : bodyOfWaterData.serviceLocationId,
                        label : bodyOfWaterData.name
                    }
                    console.log('bodyOfWater')
                    console.log(bodyOfWater)
                    setBodyOfWaterList(bodyOfWaterList => [...bodyOfWaterList, bodyOfWater]); 
                    setSelectedBodyOfWater(bodyOfWaterList[0])

                });
            }
        })();
    };
    const handleBodyOfWaterChange = (selectedOption2) => {
        (async () => {

            if (selectedOption2.id!==''){
                console.log(selectedOption2)
                setSelectedBodyOfWater({
                    id : selectedOption2.id,
                    customerId : selectedOption2.customerId,
                    depth : selectedOption2.depth,
                    gallons : selectedOption2.gallons,
                    material : selectedOption2.material,
                    name : selectedOption2.name,
                    notes : selectedOption2.notes??"",
                    serviceLocationId : selectedOption2.serviceLocationId,
                    label : selectedOption2.name 
                })
            }
        })();
    };
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
                        
            <div className='w-full flex flex-wrap mt-7'>
                <div className='w-full lg:pr-3'> 
                    <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                        {
                            edit ? <div className='px-4 py-1'>
                                <div className='w-full flex justify-between py-1'>
                                    <button onClick={(e) =>{saveCustomer(e)}} className='bg-[#82D173] cursor-pointer font-normal rounded'><h1 className='font-bold text-[#cfcfcf] px-4 py-1 text-base'>Save</h1></button>
                                    <button onClick={(e) =>{cancelEditCustomer(e)}} className='bg-[#9C0D38] cursor-pointer rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Cancel</h1></button>
                                </div>
                                <div className='w-full flex justify-between py-1'>
                                    <button 
                                    // onClick={(e) =>{deleteCustomer(e)}} 
                                    onClick={(e) => deleteCustomer(e)}
                                    className='bg-[#9C0D38] cursor-pointer rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Delete</h1></button>
                                </div>
                            </div> : <div className='w-full flex justify-between'>
                            <h1></h1>
                            <button onClick={(e) =>{editCustomer(e)}} className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Edit</h1></button>
                        </div>
                        }
                        <h1 className='font-bold text-[#cfcfcf] text-xl'>Customer Information</h1>

                        {
                            edit ? <div>
                                <div className='w-full flex justify-between gap-2'>
                                    <div className='flex flex-col w-full gap-1 mb-2'>
                                        <label htmlFor='name'>First Name</label>
                                    <input value={firstName} onChange={(e) => {setFirstName(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                        border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='First Name'/>
                                    </div>
                                    <div className='flex flex-col w-full gap-1 mb-2'>
                                        <label htmlFor='name'>Last Name</label>
                                    <input value={lastName} onChange={(e) => {setLastName(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                        border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='Last Name'/>
                                    </div>
                                </div>
                                <div className='flex flex-col w-full gap-1 mb-2'>
                                    <label htmlFor='name'>Phone Number</label>
                                    <input value={phoneNumber} onChange={(e) => {setPhoneNumber(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                    border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='Phone Number'/>
                                </div>
                                <div className='flex flex-col w-full gap-1 mb-2'>
                                    <label htmlFor='name'>Email</label>
                                    <input value={email} onChange={(e) => {setEmail(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                    border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='Email'/>
                                </div>
    
                            </div> : 
                            <div className='text-[#cfcfcf]'>
                                <p>{customer.firstName} {customer.lastName}</p>
                                <p>{customer.phoneNumber}</p>
                                <p>{customer.email}</p>
                            </div>
                        }

                    </div>
                </div>
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:w-7/12 lg:pr-3'> 
                        <div className='w-full h-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                        <h1 className='font-bold text-[#cfcfcf]'>Billing Address</h1>
                        {
                            edit ? <div>
                                <div className='flex flex-col w-full gap-1 mb-2'>
                                    <label htmlFor='name'>Street Address</label>
                                    <input value={billingStreetAddress} onChange={(e) => {setBillingStreetAddress(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                    border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='Street Address'/>
                                </div>
                                <div className='flex flex-col w-full gap-1 mb-2'>
                                    <label htmlFor='name'>City</label>
                                    <input value={billingCity} onChange={(e) => {setBillingCity(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                        border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='City'/>
                                </div>
                                <div className='flex flex-col w-full gap-1 mb-2'>
                                    <label htmlFor='name'>State</label>
                                    <input value={billingState} onChange={(e) => {setbillingState(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                        border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='State'/>
                                </div>
                                <div className='flex flex-col w-full gap-1 mb-2'>
                                    <label htmlFor='name'>Zip</label>
                                    <input value={billingZip} onChange={(e) => {setbillingZip(e.target.value)}} className='p-1 focus:border-indigo-500 outline-none bg-[#ededed] 
                                        border border-slate-700 rounded-md text-[#000000]' type="text" id='name' placeholder='Zip'/>
                                </div>
                            </div> : 
                            <button                 
                            onClick={async () => {
                                    const address = billingStreetAddress + ' ' + billingCity + ' ' + billingState + ' ' + billingZip
                                    const urlAddress = address.replace(" ", "+")
                                    const url = 'https://www.google.com/maps/place/' + urlAddress
                
                                    if (url) {
                                        window.location.href = url;
                                    }
                                }}>
                                <div className='text-[#cfcfcf]'>
                                    <p>{customer.billingStreetAddress}</p>
                                    <div className='w-full flex justify-between gap-2'>
                                        <p>{customer.billingCity}</p>
                                        <p>{customer.billingState}</p>
                                        <p>{customer.billingZip}</p>
                                    </div>
                                </div>
                            </button>
                        }
                        </div>
                    </div>
                    <div className='w-full lg:w-5/12 lg:pr-3'>  
                        <div className='w-full h-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <h1 className='font-bold text-[#cfcfcf]'>Billing Notes</h1>
                            <p>{customer.billingNotes}</p>
                            <h1 className='font-bold text-[#cfcfcf]'>Notes</h1>
                            <p>{customer.notes}</p>
                            <p>{customer.active ? 'true':'false'}</p>
                            <p>{customer.verified ? 'true':'false'}</p>
                        </div>
                    </div>
                </div>

                {/* Money */}
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                        <h1 className='font-bold text-[#cfcfcf]'>Money</h1>
                        </div>
                    </div>
                </div>

                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                            <h1 className='font-bold text-[#cfcfcf]'>Contracts - {contractList.length}</h1>
                            <Link 
                            className='bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000]'
                            to={`/company/contracts/createNew/${customerId}`}>Offer New Contract</Link>
                           
                            <ul className='py-2'>
                                {
                                    contractList?.map((n,i) =>(
                                        <li key={i}>
                                            <p className='text-[#000000]'>{n.rate}</p>
                                        </li>
                                    ))
                                }
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Service Location */}
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                            <div className='flex justify-between items-center'>
                                <h1 className='font-bold'>Service Locations - {serviceLocationList.length}</h1>
                          
                                <button className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>Add New</button>
                            </div>
                      
                            <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                    <tr>
                                        <th className='py-3 px-4'>customer Name</th>
                                        <th className='py-3 px-4'>Street Address</th>
                                        <th className='py-3 px-4'>bodies Of Water</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {
                                        serviceLocationList?.map((n,i) => (
                                            <tr key={n.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{n.customerName}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{n.streetAddress}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{n.bodiesOfWaterId.length}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>Select</td>
                                            </tr>
                                        ))
                                    }
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                { 
                    (serviceLocationList.length!==0)&&
                    <div className='w-full flex flex-wrap mt-7 '>
                        <div className='flex justify-between items-center'>
                            <div className='py-2'>
                                <Select
                                    value={selectedServiceLocation}
                                    options={serviceLocationList}
                                    onChange={handleServiceLocationChange}
                                    isSearchable
                                    placeholder="Select a Service Location"
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
                        </div>
                    </div>
                }
                {/* Bodies Of Water */}

                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='flex justify-between items-center text-[#d0d2d6]'>

                                <h1 className='font-bold text-[#cfcfcf]'>Bodies Of Water - {bodyOfWaterList.length}</h1>

                                <button className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>Add New</button>
                            </div>
                            <ul className='py-2'>
                                {
                                    bodyOfWaterList?.map((n,i) =>(
                                        <li className='' key={i}>
                                            <p>{n.label}</p>
                                        </li>
                                    ))
                                }
                            </ul>
                        </div>
                    </div>
                </div>
                { 
                    (bodyOfWaterList.length!==0)&&
                    <div className='w-full flex flex-wrap mt-7 '>
                        <div className='flex justify-between items-center'>
                            <div className='py-2'>
                                <Select
                                    value={selectedBodyOfWater}
                                    options={bodyOfWaterList}
                                    onChange={handleBodyOfWaterChange}
                                    isSearchable
                                    placeholder="Select a Body Of Water"
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
                        </div>
                    </div>
                }

                {/* Equipment */}
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='flex justify-between items-center text-[#d0d2d6]'>

                                <h1 className='font-bold text-[#cfcfcf]'>Equipment</h1>
                                <button className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>Add New</button>
                            </div>

                            <div className='flex justify-between py-2'>
                                <p>Equipment Info</p>
                                <button className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>See Details</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Work Orders */}
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                        <h1 className='font-bold text-[#cfcfcf]'>Work Orders</h1>
                        </div>
                    </div>
                </div>

                {/* Recurring Service Stops */}
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='flex justify-between items-center text-[#cfcfcf]'>
                                <h1 className='font-bold text-[#cfcfcf]'>Recurring Service Stops</h1>
                                <Link to={`/company/recurringServiceStop/createNew/${customerId}`}>
                                    <h1 className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>
                                        Add New 
                                    </h1>
                                </Link>
                            </div>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                        <tr>
                                            <th className='py-3 px-4'>Customer Name</th>
                                            <th className='py-3 px-4'>Street Address</th>
                                            <th className='py-3 px-4'>Tech Name</th>
                                            <th className='py-3 px-4'>Day</th>
                                            <th className='py-3 px-4'>Frequency</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    {
                                        recurringServiceStopList?.map(rss => (
                                            <tr key={rss.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.customerName}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.streetAddress}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.tech}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.daysOfWeek[0]}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.frequency}</Link></td>
                                            </tr>
                                        ))
                                    }
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            
            </div>
        </div>
    );
};

export default CustomerDetails;