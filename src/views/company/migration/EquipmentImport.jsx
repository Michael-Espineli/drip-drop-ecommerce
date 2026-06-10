import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Select from "react-select";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  EQUIPMENT_IMPORT_OPTIONAL_COLUMNS,
  EQUIPMENT_IMPORT_REQUIRED_COLUMNS,
  buildEquipmentAutoMappings,
  buildEquipmentImportDoc,
  displayCustomerName,
  findExistingEquipmentForImportRecord,
  formatDateLabel,
  formatServiceLocation,
  getEquipmentImportTargetCandidates,
  parseEquipmentImportRows,
  summarizeEquipmentImportRecords,
} from "./equipmentImportUtils";

const MAX_WRITES_PER_BATCH = 450;
const CREATE_NEW_TARGET_VALUE = "__create_new__";

const createImportBatchId = () => `equipment_import_${Date.now().toString(36)}`;

const commitBatch = async (batchState) => {
  if (batchState.writeCount === 0) return;
  await batchState.batch.commit();
  batchState.batch = writeBatch(db);
  batchState.writeCount = 0;
};

const sourceFilterCardClass = ({ active, tone = "slate" }) => {
  const activeClasses = {
    emerald: "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200",
    amber: "border-amber-300 bg-amber-50 ring-2 ring-amber-200",
    red: "border-red-300 bg-red-50 ring-2 ring-red-200",
    slate: "border-blue-300 bg-blue-50 ring-2 ring-blue-200",
  };
  const inactiveClasses = {
    emerald: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
    amber: "border-amber-200 bg-amber-50 hover:bg-amber-100",
    red: "border-red-200 bg-red-50 hover:bg-red-100",
    slate: "border-slate-200 bg-slate-50 hover:bg-slate-100",
  };

  return [
    "w-full border p-3 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-200",
    active ? activeClasses[tone] : inactiveClasses[tone],
  ].join(" ");
};

const selectClassName = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const selectTheme = (theme) => ({
  ...theme,
  borderRadius: 6,
  colors: {
    ...theme.colors,
    primary25: "#EFF6FF",
    primary: "#2563EB",
    neutral20: "#CBD5E1",
    neutral30: "#94A3B8",
  },
});

const customerSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderColor: state.isFocused ? "#2563EB" : "#CBD5E1",
    boxShadow: state.isFocused ? "0 0 0 2px rgba(37, 99, 235, 0.15)" : "none",
    "&:hover": {
      borderColor: state.isFocused ? "#2563EB" : "#94A3B8",
    },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({ ...base, zIndex: 40 }),
};

const customerPhone = (customer = {}) => (
  customer.phoneNumber ||
  customer.phone ||
  customer.mainContact?.phoneNumber ||
  customer.contact?.phoneNumber ||
  ""
);

const customerAddressLine = (customer = {}) => {
  const address = customer.billingAddress || customer.address || {};
  return [
    address.streetAddress || customer.streetAddress,
    address.city || customer.city,
    address.state || customer.state,
    address.zip || customer.zip,
  ]
    .filter(Boolean)
    .join(" ");
};

const equipmentTargetLabel = (equipment = {}) => {
  const name = equipment.name || equipment.type || "Equipment";
  const details = [equipment.make, equipment.model].filter(Boolean).join(" / ");
  return details ? `${name} - ${details}` : name;
};

const equipmentTargetMatchLabel = (matchKind = "") => {
  if (matchKind === "migration") return "same import row";
  if (matchKind === "exact") return "exact model";
  if (matchKind === "placeholder") return "default placeholder";
  if (matchKind === "type") return "same type";
  return "existing equipment";
};

