import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaFileContract,
  FaSearch,
  FaTimes,
} from 'react-icons/fa';
import {
  agreementDisplayTitle,
  agreementLinksInitialEstimate,
} from '../../../utils/sales/initialEstimateAgreementLinks';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const formatStatus = (value) => {
  const text = String(value || '').trim();
  if (!text) return 'Draft';
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
};

const agreementSearchText = (agreement = {}) => ([
  agreementDisplayTitle(agreement),
  agreement.customerName,
  agreement.email,
  agreement.status,
  agreement.serviceFrequencyLabel,
  agreement.id,
].filter(Boolean).join(' ').toLowerCase());

const ConnectAgreementModal = ({
  agreements = [],
  connectedAgreementId = '',
  connectingAgreementId = '',
  isOpen,
  loading = false,
  onClose,
  onConnect,
  serviceStop = {},
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const rows = useMemo(() => {
    const search = normalizeText(searchTerm);
    const serviceStopId = serviceStop?.id || '';

    return agreements
      .filter((agreement) => !search || agreementSearchText(agreement).includes(search))
      .sort((left, right) => {
        const leftConnected = agreementLinksInitialEstimate(left, serviceStopId) || left.id === connectedAgreementId;
        const rightConnected = agreementLinksInitialEstimate(right, serviceStopId) || right.id === connectedAgreementId;
        if (leftConnected !== rightConnected) return leftConnected ? -1 : 1;

        const leftCustomerMatch = serviceStop?.customerId && left.customerId === serviceStop.customerId;
        const rightCustomerMatch = serviceStop?.customerId && right.customerId === serviceStop.customerId;
        if (leftCustomerMatch !== rightCustomerMatch) return leftCustomerMatch ? -1 : 1;

        return agreementDisplayTitle(left).localeCompare(agreementDisplayTitle(right));
      });
  }, [agreements, connectedAgreementId, searchTerm, serviceStop]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-3 py-6">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Connect Service Agreement</h2>
            <p className="mt-1 text-sm text-slate-500">
              {serviceStop?.customerName || 'Initial estimate'} can be linked to an existing service agreement.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>

        <div className="border-b border-slate-200 p-4">
          <label className="relative block">
            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search agreements by title, customer, email, or status"
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>

        <div className="overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm font-semibold text-slate-500">Loading service agreements...</div>
          ) : rows.length ? (
            <div className="divide-y divide-slate-100">
              {rows.map((agreement) => {
                const isConnected = agreement.id === connectedAgreementId || agreementLinksInitialEstimate(agreement, serviceStop?.id);
                const isConnecting = connectingAgreementId === agreement.id;

                return (
                  <div key={agreement.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <FaFileContract className="shrink-0 text-blue-600" />
                        <Link
                          to={`/company/sales/agreements/${agreement.id}`}
                          className="truncate font-semibold text-slate-950 hover:text-blue-700"
                        >
                          {agreementDisplayTitle(agreement)}
                        </Link>
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-500">
                        {[agreement.customerName || 'Customer', formatStatus(agreement.status), agreement.serviceFrequencyLabel].filter(Boolean).join(' - ')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onConnect(agreement)}
                      disabled={isConnecting || isConnected}
                      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${isConnected
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                    >
                      {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <h3 className="text-base font-semibold text-slate-950">No matching agreements</h3>
              <p className="mt-1 text-sm text-slate-500">Try a different title, customer, email, or status.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectAgreementModal;
