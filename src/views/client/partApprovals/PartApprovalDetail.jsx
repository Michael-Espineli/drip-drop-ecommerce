import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

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

const Field = ({ label, value }) => (
  <div>
    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 font-semibold text-slate-900">{value || 'Not set'}</dd>
  </div>
);

const PartApprovalDetail = () => {
  const { approvalId } = useParams();
  const { user } = useContext(Context);
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [responding, setResponding] = useState('');

  useEffect(() => {
    if (!approvalId) {
      setError('Missing approval id.');
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      doc(db, 'customerPartApprovals', approvalId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setApproval(null);
          setError('Part approval was not found.');
          setLoading(false);
          return;
        }

        const data = { id: snapshot.id, ...snapshot.data() };
        const hasLinkedUser = Boolean(data.customerUserId);
        const authEmail = normalizeEmail(user?.email);
        const approvalEmail = normalizeEmail(data.customerEmail || data.email || data.billingEmail);
        const canView = data.customerUserId === user?.uid || (!hasLinkedUser && authEmail && approvalEmail === authEmail);

        if (!canView) {
          setApproval(null);
          setError('This part approval does not belong to your account.');
          setLoading(false);
          return;
        }

        setApproval(data);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load part approval', snapshotError);
        setError(snapshotError.message || 'Unable to load part approval.');
        setLoading(false);
      }
    );
  }, [approvalId, user?.email, user?.uid]);

  const statusKey = normalizeStatus(approval?.status || approval?.approvalStatus || 'pending');
  const isPending = statusKey === 'pending';
  const totalPriceCents = approval?.plannedTotalPriceCents || approval?.totalPriceCents || 0;
  const unitPriceCents = approval?.plannedUnitPriceCents || approval?.unitPriceCents || 0;

  const partName = useMemo(
    () => approval?.itemName || approval?.name || approval?.dbItemName || 'Pool Part',
    [approval]
  );

  const respond = async (action) => {
    if (!approval || !isPending || responding) return;

    setResponding(action);
    try {
      const authPayload = await getCallableAuthPayload();
      const callable = httpsCallable(functions, 'respondToCustomerPartApproval');
      await callable({
        ...authPayload,
        approvalId: approval.id,
        action,
        responseNote,
      });
      toast.success(action === 'approved' ? 'Part approved.' : 'Part rejected.');
    } catch (responseError) {
      console.error('Unable to respond to part approval', responseError);
      toast.error(responseError.message || 'Unable to save your response.');
    } finally {
      setResponding('');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-500">Loading part approval...</div>;
  }

  if (error || !approval) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <Link to="/client/part-approvals" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
          <ArrowLeftIcon className="h-4 w-4" />
          Part Approvals
        </Link>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          {error || 'Part approval was not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-4 lg:px-6">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <section>
          <Link to="/client/part-approvals" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
            <ArrowLeftIcon className="h-4 w-4" />
            Part Approvals
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">{partName}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {approval.companyName || 'Pool company'} requested approval before purchasing or installing this part.
              </p>
            </div>
            <StatusBadge status={approval.status || approval.approvalStatus} />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <main className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Part Details</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Part" value={partName} />
                <Field label="Quantity" value={approval.quantity || '1'} />
                <Field label="Unit Price" value={formatCurrency(unitPriceCents)} />
                <Field label="Total" value={formatCurrency(totalPriceCents)} />
                <Field label="Job" value={approval.jobInternalId || approval.jobName || approval.jobId} />
                <Field label="Service Location" value={approval.serviceLocationName || approval.serviceLocationId} />
              </dl>
              {approval.description && (
                <p className="mt-5 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {approval.description}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Response</h2>
              {isPending ? (
                <>
                  <textarea
                    value={responseNote}
                    onChange={(event) => setResponseNote(event.target.value)}
                    className="mt-4 min-h-[120px] w-full rounded-md border border-slate-300 p-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Optional note"
                  />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => respond('approved')}
                      disabled={Boolean(responding)}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCircleIcon className="h-5 w-5" />
                      {responding === 'approved' ? 'Approving...' : 'Approve Part'}
                    </button>
                    <button
                      type="button"
                      onClick={() => respond('rejected')}
                      disabled={Boolean(responding)}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <XCircleIcon className="h-5 w-5" />
                      {responding === 'rejected' ? 'Rejecting...' : 'Reject Part'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Response recorded {formatDate(approval.respondedAt || approval.updatedAt)}.
                  {approval.responseNote && <p className="mt-2 whitespace-pre-wrap">{approval.responseNote}</p>}
                </div>
              )}
            </div>
          </main>

          <aside className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Request Snapshot</h2>
              <dl className="mt-4 space-y-4">
                <Field label="Company" value={approval.companyName} />
                <Field label="Requested" value={formatDate(approval.requestedAt || approval.createdAt)} />
                <Field label="Customer" value={approval.customerName || user?.email} />
                <Field label="Status" value={labelize(approval.status || approval.approvalStatus)} />
              </dl>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
};

export default PartApprovalDetail;
