import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { query, collection, getDocs, limit, orderBy, getDoc, doc, where } from "firebase/firestore";
import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
import { format } from 'date-fns/format'; 
import toast from 'react-hot-toast';

const Reports = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [role,setRole] = useState({
        color : '',
        description : '',
        id : '',
        listOfUserIdsToManage : '',
        name : '',
        permissionIdList : ''
    });
    
    const [selectedReport,setSelectedReport] = useState('')
    
    const [categorieList, setCategorieList] = useState([]);
    
    const [technicianList, setTechnicianList] = useState([]);
    
    const [total,setTotal] = useState('')

    const [formattedStartDate,setFormattedStartDate] = useState('')

    const [formattedEndDate,setFormattedEndDate] = useState('')

    const [startDate, setStartDate] = useState(new Date());

    const [endDate, setEndDate] = useState(new Date());
    
    async function handleStartDateChange(dateOption) {
        setStartDate(dateOption)
        console.log(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        console.log(formattedDate)
        setFormattedStartDate(formattedDate)
    }
    
    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency
        }).format(number);
    }   

    async function handleEndDateChange(dateOption) {
        setEndDate(dateOption)
        console.log(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        console.log(formattedDate)
        setFormattedEndDate(formattedDate)
    }
    
    useEffect(() => {
        (async () => {
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany,'roles',"roleId");
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    setRole((role) => ({
                        ...role,
                        color: docSnap.data().color,
                        description: docSnap.data().description,
                        id: docSnap.data().id,
                        listOfUserIdsToManage: docSnap.data().listOfUserIdsToManage,
                        name : docSnap.data().name,
                        permissionIdList : docSnap.data().permissionIdList
                    }));

                  } else {
                    console.log("No such document!");
                  }
            } catch(error){
                console.log('Error')
            }
        })();
    },[])

    async function getCategoryReport(e) {
        e.preventDefault()

        setSelectedReport('Category')
        toast.loading('Loading...')
        //Get All purchases in time Range
        let categorySummary = []
        let categories = []
        let purchases = []
        let total = 0 
        //

        try{
            let q;
            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", new Date(startDate)), where("date", "<=", new Date(endDate)), orderBy("date"));
            const querySnapshot = await getDocs(q);
            let count = 1 
            setCategorieList([])  
            querySnapshot.forEach((doc) => {
                const purchaseData = doc.data()
                const dateCreated = purchaseData.date.toDate();
                const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                const purchase = {
                    id:purchaseData.id,
                    name:purchaseData.name,
                    invoiceNum:purchaseData.invoiceNum,
                    price:formatCurrency(purchaseData.price/100),
                    quantityString: purchaseData.quantityString,
                    techName:purchaseData.techName,
                    venderName:purchaseData.venderName,
                    date:formattedDate1,
                    receiptId:purchaseData.receiptId,
                    total:(purchaseData.price/100)*parseFloat(purchaseData.quantityString),
                    billable:purchaseData.billable,
                    invoiced:purchaseData.invoiced,
                    customerName:purchaseData.customerName,
                    category:purchaseData.category,
                }
                count = count + 1

                purchases.push(purchase)
                
                if (!categories.includes(purchase.category)){
                    console.log('does not include ',purchase.category)
                    categories.push(purchase.category)
                } else {
                    console.log('includes ',purchase.category)
                }
            });

            for (let i = 0; i < categories.length; i++) {
                let category = categories[i]
                console.log('category ',category)
                const filteredArray = purchases.filter(item => item.category == category);
                let categorySum = 0 
                for (let i = 0; i < filteredArray.length; i++) {
                    let purchase = filteredArray[i]
                    categorySum = categorySum + purchase.total
                }
                console.log(filteredArray)
                categorySummary.push({
                        category:category,
                        total:formatCurrency(categorySum)
                    })
                    total = total + categorySum
            }
            setCategorieList(categorySummary)
            setTotal(formatCurrency(total))
            toast.dismiss()
            toast.success('Successful')
        } catch(error){
            toast.dismiss()
            toast.error('Error')
            console.log('Error')
            console.log(error)
        }
    }

    async function getTechReport(e) {
        e.preventDefault()
        setSelectedReport('Technician')
        toast.loading('Loading...')
        //Get All purchases in time Range
        let categorySummary = []
        let categories = []
        let purchases = []
        let total = 0 
        //

        try{
            let q;
            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", new Date(startDate)), where("date", "<=", new Date(endDate)), orderBy("date"));
            const querySnapshot = await getDocs(q);
            let count = 1 
            setCategorieList([])  
            querySnapshot.forEach((doc) => {
                const purchaseData = doc.data()
                const dateCreated = purchaseData.date.toDate();
                const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                const purchase = {
                    id:purchaseData.id,
                    name:purchaseData.name,
                    invoiceNum:purchaseData.invoiceNum,
                    price:formatCurrency(purchaseData.price/100),
                    quantityString: purchaseData.quantityString,
                    techName:purchaseData.techName,
                    venderName:purchaseData.venderName,
                    date:formattedDate1,
                    receiptId:purchaseData.receiptId,
                    total:(purchaseData.price/100)*parseFloat(purchaseData.quantityString),
                    billable:purchaseData.billable,
                    invoiced:purchaseData.invoiced,
                    customerName:purchaseData.customerName,
                    category:purchaseData.category,
                }
                count = count + 1

                purchases.push(purchase)
                
                if (!categories.includes(purchase.category)){
                    console.log('does not include ',purchase.category)
                    categories.push(purchase.category)
                } else {
                    console.log('includes ',purchase.category)
                }
            });

            for (let i = 0; i < categories.length; i++) {
                let category = categories[i]
                console.log('category ',category)
                const filteredArray = purchases.filter(item => item.category == category);
                let categorySum = 0 
                for (let i = 0; i < filteredArray.length; i++) {
                    let purchase = filteredArray[i]
                    categorySum = categorySum + purchase.total
                }
                categorySummary.push({
                        category:category,
                        total:formatCurrency(categorySum)
                    })
                    total = total + categorySum
            }
            setCategorieList(categorySummary)
            setTotal(formatCurrency(total))
            toast.dismiss()
            toast.success('Successful')
        } catch(error){
            toast.dismiss()
            toast.error('Error')
            console.log('Error')
            console.log(error)
        }
    }

    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <h2>Please Forgive the Work In Progress</h2>

                         <div className='text-[#000000]'>
                            <div>
                                <h2 className='text-[#ffffff]'>Start Date</h2>
                                <div>
                                    <DatePicker 
                                        selected={startDate} 
                                        onChange={(startDate) => handleStartDateChange(startDate)}
                                        selectsStart
                                        startDate={startDate}
                                        endDate={endDate}
                                    />
                                </div>
                            </div>
                            <div>
                                <h2 className='text-[#ffffff]'>End Date</h2>
                                <div>
                                    <DatePicker 
                                        selected={endDate} 
                                        onChange={(endDate) => handleEndDateChange(endDate)}
                                        selectsEnd
                                        startDate={startDate}
                                        endDate={endDate}
                                        minDate={startDate}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-between w-full">
                            <button 
                            onClick={(e) => getCategoryReport(e)} 
                            className='py-1 px-2 rounded-md bg-[#CDC07B]'>
                                Get Category Reports
                            </button>
                            <button 
                            onClick={(e) => getTechReport(e)} 
                            className='py-1 px-2 rounded-md bg-[#CDC07B]'>
                                Get Tech Reports
                            </button>

                        </div>
                    <p>{selectedReport}</p>
                    {
                        selectedReport=='Category' ? <div>

                            <p>Total {total}</p>
                            <div>
                                {
                                    categorieList?.map(purchase => (
                                        <div key={purchase.id}>
                                            <p>{purchase.category} - {purchase.total}</p>
                                        </div>
                                    ))
                                }
                            </div>
                        </div> : <div>

                        </div>
                    }
                    {
                        selectedReport=='Technician' ? <div>

                            <p>Total {total}</p>
                            <div>
                                {
                                    technicianList?.map(tech => (
                                        <div key={tech.id}>
                                            <p>{tech.category} - {tech.total}</p>
                                        </div>
                                    ))
                                }
                            </div>
                        </div> : <div>

                        </div>
                    }
                </div>
            </div>
        </div>
    );
}
    export default Reports;
