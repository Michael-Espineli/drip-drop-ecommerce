import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Select from 'react-select';
import { collection, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  FaFileSignature,
  FaPlus,
  FaSave,
  FaTimes,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import {
  SalesAgreement,
  SalesAgreementChemicalBillingMode,
  SalesAgreementPnlChemicalCostMode,
  SalesAgreementSourceType,
  SalesAgreementStatus,
  SalesCatalogBillingBehavior,
  SalesInvoiceDeliveryMethod,
  SalesInvoiceLineItem,
} from '../../../utils/models/Sales';
import { buildTermsContent, getTermDescription } from '../../../utils/models/TermsTemplate';
import { salesCatalogCollection, saveSalesModel } from '../../../utils/sales/salesFirestore';
import { getTerms, listenTermsTemplates } from '../../../utils/terms/termsTemplateFirestore';
import FeatureInfoButton from '../../../components/FeatureInfoButton';
import {
  billingFrequencyOptions,
  formatBillingFrequency,
  formatServiceFrequency,
  serviceFrequencyOptions,
} from '../../../utils/sales/agreementCadence';
import { dosageLabel, sortDosageTemplates } from '../../../utils/dosageItemLinks';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

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

const dosageTemplateKeys = (template = {}) => (
  [
    template.id,
    template.templateId,
    template.dosageTemplateId,
    template.universalTemplateId,
  ].map((value) => String(value || '').trim()).filter(Boolean)
);

const deriveChemicalBillingFields = (form = {}) => {
  const selectedChemicalBillingMode = form.chemicalBillingMode || SalesAgreementChemicalBillingMode.includedAll;
  const selectedMixedChemicalBillingMode = form.chemicalBillingMixedSelectionMode
    || ChemicalBillingMixedSelectionMode.separatelyBilled;
  const shouldPersistIncludedChemicalSelections = selectedChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
    && selectedMixedChemicalBillingMode === ChemicalBillingMixedSelectionMode.included;
  const shouldPersistSeparatelyBilledChemicalSelections = selectedChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
    && selectedMixedChemicalBillingMode === ChemicalBillingMixedSelectionMode.separatelyBilled;

  return {
    chemicalBillingMode: selectedChemicalBillingMode,
    chemicalBillingMixedSelectionMode: selectedChemicalBillingMode === SalesAgreementChemicalBillingMode.mixed
      ? selectedMixedChemicalBillingMode
      : '',
    includedChemicalKeywords: [],
    includedChemicalIds: shouldPersistIncludedChemicalSelections
      ? normalizeCommaList(form.includedChemicalIds)
      : [],
    separatelyBilledChemicalKeywords: [],
    separatelyBilledChemicalIds: shouldPersistSeparatelyBilledChemicalSelections
      ? normalizeCommaList(form.separatelyBilledChemicalIds)
      : [],
    customerPurchasedChemicalKeywords: [],
    customerPurchasedChemicalIds: [],
    chemicalBillingNotes: String(form.chemicalBillingNotes || '').trim(),
  };
};

const deriveInternalPnlFields = () => ({
  pnlIncludeInReports: true,
  pnlChemicalCostMode: SalesAgreementPnlChemicalCostMode.includeAll,
  pnlExcludedChemicalKeywords: [],
  pnlExcludedChemicalIds: [],
  pnlExcludeCustomerPurchasedChemicals: true,
});

const customerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || customer.name || 'Customer';
  }

  return (
    customer.customerName ||
    customer.name ||
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
    customer.company ||
    customer.email ||
    'Customer'
  );
};

const customerPhone = (customer = {}) => (
  customer.phoneNumber ||
  customer.phone ||
  customer.mainContact?.phoneNumber ||
  customer.contact?.phoneNumber ||
  ''
);

const customerAddressLine = (customer = {}) => {
  const address = customer.billingAddress || customer.address || {};
  return [
    address.streetAddress || customer.streetAddress,
    address.city || customer.city,
    address.state || customer.state,
    address.zip || customer.zip,
  ]
    .filter(Boolean)
    .join(' ');
};

const customerUserId = (customer = {}) => (
  customer.customerUserId ||
  customer.userId ||
  customer.linkedCustomerUserId ||
  customer.linkedHomeownerUserId ||
  (Array.isArray(customer.linkedCustomerIds) ? customer.linkedCustomerIds[0] : null) ||
  null
);

const customerRelationshipId = (customer = {}) => (
  customer.relationshipId ||
  customer.customerCompanyRelationshipId ||
  customer.linkedRelationshipId ||
  ''
);

const leadCustomerId = (lead = {}) => (
  lead.companyCustomerId ||
  lead.customerId ||
  ''
);

