const { onCall } = require('firebase-functions/v2/https');
const { HttpsError } = require('./appErrors');
const admin = require('firebase-admin');
const {
  createHash
} = require('node:crypto');
const {
  getStripe
} = require('./stripe/stripeClient');
const {
  documentId
} = require('./companyActor');
const text = value => String(value ?? '').trim();
const normalized = value => text(value).toLowerCase();
const fail = (code, message) => {
  throw new HttpsError(code, message);
};
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
const billingEnabled = company => company.customerBillingEnabled === true || company.salesBillingEnabled === true || company.salesBillingAutomationEnabled === true;
const accountId = company => text(company.stripeConnectedAccountId || company.stripeConnectAccountId);
const millis = value => value?.toMillis?.() ?? value?.getTime?.() ?? 0;
const invoiceBalance = invoice => Math.max(0, Number(invoice.amountDueCents ?? Number(invoice.totalAmountCents || invoice.totalCents || 0) - Number(invoice.amountPaidCents || 0) - Number(invoice.writeOffAmountCents || 0)));
function canAccess(record, auth, token = '') {
  if (auth?.uid && record.customerUserId === auth.uid) return true;
  if (auth?.uid && auth.token?.email_verified === true && !record.customerUserId && normalized(auth.token.email) === normalized(record.email || record.customerEmail || record.billingEmail) && normalized(auth.token.email)) return true;
  return !!token && !!record.emailDelivery?.reviewAccessToken && hash(token) === hash(record.emailDelivery.reviewAccessToken);
}
function returnUrl(value, origin) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    fail('invalid-argument', 'A valid return URL is required.');
  }
  const allowed = new Set(['https://dripdrop-poolapp.com', 'https://www.dripdrop-poolapp.com', 'https://the-pool-app-dev.web.app', 'https://the-pool-app-dev.firebaseapp.com', 'https://the-pool-app-3e652.web.app', 'https://the-pool-app-3e652.firebaseapp.com', ...(process.env.CUSTOMER_PORTAL_ORIGINS || '').split(',').filter(Boolean)]);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname) && (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.GCLOUD_PROJECT === 'the-pool-app-dev');
  if (!allowed.has(url.origin) && !local || origin && url.origin !== origin || !/^\/(client\/|customer\/)/.test(url.pathname) || url.username || url.password) fail('invalid-argument', 'Return to a Drip Drop customer page.');
  return url;
}
function createCustomerPortalBilling(db, stripe, now = () => new Date()) {
  async function startInvoiceCheckout(request) {
    const data = request.data || {},
      invoiceId = documentId(data.invoiceId, 'Invoice');
    const returnTo = returnUrl(data.returnUrl, request.rawRequest?.headers?.origin);
    const invoiceRef = db.collection('salesInvoices').doc(invoiceId);
    const draft = await db.runTransaction(async tx => {
      const invoiceSnap = await tx.get(invoiceRef);
      if (!invoiceSnap.exists) fail('not-found', 'Invoice not found.');
      const invoice = invoiceSnap.data();
      if (!canAccess(invoice, request.auth, text(data.accessToken))) fail('permission-denied', 'Open the invoice email link or sign in with the verified recipient account.');
      if (invoice.paymentReviewRequired) fail('failed-precondition','Contact your company while this payment adjustment is under review.');
      if (invoice.stripeInvoiceId || invoice.stripeHostedInvoiceUrl || invoice.stripeSubscriptionId) fail('failed-precondition', 'Pay this Stripe invoice through its existing hosted invoice page.');
      const staleMutation = invoice.billingMutation && millis(invoice.billingMutation.startedAt) + 120000 <= now().getTime();
      if (invoice.billingMutation && !staleMutation) fail('aborted', 'The company is updating this invoice. Refresh it and try again shortly.');
      if (!['open', 'overdue', 'partiallypaid'].includes(normalized(invoice.status).replace(/[^a-z]/g, ''))) fail('failed-precondition', 'This invoice is not open for payment.');
      if (invoice.paymentProcessing) fail('failed-precondition', 'A payment is already processing for this invoice. Wait for confirmation before trying again.');
      const balance = invoiceBalance(invoice);
      if (!Number.isSafeInteger(balance) || balance < 50) fail('failed-precondition', 'This invoice has no payable online balance. Contact the company for small balances.');
      const company = await tx.get(db.collection('companies').doc(documentId(invoice.companyId, 'Company')));
      const connected = accountId(company.data() || {});
      if (!company.exists || !billingEnabled(company.data()) || !connected) fail('failed-precondition', 'This company is not accepting online invoice payments. Contact them for payment instructions.');
      // A single outstanding balance owns one idempotent Checkout attempt, even across two browser tabs.
      const previousId = text(invoice.portalPaymentAttemptId);
      const previous = previousId ? await tx.get(invoiceRef.collection('portalPaymentAttempts').doc(previousId)) : null;
      const old = previous?.data();
      if (staleMutation) tx.set(invoiceRef, {billingMutation:null}, {merge:true});
      const reusable = old && old.balanceCents === balance && old.connectedAccount === connected && millis(old.expiresAt) > now().getTime() && !['failed', 'expired'].includes(old.status);
      if (reusable) return {
        invoice,
        attempt: old,
        attemptId: previousId
      };
      // Retire the old Stripe session before reserving a changed balance. This also
      // covers a second browser arriving while the first is still creating it.
      if (old && millis(old.expiresAt) > now().getTime() && !['failed', 'expired'].includes(old.status)) return {
        invoice,
        attempt: old,
        attemptId: previousId,
        retire: true
      };
      const version = Number(invoice.portalPaymentAttemptVersion || 0) + 1,
        attemptId = `invoice_${hash(`${invoiceId}:${version}:${balance}`)}`;
      const success = new URL(returnTo);
      success.searchParams.set('invoiceCheckout', 'returned');
      success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
      const cancel = new URL(returnTo);
      cancel.searchParams.set('invoiceCheckout', 'canceled');
      const metadata = {
        flow: 'customer_invoice_payment',
        salesInvoiceId: invoiceId,
        companyId: invoice.companyId,
        stripeConnectedAccountId: connected,
        paymentAttemptId: attemptId
      };
      const expiresAt = new Date(now().getTime() + 30 * 60000);
      const params = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: normalized(invoice.currency || 'usd'),
            unit_amount: balance,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber || invoice.internalId || invoiceId}`
            }
          },
          quantity: 1
        }],
        client_reference_id: invoiceId,
        metadata,
        payment_intent_data: {
          metadata,
          application_fee_amount: Math.round(balance * 0.08 / 100)
        },
        success_url: success.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/gi, '{CHECKOUT_SESSION_ID}'),
        cancel_url: cancel.toString(),
        expires_at: Math.floor(expiresAt.getTime() / 1000)
      };
      if (invoice.email) params.customer_email = invoice.email;
      const attempt = {
        id: attemptId,
        invoiceId,
        balanceCents: balance,
        connectedAccount: connected,
        status: 'creating',
        params,
        expiresAt,
        createdAt: now()
      };
      tx.set(invoiceRef.collection('portalPaymentAttempts').doc(attemptId), attempt);
      tx.set(invoiceRef, {
        portalPaymentAttemptId: attemptId,
        portalPaymentAttemptVersion: version
      }, {
        merge: true
      });
      return {
        invoice,
        attempt,
        attemptId
      };
    });
    const attemptRef = invoiceRef.collection('portalPaymentAttempts').doc(draft.attemptId);
    if (draft.retire) {
      const options = { stripeAccount: draft.attempt.connectedAccount };
      const session = draft.attempt.sessionId
        ? await stripe.checkout.sessions.retrieve(draft.attempt.sessionId, {}, options)
        : await stripe.checkout.sessions.create(draft.attempt.params, { ...options, idempotencyKey: draft.attemptId });
      if (session.status === 'complete') return { status: 'processing', message: 'Your payment is being confirmed.' };
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id, {}, options);
      await attemptRef.set({ sessionId: session.id, status: 'expired', updatedAt: now() }, { merge: true });
      return startInvoiceCheckout(request);
    }
    if (draft.attempt.status === 'processing' || draft.attempt.status === 'posted') return {
      status: 'processing',
      message: 'Your payment is being confirmed.'
    };
    if (draft.attempt.sessionId) {
      const session = await stripe.checkout.sessions.retrieve(draft.attempt.sessionId, {}, {
        stripeAccount: draft.attempt.connectedAccount
      });
      if (session.status === 'complete') return {
        status: 'processing',
        message: 'Your payment is being confirmed.'
      };
      if (session.status === 'open' && session.url) return {
        url: session.url
      };
      await attemptRef.set({
        status: 'expired'
      }, {
        merge: true
      });
      return startInvoiceCheckout(request);
    }
    const account = await stripe.accounts.retrieve(draft.attempt.connectedAccount);
    if (!account.charges_enabled) fail('failed-precondition', 'The company payment account is not ready. Contact the company.');
    const session = await stripe.checkout.sessions.create(draft.attempt.params, {
      stripeAccount: draft.attempt.connectedAccount,
      idempotencyKey: draft.attemptId
    });
    const publish = await db.runTransaction(async tx => {
      const [invoiceSnap, savedAttempt] = await Promise.all([tx.get(invoiceRef), tx.get(attemptRef)]);
      const invoice = invoiceSnap.data() || {};
      if (invoice.billingMutation || invoice.portalPaymentAttemptId !== draft.attemptId || invoiceBalance(invoice) !== draft.attempt.balanceCents ||
        !['open', 'overdue', 'partiallypaid'].includes(normalized(invoice.status).replace(/[^a-z]/g, '')) ||
        ['expired', 'failed'].includes(savedAttempt.data()?.status)) return false;
      tx.set(attemptRef, {sessionId:session.id,url:session.url,status:'open'},{merge:true});
      return true;
    });
    if (!publish) {
      const current = await stripe.checkout.sessions.retrieve(session.id, {}, {stripeAccount:draft.attempt.connectedAccount});
      if (current.status === 'open') await stripe.checkout.sessions.expire(session.id, {}, {stripeAccount:draft.attempt.connectedAccount});
      fail('aborted', 'The invoice changed while opening payment. Refresh it before paying.');
    }
    return {
      url: session.url
    };
  }
  async function billingPortal(request) {
    const uid = request.auth?.uid,
      data = request.data || {};
    if (!uid) fail('unauthenticated', 'Sign in to manage payment methods.');
    if (request.auth.token?.email_verified !== true) fail('failed-precondition', 'Verify your email to manage payment methods.');
    const subscription = await db.collection('salesBillingSubscriptions').doc(documentId(data.billingSubscriptionId, 'Billing subscription')).get();
    if (!subscription.exists || !canAccess(subscription.data(), request.auth)) fail('permission-denied', 'This billing setup does not belong to your account.');
    const value = subscription.data(),
      company = await db.collection('companies').doc(documentId(value.companyId, 'Company')).get();
    if (!company.exists || accountId(company.data()) !== value.stripeConnectedAccountId || !value.stripeCustomerId) fail('failed-precondition', 'Ask the company to finish setting up online billing.');
    const url = returnUrl(data.returnUrl, request.rawRequest?.headers?.origin);
    const options = {
      stripeAccount: value.stripeConnectedAccountId
    };
    let configurationId = company.data().customerPortalConfigurationId;
    if (!configurationId) {
      const configuration = await stripe.billingPortal.configurations.create({
        business_profile: {
          headline: `Manage your ${company.data().name || 'pool service'} payments`
        },
        features: {
          customer_update: {
            enabled: true,
            allowed_updates: ['email', 'address']
          },
          invoice_history: {
            enabled: true
          },
          payment_method_update: {
            enabled: true
          }
        }
      }, {
        ...options,
        idempotencyKey: `customer_portal_${value.companyId}`
      });
      configurationId = configuration.id;
      await company.ref.set({
        customerPortalConfigurationId: configurationId
      }, {
        merge: true
      });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: value.stripeCustomerId,
      configuration: configurationId,
      return_url: url.toString()
    }, options);
    return {
      url: session.url
    };
  }
  async function reconcile(event) {
    const session = event.data?.object;
    if (session?.metadata?.flow !== 'customer_invoice_payment' || !['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) return false;
    const invoiceId = documentId(session.metadata.salesInvoiceId, 'Invoice'),
      attemptId = documentId(session.metadata.paymentAttemptId, 'Payment attempt');
    const connected = text(event.account),
      invoiceRef = db.collection('salesInvoices').doc(invoiceId),
      attemptRef = invoiceRef.collection('portalPaymentAttempts').doc(attemptId);
    const status = event.type === 'checkout.session.async_payment_failed' ? 'failed' : event.type === 'checkout.session.expired' ? 'expired' : session.payment_status === 'paid' ? 'posted' : 'processing';
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    const paymentId = `stripe_invoice_${hash(intentId || session.id)}`,
      paymentRef = db.collection('salesPayments').doc(paymentId);
    let receiptUrl = '', charge = null;
    if (status === 'posted' && intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId, {
        expand: ['latest_charge.balance_transaction']
      }, {
        stripeAccount: connected
      });
      receiptUrl = typeof intent.latest_charge === 'object' ? intent.latest_charge?.receipt_url || '' : '';
      charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    }
    await db.runTransaction(async tx => {
      const [invoiceSnap, attemptSnap, paymentSnap] = await Promise.all([tx.get(invoiceRef), tx.get(attemptRef), tx.get(paymentRef)]);
      if (!invoiceSnap.exists || !attemptSnap.exists) fail('not-found', 'Payment attempt not found.');
      const invoice = invoiceSnap.data(),
        attempt = attemptSnap.data(),
        existing = paymentSnap.data() || {};
      if (!connected || connected !== attempt.connectedAccount || session.metadata.companyId !== invoice.companyId || attempt.sessionId !== session.id || session.amount_total !== attempt.balanceCents || normalized(session.currency) !== normalized(attempt.params.line_items[0].price_data.currency)) fail('permission-denied', 'Payment does not match this invoice and company.');
      if (existing.grossPosted || ['posted', 'partiallyRefunded', 'refunded', 'disputed', 'reversed'].includes(existing.status)) return; // A late confirmation/failure cannot overwrite a refund or reversal.
      const effectiveStatus = status === 'expired' ? 'failed' : status;
      tx.set(attemptRef, {
        status,
        updatedAt: now(),
        lastEventId: event.id
      }, {
        merge: true
      });
      if (status === 'expired') return;
      const payment = {
        id: paymentId,
        invoiceId,
        companyId: invoice.companyId,
        companyName: invoice.companyName || '',
        customerId: invoice.customerId || '',
        customerUserId: invoice.customerUserId || '',
        email: invoice.email || '',
        relationshipId: invoice.relationshipId || '',
        customerCompanyRelationshipId: invoice.customerCompanyRelationshipId || invoice.relationshipId || '',
        amountCents: session.amount_total,
        currency: session.currency,
        method: 'stripeCard',
        status: effectiveStatus,
        grossPosted: status === 'posted',
        stripePaymentIntentId: intentId || '',
        stripeChargeId: charge?.id || '',
        stripeBalanceTransactionId: typeof charge?.balance_transaction==='string'?charge.balance_transaction:charge?.balance_transaction?.id || '',
        applicationFeeId: typeof charge?.application_fee==='string'?charge.application_fee:charge?.application_fee?.id || '',
        processorFeeCents: typeof charge?.balance_transaction==='object'?charge.balance_transaction?.fee ?? null:null,
        processorNetCents: typeof charge?.balance_transaction==='object'?charge.balance_transaction?.net ?? null:null,
        stripeCheckoutSessionId: session.id,
        stripeConnectedAccountId: connected,
        receiptUrl,
        createdAt: existing.createdAt || now(),
        receivedAt: status === 'posted' ? now() : null,
        updatedAt: now()
      };
      tx.set(paymentRef, payment);
      tx.set(db.collection('salesPaymentEvents').doc(`invoice_${event.id}`), {
        ...payment,
        paymentId,
        eventType: event.type,
        eventId: event.id
      }, {
        merge: true
      });
      if (status === 'posted') {
        const paid = Number(invoice.amountPaidCents || 0) + session.amount_total,
          total = Number(invoice.totalAmountCents || invoice.totalCents || 0),
          closed = ['void', 'voided', 'cancelled', 'canceled'].includes(normalized(invoice.status)),
          due = closed ? 0 : Math.max(0, total - paid - Number(invoice.writeOffAmountCents || 0));
        tx.set(invoiceRef, {
          amountPaidCents: paid,
          amountDueCents: due,
          status: closed ? invoice.status : due > 0 ? 'partiallyPaid' : 'paid',
          paidAt: !closed && due === 0 ? now() : null,
          paymentReviewRequired: closed || paid + Number(invoice.writeOffAmountCents || 0) > total,
          lastPaymentAt: now(),
          paymentProcessing: false,
          overpaymentCents: Math.max(0, paid + Number(invoice.writeOffAmountCents || 0) - total),
          updatedAt: now()
        }, {
          merge: true
        });
      } else tx.set(invoiceRef, {
        paymentProcessing: status === 'processing',
        lastPaymentFailure: status === 'failed' ? 'Your payment did not complete. Please try again.' : '',
        updatedAt: now()
      }, {
        merge: true
      });
    });
    return true;
  }
  return {
    startInvoiceCheckout,
    billingPortal,
    reconcile
  };
}
exports.createCustomerPortalBilling = createCustomerPortalBilling;
exports.invoiceBalance = invoiceBalance;
exports.createCustomerInvoiceCheckout = onCall({
  cors: true
}, request => createCustomerPortalBilling(admin.firestore(), getStripe()).startInvoiceCheckout(request));
exports.createCustomerBillingPortal = onCall({
  cors: true
}, request => createCustomerPortalBilling(admin.firestore(), getStripe()).billingPortal(request));
