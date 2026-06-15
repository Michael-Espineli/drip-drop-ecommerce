import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import * as XLSX from "xlsx";
import {
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PrinterIcon,
  TableCellsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { estimateServiceStopPaySummary } from "../../../utils/payroll/payEstimate";
import {
  customerHasAnyTag,
  filterCustomersByRoleTagAccess,
  filterRecordsByCustomerTags,
  getCustomerTagOptions,
  getRoleCustomerTagAccess,
} from "../../../utils/customerTags";
import {
  ChemicalBillingTreatment,
  classifyAgreementChemicalBilling,
} from "../../../utils/sales/chemicalBilling";

const reportCategories = [
  { value: "operations", label: "Operations" },
  { value: "performance", label: "Performance" },
  { value: "finance", label: "Finance / Accounting" },
];

const reportCatalog = [
  { value: "readings", label: "Readings Summary", status: "Ready", source: "stopData readings", category: "operations" },
  { value: "readingHealth", label: "Reading Health", status: "Ready", source: "reading thresholds by pool", category: "operations" },
  { value: "readingPerformance", label: "Reading Performance", status: "Ready", source: "stopData standards by user or customer", category: "performance" },
  { value: "pnlPerPool", label: "PNL Per Pool", status: "Ready", source: "service agreements, labor, chemicals", category: "performance" },
  { value: "chemicals", label: "Chemicals", status: "Ready", source: "stopData dosages", category: "operations" },
  { value: "waste", label: "Waste", status: "Ready", source: "linked dosages and purchased items", category: "performance" },
  { value: "users", label: "Users", status: "Ready", source: "users, stops, jobs, purchases, payroll", category: "operations" },
  { value: "job", label: "Jobs", status: "Ready", source: "workOrders, purchases, payroll", category: "operations" },
  { value: "vehicle", label: "Vehicle", status: "Ready", source: "vehicals and activeRoutes", category: "operations" },
  { value: "purchases", label: "Purchases", status: "Ready", source: "purchasedItems and database items", category: "finance" },
  { value: "pnl", label: "P.N.L.", status: "Ready", source: "service agreements, jobs, purchases, payroll", category: "finance" },
  { value: "tax", label: "Tax", status: "Ready", source: "purchases and invoiced jobs", category: "finance" },
];

const fixedGroupingReportTypes = new Set(["readingHealth", "readingPerformance", "pnlPerPool"]);

const readingPerformanceViewOptions = [
  { value: "users", label: "Users" },
  { value: "customers", label: "Customers" },
];

const groupOptions = [
  { value: "company", label: "Company" },
  { value: "user", label: "User" },
  { value: "customer", label: "Customer" },
];

const dateInputValue = (date) => format(date, "yyyy-MM-dd");

const dateRangeFromDates = (start, end) => ({
  start: dateInputValue(start),
  end: dateInputValue(end),
});

const displayDateInputValue = (value) => {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : format(parsed, "M/d/yyyy");
};

const displayDateRange = ({ start, end } = {}) =>
  `${displayDateInputValue(start)} - ${displayDateInputValue(end)}`;

const displayDateRangeFromValues = (start, end) => {
  const normalizeDisplayDate = (value) => {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const startDate = normalizeDisplayDate(start);
  const endDate = normalizeDisplayDate(end);
  if (!startDate || !endDate) return "";
  return `${format(startDate, "M/d/yyyy")} - ${format(endDate, "M/d/yyyy")}`;
};

const dateRangePresets = [
  { value: "custom", label: "Custom", getRange: null },
  { value: "thisMonth", label: "This Month", getRange: () => dateRangeFromDates(startOfMonth(new Date()), endOfMonth(new Date())) },
  {
    value: "lastMonth",
    label: "Last Month",
    getRange: () => {
      const previousMonth = subMonths(new Date(), 1);
      return dateRangeFromDates(startOfMonth(previousMonth), endOfMonth(previousMonth));
    },
  },
  { value: "last7Days", label: "Last 7 Days", getRange: () => dateRangeFromDates(subDays(new Date(), 6), new Date()) },
  { value: "last30Days", label: "Last 30 Days", getRange: () => dateRangeFromDates(subDays(new Date(), 29), new Date()) },
  { value: "thisWeek", label: "This Week", getRange: () => dateRangeFromDates(startOfWeek(new Date()), endOfWeek(new Date())) },
  {
    value: "lastWeek",
    label: "Last Week",
    getRange: () => {
      const previousWeek = subDays(new Date(), 7);
      return dateRangeFromDates(startOfWeek(previousWeek), endOfWeek(previousWeek));
    },
  },
];

const defaultDateRange = () =>
  dateRangePresets.find((preset) => preset.value === "thisMonth").getRange();

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

const readingPerformanceStandardKey = (standard = {}, index = 0) =>
  [
    standard.templateId || "reading",
    standard.operator || "gt",
    String(standard.threshold ?? "value").replace(/[^a-zA-Z0-9.-]+/g, "-"),
    index,
  ].join("-");

const withReadingPerformanceStandardId = (standard, index = 0) => ({
  ...standard,
  id: standard.id || readingPerformanceStandardKey(standard, index),
});

const defaultReadingPerformanceStandardsFor = (templates = []) => {
  const template = templates.find((item) => readingTemplateKey(item));
  return template ? [withReadingPerformanceStandardId(defaultReadingHealthFilterFor(template))] : [];
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

const percentString = (numerator, denominator) => {
  if (!denominator) return "0.0%";
  return `${((Number(numerator || 0) / denominator) * 100).toFixed(1)}%`;
};

const percentageMetric = (label, numerator, denominator, subtitle) => ({
  label,
  value: percentString(numerator, denominator),
  subtitle: subtitle || `${Number(numerator || 0).toLocaleString()} of ${Number(denominator || 0).toLocaleString()}`,
});

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

const activeReadingPerformanceStandards = (standards = [], readingTemplates = []) => {
  const templatesByKey = new Map(readingTemplates.map((template) => [readingTemplateKey(template), template]));

  return standards
    .map((standard, index) => {
      const templateId = String(standard.templateId || "");
      const template = templatesByKey.get(templateId);
      const threshold = parseReadingNumber(standard.threshold);
      if (!template || !Number.isFinite(threshold)) return null;

      const readingName = template.name || template.chemType || "Reading";
      const unit = template.UOM || template.uom || "";
      const thresholdText = String(standard.threshold ?? "").trim();
      const thresholdLabel = [thresholdText, unit].filter(Boolean).join(" ");
      const operator = standard.operator || "gt";

      return {
        id: standard.id || readingPerformanceStandardKey(standard, index),
        template,
        templateId,
        readingName,
        unit,
        operator,
        threshold,
        thresholdLabel,
        rule: `${readingName} ${readingOperatorLabel(operator)} ${thresholdLabel}`.trim(),
      };
    })
    .filter(Boolean);
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
      id: item.userId || item.techId || item.technicianId || item.adminId || item.workerId || "unassigned",
      name: item.userName || item.techName || item.technicianName || item.tech || item.adminName || item.workerName || "Unassigned",
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

const workerDisplayName = (record = {}, fallback = "-") =>
  record.userName ||
  record.techName ||
  record.technicianName ||
  record.tech ||
  record.workerName ||
  record.companyUserName ||
  record.adminName ||
  record.workerId ||
  record.techId ||
  record.technicianId ||
  record.userId ||
  fallback;

const serviceWorkerDisplayName = (stop = {}, serviceStop = {}, fallback = "-") =>
  workerDisplayName(stop, workerDisplayName(serviceStop, fallback));

const assignedRssWorkerName = (recurringStop = {}, serviceStop = {}, fallback = "") => {
  const assignedName = workerDisplayName(recurringStop, "");
  if (assignedName) return assignedName;
  if (recurringStop.techId || recurringStop.userId || recurringStop.technicianId) {
    return recurringStop.techId || recurringStop.userId || recurringStop.technicianId;
  }
  return fallback;
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

const normalizeIdList = (...values) =>
  Array.from(new Set(
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    })
  ));

const purchaseDatabaseItem = (item, databaseItemById) =>
  databaseItemById.get(item.itemId) ||
  databaseItemById.get(item.dataBaseItemId) ||
  databaseItemById.get(item.databaseItemId) ||
  databaseItemById.get(item.templateId) ||
  null;

const purchaseDatabaseItemId = (item) =>
  item.itemId || item.dataBaseItemId || item.databaseItemId || item.templateId || "";

const dosageTemplateFor = (dosage, dosageTemplatesById) =>
  dosageTemplatesById.get(dosage.templateId) ||
  dosageTemplatesById.get(dosage.universalTemplateId) ||
  dosageTemplatesById.get(dosage.dosageTemplateId) ||
  null;

const dosageLinkedItemIds = (dosage = {}, template = {}) =>
  normalizeIdList(
    template?.linkedItemIds,
    template?.linkedItemId,
    template?.linkedItem,
    template?.itemId,
    dosage.linkedItemIds,
    dosage.linkedItemId,
    dosage.linkedItem,
    dosage.itemId
  );

const normalizeUnit = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || /^\d+(\.\d+)?$/.test(raw)) return "";
  if (/fl\s*oz|fluid\s*ounce/.test(raw)) return "floz";
  if (/gal|gallon/.test(raw)) return "gal";
  if (/\blbs?\b|pound/.test(raw)) return "lb";
  if (/quart|\bqt\b/.test(raw)) return "qt";
  if (/liter|litre|\bl\b/.test(raw)) return "l";
  if (/ounce|\boz\b/.test(raw)) return "oz";
  if (/tab|tablet/.test(raw)) return "tab";
  if (/each|\bea\b|unit/.test(raw)) return "unit";
  return raw.replace(/[^a-z0-9]+/g, "");
};

const unitLabels = {
  floz: "fl oz",
  gal: "gal",
  lb: "lb",
  l: "L",
  oz: "oz",
  qt: "qt",
  tab: "tab",
  unit: "unit",
};

const unitLabel = (unit) => unitLabels[normalizeUnit(unit)] || unit || "";

const parseFirstNumber = (value) => {
  const match = String(value || "").replaceAll(",", "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const volumeToGallons = {
  floz: 1 / 128,
  gal: 1,
  l: 0.264172,
  oz: 1 / 128,
  qt: 0.25,
};

const weightToPounds = {
  lb: 1,
  oz: 1 / 16,
};

const resolveUnitFamily = (fromUnit, toUnit) => {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to || from === to) return null;

  const volumeUnits = new Set(Object.keys(volumeToGallons));
  const weightUnits = new Set(Object.keys(weightToPounds));
  const nonOunceVolumeUnits = new Set(["floz", "gal", "l", "qt"]);
  const nonOunceWeightUnits = new Set(["lb"]);

  if (from === "oz" && nonOunceVolumeUnits.has(to)) return "volume";
  if (to === "oz" && nonOunceVolumeUnits.has(from)) return "volume";
  if (from === "oz" && nonOunceWeightUnits.has(to)) return "weight";
  if (to === "oz" && nonOunceWeightUnits.has(from)) return "weight";
  if (volumeUnits.has(from) && volumeUnits.has(to)) return "volume";
  if (weightUnits.has(from) && weightUnits.has(to)) return "weight";
  return null;
};

const convertAmount = (amount, fromUnit, toUnit) => {
  const numericAmount = Number(amount);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!Number.isFinite(numericAmount)) return null;
  if (!from || !to || from === to) return numericAmount;

  const family = resolveUnitFamily(from, to);
  if (family === "volume") return (numericAmount * volumeToGallons[from]) / volumeToGallons[to];
  if (family === "weight") return (numericAmount * weightToPounds[from]) / weightToPounds[to];
  return null;
};

const formatQuantity = (amount, unit) => {
  if (!Number.isFinite(Number(amount))) return "-";
  const value = Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return [value, unitLabel(unit)].filter(Boolean).join(" ");
};

const databaseItemDisplayName = (item = {}) =>
  [
    item.name || item.id || "Database Item",
    item.size ? `Size ${item.size}` : "",
    item.UOM || item.uom || "",
    item.sku ? `SKU ${item.sku}` : "",
  ].filter(Boolean).join(" | ");

