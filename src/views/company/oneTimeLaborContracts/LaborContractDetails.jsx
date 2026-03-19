
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const DetailItem = ({ label, value, children }) => (
    <div className="py-2">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {children || <p className="font-semibold text-gray-800">{value || 'N/A'}</p>}
    </div>
);

const DetailCard = ({ title, children }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4 pb-3 border-b border-gray-200">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {children}
        </div>
    </div>
);

const ContractStatusBadge = ({ status }) => {
    const baseClasses = "px-4 py-1.5 text-base font-bold rounded-full text-white tracking-wider";
    const statusClasses = {
        'Pending': 'bg-yellow-500',
        'Active': 'bg-green-500',
        'Declined': 'bg-red-500',
        'Completed': 'bg-blue-500',
        'Terminated': 'bg-gray-600',
    };
    return <span className={`${baseClasses} ${statusClasses[status] || 'bg-gray-400'}`}>{status}</span>;
};

const LaborContractDetails = () => {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { id: contractId } = useParams();

    const [contract, setContract] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isActionLoading, setIsActionLoading] = useState(false);

    useEffect(() => {
        if (!contractId) return;
        const fetchContract = async () => {
            setIsLoading(true);
            try {
                const contractRef = doc(db, 'laborContracts', contractId);
                const docSnap = await getDoc(contractRef);
                if (docSnap.exists()) {
                    setContract({ id: docSnap.id, ...docSnap.data() });
                } else {
                    toast.error("Contract not found.");
                    navigate('/company/oneTimeLaborContracts');
                }
            } catch (error) {
                toast.error("Failed to load contract details.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchContract();
    }, [contractId, navigate]);

    const handleUpdateStatus = async (newStatus, acceptanceStatus) => {
        setIsActionLoading(true);
        const toastId = toast.loading(`Updating status to ${newStatus}...`);
        try {
            const contractRef = doc(db, 'laborContracts', contractId);
            const updateData = {
                status: newStatus,
                receiverAcceptance: acceptanceStatus,
            };
            if (newStatus === 'Active') {
                updateData.dateAccepted = new Date();
            }
            await updateDoc(contractRef, updateData);
            setContract(prev => ({ ...prev, ...updateData }));
            toast.success('Contract updated successfully!', { id: toastId });
        } catch (error) {
            toast.error(`Update failed: ${error.message}`, { id: toastId });
        } finally {
            setIsActionLoading(false);
        }
    };

    if (isLoading) return <div className="text-center p-10">Loading contract details...</div>;
    if (!contract) return null;

    const isReceiver = contract.receiverId === recentlySelectedCompany;

    return (
        <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="max-w-5xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">{contract.title || 'One-Time Labor Contract'}</h1>
                        <p className="text-gray-600 mt-1">Details and status of the agreement.</p>
                    </div>
                     <button onClick={() => navigate('/company/oneTimeLaborContracts')} className='mt-4 sm:mt-0 py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-300 transition'>Back to List</button>
                </header>

                <div className="bg-white p-6 rounded-2xl shadow-xl mb-8 border">
                    <div className="flex justify-between items-center">
                         <h2 className="text-2xl font-bold text-gray-800">Status</h2>
                        <ContractStatusBadge status={contract.status} />
                    </div>
                </div>
                
                <div className="space-y-8">
                    <DetailCard title="Parties Involved">
                        <DetailItem label="Sender" value={contract.senderName} />
                        <DetailItem label="Recipient" value={contract.receiverName} />
                    </DetailCard>

                    <DetailCard title="Contract Terms">
                        <DetailItem label="Rate Offered"><p className="font-bold text-2xl text-green-600">${parseFloat(contract.rateOffered).toFixed(2)}</p></DetailItem>
                        <DetailItem label="Last Date to Accept" value={contract.lastDateToAccept} />
                        <DetailItem label="Terms and Conditions" value={contract.terms} />
                        <DetailItem label="Notes" value={contract.notes} />
                    </DetailCard>

                    {isReceiver && contract.status === 'Pending' && (
                        <div className="flex justify-end space-x-4 p-6 bg-white rounded-2xl shadow-xl border">
                            <button onClick={() => handleUpdateStatus('Declined', 'Declined')} disabled={isActionLoading} className="py-3 px-8 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 disabled:bg-red-300">Decline</button>
                            <button onClick={() => handleUpdateStatus('Active', 'Accepted')} disabled={isActionLoading} className="py-3 px-8 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 disabled:bg-green-300">Accept Contract</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LaborContractDetails;
