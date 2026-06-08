import React, { useContext, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Context } from '../../context/AuthContext';
import RecentChatsWidget from './Messages/RecentChatsWidget';
import {
    BuildingStorefrontIcon,
    WrenchScrewdriverIcon,
    DocumentTextIcon,
    PlusCircleIcon,
    ExclamationTriangleIcon,
    HomeModernIcon,
    CreditCardIcon
} from '@heroicons/react/24/outline';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../../utils/config';
import { SalesAgreementStatus, SalesInvoiceStatus, salesCollectionNames } from '../../utils/models/Sales';
import {
    REPAIR_REQUEST_STATUS,
    displayRepairRequestStatus,
} from '../../utils/models/RepairRequest';

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const normalizeSalesStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const timestampMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
};

const serviceRequestStatusText = (status) => String(status || 'Pending');

const serviceRequestStatusClass = (status) => {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (['completed', 'complete', 'approved', 'accepted'].includes(normalizedStatus)) {
        return 'text-green-600 bg-green-100';
    }
    if (['cancelled', 'canceled', 'declined', 'rejected'].includes(normalizedStatus)) {
        return 'text-red-600 bg-red-100';
    }
    return 'text-yellow-600 bg-yellow-100';
};

const invoiceBalanceCents = (invoice) => {
    if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;

    const total = Number(invoice.totalAmountCents || invoice.totalCents) || 0;
    const paid = Number(invoice.amountPaidCents) || 0;
    const writtenOff = Number(invoice.writeOffAmountCents) || 0;

    return Math.max(total - paid - writtenOff, 0);
};

const MyPoolSnapshot = () => {
    const { user } = useContext(Context);
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const locationsRef = collection(db, 'homeownerServiceLocations');
        const q = query(locationsRef, where('userId', '==', user.uid), limit(2));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedLocations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLocations(fetchedLocations);
            setLoading(false);
        }, () => {
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="space-y-4 animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-3/4"></div>
            <div className="h-12 bg-gray-200 rounded-lg"></div>
            <div className="h-12 bg-gray-200 rounded-lg"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <WrenchScrewdriverIcon className="w-8 h-8 text-teal-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">My Pool Status</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : locations.length > 0 ? (
                    <div className="space-y-4">
                        {locations.map(loc => (
                            <div key={loc.id} className="p-3 bg-gray-50 rounded-lg">
                                <p className='font-bold text-gray-800 mb-2 truncate'>{loc.name}</p>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-semibold text-gray-600">Last Service:</span>
                                    <span className="font-bold text-gray-700">June 15, 2024</span>
                                </div>
                                <div className="flex items-center justify-between text-sm mt-1">
                                    <span className="font-semibold text-gray-600">Next Service:</span>
                                    <span className="font-bold text-green-600">June 22, 2024</span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <HomeModernIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500 font-medium">You haven't added a pool yet.</p>
                        <p className="text-sm text-gray-400">Add your pool to get service updates.</p>
                    </div>
                )}
            </div>
            <Link
                to={locations.length > 0 ? "/client/my-pool" : "/client/my-pool/new"}
                className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-teal-600 hover:bg-teal-700 transition-colors"
            >
                {locations.length > 0 ? 'View All Pools' : 'Add a New Pool'}
            </Link>
        </div>
    );
};

const RepairRequestsWidget = () => {
    const { user } = useContext(Context);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }
        console.log("Getting Repair Requsts")
        const requestsRef = collection(db, 'homeownerRepairRequests');
        const q = query(
            requestsRef,
            where('userId', '==', user.uid),
            where('status', 'in', [
                REPAIR_REQUEST_STATUS.UNRESOLVED,
                REPAIR_REQUEST_STATUS.LEGACY_PENDING,
                'Pending',
            ]),
            orderBy('createdAt', 'desc'),
            limit(3)
        );
        console.log("Got Repair Requsts")

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedRequests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRequests(fetchedRequests);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <ExclamationTriangleIcon className="w-8 h-8 text-red-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Repair Requests</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : requests.length > 0 ? (
                    <ul className="space-y-3">
                        {requests.map(req => (
                            <li key={req.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                <p className="text-gray-700 font-medium truncate">{req.description}</p>
                                <span className="text-sm font-semibold text-yellow-600 bg-yellow-100 px-2 py-1 rounded-full">{displayRepairRequestStatus(req.status)}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <PlusCircleIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">No outstanding repair requests.</p>
                    </div>
                )}
            </div>
            <Link to="/client/repair-requests/new" className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 transition-colors">
                {requests.length > 0 ? 'View All Requests' : 'Create New Request'}
            </Link>
        </div>
    );
};

const ServiceAgreementsWidget = () => {
    const { user } = useContext(Context);
    const [agreements, setAgreements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }
        const agreementsRef = collection(db, salesCollectionNames.agreements);
        const q = query(
            agreementsRef,
            where('customerUserId', '==', user.uid),
            limit(3)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedAgreements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAgreements(fetchedAgreements);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <DocumentTextIcon className="w-8 h-8 text-indigo-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Service Agreements</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : agreements.length > 0 ? (
                    <ul className="space-y-3">
                        {agreements.map(agreement => (
                            <li key={agreement.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                <p className="text-gray-700 font-medium truncate">{agreement.companyName || agreement.title || 'Service Agreement'}</p>
                                <span className="text-sm font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full">
                                    {agreement.status || SalesAgreementStatus.draft}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <BuildingStorefrontIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">You have no service agreements yet.</p>
                    </div>
                )}
            </div>
            <Link to={agreements.length > 0 ? "/client/service-agreements" : "/client/companies"} className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors">
                {agreements.length > 0 ? 'View Agreements' : 'Browse Companies'}
            </Link>
        </div>
    );
};

const BillingWidget = () => {
    const { user } = useContext(Context);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return undefined;
        }

        const invoiceMap = new Map();
        let firstSnapshotsRemaining = user.email ? 2 : 1;

        const publish = (snapshot) => {
            snapshot.docs.forEach(doc => {
                invoiceMap.set(doc.id, { id: doc.id, ...doc.data() });
            });

            const fetchedInvoices = Array.from(invoiceMap.values()).sort((left, right) => {
                const rightMillis = right.updatedAt?.toMillis?.() || right.createdAt?.toMillis?.() || 0;
                const leftMillis = left.updatedAt?.toMillis?.() || left.createdAt?.toMillis?.() || 0;
                return rightMillis - leftMillis;
            });

            setInvoices(fetchedInvoices.slice(0, 3));
            firstSnapshotsRemaining -= 1;
            if (firstSnapshotsRemaining <= 0) setLoading(false);
        };

        const invoicesRef = collection(db, salesCollectionNames.invoices);
        const unsubscribes = [
            onSnapshot(
                query(invoicesRef, where('customerUserId', '==', user.uid)),
                publish,
                () => setLoading(false)
            ),
        ];

        if (user.email) {
            unsubscribes.push(
                onSnapshot(
                    query(invoicesRef, where('email', '==', user.email)),
                    publish,
                    () => setLoading(false)
                )
            );
        }

        return () => unsubscribes.forEach(unsubscribe => unsubscribe());
    }, [user]);

    const openInvoices = invoices.filter(invoice => (
        invoiceBalanceCents(invoice) > 0 &&
        !['paid', 'void', 'uncollectible'].includes(normalizeSalesStatus(invoice.status))
    ));
    const openBalanceCents = openInvoices.reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);

    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <CreditCardIcon className="w-8 h-8 text-emerald-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Billing</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : invoices.length > 0 ? (
                    <div>
                        <div className="mb-4 rounded-lg bg-emerald-50 p-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Open Balance</p>
                            <p className="mt-1 text-2xl font-bold text-emerald-900">{formatCurrency(openBalanceCents)}</p>
                        </div>
                        <ul className="space-y-3">
                            {invoices.map(invoice => (
                                <li key={invoice.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                    <p className="text-gray-700 font-medium truncate">{invoice.invoiceNumber || invoice.companyName || 'Invoice'}</p>
                                    <span className="text-sm font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                                        {invoice.status || SalesInvoiceStatus.draft}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <CreditCardIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">No billing records yet.</p>
                    </div>
                )}
            </div>
            <Link to="/client/billing" className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors">
                View Billing
            </Link>
        </div>
    );
};

