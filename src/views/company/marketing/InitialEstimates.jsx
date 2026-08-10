import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaClipboardCheck,
  FaEllipsisV,
  FaLink,
  FaSearch,
} from 'react-icons/fa';
import toast from 'react-hot-toast';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { salesCollectionNames } from '../../../utils/models/Sales';
import {
  SERVICE_STOP_TYPE_USE_CASES,
  normalizeServiceStopTypeBucket,
} from '../../../utils/serviceStopTypes/serviceStopTypeResolver';
import {
  agreementDisplayTitle,
  connectServiceAgreementToInitialEstimate,
  linkedInitialEstimateServiceStopIds,
} from '../../../utils/sales/initialEstimateAgreementLinks';
import ConnectAgreementModal from './ConnectAgreementModal';

const serviceAgreementSurveyBuckets = new Set([
  SERVICE_STOP_TYPE_USE_CASES.serviceAgreementEstimate,
  'serviceagreementestimate',
  'serviceestimate',
  'newserviceestimate',
  'recurringserviceestimate',
  'startup',
  'startupservice',
  'startups',
  'newpool',
  'systemserviceagreementestimateservicestop',
].map(normalizeServiceStopTypeBucket));

const finishedStatuses = new Set(['finished', 'complete', 'completed', 'done']);

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return 'Not scheduled';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(millis));
};

const formatTime = (value) => {
  const millis = toMillis(value);
  if (!millis) return '';

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(millis));
};

const isServiceStopFinished = (stop = {}) => (
  finishedStatuses.has(normalizeStatus(stop.operationStatus || stop.status || stop.routeStatus))
);

const isInitialSurveyStop = (stop = {}) => {
  const bucketValues = [
    stop.serviceStopTypeUseCaseRawValue,
    stop.serviceStopUseCaseSourceId,
    stop.serviceStopTypeUseCase,
    stop.typeUseCase,
    stop.category,
    stop.serviceStopCategory,
    stop.serviceStopTypeCategory,
    stop.typeId,
    stop.serviceStopTypeId,
    stop.type,
    stop.serviceStopTypeName,
    stop.sourceId,
    stop.stopPayCategory,
    stop.stopPayBucketId,
    stop.serviceStopBucketId,
    stop.serviceStopBucket,
  ].map(normalizeServiceStopTypeBucket).filter(Boolean);

  return bucketValues.some((value) => (
    serviceAgreementSurveyBuckets.has(value) ||
    value.includes('serviceagreementestimate') ||
    value.includes('serviceestimate') ||
    value.includes('newpool') ||
    value.includes('startup')
  ));
};

const stopHasLinkedAgreement = (stop = {}, linkedSurveyIds = new Set()) => (
  Boolean(
    stop.serviceAgreementId ||
    stop.serviceAgreementTitle ||
    stop.salesAgreementId ||
    stop.agreementId ||
    (stop.id && linkedSurveyIds.has(stop.id))
  )
);

const getServiceStopDate = (stop = {}) => (
  stop.serviceDate || stop.scheduledDate || stop.date || stop.startTime || stop.createdAt || stop.dateCreated
);

const getStopTitle = (stop = {}) => (
  stop.type || stop.serviceStopType || stop.serviceStopTypeName || 'Initial Survey'
);

const getStatusLabel = (stop = {}) => {
  if (isServiceStopFinished(stop)) return 'Completed';
  return stop.operationStatus || stop.status || 'Outstanding';
};

const getCreateAgreementPath = (stop = {}) => {
  const params = new URLSearchParams();
  params.set('serviceStopId', stop.id);
  if (stop.leadId) params.set('leadId', stop.leadId);
  if (stop.customerId) params.set('customerId', stop.customerId);
  if (stop.serviceLocationId) params.set('serviceLocationId', stop.serviceLocationId);
  return `/company/sales/agreements/new?${params.toString()}`;
};

