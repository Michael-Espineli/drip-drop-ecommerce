import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Select from 'react-select';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import {
  FaCheckCircle,
  FaClock,
  FaEllipsisV,
  FaEdit,
  FaEye,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaHistory,
  FaPlus,
  FaSearch,
  FaSyncAlt,
  FaTrash,
  FaTools,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { salesCollectionNames } from '../../../utils/models/Sales';
import { itemPhotoFieldsFromSource } from '../../../utils/itemPhotos';
import { buildPartApprovalShoppingItemPayload } from '../../../utils/partApprovalShopping';
import {
  getProductDisplayName,
  getProductSellPriceCents,
  isProductAvailableForPartApproval,
  productCatalogCollectionRef,
} from '../../../utils/productCatalog';
import { SHOPPING_LIST_STATUS } from '../../../utils/shoppingListStatus';
import { createAndSendShoppingItemInstallInvoice } from '../../../utils/sales/shoppingItemInvoiceAutomation';
import PartApprovalCreateModal from './PartApprovalCreateModal';

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

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

const formatCurrency = (amountCents = 0) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format((Number(amountCents) || 0) / 100);

const selectStyles = {
  control: (provided) => ({
    ...provided,
    minHeight: '42px',
    borderColor: '#cbd5e1',
    borderRadius: '0.375rem',
    boxShadow: 'none',
  }),
  menu: (provided) => ({
    ...provided,
    zIndex: 80,
  }),
};

const labelize = (value) => {
  if (!value) return 'Pending';
  if (normalizeStatus(value) === 'rejected') return 'Denied';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const statusTone = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  resolved: 'border-blue-200 bg-blue-50 text-blue-700',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status || 'pending');
  const tone = statusTone[key] || statusTone.pending;

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status || 'pending')}
    </span>
  );
};

const StatTile = ({ icon: Icon, label, value, helper, onClick, to = '', selected = false, title = '' }) => {
  const Component = to ? Link : onClick ? 'button' : 'div';
  const interactiveClasses = onClick || to
    ? 'w-full text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200'
    : '';
  const selectedClasses = selected
    ? 'border-blue-300 bg-blue-50 shadow-md ring-1 ring-blue-200'
    : 'border-slate-200 bg-white';
  const iconClasses = selected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';
  const actionProps = to
    ? { to }
    : {
        type: onClick ? 'button' : undefined,
        onClick,
        'aria-pressed': onClick ? selected : undefined,
      };

  return (
    <Component
      {...actionProps}
      title={title}
      className={`rounded-lg border p-4 shadow-sm ${selectedClasses} ${interactiveClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-bold uppercase tracking-wide ${selected ? 'text-blue-700' : 'text-slate-500'}`}>{label}</p>
          <p className={`mt-1 text-xl font-bold ${selected ? 'text-blue-950' : 'text-slate-950'}`}>{value}</p>
        </div>
        <span className={`rounded-md p-2 ${iconClasses}`}>
          <Icon />
        </span>
      </div>
      {helper && <p className={`mt-2 text-sm ${selected ? 'text-blue-700' : 'text-slate-500'}`}>{helper}</p>}
    </Component>
  );
};

const approvalTotalCents = (approval = {}) => {
  const total = Number(approval.plannedTotalPriceCents || approval.totalPriceCents || 0);
  if (total > 0) return total;

  const quantity = Number.parseFloat(approval.quantity || '1') || 1;
  const unit = Number(approval.plannedUnitPriceCents || approval.unitPriceCents || 0);
  return Math.round(unit * quantity);
};

const approvalUnitPriceCents = (approval = {}) => {
  const explicitUnit = Number(approval.plannedUnitPriceCents || approval.unitPriceCents || 0);
  if (explicitUnit > 0) return explicitUnit;

  const quantity = Number.parseFloat(approval.quantity || '1') || 1;
  return Math.round(approvalTotalCents(approval) / quantity);
};

const approvalUnitCostCents = (approval = {}) => Number(approval.plannedUnitCostCents || approval.unitCostCents || approval.cost || 0);

const approvalShoppingListItemId = (approval = {}) => approval.shoppingListItemId || approval.shoppingItemId || '';

const approvalInvoiceId = (approval = {}) => approval.invoiceId || approval.salesInvoiceId || '';

const approvalProductId = (approval = {}) => {
  const subCategoryKey = normalizeStatus(approval.subCategory || approval.itemType);
  if (subCategoryKey === 'product' || subCategoryKey === 'products' || subCategoryKey === 'productcatalog') {
    return approval.productId || approval.genericItemId || approval.itemId || '';
  }

  return approval.productId || approval.genericItemId || '';
};

const approvalDatabaseItemId = (approval = {}) => {
  const subCategoryKey = normalizeStatus(approval.subCategory || approval.itemType);
  if (subCategoryKey === 'product' || subCategoryKey === 'products' || subCategoryKey === 'productcatalog') {
    return '';
  }

  if (subCategoryKey === 'database' || subCategoryKey === 'databaseitem') {
    return approval.dbItemId || approval.itemId || approval.dataBaseItemId || approval.databaseItemId || '';
  }

  return approval.dbItemId || approval.dataBaseItemId || approval.databaseItemId || '';
};

const approvalCatalogItemId = (approval = {}) => approvalProductId(approval) || approvalDatabaseItemId(approval);

const isApprovalDatabaseItem = (approval = {}) => Boolean(approvalCatalogItemId(approval));

const approvalIsInstalled = (approval = {}) => (
  normalizeStatus(approval.fulfillmentStatus) === 'installed' ||
  normalizeStatus(approval.status) === 'resolved' ||
  Boolean(approval.installedAt)
);

const approvalIsInvoiced = (approval = {}) => Boolean(
  approval.invoiced ||
  approval.manuallyInvoiced ||
  approvalInvoiceId(approval)
);

const normalizeDbItemOption = (docId, data = {}) => {
  const id = data.id || docId;
  const name = getProductDisplayName({ ...data, id });
  const unitCostCents = Number(data.rate || data.cost || 0);
  const unitPriceCents = getProductSellPriceCents(data) || Number(data.sellPrice || data.rate || data.cost || 0);
  const photoFields = itemPhotoFieldsFromSource(data, name);
  const availableForPartApproval = isProductAvailableForPartApproval(data);

  return {
    ...data,
    id,
    active: data.active !== false,
    availableForPartApproval,
    partApprovalAvailable: availableForPartApproval,
    name,
    description: data.description || '',
    genericItemId: id,
    productId: id,
    productName: name,
    dbItemId: '',
    unitCostCents,
    unitPriceCents,
    ...photoFields,
    label: `${name} (${formatCurrency(unitPriceCents)})`,
    value: id,
  };
};

const buildServiceLocationSnapshots = (approval = {}) => {
  if (Array.isArray(approval.serviceLocationSnapshots) && approval.serviceLocationSnapshots.length) {
    return approval.serviceLocationSnapshots;
  }

  if (approval.serviceLocationSnapshot && typeof approval.serviceLocationSnapshot === 'object') {
    return [approval.serviceLocationSnapshot];
  }

  if (!approval.serviceLocationId && !approval.serviceLocationName) return [];

  return [{
    id: approval.serviceLocationId || '',
    name: approval.serviceLocationName || '',
  }];
};

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Denied' },
  { value: 'resolved', label: 'Resolved' },
];

const activeStatusKeys = new Set(['pending', 'approved']);
const deniedStatusKeys = new Set(['rejected', 'declined', 'denied']);

const approvalStatusKey = (approval = {}) => normalizeStatus(approval.status || approval.approvalStatus || 'pending');

const approvalActivityMillis = (approval = {}) => toMillis(
  approval.deniedAt ||
  approval.declinedAt ||
  approval.rejectedAt ||
  approval.respondedAt ||
  approval.updatedAt ||
  approval.requestedAt ||
  approval.createdAt
);

const isDeniedApproval = (approval = {}) => (
  deniedStatusKeys.has(approvalStatusKey(approval)) ||
  deniedStatusKeys.has(normalizeStatus(approval.response)) ||
  deniedStatusKeys.has(normalizeStatus(approval.fulfillmentStatus))
);

