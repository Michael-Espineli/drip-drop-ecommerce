import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import {
    BriefcaseIcon,
    CalendarDaysIcon,
    MapPinIcon,
    WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import {
    FaArrowRight,
    FaSwimmingPool,
} from 'react-icons/fa';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { SalesAgreementSourceType, salesCollectionNames } from '../../../utils/models/Sales';
import { isOpenRepairRequestStatus } from '../../../utils/models/RepairRequest';
import {
    buildCustomerActiveById,
    equipmentNeedsMaintenanceForActiveBoard,
} from '../../../utils/equipmentMaintenance';
import {
    compareServiceStopsBySchedule,
    serviceStopActivityLabel,
    serviceStopDateValue,
    serviceStopIsOperationsActivity,
    serviceStopDateMillis,
} from '../../../utils/serviceStops/operationsServiceStops';

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

const percentOf = (value, total) => {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
};

const getStopState = (stop) => {
    const start = toMillis(stop?.startTime);
    const end = toMillis(stop?.endTime);
    const status = normalizeStatus(stop?.operationStatus || stop?.status);

    if (end || status === 'finished') return 'finished';
    if (start || status === 'inprogress') return 'inProgress';
    return 'open';
};

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

const startOfTomorrow = () => endOfToday();

const endOfNextSevenDays = () => {
    const date = startOfToday();
    date.setDate(date.getDate() + 8);
    return date;
};

const sortFresh = (records) => (
    [...records].sort((left, right) => (
        toMillis(right.serviceDate || right.dateCreated || right.requestDate || right.createdAt || right.updatedAt)
        - toMillis(left.serviceDate || left.dateCreated || left.requestDate || left.createdAt || left.updatedAt)
    ))
);

const ProgressBar = ({ value, tone = 'blue' }) => {
    const tones = {
        blue: 'bg-blue-600',
        emerald: 'bg-emerald-500',
        amber: 'bg-amber-400',
        rose: 'bg-rose-500',
        slate: 'bg-slate-500',
    };

    return (
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${tones[tone] || tones.blue}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
    );
};

const PulseMetric = ({ icon: Icon, label, value, helper, tone = 'slate', to }) => {
    const tones = {
        slate: 'text-slate-500',
        blue: 'text-blue-600',
        emerald: 'text-emerald-600',
        amber: 'text-amber-600',
        rose: 'text-rose-600',
    };

    const content = (
        <>
            <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${tones[tone] || tones.slate}`} />
                <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
            </div>
            <p className="mt-2 truncate text-2xl font-bold leading-none text-slate-950">{value}</p>
            {helper && <p className="mt-1 truncate text-xs font-semibold text-slate-500">{helper}</p>}
        </>
    );

    const className = "block min-w-0 rounded-md border border-slate-200 px-3 py-3 transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2";

    if (to) return <Link to={to} className={className}>{content}</Link>;

    return <div className={className}>{content}</div>;
};

const FlowRow = ({ label, value, maxValue, tone = 'blue' }) => (
    <div>
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-slate-800">{label}</span>
            <span className="font-bold text-slate-950">{value}</span>
        </div>
        <ProgressBar value={percentOf(value, maxValue)} tone={tone} />
    </div>
);

const TodayStopBar = ({ summary, completionPercent }) => {
    const finishedWidth = percentOf(summary.finished, summary.total);
    const activeWidth = percentOf(summary.inProgress, summary.total);
    const openWidth = percentOf(summary.open, summary.total);

    return (
        <div className="grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-start">
            <div className="rounded-md bg-slate-900 px-3 py-3 text-white">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Complete</p>
                <p className="mt-1 text-3xl font-bold leading-none">{completionPercent}%</p>
            </div>
            <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                    <span>Service stops today</span>
                    <span>{summary.finished}/{summary.total} complete</span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                    <span className="bg-emerald-500" style={{ width: `${finishedWidth}%` }} />
                    <span className="bg-blue-500" style={{ width: `${activeWidth}%` }} />
                    <span className="bg-amber-300" style={{ width: `${openWidth}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Finished</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> In progress</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-300" /> Open</span>
                </div>
            </div>
        </div>
    );
};

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
    const [equipmentDue, setEquipmentDue] = useState([]);
    const [serviceStopsWindow, setServiceStopsWindow] = useState([]);
    const [operationsServiceStops, setOperationsServiceStops] = useState([]);
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
                const nextSevenDaysEnd = Timestamp.fromDate(endOfNextSevenDays());
                const [
                    jobsSnap,
                    internalRepairsSnap,
                    externalRepairsSnap,
                    equipmentSnap,
                    customersSnap,
                    serviceStopsSnap,
                    recurringStopsSnap,
                    agreementsSnap,
                    billingSubscriptionsSnap,
                    contractsSnap,
                ] = await Promise.all([
                    getDocs(query(collection(db, 'companies', recentlySelectedCompany, 'workOrders'), where('operationStatus', 'in', activeJobStatuses))),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'repairRequests')),
                    getDocs(query(collection(db, 'homeownerRepairRequests'), where('companyId', '==', recentlySelectedCompany))),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'equipment')),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers')).catch((customerError) => {
                        console.warn("Unable to load customers for equipment maintenance dashboard count:", customerError);
                        return { docs: [] };
                    }),
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                        where('serviceDate', '>=', todayStart),
                        where('serviceDate', '<', nextSevenDaysEnd)
                    )),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop')),
                    getDocs(query(collection(db, salesCollectionNames.agreements), where('companyId', '==', recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.billingSubscriptions), where('companyId', '==', recentlySelectedCompany))),
                    getDocs(query(collection(db, 'contracts'), where('senderId', '==', recentlySelectedCompany))),
                ]);
                const customerActiveById = buildCustomerActiveById(
                    customersSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
                );

                setJobs(jobsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRepairRequests([
                    ...internalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'internal', ...itemDoc.data() })),
                    ...externalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'external', ...itemDoc.data() })),
                ]);
                setEquipmentDue(equipmentSnap.docs
                    .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
                    .filter((equipment) => equipmentNeedsMaintenanceForActiveBoard(equipment, customerActiveById)));
                const serviceStopsInWindow = serviceStopsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
                setServiceStopsWindow(serviceStopsInWindow);
                setOperationsServiceStops(serviceStopsInWindow.filter(serviceStopIsOperationsActivity));
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

    const recentRepairs = useMemo(() => sortFresh(openRepairs).slice(0, 6), [openRepairs]);
    const dueEquipment = useMemo(() => sortFresh(equipmentDue).slice(0, 6), [equipmentDue]);
    const serviceStopsToday = useMemo(() => {
        const startMillis = startOfToday().getTime();
        const endMillis = endOfToday().getTime();

        return serviceStopsWindow
            .filter((stop) => {
                const millis = serviceStopDateMillis(stop);
                return millis >= startMillis && millis < endMillis;
            })
            .sort(compareServiceStopsBySchedule);
    }, [serviceStopsWindow]);
    const operationsStopsToday = useMemo(() => {
        const startMillis = startOfToday().getTime();
        const endMillis = endOfToday().getTime();

        return operationsServiceStops
            .filter((stop) => {
                const millis = serviceStopDateMillis(stop);
                return millis >= startMillis && millis < endMillis;
            })
            .sort(compareServiceStopsBySchedule);
    }, [operationsServiceStops]);
    const operationsStopsNextSevenDays = useMemo(() => {
        const startMillis = startOfTomorrow().getTime();
        const endMillis = endOfNextSevenDays().getTime();

        return operationsServiceStops
            .filter((stop) => {
                const millis = serviceStopDateMillis(stop);
                return millis >= startMillis && millis < endMillis;
            })
            .sort(compareServiceStopsBySchedule);
    }, [operationsServiceStops]);
    const previewOperationsStops = useMemo(() => (
        [...operationsStopsToday, ...operationsStopsNextSevenDays].slice(0, 8)
    ), [operationsStopsNextSevenDays, operationsStopsToday]);
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

    const todayStopSummary = useMemo(() => (
        serviceStopsToday.reduce((summary, stop) => {
            summary.total += 1;
            summary[getStopState(stop)] += 1;
            return summary;
        }, {
            total: 0,
            finished: 0,
            inProgress: 0,
            open: 0,
        })
    ), [serviceStopsToday]);

    const todayCompletionPercent = percentOf(todayStopSummary.finished, todayStopSummary.total);
    const jobFlowMax = Math.max(1, ...activeJobStatuses.map((status) => jobBuckets[status] || 0));

    if (loading) {
        return <div className="min-h-screen bg-slate-50 px-2 py-6 text-sm text-slate-500 sm:px-3 lg:px-4">Loading operations dashboard...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
            <div className="w-full space-y-5">
                <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || 'Selected company'}</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950">Operations Dashboard</h1>
                        <p className="mt-1 max-w-3xl text-sm text-slate-600">
                            Workload, dispatch pressure, repair intake, equipment due, and scheduling handoffs.
                        </p>
                    </div>
                    <Link to="/company/recurring-service-stops/create" className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
                        New Recurring Service Stop
                    </Link>
                </header>

                <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="p-5">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Operations Pulse</p>
                                <h2 className="mt-1 text-xl font-bold text-slate-950">Workload and service health</h2>
                            </div>
                        </div>

                        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
                            <div className="space-y-5">
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                    <PulseMetric to="/company/jobs" icon={BriefcaseIcon} label="Active Jobs" value={jobs.length} helper={`${jobBuckets["In Progress"] || 0} in progress`} tone="amber" />
                                    <PulseMetric to="/company/repair-requests" icon={WrenchScrewdriverIcon} label="Open Repairs" value={openRepairs.length} helper="repair intake" tone={openRepairs.length ? 'rose' : 'emerald'} />
                                    <PulseMetric to="/company/route-day-management" icon={CalendarDaysIcon} label="Stops Today" value={serviceStopsToday.length} helper={`${todayStopSummary.open} open`} tone="blue" />
                                    <PulseMetric to="/company/route-day-management" icon={MapPinIcon} label="Non Route Stops" value={operationsServiceStops.length} helper="today + next 7 days" tone="blue" />
                                    <PulseMetric to="/company/equipment/needs-maintenance" icon={FaSwimmingPool} label="Equipment Due" value={equipmentDue.length} helper="maintenance due now" tone={equipmentDue.length ? 'amber' : 'emerald'} />
                                </div>

                                <TodayStopBar summary={todayStopSummary} completionPercent={todayCompletionPercent} />
                            </div>

                            <div className="w-full space-y-3 xl:self-start xl:justify-self-end">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Job Statuses</h3>
                                    <span className="text-xs font-semibold text-slate-400">{jobs.length} active</span>
                                </div>
                                {activeJobStatuses.map((status) => (
                                    <FlowRow
                                        key={status}
                                        label={status}
                                        value={jobBuckets[status] || 0}
                                        maxValue={jobFlowMax}
                                        tone={status === 'In Progress' ? 'emerald' : status === 'Estimate Pending' ? 'blue' : 'amber'}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
                    <div className="space-y-5">
                        <div className="grid gap-5 lg:grid-cols-2">
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
                            <ListCard title="Upcoming Non Route Service Stops" helper={`${operationsStopsToday.length} today - ${operationsStopsNextSevenDays.length} in the next 7 days`} to="/company/serviceStops">
                                {previewOperationsStops.length === 0 ? (
                                    <EmptyRow>No non-recurring service stops scheduled today or in the next 7 days.</EmptyRow>
                                ) : previewOperationsStops.map((stop) => {
                                    const stopState = getStopState(stop);

                                    return (
                                    <Link key={stop.id} to={`/company/serviceStops/detail/${stop.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-slate-900">{stop.customerName || stop.jobName || 'Service stop'}</p>
                                                <p className="mt-1 text-sm text-slate-500">{formatDate(serviceStopDateValue(stop))} - {stop.tech || stop.operationStatus || 'Unassigned'}</p>
                                            </div>
                                            <StatusPill tone={stopState === 'finished' ? 'emerald' : stopState === 'inProgress' ? 'blue' : 'amber'}>{serviceStopActivityLabel(stop)}</StatusPill>
                                        </div>
                                    </Link>
                                    );
                                })}
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
                        <ListCard title="Equipment Due" helper="Maintenance and service attention" to="/company/equipment/needs-maintenance">
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

                        <ListCard title="Today" helper="Non-recurring service stop workload" to="/company/serviceStops">
                            {operationsStopsToday.length === 0 ? (
                                <EmptyRow>No non-recurring service stops scheduled today.</EmptyRow>
                            ) : operationsStopsToday.slice(0, 8).map((stop) => (
                                <Link key={stop.id} to={`/company/serviceStops/detail/${stop.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{stop.customerName || stop.jobName || 'Service stop'}</p>
                                            <p className="mt-1 text-sm text-slate-500">{serviceStopActivityLabel(stop)} - {stop.tech || stop.operationStatus || 'Unassigned'}</p>
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