const getAgreementPath = (agreementId) => `/company/sales/agreements/${agreementId}`;
const getSurveyPath = (stopId) => `/company/serviceStops/detail/${stopId}`;
const getCustomerPath = (customerId) => `/company/customers/details/${customerId}`;

const getSearchText = (stop = {}) => [
  stop.internalId,
  stop.customerName,
  stop.tech,
  stop.description,
  getStopTitle(stop),
  stop.operationStatus,
  stop.status,
].filter(Boolean).join(' ').toLowerCase();

const getAgreementForStop = (stop = {}, agreementsById = new Map(), linkedAgreementByStopId = new Map()) => {
  const agreementId = stop.serviceAgreementId || stop.salesAgreementId || stop.agreementId || '';
  if (agreementId) {
    return agreementsById.get(agreementId) || {
      id: agreementId,
      title: stop.serviceAgreementTitle || 'Service Agreement',
      status: stop.serviceAgreementStatus || '',
    };
  }

  return linkedAgreementByStopId.get(stop.id) || null;
};

const StatCard = ({ icon: Icon, label, value, helper, tone = 'slate' }) => {
  const tones = {
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
          <Icon />
        </span>
      </div>
      {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
  );
};

const StatusBadge = ({ stop }) => {
  const finished = isServiceStopFinished(stop);
  const classes = finished
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {getStatusLabel(stop)}
    </span>
  );
};

const AgreementBadge = ({ agreement, onClick }) => {
  if (!agreement?.id) {
    return (
      <span className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
        Not connected
      </span>
    );
  }

  return (
    <Link
      to={getAgreementPath(agreement.id)}
      onClick={onClick}
      className="mt-2 inline-flex max-w-[190px] items-center gap-1 truncate rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
      title={agreementDisplayTitle(agreement)}
    >
      <FaLink className="shrink-0" />
      <span className="truncate">{agreementDisplayTitle(agreement)}</span>
    </Link>
  );
};

const ActionsMenu = ({
  connectedAgreement,
  isOpen,
  onClose,
  onConnect,
  onToggle,
  stop,
}) => (
  <div className="relative inline-flex justify-end">
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(stop.id);
      }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      title="Initial estimate actions"
    >
      <FaEllipsisV />
    </button>
    {isOpen && (
      <div
        className="absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg"
        role="menu"
        onClick={(event) => event.stopPropagation()}
      >
        <Link
          to={connectedAgreement?.id ? getAgreementPath(connectedAgreement.id) : getCreateAgreementPath(stop)}
          onClick={onClose}
          className="block px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          role="menuitem"
        >
          {connectedAgreement?.id ? 'Open Agreement' : 'Create Agreement'}
        </Link>
        <button
          type="button"
          onClick={() => {
            onClose();
            onConnect(stop);
          }}
          className="block w-full px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          role="menuitem"
        >
          {connectedAgreement?.id ? 'Change Agreement' : 'Connect Agreement'}
        </button>
      </div>
    )}
  </div>
);

