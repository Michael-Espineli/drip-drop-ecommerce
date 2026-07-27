import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import toast from "react-hot-toast";
import {
  FiArrowUpRight,
  FiBriefcase,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiFilter,
  FiRefreshCw,
  FiSearch,
  FiUser,
} from "react-icons/fi";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  WORK_OFFER_STATUS_FILTERS,
  WORK_OFFER_TYPE_FILTERS,
  buildWorkOfferSearchText,
  getWorkOfferCanSelfSchedule,
  getWorkOfferEstimatedPayCents,
  getWorkOfferTargetText,
  getWorkOfferTaskCount,
  getWorkOfferTypeText,
  isAcceptedReadyToScheduleWorkOffer,
  isAcceptedWorkOffer,
  isOpenWorkOffer,
  isScheduledWorkOffer,
  normalizedWorkOfferStatusKey,
  normalizeWorkOfferStatus,
  workOfferMatchesStatusFilter,
} from "../../../utils/workOffers";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(millis));
};

const formatDateTime = (value) => {
  const millis = toMillis(value);
  if (!millis) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
};

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(value || 0) || 0) / 100);

const formatDurationMinutes = (minutes) => {
  const value = Number(minutes || 0);
  if (!value) return "-";

  const hours = Math.floor(value / 60);
  const mins = value % 60;

  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
};

