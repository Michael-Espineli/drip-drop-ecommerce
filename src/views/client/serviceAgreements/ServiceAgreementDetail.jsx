import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CreditCardIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { db, functions } from '../../../utils/config';
import {
  SalesAgreementStatus,
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
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const customerCanViewAgreement = (agreement = {}, user = {}) => {
  const customerUserId = String(agreement.customerUserId || '').trim();
  if (customerUserId) return customerUserId === user?.uid;

  const authEmail = normalizeEmail(user?.email);
  const agreementEmail = normalizeEmail(agreement.email || agreement.customerEmail || agreement.billingEmail);
  return Boolean(authEmail && agreementEmail && authEmail === agreementEmail);
};

const statusTone = {
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  revised: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  expired: 'border-slate-200 bg-slate-100 text-slate-600',
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

const ServiceAgreementDetail = () => {
  const { agreementId } = useParams();
  const location = useLocation();
  const { user } = useContext(Context);
  const userId = user?.uid;
  const userEmail = user?.email;
  const [agreement, setAgreement] = useState(null);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [acceptanceNote, setAcceptanceNote] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    if (!agreementId) {
      setError('Missing service agreement id.');
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      doc(db, salesCollectionNames.agreements, agreementId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setAgreement(null);
          setError('Service agreement not found.');
          setLoading(false);
          return;
        }

        const nextAgreement = { id: snapshot.id, ...snapshot.data() };
        if (userId && !customerCanViewAgreement(nextAgreement, { uid: userId, email: userEmail })) {
          setAgreement(null);
          setError('This service agreement does not belong to your account.');
          setLoading(false);
          return;
        }

        setAgreement(nextAgreement);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load service agreement', snapshotError);
        setError(snapshotError.message || 'Unable to load service agreement.');
        setLoading(false);
      }
    );
  }, [agreementId, userEmail, userId]);

  useEffect(() => {
    const subscriptionId = agreement?.billingSubscriptionId;
    if (!subscriptionId) {
      setBillingSubscription(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, salesCollectionNames.billingSubscriptions, subscriptionId),
      (snapshot) => {
        setBillingSubscription(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (snapshotError) => {
        console.error('Unable to load billing subscription', snapshotError);
      }
    );
  }, [agreement?.billingSubscriptionId]);

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    if (queryParams.get('stripeCheckout') === 'success') {
      toast.success('Payment setup returned from Stripe.');
    }
  }, [location.search]);

  const lineItems = useMemo(
    () => (Array.isArray(agreement?.lineItems) ? agreement.lineItems : []),
    [agreement]
  );

  const termsList = useMemo(
    () => (Array.isArray(agreement?.termsList) ? agreement.termsList : []),
    [agreement]
  );

  const statusKey = normalizeStatus(agreement?.status);
  const isAccepted = statusKey === normalizeStatus(SalesAgreementStatus.accepted);
  const isClosed = ['canceled', 'rejected', 'expired'].includes(statusKey);
  const isSignedIn = Boolean(userId);
  const redirectParam = encodeURIComponent(`/client/service-agreements/${agreementId}`);
  const signInPath = `/homeownerSignIn?redirect=${redirectParam}`;
  const signUpPath = `/homeownerSignUp?redirect=${redirectParam}${agreement?.email ? `&email=${encodeURIComponent(agreement.email)}` : ''}`;
  const canAccept = Boolean(isSignedIn && agreement && !isAccepted && !isClosed && !accepting);
  const effectiveSubscriptionId = billingSubscription?.id || agreement?.billingSubscriptionId;
  const subscriptionStatusKey = normalizeStatus(billingSubscription?.stripeStatus || billingSubscription?.status);
  const hasActiveStripeSubscription = ['active', 'trialing'].includes(subscriptionStatusKey);
  const canStartCheckout = Boolean(
    isSignedIn &&
    agreement &&
    effectiveSubscriptionId &&
    !hasActiveStripeSubscription &&
    billingSubscription?.stripeConnectedAccountId &&
    Number(billingSubscription?.amountCents || agreement?.totalAmountCents || 0) > 0 &&
    !startingCheckout
  );

  const acceptAgreement = async () => {
    if (!isSignedIn) {
      toast.error('Sign in with the customer email on this agreement before accepting.');
      return;
    }

    if (!canAccept) return;

    if (!acceptedTerms) {
      toast.error('Confirm that you have reviewed the service agreement.');
      return;
    }

    setAccepting(true);

    try {
      const acceptCallable = httpsCallable(functions, 'acceptSalesServiceAgreement');
      const authPayload = await getCallableAuthPayload();
      const result = await acceptCallable({
        ...authPayload,
        agreementId: agreement.id,
        acceptanceNote,
      });

      toast.success('Service agreement accepted.');

      if (result.data?.customerCanPayImmediately) {
        setBillingSubscription((current) => ({
          ...(current || {}),
          id: result.data.billingSubscriptionId,
          customerCanPayImmediately: true,
        }));
      }
    } catch (acceptError) {
      console.error('Unable to accept service agreement', acceptError);
      toast.error(acceptError.message || 'Failed to accept service agreement.');
    } finally {
      setAccepting(false);
    }
  };

  const startCheckout = async () => {
    if (!canStartCheckout) return;

    setStartingCheckout(true);

    try {
      const startCheckoutCallable = httpsCallable(functions, 'createSalesBillingSubscriptionCheckoutSession');
      const authPayload = await getCallableAuthPayload();
      const result = await startCheckoutCallable({
        ...authPayload,
        billingSubscriptionId: effectiveSubscriptionId,
        agreementId: agreement.id,
        companyId: agreement.companyId,
        successUrl: `${window.location.origin}/client/service-agreements/${encodeURIComponent(agreement.id)}?stripeCheckout=success`,
        cancelUrl: `${window.location.origin}/client/service-agreements/${encodeURIComponent(agreement.id)}?stripeCheckout=canceled`,
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
          Loading service agreement...
        </div>
      </div>
    );
  }

  if (error || !agreement) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <Link to="/client/service-agreements" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
          <ArrowLeftIcon className="h-4 w-4" />
          Service Agreements
        </Link>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
          <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-rose-500" />
          <p className="mt-3 font-semibold text-rose-800">{error || 'Service agreement not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/client/service-agreements" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
            <ArrowLeftIcon className="h-4 w-4" />
            Service Agreements
          </Link>
          <h1 className="text-3xl font-bold text-slate-950">{agreement.title || 'Service Agreement'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {agreement.companyName || 'Pool company'} sent this agreement to {agreement.email || user?.email || 'your account'}.
          </p>
        </div>

        <StatusBadge status={agreement.status || SalesAgreementStatus.draft} />
      </div>

      {isAccepted && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none" />
            <div>
              <p className="font-bold">Agreement accepted</p>
              <p className="mt-1">
                Accepted {formatDate(agreement.acceptedAt)} by {agreement.acceptedByUserName || agreement.acceptedByEmail || 'this customer'}.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Agreement Summary</h2>
                  <p className="mt-1 text-sm text-slate-500">{agreement.description || 'Review the service and billing terms below.'}</p>
                </div>
                <DocumentTextIcon className="h-6 w-6 text-slate-400" />
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Total" value={formatCurrency(agreement.totalAmountCents || agreement.rateAmountCents)} />
              <Field label="Cadence" value={labelize(agreement.serviceCadence || agreement.rateType)} />
              <Field label="Payment Terms" value={labelize(agreement.paymentTerms)} />
              <Field label="Start Date" value={formatDate(agreement.startDate)} />
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

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-lg font-bold text-slate-950">Terms</h2>
              {agreement.termsTemplateName && (
                <p className="mt-1 text-sm text-slate-500">{agreement.termsTemplateName}</p>
              )}
            </div>

            <div className="space-y-4 p-5">
              {termsList.length > 0 && (
                <div className="space-y-3">
                  {termsList.map((term, index) => {
                    const title = typeof term === 'string'
                      ? `Term ${index + 1}`
                      : term.title || term.label || `Term ${index + 1}`;
                    const description = typeof term === 'string'
                      ? term
                      : term.description || term.value || term.text || '';

                    return (
                      <div key={term.id || index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="font-semibold text-slate-950">{title}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{description}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {agreement.terms ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{agreement.terms}</p>
              ) : termsList.length === 0 ? (
                <p className="text-sm text-slate-500">No written terms were included.</p>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Acceptance</h2>
            <p className="mt-1 text-sm text-slate-500">
              Accepting records your approval and creates the billing setup record for this agreement.
            </p>

            <dl className="mt-5 space-y-4">
              <Field label="Customer" value={agreement.customerName || user?.email} />
              <Field label="Sent" value={formatDate(agreement.sentAt || agreement.createdAt)} />
              <Field label="Expires" value={formatDate(agreement.expiresAt)} />
              <Field label="Billing Setup" value={billingSubscription?.id ? labelize(billingSubscription.status || billingSubscription.stripeStatus) : 'Not created'} />
            </dl>

            {!isAccepted && !isClosed && (
              <div className="mt-5 space-y-4">
                {!isSignedIn && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-semibold">Sign in required</p>
                    <p className="mt-1">Use the customer account or create one with the email on this agreement before accepting.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Link
                        to={signInPath}
                        className="inline-flex justify-center rounded-md bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
                      >
                        Sign In
                      </Link>
                      <Link
                        to={signUpPath}
                        className="inline-flex justify-center rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                      >
                        Create Account
                      </Link>
                    </div>
                  </div>
                )}

                <label className="block text-sm font-semibold text-slate-700" htmlFor="acceptanceNote">
                  Note
                  <textarea
                    id="acceptanceNote"
                    value={acceptanceNote}
                    onChange={(event) => setAcceptanceNote(event.target.value)}
                    className="mt-1 h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Optional"
                  />
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-700">
                    I reviewed the agreement, pricing, and terms.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={acceptAgreement}
                  disabled={!canAccept || accepting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                  {accepting ? 'Accepting...' : 'Accept Agreement'}
                </button>
              </div>
            )}

            {isClosed && (
              <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                This agreement is no longer available for acceptance.
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <CreditCardIcon className="h-5 w-5 text-slate-400" />
              Payment Setup
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              After accepting, you can continue to Stripe if the company has online billing ready.
            </p>

            <dl className="mt-5 space-y-4">
              <Field label="Amount" value={formatCurrency(billingSubscription?.amountCents || agreement.totalAmountCents || agreement.rateAmountCents)} />
              <Field label="Status" value={labelize(billingSubscription?.stripeStatus || billingSubscription?.status || agreement.billingFlowStatus)} />
              <Field label="Next Action" value={labelize(billingSubscription?.nextAction || agreement.billingFlowNextAction)} />
            </dl>

            {billingSubscription?.checkoutUrl && !hasActiveStripeSubscription && (
              <a
                href={billingSubscription.checkoutUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100"
              >
                Existing Checkout Link
              </a>
            )}

            {hasActiveStripeSubscription ? (
              <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                Billing is active.
              </div>
            ) : (
              <button
                type="button"
                onClick={startCheckout}
                disabled={!canStartCheckout}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CreditCardIcon className="h-5 w-5" />
                {startingCheckout ? 'Opening Stripe...' : 'Set Up Payment'}
              </button>
            )}

            {!canStartCheckout && !hasActiveStripeSubscription && (
              <p className="mt-3 text-xs text-slate-500">
                Payment setup appears after the agreement is accepted and the company billing account is ready.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};

export default ServiceAgreementDetail;
