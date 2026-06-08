
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { WrenchScrewdriverIcon, PlusIcon, ChevronRightIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';

const formatDate = (value) => {
    if (!value) return 'Not set';
    if (typeof value?.toDate === 'function') return value.toDate().toLocaleDateString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Not set' : parsed.toLocaleDateString();
};

const getEquipmentType = (item) => item.category || item.type || 'Equipment';

const getServiceCadence = (item) => {
    if (!item.needsService) return 'No regular service set';
    const frequency = item.serviceFrequency || '';
    const unit = item.serviceFrequencyEvery || '';
    return [frequency, unit].filter(Boolean).join(' ') || 'Regular service';
};

const EquipmentList = () => {
    const navigate = useNavigate();
    const { user } = useContext(Context);

    const [equipment, setEquipment] = useState([]);
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        setLoading(true);

        // Listener for Equipment
        const equipmentQuery = query(collection(db, 'homeownerEquipment'), where('userId', '==', user.uid));
        const unsubscribeEquipment = onSnapshot(equipmentQuery, (snapshot) => {
            const equipmentData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEquipment(equipmentData);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching equipment: ", err);
            setError("Failed to load equipment.");
            setLoading(false);
        });

        // Listener for Bodies of Water
        const bowQuery = query(collection(db, 'homeownerBodiesOfWater'), where('userId', '==', user.uid));
        const unsubscribeBows = onSnapshot(bowQuery, (snapshot) => {
            const bowData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBodiesOfWater(bowData);
        }, (err) => {
            console.error("Error fetching bodies of water: ", err);
            // Don't set a fatal error, the component can still function
        });

        return () => {
            unsubscribeEquipment();
            unsubscribeBows();
        };
    }, [user]);

    const groupedEquipment = {
        unassigned: equipment.filter(e => !e.bodyOfWaterId)
    };

    bodiesOfWater.forEach(bow => {
        groupedEquipment[bow.id] = equipment.filter(e => e.bodyOfWaterId === bow.id);
    });

    if (loading) {
        return <div className="p-8 text-center">Loading equipment...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">{error}</div>;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <Header onBack={() => navigate(-1)} onNew={() => navigate('/client/equipment/new')} />

                {equipment.length === 0 ? (
                    <NoEquipmentView onNew={() => navigate('/client/equipment/new')} />
                ) : (
                    <div className="space-y-8 mt-8">
                        {bodiesOfWater.map(bow => (
                            (groupedEquipment[bow.id]?.length > 0) &&
                            <EquipmentGroup key={bow.id} title={bow.name} equipment={groupedEquipment[bow.id]} bodyName={bow.name} />
                        ))}
                        {(groupedEquipment.unassigned.length > 0) &&
                            <EquipmentGroup title="Unassigned Equipment" equipment={groupedEquipment.unassigned} />
                        }
                    </div>
                )}
            </div>
        </div>
    );
};

const Header = ({ onBack, onNew }) => (
    <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <h1 className="text-3xl font-bold text-gray-900">My Equipment</h1>
        </div>
        <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">
            <PlusIcon className="w-5 h-5" />
            Add Equipment
        </button>
    </div>
);

const NoEquipmentView = ({ onNew }) => (
    <div className="text-center py-20">
        <WrenchScrewdriverIcon className="mx-auto h-12 w-12 text-gray-400" />
        <h2 className="mt-2 text-lg font-medium text-gray-900">No equipment added yet</h2>
        <p className="mt-1 text-sm text-gray-500">Keep track of your pool and spa equipment in one place.</p>
        <button onClick={onNew} className="mt-6 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">
            Add Your First Piece of Equipment
        </button>
    </div>
);

const EquipmentGroup = ({ title, equipment, bodyName = '' }) => (
    <div className="bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-bold text-gray-800 p-4 border-b">{title}</h2>
        <ul className="divide-y divide-gray-200">
            {equipment.map(item => <EquipmentItem key={item.id} item={item} bodyName={bodyName} />)}
        </ul>
    </div>
);

const EquipmentItem = ({ item, bodyName }) => (
    <li>
        <Link to={`/client/equipment/${item.id}`} className="block p-4 hover:bg-gray-50">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">{item.name || getEquipmentType(item)}</p>
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700">{getEquipmentType(item)}</span>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${item.isActive === false ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'}`}>
                            {item.isActive === false ? 'Inactive' : 'Active'}
                        </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                        {[item.make, item.model].filter(Boolean).join(' ') || 'Make and model not set'}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-xs text-gray-500">
                        <p><span className="font-semibold text-gray-700">Status:</span> {item.status || 'Not set'}</p>
                        <p><span className="font-semibold text-gray-700">Service:</span> {getServiceCadence(item)}</p>
                        <p><span className="font-semibold text-gray-700">Installed:</span> {formatDate(item.dateInstalled)}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                        <span className="font-semibold text-gray-700">Pool/Spa:</span> {bodyName || 'Unassigned'}
                    </p>
                    {item.notes && (
                        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{item.notes}</p>
                    )}
                </div>
                <ChevronRightIcon className="w-5 h-5 text-gray-400 mt-1 flex-shrink-0" />
            </div>
        </Link>
    </li>
);

export default EquipmentList;
