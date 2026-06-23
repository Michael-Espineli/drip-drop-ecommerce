import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  BanknotesIcon,
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import PaymentMethodSelector from '../../../components/sales/PaymentMethodSelector';
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { db, functions } from '../../../utils/config';
import {
  SalesAgreementStatus,
  SalesInvoiceStatus,
  SalesPaymentStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import { SalesPaymentMethodType } from '../../../utils/sales/paymentMethodFees';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const labelize = (value) => {
  if (!value) return 'Pending';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

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
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(millis));
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const invoiceBalanceCents = (invoice) => {
  if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;

  const total = Number(invoice.totalAmountCents || invoice.totalCents) || 0;
  const paid = Number(invoice.amountPaidCents) || 0;
  const writtenOff = Number(invoice.writeOffAmountCents) || 0;

  return Math.max(total - paid - writtenOff, 0);
};

const sortByFreshest = (records) =>
  [...records].sort((left, right) => {
    const rightMillis = toMillis(right.updatedAt || right.receivedAt || right.requestedAt || right.sentAt || right.createdAt || right.dueDate);
    const leftMillis = toMillis(left.updatedAt || left.receivedAt || left.requestedAt || left.sentAt || left.createdAt || left.dueDate);
    return rightMillis - leftMillis;
  });

const matchesSearch = (record, fields, searchTerm) => {
  const search = searchTerm.trim().toLowerCase();
  if (!search) return true;

  return fields
    .map((field) => record[field])
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(search));
};

