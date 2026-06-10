import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaEdit,
  FaEnvelope,
  FaExternalLinkAlt,
  FaFileContract,
  FaFileInvoiceDollar,
  FaReceipt,
  FaSave,
  FaTimes,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db, functions } from '../../../utils/config';
import {
  SalesInvoiceDeliveryMethod,
  SalesInvoiceStatus,
  SalesPaymentMethod,
  SalesPaymentStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import {
  invoiceBalanceCents,
  recordManualSalesPayment,
} from '../../../utils/sales/manualBilling';

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

const toInputDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return '';
  return new Date(millis).toISOString().split('T')[0];
};

const dateFromInput = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const centsToInput = (amountCents = 0) => ((Number(amountCents) || 0) / 100).toFixed(2);

const moneyInputToCents = (value) => Math.round((Number(value) || 0) * 100);

const manualPaymentMethods = [
  SalesPaymentMethod.cash,
  SalesPaymentMethod.check,
  SalesPaymentMethod.externalCard,
  SalesPaymentMethod.bankTransfer,
  SalesPaymentMethod.other,
];

const statusTone = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  open: 'border-sky-200 bg-sky-50 text-sky-700',
  partiallypaid: 'border-amber-200 bg-amber-50 text-amber-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  void: 'border-slate-200 bg-slate-100 text-slate-600',
  uncollectible: 'border-rose-200 bg-rose-50 text-rose-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
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

const Field = ({ label, value }) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value || 'Not set'}</dd>
  </div>
);

const TextInput = ({ label, value, onChange, type = 'text', min, step }) => (
  <label className="space-y-1.5">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    <input
      type={type}
      min={min}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
    />
  </label>
);

const SelectInput = ({ label, value, onChange, options }) => (
  <label className="space-y-1.5">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
    >
      {options.map((option) => (
        <option key={option} value={option}>{labelize(option)}</option>
      ))}
    </select>
  </label>
);

const createDraft = (invoice) => ({
  invoiceNumber: invoice?.invoiceNumber || '',
  customerName: invoice?.customerName || '',
  email: invoice?.email || '',
  status: invoice?.status || SalesInvoiceStatus.draft,
  deliveryMethod: invoice?.deliveryMethod || SalesInvoiceDeliveryMethod.email,
  dueDate: toInputDate(invoice?.dueDate),
  discountAmount: centsToInput(invoice?.discountAmountCents),
  taxAmount: centsToInput(invoice?.taxAmountCents),
  writeOffAmount: centsToInput(invoice?.writeOffAmountCents),
  memo: invoice?.memo || '',
  lineItems: (Array.isArray(invoice?.lineItems) ? invoice.lineItems : []).map((item, index) => ({
    id: item.id || `line_${index}`,
    catalogItemId: item.catalogItemId || '',
    sourceType: item.sourceType || 'manual',
    sourceId: item.sourceId || '',
    name: item.name || item.description || '',
    description: item.description || '',
    quantity: String(item.quantity || 1),
    unitAmount: centsToInput(item.unitAmountCents),
    taxable: Boolean(item.taxable),
    type: item.type || '',
    stripeProductId: item.stripeProductId || '',
    stripePriceId: item.stripePriceId || '',
    metadata: item.metadata || {},
  })),
});

