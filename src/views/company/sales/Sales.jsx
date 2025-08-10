import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, doc, orderBy, updateDoc, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
import { Customer } from '../../../utils/models/Customer';

const Sales = () => {
    
    const {name,recentlySelectedCompany} = useContext(Context);
    const [customerList, setCustomerList] = useState([]);
    const [filterCustomerList, setFilterCustomerList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        (async () => {
            if (customerList.length < 1 ) {
                try{
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'customers'), orderBy("firstName"));   
                    const querySnapshot = await getDocs(q);     
                    const customerData = querySnapshot.docs.map(doc => Customer.fromFirestore(doc));

                    setCustomerList(customerData);
                    setFilterCustomerList(customerData);
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

        } else {
            console.log('Empty')

            setFilterCustomerList(customerList)
        }
    };
 
    async function updateEquipment(e) {
        e.preventDefault()

        try{
            // let qComp;
            // qComp = query(collection(db, 'companies'));   
            // const querySnapshotComp = await getDocs(qComp);       
            // let companyList = []
            // console.log("Start Update: operationStatus")
            // querySnapshotComp.forEach((doc) => {
            //     const compData = doc.data()
            //     const comp = {
            //         id: compData.id,
            //         name: compData.name
            //     }
            //     companyList.push(comp)
            // });
            // for (let i = 0; i < companyList.length; i++) {
            //     let company = companyList[i]
            //     console.log("Getting ServiceStops for: ", company.name)
            //     let q;
            //         q = query(collection(db, 'companies',company.id,'serviceLocations'));   
            //     const querySnapshot = await getDocs(q);       
            //     let serviceStopList = []
            //     querySnapshot.forEach((doc) => {
            //         const serviceStopData = doc.data()
            //         const serviceStop = {
            //             id:serviceStopData.id,
            //             mainContact:serviceStopData.mainContact,
            //             customerId:serviceStopData.customerId
            //         }
            //         serviceStopList.push(serviceStop)
            //     });
            //     console.log("Updating Service Stop: " + serviceStopList.length)
            //     for (let i = 0; i < serviceStopList.length; i++) {
            //         let serviceStop = serviceStopList[i]
            //         // setDoc
            //         // updateDoc
            //         if (serviceStop.mainContact.id != "") {

            //             console.log("Location " + serviceStop.id)
            //             await setDoc(doc(db, "companies",company.id, "customers",serviceStop.customerId,'contacts',serviceStop.mainContact.id), {
            //                 email: serviceStop.mainContact.email,
            //                 id: serviceStop.mainContact.id,
            //                 name: serviceStop.mainContact.name,
            //                 notes: serviceStop.mainContact.notes,
            //                 phoneNumber: serviceStop.mainContact.phoneNumber
            //             });
            //             console.log("Successfully Creating New Contact:" + serviceStop.mainContact.id)
            //         }
                    
            //     }
            // }
        } catch(error){
            console.log('Error')
            console.log(error)
        }
    }
    return (

        <div className='px-2 md:px-7 py-5'>
            <div className='py-2'>
                <Link 
                className='py-1 px-2 yellow-bg rounded-md text-[#000000]'
                to={`/company/customers/createNew`}>
                    Create New
                </Link>
            </div>
            <div className='w-full rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex w-full justify-between items-center py-2'>
                        <input 
                            onChange={(e) => {searchHandler(e)}}
                            value={searchTerm}
                            className="text-field w-full p-2 border rounded"
                            type="text" 
                            name='search' 
                            placeholder="Search..."
                        />
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className="min-w-full bg-white border border-gray-200">
                            <thead>
                                <tr>
                                    <th className='px-4 py-2 border-b'>Name</th>
                                    <th className='px-4 py-2 border-b'>Street Address</th>
                                    <th className='px-4 py-2 border-b'>Phone Number</th>
                                    <th className='px-4 py-2 border-b'>Email</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                filterCustomerList?.map(customer => (
                                    <tr key={customer.id}>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/customers/details/${customer.id}`}>{customer.name}</Link></td>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/customers/details/${customer.id}`}>{customer.streetAddress}</Link></td>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/customers/details/${customer.id}`}>{customer.phoneNumber}</Link></td>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/customers/details/${customer.id}`}>{customer.email}</Link></td>
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

export default Sales;