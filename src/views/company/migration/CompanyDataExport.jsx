import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { collection, getDocs } from "firebase/firestore";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BeakerIcon,
  ClipboardDocumentCheckIcon,
  DocumentTextIcon,
  MapPinIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  MURDOCK_POOL_SERVICE_ONLY_LABEL,
  TARGET_PERFORMANCE_IMPORT_COMPANY_ID,
  getCompanyUserDisplayName,
} from "./performanceHistoryImportUtils";

const EXPORT_TYPES = {
  "customer-export": {
    title: "Customer Export",
    eyebrow: "Data Export",
    description: "Customer records, contact fields, tags, billing addresses, and migration metadata.",
    filePrefix: "customer_export",
    icon: UserGroupIcon,
    supportsInactive: true,
    loader: loadCustomerExport,
  },
  "service-location-export": {
    title: "Service Location Export",
    eyebrow: "Data Export",
    description: "Service locations, linked pools, route details, rates, access notes, and customer joins.",
    filePrefix: "service_location_export",
    icon: MapPinIcon,
    supportsInactive: true,
    loader: loadServiceLocationExport,
  },
  "equipment-export": {
    title: "Equipment Export",
    eyebrow: "Data Export",
    description: "Equipment records, service settings, linked customers, locations, pools, and equipment parts.",
    filePrefix: "equipment_export",
    icon: WrenchScrewdriverIcon,
    supportsInactive: true,
    loader: loadEquipmentExport,
  },
  "service-history-export": {
    title: "Service History Export",
    eyebrow: "Data Export",
    description: "Stop data, readings, dosages, observations, equipment measurements, and service stop joins.",
    filePrefix: "service_history_export",
    icon: BeakerIcon,
    supportsDateRange: true,
    loader: loadServiceHistoryExport,
  },
  "performance-history-export": {
    title: "Performance History Export",
    eyebrow: "Data Export",
    description: "Technician performance reviews and imported performance history records.",
    filePrefix: "performance_history_export",
    icon: ClipboardDocumentCheckIcon,
    targetCompanyOnly: true,
    loader: loadPerformanceHistoryExport,
  },
};

const DEFAULT_OPTIONS = {
  includeInactive: true,
  includeInternalIds: true,
  includeMigrationMetadata: true,
  startDate: "",
  endDate: "",
};

const EMPTY_ROWS = [];

const toneClasses = {
  slate: "border-slate-200 bg-white text-slate-900",
  blue: "border-blue-200 bg-blue-50 text-blue-900",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
};

