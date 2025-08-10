import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, doc, orderBy, updateDoc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link } from 'react-router-dom';
import { Customer } from '../../../utils/models/Customer';

const Customers = () => {
    
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
                    console.error('Customer Data Error!: ' + error)
                }
            }
        })();
    },[])


   // Effect to filter Customers items based on search term
    useEffect(() => {
        if (searchTerm === '') {
            setFilterCustomerList(customerList);
        } else {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            console.log("Searching " + lowerCaseSearchTerm)
            setFilterCustomerList(
                customerList.filter(item => item.firstName.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.lastName.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.billingAddress.streetAddress.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.billingAddress.city.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.billingAddress.state.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.billingAddress.zip.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.phoneNumber.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.company.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.email.toLowerCase().includes(lowerCaseSearchTerm)
                )
            );
        }
    }, [customerList, searchTerm]); // Re-filter when customerList or searchTerm changes

    async function updateEquipment(e) {
        e.preventDefault()

        try{
            let qComp;
            qComp = query(collection(db, 'companies'));   
            const querySnapshotComp = await getDocs(qComp);       
            let companyList = []
            console.log("Start Update: operationStatus")
            querySnapshotComp.forEach((doc) => {
                const compData = doc.data()
                const comp = {
                    id: compData.id,
                    name: compData.name
                }
                companyList.push(comp)
            });
            for (let i = 0; i < companyList.length; i++) {
                let company = companyList[i]
                console.log("Getting ServiceLocations for: ", company.name)
                let q;
                    q = query(collection(db, 'companies',company.id,'serviceLocations'));   
                const querySnapshot = await getDocs(q);       
                let serviceLocations = []
                querySnapshot.forEach((doc) => {
                    const serviceStopData = doc.data()
                    const serviceStop = {
                        id:serviceStopData.id,
                        customerId:serviceStopData.customerId,
                        lat: serviceStopData.address.latitude,
                        lng: serviceStopData.address.longitude
                    }
                    serviceLocations.push(serviceStop)
                });
                console.log("Updating Service Stop: " + serviceLocations.length)
                for (let i = 0; i < serviceLocations.length; i++) {
                    let serviceStop = serviceLocations[i]
                    //Get Customer Contact
                    console.log("Customer: ", serviceStop.customerId)
                    const docRef = doc(db, "companies",company.id,'customers',serviceStop.customerId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
    
                        console.log("Found Customer");
                        const snapCustomer =  Customer.fromFirestore(docSnap)


                        console.log("Location " + serviceStop.id)
                        await updateDoc(doc(db, "companies",company.id, "serviceLocations",serviceStop.id), {
                            address:{
                                longitude: serviceStop.lng,
                                latitude: serviceStop.lat,
                                streetAddress: snapCustomer.billingAddress.streetAddress,
                                city: snapCustomer.billingAddress.city,
                                state: snapCustomer.billingAddress.state,
                                zip: snapCustomer.billingAddress.zip,
                            },
                        });
                        console.log("Successfully Updated Service Location Address:", serviceStop.id, ": ", snapCustomer.firstName, " ", snapCustomer.lastName)
                      } else {
                        console.log("No such document!");
                      }
                    // updateDoc
                    
                    
                }
            }
        } catch(error){
            console.log('Error')
            console.log(error)
        }
    }
    return (

        <div className='px-2 md:px-7 py-5'>
            <div className='py-2 flex justify-between'>
                <Link 
                className='py-1 px-2 yellow-bg rounded-md text-[#000000]'
                to={`/company/customers/createNew`}>
                    Create New
                </Link>

                <button 
                onClick={(e) => updateEquipment(e)} 
                className="py-1 px-2 yellow-bg rounded-md text-[#000000]" >
                    <p>Update Locations</p>
                </button>
                <h1>Customers: {filterCustomerList.length}</h1>
            </div>
            <div className='w-full rounded-md mt-3'>
                <div className='left-0 w-full justify-between'>
                    <div className='flex w-full justify-between items-center py-2'>
                        <input 
                            onChange={(e) => setSearchTerm(e.target.value)}
                            value={searchTerm}
                            className="text-field w-full p-2 border rounded"
                            type="text" 
                            placeholder="Search..."
                        />
                    </div>
                    <div className='relative overflow-x-auto'>
                        <table className="min-w-full bg-white border border-gray-200">
                            <thead>
                                <tr>
                                    <th className='px-4 py-2 border-b'>Name</th>
                                    <th className='px-4 py-2 border-b'> Address</th>
                                    <th className='px-4 py-2 border-b'>Phone Number</th>
                                    <th className='px-4 py-2 border-b'>Email</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                filterCustomerList?.map(customer => (
                                    <tr key={customer.id}>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/customers/details/${customer.id}`}>
                                        
                                        {customer.displayAsCompany ? <h1>{customer.company}</h1>:<h1>{customer.firstName} {customer.lastName}</h1>}
                                        </Link></td>
                                        <td className='px-4 py-2 border-b'><Link to={`/company/customers/details/${customer.id}`}>{customer.billingAddress.streetAddress} {customer.billingAddress.city} {customer.billingAddress.state} {customer.billingAddress.zip}</Link></td>
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

export default Customers;