const purchaseQuantity = (purchase, databaseItemById) => {
  const databaseItem = purchaseDatabaseItem(purchase, databaseItemById) || {};
  const lineQuantity = toNumber(purchase.quantity ?? purchase.quantityString ?? 1) || 1;
  const sizeValue = databaseItem.size ?? purchase.size ?? purchase.packageSize ?? "";
  const parsedPackageSize = parseFirstNumber(sizeValue);
  const packageSize = parsedPackageSize && parsedPackageSize > 0 ? parsedPackageSize : 1;
  const unit =
    normalizeUnit(sizeValue) ||
    normalizeUnit(databaseItem.UOM || databaseItem.uom) ||
    normalizeUnit(purchase.UOM || purchase.uom) ||
    "unit";

  return {
    amount: lineQuantity * packageSize,
    lineQuantity,
    packageSize,
    unit,
  };
};

const jobRevenueCents = (job) => cents(job.revenueCents ?? job.invoiceTotalCents ?? job.totalCents ?? job.rate ?? job.amount ?? 0);
const jobLaborCostCents = (job) => cents(job.laborCostCents ?? job.laborCost ?? 0);
const payrollLineCents = (line) => cents(line.totalAmountCents ?? line.amountCents ?? line.payCents ?? 0);

const firstPresent = (...values) =>
  values.find((value) => value !== null && value !== undefined && value !== "");

const moneyNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const centsField = (...values) => Math.round(moneyNumber(firstPresent(...values)));
const dollarFieldToCents = (...values) => Math.round(moneyNumber(firstPresent(...values)) * 100);

const reportStatusKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isInactiveAgreementStatus = (status) =>
  ["canceled", "cancelled", "rejected", "expired", "void", "voided"].includes(reportStatusKey(status));

const pnlChemicalCostModes = {
  includeAll: "includeAll",
  excludeAll: "excludeAll",
  excludeSelected: "excludeSelected",
};

const activeRangeOverlapDays = (recordStart, recordEnd, rangeStart, rangeEnd) => {
  const start = dateFromValue(recordStart);
  const end = dateFromValue(recordEnd);
  const effectiveStart = start && start > rangeStart ? start : rangeStart;
  const effectiveEnd = end && end < rangeEnd ? end : rangeEnd;

  if (effectiveStart > rangeEnd || effectiveEnd < rangeStart) return 0;

  return Math.max(1, Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / 86400000));
};

const billingIntervalDays = (record = {}) => {
  const frequency = reportStatusKey(
    record.billingFrequency ||
      record.billingCadence ||
      record.invoiceFrequency ||
      record.rateType ||
      "monthly"
  );
  const count = Math.max(
    Number(record.billingFrequencyCount || record.billingCadenceCount || record.invoiceFrequencyCount || 1),
    1
  );

  if (frequency.includes("day")) return count;
  if (frequency.includes("week")) return 7 * count;
  if (frequency.includes("year") || frequency.includes("annual")) return 365.25 * count;
  return 30.4375 * count;
};

const agreementAmountCents = (agreement = {}) => {
  const directAmount = centsField(
    agreement.totalAmountCents,
    agreement.rateAmountCents,
    agreement.subtotalAmountCents,
    agreement.amountCents
  );
  if (directAmount) return directAmount;

  const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  return lineItems.reduce((total, item) => {
    const quantity = Number(item.quantity || 1) || 1;
    const lineTotal = centsField(item.totalAmountCents);
    if (lineTotal) return total + lineTotal;
    return total + Math.round(centsField(item.unitAmountCents) * quantity);
  }, 0);
};

const agreementRevenueCentsForRange = (agreement = {}, startDate, endDate) => {
  if (isInactiveAgreementStatus(agreement.status)) return 0;
  if (agreement.pnlIncludeInReports === false) return 0;
  const amountCents = agreementAmountCents(agreement);
  if (!amountCents) return 0;

  const agreementStart = firstPresent(agreement.startDate, agreement.acceptedAt, agreement.sentAt, agreement.createdAt);
  const agreementEnd = firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt);
  const overlapDays = activeRangeOverlapDays(agreementStart, agreementEnd, startDate, endDate);
  if (!overlapDays) return 0;

  return Math.round(amountCents * (overlapDays / billingIntervalDays(agreement)));
};

const agreementServiceLocationIds = (agreement = {}) => {
  const ids = normalizeIdList(agreement.serviceLocationIds);
  if (ids.length) return ids;

  const snapshots = Array.isArray(agreement.serviceLocationSnapshots) ? agreement.serviceLocationSnapshots : [];
  return normalizeIdList(...snapshots.map((snapshot) => snapshot.id || snapshot.serviceLocationId));
};

const truthyReportFlag = (value) => (
  value === true ||
  value === 1 ||
  ["true", "yes", "y", "1", "customer", "homeowner", "owner", "separate", "separatelybilled", "billseparately"]
    .includes(reportStatusKey(value))
);

const reportTermList = (...values) => (
  Array.from(new Set(
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      return String(value || "").split(/[\n,]/);
    })
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ))
);

const recordIdCandidates = (...records) => (
  reportTermList(...records.flatMap((record) => [
    record?.id,
    record?.itemId,
    record?.dataBaseItemId,
    record?.databaseItemId,
    record?.templateId,
    record?.universalTemplateId,
    record?.dosageTemplateId,
    record?.linkedItemId,
    record?.linkedItemIds,
    record?.catalogItemId,
    record?.sourceId,
  ])).map((value) => reportStatusKey(value))
);

const recordSearchText = (...records) => (
  records.flatMap((record) => [
    record?.name,
    record?.chemType,
    record?.dosageType,
    record?.description,
    record?.category,
    record?.itemCategory,
    record?.materialCategory,
    record?.sku,
    record?.UOM,
    record?.uom,
  ]).filter(Boolean).join(" ").toLowerCase()
);

const customerPurchasedCostRecord = (...records) => records.some((record) => [
  record?.customerPurchased,
  record?.customerSupplied,
  record?.ownerSupplied,
  record?.homeownerSupplied,
  record?.purchasedByCustomer,
  record?.paidByCustomer,
  record?.excludeFromPnl,
  record?.excludeFromPNL,
  record?.pnlExcluded,
].some(truthyReportFlag));

const likelyChemicalCostRecord = (...records) => {
  if (records.some((record) => record?.isChemicalCostRecord)) return true;
  const text = recordSearchText(...records);
  return /\b(chem|chlor|tab|tablet|trichlor|dichlor|shock|acid|alkalinity|soda|bicarb|salt|algaecide|phosphate|clarifier|enzyme)\b/.test(text);
};

const agreementChemicalCostMode = (agreement = {}) => {
  if (agreement.pnlExcludeAllChemicalCosts === true) return pnlChemicalCostModes.excludeAll;
  const mode = agreement.pnlChemicalCostMode || agreement.pnlChemicalCostTreatment || agreement.chemicalCostTreatment;
  if (Object.values(pnlChemicalCostModes).includes(mode)) return mode;
  const modeKey = reportStatusKey(mode);
  if (["excludeall", "excludeallchemicals", "separate", "separatelybilled", "billseparately"].includes(modeKey)) {
    return pnlChemicalCostModes.excludeAll;
  }
  if (["excludeselected", "selected", "specificchemicals"].includes(modeKey)) {
    return pnlChemicalCostModes.excludeSelected;
  }
  if (reportTermList(agreement.pnlExcludedChemicalIds, agreement.pnlExcludedChemicalKeywords).length) {
    return pnlChemicalCostModes.excludeSelected;
  }
  return pnlChemicalCostModes.includeAll;
};

const chemicalCostMatchesAgreementTerms = (agreement = {}, ...records) => {
  const terms = reportTermList(
    agreement.pnlExcludedChemicalIds,
    agreement.pnlExcludedChemicalKeywords,
    agreement.pnlExcludedChemicals
  );
  if (!terms.length) return false;

  const ids = recordIdCandidates(...records);
  const text = recordSearchText(...records);

  return terms.some((term) => {
    const normalizedTerm = reportStatusKey(term);
    if (!normalizedTerm) return false;
    if (ids.includes(normalizedTerm)) return true;
    return text.includes(String(term).trim().toLowerCase());
  });
};

const agreementAppliesToRecord = (agreement = {}, record = {}) => {
  const agreementCustomerId = String(agreement.customerId || "").trim();
  const recordCustomerId = String(record.customerId || record.customer || "").trim();
  if (agreementCustomerId && recordCustomerId && agreementCustomerId !== recordCustomerId) return false;

  const agreementLocationIds = agreementServiceLocationIds(agreement);
  const recordLocationIds = normalizeIdList(record.serviceLocationId, record.serviceLocationIds, record.locationId);
  if (agreementLocationIds.length && recordLocationIds.length && !recordLocationIds.some((id) => agreementLocationIds.includes(id))) {
    return false;
  }

  return Boolean(agreementCustomerId || agreementLocationIds.length);
};

const agreementActiveForDate = (agreement = {}, value) => {
  const date = dateFromValue(value);
  if (!date) return true;
  const agreementStart = firstPresent(agreement.startDate, agreement.acceptedAt, agreement.sentAt, agreement.createdAt);
  const agreementEnd = firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt);
  return activeRangeOverlapDays(agreementStart, agreementEnd, date, date) > 0;
};

const agreementForPnlCost = (agreements = [], record = {}, value) => {
  const date = dateFromValue(value) || itemDate(record, ["date", "createdAt", "dateCreated", "completedDate", "serviceDate"]);

  return agreements
    .filter((agreement) => (
      !isInactiveAgreementStatus(agreement.status) &&
      agreementAppliesToRecord(agreement, record) &&
      agreementActiveForDate(agreement, date)
    ))
    .sort((left, right) => {
      const leftLocationMatch = agreementServiceLocationIds(left).some((id) => normalizeIdList(record.serviceLocationId, record.serviceLocationIds, record.locationId).includes(id));
      const rightLocationMatch = agreementServiceLocationIds(right).some((id) => normalizeIdList(record.serviceLocationId, record.serviceLocationIds, record.locationId).includes(id));
      if (leftLocationMatch !== rightLocationMatch) return leftLocationMatch ? -1 : 1;
      return toNumber(right.agreementVersion || 1) - toNumber(left.agreementVersion || 1);
    })[0] || null;
};

const shouldExcludePnlChemicalCost = ({ agreement = null, record = {}, linkedRecord = {} } = {}) => {
  if (agreement) {
    const chemicalBilling = classifyAgreementChemicalBilling({ agreement, record, linkedRecord });
    if (chemicalBilling.treatment === ChemicalBillingTreatment.customerPurchased) {
      return agreement.pnlExcludeCustomerPurchasedChemicals !== false;
    }
  }

  if (customerPurchasedCostRecord(record, linkedRecord)) {
    return !agreement || agreement.pnlExcludeCustomerPurchasedChemicals !== false;
  }

  if (!agreement) return false;

  const mode = agreementChemicalCostMode(agreement);
  if (mode === pnlChemicalCostModes.excludeAll) return likelyChemicalCostRecord(record, linkedRecord);
  if (mode === pnlChemicalCostModes.excludeSelected) return chemicalCostMatchesAgreementTerms(agreement, record, linkedRecord);
  return false;
};

const invoiceRevenueStatusCounts = (invoice = {}) => (
  !["draft", "void", "canceled", "cancelled", "uncollectible"].includes(reportStatusKey(invoice.status))
);

const invoiceLineAmountCents = (item = {}) => {
  const total = centsField(item.totalAmountCents, item.amountCents, item.totalCents);
  if (total) return total;
  const quantity = Number(item.quantity || 1) || 1;
  return Math.round(centsField(item.unitAmountCents, item.rateAmountCents, item.priceCents) * quantity);
};

const explicitlySeparateChemicalInvoiceLine = (item = {}) => {
  const sourceKey = reportStatusKey(`${item.sourceType || ""} ${item.type || ""} ${item.metadata?.chemicalBillingTreatment || ""}`);
  return (
    ["chemical", "chemicals", "dosage", "chemicalusage", "separatelybilledchemical"].some((term) => sourceKey.includes(term)) ||
    truthyReportFlag(item.billSeparately || item.separatelyBilled || item.separateBilling || item.metadata?.billSeparately)
  );
};

