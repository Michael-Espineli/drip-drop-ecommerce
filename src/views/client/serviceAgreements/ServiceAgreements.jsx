import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  DocumentTextIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { SalesAgreementStatus, salesCollectionNames } from '../../../utils/models/Sales';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

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

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const statusTone = {
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  revised: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  expired: 'border-slate-200 bg-slate-100 text-slate-600',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.draft;

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
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
        <Icon className="h-5 w-5" />
      </span>
    </div>
    {helper && <p className="mt-2 text-sm text-slate-500">{helper}</p>}
  </div>
);

const ServiceAgreements = () => {
  const { user } = useContext(Context);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!user?.uid) {
      setAgreements([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', user.uid)),
      (snapshot) => {
        const nextAgreements = snapshot.docs
          .map((agreementDoc) => ({ id: agreementDoc.id, ...agreementDoc.data() }))
          .filter((agreement) => agreement.customerUserId === user.uid)
          .sort((left, right) => {
            const rightMillis = toMillis(right.updatedAt || right.sentAt || right.createdAt);
            const leftMillis = toMillis(left.updatedAt || left.sentAt || left.createdAt);
            return rightMillis - leftMillis;
          });

        setAgreements(nextAgreements);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load service agreements', snapshotError);
        setError(snapshotError.message || 'Unable to load service agreements.');
        setLoading(false);
      }
    );
  }, [user]);

  const summary = useMemo(() => {
    const pending = agreements.filter((agreement) => ['sent', 'revised', 'draft'].includes(normalizeStatus(agreement.status)));
    const accepted = agreements.filter((agreement) => normalizeStatus(agreement.status) === normalizeStatus(SalesAgreementStatus.accepted));

    return {
      pendingCount: pending.length,
      acceptedCount: accepted.length,
      totalValueCents: agreements.reduce((total, agreement) => total + Number(agreement.totalAmountCents || agreement.rateAmountCents || 0), 0),
    };
  }, [agreements]);

  const filteredAgreements = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return agreements;

    return agreements.filter((agreement) => [
      agreement.title,
      agreement.companyName,
      agreement.customerName,
      agreement.email,
      agreement.id,
      agreement.status,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search)));
  }, [agreements, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Service Agreements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review agreements from pool service companies and track what has been accepted.
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile icon={ClockIcon} label="Needs Review" value={summary.pendingCount} helper="Sent, revised, or draft agreements" />
        <StatTile icon={CheckCircleIcon} label="Accepted" value={summary.acceptedCount} helper="Approved agreements" />
        <StatTile icon={DocumentTextIcon} label="Agreement Value" value={formatCurrency(summary.totalValueCents)} helper="Total visible agreement amount" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-900">Agreements</p>
            <p className="text-sm text-slate-500">{filteredAgreements.length} record{filteredAgreements.length === 1 ? '' : 's'} shown</p>
          </div>

          <label className="relative w-full sm:w-80">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Search agreements"
              type="search"
            />
          </label>
        </div>

        {error && (
          <div className="border-b border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading service agreements...</div>
        ) : filteredAgreements.length === 0 ? (
          <div className="p-8 text-center">
            <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-800">No service agreements found.</p>
            <p className="mt-1 text-sm text-slate-500">When a company sends one to this account, it will show here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Agreement</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Company</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Updated</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredAgreements.map((agreement) => (
                  <tr key={agreement.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-950">{agreement.title || 'Service Agreement'}</p>
                      <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{agreement.description || "Service agreement"}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{agreement.companyName || 'Pool company'}</td>
                    <td className="px-5 py-4 font-semibold text-slate-950">
                      {formatCurrency(agreement.totalAmountCents || agreement.rateAmountCents)}
                    </td>
                    <td className="px-5 py-4"><StatusBadge status={agreement.status || SalesAgreementStatus.draft} /></td>
                    <td className="px-5 py-4 text-slate-500">{formatDate(agreement.updatedAt || agreement.sentAt || agreement.createdAt)}</td>
                    <td className="px-5 py-4">
                      <Link
                        to={`/client/service-agreements/${agreement.id}`}
                        className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ServiceAgreements;
