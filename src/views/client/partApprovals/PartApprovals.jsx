import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  CheckCircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';

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
        <Icon className="h-5 w-5" />
      </span>
    </div>
    {helper && <p className="mt-2 text-sm text-slate-500">{helper}</p>}
  </div>
);

const PartApprovals = () => {
  const { user } = useContext(Context);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!user?.uid) {
      setApprovals([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      query(collection(db, 'customerPartApprovals'), where('customerUserId', '==', user.uid)),
      (snapshot) => {
        const nextApprovals = snapshot.docs
          .map((approvalDoc) => ({ id: approvalDoc.id, ...approvalDoc.data() }))
          .filter((approval) => approval.customerUserId === user.uid)
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
  }, [user]);

  const summary = useMemo(() => {
    const pending = approvals.filter((approval) => normalizeStatus(approval.status || approval.approvalStatus) === 'pending');
    const approved = approvals.filter((approval) => normalizeStatus(approval.status || approval.approvalStatus) === 'approved');

    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      totalValueCents: approvals.reduce((total, approval) => total + Number(approval.plannedTotalPriceCents || approval.totalPriceCents || 0), 0),
    };
  }, [approvals]);

  const filteredApprovals = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return approvals;

    return approvals.filter((approval) => [
      approval.itemName,
      approval.name,
      approval.description,
      approval.companyName,
      approval.jobInternalId,
      approval.customerName,
      approval.status,
      approval.approvalStatus,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search)));
  }, [approvals, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8">
      <div className="w-full space-y-6">
        <section>
          <h1 className="text-3xl font-bold text-slate-950">Part Approvals</h1>
          <p className="mt-2 text-sm text-slate-600">
            Review requested pool parts before the company purchases or installs them.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <StatTile icon={ClockIcon} label="Needs Review" value={summary.pendingCount} helper="Waiting for your approval" />
          <StatTile icon={CheckCircleIcon} label="Approved" value={summary.approvedCount} helper="Released to shopping list" />
          <StatTile icon={WrenchScrewdriverIcon} label="Part Value" value={formatCurrency(summary.totalValueCents)} helper="Visible requested value" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search part approvals"
              />
            </div>
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
                    <th className="px-5 py-3">Company</th>
                    <th className="px-5 py-3">Qty</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredApprovals.map((approval) => (
                    <tr key={approval.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-950">{approval.itemName || approval.name || 'Pool Part'}</p>
                        <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{approval.description || approval.jobInternalId || 'Part approval'}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-700">{approval.companyName || 'Pool company'}</td>
                      <td className="px-5 py-4 text-slate-700">{approval.quantity || '1'}</td>
                      <td className="px-5 py-4 font-semibold text-slate-950">{formatCurrency(approval.plannedTotalPriceCents || approval.totalPriceCents)}</td>
                      <td className="px-5 py-4"><StatusBadge status={approval.status || approval.approvalStatus} /></td>
                      <td className="px-5 py-4 text-slate-500">{formatDate(approval.updatedAt || approval.requestedAt || approval.createdAt)}</td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/client/part-approvals/${approval.id}`}
                          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
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
        </section>
      </div>
    </div>
  );
};

export default PartApprovals;
