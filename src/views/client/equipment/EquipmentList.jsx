
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from '../../../context/AuthContext';
import { WrenchScrewdriverIcon, PlusIcon, ChevronRightIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';

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
        const equipmentQuery = query(collection(db, 'homeOwnerEquipment'), where('userId', '==', user.uid));
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
        const bowQuery = query(collection(db, 'homeOwnerBodiesOfWater'), where('userId', '==', user.uid));
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
                            <EquipmentGroup key={bow.id} title={bow.name} equipment={groupedEquipment[bow.id]} />
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

const EquipmentGroup = ({ title, equipment }) => (
    <div className="bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-bold text-gray-800 p-4 border-b">{title}</h2>
        <ul className="divide-y divide-gray-200">
            {equipment.map(item => <EquipmentItem key={item.id} item={item} />)}
        </ul>
    </div>
);

const EquipmentItem = ({ item }) => (
    <li>
        <Link to={`/equipment/${item.id}`} className="block p-4 hover:bg-gray-50">
            <div className="flex items-center justify-between">
                <div>
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    <p className="text-sm text-gray-600">{item.make} {item.model}</p>
                </div>
                <ChevronRightIcon className="w-5 h-5 text-gray-400" />
            </div>
        </Link>
    </li>
);

export default EquipmentList;
