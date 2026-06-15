import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import {
  FaArrowLeft,
  FaCheckCircle,
  FaEnvelope,
  FaFileSignature,
  FaPlus,
  FaRoute,
  FaSearch,
  FaSort,
  FaSortAmountDown,
  FaSortAmountUp,
} from 'react-icons/fa';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { SalesAgreementStatus, salesCollectionNames } from '../../../utils/models/Sales';
import {
  AgreementBillingType,
  agreementNeedsRecurringRouting,
  buildRecurringRoutingIndex,
  getAgreementBillingType,
} from '../../../utils/sales/agreementRouting';
import { generateServiceAgreementsFromRoutes } from '../../../utils/sales/routeAgreementGeneration';
import FeatureInfoButton from '../../../components/FeatureInfoButton';

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

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const sortDirectionLabels = {
  asc: 'Ascending',
  desc: 'Descending',
};

const agreementSortOptions = [
  { value: 'updated', label: 'Updated' },
  { value: 'customer', label: 'Customer' },
  { value: 'amount', label: 'Amount' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'sent', label: 'Sent Date' },
  { value: 'status', label: 'Status' },
];

const defaultSortDirectionForKey = (sortKey) => (
  ['agreement', 'customer', 'status'].includes(sortKey) ? 'asc' : 'desc'
);

const agreementAmountCents = (agreement = {}) => (
  Number(agreement.totalAmountCents || agreement.rateAmountCents || 0) || 0
);

const sortText = (value) => String(value || '').trim().toLowerCase();

const compareAgreementValues = (left = {}, right = {}, sortKey = 'updated') => {
  if (sortKey === 'amount') {
    return agreementAmountCents(left) - agreementAmountCents(right);
  }

  if (sortKey === 'sent') {
    return toMillis(left.sentAt) - toMillis(right.sentAt);
  }

  if (sortKey === 'updated') {
    return toMillis(left.updatedAt || left.createdAt) - toMillis(right.updatedAt || right.createdAt);
  }

  if (sortKey === 'status') {
    return sortText(left.status || SalesAgreementStatus.draft).localeCompare(sortText(right.status || SalesAgreementStatus.draft));
  }

  if (sortKey === 'agreement') {
    return sortText(left.title || 'Service Agreement').localeCompare(sortText(right.title || 'Service Agreement'));
  }

  return sortText(left.customerName || 'Customer').localeCompare(sortText(right.customerName || 'Customer'));
};

const sortAgreements = (agreements = [], sortKey = 'updated', sortDirection = 'desc') => {
  const directionMultiplier = sortDirection === 'asc' ? 1 : -1;

  return [...agreements].sort((left, right) => {
    const primary = compareAgreementValues(left, right, sortKey);
    if (primary !== 0) return primary * directionMultiplier;

    const customerTieBreak = sortText(left.customerName || 'Customer').localeCompare(sortText(right.customerName || 'Customer'));
    if (customerTieBreak !== 0) return customerTieBreak;

    const titleTieBreak = sortText(left.title || 'Service Agreement').localeCompare(sortText(right.title || 'Service Agreement'));
    if (titleTieBreak !== 0) return titleTieBreak;

    return toMillis(right.updatedAt || right.createdAt) - toMillis(left.updatedAt || left.createdAt);
  });
};