function CompanyDataExport({ exportType: exportTypeOverride = "" }) {
  const { exportType: routeExportType } = useParams();
  const exportType = exportTypeOverride || routeExportType;
  const { recentlySelectedCompany } = useContext(Context);
  const config = EXPORT_TYPES[exportType];
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [exportPackage, setExportPackage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(() => {
    setOptions(DEFAULT_OPTIONS);
    setExportPackage(null);
    setLoadedAt(null);
  }, [exportType]);

  const loadExport = useCallback(async () => {
    if (!config || !recentlySelectedCompany) {
      setExportPackage(null);
      return;
    }

    if (config.targetCompanyOnly && recentlySelectedCompany !== TARGET_PERFORMANCE_IMPORT_COMPANY_ID) {
      setExportPackage(null);
      return;
    }

    setLoading(true);
    try {
      const nextPackage = await config.loader(recentlySelectedCompany, options);
      setExportPackage(nextPackage);
      setLoadedAt(new Date());
    } catch (error) {
      console.error(`Failed to load ${config.title}:`, error);
      toast.error(`Could not load ${config.title.toLowerCase()}.`);
      setExportPackage(null);
    } finally {
      setLoading(false);
    }
  }, [config, options, recentlySelectedCompany]);

  useEffect(() => {
    loadExport();
  }, [loadExport]);

  const previewRows = exportPackage?.previewRows || EMPTY_ROWS;
  const previewHeaders = useMemo(() => {
    if (exportPackage?.previewHeaders?.length) return exportPackage.previewHeaders;
    if (!previewRows.length) return [];
    return Object.keys(previewRows[0]).slice(0, 8);
  }, [exportPackage?.previewHeaders, previewRows]);

  const Icon = config?.icon || DocumentTextIcon;

  if (!config) {
    return <Navigate to="/company/settings" replace />;
  }

  const updateOption = (option, value) => {
    setOptions((current) => ({ ...current, [option]: value }));
  };

  const handleDownload = () => {
    if (!exportPackage?.sheets?.length) {
      toast.error("Load export data before downloading.");
      return;
    }

    writeWorkbook(exportPackage.sheets, `${config.filePrefix}_${dateInputValue(new Date())}.xlsx`);
    toast.success(`${config.title} ready.`);
  };

  if (!recentlySelectedCompany) {
    return (
      <ExportShell config={config} Icon={Icon}>
        <EmptyState title="No company selected" message="Select a company before exporting data." />
      </ExportShell>
    );
  }

  if (config.targetCompanyOnly && recentlySelectedCompany !== TARGET_PERFORMANCE_IMPORT_COMPANY_ID) {
    return (
      <ExportShell config={config} Icon={Icon}>
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Restricted Export</p>
              <h2 className="mt-1 text-lg font-semibold">{MURDOCK_POOL_SERVICE_ONLY_LABEL}</h2>
              <p className="mt-1 text-sm">
                This export matches the Murdock-only performance history import page and is only available for that company.
              </p>
            </div>
            <Link
              to="/company/settings"
              className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              Back to Settings
            </Link>
          </div>
        </section>
      </ExportShell>
    );
  }

  return (
    <ExportShell config={config} Icon={Icon}>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Export Options</h2>
            <p className="mt-1 text-sm text-slate-500">
              Workbook sheets are generated from the currently selected company.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadExport}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh Preview
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || !exportPackage}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Download Excel
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {config.supportsInactive && (
            <OptionCheckbox
              label="Include inactive records"
              checked={options.includeInactive}
              onChange={(value) => updateOption("includeInactive", value)}
            />
          )}
          <OptionCheckbox
            label="Include internal IDs"
            checked={options.includeInternalIds}
            onChange={(value) => updateOption("includeInternalIds", value)}
          />
          <OptionCheckbox
            label="Include migration metadata"
            checked={options.includeMigrationMetadata}
            onChange={(value) => updateOption("includeMigrationMetadata", value)}
          />
        </div>

        {config.supportsDateRange && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Start Date</span>
              <input
                type="date"
                value={options.startDate}
                onChange={(event) => updateOption("startDate", event.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">End Date</span>
              <input
                type="date"
                value={options.endDate}
                onChange={(event) => updateOption("endDate", event.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {(exportPackage?.stats || defaultStats(loading)).map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Preview</h2>
            <p className="mt-1 text-sm text-slate-500">
              {loadedAt ? `Loaded ${loadedAt.toLocaleTimeString()}` : "Waiting for data"}
            </p>
          </div>
          <p className="text-sm font-semibold text-slate-600">
            {exportPackage?.sheetSummary || "No workbook generated yet"}
          </p>
        </div>

        {loading ? (
          <EmptyState title="Loading export data" message="Gathering company records for the workbook." />
        ) : previewRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {previewHeaders.map((header) => (
                    <th key={header} className="whitespace-nowrap px-4 py-3">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {previewRows.slice(0, 20).map((row, index) => (
                  <tr key={`${row.ID || row["Customer ID"] || row["Record ID"] || index}`}>
                    {previewHeaders.map((header) => (
                      <td key={header} className="max-w-[280px] truncate px-4 py-3 text-slate-700">
                        {formatPreviewValue(row[header])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No rows found" message="There are no records for the selected export options." />
        )}
      </section>
    </ExportShell>
  );
}

function ExportShell({ config, Icon, children }) {
  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{config.eyebrow}</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-950">{config.title}</h1>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">{config.description}</p>
              </div>
            </div>
            <Link
              to="/company/settings"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Settings
            </Link>
          </div>
        </section>
        {children}
      </div>
    </div>
  );
}

function OptionCheckbox({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
      />
      <span>{label}</span>
    </label>
  );
}

function StatCard({ label, value, tone = "slate" }) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
    </div>
  );
}

function defaultStats(loading) {
  return [
    { label: "Status", value: loading ? "Loading" : "Ready", tone: loading ? "blue" : "slate" },
    { label: "Sheets", value: "-", tone: "slate" },
    { label: "Rows", value: "-", tone: "slate" },
    { label: "Format", value: "XLSX", tone: "slate" },
  ];
}

async function loadCustomerExport(companyId, options) {
  const customers = filterInactive(await readCompanyCollection(companyId, "customers"), options);
  const rows = customers
    .sort((left, right) => customerDisplayName(left).localeCompare(customerDisplayName(right)))
    .map((customer) => customerRow(customer, options));

  return createExportPackage({
    sheets: [{ name: "Customers", rows }],
    previewRows: rows,
    previewHeaders: ["FullName", "CompanyName", "Email1", "MobilePhone1", "Status", "TagList"],
    stats: [
      { label: "Customers", value: rows.length, tone: "blue" },
      { label: "Active", value: customers.filter(isActiveRecord).length, tone: "emerald" },
      { label: "Inactive", value: customers.filter((customer) => !isActiveRecord(customer)).length, tone: "amber" },
      { label: "Sheets", value: 1, tone: "slate" },
    ],
  });
}

async function loadServiceLocationExport(companyId, options) {
  const [customers, serviceLocations, bodiesOfWater] = await Promise.all([
    readCompanyCollection(companyId, "customers"),
    readCompanyCollection(companyId, "serviceLocations"),
    readCompanyCollection(companyId, "bodiesOfWater"),
  ]);
  const customersById = mapById(customers);
  const locations = filterInactive(serviceLocations, options);
  const bodiesByLocationId = groupBy(bodiesOfWater, (bodyOfWater) => bodyOfWater.serviceLocationId || "");
  const locationRows = locations
    .sort((left, right) => serviceLocationSortLabel(left, customersById).localeCompare(serviceLocationSortLabel(right, customersById)))
    .map((location) => serviceLocationRow(location, { customersById, bodiesByLocationId }, options));
  const bodyRows = bodiesOfWater
    .filter((bodyOfWater) => options.includeInactive || isActiveRecord(bodyOfWater))
    .map((bodyOfWater) => bodyOfWaterRow(bodyOfWater, { customersById, locationsById: mapById(serviceLocations) }, options));

  return createExportPackage({
    sheets: [
      { name: "Service Locations", rows: locationRows },
      { name: "Bodies Of Water", rows: bodyRows },
    ],
    previewRows: locationRows,
    previewHeaders: ["Customer", "LocationName", "LocationAddress", "LocationCity", "Status", "Pools"],
    stats: [
      { label: "Locations", value: locationRows.length, tone: "blue" },
      { label: "Pools", value: bodyRows.length, tone: "emerald" },
      { label: "Inactive", value: serviceLocations.filter((location) => !isActiveRecord(location)).length, tone: "amber" },
      { label: "Sheets", value: 2, tone: "slate" },
    ],
  });
}

async function loadEquipmentExport(companyId, options) {
  const [customers, serviceLocations, bodiesOfWater, equipment] = await Promise.all([
    readCompanyCollection(companyId, "customers"),
    readCompanyCollection(companyId, "serviceLocations"),
    readCompanyCollection(companyId, "bodiesOfWater"),
    readCompanyCollection(companyId, "equipment"),
  ]);
  const filteredEquipment = filterInactive(equipment, options);
  const lookups = {
    customersById: mapById(customers),
    locationsById: mapById(serviceLocations),
    bodiesById: mapById(bodiesOfWater),
  };
  const equipmentRows = filteredEquipment
    .sort((left, right) => equipmentSortLabel(left, lookups).localeCompare(equipmentSortLabel(right, lookups)))
    .map((item) => equipmentRow(item, lookups, options));
  const parts = await readEquipmentParts(companyId, filteredEquipment);
  const partsRows = parts.map((part) => equipmentPartRow(part, lookups, options));

  return createExportPackage({
    sheets: [
      { name: "Equipment", rows: equipmentRows },
      { name: "Equipment Parts", rows: partsRows },
    ],
    previewRows: equipmentRows,
    previewHeaders: ["Customer", "Street Address", "BOW", "Type", "Make", "Model", "Status", "Has Service"],
    stats: [
      { label: "Equipment", value: equipmentRows.length, tone: "blue" },
      { label: "Parts", value: partsRows.length, tone: "emerald" },
      { label: "Inactive", value: equipment.filter((item) => !isActiveRecord(item)).length, tone: "amber" },
      { label: "Sheets", value: 2, tone: "slate" },
    ],
  });
}

async function loadServiceHistoryExport(companyId, options) {
  const [customers, serviceLocations, bodiesOfWater, serviceStops, stopData, companyUsers] = await Promise.all([
    readCompanyCollection(companyId, "customers"),
    readCompanyCollection(companyId, "serviceLocations"),
    readCompanyCollection(companyId, "bodiesOfWater"),
    readCompanyCollection(companyId, "serviceStops"),
    readCompanyCollection(companyId, "stopData"),
    readCompanyCollection(companyId, "companyUsers"),
  ]);
  const lookups = {
    customersById: mapById(customers),
    locationsById: mapById(serviceLocations),
    bodiesById: mapById(bodiesOfWater),
    serviceStopsById: mapById(serviceStops),
    companyUsersById: mapCompanyUsers(companyUsers),
  };
  const filteredStopData = stopData
    .filter((record) => dateInRange(stopDataDateValue(record, lookups), options.startDate, options.endDate))
    .sort((left, right) => dateMillis(stopDataDateValue(right, lookups)) - dateMillis(stopDataDateValue(left, lookups)));
  const serviceRows = serviceHistoryRows(filteredStopData, lookups, options);
  const readingRows = filteredStopData.flatMap((record) => serviceHistoryDetailRows(record, lookups, "readings", options));
  const dosageRows = filteredStopData.flatMap((record) => serviceHistoryDetailRows(record, lookups, "dosages", options));
  const observationRows = filteredStopData.flatMap((record) => serviceHistoryObservationRows(record, lookups, options));
  const measurementRows = filteredStopData.flatMap((record) => serviceHistoryDetailRows(record, lookups, "equipmentMeasurements", options));

  return createExportPackage({
    sheets: [
      { name: "Service History", rows: serviceRows.rows, headers: serviceRows.headers },
      { name: "Readings", rows: readingRows },
      { name: "Dosages", rows: dosageRows },
      { name: "Observations", rows: observationRows },
      { name: "Equipment Measurements", rows: measurementRows },
    ],
    previewRows: serviceRows.rows,
    previewHeaders: ["Customer", "Address", "Pool", "Tech", "Start Time", "Service Notes"],
    stats: [
      { label: "Stops", value: serviceRows.rows.length, tone: "blue" },
      { label: "Readings", value: readingRows.length, tone: "emerald" },
      { label: "Dosages", value: dosageRows.length, tone: "emerald" },
      { label: "Sheets", value: 5, tone: "slate" },
    ],
  });
}

async function loadPerformanceHistoryExport(companyId, options) {
  const companyUsers = await readCompanyCollection(companyId, "companyUsers");
  const reviewGroups = await Promise.all(
    companyUsers.map(async (companyUser) => {
      const reviews = await readPerformanceReviews(companyId, companyUser.id);
      return reviews.map((review) => ({ ...review, companyUser }));
    })
  );
  const reviews = reviewGroups.flat().sort((left, right) => dateMillis(right.date) - dateMillis(left.date));
  const rows = reviews.map((review) => performanceHistoryRow(review, companyId, options));

  return createExportPackage({
    sheets: [{ name: "Performance History", rows }],
    previewRows: rows,
    previewHeaders: ["Suggested Technician", "Record Type", "Date", "Title", "Visible To Technician", "Source Kind"],
    stats: [
      { label: "Reviews", value: rows.length, tone: "blue" },
      { label: "Technicians", value: new Set(reviews.map((review) => review.companyUser?.id).filter(Boolean)).size, tone: "emerald" },
      { label: "Visible", value: reviews.filter((review) => Boolean(review.visibleToTechnician)).length, tone: "amber" },
      { label: "Sheets", value: 1, tone: "slate" },
    ],
  });
}

async function readCompanyCollection(companyId, collectionName) {
  const snapshot = await getDocs(collection(db, "companies", companyId, collectionName));
  return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
}

async function readEquipmentParts(companyId, equipment = []) {
  const partGroups = await Promise.all(
    equipment.map(async (item) => {
      const snapshot = await getDocs(collection(db, "companies", companyId, "equipment", item.id, "parts"));
      return snapshot.docs.map((partSnapshot) => ({
        id: partSnapshot.id,
        equipmentId: item.id,
        equipment: item,
        ...partSnapshot.data(),
      }));
    })
  );

  return partGroups.flat();
}

async function readPerformanceReviews(companyId, companyUserId) {
  const snapshot = await getDocs(
    collection(db, "companyUserPerformanceReviews", companyId, "companyUsers", companyUserId, "reviews")
  );
  return snapshot.docs.map((reviewSnapshot) => ({ id: reviewSnapshot.id, ...reviewSnapshot.data() }));
}

function createExportPackage({ sheets, previewRows, previewHeaders, stats }) {
  const rowCount = sheets.reduce((count, sheet) => count + (sheet.rows?.length || 0), 0);

  return {
    sheets,
    previewRows,
    previewHeaders,
    stats,
    sheetSummary: `${sheets.length} sheet${sheets.length === 1 ? "" : "s"} - ${rowCount} row${rowCount === 1 ? "" : "s"}`,
  };
}

function writeWorkbook(sheets, fileName) {
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const rows = sheet.rows?.length ? sheet.rows : [{ Message: "No rows for this sheet." }];
    const headers = sheet.headers?.length ? sheet.headers : headersForRows(rows);
    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...rows.map((row) => headers.map((header) => exportCellValue(row[header]))),
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name));
  });

  XLSX.writeFile(workbook, fileName);
}

function customerRow(customer, options) {
  const address = customer.billingAddress || {};
  const emails = uniqueStrings([customer.email, customer.customerEmail, ...(customer.sourceContactFields?.emails || [])]);
  const phones = uniqueStrings([customer.phoneNumber, customer.phone, ...(customer.sourceContactFields?.phones || [])]);
  const row = {
    FullName: customerDisplayName(customer),
    DisplayAsCompany: yesNo(customer.displayAsCompany),
    FirstName: customer.firstName || "",
    LastName: customer.lastName || "",
    CompanyName: customer.company || "",
    MobilePhone1: phones[0] || "",
    MobilePhone2: phones[1] || "",
    Email1: emails[0] || "",
    Email2: emails[1] || "",
    CustomerNotes: customer.billingNotes || customer.notes || "",
    TagList: joinList(customer.tags),
    BillingAddress: address.streetAddress || "",
    BillingCity: address.city || "",
    BillingState: address.state || "",
    BillingZip: address.zip || "",
    Status: isActiveRecord(customer) ? "Active" : "Inactive",
  };

  addInternalIds(row, options, {
    "Customer ID": customer.id,
    "Linked Customer User ID": customer.linkedCustomerUserId || customer.linkedHomeownerUserId || "",
    "Linked Invite ID": customer.linkedInviteId || "",
  });
  addMigrationMetadata(row, options, customer.migrationSource);

  return row;
}

function serviceLocationRow(location, lookups, options) {
  const customer = lookups.customersById.get(location.customerId) || {};
  const address = location.address || {};
  const bodies = lookups.bodiesByLocationId.get(location.id) || [];
  const row = {
    Customer: customerDisplayName(customer) || location.customerName || "",
    LocationName: location.nickName || location.label || "Service Location",
    LocationAddress: address.streetAddress || "",
    LocationCity: address.city || "",
    LocationState: address.state || "",
    LocationZip: address.zip || "",
    GateCode: location.gateCode || "",
    DogsName: joinList(location.dogName),
    Rate: location.rate || "",
    RateType: location.rateType || "",
    LaborCost: location.laborCost || "",
    LaborCostType: location.laborType || "",
    MinutesAtStop: location.estimatedTime || "",
    LocationNotes: location.notes || "",
    Status: isActiveRecord(location) ? "Active" : "Inactive",
    Pools: bodies.map((bodyOfWater) => bodyOfWater.name || bodyOfWater.label || bodyOfWater.id).filter(Boolean).join("; "),
  };

  addInternalIds(row, options, {
    "Service Location ID": location.id,
    "Customer ID": location.customerId || "",
    "Body Of Water IDs": joinList(location.bodiesOfWaterId),
  });
  addMigrationMetadata(row, options, location.migrationSource);

  return row;
}

function bodyOfWaterRow(bodyOfWater, lookups, options) {
  const customer = lookups.customersById.get(bodyOfWater.customerId) || {};
  const location = lookups.locationsById.get(bodyOfWater.serviceLocationId) || {};
  const row = {
    Customer: customerDisplayName(customer) || location.customerName || "",
    LocationName: location.nickName || location.label || "",
    LocationAddress: addressLine(location.address),
    Pool: bodyOfWater.name || bodyOfWater.label || "Pool",
    Gallons: bodyOfWater.gallons || "",
    Material: bodyOfWater.material || "",
    WaterType: bodyOfWater.waterType || "",
    Shape: bodyOfWater.shape || "",
    Length: bodyOfWater.length || "",
    Width: bodyOfWater.width || "",
    Depth: bodyOfWater.depth || "",
    Notes: bodyOfWater.notes || "",
    LastFilled: formatDate(bodyOfWater.lastFilled),
    Status: isActiveRecord(bodyOfWater) ? "Active" : "Inactive",
  };

  addInternalIds(row, options, {
    "Body Of Water ID": bodyOfWater.id,
    "Service Location ID": bodyOfWater.serviceLocationId || "",
    "Customer ID": bodyOfWater.customerId || "",
  });
  addMigrationMetadata(row, options, bodyOfWater.migrationSource);

  return row;
}

function equipmentRow(equipment, lookups, options) {
  const customer = lookups.customersById.get(equipment.customerId) || {};
  const location = lookups.locationsById.get(equipment.serviceLocationId) || {};
  const bodyOfWater = lookups.bodiesById.get(equipment.bodyOfWaterId) || {};
  const row = {
    Scheduled: yesNo(equipment.needsService),
    Customer: customerDisplayName(customer) || equipment.customerName || "",
    "Street Address": location.address?.streetAddress || "",
    City: location.address?.city || "",
    State: location.address?.state || "",
    Zip: location.address?.zip || "",
    BOW: bodyOfWater.name || bodyOfWater.label || "",
    Type: equipment.type || equipment.category || "",
    "Equipment Name": equipment.name || "",
    Make: equipment.make || "",
    Model: equipment.model || "",
    "Install Date": formatDate(equipment.dateInstalled),
    "Has Service": yesNo(equipment.needsService),
    Frequency: equipment.needsService ? formatFrequency(equipment) : "",
    "Last Serviced": equipment.needsService ? formatDate(equipment.lastServiceDate) : "",
    "Next Service": equipment.needsService ? formatDate(equipment.nextServiceDate) : "",
    Status: equipment.status || "",
    Notes: equipment.notes || "",
    "Clean Filter Pressure": equipment.cleanFilterPressure ?? "",
    "Current Pressure": equipment.currentPressure ?? "",
    "Date Removed": formatDate(equipment.dateUninstalled),
    Active: yesNo(isActiveRecord(equipment)),
  };

  addInternalIds(row, options, {
    "Equipment ID": equipment.id,
    "Customer ID": equipment.customerId || "",
    "Service Location ID": equipment.serviceLocationId || "",
    "Body Of Water ID": equipment.bodyOfWaterId || "",
    "Universal Equipment ID": equipment.universalEquipmentId || "",
    "Type ID": equipment.typeId || "",
    "Make ID": equipment.makeId || "",
    "Model ID": equipment.modelId || "",
  });
  addMigrationMetadata(row, options, equipment.migrationSource);

  return row;
}

function equipmentPartRow(part, lookups, options) {
  const equipment = part.equipment || {};
  const base = equipmentRow(equipment, lookups, options);
  return {
    "Equipment Part": part.name || "",
    "Part Created At": formatDate(part.createdAt),
    ...pick(base, ["Customer", "Street Address", "BOW", "Type", "Equipment Name", "Make", "Model", "Status"]),
    ...(options.includeInternalIds ? {
      "Part ID": part.id,
      "Equipment ID": part.equipmentId || "",
    } : {}),
    ...(options.includeMigrationMetadata ? migrationMetadataFields(part.migrationSource) : {}),
  };
}

function serviceHistoryRows(records, lookups, options) {
  const readingHeaders = measurementHeaders(records, "readings");
  const dosageHeaders = measurementHeaders(records, "dosages");
  const headers = [
    "Customer",
    "Customer Code",
    "Address",
    "City",
    "State",
    "Zip",
    "Location Code",
    "Tech",
    "Start Time",
    "Complete Time",
    "Pool",
    "Gallons",
    "Service Notes",
    "Rate",
    "Rate Type",
    "Labor Cost",
    "Labor Cost Type",
    ...readingHeaders,
    ...dosageHeaders,
  ];
  if (options.includeInternalIds) {
    headers.push("Stop Data ID", "Service Stop ID", "Customer ID", "Service Location ID", "Body Of Water ID", "Tech ID");
  }

  const rows = records.map((record) => {
    const serviceStop = lookups.serviceStopsById.get(record.serviceStopId) || {};
    const customer = lookups.customersById.get(record.customerId || serviceStop.customerId) || {};
    const location = lookups.locationsById.get(record.serviceLocationId || serviceStop.serviceLocationId) || {};
    const bodyOfWater = lookups.bodiesById.get(record.bodyOfWaterId) || {};
    const tech = lookups.companyUsersById.get(record.userId || serviceStop.techId) || {};
    const address = location.address || serviceStop.address || {};
    const row = {
      Customer: customerDisplayName(customer) || serviceStop.customerName || "",
      "Customer Code": customer.migrationSource?.sourceCustomerCode || location.migrationSource?.sourceCustomerCode || "",
      Address: address.streetAddress || "",
      City: address.city || "",
      State: address.state || "",
      Zip: address.zip || "",
      "Location Code": location.migrationSource?.sourceLocationCode || location.nickName || "",
      Tech: companyUserDisplayName(tech) || serviceStop.tech || "",
      "Start Time": formatDateTime(serviceStop.startTime || serviceStop.serviceDate || record.date),
      "Complete Time": formatDateTime(serviceStop.endTime),
      Pool: bodyOfWater.name || bodyOfWater.label || "",
      Gallons: bodyOfWater.gallons || "",
      "Service Notes": joinList(record.observation || record.observations || serviceStop.description),
      Rate: location.rate || "",
      "Rate Type": location.rateType || "",
      "Labor Cost": location.laborCost || "",
      "Labor Cost Type": location.laborType || "",
    };

    addMeasurementsToRow(row, record.readings, readingHeaders);
    addMeasurementsToRow(row, record.dosages, dosageHeaders);
    addInternalIds(row, options, {
      "Stop Data ID": record.id,
      "Service Stop ID": record.serviceStopId || "",
      "Customer ID": record.customerId || serviceStop.customerId || "",
      "Service Location ID": record.serviceLocationId || serviceStop.serviceLocationId || "",
      "Body Of Water ID": record.bodyOfWaterId || "",
      "Tech ID": record.userId || serviceStop.techId || "",
    });

    return row;
  });

  return { rows, headers };
}

function serviceHistoryDetailRows(record, lookups, fieldName, options) {
  const details = Array.isArray(record[fieldName]) ? record[fieldName] : [];
  return details.map((detail) => {
    const base = serviceHistoryBaseRow(record, lookups, options);
    return {
      ...base,
      Name: detail.name || detail.displayName || "",
      Amount: detail.amount ?? detail.quantity ?? "",
      UOM: detail.UOM || detail.uom || "",
      "Template ID": detail.templateId || "",
      "Universal Template ID": detail.universalTemplateId || "",
      "Dosage Type": detail.dosageType || "",
      "Linked Item IDs": joinList(detail.linkedItemIds || detail.linkedItem),
      "Source Column": detail.sourceColumn || "",
      "Source Chemical Name": detail.sourceChemicalName || "",
    };
  });
}

function serviceHistoryObservationRows(record, lookups, options) {
  const observations = Array.isArray(record.observation)
    ? record.observation
    : Array.isArray(record.observations)
      ? record.observations
      : [];

  return observations.map((observation) => ({
    ...serviceHistoryBaseRow(record, lookups, options),
    Observation: observation,
  }));
}

function serviceHistoryBaseRow(record, lookups, options) {
  const serviceStop = lookups.serviceStopsById.get(record.serviceStopId) || {};
  const customer = lookups.customersById.get(record.customerId || serviceStop.customerId) || {};
  const location = lookups.locationsById.get(record.serviceLocationId || serviceStop.serviceLocationId) || {};
  const bodyOfWater = lookups.bodiesById.get(record.bodyOfWaterId) || {};
  const tech = lookups.companyUsersById.get(record.userId || serviceStop.techId) || {};
  const row = {
    Customer: customerDisplayName(customer) || serviceStop.customerName || "",
    Address: addressLine(location.address || serviceStop.address),
    Pool: bodyOfWater.name || bodyOfWater.label || "",
    Tech: companyUserDisplayName(tech) || serviceStop.tech || "",
    Date: formatDateTime(serviceStop.serviceDate || record.date),
  };

  addInternalIds(row, options, {
    "Stop Data ID": record.id,
    "Service Stop ID": record.serviceStopId || "",
    "Customer ID": record.customerId || serviceStop.customerId || "",
    "Service Location ID": record.serviceLocationId || serviceStop.serviceLocationId || "",
    "Body Of Water ID": record.bodyOfWaterId || "",
    "Tech ID": record.userId || serviceStop.techId || "",
  });

  return row;
}

function stopDataDateValue(record, lookups) {
  const serviceStop = lookups.serviceStopsById.get(record.serviceStopId) || {};
  return record.date || serviceStop.serviceDate || serviceStop.startTime;
}

function performanceHistoryRow(review, companyId, options) {
  const companyUser = review.companyUser || {};
  const migrationSource = review.migrationSource || {};
  const row = {
    "Import Enabled": true,
    "Import Key": migrationSource.importKey || review.id,
    "Company ID": review.companyId || companyId,
    "Source Technician": migrationSource.sourceTechnician || review.technicianName || companyUserDisplayName(companyUser),
    "Suggested Technician": review.technicianName || migrationSource.suggestedTechnician || companyUserDisplayName(companyUser),
    "Record Type": review.type || "",
    Date: formatDate(review.date),
    "Original Date Text": migrationSource.originalDateText || "",
    Title: review.title || "",
    Note: review.note || "",
    "Visible To Technician": yesNo(review.visibleToTechnician),
    "Source Kind": migrationSource.sourceKind || "",
    "Source File": migrationSource.sourceFile || "",
    "Source Sheet": migrationSource.sourceSheet || "",
    "Source Row": migrationSource.sourceRow || "",
    "Source Table": migrationSource.sourceTable || "",
    "Reference Customer": review.sourceReferences?.customerName || "",
    "Reference Job Description": review.sourceReferences?.jobDescription || "",
    Signer: migrationSource.signer || "",
    Confidence: migrationSource.confidence || "",
    "Parse Notes": migrationSource.parseNotes || "",
  };

  addInternalIds(row, options, {
    "Review ID": review.id,
    "Company User ID": review.companyUserId || companyUser.id || "",
    "Technician User ID": review.technicianUserId || companyUser.userId || "",
    "Created By User ID": review.createdByUserId || "",
  });
  addMigrationMetadata(row, options, migrationSource);

  return row;
}

function filterInactive(records, options) {
  return options.includeInactive ? records : records.filter(isActiveRecord);
}

function isActiveRecord(record = {}) {
  if (typeof record.active === "boolean") return record.active;
  if (typeof record.isActive === "boolean") return record.isActive;
  return true;
}

function addInternalIds(row, options, fields) {
  if (!options.includeInternalIds) return;
  Object.assign(row, fields);
}

function addMigrationMetadata(row, options, migrationSource) {
  if (!options.includeMigrationMetadata) return;
  Object.assign(row, migrationMetadataFields(migrationSource));
}

function migrationMetadataFields(migrationSource = {}) {
  return {
    "Migration Provider": migrationSource?.provider || migrationSource?.source || "",
    "Import Batch ID": migrationSource?.importBatchId || "",
    "Source File": migrationSource?.sourceFile || "",
    "Source Row": migrationSource?.sourceRowNumber || migrationSource?.sourceRow || "",
    "Source Customer Key": migrationSource?.sourceCustomerKey || "",
    "Source Location Key": migrationSource?.sourceLocationKey || "",
    "Source Equipment Key": migrationSource?.sourceEquipmentKey || "",
  };
}

function serviceLocationSortLabel(location, customersById) {
  return `${customerDisplayName(customersById.get(location.customerId)) || location.customerName || ""} ${addressLine(location.address)}`;
}

function equipmentSortLabel(equipment, lookups) {
  const customer = lookups.customersById.get(equipment.customerId);
  const location = lookups.locationsById.get(equipment.serviceLocationId);
  return `${customerDisplayName(customer) || equipment.customerName || ""} ${addressLine(location?.address)} ${equipment.type || ""} ${equipment.name || ""}`;
}

function measurementHeaders(records, fieldName) {
  return uniqueStrings(
    records.flatMap((record) => (Array.isArray(record[fieldName]) ? record[fieldName] : []).map(measurementLabel))
  );
}

function addMeasurementsToRow(row, measurements = [], headers = []) {
  headers.forEach((header) => {
    row[header] = "";
  });

  measurements.forEach((measurement) => {
    const header = measurementLabel(measurement);
    if (!header) return;
    row[header] = appendCell(row[header], measurement.amount ?? measurement.quantity ?? "");
  });
}

function measurementLabel(measurement = {}) {
  const name = measurement.name || measurement.displayName || measurement.chemicalName || measurement.id || "";
  const uom = measurement.UOM || measurement.uom || "";
  if (!name) return "";
  return uom && !String(name).toLowerCase().includes(String(uom).toLowerCase())
    ? `${name} (${uom})`
    : name;
}

function appendCell(currentValue, nextValue) {
  if (nextValue === "" || nextValue === undefined || nextValue === null) return currentValue || "";
  if (currentValue === "" || currentValue === undefined || currentValue === null) return nextValue;
  return `${currentValue}; ${nextValue}`;
}

function dateInRange(value, startDate, endDate) {
  const millis = dateMillis(value);
  if (!millis) return !startDate && !endDate;

  if (startDate) {
    const startMillis = dateMillis(dateFromInput(startDate));
    if (millis < startMillis) return false;
  }

  if (endDate) {
    const end = dateFromInput(endDate);
    end.setHours(23, 59, 59, 999);
    if (millis > end.getTime()) return false;
  }

  return true;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateMillis(value) {
  return toDate(value)?.getTime() || 0;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return dateInputValue(date);
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "";
  const datePart = dateInputValue(date);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${datePart} ${hours}:${minutes}`;
}

function dateInputValue(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateFromInput(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function customerDisplayName(customer = {}) {
  if (!customer) return "";
  if (customer.displayAsCompany && customer.company) return customer.company;
  return (
    customer.label ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    customer.company ||
    customer.email ||
    customer.id ||
    ""
  );
}

function companyUserDisplayName(companyUser = {}) {
  if (!companyUser?.id && !companyUser?.userId && !companyUser?.email && !companyUser?.userName && !companyUser?.displayName) {
    return "";
  }

  return getCompanyUserDisplayName(companyUser);
}

function addressLine(address = {}) {
  return [
    address?.streetAddress,
    [address?.city, address?.state, address?.zip].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
}

function formatFrequency(equipment = {}) {
  return [equipment.serviceFrequency, equipment.serviceFrequencyEvery].filter(Boolean).join(" ");
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function joinList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("; ");
  return value || "";
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mapById(records = []) {
  return new Map(records.map((record) => [record.id, record]));
}

function mapCompanyUsers(companyUsers = []) {
  const map = new Map();
  companyUsers.forEach((companyUser) => {
    [companyUser.id, companyUser.userId].filter(Boolean).forEach((id) => {
      map.set(id, companyUser);
    });
  });
  return map;
}

function groupBy(records = [], keyForRecord) {
  const groups = new Map();
  records.forEach((record) => {
    const key = keyForRecord(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return groups;
}

function pick(source, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = source[key] ?? "";
    return acc;
  }, {});
}

function headersForRows(rows = []) {
  const headers = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!headers.includes(key)) headers.push(key);
    });
  });
  return headers.length ? headers : ["Message"];
}

function exportCellValue(value) {
  if (value instanceof Date) return formatDateTime(value);
  if (Array.isArray(value)) return joinList(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ?? "";
}

function formatPreviewValue(value) {
  const text = exportCellValue(value);
  return text === "" ? "-" : text;
}

function safeSheetName(name) {
  return String(name || "Sheet")
    .replace(/[\][*?/\\:]/g, " ")
    .slice(0, 31);
}

export default CompanyDataExport;
