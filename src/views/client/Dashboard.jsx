import React, { useContext, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Context } from '../../context/AuthContext';
import RecentChatsWidget from './Messages/RecentChatsWidget';
import {
    WrenchScrewdriverIcon,
    DocumentTextIcon,
    PlusCircleIcon,
    ExclamationTriangleIcon,
    HomeModernIcon,
    CreditCardIcon,
    ClipboardDocumentCheckIcon,
    ArrowRightIcon,
    CheckCircleIcon
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

const labelize = (value) => {
    if (!value) return 'Pending';
    return String(value)
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const isEstimateAgreement = (agreement = {}) => {
    const sourceType = normalizeSalesStatus(agreement.sourceType);
    const rateType = normalizeSalesStatus(agreement.rateType);
    const serviceCadence = normalizeSalesStatus(agreement.serviceCadence);

    return (
        sourceType === 'oneoffjob' ||
        sourceType === 'workoffer' ||
        sourceType === 'lead' ||
        rateType === 'onetime' ||
        serviceCadence === 'onetime'
    );
};

const agreementRecordLabel = (agreement = {}) => (
    isEstimateAgreement(agreement) ? 'Estimate' : 'Service Agreement'
);

const formatDate = (value) => {
    const millis = timestampMillis(value);
    if (!millis) return 'Not set';

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(millis));
};

const sortFreshest = (records = []) => (
    [...records].sort((left, right) => (
        timestampMillis(right.updatedAt || right.requestedAt || right.sentAt || right.createdAt || right.dueDate) -
        timestampMillis(left.updatedAt || left.requestedAt || left.sentAt || left.createdAt || left.dueDate)
    ))
);

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

const reviewStatusClass = (status) => {
    const normalizedStatus = normalizeSalesStatus(status);
    if (['accepted', 'approved', 'paid', 'active'].includes(normalizedStatus)) {
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    }
    if (['rejected', 'declined', 'canceled', 'expired', 'void'].includes(normalizedStatus)) {
        return 'border-rose-200 bg-rose-50 text-rose-700';
    }
    if (['sent', 'open', 'revised'].includes(normalizedStatus)) {
        return 'border-sky-200 bg-sky-50 text-sky-700';
    }
    return 'border-amber-200 bg-amber-50 text-amber-700';
};

const DashboardPanel = ({ children, className = '', expanded = false }) => (
    <section className={`flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6 ${expanded ? 'min-h-[430px]' : 'sm:min-h-[360px]'} ${className}`}>
        {children}
    </section>
);

const PanelHeader = ({ icon: Icon, iconClassName = 'text-blue-600', title, helper, actionTo, actionLabel }) => (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-100">
                <Icon className={`h-6 w-6 ${iconClassName}`} />
            </span>
            <div className="min-w-0">
                <h2 className="text-xl font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
            </div>
        </div>
        {actionTo && (
            <Link to={actionTo} className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-blue-700 hover:text-blue-900">
                {actionLabel || 'View'}
                <ArrowRightIcon className="h-4 w-4" />
            </Link>
        )}
    </div>
);

const EmptyState = ({ icon: Icon, title, body }) => (
    <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-slate-200 p-6 text-center">
        <Icon className="h-12 w-12 text-slate-300" />
        <p className="mt-3 font-semibold text-slate-700">{title}</p>
        {body && <p className="mt-1 text-sm text-slate-500">{body}</p>}
    </div>
);

const StatusBadge = ({ status }) => (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${reviewStatusClass(status)}`}>
        {labelize(status)}
    </span>
);

const invoiceBalanceCents = (invoice) => {
    if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;

    const total = Number(invoice.totalAmountCents || invoice.totalCents) || 0;
    const paid = Number(invoice.amountPaidCents) || 0;
    const writtenOff = Number(invoice.writeOffAmountCents) || 0;

    return Math.max(total - paid - writtenOff, 0);
};

const MyPoolSnapshot = ({ expanded = false }) => {
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
        <DashboardPanel expanded={expanded}>
            <PanelHeader
                icon={WrenchScrewdriverIcon}
                iconClassName="text-teal-600"
                title="My Pool Status"
                helper="Service location snapshots tied to this account."
                actionTo={locations.length > 0 ? "/client/my-pool" : "/client/my-pool/new"}
                actionLabel={locations.length > 0 ? 'View Pools' : 'Add Pool'}
            />
            <div className="flex-grow">
                {loading ? renderSkeleton() : locations.length > 0 ? (
                    <div className="space-y-4">
                        {locations.map(loc => (
                            <div key={loc.id} className="border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
                                <p className='font-bold text-slate-900'>{loc.name || loc.nickName || 'Service Location'}</p>
                                <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                                    {loc.address?.streetAddress || loc.address?.address1 || loc.addressLine1 || loc.serviceAddress || 'Address not set'}
                                </p>
                                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                                    <div>
                                        <span className="block text-xs font-bold uppercase text-slate-400">Last Service</span>
                                        <span className="font-semibold text-slate-700">{formatDate(loc.lastServiceDate || loc.lastServiceAt)}</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs font-bold uppercase text-slate-400">Next Service</span>
                                        <span className="font-semibold text-green-700">{formatDate(loc.nextServiceDate || loc.nextServiceAt)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon={HomeModernIcon}
                        title="You haven't added a pool yet."
                        body="Add your pool to get service updates."
                    />
                )}
            </div>
            <Link
                to={locations.length > 0 ? "/client/my-pool" : "/client/my-pool/new"}
                className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-teal-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-teal-700"
            >
                {locations.length > 0 ? 'View All Pools' : 'Add a New Pool'}
            </Link>
        </DashboardPanel>
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
            limit(4)
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
        <DashboardPanel>
            <PanelHeader
                icon={ExclamationTriangleIcon}
                iconClassName="text-red-600"
                title="Repair Requests"
                helper="Open repair work and customer-reported issues."
                actionTo="/client/repair-requests"
                actionLabel="View Requests"
            />
            <div className="flex-grow">
                {loading ? renderSkeleton() : requests.length > 0 ? (
                    <ul className="divide-y divide-slate-100">
                        {requests.map(req => (
                            <li key={req.id} className="py-4 first:pt-0 last:pb-0">
                                <Link to={`/client/repair-requests/${req.id}`} className="block rounded-md transition hover:bg-slate-50">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-900">{req.description || req.title || 'Repair Request'}</p>
                                            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{req.notes || req.problemDescription || 'Awaiting company review.'}</p>
                                        </div>
                                        <StatusBadge status={displayRepairRequestStatus(req.status)} />
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState icon={PlusCircleIcon} title="No outstanding repair requests." />
                )}
            </div>
            <Link to="/client/repair-requests/new" className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-red-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-700">
                {requests.length > 0 ? 'View All Requests' : 'Create New Request'}
            </Link>
        </DashboardPanel>
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
            setLoading(false);
        };

        const invoicesRef = collection(db, salesCollectionNames.invoices);
        return onSnapshot(
            query(invoicesRef, where('customerUserId', '==', user.uid)),
            publish,
            () => setLoading(false)
        );
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
        <DashboardPanel>
            <PanelHeader
                icon={CreditCardIcon}
                iconClassName="text-emerald-600"
                title="Finance"
                helper="Invoices, balances, and payment setup."
                actionTo="/client/finance"
                actionLabel="Open Finance"
            />
            <div className="flex-grow">
                {loading ? renderSkeleton() : invoices.length > 0 ? (
                    <div>
                        <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Open Balance</p>
                            <p className="mt-1 text-3xl font-bold text-emerald-900">{formatCurrency(openBalanceCents)}</p>
                        </div>
                        <ul className="divide-y divide-slate-100">
                            {invoices.map(invoice => (
                                <li key={invoice.id} className="py-3 first:pt-0 last:pb-0">
                                    <Link to={`/client/billing/invoices/${invoice.id}`} className="flex flex-col gap-2 rounded-md transition hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-900">{invoice.invoiceNumber || invoice.companyName || 'Invoice'}</p>
                                            <p className="mt-1 text-sm text-slate-500">{invoice.companyName || 'Pool company'} - {formatCurrency(invoiceBalanceCents(invoice))} balance</p>
                                        </div>
                                        <StatusBadge status={invoice.status || SalesInvoiceStatus.draft} />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <EmptyState icon={CreditCardIcon} title="No billing records yet." />
                )}
            </div>
            <Link to="/client/finance" className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700">
                View Finance
            </Link>
        </DashboardPanel>
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
                .slice(0, 4);
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
        <DashboardPanel>
            <PanelHeader
                icon={DocumentTextIcon}
                iconClassName="text-blue-600"
                title="Service Requests"
                helper="Requests you have sent to pool companies."
                actionTo="/client/service-requests"
                actionLabel="View Requests"
            />
            <div className="flex-grow">
                {loading ? renderSkeleton() : requests.length > 0 ? (
                    <ul className="divide-y divide-slate-100">
                        {requests.map(req => (
                            <li key={req.id} className="py-4 first:pt-0 last:pb-0">
                                <Link to={`/client/service-requests/${req.id}`} className="block rounded-md transition hover:bg-slate-50">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-900">{req.companyName || 'Service Request'}</p>
                                            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{req.serviceDescription || req.description || 'Request details are available in the full view.'}</p>
                                        </div>
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${serviceRequestStatusClass(req.status)}`}>
                                            {serviceRequestStatusText(req.status)}
                                        </span>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState icon={PlusCircleIcon} title="You haven't made any service requests yet." />
                )}
            </div>
            <Link
                to={requests.length > 0 ? "/client/service-requests" : "/client/companies"}
                className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
            >
                {requests.length > 0 ? 'View All Requests' : 'Browse Companies'}
            </Link>
        </DashboardPanel>
    );
};

