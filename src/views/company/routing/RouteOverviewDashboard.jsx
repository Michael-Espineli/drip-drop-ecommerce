import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import {
  FaArrowRight,
  FaCalendarDay,
  FaClipboardList,
  FaExclamationTriangle,
  FaFileContract,
  FaPlus,
  FaRoute,
  FaUsers,
} from "react-icons/fa";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { salesCollectionNames } from "../../../utils/models/Sales";
import {
  AgreementBillingType,
  getAgreementBillingType,
} from "../../../utils/sales/agreementRouting";

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfToday = () => {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  return date;
};

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
  if (!millis) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(millis));
};

const formatTime = (value) => {
  const millis = toMillis(value);
  if (!millis) return "Not started";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(millis));
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const normalizeStatus = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const normalizeDays = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((day) => day.trim())
      .filter(Boolean);
  }
  return [];
};

const routeStops = (route) => (
  Array.isArray(route?.order)
    ? [...route.order].sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    : []
);

const techLabel = (tech) => tech?.userName || tech?.label || tech?.name || tech?.email || "Unassigned";

const routeTitle = (route) => route?.description || route?.name || `${route?.tech || "Technician"} ${route?.day || ""} Route`.trim();

const getStopState = (stop) => {
  const start = toMillis(stop?.startTime);
  const end = toMillis(stop?.endTime);

  if (end) return "finished";
  if (start) return "inProgress";
  return "notStarted";
};

const routeStatusRank = (status) => {
  if (status === "In Progress") return 0;
  if (status === "Did Not Start") return 1;
  if (status === "Finished") return 3;
  return 2;
};

const isActiveCustomer = (customer = {}) => customer.active === true;

const customerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || "Unnamed Customer";
  }

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    || customer.company
    || customer.companyName
    || customer.email
    || "Unnamed Customer";
};

const customerContact = (customer = {}) => (
  customer.email
  || customer.billingEmail
  || customer.phoneNumber
  || customer.phone
  || customer.mobilePhone
  || ""
);

const isLiveRecurringStop = (stop = {}) => {
  if (!stop.customerId) return false;
  if ((stop.active ?? stop.isActive ?? true) === false) return false;

  const endMillis = toMillis(stop.endDate);
  return stop.noEndDate || !endMillis || endMillis >= Date.now();
};

const buildRecurringStopCoverageIndex = (recurringStops = []) => {
  const serviceLocationIds = new Set();
  const customerIds = new Set();

  recurringStops.forEach((stop) => {
    if (!isLiveRecurringStop(stop)) return;
    if (stop.serviceLocationId) serviceLocationIds.add(stop.serviceLocationId);
    if (stop.customerId) customerIds.add(stop.customerId);
  });

  return {
    serviceLocationIds,
    customerIds,
  };
};

const agreementNeedsRecurringServiceStop = (agreement = {}, recurringStopIndex = {}) => {
  if (normalizeStatus(agreement.status) !== "accepted") return false;
  if (getAgreementBillingType(agreement) !== AgreementBillingType.recurring) return false;
  if (agreement.recurringServiceStopId) return false;

  const serviceLocationIds = Array.isArray(agreement.serviceLocationIds)
    ? agreement.serviceLocationIds.filter(Boolean)
    : [];
  const hasLocationMatch = serviceLocationIds.some((serviceLocationId) => (
    recurringStopIndex.serviceLocationIds?.has(serviceLocationId)
  ));
  const hasCustomerFallbackMatch = serviceLocationIds.length === 0
    && agreement.customerId
    && recurringStopIndex.customerIds?.has(agreement.customerId);

  return !hasLocationMatch && !hasCustomerFallbackMatch;
};

const StatTile = ({ icon: Icon, label, value, helper, to, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  };

  const content = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
  );

  return to ? <Link to={to}>{content}</Link> : content;
};