function EquipmentImport() {
  const { recentlySelectedCompany } = useContext(Context);
  const [companyData, setCompanyData] = useState({
    loading: false,
    customers: [],
    serviceLocations: [],
    bodiesOfWater: [],
    equipment: [],
  });
  const [fileName, setFileName] = useState("");
  const [sourceSheetName, setSourceSheetName] = useState("");
  const [records, setRecords] = useState([]);
  const [parseIssues, setParseIssues] = useState([]);
  const [skippedRows, setSkippedRows] = useState([]);
  const [mappings, setMappings] = useState({});
  const [sourceFilter, setSourceFilter] = useState("all");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [lastImportSummary, setLastImportSummary] = useState(null);

  const loadCompanyData = useCallback(async () => {
    if (!recentlySelectedCompany) {
      const emptyData = {
        loading: false,
        customers: [],
        serviceLocations: [],
        bodiesOfWater: [],
        equipment: [],
      };
      setCompanyData(emptyData);
      return emptyData;
    }

    setCompanyData((current) => ({ ...current, loading: true }));

    try {
      const [
        customersSnapshot,
        serviceLocationsSnapshot,
        bodiesOfWaterSnapshot,
        equipmentSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "serviceLocations")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "bodiesOfWater")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "equipment")),
      ]);

      const nextData = {
        loading: false,
        customers: customersSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        serviceLocations: serviceLocationsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        bodiesOfWater: bodiesOfWaterSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        equipment: equipmentSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
      };

      setCompanyData(nextData);
      return nextData;
    } catch (error) {
      console.error("Failed to load equipment import matching data:", error);
      toast.error("Could not load company records for equipment matching.");
      const errorData = {
        loading: false,
        customers: [],
        serviceLocations: [],
        bodiesOfWater: [],
        equipment: [],
      };
      setCompanyData(errorData);
      return errorData;
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  const autoMappings = useMemo(
    () =>
      buildEquipmentAutoMappings({
        records,
        customers: companyData.customers,
        serviceLocations: companyData.serviceLocations,
        bodiesOfWater: companyData.bodiesOfWater,
      }),
    [companyData.bodiesOfWater, companyData.customers, companyData.serviceLocations, records]
  );

  useEffect(() => {
    setMappings((current) => {
      const nextMappings = {};

      records.forEach((record) => {
        const currentMapping = current[record.id];
        const autoMapping = autoMappings[record.id] || {};
        const hasUserChoice = Boolean(
          currentMapping?.targetAction ||
          currentMapping?.targetEquipmentId ||
          ["manual", "confirmedNameFallback"].includes(currentMapping?.matchMethod)
        );

        nextMappings[record.id] = hasUserChoice
          ? { ...autoMapping, ...currentMapping }
          : autoMapping;
      });

      return nextMappings;
    });
  }, [autoMappings, records]);

  const enrichedRecords = useMemo(
    () =>
      records.map((record) => {
        const mapping = mappings[record.id] || {};
        const mappingReady = Boolean(mapping.customerId && mapping.serviceLocationId && mapping.bodyOfWaterId);
        const targetCandidates = mappingReady
          ? getEquipmentImportTargetCandidates(record, mapping, companyData.equipment)
          : [];
        const needsInspection = Boolean(mapping.needsInspection);
        const targetEquipment = mappingReady
          ? findExistingEquipmentForImportRecord(record, mapping, companyData.equipment)
          : null;
        const needsOverwriteChoice = Boolean(
          mappingReady &&
          !targetEquipment &&
          !mapping.targetAction &&
          targetCandidates.length > 0
        );

        return {
          ...record,
          mapping,
          mappingReady,
          needsInspection,
          needsOverwriteChoice,
          inspectionReason: mapping.inspectionReason || "",
          matchMethod: mapping.matchMethod || "",
          targetEquipment,
          targetCandidates,
        };
      }),
    [companyData.equipment, mappings, records]
  );

  const summary = useMemo(
    () => summarizeEquipmentImportRecords(records, enrichedRecords),
    [enrichedRecords, records]
  );

  const importableRecords = useMemo(
    () => enrichedRecords.filter((record) =>
      record.mappingReady && !record.needsInspection && !record.needsOverwriteChoice
    ),
    [enrichedRecords]
  );

  const filteredRecords = useMemo(
    () =>
      enrichedRecords.filter((record) => {
        if (sourceFilter === "matched") return record.mappingReady && !record.needsInspection && !record.needsOverwriteChoice;
        if (sourceFilter === "needsMapped") return !record.mappingReady;
        if (sourceFilter === "inspect") return record.mappingReady && (record.needsInspection || record.needsOverwriteChoice);
        return true;
      }),
    [enrichedRecords, sourceFilter]
  );

  const previewRecords = useMemo(() => filteredRecords.slice(0, 120), [filteredRecords]);

  const customerOptions = useMemo(
    () =>
      companyData.customers
        .map((customer) => {
          const name = displayCustomerName(customer);
          const email = customer.email || customer.billingEmail || "";
          const phone = customerPhone(customer);
          const address = customerAddressLine(customer);

          return {
            value: customer.id,
            label: [name, email].filter(Boolean).join(" - "),
            name,
            email,
            phone,
            address,
            searchText: [name, email, phone, address, customer.id].filter(Boolean).join(" "),
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [companyData.customers]
  );

  const customerOptionsById = useMemo(
    () => new Map(customerOptions.map((option) => [option.value, option])),
    [customerOptions]
  );

  const selectPortalTarget = typeof document !== "undefined" ? document.body : undefined;

  const formatCustomerOption = (option, meta) => {
    if (meta.context === "value") {
      return option.name;
    }

    return (
      <div>
        <p className="font-semibold text-slate-900">{option.name}</p>
        <p className="text-xs text-slate-500">
          {[option.email, option.phone, option.address].filter(Boolean).join(" | ") || "No contact details saved"}
        </p>
      </div>
    );
  };

  const getServiceLocationOptions = useCallback(
    (customerId) =>
      companyData.serviceLocations
        .filter((serviceLocation) => serviceLocation.customerId === customerId)
        .map((serviceLocation) => ({
          value: serviceLocation.id,
          label: formatServiceLocation(serviceLocation),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [companyData.serviceLocations]
  );

  const getBodyOfWaterOptions = useCallback(
    (serviceLocationId) =>
      companyData.bodiesOfWater
        .filter((bodyOfWater) => bodyOfWater.serviceLocationId === serviceLocationId)
        .map((bodyOfWater) => ({
          value: bodyOfWater.id,
          label: bodyOfWater.name || bodyOfWater.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [companyData.bodiesOfWater]
  );

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];
    setLastImportSummary(null);

    if (!selectedFile) {
      setFileName("");
      setSourceSheetName("");
      setRecords([]);
      setParseIssues([]);
      setSkippedRows([]);
      setUploadProgress({ current: 0, total: 0 });
      setFileInputKey((current) => current + 1);
      return;
    }

    setFileName(selectedFile.name);
    setSourceSheetName("");
    setRecords([]);
    setParseIssues([]);
    setSkippedRows([]);
    setUploadProgress({ current: 0, total: 0 });

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: "array", cellDates: true });
        const equipmentSheetName =
          workbook.SheetNames.find((sheetName) => sheetName.trim().toLowerCase() === "equipment") ||
          workbook.SheetNames[0];
        const worksheet = workbook.Sheets[equipmentSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "", range: 1 });
        const parsed = parseEquipmentImportRows(rows);

        setSourceSheetName(equipmentSheetName);
        setRecords(parsed.records);
        setParseIssues(parsed.issues);
        setSkippedRows(parsed.skippedRows || []);

        if (parsed.records.length) {
          toast.success(`Parsed ${parsed.records.length} equipment rows.`);
        } else {
          toast.error("No importable equipment rows were found.");
        }
      } catch (error) {
        console.error("Failed to parse equipment workbook:", error);
        setParseIssues(["Could not read this Excel file as an equipment import workbook."]);
        toast.error("Could not parse this workbook.");
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const handleCustomerChange = useCallback(
    (recordId, customerId) => {
      const locationOptions = getServiceLocationOptions(customerId);
      const serviceLocationId = locationOptions.length === 1 ? locationOptions[0].value : "";
      const bodyOptions = serviceLocationId ? getBodyOfWaterOptions(serviceLocationId) : [];

      setMappings((current) => ({
        ...current,
        [recordId]: {
          customerId,
          serviceLocationId,
          bodyOfWaterId: bodyOptions.length === 1 ? bodyOptions[0].value : "",
          matchMethod: "manual",
          needsInspection: false,
          inspectionReason: "",
          targetAction: "",
          targetEquipmentId: "",
        },
      }));
    },
    [getBodyOfWaterOptions, getServiceLocationOptions]
  );

  const handleServiceLocationChange = useCallback(
    (recordId, serviceLocationId) => {
      const bodyOptions = serviceLocationId ? getBodyOfWaterOptions(serviceLocationId) : [];

      setMappings((current) => ({
        ...current,
        [recordId]: {
          ...(current[recordId] || {}),
          serviceLocationId,
          bodyOfWaterId: bodyOptions.length === 1 ? bodyOptions[0].value : "",
          matchMethod: "manual",
          needsInspection: false,
          inspectionReason: "",
          targetAction: "",
          targetEquipmentId: "",
        },
      }));
    },
    [getBodyOfWaterOptions]
  );

  const handleBodyOfWaterChange = useCallback((recordId, bodyOfWaterId) => {
    setMappings((current) => ({
      ...current,
      [recordId]: {
        ...(current[recordId] || {}),
        bodyOfWaterId,
        matchMethod: "manual",
        needsInspection: false,
        inspectionReason: "",
        targetAction: "",
        targetEquipmentId: "",
      },
    }));
  }, []);

  const handleTargetEquipmentChange = useCallback((recordId, value) => {
    setMappings((current) => ({
      ...current,
      [recordId]: {
        ...(current[recordId] || {}),
        targetAction: value === CREATE_NEW_TARGET_VALUE ? "create" : value ? "update" : "",
        targetEquipmentId: value === CREATE_NEW_TARGET_VALUE ? "" : value,
      },
    }));
  }, []);

  const handleConfirmInspection = useCallback((recordId) => {
    setMappings((current) => {
      const currentMapping = current[recordId] || {};

      return {
        ...current,
        [recordId]: {
          ...currentMapping,
          matchMethod: currentMapping.matchMethod === "manual" ? "manual" : "confirmedNameFallback",
          needsInspection: false,
          inspectionReason: "",
        },
      };
    });
  }, []);

  const handleUpload = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before importing equipment.");
      return;
    }

    if (!importableRecords.length) {
      toast.error("Confirm or map at least one equipment row before importing.");
      return;
    }

    const confirmed = window.confirm(
      `Import ${importableRecords.length} confirmed equipment rows into this company? ${summary.updateRows} will update existing equipment and ${summary.createRows} will create new equipment.`
    );
    if (!confirmed) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: importableRecords.length });

    const importBatchId = createImportBatchId();
    const importedAt = new Date();
    const batchState = {
      batch: writeBatch(db),
      writeCount: 0,
    };
    let processedCount = 0;
    let updateRows = 0;
    let createRows = 0;

    try {
      for (const record of importableRecords) {
        if (batchState.writeCount + 1 > MAX_WRITES_PER_BATCH) {
          await commitBatch(batchState);
        }

        const equipmentId = record.targetEquipment?.id || record.id;
        const equipmentDoc = buildEquipmentImportDoc(record, record.mapping, {
          equipmentId,
          fileName,
          sheetName: sourceSheetName,
          importBatchId,
          importedAt,
          existingEquipment: record.targetEquipment,
        });

        batchState.batch.set(
          doc(db, "companies", recentlySelectedCompany, "equipment", equipmentId),
          equipmentDoc,
          { merge: true }
        );
        batchState.writeCount += 1;

        if (record.targetEquipment) updateRows += 1;
        else createRows += 1;

        processedCount += 1;
        if (processedCount % 50 === 0) {
          setUploadProgress({ current: processedCount, total: importableRecords.length });
        }
      }

      await commitBatch(batchState);
      setUploadProgress({ current: importableRecords.length, total: importableRecords.length });
      setLastImportSummary({
        importBatchId,
        rows: importableRecords.length,
        updateRows,
        createRows,
      });
      await loadCompanyData();
      const importedRecordIds = new Set(importableRecords.map((record) => record.id));
      const remainingRecords = records.filter((record) => !importedRecordIds.has(record.id));

      setRecords(remainingRecords);
      setMappings((current) =>
        Object.fromEntries(Object.entries(current).filter(([recordId]) => !importedRecordIds.has(recordId)))
      );
      setUploadProgress({ current: 0, total: 0 });
      setSourceFilter("all");

      if (remainingRecords.length === 0) {
        setFileName("");
        setSourceSheetName("");
        setParseIssues([]);
        setSkippedRows([]);
        setFileInputKey((current) => current + 1);
      }

      toast.success(`Imported ${importableRecords.length} equipment rows.`);
    } catch (error) {
      console.error("Failed to import equipment workbook:", error);
      toast.error("Equipment import failed before all rows were saved.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-0 py-4">
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Migration</p>
            <h1 className="text-2xl font-bold text-slate-950">Equipment Import</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Upload the equipment workbook after customers, service locations, and pools have been moved into Drip Drop.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/migration"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Migration Dashboard
            </Link>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || companyData.loading || importableRecords.length === 0}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {uploading ? `Importing ${uploadProgress.current}/${uploadProgress.total}` : "Import Confirmed Equipment"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Equipment workbook</span>
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <button
                type="button"
                onClick={() => setSourceFilter("all")}
                className={sourceFilterCardClass({ active: sourceFilter === "all" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rows</p>
                <p className="text-2xl font-bold text-slate-950">{summary.rows}</p>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("matched")}
                className={sourceFilterCardClass({ active: sourceFilter === "matched", tone: "emerald" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Matched</p>
                <p className="text-2xl font-bold text-emerald-950">{summary.matchedRows}</p>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("needsMapped")}
                className={sourceFilterCardClass({ active: sourceFilter === "needsMapped", tone: "red" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Needs Mapping</p>
                <p className="text-2xl font-bold text-red-950">{summary.needsMappedRows}</p>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("inspect")}
                className={sourceFilterCardClass({ active: sourceFilter === "inspect", tone: "amber" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Inspect Match</p>
                <p className="text-2xl font-bold text-amber-950">{summary.inspectionRows}</p>
              </button>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updates</p>
                <p className="text-2xl font-bold text-slate-950">{summary.updateRows}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Creates</p>
                <p className="text-2xl font-bold text-slate-950">{summary.createRows}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</p>
                <p className="text-2xl font-bold text-slate-950">{summary.serviceTrackedRows}</p>
              </div>
            </div>

            {sourceSheetName && (
              <div className="mt-4 border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                Parsed sheet <span className="font-semibold">{sourceSheetName}</span> from {fileName}.
              </div>
            )}

            {lastImportSummary && (
              <div className="mt-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Imported {lastImportSummary.rows} rows in batch {lastImportSummary.importBatchId}. Updated {lastImportSummary.updateRows} and created {lastImportSummary.createRows}.
              </div>
            )}

            {parseIssues.length > 0 && (
              <div className="mt-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Rows to review</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {parseIssues.slice(0, 8).map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
                {parseIssues.length > 8 && (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide">
                    {parseIssues.length - 8} more issue{parseIssues.length - 8 === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            )}

            <div className="mt-5 overflow-x-auto border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="min-w-[220px] px-3 py-2 text-left">Source</th>
                    <th className="min-w-[230px] px-3 py-2 text-left">Customer</th>
                    <th className="min-w-[260px] px-3 py-2 text-left">Location</th>
                    <th className="min-w-[180px] px-3 py-2 text-left">Pool</th>
                    <th className="min-w-[260px] px-3 py-2 text-left">Equipment</th>
                    <th className="min-w-[300px] px-3 py-2 text-left">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {previewRecords.map((record) => {
                    const serviceLocationOptions = getServiceLocationOptions(record.mapping.customerId);
                    const bodyOfWaterOptions = getBodyOfWaterOptions(record.mapping.serviceLocationId);
                    const targetSelectValue = record.mapping.targetAction === "create"
                      ? CREATE_NEW_TARGET_VALUE
                      : record.targetEquipment?.id || record.mapping.targetEquipmentId || "";

                    return (
                      <tr key={record.id} className="align-top">
                        <td className="px-3 py-3 font-semibold text-slate-700">{record.rowNumber}</td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-950">{record.customerName}</p>
                          <p className="mt-1 text-xs text-slate-500">{record.streetAddress}</p>
                          {record.bodyOfWaterName && (
                            <p className="mt-1 text-xs text-slate-500">BOW: {record.bodyOfWaterName}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Select
                            value={customerOptionsById.get(record.mapping.customerId) || null}
                            onChange={(option) => handleCustomerChange(record.id, option?.value || "")}
                            options={customerOptions}
                            isClearable
                            isLoading={companyData.loading}
                            placeholder={companyData.loading ? "Loading customers..." : "Search customer"}
                            noOptionsMessage={() => "No customers found"}
                            formatOptionLabel={formatCustomerOption}
                            filterOption={(option, inputValue) =>
                              option.data.searchText.toLowerCase().includes(inputValue.toLowerCase())
                            }
                            theme={selectTheme}
                            styles={customerSelectStyles}
                            menuPortalTarget={selectPortalTarget}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={record.mapping.serviceLocationId || ""}
                            onChange={(event) => handleServiceLocationChange(record.id, event.target.value)}
                            disabled={!record.mapping.customerId}
                            className={selectClassName}
                          >
                            <option value="">Select location...</option>
                            {serviceLocationOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={record.mapping.bodyOfWaterId || ""}
                            onChange={(event) => handleBodyOfWaterChange(record.id, event.target.value)}
                            disabled={!record.mapping.serviceLocationId}
                            className={selectClassName}
                          >
                            <option value="">Select pool...</option>
                            {bodyOfWaterOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-950">{record.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[record.type, record.make, record.model].filter(Boolean).join(" / ")}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {record.hasService
                              ? `Service every ${record.frequency || "-"} ${record.frequencyUnit}`
                              : "No routine service"}
                          </p>
                          {(record.lastServiceDate || record.nextServiceDate) && (
                            <p className="mt-1 text-xs text-slate-500">
                              {record.lastServiceDate ? `Last ${formatDateLabel(record.lastServiceDate)}` : ""}
                              {record.lastServiceDate && record.nextServiceDate ? " | " : ""}
                              {record.nextServiceDate ? `Next ${formatDateLabel(record.nextServiceDate)}` : ""}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {record.mappingReady ? (
                            <div className="space-y-2">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                record.needsInspection || record.needsOverwriteChoice
                                  ? "bg-amber-100 text-amber-700"
                                  : record.targetEquipment
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-emerald-100 text-emerald-700"
                              }`}>
                                {record.needsInspection
                                  ? "Inspect match"
                                  : record.needsOverwriteChoice
                                    ? "Choose overwrite"
                                    : record.targetEquipment
                                      ? "Update existing"
                                      : "Create new"}
                              </span>
                              {record.targetCandidates.length > 0 && (
                                <div className="space-y-1">
                                  <select
                                    value={targetSelectValue}
                                    onChange={(event) => handleTargetEquipmentChange(record.id, event.target.value)}
                                    className={selectClassName}
                                  >
                                    {!targetSelectValue && (
                                      <option value="">Choose create or overwrite...</option>
                                    )}
                                    <option value={CREATE_NEW_TARGET_VALUE}>Create new equipment</option>
                                    {record.targetCandidates.map((equipment) => (
                                      <option key={equipment.id} value={equipment.id}>
                                        Overwrite {equipmentTargetLabel(equipment)} ({equipmentTargetMatchLabel(equipment.matchKind)})
                                      </option>
                                    ))}
                                  </select>
                                  {record.needsOverwriteChoice && (
                                    <p className="text-xs leading-5 text-amber-700">
                                      Existing {record.type} equipment was found for this pool. Pick one to overwrite, or choose create new.
                                    </p>
                                  )}
                                </div>
                              )}
                              {record.needsInspection && (
                                <div className="space-y-2">
                                  <p className="text-xs leading-5 text-amber-700">
                                    {record.inspectionReason || "Review this mapped row before import."}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => handleConfirmInspection(record.id)}
                                    className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-200"
                                  >
                                    Confirm
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                              Needs mapping
                            </span>
                          )}
                          {record.targetEquipment && (
                            <p className="mt-2 text-xs text-slate-500">
                              {equipmentTargetLabel(record.targetEquipment)}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {previewRecords.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                        Upload an equipment workbook to preview rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {filteredRecords.length > previewRecords.length && (
              <p className="mt-3 text-sm text-slate-500">
                Showing {previewRecords.length} of {filteredRecords.length} rows in this filter.
              </p>
            )}
          </section>

          <aside className="space-y-4">
            <section className="border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">Workbook Format</h2>
              <div className="mt-3 space-y-3 text-sm text-slate-600">
                <p>Use the first sheet named Equipment, with the import headers on row 2 like the sample workbook.</p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Required columns</p>
                  <p className="mt-1 text-slate-700">{EQUIPMENT_IMPORT_REQUIRED_COLUMNS.join(", ")}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optional columns read</p>
                  <p className="mt-1 text-slate-700">{EQUIPMENT_IMPORT_OPTIONAL_COLUMNS.join(", ")}</p>
                </div>
              </div>
            </section>

            <section className="border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">Matching</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>Rows match by customer name and street address. If the address misses but the customer name is clear, the row falls back to that customer and stays marked for inspection.</p>
                <p>Pump and filter placeholders from the customer export are updated when the type matches.</p>
              </div>
            </section>

            {skippedRows.length > 0 && (
              <section className="border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">Skipped Rows</h2>
                <div className="mt-3 space-y-2">
                  {skippedRows.slice(0, 8).map((row) => (
                    <div key={row.id} className="border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Row {row.rowNumber}: {row.reason}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export default EquipmentImport;
