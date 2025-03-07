import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, limit, orderBy, startAt, startAfter, where } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
import DatePicker from "react-datepicker";


const PurchasesList = () => {
    const {name,recentlySelectedCompany} = useContext(Context);

    const [customerList, setCustomerList] = useState([]);

    const [page, setPage] = useState(1);

    const [firstDoc, setFirstDoc] = useState();

    const [lastDoc, setLastDoc] = useState();

    const [pageCount, setPageCount] = useState(50);

    const [pageValue, setPageValue] = useState('50');

    const [formattedStartDate,setFormattedStartDate] = useState('')

    const [formattedEndDate,setFormattedEndDate] = useState('')

    const [startDate, setStartDate] = useState(new Date());

    const [endDate, setEndDate] = useState(new Date());

    const handleStartDateChange = (dateOption) => {
        setStartDate(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        setFormattedStartDate(formattedDate)

    }

    const handleEndDateChange = (dateOption) => {
        setEndDate(dateOption)
        const formattedDate = dateOption.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
        }); 
        setFormattedEndDate(formattedDate)
    }

    const handlePageChange = (event) => {

        (async () => {
            console.log('Change in Page Count ' + event.target.value)
            setPageValue(event.target.value);
            setPageCount(parseInt(event.target.value))
                
                try{
                    let q;
            
                        q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("date"), limit(parseInt(event.target.value)));
                    
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
                            name:user.name,

                            invoiceNum:user.invoiceNum,
                            price:user.price,
                            quantityString: user.quantityString,
                            techName:user.techName,
                            venderName:user.venderName
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

            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), orderBy("date"), limit(pageCount), startAfter(lastDoc));

        } else {

            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), orderBy("date"), limit(pageCount));

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
                invoiceNum:user.invoiceNum,
                price:user.price,
                quantityString: user.quantityString,
                techName:user.techName,
                venderName:user.venderName
            }

            count = count + 1

            setCustomerList(customerList => [...customerList, userData]); 

        });
    }
    async function previousPage(page){

        setPage(page - 1)

        let q;

        if (firstDoc) {

            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), orderBy("date"), limit(pageCount), startAt(firstDoc));

        } else {

            q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), orderBy("date"), limit(pageCount));

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

                name:user.name,

                invoiceNum:user.invoiceNum,

                price:user.price,

                quantityString: user.quantityString,

                techName:user.techName,

                venderName:user.venderName

            }

            count = count + 1

            setCustomerList(customerList => [...customerList, userData]); 
        });
    }
    useEffect(() => {
        (async () => {

            if (customerList.length < 3) {

                const currentDate = new Date();

                const newStartDate = new Date();

                newStartDate.setDate(currentDate.getDate() -7);

                setStartDate(newStartDate)

                try{
                    let q;
            
                    q = query(collection(db, 'companies',recentlySelectedCompany,'purchasedItems'), where("date", ">=", newStartDate), where("date", "<=", new Date(endDate)), orderBy("date"));
                    
                    const querySnapshot = await getDocs(q);

                    let count = 1 

                    setCustomerList([])  

                    querySnapshot.forEach((doc) => {

                        const user = doc.data()

                        const userData = {

                            id:user.id,

                            name:user.name,

                            invoiceNum:user.invoiceNum,

                            price:user.price,

                            quantityString: user.quantityString,

                            techName:user.techName,

                            venderName:user.venderName

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
            to={`/company/items/createNew`}>Create New</Link>
            <div className='w-full bg-[#747e79] p-4 rounded-md'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex justify-between items-center'>
                        {/* Search Bar */}
                        <input className="px-3 py-2 outline-none border bg-[#ededed] border-[#030811] rounded-md 
                        text-[#ededed] focus:border-[#ededed] overflow-hidden" type="text" name='search' placeholder='Search'  />
                         <div>
                            <div>
                                <h2>Start Date</h2>
                                <DatePicker 
                                    selected={startDate} 
                                    // onChange={(e) => {setEmail(e.target.value)}}
                                    onChange={(startDate) => handleStartDateChange(startDate)}
                                    // onChange={(date) => setDate(date)} 
                                />
                            </div>
                            <div>
                                <h2>End Date</h2>
                                <DatePicker 
                                    selected={endDate} 
                                    // onChange={(e) => {setEmail(e.target.value)}}
                                    onChange={(endDate) => handleEndDateChange(endDate)}
                                    // onChange={(date) => setDate(date)} 
                                />
                            </div>
                        </div>
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className='w-full text-sm text-left text-[#d0d2d6]'>
                            <thead className='text-sm text-[#d0d2d6] uppercase border-b border-slate-700'>
                                <tr>
                                    <th className='py-3 px-4'></th>
                                    <th className='py-3 px-4'>name</th>
                                    <th className='py-3 px-4'>price</th>
                                    <th className='py-3 px-4'>quantity String</th>
                                    <th className='py-3 px-4'>tech Name</th>
                                    <th className='py-3 px-4 visible sm:invisible lg:invisible '>vender Name</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                customerList?.map(purchase => (
                                    <tr key={purchase.id}>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${purchase.id}`}>{purchase.invoiceNum}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${purchase.id}`}>{purchase.name}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${purchase.id}`}>{purchase.price}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${purchase.id}`}>{purchase.quantityString}</Link></td>
                                        <td className='py-3 px-4 font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${purchase.id}`}>{purchase.techName}</Link></td>
                                        <td className='py-3 px-4 visible sm:invisible lg:invisible font-medium whitespace-nonwrap'><Link to={`/company/customers/details/${purchase.id}`}>{purchase.venderName}</Link></td>
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

export default PurchasesList;