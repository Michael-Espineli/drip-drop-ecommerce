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
import RouteManagementTech from "./RouteManagementTech";

const RouteManagementDay = ({day,userList}) => {

    const {name,recentlySelectedCompany} = useContext(Context);
    
    return (
        <div className='px-2 md:px-7 py-5'>
            <h1 className='text-3xl'>{day}</h1>
            <hr/>
            <div className="px-4">
                {
                    userList?.map(user => (
                        <h1>                           
                            <RouteManagementTech day={day} tech={user}/>
                        </h1>
                    ))
                }
            </div>
        </div>
    );
};

export default RouteManagementDay;