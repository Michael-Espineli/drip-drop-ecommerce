import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { format } from "date-fns";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { FaArrowLeft, FaCarSide, FaRegCalendarAlt, FaShuttleVan, FaTruck } from "react-icons/fa";
import { MdLocalGasStation } from "react-icons/md";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const HISTORY_TRIP_LIMIT = 100;

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateInputFromDate = (date) => format(date, "yyyy-MM-dd");

const defaultHistoryStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return dateInputFromDate(date);
};

const todayDateInput = () => dateInputFromDate(new Date());

const dateInputToLocalDate = (value, endOfDay = false) => {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
};

const formatDate = (value) => {
  const date = toDate(value);
  return date ? format(date, "MMM d, yyyy") : "Not set";
};

const formatMiles = (value) => {
  const miles = Number(value || 0);
  return Number.isFinite(miles) ? miles.toLocaleString() : "0";
};

const formatTripMiles = (value) => {
  const miles = Number(value || 0);
  return Number.isFinite(miles)
    ? miles.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "0";
};

const routeDistance = (route) => {
  const storedDistance = Number(route?.distanceMiles ?? route?.distance ?? NaN);
  if (Number.isFinite(storedDistance) && storedDistance > 0) return storedDistance;

  const start = Number(route?.startMilage ?? route?.startMileage ?? NaN);
  const end = Number(route?.endMilage ?? route?.endMileage ?? NaN);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;

  return 0;
};

const getRouteDate = (route) => (
  toDate(route?.date) ||
  toDate(route?.routeDate) ||
  toDate(route?.startTime) ||
  toDate(route?.createdAt)
);

const routeWorkerName = (route) => (
  route?.techName ||
  route?.companyUserName ||
  route?.userName ||
  route?.tech ||
  "Unassigned route"
);

const getVehicleIcon = (type, className = "h-5 w-5") => {
  if (type === "Car") return <FaCarSide className={className} />;
  if (type === "Van") return <FaShuttleVan className={className} />;
  return <FaTruck className={className} />;
};

const tripDetailPath = (route) => `/company/fleet/trips/${route.id}`;