const getApprovalUrl = (approval = {}) => (
  approval.customerApprovalUrl || `${window.location.origin}/customer/part-approvals/${approval.id}`
);

const userDisplayName = (user = {}) => (
  user.displayName ||
  user.email ||
  'Company user'
);

const compactUnique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const historyTimestamp = () => Timestamp.fromDate(new Date());

const dateParamFromDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const daysAgoDateParam = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateParamFromDate(date);
};

const todayDateParam = () => dateParamFromDate(new Date());

const buildHistoryEvent = ({
  action,
  status,
  note = '',
  source = 'companyWeb',
  sourceLabel = 'Company web app',
  user,
}) => ({
  id: `cpa_hist_${uuidv4()}`,
  action,
  status,
  note,
  source,
  sourceLabel,
  actorUserId: user?.uid || '',
  actorUserName: userDisplayName(user),
  actorEmail: user?.email || '',
  createdAt: historyTimestamp(),
});

const approvalHistoryItems = (approval = {}) => {
  const items = [];
  const explicitHistory = Array.isArray(approval.history) ? approval.history : [];
  const hasRequestedHistory = explicitHistory.some((item) => normalizeStatus(item.action) === 'requested');

  if (!hasRequestedHistory && (approval.requestedAt || approval.createdAt)) {
    items.push({
      id: `${approval.id}-requested`,
      action: 'requested',
      status: 'pending',
      note: approval.description || '',
      sourceLabel: 'Approval requested',
      actorUserName: approval.requestedByUserName || '',
      createdAt: approval.requestedAt || approval.createdAt,
    });
  }

  if (explicitHistory.length) {
    items.push(...explicitHistory.map((item, index) => ({
      id: item.id || `${approval.id}-history-${index}`,
      ...item,
    })));
  } else if (approval.respondedAt) {
    const byTech = approval.respondedOnBehalfOfCustomer || approval.approvedInPerson || approval.deniedInPerson;
    items.push({
      id: `${approval.id}-response`,
      action: approval.response || approval.approvalStatus || approval.status || 'response',
      status: approval.approvalStatus || approval.status || '',
      note: approval.responseNote || '',
      sourceLabel: byTech ? 'Technician on behalf of customer' : 'Customer through app',
      actorUserName: approval.respondedByUserName || '',
      actorEmail: approval.respondedByEmail || '',
      createdAt: approval.respondedAt,
    });
  }

  if (approval.lastResentAt) {
    items.push({
      id: `${approval.id}-resent`,
      action: 'resent',
      status: approval.status || approval.approvalStatus || '',
      note: 'Approval link resent',
      sourceLabel: 'Company web app',
      actorUserName: approval.lastResentByUserName || '',
      actorEmail: approval.lastResentByEmail || '',
      createdAt: approval.lastResentAt,
    });
  }

  return items.sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
};

