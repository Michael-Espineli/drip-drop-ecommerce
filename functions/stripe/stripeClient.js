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
