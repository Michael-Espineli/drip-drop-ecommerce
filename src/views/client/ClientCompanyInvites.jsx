import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../utils/config';

export default function ClientCompanyInvites({ user, renderActions }) {
  const [invitations, setInvitations] = useState([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let active = true;
    setInvitations([]);
    setError(false);
    if (!user?.uid || !user.emailVerified) { setChecking(false); return undefined; }
    setChecking(true);
    httpsCallable(functions, 'listMyCustomerAccountInvites')({}).then(result => {
      if (active) setInvitations(result.data?.invitations || []);
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [user?.uid, user?.emailVerified, attempt]);
  const check = () => { if (!checking) setAttempt(value => value + 1); };
  return <>
    {renderActions?.({ check, checking })}
    {renderActions && checking && <p role="status" className="mt-4 text-sm text-slate-600">Checking your verified email for company connections…</p>}
    {!checking && error && <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p role="alert" className="text-sm text-amber-900">We could not check for company invitations.</p><button onClick={check} className="mt-2 min-h-[44px] font-semibold text-blue-700">Check invitations again</button></section>}
    {renderActions && attempt > 0 && !checking && !error && !invitations.length && <p role="status" className="mt-4 text-sm text-slate-600">No company connections found for {user?.email}. Ask your pool company to confirm the email on your customer profile.</p>}
    {!checking && invitations.length > 0 && <section className={`${renderActions ? 'mt-5 text-left ' : ''}space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-5`} aria-label="Company invitations">
    <h2 className="text-xl font-bold">Connect your company customer profile</h2>
    <p className="text-sm text-slate-700">These companies have your verified email on a customer profile. Review the matching profile to connect your pool, service history, and billing.</p>
    {invitations.map(invite => <div key={invite.inviteId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-white p-4"><div><p className="font-semibold">{invite.companyName}</p><p className="text-sm text-slate-600">{invite.customerName}</p></div><Link to={`/client/customer-account-invite/${encodeURIComponent(invite.inviteId)}`} className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-blue-600 px-4 font-semibold text-white">Review &amp; connect</Link></div>)}
  </section>}
  </>;
}
