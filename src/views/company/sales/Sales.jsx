import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaCreditCard,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaFileSignature,
  FaInfoCircle,
  FaMoneyBillWave,
  FaPlus,
  FaReceipt,
  FaRoute,
  FaTags,
  FaUsers,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import {
  SalesAgreementStatus,
  SalesBillingSubscriptionStatus,
  SalesInvoiceStatus,
  SalesPaymentStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import { buildTermsContent, getTermDescription } from '../../../utils/models/TermsTemplate';
import { getTerms, listenTermsTemplates } from '../../../utils/terms/termsTemplateFirestore';
import FeatureInfoButton from '../../../components/FeatureInfoButton';
import BillingReadinessCard from './components/BillingReadinessCard';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const statusTone = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  superseded: 'bg-violet-50 text-violet-700 border-violet-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  posted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sent: 'bg-sky-50 text-sky-700 border-sky-200',
  open: 'bg-sky-50 text-sky-700 border-sky-200',
  partiallypaid: 'bg-amber-50 text-amber-700 border-amber-200',
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  pendingpaymentmethod: 'bg-amber-50 text-amber-700 border-amber-200',
  pendingstripe: 'bg-amber-50 text-amber-700 border-amber-200',
  pastdue: 'bg-rose-50 text-rose-700 border-rose-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  canceled: 'bg-slate-100 text-slate-500 border-slate-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  void: 'bg-slate-100 text-slate-500 border-slate-200',
  refunded: 'bg-slate-100 text-slate-500 border-slate-200',
  uncollectible: 'bg-rose-50 text-rose-700 border-rose-200',
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

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return 'Not set';
  return format(new Date(millis), 'MMM d, yyyy');
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const sortByFreshest = (records) =>
  [...records].sort((left, right) => {
    const rightMillis = toMillis(right.updatedAt || right.createdAt);
    const leftMillis = toMillis(left.updatedAt || left.createdAt);
    return rightMillis - leftMillis;
  });

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const isActiveSubscription = (subscription) => {
  const status = normalizeStatus(subscription.stripeStatus || subscription.status);
  return status === 'active' || status === 'trialing';
};

const invoiceBalanceCents = (invoice) => {
  if (invoice.amountDueCents !== undefined && invoice.amountDueCents !== null) return Number(invoice.amountDueCents) || 0;

  const total = Number(invoice.totalAmountCents || invoice.totalCents) || 0;
  const paid = Number(invoice.amountPaidCents) || 0;
  const writtenOff = Number(invoice.writeOffAmountCents) || 0;

  return Math.max(total - paid - writtenOff, 0);
};

const appPaymentMethods = new Set(['stripeCard', 'stripeAch']);

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || 'bg-slate-50 text-slate-700 border-slate-200';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const StatTile = ({ icon: Icon, label, value, helper }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      </div>
      <span className="rounded-md bg-slate-100 p-2 text-slate-600">
        <Icon />
      </span>
    </div>
    {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
  </div>
);

const EmptyState = ({ title, body }) => (
  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
    <p className="font-semibold text-slate-800">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{body}</p>
  </div>
);

const Sales = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId } = useContext(Context);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [billingProfiles, setBillingProfiles] = useState([]);
  const [billingSubscriptions, setBillingSubscriptions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [selectedTermsTemplateId, setSelectedTermsTemplateId] = useState('');
  const [selectedTerms, setSelectedTerms] = useState([]);
  const [termsLoading, setTermsLoading] = useState(false);

  useEffect(() => {
    setErrors([]);

    if (!recentlySelectedCompany) {
      setLoading(false);
      setAgreements([]);
      setBillingProfiles([]);
      setBillingSubscriptions([]);
      setInvoices([]);
      setPayments([]);
      return undefined;
    }

    setLoading(true);
    let firstSnapshotsRemaining = 5;

    const handleSnapshot = (setter) => (snapshot) => {
      setter(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      firstSnapshotsRemaining -= 1;

      if (firstSnapshotsRemaining <= 0) {
        setLoading(false);
      }
    };

    const handleError = (collectionName) => (error) => {
      console.error(`Unable to load ${collectionName}`, error);
      setErrors((current) => [...current, `${labelize(collectionName)}: ${error.message}`]);
      setLoading(false);
    };

    const companyFilter = where('companyId', '==', recentlySelectedCompany);
    const subscriptions = [
      onSnapshot(
        query(collection(db, salesCollectionNames.agreements), companyFilter),
        handleSnapshot(setAgreements),
        handleError(salesCollectionNames.agreements)
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.billingProfiles), companyFilter),
        handleSnapshot(setBillingProfiles),
        handleError(salesCollectionNames.billingProfiles)
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.billingSubscriptions), companyFilter),
        handleSnapshot(setBillingSubscriptions),
        handleError(salesCollectionNames.billingSubscriptions)
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.invoices), companyFilter),
        handleSnapshot(setInvoices),
        handleError(salesCollectionNames.invoices)
      ),
      onSnapshot(
        query(collection(db, salesCollectionNames.payments), companyFilter),
        handleSnapshot(setPayments),
        handleError(salesCollectionNames.payments)
      ),
    ];

    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTermsTemplates([]);
      setSelectedTermsTemplateId('');
      return undefined;
    }

    return listenTermsTemplates(
      recentlySelectedCompany,
      (templates) => {
        setTermsTemplates(templates);
        setSelectedTermsTemplateId((currentTemplateId) => currentTemplateId || templates[0]?.id || '');
      },
      (error) => {
        console.error('Unable to load terms templates', error);
        setErrors((current) => [...current, `Terms Templates: ${error.message}`]);
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !selectedTermsTemplateId) {
      setSelectedTerms([]);
      return undefined;
    }

    let isActive = true;
    setTermsLoading(true);

    getTerms(recentlySelectedCompany, selectedTermsTemplateId)
      .then((terms) => {
        if (isActive) setSelectedTerms(terms);
      })
      .catch((error) => {
        console.error('Unable to load terms for template', error);
        if (isActive) setErrors((current) => [...current, `Template Terms: ${error.message}`]);
      })
      .finally(() => {
        if (isActive) setTermsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [recentlySelectedCompany, selectedTermsTemplateId]);

  const billingProfileByCustomerId = useMemo(() => {
    const profileMap = new Map();

    billingProfiles.forEach((profile) => {
      if (profile.customerId) profileMap.set(profile.customerId, profile);
      if (profile.customerUserId) profileMap.set(profile.customerUserId, profile);
    });

    return profileMap;
  }, [billingProfiles]);

  const activeSubscriptions = useMemo(
    () => billingSubscriptions.filter((subscription) => isActiveSubscription(subscription)),
    [billingSubscriptions]
  );

  const activatedAgreementIds = useMemo(() => {
    const agreementIds = new Set();

    activeSubscriptions.forEach((subscription) => {
      if (subscription.agreementId) agreementIds.add(subscription.agreementId);
    });

    return agreementIds;
  }, [activeSubscriptions]);

  const salesSummary = useMemo(() => {
    const mrrCents = activeSubscriptions.reduce(
      (total, subscription) => total + (Number(subscription.amountCents) || 0),
      0
    );
    const receivableStatuses = new Set([
      normalizeStatus(SalesInvoiceStatus.open),
      normalizeStatus(SalesInvoiceStatus.partiallyPaid),
      normalizeStatus(SalesInvoiceStatus.overdue),
    ]);
    const accountsReceivableCents = invoices
      .filter((invoice) => receivableStatuses.has(normalizeStatus(invoice.status)))
      .reduce((total, invoice) => total + invoiceBalanceCents(invoice), 0);
    const issuedInvoiceCents = invoices
      .filter((invoice) => !['draft', 'void'].includes(normalizeStatus(invoice.status)))
      .reduce((total, invoice) => total + (Number(invoice.totalAmountCents) || 0), 0);
    const postedPayments = payments.filter((payment) => normalizeStatus(payment.status) === SalesPaymentStatus.posted);
    const postedPaymentCents = postedPayments.reduce((total, payment) => total + (Number(payment.amountCents) || 0), 0);
    const paidThroughAppCents = postedPayments
      .filter((payment) => appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId)
      .reduce((total, payment) => total + (Number(payment.amountCents) || 0), 0);
    const manualPaymentCents = postedPayments
      .filter((payment) => !appPaymentMethods.has(payment.method) && !payment.stripePaymentIntentId && !payment.stripeChargeId)
      .reduce((total, payment) => total + (Number(payment.amountCents) || 0), 0);
    const emailOnlyProfileCount = billingProfiles.filter((profile) => !profile.customerUserId && profile.email).length;
    const manualInvoiceCount = invoices.filter((invoice) => normalizeStatus(invoice.type) === 'manual').length;
    const acceptedAgreements = agreements.filter(
      (agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.accepted
    );
    const pendingBillingCount = acceptedAgreements.filter(
      (agreement) => !activatedAgreementIds.has(agreement.id)
    ).length;

    return {
      mrrCents,
      issuedInvoiceCents,
      accountsReceivableCents,
      postedPaymentCents,
      paidThroughAppCents,
      manualPaymentCents,
      emailOnlyProfileCount,
      manualInvoiceCount,
      pendingBillingCount,
      sentAgreementCount: agreements.filter((agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.sent)
        .length,
      acceptedAgreementCount: acceptedAgreements.length,
    };
  }, [activeSubscriptions, agreements, activatedAgreementIds, billingProfiles, invoices, payments]);

  const recentAgreements = useMemo(() => sortByFreshest(agreements).slice(0, 8), [agreements]);
  const recentSubscriptions = useMemo(() => sortByFreshest(billingSubscriptions).slice(0, 8), [billingSubscriptions]);
  const recentInvoices = useMemo(() => sortByFreshest(invoices).slice(0, 8), [invoices]);
  const recentPayments = useMemo(() => sortByFreshest(payments).slice(0, 6), [payments]);
  const selectedTermsTemplate = useMemo(
    () => termsTemplates.find((template) => template.id === selectedTermsTemplateId) || null,
    [selectedTermsTemplateId, termsTemplates]
  );
  const selectedTermsContent = useMemo(
    () => buildTermsContent(selectedTermsTemplate, selectedTerms),
    [selectedTerms, selectedTermsTemplate]
  );

  const customerNameFor = (record) => {
    const profile = billingProfileByCustomerId.get(record.customerId) || billingProfileByCustomerId.get(record.customerUserId);
    return record.customerName || profile?.customerName || profile?.displayName || 'Customer';
  };

  const selectedCompanyName = recentlySelectedCompanyName || 'Selected company';

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Feature Flag 004
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {selectedCompanyName}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">Sales Dashboard</h1>
                <FeatureInfoButton title="How Sales Works" align="left">
                  <p>
                    Sales is the finance workspace for homeowner billing. It tracks agreements, billing profiles,
                    Stripe subscriptions, invoices, accounts receivable, and posted payments.
                  </p>
                  <p>
                    Job estimates still start from Job Detail. Once accepted, those snapshots can become Sales
                    invoices and, later, Stripe invoice items on the pool company connected account.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Agreements, customer billing profiles, subscriptions, invoices, accounts receivable, and payment history.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                to="/company/sales/catalog-items"
                className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                <FaTags className="text-xs" />
                Catalog Items
              </Link>
              <Link
                to="/company/settings/terms-templates"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FaFileSignature className="text-xs" />
                Terms Templates
              </Link>
              <Link
                to="/company/sales/invoices/new"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FaFileInvoiceDollar className="text-xs" />
                Invoice
              </Link>
              <Link
                to="/company/sales/agreements/new"
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                <FaPlus className="text-xs" />
                Agreement
              </Link>
            </div>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="flex gap-2">
              <FaInfoCircle className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Some sales data could not be loaded.</p>
                <p className="mt-1">{errors.join(' ')}</p>
              </div>
            </div>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <StatTile icon={FaUsers} label="Billing Profiles" value={billingProfiles.length} helper="Customers ready for billing" />
          <StatTile icon={FaRoute} label="Sent" value={salesSummary.sentAgreementCount} helper="Waiting on customer" />
          <StatTile icon={FaCheckCircle} label="Accepted" value={salesSummary.acceptedAgreementCount} helper="Approved agreements" />
          <StatTile icon={FaCreditCard} label="Active Subs" value={activeSubscriptions.length} helper={formatCurrency(salesSummary.mrrCents)} />
          <StatTile icon={FaFileInvoiceDollar} label="Invoiced" value={formatCurrency(salesSummary.issuedInvoiceCents)} helper="Issued invoice total" />
          <StatTile icon={FaFileInvoiceDollar} label="AR" value={formatCurrency(salesSummary.accountsReceivableCents)} helper="Open invoice balance" />
          <StatTile icon={FaReceipt} label="Received" value={formatCurrency(salesSummary.postedPaymentCents)} helper="Posted collections" />
          <StatTile icon={FaCreditCard} label="Paid In App" value={formatCurrency(salesSummary.paidThroughAppCents)} helper="Stripe card or ACH" />
          <StatTile icon={FaMoneyBillWave} label="Manual Paid" value={formatCurrency(salesSummary.manualPaymentCents)} helper="Cash, check, external" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Agreement Pipeline</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {salesSummary.pendingBillingCount} accepted agreement{salesSummary.pendingBillingCount === 1 ? '' : 's'} need billing.
                  </p>
                </div>
                <FaCalendarAlt className="text-slate-400" />
              </div>

              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-5 text-sm text-slate-500">Loading sales agreements...</div>
                ) : recentAgreements.length === 0 ? (
                  <div className="p-5">
                    <EmptyState title="No agreements yet" body="Accepted homeowner agreements will appear here as the sales slice fills in." />
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Customer</th>
                        <th className="px-5 py-3">Agreement</th>
                        <th className="px-5 py-3">Amount</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {recentAgreements.map((agreement) => (
                        <tr key={agreement.id} className="transition hover:bg-slate-50">
                          <td className="px-5 py-4 font-medium text-slate-900">
                            <Link to={`/company/sales/agreements/${agreement.id}`} className="hover:text-blue-700">
                              {customerNameFor(agreement)}
                            </Link>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <Link to={`/company/sales/agreements/${agreement.id}`} className="hover:text-blue-700">
                              {agreement.title || labelize(agreement.sourceType)}
                            </Link>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {formatCurrency(agreement.amountCents || agreement.rateAmountCents)}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={agreement.status} />
                          </td>
                          <td className="px-5 py-4 text-slate-500">{formatDate(agreement.updatedAt || agreement.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                  <h2 className="text-lg font-bold text-slate-950">Billing Subscriptions</h2>
                  <p className="mt-1 text-sm text-slate-500">Stripe subscription records for homeowners.</p>
                  </div>
                  <Link to="/company/sales/subscriptions" className="text-xs font-semibold text-blue-700 hover:text-blue-900">View all</Link>
                </div>

                <div className="divide-y divide-slate-100">
                  {loading ? (
                    <div className="p-5 text-sm text-slate-500">Loading subscriptions...</div>
                  ) : recentSubscriptions.length === 0 ? (
                    <div className="p-5">
                      <EmptyState title="No subscriptions yet" body="Customer billing subscriptions will land here after Stripe setup." />
                    </div>
                  ) : (
                    recentSubscriptions.map((subscription) => (
                      <Link key={subscription.id} to={`/company/sales/subscriptions/${subscription.id}`} className="flex items-start justify-between gap-4 px-5 py-4 transition hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{customerNameFor(subscription)}</p>
                          <p className="mt-1 text-sm text-slate-500">{formatCurrency(subscription.amountCents)} monthly</p>
                        </div>
                        <StatusBadge status={subscription.stripeStatus || subscription.status || SalesBillingSubscriptionStatus.notStarted} />
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                  <h2 className="text-lg font-bold text-slate-950">Invoices</h2>
                  <p className="mt-1 text-sm text-slate-500">Stripe, email, and manual invoice activity.</p>
                  </div>
                  <Link to="/company/sales/invoices" className="text-xs font-semibold text-blue-700 hover:text-blue-900">View all</Link>
                </div>

                <div className="divide-y divide-slate-100">
                  {loading ? (
                    <div className="p-5 text-sm text-slate-500">Loading invoices...</div>
                  ) : recentInvoices.length === 0 ? (
                    <div className="p-5">
                      <EmptyState title="No invoices yet" body="Customer invoice records will appear here when billing starts." />
                    </div>
                  ) : (
                    recentInvoices.map((invoice) => (
                      <Link key={invoice.id} to={`/company/sales/invoices/${invoice.id}`} className="flex items-start justify-between gap-4 px-5 py-4 transition hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{customerNameFor(invoice)}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {labelize(invoice.deliveryMethod || 'email')} · Due {formatDate(invoice.dueDate || invoice.dueAt || invoice.createdAt)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">
                            {formatCurrency(invoiceBalanceCents(invoice))}
                          </p>
                          <div className="mt-1">
                            <StatusBadge status={invoice.status || SalesInvoiceStatus.draft} />
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                  <h2 className="text-lg font-bold text-slate-950">Recently Paid</h2>
                  <p className="mt-1 text-sm text-slate-500">Stripe and recorded physical payments.</p>
                  </div>
                  <Link to="/company/sales/payments" className="text-xs font-semibold text-blue-700 hover:text-blue-900">View all</Link>
                </div>

                <div className="divide-y divide-slate-100">
                  {loading ? (
                    <div className="p-5 text-sm text-slate-500">Loading payments...</div>
                  ) : recentPayments.length === 0 ? (
                    <div className="p-5">
                      <EmptyState title="No payments yet" body="Card, ACH, cash, check, and external payments will appear here." />
                    </div>
                  ) : (
                    recentPayments.map((payment) => (
                      <div key={payment.id} className="flex items-start justify-between gap-4 px-5 py-4">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{customerNameFor(payment)}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {labelize(payment.method)} · {formatDate(payment.receivedAt || payment.createdAt)}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {appPaymentMethods.has(payment.method) || payment.stripePaymentIntentId || payment.stripeChargeId
                              ? 'Paid through app'
                              : 'Recorded manually'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                          <div className="mt-1">
                            <StatusBadge status={payment.status || SalesPaymentStatus.posted} />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Sales Setup</h2>
                <FaTags className="text-slate-400" />
              </div>
              <div className="mt-4 space-y-3">
                <Link
                  to="/company/sales/catalog-items"
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FaTags className="text-xs" />
                    Sales Catalog Items
                  </span>
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
                <Link
                  to="/company/sales/agreements"
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FaFileSignature className="text-xs" />
                    Service Agreements
                  </span>
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
                <Link
                  to="/company/sales/invoices"
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FaFileInvoiceDollar className="text-xs" />
                    Invoices
                  </span>
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
                <Link
                  to="/company/sales/payments"
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FaReceipt className="text-xs" />
                    Payment History
                  </span>
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
                <Link
                  to="/company/sales/subscriptions"
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FaCreditCard className="text-xs" />
                    Billing Subscriptions
                  </span>
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
                <Link
                  to="/company/settings/terms-templates"
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FaFileSignature className="text-xs" />
                    Terms Templates
                  </span>
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Agreement Terms</h2>
                <FaFileSignature className="text-slate-400" />
              </div>

              <div className="mt-4 space-y-3">
                <label htmlFor="termsTemplate" className="block text-sm font-semibold text-slate-700">
                  Terms Template
                </label>
                <select
                  id="termsTemplate"
                  value={selectedTermsTemplateId}
                  onChange={(event) => setSelectedTermsTemplateId(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select a template</option>
                  {termsTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>

                {selectedTermsTemplate ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold text-slate-900">{selectedTermsTemplate.name}</p>
                    {selectedTermsTemplate.description && (
                      <p className="mt-1 text-sm text-slate-500">{selectedTermsTemplate.description}</p>
                    )}

                    <div className="mt-3 border-t border-slate-200 pt-3">
                      {termsLoading ? (
                        <p className="text-sm text-slate-500">Loading terms...</p>
                      ) : selectedTerms.length > 0 || selectedTermsTemplate.content ? (
                        <div className="space-y-2 text-sm text-slate-700">
                          {selectedTermsTemplate.content && (
                            <p className="whitespace-pre-wrap">{selectedTermsTemplate.content}</p>
                          )}
                          {selectedTerms.map((term, index) => (
                            <p key={term.id} className="flex gap-2">
                              <span className="font-semibold text-slate-500">{index + 1}.</span>
                              <span>{getTermDescription(term)}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No terms saved for this template.</p>
                      )}
                    </div>

                    {selectedTermsContent && (
                      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Ready for service agreement drafts
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                    No terms template selected.
                  </div>
                )}

                <Link
                  to="/company/settings/terms-templates"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800"
                >
                  Manage templates
                  <FaExternalLinkAlt className="text-xs" />
                </Link>
              </div>
            </div>

            <BillingReadinessCard
              activeSubscriptionCount={activeSubscriptions.length}
              billingProfileCount={billingProfiles.length}
              companyId={recentlySelectedCompany}
              connectedAccountId={stripeConnectedAccountId}
            />

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Operational Sources</h2>
              <div className="mt-4 space-y-2">
                <Link
                  to="/company/jobs"
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Jobs
                  <FaExternalLinkAlt className="text-xs text-slate-400" />
                </Link>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
};

export default Sales;
