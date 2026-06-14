import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Select from 'react-select';
import { collection, onSnapshot } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaFileSignature,
  FaPlus,
  FaSave,
  FaTimes,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import {
  SalesAgreement,
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

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

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

const CreateSalesAgreement = () => {
  const navigate = useNavigate();
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

  const [customers, setCustomers] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [selectedTerms, setSelectedTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [termsLoading, setTermsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [selectedCatalogQuantity, setSelectedCatalogQuantity] = useState('1');
  const [lineItems, setLineItems] = useState([]);

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
        sourceType: SalesAgreementSourceType.manual,
        sourceId: '',
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
        startDate: dateFromInput(form.startDate),
        expiresAt: dateFromInput(form.expiresAt),
        atWill: Boolean(form.atWill),
        createdByUserId: activeUserId || dataBaseUser?.id || '',
        emailDelivery: {},
      });

      await saveSalesModel(db, 'agreements', agreement);
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
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
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

            <Link
              to="/company/sales"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <FaArrowLeft className="text-xs" />
              Sales
            </Link>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
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
          </div>

          <aside className="space-y-6">
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
