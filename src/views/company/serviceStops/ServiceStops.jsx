import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { db } from "../../../utils/config";
import {Link } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns'; // Or any other date formatting library

const ServiceStops = () => {
    const [serviceStopList, setServiceStopList] = useState([]);
    const {name,recentlySelectedCompany} = useContext(Context);

    useEffect(() => {
        (async () => {                
                try{

                    let q = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops')); //,limit(10)
                    const querySnapshot = await getDocs(q);       
                    setServiceStopList([])      
                    querySnapshot.forEach((doc) => {

                        const serviceStopData = doc.data()
                        const date = serviceStopData.serviceDate.toDate();
                        const formattedDate = format(date, 'MMMM d, yyyy'); 

                        const serviceStop = {
                            id:serviceStopData.id,
                            tech:serviceStopData.tech,
                            customerName:serviceStopData.customerName,
                            streetAddress: serviceStopData.address.streetAddress,
                            jobId:serviceStopData.jobId,
                            date:formattedDate
                        }
                        setServiceStopList(serviceStopList => [...serviceStopList, serviceStop]); 
                    });
                } catch(error){
                    console.log('Error')
                    console.log(error)
                }
            
        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full bg-[#1D2E76] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        <div className='relative overflow-x-auto'>
                            <table className='w-full text-sm text-left text-[#d0d2d6]'>
                                <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                    <tr>
                                        <th className='py-3 px-4'>Date</th>
                                        <th className='py-3 px-4'>Tech</th>
                                        <th className='py-3 px-4'>Customer Name</th>
                                        <th className='py-3 px-4'>Street Address</th>
                                        <th className='py-3 px-4'>Job Id</th>
                                        <th className='py-3 px-4'>Status</th>
                                        <th className='py-3 px-4'></th>

                                    </tr>
                                </thead>
                                <tbody>
                                {
                                    serviceStopList?.map(serviceStop => (
                                            <tr key={serviceStop.id}>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.date}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.tech}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.customerName}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.streetAddress}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.jobId}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'>{serviceStop.status}</td>
                                                <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>Details</Link></td>
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

    export default ServiceStops;
