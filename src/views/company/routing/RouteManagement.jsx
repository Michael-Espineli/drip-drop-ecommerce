import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import Select from "react-select";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const stopCount = (route) => (Array.isArray(route?.order) ? route.order.length : 0);

const routeKey = (day, techId) => `${day}::${techId}`;

const routeTitle = (route, tech, day) => route?.description || `${tech.label} ${day} Route`;

const RouteRow = ({ day, tech, route, onCreate, onEdit }) => {
  const orderedStops = Array.isArray(route?.order)
    ? [...route.order].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    : [];

  return (
    <div className="grid gap-3 border-t border-slate-100 px-4 py-3 md:grid-cols-[220px_1fr_auto] md:items-center">
      <div>
        <p className="font-semibold text-slate-900">{tech.label}</p>
        <p className="text-xs text-slate-500">{tech.workerType || tech.roleName || "Technician"}</p>
      </div>

      {route ? (
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
      ) : (
        <p className="text-sm text-slate-500">No planned route for this technician and day.</p>
      )}

      <div className="flex justify-start md:justify-end">
        <button
          type="button"
          onClick={() => (route ? onEdit(route) : onCreate(day, tech))}
          className={route
            ? "rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            : "rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}
        >
          {route ? "Edit" : "New"}
        </button>
      </div>
    </div>
  );
};

const DaySection = ({ day, technicians, routesByDayTech, onCreate, onEdit }) => {
  const routesForDay = technicians
    .map((tech) => routesByDayTech.get(routeKey(day, tech.value)))
    .filter(Boolean);
  const totalStops = routesForDay.reduce((total, route) => total + stopCount(route), 0);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{day}</h2>
          <p className="text-sm text-slate-500">{routesForDay.length} route(s), {totalStops} stop(s)</p>
        </div>
        <button
          type="button"
          onClick={() => onCreate(day)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
        >
          New Route
        </button>
      </div>

      {technicians.length ? (
        technicians.map((tech) => (
          <RouteRow
            key={`${day}-${tech.value}`}
            day={day}
            tech={tech}
            route={routesByDayTech.get(routeKey(day, tech.value))}
            onCreate={onCreate}
            onEdit={onEdit}
          />
        ))
      ) : (
        <div className="border-t border-slate-100 px-4 py-6 text-sm text-slate-500">No active company users found.</div>
      )}
    </section>
  );
};

const RouteManagement = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const navigate = useNavigate();
  const [allRoutes, setAllRoutes] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState(null);
  const [techFilter, setTechFilter] = useState(null);

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

  const visibleTechnicians = useMemo(
    () => (techFilter ? technicians.filter((tech) => tech.value === techFilter.value) : technicians),
    [technicians, techFilter]
  );

  const visibleRoutes = useMemo(
    () =>
      allRoutes.filter((route) => {
        const dayMatch = !dayFilter || route.day === dayFilter.value;
        const techMatch = !techFilter || route.techId === techFilter.value;
        return dayMatch && techMatch;
      }),
    [allRoutes, dayFilter, techFilter]
  );

  const routesByDayTech = useMemo(() => {
    const nextRoutes = new Map();
    allRoutes.forEach((route) => {
      if (route.day && route.techId) {
        nextRoutes.set(routeKey(route.day, route.techId), route);
      }
    });
    return nextRoutes;
  }, [allRoutes]);

  const totalStops = visibleRoutes.reduce((total, route) => total + stopCount(route), 0);

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

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Planned Routes</h1>
            <p className="mt-1 text-slate-600">Recurring routes organized by day and technician.</p>
          </div>
          <button
            type="button"
            onClick={() => handleCreate(null)}
            className="rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New Route
          </button>
        </header>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
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
            <p className="mt-2 text-2xl font-bold text-slate-900">{visibleTechnicians.length}</p>
          </div>
        </div>

        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[180px_1fr_1fr] md:items-center">
            <h2 className="font-semibold text-slate-800">Filters</h2>
            <Select options={dayOptions} value={dayFilter} onChange={setDayFilter} placeholder="Filter by day..." isClearable />
            <Select options={technicians} value={techFilter} onChange={setTechFilter} placeholder="Filter by technician..." isLoading={isLoading} isClearable />
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">Loading routes...</div>
        ) : (
          <div className="space-y-4">
            {visibleDays.map((day) => (
              <DaySection
                key={day}
                day={day}
                technicians={visibleTechnicians}
                routesByDayTech={routesByDayTech}
                onCreate={handleCreate}
                onEdit={handleEdit}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RouteManagement;
