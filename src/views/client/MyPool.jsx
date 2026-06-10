
import React, { useState, useContext, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../utils/config';
import { query, collection, getDocs, where, orderBy, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import {
    PlusIcon,
    ChevronRightIcon,
    WrenchScrewdriverIcon,
    TruckIcon,
    DocumentTextIcon,
    BeakerIcon,
    PencilSquareIcon,
    TrashIcon,
    XMarkIcon,
    CalendarDaysIcon,
    CheckCircleIcon,
    ClipboardDocumentListIcon,
    UserIcon,
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { displayRepairRequestStatus } from '../../utils/models/RepairRequest';
import { salesCollectionNames } from '../../utils/models/Sales';

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'number') return new Date(value);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateMillis = (value) => toDate(value)?.getTime() || 0;

const formatDate = (value, fallback = 'Not recorded') => {
    const date = toDate(value);
    return date ? format(date, 'MMM d, yyyy') : fallback;
};

const getStopDateValue = (stop = {}) => (
    stop.serviceDate ||
    stop.date ||
    stop.finishedAt ||
    stop.completedAt ||
    stop.createdAt
);

const getStopDataDateValue = (record = {}) => (
    record.date ||
    record.serviceDate ||
    record.finishedAt ||
    record.createdAt
);

const sortByDateDesc = (records, dateGetter) => (
    [...records].sort((left, right) => dateMillis(dateGetter(right)) - dateMillis(dateGetter(left)))
);

const compact = (items) => items.filter((item) => item !== undefined && item !== null && item !== '');

const labelize = (value, fallback = 'Not recorded') => {
    if (!value) return fallback;
    return String(value)
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatStopDataItem = (item = {}, fallbackLabel = 'Item') => {
    const label = item.name || item.label || item.readingName || item.dosageName || fallbackLabel;
    const amount = item.amount ?? item.value ?? item.quantity ?? '';
    const unit = item.UOM || item.uom || item.unit || item.units || '';
    return compact([label, compact([amount, unit]).join(' ')]).join(': ');
};

const firstText = (...values) => compact(values.map((value) => String(value || '').trim()))[0] || '';

const MyPool = () => {
    const { user } = useContext(Context);
    const [serviceLocations, setServiceLocations] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState('all');

    const [allData, setAllData] = useState({
        bodiesOfWater: [],
        equipment: [],
        repairRequests: [],
        serviceStops: [],
        stopData: [],
        serviceAgreements: [],
    });

    const [displayData, setDisplayData] = useState({
        bodiesOfWater: [],
        equipment: [],
        repairRequests: [],
        serviceStops: [],
        stopData: [],
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
                const stopDataQuery = query(collection(db, 'stopData'), where('userId', '==', user.uid));
                const agreementQuery = query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', user.uid));

                const [locSnap, bowSnap, equipSnap, repairSnap, serviceSnap, stopDataSnap, agreementSnap] = await Promise.all([
                    getDocs(locationQuery),
                    getDocs(bowQuery),
                    getDocs(equipQuery),
                    getDocs(repairQuery),
                    getDocs(serviceQuery),
                    getDocs(stopDataQuery),
                    getDocs(agreementQuery)
                ]);

                setServiceLocations(locSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setAllData({
                    bodiesOfWater: bowSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    equipment: equipSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    repairRequests: repairSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    serviceStops: sortByDateDesc(
                        serviceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                        getStopDateValue
                    ),
                    stopData: sortByDateDesc(
                        stopDataSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                        getStopDataDateValue
                    ),
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
        let filteredStopData = allData.stopData;

        if (selectedLocation !== 'all') {
            filteredBodiesOfWater = allData.bodiesOfWater.filter(item => item.serviceLocationId === selectedLocation);
            filteredEquipment = allData.equipment.filter(item => item.serviceLocationId === selectedLocation);
            filteredRepairRequests = allData.repairRequests.filter(item => item.serviceLocationId === selectedLocation);
            filteredServiceAgreements = allData.serviceAgreements.filter((item) => (
                Array.isArray(item.serviceLocationIds) && item.serviceLocationIds.includes(selectedLocation)
            ));
            filteredServiceStops = allData.serviceStops.filter(item => item.serviceLocationId === selectedLocation);
            const filteredBodyIds = new Set(filteredBodiesOfWater.map(item => item.id));
            const filteredServiceStopIds = new Set(filteredServiceStops.map(item => item.id));
            filteredStopData = allData.stopData.filter(item => (
                item.serviceLocationId === selectedLocation ||
                filteredBodyIds.has(item.bodyOfWaterId) ||
                filteredServiceStopIds.has(item.serviceStopId)
            ));
        }

        const lastService = filteredServiceStops.length > 0 ? filteredServiceStops[0] : null;

        setDisplayData({
            bodiesOfWater: filteredBodiesOfWater.slice(0, 5),
            equipment: filteredEquipment.slice(0, 5),
            repairRequests: filteredRepairRequests.slice(0, 5),
            serviceAgreements: filteredServiceAgreements,
            serviceStops: filteredServiceStops,
            stopData: filteredStopData,
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
                query(collection(db, 'stopData'), where('serviceLocationId', '==', location.id), where('userId', '==', user.uid)),
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
                stopData: prev.stopData.filter(item => item.serviceLocationId !== location.id),
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
                    {!loading && (
                        <div className="mt-8">
                            <ServiceHistoryWidget
                                serviceStops={displayData.serviceStops}
                                stopDataRecords={displayData.stopData}
                                bodiesOfWater={allData.bodiesOfWater}
                                serviceLocations={serviceLocations}
                            />
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

const arrayValue = (value) => (Array.isArray(value) ? value : []);

const observationText = (item) => {
    if (item === undefined || item === null) return '';
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return firstText(item.name, item.label, item.value, item.notes, item.description, 'Observation');
};

const observationValues = (record = {}) => {
    if (Array.isArray(record.observation)) return record.observation.map(observationText).filter(Boolean);
    if (Array.isArray(record.observations)) return record.observations.map(observationText).filter(Boolean);
    if (typeof record.observation === 'string') return record.observation.split('\n').map(item => item.trim()).filter(Boolean);
    if (typeof record.observations === 'string') return record.observations.split('\n').map(item => item.trim()).filter(Boolean);
    return [];
};

const normalizedStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const statusBadgeClasses = (status) => {
    const normalized = normalizedStatus(status);
    if (['finished', 'complete', 'completed', 'done'].includes(normalized)) {
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    }
    if (['scheduled', 'pending', 'notstarted'].includes(normalized)) {
        return 'bg-amber-50 text-amber-700 border-amber-100';
    }
    if (['canceled', 'cancelled', 'void'].includes(normalized)) {
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
    return 'bg-blue-50 text-blue-700 border-blue-100';
};

const stopMatchKeys = (stop = {}) => compact([
    stop.id,
    stop.serviceStopId,
    stop.linkedCompanyServiceStopId,
    stop.sourceCompanyServiceStopId,
]);

const stopDataMatchKeys = (record = {}) => compact([
    record.serviceStopId,
    record.linkedCompanyServiceStopId,
    record.sourceCompanyServiceStopId,
]);

const taskIsComplete = (task = {}) => {
    const status = normalizedStatus(task.status || task.operationStatus || task.completedStatus);
    return ['finished', 'complete', 'completed', 'done'].includes(status) || task.completed === true || task.isComplete === true;
};

const ServiceHistoryWidget = ({ serviceStops, stopDataRecords, bodiesOfWater, serviceLocations }) => {
    const [showAllHistory, setShowAllHistory] = useState(false);

    const bodyNameById = useMemo(() => new Map(
        bodiesOfWater.map(body => [body.id, body.name || body.type || 'Body of water'])
    ), [bodiesOfWater]);

    const locationNameById = useMemo(() => new Map(
        serviceLocations.map(location => [location.id, getLocationLabel(location)])
    ), [serviceLocations]);

    const stopDataByStopKey = useMemo(() => {
        const recordsByKey = new Map();
        stopDataRecords.forEach(record => {
            stopDataMatchKeys(record).forEach(key => {
                const existing = recordsByKey.get(key) || [];
                existing.push(record);
                recordsByKey.set(key, existing);
            });
        });
        return recordsByKey;
    }, [stopDataRecords]);

    const stats = useMemo(() => {
        const readingsCount = stopDataRecords.reduce((total, record) => total + arrayValue(record.readings).length, 0);
        const dosagesCount = stopDataRecords.reduce((total, record) => total + arrayValue(record.dosages).length, 0);
        const completedCount = serviceStops.filter(stop => (
            ['finished', 'complete', 'completed', 'done'].includes(normalizedStatus(stop.operationStatus || stop.status))
        )).length;
        const latestStop = serviceStops[0];

        return {
            totalStops: serviceStops.length,
            completedCount,
            readingsCount,
            dosagesCount,
            latestLabel: latestStop ? formatDate(getStopDateValue(latestStop)) : 'None',
        };
    }, [serviceStops, stopDataRecords]);

    const visibleStops = showAllHistory ? serviceStops : serviceStops.slice(0, 6);
    const hiddenCount = Math.max(serviceStops.length - visibleStops.length, 0);

    const getStopDataRecords = (stop) => {
        const seen = new Set();
        return stopMatchKeys(stop).flatMap(key => stopDataByStopKey.get(key) || []).filter(record => {
            const recordKey = record.id || `${record.serviceStopId}-${getStopDataDateValue(record)}`;
            if (seen.has(recordKey)) return false;
            seen.add(recordKey);
            return true;
        });
    };

    return (
        <section className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <ClipboardDocumentListIcon className="h-6 w-6 text-gray-600" />
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Service History</h2>
                        <p className="text-sm text-gray-500">Completed stops, technician notes, readings, dosages, and tasks.</p>
                    </div>
                </div>
                <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    {stats.totalStops} stop{stats.totalStops === 1 ? '' : 's'}
                </span>
            </div>

            <div className="grid gap-3 border-b border-gray-100 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <HistoryStat icon={CalendarDaysIcon} label="Latest Stop" value={stats.latestLabel} />
                <HistoryStat icon={CheckCircleIcon} label="Completed" value={stats.completedCount} />
                <HistoryStat icon={BeakerIcon} label="Readings" value={stats.readingsCount} />
                <HistoryStat icon={DocumentTextIcon} label="Dosages" value={stats.dosagesCount} />
            </div>

            {serviceStops.length > 0 ? (
                <>
                    <div className="divide-y divide-gray-100">
                        {visibleStops.map(stop => (
                            <ServiceHistoryRow
                                key={stop.id}
                                stop={stop}
                                stopDataRecords={getStopDataRecords(stop)}
                                bodyName={bodyNameById.get(stop.bodyOfWaterId)}
                                locationName={locationNameById.get(stop.serviceLocationId)}
                            />
                        ))}
                    </div>
                    {hiddenCount > 0 && (
                        <div className="border-t border-gray-100 bg-gray-50 p-4 text-center">
                            <button
                                type="button"
                                onClick={() => setShowAllHistory(true)}
                                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Show {hiddenCount} more stop{hiddenCount === 1 ? '' : 's'}
                            </button>
                        </div>
                    )}
                    {showAllHistory && serviceStops.length > 6 && (
                        <div className="border-t border-gray-100 bg-gray-50 p-4 text-center">
                            <button
                                type="button"
                                onClick={() => setShowAllHistory(false)}
                                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Show Recent Stops
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="p-8 text-center">
                    <ClipboardDocumentListIcon className="mx-auto h-10 w-10 text-gray-300" />
                    <p className="mt-3 font-semibold text-gray-800">No service history yet.</p>
                    <p className="mt-1 text-sm text-gray-500">Completed service stops from connected companies will appear here.</p>
                </div>
            )}
        </section>
    );
};

const HistoryStat = ({ icon: Icon, label, value }) => (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            <Icon className="h-4 w-4" />
            {label}
        </div>
        <p className="mt-2 text-lg font-bold text-gray-900">{value}</p>
    </div>
);

const ServiceHistoryRow = ({ stop, stopDataRecords, bodyName, locationName }) => {
    const readings = [
        ...arrayValue(stop.readings),
        ...stopDataRecords.flatMap(record => arrayValue(record.readings)),
    ];
    const dosages = [
        ...arrayValue(stop.dosages),
        ...stopDataRecords.flatMap(record => arrayValue(record.dosages)),
    ];
    const observations = [
        ...observationValues(stop),
        ...stopDataRecords.flatMap(observationValues),
    ];
    const tasks = arrayValue(stop.tasks);
    const completedTaskCount = tasks.filter(taskIsComplete).length;
    const status = stop.operationStatus || stop.status || 'Completed';
    const stopTitle = firstText(stop.type, stop.serviceType, stop.jobName, stop.description, 'Service stop');
    const techName = firstText(stop.techName, stop.tech, stop.technicianName, 'Technician not recorded');
    const companyName = firstText(stop.companyName, stop.linkedCompanyName, 'Pool service company');
    const locationLabel = firstText(locationName, stop.serviceLocationName, stop.address?.streetAddress, 'Service location');
    const bodyLabel = firstText(bodyName, stop.bodyOfWaterName, stop.poolName, stop.spaName, '');
    const notes = firstText(stop.notes, stop.serviceNotes, stop.description, '');
    const photoCount = arrayValue(stop.photoUrls).length;

    return (
        <article className="p-4 md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                            <CalendarDaysIcon className="h-4 w-4" />
                            {formatDate(getStopDateValue(stop))}
                        </span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses(status)}`}>
                            {labelize(status, 'Completed')}
                        </span>
                    </div>
                    <h3 className="mt-3 break-words text-lg font-bold text-gray-900">{stopTitle}</h3>
                    <p className="mt-1 text-sm text-gray-500">{companyName}</p>
                </div>
                <Link
                    to={`/serviceStop/detail/${stop.id}`}
                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    <span>View Details</span>
                    <ChevronRightIcon className="h-4 w-4" />
                </Link>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
                <HistoryField label="Technician" value={techName} icon={UserIcon} />
                <HistoryField label="Location" value={locationLabel} icon={DocumentTextIcon} />
                <HistoryField label="Body of Water" value={bodyLabel || 'Not specified'} icon={BeakerIcon} />
            </div>

            {notes && (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Service Notes</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{notes}</p>
                </div>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <StopDataPreview readings={readings} dosages={dosages} observations={observations} />
                <TaskPreview tasks={tasks} completedTaskCount={completedTaskCount} photoCount={photoCount} />
            </div>
        </article>
    );
};

const HistoryField = ({ label, value, icon: Icon }) => (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            <Icon className="h-4 w-4" />
            {label}
        </div>
        <p className="mt-1 break-words text-sm font-semibold text-gray-800">{value}</p>
    </div>
);

const StopDataPreview = ({ readings, dosages, observations }) => {
    const visibleReadings = readings.slice(0, 4);
    const visibleDosages = dosages.slice(0, 4);
    const visibleObservations = observations.slice(0, 2);
    const hasStopData = readings.length > 0 || dosages.length > 0 || observations.length > 0;

    return (
        <div className="rounded-lg border border-cyan-100 bg-cyan-50/50 p-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-gray-800">Stop Data</p>
                <span className="text-xs font-semibold text-cyan-700">
                    {readings.length} readings / {dosages.length} dosages
                </span>
            </div>

            {hasStopData ? (
                <div className="mt-3 space-y-3">
                    {visibleReadings.length > 0 && (
                        <DataGroup
                            label="Readings"
                            items={visibleReadings.map(item => formatStopDataItem(item, 'Reading'))}
                            hiddenCount={Math.max(readings.length - visibleReadings.length, 0)}
                        />
                    )}
                    {visibleDosages.length > 0 && (
                        <DataGroup
                            label="Dosages"
                            items={visibleDosages.map(item => formatStopDataItem(item, 'Dosage'))}
                            hiddenCount={Math.max(dosages.length - visibleDosages.length, 0)}
                        />
                    )}
                    {visibleObservations.length > 0 && (
                        <DataGroup
                            label="Observations"
                            items={visibleObservations}
                            hiddenCount={Math.max(observations.length - visibleObservations.length, 0)}
                        />
                    )}
                </div>
            ) : (
                <p className="mt-3 text-sm text-gray-500">No readings, dosages, or observations saved for this stop.</p>
            )}
        </div>
    );
};

const DataGroup = ({ label, items, hiddenCount }) => (
    <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</p>
        <div className="mt-2 flex flex-wrap gap-2">
            {items.map((item, index) => (
                <span key={`${label}-${index}-${item}`} className="rounded-full border border-white bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 shadow-sm">
                    {item}
                </span>
            ))}
            {hiddenCount > 0 && (
                <span className="rounded-full border border-cyan-200 bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                    +{hiddenCount} more
                </span>
            )}
        </div>
    </div>
);

const TaskPreview = ({ tasks, completedTaskCount, photoCount }) => {
    const visibleTasks = tasks.slice(0, 4);
    const hiddenTaskCount = Math.max(tasks.length - visibleTasks.length, 0);

    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-gray-800">Work Completed</p>
                <span className="text-xs font-semibold text-gray-600">
                    {completedTaskCount}/{tasks.length} tasks
                </span>
            </div>

            {visibleTasks.length > 0 ? (
                <ul className="mt-3 space-y-2">
                    {visibleTasks.map((task, index) => (
                        <li key={task.id || `${task.name}-${index}`} className="flex items-start gap-2 text-sm text-gray-700">
                            <CheckCircleIcon className={`mt-0.5 h-4 w-4 shrink-0 ${taskIsComplete(task) ? 'text-emerald-600' : 'text-gray-300'}`} />
                            <span className="break-words">{firstText(task.name, task.title, task.description, 'Task')}</span>
                        </li>
                    ))}
                    {hiddenTaskCount > 0 && (
                        <li className="text-xs font-semibold text-gray-500">+{hiddenTaskCount} more task{hiddenTaskCount === 1 ? '' : 's'}</li>
                    )}
                </ul>
            ) : (
                <p className="mt-3 text-sm text-gray-500">No task checklist saved for this stop.</p>
            )}

            {photoCount > 0 && (
                <p className="mt-3 text-xs font-semibold text-gray-500">
                    {photoCount} photo{photoCount === 1 ? '' : 's'} attached
                </p>
            )}
        </div>
    );
};

export default MyPool;
