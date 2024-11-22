import React, { useState,useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import { query, doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";

const CompanyUserDetails = () => {
    const {name,recentlySelectedCompany} = useContext(Context);
    const {companyUserId} = useParams();
    const [companyUser,setCompanyUser] = useState({
        dateCreated : '',
        linkedCompanyId : '',
        id : '',
        linkedCompanyName : '',
        roleId : '',
        roleName : '',
        status : '',
        userId : '',
        userName : '',
        workerType : ''
    });
    useEffect(() => {
        (async () => {
            try{
                const docRef = doc(db, "companies",recentlySelectedCompany,'companyUsers',companyUserId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    console.log("Document data:", docSnap.data());
                    setCompanyUser((companyUser) => ({
                        ...companyUser,
                        dateCreated: docSnap.data().dateCreated,
                        linkedCompanyId: docSnap.data().linkedCompanyId,
                        id: docSnap.data().id,
                        linkedCompanyName: docSnap.data().linkedCompanyName,
                        roleId : docSnap.data().roleId,
                        roleName : docSnap.data().roleName,
                        status : docSnap.data().status,
                        userId : docSnap.data().userId,
                        userName : docSnap.data().userName,
                        workerType : docSnap.data().workerType 
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
                    <p>{companyUserId}</p>
                    <p>{companyUser.linkedCompanyId}</p>
                    {/* <p>{companyUser.dateCreated}</p> */}
                    <p>{companyUser.roleId}</p>
                    <p>{companyUser.roleName}</p>
                    <p>{companyUser.status}</p>
                    <p>{companyUser.userId}</p>
                    <p>{companyUser.userName}</p>
                    <p>{companyUser.workerType}</p>
                </div>
            </div>
        </div>
    );
}
    export default CompanyUserDetails;
