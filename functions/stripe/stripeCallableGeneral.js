
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const {getFirestore} = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');

const admin = require("firebase-admin");
const db = admin.firestore();

// CORRECTED: Use the Stripe API key from the environment variables loaded in index.js
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

exports.createSubscriptionCheckoutSession = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // Destructure all required data, including the new redirect URLs
    const { stripePriceId, stripeId, userId, companyId, successUrl, cancelUrl } = request.data;
    if (!stripePriceId || !stripeId || !userId || !companyId || !successUrl || !cancelUrl) {
        throw new HttpsError('invalid-argument', 'The function must be called with all required arguments: "stripePriceId", "stripeId", "userId", "companyId", "successUrl", and "cancelUrl".');
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer: stripeId,
            line_items: [
                {
                    price: stripePriceId,
                    quantity: 1,
                },
            ],
            metadata: {
                userId: userId,
                companyId: companyId,
            },
            // Use the URLs passed from the frontend client
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        return { url: session.url };

    } catch (error) {
        console.error("Stripe Checkout Session Error:", error);
        throw new HttpsError('internal', 'Unable to create Stripe checkout session.', error.message);
    }
});

// --- Other functions --- 

exports.createStripeCustomer = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    try {
      const customer = await stripe.customers.create({
        name: receivedData.name,
        email: receivedData.email,
      });
      let newData = { stripeCustomerId: customer.id}
      
      await getFirestore()
      .collection('users').doc(user.id)
      .update(newData);  

      console.log("Successfully created new stripe customer");
      return {
        customer:customer
      }
    } catch(error) {
      console.error(error)
    }
  });
 
exports.createStripeAccountLink = functions.https.onCall(async(data,context) => {
    try {
      const accountId = data.data.accountId;
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        return_url: `https://dripdrop-poolapp.com/return/${accountId}`,
        refresh_url: `https://dripdrop-poolapp.com/refresh/${accountId}`,
        type: "account_onboarding",
      });
      return {
        status: 200,
        accountLink: accountLink.url
      };
    } catch (error) {
      console.error(
        "An error occurred when calling the Stripe API to create an account link:",
        error
      );
      return {
        status: 500,
        error: error.message
      };
    }
  });
  
  exports.createNewStripeAccount = functions.https.onCall(async(data,context) => {
    let receivedData = data.data
    try {
      const account = await stripe.accounts.create({
        type: 'express', 
        country: 'US',  
        email: receivedData.email, 
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
  
      let newData = { stripeConnectedAccountId: account.id}
      await getFirestore()
      .collection('users').doc(user.id)
      .update(newData);  

      return {
        status: 200,
        account: account.id
      };
    } catch (error) {
      console.error(
        "An error occurred when calling the Stripe API to create an account",
        error
      );
      return {
        status: 500,
        error: error.message
      };
    }
  });
  
exports.createSubscriptionPaymentIntent = functions.https.onCall(async(data,context) => {
    try {
      let receivedData = data.data
      const subscription = await stripe.subscriptions.create({
        customer: receivedData.customerId,
        items: [{
          price: receivedData.priceId,
        }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.confirmation_secret'],
      });
      return {
        status: 200,
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.confirmation_secret.client_secret,
      };
    } catch (error) {
      console.error(
        "An error occurred when calling the Stripe API:",
        error
      );
      return {
        status: 500,
        error: error.message
      };
    }
  });

exports.cancelStripeSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId } = request.data;
    if (!subscriptionId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "subscriptionId" argument.');
    }

    try {
        const canceledSubscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
        return { status: "success", subscription: canceledSubscription };

    } catch (error) {
        console.error("Stripe Subscription Cancellation Error:", error);
        throw new HttpsError('internal', 'Unable to cancel Stripe subscription.', error.message);
    }
});
 
exports.getSubscriptionUpdatePreview = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, newPriceId } = request.data;
    if (!subscriptionId || !newPriceId) {
        throw new HttpsError('invalid-argument', 'The function must be called with "subscriptionId" and "newPriceId" arguments.');
    }

    try {
        // Retrieve the subscription to get customer and item details
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const currentItemId = subscription.items.data[0].id;

        // Generate an invoice preview for the upcoming period with the new price
        const invoice = await stripe.invoices.retrieveUpcoming({
            customer: subscription.customer,
            subscription: subscriptionId,
            subscription_items: [{
                id: currentItemId,
                price: newPriceId,
            }],
            subscription_proration_behavior: 'create_prorations',
        });

        return { status: "success", invoice: invoice };

    } catch (error) {
        console.error("Stripe Subscription Preview Error:", error);
        throw new HttpsError('internal', 'Unable to generate subscription update preview.', error.message);
    }
});

exports.updateStripeSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, newPriceId } = request.data;
    if (!subscriptionId || !newPriceId) {
        throw new HttpsError('invalid-argument', 'The function must be called with "subscriptionId" and "newPriceId" arguments.');
    }

    try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const currentItemId = subscription.items.data[0].id;

        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
            items: [{
                id: currentItemId,
                price: newPriceId,
            }],
            proration_behavior: 'create_prorations',
        });

        return { status: "success", subscription: updatedSubscription };

    } catch (error) {
        console.error("Stripe Subscription Update Error:", error);
        throw new HttpsError('internal', 'Unable to update Stripe subscription.', error.message);
    }
});

exports.getStripePaymentHistory = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { stripeCustomerId } = request.data;
    if (!stripeCustomerId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "stripeCustomerId" argument.');
    }

    try {
        const invoices = await stripe.invoices.list({
            customer: stripeCustomerId,
            limit: 10,
        });
        return { status: "success", invoices: invoices.data };
    } catch (error) {
        console.error("Stripe Payment History Error:", error);
        throw new HttpsError('internal', 'Unable to retrieve payment history.', error.message);
    }
});

exports.createStripePortalSession = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { stripeCustomerId, returnUrl } = request.data;
    if (!stripeCustomerId || !returnUrl) {
        throw new HttpsError('invalid-argument', 'The function must be called with "stripeCustomerId" and "returnUrl" arguments.');
    }

    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: returnUrl,
        });
        return { status: "success", url: session.url };
    } catch (error) {
        console.error("Stripe Portal Session Error:", error);
        throw new HttpsError('internal', 'Unable to create customer portal session.', error.message);
    }
});

exports.getUpcomingInvoice = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId } = request.data;
    if (!subscriptionId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "subscriptionId" argument.');
    }

    try {
        const upcomingInvoice = await stripe.invoices.retrieveUpcoming({
            subscription: subscriptionId,
        });
        return { status: "success", upcomingInvoice: upcomingInvoice };
    } catch (error) {
        // Stripe throws an error if there is no upcoming invoice (e.g., for a canceled sub)
        // We can check the error type and return a null invoice instead of throwing.
        if (error.code === 'invoice_upcoming_none') {
            return { status: "success", upcomingInvoice: null };
        }
        console.error("Stripe Upcoming Invoice Error:", error);
        throw new HttpsError('internal', 'Unable to retrieve upcoming invoice.', error.message);
    }
});
