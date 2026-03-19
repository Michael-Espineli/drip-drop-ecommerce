
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { format, startOfDay, endOfDay } from 'date-fns';
import { WorkLogMap } from '../../components/WorkLogMap';

// --- Components ---
const WorkLogCard = ({ log, navigate }) => (
    <div 
        className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-500 transition-all cursor-pointer grid grid-cols-3 gap-4 items-center"
        onClick={() => navigate(`/company/worklogs/${log.id}`)}
    >
        <div className="col-span-2">
            <p className="font-semibold text-md text-gray-800">{log.userName || 'N/A'}</p>
            <p className="text-sm text-gray-500">{log.jobName || 'N/A'}</p>
        </div>
        <div className="text-right">
            <p className="font-bold text-lg text-blue-600">{log.hoursWorked || 0} hrs</p>
        </div>
    </div>
);

// --- Main Component ---
const WorkLogs = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    
    const [workLogs, setWorkLogs] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [selectedRouteId, setSelectedRouteId] = useState('');
    
    const [isLoading, setIsLoading] = useState(true);

    // Effect to fetch available routes for the selected date
    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchRoutes = async () => {
            const start = startOfDay(selectedDate);
            const end = endOfDay(selectedDate);
            
            const routesRef = collection(db, 'companies', recentlySelectedCompany, 'activeRoutes');
            const q = query(routesRef, 
                where('date', '>=', start),
                where('date', '<=', end)
            );
            
            try {
                const querySnapshot = await getDocs(q);
                const fetchedRoutes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRoutes(fetchedRoutes);
                // Reset selection if routes change
                setSelectedRouteId('');
                setWorkLogs([]);
            } catch (error) {
                console.error("Error fetching routes: ", error);
                toast.error("Failed to fetch routes for the selected date.");
            }
        };

        fetchRoutes();
    }, [recentlySelectedCompany, selectedDate]);

    // Effect to fetch work logs for the selected route
    useEffect(() => {
        if (!recentlySelectedCompany || !selectedRouteId) {
            setWorkLogs([]);
            setIsLoading(false);
            return;
        }

        const fetchWorkLogs = async () => {
            setIsLoading(true);
            try {
                const logsRef = collection(db, 'companies', recentlySelectedCompany, 'activeRouteLocations');
                const q = query(logsRef, where('activeRouteId', '==', selectedRouteId));
                
                const querySnapshot = await getDocs(q);
                const logs = querySnapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data(),
                    latitude: doc.data().latitude || 0,
                    longitude: doc.data().longitude || 0
                }));

                setWorkLogs(logs);

            } catch (error) {
                console.error("Error fetching work logs: ", error);
                toast.error("Failed to fetch work logs.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchWorkLogs();
    }, [recentlySelectedCompany, selectedRouteId]);


    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6'>
            <div className="max-w-7xl mx-auto">
                {/* --- Header --- */}
                <header className="bg-white rounded-lg shadow p-4 mb-6">
                    <div className="flex flex-col md:flex-row justify-between md:items-center">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Work Logs</h1>
                            <p className="text-gray-600 mt-1">Track and visualize daily work logs.</p>
                        </div>
                        <div className="mt-4 md:mt-0 flex flex-col sm:flex-row items-center gap-4">
                            <div className="flex items-center gap-2">
                                <label htmlFor="date-picker" className="font-semibold text-gray-700">Date:</label>
                                <input 
                                    id="date-picker"
                                    type="date"
                                    value={format(selectedDate, 'yyyy-MM-dd')}
                                    onChange={(e) => setSelectedDate(new Date(e.target.value))}
                                    className="p-2 bg-white border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <label htmlFor="route-picker" className="font-semibold text-gray-700">Route:</label>
                                <select 
                                    id="route-picker"
                                    value={selectedRouteId}
                                    onChange={(e) => setSelectedRouteId(e.target.value)}
                                    className="p-2 bg-white border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 w-full sm:w-48"
                                    disabled={routes.length === 0}
                                >
                                    <option value="">{routes.length > 0 ? 'Select a route' : 'No routes for date'}</option>
                                    {routes.map(route => (
                                        <option key={route.id} value={route.id}>{route.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </header>

                {/* --- Main Content --- */}
                <div className="space-y-6">
                    {/* --- Map View --- */}
                    <div className="bg-white p-4 rounded-lg shadow-md">
                         <h2 className="text-xl font-bold text-gray-800 mb-4">Log Locations</h2>
                        {isLoading && !selectedRouteId ? (
                             <div className="h-[400px] flex items-center justify-center text-gray-500">Please select a route to see locations.</div>
                        ) : (
                            <WorkLogMap logs={workLogs} />
                        )}
                    </div>

                    {/* --- Logs List --- */}
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 mb-4">Work Log Details</h2>
                        <div className="space-y-4">
                            {isLoading ? (
                                <div className="text-center text-gray-500 py-10">Loading...</div>
                            ) : workLogs.length > 0 ? (
                                workLogs.map(log => <WorkLogCard key={log.id} log={log} navigate={navigate} />)
                            ) : (
                                <div className="text-center py-10 bg-white rounded-lg shadow-md">
                                    <h3 className="text-lg font-semibold text-gray-700">No Logs Found</h3>
                                    <p className="text-gray-500 mt-1">
                                        {selectedRouteId ? 'No work logs were recorded for this route.' : 'Please select a date and route to view logs.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default WorkLogs;
