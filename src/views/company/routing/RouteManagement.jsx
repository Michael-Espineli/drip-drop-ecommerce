import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query } from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import Select from "react-select";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentPlusIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { generateServiceAgreementsFromRoutes } from "../../../utils/sales/routeAgreementGeneration";

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const stopCount = (route) => (Array.isArray(route?.order) ? route.order.length : 0);

const routeTechnicianId = (route) => String(route?.techId || "");

const routeTechnicianLabel = (route, tech) => (
  tech?.label ||
  route?.techName ||
  route?.technicianName ||
  route?.userName ||
  routeTechnicianId(route) ||
  "Unassigned technician"
);

const routeTitle = (route, tech, day) => (
  route?.description ||
  route?.name ||
  route?.routeName ||
  `${routeTechnicianLabel(route, tech)} ${day} Route`
);

const RouteRow = ({ day, tech, route, onEdit, onGenerateAgreements, generatingAgreement }) => {
  const orderedStops = Array.isArray(route?.order)
    ? [...route.order].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    : [];

  return (
    <div className="grid gap-3 border-t border-slate-100 px-5 py-4 md:grid-cols-[220px_1fr_auto] md:items-center">
      <div>
        <p className="font-semibold text-slate-900">{routeTechnicianLabel(route, tech)}</p>
        <p className="text-xs text-slate-500">{tech?.workerType || tech?.roleName || "Technician"}</p>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-800">{routeTitle(route, tech, day)}</p>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{stopCount(route)} stop(s)</span>
        </div>
        {orderedStops.length ? (
          <p className="mt-1 line-clamp-1 text-sm text-slate-500">
            {orderedStops.map((stop) => stop.customerName || stop.locationName || "Unnamed stop").filter(Boolean).join(" -> ")}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No ordered stops on this route yet.</p>
        )}
      </div>

      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        <button
          type="button"
          onClick={() => onGenerateAgreements(route)}
          disabled={generatingAgreement || stopCount(route) === 0}
          title="Generate service agreement drafts from this route"
          className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <DocumentPlusIcon className="h-4 w-4" />
          {generatingAgreement ? "Generating..." : "Generate Agreements"}
        </button>
        <button
          type="button"
          onClick={() => onEdit(route)}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Edit
        </button>
      </div>
    </div>
  );
};

const DaySection = ({
  day,
  routes,
  techniciansById,
  collapsed,
  onToggleCollapsed,
  onCreate,
  onEdit,
  onGenerateAgreements,
  generatingRouteId,
}) => {
  const totalStops = routes.reduce((total, route) => total + stopCount(route), 0);
  const collapseLabel = collapsed ? `Expand ${day}` : `Collapse ${day}`;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => onToggleCollapsed(day)}
            title={collapseLabel}
            aria-label={collapseLabel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
          >
            {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{day}</h2>
            <p className="text-sm text-slate-500">{routes.length} route(s), {totalStops} stop(s)</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCreate(day)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          New Route
        </button>
      </div>

      {collapsed ? null : routes.length ? (
        routes.map((route) => (
          <RouteRow
            key={route.id}
            day={day}
            tech={techniciansById.get(routeTechnicianId(route))}
            route={route}
            onEdit={onEdit}
            onGenerateAgreements={onGenerateAgreements}
            generatingAgreement={generatingRouteId === route.id}
          />
        ))
      ) : (
        <div className="border-t border-slate-100 px-5 py-6 text-sm text-slate-500">No planned routes for this day.</div>
      )}
    </section>
  );
};

