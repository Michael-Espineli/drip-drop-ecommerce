
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const {getFirestore} = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');

const admin = require("firebase-admin");
const db = admin.firestore();
const {
    createStripeProxy,
} = require("./stripeClient");

const stripe = createStripeProxy();

const normalizeStripeCustomerId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    return id.startsWith('cus_') ? id : '';
};

const getCompanyStripeCustomerId = (companyData = {}) => (
    normalizeStripeCustomerId(companyData.stripeCustomerId) ||
    normalizeStripeCustomerId(companyData.stripeId)
);

const getUserStripeCustomerId = (userData = {}) => (
    normalizeStripeCustomerId(userData.stripeCustomerId) ||
    normalizeStripeCustomerId(userData.stripeId)
);

const normalizeStripeAccountId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    return id.startsWith('acct_') ? id : '';
};

const getCompanyConnectedAccountId = (companyData = {}) => (
    normalizeStripeAccountId(companyData.stripeConnectedAccountId) ||
    normalizeStripeAccountId(companyData.stripeConnectAccountId)
);

const getCallableData = (data) => data?.data || data || {};

const getStripeErrorMessage = (error, fallbackMessage) => (
    error?.raw?.message ||
    error?.message ||
    fallbackMessage
);

const buildStripeRedirectUrl = (value, fallbackPath) => {
    const fallbackUrl = `https://dripdrop-poolapp.com${fallbackPath}`;

    try {
        const url = new URL(String(value || fallbackUrl));
        const isAllowedHttpLocalhost = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
        return url.protocol === 'https:' || isAllowedHttpLocalhost ? url.toString() : fallbackUrl;
    } catch (error) {
        return fallbackUrl;
    }
};

const accountHasOpenRequirements = (account = {}) => {
    const requirements = account.requirements || {};
    const currentlyDue = requirements.currently_due || [];
    const pastDue = requirements.past_due || [];
    const pendingVerification = requirements.pending_verification || [];
    const errors = requirements.errors || [];

    return (
        currentlyDue.length > 0 ||
        pastDue.length > 0 ||
        pendingVerification.length > 0 ||
        errors.length > 0 ||
        Boolean(requirements.disabled_reason)
    );
};

const requireCallableAuth = async (data, context) => {
    if (context.auth?.uid) {
        return {
            uid: context.auth.uid,
            token: context.auth.token || {},
        };
    }

    const payload = getCallableData(data);
    const authorizationHeader =
        context.rawRequest?.headers?.authorization ||
        context.rawRequest?.headers?.Authorization ||
        '';
    const bearerToken = String(authorizationHeader).startsWith('Bearer ')
        ? String(authorizationHeader).slice('Bearer '.length).trim()
        : '';
    const idToken = [
        payload.idToken,
        payload.auth?.idToken,
        payload.data?.idToken,
        bearerToken,
    ].find((candidate) => String(candidate || '').trim());

    if (!idToken) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return {
            uid: decodedToken.uid,
            token: decodedToken,
        };
    } catch (error) {
        console.error('Unable to verify Stripe callable auth token', error);
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
};

const getOwnerCompanyForStripe = async ({ companyId, uid }) => {
    if (!companyId) {
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
    }

    const companyRef = db.collection('companies').doc(companyId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Company not found.');
    }

    const companyData = companySnap.data() || {};
    if (companyData.ownerId !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Only the company owner can manage the connected Stripe account.');
    }

    return { companyRef, companyData };
};

