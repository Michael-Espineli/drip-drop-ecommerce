import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { collection, doc, getDocs, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  MURDOCK_POOL_SERVICE_ONLY_LABEL,
  PERFORMANCE_HISTORY_IMPORT_COLUMNS,
  SKIP_TECHNICIAN_VALUE,
  TARGET_PERFORMANCE_IMPORT_COMPANY_ID,
  buildAutoTechnicianMappings,
  buildTechnicianGroups,
  formatDateLabel,
  getCompanyUserDisplayName,
  getTechnicianGroupKey,
  normalizeText,
  parsePerformanceHistoryRows,
  summarizePerformanceHistoryRecords,
} from "./performanceHistoryImportUtils";

const MAX_WRITES_PER_BATCH = 450;

const createImportBatchId = () => `performance_history_${Date.now().toString(36)}`;

const performanceReviewsRef = (companyId, companyUserId) => (
  collection(db, "companyUserPerformanceReviews", companyId, "companyUsers", companyUserId, "reviews")
);

const commitBatch = async (batchState) => {
  if (batchState.writeCount === 0) return;
  await batchState.batch.commit();
  batchState.batch = writeBatch(db);
  batchState.writeCount = 0;
};

const sourceFilterCards = [
  { value: "all", label: "All rows", tone: "slate" },
  { value: "ready", label: "Ready", tone: "emerald" },
  { value: "needsMapped", label: "Needs mapping", tone: "amber" },
  { value: "disabled", label: "Disabled", tone: "slate" },
  { value: "skipped", label: "Skipped techs", tone: "red" },
];

const statusToneClasses = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

const filterButtonClass = ({ active, tone = "slate" }) => {
  const activeClasses = {
    emerald: "border-emerald-300 bg-emerald-100 ring-2 ring-emerald-200",
    amber: "border-amber-300 bg-amber-100 ring-2 ring-amber-200",
    red: "border-red-300 bg-red-100 ring-2 ring-red-200",
    slate: "border-blue-300 bg-blue-50 ring-2 ring-blue-200",
  };
  const inactiveClasses = {
    emerald: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
    amber: "border-amber-200 bg-amber-50 hover:bg-amber-100",
    red: "border-red-200 bg-red-50 hover:bg-red-100",
    slate: "border-slate-200 bg-slate-50 hover:bg-slate-100",
  };

  return [
    "rounded-lg border px-3 py-2 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-200",
    active ? activeClasses[tone] : inactiveClasses[tone],
  ].join(" ");
};

const selectClassName = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const StatCard = ({ label, value, tone = "slate" }) => (
  <div className={`rounded-lg border p-4 ${statusToneClasses[tone] || statusToneClasses.slate}`}>
    <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
    <p className="mt-2 text-2xl font-bold">{value}</p>
  </div>
);

const MurdockOnlyBadge = () => (
  <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
    {MURDOCK_POOL_SERVICE_ONLY_LABEL}
  </span>
);

const buildSourceReferenceText = (record) => {
  const sourceBits = [
    record.referenceCustomer ? `Customer: ${record.referenceCustomer}` : "",
    record.referenceJobDescription ? `Job: ${record.referenceJobDescription}` : "",
    record.signer ? `Signer: ${record.signer}` : "",
    record.sourceFile ? `Source: ${record.sourceFile}` : "",
  ].filter(Boolean);

  return sourceBits.length ? `Source reference: ${sourceBits.join(" | ")}` : "";
};

