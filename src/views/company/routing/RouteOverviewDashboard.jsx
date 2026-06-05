import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import {
  FaArrowRight,
  FaCalendarDay,
  FaCheckCircle,
  FaClipboardList,
  FaFileContract,
  FaMapMarkedAlt,
  FaPlus,
  FaRoute,
} from "react-icons/fa";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { SalesAgreementSourceType, salesCollectionNames } from "../../../utils/models/Sales";

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

const normalizeStatus = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const hasAssignedRoute = (stop) => {
  const days = normalizeDays(stop?.daysOfWeek);
  const hasDay = days.length > 0 || !!stop?.day;
  const hasTech = !!(stop?.techId || stop?.tech);
  return hasDay && hasTech;
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

const RouteOverviewDashboard = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState([]);
  const [recurringStops, setRecurringStops] = useState([]);
  const [dailyRoutes, setDailyRoutes] = useState([]);
  const [serviceStopsToday, setServiceStopsToday] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [serviceAgreements, setServiceAgreements] = useState([]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLoading(false);
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
        ] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "recurringRoutes")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "routes")),
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "serviceStops"),
            where("serviceDate", ">=", todayStart),
            where("serviceDate", "<", todayEnd)
          )),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
          getDocs(query(collection(db, salesCollectionNames.agreements), where("companyId", "==", recentlySelectedCompany))),
        ]);

        setRoutes(routesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setRecurringStops(recurringStopsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setDailyRoutes(dailyRoutesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setServiceStopsToday(serviceStopsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setTechnicians(
          usersSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .filter((user) => String(user.status || "Active").toLowerCase() === "active")
        );
        setServiceAgreements(agreementsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } catch (error) {
        console.error("Error loading route dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    loadRoutes();
  }, [recentlySelectedCompany]);

  const recurringStopsByServiceLocation = useMemo(() => {
    const set = new Set();
    recurringStops.forEach((stop) => {
      if (hasAssignedRoute(stop) && stop.serviceLocationId) {
        set.add(stop.serviceLocationId);
      }
    });
    return set;
  }, [recurringStops]);

  const recurringStopsByCustomer = useMemo(() => {
    const set = new Set();
    recurringStops.forEach((stop) => {
      if (hasAssignedRoute(stop) && stop.customerId) {
        set.add(stop.customerId);
      }
    });
    return set;
  }, [recurringStops]);

  const agreementsNeedRouting = useMemo(() => (
    serviceAgreements
      .filter((agreement) => {
        const status = normalizeStatus(agreement.status);
        const sourceType = agreement.sourceType || "";
        const isJobAgreement =
          sourceType === SalesAgreementSourceType.oneOffJob ||
          agreement.rateType === "oneTime" ||
          agreement.serviceCadence === "oneTime" ||
          Boolean(agreement.jobId || agreement.workOrderId);

        if (status !== "accepted" || isJobAgreement) return false;

        const serviceLocationIds = Array.isArray(agreement.serviceLocationIds)
          ? agreement.serviceLocationIds.filter(Boolean)
          : [];
        const hasLocationMatch = serviceLocationIds.some((serviceLocationId) => recurringStopsByServiceLocation.has(serviceLocationId));
        const hasCustomerFallbackMatch = serviceLocationIds.length === 0 && agreement.customerId && recurringStopsByCustomer.has(agreement.customerId);

        return !agreement.recurringServiceStopId && !hasLocationMatch && !hasCustomerFallbackMatch;
      })
      .sort((left, right) => toMillis(right.acceptedAt || right.updatedAt || right.createdAt) - toMillis(left.acceptedAt || left.updatedAt || left.createdAt))
  ), [recurringStopsByCustomer, recurringStopsByServiceLocation, serviceAgreements]);

  const daySummaries = useMemo(() => (
    daysOfWeek.map((day) => {
      const routesForDay = routes.filter((route) => route.day === day);
      const recurringStopsForDay = recurringStops.filter((stop) => {
        const days = normalizeDays(stop.daysOfWeek);
        return days.length ? days.includes(day) : stop.day === day;
      });
      const assignedForDay = recurringStopsForDay.filter(hasAssignedRoute).length;

      return {
        day,
        routeCount: routesForDay.length,
        assignedStopCount: assignedForDay,
        recurringStopCount: recurringStopsForDay.length,
      };
    })
  ), [recurringStops, routes]);

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

  const assignedRecurringStops = useMemo(() => recurringStops.filter(hasAssignedRoute), [recurringStops]);
  const totalRouteStops = assignedRecurringStops.length;
  const coveredDays = daySummaries.filter((summary) => summary.routeCount > 0).length;

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading route dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || "Selected company"}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-950">Route Dashboard</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Overview of recurring route templates, technician coverage, accepted agreements needing routing, and today's live route activity.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/company/route-day-management" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                <FaCalendarDay className="text-xs" />
                Daily Route Board
              </Link>
              <Link to="/company/route-builder" className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
                <FaPlus className="text-xs" />
                Create Route
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={FaRoute} label="Route Templates" value={routes.length} helper={`${coveredDays} day(s) covered`} to="/company/route-management" tone="blue" />
          <StatTile icon={FaClipboardList} label="Assigned Stops" value={totalRouteStops} helper="Recurring stops with tech and day" to="/company/recurringServiceStop" tone="emerald" />
          <StatTile icon={FaFileContract} label="Needs Routing" value={agreementsNeedRouting.length} helper="Accepted service agreements" to="/company/sales/agreements" tone={agreementsNeedRouting.length ? "amber" : "emerald"} />
          <StatTile icon={FaMapMarkedAlt} label="Today" value={serviceStopsToday.length} helper={`${dailyRoutes.length} active daily route(s)`} to="/company/route-day-management" tone="blue" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <ListCard title="Weekly Route Coverage" helper="Route templates and assigned recurring stops by day." to="/company/route-management">
              <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
                {daySummaries.map((summary) => (
                  <div key={summary.day} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{summary.day}</p>
                        <p className="mt-1 text-sm text-slate-500">{summary.routeCount} route(s)</p>
                      </div>
                      <span className={summary.assignedStopCount ? "rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800" : "rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"}>
                        {summary.assignedStopCount ? "Assigned" : "No stops"}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded bg-white p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Assigned</p>
                        <p className="mt-1 font-bold text-slate-900">{summary.assignedStopCount}</p>
                      </div>
                      <div className="rounded bg-white p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recurring</p>
                        <p className="mt-1 font-bold text-slate-900">{summary.recurringStopCount}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ListCard>

            <div className="grid gap-6 lg:grid-cols-2">
              <ListCard title="Route Templates" helper="Most recently changed recurring route templates." to="/company/route-management">
                {recentRoutes.length === 0 ? (
                  <EmptyRow>No route templates yet.</EmptyRow>
                ) : recentRoutes.map((route) => {
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
                          <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                            {stops.map((stop) => stop.customerName || stop.locationName || "Unnamed stop").filter(Boolean).join(" -> ") || "No ordered stops"}
                          </p>
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{stops.length} stops</span>
                      </div>
                    </Link>
                  );
                })}
              </ListCard>

              <ListCard title="Accepted Agreements Needing Routing" helper="Accepted recurring service agreements without a routed recurring stop." to="/company/sales/agreements">
                {agreementsNeedRouting.length === 0 ? (
                  <EmptyRow>No accepted service agreements are waiting on routing.</EmptyRow>
                ) : agreementsNeedRouting.slice(0, 8).map((agreement) => (
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
            </div>
          </div>

          <aside className="space-y-6">
            <ListCard title="Technician Coverage" helper="Route templates assigned by technician." to="/company/route-management">
              {technicianSummaries.length === 0 ? (
                <EmptyRow>No active technicians found.</EmptyRow>
              ) : technicianSummaries.map((tech) => (
                <div key={tech.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{tech.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{tech.role}</p>
                      <p className="mt-1 text-xs text-slate-400">{Array.from(tech.days).join(", ") || "No route days"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{tech.routeCount}</p>
                      <p className="text-xs text-slate-500">{tech.stopCount} stops</p>
                    </div>
                  </div>
                </div>
              ))}
            </ListCard>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Routing Actions</h2>
              <div className="mt-4 space-y-3">
                <Link to="/company/route-management" className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700">
                  Manage route templates
                  <FaArrowRight className="text-xs" />
                </Link>
                <Link to="/company/route-builder" className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700">
                  Build a route
                  <FaArrowRight className="text-xs" />
                </Link>
                <Link to="/company/sales/agreements" className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700">
                  Review service agreements
                  <FaArrowRight className="text-xs" />
                </Link>
                <Link to="/company/route-day-management" className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 hover:text-blue-700">
                  Open daily route board
                  <FaArrowRight className="text-xs" />
                </Link>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FaCheckCircle className="text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-950">Today Snapshot</h2>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Daily routes</p>
                  <p className="mt-2 text-xl font-bold text-slate-950">{dailyRoutes.length}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stops today</p>
                  <p className="mt-2 text-xl font-bold text-slate-950">{serviceStopsToday.length}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">Last checked {formatDate(new Date())}</p>
            </section>
          </aside>
        </section>
      </div>
    </div>
  );
};

export default RouteOverviewDashboard;
