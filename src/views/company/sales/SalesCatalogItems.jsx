import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  FaArchive,
  FaArrowLeft,
  FaCheckCircle,
  FaEdit,
  FaPlus,
  FaSave,
  FaTags,
  FaTimes,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import {
  SalesCatalogBillingBehavior,
  SalesCatalogItem,
  SalesCatalogItemType,
  SalesCatalogSourceType,
} from '../../../utils/models/Sales';
import {
  salesCatalogCollection,
  saveSalesCatalogItem,
} from '../../../utils/sales/salesFirestore';
import FeatureInfoButton from '../../../components/FeatureInfoButton';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const dollarsToCents = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const centsToDollarsInput = (value) => {
  const amount = Number(value || 0);
  return amount ? (amount / 100).toFixed(2) : '';
};

const initialForm = {
  name: '',
  description: '',
  type: SalesCatalogItemType.service,
  billingBehavior: SalesCatalogBillingBehavior.oneTime,
  sourceType: SalesCatalogSourceType.manual,
  sourceId: '',
  unitAmount: '',
  unitCost: '',
  defaultQuantity: '1',
  taxable: false,
  stripeProductId: '',
  stripePriceId: '',
  stripeRecurringInterval: 'month',
  stripeRecurringIntervalCount: '1',
};

const typeOptions = Object.values(SalesCatalogItemType);
const billingBehaviorOptions = Object.values(SalesCatalogBillingBehavior);
const sourceTypeOptions = [
  SalesCatalogSourceType.manual,
  SalesCatalogSourceType.serviceStopType,
  SalesCatalogSourceType.workType,
  SalesCatalogSourceType.databaseItem,
  SalesCatalogSourceType.stripeProductPrice,
];
const recurringIntervalOptions = ['day', 'week', 'month', 'year'];

const sourceTypeLabels = {
  [SalesCatalogSourceType.manual]: 'Manual Item',
  [SalesCatalogSourceType.serviceStopType]: 'Service Stop Type',
  [SalesCatalogSourceType.workType]: 'Work Type',
  [SalesCatalogSourceType.databaseItem]: 'Database Item',
  [SalesCatalogSourceType.stripeProductPrice]: 'Stripe Product / Price',
};

const sourcePickerConfig = {
  [SalesCatalogSourceType.serviceStopType]: {
    label: 'Service Stop Type',
    helper: 'Use this when the catalog item is based on a reusable service stop type.',
  },
  [SalesCatalogSourceType.workType]: {
    label: 'Work Type',
    helper: 'Use this when the catalog item is based on a reusable labor/work type.',
  },
  [SalesCatalogSourceType.databaseItem]: {
    label: 'Database Item',
    helper: 'Use this when the catalog item is based on a company database material or part.',
  },
};

