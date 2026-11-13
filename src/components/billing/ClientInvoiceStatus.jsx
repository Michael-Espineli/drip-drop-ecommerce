import React from 'react';
import { ArrowPathIcon, ArrowUturnLeftIcon, CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import './ClientInvoiceStatus.css';

const key = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

export function clientInvoiceStatus(invoice, balanceCents, now = new Date()) {
  const status = key(invoice.status);
  if (status === 'draft') return { label: 'Draft', tone: 'slate', Icon: ClockIcon };
  if (['void', 'voided', 'canceled', 'cancelled'].includes(status)) return { label: 'Void', tone: 'slate', Icon: ClockIcon };
  if (status === 'uncollectible') return { label: 'Written off', tone: 'slate', Icon: ClockIcon };
  if (invoice.paymentReviewRequired || status === 'paymentreview') return { label: 'Needs review', tone: 'amber', Icon: ExclamationTriangleIcon };
  if (status === 'refunded') return { label: 'Refunded', tone: 'violet', Icon: ArrowUturnLeftIcon };
  if (status === 'partiallyrefunded') return { label: 'Partially refunded', tone: 'violet', Icon: ArrowUturnLeftIcon };
  if (invoice.paymentProcessing || status === 'processing') return { label: 'Processing', tone: 'blue', Icon: ArrowPathIcon };
  if (balanceCents > 0) {
    const due = invoice.dueDate;
    // Due today stays Due through the local calendar day. Public links return
    // ISO dates; signed-in records carry Firestore Timestamps.
    const dateOnly = typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due);
    const date = dateOnly ? new Date(...due.split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0)))
      : new Date(due?.toMillis?.() ?? due?.toDate?.()?.getTime() ?? (due?.seconds != null ? due.seconds * 1000 : due ?? NaN));
    date.setHours(23, 59, 59, 999);
    const late = ['overdue', 'late', 'pastdue'].includes(status) || now.getTime() > date.getTime();
    return { label: late ? 'Late' : 'Due', tone: late ? 'rose' : 'blue', Icon: late ? ExclamationTriangleIcon : ClockIcon };
  }
  if (status === 'paid') return { label: 'Paid', tone: 'emerald', Icon: CheckCircleIcon };
  return { label: 'No balance due', tone: 'slate', Icon: CheckCircleIcon };
}

export default function ClientInvoiceStatus({ invoice, balanceCents, onRefresh }) {
  const { label, tone, Icon } = clientInvoiceStatus(invoice, balanceCents);
  return <button type="button" onClick={onRefresh}
    className={`client-invoice-status workspace-status-${tone}`}
    aria-label={`Invoice status: ${label}. Refresh status`} title="Refresh invoice status">
    <Icon className="h-8 w-8 shrink-0" aria-hidden="true" />
    <span className="min-w-0 text-left" aria-live="polite" aria-atomic="true">
      <span className="client-invoice-status-caption">Invoice status</span>
      <span className="client-invoice-status-label">{label}</span>
    </span>
  </button>;
}
