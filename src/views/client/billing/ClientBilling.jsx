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
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { db, functions } from '../../../utils/config';
import {
  SalesInvoiceStatus,
  SalesPaymentStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const labelize = (value) => {
  if (!value) return 'Unknown';
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
    const rightMillis = toMillis(right.updatedAt || right.receivedAt || right.paidAt || right.sentAt || right.createdAt || right.dueDate);
    const leftMillis = toMillis(left.updatedAt || left.receivedAt || left.paidAt || left.sentAt || left.createdAt || left.dueDate);
    return rightMillis - leftMillis;
  });

const statusTone = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  trialing: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  open: 'border-sky-200 bg-sky-50 text-sky-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  partiallypaid: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingpaymentmethod: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingstripe: 'border-amber-200 bg-amber-50 text-amber-700',
  notstarted: 'border-slate-200 bg-slate-50 text-slate-700',
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  pastdue: 'border-rose-200 bg-rose-50 text-rose-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  void: 'border-slate-200 bg-slate-100 text-slate-600',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.draft;

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

const ClientBilling = () => {
  const { user } = useContext(Context);
  const location = useLocation();
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [startingCheckoutId, setStartingCheckoutId] = useState('');

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    if (queryParams.get('stripeCheckout') === 'success') {
      toast.success('Payment setup returned from Stripe.');
    }
  }, [location.search]);

  useEffect(() => {
    if (!user?.uid) {
      setInvoices([]);
      setPayments([]);
      setSubscriptions([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    const maps = {
      invoices: new Map(),
      payments: new Map(),
      subscriptions: new Map(),
    };
    let firstSnapshotsRemaining = 3;

    const publish = (key) => (snapshot) => {
      snapshot.docs.forEach((recordDoc) => {
        maps[key].set(recordDoc.id, { id: recordDoc.id, ...recordDoc.data() });
      });

      setInvoices(sortByFreshest(Array.from(maps.invoices.values())));
      setPayments(sortByFreshest(Array.from(maps.payments.values())));
      setSubscriptions(sortByFreshest(Array.from(maps.subscriptions.values())));
      firstSnapshotsRemaining -= 1;
      if (firstSnapshotsRemaining <= 0) setLoading(false);
    };

    const onError = (snapshotError) => {
      console.error('Unable to load billing records', snapshotError);
      setError(snapshotError.message || 'Unable to load billing records.');
      setLoading(false);
    };

    const unsubscribes = [
      onSnapshot(
        query(collection(db, salesCollectionNames.invoices), where('customerUserId', '==', user.uid)),
        publish('invoices'),
        onError
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.payments), where('customerUserId', '==', user.uid)),
        publish('payments'),
        onError
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.billingSubscriptions), where('customerUserId', '==', user.uid)),
        publish('subscriptions'),
        onError
      ),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  const summary = useMemo(() => {
    const openInvoices = invoices.filter((invoice) => (
      invoiceBalanceCents(invoice) > 0 &&
      !['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status))
    ));
    const postedPayments = payments.filter((payment) => normalizeStatus(payment.status) === normalizeStatus(SalesPaymentStatus.posted));
    const activeSubscriptions = subscriptions.filter((subscription) => (
      ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status))
    ));

    return {
      openInvoiceCount: openInvoices.length,
      openBalanceCents: openInvoices.reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0),
      paidCents: postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0),
      activeSubscriptionCount: activeSubscriptions.length,
    };
  }, [invoices, payments, subscriptions]);

  const filteredInvoices = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return invoices;

    return invoices.filter((invoice) => [
      invoice.invoiceNumber,
      invoice.companyName,
      invoice.customerName,
      invoice.email,
      invoice.status,
      invoice.id,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search)));
  }, [invoices, searchTerm]);

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
        successUrl: `${window.location.origin}/client/billing?stripeCheckout=success&billingSubscriptionId=${encodeURIComponent(subscription.id)}`,
        cancelUrl: `${window.location.origin}/client/billing?stripeCheckout=canceled&billingSubscriptionId=${encodeURIComponent(subscription.id)}`,
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
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Billing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review invoices, payment history, and recurring billing status from your pool service companies.
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatTile icon={DocumentTextIcon} label="Open Invoices" value={summary.openInvoiceCount} helper={formatCurrency(summary.openBalanceCents)} />
        <StatTile icon={BanknotesIcon} label="Paid" value={formatCurrency(summary.paidCents)} helper="Posted payment history" />
        <StatTile icon={CreditCardIcon} label="Active Billing" value={summary.activeSubscriptionCount} helper="Recurring subscriptions" />
        <StatTile icon={ClockIcon} label="Invoices" value={invoices.length} helper="All visible invoices" />
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900">Invoices</p>
              <p className="text-sm text-slate-500">{filteredInvoices.length} record{filteredInvoices.length === 1 ? '' : 's'} shown</p>
            </div>

            <label className="relative w-full sm:w-80">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search invoices"
                type="search"
              />
            </label>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading billing records...</div>
          ) : filteredInvoices.length === 0 ? (
            <div className="p-8 text-center">
              <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 font-semibold text-slate-800">No invoices found.</p>
              <p className="mt-1 text-sm text-slate-500">When a company sends an invoice to this account, it will show here.</p>
            </div>
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
                        <Link
                          to={`/client/billing/invoices/${invoice.id}`}
                          className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
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
                    <button
                      type="button"
                      onClick={() => startCheckout(subscription)}
                      disabled={!canCheckout || startingCheckoutId === subscription.id}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CreditCardIcon className="h-5 w-5" />
                      {startingCheckoutId === subscription.id ? 'Opening...' : isActive ? 'Billing Active' : 'Set Up Payment'}
                    </button>
                    {!canCheckout && !isActive && (
                      <p className="mt-2 text-xs text-slate-500">Payment setup appears when the company has online billing ready.</p>
                    )}
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
                <p className="font-bold">Cash and check payments may still show here.</p>
                <p className="mt-1">
                  Companies can record payments received outside the app, so this history includes both online and offline payment activity.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default ClientBilling;