const PartApprovalActionMenuItem = ({
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
    emerald: 'text-emerald-700 hover:bg-emerald-50',
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

const CompanyPartApprovals = () => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    shoppingItemInstallInvoiceAutomationEnabled,
    user,
  } = useContext(Context);
  const [searchParams, setSearchParams] = useSearchParams();
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [workflowActionId, setWorkflowActionId] = useState('');
  const [detailApproval, setDetailApproval] = useState(null);
  const [statusApproval, setStatusApproval] = useState(null);
  const [editApproval, setEditApproval] = useState(null);
  const [openActionApprovalId, setOpenActionApprovalId] = useState('');
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const linkedApprovalId = searchParams.get('approvalId') || searchParams.get('partApprovalId') || '';

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setApprovals([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      query(collection(db, 'customerPartApprovals'), where('companyId', '==', recentlySelectedCompany)),
      (snapshot) => {
        const nextApprovals = snapshot.docs
          .map((approvalDoc) => ({ id: approvalDoc.id, ...approvalDoc.data() }))
          .sort((left, right) => toMillis(right.updatedAt || right.requestedAt || right.createdAt) - toMillis(left.updatedAt || left.requestedAt || left.createdAt));

        setApprovals(nextApprovals);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load part approvals', snapshotError);
        setError(snapshotError.message || 'Unable to load part approvals.');
        setLoading(false);
      }
    );
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (detailApproval?.id) {
      setDetailApproval((current) => approvals.find((approval) => approval.id === current?.id) || current);
    }
    if (statusApproval?.id) {
      setStatusApproval((current) => approvals.find((approval) => approval.id === current?.id) || current);
    }
    if (editApproval?.id) {
      setEditApproval((current) => approvals.find((approval) => approval.id === current?.id) || current);
    }
  }, [approvals, detailApproval?.id, editApproval?.id, statusApproval?.id]);

  useEffect(() => {
    if (!linkedApprovalId || approvals.length === 0) return;

    const linkedApproval = approvals.find((approval) => approval.id === linkedApprovalId);
    if (linkedApproval && detailApproval?.id !== linkedApproval.id) {
      setDetailApproval(linkedApproval);
    }
  }, [approvals, detailApproval?.id, linkedApprovalId]);

  const filteredApprovals = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return approvals.filter((approval) => {
      const status = approvalStatusKey(approval);
      if (statusFilter === 'active' && !activeStatusKeys.has(status)) return false;
      if (!['all', 'active'].includes(statusFilter) && status !== statusFilter) return false;
      if (!search) return true;

      return [
        approval.itemName,
        approval.name,
        approval.description,
        approval.customerName,
        approval.customerEmail,
        approval.productName,
        approvalProductId(approval),
        approval.dbItemName,
        approval.genericItemId,
        approvalInvoiceId(approval),
        approvalShoppingListItemId(approval),
        approval.jobInternalId,
        approval.jobName,
        approval.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [approvals, searchTerm, statusFilter]);

  const summary = useMemo(() => {
    const pending = approvals.filter((approval) => approvalStatusKey(approval) === 'pending');
    const approved = approvals.filter((approval) => approvalStatusKey(approval) === 'approved');
    const thirtyDaysAgoMillis = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentlyDenied = approvals.filter((approval) => isDeniedApproval(approval) && approvalActivityMillis(approval) >= thirtyDaysAgoMillis);

    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      recentlyDeniedCount: recentlyDenied.length,
      totalValueCents: approvals.reduce((total, approval) => total + approvalTotalCents(approval), 0),
    };
  }, [approvals]);

  const openActionApproval = useMemo(
    () => approvals.find((approval) => approval.id === openActionApprovalId) || null,
    [approvals, openActionApprovalId]
  );

  const setCardFilter = (filter) => {
    setStatusFilter((current) => (current === filter ? 'active' : filter));
  };

  const closeApprovalActions = () => {
    setOpenActionApprovalId('');
    setActionMenuPosition(null);
  };

  const toggleApprovalActions = (approvalId, event) => {
    if (openActionApprovalId === approvalId) {
      closeApprovalActions();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 240;
    const menuHeight = 360;
    const top = Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 8);
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

    setOpenActionApprovalId(approvalId);
    setActionMenuPosition({ top, left });
  };

  const closeDetailModal = () => {
    setDetailApproval(null);
    if (linkedApprovalId) {
      setSearchParams({}, { replace: true });
    }
  };

  const buildApprovalInvoicePayload = ({ approval, invoiceId, shoppingListItemId }) => {
    const totalAmountCents = approvalTotalCents(approval);
    const quantity = Number.parseFloat(approval.quantity || '1') || 1;
    const unitAmountCents = approvalUnitPriceCents(approval);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const lineItem = {
      id: `sili_${uuidv4()}`,
      sourceType: 'partApproval',
      sourceId: approval.id,
      catalogItemId: approvalCatalogItemId(approval),
      name: approval.itemName || approval.name || approval.productName || approval.dbItemName || 'Pool Part',
      description: approval.description || '',
      quantity,
      unitAmountCents,
      totalAmountCents,
      taxable: false,
      type: 'material',
      metadata: {
        sourceType: 'partApproval',
        shoppingListItemId,
        partApprovalRequestId: approval.id,
      },
    };

    const invoicePayload = {
      id: invoiceId,
      companyId: recentlySelectedCompany,
      companyName: recentlySelectedCompanyName || approval.companyName || '',
      customerId: approval.customerId || '',
      customerUserId: approval.customerUserId || null,
      customerName: approval.customerName || 'Customer',
      customerEmail: approval.customerEmail || approval.email || '',
      billingEmail: approval.billingEmail || approval.customerEmail || approval.email || '',
      customerPhoneNumber: approval.customerPhoneNumber || '',
      relationshipId: approval.relationshipId || '',
      customerCompanyRelationshipId: approval.customerCompanyRelationshipId || approval.relationshipId || '',
      email: approval.email || approval.customerEmail || approval.billingEmail || '',
      agreementId: '',
      jobId: approval.jobId || '',
      contractId: '',
      billingSubscriptionId: '',
      stripeConnectedAccountId: approval.stripeConnectedAccountId || '',
      stripeInvoiceId: '',
      stripePaymentIntentId: '',
      stripeHostedInvoiceUrl: '',
      stripeInvoicePdfUrl: '',
      invoiceNumber: approval.invoiceNumber || `PART-${String(Date.now()).slice(-6)}`,
      type: 'oneTime',
      status: 'draft',
      deliveryMethod: 'email',
      currency: 'usd',
      billingPeriodStart: null,
      billingPeriodEnd: null,
      dueDate: Timestamp.fromDate(dueDate),
      subtotalAmountCents: totalAmountCents,
      discountAmountCents: 0,
      taxAmountCents: 0,
      totalAmountCents,
      amountPaidCents: 0,
      amountDueCents: totalAmountCents,
      writeOffAmountCents: 0,
      memo: `Approved part: ${lineItem.name}`,
      lineItems: [lineItem],
      serviceLocationSnapshots: buildServiceLocationSnapshots(approval),
      sourceType: 'partApproval',
      sourceId: approval.id,
      shoppingListItemId,
      partApprovalRequestId: approval.id,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdByUserId: user?.uid || '',
    };

    Object.keys(invoicePayload).forEach((key) => {
      if (invoicePayload[key] === undefined) delete invoicePayload[key];
    });

    return invoicePayload;
  };

  const showInstallInvoiceResult = (invoiceResult = {}) => {
    if (invoiceResult.status === 'sent') {
      toast.success('Invoice created and sent.');
    } else if (invoiceResult.status === 'created_email_failed') {
      toast.error(`Invoice created, but email was not sent: ${invoiceResult.reason}`);
    } else if (invoiceResult.status === 'skipped' && invoiceResult.reason === 'missing_billable_amount') {
      toast.error('Part installed, but no invoice was created because it has no billable amount.');
    } else if (invoiceResult.status === 'skipped' && invoiceResult.reason === 'missing_customer_email') {
      toast.error('Part installed, but no invoice was created because the customer is missing an email.');
    }
  };

  const markApprovalInstalled = async (approval) => {
    if (!recentlySelectedCompany || !approval?.id || workflowActionId) return;

    const existingShoppingListItemId = approvalShoppingListItemId(approval);
    const shoppingListItemId = existingShoppingListItemId || `comp_shop_${uuidv4()}`;
    const now = Timestamp.fromDate(new Date());
    const actor = userDisplayName(user);
    const invoiceId = approvalInvoiceId(approval);
    const shouldAutoInvoiceOnInstall = approval.autoInvoiceOnInstall === undefined
      ? shoppingItemInstallInvoiceAutomationEnabled === true
      : approval.autoInvoiceOnInstall === true;
    const historyEvent = buildHistoryEvent({
      action: 'markedInstalled',
      status: 'installed',
      note: 'Marked installed by company',
      user,
    });

    setWorkflowActionId(`installed-${approval.id}`);

    try {
      const batch = writeBatch(db);
      const approvalUpdates = {
        status: 'resolved',
        approvalStatus: 'approved',
        response: 'approved',
        responseNote: approval.responseNote || 'Approved by company',
        respondedAt: approval.respondedAt || serverTimestamp(),
        respondedByUserId: approval.respondedByUserId || user?.uid || '',
        respondedByUserName: approval.respondedByUserName || actor,
        respondedByEmail: approval.respondedByEmail || user?.email || '',
        responseSource: approval.responseSource || 'companyWeb',
        responseSourceLabel: approval.responseSourceLabel || 'Company web app',
        fulfillmentStatus: 'installed',
        shoppingListItemId,
        shoppingListPath: `companies/${recentlySelectedCompany}/shoppingList/${shoppingListItemId}`,
        shoppingListGeneratedAt: approval.shoppingListGeneratedAt || serverTimestamp(),
        installedAt: serverTimestamp(),
        installedByUserId: user?.uid || '',
        installedByUserName: actor,
        autoInvoiceOnInstall: shouldAutoInvoiceOnInstall,
        resolvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEvent),
      };
      const shoppingRef = doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId);
      const shoppingPayload = existingShoppingListItemId
        ? {
          status: 'Installed',
          needsAction: false,
          autoInvoiceOnInstall: shouldAutoInvoiceOnInstall,
          fulfillmentStatus: 'installed',
          customerApprovalStatus: 'approved',
          installedAt: serverTimestamp(),
          installedByUserId: user?.uid || '',
          installedByUserName: actor,
          updatedAt: serverTimestamp(),
        }
        : buildPartApprovalShoppingItemPayload({
          approval: {
            ...approval,
            autoInvoiceOnInstall: shouldAutoInvoiceOnInstall,
            status: 'approved',
            approvalStatus: 'approved',
            fulfillmentStatus: 'installed',
            shoppingListItemId,
            respondedAt: approval.respondedAt || now,
            respondedByUserId: approval.respondedByUserId || user?.uid || '',
            respondedByUserName: approval.respondedByUserName || actor,
            respondedByEmail: approval.respondedByEmail || user?.email || '',
          },
          shoppingListItemId,
          now,
          generated: true,
          status: 'Installed',
        });

      Object.assign(shoppingPayload, {
        status: 'Installed',
        needsAction: false,
        autoInvoiceOnInstall: shouldAutoInvoiceOnInstall,
        fulfillmentStatus: 'installed',
        installedAt: serverTimestamp(),
        installedByUserId: user?.uid || '',
        installedByUserName: actor,
        updatedAt: serverTimestamp(),
      });

      if (approvalIsInvoiced(approval)) {
        shoppingPayload.invoiced = true;
        if (invoiceId) {
          Object.assign(shoppingPayload, {
            invoiceId,
            salesInvoiceId: invoiceId,
          });
        }
      }

      batch.set(doc(db, 'customerPartApprovals', approval.id), approvalUpdates, { merge: true });
      batch.set(shoppingRef, shoppingPayload, { merge: true });
      await batch.commit();
      toast.success('Part marked installed.');

      if (shouldAutoInvoiceOnInstall && !approvalIsInvoiced(approval)) {
        const invoiceResult = await createAndSendShoppingItemInstallInvoice({
          db,
          functions,
          companyId: recentlySelectedCompany,
          shoppingItem: {
            ...approval,
            ...shoppingPayload,
            id: shoppingListItemId,
            status: SHOPPING_LIST_STATUS.installed,
            customerEmail: approval.customerEmail || approval.email || approval.billingEmail || '',
          },
          user,
          getCallableAuthPayload,
        });
        showInstallInvoiceResult(invoiceResult);
      }
    } catch (installError) {
      console.error('Unable to mark part approval installed', installError);
      toast.error(installError.message || 'Unable to mark installed.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const markApprovalManuallyInvoiced = async (approval) => {
    if (!recentlySelectedCompany || !approval?.id || workflowActionId) return;

    const existingShoppingListItemId = approvalShoppingListItemId(approval);
    const shoppingListItemId = existingShoppingListItemId || `comp_shop_${uuidv4()}`;
    const now = Timestamp.fromDate(new Date());
    const actor = userDisplayName(user);
    const statusKey = normalizeStatus(approval.status || approval.approvalStatus || 'pending');
    const nextStatus = ['pending', 'rejected'].includes(statusKey) ? 'approved' : (approval.status || 'approved');
    const historyEvent = buildHistoryEvent({
      action: 'markedInvoiced',
      status: 'invoiced',
      note: 'Marked invoiced without creating a sales invoice',
      user,
    });

    setWorkflowActionId(`invoiced-${approval.id}`);

    try {
      const batch = writeBatch(db);
      const approvalUpdates = {
        status: nextStatus,
        approvalStatus: 'approved',
        response: 'approved',
        responseNote: approval.responseNote || 'Approved by company',
        respondedAt: approval.respondedAt || serverTimestamp(),
        respondedByUserId: approval.respondedByUserId || user?.uid || '',
        respondedByUserName: approval.respondedByUserName || actor,
        respondedByEmail: approval.respondedByEmail || user?.email || '',
        responseSource: approval.responseSource || 'companyWeb',
        responseSourceLabel: approval.responseSourceLabel || 'Company web app',
        fulfillmentStatus: approval.fulfillmentStatus || 'approvedAwaitingPurchase',
        shoppingListItemId,
        shoppingListPath: `companies/${recentlySelectedCompany}/shoppingList/${shoppingListItemId}`,
        shoppingListGeneratedAt: approval.shoppingListGeneratedAt || serverTimestamp(),
        invoiced: true,
        manuallyInvoiced: true,
        invoiceStatus: 'manual',
        invoiceType: 'manual',
        manualInvoiceStatus: 'invoiced',
        manualInvoicedAt: serverTimestamp(),
        manualInvoicedByUserId: user?.uid || '',
        manualInvoicedByUserName: actor,
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEvent),
      };
      const shoppingPayload = existingShoppingListItemId
        ? {}
        : buildPartApprovalShoppingItemPayload({
          approval: {
            ...approval,
            autoInvoiceOnInstall: approval.autoInvoiceOnInstall === undefined
              ? shoppingItemInstallInvoiceAutomationEnabled === true
              : approval.autoInvoiceOnInstall === true,
            status: 'approved',
            approvalStatus: 'approved',
            shoppingListItemId,
            respondedAt: approval.respondedAt || now,
            respondedByUserId: approval.respondedByUserId || user?.uid || '',
            respondedByUserName: approval.respondedByUserName || actor,
            respondedByEmail: approval.respondedByEmail || user?.email || '',
          },
          shoppingListItemId,
          now,
          generated: true,
          status: approvalIsInstalled(approval) ? SHOPPING_LIST_STATUS.installed : SHOPPING_LIST_STATUS.needToPurchase,
        });

      Object.assign(shoppingPayload, {
        invoiced: true,
        manuallyInvoiced: true,
        invoiceStatus: 'manual',
        invoiceType: 'manual',
        manualInvoiceStatus: 'invoiced',
        manualInvoicedAt: serverTimestamp(),
        manualInvoicedByUserId: user?.uid || '',
        manualInvoicedByUserName: actor,
        updatedAt: serverTimestamp(),
      });

      if (approvalIsInstalled(approval)) {
        Object.assign(shoppingPayload, {
          status: 'Installed',
          needsAction: false,
          fulfillmentStatus: 'installed',
        });
      }

      batch.set(doc(db, 'customerPartApprovals', approval.id), approvalUpdates, { merge: true });
      batch.set(doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId), shoppingPayload, { merge: true });
      await batch.commit();
      toast.success('Part marked invoiced.');
    } catch (invoiceError) {
      console.error('Unable to mark part approval invoiced', invoiceError);
      toast.error(invoiceError.message || 'Unable to mark invoiced.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const convertApprovalToInvoice = async (approval) => {
    if (!recentlySelectedCompany || !approval?.id || workflowActionId) return;

    if (approvalInvoiceId(approval)) {
      toast.error('This part approval already has an invoice.');
      return;
    }

    const totalAmountCents = approvalTotalCents(approval);
    if (totalAmountCents <= 0) {
      toast.error('Add a billable amount before converting this approval to an invoice.');
      return;
    }

    const existingShoppingListItemId = approvalShoppingListItemId(approval);
    const shoppingListItemId = existingShoppingListItemId || `comp_shop_${uuidv4()}`;
    const invoiceId = `si_${uuidv4()}`;
    const now = Timestamp.fromDate(new Date());
    const actor = userDisplayName(user);
    const historyEvent = buildHistoryEvent({
      action: 'convertedToInvoice',
      status: 'invoiced',
      note: 'Converted to a draft sales invoice',
      user,
    });

    setWorkflowActionId(`invoice-${approval.id}`);

    try {
      const batch = writeBatch(db);
      const invoicePayload = buildApprovalInvoicePayload({ approval, invoiceId, shoppingListItemId });
      const approvalUpdates = {
        status: normalizeStatus(approval.status || approval.approvalStatus) === 'resolved' ? 'resolved' : 'approved',
        approvalStatus: 'approved',
        response: 'approved',
        responseNote: approval.responseNote || 'Approved by company',
        respondedAt: approval.respondedAt || serverTimestamp(),
        respondedByUserId: approval.respondedByUserId || user?.uid || '',
        respondedByUserName: approval.respondedByUserName || actor,
        respondedByEmail: approval.respondedByEmail || user?.email || '',
        responseSource: approval.responseSource || 'companyWeb',
        responseSourceLabel: approval.responseSourceLabel || 'Company web app',
        fulfillmentStatus: approval.fulfillmentStatus || 'approvedAwaitingPurchase',
        shoppingListItemId,
        shoppingListPath: `companies/${recentlySelectedCompany}/shoppingList/${shoppingListItemId}`,
        shoppingListGeneratedAt: approval.shoppingListGeneratedAt || serverTimestamp(),
        invoiceId,
        salesInvoiceId: invoiceId,
        invoiced: true,
        invoiceStatus: 'draft',
        invoiceType: 'salesInvoice',
        convertedToInvoiceAt: serverTimestamp(),
        convertedToInvoiceByUserId: user?.uid || '',
        convertedToInvoiceByUserName: actor,
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEvent),
      };
      const shoppingPayload = existingShoppingListItemId
        ? {}
        : buildPartApprovalShoppingItemPayload({
          approval: {
            ...approval,
            status: 'approved',
            approvalStatus: 'approved',
            shoppingListItemId,
            respondedAt: approval.respondedAt || now,
            respondedByUserId: approval.respondedByUserId || user?.uid || '',
            respondedByUserName: approval.respondedByUserName || actor,
            respondedByEmail: approval.respondedByEmail || user?.email || '',
          },
          shoppingListItemId,
          now,
          generated: true,
        });

      Object.assign(shoppingPayload, {
        invoiced: true,
        invoiceId,
        salesInvoiceId: invoiceId,
        invoiceStatus: 'draft',
        invoiceType: 'salesInvoice',
        updatedAt: serverTimestamp(),
      });

      if (approvalIsInstalled(approval)) {
        Object.assign(shoppingPayload, {
          status: 'Installed',
          needsAction: false,
          fulfillmentStatus: 'installed',
        });
      }

      batch.set(doc(db, salesCollectionNames.invoices, invoiceId), invoicePayload, { merge: true });
      batch.set(doc(db, 'customerPartApprovals', approval.id), approvalUpdates, { merge: true });
      batch.set(doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId), shoppingPayload, { merge: true });
      await batch.commit();
      toast.success('Draft invoice created. No email was sent.');
    } catch (workflowError) {
      console.error('Unable to convert part approval to invoice', workflowError);
      toast.error(workflowError.message || 'Unable to convert to invoice.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const saveApprovalStatus = async ({ approval, nextStatus, note = '' }) => {
    if (!recentlySelectedCompany || !approval?.id || workflowActionId) return;

    const normalizedNextStatus = normalizeStatus(nextStatus || 'pending') || 'pending';
    const nowDate = new Date();
    const now = Timestamp.fromDate(nowDate);
    const actor = userDisplayName(user);
    const approvalRef = doc(db, 'customerPartApprovals', approval.id);
    const existingShoppingListItemId = approvalShoppingListItemId(approval);
    const shouldHaveShoppingItem = normalizedNextStatus === 'approved';
    const shoppingListItemId = shouldHaveShoppingItem
      ? existingShoppingListItemId || `comp_shop_${uuidv4()}`
      : existingShoppingListItemId;
    const historyEvent = buildHistoryEvent({
      action: 'statusEdited',
      status: normalizedNextStatus,
      note,
      source: 'companyWeb',
      sourceLabel: 'Company web app',
      user,
    });
    const statusUpdates = {
      status: normalizedNextStatus,
      approvalStatus: normalizedNextStatus,
      updatedAt: serverTimestamp(),
      statusEditedAt: serverTimestamp(),
      statusEditedByUserId: user?.uid || '',
      statusEditedByUserName: actor,
      history: arrayUnion(historyEvent),
    };

    if (normalizedNextStatus === 'approved') {
      Object.assign(statusUpdates, {
        response: 'approved',
        responseNote: note || approval.responseNote || 'Approved by company',
        respondedAt: serverTimestamp(),
        respondedByUserId: user?.uid || '',
        respondedByUserName: actor,
        respondedByEmail: user?.email || '',
        responseSource: 'companyWeb',
        responseSourceLabel: 'Company web app',
        fulfillmentStatus: 'approvedAwaitingPurchase',
        shoppingListItemId,
        shoppingListPath: shoppingListItemId ? `companies/${recentlySelectedCompany}/shoppingList/${shoppingListItemId}` : '',
        shoppingListGeneratedAt: existingShoppingListItemId ? approval.shoppingListGeneratedAt || now : serverTimestamp(),
      });
    } else if (normalizedNextStatus === 'rejected') {
      Object.assign(statusUpdates, {
        response: 'rejected',
        responseNote: note || approval.responseNote || 'Denied by company',
        respondedAt: serverTimestamp(),
        respondedByUserId: user?.uid || '',
        respondedByUserName: actor,
        respondedByEmail: user?.email || '',
        responseSource: 'companyWeb',
        responseSourceLabel: 'Company web app',
        fulfillmentStatus: 'rejected',
        shoppingListItemId: '',
        shoppingListPath: '',
      });
    } else if (normalizedNextStatus === 'pending') {
      Object.assign(statusUpdates, {
        fulfillmentStatus: 'awaitingCustomerApproval',
      });
    } else if (normalizedNextStatus === 'resolved') {
      Object.assign(statusUpdates, {
        fulfillmentStatus: approval.fulfillmentStatus || 'installed',
        resolvedAt: serverTimestamp(),
      });
    }

    setWorkflowActionId(`status-${approval.id}`);

    try {
      const batch = writeBatch(db);
      batch.set(approvalRef, statusUpdates, { merge: true });

      if (shoppingListItemId && normalizedNextStatus === 'approved') {
        batch.set(
          doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId),
          buildPartApprovalShoppingItemPayload({
            approval: {
            ...approval,
            ...statusUpdates,
            autoInvoiceOnInstall: approval.autoInvoiceOnInstall === undefined
              ? shoppingItemInstallInvoiceAutomationEnabled === true
              : approval.autoInvoiceOnInstall === true,
            status: 'approved',
            approvalStatus: 'approved',
              shoppingListItemId,
              respondedAt: now,
              respondedByUserId: user?.uid || '',
              respondedByUserName: actor,
              respondedByEmail: user?.email || '',
            },
            shoppingListItemId,
            now,
            generated: !existingShoppingListItemId,
          }),
          { merge: true }
        );
      } else if (shoppingListItemId && normalizedNextStatus === 'rejected') {
        batch.delete(doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId));
      }

      await batch.commit();
      toast.success('Part approval status updated.');
      setStatusApproval(null);
      if (detailApproval?.id === approval.id) {
        setDetailApproval((current) => current ? { ...current, ...statusUpdates, updatedAt: now } : current);
      }
    } catch (statusError) {
      console.error('Unable to update part approval status', statusError);
      toast.error(statusError.message || 'Unable to update status.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const saveApprovalEdits = async ({ approval, form }) => {
    if (!approval?.id || workflowActionId) return;

    const databaseMode = form.mode === 'database';
    const selectedDbItem = form.selectedDbItem || null;
    const quantity = Number.parseFloat(form.quantity || '1') || 1;
    const itemName = databaseMode
      ? selectedDbItem?.name || approval.productName || approval.dbItemName || approval.itemName || approval.name || 'Pool Part'
      : form.itemName.trim() || 'Pool Part';
    const unitCostCents = databaseMode
      ? Number(selectedDbItem?.unitCostCents ?? approvalUnitCostCents(approval))
      : Math.round((Number.parseFloat(form.unitCost || '0') || 0) * 100);
    const unitPriceCents = databaseMode
      ? Number(selectedDbItem?.unitPriceCents ?? approvalUnitPriceCents(approval))
      : Math.round((Number.parseFloat(form.unitPrice || '0') || 0) * 100);
    const productId = databaseMode ? selectedDbItem?.productId || selectedDbItem?.id || approvalProductId(approval) : '';
    const dbItemId = databaseMode && !productId ? approvalDatabaseItemId(approval) : '';
    const genericItemId = databaseMode ? productId || selectedDbItem?.genericItemId || approval.genericItemId || '' : '';
    const databasePhotoFields = databaseMode && selectedDbItem
      ? itemPhotoFieldsFromSource(selectedDbItem, itemName)
      : {};
    const historyEvent = buildHistoryEvent({
      action: 'partEdited',
      status: approval.status || approval.approvalStatus || 'pending',
      note: databaseMode ? 'Part approval product changed' : 'Part details edited',
      source: 'companyWeb',
      sourceLabel: 'Company web app',
      user,
    });
    const updates = {
      itemName,
      name: itemName,
      description: form.description.trim(),
      quantity: String(quantity),
      subCategory: databaseMode ? 'Product' : 'Part',
      dbItemId,
      dbItemName: dbItemId ? itemName : '',
      genericItemId,
      productId: databaseMode ? productId || genericItemId : '',
      productName: databaseMode ? itemName : '',
      itemId: databaseMode ? productId || genericItemId || dbItemId : '',
      itemType: databaseMode ? 'Product' : 'Part',
      plannedUnitCostCents: unitCostCents,
      plannedUnitPriceCents: unitPriceCents,
      plannedTotalCostCents: Math.round(unitCostCents * quantity),
      plannedTotalPriceCents: Math.round(unitPriceCents * quantity),
      updatedAt: serverTimestamp(),
      editedAt: serverTimestamp(),
      editedByUserId: user?.uid || '',
      editedByUserName: userDisplayName(user),
      history: arrayUnion(historyEvent),
      ...databasePhotoFields,
    };

    setWorkflowActionId(`edit-${approval.id}`);

    try {
      await updateDoc(doc(db, 'customerPartApprovals', approval.id), updates);
      toast.success('Part approval updated.');
      setEditApproval(null);
    } catch (editError) {
      console.error('Unable to edit part approval', editError);
      toast.error(editError.message || 'Unable to save edits.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const deleteApproval = async (approval) => {
    if (!approval?.id || workflowActionId) return;
    const confirmed = window.confirm(`Delete ${approval.itemName || approval.name || 'this part approval'}?`);
    if (!confirmed) return;

    setWorkflowActionId(`delete-${approval.id}`);

    try {
      await deleteDoc(doc(db, 'customerPartApprovals', approval.id));
      toast.success('Part approval deleted.');
      setDetailApproval(null);
      setEditApproval(null);
      setStatusApproval(null);
    } catch (deleteError) {
      console.error('Unable to delete part approval', deleteError);
      toast.error(deleteError.message || 'Unable to delete approval.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const resendApproval = async (approval) => {
    if (!approval?.id || workflowActionId) return;

    const url = getApprovalUrl(approval);
    const actor = userDisplayName(user);
    const historyEvent = buildHistoryEvent({
      action: 'resent',
      status: approval.status || approval.approvalStatus || 'pending',
      note: 'Approval link resent',
      source: 'companyWeb',
      sourceLabel: 'Company web app',
      user,
    });

    setWorkflowActionId(`resend-${approval.id}`);

    try {
      try {
        await navigator.clipboard.writeText(url);
      } catch (clipboardError) {
        console.warn('Unable to copy approval link', clipboardError);
      }

      await updateDoc(doc(db, 'customerPartApprovals', approval.id), {
        customerApprovalUrl: url,
        lastResentAt: serverTimestamp(),
        lastResentByUserId: user?.uid || '',
        lastResentByUserName: actor,
        lastResentByEmail: user?.email || '',
        resendCount: increment(1),
        updatedAt: serverTimestamp(),
        history: arrayUnion(historyEvent),
      });

      const email = approval.customerEmail || approval.email || approval.billingEmail || '';
      if (email) {
        const subject = encodeURIComponent(`${recentlySelectedCompanyName || approval.companyName || 'Your pool company'} part approval`);
        const body = encodeURIComponent(`Hi ${approval.customerName || 'there'},\n\nPlease review this part approval:\n${url}\n\nThank you.`);
        window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
        toast.success('Approval link copied and email draft opened.');
      } else {
        toast.success('Approval link copied.');
      }
    } catch (resendError) {
      console.error('Unable to resend part approval', resendError);
      toast.error(resendError.message || 'Unable to resend approval.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const recentDeniedHistoryUrl = `/company/part-approvals/history?status=denied&from=${daysAgoDateParam(30)}&to=${todayDateParam()}`;
  const statusFilterLabel = statusFilter === 'active'
    ? 'Pending + Approved'
    : statusFilter === 'all'
      ? 'All statuses'
      : labelize(statusFilter);

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company approvals</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-950">Part Approvals</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Customer approvals for small parts before they move into the shopping, install, and invoice workflow.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              to="/company/part-approvals/history"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <FaHistory />
              Historic Approvals
            </Link>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              <FaPlus />
              New Part Approval
            </button>
          </div>
        </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={FaClock}
            label="Pending"
            value={summary.pendingCount}
            helper="Waiting on customer"
            onClick={() => setCardFilter('pending')}
            selected={statusFilter === 'pending'}
            title="Show pending part approvals"
          />
          <StatTile
            icon={FaCheckCircle}
            label="Approved"
            value={summary.approvedCount}
            helper="Ready to purchase"
            onClick={() => setCardFilter('approved')}
            selected={statusFilter === 'approved'}
            title="Show approved part approvals"
          />
          <StatTile
            icon={FaHistory}
            label="Recently Denied"
            value={summary.recentlyDeniedCount}
            helper="Last 30 days"
            to={recentDeniedHistoryUrl}
            title="Open recently denied approvals in history"
          />
          <StatTile icon={FaFileInvoiceDollar} label="Requested Value" value={formatCurrency(summary.totalValueCents)} helper="Customer-facing value" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 lg:grid-cols-[minmax(0,1fr)_190px]">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search by customer, job, part, or status"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="active">Pending + Approved</option>
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Denied</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          {error && <div className="border-b border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>Showing {filteredApprovals.length} of {approvals.length} approval{approvals.length === 1 ? "" : "s"}</div>
            <div>{statusFilterLabel}</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading part approvals...</div>
          ) : filteredApprovals.length === 0 ? (
            <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">No part approvals found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Part</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Job</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Shopping Item</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Updated</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
	                <tbody className="divide-y divide-slate-200 bg-white">
	                  {filteredApprovals.map((approval) => {
	                    const shoppingListItemId = approvalShoppingListItemId(approval);
	                    const isInstalled = approvalIsInstalled(approval);
	                    const isInvoiced = approvalIsInvoiced(approval);

                    return (
                      <tr key={approval.id} className="transition hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            onClick={() => setDetailApproval(approval)}
                            className="text-left font-semibold text-slate-950 hover:text-blue-700"
                          >
                            {approval.itemName || approval.name || 'Pool Part'}
                          </button>
                          <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{approval.description || 'Customer approval request'}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-semibold text-slate-900">{approval.customerName || 'Customer'}</p>
                          <p className="mt-1 text-xs text-slate-500">{approval.customerEmail || 'No email'}</p>
                        </td>
                        <td className="px-5 py-3">
                          {approval.jobId ? (
                            <Link to={`/company/jobs/detail/${approval.jobId}`} className="font-semibold text-blue-700 hover:text-blue-900">
                              {approval.jobInternalId || approval.jobName || approval.jobId}
                            </Link>
                          ) : (
                            <span className="text-slate-500">Not linked</span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-semibold text-slate-950">{formatCurrency(approvalTotalCents(approval))}</td>
	                        <td className="px-5 py-3">
	                          <StatusBadge status={approval.status || approval.approvalStatus} />
	                          {(isInstalled || isInvoiced) && (
	                            <div className="mt-1 flex flex-wrap gap-1">
	                              {isInstalled && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Installed</span>}
	                              {isInvoiced && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Invoiced</span>}
	                            </div>
	                          )}
	                        </td>
	                        <td className="px-5 py-3">
	                          {shoppingListItemId ? (
	                            <Link to={`/company/shopping-list/detail/${shoppingListItemId}`} className="font-semibold text-blue-700 hover:text-blue-900">
	                              Open
	                            </Link>
	                          ) : (
	                            <span className="text-slate-500">Created after approval</span>
	                          )}
	                        </td>
	                        <td className="px-5 py-3 text-slate-500">{formatDate(approval.updatedAt || approval.requestedAt || approval.createdAt)}</td>
	                        <td className="px-5 py-3 text-right">
	                          <button
	                            type="button"
	                            onClick={(event) => toggleApprovalActions(approval.id, event)}
	                            disabled={Boolean(workflowActionId)}
	                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
	                            aria-haspopup="menu"
	                            aria-expanded={openActionApprovalId === approval.id}
	                            aria-label={`Actions for ${approval.itemName || approval.name || 'part approval'}`}
	                            title="Actions"
	                          >
	                            <FaEllipsisV className="text-sm" />
	                          </button>
	                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
	        </section>
	      </div>

	      {openActionApproval && actionMenuPosition && (() => {
	        const invoiceId = approvalInvoiceId(openActionApproval);
	        const isInstalled = approvalIsInstalled(openActionApproval);
	        const isInvoiced = approvalIsInvoiced(openActionApproval);
	        const statusKey = normalizeStatus(openActionApproval.status || openActionApproval.approvalStatus || 'pending');
	        const approvalStatusKey = normalizeStatus(openActionApproval.approvalStatus || openActionApproval.status || 'pending');
	        const isApproved = approvalStatusKey === 'approved' || statusKey === 'approved' || statusKey === 'resolved';
	        const canConvertToInvoice = !invoiceId && approvalTotalCents(openActionApproval) > 0;
	        const working = Boolean(workflowActionId);

	        return (
	          <>
	            <button
	              type="button"
	              className="fixed inset-0 z-40 cursor-default"
	              aria-label="Close part approval actions"
	              onClick={closeApprovalActions}
	            />
	            <div
	              role="menu"
	              style={{
	                top: actionMenuPosition.top,
	                left: actionMenuPosition.left,
	              }}
	              className="fixed z-50 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
	            >
	              <PartApprovalActionMenuItem
	                label="See Details"
	                icon={FaEye}
	                onClick={() => {
	                  setDetailApproval(openActionApproval);
	                  closeApprovalActions();
	                }}
	              />
	              <PartApprovalActionMenuItem
	                label="Edit Status"
	                icon={FaEdit}
	                tone="blue"
	                onClick={() => {
	                  setStatusApproval(openActionApproval);
	                  closeApprovalActions();
	                }}
	              />
	              <PartApprovalActionMenuItem
	                label="Edit Part Approval"
	                icon={FaEdit}
	                onClick={() => {
	                  setEditApproval(openActionApproval);
	                  closeApprovalActions();
	                }}
	              />
	              <div className="my-1 border-t border-slate-100" />
	              <PartApprovalActionMenuItem
	                label="Mark Approved"
	                icon={FaCheckCircle}
	                tone="emerald"
	                disabled={working || isApproved}
	                title={isApproved ? 'This part approval is already approved.' : ''}
	                onClick={() => {
	                  saveApprovalStatus({ approval: openActionApproval, nextStatus: 'approved', note: 'Approved by company' });
	                  closeApprovalActions();
	                }}
	              />
	              <PartApprovalActionMenuItem
	                label="Mark Installed"
	                icon={FaTools}
	                tone="emerald"
	                loading={workflowActionId === `installed-${openActionApproval.id}`}
	                disabled={working || isInstalled}
	                title={isInstalled ? 'This part is already marked installed.' : ''}
	                onClick={() => {
	                  markApprovalInstalled(openActionApproval);
	                  closeApprovalActions();
	                }}
	              />
	              <PartApprovalActionMenuItem
	                label="Mark Invoiced"
	                icon={FaFileInvoiceDollar}
	                tone="blue"
	                loading={workflowActionId === `invoiced-${openActionApproval.id}`}
	                disabled={working || isInvoiced}
	                title={isInvoiced ? 'This part is already marked invoiced.' : ''}
	                onClick={() => {
	                  markApprovalManuallyInvoiced(openActionApproval);
	                  closeApprovalActions();
	                }}
	              />
	              {invoiceId ? (
	                <Link
	                  to={`/company/sales/invoices/${invoiceId}`}
	                  role="menuitem"
	                  onClick={closeApprovalActions}
	                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
	                >
	                  <FaFileInvoiceDollar className="h-4 w-4 shrink-0" />
	                  <span>Open Invoice</span>
	                </Link>
	              ) : (
	                <PartApprovalActionMenuItem
	                  label="Convert To Invoice"
	                  icon={FaFileInvoiceDollar}
	                  tone="blue"
	                  loading={workflowActionId === `invoice-${openActionApproval.id}`}
	                  disabled={working || !canConvertToInvoice}
	                  title={!canConvertToInvoice ? 'Add a billable amount before converting to an invoice.' : 'Create a draft invoice without emailing it.'}
	                  onClick={() => {
	                    convertApprovalToInvoice(openActionApproval);
	                    closeApprovalActions();
	                  }}
	                />
	              )}
	              <div className="my-1 border-t border-slate-100" />
	              <PartApprovalActionMenuItem
	                label="Resend Approval"
	                icon={FaSyncAlt}
	                disabled={working}
	                onClick={() => {
	                  resendApproval(openActionApproval);
	                  closeApprovalActions();
	                }}
	              />
	            </div>
	          </>
	        );
	      })()}

	      <PartApprovalCreateModal
	        open={showCreateModal}
	        onClose={() => setShowCreateModal(false)}
	      />
	      <PartApprovalDetailModal
	        approval={detailApproval}
	        working={workflowActionId}
	        onClose={closeDetailModal}
	        onEdit={(approval) => setEditApproval(approval)}
	        onEditStatus={(approval) => setStatusApproval(approval)}
	        onResend={resendApproval}
	        onMarkInstalled={markApprovalInstalled}
	        onMarkInvoiced={markApprovalManuallyInvoiced}
	        onConvertToInvoice={convertApprovalToInvoice}
	      />
      <PartApprovalStatusModal
        approval={statusApproval}
        working={workflowActionId}
        onClose={() => setStatusApproval(null)}
        onSave={saveApprovalStatus}
      />
	      <PartApprovalEditModal
	        approval={editApproval}
	        working={workflowActionId}
	        onClose={() => setEditApproval(null)}
	        onSave={saveApprovalEdits}
	        onDelete={deleteApproval}
	      />
    </div>
  );
};

const ModalShell = ({ title, eyebrow, children, onClose, maxWidth = 'max-w-3xl' }) => {
  if (!children) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className={`max-h-[92vh] w-full ${maxWidth} overflow-y-auto rounded-lg bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            {eyebrow && <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{eyebrow}</p>}
            <h2 className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const DetailField = ({ label, value }) => (
  <div>
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 font-semibold text-slate-900">{value || 'Not set'}</p>
  </div>
);

const PartApprovalDetailModal = ({
  approval,
  working,
  onClose,
  onEdit,
  onEditStatus,
  onResend,
  onMarkInstalled,
  onMarkInvoiced,
  onConvertToInvoice,
}) => {
  if (!approval) return null;

  const partName = approval.itemName || approval.name || approval.productName || approval.dbItemName || 'Pool Part';
  const history = approvalHistoryItems(approval);
  const productId = approvalProductId(approval);
  const dbItemId = approvalDatabaseItemId(approval);
  const catalogItemId = productId || dbItemId;
  const catalogItemName = approval.productName || approval.dbItemName || partName;
  const catalogItemLink = productId ? '/company/product-catalog' : dbItemId ? `/company/items/detail/${dbItemId}` : '';
  const catalogItemLabel = productId ? 'Product' : dbItemId ? 'Vendor Item' : 'Manual Part';
  const invoiceId = approvalInvoiceId(approval);
  const shoppingListItemId = approvalShoppingListItemId(approval);
  const isDatabaseItem = Boolean(catalogItemId);
  const isInstalled = approvalIsInstalled(approval);
  const isInvoiced = approvalIsInvoiced(approval);
  const canConvertToInvoice = !invoiceId && approvalTotalCents(approval) > 0;

  return (
    <ModalShell title={partName} eyebrow="Part approval details" onClose={onClose} maxWidth="max-w-5xl">
      <div className="space-y-5 p-5">
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <StatusBadge status={approval.status || approval.approvalStatus} />
            <p className="mt-2 text-sm text-slate-600">{approval.customerName || 'Customer'} · {formatCurrency(approvalTotalCents(approval))}</p>
	          </div>
	          <div className="flex flex-wrap gap-2">
	            <button type="button" onClick={() => onEdit(approval)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
	              <FaEdit />
	              Edit Part Approval
	            </button>
	            <button type="button" onClick={() => onEditStatus(approval)} className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
	              <FaEdit />
	              Edit Status
	            </button>
	            <button type="button" onClick={() => onMarkInstalled(approval)} disabled={Boolean(working) || isInstalled} className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">
	              <FaTools />
	              {working === `installed-${approval.id}` ? 'Installing...' : 'Mark Installed'}
	            </button>
	            <button type="button" onClick={() => onMarkInvoiced(approval)} disabled={Boolean(working) || isInvoiced} className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60">
	              <FaFileInvoiceDollar />
	              {working === `invoiced-${approval.id}` ? 'Saving...' : 'Mark Invoiced'}
	            </button>
	            {invoiceId ? (
	              <Link to={`/company/sales/invoices/${invoiceId}`} className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50">
	                <FaExternalLinkAlt />
	                Open Invoice
	              </Link>
	            ) : (
	              <button type="button" onClick={() => onConvertToInvoice(approval)} disabled={Boolean(working) || !canConvertToInvoice} className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60">
	                <FaFileInvoiceDollar />
	                {working === `invoice-${approval.id}` ? 'Creating...' : 'Convert To Invoice'}
	              </button>
	            )}
	            <button type="button" onClick={() => onResend(approval)} disabled={Boolean(working)} className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
	              <FaSyncAlt />
	              Resend
	            </button>
	          </div>
	        </div>

	        <div className="rounded-lg border border-slate-200 bg-white p-4">
	          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
	            <div>
	              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Item Source</p>
	              <div className="mt-2 flex flex-wrap items-center gap-2">
	                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${isDatabaseItem ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
	                  {catalogItemLabel}
	                </span>
	                {isInstalled && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Installed</span>}
	                {isInvoiced && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Invoiced</span>}
	              </div>
	            </div>
	            <div className="min-w-0 text-sm md:text-right">
	              {catalogItemLink ? (
	                <Link to={catalogItemLink} className="inline-flex items-center gap-2 font-semibold text-blue-700 hover:text-blue-900">
	                  {catalogItemName}
	                  <FaExternalLinkAlt className="text-xs" />
	                </Link>
	              ) : (
	                <p className="font-semibold text-slate-900">{partName}</p>
	              )}
	              <p className="mt-1 text-xs text-slate-500">
	                {catalogItemId ? `${catalogItemLabel} ID: ${catalogItemId}` : 'This approval is not connected to a product.'}
	              </p>
	            </div>
	          </div>
	        </div>

	        <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
	          <DetailField label="Customer" value={approval.customerName} />
	          <DetailField label="Email" value={approval.customerEmail || approval.email || approval.billingEmail} />
	          <DetailField label="Quantity" value={approval.quantity || '1'} />
	          <DetailField label="Unit Price" value={formatCurrency(approvalUnitPriceCents(approval))} />
	          <DetailField label="Item Type" value={catalogItemLabel} />
	          <DetailField label="Product" value={catalogItemLink ? (
	            <Link to={catalogItemLink} className="font-semibold text-blue-700 hover:text-blue-900">
	              {catalogItemName || catalogItemId}
	            </Link>
	          ) : 'Not linked'} />
	          <DetailField label="Job" value={approval.jobInternalId || approval.jobName || approval.jobId} />
	          <DetailField label="Service Stop" value={approval.serviceStopInternalId || approval.scheduledServiceStopInternalId || approval.serviceStopId} />
	          <DetailField label="Location" value={approval.serviceLocationName || approval.serviceLocationAddress || approval.serviceLocationId} />
	          <DetailField label="Shopping Item" value={shoppingListItemId ? (
	            <Link to={`/company/shopping-list/detail/${shoppingListItemId}`} className="font-semibold text-blue-700 hover:text-blue-900">
	              Open shopping item
	            </Link>
	          ) : 'Not created'} />
	          <DetailField label="Updated" value={formatDate(approval.updatedAt || approval.requestedAt || approval.createdAt)} />
	        </div>

        {approval.description && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer Note</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{approval.description}</p>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">History</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{history.length}</span>
          </div>
          {history.length ? (
            <div className="space-y-3">
              {history.map((item) => (
                <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{labelize(item.status || item.action)}</p>
                      <p className="text-xs font-semibold text-slate-500">{item.sourceLabel || 'Approval activity'}</p>
                    </div>
                    <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
                  </div>
                  {(item.actorUserName || item.actorEmail) && (
                    <p className="mt-2 text-xs text-slate-500">{compactUnique([item.actorUserName, item.actorEmail]).join(' · ')}</p>
                  )}
                  {item.note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.note}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No history recorded yet.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

const PartApprovalStatusModal = ({ approval, working, onClose, onSave }) => {
  const [nextStatus, setNextStatus] = useState('pending');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!approval) return;
    setNextStatus(normalizeStatus(approval.status || approval.approvalStatus || 'pending') || 'pending');
    setNote(approval.responseNote || '');
  }, [approval]);

  if (!approval) return null;

  const saving = working === `status-${approval.id}`;
  const willApprove = normalizeStatus(nextStatus) === 'approved';

  return (
    <ModalShell title="Edit Status" eyebrow={approval.itemName || approval.name || 'Part approval'} onClose={onClose} maxWidth="max-w-lg">
      <form
        className="space-y-4 p-5"
	        onSubmit={(event) => {
	          event.preventDefault();
	          onSave({ approval, nextStatus, note });
	        }}
      >
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Status</label>
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Status Note</label>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-[96px] w-full rounded-md border border-slate-300 p-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
	        {willApprove && !approvalShoppingListItemId(approval) && (
	          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
	            Saving as approved will create the connected shopping list item.
	          </div>
	        )}
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save Status'}</button>
        </div>
      </form>
    </ModalShell>
  );
};

const PartApprovalEditModal = ({ approval, working, onClose, onSave, onDelete }) => {
  const { recentlySelectedCompany } = useContext(Context);
  const [form, setForm] = useState({ mode: 'manual', itemName: '', description: '', quantity: '1', unitCost: '', unitPrice: '' });
  const [dbItems, setDbItems] = useState([]);
  const [selectedDbItem, setSelectedDbItem] = useState(null);
  const [loadingDbItems, setLoadingDbItems] = useState(false);

  useEffect(() => {
    if (!approval) return;

    const productId = approvalProductId(approval);
    const dbItemId = approvalDatabaseItemId(approval);
    const catalogItemId = productId || dbItemId;
    const fallbackDbItem = catalogItemId
      ? normalizeDbItemOption(catalogItemId, {
        id: catalogItemId,
        name: approval.productName || approval.dbItemName || approval.itemName || approval.name || 'Product',
        description: approval.description || '',
        genericItemId: productId || approval.genericItemId || '',
        productId,
        productName: approval.productName || '',
        rate: approvalUnitCostCents(approval),
        sellPrice: approvalUnitPriceCents(approval),
      })
      : null;

    setForm({
      mode: catalogItemId ? 'database' : 'manual',
      itemName: approval.itemName || approval.name || approval.productName || approval.dbItemName || '',
      description: approval.description || '',
      quantity: approval.quantity || '1',
      unitCost: String((approvalUnitCostCents(approval) / 100).toFixed(2)),
      unitPrice: String((approvalUnitPriceCents(approval) / 100).toFixed(2)),
    });
    setSelectedDbItem(fallbackDbItem);
  }, [approval]);

  useEffect(() => {
    if (!approval || !recentlySelectedCompany || form.mode !== 'database') return undefined;

    let active = true;
    const loadDbItems = async () => {
      setLoadingDbItems(true);
      try {
        const itemsSnap = await getDocs(productCatalogCollectionRef(db, recentlySelectedCompany));
        if (!active) return;

        const options = itemsSnap.docs
          .map((itemDoc) => normalizeDbItemOption(itemDoc.id, itemDoc.data()))
          .filter((item) => item.active !== false && item.availableForPartApproval)
          .sort((left, right) => left.name.localeCompare(right.name));
        setDbItems(options);

        const currentDbItemId = selectedDbItem?.id || approvalProductId(approval) || approvalDatabaseItemId(approval);
        if (currentDbItemId) {
          setSelectedDbItem((current) => options.find((item) => item.id === currentDbItemId) || current);
        }
      } catch (loadError) {
        console.error('Unable to load products for part approval edit', loadError);
        toast.error('Unable to load products.');
      } finally {
        if (active) setLoadingDbItems(false);
      }
    };

    loadDbItems();

    return () => {
      active = false;
    };
  }, [approval, form.mode, recentlySelectedCompany, selectedDbItem?.id]);

  if (!approval) return null;

  const saving = working === `edit-${approval.id}`;
  const deleting = working === `delete-${approval.id}`;
  const databaseMode = form.mode === 'database';
  const originallyDatabaseItem = isApprovalDatabaseItem(approval);
  const displayDbItem = selectedDbItem || null;
  const canSave = databaseMode ? Boolean(selectedDbItem) : Boolean(form.itemName.trim());

  return (
    <ModalShell title="Edit Part Approval" eyebrow={approval.customerName || 'Part approval'} onClose={onClose} maxWidth="max-w-2xl">
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            approval,
            form: {
              ...form,
              selectedDbItem,
            },
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Item Type</label>
            <select
              value={form.mode}
              disabled={originallyDatabaseItem}
              onChange={(event) => {
                const mode = event.target.value;
                setSelectedDbItem(null);
                setForm((current) => ({
                  ...current,
                  mode,
                  itemName: mode === 'manual' ? current.itemName : '',
                }));
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="manual">Manual Part</option>
              <option value="database">Product</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Quantity</label>
            <input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>

          {databaseMode ? (
            <>
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Product</label>
                <Select
                  value={selectedDbItem}
                  options={dbItems}
                  onChange={(option) => {
                    setSelectedDbItem(option);
                    setForm((current) => ({
                      ...current,
                      itemName: option?.name || '',
                    }));
                  }}
                  isLoading={loadingDbItems}
                  isSearchable
                  placeholder="Select a product"
                  noOptionsMessage={() => 'No part approval products available'}
                  styles={selectStyles}
                />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Connected Item</p>
                <p className="mt-1 font-semibold text-slate-900">{displayDbItem?.name || 'Select a product'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Unit Cost</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(displayDbItem?.unitCostCents || 0)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Unit Price</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(displayDbItem?.unitPriceCents || 0)}</p>
                </div>
              </div>
              <div className="sm:col-span-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                Product-linked item name, cost, and price come from the selected product. Change the selected product to change those values.
              </div>
            </>
          ) : (
            <>
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Part Name</label>
                <input value={form.itemName} onChange={(event) => setForm((current) => ({ ...current, itemName: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Unit Price</label>
                <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Unit Cost</label>
                <input type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Customer Note</label>
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[110px] w-full rounded-md border border-slate-300 p-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => onDelete(approval)} disabled={Boolean(working)} className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
            <FaTrash />
            {deleting ? 'Deleting...' : 'Delete Part Approval'}
          </button>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || !canSave} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
};

export default CompanyPartApprovals;
