import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  BeakerIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { collection, getDocs } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const emptyFilters = {
  search: "",
  startDate: "",
  endDate: "",
  source: "all",
};

const arrayValue = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
};

const stringValue = (value, fallback = "-") => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateTimestamp = (value) => {
  const date = toDate(value);
  return date ? date.getTime() : 0;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatDateInput = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const getFullName = (user = {}) =>
  [
    user.firstName,
    user.lastName,
  ].filter(Boolean).join(" ") ||
  user.fullName ||
  user.name ||
  user.displayName ||
  user.email ||
  "";

const getServiceLocationLabel = (location = {}) =>
  location.nickName ||
  location.name ||
  location.address?.streetAddress ||
  location.streetAddress ||
  (typeof location.address === "string" ? location.address : "") ||
  "";

const getBodyOfWaterLabel = (body = {}) =>
  body.name ||
  body.nickName ||
  body.type ||
  body.bodyOfWaterType ||
  "";

const itemName = (item = {}, fallback = "Item") =>
  item.name ||
  item.templateName ||
  item.readingName ||
  item.dosageName ||
  item.chemType ||
  fallback;

const itemAmount = (item = {}) => {
  const amount = item.amount ?? item.value ?? item.quantity ?? "";
  const uom = item.UOM || item.uom || item.unit || "";
  return [amount, uom].filter((value) => value !== undefined && value !== null && value !== "").join(" ");
};

const previewItems = (items = [], fallback = "Item") => {
  if (!items.length) return "-";

  const visible = items.slice(0, 2).map((item) => {
    const amount = itemAmount(item);
    return amount ? `${itemName(item, fallback)} ${amount}` : itemName(item, fallback);
  });

  return items.length > visible.length
    ? `${visible.join(", ")} +${items.length - visible.length}`
    : visible.join(", ");
};

const normalizedItemSignature = (items = []) =>
  items
    .map((item) => [
      item.id || "",
      item.templateId || "",
      item.universalTemplateId || "",
      itemName(item, ""),
      itemAmount(item),
    ].join(":"))
    .sort()
    .join("|");

const stopDataSignature = (record = {}) => [
  record.serviceStopId || "",
  record.bodyOfWaterId || "",
  dateTimestamp(record.date || record.createdAt || record.updatedAt),
  normalizedItemSignature(arrayValue(record.readings)),
  normalizedItemSignature(arrayValue(record.dosages)),
].join("::");

const mergeStopDataRecords = (companyRecords = [], storeRecords = []) => {
  const byId = new Map();
  const signatures = new Set();
  const merged = [];

  companyRecords.forEach((record) => {
    const key = record.id ? `id:${record.id}` : `signature:${stopDataSignature(record)}`;
    byId.set(key, record);
    signatures.add(stopDataSignature(record));
    merged.push(record);
  });

  storeRecords.forEach((record) => {
    const idKey = record.id ? `id:${record.id}` : "";
    const signature = stopDataSignature(record);

    if ((idKey && byId.has(idKey)) || signatures.has(signature)) return;

    if (idKey) byId.set(idKey, record);
    signatures.add(signature);
    merged.push(record);
  });

  return merged.sort((a, b) => dateTimestamp(b.date || b.createdAt) - dateTimestamp(a.date || a.createdAt));
};

const fetchCollectionMap = async (companyId, collectionName) => {
  try {
    const snapshot = await getDocs(collection(db, "companies", companyId, collectionName));
    return new Map(snapshot.docs.map((itemDoc) => [itemDoc.id, { id: itemDoc.id, ...itemDoc.data() }]));
  } catch (error) {
    console.warn(`Could not load ${collectionName} for stop data enrichment:`, error);
    return new Map();
  }
};

const enrichRecord = ({ record, source, serviceStop = {}, maps }) => {
  const resolvedServiceStopId = record.serviceStopId || serviceStop.id || "";
  const resolvedCustomerId = record.customerId || serviceStop.customerId || "";
  const resolvedLocationId = record.serviceLocationId || serviceStop.serviceLocationId || "";
  const resolvedUserId = record.userId || record.techId || serviceStop.techId || "";
  const customer = maps.customers.get(resolvedCustomerId) || {};
  const serviceLocation = maps.serviceLocations.get(resolvedLocationId) || {};
  const bodyOfWater = maps.bodiesOfWater.get(record.bodyOfWaterId) || {};
  const tech = maps.companyUsers.get(resolvedUserId) || {};

  return {
    ...record,
    id: record.id || `${source}-${resolvedServiceStopId || "stop"}-${record.bodyOfWaterId || "body"}-${dateTimestamp(record.date || record.createdAt)}`,
    source,
    serviceStopId: resolvedServiceStopId,
    customerId: resolvedCustomerId,
    serviceLocationId: resolvedLocationId,
    userId: resolvedUserId,
    readings: arrayValue(record.readings),
    dosages: arrayValue(record.dosages),
    observation: arrayValue(record.observation || record.observations),
    equipmentMeasurements: arrayValue(record.equipmentMeasurements),
    date: record.date || serviceStop.serviceDate || serviceStop.date || record.createdAt || record.updatedAt,
    customerName: record.customerName || serviceStop.customerName || customer.fullName || customer.name || customer.companyName || "",
    serviceLocationName: record.serviceLocationName || serviceStop.serviceLocationName || getServiceLocationLabel(serviceLocation),
    bodyOfWaterName: record.bodyOfWaterName || getBodyOfWaterLabel(bodyOfWater),
    techName: record.techName || record.userName || serviceStop.tech || getFullName(tech),
    serviceStop,
  };
};

const Stat = ({ label, value }) => (
  <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
  </div>
);

const DetailRow = ({ label, value }) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{stringValue(value)}</dd>
  </div>
);

