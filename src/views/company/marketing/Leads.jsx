import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext'; // Adjust path if necessary
import { ClipLoader } from 'react-spinners';
import { subDays, startOfDay } from 'date-fns';
import toast from 'react-hot-toast';
import { ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';

// StatCard component for displaying header stats
const StatCard = ({ title, count, icon, color }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg flex items-center justify-between">
        <div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className="text-3xl font-bold text-gray-900">{count}</p>
        </div>
        <div className={`rounded-full p-3 ${color}`}>
            {icon}
        </div>
    </div>
);

const getNormalizedLeadSource = (lead = {}) => {
    const source = String(lead.source || '').trim().toLowerCase();

    if (source === 'manual') return 'Manual';
    if (source === 'public' || lead.publicLead || lead.sourceType === 'publicNoAccount') return 'Public';

    return 'Customer';
};

export default function Leads() {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ pending: 0, inProgress: 0, completed: 0, cancelled: 0 });
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [sourceFilter, setSourceFilter] = useState('All');
    const { recentlySelectedCompany } = useContext(Context);
    const { can } = useCompanyPermissions();
    const db = getFirestore();
    const navigate = useNavigate();
    const publicLeadFormUrl = useMemo(() => (
        recentlySelectedCompany && typeof window !== 'undefined'
            ? `${window.location.origin}/request-service/${recentlySelectedCompany}`
            : ''
    ), [recentlySelectedCompany]);

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
        const thirtyDaysAgo = subDays(startOfDay(new Date()), 30);

        // Queries for stats
        const queries = {
            pending: query(collection(db, "homeownerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "Pending")),
            inProgress: query(collection(db, "homeownerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "In Progress")),
            completed: query(collection(db, "homeownerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "Completed"), where("dateCompleted", ">=", thirtyDaysAgo)),
            cancelled: query(collection(db, "homeownerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "Cancelled"), where("dateCompleted", ">=", thirtyDaysAgo)),
        };

        const unsubscribes = Object.keys(queries).map(key =>
            onSnapshot(queries[key], snapshot => {
                setStats(prev => ({ ...prev, [key]: snapshot.size }));
            }, err => console.error(`Error fetching ${key} stats:`, err))
        );

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
            unsubscribes.forEach(unsub => unsub());
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
                lead.homeownerId,
                lead.serviceLocationId,
                lead.homeownerserviceLocationId,
                lead.serviceLocationAddress?.streetAddress,
                lead.serviceLocationAddress?.city,
                lead.status,
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
            Pending: 'bg-blue-200 text-blue-800',
            'In Progress': 'bg-yellow-200 text-yellow-800',
            Completed: 'bg-green-200 text-green-800',
            Cancelled: 'bg-red-200 text-red-800',
        };
        return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[status] || 'bg-gray-200'}`}>{status}</span>;
    };

    const renderSource = (lead) => {
        const source = getNormalizedLeadSource(lead);
        const colors = {
            Manual: 'bg-indigo-200 text-indigo-800',
            Public: 'bg-orange-100 text-orange-800',
            Customer: 'bg-teal-200 text-teal-800',
        };

        return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[source] || colors.Customer}`}>{source}</span>;
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

    const renderLinkStatus = (lead) => {
        if (lead.customerId) {
            return (
                <div>
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Customer linked</span>
                    <div className="mt-1 text-xs text-gray-500">{lead.customerName || (lead.customerId ? "Linked customer" : "")}</div>
                </div>
            );
        }

        if (lead.homeownerId) {
            return (
                <div>
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-800">Client request</span>
                    <div className="mt-1 text-xs text-gray-500">{lead.homeownerId}</div>
                </div>
            );
        }

        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">Unlinked</span>;
    };

    const buildLeadServiceStopSchedulerPath = (lead) => {
        const params = new URLSearchParams({
            leadId: lead.id,
            category: 'serviceAgreementEstimate',
        });
        const linkedServiceLocationId = lead.serviceLocationId || lead.companyServiceLocationId || '';

        if (lead.customerId) params.set('customerId', lead.customerId);
        if (linkedServiceLocationId) params.set('serviceLocationId', linkedServiceLocationId);

        return `/company/serviceStops/createNew?${params.toString()}`;
    };

    const handleScheduleLeadVisit = (event, lead) => {
        event.stopPropagation();

        if (!lead.customerId) {
            toast.error('Convert or link the lead to a customer before scheduling a service stop.');
            return;
        }

        navigate(buildLeadServiceStopSchedulerPath(lead));
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="sm:flex sm:items-center sm:justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Leads</h1>
                    <p className="mt-1 text-sm text-gray-600">Manage and track all incoming homeowner service requests.</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-3 sm:mt-0 sm:ml-16 sm:flex-none">
                    <button
                        type="button"
                        onClick={copyPublicLeadLink}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
                    >
                        <ClipboardDocumentIcon className="h-4 w-4" />
                        Copy Public Form Link
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/company/leads/new')}
                        className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
                    >
                        Add Lead
                    </button>
                </div>
            </div>

            <div className="mb-6 rounded-md border border-blue-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-gray-900">Public no-account service request form</p>
                        <p className="mt-1 text-sm text-gray-600">
                            Share this link on a website, text message, or service email so new homeowners can request service without signing in first.
                        </p>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:w-[32rem]">
                        <input
                            type="text"
                            readOnly
                            value={publicLeadFormUrl}
                            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                        />
                        <button
                            type="button"
                            onClick={copyPublicLeadLink}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                            <ClipboardDocumentIcon className="h-4 w-4" />
                            Copy
                        </button>
                    </div>
                </div>
            </div>

            {/* Header Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard title="Pending" count={stats.pending} color="bg-blue-100" icon={<svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                <StatCard title="In Progress" count={stats.inProgress} color="bg-yellow-100" icon={<svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.5 9.5a9 9 0 101.7 -5.2" /></svg>} />
                <StatCard title="Completed (30d)" count={stats.completed} color="bg-green-100" icon={<svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                <StatCard title="Cancelled (30d)" count={stats.cancelled} color="bg-red-100" icon={<svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.36 6.64a9 9 0 11-12.73 0M12 9v4m0 4h.01" /></svg>} />
            </div>

            <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
                    <input
                        type="search"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Search homeowner, email, phone, address..."
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
                        <option value="All">All statuses</option>
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>
                    <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
                        <option value="All">All sources</option>
                        <option value="Customer">Customer</option>
                        <option value="Public">Public</option>
                        <option value="Manual">Manual</option>
                    </select>
                </div>
                <p className="mt-3 text-sm text-gray-500">{visibleLeads.length} visible lead(s)</p>
            </div>

            <div className="bg-white shadow-lg rounded-2xl overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <ClipLoader size={50} color={"#123abc"} loading={loading} />
                    </div>
                ) : visibleLeads.length === 0 ? (
                    <div className="text-center p-12">
                        <h3 className="text-lg font-medium text-gray-900">No leads yet</h3>
                        <p className="mt-2 text-sm text-gray-500">When a homeowner requests a service, or filters match, it will appear here.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Homeowner</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Street Address</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer Link</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {visibleLeads.map(lead => (
                                    <tr key={lead.id} className="hover:bg-gray-50"
                                        onClick={() => navigate(`/company/leads/${lead.id}`)}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-medium text-gray-900">{lead.homeownerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">{lead.serviceLocationAddress?.streetAddress || 'No address'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {toDate(lead.createdAt)?.toLocaleDateString() || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderStatus(lead.status)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderSource(lead)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderLinkStatus(lead)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {can("242") && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => handleScheduleLeadVisit(event, lead)}
                                                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                    disabled={!lead.customerId}
                                                >
                                                    Schedule Visit
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