const ProgressBar = ({ value, tone = "blue" }) => {
  const tones = {
    blue: "bg-blue-600",
    emerald: "bg-emerald-500",
    amber: "bg-amber-400",
    rose: "bg-rose-500",
  };

  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${tones[tone] || tones.blue}`} style={{ width: `${clampPercent(value)}%` }} />
    </div>
  );
};

const ListCard = ({ title, helper, to, children }) => (
  <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div>
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}
      </div>
      {to && <Link to={to} className="text-xs font-semibold text-blue-700 hover:text-blue-900">View all</Link>}
    </div>
    <div className="divide-y divide-slate-100">{children}</div>
  </section>
);

const EmptyRow = ({ children }) => <div className="p-5 text-sm text-slate-500">{children}</div>;

const TodayExecutionCard = ({
  dailyRoutes,
  todayCompletionPercent,
  todayRouteRows,
  todayStopSummary,
}) => (
  <ListCard title="Today's Execution" to="/company/route-day-management">
    <div className="p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Stops complete</p>
          <p className="mt-1 text-3xl font-bold leading-none text-slate-950">{todayCompletionPercent}%</p>
        </div>
        <p className="pb-1 text-sm font-semibold text-slate-500">{todayStopSummary.finished}/{todayStopSummary.total} stops</p>
      </div>
      <div className="mt-3">
        <ProgressBar value={todayCompletionPercent} tone="emerald" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-slate-50 px-2 py-2">
          <p className="text-xs font-bold text-slate-900">{dailyRoutes.length}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Routes</p>
        </div>
        <div className="rounded-md bg-blue-50 px-2 py-2">
          <p className="text-xs font-bold text-blue-900">{todayStopSummary.inProgress}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Active</p>
        </div>
        <div className="rounded-md bg-amber-50 px-2 py-2">
          <p className="text-xs font-bold text-amber-900">{todayStopSummary.notStarted}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Open</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {todayRouteRows.length ? todayRouteRows.map((route) => {
          const completion = route.totalStops ? Math.round((route.finishedStops / route.totalStops) * 100) : 0;

          return (
            <div key={route.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{route.techName}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{route.status} - {formatTime(route.startTime)}</p>
                </div>
                <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-700">{route.finishedStops}/{route.totalStops}</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={completion} tone={route.status === "Finished" ? "emerald" : route.inProgressStops ? "blue" : "amber"} />
              </div>
            </div>
          );
        }) : (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-semibold text-slate-500">
            No active route activity found for today.
          </p>
        )}
      </div>
    </div>
  </ListCard>
);

const RouteOverviewDashboard = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState([]);
  const [recurringStops, setRecurringStops] = useState([]);
  const [dailyRoutes, setDailyRoutes] = useState([]);
  const [serviceStopsToday, setServiceStopsToday] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [serviceAgreements, setServiceAgreements] = useState([]);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLoading(false);
      setRoutes([]);
      setRecurringStops([]);
      setDailyRoutes([]);
      setServiceStopsToday([]);
      setTechnicians([]);
      setServiceAgreements([]);
      setCustomers([]);
      return;
    }

    const loadRoutes = async () => {
      setLoading(true);
      try {
        const todayStart = Timestamp.fromDate(startOfToday());
        const todayEnd = Timestamp.fromDate(endOfToday());
        const [
          routesSnap,
          recurringStopsSnap,
          dailyRoutesSnap,
          serviceStopsSnap,
          usersSnap,
          agreementsSnap,
          customersSnap,
        ] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "recurringRoutes")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")),
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "activeRoutes"),
            where("date", ">=", todayStart),
            where("date", "<", todayEnd)
          )),
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "serviceStops"),
            where("serviceDate", ">=", todayStart),
            where("serviceDate", "<", todayEnd)
          )),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
          getDocs(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", recentlySelectedCompany))),
          getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
        ]);

        setRoutes(routesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setRecurringStops(recurringStopsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setDailyRoutes(dailyRoutesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })).filter((route) => !route.duplicateOf));
        setServiceStopsToday(serviceStopsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setTechnicians(
          usersSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .filter((user) => String(user.status || "Active").toLowerCase() === "active")
        );
        setServiceAgreements(agreementsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setCustomers(customersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } catch (error) {
        console.error("Error loading route dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    loadRoutes();
  }, [recentlySelectedCompany]);

  const liveRecurringStops = useMemo(
    () => recurringStops.filter(isLiveRecurringStop),
    [recurringStops]
  );

  const recurringStopCoverageIndex = useMemo(
    () => buildRecurringStopCoverageIndex(liveRecurringStops),
    [liveRecurringStops]
  );

  const activeCustomers = useMemo(
    () => customers.filter(isActiveCustomer).sort((left, right) => customerDisplayName(left).localeCompare(customerDisplayName(right))),
    [customers]
  );

  const customersWithoutRecurringStops = useMemo(() => (
    activeCustomers.filter((customer) => !recurringStopCoverageIndex.customerIds.has(customer.id))
  ), [activeCustomers, recurringStopCoverageIndex]);

  const agreementsNeedRecurringStops = useMemo(() => (
    serviceAgreements
      .filter((agreement) => agreementNeedsRecurringServiceStop(agreement, recurringStopCoverageIndex))
      .sort((left, right) => toMillis(right.acceptedAt || right.updatedAt || right.createdAt) - toMillis(left.acceptedAt || left.updatedAt || left.createdAt))
  ), [recurringStopCoverageIndex, serviceAgreements]);

  const daySummaries = useMemo(() => (
    daysOfWeek.map((day) => {
      const routesForDay = routes.filter((route) => route.day === day);
      const recurringStopsForDay = liveRecurringStops.filter((stop) => {
        const days = normalizeDays(stop.daysOfWeek);
        return days.length ? days.includes(day) : stop.day === day;
      });

      return {
        day,
        routeCount: routesForDay.length,
        recurringStopCount: recurringStopsForDay.length,
      };
    })
  ), [liveRecurringStops, routes]);

  const technicianSummaries = useMemo(() => {
    const techMap = new Map();

    technicians.forEach((tech) => {
      const id = tech.userId || tech.id;
      techMap.set(id, {
        id,
        name: techLabel(tech),
        role: tech.workerType || tech.roleName || tech.role || "Technician",
        routeCount: 0,
        stopCount: 0,
        days: new Set(),
      });
    });

    routes.forEach((route) => {
      const id = route.techId || route.userId || route.tech;
      if (!techMap.has(id)) {
        techMap.set(id, {
          id,
          name: route.tech || route.techName || "Unassigned",
          role: "Technician",
          routeCount: 0,
          stopCount: 0,
          days: new Set(),
        });
      }

      const summary = techMap.get(id);
      summary.routeCount += 1;
      summary.stopCount += routeStops(route).length;
      if (route.day) summary.days.add(route.day);
    });

    return Array.from(techMap.values())
      .sort((left, right) => right.routeCount - left.routeCount || left.name.localeCompare(right.name))
      .slice(0, 8);
  }, [routes, technicians]);

  const recentRoutes = useMemo(() => (
    [...routes]
      .sort((left, right) => toMillis(right.updatedAt || right.createdAt || right.dateCreated) - toMillis(left.updatedAt || left.createdAt || left.dateCreated))
      .slice(0, 8)
  ), [routes]);

  const customersWithRecurringStops = Math.max(activeCustomers.length - customersWithoutRecurringStops.length, 0);
  const customerCoveragePercent = activeCustomers.length
    ? Math.round((customersWithRecurringStops / activeCustomers.length) * 100)
    : 100;
  const routedTechnicianCount = technicianSummaries.filter((summary) => summary.routeCount > 0).length;
  const dayMaxStops = Math.max(1, ...daySummaries.map((summary) => summary.recurringStopCount));
  const technicianMaxStops = Math.max(1, ...technicianSummaries.map((summary) => summary.stopCount));
  const todayStopSummary = useMemo(() => (
    serviceStopsToday.reduce((summary, stop) => {
      summary.total += 1;
      summary[getStopState(stop)] += 1;
      return summary;
    }, {
      total: 0,
      finished: 0,
      inProgress: 0,
      notStarted: 0,
    })
  ), [serviceStopsToday]);
  const todayCompletionPercent = todayStopSummary.total
    ? Math.round((todayStopSummary.finished / todayStopSummary.total) * 100)
    : 0;
  const todayRouteRows = useMemo(() => {
    const stopsByTech = new Map();

    serviceStopsToday.forEach((stop) => {
      const key = stop.techId || stop.tech || "Unassigned";
      if (!stopsByTech.has(key)) {
        stopsByTech.set(key, {
          key,
          techName: stop.tech || "Unassigned",
          stops: [],
        });
      }
      stopsByTech.get(key).stops.push(stop);
    });

    const activeRows = dailyRoutes.map((route) => {
      const routeStopsForTech = serviceStopsToday.filter((stop) => (
        (route.techId && stop.techId === route.techId) ||
        (route.techName && stop.tech === route.techName) ||
        route.serviceStopsIds?.includes(stop.id)
      ));
      const orderedStopCount = routeStops(route).length;
      const totalStops = Number(route.totalStops || route.serviceStopsIds?.length || orderedStopCount || routeStopsForTech.length || 0);
      const finishedFromStops = routeStopsForTech.filter((stop) => getStopState(stop) === "finished").length;
      const finishedStops = Math.min(totalStops, Math.max(Number(route.finishedStops || 0), finishedFromStops));
      const inProgressStops = routeStopsForTech.filter((stop) => getStopState(stop) === "inProgress").length;

      return {
        id: route.id,
        techName: route.techName || route.tech || route.name || "Route",
        routeName: route.name || "Daily route",
        status: route.status || (finishedStops === totalStops && totalStops > 0 ? "Finished" : inProgressStops > 0 ? "In Progress" : "Did Not Start"),
        startTime: route.startTime || route.startedAt || route.startTimeDate || route.createdAt,
        totalStops,
        finishedStops,
        inProgressStops,
      };
    });

    if (activeRows.length) {
      return activeRows
        .sort((left, right) => routeStatusRank(left.status) - routeStatusRank(right.status) || left.techName.localeCompare(right.techName))
        .slice(0, 6);
    }

    return Array.from(stopsByTech.values())
      .map((group) => ({
        id: group.key,
        techName: group.techName,
        routeName: "Service stops",
        status: group.stops.some((stop) => getStopState(stop) === "inProgress") ? "In Progress" : "Did Not Start",
        startTime: group.stops.find((stop) => getStopState(stop) === "inProgress")?.startTime,
        totalStops: group.stops.length,
        finishedStops: group.stops.filter((stop) => getStopState(stop) === "finished").length,
        inProgressStops: group.stops.filter((stop) => getStopState(stop) === "inProgress").length,
      }))
      .sort((left, right) => right.totalStops - left.totalStops || left.techName.localeCompare(right.techName))
      .slice(0, 6);
  }, [dailyRoutes, serviceStopsToday]);

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading route dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || "Selected company"}</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Route Planning Dashboard</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Plan recurring coverage, spot routing gaps, and keep an eye on today's route execution.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Link to="/company/route-management" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <FaRoute className="text-xs" />
              Templates
            </Link>
            <Link to="/company/route-builder" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <FaPlus className="text-xs" />
              Build Route
            </Link>
            <Link to="/company/recurringServiceStop" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <FaClipboardList className="text-xs" />
              Recurring Stops
            </Link>
            <Link to="/company/sales/agreements/needs-routing" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <FaFileContract className="text-xs" />
              Missing Stops
            </Link>
            <Link to="/company/route-day-management" className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
              <FaCalendarDay className="text-xs" />
              Daily Route Board
            </Link>
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_390px]">
            <div className="p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Planning Overview</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-950">Coverage and capacity</h2>
                </div>
                <div className="rounded-md bg-slate-900 px-4 py-3 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Customer Coverage</p>
                  <p className="mt-1 text-3xl font-bold leading-none">{customerCoveragePercent}%</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <StatTile icon={FaRoute} label="Route Templates" value={routes.length} helper={`${liveRecurringStops.length} recurring stops`} to="/company/route-management" tone="blue" />
                <StatTile icon={FaUsers} label="Routed Techs" value={routedTechnicianCount} helper={`${technicians.length} active users`} to="/company/route-management" tone="slate" />
                <StatTile icon={FaClipboardList} label="Customers Missing Stops" value={customersWithoutRecurringStops.length} helper={`${activeCustomers.length} active customers`} to="/company/recurringServiceStop/active-customers-without-recurring-service-stops" tone={customersWithoutRecurringStops.length ? "amber" : "emerald"} />
                <StatTile icon={FaFileContract} label="Agreements Missing Stops" value={agreementsNeedRecurringStops.length} helper="accepted recurring agreements" to="/company/sales/agreements/needs-routing" tone={agreementsNeedRecurringStops.length ? "amber" : "emerald"} />
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                  <span>Active customers with recurring service stops</span>
                  <span>{customersWithRecurringStops}/{activeCustomers.length || 0}</span>
                </div>
                <ProgressBar value={customerCoveragePercent} tone={customersWithoutRecurringStops.length ? "amber" : "emerald"} />
              </div>
            </div>

            <aside className="border-t border-slate-800 bg-slate-900 p-5 text-white xl:border-l xl:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-300">Routing Work Queue</p>
                  <h2 className="mt-1 text-xl font-bold">Follow-up needed</h2>
                </div>
                <FaExclamationTriangle className={agreementsNeedRecurringStops.length || customersWithoutRecurringStops.length ? "mt-1 text-amber-300" : "mt-1 text-emerald-300"} />
              </div>

              <div className="mt-5 space-y-3">
                {agreementsNeedRecurringStops.length > 0 && (
                  <Link to="/company/sales/agreements/needs-routing" className="flex items-center justify-between gap-3 rounded-md bg-white/10 px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/15">
                    <span>Accepted agreements missing stops</span>
                    <span className="rounded bg-amber-300 px-2 py-1 text-xs font-bold text-slate-950">{agreementsNeedRecurringStops.length}</span>
                  </Link>
                )}
                {customersWithoutRecurringStops.length > 0 && (
                  <Link to="/company/recurringServiceStop/active-customers-without-recurring-service-stops" className="flex items-center justify-between gap-3 rounded-md bg-white/10 px-3 py-3 text-sm font-semibold text-white transition hover:bg-white/15">
                    <span>Customers without recurring stops</span>
                    <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-950">{customersWithoutRecurringStops.length}</span>
                  </Link>
                )}
                {agreementsNeedRecurringStops.length === 0 && customersWithoutRecurringStops.length === 0 && (
                  <p className="rounded-md bg-white/5 px-3 py-3 text-sm font-semibold text-slate-300">No routing follow-up needed.</p>
                )}
              </div>

              {customersWithoutRecurringStops.length > 0 && (
                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-300">Next customers missing stops</p>
                  <div className="mt-3 space-y-2">
                    {customersWithoutRecurringStops.slice(0, 3).map((customer) => (
                      <Link key={customer.id} to={`/company/customers/details/${customer.id}`} className="block min-w-0 rounded-md bg-white/5 px-3 py-2 transition hover:bg-white/10">
                        <p className="truncate text-sm font-semibold">{customerDisplayName(customer)}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-300">{customerContact(customer) || "No contact saved"}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-5">
            <ListCard title="Weekly Route Coverage" helper="Recurring stop density and route templates by day." to="/company/route-management">
              <div className="space-y-3 p-5">
                {daySummaries.map((summary) => {
                  const densityPercent = Math.round((summary.recurringStopCount / dayMaxStops) * 100);
                  const dayTone = summary.recurringStopCount === 0
                    ? "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"
                    : summary.routeCount > 0
                      ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
                      : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700";
                  const dayLabel = summary.recurringStopCount === 0
                    ? "No stops"
                    : summary.routeCount > 0
                      ? `${summary.routeCount} route${summary.routeCount === 1 ? "" : "s"}`
                      : "Review route";

                  return (
                    <div key={summary.day} className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)_110px] md:items-center">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{summary.day}</p>
                        <p className="text-xs text-slate-500">{summary.routeCount} route template{summary.routeCount === 1 ? "" : "s"}</p>
                      </div>
                      <div className="min-w-0">
                        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${densityPercent}%` }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                          <span>{summary.recurringStopCount} recurring stops</span>
                          <span>{summary.routeCount} route templates</span>
                        </div>
                      </div>
                      <div className="text-left md:text-right">
                        <span className={dayTone}>{dayLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ListCard>
          </div>

          <TodayExecutionCard
            dailyRoutes={dailyRoutes}
            todayCompletionPercent={todayCompletionPercent}
            todayRouteRows={todayRouteRows}
            todayStopSummary={todayStopSummary}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="grid gap-5 lg:grid-cols-2">
            <ListCard title="Accepted Agreements Missing Recurring Stops" helper="Accepted recurring service agreements without a matching recurring service stop." to="/company/sales/agreements/needs-routing">
              {agreementsNeedRecurringStops.length === 0 ? (
                <EmptyRow>No accepted recurring service agreements are missing recurring stops.</EmptyRow>
              ) : agreementsNeedRecurringStops.slice(0, 6).map((agreement) => (
                <Link key={agreement.id} to={`/company/sales/agreements/${agreement.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{agreement.title || "Service Agreement"}</p>
                      <p className="mt-1 text-sm text-slate-500">{agreement.customerName || "Customer"}</p>
                      <p className="mt-1 text-xs text-slate-400">Accepted {formatDate(agreement.acceptedAt || agreement.updatedAt || agreement.createdAt)}</p>
                    </div>
                    <FaArrowRight className="mt-1 text-xs text-slate-400" />
                  </div>
                </Link>
              ))}
            </ListCard>

            <ListCard title="Route Template Changes" helper="Recently changed recurring route templates." to="/company/route-management">
              {recentRoutes.length === 0 ? (
                <EmptyRow>No route templates yet.</EmptyRow>
              ) : recentRoutes.slice(0, 6).map((route) => {
                const stops = routeStops(route);
                return (
                  <Link
                    key={route.id}
                    to="/company/route-management"
                    className="block px-5 py-4 transition hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{routeTitle(route)}</p>
                        <p className="mt-1 text-sm text-slate-500">{route.day || "No day"} - {route.tech || route.techName || "Unassigned"}</p>
                      </div>
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{stops.length} stops</span>
                    </div>
                  </Link>
                );
              })}
            </ListCard>
          </div>

          <aside className="space-y-5">
            <ListCard title="Technician Load" helper="Recurring route templates assigned by technician." to="/company/route-management">
              {technicianSummaries.length === 0 ? (
                <EmptyRow>No active technicians found.</EmptyRow>
              ) : technicianSummaries.map((tech) => (
                <div key={tech.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{tech.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{Array.from(tech.days).join(", ") || "No route days"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{tech.stopCount}</p>
                      <p className="text-xs text-slate-500">{tech.routeCount} routes</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={(tech.stopCount / technicianMaxStops) * 100} tone={tech.routeCount ? "blue" : "amber"} />
                  </div>
                </div>
              ))}
            </ListCard>
          </aside>
        </section>
      </div>
    </div>
  );
};

export default RouteOverviewDashboard;
