import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../utils/config';
import { workspaceButtonClass } from '../workspace/workspaceStyles';

export default function InvoiceWorkflowStatus({ record, recordPath }) {
  const [liveRecord, setLiveRecord] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setLiveRecord(null);
    setError('');
    if (!recordPath) return undefined;
    return onSnapshot(doc(db, recordPath), snapshot => {
      setLiveRecord(snapshot.exists() ? snapshot.data() : null);
      setError('');
    }, () => setError('Invoice status could not be loaded. Refresh to try again.'));
  }, [recordPath]);
  const data = record || liveRecord || {};
  const invoiceId = data.salesInvoiceId || data.invoiceId;
  const state = data.billingAutomationStatus;
  if (!invoiceId && !state && !error) return null;
  const label = state === 'awaitingNextBill' ? 'Queued for the next recurring service bill.'
    : state === 'nextBillAttached' ? 'Included on the recurring service invoice.'
    : state === 'awaitingDelivery' ? ((data.paymentPreference || data.paymentCollectionPreference) === 'nextBill' ? 'After delivery or installation, this part will join the next recurring service bill.' : 'Invoice will be created after delivery or installation.')
    : ['needsReview', 'emailNeedsReview'].includes(state) ? 'Invoice needs review'
      : invoiceId ? `Invoice: ${data.invoiceStatus || 'Draft'}` : 'Invoice processing';
  return (
    <section aria-label="Invoice workflow" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-slate-900">{label}</p>
        {invoiceId && <Link to={`/company/sales/invoices/${invoiceId}`} className={workspaceButtonClass()}>Open Invoice</Link>}
      </div>
      {(data.billingAutomationError || error) && <p role="status" className="mt-2 text-amber-800">{data.billingAutomationError || error}</p>}
      {invoiceId && data.invoiceStatus === 'draft' && <p className="mt-2 text-slate-600">{data.invoiceType === 'recurringServiceInvoice' ? 'Included in the recurring bill; its usual delivery and payment settings apply.' : 'Created in Sales. Review and send the invoice there when automatic sending is off or needs attention.'}</p>}
    </section>
  );
}
