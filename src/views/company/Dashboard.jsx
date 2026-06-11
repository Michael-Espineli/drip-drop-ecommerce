import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    collection,
    getDocs,
    onSnapshot,
    query,
    where,
} from "firebase/firestore";
import {
    FaBell,
    FaCreditCard,
    FaFileContract,
    FaFileInvoiceDollar,
    FaHouseUser,
    FaMoneyBillWave,
    FaReceipt,
    FaRoute,
    FaTasks,
    FaTools,
} from 'react-icons/fa';
import { MdConstruction, MdOutlineLocalOffer } from 'react-icons/md';
import { db } from "../../utils/config";
import { Context } from "../../context/AuthContext";
import { SalesAgreementSourceType, salesCollectionNames } from '../../utils/models/Sales';
import { isOpenRepairRequestStatus } from '../../utils/models/RepairRequest';
import RecentChatsWidget from '../dashboard/components/RecentChatsWidget';
import {
    TODO_LIST_FEATURE_FLAG_ID,
    compareTodosByUrgency,
    formatShortDateTime,
    normalizeTodo,
    todoIsOpen,
    todoNeedsAttention,
} from '../../utils/models/TodoItem';
import {
    ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID,
    ALERT_STATUS,
    alertDisplayTime,
    alertIsUnread,
    alertNeedsAttention,
    compareAlertsFresh,
    normalizeAlertNotification,
} from '../../utils/models/AlertNotification';

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

const appPaymentMethods = new Set(['stripeCard', 'stripeAch']);
const activeJobStatuses = new Set(["Estimate Pending", "Unscheduled", "Scheduled", "In Progress"]);

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const formatDate = (value) => {
    const millis = toMillis(value);
    if (!millis) return 'Not set';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(millis));
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const invoiceBalanceCents = (invoice) => {
    if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;
    const total = Number(invoice.totalAmountCents || 0);
    const paid = Number(invoice.amountPaidCents || 0);
    const writtenOff = Number(invoice.writeOffAmountCents || 0);
    return Math.max(total - paid - writtenOff, 0);
};

