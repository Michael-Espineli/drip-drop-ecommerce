import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, getDocs, onSnapshot, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import Select from 'react-select';
import {
  FaArchive,
  FaArrowLeft,
  FaCheckCircle,
  FaEdit,
  FaEye,
  FaPlus,
  FaSave,
  FaTags,
  FaTimes,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
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
import { appConfirm } from '../../../utils/appDialog';
import { jobTaskTypeOptionsFromDocs } from '../../../utils/jobTaskTypes';

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

const catalogTypeLabel = (value) => {
  const labels = {
    [SalesCatalogItemType.service]: 'Service',
    [SalesCatalogItemType.recurringService]: 'Recurring Service',
    [SalesCatalogItemType.labor]: 'Service Labor',
    [SalesCatalogItemType.fee]: 'Fee',
    [SalesCatalogItemType.discount]: 'Discount',
    [SalesCatalogItemType.tax]: 'Tax',
    [SalesCatalogItemType.manual]: 'Custom Service',
  };

  return labels[value] || labelize(value);
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

const minutesToLabel = (minutes) => {
  const value = Number(minutes || 0);
  if (!Number.isFinite(value) || value <= 0) return 'No time set';
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
};

const emptyTaskTemplate = () => ({
  id: `service_task_template_${uuidv4()}`,
  name: '',
  type: 'General',
  description: '',
  estimatedMinutes: '',
  laborCost: '',
  billingLaborPrice: '',
  customerApprovalRequired: false,
});

const taskTemplatesForItem = (item = {}) => {
  const templates =
    item.metadata?.taskTemplates ||
    item.metadata?.tasks ||
    item.taskTemplates ||
    [];

  return Array.isArray(templates) ? templates.filter(Boolean) : [];
};

const templateCentsToInput = (template = {}, ...fields) => {
  const found = fields
    .map((field) => template[field])
    .find((value) => value !== undefined && value !== null && value !== '');
  return centsToDollarsInput(found);
};

const templateToForm = (template = {}) => ({
  id: template.id || template.templateId || `service_task_template_${uuidv4()}`,
  name: template.name || template.title || template.description || '',
  type: template.type || template.taskType || template.taskTypeName || 'General',
  description: template.description || '',
  estimatedMinutes: String(
    template.estimatedMinutes ??
    template.estimatedTime ??
    template.minutes ??
    template.durationMinutes ??
    ''
  ),
  laborCost: templateCentsToInput(
    template,
    'laborCostCents',
    'contractRateCents',
    'contractedRateCents',
    'contractedRate',
    'costCents'
  ),
  billingLaborPrice: templateCentsToInput(
    template,
    'billingLaborPriceCents',
    'unitAmountCents',
    'priceCents',
    'rateCents'
  ),
  customerApprovalRequired: Boolean(template.customerApprovalRequired || template.customerApproval),
});

const normalizeTaskTemplatesForSave = (templates = []) => (
  templates
    .map((template) => {
      const name = String(template.name || '').trim();
      if (!name) return null;
      const estimatedMinutes = Number(template.estimatedMinutes || 0);

      return {
        id: template.id || `service_task_template_${uuidv4()}`,
        name,
        title: name,
        type: template.type || 'General',
        taskType: template.type || 'General',
        description: String(template.description || '').trim(),
        estimatedMinutes: Number.isFinite(estimatedMinutes) ? Math.max(estimatedMinutes, 0) : 0,
        laborCostCents: dollarsToCents(template.laborCost),
        billingLaborPriceCents: dollarsToCents(template.billingLaborPrice),
        customerApprovalRequired: Boolean(template.customerApprovalRequired),
      };
    })
    .filter(Boolean)
);

const taskTemplateTotals = (templates = []) => (
  templates.reduce(
    (totals, template) => {
      totals.minutes += Number(template.estimatedMinutes || template.estimatedTime || 0) || 0;
      totals.laborCostCents += Number(template.laborCostCents || template.contractedRate || 0) || 0;
      totals.billingLaborPriceCents += Number(template.billingLaborPriceCents || 0) || 0;
      return totals;
    },
    { minutes: 0, laborCostCents: 0, billingLaborPriceCents: 0 }
  )
);

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
  taskTemplates: [],
};

const typeOptions = [
  SalesCatalogItemType.service,
  SalesCatalogItemType.recurringService,
  SalesCatalogItemType.labor,
  SalesCatalogItemType.fee,
  SalesCatalogItemType.discount,
  SalesCatalogItemType.tax,
  SalesCatalogItemType.manual,
];
const billingBehaviorOptions = Object.values(SalesCatalogBillingBehavior);
const sourceTypeOptions = [
  SalesCatalogSourceType.manual,
  SalesCatalogSourceType.serviceStopType,
  SalesCatalogSourceType.databaseItem,
];
const recurringIntervalOptions = ['day', 'week', 'month', 'year'];

const sourceTypeLabels = {
  [SalesCatalogSourceType.manual]: 'Manual Service',
  [SalesCatalogSourceType.serviceStopType]: 'Pay Type',
  [SalesCatalogSourceType.workType]: 'Pay Type',
  [SalesCatalogSourceType.databaseItem]: 'Database Product',
  [SalesCatalogSourceType.stripeProductPrice]: 'Stripe Product / Price',
};

const sourcePickerConfig = {
  [SalesCatalogSourceType.serviceStopType]: {
    label: 'Pay Type',
    helper: 'Use this when the service is based on a reusable pay type.',
  },
  [SalesCatalogSourceType.workType]: {
    label: 'Pay Type',
    helper: 'Use this when the service is based on a reusable pay type.',
  },
  [SalesCatalogSourceType.databaseItem]: {
    label: 'Database Product',
    helper: 'Use this only when a legacy service price needs to reference a reusable product.',
  },
};

const selectTheme = (theme) => ({
  ...theme,
  borderRadius: 6,
  colors: {
    ...theme.colors,
    primary: '#2563eb',
    primary25: '#dbeafe',
  },
});

const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 38,
    borderColor: state.isFocused ? '#3b82f6' : '#cbd5e1',
    boxShadow: state.isFocused ? '0 0 0 2px #dbeafe' : 'none',
    '&:hover': {
      borderColor: state.isFocused ? '#3b82f6' : '#94a3b8',
    },
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 60,
  }),
};

