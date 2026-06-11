import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteDoc, doc, getDoc, increment, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaCheckCircle,
  FaCreditCard,
  FaEdit,
  FaEnvelope,
  FaExclamationTriangle,
  FaFileSignature,
  FaMapMarkerAlt,
  FaPlus,
  FaReceipt,
  FaRoute,
  FaSave,
  FaTimes,
  FaTrash,
  FaUserCheck,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import { salesCollectionNames, SalesAgreementStatus } from '../../../utils/models/Sales';
import FeatureInfoButton from '../../../components/FeatureInfoButton';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { ensureBillingSubscriptionForAgreement } from '../../../utils/sales/agreementBilling';
import { AgreementBillingType, getAgreementBillingType } from '../../../utils/sales/agreementRouting';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

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
  return Number.isNaN(date.getTime()) ? null : date;
};

const centsToInput = (amountCents = 0) => ((Number(amountCents) || 0) / 100).toFixed(2);

const moneyInputToCents = (value) => Math.round((Number(value) || 0) * 100);

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const statusTone = {
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
  sent: 'bg-sky-50 text-sky-700 border-sky-200',
  revised: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  canceled: 'bg-slate-100 text-slate-500 border-slate-200',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.draft;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const ReadinessRow = ({ ready, title, helper }) => (
  <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
    {ready ? (
      <FaCheckCircle className="mt-0.5 shrink-0 text-emerald-600" />
    ) : (
      <FaExclamationTriangle className="mt-0.5 shrink-0 text-amber-600" />
    )}
    <div>
      <p className="font-semibold text-slate-900">{title}</p>
      {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
    </div>
  </div>
);

const locationLine = (location = {}) => [
  location.streetAddress,
  location.address02,
  [location.city, location.state, location.zip].filter(Boolean).join(' '),
].filter(Boolean).join(', ');

const createEditDraft = (agreement) => ({
  title: agreement?.title || '',
  description: agreement?.description || '',
  email: agreement?.email || '',
  status: agreement?.status || SalesAgreementStatus.draft,
  startDate: toInputDate(agreement?.startDate),
  expiresAt: toInputDate(agreement?.expiresAt),
  serviceCadence: agreement?.serviceCadence || 'monthly',
  serviceCadenceCount: String(agreement?.serviceCadenceCount || 1),
  rateType: agreement?.rateType || 'perMonth',
  paymentTerms: agreement?.paymentTerms || 'dueOnReceipt',
  terms: agreement?.terms || '',
  lineItems: (Array.isArray(agreement?.lineItems) ? agreement.lineItems : []).map((item, index) => ({
    id: item.id || `line_${index}`,
    catalogItemId: item.catalogItemId || '',
    sourceType: item.sourceType || 'manual',
    sourceId: item.sourceId || '',
    name: item.name || item.description || '',
    description: item.description || '',
    quantity: String(item.quantity || 1),
    unitAmount: centsToInput(item.unitAmountCents),
    taxable: Boolean(item.taxable),
    type: item.type || '',
    stripeProductId: item.stripeProductId || '',
    stripePriceId: item.stripePriceId || '',
    metadata: item.metadata || {},
  })),
});

const blankLineItem = () => ({
  id: `sili_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  catalogItemId: '',
  sourceType: 'manual',
  sourceId: '',
  name: '',
  description: '',
  quantity: '1',
  unitAmount: '0.00',
  taxable: false,
  type: 'manual',
  stripeProductId: '',
  stripePriceId: '',
  metadata: {},
});

const acceptanceSourceLabel = (source) => {
  if (source === 'internalManual') return 'Internal manual acceptance';
  if (source === 'customerOffline') return 'Customer told us offline';
  if (source === 'customerPortal') return 'Customer portal';
  return labelize(source || 'Not accepted');
};

const SalesAgreementDetail = () => {
  const { agreementId } = useParams();
  const navigate = useNavigate();
  const { dataBaseUser, recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId, user } = useContext(Context);
  const [agreement, setAgreement] = useState(null);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmingAcceptance, setConfirmingAcceptance] = useState(false);
  const [acceptanceSource, setAcceptanceSource] = useState('customerOffline');
  const [acceptanceNote, setAcceptanceNote] = useState('');
  const [markingAccepted, setMarkingAccepted] = useState(false);
  const [creatingBilling, setCreatingBilling] = useState(false);
  const [startingStripeCheckout, setStartingStripeCheckout] = useState(false);

  useEffect(() => {
    if (!agreementId) {
      setAgreement(null);
      setLoading(false);
      setError('Missing agreement id.');
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

        setAgreement({ id: snapshot.id, ...snapshot.data() });
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load service agreement', snapshotError);
        setError(snapshotError.message || 'Unable to load service agreement.');
        setLoading(false);
      }
    );
  }, [agreementId]);

  useEffect(() => {
    if (!agreement?.billingSubscriptionId) {
      setBillingSubscription(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, salesCollectionNames.billingSubscriptions, agreement.billingSubscriptionId),
      (snapshot) => {
        setBillingSubscription(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (subscriptionError) => {
        console.error('Unable to load billing subscription', subscriptionError);
        setBillingSubscription(null);
      }
    );
  }, [agreement?.billingSubscriptionId]);

  const companyMismatch = Boolean(
    agreement &&
    recentlySelectedCompany &&
    agreement.companyId &&
    agreement.companyId !== recentlySelectedCompany
  );

  const lineItems = useMemo(
    () => (Array.isArray(agreement?.lineItems) ? agreement.lineItems : []),
    [agreement]
  );
  const locations = useMemo(
    () => (Array.isArray(agreement?.serviceLocationSnapshots) ? agreement.serviceLocationSnapshots : []),
    [agreement]
  );
  const hasTerms = Boolean(agreement?.terms || (Array.isArray(agreement?.termsList) && agreement.termsList.length));
  const subtotalAmountCents = agreement?.subtotalAmountCents ?? lineItems.reduce(
    (total, item) => total + (Number(item.totalAmountCents) || 0),
    0
  );
  const totalAmountCents = agreement?.totalAmountCents ?? agreement?.rateAmountCents ?? subtotalAmountCents;
  const emailDelivery = agreement?.emailDelivery || {};
  const emailTestMode = emailDelivery.testMode === true || emailDelivery.testMode === 'true';
  const currentStatusKey = normalizeStatus(agreement?.status);
  const isAccepted = currentStatusKey === normalizeStatus(SalesAgreementStatus.accepted);
  const hasAcceptanceAudit = Boolean(agreement?.acceptedAt || agreement?.acceptedByUserName || agreement?.acceptedSource);
  const acceptanceIsCurrent = isAccepted && hasAcceptanceAudit;
  const actorName = [
    dataBaseUser?.firstName,
    dataBaseUser?.lastName,
  ].filter(Boolean).join(' ').trim()
    || dataBaseUser?.userName
    || dataBaseUser?.name
    || user?.displayName
    || user?.email
    || 'Company user';
  const editTotals = useMemo(() => {
    const draftLineItems = Array.isArray(editDraft?.lineItems) ? editDraft.lineItems : [];
    const subtotal = draftLineItems.reduce((total, item) => {
      const quantity = Number(item.quantity) || 0;
      return total + (moneyInputToCents(item.unitAmount) * quantity);
    }, 0);

    return {
      subtotalAmountCents: subtotal,
      taxAmountCents: 0,
      totalAmountCents: subtotal,
    };
  }, [editDraft]);

  const readinessItems = [
    {
      ready: Boolean(agreement?.email),
      title: 'Customer email',
      helper: agreement?.email || 'Add a billing email before sending.',
    },
    {
      ready: locations.length > 0,
      title: 'Service location snapshot',
      helper: `${locations.length} location${locations.length === 1 ? '' : 's'} included.`,
    },
    {
      ready: lineItems.length > 0,
      title: 'Catalog line items',
      helper: `${lineItems.length} line item${lineItems.length === 1 ? '' : 's'} included.`,
    },
    {
      ready: hasTerms,
      title: 'Terms snapshot',
      helper: agreement?.termsTemplateName || 'Copied terms are required before send.',
    },
  ];
  const canSend = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    !editing &&
    readinessItems.every((item) => item.ready) &&
    !sending &&
    normalizeStatus(agreement.status) !== normalizeStatus(SalesAgreementStatus.accepted) &&
    normalizeStatus(agreement.status) !== normalizeStatus(SalesAgreementStatus.canceled)
  );
  const canMarkAccepted = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    !markingAccepted &&
    currentStatusKey !== normalizeStatus(SalesAgreementStatus.accepted) &&
    currentStatusKey !== normalizeStatus(SalesAgreementStatus.canceled)
  );
  const hasBillingSubscription = Boolean(agreement?.billingSubscriptionId || billingSubscription?.id);
  const billingFlowStatus = billingSubscription?.stripeStatus || billingSubscription?.status || agreement?.billingFlowStatus || 'notStarted';
  const billingFlowNextAction = billingSubscription?.nextAction || agreement?.billingFlowNextAction || 'acceptAgreement';
  const missingStripePriceCount = billingSubscription?.stripeReadiness?.missingStripePriceItemIds?.length || 0;
  const hasActiveStripeSubscription = ['active', 'trialing'].includes(normalizeStatus(billingSubscription?.stripeStatus || billingSubscription?.status));
  const agreementBillingType = getAgreementBillingType(agreement || {});
  const isRecurringAgreement = agreementBillingType === AgreementBillingType.recurring;
  const agreementServiceLocationIds = Array.isArray(agreement?.serviceLocationIds)
    ? agreement.serviceLocationIds.filter(Boolean)
    : locations.map((location) => location.serviceLocationId || location.id).filter(Boolean);
  const firstServiceLocationId = agreementServiceLocationIds[0] || '';
  const recurringServiceStopId = agreement?.recurringServiceStopId
    || billingSubscription?.recurringServiceStopId
    || billingSubscription?.agreementSnapshot?.recurringServiceStopId
    || '';
  const recurringSetupStatus = agreement?.operationsSetupStatus
    || billingSubscription?.operationsSetupStatus
    || billingSubscription?.agreementSnapshot?.operationsSetupStatus
    || 'needsRecurringServiceStop';
  const hasRecurringRouteSetup = Boolean(
    recurringServiceStopId ||
    agreement?.recurringRouteId ||
    billingSubscription?.recurringRouteId
  );
  const recurringSetupQuery = new URLSearchParams({
    agreementId: agreement?.id || agreementId || '',
    billingSubscriptionId: billingSubscription?.id || agreement?.billingSubscriptionId || '',
    serviceLocationId: firstServiceLocationId,
    returnTo: `/company/sales/agreements/${agreement?.id || agreementId || ''}`,
  });
  const recurringSetupUrl = `/company/recurring-service-stops/create/${encodeURIComponent(agreement?.customerId || 'NA')}?${recurringSetupQuery.toString()}`;
  const canScheduleRecurringRoute = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    isAccepted &&
    isRecurringAgreement &&
    !hasRecurringRouteSetup
  );
  const canCustomerStartPayment = Boolean(
    billingSubscription?.customerCanPayImmediately ||
    agreement?.customerCanPayImmediately
  );
  const canCreateBillingSubscription = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    !creatingBilling &&
    isAccepted
  );
  const canStartStripeCheckout = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    isAccepted &&
    !startingStripeCheckout &&
    !hasActiveStripeSubscription &&
    Number(totalAmountCents || 0) > 0 &&
    stripeConnectedAccountId
  );

  const linkedJobIdForAgreement = (targetAgreement = agreement) => {
    if (!targetAgreement) return '';
    if (targetAgreement.jobId) return targetAgreement.jobId;
    if (targetAgreement.workOrderId) return targetAgreement.workOrderId;
    if (normalizeStatus(targetAgreement.sourceType) === 'oneoffjob' && targetAgreement.sourceId) {
      return targetAgreement.sourceId;
    }
    return '';
  };

  const syncLinkedJobForAcceptedAgreement = async () => {
    const linkedJobId = linkedJobIdForAgreement();
    const companyId = agreement?.companyId || recentlySelectedCompany;
    if (!companyId || !linkedJobId) return;

    try {
      const jobRef = doc(db, 'companies', companyId, 'workOrders', linkedJobId);
      const jobSnap = await getDoc(jobRef);
      const jobData = jobSnap.exists() ? jobSnap.data() : {};
      const updatePayload = {
        billingStatus: 'Accepted',
        salesAgreementId: agreement.id,
        salesAgreementStatus: SalesAgreementStatus.accepted,
        salesAgreementAcceptedAt: serverTimestamp(),
        salesAgreementStatusUpdatedAt: serverTimestamp(),
        salesAgreementStatusUpdatedByUserId: user?.uid || '',
        salesAgreementStatusUpdatedByUserName: actorName,
        updatedAt: serverTimestamp(),
      };

      if (!jobData.operationStatus || ['Estimate Pending', 'Unscheduled'].includes(jobData.operationStatus)) {
        updatePayload.operationStatus = 'Unscheduled';
      }

      await updateDoc(jobRef, updatePayload);
    } catch (syncError) {
      console.warn('Unable to sync linked job after agreement acceptance', syncError);
    }
  };

  const sendAgreementEmail = async () => {
    if (!canSend) return;

    setSending(true);

    try {
      const sendCallable = httpsCallable(functions, 'sendServiceAgreementEmail');
      const authPayload = await getCallableAuthPayload();
      const result = await sendCallable({
        companyId: agreement.companyId,
        agreementId: agreement.id,
        agreementBaseUrl: window.location.origin,
        ...authPayload,
      });

      if (result.data?.testMode) {
        toast.success(`Test email sent to ${result.data.to}. Customer email saved as ${result.data.intendedTo}.`);
      } else {
        toast.success(result.data?.message || 'Service agreement email sent.');
      }
    } catch (sendError) {
      console.error('Unable to send service agreement email', sendError);
      toast.error(sendError.message || 'Failed to send service agreement email.');
    } finally {
      setSending(false);
    }
  };

  const openEditor = () => {
    if (!agreement) return;
    setEditDraft(createEditDraft(agreement));
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setEditDraft(null);
  };

  const updateEditField = (field, value) => {
    setEditDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateEditLineItem = (lineItemId, field, value) => {
    setEditDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item) => (
        item.id === lineItemId ? { ...item, [field]: value } : item
      )),
    }));
  };

  const addEditLineItem = () => {
    setEditDraft((current) => ({
      ...current,
      lineItems: [...(current.lineItems || []), blankLineItem()],
    }));
  };

  const removeEditLineItem = (lineItemId) => {
    setEditDraft((current) => ({
      ...current,
      lineItems: current.lineItems.filter((item) => item.id !== lineItemId),
    }));
  };

  const saveEdit = async () => {
    if (!agreement || !editDraft) return;

    const nextLineItems = (editDraft.lineItems || [])
      .map((item) => {
        const quantity = Math.max(Number(item.quantity) || 0, 0);
        const unitAmountCents = moneyInputToCents(item.unitAmount);

        return {
          id: item.id,
          catalogItemId: item.catalogItemId || '',
          sourceType: item.sourceType || 'manual',
          sourceId: item.sourceId || '',
          name: (item.name || item.description || 'Service').trim(),
          description: (item.description || '').trim(),
          quantity,
          unitAmountCents,
          totalAmountCents: Math.round(unitAmountCents * quantity),
          taxable: Boolean(item.taxable),
          type: item.type || 'manual',
          stripeProductId: item.stripeProductId || '',
          stripePriceId: item.stripePriceId || '',
          metadata: item.metadata || {},
        };
      })
      .filter((item) => item.name && item.quantity > 0);

    if (!editDraft.title.trim() || !editDraft.email.trim() || nextLineItems.length === 0) {
      toast.error('Add a title, customer email, and at least one priced line item.');
      return;
    }

    setSavingEdit(true);

    try {
      const previousStatusKey = normalizeStatus(agreement.status);
      const nextStatus = previousStatusKey === normalizeStatus(SalesAgreementStatus.draft)
        ? SalesAgreementStatus.draft
        : SalesAgreementStatus.revised;

      await updateDoc(doc(db, salesCollectionNames.agreements, agreement.id), {
        title: editDraft.title.trim(),
        description: editDraft.description.trim(),
        email: editDraft.email.trim(),
        status: nextStatus,
        startDate: dateFromInput(editDraft.startDate),
        expiresAt: dateFromInput(editDraft.expiresAt),
        serviceCadence: editDraft.serviceCadence,
        serviceCadenceCount: Math.max(Number(editDraft.serviceCadenceCount) || 1, 1),
        rateType: editDraft.rateType,
        paymentTerms: editDraft.paymentTerms,
        terms: editDraft.terms.trim(),
        termsList: [],
        lineItems: nextLineItems,
        rateAmountCents: editTotals.totalAmountCents,
        subtotalAmountCents: editTotals.subtotalAmountCents,
        taxAmountCents: editTotals.taxAmountCents,
        totalAmountCents: editTotals.totalAmountCents,
        revisionNumber: increment(1),
        updatedAt: serverTimestamp(),
        lastEditedAt: serverTimestamp(),
        lastEditedByUserId: user?.uid || '',
        lastEditedByUserName: actorName,
        statusChangedAt: serverTimestamp(),
        statusChangedByUserId: user?.uid || '',
        statusChangedByUserName: actorName,
        statusChangeReason: nextStatus === SalesAgreementStatus.revised
          ? 'Agreement edited after send or acceptance.'
          : 'Draft agreement edited.',
      });

      toast.success(nextStatus === SalesAgreementStatus.revised
        ? 'Service agreement updated and marked revised.'
        : 'Service agreement updated.');
      closeEditor();
    } catch (saveError) {
      console.error('Unable to update service agreement', saveError);
      toast.error(saveError.message || 'Failed to update service agreement.');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteAgreement = async () => {
    if (!agreement || deleteConfirmation.trim().toUpperCase() !== 'DELETE') return;

    setDeleting(true);

    try {
      await deleteDoc(doc(db, salesCollectionNames.agreements, agreement.id));
      toast.success('Service agreement deleted.');
      navigate('/company/sales/agreements');
    } catch (deleteError) {
      console.error('Unable to delete service agreement', deleteError);
      toast.error(deleteError.message || 'Failed to delete service agreement.');
    } finally {
      setDeleting(false);
    }
  };

  const markAgreementAccepted = async () => {
    if (!canMarkAccepted) return;

    setMarkingAccepted(true);

    try {
      const billingSubscriptionDraft = await ensureBillingSubscriptionForAgreement(db, agreement, {
        stripeConnectedAccountId,
        agreementUpdates: {
          status: SalesAgreementStatus.accepted,
          acceptedAt: serverTimestamp(),
          acceptedByUserId: user?.uid || '',
          acceptedByUserName: actorName,
          acceptedByEmail: user?.email || dataBaseUser?.email || '',
          acceptedSource: acceptanceSource,
          acceptedNote: acceptanceNote.trim(),
          acceptedSnapshot: {
            agreementId: agreement.id,
            title: agreement.title || 'Service Agreement',
            customerName: agreement.customerName || 'Customer',
            customerId: agreement.customerId || '',
            email: agreement.email || '',
            totalAmountCents: String(totalAmountCents || 0),
            serviceCadence: agreement.serviceCadence || '',
            rateType: agreement.rateType || '',
            termsTemplateId: agreement.termsTemplateId || '',
            termsTemplateName: agreement.termsTemplateName || '',
            revisionNumber: String(agreement.revisionNumber || 0),
          },
          statusChangedAt: serverTimestamp(),
          statusChangedByUserId: user?.uid || '',
          statusChangedByUserName: actorName,
          statusChangeReason: acceptanceSource === 'customerOffline'
            ? 'Customer accepted outside the portal.'
            : 'Agreement manually accepted internally.',
        },
      });

      await syncLinkedJobForAcceptedAgreement();

      toast.success(billingSubscriptionDraft.customerCanPayImmediately
        ? 'Agreement accepted and billing subscription is ready for payment setup.'
        : 'Agreement accepted and billing subscription was created.');
      setConfirmingAcceptance(false);
      setAcceptanceNote('');
      setAcceptanceSource('customerOffline');
    } catch (acceptError) {
      console.error('Unable to mark service agreement accepted', acceptError);
      toast.error(acceptError.message || 'Failed to mark service agreement accepted.');
    } finally {
      setMarkingAccepted(false);
    }
  };

  const createBillingSubscriptionForAcceptedAgreement = async () => {
    if (!canCreateBillingSubscription) return;

    setCreatingBilling(true);

    try {
      const billingSubscriptionDraft = await ensureBillingSubscriptionForAgreement(db, agreement, {
        stripeConnectedAccountId,
      });

      toast.success(billingSubscriptionDraft.customerCanPayImmediately
        ? 'Billing subscription is ready for payment setup.'
        : 'Billing subscription created.');
    } catch (billingError) {
      console.error('Unable to create billing subscription from agreement', billingError);
      toast.error(billingError.message || 'Failed to create billing subscription.');
    } finally {
      setCreatingBilling(false);
    }
  };

  const startStripeCheckout = async () => {
    if (!canStartStripeCheckout) return;

    setStartingStripeCheckout(true);

    try {
      const targetBillingSubscription = await ensureBillingSubscriptionForAgreement(db, agreement, {
        stripeConnectedAccountId,
      });

      const billingSubscriptionId = targetBillingSubscription.id || agreement.billingSubscriptionId;
      if (!billingSubscriptionId) throw new Error('Create the billing subscription before starting Stripe Checkout.');

      const startCheckoutCallable = httpsCallable(functions, 'createSalesBillingSubscriptionCheckoutSession');
      const authPayload = await getCallableAuthPayload();
      const result = await startCheckoutCallable({
        ...authPayload,
        billingSubscriptionId,
        agreementId: agreement.id,
        companyId: agreement.companyId || recentlySelectedCompany,
        successUrl: `${window.location.origin}/company/sales/subscriptions?stripeCheckout=success&billingSubscriptionId=${encodeURIComponent(billingSubscriptionId)}`,
        cancelUrl: `${window.location.origin}/company/sales/agreements/${agreement.id}?stripeCheckout=canceled`,
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
      setStartingStripeCheckout(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Feature Flag 004
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {recentlySelectedCompanyName || agreement?.companyName || 'Selected company'}
                </span>
                {agreement?.status && <StatusBadge status={agreement.status} />}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">
                  {agreement?.title || 'Service Agreement'}
                </h1>
                <FeatureInfoButton title="How Sending Works" align="left">
                  <p>
                    SendGrid emails use the saved agreement snapshot. The customer receives the pricing, service
                    location, terms, and review link from the agreement record.
                  </p>
                  <p>
                    Sending changes the status to sent and records delivery metadata. Billing should still wait for
                    customer acceptance or a manual company acceptance.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Review the snapshot before emailing the customer.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                to="/company/sales/agreements"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FaArrowLeft className="text-xs" />
                Agreements
              </Link>
              <button
                type="button"
                onClick={openEditor}
                disabled={!agreement || companyMismatch || savingEdit}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaEdit className="text-xs" />
                Edit Service Agreement
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(true);
                  setDeleteConfirmation('');
                }}
                disabled={!agreement || companyMismatch || deleting}
                className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaTrash className="text-xs" />
                Delete Agreement
              </button>
              <button
                type="button"
                onClick={() => setConfirmingAcceptance(true)}
                disabled={!canMarkAccepted}
                className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaUserCheck className="text-xs" />
                Mark Accepted
              </button>
              {isRecurringAgreement && !hasRecurringRouteSetup && (
                <Link
                  to={recurringSetupUrl}
                  aria-disabled={!canScheduleRecurringRoute}
                  onClick={(event) => {
                    if (!canScheduleRecurringRoute) event.preventDefault();
                  }}
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition ${
                    canScheduleRecurringRoute
                      ? 'bg-slate-950 text-white hover:bg-slate-800'
                      : 'cursor-not-allowed bg-slate-300 text-slate-500'
                  }`}
                >
                  <FaRoute className="text-xs" />
                  Schedule Route
                </Link>
              )}
              <button
                type="button"
                onClick={sendAgreementEmail}
                disabled={!canSend}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaEnvelope className="text-xs" />
                {sending ? 'Sending...' : 'Send Email'}
              </button>
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
            This agreement belongs to another company. Select the matching company before sending.
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading service agreement...
          </div>
        ) : agreement && !companyMismatch ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <main className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Customer Snapshot</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{agreement.customerName || 'Customer'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{agreement.email || 'Not set'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Start Date</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{formatDate(agreement.startDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review By</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{formatDate(agreement.expiresAt)}</dd>
                  </div>
                </dl>
                {agreement.description && (
                  <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {agreement.description}
                  </p>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <FaMapMarkerAlt className="text-slate-400" />
                  <h2 className="text-lg font-bold text-slate-950">Service Locations</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  {locations.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      No location snapshot saved.
                    </div>
                  ) : (
                    locations.map((location) => (
                      <div key={location.id || location.streetAddress} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="font-semibold text-slate-900">{location.nickName || 'Service Location'}</p>
                        <p className="mt-1 text-sm text-slate-500">{locationLine(location)}</p>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <FaReceipt className="text-slate-400" />
                  <h2 className="text-lg font-bold text-slate-950">Pricing Snapshot</h2>
                </div>
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
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {lineItems.map((item) => (
                          <tr key={item.id || item.catalogItemId}>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900">{item.name || item.description}</p>
                              {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                            </td>
                            <td className="px-4 py-3 text-slate-600">{item.quantity || 1}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(item.unitAmountCents)}</td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(item.totalAmountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <FaFileSignature className="text-slate-400" />
                  <h2 className="text-lg font-bold text-slate-950">Terms Snapshot</h2>
                </div>
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  {agreement.termsTemplateName && (
                    <p className="mb-3 font-semibold text-slate-900">{agreement.termsTemplateName}</p>
                  )}
                  {agreement.terms ? (
                    <p className="whitespace-pre-wrap">{agreement.terms}</p>
                  ) : (
                    <p className="text-slate-500">No terms snapshot saved.</p>
                  )}
                </div>
              </section>
            </main>

            <aside className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Send Readiness</h2>
                <div className="mt-4 space-y-3">
                  {readinessItems.map((item) => (
                    <ReadinessRow key={item.title} {...item} />
                  ))}
                </div>
                <p className="mt-4 text-sm text-slate-500">
                  The SendGrid template id must also be configured on the backend as
                  {' '}<span className="font-semibold">SEND_GRID_SERVICE_AGREEMENT_TEMPLATE_ID</span>.
                </p>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Billing Summary</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Cadence</dt>
                    <dd className="font-semibold text-slate-900">{labelize(agreement.serviceCadence)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Rate Type</dt>
                    <dd className="font-semibold text-slate-900">{labelize(agreement.rateType)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Payment Terms</dt>
                    <dd className="font-semibold text-slate-900">{labelize(agreement.paymentTerms)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                    <dt className="text-slate-500">Subtotal</dt>
                    <dd className="font-semibold text-slate-900">{formatCurrency(subtotalAmountCents)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Total</dt>
                    <dd className="text-lg font-bold text-slate-950">{formatCurrency(totalAmountCents)}</dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">Billing Flow</h2>
                  <FaCreditCard className="text-slate-400" />
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Subscription</dt>
                    <dd className="font-semibold text-slate-900">
                      {hasBillingSubscription ? (
                        <Link
                          to={`/company/sales/subscriptions/${billingSubscription?.id || agreement.billingSubscriptionId}`}
                          className="text-blue-700 hover:text-blue-900"
                        >
                          Open Billing Subscription
                        </Link>
                      ) : 'Not created'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Billing Status</dt>
                    <dd className="font-semibold text-slate-900">{labelize(billingFlowStatus)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Next Action</dt>
                    <dd className="font-semibold text-slate-900">{labelize(billingFlowNextAction)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Customer Can Pay</dt>
                    <dd className={canCustomerStartPayment ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                      {canCustomerStartPayment ? 'Ready' : 'Needs setup'}
                    </dd>
                  </div>
                </dl>

                {missingStripePriceCount > 0 && (
                  <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    {missingStripePriceCount} line item{missingStripePriceCount === 1 ? '' : 's'} do not have saved Stripe price ids yet. That is okay: Stripe Checkout will create inline pricing from the agreement line items.
                  </div>
                )}

                {isAccepted && !stripeConnectedAccountId && (
                  <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Connect and verify the company's Stripe account before collecting payment methods.
                  </div>
                )}

                {!isAccepted && (
                  <p className="mt-4 text-sm text-slate-500">
                    A billing subscription is created automatically when this agreement is accepted.
                  </p>
                )}

                {canCreateBillingSubscription && (
                  <button
                    type="button"
                    onClick={createBillingSubscriptionForAcceptedAgreement}
                    disabled={!canCreateBillingSubscription}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaPlus className="text-xs" />
                    {creatingBilling
                      ? 'Preparing...'
                      : hasBillingSubscription
                        ? 'Refresh Billing Subscription'
                        : 'Create Billing Subscription'}
                  </button>
                )}

                {isAccepted && (
                  <button
                    type="button"
                    onClick={startStripeCheckout}
                    disabled={!canStartStripeCheckout}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaCreditCard className="text-xs" />
                    {startingStripeCheckout
                      ? 'Opening Stripe...'
                      : hasActiveStripeSubscription
                        ? 'Stripe Subscription Active'
                        : 'Start Stripe Checkout'}
                  </button>
                )}

                {hasBillingSubscription && (
                  <Link
                    to="/company/sales/subscriptions"
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    View Billing Subscriptions
                  </Link>
                )}
              </section>

              {isRecurringAgreement && (
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-slate-950">Operations Setup</h2>
                    <FaRoute className="text-slate-400" />
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Setup Status</dt>
                      <dd className="font-semibold text-slate-900">{labelize(recurringSetupStatus)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Recurring Stop</dt>
                      <dd className="font-semibold text-slate-900">
                        {recurringServiceStopId ? (
                          <Link
                            to={`/company/recurringServiceStop/details/${recurringServiceStopId}`}
                            className="text-blue-700 hover:text-blue-900"
                          >
                            Open Recurring Stop
                          </Link>
                        ) : 'Not created'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Service Location</dt>
                      <dd className="break-all font-semibold text-slate-900">{firstServiceLocationId || 'Not set'}</dd>
                    </div>
                  </dl>

                  {!isAccepted && (
                    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      Accept the recurring service agreement before scheduling its route.
                    </div>
                  )}

                  {!hasRecurringRouteSetup && (
                    <Link
                      to={recurringSetupUrl}
                      aria-disabled={!canScheduleRecurringRoute}
                      onClick={(event) => {
                        if (!canScheduleRecurringRoute) event.preventDefault();
                      }}
                      className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition ${
                        canScheduleRecurringRoute
                          ? 'bg-slate-950 text-white hover:bg-slate-800'
                          : 'cursor-not-allowed bg-slate-300 text-slate-500'
                      }`}
                    >
                      <FaRoute className="text-xs" />
                      Schedule Route
                    </Link>
                  )}
                </section>
              )}

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">Acceptance</h2>
                  {acceptanceIsCurrent ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      Current
                    </span>
                  ) : hasAcceptanceAudit ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      Previous Version
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      Not Accepted
                    </span>
                  )}
                </div>

                {hasAcceptanceAudit ? (
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Accepted At</dt>
                      <dd className="mt-1 font-semibold text-slate-900">{formatDate(agreement.acceptedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Marked By</dt>
                      <dd className="mt-1 font-semibold text-slate-900">
                        {agreement.acceptedByUserName || agreement.acceptedByEmail || 'Unknown'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Source</dt>
                      <dd className="mt-1 font-semibold text-slate-900">{acceptanceSourceLabel(agreement.acceptedSource)}</dd>
                    </div>
                    {agreement.acceptedNote && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-700">
                        {agreement.acceptedNote}
                      </div>
                    )}
                    {!acceptanceIsCurrent && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                        This agreement was edited after acceptance. Send the revised version or mark the new version accepted.
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Mark accepted when the homeowner approves outside the portal, or after the future customer portal acceptance flow records it directly.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setConfirmingAcceptance(true)}
                  disabled={!canMarkAccepted}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaUserCheck className="text-xs" />
                  Mark Accepted
                </button>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">Email Delivery</h2>
                  {emailTestMode && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      Test Mode
                    </span>
                  )}
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Sent At</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{formatDate(agreement.sentAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">To</dt>
                    <dd className="mt-1 break-all font-semibold text-slate-900">{emailDelivery.to || agreement.email || 'Not sent'}</dd>
                  </div>
                  {emailDelivery.intendedTo && emailDelivery.intendedTo !== emailDelivery.to && (
                    <div>
                      <dt className="text-slate-500">Customer Email</dt>
                      <dd className="mt-1 break-all font-semibold text-slate-900">{emailDelivery.intendedTo}</dd>
                    </div>
                  )}
                  {emailTestMode && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                      Real customer email is off until feature_flag_012 is enabled.
                    </div>
                  )}
                  <div>
                    <dt className="text-slate-500">Real Emails Flag</dt>
                    <dd className="mt-1 font-semibold text-slate-900">
                      {emailDelivery.realEmailsEnabled === true || emailDelivery.realEmailsEnabled === 'true' ? 'Enabled' : 'Disabled'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Email Message</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{emailDelivery.messageId ? 'Sent' : 'Not set'}</dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>
        ) : null}
      </div>

      {editing && editDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Edit Service Agreement</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Updates change the saved customer-facing snapshot.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                disabled={savingEdit}
                className="rounded-md border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                aria-label="Close editor"
              >
                <FaTimes />
              </button>
            </div>

            <div className="space-y-6 p-5">
              {normalizeStatus(agreement?.status) === normalizeStatus(SalesAgreementStatus.sent) && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  This agreement has already been sent. Saving changes updates the agreement record for future sends and review.
                </div>
              )}

              <section className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementTitle">
                    Title
                  </label>
                  <input
                    id="agreementTitle"
                    value={editDraft.title}
                    onChange={(event) => updateEditField('title', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementEmail">
                    Customer Email
                  </label>
                  <input
                    id="agreementEmail"
                    type="email"
                    value={editDraft.email}
                    onChange={(event) => updateEditField('email', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <span className="block text-sm font-semibold text-slate-700">Status After Save</span>
                  <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                    {normalizeStatus(agreement?.status) === normalizeStatus(SalesAgreementStatus.draft)
                      ? 'Draft'
                      : 'Revised'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementStartDate">
                    Start Date
                  </label>
                  <input
                    id="agreementStartDate"
                    type="date"
                    value={editDraft.startDate}
                    onChange={(event) => updateEditField('startDate', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementExpiresAt">
                    Review By
                  </label>
                  <input
                    id="agreementExpiresAt"
                    type="date"
                    value={editDraft.expiresAt}
                    onChange={(event) => updateEditField('expiresAt', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementDescription">
                    Description
                  </label>
                  <textarea
                    id="agreementDescription"
                    value={editDraft.description}
                    onChange={(event) => updateEditField('description', event.target.value)}
                    className="mt-1 min-h-[80px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </section>

              <section>
                <h3 className="text-base font-bold text-slate-950">Billing</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementCadence">
                      Cadence
                    </label>
                    <select
                      id="agreementCadence"
                      value={editDraft.serviceCadence}
                      onChange={(event) => updateEditField('serviceCadence', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="oneTime">One Time</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementCadenceCount">
                      Cadence Count
                    </label>
                    <input
                      id="agreementCadenceCount"
                      type="number"
                      min="1"
                      value={editDraft.serviceCadenceCount}
                      onChange={(event) => updateEditField('serviceCadenceCount', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementRateType">
                      Rate Type
                    </label>
                    <select
                      id="agreementRateType"
                      value={editDraft.rateType}
                      onChange={(event) => updateEditField('rateType', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="perMonth">Per Month</option>
                      <option value="perVisit">Per Visit</option>
                      <option value="oneTime">One Time</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementPaymentTerms">
                      Payment Terms
                    </label>
                    <select
                      id="agreementPaymentTerms"
                      value={editDraft.paymentTerms}
                      onChange={(event) => updateEditField('paymentTerms', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="dueOnReceipt">Due On Receipt</option>
                      <option value="net7">Net 7</option>
                      <option value="net15">Net 15</option>
                      <option value="net30">Net 30</option>
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-slate-950">Line Items</h3>
                  <button
                    type="button"
                    onClick={addEditLineItem}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FaPlus className="text-xs" />
                    Add Item
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {editDraft.lineItems.map((item) => {
                    const quantity = Number(item.quantity) || 0;
                    const itemTotal = moneyInputToCents(item.unitAmount) * quantity;

                    return (
                      <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_100px_130px_130px_auto]">
                          <input
                            value={item.name}
                            onChange={(event) => updateEditLineItem(item.id, 'name', event.target.value)}
                            placeholder="Item name"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <input
                            value={item.description}
                            onChange={(event) => updateEditLineItem(item.id, 'description', event.target.value)}
                            placeholder="Description"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.quantity}
                            onChange={(event) => updateEditLineItem(item.id, 'quantity', event.target.value)}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitAmount}
                            onChange={(event) => updateEditLineItem(item.id, 'unitAmount', event.target.value)}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                            {formatCurrency(itemTotal)}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeEditLineItem(item.id)}
                            className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {editDraft.lineItems.length === 0 && (
                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      Add at least one line item before saving.
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end">
                  <div className="w-full max-w-xs rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(editTotals.subtotalAmountCents)}</span>
                    </div>
                    <div className="mt-2 flex justify-between gap-3 border-t border-slate-200 pt-2">
                      <span className="text-slate-500">Total</span>
                      <span className="text-lg font-bold text-slate-950">{formatCurrency(editTotals.totalAmountCents)}</span>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <label className="block text-base font-bold text-slate-950" htmlFor="agreementTerms">
                  Terms
                </label>
                <textarea
                  id="agreementTerms"
                  value={editDraft.terms}
                  onChange={(event) => updateEditField('terms', event.target.value)}
                  className="mt-3 min-h-[220px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </section>
            </div>

            <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white p-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEditor}
                disabled={savingEdit}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <FaTimes className="text-xs" />
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={savingEdit}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaSave className="text-xs" />
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingAcceptance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-emerald-50 p-2 text-emerald-700">
                <FaUserCheck />
              </span>
              <div>
                <h2 className="text-xl font-bold text-slate-950">Mark Agreement Accepted</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Use this when the homeowner has accepted outside the portal, or when your team is recording an internal approval.
                </p>
              </div>
            </div>

            <fieldset className="mt-5 space-y-3">
              <legend className="text-sm font-semibold text-slate-700">Acceptance source</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 transition hover:bg-slate-50">
                <input
                  type="radio"
                  name="acceptanceSource"
                  value="customerOffline"
                  checked={acceptanceSource === 'customerOffline'}
                  onChange={(event) => setAcceptanceSource(event.target.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-slate-900">Customer told us offline</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    Phone call, text, email reply, or in-person approval.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 transition hover:bg-slate-50">
                <input
                  type="radio"
                  name="acceptanceSource"
                  value="internalManual"
                  checked={acceptanceSource === 'internalManual'}
                  onChange={(event) => setAcceptanceSource(event.target.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-slate-900">Internal manual acceptance</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    Your company is marking the agreement accepted for operations or billing.
                  </span>
                </span>
              </label>
            </fieldset>

            <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="acceptanceNote">
              Note
            </label>
            <textarea
              id="acceptanceNote"
              value={acceptanceNote}
              onChange={(event) => setAcceptanceNote(event.target.value)}
              placeholder="Example: Customer replied yes by email on June 3."
              className="mt-1 min-h-[90px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              This will set the agreement status to accepted and record {actorName} as the person who marked it.
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setConfirmingAcceptance(false);
                  setAcceptanceNote('');
                  setAcceptanceSource('customerOffline');
                }}
                disabled={markingAccepted}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={markAgreementAccepted}
                disabled={!canMarkAccepted}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaUserCheck className="text-xs" />
                {markingAccepted ? 'Marking...' : 'Mark Accepted'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-950">Delete Service Agreement</h2>
            <p className="mt-2 text-sm text-slate-600">
              This permanently removes the agreement snapshot. It will not automatically clean up job, invoice, or customer references.
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="deleteAgreementConfirmation">
              Type DELETE to confirm
            </label>
            <input
              id="deleteAgreementConfirmation"
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
                onClick={deleteAgreement}
                disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE' || deleting}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaTrash className="text-xs" />
                {deleting ? 'Deleting...' : 'Delete Agreement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesAgreementDetail;
