import React, {useState, useEffect, useContext} from 'react';
import { useParams } from 'react-router-dom';
import { query, collection, getDocs, doc, updateDoc, getDoc, limit, where, orderBy } from "firebase/firestore";
import { db } from "../../../utils/config";
import { format } from 'date-fns'; // Or any other date formatting library
import Chart from 'react-apexcharts';
import { useNavigate } from 'react-router-dom';
import Select from 'react-select';

import { Customer } from '../../../utils/models/Customer';
import { ServiceLocation } from '../../../utils/models/ServiceLocation';
import { BodyOfWater } from '../../../utils/models/BodyOfWater';

import { Context } from "../../../context/AuthContext";

const ChemicalHistory = () => {    
    const navigate = useNavigate()
    

    const [showCustomerSelector, setShowCustomerSelector] = useState(false);
    const {customerId, serviceLocationId, bodyOfWaterId} = useParams();
    const {recentlySelectedCompany} = useContext(Context);

    const [customerList, setCustomerList] = useState([]);
    const [serviceLocationList, setServiceLocationList] = useState([]);
    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);

    const [customer,setCustomer] = useState(null)
    const [serviceLocation,setServiceLocation] = useState(null)
    const [bodyOfWater,setBodyOfWater] = useState(null)

    const [chartInfo, setChartInfo] = useState({
        series: [
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
            categories: [],
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

    const [dosageChartInfo, setDosageChartInfo] = useState({
        series: [
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
            categories: [],
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

    const [chlorineReadingChart, setChlorineReadingChart] = useState({
        series: [
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
            categories: [],
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

    const [phReadingChart, setPhReadingChart] = useState({
        series: [
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
            categories: [],
            title: {
                text: 'Weeks'
            }
            },
            yaxis: {
            title: {
                text: ''
            },
            min: 5,
            max: 9
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

    const [tdsReadingChart, setTdsReadingChart] = useState({
        series: [
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
            categories: [],
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
    useEffect(() => {
        (async () => {
             try{

                let q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"));   
                const querySnapshot = await getDocs(q);     
                const customerData = querySnapshot.docs.map(doc => Customer.fromFirestore(doc));
                setCustomerList(customerData);

                if (customerId !="NA"){
                    const docRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
    
                        console.log("Found Customer");
                        const snapCustomer =  Customer.fromFirestore(docSnap)
    
                        setCustomer(snapCustomer);
                      } else {
                        console.log("No such document!");
                      }


                    let q1 = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'), where('customerId','==',customerId));   
                    const querySnapshot1 = await getDocs(q1);     
                    const serviceLocationData = querySnapshot1.docs.map(doc => ServiceLocation.fromFirestore(doc));

                    setServiceLocationList(serviceLocationData);
                    if (serviceLocationData.length!==0) {
                        setServiceLocation(serviceLocationList[0])
                    }
                }

                if (serviceLocationId !="NA"){
                    const docRef = doc(db, "companies",recentlySelectedCompany,'serviceLocations',serviceLocationId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
    
                        console.log("Found Customer");
                        const snapLocation =  ServiceLocation.fromFirestore(docSnap)
    
                        setServiceLocation(snapLocation);
                    } else {
                    console.log("No such document!");
                    }

                    let q2 = query(collection(db, 'companies',recentlySelectedCompany,'bodiesOfWater'), where('serviceLocationId','==',serviceLocationId));

                    const querySnapshot2 = await getDocs(q2);
                    setBodyOfWaterList([])  
                    const bodyOfWaterData = querySnapshot2.docs.map(doc => BodyOfWater.fromFirestore(doc));
                    setBodyOfWaterList(bodyOfWaterData)

                    if (bodyOfWaterData.length!==0) {
                        setBodyOfWater(bodyOfWaterData[0])
                    }
                }
                if (bodyOfWaterId !="NA"){
                    const docRef = doc(db, "companies",recentlySelectedCompany,'bodiesOfWater',bodyOfWaterId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
    
                        console.log("Found Body Of Water");
                        const snapBOW =  BodyOfWater.fromFirestore(docSnap)
    
                        setBodyOfWater(snapBOW);
                      } else {
                        console.log("No such document!");
                      }
                }
                if (customerId !="NA" || serviceLocationId !="NA" || bodyOfWaterId !="NA"){
                    console.log('Getting Service Stop Data')
                    let categories = []

                    let chlorineList = []
                    let totalChlorineList = []
                    let pHList = []
                    let tdsList = []

                    let liquidChlorineList = []
                    let tabsList = []
                    let q6 = query(collection(db, 'companies',recentlySelectedCompany,'stopData'),
                    where('serviceLocationId','==',serviceLocationId),
                    where('bodyOfWaterId','==',bodyOfWaterId),
                    orderBy("date"),
                    limit(10));
                    const querySnapshot6 = await getDocs(q6);       

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

                        const totalChlorine = readings.find(model => model.templateId === "544BBDCA-A748-43F2-9114-F8D478F4BA8D");
                        if (totalChlorine) {
                            console.log(totalChlorine)
                            console.log("Chlorine " + totalChlorine.amount)
                            totalChlorineList.push(totalChlorine.amount)
                        }

                        const ph = readings.find(model => model.templateId === "C7409822-EBE0-413D-A53A-FDF387435230");
                        if (ph) {
                            console.log(ph)
                            console.log("ph " + ph.amount)
                            pHList.push(ph.amount)
                        }
                        const TDS = readings.find(model => model.templateId === "AAAF636F-144A-4B90-92EC-24E40534EA7F");
                        if (TDS) {
                            console.log(TDS)
                            console.log("TDS " + TDS.amount)
                            tdsList.push(TDS.amount)
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
                    console.log('Updating Chart Info')
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
                            ...chartInfo.options,
                            categories: categories,
                        },
                    })

                    setChlorineReadingChart({
                        ...chlorineReadingChart,
                        series: [
                            {
                            name: "Free Chlorine",
                            type: 'line',
                            data: chlorineList
                            },
                            {
                            name: "Total Chlorine",              
                            type: 'line',
                            data: totalChlorineList
                            }
                        ],
                        options: {
                            ...chartInfo.options,
                            categories: categories,
                        },
                    })

                    setPhReadingChart({
                        ...phReadingChart,
                        series: [
                            {
                            name: "pH",
                            type: 'line',
                            data: pHList
                            }
                        ],
                        options: {
                            ...chartInfo.options,
                            categories: categories,
                        },
                    })

                    setTdsReadingChart({
                        ...tdsReadingChart,
                        series: [
                            {
                            name: "Total Disolved Solids",
                            type: 'line',
                            data: tdsList
                            }
                        ],
                        options: {
                            ...chartInfo.options,
                            categories: categories,
                        },
                    })
                }
            } catch(error){
                console.log('Chemical History Error: ', error)
            }
        })();
    },[])

    const handleCustomerChange = (option) => {
        (async () => {
            console.log("Change of Customer ", option)
            setCustomer(option)
            try{
                let q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"));   
                const querySnapshot = await getDocs(q);     
                const locationData = querySnapshot.docs.map(doc => ServiceLocation.fromFirestore(doc));
                setServiceLocationList(locationData);

                if (locationData.length!==0) {
                    setServiceLocation(locationData[0])
                    handleServiceLocationChange(locationData[0])
                }
            } catch(error){ 
                console.log('Error ', error)
            }
        })();
    };

    const handleServiceLocationChange = (option) => {
        (async () => {
            console.log('Change in Service Location', option)
            setServiceLocation(option)
            try{
                let q = query(collection(db, 'companies',recentlySelectedCompany,'bodiesOfWater'), where('serviceLocationId','==',option.id));

                const querySnapshot = await getDocs(q);
                setBodyOfWaterList([])  
                const itemsData = querySnapshot.docs.map(doc => BodyOfWater.fromFirestore(doc));
                setBodyOfWaterList(itemsData)

                if (itemsData!==0) {
                    setBodyOfWater(itemsData[0])
                }
            } catch(error){
                console.log('Error ', error)
            }
        })();
    };

    const handleBodyOfWaterChange = (option) => {

        (async () => {
            console.log('Change in Body Of Water', option)
            setBodyOfWater(option)
            if (customerId !="NA" || serviceLocationId !="NA" || bodyOfWaterId !="NA"){
                console.log('Getting Service Stop Data')
                let categories = []

                let chlorineList = []
                let totalChlorineList = []
                let pHList = []
                let tdsList = []

                let liquidChlorineList = []
                let tabsList = []
                let q6 = query(collection(db, 'companies',recentlySelectedCompany,'stopData'),
                where('serviceLocationId','==',serviceLocationId),
                where('bodyOfWaterId','==',bodyOfWaterId),
                orderBy("date"),
                limit(10));
                const querySnapshot6 = await getDocs(q6);       

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

                    const totalChlorine = readings.find(model => model.templateId === "544BBDCA-A748-43F2-9114-F8D478F4BA8D");
                    if (totalChlorine) {
                        console.log(totalChlorine)
                        console.log("Chlorine " + totalChlorine.amount)
                        totalChlorineList.push(totalChlorine.amount)
                    }

                    const ph = readings.find(model => model.templateId === "C7409822-EBE0-413D-A53A-FDF387435230");
                    if (ph) {
                        console.log(ph)
                        console.log("ph " + ph.amount)
                        pHList.push(ph.amount)
                    }
                    const TDS = readings.find(model => model.templateId === "AAAF636F-144A-4B90-92EC-24E40534EA7F");
                    if (TDS) {
                        console.log(TDS)
                        console.log("TDS " + TDS.amount)
                        tdsList.push(TDS.amount)
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
                console.log('Updating Chart Info')
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
                        ...chartInfo.options,
                        categories: categories,
                    },
                })

                setChlorineReadingChart({
                    ...chlorineReadingChart,
                    series: [
                        {
                        name: "Free Chlorine",
                        type: 'line',
                        data: chlorineList
                        },
                        {
                        name: "Total Chlorine",              
                        type: 'line',
                        data: totalChlorineList
                        }
                    ],
                    options: {
                        ...chartInfo.options,
                        categories: categories,
                    },
                })

                setPhReadingChart({
                    ...phReadingChart,
                    series: [
                        {
                        name: "pH",
                        type: 'line',
                        data: pHList
                        }
                    ],
                    options: {
                        ...chartInfo.options,
                        categories: categories,
                    },
                })

                setTdsReadingChart({
                    ...tdsReadingChart,
                    series: [
                        {
                        name: "Total Disolved Solids",
                        type: 'line',
                        data: tdsList
                        }
                    ],
                    options: {
                        ...chartInfo.options,
                        categories: categories,
                    },
                })
            }
        })();
    };

    async function selectNewCustomer(e) {
        e.preventDefault()
        setShowCustomerSelector(true)
    }

    async function dismissSelectNewCustomer(e) {
        e.preventDefault()
        setShowCustomerSelector(false)
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
            <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                <div className='w-full'>
                    
                    <div className='flex w-full justify-end'>    
                        <button
                        className='p-2 blue-bg'
                        onClick={(e) => selectNewCustomer(e)} 
                        >Select New</button>
                    </div>
                {
                    customer ? <div>
                    {
                        serviceLocation ? <div>
                        {
                            bodyOfWater ? <div>  {/* Over All Chart */}
                                <div className='w-full'>
                                    <div className='w-full white-bg  p-4 rounded-md'>
                                        <Chart 
                                        options={chartInfo.options} 
                                        series={chartInfo.series} 
                                        type="line" 
                                        height={350}
                                        // width="500"
                                        />
                                    </div>
                                </div> 

    

                                {/* Chlorine Readings Chart */}
                                <div className='w-full mt-2'>
                                    <div className='w-full white-bg  p-4 rounded-md'>
                                        <Chart 
                                        options={chlorineReadingChart.options} 
                                        series={chlorineReadingChart.series} 
                                        type="line" 
                                        height={350}
                                        // width="500"
                                        />
                                    </div>
                                </div> 

                                {/* ph Chart */}
                                <div className='w-full mt-2'>
                                    <div className='w-full white-bg  p-4 rounded-md'>
                                        <Chart 
                                        options={phReadingChart.options} 
                                        series={phReadingChart.series} 
                                        type="line" 
                                        height={350}
                                        // width="500"
                                        />
                                    </div>
                                </div> 

                                {/* TDS Chart */}
                                <div className='w-full mt-2'>
                                    <div className='w-full white-bg  p-4 rounded-md'>
                                        <Chart 
                                        options={tdsReadingChart.options} 
                                        series={tdsReadingChart.series} 
                                        type="line" 
                                        height={350}
                                        // width="500"
                                        />
                                    </div>
                                </div> 

                            </div>:<div>

                            </div>
                        }
                        </div>:<div>

                        </div>
                    }
                    </div>:<div>

                    </div>
                }
                </div>
            </div> 

            {showCustomerSelector && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full" id="my-modal">
                    <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
                        <div className="mt-3 text-center">
                    
                    
                            <div className='flex w-full justify-end'>    
                                <button
                                className='p-2 red-bg white-fg'
                                onClick={(e) => dismissSelectNewCustomer(e)} 
                                >Dismiss</button>
                            </div>
                            {/* Customer Picker */}

                            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                                <div className='left-0 w-full justify-between white-fg'>
                                        <p>Customer Picker</p>

                                        <Select
                                            value={customer}
                                            options={customerList}
                                            onChange={handleCustomerChange}
                                            isSearchable
                                            placeholder="Select A Customer"
                                            theme={(theme) => ({
                                            ...theme,
                                            borderRadius: 0,
                                            colors: {
                                                ...theme.colors,
                                                primary25: 'hotpink',
                                                primary: 'gray',
                                            },
                                            })}
                                        />
                                </div>
                            </div>

                                
                            {/* Location Picker */}
                            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                                <div className='left-0 w-full justify-between white-fg'>
                                        <p>Service Location Picker</p>

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
                                                primary25: 'hotpink',
                                                primary: 'gray',
                                            },
                                            })}
                                        />
                                        <hr/>
                                </div>
                            </div>

                            {/* Body Of Water */}
                            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                                <div className='left-0 w-full justify-between white-fg'>
                                        <p>Body Of Water Picker</p>

                                        <Select
                                            value={bodyOfWater}
                                            options={bodyOfWaterList}
                                            onChange={handleServiceLocationChange}
                                            isSearchable
                                            placeholder="Select a Body OF Water"
                                            theme={(theme) => ({
                                            ...theme,
                                            borderRadius: 0,
                                            colors: {
                                                ...theme.colors,
                                                primary25: 'hotpink',
                                                primary: 'gray',
                                            },
                                            })}
                                        />
                                        <hr/>
                                </div>
                            </div>
                               

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChemicalHistory;