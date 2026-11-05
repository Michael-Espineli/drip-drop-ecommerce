import WorkspaceHeader from '../../../components/workspace/WorkspaceHeader';
import React, { useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
import useCompanyProfile from '../../../hooks/useCompanyProfile';
import { Context } from '../../../context/AuthContext';
export default function CompanyProfilePage() {
  const {
    companyId
  } = useParams();
  const {
    company,
    loading,
    error
  } = useCompanyProfile(companyId);
  const {
    featureFlagsLoaded,
    isFeatureEnabled
  } = useContext(Context);
  if (loading) return <p role="status" className="p-6">Loading company…</p>;
  if (error || !company || company.deleted || company.publicProfileDisabled) return <div className="p-6"><p role="alert">This company profile is unavailable.</p><Link to="/client/companies" className="text-blue-700">Browse companies</Link></div>;
  return <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6"><Link to="/client/companies" className="inline-flex min-h-[44px] items-center text-blue-700">Back to companies</Link><section className="space-y-4 rounded-xl border bg-white p-5"><WorkspaceHeader title={<>{company.name}</>} eyebrow="Your pool care" /><p className="whitespace-pre-wrap text-slate-600">{company.bio || 'Contact this company to discuss your pool care.'}</p><Link to={`/client/service-requests/new/${companyId}`} className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-4 font-semibold text-white">Request service</Link>{featureFlagsLoaded && isFeatureEnabled('feature_flag_001') && <Link to={`/messages/newCompany/${companyId}`} className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border px-4 font-semibold">Message company</Link>}</section><section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Services</h2><ul className="list-inside list-disc text-slate-600">{(company.services || []).map(service => <li key={service}>{service}</li>)}</ul>{company.phoneNumber && <a className="flex min-h-[44px] items-center text-blue-700" href={`tel:${company.phoneNumber}`}>{company.phoneNumber}</a>}{company.email && <a className="flex min-h-[44px] items-center break-all text-blue-700" href={`mailto:${company.email}`}>{company.email}</a>}</section></div>;
}