const blankLineItem = () => ({
  id: `sili_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  catalogItemId: '',
  sourceType: 'manual',
  sourceId: '',
  name: '',
  description: '',
  quantity: '1',
  unitAmount: '0.00',
  taxable: false,
  type: 'manual',
  stripeProductId: '',
  stripePriceId: '',
  metadata: {},
});

const SalesInvoiceDetail = () => {
  const { invoiceId } = useParams();
  const { recentlySelectedCompany, recentlySelectedCompanyName, stripeConnectedAccountId, user } = useContext(Context);
  const [invoice, setInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: SalesPaymentMethod.cash,
    referenceNumber: '',
    memo: '',
  });
  const [savingPayment, setSavingPayment] = useState(false);

  useEffect(() => {
    if (!invoiceId) {
      setInvoice(null);
      setLoading(false);
      setError('Missing invoice id.');
      return undefined;
    }

    setLoading(true);
    setError('');

    return onSnapshot(
      doc(db, salesCollectionNames.invoices, invoiceId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setInvoice(null);
          setError('Invoice not found.');
          setLoading(false);
          return;
        }

        const nextInvoice = { id: snapshot.id, ...snapshot.data() };
        setInvoice(nextInvoice);
        setDraft((current) => (current && editing ? current : createDraft(nextInvoice)));
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load sales invoice', snapshotError);
        setError(snapshotError.message || 'Unable to load invoice.');
        setLoading(false);
      }
    );
  }, [editing, invoiceId]);

  useEffect(() => {
    if (!invoiceId || !invoice?.companyId) {
      setPayments([]);
      return undefined;
    }

    return onSnapshot(
      query(
        collection(db, salesCollectionNames.payments),
        where('companyId', '==', invoice.companyId),
        where('invoiceId', '==', invoiceId)
      ),
      (snapshot) => {
        const nextPayments = snapshot.docs
          .map((paymentDoc) => ({ id: paymentDoc.id, ...paymentDoc.data() }))
          .sort((left, right) => toMillis(right.receivedAt || right.createdAt) - toMillis(left.receivedAt || left.createdAt));
        setPayments(nextPayments);
      },
      (snapshotError) => {
        console.error('Unable to load invoice payments', snapshotError);
      }
    );
  }, [invoice?.companyId, invoiceId]);

  const companyMismatch = Boolean(
    invoice &&
    recentlySelectedCompany &&
    invoice.companyId &&
    invoice.companyId !== recentlySelectedCompany
  );
  const balanceCents = invoice ? invoiceBalanceCents(invoice) : 0;
  const lineItems = useMemo(
    () => (Array.isArray(invoice?.lineItems) ? invoice.lineItems : []),
    [invoice]
  );
  const draftTotals = useMemo(() => {
    const draftLineItems = Array.isArray(draft?.lineItems) ? draft.lineItems : [];
    const subtotalAmountCents = draftLineItems.reduce((total, item) => {
      const quantity = Math.max(Number(item.quantity || 0), 0);
      return total + (moneyInputToCents(item.unitAmount) * quantity);
    }, 0);
    const discountAmountCents = Math.max(moneyInputToCents(draft?.discountAmount), 0);
    const taxAmountCents = Math.max(moneyInputToCents(draft?.taxAmount), 0);
    const writeOffAmountCents = Math.max(moneyInputToCents(draft?.writeOffAmount), 0);
    const totalAmountCents = Math.max(subtotalAmountCents - discountAmountCents + taxAmountCents, 0);
    const amountDueCents = Math.max(totalAmountCents - Number(invoice?.amountPaidCents || 0) - writeOffAmountCents, 0);

    return {
      subtotalAmountCents,
      discountAmountCents,
      taxAmountCents,
      writeOffAmountCents,
      totalAmountCents,
      amountDueCents,
    };
  }, [draft, invoice?.amountPaidCents]);

  const canSend = Boolean(
    invoice &&
    !companyMismatch &&
    !editing &&
    !sending &&
    invoice.email &&
    lineItems.length > 0 &&
    !['paid', 'void', 'uncollectible'].includes(normalizeStatus(invoice.status))
  );
  const canVoid = Boolean(
    invoice &&
    !companyMismatch &&
    !voiding &&
    !['paid', 'void'].includes(normalizeStatus(invoice.status))
  );
  const canRecordPayment = Boolean(
    invoice &&
    !companyMismatch &&
    !editing &&
    balanceCents > 0 &&
    !savingPayment &&
    !['void', 'uncollectible'].includes(normalizeStatus(invoice.status))
  );

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const updateLineItem = (lineItemId, field, value) => {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item) => (
        item.id === lineItemId ? { ...item, [field]: value } : item
      )),
    }));
  };

  const addLineItem = () => {
    setDraft((current) => ({
      ...current,
      lineItems: [...(current.lineItems || []), blankLineItem()],
    }));
  };

  const removeLineItem = (lineItemId) => {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.filter((item) => item.id !== lineItemId),
    }));
  };

  const startEditing = () => {
    setDraft(createDraft(invoice));
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(createDraft(invoice));
    setEditing(false);
  };

  const openPaymentModal = () => {
    setPaymentForm({
      amount: balanceCents > 0 ? centsToInput(balanceCents) : '',
      method: SalesPaymentMethod.cash,
      referenceNumber: '',
      memo: '',
    });
    setPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    setPaymentModalOpen(false);
    setSavingPayment(false);
  };

  const handleRecordPayment = async (event) => {
    event.preventDefault();
    if (!invoice || savingPayment || companyMismatch) return;

    const amountCents = moneyInputToCents(paymentForm.amount);
    if (amountCents <= 0) {
      toast.error('Payment amount must be greater than zero.');
      return;
    }

    setSavingPayment(true);

    try {
      await recordManualSalesPayment(db, invoice.id, {
        amountCents,
        method: paymentForm.method,
        referenceNumber: paymentForm.referenceNumber,
        memo: paymentForm.memo,
      }, {
        companyId: recentlySelectedCompany,
        stripeConnectedAccountId,
        userId: user?.uid || '',
      });

      toast.success(amountCents >= balanceCents ? 'Invoice marked paid.' : 'Payment recorded.');
      closePaymentModal();
    } catch (paymentError) {
      console.error('Unable to record invoice payment', paymentError);
      toast.error(paymentError.message || 'Failed to record payment.');
      setSavingPayment(false);
    }
  };

  const saveInvoice = async (event) => {
    event.preventDefault();
    if (!invoice || !draft || saving || companyMismatch) return;

    const nextLineItems = (draft.lineItems || [])
      .map((item) => {
        const quantity = Math.max(Number(item.quantity) || 0, 0);
        const unitAmountCents = moneyInputToCents(item.unitAmount);

        return {
          id: item.id,
          catalogItemId: item.catalogItemId || '',
          sourceType: item.sourceType || 'manual',
          sourceId: item.sourceId || '',
          name: (item.name || item.description || 'Service').trim(),
          description: (item.description || '').trim(),
          quantity,
          unitAmountCents,
          totalAmountCents: Math.round(unitAmountCents * quantity),
          taxable: Boolean(item.taxable),
          type: item.type || 'manual',
          stripeProductId: item.stripeProductId || '',
          stripePriceId: item.stripePriceId || '',
          metadata: item.metadata || {},
        };
      })
      .filter((item) => item.name && item.quantity > 0);

    if (!draft.invoiceNumber.trim() || !draft.email.trim() || nextLineItems.length === 0) {
      toast.error('Add an invoice number, customer email, and at least one line item.');
      return;
    }

    setSaving(true);

    try {
      const nextStatus = draftTotals.amountDueCents <= 0 && Number(invoice.amountPaidCents || 0) > 0
        ? SalesInvoiceStatus.paid
        : draft.status;

      await updateDoc(doc(db, salesCollectionNames.invoices, invoice.id), {
        invoiceNumber: draft.invoiceNumber.trim(),
        customerName: draft.customerName.trim(),
        email: draft.email.trim(),
        status: nextStatus,
        deliveryMethod: draft.deliveryMethod,
        dueDate: dateFromInput(draft.dueDate),
        subtotalAmountCents: draftTotals.subtotalAmountCents,
        discountAmountCents: draftTotals.discountAmountCents,
        taxAmountCents: draftTotals.taxAmountCents,
        totalAmountCents: draftTotals.totalAmountCents,
        writeOffAmountCents: draftTotals.writeOffAmountCents,
        amountDueCents: draftTotals.amountDueCents,
        memo: draft.memo.trim(),
        lineItems: nextLineItems,
        updatedAt: serverTimestamp(),
        updatedByUserId: user?.uid || '',
      });

      toast.success('Invoice updated.');
      setEditing(false);
    } catch (saveError) {
      console.error('Unable to update sales invoice', saveError);
      toast.error(saveError.message || 'Failed to update invoice.');
    } finally {
      setSaving(false);
    }
  };

  const sendInvoiceEmail = async () => {
    if (!canSend) return;

    setSending(true);

    try {
      const sendCallable = httpsCallable(functions, 'sendSalesInvoiceEmail');
      const authPayload = await getCallableAuthPayload();
      const result = await sendCallable({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        invoiceBaseUrl: window.location.origin,
        ...authPayload,
      });

      if (result.data?.testMode) {
        toast.success(`Test invoice email sent to ${result.data.to}. Customer email saved as ${result.data.intendedTo}.`);
      } else {
        toast.success(result.data?.message || 'Invoice email sent.');
      }
    } catch (sendError) {
      console.error('Unable to send invoice email', sendError);
      toast.error(sendError.message || 'Failed to send invoice email.');
    } finally {
      setSending(false);
    }
  };

  const voidInvoice = async () => {
    if (!canVoid) return;

    setVoiding(true);

    try {
      await updateDoc(doc(db, salesCollectionNames.invoices, invoice.id), {
        status: SalesInvoiceStatus.void,
        amountDueCents: 0,
        voidedAt: serverTimestamp(),
        voidedByUserId: user?.uid || '',
        updatedAt: serverTimestamp(),
      });
      toast.success('Invoice voided.');
    } catch (voidError) {
      console.error('Unable to void invoice', voidError);
      toast.error(voidError.message || 'Failed to void invoice.');
    } finally {
      setVoiding(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-500">Loading invoice...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link to="/company/sales/invoices" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
                <FaArrowLeft className="text-xs" />
                Invoices
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {recentlySelectedCompanyName || invoice?.companyName || 'Selected company'}
                </span>
                {invoice?.status && <StatusBadge status={invoice.status} />}
              </div>
              <h1 className="mt-3 text-3xl font-bold text-slate-950">
                {invoice?.invoiceNumber || 'Invoice'}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {invoice?.customerName || invoice?.email || 'Customer'} - Balance {formatCurrency(balanceCents)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {invoice?.stripeHostedInvoiceUrl && (
                <a
                  href={invoice.stripeHostedInvoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Stripe
                  <FaExternalLinkAlt className="text-xs" />
                </a>
              )}
              <button
                type="button"
                onClick={sendInvoiceEmail}
                disabled={!canSend}
                className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaEnvelope className="text-xs" />
                {sending ? 'Sending...' : 'Send Email'}
              </button>
              <button
                type="button"
                onClick={openPaymentModal}
                disabled={!canRecordPayment}
                className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaReceipt className="text-xs" />
                Mark Paid
              </button>
              {!editing ? (
                <button
                  type="button"
                  onClick={startEditing}
                  disabled={!invoice || companyMismatch}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaEdit className="text-xs" />
                  Edit
                </button>
              ) : (
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <FaTimes className="text-xs" />
                  Cancel
                </button>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {companyMismatch && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            This invoice belongs to another company. Select the matching company before editing.
          </div>
        )}

        {invoice && !companyMismatch && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <main className="space-y-6">
              <form onSubmit={saveInvoice} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">Invoice</h2>
                  {editing && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaSave className="text-xs" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  )}
                </div>

                {editing ? (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <TextInput label="Invoice Number" value={draft.invoiceNumber} onChange={(value) => updateDraft('invoiceNumber', value)} />
                    <TextInput label="Customer Name" value={draft.customerName} onChange={(value) => updateDraft('customerName', value)} />
                    <TextInput label="Billing Email" value={draft.email} onChange={(value) => updateDraft('email', value)} type="email" />
                    <TextInput label="Due Date" value={draft.dueDate} onChange={(value) => updateDraft('dueDate', value)} type="date" />
                    <SelectInput
                      label="Status"
                      value={draft.status}
                      onChange={(value) => updateDraft('status', value)}
                      options={Object.values(SalesInvoiceStatus)}
                    />
                    <SelectInput
                      label="Delivery"
                      value={draft.deliveryMethod}
                      onChange={(value) => updateDraft('deliveryMethod', value)}
                      options={Object.values(SalesInvoiceDeliveryMethod)}
                    />
                    <TextInput label="Discount" value={draft.discountAmount} onChange={(value) => updateDraft('discountAmount', value)} type="number" min="0" step="0.01" />
                    <TextInput label="Tax" value={draft.taxAmount} onChange={(value) => updateDraft('taxAmount', value)} type="number" min="0" step="0.01" />
                    <TextInput label="Write Off" value={draft.writeOffAmount} onChange={(value) => updateDraft('writeOffAmount', value)} type="number" min="0" step="0.01" />
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-sm font-semibold text-slate-700">Memo</span>
                      <textarea
                        value={draft.memo}
                        onChange={(event) => updateDraft('memo', event.target.value)}
                        className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                  </div>
                ) : (
                  <dl className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Total" value={formatCurrency(invoice.totalAmountCents)} />
                    <Field label="Paid" value={formatCurrency(invoice.amountPaidCents)} />
                    <Field label="Balance" value={formatCurrency(balanceCents)} />
                    <Field label="Due Date" value={formatDate(invoice.dueDate)} />
                    <Field label="Delivery" value={labelize(invoice.deliveryMethod)} />
                    <Field label="Sent" value={formatDate(invoice.sentAt)} />
                    <Field label="Type" value={labelize(invoice.type)} />
                    <Field label="Email" value={invoice.email} />
                  </dl>
                )}
              </form>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">Line Items</h2>
                  {editing && (
                    <button
                      type="button"
                      onClick={addLineItem}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Add Line
                    </button>
                  )}
                </div>

                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                  {editing ? (
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Item</th>
                          <th className="px-4 py-3">Qty</th>
                          <th className="px-4 py-3">Unit</th>
                          <th className="px-4 py-3">Total</th>
                          <th className="px-4 py-3" aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {(draft.lineItems || []).map((item) => {
                          const lineTotal = moneyInputToCents(item.unitAmount) * Math.max(Number(item.quantity || 0), 0);

                          return (
                            <tr key={item.id}>
                              <td className="px-4 py-3">
                                <input
                                  value={item.name}
                                  onChange={(event) => updateLineItem(item.id, 'name', event.target.value)}
                                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                                  placeholder="Line item"
                                />
                                <textarea
                                  value={item.description}
                                  onChange={(event) => updateLineItem(item.id, 'description', event.target.value)}
                                  className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                                  placeholder="Description"
                                  rows={2}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(event) => updateLineItem(item.id, 'quantity', event.target.value)}
                                  className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.unitAmount}
                                  onChange={(event) => updateLineItem(item.id, 'unitAmount', event.target.value)}
                                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(lineTotal)}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeLineItem(item.id)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-slate-50 hover:text-rose-600"
                                  aria-label={`Remove ${item.name || 'line item'}`}
                                >
                                  <FaTimes className="text-xs" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : lineItems.length === 0 ? (
                    <div className="bg-slate-50 p-5 text-sm text-slate-500">No line items saved.</div>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Item</th>
                          <th className="px-4 py-3">Qty</th>
                          <th className="px-4 py-3">Unit</th>
                          <th className="px-4 py-3">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {lineItems.map((item) => (
                          <tr key={item.id || item.catalogItemId || item.name}>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900">{item.name || item.description || 'Service'}</p>
                              {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                            </td>
                            <td className="px-4 py-3 text-slate-600">{item.quantity || 1}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(item.unitAmountCents)}</td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(item.totalAmountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {invoice.memo && !editing && (
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-bold text-slate-950">Memo</h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{invoice.memo}</p>
                </section>
              )}
            </main>

            <aside className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Totals</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Subtotal</dt>
                    <dd className="font-semibold text-slate-900">{formatCurrency(editing ? draftTotals.subtotalAmountCents : invoice.subtotalAmountCents)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Discount</dt>
                    <dd className="font-semibold text-slate-900">{formatCurrency(editing ? draftTotals.discountAmountCents : invoice.discountAmountCents)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Tax</dt>
                    <dd className="font-semibold text-slate-900">{formatCurrency(editing ? draftTotals.taxAmountCents : invoice.taxAmountCents)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Write Off</dt>
                    <dd className="font-semibold text-slate-900">{formatCurrency(editing ? draftTotals.writeOffAmountCents : invoice.writeOffAmountCents)}</dd>
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Amount Due</dt>
                      <dd className="text-2xl font-bold text-slate-950">{formatCurrency(editing ? draftTotals.amountDueCents : balanceCents)}</dd>
                    </div>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Source</h2>
                <div className="mt-4 grid gap-2">
                  {invoice.customerId && (
                    <Link
                      to={`/company/customers/details/${invoice.customerId}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      Customer
                      <FaExternalLinkAlt className="text-xs" />
                    </Link>
                  )}
                  {invoice.agreementId && (
                    <Link
                      to={`/company/sales/agreements/${invoice.agreementId}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      Service Agreement
                      <FaFileContract className="text-xs" />
                    </Link>
                  )}
                  {invoice.jobId && (
                    <Link
                      to={`/company/jobs/detail/${invoice.jobId}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      Job
                      <FaExternalLinkAlt className="text-xs" />
                    </Link>
                  )}
                  {invoice.billingSubscriptionId && (
                    <Link
                      to={`/company/sales/subscriptions/${invoice.billingSubscriptionId}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      Billing Subscription
                      <FaExternalLinkAlt className="text-xs" />
                    </Link>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
                  <FaReceipt className="text-slate-400" />
                  Payments
                </h2>
                <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                  {payments.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">No payments recorded.</div>
                  ) : payments.map((payment) => (
                    <div key={payment.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{formatCurrency(payment.amountCents)}</p>
                          <p className="mt-1 text-xs text-slate-500">{labelize(payment.method)} - {formatDate(payment.receivedAt || payment.createdAt)}</p>
                        </div>
                        <StatusBadge status={payment.status || SalesPaymentStatus.posted} />
                      </div>
                      {payment.referenceNumber && <p className="mt-2 text-xs text-slate-500">{payment.referenceNumber}</p>}
                      {payment.memo && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{payment.memo}</p>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
                  <FaFileInvoiceDollar className="text-slate-400" />
                  Email Delivery
                </h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Last Sent" value={formatDate(invoice.emailDelivery?.lastSentAt || invoice.sentAt)} />
                  <Field label="Recipient" value={invoice.emailDelivery?.to || invoice.email} />
                  <Field label="Intended To" value={invoice.emailDelivery?.intendedTo} />
                  <Field label="Template" value={invoice.emailDelivery?.templateId} />
                </dl>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Admin</h2>
                <dl className="mt-4 space-y-4">
                  <Field label="Created" value={formatDate(invoice.createdAt)} />
                  <Field label="Updated" value={formatDate(invoice.updatedAt)} />
                  <Field label="Stripe Invoice" value={invoice.stripeInvoiceId} />
                  <Field label="Payment Intent" value={invoice.stripePaymentIntentId} />
                </dl>
                <button
                  type="button"
                  onClick={voidInvoice}
                  disabled={!canVoid}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {voiding ? 'Voiding...' : 'Void Invoice'}
                </button>
              </section>
            </aside>
          </div>
        )}
      </div>

      {paymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleRecordPayment} className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Mark Invoice Paid</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {invoice?.invoiceNumber || 'Invoice'} - Balance {formatCurrency(balanceCents)}
                </p>
              </div>
              <button
                type="button"
                onClick={closePaymentModal}
                className="rounded-md border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <TextInput
                label="Amount"
                value={paymentForm.amount}
                onChange={(value) => setPaymentForm((current) => ({ ...current, amount: value }))}
                type="number"
                min="0"
                step="0.01"
              />
              <SelectInput
                label="Payment Method"
                value={paymentForm.method}
                onChange={(value) => setPaymentForm((current) => ({ ...current, method: value }))}
                options={manualPaymentMethods}
              />
              <TextInput
                label="Reference Number"
                value={paymentForm.referenceNumber}
                onChange={(value) => setPaymentForm((current) => ({ ...current, referenceNumber: value }))}
              />
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Notes</span>
                <textarea
                  value={paymentForm.memo}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, memo: event.target.value }))}
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Optional internal payment note"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={closePaymentModal}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPayment}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingPayment ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SalesInvoiceDetail;
