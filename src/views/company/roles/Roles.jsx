import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";

const Roles = () => {
    const [roleList, setRoleList] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
                try{
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'roles'));
                    const querySnapshot = await getDocs(q);       
                    setRoleList([])      
                    querySnapshot.forEach((doc) => {
                        const roleData = doc.data()
                        const role = {
                            id:roleData.id,
                            color:roleData.color,
                            description:roleData.description,
                            listOfUserIdsToManage: roleData.listOfUserIdsToManage,
                            name: roleData.name,
                            permissionIdList: roleData.permissionIdList
                        }
                        setRoleList(roleList => [...roleList, role]); 
                    });
                } catch(error){
                    console.log('Error')
                }
            
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        <h2>Please Forgive the Work In Progress</h2>
                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>name</th>
                                    <th className='py-3 px-4'></th>

                                </tr>
                            </thead>
                            <tbody>
                            {
                                roleList?.map(role => (
                                        <tr key={role.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{role.name}</td>

                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/roles/${role.id}`}>Details</Link></td>

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
    export default Roles;
