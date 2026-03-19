import React, { useState, useEffect, useContext } from 'react';
import { getFirestore, collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { ClipLoader } from 'react-spinners';
import { format } from 'date-fns';

const StatCard = ({ title, value, description, linkTo }) => (
    <Link to={linkTo} className="block bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
        <h3 className="text-sm font-medium text-gray-500">{title}</h3>
        <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
    </Link>
);

const Sales = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const [leadsCount, setLeadsCount] = useState(0);
    const [estimatesCount, setEstimatesCount] = useState(0);
    const [activeContracts, setActiveContracts] = useState([]);
    const [recurringContracts, setRecurringContracts] = useState([]);
    const [recentLeads, setRecentLeads] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const commonQuery = (name) => query(collection(db, name), where('companyId', '==', recentlySelectedCompany));

        const unsubscribes = [
            onSnapshot(commonQuery('homeOwnerServiceRequests'), snapshot => setLeadsCount(snapshot.size)),
            onSnapshot(query(commonQuery('contracts'), where('status', '==', 'Pending')), snapshot => setEstimatesCount(snapshot.size)),
            onSnapshot(query(commonQuery('contracts'), where('status', '==', 'Accepted'), orderBy('dateAccepted', 'desc')), snapshot => setActiveContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
            onSnapshot(query(commonQuery('recurringContracts'), where('status', '==', 'Active')), snapshot => setRecurringContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
            onSnapshot(query(commonQuery('homeOwnerServiceRequests'), orderBy('createdAt', 'desc'), limit(5)), snapshot => {
                setRecentLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setLoading(false);
            }),
        ];
        setLoading(false);

        return () => unsubscribes.forEach(unsub => unsub && unsub());

    }, [recentlySelectedCompany, db]);

    const totalOneTimeSales = activeContracts.reduce((acc, contract) => acc + (contract.rate || 0), 0);
    const totalRecurringRevenue = recurringContracts.reduce((acc, contract) => acc + (contract.rate || 0), 0);

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
    }

    return (
        <div className="container mx-auto p-6 bg-gray-50 min-h-screen">
            <h1 className="text-3xl font-bold mb-6 text-gray-900">Sales Dashboard</h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard title="Active Leads" value={leadsCount} description="Ready to be assessed" linkTo="/company/leads" />
                <StatCard title="Pending Estimates" value={estimatesCount} description="Awaiting customer approval" linkTo="/company/estimates" />
                <StatCard title="Total One-Time Sales" value={`$${totalOneTimeSales.toLocaleString()}`} description={`${activeContracts.length} active contracts`} linkTo="/company/monies/contracts" />
                <StatCard title="Monthly Recurring Revenue" value={`$${totalRecurringRevenue.toLocaleString()}`} description={`${recurringContracts.length} recurring contracts`} linkTo="/company/monies/recurring-contracts" />
            </div>

            {/* Tables Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Recent Leads */}
                <div>
                    <h2 className="text-2xl font-bold mb-4">Recent Leads</h2>
                    <div className="bg-white shadow-md rounded-lg overflow-auto">
                        {recentLeads.length > 0 ? (
                            <table className="min-w-full leading-normal">
                                <thead>
                                    <tr>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Service</th>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Customer</th>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentLeads.map(lead => (
                                        <tr key={lead.id}>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{lead.serviceName}</p></td>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{lead.ownerDetails?.displayName || lead.homeownerName }</p></td>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{lead.createdAt ? format(lead.createdAt.toDate(), 'PPP') : 'N/A'}</p></td>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm text-right">
                                                <Link to={`/company/leads/${lead.id}`} className="text-blue-600 hover:underline">View</Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : <p className="p-6 text-gray-500">No recent leads.</p>}
                    </div>
                </div>

                {/* Recent Sales */}
                <div>
                    <h2 className="text-2xl font-bold mb-4">Recent Sales</h2>
                    <div className="bg-white shadow-md rounded-lg overflow-auto">
                        {activeContracts.length > 0 ? (
                             <table className="min-w-full leading-normal">
                                <thead>
                                    <tr>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Customer</th>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount</th>
                                        <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date Accepted</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeContracts.slice(0, 5).map(sale => (
                                        <tr key={sale.id}>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{sale.receiverName}</p></td>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">${sale.rate.toLocaleString()}</p></td>
                                            <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{sale.dateAccepted ? format(sale.dateAccepted.toDate(), 'PPP') : 'N/A'}</p></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : <p className="p-6 text-gray-500">No sales yet.</p>}
                    </div>
                </div>
            </div>

            {/* Active Recurring Contracts */}
            <div>
                <h2 className="text-2xl font-bold mb-4">Active Recurring Contracts</h2>
                <div className="bg-white shadow-md rounded-lg overflow-auto">
                    {recurringContracts.length > 0 ? (
                        <table className="min-w-full leading-normal">
                            <thead>
                                <tr>
                                    <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Customer</th>
                                    <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Monthly Rate</th>
                                    <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Start Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recurringContracts.map(contract => (
                                    <tr key={contract.id}>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{contract.customerName}</p></td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">${contract.rate.toLocaleString()}</p></td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm"><p className="text-gray-900 whitespace-no-wrap">{contract.startDate ? format(contract.startDate.toDate(), 'PPP') : 'N/A'}</p></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="p-6 text-gray-500">No recurring contracts yet.</p>}
                </div>
            </div>
        </div>
    );
};

export default Sales;
