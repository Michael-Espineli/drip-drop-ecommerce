import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getAdminInboxItems,
  PRODUCT_FEEDBACK_COLLECTION,
  updateAdminInboxStatus,
} from '../../../utils/adminInbox';

const ADMIN_YELLOW = '#debf44';
const statusOptions = ['New', 'Open', 'Planned', 'Resolved', 'Closed'];

const statusClassMap = {
  New: 'bg-yellow-500/15 text-yellow-200 ring-yellow-500/30',
  Open: 'bg-blue-500/15 text-blue-200 ring-blue-500/30',
  Planned: 'bg-purple-500/15 text-purple-200 ring-purple-500/30',
  Resolved: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
  Closed: 'bg-slate-700 text-slate-200 ring-slate-600',
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

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const StatusPill = ({ value }) => (
  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ring-1 ${statusClassMap[value] || statusClassMap.New}`}>
    {value || 'New'}
  </span>
);

function ProductFeedback() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const loadItems = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextItems = await getAdminInboxItems(PRODUCT_FEEDBACK_COLLECTION);
      setItems(nextItems);
    } catch (error) {
      console.error('Error loading product feedback:', error);
      toast.error('Could not load product feedback.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return items.filter((item) => {
      const matchesSearch = !search || [
        item.title,
        item.description,
        item.requesterName,
        item.requesterEmail,
        item.companyName,
        item.audience,
      ].filter(Boolean).join(' ').toLowerCase().includes(search);
      const matchesType = selectedType === 'all' || item.type === selectedType;
      const matchesStatus = selectedStatus === 'all' || (item.status || 'New') === selectedStatus;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [items, searchTerm, selectedStatus, selectedType]);

  const stats = useMemo(() => ({
    total: items.length,
    newCount: items.filter((item) => (item.status || 'New') === 'New').length,
    bugs: items.filter((item) => item.type === 'bug').length,
    features: items.filter((item) => item.type === 'feature').length,
  }), [items]);

  const handleStatusChange = async (itemId, nextStatus) => {
    const previousItems = items;
    setItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, status: nextStatus } : item
    )));

    try {
      await updateAdminInboxStatus(PRODUCT_FEEDBACK_COLLECTION, itemId, nextStatus);
      toast.success('Status updated.');
    } catch (error) {
      console.error('Error updating product feedback status:', error);
      setItems(previousItems);
      toast.error('Could not update status.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 px-2 md:px-7 py-5 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Bug Reports & Feature Requests
          </h1>
          <p className="mt-1 text-sm text-slate-400">Review company and client product feedback.</p>
        </div>

        <button
          type="button"
          onClick={loadItems}
          className="px-4 py-2 rounded-md font-semibold bg-[#debf44] text-slate-950 hover:bg-[#debf44]/90 transition"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, hint: 'All submissions' },
          { label: 'New', value: stats.newCount, hint: 'Awaiting review' },
          { label: 'Bugs', value: stats.bugs, hint: 'Reported issues', accent: '#fca5a5' },
          { label: 'Features', value: stats.features, hint: 'Requested improvements', accent: '#93c5fd' },
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
              placeholder="Search feedback"
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            />
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            >
              <option value="all">All Types</option>
              <option value="bug">Bug Reports</option>
              <option value="feature">Feature Requests</option>
            </select>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            >
              <option value="all">All Statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <p className="text-sm text-slate-400">{filteredItems.length} records</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Request</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Requester</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.map((item) => (
                <tr key={item.id} className="align-top hover:bg-slate-900/50">
                  <td className="px-4 py-4 whitespace-nowrap text-slate-300">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-slate-200">{item.typeLabel || item.type || '-'}</td>
                  <td className="px-4 py-4 min-w-[320px]">
                    <p className="font-semibold text-slate-100">{item.title || '-'}</p>
                    <p className="mt-1 max-w-xl text-sm text-slate-400 whitespace-pre-wrap">{item.description || '-'}</p>
                    <p className="mt-2 text-xs text-slate-500">{item.audience || '-'}{item.companyName ? ` • ${item.companyName}` : ''}</p>
                  </td>
                  <td className="px-4 py-4 min-w-[220px]">
                    <p className="font-medium text-slate-200">{item.requesterName || '-'}</p>
                    {item.requesterEmail && (
                      <a href={`mailto:${item.requesterEmail}`} className="text-sm text-blue-300 hover:text-blue-200">
                        {item.requesterEmail}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-slate-300">{item.priority || 'Medium'}</td>
                  <td className="px-4 py-4 min-w-[160px]">
                    <StatusPill value={item.status || 'New'} />
                    <select
                      value={item.status || 'New'}
                      onChange={(event) => handleStatusChange(item.id, event.target.value)}
                      className="mt-3 w-full px-2 py-1 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && filteredItems.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-lg font-bold text-slate-100">No feedback found.</p>
            <p className="mt-1 text-sm text-slate-500">Submissions from the footer feedback form will appear here.</p>
          </div>
        )}

        {isLoading && (
          <div className="px-4 py-14 text-center text-slate-400">Loading feedback...</div>
        )}
      </div>
    </div>
  );
}

export default ProductFeedback;
