import React, {useEffect, useState} from 'react';
import {collection, getDocs} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {db, functions} from '../../../utils/config';
import {getCallableAuthPayload} from '../../../utils/callableAuth';
const name = customer => customer.displayAsCompany ? customer.company || customer.companyName || customer.email : [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.customerName || customer.email;
export default function LeadCustomerLink({lead, companyId, onLinked}) {
  const [open, setOpen] = useState(false), [customers, setCustomers] = useState([]), [locations, setLocations] = useState([]);
  const [customerId, setCustomerId] = useState(''), [locationId, setLocationId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setCustomerId(''); setLocationId(''); setCustomers([]); setLocations([]); setError('');
    if (!open || !companyId) return undefined;
    setBusy(true);
    Promise.all([getDocs(collection(db, 'companies', companyId, 'customers')), getDocs(collection(db, 'companies', companyId, 'serviceLocations'))]).then(([a, b]) => {
      if (!alive) return;
      setCustomers(a.docs.map(item => ({...item.data(), id: item.id})).filter(customer => customer.active !== false && customer.isActive !== false).sort((a, b) => String(name(a)).localeCompare(String(name(b)))));
      setLocations(b.docs.map(item => ({...item.data(), id: item.id}))); setBusy(false);
    }).catch(e => { if (alive) { setError(e.message || 'Could not load existing customers.'); setBusy(false); } });
    return () => { alive = false; };
  }, [companyId, open]);
  async function link() {
    if (!customerId || busy) return;
    setBusy(true); setError('');
    try {
      const result = await httpsCallable(functions, 'linkLeadToExistingCustomer')({...await getCallableAuthPayload(), companyId, leadId: lead.id, customerId, serviceLocationId: locationId});
      onLinked({...result.data, status: 'In Progress', leadStatus: 'In Progress'});
    } catch (e) { setError(e.message || 'Could not link this customer.'); setBusy(false); }
  }
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="text-lg font-semibold text-slate-900">Existing Customer</h3>
    <p className="mt-2 text-sm text-slate-600">Link this lead to a customer already in your company to keep their pool records and billing history together.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-[44px] rounded-md border border-slate-300 px-3 py-2 font-semibold">Link Existing Customer</button> : <div className="mt-3 space-y-3">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <label className="block text-sm font-semibold">Customer<select aria-label="Existing company customer" value={customerId} disabled={busy} onChange={e => { setCustomerId(e.target.value); setLocationId(''); }} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="">Select a customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{name(customer)}{customer.email ? ` · ${customer.email}` : ''}</option>)}</select></label>
      <label className="block text-sm font-semibold">Service location<select aria-label="Existing customer service location" value={locationId} disabled={busy || !customerId} onChange={e => setLocationId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="">Choose later</option>{locations.filter(location => location.customerId === customerId).map(location => <option key={location.id} value={location.id}>{location.nickName || location.address?.streetAddress || 'Service location'}</option>)}</select></label>
      <button type="button" onClick={link} disabled={!customerId || busy} className="min-h-[44px] rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Loading…' : 'Link Customer to Lead'}</button>
    </div>}
  </section>;
}
