import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
const Customers = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [customerList, setCustomerList] = useState([]);
    const [filterCustomerList, setFilterCustomerList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        (async () => {
            if (customerList.length < 1 ) {
                try{
                    let q;
                        q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"));   
                    const querySnapshot = await getDocs(q);       
                    let count = 1   
                    setCustomerList([])
                    setFilterCustomerList([])      
                    querySnapshot.forEach((doc) => {
                        const customer = doc.data()
                        const customerData = {
                            id:customer.id,
                            name:customer.firstName + ' ' + customer.lastName,
                            streetAddress:customer.billingAddress.streetAddress,
                            phoneNumber: customer.phoneNumber,
                            email:customer.email
                        }
                        count = count + 1
                        setCustomerList(customerList => [...customerList, customerData]); 
                        setFilterCustomerList(filterCustomerList => [...filterCustomerList, customerData]); 
                    });
                } catch(error){
                    console.log('Error')
                }
            }
        })();
    },[])
    const searchHandler = (e) => {
        e.preventDefault();

        let newInput = e.target.value

        setSearchTerm(newInput);

        if (newInput.length > 0) {
            //Better Way
            setFilterCustomerList(
                customerList.filter(customer => 
                    // customer.name == newInput
                    customer.name.toLowerCase().includes(newInput.toLowerCase()) ||
                    customer.streetAddress.toLowerCase().includes(newInput.toLowerCase()) ||
                    customer.phoneNumber.toLowerCase().includes(newInput.toLowerCase()) ||
                    customer.email.toLowerCase().includes(newInput.toLowerCase())

                )
            )

            //Bad Way

            // console.log('Search')
            // for (let i = 0; i < customerList.length; i++) {
            //     const item = customerList[i];
            //     if (item.name == newInput) {
            //         console.log('Found')
            //         newList.push(item)
            //     }
            // }

        } else {
            console.log('Empty')

            setFilterCustomerList(customerList)
        }
    };
 


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
            <div className='py-2'>
            <Link 
                className='py-1 px-2 bg-[#CDC07B] rounded-md text-[#000000]'
                to={`/company/customers/createNew`}>Create New</Link>
            </div>
            <div className='w-full bg-[#0e245c] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                        <div className='flex justify-between items-center'>
                            {/* <h1>Customers : {customerList.length}</h1> */}
                                <input 
                                onChange={(e) => {searchHandler(e)}}
                                // onChange={searchHandler} 
                                value={searchTerm}
                                className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                                text-[#030811] focus:border-[#ededed] overflow-hidden" 
                                type="text" 
                                name='search' 
                                placeholder='Search'/>
                            {/* <div className='p-2'>
                                <button 
                                onClick={(e) => searchForCustomer(e)} 
                                className='py-1 px-2 bg-[#1D2E76] rounded-md text-[#ffffff]'
                                >Search</button>
                            </div> */}
                        </div>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6]  border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Phone Number</th>
                                    <th className='py-3 px-4'>Email</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                filterCustomerList?.map(customer => (
                                    <tr key={customer.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${customer.id}`}>{customer.name}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${customer.id}`}>{customer.streetAddress}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${customer.id}`}>{customer.phoneNumber}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${customer.id}`}>{customer.email}</Link></td>
                                    </tr>
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Customers;