const sortFresh = (records) => (
    [...records].sort((left, right) => (
        toMillis(right.updatedAt || right.receivedAt || right.createdAt || right.dateCreated || right.dueDate)
        - toMillis(left.updatedAt || left.receivedAt || left.createdAt || left.dateCreated || left.dueDate)
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
                    <Icon />
                </span>
            </div>
            {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
        </div>
    );

    return to ? <Link to={to}>{content}</Link> : content;
};

const ListCard = ({ title, helper, to, actionLabel = 'View all', children }) => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
                <h2 className="text-lg font-bold text-slate-950">{title}</h2>
                {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
            </div>
            {to && <Link to={to} className="shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-900">{actionLabel}</Link>}
        </div>
        <div className="divide-y divide-slate-100">{children}</div>
    </section>
);

const EmptyRow = ({ children }) => (
    <div className="p-5 text-sm text-slate-500">{children}</div>
);

const Dashboard = () => {
    const {
        recentlySelectedCompany,
        recentlySelectedCompanyName,
        user,
        featureFlagsLoaded,
        isFeatureEnabled,
    } = useContext(Context);
    const [loading, setLoading] = useState(true);
    const [customers, setCustomers] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [leads, setLeads] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [payments, setPayments] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [serviceAgreements, setServiceAgreements] = useState([]);
    const [recurringServiceStops, setRecurringServiceStops] = useState([]);
    const [todoItems, setTodoItems] = useState([]);
    const [alertNotifications, setAlertNotifications] = useState([]);

    const todoListEnabled = featureFlagsLoaded && isFeatureEnabled(TODO_LIST_FEATURE_FLAG_ID);
    const alertsEnabled = featureFlagsLoaded && isFeatureEnabled(ALERTS_NOTIFICATIONS_FEATURE_FLAG_ID);

    useEffect(() => {
        if (!recentlySelectedCompany || !user) {
            setLoading(false);
            return;
        }

        const loadDashboard = async () => {
            setLoading(true);
            try {
                const [
                    customersSnap,
                    jobsSnap,
                    leadsSnap,
                    internalRepairsSnap,
                    externalRepairsSnap,
                    invoicesSnap,
                    paymentsSnap,
                    subscriptionsSnap,
                    agreementsSnap,
                    recurringStopsSnap,
                ] = await Promise.all([
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "customers"), where("active", "==", true))),
                    getDocs(query(collection(db, "companies", recentlySelectedCompany, "workOrders"), where("operationStatus", "in", Array.from(activeJobStatuses)))),
                    getDocs(query(collection(db, "homeownerServiceRequests"), where("companyId", "==", recentlySelectedCompany), where("status", "==", "Pending"))),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "repairRequests")),
                    getDocs(query(collection(db, "homeownerRepairRequests"), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.invoices), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.payments), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.billingSubscriptions), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", recentlySelectedCompany))),
                    getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")),
                ]);

                setCustomers(customersSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setJobs(jobsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setLeads(leadsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRepairRequests([
                    ...internalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'internal', ...itemDoc.data() })),
                    ...externalRepairsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, source: 'external', ...itemDoc.data() })),
                ]);
                setInvoices(invoicesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setPayments(paymentsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setSubscriptions(subscriptionsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setServiceAgreements(agreementsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
                setRecurringServiceStops(recurringStopsSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
            } catch (error) {
                console.error("Error loading company dashboard:", error);
            } finally {
                setLoading(false);
            }
        };

        loadDashboard();
    }, [recentlySelectedCompany, user]);

    useEffect(() => {
        if (!recentlySelectedCompany || !featureFlagsLoaded) {
            setTodoItems([]);
            setAlertNotifications([]);
            return undefined;
        }

        const unsubscribers = [];

        if (todoListEnabled) {
            unsubscribers.push(onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "todoItems"),
                (snapshot) => {
                    setTodoItems(snapshot.docs.map(normalizeTodo));
                },
                (error) => {
                    console.error("Error loading dashboard todo items:", error);
                    setTodoItems([]);
                }
            ));
        } else {
            setTodoItems([]);
        }

        if (alertsEnabled) {
            unsubscribers.push(onSnapshot(
                collection(db, "companies", recentlySelectedCompany, "alerts"),
                (snapshot) => {
                    setAlertNotifications(snapshot.docs.map(normalizeAlertNotification));
                },
                (error) => {
                    console.error("Error loading dashboard alerts:", error);
                    setAlertNotifications([]);
                }
            ));
        } else {
            setAlertNotifications([]);
        }

        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [alertsEnabled, featureFlagsLoaded, recentlySelectedCompany, todoListEnabled]);

    const summary = useMemo(() => {
        const activeRepairs = repairRequests.filter((request) => (
            isOpenRepairRequestStatus(request.status)
        ));
        const issuedInvoiceCents = invoices
            .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + Number(invoice.totalAmountCents || 0), 0);
        const openArCents = invoices
            .filter((invoice) => ['open', 'partiallypaid', 'overdue'].includes(normalizeStatus(invoice.status)))
            .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);
        const postedPayments = payments.filter((payment) => normalizeStatus(payment.status) === 'posted');
        const receivedCents = postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const paidThroughAppCents = postedPayments
            .filter((payment) => appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId)
            .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
        const recurringCents = subscriptions
            .filter((subscription) => ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status)))
            .reduce((total, subscription) => total + Number(subscription.amountCents || 0), 0);

        return {
            activeRepairs,
            issuedInvoiceCents,
            openArCents,
            receivedCents,
            paidThroughAppCents,
            recurringCents,
        };
    }, [invoices, payments, repairRequests, subscriptions]);

    const recurringStopsByServiceLocation = useMemo(() => {
        const set = new Set();
        recurringServiceStops.forEach((stop) => {
            if (stop.serviceLocationId && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek)) {
                set.add(stop.serviceLocationId);
            }
        });
        return set;
    }, [recurringServiceStops]);

    const recurringStopsByCustomer = useMemo(() => {
        const set = new Set();
        recurringServiceStops.forEach((stop) => {
            if (stop.customerId && (stop.techId || stop.tech) && (stop.day || stop.daysOfWeek)) {
                set.add(stop.customerId);
            }
        });
        return set;
    }, [recurringServiceStops]);

    const agreementsNeedRouting = useMemo(() => serviceAgreements.filter((agreement) => {
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
    }), [recurringStopsByCustomer, recurringStopsByServiceLocation, serviceAgreements]);

    const recentJobs = useMemo(() => sortFresh(jobs).slice(0, 5), [jobs]);
    const recentLeads = useMemo(() => sortFresh(leads).slice(0, 5), [leads]);
    const recentPayments = useMemo(() => sortFresh(payments.filter((payment) => normalizeStatus(payment.status) === 'posted')).slice(0, 5), [payments]);
    const openTodos = useMemo(() => todoItems.filter(todoIsOpen).sort(compareTodosByUrgency), [todoItems]);
    const attentionTodos = useMemo(() => openTodos.filter((todo) => todoNeedsAttention(todo)), [openTodos]);
    const activeAlerts = useMemo(() => alertNotifications.filter((alert) => alertNeedsAttention(alert)).sort(compareAlertsFresh), [alertNotifications]);
    const unreadAlerts = useMemo(() => alertNotifications.filter(alertIsUnread), [alertNotifications]);
    const dashboardAlerts = useMemo(() => alertNotifications
        .filter((alert) => alert.status !== ALERT_STATUS.archived)
        .sort((left, right) => {
            const attentionDifference = Number(alertNeedsAttention(right)) - Number(alertNeedsAttention(left));
            if (attentionDifference !== 0) return attentionDifference;
            return compareAlertsFresh(left, right);
        })
        .slice(0, 3), [alertNotifications]);

    const alertHref = (alert) => {
        if (alert.route && alert.route.startsWith('/')) return alert.route;
        if (alert.source === 'todoList' || alert.todoId) return '/company/todo-list';
        return '/company/alerts';
    };

    if (loading) {
        return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading dashboard...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || 'Selected company'}</p>
                            <h1 className="mt-2 text-3xl font-bold text-slate-950">Dashboard</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                Business overview across operations, sales, finance, customers, and team activity.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link to="/company/operations-dashboard" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                                Operations
                            </Link>
                            <Link to="/company/sales" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
                                Sales Dashboard
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile icon={FaFileInvoiceDollar} label="Invoiced" value={formatCurrency(summary.issuedInvoiceCents)} helper="Issued sales invoices" to="/company/sales/invoices" tone="blue" />
                    <StatTile icon={FaReceipt} label="Received" value={formatCurrency(summary.receivedCents)} helper={`${formatCurrency(summary.paidThroughAppCents)} paid in app`} to="/company/sales/payments" tone="emerald" />
                    <StatTile icon={FaMoneyBillWave} label="Open AR" value={formatCurrency(summary.openArCents)} helper="Outstanding customer balance" to="/company/sales/invoices" tone="amber" />
                    <StatTile icon={FaCreditCard} label="Recurring" value={formatCurrency(summary.recurringCents)} helper="Active subscription amount" to="/company/sales/subscriptions" tone="blue" />
                    <StatTile icon={MdConstruction} label="Active Jobs" value={jobs.length} helper="Open operational work" to="/company/jobs" tone="amber" />
                    <StatTile icon={MdOutlineLocalOffer} label="Pending Leads" value={leads.length} helper="New homeowner requests" to="/company/leads" tone="blue" />
                    <StatTile icon={FaFileContract} label="Needs Routing" value={agreementsNeedRouting.length} helper="Accepted service agreements" to="/company/route-dashboard" tone={agreementsNeedRouting.length ? "amber" : "emerald"} />
                    <StatTile icon={FaHouseUser} label="Customers" value={customers.length} helper="Active customer accounts" to="/company/customers" />
                    {todoListEnabled && (
                        <StatTile icon={FaTasks} label="Open Todos" value={openTodos.length} helper={`${attentionTodos.length} need attention`} to="/company/todo-list" tone={attentionTodos.length ? "amber" : "blue"} />
                    )}
                    {alertsEnabled && (
                        <StatTile icon={FaBell} label="Notifications" value={activeAlerts.length} helper={`${unreadAlerts.length} unread`} to="/company/alerts" tone={activeAlerts.length ? "amber" : "emerald"} />
                    )}
                </section>

                <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="grid gap-6 lg:grid-cols-2">
                        <ListCard title="Current Work" helper="Open jobs needing action" to="/company/jobs">
                            {recentJobs.length === 0 ? (
                                <EmptyRow>No current work orders.</EmptyRow>
                            ) : recentJobs.map((job) => (
                                <Link key={job.id} to={`/company/jobs/detail/${job.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{job.internalId || job.customerName || 'Job'}</p>
                                            <p className="mt-1 text-sm text-slate-500">{job.customerName || job.description || 'No customer saved'}</p>
                                        </div>
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                            {job.operationStatus || 'Open'}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </ListCard>

                        <ListCard title="Recent Leads" helper="Pending homeowner requests" to="/company/leads">
                            {recentLeads.length === 0 ? (
                                <EmptyRow>No recent leads.</EmptyRow>
                            ) : recentLeads.map((lead) => (
                                <Link key={lead.id} to={`/company/leads/${lead.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{lead.serviceName || 'Service request'}</p>
                                            <p className="mt-1 text-sm text-slate-500">{lead.homeownerName || lead.customerName || lead.email || 'Homeowner'}</p>
                                        </div>
                                        <span className="text-xs font-semibold text-slate-500">{formatDate(lead.createdAt)}</span>
                                    </div>
                                </Link>
                            ))}
                        </ListCard>

                        <ListCard title="Recently Paid" helper="Posted customer payments" to="/company/sales/payments">
                            {recentPayments.length === 0 ? (
                                <EmptyRow>No payments posted yet.</EmptyRow>
                            ) : recentPayments.map((payment) => (
                                <div key={payment.id} className="px-5 py-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{payment.customerName || 'Customer'}</p>
                                            <p className="mt-1 text-sm text-slate-500">
                                                {payment.method || 'payment'} · {formatDate(payment.receivedAt || payment.createdAt)}
                                            </p>
                                        </div>
                                        <p className="text-sm font-bold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                                    </div>
                                </div>
                            ))}
                        </ListCard>

                        <ListCard title="Operations Alerts" helper="Repairs and route pressure" to="/company/operations-dashboard">
                            <div className="grid gap-3 p-5 sm:grid-cols-2">
                                <Link to="/company/repair-requests" className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:bg-blue-50">
                                    <FaTools className="text-slate-500" />
                                    <p className="mt-3 text-2xl font-bold text-slate-950">{summary.activeRepairs.length}</p>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Repairs</p>
                                </Link>
                                <Link to="/company/route-day-management" className="rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:bg-blue-50">
                                    <FaRoute className="text-slate-500" />
                                    <p className="mt-3 text-2xl font-bold text-slate-950">{jobs.filter((job) => job.operationStatus === 'Scheduled').length}</p>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled Jobs</p>
                                </Link>
                            </div>
                        </ListCard>
                    </div>

                    <div className="space-y-6">
                        {todoListEnabled && (
                            <ListCard title="Tasks and Reminders" helper="Open todos by urgency" to="/company/todo-list">
                                {openTodos.length === 0 ? (
                                    <EmptyRow>No open todos.</EmptyRow>
                                ) : openTodos.slice(0, 5).map((todo) => (
                                    <Link key={todo.id} to="/company/todo-list" className="block px-5 py-4 transition hover:bg-slate-50">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-slate-900">{todo.title}</p>
                                                <p className="mt-1 text-sm text-slate-500">
                                                    {todo.assignedToName || "Team task"} · {todo.dueAt ? formatShortDateTime(todo.dueAt) : "No due date"}
                                                </p>
                                            </div>
                                            {todoNeedsAttention(todo) && (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                                    Alert
                                                </span>
                                            )}
                                        </div>
                                    </Link>
                                ))}
                            </ListCard>
                        )}

                        {alertsEnabled && (
                            <ListCard title="Alerts and Notifications" helper="Latest notification activity" to="/company/alerts" actionLabel="All notifications">
                                {dashboardAlerts.length === 0 ? (
                                    <EmptyRow>No notifications yet.</EmptyRow>
                                ) : dashboardAlerts.map((alert) => (
                                    <Link key={alert.id} to={alertHref(alert)} className="block px-5 py-4 transition hover:bg-slate-50">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    {alertNeedsAttention(alert) && (
                                                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="Needs attention" />
                                                    )}
                                                    <p className="truncate text-sm font-semibold text-slate-900">{alert.title}</p>
                                                </div>
                                                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{alert.message || "Notification"}</p>
                                            </div>
                                            <span className="shrink-0 text-xs font-semibold text-slate-500">{formatShortDateTime(alertDisplayTime(alert))}</span>
                                        </div>
                                    </Link>
                                ))}
                            </ListCard>
                        )}

                        <ListCard title="Recent Messages" helper="Unread and recent conversations" to="/company/messages">
                            <div className="p-4">
                                <RecentChatsWidget />
                            </div>
                        </ListCard>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Dashboard;
