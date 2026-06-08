require('dotenv').config({ path: `.env.${process.env.GCLOUD_PROJECT}` });
// Rewritten to use the modern v2 Cloud Function structure.
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require('uuid');

// Securely access the Stripe API key from the environment variables.
const stripe = require("stripe")(process.env.STRIPE_API_KEY || 'sk_test_dummyApiKey');

// Securely access the webhook secret from the environment variables.
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const salesCollectionNames = {
    agreements: 'salesAgreements',
    billingSubscriptions: 'salesBillingSubscriptions',
    invoices: 'salesInvoices',
    payments: 'salesPayments',
    paymentEvents: 'salesPaymentEvents',
};

const timestampFromStripeSeconds = (seconds) => (
    seconds ? admin.firestore.Timestamp.fromMillis(seconds * 1000) : null
);

const mapStripeSubscriptionStatus = (status) => {
    if (status === 'active' || status === 'trialing') return 'active';
    if (status === 'past_due' || status === 'unpaid') return 'pastDue';
    if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
    if (status === 'paused') return 'paused';
    return 'pendingStripe';
};

const nextActionForStripeSubscriptionStatus = (status) => {
    if (status === 'active' || status === 'trialing') return 'monitorBilling';
    if (status === 'past_due' || status === 'unpaid') return 'collectPaymentMethod';
    if (status === 'incomplete') return 'completeCheckout';
    if (status === 'paused') return 'resumeSubscription';
    if (status === 'canceled' || status === 'incomplete_expired') return 'reviewCanceledSubscription';
    return 'reviewStripeStatus';
};

const mapStripeInvoiceStatus = (status) => {
    if (status === 'paid') return 'paid';
    if (status === 'void') return 'void';
    if (status === 'uncollectible') return 'uncollectible';
    return 'open';
};

const findSalesBillingSubscriptionByStripeId = async (stripeSubscriptionId) => {
    if (!stripeSubscriptionId) return null;

    const querySnapshot = await admin.firestore()
        .collection(salesCollectionNames.billingSubscriptions)
        .where('stripeSubscriptionId', '==', stripeSubscriptionId)
        .limit(1)
        .get();

    if (querySnapshot.empty) return null;

    const doc = querySnapshot.docs[0];
    return {
        ref: doc.ref,
        data: { id: doc.id, ...doc.data() },
    };
};

