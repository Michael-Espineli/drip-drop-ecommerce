import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  APP_ERROR_SEVERITY_OPTIONS,
  APP_ERROR_STATUS_OPTIONS,
  getAppErrorReports,
  updateAppErrorStatus,
} from '../../../utils/errorReporting';

const ADMIN_YELLOW = '#efb12f';

const statusClassMap = {
  New: 'bg-[#efb12f]/15 text-[#efb12f] ring-[#efb12f]/30',
  Investigating: 'bg-blue-500/15 text-blue-200 ring-blue-500/30',
  Resolved: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
  Ignored: 'bg-slate-700 text-slate-200 ring-slate-600',
};

const severityClassMap = {
  info: 'bg-slate-700 text-slate-200 ring-slate-600',
  warning: 'bg-[#efb12f]/15 text-[#efb12f] ring-[#efb12f]/30',
  error: 'bg-red-500/15 text-red-200 ring-red-500/30',
  critical: 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-500/30',
};

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return '-';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const labelize = (value) => {
  if (!value) return '-';
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
};

const StatusPill = ({ value }) => (
  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ring-1 ${statusClassMap[value] || statusClassMap.New}`}>
    {value || 'New'}
  </span>
);

const SeverityPill = ({ value }) => (
  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ring-1 ${severityClassMap[value] || severityClassMap.error}`}>
    {labelize(value || 'error')}
  </span>
);

function AppErrors() {
  const [errors, setErrors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');

  const loadErrors = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextErrors = await getAppErrorReports();
      setErrors(nextErrors);
    } catch (error) {
      console.error('Error loading app errors:', error);
      toast.error('Could not load app errors.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadErrors();
  }, [loadErrors]);

  const filteredErrors = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return errors.filter((error) => {
      const matchesSearch = !search || [
        error.title,
        error.description,
        error.message,
        error.where,
        error.location,
        error.userEmail,
        error.companyName,
        error.data,
      ].filter(Boolean).join(' ').toLowerCase().includes(search);
      const matchesStatus = selectedStatus === 'all' || (error.status || 'New') === selectedStatus;
      const matchesSeverity = selectedSeverity === 'all' || (error.severity || 'error') === selectedSeverity;

      return matchesSearch && matchesStatus && matchesSeverity;
    });
  }, [errors, searchTerm, selectedSeverity, selectedStatus]);

  const stats = useMemo(() => ({
    total: errors.length,
    newCount: errors.filter((error) => (error.status || 'New') === 'New').length,
    critical: errors.filter((error) => error.severity === 'critical').length,
    resolved: errors.filter((error) => error.status === 'Resolved').length,
  }), [errors]);

  const handleStatusChange = async (errorId, nextStatus) => {
    const previousErrors = errors;
    setErrors((current) => current.map((error) => (
      error.id === errorId ? { ...error, status: nextStatus } : error
    )));

    try {
      await updateAppErrorStatus(errorId, nextStatus);
      toast.success('Error status updated.');
    } catch (error) {
      console.error('Error updating app error status:', error);
      setErrors(previousErrors);
      toast.error('Could not update error status.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 px-2 md:px-7 py-5 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Errors
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Runtime app errors with user, company, page location, source, message, stack, and related data.
          </p>
        </div>

        <button
          type="button"
          onClick={loadErrors}
          className="px-4 py-2 rounded-md font-semibold bg-[#efb12f] text-slate-950 hover:bg-[#efb12f]/90 transition"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, hint: 'All captured errors' },
          { label: 'New', value: stats.newCount, hint: 'Awaiting review' },
          { label: 'Critical', value: stats.critical, hint: 'Highest severity', accent: '#f0abfc' },
          { label: 'Resolved', value: stats.resolved, hint: 'Marked complete', accent: '#86efac' },
        ].map((stat) => (
          <div key={stat.label} className="bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl p-4">
            <p className="text-sm font-semibold text-slate-400">{stat.label}</p>
            <p className="mt-2 text-3xl font-extrabold" style={{ color: stat.accent || ADMIN_YELLOW }}>{stat.value}</p>
            <p className="mt-1 text-xs text-slate-500">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl">
        <div className="p-4 border-b border-slate-800/60 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search errors"
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30"
            />
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30"
            >
              <option value="all">All Statuses</option>
              {APP_ERROR_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={selectedSeverity}
              onChange={(event) => setSelectedSeverity(event.target.value)}
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30"
            >
              <option value="all">All Severities</option>
              {APP_ERROR_SEVERITY_OPTIONS.map((severity) => (
                <option key={severity} value={severity}>{labelize(severity)}</option>
              ))}
            </select>
          </div>

          <p className="text-sm text-slate-400">{filteredErrors.length} records</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Error</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Context</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Location</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {filteredErrors.map((error) => (
                <tr key={error.id} className="align-top hover:bg-slate-900/50">
                  <td className="px-4 py-4 whitespace-nowrap text-slate-300">{formatDate(error.createdAt)}</td>
                  <td className="px-4 py-4 min-w-[360px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityPill value={error.severity || 'error'} />
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {error.source || 'client'}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold text-slate-100">{error.title || error.message || '-'}</p>
                    <p className="mt-1 max-w-2xl text-sm text-slate-400 whitespace-pre-wrap">
                      {error.description || error.message || '-'}
                    </p>
                    {error.message && error.description !== error.message && (
                      <p className="mt-2 max-w-2xl text-xs text-red-200/80 whitespace-pre-wrap">{error.message}</p>
                    )}
                    {(error.data || error.stack) && (
                      <details className="mt-3 rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-bold text-slate-300">Metadata and stack</summary>
                        {error.data && (
                          <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{error.data}</pre>
                        )}
                        {error.stack && (
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-500">{error.stack}</pre>
                        )}
                      </details>
                    )}
                  </td>
                  <td className="px-4 py-4 min-w-[240px]">
                    <p className="font-medium text-slate-200">{error.userEmail || error.userId || 'Unknown user'}</p>
                    <p className="mt-1 text-xs text-slate-500">{error.accountType || 'Unknown account'}</p>
                    <p className="mt-3 font-medium text-slate-200">{error.companyName || error.companyId || 'No company'}</p>
                  </td>
                  <td className="px-4 py-4 min-w-[280px]">
                    <p className="font-medium text-slate-200 whitespace-pre-wrap">{error.where || '-'}</p>
                    <p className="mt-2 text-xs text-slate-500 break-all">{error.pathname || '-'}</p>
                    <p className="mt-2 text-xs text-slate-500 break-all">{error.location || '-'}</p>
                  </td>
                  <td className="px-4 py-4 min-w-[170px]">
                    <StatusPill value={error.status || 'New'} />
                    <select
                      value={error.status || 'New'}
                      onChange={(event) => handleStatusChange(error.id, event.target.value)}
                      className="mt-3 w-full px-2 py-1 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30"
                    >
                      {APP_ERROR_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && filteredErrors.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-lg font-bold text-slate-100">No errors found.</p>
            <p className="mt-1 text-sm text-slate-500">Captured browser and React runtime errors will appear here.</p>
          </div>
        )}

        {isLoading && (
          <div className="px-4 py-14 text-center text-slate-400">Loading errors...</div>
        )}
      </div>
    </div>
  );
}

export default AppErrors;
