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
import RouteManagementDay from "./RouteManagementDay";
const RouteManagement = () => {

    const {name,recentlySelectedCompany} = useContext(Context);
        
    const [days, setDays] = useState([
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ]);
        
    const [techList, setTechList] = useState([]);

    useEffect(() => {
        (async () => {
            try{
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

    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#d0d2d6] p-4'>
                    <h1 className='font-bold'>Route Managment</h1>
                </div>
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#d0d2d6] p-4'>
                    
                    {
                        days?.map(day => (
                            <RouteManagementDay day={day} userList={techList}/>
                        ))
                    }
                </div>
            </div>
        </div>
    );
};

export default RouteManagement;