const ServiceRequestsWidget = () => {
    const { user } = useContext(Context);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const requestsRef = collection(db, 'homeownerServiceRequests');
        const q = query(
            requestsRef,
            where('homeownerId', '==', user.uid)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedRequests = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt))
                .slice(0, 3);
            setRequests(fetchedRequests);
            setLoading(false);
        }, () => setLoading(false));

        return () => unsubscribe();
    }, [user]);

    const renderSkeleton = () => (
        <div className="space-y-3 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded-lg mt-4"></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col h-full">
            <div className="flex items-center mb-4">
                <DocumentTextIcon className="w-8 h-8 text-blue-500 mr-3" />
                <h3 className="text-xl font-bold text-gray-800">Service Requests</h3>
            </div>
            <div className="flex-grow">
                {loading ? renderSkeleton() : requests.length > 0 ? (
                    <ul className="space-y-3">
                        {requests.map(req => (
                            <li key={req.id}>
                                <Link to={`/client/service-requests/${req.id}`} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg hover:bg-blue-50 transition-colors">
                                    <p className="text-gray-700 font-medium truncate">{req.companyName || 'Service Request'}</p>
                                    <span className={`text-sm font-semibold px-2 py-1 rounded-full ${serviceRequestStatusClass(req.status)}`}>
                                        {serviceRequestStatusText(req.status)}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center flex flex-col items-center justify-center h-full">
                        <PlusCircleIcon className="w-16 h-16 text-gray-300 mb-2" />
                        <p className="text-gray-500">You haven't made any service requests yet.</p>
                    </div>
                )}
            </div>
            <Link
                to={requests.length > 0 ? "/client/service-requests" : "/client/companies"}
                className="block w-full text-center mt-6 text-white font-semibold py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
            >
                {requests.length > 0 ? 'View All Requests' : 'Browse Companies'}
            </Link>
        </div>
    );
};


const ClientDashboard = () => {
    const { name } = useContext(Context);

    return (
        <div className='w-full min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
            <div className="w-full max-w-6xl mx-auto">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-800 mb-2">Welcome, {name}!</h1>
                    <p className="text-lg text-gray-600">Here's a quick overview of your account.</p>
                </div>

                {/* Top Widgets Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    <div className="lg:col-span-2">
                        <RecentChatsWidget />
                    </div>
                    <div>
                        <MyPoolSnapshot />
                    </div>
                </div>

                {/* Mid Widgets Section */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-12">
                    <RepairRequestsWidget />
                    <ServiceAgreementsWidget />
                    <BillingWidget />
                    <ServiceRequestsWidget />
                </div>
            </div>
        </div>
    );
};

export default ClientDashboard;
