import React, { useContext, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Context } from '../../context/AuthContext';
import RecentChatsWidget from './Messages/RecentChatsWidget';
import {
    BuildingStorefrontIcon,
    WrenchScrewdriverIcon,
    DocumentTextIcon,
    CalendarDaysIcon,
    PlusCircleIcon,
    ExclamationTriangleIcon,
    HomeModernIcon
} from '@heroicons/react/24/outline';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../../utils/config';

const ActionCard = ({ to, icon, title, description, buttonText, buttonClass }) => (
    <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center text-center transition-transform transform hover:-translate-y-1">
        <div className="mb-4">{icon}</div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
        <p className="text-gray-600 mb-6 flex-grow">{description}</p>
        <Link
            to={to}
            className={`w-full text-white font-semibold py-2 px-4 rounded-lg transition-colors ${buttonClass}`}
        >
            {buttonText}
        </Link>
    </div>
);

const MyPoolSnapshot = () => {
    const { user } = useContext(Context);
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const locationsRef = collection(db, 'homeOwnerServiceLocations');
        const q = query(locationsRef, where('userId', '==', user.uid), limit(2));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedLocations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLocations(fetchedLocations);
            setLoading(false);
        }, () => {
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);
    
    const renderSkeleton = () => (
        <div className="space-y-4 animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-3/4"></div>
            <div className="h-12 bg-gray-200 rounded-lg"></div>
            <div className="h-12 bg-gray-200 rounded-lg"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <WrenchScrewdriverIcon className="w-8 h-8 text-teal-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">My Pool Status</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : locations.length > 0 ? (
                    <div className="space-y-4">
                        {locations.map(loc => (
                            <div key={loc.id} className="p-3 bg-gray-50 rounded-lg">
                                <p className='font-bold text-gray-800 mb-2 truncate'>{loc.name}</p>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-semibold text-gray-600">Last Service:</span>
                                    <span className="font-bold text-gray-700">June 15, 2024</span>
                                </div>
                                <div className="flex items-center justify-between text-sm mt-1">
                                    <span className="font-semibold text-gray-600">Next Service:</span>
                                    <span className="font-bold text-green-600">June 22, 2024</span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <HomeModernIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500 font-medium">You haven't added a pool yet.</p>
                        <p className="text-sm text-gray-400">Add your pool to get service updates.</p>
                    </div>
                )}
            </div>
            <Link 
                to={locations.length > 0 ? "/client/my-pool" : "/client/my-pool/new"} 
                className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-teal-600 hover:bg-teal-700 transition-colors"
            >
                {locations.length > 0 ? 'View All Pools' : 'Add a New Pool'}
            </Link>
        </div>
    );
};

const RepairRequestsWidget = () => {
    const { user } = useContext(Context);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }
        console.log("Getting Repair Requsts")
        const requestsRef = collection(db, 'homeOwnerRepairRequests');
        const q = query(
            requestsRef,
            where('userId', '==', user.uid),
            where('status', 'in', ['pending', 'in progress']),
            orderBy('createdAt', 'desc'),
            limit(3)
        );
        console.log("Got Repair Requsts")

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedRequests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRequests(fetchedRequests);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <ExclamationTriangleIcon className="w-8 h-8 text-red-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Repair Requests</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : requests.length > 0 ? (
                    <ul className="space-y-3">
                        {requests.map(req => (
                            <li key={req.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                <p className="text-gray-700 font-medium truncate">{req.description}</p>
                                <span className="text-sm font-semibold text-yellow-600 bg-yellow-100 px-2 py-1 rounded-full">{req.status}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <PlusCircleIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">No outstanding repair requests.</p>
                    </div>
                )}
            </div>
            <Link to="/client/repair-requests/new" className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 transition-colors">
                {requests.length > 0 ? 'View All Requests' : 'Create New Request'}
            </Link>
        </div>
    );
};

const ContractsWidget = () => {
    const { user } = useContext(Context);
    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }
        const contractsRef = collection(db, 'contracts');
        const q = query(contractsRef, where('clientId', '==', user.uid), where('status', '==', 'active'), limit(3));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedContracts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setContracts(fetchedContracts);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsubscribe();
    }, [user]);
    
    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <DocumentTextIcon className="w-8 h-8 text-indigo-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Active Contracts</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : contracts.length > 0 ? (
                    <ul className="space-y-3">
                        {contracts.map(con => (
                            <li key={con.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                <p className="text-gray-700 font-medium truncate">{con.companyName}</p>
                                <span className="text-sm font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full">{con.status}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <BuildingStorefrontIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">You have no active contracts.</p>
                    </div>
                )}
            </div>
            <Link to={contracts.length > 0 ? "/client/contracts" : "/client/companies"} className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors">
                {contracts.length > 0 ? 'View All Contracts' : 'Browse Companies'}
            </Link>
        </div>
    );
};

const ServiceRequestsWidget = () => {
    const { user } = useContext(Context);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const requestsRef = collection(db, 'serviceRequests');
        const q = query(
            requestsRef,
            where('userId', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(3)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedRequests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRequests(fetchedRequests);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <DocumentTextIcon className="w-8 h-8 text-blue-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Service Requests</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : requests.length > 0 ? (
                    <ul className="space-y-3">
                        {requests.map(req => (
                            <li key={req.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                <p className="text-gray-700 font-medium truncate">{req.companyName}</p>
                                <span className={`text-sm font-semibold px-2 py-1 rounded-full ${
                                    req.status === 'pending' ? 'text-yellow-600 bg-yellow-100' :
                                    req.status === 'approved' ? 'text-green-600 bg-green-100' :
                                    'text-red-600 bg-red-100'
                                }`}>{req.status}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <PlusCircleIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">You haven't made any service requests yet.</p>
                    </div>
                )}
            </div>
            <Link
                to={requests.length > 0 ? "/client/service-requests" : "/client/companies"}
                className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
            >
                {requests.length > 0 ? 'View All Requests' : 'Browse Companies'}
            </Link>
        </div>
    );
};


const ClientDashboard = () => {
    const { name } = useContext(Context);

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="w-full max-w-6xl mx-auto">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-800 mb-2">Welcome, {name}!</h1>
                    <p className="text-lg text-gray-600">Here's a quick overview of your account.</p>
                </div>

                {/* Top Widgets Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    <div className="lg:col-span-2">
                        <RecentChatsWidget />
                    </div>
                    <div>
                        <MyPoolSnapshot />
                    </div>
                </div>
                
                {/* Mid Widgets Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                    <RepairRequestsWidget />
                    <ContractsWidget />
                    <ServiceRequestsWidget />
                </div>
            </div>
        </div>
    );
};

export default ClientDashboard;
