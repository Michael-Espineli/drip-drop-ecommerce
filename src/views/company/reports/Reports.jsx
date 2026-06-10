import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { endOfMonth, format, startOfMonth } from "date-fns";
import * as XLSX from "xlsx";
import {
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PrinterIcon,
  TableCellsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  customerHasAnyTag,
  filterCustomersByRoleTagAccess,
  filterRecordsByCustomerTags,
  getCustomerTagOptions,
  getRoleCustomerTagAccess,
} from "../../../utils/customerTags";

const reportCategories = [
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance / Accounting" },
];

const reportCatalog = [
  { value: "readings", label: "Readings Summary", status: "Ready", source: "stopData readings", category: "operations" },
  { value: "readingHealth", label: "Reading Health", status: "Ready", source: "reading thresholds by pool", category: "operations" },
  { value: "chemicals", label: "Chemicals", status: "Ready", source: "stopData dosages", category: "operations" },
  { value: "waste", label: "Waste", status: "Ready", source: "dosages and chemical purchases", category: "operations" },
  { value: "users", label: "Users", status: "Ready", source: "users, stops, jobs, purchases, payroll", category: "operations" },
  { value: "job", label: "Jobs", status: "Ready", source: "workOrders, purchases, payroll", category: "operations" },
  { value: "vehicle", label: "Vehicle", status: "Ready", source: "vehicals and activeRoutes", category: "operations" },
  { value: "purchases", label: "Purchases", status: "Ready", source: "purchasedItems and database items", category: "finance" },
  { value: "pnl", label: "P.N.L.", status: "Ready", source: "jobs, purchases, payroll", category: "finance" },
  { value: "tax", label: "Tax", status: "Ready", source: "purchases and invoiced jobs", category: "finance" },
];

const groupOptions = [
  { value: "company", label: "Company" },
  { value: "user", label: "User" },
  { value: "customer", label: "Customer" },
];

const readingOperatorOptions = [
  { value: "gt", label: "Over" },
  { value: "gte", label: "At or over" },
  { value: "lt", label: "Below" },
  { value: "lte", label: "At or below" },
  { value: "eq", label: "Equal to" },
];

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
  const date = dateFromValue(value);
  return date ? format(date, "MM/dd/yyyy") : "-";
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cents = (value) => Math.round(toNumber(value));

const templateMap = (templates, alternateIdField) => {
  const map = new Map();
  templates.forEach((template) => {
    map.set(template.id, template);
    if (template[alternateIdField]) map.set(template[alternateIdField], template);
  });
  return map;
};

const templateName = (item, templatesById, fallback) =>
  item.name || templatesById.get(item.templateId)?.name || templatesById.get(item.universalTemplateId)?.name || fallback;

const valueWithUnit = (item) => [item.amount ?? "", item.UOM || item.uom || ""].filter(Boolean).join(" ").trim() || "-";

const customerDisplayName = (customer = {}) => {
  if (!customer) return "";
  const personalName = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || customer.businessName || customer.displayName || customer.customerName || customer.label || personalName || "";
  }
  return customer.customerName || customer.displayName || customer.name || personalName || customer.label || customer.company || customer.companyName || customer.email || "";
};

const customerContactInfo = (customer = {}) =>
  Array.from(new Set([
    customer.email,
    customer.phoneNumber || customer.phone,
    customer.mainContact?.email,
    customer.mainContact?.phoneNumber,
  ].filter(Boolean))).join(" | ");

const readingTemplateKey = (template = {}) =>
  String(template.id || template.templateId || template.readingsTemplateId || template.universalTemplateId || "");

const readingTemplateLabel = (template = {}) =>
  [template.name || template.chemType || "Reading", template.UOM || template.uom || ""]
    .filter(Boolean)
    .join(" ")
    .trim();

const sortReadingTemplates = (templates = []) =>
  [...templates].sort((a, b) => readingTemplateLabel(a).localeCompare(readingTemplateLabel(b)));

const hasNumericValue = (value) => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));

const defaultReadingHealthFilterFor = (template = {}) => {
  const templateId = readingTemplateKey(template);
  if (hasNumericValue(template.highWarning)) {
    return { templateId, operator: "gt", threshold: String(template.highWarning) };
  }
  if (hasNumericValue(template.lowWarning)) {
    return { templateId, operator: "lt", threshold: String(template.lowWarning) };
  }
  return { templateId, operator: "gt", threshold: "" };
};

const parseReadingNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").replaceAll(",", "").trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareReadingValue = (value, operator, threshold) => {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  switch (operator) {
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return Math.abs(value - threshold) < 0.00001;
    case "gt":
    default:
      return value > threshold;
  }
};

const readingOperatorLabel = (operator) =>
  readingOperatorOptions.find((option) => option.value === operator)?.label || readingOperatorOptions[0].label;

const readingMatchesTemplate = (reading = {}, template = {}) => {
  const templateIds = [
    template.id,
    template.templateId,
    template.readingsTemplateId,
    template.universalTemplateId,
  ].filter(Boolean).map(String);
  const readingIds = [
    reading.templateId,
    reading.universalTemplateId,
    reading.readingsTemplateId,
    reading.templateUniversalId,
  ].filter(Boolean).map(String);

  if (templateIds.some((templateId) => readingIds.includes(templateId))) return true;

  const templateNames = [template.name, template.chemType]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const readingNames = [reading.name, reading.chemType, reading.dosageType]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return templateNames.some((name) => readingNames.includes(name));
};

const itemDate = (item, fields) => {
  for (const field of fields) {
    const date = dateFromValue(item[field]);
    if (date) return date;
  }
  return null;
};

const inRange = (item, startDate, endDate, fields) => {
  const date = itemDate(item, fields);
  if (!date) return true;
  return date >= startDate && date <= endDate;
};

const groupKey = (item, groupBy, fallbackName = "Company") => {
  if (groupBy === "user") {
    return {
      id: item.userId || item.techId || item.adminId || item.workerId || "unassigned",
      name: item.userName || item.techName || item.tech || item.adminName || item.workerName || "Unassigned",
    };
  }

  if (groupBy === "customer") {
    return {
      id: item.customerId || "no-customer",
      name: item.customerName || "No Customer",
    };
  }

  return { id: "company", name: fallbackName };
};

