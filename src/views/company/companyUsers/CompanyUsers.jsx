import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";

const CompanyUsers = () => {
    const [companyUserList, setCompanyUserList] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
                try{
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'companyUsers'));
                    const querySnapshot = await getDocs(q);       
                    setCompanyUserList([])      
                    querySnapshot.forEach((doc) => {
                        const companyUserData = doc.data()
                        const companyUser = {
                            id:companyUserData.id,
                            userName:companyUserData.userName,
                            roleName:companyUserData.roleName,
                            status: companyUserData.status,
                            workerType: companyUserData.workerType,
                            linkedCompanyId: companyUserData.linkedCompanyId,
                            linkedCompanyName:companyUserData.linkedCompanyName
                        }
                        setCompanyUserList(companyUserList => [...companyUserList, companyUser]); 
                    });
                    
              

                } catch(error){
                    console.log('Error')
                }
            
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='px-2 py-2'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to={`/company/companyUsers/createNew`}
                >Create New</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    
                                    <th className='py-3 px-4'>User Name</th>
                                    <th className='py-3 px-4'>Worker Type</th>
                                    <th className='py-3 px-4'>Role Name</th>
                                    <th className='py-3 px-4'>Status</th>
                                    <th className='py-3 px-4'>linked Company Name</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                companyUserList?.map(user => (
                                        <tr key={user.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/companyUsers/${user.id}`}>{user.userName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/companyUsers/${user.id}`}>{user.workerType}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/companyUsers/${user.id}`}>{user.roleName}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/companyUsers/${user.id}`}>{user.status}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/companyUsers/${user.id}`}>{user.linkedCompanyName}</Link></td>

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
    );
}
    export default CompanyUsers;
