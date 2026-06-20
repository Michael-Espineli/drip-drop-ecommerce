import React, { useState, useEffect, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../utils/config';
import { Link } from 'react-router-dom';
import { getCallableAuthPayload } from '../../../utils/callableAuth';

const initialSummary = {
  totalCompanies: 0,
  hiddenCompanies: 0,
  visibleCompanies: 0,
  verifiedCompanies: 0,
  unverifiedCompanies: 0,
  needsVerification: 0,
  totalCompanyUsers: 0,
  totalActiveCustomers: 0,
  totalCustomers: 0,
};

const numberFormatter = new Intl.NumberFormat('en-US');

const formatCount = (value) => numberFormatter.format(Number(value || 0));

const getSearchValue = (company) => [
  company.name,
  company.ownerName,
  company.email,
  company.phoneNumber,
  company.status,
].filter(Boolean).join(' ').toLowerCase();

const StatusBadge = ({ tone = 'slate', children }) => {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
    yellow: 'bg-[#efb12f]/15 text-[#efb12f] ring-[#efb12f]/30',
    red: 'bg-red-500/15 text-red-200 ring-red-500/30',
    slate: 'bg-slate-800 text-slate-200 ring-slate-700',
  };

  return (
    <span className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ring-1 ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
};

function CompanyList() {
  const ADMIN_YELLOW = '#efb12f';

  const [companyList, setCompanyList] = useState([]);
  const [summary, setSummary] = useState(initialSummary);
  const [searchTerm, setSearchTerm] = useState('');
  const [hiddenFilter, setHiddenFilter] = useState('all');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const getAdminCompanyListStats = httpsCallable(functions, 'getAdminCompanyListStats');
        const authPayload = await getCallableAuthPayload();
        const result = await getAdminCompanyListStats(authPayload);
        const response = result.data || {};

        if (response.status && response.status !== 200) {
          throw new Error(response.error || 'Could not load company stats.');
        }

        setCompanyList(response.companies || []);
        setSummary(response.summary || initialSummary);
      } catch (error) {
        console.error('Failed to load admin company list:', error);
        setErrorMessage(error.message || 'Could not load company list.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filteredCompanies = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return companyList.filter((company) => {
      const matchesSearch = !normalizedSearch || getSearchValue(company).includes(normalizedSearch);
      const matchesHidden =
        hiddenFilter === 'all'
        || (hiddenFilter === 'hidden' && company.hideFromBrowse)
        || (hiddenFilter === 'visible' && !company.hideFromBrowse);
      const matchesVerification =
        verificationFilter === 'all'
        || (verificationFilter === 'verified' && company.verified)
        || (verificationFilter === 'unverified' && !company.verified)
        || (verificationFilter === 'needsVerification' && company.needToVerify);

      return matchesSearch && matchesHidden && matchesVerification;
    });
  }, [companyList, hiddenFilter, searchTerm, verificationFilter]);

  const statCards = [
    { label: 'Companies', value: summary.totalCompanies, hint: `${formatCount(summary.visibleCompanies)} visible` },
    { label: 'Hidden', value: summary.hiddenCompanies, hint: 'Not shown in Browse Companies' },
    { label: 'Verified', value: summary.verifiedCompanies, hint: `${formatCount(summary.needsVerification)} need review` },
    { label: 'Company Users', value: summary.totalCompanyUsers, hint: 'Across all companies' },
    { label: 'Active Customers', value: summary.totalActiveCustomers, hint: `${formatCount(summary.totalCustomers)} total customers` },
  ];

  return (
    <div className="px-2 md:px-7 py-5 bg-slate-900 min-h-screen">
      <div className="w-full bg-slate-950 p-4 rounded-xl text-slate-100 border border-slate-800/60 shadow-2xl">
        <div className="flex flex-col gap-4 mb-4">
          <div>
            <h1 className="font-extrabold text-xl tracking-tight" style={{ color: ADMIN_YELLOW }}>
              Company List
            </h1>
            <p className="text-sm text-slate-400">
              Operational company view with browse visibility, verification, users, and customer counts.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {statCards.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{stat.label}</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-100">{formatCount(stat.value)}</div>
                <div className="mt-1 text-xs text-slate-500">{stat.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search name, owner, email, phone, status"
              className="rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#efb12f]/50 focus:outline-none md:col-span-2"
            />

            <select
              value={hiddenFilter}
              onChange={(e) => setHiddenFilter(e.target.value)}
              className="rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-[#efb12f]/50 focus:outline-none"
            >
              <option value="all">All Browse Visibility</option>
              <option value="visible">Visible In Browse</option>
              <option value="hidden">Hidden From Browse</option>
            </select>

            <select
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value)}
              className="rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-[#efb12f]/50 focus:outline-none"
            >
              <option value="all">All Verification</option>
              <option value="verified">Verified</option>
              <option value="unverified">Unverified</option>
              <option value="needsVerification">Needs Verification</option>
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Showing {formatCount(filteredCompanies.length)} of {formatCount(companyList.length)} companies.
          </div>
        </div>

        <div className="relative overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="py-3 px-4 text-left font-bold">Name</th>
                <th className="py-3 px-4 text-left font-bold">Owner</th>
                <th className="py-3 px-4 text-left font-bold">Hidden</th>
                <th className="py-3 px-4 text-left font-bold">Verified</th>
                <th className="py-3 px-4 text-right font-bold">Users</th>
                <th className="py-3 px-4 text-right font-bold">Active Customers</th>
                <th className="py-3 px-4 text-right font-bold">Total Customers</th>
                <th className="py-3 px-4 text-left font-bold">Email</th>
                <th className="py-3 px-4 text-left font-bold">Phone</th>
                <th className="py-3 px-4 text-left font-bold">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {isLoading && (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={10}>
                    Loading company stats...
                  </td>
                </tr>
              )}

              {!isLoading && errorMessage && (
                <tr>
                  <td className="px-4 py-6 text-red-200" colSpan={10}>
                    {errorMessage}
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && filteredCompanies?.map((company) => (
                <tr key={company.id} className="hover:bg-slate-900/60 transition">
                  <td className="px-4 py-3">
                    <Link
                      className="block min-w-[180px] text-slate-100 hover:opacity-90"
                      style={{ color: ADMIN_YELLOW }}
                      to={`/admin/company/detail/${company.id}`}
                    >
                      {company.name || 'Unnamed Company'}
                    </Link>
                    <div className="mt-1 font-mono text-xs text-slate-500">{company.id}</div>
                  </td>

                  <td className="px-4 py-3 text-slate-200">
                    <Link
                      className="block min-w-[140px] hover:text-slate-100"
                      to={`/admin/company/detail/${company.id}`}
                    >
                      {company.ownerName || 'No owner name'}
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    {company.hideFromBrowse ? (
                      <StatusBadge tone="red">Hidden</StatusBadge>
                    ) : (
                      <StatusBadge tone="green">Visible</StatusBadge>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {company.needToVerify ? (
                      <StatusBadge tone="yellow">Needs Review</StatusBadge>
                    ) : company.verified ? (
                      <StatusBadge tone="green">Verified</StatusBadge>
                    ) : (
                      <StatusBadge tone="red">Unverified</StatusBadge>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-mono text-slate-100">
                    {formatCount(company.companyUserCount)}
                  </td>

                  <td className="px-4 py-3 text-right font-mono text-slate-100">
                    {formatCount(company.activeCustomerCount)}
                  </td>

                  <td className="px-4 py-3 text-right font-mono text-slate-300">
                    {formatCount(company.totalCustomerCount)}
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    <span className="block min-w-[180px]">{company.email || '—'}</span>
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    <span className="block min-w-[120px]">{company.phoneNumber || '—'}</span>
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    <span className="block min-w-[90px]">{company.status || '—'}</span>
                  </td>
                </tr>
              ))}

              {!isLoading && !errorMessage && filteredCompanies?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={10}>
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Optional: set a CSS var once on the page if you want to use it elsewhere */}
      <style>{`:root { --admin-yellow: ${ADMIN_YELLOW}; }`}</style>
    </div>
  );
}

export default CompanyList;
