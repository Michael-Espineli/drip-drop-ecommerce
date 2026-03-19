import React, {useState, useEffect, useContext} from 'react';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, doc, orderBy, updateDoc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { Link, useNavigate } from 'react-router-dom';
import { ServiceLocation } from '../../../utils/models/ServiceLocation';

export default function ServiceLocations() {
    const navigate = useNavigate();
    const {name,recentlySelectedCompany} = useContext(Context);
    const [serviceLocationList, setServiceLocationList] = useState([]);    
    const [filterServiceLocationList, setFilterServiceLocationList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        (async () => {
            if (serviceLocationList.length < 1 ) {
                try{
                    let q = query(collection(db, 'companies',recentlySelectedCompany,'serviceLocations'));   
                    const querySnapshot = await getDocs(q);     
                    const customerData = querySnapshot.docs.map(doc => ServiceLocation.fromFirestore(doc));

                    setServiceLocationList(customerData);
                    setFilterServiceLocationList(customerData);
                } catch(error){
                    console.error('Customer Data Error!: ' + error)
                }
            }
        })();
    },[])


   // Effect to filter Customers items based on search term
    useEffect(() => {
        if (searchTerm === '') {
            setFilterServiceLocationList(serviceLocationList);
        } else {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            console.log("Searching " + lowerCaseSearchTerm)
            setFilterServiceLocationList(
                serviceLocationList.filter(item => item.nickName.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.address.streetAddress.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.address.city.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.address.state.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.address.zip.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.contact.phoneNumber.toLowerCase().includes(lowerCaseSearchTerm) ||
                    item.contact.email.toLowerCase().includes(lowerCaseSearchTerm)
                )
            );
        }
    }, [serviceLocationList, searchTerm]); 
    
    return (

        <div className='px-2 md:px-7 py-5'>
            <h2 className="text-2xl font-bold mb-4">Service Locations</h2>

            <div className='py-2 flex justify-between'>
                <Link 
                className='py-1 px-2 yellow-bg rounded-md text-[#000000]'
                to={`/company/serviceLocations/createNew`}>
                    Create New
                </Link>
                <button 
                // onClick={(e) => updateEquipment(e)} 
                className="py-1 px-2 yellow-bg rounded-md text-[#000000]" >
                    <p>Update Locations</p>
                </button>
                <h1>Customers: {filterServiceLocationList.length}</h1>
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
                                    <th className='px-4 py-2 border-b'>Nick Name</th>
                                    <th className='px-4 py-2 border-b'>Address</th>
                                    <th className='px-4 py-2 border-b'>Contact Name</th>
                                    <th className='px-4 py-2 border-b'>Contact Phone Number</th>
                                    <th className='px-4 py-2 border-b'>Contact Email</th>
                                </tr>
                            </thead>
                            <tbody>
                            {
                                filterServiceLocationList?.map(customer => (
                                    <tr key={customer.id} onClick={() => navigate(`/company/serviceLocations/detail/${customer.id}`)} className="cursor-pointer hover:bg-gray-100">
                                        <td className='px-4 py-2 border-b'><h1>{customer.nickName}</h1></td>
                                        <td className='px-4 py-2 border-b'>{customer.address.streetAddress} {customer.address.city} {customer.address.state} {customer.address.zip}</td>
                                        <td className='px-4 py-2 border-b'>{customer.mainContact.name}</td>
                                        <td className='px-4 py-2 border-b'>{customer.mainContact.phoneNumber}</td>
                                        <td className='px-4 py-2 border-b'>{customer.mainContact.email}</td>
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
}