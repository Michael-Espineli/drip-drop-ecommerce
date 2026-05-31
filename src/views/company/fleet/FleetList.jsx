import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { FaCarSide, FaPlus, FaRegCalendarAlt, FaSearch, FaShuttleVan, FaTruck } from "react-icons/fa";
import { MdEdit, MdLocalGasStation } from "react-icons/md";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const VEHICLE_TYPES = ["Car", "Truck", "Van"];
const VEHICLE_STATUSES = ["Active", "Retired"];

const emptyForm = {
  nickName: "",
  vehicalType: "Truck",
  year: "",
  make: "",
  model: "",
  color: "",
  plate: "",
  miles: "",
  datePurchased: "",
  status: "Active",
};

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateInputValue = (value) => {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
};

const formatDate = (value) => {
  const date = toDate(value);
  return date ? format(date, "MMM d, yyyy") : "Not set";
};

const formatMiles = (value) => {
  const miles = Number(value || 0);
  return Number.isFinite(miles) ? miles.toLocaleString() : "0";
};

const getVehicleIcon = (type, className = "h-5 w-5") => {
  if (type === "Car") return <FaCarSide className={className} />;
  if (type === "Van") return <FaShuttleVan className={className} />;
  return <FaTruck className={className} />;
};

const normalizeVehicle = (snap) => {
  const data = snap.data();
  return {
    id: snap.id,
    ...data,
    datePurchased: toDate(data?.datePurchased),
    miles: Number(data?.miles || 0),
  };
};

const getRouteDate = (route) => (
  toDate(route?.date) ||
  toDate(route?.routeDate) ||
  toDate(route?.startTime) ||
  toDate(route?.createdAt)
);

const StatCard = ({ label, value, helper }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    {helper && <p className="mt-1 text-sm text-gray-500">{helper}</p>}
  </div>
);

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

