import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaCheckCircle,
  FaCopy,
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
import {
  SalesAgreement,
  SalesCatalogBillingBehavior,
  SalesCatalogItem,
  SalesCatalogItemType,
  SalesCatalogSourceType,
  SalesAgreementChemicalBillingMode,
  SalesAgreementPnlChemicalCostMode,
  SalesInvoiceLineItem,
  SalesAgreementStatus,
  SalesAutopayStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import FeatureInfoButton from '../../../components/FeatureInfoButton';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { ensureBillingSubscriptionForAgreement } from '../../../utils/sales/agreementBilling';
import {
  salesCatalogCollection,
  saveSalesCatalogItem,
  saveSalesModel,
} from '../../../utils/sales/salesFirestore';
import { AgreementBillingType, getAgreementBillingType } from '../../../utils/sales/agreementRouting';
import {
  billingFrequencyForAgreement,
  billingFrequencyOptions,
  formatBillingFrequency,
  formatServiceFrequency,
  serviceFrequencyOptions,
} from '../../../utils/sales/agreementCadence';
import { chemicalBillingLabel } from '../../../utils/sales/chemicalBilling';
import { dosageLabel, sortDosageTemplates } from '../../../utils/dosageItemLinks';
import { ContractTerm, getTermDescription } from '../../../utils/models/TermsTemplate';
import {
  deleteContractTerm,
  getTerms,
  listenTermsTemplates,
  saveContractTerm,
  updateTermsTemplate,
} from '../../../utils/terms/termsTemplateFirestore';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';

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

const canDeleteBillingSubscriptionRecord = (subscription = {}) => (
  !subscription?.stripeSubscriptionId ||
  normalizeStatus(subscription.stripeStatus || subscription.status) === 'canceled'
);

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

const nextAgreementStartDate = (agreement = {}) => {
  const endMillis = toMillis(agreement.endDate);
  if (endMillis) {
    const nextDate = new Date(endMillis);
    nextDate.setDate(nextDate.getDate() + 1);
    return nextDate;
  }

  return new Date();
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

const chemicalBillingModeOptions = [
  { value: SalesAgreementChemicalBillingMode.includedAll, label: 'Chemicals Included In Service' },
  { value: SalesAgreementChemicalBillingMode.billAllSeparately, label: 'Bill All Chemicals Separately' },
  { value: SalesAgreementChemicalBillingMode.mixed, label: 'Mixed Chemical Billing' },
];

const ChemicalBillingMixedSelectionMode = Object.freeze({
  separatelyBilled: 'separatelyBilled',
  included: 'included',
});

const mixedChemicalBillingSelectionOptions = [
  {
    value: ChemicalBillingMixedSelectionMode.separatelyBilled,
    label: 'Select dosages excluded and billed separately',
  },
  {
    value: ChemicalBillingMixedSelectionMode.included,
    label: 'Select dosages included in service',
  },
];

const normalizeCommaList = (value) => (
  Array.from(new Set(
    (Array.isArray(value) ? value : String(value || '').split(/[\n,]/))
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ))
);

const inferMixedChemicalBillingSelectionMode = (agreement = {}) => {
  const includedSelections = [
    ...normalizeCommaList(agreement?.includedChemicalIds),
    ...normalizeCommaList(agreement?.includedChemicalKeywords),
  ];
  const separatelyBilledSelections = [
    ...normalizeCommaList(agreement?.separatelyBilledChemicalIds),
    ...normalizeCommaList(agreement?.separatelyBilledChemicalKeywords),
  ];

  if (includedSelections.length > 0 && separatelyBilledSelections.length === 0) {
    return ChemicalBillingMixedSelectionMode.included;
  }

  return ChemicalBillingMixedSelectionMode.separatelyBilled;
};

const dosageTemplateKeys = (template = {}) => (
  [
    template.id,
    template.templateId,
    template.dosageTemplateId,
    template.universalTemplateId,
  ].map((value) => String(value || '').trim()).filter(Boolean)
);

const ChemicalDosagePicker = ({
  id,
  label,
  selectedIds = [],
  dosageTemplates = [],
  loading = false,
  onChange,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSelectedIds = normalizeCommaList(selectedIds);
  const selectedSet = new Set(normalizedSelectedIds);
  const templateById = new Map();

  dosageTemplates.forEach((template) => {
    dosageTemplateKeys(template).forEach((key) => templateById.set(key, template));
  });

  const filteredTemplates = dosageTemplates.filter((template) => (
    dosageLabel(template).toLowerCase().includes(searchTerm.trim().toLowerCase())
  ));

  const toggleSelection = (dosageId) => {
    const nextIds = selectedSet.has(dosageId)
      ? normalizedSelectedIds.filter((currentId) => currentId !== dosageId)
      : [...normalizedSelectedIds, dosageId];

    onChange(nextIds);
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="text-sm font-semibold text-slate-700" htmlFor={id}>
          {label}
        </label>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {normalizedSelectedIds.length} selected
        </span>
      </div>

      {normalizedSelectedIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {normalizedSelectedIds.map((dosageId) => {
            const template = templateById.get(dosageId);
            return (
              <span
                key={dosageId}
                className="inline-flex max-w-full items-center gap-2 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800"
              >
                <span className="truncate">{template ? dosageLabel(template) : dosageId}</span>
                <button
                  type="button"
                  onClick={() => toggleSelection(dosageId)}
                  className="text-blue-500 transition hover:text-rose-600"
                  aria-label={`Remove ${template ? dosageLabel(template) : dosageId}`}
                >
                  <FaTimes className="text-[10px]" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <input
        id={id}
        type="search"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        placeholder="Search dosage templates"
      />

      <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-slate-50">
        {loading ? (
          <div className="p-3 text-sm text-slate-500">Loading dosage templates...</div>
        ) : filteredTemplates.length ? (
          filteredTemplates.map((template) => {
            const dosageId = dosageTemplateKeys(template)[0];
            if (!dosageId) return null;

            return (
              <label
                key={dosageId}
                className="flex cursor-pointer items-start gap-3 border-b border-slate-200 px-3 py-2 text-sm last:border-b-0 hover:bg-blue-50"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(dosageId)}
                  onChange={() => toggleSelection(dosageId)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{dosageLabel(template)}</span>
                  {template.chemType && (
                    <span className="block truncate text-xs text-slate-500">{template.chemType}</span>
                  )}
                </span>
              </label>
            );
          })
        ) : (
          <div className="p-3 text-sm text-slate-500">
            No dosage templates found.
          </div>
        )}
      </div>
    </div>
  );
};

const termDescription = (term) => {
  if (typeof term === 'string') return term;
  return getTermDescription(term);
};

const termLineId = () => `term_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const normalizeAgreementTerms = (terms = []) => {
  if (!Array.isArray(terms)) return [];

  return terms
    .map((term, index) => ({
      id: typeof term === 'object' && term?.id ? term.id : `agreement_term_${index}`,
      description: termDescription(term),
    }))
    .filter((term) => term.description.trim());
};

const termsToStrings = (terms = []) => (
  normalizeAgreementTerms(terms)
    .map((term) => term.description.trim())
    .filter(Boolean)
);

const numberedTermsText = (terms = []) => (
  terms
    .map((term) => String(term || '').trim())
    .filter(Boolean)
    .map((term, index) => `${index + 1}. ${term}`)
    .join('\n')
);

const stripNumberedTermsFromContent = (content = '', terms = []) => {
  const text = String(content || '').trim();
  const numberedTerms = numberedTermsText(terms).trim();

  if (!text || !numberedTerms || !text.includes(numberedTerms)) return text;

  return text.replace(numberedTerms, '').trim();
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
  billingFrequency: billingFrequencyForAgreement(agreement),
  billingFrequencyCount: String(agreement?.billingFrequencyCount || agreement?.billingCadenceCount || agreement?.invoiceFrequencyCount || 1),
  rateType: agreement?.rateType || 'perMonth',
  paymentTerms: agreement?.paymentTerms || 'dueOnReceipt',
  pnlIncludeInReports: agreement?.pnlIncludeInReports !== false,
  pnlChemicalCostMode: agreement?.pnlChemicalCostMode || SalesAgreementPnlChemicalCostMode.includeAll,
  pnlExcludedChemicalKeywords: normalizeCommaList(agreement?.pnlExcludedChemicalKeywords),
  pnlExcludedChemicalIds: normalizeCommaList(agreement?.pnlExcludedChemicalIds),
  pnlExcludeCustomerPurchasedChemicals: agreement?.pnlExcludeCustomerPurchasedChemicals !== false,
  chemicalBillingMode: agreement?.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll,
  includedChemicalKeywords: normalizeCommaList(agreement?.includedChemicalKeywords),
  includedChemicalIds: normalizeCommaList(agreement?.includedChemicalIds),
  separatelyBilledChemicalKeywords: normalizeCommaList(agreement?.separatelyBilledChemicalKeywords),
  separatelyBilledChemicalIds: normalizeCommaList(agreement?.separatelyBilledChemicalIds),
  customerPurchasedChemicalKeywords: normalizeCommaList(agreement?.customerPurchasedChemicalKeywords),
  customerPurchasedChemicalIds: normalizeCommaList(agreement?.customerPurchasedChemicalIds),
  chemicalBillingMixedSelectionMode: agreement?.chemicalBillingMixedSelectionMode || inferMixedChemicalBillingSelectionMode(agreement),
  chemicalBillingNotes: agreement?.chemicalBillingNotes || '',
  terms: agreement?.terms || '',
  termsTemplateId: agreement?.termsTemplateId || '',
  termsTemplateName: agreement?.termsTemplateName || '',
  termsTemplateDescription: agreement?.termsTemplateDescription || '',
  termsList: normalizeAgreementTerms(agreement?.termsList),
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

const initialCatalogItemDraft = {
  name: '',
  description: '',
  type: SalesCatalogItemType.recurringService,
  billingBehavior: SalesCatalogBillingBehavior.recurring,
  unitAmount: '',
  unitCost: '',
  defaultQuantity: '1',
  taxable: false,
};

const acceptanceSourceLabel = (source) => {
  if (source === 'internalManual') return 'Internal manual acceptance';
  if (source === 'customerOffline') return 'Customer told us offline';
  if (source === 'customerPortal') return 'Customer portal';
  return labelize(source || 'Not accepted');
};

const linkedInspectionServiceStopIdForAgreement = (agreement = {}) => {
  if (agreement.inspectionServiceStopId) return agreement.inspectionServiceStopId;
  if (agreement.serviceAgreementEstimateServiceStopId) return agreement.serviceAgreementEstimateServiceStopId;
  if (agreement.estimateServiceStopId) return agreement.estimateServiceStopId;
  if (agreement.serviceStopId) return agreement.serviceStopId;
  if (Array.isArray(agreement.serviceStopIds) && agreement.serviceStopIds.length) return agreement.serviceStopIds[0];
  return '';
};

const SalesAgreementDetail = () => {
  const { agreementId } = useParams();
  const navigate = useNavigate();
  const { dataBaseUser, recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId, user } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const [agreement, setAgreement] = useState(null);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [includeInspectionReport, setIncludeInspectionReport] = useState(false);
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
  const [creatingRenewal, setCreatingRenewal] = useState(false);
  const [startingStripeCheckout, setStartingStripeCheckout] = useState(false);
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [loadingTermsTemplates, setLoadingTermsTemplates] = useState(false);
  const [applyingTermsTemplate, setApplyingTermsTemplate] = useState(false);
  const [updatingTermsTemplate, setUpdatingTermsTemplate] = useState(false);
  const [dosageTemplates, setDosageTemplates] = useState([]);
  const [loadingDosageTemplates, setLoadingDosageTemplates] = useState(false);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loadingCatalogItems, setLoadingCatalogItems] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [selectedCatalogQuantity, setSelectedCatalogQuantity] = useState('1');
  const [showCatalogItemSelector, setShowCatalogItemSelector] = useState(false);
  const [showCreateCatalogItem, setShowCreateCatalogItem] = useState(false);
  const [catalogItemDraft, setCatalogItemDraft] = useState(initialCatalogItemDraft);
  const [savingCatalogItem, setSavingCatalogItem] = useState(false);

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
    if (!agreement?.id) return;
    setIncludeInspectionReport(Boolean(agreement.emailDelivery?.includeInspectionReport));
  }, [agreement?.emailDelivery?.includeInspectionReport, agreement?.id]);

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

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTermsTemplates([]);
      setLoadingTermsTemplates(false);
      return undefined;
    }

    setLoadingTermsTemplates(true);

    return listenTermsTemplates(
      recentlySelectedCompany,
      (templates) => {
        setTermsTemplates(templates);
        setLoadingTermsTemplates(false);
      },
      (templateError) => {
        console.error('Unable to load terms templates for agreement editor', templateError);
        toast.error('Failed to load terms templates.');
        setTermsTemplates([]);
        setLoadingTermsTemplates(false);
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCatalogItems([]);
      setSelectedCatalogItemId('');
      setLoadingCatalogItems(false);
      return undefined;
    }

    setLoadingCatalogItems(true);

    return onSnapshot(
      salesCatalogCollection(db, recentlySelectedCompany),
      (snapshot) => {
        const items = snapshot.docs
          .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
          .filter((item) => item.active !== false)
          .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));

        setCatalogItems(items);
        setSelectedCatalogItemId((current) => (
          current && items.some((item) => item.id === current)
            ? current
            : items[0]?.id || ''
        ));
        setLoadingCatalogItems(false);
      },
      (catalogError) => {
        console.error('Unable to load sales catalog for agreement editor', catalogError);
        toast.error('Failed to load sales catalog items.');
        setCatalogItems([]);
        setSelectedCatalogItemId('');
        setLoadingCatalogItems(false);
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setDosageTemplates([]);
      setLoadingDosageTemplates(false);
      return undefined;
    }

    setLoadingDosageTemplates(true);

    return onSnapshot(
      collection(db, 'companies', recentlySelectedCompany, 'settings', 'dosages', 'dosages'),
      (snapshot) => {
        const templates = snapshot.docs.map((templateDoc) => ({
          id: templateDoc.id,
          ...templateDoc.data(),
        }));
        setDosageTemplates(sortDosageTemplates(templates));
        setLoadingDosageTemplates(false);
      },
      (dosageError) => {
        console.error('Unable to load dosage templates for agreement editor', dosageError);
        toast.error('Failed to load dosage templates.');
        setDosageTemplates([]);
        setLoadingDosageTemplates(false);
      }
    );
  }, [recentlySelectedCompany]);

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
  const agreementTermsList = useMemo(
    () => termsToStrings(agreement?.termsList),
    [agreement?.termsList]
  );
  const agreementTermsIntro = useMemo(
    () => stripNumberedTermsFromContent(agreement?.terms, agreementTermsList),
    [agreement?.terms, agreementTermsList]
  );
  const hasTerms = Boolean(agreementTermsIntro || agreementTermsList.length);
  const subtotalAmountCents = agreement?.subtotalAmountCents ?? lineItems.reduce(
    (total, item) => total + (Number(item.totalAmountCents) || 0),
    0
  );
  const totalAmountCents = agreement?.totalAmountCents ?? agreement?.rateAmountCents ?? subtotalAmountCents;
  const emailDelivery = agreement?.emailDelivery || {};
  const linkedInspectionServiceStopId = linkedInspectionServiceStopIdForAgreement(agreement || {});
  const inspectionReportUrl = (
    emailDelivery.inspectionReportUrl ||
    agreement?.inspectionReportUrl ||
    agreement?.serviceAgreementInspectionReportUrl ||
    agreement?.inspectionReport?.url ||
    ''
  );
  const inspectionReportLink = inspectionReportUrl || (
    linkedInspectionServiceStopId ? `/company/serviceStops/detail/${linkedInspectionServiceStopId}` : ''
  );
  const hasLinkedInspectionReport = Boolean(inspectionReportLink);
  const emailTestMode = emailDelivery.testMode === true || emailDelivery.testMode === 'true';
  const currentStatusKey = normalizeStatus(agreement?.status);
  const isAccepted = currentStatusKey === normalizeStatus(SalesAgreementStatus.accepted);
  const hasAcceptanceAudit = Boolean(agreement?.acceptedAt || agreement?.acceptedByUserName || agreement?.acceptedSource);
  const acceptanceIsCurrent = isAccepted && hasAcceptanceAudit;
  const supersedesAgreementId = renewalPreviousAgreementId(agreement || {});
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
  const selectedEditTermsTemplate = useMemo(
    () => termsTemplates.find((template) => template.id === editDraft?.termsTemplateId) || null,
    [editDraft?.termsTemplateId, termsTemplates]
  );
  const selectedEditCatalogItem = useMemo(
    () => catalogItems.find((item) => item.id === selectedCatalogItemId) || null,
    [catalogItems, selectedCatalogItemId]
  );
  const dosageTemplateById = useMemo(() => {
    const nextMap = new Map();
    dosageTemplates.forEach((template) => {
      dosageTemplateKeys(template).forEach((key) => nextMap.set(key, template));
    });
    return nextMap;
  }, [dosageTemplates]);
  const chemicalSelectionDisplay = (ids = [], keywords = []) => {
    const labels = normalizeCommaList(ids).map((chemicalId) => {
      const template = dosageTemplateById.get(chemicalId);
      return template ? dosageLabel(template) : chemicalId;
    });
    return [...labels, ...normalizeCommaList(keywords)].join(', ');
  };
  const separatelyBilledChemicalDisplay = chemicalSelectionDisplay(
    agreement?.separatelyBilledChemicalIds,
    agreement?.separatelyBilledChemicalKeywords
  );
  const includedChemicalDisplay = chemicalSelectionDisplay(
    agreement?.includedChemicalIds,
    agreement?.includedChemicalKeywords
  );
  const customerPurchasedChemicalDisplay = chemicalSelectionDisplay(
    agreement?.customerPurchasedChemicalIds,
    agreement?.customerPurchasedChemicalKeywords
  );

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
    !['canceled', 'rejected', 'expired', 'superseded'].includes(normalizeStatus(agreement.status))
  );
  const sendEmailDisabledReasons = [];

  if (!agreement) {
    sendEmailDisabledReasons.push('Agreement is still loading.');
  }
  if (agreement && !user) {
    sendEmailDisabledReasons.push('You must be signed in to send this agreement.');
  }
  if (companyMismatch) {
    sendEmailDisabledReasons.push('Select the company that owns this agreement.');
  }
  if (editing) {
    sendEmailDisabledReasons.push('Save or cancel edit mode before sending.');
  }
  readinessItems
    .filter((item) => !item.ready)
    .forEach((item) => sendEmailDisabledReasons.push(`${item.title}: ${item.helper}`));
  if (sending) {
    sendEmailDisabledReasons.push('Email send is already in progress.');
  }
  if (currentStatusKey === normalizeStatus(SalesAgreementStatus.accepted)) {
    sendEmailDisabledReasons.push('Accepted agreements cannot be sent again from this button.');
  }
  if (['canceled', 'rejected', 'expired', 'superseded'].includes(currentStatusKey)) {
    sendEmailDisabledReasons.push(`Agreement status is ${labelize(agreement?.status || currentStatusKey)}.`);
  }

  const sendEmailButtonTitle = canSend
    ? 'Send service agreement email'
    : `Send Email is disabled:\n${sendEmailDisabledReasons.join('\n') || 'No send reason is available.'}`;
  const canMarkAccepted = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    !markingAccepted &&
    currentStatusKey !== normalizeStatus(SalesAgreementStatus.accepted) &&
    !['canceled', 'rejected', 'expired', 'superseded'].includes(currentStatusKey)
  );
  const canCreateRenewal = Boolean(
    agreement &&
    user &&
    !companyMismatch &&
    !creatingRenewal
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
  const recurringRouteId = agreement?.recurringRouteId
    || billingSubscription?.recurringRouteId
    || billingSubscription?.agreementSnapshot?.recurringRouteId
    || '';
  const recurringRouteName = agreement?.recurringRouteName
    || billingSubscription?.recurringRouteName
    || billingSubscription?.agreementSnapshot?.recurringRouteName
    || '';
  const recurringSetupStatus = agreement?.operationsSetupStatus
    || billingSubscription?.operationsSetupStatus
    || billingSubscription?.agreementSnapshot?.operationsSetupStatus
    || 'needsRecurringServiceStop';
  const hasRecurringRouteSetup = Boolean(
    recurringServiceStopId ||
    recurringRouteId
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

  const createRenewalAgreement = async () => {
    if (!canCreateRenewal) return;

    setCreatingRenewal(true);

    try {
      const historyGroupId = agreementHistoryGroupId(agreement);
      const siblingSnap = await getDocs(query(
        collection(db, salesCollectionNames.agreements),
        where('agreementHistoryGroupId', '==', historyGroupId)
      ));
      const maxSiblingVersion = siblingSnap.docs.reduce((maxVersion, siblingDoc) => {
        const sibling = siblingDoc.data() || {};
        return Math.max(maxVersion, Number(sibling.agreementVersion || 1));
      }, Number(agreement.agreementVersion || 1));
      const nextVersion = maxSiblingVersion + 1;
      const baseTitle = agreement.title || `${agreement.customerName || 'Customer'} Service Agreement`;
      const renewal = new SalesAgreement({
        companyId: agreement.companyId || recentlySelectedCompany,
        companyName: agreement.companyName || recentlySelectedCompanyName || '',
        customerId: agreement.customerId || '',
        customerUserId: agreement.customerUserId || null,
        relationshipId: agreement.relationshipId || agreement.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: agreement.customerCompanyRelationshipId || agreement.relationshipId || '',
        customerName: agreement.customerName || '',
        email: agreement.email || '',
        serviceLocationIds: Array.isArray(agreement.serviceLocationIds) ? agreement.serviceLocationIds : [],
        serviceLocationSnapshots: Array.isArray(agreement.serviceLocationSnapshots)
          ? agreement.serviceLocationSnapshots.map((location) => ({ ...location }))
          : [],
        sourceType: agreement.sourceType || '',
        sourceId: agreement.sourceId || '',
        previousAgreementId: agreement.id,
        supersedesAgreementId: agreement.id,
        agreementHistoryGroupId: historyGroupId,
        agreementVersion: nextVersion,
        renewalSourceAgreementId: agreement.id,
        recurringServiceStopId: agreement.recurringServiceStopId || '',
        recurringRouteId: agreement.recurringRouteId || '',
        recurringRouteName: agreement.recurringRouteName || '',
        operationsSetupStatus: agreement.operationsSetupStatus || '',
        operationsSetupReason: agreement.operationsSetupReason || '',
        title: `${baseTitle} Renewal`,
        description: [
          agreement.description || '',
          `Renewal draft created from ${baseTitle}.`,
        ].filter(Boolean).join('\n\n'),
        terms: agreement.terms || '',
        termsTemplateId: agreement.termsTemplateId || '',
        termsTemplateName: agreement.termsTemplateName || '',
        termsTemplateDescription: agreement.termsTemplateDescription || '',
        termsList: Array.isArray(agreement.termsList) ? [...agreement.termsList] : [],
        lineItems: Array.isArray(agreement.lineItems)
          ? agreement.lineItems.map((item) => ({ ...item }))
          : [],
        status: SalesAgreementStatus.draft,
        billingCollectionMethod: agreement.billingCollectionMethod,
        autopayStatus: SalesAutopayStatus.unavailable,
        manualBillingEnabled: true,
        customerCanPayImmediately: false,
        rateAmountCents: Number(agreement.rateAmountCents || 0),
        subtotalAmountCents: Number(agreement.subtotalAmountCents || 0),
        taxAmountCents: Number(agreement.taxAmountCents || 0),
        totalAmountCents: Number(agreement.totalAmountCents || agreement.rateAmountCents || 0),
        rateType: agreement.rateType || 'perMonth',
        serviceCadence: agreement.serviceCadence || '',
        serviceCadenceCount: Math.max(Number(agreement.serviceCadenceCount || 1), 1),
        serviceDaysOfWeek: Array.isArray(agreement.serviceDaysOfWeek) ? [...agreement.serviceDaysOfWeek] : [],
        serviceFrequencyLabel: agreement.serviceFrequencyLabel || '',
        billingFrequency: billingFrequencyForAgreement(agreement),
        billingFrequencyCount: Math.max(Number(agreement.billingFrequencyCount || 1), 1),
        paymentTerms: agreement.paymentTerms || 'dueOnReceipt',
        invoiceDeliveryMethod: agreement.invoiceDeliveryMethod,
        receiptDeliveryMethod: agreement.receiptDeliveryMethod || agreement.invoiceDeliveryMethod,
        receiptsEnabled: agreement.receiptsEnabled !== false,
        pnlIncludeInReports: agreement.pnlIncludeInReports !== false,
        pnlChemicalCostMode: agreement.pnlChemicalCostMode || SalesAgreementPnlChemicalCostMode.includeAll,
        pnlExcludedChemicalKeywords: Array.isArray(agreement.pnlExcludedChemicalKeywords) ? [...agreement.pnlExcludedChemicalKeywords] : normalizeCommaList(agreement.pnlExcludedChemicalKeywords),
        pnlExcludedChemicalIds: Array.isArray(agreement.pnlExcludedChemicalIds) ? [...agreement.pnlExcludedChemicalIds] : normalizeCommaList(agreement.pnlExcludedChemicalIds),
        pnlExcludeCustomerPurchasedChemicals: agreement.pnlExcludeCustomerPurchasedChemicals !== false,
        chemicalBillingMode: agreement.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll,
        includedChemicalKeywords: Array.isArray(agreement.includedChemicalKeywords) ? [...agreement.includedChemicalKeywords] : normalizeCommaList(agreement.includedChemicalKeywords),
        includedChemicalIds: Array.isArray(agreement.includedChemicalIds) ? [...agreement.includedChemicalIds] : normalizeCommaList(agreement.includedChemicalIds),
        separatelyBilledChemicalKeywords: Array.isArray(agreement.separatelyBilledChemicalKeywords) ? [...agreement.separatelyBilledChemicalKeywords] : normalizeCommaList(agreement.separatelyBilledChemicalKeywords),
        separatelyBilledChemicalIds: Array.isArray(agreement.separatelyBilledChemicalIds) ? [...agreement.separatelyBilledChemicalIds] : normalizeCommaList(agreement.separatelyBilledChemicalIds),
        customerPurchasedChemicalKeywords: Array.isArray(agreement.customerPurchasedChemicalKeywords) ? [...agreement.customerPurchasedChemicalKeywords] : normalizeCommaList(agreement.customerPurchasedChemicalKeywords),
        customerPurchasedChemicalIds: Array.isArray(agreement.customerPurchasedChemicalIds) ? [...agreement.customerPurchasedChemicalIds] : normalizeCommaList(agreement.customerPurchasedChemicalIds),
        chemicalBillingNotes: agreement.chemicalBillingNotes || '',
        includedServices: Array.isArray(agreement.includedServices) ? [...agreement.includedServices] : [],
        excludedServices: Array.isArray(agreement.excludedServices) ? [...agreement.excludedServices] : [],
        startDate: nextAgreementStartDate(agreement),
        endDate: null,
        expiresAt: null,
        atWill: agreement.atWill,
        createdByUserId: user?.uid || dataBaseUser?.id || '',
        emailDelivery: {},
      });

      await saveSalesModel(db, 'agreements', renewal);
      toast.success('Renewal agreement draft created.');
      navigate(`/company/sales/agreements/${renewal.id}`);
    } catch (renewalError) {
      console.error('Unable to create renewal agreement', renewalError);
      toast.error(renewalError.message || 'Failed to create renewal agreement.');
    } finally {
      setCreatingRenewal(false);
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
        includeInspectionReport,
        ...authPayload,
      });

      if (result.data?.testMode) {
        toast.success(`Test email sent to ${result.data.to}. Customer email saved as ${result.data.intendedTo}.`);
      } else if (includeInspectionReport && !result.data?.hasInspectionReport) {
        toast.success('Service agreement sent. No linked inspection report was found yet.');
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
    setApplyingTermsTemplate(false);
    setUpdatingTermsTemplate(false);
    setShowCatalogItemSelector(false);
    setShowCreateCatalogItem(false);
    setCatalogItemDraft(initialCatalogItemDraft);
  };

  const updateEditField = (field, value) => {
    setEditDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateChemicalBillingMode = (value) => {
    setEditDraft((current) => {
      if (!current) return current;

      const mixedSelectionMode = current.chemicalBillingMixedSelectionMode
        || ChemicalBillingMixedSelectionMode.separatelyBilled;
      const isMixed = value === SalesAgreementChemicalBillingMode.mixed;
      const keepIncludedSelections = isMixed
        && mixedSelectionMode === ChemicalBillingMixedSelectionMode.included;
      const keepSeparatelyBilledSelections = isMixed
        && mixedSelectionMode === ChemicalBillingMixedSelectionMode.separatelyBilled;

      return {
        ...current,
        chemicalBillingMode: value,
        includedChemicalKeywords: keepIncludedSelections ? current.includedChemicalKeywords : [],
        includedChemicalIds: keepIncludedSelections ? current.includedChemicalIds : [],
        separatelyBilledChemicalKeywords: keepSeparatelyBilledSelections ? current.separatelyBilledChemicalKeywords : [],
        separatelyBilledChemicalIds: keepSeparatelyBilledSelections ? current.separatelyBilledChemicalIds : [],
        customerPurchasedChemicalKeywords: [],
        customerPurchasedChemicalIds: [],
      };
    });
  };

  const updateChemicalBillingMixedSelectionMode = (value) => {
    setEditDraft((current) => {
      if (!current) return current;

      return {
        ...current,
        chemicalBillingMixedSelectionMode: value,
        includedChemicalKeywords: value === ChemicalBillingMixedSelectionMode.included
          ? current.includedChemicalKeywords
          : [],
        includedChemicalIds: value === ChemicalBillingMixedSelectionMode.included
          ? current.includedChemicalIds
          : [],
        separatelyBilledChemicalKeywords: value === ChemicalBillingMixedSelectionMode.separatelyBilled
          ? current.separatelyBilledChemicalKeywords
          : [],
        separatelyBilledChemicalIds: value === ChemicalBillingMixedSelectionMode.separatelyBilled
          ? current.separatelyBilledChemicalIds
          : [],
        customerPurchasedChemicalKeywords: [],
        customerPurchasedChemicalIds: [],
      };
    });
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

  const catalogLineItemDraft = (catalogItem, quantityValue) => {
    const quantity = Math.max(Number(quantityValue || catalogItem.defaultQuantity || 1), 0);
    const unitAmountCents = Number(catalogItem.unitAmountCents || 0);
    const lineItem = new SalesInvoiceLineItem({
      catalogItemId: catalogItem.id,
      sourceType: catalogItem.sourceType || '',
      sourceId: catalogItem.sourceId || '',
      name: catalogItem.name || '',
      description: catalogItem.description || '',
      quantity,
      unitAmountCents,
      totalAmountCents: Math.round(unitAmountCents * quantity),
      taxable: Boolean(catalogItem.taxable),
      type: catalogItem.type || '',
      stripeProductId: catalogItem.stripeProductId || '',
      stripePriceId: catalogItem.stripePriceId || '',
      metadata: {
        billingBehavior: catalogItem.billingBehavior || SalesCatalogBillingBehavior.oneTime,
        currency: catalogItem.currency || 'usd',
      },
    });

    return {
      id: lineItem.id,
      catalogItemId: lineItem.catalogItemId,
      sourceType: lineItem.sourceType,
      sourceId: lineItem.sourceId,
      name: lineItem.name,
      description: lineItem.description,
      quantity: String(lineItem.quantity || 1),
      unitAmount: centsToInput(lineItem.unitAmountCents),
      taxable: lineItem.taxable,
      type: lineItem.type,
      stripeProductId: lineItem.stripeProductId,
      stripePriceId: lineItem.stripePriceId,
      metadata: lineItem.metadata,
    };
  };

  const addCatalogLineItem = (catalogItem = selectedEditCatalogItem, quantityValue = selectedCatalogQuantity) => {
    if (!catalogItem) {
      toast.error('Select a catalog item first.');
      return;
    }

    const quantity = Math.max(Number(quantityValue || catalogItem.defaultQuantity || 1), 0);
    if (!quantity) {
      toast.error('Quantity must be greater than zero.');
      return;
    }

    setEditDraft((current) => ({
      ...current,
      lineItems: [
        ...(current.lineItems || []),
        catalogLineItemDraft(catalogItem, quantity),
      ],
    }));
    setSelectedCatalogQuantity(String(catalogItem.defaultQuantity || 1));
  };

  const updateCatalogItemDraftField = (field, value) => {
    setCatalogItemDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const resetCatalogItemDraft = () => {
    setCatalogItemDraft(initialCatalogItemDraft);
    setShowCreateCatalogItem(false);
  };

  const createCatalogItemFromAgreement = async () => {
    if (!recentlySelectedCompany || savingCatalogItem) return;

    if (!catalogItemDraft.name.trim()) {
      toast.error('Catalog item name is required.');
      return;
    }

    setSavingCatalogItem(true);

    try {
      const catalogItem = new SalesCatalogItem({
        companyId: recentlySelectedCompany,
        name: catalogItemDraft.name.trim(),
        description: catalogItemDraft.description.trim(),
        type: catalogItemDraft.type,
        billingBehavior: catalogItemDraft.billingBehavior,
        sourceType: SalesCatalogSourceType.manual,
        sourceId: '',
        unitAmountCents: moneyInputToCents(catalogItemDraft.unitAmount),
        unitCostCents: moneyInputToCents(catalogItemDraft.unitCost),
        defaultQuantity: Math.max(Number(catalogItemDraft.defaultQuantity || 1), 1),
        taxable: Boolean(catalogItemDraft.taxable),
        active: true,
        currency: 'usd',
        stripeConnectedAccountId,
      });

      await saveSalesCatalogItem(db, recentlySelectedCompany, catalogItem);
      setCatalogItems((current) => (
        current.some((item) => item.id === catalogItem.id)
          ? current
          : [...current, catalogItem].sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
      ));
      setSelectedCatalogItemId(catalogItem.id);
      addCatalogLineItem(catalogItem, catalogItem.defaultQuantity);
      resetCatalogItemDraft();
      toast.success('Catalog item created and added to this agreement.');
    } catch (catalogError) {
      console.error('Unable to create sales catalog item from agreement', catalogError);
      toast.error(catalogError.message || 'Failed to create catalog item.');
    } finally {
      setSavingCatalogItem(false);
    }
  };

  const applyTermsTemplate = async (templateId) => {
    if (!editDraft || applyingTermsTemplate) return;

    const template = termsTemplates.find((item) => item.id === templateId) || null;

    if (!templateId) {
      setEditDraft((current) => ({
        ...current,
        termsTemplateId: '',
        termsTemplateName: '',
        termsTemplateDescription: '',
        terms: '',
      }));
      return;
    }

    if (!template || !recentlySelectedCompany) {
      toast.error('Select a saved terms template.');
      return;
    }

    setApplyingTermsTemplate(true);

    try {
      const templateTerms = await getTerms(recentlySelectedCompany, template.id);
      setEditDraft((current) => ({
        ...current,
        termsTemplateId: template.id,
        termsTemplateName: template.name || '',
        termsTemplateDescription: template.description || '',
        terms: template.content || '',
        termsList: normalizeAgreementTerms(templateTerms),
      }));
    } catch (templateError) {
      console.error('Unable to apply terms template', templateError);
      toast.error('Failed to apply terms template.');
    } finally {
      setApplyingTermsTemplate(false);
    }
  };

  const updateEditTermLine = (termId, value) => {
    setEditDraft((current) => ({
      ...current,
      termsList: (current.termsList || []).map((term) => (
        term.id === termId ? { ...term, description: value } : term
      )),
    }));
  };

  const addEditTermLine = () => {
    setEditDraft((current) => ({
      ...current,
      termsList: [
        ...(current.termsList || []),
        { id: termLineId(), description: '' },
      ],
    }));
  };

  const removeEditTermLine = (termId) => {
    setEditDraft((current) => ({
      ...current,
      termsList: (current.termsList || []).filter((term) => term.id !== termId),
    }));
  };

  const updateSourceTermsTemplate = async () => {
    if (!editDraft?.termsTemplateId || !recentlySelectedCompany || updatingTermsTemplate) return;
    if (!requirePermission("884", "update terms templates")) return;

    const templateName = editDraft.termsTemplateName || selectedEditTermsTemplate?.name || 'selected template';
    const confirmed = window.confirm(
      `Update "${templateName}" with the current default content and terms lines from this agreement?`
    );
    if (!confirmed) return;

    const nextTermsList = (editDraft.termsList || [])
      .map((term) => ({
        id: term.id || termLineId(),
        description: String(term.description || '').trim(),
      }))
      .filter((term) => term.description);

    setUpdatingTermsTemplate(true);

    try {
      const existingTerms = await getTerms(recentlySelectedCompany, editDraft.termsTemplateId);
      const nextTermIds = new Set(nextTermsList.map((term) => term.id));
      const removedTerms = existingTerms.filter((term) => !nextTermIds.has(term.id));

      await updateTermsTemplate(recentlySelectedCompany, editDraft.termsTemplateId, {
        content: editDraft.terms.trim(),
      });
      await Promise.all([
        ...nextTermsList.map((term) => saveContractTerm(
          recentlySelectedCompany,
          editDraft.termsTemplateId,
          new ContractTerm(term)
        )),
        ...removedTerms.map((term) => deleteContractTerm(
          recentlySelectedCompany,
          editDraft.termsTemplateId,
          term.id
        )),
      ]);

      toast.success('Terms template updated from this agreement.');
    } catch (templateError) {
      console.error('Unable to update source terms template', templateError);
      toast.error(templateError.message || 'Failed to update terms template.');
    } finally {
      setUpdatingTermsTemplate(false);
    }
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
    const nextTermsList = (editDraft.termsList || [])
      .map((term) => String(term.description || '').trim())
      .filter(Boolean);

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
      const selectedChemicalBillingMode = editDraft.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll;
      const selectedMixedChemicalBillingMode = editDraft.chemicalBillingMixedSelectionMode
        || ChemicalBillingMixedSelectionMode.separatelyBilled;
      const shouldPersistIncludedChemicalSelections = selectedChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
        && selectedMixedChemicalBillingMode === ChemicalBillingMixedSelectionMode.included;
      const shouldPersistSeparatelyBilledChemicalSelections = selectedChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
        && selectedMixedChemicalBillingMode === ChemicalBillingMixedSelectionMode.separatelyBilled;
      const chemicalBillingFields = {
        chemicalBillingMode: selectedChemicalBillingMode,
        chemicalBillingMixedSelectionMode: selectedChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
          ? selectedMixedChemicalBillingMode
          : '',
        includedChemicalKeywords: shouldPersistIncludedChemicalSelections
          ? normalizeCommaList(editDraft.includedChemicalKeywords)
          : [],
        includedChemicalIds: shouldPersistIncludedChemicalSelections
          ? normalizeCommaList(editDraft.includedChemicalIds)
          : [],
        separatelyBilledChemicalKeywords: shouldPersistSeparatelyBilledChemicalSelections
          ? normalizeCommaList(editDraft.separatelyBilledChemicalKeywords)
          : [],
        separatelyBilledChemicalIds: shouldPersistSeparatelyBilledChemicalSelections
          ? normalizeCommaList(editDraft.separatelyBilledChemicalIds)
          : [],
        customerPurchasedChemicalKeywords: [],
        customerPurchasedChemicalIds: [],
        chemicalBillingNotes: editDraft.chemicalBillingNotes.trim(),
      };
      const pnlReportingFields = {
        pnlIncludeInReports: editDraft.pnlIncludeInReports !== false,
        pnlChemicalCostMode: SalesAgreementPnlChemicalCostMode.includeAll,
        pnlExcludedChemicalKeywords: [],
        pnlExcludedChemicalIds: [],
        pnlExcludeCustomerPurchasedChemicals: true,
      };

      await updateDoc(doc(db, salesCollectionNames.agreements, agreement.id), {
        title: editDraft.title.trim(),
        description: editDraft.description.trim(),
        email: editDraft.email.trim(),
        status: nextStatus,
        startDate: dateFromInput(editDraft.startDate),
        expiresAt: dateFromInput(editDraft.expiresAt),
        serviceCadence: editDraft.serviceCadence,
        serviceCadenceCount: Math.max(Number(editDraft.serviceCadenceCount) || 1, 1),
        serviceFrequencyLabel: formatServiceFrequency(editDraft),
        billingFrequency: editDraft.billingFrequency,
        billingFrequencyCount: Math.max(Number(editDraft.billingFrequencyCount) || 1, 1),
        rateType: editDraft.rateType,
        paymentTerms: editDraft.paymentTerms,
        ...pnlReportingFields,
        ...chemicalBillingFields,
        terms: editDraft.terms.trim(),
        termsTemplateId: editDraft.termsTemplateId || '',
        termsTemplateName: editDraft.termsTemplateName || selectedEditTermsTemplate?.name || '',
        termsTemplateDescription: editDraft.termsTemplateDescription || selectedEditTermsTemplate?.description || '',
        termsList: nextTermsList,
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

      if (billingSubscription?.id) {
        await updateDoc(doc(db, salesCollectionNames.billingSubscriptions, billingSubscription.id), {
          ...chemicalBillingFields,
          'agreementSnapshot.chemicalBillingMode': chemicalBillingFields.chemicalBillingMode,
          'agreementSnapshot.chemicalBillingMixedSelectionMode': chemicalBillingFields.chemicalBillingMixedSelectionMode,
          'agreementSnapshot.includedChemicalKeywords': chemicalBillingFields.includedChemicalKeywords,
          'agreementSnapshot.includedChemicalIds': chemicalBillingFields.includedChemicalIds,
          'agreementSnapshot.separatelyBilledChemicalKeywords': chemicalBillingFields.separatelyBilledChemicalKeywords,
          'agreementSnapshot.separatelyBilledChemicalIds': chemicalBillingFields.separatelyBilledChemicalIds,
          'agreementSnapshot.customerPurchasedChemicalKeywords': chemicalBillingFields.customerPurchasedChemicalKeywords,
          'agreementSnapshot.customerPurchasedChemicalIds': chemicalBillingFields.customerPurchasedChemicalIds,
          'agreementSnapshot.chemicalBillingNotes': chemicalBillingFields.chemicalBillingNotes,
          'agreementSnapshot.terms': editDraft.terms.trim(),
          'agreementSnapshot.termsList': nextTermsList,
          'agreementSnapshot.termsTemplateId': editDraft.termsTemplateId || '',
          'agreementSnapshot.termsTemplateName': editDraft.termsTemplateName || selectedEditTermsTemplate?.name || '',
          updatedAt: serverTimestamp(),
        });
      }

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
      const subscriptionsToDelete = new Map();
      if (billingSubscription?.id) subscriptionsToDelete.set(billingSubscription.id, billingSubscription);

      if (agreement.billingSubscriptionId && !subscriptionsToDelete.has(agreement.billingSubscriptionId)) {
        const subscriptionSnap = await getDoc(doc(db, salesCollectionNames.billingSubscriptions, agreement.billingSubscriptionId));
        if (subscriptionSnap.exists()) {
          subscriptionsToDelete.set(subscriptionSnap.id, { id: subscriptionSnap.id, ...subscriptionSnap.data() });
        }
      }

      const linkedSubscriptionsSnapshot = await getDocs(query(
        collection(db, salesCollectionNames.billingSubscriptions),
        where('agreementId', '==', agreement.id)
      ));
      linkedSubscriptionsSnapshot.docs.forEach((subscriptionDoc) => {
        subscriptionsToDelete.set(subscriptionDoc.id, { id: subscriptionDoc.id, ...subscriptionDoc.data() });
      });

      const liveStripeSubscription = [...subscriptionsToDelete.values()].find(
        (subscriptionRecord) => !canDeleteBillingSubscriptionRecord(subscriptionRecord)
      );
      if (liveStripeSubscription) {
        toast.error('Cancel the active Stripe billing subscription before deleting this agreement.');
        return;
      }

      const deleteBatch = writeBatch(db);
      [...subscriptionsToDelete.keys()].forEach((subscriptionId) => {
        deleteBatch.delete(doc(db, salesCollectionNames.billingSubscriptions, subscriptionId));
      });
      deleteBatch.delete(doc(db, salesCollectionNames.agreements, agreement.id));
      await deleteBatch.commit();
      toast.success(subscriptionsToDelete.size
        ? 'Service agreement and billing subscription deleted.'
        : 'Service agreement deleted.');
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

  const editChemicalBillingMode = editDraft?.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll;
  const editChemicalBillingMixedSelectionMode = editDraft?.chemicalBillingMixedSelectionMode
    || ChemicalBillingMixedSelectionMode.separatelyBilled;

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/company/sales/agreements"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <FaArrowLeft className="text-xs" />
                  Back to agreements
                </Link>
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

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={createRenewalAgreement}
                  disabled={!canCreateRenewal}
                  className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaCopy className="text-xs" />
                  {creatingRenewal ? 'Creating...' : 'Offer New Agreement'}
                </button>
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
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'cursor-not-allowed border border-slate-400 bg-slate-200 text-slate-700'
                    }`}
                  >
                    <FaRoute className="text-xs" />
                    Schedule Route
                  </Link>
                )}
                <span className="inline-flex" title={sendEmailButtonTitle}>
                  <button
                    type="button"
                    onClick={sendAgreementEmail}
                    disabled={!canSend}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaEnvelope className="text-xs" />
                    {sending ? 'Sending...' : 'Send Email'}
                  </button>
                </span>
              </div>

              <div className="w-full max-w-md space-y-2">
                <label className="inline-flex w-full items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeInspectionReport}
                    onChange={(event) => setIncludeInspectionReport(event.target.checked)}
                    disabled={sending}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span>
                    Include inspection report
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Adds the linked site inspection report to the service agreement email and public review page.
                    </span>
                  </span>
                </label>

                {includeInspectionReport && (
                  <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                      hasLinkedInspectionReport
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <p className="font-semibold">
                      {hasLinkedInspectionReport
                        ? 'Inspection report will be included.'
                        : 'No linked inspection report was found yet.'}
                    </p>
                    <p className="mt-1">
                      {hasLinkedInspectionReport
                        ? 'The email and public agreement page will show an Inspection Report section.'
                        : 'The email can still send, but the customer will see that no linked report is available yet.'}
                    </p>
                    {hasLinkedInspectionReport && (
                      inspectionReportUrl ? (
                        <a
                          href={inspectionReportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex font-semibold text-blue-700 underline"
                        >
                          Open inspection report
                        </a>
                      ) : (
                        <Link
                          to={inspectionReportLink}
                          className="mt-2 inline-flex font-semibold text-blue-700 underline"
                        >
                          Open linked service stop
                        </Link>
                      )
                    )}
                  </div>
                )}
              </div>
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
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
            <main className="space-y-6 lg:order-2">
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

              {isRecurringAgreement && (
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <FaRoute className="text-slate-400" />
                      <h2 className="text-lg font-bold text-slate-950">Operations Setup</h2>
                    </div>
                    {!hasRecurringRouteSetup && (
                      <Link
                        to={recurringSetupUrl}
                        aria-disabled={!canScheduleRecurringRoute}
                        onClick={(event) => {
                          if (!canScheduleRecurringRoute) event.preventDefault();
                        }}
                        className={`inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
                          canScheduleRecurringRoute
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'cursor-not-allowed border border-slate-400 bg-slate-200 text-slate-700'
                        }`}
                      >
                        <FaRoute className="text-xs" />
                        Schedule Route
                      </Link>
                    )}
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <dt className="text-slate-500">Setup Status</dt>
                      <dd className="mt-1 font-semibold text-slate-900">{labelize(recurringSetupStatus)}</dd>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <dt className="text-slate-500">Recurring Stop</dt>
                      <dd className="mt-1 font-semibold text-slate-900">
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
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <dt className="text-slate-500">Route</dt>
                      <dd className="mt-1 font-semibold text-slate-900">
                        {recurringRouteId ? (
                          <Link to="/company/route-management" className="text-blue-700 hover:text-blue-900">
                            {recurringRouteName || 'Open Route Management'}
                          </Link>
                        ) : 'Not assigned'}
                      </dd>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <dt className="text-slate-500">Service Location</dt>
                      <dd className="mt-1 break-all font-semibold text-slate-900">{firstServiceLocationId || 'Not set'}</dd>
                    </div>
                  </dl>

                  {!isAccepted && !hasRecurringRouteSetup && (
                    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      Accept the recurring service agreement before scheduling its route.
                    </div>
                  )}
                </section>
              )}

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
                  {agreementTermsIntro && (
                    <p className="whitespace-pre-wrap">{agreementTermsIntro}</p>
                  )}
                  {agreementTermsList.length > 0 && (
                    <div className={agreementTermsIntro ? 'mt-4 space-y-2 border-t border-slate-200 pt-4' : 'space-y-2'}>
                      {agreementTermsList.map((term, index) => (
                        <p key={`${term}_${index}`} className="flex gap-2">
                          <span className="font-semibold text-slate-500">{index + 1}.</span>
                          <span>{term}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {!agreementTermsIntro && agreementTermsList.length === 0 && (
                    <p className="text-slate-500">No terms snapshot saved.</p>
                  )}
                </div>
              </section>
            </main>

            <aside className="space-y-6 lg:order-1">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Send Readiness</h2>
                <div className="mt-4 space-y-3">
                  {readinessItems.map((item) => (
                    <ReadinessRow key={item.title} {...item} />
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Service Summary</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Service Frequency</dt>
                    <dd className="font-semibold text-slate-900">{formatServiceFrequency(agreement)}</dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Billing Summary</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Billing Frequency</dt>
                    <dd className="font-semibold text-slate-900">{formatBillingFrequency(agreement)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Rate Type</dt>
                    <dd className="font-semibold text-slate-900">{labelize(agreement.rateType)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Payment Terms</dt>
                    <dd className="font-semibold text-slate-900">{labelize(agreement.paymentTerms)}</dd>
                  </div>
                  <div className="space-y-2 border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Chemical Billing</dt>
                      <dd className="text-right font-semibold text-slate-900">{chemicalBillingLabel(agreement)}</dd>
                    </div>
                    {separatelyBilledChemicalDisplay && (
                      <div>
                        <dt className="text-slate-500">Billed Separately</dt>
                        <dd className="mt-1 break-words font-semibold text-slate-900">{separatelyBilledChemicalDisplay}</dd>
                      </div>
                    )}
                    {includedChemicalDisplay && (
                      <div>
                        <dt className="text-slate-500">Included Chemicals</dt>
                        <dd className="mt-1 break-words font-semibold text-slate-900">{includedChemicalDisplay}</dd>
                      </div>
                    )}
                    {customerPurchasedChemicalDisplay && (
                      <div>
                        <dt className="text-slate-500">Customer Purchased</dt>
                        <dd className="mt-1 break-words font-semibold text-slate-900">{customerPurchasedChemicalDisplay}</dd>
                      </div>
                    )}
                    {agreement.chemicalBillingNotes && (
                      <div>
                        <dt className="text-slate-500">Chemical Notes</dt>
                        <dd className="mt-1 whitespace-pre-wrap font-semibold text-slate-900">{agreement.chemicalBillingNotes}</dd>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">PNL Revenue</dt>
                      <dd className="font-semibold text-slate-900">{agreement.pnlIncludeInReports === false ? 'Excluded' : 'Included'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">PNL Chemicals</dt>
                      <dd className="text-right font-semibold text-slate-900">Based on Billing</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Customer Purchased</dt>
                      <dd className="font-semibold text-slate-900">Ignored</dd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                    <dt className="text-slate-500">Subtotal</dt>
                    <dd className="font-semibold text-slate-900">{formatCurrency(subtotalAmountCents)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Total</dt>
                    <dd className="text-lg font-bold text-slate-950">{formatCurrency(totalAmountCents)}</dd>
                  </div>
                  {(supersedesAgreementId || agreement.supersededByAgreementId || agreement.agreementHistoryGroupId) && (
                    <div className="space-y-2 border-t border-slate-200 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">Agreement Version</dt>
                        <dd className="font-semibold text-slate-900">v{agreement.agreementVersion || 1}</dd>
                      </div>
                      {supersedesAgreementId && (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-slate-500">Replaces</dt>
                          <dd className="font-semibold">
                            <Link to={`/company/sales/agreements/${supersedesAgreementId}`} className="text-blue-700 hover:text-blue-900">
                              Previous Agreement
                            </Link>
                          </dd>
                        </div>
                      )}
                      {agreement.supersededByAgreementId && (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-slate-500">Replaced By</dt>
                          <dd className="font-semibold">
                            <Link to={`/company/sales/agreements/${agreement.supersededByAgreementId}`} className="text-blue-700 hover:text-blue-900">
                              {agreement.supersededByAgreementTitle || 'New Agreement'}
                            </Link>
                          </dd>
                        </div>
                      )}
                    </div>
                  )}
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4">
          <div className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-center">
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
                disabled={savingEdit || applyingTermsTemplate || updatingTermsTemplate || savingCatalogItem}
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
                <h3 className="text-base font-bold text-slate-950">Service</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementCadence">
                      Service Frequency
                    </label>
                    <select
                      id="agreementCadence"
                      value={editDraft.serviceCadence}
                      onChange={(event) => updateEditField('serviceCadence', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {serviceFrequencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementCadenceCount">
                      Service Count
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
                </div>
              </section>

              <section>
                <h3 className="text-base font-bold text-slate-950">Billing</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementBillingFrequency">
                      Billing Frequency
                    </label>
                    <select
                      id="agreementBillingFrequency"
                      value={editDraft.billingFrequency}
                      onChange={(event) => updateEditField('billingFrequency', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {billingFrequencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementBillingFrequencyCount">
                      Billing Count
                    </label>
                    <input
                      id="agreementBillingFrequencyCount"
                      type="number"
                      min="1"
                      value={editDraft.billingFrequencyCount}
                      onChange={(event) => updateEditField('billingFrequencyCount', event.target.value)}
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

                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="text-sm font-bold text-slate-950">Chemical Billing</h4>
                    <Link
                      to="/company/readingsAndDosages"
                      className="text-sm font-semibold text-blue-700 hover:text-blue-800"
                    >
                      Manage Dosages
                    </Link>
                  </div>

                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementChemicalBillingMode">
                        Billing Treatment
                      </label>
                      <select
                        id="agreementChemicalBillingMode"
                        value={editChemicalBillingMode}
                        onChange={(event) => updateChemicalBillingMode(event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {chemicalBillingModeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementChemicalBillingNotes">
                        Chemical Billing Notes
                      </label>
                      <input
                        id="agreementChemicalBillingNotes"
                        type="text"
                        value={editDraft.chemicalBillingNotes}
                        onChange={(event) => updateEditField('chemicalBillingNotes', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="tabs supplied by customer, phosphate billed separately"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    {editChemicalBillingMode === SalesAgreementChemicalBillingMode.includedAll && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        All dosage templates are included in service. No chemical selections are needed.
                      </div>
                    )}

                    {editChemicalBillingMode === SalesAgreementChemicalBillingMode.billAllSeparately && (
                      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                        All dosage templates are billed separately. No chemical selections are needed.
                      </div>
                    )}

                    {editChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed && (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-md border border-slate-200 bg-white p-3">
                          <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementChemicalBillingMixedSelectionMode">
                            Mixed Billing Selection
                          </label>
                          <select
                            id="agreementChemicalBillingMixedSelectionMode"
                            value={editChemicalBillingMixedSelectionMode}
                            onChange={(event) => updateChemicalBillingMixedSelectionMode(event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            {mixedChemicalBillingSelectionOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>

                        {editChemicalBillingMixedSelectionMode === ChemicalBillingMixedSelectionMode.included ? (
                          <ChemicalDosagePicker
                            id="agreementIncludedChemicalIds"
                            label="Included Dosages"
                            selectedIds={editDraft.includedChemicalIds}
                            dosageTemplates={dosageTemplates}
                            loading={loadingDosageTemplates}
                            onChange={(nextIds) => updateEditField('includedChemicalIds', nextIds)}
                          />
                        ) : (
                          <ChemicalDosagePicker
                            id="agreementSeparatelyBilledChemicalIds"
                            label="Excluded / Separately Billed Dosages"
                            selectedIds={editDraft.separatelyBilledChemicalIds}
                            dosageTemplates={dosageTemplates}
                            loading={loadingDosageTemplates}
                            onChange={(nextIds) => updateEditField('separatelyBilledChemicalIds', nextIds)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-bold text-slate-950">Reporting</h4>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <label className="flex items-start gap-3 font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={editDraft.pnlIncludeInReports !== false}
                        onChange={(event) => updateEditField('pnlIncludeInReports', event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Agreement revenue in PNL
                    </label>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700">
                      Chemical PNL follows billing settings
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-950">Line Items</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Customer-facing pricing rows for this service agreement.
                    </p>
                  </div>
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

                <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-950">Add Line Item</h4>
                      <p className="mt-1 text-sm text-slate-500">
                        Add pricing from the Sales Catalog or create a one-off manual row.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => setShowCatalogItemSelector((current) => !current)}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                      >
                        <FaPlus className="text-xs" />
                        Add Catalog Item
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          addEditLineItem();
                          setShowCatalogItemSelector(false);
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        <FaPlus className="text-xs" />
                        Add Manual Item
                      </button>
                    </div>
                  </div>

                  {showCatalogItemSelector && (
                    <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(0,1fr)_120px_auto_auto]">
                      <select
                        value={selectedCatalogItemId}
                        onChange={(event) => {
                          const nextItemId = event.target.value;
                          const nextItem = catalogItems.find((item) => item.id === nextItemId);
                          setSelectedCatalogItemId(nextItemId);
                          setSelectedCatalogQuantity(String(nextItem?.defaultQuantity || 1));
                        }}
                        disabled={loadingCatalogItems}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                        aria-label="Select sales catalog item"
                      >
                        <option value="">
                          {loadingCatalogItems ? 'Loading catalog...' : catalogItems.length ? 'Select catalog item' : 'No catalog items yet'}
                        </option>
                        {catalogItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} - {formatCurrency(item.unitAmountCents)} - {labelize(item.billingBehavior)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={selectedCatalogQuantity}
                        onChange={(event) => setSelectedCatalogQuantity(event.target.value)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        aria-label="Catalog item quantity"
                      />
                      <button
                        type="button"
                        onClick={() => addCatalogLineItem()}
                        disabled={!selectedEditCatalogItem}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FaPlus className="text-xs" />
                        Add Selected
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreateCatalogItem(true)}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                      >
                        <FaPlus className="text-xs" />
                        Create Catalog Item
                      </button>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-950">Terms</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Select a saved template, then add or adjust lines for this agreement only.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link
                      to="/company/settings/terms-templates"
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Manage Templates
                    </Link>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementTermsTemplate">
                    Terms Template
                  </label>
                  <select
                    id="agreementTermsTemplate"
                    value={editDraft.termsTemplateId || ''}
                    onChange={(event) => applyTermsTemplate(event.target.value)}
                    disabled={loadingTermsTemplates || applyingTermsTemplate}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    <option value="">
                      {loadingTermsTemplates ? 'Loading templates...' : 'No template selected'}
                    </option>
                    {editDraft.termsTemplateId && !selectedEditTermsTemplate && (
                      <option value={editDraft.termsTemplateId}>
                        {editDraft.termsTemplateName || 'Current template'}
                      </option>
                    )}
                    {termsTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  {applyingTermsTemplate && (
                    <p className="mt-2 text-sm text-slate-500">Applying template terms...</p>
                  )}
                </div>

                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Template Default Content</p>
                  {editDraft.terms ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{editDraft.terms}</p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      No default content saved for this agreement template.
                    </p>
                  )}
                </div>

                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={updateSourceTermsTemplate}
                    disabled={!can("884") || !editDraft.termsTemplateId || applyingTermsTemplate || updatingTermsTemplate || savingEdit}
                    className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingTermsTemplate ? 'Updating template...' : 'Update source template from these lines'}
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-slate-950">Terms Lines</h4>
                  <button
                    type="button"
                    onClick={addEditTermLine}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FaPlus className="text-xs" />
                    Add Line
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {(editDraft.termsList || []).map((term, index) => (
                    <div key={term.id} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-500">
                        {index + 1}
                      </div>
                      <textarea
                        value={term.description}
                        onChange={(event) => updateEditTermLine(term.id, event.target.value)}
                        rows={2}
                        placeholder="Agreement term line"
                        className="min-h-[72px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        onClick={() => removeEditTermLine(term.id)}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {(!editDraft.termsList || editDraft.termsList.length === 0) && (
                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      Select a template or add agreement-specific terms lines.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white p-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  closeEditor();
                  setConfirmingDelete(true);
                  setDeleteConfirmation('');
                }}
                disabled={!agreement || companyMismatch || deleting || savingEdit}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 sm:mr-auto"
              >
                <FaTrash className="text-xs" />
                Delete Agreement
              </button>
              <button
                type="button"
                onClick={closeEditor}
                disabled={savingEdit || applyingTermsTemplate || updatingTermsTemplate || savingCatalogItem}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <FaTimes className="text-xs" />
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={savingEdit || applyingTermsTemplate || updatingTermsTemplate || savingCatalogItem}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaSave className="text-xs" />
                {savingEdit ? 'Saving...' : applyingTermsTemplate ? 'Applying...' : updatingTermsTemplate ? 'Updating Template...' : savingCatalogItem ? 'Creating Catalog Item...' : 'Save Changes'}
              </button>
            </div>
          </div>

          {showCreateCatalogItem && (
            <div className="w-full max-w-xl rounded-lg bg-white shadow-2xl xl:sticky xl:top-4 xl:max-h-[92vh] xl:overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Create Sales Catalog Item</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Add a reusable catalog item, then attach it to this agreement.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetCatalogItemDraft}
                  disabled={savingCatalogItem}
                  className="rounded-md border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  aria-label="Close catalog item creator"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogItemName">
                    Item Name
                  </label>
                  <input
                    id="newCatalogItemName"
                    type="text"
                    value={catalogItemDraft.name}
                    onChange={(event) => updateCatalogItemDraftField('name', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Weekly pool service"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogItemType">
                      Type
                    </label>
                    <select
                      id="newCatalogItemType"
                      value={catalogItemDraft.type}
                      onChange={(event) => updateCatalogItemDraftField('type', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {Object.values(SalesCatalogItemType).map((option) => (
                        <option key={option} value={option}>{labelize(option)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogBillingBehavior">
                      Billing
                    </label>
                    <select
                      id="newCatalogBillingBehavior"
                      value={catalogItemDraft.billingBehavior}
                      onChange={(event) => updateCatalogItemDraftField('billingBehavior', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {Object.values(SalesCatalogBillingBehavior).map((option) => (
                        <option key={option} value={option}>{labelize(option)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogUnitAmount">
                      Unit Price
                    </label>
                    <input
                      id="newCatalogUnitAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={catalogItemDraft.unitAmount}
                      onChange={(event) => updateCatalogItemDraftField('unitAmount', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogUnitCost">
                      Unit Cost
                    </label>
                    <input
                      id="newCatalogUnitCost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={catalogItemDraft.unitCost}
                      onChange={(event) => updateCatalogItemDraftField('unitCost', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogDefaultQuantity">
                      Default Qty
                    </label>
                    <input
                      id="newCatalogDefaultQuantity"
                      type="number"
                      min="1"
                      step="1"
                      value={catalogItemDraft.defaultQuantity}
                      onChange={(event) => updateCatalogItemDraftField('defaultQuantity', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={catalogItemDraft.taxable}
                    onChange={(event) => updateCatalogItemDraftField('taxable', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Taxable
                </label>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="newCatalogItemDescription">
                    Description
                  </label>
                  <textarea
                    id="newCatalogItemDescription"
                    rows={3}
                    value={catalogItemDraft.description}
                    onChange={(event) => updateCatalogItemDraftField('description', event.target.value)}
                    className="mt-1 min-h-[96px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Customer-facing description for this catalog item"
                  />
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white p-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={resetCatalogItemDraft}
                  disabled={savingCatalogItem}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createCatalogItemFromAgreement}
                  disabled={savingCatalogItem}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaSave className="text-xs" />
                  {savingCatalogItem ? 'Creating...' : 'Create & Add'}
                </button>
              </div>
            </div>
          )}
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
              {supersedesAgreementId ? ' It will also end the previous agreement and mark it superseded.' : ''}
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
              This permanently removes the agreement snapshot and any linked billing subscription records.
              Active Stripe subscriptions must be canceled before deleting.
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
