
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const {getFirestore} = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');
const { v4: uuidv4 } = require('uuid');

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

const normalizeStripeSubscriptionId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    return id.startsWith('sub_') ? id : '';
};

const normalizeStripePriceId = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    return id.startsWith('price_') ? id : '';
};

const normalizeCurrency = (value) => {
    const currency = String(value || 'usd').trim().toLowerCase();
    return /^[a-z]{3}$/.test(currency) ? currency : 'usd';
};

const getStripePublishableKey = () => (
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.PUBLISHABLE_STRIPE_KEY ||
    process.env.stripe_publishable_key ||
    ''
).trim();

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

const isDripDropAdmin = async ({ uid, token = {} }) => {
    if (!uid) return false;
    if (uid === 'yRV5Ie18rrUSxT6UkWctPc99lMJ2') return true;
    if (token.admin === true) return true;

    const userSnap = await db.collection('users').doc(uid).get();
    const accountType = String(userSnap.data()?.accountType || '').toLowerCase();
    return accountType === 'admin';
};

const getCompanyBillingAccess = async ({ uid, companyId }) => {
    if (!uid || !companyId) return { allowed: false };

    const companyRef = db.collection('companies').doc(companyId);
    const accessRef = db.collection('users').doc(uid).collection('userAccess').doc(companyId);
    const [companySnap, accessSnap] = await Promise.all([
        companyRef.get(),
        accessRef.get(),
    ]);

    if (!companySnap.exists) {
        throw new HttpsError('not-found', 'Company not found.');
    }

    const companyData = companySnap.data() || {};
    if (companyData.ownerId === uid) {
        return { allowed: true, companyRef, companyData, accessData: null };
    }

    if (!accessSnap.exists) {
        return { allowed: false, companyRef, companyData, accessData: null };
    }

    const accessData = accessSnap.data() || {};
    const roleName = String(accessData.roleName || '').trim().toLowerCase();
    if (['owner', 'admin', 'manager'].includes(roleName)) {
        return { allowed: true, companyRef, companyData, accessData };
    }

    if (accessData.roleId) {
        const roleSnap = await companyRef.collection('roles').doc(String(accessData.roleId)).get();
        const permissionIdList = roleSnap.data()?.permissionIdList;
        if (Array.isArray(permissionIdList) && permissionIdList.includes('400')) {
            return { allowed: true, companyRef, companyData, accessData };
        }
    }

    return { allowed: false, companyRef, companyData, accessData };
};

const requireCompanyBillingManager = async ({ uid, companyId }) => {
    const access = await getCompanyBillingAccess({ uid, companyId });
    if (!access.allowed) {
        throw new HttpsError('permission-denied', 'You do not have permission to manage billing for this company.');
    }

    return access;
};

const companyIdFromCompanySubscriptionRef = (subscriptionRef) => (
    subscriptionRef?.parent?.parent?.id || ''
);

const findManagedCompanySubscriptionByStripeId = async ({ uid, stripeSubscriptionId, companyId = '' }) => {
    const normalizedSubscriptionId = normalizeStripeSubscriptionId(stripeSubscriptionId);
    if (!normalizedSubscriptionId) {
        throw new HttpsError('invalid-argument', 'A valid Stripe subscription id is required.');
    }

    const candidates = [];

    if (companyId) {
        const access = await requireCompanyBillingManager({ uid, companyId });
        const snapshot = await access.companyRef
            .collection('subscriptions')
            .where('stripeSubscriptionId', '==', normalizedSubscriptionId)
            .limit(1)
            .get();

        snapshot.docs.forEach((docSnap) => candidates.push(docSnap));
    } else {
        const snapshot = await db
            .collectionGroup('subscriptions')
            .where('stripeSubscriptionId', '==', normalizedSubscriptionId)
            .limit(20)
            .get();

        for (const docSnap of snapshot.docs) {
            const candidateCompanyId = companyIdFromCompanySubscriptionRef(docSnap.ref);
            if (!candidateCompanyId) continue;

            const access = await getCompanyBillingAccess({ uid, companyId: candidateCompanyId });
            if (access.allowed) {
                candidates.push(docSnap);
                break;
            }
        }
    }

    if (candidates.length === 0) {
        throw new HttpsError('permission-denied', 'This Stripe subscription is not linked to a company you can manage.');
    }

    const subscriptionSnap = candidates[0];
    const resolvedCompanyId = companyIdFromCompanySubscriptionRef(subscriptionSnap.ref) || companyId;

    return {
        subscriptionRef: subscriptionSnap.ref,
        subscription: { id: subscriptionSnap.id, ...subscriptionSnap.data() },
        companyId: resolvedCompanyId,
    };
};

const findManagedCompanyByStripeCustomerId = async ({ uid, stripeCustomerId, companyId = '' }) => {
    const customerId = normalizeStripeCustomerId(stripeCustomerId);
    if (!customerId) {
        throw new HttpsError('invalid-argument', 'A valid Stripe customer id is required.');
    }

    const candidateCompanyIds = new Set();

    if (companyId) {
        candidateCompanyIds.add(companyId);
    } else {
        const [companyCustomerSnap, companyLegacySnap, subscriptionSnap] = await Promise.all([
            db.collection('companies').where('stripeCustomerId', '==', customerId).limit(10).get(),
            db.collection('companies').where('stripeId', '==', customerId).limit(10).get(),
            db.collectionGroup('subscriptions').where('stripeCustomerId', '==', customerId).limit(20).get(),
        ]);

        companyCustomerSnap.docs.forEach((docSnap) => candidateCompanyIds.add(docSnap.id));
        companyLegacySnap.docs.forEach((docSnap) => candidateCompanyIds.add(docSnap.id));
        subscriptionSnap.docs.forEach((docSnap) => {
            const subscriptionCompanyId = companyIdFromCompanySubscriptionRef(docSnap.ref);
            if (subscriptionCompanyId) candidateCompanyIds.add(subscriptionCompanyId);
        });
    }

    for (const candidateCompanyId of candidateCompanyIds) {
        const access = await getCompanyBillingAccess({ uid, companyId: candidateCompanyId });
        if (!access.allowed) continue;

        const companyCustomerId = getCompanyStripeCustomerId(access.companyData);
        if (companyCustomerId === customerId) {
            return { ...access, companyId: candidateCompanyId, stripeCustomerId: customerId };
        }

        const subscriptionSnap = await access.companyRef
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

        if (!subscriptionSnap.empty) {
            return { ...access, companyId: candidateCompanyId, stripeCustomerId: customerId };
        }
    }

    throw new HttpsError('permission-denied', 'This Stripe customer is not linked to a company you can manage.');
};

