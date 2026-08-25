import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';

const ADMIN_YELLOW = '#efb12f';

const initialSummary = {
  totalUsers: 0,
  adminUsers: 0,
  companyUsers: 0,
  homeowners: 0,
  unknownUsers: 0,
};

const numberFormatter = new Intl.NumberFormat('en-US');

const formatCount = (value) => numberFormatter.format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getSearchValue = (user) => [
  user.name,
  user.firstName,
  user.lastName,
  user.email,
  user.phoneNumber,
  user.accountType,
  user.rawAccountType,
  user.recentlySelectedCompany,
  user.id,
  user.profileId,
].filter(Boolean).join(' ').toLowerCase();

const accountTypeLabel = (accountType) => {
  switch (accountType) {
    case 'Client':
      return 'Homeowner';
    case 'Company':
      return 'Company';
    case 'Admin':
      return 'Admin';
    default:
      return 'Unknown';
  }
};

const accountTypeBadgeTone = (accountType) => {
  switch (accountType) {
    case 'Client':
      return 'green';
    case 'Company':
      return 'blue';
    case 'Admin':
      return 'yellow';
    default:
      return 'slate';
  }
};

const StatusBadge = ({ tone = 'slate', children }) => {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
    blue: 'bg-blue-500/15 text-blue-200 ring-blue-500/30',
    yellow: 'bg-[#efb12f]/15 text-[#efb12f] ring-[#efb12f]/30',
    slate: 'bg-slate-800 text-slate-200 ring-slate-700',
  };

  return (
    <span className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ring-1 ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
};

const StatFilterCard = ({ active, label, value, hint, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      'rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#efb12f]/40',
      active
        ? 'border-[#efb12f]/60 bg-[#efb12f]/10 shadow-lg shadow-[#efb12f]/5'
        : 'border-slate-800/60 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80',
    ].join(' ')}
  >
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-extrabold text-slate-100">{formatCount(value)}</div>
    <div className="mt-1 text-xs text-slate-500">{hint}</div>
  </button>
);

