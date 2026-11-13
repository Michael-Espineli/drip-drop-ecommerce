import WorkspaceHeader from "../../../components/workspace/WorkspaceHeader";
import { reportDisplayValue, visibleReportColumns } from '../../../utils/reports/reportDisplay';
import { individualReportDataForGroup, individualPerformanceNoteText, individualCustomerPerformanceNoteText } from "../../../utils/reports/reportPerformance";
import { safeFilePart, reportFileName, reportRowsForExport, reportSummarySheetRows, csvCell, printableReportHtml } from "../../../utils/reports/reportExport";
import { generateReport, loadReportSources, validateReportOptions } from "../../../utils/reports/reportRuntime";
import { dateRangePresets, defaultDateRange, sanitizeDateRange, readingOperatorOptions, dateFromValue, formatDecimal, readingTemplateKey, readingTemplateLabel, sortReadingTemplates, defaultReadingHealthFilterFor, withReadingPerformanceStandardId, defaultReadingPerformanceStandardsFor, parseReadingNumber, activeReadingPerformanceStandards } from "../../../utils/reports/reportEngine";
import { reportCategories, reportCatalog, fixedGroupingReportTypes, payrollOnlyReportTypes, readingPerformanceViewOptions, groupOptions } from "../../../utils/reports/reportCatalog";
import { userFacingErrorMessage } from '../../../utils/permissionErrors';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { Link, useSearchParams } from "react-router-dom";

import {
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PrinterIcon,
  TableCellsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db, storage } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  filterCustomersByRegionalAccess,
  getCustomerRegionAccessTags,
  getCustomerTagOptions,
} from "../../../utils/customerTags";
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from "../../../utils/models/FeatureFlag";

const normalizeDocs = (snapshot) => snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }));

const getCollection = async (companyId, collectionName) => {
  const snap = await getDocs(collection(db, "companies", companyId, collectionName));
  return normalizeDocs(snap);
};

const customReportDocRef = (companyId, reportId) => doc(db, "companies", companyId, "customReports", reportId);

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const exportReportCsv = (reportData) => {
  if (!reportData) {
    toast.error("Generate a report before exporting.");
    return;
  }

  const columnLabels = ["Group", ...reportData.columns.map((column) => column.label)];
  const csvRows = [
    ...reportSummarySheetRows(reportData),
    [],
    columnLabels,
    ...reportRowsForExport(reportData).map((row) => columnLabels.map((label) => row[label] || "")),
  ];
  const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), reportFileName(reportData, "csv"));
  toast.success("CSV export ready.");
};

const exportReportExcel = (reportData) => {
  if (!reportData) {
    toast.error("Generate a report before exporting.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(reportSummarySheetRows(reportData));
  const rows = reportRowsForExport(reportData);
  const dataSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Message: "No rows in this report." }]);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Report Data");
  XLSX.writeFile(workbook, reportFileName(reportData, "xlsx"));
  toast.success("Excel export ready.");
};

