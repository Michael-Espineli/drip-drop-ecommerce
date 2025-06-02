import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css'
import { format } from 'date-fns'; // Or any other date formatting library

const Venders = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [venderList, setVenderList] = useState([]);

    const [endDate, setEndDate] = useState(new Date());

    useEffect(() => {
        (async () => {

            try{
                let q;
        
                q = query(collection(db, 'companies',recentlySelectedCompany,'settings','venders','vender'));
                
                const querySnapshot = await getDocs(q);

                let count = 1 

                setVenderList([])  

                querySnapshot.forEach((doc) => {

                    const venderData = doc.data()

                    const vender = {

                        id:venderData.id,

                        name:venderData.name,

                        email:venderData.email,

                        phoneNumber:venderData.phoneNumber,

                        streetAddress: venderData.address.streetAddress,

                        city:venderData.address.city,

                        state:venderData.address.state,

                        zip:venderData.address.zip,

                    }

                    count = count + 1

                    setVenderList(venderList => [...venderList, vender]); 

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

        <div className='px-2 md:px-7 py-5'>
            <button></button>
            <Link 
            className='py-1 px-2 bg-[#1D2E76] rounded-md'
            to={`/company/venders/createNew`}>Create New Vender</Link>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>price</th>
                                    <th className='py-3 px-4'>quantity String</th>
                                    <th className='py-3 px-4'>tech Name</th>
                                    <th className='py-3 px-4 visible sm:invisible lg:invisible '>vender Name</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                venderList?.map(vender => (
                                    <tr key={vender.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${vender.id}`}>{vender.name}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${vender.id}`}>{vender.streetAddress}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${vender.id}`}>{vender.phoneNumber}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${vender.id}`}>{vender.email}</Link></td>
                                        <td className='py-3 px-4 visible sm:invisible lg:invisible font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${vender.id}`}>{vender.venderName}</Link></td>
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

export default Venders;