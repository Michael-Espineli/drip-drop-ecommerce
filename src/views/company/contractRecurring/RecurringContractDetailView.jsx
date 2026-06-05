import React, { useContext, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';

const functions = getFunctions();

const STATUS = {
    pending: 'Pending',
    accepted: 'Accepted',
    past: 'Past',
    rejected: 'Rejected',
    draft: 'Draft',
};

const LIFE_CYCLE = [
    STATUS.draft,
    STATUS.pending,
    STATUS.accepted,
    STATUS.past,
];

const getStatusBadgeClass = (status) => {
    switch (status) {
        case STATUS.draft:
            return 'bg-slate-100 text-slate-800 border border-slate-200';
        case STATUS.pending:
            return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
        case STATUS.accepted:
            return 'bg-green-100 text-green-800 border border-green-200';
        case STATUS.rejected:
            return 'bg-red-100 text-red-800 border border-red-200';
        case STATUS.past:
            return 'bg-gray-100 text-gray-700 border border-gray-200';
        default:
            return 'bg-slate-100 text-slate-700 border border-slate-200';
    }
};

const formatDisplayValue = (value) => {
    if (value === null || value === undefined || value === '') return 'N/A';

    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            return value.toDate().toLocaleString();
        }

        if ('seconds' in value && 'nanoseconds' in value) {
            return new Date(value.seconds * 1000).toLocaleString();
        }

        if (Array.isArray(value)) {
            return value.length ? value.join(', ') : 'N/A';
        }

        try {
            return JSON.stringify(value);
        } catch (error) {
            return 'N/A';
        }
    }

    if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
    }

    return value;
};

const SectionCard = ({ title, children, rightContent }) => (
    <div className="bg-white shadow-lg rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
            {rightContent}
        </div>
        {children}
    </div>
);

const Field = ({ label, value }) => (
    <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-1 text-sm text-gray-900 break-words">{formatDisplayValue(value)}</p>
    </div>
);

const StatusPill = ({ status }) => (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(status)}`}>
        {status || 'Unknown'}
    </span>
);

const LifeCycleStepper = ({ currentStatus, routed, recurringServiceStopId }) => {
    const currentIndex = LIFE_CYCLE.indexOf(currentStatus);
    const showRejected = currentStatus === STATUS.rejected;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {LIFE_CYCLE.map((step, index) => {
                    const isComplete = currentIndex > index;
                    const isCurrent = currentStatus === step;
                    const isFuture = currentIndex < index && !isCurrent;

                    return (
                        <div
                            key={step}
                            className={`rounded-2xl border p-4 ${isCurrent
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : isComplete
                                        ? 'border-green-200 bg-green-50 text-green-900'
                                        : isFuture
                                            ? 'border-gray-200 bg-gray-50 text-gray-500'
                                            : 'border-gray-200 bg-white text-gray-700'
                                }`}
                        >
                            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Step {index + 1}</p>
                            <p className="mt-2 text-sm font-bold">{step}</p>
                        </div>
                    );
                })}
            </div>

            {showRejected && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-red-800">Lifecycle Ended: Rejected</p>
                    <p className="mt-1 text-sm text-red-700">
                        This recurring contract left the normal lifecycle and is currently rejected.
                    </p>
                </div>
            )}

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-blue-900">Routing</p>
                        <p className="mt-1 text-sm text-blue-800">
                            {routed
                                ? `Routed${recurringServiceStopId ? ` to recurringServiceStopId: ${recurringServiceStopId}` : ', but recurringServiceStopId is missing.'}`
                                : 'Not routed yet.'}
                        </p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${routed ? 'bg-blue-200 text-blue-900' : 'bg-white text-blue-700 border border-blue-200'
                        }`}>
                        {routed ? 'Routed' : 'Unrouted'}
                    </span>
                </div>
            </div>
        </div>
    );
};

