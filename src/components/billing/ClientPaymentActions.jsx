import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../utils/config';
import { getCallableAuthPayload } from '../../utils/callableAuth';
import PaymentMethodSelector from '../sales/PaymentMethodSelector';
export function ManageClientBilling({
  subscription
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      const {
        data
      } = await httpsCallable(functions, 'createCustomerBillingPortal')({
        ...(await getCallableAuthPayload()),
        billingSubscriptionId: subscription.id,
        returnUrl: `${window.location.origin}/client/finance`
      });
      window.location.assign(data.url);
    } catch (err) {
      setError(err.message || 'Could not open payment settings. Please try again.');
      setBusy(false);
    }
  };
  if (!subscription.stripeCustomerId) return null;
  return <div><button onClick={open} disabled={busy} className="mt-3 min-h-[44px] w-full rounded-lg border border-blue-200 px-4 text-sm font-bold text-blue-700">{busy ? 'Opening…' : 'Manage payment methods & receipts'}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
export function ClientInvoicePayment({
  invoice,
  balanceCents,
  accessToken = '',
  user
}) {
  const [ready, setReady] = useState(invoice.onlinePaymentAvailable === true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [processing, setProcessing] = useState(false);
  const [paymentMethodType,setPaymentMethodType]=useState('card');
  useEffect(() => {
    let active = true;
    if (typeof invoice.onlinePaymentAvailable === 'boolean') {
      setReady(invoice.onlinePaymentAvailable);
      return;
    }
    if (!user?.uid || !invoice.companyId) return;
    getDoc(doc(db, 'companies', invoice.companyId)).then(snapshot => {
      if (!active) return;
      const c = snapshot.data() || {};
      setReady(Boolean((c.customerBillingEnabled || c.salesBillingEnabled || c.salesBillingAutomationEnabled) && (c.stripeConnectedAccountId || c.stripeConnectAccountId)));
    }).catch(() => {
      if (active) setReady(false);
    });
    return () => {
      active = false;
    };
  }, [invoice.companyId, invoice.onlinePaymentAvailable, user?.uid]);
  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const auth = user?.uid ? await getCallableAuthPayload() : {};
      const {
        data
      } = await httpsCallable(functions, 'createCustomerInvoiceCheckout')({
        ...auth,
        invoiceId: invoice.id,
        accessToken,
        paymentMethodType,
        returnUrl: window.location.href
      });
      if (data.url) window.location.assign(data.url);else {
        setProcessing(true);
        setBusy(false);
      }
    } catch (err) {
      setError(err.message || 'Could not open payment. Your invoice remains available here.');
      setBusy(false);
    }
  };
  if (invoice.paymentReviewRequired) return <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your company is reviewing a payment adjustment. Contact them before making another payment.</p>;
  if (balanceCents <= 0 || ['paid', 'void', 'draft', 'uncollectible'].includes(String(invoice.status).toLowerCase())) return null;
  if (invoice.stripeHostedInvoiceUrl) return <a href={invoice.stripeHostedInvoiceUrl} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-blue-600 px-4 font-bold text-white">Pay this invoice</a>;
  return <div className="mt-4 space-y-3">{ready ? <>{String(invoice.currency || 'usd').toLowerCase()==='usd' && <PaymentMethodSelector amountCents={balanceCents} value={paymentMethodType} onChange={setPaymentMethodType} disabled={busy || processing || invoice.paymentProcessing} compact showFees={false}/>}<button onClick={pay} disabled={busy || processing || invoice.paymentProcessing} className="min-h-[48px] w-full rounded-lg bg-blue-600 px-4 font-bold text-white disabled:opacity-60">{busy ? 'Opening secure payment…' : processing || invoice.paymentProcessing ? 'Payment processing' : `Pay ${new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: invoice.currency || 'USD'
        }).format(balanceCents / 100)}`}</button><p className="text-xs text-slate-500">Pay this invoice once. This does not authorize recurring charges.{paymentMethodType==='ach'?' Bank payments can take several business days to confirm.':''}</p></> : <p className="text-sm text-slate-600">Contact your pool company for payment instructions. Online payment is not enabled for this invoice.</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