const exportReportPdf = (reportData) => {
  if (!reportData) {
    toast.error("Generate a report before exporting.");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Allow popups to export PDF.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(printableReportHtml(reportData));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
};

const performanceReviewsRef = (companyId, companyUserId) => (
  collection(db, "companyUserPerformanceReviews", companyId, "companyUsers", companyUserId, "reviews")
);

const customerNotesDocRef = (companyId, customerId, noteId) => (
  doc(db, "companies", companyId, "customers", customerId, "notes", noteId)
);

const ReportSummaryBar = ({ stats = [], total }) => {
  const items = total ? [...stats, { ...total, emphasized: true }] : stats;
  if (!items.length) return null;

  return (
    <div className="mt-3 flex gap-2 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-2">
      {items.map((item) => (
        <div
          key={item.label}
          className={`min-w-[150px] shrink-0 px-3 py-1.5 ${item.emphasized
            ? "rounded-md bg-slate-900 text-white"
            : "border-r border-slate-200 last:border-r-0"
            }`}
        >
          <p className={`text-[11px] font-semibold uppercase ${item.emphasized ? "text-slate-300" : "text-slate-500"}`}>{item.label}</p>
          <p className={`mt-0.5 break-words text-sm font-bold leading-snug ${item.emphasized ? "text-white" : "text-slate-900"}`}>{item.value}</p>
          {item.subtitle ? <p className={`mt-0.5 text-xs leading-snug ${item.emphasized ? "text-slate-300" : "text-slate-500"}`}>{item.subtitle}</p> : null}
        </div>
      ))}
    </div>
  );
};

const ReportCatalogCard = ({ report, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(report.value)}
    className={`h-full w-full min-w-0 rounded-lg border p-3 text-left shadow-sm transition ${selected ? "border-blue-600 bg-blue-50 text-slate-950 ring-1 ring-blue-600" : "border-slate-200 bg-white text-slate-900 hover:border-blue-300 hover:bg-blue-50"
      }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 break-words">
        <p className="font-bold">{report.label}</p>
        <p className={`mt-1 text-xs ${selected ? "text-slate-600" : "text-slate-600"}`}>{report.source}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selected ? "bg-slate-900 text-white" : "bg-blue-50 text-blue-700"}`}>
        {report.status}
      </span>
    </div>
  </button>
);

const ReportTable = ({ columns: sourceColumns, rows, footerRow }) => {
  const columns = visibleReportColumns(sourceColumns);
  return (
  <div className="mt-4 max-w-full overflow-x-auto">
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          {columns.map((column) => (
            <th key={column.key} className={`py-2 pr-4 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((row, index) => (
          <tr key={row.id || `${row.name || "row"}-${index}`} className="border-b border-slate-100 align-top last:border-0">
            {columns.map((column) => (
              <td key={column.key} className={`py-2 pr-4 ${column.align === "right" ? "text-right font-semibold text-slate-900" : "text-slate-700"}`}>
                {reportDisplayValue(column.render ? column.render(row) : row[column.key] ?? "-", column.label || 'Record')}
              </td>
            ))}
          </tr>
        )) : (
          <tr>
            <td className="py-4 text-slate-500" colSpan={columns.length}>No rows in this group.</td>
          </tr>
        )}
      </tbody>
      {footerRow ? (
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
            {columns.map((column) => (
              <td key={column.key} className={`py-3 pr-4 ${column.align === "right" ? "text-right" : ""}`}>
                {reportDisplayValue(column.render ? column.render(footerRow) : footerRow[column.key] || (column.key === columns[0].key ? "Total" : ""), column.label || 'Record')}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  </div>
  );
};

const SummarySectionsView = ({ sections = [] }) => {
  if (!sections.length) return null;

  return (
    <div className="grid gap-3">
      {sections.map((section) => (
        <div key={section.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{section.title}</h3>
          <ReportTable columns={section.columns || []} rows={section.rows || []} />
        </div>
      ))}
    </div>
  );
};

const AverageLineChart = ({ item, chartRange }) => {
  const points = Array.isArray(item?.chartPoints) ? item.chartPoints : [];
  if (!points.length) {
    return (
      <div className="mt-3 flex aspect-[16/7] items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-500">
        No chart data
      </div>
    );
  }

  const width = 640;
  const height = 240;
  const margin = { top: 18, right: 18, bottom: 34, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => point.average).filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMin === rawMax ? Math.max(Math.abs(rawMax) * 0.1, 1) : (rawMax - rawMin) * 0.12;
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;
  const yRange = yMax - yMin || 1;
  const start = dateFromValue(chartRange?.start) || dateFromValue(points[0]?.date);
  const end = dateFromValue(chartRange?.end) || dateFromValue(points[points.length - 1]?.date);
  const startTime = start?.getTime() || 0;
  const endTime = end?.getTime() || startTime;
  const timeRange = endTime - startTime;
  const lineColor = item.type === "Dosage" ? "#0f766e" : "#2563eb";
  const xForPoint = (point, index) => {
    if (timeRange <= 0) {
      return points.length === 1
        ? margin.left + plotWidth / 2
        : margin.left + (index / (points.length - 1)) * plotWidth;
    }

    const pointDate = dateFromValue(point.date);
    const ratio = pointDate ? (pointDate.getTime() - startTime) / timeRange : index / Math.max(points.length - 1, 1);
    return margin.left + Math.min(Math.max(ratio, 0), 1) * plotWidth;
  };
  const yForValue = (value) => margin.top + (1 - ((value - yMin) / yRange)) * plotHeight;
  const ticks = Array.from({ length: 4 }, (_, index) => yMin + (yRange / 3) * index).reverse();
  const xLabels = [
    start ? format(start, "M/d") : points[0]?.dateLabel,
    end ? format(end, "M/d") : points[points.length - 1]?.dateLabel,
  ].filter(Boolean);
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xForPoint(point, index)} ${yForValue(point.average)}`)
    .join(" ");

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="block aspect-[16/6] w-full overflow-visible">
        <rect x="0" y="0" width={width} height={height} rx="8" fill="#f8fafc" />
        {ticks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {formatDecimal(tick)}
              </text>
            </g>
          );
        })}
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#cbd5e1" />
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#cbd5e1" />

        {points.length > 1 ? (
          <path d={linePath} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {points.map((point, index) => {
          const x = xForPoint(point, index);
          const averageY = yForValue(point.average);
          return (
            <g key={point.id}>
              <title>
                {`${point.dateLabel}: average ${formatDecimal(point.average)}${item.unit ? ` ${item.unit}` : ""}`}
              </title>
              <circle cx={x} cy={averageY} r="4.5" fill="#ffffff" stroke={lineColor} strokeWidth="2.5" />
            </g>
          );
        })}

        {xLabels.map((label, index) => (
          <text
            key={`${label}-${index}`}
            x={index === 0 ? margin.left : width - margin.right}
            y={height - 10}
            textAnchor={index === 0 ? "start" : "end"}
            fontSize="11"
            fill="#64748b"
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
};

const ChartSectionsView = ({ sections = [], chartRange }) => {
  const populatedSections = sections
    .map((section) => ({
      ...section,
      items: (section.items || []).filter((item) => item.chartPoints?.length),
    }))
    .filter((section) => section.items.length);

  if (!populatedSections.length) return null;

  return (
    <div className="grid gap-4">
      {populatedSections.map((section) => (
        <section key={section.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{section.title}</h3>
          <div className="mt-3 grid gap-3 2xl:grid-cols-2">
            {section.items.map((item) => (
              <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-bold text-slate-900">{item.name}</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Avg {formatDecimal(item.average)}{item.unit ? ` ${item.unit}` : ""} | Low {formatDecimal(item.low)} | High {formatDecimal(item.high)}
                    </p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                    {item.count.toLocaleString()} pts
                  </span>
                </div>
                <AverageLineChart item={item} chartRange={chartRange} />
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const GeneratedReportView = ({ data }) => {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState(new Set());

  useEffect(() => {
    setCollapsedGroupIds(new Set());
  }, [data]);

  if (!data) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 shadow-sm xl:h-full xl:min-h-0">
        Generate a report to see results.
      </div>
    );
  }

  const groupIds = (data.groups || []).map((group) => group.id);
  const allGroupsCollapsed = groupIds.length > 0 && groupIds.every((id) => collapsedGroupIds.has(id));
  const toggleAllGroups = () => {
    setCollapsedGroupIds(allGroupsCollapsed ? new Set() : new Set(groupIds));
  };
  const toggleGroup = (groupId) => {
    setCollapsedGroupIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(groupId)) {
        nextIds.delete(groupId);
      } else {
        nextIds.add(groupId);
      }
      return nextIds;
    });
  };

  return (
    <section className="flex min-h-[560px] min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm xl:h-full xl:min-h-0">
      <div className="shrink-0 border-b border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{data.title || "Generated Report"}</h2>
            {data.description ? <p className="mt-1 text-sm text-slate-600">{data.description}</p> : null}
            {(data.warnings || []).map((warning) => <p key={warning} role="note" className="mt-2 text-sm font-semibold text-amber-700">{warning}</p>)}
          </div>
          {groupIds.length ? (
            <button
              type="button"
              onClick={toggleAllGroups}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              {allGroupsCollapsed ? "Expand All" : "Collapse All"}
            </button>
          ) : null}
        </div>

        <ReportSummaryBar stats={data.stats || []} total={data.total} />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        <SummarySectionsView sections={data.summarySections || []} />
        <ChartSectionsView sections={data.chartSections || []} chartRange={data.chartRange} />

        {data.groups.length ? (
          <div className={`${data.summarySections?.length || data.chartSections?.length ? "mt-4 " : ""}grid min-w-0 grid-cols-1 gap-3`}>
            {data.groups.map((group) => (
              <div key={group.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{reportDisplayValue(group.name, "Group")}</h3>
                    {Object.keys(group.metrics || {}).length ? (
                      <p className="mt-1 text-sm text-slate-500">
                        {Object.entries(group.metrics).map(([key, value]) => `${key}: ${typeof value === "number" ? value.toLocaleString() : value}`).join(" | ")}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                  >
                    {collapsedGroupIds.has(group.id) ? "Expand" : "Collapse"}
                  </button>
                </div>
                {!collapsedGroupIds.has(group.id) ? (
                  <ReportTable columns={data.columns} rows={group.rows} footerRow={group.footerRow} />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No data found for this date range.</div>
        )}
      </div>
    </section>
  );
};

const ExportSection = ({ reportData }) => {
  const disabled = !reportData;
  const buttonClass = (accent) =>
    `flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${accent === "dark"
      ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
    }`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Export</h3>
          <p className="mt-1 text-xs text-slate-500">Current report data</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => exportReportPdf(reportData)}
          className={buttonClass("dark")}
          title="Export PDF"
        >
          <PrinterIcon className="h-4 w-4" />
          PDF
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => exportReportExcel(reportData)}
            className={buttonClass()}
            title="Export Excel"
          >
            <TableCellsIcon className="h-4 w-4" />
            Excel
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => exportReportCsv(reportData)}
            className={buttonClass()}
            title="Export CSV"
          >
            <DocumentTextIcon className="h-4 w-4" />
            CSV
          </button>
        </div>
      </div>
    </div>
  );
};

const IndividualUsersExportSection = ({
  reportData,
  onCreatePerformanceNote,
  onCreateAllPerformanceNotes,
  creatingPerformanceNoteGroupId,
  isCreatingAllPerformanceNotes,
  copyPerformanceNotesToCustomerNotes,
  onCopyPerformanceNotesToCustomerNotesChange,
  canCreatePerformanceNotes,
  canCopyCustomerNotes,
}) => {
  const isEligible = reportData?.reportType === "readingPerformance" && reportData.performanceView === "users";
  if (!isEligible) return null;

  const groups = reportData.groups || [];
  const matchedGroups = groups.filter((group) => Boolean(group.companyUserId));
  const customerReferenceCount = matchedGroups.reduce(
    (total, group) => total + (group.customerReferences?.length || 0),
    0
  );
  const buttonClass = (accent) =>
    `inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${accent === "dark"
      ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
      : accent === "blue"
        ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
        : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
    }`;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Export Individual Users</h3>
        <p className="mt-1 text-xs text-slate-600">Export or attach one technician's report without including everyone else's scores.</p>
      </div>

      <label className="mt-3 flex items-start gap-2 rounded-md border border-blue-100 bg-white p-2 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          disabled={!canCopyCustomerNotes}
          checked={copyPerformanceNotesToCustomerNotes && canCopyCustomerNotes}
          onChange={(event) => onCopyPerformanceNotesToCustomerNotesChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        <span>
          Copy referenced customers to Customer Notes
          {customerReferenceCount ? ` (${customerReferenceCount})` : ""}
        </span>
      </label>

      <button
        type="button"
        disabled={!canCreatePerformanceNotes || !matchedGroups.length || isCreatingAllPerformanceNotes}
        onClick={() => onCreateAllPerformanceNotes(matchedGroups)}
        className={`${buttonClass("blue")} mt-3 w-full`}
        title={matchedGroups.length ? "Create performance notes for every matched technician" : "No matched technicians"}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        {isCreatingAllPerformanceNotes ? "Adding Reports..." : "Add All Reports to Technicians"}
      </button>

      <div className="mt-3 space-y-2">
        {groups.length ? (
          groups.map((group) => {
            const individualReport = individualReportDataForGroup(reportData, group);
            const isCreatingNote = creatingPerformanceNoteGroupId === group.id;
            const canCreateNote = canCreatePerformanceNotes && Boolean(group.companyUserId);

            return (
              <div key={group.id} className="rounded-md border border-blue-100 bg-white p-2">
                <div className="flex flex-col gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{reportDisplayValue(group.technicianName || group.name, "Technician")}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {canCreateNote ? "Matched to company user" : "Could not match this report row to a company user"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => exportReportPdf(individualReport)}
                      className={buttonClass("dark")}
                      title={`Export ${group.name} PDF`}
                    >
                      <PrinterIcon className="h-3.5 w-3.5" />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => exportReportExcel(individualReport)}
                      className={buttonClass()}
                      title={`Export ${group.name} Excel`}
                    >
                      <TableCellsIcon className="h-3.5 w-3.5" />
                      Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => exportReportCsv(individualReport)}
                      className={buttonClass()}
                      title={`Export ${group.name} CSV`}
                    >
                      <DocumentTextIcon className="h-3.5 w-3.5" />
                      CSV
                    </button>
                    <button
                      type="button"
                      disabled={!canCreateNote || isCreatingNote || isCreatingAllPerformanceNotes}
                      onClick={() => onCreatePerformanceNote(group)}
                      className={buttonClass("blue")}
                      title={canCreateNote ? `Create performance note for ${group.name}` : "No matched company user"}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      {isCreatingNote ? "Saving..." : "Note"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">No individual user groups in this report.</p>
        )}
      </div>
    </div>
  );
};

const Reports = () => {
  const {
    recentlySelectedCompany,
    companyRole,
    companyUserAccess,
    selectedCustomerRegionTag,
    user: authUser,
    dataBaseUser,
    featureFlagsLoaded,
    isFeatureEnabled,
  } = useContext(Context);
  const { can, permissionsReady } = useCompanyPermissions();
  const [searchParams] = useSearchParams();
  const customReportId = searchParams.get("customReportId") || "";
  const appliedCustomReportKeyRef = useRef("");
  const loadedCustomReportToastRef = useRef("");
  const canViewReports = can("870");
  const canViewCustomers = can("10");
  const canCreatePerformanceNotes = featureFlagsLoaded && isFeatureEnabled("feature_flag_003") && can("274");
  const canCopyCustomerNotes = canCreatePerformanceNotes && can("12");
  const canViewPayrollInformation = can("420");
  const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);
  const [reportType, setReportType] = useState("readings");
  const [mode, setMode] = useState("summary");
  const [groupBy, setGroupBy] = useState("company");
  const [availableCustomerTags, setAvailableCustomerTags] = useState([]);
  const [selectedCustomerTags, setSelectedCustomerTags] = useState([]);
  const [availableReadingTemplates, setAvailableReadingTemplates] = useState([]);
  const [readingHealthFilters, setReadingHealthFilters] = useState({
    templateId: "",
    operator: "gt",
    threshold: "",
  });
  const [readingPerformanceStandards, setReadingPerformanceStandards] = useState([]);
  const [readingPerformanceView, setReadingPerformanceView] = useState("users");
  const [quickDateRange, setQuickDateRange] = useState("thisMonth");
  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reportSearchDraft, setReportSearchDraft] = useState("");
  const [reportSearchTerm, setReportSearchTerm] = useState("");
  const [activeCustomReportTitle, setActiveCustomReportTitle] = useState("");
  const [creatingPerformanceNoteGroupId, setCreatingPerformanceNoteGroupId] = useState("");
  const [isCreatingAllPerformanceNotes, setIsCreatingAllPerformanceNotes] = useState(false);
  const [copyPerformanceNotesToCustomerNotes, setCopyPerformanceNotesToCustomerNotes] = useState(false);

  const generationScope = JSON.stringify([recentlySelectedCompany, companyRole, companyUserAccess,
    selectedCustomerRegionTag, customerAreaFilteringEnabled, permissionsReady, canViewReports, canViewPayrollInformation,
    reportType, mode, groupBy, dateRange, selectedCustomerTags, readingHealthFilters, readingPerformanceStandards, readingPerformanceView]);
  const generationScopeRef = useRef(generationScope);
  generationScopeRef.current = generationScope;
  const generationRequestRef = useRef(0);
  useEffect(() => {
    setReportData(null);
    setIsLoading(false);
    generationRequestRef.current += 1;
    return () => { generationRequestRef.current += 1; };
  }, [generationScope]);

  const selectedReport = useMemo(
    () => reportCatalog.find((report) => report.value === reportType) || reportCatalog[0],
    [reportType]
  );

  const filteredReportCatalog = useMemo(() => {
    const permittedReports = canViewPayrollInformation
      ? reportCatalog
      : reportCatalog.filter((report) => !payrollOnlyReportTypes.has(report.value));
    const search = reportSearchTerm.trim().toLowerCase();
    if (!search) return permittedReports;

    return permittedReports.filter((report) => {
      const category = reportCategories.find((item) => item.value === report.category)?.label || "";
      return [report.label, report.source, category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(search));
    });
  }, [canViewPayrollInformation, reportSearchTerm]);

  const regionalTagAccess = useMemo(
    () => getCustomerRegionAccessTags({ userAccess: companyUserAccess, role: companyRole }),
    [companyUserAccess, companyRole]
  );

  const normalizeSavedReadingPerformanceStandards = useCallback((standards = []) => {
    const templateKeys = new Set(availableReadingTemplates.map(readingTemplateKey));
    const normalizedStandards = standards
      .map((standard, index) => withReadingPerformanceStandardId({
        templateId: String(standard.templateId || ""),
        operator: standard.operator || "gt",
        threshold: standard.threshold ?? "",
      }, index))
      .filter((standard) => !templateKeys.size || templateKeys.has(String(standard.templateId || "")));

    return normalizedStandards.length
      ? normalizedStandards
      : defaultReadingPerformanceStandardsFor(availableReadingTemplates);
  }, [availableReadingTemplates]);

  const applyCustomReportControls = useCallback((customReport) => {
    const controls = customReport.controls || {};
    const savedReportType = controls.reportType || customReport.reportType || "readings";
    const nextReportType = reportCatalog.some((report) => report.value === savedReportType) ? savedReportType : "readings";

    if (payrollOnlyReportTypes.has(nextReportType) && !canViewPayrollInformation) {
      toast.error("Drip Drop permission denied: Payroll reports require payroll information permission.");
      return false;
    }

    const savedQuickDateRange = controls.quickDateRange || "thisMonth";
    const nextQuickDateRange = dateRangePresets.some((preset) => preset.value === savedQuickDateRange)
      ? savedQuickDateRange
      : "custom";
    const nextPreset = dateRangePresets.find((preset) => preset.value === nextQuickDateRange);
    const nextDateRange = nextPreset?.getRange && nextQuickDateRange !== "custom"
      ? nextPreset.getRange()
      : sanitizeDateRange(controls.dateRange);
    const nextGroupBy = groupOptions.some((option) => option.value === controls.groupBy)
      ? controls.groupBy
      : "company";

    setReportType(nextReportType);
    setMode(controls.mode === "detail" ? "detail" : "summary");
    setGroupBy(nextGroupBy);
    setQuickDateRange(nextQuickDateRange);
    setDateRange(nextDateRange);
    setSelectedCustomerTags(Array.isArray(controls.selectedCustomerTags) ? controls.selectedCustomerTags : []);
    setReadingHealthFilters({
      templateId: controls.readingHealthFilters?.templateId || "",
      operator: controls.readingHealthFilters?.operator || "gt",
      threshold: controls.readingHealthFilters?.threshold ?? "",
    });
    setReadingPerformanceView(controls.readingPerformanceView === "customers" ? "customers" : "users");
    setReadingPerformanceStandards(normalizeSavedReadingPerformanceStandards(
      Array.isArray(controls.readingPerformanceStandards) ? controls.readingPerformanceStandards : []
    ));
    setActiveCustomReportTitle(customReport.title || "Custom Report");
    setReportData(null);
    return true;
  }, [canViewPayrollInformation, normalizeSavedReadingPerformanceStandards]);

  useEffect(() => {
    if (!customReportId) {
      appliedCustomReportKeyRef.current = "";
      loadedCustomReportToastRef.current = "";
      setActiveCustomReportTitle("");
      return;
    }

    if (!recentlySelectedCompany) return;

    const readingTemplateSignature = availableReadingTemplates.map(readingTemplateKey).join("|");
    const applyKey = `${recentlySelectedCompany}:${customReportId}:${readingTemplateSignature}`;
    if (appliedCustomReportKeyRef.current === applyKey) return;

    let isActive = true;

    const loadCustomReport = async () => {
      try {
        const reportSnap = await getDoc(customReportDocRef(recentlySelectedCompany, customReportId));
        if (!isActive) return;

        if (!reportSnap.exists()) {
          appliedCustomReportKeyRef.current = applyKey;
          toast.error("Custom report not found.");
          return;
        }

        const customReport = { id: reportSnap.id, ...reportSnap.data() };
        const applied = applyCustomReportControls(customReport);
        appliedCustomReportKeyRef.current = applyKey;

        const toastKey = `${recentlySelectedCompany}:${customReportId}`;
        if (applied && loadedCustomReportToastRef.current !== toastKey) {
          loadedCustomReportToastRef.current = toastKey;
          toast.success(`${customReport.title || "Custom report"} controls loaded.`);
        }
      } catch (error) {
        console.error("Failed to load custom report:", error);
        toast.error(userFacingErrorMessage(error, `Could not load custom report: ${error.message}`));
      }
    };

    loadCustomReport();

    return () => {
      isActive = false;
    };
  }, [applyCustomReportControls, availableReadingTemplates, customReportId, recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !canViewCustomers) {
      setAvailableCustomerTags([]);
      setSelectedCustomerTags([]);
      return;
    }

    let isActive = true;
    const fetchCustomerTags = async () => {
      try {
        const customers = await getCollection(recentlySelectedCompany, "customers");
        const visibleCustomers = filterCustomersByRegionalAccess(customers, {
          userAccess: companyUserAccess,
          role: companyRole,
          selectedRegionTag: selectedCustomerRegionTag,
          regionalAccessEnabled: customerAreaFilteringEnabled,
        });
        if (!isActive) return;
        setAvailableCustomerTags(getCustomerTagOptions(visibleCustomers));
        setSelectedCustomerTags((currentTags) =>
          currentTags.filter((tag) => getCustomerTagOptions(visibleCustomers).includes(tag))
        );
      } catch (error) {
        console.error("Failed to load customer tags for reports:", error);
      }
    };

    fetchCustomerTags();
    return () => { isActive = false; };
  }, [recentlySelectedCompany, companyUserAccess, companyRole, selectedCustomerRegionTag, customerAreaFilteringEnabled, canViewCustomers]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAvailableReadingTemplates([]);
      setReadingHealthFilters({ templateId: "", operator: "gt", threshold: "" });
      setReadingPerformanceStandards([]);
      return;
    }

    setAvailableReadingTemplates([]);
    let isActive = true;
    const fetchReadingTemplates = async () => {
      try {
        const readingsSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings"));
        const templates = sortReadingTemplates(normalizeDocs(readingsSnap));
        if (!isActive) return;
        setAvailableReadingTemplates(templates);
        setReadingHealthFilters((currentFilters) => {
          if (!templates.length) return { templateId: "", operator: "gt", threshold: "" };
          const currentTemplateExists = templates.some((template) => readingTemplateKey(template) === currentFilters.templateId);
          return currentTemplateExists ? currentFilters : defaultReadingHealthFilterFor(templates[0]);
        });
        setReadingPerformanceStandards((currentStandards) => {
          if (!templates.length) return [];
          const templateKeys = new Set(templates.map(readingTemplateKey));
          const validCurrentStandards = currentStandards.filter((standard) => templateKeys.has(String(standard.templateId || "")));
          return validCurrentStandards.length ? validCurrentStandards : defaultReadingPerformanceStandardsFor(templates);
        });
      } catch (error) {
        console.error("Failed to load reading templates for reports:", error);
      }
    };

    fetchReadingTemplates();

    return () => {
      isActive = false;
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (!canViewPayrollInformation && payrollOnlyReportTypes.has(reportType)) {
      setReportType("readings");
    }
  }, [canViewPayrollInformation, reportType]);

  const handleReportSelect = (value) => {
    if (payrollOnlyReportTypes.has(value) && !canViewPayrollInformation) {
      toast.error("Drip Drop permission denied: Payroll reports require payroll information permission.");
      return;
    }

    setReportType(value);
    setActiveCustomReportTitle("");
    appliedCustomReportKeyRef.current = "";
  };

  const handleReportSearch = (event) => {
    event.preventDefault();
    setReportSearchTerm(reportSearchDraft.trim());
  };

  const clearReportSearch = () => {
    setReportSearchDraft("");
    setReportSearchTerm("");
  };

  const handleQuickDateRangeChange = (value) => {
    setQuickDateRange(value);
    const preset = dateRangePresets.find((item) => item.value === value);
    if (preset?.getRange) {
      setDateRange(preset.getRange());
    }
  };

  const handleReadingTemplateChange = (templateId) => {
    const nextTemplate = availableReadingTemplates.find((template) => readingTemplateKey(template) === templateId);
    setReadingHealthFilters(nextTemplate ? defaultReadingHealthFilterFor(nextTemplate) : { templateId, operator: "gt", threshold: "" });
  };

  const handleReadingHealthFilterChange = (field, value) => {
    setReadingHealthFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
  };

  const handleReadingPerformanceStandardChange = (standardId, field, value) => {
    setReadingPerformanceStandards((currentStandards) =>
      currentStandards.map((standard, index) => {
        if (standard.id !== standardId) return standard;

        if (field === "templateId") {
          const nextTemplate = availableReadingTemplates.find((template) => readingTemplateKey(template) === value);
          return withReadingPerformanceStandardId(
            nextTemplate ? defaultReadingHealthFilterFor(nextTemplate) : { templateId: value, operator: "gt", threshold: "" },
            index
          );
        }

        return {
          ...standard,
          [field]: value,
        };
      })
    );
  };

  const addReadingPerformanceStandard = () => {
    setReadingPerformanceStandards((currentStandards) => {
      const template = availableReadingTemplates[0] || {};
      const nextStandard = withReadingPerformanceStandardId({
        ...defaultReadingHealthFilterFor(template),
        id: `manual-${Date.now()}-${currentStandards.length}`,
      });
      return [...currentStandards, nextStandard];
    });
  };

  const removeReadingPerformanceStandard = (standardId) => {
    setReadingPerformanceStandards((currentStandards) =>
      currentStandards.filter((standard) => standard.id !== standardId)
    );
  };

  const toggleCustomerTagFilter = (tag) => {
    setSelectedCustomerTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    );
  };

  const createCustomerNotesForPerformanceGroup = async ({
    group,
    reportTimestamp,
    nowMillis,
    reviewerName,
    performanceReviewId,
    attachedReport,
    attachment,
  }) => {
    const customerReferences = Array.isArray(group.customerReferences) ? group.customerReferences : [];
    const validReferences = customerReferences.filter((reference) => reference.customerId);

    if (!validReferences.length) return 0;

    await Promise.all(validReferences.map(async (reference) => {
      const rows = Array.isArray(reference.rows) ? reference.rows : [];
      const noteId = `comp_cus_note_${reportData.generationId}_${group.companyUserId}_${reference.customerId}`;
      const bodyOfWaterIds = Array.from(new Set(rows.map((row) => String(row.bodyOfWaterId || "").trim()).filter(Boolean)));
      const bodyOfWaterNames = Array.from(new Set(rows.map((row) => String(row.pool || "").trim()).filter(Boolean)));
      const serviceLocationIds = Array.from(new Set(rows.map((row) => String(row.serviceLocationId || "").trim()).filter(Boolean)));
      const serviceStopIds = Array.from(new Set(rows.map((row) => String(row.serviceStop || "").trim()).filter((id) => id && id !== "-")));
      const noteText = individualCustomerPerformanceNoteText(reportData, group, reference);

      const noteRef = customerNotesDocRef(recentlySelectedCompany, reference.customerId, noteId);
      if ((await getDoc(noteRef)).exists()) return;
      await setDoc(noteRef, {
        id: noteId,
        companyId: recentlySelectedCompany,
        customerId: reference.customerId,
        customerName: reference.customerName || "",
        bodyOfWaterId: bodyOfWaterIds.length === 1 ? bodyOfWaterIds[0] : "",
        bodyOfWaterName: bodyOfWaterNames.length === 1 ? bodyOfWaterNames[0] : "",
        serviceLocationId: serviceLocationIds.length === 1 ? serviceLocationIds[0] : "",
        userId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
        userName: reviewerName,
        authorId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
        authorName: reviewerName,
        note: noteText,
        comment: noteText,
        audience: "office",
        visibility: "office",
        resolved: false,
        date: reportTimestamp,
        dateMillis: nowMillis,
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
        source: "readingPerformanceReport",
        sourceReport: {
          type: "readingPerformance",
          title: reportData.title || "",
          groupId: group.id,
          performanceReviewId,
          generatedAt: reportTimestamp,
        },
        references: {
          companyUserId: group.companyUserId || "",
          technicianUserId: group.technicianUserId || "",
          technicianName: group.technicianName || group.name || "",
          serviceStops: serviceStopIds,
          bodyOfWaterIds,
          serviceLocationIds,
        },
        attachedReports: [attachedReport],
        attachments: [attachment],
      });
    }));

    return validReferences.length;
  };

  const createPerformanceNoteFromReportGroup = async (group, { copyToCustomerNotes = false } = {}) => {
    if (!canCreatePerformanceNotes) throw new Error("Performance notes require the management performance history feature and permission 274.");
    if (copyToCustomerNotes && !canCopyCustomerNotes) throw new Error("Customer notes require customer creation permission (12).");
    const individualReport = individualReportDataForGroup(reportData, group);
    const now = new Date();
    const nowMillis = now.getTime();
    const reportTimestamp = Timestamp.fromDate(now);
    const fileBaseName = `${safeFilePart(individualReport.title)}_${reportData.generationId}_${group.companyUserId}`;
    const fileName = `${fileBaseName}.html`;
    const storagePath = [
      "companies",
      recentlySelectedCompany,
      "performanceReviews",
      group.companyUserId,
      "shared",
      fileName,
    ].join("/");
    const reviewerName = (
      dataBaseUser?.userName ||
      dataBaseUser?.displayName ||
      dataBaseUser?.firstName ||
      authUser?.displayName ||
      authUser?.email ||
      "Management"
    );

    const reportHtml = printableReportHtml(individualReport);
    const reportBlob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, reportBlob, {
      contentType: "text/html",
    });
    const reportUrl = await getDownloadURL(storageRef);
    const attachment = {
      id: `individual_report_${Date.now()}`,
      name: fileName,
      title: individualReport.title,
      url: reportUrl,
      contentType: "text/html",
      size: reportBlob.size,
      storagePath,
      isTechnicianVisible: true,
      attachedAt: reportTimestamp,
    };
    const attachedReport = {
      id: `report_${Date.now()}`,
      title: individualReport.title,
      url: reportUrl,
      notes: "Individual reading performance report generated from Reports.",
      isTechnicianVisible: true,
      attachments: [attachment],
      attachedAt: reportTimestamp,
    };

    const performanceReviewRef = doc(performanceReviewsRef(recentlySelectedCompany, group.companyUserId), `report_${reportData.generationId}_${group.companyUserId}`);
    await setDoc(performanceReviewRef, {
      type: "observation",
      title: individualReport.title,
      note: individualPerformanceNoteText(reportData, group),
      date: reportTimestamp,
      references: {
        serviceStops: [],
        jobs: [],
      },
      attachedReports: [attachedReport],
      attachments: [attachment],
      visibleToTechnician: true,
      isSummaryReport: false,
      companyInternal: true,
      companyId: recentlySelectedCompany,
      companyUserId: group.companyUserId,
      technicianUserId: group.technicianUserId || "",
      technicianName: group.technicianName || group.name,
      createdByUserId: dataBaseUser?.id || dataBaseUser?.userId || authUser?.uid || "",
      createdByName: reviewerName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      sourceReport: {
        type: "readingPerformance",
        title: reportData.title || "",
        mode: reportData.mode || "",
        groupId: group.id,
        generatedAt: reportTimestamp,
      },
    });

    const customerNotesCreated = copyToCustomerNotes
      ? await createCustomerNotesForPerformanceGroup({
        group,
        reportTimestamp,
        nowMillis,
        reviewerName,
        performanceReviewId: performanceReviewRef.id,
        attachedReport,
        attachment,
      })
      : 0;

    return {
      performanceReviewId: performanceReviewRef.id,
      customerNotesCreated,
    };
  };

  const handleCreatePerformanceNoteFromGroup = async (group) => {
    if (!canCreatePerformanceNotes || creatingPerformanceNoteGroupId || isCreatingAllPerformanceNotes) return;
    if (!recentlySelectedCompany) {
      toast.error("Please select a company.");
      return;
    }
    if (!reportData || reportData.reportType !== "readingPerformance") {
      toast.error("Generate a reading performance report first.");
      return;
    }
    if (!group?.companyUserId) {
      toast.error("This report row could not be matched to a company user.");
      return;
    }

    setCreatingPerformanceNoteGroupId(group.id);
    const toastId = toast.loading(`Creating performance note for ${group.technicianName || group.name}...`);

    try {
      const result = await createPerformanceNoteFromReportGroup(group, {
        copyToCustomerNotes: copyPerformanceNotesToCustomerNotes && canCopyCustomerNotes,
      });
      const customerNoteText = result.customerNotesCreated
        ? ` ${result.customerNotesCreated} customer note${result.customerNotesCreated === 1 ? "" : "s"} created.`
        : "";
      toast.success(`Performance note created for ${group.technicianName || group.name}.${customerNoteText}`, { id: toastId });
    } catch (error) {
      console.error("Error creating performance note from report:", error);
      toast.error(userFacingErrorMessage(error, `Could not create performance note: ${error.message}`), { id: toastId });
    } finally {
      setCreatingPerformanceNoteGroupId("");
    }
  };

  const handleCreateAllPerformanceNotesFromGroups = async (groupsToCreate = []) => {
    if (!canCreatePerformanceNotes || creatingPerformanceNoteGroupId || isCreatingAllPerformanceNotes) return;
    if (!recentlySelectedCompany) {
      toast.error("Please select a company.");
      return;
    }
    if (!reportData || reportData.reportType !== "readingPerformance") {
      toast.error("Generate a reading performance report first.");
      return;
    }

    const matchedGroups = groupsToCreate.filter((group) => Boolean(group?.companyUserId));
    if (!matchedGroups.length) {
      toast.error("No report rows could be matched to company users.");
      return;
    }

    setIsCreatingAllPerformanceNotes(true);
    const toastId = toast.loading(`Creating performance notes for ${matchedGroups.length} technicians...`);
    const failures = [];
    let customerNotesCreated = 0;

    try {
      for (let index = 0; index < matchedGroups.length; index += 1) {
        const group = matchedGroups[index];
        setCreatingPerformanceNoteGroupId(group.id);
        toast.loading(`Creating ${index + 1} of ${matchedGroups.length}: ${group.technicianName || group.name}`, { id: toastId });

        try {
          const result = await createPerformanceNoteFromReportGroup(group, {
            copyToCustomerNotes: copyPerformanceNotesToCustomerNotes && canCopyCustomerNotes,
          });
          customerNotesCreated += result.customerNotesCreated || 0;
        } catch (error) {
          console.error("Error creating bulk performance note from report:", error);
          failures.push({ group, error });
        }
      }

      const createdCount = matchedGroups.length - failures.length;
      const customerNoteText = customerNotesCreated
        ? ` ${customerNotesCreated} customer note${customerNotesCreated === 1 ? "" : "s"} created.`
        : "";
      if (failures.length) {
        toast.error(`Created ${createdCount} performance notes.${customerNoteText} ${failures.length} failed.`, { id: toastId });
      } else {
        toast.success(`Created performance notes for ${createdCount} technicians.${customerNoteText}`, { id: toastId });
      }
    } finally {
      setCreatingPerformanceNoteGroupId("");
      setIsCreatingAllPerformanceNotes(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Please select a company.");
      return;
    }

    if (payrollOnlyReportTypes.has(reportType) && !canViewPayrollInformation) {
      toast.error("Drip Drop permission denied: Payroll reports require payroll information permission.");
      return;
    }

    if (reportType === "readingHealth") {
      if (!availableReadingTemplates.length) {
        toast.error("No reading templates found for this company.");
        return;
      }
      if (!readingHealthFilters.templateId) {
        toast.error("Select a reading to check.");
        return;
      }
      if (!Number.isFinite(parseReadingNumber(readingHealthFilters.threshold))) {
        toast.error("Enter a numeric reading threshold.");
        return;
      }
    }

    if (reportType === "readingPerformance") {
      if (!availableReadingTemplates.length) {
        toast.error("No reading templates found for this company.");
        return;
      }
      if (!activeReadingPerformanceStandards(readingPerformanceStandards, availableReadingTemplates).length) {
        toast.error("Add at least one good standing standard.");
        return;
      }
    }

    if (!permissionsReady || !canViewReports) {
      toast.error("Reports require report information permission (870).");
      return;
    }
    setReportData(null);
    const scope = generationScopeRef.current;
    const requestId = ++generationRequestRef.current;
    setIsLoading(true);
    const toastId = toast.loading(`Generating ${selectedReport.label.toLowerCase()} report...`);

    try {
      const options = {
        companyId: recentlySelectedCompany, reportType, mode, groupBy, dateRange,
        canViewPayrollInformation, userAccess: companyUserAccess, role: companyRole,
        selectedCustomerTags, selectedRegionTag: selectedCustomerRegionTag,
        regionalAccessEnabled: customerAreaFilteringEnabled,
        readingHealthFilters, readingPerformanceStandards, readingPerformanceView,
        includeLegacyPipeline: can("910"),
      };
      validateReportOptions(options);
      const sources = await loadReportSources(options, async (source) => {
        if (source.kind === "document") {
          const snapshot = await getDoc(doc(db, source.path));
          return snapshot.exists() ? snapshot.data() : null;
        }
        const constraints = [];
        if (source.companyFilter) constraints.push(where("companyId", "==", options.companyId));
        if (source.dateFilter) {
          constraints.push(where("date", ">=", new Date(`${options.dateRange.start}T00:00:00`)));
          const exclusiveEnd = new Date(`${options.dateRange.end}T00:00:00`);
          exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
          constraints.push(where("date", "<", exclusiveEnd));
        }
        const snapshot = await getDocs(query(collection(db, source.path), ...constraints));
        return normalizeDocs(snapshot);
      });
      if (generationScopeRef.current !== scope || requestId !== generationRequestRef.current) { toast.dismiss(toastId); return; }
      setReportData({ ...generateReport(options, sources), generationId: uuidv4() });
      toast.success(`${selectedReport.label} report generated.`, { id: toastId });
    } catch (error) {
      if (generationScopeRef.current !== scope || requestId !== generationRequestRef.current) { toast.dismiss(toastId); return; }
      console.error("Error generating report:", error);
      toast.error(userFacingErrorMessage(error, `Report generation failed: ${error.message}`), { id: toastId });
    } finally {
      if (generationScopeRef.current === scope && requestId === generationRequestRef.current) setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-4 sm:px-3 lg:px-4">
      <div className="w-full">
        <WorkspaceHeader className="mb-3" title="Reports" eyebrow="Books" description="Operations, marketing, performance and finance reporting." actions={
          <Link
            to="/company/reports/custom"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-500 hover:text-slate-950"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            Custom Reports
          </Link>
        } />

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:h-[calc(100vh-100px)] xl:grid-cols-[minmax(0,1fr)_340px] xl:overflow-hidden">
          <div className="grid min-h-0 min-w-0 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:h-full xl:overflow-y-auto">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Report Controls</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {activeCustomReportTitle ? `${activeCustomReportTitle} - ${selectedReport.label}` : selectedReport.label}
                </p>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Output</label>
                  <select
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  >
                    <option value="summary">Summary</option>
                    <option value="detail">Detail</option>
                  </select>
                </div>

                {!fixedGroupingReportTypes.has(reportType) ? (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Group By</label>
                    <select
                      value={groupBy}
                      onChange={(event) => {
                        setGroupBy(event.target.value);
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                    >
                      {groupOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {reportType === "readingHealth" ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-sm font-semibold text-slate-700">Reading</label>
                    <select
                      value={readingHealthFilters.templateId}
                      onChange={(event) => handleReadingTemplateChange(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                    >
                      {availableReadingTemplates.length ? (
                        availableReadingTemplates.map((template) => (
                          <option key={readingTemplateKey(template)} value={readingTemplateKey(template)}>
                            {readingTemplateLabel(template)}
                          </option>
                        ))
                      ) : (
                        <option value="">No readings found</option>
                      )}
                    </select>

                    <div className="mt-3 grid grid-cols-[1fr_96px] gap-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</label>
                        <select
                          value={readingHealthFilters.operator}
                          onChange={(event) => handleReadingHealthFilterChange("operator", event.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                        >
                          {readingOperatorOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Value</label>
                        <input
                          type="number"
                          step="any"
                          value={readingHealthFilters.threshold}
                          onChange={(event) => handleReadingHealthFilterChange("threshold", event.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {reportType === "readingPerformance" ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-sm font-semibold text-slate-700">Performance View</label>
                    <select
                      value={readingPerformanceView}
                      onChange={(event) => {
                        setReadingPerformanceView(event.target.value);
                        setReportData(null);
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                    >
                      {readingPerformanceViewOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {reportType === "readingPerformance" ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="block text-sm font-semibold text-slate-700">Good Standing Standards</label>
                      <button
                        type="button"
                        onClick={addReadingPerformanceStandard}
                        disabled={!availableReadingTemplates.length}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Add standard"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {readingPerformanceStandards.length ? (
                        readingPerformanceStandards.map((standard, index) => (
                          <div key={standard.id} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Standard {index + 1}</p>
                              <button
                                type="button"
                                onClick={() => removeReadingPerformanceStandard(standard.id)}
                                disabled={readingPerformanceStandards.length <= 1}
                                className="rounded-md border border-slate-200 p-1 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Remove standard"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>

                            <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reading</label>
                            <select
                              value={standard.templateId || ""}
                              onChange={(event) => handleReadingPerformanceStandardChange(standard.id, "templateId", event.target.value)}
                              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                            >
                              {availableReadingTemplates.length ? (
                                availableReadingTemplates.map((template) => (
                                  <option key={readingTemplateKey(template)} value={readingTemplateKey(template)}>
                                    {readingTemplateLabel(template)}
                                  </option>
                                ))
                              ) : (
                                <option value="">No readings found</option>
                              )}
                            </select>

                            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</label>
                                <select
                                  value={standard.operator || "gt"}
                                  onChange={(event) => handleReadingPerformanceStandardChange(standard.id, "operator", event.target.value)}
                                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                                >
                                  {readingOperatorOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Value</label>
                                <input
                                  type="number"
                                  step="any"
                                  value={standard.threshold ?? ""}
                                  onChange={(event) => handleReadingPerformanceStandardChange(standard.id, "threshold", event.target.value)}
                                  className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">No reading templates found.</p>
                      )}
                    </div>
                  </div>
                ) : null}

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-sm font-semibold text-slate-700">Customer Tags</label>
                    {selectedCustomerTags.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomerTags([]);
                        }}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  {customerAreaFilteringEnabled && regionalTagAccess.length > 0 ? (
                    <p className="mt-1 text-xs text-blue-700">
                      Access limited to {regionalTagAccess.join(", ")}.
                      {selectedCustomerRegionTag ? ` Current area: ${selectedCustomerRegionTag}.` : ""}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {availableCustomerTags.length > 0 ? (
                      availableCustomerTags.map((tag) => {
                        const selected = selectedCustomerTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleCustomerTagFilter(tag)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selected
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                              }`}
                          >
                            {tag}
                          </button>
                        );
                      })
                    ) : (
                      <p className="text-sm text-slate-500">No customer tags found.</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700">Date Range</label>
                  <select
                    value={quickDateRange}
                    onChange={(event) => handleQuickDateRangeChange(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  >
                    {dateRangePresets.map((preset) => (
                      <option key={preset.value} value={preset.value}>{preset.label}</option>
                    ))}
                  </select>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      aria-label="Start Date"
                      value={dateRange.start}
                      onChange={(event) => {
                        setQuickDateRange("custom");
                        setDateRange((prev) => ({ ...prev, start: event.target.value }));
                      }}
                      className="rounded-md border border-slate-300 p-2 text-sm"
                    />
                    <input
                      type="date"
                      aria-label="End Date"
                      value={dateRange.end}
                      onChange={(event) => {
                        setQuickDateRange("custom");
                        setDateRange((prev) => ({ ...prev, end: event.target.value }));
                      }}
                      className="rounded-md border border-slate-300 p-2 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={isLoading || !permissionsReady || !canViewReports || !featureFlagsLoaded}
                  className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? "Generating..." : "Generate"}
                </button>

                <ExportSection reportData={reportData} />
                <IndividualUsersExportSection
                  reportData={reportData}
                  onCreatePerformanceNote={handleCreatePerformanceNoteFromGroup}
                  onCreateAllPerformanceNotes={handleCreateAllPerformanceNotesFromGroups}
                  creatingPerformanceNoteGroupId={creatingPerformanceNoteGroupId}
                  isCreatingAllPerformanceNotes={isCreatingAllPerformanceNotes}
                  copyPerformanceNotesToCustomerNotes={copyPerformanceNotesToCustomerNotes}
                  onCopyPerformanceNotesToCustomerNotesChange={setCopyPerformanceNotesToCustomerNotes}
                  canCreatePerformanceNotes={canCreatePerformanceNotes}
                  canCopyCustomerNotes={canCopyCustomerNotes}
                />
              </div>
            </div>

            <GeneratedReportView data={reportData} />
          </div>

          <aside className="order-first min-h-0 min-w-0 xl:order-none">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:flex xl:h-full xl:flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Report Library</h2>
                  <p className="mt-1 text-sm text-slate-500">{filteredReportCatalog.length} report(s)</p>
                </div>
                {reportSearchTerm ? (
                  <button
                    type="button"
                    onClick={clearReportSearch}
                    className="rounded-md border border-slate-200 p-2 text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                    title="Clear search"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              <form onSubmit={handleReportSearch} className="mt-4 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={reportSearchDraft}
                    onChange={(event) => setReportSearchDraft(event.target.value)}
                    className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm"
                    placeholder="Search reports"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  title="Search reports"
                >
                  <MagnifyingGlassIcon className="h-4 w-4" />
                  Search
                </button>
              </form>

              <div className="mt-4 max-h-[calc(100vh-220px)] space-y-4 overflow-y-auto pr-1 xl:min-h-0 xl:flex-1 xl:max-h-none">
                {reportCategories.map((category) => {
                  const reports = filteredReportCatalog.filter((report) => report.category === category.value);
                  if (!reports.length) return null;

                  return (
                    <section key={category.value}>
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{category.label}</h3>
                      <div className="grid gap-2">
                        {reports.map((report) => (
                          <ReportCatalogCard key={report.value} report={report} selected={report.value === reportType} onSelect={handleReportSelect} />
                        ))}
                      </div>
                    </section>
                  );
                })}

                {!filteredReportCatalog.length ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                    No reports match that search.
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Reports;
