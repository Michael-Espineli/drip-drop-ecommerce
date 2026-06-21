import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { FaCheckCircle, FaExternalLinkAlt } from 'react-icons/fa';
import { auth, functions } from '../../../../utils/config';

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const extractAccountLinkUrl = (data = {}) => {
  const link = data.accountLink?.url || data.accountLink || data.accountLinkUrl || data.url;
  return typeof link === 'string' && link.trim() ? link : '';
};

const formatRequirement = (requirement) => {
  if (!requirement) return '';
  if (typeof requirement === 'string') return requirement;
  return requirement.reason || requirement.code || requirement.requirement || '';
};

const BillingReadinessCard = ({
  activeSubscriptionCount = 0,
  billingProfileCount = 0,
  className = '',
  companyId = '',
  connectedAccountId = '',
}) => {
  const [stripeReadiness, setStripeReadiness] = useState(null);
  const [stripeReadinessLoading, setStripeReadinessLoading] = useState(false);
  const [stripeReadinessError, setStripeReadinessError] = useState('');
  const [accountLinkLoading, setAccountLinkLoading] = useState(false);

  const hasConnectedAccount = Boolean(connectedAccountId);
  const hasBlockingRequirements = Boolean(
    stripeReadiness?.currentlyDue?.length || stripeReadiness?.pastDue?.length || stripeReadiness?.errors?.length
  );
  const requirementNames = [
    ...(stripeReadiness?.currentlyDue || []),
    ...(stripeReadiness?.pastDue || []),
    ...(stripeReadiness?.errors || []).map(formatRequirement),
  ].filter(Boolean);

  const verifyStripeReadiness = async () => {
    if (!hasConnectedAccount || stripeReadinessLoading) return;

    setStripeReadinessLoading(true);
    setStripeReadinessError('');

    try {
      const verifyCallable = httpsCallable(functions, 'verifyConnectedAccountBillingReadiness');
      const result = await verifyCallable({
        accountId: connectedAccountId,
        connectedAccount: connectedAccountId,
        stripeConnectedAccountId: connectedAccountId,
        companyId,
      });

      setStripeReadiness(result.data);
    } catch (error) {
      console.error('Unable to verify Stripe billing readiness', error);
      setStripeReadinessError(error.message || 'Unable to verify Stripe billing readiness.');
    } finally {
      setStripeReadinessLoading(false);
    }
  };

  const openStripeSetup = async () => {
    if (!hasConnectedAccount || accountLinkLoading) return;

    setAccountLinkLoading(true);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Your session expired. Sign in again before managing Stripe.');
      }

      const idToken = await currentUser.getIdToken(true);
      const createAccountLink = httpsCallable(functions, 'createStripeAccountLink');
      const result = await createAccountLink({
        companyId,
        account: connectedAccountId,
        accountId: connectedAccountId,
        connectedAccount: connectedAccountId,
        idToken,
        data: {
          account: connectedAccountId,
          accountId: connectedAccountId,
          connectedAccount: connectedAccountId,
          companyId,
          idToken,
        },
      });
      const response = result.data || {};

      if (response.error) {
        throw new Error(response.error.message || response.error);
      }

      const accountLinkUrl = extractAccountLinkUrl(response);
      if (!accountLinkUrl) {
        throw new Error('Stripe did not return a setup link.');
      }

      window.location.href = accountLinkUrl;
    } catch (error) {
      console.error('Unable to open Stripe setup', error);
      toast.error(error.details?.message || error.message || 'Unable to open Stripe setup.');
    } finally {
      setAccountLinkLoading(false);
    }
  };

  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Billing Readiness</h2>
          <p className="mt-1 text-sm text-slate-500">
            Check whether the connected Stripe account can collect customer payment methods and online payments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={verifyStripeReadiness}
            disabled={!hasConnectedAccount || stripeReadinessLoading}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {stripeReadinessLoading ? 'Checking...' : 'Check'}
          </button>
          {hasConnectedAccount ? (
            <button
              type="button"
              onClick={openStripeSetup}
              disabled={accountLinkLoading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {accountLinkLoading ? 'Opening...' : 'Open Stripe setup'}
              <FaExternalLinkAlt className="h-3 w-3" />
            </button>
          ) : (
            <Link
              to="/company/profile"
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
            >
              Connect Stripe
              <FaExternalLinkAlt className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-3">
          <FaCheckCircle className={hasConnectedAccount ? 'mt-1 text-emerald-600' : 'mt-1 text-slate-300'} />
          <div>
            <p className="font-semibold text-slate-900">Connected Stripe account</p>
            <p className="mt-1 break-all text-sm text-slate-500">
              {hasConnectedAccount ? connectedAccountId : 'Needs setup before customer billing'}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900">Stripe billing verification</p>
              <p className="mt-1 text-sm text-slate-500">
                {!hasConnectedAccount
                  ? 'Connect Stripe before checking billing readiness'
                  : stripeReadiness?.canBillCustomers
                    ? 'Ready for card billing'
                    : stripeReadiness
                      ? 'Stripe needs attention'
                      : 'Not checked yet'}
              </p>
            </div>
          </div>

          {stripeReadinessError && (
            <p className="mt-2 text-sm font-medium text-rose-600">{stripeReadinessError}</p>
          )}

          {stripeReadiness && (
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Charges</span>
                <span className={stripeReadiness.chargesEnabled ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                  {stripeReadiness.chargesEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Payouts</span>
                <span className={stripeReadiness.payoutsEnabled ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                  {stripeReadiness.payoutsEnabled ? 'Enabled' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Card payments</span>
                <span className={stripeReadiness.cardPaymentsEnabled ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                  {stripeReadiness.cardPaymentsEnabled ? 'Enabled' : labelize(stripeReadiness.capabilities?.cardPayments)}
                </span>
              </div>
              {hasBlockingRequirements && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
                  <p className="font-semibold">Requirements need attention</p>
                  <p className="mt-1 break-words text-xs">
                    {requirementNames.slice(0, 4).join(', ') || 'Open Stripe setup to review the required information.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3">
            <FaCheckCircle className={billingProfileCount > 0 ? 'mt-1 text-emerald-600' : 'mt-1 text-slate-300'} />
            <div>
              <p className="font-semibold text-slate-900">Customer billing profiles</p>
              <p className="mt-1 text-sm text-slate-500">
                {billingProfileCount} profile{billingProfileCount === 1 ? '' : 's'} found.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <FaCheckCircle className={activeSubscriptionCount > 0 ? 'mt-1 text-emerald-600' : 'mt-1 text-slate-300'} />
            <div>
              <p className="font-semibold text-slate-900">Active homeowner billing</p>
              <p className="mt-1 text-sm text-slate-500">
                {activeSubscriptionCount} active subscription{activeSubscriptionCount === 1 ? '' : 's'}.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default BillingReadinessCard;