const updateSalesBillingSubscriptionFromStripe = async ({ subscription, connectedAccount, checkoutSession = null }) => {
    const metadata = subscription.metadata || checkoutSession?.metadata || {};
    const billingSubscriptionId = metadata.salesBillingSubscriptionId;
    const subscriptionRef = billingSubscriptionId
        ? admin.firestore().collection(salesCollectionNames.billingSubscriptions).doc(billingSubscriptionId)
        : (await findSalesBillingSubscriptionByStripeId(subscription.id))?.ref;

    if (!subscriptionRef) return false;

    const item = subscription.items?.data?.[0] || {};
    const updateData = {
        stripeConnectedAccountId: connectedAccount || metadata.stripeConnectedAccountId || '',
        stripeCustomerId: subscription.customer || checkoutSession?.customer || '',
        stripeSubscriptionId: subscription.id,
        stripeSubscriptionItemId: item.id || '',
        stripePriceId: item.price?.id || '',
        stripeProductId: typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id || '',
        stripeLatestInvoiceId: typeof subscription.latest_invoice === 'string'
            ? subscription.latest_invoice
            : subscription.latest_invoice?.id || '',
        stripeDefaultPaymentMethodId: typeof subscription.default_payment_method === 'string'
            ? subscription.default_payment_method
            : subscription.default_payment_method?.id || '',
        stripeStatus: subscription.status || '',
        status: mapStripeSubscriptionStatus(subscription.status),
        checkoutStatus: checkoutSession ? 'completed' : 'synced',
        nextAction: nextActionForStripeSubscriptionStatus(subscription.status),
        customerCanPayImmediately: false,
        currentPeriodStart: timestampFromStripeSeconds(subscription.current_period_start),
        currentPeriodEnd: timestampFromStripeSeconds(subscription.current_period_end),
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        canceledAt: timestampFromStripeSeconds(subscription.canceled_at),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await subscriptionRef.set(updateData, { merge: true });

    const updatedSnap = await subscriptionRef.get();
    const updatedSubscription = { id: updatedSnap.id, ...updatedSnap.data() };
    const agreementId = updatedSubscription.agreementId || metadata.salesAgreementId;

    if (agreementId) {
        await admin.firestore().collection(salesCollectionNames.agreements).doc(agreementId).set({
            stripeCustomerId: updateData.stripeCustomerId,
            billingSubscriptionId: updatedSubscription.id,
            billingFlowStatus: updateData.status,
            billingFlowNextAction: updateData.nextAction,
            billingFlowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    return true;
};

const upsertSalesInvoiceAndPaymentFromStripeInvoice = async ({
    invoice,
    connectedAccount,
    eventType = '',
    eventId = '',
}) => {
    const stripeSubscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    const salesSubscription = await findSalesBillingSubscriptionByStripeId(stripeSubscriptionId);
    if (!salesSubscription) return false;

    const subscription = salesSubscription.data;
    const invoiceId = `sinv_${invoice.id}`;
    const paymentIntentId = typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : invoice.payment_intent?.id || '';
    const paymentId = `spay_${invoice.id}`;
    const failedPaymentId = `spay_failed_${invoice.id}_${paymentIntentId || 'latest'}`;
    const paymentEventId = `spe_${eventId || `${invoice.id}_${eventType || 'invoice'}`}`;
    const invoiceRef = admin.firestore().collection(salesCollectionNames.invoices).doc(invoiceId);
    const paymentRef = admin.firestore().collection(salesCollectionNames.payments).doc(paymentId);
    const failedPaymentRef = admin.firestore().collection(salesCollectionNames.payments).doc(failedPaymentId);
    const paymentEventRef = admin.firestore().collection(salesCollectionNames.paymentEvents).doc(paymentEventId);
    const batch = admin.firestore().batch();

    const amountDue = Number(invoice.amount_due || 0);
    const amountPaid = Number(invoice.amount_paid || 0);
    const amountRemaining = Number(invoice.amount_remaining || Math.max(amountDue - amountPaid, 0));
    const isPaid = invoice.status === 'paid' && amountPaid > 0;
    const isPaymentFailed = eventType === 'invoice.payment_failed';
    const currency = String(invoice.currency || subscription.currency || 'usd').toLowerCase();
    const basePaymentFields = {
        companyId: subscription.companyId || '',
        customerId: subscription.customerId || '',
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
        customerName: subscription.customerName || '',
        email: subscription.email || '',
        invoiceId,
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        currency,
        method: 'stripeCard',
        stripeConnectedAccountId: connectedAccount || subscription.stripeConnectedAccountId || '',
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
        stripeSubscriptionId,
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId,
        referenceNumber: invoice.number || invoice.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const invoiceUpdate = {
        id: invoiceId,
        companyId: subscription.companyId || '',
        customerId: subscription.customerId || '',
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
        customerName: subscription.customerName || '',
        email: subscription.email || '',
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        type: 'subscription',
        status: mapStripeInvoiceStatus(invoice.status),
        currency,
        amountDueCents: amountRemaining,
        amountPaidCents: amountPaid,
        balanceCents: amountRemaining,
        stripeAmountDueCents: amountDue,
        subtotalAmountCents: Number(invoice.subtotal || 0),
        taxAmountCents: Number(invoice.tax || 0),
        totalAmountCents: Number(invoice.total || amountDue || 0),
        dueDate: timestampFromStripeSeconds(invoice.due_date),
        issuedAt: timestampFromStripeSeconds(invoice.created),
        paidAt: invoice.status_transitions?.paid_at
            ? timestampFromStripeSeconds(invoice.status_transitions.paid_at)
            : null,
        stripeConnectedAccountId: connectedAccount || subscription.stripeConnectedAccountId || '',
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
        stripeSubscriptionId,
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId,
        stripeHostedInvoiceUrl: invoice.hosted_invoice_url || '',
        stripeInvoicePdfUrl: invoice.invoice_pdf || '',
        lastStripeEventType: eventType,
        lastStripeEventId: eventId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isPaymentFailed) {
        invoiceUpdate.paymentFailedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    batch.set(invoiceRef, invoiceUpdate, { merge: true });

    if (isPaid) {
        batch.set(paymentRef, {
            id: paymentId,
            ...basePaymentFields,
            amountCents: amountPaid,
            status: 'posted',
            receivedAt: invoice.status_transitions?.paid_at
                ? timestampFromStripeSeconds(invoice.status_transitions.paid_at)
                : admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    if (isPaymentFailed) {
        batch.set(failedPaymentRef, {
            id: failedPaymentId,
            ...basePaymentFields,
            amountCents: amountRemaining || amountDue,
            status: 'failed',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    batch.set(paymentEventRef, {
        id: paymentEventId,
        companyId: subscription.companyId || '',
        customerId: subscription.customerId || '',
        customerUserId: subscription.customerUserId || null,
        relationshipId: subscription.relationshipId || subscription.customerCompanyRelationshipId || '',
        customerCompanyRelationshipId: subscription.customerCompanyRelationshipId || subscription.relationshipId || '',
        customerName: subscription.customerName || '',
        email: subscription.email || '',
        invoiceId,
        billingSubscriptionId: subscription.id,
        agreementId: subscription.agreementId || '',
        type: eventType || 'invoice.updated',
        status: isPaymentFailed ? 'failed' : isPaid ? 'posted' : mapStripeInvoiceStatus(invoice.status),
        amountCents: isPaid ? amountPaid : amountRemaining || amountDue,
        currency,
        stripeConnectedAccountId: connectedAccount || subscription.stripeConnectedAccountId || '',
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
        stripeSubscriptionId,
        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: paymentIntentId,
        stripeEventId: eventId,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const subscriptionUpdate = {
        stripeLatestInvoiceId: invoice.id,
        status: salesSubscription.data.status || 'pendingStripe',
        stripeStatus: salesSubscription.data.stripeStatus || '',
        nextAction: salesSubscription.data.nextAction || 'reviewStripeStatus',
        lastPaymentStatus: isPaymentFailed ? 'failed' : isPaid ? 'posted' : mapStripeInvoiceStatus(invoice.status),
        lastPaymentEventId: paymentEventId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isPaid) {
        subscriptionUpdate.status = 'active';
        subscriptionUpdate.stripeStatus = 'active';
        subscriptionUpdate.nextAction = 'monitorBilling';
        subscriptionUpdate.lastPaymentAt = admin.firestore.FieldValue.serverTimestamp();
        subscriptionUpdate.lastPaymentFailedAt = null;

        if (!subscription.operationsSetupStatus) {
            subscriptionUpdate.operationsSetupStatus = 'needsRecurringServiceStop';
            subscriptionUpdate.operationsSetupReason = 'paidBillingSubscription';
            subscriptionUpdate.operationsSetupUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
        }
    }

    if (isPaymentFailed) {
        subscriptionUpdate.status = 'pastDue';
        subscriptionUpdate.stripeStatus = 'past_due';
        subscriptionUpdate.nextAction = 'collectPaymentMethod';
        subscriptionUpdate.lastPaymentFailedAt = admin.firestore.FieldValue.serverTimestamp();
        subscriptionUpdate.lastPaymentFailedInvoiceId = invoice.id;
    }

    batch.set(salesSubscription.ref, subscriptionUpdate, { merge: true });

    if (subscription.agreementId) {
        const agreementUpdate = {
            billingSubscriptionId: subscription.id,
            billingFlowStatus: subscriptionUpdate.status,
            billingFlowNextAction: subscriptionUpdate.nextAction,
            billingFlowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (subscriptionUpdate.operationsSetupStatus) {
            agreementUpdate.operationsSetupStatus = subscriptionUpdate.operationsSetupStatus;
            agreementUpdate.operationsSetupReason = subscriptionUpdate.operationsSetupReason;
            agreementUpdate.operationsSetupUpdatedAt = subscriptionUpdate.operationsSetupUpdatedAt;
        }

        batch.set(admin.firestore().collection(salesCollectionNames.agreements).doc(subscription.agreementId), agreementUpdate, { merge: true });
    }

    await batch.commit();
    return true;
};

// This is now a v2 function, which aligns with the project and resolves deployment conflicts.
exports.stripeWebHook = onRequest(async (request, response) => {
    const sig = request.headers["stripe-signature"];

    let event;

    try {          
        // The rawBody is available in v2 functions and is required for signature verification.
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed!', err.message);
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // Handle the 'checkout.session.completed' event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const isSalesCheckout = session.metadata?.flow === 'sales_billing_subscription' || Boolean(session.metadata?.salesBillingSubscriptionId);

        if (isSalesCheckout) {
            try {
                const connectedAccount = event.account || session.metadata?.stripeConnectedAccountId;
                const subscription = await stripe.subscriptions.retrieve(
                    session.subscription,
                    {},
                    connectedAccount ? { stripeAccount: connectedAccount } : undefined
                );

                await updateSalesBillingSubscriptionFromStripe({
                    subscription,
                    connectedAccount,
                    checkoutSession: session,
                });

                response.status(200).send('Sales checkout synchronized.');
                return;
            } catch (salesError) {
                console.error('Database update failed after receiving sales checkout webhook:', salesError);
                response.status(500).send(`Internal Server Error: ${salesError.message}`);
                return;
            }
        }

        const { userId, companyId } = session.metadata;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (!userId || !companyId) {
            console.error('Webhook received checkout.session.completed without required metadata.');
            response.status(400).send('Missing metadata.');
            return;
        }

        try {
            // Update the subscription with the metadata from the checkout session
            await stripe.subscriptions.update(subscriptionId, { metadata: { userId, companyId } });

            const subscription = await stripe.subscriptions.retrieve(subscriptionId);

            const product = await admin.firestore().collection('subscriptions').where('stripeProductId', '==', subscription.items.data[0].price.product).get();
            if (product.empty) {
                 throw new Error(`No product found with stripeProductId: ${subscription.items.data[0].price.product}`);
            }
            const productData = product.docs[0].data();

            const newSubId = `com_s_${uuidv4()}`;
            const subscriptionRef = admin.firestore().collection('companies').doc(companyId).collection('subscriptions').doc(newSubId);

            await subscriptionRef.set({
                id: newSubId,
                dripDropSubscriptionId: product.docs[0].id,
                name: productData.name,
                description: productData.description,
                price: productData.price,
                stripePriceId: subscription.items.data[0].price.id,
                stripeProductId: subscription.items.data[0].price.product,
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: customerId,
                userId: userId,
                status: subscription.status,
                started: admin.firestore.Timestamp.fromMillis(subscription.created * 1000),
                currentPeriodStart: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
                currentPeriodEnd: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
                lastPaid: admin.firestore.Timestamp.now(),
            });

            console.log(`Successfully created subscription ${newSubId} for company ${companyId}.`);

        } catch (dbError) {
            console.error('Database update failed after receiving webhook:', dbError);
            response.status(500).send(`Internal Server Error: ${dbError.message}`);
            return;
        }
    }

    // Handle the 'customer.subscription.updated' event
    if (event.type === 'customer.subscription.updated') {
        const subscription = event.data.object;
        const salesUpdated = await updateSalesBillingSubscriptionFromStripe({
            subscription,
            connectedAccount: event.account || subscription.metadata?.stripeConnectedAccountId || '',
        });

        if (salesUpdated) {
            response.status(200).send('Sales subscription updated.');
            return;
        }

        const stripeSubscriptionId = subscription.id;
        const { companyId } = subscription.metadata;

        try {
            const companySubscriptionsRef = admin.firestore().collection('companies').doc(companyId).collection('subscriptions').where('stripeSubscriptionId', '==', stripeSubscriptionId);
            const querySnapshot = await companySubscriptionsRef.get();

            if (querySnapshot.empty) {
                console.warn(`Webhook received for a subscription not found in the database: ${stripeSubscriptionId}`);
                response.status(200).send('Subscription not found in DB, but webhook acknowledged.');
                return;
            }

            const newStripeProductId = subscription.items.data[0].price.product;
            const productQuery = await admin.firestore().collection('subscriptions').where('stripeProductId', '==', newStripeProductId).get();

            if (productQuery.empty) {
                console.error(`Webhook received for an unknown product: ${newStripeProductId}. Cannot update subscription details.`);
                 // Even if the product is unknown, we should still update the status.
            } 
            
            const productData = productQuery.docs[0]?.data() || {};

            const updateData = {
                // Update fields from our product template if available
                ...(productData.name && { name: productData.name }),
                ...(productData.description && { description: productData.description }),
                ...(productData.price && { price: productData.price }),
                ...(productQuery.docs[0]?.id && { dripDropSubscriptionId: productQuery.docs[0].id }),
                
                // Update stripe-specific fields
                stripePriceId: subscription.items.data[0].price.id,
                stripeProductId: newStripeProductId,
                
                // Update period info from the webhook payload
                // current_period_start: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
                // current_period_end: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
                status: subscription.status, // Default to the status from Stripe
                // cancel_at: subscription.cancel_at ? admin.firestore.Timestamp.fromMillis(subscription.cancel_at * 1000) : null,
            };
            console.log('Updated Data ',updateData)
            // Handle the specific 'pending_cancellation' status
            if (subscription.cancel_at_period_end) {
                updateData.status = 'pending_cancellation';
            }

            const updates = querySnapshot.docs.map(doc => doc.ref.update(updateData));
            await Promise.all(updates);

            console.log(`Successfully updated subscription(s) with Stripe ID ${stripeSubscriptionId}.`);

        } catch (dbError) {
            console.error('Database update failed for subscription update:', dbError);
            response.status(500).send(`Internal Server Error: ${dbError.message}`);
            return;
        }
    }

    // Handle the 'customer.subscription.deleted' event
    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const salesUpdated = await updateSalesBillingSubscriptionFromStripe({
            subscription,
            connectedAccount: event.account || subscription.metadata?.stripeConnectedAccountId || '',
        });

        if (salesUpdated) {
            response.status(200).send('Sales subscription canceled.');
            return;
        }

        const stripeSubscriptionId = subscription.id;
        const { companyId } = subscription.metadata;

        try {
            // Find the subscription in your database using the companyId from the metadata
            const companySubscriptionsRef = admin.firestore().collection('companies').doc(companyId).collection('subscriptions').where('stripeSubscriptionId', '==', stripeSubscriptionId);
            const querySnapshot = await companySubscriptionsRef.get();

            if (querySnapshot.empty) {
                console.warn(`Webhook received for a subscription not found in the database: ${stripeSubscriptionId}`);
                response.status(200).send('Subscription not found in DB, but webhook acknowledged.');
                return;
            }

            // Update the status of the found subscription(s)
            const updates = querySnapshot.docs.map(doc => doc.ref.update({ status: 'canceled' }));
            await Promise.all(updates);

            console.log(`Successfully marked subscription(s) with Stripe ID ${stripeSubscriptionId} as canceled.`);

        } catch (dbError) {
            console.error('Database update failed for subscription cancellation:', dbError);
            response.status(500).send(`Internal Server Error: ${dbError.message}`);
            return;
        }
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed' || event.type === 'invoice.finalized') {
        try {
            const invoice = event.data.object;
            const handledSalesInvoice = await upsertSalesInvoiceAndPaymentFromStripeInvoice({
                invoice,
                connectedAccount: event.account || '',
                eventType: event.type,
                eventId: event.id,
            });

            if (handledSalesInvoice) {
                response.status(200).send('Sales invoice synchronized.');
                return;
            }
        } catch (invoiceError) {
            console.error('Database update failed for sales invoice webhook:', invoiceError);
            response.status(500).send(`Internal Server Error: ${invoiceError.message}`);
            return;
        }
    }

    // Send a 200 response to acknowledge receipt of the event
    response.status(200).send();
});