const RouteManagement = () => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    currentUser,
    user,
    currentuser,
    dataBaseUser,
  } = useContext(Context);
  const navigate = useNavigate();
  const activeUser = currentUser || user || currentuser || {};
  const activeUserId = activeUser?.uid || activeUser?.id || dataBaseUser?.id || "";
  const [allRoutes, setAllRoutes] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState(null);
  const [techFilter, setTechFilter] = useState(null);
  const [collapsedDays, setCollapsedDays] = useState(() => new Set(daysOfWeek));
  const [generatingRouteId, setGeneratingRouteId] = useState("");

  const dayOptions = daysOfWeek.map((day) => ({ value: day, label: day }));

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAllRoutes([]);
      setTechnicians([]);
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const routesRef = collection(db, "companies", recentlySelectedCompany, "recurringRoutes");
        const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");
        const [routesSnapshot, usersSnapshot] = await Promise.all([getDocs(query(routesRef)), getDocs(query(usersRef))]);

        setAllRoutes(routesSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setTechnicians(
          usersSnapshot.docs
            .map((docSnap) => ({ id: docSnap.id, value: docSnap.data().userId || docSnap.id, label: docSnap.data().userName || docSnap.id, ...docSnap.data() }))
            .filter((user) => String(user.status || "Active").toLowerCase() === "active")
            .sort((a, b) => a.label.localeCompare(b.label))
        );
      } catch (error) {
        console.error("Error fetching planned routes:", error);
        toast.error("Failed to load planned routes.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [recentlySelectedCompany]);

  const visibleDays = useMemo(
    () => (dayFilter ? daysOfWeek.filter((day) => day === dayFilter.value) : daysOfWeek),
    [dayFilter]
  );

  const techniciansById = useMemo(() => {
    const nextTechnicians = new Map();
    technicians.forEach((tech) => {
      nextTechnicians.set(String(tech.value), tech);
    });
    return nextTechnicians;
  }, [technicians]);

  const routedTechnicianOptions = useMemo(() => {
    const optionsById = new Map();

    allRoutes.forEach((route) => {
      const techId = routeTechnicianId(route);
      if (!techId) return;

      const tech = techniciansById.get(techId);
      optionsById.set(techId, {
        ...(tech || {}),
        value: techId,
        label: routeTechnicianLabel(route, tech),
      });
    });

    return [...optionsById.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [allRoutes, techniciansById]);

  useEffect(() => {
    if (techFilter && !routedTechnicianOptions.some((tech) => tech.value === techFilter.value)) {
      setTechFilter(null);
    }
  }, [routedTechnicianOptions, techFilter]);

  const visibleRoutes = useMemo(
    () =>
      allRoutes.filter((route) => {
        const dayMatch = !dayFilter || route.day === dayFilter.value;
        const techMatch = !techFilter || routeTechnicianId(route) === techFilter.value;
        return dayMatch && techMatch;
      }),
    [allRoutes, dayFilter, techFilter]
  );

  const routesByDay = useMemo(() => {
    const nextRoutes = new Map(daysOfWeek.map((day) => [day, []]));

    visibleRoutes.forEach((route) => {
      if (!route.day) return;
      const dayRoutes = nextRoutes.get(route.day) || [];
      dayRoutes.push(route);
      nextRoutes.set(route.day, dayRoutes);
    });

    nextRoutes.forEach((dayRoutes) => {
      dayRoutes.sort((left, right) => {
        const leftTech = routeTechnicianLabel(left, techniciansById.get(routeTechnicianId(left)));
        const rightTech = routeTechnicianLabel(right, techniciansById.get(routeTechnicianId(right)));
        const leftTitle = routeTitle(left, techniciansById.get(routeTechnicianId(left)), left.day);
        const rightTitle = routeTitle(right, techniciansById.get(routeTechnicianId(right)), right.day);
        return leftTech.localeCompare(rightTech) || leftTitle.localeCompare(rightTitle);
      });
    });

    return nextRoutes;
  }, [visibleRoutes, techniciansById]);

  const totalStops = visibleRoutes.reduce((total, route) => total + stopCount(route), 0);
  const visibleTechnicianCount = useMemo(
    () => new Set(visibleRoutes.map((route) => routeTechnicianId(route)).filter(Boolean)).size,
    [visibleRoutes]
  );
  const visibleLocationCount = useMemo(() => {
    const locationIds = new Set();

    visibleRoutes.forEach((route) => {
      const orderedStops = Array.isArray(route?.order) ? route.order : [];
      orderedStops.forEach((stop) => {
        const locationId = stop?.locationId || stop?.serviceLocationId || "";
        if (locationId) locationIds.add(String(locationId));
      });
    });

    return locationIds.size;
  }, [visibleRoutes]);
  const visibleCustomerCount = useMemo(() => {
    const customerIds = new Set();

    visibleRoutes.forEach((route) => {
      const orderedStops = Array.isArray(route?.order) ? route.order : [];
      orderedStops.forEach((stop) => {
        const customerId = stop?.customerId || stop?.customerName || "";
        if (customerId) customerIds.add(String(customerId));
      });
    });

    return customerIds.size;
  }, [visibleRoutes]);
  const allVisibleDaysCollapsed = visibleDays.length > 0 && visibleDays.every((day) => collapsedDays.has(day));

  const toggleDayCollapsed = (day) => {
    setCollapsedDays((current) => {
      const nextDays = new Set(current);
      if (nextDays.has(day)) {
        nextDays.delete(day);
      } else {
        nextDays.add(day);
      }
      return nextDays;
    });
  };

  const toggleAllVisibleDays = () => {
    setCollapsedDays((current) => {
      const nextDays = new Set(current);

      if (allVisibleDaysCollapsed) {
        visibleDays.forEach((day) => nextDays.delete(day));
      } else {
        visibleDays.forEach((day) => nextDays.add(day));
      }

      return nextDays;
    });
  };

  const handleCreate = (day, tech = null) => {
    navigate("/company/route-builder", {
      state: {
        defaultDay: day,
        defaultTechnicianId: tech?.value || "",
      },
    });
  };

  const handleEdit = (route) => {
    navigate("/company/route-builder", { state: { templateToEdit: route } });
  };

  const handleGenerateAgreements = async (route) => {
    if (!recentlySelectedCompany || !route?.id) {
      toast.error("Select a company and route first.");
      return;
    }

    setGeneratingRouteId(route.id);

    try {
      const result = await generateServiceAgreementsFromRoutes({
        db,
        companyId: recentlySelectedCompany,
        companyName: recentlySelectedCompanyName || "Selected company",
        routes: [route],
        createdByUserId: activeUserId,
      });

      if (result.createdCount > 0) {
        const skippedText = result.skippedExistingCount
          ? ` ${result.skippedExistingCount} stop(s) already had agreements.`
          : "";
        toast.success(`Created ${result.createdCount} service agreement draft(s).${skippedText}`);
        return;
      }

      if (result.skippedExistingCount > 0) {
        toast("Every stop on this route already has a service agreement.");
        return;
      }

      if (result.skippedIncompleteCount > 0 || result.missingStopCount > 0) {
        toast.error("No drafts created. Some route stops are missing customer, location, or recurring stop data.");
        return;
      }

      toast.error("This route has no recurring service stops to generate from.");
    } catch (error) {
      console.error("Unable to generate service agreements from route", error);
      toast.error("Failed to generate service agreements from this route.");
    } finally {
      setGeneratingRouteId("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Operations</p>
              <h1 className="text-3xl font-bold text-slate-950">Planned Routes</h1>
              <p className="max-w-3xl text-sm text-slate-600">Recurring routes organized by day and technician.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleAllVisibleDays}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {allVisibleDaysCollapsed ? <ArrowsPointingOutIcon className="h-4 w-4" /> : <ArrowsPointingInIcon className="h-4 w-4" />}
                {allVisibleDaysCollapsed ? "Expand All" : "Collapse All"}
              </button>
              <Link
                to="/company/recurringServiceStop"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Recurring Service Stops
              </Link>
              <button
                type="button"
                onClick={() => handleCreate(null)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                New Route
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Routes</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleRoutes.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stops</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{totalStops}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Technicians</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleTechnicianCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Locations</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleLocationCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customers</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleCustomerCount}</p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[180px_1fr_1fr] md:items-center">
            <h2 className="font-semibold text-slate-800">Filters</h2>
            <Select options={dayOptions} value={dayFilter} onChange={setDayFilter} placeholder="Filter by day..." isClearable />
            <Select options={routedTechnicianOptions} value={techFilter} onChange={setTechFilter} placeholder="Filter by technician..." isLoading={isLoading} isClearable />
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">Loading routes...</div>
        ) : (
          <div className="space-y-4">
            {visibleDays.map((day) => (
              <DaySection
                key={day}
                day={day}
                routes={routesByDay.get(day) || []}
                techniciansById={techniciansById}
                collapsed={collapsedDays.has(day)}
                onToggleCollapsed={toggleDayCollapsed}
                onCreate={handleCreate}
                onEdit={handleEdit}
                onGenerateAgreements={handleGenerateAgreements}
                generatingRouteId={generatingRouteId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RouteManagement;
