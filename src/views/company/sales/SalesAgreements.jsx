import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  FaArrowLeft,
  FaCheckCircle,
  FaEnvelope,
  FaFileSignature,
  FaPlus,
  FaSearch,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { SalesAgreementStatus, salesCollectionNames } from '../../../utils/models/Sales';
import FeatureInfoButton from '../../../components/FeatureInfoButton';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

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

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const statusTone = {
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
  sent: 'bg-sky-50 text-sky-700 border-sky-200',
  revised: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  canceled: 'bg-slate-100 text-slate-500 border-slate-200',
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

const SalesAgreements = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');

  const navigate = useNavigate();
  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAgreements([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      query(
        collection(db, salesCollectionNames.agreements),
        where('companyId', '==', recentlySelectedCompany)
      ),
      (snapshot) => {
        const nextAgreements = snapshot.docs
          .map((agreementDoc) => ({ id: agreementDoc.id, ...agreementDoc.data() }))
          .sort((left, right) => toMillis(right.updatedAt || right.createdAt) - toMillis(left.updatedAt || left.createdAt));

        setAgreements(nextAgreements);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load service agreements', snapshotError);
        setError(snapshotError.message || 'Unable to load service agreements.');
        setLoading(false);
      }
    );
  }, [recentlySelectedCompany]);

  const filteredAgreements = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return agreements.filter((agreement) => {
      const matchesStatus = statusFilter === 'all' || normalizeStatus(agreement.status) === normalizeStatus(statusFilter);
      if (!matchesStatus) return false;

      if (!normalizedSearch) return true;

      return [
        agreement.title,
        agreement.customerName,
        agreement.email,
        agreement.status,
        agreement.termsTemplateName,
        agreement.id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [agreements, searchTerm, statusFilter]);

  const summary = useMemo(() => {
    const sentCount = agreements.filter((agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.sent).length;
    const acceptedCount = agreements.filter((agreement) => normalizeStatus(agreement.status) === SalesAgreementStatus.accepted).length;
    const totalAmountCents = agreements.reduce(
      (total, agreement) => total + (Number(agreement.totalAmountCents || agreement.rateAmountCents) || 0),
      0
    );

    return {
      sentCount,
      acceptedCount,
      totalAmountCents,
    };
  }, [agreements]);

  const selectedCompanyName = recentlySelectedCompanyName || 'Selected company';
  const statusOptions = ['all', ...Object.values(SalesAgreementStatus)];

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
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
                <h1 className="text-3xl font-bold text-slate-950">Service Agreements</h1>
                <FeatureInfoButton title="How Service Agreements Work" align="left">
                  <p>
                    Service agreements are customer-facing billing snapshots built from company catalog items,
                    service locations, and company-scoped terms templates.
                  </p>
                  <p>
                    Drafts can be reviewed, emailed through SendGrid, accepted by the customer, and later connected
                    to Stripe subscriptions or invoice workflows.
                  </p>
                </FeatureInfoButton>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Search, review, and send customer service agreement snapshots.
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
                to="/company/sales/agreements/new"
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                <FaPlus className="text-xs" />
                New Agreement
              </Link>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={FaFileSignature} label="Agreements" value={agreements.length} helper="All statuses" />
          <StatTile icon={FaEnvelope} label="Sent" value={summary.sentCount} helper="Waiting on customer" />
          <StatTile icon={FaCheckCircle} label="Accepted" value={summary.acceptedCount} helper="Ready for billing" />
          <StatTile icon={FaFileSignature} label="Quoted Value" value={formatCurrency(summary.totalAmountCents)} helper="Draft and active total" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search by customer, agreement, email, status, or template"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All Statuses' : labelize(status)}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-5 text-sm text-slate-500">Loading service agreements...</div>
            ) : filteredAgreements.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-800">No service agreements found</p>
                <p className="mt-1 text-sm text-slate-500">
                  Create a new agreement or adjust your search filters.
                </p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Agreement</th>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Sent</th>
                    <th className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredAgreements.map((agreement) => (
                    <tr key={agreement.id} className="transition hover:bg-slate-50"
                      onClick={() => navigate(`/company/sales/agreements/${agreement.id}`)}>
                      <td className="px-5 py-4">
                        {agreement.title || 'Service Agreement'}
                        <p className="mt-1 text-xs text-slate-500">{agreement.termsTemplateName || "Service agreement"}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-900">{agreement.customerName || 'Customer'}</p>
                        <p className="mt-1 text-xs text-slate-500">{agreement.email || 'No email'}</p>
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-900">
                        {formatCurrency(agreement.totalAmountCents || agreement.rateAmountCents)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={agreement.status} />
                      </td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(agreement.sentAt)}</td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(agreement.updatedAt || agreement.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SalesAgreements;
