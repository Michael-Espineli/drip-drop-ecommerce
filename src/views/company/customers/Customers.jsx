import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
const Customers = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [customerList, setCustomerList] = useState([]);
    const [page, setPage] = useState(1);
    const [firstDoc, setFirstDoc] = useState();
    const [lastDoc, setLastDoc] = useState();

    const [pageCount, setPageCount] = useState(5);
    const [pageValue, setPageValue] = useState('5');

    const handlePageChange = (event) => {

        (async () => {
            console.log('Change in Page Count ' + event.target.value)
            setPageValue(event.target.value);
            setPageCount(parseInt(event.target.value))
                
                try{
                    let q;
            
                        q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"), limit(parseInt(event.target.value)));
                    
                    const querySnapshot = await getDocs(q);       
                    let count = 1   
                    setCustomerList([])      
                    querySnapshot.forEach((doc) => {
                        if (count == 1) {
                            setFirstDoc(doc)
                        } else {
                            setLastDoc(doc)
                        }
                        const user = doc.data()
                        const userData = {
                            id:user.id,
                            name:user.firstName + ' ' + user.lastName,
                            streetAddress:user.billingAddress.streetAddress,
                            phoneNumber: user.phoneNumber,
                            email:user.email
                        }
                        count = count + 1
                        setCustomerList(customerList => [...customerList, userData]); 
                    });
                } catch(error){
                    console.log('Error')
                }
            
        })();
    }

    async function nextPage(page){
        setPage(page + 1)
        let q;
        if (lastDoc) {

            q = query(collection(db, 'companies','B06BD6B7-B23E-43BE-A637-7A824C48D0B7','customers'), orderBy("firstName"), limit(pageCount), startAfter(lastDoc));

        } else {

            q = query(collection(db, 'companies','B06BD6B7-B23E-43BE-A637-7A824C48D0B7','customers'), orderBy("firstName"), limit(pageCount));

        }
        const querySnapshot = await getDocs(q);
        let count = 1
        setCustomerList([])
        querySnapshot.forEach((doc) => {
          // doc.data() is never undefined for query doc snapshots

            if (count === 1) {
                setFirstDoc(doc)
            }
                setLastDoc(doc)

            const user = doc.data()

            const userData = {
                id:user.id,
                name:user.firstName + ' ' + user.lastName,
                streetAddress:user.billingAddress.streetAddress,
                phoneNumber: user.phoneNumber,
                email:user.email
            }

            count = count + 1

            setCustomerList(customerList => [...customerList, userData]); 

        });
    }
    async function previousPage(page){
        setPage(page - 1)
        let q;
        if (firstDoc) {

            q = query(collection(db, 'companies','B06BD6B7-B23E-43BE-A637-7A824C48D0B7','customers'), orderBy("firstName"), limit(pageCount), startAt(firstDoc));

        } else {

            q = query(collection(db, 'companies','B06BD6B7-B23E-43BE-A637-7A824C48D0B7','customers'), orderBy("firstName"), limit(pageCount));

        }
        const querySnapshot = await getDocs(q);
        let count = 1        
        setCustomerList([])
        querySnapshot.forEach((doc) => {
            // doc.data() is never undefined for query doc snapshots

            if (count === 1) {
                setFirstDoc(doc)
            }
                setLastDoc(doc)

            const user = doc.data()

            const userData = {
                id:user.id,
                name:user.firstName + ' ' + user.lastName,
                streetAddress:user.billingAddress.streetAddress,
                phoneNumber: user.phoneNumber,
                email:user.email
            }

            count = count + 1

            setCustomerList(customerList => [...customerList, userData]); 
        });
    }
    useEffect(() => {
        (async () => {
            if (customerList.length < 3) {
                
                try{
                    let q;
            
                        q = query(collection(db, 'companies','B06BD6B7-B23E-43BE-A637-7A824C48D0B7','customers'), orderBy("firstName"), limit(pageCount));
                    
                    const querySnapshot = await getDocs(q);       
                    let count = 1   
                    setCustomerList([])      
                    querySnapshot.forEach((doc) => {
                        if (count == 1) {
                            setFirstDoc(doc)
                        } else {
                            setLastDoc(doc)
                        }
                        const user = doc.data()
                        const userData = {
                            id:user.id,
                            name:user.firstName + ' ' + user.lastName,
                            streetAddress:user.billingAddress.streetAddress,
                            phoneNumber: user.phoneNumber,
                            email:user.email
                        }
                        count = count + 1
                        setCustomerList(customerList => [...customerList, userData]); 
                    });
                } catch(error){
                    console.log('Error')
                }
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
            to={`/company/customers/createNew`}>Create New</Link>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>

                        <h1>Customers: {(page*pageCount)-pageCount+1} - {page*pageCount}</h1>
                        {/* Search Bar */}
                        <input className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#ededed] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Search'  />

                        {/* Drop Down */}
                        <select value={pageValue} onChange={(e) => handlePageChange(e)}>
                            <option value="5">5</option>
                            <option value="10">10</option>
                            <option value="25">25</option>
                            <option value="50">50</option>

                        </select>
                        <div className='left-0 w-full justify-between'>
                            <div className='flex justify-between items-center'>
                                {
                                    page != 1 ?
                                    <div>
                                        <button onClick={() => previousPage(page)} >
                                            <h1>Previous</h1>
                                        </button>
                                    
                                    </div> :
                                    <div>
                                        <h1></h1>
                                    </div>
                                }
                                <div>
                                    <button onClick={() => nextPage(page)} >
                                        <h1>Next</h1>
                                    </button>
                                </div>
                            </div>                                         
                        </div>
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'>Name</th>
                                    <th className='py-3 px-4'>Street Address</th>
                                    <th className='py-3 px-4'>Phone Number</th>
                                    <th className='py-3 px-4'>Email</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                customerList?.map(customer => (
                                        <tr key={customer.id}>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${customer.id}`}>{customer.name}</Link></td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{customer.streetAddress}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{customer.phoneNumber}</td>
                                            <td className='py-3 px-4 font-medium whitespace-nonwrap'>{customer.email}</td>
                                        </tr>
                                    
                                ))
                            }
                            </tbody>
                        </table>
                    </div>
                </div>
                <hr/>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        {

                            page != 1 ?
                            <div>
                                <button onClick={() => previousPage(page)} >
                                    <h1>{((page-1)*pageCount)-pageCount+1} - {(page-1)*pageCount}</h1>
                                </button>
                                
                            </div> :
                            <div>
                                <h1></h1>
                            </div>
                        }

                        <div>
                            <button onClick={() => nextPage(page)} >
                                <h1>{((page+1)*pageCount)-pageCount+1} - {(page+1)*pageCount}</h1>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Customers;