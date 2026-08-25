import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  collection,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  FaArchive,
  FaChevronLeft,
  FaChevronRight,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaHistory,
  FaSearch,
  FaShoppingCart,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';

const pageSizeOptions = [10, 25, 50];
const defaultLookbackDays = 90;
const historicStatusQueryValues = [
  'resolved',
  'rejected',
  'declined',
  'denied',
  'finished',
  'complete',
  'completed',
  'Resolved',
  'Rejected',
  'Declined',
  'Denied',
  'Finished',
  'Complete',
  'Completed',
];
const historicStatusKeys = new Set([
  'resolved',
  'rejected',
  'declined',
  'denied',
  'finished',
  'complete',
  'completed',
]);
const historicFulfillmentKeys = new Set([
  'installed',
  'resolved',
  'rejected',
  'declined',
  'denied',
  'finished',
  'complete',
  'completed',
]);
const historyStatusFilterOptions = [
  { value: 'all', label: 'All Historic' },
  { value: 'denied', label: 'Denied' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'finished', label: 'Finished' },
];
const validHistoryStatusFilters = new Set(historyStatusFilterOptions.map((option) => option.value));
const deniedHistoryStatusKeys = new Set(['rejected', 'declined', 'denied']);
const resolvedHistoryStatusKeys = new Set(['resolved']);
const finishedHistoryStatusKeys = new Set(['finished', 'complete', 'completed', 'installed']);
const historyStatusQueryValuesByFilter = {
  all: historicStatusQueryValues,
  denied: ['rejected', 'declined', 'denied', 'Rejected', 'Declined', 'Denied'],
  resolved: ['resolved', 'Resolved'],
  finished: ['finished', 'complete', 'completed', 'Finished', 'Complete', 'Completed'],
};
const fallbackReadMultiplier = 3;
const maxFallbackReadLimit = 151;

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

const formatCurrency = (amountCents = 0) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format((Number(amountCents) || 0) / 100);

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return 'Not set';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(millis));
};

const dateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const todayInputValue = () => dateInputValue(new Date());

const daysAgoInputValue = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateInputValue(date);
};

const dateFromInput = (value, boundary = 'start') => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;

  return boundary === 'end'
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
};

