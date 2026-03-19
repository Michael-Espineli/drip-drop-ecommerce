import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext'; // Adjust path if necessary
import { ClipLoader } from 'react-spinners';
import { subDays, startOfDay } from 'date-fns';

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

export default function Leads() {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ pending: 0, inProgress: 0, completed: 0, cancelled: 0 });
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();
    const navigate = useNavigate();

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const companyId = recentlySelectedCompany;
        const thirtyDaysAgo = subDays(startOfDay(new Date()), 30);

        // Queries for stats
        const queries = {
            pending: query(collection(db, "homeOwnerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "Pending")),
            inProgress: query(collection(db, "homeOwnerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "In Progress")),
            completed: query(collection(db, "homeOwnerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "Completed"), where("dateCompleted", ">=", thirtyDaysAgo)),
            cancelled: query(collection(db, "homeOwnerServiceRequests"), where("companyId", "==", companyId), where("status", "==", "Cancelled"), where("dateCompleted", ">=", thirtyDaysAgo)),
        };

        const unsubscribes = Object.keys(queries).map(key => 
            onSnapshot(queries[key], snapshot => {
                setStats(prev => ({ ...prev, [key]: snapshot.size }));
            }, err => console.error(`Error fetching ${key} stats:`, err))
        );

        // Query for leads list
        const leadsQuery = query(collection(db, "homeOwnerServiceRequests"), where("companyId", "==", companyId));
        const unsubscribeLeads = onSnapshot(leadsQuery, snapshot => {
            const leadsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLeads(leadsData.sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate()));
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

    const renderStatus = (status) => {
        const colors = {
            Pending: 'bg-blue-200 text-blue-800',
            'In Progress': 'bg-yellow-200 text-yellow-800',
            Completed: 'bg-green-200 text-green-800',
            Cancelled: 'bg-red-200 text-red-800',
        };
        return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[status] || 'bg-gray-200'}`}>{status}</span>;
    };

    const renderSource = (source) => {
        return source === 'Manual' 
            ? <span className="px-2 py-1 text-xs font-semibold rounded-full bg-indigo-200 text-indigo-800">Manual</span> 
            : <span className="px-2 py-1 text-xs font-semibold rounded-full bg-teal-200 text-teal-800">Customer</span>;
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="sm:flex sm:items-center sm:justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Leads</h1>
                    <p className="mt-1 text-sm text-gray-600">Manage and track all incoming homeowner service requests.</p>
                </div>
                <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
                    <button
                        type="button"
                        onClick={() => navigate('/company/leads/new')}
                        className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
                    >
                        Add Lead
                    </button>
                </div>
            </div>

            {/* Header Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard title="Pending" count={stats.pending} color="bg-blue-100" icon={<svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                <StatCard title="In Progress" count={stats.inProgress} color="bg-yellow-100" icon={<svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.5 9.5a9 9 0 101.7 -5.2" /></svg>} />
                <StatCard title="Completed (30d)" count={stats.completed} color="bg-green-100" icon={<svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                <StatCard title="Cancelled (30d)" count={stats.cancelled} color="bg-red-100" icon={<svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.36 6.64a9 9 0 11-12.73 0M12 9v4m0 4h.01" /></svg>} />
            </div>

            <div className="bg-white shadow-lg rounded-2xl overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <ClipLoader size={50} color={"#123abc"} loading={loading} />
                    </div>
                ) : leads.length === 0 ? (
                    <div className="text-center p-12">
                        <h3 className="text-lg font-medium text-gray-900">No leads yet</h3>
                        <p className="mt-2 text-sm text-gray-500">When a homeowner requests a service, it will appear here.</p>
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
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {leads.map(lead => (
                                    <tr key={lead.id} className="hover:bg-gray-50"
                                    onClick={() => navigate(`/company/leads/${lead.id}`)}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-medium text-gray-900">{lead.homeownerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">{lead.serviceLocationAddress.streetAddress}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {lead.createdAt?.toDate().toLocaleDateString() || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderStatus(lead.status)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderSource(lead.source)}</td>
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
