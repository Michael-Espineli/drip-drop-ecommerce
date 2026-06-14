import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, serverTimestamp, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaBan,
  FaCreditCard,
  FaEdit,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaFileContract,
  FaRoute,
  FaSave,
  FaSyncAlt,
  FaTimes,
  FaTrash,
  FaUndo,
  FaUpload,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { db, functions } from '../../../utils/config';
import {
  SalesBillingCollectionMethod,
  SalesBillingSubscriptionStatus,
  SalesInvoiceDeliveryMethod,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import {
  formatBillingFrequency,
  formatServiceFrequency,
} from '../../../utils/sales/agreementCadence';
import {
  createManualSubscriptionInvoice,
  getSubscriptionBillingPeriodPreview,
} from '../../../utils/sales/manualBilling';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const canDeleteBillingSubscriptionRecord = (subscription = {}) => (
  !subscription?.stripeSubscriptionId ||
  normalizeStatus(subscription.stripeStatus || subscription.status) === 'canceled'
);

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

const toInputDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return '';
  return new Date(millis).toISOString().split('T')[0];
};

const dateFromInput = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const centsToInput = (amountCents = 0) => ((Number(amountCents) || 0) / 100).toFixed(2);

const moneyInputToCents = (value) => Math.round((Number(value) || 0) * 100);

const statusTone = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  trialing: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  pendingpaymentmethod: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingstripe: 'border-amber-200 bg-amber-50 text-amber-700',
  notstarted: 'border-slate-200 bg-slate-50 text-slate-700',
  pastdue: 'border-rose-200 bg-rose-50 text-rose-700',
  paused: 'border-slate-200 bg-slate-100 text-slate-600',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.notstarted;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const Field = ({ label, value, children }) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{children || value || 'Not set'}</dd>
  </div>
);

const TextInput = ({ label, value, onChange, type = 'text', min, step }) => (
  <label className="space-y-1.5">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    <input
      type={type}
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
    />
  </label>
);

const SelectInput = ({ label, value, onChange, options }) => (
  <label className="space-y-1.5">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
    >
      {options.map((option) => (
        <option key={option} value={option}>{labelize(option)}</option>
      ))}
    </select>
  </label>
);

const createDraft = (subscription) => ({
  customerName: subscription?.customerName || '',
  email: subscription?.email || '',
  status: subscription?.status || SalesBillingSubscriptionStatus.notStarted,
  amount: centsToInput(subscription?.amountCents),
  currency: subscription?.currency || 'usd',
  interval: subscription?.interval || 'month',
  intervalCount: String(subscription?.intervalCount || 1),
  billingFrequency: subscription?.billingFrequency || '',
  billingFrequencyCount: String(subscription?.billingFrequencyCount || subscription?.intervalCount || 1),
  serviceCadence: subscription?.serviceCadence || '',
  serviceCadenceCount: String(subscription?.serviceCadenceCount || 1),
  rateType: subscription?.rateType || '',
  paymentTerms: subscription?.paymentTerms || 'dueOnReceipt',
  invoiceDeliveryMethod: subscription?.invoiceDeliveryMethod || SalesInvoiceDeliveryMethod.email,
  nextAction: subscription?.nextAction || 'collectPaymentMethod',
  currentPeriodStart: toInputDate(subscription?.currentPeriodStart),
  currentPeriodEnd: toInputDate(subscription?.currentPeriodEnd),
  cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
  customerCanPayImmediately: Boolean(subscription?.customerCanPayImmediately),
  applicationFeePercent: subscription?.applicationFeePercent === null || subscription?.applicationFeePercent === undefined
    ? ''
    : String(subscription.applicationFeePercent),
  serviceLocationIds: Array.isArray(subscription?.serviceLocationIds) ? subscription.serviceLocationIds.join(', ') : '',
});

