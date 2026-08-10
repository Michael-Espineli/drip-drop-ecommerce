import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  FaArrowLeft,
  FaCheckCircle,
  FaEdit,
  FaEllipsisV,
  FaEnvelope,
  FaFileSignature,
  FaPlus,
  FaRoute,
  FaSearch,
  FaSort,
  FaSortAmountDown,
  FaSortAmountUp,
  FaTimesCircle,
  FaUserCheck,
} from 'react-icons/fa';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import { SalesAgreementStatus, salesCollectionNames } from '../../../utils/models/Sales';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { appConfirm } from '../../../utils/appDialog';
import { ensureBillingSubscriptionForAgreement } from '../../../utils/sales/agreementBilling';
import { billingFrequencyForAgreement } from '../../../utils/sales/agreementCadence';
import {
  AgreementBillingType,
  agreementNeedsRecurringRouting,
  buildRecurringRoutingIndex,
  getAgreementBillingType,
} from '../../../utils/sales/agreementRouting';
import { generateServiceAgreementsFromRoutes } from '../../../utils/sales/routeAgreementGeneration';
import FeatureInfoButton from '../../../components/FeatureInfoButton';
import SalesAgreementEditorModal from './SalesAgreementEditorModal';
import ServiceAgreementSendDialog from './components/ServiceAgreementSendDialog';

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

const defaultAgreementFilters = {
  searchTerm: '',
  statusFilter: SalesAgreementStatus.draft,
  sortKey: 'updated',
};

const agreementFilterParamAliases = {
  searchTerm: ['q', 'search'],
  statusFilter: ['status'],
  billingTypeFilter: ['type', 'billingType'],
  sortKey: ['sort', 'sortKey'],
  sortDirection: ['direction', 'dir', 'sortDirection'],
};

const agreementFilterParamKeys = Object.values(agreementFilterParamAliases).flat();

const agreementSortOptionValues = agreementSortOptions.map((option) => option.value);

const agreementAmountCents = (agreement = {}) => (
  Number(agreement.totalAmountCents || agreement.rateAmountCents || 0) || 0
);

const agreementSubtotalAmountCents = (agreement = {}) => {
  const directAmount = Number(agreement.subtotalAmountCents || agreement.totalAmountCents || agreement.rateAmountCents || 0);
  if (directAmount) return directAmount;

  const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  return lineItems.reduce((total, item) => {
    const quantity = Number(item.quantity || 1) || 1;
    const lineTotal = Number(item.totalAmountCents || 0);
    if (lineTotal) return total + lineTotal;
    return total + (Number(item.unitAmountCents || 0) * quantity);
  }, 0);
};

const sortText = (value) => String(value || '').trim().toLowerCase();

const finalAgreementStatusKeys = new Set(['accepted', 'canceled', 'cancelled', 'rejected', 'expired', 'superseded']);

const terminalAgreementStatusKeys = new Set(['canceled', 'cancelled', 'rejected', 'expired', 'superseded']);

const renewalPreviousAgreementId = (agreement = {}) => (
  agreement.supersedesAgreementId ||
  agreement.previousAgreementId ||
  agreement.renewalSourceAgreementId ||
  ''
);

const agreementHistoryGroupId = (agreement = {}) => (
  agreement.agreementHistoryGroupId ||
  renewalPreviousAgreementId(agreement) ||
  agreement.id ||
  ''
);

const linkedJobIdForAgreement = (agreement = {}) => {
  if (agreement.jobId) return agreement.jobId;
  if (agreement.workOrderId) return agreement.workOrderId;
  if (normalizeStatus(agreement.sourceType) === 'oneoffjob' && agreement.sourceId) {
    return agreement.sourceId;
  }
  return '';
};

const linkedLeadIdForAgreement = (agreement = {}) => {
  if (agreement.leadId) return agreement.leadId;
  if (agreement.homeownerServiceRequestId) return agreement.homeownerServiceRequestId;
  if (normalizeStatus(agreement.sourceType) === 'lead' && agreement.sourceId) {
    return agreement.sourceId;
  }
  return '';
};

const agreementHasTerms = (agreement = {}) => (
  Boolean(String(agreement.terms || '').trim()) ||
  (Array.isArray(agreement.termsList) && agreement.termsList.length > 0)
);

