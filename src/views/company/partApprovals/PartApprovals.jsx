import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import {
  FaCheckCircle,
  FaClock,
  FaFileInvoiceDollar,
  FaPlus,
  FaSearch,
  FaTools,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { salesCollectionNames } from '../../../utils/models/Sales';
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
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
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

const CompanyPartApprovals = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, user } = useContext(Context);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [workflowActionId, setWorkflowActionId] = useState('');

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

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || 'Selected company'}</p>
              <h1 className="text-3xl font-bold text-slate-950">Part Approvals</h1>
              <p className="max-w-3xl text-sm text-slate-600">
                Customer approvals for small parts before they move into the shopping, install, and invoice workflow.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              <FaPlus />
              New Part Approval
            </button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
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
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          {error && <div className="border-b border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading part approvals...</div>
          ) : filteredApprovals.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No part approvals found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Part</th>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3">Job</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Shopping Item</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3">Workflow</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredApprovals.map((approval) => {
                    const statusKey = normalizeStatus(approval.status || approval.approvalStatus || 'pending');
                    const isApproved = statusKey === 'approved';
                    const isResolved = statusKey === 'resolved' || normalizeStatus(approval.fulfillmentStatus) === 'installed';
                    const canResolve = isApproved && !isResolved && approval.shoppingListItemId && !approval.invoiceId;

                    return (
                      <tr key={approval.id} className="transition hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-950">{approval.itemName || approval.name || 'Pool Part'}</p>
                          <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{approval.description || 'Customer approval request'}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900">{approval.customerName || 'Customer'}</p>
                          <p className="mt-1 text-xs text-slate-500">{approval.customerEmail || 'No email'}</p>
                        </td>
                        <td className="px-5 py-4">
                          {approval.jobId ? (
                            <Link to={`/company/jobs/detail/${approval.jobId}`} className="font-semibold text-blue-700 hover:text-blue-900">
                              {approval.jobInternalId || approval.jobName || approval.jobId}
                            </Link>
                          ) : (
                            <span className="text-slate-500">Not linked</span>
                          )}
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(approvalTotalCents(approval))}</td>
                        <td className="px-5 py-4"><StatusBadge status={approval.status || approval.approvalStatus} /></td>
                        <td className="px-5 py-4">
                          {approval.shoppingListItemId ? (
                            <Link to={`/company/shopping-list/detail/${approval.shoppingListItemId}`} className="font-semibold text-blue-700 hover:text-blue-900">
                              Open
                            </Link>
                          ) : (
                            <span className="text-slate-500">Created after approval</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-slate-500">{formatDate(approval.updatedAt || approval.requestedAt || approval.createdAt)}</td>
                        <td className="px-5 py-4">
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
    </div>
  );
};

export default CompanyPartApprovals;