const SalesBillingSubscriptionDetail = () => {
  const { billingSubscriptionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId, user } = useContext(Context);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [stripeAction, setStripeAction] = useState('');
  const [creatingManualInvoice, setCreatingManualInvoice] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!billingSubscriptionId) {
      setSubscription(null);
      setLoading(false);
      setError('Missing billing subscription id.');
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      doc(db, salesCollectionNames.billingSubscriptions, billingSubscriptionId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setSubscription(null);
          setError('Billing subscription not found.');
          setLoading(false);
          return;
        }

        const nextSubscription = { id: snapshot.id, ...snapshot.data() };
        setSubscription(nextSubscription);
        setDraft((current) => (current && editing ? current : createDraft(nextSubscription)));
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load billing subscription', snapshotError);
        setError(snapshotError.message || 'Unable to load billing subscription.');
        setLoading(false);
      }
    );
  }, [billingSubscriptionId, editing]);

  const companyMismatch = Boolean(
    subscription &&
    recentlySelectedCompany &&
    subscription.companyId &&
    subscription.companyId !== recentlySelectedCompany
  );
  const statusKey = normalizeStatus(subscription?.stripeStatus || subscription?.status);
  const hasActiveStripeSubscription = ['active', 'trialing'].includes(statusKey);
  const billingCollectionMethod = subscription?.billingCollectionMethod || SalesBillingCollectionMethod.manualUntilAutopay;
  const isStripeManagedBilling = billingCollectionMethod === SalesBillingCollectionMethod.automaticStripe || hasActiveStripeSubscription;
  const manualBillingAllowed = Boolean(subscription?.manualBillingEnabled !== false && !isStripeManagedBilling);
  const billingWorkflowLabel = isStripeManagedBilling ? 'Automatic Stripe billing' : 'Manual invoices until autopay';
  const receiptWorkflowLabel = subscription?.receiptsEnabled === false
    ? 'Receipts disabled'
    : labelize(subscription?.receiptDeliveryMethod || subscription?.invoiceDeliveryMethod || SalesInvoiceDeliveryMethod.email);
  const canStartCheckout = Boolean(
    subscription &&
    !companyMismatch &&
    !isStripeManagedBilling &&
    !hasActiveStripeSubscription &&
    Number(subscription.amountCents || 0) > 0 &&
    subscription.stripeConnectedAccountId &&
    !startingCheckout &&
    !stripeAction
  );
  const canCreateManualInvoice = Boolean(
    subscription &&
    !companyMismatch &&
    manualBillingAllowed &&
    !hasActiveStripeSubscription &&
    !editing &&
    !creatingManualInvoice &&
    Number(subscription.amountCents || 0) > 0
  );

  const lineItems = useMemo(
    () => (Array.isArray(subscription?.lineItems) ? subscription.lineItems : []),
    [subscription]
  );
  const hasStripeSubscription = Boolean(subscription?.stripeSubscriptionId);
  const lineItemsMissingStripePrices = lineItems.filter((item) => !item.stripePriceId);
  const subscriptionCompanyId = subscription?.companyId || recentlySelectedCompany || '';
  const canSyncStripe = Boolean(hasStripeSubscription && !companyMismatch && !stripeAction);
  const canApplyStripePricing = Boolean(hasStripeSubscription && !companyMismatch && !editing && !stripeAction && lineItems.length > 0);
  const canCancelStripe = Boolean(
    hasStripeSubscription &&
    !companyMismatch &&
    !subscription?.cancelAtPeriodEnd &&
    !['canceled'].includes(statusKey) &&
    !stripeAction
  );
  const canResumeStripe = Boolean(
    hasStripeSubscription &&
    !companyMismatch &&
    subscription?.cancelAtPeriodEnd &&
    !['canceled'].includes(statusKey) &&
    !stripeAction
  );
  const canDeleteSubscription = Boolean(
    subscription &&
    editing &&
    !companyMismatch &&
    !deleting &&
    canDeleteBillingSubscriptionRecord(subscription)
  );
  const firstServiceLocationId = Array.isArray(subscription?.serviceLocationIds)
    ? subscription.serviceLocationIds.find(Boolean) || ''
    : '';
  const recurringSetupStatus = subscription?.operationsSetupStatus || subscription?.agreementSnapshot?.operationsSetupStatus || 'needsRecurringServiceStop';
  const hasRecurringServiceStop = Boolean(subscription?.recurringServiceStopId || subscription?.agreementSnapshot?.recurringServiceStopId);
  const returnTo = `${location.pathname}${location.search}`;
  const recurringSetupQuery = new URLSearchParams({
    agreementId: subscription?.agreementId || '',
    billingSubscriptionId: subscription?.id || '',
    serviceLocationId: firstServiceLocationId,
    returnTo,
  });
  const recurringSetupUrl = `/company/recurring-service-stops/create/${encodeURIComponent(subscription?.customerId || 'NA')}?${recurringSetupQuery.toString()}`;
  const manualInvoicePreview = useMemo(
    () => (subscription ? getSubscriptionBillingPeriodPreview(subscription) : null),
    [subscription]
  );

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const startEditing = () => {
    setDraft(createDraft(subscription));
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(createDraft(subscription));
    setEditing(false);
  };

  const saveSubscription = async (event) => {
    event.preventDefault();
    if (!subscription || !draft || saving || companyMismatch) return;

    const amountCents = moneyInputToCents(draft.amount);
    const intervalCount = Math.max(Number(draft.intervalCount || 1), 1);
    const serviceLocationIds = draft.serviceLocationIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const applicationFeePercent = draft.applicationFeePercent === ''
      ? null
      : Number(draft.applicationFeePercent);

    if (amountCents < 0) {
      toast.error('Amount cannot be negative.');
      return;
    }

    if (applicationFeePercent !== null && (!Number.isFinite(applicationFeePercent) || applicationFeePercent < 0)) {
      toast.error('Application fee percent must be a positive number.');
      return;
    }

    setSaving(true);

    try {
      const updatePayload = {
        customerName: draft.customerName.trim(),
        email: draft.email.trim(),
        status: draft.status,
        amountCents,
        currency: draft.currency.trim().toLowerCase() || 'usd',
        interval: draft.interval,
        intervalCount,
        billingFrequency: draft.billingFrequency.trim(),
        billingFrequencyCount: Math.max(Number(draft.billingFrequencyCount || 1), 1),
        serviceCadence: draft.serviceCadence.trim(),
        serviceCadenceCount: Math.max(Number(draft.serviceCadenceCount || 1), 1),
        rateType: draft.rateType.trim(),
        paymentTerms: draft.paymentTerms,
        invoiceDeliveryMethod: draft.invoiceDeliveryMethod,
        nextAction: draft.nextAction.trim() || 'collectPaymentMethod',
        currentPeriodStart: dateFromInput(draft.currentPeriodStart),
        currentPeriodEnd: dateFromInput(draft.currentPeriodEnd),
        cancelAtPeriodEnd: Boolean(draft.cancelAtPeriodEnd),
        customerCanPayImmediately: Boolean(draft.customerCanPayImmediately),
        applicationFeePercent,
        serviceLocationIds,
        updatedAt: serverTimestamp(),
        updatedByUserId: user?.uid || '',
      };

      await updateDoc(doc(db, salesCollectionNames.billingSubscriptions, subscription.id), updatePayload);

      if (subscription.agreementId) {
        await updateDoc(doc(db, salesCollectionNames.agreements, subscription.agreementId), {
          billingFlowStatus: updatePayload.status,
          billingFlowNextAction: updatePayload.nextAction,
          billingFlowUpdatedAt: serverTimestamp(),
          customerCanPayImmediately: updatePayload.customerCanPayImmediately,
          updatedAt: serverTimestamp(),
        });
      }

      toast.success('Billing subscription updated.');
      setEditing(false);
    } catch (saveError) {
      console.error('Unable to update billing subscription', saveError);
      toast.error(saveError.message || 'Failed to update billing subscription.');
    } finally {
      setSaving(false);
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
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        companyId: subscription.companyId || recentlySelectedCompany,
        successUrl: `${window.location.origin}/company/sales/subscriptions/${encodeURIComponent(subscription.id)}?stripeCheckout=success`,
        cancelUrl: `${window.location.origin}/company/sales/subscriptions/${encodeURIComponent(subscription.id)}?stripeCheckout=canceled`,
      });

      if (result.data?.url) {
        window.location.href = result.data.url;
        return;
      }

      if (result.data?.status === 'already_active') {
        toast.success('This billing subscription is already active in Stripe.');
        return;
      }

      throw new Error(result.data?.message || 'Stripe did not return a Checkout URL.');
    } catch (checkoutError) {
      console.error('Unable to start Stripe Checkout', checkoutError);
      toast.error(checkoutError.message || 'Failed to start Stripe Checkout.');
      setStartingCheckout(false);
    }
  };

  const createManualInvoice = async () => {
    if (!canCreateManualInvoice) return;

    setCreatingManualInvoice(true);

    try {
      const result = await createManualSubscriptionInvoice(db, subscription, {
        companyName: recentlySelectedCompanyName,
        stripeConnectedAccountId,
        userId: user?.uid || '',
      });

      toast.success(result.created ? 'Manual recurring invoice created.' : 'Invoice for this billing period already exists.');
      navigate(`/company/sales/invoices/${result.invoiceId}`);
    } catch (invoiceError) {
      console.error('Unable to create manual recurring invoice', invoiceError);
      toast.error(invoiceError.message || 'Failed to create manual invoice.');
    } finally {
      setCreatingManualInvoice(false);
    }
  };

  const runStripeAction = async ({ callableName, payload = {}, successMessage }) => {
    if (!subscription || !subscriptionCompanyId || stripeAction || companyMismatch) return;

    setStripeAction(callableName);

    try {
      const callable = httpsCallable(functions, callableName);
      const result = await callable({
        billingSubscriptionId: subscription.id,
        companyId: subscriptionCompanyId,
        ...payload,
      });

      toast.success(successMessage || result.data?.message || 'Stripe subscription updated.');
    } catch (actionError) {
      console.error(`Unable to run Stripe action ${callableName}`, actionError);
      toast.error(actionError.message || 'Unable to update Stripe subscription.');
    } finally {
      setStripeAction('');
    }
  };

  const syncStripeSubscription = () => runStripeAction({
    callableName: 'syncSalesBillingSubscriptionFromStripe',
    successMessage: 'Stripe subscription synced.',
  });

  const cancelStripeSubscription = () => runStripeAction({
    callableName: 'cancelSalesBillingSubscription',
    payload: { cancelAtPeriodEnd: true },
    successMessage: 'Stripe subscription will cancel at period end.',
  });

  const resumeStripeSubscription = () => runStripeAction({
    callableName: 'resumeSalesBillingSubscription',
    successMessage: 'Stripe subscription resumed.',
  });

  const applyPricingToStripe = () => runStripeAction({
    callableName: 'updateSalesBillingSubscriptionStripeItems',
    payload: { prorationBehavior: 'none' },
    successMessage: 'Stripe subscription pricing updated.',
  });

  const deleteBillingSubscription = async () => {
    if (!subscription || deleteConfirmation.trim().toUpperCase() !== 'DELETE' || deleting) return;

    if (!canDeleteBillingSubscriptionRecord(subscription)) {
      toast.error('Cancel the active Stripe billing subscription before deleting this billing record.');
      return;
    }

    setDeleting(true);

    try {
      const deleteBatch = writeBatch(db);
      deleteBatch.delete(doc(db, salesCollectionNames.billingSubscriptions, subscription.id));
      if (subscription.agreementId) {
        const agreementRef = doc(db, salesCollectionNames.agreements, subscription.agreementId);
        const agreementSnap = await getDoc(agreementRef);
        if (agreementSnap.exists()) {
          deleteBatch.update(agreementRef, {
            billingSubscriptionId: '',
            billingFlowStatus: 'notStarted',
            billingFlowNextAction: 'createBillingSubscription',
            billingFlowUpdatedAt: serverTimestamp(),
            autopayStatus: 'unavailable',
            customerCanPayImmediately: false,
            updatedAt: serverTimestamp(),
          });
        }
      }
      await deleteBatch.commit();

      toast.success('Billing subscription deleted.');
      navigate('/company/sales/subscriptions');
    } catch (deleteError) {
      console.error('Unable to delete billing subscription', deleteError);
      toast.error(deleteError.message || 'Failed to delete billing subscription.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-500">Loading billing subscription...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link to="/company/sales/subscriptions" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
                <FaArrowLeft className="text-xs" />
                Billing Subscriptions
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {recentlySelectedCompanyName || subscription?.companyName || 'Selected company'}
                </span>
                {subscription?.status && <StatusBadge status={subscription.stripeStatus || subscription.status} />}
              </div>
              <h1 className="mt-3 text-3xl font-bold text-slate-950">
                {subscription?.customerName || 'Billing Subscription'}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {subscription?.id}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {subscription?.agreementId && (
                <Link
                  to={`/company/sales/agreements/${subscription.agreementId}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <FaFileContract className="text-xs" />
                  Agreement
                </Link>
              )}
              <button
                type="button"
                onClick={startCheckout}
                disabled={!canStartCheckout}
                className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaCreditCard className="text-xs" />
                {startingCheckout ? 'Opening Stripe...' : hasActiveStripeSubscription ? 'Stripe Active' : 'Start Checkout'}
              </button>
              <button
                type="button"
                onClick={createManualInvoice}
                disabled={!canCreateManualInvoice}
                className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaFileInvoiceDollar className="text-xs" />
                {creatingManualInvoice ? 'Creating...' : 'Create Manual Invoice'}
              </button>
              {!editing ? (
                <button
                  type="button"
                  onClick={startEditing}
                  disabled={!subscription || companyMismatch}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaEdit className="text-xs" />
                  Edit
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(true);
                      setDeleteConfirmation('');
                    }}
                    disabled={!canDeleteSubscription}
                    title={canDeleteSubscription ? 'Delete billing subscription' : 'Cancel active Stripe billing before deleting'}
                    className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaTrash className="text-xs" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FaTimes className="text-xs" />
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {companyMismatch && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            This billing subscription belongs to another company. Select the matching company before editing.
          </div>
        )}

        {statusKey === 'pastdue' && !companyMismatch && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Stripe marked this subscription as past due. The next action is to collect or update the customer payment method before billing can continue normally.
          </div>
        )}

        {hasActiveStripeSubscription && editing && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            This subscription is active in Stripe. These edits update DripDrop billing records only; they do not change the Stripe subscription amount, price, or schedule yet.
          </div>
        )}

        {subscription && !companyMismatch && (
          <div className={`rounded-lg border p-4 text-sm ${isStripeManagedBilling ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="mt-0.5">
                {isStripeManagedBilling ? <FaCreditCard className="text-base" /> : <FaFileInvoiceDollar className="text-base" />}
              </div>
              <div>
                <p className="font-bold">{billingWorkflowLabel}</p>
                <p className="mt-1 leading-6">
                  {isStripeManagedBilling
                    ? 'Stripe is the billing source for this recurring agreement. DripDrop records invoices, payments, and receipt links from Stripe events, while manual recurring invoices stay disabled.'
                    : 'Manual recurring invoices are the default for this agreement until the customer completes automatic payment setup.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {subscription && !companyMismatch && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <main className="space-y-6">
              <form onSubmit={saveSubscription} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">Billing Setup</h2>
                  {editing && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaSave className="text-xs" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  )}
                </div>

                {editing ? (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <TextInput label="Customer Name" value={draft.customerName} onChange={(value) => updateDraft('customerName', value)} />
                    <TextInput label="Billing Email" value={draft.email} onChange={(value) => updateDraft('email', value)} type="email" />
                    <TextInput label="Amount" value={draft.amount} onChange={(value) => updateDraft('amount', value)} type="number" min="0" step="0.01" />
                    <TextInput label="Currency" value={draft.currency} onChange={(value) => updateDraft('currency', value)} />
                    <SelectInput
                      label="Status"
                      value={draft.status}
                      onChange={(value) => updateDraft('status', value)}
                      options={Object.values(SalesBillingSubscriptionStatus)}
                    />
                    <SelectInput
                      label="Interval"
                      value={draft.interval}
                      onChange={(value) => updateDraft('interval', value)}
                      options={['day', 'week', 'month', 'year']}
                    />
                    <TextInput label="Interval Count" value={draft.intervalCount} onChange={(value) => updateDraft('intervalCount', value)} type="number" min="1" step="1" />
                    <TextInput label="Billing Frequency" value={draft.billingFrequency} onChange={(value) => updateDraft('billingFrequency', value)} />
                    <TextInput label="Billing Count" value={draft.billingFrequencyCount} onChange={(value) => updateDraft('billingFrequencyCount', value)} type="number" min="1" step="1" />
                    <TextInput label="Service Cadence" value={draft.serviceCadence} onChange={(value) => updateDraft('serviceCadence', value)} />
                    <TextInput label="Service Count" value={draft.serviceCadenceCount} onChange={(value) => updateDraft('serviceCadenceCount', value)} type="number" min="1" step="1" />
                    <TextInput label="Rate Type" value={draft.rateType} onChange={(value) => updateDraft('rateType', value)} />
                    <SelectInput
                      label="Payment Terms"
                      value={draft.paymentTerms}
                      onChange={(value) => updateDraft('paymentTerms', value)}
                      options={['dueOnReceipt', 'net7', 'net14', 'net30', 'manual']}
                    />
                    <SelectInput
                      label="Invoice Delivery"
                      value={draft.invoiceDeliveryMethod}
                      onChange={(value) => updateDraft('invoiceDeliveryMethod', value)}
                      options={Object.values(SalesInvoiceDeliveryMethod)}
                    />
                    <TextInput label="Next Action" value={draft.nextAction} onChange={(value) => updateDraft('nextAction', value)} />
                    <TextInput label="Current Period Start" value={draft.currentPeriodStart} onChange={(value) => updateDraft('currentPeriodStart', value)} type="date" />
                    <TextInput label="Current Period End" value={draft.currentPeriodEnd} onChange={(value) => updateDraft('currentPeriodEnd', value)} type="date" />
                    <TextInput label="Application Fee Percent" value={draft.applicationFeePercent} onChange={(value) => updateDraft('applicationFeePercent', value)} type="number" min="0" step="0.01" />
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-sm font-semibold text-slate-700">Service Locations</span>
                      <input
                        value={draft.serviceLocationIds}
                        onChange={(event) => updateDraft('serviceLocationIds', event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Comma separated location references"
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft.customerCanPayImmediately}
                        onChange={(event) => updateDraft('customerCanPayImmediately', event.target.checked)}
                      />
                      Customer can pay immediately
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft.cancelAtPeriodEnd}
                        onChange={(event) => updateDraft('cancelAtPeriodEnd', event.target.checked)}
                      />
                      Cancel at period end
                    </label>
                  </div>
                ) : (
                  <dl className="mt-5 grid gap-5 md:grid-cols-2">
                    <Field label="Billing Workflow" value={billingWorkflowLabel} />
                    <Field label="Autopay Status" value={labelize(subscription.autopayStatus)} />
                    <Field label="Manual Invoicing" value={manualBillingAllowed ? 'Enabled' : 'Disabled'} />
                    <Field label="Receipts" value={receiptWorkflowLabel} />
                    <Field label="Amount" value={formatCurrency(subscription.amountCents)} />
                    <Field label="Billing Frequency" value={formatBillingFrequency(subscription) || `Every ${subscription.intervalCount > 1 ? `${subscription.intervalCount} ` : ''}${subscription.interval || 'month'}`} />
                    <Field label="Service Frequency" value={formatServiceFrequency(subscription)} />
                    <Field label="Payment Terms" value={labelize(subscription.paymentTerms)} />
                    <Field label="Invoice Delivery" value={labelize(subscription.invoiceDeliveryMethod)} />
                    <Field label="Next Action" value={labelize(subscription.nextAction)} />
                    <Field label="Customer Can Pay" value={subscription.customerCanPayImmediately ? 'Ready' : 'No'} />
                    <Field label="Current Period" value={`${formatDate(subscription.currentPeriodStart)} - ${formatDate(subscription.currentPeriodEnd)}`} />
                    <Field label="Cancel At Period End" value={subscription.cancelAtPeriodEnd ? 'Yes' : 'No'} />
                  </dl>
                )}
              </form>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Line Items</h2>
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                  {lineItems.length === 0 ? (
                    <div className="bg-slate-50 p-5 text-sm text-slate-500">No line items saved.</div>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Item</th>
                          <th className="px-4 py-3">Qty</th>
                          <th className="px-4 py-3">Unit</th>
                          <th className="px-4 py-3">Total</th>
                          <th className="px-4 py-3">Stripe Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {lineItems.map((item) => (
                          <tr key={item.id || item.catalogItemId || item.name}>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900">{item.name || item.description || 'Service'}</p>
                              {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                            </td>
                            <td className="px-4 py-3 text-slate-600">{item.quantity || 1}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(item.unitAmountCents)}</td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(item.totalAmountCents)}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">{item.stripePriceId || 'Inline Checkout price'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </main>

            <aside className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Manual Billing</h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Manual Status" value={labelize(subscription.manualBillingStatus || (manualBillingAllowed ? 'readyToInvoice' : 'disabled'))} />
                  <Field label="Reason" value={labelize(subscription.manualBillingReason || (manualBillingAllowed ? 'manualUntilAutopay' : 'automaticBilling'))} />
                  <Field label="Next Invoice Period" value={manualInvoicePreview ? `${formatDate(manualInvoicePreview.periodStart)} - ${formatDate(manualInvoicePreview.periodEnd)}` : 'Not set'} />
                  <Field label="Invoice Number" value={manualInvoicePreview?.invoiceNumber} />
                  <Field label="Last Manual Invoice">
                    {subscription.manualBillingLastInvoiceId ? (
                      <Link to={`/company/sales/invoices/${subscription.manualBillingLastInvoiceId}`} className="text-blue-700 hover:text-blue-900">
                        {subscription.manualBillingLastInvoiceNumber || 'Open invoice'}
                      </Link>
                    ) : 'Not created'}
                  </Field>
                  <Field label="Last Generated" value={formatDate(subscription.manualBillingLastInvoiceAt)} />
                </dl>
                <button
                  type="button"
                  onClick={createManualInvoice}
                  disabled={!canCreateManualInvoice}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaFileInvoiceDollar className="text-xs" />
                  {creatingManualInvoice ? 'Creating...' : 'Create Invoice For Period'}
                </button>
                {manualBillingAllowed ? (
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Use manual invoices for each recurring period until the customer completes automatic payment setup.
                  </p>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Manual recurring invoices are disabled while Stripe is managing this billing subscription.
                  </p>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Stripe</h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Connected Account" value={subscription.stripeConnectedAccountId} />
                  <Field label="Stripe Customer" value={subscription.stripeCustomerId} />
                  <Field label="Stripe Subscription" value={subscription.stripeSubscriptionId} />
                  <Field label="Stripe Status" value={subscription.stripeStatus || 'Not synced'} />
                  <Field label="Checkout Status" value={labelize(subscription.checkoutStatus)} />
                </dl>
                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={syncStripeSubscription}
                    disabled={!canSyncStripe}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaSyncAlt className="text-xs" />
                    {stripeAction === 'syncSalesBillingSubscriptionFromStripe' ? 'Syncing...' : 'Sync Stripe'}
                  </button>
                  <button
                    type="button"
                    onClick={applyPricingToStripe}
                    disabled={!canApplyStripePricing}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaUpload className="text-xs" />
                    {stripeAction === 'updateSalesBillingSubscriptionStripeItems' ? 'Updating...' : 'Apply Items To Stripe'}
                  </button>
                  {canResumeStripe ? (
                    <button
                      type="button"
                      onClick={resumeStripeSubscription}
                      disabled={!canResumeStripe}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaUndo className="text-xs" />
                      {stripeAction === 'resumeSalesBillingSubscription' ? 'Resuming...' : 'Resume Stripe Billing'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={cancelStripeSubscription}
                      disabled={!canCancelStripe}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaBan className="text-xs" />
                      {stripeAction === 'cancelSalesBillingSubscription' ? 'Canceling...' : 'Cancel At Period End'}
                    </button>
                  )}
                </div>
                {lineItemsMissingStripePrices.length > 0 && hasStripeSubscription && (
                  <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
                    {lineItemsMissingStripePrices.length} line item{lineItemsMissingStripePrices.length === 1 ? '' : 's'} will get connected-account Stripe prices when you apply items to Stripe.
                  </div>
                )}
                {subscription.checkoutUrl && !isStripeManagedBilling && (
                  <a
                    href={subscription.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    Existing Checkout Link
                    <FaExternalLinkAlt className="text-xs" />
                  </a>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Operations Setup</h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Setup Status" value={labelize(recurringSetupStatus)} />
                  <Field label="Recurring Stop" value={subscription.recurringServiceStopId || 'Not created'} />
                  <Field label="Service Location" value={firstServiceLocationId} />
                </dl>
                {!hasRecurringServiceStop && (
                  <Link
                    to={recurringSetupUrl}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  >
                    <FaRoute className="text-xs" />
                    Create Recurring Stop
                  </Link>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Source</h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Agreement">
                    {subscription.agreementId ? (
                      <Link to={`/company/sales/agreements/${subscription.agreementId}`} className="text-blue-700 hover:text-blue-900">
                        Open Service Agreement
                      </Link>
                    ) : 'Not linked'}
                  </Field>
                  <Field label="Billing Profile" value={subscription.billingProfileId ? 'Billing profile linked' : 'Not linked'} />
                  <Field label="Customer" value={subscription.customerName || (subscription.customerId ? 'Customer' : '')} />
                  <Field label="Service Locations" value={(subscription.serviceLocationIds || []).length ? `${subscription.serviceLocationIds.length} linked` : 'Not linked'} />
                </dl>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Audit</h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Created" value={formatDate(subscription.createdAt)} />
                  <Field label="Updated" value={formatDate(subscription.updatedAt)} />
                  <Field label="Latest Invoice" value={subscription.stripeLatestInvoiceId} />
                  <Field label="Default Payment Method" value={subscription.stripeDefaultPaymentMethodId} />
                </dl>
              </section>
            </aside>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-950">Delete Billing Subscription</h2>
            <p className="mt-2 text-sm text-slate-600">
              This permanently removes the billing subscription record and clears the linked service agreement billing reference.
              Active Stripe subscriptions must be canceled before deleting.
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="deleteBillingSubscriptionConfirmation">
              Type DELETE to confirm
            </label>
            <input
              id="deleteBillingSubscriptionConfirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-100"
            />
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteConfirmation('');
                }}
                disabled={deleting}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteBillingSubscription}
                disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE' || deleting}
                className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
              >
                {deleting ? 'Deleting...' : 'Delete Billing Subscription'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesBillingSubscriptionDetail;
