import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { db } from '../../../utils/config';
import {
  CLIENT_CONVERSATION_LINK_OPTIONS,
  COMPANY_CONVERSATION_LINK_OPTIONS,
  fetchConversationLinkPickerItems,
  getConversationLinkLabel,
} from '../../../utils/chatMessaging';

const getItemKey = (item = {}) => `${item.collectionPath || item.type || 'record'}:${item.id}`;

const LinkedItemComposer = ({
  audience = 'company',
  disabled = false,
  chat = null,
  currentUser = null,
  companyId = '',
  onSend,
}) => {
  const options = useMemo(() => (
    audience === 'client' ? CLIENT_CONVERSATION_LINK_OPTIONS : COMPANY_CONVERSATION_LINK_OPTIONS
  ), [audience]);
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState(options[0]?.value || '');
  const [items, setItems] = useState([]);
  const [selectedItemKey, setSelectedItemKey] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const selectedItem = useMemo(() => (
    items.find((item) => getItemKey(item) === selectedItemKey) || null
  ), [items, selectedItemKey]);

  const filteredItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return items;

    return items.filter((item) => item.searchText?.includes(search));
  }, [items, searchTerm]);

  const loadItems = async () => {
    if (!isOpen || !type || disabled) return;

    setLoading(true);
    setError('');
    setSelectedItemKey('');

    try {
      const nextItems = await fetchConversationLinkPickerItems({
        db,
        type,
        audience,
        chat,
        user: currentUser,
        companyId,
      });

      setItems(nextItems);
      setSelectedItemKey(nextItems[0] ? getItemKey(nextItems[0]) : '');
    } catch (loadError) {
      console.error('Unable to load linked item picker:', loadError);
      setError('Unable to load records.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, type, audience, companyId, disabled, chat?.id, currentUser?.uid]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedItem || !onSend) return;

    setSending(true);
    try {
      await onSend(selectedItem);
      setIsOpen(false);
      setSearchTerm('');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LinkIcon className="h-5 w-5" />
        Link item
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={handleSubmit} className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <LinkIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-slate-900">Link item</p>
              <p className="text-sm text-slate-500">{getConversationLinkLabel(type)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close linked item picker"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[220px_1fr_auto]">
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setSearchTerm('');
            }}
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <label className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search records"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              type="search"
            />
          </label>

          <button
            type="button"
            onClick={loadItems}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>
          ) : loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="animate-pulse rounded-lg border border-slate-200 p-4">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="mt-3 h-3 w-1/2 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="font-semibold text-slate-800">No records found.</p>
              <p className="mt-1 text-sm text-slate-500">
                {audience === 'company'
                  ? 'Records are filtered to the customer in this conversation.'
                  : 'Only records available to your account are shown.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => {
                const itemKey = getItemKey(item);
                const selected = itemKey === selectedItemKey;

                return (
                  <button
                    type="button"
                    key={itemKey}
                    onClick={() => setSelectedItemKey(itemKey)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      selected
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                        : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{item.title}</p>
                        {item.subtitle ? (
                          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.subtitle}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {getConversationLinkLabel(item.type)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="min-w-0 truncate text-sm text-slate-500">
            {selectedItem ? selectedItem.title : `${filteredItems.length} record${filteredItems.length === 1 ? '' : 's'} available`}
          </p>
          <button
            type="submit"
            disabled={disabled || sending || loading || !selectedItem}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <PaperAirplaneIcon className="h-5 w-5" />
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

export default LinkedItemComposer;
