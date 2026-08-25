
import React, { useState, useEffect, useContext } from 'react';
import { collection, doc, getDoc, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import CompanySummaryCard, { getCompanySummary } from './CompanySummaryCard';

const dateFromFirestore = (value) => {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value.seconds) return new Date(value.seconds * 1000);
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const statusClassFor = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'pending') return 'bg-yellow-100 text-yellow-800';
    if (normalized === 'approved' || normalized === 'completed' || normalized === 'in progress') return 'bg-green-100 text-green-800';
    if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'declined' || normalized === 'rejected') return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-700';
};

const formatRequestDate = (request) => {
    const date = dateFromFirestore(request.createdAt || request.dateCreated);
    return date ? date.toLocaleDateString() : 'N/A';
};

const requestCompanyFallback = (request) => getCompanySummary({
    ...request.companySummary,
    id: request.companyId,
    name: request.companyName,
});

const ServiceRequests = () => {
    const { user } = useContext(Context);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const requestsRef = collection(db, 'homeownerServiceRequests');
        const q = query(requestsRef, where('homeownerId', '==', user.uid));
        let isActive = true;

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            if (snapshot.empty) {
                if (isActive) {
                    setRequests([]);
                    setLoading(false);
                }
                return;
            }

            const requestsData = snapshot.docs.map(snapshotDoc => ({
                id: snapshotDoc.id,
                ...snapshotDoc.data(),
            }));

            const companyIds = [...new Set(requestsData.map(request => request.companyId).filter(Boolean))];
            const companyEntries = await Promise.all(companyIds.map(async (companyId) => {
                try {
                    const companySnap = await getDoc(doc(db, 'companies', companyId));
                    if (companySnap.exists()) {
                        return [companyId, { id: companySnap.id, ...companySnap.data() }];
                    }
                } catch (companyError) {
                    console.error("Error fetching company for service request list:", companyError);
                }
                return [companyId, null];
            }));
            const companiesById = new Map(companyEntries);
            const requestsWithCompanies = requestsData.map(request => ({
                ...request,
                company: companiesById.get(request.companyId) || requestCompanyFallback(request),
            }));

            if (isActive) {
                setRequests(requestsWithCompanies);
                setLoading(false);
            }
        }, (err) => {
            console.error("Snapshot listener error: ", err);
            if (isActive) {
                setError('Failed to listen for real-time updates.');
                setLoading(false);
            }
        });

        return () => {
            isActive = false;
            unsubscribe();
        };
    }, [user]);

    const handleRequestClick = (requestId) => {
        navigate(`/client/service-requests/${requestId}`);
    };

    if (loading) {
        return <div className="p-8">Loading your service requests...</div>;
    }

    if (error) {
        return <div className="p-8 text-red-500">Error: {error}</div>;
    }

    return (
        <div className="px-4 py-6 bg-gray-50 min-h-screen md:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">My Service Requests</h1>
                    <p className="mt-1 text-base text-gray-600 sm:text-lg">Track the status of all your service requests.</p>
                </div>

                {requests.length === 0 ? (
                    <div className="text-center bg-white p-6 rounded-lg shadow-md sm:p-12">
                        <h3 className="text-xl font-medium text-gray-900">No requests found</h3>
                        <p className="mt-1 text-sm text-gray-500">You haven't made any service requests yet.</p>
                        <button
                            onClick={() => navigate('/client/companies')}
                            className="mt-6 inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                            Browse Companies to Get Started
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="space-y-3 md:hidden">
                            {requests.map(request => {
                                const company = getCompanySummary({
                                    ...request.company,
                                    id: request.company?.id || request.companyId || request.company?.companyId || '',
                                });

                                return (
                                    <button
                                        key={request.id}
                                        type="button"
                                        onClick={() => handleRequestClick(request.id)}
                                        className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:bg-gray-50"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="break-words font-semibold text-gray-900">{company.name}</p>
                                                <p className="mt-1 text-sm text-gray-500">Requested {formatRequestDate(request)}</p>
                                            </div>
                                            <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClassFor(request.status)}`}>
                                                {request.status || 'Pending'}
                                            </span>
                                        </div>
                                        <span className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white">
                                            View Request
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="hidden overflow-x-auto rounded-lg bg-white shadow-md md:block">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                        <th scope="col" className="relative px-6 py-3">
                                            <span className="sr-only">View</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {requests.map(request => (
                                        <tr key={request.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                                <CompanySummaryCard
                                                    company={request.company}
                                                    companyId={request.companyId}
                                                    compact
                                                />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatRequestDate(request)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClassFor(request.status)}`}>
                                                    {request.status || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <button onClick={() => handleRequestClick(request.id)} className="text-blue-600 hover:text-blue-900">View</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ServiceRequests;