const statusClasses = (status) => {
  const normalized = normalizedWorkOfferStatusKey(status);

  if (["sent", "posted", "viewed", "pending", "open", "draft", "offered"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (normalized === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["scheduled", "in progress", "inprogress"].includes(normalized)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (normalized === "completed") return "border-slate-200 bg-slate-100 text-slate-700";
  if (["rejected", "cancelled", "canceled", "expired"].includes(normalized)) return "border-rose-200 bg-rose-50 text-rose-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
};

const SummaryTile = ({ icon: Icon, label, value, detail, tone = "slate" }) => {
  const toneClasses = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    slate: "border-slate-200 bg-white text-slate-700",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg border ${toneClasses[tone] || toneClasses.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
};

const OfferedWork = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [schedulingFilter, setSchedulingFilter] = useState("all");

  const loadOffers = async () => {
    if (!recentlySelectedCompany) {
      setOffers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const snap = await getDocs(collection(db, "companies", recentlySelectedCompany, "workOffers"));
      setOffers(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (error) {
      console.error("Failed to load offered work:", error);
      toast.error("Failed to load offered work.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany]);

  const technicianOptions = useMemo(() => {
    const names = [...new Set(offers.map(getWorkOfferTargetText).filter((name) => name && name !== "Internal Board"))]
      .sort((a, b) => a.localeCompare(b));

    return [{ value: "all", label: "All Technicians" }, ...names.map((name) => ({ value: name, label: name }))];
  }, [offers]);

  const summary = useMemo(() => {
    const open = offers.filter(isOpenWorkOffer);
    const accepted = offers.filter(isAcceptedWorkOffer);
    const ready = offers.filter(isAcceptedReadyToScheduleWorkOffer);
    const scheduled = offers.filter(isScheduledWorkOffer);
    const board = offers.filter((offer) => getWorkOfferTypeText(offer).toLowerCase() === "internal board");
    const selfSchedule = offers.filter(getWorkOfferCanSelfSchedule);

    return {
      total: offers.length,
      open: open.length,
      accepted: accepted.length,
      ready: ready.length,
      scheduled: scheduled.length,
      board: board.length,
      selfSchedule: selfSchedule.length,
      estimatedPayCents: offers.reduce((total, offer) => total + getWorkOfferEstimatedPayCents(offer), 0),
    };
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return offers
      .filter((offer) => workOfferMatchesStatusFilter(offer, statusFilter))
      .filter((offer) => {
        if (typeFilter === "all") return true;
        return getWorkOfferTypeText(offer).toLowerCase() === typeFilter;
      })
      .filter((offer) => {
        if (technicianFilter === "all") return true;
        return getWorkOfferTargetText(offer) === technicianFilter;
      })
      .filter((offer) => {
        if (schedulingFilter === "all") return true;
        if (schedulingFilter === "self") return getWorkOfferCanSelfSchedule(offer);
        if (schedulingFilter === "admin") return !getWorkOfferCanSelfSchedule(offer) && !isScheduledWorkOffer(offer);
        if (schedulingFilter === "scheduled") return isScheduledWorkOffer(offer);
        if (schedulingFilter === "unscheduled") return !(offer.serviceStopId || offer.scheduledServiceStopId);
        return true;
      })
      .filter((offer) => !term || buildWorkOfferSearchText(offer).includes(term))
      .sort((left, right) => {
        const readyDifference =
          Number(isAcceptedReadyToScheduleWorkOffer(right)) - Number(isAcceptedReadyToScheduleWorkOffer(left));
        if (readyDifference !== 0) return readyDifference;

        const openDifference = Number(isOpenWorkOffer(right)) - Number(isOpenWorkOffer(left));
        if (openDifference !== 0) return openDifference;

        return toMillis(right.createdAt || right.postedAt || right.sentAt) -
          toMillis(left.createdAt || left.postedAt || left.sentAt);
      });
  }, [offers, searchTerm, schedulingFilter, statusFilter, technicianFilter, typeFilter]);

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <FiBriefcase className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="text-2xl font-bold text-slate-950">Offered Work</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Direct offers, internal board posts, accepted work, and scheduled offer work.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadOffers}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <FiRefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <Link
                to="/company/jobs/operations"
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <FiArrowUpRight className="h-4 w-4" />
                Jobs
              </Link>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryTile icon={FiClock} label="Open Offers" value={summary.open} detail={`${summary.board} board posts included`} tone="amber" />
          <SummaryTile icon={FiCalendar} label="Ready to Schedule" value={summary.ready} detail={`${summary.accepted} accepted total`} tone="green" />
          <SummaryTile icon={FiCheckCircle} label="Scheduled" value={summary.scheduled} detail={`${summary.selfSchedule} can self-schedule`} tone="blue" />
          <SummaryTile icon={FiDollarSign} label="Estimated Pay" value={moneyFromCents(summary.estimatedPayCents)} detail={`${summary.total} total offers`} tone="violet" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(260px,1fr)_repeat(4,minmax(150px,180px))]">
            <label className="relative block">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search offered work..."
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="relative block">
              <FiFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {WORK_OFFER_STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {WORK_OFFER_TYPE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={technicianFilter}
              onChange={(event) => setTechnicianFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {technicianOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={schedulingFilter}
              onChange={(event) => setSchedulingFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All Scheduling</option>
              <option value="self">Tech Can Schedule</option>
              <option value="admin">Admin Schedules</option>
              <option value="scheduled">Scheduled</option>
              <option value="unscheduled">Unscheduled</option>
            </select>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950">Offer List</h2>
              <p className="text-sm text-slate-500">{filteredOffers.length} of {offers.length} offers shown</p>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm font-medium text-slate-500">Loading offered work...</div>
          ) : filteredOffers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">No offered work found.</p>
              <p className="mt-1 text-sm text-slate-500">Adjust the search or filters to see more offers.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Work</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Technician</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Pay</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Job</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredOffers.map((offer) => {
                    const targetText = getWorkOfferTargetText(offer);
                    const typeText = getWorkOfferTypeText(offer);
                    const status = normalizeWorkOfferStatus(offer.status);
                    const jobPath = offer.jobId ? `/company/jobs/detail/${offer.jobId}` : "/company/jobs/operations";

                    return (
                      <tr key={offer.id} className="align-top transition hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div className="max-w-sm">
                            <p className="font-semibold text-slate-950">
                              {offer.title || offer.name || offer.serviceStopTypeName || "Offered Work"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {offer.jobInternalId || offer.jobName || offer.jobId || "No job reference"}
                            </p>
                            {offer.proposedStartDate && (
                              <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                                <FiCalendar className="h-3.5 w-3.5" />
                                {formatDateTime(offer.proposedStartDate)}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClasses(status)}`}>
                            {status}
                          </span>
                          {isAcceptedReadyToScheduleWorkOffer(offer) && (
                            <span className="mt-2 block text-xs font-semibold text-emerald-700">Ready</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-2 text-sm text-slate-700">
                            <FiUser className="mt-0.5 h-4 w-4 text-slate-400" />
                            <div>
                              <p className="font-semibold">{targetText}</p>
                              <p className="text-xs text-slate-500">{typeText}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-semibold text-slate-800">{offer.customerName || "-"}</p>
                          <p className="mt-1 text-xs text-slate-500">{offer.serviceLocationName || offer.address?.streetAddress || "-"}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-semibold text-slate-800">{getWorkOfferTaskCount(offer)} task{getWorkOfferTaskCount(offer) === 1 ? "" : "s"}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDurationMinutes(offer.estimatedMinutes)}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-semibold text-slate-800">{moneyFromCents(getWorkOfferEstimatedPayCents(offer))}</p>
                          <p className="mt-1 text-xs text-slate-500">{offer.paySource || "Pay snapshot"}</p>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">{formatDate(offer.createdAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <Link
                            to={jobPath}
                            className="inline-flex items-center justify-end gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Open
                            <FiArrowUpRight className="h-4 w-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default OfferedWork;
