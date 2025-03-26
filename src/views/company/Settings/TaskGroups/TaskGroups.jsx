import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { db } from "../../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../../context/AuthContext";

const TaskGroups = () => {
    const [companyUserList, setCompanyUserList] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
                try{
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'settings','taskGroups','taskGroups'));
                    const querySnapshot = await getDocs(q);       
                    setCompanyUserList([])      
                    querySnapshot.forEach((doc) => {
                        const data = doc.data()
                        const companyUser = {
                            id:data.id,
                            groupName:data.groupName,
                            numberOfTasks: data.numberOfTasks
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
            <Link className='py-1 px-2 rounded-md bg-[#CDC07B]'
             to='/company/taskGroups/createNew'>
            Create New Task Group
            </Link>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-2'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        <p className='font-bold'>Task Groups</p>
                    </div>
                </div>
            </div>
            <div className='w-full bg-[#747e79] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Group Name</th>
                                    <th className='py-3 px-4'>Number Of Tasks</th>
                                    <th className='py-3 px-4'></th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                companyUserList?.map(group => (
                                    <tr key={group.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/taskGroups/details/${group.id}`}>{group.groupName}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/taskGroups/details/${group.id}`}>{group.numberOfTasks}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/taskGroups/details/${group.id}`}>Details</Link></td>
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

export default TaskGroups;