const requireActiveDripDropPlanByPriceId = async (priceId) => {
    const stripePriceId = normalizeStripePriceId(priceId);
    if (!stripePriceId) {
        throw new HttpsError('invalid-argument', 'A valid Stripe price id is required.');
    }

    const snapshot = await db
        .collection('subscriptions')
        .where('stripePriceId', '==', stripePriceId)
        .limit(5)
        .get();

    const activePlanDoc = snapshot.docs.find((docSnap) => docSnap.data()?.active === true);
    if (!activePlanDoc) {
        throw new HttpsError('failed-precondition', 'The selected Drip Drop subscription plan is not active.');
    }

    return {
        id: activePlanDoc.id,
        ...activePlanDoc.data(),
    };
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

    await requireCompanyBillingManager({ uid: request.auth.uid, companyId });
    await requireActiveDripDropPlanByPriceId(stripePriceId);

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
            success_url: buildStripeRedirectUrl(successUrl, '/company/settings/subscriptions?success=true'),
            cancel_url: buildStripeRedirectUrl(cancelUrl, '/company/settings/subscriptions/picker?canceled=true'),
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

exports.createStripeSubscription = functions.https.onCall(async(data, context) => {
    const auth = await requireCallableAuth(data, context);
    const receivedData = getCallableData(data);

    if (!(await isDripDropAdmin(auth))) {
      throw new functions.https.HttpsError('permission-denied', 'Only Drip Drop admins can create subscription catalog plans.');
    }

    const name = String(receivedData.name || '').trim();
    const description = String(receivedData.description || '').trim();
    const priceCents = Math.round(Number(receivedData.price || receivedData.amountCents || 0));
    const currency = normalizeCurrency(receivedData.currency);
    const interval = ['day', 'week', 'month', 'year'].includes(String(receivedData.interval || '').toLowerCase())
      ? String(receivedData.interval).toLowerCase()
      : 'month';
    const intervalCount = Math.max(Number(receivedData.intervalCount || 1), 1);

    if (!name) {
      throw new functions.https.HttpsError('invalid-argument', 'Plan name is required.');
    }

    if (!Number.isFinite(priceCents) || priceCents < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Plan price must be zero or greater.');
    }

    try {
      const product = await stripe.products.create({
        name,
        description: description || undefined,
        metadata: {
          source: 'dripDropSubscriptionCatalog',
          createdByUserId: auth.uid,
        },
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency,
        unit_amount: priceCents,
        recurring: {
          interval,
          interval_count: intervalCount,
        },
        metadata: {
          source: 'dripDropSubscriptionCatalog',
          createdByUserId: auth.uid,
        },
      });
      const subscriptionId = String(receivedData.id || `sub_${uuidv4()}`);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const subscriptionRecord = {
        id: subscriptionId,
        stripeProductId: product.id,
        stripePriceId: price.id,
        price: priceCents,
        currency,
        interval,
        intervalCount,
        name,
        description,
        internalNotes: String(receivedData.internalNotes || ''),
        active: receivedData.active === undefined ? true : receivedData.active === true,
        dateCreated: now,
        lastUpdated: now,
        createdByUserId: auth.uid,
        updatedByUserId: auth.uid,
      };

      await db.collection('subscriptions').doc(subscriptionId).set(subscriptionRecord, { merge: true });

      return {
        status: 200,
        product,
        price,
        subscription: subscriptionRecord,
      };
    } catch(error) {
      console.error('Unable to create Drip Drop subscription catalog plan', error);
      throw new functions.https.HttpsError('internal', 'Unable to create subscription plan.', error.message);
    }
  });

exports.getStripeSubscriptionInformation = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, companyId } = request.data || {};
    const managedSubscription = await findManagedCompanySubscriptionByStripeId({
        uid: request.auth.uid,
        stripeSubscriptionId: subscriptionId,
        companyId,
    });

    try {
        const subscription = await stripe.subscriptions.retrieve(
            managedSubscription.subscription.stripeSubscriptionId,
            { expand: ['items.data.price.product', 'latest_invoice', 'default_payment_method'] }
        );

        return { status: 'success', subscription };
    } catch (error) {
        console.error('Unable to retrieve Stripe subscription information', error);
        throw new HttpsError('internal', 'Unable to retrieve Stripe subscription information.', error.message);
    }
});

exports.getstripeSubscriptions = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { companyId, stripeCustomerId } = request.data || {};
    let resolvedStripeCustomerId = normalizeStripeCustomerId(stripeCustomerId);

    if (!resolvedStripeCustomerId && companyId) {
        const access = await requireCompanyBillingManager({ uid: request.auth.uid, companyId });
        resolvedStripeCustomerId = getCompanyStripeCustomerId(access.companyData);
    }

    if (!resolvedStripeCustomerId) {
        return { status: 'success', subscriptions: { data: [] } };
    }

    const customerAccess = await findManagedCompanyByStripeCustomerId({
        uid: request.auth.uid,
        stripeCustomerId: resolvedStripeCustomerId,
        companyId,
    });

    try {
        const subscriptions = await stripe.subscriptions.list({
            customer: customerAccess.stripeCustomerId,
            limit: 20,
        });

        return { status: 'success', subscriptions };
    } catch (error) {
        console.error('Unable to list Stripe subscriptions', error);
        throw new HttpsError('internal', 'Unable to list Stripe subscriptions.', error.message);
    }
});

