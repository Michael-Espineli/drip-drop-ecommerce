
import React, { useState, useContext, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../utils/config';
import { query, collection, getDocs, where, orderBy } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import { PlusIcon, ChevronRightIcon, WrenchScrewdriverIcon, TruckIcon, DocumentTextIcon, BeakerIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const MyPool = () => {
    const { user } = useContext(Context);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState('all');
    
    const [allData, setAllData] = useState({
        bodiesOfWater: [],
        equipment: [],
        repairRequests: [],
        serviceStops: [],
        contracts: [],
    });

    const [displayData, setDisplayData] = useState({
        bodiesOfWater: [],
        equipment: [],
        repairRequests: [],
        lastService: null,
        nextService: null,
        contracts: [],
    });

    const [loading, setLoading] = useState(true);
    const [initialLoad, setInitialLoad] = useState(true);

    useEffect(() => {
        if (!user || !initialLoad) return;

        const fetchAllData = async () => {
            setLoading(true);
            const userFilter = where('userId', '==', user.uid);
            try {
                const locationQuery = query(collection(db, 'homeOwnerServiceLocations'), userFilter);
                const bowQuery = query(collection(db, 'homeOwnerBodiesOfWater'), userFilter);
                const equipQuery = query(collection(db, 'homeOwnerEquipment'), userFilter);
                const repairQuery = query(collection(db, 'homeOwnerRepairRequests'), userFilter, orderBy('createdAt', 'desc'));
                const serviceQuery = query(collection(db, 'homeOwnerServiceStops'), userFilter, orderBy('serviceDate', 'desc'));
                const contractQuery = query(collection(db, 'contracts'), userFilter);

                const [locSnap, bowSnap, equipSnap, repairSnap, serviceSnap, contractSnap] = await Promise.all([
                    getDocs(locationQuery),
                    getDocs(bowQuery),
                    getDocs(equipQuery),
                    getDocs(repairQuery),
                    getDocs(serviceQuery),
                    getDocs(contractQuery) 
                ]);

                setServiceLocations(locSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setAllData({
                    bodiesOfWater: bowSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    equipment: equipSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    repairRequests: repairSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    serviceStops: serviceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    contracts: contractSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                });

            } catch (error) {
                console.error("Error fetching initial data: ", error);
            } finally {
                setInitialLoad(false);
                setLoading(false);
            }
        };

        fetchAllData();
    }, [user, initialLoad]);

    useEffect(() => {
        if (initialLoad) return;

        let filteredBodiesOfWater = allData.bodiesOfWater;
        let filteredEquipment = allData.equipment;
        let filteredRepairRequests = allData.repairRequests;
        let filteredContracts = allData.contracts;
        let filteredServiceStops = allData.serviceStops;

        if (selectedLocation !== 'all') {
            filteredBodiesOfWater = allData.bodiesOfWater.filter(item => item.serviceLocationId === selectedLocation);
            filteredEquipment = allData.equipment.filter(item => item.serviceLocationId === selectedLocation);
            filteredRepairRequests = allData.repairRequests.filter(item => item.serviceLocationId === selectedLocation);
            filteredContracts = allData.contracts.filter(item => item.serviceLocationId === selectedLocation);
            filteredServiceStops = allData.serviceStops.filter(item => item.serviceLocationId === selectedLocation);
        }

        const lastService = filteredServiceStops.length > 0 ? filteredServiceStops[0] : null;

        setDisplayData({
            bodiesOfWater: filteredBodiesOfWater.slice(0, 5),
            equipment: filteredEquipment.slice(0, 5),
            repairRequests: filteredRepairRequests.slice(0, 5),
            contracts: filteredContracts,
            lastService: lastService,
            nextService: null, 
        });

    }, [selectedLocation, allData, initialLoad]);

    const handleLocationChange = (newLocationId) => {
        console.log("Selected Location Changed:", newLocationId);
        setSelectedLocation(newLocationId);
    };

    if (initialLoad) {
        return <div className="p-8">Loading pools...</div>;
    }

    if (serviceLocations.length === 0) {
        return <NoPoolsView />;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <Header 
                    locations={serviceLocations} 
                    selected={selectedLocation}
                    onSelect={handleLocationChange}
                />
                
                {loading ? (
                    <div className="text-center py-10">Loading dashboard...</div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-8">
                            <BodiesOfWaterWidget bodiesOfWater={displayData.bodiesOfWater} />
                            <EquipmentWidget equipment={displayData.equipment} />
                            <RepairRequestsWidget repairRequests={displayData.repairRequests} />
                        </div>
                        <div className="lg:col-span-1 space-y-8">
                            <ServiceRecapWidget 
                                lastService={displayData.lastService} 
                                nextService={displayData.nextService} 
                                contracts={displayData.contracts}
                                selectedLocation={selectedLocation}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const Header = ({ locations, selected, onSelect }) => (
    <div className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
        <h1 className="text-3xl font-bold text-gray-900">My Pool Dashboard</h1>
        <div className="flex items-center gap-4">
            <select
                value={selected}
                onChange={(e) => onSelect(e.target.value)}
                className="w-full md:w-auto px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
                <option value="all">All Locations</option>
                {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.address.streetAddress || loc.name}</option>
                ))}
            </select>
            <Link to="/serviceLocation/create" className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700">
                <PlusIcon className="w-5 h-5" />
                <span>Add Location</span>
            </Link>
        </div>
    </div>
);

const NoPoolsView = () => (
    <div className="flex items-center justify-center h-screen -mt-20">
        <div className="text-center">
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">No pools found.</h2>
            <p className="text-gray-500 mb-6">It looks like you haven't added a pool yet.</p>
            <Link to="/client/my-pool/new" className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">
                Add Your First Pool
            </Link>
        </div>
    </div>
);

const Widget = ({ title, icon: Icon, linkTo, addLinkTo, children }) => (
    <div className="bg-white rounded-lg shadow-md">
        <div className="flex justify-between items-center p-4 border-b">
            <div className="flex items-center gap-3">
                {Icon && <Icon className="w-6 h-6 text-gray-600" />}
                <h2 className="text-xl font-bold text-gray-800">{title}</h2>
            </div>
            <div className="flex items-center gap-4">
                {addLinkTo && (
                     <Link to={addLinkTo} className="text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        <PlusIcon className="w-4 h-4" />
                        <span>Add New</span>
                    </Link>
                )}
                {linkTo && (
                    <Link to={linkTo} className="text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        <span>View All</span>
                        <ChevronRightIcon className="w-4 h-4" />
                    </Link>
                )}
            </div>
        </div>
        <div className="p-4 space-y-3">{children}</div>
    </div>
);

const BodiesOfWaterWidget = ({ bodiesOfWater }) => (
    <Widget title="Pools & Spas" icon={BeakerIcon} linkTo="/client/pools-spas" addLinkTo="/client/pools-spas/new">
        {bodiesOfWater.length > 0 ? (
            bodiesOfWater.map(item => (
                <Link to={`/client/pools-spas/${item.id}`} key={item.id} className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg -m-2">
                    <div>
                        <p className="font-semibold text-gray-800">{item.name}</p>
                        <p className="text-sm text-gray-500">{item.shape} - {item.gallons} gal</p>
                    </div>
                    <ChevronRightIcon className="w-5 h-5 text-gray-400" />
                </Link>
            ))
        ) : (
            <p className="text-gray-500 text-center py-4">No pools or spas found for this location.</p>
        )}
    </Widget>
);

const EquipmentWidget = ({ equipment }) => (
    <Widget title="My Equipment" icon={WrenchScrewdriverIcon} linkTo="/client/equipment" addLinkTo="/client/equipment/new">
        {equipment.length > 0 ? (
            equipment.map(item => (
                <Link to={`/client/equipment/${item.id}`} key={item.id} className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg -m-2">
                    <div>
                        <p className="font-semibold text-gray-800">{item.name}</p>
                        <p className="text-sm text-gray-500">{item.make} {item.model}</p>
                    </div>
                    <ChevronRightIcon className="w-5 h-5 text-gray-400" />
                </Link>
            ))
        ) : (
            <p className="text-gray-500 text-center py-4">No equipment found for this location.</p>
        )}
    </Widget>
);

const RepairRequestsWidget = ({ repairRequests }) => (
    <Widget title="Repair Requests" icon={TruckIcon} linkTo="/client/repair-requests">
        {repairRequests.length > 0 ? (
            repairRequests.map(req => (
                <Link to={`/client/repair-requests/${req.id}`} key={req.id} className="flex justify-between items-start p-3 hover:bg-gray-50 rounded-lg -m-2">
                    <div>
                        <p className="font-semibold text-gray-800">{req.issueDescription || "No description"}</p>
                        <p className="text-sm text-gray-500">Status: <span className="font-medium text-yellow-600">{req.status || 'Pending'}</span></p>
                    </div>
                    {req.createdAt && <p className="text-sm text-gray-500 flex-shrink-0 ml-4">{format(req.createdAt.toDate(), 'MMM d, yyyy')}</p>}
                </Link>
            ))
        ) : (
            <p className="text-gray-500 text-center py-4">No open repair requests.</p>
        )}
    </Widget>
);

const ServiceRecapWidget = ({ lastService, nextService, contracts, selectedLocation }) => {
    const showBrowseCompaniesLink = selectedLocation !== 'all' && contracts.length === 0;

    return (
        <Widget title="Service Details" icon={DocumentTextIcon}>
            {showBrowseCompaniesLink ? (
                <div className="text-center py-4">
                    <p className="text-gray-500 mb-4">No service contract found for this location.</p>
                    <Link to="/client/companies" className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">
                        Browse Companies
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    <div>
                        <h3 className="font-semibold text-gray-700 mb-2">Last Service</h3>
                        {lastService ? (
                            <div className="text-sm space-y-2">
                                <p><strong>Date:</strong> {lastService.serviceDate ? format(lastService.serviceDate.toDate(), 'PPP') : 'N/A'}</p>
                                <p><strong>Tech:</strong> {lastService.techName || 'N/A'}</p>
                                <div className="pt-2">
                                    <p className="font-medium"><strong>Recap:</strong></p>
                                    <p className="text-gray-600 mt-1 pl-2 border-l-2 border-blue-500">{lastService.notes || 'No notes for this service.'}</p>
                                </div>
                            </div>
                        ) : <p className="text-sm text-gray-500">No recent service history found.</p>}
                    </div>
                    <div className="border-t pt-4">
                        <h3 className="font-semibold text-gray-700 mb-2">Next Scheduled Service</h3>
                        {nextService ? (
                             <p className="text-sm"><strong>Date:</strong> {format(nextService.serviceDate.toDate(), 'PPP')}</p>
                        ) : <p className="text-sm text-gray-500">Not yet scheduled.</p>}
                    </div>
                </div>
            )}
        </Widget>
    );
};

export default MyPool;
