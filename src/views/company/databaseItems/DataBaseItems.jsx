import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
import DatePicker from "react-datepicker";
import { format } from 'date-fns'; // Or any other date formatting library

const DatabaseItems = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [genericItemList, setGenericItemList] = useState([]);


    useEffect(() => {
        (async () => {
            
                try{
        
                    //Get Generic Data Base Items
                    let genericItemQuery = query(collection(db, "companies",recentlySelectedCompany,'settings','dataBase','dataBase'), orderBy("name"));
                    const genericItemQuerySnapshot = await getDocs(genericItemQuery);       
                    setGenericItemList([])
                    genericItemQuerySnapshot.forEach((doc) => {
                        const itemData = doc.data()
                        const dateUpdated = itemData.dateUpdated.toDate();
                        const formattedDate1 = format(dateUpdated, 'MM / d / yyyy'); 
                        
                        let rateDouble = itemData.rate/100
                        let formattedRateUSD = formatCurrency(rateDouble);
                        
                        let billingRateDouble = itemData.billingRate/100
                        let formattedBillingRateUSD = formatCurrency(billingRateDouble);

                        const genericItem = {
                            UOM : itemData.id,
                            billable : itemData.billable,
                            category : itemData.category,
                            color : itemData.color,
                            dateUpdated : formattedDate1,
                            description : itemData.description,
                            id : itemData.id,
                            name : itemData.name,
                            rate : formattedRateUSD,
                            size : itemData.size,
                            sku : itemData.sku,
                            storeName : itemData.storeName,
                            subCategory : itemData.subCategory,
                            timesPurchased : itemData.timesPurchased,
                            venderId : itemData.venderId,
                            label: itemData.name + ' ' + itemData.rate + ' ' + itemData.sku,
                            billingRate : formattedBillingRateUSD
                        }
                        setGenericItemList(genericItemList => [...genericItemList, genericItem]); 
                    });

                } catch(error){
                    console.log('Error')
                    console.log(error)
                }
            
        })();
    },[])
    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency
        }).format(number);
      }
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

        <div className='px-2 md:px-7 py-5'>
            <div className='px-2 py-2'>
                <Link 
                className='py-1 px-2 bg-[#0e245c] rounded-md text-[#ffffff]'
                to={`/company/items/createNew`}
                >Create New</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md text-[#ffffff]'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        {/* Search Bar */}
                        <input className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#000000] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Search'  />
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] border-b border-slate-700'>
                                <tr>
                                <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Description</th>
                                    <th className='py-3 px-4'>Rate</th>
                                    <th className='py-3 px-4'>Sku</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                genericItemList?.map(item => (
                                    <tr key={item.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/items/detail/${item.id}`}>{item.name}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/items/detail/${item.id}`}>{item.description}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/items/detail/${item.id}`}>{item.rate}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/items/detail/${item.id}`}>{item.sku}</Link></td>
                                    </tr>
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                </div>
                <hr/>
            </div>
        </div>
    );
};

export default DatabaseItems;