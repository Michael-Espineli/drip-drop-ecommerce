import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
import DatePicker from "react-datepicker";
import { format } from 'date-fns/format'; 
import Select from 'react-select';

const PurchasesList = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [purchaseList, setPurchaseList] = useState([]);

    const [formattedStartDate,setFormattedStartDate] = useState('')

    const [formattedEndDate,setFormattedEndDate] = useState('')

    const [startDate, setStartDate] = useState(new Date());

    const [endDate, setEndDate] = useState(new Date());

    const [userList, setUserList] = useState([]);

    const [selectedUserList, setSelectedUserList] = useState([]);

    const [optionList,setOptionList] = useState([
        {
            id:1,
            label:'Billable',
            value:'Billable',
        }
        ,
        {
            id:2,
            label:'Not Billable',
            value:'Not Billable',
        }
        ,
        {
            id:3,
            label:'Invoiced',
            value:'Invoiced',
        }
        ,
        {
            id:4,
            label:'Not Invoiced',
            value:'Not Invoiced',
        }
        ,
    ])

    const [selectedOption,setSelectedOption] = useState()

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

        
        try{
            let q;
            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", dateOption), where("date", "<=", endDate), orderBy("date"));
            const querySnapshot = await getDocs(q);
            let count = 1 
            setPurchaseList([])  
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
                    total: formatCurrency((purchaseData.price/100)*parseFloat(purchaseData.quantityString)),
                    billable:purchaseData.billable,
                    invoiced:purchaseData.invoiced,
                    customerName:purchaseData.customerName,

                }
                count = count + 1
                setPurchaseList(purchaseList => [...purchaseList, purchase]); 
            });

        } catch(error){
            console.log('Error')
            console.log(error)
        }
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

        try{
            let q;
            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", dateOption), orderBy("date"));
            const querySnapshot = await getDocs(q);
            let count = 1 
            setPurchaseList([])  
            querySnapshot.forEach((doc) => {
                const purchaseData = doc.data()
                const dateCreated = purchaseData.date.toDate();
                const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                const userData = {
                    id:purchaseData.id,
                    name:purchaseData.name,
                    invoiceNum:purchaseData.invoiceNum,
                    price:formatCurrency(purchaseData.price/100),
                    quantityString: purchaseData.quantityString,
                    techName:purchaseData.techName,
                    venderName:purchaseData.venderName,
                    date:formattedDate1,
                    receiptId:purchaseData.receiptId,
                    total: formatCurrency((purchaseData.price/100)*parseFloat(purchaseData.quantityString)),
                    billable:purchaseData.billable,
                    invoiced:purchaseData.invoiced,
                    customerName:purchaseData.customerName,
                }
                count = count + 1
                setPurchaseList(purchaseList => [...purchaseList, userData]); 
            });

        } catch(error){
            console.log('Error')
            console.log(error)
        }
    }


    useEffect(() => {
        (async () => {

                const currentDate = new Date();
                const newStartDate = new Date();
                newStartDate.setDate(currentDate.getDate() -7);
                setStartDate(newStartDate)
                try{
                    let q;
                    q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", newStartDate), where("date", "<=", new Date(endDate)), orderBy("date"));
                    const querySnapshot = await getDocs(q);
                    let count = 1 
                    setPurchaseList([])  
                    querySnapshot.forEach((doc) => {
                        const purchaseData = doc.data()
                        const dateCreated = purchaseData.date.toDate();
                        const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                        const userData = {
                            id:purchaseData.id,
                            name:purchaseData.name,
                            invoiceNum:purchaseData.invoiceNum,
                            price:formatCurrency(purchaseData.price/100),
                            quantityString: purchaseData.quantityString,
                            techName:purchaseData.techName,
                            venderName:purchaseData.venderName,
                            date:formattedDate1,
                            receiptId:purchaseData.receiptId,
                            total: formatCurrency((purchaseData.price/100)*parseFloat(purchaseData.quantityString)),
                            billable:purchaseData.billable,
                            invoiced:purchaseData.invoiced,
                            customerName:purchaseData.customerName,
                        }
                        count = count + 1
                        setPurchaseList(purchaseList => [...purchaseList, userData]); 
                    });

                    let qu = query(collection(db, 'companies',recentlySelectedCompany,'companyUsers'));
                    const querySnapshotu = await getDocs(qu);       
                    setUserList([])      
                    querySnapshotu.forEach((doc) => {
                        const companyUserData = doc.data()
                        const companyUser = {
                            id:companyUserData.id,
                            userName:companyUserData.userName,
                            roleName:companyUserData.roleName,
                            status: companyUserData.status,
                            workerType: companyUserData.workerType,
                            linkedCompanyId: companyUserData.linkedCompanyId,
                            linkedCompanyName:companyUserData.linkedCompanyName,
                            value : companyUserData.userName,
                            label : companyUserData.userName
                        }
                        setUserList(userList => [...userList, companyUser]); 
                    });

                } catch(error){
                    console.log('Error')
                    console.log(error)
                }
            
        })();
    },[])

    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency
        }).format(number);
    }   

    const handleOptionChange = (option) => {

        (async () => {
            
            try{
                console.log('Option List Change')
                console.log(option)
                let idList = []
                for (let i = 0; i < selectedUserList.length; i++) {
                    let id = selectedUserList[i].id
                    idList.push(id)
                } 
          
                let q;

                if (idList.length == 0){

                    if ((option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))||(option.find(item => item.id === 1) && option.find(item => item.id === 2))||(option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // none 
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date"));
            
                    } else if ( (option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3))){
                        // invoiced true 
                        console.log('invoiced true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), orderBy("date"));
    
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 2) && option.find(item => item.id === 4))){
                        // invoiced false 
                        console.log('invoiced false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<=", endDate), orderBy("date"));
                
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable true 
                        console.log('billable true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), orderBy("date"));
                    
                    } else if  (( option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable false 
                        console.log('billable false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), orderBy("date"));
         
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 3)){
                        // billable true and invoiced true
                        console.log('billable true and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , true), where("date", "<=", endDate), orderBy("date"));
                
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 4)){
                        // billable true and invoiced false
                        console.log('billable true and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , false), where("date", "<=", endDate), orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2) && option.find(item => item.id === 3)){
                        // billable false and invoiced true
                        console.log('billable false and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , true), where("date", "<=", endDate), orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2)  && option.find(item => item.id === 4)){
                        // billable false and invoiced false
                        console.log('billable false and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , false),where("date", "<=", endDate), orderBy("date"));
                    
                    } else if ((option.find(item => item.id === 1))){
                        // billable true 
                        console.log('billable true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), orderBy("date"));
                    
                    } else if  ((option.find(item => item.id === 2))){
                        // billable false 
                        console.log('billable false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), orderBy("date"));
         
                    } else if (option.find(item => item.id === 3)){
                        // invoiced true 
                        console.log('invoiced true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), orderBy("date"));
    
                    } else if (option.find(item => item.id === 4)){
                        // invoiced false 
                        console.log(' invoiced false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<="), orderBy("date"));
                    
                    } else {
                        //none
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date"));
                    }

                } else {
                    console.log(idList)
                    if ((option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))||(option.find(item => item.id === 1) && option.find(item => item.id === 2))||(option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // none 
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
            
                    } else if ( (option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3))){
                        // invoiced true 
                        console.log('invoiced true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 2) && option.find(item => item.id === 4))){
                        // invoiced false 
                        console.log(' invoiced false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable true 
                        console.log('billable true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else if (( option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable false 
                        console.log('billable false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
         
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 3)){
                        // billable true and invoiced true
                        console.log('billable true and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , true), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 4)){
                        // billable true and invoiced false
                        console.log('billable true and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , false), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2) && option.find(item => item.id === 3)){
                        // billable false and invoiced true
                        console.log('billable false and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , true), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2)  && option.find(item => item.id === 4)){
                        // billable false and invoiced false
                        console.log('billable false and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else if ((option.find(item => item.id === 1))){
                        // billable true 
                        console.log('billable true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else if  ((option.find(item => item.id === 2))){
                        // billable false 
                        console.log('billable false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
         
                    } else if (option.find(item => item.id === 3)){
                        // invoiced true 
                        console.log('invoiced true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if (option.find(item => item.id === 4)){
                        // invoiced false 
                        console.log(' invoiced false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else {
                        //none
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    }

                }
                
                console.log('Getting Docs')

                const querySnapshot = await getDocs(q);
                let count = 1 
                setPurchaseList([])  
                querySnapshot.forEach((doc) => {
                    const purchaseData = doc.data()
                    const dateCreated = purchaseData.date.toDate();
                    const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                    const userData = {
                        id:purchaseData.id,
                        name:purchaseData.name,
                        invoiceNum:purchaseData.invoiceNum,
                        price:formatCurrency(purchaseData.price/100),
                        quantityString: purchaseData.quantityString,
                        techName:purchaseData.techName,
                        venderName:purchaseData.venderName,
                        date:formattedDate1,
                        receiptId:purchaseData.receiptId,
                        total: formatCurrency((purchaseData.price/100)*parseFloat(purchaseData.quantityString)),
                        billable:purchaseData.billable,
                        invoiced:purchaseData.invoiced,
                        customerName:purchaseData.customerName,
                    }
                    count = count + 1
                    setPurchaseList(purchaseList => [...purchaseList, userData]); 
                });
    
            } catch(error){
                console.log('Error')
                console.log(error)
            }
            setSelectedOption(option)

        })();
    };   

    const handleUserChange = (option) => {

        (async () => {

            try{
                console.log('User List Change')

                let idList = []
                for (let i = 0; i < option.length; i++) {
                    let id = option[i].id
                    idList.push(id)
                } 
          
                let q;

                if (idList.length == 0){

                    if ((option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))||(option.find(item => item.id === 1) && option.find(item => item.id === 2))||(option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // none 
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date"));
            
                    } else if ( (option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3))){
                        // invoiced true 
                        console.log('invoiced true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), orderBy("date"));
    
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 2) && option.find(item => item.id === 4))){
                        // invoiced false 
                        console.log('invoiced false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<=", endDate), orderBy("date"));
                
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable true 
                        console.log('billable true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), orderBy("date"));
                    
                    } else if  (( option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable false 
                        console.log('billable false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), orderBy("date"));
         
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 3)){
                        // billable true and invoiced true
                        console.log('billable true and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , true), where("date", "<=", endDate), orderBy("date"));
                
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 4)){
                        // billable true and invoiced false
                        console.log('billable true and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , false), where("date", "<=", endDate), orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2) && option.find(item => item.id === 3)){
                        // billable false and invoiced true
                        console.log('billable false and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , true), where("date", "<=", endDate), orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2)  && option.find(item => item.id === 4)){
                        // billable false and invoiced false
                        console.log('billable false and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , false),where("date", "<=", endDate), orderBy("date"));
                    
                    } else if ((option.find(item => item.id === 1))){
                        // billable true 
                        console.log('billable true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), orderBy("date"));
                    
                    } else if  ((option.find(item => item.id === 2))){
                        // billable false 
                        console.log('billable false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), orderBy("date"));
         
                    } else if (option.find(item => item.id === 3)){
                        // invoiced true 
                        console.log('invoiced true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), orderBy("date"));
    
                    } else if (option.find(item => item.id === 4)){
                        // invoiced false 
                        console.log(' invoiced false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<="), orderBy("date"));
                    
                    } else {
                        //none
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date"));
                    }

                } else {
                    console.log(idList)
                    if ((option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))||(option.find(item => item.id === 1) && option.find(item => item.id === 2))||(option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // none 
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
            
                    } else if ( (option.find(item => item.id === 1) && option.find(item => item.id === 2) && option.find(item => item.id === 3))){
                        // invoiced true 
                        console.log('invoiced true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 2) && option.find(item => item.id === 4))){
                        // invoiced false 
                        console.log(' invoiced false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                
                    } else if ((option.find(item => item.id === 1)&& option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable true 
                        console.log('billable true 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else if (( option.find(item => item.id === 2) && option.find(item => item.id === 3) && option.find(item => item.id === 4))){
                        // billable false 
                        console.log('billable false 1')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
         
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 3)){
                        // billable true and invoiced true
                        console.log('billable true and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , true), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                
                    } else if (option.find(item => item.id === 1) && option.find(item => item.id === 4)){
                        // billable true and invoiced false
                        console.log('billable true and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true), where('invoiced', '==' , false), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2) && option.find(item => item.id === 3)){
                        // billable false and invoiced true
                        console.log('billable false and invoiced true')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , true), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if  (option.find(item => item.id === 2)  && option.find(item => item.id === 4)){
                        // billable false and invoiced false
                        console.log('billable false and invoiced false')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),  where('invoiced', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else if ((option.find(item => item.id === 1))){
                        // billable true 
                        console.log('billable true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else if  ((option.find(item => item.id === 2))){
                        // billable false 
                        console.log('billable false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('billable', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
         
                    } else if (option.find(item => item.id === 3)){
                        // invoiced true 
                        console.log('invoiced true 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , true),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
    
                    } else if (option.find(item => item.id === 4)){
                        // invoiced false 
                        console.log(' invoiced false 2')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where('invoiced', '==' , false),where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    
                    } else {
                        //none
                        console.log('none')
                        q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", startDate), where("date", "<=", endDate), where('techId','in',idList) , orderBy("date"));
                    }

                }

                console.log('Getting Docs')

                const querySnapshot = await getDocs(q);
                let count = 1 
                setPurchaseList([])  
                querySnapshot.forEach((doc) => {
                    const purchaseData = doc.data()
                    const dateCreated = purchaseData.date.toDate();
                    const formattedDate1 = format(dateCreated, 'MM / d / yyyy'); 
                    const userData = {
                        id:purchaseData.id,
                        name:purchaseData.name,
                        invoiceNum:purchaseData.invoiceNum,
                        price:formatCurrency(purchaseData.price/100),
                        quantityString: purchaseData.quantityString,
                        techName:purchaseData.techName,
                        venderName:purchaseData.venderName,
                        date:formattedDate1,
                        receiptId:purchaseData.receiptId,
                        total: formatCurrency((purchaseData.price/100)*parseFloat(purchaseData.quantityString)),
                        billable:purchaseData.billable,
                        invoiced:purchaseData.invoiced,
                        customerName:purchaseData.customerName,
                    }
                    count = count + 1
                    setPurchaseList(purchaseList => [...purchaseList, userData]); 
                });
    
            } catch(error){
                console.log('Error')
                console.log(error)
            }
            setSelectedUserList(option)

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
            <div className='px-2 py-2'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to={`/company/purchasedItems/createNew`}
                >Create New</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#ffffff]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        {/* Search Bar */}
                        <input className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#ededed] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Search'  />
                        
                            <div className="w-1/3 text-[#000000]">
                                <Select
                                    closeMenuOnSelect={false}
                                    value={selectedOption}
                                    options={optionList}
                                    onChange={handleOptionChange}
                                    isMulti
                                    className="basic-multi-select"
                                    classNamePrefix="select"
                                />
        
                            </div>
                        {/* User List */}
                            <div className="w-1/3 text-[#000000]">
                                <Select
                                    closeMenuOnSelect={false}
                                    value={selectedUserList}
                                    options={userList}
                                    onChange={handleUserChange}
                                    isMulti
                                    className="basic-multi-select"
                                    classNamePrefix="select"
                                />
        
                            </div>
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
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Ref#</th>
                                    <th className='py-3 px-4'>Date</th>
                                    <th className='py-3 px-4'>Tech Name</th>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Price</th>
                                    <th className='py-3 px-4'>Quantity</th>
                                    <th className='py-3 px-4'>Total</th>
                                    <th className='py-3 px-4'>Billable</th>
                                    <th className='py-3 px-4'>Customer</th>
                                    <th className='py-3 px-4 sm:invisible md:visible lg:visible'>Vender Name</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                purchaseList?.map(purchase => (
                                    <tr key={purchase.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/receipts/detail/${purchase.receiptId}`}>{purchase.invoiceNum}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.date}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.techName}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.name}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.price}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.quantityString}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.total}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                            <Link to={`/company/purchasedItems/detail/${purchase.id}`}>
                                                {
                                                    purchase.billable ? <div>
                                                    {
                                                        purchase.invoiced ? <p className='bg-[#2B600F] rounded-md items-center flex justify-center'>Billed</p>:<p className='bg-[#9C0D38] rounded-md items-center flex justify-center'>Needs Invoice</p>
                                                    }
                                                    </div>:<p className='bg-[#2B600F] rounded-md items-center flex justify-center'>Not Billable</p>
                                                }
                                            </Link>
                                        </td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                            <Link to={`/company/purchasedItems/detail/${purchase.id}`}>
                                                {
                                                    purchase.billable ? <p className='py-3 px-4 font-medium whitespace-nonwrap'>{purchase.customerName}</p>:<p></p>
                                                }
                                            </Link>
                                        </td>
                                        <td className='py-3 px-4 sm:invisible md:visible lg:visible font-medium whitespace-nonwrap'><Link to={`/company/purchasedItems/detail/${purchase.id}`}>{purchase.venderName}</Link></td>
                                    </tr>
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                </div>
                <hr/>
            </div>
        </div>
    );
};

export default PurchasesList;