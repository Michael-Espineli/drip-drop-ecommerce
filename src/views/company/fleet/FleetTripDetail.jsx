import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { FaArrowLeft, FaCarSide, FaMapMarkedAlt, FaRegClock } from "react-icons/fa";
import { MdLocalGasStation } from "react-icons/md";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Not set";
};

const formatDateTime = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not set";
};

const formatMiles = (value) => {
  const miles = Number(value || 0);
  return Number.isFinite(miles) ? miles.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "0";
};

const routeDistance = (route) => {
  const storedDistance = Number(route?.distanceMiles ?? route?.distance ?? NaN);
  if (Number.isFinite(storedDistance) && storedDistance > 0) return storedDistance;

  const start = Number(route?.startMilage ?? route?.startMileage ?? NaN);
  const end = Number(route?.endMilage ?? route?.endMileage ?? NaN);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;

  return 0;
};

const routeWorkerName = (route) => (
  route?.techName ||
  route?.companyUserName ||
  route?.userName ||
  route?.tech ||
  "Unassigned route"
);

const stopTitle = (stop) => (
  stop?.customerName ||
  stop?.jobName ||
  stop?.name ||
  "Service stop"
);

const stopAddress = (stop) => (
  stop?.address?.streetAddress ||
  stop?.address?.formattedAddress ||
  stop?.address?.address ||
  stop?.serviceLocationAddress ||
  "Address not set"
);

const StatusPill = ({ children, tone = "slate" }) => {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
};

const MetricCard = ({ icon: Icon, label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start gap-3">
      <span className="rounded-md bg-blue-50 p-2 text-blue-700">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
      </div>
    </div>
  </div>
);

export default function FleetTripDetail() {
  const { routeId } = useParams();
  const { recentlySelectedCompany } = useContext(Context);
  const [route, setRoute] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [stops, setStops] = useState([]);
  const [logs, setLogs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadTrip = async () => {
      if (!recentlySelectedCompany || !routeId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const routeRef = doc(db, "companies", recentlySelectedCompany, "activeRoutes", routeId);
        const routeSnap = await getDoc(routeRef);

        if (!routeSnap.exists()) {
          setRoute(null);
          setError("Trip not found.");
          return;
        }

        const routeData = { id: routeSnap.id, ...routeSnap.data() };
        setRoute(routeData);

        const vehicleId = routeData.vehicalId || routeData.vehicleId;
        const [stopSnaps, logsSnap, locationsSnap, vehicleSnap] = await Promise.all([
          Promise.all((routeData.serviceStopsIds || []).map((stopId) => (
            getDoc(doc(db, "companies", recentlySelectedCompany, "serviceStops", stopId))
          ))),
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "activeRouteLogs"),
            where("activeRouteId", "==", routeId)
          )),
          getDocs(query(
            collection(db, "companies", recentlySelectedCompany, "activeRouteLocations"),
            where("activeRouteId", "==", routeId)
          )),
          vehicleId
            ? getDoc(doc(db, "companies", recentlySelectedCompany, "vehicals", vehicleId))
            : Promise.resolve(null),
        ]);

        const stopsById = new Map(
          stopSnaps
            .filter((snap) => snap.exists())
            .map((snap) => [snap.id, { id: snap.id, ...snap.data() }])
        );
        const orderedStops = (routeData.serviceStopsIds || [])
          .map((stopId) => stopsById.get(stopId))
          .filter(Boolean);

        setStops(orderedStops);
        setLogs(logsSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => (toDate(a.startTime)?.getTime() || 0) - (toDate(b.startTime)?.getTime() || 0)));
        setLocations(locationsSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => (toDate(a.time)?.getTime() || 0) - (toDate(b.time)?.getTime() || 0)));
        setVehicle(vehicleSnap?.exists?.() ? { id: vehicleSnap.id, ...vehicleSnap.data() } : null);
      } catch (loadError) {
        console.error("Error loading fleet trip detail:", loadError);
        setError("Could not load trip details.");
      } finally {
        setLoading(false);
      }
    };

    loadTrip();
  }, [recentlySelectedCompany, routeId]);

  const latestLocation = locations[locations.length - 1] || null;
  const vehicleLabel = useMemo(() => (
    vehicle?.nickName ||
    route?.vehicleLabel ||
    [route?.vehicleMake, route?.vehicleModel].filter(Boolean).join(" ") ||
    "Vehicle not set"
  ), [route, vehicle]);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 px-2 py-6 text-sm text-slate-500 sm:px-3 lg:px-4">Loading trip details...</div>;
  }

  if (error || !route) {
    return (
      <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <p className="font-bold">{error || "Trip not found."}</p>
          <Link to="/company/fleet" className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-900">
            Back to Fleet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <Link to="/company/fleet" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700">
          <FaArrowLeft className="h-3 w-3" />
          Back to Fleet
        </Link>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{formatDate(route.date || route.routeDate || route.startTime)}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-950">{route.name || routeWorkerName(route)}</h1>
              <p className="mt-2 text-sm text-slate-500">{vehicleLabel} · {routeWorkerName(route)}</p>
            </div>
            <StatusPill tone={route.status === "Finished" || route.status === "Complete" ? "emerald" : "blue"}>
              {route.status || "Active"}
            </StatusPill>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard icon={FaCarSide} label="Vehicle" value={vehicleLabel} />
          <MetricCard icon={MdLocalGasStation} label="Distance" value={`${formatMiles(routeDistance(route))} miles`} />
          <MetricCard icon={FaRegClock} label="Stops" value={`${route.finishedStops || 0}/${route.totalStops || stops.length || 0}`} />
          <MetricCard icon={FaMapMarkedAlt} label="GPS Points" value={locations.length} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-950">Service Stops</h2>
              <p className="text-sm text-slate-500">Stops recorded on this trip.</p>
            </div>
            {stops.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No service stops were attached to this trip.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {stops.map((stop, index) => (
                  <Link key={stop.id} to={`/company/serviceStops/detail/${stop.id}`} className="block px-5 py-4 transition hover:bg-slate-50">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{stopTitle(stop)}</p>
                        <p className="mt-1 truncate text-sm text-slate-500">{stopAddress(stop)}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-400">{stop.operationStatus || stop.status || "Status not set"}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Mileage</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-semibold text-slate-500">Start</dt>
                  <dd className="mt-1 text-slate-950">{formatMiles(route.startMilage ?? route.startMileage)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">End</dt>
                  <dd className="mt-1 text-slate-950">{formatMiles(route.endMilage ?? route.endMileage)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Started</dt>
                  <dd className="mt-1 text-slate-950">{formatDateTime(route.startTime)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Ended</dt>
                  <dd className="mt-1 text-slate-950">{formatDateTime(route.endTime)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Activity</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="font-semibold text-slate-900">{logs.length} route log(s)</p>
                  <p className="mt-1 text-slate-500">{logs[0] ? formatDateTime(logs[0].startTime) : "No logs recorded"}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="font-semibold text-slate-900">Last GPS point</p>
                  <p className="mt-1 text-slate-500">{latestLocation ? formatDateTime(latestLocation.time) : "No GPS points recorded"}</p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