const FleetFormModal = ({ form, isEditing, onChange, onClose, onSubmit, saving }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{isEditing ? "Edit Vehicle" : "Add Vehicle"}</h2>
          <p className="text-sm text-gray-500">Matches the Fleet fields used by the iOS app.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100"
        >
          Close
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 px-6 py-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Nickname</span>
            <input
              value={form.nickName}
              onChange={(event) => onChange("nickName", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Route truck 1"
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Type</span>
            <select
              value={form.vehicalType}
              onChange={(event) => onChange("vehicalType", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Year</span>
            <input
              value={form.year}
              onChange={(event) => onChange("year", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="2024"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Make</span>
            <input
              value={form.make}
              onChange={(event) => onChange("make", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Ford"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Model</span>
            <input
              value={form.model}
              onChange={(event) => onChange("model", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="F-150"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Color</span>
            <input
              value={form.color}
              onChange={(event) => onChange("color", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="White"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Plate</span>
            <input
              value={form.plate}
              onChange={(event) => onChange("plate", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none"
              placeholder="ABC1234"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Miles</span>
            <input
              value={form.miles}
              onChange={(event) => onChange("miles", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              min="0"
              step="1"
              type="number"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Purchase Date</span>
            <input
              value={form.datePurchased}
              onChange={(event) => onChange("datePurchased", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              type="date"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-gray-700">Status</span>
            <select
              value={form.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {VEHICLE_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : isEditing ? "Save Vehicle" : "Add Vehicle"}
          </button>
        </div>
      </form>
    </div>
  </div>
);

export default function FleetList() {
  const { recentlySelectedCompany } = useContext(Context);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [recentRoutes, setRecentRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setVehicles([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const fleetRef = collection(db, "companies", recentlySelectedCompany, "vehicals");
    const unsubscribe = onSnapshot(
      fleetRef,
      (snapshot) => {
        const fleet = snapshot.docs.map(normalizeVehicle).sort((a, b) => {
          const statusCompare = (a.status || "").localeCompare(b.status || "");
          if (statusCompare !== 0) return statusCompare;
          return (a.nickName || "").localeCompare(b.nickName || "");
        });

        setVehicles(fleet);
        setSelectedVehicleId((current) => current || fleet[0]?.id || "");
        setLoading(false);
      },
      (error) => {
        console.error("Error loading fleet:", error);
        toast.error("Failed to load fleet.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [recentlySelectedCompany]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || vehicles[0] || null,
    [vehicles, selectedVehicleId]
  );

  const fetchRecentRoutes = useCallback(async () => {
    if (!recentlySelectedCompany || !selectedVehicle?.id) {
      setRecentRoutes([]);
      return;
    }

    setRoutesLoading(true);
    try {
      const routesRef = collection(db, "companies", recentlySelectedCompany, "activeRoutes");
      const routesQuery = query(routesRef, where("vehicalId", "==", selectedVehicle.id), limit(20));
      const snapshot = await getDocs(routesQuery);
      const routes = snapshot.docs
        .map((snap) => ({ id: snap.id, ...snap.data() }))
        .sort((a, b) => {
          const aDate = getRouteDate(a)?.getTime() || 0;
          const bDate = getRouteDate(b)?.getTime() || 0;
          return bDate - aDate;
        })
        .slice(0, 5);

      setRecentRoutes(routes);
    } catch (error) {
      console.error("Error loading vehicle routes:", error);
      toast.error("Failed to load recent vehicle routes.");
    } finally {
      setRoutesLoading(false);
    }
  }, [recentlySelectedCompany, selectedVehicle?.id]);

  useEffect(() => {
    fetchRecentRoutes();
  }, [fetchRecentRoutes]);

  const stats = useMemo(() => {
    const active = vehicles.filter((vehicle) => vehicle.status === "Active").length;
    const retired = vehicles.filter((vehicle) => vehicle.status === "Retired").length;
    const totalMiles = vehicles.reduce((sum, vehicle) => sum + Number(vehicle.miles || 0), 0);
    const averageMiles = vehicles.length ? Math.round(totalMiles / vehicles.length) : 0;

    return {
      total: vehicles.length,
      active,
      retired,
      averageMiles,
    };
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch = !needle || [
        vehicle.nickName,
        vehicle.vehicalType,
        vehicle.year,
        vehicle.make,
        vehicle.model,
        vehicle.color,
        vehicle.plate,
      ].some((value) => (value || "").toString().toLowerCase().includes(needle));

      const matchesStatus = statusFilter === "All" || vehicle.status === statusFilter;
      const matchesType = typeFilter === "All" || vehicle.vehicalType === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [searchTerm, statusFilter, typeFilter, vehicles]);

  const openCreateModal = () => {
    setEditingVehicle(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (vehicle) => {
    setEditingVehicle(vehicle);
    setForm({
      nickName: vehicle.nickName || "",
      vehicalType: vehicle.vehicalType || "Truck",
      year: vehicle.year || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      color: vehicle.color || "",
      plate: vehicle.plate || "",
      miles: vehicle.miles?.toString() || "",
      datePurchased: dateInputValue(vehicle.datePurchased),
      status: vehicle.status || "Active",
    });
    setShowModal(true);
  };

  const updateFormField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveVehicle = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany) {
      toast.error("Select a company before updating fleet.");
      return;
    }

    setSaving(true);
    try {
      const vehicleId = editingVehicle?.id || uuidv4();
      const purchasedDate = form.datePurchased ? new Date(`${form.datePurchased}T12:00:00`) : null;
      const payload = {
        id: vehicleId,
        nickName: form.nickName.trim(),
        vehicalType: form.vehicalType,
        year: form.year.trim(),
        make: form.make.trim(),
        model: form.model.trim(),
        color: form.color.trim(),
        plate: form.plate.trim().toUpperCase(),
        miles: Number(form.miles || 0),
        status: form.status,
        datePurchased: purchasedDate ? Timestamp.fromDate(purchasedDate) : null,
      };

      const vehicleRef = doc(db, "companies", recentlySelectedCompany, "vehicals", vehicleId);
      if (editingVehicle?.id) {
        await updateDoc(vehicleRef, payload);
        toast.success("Vehicle updated.");
      } else {
        await setDoc(vehicleRef, payload);
        setSelectedVehicleId(vehicleId);
        toast.success("Vehicle added.");
      }

      setShowModal(false);
    } catch (error) {
      console.error("Error saving vehicle:", error);
      toast.error("Failed to save vehicle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Fleet</h1>
            <p className="text-sm text-gray-500">Manage company vehicles used by iOS active routes.</p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <FaPlus className="h-4 w-4" />
            Add Vehicle
          </button>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total Vehicles" value={stats.total} helper="Company fleet records" />
          <StatCard label="Active" value={stats.active} helper="Available for routes" />
          <StatCard label="Retired" value={stats.retired} helper="Kept for history" />
          <StatCard label="Average Miles" value={formatMiles(stats.averageMiles)} helper="Across fleet" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
                <label className="relative block">
                  <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Search nickname, plate, make, model"
                  />
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="All">All statuses</option>
                  {VEHICLE_STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="All">All types</option>
                  {VEHICLE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading fleet...</div>
            ) : filteredVehicles.length === 0 ? (
              <div className="p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <FaTruck className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-lg font-bold text-gray-900">No vehicles found</h2>
                <p className="mt-1 text-sm text-gray-500">Add the first vehicle or adjust your filters.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredVehicles.map((vehicle) => {
                  const isSelected = selectedVehicle?.id === vehicle.id;
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => setSelectedVehicleId(vehicle.id)}
                      className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-gray-50 md:grid-cols-[48px_minmax(0,1fr)_150px_130px] md:items-center ${isSelected ? "bg-blue-50" : "bg-white"}`}
                    >
                      <span className={`flex h-12 w-12 items-center justify-center rounded-lg ${isSelected ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                        {getVehicleIcon(vehicle.vehicalType)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-bold text-gray-900">{vehicle.nickName || "Unnamed vehicle"}</span>
                        <span className="block truncate text-sm text-gray-500">
                          {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No make/model"}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                          <span>{vehicle.color || "No color"}</span>
                          <span>{vehicle.plate || "No plate"}</span>
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2 md:justify-end">
                        <Pill tone={vehicle.status === "Active" ? "green" : "gray"}>{vehicle.status || "Unknown"}</Pill>
                        <Pill tone="blue">{vehicle.vehicalType || "Vehicle"}</Pill>
                      </span>
                      <span className="text-sm font-semibold text-gray-700 md:text-right">
                        {formatMiles(vehicle.miles)} miles
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              {selectedVehicle ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                        {getVehicleIcon(selectedVehicle.vehicalType)}
                      </span>
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">{selectedVehicle.nickName || "Unnamed vehicle"}</h2>
                        <p className="text-sm text-gray-500">
                          {[selectedVehicle.year, selectedVehicle.make, selectedVehicle.model].filter(Boolean).join(" ") || "No make/model"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEditModal(selectedVehicle)}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <MdEdit className="h-4 w-4" />
                      Edit
                    </button>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="font-semibold text-gray-500">Status</dt>
                      <dd className="mt-1"><Pill tone={selectedVehicle.status === "Active" ? "green" : "gray"}>{selectedVehicle.status || "Unknown"}</Pill></dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Type</dt>
                      <dd className="mt-1 text-gray-900">{selectedVehicle.vehicalType || "Vehicle"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Plate</dt>
                      <dd className="mt-1 text-gray-900">{selectedVehicle.plate || "Not set"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Color</dt>
                      <dd className="mt-1 text-gray-900">{selectedVehicle.color || "Not set"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Miles</dt>
                      <dd className="mt-1 flex items-center gap-2 text-gray-900">
                        <MdLocalGasStation className="h-4 w-4 text-gray-400" />
                        {formatMiles(selectedVehicle.miles)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Purchase Date</dt>
                      <dd className="mt-1 flex items-center gap-2 text-gray-900">
                        <FaRegCalendarAlt className="h-4 w-4 text-gray-400" />
                        {formatDate(selectedVehicle.datePurchased)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="py-10 text-center text-sm text-gray-500">Select a vehicle to see details.</div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-gray-900">Recent Route Use</h2>
                {selectedVehicle && <span className="text-xs font-semibold text-gray-500">{recentRoutes.length} routes</span>}
              </div>

              {routesLoading ? (
                <div className="py-6 text-sm text-gray-500">Loading routes...</div>
              ) : recentRoutes.length === 0 ? (
                <div className="py-6 text-sm text-gray-500">No active route history found for this vehicle.</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {recentRoutes.map((route) => (
                    <div key={route.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900">{route.techName || route.companyUserName || "Unassigned route"}</p>
                          <p className="text-xs text-gray-500">{formatDate(getRouteDate(route))}</p>
                        </div>
                        <Pill tone={route.status === "Complete" || route.status === "Finished" ? "green" : "blue"}>
                          {route.status || "Active"}
                        </Pill>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-600">
                        <span>Start: {formatMiles(route.startMilage)}</span>
                        <span>End: {formatMiles(route.endMilage)}</span>
                        <span>Distance: {formatMiles(route.distanceMiles)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>

      {showModal && (
        <FleetFormModal
          form={form}
          isEditing={Boolean(editingVehicle)}
          onChange={updateFormField}
          onClose={() => setShowModal(false)}
          onSubmit={saveVehicle}
          saving={saving}
        />
      )}
    </div>
  );
}
