import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const JobDetailView = () => {
    const {jobId} = useParams();

    const {name,recentlySelectedCompany} = useContext(Context);

    const [edit,setEdit] = useState(false);

    const [newShoppingList,setNewShoppingList] = useState(false);

    const [newTask,setNewTask] = useState(false);

    const navigate = useNavigate()

    const [job,setJob] = useState({
        adminId : '',
        adminName : '',
        billingStatus : '',
        bodyOfWaterId : '',
        bodyOfWaterName : '',
        chemicals : '',
        customerId : '',
        description : '',
        electricalParts : '',
        equipmentId : '',
        equipmentName : '',
        id : '',
        installationParts : '',
        jobTemplateId : '',
        laborCost : '',
        miscParts : '',
        operationStatus : '',
        pvcParts : '',
        rate : '',
        serviceLocationId : '',
        serviceStopIds : '',
        type : ''
    });

    const [customer,setCustomer] = useState({
         id:'',
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
    
    const [serviceLocation,setServiceLocation] = useState({
        bodiesOfWaterId : '',
        gateCode : '',
        nickName : '',
        streetAddress : '',
        city : '',
        state : '',
        zip : '',
        billingNotes:  '',
        active : '',
        id : '',
    });

    const [selectedBodyOfWater,setSelectedBodyOfWater] = useState({
        bodiesOfWaterId : '',
        gateCode : '',
        nickName : '',
        streetAddress : '',
        city : '',
        state : '',
        zip : '',
        billingNotes:  '',
        active : '',
        id : '',
    });

    const [selectedEquipment,setSelectedEquipment] = useState({
        bodiesOfWaterId : '',
        gateCode : '',
        nickName : '',
        streetAddress : '',
        city : '',
        state : '',
        zip : '',
        billingNotes:  '',
        active : '',
        id : '',
    });

    const [selectedGenericItem,setSelectedGenericItem] = useState({
        UOM : "",
        billable : "",
        category : "",
        color : "",
        dateUpdated : "",
        description : "",
        id : "",
        name : "",
        rate : "",
        size : "",
        sku : "",
        storeName :  "",
        subCategory :  "",
        timesPurchased :  "",
        venderId :  "",
        label:  "",
    });

    const [selectedTaskType,setSelectedTaskType] = useState({
        id : '',
        name : '',
    });

    const [billingStatusList,setBillingStatusList] = useState([
        {
            id : 'Draft',
            name : 'Draft',
            label : 'Draft',
        }
        ,
        {
            id : 'Estimate',
            name : 'Estimate',
            label : 'Estimate',
        }
        ,
        {
            id : 'Accepted',
            name : 'Accepted',
            label : 'Accepted',
        }
        ,
        {
            id : 'In Progress',
            name : 'In Progress',
            label : 'In Progress',
        }
        ,
        {
            id : 'Invoiced',
            name : 'Invoiced',
            label : 'Invoiced',
        }
        ,
        {
            id : 'Paid',
            name : 'Paid',
            label : 'Paid',
        }
    ]);

    const [selectedBillingStatus,setSelectedBillingStatus] = useState( {
        id : 'Draft',
        name : 'Draft',
        label : 'Draft',
    });

    const [operationStatusList,setOperationStatusList] = useState([
        {
            id : 'Estimate Pending',
            name : 'Estimate Pending',
            label : 'Estimate Pending',
        }
        ,
        {
            id : 'Unscheduled',
            name : 'Unscheduled',
            label : 'Unscheduled',
        }
        ,
        {
            id : 'Scheduled',
            name : 'Scheduled',
            label : 'Scheduled',
        }
        ,
        {
            id : 'In Progress',
            name : 'In Progress',
            label : 'In Progress',
        }
        ,
        {
            id : 'Finished',
            name : 'Finished',
            label : 'Finished',
        }
    ]);

    const [selectedOperationStatus,setSelectedOperationStatus] = useState( {
        id : 'Draft',
        name : 'Draft',
        label : 'Draft',
    });

    const [formattedDateCreated,setFormattedDateCreated] = useState()

    const [description, setDescription] = useState();

    const [taskLaborCost, setTaskLaborCost] = useState();

    const [estimatedTime, setEstimatedTime] = useState();

    const [shoppingListTypes, setShoppingListTypes] = useState([
        {
            id : '1',
            name : 'Custom',
            label : 'Custom',
        },
        {
            id : '2',
            name : 'Generic',
            label : 'Generic',
        }
    ]);

    const [newShoppingItemType, setNewShoppingItemType] = useState({
        id : '',
        name : '',
    });

    const [selectedAdmin, setSelectedAdmin] = useState(''); //Object

    const [bodyOfWaterList, setBodyOfWaterList] = useState([]);

    const [equipmentList, setEquipmentList] = useState([]);
    
    const [taskTypeList, setTaskTypeList] = useState([]);

    const [taskList, setTaskList] = useState([]);

    const [shoppingList, setShoppingList] = useState([]);

    const [genericItemList, setGenericItemList] = useState([]);

    const [adminList, setAdminList] = useState([]);

    //PNL
    const [laborCost, setLaborCost] = useState(0.0);

    const [totalCost, setTotalCost] = useState(0.0);

    const [estimatedDuration, setEstimatedDuration] = useState(0);

    const [hourlyRate, setHourlyRate] = useState(50.00);

    const [employeeLaborCost, setEmployeeLaborCost] = useState('32.50');

    const [subcontractorCost, setSubcontractorCost] = useState('50');

    const [itemId, setItemId] = useState("");

    const [itemQuantity, setItemQuantity] = useState("");

    const [itemCost, setItemCost] = useState("");

    const [itemPrice, setItemPrice] = useState("");

    const [itemName, setItemName] = useState("");

    const [estimatedRate, setEstimatedRate] = useState('1200.00');

    const [offeredRate, setOfferedRate] = useState('1000'); 

    const [materialCost, setMaterialCost] = useState(0);

    const [estimatedProfit, setEstimatedProfit] = useState('$ 650.00 - $668.00');

    const [estimatedProfitPercentage, setEstimatedProfitPercentage] = useState('25% - 28%');

    // handleBodyOfWaterListChange

    // handleEquipmentListChange
    useEffect(() => {
        (async () => {
            try{
                //Get Job Information
                const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
                const docSnap = await getDoc(docRef);
                let customerId;
                let serviceLocationId;
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    setJob((prevJob) => ({
                        ...prevJob,
                        adminId: docSnap.data().adminId,
                        adminName: docSnap.data().adminName,
                        billingStatus: docSnap.data().billingStatus,
                        bodyOfWaterId: docSnap.data().bodyOfWaterId,
                        bodyOfWaterName : docSnap.data().bodyOfWaterName,
                        chemicals : docSnap.data().chemicals,
                        customerId : docSnap.data().customerId,
                        description : docSnap.data().description,
                        electricalParts : docSnap.data().electricalParts,
                        equipmentId : docSnap.data().equipmentId,
                        equipmentName : docSnap.data().equipmentName,
                        id : docSnap.data().id,
                        internalId : docSnap.data().internalId,
                        installationParts : docSnap.data().installationParts,
                        jobTemplateId : docSnap.data().jobTemplateId,
                        laborCost : docSnap.data().laborCost,
                        miscParts : docSnap.data().miscParts,
                        operationStatus : docSnap.data().operationStatus,
                        pvcParts : docSnap.data().pvcParts,
                        rate : docSnap.data().rate,
                        serviceLocationId : docSnap.data().serviceLocationId,
                        serviceStopIds : docSnap.data().serviceStopIds,
                        type : docSnap.data().type,

                    }));
                    setSelectedOperationStatus({
                        id : docSnap.data().operationStatus,
                        name : docSnap.data().operationStatus,
                        label : docSnap.data().operationStatus,
                    })
                    setSelectedBillingStatus({
                        id : docSnap.data().billingStatus,
                        name : docSnap.data().billingStatus,
                        label : docSnap.data().billingStatus,
                    })
                    const dateCreated = docSnap.data().dateCreated.toDate();
                    const formattedDateCreated = format(dateCreated, 'MMMM d, yyyy'); 
                    setFormattedDateCreated(formattedDateCreated)
                    customerId = docSnap.data().customerId
                    serviceLocationId = docSnap.data().serviceLocationId
                    console.log("ReceivedJob Information")

                } else {
                  console.log("No such document!");
                }

                //Get Customer Information
                const customerDocRef = doc(db, "companies",recentlySelectedCompany,'customers',customerId);
                const customerDocSnap = await getDoc(customerDocRef);
                if (customerDocSnap.exists()) {
                    setCustomer((prevCustomer) => ({
                        ...prevCustomer,
                        id: customerDocSnap.data().id,
                        firstName: customerDocSnap.data().firstName,
                        lastName: customerDocSnap.data().lastName,
                        phoneNumber: customerDocSnap.data().phoneNumber,
                        email: customerDocSnap.data().email,
                        billingStreetAddress : customerDocSnap.data().billingAddress.streetAddress,
                        billingCity : customerDocSnap.data().billingAddress.city,
                        billingState : customerDocSnap.data().billingAddress.state,
                        billingZip : customerDocSnap.data().billingAddress.zip,
                        billingNotes : customerDocSnap.data().billingNotes,
                        active : customerDocSnap.data().active,
                        verified : customerDocSnap.data().verified,
                    }));
                    console.log("Retrived Customer information")

                } else {
                    console.log("No such document!");
                }

                //Get Site Information
                const serviceLocationDocRef = doc(db, "companies",recentlySelectedCompany,'serviceLocations',serviceLocationId);
                const serviceLocationDocSnap = await getDoc(serviceLocationDocRef);
                if (serviceLocationDocSnap.exists()) {
                    setServiceLocation((prevServiceLocation) => ({
                        ...prevServiceLocation,
                        bodiesOfWaterId: serviceLocationDocSnap.data().bodiesOfWaterId,
                        gateCode: serviceLocationDocSnap.data().gateCode,
                        nickName: serviceLocationDocSnap.data().nickName,
                        streetAddress : serviceLocationDocSnap.data().address.streetAddress,
                        city : serviceLocationDocSnap.data().address.city,
                        state : serviceLocationDocSnap.data().address.state,
                        zip : serviceLocationDocSnap.data().address.zip,
                        billingNotes : serviceLocationDocSnap.data().address,
                        active : serviceLocationDocSnap.data().active,
                    }));
                    
                    console.log("Retrived site information")
                } else {
                    console.log("No such document!");
                }
                //Get Task Types
                let taskTypeQuery = query(collection(db, 'universal','settings','taskTypes'));
                const taskTypeQuerySnapshot = await getDocs(taskTypeQuery);       
                setTaskTypeList([])      
                taskTypeQuerySnapshot.forEach((doc) => {
                    const taskTypeData = doc.data()
                    const taskType = {
                        id:taskTypeData.id,
                        name:taskTypeData.name,
                        label:taskTypeData.name,

                    }
                    setTaskTypeList(taskTypeList => [...taskTypeList, taskType]); 
                });
                    
                console.log("Retrived Task Types")

                //Get Task List
                let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'tasks'));
                const taskQuerySnapshot = await getDocs(taskQuery);       
                setTaskList([])      
                taskQuerySnapshot.forEach((doc) => {
                    const taskData = doc.data()
                    const task = {
                        id : taskData.id,
                        name : taskData.name,
                        type : taskData.type,
                        workerType : taskData.workerType,
                        workerName : taskData.workerName,
                        status : taskData.status,
                        customerApproval : taskData.customerApproval,
                        laborContractId : taskData.laborContractId,
                        serviceStopId : taskData.serviceStopId,
                        contractedRate : taskData.contractedRate,
                        estimatedTime : taskData.estimatedTime
                    }
                    setTaskList(taskList => [...taskList, task]); 
                });
                    
                console.log("Retrived Task List")

                //Get shopping list items
                let taskQuery2 = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'items'));
                const querySnapshot2 = await getDocs(taskQuery2);       
                setShoppingList([])      
                querySnapshot2.forEach((doc) => {
                    const itemData = doc.data()
                    const item = {
                        id : itemData.id,
                        name : itemData.name,
                        cost : itemData.cost,
                        price : itemData.price,
                        itemId : itemData.itemId,
                        itemType : itemData.itemType,
                        quantity : itemData.quantity, //Enum : ????????
                    }
                    setShoppingList(shoppingList => [...shoppingList, item]); 
                });
                    
                console.log("Retrived Shopping List")

                //Calculate Labor Cost

                let totalLaborCost = 0 
                let totalDuration = 0

                for (let i = 0; i < taskList.length; i++) {
                    let task = taskList[i]
                    totalLaborCost = totalLaborCost + task.contractedRate
                    totalDuration = totalDuration + task.estimatedTime

                }
                
                totalLaborCost = totalLaborCost / 100 
                totalDuration = totalDuration /60

                console.log("Calculated Labor Cost")
                //Calculate Material Cost
                console.log( 1 )
                let totalMaterialCost = 0 
                let totalMaterialPrice = 0
    
                for (let i = 0; i < shoppingList.length; i++) {
                    let item = shoppingList[i]
                    let lineItemTotalCost = item.cost * item.quantity
                    let lineItemTotalPrice = item.price * item.quantity
                    totalMaterialCost = totalMaterialCost + lineItemTotalCost
                    totalMaterialPrice = totalMaterialPrice + lineItemTotalPrice
                }
                totalMaterialCost = totalMaterialCost / 100 
                totalMaterialPrice = totalMaterialPrice /100
    

                console.log("Calculated Material Cost")

                // Calculate PNL
                let totalCost = 0 
                let totalRate = offeredRate
                let totalProfit = 0
                let profitPercentage = 0

                totalCost = totalMaterialCost + totalLaborCost
                totalProfit = totalRate - totalCost
                profitPercentage = totalProfit/totalRate
                console.log( 5 )

                profitPercentage = profitPercentage.toFixed(2)
                totalMaterialCost = totalMaterialCost.toFixed(2)
                totalMaterialPrice = totalMaterialPrice.toFixed(2)
                console.log( 10 )

                totalDuration = totalDuration.toFixed(2)
                totalLaborCost = totalLaborCost.toFixed(2)
                totalCost = totalCost.toFixed(2)

                console.log("Calculated PNL")

                setTotalCost(totalCost)
                setMaterialCost(totalMaterialCost)
                setLaborCost(totalLaborCost)
                setEstimatedDuration(totalDuration)
                let formattedProfitUSD = formatCurrency(totalProfit);
        
                setEstimatedProfit(formattedProfitUSD)
                setEstimatedProfitPercentage((profitPercentage*100).toFixed(2))

                console.log("Finished Job Detail View Start Up ")

            } catch(error){
                console.log('Error Location useEffect Job Detail View')
            }
        })();
    },[])

    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency
        }).format(number);
      }

    async function recalculatePNL(e) {
        e.preventDefault()
        setOfferedRate(estimatedRate)
        // Calculate PNL
        let totalRate = offeredRate
        let totalProfit = 0
        let profitPercentage = 0

        totalProfit = totalRate - totalCost
        profitPercentage = totalProfit/totalRate

        let formattedProfitUSD = formatCurrency(totalProfit);

        setEstimatedProfit(formattedProfitUSD)
        setEstimatedProfitPercentage((profitPercentage*100).toFixed(2))
    }
    async function editJob(e) {
        e.preventDefault()
        try{
            setEdit(true);
            
            //Get Company Users
            let userQuery = query(collection(db, "companies",recentlySelectedCompany,'companyUsers'));//.where('workerType','==','Employee')
            const userQuerySnapshot = await getDocs(userQuery);       
            setAdminList([])      
            userQuerySnapshot.forEach((doc) => {
                const taskData = doc.data()
                const user = {
                    id : taskData.id,
                    name : taskData.userName,
                    dateCreated : taskData.dateCreated,
                    linkedCompanyId : taskData.linkedCompanyId,
                    linkedCompanyName : taskData.linkedCompanyName,
                    roleId : taskData.roleId,
                    roleName : taskData.roleName,
                    status : taskData.status,
                    userId : taskData.userId,
                    userName : taskData.userName,
                    workerType : taskData.workerType,
                    label : taskData.userName + ' - ' + taskData.roleName
                }
                setAdminList(adminList => [...adminList, user]); 
            });
        } catch(error){
            console.log('Error')
        }
    }
    const cancelEditJob = (event) => {
        setEdit(false);
    }
    async function saveEditChanges(e) {
        e.preventDefault()
        setEdit(false);
        try{
            // await deleteDoc(doc(db, "companies",recentlySelectedCompany,'workOrders',jobId));
            //Update Firestore
            const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
            console.log('save Edit Changes')
            console.log(selectedAdmin)

            await updateDoc(docRef, {
                adminName: selectedAdmin.name,
                adminId: selectedAdmin.id,

            });
            console.log('Successfully Update Doc')

            //Get Updated Job Information
            const docSnap = await getDoc(docRef);
            let customerId;
            let serviceLocationId;
            if (docSnap.exists()) {
                console.log("Document data:", docSnap.data());
                setJob((prevJob) => ({
                    ...prevJob,
                    adminId: docSnap.data().adminId,
                    adminName: docSnap.data().adminName,
                    billingStatus: docSnap.data().billingStatus,
                    bodyOfWaterId: docSnap.data().bodyOfWaterId,
                    bodyOfWaterName : docSnap.data().bodyOfWaterName,
                    chemicals : docSnap.data().chemicals,
                    customerId : docSnap.data().customerId,
                    description : docSnap.data().description,
                    electricalParts : docSnap.data().electricalParts,
                    equipmentId : docSnap.data().equipmentId,
                    equipmentName : docSnap.data().equipmentName,
                    id : docSnap.data().id,
                    installationParts : docSnap.data().installationParts,
                    jobTemplateId : docSnap.data().jobTemplateId,
                    laborCost : docSnap.data().laborCost,
                    miscParts : docSnap.data().miscParts,
                    operationStatus : docSnap.data().operationStatus,
                    pvcParts : docSnap.data().pvcParts,
                    rate : docSnap.data().rate,
                    serviceLocationId : docSnap.data().serviceLocationId,
                    serviceStopIds : docSnap.data().serviceStopIds,
                    type : docSnap.data().type,

                }));
                const dateCreated = docSnap.data().dateCreated.toDate();
                const formattedDateCreated = format(dateCreated, 'MMMM d, yyyy'); 
                setFormattedDateCreated(formattedDateCreated)
                customerId = docSnap.data().customerId
                serviceLocationId = docSnap.data().serviceLocationId
                console.log("Successfully Received Job Information")

            } else {
                console.log("No such document!");
            }
        } catch(error){
            console.log('Error')
        }
    }
    async function deleteJob(e) {
        e.preventDefault()
        try{
            await deleteDoc(doc(db, "companies",recentlySelectedCompany,'workOrders',jobId));
            navigate('/company/jobs')
            } catch(error){
                console.log('Error')
            }
    }

    const handleBodyOfWaterListChange = (selectedOption2) => {

        (async () => {
            setBodyOfWaterList(selectedOption2)
            
        })();
    };

    const handleEquipmentListChange = (selectedOption2) => {

        (async () => {
            setEquipmentList(selectedOption2)
            
        })();
    };

    const handleSelectedOperationStatus = (selectedOption2) => {

        (async () => {
            setSelectedOperationStatus(selectedOption2)
            const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
            console.log('Save Edit Changes')
            console.log(selectedOption2)

            await updateDoc(docRef, {
                operationStatus: selectedOption2.name,

            });
            toast.success("Updated Operation Status")
            console.log('Successfully Update Doc')
            //Get Updated Job Information
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                console.log("Document data:", docSnap.data());
                setJob((prevJob) => ({
                    ...prevJob,
                    billingStatus: docSnap.data().billingStatus,
                    operationStatus : docSnap.data().operationStatus,
                }));

            } else {
                console.log("No such document!");
            }
            
        })();
    };

    const handleSelectedBillingStatus = (selectedOption2) => {

        (async () => {
            setSelectedBillingStatus(selectedOption2)
            const docRef = doc(db, "companies",recentlySelectedCompany,'workOrders',jobId);
            console.log('Save Edit Changes')
            console.log(selectedOption2)

            await updateDoc(docRef, {
                billingStatus: selectedOption2.name,

            });
            toast.success("Updated Billing Status")
            console.log('Successfully Update Doc')
            //Get Updated Job Information
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                console.log("Document data:", docSnap.data());
                setJob((prevJob) => ({
                    ...prevJob,
                    billingStatus: docSnap.data().billingStatus,
                    operationStatus : docSnap.data().operationStatus,
                }));

            } else {
                console.log("No such document!");
            }
        })();
    };

    // Task Functions
    const handleSelectedTaskTypeChange = (selectedOption2) => {

        (async () => {
            setSelectedTaskType(selectedOption2)
            
        })();
    };

    async function showNewTaskItem(e) {
        setNewTask(true)
    }

    async function clearNewTask(e) {
        e.preventDefault()
        setSelectedTaskType({})
        setDescription('')
        setTaskLaborCost('')
        setNewTask(false)

    }

    async function handleAddTask(e) {
        e.preventDefault()
        try{
            // Create New Task
            console.log('Create New Task')
            let id = 'comp_wo_tas_' + uuidv4();

            //Guard Statments Based on Task
            //Switch Statment Based ON TaskType            
            let laborCostInt = parseFloat(taskLaborCost);
            laborCostInt = laborCostInt*100
            let estimatedTimeMin = parseFloat(estimatedTime);

            await setDoc(doc(db, "companies",recentlySelectedCompany, "workOrders",jobId,'tasks',id), {
                id : id,
                name : description,
                type : selectedTaskType.name,
                workerType : '',
                workerId : '',
                workerName : '',
                status : 'Unassigned',
                customerApproval : false,
                contractedRate : laborCostInt,
                laborContractId : '',
                estimatedTime : estimatedTimeMin,
                actualTime : '',
                equipmentId : '',
                serviceLocationId : '',
                bodyOfWaterId : '',
                serviceStopId : ''
              });
              console.log('Added New Task')

            //Get Task
            let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'tasks'));
            const querySnapshot = await getDocs(taskQuery);       
            setTaskList([])      
            querySnapshot.forEach((doc) => {
                const taskData = doc.data()
                const task = {
                    id : taskData.id,
                    name : taskData.name,
                    type : taskData.type, //Enum : workOrderTaskType
                    workerType : taskData.workerType,
                    workerId : taskData.workerId,
                    workerName : taskData.workerName,
                    status : taskData.status, //Enum : laborContractTaskStatus
                    customerApproval : taskData.customerApproval,
                    laborContractId : taskData.laborContractId,
                    contractedRate : taskData.contractedRate,
                    estimatedTime : taskData.estimatedTime,
                    actualTime : '',
                    equipmentId : '',
                    serviceLocationId : '',
                    bodyOfWaterId : '',
                    serviceStopId : taskData.serviceStopId
                }
                setTaskList(taskList => [...taskList, task]); 
            });
            console.log('Received New Tasks')

            setSelectedTaskType({})
            setDescription('')
            setTaskLaborCost('')
            setEstimatedTime('')

            //Calculate Labor Cost

            let totalLaborCost = 0 
            let totalDuration = 0

            for (let i = 0; i < taskList.length; i++) {
                let task = taskList[i]
                totalLaborCost = totalLaborCost + task.contractedRate
                totalDuration = totalDuration + task.estimatedTime

            }
            totalLaborCost = totalLaborCost / 100 
            totalDuration = totalDuration /60

            // Calculate PNL
            let totalCost = 0 
            let totalRate = offeredRate
            let totalProfit = 0
            let profitPercentage = 0

            totalCost = materialCost + totalLaborCost
            totalProfit = totalRate - totalCost
            profitPercentage = totalProfit/totalRate
            console.log( 5 )

            profitPercentage = profitPercentage.toFixed(2)
            console.log( 10 )

            totalDuration = totalDuration.toFixed(2)
            console.log( 15 )

            totalLaborCost = totalLaborCost.toFixed(2)
            console.log( 20 )

            totalCost = totalCost.toFixed(2)
            console.log( 25 )

            setTotalCost(totalCost)
            setLaborCost(totalLaborCost)
            console.log( 30 )

            setEstimatedDuration(totalDuration)
            let formattedProfitUSD = formatCurrency(totalProfit);
            console.log( 40 )

            setEstimatedProfit(formattedProfitUSD)
            setEstimatedProfitPercentage((profitPercentage*100).toFixed(2))

        } catch(error){
            console.log('Error')
        }
    }

    async function deleteTaskItem(e,id) {
        e.preventDefault()
        try{
            //Delete Task
            await deleteDoc(doc(db, "companies",recentlySelectedCompany, "workOrders",jobId,'tasks',id));
            toast.success('Successfully Deleted Task') 

             //Get New Tasks
             let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'tasks'));
             const querySnapshot = await getDocs(taskQuery);       
             setTaskList([])      
             querySnapshot.forEach((doc) => {
                 const taskData = doc.data()
                 const task = {
                     id : taskData.id,
                     name : taskData.name,
                     type : taskData.type, //Enum : workOrderTaskType
                     workerType : taskData.workerType,
                     workerId : taskData.workerId,
                     workerName : taskData.workerName,
                     status : taskData.status, //Enum : laborContractTaskStatus
                     customerApproval : taskData.customerApproval,
                     laborContractId : taskData.laborContractId,
                     contractedRate : taskData.contractedRate,
                     estimatedTime : taskData.estimatedTime,
                     actualTime : '',
                     equipmentId : '',
                     serviceLocationId : '',
                     bodyOfWaterId : '',
                     serviceStopId : taskData.serviceStopId
                 }
                 setTaskList(taskList => [...taskList, task]); 
             });
             console.log('Received New Tasks')
 
             setSelectedTaskType({})
             setDescription('')
             setTaskLaborCost('')
             setEstimatedTime('')
 
             //Calculate Labor Cost
 
             let totalLaborCost = 0 
             let totalDuration = 0
 
             for (let i = 0; i < taskList.length; i++) {
                 let task = taskList[i]
                 totalLaborCost = totalLaborCost + task.contractedRate
                 totalDuration = totalDuration + task.estimatedTime
 
             }
             totalLaborCost = totalLaborCost / 100 
             totalDuration = totalDuration /60
 
             // Calculate PNL
             let totalCost = 0 
             let totalRate = offeredRate
             let totalProfit = 0
             let profitPercentage = 0
 
             totalCost = materialCost + totalLaborCost
             totalProfit = totalRate - totalCost
             profitPercentage = totalProfit/totalRate
             console.log( 5 )
 
             profitPercentage = profitPercentage.toFixed(2)
             console.log( 10 )
 
             totalDuration = totalDuration.toFixed(2)
             console.log( 15 )
 
             totalLaborCost = totalLaborCost.toFixed(2)
             console.log( 20 )
 
             totalCost = totalCost.toFixed(2)
             console.log( 25 )
 
             setTotalCost(totalCost)
             setLaborCost(totalLaborCost)
             console.log( 30 )
 
             setEstimatedDuration(totalDuration)
             let formattedProfitUSD = formatCurrency(totalProfit);
             console.log( 40 )
 
             setEstimatedProfit(formattedProfitUSD)
             setEstimatedProfitPercentage((profitPercentage*100).toFixed(2))
          } catch(error){
              console.log('Error')
          }
    }

    // Shopping List functions
    
    const handleSelectedGenericItemChange = (selectedOption2) => {

        (async () => {
            setSelectedGenericItem(selectedOption2)
            setItemId(selectedOption2.id)
            setItemCost(selectedOption2.rate)
            setItemPrice(selectedOption2.rate)
            setItemName(selectedOption2.name)
        })();
    };

    const handleSelectedShoppingItemTypeChange = (selectedOption2) => {

        (async () => {

            setNewShoppingItemType(selectedOption2)
            //Get Generic Data Base Items
            // /companies/B06BD6B7-B23E-43BE-A637-7A824C48D0B7/settings/dataBase
            let genericItemQuery = query(collection(db, "companies",recentlySelectedCompany,'settings','dataBase','dataBase'));
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
                    label: itemData.name + ' ' + itemData.rate
                }
                setGenericItemList(genericItemList => [...genericItemList, genericItem]); 
            });
        })();
    };

    async function showNewShoppingListItem(e) {
        setNewShoppingList(true)
    }

    async function clearNewShoppingListItem(e) {
        e.preventDefault()
        setNewShoppingList(false)
    }

    async function handleAddShoppingListItem(e) {
        e.preventDefault()
        try{
            // CreateShoppingItem
            let id = 'comp_wo_ite_' + uuidv4();

            //Guard Statments Based on Item
            //Switch Statment Based ON Item Type
            let cost = parseFloat(itemCost);

            let price = parseFloat(itemPrice);

            let quantity = parseInt(itemQuantity);
            cost = cost*100

            price = price*100
            await setDoc(doc(db, "companies",recentlySelectedCompany, "workOrders",jobId,'items',id), {
                id : id,
                name : itemName,
                cost : cost,
                price : price,
                itemId : itemId,
                itemType : newShoppingItemType.name,
                quantity : quantity,
                status : 'Not Purchased'
              });

            //Get new shopping list items

            let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'items'));
            const querySnapshot = await getDocs(taskQuery);       
            setShoppingList([])      
            querySnapshot.forEach((doc) => {
                const itemData = doc.data()
                const item = {
                    id : itemData.id,
                    name : itemData.name,
                    cost : itemData.cost,
                    price : itemData.price,
                    itemId : itemData.itemId,
                    itemType : itemData.itemType, //Enum : ????????
                    quantity : itemData.quantity,
                }
                setShoppingList(shoppingList => [...shoppingList, item]); 
            });
            //Clear Fields
            setNewShoppingList(false)
            setItemName('')
            setItemQuantity('')
            setItemPrice('')
            setItemCost('')

                //Calculate Material Cost
                console.log( 1 )
                let totalMaterialCost = 0 
                let totalMaterialPrice = 0
    
                for (let i = 0; i < shoppingList.length; i++) {
                    let item = shoppingList[i]
                    let lineItemTotalCost = item.cost * item.quantity
                    let lineItemTotalPrice = item.price * item.quantity
                    totalMaterialCost = totalMaterialCost + lineItemTotalCost
                    totalMaterialPrice = totalMaterialPrice + lineItemTotalPrice
                }
                totalMaterialCost = totalMaterialCost / 100 
                totalMaterialPrice = totalMaterialPrice /100
    

                // Calculate PNL
                let totalCost = 0 
                let totalRate = offeredRate
                let totalProfit = 0
                let profitPercentage = 0

                totalCost = totalMaterialCost + laborCost
                totalProfit = totalRate - totalCost
                profitPercentage = totalProfit/totalRate
                console.log( 5 )

                profitPercentage = profitPercentage.toFixed(2)
                totalMaterialCost = totalMaterialCost.toFixed(2)
                totalMaterialPrice = totalMaterialPrice.toFixed(2)
                console.log( 10 )

                totalCost = totalCost.toFixed(2)
                console.log( 15 )

                setTotalCost(totalCost)
                setMaterialCost(totalMaterialCost)
                let formattedProfitUSD = formatCurrency(totalProfit);
        
                setEstimatedProfit(formattedProfitUSD)
                setEstimatedProfitPercentage((profitPercentage*100).toFixed(2))
          } catch(error){
              console.log('Error')
          }
    }

    async function deleteShoppingListItem(e,id) {
        e.preventDefault()
        try{
            //Delete Task
            await deleteDoc(doc(db, "companies",recentlySelectedCompany, "workOrders",jobId,'items',id));

            toast.success('Successfully Deleted Item') 


            //Get new shopping list items

            let taskQuery = query(collection(db, "companies",recentlySelectedCompany,'workOrders',jobId,'items'));
            const querySnapshot = await getDocs(taskQuery);       
            setShoppingList([])      
            querySnapshot.forEach((doc) => {
                const itemData = doc.data()
                const item = {
                    id : itemData.id,
                    name : itemData.name,
                    cost : itemData.cost,
                    price : itemData.price,
                    itemId : itemData.itemId,
                    itemType : itemData.itemType, //Enum : ????????
                    quantity : itemData.quantity,
                }
                setShoppingList(shoppingList => [...shoppingList, item]); 
            });
            //Clear Fields
            setNewShoppingList(false)
            setItemName('')
            setItemQuantity('')
            setItemPrice('')
            setItemCost('')

                //Calculate Material Cost
                console.log( 1 )
                let totalMaterialCost = 0 
                let totalMaterialPrice = 0
    
                for (let i = 0; i < shoppingList.length; i++) {
                    let item = shoppingList[i]
                    let lineItemTotalCost = item.cost * item.quantity
                    let lineItemTotalPrice = item.price * item.quantity
                    totalMaterialCost = totalMaterialCost + lineItemTotalCost
                    totalMaterialPrice = totalMaterialPrice + lineItemTotalPrice
                }
                totalMaterialCost = totalMaterialCost / 100 
                totalMaterialPrice = totalMaterialPrice /100
    

                // Calculate PNL
                let totalCost = 0 
                let totalRate = offeredRate
                let totalProfit = 0
                let profitPercentage = 0

                totalCost = totalMaterialCost + laborCost
                totalProfit = totalRate - totalCost
                profitPercentage = totalProfit/totalRate
                console.log( 5 )

                profitPercentage = profitPercentage.toFixed(2)
                totalMaterialCost = totalMaterialCost.toFixed(2)
                totalMaterialPrice = totalMaterialPrice.toFixed(2)
                console.log( 10 )

                totalCost = totalCost.toFixed(2)
                console.log( 15 )

                setTotalCost(totalCost)
                setMaterialCost(totalMaterialCost)
                let formattedProfitUSD = formatCurrency(totalProfit);
        
                setEstimatedProfit(formattedProfitUSD)
                setEstimatedProfitPercentage((profitPercentage*100).toFixed(2))
          } catch(error){
              console.log('Error')
          }
    }

    const handleAdminChange = (option) => {

        (async () => {
            setSelectedAdmin(option)
            
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
        // 919191 = gray
        <div className='px-2 md:px-7 py-5'>
            <Link 
            className=' font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#1D2E76] cursor-pointer rounded mt-3'
            to={`/company/jobs`}>Back</Link>
            {
                edit ? <div className=' flex justify-between py-1'>
                            <div className='py-1'>
                                <div className='w-full flex justify-between py-1'>
                                    <button onClick={(e) =>{saveEditChanges(e)}} className='bg-[#2B600F] cursor-pointer rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Save</h1></button>
                                </div>
                            </div> 
                        <div className='py-1'>
                            <div className='w-full flex justify-between py-1'>
                                <button onClick={(e) =>{cancelEditJob(e)}} className='bg-[#9C0D38] cursor-pointer rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Cancel</h1></button>
                            </div>
                            <div className='w-full flex justify-between py-1'>
                                <button 
                                // onClick={(e) =>{deleteCustomer(e)}} 
                                onClick={(e) => deleteJob(e)}
                                className='bg-[#9C0D38] cursor-pointer rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Delete</h1></button>
                            </div>
                        </div> 
                    </div>: <div className='w-full flex justify-between'>
                        <h1></h1>
                        <button onClick={(e) =>{editJob(e)}} className='bg-[#1D2E76] cursor-pointer font-normal ml-2 rounded'><h1 className='font-bold text-[#ffffff] px-4 py-1 text-base'>Edit</h1></button>
                    </div>
            }
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Job Detail View :{job.internalId}</p>
                    <hr/>
                    
                    <p>Date Created : {formattedDateCreated}</p>

                    {/* Admin */}
                    {
                        (edit===true)&&<div>
                            <Select
                            value={selectedAdmin}
                            options={adminList}
                            onChange={handleAdminChange}
                            isSearchable
                            placeholder="Select An Admin"
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
                    }
                    {
                        (edit===false)&&<div>
                            <p>Admin : {job.adminName}</p>
                        </div>
                    }
                    <p>Customer : {customer.firstName} {customer.lastName}</p>
                    <div className='flex w-full justify-start items-center py-2'>
                        <p>Billing Status :  </p>
                        <div className='px-2'>
                            {
                                (job.billingStatus==='Draft')&&<div>
                                    <p className='py-1 px-2 bg-[#919191] text-[#] rounded-md'>Draft</p>
                                </div>
                            }
                            {
                                (job.billingStatus==='Estimate')&&<div>
                                    <p className='py-1 px-2 bg-[#CDC07B] text-[#] rounded-md'>Estimate</p>
                                </div>
                            }
                            {
                                (job.billingStatus==='Accepted')&&<div>
                                    <p className='py-1 px-2 bg-[#2B600F] text-[#] rounded-md'>Accepted</p>
                                </div>
                            }
                            {
                                (job.billingStatus==='In Progress')&&<div>
                                    <p className='py-1 px-2 bg-[#CDC07B] text-[#] rounded-md'>In Progress</p>
                                </div>
                            }
                            {
                                (job.billingStatus==='Invoiced')&&<div>
                                    <p className='py-1 px-2 bg-[#1D2E76] text-[#] rounded-md'>Invoiced</p>
                                </div>
                            }
                            {
                                (job.billingStatus==='Paid')&&<div>
                                    <p className='py-1 px-2 bg-[#2B600F] text-[#] rounded-md'>Paid</p>
                                </div>
                            }
                        </div>
                        <div className="flex px-2 justify-between">
                            <div className="px-2">
                            <Select
                                value={selectedBillingStatus}
                                options={billingStatusList}
                                onChange={handleSelectedBillingStatus}
                                isSearchable
                                placeholder="Select a Status"
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
                    </div>
                    <div className='flex w-full justify-start items-center py-2'>
                        <p>Operational Status :  </p>
                        <div className='px-2'>
                        {
                                (job.operationStatus==='Estimate Pending')&&<div>
                                    <p className='py-1 px-2 bg-[#919191] text-[#000000] rounded-md'>Estimate Pending</p>
                                </div>
                            }
                            {
                                (job.operationStatus==='Unscheduled')&&<div>
                                    <p className='py-1 px-2 bg-[#CDC07B] text-[#] rounded-md'>Unscheduled</p>
                                </div>
                            }
                            {
                                (job.operationStatus==='Scheduled')&&<div>
                                    <p className='py-1 px-2 bg-[#1D2E76] text-[#] rounded-md'>Scheduled</p>
                                </div>
                            }
                            {
                                (job.operationStatus==='In Progress')&&<div>
                                    <p className='py-1 px-2 bg-[#1D2E76] text-[#] rounded-md'>In Progress</p>
                                </div>
                            }
                            {
                                (job.operationStatus==='Finished')&&<div>
                                    <p className='py-1 px-2 bg-[#2B600F] text-[#] rounded-md'>Finished</p>
                                </div>
                            }
                        </div>
                        <div className="flex px-2 justify-between">
                            <div className="px-2">
                            <Select
                                value={selectedOperationStatus}
                                options={operationStatusList}
                                onChange={handleSelectedOperationStatus}
                                isSearchable
                                placeholder="Select a Status"
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
                    </div>
                </div>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Site Information</p>
                    <hr/>
                    <div>
                    <button                 
                    onClick={async () => {
                        const address = serviceLocation.streetAddress + ' ' + serviceLocation.city + ' ' + serviceLocation.state + ' ' + serviceLocation.zip
                        const urlAddress = address.replace(" ", "+")
                        const url = 'https://www.google.com/maps/place/' + urlAddress
    
                        if (url) {
                            window.location.href = url;
                        }
                    }}>{serviceLocation.streetAddress} {serviceLocation.city} {serviceLocation.state} {serviceLocation.zip}</button>
                    </div>
                    <p>Gate Code : {serviceLocation.gateCode}</p>
                    <p>Description : {job.description}</p>
                </div>
            </div>

            {/* Task List */}
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between'>
                        <p className='font-bold'>Task List</p>
                        <div>
                            <div className='py-1'>
                                <p className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'>
                                    <Link to={`/company/serviceStops/createNew/${jobId}`}>Schedule Service Stop</Link>  
                                </p>
                            </div>
                            <div className='py-1'>
                                <p className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'>
                                    <Link to={`/company/laborContracts/createNew/${jobId}`}>Create Labor Contract</Link>  
                                </p>
                            </div>
                        </div>
                        <div>
                            <p className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'>
                                <Link to={`/company/jobs/history/${jobId}`}>See History</Link>  
                            </p>
                        </div>
                    </div>
                    <hr/>
                    <p>Process: Creates New Labor Contract. 
                        Has List of Tasks. Assigns Task to Labor Contract. 
                        Offers to Individual Contractor Or Posts on board (private Board or public Board)
                        please track Phases Unassigned Offered accepted scheduled in Progress finished
                    </p>
                    <hr/>
                    <p>On Task List Change. The Customer Has to Approve the Change Order and the New Cost</p>
                    <hr/>
                    <p>Should I prevent Offering or scheduling until I have the customer Approval</p>
                    <hr/>
                    <p>{job.serviceStopIds} - serviceStopIds</p>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Type</th>
                                <th className='py-3 px-4'>Status</th>
                                <th className='py-3 px-4 sm:hidden md:hidden'>Worker</th>
                                <th className='py-3 px-4 sm:hidden md:hidden'>Worker Type</th>
                                <th className='py-3 px-4 sm:hidden md:hidden'>Customer Approval</th>
                                <th className='py-3 px-4'>Labor Cost</th>
                                <th className='py-3 px-4'>Time (Hr)</th>
                                <th className='py-3 px-4'></th>

                            </tr>
                        </thead>
                        <tbody>
                        {
                            taskList?.map(task => (
                                <tr key={task.id}>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.name}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{task.type}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        {
                                            (task.status==='Unassigned')&&<button className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>
                                                Unassigned
                                            </button>
                                        }
                                            {
                                            (task.status!=='Unassigned')&&<p className='py-1 px-2 rounded-md bg-[#CDC07B] text-[#000000]'>
                                                {task.status}
                                                </p>
                                        }
                                    </td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap sm:hidden md:hidden'>{task.workerName}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap sm:hidden md:hidden'>{task.workerType}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap sm:hidden md:hidden'>{task.customerApproval}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>${(task.contractedRate/100).toFixed(2)}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{(task.estimatedTime/60).toFixed(2)}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                    {
                                        (task.workerType==='Independent Contractor')&&<div>
                                            {
                                                (task.laborContractId!=='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    <Link to={`/company/laborContracts/details/${task.laborContractId}`}>Details</Link>
                                                    </p>
                                            }
                                            {
                                                (task.laborContractId==='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    NA
                                                </p>
                                            }
                                        </div>
                                    }
                                    {
                                        (task.workerType==='Employee')&&<div>
                                            {
                                                (task.serviceStopId!=='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    <Link to={`/company/serviceStops/detail/${task.serviceStopId}`}>Details</Link>
                                                </p>
                                            }
                                            {
                                                (task.serviceStopId==='')&&<p className='py-3 px-4 font-medium whitespace-nonwrap'>
                                                    NA
                                                </p>
                                            }
                                        </div>
                                    }
                                    </td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        <button
                                         onClick={(e) => deleteTaskItem(e,task.id)} 
                                        >Delete</button>
                                    </td>

                                </tr>
                            ))
                        }
                        </tbody>
                    </table>
                    {
                        (newTask==false)&&<button onClick={(e) => showNewTaskItem(e)} 
                        className='px-2 rounded-md bg-[#1D2E76] text-[#ffffff] font-bold'>
                            + Add New
                        </button>
                    }
                    {
                        (newTask==true)&&<div>
                            <div className='py-2 flex justify-between items-center gap-2'>
                        <button onClick={(e) => clearNewTask(e)} 
                        className='px-2 rounded-md bg-[#9C0D38] text-[#ffffff]'>
                            X
                        </button>
                        <input onChange={(e) => {setDescription(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description' value={description}></input>

                        <div className='w-full'>
                            <Select
                                value={selectedTaskType}
                                options={taskTypeList}
                                onChange={handleSelectedTaskTypeChange}
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
                        <input onChange={(e) => {setTaskLaborCost(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Labor Cost' value={taskLaborCost}></input>
                        <input onChange={(e) => {setEstimatedTime(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Estimated Time (Min)' value={estimatedTime}></input>

                        <button onClick={(e) => handleAddTask(e)} 
                        className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'
                        >Add</button>
                    </div>
                    <hr/>
                    <div>
                        <p className='font-bold'>Details</p>
                        {
                            (selectedTaskType.name=='Basic')&&<div>
                                <p>Basic</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Clean')&&<div>
                                <p>Clean</p>
                            </div>
                        }
                        {
                            (selectedTaskType.name=='Empty Water')&&<div>
                                <p>Empty Water</p>
                                <p>Select Body Of Water</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedBodyOfWater}
                                        options={bodyOfWaterList}
                                        onChange={handleBodyOfWaterListChange}
                                        isSearchable
                                        placeholder="Select a Body Of Water"
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
                        }
                        {
                            (selectedTaskType.name=='Fill Water')&&<div>
                                <p>Fill Water</p>
                                <p>Select Body Of Water</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedBodyOfWater}
                                        options={bodyOfWaterList}
                                        onChange={handleBodyOfWaterListChange}
                                        isSearchable
                                        placeholder="Select a Body Of Water"
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
                        }
                        {
                            (selectedTaskType.name=='Install')&&<div>
                                <p>Install</p>
                                <p>Select New Piece of Equipment to Install</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedEquipment}
                                        options={equipmentList}
                                        onChange={handleEquipmentListChange}
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
                        }
                        {
                            (selectedTaskType.name=='Remove')&&<div>
                                <p>Remove</p>
                                <p>Select Equipment To remove</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedEquipment}
                                        options={equipmentList}
                                        onChange={handleEquipmentListChange}
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
                        }
                        {
                            (selectedTaskType.name=='Replace')&&<div>
                                <p>Replace</p>
                                <p>Select Equipment To remove</p>
                                <div className='w-full'>
                                    <Select
                                        value={selectedEquipment}
                                        options={equipmentList}
                                        onChange={handleEquipmentListChange}
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
                                <p>Select New Piece of Equipment to Install</p>
                                
                            </div>
                        }
                    </div>
                        </div>
                    }
                    
                </div>
            </div>

            {/* Shopping List */}
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <p className='font-bold'>Shopping List</p>
                    <hr/>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Cost</th>
                                <th className='py-3 px-4'>quantity</th>

                                <th className='py-3 px-4'>Price</th>
                                <th className='py-3 px-4'>Item Id</th>
                                <th className='py-3 px-4'>Task Id</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            shoppingList?.map(item => (
                                <tr key={item.id}>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.name}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{(item.cost/100).toFixed(2)}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.quantity}</td>

                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{(item.price/100).toFixed(2)}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.itemId}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{item.taskId}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        <button
                                         onClick={(e) => deleteShoppingListItem(e,item.id)} 
                                        >Delete</button>
                                    </td>

                                </tr>
                            ))
                        }
                        </tbody>
                    </table>

                    {
                        (newShoppingList==false)&&<button onClick={(e) => showNewShoppingListItem(e)} 
                        className='px-2 rounded-md bg-[#1D2E76] text-[#ffffff] font-bold'>
                            + Add New
                        </button>
                    }
                    
                    {
                        (newShoppingList==true)&&<div>{/* className='py-2 flex justify-between items-center gap-2' */}
                   
                        <div className='w-full'>
                            <Select
                                value={newShoppingItemType}
                                options={shoppingListTypes}
                                onChange={handleSelectedShoppingItemTypeChange}
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
                        {/* Custom */}
                        {
                            (newShoppingItemType.name=='Custom')&&<div>
                                <div className='py-2 flex justify-between items-center gap-2'>
                                    <p className='w-full p-2 rounded-md'>Description</p>
                                    <p className='w-full p-2 rounded-md'>Item Cost</p>
                                    <p className='w-full p-2 rounded-md'>Item Price</p>
                                    <p className='w-full p-2 rounded-md'>Item Quantity</p>
                                </div>
                                <div className='py-2 flex justify-between items-center gap-2'>
                                    <input onChange={(e) => {setItemName(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Description' value={itemName}></input>
                                    <input onChange={(e) => {setItemCost(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Item Cost' value={itemCost}></input>
                                    <input onChange={(e) => {setItemPrice(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Item Price' value={itemPrice}></input>
                                    <input onChange={(e) => {setItemQuantity(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Item Quantity' value={itemQuantity}></input>
                                </div>
                            </div>
                        }
                        {/* Generic Item */}
                        {
                            (newShoppingItemType.name=='Generic')&&<div className='py-2 flex justify-between items-center gap-2'>
                                <div className='w-full'>
                                    <Select
                                        value={selectedGenericItem}
                                        options={genericItemList}
                                        onChange={handleSelectedGenericItemChange}
                                        isSearchable
                                        placeholder="Select an Item"
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
                                <input onChange={(e) => {setItemQuantity(e.target.value)}} className='w-full p-2 rounded-md' type="text" placeholder='Item Quantity' value={itemQuantity}></input>
                            </div>
                        }
                            <div className="">
                                <button onClick={(e) => handleAddShoppingListItem(e)} 
                                className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'
                                >Add</button>
                                        <button
                                        onClick={(e) => clearNewShoppingListItem(e)} 
                                className='px-2 rounded-md bg-[#9C0D38] text-[#ffffff]'>
                                    X
                                </button>
                            </div>
                        <p>have options for adding different kinds of items, (custom) generic</p>
                    </div>
                    }
                    

                </div>
            </div>

            {/* Third Section Of Body */}
            <div className='w-full flex flex-wrap mt-2'>
                <div className='w-full lg:w-5/12'>
                    <div className='w-full h-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <p className='font-bold'>Customer Status</p>
                    <hr/>
                    </div>
                </div>
                <div className='w-full lg:w-7/12 lg:pl-4 mt-6 lg:mt-0'>
                    <div className='w-full h-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <p className='font-bold'>Monies</p>
                    <hr/>
                    <div className='flex justify-between'>
                        <p>Suggested Rate : {job.rate}</p>
                        <button className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'>Use Suggested Rate</button>
                    </div>
                    <hr/>
                    <p>Check to see if the Rate Has Already Been Approved</p>
                    <p>Maybe I should have a few versions of rate. Accepted Rate. Suggested Rate. Offered Rate</p>
                    <hr/>
                    <p>Rate: {job.rate}</p>

                    </div>
                </div>
            </div>
           {/* -------------- */}
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-end'>
                    <p className='font-bold text-[#d0d2d6]'> Estimated PNL</p>
                    <div className='flex justify-between'>
                        <p>Rate - $ {offeredRate}</p>
                        <div className='flex justify-end gap-2'>
                            <input 
                            className='py-1 px-2 rounded-md mt-2 bg-[#ededed]'
                            onChange={(e) => {setEstimatedRate(e.target.value)}} type="text" placeholder='Offered Rate' value={estimatedRate}></input>
                            <button
                             onClick={(e) => recalculatePNL(e)} 
                            className='rounded-md bg-[#CDC07B] text-[#000000] font-bold px-2 py-1 text-base'
                            >Use Offered Rate</button>
                        </div>
                    </div>
                    <hr className='w-1/2'/>
                    <p>Material Cost - $ {materialCost}</p>
                    <hr className='w-1/4'/>
                    <p>Estimated Duration - {estimatedDuration} hrs</p>
                    <p>Employee Cost - $ {(estimatedDuration*hourlyRate).toFixed(2)}</p>
                    <p>Sub Contractor Cost - $ {laborCost}</p>
                    <hr className='w-1/4'/>

                    <p>Total Labor Cost - {laborCost}</p>
                    <hr className='w-1/2'/>
                    <p>Total Cost - {totalCost}</p>
                    <hr className='w-3/4'/>

                    <p>Profit : {estimatedProfit}  ( {estimatedProfitPercentage}% )</p>
                </div>
            </div>
           {/* -------------- */}
        </div>
    );
}
    export default JobDetailView;