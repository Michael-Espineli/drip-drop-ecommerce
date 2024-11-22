import React, { useState, useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";

const Alerts = () => {
    const {recentlySelectedCompany, user} = useContext(Context);

    const [ alertList, setAlertList] = useState([]);

    useEffect(() => {
        (async () => {
            console.log('On Load')
            //Fire base
            console.log(recentlySelectedCompany)
            try{
                //alerts
                let q = query(collection(db, 'companies',recentlySelectedCompany,'alerts'));
                const querySnapshot = await getDocs(q);       
                let count = 1   
                setAlertList([])      
                querySnapshot.forEach((doc) => {
                    const contractData = doc.data()
                    const  contract = {
                        id:contractData.id,
                        name:contractData.name,
                        description:contractData.description,
                    }
                    count = count + 1
                    setAlertList(alertList => [...alertList, contract]); 
                });
    
            } catch (error){
                console.log(error)
            }

        })();
    },[])
    return (
        <div className='px-2 md:px-7 py-5'>
            <div className='w-full p-4 bg-[#747e79] rounded-md mt-6'>
            <div className='flex justify-between items-center text-[#ffffff] pb-3 font-bold'>
                    <h2>Alerts</h2>
                    <Link to='/company/alerts' className='font-semibold text-sm text-[#d0d2d6]'>View All</Link>
                </div>
                {
                    alertList?.map( alert => (
                        <div className='flex w-full'>

                        <button>

                            <div className='rounded-md bg-[#1D2E76] py-1 px-2 mt-2 text-[#ededed]'>
                                <div className='flex justify-between'>
                                    <p>
                                        {alert.name}
                                    </p>
                                </div>
                            </div>
                        </button>
                        </div>

                    ))
                }
            </div>
        </div>
    );
};

export default Alerts;