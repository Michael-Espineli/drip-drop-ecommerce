import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Select from 'react-select';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaFileInvoiceDollar,
  FaPlus,
  FaSave,
  FaTimes,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import {
  SalesCatalogBillingBehavior,
  SalesInvoice,
  SalesInvoiceDeliveryMethod,
  SalesInvoiceLineItem,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../../../utils/models/Sales';
import { salesCatalogCollection, saveSalesModel } from '../../../utils/sales/salesFirestore';
import FeatureInfoButton from '../../../components/FeatureInfoButton';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const moneyInputToCents = (value) => Math.round((Number(value) || 0) * 100);

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

const toInputDate = (date) => {
  if (!date) return '';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toISOString().split('T')[0];
};

const dateFromInput = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
};

const defaultDueDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return toInputDate(date);
};

const defaultInvoiceNumber = () => {
  const year = new Date().getFullYear();
  return `INV-${year}-${String(Date.now()).slice(-6)}`;
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

const blankCustomLine = () => ({
  name: '',
  description: '',
  quantity: '1',
  unitAmount: '0.00',
});

const CreateSalesInvoice = () => {
  const navigate = useNavigate();
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    stripeConnectedAccountId,
    currentUser,
    user,
    currentuser,
    dataBaseUser,
  } = useContext(Context);
  const activeUser = currentUser || user || currentuser || {};
  const activeUserId = activeUser?.uid || activeUser?.id || dataBaseUser?.id || '';

  const [customers, setCustomers] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [selectedCatalogQuantity, setSelectedCatalogQuantity] = useState('1');
  const [customLine, setCustomLine] = useState(blankCustomLine);
  const [lineItems, setLineItems] = useState([]);
  const [form, setForm] = useState({
    invoiceNumber: defaultInvoiceNumber(),
    customerId: '',
    email: '',
    serviceLocationIds: [],
    status: SalesInvoiceStatus.draft,
    deliveryMethod: SalesInvoiceDeliveryMethod.email,
    dueDate: defaultDueDate(),
    discountAmount: '0.00',
    taxAmount: '0.00',
    memo: '',
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
          console.error('Unable to load customers for sales invoice', error);
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
          console.error('Unable to load service locations for sales invoice', error);
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
          console.error('Unable to load sales catalog for invoice', error);
          toast.error('Failed to load sales catalog.');
          setLoading(false);
        }
      ),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [recentlySelectedCompany]);

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

  const totals = useMemo(() => {
    const subtotalAmountCents = lineItems.reduce((total, item) => total + (Number(item.totalAmountCents) || 0), 0);
    const discountAmountCents = Math.max(moneyInputToCents(form.discountAmount), 0);
    const taxAmountCents = Math.max(moneyInputToCents(form.taxAmount), 0);
    const totalAmountCents = Math.max(subtotalAmountCents - discountAmountCents + taxAmountCents, 0);

    return {
      subtotalAmountCents,
      discountAmountCents,
      taxAmountCents,
      totalAmountCents,
    };
  }, [form.discountAmount, form.taxAmount, lineItems]);

  const handleFieldChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCustomerChange = (customerId) => {
    const customer = customers.find((item) => item.id === customerId);

    setForm((current) => ({
      ...current,
      customerId,
      email: customer?.email || customer?.billingEmail || '',
      serviceLocationIds: [],
    }));
  };

  const formatCustomerOption = (option, meta) => {
    if (meta.context === 'value') return option.name;

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
      if (selected.has(locationId)) selected.delete(locationId);
      else selected.add(locationId);

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

  const addCustomLineItem = () => {
    const name = customLine.name.trim();
    const quantity = Math.max(Number(customLine.quantity || 0), 0);
    const unitAmountCents = moneyInputToCents(customLine.unitAmount);

    if (!name || !quantity) {
      toast.error('Add a name and quantity for the custom line.');
      return;
    }

    const lineItem = new SalesInvoiceLineItem({
      sourceType: 'manual',
      name,
      description: customLine.description.trim(),
      quantity,
      unitAmountCents,
      totalAmountCents: Math.round(unitAmountCents * quantity),
      type: 'manual',
    });

    setLineItems((current) => [...current, lineItem]);
    setCustomLine(blankCustomLine());
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

  const canSave = Boolean(
    recentlySelectedCompany &&
    form.customerId &&
    form.email.trim() &&
    form.invoiceNumber.trim() &&
    lineItems.length > 0
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canSave) {
      toast.error('Add a customer, email, invoice number, and at least one line item.');
      return;
    }

    setSaving(true);

    try {
      const invoice = new SalesInvoice({
        companyId: recentlySelectedCompany,
        companyName: selectedCompanyName,
        customerId: form.customerId,
        customerUserId: selectedCustomer?.customerUserId || selectedCustomer?.userId || null,
        customerName: selectedCustomer ? customerDisplayName(selectedCustomer) : '',
        email: form.email.trim(),
        serviceLocationIds: form.serviceLocationIds,
        serviceLocationSnapshots: selectedLocations.map(serviceLocationSnapshot),
        stripeConnectedAccountId: stripeConnectedAccountId || '',
        invoiceNumber: form.invoiceNumber.trim(),
        type: SalesInvoiceType.manual,
        status: form.status,
        deliveryMethod: form.deliveryMethod,
        currency: 'usd',
        dueDate: dateFromInput(form.dueDate),
        subtotalAmountCents: totals.subtotalAmountCents,
        discountAmountCents: totals.discountAmountCents,
        taxAmountCents: totals.taxAmountCents,
        totalAmountCents: totals.totalAmountCents,
        amountPaidCents: 0,
        amountDueCents: totals.totalAmountCents,
        writeOffAmountCents: 0,
        memo: form.memo.trim(),
        lineItems,
      });

      await saveSalesModel(db, 'invoices', {
        ...invoice.toFirestore(),
        createdByUserId: activeUserId,
        sourceType: 'manual',
      });

      toast.success('Invoice created.');
      navigate(`/company/sales/invoices/${invoice.id}`);
    } catch (error) {
      console.error('Unable to save sales invoice', error);
      toast.error('Failed to save invoice.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link to="/company/sales/invoices" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
                <FaArrowLeft className="text-xs" />
                Invoices
              </Link>
              <div className="mt-3 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">New Invoice</h1>
                <FeatureInfoButton title="How Manual Invoices Work" align="left">
                  <p>
                    Manual invoices use the same salesInvoices collection as invoices created from jobs and agreements.
                    Catalog items keep pricing reusable, and custom lines handle one-off charges.
                  </p>
                  <p>
                    Sending the invoice emails the customer portal invoice link, while manual payments can still be
                    recorded for cash, check, card terminal, or bank transfer.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {selectedCompanyName} - create a one-time customer invoice.
              </p>
            </div>

            <button
              type="submit"
              form="new-sales-invoice-form"
              disabled={!canSave || saving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaSave className="text-xs" />
              {saving ? 'Saving...' : 'Save Invoice'}
            </button>
          </div>
        </section>

        <form id="new-sales-invoice-form" onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Customer</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                </div>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Billing Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => handleFieldChange('email', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="customer@example.com"
                  />
                </label>
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
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Line Items</h2>
                <Link to="/company/sales/catalog-items" className="text-sm font-semibold text-blue-700 hover:text-blue-800">
                  Manage catalog
                </Link>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                <select
                  value={selectedCatalogItemId}
                  onChange={(event) => setSelectedCatalogItemId(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">{catalogItems.length ? 'Select catalog item' : 'No catalog items yet'}</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} - {formatCurrency(item.unitAmountCents)}
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
                  onClick={addCatalogLineItem}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  <FaPlus className="text-xs" />
                  Add
                </button>
              </div>

              <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-900">Custom line</p>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_110px_130px_auto]">
                  <input
                    value={customLine.name}
                    onChange={(event) => setCustomLine((current) => ({ ...current, name: event.target.value }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Item name"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customLine.quantity}
                    onChange={(event) => setCustomLine((current) => ({ ...current, quantity: event.target.value }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    aria-label="Custom line quantity"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customLine.unitAmount}
                    onChange={(event) => setCustomLine((current) => ({ ...current, unitAmount: event.target.value }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    aria-label="Custom line unit amount"
                  />
                  <button
                    type="button"
                    onClick={addCustomLineItem}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FaPlus className="text-xs" />
                    Add
                  </button>
                </div>
                <textarea
                  value={customLine.description}
                  onChange={(event) => setCustomLine((current) => ({ ...current, description: event.target.value }))}
                  className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Optional description"
                  rows={2}
                />
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                {lineItems.length === 0 ? (
                  <div className="bg-slate-50 p-5 text-sm text-slate-500">
                    Add catalog or custom line items to build the invoice.
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
                <h2 className="text-lg font-bold text-slate-950">Invoice Setup</h2>
                <FaFileInvoiceDollar className="text-slate-400" />
              </div>
              <div className="mt-4 space-y-4">
                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Invoice Number</span>
                  <input
                    value={form.invoiceNumber}
                    onChange={(event) => handleFieldChange('invoiceNumber', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Status</span>
                  <select
                    value={form.status}
                    onChange={(event) => handleFieldChange('status', event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {[SalesInvoiceStatus.draft, SalesInvoiceStatus.open].map((status) => (
                      <option key={status} value={status}>{status === 'draft' ? 'Draft' : 'Open'}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Delivery Method</span>
                  <select
                    value={form.deliveryMethod}
                    onChange={(event) => handleFieldChange('deliveryMethod', event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {Object.values(SalesInvoiceDeliveryMethod).map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Due Date</span>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(event) => handleFieldChange('dueDate', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Discount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discountAmount}
                    onChange={(event) => handleFieldChange('discountAmount', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Tax</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.taxAmount}
                    onChange={(event) => handleFieldChange('taxAmount', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700">Memo</span>
                  <textarea
                    value={form.memo}
                    onChange={(event) => handleFieldChange('memo', event.target.value)}
                    className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Optional customer-facing memo"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Totals</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(totals.subtotalAmountCents)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Discount</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(totals.discountAmountCents)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Tax</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(totals.taxAmountCents)}</dd>
                </div>
                <div className="border-t border-slate-200 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Amount Due</dt>
                    <dd className="text-2xl font-bold text-slate-950">{formatCurrency(totals.totalAmountCents)}</dd>
                  </div>
                </div>
              </dl>
            </section>
          </aside>
        </form>
      </div>
    </div>
  );
};

export default CreateSalesInvoice;
