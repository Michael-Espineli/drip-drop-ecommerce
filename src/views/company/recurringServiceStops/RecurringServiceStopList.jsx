import React, { useState, useEffect, useContext } from "react";
import {Link, useParams } from 'react-router-dom';
import {  query, collection, getDocs, limit, orderBy, startAt, deleteDoc, doc, getDoc, updateDoc , setDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import Select from 'react-select';
import {v4 as uuidv4} from 'uuid';
import { format } from 'date-fns'; // Or any other date formatting library
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const RecurringServiceStopList = () => {

    const {name,recentlySelectedCompany} = useContext(Context);

    const [recurringServiceStopList, setRecurringServiceStopList] = useState([]);
    
    useEffect(() => {
        (async () => {
            try{
                let q = query(collection(db, 'companies',recentlySelectedCompany,'recurringServiceStop'));
                const querySnapshot = await getDocs(q);       
                setRecurringServiceStopList([])
                querySnapshot.forEach((doc) => {
                    const rssData = doc.data()
                    const rss = {
                        id:rssData.id,
                        internalId : rssData.internalId,
                        type:rssData.type,
                        typeId:rssData.typeId,
                        typeImage: rssData.typeImage,
                        customerId:rssData.customerId,
                        customerName: rssData.customerName,

                        streetAddress:rssData.address.streetAddress,
                        city:rssData.address.city,
                        state:rssData.address.state,
                        zip:rssData.address.zip,
                        latitude:rssData.address.latitude,
                        longitude:rssData.address.longitude,

                        tech:rssData.tech,
                        techId:rssData.techId,
                        dateCreated:rssData.dateCreated,
                        startDate:rssData.startDate,
                        endDate:rssData.endDate,
                        noEndDate:rssData.noEndDate,
                        frequency:rssData.frequency,
                        daysOfWeek:rssData.daysOfWeek,
                        lastCreated:rssData.lastCreated,

                        serviceLocationId:rssData.serviceLocationId,
                        estimatedTime:rssData.estimatedTime,
                        otherCompany:rssData.otherCompany,
                        laborContractId:rssData.laborContractId,
                        contractedCompanyId:rssData.contractedCompanyId
                    }
                    setRecurringServiceStopList(recurringServiceStopList => [...recurringServiceStopList, rss]); 
                });
            } catch(error){
                console.log('Error')
            }
        })();
    },[])
    return (
        // 030811 - almost black
        // 282c28 - black green
        // 454b39 - dark olive green
        // 536546 - olive green
        // 747e79 - gray green
        // ededed - off white
        // 1D2E76 - Pool Blue
        // CDC07B - Pool Yellow
        // 9C0D38 - Pool Red
        // 2B600F - Pool Green
        // 919191 = gray
        <div className='px-2 md:px-7 py-5'>
            <div className="py-2">
                <Link 
                className='py-1 px-2 bg-[#CDC07B] rounded-md text-[#000000]'
                to={`/company/recurringServiceStop/createNew/NA`}>
                    Create New
                </Link>
            </div>
            <div className='py-2'>
                <div className='w-full bg-[#0e245c] rounded-md text-[#cfcfcf] p-4'>
                    <h1 className='font-bold'>Recurring Service Stop</h1>
                </div>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Customer Name</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Tech Name</th>
                                    <th className='py-3 px-4'>Day</th>
                                    <th className='py-3 px-4'>Frequency</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                recurringServiceStopList?.map(rss => (
                                    <tr key={rss.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.customerName}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.streetAddress}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.tech}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.daysOfWeek}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/recurringServiceStop/details/${rss.id}`}>{rss.frequency}</Link></td>
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
export default RecurringServiceStopList;