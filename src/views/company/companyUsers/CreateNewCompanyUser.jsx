import React, { useState,useEffect, useContext } from "react";
import {Link, useParams,Navigate } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, startAfter, doc, getDoc, where, setDoc, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library
import {v4 as uuidv4} from 'uuid';
import { useNavigate } from 'react-router-dom';

import Select from 'react-select';

const CreateNewCompanyUser = () => {

    const {name,recentlySelectedCompany} = useContext(Context);

    const navigate = useNavigate()

    const [firstName, setFirstName] = useState('');

    const [lastName, setLastName] = useState('');

    const [email, setEmail] = useState('');

    const [roleList, setRoleList] = useState([]);

    const [role, setRole] = useState();

    const [statusList, setStatusList] = useState([
        {
            id : 1,
            label : 'Active'  
        }
        ,
        {
            id : 2,
            label : 'Pending'  
        }
        ,
        {
            id : 3,
            label : 'Past'  
        }
    ]);
    
    const [isEmployee, setIsEmployee] = useState(false);

    const [status, setStatus] = useState();

    const handleRoleChange = (selectedOption2) => {

        (async () => {
            setRole(selectedOption2)
        })();
    };

    const handleStatusChange = (selectedOption2) => {

        (async () => {
            setStatus(selectedOption2)
        })();
    };

    useEffect(() => {
        (async () => {
            try{
    
                //Roles
                let qv;
                qv = query(collection(db, 'companies',recentlySelectedCompany,'roles'));
                const querySnapshotRole = await getDocs(qv);
                let count = 1 
                setRoleList([])  
                querySnapshotRole.forEach((doc) => {
                    const roleData = doc.data()
                    const role = {
                        id: roleData.id,
                        name: roleData.name,
                        description: roleData.description,
                        color: roleData.color,
                        permissionIdList: roleData.permissionIdList,
                        listOfUserIdsToManage: roleData.listOfUserIdsToManage,
                        label:roleData.name
                    }
                    count = count + 1
                    setRoleList(roleList => [...roleList, role]); 
                });

            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    
    async function billableTrue(e) {
        setIsEmployee(true)
    }
    
    async function billableFalse(e) {
        setIsEmployee(false)
    }

    async function createNewItem(e) {
        e.preventDefault()
        try{
            //Create New Item
            let id = 'com_sett_db_' + uuidv4()
    
            let userId = 'com_sett_db_' + uuidv4()

            console.log('Added Receipt ' + id)
            
            let userName = firstName + ' ' + lastName
            
            let inviteId = 'invi_' + uuidv4()
            if (isEmployee){

                let item = {
                    id : id,
                    userName : userName,
                    userId : userId,
                    dateCreated : new Date(),
                    status : status.label,
                    workerType : 'Employee',
                    linkedCompanyId : "size",
                    linkedCompanyname : "sku"
                }
                // Invite User 
                let invite = {
                    companyId:recentlySelectedCompany,
                    companyName: 'Company Name',
                    email:email,
                    firstName:firstName,
                    lastName:lastName,
                    id:inviteId,
                    roleId : role.id,
                    roleName : role.label,
                    status:'Pending'
                }
                console.log(invite)
                await setDoc(doc(db,"invites", inviteId), invite);
                // User Sets up Account when Signing Up
                
            } else {

                let item = {
                    id : id,
                    userName : userName,
                    userId : userId,
                    roleId : role.id,
                    roleName : role.label,
                    dateCreated : new Date(),
                    status : status.label,
                    workerType : 'Independent Contractor',
                    linkedCompanyId : "size",
                    linkedCompanyname : "sku"
                }
            }
            
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
        // 919191 - gray

        <div className='px-2 md:px-7 py-5'>
            <div className='px-2 py-2 flex justify-between'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to={`/company/companyUsers`}
                >Go Back</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#ffffff]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between py-1'>
                        <p className='font-bold text-lg'>Create New Company User</p>
                    </div>
                    <div>
                        {
                            isEmployee ? <div className="py-1">
                                <button
                                onClick={(e) =>{billableFalse(e)}}
                                className='py-1 px-2 bg-[#2B600F] rounded-md text-[#ffffff] w-full'>
                                    Is Employee
                                </button>
                                <div className="flex py-1 ">
                                    <p className="px-2 items-center line-clamp-1 w-[150px]">First Name</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setFirstName(e.target.value)}} type="text" placeholder='First Name' value={firstName}>
                                    </input>
                                </div>
                                <div className="flex py-1 ">
                                    <p className="px-2 items-center line-clamp-1 w-[150px]">Last Name</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setLastName(e.target.value)}} type="text" placeholder='Last Name' value={lastName}>
                                    </input>
                                </div>
                                <div className="flex py-1 ">
                                    <p className="px-2 items-center line-clamp-1 w-[150px]">Email</p>
                                    <input 
                                    className='w-full py-1 px-2 rounded-md text-[#000000]'
                                    onChange={(e) => {setEmail(e.target.value)}} type="text" placeholder='Email' value={email}>
                                    </input>
                                </div>
                            </div> : <div className="flex  py-1">
                                <button
                                onClick={(e) =>{billableTrue(e)}}
                                className='py-1 px-2 bg-[#9C0D38] rounded-md text-[#ffffff] w-full'>
                                    Is Contractor
                                </button>
                            </div>
                        }
                        <div className="flex py-1 justify-between items-center">
                            <p className="px-2">Role</p>
                                <Select
                                    value={role}
                                    options={roleList}
                                    onChange={handleRoleChange}
                                    isSearchable
                                    placeholder="Select a Role"
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
                            <p className="px-2">Status</p>
                                <Select
                                    value={status}
                                    options={statusList}
                                    onChange={handleStatusChange}
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
export default CreateNewCompanyUser;
