import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  FaBriefcase,
  FaCalendarAlt,
  FaFileContract,
  FaFileSignature,
  FaPlus,
  FaSearch,
  FaSyncAlt,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { SalesAgreementSourceType, salesCollectionNames } from '../../../utils/models/Sales';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const normalizeText = (value) => String(value || '').trim().toLowerCase();

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

const labelize = (value) => {
  if (!value) return 'Unknown';

  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const statusTone = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  estimate: 'border-sky-200 bg-sky-50 text-sky-700',
  revised: 'border-amber-200 bg-amber-50 text-amber-700',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-500',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-500',
  expired: 'border-slate-200 bg-slate-100 text-slate-500',
  past: 'border-slate-200 bg-slate-100 text-slate-500',
  invoiced: 'border-indigo-200 bg-indigo-50 text-indigo-700',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.draft;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const TypeBadge = ({ row }) => {
  const typeTone = row.estimateCategory === 'service'
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : 'border-violet-200 bg-violet-50 text-violet-700';

  return (
    <div className="flex flex-wrap gap-2">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${typeTone}`}>
        {row.kindLabel}
      </span>
      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
        {row.cadenceLabel}
      </span>
    </div>
  );
};

const StatTile = ({ icon: Icon, label, value, helper }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      </div>
      <span className="rounded-md bg-slate-100 p-2 text-slate-600">
        <Icon />
      </span>
    </div>
    {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
  </div>
);

const getLineItemsTotalCents = (lineItems = []) => (
  Array.isArray(lineItems)
    ? lineItems.reduce((total, item) => total + Number(item?.totalAmountCents || item?.amount || 0), 0)
    : 0
);

const getAgreementAmountCents = (agreement) => {
  const explicitTotal = Number(agreement.totalAmountCents || agreement.rateAmountCents || 0);
  if (explicitTotal) return explicitTotal;
  return getLineItemsTotalCents(agreement.lineItems);
};

const getContractAmountCents = (contract) => {
  const lineItemsTotal = getLineItemsTotalCents(contract.lineItems);
  if (lineItemsTotal) return lineItemsTotal;

  const rate = Number(contract.rate || 0);
  if (!rate) return 0;

  return contract.leadId && !contract.jobId ? Math.round(rate * 100) : rate;
};

const cadenceLabelForAgreement = (agreement) => {
  if (agreement.serviceCadence === 'oneTime' || agreement.rateType === 'oneTime') return 'One Time';

  const interval = agreement.serviceCadence || agreement.rateType || 'recurring';
  const count = Number(agreement.serviceCadenceCount || agreement.rateIntervalAmount || 1);

  if (!interval || interval === 'recurring') return 'Recurring';
  if (count > 1) return `Every ${count} ${labelize(interval).toLowerCase()}s`;
  return labelize(interval);
};

const cadenceLabelForRecurringContract = (contract) => {
  const interval = contract.rateInterval || contract.serviceCadence || 'Recurring';
  const count = Number(contract.rateIntervalAmount || contract.serviceCadenceCount || 1);

  if (count > 1 && interval) return `Every ${count} ${labelize(interval).toLowerCase()}s`;
  return labelize(interval);
};

const actionLinksForRow = (row) => {
  if (row.sourceCollection === salesCollectionNames.agreements) {
    const agreementLink = `/company/sales/agreements/${row.id}`;

    if (row.estimateCategory === 'job' && row.jobId) {
      return {
        primary: { to: `/company/jobs/detail/${row.jobId}`, label: 'Open Job' },
        secondary: { to: agreementLink, label: 'Agreement' },
      };
    }

    return {
      primary: { to: agreementLink, label: 'Open Agreement' },
      secondary: null,
    };
  }

  if (row.sourceCollection === 'recurringContracts') {
    return {
      primary: { to: `/company/recurring-contracts/detail/${row.id}`, label: 'Open Recurring' },
      secondary: null,
    };
  }

  if (row.jobId) {
    return {
      primary: { to: `/company/jobs/detail/${row.jobId}`, label: 'Open Job' },
      secondary: { to: `/company/contract/detail/${row.id}`, label: 'Contract' },
    };
  }

  if (row.leadId) {
    return {
      primary: { to: `/company/leads/${row.leadId}`, label: 'Open Lead' },
      secondary: { to: `/company/contract/detail/${row.id}`, label: 'Contract' },
    };
  }

  return {
    primary: { to: `/company/contract/detail/${row.id}`, label: 'Open Contract' },
    secondary: null,
  };
};

const normalizeSalesAgreement = (docSnap) => {
  const data = docSnap.data();
  const sourceType = data.sourceType || '';
  const jobId = data.jobId || data.workOrderId || (
    sourceType === SalesAgreementSourceType.oneOffJob ? data.sourceId : ''
  ) || '';
  const isJobEstimate =
    sourceType === SalesAgreementSourceType.oneOffJob ||
    data.rateType === 'oneTime' ||
    data.serviceCadence === 'oneTime' ||
    Boolean(jobId);

  return {
    id: docSnap.id,
    sourceCollection: salesCollectionNames.agreements,
    sourceLabel: 'Sales Agreement',
    estimateCategory: isJobEstimate ? 'job' : 'service',
    cadenceType: isJobEstimate ? 'oneTime' : 'recurring',
    kindLabel: isJobEstimate ? 'Job Estimate' : 'Service Agreement',
    cadenceLabel: cadenceLabelForAgreement(data),
    title: data.title || (isJobEstimate ? 'Job Estimate' : 'Service Agreement'),
    customerName: data.customerName || data.receiverName || 'Customer',
    customerDetail: data.email || data.termsTemplateName || (data.id ? 'Sales agreement' : ''),
    status: data.status || 'draft',
    statusKey: normalizeStatus(data.status || 'draft'),
    amountCents: getAgreementAmountCents(data),
    updatedAt: data.updatedAt || data.sentAt || data.createdAt || null,
    sentAt: data.sentAt || null,
    acceptBy: data.expiresAt || null,
    jobId: isJobEstimate ? jobId : '',
    leadId: data.leadId || '',
    searchText: [
      data.title,
      data.customerName,
      data.email,
      data.status,
      data.termsTemplateName,
      data.sourceType,
      data.sourceId,
      data.jobId,
    ].join(' '),
    raw: data,
  };
};

const normalizeLegacyContract = (docSnap) => {
  const data = docSnap.data();

  return {
    id: docSnap.id,
    sourceCollection: 'contracts',
    sourceLabel: data.salesAgreementId ? 'Linked Contract' : 'Legacy Contract',
    estimateCategory: 'job',
    cadenceType: 'oneTime',
    kindLabel: data.jobId ? 'Job Estimate' : 'One-Time Estimate',
    cadenceLabel: 'One Time',
    title: data.title || data.jobInternalId || data.notes || 'One-Time Estimate',
    customerName: data.customerName || data.receiverName || 'Customer',
    customerDetail: data.jobInternalId || (data.leadId ? 'Linked lead' : data.receiverId ? 'Linked customer' : data.id ? 'Legacy estimate' : ''),
    status: data.status || 'Draft',
    statusKey: normalizeStatus(data.status || 'Draft'),
    amountCents: getContractAmountCents(data),
    updatedAt: data.updatedAt || data.dateSent || data.createdAt || null,
    sentAt: data.dateSent || null,
    acceptBy: data.lastDateToAccept || null,
    jobId: data.jobId || '',
    leadId: data.leadId || '',
    linkedSalesAgreementId: data.salesAgreementId || '',
    searchText: [
      data.title,
      data.customerName,
      data.receiverName,
      data.status,
      data.notes,
      data.jobInternalId,
      data.jobId,
      data.leadId,
    ].join(' '),
    raw: data,
  };
};

const normalizeLegacyRecurringContract = (docSnap) => {
  const data = docSnap.data();

  return {
    id: docSnap.id,
    sourceCollection: 'recurringContracts',
    sourceLabel: 'Legacy Recurring',
    estimateCategory: 'service',
    cadenceType: 'recurring',
    kindLabel: 'Service Agreement',
    cadenceLabel: cadenceLabelForRecurringContract(data),
    title: data.title || data.notes || 'Recurring Service Agreement',
    customerName: data.customerName || data.receiverName || 'Customer',
    customerDetail: data.email || (data.receiverId || data.customerId ? 'Linked customer' : data.id ? 'Recurring agreement' : ''),
    status: data.status || 'Draft',
    statusKey: normalizeStatus(data.status || 'Draft'),
    amountCents: Number(data.rate || 0),
    updatedAt: data.updatedAt || data.dateSent || data.createdAt || null,
    sentAt: data.dateSent || null,
    acceptBy: data.dateToAccept || data.lastDateToAccept || null,
    jobId: '',
    leadId: '',
    searchText: [
      data.title,
      data.customerName,
      data.receiverName,
      data.status,
      data.notes,
      data.rateInterval,
      data.customerId,
    ].join(' '),
    raw: data,
  };
};

const EstimatesTable = ({ rows, loading }) => {
  if (loading) {
    return <div className="p-5 text-sm text-slate-500">Loading estimates...</div>;
  }

  if (!rows.length) {
    return (
      <div className="p-8 text-center">
        <p className="font-semibold text-slate-800">No estimates found</p>
        <p className="mt-1 text-sm text-slate-500">
          Create a service agreement or job estimate, or adjust your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3">Estimate</th>
            <th className="px-5 py-3">Customer</th>
            <th className="px-5 py-3">Type</th>
            <th className="px-5 py-3">Amount</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Updated</th>
            <th className="px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => {
            const actions = actionLinksForRow(row);

            return (
              <tr key={`${row.sourceCollection}-${row.id}`} className="transition hover:bg-slate-50">
                <td className="px-5 py-4 align-top">
                  <p className="font-semibold text-slate-950">{row.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.sourceLabel}</p>
                </td>
                <td className="px-5 py-4 align-top">
                  <p className="font-medium text-slate-900">{row.customerName}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.customerDetail || 'No customer detail'}</p>
                </td>
                <td className="px-5 py-4 align-top">
                  <TypeBadge row={row} />
                </td>
                <td className="px-5 py-4 align-top font-semibold text-slate-950">
                  {formatCurrency(row.amountCents)}
                </td>
                <td className="px-5 py-4 align-top">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-5 py-4 align-top text-slate-500">
                  <p>{formatDate(row.updatedAt)}</p>
                  {row.acceptBy && (
                    <p className="mt-1 text-xs">Accept by {formatDate(row.acceptBy)}</p>
                  )}
                </td>
                <td className="px-5 py-4 align-top">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={actions.primary.to}
                      className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                    >
                      {actions.primary.label}
                    </Link>
                    {actions.secondary && (
                      <Link
                        to={actions.secondary.to}
                        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        {actions.secondary.label}
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function Estimates() {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const { can } = useCompanyPermissions();

  const [salesAgreementRows, setSalesAgreementRows] = useState([]);
  const [legacyContractRows, setLegacyContractRows] = useState([]);
  const [legacyRecurringRows, setLegacyRecurringRows] = useState([]);
  const [loadingSources, setLoadingSources] = useState({
    salesAgreements: true,
    contracts: true,
    recurringContracts: true,
  });
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [cadenceFilter, setCadenceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setSalesAgreementRows([]);
      setLegacyContractRows([]);
      setLegacyRecurringRows([]);
      setLoadingSources({ salesAgreements: false, contracts: false, recurringContracts: false });
      return undefined;
    }

    setError('');
    setLoadingSources({ salesAgreements: true, contracts: true, recurringContracts: true });

    const unsubscribeSalesAgreements = onSnapshot(
      query(
        collection(db, salesCollectionNames.agreements),
        where('companyId', '==', recentlySelectedCompany)
      ),
      (snapshot) => {
        setSalesAgreementRows(snapshot.docs.map(normalizeSalesAgreement));
        setLoadingSources((prev) => ({ ...prev, salesAgreements: false }));
      },
      (snapshotError) => {
        console.error('Error loading sales agreement estimates:', snapshotError);
        setError('Unable to load Sales agreement estimates.');
        setLoadingSources((prev) => ({ ...prev, salesAgreements: false }));
      }
    );

    const unsubscribeContracts = onSnapshot(
      query(
        collection(db, 'contracts'),
        where('senderId', '==', recentlySelectedCompany)
      ),
      (snapshot) => {
        setLegacyContractRows(snapshot.docs.map(normalizeLegacyContract));
        setLoadingSources((prev) => ({ ...prev, contracts: false }));
      },
      (snapshotError) => {
        console.error('Error loading legacy contract estimates:', snapshotError);
        setError('Unable to load legacy contract estimates.');
        setLoadingSources((prev) => ({ ...prev, contracts: false }));
      }
    );

    const unsubscribeRecurringContracts = onSnapshot(
      query(
        collection(db, 'recurringContracts'),
        where('senderId', '==', recentlySelectedCompany)
      ),
      (snapshot) => {
        setLegacyRecurringRows(snapshot.docs.map(normalizeLegacyRecurringContract));
        setLoadingSources((prev) => ({ ...prev, recurringContracts: false }));
      },
      (snapshotError) => {
        console.error('Error loading recurring contract estimates:', snapshotError);
        setError('Unable to load recurring service agreements.');
        setLoadingSources((prev) => ({ ...prev, recurringContracts: false }));
      }
    );

    return () => {
      unsubscribeSalesAgreements();
      unsubscribeContracts();
      unsubscribeRecurringContracts();
    };
  }, [recentlySelectedCompany]);

  const allRows = useMemo(() => {
    const linkedAgreementIds = new Set(
      salesAgreementRows
        .map((row) => row.id)
        .filter(Boolean)
    );

    const unlinkedLegacyContracts = legacyContractRows.filter((row) => (
      !row.linkedSalesAgreementId || !linkedAgreementIds.has(row.linkedSalesAgreementId)
    ));

    return [...salesAgreementRows, ...unlinkedLegacyContracts, ...legacyRecurringRows]
      .sort((a, b) => toMillis(b.updatedAt || b.sentAt) - toMillis(a.updatedAt || a.sentAt));
  }, [legacyContractRows, legacyRecurringRows, salesAgreementRows]);

  const statusOptions = useMemo(() => {
    const statuses = new Map();

    allRows.forEach((row) => {
      if (row.statusKey) statuses.set(row.statusKey, row.status);
    });

    return Array.from(statuses.entries())
      .sort((a, b) => labelize(a[1]).localeCompare(labelize(b[1])));
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const search = normalizeText(searchTerm);

    return allRows.filter((row) => {
      if (typeFilter !== 'all' && row.estimateCategory !== typeFilter) return false;
      if (cadenceFilter !== 'all' && row.cadenceType !== cadenceFilter) return false;
      if (statusFilter !== 'all' && row.statusKey !== statusFilter) return false;

      if (!search) return true;

      return normalizeText([
        row.title,
        row.customerName,
        row.customerDetail,
        row.kindLabel,
        row.cadenceLabel,
        row.status,
        row.sourceLabel,
        row.searchText,
      ].join(' ')).includes(search);
    });
  }, [allRows, cadenceFilter, searchTerm, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const serviceRows = allRows.filter((row) => row.estimateCategory === 'service');
    const jobRows = allRows.filter((row) => row.estimateCategory === 'job');
    const recurringRows = allRows.filter((row) => row.cadenceType === 'recurring');
    const oneTimeRows = allRows.filter((row) => row.cadenceType === 'oneTime');

    return {
      serviceCount: serviceRows.length,
      jobCount: jobRows.length,
      recurringCount: recurringRows.length,
      oneTimeCount: oneTimeRows.length,
      totalValueCents: allRows.reduce((total, row) => total + Number(row.amountCents || 0), 0),
    };
  }, [allRows]);

  const loading = Object.values(loadingSources).some(Boolean);
  const selectedCompanyName = recentlySelectedCompanyName || 'Selected company';

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {selectedCompanyName}
                </span>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  One-time and recurring
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-bold text-slate-950">Estimates</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Review service agreements and job estimates from the same queue.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {can('622') && (
                <>
                  <Link
                    to="/company/sales/agreements/new"
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    <FaPlus className="text-xs" />
                    Service Agreement
                  </Link>
                  <Link
                    to="/company/jobs/createNew"
                    className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                  >
                    <FaPlus className="text-xs" />
                    Job Estimate
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <StatTile icon={FaFileSignature} label="Service Agreements" value={summary.serviceCount} helper="Recurring estimate flow" />
          <StatTile icon={FaBriefcase} label="Job Estimates" value={summary.jobCount} helper="One-time job flow" />
          <StatTile icon={FaSyncAlt} label="Recurring" value={summary.recurringCount} helper="Service cadence" />
          <StatTile icon={FaCalendarAlt} label="One-Time" value={summary.oneTimeCount} helper="Job or lead work" />
          <StatTile icon={FaFileContract} label="Quoted Value" value={formatCurrency(summary.totalValueCents)} helper="Current visible sources" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 xl:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search customer, job, agreement, status, or source"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All Types</option>
              <option value="service">Service Agreements</option>
              <option value="job">Job Estimates</option>
            </select>
            <select
              value={cadenceFilter}
              onChange={(event) => setCadenceFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All Cadence</option>
              <option value="recurring">Recurring</option>
              <option value="oneTime">One Time</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All Statuses</option>
              {statusOptions.map(([statusKey, status]) => (
                <option key={statusKey} value={statusKey}>{labelize(status)}</option>
              ))}
            </select>
          </div>

          <EstimatesTable rows={filteredRows} loading={loading} />
        </section>
      </div>
    </div>
  );
}

export default Estimates;