const resolveOrCreateStripeCustomer = async ({ providedCustomerId, companyId, userId, authEmail }) => {
    const providedStripeCustomerId = normalizeStripeCustomerId(providedCustomerId);

    const companyRef = db.collection('companies').doc(companyId);
    const userRef = db.collection('users').doc(userId);
    const [companySnap, userSnap] = await Promise.all([
        companyRef.get(),
        userRef.get(),
    ]);

    if (!companySnap.exists) {
        throw new HttpsError('not-found', 'Company not found.');
    }

    const companyData = companySnap.data() || {};
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const existingUserStripeCustomerId = getUserStripeCustomerId(userData);

    if (providedStripeCustomerId) {
        const existingCompanyStripeCustomerId = getCompanyStripeCustomerId(companyData);
        const matchesSavedCustomer = [
            existingUserStripeCustomerId,
            existingCompanyStripeCustomerId,
        ].filter(Boolean).includes(providedStripeCustomerId);

        if ((existingUserStripeCustomerId || existingCompanyStripeCustomerId) && !matchesSavedCustomer) {
            throw new HttpsError('permission-denied', 'Provided Stripe customer does not match this user or company.');
        }

        await userRef.set({
            stripeId: providedStripeCustomerId,
            stripeCustomerId: providedStripeCustomerId,
        }, { merge: true });

        return providedStripeCustomerId;
    }

    if (existingUserStripeCustomerId) {
        return existingUserStripeCustomerId;
    }

    const existingCompanyStripeCustomerId = getCompanyStripeCustomerId(companyData);
    if (existingCompanyStripeCustomerId) {
        await userRef.set({
            stripeId: existingCompanyStripeCustomerId,
            stripeCustomerId: existingCompanyStripeCustomerId,
        }, { merge: true });

        return existingCompanyStripeCustomerId;
    }

    const firstName = userData.firstName || '';
    const lastName = userData.lastName || '';
    const customerName = companyData.ownerName || `${firstName} ${lastName}`.trim() || companyData.name || undefined;
    const customerEmail = companyData.email || userData.email || authEmail || undefined;

    const customer = await stripe.customers.create({
        ...(customerEmail && { email: customerEmail }),
        ...(customerName && { name: customerName }),
        metadata: {
            companyId,
            userId,
        },
    });

    await Promise.all([
        userRef.set({
            stripeId: customer.id,
            stripeCustomerId: customer.id,
        }, { merge: true }),
        companyRef.set({
            stripeId: customer.id,
            stripeCustomerId: customer.id,
        }, { merge: true }),
    ]);

    return customer.id;
};

exports.createSubscriptionCheckoutSession = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // Destructure all required data, including the new redirect URLs
    const { stripePriceId, stripeId, stripeCustomerId, userId, companyId, successUrl, cancelUrl } = request.data || {};
    const billingUserId = userId || request.auth.uid;

    if (!stripePriceId || !billingUserId || !companyId || !successUrl || !cancelUrl) {
        throw new HttpsError('invalid-argument', 'The function must be called with all required arguments: "stripePriceId", "userId", "companyId", "successUrl", and "cancelUrl".');
    }

    if (billingUserId !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'You can only start checkout for your own user account.');
    }

    const userAccessSnap = await db
        .collection('users')
        .doc(request.auth.uid)
        .collection('userAccess')
        .doc(companyId)
        .get();

    if (!userAccessSnap.exists) {
        throw new HttpsError('permission-denied', 'You do not have access to this company.');
    }

    try {
        const resolvedStripeCustomerId = await resolveOrCreateStripeCustomer({
            providedCustomerId: stripeCustomerId || stripeId,
            companyId,
            userId: billingUserId,
            authEmail: request.auth.token?.email,
        });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer: resolvedStripeCustomerId,
            line_items: [
                {
                    price: stripePriceId,
                    quantity: 1,
                },
            ],
            metadata: {
                userId: billingUserId,
                companyId: companyId,
            },
            // Use the URLs passed from the frontend client
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        return { url: session.url };

    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }

        console.error("Stripe Checkout Session Error:", error);
        throw new HttpsError('internal', 'Unable to create Stripe checkout session.', error.message);
    }
});

// --- Other functions --- 

exports.createStripeCustomer = functions.https.onCall(async(data, context) => {
    const auth = await requireCallableAuth(data, context);
    const receivedData = getCallableData(data);
    const userId = receivedData.userId || auth.uid;

    if (userId !== auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'You can only create a Stripe customer for your own user account.');
    }

    const userRef = getFirestore().collection('users').doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const existingStripeCustomerId = getUserStripeCustomerId(userData);

    if (existingStripeCustomerId) {
        return {
            status: 200,
            stripeId: existingStripeCustomerId,
            customer: { id: existingStripeCustomerId },
            created: false,
        };
    }

    try {
      const customer = await stripe.customers.create({
        name: receivedData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || undefined,
        email: receivedData.email || userData.email || auth.token?.email || undefined,
        metadata: {
            userId,
        },
      });

      await userRef.set({
        stripeId: customer.id,
        stripeCustomerId: customer.id,
      }, { merge: true });

      console.log("Successfully created new stripe customer");
      return {
        status: 200,
        stripeId: customer.id,
        customer,
        created: true,
      };
    } catch(error) {
      console.error(error);
      throw new functions.https.HttpsError('internal', 'Unable to create Stripe customer.', error.message);
    }
  });
 
