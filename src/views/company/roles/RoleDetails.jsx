import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const RoleDetails = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const {roleId} = useParams();
    const [role,setRole] = useState({
        color : '',
        description : '',
        id : '',
        listOfUserIdsToManage : '',
        name : '',
        permissionIdList : ''
    });
    useEffect(() => {
        (async () => {
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany,'roles',roleId);
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
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <h2>Please Forgive the Work In Progress</h2>
                    <p>{roleId}</p>
                    <p>{role.color}</p>
                    <p>{role.description}</p>
                    <p>{role.listOfUserIdsToManage}</p>
                    <p>{role.name}</p>
                    <p>{role.permissionIdList}</p> 
                </div>
            </div>
        </div>
    );
}
    export default RoleDetails;