const SalesCatalogItems = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId } = useContext(Context);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingItemId, setEditingItemId] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sourceOptions, setSourceOptions] = useState({
    [SalesCatalogSourceType.serviceStopType]: [],
    [SalesCatalogSourceType.workType]: [],
    [SalesCatalogSourceType.databaseItem]: [],
  });

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setCatalogItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    return onSnapshot(
      salesCatalogCollection(db, recentlySelectedCompany),
      (snapshot) => {
        const items = snapshot.docs
          .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
          .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
        setCatalogItems(items);
        setLoading(false);
      },
      (error) => {
        console.error('Unable to load sales catalog items', error);
        toast.error('Failed to load sales catalog items.');
        setLoading(false);
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setSourceOptions({
        [SalesCatalogSourceType.serviceStopType]: [],
        [SalesCatalogSourceType.workType]: [],
        [SalesCatalogSourceType.databaseItem]: [],
      });
      return undefined;
    }

    const sourceCollections = [
      {
        sourceType: SalesCatalogSourceType.serviceStopType,
        ref: collection(db, 'companies', recentlySelectedCompany, 'companyServiceStopTypes'),
      },
      {
        sourceType: SalesCatalogSourceType.workType,
        ref: collection(db, 'companies', recentlySelectedCompany, 'companyWorkTypes'),
      },
      {
        sourceType: SalesCatalogSourceType.databaseItem,
        ref: collection(db, 'companies', recentlySelectedCompany, 'settings', 'dataBase', 'dataBase'),
      },
    ];

    const unsubscribes = sourceCollections.map(({ sourceType, ref }) =>
      onSnapshot(
        ref,
        (snapshot) => {
          const options = snapshot.docs
            .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
            .filter((item) => item.active !== false && item.archived !== true)
            .sort((left, right) => String(left.name || left.type || '').localeCompare(String(right.name || right.type || '')));

          setSourceOptions((current) => ({
            ...current,
            [sourceType]: options,
          }));
        },
        (error) => {
          console.error(`Unable to load ${sourceType} source options`, error);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [recentlySelectedCompany]);

  const selectedCompanyName = recentlySelectedCompanyName || 'Selected company';

  const activeCatalogItems = useMemo(
    () => catalogItems.filter((item) => item.active !== false),
    [catalogItems]
  );

  const filteredCatalogItems = useMemo(() => {
    if (filterType === 'all') return activeCatalogItems;
    return activeCatalogItems.filter((item) => item.type === filterType);
  }, [activeCatalogItems, filterType]);

  const currentSourceOptions = sourceOptions[form.sourceType] || [];
  const currentSourceConfig = sourcePickerConfig[form.sourceType] || null;

  const summary = useMemo(() => {
    return activeCatalogItems.reduce(
      (totals, item) => {
        totals.total += 1;
        totals[item.billingBehavior] = (totals[item.billingBehavior] || 0) + 1;
        return totals;
      },
      { total: 0 }
    );
  }, [activeCatalogItems]);

  const resetForm = () => {
    setForm(initialForm);
    setEditingItemId('');
  };

  const handleFieldChange = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSourceTypeChange = (value) => {
    setForm((current) => ({
      ...current,
      sourceType: value,
      sourceId: '',
    }));
  };

  const sourceNameFor = (source) => (
    source.name ||
    source.type ||
    source.title ||
    source.serviceStopTypeName ||
    source.sku ||
    source.id
  );

  const centsFromSource = (...values) => {
    const found = values.find((value) => value !== undefined && value !== null && value !== '');
    const amount = Number(found || 0);
    return Number.isFinite(amount) ? amount : 0;
  };

  const handleSourceSelection = (sourceId) => {
    const source = currentSourceOptions.find((item) => item.id === sourceId);

    setForm((current) => {
      if (!source) {
        return {
          ...current,
          sourceId,
        };
      }

      const sourceName = sourceNameFor(source);
      const sourceDescription = source.description || source.notes || source.label || '';
      const unitAmountCents = centsFromSource(
        source.unitAmountCents,
        source.sellPrice,
        source.billingRate,
        source.rate,
        source.price
      );
      const unitCostCents = centsFromSource(
        source.unitCostCents,
        source.cost,
        source.rate,
        source.unitCost
      );

      return {
        ...current,
        sourceId,
        name: current.name || sourceName,
        description: current.description || sourceDescription,
        unitAmount: current.unitAmount || centsToDollarsInput(unitAmountCents),
        unitCost: current.unitCost || centsToDollarsInput(unitCostCents),
      };
    });
  };

  const handleEdit = (item) => {
    setEditingItemId(item.id);
    setForm({
      name: item.name || '',
      description: item.description || '',
      type: item.type || SalesCatalogItemType.service,
      billingBehavior: item.billingBehavior || SalesCatalogBillingBehavior.oneTime,
      sourceType: item.sourceType || SalesCatalogSourceType.manual,
      sourceId: item.sourceId || '',
      unitAmount: centsToDollarsInput(item.unitAmountCents),
      unitCost: centsToDollarsInput(item.unitCostCents),
      defaultQuantity: String(item.defaultQuantity || 1),
      taxable: Boolean(item.taxable),
      stripeProductId: item.stripeProductId || '',
      stripePriceId: item.stripePriceId || '',
      stripeRecurringInterval: item.stripeRecurringInterval || 'month',
      stripeRecurringIntervalCount: String(item.stripeRecurringIntervalCount || 1),
    });
  };

  const buildCatalogItem = () => new SalesCatalogItem({
    id: editingItemId || undefined,
    companyId: recentlySelectedCompany,
    name: form.name.trim(),
    description: form.description.trim(),
    type: form.type,
    billingBehavior: form.billingBehavior,
    sourceType: form.sourceType,
    sourceId:
      form.sourceType === SalesCatalogSourceType.stripeProductPrice
        ? form.stripePriceId.trim() || form.stripeProductId.trim()
        : form.sourceId.trim(),
    unitAmountCents: dollarsToCents(form.unitAmount),
    unitCostCents: dollarsToCents(form.unitCost),
    defaultQuantity: Number(form.defaultQuantity || 1),
    taxable: Boolean(form.taxable),
    active: true,
    currency: 'usd',
    stripeConnectedAccountId,
    stripeProductId: form.stripeProductId.trim(),
    stripePriceId: form.stripePriceId.trim(),
    stripeRecurringInterval:
      form.billingBehavior === SalesCatalogBillingBehavior.recurring ? form.stripeRecurringInterval : '',
    stripeRecurringIntervalCount:
      form.billingBehavior === SalesCatalogBillingBehavior.recurring
        ? Number(form.stripeRecurringIntervalCount || 1)
        : 1,
  });

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany) {
      toast.error('Select a company before creating catalog items.');
      return;
    }

    if (!form.name.trim()) {
      toast.error('Catalog item name is required.');
      return;
    }

    setSaving(true);

    try {
      const item = buildCatalogItem();
      await saveSalesCatalogItem(db, recentlySelectedCompany, item);
      toast.success(editingItemId ? 'Catalog item updated.' : 'Catalog item created.');
      resetForm();
    } catch (error) {
      console.error('Unable to save sales catalog item', error);
      toast.error('Failed to save sales catalog item.');
    } finally {
      setSaving(false);
    }
  };

  const archiveItem = async (item) => {
    if (!window.confirm(`Archive ${item.name}?`)) return;

    try {
      await saveSalesCatalogItem(
        db,
        recentlySelectedCompany,
        {
          ...item,
          active: false,
        },
      );
      toast.success('Catalog item archived.');
      if (editingItemId === item.id) resetForm();
    } catch (error) {
      console.error('Unable to archive sales catalog item', error);
      toast.error('Failed to archive catalog item.');
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
                <h1 className="text-3xl font-bold text-slate-950">Sales Catalog Items</h1>
                <FeatureInfoButton title="How Catalog Items Work" align="left">
                  <p>
                    Catalog items are reusable pricing building blocks owned by the pool company. They can represent
                    labor, services, materials, fees, discounts, taxes, or recurring service offerings.
                  </p>
                  <p>
                    Custom job estimates use these app-owned records first. Stripe product and price ids are optional
                    references for reusable subscription pricing, not required for one-off job estimates.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Company-owned pricing building blocks for job estimates, service agreements, invoices, and future Stripe handoff.
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
              <Link
                to="/company/settings/terms-templates"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Terms Templates
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Items</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">One-Time</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{summary[SalesCatalogBillingBehavior.oneTime] || 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recurring</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{summary[SalesCatalogBillingBehavior.recurring] || 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual Only</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{summary[SalesCatalogBillingBehavior.manualOnly] || 0}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-950">
                  {editingItemId ? 'Edit Catalog Item' : 'Create Catalog Item'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Use prices in dollars. DripDrop stores them in cents.
                </p>
              </div>
              <span className="rounded-md bg-blue-50 p-2 text-blue-700">
                <FaTags />
              </span>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="catalogName" className="block text-sm font-semibold text-slate-700">
                  Name
                </label>
                <input
                  id="catalogName"
                  type="text"
                  value={form.name}
                  onChange={(event) => handleFieldChange('name', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Weekly residential service"
                  required
                />
              </div>

              <div>
                <label htmlFor="catalogDescription" className="block text-sm font-semibold text-slate-700">
                  Description
                </label>
                <textarea
                  id="catalogDescription"
                  value={form.description}
                  onChange={(event) => handleFieldChange('description', event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Customer-facing notes for estimates and invoices"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="catalogType" className="block text-sm font-semibold text-slate-700">
                    Type
                  </label>
                  <select
                    id="catalogType"
                    value={form.type}
                    onChange={(event) => handleFieldChange('type', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {typeOptions.map((option) => (
                      <option key={option} value={option}>{labelize(option)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="billingBehavior" className="block text-sm font-semibold text-slate-700">
                    Billing
                  </label>
                  <select
                    id="billingBehavior"
                    value={form.billingBehavior}
                    onChange={(event) => handleFieldChange('billingBehavior', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {billingBehaviorOptions.map((option) => (
                      <option key={option} value={option}>{labelize(option)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="unitAmount" className="block text-sm font-semibold text-slate-700">
                    Customer Price
                  </label>
                  <input
                    id="unitAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unitAmount}
                    onChange={(event) => handleFieldChange('unitAmount', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <label htmlFor="unitCost" className="block text-sm font-semibold text-slate-700">
                    Internal Cost
                  </label>
                  <input
                    id="unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unitCost}
                    onChange={(event) => handleFieldChange('unitCost', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="defaultQuantity" className="block text-sm font-semibold text-slate-700">
                    Default Qty
                  </label>
                  <input
                    id="defaultQuantity"
                    type="number"
                    min="0"
                    step="1"
                    value={form.defaultQuantity}
                    onChange={(event) => handleFieldChange('defaultQuantity', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <label className="mt-6 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.taxable}
                    onChange={(event) => handleFieldChange('taxable', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Taxable
                </label>
              </div>

              <div className="grid gap-3">
                <div>
                  <label htmlFor="sourceType" className="block text-sm font-semibold text-slate-700">
                    Source Type
                  </label>
                  <select
                    id="sourceType"
                    value={form.sourceType}
                    onChange={(event) => handleSourceTypeChange(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {sourceTypeOptions.map((option) => (
                      <option key={option} value={option}>{sourceTypeLabels[option] || labelize(option)}</option>
                    ))}
                  </select>
                </div>

                {currentSourceConfig && (
                  <div>
                    <label htmlFor="sourcePicker" className="block text-sm font-semibold text-slate-700">
                      {currentSourceConfig.label}
                    </label>
                    <select
                      id="sourcePicker"
                      value={form.sourceId}
                      onChange={(event) => handleSourceSelection(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="">
                        {currentSourceOptions.length
                          ? `Select ${currentSourceConfig.label}`
                          : `No ${currentSourceConfig.label.toLowerCase()} records found`}
                      </option>
                      {currentSourceOptions.map((source) => (
                        <option key={source.id} value={source.id}>
                          {sourceNameFor(source)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">{currentSourceConfig.helper}</p>
                  </div>
                )}

                {form.sourceType === SalesCatalogSourceType.manual && (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    Manual catalog items are not tied to another record. Use this for custom fees, discounts,
                    package pricing, and service descriptions that only live in Sales.
                  </p>
                )}

                {form.sourceType === SalesCatalogSourceType.stripeProductPrice && (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    Add the Stripe Product and Price ids below. The Sales item stays company-owned in DripDrop,
                    and Stripe ids are stored as references for billing handoff.
                  </p>
                )}
              </div>

              {form.billingBehavior === SalesCatalogBillingBehavior.recurring && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="recurringInterval" className="block text-sm font-semibold text-slate-700">
                      Recurs Every
                    </label>
                    <select
                      id="recurringInterval"
                      value={form.stripeRecurringInterval}
                      onChange={(event) => handleFieldChange('stripeRecurringInterval', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {recurringIntervalOptions.map((option) => (
                        <option key={option} value={option}>{labelize(option)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="recurringCount" className="block text-sm font-semibold text-slate-700">
                      Interval Count
                    </label>
                    <input
                      id="recurringCount"
                      type="number"
                      min="1"
                      step="1"
                      value={form.stripeRecurringIntervalCount}
                      onChange={(event) => handleFieldChange('stripeRecurringIntervalCount', event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">Stripe References</p>
                <p className="mt-1 text-xs text-slate-500">
                  Optional for now. Use these when a reusable Stripe Product and Price already exist.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    value={form.stripeProductId}
                    onChange={(event) => handleFieldChange('stripeProductId', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="prod_..."
                  />
                  <input
                    type="text"
                    value={form.stripePriceId}
                    onChange={(event) => handleFieldChange('stripePriceId', event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="price_..."
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                {editingItemId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FaTimes className="text-xs" />
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {editingItemId ? <FaSave className="text-xs" /> : <FaPlus className="text-xs" />}
                  {saving ? 'Saving...' : editingItemId ? 'Save Item' : 'Create Item'}
                </button>
              </div>
            </div>
          </form>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Catalog</h2>
                <p className="mt-1 text-sm text-slate-500">Reusable items available to estimates and billing.</p>
              </div>
              <select
                value={filterType}
                onChange={(event) => setFilterType(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All Types</option>
                {typeOptions.map((option) => (
                  <option key={option} value={option}>{labelize(option)}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="p-5 text-sm text-slate-500">Loading catalog items...</div>
            ) : filteredCatalogItems.length === 0 ? (
              <div className="p-8 text-center">
                <FaTags className="mx-auto text-3xl text-slate-300" />
                <p className="mt-3 font-semibold text-slate-800">No catalog items yet</p>
                <p className="mt-1 text-sm text-slate-500">Create services, labor, materials, fees, discounts, and recurring offerings here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Billing</th>
                      <th className="px-5 py-3">Price</th>
                      <th className="px-5 py-3">Stripe</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredCatalogItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="mt-1 max-w-md text-sm text-slate-500">{item.description || 'No description'}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-600">{labelize(item.type)}</td>
                        <td className="px-5 py-4 text-slate-600">
                          <div className="flex flex-col gap-1">
                            <span>{labelize(item.billingBehavior)}</span>
                            {item.billingBehavior === SalesCatalogBillingBehavior.recurring && (
                              <span className="text-xs text-slate-400">
                                Every {item.stripeRecurringIntervalCount || 1} {item.stripeRecurringInterval || 'month'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900">{formatCurrency(item.unitAmountCents)}</p>
                          <p className="mt-1 text-xs text-slate-500">Cost {formatCurrency(item.unitCostCents)}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {item.stripeProductId || item.stripePriceId ? (
                            <div className="space-y-1 text-xs">
                              {item.stripeProductId && <p className="break-all">{item.stripeProductId}</p>}
                              {item.stripePriceId && <p className="break-all">{item.stripePriceId}</p>}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400">
                              <FaCheckCircle className="text-xs" />
                              App only
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleEdit(item)}
                              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <FaEdit />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => archiveItem(item)}
                              className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                            >
                              <FaArchive />
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SalesCatalogItems;
