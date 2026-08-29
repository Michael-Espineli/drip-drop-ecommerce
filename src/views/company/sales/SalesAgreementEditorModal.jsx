import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  FaPlus,
  FaSave,
  FaTimes,
  FaTrash,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import {
  SalesCatalogBillingBehavior,
  SalesCatalogItem,
  SalesCatalogItemType,
  SalesCatalogSourceType,
  SalesAgreementChemicalBillingMode,
  SalesAgreementPnlChemicalCostMode,
  SalesInvoiceDeliveryMethod,
  SalesInvoiceLineItem,
  SalesAgreementStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import {
  billingFrequencyForAgreement,
  billingFrequencyOptions,
  formatServiceFrequency,
  paymentTermsOptions,
  rateTypeOptions,
  serviceFrequencyOptions,
} from '../../../utils/sales/agreementCadence';
import { dosageLabel, sortDosageTemplates } from '../../../utils/dosageItemLinks';
import { ContractTerm, getTermDescription } from '../../../utils/models/TermsTemplate';
import {
  applyTermsTemplateAgreementDefaults,
  termsTemplateDefaultsFromAgreementDraft,
} from '../../../utils/terms/termsTemplateAgreementDefaults';
import {
  deleteContractTerm,
  getTerms,
  listenTermsTemplates,
  saveContractTerm,
  updateTermsTemplate,
} from '../../../utils/terms/termsTemplateFirestore';
import {
  salesCatalogCollection,
  saveSalesCatalogItem,
} from '../../../utils/sales/salesFirestore';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import {
  DELETE_SERVICE_AGREEMENTS_PERMISSION_ID,
  UPDATE_SERVICE_AGREEMENTS_PERMISSION_ID,
} from '../../../utils/companyPermissions';
import { appConfirm } from '../../../utils/appDialog';

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

const SALES_PERMISSION_ID = '400';

const isPermissionDeniedError = (error) => (
  error?.code === 'permission-denied' ||
  /missing or insufficient permissions/i.test(String(error?.message || ''))
);

const salesRecordCompanyId = (record = {}) => (
  typeof record?.companyId === 'string' ? record.companyId.trim() : ''
);

const getSalesDeleteOwnershipIssue = ({
  label,
  record,
  selectedCompanyId,
  agreementCompanyId = '',
}) => {
  const companyId = salesRecordCompanyId(record);

  if (!companyId) {
    return `${label} is missing companyId, so Firebase rules cannot verify company access.`;
  }

  if (selectedCompanyId && companyId !== selectedCompanyId) {
    return `${label} belongs to a different company than the one currently selected.`;
  }

  if (agreementCompanyId && companyId !== agreementCompanyId) {
    return `${label} is linked to this agreement but belongs to a different company.`;
  }

  return '';
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
  invoiceDeliveryMethod: agreement?.invoiceDeliveryMethod || SalesInvoiceDeliveryMethod.email,
  firstInvoiceSendAt: toInputDate(agreement?.firstInvoiceSendAt || agreement?.manualBillingNextInvoiceAt || agreement?.startDate),
  manualBillingAutoSendEnabled: agreement?.manualBillingAutoSendEnabled === true,
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

const SalesAgreementEditorModal = ({
  agreement,
  open,
  onClose,
  onDeleted,
}) => {
  const {
    dataBaseUser,
    recentlySelectedCompany,
    stripeConnectedAccountId,
    user,
  } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const canUpdateServiceAgreements = can(UPDATE_SERVICE_AGREEMENTS_PERMISSION_ID) || can(SALES_PERMISSION_ID);
  const canDeleteServiceAgreements = can(DELETE_SERVICE_AGREEMENTS_PERMISSION_ID) || can(SALES_PERMISSION_ID);
  const [activeAgreementId, setActiveAgreementId] = useState('');
  const [editDraft, setEditDraft] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
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

  const resetEditorState = () => {
    setActiveAgreementId('');
    setEditDraft(null);
    setSavingEdit(false);
    setBillingSubscription(null);
    setConfirmingDelete(false);
    setDeleteConfirmation('');
    setDeleting(false);
    setTermsTemplates([]);
    setLoadingTermsTemplates(false);
    setApplyingTermsTemplate(false);
    setUpdatingTermsTemplate(false);
    setDosageTemplates([]);
    setLoadingDosageTemplates(false);
    setCatalogItems([]);
    setLoadingCatalogItems(false);
    setSelectedCatalogItemId('');
    setSelectedCatalogQuantity('1');
    setShowCatalogItemSelector(false);
    setShowCreateCatalogItem(false);
    setCatalogItemDraft(initialCatalogItemDraft);
    setSavingCatalogItem(false);
  };

  useEffect(() => {
    if (!open) {
      resetEditorState();
      return;
    }

    if (agreement?.id && agreement.id !== activeAgreementId) {
      setActiveAgreementId(agreement.id);
      setEditDraft(createEditDraft(agreement));
    }
  }, [activeAgreementId, agreement, open]);

  useEffect(() => {
    if (!open || !agreement?.billingSubscriptionId) {
      setBillingSubscription(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, salesCollectionNames.billingSubscriptions, agreement.billingSubscriptionId),
      (snapshot) => {
        setBillingSubscription(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (subscriptionError) => {
        console.error('Unable to load billing subscription for agreement editor', subscriptionError);
        setBillingSubscription(null);
      }
    );
  }, [agreement?.billingSubscriptionId, open]);

  useEffect(() => {
    if (!open || !recentlySelectedCompany) {
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
  }, [open, recentlySelectedCompany]);

  useEffect(() => {
    if (!open || !recentlySelectedCompany) {
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
  }, [open, recentlySelectedCompany]);

  useEffect(() => {
    if (!open || !recentlySelectedCompany) {
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
  }, [open, recentlySelectedCompany]);

  const actorName = [
    dataBaseUser?.firstName,
    dataBaseUser?.lastName,
  ].filter(Boolean).join(' ').trim()
    || dataBaseUser?.userName
    || dataBaseUser?.name
    || user?.displayName
    || user?.email
    || 'Company user';
  const companyMismatch = Boolean(
    agreement &&
    recentlySelectedCompany &&
    agreement.companyId &&
    agreement.companyId !== recentlySelectedCompany
  );
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

  const closeEditor = () => {
    resetEditorState();
    onClose?.();
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
        ...applyTermsTemplateAgreementDefaults(
          {
            ...current,
            termsTemplateId: template.id,
            termsTemplateName: template.name || '',
            termsTemplateDescription: template.description || '',
            terms: template.content || '',
            termsList: normalizeAgreementTerms(templateTerms),
          },
          template
        ),
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
    if (!requirePermission('884', 'update terms templates')) return;

    const templateName = editDraft.termsTemplateName || selectedEditTermsTemplate?.name || 'selected template';
    const confirmed = await appConfirm({
      title: 'Update Service Agreement Template',
      message: `Update "${templateName}" with the current default content, terms lines, and agreement defaults from this agreement?`,
      confirmLabel: 'Update Template',
    });
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
        ...termsTemplateDefaultsFromAgreementDraft(editDraft),
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
    if (!canUpdateServiceAgreements) {
      toast.error('Your role cannot edit service agreements.');
      return;
    }

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

    if (!editDraft.title.trim() || nextLineItems.length === 0) {
      toast.error('Add a title and at least one priced line item.');
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
        invoiceDeliveryMethod: editDraft.invoiceDeliveryMethod || SalesInvoiceDeliveryMethod.email,
        firstInvoiceSendAt: dateFromInput(editDraft.firstInvoiceSendAt),
        manualBillingNextInvoiceAt: dateFromInput(editDraft.firstInvoiceSendAt),
        manualBillingAutoSendEnabled: editDraft.manualBillingAutoSendEnabled === true,
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
    if (!canDeleteServiceAgreements) {
      toast.error('Your role cannot delete service agreements.');
      return;
    }

    const selectedCompanyId = String(recentlySelectedCompany || '').trim();
    const agreementCompanyId = salesRecordCompanyId(agreement);
    const agreementOwnershipIssue = !selectedCompanyId
      ? 'Select the company that owns this service agreement before deleting it.'
      : getSalesDeleteOwnershipIssue({
        label: 'This service agreement',
        record: agreement,
        selectedCompanyId,
      });

    if (agreementOwnershipIssue) {
      console.warn('Blocked service agreement delete before Firestore batch', {
        issue: agreementOwnershipIssue,
        agreementId: agreement.id,
        agreementCompanyId,
        selectedCompanyId,
        userId: user?.uid || '',
      });
      toast.error(agreementOwnershipIssue);
      return;
    }

    setDeleting(true);

    try {
      const deleteSalesAgreementCallable = httpsCallable(functions, 'deleteSalesAgreement');
      const authPayload = await getCallableAuthPayload();
      const result = await deleteSalesAgreementCallable({
        ...authPayload,
        agreementId: agreement.id,
        companyId: selectedCompanyId,
      });
      const deletedSubscriptionIds = Array.isArray(result.data?.deletedBillingSubscriptionIds)
        ? result.data.deletedBillingSubscriptionIds
        : [];

      toast.success(deletedSubscriptionIds.length
        ? 'Service agreement and billing subscription deleted.'
        : 'Service agreement deleted.');
      onDeleted?.(agreement.id);
      closeEditor();
    } catch (deleteError) {
      console.error('Unable to delete service agreement', {
        error: deleteError,
        agreementId: agreement.id,
        agreementCompanyId: salesRecordCompanyId(agreement),
        selectedCompanyId,
        userId: user?.uid || '',
      });
      toast.error(isPermissionDeniedError(deleteError)
        ? 'Firebase denied the delete. Check that this agreement and every linked billing subscription have the selected companyId and that your userAccess record exists for that company.'
        : deleteError.message || 'Failed to delete service agreement.');
    } finally {
      setDeleting(false);
    }
  };

  if (!open || !agreement || !editDraft) return null;

  const editChemicalBillingMode = editDraft?.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll;
  const editChemicalBillingMixedSelectionMode = editDraft?.chemicalBillingMixedSelectionMode
    || ChemicalBillingMixedSelectionMode.separatelyBilled;

  return (
    <>
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
                  <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementTemplateSelector">
                    Service Agreement Template
                  </label>
                  <select
                    id="agreementTemplateSelector"
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
                    <span className="ml-1 font-normal text-slate-500">(optional until send)</span>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-950">Services & Products</h3>
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
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_100px_130px_130px_auto]">
                          <input
                            value={item.name}
                            onChange={(event) => updateEditLineItem(item.id, 'name', event.target.value)}
                            placeholder="Item name"
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
                        <textarea
                          value={item.description}
                          onChange={(event) => updateEditLineItem(item.id, 'description', event.target.value)}
                          placeholder="Description"
                          rows={2}
                          className="mt-3 min-h-[72px] w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
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
                        Add pricing from the Service Catalog or create a one-off manual row.
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
                      {rateTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
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
                      {paymentTermsOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementInvoiceDeliveryMethod">
                      Invoice Delivery
                    </label>
                    <select
                      id="agreementInvoiceDeliveryMethod"
                      value={editDraft.invoiceDeliveryMethod}
                      onChange={(event) => updateEditField('invoiceDeliveryMethod', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {Object.values(SalesInvoiceDeliveryMethod).map((method) => (
                        <option key={method} value={method}>{labelize(method)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="agreementFirstInvoiceSendAt">
                      First Invoice Send
                    </label>
                    <input
                      id="agreementFirstInvoiceSendAt"
                      type="date"
                      value={editDraft.firstInvoiceSendAt}
                      onChange={(event) => updateEditField('firstInvoiceSendAt', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 lg:self-end">
                    <input
                      type="checkbox"
                      checked={editDraft.manualBillingAutoSendEnabled}
                      onChange={(event) => updateEditField('manualBillingAutoSendEnabled', event.target.checked)}
                    />
                    Email invoices automatically
                  </label>
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
                    disabled={!can('884') || !editDraft.termsTemplateId || applyingTermsTemplate || updatingTermsTemplate || savingEdit}
                    className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingTermsTemplate ? 'Updating template...' : 'Update source template from this agreement'}
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
                  setConfirmingDelete(true);
                  setDeleteConfirmation('');
                }}
                disabled={!agreement || companyMismatch || deleting || savingEdit || !canDeleteServiceAgreements}
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
                disabled={savingEdit || applyingTermsTemplate || updatingTermsTemplate || savingCatalogItem || !canUpdateServiceAgreements}
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
                  <h2 className="text-lg font-bold text-slate-950">Create Service / Product</h2>
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

      {confirmingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-rose-50 p-2 text-rose-700">
                <FaTrash />
              </span>
              <div>
                <h2 className="text-xl font-bold text-slate-950">Delete Service Agreement</h2>
                <p className="mt-2 text-sm text-slate-600">
                  This permanently removes the agreement and any linked billing subscription records.
                </p>
              </div>
            </div>

            <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="deleteAgreementConfirmation">
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
                disabled={deleting || deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaTrash className="text-xs" />
                {deleting ? 'Deleting...' : 'Delete Agreement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SalesAgreementEditorModal;