const agreementSendDisabledReason = ({ agreement, activeUser, selectedCompanyId }) => {
  if (!agreement?.id) return 'Agreement is still loading.';
  if (!activeUser?.uid && !activeUser?.id) return 'You must be signed in to send this agreement.';
  if (selectedCompanyId && agreement.companyId && agreement.companyId !== selectedCompanyId) {
    return 'Select the company that owns this agreement before sending.';
  }
  if (normalizeStatus(agreement.status) === normalizeStatus(SalesAgreementStatus.accepted)) {
    return 'Accepted agreements cannot be sent again from this action.';
  }
  if (terminalAgreementStatusKeys.has(normalizeStatus(agreement.status))) {
    return `Agreement status is ${labelize(agreement.status)}.`;
  }
  if (!Array.isArray(agreement.lineItems) || agreement.lineItems.length === 0) {
    return 'Add at least one line item before sending.';
  }
  if (!agreementHasTerms(agreement)) return 'Add terms before sending.';
  return '';
};

const agreementAcceptanceDisabledReason = ({ agreement, activeUser, selectedCompanyId }) => {
  if (!agreement?.id) return 'Agreement is still loading.';
  if (!activeUser?.uid && !activeUser?.id) return 'You must be signed in to mark this agreement accepted.';
  if (selectedCompanyId && agreement.companyId && agreement.companyId !== selectedCompanyId) {
    return 'Select the company that owns this agreement before marking it accepted.';
  }
  if (normalizeStatus(agreement.status) === normalizeStatus(SalesAgreementStatus.accepted)) {
    return 'Agreement is already accepted.';
  }
  if (terminalAgreementStatusKeys.has(normalizeStatus(agreement.status))) {
    return `Agreement status is ${labelize(agreement.status)}.`;
  }
  return '';
};

const agreementRejectionDisabledReason = ({ agreement, activeUser, selectedCompanyId }) => {
  if (!agreement?.id) return 'Agreement is still loading.';
  if (!activeUser?.uid && !activeUser?.id) return 'You must be signed in to mark this agreement rejected.';
  if (selectedCompanyId && agreement.companyId && agreement.companyId !== selectedCompanyId) {
    return 'Select the company that owns this agreement before marking it rejected.';
  }
  if (finalAgreementStatusKeys.has(normalizeStatus(agreement.status))) {
    return `Agreement status is already ${labelize(agreement.status)}.`;
  }
  return '';
};

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

const firstParamValue = (searchParams, keys = []) => {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value !== null && value !== undefined && value !== '') return value;
  }

  return '';
};

const normalizeAgreementSortKey = (value) => (
  agreementSortOptionValues.find((optionValue) => normalizeStatus(optionValue) === normalizeStatus(value))
    || defaultAgreementFilters.sortKey
);

const normalizeAgreementSortDirection = (value, sortKey) => {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'asc' || normalized === 'desc' ? normalized : defaultSortDirectionForKey(sortKey);
};

const normalizeAgreementStatusFilter = (value) => {
  const normalized = normalizeStatus(value);
  if (!normalized) return defaultAgreementFilters.statusFilter;
  if (normalized === 'all') return 'all';

  return Object.values(SalesAgreementStatus).find((status) => normalizeStatus(status) === normalized)
    || defaultAgreementFilters.statusFilter;
};

const normalizeAgreementBillingTypeValue = (value) => {
  const normalized = normalizeStatus(value);
  if (!normalized) return '';
  if (normalized === 'all') return AgreementBillingType.all;
  if (normalized === 'recurring' || normalized === 'recurringservice') return AgreementBillingType.recurring;
  if (normalized === 'onetime' || normalized === 'oneoff' || normalized === 'oneoffjob') return AgreementBillingType.oneTime;

  return '';
};

const normalizeAgreementBillingTypeFilter = (value, allowedTypes = [], fallbackType = AgreementBillingType.recurring) => {
  const billingType = normalizeAgreementBillingTypeValue(value);
  if (!billingType) return fallbackType;

  if (billingType === AgreementBillingType.all) {
    return allowedTypes.includes(AgreementBillingType.all) || allowedTypes.length > 1
      ? AgreementBillingType.all
      : fallbackType;
  }

  return allowedTypes.includes(AgreementBillingType.all) || allowedTypes.includes(billingType)
    ? billingType
    : fallbackType;
};