const ensureGroup = (groups, group) => {
  if (!groups.has(group.id)) {
    groups.set(group.id, {
      id: group.id,
      name: group.name,
      metrics: {},
      rows: [],
    });
  }

  return groups.get(group.id);
};

const addMetric = (group, key, amount) => {
  group.metrics[key] = (group.metrics[key] || 0) + amount;
};

const moneyMetric = (label, centsValue) => ({ label, value: moneyFromCents(centsValue) });
const numberMetric = (label, value, suffix = "") => ({ label, value: `${Number(value || 0).toLocaleString()}${suffix}` });

const purchaseTotalCents = (item) => {
  const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
  const priceCents = cents(item.priceCents ?? item.price ?? item.unitCostCents);
  const explicitTotal = cents(item.totalAfterTaxCents ?? item.totalCents ?? item.costAfterTax);
  if (explicitTotal > 0) return explicitTotal;
  return Math.round(priceCents * quantity * 1.085);
};

const purchasePreTaxCents = (item) => {
  const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
  const explicit = cents(item.totalCents ?? item.cost);
  if (explicit > 0) return explicit;
  return Math.round(cents(item.priceCents ?? item.price ?? item.unitCostCents) * quantity);
};

const normalizePurchaseCategory = (value) => String(value || "").trim() || "Uncategorized";

const purchaseCategory = (item, databaseItemById) => {
  const databaseItem =
    databaseItemById.get(item.itemId) ||
    databaseItemById.get(item.dataBaseItemId) ||
    databaseItemById.get(item.databaseItemId) ||
    databaseItemById.get(item.templateId) ||
    null;

  return normalizePurchaseCategory(
    item.category ||
      item.itemCategory ||
      item.materialCategory ||
      databaseItem?.category
  );
};

const jobRevenueCents = (job) => cents(job.revenueCents ?? job.invoiceTotalCents ?? job.totalCents ?? job.rate ?? job.amount ?? 0);
const jobLaborCostCents = (job) => cents(job.laborCostCents ?? job.laborCost ?? 0);
const payrollLineCents = (line) => cents(line.totalAmountCents ?? line.amountCents ?? line.payCents ?? 0);

const normalizeDocs = (snapshot) => snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

const getCollection = async (companyId, collectionName) => {
  const snap = await getDocs(collection(db, "companies", companyId, collectionName));
  return normalizeDocs(snap);
};

const getDatabaseItems = async (companyId) => {
  const snap = await getDocs(collection(db, "companies", companyId, "settings", "dataBase", "dataBase"));
  return normalizeDocs(snap);
};

const safeFilePart = (value) =>
  String(value || "report")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";

const reportFileName = (reportData, extension) =>
  `${safeFilePart(reportData?.title)}_${format(new Date(), "yyyy-MM-dd_HH-mm")}.${extension}`;

const displayColumnValue = (column, row) => {
  const value = column.render ? column.render(row) : row[column.key];
  if (React.isValidElement(value)) return "";
  if (value === null || value === undefined) return "";
  return String(value);
};

const reportRowsForExport = (reportData) => {
  if (!reportData) return [];

  return (reportData.groups || []).flatMap((group) => {
    const dataRows = (group.rows || []).map((row) => {
      const exportRow = { Group: group.name };
      reportData.columns.forEach((column) => {
        exportRow[column.label] = displayColumnValue(column, row);
      });
      return exportRow;
    });

    if (!group.footerRow) return dataRows;

    const footerExportRow = { Group: `${group.name} Total` };
    reportData.columns.forEach((column) => {
      footerExportRow[column.label] = displayColumnValue(column, group.footerRow);
    });
    return [...dataRows, footerExportRow];
  });
};