const InitialEstimates = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const navigate = useNavigate();
  const [serviceStops, setServiceStops] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewFilter, setViewFilter] = useState('all');
  const [openActionStopId, setOpenActionStopId] = useState('');
  const [agreementModalStop, setAgreementModalStop] = useState(null);
  const [connectingAgreementId, setConnectingAgreementId] = useState('');

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setServiceStops([]);
      setAgreements([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loaded = { stops: false, agreements: false };
    const markLoaded = (key) => {
      loaded[key] = true;
      if (!cancelled && loaded.stops && loaded.agreements) setLoading(false);
    };

    setLoading(true);
    setError('');

    const stopsUnsubscribe = onSnapshot(
      collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
      (snapshot) => {
        if (cancelled) return;
        setServiceStops(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        markLoaded('stops');
      },
      (snapshotError) => {
        console.error('Unable to load initial estimate service stops:', snapshotError);
        if (!cancelled) {
          setError('Unable to load initial estimates.');
          setLoading(false);
        }
      },
    );

    const agreementsUnsubscribe = onSnapshot(
      query(collection(db, salesCollectionNames.agreements), where('companyId', '==', recentlySelectedCompany)),
      (snapshot) => {
        if (cancelled) return;
        setAgreements(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        markLoaded('agreements');
      },
      (snapshotError) => {
        console.error('Unable to load linked service agreements:', snapshotError);
        if (!cancelled) {
          setError('Unable to load linked service agreements.');
          setLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
      stopsUnsubscribe();
      agreementsUnsubscribe();
    };
  }, [recentlySelectedCompany]);

  const linkedSurveyIds = useMemo(() => {
    const ids = new Set();
    agreements.forEach((agreement) => {
      linkedInitialEstimateServiceStopIds(agreement).forEach((id) => ids.add(id));
    });
    return ids;
  }, [agreements]);

  const agreementsById = useMemo(() => (
    new Map(agreements.map((agreement) => [agreement.id, agreement]))
  ), [agreements]);

  const linkedAgreementByStopId = useMemo(() => {
    const linked = new Map();
    agreements.forEach((agreement) => {
      linkedInitialEstimateServiceStopIds(agreement).forEach((id) => {
        if (!linked.has(id)) linked.set(id, agreement);
      });
    });
    return linked;
  }, [agreements]);

  const initialEstimates = useMemo(() => (
    serviceStops
      .filter(isInitialSurveyStop)
      .sort((left, right) => toMillis(getServiceStopDate(right)) - toMillis(getServiceStopDate(left)))
  ), [serviceStops]);

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return initialEstimates.filter((stop) => {
      const connected = stopHasLinkedAgreement(stop, linkedSurveyIds);
      if (viewFilter === 'outstanding' && (connected || isServiceStopFinished(stop))) return false;
      if (viewFilter === 'completed' && (connected || !isServiceStopFinished(stop))) return false;
      if (viewFilter === 'connected' && !connected) return false;
      if (!search) return true;
      return getSearchText(stop).includes(search);
    });
  }, [initialEstimates, linkedSurveyIds, searchTerm, viewFilter]);

  const connectedCount = initialEstimates.filter((stop) => stopHasLinkedAgreement(stop, linkedSurveyIds)).length;
  const awaitingAgreementCount = initialEstimates.length - connectedCount;
  const completedCount = initialEstimates.filter((stop) => !stopHasLinkedAgreement(stop, linkedSurveyIds) && isServiceStopFinished(stop)).length;
  const outstandingCount = initialEstimates.filter((stop) => !stopHasLinkedAgreement(stop, linkedSurveyIds) && !isServiceStopFinished(stop)).length;
  const openSurvey = (stopId) => navigate(getSurveyPath(stopId));
  const stopLinkClick = (event) => event.stopPropagation();

  const handleConnectAgreement = async (agreement) => {
    if (!agreementModalStop?.id) return;

    setConnectingAgreementId(agreement.id);
    try {
      await connectServiceAgreementToInitialEstimate({
        db,
        companyId: recentlySelectedCompany,
        serviceStopId: agreementModalStop.id,
        serviceStop: agreementModalStop,
        agreement,
      });
      toast.success('Service agreement connected.');
      setAgreementModalStop(null);
    } catch (connectionError) {
      console.error('Unable to connect service agreement:', connectionError);
      toast.error('Failed to connect service agreement.');
    } finally {
      setConnectingAgreementId('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link to="/company/leads" className="app-back-link">&larr; Back to Leads</Link>
            <h1 className="mt-3 text-3xl font-bold text-slate-950">Initial Estimates</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Initial surveys and estimate visits, including ones that still need to be connected or converted into a service agreement.
            </p>
          </div>
          <Link
            to="/company/leads"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            View Leads
          </Link>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={FaClipboardCheck} label="Awaiting Agreement" value={awaitingAgreementCount} helper="Unconverted initial surveys" tone={awaitingAgreementCount ? 'amber' : 'emerald'} />
          <StatCard icon={FaCalendarAlt} label="Outstanding" value={outstandingCount} helper="Scheduled or in progress" tone={outstandingCount ? 'amber' : 'emerald'} />
          <StatCard icon={FaCheckCircle} label="Completed" value={completedCount} helper="Ready for agreement follow-up" tone="emerald" />
          <StatCard icon={FaLink} label="Connected" value={connectedCount} helper="Has a service agreement" tone="blue" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative lg:max-w-md lg:flex-1">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search customer, tech, notes, or status"
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1 sm:grid-cols-4">
              {[
                { id: 'all', label: 'All' },
                { id: 'outstanding', label: 'Outstanding' },
                { id: 'completed', label: 'Completed' },
                { id: 'connected', label: 'Connected with Agreement' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setViewFilter(option.id)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${viewFilter === option.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-6 text-sm font-medium text-slate-500">Loading initial estimates...</div>
          ) : error ? (
            <div className="border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{error}</div>
          ) : filteredRows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Initial Survey</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Scheduled</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Tech</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredRows.map((stop) => {
                    const connectedAgreement = getAgreementForStop(stop, agreementsById, linkedAgreementByStopId);

                    return (
                      <tr
                        key={stop.id}
                        className="cursor-pointer align-top hover:bg-slate-50"
                        onClick={() => openSurvey(stop.id)}
                      >
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-950">{getStopTitle(stop)}</p>
                        <p className="mt-1 max-w-xs truncate text-xs text-slate-500">
                          {stop.description || stop.internalId || stop.id}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        {stop.customerId ? (
                          <Link
                            to={getCustomerPath(stop.customerId)}
                            onClick={stopLinkClick}
                            className="font-semibold text-slate-800 hover:text-blue-700"
                          >
                            {stop.customerName || 'Customer'}
                          </Link>
                        ) : (
                          <p className="font-semibold text-slate-800">{stop.customerName || 'Customer'}</p>
                        )}
                        {stop.leadId ? (
                          <Link
                            to={`/company/leads/${stop.leadId}`}
                            onClick={stopLinkClick}
                            className="mt-1 inline-flex text-xs font-semibold text-blue-700 hover:text-blue-900"
                          >
                            Open lead
                          </Link>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">No lead linked</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium text-slate-800">{formatDate(getServiceStopDate(stop))}</p>
                        {formatTime(stop.startTime || stop.serviceDate) && (
                          <p className="mt-1 text-xs text-slate-500">{formatTime(stop.startTime || stop.serviceDate)}</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge stop={stop} />
                        <AgreementBadge agreement={connectedAgreement} onClick={stopLinkClick} />
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {stop.tech || stop.technicianName || 'Unassigned'}
                      </td>
                      <td className="px-4 py-4 text-right" onClick={stopLinkClick}>
                        <ActionsMenu
                          connectedAgreement={connectedAgreement}
                          isOpen={openActionStopId === stop.id}
                          onClose={() => setOpenActionStopId('')}
                          onConnect={(selectedStop) => setAgreementModalStop(selectedStop)}
                          onToggle={(stopId) => setOpenActionStopId((current) => (current === stopId ? '' : stopId))}
                          stop={stop}
                        />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <FaCheckCircle />
              </span>
              <h2 className="mt-3 text-base font-semibold text-slate-950">No initial estimates match this view.</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Adjust the filter or search to see more initial surveys and estimate visits.
              </p>
            </div>
          )}
        </section>

        <ConnectAgreementModal
          agreements={agreements}
          connectedAgreementId={agreementModalStop ? getAgreementForStop(agreementModalStop, agreementsById, linkedAgreementByStopId)?.id || '' : ''}
          connectingAgreementId={connectingAgreementId}
          isOpen={Boolean(agreementModalStop)}
          loading={loading}
          onClose={() => setAgreementModalStop(null)}
          onConnect={handleConnectAgreement}
          serviceStop={agreementModalStop}
        />
      </div>
    </div>
  );
};

export default InitialEstimates;