function RecurringContractDetailView() {
    const params = useParams();
    const contractId = params.contractId || params.id;
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);

    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);
                setError('');

                if (!contractId) {
                    setError('Recurring contract id is missing from the route.');
                    setContract(null);
                    return;
                }

                const contractRef = doc(db, 'recurringContracts', contractId);
                const contractSnap = await getDoc(contractRef);

                if (!contractSnap.exists()) {
                    setError('Recurring contract not found.');
                    setContract(null);
                    return;
                }

                setContract({
                    id: contractSnap.id,
                    ...contractSnap.data(),
                });
            } catch (err) {
                console.error('Error loading recurring contract detail:', err);
                setError('Unable to load recurring contract details.');
            } finally {
                setLoading(false);
            }
        })();
    }, [contractId, recentlySelectedCompany]);

    const moneyValue = useMemo(() => {
        if (!contract?.rate) return '$0';
        return `$${Number((contract.rate || 0) / 100).toLocaleString()}`;
    }, [contract]);

    const updateStatus = async (nextStatus, extraData = {}) => {
        if (!contract?.id) return;

        try {
            setSaving(true);
            setError('');

            const contractRef = doc(db, 'recurringContracts', contract.id);
            await updateDoc(contractRef, {
                status: nextStatus,
                ...extraData,
            });

            setContract((prev) => ({
                ...prev,
                status: nextStatus,
                ...extraData,
            }));
        } catch (err) {
            console.error('Error updating recurring contract status:', err);
            setError('Unable to update recurring contract.');
        } finally {
            setSaving(false);
        }
    };

    const sendEstimateToCustomer = async () => {
        if (!contract?.id) return;

        try {
            setSaving(true);
            setError('');

            const sendRecurringEstimateToCustomer = httpsCallable(functions, 'sendRecurringEstimateToCustomer');
            await sendRecurringEstimateToCustomer({
                recurringContractId: contract.id,
                companyId: recentlySelectedCompany,
                customerId: contract.customerId || contract.receiverId,
            });

            const contractRef = doc(db, 'recurringContracts', contract.id);
            await updateDoc(contractRef, {
                status: STATUS.pending,
            });

            setContract((prev) => ({
                ...prev,
                status: STATUS.pending,
            }));
        } catch (err) {
            console.error('Error sending recurring estimate to customer:', err);
            setError('Unable to send recurring contract to customer.');
        } finally {
            setSaving(false);
        }
    };

    const routeToCreateRecurringServiceStop = () => {
        navigate('/company/recurring-service-stops/create', {
            state: {
                recurringContract: contract,
                recurringContractId: contract?.id,
                fromRecurringContractDetail: true,
            },
        });
    };

    const availableActions = useMemo(() => {
        if (!contract) return [];

        const actions = [];

        if (contract.status === STATUS.draft) {
            actions.push({
                label: 'Send Contract to Customer',
                onClick: sendEstimateToCustomer,
                style: 'primary',
            });
        }

        if (contract.status === STATUS.pending) {
            actions.push({ label: 'Accept Contract', onClick: () => updateStatus(STATUS.accepted), style: 'success' });
            actions.push({ label: 'Reject Contract', onClick: () => updateStatus(STATUS.rejected), style: 'danger' });
            actions.push({ label: 'Move Back to Draft', onClick: () => updateStatus(STATUS.draft), style: 'secondary' });
        }

        if (contract.status === STATUS.accepted) {
            actions.push({
                label: 'Create New Recurring Service Stop',
                onClick: routeToCreateRecurringServiceStop,
                style: 'primary',
            });
            actions.push({ label: 'Mark as Past', onClick: () => updateStatus(STATUS.past), style: 'secondary' });
        }

        if (contract.status === STATUS.rejected) {
            actions.push({ label: 'Move Back to Draft', onClick: () => updateStatus(STATUS.draft), style: 'secondary' });
            actions.push({ label: 'Move to Pending', onClick: () => updateStatus(STATUS.pending), style: 'primary' });
        }

        if (contract.status === STATUS.past) {
            actions.push({ label: 'Reopen as Accepted', onClick: () => updateStatus(STATUS.accepted), style: 'secondary' });
        }



        return actions;
    }, [contract]);

    const buttonClass = (style) => {
        switch (style) {
            case 'primary':
                return 'bg-slate-900 text-white hover:bg-slate-800';
            case 'success':
                return 'bg-green-600 text-white hover:bg-green-700';
            case 'danger':
                return 'bg-red-600 text-white hover:bg-red-700';
            default:
                return 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-200';
        }
    };

    if (loading) {
        return (
            <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-7xl">
                    <div className="bg-white shadow-lg rounded-2xl p-6">
                        <p className="text-gray-600">Loading recurring contract...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!contract) {
        return (
            <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-5xl">
                    <div className="bg-white shadow-lg rounded-2xl p-6">
                        <p className="text-red-600">{error || 'Recurring contract not found.'}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="bg-white shadow-lg rounded-2xl p-6">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div>
                            <Link
                                to="/company/recurring-contracts"
                                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                &larr; Back to Recurring Contracts
                            </Link>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                <h1 className="text-3xl font-bold text-gray-900">
                                    {contract.companyName || contract.receiverName || 'Recurring Contract'}
                                </h1>
                                <StatusPill status={contract.status} />
                            </div>
                            <p className="text-gray-500 mt-2">Recurring contract profile</p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => navigate(`/company/recurring-contracts/detail/${contract.id}`)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-200 transition"
                            >
                                Refresh Detail Route
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <SectionCard title="Lifecycle">
                    <LifeCycleStepper
                        currentStatus={contract.status}
                        routed={Boolean(contract.routed)}
                        recurringServiceStopId={contract.recurringServiceStopId}
                    />
                </SectionCard>

                <SectionCard
                    title="Action Bar"
                    rightContent={saving ? <span className="text-sm text-gray-500">Saving...</span> : null}
                >
                    <div className="flex flex-wrap gap-3">
                        {availableActions.length ? (
                            availableActions.map((action) => (
                                <button
                                    key={action.label}
                                    onClick={action.onClick}
                                    disabled={saving}
                                    className={`px-4 py-2 text-sm font-medium rounded-xl shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${buttonClass(action.style)}`}
                                >
                                    {action.label}
                                </button>
                            ))
                        ) : (
                            <p className="text-sm text-gray-500">No actions available for this state.</p>
                        )}
                    </div>
                </SectionCard>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2">
                        <SectionCard title="Contract Information">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <Field label="Company Name" value={contract.companyName} />
                                <Field label="Receiver Name" value={contract.receiverName} />
                                <Field label="Status" value={contract.status} />
                                <Field label="Amount" value={moneyValue} />
                                <Field label="Frequency" value={contract.frequency || contract.interval} />
                                <Field label="Start Date" value={contract.startDate || contract.dateCreated} />
                                <Field label="Sender" value={contract.senderName || (contract.senderId ? 'Linked sender' : '')} />
                                <Field label="Receiver" value={contract.receiverName || (contract.receiverId ? 'Linked receiver' : '')} />
                                <Field label="Connected Account" value={contract.connectedAccount ? 'Connected' : ''} />
                                <Field label="Price" value={contract.priceId ? 'Price configured' : ''} />
                            </div>

                            <div className="mt-6">
                                <Field label="Description" value={contract.description} />
                            </div>
                        </SectionCard>
                    </div>

                    <div className="xl:col-span-1 space-y-6">
                        <SectionCard title="Routing Information">
                            <div className="space-y-4">
                                <Field label="Routed" value={contract.routed} />
                                <Field label="Recurring Service Stop" value={contract.recurringServiceStopId ? 'Linked recurring stop' : ''} />
                                <Field label="Service Location" value={contract.serviceLocationName || (contract.serviceLocationId ? 'Linked service location' : '')} />
                                <Field label="Body Of Water" value={contract.bodyOfWaterName || (contract.bodyOfWaterId ? 'Linked body of water' : '')} />
                            </div>
                        </SectionCard>

                        <SectionCard title="Audit / Metadata">
                            <div className="space-y-4">
                                <Field label="Created At" value={contract.createdAt} />
                                <Field label="Updated At" value={contract.updatedAt} />
                                <Field label="Customer" value={contract.customerName || (contract.customerId ? 'Linked customer' : '')} />
                                <Field label="Subscription" value={contract.subscriptionId ? 'Linked subscription' : ''} />
                            </div>
                        </SectionCard>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default RecurringContractDetailView;
