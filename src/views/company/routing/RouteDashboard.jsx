
import React, { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from "react-datepicker";
import { query, collection, getDocs, where, Timestamp, addDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { MultiLocationMap } from '../../components/MultiLocationMap';
import "react-datepicker/dist/react-datepicker.css";

const RouteDashboard = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    
    const [serviceDate, setServiceDate] = useState(new Date());
    const [isLoading, setIsLoading] = useState(true);
    const [serviceStops, setServiceStops] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [activeRoutes, setActiveRoutes] = useState([]);

    const fetchData = useCallback(async (date) => {
        if (!recentlySelectedCompany) return;
        setIsLoading(true);

        try {
            const startOfDay = new Date(date).setHours(0, 0, 0, 0);
            const endOfDay = new Date(date).setHours(23, 59, 59, 999);

            // Fetch Service Stops for the selected date
            const stopsQuery = query(
                collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                where("serviceDate", ">=", new Date(startOfDay)),
                where("serviceDate", "<=", new Date(endOfDay))
            );
            const stopsSnapshot = await getDocs(stopsQuery);
            const fetchedStops = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setServiceStops(fetchedStops);

            // Fetch all company users (technicians)
            const techQuery = query(collection(db, "companies", recentlySelectedCompany, 'companyUsers'));
            const techSnapshot = await getDocs(techQuery);
            const fetchedTechs = techSnapshot.docs.map(doc => ({ ...doc.data(), docId: doc.id }));
            setTechnicians(fetchedTechs);

            // Sync active routes for each technician
            await syncActiveRoutes(fetchedStops, fetchedTechs, date);

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            toast.error("Failed to load dashboard data.");
        } finally {
            setIsLoading(false);
        }
    }, [recentlySelectedCompany]);

    const syncActiveRoutes = async (stops, techs, date) => {
        const startOfDay = new Date(date).setHours(0, 0, 0, 0);
        const endOfDay = new Date(date).setHours(23, 59, 59, 999);

        const routesQuery = query(
            collection(db, 'companies', recentlySelectedCompany, 'activeRoutes'),
            where("date", ">=", new Date(startOfDay)),
            where("date", "<=", new Date(endOfDay))
        );
        const routesSnapshot = await getDocs(routesQuery);
        let existingRoutes = routesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        for (const tech of techs) {
            const techStops = stops.filter(stop => stop.techId === tech.userId || stop.tech === tech.userName);
            if (techStops.length === 0) continue; // Skip techs with no stops

            const finishedStopsCount = techStops.filter(s => s.status === 'Finished').length;
            const totalStopsCount = techStops.length;
            const routeForTech = existingRoutes.find(r => r.techId === tech.userId);

            const newStatus = finishedStopsCount === totalStopsCount ? 'Finished' : (finishedStopsCount > 0 ? 'In Progress' : 'Did Not Start');

            if (routeForTech) {
                // Update existing route
                const routeRef = doc(db, 'companies', recentlySelectedCompany, 'activeRoutes', routeForTech.id);
                await updateDoc(routeRef, {
                    totalStops: totalStopsCount,
                    finishedStops: finishedStopsCount,
                    status: newStatus,
                    serviceStopsIds: techStops.map(s => s.id)
                });
            } else {
                // Create new active route
                const newRoute = {
                    name: `${tech.userName}'s Route - ${format(date, 'MM/dd/yyyy')}`,
                    date: Timestamp.fromDate(new Date(startOfDay)),
                    techId: tech.userId,
                    techName: tech.userName,
                    serviceStopsIds: techStops.map(s => s.id),
                    totalStops: totalStopsCount,
                    finishedStops: finishedStopsCount,
                    status: newStatus,
                    durationMin: 0,
                    distanceMiles: 0
                };
                await addDoc(collection(db, 'companies', recentlySelectedCompany, 'activeRoutes'), newRoute);
            }
        }
        
        // Re-fetch active routes to display the most current state
        const finalRoutesSnapshot = await getDocs(routesQuery);
        setActiveRoutes(finalRoutesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    
    useEffect(() => {
        fetchData(serviceDate);
    }, [serviceDate, fetchData]);

    const mapLocations = useMemo(() => {
        return serviceStops.map(stop => {
            const lat = parseFloat(stop.address?.latitude);
            const lng = parseFloat(stop.address?.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
                return { ...stop.address, id: stop.id, lat, lng };
            }
            return null;
        }).filter(Boolean);
    }, [serviceStops]);

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-screen-2xl mx-auto">
                <header className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">Route Dashboard</h1>
                    <DatePicker 
                        selected={serviceDate} 
                        onChange={setServiceDate}
                        className="bg-white border border-gray-300 rounded-lg p-2 shadow-sm text-gray-700"
                    />
                </header>

                {isLoading ? (
                    <div className="flex justify-center items-center h-64"><p className="text-gray-500">Loading dashboard...</p></div>
                ) : (
                    <main className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                        <section className="xl:col-span-2 bg-white p-6 rounded-2xl shadow-lg">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">Daily Overview Map</h2>
                            <div className="w-full h-96 md:h-[500px] rounded-lg overflow-hidden border border-gray-200">
                                {mapLocations.length > 0 ? (
                                    <MultiLocationMap locations={mapLocations} key={serviceDate.toISOString()} />
                                ) : (
                                    <div className='flex justify-center items-center h-full bg-gray-100'><p className='text-gray-500'>No map data for this date.</p></div>
                                )}
                            </div>
                        </section>

                        <section className="bg-white p-6 rounded-2xl shadow-lg">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">Technician Overview</h2>
                            <div className="space-y-4">
                                {activeRoutes.length > 0 ? activeRoutes.map(route => (
                                    <TechRouteCard key={route.id} route={route} />
                                )) : (
                                    <p className="text-gray-500 pt-4">No active routes for this date.</p>
                                )}
                            </div>
                        </section>

                        <section className="xl:col-span-3 bg-white p-6 rounded-2xl shadow-lg">
                            <h2 className='text-xl font-bold text-gray-800 mb-4'>Service Stops ({serviceStops.length})</h2>
                            <ServiceStopTable stops={serviceStops} navigate={navigate} />
                        </section>
                    </main>
                )}
            </div>
        </div>
    );
};

// Helper component for displaying technician route info
const TechRouteCard = ({ route }) => {
    const getStatusClass = (status) => {
        switch (status) {
            case 'Finished': return 'bg-green-100 text-green-800';
            case 'In Progress': return 'bg-blue-100 text-blue-800';
            default: return 'bg-yellow-100 text-yellow-800';
        }
    };

    return (
        <div className="border rounded-lg p-4 transition-all hover:shadow-md">
            <div className="flex justify-between items-center mb-2">
                <p className="font-bold text-gray-800">{route.techName}</p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getStatusClass(route.status)}`}>{route.status}</span>
            </div>
            <div className="text-sm text-gray-600 space-y-1">
                <p>Stops: {route.finishedStops} / {route.totalStops}</p>
                <p>Mileage: {route.distanceMiles ? `${Number(route.distanceMiles).toFixed(1)} mi` : 'N/A'}</p>
                 <p>Duration: {route.durationMin ? `${Math.floor(route.durationMin / 60)}h ${route.durationMin % 60}m` : 'N/A'}</p>
            </div>
        </div>
    );
};

// Helper component for displaying the service stop table
const ServiceStopTable = ({ stops, navigate }) => (
    <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
                <tr>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Customer</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Address</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Technician</th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Status</th>
                </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {stops.length > 0 ? stops.map(stop => (
                    <tr key={stop.id} onClick={() => navigate(`/company/serviceStops/detail/${stop.id}`)} className="cursor-pointer hover:bg-gray-50">
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900'>{stop.customerName}</td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600'>{stop.address?.streetAddress || 'No Address'}</td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-600'>{stop.tech || 'Unassigned'}</td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${stop.status === 'Finished' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                {stop.status || 'Pending'}
                            </span>
                        </td>
                    </tr>
                )) : (
                    <tr><td colSpan="4" className="text-center py-10 text-gray-500">No service stops for the selected date.</td></tr>
                )}
            </tbody>
        </table>
    </div>
);

export default RouteDashboard;
