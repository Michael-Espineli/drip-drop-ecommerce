import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
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

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

const cents = (value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
};

const dollarsFromCents = (value) => ((cents(value) / 100) || 0).toFixed(2);
const formatCurrencyFromCents = (value) => currencyFormatter.format(cents(value) / 100);

const ContractDetailView = () => {
    const { contractId } = useParams();
    const navigate = useNavigate();
    const { user, recentlySelectedCompany } = useContext(Context);

    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [isEditingDetails, setIsEditingDetails] = useState(false);
    const [isSavingDetails, setIsSavingDetails] = useState(false);
    const [isSavingNotes, setIsSavingNotes] = useState(false);

    const [detailsForm, setDetailsForm] = useState({
        rate: '',
        lastDateToAccept: '',
        termsText: '',
    });

    const [notesDraft, setNotesDraft] = useState('');

    useEffect(() => {
        if (!contractId || !user) return;

        const contractRef = doc(db, 'contracts', contractId);
        const unsubscribe = onSnapshot(
            contractRef,
            (docSnap) => {
                if (docSnap.exists()) {
                    const contractData = { id: docSnap.id, ...docSnap.data() };

                    // Security check: ensure the user is party to this contract
                    if (
                        contractData.senderId !== recentlySelectedCompany &&
                        contractData.receiverId !== user.uid
                    ) {
                        toast.error("You don't have permission to view this contract.");
                        navigate('/company/dashboard');
                        return;
                    }

                    setContract(contractData);

                    setDetailsForm({
                        rate: dollarsFromCents(contractData.rate),
                        lastDateToAccept: contractData.lastDateToAccept
                            ? format(contractData.lastDateToAccept.toDate(), 'yyyy-MM-dd')
                            : '',
                        termsText: Array.isArray(contractData.terms)
                            ? contractData.terms.map((term) => term.description || '').join('\n')
                            : '',
                    });

                    setNotesDraft(contractData.notes || '');
                } else {
                    toast.error("Contract not found.");
                    navigate('/company/contracts');
                }
                setLoading(false);
            },
            (error) => {
                console.error("Error fetching contract:", error);
                toast.error("Failed to fetch contract details.");
                setLoading(false);
            }
        );

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

    const handleSaveDetails = async () => {
        if (!isCompanyUser) return;

        setIsSavingDetails(true);
        const toastId = toast.loading('Saving contract details...');
        const contractRef = doc(db, 'contracts', contractId);

        try {
            const parsedAmount = Number(detailsForm.rate || 0);
            const parsedRate =
                detailsForm.rate === '' || detailsForm.rate === null || !Number.isFinite(parsedAmount)
                    ? null
                    : Math.round(parsedAmount * 100);

            const parsedTerms = detailsForm.termsText
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((description) => ({ description }));

            const updatePayload = {
                rate: parsedRate,
                terms: parsedTerms,
                updatedAt: serverTimestamp(),
            };

            if (detailsForm.lastDateToAccept) {
                const acceptByDate = new Date(`${detailsForm.lastDateToAccept}T12:00:00`);
                updatePayload.lastDateToAccept = Timestamp.fromDate(acceptByDate);
            } else {
                updatePayload.lastDateToAccept = null;
            }

            await updateDoc(contractRef, updatePayload);
            setIsEditingDetails(false);
            toast.success('Contract details updated.', { id: toastId });
        } catch (error) {
            console.error('Error updating contract details:', error);
            toast.error('Failed to update contract details.', { id: toastId });
        } finally {
            setIsSavingDetails(false);
        }
    };

    const handleSaveNotes = async () => {
        const contractRef = doc(db, 'contracts', contractId);
        setIsSavingNotes(true);
        const toastId = toast.loading('Saving notes...');

        try {
            await updateDoc(contractRef, {
                notes: notesDraft,
                updatedAt: serverTimestamp(),
            });
            toast.success('Notes updated.', { id: toastId });
        } catch (error) {
            console.error('Error updating notes:', error);
            toast.error('Failed to update notes.', { id: toastId });
        } finally {
            setIsSavingNotes(false);
        }
    };

    const handleCopyContractLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            toast.success('Contract link copied.');
        } catch (error) {
            console.error('Failed to copy contract link:', error);
            toast.error('Failed to copy contract link.');
        }
    };

    const getContractCustomerEmail = () => (
        contract.receiverEmail ||
        contract.customerEmail ||
        contract.email ||
        contract.billingEmail ||
        contract.mainContact?.email ||
        contract.contact?.email ||
        ''
    );

    const handleSendToCustomer = () => {
        const subject = encodeURIComponent(`Contract for ${contract.receiverName || 'Customer'}`);
        const body = encodeURIComponent(
            `Hi ${contract.receiverName || ''},

Please review your contract here:
${window.location.href}

Thank you.`
        );
        const customerEmail = getContractCustomerEmail();

        if (customerEmail) {
            window.location.href = `mailto:${customerEmail}?subject=${subject}&body=${body}`;
        } else {
            toast.error('No customer email found on this contract.');
        }
    };

    const isCompanyUser = contract?.senderId === recentlySelectedCompany;
    const isCustomer = contract?.receiverId === user?.uid;

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <ClipLoader size={50} color="#1D2E76" />
            </div>
        );
    }

    if (!contract) {
        return null;
    }

    return (
        <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <Link
                                to="/company/contracts"
                                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                &larr; Back to Contracts
                            </Link>
                            <h1 className="text-3xl font-bold text-gray-900">Contract Details</h1>
                            <p className="text-gray-500 mt-1">For {contract.receiverName}</p>

                            {contract.jobId && (
                                <div className="mt-2">
                                    <Link
                                        to={`/company/jobs/detail/${contract.jobId}`}
                                        className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                                    >
                                        View Related Job &rarr;
                                    </Link>
                                </div>
                            )}
                        </div>
                        <StatusBadge status={contract.status} />
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
                        {isCompanyUser && (
                            <>
                                <button
                                    onClick={handleSendToCustomer}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700"
                                >
                                    Send to Customer
                                </button>

                                <button
                                    onClick={handleCopyContractLink}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                >
                                    Copy Contract Link
                                </button>
                            </>
                        )}

                        {contract.jobId && (
                            <Link
                                to={`/company/jobs/detail/${contract.jobId}`}
                                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Go to Job
                            </Link>
                        )}
                    </div>
                </div>

                {/* Contract Overview / Editable Details */}
                <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-gray-900">Contract Details</h2>
                        {isCompanyUser && (
                            <div className="flex gap-2">
                                {isEditingDetails ? (
                                    <>
                                        <button
                                            onClick={() => {
                                                setIsEditingDetails(false);
                                                setDetailsForm({
                                                    rate: dollarsFromCents(contract.rate),
                                                    lastDateToAccept: contract.lastDateToAccept
                                                        ? format(contract.lastDateToAccept.toDate(), 'yyyy-MM-dd')
                                                        : '',
                                                    termsText: Array.isArray(contract.terms)
                                                        ? contract.terms
                                                            .map((term) => term.description || '')
                                                            .join('\n')
                                                        : '',
                                                });
                                            }}
                                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveDetails}
                                            disabled={isSavingDetails}
                                            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md shadow-sm hover:bg-slate-800 disabled:opacity-50"
                                        >
                                            {isSavingDetails ? 'Saving...' : 'Save Details'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => setIsEditingDetails(true)}
                                        className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md shadow-sm hover:bg-slate-800"
                                    >
                                        Edit Contract
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {!isEditingDetails ? (
                        <div className="border-t border-gray-200 pt-6">
                            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Amount</dt>
                                    <dd className="mt-1 text-lg font-semibold text-gray-900">
                                        {formatCurrencyFromCents(contract.rate)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Date Sent</dt>
                                    <dd className="mt-1 text-gray-800">
                                        {contract.dateSent
                                            ? format(contract.dateSent.toDate(), 'PPP')
                                            : 'N/A'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Accept By</dt>
                                    <dd className="mt-1 text-gray-800">
                                        {contract.lastDateToAccept
                                            ? format(contract.lastDateToAccept.toDate(), 'PPP')
                                            : 'N/A'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Date Accepted</dt>
                                    <dd className="mt-1 text-gray-800">
                                        {contract.dateAccepted
                                            ? format(contract.dateAccepted.toDate(), 'PPP')
                                            : '-'}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    ) : (
                        <div className="border-t border-gray-200 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Amount
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={detailsForm.rate}
                                    onChange={(e) =>
                                        setDetailsForm((prev) => ({
                                            ...prev,
                                            rate: e.target.value,
                                        }))
                                    }
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Accept By
                                </label>
                                <input
                                    type="date"
                                    value={detailsForm.lastDateToAccept}
                                    onChange={(e) =>
                                        setDetailsForm((prev) => ({
                                            ...prev,
                                            lastDateToAccept: e.target.value,
                                        }))
                                    }
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Terms of Service
                                </label>
                                <textarea
                                    rows={8}
                                    value={detailsForm.termsText}
                                    onChange={(e) =>
                                        setDetailsForm((prev) => ({
                                            ...prev,
                                            termsText: e.target.value,
                                        }))
                                    }
                                    placeholder="Enter one term per line"
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    Add one term per line.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                {contract.status === 'Pending' && (
                    <div className="bg-white shadow-lg rounded-2xl p-6 mb-6 flex justify-end items-center gap-3 flex-wrap">
                        <p className="text-sm text-gray-600 mr-auto">
                            Awaiting response from {contract.receiverName}
                        </p>
                        {isCompanyUser && (
                            <button
                                onClick={() => handleUpdateStatus('Revoked')}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50"
                            >
                                {isSubmitting ? 'Revoking...' : 'Revoke'}
                            </button>
                        )}
                        {isCustomer && (
                            <>
                                <button
                                    onClick={() => handleUpdateStatus('Rejected')}
                                    disabled={isSubmitting}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Decline
                                </button>
                                <button
                                    onClick={() => handleUpdateStatus('Accepted')}
                                    disabled={isSubmitting}
                                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Accepting...' : 'Accept & Sign'}
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* Terms and Notes */}
                <div className="bg-white shadow-lg rounded-2xl p-6">
                    <div className="mb-8">
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
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-gray-800">Notes</h3>
                            <button
                                onClick={handleSaveNotes}
                                disabled={isSavingNotes}
                                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md shadow-sm hover:bg-slate-800 disabled:opacity-50"
                            >
                                {isSavingNotes ? 'Saving...' : 'Save Notes'}
                            </button>
                        </div>

                        <textarea
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            rows={6}
                            placeholder="Add notes here..."
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-700 whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ContractDetailView;
