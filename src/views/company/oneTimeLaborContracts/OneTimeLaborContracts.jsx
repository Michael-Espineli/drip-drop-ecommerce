
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, or } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const ContractStatusBadge = ({ status }) => {
    const baseClasses = "px-3 py-1 text-sm font-semibold rounded-full text-white";
    const statusClasses = {
        'Pending': 'bg-yellow-500',
        'Active': 'bg-green-500',
        'Declined': 'bg-red-500',
        'Completed': 'bg-blue-500',
        'Terminated': 'bg-gray-600',
    };
    return <span className={`${baseClasses} ${statusClasses[status] || 'bg-gray-400'}`}>{status}</span>;
};

const ContractCard = ({ contract, onClick }) => (
    <div 
        onClick={onClick}
        className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 hover:shadow-2xl hover:border-blue-500 transition-all duration-300 cursor-pointer"
    >
        <div className="flex justify-between items-start">
            <h3 className="text-xl font-bold text-gray-800 truncate">{contract.title || 'One-Time Labor Contract'}</h3>
            <ContractStatusBadge status={contract.status} />
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-600 space-y-2">
            <p><span className="font-semibold">From:</span> {contract.senderName}</p>
            <p><span className="font-semibold">To:</span> {contract.receiverName}</p>
            <p><span className="font-bold text-lg text-green-600">Rate:</span> ${contract.rateOffered}</p>
        </div>
    </div>
);

const OneTimeLaborContracts = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const [contracts, setContracts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setIsLoading(false);
            return;
        }

        const fetchContracts = async () => {
            setIsLoading(true);
            try {
                // Efficiently query both sent and received contracts in one go
                const contractsRef = collection(db, 'laborContracts'); // Corrected collection name
                const q = query(contractsRef, 
                    or(
                        where('senderId', '==', recentlySelectedCompany),
                        where('receiverId', '==', recentlySelectedCompany)
                    )
                );
                const querySnapshot = await getDocs(q);
                const contractsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setContracts(contractsList);
            } catch (error) {
                console.error("Error fetching one-time labor contracts: ", error);
                toast.error("Could not load one-time contracts.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchContracts();
    }, [recentlySelectedCompany]);

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">One-Time Labor Contracts</h1>
                        <p className="text-gray-600 mt-1">Manage your single-event labor agreements.</p>
                    </div>
                    <button
                        onClick={() => navigate('/company/laborContracts/createNew/NA')} // Path might need adjustment
                        className='mt-4 sm:mt-0 py-2 px-6 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all'
                    >
                        Create New
                    </button>
                </header>

                {isLoading ? (
                    <div className="text-center py-10"><p className="text-gray-500">Loading contracts...</p></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {contracts.length > 0 ? (
                            contracts.map(contract => (
                                <ContractCard 
                                    key={contract.id} 
                                    contract={contract} 
                                    onClick={() => navigate(`/company/laborContracts/details/${contract.id}`)} // Path might need adjustment
                                />
                            ))
                        ) : (
                            <div className="col-span-full text-center py-16 bg-white rounded-2xl shadow-lg border">
                                <h3 className="text-2xl font-semibold text-gray-700">No One-Time Contracts Found</h3>
                                <p className="text-gray-500 mt-3">Click "Create New" to start a new labor agreement.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default OneTimeLaborContracts;
