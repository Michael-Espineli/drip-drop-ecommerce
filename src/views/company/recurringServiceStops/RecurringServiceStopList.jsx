
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from "../../../context/AuthContext";

const RecurringServiceStopList = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();
    const [stops, setStops] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setIsLoading(false);
            return;
        }

        // Corrected query to point to the plural 'recurringServiceStops' collection
        const stopsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop'));

        const unsubscribe = onSnapshot(stopsQuery, (snapshot) => {
            const stopsList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setStops(stopsList);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching recurring service stops:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();

    }, [recentlySelectedCompany]);

    const handleCreateNew = () => {
        // Corrected navigation path
        navigate('/company/recurring-service-stops/create');
    };
    
    const handleRowClick = (stopId) => {
        // Corrected navigation path
        navigate(`/company/recurringServiceStop/details/${stopId}`);
    }

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-3xl font-bold text-gray-800">Recurring Service Stops</h2>
                    <button
                        onClick={handleCreateNew}
                        className='py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition'>
                        Create New
                    </button>
                </div>

                <div className="bg-white shadow-lg rounded-xl overflow-hidden">
                     {isLoading ? (
                        <div className="text-center p-8"><p className="text-gray-500">Loading stops...</p></div>
                    ) : stops.length === 0 ? (
                        <div className="text-center p-8">
                            <h3 className="text-xl font-semibold text-gray-700">No Recurring Stops Found</h3>
                            <p className="text-gray-500 mt-2">Get started by creating a new recurring service stop.</p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Tech</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Frequency</th>
                                    <th scope="col" className="relative px-6 py-3"><span className="sr-only">View</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {stops.map(stop => (
                                    <tr key={stop.id} onClick={() => handleRowClick(stop.id)} className="hover:bg-gray-50 cursor-pointer">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{stop.customerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{stop.address?.streetAddress}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.tech || 'Not Assigned'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{stop.frequency}</div>
                                            <div className="text-sm text-gray-500">{Array.isArray(stop.daysOfWeek) ? stop.daysOfWeek.join(', ') : stop.daysOfWeek}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <span className="text-blue-600 hover:text-blue-900">View</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RecurringServiceStopList;
