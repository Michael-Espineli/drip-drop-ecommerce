import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
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
  FaEdit,
  FaEye,
  FaFileInvoiceDollar,
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
import { buildPartApprovalShoppingItemPayload } from '../../../utils/partApprovalShopping';
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

const StatTile = ({ icon: Icon, label, value, helper }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
      </div>
      <span className="rounded-md bg-slate-100 p-2 text-slate-600">
        <Icon />
      </span>
    </div>
    {helper && <p className="mt-2 text-sm text-slate-500">{helper}</p>}
  </div>
);

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

const CompanyPartApprovals = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, user } = useContext(Context);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [workflowActionId, setWorkflowActionId] = useState('');
  const [detailApproval, setDetailApproval] = useState(null);
  const [statusApproval, setStatusApproval] = useState(null);
  const [editApproval, setEditApproval] = useState(null);

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

  const filteredApprovals = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return approvals.filter((approval) => {
      const status = normalizeStatus(approval.status || approval.approvalStatus || 'pending');
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!search) return true;

      return [
        approval.itemName,
        approval.name,
        approval.description,
        approval.customerName,
        approval.customerEmail,
        approval.jobInternalId,
        approval.jobName,
        approval.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [approvals, searchTerm, statusFilter]);

  const summary = useMemo(() => {
    const pending = approvals.filter((approval) => normalizeStatus(approval.status || approval.approvalStatus) === 'pending');
    const approved = approvals.filter((approval) => normalizeStatus(approval.status || approval.approvalStatus) === 'approved');

    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      totalValueCents: approvals.reduce((total, approval) => total + approvalTotalCents(approval), 0),
    };
  }, [approvals]);

  const handleMarkInstalledAndInvoice = async (approval) => {
    if (!recentlySelectedCompany || !approval?.id || workflowActionId) return;

    const shoppingListItemId = approval.shoppingListItemId || approval.shoppingItemId || '';
    if (!shoppingListItemId) {
      toast.error('Approve this part first so a shopping list item is created.');
      return;
    }

    const totalAmountCents = approvalTotalCents(approval);
    if (totalAmountCents <= 0) {
      toast.error('Add a billable amount before sending an invoice.');
      return;
    }

    setWorkflowActionId(approval.id);

    try {
      const invoiceId = approval.invoiceId || `si_${uuidv4()}`;
      const quantity = Number.parseFloat(approval.quantity || '1') || 1;
      const unitAmountCents = approvalUnitPriceCents(approval);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      const lineItem = {
        id: `sili_${uuidv4()}`,
        sourceType: 'partApproval',
        sourceId: approval.id,
        catalogItemId: approval.dbItemId || '',
        name: approval.itemName || approval.name || approval.dbItemName || 'Pool Part',
        description: approval.description || '',
        quantity,
        unitAmountCents,
        totalAmountCents,
        taxable: false,
        type: 'material',
        metadata: {
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
        status: 'open',
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
        memo: `Installed approved part: ${lineItem.name}`,
        lineItems: [lineItem],
        serviceLocationSnapshots: buildServiceLocationSnapshots(approval),
        sourceType: 'partApproval',
        sourceId: approval.id,
        shoppingListItemId,
        partApprovalRequestId: approval.id,
        updatedAt: serverTimestamp(),
        createdAt: approval.invoiceId ? undefined : serverTimestamp(),
        createdByUserId: user?.uid || '',
      };

      Object.keys(invoicePayload).forEach((key) => {
        if (invoicePayload[key] === undefined) delete invoicePayload[key];
      });

      await setDoc(doc(db, salesCollectionNames.invoices, invoiceId), invoicePayload, { merge: true });
      await updateDoc(doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId), {
        status: 'Installed',
        needsAction: false,
        invoiced: true,
        invoiceId,
        salesInvoiceId: invoiceId,
        installedAt: serverTimestamp(),
        installedByUserId: user?.uid || '',
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'customerPartApprovals', approval.id), {
        status: 'resolved',
        approvalStatus: 'approved',
        fulfillmentStatus: 'installed',
        shoppingListItemId,
        invoiceId,
        salesInvoiceId: invoiceId,
        invoiced: true,
        installedAt: serverTimestamp(),
        resolvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        const authPayload = await getCallableAuthPayload();
        const sendCallable = httpsCallable(functions, 'sendSalesInvoiceEmail');
        const result = await sendCallable({
          ...authPayload,
          companyId: recentlySelectedCompany,
          invoiceId,
          invoiceBaseUrl: window.location.origin,
        });

        toast.success(result.data?.message || 'Part resolved and invoice sent.');
      } catch (sendError) {
        console.error('Part approval invoice email failed', sendError);
        toast.error('Invoice created, but the email could not be sent. Open the invoice to send it manually.');
      }
    } catch (workflowError) {
      console.error('Unable to resolve part approval', workflowError);
      toast.error(workflowError.message || 'Unable to resolve part approval.');
    } finally {
      setWorkflowActionId('');
    }
  };

  const saveApprovalStatus = async ({ approval, nextStatus, note = '', createShoppingItem = true }) => {
    if (!recentlySelectedCompany || !approval?.id || workflowActionId) return;

    const normalizedNextStatus = normalizeStatus(nextStatus || 'pending') || 'pending';
    const nowDate = new Date();
    const now = Timestamp.fromDate(nowDate);
    const actor = userDisplayName(user);
    const approvalRef = doc(db, 'customerPartApprovals', approval.id);
    const existingShoppingListItemId = approval.shoppingListItemId || approval.shoppingItemId || '';
    const shouldHaveShoppingItem = normalizedNextStatus === 'approved' && createShoppingItem;
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
        batch.set(
          doc(db, 'companies', recentlySelectedCompany, 'shoppingList', shoppingListItemId),
          {
            status: 'Customer Rejected',
            needsAction: true,
            customerApprovalStatus: 'rejected',
            customerApprovalResponse: 'rejected',
            customerApprovalResponseNote: note,
            customerApprovalRespondedAt: now,
            customerApprovalRespondedByUserId: user?.uid || '',
            customerApprovalRespondedByUserName: actor,
            customerApprovalRespondedByEmail: user?.email || '',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
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

    const quantity = Number.parseFloat(form.quantity || '1') || 1;
    const unitCostCents = Math.round((Number.parseFloat(form.unitCost || '0') || 0) * 100);
    const unitPriceCents = Math.round((Number.parseFloat(form.unitPrice || '0') || 0) * 100);
    const historyEvent = buildHistoryEvent({
      action: 'partEdited',
      status: approval.status || approval.approvalStatus || 'pending',
      note: 'Part details edited',
      source: 'companyWeb',
      sourceLabel: 'Company web app',
      user,
    });
    const updates = {
      itemName: form.itemName.trim() || 'Pool Part',
      name: form.itemName.trim() || 'Pool Part',
      description: form.description.trim(),
      quantity: String(quantity),
      plannedUnitCostCents: unitCostCents,
      plannedUnitPriceCents: unitPriceCents,
      plannedTotalCostCents: Math.round(unitCostCents * quantity),
      plannedTotalPriceCents: Math.round(unitPriceCents * quantity),
      updatedAt: serverTimestamp(),
      editedAt: serverTimestamp(),
      editedByUserId: user?.uid || '',
      editedByUserName: userDisplayName(user),
      history: arrayUnion(historyEvent),
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
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <FaPlus />
            New Part Approval
          </button>
        </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={FaClock} label="Pending" value={summary.pendingCount} helper="Waiting on customer" />
          <StatTile icon={FaCheckCircle} label="Approved" value={summary.approvedCount} helper="Ready to purchase" />
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
            <div>{statusFilter === "all" ? "All statuses" : labelize(statusFilter)}</div>
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
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredApprovals.map((approval) => {
                    const statusKey = normalizeStatus(approval.status || approval.approvalStatus || 'pending');
                    const isApproved = statusKey === 'approved';
                    const isResolved = statusKey === 'resolved' || normalizeStatus(approval.fulfillmentStatus) === 'installed';
                    const canResolve = isApproved && !isResolved && approval.shoppingListItemId && !approval.invoiceId;

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
                        <td className="px-5 py-3"><StatusBadge status={approval.status || approval.approvalStatus} /></td>
                        <td className="px-5 py-3">
                          {approval.shoppingListItemId ? (
                            <Link to={`/company/shopping-list/detail/${approval.shoppingListItemId}`} className="font-semibold text-blue-700 hover:text-blue-900">
                              Open
                            </Link>
                          ) : (
                            <span className="text-slate-500">Created after approval</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatDate(approval.updatedAt || approval.requestedAt || approval.createdAt)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setDetailApproval(approval)}
                              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                              <FaEye />
                              See Details
                            </button>
                            <button
                              type="button"
                              onClick={() => setStatusApproval(approval)}
                              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              <FaEdit />
                              Edit Status
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {approval.invoiceId ? (
                            <Link to={`/company/sales/invoices/${approval.invoiceId}`} className="font-semibold text-blue-700 hover:text-blue-900">
                              Open invoice
                            </Link>
                          ) : canResolve ? (
                            <button
                              type="button"
                              onClick={() => handleMarkInstalledAndInvoice(approval)}
                              disabled={workflowActionId === approval.id}
                              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <FaTools />
                              {workflowActionId === approval.id ? 'Working...' : 'Installed + Invoice'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">
                              {statusKey === 'pending'
                                ? 'Waiting on customer'
                                : statusKey === 'rejected'
                                  ? 'Customer rejected'
                                  : 'No action'}
                            </span>
                          )}
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

      <PartApprovalCreateModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
      <PartApprovalDetailModal
        approval={detailApproval}
        working={workflowActionId}
        onClose={() => setDetailApproval(null)}
        onEdit={(approval) => setEditApproval(approval)}
        onEditStatus={(approval) => setStatusApproval(approval)}
        onResend={resendApproval}
        onDelete={deleteApproval}
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
  onDelete,
}) => {
  if (!approval) return null;

  const partName = approval.itemName || approval.name || approval.dbItemName || 'Pool Part';
  const history = approvalHistoryItems(approval);

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
              Edit Part
            </button>
            <button type="button" onClick={() => onEditStatus(approval)} className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
              <FaEdit />
              Edit Status
            </button>
            <button type="button" onClick={() => onResend(approval)} disabled={Boolean(working)} className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
              <FaSyncAlt />
              Resend
            </button>
            <button type="button" onClick={() => onDelete(approval)} disabled={Boolean(working)} className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
              <FaTrash />
              Delete
            </button>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField label="Customer" value={approval.customerName} />
          <DetailField label="Email" value={approval.customerEmail || approval.email || approval.billingEmail} />
          <DetailField label="Quantity" value={approval.quantity || '1'} />
          <DetailField label="Unit Price" value={formatCurrency(approvalUnitPriceCents(approval))} />
          <DetailField label="Job" value={approval.jobInternalId || approval.jobName || approval.jobId} />
          <DetailField label="Service Stop" value={approval.serviceStopInternalId || approval.scheduledServiceStopInternalId || approval.serviceStopId} />
          <DetailField label="Location" value={approval.serviceLocationName || approval.serviceLocationAddress || approval.serviceLocationId} />
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
  const [createShoppingItem, setCreateShoppingItem] = useState(true);

  useEffect(() => {
    if (!approval) return;
    setNextStatus(normalizeStatus(approval.status || approval.approvalStatus || 'pending') || 'pending');
    setNote(approval.responseNote || '');
    setCreateShoppingItem(!approval.shoppingListItemId);
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
          onSave({ approval, nextStatus, note, createShoppingItem });
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
        {willApprove && !approval.shoppingListItemId && (
          <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={createShoppingItem} onChange={(event) => setCreateShoppingItem(event.target.checked)} />
            Create shopping list item
          </label>
        )}
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save Status'}</button>
        </div>
      </form>
    </ModalShell>
  );
};

const PartApprovalEditModal = ({ approval, working, onClose, onSave }) => {
  const [form, setForm] = useState({ itemName: '', description: '', quantity: '1', unitCost: '', unitPrice: '' });

  useEffect(() => {
    if (!approval) return;
    setForm({
      itemName: approval.itemName || approval.name || approval.dbItemName || '',
      description: approval.description || '',
      quantity: approval.quantity || '1',
      unitCost: String((Number(approval.plannedUnitCostCents || approval.unitCostCents || 0) / 100).toFixed(2)),
      unitPrice: String((approvalUnitPriceCents(approval) / 100).toFixed(2)),
    });
  }, [approval]);

  if (!approval) return null;

  const saving = working === `edit-${approval.id}`;

  return (
    <ModalShell title="Edit Part" eyebrow={approval.customerName || 'Part approval'} onClose={onClose} maxWidth="max-w-2xl">
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ approval, form });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Part Name</label>
            <input value={form.itemName} onChange={(event) => setForm((current) => ({ ...current, itemName: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Quantity</label>
            <input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Unit Price</label>
            <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Unit Cost</label>
            <input type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Customer Note</label>
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[110px] w-full rounded-md border border-slate-300 p-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving || !form.itemName.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </form>
    </ModalShell>
  );
};

export default CompanyPartApprovals;