function PerformanceHistoryImport() {
  const { recentlySelectedCompany, user: authUser, dataBaseUser } = useContext(Context);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [companyUsersLoading, setCompanyUsersLoading] = useState(false);
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

  const isTargetCompany = recentlySelectedCompany === TARGET_PERFORMANCE_IMPORT_COMPANY_ID;

  const loadCompanyUsers = useCallback(async () => {
    if (!isTargetCompany) {
      setCompanyUsers([]);
      setCompanyUsersLoading(false);
      return;
    }

    setCompanyUsersLoading(true);
    try {
      const snapshot = await getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers"));
      setCompanyUsers(
        snapshot.docs
          .map((companyUserDoc) => ({ id: companyUserDoc.id, ...companyUserDoc.data() }))
          .sort((left, right) => getCompanyUserDisplayName(left).localeCompare(getCompanyUserDisplayName(right)))
      );
    } catch (error) {
      console.error("Failed to load company users for performance import:", error);
      toast.error("Could not load company users for technician mapping.");
      setCompanyUsers([]);
    } finally {
      setCompanyUsersLoading(false);
    }
  }, [isTargetCompany, recentlySelectedCompany]);

  useEffect(() => {
    loadCompanyUsers();
  }, [loadCompanyUsers]);

  useEffect(() => {
    if (!records.length || !companyUsers.length) return;

    const autoMappings = buildAutoTechnicianMappings(records, companyUsers);
    const groups = buildTechnicianGroups(records, {});

    setMappings((current) => {
      const nextMappings = {};
      groups.forEach((group) => {
        nextMappings[group.key] = current[group.key] ?? autoMappings[group.key] ?? "";
      });
      return nextMappings;
    });
  }, [companyUsers, records]);

  const companyUsersById = useMemo(
    () => new Map(companyUsers.map((companyUser) => [companyUser.id, companyUser])),
    [companyUsers]
  );

  const technicianGroups = useMemo(
    () => buildTechnicianGroups(records, mappings),
    [mappings, records]
  );

  const summary = useMemo(
    () => summarizePerformanceHistoryRecords(records, technicianGroups),
    [records, technicianGroups]
  );

  const enrichedRecords = useMemo(
    () =>
      records.map((record) => {
        const groupKey = getTechnicianGroupKey(record);
        const mappingValue = mappings[groupKey] || "";
        const companyUser = mappingValue && mappingValue !== SKIP_TECHNICIAN_VALUE
          ? companyUsersById.get(mappingValue)
          : null;

        return {
          ...record,
          groupKey,
          mappingValue,
          companyUser,
          isSkipped: mappingValue === SKIP_TECHNICIAN_VALUE,
          isReady: Boolean(record.importEnabled && companyUser),
          needsMapping: Boolean(record.importEnabled && !mappingValue),
        };
      }),
    [companyUsersById, mappings, records]
  );

  const importableRecords = useMemo(
    () => enrichedRecords.filter((record) => record.isReady),
    [enrichedRecords]
  );

  const skippedTechnicianRecords = useMemo(
    () => enrichedRecords.filter((record) => record.importEnabled && record.isSkipped),
    [enrichedRecords]
  );

  const filteredRecords = useMemo(
    () =>
      enrichedRecords.filter((record) => {
        if (sourceFilter === "ready") return record.isReady;
        if (sourceFilter === "needsMapped") return record.needsMapping;
        if (sourceFilter === "disabled") return !record.importEnabled;
        if (sourceFilter === "skipped") return record.importEnabled && record.isSkipped;
        return true;
      }),
    [enrichedRecords, sourceFilter]
  );

  const previewRecords = useMemo(() => filteredRecords.slice(0, 150), [filteredRecords]);

  const reviewerName = (
    dataBaseUser?.userName ||
    dataBaseUser?.displayName ||
    dataBaseUser?.firstName ||
    authUser?.displayName ||
    authUser?.email ||
    "Migration Import"
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
      setMappings({});
      setUploadProgress({ current: 0, total: 0 });
      setFileInputKey((current) => current + 1);
      return;
    }

    setFileName(selectedFile.name);
    setSourceSheetName("");
    setRecords([]);
    setParseIssues([]);
    setSkippedRows([]);
    setMappings({});
    setUploadProgress({ current: 0, total: 0 });

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: "array", cellDates: true });
        const importSheetName =
          workbook.SheetNames.find((sheetName) => normalizeText(sheetName) === "importrecords") ||
          workbook.SheetNames[0];
        const worksheet = workbook.Sheets[importSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        const missingColumns = PERFORMANCE_HISTORY_IMPORT_COLUMNS.filter((column) => !headers.includes(column));
        const parsed = parsePerformanceHistoryRows(rows);

        setSourceSheetName(importSheetName);
        setRecords(parsed.records);
        setParseIssues([
          ...parsed.issues,
          ...(missingColumns.length ? [`Workbook is missing expected columns: ${missingColumns.join(", ")}.`] : []),
        ]);
        setSkippedRows(parsed.skippedRows);
        setSourceFilter("all");

        if (parsed.records.length) {
          toast.success(`Parsed ${parsed.records.length} performance history rows.`);
        } else {
          toast.error("No importable performance history rows were found.");
        }
      } catch (error) {
        console.error("Failed to parse performance history workbook:", error);
        setParseIssues(["Could not read this Excel file as a performance history import workbook."]);
        toast.error("Could not parse this workbook.");
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const handleMappingChange = useCallback((groupKey, value) => {
    setMappings((current) => ({
      ...current,
      [groupKey]: value,
    }));
  }, []);

  const handleUpload = async () => {
    if (!isTargetCompany) {
      toast.error(`This importer is ${MURDOCK_POOL_SERVICE_ONLY_LABEL}.`);
      return;
    }

    if (!importableRecords.length) {
      toast.error("Map at least one enabled row to a company user before importing.");
      return;
    }

    const confirmed = window.confirm(
      `Import ${importableRecords.length} performance history rows? ${skippedTechnicianRecords.length} enabled rows are mapped to skipped technicians and ${summary.disabledRows} rows are disabled in the workbook.`
    );
    if (!confirmed) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: importableRecords.length });

    const importBatchId = createImportBatchId();
    const importedAt = new Date();
    const importedAtTimestamp = Timestamp.fromDate(importedAt);
    const batchState = {
      batch: writeBatch(db),
      writeCount: 0,
    };
    let processedCount = 0;

    try {
      for (const record of importableRecords) {
        if (batchState.writeCount + 1 > MAX_WRITES_PER_BATCH) {
          await commitBatch(batchState);
        }

        const companyUser = record.companyUser;
        const reviewDate = Timestamp.fromDate(record.date || importedAt);
        const sourceReferenceText = buildSourceReferenceText(record);
        const note = [record.note, sourceReferenceText].filter(Boolean).join("\n\n");
        const reviewRef = doc(performanceReviewsRef(recentlySelectedCompany, companyUser.id));
        const payload = {
          type: record.recordType,
          title: record.title,
          note,
          date: reviewDate,
          references: {
            serviceStops: [],
            jobs: [],
          },
          sourceReferences: {
            customerName: record.referenceCustomer,
            jobDescription: record.referenceJobDescription,
          },
          attachedReports: [],
          attachments: [],
          visibleToTechnician: Boolean(record.visibleToTechnician),
          isSummaryReport: false,
          companyInternal: true,
          companyId: recentlySelectedCompany,
          companyUserId: companyUser.id,
          technicianUserId: companyUser.userId || "",
          technicianName: getCompanyUserDisplayName(companyUser),
          createdByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
          createdByName: reviewerName,
          migrationSource: {
            source: "performanceHistoryImport",
            importBatchId,
            importKey: record.importKey,
            sourceTechnician: record.sourceTechnician,
            suggestedTechnician: record.suggestedTechnician,
            sourceKind: record.sourceKind,
            sourceFile: record.sourceFile,
            sourceSheet: record.sourceSheet,
            sourceRow: record.sourceRow,
            sourceTable: record.sourceTable,
            originalDateText: record.originalDateText,
            confidence: record.confidence,
            parseNotes: record.parseNotes,
            importedAt: importedAtTimestamp,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        batchState.batch.set(reviewRef, payload);
        batchState.writeCount += 1;
        processedCount += 1;

        if (processedCount % 50 === 0) {
          setUploadProgress({ current: processedCount, total: importableRecords.length });
        }
      }

      await commitBatch(batchState);
      setUploadProgress({ current: importableRecords.length, total: importableRecords.length });
      setLastImportSummary({
        importBatchId,
        importedRows: importableRecords.length,
        skippedRows: skippedTechnicianRecords.length,
        disabledRows: summary.disabledRows,
      });

      const handledRecordIds = new Set([
        ...importableRecords.map((record) => record.id),
        ...skippedTechnicianRecords.map((record) => record.id),
      ]);
      setRecords((current) => current.filter((record) => !handledRecordIds.has(record.id)));
      setMappings((current) => (
        Object.fromEntries(Object.entries(current).filter(([groupKey]) => (
          records.some((record) => getTechnicianGroupKey(record) === groupKey && !handledRecordIds.has(record.id))
        )))
      ));
      setUploadProgress({ current: 0, total: 0 });
      setSourceFilter("all");
      toast.success(`Imported ${importableRecords.length} performance history rows.`);
    } catch (error) {
      console.error("Failed to import performance history workbook:", error);
      toast.error("Performance history import failed before all rows were saved.");
    } finally {
      setUploading(false);
    }
  };

  if (!isTargetCompany) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h1 className="text-lg font-semibold">Performance History Import</h1>
              <div className="mt-2">
                <MurdockOnlyBadge />
              </div>
              <p className="mt-1 text-sm">
                This {MURDOCK_POOL_SERVICE_ONLY_LABEL} importer is only available for {TARGET_PERFORMANCE_IMPORT_COMPANY_ID}.
              </p>
              <Link className="mt-3 inline-flex text-sm font-semibold text-amber-900 underline" to="/company/migration">
                Back to migration dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-0 py-4">
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Migration</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-950">Performance History Import</h1>
              <MurdockOnlyBadge />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {MURDOCK_POOL_SERVICE_ONLY_LABEL} upload for {TARGET_PERFORMANCE_IMPORT_COMPANY_ID}.
            </p>
          </div>
          <Link
            to="/company/migration"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Back to migration
          </Link>
        </div>

        <section className="mx-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Upload compiled workbook</h2>
              <p className="mt-1 text-sm text-slate-500">
                Use the workbook with an Import Records sheet. Disabled rows stay available for review but are not uploaded.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
              <ArrowUpTrayIcon className="h-4 w-4" />
              Choose workbook
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>
          {fileName && (
            <p className="mt-3 text-sm text-slate-600">
              Loaded <span className="font-semibold text-slate-900">{fileName}</span>
              {sourceSheetName ? ` from ${sourceSheetName}.` : "."}
            </p>
          )}
        </section>

        {parseIssues.length > 0 && (
          <section className="mx-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex gap-2">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Review parser notes</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {parseIssues.slice(0, 8).map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {lastImportSummary && (
          <section className="mx-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="flex gap-2">
              <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Last import complete</p>
                <p className="mt-1">
                  Imported {lastImportSummary.importedRows} rows. Batch {lastImportSummary.importBatchId}.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="mx-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard label="Rows" value={summary.rows} />
          <StatCard label="Enabled" value={summary.enabledRows} tone="emerald" />
          <StatCard label="Ready" value={summary.mappedRows} tone="emerald" />
          <StatCard label="Needs map" value={summary.needsMappedRows} tone="amber" />
          <StatCard label="Skipped" value={summary.skippedRows} tone="red" />
          <StatCard label="Disabled" value={summary.disabledRows} />
        </section>

        {records.length > 0 && (
          <section className="mx-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Technician mapping</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Map each source technician to a company user or skip that technician.
                </p>
              </div>
              <button
                type="button"
                onClick={loadCompanyUsers}
                disabled={companyUsersLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowPathIcon className={`h-4 w-4 ${companyUsersLoading ? "animate-spin" : ""}`} />
                Refresh users
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Suggested</th>
                    <th className="px-3 py-2">Rows</th>
                    <th className="px-3 py-2">Map to company user</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {technicianGroups.map((group) => (
                    <tr key={group.key}>
                      <td className="px-3 py-3 font-medium text-slate-900">{group.sourceTechnician}</td>
                      <td className="px-3 py-3 text-slate-700">{group.suggestedTechnician}</td>
                      <td className="px-3 py-3 text-slate-600">
                        {group.enabledRecords} enabled / {group.totalRecords} total
                        {group.disabledRecords > 0 && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                            {group.disabledRecords} disabled
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <select
                          className={selectClassName}
                          value={group.mappingValue}
                          onChange={(event) => handleMappingChange(group.key, event.target.value)}
                        >
                          <option value="">Choose company user</option>
                          <option value={SKIP_TECHNICIAN_VALUE}>Skip this technician</option>
                          {companyUsers.map((companyUser) => (
                            <option key={companyUser.id} value={companyUser.id}>
                              {getCompanyUserDisplayName(companyUser)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {records.length > 0 && (
          <section className="mx-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Preview</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Showing {previewRecords.length} of {filteredRecords.length} rows for the selected filter.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {sourceFilterCards.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={filterButtonClass({ active: sourceFilter === filter.value, tone: filter.tone })}
                    onClick={() => setSourceFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Technician</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {previewRecords.map((record) => (
                    <tr key={`${record.id}-${record.rowNumber}`}>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          record.isReady
                            ? "bg-emerald-50 text-emerald-700"
                            : !record.importEnabled
                              ? "bg-slate-100 text-slate-600"
                              : record.isSkipped
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
                        }`}>
                          {record.isReady ? "Ready" : !record.importEnabled ? "Disabled" : record.isSkipped ? "Skipped" : "Needs map"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{record.suggestedTechnician}</td>
                      <td className="px-3 py-3 capitalize text-slate-700">{record.recordType}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDateLabel(record.date)}</td>
                      <td className="max-w-xl px-3 py-3 text-slate-700">
                        <p className="font-medium text-slate-900">{record.title}</p>
                        <p className="mt-1 line-clamp-3">{record.note}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {[record.sourceFile, record.sourceSheet || record.sourceTable, record.sourceRow ? `row ${record.sourceRow}` : ""].filter(Boolean).join(" / ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {skippedRows.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                {skippedRows.length} workbook rows were skipped during parsing because they were blank or missing required values.
              </p>
            )}
          </section>
        )}

        <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              {uploading
                ? `Uploading ${uploadProgress.current} of ${uploadProgress.total} rows...`
                : `${importableRecords.length} rows ready to import.`}
            </p>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || importableRecords.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {uploading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
              Import performance history
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PerformanceHistoryImport;