const labelize = (value) => {
  const key = normalizeStatus(value);
  if (!key) return 'Historic';
  if (key === 'rejected' || key === 'denied') return 'Declined';

  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const statusTone = {
  resolved: 'border-blue-200 bg-blue-50 text-blue-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  declined: 'border-rose-200 bg-rose-50 text-rose-700',
  denied: 'border-rose-200 bg-rose-50 text-rose-700',
  finished: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const StatusBadge = ({ approval }) => {
  const status = approval.status || approval.approvalStatus || approval.fulfillmentStatus || 'historic';
  const key = normalizeStatus(status);
  const tone = statusTone[key] || 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const approvalTotalCents = (approval = {}) => {
  const total = Number(approval.plannedTotalPriceCents || approval.totalPriceCents || 0);
  if (total > 0) return total;

  const quantity = Number.parseFloat(approval.quantity || '1') || 1;
  const unit = Number(approval.plannedUnitPriceCents || approval.unitPriceCents || 0);
  return Math.round(unit * quantity);
};

const approvalInvoiceId = (approval = {}) => approval.invoiceId || approval.salesInvoiceId || '';

const approvalShoppingListItemId = (approval = {}) => approval.shoppingListItemId || approval.shoppingItemId || '';

const historicDate = (approval = {}) => (
  approval.resolvedAt ||
  approval.finishedAt ||
  approval.completedAt ||
  approval.declinedAt ||
  approval.deniedAt ||
  approval.rejectedAt ||
  approval.installedAt ||
  approval.respondedAt ||
  approval.updatedAt ||
  approval.createdAt
);

const isHistoricApproval = (approval = {}) => (
  historicStatusKeys.has(normalizeStatus(approval.status)) ||
  historicStatusKeys.has(normalizeStatus(approval.approvalStatus)) ||
  historicFulfillmentKeys.has(normalizeStatus(approval.fulfillmentStatus)) ||
  Boolean(
    approval.resolvedAt ||
    approval.finishedAt ||
    approval.completedAt ||
    approval.declinedAt ||
    approval.deniedAt ||
    approval.rejectedAt
  )
);

const sanitizeHistoryStatusFilter = (value) => {
  const key = normalizeStatus(value);
  return validHistoryStatusFilters.has(key) ? key : 'all';
};

const hasAnyHistoryStatus = (approval = {}, statusKeys = new Set()) => [
  approval.status,
  approval.approvalStatus,
  approval.fulfillmentStatus,
  approval.response,
].some((status) => statusKeys.has(normalizeStatus(status)));

const historyFilterMatchesApproval = (approval = {}, filter = 'all') => {
  if (filter === 'all') return true;
  if (filter === 'denied') {
    return hasAnyHistoryStatus(approval, deniedHistoryStatusKeys) || Boolean(
      approval.declinedAt ||
      approval.deniedAt ||
      approval.rejectedAt
    );
  }
  if (filter === 'resolved') {
    return hasAnyHistoryStatus(approval, resolvedHistoryStatusKeys) || Boolean(approval.resolvedAt);
  }
  if (filter === 'finished') {
    return hasAnyHistoryStatus(approval, finishedHistoryStatusKeys) || Boolean(
      approval.finishedAt ||
      approval.completedAt ||
      approval.installedAt
    );
  }

  return true;
};

const compactText = (values = []) => values.filter(Boolean).join(' - ');

const isIndexError = (error = {}) => (
  error.code === 'failed-precondition' ||
  String(error.message || '').toLowerCase().includes('index')
);

const CompanyPartApprovalHistory = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const [searchParams] = useSearchParams();
  const [approvals, setApprovals] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState(() => sanitizeHistoryStatusFilter(searchParams.get('status')));
  const [pageSize, setPageSize] = useState(25);
  const [startDate, setStartDate] = useState(() => {
    const initialStartDate = searchParams.get('from');
    return dateFromInput(initialStartDate, 'start') ? initialStartDate : daysAgoInputValue(defaultLookbackDays);
  });
  const [endDate, setEndDate] = useState(() => {
    const initialEndDate = searchParams.get('to');
    return dateFromInput(initialEndDate, 'end') ? initialEndDate : todayInputValue();
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState([null]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentCursor = pageCursors[pageIndex] || null;
  const startDateValue = useMemo(() => dateFromInput(startDate, 'start'), [startDate]);
  const endDateValue = useMemo(() => dateFromInput(endDate, 'end'), [endDate]);
  const validDateRange = Boolean(startDateValue && endDateValue && startDateValue <= endDateValue);

  useEffect(() => {
    setPageIndex(0);
    setPageCursors([null]);
    setNextCursor(null);
    setHasNextPage(false);
  }, [endDate, historyStatusFilter, pageSize, recentlySelectedCompany, startDate]);

  useEffect(() => {
    if (!recentlySelectedCompany || !validDateRange) {
      setApprovals([]);
      setLoading(false);
      setError(validDateRange ? '' : 'Choose a valid date range.');
      return undefined;
    }

    let active = true;

    const loadPage = async () => {
      setLoading(true);
      setError('');

      try {
        const buildPageQuery = (includeStatusFilter) => {
          const statusQueryValues = historyStatusQueryValuesByFilter[historyStatusFilter] || historyStatusQueryValuesByFilter.all;
          const fetchLimit = includeStatusFilter
            ? pageSize + 1
            : Math.min((pageSize * fallbackReadMultiplier) + 1, maxFallbackReadLimit);
          const constraints = [
            where('companyId', '==', recentlySelectedCompany),
            where('updatedAt', '>=', Timestamp.fromDate(startDateValue)),
            where('updatedAt', '<=', Timestamp.fromDate(endDateValue)),
            orderBy('updatedAt', 'desc'),
            firestoreLimit(fetchLimit),
          ];

          if (includeStatusFilter) {
            constraints.splice(1, 0, where('status', 'in', statusQueryValues));
          }

          if (currentCursor) {
            constraints.splice(constraints.length - 1, 0, startAfter(currentCursor));
          }

          return query(collection(db, 'customerPartApprovals'), ...constraints);
        };

        let snapshot;
        let filteredByStatus = true;

        try {
          snapshot = await getDocs(buildPageQuery(true));
        } catch (queryError) {
          if (!isIndexError(queryError)) throw queryError;
          filteredByStatus = false;
          snapshot = await getDocs(buildPageQuery(false));
        }

        if (!active) return;

        const historicPairs = snapshot.docs
          .map((approvalDoc) => ({
            doc: approvalDoc,
            approval: { id: approvalDoc.id, ...approvalDoc.data() },
          }))
          .filter(({ approval }) => isHistoricApproval(approval) && historyFilterMatchesApproval(approval, historyStatusFilter));
        const visiblePairs = historicPairs.slice(0, pageSize);
        const fetchedReadLimit = filteredByStatus
          ? pageSize + 1
          : Math.min((pageSize * fallbackReadMultiplier) + 1, maxFallbackReadLimit);

        setApprovals(visiblePairs.map(({ approval }) => approval));
        setHasNextPage(historicPairs.length > pageSize || snapshot.docs.length >= fetchedReadLimit);
        setNextCursor(visiblePairs[visiblePairs.length - 1]?.doc || snapshot.docs[snapshot.docs.length - 1] || null);
      } catch (loadError) {
        console.error('Unable to load historic part approvals', loadError);
        if (!active) return;

        setApprovals([]);
        setHasNextPage(false);
        setNextCursor(null);
        setError(loadError.message || 'Unable to load historic part approvals.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadPage();

    return () => {
      active = false;
    };
  }, [currentCursor, endDateValue, historyStatusFilter, pageIndex, pageSize, recentlySelectedCompany, startDateValue, validDateRange]);

  const filteredApprovals = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const historyFilteredApprovals = approvals.filter((approval) => historyFilterMatchesApproval(approval, historyStatusFilter));
    if (!search) return historyFilteredApprovals;

    return historyFilteredApprovals.filter((approval) => [
      approval.itemName,
      approval.name,
      approval.description,
      approval.customerName,
      approval.customerEmail,
      approval.dbItemName,
      approval.jobInternalId,
      approval.jobName,
      approval.status,
      approval.approvalStatus,
      approval.fulfillmentStatus,
      approvalInvoiceId(approval),
      approvalShoppingListItemId(approval),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search)));
  }, [approvals, historyStatusFilter, searchTerm]);

  const summary = useMemo(() => ({
    visibleCount: filteredApprovals.length,
    totalValueCents: filteredApprovals.reduce((total, approval) => total + approvalTotalCents(approval), 0),
    declinedCount: filteredApprovals.filter((approval) => {
      const status = normalizeStatus(approval.status || approval.approvalStatus);
      return status === 'rejected' || status === 'declined' || status === 'denied';
    }).length,
  }), [filteredApprovals]);

  const setLookbackDays = (days) => {
    setStartDate(daysAgoInputValue(days));
    setEndDate(todayInputValue());
  };

  const goToPreviousPage = () => {
    if (pageIndex === 0 || loading) return;
    setPageIndex((current) => Math.max(0, current - 1));
  };

  const goToNextPage = () => {
    if (!hasNextPage || !nextCursor || loading) return;

    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Company approvals</p>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">Historic Part Approvals</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Finished, resolved, and declined part approval records.
              </p>
            </div>
            <Link
              to="/company/part-approvals"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <FaHistory />
              Active Approvals
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Visible</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{summary.visibleCount}</p>
              </div>
              <span className="rounded-md bg-slate-100 p-2 text-slate-600"><FaArchive /></span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Declined</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{summary.declinedCount}</p>
              </div>
              <span className="rounded-md bg-rose-50 p-2 text-rose-700"><FaHistory /></span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Value</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(summary.totalValueCents)}</p>
              </div>
              <span className="rounded-md bg-blue-50 p-2 text-blue-700"><FaFileInvoiceDollar /></span>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 xl:grid-cols-[minmax(0,1fr)_150px_160px_160px_130px_auto]">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search customer, part, job, invoice, or shopping item"
              />
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Status</span>
              <select
                value={historyStatusFilter}
                onChange={(event) => setHistoryStatusFilter(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {historyStatusFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Rows</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              {[30, 90, 365].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setLookbackDays(days)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>

          {error && <div className="border-b border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

          <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>{formatDate(startDateValue)} to {formatDate(endDateValue)}</div>
            <div>Page {pageIndex + 1}</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading historic approvals...</div>
          ) : filteredApprovals.length === 0 ? (
            <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
              No historic part approvals found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Part</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</th>
                    <th className="border-b border-slate-200 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Links</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredApprovals.map((approval) => {
                    const invoiceId = approvalInvoiceId(approval);
                    const shoppingListItemId = approvalShoppingListItemId(approval);

                    return (
                      <tr key={approval.id} className="transition hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <Link
                            to={`/company/part-approvals?approvalId=${encodeURIComponent(approval.id)}`}
                            className="font-semibold text-slate-950 hover:text-blue-700"
                          >
                            {approval.itemName || approval.name || approval.dbItemName || 'Pool Part'}
                          </Link>
                          <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{approval.description || approval.dbItemName || 'Part approval'}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-semibold text-slate-900">{approval.customerName || 'Customer'}</p>
                          <p className="mt-1 text-xs text-slate-500">{approval.customerEmail || approval.email || 'No email'}</p>
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge approval={approval} />
                          {approval.fulfillmentStatus ? (
                            <p className="mt-1 text-xs text-slate-500">{labelize(approval.fulfillmentStatus)}</p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 font-semibold text-slate-950">{formatCurrency(approvalTotalCents(approval))}</td>
                        <td className="px-5 py-3 text-slate-500">{formatDate(historicDate(approval))}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-2">
                            {approval.jobId ? (
                              <Link to={`/company/jobs/detail/${approval.jobId}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                Job
                                <FaExternalLinkAlt className="text-[10px]" />
                              </Link>
                            ) : null}
                            {shoppingListItemId ? (
                              <Link to={`/company/shopping-list/detail/${shoppingListItemId}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                <FaShoppingCart className="text-[10px]" />
                                Shopping
                              </Link>
                            ) : null}
                            {invoiceId ? (
                              <Link to={`/company/sales/invoices/${invoiceId}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                <FaFileInvoiceDollar className="text-[10px]" />
                                Invoice
                              </Link>
                            ) : null}
                            <Link to={`/company/part-approvals?approvalId=${encodeURIComponent(approval.id)}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Open
                            </Link>
                          </div>
                          {approval.jobId || shoppingListItemId || invoiceId ? (
                            <p className="mt-1 text-[11px] text-slate-400">{compactText([approval.jobInternalId || approval.jobName, shoppingListItemId, invoiceId])}</p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-600">
              Showing {filteredApprovals.length} approval{filteredApprovals.length === 1 ? '' : 's'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToPreviousPage}
                disabled={pageIndex === 0 || loading}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaChevronLeft className="text-xs" />
                Previous
              </button>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                Page {pageIndex + 1}
              </span>
              <button
                type="button"
                onClick={goToNextPage}
                disabled={!hasNextPage || loading}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <FaChevronRight className="text-xs" />
              </button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};

export default CompanyPartApprovalHistory;