const normalizeAgreementFilters = (
  filters = {},
  {
    allowedBillingTypes = [AgreementBillingType.recurring],
    defaultBillingType = AgreementBillingType.recurring,
    routingQueueOnly = false,
  } = {}
) => {
  const sortKey = normalizeAgreementSortKey(filters.sortKey);
  const fallbackBillingType = firstAllowedBillingType(allowedBillingTypes, defaultBillingType);

  return {
    searchTerm: String(filters.searchTerm || '').trim(),
    statusFilter: routingQueueOnly
      ? SalesAgreementStatus.accepted
      : normalizeAgreementStatusFilter(filters.statusFilter),
    billingTypeFilter: routingQueueOnly
      ? AgreementBillingType.recurring
      : normalizeAgreementBillingTypeFilter(filters.billingTypeFilter, allowedBillingTypes, fallbackBillingType),
    sortKey,
    sortDirection: normalizeAgreementSortDirection(filters.sortDirection, sortKey),
  };
};

const agreementFiltersFromParams = (searchParams, options = {}) => normalizeAgreementFilters({
  searchTerm: firstParamValue(searchParams, agreementFilterParamAliases.searchTerm),
  statusFilter: firstParamValue(searchParams, agreementFilterParamAliases.statusFilter),
  billingTypeFilter: firstParamValue(searchParams, agreementFilterParamAliases.billingTypeFilter),
  sortKey: firstParamValue(searchParams, agreementFilterParamAliases.sortKey),
  sortDirection: firstParamValue(searchParams, agreementFilterParamAliases.sortDirection),
}, options);

const agreementFilterParamsFromState = (baseParams, filters, options = {}) => {
  const nextParams = new URLSearchParams(baseParams);
  const normalizedFilters = normalizeAgreementFilters(filters, options);
  const defaultBillingType = firstAllowedBillingType(options.allowedBillingTypes, options.defaultBillingType);

  agreementFilterParamKeys.forEach((key) => nextParams.delete(key));

  if (normalizedFilters.searchTerm) {
    nextParams.set('q', normalizedFilters.searchTerm);
  }

  if (!options.routingQueueOnly && normalizedFilters.statusFilter !== defaultAgreementFilters.statusFilter) {
    nextParams.set('status', normalizedFilters.statusFilter);
  }

  if (!options.routingQueueOnly && normalizedFilters.billingTypeFilter !== defaultBillingType) {
    nextParams.set('type', normalizedFilters.billingTypeFilter);
  }

  if (normalizedFilters.sortKey !== defaultAgreementFilters.sortKey) {
    nextParams.set('sort', normalizedFilters.sortKey);
  }

  if (normalizedFilters.sortDirection !== defaultSortDirectionForKey(normalizedFilters.sortKey)) {
    nextParams.set('direction', normalizedFilters.sortDirection);
  }

  return nextParams;
};

