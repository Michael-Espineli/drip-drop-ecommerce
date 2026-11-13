import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import BillingReturnPage from '../components/billing/BillingReturnPage';
import { Context } from '../context/AuthContext';

export default function Refresh() {
  const { accountType } = useContext(Context);
  return <>
    <BillingReturnPage title="Stripe setup link expired" description="Open your billing settings to continue setting up your Stripe account." />
    {accountType === 'Company' && <div className="pb-8 text-center"><Link className="inline-flex min-h-[44px] items-center font-semibold text-blue-700" to="/company/settings/stripe-billing">Open billing settings</Link></div>}
  </>;
}