const SalesCatalogItems = () => {
  const { catalogItemId } = useParams();
  const navigate = useNavigate();
  const { recentlySelectedCompany, stripeConnectedAccountId } = useContext(Context);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingItemId, setEditingItemId] = useState('');
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [taskTypeList, setTaskTypeList] = useState([]);
  const [creatingStripeCatalogItemId, setCreatingStripeCatalogItemId] = useState('');
  const [sourceOptions, setSourceOptions] = useState({
    [SalesCatalogSourceType.serviceStopType]: [],
    [SalesCatalogSourceType.workType]: [],
    [SalesCatalogSourceType.databaseItem]: [],
  });

  useEffect(() => {
    let canceled = false;

    const loadTaskTypes = async () => {
      try {
        const taskTypeSnap = await getDocs(query(collection(db, 'universal', 'settings', 'taskTypes')));
        if (!canceled) setTaskTypeList(jobTaskTypeOptionsFromDocs(taskTypeSnap.docs));
      } catch (error) {
        console.error('Unable to load task type options', error);
        if (!canceled) setTaskTypeList([]);
      }
    };

    loadTaskTypes();

    return () => {
      canceled = true;
    };
  }, []);

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
        console.error('Unable to load service catalog items', error);
        toast.error('Failed to load services.');
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
        ref: collection(db, 'companies', recentlySelectedCompany, 'companyPayTypes'),
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

  const activeCatalogItems = useMemo(
    () => catalogItems.filter((item) => item.active !== false),
    [catalogItems]
  );

  const filteredCatalogItems = useMemo(() => {
    if (filterType === 'all') return activeCatalogItems;
    return activeCatalogItems.filter((item) => item.type === filterType);
  }, [activeCatalogItems, filterType]);

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((item) => item.id === catalogItemId) || null,
    [catalogItemId, catalogItems]
  );

  const currentSourceOptions = sourceOptions[form.sourceType] || [];
  const currentSourceConfig = sourcePickerConfig[form.sourceType] || null;
  const sourceTypeSelectOptions = useMemo(() => {
    if (!form.sourceType || sourceTypeOptions.includes(form.sourceType)) return sourceTypeOptions;
    return [form.sourceType, ...sourceTypeOptions];
  }, [form.sourceType]);
  const taskTypeOptionsFor = (currentValue = '') => {
    const options = (taskTypeList || [])
      .map((option) => ({
        value: option.value || option.name || option.label || '',
        label: option.label || option.name || option.value || '',
      }))
      .filter((option) => option.value);
    const normalizedValue = String(currentValue || '').trim();

    if (normalizedValue && !options.some((option) => option.value === normalizedValue)) {
      return [{ value: normalizedValue, label: normalizedValue }, ...options];
    }

    return options;
  };
  const taskTypeOptionFor = (currentValue = '') => {
    const options = taskTypeOptionsFor(currentValue);
    return options.find((option) => option.value === currentValue) || null;
  };

  const summary = useMemo(() => (
    activeCatalogItems.reduce(
      (totals, item) => {
        totals.total += 1;
        totals[item.billingBehavior] = (totals[item.billingBehavior] || 0) + 1;
        totals.taskTemplates += taskTemplatesForItem(item).length;
        return totals;
      },
      { total: 0, taskTemplates: 0 }
    )
  ), [activeCatalogItems]);

  const resetForm = () => {
    setForm(initialForm);
    setEditingItemId('');
  };

  const closeFormModal = () => {
    if (saving) return;
    setFormModalOpen(false);
    resetForm();
  };

  const openCreateModal = () => {
    resetForm();
    setFormModalOpen(true);
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

  const updateTaskTemplate = (templateId, field, value) => {
    setForm((current) => ({
      ...current,
      taskTemplates: (current.taskTemplates || []).map((template) => (
        template.id === templateId ? { ...template, [field]: value } : template
      )),
    }));
  };

  const addTaskTemplate = () => {
    setForm((current) => ({
      ...current,
      taskTemplates: [...(current.taskTemplates || []), emptyTaskTemplate()],
    }));
  };

  const removeTaskTemplate = (templateId) => {
    setForm((current) => ({
      ...current,
      taskTemplates: (current.taskTemplates || []).filter((template) => template.id !== templateId),
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
      sourceType:
        item.sourceType === SalesCatalogSourceType.workType
          ? SalesCatalogSourceType.serviceStopType
          : item.sourceType || SalesCatalogSourceType.manual,
      sourceId: item.sourceId || '',
      unitAmount: centsToDollarsInput(item.unitAmountCents),
      unitCost: centsToDollarsInput(item.unitCostCents),
      defaultQuantity: String(item.defaultQuantity || 1),
      taxable: Boolean(item.taxable),
      stripeProductId: item.stripeProductId || '',
      stripePriceId: item.stripePriceId || '',
      stripeRecurringInterval: item.stripeRecurringInterval || 'month',
      stripeRecurringIntervalCount: String(item.stripeRecurringIntervalCount || 1),
      taskTemplates: taskTemplatesForItem(item).map(templateToForm),
    });
    setFormModalOpen(true);
  };

  const buildCatalogItem = () => {
    const existingItem = catalogItems.find((item) => item.id === editingItemId) || {};
    const taskTemplates = normalizeTaskTemplatesForSave(form.taskTemplates);

    return new SalesCatalogItem({
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
      metadata: {
        ...(existingItem.metadata || {}),
        taskTemplates,
      },
      createdAt: existingItem.createdAt || null,
    });
  };

  const createStripeObjectForCatalogItem = async (catalogItem, { showToast = true } = {}) => {
    if (!recentlySelectedCompany || !catalogItem?.id) {
      throw new Error('Missing catalog item context.');
    }

    setCreatingStripeCatalogItemId(catalogItem.id);

    try {
      const callable = httpsCallable(functions, 'createStripeObjectForSalesCatalogItem');
      const result = await callable({
        companyId: recentlySelectedCompany,
        catalogItemId: catalogItem.id,
      });
      const stripeData = result?.data || {};
      const stripeProductId = stripeData.stripeProductId || '';
      const stripePriceId = stripeData.stripePriceId || '';
      const updatedItem = {
        ...catalogItem,
        stripeProductId,
        stripePriceId,
        stripeConnectedAccountId: stripeData.stripeConnectedAccountId || catalogItem.stripeConnectedAccountId || stripeConnectedAccountId || '',
      };

      setCatalogItems((current) => (
        current.map((item) => (item.id === catalogItem.id ? { ...item, ...updatedItem } : item))
      ));

      if (editingItemId === catalogItem.id) {
        setForm((current) => ({
          ...current,
          stripeProductId,
          stripePriceId,
        }));
      }

      if (showToast) {
        toast.success(
          stripeData.createdProduct || stripeData.createdPrice
            ? 'Stripe object created.'
            : 'Stripe object already connected.'
        );
      }

      return {
        ...updatedItem,
        ...stripeData,
      };
    } catch (error) {
      console.error('Unable to create Stripe object for service catalog item', error);
      if (showToast) {
        toast.error(error.message || 'Failed to create Stripe object.');
      }
      throw error;
    } finally {
      setCreatingStripeCatalogItemId('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany) {
      toast.error('Select a company before creating services.');
      return;
    }

    if (!form.name.trim()) {
      toast.error('Service name is required.');
      return;
    }

    setSaving(true);

    try {
      const item = buildCatalogItem();
      await saveSalesCatalogItem(db, recentlySelectedCompany, item);

      if (!editingItemId) {
        try {
          await createStripeObjectForCatalogItem(item, { showToast: false });
          toast.success('Service created with Stripe object.');
        } catch (stripeError) {
          toast.error(stripeError.message || 'Service created, but Stripe object creation failed.');
        }
      } else {
        toast.success('Service updated.');
      }

      setFormModalOpen(false);
      resetForm();
      if (!editingItemId) {
        navigate(`/company/sales/catalog-items/${item.id}`);
      }
    } catch (error) {
      console.error('Unable to save service catalog item', error);
      toast.error('Failed to save service.');
    } finally {
      setSaving(false);
    }
  };

  const archiveItem = async (item) => {
    const confirmed = await appConfirm({
      title: 'Archive Service',
      message: `Archive ${item.name}?`,
      confirmLabel: 'Archive Service',
    });
    if (!confirmed) return;

    try {
      await saveSalesCatalogItem(
        db,
        recentlySelectedCompany,
        {
          ...item,
          active: false,
        },
      );
      toast.success('Service archived.');
      if (editingItemId === item.id) resetForm();
      if (catalogItemId === item.id) navigate('/company/sales/catalog-items');
    } catch (error) {
      console.error('Unable to archive service catalog item', error);
      toast.error('Failed to archive service.');
    }
  };

  const renderStripeReferencePanel = (item = null) => {
    const stripeProductId = item?.stripeProductId || form.stripeProductId || '';
    const stripePriceId = item?.stripePriceId || form.stripePriceId || '';
    const hasStripeObject = Boolean(stripeProductId && stripePriceId);
    const canCreateStripeObject = Boolean(item?.id && !hasStripeObject);
    const creatingStripe = Boolean(item?.id && creatingStripeCatalogItemId === item.id);

    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-800">Stripe Object</p>
        <p className="mt-1 text-xs text-slate-500">
          {item
            ? 'Stripe Product and Price IDs are managed by DripDrop.'
            : 'A Stripe Product and Price will be created when this service is created.'}
        </p>

        <div className="mt-3 space-y-2 text-xs">
          <div>
            <p className="font-semibold uppercase tracking-wide text-slate-500">Product</p>
            <p className="mt-1 break-all rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-800">
              {stripeProductId || 'Not connected'}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-wide text-slate-500">Price</p>
            <p className="mt-1 break-all rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-slate-800">
              {stripePriceId || 'Not connected'}
            </p>
          </div>
        </div>

        {canCreateStripeObject && (
          <button
            type="button"
            onClick={() => createStripeObjectForCatalogItem(item)}
            disabled={creatingStripe || saving}
            className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingStripe ? 'Creating in Stripe...' : 'Create object in Stripe'}
          </button>
        )}

        {hasStripeObject && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <FaCheckCircle className="text-xs" />
            Connected
          </p>
        )}
      </div>
    );
  };

  const renderTaskTemplateEditor = () => (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Task Building Blocks</p>
          <p className="mt-1 text-xs text-slate-500">
            These seed job tasks when this service is added to a job or job template.
          </p>
        </div>
        <button
          type="button"
          onClick={addTaskTemplate}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          <FaPlus className="text-xs" />
          Add Task
        </button>
      </div>

      {!(form.taskTemplates || []).length ? (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
          No task building blocks yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {form.taskTemplates.map((template, index) => (
            <div key={template.id} className="rounded-md border border-slate-200 bg-white p-3">
              <div className="grid gap-3 xl:grid-cols-[minmax(180px,1.1fr)_minmax(170px,0.9fr)_minmax(240px,1.4fr)_110px_120px_120px_minmax(140px,auto)_auto] xl:items-end">
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Task {index + 1}</span>
                  <input
                    type="text"
                    value={template.name}
                    onChange={(event) => updateTaskTemplate(template.id, 'name', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Clean filter"
                  />
                </label>
                <div className="block text-sm font-semibold text-slate-700">
                  Task Type
                  <div className="mt-1 font-normal">
                    <Select
                      value={taskTypeOptionFor(template.type)}
                      options={taskTypeOptionsFor(template.type)}
                      onChange={(option) => updateTaskTemplate(template.id, 'type', option?.value || '')}
                      isSearchable
                      placeholder="Select type"
                      theme={selectTheme}
                      styles={selectStyles}
                      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                    />
                  </div>
                </div>
                <label className="block text-sm font-semibold text-slate-700">
                  Notes
                  <textarea
                    value={template.description}
                    onChange={(event) => updateTaskTemplate(template.id, 'description', event.target.value)}
                    rows={1}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Spray grids, check grids, reassemble filter"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Estimated Minutes
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={template.estimatedMinutes}
                    onChange={(event) => updateTaskTemplate(template.id, 'estimatedMinutes', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Tech Labor Cost
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={template.laborCost}
                    onChange={(event) => updateTaskTemplate(template.id, 'laborCost', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Billing Labor
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={template.billingLaborPrice}
                    onChange={(event) => updateTaskTemplate(template.id, 'billingLaborPrice', event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="flex min-h-[38px] items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(template.customerApprovalRequired)}
                    onChange={(event) => updateTaskTemplate(template.id, 'customerApprovalRequired', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Customer approval
                </label>
                <button
                  type="button"
                  onClick={() => removeTaskTemplate(template.id)}
                  className="min-h-[38px] rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderCatalogFormModal = () => {
    if (!formModalOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <form
          onSubmit={handleSubmit}
          className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-950">
                {editingItemId ? 'Edit Service' : 'Create Service'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Use prices in dollars. DripDrop stores them in cents.
              </p>
            </div>
            <button
              type="button"
              onClick={closeFormModal}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white p-2 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              aria-label="Close service form"
            >
              <FaTimes />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
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
                        <option key={option} value={option}>{catalogTypeLabel(option)}</option>
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

                <div className="grid gap-3 sm:grid-cols-3">
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
                </div>

              </div>

              <div className="space-y-4">
                <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.taxable}
                    onChange={(event) => handleFieldChange('taxable', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Taxable
                </label>

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
                    {sourceTypeSelectOptions.map((option) => (
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
                    Manual services are not tied to another record. Use this for custom services, package pricing,
                    recurring offerings, fees, and descriptions that only live in billing.
                  </p>
                )}

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

                {renderStripeReferencePanel(editingItemId ? catalogItems.find((item) => item.id === editingItemId) : null)}
              </div>
            </div>
            <div className="mt-5">
              {renderTaskTemplateEditor()}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4">
            <button
              type="button"
              onClick={closeFormModal}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <FaTimes className="text-xs" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {editingItemId ? <FaSave className="text-xs" /> : <FaPlus className="text-xs" />}
              {saving ? 'Saving...' : editingItemId ? 'Save Service' : 'Create Service'}
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderStats = () => (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Services</p>
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
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Task Templates</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{summary.taskTemplates}</p>
      </div>
    </section>
  );

  const renderHeader = () => (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-950">
              {catalogItemId && selectedCatalogItem ? selectedCatalogItem.name : 'Service Catalog'}
            </h1>
            <FeatureInfoButton title="How The Service Catalog Works" align="left">
              <p>
                Service catalog items are reusable pricing and operations building blocks owned by the pool company.
              </p>
              <p>
                Products, parts, and materials live in the Database Products Catalog. Services can seed estimates,
                service agreements, invoices, Stripe references, and job tasks.
              </p>
            </FeatureInfoButton>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Company-owned services for job estimates, service agreements, invoices, Stripe handoff, and technician task planning.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to={catalogItemId ? '/company/sales/catalog-items' : '/company/sales'}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <FaArrowLeft className="text-xs" />
            {catalogItemId ? 'Service Catalog' : 'Sales'}
          </Link>
          <Link
            to="/company/settings/terms-templates"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Service Agreement Templates
          </Link>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <FaPlus className="text-xs" />
            Create Service
          </button>
        </div>
      </div>
    </section>
  );

  const renderCatalogList = () => (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Catalog</h2>
          <p className="mt-1 text-sm text-slate-500">Reusable services available to estimates, agreements, jobs, and billing.</p>
        </div>
        <select
          value={filterType}
          onChange={(event) => setFilterType(event.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="all">All Types</option>
          {typeOptions.map((option) => (
            <option key={option} value={option}>{catalogTypeLabel(option)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="p-5 text-sm text-slate-500">Loading services...</div>
      ) : filteredCatalogItems.length === 0 ? (
        <div className="p-8 text-center">
          <FaTags className="mx-auto text-3xl text-slate-300" />
          <p className="mt-3 font-semibold text-slate-800">No services yet</p>
          <p className="mt-1 text-sm text-slate-500">Create services, recurring offerings, fees, and reusable Stripe references here.</p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <FaPlus className="text-xs" />
            Add first service
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Service</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Billing</th>
                <th className="px-5 py-3">Price</th>
                <th className="px-5 py-3">Tasks</th>
                <th className="px-5 py-3">Stripe</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredCatalogItems.map((item) => {
                const templates = taskTemplatesForItem(item);
                const totals = taskTemplateTotals(templates);
                return (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <Link
                        to={`/company/sales/catalog-items/${item.id}`}
                        className="font-semibold text-slate-900 transition hover:text-blue-700"
                      >
                        {item.name}
                      </Link>
                      <p className="mt-1 max-w-md text-sm text-slate-500">{item.description || 'No description'}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{catalogTypeLabel(item.type)}</td>
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
                      <p className="font-semibold text-slate-900">{templates.length}</p>
                      <p className="mt-1 text-xs text-slate-500">{minutesToLabel(totals.minutes)}</p>
                    </td>
	                    <td className="px-5 py-4 text-slate-600">
	                      {item.stripeProductId && item.stripePriceId ? (
	                        <div className="space-y-1 text-xs">
	                          <p className="break-all font-mono">{item.stripeProductId}</p>
	                          <p className="break-all font-mono">{item.stripePriceId}</p>
	                        </div>
	                      ) : (
	                        <div className="space-y-2">
	                          {(item.stripeProductId || item.stripePriceId) && (
	                            <div className="space-y-1 text-xs">
	                              {item.stripeProductId && <p className="break-all font-mono">{item.stripeProductId}</p>}
	                              {item.stripePriceId && <p className="break-all font-mono">{item.stripePriceId}</p>}
	                            </div>
	                          )}
	                          <button
	                            type="button"
	                            onClick={() => createStripeObjectForCatalogItem(item)}
	                            disabled={Boolean(creatingStripeCatalogItemId)}
	                            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
	                          >
	                            {creatingStripeCatalogItemId === item.id ? 'Creating...' : 'Create object in Stripe'}
	                          </button>
	                        </div>
	                      )}
	                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/company/sales/catalog-items/${item.id}`}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          <FaEye />
                          Details
                        </Link>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderDetailView = () => {
    if (loading) {
      return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          Loading service...
        </section>
      );
    }

    if (!selectedCatalogItem) {
      return (
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <FaTags className="mx-auto text-3xl text-slate-300" />
          <p className="mt-3 font-semibold text-slate-800">Service not found</p>
          <p className="mt-1 text-sm text-slate-500">It may have been archived or deleted.</p>
          <Link
            to="/company/sales/catalog-items"
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <FaArrowLeft className="text-xs" />
            Back to Service Catalog
          </Link>
        </section>
      );
    }

    const templates = taskTemplatesForItem(selectedCatalogItem);
    const totals = taskTemplateTotals(templates);

    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service Detail</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">{selectedCatalogItem.name}</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">{selectedCatalogItem.description || 'No description'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleEdit(selectedCatalogItem)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FaEdit className="text-xs" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => archiveItem(selectedCatalogItem)}
                className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                <FaArchive className="text-xs" />
                Archive
              </button>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Type</dt>
                  <dd className="font-semibold text-slate-900">{catalogTypeLabel(selectedCatalogItem.type)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Behavior</dt>
                  <dd className="font-semibold text-slate-900">{labelize(selectedCatalogItem.billingBehavior)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Customer Price</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(selectedCatalogItem.unitAmountCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Internal Cost</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(selectedCatalogItem.unitCostCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Default Qty</dt>
                  <dd className="font-semibold text-slate-900">{selectedCatalogItem.defaultQuantity || 1}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operations</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Task Templates</dt>
                  <dd className="font-semibold text-slate-900">{templates.length}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Estimated Time</dt>
                  <dd className="font-semibold text-slate-900">{minutesToLabel(totals.minutes)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Task Labor Cost</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(totals.laborCostCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Task Billing</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(totals.billingLaborPriceCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Source</dt>
                  <dd className="font-semibold text-slate-900">{sourceTypeLabels[selectedCatalogItem.sourceType] || labelize(selectedCatalogItem.sourceType)}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="border-t border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-950">Task Building Blocks</h3>
            <p className="mt-1 text-sm text-slate-500">
              These tasks are added to jobs when this service is used as a prebuilt service line.
            </p>
            {!templates.length ? (
              <div className="mt-4 rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                No task building blocks yet.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Task</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3 text-right">Time</th>
                      <th className="px-4 py-3 text-right">Cost</th>
                      <th className="px-4 py-3 text-right">Billing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {templates.map((template, index) => (
                      <tr key={template.id || index}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{template.name || template.title || `Task ${index + 1}`}</p>
                          <p className="mt-1 text-xs text-slate-500">{template.description || 'No notes'}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{template.type || template.taskType || 'General'}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{minutesToLabel(template.estimatedMinutes || template.estimatedTime)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(template.laborCostCents || template.contractedRate || 0)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(template.billingLaborPriceCents || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

	        <aside className="space-y-5">
	          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
	            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stripe References</p>
	            <div className="mt-3 space-y-2 text-sm">
	              <div>
	                <p className="text-xs font-semibold text-slate-500">Product</p>
	                <p className="mt-1 break-all font-mono font-semibold text-slate-900">{selectedCatalogItem.stripeProductId || 'Not connected'}</p>
	              </div>
	              <div>
	                <p className="text-xs font-semibold text-slate-500">Price</p>
	                <p className="mt-1 break-all font-mono font-semibold text-slate-900">{selectedCatalogItem.stripePriceId || 'Not connected'}</p>
	              </div>
	            </div>
	            {!(selectedCatalogItem.stripeProductId && selectedCatalogItem.stripePriceId) && (
	              <button
	                type="button"
	                onClick={() => createStripeObjectForCatalogItem(selectedCatalogItem)}
	                disabled={Boolean(creatingStripeCatalogItemId)}
	                className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
	              >
	                {creatingStripeCatalogItemId === selectedCatalogItem.id ? 'Creating in Stripe...' : 'Create object in Stripe'}
	              </button>
	            )}
	          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Used For</p>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <p>Estimates and one-off job plans</p>
              <p>Recurring service agreement lines</p>
              <p>Invoice line item prep</p>
              <p>Technician task building blocks</p>
            </div>
          </section>
        </aside>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-4 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-5">
        {renderHeader()}
        {renderStats()}
        {catalogItemId ? renderDetailView() : renderCatalogList()}
      </div>
      {renderCatalogFormModal()}
    </div>
  );
};

export default SalesCatalogItems;