const StatTile = ({ icon: Icon, label, value, helper, selected = false, onClick, disabled = false }) => {
  const isInteractive = typeof onClick === 'function';
  const Component = isInteractive ? 'button' : 'div';
  const tileProps = isInteractive
    ? {
        type: 'button',
        onClick,
        disabled,
        'aria-pressed': selected,
    }
    : {};

  const selectedClasses = selected
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : 'border-slate-200 bg-white text-slate-900';
  const interactiveClasses = isInteractive
    ? 'text-left transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60'
    : '';
  const iconClasses = selected
    ? 'border border-blue-100 bg-white text-blue-700'
    : 'bg-slate-100 text-slate-600';

  return (
    <Component
      {...tileProps}
      className={`w-full rounded-lg border p-4 shadow-sm ${selectedClasses} ${interactiveClasses}`}
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

const AgreementActionMenuItem = ({
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
    green: 'text-emerald-700 hover:bg-emerald-50',
    rose: 'text-rose-700 hover:bg-rose-50',
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
    stripeConnectedAccountId,
  } = useContext(Context);
  const activeUser = currentUser || user || currentuser || {};
  const activeUserId = activeUser?.uid || activeUser?.id || dataBaseUser?.id || '';
  const [agreements, setAgreements] = useState([]);
  const [recurringStops, setRecurringStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatingFromRoutes, setGeneratingFromRoutes] = useState(false);
  const [editingAgreementId, setEditingAgreementId] = useState('');
  const [sendDialogAgreementId, setSendDialogAgreementId] = useState('');
  const [openActionAgreementId, setOpenActionAgreementId] = useState('');
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [actionLoadingKey, setActionLoadingKey] = useState('');

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedBillingTypes = useMemo(() => (
    routingQueueOnly ? [AgreementBillingType.recurring] : normalizeAgreementTypeOptions(agreementTypes)
  ), [agreementTypes, routingQueueOnly]);
  const initialBillingTypeFilter = useMemo(() => (
    firstAllowedBillingType(allowedBillingTypes, defaultAgreementType)
  ), [allowedBillingTypes, defaultAgreementType]);
  const filterOptions = useMemo(() => ({
    allowedBillingTypes,
    defaultBillingType: initialBillingTypeFilter,
    routingQueueOnly,
  }), [allowedBillingTypes, initialBillingTypeFilter, routingQueueOnly]);
  const searchParamsString = searchParams.toString();
  const {
    searchTerm,
    statusFilter,
    billingTypeFilter,
    sortKey,
    sortDirection,
  } = useMemo(() => (
    agreementFiltersFromParams(new URLSearchParams(searchParamsString), filterOptions)
  ), [filterOptions, searchParamsString]);

  useEffect(() => {
    const normalizedParams = agreementFilterParamsFromState(
      new URLSearchParams(searchParamsString),
      {
        searchTerm,
        statusFilter,
        billingTypeFilter,
        sortKey,
        sortDirection,
      },
      filterOptions
    );
    const normalizedParamsString = normalizedParams.toString();

    if (normalizedParamsString !== searchParamsString) {
      setSearchParams(normalizedParams, { replace: true });
    }
  }, [
    billingTypeFilter,
    filterOptions,
    searchParamsString,
    searchTerm,
    setSearchParams,
    sortDirection,
    sortKey,
    statusFilter,
  ]);

  const setAgreementFilters = useCallback((nextFilters = {}) => {
    const nextParams = agreementFilterParamsFromState(
      new URLSearchParams(searchParamsString),
      {
        searchTerm,
        statusFilter,
        billingTypeFilter,
        sortKey,
        sortDirection,
        ...nextFilters,
      },
      filterOptions
    );

    setSearchParams(nextParams, { replace: true });
  }, [
    billingTypeFilter,
    filterOptions,
    searchParamsString,
    searchTerm,
    setSearchParams,
    sortDirection,
    sortKey,
    statusFilter,
  ]);

  const editingAgreement = useMemo(
    () => agreements.find((agreement) => agreement.id === editingAgreementId) || null,
    [agreements, editingAgreementId]
  );
  const openActionAgreement = useMemo(
    () => agreements.find((agreement) => agreement.id === openActionAgreementId) || null,
    [agreements, openActionAgreementId]
  );
  const sendDialogAgreement = useMemo(
    () => agreements.find((agreement) => agreement.id === sendDialogAgreementId) || null,
    [agreements, sendDialogAgreementId]
  );
  const actorName = [
    dataBaseUser?.firstName,
    dataBaseUser?.lastName,
  ].filter(Boolean).join(' ').trim()
    || dataBaseUser?.userName
    || dataBaseUser?.name
    || activeUser?.displayName
    || activeUser?.email
    || 'Company user';

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
    const normalizedSortKey = normalizeAgreementSortKey(nextSortKey);
    setAgreementFilters({
      sortKey: normalizedSortKey,
      sortDirection: defaultSortDirectionForKey(normalizedSortKey),
    });
  };

  const handleHeaderSort = (nextSortKey) => {
    if (sortKey === nextSortKey) {
      setAgreementFilters({
        sortDirection: sortDirection === 'asc' ? 'desc' : 'asc',
      });
      return;
    }

    handleSortKeyChange(nextSortKey);
  };

  const statusTileSelected = (status) => (
    !routingQueueOnly && normalizeStatus(statusFilter) === normalizeStatus(status)
  );

  const handleStatusTileClick = (nextStatus) => {
    if (routingQueueOnly) return;

    setAgreementFilters({
      statusFilter: statusTileSelected(nextStatus) ? 'all' : nextStatus,
    });
  };

  const closeAgreementActions = () => {
    setOpenActionAgreementId('');
    setActionMenuPosition(null);
  };

  const toggleAgreementActions = (agreementId, event) => {
    event.stopPropagation();

    if (openActionAgreementId === agreementId) {
      closeAgreementActions();
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 184;
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
    const left = Math.min(
      Math.max(8, buttonRect.right - menuWidth),
      maxLeft
    );
    const top = Math.min(
      Math.max(8, buttonRect.bottom + 8),
      maxTop
    );

    setOpenActionAgreementId(agreementId);
    setActionMenuPosition({ top, left });
  };

  const syncLinkedJobForAgreementStatus = async (agreement, status) => {
    const linkedJobId = linkedJobIdForAgreement(agreement);
    const companyId = agreement?.companyId || recentlySelectedCompany;
    if (!companyId || !linkedJobId) return;

    try {
      const jobRef = doc(db, 'companies', companyId, 'workOrders', linkedJobId);
      const jobSnap = await getDoc(jobRef);
      if (!jobSnap.exists()) return;

      const jobData = jobSnap.data() || {};
      const statusKey = normalizeStatus(status);
      const timestamp = serverTimestamp();
      const updatePayload = {
        salesAgreementId: agreement.id,
        salesAgreementStatus: status,
        salesAgreementStatusUpdatedAt: timestamp,
        salesAgreementStatusUpdatedByUserId: activeUserId,
        salesAgreementStatusUpdatedByUserName: actorName,
        updatedAt: timestamp,
      };

      if (statusKey === normalizeStatus(SalesAgreementStatus.accepted)) {
        updatePayload.billingStatus = 'Accepted';
        updatePayload.salesAgreementAcceptedAt = timestamp;
        if (!jobData.operationStatus || ['Estimate Pending', 'Unscheduled'].includes(jobData.operationStatus)) {
          updatePayload.operationStatus = 'Unscheduled';
        }
      }

      if (statusKey === normalizeStatus(SalesAgreementStatus.rejected)) {
        updatePayload.billingStatus = 'Rejected';
        updatePayload.salesAgreementRejectedAt = timestamp;
      }

      await updateDoc(jobRef, updatePayload);
    } catch (syncError) {
      console.warn('Unable to sync linked job after agreement status update', syncError);
    }
  };

  const syncLinkedLeadForAgreementStatus = async (agreement, status) => {
    const linkedLeadId = linkedLeadIdForAgreement(agreement);
    if (!linkedLeadId) return;

    try {
      const statusKey = normalizeStatus(status);
      const timestamp = serverTimestamp();
      const updatePayload = {
        serviceAgreementId: agreement.id,
        serviceAgreementTitle: agreement.title || 'Service Agreement',
        serviceAgreementStatus: status,
        updatedAt: timestamp,
      };

      if (statusKey === normalizeStatus(SalesAgreementStatus.accepted)) {
        updatePayload.status = 'Completed';
        updatePayload.leadStatus = 'Completed';
        updatePayload.serviceAgreementAcceptedAt = timestamp;
        updatePayload.dateCompleted = timestamp;
        updatePayload.lostReason = '';
        updatePayload.cancelReason = '';
      }

      if (statusKey === normalizeStatus(SalesAgreementStatus.rejected)) {
        updatePayload.status = 'Cancelled';
        updatePayload.leadStatus = 'Cancelled';
        updatePayload.serviceAgreementRejectedAt = timestamp;
        updatePayload.lostReason = 'Service agreement rejected.';
        updatePayload.cancelReason = 'Service agreement rejected.';
      }

      await updateDoc(doc(db, 'homeownerServiceRequests', linkedLeadId), updatePayload);
    } catch (syncError) {
      console.warn('Unable to sync linked lead after agreement status update', syncError);
    }
  };

  const sendAgreementEmailFromList = async (agreement, { primaryEmail, additionalEmails = [] } = {}) => {
    const disabledReason = agreementSendDisabledReason({
      agreement,
      activeUser,
      selectedCompanyId: recentlySelectedCompany,
    });
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }

    const recipientEmail = String(primaryEmail || agreement?.email || '').trim();
    if (!recipientEmail) {
      toast.error('Add a recipient email before sending.');
      return;
    }

    closeAgreementActions();
    setActionLoadingKey(`${agreement.id}:send`);

    try {
      const sendCallable = httpsCallable(functions, 'sendServiceAgreementEmail');
      const authPayload = await getCallableAuthPayload();
      const result = await sendCallable({
        companyId: agreement.companyId,
        agreementId: agreement.id,
        agreementBaseUrl: window.location.origin,
        includeInspectionReport: agreement.emailDelivery?.includeInspectionReport === true || agreement.includeInspectionReport === true,
        primaryEmail: recipientEmail,
        additionalEmails,
        ...authPayload,
      });

      if (result.data?.testMode) {
        toast.success(`Test email sent to ${result.data.to}. Customer email saved as ${result.data.intendedTo}.`);
      } else if (result.data?.includeInspectionReport && !result.data?.hasInspectionReport) {
        toast.success('Service agreement sent. No linked inspection report was found yet.');
      } else {
        toast.success(result.data?.message || 'Service agreement email sent.');
      }
      setSendDialogAgreementId('');
    } catch (sendError) {
      console.error('Unable to send service agreement email from list', sendError);
      toast.error(sendError.message || 'Failed to send service agreement email.');
    } finally {
      setActionLoadingKey('');
    }
  };

  const markAgreementAcceptedFromList = async (agreement) => {
    const disabledReason = agreementAcceptanceDisabledReason({
      agreement,
      activeUser,
      selectedCompanyId: recentlySelectedCompany,
    });
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }

    closeAgreementActions();
    const confirmed = await appConfirm({
      title: 'Mark Agreement Accepted',
      message: `Mark "${agreement.title || 'Service Agreement'}" accepted and create the billing setup record?`,
      confirmLabel: 'Mark Accepted',
    });
    if (!confirmed) return;

    setActionLoadingKey(`${agreement.id}:accept`);

    try {
      const totalAmountCents = agreementAmountCents(agreement) || agreementSubtotalAmountCents(agreement);
      const billingSubscriptionDraft = await ensureBillingSubscriptionForAgreement(db, agreement, {
        stripeConnectedAccountId,
        agreementUpdates: {
          status: SalesAgreementStatus.accepted,
          acceptedAt: serverTimestamp(),
          acceptedByUserId: activeUserId,
          acceptedByUserName: actorName,
          acceptedByEmail: activeUser?.email || dataBaseUser?.email || '',
          acceptedSource: 'internalManual',
          acceptedNote: '',
          acceptedSnapshot: {
            agreementId: agreement.id,
            title: agreement.title || 'Service Agreement',
            customerName: agreement.customerName || 'Customer',
            customerId: agreement.customerId || '',
            email: agreement.email || '',
            totalAmountCents: String(totalAmountCents || 0),
            serviceCadence: agreement.serviceCadence || '',
            serviceCadenceCount: String(agreement.serviceCadenceCount || 1),
            serviceFrequencyLabel: agreement.serviceFrequencyLabel || '',
            billingFrequency: billingFrequencyForAgreement(agreement),
            billingFrequencyCount: String(agreement.billingFrequencyCount || 1),
            rateType: agreement.rateType || '',
            termsTemplateId: agreement.termsTemplateId || '',
            termsTemplateName: agreement.termsTemplateName || '',
            revisionNumber: String(agreement.revisionNumber || 0),
            previousAgreementId: agreement.previousAgreementId || agreement.supersedesAgreementId || '',
            supersedesAgreementId: agreement.supersedesAgreementId || agreement.previousAgreementId || '',
            agreementHistoryGroupId: agreementHistoryGroupId(agreement),
            agreementVersion: String(agreement.agreementVersion || 1),
          },
          statusChangedAt: serverTimestamp(),
          statusChangedByUserId: activeUserId,
          statusChangedByUserName: actorName,
          statusChangeReason: 'Agreement manually accepted from the service agreement list.',
        },
      });

      await syncLinkedJobForAgreementStatus(agreement, SalesAgreementStatus.accepted);
      await syncLinkedLeadForAgreementStatus(agreement, SalesAgreementStatus.accepted);

      toast.success(billingSubscriptionDraft.customerCanPayImmediately
        ? 'Agreement accepted and billing subscription is ready for payment setup.'
        : 'Agreement accepted and billing subscription was created.');
    } catch (acceptError) {
      console.error('Unable to mark service agreement accepted from list', acceptError);
      toast.error(acceptError.message || 'Failed to mark service agreement accepted.');
    } finally {
      setActionLoadingKey('');
    }
  };

  const markAgreementRejectedFromList = async (agreement) => {
    const disabledReason = agreementRejectionDisabledReason({
      agreement,
      activeUser,
      selectedCompanyId: recentlySelectedCompany,
    });
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }

    closeAgreementActions();
    const confirmed = await appConfirm({
      title: 'Mark Agreement Rejected',
      message: `Mark "${agreement.title || 'Service Agreement'}" rejected? This keeps the agreement in history and removes it from active follow-up.`,
      confirmLabel: 'Mark Rejected',
      variant: 'danger',
    });
    if (!confirmed) return;

    setActionLoadingKey(`${agreement.id}:reject`);

    try {
      const timestamp = serverTimestamp();
      await updateDoc(doc(db, salesCollectionNames.agreements, agreement.id), {
        status: SalesAgreementStatus.rejected,
        rejectedAt: timestamp,
        rejectedByUserId: activeUserId,
        rejectedByUserName: actorName,
        rejectedByEmail: activeUser?.email || dataBaseUser?.email || '',
        statusChangedAt: timestamp,
        statusChangedByUserId: activeUserId,
        statusChangedByUserName: actorName,
        statusChangeReason: 'Agreement marked rejected from the service agreement list.',
        updatedAt: timestamp,
      });

      await syncLinkedJobForAgreementStatus(agreement, SalesAgreementStatus.rejected);
      await syncLinkedLeadForAgreementStatus(agreement, SalesAgreementStatus.rejected);

      toast.success('Agreement marked rejected.');
    } catch (rejectError) {
      console.error('Unable to mark service agreement rejected from list', rejectError);
      toast.error(rejectError.message || 'Failed to mark service agreement rejected.');
    } finally {
      setActionLoadingKey('');
    }
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
        setAgreementFilters({
          searchTerm: '',
          statusFilter: SalesAgreementStatus.draft,
          billingTypeFilter: AgreementBillingType.recurring,
        });
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
                <Link
                  to="/company/sales/agreements/active-customers-without-service-agreements"
                  className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  <FaUserCheck className="text-xs" />
                  Missing Agreements
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
            onClick={!routingQueueOnly ? () => setAgreementFilters({ statusFilter: 'all' }) : undefined}
          />
          {!routingQueueOnly && (
            <StatTile
              icon={FaFileSignature}
              label="Draft"
              value={summary.draftCount}
              helper="Ready to review"
              selected={statusTileSelected(SalesAgreementStatus.draft)}
              onClick={() => handleStatusTileClick(SalesAgreementStatus.draft)}
            />
          )}
          <StatTile
            icon={FaEnvelope}
            label="Sent"
            value={summary.sentCount}
            helper="Waiting on customer"
            selected={statusTileSelected(SalesAgreementStatus.sent)}
            onClick={!routingQueueOnly ? () => handleStatusTileClick(SalesAgreementStatus.sent) : undefined}
          />
          <StatTile
            icon={FaCheckCircle}
            label="Accepted"
            value={summary.acceptedCount}
            helper="Ready for billing"
            selected={statusTileSelected(SalesAgreementStatus.accepted)}
            onClick={!routingQueueOnly ? () => handleStatusTileClick(SalesAgreementStatus.accepted) : undefined}
          />
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
                onChange={(event) => setAgreementFilters({ searchTerm: event.target.value })}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search by customer, agreement, email, status, or template"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setAgreementFilters({ statusFilter: event.target.value })}
              disabled={routingQueueOnly}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All Statuses' : labelize(status)}</option>
              ))}
            </select>
            <select
              value={billingTypeFilter}
              onChange={(event) => setAgreementFilters({ billingTypeFilter: event.target.value })}
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
              onClick={() => setAgreementFilters({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })}
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
                    <th className="px-5 py-3 text-right">Actions</th>
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
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={(event) => toggleAgreementActions(agreement.id, event)}
                          disabled={Boolean(actionLoadingKey && actionLoadingKey.startsWith(`${agreement.id}:`))}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          aria-haspopup="menu"
                          aria-expanded={openActionAgreementId === agreement.id}
                          aria-label={`Actions for ${agreement.title || 'service agreement'}`}
                          title="Actions"
                        >
                          <FaEllipsisV className="text-sm" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {openActionAgreement && actionMenuPosition && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close agreement actions"
            onClick={closeAgreementActions}
          />
          <div
            role="menu"
            style={{
              top: actionMenuPosition.top,
              left: actionMenuPosition.left,
            }}
            className="fixed z-50 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          >
            <AgreementActionMenuItem
              label="Edit"
              icon={FaEdit}
              tone="blue"
              onClick={() => {
                setEditingAgreementId(openActionAgreement.id);
                closeAgreementActions();
              }}
            />
            <AgreementActionMenuItem
              label="Mark as accepted"
              icon={FaUserCheck}
              tone="green"
              loading={actionLoadingKey === `${openActionAgreement.id}:accept`}
              disabled={Boolean(agreementAcceptanceDisabledReason({
                agreement: openActionAgreement,
                activeUser,
                selectedCompanyId: recentlySelectedCompany,
              }))}
              title={agreementAcceptanceDisabledReason({
                agreement: openActionAgreement,
                activeUser,
                selectedCompanyId: recentlySelectedCompany,
              })}
              onClick={() => markAgreementAcceptedFromList(openActionAgreement)}
            />
            <AgreementActionMenuItem
              label="Send email"
              icon={FaEnvelope}
              tone="blue"
              loading={actionLoadingKey === `${openActionAgreement.id}:send`}
              disabled={Boolean(agreementSendDisabledReason({
                agreement: openActionAgreement,
                activeUser,
                selectedCompanyId: recentlySelectedCompany,
              }))}
              title={agreementSendDisabledReason({
                agreement: openActionAgreement,
                activeUser,
                selectedCompanyId: recentlySelectedCompany,
              })}
              onClick={() => {
                setSendDialogAgreementId(openActionAgreement.id);
                closeAgreementActions();
              }}
            />
            <AgreementActionMenuItem
              label="Mark as rejected"
              icon={FaTimesCircle}
              tone="rose"
              loading={actionLoadingKey === `${openActionAgreement.id}:reject`}
              disabled={Boolean(agreementRejectionDisabledReason({
                agreement: openActionAgreement,
                activeUser,
                selectedCompanyId: recentlySelectedCompany,
              }))}
              title={agreementRejectionDisabledReason({
                agreement: openActionAgreement,
                activeUser,
                selectedCompanyId: recentlySelectedCompany,
              })}
              onClick={() => markAgreementRejectedFromList(openActionAgreement)}
            />
          </div>
        </>
      )}

      <SalesAgreementEditorModal
        agreement={editingAgreement}
        open={Boolean(editingAgreement)}
        onClose={() => setEditingAgreementId('')}
        onDeleted={() => setEditingAgreementId('')}
      />

      <ServiceAgreementSendDialog
        agreement={sendDialogAgreement}
        open={Boolean(sendDialogAgreement)}
        sending={Boolean(sendDialogAgreement && actionLoadingKey === `${sendDialogAgreement.id}:send`)}
        includeInspectionReport={sendDialogAgreement?.emailDelivery?.includeInspectionReport === true || sendDialogAgreement?.includeInspectionReport === true}
        hasLinkedInspectionReport={Boolean(
          sendDialogAgreement?.emailDelivery?.inspectionReportUrl ||
          sendDialogAgreement?.inspectionReportUrl ||
          sendDialogAgreement?.serviceAgreementInspectionReportUrl ||
          sendDialogAgreement?.inspectionReport?.url ||
          sendDialogAgreement?.inspectionServiceStopId ||
          sendDialogAgreement?.serviceAgreementEstimateServiceStopId ||
          sendDialogAgreement?.estimateServiceStopId ||
          sendDialogAgreement?.serviceStopId
        )}
        onClose={() => {
          if (!actionLoadingKey) setSendDialogAgreementId('');
        }}
        onConfirm={(sendOptions) => {
          if (sendDialogAgreement) sendAgreementEmailFromList(sendDialogAgreement, sendOptions);
        }}
      />
    </div>
  );
};

export default SalesAgreements;
