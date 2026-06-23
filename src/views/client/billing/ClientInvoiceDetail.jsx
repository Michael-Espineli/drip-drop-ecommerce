import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import PaymentMethodSelector from '../../../components/sales/PaymentMethodSelector';
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { db, functions } from '../../../utils/config';
import {
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

const statusTone = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  open: 'border-sky-200 bg-sky-50 text-sky-700',
  partiallypaid: 'border-amber-200 bg-amber-50 text-amber-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
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

const Field = ({ label, value }) => (
  <div>
    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-sm font-semibold text-slate-950">{value || 'Not set'}</dd>
  </div>
);

const ClientInvoiceDetail = () => {
  const { invoiceId } = useParams();
  const location = useLocation();
  const { user } = useContext(Context);
  const [invoice, setInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState(SalesPaymentMethodType.ach);
  const isPublicInvoiceRoute = location.pathname.startsWith('/customer/invoices/');
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const emailParam = queryParams.get('email') || '';
  const accessToken = queryParams.get('accessToken') || queryParams.get('reviewToken') || '';

  useEffect(() => {
    const checkoutResult = queryParams.get('stripeCheckout');
    if (checkoutResult === 'success') {
      toast.success('Payment setup returned from Stripe.');
    }
  }, [queryParams]);

  useEffect(() => {
    if (!invoiceId) {
      setInvoice(null);
      setLoading(false);
      setError('Missing invoice id.');
      return undefined;
    }

    setLoading(true);
    setError('');

    if (isPublicInvoiceRoute) {
      if (!accessToken) {
        setInvoice(null);
        setPayments([]);
        setBillingSubscription(null);
        setError('Open the invoice from the latest invoice email link.');
        setLoading(false);
        return undefined;
      }

      let isActive = true;

      const loadPublicInvoice = async () => {
        try {
          const getPublicInvoice = httpsCallable(functions, 'getPublicSalesInvoice');
          const result = await getPublicInvoice({
            invoiceId,
            email: emailParam,
            accessToken,
          });

          if (!isActive) return;

          setInvoice(result.data?.invoice || null);
          setPayments(Array.isArray(result.data?.payments) ? result.data.payments : []);
          setBillingSubscription(result.data?.billingSubscription || null);
          if (!result.data?.invoice) setError('Invoice not found.');
        } catch (loadError) {
          console.error('Unable to load public invoice', loadError);
          if (isActive) {
            setInvoice(null);
            setPayments([]);
            setBillingSubscription(null);
            setError(loadError.message || 'Unable to verify this invoice link.');
          }
        } finally {
          if (isActive) setLoading(false);
        }
      };

      loadPublicInvoice();

      return () => {
        isActive = false;
      };
    }

    return onSnapshot(
      doc(db, salesCollectionNames.invoices, invoiceId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setInvoice(null);
          setError('Invoice not found.');
          setLoading(false);
          return;
        }

        setInvoice({ id: snapshot.id, ...snapshot.data() });
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load invoice', snapshotError);
        setError(snapshotError.message || 'Unable to load invoice.');
        setLoading(false);
      }
    );
  }, [accessToken, emailParam, invoiceId, isPublicInvoiceRoute]);

  useEffect(() => {
    if (isPublicInvoiceRoute) return undefined;

    if (!invoiceId || !user?.uid) {
      setPayments([]);
      return undefined;
    }

    const paymentMap = new Map();

    const publish = (snapshot) => {
      snapshot.docs.forEach((paymentDoc) => {
        paymentMap.set(paymentDoc.id, { id: paymentDoc.id, ...paymentDoc.data() });
      });

      const nextPayments = Array.from(paymentMap.values()).sort(
        (left, right) => toMillis(right.receivedAt || right.createdAt) - toMillis(left.receivedAt || left.createdAt)
      );
      setPayments(nextPayments);
    };

    const onError = (snapshotError) => {
      console.error('Unable to load invoice payments', snapshotError);
    };

    const unsubscribes = [
      onSnapshot(
        query(
          collection(db, salesCollectionNames.payments),
          where('invoiceId', '==', invoiceId),
          where('customerUserId', '==', user.uid)
        ),
        publish,
        onError
      ),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [invoiceId, isPublicInvoiceRoute, user]);

  useEffect(() => {
    if (isPublicInvoiceRoute) return undefined;

    const billingSubscriptionId = invoice?.billingSubscriptionId;
    if (!billingSubscriptionId || !user?.uid) {
      setBillingSubscription(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, salesCollectionNames.billingSubscriptions, billingSubscriptionId),
      (snapshot) => {
        setBillingSubscription(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (snapshotError) => {
        console.error('Unable to load billing subscription', snapshotError);
      }
    );
  }, [invoice?.billingSubscriptionId, isPublicInvoiceRoute, user?.uid]);

  const lineItems = useMemo(
    () => (Array.isArray(invoice?.lineItems) ? invoice.lineItems : []),
    [invoice]
  );
  const balanceCents = invoice ? invoiceBalanceCents(invoice) : 0;
  const invoiceReviewPath = `${location.pathname || `/customer/invoices/${invoiceId}`}${location.search || ''}`;
  const redirectParam = encodeURIComponent(invoiceReviewPath);
  const signInPath = `/homeownerSignIn?redirect=${redirectParam}`;
  const signUpEmail = invoice?.email || emailParam;
  const signUpPath = `/homeownerSignUp?redirect=${redirectParam}${signUpEmail ? `&email=${encodeURIComponent(signUpEmail)}` : ''}`;
  const backPath = isPublicInvoiceRoute ? '/' : '/client/finance';
  const backLabel = isPublicInvoiceRoute ? 'Drip Drop' : 'Finance';
  const subscriptionStatusKey = normalizeStatus(billingSubscription?.stripeStatus || billingSubscription?.status);
  const hasActiveStripeSubscription = ['active', 'trialing'].includes(subscriptionStatusKey);
  const billingSubscriptionId = billingSubscription?.id || invoice?.billingSubscriptionId || '';
  const billingSetupReady = Boolean(
    billingSubscriptionId &&
    (billingSubscription?.stripeConnectedAccountReady || billingSubscription?.stripeConnectedAccountId)
  );
  const canStartCheckout = Boolean(
    user?.uid &&
    invoice &&
    billingSetupReady &&
    !hasActiveStripeSubscription &&
    Number(billingSubscription?.amountCents || invoice.totalAmountCents || 0) > 0 &&
    !startingCheckout
  );

  const checkoutReturnUrl = (checkoutStatus) => {
    const url = new URL(window.location.href);
    url.searchParams.set('stripeCheckout', checkoutStatus);
    if (billingSubscriptionId) url.searchParams.set('billingSubscriptionId', billingSubscriptionId);
    return url.toString();
  };

  const startCheckout = async () => {
    if (!canStartCheckout) return;

    setStartingCheckout(true);

    try {
      const startCheckoutCallable = httpsCallable(functions, 'createSalesBillingSubscriptionCheckoutSession');
      const authPayload = await getCallableAuthPayload();
      const result = await startCheckoutCallable({
        ...authPayload,
        billingSubscriptionId,
        agreementId: invoice.agreementId || billingSubscription?.agreementId || '',
        companyId: invoice.companyId || billingSubscription?.companyId || '',
        paymentMethodType: selectedPaymentMethodType,
        successUrl: checkoutReturnUrl('success'),
        cancelUrl: checkoutReturnUrl('canceled'),
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
      console.error('Unable to start Stripe Checkout', checkoutError);
      toast.error(checkoutError.message || 'Failed to start Stripe Checkout.');
    } finally {
      setStartingCheckout(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Loading invoice...
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <Link to={backPath} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
          <ArrowLeftIcon className="h-4 w-4" />
          {backLabel}
        </Link>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
          <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-rose-500" />
          <p className="mt-3 font-semibold text-rose-800">{error || 'Invoice not found.'}</p>
          {isPublicInvoiceRoute && (
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <Link
                to={signInPath}
                className="inline-flex justify-center rounded-md bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700"
              >
                Sign In
              </Link>
              <Link
                to="/"
                className="inline-flex justify-center rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100"
              >
                Drip Drop
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to={backPath} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
            <ArrowLeftIcon className="h-4 w-4" />
            {backLabel}
          </Link>
          <h1 className="text-3xl font-bold text-slate-950">{invoice.invoiceNumber || 'Invoice'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {invoice.companyName || 'Pool company'} sent this invoice to {invoice.email || emailParam || user?.email || 'your account'}.
          </p>
        </div>

        <StatusBadge status={invoice.status || SalesInvoiceStatus.draft} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Invoice Summary</h2>
                  <p className="mt-1 text-sm text-slate-500">{invoice.memo || 'Review the invoice details and balance below.'}</p>
                </div>
                <DocumentTextIcon className="h-6 w-6 text-slate-400" />
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Total" value={formatCurrency(invoice.totalAmountCents)} />
              <Field label="Paid" value={formatCurrency(invoice.amountPaidCents)} />
              <Field label="Balance" value={formatCurrency(balanceCents)} />
              <Field label="Due Date" value={formatDate(invoice.dueDate)} />
            </dl>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-lg font-bold text-slate-950">Line Items</h2>
            </div>

            {lineItems.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No line items were included.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Item</th>
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Qty</th>
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Unit</th>
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {lineItems.map((item) => (
                      <tr key={item.id || item.catalogItemId || item.name}>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-950">{item.name || item.description || 'Service'}</p>
                          {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                        </td>
                        <td className="px-5 py-4 text-slate-700">{Number(item.quantity || 1)}</td>
                        <td className="px-5 py-4 text-slate-700">{formatCurrency(item.unitAmountCents)}</td>
                        <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(item.totalAmountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {invoice.memo && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Memo</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{invoice.memo}</p>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <BanknotesIcon className="h-5 w-5 text-slate-400" />
              Payment
            </h2>
            <dl className="mt-5 space-y-4">
              <Field label="Amount Due" value={formatCurrency(balanceCents)} />
              <Field label="Status" value={labelize(invoice.status)} />
              <Field label="Last Payment" value={formatDate(invoice.lastPaymentAt || invoice.paidAt)} />
            </dl>

            {invoice.stripeHostedInvoiceUrl && (
              <a
                href={invoice.stripeHostedInvoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
              >
                Pay Stripe Invoice
              </a>
            )}

            {invoice.stripeInvoicePdfUrl && (
              <a
                href={invoice.stripeInvoicePdfUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100"
              >
                Download PDF
              </a>
            )}

            {billingSubscriptionId && (
              <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-bold text-slate-900">Recurring Billing Setup</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Set up automatic billing for future recurring service charges from your homeowner account.
                </p>

                {user?.uid ? (
                  <div className="mt-4 space-y-3">
                    <PaymentMethodSelector
                      amountCents={billingSubscription?.amountCents || invoice.totalAmountCents || balanceCents}
                      value={selectedPaymentMethodType}
                      onChange={setSelectedPaymentMethodType}
                      disabled={!canStartCheckout}
                      compact
                    />
                    {hasActiveStripeSubscription ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                        Billing is active.
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={startCheckout}
                        disabled={!canStartCheckout}
                        className="inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {startingCheckout ? 'Opening Stripe...' : 'Set Up Recurring Billing'}
                      </button>
                    )}
                    {!canStartCheckout && !hasActiveStripeSubscription && (
                      <p className="text-xs text-slate-500">
                        Billing setup appears when this invoice is tied to an online billing subscription.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    <Link
                      to={signInPath}
                      className="inline-flex w-full justify-center rounded-md bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
                    >
                      Sign In To Set Up Billing
                    </Link>
                    <Link
                      to={signUpPath}
                      className="inline-flex w-full justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100"
                    >
                      Create Homeowner Account
                    </Link>
                  </div>
                )}
              </div>
            )}

            {!invoice.stripeHostedInvoiceUrl && balanceCents > 0 && !billingSubscriptionId && (
              <p className="mt-4 text-xs text-slate-500">
                This invoice does not have an online payment link yet. Contact the company or use their normal payment instructions.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Payment History</h2>
            <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
              {payments.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No payments recorded for this invoice.</div>
              ) : payments.map((payment) => (
                <div key={payment.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                      <p className="mt-1 text-xs text-slate-500">{labelize(payment.method)} - {formatDate(payment.receivedAt || payment.createdAt)}</p>
                    </div>
                    <StatusBadge status={payment.status || SalesPaymentStatus.posted} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Details</h2>
            <dl className="mt-5 space-y-4">
              <Field label="Company" value={invoice.companyName || 'Pool company'} />
              <Field label="Invoice Reference" value={invoice.invoiceNumber || 'Invoice'} />
              <Field label="Sent" value={formatDate(invoice.sentAt)} />
              <Field label="Created" value={formatDate(invoice.createdAt)} />
            </dl>
            {invoice.agreementId && !isPublicInvoiceRoute && (
              <Link to={`/client/service-agreements/${invoice.agreementId}`} className="mt-5 inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                View Service Agreement
              </Link>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};

export default ClientInvoiceDetail;
