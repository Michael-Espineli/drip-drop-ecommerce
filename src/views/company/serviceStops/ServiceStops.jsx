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
  
                    // setServiceStopList([])    

                    // let q = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'), orderBy('serviceDate'),limit(10)); //,limit(10)
                    // const querySnapshot = await getDocs(q);     
                    // const customerData = querySnapshot.docs.map(doc => ServiceStop.fromFirestore(doc));

                    // setServiceStopList(customerData);

                    let q = query(collection(db, 'companies',recentlySelectedCompany,'serviceStops'), orderBy('serviceDate'),limit(10)); //,limit(10)
                    const querySnapshot = await getDocs(q);       
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
                            date:formattedDate,
                            status: serviceStopData.status, // Added status to the object
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
            <div className='w-full p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        <div className='relative overflow-x-auto'>
                            <table className="min-w-full white-bg border border-gray-200 black-fg">
                                <thead className='text-sm border-b border-slate-700'>
                                    <tr className='border-b border-slate-700'>
                                        <th scope='col' className='px-4 py-3'>
                                            Date
                                        </th>
                                        <th scope='col' className='px-4 py-3'>
                                            Tech
                                        </th>
                                        <th scope='col' className='px-4 py-3'>
                                            Customer Name
                                        </th>
                                        <th scope='col' className='px-4 py-3'>
                                            Street Address
                                        </th>
                                        <th scope='col' className='px-4 py-3'>
                                            Job Id
                                        </th>
                                        <th scope='col' className='px-4 py-3'>
                                            Status
                                        </th>
                                        <th scope='col' className='px-4 py-3'>
                                            Action
                                        </th>

                                    </tr>
                                </thead>
                                <tbody>
                                {
                                    serviceStopList?.map(serviceStop => (
                                        <tr key={serviceStop.id} className='border-b border-slate-700'>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.date}</Link></td>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.tech}</Link></td>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.customerName}</Link></td>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.streetAddress}</Link></td>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.jobId}</Link></td>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'><Link to={`/company/serviceStops/detail/${serviceStop.id}`}>{serviceStop.status}</Link></td>
                                            <td className='px-4 py-3 font-medium whitespace-nowrap'>
                                                <Link to={`/company/serviceStops/detail/${serviceStop.id}`}>Details</Link>
                                            </td>
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
