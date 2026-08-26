import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext'; // Adjust path if necessary
import { ClipLoader } from 'react-spinners';
import toast from 'react-hot-toast';
import {
    ArrowPathIcon,
    CalendarDaysIcon,
    CheckCircleIcon,
    ClipboardDocumentIcon,
    ClockIcon,
    DocumentTextIcon,
    NoSymbolIcon,
    UserPlusIcon,
} from '@heroicons/react/24/outline';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { getLeadSourceLabel } from '../../../utils/customerPipeline';
import LeadCancellationDialog from './LeadCancellationDialog';
import {
    cancelLeadWithOptions,
    previewLeadCancellationTargets,
} from '../../../utils/leads/leadCancellation';

// StatCard component for displaying header stats
const StatCard = ({ title, count, Icon, color, selected, selectedClass, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        aria-label={`Show ${title} leads`}
        className={`flex w-full items-start justify-between gap-3 rounded-lg border p-4 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${selected ? selectedClass : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
    >
        <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
            <p className="mt-1 text-xl font-bold text-slate-950">{count}</p>
        </div>
        <div className={`rounded-md p-2 ${color}`}>
            <Icon className="h-6 w-6" />
        </div>
    </button>
);

const statusCardConfigs = [
    {
        key: 'pending',
        title: 'Pending',
        value: 'Pending',
        Icon: ClockIcon,
        color: 'bg-blue-50 text-blue-600',
        selectedClass: 'border-blue-500 bg-blue-50 ring-2 ring-blue-100',
    },
    {
        key: 'inProgress',
        title: 'In Progress',
        value: 'In Progress',
        Icon: ArrowPathIcon,
        color: 'bg-amber-50 text-amber-600',
        selectedClass: 'border-amber-500 bg-amber-50 ring-2 ring-amber-100',
    },
    {
        key: 'completed',
        title: 'Completed',
        value: 'Completed',
        Icon: CheckCircleIcon,
        color: 'bg-emerald-50 text-emerald-600',
        selectedClass: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100',
    },
    {
        key: 'cancelled',
        title: 'Cancelled',
        value: 'Cancelled',
        Icon: NoSymbolIcon,
        color: 'bg-red-50 text-red-600',
        selectedClass: 'border-red-500 bg-red-50 ring-2 ring-red-100',
    },
];

const leadStatusCountKeys = statusCardConfigs.reduce((keys, card) => ({
    ...keys,
    [card.value]: card.key,
}), {});

const actionButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

const normalizeLeadStatusKey = (status = '') => String(status || '').trim().toLowerCase();

const getNormalizedLeadSource = (lead = {}) => {
    const explicitSource = String(lead.leadSource || lead.marketingSource || lead.sourceLabel || '').trim();
    if (explicitSource) return explicitSource;

    const source = String(lead.source || '').trim().toLowerCase();

    if (source === 'manual') return 'Manual';
    if (source === 'public' || lead.publicLead || lead.sourceType === 'publicNoAccount') return 'Public';

    return 'Customer';
};

export default function Leads() {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('Pending');
    const [sourceFilter, setSourceFilter] = useState('All');
    const [cancellingLeadId, setCancellingLeadId] = useState('');
    const [cancelDialogLead, setCancelDialogLead] = useState(null);
    const [cancelDialogTargets, setCancelDialogTargets] = useState({});
    const [loadingCancelTargets, setLoadingCancelTargets] = useState(false);
    const { recentlySelectedCompany, user, dataBaseUser } = useContext(Context);
    const { can } = useCompanyPermissions();
    const db = getFirestore();
    const navigate = useNavigate();
    const publicLeadFormUrl = useMemo(() => (
        recentlySelectedCompany && typeof window !== 'undefined'
            ? `${window.location.origin}/request-service/${recentlySelectedCompany}`
            : ''
    ), [recentlySelectedCompany]);
    const sourceOptions = useMemo(() => (
        [...new Set(leads.map((lead) => getNormalizedLeadSource(lead)).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right))
    ), [leads]);
    const statusCounts = useMemo(() => (
        leads.reduce((counts, lead) => {
            const countKey = leadStatusCountKeys[lead.status];
            if (countKey) counts[countKey] += 1;
            return counts;
        }, { pending: 0, inProgress: 0, completed: 0, cancelled: 0 })
    ), [leads]);

    const toDate = (value) => {
        if (!value) return null;
        if (typeof value?.toDate === 'function') return value.toDate();
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const companyId = recentlySelectedCompany;

        // Query for leads list
        const leadsQuery = query(collection(db, "homeownerServiceRequests"), where("companyId", "==", companyId));
        const unsubscribeLeads = onSnapshot(leadsQuery, snapshot => {
            const leadsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLeads(leadsData.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)));
            setLoading(false);
        }, err => {
            console.error("Error fetching leads:", err);
            setLoading(false);
        });

        return () => {
            unsubscribeLeads();
        };

    }, [db, recentlySelectedCompany]);

    const visibleLeads = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();

        return leads.filter((lead) => {
            const matchesSearch = !term || [
                lead.homeownerName,
                lead.homeownerEmail,
                lead.homeownerPhone,
                lead.customerName,
                lead.customerId,
                lead.companyCustomerId,
                lead.homeownerId,
                lead.serviceLocationId,
                lead.companyServiceLocationId,
                lead.homeownerserviceLocationId,
                lead.serviceLocationAddress?.streetAddress,
                lead.serviceLocationAddress?.city,
                lead.status,
                getLeadSourceLabel(lead),
                lead.source,
                lead.id,
            ].some((value) => String(value || '').toLowerCase().includes(term));
            const matchesStatus = statusFilter === 'All' || lead.status === statusFilter;
            const normalizedSource = getNormalizedLeadSource(lead);
            const matchesSource = sourceFilter === 'All' || normalizedSource === sourceFilter;

            return matchesSearch && matchesStatus && matchesSource;
        });
    }, [leads, searchTerm, sourceFilter, statusFilter]);

    const renderStatus = (status) => {
        const colors = {
            Pending: 'bg-blue-50 text-blue-700',
            'In Progress': 'bg-amber-50 text-amber-700',
            Completed: 'bg-emerald-50 text-emerald-700',
            Cancelled: 'bg-red-50 text-red-700',
        };
        return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status] || 'bg-slate-100 text-slate-700'}`}>{status}</span>;
    };

    const renderSource = (lead) => {
        const source = getNormalizedLeadSource(lead);
        const colors = {
            Manual: 'bg-violet-50 text-violet-700',
            Public: 'bg-orange-50 text-orange-700',
            Customer: 'bg-cyan-50 text-cyan-700',
            Website: 'bg-blue-50 text-blue-700',
            Referral: 'bg-emerald-50 text-emerald-700',
            Google: 'bg-amber-50 text-amber-700',
            Yelp: 'bg-rose-50 text-rose-700',
            Facebook: 'bg-indigo-50 text-indigo-700',
        };

        return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[source] || colors.Customer}`}>{source}</span>;
    };

    const copyPublicLeadLink = async () => {
        if (!publicLeadFormUrl) {
            toast.error('Select a company before copying the public lead link.');
            return;
        }

        try {
            await navigator.clipboard.writeText(publicLeadFormUrl);
            toast.success('Public lead form link copied.');
        } catch (error) {
            console.error('Failed to copy public lead form link', error);
            toast.error('Could not copy the public lead link.');
        }
    };

    const getLinkedCustomerId = (lead = {}) => lead.customerId || lead.companyCustomerId || '';
    const getLinkedServiceLocationId = (lead = {}) => lead.companyServiceLocationId || lead.serviceLocationId || '';
    const isLeadCancelled = (lead = {}) => ['cancelled', 'canceled'].includes(normalizeLeadStatusKey(lead.status || lead.leadStatus));

    const renderLinkStatus = (lead) => {
        const linkedCustomerId = getLinkedCustomerId(lead);

        if (linkedCustomerId) {
            return (
                <div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Customer linked</span>
                    <div className="mt-1 text-xs text-slate-500">{lead.customerName || "Linked customer"}</div>
                </div>
            );
        }

        if (lead.homeownerId) {
            return (
                <div>
                    <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">Client request</span>
                    <div className="mt-1 text-xs text-slate-500">{lead.homeownerId}</div>
                </div>
            );
        }

        return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Unlinked</span>;
    };

    const buildLeadServiceAgreementPath = (lead) => {
        const params = new URLSearchParams({ leadId: lead.id });
        const linkedCustomerId = getLinkedCustomerId(lead);
        const linkedServiceLocationId = getLinkedServiceLocationId(lead);

        if (linkedCustomerId) params.set('customerId', linkedCustomerId);
        if (linkedServiceLocationId) params.set('serviceLocationId', linkedServiceLocationId);

        return `/company/sales/agreements/new?${params.toString()}`;
    };

    const buildLeadServiceEstimatePath = (lead) => {
        const params = new URLSearchParams({
            leadId: lead.id,
            category: 'serviceAgreementEstimate',
        });
        const linkedCustomerId = getLinkedCustomerId(lead);
        const linkedServiceLocationId = getLinkedServiceLocationId(lead);

        if (linkedCustomerId) params.set('customerId', linkedCustomerId);
        if (linkedServiceLocationId) params.set('serviceLocationId', linkedServiceLocationId);

        return `/company/serviceStops/createNew?${params.toString()}`;
    };

    const stopRowNavigation = (event) => event.stopPropagation();

    const navigateToCustomerConversion = (lead, event) => {
        stopRowNavigation(event);
        navigate(`/company/customers/create-from-lead/${lead.id}`);
    };

    const navigateToScheduleEstimate = (lead, event) => {
        stopRowNavigation(event);
        if (!getLinkedCustomerId(lead)) {
            toast.error('Convert or link the lead to a customer before scheduling an estimate.');
            return;
        }

        navigate(buildLeadServiceEstimatePath(lead));
    };

    const navigateToServiceAgreement = (lead, event) => {
        stopRowNavigation(event);
        if (!getLinkedCustomerId(lead)) {
            toast.error('Convert or link the lead to a customer before sending a service agreement.');
            return;
        }

        navigate(lead.serviceAgreementId
            ? `/company/sales/agreements/${lead.serviceAgreementId}`
            : buildLeadServiceAgreementPath(lead));
    };

    const actorName = useMemo(() => (
        `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() ||
        user?.displayName ||
        user?.email ||
        ''
    ), [dataBaseUser?.firstName, dataBaseUser?.lastName, user?.displayName, user?.email]);

    const closeCancelDialog = () => {
        if (cancellingLeadId) return;
        setCancelDialogLead(null);
        setCancelDialogTargets({});
        setLoadingCancelTargets(false);
    };

    const openLeadCancellationDialog = async (lead, event) => {
        stopRowNavigation(event);
        if (isLeadCancelled(lead) || !can("614")) return;

        setCancelDialogLead(lead);
        setCancelDialogTargets({});
        setLoadingCancelTargets(true);

        try {
            const targets = await previewLeadCancellationTargets({
                db,
                companyId: recentlySelectedCompany,
                lead,
            });
            setCancelDialogTargets(targets);
        } catch (error) {
            console.error('Unable to load lead cancellation targets', error);
            toast.error('Could not load linked cleanup options.');
        } finally {
            setLoadingCancelTargets(false);
        }
    };

    const confirmLeadCancellation = async ({ reason, options }) => {
        if (!cancelDialogLead || !can("614")) return;

        setCancellingLeadId(cancelDialogLead.id);

        try {
            const result = await cancelLeadWithOptions({
                db,
                companyId: recentlySelectedCompany,
                lead: cancelDialogLead,
                reason: reason || cancelDialogLead.lostReason || cancelDialogLead.cancelReason || cancelDialogLead.statusChangeReason || 'Marked cancelled from leads list.',
                targets: cancelDialogTargets,
                options,
                actor: {
                    id: user?.uid || user?.id || '',
                    name: actorName,
                    email: user?.email || dataBaseUser?.email || '',
                },
            });

            const cleanupMessages = [
                result.serviceStopDeleted ? 'service stop deleted' : '',
                result.customerInactive ? 'customer made inactive' : '',
                result.agreementRejected ? 'agreement rejected' : '',
            ].filter(Boolean);
            toast.success(cleanupMessages.length
                ? `Lead cancelled; ${cleanupMessages.join(', ')}.`
                : 'Lead marked cancelled.');
            setCancelDialogLead(null);
            setCancelDialogTargets({});
            setLoadingCancelTargets(false);
        } catch (error) {
            console.error('Unable to cancel lead', error);
            toast.error(error.message || 'Failed to mark lead cancelled.');
        } finally {
            setCancellingLeadId('');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company sales</p>
                            <h1 className="mt-1 text-3xl font-bold text-slate-950">Leads</h1>
                            <p className="mt-1 text-sm text-slate-500">Manage and track all incoming homeowner service requests.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={copyPublicLeadLink}
                                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                                <ClipboardDocumentIcon className="h-4 w-4" />
                                Copy Public Form Link
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/company/leads/new')}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                <UserPlusIcon className="h-4 w-4" />
                                Add Lead
                            </button>
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-sm font-semibold text-slate-950">Public no-account service request form</p>
                            <p className="mt-1 text-sm text-slate-500">
                                Share this link on a website, text message, or service email so new homeowners can request service without signing in first.
                            </p>
                        </div>
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:w-[32rem]">
                            <input
                                type="text"
                                readOnly
                                value={publicLeadFormUrl}
                                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            />
                            <button
                                type="button"
                                onClick={copyPublicLeadLink}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                <ClipboardDocumentIcon className="h-4 w-4" />
                                Copy
                            </button>
                        </div>
                    </div>
                </div>

                {/* Header Stats */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {statusCardConfigs.map(({ key, value, ...card }) => (
                        <StatCard
                            key={value}
                            {...card}
                            count={statusCounts[key]}
                            selected={statusFilter === value}
                            onClick={() => setStatusFilter(value)}
                        />
                    ))}
                </div>

                <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="grid gap-3 border-b border-slate-200 p-5 md:grid-cols-[1.4fr_1fr_1fr]">
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Search homeowner, email, phone, address..."
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
                            <option value="All">All statuses</option>
                            <option value="Pending">Pending</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                        </select>
                        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
                            <option value="All">All sources</option>
                            {sourceOptions.map((source) => (
                                <option key={source} value={source}>{source}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                        <div>Showing {visibleLeads.length} of {leads.length} lead{leads.length === 1 ? "" : "s"}</div>
                        <div>{statusFilter === "All" ? "All statuses" : statusFilter} - {sourceFilter === "All" ? "All sources" : sourceFilter}</div>
                    </div>
                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <ClipLoader size={50} color={"#123abc"} loading={loading} />
                        </div>
                    ) : visibleLeads.length === 0 ? (
                        <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                            <h3 className="text-lg font-bold text-slate-900">No leads yet</h3>
                            <p className="mt-1 text-sm text-slate-500">When a homeowner requests a service, or filters match, it will appear here.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Homeowner</th>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Street Address</th>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</th>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Link</th>
                                        <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 bg-white">
                                    {visibleLeads.map(lead => (
                                        <tr key={lead.id} className="cursor-pointer transition hover:bg-slate-50"
                                            onClick={() => navigate(`/company/leads/${lead.id}`)}
                                        >
                                            <td className="whitespace-nowrap px-5 py-3" onClick={stopRowNavigation}>
                                                <div className="text-sm font-semibold text-slate-900">{lead.homeownerName}</div>
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">{lead.serviceLocationAddress?.streetAddress || 'No address'}</td>
                                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-500">
                                                {toDate(lead.createdAt)?.toLocaleDateString() || 'N/A'}
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-3">{renderStatus(lead.status)}</td>
                                            <td className="whitespace-nowrap px-5 py-3">{renderSource(lead)}</td>
                                            <td className="whitespace-nowrap px-5 py-3">{renderLinkStatus(lead)}</td>
                                            <td className="whitespace-nowrap px-5 py-3">
                                                <div className="flex flex-wrap gap-2">
                                                    {!getLinkedCustomerId(lead) && can("612") && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => navigateToCustomerConversion(lead, event)}
                                                            className={`${actionButtonClass} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                                                        >
                                                            <UserPlusIcon className="h-3.5 w-3.5" />
                                                            Convert
                                                        </button>
                                                    )}
                                                    {can("242") && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => navigateToScheduleEstimate(lead, event)}
                                                            className={`${actionButtonClass} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
                                                            disabled={!getLinkedCustomerId(lead)}
                                                            title={!getLinkedCustomerId(lead) ? 'Convert or link the lead to a customer first.' : 'Schedule estimate'}
                                                        >
                                                            <CalendarDaysIcon className="h-3.5 w-3.5" />
                                                            Schedule Estimate
                                                        </button>
                                                    )}
                                                    {can("612") && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => navigateToServiceAgreement(lead, event)}
                                                            className={`${actionButtonClass} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
                                                            disabled={!getLinkedCustomerId(lead)}
                                                            title={!getLinkedCustomerId(lead) ? 'Convert or link the lead to a customer first.' : 'Send service agreement'}
                                                        >
                                                            <DocumentTextIcon className="h-3.5 w-3.5" />
                                                            Send Service Agreement
                                                        </button>
                                                    )}
                                                    {can("614") && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => openLeadCancellationDialog(lead, event)}
                                                            className={`${actionButtonClass} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
                                                            disabled={isLeadCancelled(lead) || cancellingLeadId === lead.id}
                                                            title={isLeadCancelled(lead) ? 'Lead is already cancelled.' : 'Mark cancelled'}
                                                        >
                                                            <NoSymbolIcon className="h-3.5 w-3.5" />
                                                            {cancellingLeadId === lead.id ? 'Cancelling...' : 'Mark Cancelled'}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
            <LeadCancellationDialog
                lead={cancelDialogLead}
                targets={cancelDialogTargets}
                loadingTargets={loadingCancelTargets}
                saving={Boolean(cancellingLeadId)}
                permissions={{
                    canDeleteServiceStop: can("246"),
                    canDeactivateCustomer: can("14"),
                    canRejectAgreement: can("400"),
                }}
                onClose={closeCancelDialog}
                onConfirm={confirmLeadCancellation}
            />
        </div>
    );
}