const DataList = ({ title, items, fallback }) => (
  <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-sm font-bold text-slate-900">{title}</h4>
      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{items.length}</span>
    </div>
    {items.length ? (
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item.id || item.templateId || title}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">{itemName(item, fallback)}</p>
                {(item.templateId || item.universalTemplateId) && (
                  <p className="mt-1 text-xs text-slate-500">
                    {[item.templateId, item.universalTemplateId].filter(Boolean).join(" / ")}
                  </p>
                )}
              </div>
              <p className="text-sm font-bold text-slate-900">{itemAmount(item) || "-"}</p>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-sm text-slate-500">No {title.toLowerCase()} found.</p>
    )}
  </section>
);

const StopDataDetailModal = ({ record, onClose }) => {
  if (!record) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-data-detail-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-cyan-700">Stop Data</p>
            <h2 id="stop-data-detail-title" className="text-2xl font-bold text-slate-950">
              {record.customerName || "Service Stop"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{formatDateTime(record.date)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close stop data detail"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-89px)] overflow-y-auto p-5">
          <dl className="grid gap-4 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailRow label="Customer" value={record.customerName} />
            <DetailRow label="Service Location" value={record.serviceLocationName} />
            <DetailRow label="Body Of Water" value={record.bodyOfWaterName || record.bodyOfWaterId} />
            <DetailRow label="Technician" value={record.techName || record.userId} />
            <DetailRow label="Service Stop" value={record.serviceStopId} />
            <DetailRow label="Record ID" value={record.id} />
            <DetailRow label="Source" value={record.source === "stores" ? "Service Stop Stores" : "Company Stop Data"} />
            <DetailRow label="Equipment Measurements" value={record.equipmentMeasurements.length} />
          </dl>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <DataList title="Readings" items={record.readings} fallback="Reading" />
            <DataList title="Dosages" items={record.dosages} fallback="Dosage" />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-bold text-slate-900">Observations</h4>
              {record.observation.length ? (
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {record.observation.map((observation, index) => (
                    <li key={`${observation}-${index}`} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      {observation}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No observations found.</p>
              )}
            </section>

            <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-bold text-slate-900">Equipment Measurements</h4>
              {record.equipmentMeasurements.length ? (
                <div className="mt-3 space-y-2">
                  {record.equipmentMeasurements.map((measurement, index) => (
                    <div key={`${measurement.id || measurement.equipmentId || "measurement"}-${index}`} className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">{measurement.equipmentName || measurement.equipmentId || "Equipment"}</p>
                      <p className="mt-1">
                        {[
                          measurement.status,
                          measurement.poundForcePerSquareInch ? `${measurement.poundForcePerSquareInch} PSI` : "",
                          measurement.revolutionsPerMinute ? `${measurement.revolutionsPerMinute} RPM` : "",
                        ].filter(Boolean).join(" / ") || "Measurement captured"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No equipment measurements found.</p>
              )}
            </section>
          </div>

          {record.serviceStopId && (
            <div className="mt-5 flex justify-end">
              <Link
                to={`/company/serviceStops/detail/${record.serviceStopId}`}
                className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Open Service Stop
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StopData = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const [records, setRecords] = useState([]);
  const [serviceStopCount, setServiceStopCount] = useState(0);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const loadStopData = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setRecords([]);
      setServiceStopCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [
        companyStopDataSnap,
        serviceStopsSnap,
        customers,
        serviceLocations,
        bodiesOfWater,
        companyUsers,
      ] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "stopData")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "serviceStops")).catch((error) => {
          console.warn("Could not load service stops for stop data enrichment:", error);
          return { docs: [] };
        }),
        fetchCollectionMap(recentlySelectedCompany, "customers"),
        fetchCollectionMap(recentlySelectedCompany, "serviceLocations"),
        fetchCollectionMap(recentlySelectedCompany, "bodiesOfWater"),
        fetchCollectionMap(recentlySelectedCompany, "companyUsers"),
      ]);

      const maps = { customers, serviceLocations, bodiesOfWater, companyUsers };
      const serviceStops = serviceStopsSnap.docs.map((serviceStopDoc) => ({
        id: serviceStopDoc.id,
        ...serviceStopDoc.data(),
      }));
      const serviceStopsById = new Map(serviceStops.map((serviceStop) => [serviceStop.id, serviceStop]));

      const companyRecords = companyStopDataSnap.docs.map((itemDoc) => {
        const record = { id: itemDoc.id, ...itemDoc.data() };
        return enrichRecord({
          record,
          source: "companyStopData",
          serviceStop: serviceStopsById.get(record.serviceStopId) || {},
          maps,
        });
      });

      const storeResults = await Promise.allSettled(
        serviceStops.map(async (serviceStop) => {
          const storeSnap = await getDocs(
            collection(db, "companies", recentlySelectedCompany, "serviceStops", serviceStop.id, "stores")
          );

          return storeSnap.docs.map((storeDoc) => enrichRecord({
            record: {
              id: storeDoc.id,
              ...storeDoc.data(),
              serviceStopId: storeDoc.data().serviceStopId || serviceStop.id,
            },
            source: "stores",
            serviceStop,
            maps,
          }));
        })
      );

      const storeRecords = storeResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );
      const failedStoreReads = storeResults.filter((result) => result.status === "rejected").length;

      if (failedStoreReads) {
        console.warn(`Failed to load ${failedStoreReads} stop data store collection(s).`);
      }

      setServiceStopCount(serviceStops.length);
      setRecords(mergeStopDataRecords(companyRecords, storeRecords));
    } catch (error) {
      console.error("Failed to load stop data:", error);
      toast.error("Could not load stop data.");
      setRecords([]);
      setServiceStopCount(0);
    } finally {
      setLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadStopData();
  }, [loadStopData]);

  const filteredRecords = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const start = filters.startDate ? new Date(`${filters.startDate}T00:00:00`).getTime() : null;
    const end = filters.endDate ? new Date(`${filters.endDate}T23:59:59`).getTime() : null;

    return records.filter((record) => {
      const recordTime = dateTimestamp(record.date);
      const sourceMatches = filters.source === "all" || record.source === filters.source;
      const dateMatches =
        (!start || recordTime >= start) &&
        (!end || recordTime <= end);
      const searchText = [
        record.customerName,
        record.serviceLocationName,
        record.bodyOfWaterName,
        record.techName,
        record.serviceStopId,
        record.id,
        ...record.readings.map((reading) => itemName(reading, "Reading")),
        ...record.dosages.map((dosage) => itemName(dosage, "Dosage")),
      ].join(" ").toLowerCase();

      return sourceMatches && dateMatches && (!search || searchText.includes(search));
    });
  }, [filters, records]);

  const stats = useMemo(() => {
    const readingCount = records.reduce((total, record) => total + record.readings.length, 0);
    const dosageCount = records.reduce((total, record) => total + record.dosages.length, 0);
    const nestedCount = records.filter((record) => record.source === "stores").length;

    return {
      records: records.length,
      readings: readingCount,
      dosages: dosageCount,
      nested: nestedCount,
    };
  }, [records]);

  const latestRecordDate = records.length ? formatDate(records[0].date) : "-";
  const today = formatDateInput(new Date());

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <Link to="/company/settings" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            Settings
          </Link>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <BeakerIcon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-950">Stop Data</h1>
                <p className="mt-1 text-sm text-slate-500">Readings, dosages, observations, and equipment measurements captured during service stops.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadStopData}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowPathIcon className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Records" value={stats.records} />
          <Stat label="Readings" value={stats.readings} />
          <Stat label="Dosages" value={stats.dosages} />
          <Stat label="Nested Stores" value={stats.nested} />
          <Stat label="Latest" value={latestRecordDate} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_160px_160px_170px_auto] lg:items-end">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Search</span>
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  placeholder="Customer, location, tech, service stop"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Start</span>
              <input
                type="date"
                max={filters.endDate || today}
                value={filters.startDate}
                onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">End</span>
              <input
                type="date"
                min={filters.startDate}
                max={today}
                value={filters.endDate}
                onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Source</span>
              <select
                value={filters.source}
                onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              >
                <option value="all">All Sources</option>
                <option value="companyStopData">Company Stop Data</option>
                <option value="stores">Service Stop Stores</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setFilters(emptyFilters)}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Stop Data Table</h2>
              <p className="text-sm text-slate-500">{filteredRecords.length} visible from {records.length} records across {serviceStopCount} service stops.</p>
            </div>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading stop data...</div>
          ) : filteredRecords.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Body Of Water</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Technician</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Readings</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Dosages</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredRecords.map((record) => (
                    <tr key={`${record.source}-${record.id}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">{formatDate(record.date)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{stringValue(record.customerName)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{stringValue(record.serviceLocationName)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{stringValue(record.bodyOfWaterName || record.bodyOfWaterId)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{stringValue(record.techName || record.userId)}</td>
                      <td className="min-w-[220px] px-4 py-3 text-sm text-slate-700">{previewItems(record.readings, "Reading")}</td>
                      <td className="min-w-[220px] px-4 py-3 text-sm text-slate-700">{previewItems(record.dosages, "Dosage")}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {record.source === "stores" ? "Stores" : "Stop Data"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedRecord(record)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-cyan-700 transition hover:bg-cyan-50 hover:text-cyan-900"
                          aria-label={`View stop data for ${record.customerName || record.serviceStopId || record.id}`}
                        >
                          <EyeIcon className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <h3 className="text-lg font-semibold text-slate-950">No stop data found</h3>
              <p className="mt-1 text-sm text-slate-500">Try changing the filters or refreshing the selected company data.</p>
            </div>
          )}
        </section>
      </div>

      <StopDataDetailModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
};

export default StopData;
