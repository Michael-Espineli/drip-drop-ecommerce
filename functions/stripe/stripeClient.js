const { HttpsError } = require('../appErrors');
const functions = require("firebase-functions");
const stripePackage = require("stripe");

let stripeClient;

const getStripeApiKey = () => {
  const key = (
    process.env.STRIPE_API_KEY ||
    process.env.STRIPE_SECRET_KEY ||
    process.env.stripe_secret_key ||
    ""
  ).trim();

  if (!key || key === "sk_test_dummyApiKey") {
    throw new HttpsError(
      "failed-precondition",
      "Stripe API key is not configured for Cloud Functions."
    );
  }

  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (project === 'the-pool-app-dev' && !/^(sk|rk)_test_/.test(key)) {
    throw new HttpsError('failed-precondition', 'Development billing requires a Stripe test key.');
  }
  if (project === 'the-pool-app-3e652' && !/^(sk|rk)_live_/.test(key)) {
    throw new HttpsError('failed-precondition', 'Production billing requires a Stripe live key.');
  }

  return key;
};

const getStripe = () => {
  if (!stripeClient) {
    stripeClient = stripePackage(getStripeApiKey(), { apiVersion: '2025-02-24.acacia', maxNetworkRetries: 2 });
  }

  return stripeClient;
};

const createStripeProxy = () => new Proxy({}, {
  get: (_target, property) => getStripe()[property],
});

module.exports = {
  createStripeProxy,
  getStripe,
  getStripeApiKey,
};
