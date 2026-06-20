import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import {
    BriefcaseIcon,
    CalendarDaysIcon,
    MapIcon,
    WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import {
    FaArrowRight,
    FaCheckCircle,
    FaRoute,
    FaSwimmingPool,
    FaSyncAlt,
} from 'react-icons/fa';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { SalesAgreementSourceType, salesCollectionNames } from '../../../utils/models/Sales';
import { isOpenRepairRequestStatus } from '../../../utils/models/RepairRequest';

const activeJobStatuses = ["Estimate Pending", "Unscheduled", "Scheduled", "In Progress"];
const acceptedStatuses = new Set(["accepted", "active", "trialing"]);
const needsSchedulingStatuses = new Set(["unscheduled", "estimatepending"]);

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
    const millis = toMillis(value);
    if (!millis) return 'Not set';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(millis));
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const startOfToday = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const endOfToday = () => {
    const date = startOfToday();
    date.setDate(date.getDate() + 1);
    return date;
};

const sortFresh = (records) => (
    [...records].sort((left, right) => (
        toMillis(right.serviceDate || right.dateCreated || right.requestDate || right.createdAt || right.updatedAt)
        - toMillis(left.serviceDate || left.dateCreated || left.requestDate || left.createdAt || left.updatedAt)
    ))
);

const StatTile = ({ icon: Icon, label, value, helper, to, tone = 'slate' }) => {
    const tones = {
        slate: 'bg-slate-100 text-slate-600',
        blue: 'bg-blue-50 text-blue-700',
        emerald: 'bg-emerald-50 text-emerald-700',
        amber: 'bg-amber-50 text-amber-700',
        rose: 'bg-rose-50 text-rose-700',
    };

    const content = (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
                </div>
                <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
                    <Icon className="h-5 w-5" />
                </span>
            </div>
            {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
        </div>
    );

    return to ? <Link to={to}>{content}</Link> : content;
};

const StatGroup = ({ title, helper, children }) => (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
                <h2 className="text-lg font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
            </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {children}
        </div>
    </section>
);

const ListCard = ({ title, helper, to, children }) => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
                <h2 className="text-lg font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
            </div>
            {to && <Link to={to} className="text-xs font-semibold text-blue-700 hover:text-blue-900">View all</Link>}
        </div>
        <div className="divide-y divide-slate-100">{children}</div>
    </section>
);

const EmptyRow = ({ children }) => <div className="p-5 text-sm text-slate-500">{children}</div>;

