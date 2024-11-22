import React, { useState, useContext, useEffect } from 'react';
import { IoFilterSharp } from "react-icons/io5";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { FaCheckCircle } from "react-icons/fa";
import { FaRegCircle } from "react-icons/fa";
import { Link } from 'react-router-dom';

function Companies () {
    const [companies, setCompanies] = useState([]);
    const [firstDoc, setFirstDoc] = useState();
    const [lastDoc, setLastDoc] = useState();
    useEffect(() => {
        (async () => {
            console.log('On Load')
            //Fire base
            try{
                let q = query(collection(db, 'companies'));
                const querySnapshot = await getDocs(q);       
                let count = 1   
                setCompanies([])      
                querySnapshot.forEach((doc) => {
                    if (count == 1) {
                        setFirstDoc(doc)
                    } else {
                        setLastDoc(doc)
                    }
                    const companyData = doc.data()
                    const  company = {
                        id:companyData.id,
                        name:companyData.name,
                        verified:companyData.verified,
                        ownerName: companyData.ownerName
                    }
                    count = count + 1
                    setCompanies(companies => [...companies, company]); 
                });
            } catch (error){
                console.log('Error')
                 console.error(error)
            }
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <h1>Company Page</h1>
                    {/* Company Search Bar */}
                    <div className="w-full flex justify-between items-center gap-4">
                        <input className="w-full px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#000000] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Search'  />
                        <IoFilterSharp />
                    </div>
                </div>
            </div>
            {/* Company List */}
            <div className='py-2'>

                <div className='w-full bg-[#747e79] p-4 rounded-md text-[#d0d2d6]'>
                    <table className='w-full text-sm text-left text-[#d0d2d6]'>
                        <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                            <tr>
                                <th className='py-3 px-4'>Name</th>
                                <th className='py-3 px-4'>Owner</th>
                                <th className='py-3 px-4'>Verified</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            companies?.map( company => (
                                <tr key={company.id}>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{company.name}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{company.ownerName}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>{company.verified ? <FaCheckCircle />:<FaRegCircle />}</td>
                                    <td className='py-3 px-4 font-medium whitespace-nonwrap'>
                                        <Link to={`/companies/profile/${company.id}`} className="w-[180px] h-[50px]" >
                                            View
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        }
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Companies;