exports.createSubscriptionCheckoutSessionNewCustomer = exports.createSubscriptionCheckoutSession;
 
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
    const auth = await requireCallableAuth(data, context);
    const receivedData = getCallableData(data);
    const stripePriceId = normalizeStripePriceId(receivedData.priceId || receivedData.stripePriceId);
    const providedCustomerId = normalizeStripeCustomerId(
      receivedData.customerId ||
      receivedData.stripeCustomerId ||
      receivedData.stripeId
    );

    if (!stripePriceId) {
      throw new functions.https.HttpsError('invalid-argument', 'A valid Stripe price id is required.');
    }

    const publishableKey = getStripePublishableKey();
    if (!publishableKey) {
      throw new functions.https.HttpsError('failed-precondition', 'Stripe publishable key is not configured for mobile subscription checkout.');
    }

    const activePlan = await requireActiveDripDropPlanByPriceId(stripePriceId);
    const resolvedCompanyAccess = receivedData.companyId
      ? await requireCompanyBillingManager({ uid: auth.uid, companyId: receivedData.companyId })
      : providedCustomerId
        ? await findManagedCompanyByStripeCustomerId({ uid: auth.uid, stripeCustomerId: providedCustomerId })
        : null;

    if (!resolvedCompanyAccess?.companyId && !receivedData.companyId) {
      throw new functions.https.HttpsError('invalid-argument', 'companyId or a saved company Stripe customer id is required.');
    }

    const companyId = receivedData.companyId || resolvedCompanyAccess.companyId;

    try {
      const resolvedStripeCustomerId = await resolveOrCreateStripeCustomer({
        providedCustomerId,
        companyId,
        userId: auth.uid,
        authEmail: auth.token?.email,
      });

      const subscription = await stripe.subscriptions.create({
        customer: resolvedStripeCustomerId,
        items: [{
          price: stripePriceId,
        }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        metadata: {
          userId: auth.uid,
          companyId,
          dripDropSubscriptionId: activePlan.id || '',
        },
        expand: ['latest_invoice.confirmation_secret'],
      });
      const requestedStripeVersion = String(receivedData.stripeVersion || '').trim();
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: resolvedStripeCustomerId },
        requestedStripeVersion ? { apiVersion: requestedStripeVersion } : undefined
      );

      return {
        status: 200,
        subscriptionId: subscription.id,
        customerId: resolvedStripeCustomerId,
        ephemeralKey: ephemeralKey.secret,
        publishableKey,
        clientSecret: subscription.latest_invoice.confirmation_secret.client_secret,
      };
    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      console.error(
        "An error occurred when calling the Stripe API:",
        error
      );
      throw new functions.https.HttpsError('internal', 'Unable to create subscription payment intent.', error.message);
    }
  });

exports.cancelStripeSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, companyId } = request.data || {};
    if (!subscriptionId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "subscriptionId" argument.');
    }

    try {
        const managedSubscription = await findManagedCompanySubscriptionByStripeId({
            uid: request.auth.uid,
            stripeSubscriptionId: subscriptionId,
            companyId,
        });
        const canceledSubscription = await stripe.subscriptions.update(
            managedSubscription.subscription.stripeSubscriptionId,
            { cancel_at_period_end: true }
        );

        await managedSubscription.subscriptionRef.set({
            status: canceledSubscription.cancel_at_period_end ? 'pending_cancellation' : canceledSubscription.status,
            cancel_at: canceledSubscription.cancel_at
                ? admin.firestore.Timestamp.fromMillis(canceledSubscription.cancel_at * 1000)
                : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return { status: "success", subscription: canceledSubscription };

    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }

        console.error("Stripe Subscription Cancellation Error:", error);
        throw new HttpsError('internal', 'Unable to cancel Stripe subscription.', error.message);
    }
});
 
exports.getSubscriptionUpdatePreview = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, newPriceId, companyId } = request.data || {};
    if (!subscriptionId || !newPriceId) {
        throw new HttpsError('invalid-argument', 'The function must be called with "subscriptionId" and "newPriceId" arguments.');
    }

    try {
        await requireActiveDripDropPlanByPriceId(newPriceId);
        const managedSubscription = await findManagedCompanySubscriptionByStripeId({
            uid: request.auth.uid,
            stripeSubscriptionId: subscriptionId,
            companyId,
        });
        // Retrieve the subscription to get customer and item details
        const subscription = await stripe.subscriptions.retrieve(managedSubscription.subscription.stripeSubscriptionId);
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
        if (error instanceof HttpsError) {
            throw error;
        }

        console.error("Stripe Subscription Preview Error:", error);
        throw new HttpsError('internal', 'Unable to generate subscription update preview.', error.message);
    }
});

