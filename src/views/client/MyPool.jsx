
import React, { useState, useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../utils/config';
import { query, collection, getDocs, where, orderBy, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import { PlusIcon, ChevronRightIcon, WrenchScrewdriverIcon, TruckIcon, DocumentTextIcon, BeakerIcon, PencilSquareIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { displayRepairRequestStatus } from '../../utils/models/RepairRequest';
import { salesCollectionNames } from '../../utils/models/Sales';

const MyPool = () => {
    const { user } = useContext(Context);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState('all');

    const [allData, setAllData] = useState({
        bodiesOfWater: [],
        equipment: [],
        repairRequests: [],
        serviceStops: [],
        serviceAgreements: [],
    });

    const [displayData, setDisplayData] = useState({
        bodiesOfWater: [],
        equipment: [],
        repairRequests: [],
        lastService: null,
        nextService: null,
        serviceAgreements: [],
    });

    const [loading, setLoading] = useState(true);
    const [initialLoad, setInitialLoad] = useState(true);
    const [locationActionError, setLocationActionError] = useState(null);
    const [savingLocation, setSavingLocation] = useState(false);
    const [editingLocation, setEditingLocation] = useState(null);
    const [locationForm, setLocationForm] = useState({
        nickName: '',
        streetAddress: '',
        city: '',
        state: '',
        zip: '',
        gateCode: '',
        notes: '',
    });

    useEffect(() => {
        if (!user || !initialLoad) return;

        const fetchAllData = async () => {
            setLoading(true);
            try {
                const locationQuery = query(collection(db, 'homeownerServiceLocations'), where('userId', '==', user.uid));
                const bowQuery = query(collection(db, 'homeownerBodiesOfWater'), where('userId', '==', user.uid));
                const equipQuery = query(collection(db, 'homeownerEquipment'), where('userId', '==', user.uid));
                const repairQuery = query(collection(db, 'homeownerRepairRequests'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
                const serviceQuery = query(collection(db, 'homeownerServiceStops'), where('userId', '==', user.uid), orderBy('serviceDate', 'desc'));
                const agreementQuery = query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', user.uid));

                const [locSnap, bowSnap, equipSnap, repairSnap, serviceSnap, agreementSnap] = await Promise.all([
                    getDocs(locationQuery),
                    getDocs(bowQuery),
                    getDocs(equipQuery),
                    getDocs(repairQuery),
                    getDocs(serviceQuery),
                    getDocs(agreementQuery)
                ]);

                setServiceLocations(locSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setAllData({
                    bodiesOfWater: bowSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    equipment: equipSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    repairRequests: repairSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    serviceStops: serviceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    serviceAgreements: agreementSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
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
        let filteredServiceAgreements = allData.serviceAgreements;
        let filteredServiceStops = allData.serviceStops;

        if (selectedLocation !== 'all') {
            filteredBodiesOfWater = allData.bodiesOfWater.filter(item => item.serviceLocationId === selectedLocation);
            filteredEquipment = allData.equipment.filter(item => item.serviceLocationId === selectedLocation);
            filteredRepairRequests = allData.repairRequests.filter(item => item.serviceLocationId === selectedLocation);
            filteredServiceAgreements = allData.serviceAgreements.filter((item) => (
                Array.isArray(item.serviceLocationIds) && item.serviceLocationIds.includes(selectedLocation)
            ));
            filteredServiceStops = allData.serviceStops.filter(item => item.serviceLocationId === selectedLocation);
        }

        const lastService = filteredServiceStops.length > 0 ? filteredServiceStops[0] : null;

        setDisplayData({
            bodiesOfWater: filteredBodiesOfWater.slice(0, 5),
            equipment: filteredEquipment.slice(0, 5),
            repairRequests: filteredRepairRequests.slice(0, 5),
            serviceAgreements: filteredServiceAgreements,
            lastService: lastService,
            nextService: null,
        });

    }, [selectedLocation, allData, initialLoad]);

    const handleLocationChange = (newLocationId) => {
        console.log("Selected Location Changed:", newLocationId);
        setSelectedLocation(newLocationId);
    };

    const selectedLocationRecord = serviceLocations.find(location => location.id === selectedLocation);

    const openEditLocation = (location) => {
        setLocationActionError(null);
        setEditingLocation(location);
        setLocationForm({
            nickName: location.nickName || '',
            streetAddress: location.address?.streetAddress || '',
            city: location.address?.city || '',
            state: location.address?.state || '',
            zip: location.address?.zip || '',
            gateCode: location.gateCode || '',
            notes: location.notes || '',
        });
    };

    const closeEditLocation = () => {
        setEditingLocation(null);
        setLocationActionError(null);
    };

    const handleLocationFormChange = (field, value) => {
        setLocationForm(prev => ({ ...prev, [field]: value }));
    };

    const handleSaveLocation = async (event) => {
        event.preventDefault();
        if (!editingLocation) return;
        if (!locationForm.streetAddress.trim()) {
            setLocationActionError('Street address is required.');
            return;
        }

        setSavingLocation(true);
        setLocationActionError(null);
        try {
            const updatedLocation = {
                nickName: locationForm.nickName.trim(),
                gateCode: locationForm.gateCode.trim(),
                notes: locationForm.notes.trim(),
                address: {
                    ...(editingLocation.address || {}),
                    streetAddress: locationForm.streetAddress.trim(),
                    city: locationForm.city.trim(),
                    state: locationForm.state.trim(),
                    zip: locationForm.zip.trim(),
                },
            };

            await updateDoc(doc(db, 'homeownerServiceLocations', editingLocation.id), updatedLocation);
            setServiceLocations(prev => prev.map(location => (
                location.id === editingLocation.id
                    ? { ...location, ...updatedLocation }
                    : location
            )));
            closeEditLocation();
        } catch (error) {
            console.error('Error updating homeowner service location:', error);
            setLocationActionError('Failed to update service location.');
        } finally {
            setSavingLocation(false);
        }
    };

    const handleDeleteLocation = async (location) => {
        const label = getLocationLabel(location);
        if (!window.confirm(`Delete ${label}? This will also remove its pools, equipment, service stops, service requests, and repair requests.`)) return;

        setSavingLocation(true);
        setLocationActionError(null);
        try {
            const relatedQueries = [
                query(collection(db, 'homeownerBodiesOfWater'), where('serviceLocationId', '==', location.id), where('userId', '==', user.uid)),
                query(collection(db, 'homeownerEquipment'), where('serviceLocationId', '==', location.id), where('userId', '==', user.uid)),
                query(collection(db, 'homeownerServiceStops'), where('serviceLocationId', '==', location.id), where('userId', '==', user.uid)),
                query(collection(db, 'homeownerRepairRequests'), where('locationId', '==', location.id), where('userId', '==', user.uid)),
                query(collection(db, 'homeownerServiceRequests'), where('homeownerServiceLocationId', '==', location.id), where('homeownerId', '==', user.uid)),
            ];

            const snapshots = await Promise.all(relatedQueries.map(getDocs));
            const batch = writeBatch(db);
            snapshots.forEach(snapshot => {
                snapshot.docs.forEach(relatedDoc => batch.delete(relatedDoc.ref));
            });
            batch.delete(doc(db, 'homeownerServiceLocations', location.id));
            await batch.commit();

            setServiceLocations(prev => prev.filter(item => item.id !== location.id));
            setAllData(prev => ({
                ...prev,
                bodiesOfWater: prev.bodiesOfWater.filter(item => item.serviceLocationId !== location.id),
                equipment: prev.equipment.filter(item => item.serviceLocationId !== location.id),
                serviceStops: prev.serviceStops.filter(item => item.serviceLocationId !== location.id),
                repairRequests: prev.repairRequests.filter(item => item.locationId !== location.id),
            }));
            setSelectedLocation('all');
            closeEditLocation();
        } catch (error) {
            console.error('Error deleting homeowner service location:', error);
            setLocationActionError('Failed to delete service location.');
        } finally {
            setSavingLocation(false);
        }
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
                <ServiceLocationManager
                    locations={serviceLocations}
                    selectedLocation={selectedLocation}
                    selectedLocationRecord={selectedLocationRecord}
                    onEdit={openEditLocation}
                    onDelete={handleDeleteLocation}
                    disabled={savingLocation}
                    error={locationActionError}
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
                                serviceAgreements={displayData.serviceAgreements}
                                selectedLocation={selectedLocation}
                            />
                        </div>
                    </div>
                )}
            </div>
            {editingLocation && (
                <EditServiceLocationModal
                    form={locationForm}
                    saving={savingLocation}
                    error={locationActionError}
                    onChange={handleLocationFormChange}
                    onClose={closeEditLocation}
                    onSubmit={handleSaveLocation}
                />
            )}
        </div>
    );
};

const getLocationLabel = (location) => (
    location?.nickName ||
    location?.address?.streetAddress ||
    location?.name ||
    'Service Location'
);

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
                    <option key={loc.id} value={loc.id}>{getLocationLabel(loc)}</option>
                ))}
            </select>
            <Link to="/serviceLocation/create" className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700">
                <PlusIcon className="w-5 h-5" />
                <span>Add Location</span>
            </Link>
        </div>
    </div>
);

const ServiceLocationManager = ({ locations, selectedLocation, selectedLocationRecord, onEdit, onDelete, disabled, error }) => {
    const locationsToShow = selectedLocationRecord ? [selectedLocationRecord] : locations;

    return (
        <div className="bg-white rounded-lg shadow-md mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border-b">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">Service Locations</h2>
                    <p className="text-sm text-gray-500">Manage address, access notes, and saved service location details.</p>
                </div>
            </div>
            {error && <p className="mx-4 mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            <div className="divide-y divide-gray-100">
                {locationsToShow.map(location => (
                    <div key={location.id} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <p className="font-semibold text-gray-900">{getLocationLabel(location)}</p>
                            <p className="text-sm text-gray-600">
                                {[location.address?.streetAddress, location.address?.city, location.address?.state, location.address?.zip].filter(Boolean).join(', ') || 'No address saved'}
                            </p>
                            {(location.gateCode || location.notes) && (
                                <p className="text-xs text-gray-500 mt-1">
                                    {location.gateCode ? `Gate: ${location.gateCode}` : ''}
                                    {location.gateCode && location.notes ? ' · ' : ''}
                                    {location.notes || ''}
                                </p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => onEdit(location)} disabled={disabled} className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                                <PencilSquareIcon className="w-4 h-4" />
                                Edit
                            </button>
                            <button type="button" onClick={() => onDelete(location)} disabled={disabled} className="inline-flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">
                                <TrashIcon className="w-4 h-4" />
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const EditServiceLocationModal = ({ form, saving, error, onChange, onClose, onSubmit }) => {
    const formInputClasses = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
            <form onSubmit={onSubmit} className="w-full max-w-2xl bg-white rounded-lg shadow-xl">
                <div className="flex items-center justify-between p-5 border-b">
                    <h2 className="text-xl font-bold text-gray-900">Edit Service Location</h2>
                    <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    <input type="text" placeholder="Location nickname" value={form.nickName} onChange={(e) => onChange('nickName', e.target.value)} className={formInputClasses} />
                    <input type="text" placeholder="Street address" value={form.streetAddress} onChange={(e) => onChange('streetAddress', e.target.value)} className={formInputClasses} />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input type="text" placeholder="City" value={form.city} onChange={(e) => onChange('city', e.target.value)} className={formInputClasses} />
                        <input type="text" placeholder="State" value={form.state} onChange={(e) => onChange('state', e.target.value)} className={formInputClasses} />
                        <input type="text" placeholder="Zip" value={form.zip} onChange={(e) => onChange('zip', e.target.value)} className={formInputClasses} />
                    </div>
                    <input type="text" placeholder="Gate code" value={form.gateCode} onChange={(e) => onChange('gateCode', e.target.value)} className={formInputClasses} />
                    <textarea placeholder="Location notes" value={form.notes} onChange={(e) => onChange('notes', e.target.value)} className={`${formInputClasses} h-24`} />
                    {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
                </div>
                <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
                    <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white">
                        Cancel
                    </button>
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
                        {saving ? 'Saving...' : 'Save Location'}
                    </button>
                </div>
            </form>
        </div>
    );
};

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
    <Widget title="Pools & Spas" icon={BeakerIcon} addLinkTo="/client/pools-spas/new">
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
                        <p className="text-sm text-gray-500">Status: <span className="font-medium text-yellow-600">{displayRepairRequestStatus(req.status)}</span></p>
                    </div>
                    {req.createdAt && <p className="text-sm text-gray-500 flex-shrink-0 ml-4">{format(req.createdAt.toDate(), 'MMM d, yyyy')}</p>}
                </Link>
            ))
        ) : (
            <p className="text-gray-500 text-center py-4">No open repair requests.</p>
        )}
    </Widget>
);

const ServiceRecapWidget = ({ lastService, nextService, serviceAgreements, selectedLocation }) => {
    const showBrowseCompaniesLink = selectedLocation !== 'all' && serviceAgreements.length === 0;

    return (
        <Widget title="Service Details" icon={DocumentTextIcon}>
            {showBrowseCompaniesLink ? (
                <div className="text-center py-4">
                    <p className="text-gray-500 mb-4">No service agreement found for this location.</p>
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