const statusTone = {
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  open: 'border-sky-200 bg-sky-50 text-sky-700',
  resolved: 'border-blue-200 bg-blue-50 text-blue-700',
  partiallypaid: 'border-amber-200 bg-amber-50 text-amber-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingpaymentmethod: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingstripe: 'border-amber-200 bg-amber-50 text-amber-700',
  revised: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  notstarted: 'border-slate-200 bg-slate-50 text-slate-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  void: 'border-slate-200 bg-slate-100 text-slate-600',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  pastdue: 'border-rose-200 bg-rose-50 text-rose-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  uncollectible: 'border-rose-200 bg-rose-50 text-rose-700',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.pending;

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const StatTile = ({ icon: Icon, label, value, helper }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      </div>
      <span className="rounded-md bg-slate-100 p-2 text-slate-600">
        <Icon className="h-5 w-5" />
      </span>
    </div>
    {helper && <p className="mt-2 text-sm text-slate-500">{helper}</p>}
  </div>
);

const EmptyState = ({ title, body }) => (
  <div className="p-8 text-center">
    <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-slate-300" />
    <p className="mt-3 font-semibold text-slate-800">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{body}</p>
  </div>
);

const SectionHeader = ({ title, count, helper }) => (
  <div className="border-b border-slate-200 p-4">
    <p className="font-semibold text-slate-900">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{count} record{count === 1 ? '' : 's'} - {helper}</p>
  </div>
);

const ClientFinance = () => {
  const { user } = useContext(Context);
  const location = useLocation();
  const [agreements, setAgreements] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [startingCheckoutId, setStartingCheckoutId] = useState('');
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState({});

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    if (queryParams.get('stripeCheckout') === 'success') {
      toast.success('Payment setup returned from Stripe.');
    }
  }, [location.search]);

  useEffect(() => {
    if (!user?.uid) {
      setAgreements([]);
      setApprovals([]);
      setInvoices([]);
      setPayments([]);
      setSubscriptions([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');
    let firstSnapshotsRemaining = 5;

    const publish = (setter) => (snapshot) => {
      const nextRecords = snapshot.docs
        .map((recordDoc) => ({ id: recordDoc.id, ...recordDoc.data() }))
        .filter((record) => record.customerUserId === user.uid);

      setter(sortByFreshest(nextRecords));
      firstSnapshotsRemaining -= 1;
      if (firstSnapshotsRemaining <= 0) setLoading(false);
    };

    const onError = (label) => (snapshotError) => {
      console.error(`Unable to load ${label}`, snapshotError);
      setError(snapshotError.message || `Unable to load ${label}.`);
      setLoading(false);
    };

    const unsubscribes = [
      onSnapshot(
        query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', user.uid)),
        publish(setAgreements),
        onError('service agreements')
      ),
      onSnapshot(
        query(collection(db, 'customerPartApprovals'), where('customerUserId', '==', user.uid)),
        publish(setApprovals),
        onError('part approvals')
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.invoices), where('customerUserId', '==', user.uid)),
        publish(setInvoices),
        onError('invoices')
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.payments), where('customerUserId', '==', user.uid)),
        publish(setPayments),
        onError('payments')
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.billingSubscriptions), where('customerUserId', '==', user.uid)),
        publish(setSubscriptions),
        onError('billing subscriptions')
      ),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  const summary = useMemo(() => {
    const pendingAgreements = agreements.filter((agreement) => ['sent', 'revised', 'draft'].includes(normalizeStatus(agreement.status)));
    const pendingApprovals = approvals.filter((approval) => normalizeStatus(approval.status || approval.approvalStatus) === 'pending');
    const openInvoices = invoices.filter((invoice) => (
      invoiceBalanceCents(invoice) > 0 &&
      !['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status))
    ));
    const postedPayments = payments.filter((payment) => normalizeStatus(payment.status) === normalizeStatus(SalesPaymentStatus.posted));
    const activeSubscriptions = subscriptions.filter((subscription) => (
      ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status))
    ));

    return {
      needsReviewCount: pendingAgreements.length + pendingApprovals.length + openInvoices.length,
      openBalanceCents: openInvoices.reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0),
      paidCents: postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0),
      activeSubscriptionCount: activeSubscriptions.length,
      agreementValueCents: agreements.reduce((total, agreement) => total + Number(agreement.totalAmountCents || agreement.rateAmountCents || 0), 0),
      partApprovalValueCents: approvals.reduce((total, approval) => total + Number(approval.plannedTotalPriceCents || approval.totalPriceCents || 0), 0),
    };
  }, [agreements, approvals, invoices, payments, subscriptions]);

  const filteredAgreements = useMemo(() => (
    agreements.filter((agreement) => matchesSearch(agreement, ['title', 'companyName', 'customerName', 'email', 'status', 'id'], searchTerm))
  ), [agreements, searchTerm]);

  const filteredApprovals = useMemo(() => (
    approvals.filter((approval) => matchesSearch(approval, ['itemName', 'name', 'description', 'companyName', 'jobInternalId', 'customerName', 'status', 'approvalStatus'], searchTerm))
  ), [approvals, searchTerm]);

  const filteredInvoices = useMemo(() => (
    invoices.filter((invoice) => matchesSearch(invoice, ['invoiceNumber', 'companyName', 'customerName', 'email', 'status', 'id'], searchTerm))
  ), [invoices, searchTerm]);

  const actionItems = useMemo(() => {
    const openInvoiceItems = invoices
      .filter((invoice) => invoiceBalanceCents(invoice) > 0 && !['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status)))
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        title: invoice.invoiceNumber || 'Open invoice',
        meta: `${invoice.companyName || 'Pool company'} - ${formatCurrency(invoiceBalanceCents(invoice))}`,
        status: invoice.status || SalesInvoiceStatus.open,
        to: `/client/billing/invoices/${invoice.id}`,
      }));
    const agreementItems = agreements
      .filter((agreement) => ['sent', 'revised', 'draft'].includes(normalizeStatus(agreement.status)))
      .map((agreement) => ({
        id: `agreement-${agreement.id}`,
        title: agreement.title || 'Service agreement',
        meta: `${agreement.companyName || 'Pool company'} - ${formatCurrency(agreement.totalAmountCents || agreement.rateAmountCents)}`,
        status: agreement.status || SalesAgreementStatus.sent,
        to: `/client/service-agreements/${agreement.id}`,
      }));
    const approvalItems = approvals
      .filter((approval) => normalizeStatus(approval.status || approval.approvalStatus) === 'pending')
      .map((approval) => ({
        id: `approval-${approval.id}`,
        title: approval.itemName || approval.name || 'Part approval',
        meta: `${approval.companyName || 'Pool company'} - ${formatCurrency(approval.plannedTotalPriceCents || approval.totalPriceCents)}`,
        status: approval.status || approval.approvalStatus || 'pending',
        to: `/client/part-approvals/${approval.id}`,
      }));

    return sortByFreshest([...openInvoiceItems, ...agreementItems, ...approvalItems]).slice(0, 8);
  }, [agreements, approvals, invoices]);

  const paymentMethodForSubscription = (subscription = {}) => (
    selectedPaymentMethods[subscription.id] ||
    subscription.paymentMethodType ||
    SalesPaymentMethodType.ach
  );

  const updatePaymentMethodForSubscription = (subscriptionId, paymentMethodType) => {
    setSelectedPaymentMethods((current) => ({
      ...current,
      [subscriptionId]: paymentMethodType,
    }));
  };

  const startCheckout = async (subscription) => {
    if (!subscription?.id || startingCheckoutId) return;

    setStartingCheckoutId(subscription.id);

    try {
      const startCheckoutCallable = httpsCallable(functions, 'createSalesBillingSubscriptionCheckoutSession');
      const authPayload = await getCallableAuthPayload();
      const result = await startCheckoutCallable({
        ...authPayload,
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        companyId: subscription.companyId,
        paymentMethodType: paymentMethodForSubscription(subscription),
        successUrl: `${window.location.origin}/client/finance?stripeCheckout=success&billingSubscriptionId=${encodeURIComponent(subscription.id)}`,
        cancelUrl: `${window.location.origin}/client/finance?stripeCheckout=canceled&billingSubscriptionId=${encodeURIComponent(subscription.id)}`,
      });

      if (result.data?.url) {
        window.location.href = result.data.url;
        return;
      }

      if (result.data?.status === 'already_active') {
        toast.success('Billing is already active.');
        return;
      }

      throw new Error(result.data?.message || 'Stripe did not return a Checkout URL.');
    } catch (checkoutError) {
      console.error('Unable to start billing checkout', checkoutError);
      toast.error(checkoutError.message || 'Failed to start payment setup.');
      setStartingCheckoutId('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8">
      <div className="w-full space-y-6">
        <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">Finance</h1>
            <p className="mt-2 text-sm text-slate-600">
              Review part approvals, service agreements, invoices, payments, and recurring billing in one place.
            </p>
          </div>
          <label className="relative w-full xl:w-96">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Search finance records"
            />
          </label>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={ClockIcon} label="Needs Attention" value={summary.needsReviewCount} helper="Invoices, agreements, and approvals" />
          <StatTile icon={DocumentTextIcon} label="Open Balance" value={formatCurrency(summary.openBalanceCents)} helper="Outstanding invoice balance" />
          <StatTile icon={BanknotesIcon} label="Paid" value={formatCurrency(summary.paidCents)} helper="Posted payment history" />
          <StatTile icon={CreditCardIcon} label="Active Billing" value={summary.activeSubscriptionCount} helper="Recurring payment setups" />
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <SectionHeader title="Needs Attention" count={actionItems.length} helper="Open items across billing, agreements, and parts" />
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading finance records...</div>
          ) : actionItems.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No open finance items need action.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {actionItems.map((item) => (
                <Link key={item.id} to={item.to} className="flex items-start justify-between gap-3 p-4 transition hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.meta}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <SectionHeader title="Service Agreements" count={filteredAgreements.length} helper={formatCurrency(summary.agreementValueCents)} />
              {loading ? (
                <div className="p-8 text-center text-sm text-slate-500">Loading service agreements...</div>
              ) : filteredAgreements.length === 0 ? (
                <EmptyState title="No service agreements found." body="When a company sends one to this account, it will show here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Agreement</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Company</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Amount</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredAgreements.map((agreement) => (
                        <tr key={agreement.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4">
                            <p className="font-semibold text-slate-950">{agreement.title || 'Service Agreement'}</p>
                            <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{formatDate(agreement.updatedAt || agreement.sentAt || agreement.createdAt)}</p>
                          </td>
                          <td className="px-5 py-4 text-slate-700">{agreement.companyName || 'Pool company'}</td>
                          <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(agreement.totalAmountCents || agreement.rateAmountCents)}</td>
                          <td className="px-5 py-4"><StatusBadge status={agreement.status || SalesAgreementStatus.draft} /></td>
                          <td className="px-5 py-4">
                            <Link to={`/client/service-agreements/${agreement.id}`} className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                              Review
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <SectionHeader title="Part Approvals" count={filteredApprovals.length} helper={formatCurrency(summary.partApprovalValueCents)} />
              {loading ? (
                <div className="p-8 text-center text-sm text-slate-500">Loading part approvals...</div>
              ) : filteredApprovals.length === 0 ? (
                <EmptyState title="No part approvals found." body="Requested pool parts will show here before purchase or installation." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Part</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Company</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Amount</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredApprovals.map((approval) => (
                        <tr key={approval.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4">
                            <p className="font-semibold text-slate-950">{approval.itemName || approval.name || 'Pool Part'}</p>
                            <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{approval.description || approval.jobInternalId || 'Part approval'}</p>
                          </td>
                          <td className="px-5 py-4 text-slate-700">{approval.companyName || 'Pool company'}</td>
                          <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(approval.plannedTotalPriceCents || approval.totalPriceCents)}</td>
                          <td className="px-5 py-4"><StatusBadge status={approval.status || approval.approvalStatus} /></td>
                          <td className="px-5 py-4">
                            <Link to={`/client/part-approvals/${approval.id}`} className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                              Review
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <SectionHeader title="Invoices" count={filteredInvoices.length} helper={`${formatCurrency(summary.openBalanceCents)} open`} />
              {loading ? (
                <div className="p-8 text-center text-sm text-slate-500">Loading invoices...</div>
              ) : filteredInvoices.length === 0 ? (
                <EmptyState title="No invoices found." body="Invoices from your pool service companies will show here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Invoice</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Company</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Total</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Balance</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredInvoices.map((invoice) => (
                        <tr key={invoice.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4">
                            <p className="font-semibold text-slate-950">{invoice.invoiceNumber || 'Invoice'}</p>
                            <p className="mt-1 text-xs text-slate-500">Due {formatDate(invoice.dueDate)}</p>
                          </td>
                          <td className="px-5 py-4 text-slate-700">{invoice.companyName || 'Pool company'}</td>
                          <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(invoice.totalAmountCents)}</td>
                          <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(invoiceBalanceCents(invoice))}</td>
                          <td className="px-5 py-4"><StatusBadge status={invoice.status || SalesInvoiceStatus.draft} /></td>
                          <td className="px-5 py-4">
                            <Link to={`/client/billing/invoices/${invoice.id}`} className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </main>

          <aside className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Recurring Billing</h2>
              <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                {subscriptions.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">No recurring billing records yet.</div>
                ) : subscriptions.map((subscription) => {
                  const statusKey = normalizeStatus(subscription.stripeStatus || subscription.status);
                  const isActive = ['active', 'trialing'].includes(statusKey);
                  const canCheckout = !isActive && Number(subscription.amountCents || 0) > 0 && Boolean(subscription.stripeConnectedAccountId);

                  return (
                    <div key={subscription.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{subscription.companyName || subscription.customerName || 'Pool service'}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatCurrency(subscription.amountCents)} every {subscription.intervalCount > 1 ? `${subscription.intervalCount} ` : ''}{subscription.interval || 'month'}
                          </p>
                        </div>
                        <StatusBadge status={subscription.stripeStatus || subscription.status} />
                      </div>
                      {subscription.agreementId && (
                        <Link to={`/client/service-agreements/${subscription.agreementId}`} className="mt-3 inline-flex text-xs font-semibold text-blue-700 hover:text-blue-900">
                          View agreement
                        </Link>
                      )}
                      {!isActive && (
                        <PaymentMethodSelector
                          amountCents={subscription.amountCents}
                          value={paymentMethodForSubscription(subscription)}
                          onChange={(paymentMethodType) => updatePaymentMethodForSubscription(subscription.id, paymentMethodType)}
                          disabled={!canCheckout || startingCheckoutId === subscription.id}
                          compact
                          className="mt-3"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => startCheckout(subscription)}
                        disabled={!canCheckout || startingCheckoutId === subscription.id}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <CreditCardIcon className="h-5 w-5" />
                        {startingCheckoutId === subscription.id ? 'Opening...' : isActive ? 'Billing Active' : 'Set Up Payment'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Payment History</h2>
              <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                {payments.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">No payments posted yet.</div>
                ) : payments.map((payment) => (
                  <div key={payment.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                        <p className="mt-1 text-xs text-slate-500">{labelize(payment.method)} - {formatDate(payment.receivedAt || payment.createdAt)}</p>
                      </div>
                      <StatusBadge status={payment.status || SalesPaymentStatus.posted} />
                    </div>
                    {payment.invoiceId && (
                      <Link to={`/client/billing/invoices/${payment.invoiceId}`} className="mt-2 inline-flex text-xs font-semibold text-blue-700 hover:text-blue-900">
                        View invoice
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
              <div className="flex items-start gap-3">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none" />
                <div>
                  <p className="font-bold">Online and offline payments can appear here.</p>
                  <p className="mt-1">
                    Companies can record cash, check, and external card payments, so this page includes the full billing history they have posted.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ClientFinance;
