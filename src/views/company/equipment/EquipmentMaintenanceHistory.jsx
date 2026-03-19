import React, { useState, useEffect, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, orderBy, doc, deleteDoc } from "firebase/firestore";
import { MaintenanceHistory } from '../../../utils/models/MaintenanceHistory';
import { format } from 'date-fns';

export default function EquipmentMaintenanceHistory() {
    const { equipmentId } = useParams();
    const { recentlySelectedCompany } = useContext(Context);
    const [maintenanceHistory, setMaintenanceHistory] = useState([]);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);

    useEffect(() => {
        (async () => {
            if (recentlySelectedCompany && equipmentId) {
                try {
                    const q = query(collection(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId, 'serviceHistory'), orderBy('date', 'desc'));
                    const querySnapshot = await getDocs(q);
                    const maintenanceHistoryData = querySnapshot.docs.map(doc => MaintenanceHistory.fromFirestore(doc));
                    setMaintenanceHistory(maintenanceHistoryData);
                } catch (error) {
                    console.error('Maintenance History Data Error!:', error);
                }
            }
        })();
    }, [recentlySelectedCompany, equipmentId]);

    const openDeleteModal = (id) => {
        setItemToDelete(id);
        setShowDeleteModal(true);
    };

    const closeDeleteModal = () => {
        setItemToDelete(null);
        setShowDeleteModal(false);
    };

    const handleDelete = async () => {
        if (itemToDelete) {
            try {
                await deleteDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId, 'maintenanceHistory', itemToDelete));
                setMaintenanceHistory(maintenanceHistory.filter(item => item.id !== itemToDelete));
                closeDeleteModal();
            } catch (error) {
                console.error("Error deleting document: ", error);
            }
        }
    };

    return (
        <div className='px-2 md:px-7 py-5'>
            <h2 className="text-2xl font-bold mb-4">Equipment Maintenance History</h2>
            <div className='relative overflow-x-auto'>
                <table className="min-w-full bg-white border border-gray-200">
                    <thead>
                        <tr>
                            <th className='px-4 py-2 border-b'>Date</th>
                            <th className='px-4 py-2 border-b'>Tech Name</th>
                            <th className='px-4 py-2 border-b'>Notes</th>
                            <th className='px-4 py-2 border-b'>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {maintenanceHistory?.map(item => (
                            <tr key={item.id} className="border-b border-slate-700 hover:bg-gray-100">
                                <td className='px-4 py-2 border-b'>{format(item.date, 'PP')}</td>
                                <td className='px-4 py-2 border-b'>{item.techName}</td>
                                <td className='px-4 py-2 border-b'>{item.notes}</td>
                                <td className='px-4 py-2 border-b'>
                                    <button onClick={() => openDeleteModal(item.id)} className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {showDeleteModal && (
                 <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center">
                    <div className="bg-gray-800 p-5 rounded-lg text-white">
                        <h2 className="text-lg font-bold mb-4">Delete Maintenance Record</h2>
                        <p>Are you sure you want to delete this maintenance record?</p>
                        <div className="flex justify-end gap-4 mt-4">
                            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
                                Delete
                            </button>
                            <button onClick={closeDeleteModal} className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}