function AdminUserList({ mode = 'users' }) {
  const defaultAccountTypeFilter = mode === 'homeowners' ? 'Client' : 'all';
  const pageTitle = mode === 'homeowners' ? 'Homeowners' : 'Users';
  const pageDescription = mode === 'homeowners'
    ? 'Homeowner accounts from the users collection.'
    : 'Platform users from the users collection.';

  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState(initialSummary);
  const [searchTerm, setSearchTerm] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState(defaultAccountTypeFilter);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setAccountTypeFilter(defaultAccountTypeFilter);
    setSearchTerm('');
  }, [defaultAccountTypeFilter]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const getAdminUserListStats = httpsCallable(functions, 'getAdminUserListStats');
        const authPayload = await getCallableAuthPayload();
        const result = await getAdminUserListStats(authPayload);
        const response = result.data || {};

        if (response.status && response.status !== 200) {
          throw new Error(response.error || 'Could not load users.');
        }

        if (cancelled) return;

        setUsers(response.users || []);
        setSummary(response.summary || initialSummary);
      } catch (error) {
        console.error('Failed to load admin user list:', error);
        if (!cancelled) {
          setErrorMessage(error.message || 'Could not load users.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const statCards = useMemo(() => ([
    {
      filter: 'all',
      label: 'All Users',
      value: summary.totalUsers,
      hint: `${formatCount(summary.homeowners)} homeowners`,
    },
    {
      filter: 'Client',
      label: 'Homeowners',
      value: summary.homeowners,
      hint: 'Client account type',
    },
    {
      filter: 'Company',
      label: 'Company Users',
      value: summary.companyUsers,
      hint: 'Company account type',
    },
    {
      filter: 'Admin',
      label: 'Admins',
      value: summary.adminUsers,
      hint: 'Platform admins',
    },
    {
      filter: 'Unknown',
      label: 'Unknown',
      value: summary.unknownUsers,
      hint: 'Missing account type',
    },
  ]), [summary]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch = !normalizedSearch || getSearchValue(user).includes(normalizedSearch);
      const matchesAccountType = accountTypeFilter === 'all' || user.accountType === accountTypeFilter;

      return matchesSearch && matchesAccountType;
    });
  }, [accountTypeFilter, searchTerm, users]);

  const activeFilterLabel = statCards.find((card) => card.filter === accountTypeFilter)?.label || 'Custom';

  return (
    <div className="min-h-screen bg-slate-900 px-2 py-5 md:px-7">
      <div className="w-full rounded-xl border border-slate-800/60 bg-slate-950 p-4 text-slate-100 shadow-2xl">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
                {pageTitle}
              </h1>
              <p className="text-sm text-slate-400">{pageDescription}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                to="/admin/users"
                className={`rounded-md px-3 py-2 text-sm font-semibold ring-1 transition ${mode === 'users' ? 'bg-[#efb12f] text-slate-950 ring-[#efb12f]' : 'bg-[#efb12f]/10 text-[#efb12f] ring-[#efb12f]/30 hover:bg-[#efb12f]/15'}`}
              >
                Users
              </Link>
              <Link
                to="/admin/homeowners"
                className={`rounded-md px-3 py-2 text-sm font-semibold ring-1 transition ${mode === 'homeowners' ? 'bg-[#efb12f] text-slate-950 ring-[#efb12f]' : 'bg-[#efb12f]/10 text-[#efb12f] ring-[#efb12f]/30 hover:bg-[#efb12f]/15'}`}
              >
                Homeowners
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {statCards.map((stat) => (
              <StatFilterCard
                key={stat.filter}
                active={accountTypeFilter === stat.filter}
                label={stat.label}
                value={stat.value}
                hint={stat.hint}
                onClick={() => setAccountTypeFilter(stat.filter)}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search name, email, phone, company, or ID"
              className="rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#efb12f]/50 focus:outline-none md:col-span-2"
            />

            <select
              value={accountTypeFilter}
              onChange={(event) => setAccountTypeFilter(event.target.value)}
              className="rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-[#efb12f]/50 focus:outline-none"
            >
              {statCards.map((stat) => (
                <option key={stat.filter} value={stat.filter}>
                  {stat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Showing {formatCount(filteredUsers.length)} of {formatCount(users.length)} users. Filter: {activeFilterLabel}.
          </div>
        </div>

        <div className="relative mt-4 overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="px-4 py-3 text-left font-bold">Name</th>
                <th className="px-4 py-3 text-left font-bold">Type</th>
                <th className="px-4 py-3 text-left font-bold">Email</th>
                <th className="px-4 py-3 text-left font-bold">Phone</th>
                <th className="px-4 py-3 text-left font-bold">Selected Company</th>
                <th className="px-4 py-3 text-left font-bold">Stripe</th>
                <th className="px-4 py-3 text-left font-bold">Created</th>
                <th className="px-4 py-3 text-left font-bold">User ID</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {isLoading && (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={8}>
                    Loading users...
                  </td>
                </tr>
              )}

              {!isLoading && errorMessage && (
                <tr>
                  <td className="px-4 py-6 text-red-200" colSpan={8}>
                    {errorMessage}
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && filteredUsers.map((user) => (
                <tr key={user.id} className="transition hover:bg-slate-900/60">
                  <td className="px-4 py-3">
                    <span className="block min-w-[160px] font-semibold text-slate-100">
                      {user.name || 'Unnamed User'}
                    </span>
                    {(user.firstName || user.lastName) && (
                      <span className="mt-1 block text-xs text-slate-500">
                        {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge tone={accountTypeBadgeTone(user.accountType)}>
                      {accountTypeLabel(user.accountType)}
                    </StatusBadge>
                    {user.rawAccountType && user.rawAccountType !== user.accountType && (
                      <div className="mt-1 text-xs text-slate-500">{user.rawAccountType}</div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    <span className="block min-w-[180px]">{user.email || '—'}</span>
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    <span className="block min-w-[120px]">{user.phoneNumber || '—'}</span>
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    {user.recentlySelectedCompany ? (
                      <Link
                        to={`/admin/company/detail/${user.recentlySelectedCompany}`}
                        className="block min-w-[180px] font-mono text-xs text-[#efb12f] hover:opacity-90"
                      >
                        {user.recentlySelectedCompany}
                      </Link>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {user.hasStripeCustomer ? (
                      <StatusBadge tone="green">Connected</StatusBadge>
                    ) : (
                      <StatusBadge>None</StatusBadge>
                    )}
                  </td>

                  <td className="px-4 py-3 text-slate-300">
                    <span className="block min-w-[100px]">{formatDate(user.dateCreated)}</span>
                  </td>

                  <td className="px-4 py-3 text-slate-400">
                    <span className="block min-w-[210px] font-mono text-xs">{user.id}</span>
                  </td>
                </tr>
              ))}

              {!isLoading && !errorMessage && filteredUsers.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={8}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AdminUserList;