const reportStatsForExport = (reportData) =>
  (reportData?.stats || []).map((stat) => ({
    Metric: stat.label,
    Value: stat.value,
    Subtitle: stat.subtitle || "",
  }));

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

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
    [reportData.title || "Report"],
    [],
    ["Metric", "Value", "Subtitle"],
    ...reportStatsForExport(reportData).map((stat) => [stat.Metric, stat.Value, stat.Subtitle]),
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
  const summarySheet = XLSX.utils.json_to_sheet(reportStatsForExport(reportData));
  const rows = reportRowsForExport(reportData);
  const dataSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Message: "No rows in this report." }]);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Report Data");
  XLSX.writeFile(workbook, reportFileName(reportData, "xlsx"));
  toast.success("Excel export ready.");
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const printableReportHtml = (reportData) => {
  const statsHtml = reportStatsForExport(reportData)
    .map((stat) => `
      <div class="stat">
        <span>${escapeHtml(stat.Metric)}</span>
        <strong>${escapeHtml(stat.Value)}</strong>
        ${stat.Subtitle ? `<small>${escapeHtml(stat.Subtitle)}</small>` : ""}
      </div>
    `)
    .join("");

  const groupsHtml = (reportData.groups || [])
    .map((group) => {
      const tableRows = (group.rows || []).map((row) => `
        <tr>
          ${reportData.columns.map((column) => `<td>${escapeHtml(displayColumnValue(column, row))}</td>`).join("")}
        </tr>
      `).join("");
      const footerRow = group.footerRow ? `
        <tr class="footer">
          ${reportData.columns.map((column) => `<td>${escapeHtml(displayColumnValue(column, group.footerRow))}</td>`).join("")}
        </tr>
      ` : "";

      return `
        <section>
          <h2>${escapeHtml(group.name)}</h2>
          <table>
            <thead>
              <tr>${reportData.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="${reportData.columns.length}">No rows in this group.</td></tr>`}
              ${footerRow}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(reportData.title || "Report")}</title>
        <style>
          body { color: #0f172a; font-family: Arial, sans-serif; margin: 28px; }
          h1 { font-size: 24px; margin: 0 0 4px; }
          .generated { color: #64748b; font-size: 12px; margin-bottom: 18px; }
          .stats { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); margin-bottom: 18px; }
          .stat { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
          .stat span { color: #64748b; display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .stat strong { display: block; font-size: 18px; margin-top: 4px; }
          .stat small { color: #64748b; display: block; margin-top: 2px; }
          section { break-inside: avoid; margin-top: 18px; }
          h2 { font-size: 16px; margin-bottom: 8px; }
          table { border-collapse: collapse; font-size: 11px; width: 100%; }
          th { background: #f1f5f9; color: #475569; font-size: 10px; text-align: left; text-transform: uppercase; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; }
          .footer td { background: #f8fafc; font-weight: 700; }
          @media print { body { margin: 18px; } .stats { grid-template-columns: repeat(2, 1fr); } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(reportData.title || "Report")}</h1>
        <div class="generated">Generated ${escapeHtml(format(new Date(), "MM/dd/yyyy h:mm a"))}</div>
        <div class="stats">${statsHtml}</div>
        ${groupsHtml}
      </body>
    </html>
  `;
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

const buildReadingReport = ({ stopData, readingTemplates, mode, groupBy }) => {
  const readingTemplatesById = templateMap(readingTemplates, "readingsTemplateId");
  const groups = new Map();
  const overall = { visits: 0, readings: 0 };

  stopData.forEach((stop) => {
    const readings = Array.isArray(stop.readings) ? stop.readings : [];
    if (!readings.length && mode === "summary") return;

    const group = ensureGroup(groups, groupKey(stop, groupBy));
    addMetric(group, "visits", 1);
    addMetric(group, "readings", readings.length);
    overall.visits += 1;
    overall.readings += readings.length;

    if (mode === "summary") {
      readings.forEach((reading) => {
        const name = templateName(reading, readingTemplatesById, "Reading");
        const value = toNumber(reading.amount);
        const row = group.rows.find((item) => item.name === name);
        if (row) {
          row.count += 1;
          row.total += value;
          row.min = Math.min(row.min, value);
          row.max = Math.max(row.max, value);
        } else {
          group.rows.push({ name, count: 1, total: value, min: value, max: value });
        }
      });
    } else {
      group.rows.push({
        date: shortDate(stop.date),
        customer: stop.customerName || "-",
        worker: stop.userName || stop.techName || stop.tech || "-",
        values: readings.map((reading) => `${templateName(reading, readingTemplatesById, "Reading")}: ${valueWithUnit(reading)}`).join(", ") || "-",
      });
    }
  });

  return {
    title: "Readings Report",
    stats: [
      numberMetric("Service Visits", overall.visits),
      numberMetric("Readings", overall.readings),
      numberMetric("Templates", readingTemplates.length),
    ],
    columns: mode === "summary"
      ? [
          { key: "name", label: "Reading" },
          { key: "count", label: "Count", align: "right" },
          { key: "average", label: "Average", align: "right", render: (row) => (row.count ? (row.total / row.count).toFixed(2) : "0") },
          { key: "min", label: "Low", align: "right", render: (row) => row.min.toFixed(2) },
          { key: "max", label: "High", align: "right", render: (row) => row.max.toFixed(2) },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "worker", label: "Worker" },
          { key: "values", label: "Readings" },
        ],
    groups: [...groups.values()],
  };
};

const buildReadingHealthReport = ({
  stopData,
  readingTemplates,
  bodiesOfWater,
  customersById = new Map(),
  readingHealthFilters,
  mode,
}) => {
  const selectedTemplate =
    readingTemplates.find((template) => readingTemplateKey(template) === readingHealthFilters.templateId) ||
    readingTemplates[0] ||
    {};
  const operator = readingHealthFilters.operator || "gt";
  const threshold = parseReadingNumber(readingHealthFilters.threshold);
  const readingName = selectedTemplate.name || selectedTemplate.chemType || "Reading";
  const unit = selectedTemplate.UOM || selectedTemplate.uom || "";
  const bodiesById = new Map((bodiesOfWater || []).map((body) => [body.id, body]));
  const poolsById = new Map();
  const detailRows = [];

  stopData.forEach((stop) => {
    const readings = Array.isArray(stop.readings) ? stop.readings : [];

    readings.forEach((reading) => {
      if (!readingMatchesTemplate(reading, selectedTemplate)) return;

      const readingValue = parseReadingNumber(reading.amount);
      if (!compareReadingValue(readingValue, operator, threshold)) return;

      const bodyOfWaterId = reading.bodyOfWaterId || stop.bodyOfWaterId || "unknown";
      const bodyOfWater = bodiesById.get(bodyOfWaterId) || {};
      const customerId = stop.customerId || reading.customerId || bodyOfWater.customerId || stop.internalCustomerId || "";
      const customer = customerId ? customersById.get(customerId) : null;
      const readingDate = dateFromValue(stop.date);
      const displayValue = [
        readingValue.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        reading.UOM || reading.uom || unit,
      ].filter(Boolean).join(" ");
      const poolName =
        bodyOfWater.name ||
        bodyOfWater.nickName ||
        stop.bodyOfWaterName ||
        stop.poolName ||
        "Unknown Pool";
      const customerName =
        customerDisplayName(customer) ||
        bodyOfWater.customerName ||
        stop.customerName ||
        customerId ||
        "-";
      const contact = customerContactInfo(customer) || "-";
      const workerName =
        stop.userName ||
        stop.techName ||
        stop.tech ||
        stop.workerName ||
        stop.companyUserName ||
        "-";
      const row = {
        id: `${stop.id || stop.serviceStopId || "stop"}-${reading.id || reading.templateId || detailRows.length}`,
        sortTime: readingDate ? readingDate.getTime() : 0,
        date: shortDate(stop.date),
        pool: poolName,
        customer: customerName,
        contact,
        customerId: customerId || "-",
        worker: workerName,
        reading: reading.name || readingName,
        value: displayValue,
        rule: `${readingOperatorLabel(operator)} ${readingHealthFilters.threshold}${unit ? ` ${unit}` : ""}`,
        serviceStop: stop.serviceStopId || stop.id || "-",
        bodyOfWaterId,
      };

      detailRows.push(row);

      const poolKey = bodyOfWaterId || `${poolName}-${customerName}`;
      const existingPool = poolsById.get(poolKey);
      if (existingPool) {
        existingPool.matches += 1;
        existingPool.contact = existingPool.contact !== "-" ? existingPool.contact : contact;
        existingPool.customer = existingPool.customer !== "-" ? existingPool.customer : customerName;
        if (row.sortTime >= existingPool.latestSortTime) {
          existingPool.latestSortTime = row.sortTime;
          existingPool.latestDate = row.date;
          existingPool.latestValue = row.value;
          existingPool.lastWorker = row.worker;
        }
      } else {
        poolsById.set(poolKey, {
          id: poolKey,
          pool: poolName,
          customer: customerName,
          contact,
          customerId: customerId || "-",
          matches: 1,
          latestSortTime: row.sortTime,
          latestDate: row.date,
          latestValue: row.value,
          lastWorker: row.worker,
          bodyOfWaterId: bodyOfWaterId === "unknown" ? "-" : bodyOfWaterId,
        });
      }
    });
  });

  const summaryRows = [...poolsById.values()]
    .sort((a, b) => b.latestSortTime - a.latestSortTime || b.matches - a.matches)
    .map(({ latestSortTime, ...row }) => row);
  const detailReportRows = detailRows
    .sort((a, b) => b.sortTime - a.sortTime)
    .map(({ sortTime, ...row }) => row);
  const ruleLabel = `${readingOperatorLabel(operator)} ${readingHealthFilters.threshold}${unit ? ` ${unit}` : ""}`;

  return {
    title: "Reading Health Report",
    stats: [
      numberMetric("Matching Pools", summaryRows.length),
      numberMetric("Matching Readings", detailRows.length),
      { label: "Rule", value: ruleLabel, subtitle: readingName },
      numberMetric("Templates", readingTemplates.length),
    ],
    columns: mode === "summary"
      ? [
          { key: "pool", label: "Pool" },
          { key: "customer", label: "Customer" },
          { key: "contact", label: "Contact" },
          { key: "matches", label: "Matches", align: "right" },
          { key: "latestValue", label: "Latest Match", align: "right" },
          { key: "latestDate", label: "Latest Date" },
          { key: "lastWorker", label: "Worker" },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "pool", label: "Pool" },
          { key: "customer", label: "Customer" },
          { key: "contact", label: "Contact" },
          { key: "worker", label: "Worker" },
          { key: "reading", label: "Reading" },
          { key: "value", label: "Value", align: "right" },
          { key: "serviceStop", label: "Service Stop" },
        ],
    groups: [
      {
        id: "reading-health",
        name: "Matching Pools",
        metrics: {
          pools: summaryRows.length,
          readings: detailRows.length,
        },
        rows: mode === "summary" ? summaryRows : detailReportRows,
      },
    ],
  };
};

const buildChemicalReport = ({ stopData, dosageTemplates, mode, groupBy }) => {
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const groups = new Map();
  const overall = { visits: 0, dosages: 0, amount: 0 };

  stopData.forEach((stop) => {
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    if (!dosages.length && mode === "summary") return;

    const group = ensureGroup(groups, groupKey(stop, groupBy));
    addMetric(group, "visits", 1);
    addMetric(group, "dosages", dosages.length);
    overall.visits += 1;
    overall.dosages += dosages.length;

    if (mode === "summary") {
      dosages.forEach((dosage) => {
        const name = templateName(dosage, dosageTemplatesById, "Dosage");
        const amount = toNumber(dosage.amount);
        overall.amount += amount;
        const row = group.rows.find((item) => item.name === name);
        if (row) {
          row.count += 1;
          row.amount += amount;
        } else {
          group.rows.push({ name, count: 1, amount });
        }
      });
    } else {
      group.rows.push({
        date: shortDate(stop.date),
        customer: stop.customerName || "-",
        worker: stop.userName || stop.techName || stop.tech || "-",
        values: dosages.map((dosage) => `${templateName(dosage, dosageTemplatesById, "Dosage")}: ${valueWithUnit(dosage)}`).join(", ") || "-",
      });
    }
  });

  return {
    title: "Chemicals Report",
    stats: [
      numberMetric("Service Visits", overall.visits),
      numberMetric("Dosages", overall.dosages),
      numberMetric("Total Amount", overall.amount.toFixed(2)),
    ],
    columns: mode === "summary"
      ? [
          { key: "name", label: "Dosage" },
          { key: "count", label: "Uses", align: "right" },
          { key: "amount", label: "Total Amount", align: "right", render: (row) => row.amount.toLocaleString() },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "worker", label: "Worker" },
          { key: "values", label: "Dosages" },
        ],
    groups: [...groups.values()],
  };
};

const buildPurchaseReport = ({ purchases, databaseItemById, mode, groupBy }) => {
  const groups = new Map();
  let totalCents = 0;

  purchases.forEach((item) => {
    const group = ensureGroup(groups, groupKey(item, groupBy));
    const category = purchaseCategory(item, databaseItemById);
    const amount = purchaseTotalCents(item);
    const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
    totalCents += amount;
    addMetric(group, "items", 1);
    addMetric(group, "spend", amount);

    if (mode === "summary") {
      const row = group.rows.find((entry) => entry.name === category);
      if (row) {
        row.count += 1;
        row.totalCents += amount;
      } else {
        group.rows.push({ name: category, count: 1, totalCents: amount });
      }
    } else {
      group.rows.push({
        date: shortDate(item.date),
        name: item.name || "Unnamed Item",
        category,
        quantity,
        totalCents: amount,
      });
    }
  });

  const resultGroups = [...groups.values()].map((group) => ({
    ...group,
    footerRow:
      mode === "summary"
        ? {
            name: "Total",
            count: group.metrics.items || 0,
            totalCents: group.metrics.spend || 0,
          }
        : {
            date: "Total",
            name: "",
            category: "",
            quantity: "",
            totalCents: group.metrics.spend || 0,
          },
  }));

  return {
    title: "Purchases Report",
    stats: [
      moneyMetric("Total Spend", totalCents),
      numberMetric("Purchase Lines", purchases.length),
      numberMetric("Groups", groups.size),
    ],
    columns: mode === "summary"
      ? [
          { key: "name", label: "Category" },
          { key: "count", label: "Lines", align: "right" },
          { key: "totalCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.totalCents) },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "name", label: "Item" },
          { key: "category", label: "Category" },
          { key: "quantity", label: "Qty", align: "right" },
          { key: "totalCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.totalCents) },
        ],
    total: {
      label: "Purchases Total",
      value: moneyFromCents(totalCents),
      subtitle: `${purchases.length.toLocaleString()} purchase line(s)`,
    },
    groups: resultGroups,
  };
};

const buildWasteReport = ({ stopData, purchases, databaseItemById, groupBy }) => {
  const groups = new Map();
  const chemicalPurchases = purchases.filter((item) => {
    const category = purchaseCategory(item, databaseItemById).toLowerCase();
    return category.includes("chemical") || String(item.name || "").toLowerCase().includes("chlorine") || String(item.name || "").toLowerCase().includes("acid");
  });
  let usedAmount = 0;
  let chemicalSpend = 0;

  stopData.forEach((stop) => {
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    const group = ensureGroup(groups, groupKey(stop, groupBy));
    dosages.forEach((dosage) => {
      const amount = toNumber(dosage.amount);
      usedAmount += amount;
      addMetric(group, "usedAmount", amount);
      const name = dosage.name || "Chemical";
      const row = group.rows.find((item) => item.name === name);
      if (row) {
        row.usedAmount += amount;
        row.uses += 1;
      } else {
        group.rows.push({ name, usedAmount: amount, uses: 1, chemicalSpendCents: 0 });
      }
    });
  });

  chemicalPurchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    const amount = purchaseTotalCents(purchase);
    chemicalSpend += amount;
    addMetric(group, "chemicalSpendCents", amount);
    const name = purchase.name || "Chemical Purchase";
    const row = group.rows.find((item) => item.name === name);
    if (row) {
      row.chemicalSpendCents += amount;
    } else {
      group.rows.push({ name, usedAmount: 0, uses: 0, chemicalSpendCents: amount });
    }
  });

  return {
    title: "Waste Report",
    stats: [
      numberMetric("Used Amount", usedAmount.toFixed(2)),
      moneyMetric("Chemical Spend", chemicalSpend),
      numberMetric("Chemical Purchase Lines", chemicalPurchases.length),
    ],
    columns: [
      { key: "name", label: "Chemical" },
      { key: "uses", label: "Uses", align: "right" },
      { key: "usedAmount", label: "Used Amount", align: "right", render: (row) => row.usedAmount.toLocaleString() },
      { key: "chemicalSpendCents", label: "Purchase Spend", align: "right", render: (row) => moneyFromCents(row.chemicalSpendCents) },
    ],
    groups: [...groups.values()],
  };
};

const buildUsersReport = ({ users, serviceStops, jobs, purchases, payrollLines }) => {
  const groups = new Map();
  users.forEach((user) => {
    ensureGroup(groups, { id: user.userId || user.id, name: user.userName || user.name || user.id }).rows.push({
      role: user.roleName || "-",
      workerType: user.workerType || "-",
      status: user.status || "-",
      stops: 0,
      jobs: 0,
      purchasesCents: 0,
      payrollCents: 0,
    });
  });

  const userRow = (id, name) => {
    const group = ensureGroup(groups, { id: id || "unassigned", name: name || "Unassigned" });
    if (!group.rows.length) {
      group.rows.push({ role: "-", workerType: "-", status: "-", stops: 0, jobs: 0, purchasesCents: 0, payrollCents: 0 });
    }
    return group.rows[0];
  };

  serviceStops.forEach((stop) => {
    userRow(stop.techId || stop.userId, stop.tech || stop.userName).stops += 1;
  });
  jobs.forEach((job) => {
    userRow(job.adminId || job.techId || job.userId, job.adminName || job.techName || job.userName).jobs += 1;
  });
  purchases.forEach((purchase) => {
    userRow(purchase.techId, purchase.techName).purchasesCents += purchaseTotalCents(purchase);
  });
  payrollLines.forEach((line) => {
    userRow(line.technicianId || line.userId || line.techId, line.technicianName || line.userName || line.techName).payrollCents += payrollLineCents(line);
  });

  return {
    title: "Users Report",
    stats: [
      numberMetric("Users", groups.size),
      numberMetric("Service Stops", serviceStops.length),
      moneyMetric("Payroll", payrollLines.reduce((total, line) => total + payrollLineCents(line), 0)),
    ],
    columns: [
      { key: "role", label: "Role" },
      { key: "workerType", label: "Worker Type" },
      { key: "status", label: "Status" },
      { key: "stops", label: "Stops", align: "right" },
      { key: "jobs", label: "Jobs", align: "right" },
      { key: "purchasesCents", label: "Purchases", align: "right", render: (row) => moneyFromCents(row.purchasesCents) },
      { key: "payrollCents", label: "Payroll", align: "right", render: (row) => moneyFromCents(row.payrollCents) },
    ],
    groups: [...groups.values()],
  };
};

const buildPnlReport = ({ jobs, purchases, payrollLines, groupBy }) => {
  const groups = new Map();
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    addMetric(group, "revenueCents", jobRevenueCents(job));
    addMetric(group, "jobLaborCents", jobLaborCostCents(job));
  });
  purchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    addMetric(group, "purchaseCents", purchaseTotalCents(purchase));
  });
  payrollLines.forEach((line) => {
    const group = ensureGroup(groups, groupKey(line, groupBy));
    addMetric(group, "payrollCents", payrollLineCents(line));
  });

  const resultGroups = [...groups.values()].map((group) => {
    const revenueCents = group.metrics.revenueCents || 0;
    const costCents = (group.metrics.purchaseCents || 0) + (group.metrics.payrollCents || 0) + (group.metrics.jobLaborCents || 0);
    group.rows = [{ revenueCents, costCents, netCents: revenueCents - costCents }];
    return group;
  });

  return {
    title: "P.N.L. Report",
    stats: [
      moneyMetric("Revenue", resultGroups.reduce((total, group) => total + group.rows[0].revenueCents, 0)),
      moneyMetric("Costs", resultGroups.reduce((total, group) => total + group.rows[0].costCents, 0)),
      moneyMetric("Net", resultGroups.reduce((total, group) => total + group.rows[0].netCents, 0)),
    ],
    columns: [
      { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
      { key: "costCents", label: "Costs", align: "right", render: (row) => moneyFromCents(row.costCents) },
      { key: "netCents", label: "Net", align: "right", render: (row) => moneyFromCents(row.netCents) },
    ],
    groups: resultGroups,
  };
};

const buildJobReport = ({ jobs, purchases, payrollLines, groupBy }) => {
  const purchaseByJob = new Map();
  purchases.forEach((purchase) => {
    if (purchase.jobId) purchaseByJob.set(purchase.jobId, (purchaseByJob.get(purchase.jobId) || 0) + purchaseTotalCents(purchase));
  });
  const payrollByJob = new Map();
  payrollLines.forEach((line) => {
    if (line.jobId) payrollByJob.set(line.jobId, (payrollByJob.get(line.jobId) || 0) + payrollLineCents(line));
  });

  const groups = new Map();
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    const revenueCents = jobRevenueCents(job);
    const costCents = purchaseByJob.get(job.id) || 0;
    const payrollCents = payrollByJob.get(job.id) || 0;
    group.rows.push({
      internalId: job.internalId || "Job",
      date: shortDate(itemDate(job, ["invoiceDate", "dateCreated", "createdAt"])),
      customer: job.customerName || "-",
      operationStatus: job.operationStatus || "-",
      billingStatus: job.billingStatus || "-",
      revenueCents,
      costCents,
      payrollCents,
    });
  });

  return {
    title: "Jobs Report",
    stats: [
      numberMetric("Jobs", jobs.length),
      moneyMetric("Revenue", jobs.reduce((total, job) => total + jobRevenueCents(job), 0)),
      moneyMetric("Known Costs", purchases.reduce((total, purchase) => total + purchaseTotalCents(purchase), 0) + payrollLines.reduce((total, line) => total + payrollLineCents(line), 0)),
    ],
    columns: [
      { key: "internalId", label: "Job" },
      { key: "date", label: "Date" },
      { key: "customer", label: "Customer" },
      { key: "operationStatus", label: "Ops" },
      { key: "billingStatus", label: "Billing" },
      { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
      { key: "costCents", label: "Purchases", align: "right", render: (row) => moneyFromCents(row.costCents) },
      { key: "payrollCents", label: "Payroll", align: "right", render: (row) => moneyFromCents(row.payrollCents) },
    ],
    groups: [...groups.values()],
  };
};

const buildVehicleReport = ({ vehicles, activeRoutes, mode }) => {
  const routesByVehicle = new Map();
  activeRoutes.forEach((route) => {
    const vehicleId = route.vehicalId || route.vehicleId || "unassigned";
    if (!routesByVehicle.has(vehicleId)) routesByVehicle.set(vehicleId, []);
    routesByVehicle.get(vehicleId).push(route);
  });

  const groups = vehicles.map((vehicle) => {
    const routes = routesByVehicle.get(vehicle.id) || [];
    const distance = routes.reduce((total, route) => total + toNumber(route.distanceMiles || route.distance || 0), 0);
    return {
      id: vehicle.id,
      name: vehicle.nickName || `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim() || "Vehicle",
      metrics: {},
      rows: mode === "summary"
        ? [{ type: vehicle.vehicalType || "-", status: vehicle.status || "-", miles: toNumber(vehicle.miles), routes: routes.length, distance }]
        : routes.map((route) => ({
            date: shortDate(itemDate(route, ["date", "routeDate", "startTime", "createdAt"])),
            worker: route.techName || route.companyUserName || "-",
            status: route.status || "-",
            distance: toNumber(route.distanceMiles || route.distance || 0),
          })),
    };
  });

  return {
    title: "Vehicle Report",
    stats: [
      numberMetric("Vehicles", vehicles.length),
      numberMetric("Routes", activeRoutes.length),
      numberMetric("Route Miles", activeRoutes.reduce((total, route) => total + toNumber(route.distanceMiles || route.distance || 0), 0).toFixed(1)),
    ],
    columns: mode === "summary"
      ? [
          { key: "type", label: "Type" },
          { key: "status", label: "Status" },
          { key: "miles", label: "Odometer", align: "right", render: (row) => row.miles.toLocaleString() },
          { key: "routes", label: "Routes", align: "right" },
          { key: "distance", label: "Route Miles", align: "right", render: (row) => row.distance.toLocaleString() },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "worker", label: "Worker" },
          { key: "status", label: "Status" },
          { key: "distance", label: "Miles", align: "right", render: (row) => row.distance.toLocaleString() },
        ],
    groups,
  };
};

const buildTaxReport = ({ purchases, jobs, groupBy }) => {
  const groups = new Map();
  purchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    const preTaxCents = purchasePreTaxCents(purchase);
    const afterTaxCents = purchaseTotalCents(purchase);
    const taxCents = Math.max(0, afterTaxCents - preTaxCents);
    addMetric(group, "purchaseTaxCents", taxCents);
    addMetric(group, "purchasePreTaxCents", preTaxCents);
  });
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    addMetric(group, "revenueCents", jobRevenueCents(job));
    addMetric(group, "revenueTaxCents", cents(job.taxCents ?? job.invoiceTaxCents ?? 0));
  });

  const resultGroups = [...groups.values()].map((group) => {
    group.rows = [{
      purchasePreTaxCents: group.metrics.purchasePreTaxCents || 0,
      purchaseTaxCents: group.metrics.purchaseTaxCents || 0,
      revenueCents: group.metrics.revenueCents || 0,
      revenueTaxCents: group.metrics.revenueTaxCents || 0,
    }];
    return group;
  });

  return {
    title: "Tax Report",
    stats: [
      moneyMetric("Purchase Tax", resultGroups.reduce((total, group) => total + group.rows[0].purchaseTaxCents, 0)),
      moneyMetric("Revenue Tax", resultGroups.reduce((total, group) => total + group.rows[0].revenueTaxCents, 0)),
      moneyMetric("Taxable Purchases", resultGroups.reduce((total, group) => total + group.rows[0].purchasePreTaxCents, 0)),
    ],
    columns: [
      { key: "purchasePreTaxCents", label: "Purchase Pretax", align: "right", render: (row) => moneyFromCents(row.purchasePreTaxCents) },
      { key: "purchaseTaxCents", label: "Purchase Tax", align: "right", render: (row) => moneyFromCents(row.purchaseTaxCents) },
      { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
      { key: "revenueTaxCents", label: "Revenue Tax", align: "right", render: (row) => moneyFromCents(row.revenueTaxCents) },
    ],
    groups: resultGroups,
  };
};