const ApprovalsAndEstimatesWidget = () => {
    const { user } = useContext(Context);
    const [approvals, setApprovals] = useState([]);
    const [agreements, setAgreements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) {
            setApprovals([]);
            setAgreements([]);
            setLoading(false);
            return undefined;
        }

        setLoading(true);
        let firstSnapshotsRemaining = 2;
        const markLoaded = () => {
            firstSnapshotsRemaining -= 1;
            if (firstSnapshotsRemaining <= 0) setLoading(false);
        };

        const approvalsUnsubscribe = onSnapshot(
            query(collection(db, 'customerPartApprovals'), where('customerUserId', '==', user.uid)),
            (snapshot) => {
                setApprovals(sortFreshest(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))).slice(0, 5));
                markLoaded();
            },
            () => {
                setApprovals([]);
                markLoaded();
            }
        );

        const agreementsUnsubscribe = onSnapshot(
            query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', user.uid)),
            (snapshot) => {
                setAgreements(sortFreshest(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))).slice(0, 5));
                markLoaded();
            },
            () => {
                setAgreements([]);
                markLoaded();
            }
        );

        return () => {
            approvalsUnsubscribe();
            agreementsUnsubscribe();
        };
    }, [user]);

    const pendingApprovals = approvals.filter((approval) => normalizeSalesStatus(approval.status || approval.approvalStatus) === 'pending');
    const pendingAgreements = agreements.filter((agreement) => ['sent', 'revised', 'draft'].includes(normalizeSalesStatus(agreement.status)));
    const reviewItems = sortFreshest([
        ...pendingApprovals.map((approval) => ({
            id: `approval-${approval.id}`,
            type: 'Part Approval',
            title: approval.itemName || approval.name || approval.dbItemName || 'Pool Part',
            subtitle: approval.description || approval.jobInternalId || approval.serviceLocationName || 'Approve, reject, and choose a billing preference.',
            companyName: approval.companyName || 'Pool company',
            amountCents: approval.plannedTotalPriceCents || approval.totalPriceCents || 0,
            status: approval.status || approval.approvalStatus || 'pending',
            to: `/client/part-approvals/${approval.id}`,
            updatedAt: approval.updatedAt || approval.requestedAt || approval.createdAt,
        })),
        ...pendingAgreements.map((agreement) => ({
            id: `agreement-${agreement.id}`,
            type: agreementRecordLabel(agreement),
            title: agreement.title || agreementRecordLabel(agreement),
            subtitle: agreement.description || 'Review the scope, approve or decline, and choose how billing should happen.',
            companyName: agreement.companyName || 'Pool company',
            amountCents: agreement.totalAmountCents || agreement.rateAmountCents || 0,
            status: agreement.status || SalesAgreementStatus.sent,
            to: `/client/service-agreements/${agreement.id}`,
            updatedAt: agreement.updatedAt || agreement.sentAt || agreement.createdAt,
        })),
    ]).slice(0, 6);
    const approvedCount = approvals.filter((approval) => normalizeSalesStatus(approval.status || approval.approvalStatus) === 'approved').length;
    const acceptedCount = agreements.filter((agreement) => normalizeSalesStatus(agreement.status) === normalizeSalesStatus(SalesAgreementStatus.accepted)).length;
    const totalReviewValueCents = reviewItems.reduce((total, item) => total + Number(item.amountCents || 0), 0);

    return (
        <DashboardPanel expanded>
            <PanelHeader
                icon={ClipboardDocumentCheckIcon}
                iconClassName="text-indigo-600"
                title="Approvals & Estimates"
                helper="Review parts, estimates, and service agreements from connected companies."
                actionTo="/client/finance"
                actionLabel="Finance Hub"
            />

            <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-bold uppercase text-amber-700">Needs Review</p>
                    <p className="mt-1 text-2xl font-bold text-amber-950">{reviewItems.length}</p>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-bold uppercase text-emerald-700">Accepted</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-950">{approvedCount + acceptedCount}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase text-slate-500">Review Value</p>
                    <p className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(totalReviewValueCents)}</p>
                </div>
            </div>

            <div className="flex-1">
                {loading ? (
                    <div className="space-y-3 animate-pulse">
                        <div className="h-16 rounded-md bg-slate-100"></div>
                        <div className="h-16 rounded-md bg-slate-100"></div>
                        <div className="h-16 rounded-md bg-slate-100"></div>
                    </div>
                ) : reviewItems.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                        {reviewItems.map((item) => (
                            <Link key={item.id} to={item.to} className="block py-4 first:pt-0 last:pb-0">
                                <div className="flex flex-col gap-3 rounded-md transition hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{item.type}</span>
                                            <StatusBadge status={item.status} />
                                        </div>
                                        <p className="mt-2 text-base font-bold text-slate-950">{item.title}</p>
                                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.companyName} - {item.subtitle}</p>
                                    </div>
                                    <div className="shrink-0 text-left sm:text-right">
                                        <p className="text-lg font-bold text-slate-950">{formatCurrency(item.amountCents)}</p>
                                        <p className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-blue-700">
                                            Review
                                            <ArrowRightIcon className="h-4 w-4" />
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon={CheckCircleIcon}
                        title="Nothing needs approval right now."
                        body="New part approvals, estimates, and service agreements will appear here."
                    />
                )}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Link to="/client/part-approvals" className="inline-flex items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-100">
                    Part Approvals
                </Link>
                <Link to="/client/service-agreements" className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100">
                    Estimates
                </Link>
            </div>
        </DashboardPanel>
    );
};


const ClientDashboard = () => {
    const { name, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
    const messagesEnabled = featureFlagsLoaded && isFeatureEnabled('feature_flag_001');

    return (
        <div className='w-full min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8'>
            <div className="mx-auto w-full max-w-7xl space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Client Dashboard</p>
                    <h1 className="mt-2 text-2xl font-bold text-slate-950 sm:text-4xl">Welcome, {name || 'there'}.</h1>
                    <p className="mt-2 max-w-3xl text-base text-slate-600">
                        Review company updates, approve work, and keep billing decisions in one place.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(380px,0.85fr)]">
                    <ApprovalsAndEstimatesWidget />
                    <MyPoolSnapshot expanded />
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                    <BillingWidget />
                    <ServiceRequestsWidget />
                    <RepairRequestsWidget />
                </div>

                {messagesEnabled && <RecentChatsWidget />}
            </div>
        </div>
    );
};

export default ClientDashboard;
