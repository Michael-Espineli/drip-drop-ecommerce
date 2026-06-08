import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CONTACT_MESSAGES_COLLECTION,
  getAdminInboxItems,
  updateAdminInboxStatus,
} from '../../../utils/adminInbox';

const ADMIN_YELLOW = '#debf44';
const statusOptions = ['New', 'Read', 'Replied', 'Closed'];

const statusClassMap = {
  New: 'bg-yellow-500/15 text-yellow-200 ring-yellow-500/30',
  Read: 'bg-blue-500/15 text-blue-200 ring-blue-500/30',
  Replied: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
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

function ReachOutMessages() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const loadMessages = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextMessages = await getAdminInboxItems(CONTACT_MESSAGES_COLLECTION);
      setMessages(nextMessages);
    } catch (error) {
      console.error('Error loading reach out messages:', error);
      toast.error('Could not load reach out messages.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const filteredMessages = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return messages.filter((message) => {
      const matchesSearch = !search || [
        message.name,
        message.email,
        message.companyName,
        message.subject,
        message.message,
        message.audience,
      ].filter(Boolean).join(' ').toLowerCase().includes(search);
      const matchesStatus = selectedStatus === 'all' || (message.status || 'New') === selectedStatus;

      return matchesSearch && matchesStatus;
    });
  }, [messages, searchTerm, selectedStatus]);

  const stats = useMemo(() => ({
    total: messages.length,
    newCount: messages.filter((message) => (message.status || 'New') === 'New').length,
    replied: messages.filter((message) => message.status === 'Replied').length,
    closed: messages.filter((message) => message.status === 'Closed').length,
  }), [messages]);

  const handleStatusChange = async (messageId, nextStatus) => {
    const previousMessages = messages;
    setMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, status: nextStatus } : message
    )));

    try {
      await updateAdminInboxStatus(CONTACT_MESSAGES_COLLECTION, messageId, nextStatus);
      toast.success('Status updated.');
    } catch (error) {
      console.error('Error updating reach out message status:', error);
      setMessages(previousMessages);
      toast.error('Could not update status.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 px-2 md:px-7 py-5 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            Reach Out Messages
          </h1>
          <p className="mt-1 text-sm text-slate-400">Review messages from the Get in Touch contact form.</p>
        </div>

        <button
          type="button"
          onClick={loadMessages}
          className="px-4 py-2 rounded-md font-semibold bg-[#debf44] text-slate-950 hover:bg-[#debf44]/90 transition"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, hint: 'All contact messages' },
          { label: 'New', value: stats.newCount, hint: 'Awaiting review' },
          { label: 'Replied', value: stats.replied, hint: 'Admin response sent', accent: '#86efac' },
          { label: 'Closed', value: stats.closed, hint: 'No more action needed', accent: '#cbd5e1' },
        ].map((stat) => (
          <div key={stat.label} className="bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl p-4">
            <p className="text-sm font-semibold text-slate-400">{stat.label}</p>
            <p className="mt-2 text-3xl font-extrabold" style={{ color: stat.accent || ADMIN_YELLOW }}>{stat.value}</p>
            <p className="mt-1 text-xs text-slate-500">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl">
        <div className="p-4 border-b border-slate-800/60 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search messages"
              className="px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            />
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

          <p className="text-sm text-slate-400">{filteredMessages.length} records</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Message</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {filteredMessages.map((message) => (
                <tr key={message.id} className="align-top hover:bg-slate-900/50">
                  <td className="px-4 py-4 whitespace-nowrap text-slate-300">{formatDate(message.createdAt)}</td>
                  <td className="px-4 py-4 min-w-[240px]">
                    <p className="font-semibold text-slate-100">{message.name || '-'}</p>
                    {message.email && (
                      <a href={`mailto:${message.email}`} className="text-sm text-blue-300 hover:text-blue-200">
                        {message.email}
                      </a>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      {message.audience || '-'}{message.companyName ? ` • ${message.companyName}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-4 min-w-[360px]">
                    <p className="font-semibold text-slate-100">{message.subject || 'No subject'}</p>
                    <p className="mt-1 max-w-2xl text-sm text-slate-400 whitespace-pre-wrap">{message.message || '-'}</p>
                  </td>
                  <td className="px-4 py-4 min-w-[160px]">
                    <StatusPill value={message.status || 'New'} />
                    <select
                      value={message.status || 'New'}
                      onChange={(event) => handleStatusChange(message.id, event.target.value)}
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

        {!isLoading && filteredMessages.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-lg font-bold text-slate-100">No reach out messages found.</p>
            <p className="mt-1 text-sm text-slate-500">Messages from the Get in Touch form will appear here.</p>
          </div>
        )}

        {isLoading && (
          <div className="px-4 py-14 text-center text-slate-400">Loading messages...</div>
        )}
      </div>
    </div>
  );
}

export default ReachOutMessages;