const invoiceChemicalRevenueCentsForPnl = (invoice = {}, serviceAgreements = []) => {
  if (!invoiceRevenueStatusCounts(invoice)) return 0;

  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  if (!lineItems.length) return 0;

  const invoiceAgreement = serviceAgreements.find((agreement) => agreement.id && agreement.id === invoice.agreementId) ||
    agreementForPnlCost(
      serviceAgreements,
      invoice,
      itemDate(invoice, ["sentAt", "paidAt", "invoiceDate", "createdAt", "date"])
    );

  return lineItems.reduce((total, item) => {
    const explicitlySeparate = explicitlySeparateChemicalInvoiceLine(item);
    if (!likelyChemicalCostRecord(item) && !explicitlySeparate) return total;

    if (invoiceAgreement) {
      const billing = classifyAgreementChemicalBilling({ agreement: invoiceAgreement, record: item });
      if (billing.treatment === ChemicalBillingTreatment.customerPurchased) return total;
      if (!billing.billSeparately && !explicitlySeparate) return total;
      return total + invoiceLineAmountCents(item);
    }

    return explicitlySeparate
      ? total + invoiceLineAmountCents(item)
      : total;
  }, 0);
};

const addressLine = (record = {}) => {
  const address = record.address || record.billingAddress || {};
  return [
    address.streetAddress || record.streetAddress,
    address.address02 || record.address02,
    [address.city || record.city, address.state || record.state, address.zip || record.zip].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
};

const serviceLocationName = (location = {}) =>
  [
    location.nickName || location.name || location.label,
    addressLine(location),
  ].filter(Boolean).join(" | ") || location.id || "No Service Location";

const targetRateCentsFor = (costCents, margin = 0.45) => {
  const cost = Math.max(Number(costCents || 0), 0);
  if (!cost) return 0;
  return Math.ceil((cost / (1 - margin)) / 100) * 100;
};

const marginString = (netCents, revenueCents) => {
  const revenue = Number(revenueCents || 0);
  if (!revenue) return Number(netCents || 0) < 0 ? "No revenue" : "0.0%";
  return `${((Number(netCents || 0) / revenue) * 100).toFixed(1)}%`;
};

const normalizeDetailDate = (value) => {
  const date = dateFromValue(value);
  return {
    date: date ? shortDate(date) : "-",
    sortTime: date ? date.getTime() : 0,
  };
};

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
    .slice(0, 90) || "report";

const reportModeLabel = (mode) => (mode === "detail" ? "Detail" : "Summary");

const reportExportTitle = (reportData) =>
  [
    reportData?.title || "Report",
    reportData?.mode ? reportModeLabel(reportData.mode) : "",
  ].filter(Boolean).join(" - ");

const reportFileName = (reportData, extension) => {
  const fileParts = [
    safeFilePart(reportData?.title),
    reportData?.mode ? safeFilePart(reportModeLabel(reportData.mode)) : "",
    format(new Date(), "yyyy-MM-dd_HH-mm"),
  ].filter(Boolean);
  return `${fileParts.join("_")}.${extension}`;
};

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

const reportSummarySections = (reportData) =>
  Array.isArray(reportData?.summarySections) ? reportData.summarySections : [];

const reportSummaryRowsForExport = (section) =>
  (section.rows || []).map((row) => {
    const exportRow = {};
    (section.columns || []).forEach((column) => {
      exportRow[column.label] = displayColumnValue(column, row);
    });
    return exportRow;
  });

const reportSummarySheetRows = (reportData) => {
  const rows = [
    [reportExportTitle(reportData)],
    [],
    ["Metric", "Value", "Subtitle"],
    ...reportStatsForExport(reportData).map((stat) => [stat.Metric, stat.Value, stat.Subtitle]),
  ];

  reportSummarySections(reportData).forEach((section) => {
    rows.push([], [section.title || "Summary"]);
    rows.push((section.columns || []).map((column) => column.label));
    reportSummaryRowsForExport(section).forEach((row) => {
      rows.push((section.columns || []).map((column) => row[column.label] || ""));
    });
  });

  return rows;
};

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

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const printableReportHtml = (reportData) => {
  const exportTitle = reportExportTitle(reportData);
  const statsHtml = reportStatsForExport(reportData)
    .map((stat) => `
      <div class="stat">
        <span>${escapeHtml(stat.Metric)}</span>
        <strong>${escapeHtml(stat.Value)}</strong>
        ${stat.Subtitle ? `<small>${escapeHtml(stat.Subtitle)}</small>` : ""}
      </div>
    `)
    .join("");

  const summarySectionsHtml = reportSummarySections(reportData)
    .map((section) => `
      <section class="summary-section">
        <h2>${escapeHtml(section.title || "Summary")}</h2>
        <table>
          <thead>
            <tr>${(section.columns || []).map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${(section.rows || []).map((row) => `
              <tr>
                ${(section.columns || []).map((column) => `<td>${escapeHtml(displayColumnValue(column, row))}</td>`).join("")}
              </tr>
            `).join("") || `<tr><td colspan="${section.columns?.length || 1}">No summary rows.</td></tr>`}
          </tbody>
        </table>
      </section>
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
        <title>${escapeHtml(exportTitle)}</title>
        <style>
          body { color: #0f172a; font-family: Arial, sans-serif; margin: 28px; }
          h1 { font-size: 24px; margin: 0 0 4px; }
          .generated { color: #64748b; font-size: 12px; margin-bottom: 18px; }
          .stats { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); margin-bottom: 18px; }
          .stat { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
          .stat span { color: #64748b; display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .stat strong { display: block; font-size: 18px; margin-top: 4px; }
          .stat small { color: #64748b; display: block; margin-top: 2px; }
          .summary-section { margin-bottom: 20px; }
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
        <h1>${escapeHtml(exportTitle)}</h1>
        <div class="generated">Generated ${escapeHtml(format(new Date(), "MM/dd/yyyy h:mm a"))}</div>
        <div class="stats">${statsHtml}</div>
        ${summarySectionsHtml}
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

const buildReadingPerformanceReport = ({
  stopData,
  readingTemplates,
  bodiesOfWater,
  customersById = new Map(),
  serviceStops = [],
  recurringServiceStops = [],
  readingPerformanceStandards,
  readingPerformanceView = "users",
  dateRangeStart,
  dateRangeEnd,
  mode,
}) => {
  const standards = activeReadingPerformanceStandards(readingPerformanceStandards, readingTemplates);
  const bodiesById = new Map((bodiesOfWater || []).map((body) => [body.id, body]));
  const performanceView = readingPerformanceView === "customers" ? "customers" : "users";
  const serviceStopsById = new Map();
  const recurringStopsById = new Map();

  const indexRecord = (map, record, fields) => {
    fields.forEach((field) => {
      const value = record?.[field];
      if (value) map.set(String(value), record);
    });
  };

  serviceStops.forEach((serviceStop) => {
    indexRecord(serviceStopsById, serviceStop, ["id", "serviceStopId", "internalId"]);
  });
  recurringServiceStops.forEach((recurringStop) => {
    indexRecord(recurringStopsById, recurringStop, ["id", "recurringServiceStopId", "rssId", "internalId"]);
  });

  const serviceStopForStopData = (stop) => (
    serviceStopsById.get(String(stop.serviceStopId || "")) ||
    serviceStopsById.get(String(stop.id || "")) ||
    {}
  );
  const recurringStopFor = (stop, serviceStop) => (
    recurringStopsById.get(String(stop.recurringServiceStopId || "")) ||
    recurringStopsById.get(String(serviceStop.recurringServiceStopId || "")) ||
    recurringStopsById.get(String(stop.rssId || "")) ||
    recurringStopsById.get(String(serviceStop.rssId || "")) ||
    {}
  );
  const customerGroupForStop = (stop, serviceStop) => {
    const bodyOfWaterId = stop.bodyOfWaterId || serviceStop.bodyOfWaterId || "";
    const bodyOfWater = bodiesById.get(bodyOfWaterId) || {};
    const customerId = stop.customerId || serviceStop.customerId || bodyOfWater.customerId || stop.internalCustomerId || "no-customer";
    const customer = customerId ? customersById.get(customerId) : null;
    return {
      id: customerId,
      name:
        customerDisplayName(customer) ||
        stop.customerName ||
        serviceStop.customerName ||
        bodyOfWater.customerName ||
        customerId ||
        "No Customer",
    };
  };
  const groupForStop = (stop, serviceStop) =>
    performanceView === "customers"
      ? customerGroupForStop(stop, serviceStop)
      : groupKey({ ...serviceStop, ...stop }, "user");
  const groups = new Map();
  const overallFailingStopIds = new Set();
  const overallStandardSummaries = new Map(
    standards.map((standard) => [
      standard.id,
      {
        id: standard.id,
        standard: standard.rule,
        failingStops: 0,
        failingReadings: 0,
        latestSortTime: -1,
        latestFail: "-",
        lastCustomer: "-",
        lastValue: "-",
      },
    ])
  );
  let totalFailingReadings = 0;

  const makeStandardSummaries = () =>
    new Map(
      standards.map((standard) => [
        standard.id,
        {
          id: standard.id,
          standard: standard.rule,
          failingStops: 0,
          failingReadings: 0,
          latestSortTime: -1,
          latestFail: "-",
          lastCustomer: "-",
          lastValue: "-",
        },
      ])
    );

  const updateLatest = (summary, row) => {
    if (!summary || row.sortTime < summary.latestSortTime) return;
    summary.latestSortTime = row.sortTime;
    summary.latestFail = row.date;
    summary.lastCustomer = row.customer;
    summary.lastValue = row.value;
  };

  const buildFailureRow = (stop, serviceStop, recurringStop, reading, standard, readingValue, stopIndex, failureIndex) => {
    const bodyOfWaterId = reading.bodyOfWaterId || stop.bodyOfWaterId || serviceStop.bodyOfWaterId || "unknown";
    const bodyOfWater = bodiesById.get(bodyOfWaterId) || {};
    const customerId = stop.customerId || reading.customerId || serviceStop.customerId || bodyOfWater.customerId || stop.internalCustomerId || "";
    const customer = customerId ? customersById.get(customerId) : null;
    const readingDate = dateFromValue(stop.date);
    const poolName =
      bodyOfWater.name ||
      bodyOfWater.nickName ||
      stop.bodyOfWaterName ||
      serviceStop.bodyOfWaterName ||
      stop.poolName ||
      "Unknown Pool";
    const customerName =
      customerDisplayName(customer) ||
      bodyOfWater.customerName ||
      stop.customerName ||
      serviceStop.customerName ||
      customerId ||
      "-";
    const servicedBy = serviceWorkerDisplayName(stop, serviceStop, "");
    const workerName = servicedBy || "-";
    const assignedRssTech = assignedRssWorkerName(recurringStop, serviceStop, servicedBy);
    const value = [
      readingValue.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      reading.UOM || reading.uom || standard.unit,
    ].filter(Boolean).join(" ");

    return {
      id: `${stop.id || stop.serviceStopId || `stop-${stopIndex}`}-${standard.id}-${reading.id || failureIndex}`,
      sortTime: readingDate ? readingDate.getTime() : 0,
      date: shortDate(stop.date),
      customer: customerName,
      pool: poolName,
      worker: workerName,
      standard: standard.rule,
      reading: reading.name || standard.readingName,
      value,
      rule: `${readingOperatorLabel(standard.operator)} ${standard.thresholdLabel}`,
      serviceStop: stop.serviceStopId || stop.id || "-",
      assignedRssTech: assignedRssTech || workerName,
      status: "Failing to meet standards",
    };
  };

  stopData.forEach((stop, stopIndex) => {
    const stopKey = String(stop.id || stop.serviceStopId || `stop-${stopIndex}`);
    const serviceStop = serviceStopForStopData(stop);
    const recurringStop = recurringStopFor(stop, serviceStop);
    const servicedBy = serviceWorkerDisplayName(stop, serviceStop, "");
    const assignedRssTech = assignedRssWorkerName(recurringStop, serviceStop, servicedBy);
    const group = ensureGroup(groups, groupForStop(stop, serviceStop));
    if (!group.performance) {
      group.performance = {
        totalStops: 0,
        failingStopIds: new Set(),
        totalFailingReadings: 0,
        assignedRssTechs: new Set(),
        standards: makeStandardSummaries(),
        detailRows: [],
      };
    }

    group.performance.totalStops += 1;
    if (assignedRssTech) group.performance.assignedRssTechs.add(assignedRssTech);
    const readings = Array.isArray(stop.readings) ? stop.readings : [];
    const failedStandardsForStop = new Set();

    standards.forEach((standard) => {
      const failures = readings
        .filter((reading) => readingMatchesTemplate(reading, standard.template))
        .map((reading) => ({ reading, value: parseReadingNumber(reading.amount) }))
        .filter(({ value }) => compareReadingValue(value, standard.operator, standard.threshold));

      if (!failures.length) return;

      failedStandardsForStop.add(standard.id);
      const groupSummary = group.performance.standards.get(standard.id);
      const overallSummary = overallStandardSummaries.get(standard.id);

      groupSummary.failingStops += 1;
      groupSummary.failingReadings += failures.length;
      overallSummary.failingStops += 1;
      overallSummary.failingReadings += failures.length;
      group.performance.totalFailingReadings += failures.length;
      totalFailingReadings += failures.length;

      failures.forEach(({ reading, value }, failureIndex) => {
        const row = buildFailureRow(stop, serviceStop, recurringStop, reading, standard, value, stopIndex, failureIndex);
        group.performance.detailRows.push(row);
        updateLatest(groupSummary, row);
        updateLatest(overallSummary, row);
      });
    });

    if (failedStandardsForStop.size) {
      group.performance.failingStopIds.add(stopKey);
      overallFailingStopIds.add(stopKey);
    }
  });

  const totalCompanyFailingStops = overallFailingStopIds.size;

  const resultGroups = [...groups.values()]
    .map((group) => {
      const performance = group.performance || {
        totalStops: 0,
        failingStopIds: new Set(),
        totalFailingReadings: 0,
        assignedRssTechs: new Set(),
        standards: makeStandardSummaries(),
        detailRows: [],
      };
      const failingStops = performance.failingStopIds.size;
      const successfulStops = Math.max(performance.totalStops - failingStops, 0);
      const failRate = percentString(failingStops, performance.totalStops);
      const successRate = percentString(successfulStops, performance.totalStops);
      const latestDetail = [...performance.detailRows].sort((a, b) => b.sortTime - a.sortTime)[0];
      const assignedRssTechs = [...performance.assignedRssTechs].sort().join(", ") || "-";
      const anyStandardRow = {
        id: `${group.id}-any-standard`,
        standard: "Any standard",
        successfulStops,
        successRate,
        failingStops,
        failingRate: failRate,
        failingReadings: performance.totalFailingReadings,
        latestFail: latestDetail?.date || "-",
        lastCustomer: latestDetail?.customer || "-",
        assignedRssTechs,
        lastValue: "-",
      };
      const standardRows = standards.map((standard) => {
        const summary = performance.standards.get(standard.id);
        const standardFailingStops = summary?.failingStops || 0;
        const standardSuccessfulStops = Math.max(performance.totalStops - standardFailingStops, 0);
        return {
          id: `${group.id}-${standard.id}`,
          standard: standard.rule,
          successfulStops: standardSuccessfulStops,
          successRate: percentString(standardSuccessfulStops, performance.totalStops),
          failingStops: standardFailingStops,
          failingRate: percentString(standardFailingStops, performance.totalStops),
          failingReadings: summary?.failingReadings || 0,
          latestFail: summary?.latestFail || "-",
          lastCustomer: summary?.lastCustomer || "-",
          assignedRssTechs,
          lastValue: summary?.lastValue || "-",
        };
      });
      const detailRows = [...performance.detailRows]
        .sort((a, b) => b.sortTime - a.sortTime)
        .map(({ sortTime, ...row }) => row);

      return {
        id: group.id,
        name: group.name,
        sortFailRate: performance.totalStops ? failingStops / performance.totalStops : 0,
        sortFailingStops: failingStops,
        sortSuccessRate: performance.totalStops ? successfulStops / performance.totalStops : 0,
        sortSuccessfulStops: successfulStops,
        summary: {
          id: group.id,
          user: group.name,
          customer: group.name,
          serviceStops: performance.totalStops,
          successfulStops,
          failingStops,
          userSuccessRate: successRate,
          customerSuccessRate: successRate,
          userFailingRate: failRate,
          customerFailingRate: failRate,
          companyFailingShare: percentString(failingStops, totalCompanyFailingStops),
          failingReadings: performance.totalFailingReadings,
          assignedRssTechs,
          latestFail: latestDetail?.date || "-",
        },
        metrics: {
          "Service Stops": performance.totalStops,
          "Successful Stops": `${successfulStops.toLocaleString()} (${successRate})`,
          "Not Good Standing": `${failingStops.toLocaleString()} (${failRate})`,
          "Company Failing Share": percentString(failingStops, totalCompanyFailingStops),
          ...(performanceView === "customers" ? { "Assigned RSS Techs": assignedRssTechs } : {}),
          "Failing Readings": performance.totalFailingReadings,
        },
        rows: mode === "summary" ? [anyStandardRow, ...standardRows] : detailRows,
      };
    })
    .sort((a, b) => (
      performanceView === "users"
        ? b.sortSuccessRate - a.sortSuccessRate || b.sortSuccessfulStops - a.sortSuccessfulStops || a.name.localeCompare(b.name)
        : b.sortFailRate - a.sortFailRate || b.sortFailingStops - a.sortFailingStops || a.name.localeCompare(b.name)
    ))
    .map(({ sortFailRate, sortFailingStops, sortSuccessRate, sortSuccessfulStops, ...group }) => group);

  const worstStandard = [...overallStandardSummaries.values()]
    .sort((a, b) => b.failingStops - a.failingStops || a.standard.localeCompare(b.standard))[0];
  const userSummaryRows = resultGroups.map((group) => group.summary);
  const failedGroupCount = resultGroups.filter((group) => (group.summary?.failingStops || 0) > 0).length;
  const totalServicedGroupCount = resultGroups.length;
  const standardSummaryRows = [...overallStandardSummaries.values()]
    .sort((a, b) => b.failingStops - a.failingStops || a.standard.localeCompare(b.standard))
    .map((summary) => ({
      id: summary.id,
      standard: summary.standard,
      successfulStops: Math.max(stopData.length - summary.failingStops, 0),
      companySuccessRate: percentString(Math.max(stopData.length - summary.failingStops, 0), stopData.length),
      failingStops: summary.failingStops,
      companyFailingRate: percentString(summary.failingStops, stopData.length),
      failingReadings: summary.failingReadings,
      latestFail: summary.latestFail || "-",
      lastCustomer: summary.lastCustomer || "-",
      lastValue: summary.lastValue || "-",
    }));
  const summaryEntityKey = performanceView === "customers" ? "customer" : "user";
  const summaryEntityLabel = performanceView === "customers" ? "Customer" : "User";
  const summaryFailingRateKey = performanceView === "customers" ? "customerFailingRate" : "userFailingRate";
  const summarySuccessRateKey = performanceView === "customers" ? "customerSuccessRate" : "userSuccessRate";
  const summaryColumns = performanceView === "users"
    ? [
        { key: summaryEntityKey, label: summaryEntityLabel },
        { key: "serviceStops", label: "Service Stops", align: "right" },
        { key: "successfulStops", label: "Successful Stops", align: "right" },
        { key: summarySuccessRateKey, label: "Success Rate", align: "right" },
        { key: "failingStops", label: "Failing Stops", align: "right" },
        { key: summaryFailingRateKey, label: "Fail Rate", align: "right" },
        { key: "failingReadings", label: "Failing Readings", align: "right" },
        { key: "latestFail", label: "Latest Fail" },
      ]
    : [
        { key: summaryEntityKey, label: summaryEntityLabel },
        { key: "serviceStops", label: "Service Stops", align: "right" },
        { key: "failingStops", label: "Failing Stops", align: "right" },
        { key: summaryFailingRateKey, label: `% of ${summaryEntityLabel} Stops`, align: "right" },
        { key: "companyFailingShare", label: "% of Company Fails", align: "right" },
        { key: "failingReadings", label: "Failing Readings", align: "right" },
        { key: "assignedRssTechs", label: "Assigned RSS Techs" },
        { key: "latestFail", label: "Latest Fail" },
      ];
  const baseTitle = performanceView === "customers" ? "Reading Performance by Customer Report" : "Reading Performance Report";
  const titleDateRange = displayDateRangeFromValues(dateRangeStart, dateRangeEnd);
  const totalSuccessfulStops = Math.max(stopData.length - overallFailingStopIds.size, 0);

  return {
    title: [baseTitle, titleDateRange].filter(Boolean).join(" "),
    stats: [
      numberMetric("Service Stops", stopData.length),
      ...(performanceView === "customers"
        ? [{
            label: "Failed Customers",
            value: `${failedGroupCount.toLocaleString()} of ${totalServicedGroupCount.toLocaleString()}`,
            subtitle: `${percentString(failedGroupCount, totalServicedGroupCount)} of serviced customers`,
          }]
        : []),
      numberMetric("Successful Stops", totalSuccessfulStops),
      {
        label: "Success Rate",
        value: percentString(totalSuccessfulStops, stopData.length),
        subtitle: "100% - fail rate",
      },
      numberMetric("Not Good Standing", overallFailingStopIds.size),
      percentageMetric("Not Good Standing %", overallFailingStopIds.size, stopData.length),
      numberMetric("Failing Readings", totalFailingReadings),
      {
        label: "Standards",
        value: standards.length.toLocaleString(),
        subtitle: worstStandard && worstStandard.failingStops > 0
          ? `Highest: ${worstStandard.standard} (${percentString(worstStandard.failingStops, stopData.length)})`
          : "No failing standards found",
      },
    ],
    columns: mode === "summary"
      ? [
          { key: "standard", label: "Standard" },
          ...(performanceView === "users"
            ? [
                { key: "successfulStops", label: "Successful Stops", align: "right" },
                { key: "successRate", label: "Success Rate", align: "right" },
              ]
            : []),
          { key: "failingStops", label: "Failing Stops", align: "right" },
          { key: "failingRate", label: "Fail Rate", align: "right" },
          { key: "failingReadings", label: "Failing Readings", align: "right" },
          ...(performanceView === "customers" ? [{ key: "assignedRssTechs", label: "Assigned RSS Techs" }] : []),
          { key: "latestFail", label: "Latest Fail" },
          { key: "lastCustomer", label: "Last Customer" },
          { key: "lastValue", label: "Last Value", align: "right" },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "pool", label: "Pool" },
          { key: "worker", label: "Technician" },
          ...(performanceView === "customers" ? [{ key: "assignedRssTech", label: "RSS Tech" }] : []),
          { key: "standard", label: "Standard" },
          { key: "value", label: "Value", align: "right" },
          { key: "rule", label: "Rule" },
          { key: "serviceStop", label: "Service Stop" },
          { key: "status", label: "Status" },
        ],
    summarySections: [
      {
        title: `${summaryEntityLabel} Summary`,
        columns: summaryColumns,
        rows: userSummaryRows,
      },
      {
        title: "Standard Summary",
        columns: [
          { key: "standard", label: "Standard" },
          { key: "successfulStops", label: "Successful Stops", align: "right" },
          { key: "companySuccessRate", label: "Success Rate", align: "right" },
          { key: "failingStops", label: "Failing Stops", align: "right" },
          { key: "companyFailingRate", label: "Fail Rate", align: "right" },
          { key: "failingReadings", label: "Failing Readings", align: "right" },
          { key: "latestFail", label: "Latest Fail" },
          { key: "lastCustomer", label: "Last Customer" },
          { key: "lastValue", label: "Last Value", align: "right" },
        ],
        rows: standardSummaryRows,
      },
    ],
    groups: resultGroups.map(({ summary, ...group }) => group),
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

const buildWasteReport = ({ stopData, purchases, dosageTemplates, databaseItemById, mode, groupBy }) => {
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const groups = new Map();
  const comparisonEntriesByItemId = new Map();
  const snapshotEntriesByItemId = new Map();
  let dosageLineCount = 0;
  let linkedPurchaseLineCount = 0;
  let linkedPurchaseSpendCents = 0;
  let unmappedDosageCount = 0;
  let unitWarningCount = 0;

  const addComparisonEntry = (entriesByItemId, itemIds, entry) => {
    itemIds.forEach((itemId) => {
      if (!entriesByItemId.has(itemId)) entriesByItemId.set(itemId, []);
      const entries = entriesByItemId.get(itemId);
      if (!entries.some((current) => current.rowKey === entry.rowKey)) {
        entries.push(entry);
      }
    });
  };

  dosageTemplates.forEach((template) => {
    const linkedItemIds = dosageLinkedItemIds({}, template);
    if (!linkedItemIds.length) return;

    addComparisonEntry(comparisonEntriesByItemId, linkedItemIds, {
      rowKey: template.id,
      name: template.name || template.chemType || "Dosage",
      unit: normalizeUnit(template.UOM || template.uom),
      linkedItemIds,
    });
  });

  const ensureWasteData = (group) => {
    if (!group.wasteRows) group.wasteRows = new Map();
    if (!group.wasteDetailRows) group.wasteDetailRows = [];
    if (!group.wasteMetrics) {
      group.wasteMetrics = {
        dosageLines: 0,
        purchaseLines: 0,
        purchaseSpendCents: 0,
        unmappedDosages: 0,
        unitWarnings: 0,
      };
    }
    return group;
  };

  const ensureWasteRow = (group, entry, status = "") => {
    ensureWasteData(group);
    if (!group.wasteRows.has(entry.rowKey)) {
      group.wasteRows.set(entry.rowKey, {
        id: entry.rowKey,
        name: entry.name,
        unit: normalizeUnit(entry.unit),
        linkedItemIds: new Set(),
        linkedItemNames: new Set(),
        uses: 0,
        usedAmount: 0,
        purchaseLines: 0,
        purchasedAmount: 0,
        purchaseSpendCents: 0,
        unitWarnings: new Set(),
        forcedStatus: status,
      });
    }

    const row = group.wasteRows.get(entry.rowKey);
    row.name = row.name || entry.name;
    if (!row.unit && entry.unit) row.unit = normalizeUnit(entry.unit);
    if (status && !row.forcedStatus) row.forcedStatus = status;
    (entry.linkedItemIds || []).forEach((itemId) => {
      row.linkedItemIds.add(itemId);
      const databaseItem = databaseItemById.get(itemId);
      row.linkedItemNames.add(databaseItem ? databaseItemDisplayName(databaseItem) : itemId);
    });
    return row;
  };

  const addAmountToRow = (row, field, amount, fromUnit) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return false;

    const normalizedFromUnit = normalizeUnit(fromUnit);
    if (!row.unit && normalizedFromUnit) row.unit = normalizedFromUnit;
    const convertedAmount = convertAmount(numericAmount, normalizedFromUnit, row.unit);

    if (convertedAmount === null) {
      const warning = `${unitLabel(normalizedFromUnit) || "no unit"} to ${unitLabel(row.unit) || "no unit"}`;
      row.unitWarnings.add(warning);
      unitWarningCount += 1;
      return false;
    }

    row[field] += convertedAmount;
    return true;
  };

  const serializeWasteRow = (row) => {
    const difference = row.purchasedAmount - row.usedAmount;
    const purchasedVsUsedPercent = row.usedAmount > 0 ? percentString(row.purchasedAmount, row.usedAmount) : "N/A";
    const statusParts = [];
    if (row.forcedStatus) statusParts.push(row.forcedStatus);
    if (!row.linkedItemIds.size) statusParts.push("No purchase item link");
    if (row.usedAmount > 0 && row.purchasedAmount === 0) statusParts.push("No purchases");
    if (row.purchasedAmount > 0 && row.usedAmount === 0) statusParts.push("No usage");
    if (row.unitWarnings.size) statusParts.push("Unit review");
    if (!statusParts.length) statusParts.push(difference >= 0 ? "Matched" : "Over used");

    return {
      id: row.id,
      name: row.name,
      linkedItems: row.linkedItemNames.size ? [...row.linkedItemNames].join(", ") : "Not linked",
      usedAmount: row.usedAmount,
      usedDisplay: formatQuantity(row.usedAmount, row.unit),
      purchasedAmount: row.purchasedAmount,
      purchasedDisplay: formatQuantity(row.purchasedAmount, row.unit),
      purchasedVsUsedPercent,
      difference,
      differenceDisplay: formatQuantity(difference, row.unit),
      purchaseSpendCents: row.purchaseSpendCents,
      status: statusParts.join(" | "),
    };
  };

  stopData.forEach((stop, stopIndex) => {
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    const group = ensureWasteData(ensureGroup(groups, groupKey(stop, groupBy)));

    dosages.forEach((dosage, dosageIndex) => {
      const template = dosageTemplateFor(dosage, dosageTemplatesById);
      const linkedItemIds = dosageLinkedItemIds(dosage, template);
      const rowKey = template?.id || dosage.templateId || dosage.universalTemplateId || dosage.name || `dosage-${stopIndex}-${dosageIndex}`;
      const entry = {
        rowKey,
        name: templateName(dosage, dosageTemplatesById, "Dosage"),
        unit: normalizeUnit(dosage.UOM || dosage.uom || template?.UOM || template?.uom),
        linkedItemIds,
      };
      const row = ensureWasteRow(group, entry);
      const dosageAmount = toNumber(dosage.amount);

      dosageLineCount += 1;
      group.wasteMetrics.dosageLines += 1;
      row.uses += 1;
      addAmountToRow(row, "usedAmount", dosageAmount, entry.unit);

      if (!linkedItemIds.length) {
        unmappedDosageCount += 1;
        group.wasteMetrics.unmappedDosages += 1;
      } else {
        addComparisonEntry(snapshotEntriesByItemId, linkedItemIds, entry);
      }

      group.wasteDetailRows.push({
        id: `${stop.id || stop.serviceStopId || stopIndex}-${rowKey}-${dosageIndex}`,
        sortTime: dateFromValue(stop.date)?.getTime() || 0,
        date: shortDate(stop.date),
        type: "Dosage",
        name: entry.name,
        quantity: formatQuantity(dosageAmount, entry.unit),
        worker: stop.userName || stop.techName || stop.tech || stop.userId || "-",
        customer: stop.customerName || stop.customerId || "-",
        linkedItems: linkedItemIds.length
          ? linkedItemIds.map((itemId) => databaseItemDisplayName(databaseItemById.get(itemId) || { id: itemId })).join(", ")
          : "Not linked",
        purchaseSpendCents: 0,
        status: linkedItemIds.length ? "Usage" : "Needs purchase item link",
      });
    });
  });

  purchases.forEach((purchase, purchaseIndex) => {
    const databaseItem = purchaseDatabaseItem(purchase, databaseItemById);
    const purchaseItemId = purchaseDatabaseItemId(purchase);
    const templateEntries = [
      ...(comparisonEntriesByItemId.get(purchaseItemId) || []),
      ...(snapshotEntriesByItemId.get(purchaseItemId) || []),
    ];
    const uniqueEntries = [...new Map(templateEntries.map((entry) => [entry.rowKey, entry])).values()];
    const purchaseQuantityInfo = purchaseQuantity(purchase, databaseItemById);
    const spendCents = purchaseTotalCents(purchase);
    const purchaseDate = itemDate(purchase, ["date", "createdAt", "dateCreated"]);

    if (!uniqueEntries.length) {
      return;
    }

    linkedPurchaseLineCount += 1;
    linkedPurchaseSpendCents += spendCents;

    uniqueEntries.forEach((entry) => {
      const group = ensureWasteData(ensureGroup(groups, groupKey(purchase, groupBy)));
      const row = ensureWasteRow(group, entry);
      row.purchaseLines += 1;
      row.purchaseSpendCents += spendCents;
      addAmountToRow(row, "purchasedAmount", purchaseQuantityInfo.amount, purchaseQuantityInfo.unit);
      group.wasteMetrics.purchaseLines += 1;
      group.wasteMetrics.purchaseSpendCents += spendCents;

      group.wasteDetailRows.push({
        id: `${purchase.id || "purchase"}-${entry.rowKey}-${purchaseIndex}`,
        sortTime: purchaseDate?.getTime() || 0,
        date: shortDate(purchaseDate),
        type: "Purchase",
        name: entry.name,
        quantity: formatQuantity(purchaseQuantityInfo.amount, purchaseQuantityInfo.unit),
        worker: purchase.techName || purchase.userName || purchase.techId || "-",
        customer: purchase.customerName || purchase.customerId || "-",
        linkedItems: databaseItemDisplayName(databaseItem || { id: purchaseItemId }),
        purchaseSpendCents: spendCents,
        status: "Purchase",
      });
    });
  });

  const resultGroups = [...groups.values()]
    .map((group) => {
      const summaryRows = [...(group.wasteRows || new Map()).values()]
        .map(serializeWasteRow)
        .sort((a, b) => a.name.localeCompare(b.name));
      const detailRows = [...(group.wasteDetailRows || [])]
        .sort((a, b) => b.sortTime - a.sortTime)
        .map(({ sortTime, ...row }) => row);
      const groupUnitWarnings = [...(group.wasteRows || new Map()).values()]
        .reduce((total, row) => total + row.unitWarnings.size, 0);

      return {
        id: group.id,
        name: group.name,
        metrics: {
          "Dosage Lines": group.wasteMetrics?.dosageLines || 0,
          "Purchase Spend": moneyFromCents(group.wasteMetrics?.purchaseSpendCents || 0),
          "Unmapped Dosages": group.wasteMetrics?.unmappedDosages || 0,
          "Unit Warnings": groupUnitWarnings,
        },
        rows: mode === "detail" ? detailRows : summaryRows,
      };
    })
    .filter((group) => group.rows.length);

  return {
    title: "Waste Report",
    stats: [
      numberMetric("Dosage Lines", dosageLineCount),
      numberMetric("Linked Purchases", linkedPurchaseLineCount),
      moneyMetric("Linked Purchase Spend", linkedPurchaseSpendCents),
      numberMetric("Unmapped Dosages", unmappedDosageCount),
      numberMetric("Unit Warnings", unitWarningCount),
    ],
    columns: mode === "detail"
      ? [
          { key: "date", label: "Date" },
          { key: "type", label: "Type" },
          { key: "name", label: "Dosage" },
          { key: "quantity", label: "Quantity", align: "right" },
          { key: "worker", label: "User" },
          { key: "customer", label: "Customer" },
          { key: "linkedItems", label: "Linked Items" },
          { key: "purchaseSpendCents", label: "Spend", align: "right", render: (row) => row.purchaseSpendCents ? moneyFromCents(row.purchaseSpendCents) : "-" },
          { key: "status", label: "Status" },
        ]
      : [
          { key: "name", label: "Dosage" },
          { key: "linkedItems", label: "Linked Purchase Items" },
          { key: "usedDisplay", label: "Quantity Used", align: "right" },
          { key: "purchasedDisplay", label: "Purchased", align: "right" },
          { key: "purchasedVsUsedPercent", label: "Purchased / Used %", align: "right" },
          { key: "differenceDisplay", label: "Remaining / Waste", align: "right" },
          { key: "purchaseSpendCents", label: "Spend", align: "right", render: (row) => moneyFromCents(row.purchaseSpendCents) },
          { key: "status", label: "Status" },
        ],
    total: {
      label: "Linked Chemical Spend",
      value: moneyFromCents(linkedPurchaseSpendCents),
      subtitle: `${linkedPurchaseLineCount.toLocaleString()} linked purchase(s)`,
    },
    groups: resultGroups,
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

const buildPnlPerPoolReport = ({
  companyId = "",
  stopData = [],
  serviceStops = [],
  payrollLines = [],
  paySettings = null,
  companyUsers = [],
  companyServiceStopTypes = [],
  companyWorkTypes = [],
  workTypeMappings = [],
  technicianRates = [],
  serviceStopTasksById = new Map(),
  dosageTemplates = [],
  serviceAgreements = [],
  serviceLocations = [],
  bodiesOfWater = [],
  customersById = new Map(),
  mode,
  dateRangeStart,
  dateRangeEnd,
}) => {
  const serviceLocationsById = new Map(serviceLocations.map((location) => [location.id, location]));
  const bodiesById = new Map(bodiesOfWater.map((body) => [body.id, body]));
  const bodiesByLocationId = new Map();
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const serviceStopsById = new Map();
  const stopDataByServiceStopId = new Map();
  const pools = new Map();
  const actualPayServiceStopIds = new Set();
  const serviceStopTypesById = new Map();
  const serviceStopTypesByName = new Map();

  const idValue = (value) => String(value || "").trim();
  const keyValue = (value) => idValue(value).toLowerCase();

  companyServiceStopTypes.forEach((type) => {
    ["id", "typeId", "serviceStopTypeId"].forEach((field) => {
      const value = idValue(type?.[field]);
      if (value) serviceStopTypesById.set(value, type);
    });
    [type?.name, type?.serviceStopTypeName, type?.type].forEach((value) => {
      const key = keyValue(value);
      if (key && !serviceStopTypesByName.has(key)) serviceStopTypesByName.set(key, type);
    });
  });

  const companyUserForServiceStop = (serviceStop = {}) => {
    const workerId = idValue(firstPresent(
      serviceStop.techId,
      serviceStop.userId,
      serviceStop.technicianId,
      serviceStop.workerId,
      serviceStop.companyUserId,
      serviceStop.assignedUserId,
      serviceStop.assignedToId
    ));

    if (!workerId) return null;

    return (
      companyUsers.find((user) =>
        [user.userId, user.id, user.docId, user.uid, user.companyUserId].some((value) => idValue(value) === workerId)
      ) || {
        id: workerId,
        userId: workerId,
        userName: serviceStop.tech || serviceStop.techName || serviceStop.technicianName || serviceStop.userName || "Technician",
      }
    );
  };

  const serviceStopTypeFor = (serviceStop = {}) => {
    const typeId = idValue(firstPresent(
      serviceStop.typeId,
      serviceStop.serviceStopTypeId,
      serviceStop.companyServiceStopTypeId,
      typeof serviceStop.serviceStopType === "string" ? serviceStop.serviceStopType : ""
    ));
    const typeName = keyValue(firstPresent(
      serviceStop.type,
      serviceStop.serviceStopTypeName,
      typeof serviceStop.serviceStopType === "string" ? serviceStop.serviceStopType : ""
    ));

    if (typeId && serviceStopTypesById.has(typeId)) return serviceStopTypesById.get(typeId);
    if (typeName && serviceStopTypesByName.has(typeName)) return serviceStopTypesByName.get(typeName);

    if (!typeId && !typeName) return null;

    return {
      id: typeId || typeName,
      name: serviceStop.type || serviceStop.serviceStopTypeName || "Service Stop",
      defaultWorkTypeIds: serviceStop.defaultWorkTypeIds || serviceStop.serviceStopDefaultWorkTypeIds || [],
      category: serviceStop.category || serviceStop.serviceStopCategory || "",
      serviceStopTypeUseCaseRawValue: serviceStop.serviceStopTypeUseCaseRawValue || "",
    };
  };

  const tasksForServiceStop = (serviceStop = {}) => {
    const stopId = idValue(firstPresent(serviceStop.id, serviceStop.serviceStopId));
    const tasks = [
      ...(serviceStopTasksById instanceof Map ? serviceStopTasksById.get(stopId) || [] : serviceStopTasksById?.[stopId] || []),
      ...(Array.isArray(serviceStop.tasks) ? serviceStop.tasks : []),
    ];
    if (tasks.length) return tasks;

    const estimatedMinutes = Number(firstPresent(serviceStop.duration, serviceStop.estimatedDuration, serviceStop.estimatedMinutes));
    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return [];

    return [{
      id: `${stopId || "stop"}_duration_estimate`,
      name: "Duration estimate",
      type: "__report_duration_estimate__",
      estimatedTime: estimatedMinutes,
      contractedRate: 0,
    }];
  };

  const serviceStopUseCaseSourceId = (serviceStop = {}) => {
    if (serviceStop.jobId) return "system_job_service_stop";
    if (serviceStop.recurringServiceStopId || serviceStop.recurringStopId) return "system_recurring_service_stop";
    if (serviceStop.serviceAgreementId || serviceStop.agreementId) return "system_service_agreement_estimate_service_stop";
    return "";
  };

  const payrollEstimateLineLabel = (line = {}, serviceStop = {}) =>
    [
      line.title || line.workTypeName || serviceStop.type || serviceStop.serviceStopTypeName || "Service Stop Pay",
      line.workTypeName && line.title !== line.workTypeName ? line.workTypeName : "",
      "estimated from payroll rate",
    ].filter(Boolean).join(" | ");

  const addBodyForLocation = (body) => {
    const serviceLocationId = body.serviceLocationId || "";
    if (!serviceLocationId) return;
    if (!bodiesByLocationId.has(serviceLocationId)) bodiesByLocationId.set(serviceLocationId, []);
    bodiesByLocationId.get(serviceLocationId).push(body);
  };

  bodiesOfWater
    .filter((body) => body.active !== false && body.isActive !== false)
    .forEach(addBodyForLocation);

  const indexByIds = (map, record, fields) => {
    fields.forEach((field) => {
      const value = record?.[field];
      if (value) map.set(String(value), record);
    });
  };

  serviceStops.forEach((stop) => {
    indexByIds(serviceStopsById, stop, ["id", "serviceStopId", "internalId"]);
  });

  stopData.forEach((stop, index) => {
    const stopId = String(stop.serviceStopId || stop.id || `stop-data-${index}`);
    if (!stopDataByServiceStopId.has(stopId)) stopDataByServiceStopId.set(stopId, []);
    stopDataByServiceStopId.get(stopId).push(stop);
  });

  const customerNameFor = (customerId, fallback = "") => {
    const customer = customerId ? customersById.get(customerId) : null;
    return customerDisplayName(customer) || fallback || customerId || "No Customer";
  };

  const poolDescriptor = ({ bodyOfWaterId = "", serviceLocationId = "", customerId = "", customerName = "" } = {}) => {
    const body = bodyOfWaterId ? bodiesById.get(bodyOfWaterId) || {} : {};
    const resolvedServiceLocationId = serviceLocationId || body.serviceLocationId || "";
    const location = resolvedServiceLocationId ? serviceLocationsById.get(resolvedServiceLocationId) || {} : {};
    const resolvedCustomerId = customerId || body.customerId || location.customerId || "no-customer";
    const resolvedCustomerName = customerNameFor(resolvedCustomerId, customerName || body.customerName || location.customerName);
    const locationName = serviceLocationName(location);
    const poolName =
      body.name ||
      body.nickName ||
      body.label ||
      location.poolName ||
      location.nickName ||
      locationName ||
      "Pool";
    const id = body.id
      ? `body:${body.id}`
      : `location:${resolvedServiceLocationId || resolvedCustomerId || "unknown"}`;

    return {
      id,
      customerId: resolvedCustomerId,
      customerName: resolvedCustomerName,
      serviceLocationId: resolvedServiceLocationId,
      serviceLocation: locationName,
      bodyOfWaterId: body.id || "",
      pool: poolName,
    };
  };

  const poolDescriptorsForLocation = (serviceLocationId, fallback = {}) => {
    const bodies = bodiesByLocationId.get(serviceLocationId) || [];
    if (bodies.length) {
      return bodies.map((body) =>
        poolDescriptor({
          bodyOfWaterId: body.id,
          serviceLocationId,
          customerId: fallback.customerId,
          customerName: fallback.customerName,
        })
      );
    }

    return [
      poolDescriptor({
        serviceLocationId,
        customerId: fallback.customerId,
        customerName: fallback.customerName,
      }),
    ];
  };

  const fallbackPoolDescriptorsForCustomer = (customerId, customerName) => {
    const locations = serviceLocations.filter((location) => location.customerId === customerId && location.active !== false && location.isActive !== false);
    if (!locations.length) return [poolDescriptor({ customerId, customerName })];
    return locations.flatMap((location) => poolDescriptorsForLocation(location.id, { customerId, customerName }));
  };

  const uniqueDescriptors = (descriptors) => {
    const seen = new Set();
    return descriptors.filter((descriptor) => {
      if (!descriptor?.id || seen.has(descriptor.id)) return false;
      seen.add(descriptor.id);
      return true;
    });
  };

  const ensurePool = (descriptor) => {
    const poolId = descriptor.id || "location:unknown";
    if (!pools.has(poolId)) {
      pools.set(poolId, {
        ...descriptor,
        agreementIds: new Set(),
        visitIds: new Set(),
        revenueCents: 0,
        laborCents: 0,
        chemicalCents: 0,
        detailRows: [],
      });
    }

    const pool = pools.get(poolId);
    pool.customerName = pool.customerName || descriptor.customerName;
    pool.serviceLocation = pool.serviceLocation || descriptor.serviceLocation;
    pool.pool = pool.pool || descriptor.pool;
    return pool;
  };

  const addDetail = (descriptor, row) => {
    const pool = ensurePool(descriptor);
    pool.detailRows.push({
      id: `${pool.id}-${pool.detailRows.length}-${row.type || "line"}`,
      customer: pool.customerName,
      serviceLocation: pool.serviceLocation,
      pool: pool.pool,
      revenueCents: 0,
      laborCents: 0,
      chemicalCents: 0,
      netCents: 0,
      sortTime: 0,
      ...row,
    });
  };

  const addRevenue = (descriptor, amountCents, agreement) => {
    const amount = Math.round(Number(amountCents || 0));
    if (!amount) return;
    const pool = ensurePool(descriptor);
    pool.revenueCents += amount;
    if (agreement?.id) pool.agreementIds.add(agreement.id);

    const dateInfo = normalizeDetailDate(firstPresent(agreement?.startDate, agreement?.acceptedAt, agreement?.sentAt, agreement?.createdAt));
    addDetail(descriptor, {
      ...dateInfo,
      type: "Agreement Revenue",
      source: agreement?.title || agreement?.id || "Service Agreement",
      revenueCents: amount,
      netCents: amount,
    });
  };

  const addLabor = (descriptor, amountCents, row = {}) => {
    const amount = Math.round(Number(amountCents || 0));
    if (!amount) return;
    const pool = ensurePool(descriptor);
    pool.laborCents += amount;
    addDetail(descriptor, {
      ...row,
      type: row.type || "Labor",
      laborCents: amount,
      netCents: -amount,
    });
  };

  const addChemical = (descriptor, amountCents, row = {}) => {
    const amount = Math.round(Number(amountCents || 0));
    if (!amount) return;
    const pool = ensurePool(descriptor);
    pool.chemicalCents += amount;
    addDetail(descriptor, {
      ...row,
      type: row.type || "Chemical",
      chemicalCents: amount,
      netCents: -amount,
    });
  };

  const descriptorsForServiceStop = (serviceStop = {}, fallback = {}) => {
    if (fallback.bodyOfWaterId || serviceStop.bodyOfWaterId) {
      return [
        poolDescriptor({
          bodyOfWaterId: fallback.bodyOfWaterId || serviceStop.bodyOfWaterId,
          serviceLocationId: fallback.serviceLocationId || serviceStop.serviceLocationId,
          customerId: fallback.customerId || serviceStop.customerId,
          customerName: fallback.customerName || serviceStop.customerName,
        }),
      ];
    }

    const stopRecords = stopDataByServiceStopId.get(String(serviceStop.id || serviceStop.serviceStopId || fallback.serviceStopId || "")) || [];
    if (stopRecords.length) {
      return uniqueDescriptors(
        stopRecords.map((record) =>
          poolDescriptor({
            bodyOfWaterId: record.bodyOfWaterId,
            serviceLocationId: record.serviceLocationId || serviceStop.serviceLocationId,
            customerId: record.customerId || serviceStop.customerId,
            customerName: record.customerName || serviceStop.customerName,
          })
        )
      );
    }

    const serviceLocationId = fallback.serviceLocationId || serviceStop.serviceLocationId;
    if (serviceLocationId) {
      return poolDescriptorsForLocation(serviceLocationId, {
        customerId: fallback.customerId || serviceStop.customerId,
        customerName: fallback.customerName || serviceStop.customerName,
      });
    }

    return [
      poolDescriptor({
        customerId: fallback.customerId || serviceStop.customerId,
        customerName: fallback.customerName || serviceStop.customerName,
      }),
    ];
  };

  const distributeAmount = (descriptors, amountCents, addValue, rowFactory) => {
    const targets = uniqueDescriptors(descriptors);
    if (!targets.length || !amountCents) return;
    const share = Math.round(Number(amountCents || 0) / targets.length);
    targets.forEach((descriptor) => addValue(descriptor, share, rowFactory?.(descriptor) || {}));
  };

  serviceAgreements.forEach((agreement) => {
    const revenueCents = agreementRevenueCentsForRange(agreement, dateRangeStart, dateRangeEnd);
    if (!revenueCents) return;

    const locationIds = agreementServiceLocationIds(agreement);
    const descriptors = locationIds.length
      ? locationIds.flatMap((serviceLocationId) =>
          poolDescriptorsForLocation(serviceLocationId, {
            customerId: agreement.customerId,
            customerName: agreement.customerName,
          })
        )
      : fallbackPoolDescriptorsForCustomer(agreement.customerId, agreement.customerName);

    distributeAmount(
      descriptors,
      revenueCents,
      (descriptor, amount) => addRevenue(descriptor, amount, agreement),
      null
    );
  });

  stopData.forEach((stop, index) => {
    const serviceStop = serviceStopsById.get(String(stop.serviceStopId || "")) || {};
    const descriptor = poolDescriptor({
      bodyOfWaterId: stop.bodyOfWaterId || serviceStop.bodyOfWaterId,
      serviceLocationId: stop.serviceLocationId || serviceStop.serviceLocationId,
      customerId: stop.customerId || serviceStop.customerId,
      customerName: stop.customerName || serviceStop.customerName,
    });
    const pool = ensurePool(descriptor);
    pool.visitIds.add(String(stop.serviceStopId || stop.id || `${descriptor.id}-${index}`));

    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    dosages.forEach((dosage) => {
      const template = dosageTemplateFor(dosage, dosageTemplatesById) || {};
      const costRecord = {
        ...dosage,
        isChemicalCostRecord: true,
        customerId: stop.customerId || serviceStop.customerId,
        customerName: stop.customerName || serviceStop.customerName,
        serviceLocationId: stop.serviceLocationId || serviceStop.serviceLocationId,
        bodyOfWaterId: stop.bodyOfWaterId || serviceStop.bodyOfWaterId,
        date: stop.date || serviceStop.serviceDate || serviceStop.date,
      };
      const costAgreement = agreementForPnlCost(serviceAgreements, costRecord, costRecord.date);
      if (shouldExcludePnlChemicalCost({ agreement: costAgreement, record: costRecord, linkedRecord: template })) return;

      const explicitCostCents = centsField(dosage.totalCostCents, dosage.costCents, dosage.extendedCostCents);
      const explicitCostDollars = dollarFieldToCents(dosage.totalCost, dosage.cost, dosage.extendedCost);
      const amount = Number(dosage.amount ?? dosage.quantity ?? dosage.value ?? 0);
      const unitRateCents =
        centsField(dosage.rateCents, dosage.unitCostCents, template.rateCents, template.unitCostCents) ||
        dollarFieldToCents(dosage.rate, dosage.unitCost, template.rate, template.unitCost);
      const chemicalCostCents = explicitCostCents || explicitCostDollars || Math.round((Number.isFinite(amount) ? amount : 0) * unitRateCents);

      if (!chemicalCostCents) return;

      const dateInfo = normalizeDetailDate(stop.date);
      addChemical(descriptor, chemicalCostCents, {
        ...dateInfo,
        source: [
          dosage.name || template.name || template.chemType || "Dosage",
          valueWithUnit(dosage),
        ].filter(Boolean).join(" | "),
      });
    });
  });

  const activePayrollLines = payrollLines.filter((line) => reportStatusKey(line.calculationStatus) !== "voided" && !line.voidedAt);
  activePayrollLines.forEach((line) => {
    const amountCents = payrollLineCents(line);
    if (!amountCents) return;

    const lineServiceStopId = idValue(firstPresent(line.serviceStopId, line.serviceStopID, line.stopId));
    const serviceStop = serviceStopsById.get(lineServiceStopId) || {};
    if (lineServiceStopId) actualPayServiceStopIds.add(lineServiceStopId);

    const descriptors = descriptorsForServiceStop(serviceStop, {
      serviceStopId: lineServiceStopId,
      bodyOfWaterId: line.bodyOfWaterId,
      serviceLocationId: line.serviceLocationId,
      customerId: line.customerId,
      customerName: line.customerName,
    });
    const dateInfo = normalizeDetailDate(firstPresent(line.completedDate, line.paidAt, line.createdAt));

    distributeAmount(
      descriptors,
      amountCents,
      addLabor,
      () => ({
        ...dateInfo,
        source: line.displayTitle || line.workTypeName || line.serviceStopTypeName || line.id || "Payroll Line",
      })
    );
  });

  serviceStops.forEach((serviceStop) => {
    const serviceStopId = String(serviceStop.id || serviceStop.serviceStopId || "");
    if (!serviceStopId || actualPayServiceStopIds.has(serviceStopId)) return;

    const estimatedPay = estimateServiceStopPaySummary({
      companyId,
      settings: paySettings,
      serviceStop,
      serviceStopType: serviceStopTypeFor(serviceStop),
      serviceStopUseCaseSourceId: serviceStopUseCaseSourceId(serviceStop),
      tasks: tasksForServiceStop(serviceStop),
      worker: companyUserForServiceStop(serviceStop),
      workTypes: companyWorkTypes,
      mappings: workTypeMappings,
      rates: technicianRates,
      date: dateFromValue(firstPresent(serviceStop.completedDate, serviceStop.serviceDate, serviceStop.date, serviceStop.createdAt)) || new Date(),
    });
    const laborLines = estimatedPay.lines.filter((line) => cents(line.totalAmountCents) > 0);
    if (!laborLines.length) return;

    const descriptors = descriptorsForServiceStop(serviceStop);
    const dateInfo = normalizeDetailDate(firstPresent(serviceStop.completedDate, serviceStop.serviceDate, serviceStop.date));

    laborLines.forEach((line) => {
      distributeAmount(
        descriptors,
        cents(line.totalAmountCents),
        addLabor,
        () => ({
          ...dateInfo,
          source: payrollEstimateLineLabel(line, serviceStop),
        })
      );
    });
  });

  const poolRows = [...pools.values()]
    .map((pool) => {
      const costCents = pool.laborCents + pool.chemicalCents;
      const netCents = pool.revenueCents - costCents;
      return {
        id: pool.id,
        customerId: pool.customerId,
        customer: pool.customerName,
        serviceLocation: pool.serviceLocation,
        pool: pool.pool,
        agreements: pool.agreementIds.size,
        visits: pool.visitIds.size,
        revenueCents: pool.revenueCents,
        laborCents: pool.laborCents,
        chemicalCents: pool.chemicalCents,
        costCents,
        netCents,
        margin: marginString(netCents, pool.revenueCents),
        targetRateCents: targetRateCentsFor(costCents),
        detailRows: pool.detailRows.sort((left, right) => left.sortTime - right.sortTime),
      };
    })
    .sort((left, right) => left.netCents - right.netCents || left.customer.localeCompare(right.customer) || left.pool.localeCompare(right.pool));

  const totals = poolRows.reduce((result, row) => ({
    revenueCents: result.revenueCents + row.revenueCents,
    laborCents: result.laborCents + row.laborCents,
    chemicalCents: result.chemicalCents + row.chemicalCents,
    costCents: result.costCents + row.costCents,
    netCents: result.netCents + row.netCents,
    visits: result.visits + row.visits,
  }), { revenueCents: 0, laborCents: 0, chemicalCents: 0, costCents: 0, netCents: 0, visits: 0 });

  const summaryColumns = [
    { key: "customer", label: "Customer" },
    { key: "serviceLocation", label: "Service Location" },
    { key: "pool", label: "Pool" },
    { key: "agreements", label: "Agreements", align: "right" },
    { key: "visits", label: "Visits", align: "right" },
    { key: "revenueCents", label: "Agreement Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
    { key: "laborCents", label: "Labor", align: "right", render: (row) => moneyFromCents(row.laborCents) },
    { key: "chemicalCents", label: "Chemicals", align: "right", render: (row) => moneyFromCents(row.chemicalCents) },
    { key: "costCents", label: "Direct Cost", align: "right", render: (row) => moneyFromCents(row.costCents) },
    { key: "netCents", label: "Net", align: "right", render: (row) => moneyFromCents(row.netCents) },
    { key: "margin", label: "Margin", align: "right" },
    { key: "targetRateCents", label: "Target Rate", align: "right", render: (row) => moneyFromCents(row.targetRateCents) },
  ];

  const detailColumns = [
    { key: "date", label: "Date" },
    { key: "type", label: "Type" },
    { key: "source", label: "Source" },
    { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
    { key: "laborCents", label: "Labor", align: "right", render: (row) => moneyFromCents(row.laborCents) },
    { key: "chemicalCents", label: "Chemicals", align: "right", render: (row) => moneyFromCents(row.chemicalCents) },
    { key: "netCents", label: "Net", align: "right", render: (row) => moneyFromCents(row.netCents) },
  ];

  const summaryGroupsByCustomer = new Map();
  poolRows.forEach((row) => {
    const group = ensureGroup(summaryGroupsByCustomer, { id: row.customerId || row.customer, name: row.customer || "No Customer" });
    group.rows.push(row);
  });

  const customerGroups = [...summaryGroupsByCustomer.values()].map((group) => {
    const groupTotals = group.rows.reduce((result, row) => ({
      revenueCents: result.revenueCents + row.revenueCents,
      laborCents: result.laborCents + row.laborCents,
      chemicalCents: result.chemicalCents + row.chemicalCents,
      costCents: result.costCents + row.costCents,
      netCents: result.netCents + row.netCents,
      visits: result.visits + row.visits,
    }), { revenueCents: 0, laborCents: 0, chemicalCents: 0, costCents: 0, netCents: 0, visits: 0 });

    return {
      ...group,
      metrics: {
        Revenue: moneyFromCents(groupTotals.revenueCents),
        "Direct Cost": moneyFromCents(groupTotals.costCents),
        Net: moneyFromCents(groupTotals.netCents),
      },
      footerRow: {
        customer: "Total",
        serviceLocation: "",
        pool: "",
        agreements: "",
        visits: groupTotals.visits,
        revenueCents: groupTotals.revenueCents,
        laborCents: groupTotals.laborCents,
        chemicalCents: groupTotals.chemicalCents,
        costCents: groupTotals.costCents,
        netCents: groupTotals.netCents,
        margin: marginString(groupTotals.netCents, groupTotals.revenueCents),
        targetRateCents: targetRateCentsFor(groupTotals.costCents),
      },
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  const detailGroups = poolRows.map((row) => ({
    id: row.id,
    name: `${row.customer} | ${row.pool}`,
    metrics: {
      Revenue: moneyFromCents(row.revenueCents),
      Labor: moneyFromCents(row.laborCents),
      Chemicals: moneyFromCents(row.chemicalCents),
      Net: moneyFromCents(row.netCents),
    },
    rows: row.detailRows,
    footerRow: {
      date: "Total",
      type: "",
      source: "",
      revenueCents: row.revenueCents,
      laborCents: row.laborCents,
      chemicalCents: row.chemicalCents,
      netCents: row.netCents,
    },
  }));

  const watchlistRows = poolRows
    .filter((row) => row.netCents < 0 || row.revenueCents === 0 || (row.revenueCents > 0 && row.netCents / row.revenueCents < 0.35))
    .slice(0, 20);

  return {
    title: "PNL Per Pool Report",
    stats: [
      numberMetric("Pools", poolRows.length),
      moneyMetric("Agreement Revenue", totals.revenueCents),
      moneyMetric("Direct Costs", totals.costCents),
      moneyMetric("Net", totals.netCents),
      numberMetric("Visits", totals.visits),
    ],
    columns: mode === "detail" ? detailColumns : summaryColumns,
    summarySections: [
      {
        title: "Rate Watchlist",
        columns: [
          { key: "customer", label: "Customer" },
          { key: "pool", label: "Pool" },
          { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
          { key: "costCents", label: "Direct Cost", align: "right", render: (row) => moneyFromCents(row.costCents) },
          { key: "netCents", label: "Net", align: "right", render: (row) => moneyFromCents(row.netCents) },
          { key: "margin", label: "Margin", align: "right" },
          { key: "targetRateCents", label: "Target Rate", align: "right", render: (row) => moneyFromCents(row.targetRateCents) },
        ],
        rows: watchlistRows,
      },
    ],
    total: {
      label: "Company Pool Net",
      value: moneyFromCents(totals.netCents),
      subtitle: `${poolRows.length.toLocaleString()} pool(s) | ${totals.visits.toLocaleString()} visit(s)`,
    },
    groups: mode === "detail" ? detailGroups : customerGroups,
  };
};

const buildPnlReport = ({ jobs, purchases, payrollLines, salesInvoices = [], serviceAgreements = [], databaseItemById = new Map(), groupBy, dateRangeStart, dateRangeEnd }) => {
  const groups = new Map();
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    addMetric(group, "revenueCents", jobRevenueCents(job));
    addMetric(group, "jobLaborCents", jobLaborCostCents(job));
  });
  serviceAgreements.forEach((agreement) => {
    const revenueCents = agreementRevenueCentsForRange(agreement, dateRangeStart, dateRangeEnd);
    if (!revenueCents) return;

    const group = ensureGroup(groups, groupKey({
      customerId: agreement.customerId,
      customerName: agreement.customerName,
      userId: agreement.createdByUserId,
      userName: agreement.createdByUserName || agreement.acceptedByUserName || "Unassigned",
    }, groupBy));
    addMetric(group, "agreementRevenueCents", revenueCents);
  });
  salesInvoices.forEach((invoice) => {
    const chemicalRevenueCents = invoiceChemicalRevenueCentsForPnl(invoice, serviceAgreements);
    if (!chemicalRevenueCents) return;

    const group = ensureGroup(groups, groupKey(invoice, groupBy));
    addMetric(group, "chemicalInvoiceRevenueCents", chemicalRevenueCents);
  });
  purchases.forEach((purchase) => {
    const databaseItem = purchaseDatabaseItem(purchase, databaseItemById) || {};
    const costAgreement = agreementForPnlCost(
      serviceAgreements,
      purchase,
      itemDate(purchase, ["date", "createdAt", "dateCreated"])
    );
    if (shouldExcludePnlChemicalCost({ agreement: costAgreement, record: purchase, linkedRecord: databaseItem })) return;

    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    addMetric(group, "purchaseCents", purchaseTotalCents(purchase));
  });
  payrollLines.forEach((line) => {
    const group = ensureGroup(groups, groupKey(line, groupBy));
    addMetric(group, "payrollCents", payrollLineCents(line));
  });

  const resultGroups = [...groups.values()].map((group) => {
    const jobRevenueCents = group.metrics.revenueCents || 0;
    const agreementRevenueCents = group.metrics.agreementRevenueCents || 0;
    const chemicalInvoiceRevenueCents = group.metrics.chemicalInvoiceRevenueCents || 0;
    const revenueCents = jobRevenueCents + agreementRevenueCents + chemicalInvoiceRevenueCents;
    const costCents = (group.metrics.purchaseCents || 0) + (group.metrics.payrollCents || 0) + (group.metrics.jobLaborCents || 0);
    group.rows = [{ jobRevenueCents, agreementRevenueCents, chemicalInvoiceRevenueCents, revenueCents, costCents, netCents: revenueCents - costCents }];
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
      { key: "agreementRevenueCents", label: "Agreement Revenue", align: "right", render: (row) => moneyFromCents(row.agreementRevenueCents) },
      { key: "chemicalInvoiceRevenueCents", label: "Chemical Revenue", align: "right", render: (row) => moneyFromCents(row.chemicalInvoiceRevenueCents) },
      { key: "jobRevenueCents", label: "Job Revenue", align: "right", render: (row) => moneyFromCents(row.jobRevenueCents) },
      { key: "revenueCents", label: "Total Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
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

const ReportSummaryBar = ({ stats = [], total }) => {
  const items = total ? [...stats, { ...total, emphasized: true }] : stats;
  if (!items.length) return null;

  return (
    <div className="mt-3 flex gap-2 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-2">
      {items.map((item) => (
        <div
          key={item.label}
          className={`min-w-[150px] shrink-0 px-3 py-1.5 ${
            item.emphasized
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
    <section className="flex min-h-[560px] flex-col rounded-lg border border-slate-200 bg-white shadow-sm xl:h-full xl:min-h-0">
      <div className="shrink-0 border-b border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{data.title || "Generated Report"}</h2>
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

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <SummarySectionsView sections={data.summarySections || []} />

        {data.groups.length ? (
          <div className={`${data.summarySections?.length ? "mt-4 " : ""}grid gap-3`}>
            {data.groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{group.name}</h3>
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
  const [readingPerformanceStandards, setReadingPerformanceStandards] = useState([]);
  const [readingPerformanceView, setReadingPerformanceView] = useState("users");
  const [quickDateRange, setQuickDateRange] = useState("thisMonth");
  const [dateRange, setDateRange] = useState(defaultDateRange);
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
      setReadingPerformanceStandards([]);
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

  const handleReportSelect = (value) => {
    setReportType(value);
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
      const needsPayroll = ["pnl", "job", "users", "pnlPerPool"].includes(reportType);
      const needsPayrollFallback = reportType === "pnlPerPool";
      const needsUsers = reportType === "users" || needsPayrollFallback;
      const needsFleet = reportType === "vehicle";
      const needsBodiesOfWater = ["readingHealth", "readingPerformance", "pnlPerPool"].includes(reportType);
      const needsServiceStops = ["users", "readingPerformance", "pnlPerPool"].includes(reportType);
      const needsRecurringServiceStops = reportType === "readingPerformance";
      const needsServiceAgreements = ["pnl", "pnlPerPool"].includes(reportType);
      const needsServiceLocations = reportType === "pnlPerPool";
      const needsSalesInvoices = reportType === "pnl";

      const [
        purchasesRaw,
        databaseItemsRaw,
        jobsRaw,
        payrollLinesRaw,
        serviceStopsRaw,
        recurringServiceStopsRaw,
        serviceAgreementsRaw,
        salesInvoicesRaw,
        serviceLocationsRaw,
        usersRaw,
        vehiclesRaw,
        activeRoutesRaw,
        bodiesOfWaterRaw,
        paySettingsRaw,
        companyServiceStopTypesRaw,
        companyWorkTypesRaw,
        workTypeMappingsRaw,
        technicianRatesRaw,
      ] = await Promise.all([
        needsPurchases ? getCollection(recentlySelectedCompany, "purchasedItems") : Promise.resolve([]),
        needsPurchases ? getDatabaseItems(recentlySelectedCompany) : Promise.resolve([]),
        needsJobs ? getCollection(recentlySelectedCompany, "workOrders") : Promise.resolve([]),
        needsPayroll ? getCollection(recentlySelectedCompany, "technicianPayLineItems") : Promise.resolve([]),
        needsServiceStops ? getCollection(recentlySelectedCompany, "serviceStops") : Promise.resolve([]),
        needsRecurringServiceStops ? getCollection(recentlySelectedCompany, "recurringServiceStop") : Promise.resolve([]),
        needsServiceAgreements
          ? getDocs(query(collection(db, "salesAgreements"), where("companyId", "==", recentlySelectedCompany))).then(normalizeDocs)
          : Promise.resolve([]),
        needsSalesInvoices
          ? getDocs(query(collection(db, "salesInvoices"), where("companyId", "==", recentlySelectedCompany))).then(normalizeDocs)
          : Promise.resolve([]),
        needsServiceLocations ? getCollection(recentlySelectedCompany, "serviceLocations") : Promise.resolve([]),
        needsUsers ? getCollection(recentlySelectedCompany, "companyUsers") : Promise.resolve([]),
        needsFleet ? getCollection(recentlySelectedCompany, "vehicals") : Promise.resolve([]),
        needsFleet ? getCollection(recentlySelectedCompany, "activeRoutes") : Promise.resolve([]),
        needsBodiesOfWater ? getCollection(recentlySelectedCompany, "bodiesOfWater") : Promise.resolve([]),
        needsPayrollFallback
          ? getDoc(doc(db, "companies", recentlySelectedCompany, "paySettings", "main")).then((snap) => (snap.exists() ? snap.data() : null))
          : Promise.resolve(null),
        needsPayrollFallback ? getCollection(recentlySelectedCompany, "companyServiceStopTypes") : Promise.resolve([]),
        needsPayrollFallback ? getCollection(recentlySelectedCompany, "companyWorkTypes") : Promise.resolve([]),
        needsPayrollFallback ? getCollection(recentlySelectedCompany, "workTypeMappings") : Promise.resolve([]),
        needsPayrollFallback ? getCollection(recentlySelectedCompany, "technicianRates") : Promise.resolve([]),
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
        records: serviceStopsRaw.filter((item) =>
          reportType === "readingPerformance" ? true : inRange(item, startDate, endDate, ["serviceDate", "date", "createdAt"])
        ),
        ...tagFilterContext,
      });
      const recurringServiceStops = filterRecordsByCustomerTags({
        records: recurringServiceStopsRaw,
        ...tagFilterContext,
      });
      const serviceAgreements = filterRecordsByCustomerTags({
        records: serviceAgreementsRaw,
        ...tagFilterContext,
      });
      const salesInvoices = filterRecordsByCustomerTags({
        records: salesInvoicesRaw.filter((item) => inRange(item, startDate, endDate, ["sentAt", "paidAt", "invoiceDate", "createdAt", "date"])),
        ...tagFilterContext,
      });
      const serviceLocations = filterRecordsByCustomerTags({
        records: serviceLocationsRaw,
        ...tagFilterContext,
      });
      const bodiesOfWater = filterRecordsByCustomerTags({
        records: bodiesOfWaterRaw,
        ...tagFilterContext,
      });
      const serviceStopTasksById = new Map();
      if (needsPayrollFallback && serviceStops.length) {
        const taskEntries = await Promise.all(
          serviceStops.map(async (serviceStop) => {
            const serviceStopId = String(serviceStop.id || serviceStop.serviceStopId || "").trim();
            if (!serviceStopId) return ["", []];
            const tasksSnap = await getDocs(collection(db, "companies", recentlySelectedCompany, "serviceStops", serviceStopId, "tasks"));
            return [serviceStopId, normalizeDocs(tasksSnap)];
          })
        );
        taskEntries.forEach(([serviceStopId, tasks]) => {
          if (serviceStopId) serviceStopTasksById.set(serviceStopId, tasks);
        });
      }
      const activeRoutes = activeRoutesRaw.filter((item) => inRange(item, startDate, endDate, ["date", "routeDate", "startTime", "createdAt"]));
      const databaseItemById = new Map(databaseItemsRaw.map((item) => [item.id, item]));

      const context = {
        companyId: recentlySelectedCompany,
        stopData,
        readingTemplates,
        dosageTemplates,
        readingHealthFilters,
        readingPerformanceStandards,
        readingPerformanceView,
        bodiesOfWater,
        customersById,
        purchases,
        databaseItemById,
        jobs,
        payrollLines,
        serviceStops,
        recurringServiceStops,
        serviceAgreements,
        salesInvoices,
        serviceLocations,
        users: usersRaw,
        companyUsers: usersRaw,
        paySettings: paySettingsRaw,
        companyServiceStopTypes: companyServiceStopTypesRaw,
        companyWorkTypes: companyWorkTypesRaw,
        workTypeMappings: workTypeMappingsRaw,
        technicianRates: technicianRatesRaw,
        serviceStopTasksById,
        vehicles: vehiclesRaw,
        activeRoutes,
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
        mode,
        groupBy,
      };

      const builders = {
        readings: buildReadingReport,
        readingHealth: buildReadingHealthReport,
        readingPerformance: buildReadingPerformanceReport,
        chemicals: buildChemicalReport,
        purchases: buildPurchaseReport,
        waste: buildWasteReport,
        users: buildUsersReport,
        pnlPerPool: buildPnlPerPoolReport,
        pnl: buildPnlReport,
        job: buildJobReport,
        vehicle: buildVehicleReport,
        tax: buildTaxReport,
      };

      const nextReport = builders[reportType](context);
      setReportData({
        ...nextReport,
        mode,
        stats: [
          ...(nextReport.stats || []),
          { label: "Date Range", value: displayDateRange(dateRange) },
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
    <div className="min-h-screen bg-slate-50 px-2 py-4 sm:px-3 lg:px-4">
      <div className="w-full">
        <header className="mb-3">
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-600">Operations and finance reporting.</p>
        </header>

        <div className="grid gap-4 xl:h-[calc(100vh-100px)] xl:grid-cols-[minmax(0,1fr)_340px] xl:overflow-hidden">
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
                      value={dateRange.start}
                      onChange={(event) => {
                        setQuickDateRange("custom");
                        setDateRange((prev) => ({ ...prev, start: event.target.value }));
                      }}
                      className="rounded-md border border-slate-300 p-2 text-sm"
                    />
                    <input
                      type="date"
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
