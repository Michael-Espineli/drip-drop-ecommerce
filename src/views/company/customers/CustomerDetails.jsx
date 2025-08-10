

import React, {useState, useEffect, useContext} from 'react';
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, updateDoc , deleteDoc, doc, getDoc, where } from "firebase/firestore";
import { db } from '../../../utils/config'
import { getAuth } from "firebase/auth";
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import { format } from 'date-fns/format'; 
import { Customer } from '../../../utils/models/Customer';
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import { BodyOfWater } from '../../../utils/models/BodyOfWater';
import { Contract } from '../../../utils/models/Contract';
import { RecurringContract } from '../../../utils/models/RecurringContract';

import { Context } from "../../../context/AuthContext";

const CustomerDetails = () => {
    const navigate = useNavigate()
    
    const {recentlySelectedCompany} = useContext(Context);

    const {customerId} = useParams();
    const [edit,setEdit] = useState(false);

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
    const [company,setCompany] = useState(false);
    const [active,setActive] = useState(true);



    // Customer Info
    const [customerModel,setCustomerModel] = useState({
        firstName : '',
        lastName : '',
        phoneNumber : '',
        company : '',
        email : '',
        billingAddress : {
            streetAddress : '',
            city : '',
            state : '',
            zip : '',
        } ,
        billingNotes : '',
        displayAsCompany : '',
        company : '',
        displayAsCompany : false,
        verified : true,
        hireDate : '',
        active : true,
        notes : '',
    });


    // contracts
    const [contractList, setContractList] = useState([]);

    // recurring contracts
    const [recurringContractList, setRecurringContractList] = useState([]);

    // Service Stop List
    const [serviceStopList, setServiceStopList] = useState([]);

    // Work Orders
    const [workOrderList, setWorkOrderList] = useState([]);

    // service Locations
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [selectedServiceLocation,setSelectedServiceLocation] = useState({
        id:'',
        nickName: '',
        address: {
            streetAddress: '',
            city: '',
            state: '',
            zip: '',

        },
        gateCode: '',
        dogName: '',
        estimatedTime: '',
        mainContact: {
            name: '',
            phoneNumber: '',
        },
        bodiesOfWaterId: [],
        rateType: '',
        laborType: '',
        chemicalCost: '',
        laborCost: '',
        rate: '',
        customerId: '',
        customerName: '',
        backYardTree: '',
        backYardBushes: '',
        backYardOther: '',
        preText: '',
        verified: false,
        photoUrls: [],
    });
    const [serviceLocationNotes,setServiceLocationNotes] = useState('');

    // Bodies Of Water
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);
    const [selectedBodyOfWater,setSelectedBodyOfWater] = useState({
        id : '',
        name : '',
        gallons : '',
        material : '',
        customerId : '',
        serviceLocationId : '',
        notes : '',
        shape : '',
        photoUrls : [],
        lastFilled : new Date(),
        lastFilledFormatted : "",
    });
    // Edit Body Of Water
    const [bodyOfWaterNotes,setBodyOfWaterNotes] = useState('');


    // Equipment
    const [equipmentList, setEquipmentList] = useState([]);
    const [selectedEquipment,setEelectedEquipment] = useState({
        id:'',
        customerName: '',
        streetAddress:'',
        bodiesOfWaterId:[]
    });

    // Edit Equipment
    const [equipmentNotes,setEquipmentNotes] = useState('');

    //Recurring Service Stop 
    const [recurringServiceStopList, setRecurringServiceStopList] = useState([]);

    //Chart Info
    const [chartInfo, setChartInfo] = useState({
        series: [],
        options: {},
    })


    useEffect(() => {
        (async () => {
            try{

                let bodyOfWaterId = ""
                let serviceLocationId = ""

                // Get Customer Info
                const docRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {

                    console.log("Found Customer");
                    const snapCustomer =  Customer.fromFirestore(docSnap)

                    setCustomerModel(snapCustomer);

                    const customerData =  docSnap.data()
                    setFirstName(customerData.firstName)
                    setLastName(customerData.lastName)
                    setPhoneNumber(customerData.phoneNumber)
                    setEmail(customerData.email)
                    setBillingStreetAddress(customerData.billingAddress.streetAddress)
                    setBillingCity(customerData.billingAddress.city)
                    setbillingState(customerData.billingAddress.state)
                    setbillingZip(customerData.billingAddress.zip)
                    setbillingNotes(customerData.billingNotes)

                  } else {
                    console.log("No such document!");
                  }

                //   Get Contracts By Customer
                setContractList([])  
                let contractQuery = query(collection(db, 'contracts'), where("companyId",'==',recentlySelectedCompany),where("customerId",'==',customerId));
     
                const contractSnapShot = await getDocs(contractQuery);    
                const contracts = contractSnapShot.docs.map(doc => Contract.fromFirestore(doc));
                console.log("Received " + contracts.length + " Service Locations");
                setContractList(contracts)

                //   Get Recurring Contracts By Customer
                setRecurringContractList([])  
                let recurringContractQuery = query(collection(db, 'recurringContracts'), where("companyId",'==',recentlySelectedCompany),where("customerId",'==',customerId));
     
                const recurringContractSnapShot = await getDocs(recurringContractQuery);    
                const recurringContracts = recurringContractSnapShot.docs.map(doc => RecurringContract.fromFirestore(doc));
                console.log("Received " + recurringContracts.length + " Service Locations");
                setRecurringContractList(recurringContracts)

                //   Get Service Stops By Customer
                let serviceStopQuery = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'),where("customerId",'==',customerId),limit(4),orderBy('serviceDate','desc'));
            
                const serviceStopSnapShot = await getDocs(serviceStopQuery);       
                setServiceStopList([])      
                serviceStopSnapShot.forEach((doc) => {
                    const serviceStopData = doc.data()
                    const date = serviceStopData.serviceDate.toDate();
                    const formattedDate = format(date, 'MMMM d, yyyy'); 

                    const serviceStop = {
                        id:serviceStopData.id,
                        tech:serviceStopData.tech,
                        customerName:serviceStopData.customerName,
                        streetAddress: serviceStopData.address.streetAddress,
                        jobId:serviceStopData.jobId,
                        date:formattedDate
                    }
                    setServiceStopList(serviceStopList => [...serviceStopList, serviceStop]); 
                });
                  
                //   Get Jobs By Customer
                let jobQuery = query(collection(db, 'companies',recentlySelectedCompany,'workOrders'),where("customerId",'==',customerId),limit(4));
            
                const jobSnapShot = await getDocs(jobQuery);       
                setWorkOrderList([])      
                jobSnapShot.forEach((doc) => {
                    const jobData = doc.data()

                    const dateCreated = jobData.dateCreated.toDate();
                    const formattedDateCreated = format(dateCreated, 'MM / d / yyyy'); 
                    const job = {
                        id:jobData.id,
                        internalId : jobData.internalId,
                        type: jobData.type,
                        adminId: jobData.adminId,
                        adminName: jobData.adminName,
                        billingStatus: jobData.billingStatus,
                        bodyOfWaterName: jobData.bodyOfWaterName,
                        chemicals: jobData.chemicals,
                        customerId: jobData.customerId,
                        customerName: jobData.customerName,
                        dateCreated: jobData.dateCreated,
                        formattedDateCreated: formattedDateCreated,
                        description: jobData.description,
                        equipmentId: jobData.equipmentId,
                        equipmentName: jobData.equipmentName,
                        jobTemplateId: jobData.jobTemplateId,
                        laborCost: jobData.laborCost,
                        operationStatus: jobData.operationStatus,
                        rate: jobData.rate,
                        serviceLocationId: jobData.serviceLocationId,
                        serviceStopIds: jobData.serviceStopIds,
                        notes: jobData.notes,
                    }
                    console.log('job')
                    console.log(job)
                    setWorkOrderList(workOrderList => [...workOrderList, job]); 
                });
                
                //   Get service Locations By Customer
           
                setServiceLocationList([])  
                let locationQuery = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'),where("customerId",'==',customerId));
     
                const locationSnapShot = await getDocs(locationQuery);    
                const serviceLocations = locationSnapShot.docs.map(doc => ServiceLocation.fromFirestore(doc));
                console.log("Received " + serviceLocations.length + " Service Locations");
                setServiceLocationList(serviceLocations)

                //Check to see if serviceLocation is not empty

                //Check if selectedServiceLocation Exists
                if (serviceLocations.length>0) {
                    setSelectedServiceLocation(serviceLocations[0])
                    serviceLocationId = serviceLocations[0].id
                    setServiceLocationNotes(serviceLocations[0].notes)
                    console.log(serviceLocations);
                    setBodyOfWaterList([])  
   
                    let q2 = query(collection(db, 'companies',recentlySelectedCompany,'bodiesOfWater'),where("serviceLocationId",'==',serviceLocations[0].id));
                    const querySnapshot2 = await getDocs(q2);   
                    const workingBodyOfWaterList = querySnapshot2.docs.map(doc => BodyOfWater.fromFirestore(doc));   
                    setBodyOfWaterList(workingBodyOfWaterList)

                    console.log("Received " + workingBodyOfWaterList.length + " Bodies Of Water");
                    if (workingBodyOfWaterList.length>0) {
                        setSelectedBodyOfWater(workingBodyOfWaterList[0])
                        setBodyOfWaterNotes(workingBodyOfWaterList[0].notes)
                        bodyOfWaterId = workingBodyOfWaterList[0].id
                    }
                } else {
                    console.log("No Service Locations Found");
                }
                
                if (serviceLocationId != "" && bodyOfWaterId != "") {
                    console.log("Set Up Chart")
                    let categories = []
                    let chlorineList = []
                    let liquidChlorineList = []
                    let tabsList = []
                    let q6 = query(collection(db, 'companies',recentlySelectedCompany,'stopData'),
                    where('serviceLocationId','==',serviceLocationId),
                    where('bodyOfWaterId','==',bodyOfWaterId),
                    orderBy("date"),
                    limit(10));

                    const querySnapshot6 = await getDocs(q6);       
                    setRecurringServiceStopList([])
                    querySnapshot6.forEach((doc) => {
                        const stopData = doc.data()

                        const readings = stopData.readings
                        const dosages = stopData.dosages

                        const chlorine = readings.find(model => model.templateId === "FCEC537F-A16A-4000-B2F9-2973BFB8C53B");
                        if (chlorine) {
                            console.log(chlorine)
                            console.log("Chlorine " + chlorine.amount)
                            chlorineList.push(chlorine.amount)
                        }
                        const liquidChlorine = dosages.find(model => model.templateId === "2C94885B-EDFD-41EA-83E1-6EC958744011");
                        if (liquidChlorine) {
                            console.log(liquidChlorine)
                            console.log("Liquid Chlorine " + liquidChlorine.amount)
                            liquidChlorineList.push(liquidChlorine.amount)
                        }
                        const tabs = dosages.find(model => model.templateId === "4D3F62CE-DC25-49B9-AD78-4AB04101650C");
                        if (tabs) {
                            console.log(tabs)
                            console.log("Tabs Chlorine " + tabs.amount)
                            tabsList.push(tabs.amount)
                        }
                        const serviceDate = stopData.date.toDate()
                        const formattedDate = format(serviceDate, 'MM / d / yy'); 
                        categories.push(formattedDate)
                    });

                    setChartInfo({
                        ...chartInfo,
                        series: [
                            {
                            name: "Free Chlorine",
                            type: 'line',
                            data: chlorineList
                            },
                            {
                            name: "Liquid Chlorine",              
                            type: 'column',
                            data: liquidChlorineList
                            },
                            {
                            name: "Tabs",              
                            type: 'column',
                            data: tabsList
                            }
                        ],
                        options: {
                            chart: {
                            height: 350,
                            type: 'line',
                            dropShadow: {
                                enabled: true,
                                color: '#000',
                                top: 18,
                                left: 7,
                                blur: 10,
                                opacity: 0.5
                            },
                            zoom: {
                                enabled: false
                            },
                            toolbar: {
                                show: false
                            }
                            },
                            colors: ['#536546','#77B6EA', '#545454'],
                            dataLabels: {
                            enabled: true,
                            },
                            stroke: {
                            curve: 'smooth'
                            },
                            title: {
                            text: 'Chlorine and Chlorine Dosages',
                            align: 'left'
                            },
                            grid: {
                            borderColor: '#e7e7e7',
                            row: {
                                colors: ['#f3f3f3', 'transparent'], // takes an array which will be repeated on columns
                                opacity: 0.5
                            },
                            },
                            markers: {
                            size: 1
                            },
                            xaxis: {
                            categories: categories,
                            title: {
                                text: 'Weeks'
                            }
                            },
                            yaxis: {
                            title: {
                                text: ''
                            },
                            min: 0,
                            max: 15
                            },
                            legend: {
                            position: 'top',
                            horizontalAlign: 'right',
                            floating: true,
                            offsetY: -25,
                            offsetX: -5
                            }
                        },
                    })
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
                console.log('Customer Detail Page Error: ' + error)
            }
        })();
    },[])

   // Update Customer Billing Notes
   useEffect(() => {
    const updateNotes = async () => {
        try {
        //Update Firebase Function
            console.log('Notes Updated')
            const docRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
            console.log('Save Edit Changes')

            await updateDoc(docRef, {
                billingNotes: billingNotes,
            });
        } catch (err) {
          console.error("Error updating Notes:", err);
        }
       };
       updateNotes();
    }, [billingNotes]); // Re-filter when customerList or searchTerm changes

   // Update Service Location Notes
   useEffect(() => {
    const updateNotes = async () => {
        try {
            if (selectedServiceLocation.id !== "") {
            //Update Firebase Function
                const docRef = doc(db, "companies",recentlySelectedCompany,'serviceLocations',selectedServiceLocation.id);

                console.log(serviceLocationNotes)

                await updateDoc(docRef, {
                    notes: serviceLocationNotes,
                });
                    
            }
        } catch (err) {
          console.error("Error updating Notes:", err);
        }
       };
       updateNotes();
    }, [serviceLocationNotes]); 

    // Update Body Of Water Notes
    useEffect(() => {
     const updateNotes = async () => {
         try {
         //Update Firebase Function
            if (selectedBodyOfWater.id !== "") {
                const docRef = doc(db, "companies",recentlySelectedCompany,'bodiesOfWater',selectedBodyOfWater.id);

                console.log(bodyOfWaterNotes)
    
                await updateDoc(docRef, {
                    notes: bodyOfWaterNotes,
                });
            }
         } catch (err) {
           console.error("Error updating Notes:", err);
         }
        };
        updateNotes();
     }, [bodyOfWaterNotes]); 

    async function changeServiceLocation(e,serviceLocation) {
        e.preventDefault()
        if (serviceLocation.id!==''){

            setServiceLocationNotes(serviceLocation.notes)
            let q2;
            q2 = query(collection(db, 'companies',recentlySelectedCompany,'bodiesOfWater'),where("serviceLocationId",'==',serviceLocation.id));
        
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
            });

            if (bodyOfWaterList.length !=0){
                setSelectedBodyOfWater(bodyOfWaterList[0])
                setServiceLocationNotes(bodyOfWaterList[0].notes)
                if (bodyOfWaterList[0].id != "") {
                    
                    let categories = []
    
                    let chlorineList = []
                    let liquidChlorineList = []
                    let tabsList = []
                    let q6 = query(collection(db, 'companies',recentlySelectedCompany,'stopData'),
                    where('serviceLocationId','==',serviceLocation.id),
                    where('bodyOfWaterId','==',bodyOfWaterList[0].id),
                    orderBy("date"),
                    limit(10));
                    const querySnapshot6 = await getDocs(q6);       
                    setRecurringServiceStopList([])
                    querySnapshot6.forEach((doc) => {
                        const stopData = doc.data()

                        const readings = stopData.readings
                        const dosages = stopData.dosages

                        const chlorine = readings.find(model => model.templateId === "FCEC537F-A16A-4000-B2F9-2973BFB8C53B");
                        if (chlorine) {
                            console.log(chlorine)
                            console.log("Chlorine " + chlorine.amount)
                            chlorineList.push(chlorine.amount)
                        }
                        const liquidChlorine = dosages.find(model => model.templateId === "2C94885B-EDFD-41EA-83E1-6EC958744011");
                        if (liquidChlorine) {
                            console.log(liquidChlorine)
                            console.log("Liquid Chlorine " + liquidChlorine.amount)
                            liquidChlorineList.push(liquidChlorine.amount)
                        }
                        const tabs = dosages.find(model => model.templateId === "4D3F62CE-DC25-49B9-AD78-4AB04101650C");
                        if (tabs) {
                            console.log(tabs)
                            console.log("Tabs Chlorine " + tabs.amount)
                            tabsList.push(tabs.amount)
                        }
                        const serviceDate = stopData.date.toDate()
                        const formattedDate = format(serviceDate, 'MM / d / yy'); 
                        categories.push(formattedDate)
                    });
    
                    setChartInfo({
                        ...chartInfo,
                        series: [
                            {
                            name: "Free Chlorine",
                            type: 'line',
                            data: chlorineList
                            },
                            {
                            name: "Liquid Chlorine",              
                            type: 'column',
                            data: liquidChlorineList
                            },
                            {
                            name: "Tabs",              
                            type: 'column',
                            data: tabsList
                            }
                        ],
                        options: {
                            chart: {
                            height: 350,
                            type: 'line',
                            dropShadow: {
                                enabled: true,
                                color: '#000',
                                top: 18,
                                left: 7,
                                blur: 10,
                                opacity: 0.5
                            },
                            zoom: {
                                enabled: false
                            },
                            toolbar: {
                                show: false
                            }
                            },
                            colors: ['#536546','#77B6EA', '#545454'],
                            dataLabels: {
                            enabled: true,
                            },
                            stroke: {
                            curve: 'smooth'
                            },
                            title: {
                            text: 'Chlorine and Chlorine Dosages',
                            align: 'left'
                            },
                            grid: {
                            borderColor: '#e7e7e7',
                            row: {
                                colors: ['#f3f3f3', 'transparent'], // takes an array which will be repeated on columns
                                opacity: 0.5
                            },
                            },
                            markers: {
                            size: 1
                            },
                            xaxis: {
                            categories: categories,
                            title: {
                                text: 'Weeks'
                            }
                            },
                            yaxis: {
                            title: {
                                text: ''
                            },
                            min: 0,
                            max: 15
                            },
                            legend: {
                            position: 'top',
                            horizontalAlign: 'right',
                            floating: true,
                            offsetY: -25,
                            offsetX: -5
                            }
                        },
                    })
                }
            }
        }
    }

    async function changeBodyOfWater(e,bodyOfWater) {
        e.preventDefault()

        if (bodyOfWater.id!==''){
            console.log(bodyOfWater)
            setSelectedBodyOfWater({
                id : bodyOfWater.id,
                customerId : bodyOfWater.customerId,
                depth : bodyOfWater.depth,
                gallons : bodyOfWater.gallons,
                material : bodyOfWater.material,
                name : bodyOfWater.name,
                notes : bodyOfWater.notes??"",
                serviceLocationId : bodyOfWater.serviceLocationId,
                label : bodyOfWater.name 
            })

            setBodyOfWaterNotes(bodyOfWater.notes)
            //Get Equipment

                                        

            if (bodyOfWater.id != "" && selectedServiceLocation.id != "") {
                
                let categories = []

                let chlorineList = []
                let liquidChlorineList = []
                let tabsList = []

                let q6 = query(collection(db, 'companies',recentlySelectedCompany,'stopData'),
                where('serviceLocationId', '==', selectedServiceLocation.id),
                where('bodyOfWaterId', '==', bodyOfWater.id),
                orderBy("date"),
                limit(10));
                const querySnapshot6 = await getDocs(q6);       
                setRecurringServiceStopList([])
                querySnapshot6.forEach((doc) => {
                    const stopData = doc.data()

                    const readings = stopData.readings
                    const dosages = stopData.dosages

                    const chlorine = readings.find(model => model.templateId === "FCEC537F-A16A-4000-B2F9-2973BFB8C53B");
                    if (chlorine) {
                        console.log(chlorine)
                        console.log("Chlorine " + chlorine.amount)
                        chlorineList.push(chlorine.amount)
                    }
                    const liquidChlorine = dosages.find(model => model.templateId === "2C94885B-EDFD-41EA-83E1-6EC958744011");
                    if (liquidChlorine) {
                        console.log(liquidChlorine)
                        console.log("Liquid Chlorine " + liquidChlorine.amount)
                        liquidChlorineList.push(liquidChlorine.amount)
                    }
                    const tabs = dosages.find(model => model.templateId === "4D3F62CE-DC25-49B9-AD78-4AB04101650C");
                    if (tabs) {
                        console.log(tabs)
                        console.log("Tabs Chlorine " + tabs.amount)
                        tabsList.push(tabs.amount)
                    }
                    const serviceDate = stopData.date.toDate()
                    const formattedDate = format(serviceDate, 'MM / d / yy'); 
                    categories.push(formattedDate)
                });

                setChartInfo({
                    ...chartInfo,
                    series: [
                        {
                        name: "Free Chlorine",
                        type: 'line',
                        data: chlorineList
                        },
                        {
                        name: "Liquid Chlorine",              
                        type: 'column',
                        data: liquidChlorineList
                        },
                        {
                        name: "Tabs",              
                        type: 'column',
                        data: tabsList
                        }
                    ],
                    options: {
                        chart: {
                        height: 350,
                        type: 'line',
                        dropShadow: {
                            enabled: true,
                            color: '#000',
                            top: 18,
                            left: 7,
                            blur: 10,
                            opacity: 0.5
                        },
                        zoom: {
                            enabled: false
                        },
                        toolbar: {
                            show: false
                        }
                        },
                        colors: ['#536546','#77B6EA', '#545454'],
                        dataLabels: {
                        enabled: true,
                        },
                        stroke: {
                        curve: 'smooth'
                        },
                        title: {
                        text: 'Chlorine and Chlorine Dosages',
                        align: 'left'
                        },
                        grid: {
                        borderColor: '#e7e7e7',
                        row: {
                            colors: ['#f3f3f3', 'transparent'], // takes an array which will be repeated on columns
                            opacity: 0.5
                        },
                        },
                        markers: {
                        size: 1
                        },
                        xaxis: {
                        categories: categories,
                        title: {
                            text: 'Weeks'
                        }
                        },
                        yaxis: {
                        title: {
                            text: ''
                        },
                        min: 0,
                        max: 15
                        },
                        legend: {
                        position: 'top',
                        horizontalAlign: 'right',
                        floating: true,
                        offsetY: -25,
                        offsetX: -5
                        }
                    },
                })
            }
            
        }
    }
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
        setCustomerModel((prevCustomer) => ({
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
        
        setEdit(false);
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
                        
            <div className='w-full flex flex-wrap mt-2'>
                <div className='w-full lg:pr-3'> 
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
                        <h1 className='font-bold black-fg text-xl'>Customer Information</h1>
                        <button onClick={(e) =>{editCustomer(e)}} className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Edit</h1></button>
                    </div>
                    }
                    <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf] mt-4'>
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
                            <div className='flex flex-wrap mt-2 items-start white-fg w-full '>
                                <div className='w-1/2'>
                                    {customerModel.displayAsCompany ? <p> 
                                            {customerModel.company}
                                        </p>:<p>{customerModel.firstName} {customerModel.lastName}</p>
                                    }
                                    <p>{customerModel.phoneNumber}</p>
                                    <p>{customerModel.email}</p>
                                </div>
                                <div className='w-1/2'>
                                    <h1 className='font-bold'>Notes:</h1>
                                    <textarea 
                                    value={billingNotes} 
                                    onChange={(e) => {setbillingNotes(e.target.value)}} 
                                    className='w-full p-1 focus:border-indigo-500 outline-none bg-[#ededed] border border-slate-700 rounded-md text-[#000000]' 
                                    type="text" 
                                    id='name' 
                                    rows={4} // Optional: Specifies the number of visible text lines
                                    cols={50} // Optional: Specifies the width in characters
                                    placeholder='Notes...'/>
                                </div>
                            </div>
                        } 

                    </div>
                </div>
                <div className='w-full flex flex-wrap mt-4 '>
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
                                    <p>{customerModel.billingAddress.streetAddress}</p>
                                    <div className='w-full flex justify-between gap-2'>
                                        <p>{customerModel.billingAddress.state}</p>
                                        <p>{customerModel.billingAddress.city}</p>
                                        <p>{customerModel.billingAddress.zip}</p>
                                    </div>
                                </div>
                            </button>
                        }
                        </div>
                    </div>
                    <div className='w-full lg:w-5/12 lg:pr-3'>  
                        <div className='w-full h-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <p>Active: {customerModel.active ? 'Active':'Inactive'}</p>
                            <p>Verified: {customerModel.verified ? 'Verified':'Not Verified'}</p>
                        </div>
                    </div>
                </div>

                {/* Money */}
                <h1 className='flex w-full justify-start font-bold black-fg text-xl mt-4 '>Money Information</h1>

                <div className='w-full flex flex-wrap mt-4 '>
                    <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>

                        <div className='flex justify-between mt-4 w-full'>
                            <h1 className='font-bold text-[#cfcfcf]'>Money</h1>
                            <Link 
                            className='bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000] flex'
                            to='/company/recurringContract/createNew/NA'>Payment History
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Recurring Contract Information */}
                <div className='flex justify-between mt-4 w-full'>
                    <h1 className='w-full justify-start font-bold black-fg text-xl mt-4 '>Recurring Contract Information</h1>
                    <Link 
                    className='bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000] flex'
                    to='/company/recurringContract/createNew/NA'>New Recurring Contract
                    </Link>
                </div>

                <div className='w-full flex flex-wrap mt-4 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                           
                            <h1 className='font-bold text-[#cfcfcf]'>Recurring Contracts</h1>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border border-slate-700'>
                                        <tr>
                                            <th className='py-3 px-4'>Status</th>
                                            <th className='py-3 px-4'>Rate</th>
                                            <th className='py-3 px-4'>Route</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    {
                                        recurringContractList?.map(contract => (
                                            <tr key={contract.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringContract/detail/${contract.id}`}>contract.customerAcceptance</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringContract/detail/${contract.id}`}>{contract.status}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringContract/detail/${contract.id}`}>{contract.rate}</Link></td>
                                            </tr>
                                        ))
                                    }
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Contract Information */}
                <div className='flex justify-between mt-4 w-full'>
                    <h1 className='w-full justify-start font-bold black-fg text-xl mt-4 '>Contract Information</h1>

                    <Link 
                    className='bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000] flex'
                    to='/company/contract/createNew/NA'>New Contract
                    </Link>
                </div>
                <div className='w-full flex flex-wrap mt-4 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                           
                            <h1 className='font-bold text-[#cfcfcf]'>Contracts</h1>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border border-slate-700'>
                                        <tr>
                                            <th className='py-3 px-4'>CustomerAcceptance</th>
                                            <th className='py-3 px-4'>Status</th>
                                            <th className='py-3 px-4'>Rate</th>
                                            <th className='py-3 px-4'>Route</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    {
                                        contractList?.map(contract => (
                                            <tr key={contract.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/contract/detail/${contract.id}`}>customerAcceptance</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/contract/detail/${contract.id}`}>{contract.status}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/contract/detail/${contract.id}`}>{contract.rate}</Link></td>
                                            </tr>
                                        ))
                                    }
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Service Location */}
                <h1 className='flex w-full justify-start font-bold black-fg text-xl mt-4 '>Service Location Information</h1>

                    <div className='p-2'>
                        <Link 
                        className='bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000] flex'
                        to={`/company/serviceLocations/createNew/${customerId}`}>Create New
                        </Link>
                    </div>
                <div className='flex justify-start mt-4 '>
                    {
                        serviceLocationList?.map((n,i) => (
                            <div  className='p-2' key={i}>
                                <button 
                                onClick={(e) => changeServiceLocation(e,n)} 
                                className={`${(n.id === selectedServiceLocation.id) ? 'blue-bg white-fg':'white-bg black-fg border-b border-slate-700'} rounded-md p-2`} >
                                    <p>{n.nickName} {n.address.streetAddress}</p>
                                </button>
                            </div>
                        ))
                    }
                </div>
                <div className='w-full flex flex-wrap mt-4 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#cfcfcf]'>
                            <div className='flex flex-wrap mt-2 items-start white-fg w-full '>
                                <div className='w-1/2'>
                                    <div className='flex'><h1 className='w-40'>Street Address:</h1> {selectedServiceLocation.address.streetAddress}</div>
                                    <div className='flex'><h1 className='w-40'>Main Contact:</h1> {selectedServiceLocation.mainContact.name} {selectedServiceLocation.mainContact.phoneNumber}</div>
                                    <div className='flex'><h1 className='w-40'>Gate Code:</h1> {selectedServiceLocation.gateCode}</div>
                                    <div className='flex'><h1 className='w-40'>Dog Name:</h1> {selectedServiceLocation.dogName && <p>{selectedServiceLocation.dogName}</p>}</div>
                                    <div className='flex'><h1 className='w-40'>Estimated Time:</h1> {selectedServiceLocation.estimatedTime && <p>{selectedServiceLocation.estimatedTime}</p>}</div>
                                    <div className='flex'><h1 className='w-40'>Pre Text:</h1> {selectedServiceLocation.preText ? <p>True</p>:<p>False</p>}</div>
                                    

                                    <div className="mt-4">
                                        <strong>Photo URLs:</strong>
                                        {selectedServiceLocation.photoUrls && selectedServiceLocation.photoUrls.length > 0 ? (
                                            <ul className="list-disc ml-5">
                                            {selectedServiceLocation.photoUrls.map((photo, index) => (
                                                <li key={index}>
                                                <a href={photo.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                                    {photo.name || photo.url}
                                                </a>
                                                </li>
                                            ))}
                                            </ul>
                                        ) : (
                                            <p>No photos available.</p>
                                        )}
                                    </div>
                                </div>
                                <div className='w-1/2'>
                                    <h1 className='font-bold'>Notes:</h1>
                                    <textarea 
                                    value={serviceLocationNotes} 
                                    onChange={(e) => {setServiceLocationNotes(e.target.value)}} 
                                    className='w-full p-1 focus:border-indigo-500 outline-none bg-[#ededed] border border-slate-700 rounded-md text-[#000000]' 
                                    type="text" 
                                    id='name'
                                    rows={5} // Optional: Specifies the number of visible text lines
                                    cols={10} // Optional: Specifies the width in characters 
                                    placeholder='Notes...'/>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* 
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
                } */}
                {/* Bodies Of Water */}
                <h1 className='flex w-full justify-start font-bold black-fg text-xl mt-4 '>Body Of Water Information</h1>

                <div className='flex justify-start mt-4 '>

                    <div className='p-2'>
                        <Link 
                        className='bg-[#CDC07B] rounded-md py-1 px-2 text-[#000000] flex'
                        to={`/company/bodiesOfWater/createNew/${customerId}/${selectedServiceLocation.id}`}>Create New
                        </Link>
                    </div>
                    {
                        bodyOfWaterList?.map((n,i) =>(
                            <div className='p-2' key={i}>
                                <button 
                                    onClick={(e) => changeBodyOfWater(e,n)} 
                                    className={`${(n.id === selectedBodyOfWater.id) ? 'blue-bg white-fg':'white-bg black-fg border border-slate-700'} rounded-md p-2`} >
                                    <p>{n.name}</p>
                                </button>
                            </div>
                        ))
                    }
                </div>
                <div className='w-full flex flex-wrap mt-4 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='flex flex-wrap mt-2 items-start white-fg w-full '>
                                <div className='w-1/2'>
                                    <div className='flex'><h1 className='w-40'>Name:</h1> {selectedBodyOfWater.name}</div>
                                    <div className='flex'><h1 className='w-40'>Gallons:</h1> {selectedBodyOfWater.gallons}</div>
                                    <div className='flex'><h1 className='w-40'>Material:</h1> {selectedBodyOfWater.material}</div>
                                    <div className='flex'><h1 className='w-40'>Shape:</h1> {selectedBodyOfWater.shape}</div>
                                    <div className='flex'><h1 className='w-40'>Last Filled:</h1> {selectedBodyOfWater.lastFilledFormatted}</div>

                                    <div className="mt-4">
                                        <strong>Photo URLs:</strong>
                                        {selectedBodyOfWater.photoUrls && selectedBodyOfWater.photoUrls.length > 0 ? (
                                            <ul className="list-disc ml-5">
                                            {selectedBodyOfWater.photoUrls.map((photo, index) => (
                                                <li key={index}>
                                                <a href={photo.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                                    {photo.name || photo.url}
                                                </a>
                                                </li>
                                            ))}
                                            </ul>
                                        ) : (
                                            <p>No photos available.</p>
                                        )}
                                    </div>
                                </div>
                                <div className='w-1/2'>                        
                                    <button className='bg-[#CDC07B] p-2 rounded-md text-[#000000]'>Set Up One Time Task For Information</button>

                                    <h1 className='font-bold'>Notes:</h1>
                                    <textarea 
                                    value={bodyOfWaterNotes} 
                                    onChange={(e) => {setBodyOfWaterNotes(e.target.value)}} 
                                    className='w-full p-1 focus:border-indigo-500 outline-none bg-[#ededed] border border-slate-700 rounded-md text-[#000000]' 
                                    type="text" 
                                    id='name' 
                                    rows={5} // Optional: Specifies the number of visible text lines
                                    cols={50} // Optional: Specifies the width in characters
                                    placeholder='Notes...'/>
                                </div>
                            </div>
                            <div className='flex w-full justify-end'>
                                <Link to ={`/company/chemicalHistory/${customerId}/${selectedServiceLocation.id}/${selectedBodyOfWater.id}`}>See History</Link>
                            </div>
                            {/* Chart */}
                            
                            {/* <div className='w-full'>
                                <div className='w-full white-bg  p-4 rounded-md'>
                                    <Chart 
                                    options={chartInfo.options} 
                                    series={chartInfo.series} 
                                    type="line" 
                                    height={350}
                                    // width="500"
                                    />
                                </div>
                            </div>  */}
                           
                        </div>
                    </div>
                </div>
                {/*
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
                 */}

                {/* Equipment */}
                <h1 className='flex w-full justify-start font-bold black-fg text-xl mt-4 '>Equipment Information</h1>
                <div className='flex justify-start mt-4 '>

                    <div className='p-2'>
                        <button className='bg-[#CDC07B] p-2 rounded-md text-[#000000]'>Add New</button>
                    </div>
                    {
                        equipmentList?.map((n,i) => (
                            <div  className='p-2' key={i}>
                                <button 
                                onClick={(e) => changeServiceLocation(e,n)} 
                                className={`${(n.id === selectedServiceLocation.id) ? 'blue-bg white-fg':'white-bg black-fg border-b border-slate-700'} rounded-md p-2`} >
                                    <p>{n.nickName}</p>
                                </button>
                            </div>
                        ))
                    }
                </div>
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='flex justify-between py-2'>
                                <button className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>See Details</button>
                            </div>
                            <div className='flex flex-wrap mt-2 items-start white-fg w-full '>
                                <div className='w-1/2'>
                                    <div className='flex'><h1 className='w-40'>Name:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Category:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Is Active:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Make:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Model:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Date Installed:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Status:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Needs Service:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Clean Filter Pressure:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Current Pressure:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Last Service Date:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Service Frequency:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Service Frequency Every:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Next ServiceD ate:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Date Uninstalled:</h1></div>
                                    <div className='flex'><h1 className='w-40'>Photo Urls:</h1></div>
                                </div>
                                <div className='w-1/2'>
                                    <button className='bg-[#CDC07B] p-2 rounded-md text-[#000000]'>Set Up One Time Task For Information</button>
                                    <h1 className='font-bold'>Notes:</h1>
                                    <textarea 
                                    value={equipmentNotes} 
                                    onChange={(e) => {setEquipmentNotes(e.target.value)}} 
                                    className='w-full p-1 focus:border-indigo-500 outline-none bg-[#ededed] border border-slate-700 rounded-md text-[#000000]' 
                                    type="text" 
                                    id='name' 
                                    rows={5} // Optional: Specifies the number of visible text lines
                                    cols={50} // Optional: Specifies the width in characters
                                    placeholder='Notes...'/>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Service Stops */}
                <h1 className='flex w-full justify-start font-bold black-fg text-xl mt-4 '>Service Stops</h1>

                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border border-slate-700'>
                                        <tr>
                                            <th className='py-3 px-4'>Street Address</th>
                                            <th className='py-3 px-4'>Tech Name</th>
                                            <th className='py-3 px-4'>Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    {
                                        serviceStopList?.map(rss => (
                                            <tr key={rss.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${rss.id}`}>{rss.streetAddress}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${rss.id}`}>{rss.tech}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${rss.id}`}>{rss.date}</Link></td>
                                            </tr>
                                        ))
                                    }
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Work Orders */}

                <div className='flex justify-between items-center text-[#cfcfcf]'>
                    <h1 className=' w-full justify-start font-bold black-fg text-xl mt-4 '>Jobs</h1>

                    <Link to={`/company/jobs/createNew/${customerId}`}>
                        <h1 className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>
                            Add New 
                        </h1>
                    </Link>
                </div>
                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border border-slate-700'>
                                        <tr>
                                            <th className='py-3 px-4'>Admin</th>
                                            <th className='py-3 px-4'>Billing</th>
                                            <th className='py-3 px-4'>Operation</th>
                                            <th className='py-3 px-4'>Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    {
                                        workOrderList?.map(rss => (
                                            <tr key={rss.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/details/${rss.id}`}>{rss.adminName}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/details/${rss.id}`}>{rss.operationStatus}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/details/${rss.id}`}>{rss.billingStatus}</Link></td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/jobs/details/${rss.id}`}>{rss.notes}</Link></td>
                                            </tr>
                                        ))
                                    }
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Recurring Service Stops */}
                <div className='flex justify-between items-center text-[#cfcfcf]'>
                    <h1 className=' w-full justify-start font-bold black-fg text-xl mt-4 '>Recurring Service Stops</h1>

                    <Link to={`/company/recurringServiceStop/createNew/${customerId}`}>
                        <h1 className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>
                            Add New 
                        </h1>
                    </Link>
                </div>

                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border border-slate-700'>
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

                {/* Recurring Labor Contract*/}
                <div className='flex justify-between items-center text-[#cfcfcf]'>
                    <h1 className=' w-full justify-start font-bold black-fg text-xl mt-4 '>Recurring Labor Contracts</h1>

                    <Link to={`/company/recurringServiceStop/createNew/${customerId}`}>
                        <h1 className='bg-[#CDC07B] py-1 px-2 rounded-md text-[#000000]'>
                            Add New 
                        </h1>
                    </Link>
                </div>

                <div className='w-full flex flex-wrap mt-7 '>
                    <div className='w-full lg:pr-3'> 
                        <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#d0d2d6]'>
                            <div className='relative overflow-x-auto'>
                                <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                    <thead className='text-sm text-[#d0d2d6] border border-slate-700'>
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