const leadServiceLocationId = (lead = {}) => (
  lead.companyServiceLocationId ||
  lead.serviceLocationId ||
  ''
);

const locationAddress = (location = {}) => {
  const address = location.address || location.billingAddress || {};
  return {
    streetAddress: address.streetAddress || location.streetAddress || '',
    address02: address.address02 || location.address02 || '',
    city: address.city || location.city || '',
    state: address.state || location.state || '',
    zip: address.zip || location.zip || '',
  };
};

const locationLabel = (location = {}) => {
  const address = locationAddress(location);
  return [
    location.nickName || location.name,
    address.streetAddress,
    address.city,
    address.state,
    address.zip,
  ]
    .filter(Boolean)
    .join(' ');
};

const toInputDate = (date) => {
  if (!date) return '';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toISOString().split('T')[0];
};

const dateFromInput = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const selectTheme = (theme) => ({
  ...theme,
  borderRadius: 6,
  colors: {
    ...theme.colors,
    primary25: '#EFF6FF',
    primary: '#2563EB',
    neutral20: '#CBD5E1',
    neutral30: '#94A3B8',
  },
});

const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderColor: state.isFocused ? '#2563EB' : '#CBD5E1',
    boxShadow: state.isFocused ? '0 0 0 2px rgba(37, 99, 235, 0.15)' : 'none',
    '&:hover': {
      borderColor: state.isFocused ? '#2563EB' : '#94A3B8',
    },
  }),
  menu: (base) => ({
    ...base,
    zIndex: 40,
  }),
};

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
            const labelText = template ? dosageLabel(template) : dosageId;
            return (
              <span
                key={dosageId}
                className="inline-flex max-w-full items-center gap-2 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800"
              >
                <span className="truncate">{labelText}</span>
                <button
                  type="button"
                  onClick={() => toggleSelection(dosageId)}
                  className="text-blue-500 transition hover:text-rose-600"
                  aria-label={`Remove ${labelText}`}
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

const CreateSalesAgreement = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    currentUser,
    user,
    currentuser,
    dataBaseUser,
  } = useContext(Context);

  const activeUser = currentUser || user || currentuser || {};
  const activeUserId = activeUser?.uid || activeUser?.id || '';
  const sourceLeadId = searchParams.get('leadId') || '';
  const sourceServiceStopId = searchParams.get('serviceStopId') || searchParams.get('inspectionServiceStopId') || '';
  const queryCustomerId = searchParams.get('customerId') || '';
  const queryServiceLocationId = searchParams.get('serviceLocationId') || '';

  const [customers, setCustomers] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [dosageTemplates, setDosageTemplates] = useState([]);
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [selectedTerms, setSelectedTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [termsLoading, setTermsLoading] = useState(false);
  const [loadingDosageTemplates, setLoadingDosageTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [selectedCatalogQuantity, setSelectedCatalogQuantity] = useState('1');
  const [lineItems, setLineItems] = useState([]);
  const [sourceLead, setSourceLead] = useState(null);
  const [sourceServiceStop, setSourceServiceStop] = useState(null);
  const [sourceContextLoaded, setSourceContextLoaded] = useState(false);
  const [sourcePrefillApplied, setSourcePrefillApplied] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    customerId: '',
    email: '',
    serviceLocationIds: [],
    termsTemplateId: '',
    serviceCadence: 'weekly',
    serviceCadenceCount: '1',
    billingFrequency: 'monthly',
    billingFrequencyCount: '1',
    rateType: 'perMonth',
    paymentTerms: 'dueOnReceipt',
    invoiceDeliveryMethod: SalesInvoiceDeliveryMethod.email,
    chemicalBillingMode: SalesAgreementChemicalBillingMode.includedAll,
    chemicalBillingMixedSelectionMode: ChemicalBillingMixedSelectionMode.separatelyBilled,
    includedChemicalIds: [],
    separatelyBilledChemicalIds: [],
    chemicalBillingNotes: '',
    startDate: toInputDate(new Date()),
    expiresAt: '',
    atWill: true,
  });

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCustomers([]);
      setServiceLocations([]);
      setCatalogItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    let firstSnapshotsRemaining = 3;
    const markLoaded = () => {
      firstSnapshotsRemaining -= 1;
      if (firstSnapshotsRemaining <= 0) setLoading(false);
    };

    const unsubscribes = [
      onSnapshot(
        collection(db, 'companies', recentlySelectedCompany, 'customers'),
        (snapshot) => {
          const nextCustomers = snapshot.docs
            .map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() }))
            .filter((customer) => customer.active !== false)
            .sort((left, right) => customerDisplayName(left).localeCompare(customerDisplayName(right)));
          setCustomers(nextCustomers);
          markLoaded();
        },
        (error) => {
          console.error('Unable to load customers for sales agreement', error);
          toast.error('Failed to load customers.');
          setLoading(false);
        }
      ),
      onSnapshot(
        collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),
        (snapshot) => {
          const nextLocations = snapshot.docs
            .map((locationDoc) => ({ id: locationDoc.id, ...locationDoc.data() }))
            .sort((left, right) => locationLabel(left).localeCompare(locationLabel(right)));
          setServiceLocations(nextLocations);
          markLoaded();
        },
        (error) => {
          console.error('Unable to load service locations for sales agreement', error);
          toast.error('Failed to load service locations.');
          setLoading(false);
        }
      ),
      onSnapshot(
        salesCatalogCollection(db, recentlySelectedCompany),
        (snapshot) => {
          const nextItems = snapshot.docs
            .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
            .filter((item) => item.active !== false)
            .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
          setCatalogItems(nextItems);
          setSelectedCatalogItemId((current) => current || nextItems[0]?.id || '');
          markLoaded();
        },
        (error) => {
          console.error('Unable to load sales catalog for agreement', error);
          toast.error('Failed to load sales catalog.');
          setLoading(false);
        }
      ),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
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
      (error) => {
        console.error('Unable to load dosage templates for sales agreement', error);
        toast.error('Failed to load dosage templates.');
        setDosageTemplates([]);
        setLoadingDosageTemplates(false);
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    setSourcePrefillApplied(false);
    setSourceLead(null);
    setSourceServiceStop(null);
    setSourceContextLoaded(false);

    if (!recentlySelectedCompany || (!sourceLeadId && !sourceServiceStopId)) {
      setSourceContextLoaded(true);
      return undefined;
    }

    let isActive = true;

    const loadSourceRecords = async () => {
      try {
        if (sourceLeadId) {
          const leadSnap = await getDoc(doc(db, 'homeownerServiceRequests', sourceLeadId));
          if (isActive && leadSnap.exists() && leadSnap.data().companyId === recentlySelectedCompany) {
            setSourceLead({ id: leadSnap.id, ...leadSnap.data() });
          }
        }

        if (sourceServiceStopId) {
          const stopSnap = await getDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceStops', sourceServiceStopId));
          if (isActive && stopSnap.exists()) {
            setSourceServiceStop({ id: stopSnap.id, ...stopSnap.data() });
          }
        }
      } catch (error) {
        console.error('Unable to load agreement source records', error);
        if (isActive) toast.error('Failed to load the lead or survey context for this agreement.');
      } finally {
        if (isActive) setSourceContextLoaded(true);
      }
    };

    loadSourceRecords();

    return () => {
      isActive = false;
    };
  }, [recentlySelectedCompany, sourceLeadId, sourceServiceStopId]);

  useEffect(() => {
    if (sourcePrefillApplied) return;
    if (!sourceContextLoaded) return;
    if (!sourceLeadId && !sourceServiceStopId && !queryCustomerId && !queryServiceLocationId) return;

    const customerId = queryCustomerId || leadCustomerId(sourceLead) || sourceServiceStop?.customerId || '';
    const serviceLocationId = queryServiceLocationId || leadServiceLocationId(sourceLead) || sourceServiceStop?.serviceLocationId || '';
    const selectedPrefillCustomer = customers.find((customer) => customer.id === customerId) || null;
    const email = sourceLead?.homeownerEmail || selectedPrefillCustomer?.email || selectedPrefillCustomer?.billingEmail || '';
    const customerName = selectedPrefillCustomer ? customerDisplayName(selectedPrefillCustomer) : sourceLead?.customerName || sourceServiceStop?.customerName || '';
    const title = sourceLead?.serviceName
      ? `${sourceLead.serviceName} Service Agreement`
      : customerName
        ? `${customerName} Service Agreement`
        : '';
    const description = sourceLead?.serviceDescription || sourceServiceStop?.description || '';

    setForm((current) => ({
      ...current,
      customerId: current.customerId || customerId,
      email: current.email || email,
      serviceLocationIds: current.serviceLocationIds.length
        ? current.serviceLocationIds
        : serviceLocationId ? [serviceLocationId] : [],
      title: current.title || title,
      description: current.description || description,
    }));
    setSourcePrefillApplied(true);
  }, [
    customers,
    queryCustomerId,
    queryServiceLocationId,
    sourceContextLoaded,
    sourceLead,
    sourceLeadId,
    sourcePrefillApplied,
    sourceServiceStop,
    sourceServiceStopId,
  ]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTermsTemplates([]);
      return undefined;
    }

    return listenTermsTemplates(
      recentlySelectedCompany,
      (templates) => {
        setTermsTemplates(templates);
        setForm((current) => ({
          ...current,
          termsTemplateId: current.termsTemplateId || templates[0]?.id || '',
        }));
      },
      (error) => {
        console.error('Unable to load terms templates for agreement', error);
        toast.error('Failed to load terms templates.');
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !form.termsTemplateId) {
      setSelectedTerms([]);
      return undefined;
    }

    let isActive = true;
    setTermsLoading(true);

    getTerms(recentlySelectedCompany, form.termsTemplateId)
      .then((terms) => {
        if (isActive) setSelectedTerms(terms);
      })
      .catch((error) => {
        console.error('Unable to load selected agreement terms', error);
        if (isActive) toast.error('Failed to load selected template terms.');
      })
      .finally(() => {
        if (isActive) setTermsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [form.termsTemplateId, recentlySelectedCompany]);

  const selectedCompanyName = recentlySelectedCompanyName || 'Selected company';
  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId]
  );
  const customerOptions = useMemo(
    () => customers.map((customer) => {
      const name = customerDisplayName(customer);
      const email = customer.email || customer.billingEmail || '';
      const phone = customerPhone(customer);
      const address = customerAddressLine(customer);

      return {
        value: customer.id,
        label: [name, email].filter(Boolean).join(' - '),
        name,
        email,
        phone,
        address,
        searchText: [name, email, phone, address, customer.id].filter(Boolean).join(' '),
      };
    }),
    [customers]
  );
  const selectedCustomerOption = useMemo(
    () => customerOptions.find((option) => option.value === form.customerId) || null,
    [customerOptions, form.customerId]
  );
  const selectedTemplate = useMemo(
    () => termsTemplates.find((template) => template.id === form.termsTemplateId) || null,
    [form.termsTemplateId, termsTemplates]
  );
  const customerLocations = useMemo(() => {
    if (!form.customerId) return [];
    return serviceLocations.filter((location) => location.customerId === form.customerId);
  }, [form.customerId, serviceLocations]);
  const selectedLocations = useMemo(
    () => serviceLocations.filter((location) => form.serviceLocationIds.includes(location.id)),
    [form.serviceLocationIds, serviceLocations]
  );
  const selectedCatalogItem = useMemo(
    () => catalogItems.find((item) => item.id === selectedCatalogItemId) || null,
    [catalogItems, selectedCatalogItemId]
  );
  const termsContent = useMemo(
    () => buildTermsContent(selectedTemplate, selectedTerms),
    [selectedTemplate, selectedTerms]
  );
  const subtotalAmountCents = useMemo(
    () => lineItems.reduce((total, item) => total + (Number(item.totalAmountCents) || 0), 0),
    [lineItems]
  );
  const taxAmountCents = 0;
  const totalAmountCents = subtotalAmountCents + taxAmountCents;

  const handleFieldChange = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateChemicalBillingMode = (value) => {
    setForm((current) => {
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
        includedChemicalIds: keepIncludedSelections ? current.includedChemicalIds : [],
        separatelyBilledChemicalIds: keepSeparatelyBilledSelections ? current.separatelyBilledChemicalIds : [],
      };
    });
  };

  const updateChemicalBillingMixedSelectionMode = (value) => {
    setForm((current) => ({
      ...current,
      chemicalBillingMixedSelectionMode: value,
      includedChemicalIds: value === ChemicalBillingMixedSelectionMode.included
        ? current.includedChemicalIds
        : [],
      separatelyBilledChemicalIds: value === ChemicalBillingMixedSelectionMode.separatelyBilled
        ? current.separatelyBilledChemicalIds
        : [],
    }));
  };

  const handleCustomerChange = (customerId) => {
    const customer = customers.find((item) => item.id === customerId);

    setForm((current) => ({
      ...current,
      customerId,
      email: customer?.email || customer?.billingEmail || '',
      serviceLocationIds: [],
      title: current.title || (customer ? `${customerDisplayName(customer)} Service Agreement` : ''),
    }));
  };

  const formatCustomerOption = (option, meta) => {
    if (meta.context === 'value') {
      return option.name;
    }

    return (
      <div>
        <p className="font-semibold text-slate-900">{option.name}</p>
        <p className="text-xs text-slate-500">
          {[option.email, option.phone, option.address].filter(Boolean).join(' | ') || 'No contact details saved'}
        </p>
      </div>
    );
  };

  const toggleServiceLocation = (locationId) => {
    setForm((current) => {
      const selected = new Set(current.serviceLocationIds);
      if (selected.has(locationId)) {
        selected.delete(locationId);
      } else {
        selected.add(locationId);
      }

      return {
        ...current,
        serviceLocationIds: Array.from(selected),
      };
    });
  };

  const addCatalogLineItem = () => {
    if (!selectedCatalogItem) {
      toast.error('Select a catalog item first.');
      return;
    }

    const quantity = Math.max(Number(selectedCatalogQuantity || selectedCatalogItem.defaultQuantity || 1), 0);

    if (!quantity) {
      toast.error('Quantity must be greater than zero.');
      return;
    }

    const unitAmountCents = Number(selectedCatalogItem.unitAmountCents || 0);
    const lineItem = new SalesInvoiceLineItem({
      catalogItemId: selectedCatalogItem.id,
      sourceType: selectedCatalogItem.sourceType || '',
      sourceId: selectedCatalogItem.sourceId || '',
      name: selectedCatalogItem.name || '',
      description: selectedCatalogItem.description || '',
      quantity,
      unitAmountCents,
      totalAmountCents: Math.round(unitAmountCents * quantity),
      taxable: Boolean(selectedCatalogItem.taxable),
      type: selectedCatalogItem.type || '',
      stripeProductId: selectedCatalogItem.stripeProductId || '',
      stripePriceId: selectedCatalogItem.stripePriceId || '',
      metadata: {
        billingBehavior: selectedCatalogItem.billingBehavior || SalesCatalogBillingBehavior.oneTime,
        currency: selectedCatalogItem.currency || 'usd',
      },
    });

    setLineItems((current) => [...current, lineItem]);
    setSelectedCatalogQuantity(String(selectedCatalogItem.defaultQuantity || 1));
  };

  const updateLineItemQuantity = (lineItemId, value) => {
    const quantity = Math.max(Number(value || 0), 0);
    setLineItems((current) =>
      current.map((item) => (
        item.id === lineItemId
          ? {
            ...item,
            quantity,
            totalAmountCents: Math.round((Number(item.unitAmountCents) || 0) * quantity),
          }
          : item
      ))
    );
  };

  const removeLineItem = (lineItemId) => {
    setLineItems((current) => current.filter((item) => item.id !== lineItemId));
  };

  const serviceLocationSnapshot = (location) => {
    const address = locationAddress(location);
    return {
      id: location.id,
      nickName: location.nickName || location.name || '',
      streetAddress: address.streetAddress,
      address02: address.address02,
      city: address.city,
      state: address.state,
      zip: address.zip,
    };
  };

  const canSave = Boolean(
    recentlySelectedCompany &&
    form.customerId &&
    form.email &&
    form.serviceLocationIds.length > 0 &&
    form.title.trim() &&
    lineItems.length > 0
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canSave) {
      toast.error('Add a customer, email, service location, title, and at least one line item.');
      return;
    }

    setSaving(true);

    try {
      const agreementSourceType = sourceServiceStopId
        ? SalesAgreementSourceType.serviceAgreementSurvey
        : sourceLeadId
          ? SalesAgreementSourceType.lead
          : SalesAgreementSourceType.manual;
      const agreementSourceId = sourceServiceStopId || sourceLeadId || '';
      const chemicalBillingFields = deriveChemicalBillingFields(form);
      const pnlReportingFields = deriveInternalPnlFields(chemicalBillingFields);
      const agreement = new SalesAgreement({
        companyId: recentlySelectedCompany,
        companyName: selectedCompanyName,
        customerId: form.customerId,
        customerUserId: customerUserId(selectedCustomer),
        relationshipId: customerRelationshipId(selectedCustomer),
        customerCompanyRelationshipId: customerRelationshipId(selectedCustomer),
        customerName: selectedCustomer ? customerDisplayName(selectedCustomer) : '',
        email: form.email.trim(),
        serviceLocationIds: form.serviceLocationIds,
        serviceLocationSnapshots: selectedLocations.map(serviceLocationSnapshot),
        sourceType: agreementSourceType,
        sourceId: agreementSourceId,
        leadId: sourceLeadId || sourceLead?.id || '',
        serviceAgreementEstimateServiceStopId: sourceServiceStopId || '',
        inspectionServiceStopId: sourceServiceStopId || '',
        serviceStopIds: sourceServiceStopId ? [sourceServiceStopId] : [],
        title: form.title.trim(),
        description: form.description.trim(),
        terms: termsContent,
        termsTemplateId: selectedTemplate?.id || '',
        termsTemplateName: selectedTemplate?.name || '',
        termsTemplateDescription: selectedTemplate?.description || '',
        termsList: selectedTerms.map((term) => getTermDescription(term)).filter(Boolean),
        lineItems,
        status: SalesAgreementStatus.draft,
        rateAmountCents: totalAmountCents,
        subtotalAmountCents,
        taxAmountCents,
        totalAmountCents,
        rateType: form.rateType,
        serviceCadence: form.serviceCadence,
        serviceCadenceCount: Number(form.serviceCadenceCount || 1),
        serviceFrequencyLabel: formatServiceFrequency(form),
        billingFrequency: form.billingFrequency,
        billingFrequencyCount: Number(form.billingFrequencyCount || 1),
        paymentTerms: form.paymentTerms,
        invoiceDeliveryMethod: form.invoiceDeliveryMethod,
        ...pnlReportingFields,
        ...chemicalBillingFields,
        startDate: dateFromInput(form.startDate),
        expiresAt: dateFromInput(form.expiresAt),
        atWill: Boolean(form.atWill),
        createdByUserId: activeUserId || dataBaseUser?.id || '',
        emailDelivery: {},
      });

      await saveSalesModel(db, 'agreements', agreement);

      const linkUpdates = [];
      if (sourceLeadId) {
        linkUpdates.push(updateDoc(doc(db, 'homeownerServiceRequests', sourceLeadId), {
          serviceAgreementId: agreement.id,
          serviceAgreementTitle: agreement.title,
          serviceAgreementStatus: agreement.status,
          updatedAt: new Date(),
        }));
      }
      if (sourceServiceStopId) {
        linkUpdates.push(updateDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceStops', sourceServiceStopId), {
          serviceAgreementId: agreement.id,
          serviceAgreementTitle: agreement.title,
          leadId: sourceLeadId || sourceServiceStop?.leadId || '',
        }));
      }

      if (linkUpdates.length) {
        try {
          await Promise.all(linkUpdates);
        } catch (linkError) {
          console.error('Agreement created but source records were not linked', linkError);
          toast.error('Agreement created, but the lead or survey link could not be updated.');
        }
      }

      toast.success('Service agreement draft created.');
      navigate(`/company/sales/agreements/${agreement.id}`);
    } catch (error) {
      console.error('Unable to save service agreement draft', error);
      toast.error('Failed to save service agreement draft.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/company/sales/agreements"
                  className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  &larr; Back to Service Agreements
                </Link>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {selectedCompanyName}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">New Service Agreement</h1>
                <FeatureInfoButton title="How Agreement Drafts Work" align="left">
                  <p>
                    A draft agreement stores the customer, service location, catalog line items, pricing, and copied
                    terms as a stable snapshot before anything is emailed.
                  </p>
                  <p>
                    The next send-email step can use this snapshot with the SendGrid service agreement template.
                    Stripe billing should start after customer acceptance.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Build the customer-facing agreement snapshot before sending or starting billing.
              </p>
            </div>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
          <main className="space-y-6 lg:order-2">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Customer</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="customerId" className="block text-sm font-semibold text-slate-700">
                    Customer
                  </label>
                  <div className="mt-1">
                    <Select
                      inputId="customerId"
                      value={selectedCustomerOption}
                      onChange={(option) => handleCustomerChange(option?.value || '')}
                      options={customerOptions}
                      isClearable
                      isLoading={loading}
                      placeholder={loading ? 'Loading customers...' : 'Search customer by name, email, phone, or address'}
                      noOptionsMessage={() => 'No customers found'}
                      formatOptionLabel={formatCustomerOption}
                      filterOption={(option, inputValue) => (
                        option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                      )}
                      theme={selectTheme}
                      styles={selectStyles}
                    />
                  </div>
                  {selectedCustomerOption && (
                    <p className="mt-2 text-xs text-slate-500">
                      {[selectedCustomerOption.email, selectedCustomerOption.phone, selectedCustomerOption.address]
                        .filter(Boolean)
                        .join(' | ')}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-slate-700">
                    Billing Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(event) => handleFieldChange('email', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="customer@example.com"
                  />
                </div>
              </div>

              <div className="mt-5">
                <p className="block text-sm font-semibold text-slate-700">Service Locations</p>
                <div className="mt-2 grid gap-2">
                  {!form.customerId ? (
                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      Select a customer first.
                    </div>
                  ) : customerLocations.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      No service locations found for this customer.
                    </div>
                  ) : (
                    customerLocations.map((location) => (
                      <label
                        key={location.id}
                        className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm transition hover:border-blue-200 hover:bg-blue-50"
                      >
                        <input
                          type="checkbox"
                          checked={form.serviceLocationIds.includes(location.id)}
                          onChange={() => toggleServiceLocation(location.id)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold text-slate-900">{location.nickName || 'Service Location'}</span>
                          <span className="block text-slate-500">{locationLabel(location)}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Agreement Details</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="title" className="block text-sm font-semibold text-slate-700">
                    Agreement Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    value={form.title}
                    onChange={(event) => handleFieldChange('title', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Monthly Residential Pool Service"
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-semibold text-slate-700">
                    Description
                  </label>
                  <textarea
                    id="description"
                    value={form.description}
                    onChange={(event) => handleFieldChange('description', event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Short customer-facing summary"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Service Schedule</h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="serviceCadence" className="block text-sm font-semibold text-slate-700">
                        Service Frequency
                      </label>
                      <select
                        id="serviceCadence"
                        value={form.serviceCadence}
                        onChange={(event) => handleFieldChange('serviceCadence', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {serviceFrequencyOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="serviceCadenceCount" className="block text-sm font-semibold text-slate-700">
                        Service Count
                      </label>
                      <input
                        id="serviceCadenceCount"
                        type="number"
                        min="1"
                        value={form.serviceCadenceCount}
                        onChange={(event) => handleFieldChange('serviceCadenceCount', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Billing Schedule</h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="billingFrequency" className="block text-sm font-semibold text-slate-700">
                        Billing Frequency
                      </label>
                      <select
                        id="billingFrequency"
                        value={form.billingFrequency}
                        onChange={(event) => handleFieldChange('billingFrequency', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {billingFrequencyOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="billingFrequencyCount" className="block text-sm font-semibold text-slate-700">
                        Billing Count
                      </label>
                      <input
                        id="billingFrequencyCount"
                        type="number"
                        min="1"
                        value={form.billingFrequencyCount}
                        onChange={(event) => handleFieldChange('billingFrequencyCount', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div>
                      <label htmlFor="rateType" className="block text-sm font-semibold text-slate-700">
                        Rate Type
                      </label>
                      <select
                        id="rateType"
                        value={form.rateType}
                        onChange={(event) => handleFieldChange('rateType', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="perMonth">Per Month</option>
                        <option value="perVisit">Per Visit</option>
                        <option value="oneTime">One Time</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Chemical Billing</h3>
                    <Link
                      to="/company/readingsAndDosages"
                      className="text-sm font-semibold text-blue-700 hover:text-blue-800"
                    >
                      Manage Dosages
                    </Link>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="chemicalBillingMode" className="block text-sm font-semibold text-slate-700">
                        Billing Treatment
                      </label>
                      <select
                        id="chemicalBillingMode"
                        value={form.chemicalBillingMode}
                        onChange={(event) => updateChemicalBillingMode(event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {chemicalBillingModeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="chemicalBillingNotes" className="block text-sm font-semibold text-slate-700">
                        Chemical Billing Notes
                      </label>
                      <input
                        id="chemicalBillingNotes"
                        type="text"
                        value={form.chemicalBillingNotes}
                        onChange={(event) => handleFieldChange('chemicalBillingNotes', event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="tabs supplied by customer, phosphate billed separately"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    {form.chemicalBillingMode === SalesAgreementChemicalBillingMode.includedAll && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        All dosage templates are included in service. No dosage selections are needed.
                      </div>
                    )}

                    {form.chemicalBillingMode === SalesAgreementChemicalBillingMode.billAllSeparately && (
                      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                        All dosage templates are billed separately. No dosage selections are needed.
                      </div>
                    )}

                    {form.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed && (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-md border border-slate-200 bg-white p-3">
                          <label htmlFor="chemicalBillingMixedSelectionMode" className="block text-sm font-semibold text-slate-700">
                            Mixed Billing Selection
                          </label>
                          <select
                            id="chemicalBillingMixedSelectionMode"
                            value={form.chemicalBillingMixedSelectionMode}
                            onChange={(event) => updateChemicalBillingMixedSelectionMode(event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            {mixedChemicalBillingSelectionOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>

                        {form.chemicalBillingMixedSelectionMode === ChemicalBillingMixedSelectionMode.included ? (
                          <ChemicalDosagePicker
                            id="includedChemicalIds"
                            label="Included Dosages"
                            selectedIds={form.includedChemicalIds}
                            dosageTemplates={dosageTemplates}
                            loading={loadingDosageTemplates}
                            onChange={(nextIds) => handleFieldChange('includedChemicalIds', nextIds)}
                          />
                        ) : (
                          <ChemicalDosagePicker
                            id="separatelyBilledChemicalIds"
                            label="Excluded / Separately Billed Dosages"
                            selectedIds={form.separatelyBilledChemicalIds}
                            dosageTemplates={dosageTemplates}
                            loading={loadingDosageTemplates}
                            onChange={(nextIds) => handleFieldChange('separatelyBilledChemicalIds', nextIds)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="startDate" className="block text-sm font-semibold text-slate-700">
                      Start Date
                    </label>
                    <input
                      id="startDate"
                      type="date"
                      value={form.startDate}
                      onChange={(event) => handleFieldChange('startDate', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label htmlFor="expiresAt" className="block text-sm font-semibold text-slate-700">
                      Review By
                    </label>
                    <input
                      id="expiresAt"
                      type="date"
                      value={form.expiresAt}
                      onChange={(event) => handleFieldChange('expiresAt', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label htmlFor="paymentTerms" className="block text-sm font-semibold text-slate-700">
                      Payment Terms
                    </label>
                    <select
                      id="paymentTerms"
                      value={form.paymentTerms}
                      onChange={(event) => handleFieldChange('paymentTerms', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="dueOnReceipt">Due On Receipt</option>
                      <option value="net7">Net 7</option>
                      <option value="net15">Net 15</option>
                      <option value="net30">Net 30</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Catalog Line Items</h2>
                <Link to="/company/sales/catalog-items" className="text-sm font-semibold text-blue-700 hover:text-blue-800">
                  Manage catalog
                </Link>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                <select
                  value={selectedCatalogItemId}
                  onChange={(event) => setSelectedCatalogItemId(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">{catalogItems.length ? 'Select catalog item' : 'No catalog items yet'}</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {formatCurrency(item.unitAmountCents)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={selectedCatalogQuantity}
                  onChange={(event) => setSelectedCatalogQuantity(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  aria-label="Line item quantity"
                />
                <button
                  type="button"
                  onClick={addCatalogLineItem}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  <FaPlus className="text-xs" />
                  Add
                </button>
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                {lineItems.length === 0 ? (
                  <div className="bg-slate-50 p-5 text-sm text-slate-500">
                    Add catalog items to build the customer-facing price snapshot.
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3">Qty</th>
                        <th className="px-4 py-3">Unit</th>
                        <th className="px-4 py-3">Total</th>
                        <th className="px-4 py-3" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {lineItems.map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{item.name || item.description}</p>
                            {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.quantity}
                              onChange={(event) => updateLineItemQuantity(item.id, event.target.value)}
                              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                              aria-label={`Quantity for ${item.name}`}
                            />
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatCurrency(item.unitAmountCents)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(item.totalAmountCents)}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeLineItem(item.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-slate-50 hover:text-rose-600"
                              aria-label={`Remove ${item.name}`}
                            >
                              <FaTimes className="text-xs" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Terms Snapshot</h2>
                <FaFileSignature className="text-slate-400" />
              </div>
              <div className="mt-4">
                <label htmlFor="termsTemplateId" className="block text-sm font-semibold text-slate-700">
                  Terms Template
                </label>
                <select
                  id="termsTemplateId"
                  value={form.termsTemplateId}
                  onChange={(event) => handleFieldChange('termsTemplateId', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">No template selected</option>
                  {termsTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </div>

              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {termsLoading ? (
                  <p className="text-slate-500">Loading terms...</p>
                ) : termsContent ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto whitespace-pre-wrap">
                    {termsContent}
                  </div>
                ) : (
                  <p className="text-slate-500">No terms selected. You can still save a draft, but the agreement should have terms before sending.</p>
                )}
              </div>

              <Link
                to="/company/settings/terms-templates"
                className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800"
              >
                Manage terms templates
              </Link>
            </section>
          </main>

          <aside className="space-y-6 lg:order-1">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Draft Summary</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Customer</dt>
                  <dd className="font-semibold text-slate-900">{selectedCustomer ? customerDisplayName(selectedCustomer) : 'Not selected'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Locations</dt>
                  <dd className="font-semibold text-slate-900">{form.serviceLocationIds.length}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Line Items</dt>
                  <dd className="font-semibold text-slate-900">{lineItems.length}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Service Frequency</dt>
                  <dd className="font-semibold text-slate-900">{formatServiceFrequency(form)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Billing Frequency</dt>
                  <dd className="font-semibold text-slate-900">{formatBillingFrequency(form)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(subtotalAmountCents)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Tax</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(taxAmountCents)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 text-base">
                  <dt className="font-semibold text-slate-700">Total</dt>
                  <dd className="font-bold text-slate-950">{formatCurrency(totalAmountCents)}</dd>
                </div>
              </dl>

              <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This saves a draft only. Sending the SendGrid agreement email will be wired after the review and acceptance flow exists.
              </div>

              <button
                type="submit"
                disabled={!canSave || saving}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaSave className="text-xs" />
                {saving ? 'Saving Draft...' : 'Save Agreement Draft'}
              </button>
            </section>
          </aside>
        </form>
      </div>
    </div>
  );
};

export default CreateSalesAgreement;
