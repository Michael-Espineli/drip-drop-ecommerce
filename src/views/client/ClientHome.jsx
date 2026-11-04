import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Context } from '../../context/AuthContext';
import { db } from '../../utils/config';
import { listenClientRecords } from '../../utils/clientRecords';
import { clientVisitSummary, clientServiceDate } from '../../utils/clientServiceHistory';
const money = value => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format((Number(value) || 0) / 100);
const date = value => clientServiceDate(value)?.toLocaleDateString('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric'
}) || 'Date to be confirmed';
export default function ClientHome() {
  const {
    user,
    name,
    featureFlagsLoaded,
    isFeatureEnabled
  } = useContext(Context);
  const [data, setData] = useState({
      relationships: [],
      visits: [],
      invoices: [],
      agreements: [],
      approvals: []
    }),
    [errors, setErrors] = useState([]),
    [loaded, setLoaded] = useState({});
  useEffect(() => {
    setData({ relationships: [], visits: [], invoices: [], agreements: [], approvals: [] });
    setLoaded({});
    setErrors([]);
    if (!user?.uid) return;
    const sources = [['relationships', 'customerCompanyRelationships', 'homeownerUserId'], ['visits', 'homeownerServiceStops', 'userId'], ['invoices', 'salesInvoices', 'customerUserId'], ['agreements', 'salesAgreements', 'customerUserId'], ['approvals', 'customerPartApprovals', 'customerUserId']];
    return (() => {
      const stops = sources.map(([key, path, field]) => (['invoices', 'agreements', 'approvals'].includes(key) ? (change, error) => listenClientRecords({
        db,
        user,
        collectionName: path
      }, change, error) : (change, error) => onSnapshot(query(collection(db, path), where(field, '==', user.uid)), change, error))(snap => {
        setData(value => ({
          ...value,
          [key]: snap.docs.map(d => ({
            ...d.data(),
            id: d.id
          }))
        }));
        setLoaded(value => ({
          ...value,
          [key]: true
        }));
      }, () => {
        setErrors(value => [...new Set([...value, key])]);
        setLoaded(value => ({
          ...value,
          [key]: true
        }));
      }));
      return () => stops.forEach(stop => stop());
    })();
  }, [user]);
  const company = data.relationships.find(r => r.status === 'active'),
    {
      lastService,
      nextService
    } = clientVisitSummary(data.visits);
  const invoices = data.invoices.filter(i => ['open', 'overdue', 'partiallypaid'].includes(String(i.status).replace(/[^a-z]/gi, '').toLowerCase()));
  const balance = invoices.reduce((sum, i) => sum + Math.max(Number(i.amountDueCents ?? Number(i.totalAmountCents || 0) - Number(i.amountPaidCents || 0) - Number(i.writeOffAmountCents || 0)), 0), 0);
  const actions = [...invoices.map(i => ({
    id: i.id,
    title: `Invoice ${i.invoiceNumber || ''}`,
    detail: money(i.amountDueCents ?? i.totalAmountCents),
    to: `/client/billing/invoices/${i.id}`,
    cta: 'View & pay'
  })), ...data.approvals.filter(a => String(a.status || a.approvalStatus).toLowerCase() === 'pending').map(a => ({
    id: a.id,
    title: a.itemName || 'Part approval',
    detail: 'Your approval is needed',
    to: `/client/part-approvals/${a.id}`,
    cta: 'Review'
  })), ...data.agreements.filter(a => ['sent', 'revised'].includes(String(a.status).toLowerCase())).map(a => ({
    id: a.id,
    title: a.title || 'Service agreement',
    detail: 'Ready for review',
    to: `/client/service-agreements/${a.id}`,
    cta: 'Review'
  }))];
  const ready = Object.keys(loaded).length === 5;
  return <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6"><header><p className="text-sm font-semibold text-blue-700">Your pool care</p><h1 className="mt-1 text-2xl font-bold">Hi, {name?.split(' ')[0] || 'there'}</h1><p className="mt-1 text-sm text-slate-500">{company?.companyName || 'Pool care, service updates, and billing in one place.'}</p></header>
        {errors.length > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Some updates could not be loaded. Reopen this page to try again.</p>}
        {!ready && <p role="status" className="text-sm text-slate-500">Loading your latest updates…</p>}
        {!company && loaded.relationships && <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-5"><h2 className="text-xl font-bold">Find your pool company</h2><p className="text-sm text-slate-600">Looking for service? Browse companies and send a request. Already a customer? Open the invitation from your pool company to connect your account.</p><Link className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-blue-600 px-4 font-bold text-white sm:w-auto" to="/client/companies">Find pool service</Link></section>}
        <div className="grid gap-4 sm:grid-cols-2"><section className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">Next service</p><p className="mt-2 text-xl font-bold">{nextService ? date(nextService.serviceDate) : ready ? 'No visit scheduled' : 'Loading…'}</p><p className="mt-1 text-sm text-slate-500">{nextService?.companyName || 'See your property and service details.'}</p><Link className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-blue-700" to="/client/my-pool">View my pool</Link></section><section className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">Amount due</p><p className="mt-2 text-2xl font-bold">{loaded.invoices ? money(balance) : 'Loading…'}</p><Link className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-blue-700" to={invoices.length === 1 ? `/client/billing/invoices/${invoices[0].id}` : '/client/finance'}>{balance > 0 ? 'View & pay' : 'View billing'}</Link></section></div>
        <div className="grid grid-cols-2 gap-3"><Link to="/client/repair-requests/new" className="flex min-h-[52px] items-center justify-center rounded-lg bg-blue-600 px-3 text-center font-semibold text-white">Report a problem</Link>{featureFlagsLoaded && isFeatureEnabled('feature_flag_001') ? <Link to="/client/chat" className="flex min-h-[52px] items-center justify-center rounded-lg border bg-white px-3 text-center font-semibold">Message company</Link> : <Link to="/client/service-requests" className="flex min-h-[52px] items-center justify-center rounded-lg border bg-white px-3 font-semibold">My requests</Link>}</div>
        <section className="overflow-hidden rounded-xl border bg-white"><h2 className="px-4 py-4 text-lg font-bold">Needs your attention</h2>{actions.length ? actions.slice(0, 5).map(action => <Link key={action.id} to={action.to} className="flex min-h-[72px] items-center justify-between gap-3 border-t px-4 py-3"><div className="min-w-0"><p className="break-words font-semibold">{action.title}</p><p className="text-sm text-slate-500">{action.detail}</p></div><span className="shrink-0 text-sm font-bold text-blue-700">{action.cta} ›</span></Link>) : <p className="px-4 pb-5 text-sm text-slate-500">{ready ? 'You are all caught up.' : 'Checking for updates…'}</p>}</section>
        {lastService && <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Last service</h2><p className="mt-2 text-sm text-slate-500">{date(lastService.serviceDate)}{lastService.techName ? ` · ${lastService.techName}` : ''}</p><p className="mt-2 line-clamp-3 text-sm text-slate-700">{lastService.notes || 'Your company completed a visit.'}</p><Link className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-blue-700" to={`/serviceStop/detail/${lastService.id}`}>View service report</Link></section>}
        <Link className="inline-flex min-h-[44px] items-center text-sm font-semibold text-slate-600" to="/feedback">Need help? Contact support</Link>
    </div>;
}
