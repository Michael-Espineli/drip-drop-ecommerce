import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  FaCheckCircle,
  FaClock,
  FaCreditCard,
  FaEllipsisV,
  FaEnvelope,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaMoneyBillWave,
  FaReceipt,
  FaSearch,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import {
  SalesBillingCollectionMethod,
  SalesInvoiceStatus,
  SalesPaymentMethod,
  SalesPaymentStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import {
  createManualSubscriptionInvoice,
  getSubscriptionBillingPeriodPreview,
  invoiceBalanceCents,
  recordManualSalesPayment,
} from '../../../utils/sales/manualBilling';
import FeatureInfoButton from '../../../components/FeatureInfoButton';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const appPaymentMethods = new Set([
  SalesPaymentMethod.stripeCard,
  SalesPaymentMethod.stripeAch,
]);

const manualPaymentMethods = [
  SalesPaymentMethod.cash,
  SalesPaymentMethod.check,
  SalesPaymentMethod.externalCard,
  SalesPaymentMethod.bankTransfer,
  SalesPaymentMethod.other,
];

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
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(millis));
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const dollarsToCents = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const daysUntil = (value) => {
  const millis = toMillis(value);
  if (!millis) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(millis);
  target.setHours(0, 0, 0, 0);

  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

const invoiceHasOpenBalance = (invoice = {}) => {
  const status = normalizeStatus(invoice.status);
  return invoiceBalanceCents(invoice) > 0 && !['draft', 'paid', 'void', 'uncollectible'].includes(status);
};

const invoiceIsOverdue = (invoice = {}) => {
  if (!invoiceHasOpenBalance(invoice)) return false;

  const status = normalizeStatus(invoice.status);
  if (['overdue', 'pastdue'].includes(status)) return true;

  const dueDelta = daysUntil(invoice.dueDate);
  return dueDelta !== null && dueDelta < 0;
};

const invoiceIsOpenAr = (invoice = {}) => invoiceHasOpenBalance(invoice) && !invoiceIsOverdue(invoice);

const pluralizeDays = (days) => `${days} day${days === 1 ? '' : 's'}`;

const invoiceAgingInfo = (invoice = {}) => {
  const status = normalizeStatus(invoice.status);

  if (invoiceBalanceCents(invoice) <= 0 || status === 'paid') {
    return { label: 'Settled', helper: 'No open balance', tone: 'emerald' };
  }

  if (status === 'void') return { label: 'Void', helper: 'No receivable', tone: 'slate' };
  if (status === 'uncollectible') return { label: 'Uncollectible', helper: 'Written off', tone: 'rose' };
  if (status === 'draft') return { label: 'Draft', helper: 'Not sent yet', tone: 'slate' };

  const dueDelta = daysUntil(invoice.dueDate);
  if (dueDelta === null) {
    return ['overdue', 'pastdue'].includes(status)
      ? { label: 'Overdue', helper: 'Due date not set', tone: 'rose' }
      : { label: 'Open', helper: 'No due date', tone: 'slate' };
  }

  if (dueDelta < 0) {
    const daysLate = Math.abs(dueDelta);
    return { label: 'Overdue', helper: `${pluralizeDays(daysLate)} overdue`, tone: daysLate > 30 ? 'rose' : 'amber' };
  }

  if (dueDelta === 0) return { label: 'Due today', helper: 'Payment due today', tone: 'amber' };

  return { label: 'Open', helper: `Due in ${pluralizeDays(dueDelta)}`, tone: 'slate' };
};

const invoiceCanSendReminder = (invoice = {}) => Boolean(
  invoice?.id &&
  invoice.email &&
  Array.isArray(invoice.lineItems) &&
  invoice.lineItems.length > 0 &&
  !['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status))
);

const invoiceSendDisabledReason = (invoice = {}) => {
  if (!invoice?.email) return 'Add a customer email before sending a reminder.';
  if (!Array.isArray(invoice.lineItems) || invoice.lineItems.length === 0) return 'Add at least one line item before sending.';
  if (['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status))) return 'This invoice cannot be sent in its current status.';
  return '';
};

const sortByFreshest = (records) =>
  [...records].sort((left, right) => {
    const rightMillis = toMillis(right.updatedAt || right.receivedAt || right.paidAt || right.sentAt || right.createdAt || right.dueDate);
    const leftMillis = toMillis(left.updatedAt || left.receivedAt || left.paidAt || left.sentAt || left.createdAt || left.dueDate);
    return rightMillis - leftMillis;
  });

const statusTone = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  open: 'border-sky-200 bg-sky-50 text-sky-700',
  partiallypaid: 'border-amber-200 bg-amber-50 text-amber-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingpaymentmethod: 'border-amber-200 bg-amber-50 text-amber-700',
  pendingstripe: 'border-amber-200 bg-amber-50 text-amber-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  pastdue: 'border-rose-200 bg-rose-50 text-rose-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  void: 'border-slate-200 bg-slate-100 text-slate-600',
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
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

const StatTile = ({ icon: Icon, label, value, helper, onClick, selected = false, title = '' }) => {
  const Component = onClick ? 'button' : 'div';
  const interactiveClasses = onClick
    ? 'w-full text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200'
    : '';
  const selectedClasses = selected
    ? 'border-blue-300 bg-blue-50 shadow-md ring-1 ring-blue-200'
    : 'border-slate-200 bg-white';
  const iconClasses = selected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? selected : undefined}
      className={`rounded-lg border p-4 shadow-sm ${selectedClasses} ${interactiveClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${selected ? 'text-blue-700' : 'text-slate-500'}`}>{label}</p>
          <p className={`mt-2 text-2xl font-bold ${selected ? 'text-blue-950' : 'text-slate-950'}`}>{value}</p>
        </div>
        <span className={`rounded-md p-2 ${iconClasses}`}>
          <Icon />
        </span>
      </div>
      {helper && <p className={`mt-3 text-sm ${selected ? 'text-blue-700' : 'text-slate-500'}`}>{helper}</p>}
    </Component>
  );
};

const statusOptionLabel = (status) => {
  if (status === 'openAr') return 'Open AR';
  return labelize(status);
};

const InvoiceActionMenuItem = ({
  label,
  icon: Icon,
  tone = 'slate',
  loading = false,
  disabled = false,
  title = '',
  onClick,
}) => {
  const toneClasses = {
    blue: 'text-blue-700 hover:bg-blue-50',
    emerald: 'text-emerald-700 hover:bg-emerald-50',
    slate: 'text-slate-800 hover:bg-slate-50',
  };

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${toneClasses[tone] || toneClasses.slate}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{loading ? `${label}...` : label}</span>
    </button>
  );
};

const EmptyState = ({ title, body }) => (
  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
    <p className="font-semibold text-slate-800">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{body}</p>
  </div>
);

const InsightRow = ({ label, value, tone = 'slate' }) => {
  const tones = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${tones[tone] || tones.slate}`}>{value}</span>
    </div>
  );
};

const invoicePartApprovalId = (invoice = {}) => {
  if (invoice.partApprovalRequestId || invoice.partApprovalId) return invoice.partApprovalRequestId || invoice.partApprovalId;
  if (['partapproval', 'partapprovalrequest', 'customerpartapproval'].includes(normalizeStatus(invoice.sourceType))) return invoice.sourceId || '';

  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  const linkedLineItem = lineItems.find((item) => (
    item.partApprovalRequestId ||
    item.partApprovalId ||
    item.metadata?.partApprovalRequestId ||
    item.metadata?.partApprovalId ||
    ['partapproval', 'partapprovalrequest', 'customerpartapproval'].includes(normalizeStatus(item.sourceType))
  ));

  return linkedLineItem?.partApprovalRequestId ||
    linkedLineItem?.partApprovalId ||
    linkedLineItem?.metadata?.partApprovalRequestId ||
    linkedLineItem?.metadata?.partApprovalId ||
    linkedLineItem?.sourceId ||
    '';
};

const InvoiceSourceLinks = ({ invoice }) => {
  const partApprovalId = invoicePartApprovalId(invoice);

  return (
    <div className="flex flex-wrap gap-2">
      {invoice.agreementId && (
        <Link to={`/company/sales/agreements/${invoice.agreementId}`} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
          Agreement
        </Link>
      )}
      {invoice.jobId && (
        <Link to={`/company/jobs/detail/${invoice.jobId}`} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
          Job
        </Link>
      )}
      {partApprovalId && (
        <Link to={`/company/part-approvals?approvalId=${encodeURIComponent(partApprovalId)}`} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
          Part Approval
        </Link>
      )}
      {invoice.stripeHostedInvoiceUrl && (
        <a href={invoice.stripeHostedInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900">
          Stripe <FaExternalLinkAlt />
        </a>
      )}
    </div>
  );
};

const customerLink = (customerId) => (customerId ? `/company/customers/details/${customerId}` : '');

const SalesFinanceBoard = ({ defaultView = 'invoices' }) => {
  const navigate = useNavigate();
  const { recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId, user } = useContext(Context);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [recordPaymentInvoice, setRecordPaymentInvoice] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: SalesPaymentMethod.cash,
    referenceNumber: '',
    memo: '',
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [startingCheckoutId, setStartingCheckoutId] = useState('');
  const [creatingInvoiceId, setCreatingInvoiceId] = useState('');
  const [sendingInvoiceId, setSendingInvoiceId] = useState('');
  const [openActionInvoiceId, setOpenActionInvoiceId] = useState('');
  const [actionMenuPosition, setActionMenuPosition] = useState(null);

  const activeView = ['invoices', 'payments', 'subscriptions'].includes(defaultView) ? defaultView : 'invoices';
  const pageMeta = {
    invoices: {
      title: 'Invoices',
      helper: 'Customer invoices, accounts receivable, due dates, and manual payment recording.',
      infoTitle: 'How Invoices Work',
    },
    payments: {
      title: 'Payment History',
      helper: 'Posted payments across Stripe, cash, check, card, bank transfer, and external methods.',
      infoTitle: 'How Payment History Works',
    },
    subscriptions: {
      title: 'Billing Subscriptions',
      helper: 'Recurring homeowner billing records created from accepted service agreements.',
      infoTitle: 'How Billing Subscriptions Work',
    },
  }[activeView];

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setInvoices([]);
      setPayments([]);
      setSubscriptions([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    let firstSnapshotsRemaining = 3;

    const handleSnapshot = (setter) => (snapshot) => {
      setter(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
      firstSnapshotsRemaining -= 1;
      if (firstSnapshotsRemaining <= 0) setLoading(false);
    };

    const handleError = (collectionName) => (error) => {
      console.error(`Unable to load ${collectionName}`, error);
      toast.error(`Failed to load ${labelize(collectionName)}.`);
      setLoading(false);
    };

    const companyFilter = where('companyId', '==', recentlySelectedCompany);
    const unsubscribes = [
      onSnapshot(query(collection(db, salesCollectionNames.invoices), companyFilter), handleSnapshot(setInvoices), handleError(salesCollectionNames.invoices)),
      onSnapshot(query(collection(db, salesCollectionNames.payments), companyFilter), handleSnapshot(setPayments), handleError(salesCollectionNames.payments)),
      onSnapshot(query(collection(db, salesCollectionNames.billingSubscriptions), companyFilter), handleSnapshot(setSubscriptions), handleError(salesCollectionNames.billingSubscriptions)),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [recentlySelectedCompany]);

  const summary = useMemo(() => {
    const postedPayments = payments.filter((payment) => normalizeStatus(payment.status) === normalizeStatus(SalesPaymentStatus.posted));
    const invoicedCents = invoices
      .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)))
      .reduce((total, invoice) => total + Number(invoice.totalAmountCents || 0), 0);
    const openArInvoices = invoices.filter(invoiceIsOpenAr);
    const openArCents = invoices
      .filter(invoiceIsOpenAr)
      .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);
    const receivedCents = postedPayments.reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const paidThroughAppCents = postedPayments
      .filter((payment) => appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId)
      .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const manualPaymentCents = postedPayments
      .filter((payment) => !appPaymentMethods.has(payment.method) && !payment.stripePaymentIntentId && !payment.stripeChargeId)
      .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const recurringCents = subscriptions
      .filter((subscription) => ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status)))
      .reduce((total, subscription) => total + Number(subscription.amountCents || 0), 0);
    const overdueInvoices = invoices.filter(invoiceIsOverdue);
    const pendingCheckoutSubscriptions = subscriptions.filter((subscription) => (
      ['pendingpaymentmethod', 'pendingstripe', 'notstarted'].includes(normalizeStatus(subscription.status || subscription.stripeStatus)) &&
      Number(subscription.amountCents || 0) > 0
    ));
    const failedPayments = payments.filter((payment) => normalizeStatus(payment.status) === 'failed');

    return {
      invoicedCents,
      openArCents,
      receivedCents,
      paidThroughAppCents,
      manualPaymentCents,
      recurringCents,
      openArInvoiceCount: openArInvoices.length,
      overdueInvoiceCount: overdueInvoices.length,
      overdueInvoiceCents: overdueInvoices.reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0),
      pendingCheckoutCount: pendingCheckoutSubscriptions.length,
      failedPaymentCount: failedPayments.length,
    };
  }, [invoices, payments, subscriptions]);

  const arAging = useMemo(() => {
    const buckets = {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61plus: 0,
    };

    invoices.forEach((invoice) => {
      const balanceCents = invoiceBalanceCents(invoice);
      if (balanceCents <= 0 || ['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status))) return;

      const dueDelta = daysUntil(invoice.dueDate || invoice.createdAt);
      if (dueDelta === null || dueDelta >= 0) {
        buckets.current += balanceCents;
        return;
      }

      const daysPastDue = Math.abs(dueDelta);
      if (daysPastDue <= 30) buckets.days1to30 += balanceCents;
      else if (daysPastDue <= 60) buckets.days31to60 += balanceCents;
      else buckets.days61plus += balanceCents;
    });

    return buckets;
  }, [invoices]);

  const subscriptionReadiness = useMemo(() => {
    const active = subscriptions.filter((subscription) => ['active', 'trialing'].includes(normalizeStatus(subscription.stripeStatus || subscription.status)));
    const pendingPayment = subscriptions.filter((subscription) => ['pendingpaymentmethod', 'pendingstripe', 'notstarted'].includes(normalizeStatus(subscription.status || subscription.stripeStatus)));
    const missingStripeAccount = subscriptions.filter((subscription) => !subscription.stripeConnectedAccountId);
    const missingCustomer = subscriptions.filter((subscription) => !subscription.stripeCustomerId);

    return {
      activeCount: active.length,
      pendingPaymentCount: pendingPayment.length,
      missingStripeAccountCount: missingStripeAccount.length,
      missingCustomerCount: missingCustomer.length,
    };
  }, [subscriptions]);

  const recordsForView = useMemo(() => {
    const source = activeView === 'payments'
      ? payments
      : activeView === 'subscriptions'
        ? subscriptions
        : invoices;
    const queryText = searchTerm.trim().toLowerCase();

    return sortByFreshest(source).filter((record) => {
      const status = normalizeStatus(record.status || record.stripeStatus);
      const matchesStatus = (() => {
        if (statusFilter === 'all') return true;
        if (activeView === 'invoices' && statusFilter === 'openAr') return invoiceIsOpenAr(record);
        if (activeView === 'invoices' && statusFilter === 'overdue') return invoiceIsOverdue(record);
        return status === normalizeStatus(statusFilter);
      })();
      const matchesSearch = !queryText || [
        record.customerName,
        record.email,
	        record.invoiceNumber,
	        record.id,
	        record.jobId,
	        record.agreementId,
	        record.sourceType,
	        record.sourceId,
	        record.partApprovalRequestId,
	        record.partApprovalId,
	        invoicePartApprovalId(record),
	        record.stripeInvoiceId,
	        record.stripeSubscriptionId,
	        record.referenceNumber,
      ].some((value) => String(value || '').toLowerCase().includes(queryText));

      return matchesStatus && matchesSearch;
    });
  }, [activeView, invoices, payments, searchTerm, statusFilter, subscriptions]);

  const recentPaid = useMemo(
    () => sortByFreshest(payments.filter((payment) => normalizeStatus(payment.status) === normalizeStatus(SalesPaymentStatus.posted))).slice(0, 6),
    [payments]
  );
  const openActionInvoice = useMemo(
    () => recordsForView.find((invoice) => invoice.id === openActionInvoiceId) || null,
    [openActionInvoiceId, recordsForView]
  );

  const setInvoiceCardFilter = (filter) => {
    if (activeView !== 'invoices') {
      navigate('/company/sales/invoices');
      return;
    }

    setStatusFilter((current) => (current === filter ? 'all' : filter));
  };

  const closeInvoiceActions = () => {
    setOpenActionInvoiceId('');
    setActionMenuPosition(null);
  };

  const toggleInvoiceActions = (invoiceId, event) => {
    if (openActionInvoiceId === invoiceId) {
      closeInvoiceActions();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 132;
    const top = Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 8);
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

    setOpenActionInvoiceId(invoiceId);
    setActionMenuPosition({ top, left });
  };

  const openRecordPaymentModal = (invoice) => {
    const balanceCents = invoiceBalanceCents(invoice);
    setRecordPaymentInvoice(invoice);
    setPaymentForm({
      amount: balanceCents > 0 ? (balanceCents / 100).toFixed(2) : '',
      method: SalesPaymentMethod.cash,
      referenceNumber: '',
      memo: '',
    });
  };

  const closeRecordPaymentModal = () => {
    setRecordPaymentInvoice(null);
    setSavingPayment(false);
  };

  const handleRecordPayment = async (event) => {
    event.preventDefault();
    if (!recordPaymentInvoice || savingPayment) return;

    const amountCents = dollarsToCents(paymentForm.amount);
    if (amountCents <= 0) {
      toast.error('Payment amount must be greater than zero.');
      return;
    }

    setSavingPayment(true);

    try {
      await recordManualSalesPayment(db, recordPaymentInvoice.id, {
        amountCents,
        method: paymentForm.method,
        referenceNumber: paymentForm.referenceNumber,
        memo: paymentForm.memo,
      }, {
        companyId: recentlySelectedCompany,
        stripeConnectedAccountId,
        userId: user?.uid || '',
      });

      toast.success('Payment recorded.');
      closeRecordPaymentModal();
    } catch (error) {
      console.error('Failed to record payment', error);
      toast.error(error.message || 'Failed to record payment.');
      setSavingPayment(false);
    }
  };

  const sendInvoiceReminder = async (invoice) => {
    if (!invoice?.id || sendingInvoiceId || !invoiceCanSendReminder(invoice)) {
      const reason = invoiceSendDisabledReason(invoice);
      if (reason) toast.error(reason);
      return;
    }

    setSendingInvoiceId(invoice.id);

    try {
      const sendCallable = httpsCallable(functions, 'sendSalesInvoiceEmail');
      const authPayload = await getCallableAuthPayload();
      const result = await sendCallable({
        companyId: invoice.companyId || recentlySelectedCompany,
        invoiceId: invoice.id,
        invoiceBaseUrl: window.location.origin,
        ...authPayload,
      });

      if (result.data?.testMode) {
        toast.success(`Test invoice reminder sent to ${result.data.to}. Customer email saved as ${result.data.intendedTo}.`);
      } else {
        toast.success(result.data?.message || 'Invoice reminder sent.');
      }
    } catch (error) {
      console.error('Unable to send invoice reminder', error);
      toast.error(error.message || 'Failed to send invoice reminder.');
    } finally {
      setSendingInvoiceId('');
    }
  };

  const createSubscriptionInvoice = async (subscription) => {
    if (!subscription?.id || creatingInvoiceId) return;

    setCreatingInvoiceId(subscription.id);

    try {
      const result = await createManualSubscriptionInvoice(db, subscription, {
        companyName: recentlySelectedCompanyName,
        stripeConnectedAccountId,
        userId: user?.uid || '',
      });

      toast.success(result.created ? 'Recurring invoice created.' : 'Invoice for this billing period already exists.');
      navigate(`/company/sales/invoices/${result.invoiceId}`);
    } catch (error) {
      console.error('Unable to create recurring manual invoice', error);
      toast.error(error.message || 'Failed to create recurring invoice.');
    } finally {
      setCreatingInvoiceId('');
    }
  };

  const startSubscriptionCheckout = async (subscription) => {
    if (!subscription?.id || startingCheckoutId) return;

    setStartingCheckoutId(subscription.id);

    try {
      const startCheckoutCallable = httpsCallable(functions, 'createSalesBillingSubscriptionCheckoutSession');
      const authPayload = await getCallableAuthPayload();
      const result = await startCheckoutCallable({
        ...authPayload,
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        companyId: subscription.companyId || recentlySelectedCompany,
        successUrl: `${window.location.origin}/company/sales/subscriptions?stripeCheckout=success&billingSubscriptionId=${encodeURIComponent(subscription.id)}`,
        cancelUrl: `${window.location.origin}/company/sales/subscriptions?stripeCheckout=canceled&billingSubscriptionId=${encodeURIComponent(subscription.id)}`,
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
    } catch (error) {
      console.error('Unable to start subscription Checkout', error);
      toast.error(error.message || 'Failed to start Stripe Checkout.');
      setStartingCheckoutId('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link to="/company/sales" className="app-back-link">
                Back to Sales Dashboard
              </Link>
              <div className="mt-2 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">{pageMeta.title}</h1>
                <FeatureInfoButton title={pageMeta.infoTitle} align="left">
                  <p>
                    These pages read the sales invoices, billing subscriptions, and payments collections.
                    Manual cash/check payments update the invoice balance here.
                  </p>
                  <p>
                    Stripe can later write card or ACH payments to the same payment history, which lets the dashboard
                    separate paid through the app from payments recorded by staff.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {recentlySelectedCompanyName || 'Selected company'} · {pageMeta.helper}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <StatTile icon={FaFileInvoiceDollar} label="Invoiced" value={formatCurrency(summary.invoicedCents)} helper="Non-draft invoice total" />
          <StatTile
            icon={FaReceipt}
            label="Open AR"
            value={formatCurrency(summary.openArCents)}
            helper={`${summary.openArInvoiceCount} outstanding, not late`}
            onClick={() => setInvoiceCardFilter('openAr')}
            selected={activeView === 'invoices' && statusFilter === 'openAr'}
            title="Show open invoices that are not overdue"
          />
          <StatTile
            icon={FaExclamationTriangle}
            label="Overdue"
            value={formatCurrency(summary.overdueInvoiceCents)}
            helper={`${summary.overdueInvoiceCount} invoice${summary.overdueInvoiceCount === 1 ? '' : 's'}`}
            onClick={() => setInvoiceCardFilter('overdue')}
            selected={activeView === 'invoices' && statusFilter === 'overdue'}
            title="Show overdue invoices"
          />
          <StatTile icon={FaCheckCircle} label="Received" value={formatCurrency(summary.receivedCents)} helper="Posted payments" />
          <StatTile icon={FaCreditCard} label="Paid In App" value={formatCurrency(summary.paidThroughAppCents)} helper="Stripe card or ACH" />
          <StatTile icon={FaMoneyBillWave} label="Manual Paid" value={formatCurrency(summary.manualPaymentCents)} helper="Cash, check, external" />
          <StatTile icon={FaClock} label="Needs Checkout" value={summary.pendingCheckoutCount} helper="Pending subscriptions" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">{pageMeta.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{recordsForView.length} record{recordsForView.length === 1 ? '' : 's'} shown.</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  {activeView === 'invoices' && (
                    <Link
                      to="/company/sales/invoices/new"
                      className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      New Invoice
                    </Link>
                  )}
                  <label className="relative">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:w-64"
                      placeholder="Search customer or source"
                    />
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">All statuses</option>
                    {(activeView === 'payments'
                      ? ['posted', 'pending', 'failed', 'refunded', 'void']
                      : activeView === 'subscriptions'
                        ? ['active', 'notStarted', 'pendingPaymentMethod', 'pendingStripe', 'pastDue', 'paused', 'canceled']
                        : ['openAr', 'overdue', 'draft', 'open', 'partiallyPaid', 'paid', 'void', 'uncollectible']
                    ).map((status) => (
                      <option key={status} value={status}>{statusOptionLabel(status)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="p-6 text-sm text-slate-500">Loading finance records...</div>
            ) : recordsForView.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No records found" body="Try changing the filter, or create invoices from job detail and service agreement billing." />
              </div>
            ) : activeView === 'payments' ? (
              <PaymentsTable payments={recordsForView} />
            ) : activeView === 'subscriptions' ? (
              <SubscriptionsTable
                subscriptions={recordsForView}
                onStartCheckout={startSubscriptionCheckout}
                startingCheckoutId={startingCheckoutId}
                onCreateInvoice={createSubscriptionInvoice}
                creatingInvoiceId={creatingInvoiceId}
              />
            ) : (
              <InvoicesTable
                invoices={recordsForView}
                openActionInvoiceId={openActionInvoiceId}
                onToggleActions={toggleInvoiceActions}
                sendingInvoiceId={sendingInvoiceId}
              />
            )}
          </div>

          <aside className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Recently Paid</h2>
              <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                {recentPaid.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">No payments posted yet.</div>
                ) : recentPaid.map((payment) => (
                  <div key={payment.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{payment.customerName || 'Customer'}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {labelize(payment.method)} · {formatDate(payment.receivedAt || payment.createdAt)}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId ? 'Paid through app' : 'Recorded manually'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Billing Flow</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>Accepted service agreements create recurring billing subscriptions.</p>
                <p>Recurring subscriptions default to manual invoices until the customer completes automatic payment setup.</p>
                <p>Stripe subscriptions sync invoices, payments, and receipt links back into the same finance records.</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">AR Aging</h2>
              <div className="mt-4 space-y-3">
                <InsightRow label="Current" value={formatCurrency(arAging.current)} />
                <InsightRow label="1-30 Past Due" value={formatCurrency(arAging.days1to30)} tone={arAging.days1to30 > 0 ? 'amber' : 'slate'} />
                <InsightRow label="31-60 Past Due" value={formatCurrency(arAging.days31to60)} tone={arAging.days31to60 > 0 ? 'rose' : 'slate'} />
                <InsightRow label="61+ Past Due" value={formatCurrency(arAging.days61plus)} tone={arAging.days61plus > 0 ? 'rose' : 'slate'} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Subscription Readiness</h2>
              <div className="mt-4 space-y-3">
                <InsightRow label="Active" value={subscriptionReadiness.activeCount} tone="emerald" />
                <InsightRow label="Need Payment Method" value={subscriptionReadiness.pendingPaymentCount} tone={subscriptionReadiness.pendingPaymentCount > 0 ? 'amber' : 'slate'} />
                <InsightRow label="Missing Stripe Account" value={subscriptionReadiness.missingStripeAccountCount} tone={subscriptionReadiness.missingStripeAccountCount > 0 ? 'rose' : 'slate'} />
                <InsightRow label="Missing Stripe Customer" value={subscriptionReadiness.missingCustomerCount} tone={subscriptionReadiness.missingCustomerCount > 0 ? 'amber' : 'slate'} />
              </div>
            </div>
          </aside>
        </section>
      </div>

      {recordPaymentInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleRecordPayment} className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Record Payment</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {recordPaymentInvoice.invoiceNumber || 'Invoice'} · Balance {formatCurrency(invoiceBalanceCents(recordPaymentInvoice))}
                </p>
              </div>
              <button type="button" onClick={closeRecordPaymentModal} className="rounded-md border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Payment Method</span>
                <select
                  value={paymentForm.method}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  {manualPaymentMethods.map((method) => (
                    <option key={method} value={method}>{labelize(method)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Reference Number</span>
                <input
                  value={paymentForm.referenceNumber}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, referenceNumber: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Check number, receipt id, or note"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Memo</span>
                <textarea
                  value={paymentForm.memo}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, memo: event.target.value }))}
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Optional internal payment note"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button type="button" onClick={closeRecordPaymentModal} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button type="submit" disabled={savingPayment} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                {savingPayment ? 'Saving...' : 'Record Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {openActionInvoice && actionMenuPosition && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close invoice actions"
            onClick={closeInvoiceActions}
          />
          <div
            role="menu"
            style={{
              top: actionMenuPosition.top,
              left: actionMenuPosition.left,
            }}
            className="fixed z-50 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          >
            <Link
              to={`/company/sales/invoices/${openActionInvoice.id}`}
              role="menuitem"
              onClick={closeInvoiceActions}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <FaFileInvoiceDollar className="h-4 w-4 shrink-0" />
              <span>View Details</span>
            </Link>
            <InvoiceActionMenuItem
              label="Send Reminder"
              icon={FaEnvelope}
              tone="blue"
              loading={sendingInvoiceId === openActionInvoice.id}
              disabled={Boolean(invoiceSendDisabledReason(openActionInvoice)) || Boolean(sendingInvoiceId)}
              title={invoiceSendDisabledReason(openActionInvoice)}
              onClick={() => {
                sendInvoiceReminder(openActionInvoice);
                closeInvoiceActions();
              }}
            />
            <InvoiceActionMenuItem
              label="Record Payment"
              icon={FaReceipt}
              tone="emerald"
              disabled={invoiceBalanceCents(openActionInvoice) <= 0 || ['void', 'uncollectible'].includes(normalizeStatus(openActionInvoice.status))}
              title={invoiceBalanceCents(openActionInvoice) <= 0 ? 'This invoice has no open balance.' : ''}
              onClick={() => {
                openRecordPaymentModal(openActionInvoice);
                closeInvoiceActions();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};

const InvoicesTable = ({
  invoices,
  openActionInvoiceId,
  onToggleActions,
  sendingInvoiceId,
}) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-5 py-3">Customer</th>
          <th className="px-5 py-3">Source</th>
          <th className="px-5 py-3">Total</th>
          <th className="px-5 py-3">Due</th>
          <th className="px-5 py-3">Aging</th>
          <th className="px-5 py-3">Status</th>
          <th className="px-5 py-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {invoices.map((invoice) => {
          const balanceCents = invoiceBalanceCents(invoice);
          const aging = invoiceAgingInfo(invoice);
          const agingTone = {
            emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
            amber: 'border-amber-200 bg-amber-50 text-amber-700',
            rose: 'border-rose-200 bg-rose-50 text-rose-700',
            slate: 'border-slate-200 bg-slate-50 text-slate-700',
          }[aging.tone] || 'border-slate-200 bg-slate-50 text-slate-700';

          return (
            <tr key={invoice.id} className="transition hover:bg-slate-50">
              <td className="px-5 py-4 text-slate-700">
                {customerLink(invoice.customerId) ? (
                  <Link to={customerLink(invoice.customerId)} className="font-semibold text-slate-900 hover:text-blue-700">
                    {invoice.customerName || invoice.email || 'Customer'}
                  </Link>
                ) : (
                  invoice.customerName || invoice.email || 'Customer'
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {invoice.invoiceNumber || 'Invoice'} - {labelize(invoice.type)} - {labelize(invoice.deliveryMethod)}
                </p>
              </td>
              <td className="px-5 py-4"><InvoiceSourceLinks invoice={invoice} /></td>
              <td className="px-5 py-4 font-semibold text-slate-900">{formatCurrency(invoice.totalAmountCents)}</td>
              <td className="px-5 py-4">
                <p className="font-semibold text-slate-900">{formatCurrency(balanceCents)}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(invoice.dueDate || invoice.createdAt)}</p>
              </td>
              <td className="px-5 py-4">
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${agingTone}`}>
                  {aging.label}
                </span>
                <p className="mt-1 text-xs text-slate-500">{aging.helper}</p>
              </td>
              <td className="px-5 py-4"><StatusBadge status={invoice.status || SalesInvoiceStatus.draft} /></td>
              <td className="px-5 py-4 text-right">
                <button
                  type="button"
                  onClick={(event) => onToggleActions(invoice.id, event)}
                  disabled={sendingInvoiceId === invoice.id}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  aria-haspopup="menu"
                  aria-expanded={openActionInvoiceId === invoice.id}
                  aria-label={`Actions for ${invoice.invoiceNumber || invoice.customerName || 'invoice'}`}
                  title="Actions"
                >
                  <FaEllipsisV className="text-sm" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const PaymentsTable = ({ payments }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-5 py-3">Customer</th>
          <th className="px-5 py-3">Amount</th>
          <th className="px-5 py-3">Method</th>
          <th className="px-5 py-3">Type</th>
          <th className="px-5 py-3">Received</th>
          <th className="px-5 py-3">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {payments.map((payment) => {
          const paidInApp = appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId;

          return (
            <tr key={payment.id} className="transition hover:bg-slate-50">
              <td className="px-5 py-4">
                {customerLink(payment.customerId) ? (
                  <Link to={customerLink(payment.customerId)} className="font-semibold text-slate-900 hover:text-blue-700">
                    {payment.customerName || 'Customer'}
                  </Link>
                ) : (
                  <p className="font-semibold text-slate-900">{payment.customerName || 'Customer'}</p>
                )}
                <p className="mt-1 text-xs text-slate-500">{payment.referenceNumber || (payment.invoiceId ? 'Invoice payment' : 'Payment')}</p>
              </td>
              <td className="px-5 py-4 font-semibold text-slate-900">{formatCurrency(payment.amountCents)}</td>
              <td className="px-5 py-4 text-slate-700">{labelize(payment.method)}</td>
              <td className="px-5 py-4">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${paidInApp ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  {paidInApp ? 'Paid Through App' : 'Manual'}
                </span>
              </td>
              <td className="px-5 py-4 text-slate-500">{formatDate(payment.receivedAt || payment.createdAt)}</td>
              <td className="px-5 py-4"><StatusBadge status={payment.status || SalesPaymentStatus.posted} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const SubscriptionsTable = ({
  subscriptions,
  onStartCheckout,
  startingCheckoutId,
  onCreateInvoice,
  creatingInvoiceId,
}) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-5 py-3">Customer</th>
          <th className="px-5 py-3">Amount</th>
          <th className="px-5 py-3">Agreement</th>
          <th className="px-5 py-3">Current Period</th>
          <th className="px-5 py-3">Next Invoice</th>
          <th className="px-5 py-3">Stripe</th>
          <th className="px-5 py-3">Status</th>
          <th className="px-5 py-3"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {subscriptions.map((subscription) => {
          const statusKey = normalizeStatus(subscription.stripeStatus || subscription.status);
          const isActive = ['active', 'trialing'].includes(statusKey);
          const billingCollectionMethod = subscription.billingCollectionMethod || SalesBillingCollectionMethod.manualUntilAutopay;
          const isStripeManagedBilling = billingCollectionMethod === SalesBillingCollectionMethod.automaticStripe || isActive;
          const manualBillingAllowed = subscription.manualBillingEnabled !== false && !isStripeManagedBilling;
          const workflowLabel = isStripeManagedBilling ? 'Automatic Stripe billing' : 'Manual invoices until autopay';
          const canCheckout = !isStripeManagedBilling && Number(subscription.amountCents || 0) > 0 && Boolean(subscription.stripeConnectedAccountId);
          const canCreateInvoice = manualBillingAllowed && Number(subscription.amountCents || 0) > 0;
          const manualInvoicePreview = getSubscriptionBillingPeriodPreview(subscription);

          return (
            <tr key={subscription.id} className="transition hover:bg-slate-50">
              <td className="px-5 py-4">
                <Link to={`/company/sales/subscriptions/${subscription.id}`} className="font-semibold text-slate-900 hover:text-blue-700">
                  {subscription.customerName || 'Customer'}
                </Link>
                <p className="mt-1 text-xs text-slate-500">{subscription.email || 'Billing subscription'}</p>
              </td>
              <td className="px-5 py-4">
                <p className="font-semibold text-slate-900">{formatCurrency(subscription.amountCents)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Every {subscription.intervalCount > 1 ? `${subscription.intervalCount} ` : ''}{subscription.interval || 'month'}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{workflowLabel}</p>
              </td>
              <td className="px-5 py-4">
                {subscription.agreementId ? (
                  <Link to={`/company/sales/agreements/${subscription.agreementId}`} className="font-semibold text-blue-700 hover:text-blue-900">
                    View agreement
                  </Link>
                ) : (
                  <span className="text-slate-500">Not linked</span>
                )}
              </td>
              <td className="px-5 py-4 text-slate-600">
                {formatDate(subscription.currentPeriodStart)} - {formatDate(subscription.currentPeriodEnd)}
              </td>
              <td className="px-5 py-4">
                <p className="font-semibold text-slate-900">{formatDate(manualInvoicePreview.invoiceSendAt || subscription.manualBillingNextInvoiceAt)}</p>
                <p className="mt-1 text-xs text-slate-500">Due {formatDate(subscription.manualBillingNextDueDate || manualInvoicePreview.dueDate)}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Auto send {subscription.manualBillingAutoSendEnabled ? 'on' : 'off'}
                </p>
              </td>
              <td className="px-5 py-4">
                <p className="max-w-44 truncate text-xs text-slate-500">{subscription.stripeSubscriptionId || 'Not created'}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{labelize(subscription.autopayStatus || 'not setup')}</p>
                {subscription.checkoutUrl && !isStripeManagedBilling && (
                  <a href={subscription.checkoutUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900">
                    Existing checkout <FaExternalLinkAlt />
                  </a>
                )}
              </td>
              <td className="px-5 py-4"><StatusBadge status={subscription.stripeStatus || subscription.status} /></td>
              <td className="px-5 py-4 text-right">
                <div className="flex justify-end gap-2">
                  <Link
                    to={`/company/sales/subscriptions/${subscription.id}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Details
                  </Link>
                  <button
                    type="button"
                    onClick={() => onStartCheckout(subscription)}
                    disabled={!canCheckout || startingCheckoutId === subscription.id}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {startingCheckoutId === subscription.id ? 'Opening...' : isActive ? 'Active' : 'Start Checkout'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreateInvoice(subscription)}
                    disabled={!canCreateInvoice || creatingInvoiceId === subscription.id}
                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingInvoiceId === subscription.id ? 'Creating...' : 'Create Invoice'}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default SalesFinanceBoard;