const StatCard = ({ title, value, subtitle }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 break-words text-xl font-bold text-slate-900 sm:text-2xl">{value}</p>
    {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
  </div>
);

const ReportCatalogCard = ({ report, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(report.value)}
    className={`h-full rounded-lg border p-3 text-left shadow-sm transition ${
      selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:border-slate-400"
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-bold">{report.label}</p>
        <p className={`mt-1 text-xs ${selected ? "text-slate-200" : "text-slate-500"}`}>{report.source}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selected ? "bg-white text-slate-900" : "bg-slate-100 text-slate-600"}`}>
        {report.status}
      </span>
    </div>
  </button>
);

const ReportTable = ({ columns, rows, footerRow }) => (
  <div className="mt-4 overflow-x-auto">
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
                {column.render ? column.render(row) : row[column.key] ?? "-"}
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
                {column.render ? column.render(footerRow) : footerRow[column.key] || (column.key === columns[0].key ? "Total" : "")}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  </div>
);

const GeneratedReportView = ({ data }) => {
  if (!data) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 shadow-sm xl:h-full xl:min-h-0">
        Generate a report to see results.
      </div>
    );
  }

  return (
    <section className="flex min-h-[520px] flex-col rounded-lg border border-slate-200 bg-white shadow-sm xl:h-full xl:min-h-0">
      <div className="shrink-0 border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{data.title || "Generated Report"}</h2>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.stats.map((stat) => (
            <StatCard key={stat.label} title={stat.label} value={stat.value} subtitle={stat.subtitle} />
          ))}
        </div>

        {data.total ? (
          <div className="mt-4 rounded-lg border border-slate-300 bg-slate-900 p-4 text-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{data.total.label}</p>
            <p className="mt-1 text-2xl font-bold">{data.total.value}</p>
            {data.total.subtitle ? <p className="mt-1 text-sm text-slate-300">{data.total.subtitle}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {data.groups.length ? (
          <div className="grid gap-4">
            {data.groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{group.name}</h3>
                  {Object.keys(group.metrics || {}).length ? (
                    <p className="mt-1 text-sm text-slate-500">
                      {Object.entries(group.metrics).map(([key, value]) => `${key}: ${typeof value === "number" ? value.toLocaleString() : value}`).join(" | ")}
                    </p>
                  ) : null}
                </div>
                <ReportTable columns={data.columns} rows={group.rows} footerRow={group.footerRow} />
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
    `flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
      accent === "dark"
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

const Reports = () => {
  const { recentlySelectedCompany, companyRole } = useContext(Context);
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
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  });
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reportSearchDraft, setReportSearchDraft] = useState("");
  const [reportSearchTerm, setReportSearchTerm] = useState("");

  const selectedReport = useMemo(
    () => reportCatalog.find((report) => report.value === reportType) || reportCatalog[0],
    [reportType]
  );

  const filteredReportCatalog = useMemo(() => {
    const search = reportSearchTerm.trim().toLowerCase();
    if (!search) return reportCatalog;

    return reportCatalog.filter((report) => {
      const category = reportCategories.find((item) => item.value === report.category)?.label || "";
      return [report.label, report.source, category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(search));
    });
  }, [reportSearchTerm]);

  const roleTagAccess = useMemo(() => getRoleCustomerTagAccess(companyRole), [companyRole]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAvailableCustomerTags([]);
      setSelectedCustomerTags([]);
      return;
    }

    const fetchCustomerTags = async () => {
      try {
        const customers = await getCollection(recentlySelectedCompany, "customers");
        const visibleCustomers = filterCustomersByRoleTagAccess(customers, companyRole);
        setAvailableCustomerTags(getCustomerTagOptions(visibleCustomers));
        setSelectedCustomerTags((currentTags) =>
          currentTags.filter((tag) => getCustomerTagOptions(visibleCustomers).includes(tag))
        );
      } catch (error) {
        console.error("Failed to load customer tags for reports:", error);
      }
    };

    fetchCustomerTags();
  }, [recentlySelectedCompany, companyRole]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAvailableReadingTemplates([]);
      setReadingHealthFilters({ templateId: "", operator: "gt", threshold: "" });
      return;
    }

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
      } catch (error) {
        console.error("Failed to load reading templates for reports:", error);
      }
    };

    fetchReadingTemplates();

    return () => {
      isActive = false;
    };
  }, [recentlySelectedCompany]);

  const handleReportSelect = (value) => {
    setReportType(value);
    setReportData(null);
  };

  const handleReportSearch = (event) => {
    event.preventDefault();
    setReportSearchTerm(reportSearchDraft.trim());
  };

  const clearReportSearch = () => {
    setReportSearchDraft("");
    setReportSearchTerm("");
  };

  const handleReadingTemplateChange = (templateId) => {
    const nextTemplate = availableReadingTemplates.find((template) => readingTemplateKey(template) === templateId);
    setReadingHealthFilters(nextTemplate ? defaultReadingHealthFilterFor(nextTemplate) : { templateId, operator: "gt", threshold: "" });
    setReportData(null);
  };

  const handleReadingHealthFilterChange = (field, value) => {
    setReadingHealthFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
    setReportData(null);
  };

  const toggleCustomerTagFilter = (tag) => {
    setReportData(null);
    setSelectedCustomerTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    );
  };

  const handleGenerateReport = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Please select a company.");
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

    setIsLoading(true);
    const toastId = toast.loading(`Generating ${selectedReport.label.toLowerCase()} report...`);

    try {
      const startDate = new Date(`${dateRange.start}T00:00:00`);
      const endDate = new Date(`${dateRange.end}T23:59:59`);
      const [stopDataSnap, readingsSnap, dosagesSnap, customersRaw] = await Promise.all([
        getDocs(query(collection(db, "companies", recentlySelectedCompany, "stopData"), where("date", ">=", startDate), where("date", "<=", endDate))),
        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages")),
        getCollection(recentlySelectedCompany, "customers"),
      ]);
      const visibleCustomers = filterCustomersByRoleTagAccess(customersRaw, companyRole);
      const reportCustomers = selectedCustomerTags.length
        ? visibleCustomers.filter((customer) => customerHasAnyTag(customer, selectedCustomerTags))
        : visibleCustomers;
      const customersById = new Map(reportCustomers.map((customer) => [customer.id, customer]));
      const tagFilterContext = { customersById, role: companyRole, selectedTags: selectedCustomerTags };

      const stopData = filterRecordsByCustomerTags({
        records: normalizeDocs(stopDataSnap),
        ...tagFilterContext,
      });
      const readingTemplates = sortReadingTemplates(normalizeDocs(readingsSnap));
      const dosageTemplates = normalizeDocs(dosagesSnap);

      const needsPurchases = ["purchases", "waste", "pnl", "job", "tax", "users"].includes(reportType);
      const needsJobs = ["pnl", "job", "tax", "users"].includes(reportType);
      const needsPayroll = ["pnl", "job", "users"].includes(reportType);
      const needsUsers = reportType === "users";
      const needsFleet = reportType === "vehicle";
      const needsBodiesOfWater = reportType === "readingHealth";

      const [
        purchasesRaw,
        databaseItemsRaw,
        jobsRaw,
        payrollLinesRaw,
        serviceStopsRaw,
        usersRaw,
        vehiclesRaw,
        activeRoutesRaw,
        bodiesOfWaterRaw,
      ] = await Promise.all([
        needsPurchases ? getCollection(recentlySelectedCompany, "purchasedItems") : Promise.resolve([]),
        needsPurchases ? getDatabaseItems(recentlySelectedCompany) : Promise.resolve([]),
        needsJobs ? getCollection(recentlySelectedCompany, "workOrders") : Promise.resolve([]),
        needsPayroll ? getCollection(recentlySelectedCompany, "technicianPayLineItems") : Promise.resolve([]),
        needsUsers ? getCollection(recentlySelectedCompany, "serviceStops") : Promise.resolve([]),
        needsUsers ? getCollection(recentlySelectedCompany, "companyUsers") : Promise.resolve([]),
        needsFleet ? getCollection(recentlySelectedCompany, "vehicals") : Promise.resolve([]),
        needsFleet ? getCollection(recentlySelectedCompany, "activeRoutes") : Promise.resolve([]),
        needsBodiesOfWater ? getCollection(recentlySelectedCompany, "bodiesOfWater") : Promise.resolve([]),
      ]);

      const purchases = filterRecordsByCustomerTags({
        records: purchasesRaw.filter((item) => inRange(item, startDate, endDate, ["date", "createdAt", "dateCreated"])),
        ...tagFilterContext,
      });
      const jobs = filterRecordsByCustomerTags({
        records: jobsRaw.filter((item) => inRange(item, startDate, endDate, ["invoiceDate", "dateCreated", "createdAt", "completedAt"])),
        ...tagFilterContext,
      });
      const payrollLines = filterRecordsByCustomerTags({
        records: payrollLinesRaw.filter((item) => inRange(item, startDate, endDate, ["completedDate", "createdAt", "paidAt"])),
        ...tagFilterContext,
      });
      const serviceStops = filterRecordsByCustomerTags({
        records: serviceStopsRaw.filter((item) => inRange(item, startDate, endDate, ["serviceDate", "date", "createdAt"])),
        ...tagFilterContext,
      });
      const bodiesOfWater = filterRecordsByCustomerTags({
        records: bodiesOfWaterRaw,
        ...tagFilterContext,
      });
      const activeRoutes = activeRoutesRaw.filter((item) => inRange(item, startDate, endDate, ["date", "routeDate", "startTime", "createdAt"]));
      const databaseItemById = new Map(databaseItemsRaw.map((item) => [item.id, item]));

      const context = {
        stopData,
        readingTemplates,
        dosageTemplates,
        readingHealthFilters,
        bodiesOfWater,
        customersById,
        purchases,
        databaseItemById,
        jobs,
        payrollLines,
        serviceStops,
        users: usersRaw,
        vehicles: vehiclesRaw,
        activeRoutes,
        mode,
        groupBy,
      };

      const builders = {
        readings: buildReadingReport,
        readingHealth: buildReadingHealthReport,
        chemicals: buildChemicalReport,
        purchases: buildPurchaseReport,
        waste: buildWasteReport,
        users: buildUsersReport,
        pnl: buildPnlReport,
        job: buildJobReport,
        vehicle: buildVehicleReport,
        tax: buildTaxReport,
      };

      const nextReport = builders[reportType](context);
      setReportData({
        ...nextReport,
        stats: [
          ...(nextReport.stats || []),
          { label: "Date Range", value: `${dateRange.start} - ${dateRange.end}` },
          { label: "Customer Tags", value: selectedCustomerTags.length ? selectedCustomerTags.join(", ") : roleTagAccess.length ? roleTagAccess.join(", ") : "All" },
        ],
      });
      toast.success(`${selectedReport.label} report generated.`, { id: toastId });
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error(`Report generation failed: ${error.message}`, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-4 lg:p-5">
      <div className="mx-auto w-full max-w-[1800px]">
        <header className="mb-4">
          <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-slate-600">Operations and finance reporting.</p>
        </header>

        <div className="grid gap-4 xl:h-[calc(100vh-112px)] xl:grid-cols-[minmax(0,1fr)_340px] xl:overflow-hidden">
          <div className="grid min-h-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:h-full xl:overflow-y-auto">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Report Controls</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">{selectedReport.label}</p>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Output</label>
                  <select
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value);
                      setReportData(null);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                  >
                    <option value="summary">Summary</option>
                    <option value="detail">Detail</option>
                  </select>
                </div>

                {reportType !== "readingHealth" ? (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Group By</label>
                    <select
                      value={groupBy}
                      onChange={(event) => {
                        setGroupBy(event.target.value);
                        setReportData(null);
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

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-sm font-semibold text-slate-700">Customer Tags</label>
                    {selectedCustomerTags.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomerTags([]);
                          setReportData(null);
                        }}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  {roleTagAccess.length > 0 ? (
                    <p className="mt-1 text-xs text-blue-700">
                      Role limited to {roleTagAccess.join(", ")}.
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
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                              selected
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
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={dateRange.start}
                      onChange={(event) => {
                        setDateRange((prev) => ({ ...prev, start: event.target.value }));
                        setReportData(null);
                      }}
                      className="rounded-md border border-slate-300 p-2 text-sm"
                    />
                    <input
                      type="date"
                      value={dateRange.end}
                      onChange={(event) => {
                        setDateRange((prev) => ({ ...prev, end: event.target.value }));
                        setReportData(null);
                      }}
                      className="rounded-md border border-slate-300 p-2 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={isLoading}
                  className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? "Generating..." : "Generate"}
                </button>

                <ExportSection reportData={reportData} />
              </div>
            </div>

            <GeneratedReportView data={reportData} />
          </div>

          <aside className="order-first min-h-0 xl:order-none">
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
