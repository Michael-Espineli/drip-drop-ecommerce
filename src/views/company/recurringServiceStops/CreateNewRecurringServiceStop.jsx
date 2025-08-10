import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, where, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
import { format } from 'date-fns'; 
import { getFunctions, httpsCallable } from 'firebase/functions';

const CreateNewRecurringServiceStop = () => {

    const {name,recentlySelectedCompany} = useContext(Context);

    const functions = getFunctions();
    
    const { customerId } = useParams();
    
    const navigate = useNavigate()
    
    const [type, setType] = useState("");
    
    const [typeId, setTypeId] = useState("");
    
    const [typeImage, setTypeImage] = useState("");

    const [customer, setCustomer] = useState({
        id:"",
        name:"",
        label:"Select Customer"
    });
    
    const [customerName, setCustomerName] = useState("");
    
    // service Locations

    const [serviceLocation,setServiceLocation] = useState({
        id:'',
        customerName: '',
        streetAddress:'',
        city:'',
        state:'',
        zip:'',
        latitude:0,
        longitude:0,
        label:'Select a Service Location',
        bodiesOfWaterId:[]
    });
    
    const [streetAddress, setStreetAddress] = useState("");
    
    const [city, setCity] = useState("");
    
    const [state, setState] = useState("");
    
    const [zip, setZip] = useState("");
    
    // service Locations
    const [techList, setTechList] = useState([]);

    const [tech,setTech] = useState({
        dateCreated : '',
        linkedCompanyId : '',
        id : '',
        linkedCompanyName : '',
        roleId : '',
        roleName : '',
        status : '',
        userId : '',
        userName : '',
        workerType : '',
        label : 'Select a Technician',
    });
    
    const [techId, setTechId] = useState("");
    
    const [techName, setTechName] = useState("");
    
    const [frequency, setFrequency] = useState("");
    
    const [frequencyName, setFrequencyName] = useState("");
    
    const [daysOfWeek, setDaysOfWeek] = useState("");
    
    const [daysOfWeekName, setDaysOfWeekName] = useState("");
    
    const [noEndDate, setNoEndDate] = useState(true);
    
    const [description, setDescription] = useState("");
    
    const [startDate, setStartDate] = useState(new Date());
    
    const [formattedStartDate,setFormattedStartDate] = useState('')
    
    const [endDate, setEndDate] = useState(new Date());
    
    const [formattedEndDate,setFormattedEndDate] = useState('')

    //Select Lists
    const [typeList, setTypeList] = useState([]);

    const [serviceLocationList, setServiceLocationList] = useState([]);

    const [dayList, setDayList] = useState([
        {
            id:"1",
            label:"Sunday"
        }
        ,
        {
            id:"2",
            label:"Monday"
        }
        ,
        {
            id:"3",
            label:"Tuesday"
        }
        ,
        {
            id:"4",
            label:"Wednesday"
        }
        ,
        {
            id:"5",
            label:"Thursday"
        }
        ,
        {
            id:"6",
            label:"Friday"
        }
        ,
        {
            id:"7",
            label:"Saturday"
        }
        
    ]);

    const [customerList, setCustomerList] = useState([]);

    const [frequencyList, setFrequencyList] = useState([
        {
            id:"1",
            label:"Daily"
        }
        ,
        {
            id:"2",
            label:"Week Day"
        }
        ,
        {
            id:"3",
            label:"Weekly"
        }
        ,
        {
            id:"4",
            label:"Bi-Weekly"
        }
        ,
        {
            id:"5",
            label:"Monthly"
        }
        ,
        {
            id:"6",
            label:"Yearly"
        }
        
    ]);

    useEffect(() => {
        (async () => {
        try{
            let q;
                q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"));   
            const querySnapshot = await getDocs(q);       
            let count = 1   
            setCustomerList([])
            let workingCustomerList = []
            querySnapshot.forEach((doc) => {
                const customer = doc.data()
                const customerData = {
                    id:customer.id,                    
                    label:customer.firstName + ' ' + customer.lastName,
                    name:customer.firstName + ' ' + customer.lastName,
                    streetAddress:customer.billingAddress.streetAddress,
                    phoneNumber: customer.phoneNumber,
                    email:customer.email,

                }
                count = count + 1
                setCustomerList(customerList => [...customerList, customerData]); 
                workingCustomerList.push(customerData)
            });
            if (customerId !== "NA") {
                console.log('Received New CustomerId')
                const newArr = workingCustomerList.filter(obj => obj.id == customerId); // Keep all objects except the one with id 2
                console.log(newArr)
                if (newArr.length > 0 ){
                    let cus = newArr[0]
                    setCustomer(cus)
                    let q1 = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'), where('customerId','==',customerId));   
                    const querySnapshot1 = await getDocs(q1);     
                    const serviceLocationData = querySnapshot1.docs.map(doc => ServiceLocation.fromFirestore(doc));

                    setServiceLocationList(serviceLocationData);
                    if (serviceLocationData.length!==0) {
                        setServiceLocation(serviceLocationList[0])
                    }
                }
            }
            

            let q2 = query(collection(db, 'companies',recentlySelectedCompany,'companyUsers'));
            const querySnapshot2 = await getDocs(q2);       
            setTechList([])      
            querySnapshot2.forEach((doc) => {
                const companyUserData = doc.data()
                const companyUser = {
                    id:companyUserData.id,
                    userName:companyUserData.userName,
                    roleName:companyUserData.roleName,
                    status: companyUserData.status,
                    workerType: companyUserData.workerType,
                    linkedCompanyId: companyUserData.linkedCompanyId,
                    linkedCompanyName:companyUserData.linkedCompanyName,
                    label:companyUserData.userName,
                }
                setTechList(techList => [...techList, companyUser]); 
            });
        } catch(error){
            console.log('Error')
        }
        })();
    },[])
    //Select Changes
    const handleTypeChange = (option) => {

        (async () => {
            setType(option)
            
        })();
    };

    const handleDayChange = (option) => {

        (async () => {
            setDaysOfWeek(option)
            
            setDaysOfWeekName(option.label)
        })();
    };

    const handleCustomerChange = (option) => {

        (async () => {
            setCustomer(option)
            setCustomerName(option.name)
            //   Get serviceLocations By Customer
            console.log('Change in Customer ' + option.id)
            let q1;
            q1 = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'),where("customerId",'==',option.id));
            let workingLocationList = []
            const querySnapshot1 = await getDocs(q1);       
            setServiceLocationList([])      

            querySnapshot1.forEach((doc) => {
                console.log(1)
                const serviceLocationData = doc.data()
                const serviceLocation = {
                    id:serviceLocationData.id,
                    customerName: serviceLocationData.customerName,
                    streetAddress:serviceLocationData.address.streetAddress,
                    city:serviceLocationData.address.city,
                    state:serviceLocationData.address.state,
                    zip:serviceLocationData.address.zip,
                    latitude:serviceLocationData.address.latitude,
                    longitude:serviceLocationData.address.longitude,
                    bodiesOfWaterId:serviceLocationData.bodiesOfWaterId,
                    label:serviceLocationData.address.streetAddress

                }
                console.log('serviceLocation')
                console.log(serviceLocation)
                setServiceLocationList(serviceLocationList => [...serviceLocationList, serviceLocation]); 
                workingLocationList.push(serviceLocation)
            });
            console.log('Service Location Count: ' + workingLocationList.length)
            if (workingLocationList.length > 0) {
                let location = workingLocationList[0]
                setServiceLocation({
                    id:location.id,
                    customerName: location.customerName,
                    streetAddress:  location.streetAddress,
                    city:  location.city,
                    state:  location.state,
                    zip:  location.zip,
                    latitude:location.latitude,
                    longitude:location.longitude,
                    bodiesOfWaterId: location.bodiesOfWaterId,
                    label: location.streetAddress,
                })
            }
        })();
    };

    const handleServiceLocationChange = (option) => {

        (async () => {
            setServiceLocation(option)
            
        })();
    };

    const handleFrequencyChange = (option) => {

        (async () => {
            setFrequency(option)
            setFrequencyName(option.label)

        })();
    };

    const handleTechChange = (option) => {

        (async () => {
            setTech(option)
            setTechId(option.id)
            setTechName(option.userName)
        })();
    };

    const handleStartDateChange = (dateOption) => {
        setStartDate(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }); 
        setFormattedStartDate(formattedDate)

    }

    async function noEndDateToFalse(e) {
        e.preventDefault()
        setNoEndDate(false)
    }

    async function noEndDateToTrue(e) {
        e.preventDefault()
        setNoEndDate(true)
    }
    

    async function createNewRecurringServiceStop(e) {

        e.preventDefault()
        //
        // Guard Statements
        //

        if (frequencyName  != '') { 
            if (serviceLocation.id  != '') { 
                if (customer.id  != '') { 
                    if (techId != '') {
                        let rssId = 'com_rss_' + uuidv4();
                        const docRef = doc(db, "companies",recentlySelectedCompany,'settings','recurringServiceStops');
                        const docSnap = await getDoc(docRef);
                        let internalId = 'RSS'
                        let WOCount = 0

                        if (docSnap.exists()) {
                            internalId = 'RSS' + docSnap.data().increment
                            WOCount = docSnap.data().increment
                        }

                        let rss = {
                            id : rssId,
                            internalId:internalId,
                            type : type,
                            typeId : typeId,
                            typeImage : typeImage,
                            customerName : customerName,
                            customerId: customer.id,
                            address : {
                                streetAddress:serviceLocation.streetAddress,
                                city:serviceLocation.city,
                                state:serviceLocation.state,
                                zip:serviceLocation.zip,
                                latitude:serviceLocation.latitude,
                                longitude:serviceLocation.longitude
                            },
                            tech : techName,
                            techId: techId,
                            dateCreated: new Date(),
                            startDate : startDate,
                            endDate : endDate,
                            noEndDate : noEndDate,
                            frequency : frequencyName,
                            daysOfWeek : daysOfWeekName,
                            description : description,
                            lastCreated : startDate, //Maybe Something Else
                            serviceLocationId : serviceLocation.id,
                            estimatedTime : "",
                            otherCompany : "",
                            laborContractId : "",
                            contractedCompanyId : "",
                        }

                        console.log(rss)

                        // await setDoc(doc(db,"companies",recentlySelectedCompany,'recurringServiceStop',rssId), rss);

                        console.log('Created New Recurring Service Stop')

                        //Create First few Service Stops

                        const newRss = httpsCallable(functions, 'createFirstRecurringServiceStop');
                        let data = { 
                            recurringServiceStop: rss,
                            companyId:recentlySelectedCompany,
                            method: "POST",
                            headers: {
                            "Content-Type": "application/json",
                            },

                        }
                        console.log('RSS DATA')
                        console.log(data)
                        
                            
                        toast.loading('Loading...')
                        newRss(data)
                        .then((response) => response.data)
                        .then( async (data) => {

                            // Handle the result from the function
                            toast.dismiss()
                            
                            toast.success('Successfully Uploaded')
                            console.log(data);
                            navigate('/company/recurringServiceStop')

                        })
                        .catch((error) => {
                            
                            // Handle any errors
                            toast.dismiss()
                            toast.error('error')
                            console.error('Error');
                            console.error(error);
                        });
                            
                    } else {
                        console.log('Form not fully filled out')
                        toast.error('Please Fill Out Form Fully');
                    }
                } else {
                    console.log('Form not fully filled out')
                    toast.error('Please Fill Out Form Fully');
                }
            } else {
                console.log('Form not fully filled out')
                toast.error('Please Fill Out Form Fully');
            }
        } else {
            console.log('Form not fully filled out')
            toast.error('Please Fill Out Form Fully');
        }
        //Clear Form

        // navigate('/company/recurringServiceStop')
        // setType("")
        // setTypeId("")
        // setTypeImage("")
        // setCustomer({
        //     id:"",
        //     name:"",
        //     label:"Select Customer"
        // })
        // setCustomerName("")
        // setServiceLocation({
        //     id:'',
        //     customerName: '',
        //     streetAddress:'',
        //     label:'Select a Service Location',
        //     bodiesOfWaterId:[]
        // })
        // setServiceLocationList([])
        // setStreetAddress("")
        // setCity("")
        // setState("")
        // setZip("")
        // setTech({
        //     dateCreated : '',
        //     linkedCompanyId : '',
        //     id : '',
        //     linkedCompanyName : '',
        //     roleId : '',
        //     roleName : '',
        //     status : '',
        //     userId : '',
        //     userName : '',
        //     workerType : '',
        //     label : 'Select a Technician',
        // })
        // setTechId("")
        // setTechName("")
        // setFrequency("")
        // setDaysOfWeek("")
        // setNoEndDate(true)
        // setDescription("")
        // setStartDate(new Date())
        // setFormattedStartDate("")
        // setEndDate(new Date())
        // setFormattedEndDate("")
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
            <div className='py-2'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to='/company/recurringServiceStop'
                >
                    Back
                </Link>
            </div>
            <h1 className='text-[#000000] font-bold'>Create New Recurring Service Stop</h1>

            <form>
                <div className='py-2'>
                    <div className='w-full bg-[#0e245c] rounded-md text-[#cfcfcf] p-4'> 
                        <div className='py-2 w-full text-[#000000]'>
                            <Select
                                value={customer}
                                options={customerList}
                                onChange={handleCustomerChange}
                                isSearchable
                                placeholder="Select a Customer"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'blue',
                                    primary: 'gray',
                                },
                                })}
                            />
                        </div>

                        <div className='py-2 w-full text-[#000000]'>
                            <Select
                                value={serviceLocation}
                                options={serviceLocationList}
                                onChange={handleServiceLocationChange}
                                isSearchable
                                placeholder="Select a Service Location"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'blue',
                                    primary: 'gray',
                                },
                                })}
                            />
                        </div>

                        <div className='py-2 w-full text-[#000000]'>
                            <Select
                                value={tech}
                                options={techList}
                                onChange={handleTechChange}
                                isSearchable
                                placeholder="Select a Service Location"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'blue',
                                    primary: 'gray',
                                },
                                })}
                            />
                        </div>

                        <div className='py-2 w-full text-[#000000]'>
                            <Select
                                value={daysOfWeek}
                                options={dayList}
                                onChange={handleDayChange}
                                isSearchable
                                placeholder="Select a Day of Week"
                                theme={(theme) => ({
                                    ...theme,
                                    borderRadius: 0,
                                    colors: {
                                        ...theme.colors,
                                        primary25: 'blue',
                                        primary: 'gray',
                                        },
                                })}
                            />
                        </div>
                        <div className='py-2 w-full text-[#000000]'>
                            <Select
                                value={frequency}
                                options={frequencyList}
                                onChange={handleFrequencyChange}
                                isSearchable
                                placeholder="Select Frequency"
                                theme={(theme) => ({
                                ...theme,
                                borderRadius: 0,
                                colors: {
                                    ...theme.colors,
                                    primary25: 'blue',
                                    primary: 'gray',
                                },
                                })}
                            />
                        </div>
                        <h2>Start Date :</h2>
                        <div className="text-[#000000]">
                                <DatePicker 
                                    selected={startDate} 
                                    onChange={(d) => handleStartDateChange(d)}
                                />
                        </div>
                        {
                            noEndDate ? <div className=" py-2">
                                <button className='bg-[#2B600F] rounded-md items-center flex justify-center px-2'
                                onClick={(e) => noEndDateToFalse(e)} >
                                    <p> No End Date</p>
                                </button>

                            </div>: <div className=" py-2">
                                <button className='bg-[#9C0D38] rounded-md items-center flex justify-center px-2'
                                onClick={(e) => noEndDateToTrue(e)} 
                                >
                                    <p> Has End Date</p>
                                </button>
                                <h2>End Date :</h2>
                                <div className="text-[#000000]">
                                        <DatePicker 
                                            selected={endDate} 
                                            onChange={(d) => handleStartDateChange(d)}
                                        />
                                </div>
                            </div>
                        }
                        <input onChange={(e) => {setDescription(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description...' value={description}></input>
                        <div className='w-full p-4 rounded-md mt-2'>
                            <div className='left-0 w-full justify-between'>
                                <button
                                className='text-[#ededed] w-full bg-[#2B600F] py-1 px-2 rounded-md'
                                onClick={(e) => createNewRecurringServiceStop(e)} 
                                >
                                    Create New Recurring Service Stop
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}
export default CreateNewRecurringServiceStop;