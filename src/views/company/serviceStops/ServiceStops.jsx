
import React, { useState, useEffect, useContext } from "react";
import { query, collection, getDocs, orderBy, where } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import { ServiceStop } from '../../../utils/models/ServiceStop';

const ServiceStops = () => {

    //how to receive navigate('/company/serviceStops', {replace: true, state: { date: e.target.value } });
    const navigate = useNavigate();

    const location = useLocation();
    const [serviceStopList, setServiceStopList] = useState([]);
    const [filteredStops, setFilteredStops] = useState([]);
    const { recentlySelectedCompany } = useContext(Context);
    const [searchTerm, setSearchTerm] = useState('');

    // const [statusFilter, setStatusFilter] = useState(location.state?.filter || 'All');
    // const [currentDate, setCurrentDate] = useState(location.state?.date || new Date());

    const [statusFilter, setStatusFilter] = useState('All');

    const [currentDate, setCurrentDate] = useState(new Date());

    useEffect(() => {
        const fetchServiceStops = async () => {
            if (recentlySelectedCompany) {
                try {
                    const startOfDay = new Date();
                    startOfDay.setHours(0, 0, 0, 0);
    
                    const endOfDay = new Date();
                    endOfDay.setHours(23, 59, 59, 999);

                    const q = query(collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                    orderBy('serviceDate', 'desc'),where("serviceDate", ">=", startOfDay),
                    where("serviceDate", "<=", endOfDay));

                    const querySnapshot = await getDocs(q);
                    const stops = querySnapshot.docs.map(doc => ServiceStop.fromFirestore(doc));
                    setServiceStopList(stops);
                    setFilteredStops(stops);
                } catch (error) {
                    console.error("Error fetching service stops: ", error);
                }
            }
        };
        fetchServiceStops();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        let stops = [...serviceStopList];
        // Apply search term filter
        if (searchTerm) {
            stops = stops.filter(stop => 
                stop.tech.toLowerCase().includes(searchTerm.toLowerCase()) ||
                stop.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                stop.address.streetAddress.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Apply status filter
        if (statusFilter !== 'All') {
            stops = stops.filter(stop => stop.status === statusFilter);
        }

        // Apply date filter (this is a basic example, could be more complex)
        // For now, it doesn't do anything, but you can build on it.

        setFilteredStops(stops);
    }, [searchTerm, statusFilter, serviceStopList]);

    const getStatusClass = (status) => {
        switch (status) {
            case 'Completed': return 'bg-green-100 text-green-800';
            case 'Scheduled': return 'bg-blue-100 text-blue-800';
            case 'Canceled': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };
    async function onChangeOfSelectedDate(e) {
        e.preventDefault()
        setCurrentDate(e.target.value)
        if (recentlySelectedCompany) {
            try {
                const [year, month, day] = e.target.value.split("-").map(Number);

                const startOfDay = new Date(year, month-1, day, 0, 0, 0, 0);
                const endOfDay = new Date(year, month-1, day, 23, 59, 59, 999);

                console.log(e.target.value)
                console.log(startOfDay)
                console.log(endOfDay)

                navigate('/company/serviceStops', {
                    replace: true, state: { date: e.target.value } 
                });

                const q = query(collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                orderBy('serviceDate', 'desc'),where("serviceDate", ">=", startOfDay),
                where("serviceDate", "<=", endOfDay));

                const querySnapshot = await getDocs(q);
                const stops = querySnapshot.docs.map(doc => ServiceStop.fromFirestore(doc));
                setServiceStopList(stops);
                setFilteredStops(stops);
            } catch (error) {
                console.error("Error fetching service stops: ", error);
            }
        }
    }
    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-800">Service Stops</h2>

                    </div>
                    <Link to={'/company/serviceStops/createNew'} className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition'>
                        Create New
                    </Link>
                </div>

                <div className="bg-white shadow-lg rounded-xl p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <input
                            type="text"
                            placeholder="Search by tech, customer, or address..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        />
                         <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500">
                            <option>All</option>
                            <option>Not Finished</option>
                            <option>Finished</option>
                            <option>Skipped</option>
                        </select>
                        <input
                            type="date"
                            value ={currentDate}
                            onChange={(e) => onChangeOfSelectedDate(e)}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    <div className='overflow-x-auto'>
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Date</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Technician</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Customer</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Address</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Status</th>
                                    <th className='p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider'>Details</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredStops.map(stop => (
                                    <tr key={stop.id} className="hover:bg-gray-50 transition-colors">
                                        <td className='p-4 whitespace-nowrap text-gray-700'>{stop.serviceDate ? format(stop.serviceDate, 'PP') : 'N/A'}</td>
                                        <td className='p-4 whitespace-nowrap text-gray-800 font-medium'>{stop.tech}</td>
                                        <td className='p-4 whitespace-nowrap text-gray-700'>{stop.customerName}</td>
                                        <td className='p-4 whitespace-nowrap text-gray-700'>{stop.address.streetAddress}</td>
                                        <td className='p-4 whitespace-nowrap'>
                                            <span className={`px-3 py-1 text-xs font-bold leading-none rounded-full ${getStatusClass(stop.operationStatus)}`}>
                                                {stop.operationStatus}
                                            </span>
                                        </td>
                                        <td className='p-4 whitespace-nowrap'>
                                            <Link to={`/company/serviceStops/detail/${stop.id}`} className="font-medium text-blue-600 hover:text-blue-800">View Details</Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ServiceStops;
