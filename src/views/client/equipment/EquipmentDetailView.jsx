
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, deleteDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { ArrowLeftIcon, TrashIcon, WrenchScrewdriverIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const EquipmentDetailView = () => {
    const { equipmentId } = useParams();
    const { user } = useContext(Context);
    const navigate = useNavigate();

    const [equipment, setEquipment] = useState(null);
    const [bodyOfWaterName, setBodyOfWaterName] = useState('');
    const [repairHistory, setRepairHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (!user || !equipmentId) {
            setLoading(false);
            return;
        }

        const fetchEquipmentAndHistory = async () => {
            setLoading(true);
            try {
                const equipDocRef = doc(db, 'homeOwnerEquipment', equipmentId);
                const equipDocSnap = await getDoc(equipDocRef);

                if (!equipDocSnap.exists() || equipDocSnap.data().userId !== user.uid) {
                    setError('Equipment not found or permission denied.');
                    setLoading(false);
                    return;
                }

                const equipData = { id: equipDocSnap.id, ...equipDocSnap.data() };
                setEquipment(equipData);

                // --- Parallel Fetches ---
                const promises = [];

                // 1. Fetch Body of Water Name
                if (equipData.bodyOfWaterId) {
                    const bowDocRef = doc(db, 'homeOwnerBodiesOfWater', equipData.bodyOfWaterId);
                    promises.push(getDoc(bowDocRef));
                } else {
                    promises.push(Promise.resolve(null)); // Placeholder
                }

                // 2. Fetch Repair History
                const repairQuery = query(
                    collection(db, 'homeOwnerRepairRequests'),
                    where('equipmentId', '==', equipmentId),
                    orderBy('createdAt', 'desc')
                );
                promises.push(getDocs(repairQuery));
                
                const [bowDocSnap, repairHistorySnap] = await Promise.all(promises);

                if (bowDocSnap && bowDocSnap.exists()) {
                    setBodyOfWaterName(bowDocSnap.data().name);
                }

                setRepairHistory(repairHistorySnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            } catch (err) {
                console.error("Error fetching data: ", err);
                setError('Failed to load equipment details and history.');
            } finally {
                setLoading(false);
            }
        };

        fetchEquipmentAndHistory();
    }, [equipmentId, user]);

    const handleDelete = async () => {
        if (!window.confirm("Are you sure you want to delete this piece of equipment?")) return;

        setIsDeleting(true);
        setError(null);
        try {
            await deleteDoc(doc(db, 'homeOwnerEquipment', equipmentId));
            navigate('/equipment'); // Redirect to the list view after deletion
        } catch (err) {
            console.error("Error deleting equipment: ", err);
            setError("Failed to delete equipment. Please try again.");
            setIsDeleting(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center">Loading...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">{error}</div>;
    }

    if (!equipment) {
        return null;
    }

    return (
        <div className="px-4 md:px-8 py-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <Header name={equipment.name} onBack={() => navigate(-1)} />

                <div className="bg-white rounded-lg shadow-md mt-8">
                    <div className="p-6 border-b flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                                <WrenchScrewdriverIcon className='w-7 h-7 text-gray-600' />
                                {equipment.name}
                            </h2>
                            <p className="text-gray-600">{equipment.make} {equipment.model}</p>
                        </div>
                        <button 
                            onClick={handleDelete} 
                            disabled={isDeleting}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 disabled:bg-gray-400"
                        >
                            <TrashIcon className="w-5 h-5" />
                            {isDeleting ? 'Deleting...' : 'Delete'}
                        </button>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                        <DetailItem label="Type/Category" value={equipment.type} />
                        <DetailItem label="Make" value={equipment.make} />
                        <DetailItem label="Model" value={equipment.model} />
                        <DetailItem label="Serial Number" value={equipment.serialNumber} />
                        <DetailItem label="Installed On" value={equipment.installDate ? new Date(equipment.installDate).toLocaleDateString() : 'N/A'} />
                        <DetailItem label="Warranty" value={equipment.warrantyInfo || 'N/A'} />
                        <DetailItem label="Linked To" value={bodyOfWaterName || 'Unassigned'} />
                    </div>
                    {equipment.notes && (
                        <div className="p-6 border-t">
                           <p className="font-semibold text-gray-800">Notes</p>
                           <p className="text-gray-600 mt-1 whitespace-pre-wrap">{equipment.notes}</p>
                        </div>
                    )}
                </div>

                <RepairHistoryList history={repairHistory} />
            </div>
        </div>
    );
};

const Header = ({ name, onBack }) => (
    <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
            <ArrowLeftIcon className="w-6 h-6" />
        </button>
        <h1 className="text-3xl font-bold text-gray-900 truncate">{name}</h1>
    </div>
);

const DetailItem = ({ label, value }) => (
    <div>
        <p className="font-semibold text-gray-800">{label}</p>
        <p className="text-gray-600">{value || 'N/A'}</p>
    </div>
);

const RepairHistoryList = ({ history }) => {
    if (history.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-md mt-8">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800">Repair History</h3>
                    <p className="text-sm text-gray-500 mt-2">No repair history found for this equipment.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-md mt-8">
            <h3 className="text-xl font-bold text-gray-800 p-6 border-b">Repair History</h3>
            <ul className="divide-y divide-gray-200">
                {history.map(req => (
                    <li key={req.id}>
                        <Link to={`/client/repair-requests/${req.id}`} className="block p-4 hover:bg-gray-50">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-semibold text-gray-800">{req.issueDescription || 'No Description'}</p>
                                    <p className="text-sm text-gray-500">Status: <span className="font-medium">{req.status}</span></p>
                                </div>
                                <div className="text-right flex-shrink-0 ml-4">
                                     <p className="text-sm text-gray-600">{req.createdAt ? format(req.createdAt.toDate(), 'MMM d, yyyy') : ''}</p>
                                     <ChevronRightIcon className="w-5 h-5 text-gray-400 mt-1 ml-auto" />
                                </div>
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
};


export default EquipmentDetailView;
