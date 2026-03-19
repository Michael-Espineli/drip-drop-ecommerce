
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import {
    ArrowLeftIcon, BeakerIcon, WrenchScrewdriverIcon, DocumentTextIcon,
    ChevronRightIcon, TruckIcon, PencilIcon, XMarkIcon, CheckIcon
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const BodyOfWaterDetailView = () => {
    const { bodyOfWaterId } = useParams();
    const { user } = useContext(Context);
    const navigate = useNavigate();
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const [bodyOfWater, setBodyOfWater] = useState(null);
    const [equipment, setEquipment] = useState([]);
    const [serviceStops, setServiceStops] = useState([]);
    const [recentReadings, setRecentReadings] = useState([]);
    const [recentDosages, setRecentDosages] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);

    const [isEditing, setIsEditing] = useState(false);
    const [editableBodyOfWater, setEditableBodyOfWater] = useState(null);

    useEffect(() => {
        if (!user || !bodyOfWaterId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const bowDocRef = doc(db, 'homeOwnerBodiesOfWater', bodyOfWaterId);
                const bowDocSnap = await getDoc(bowDocRef);

                if (!bowDocSnap.exists() || bowDocSnap.data().userId !== user.uid) {
                    setError('Body of water not found or you do not have permission to view it.');
                    setLoading(false);
                    return;
                }
                const data = { id: bowDocSnap.id, ...bowDocSnap.data() };
                setBodyOfWater(data);
                setEditableBodyOfWater(data);

                // Fetch related data in parallel
                const equipQuery = query(collection(db, 'homeOwnerEquipment'), where('bodyOfWaterId', '==', bodyOfWaterId), where('userId', '==', user.uid));
                const serviceStopsQuery = query(collection(db, 'homeOwnerServiceStops'), where('bodyOfWaterId', '==', bodyOfWaterId), where('userId', '==', user.uid), orderBy('serviceDate', 'desc'), limit(5));
                const stopDataQuery = query(collection(db, 'stopData'), where('bodyOfWaterId', '==', bodyOfWaterId), where('userId', '==', user.uid), orderBy('date', 'desc'), limit(5));
                const repairQuery = query(collection(db, 'homeOwnerRepairRequests'), where('bodyOfWaterId', '==', bodyOfWaterId), where('userId', '==', user.uid), where('status', 'not-in', ['Completed', 'Cancelled']));

                const [equipSnap, serviceStopsSnap, stopDataSnap, repairSnap] = await Promise.all([
                    getDocs(equipQuery),
                    getDocs(serviceStopsQuery),
                    getDocs(stopDataQuery),
                    getDocs(repairQuery)
                ]);

                setEquipment(equipSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setServiceStops(serviceStopsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setRepairRequests(repairSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                
                const processedStopData = stopDataSnap.docs.map(doc => {
                    const data = doc.data();
                    return { ...data, date: data.date?.toDate ? data.date.toDate() : new Date() };
                });

                const readings = processedStopData.flatMap(sd => (sd.readings || []).map(r => ({ ...r, date: sd.date })));
                const dosages = processedStopData.flatMap(sd => (sd.dosages || []).map(d => ({ ...d, date: sd.date })));

                setRecentReadings(readings);
                setRecentDosages(dosages);

            } catch (err) {
                console.error("Error fetching data:", err);
                setError('Failed to load pool data.');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [bodyOfWaterId, user, navigate]);

    const handleFieldChange = (field, value) => {
        setEditableBodyOfWater(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const bowDocRef = doc(db, 'homeOwnerBodiesOfWater', bodyOfWaterId);
            await updateDoc(bowDocRef, {
                name: editableBodyOfWater.name,
                shape: editableBodyOfWater.shape,
                material: editableBodyOfWater.material,
                gallons: editableBodyOfWater.gallons,
                notes: editableBodyOfWater.notes,
            });
            setBodyOfWater(editableBodyOfWater); // Update view state
            setIsEditing(false);
        } catch (err) {
            console.error("Error updating document: ", err);
            setError("Failed to save changes. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setEditableBodyOfWater(bodyOfWater); // Revert changes
        setIsEditing(false);
    };

    if (loading) return <div className="p-8 text-center">Loading pool details...</div>;
    if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
    if (!bodyOfWater) return null;

    const isOwner = user?.uid === bodyOfWater.userId;

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <Header 
                    name={bodyOfWater.name} 
                    onBack={() => navigate(-1)} 
                    isOwner={isOwner}
                    isEditing={isEditing}
                    onEdit={() => setIsEditing(true)}
                    onSave={handleSave}
                    onCancel={handleCancel}
                    isSaving={isSaving}
                />
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
                    <div className="lg:col-span-2 space-y-8">
                        <OutstandingRepairsWidget repairRequests={repairRequests} />
                        <RecentServiceHistory serviceStops={serviceStops} />
                        <RecentReadings readings={recentReadings} />
                        <RecentDosages dosages={recentDosages} />
                    </div>
                    <div className="lg:col-span-1 space-y-8">
                        {isEditing ? (
                            <EditablePoolInfo bodyOfWater={editableBodyOfWater} onChange={handleFieldChange} />
                        ) : (
                            <PoolInfo bodyOfWater={bodyOfWater} />
                        )}
                        <EquipmentList equipment={equipment} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const Header = ({ name, onBack, isOwner, isEditing, onEdit, onSave, onCancel, isSaving }) => (
    <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
        </div>
        {isOwner && (
            <div className="flex items-center gap-2">
                {isEditing ? (
                    <>
                        <button onClick={onCancel} disabled={isSaving} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full"><XMarkIcon className="w-6 h-6" /></button>
                        <button onClick={onSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 disabled:bg-gray-400">
                            <CheckIcon className="w-5 h-5" />
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </>
                ) : (
                    <button onClick={onEdit} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">
                        <PencilIcon className="w-5 h-5" />
                        Edit
                    </button>
                )}
            </div>
        )}
    </div>
);

const Widget = ({ title, icon: Icon, children }) => (
    <div className="bg-white rounded-lg shadow-md">
        <div className="flex items-center gap-3 p-4 border-b">
            {Icon && <Icon className="w-6 h-6 text-gray-600" />}
            <h2 className="text-xl font-bold text-gray-800">{title}</h2>
        </div>
        <div className="p-4">{children}</div>
    </div>
);

const PoolInfo = ({ bodyOfWater }) => (
    <Widget title="Pool Details" icon={BeakerIcon}>
        <div className="space-y-2 text-sm text-gray-700">
            <p><strong>Shape:</strong> {bodyOfWater.shape || 'N/A'}</p>
            <p><strong>Material:</strong> {bodyOfWater.material || 'N/A'}</p>
            <p><strong>Volume:</strong> {bodyOfWater.gallons ? `${bodyOfWater.gallons} gallons` : 'N/A'}</p>
            {bodyOfWater.notes && <p className="pt-2"><strong>Notes:</strong><br/>{bodyOfWater.notes}</p>}
        </div>
    </Widget>
);

const EditablePoolInfo = ({ bodyOfWater, onChange }) => {
    const inputClasses = "w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
    return (
        <Widget title="Edit Pool Details" icon={PencilIcon}>
            <div className="space-y-4">
                <input type="text" placeholder="Pool Name" value={bodyOfWater.name} onChange={(e) => onChange('name', e.target.value)} className={inputClasses} />
                <input type="text" placeholder="Shape (e.g., Kidney)" value={bodyOfWater.shape} onChange={(e) => onChange('shape', e.target.value)} className={inputClasses} />
                <input type="text" placeholder="Material (e.g., Plaster)" value={bodyOfWater.material} onChange={(e) => onChange('material', e.target.value)} className={inputClasses} />
                <input type="number" placeholder="Volume in Gallons" value={bodyOfWater.gallons} onChange={(e) => onChange('gallons', e.target.value)} className={inputClasses} />
                <textarea placeholder="Notes" value={bodyOfWater.notes} onChange={(e) => onChange('notes', e.target.value)} className={`${inputClasses} h-24`}></textarea>
            </div>
        </Widget>
    );
}

const EquipmentList = ({ equipment }) => (
    <Widget title="Equipment" icon={WrenchScrewdriverIcon}>
        {equipment.length > 0 ? (
            <ul className="space-y-1">
                {equipment.map(item => (
                    <li key={item.id}>
                        <Link to={`/equipment/${item.id}`} className="flex justify-between items-center text-sm p-2 hover:bg-gray-50 rounded-md -m-2">
                            <div>
                                <p className="font-semibold text-gray-800">{item.name}</p>
                                <p className="text-gray-500">{item.make} {item.model}</p>
                            </div>
                            <ChevronRightIcon className="w-5 h-5 text-gray-400" />
                        </Link>
                    </li>
                ))}
            </ul>
        ) : <p className="text-sm text-gray-500 text-center py-2">No equipment listed.</p>}
    </Widget>
);

const OutstandingRepairsWidget = ({ repairRequests }) => {
    if (repairRequests.length === 0) return null;
    return (
        <Widget title="Outstanding Repairs" icon={TruckIcon}>
            <div className="space-y-3">
                {repairRequests.map(req => (
                    <Link to={`/client/repair-requests/${req.id}`} key={req.id} className="block p-3 hover:bg-gray-50 rounded-lg -m-2">
                        <div className="flex justify-between items-start text-sm">
                            <div>
                                <p className="font-semibold text-gray-800">{req.issueDescription || "No description"}</p>
                                <p className="text-gray-500">Status: <span className="font-medium text-yellow-600">{req.status || 'Pending'}</span></p>
                            </div>
                            <p className="text-gray-500 flex-shrink-0 ml-4">{req.createdAt ? format(req.createdAt.toDate(), 'MMM d, yyyy') : ''}</p>
                        </div>
                    </Link>
                ))}
            </div>
        </Widget>
    );
};

const RecentServiceHistory = ({ serviceStops }) => (
    <Widget title="Recent Service History" icon={DocumentTextIcon}>
        {serviceStops.length > 0 ? (
            <ul className="divide-y divide-gray-200 -m-4">
                {serviceStops.map(stop => (
                    <li key={stop.id}>
                        <Link to={`/serviceStop/detail/${stop.id}`} className="block p-4 hover:bg-gray-50">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-gray-800">{stop.companyName} - {stop.type}</p>
                                    <p className="text-sm text-gray-600">Tech: {stop.techName}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-medium text-gray-800">{stop.serviceDate ? format(stop.serviceDate.toDate(), 'PPP') : 'N/A'}</p>
                                    <ChevronRightIcon className="w-5 h-5 text-gray-400 mt-1 ml-auto" />
                                </div>
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
        ) : <p className="text-sm text-gray-500">No service history found for this pool.</p>}
    </Widget>
);

const RecentReadings = ({ readings }) => (
    <Widget title="Recent Water Readings">
        {readings.length > 0 ? (
            <div className="overflow-x-auto">
                 <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 text-left">
                        <tr>
                            <th className="p-2">Date</th>
                            <th className="p-2">Reading</th>
                            <th className="p-2">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {readings.map((r, i) => (
                            <tr key={i} className="border-b">
                                <td className="p-2">{r.date ? format(r.date, 'MMM d') : 'N/A'}</td>
                                <td className="p-2 font-medium">{r.name}</td>
                                <td className="p-2">{r.amount} {r.UOM}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        ) : <p className="text-sm text-gray-500">No recent readings.</p>}
    </Widget>
);

const RecentDosages = ({ dosages }) => (
    <Widget title="Recent Chemical Dosages">
        {dosages.length > 0 ? (
            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 text-left">
                        <tr>
                            <th className="p-2">Date</th>
                            <th className="p-2">Chemical</th>
                            <th className="p-2">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dosages.map((d, i) => (
                            <tr key={i} className="border-b">
                                <td className="p-2">{d.date ? format(d.date, 'MMM d') : 'N/A'}</td>
                                <td className="p-2 font-medium">{d.name}</td>
                                <td className="p-2">{d.amount} {d.UOM}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        ) : <p className="text-sm text-gray-500">No recent dosages.</p>}
    </Widget>
);

export default BodyOfWaterDetailView;
