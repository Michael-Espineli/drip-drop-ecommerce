import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';

// Helper function to render status badges
const StatusBadge = ({ status }) => {
    const baseClasses = "px-3 py-1 rounded-full text-sm font-semibold";
    let specificClasses = "";

    switch (status) {
        case 'Pending':
            specificClasses = "bg-yellow-200 text-yellow-800";
            break;
        case 'Accepted':
            specificClasses = "bg-green-200 text-green-800";
            break;
        case 'Rejected':
        case 'Revoked':
            specificClasses = "bg-red-200 text-red-800";
            break;
        default:
            specificClasses = "bg-gray-200 text-gray-800";
    }

    return <span className={`${baseClasses} ${specificClasses}`}>{status}</span>;
};

const ContractDetailView = () => {
    const { contractId } = useParams();
    const navigate = useNavigate();
    const { user, recentlySelectedCompany } = useContext(Context);

    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!contractId || !user) return;

        const contractRef = doc(db, 'contracts', contractId);
        const unsubscribe = onSnapshot(contractRef, (docSnap) => {
            if (docSnap.exists()) {
                const contractData = { id: docSnap.id, ...docSnap.data() };
                
                // Security check: ensure the user is party to this contract
                if (contractData.senderId !== recentlySelectedCompany && contractData.receiverId !== user.uid) {
                    toast.error("You don't have permission to view this contract.");
                    navigate('/company/dashboard');
                    return;
                }

                setContract(contractData);
            } else {
                toast.error("Contract not found.");
                navigate('/company/estimates');
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching contract:", error);
            toast.error("Failed to fetch contract details.");
            setLoading(false);
        });

        return () => unsubscribe();
    }, [contractId, user, recentlySelectedCompany, navigate]);

    const handleUpdateStatus = async (newStatus) => {
        setIsSubmitting(true);
        const toastId = toast.loading(`Updating contract to ${newStatus}...`);
        const contractRef = doc(db, 'contracts', contractId);

        try {
            const updatePayload = { status: newStatus };
            if (newStatus === 'Accepted') {
                updatePayload.dateAccepted = serverTimestamp();
            }
            await updateDoc(contractRef, updatePayload);
            toast.success(`Contract has been ${newStatus}.`, { id: toastId });
        } catch (error) {
            console.error(`Error updating contract:`, error);
            toast.error(`Failed to update contract.`, { id: toastId });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const isCompanyUser = contract?.senderId === recentlySelectedCompany;
    const isCustomer = contract?.receiverId === user?.uid;

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} color="#1D2E76" /></div>;
    }

    if (!contract) {
        return null; // Or a more descriptive "Not Found" component
    }

    return (
        <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Contract Details</h1>
                            <p className="text-gray-500 mt-1">For {contract.receiverName}</p>
                        </div>
                        <StatusBadge status={contract.status} />
                    </div>
                    <div className="border-t border-gray-200 mt-6 pt-6">
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-6">
                            <div>
                                <dt className="text-sm font-medium text-gray-500">Amount</dt>
                                <dd className="mt-1 text-lg font-semibold text-gray-900">${contract.rate?.toLocaleString() || '0.00'}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500">Date Sent</dt>
                                <dd className="mt-1 text-gray-800">{contract.dateSent ? format(contract.dateSent.toDate(), 'PPP') : 'N/A'}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500">Accept By</dt>
                                <dd className="mt-1 text-gray-800">{contract.lastDateToAccept ? format(contract.lastDateToAccept.toDate(), 'PPP') : 'N/A'}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500">Date Accepted</dt>
                                <dd className="mt-1 text-gray-800">{contract.dateAccepted ? format(contract.dateAccepted.toDate(), 'PPP') : '-'}</dd>
                            </div>
                        </dl>
                    </div>
                </div>

                {/* Action Buttons */}
                {contract.status === 'Pending' && (
                    <div className="bg-white shadow-lg rounded-2xl p-6 mb-6 flex justify-end items-center gap-3">
                        <p className="text-sm text-gray-600 mr-auto">Awaiting response from {contract.receiverName}</p>
                        {isCompanyUser && (
                            <button onClick={() => handleUpdateStatus('Revoked')} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50">
                                {isSubmitting ? 'Revoking...' : 'Revoke'}
                            </button>
                        )}
                        {isCustomer && (
                            <>
                                <button onClick={() => handleUpdateStatus('Rejected')} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50">
                                    Decline
                                </button>
                                <button onClick={() => handleUpdateStatus('Accepted')} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50">
                                    {isSubmitting ? 'Accepting...' : 'Accept & Sign'}
                                </button>
                            </>
                        )}
                    </div>
                )}
                
                {/* Terms and Notes */}
                <div className="bg-white shadow-lg rounded-2xl p-6">
                    <div className="mb-6">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Terms of Service</h3>
                        {contract.terms && contract.terms.length > 0 ? (
                            <ul className="list-disc list-inside space-y-2 text-gray-700">
                                {contract.terms.map((term, index) => (
                                    <li key={index}>{term.description}</li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-gray-500">No terms specified.</p>
                        )}
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Notes</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{contract.notes || 'No additional notes.'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ContractDetailView;