exports.updateStripeSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, newPriceId, companyId } = request.data || {};
    if (!subscriptionId || !newPriceId) {
        throw new HttpsError('invalid-argument', 'The function must be called with "subscriptionId" and "newPriceId" arguments.');
    }

    try {
        await requireActiveDripDropPlanByPriceId(newPriceId);
        const managedSubscription = await findManagedCompanySubscriptionByStripeId({
            uid: request.auth.uid,
            stripeSubscriptionId: subscriptionId,
            companyId,
        });
        const subscription = await stripe.subscriptions.retrieve(managedSubscription.subscription.stripeSubscriptionId);
        const currentItemId = subscription.items.data[0].id;

        const updatedSubscription = await stripe.subscriptions.update(managedSubscription.subscription.stripeSubscriptionId, {
            items: [{
                id: currentItemId,
                price: newPriceId,
            }],
            proration_behavior: 'create_prorations',
        });

        await managedSubscription.subscriptionRef.set({
            stripePriceId: updatedSubscription.items.data[0]?.price?.id || newPriceId,
            stripeProductId: typeof updatedSubscription.items.data[0]?.price?.product === 'string'
                ? updatedSubscription.items.data[0].price.product
                : updatedSubscription.items.data[0]?.price?.product?.id || managedSubscription.subscription.stripeProductId || '',
            status: updatedSubscription.cancel_at_period_end ? 'pending_cancellation' : updatedSubscription.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return { status: "success", subscription: updatedSubscription };

    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }

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

    if (resolvedStripeCustomerId) {
        await findManagedCompanyByStripeCustomerId({
            uid: request.auth.uid,
            stripeCustomerId: resolvedStripeCustomerId,
            companyId,
        });
    }

    if (!resolvedStripeCustomerId) {
        if (!companyId) {
            return { status: "success", invoices: [] };
        }

        const access = await requireCompanyBillingManager({ uid: request.auth.uid, companyId });
        resolvedStripeCustomerId = getCompanyStripeCustomerId(access.companyData);
    }

    if (!resolvedStripeCustomerId && companyId) {
        const subscriptionsSnap = await db
            .collection('companies')
            .doc(companyId)
            .collection('subscriptions')
            .where('status', 'in', ['active', 'trialing', 'pending_cancellation'])
            .limit(1)
            .get();

        resolvedStripeCustomerId = normalizeStripeCustomerId(subscriptionsSnap.docs[0]?.data()?.stripeCustomerId);
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
        if (error instanceof HttpsError) {
            throw error;
        }

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

    const { stripeCustomerId, returnUrl, companyId } = request.data || {};
    if (!stripeCustomerId || !returnUrl) {
        throw new HttpsError('invalid-argument', 'The function must be called with "stripeCustomerId" and "returnUrl" arguments.');
    }

    try {
        await findManagedCompanyByStripeCustomerId({
            uid: request.auth.uid,
            stripeCustomerId,
            companyId,
        });
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: buildStripeRedirectUrl(returnUrl, '/company/settings/subscriptions'),
        });
        return { status: "success", url: session.url };
    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }

        console.error("Stripe Portal Session Error:", error);
        throw new HttpsError('internal', 'Unable to create customer portal session.', error.message);
    }
});

exports.getUpcomingInvoice = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { subscriptionId, companyId } = request.data || {};
    if (!subscriptionId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "subscriptionId" argument.');
    }

    try {
        const managedSubscription = await findManagedCompanySubscriptionByStripeId({
            uid: request.auth.uid,
            stripeSubscriptionId: subscriptionId,
            companyId,
        });
        const upcomingInvoice = await stripe.invoices.retrieveUpcoming({
            subscription: managedSubscription.subscription.stripeSubscriptionId,
        });
        return { status: "success", upcomingInvoice: upcomingInvoice };
    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }

        // Stripe throws an error if there is no upcoming invoice (e.g., for a canceled sub)
        // We can check the error type and return a null invoice instead of throwing.
        if (error.code === 'invoice_upcoming_none') {
            return { status: "success", upcomingInvoice: null };
        }
        console.error("Stripe Upcoming Invoice Error:", error);
        throw new HttpsError('internal', 'Unable to retrieve upcoming invoice.', error.message);
    }
});