const StatusPill = ({ children, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-700',
        blue: 'border-blue-200 bg-blue-50 text-blue-700',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        rose: 'border-rose-200 bg-rose-50 text-rose-700',
    };

    return (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const OperationsDashboard = () => {
    const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
    const [loading, setLoading] = useState(true);
    const [jobs, setJobs] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [equipmentDue, setEquipmentDue] = useState([]);
    const [serviceStopsToday, setServiceStopsToday] = useState([]);
    const [recurringServiceStops, setRecurringServiceStops] = useState([]);
    const [serviceAgreements, setServiceAgreements] = useState([]);
    const [billingSubscriptions, setBillingSubscriptions] = useState([]);
    const [legacyContracts, setLegacyContracts] = useState([]);

    useEffect(() => {
        if (!recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            try {
                const todayStart = Timestamp.fromDate(startOfToday());
                const todayEnd = Timestamp.fromDate(endOfToday());
                const [
                    jobsSnap,
                    internalRepairsSnap,
                    externalRepairsSnap,
                    routesSnap,
                    equipmentSnap,
                    serviceStopsSnap,
                    recurringStopsSnap,
                    agreementsSnap,
                    billingSubscriptionsSnap,
                    contractsSnap,
                ] = await Promise.all([
                    getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'workOrders'), where('operationStatus', 'in', activeJobStatuses))),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'repairRequests')),
                    getDocs(query(collection(db, 'homeownerRepairRequests'), where('companyId', '==', recentlySelectedCompany))),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes')),
                    getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'equipment'), where('nextServiceDate', '<=', Timestamp.now()))),
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                        where('serviceDate', '>=', todayStart),
                        where('serviceDate', '<', todayEnd)
                    )),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop')),
                    getDocs(query(collection(db, salesCollectionNames.agreements), where('companyId', '==', recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.billingSubscriptions), where('companyId', '==', recentlySelectedCompany))),
                    getDocs(query(collection(db, 'contracts'), where('senderId', '==', recentlySelectedCompany))),
                ]);

                setJobs(jobsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRepairRequests([
                    ...internalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'internal', ...itemDoc.data() })),
                    ...externalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'external', ...itemDoc.data() })),
                ]);
                setRoutes(routesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setEquipmentDue(equipmentSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setServiceStopsToday(serviceStopsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRecurringServiceStops(recurringStopsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setServiceAgreements(agreementsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setBillingSubscriptions(billingSubscriptionsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setLegacyContracts(contractsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
            } catch (error) {
                console.error("Error fetching operations dashboard data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [recentlySelectedCompany]);

    const openRepairs = useMemo(() => repairRequests.filter((request) => (
        isOpenRepairRequestStatus(request.status)
    )), [repairRequests]);

    const jobBuckets = useMemo(() => {
        const buckets = activeJobStatuses.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
        jobs.forEach((job) => {
            const status = job.operationStatus || 'Unscheduled';
            buckets[status] = (buckets[status] || 0) + 1;
        });
        return buckets;
    }, [jobs]);

    const upcomingJobs = useMemo(() => sortFresh(jobs).slice(0, 8), [jobs]);
    const recentRepairs = useMemo(() => sortFresh(openRepairs).slice(0, 6), [openRepairs]);
    const dueEquipment = useMemo(() => sortFresh(equipmentDue).slice(0, 6), [equipmentDue]);
    const billingSubscriptionByAgreementId = useMemo(() => {
        const map = new Map();
        billingSubscriptions.forEach((subscription) => {
            if (subscription.agreementId) map.set(subscription.agreementId, subscription);
        });
        return map;
    }, [billingSubscriptions]);

    const recurringStopsByServiceLocation = useMemo(() => {
        const set = new Set();
        recurringServiceStops.forEach((stop) => {
            if (stop.serviceLocationId) set.add(stop.serviceLocationId);
        });
        return set;
    }, [recurringServiceStops]);

    const recurringStopsByCustomer = useMemo(() => {
        const set = new Set();
        recurringServiceStops.forEach((stop) => {
            if (stop.customerId) set.add(stop.customerId);
        });
        return set;
    }, [recurringServiceStops]);

    const agreementsNeedRouting = useMemo(() => serviceAgreements
        .filter((agreement) => {
            const status = normalizeStatus(agreement.status);
            const sourceType = agreement.sourceType || '';
            const isJobAgreement =
                sourceType === SalesAgreementSourceType.oneOffJob ||
                agreement.rateType === 'oneTime' ||
                agreement.serviceCadence === 'oneTime' ||
                Boolean(agreement.jobId || agreement.workOrderId);
            if (status !== 'accepted' || isJobAgreement) return false;

            const serviceLocationIds = Array.isArray(agreement.serviceLocationIds)
                ? agreement.serviceLocationIds.filter(Boolean)
                : [];
            const hasLocationMatch = serviceLocationIds.some((serviceLocationId) => recurringStopsByServiceLocation.has(serviceLocationId));
            const hasCustomerFallbackMatch = serviceLocationIds.length === 0 && agreement.customerId && recurringStopsByCustomer.has(agreement.customerId);

            return !agreement.recurringServiceStopId && !hasLocationMatch && !hasCustomerFallbackMatch;
        })
        .map((agreement) => ({
            ...agreement,
            billingSubscription: billingSubscriptionByAgreementId.get(agreement.id) || null,
        }))
        .sort((left, right) => toMillis(right.acceptedAt || right.updatedAt || right.createdAt) - toMillis(left.acceptedAt || left.updatedAt || left.createdAt))
        .slice(0, 8), [billingSubscriptionByAgreementId, recurringStopsByCustomer, recurringStopsByServiceLocation, serviceAgreements]);

    const acceptedEstimatesNeedScheduling = useMemo(() => {
        const acceptedJobRows = jobs
            .filter((job) => acceptedStatuses.has(normalizeStatus(job.billingStatus)))
            .filter((job) => needsSchedulingStatuses.has(normalizeStatus(job.operationStatus)))
            .map((job) => ({
                id: job.id,
                title: job.internalId || job.description || 'Accepted job estimate',
                customerName: job.customerName || 'Customer',
                status: job.operationStatus || 'Unscheduled',
                updatedAt: job.updatedAt || job.dateCreated,
                to: `/company/jobs/detail/${job.id}`,
                source: 'Job',
            }));

        const acceptedContractRows = legacyContracts
            .filter((contract) => acceptedStatuses.has(normalizeStatus(contract.status)))
            .filter((contract) => !contract.jobId)
            .map((contract) => ({
                id: contract.id,
                title: contract.title || contract.notes || 'Accepted estimate',
                customerName: contract.customerName || contract.receiverName || 'Customer',
                status: contract.status || 'Accepted',
                updatedAt: contract.dateAccepted || contract.updatedAt || contract.dateSent,
                to: contract.leadId ? `/company/leads/${contract.leadId}` : `/company/contract/detail/${contract.id}`,
                source: contract.leadId ? 'Lead' : 'Contract',
            }));

        return sortFresh([...acceptedJobRows, ...acceptedContractRows]).slice(0, 8);
    }, [jobs, legacyContracts]);

    if (loading) {
        return <div className="min-h-screen bg-slate-50 px-2 py-6 text-sm text-slate-500 sm:px-3 lg:px-4">Loading operations dashboard...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || 'Selected company'}</p>
                            <h1 className="mt-2 text-3xl font-bold text-slate-950">Operations Dashboard</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                Jobs, routes, repair requests, recurring stops, equipment due, and scheduling handoffs.
                            </p>
                        </div>
                        <Link to="/company/recurring-service-stops/create" className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
                            New Recurring Service Stop
                        </Link>
                    </div>
                </section>

                <StatGroup title="Actionable" helper="Work that needs someone to make a decision, route, schedule, or repair.">
                    <StatTile icon={WrenchScrewdriverIcon} label="Open Repairs" value={openRepairs.length} helper="Internal and homeowner requests" to="/company/repair-requests" tone="rose" />
                    <StatTile icon={FaSwimmingPool} label="Equipment Due" value={equipmentDue.length} helper="Maintenance due now" to="/company/equipment" tone="amber" />
                    <StatTile icon={FaRoute} label="Needs Routing" value={agreementsNeedRouting.length} helper="Accepted service agreements" to="/company/sales/agreements" tone="amber" />
                    <StatTile icon={CalendarDaysIcon} label="Estimates To Schedule" value={acceptedEstimatesNeedScheduling.length} helper="Accepted estimates" to="/company/jobs" tone="amber" />
                </StatGroup>

                <StatGroup title="Informative" helper="Current operating volume and route context.">
                    <StatTile icon={BriefcaseIcon} label="Active Jobs" value={jobs.length} helper="Open operational work" to="/company/jobs" tone="amber" />
                    <StatTile icon={FaSyncAlt} label="Recurring Service Stops" value={recurringServiceStops.length} helper="Active recurring service templates" to="/company/recurringServiceStop" tone="emerald" />
                    <StatTile icon={CalendarDaysIcon} label="Stops Today" value={serviceStopsToday.length} helper="Scheduled service stops" to="/company/route-day-management" tone="blue" />
                    <StatTile icon={MapIcon} label="Routes" value={routes.length} helper="Recurring route templates" to="/company/route-dashboard" tone="blue" />
                    <StatTile icon={FaCheckCircle} label="In Progress" value={jobBuckets["In Progress"] || 0} helper="Jobs actively underway" to="/company/jobs" tone="emerald" />
                </StatGroup>

                <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-4">
                        <ListCard title="Job Flow" helper="Operational statuses at a glance" to="/company/jobs">
                            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
                                {activeJobStatuses.map((status) => (
                                    <div key={status} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-2xl font-bold text-slate-950">{jobBuckets[status] || 0}</p>
                                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{status}</p>
                                    </div>
                                ))}
                            </div>
                        </ListCard>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <ListCard title="Needs Routing" helper="Accepted service agreements without a recurring stop match" to="/company/recurringServiceStop">
                                {agreementsNeedRouting.length === 0 ? (
                                    <EmptyRow>No accepted service agreements waiting on recurring routing.</EmptyRow>
                                ) : agreementsNeedRouting.map((agreement) => {
                                    const subscriptionStatus = agreement.billingSubscription?.stripeStatus || agreement.billingSubscription?.status || agreement.billingFlowStatus || 'accepted';

                                    return (
                                        <Link key={agreement.id} to={`/company/sales/agreements/${agreement.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold text-slate-900">{agreement.title || 'Service Agreement'}</p>
                                                    <p className="mt-1 text-sm text-slate-500">{agreement.customerName || 'Customer'}</p>
                                                    <p className="mt-1 text-xs text-slate-400">{formatDate(agreement.acceptedAt || agreement.updatedAt)}</p>
                                                </div>
                                                <StatusPill tone={acceptedStatuses.has(normalizeStatus(subscriptionStatus)) ? 'emerald' : 'amber'}>
                                                    {subscriptionStatus}
                                                </StatusPill>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </ListCard>

                            <ListCard title="Accepted Estimates To Schedule" helper="Accepted work that still needs a date or route" to="/company/jobs">
                                {acceptedEstimatesNeedScheduling.length === 0 ? (
                                    <EmptyRow>No accepted estimates waiting to be scheduled.</EmptyRow>
                                ) : acceptedEstimatesNeedScheduling.map((estimate) => (
                                    <Link key={`${estimate.source}-${estimate.id}`} to={estimate.to} className="block px-5 py-4 transition hover:bg-slate-50">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-slate-900">{estimate.title}</p>
                                                <p className="mt-1 text-sm text-slate-500">{estimate.customerName}</p>
                                                <p className="mt-1 text-xs text-slate-400">{estimate.source} - {formatDate(estimate.updatedAt)}</p>
                                            </div>
                                            <StatusPill tone="amber">{estimate.status}</StatusPill>
                                        </div>
                                    </Link>
                                ))}
                            </ListCard>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <ListCard title="Upcoming Jobs" helper="Newest active work orders" to="/company/jobs">
                                {upcomingJobs.length === 0 ? (
                                    <EmptyRow>No upcoming jobs.</EmptyRow>
                                ) : upcomingJobs.map((job) => (
                                    <Link key={job.id} to={`/company/jobs/detail/${job.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-slate-900">{job.internalId || job.description || "Job"}</p>
                                                <p className="mt-1 text-sm text-slate-500">{job.customerName || 'Customer not set'}</p>
                                            </div>
                                            <StatusPill tone={job.operationStatus === 'In Progress' ? 'emerald' : 'amber'}>{job.operationStatus || 'Open'}</StatusPill>
                                        </div>
                                    </Link>
                                ))}
                            </ListCard>

                            <ListCard title="Repair Requests" helper="Open repair pressure" to="/company/repair-requests">
                                {recentRepairs.length === 0 ? (
                                    <EmptyRow>No open repair requests.</EmptyRow>
                                ) : recentRepairs.map((request) => (
                                    <Link key={`${request.source}-${request.id}`} to={`/company/repair-requests/detail/${request.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-slate-900">{request.title || request.issueDescription || request.description || 'Repair request'}</p>
                                                <p className="mt-1 text-sm text-slate-500">{request.customerName || request.requesterName || request.source}</p>
                                            </div>
                                            <StatusPill tone="rose">{request.status || 'Unresolved'}</StatusPill>
                                        </div>
                                    </Link>
                                ))}
                            </ListCard>
                        </div>
                    </div>

                    <aside className="space-y-4">
                        <ListCard title="Equipment Due" helper="Maintenance and service attention" to="/company/equipment">
                            {dueEquipment.length === 0 ? (
                                <EmptyRow>No equipment due right now.</EmptyRow>
                            ) : dueEquipment.map((equipment) => (
                                <Link key={equipment.id} to={`/company/equipment/detail/${equipment.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{equipment.name || equipment.type || 'Equipment'}</p>
                                            <p className="mt-1 text-sm text-slate-500">{equipment.customerName || equipment.serviceLocationName || 'Location not set'}</p>
                                        </div>
                                        <span className="text-xs font-semibold text-slate-500">{formatDate(equipment.nextServiceDate)}</span>
                                    </div>
                                </Link>
                            ))}
                        </ListCard>

                        <ListCard title="Today" helper="Service stop workload" to="/company/route-day-management">
                            {serviceStopsToday.length === 0 ? (
                                <EmptyRow>No service stops scheduled today.</EmptyRow>
                            ) : serviceStopsToday.slice(0, 8).map((stop) => (
                                <Link key={stop.id} to={`/company/serviceStops/detail/${stop.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{stop.customerName || stop.jobName || 'Service stop'}</p>
                                            <p className="mt-1 text-sm text-slate-500">{stop.tech || stop.routeName || stop.operationStatus || 'Unassigned'}</p>
                                        </div>
                                        <FaArrowRight className="mt-1 text-xs text-slate-400" />
                                    </div>
                                </Link>
                            ))}
                        </ListCard>
                    </aside>
                </section>
            </div>
        </div>
    );
};

export default OperationsDashboard;