const Pill = ({ children, tone = "gray" }) => {
  const tones = {
    green: "bg-green-100 text-green-800",
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-800",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
};

const routeStatusTone = (status) => (
  status === "Complete" || status === "Finished" ? "green" : "blue"
);

export default function FleetVehicleDetail() {
  const { vehicleId } = useParams();
  const { recentlySelectedCompany } = useContext(Context);
  const [vehicle, setVehicle] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [error, setError] = useState("");
  const [routeFilterError, setRouteFilterError] = useState("");
  const [historyStartDate, setHistoryStartDate] = useState(defaultHistoryStartDate);
  const [historyEndDate, setHistoryEndDate] = useState(todayDateInput);
  const [historyRequest, setHistoryRequest] = useState(() => ({
    startDate: defaultHistoryStartDate(),
    endDate: todayDateInput(),
  }));
  const [loadedHistoryLabel, setLoadedHistoryLabel] = useState("");

  useEffect(() => {
    const loadVehicle = async () => {
      if (!recentlySelectedCompany || !vehicleId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const vehicleSnap = await getDoc(doc(db, "companies", recentlySelectedCompany, "vehicals", vehicleId));

        if (!vehicleSnap.exists()) {
          setVehicle(null);
          setError("Vehicle not found.");
          return;
        }

        const data = vehicleSnap.data();
        setVehicle({
          id: vehicleSnap.id,
          ...data,
          datePurchased: toDate(data?.datePurchased),
          miles: Number(data?.miles || 0),
        });
      } catch (loadError) {
        console.error("Error loading fleet vehicle:", loadError);
        setError("Could not load vehicle details.");
      } finally {
        setLoading(false);
      }
    };

    loadVehicle();
  }, [recentlySelectedCompany, vehicleId]);

  const loadHistoryRoutes = useCallback(async () => {
    if (!recentlySelectedCompany || !vehicleId) {
      setRoutes([]);
      return;
    }

    const startDate = dateInputToLocalDate(historyRequest.startDate);
    const endDate = dateInputToLocalDate(historyRequest.endDate, true);

    if (!startDate || !endDate) {
      setRoutes([]);
      setLoadedHistoryLabel("");
      setRouteFilterError("Choose a start and end date before loading all trip history.");
      return;
    }

    if (startDate > endDate) {
      setRoutes([]);
      setLoadedHistoryLabel("");
      setRouteFilterError("Start date must be before the end date.");
      return;
    }

    setRoutesLoading(true);
    setRouteFilterError("");

    try {
      const routesRef = collection(db, "companies", recentlySelectedCompany, "activeRoutes");
      const buildRouteQuery = (vehicleField) => query(
        routesRef,
        where(vehicleField, "==", vehicleId),
        where("date", ">=", Timestamp.fromDate(startDate)),
        where("date", "<=", Timestamp.fromDate(endDate)),
        orderBy("date", "desc"),
        limit(HISTORY_TRIP_LIMIT)
      );

      const [legacySnapshot, vehicleSnapshot] = await Promise.all([
        getDocs(buildRouteQuery("vehicalId")),
        getDocs(buildRouteQuery("vehicleId")),
      ]);

      const routesById = new Map();
      [...legacySnapshot.docs, ...vehicleSnapshot.docs].forEach((snap) => {
        routesById.set(snap.id, { id: snap.id, ...snap.data() });
      });

      const nextRoutes = [...routesById.values()]
        .sort((a, b) => {
          const aDate = getRouteDate(a)?.getTime() || 0;
          const bDate = getRouteDate(b)?.getTime() || 0;
          return bDate - aDate;
        })
        .slice(0, HISTORY_TRIP_LIMIT);

      setRoutes(nextRoutes);
      setLoadedHistoryLabel(`${formatDate(startDate)} - ${formatDate(endDate)}`);
    } catch (loadError) {
      console.error("Error loading vehicle trip history:", loadError);
      toast.error("Failed to load vehicle trip history.");
      setRouteFilterError("Could not load trips. Try a smaller date range or check the route indexes.");
    } finally {
      setRoutesLoading(false);
    }
  }, [historyRequest.endDate, historyRequest.startDate, recentlySelectedCompany, vehicleId]);

  useEffect(() => {
    loadHistoryRoutes();
  }, [loadHistoryRoutes]);

  const historyStats = useMemo(() => {
    const totalMiles = routes.reduce((sum, route) => sum + routeDistance(route), 0);
    const lastRoute = routes[0] || null;

    return {
      tripCount: routes.length,
      totalMiles,
      lastUsed: lastRoute ? formatDate(getRouteDate(lastRoute)) : "No trips",
    };
  }, [routes]);

  const applyHistoryFilters = () => {
    const startDate = dateInputToLocalDate(historyStartDate);
    const endDate = dateInputToLocalDate(historyEndDate, true);

    if (!startDate || !endDate) {
      setRouteFilterError("Choose a start and end date before loading all trip history.");
      setRoutes([]);
      setLoadedHistoryLabel("");
      return;
    }

    if (startDate > endDate) {
      setRouteFilterError("Start date must be before the end date.");
      setRoutes([]);
      setLoadedHistoryLabel("");
      return;
    }

    setHistoryRequest({
      startDate: historyStartDate,
      endDate: historyEndDate,
    });
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 px-2 py-6 text-sm text-gray-500 sm:px-3 lg:px-4">Loading vehicle details...</div>;
  }

  if (error || !vehicle) {
    return (
      <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <p className="font-bold">{error || "Vehicle not found."}</p>
          <Link to="/company/fleet" className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-900">
            Back to Fleet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-2 py-6 text-gray-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <Link to="/company/fleet" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-blue-700">
          <FaArrowLeft className="h-3 w-3" />
          Back to Fleet
        </Link>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                {getVehicleIcon(vehicle.vehicalType, "h-7 w-7")}
              </span>
              <div>
                <h1 className="text-3xl font-bold text-gray-950">{vehicle.nickName || "Unnamed vehicle"}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No make/model"}
                </p>
              </div>
            </div>
            <Pill tone={vehicle.status === "Active" ? "green" : "gray"}>{vehicle.status || "Unknown"}</Pill>
          </div>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <dt className="font-semibold text-gray-500">Type</dt>
              <dd className="mt-1 text-gray-950">{vehicle.vehicalType || "Vehicle"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-500">Plate</dt>
              <dd className="mt-1 text-gray-950">{vehicle.plate || "Not set"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-500">Color</dt>
              <dd className="mt-1 text-gray-950">{vehicle.color || "Not set"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-500">Miles</dt>
              <dd className="mt-1 flex items-center gap-2 text-gray-950">
                <MdLocalGasStation className="h-4 w-4 text-gray-400" />
                {formatMiles(vehicle.miles)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-500">Purchase Date</dt>
              <dd className="mt-1 flex items-center gap-2 text-gray-950">
                <FaRegCalendarAlt className="h-4 w-4 text-gray-400" />
                {formatDate(vehicle.datePurchased)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Trips Loaded</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{historyStats.tripCount}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Trip Miles</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{formatTripMiles(historyStats.totalMiles)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last Used</p>
            <p className="mt-2 text-lg font-bold text-gray-900">{historyStats.lastUsed}</p>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">All Trip History</h2>
              <p className="text-sm text-gray-500">
                Date-filtered vehicle trips{loadedHistoryLabel ? ` for ${loadedHistoryLabel}` : ""}.
              </p>
            </div>
            <span className="text-xs font-semibold text-gray-500">Results capped at {HISTORY_TRIP_LIMIT} trips</span>
          </div>

          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Start Date</span>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(event) => setHistoryStartDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">End Date</span>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={(event) => setHistoryEndDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={applyHistoryFilters}
                disabled={routesLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {routesLoading ? "Loading..." : "Load trips"}
              </button>
            </div>
          </div>

          {routeFilterError && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              {routeFilterError}
            </div>
          )}

          {routesLoading ? (
            <div className="py-8 text-sm text-gray-500">Loading trips...</div>
          ) : routes.length === 0 ? (
            <div className="py-8 text-sm text-gray-500">No trips found for this date range.</div>
          ) : (
            <div className="mt-5 space-y-3">
              {routes.map((route) => (
                <div key={route.id} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{routeWorkerName(route)}</p>
                      <p className="text-xs text-gray-500">{formatDate(getRouteDate(route))}</p>
                    </div>
                    <Pill tone={routeStatusTone(route.status)}>
                      {route.status || "Active"}
                    </Pill>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
                    <span>Start: {formatMiles(route.startMilage ?? route.startMileage)}</span>
                    <span>End: {formatMiles(route.endMilage ?? route.endMileage)}</span>
                    <span>Distance: {formatTripMiles(routeDistance(route))}</span>
                  </div>
                  <Link
                    to={tripDetailPath(route)}
                    className="mt-3 inline-flex items-center text-xs font-bold text-blue-700 hover:text-blue-900"
                  >
                    View trip details
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