exports.createStripeAccountLink = functions.https.onCall(async(data,context) => {
    const auth = await requireCallableAuth(data, context);
    const receivedData = getCallableData(data);
    const companyId = receivedData.companyId;
    const { companyData } = await getOwnerCompanyForStripe({ companyId, uid: auth.uid });
    const companyAccountId = getCompanyConnectedAccountId(companyData);
    const accountId = normalizeStripeAccountId(receivedData.accountId || receivedData.account || companyAccountId);

    if (!accountId) {
        throw new functions.https.HttpsError('failed-precondition', 'This company does not have a Stripe connected account yet.');
    }

    if (companyAccountId && accountId !== companyAccountId) {
        throw new functions.https.HttpsError('permission-denied', 'Connected account does not belong to this company.');
    }

    try {
      const account = await stripe.accounts.retrieve(accountId);
      const shouldUseOnboardingLink = !account.details_submitted || accountHasOpenRequirements(account);

      if (!shouldUseOnboardingLink) {
        const loginLink = await stripe.accounts.createLoginLink(accountId);

        return {
          status: 200,
          accountId,
          accountLink: loginLink.url,
          url: loginLink.url,
          linkType: 'login',
        };
      }

      const returnUrl = buildStripeRedirectUrl(
        receivedData.returnUrl,
        `/return/${accountId}`
      );
      const refreshUrl = buildStripeRedirectUrl(
        receivedData.refreshUrl || receivedData.returnUrl,
        `/refresh/${accountId}`
      );
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        type: "account_onboarding",
      });

      return {
        status: 200,
        accountId,
        accountLink: accountLink.url,
        url: accountLink.url,
        linkType: 'onboarding',
      };
    } catch (error) {
      const message = getStripeErrorMessage(error, 'Unable to create Stripe account link.');
      console.error(
        "An error occurred when calling the Stripe API to create an account link:",
        {
          accountId,
          message,
          stripeCode: error?.code,
          stripeType: error?.type,
          requestId: error?.requestId,
        }
      );
      throw new functions.https.HttpsError(
        error?.type === 'StripeInvalidRequestError' ? 'failed-precondition' : 'internal',
        message,
        {
          stripeCode: error?.code || '',
          stripeType: error?.type || '',
          requestId: error?.requestId || '',
        }
      );
    }
  });
  
  exports.createNewStripeAccount = functions.https.onCall(async(data,context) => {
    const auth = await requireCallableAuth(data, context);
    let receivedData = getCallableData(data);
    const companyId = receivedData.companyId;
    const { companyRef, companyData } = await getOwnerCompanyForStripe({ companyId, uid: auth.uid });
    const existingAccountId = getCompanyConnectedAccountId(companyData);

    if (existingAccountId) {
      return {
        status: 200,
        account: existingAccountId,
        created: false,
      };
    }

    try {
      const account = await stripe.accounts.create({
        type: 'express', 
        country: 'US',  
        email: receivedData.email || companyData.email || auth.token?.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: companyData.name || companyData.companyName || undefined,
          url: companyData.websiteURL || undefined,
        },
        metadata: {
          companyId,
          ownerId: auth.uid,
        },
      });
  
      await companyRef.set({
        stripeConnectedAccountId: account.id,
        stripeConnectedAccountStatus: "Not Started",
        stripeConnectAccountId: account.id,
        stripeConnectAccountStatus: "Not Started",
        stripeConnectedAccountOwnerId: auth.uid,
        stripeConnectedAccountCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        status: 200,
        account: account.id,
        created: true,
      };
    } catch (error) {
      console.error(
        "An error occurred when calling the Stripe API to create an account",
        error
      );
      throw new functions.https.HttpsError('internal', 'Unable to create Stripe connected account.', error.message);
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

    const { stripeCustomerId, companyId } = request.data || {};
    let resolvedStripeCustomerId = normalizeStripeCustomerId(stripeCustomerId);

    if (!resolvedStripeCustomerId) {
        const userSnap = await db.collection('users').doc(request.auth.uid).get();
        resolvedStripeCustomerId = getUserStripeCustomerId(userSnap.data());
    }

    if (!resolvedStripeCustomerId && companyId) {
        const companySnap = await db.collection('companies').doc(companyId).get();
        resolvedStripeCustomerId = getCompanyStripeCustomerId(companySnap.data());
    }

    if (!resolvedStripeCustomerId) {
        return { status: "success", invoices: [] };
    }

    try {
        const invoices = await stripe.invoices.list({
            customer: resolvedStripeCustomerId,
            limit: 10,
        });
        return { status: "success", invoices: invoices.data };
    } catch (error) {
        if (error.code === 'resource_missing') {
            return { status: "success", invoices: [] };
        }

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