const statusTone = {
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
  sent: 'bg-sky-50 text-sky-700 border-sky-200',
  revised: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  superseded: 'bg-violet-50 text-violet-700 border-violet-200',
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

const billingTypeTone = {
  recurring: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  oneTime: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

const BillingTypeBadge = ({ agreement }) => {
  const billingType = getAgreementBillingType(agreement);
  const tone = billingTypeTone[billingType] || billingTypeTone.oneTime;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {billingType === AgreementBillingType.recurring ? 'Recurring' : 'One Time'}
    </span>
  );
};

const SortHeaderButton = ({ children, sortKey, activeSortKey, sortDirection, onSort }) => {
  const active = activeSortKey === sortKey;
  const Icon = active
    ? (sortDirection === 'asc' ? FaSortAmountUp : FaSortAmountDown)
    : FaSort;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1.5 text-left font-semibold uppercase tracking-wide transition ${active ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
      aria-label={`Sort by ${children}`}
    >
      {children}
      <Icon className="text-[0.65rem]" />
    </button>
  );
};

const normalizeAgreementTypeOptions = (agreementTypes = AgreementBillingType.recurring) => {
  const values = (Array.isArray(agreementTypes) ? agreementTypes : [agreementTypes])
    .filter(Boolean);

  if (values.includes(AgreementBillingType.all)) return [AgreementBillingType.all];

  const validTypes = values.filter((type) => (
    type === AgreementBillingType.recurring ||
    type === AgreementBillingType.oneTime
  ));

  return [...new Set(validTypes.length > 0 ? validTypes : [AgreementBillingType.recurring])];
};

const firstAllowedBillingType = (allowedTypes = [], preferredType = AgreementBillingType.recurring) => {
  if (allowedTypes.includes(AgreementBillingType.all)) {
    if (preferredType === AgreementBillingType.all) return AgreementBillingType.all;
    return preferredType === AgreementBillingType.oneTime ? AgreementBillingType.oneTime : AgreementBillingType.recurring;
  }

  if (allowedTypes.includes(preferredType)) return preferredType;
  return allowedTypes[0] || AgreementBillingType.recurring;
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

const SalesAgreements = ({
  routingQueueOnly = false,
  agreementTypes = AgreementBillingType.recurring,
  defaultAgreementType = AgreementBillingType.recurring,
}) => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    currentUser,
    user,
    currentuser,
    dataBaseUser,
  } = useContext(Context);
  const activeUser = currentUser || user || currentuser || {};
  const activeUserId = activeUser?.uid || activeUser?.id || dataBaseUser?.id || '';
  const [agreements, setAgreements] = useState([]);
  const [recurringStops, setRecurringStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('updated');
  const [sortDirection, setSortDirection] = useState('desc');
  const [error, setError] = useState('');
  const [generatingFromRoutes, setGeneratingFromRoutes] = useState(false);

  const navigate = useNavigate();
  const allowedBillingTypes = useMemo(() => (
    routingQueueOnly ? [AgreementBillingType.recurring] : normalizeAgreementTypeOptions(agreementTypes)
  ), [agreementTypes, routingQueueOnly]);
  const initialBillingTypeFilter = useMemo(() => (
    firstAllowedBillingType(allowedBillingTypes, defaultAgreementType)
  ), [allowedBillingTypes, defaultAgreementType]);
  const [billingTypeFilter, setBillingTypeFilter] = useState(initialBillingTypeFilter);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAgreements([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    const unsubscribeAgreements = onSnapshot(
      query(
        collection(db, salesCollectionNames.agreements),
        where('companyId', '==', recentlySelectedCompany)
      ),
      (snapshot) => {
        const nextAgreements = snapshot.docs
          .map((agreementDoc) => ({ id: agreementDoc.id, ...agreementDoc.data() }))
          .sort((left, right) => toMillis(right.updatedAt || right.createdAt) - toMillis(left.updatedAt || left.createdAt));

        setAgreements(nextAgreements);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load service agreements', snapshotError);
        setError(snapshotError.message || 'Unable to load service agreements.');
        setLoading(false);
      }
    );

    let unsubscribeRecurringStops = () => {};
    if (routingQueueOnly) {
      unsubscribeRecurringStops = onSnapshot(
        collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop'),
        (snapshot) => {
          setRecurringStops(snapshot.docs.map((stopDoc) => ({ id: stopDoc.id, ...stopDoc.data() })));
        },
        (snapshotError) => {
          console.error('Unable to load recurring service stops', snapshotError);
        }
      );
    }

    return () => {
      unsubscribeAgreements();
      unsubscribeRecurringStops();
    };
  }, [recentlySelectedCompany, routingQueueOnly]);

  useEffect(() => {
    setBillingTypeFilter(initialBillingTypeFilter);
  }, [initialBillingTypeFilter]);

  useEffect(() => {
    if (!routingQueueOnly) return;
    setStatusFilter(SalesAgreementStatus.accepted);
    setBillingTypeFilter(AgreementBillingType.recurring);
  }, [routingQueueOnly]);

  const recurringRoutingIndex = useMemo(
    () => buildRecurringRoutingIndex(recurringStops),
    [recurringStops]
  );

  const typeScopedAgreements = useMemo(() => (
    agreements.filter((agreement) => {
      if (allowedBillingTypes.includes(AgreementBillingType.all)) return true;
      return allowedBillingTypes.includes(getAgreementBillingType(agreement));
    })
  ), [agreements, allowedBillingTypes]);

  const filteredAgreements = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const matches = typeScopedAgreements.filter((agreement) => {
      if (routingQueueOnly && !agreementNeedsRecurringRouting(agreement, recurringRoutingIndex)) return false;

      const matchesStatus = statusFilter === 'all' || normalizeStatus(agreement.status) === normalizeStatus(statusFilter);
      if (!matchesStatus) return false;

      const billingType = getAgreementBillingType(agreement);
      const matchesBillingType = billingTypeFilter === AgreementBillingType.all || billingType === billingTypeFilter;
      if (!matchesBillingType) return false;

      if (!normalizedSearch) return true;

      return [
        agreement.title,
        agreement.customerName,
        agreement.email,
        agreement.status,
        billingType,
        billingType === AgreementBillingType.recurring ? 'recurring' : 'one time',
        agreement.termsTemplateName,
        agreement.id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });

    return sortAgreements(matches, sortKey, sortDirection);
  }, [billingTypeFilter, recurringRoutingIndex, routingQueueOnly, searchTerm, sortDirection, sortKey, statusFilter, typeScopedAgreements]);

  const summary = useMemo(() => {
    const draftCount = typeScopedAgreements.filter((agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.draft).length;
    const sentCount = typeScopedAgreements.filter((agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.sent).length;
    const acceptedCount = typeScopedAgreements.filter((agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.accepted).length;
    const needsRoutingCount = typeScopedAgreements.filter((agreement) => agreementNeedsRecurringRouting(agreement, recurringRoutingIndex)).length;
    const totalAmountCents = typeScopedAgreements.reduce(
      (total, agreement) => total + (Number(agreement.totalAmountCents || agreement.rateAmountCents) || 0),
      0
    );

    return {
      draftCount,
      sentCount,
      acceptedCount,
      needsRoutingCount,
      totalAmountCents,
    };
  }, [recurringRoutingIndex, typeScopedAgreements]);

  const selectedCompanyName = recentlySelectedCompanyName || 'Selected company';
  const statusOptions = ['all', ...Object.values(SalesAgreementStatus)];
  const billingTypeOptions = useMemo(() => {
    if (allowedBillingTypes.includes(AgreementBillingType.all)) {
      return [AgreementBillingType.all, AgreementBillingType.recurring, AgreementBillingType.oneTime];
    }

    return allowedBillingTypes.length > 1
      ? [AgreementBillingType.all, ...allowedBillingTypes]
      : allowedBillingTypes;
  }, [allowedBillingTypes]);

  const handleSortKeyChange = (nextSortKey) => {
    setSortKey(nextSortKey);
    setSortDirection(defaultSortDirectionForKey(nextSortKey));
  };

  const handleHeaderSort = (nextSortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
      return;
    }

    handleSortKeyChange(nextSortKey);
  };

  const handleGenerateFromRoutes = async () => {
    if (!recentlySelectedCompany) {
      toast.error('Select a company first.');
      return;
    }

    setGeneratingFromRoutes(true);

    try {
      const routesSnapshot = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'recurringRoutes'));
      const routes = routesSnapshot.docs.map((routeDoc) => ({ id: routeDoc.id, ...routeDoc.data() }));

      if (routes.length === 0) {
        toast.error('No planned routes found to generate from.');
        return;
      }

      const result = await generateServiceAgreementsFromRoutes({
        db,
        companyId: recentlySelectedCompany,
        companyName: selectedCompanyName,
        routes,
        createdByUserId: activeUserId,
      });

      if (result.createdCount > 0) {
        const skippedText = result.skippedExistingCount
          ? ` ${result.skippedExistingCount} stop(s) already had agreements.`
          : '';
        toast.success(`Created ${result.createdCount} route-based agreement draft(s).${skippedText}`);
        setSearchTerm('');
        setStatusFilter(SalesAgreementStatus.draft);
        setBillingTypeFilter(AgreementBillingType.recurring);
        return;
      }

      if (result.skippedExistingCount > 0) {
        toast('All routed recurring stops already have service agreements.');
        return;
      }

      if (result.skippedIncompleteCount > 0 || result.missingStopCount > 0) {
        toast.error('No drafts created. Some route stops are missing customer, location, or recurring stop data.');
        return;
      }

      toast.error('No recurring service stops found on planned routes.');
    } catch (generationError) {
      console.error('Unable to generate service agreements from routes', generationError);
      toast.error('Failed to generate service agreements from routes.');
    } finally {
      setGeneratingFromRoutes(false);
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
                  {selectedCompanyName}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">
                  {routingQueueOnly ? 'Agreements Needing Routing' : 'Service Agreements'}
                </h1>
                <FeatureInfoButton title="How Service Agreements Work" align="left">
                  <p>
                    Service agreements are customer-facing billing snapshots built from company catalog items,
                    service locations, and company-scoped terms templates.
                  </p>
                  <p>
                    Drafts can be reviewed, emailed through SendGrid, accepted by the customer, and later connected
                    to Stripe subscriptions or invoice workflows.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                {routingQueueOnly
                  ? 'Accepted recurring service agreements that still need a routed recurring stop.'
                  : 'Search, review, and send customer service agreement snapshots.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                to="/company/sales"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FaArrowLeft className="text-xs" />
                Sales
              </Link>
              {routingQueueOnly ? (
                <Link
                  to="/company/sales/agreements"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  All Agreements
                </Link>
              ) : (
                <Link
                  to="/company/sales/agreements/needs-routing"
                  className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
                >
                  Needs Routing
                </Link>
              )}
              {!routingQueueOnly && (
                <button
                  type="button"
                  onClick={handleGenerateFromRoutes}
                  disabled={generatingFromRoutes}
                  className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <FaRoute className="text-xs" />
                  {generatingFromRoutes ? 'Generating...' : 'Generate From Routes'}
                </button>
              )}
              <Link
                to="/company/sales/agreements/new"
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                <FaPlus className="text-xs" />
                New Agreement
              </Link>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        <section className={`grid gap-4 sm:grid-cols-2 ${routingQueueOnly ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          <StatTile
            icon={FaFileSignature}
            label={routingQueueOnly ? 'Need Routing' : 'Agreements'}
            value={routingQueueOnly ? filteredAgreements.length : typeScopedAgreements.length}
            helper={routingQueueOnly ? 'Accepted recurring agreements' : 'Current type scope'}
          />
          {!routingQueueOnly && (
            <StatTile icon={FaFileSignature} label="Draft" value={summary.draftCount} helper="Ready to review" />
          )}
          <StatTile icon={FaEnvelope} label="Sent" value={summary.sentCount} helper="Waiting on customer" />
          <StatTile icon={FaCheckCircle} label="Accepted" value={summary.acceptedCount} helper="Ready for billing" />
          <StatTile
            icon={FaFileSignature}
            label={routingQueueOnly ? 'Queue Total' : 'Quoted Value'}
            value={routingQueueOnly ? summary.needsRoutingCount : formatCurrency(summary.totalAmountCents)}
            helper={routingQueueOnly ? 'Need recurring route setup' : 'Draft and active total'}
          />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 lg:grid-cols-[minmax(0,1fr)_180px_160px_170px_130px]">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search by customer, agreement, email, status, or template"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              disabled={routingQueueOnly}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All Statuses' : labelize(status)}</option>
              ))}
            </select>
            <select
              value={billingTypeFilter}
              onChange={(event) => setBillingTypeFilter(event.target.value)}
              disabled={routingQueueOnly || billingTypeOptions.length <= 1}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {billingTypeOptions.map((billingType) => (
                <option key={billingType} value={billingType}>
                  {billingType === AgreementBillingType.all ? 'All Types' : billingType === AgreementBillingType.recurring ? 'Recurring' : 'One Time'}
                </option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(event) => handleSortKeyChange(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Sort service agreements"
            >
              {agreementSortOptions.map((option) => (
                <option key={option.value} value={option.value}>Sort: {option.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label={`Current sort direction: ${sortDirectionLabels[sortDirection]}`}
            >
              {sortDirection === 'asc' ? <FaSortAmountUp className="text-xs" /> : <FaSortAmountDown className="text-xs" />}
              {sortDirectionLabels[sortDirection]}
            </button>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-5 text-sm text-slate-500">Loading service agreements...</div>
            ) : filteredAgreements.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-800">
                  {routingQueueOnly ? 'No recurring agreements need routing' : 'No service agreements found'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {routingQueueOnly ? 'Accepted recurring agreements will appear here until a recurring stop is routed.' : 'Create a new agreement or adjust your search filters.'}
                </p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">
                      <SortHeaderButton sortKey="agreement" activeSortKey={sortKey} sortDirection={sortDirection} onSort={handleHeaderSort}>
                        Agreement
                      </SortHeaderButton>
                    </th>
                    <th className="px-5 py-3">
                      <SortHeaderButton sortKey="customer" activeSortKey={sortKey} sortDirection={sortDirection} onSort={handleHeaderSort}>
                        Customer
                      </SortHeaderButton>
                    </th>
                    <th className="px-5 py-3">
                      <SortHeaderButton sortKey="amount" activeSortKey={sortKey} sortDirection={sortDirection} onSort={handleHeaderSort}>
                        Amount
                      </SortHeaderButton>
                    </th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">
                      <SortHeaderButton sortKey="status" activeSortKey={sortKey} sortDirection={sortDirection} onSort={handleHeaderSort}>
                        Status
                      </SortHeaderButton>
                    </th>
                    <th className="px-5 py-3">
                      <SortHeaderButton sortKey="sent" activeSortKey={sortKey} sortDirection={sortDirection} onSort={handleHeaderSort}>
                        Sent
                      </SortHeaderButton>
                    </th>
                    <th className="px-5 py-3">
                      <SortHeaderButton sortKey="updated" activeSortKey={sortKey} sortDirection={sortDirection} onSort={handleHeaderSort}>
                        Updated
                      </SortHeaderButton>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredAgreements.map((agreement) => (
                    <tr key={agreement.id} className="transition hover:bg-slate-50"
                      onClick={() => navigate(`/company/sales/agreements/${agreement.id}`)}>
                      <td className="px-5 py-4">
                        {agreement.title || 'Service Agreement'}
                        <p className="mt-1 text-xs text-slate-500">{agreement.termsTemplateName || "Service agreement"}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-900">{agreement.customerName || 'Customer'}</p>
                        <p className="mt-1 text-xs text-slate-500">{agreement.email || 'No email'}</p>
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-900">
                        {formatCurrency(agreementAmountCents(agreement))}
                      </td>
                      <td className="px-5 py-4">
                        <BillingTypeBadge agreement={agreement} />
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={agreement.status} />
                      </td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(agreement.sentAt)}</td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(agreement.updatedAt || agreement.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SalesAgreements;
