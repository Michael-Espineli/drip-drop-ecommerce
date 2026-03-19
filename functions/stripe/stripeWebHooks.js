require('dotenv').config({ path: `.env.${process.env.GCLOUD_PROJECT}` });
// Rewritten to use the modern v2 Cloud Function structure.
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require('uuid');

// Securely access the Stripe API key from the environment variables.
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

// Securely access the webhook secret from the environment variables.
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

    // Send a 200 response to acknowledge receipt of the event
    response.status(200).send();
});