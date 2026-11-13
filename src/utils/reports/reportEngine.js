import { addDays, differenceInCalendarDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { estimateServiceStopPaySummary } from "../payroll/payEstimate";
import { ChemicalBillingTreatment, classifyAgreementChemicalBilling } from "../sales/chemicalBilling";
import { AgreementBillingType, getAgreementBillingType } from "../sales/agreementRouting";
import { serviceStopIsRecurringRoute } from "../serviceStops/operationsServiceStops";
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

const sanitizeDateRange = (value = {}) => {
  const fallback = defaultDateRange();
  return {
    start: value.start || fallback.start,
    end: value.end || fallback.end,
  };
};

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
  if (value?.toDate) return dateFromValue(value.toDate());
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`);
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
  item.name || templatesById.get(item.templateId)?.name || templatesById.get(item.universalTemplateId)?.name || templatesById.get(item.readingsTemplateId)?.name || templatesById.get(item.dosageTemplateId)?.name || fallback;

const valueWithUnit = (item) => [item.amount ?? item.value ?? item.quantity ?? "", item.UOM || item.uom || ""].filter(Boolean).join(" ").trim() || "-";

const reportItemUnit = (item = {}, template = {}) =>
  item.UOM || item.uom || template.UOM || template.uom || "";

const formatDecimal = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

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
  if (!date) return false;
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

const normalizeLookupValue = (value) => String(value || "").trim().toLowerCase();

const companyUserDisplayName = (user = {}) => (
  user.userName ||
  user.displayName ||
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.name ||
  user.email ||
  user.userId ||
  user.id ||
  "Company User"
);

const companyUserLookupValues = (user = {}) => (
  [
    user.id,
    user.userId,
    user.docId,
    user.uid,
    user.companyUserId,
    user.email,
  ].filter(Boolean).map(normalizeLookupValue)
);

const resolveCompanyUserForReportGroup = (group = {}, companyUsers = []) => {
  const groupId = normalizeLookupValue(group.id);
  if (groupId) {
    const exactMatch = companyUsers.find((user) => companyUserLookupValues(user).includes(groupId));
    if (exactMatch) return exactMatch;
  }

  const groupName = normalizeLookupValue(group.name);
  if (!groupName) return null;

  return companyUsers.find((user) => (
    [
      companyUserDisplayName(user),
      user.userName,
      user.displayName,
      user.name,
      user.email,
    ].filter(Boolean).map(normalizeLookupValue).includes(groupName)
  )) || null;
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

const purchasePreTaxCents = (item) => {
  const explicit = item.subtotalAmountCents ?? item.preTaxCents ?? item.totalCents ?? item.cost;
  if (explicit !== undefined && explicit !== null && explicit !== "") return cents(explicit);
  const quantity = toNumber(item.quantity ?? item.quantityString ?? 1);
  return Math.round(cents(item.priceCents ?? item.price ?? item.unitCostCents) * quantity);
};

const purchaseTotalCents = (item) => {
  const explicit = item.totalAfterTaxCents ?? item.totalAmountCents ?? item.costAfterTax;
  if (explicit !== undefined && explicit !== null && explicit !== "") return cents(explicit);
  const pretax = purchasePreTaxCents(item);
  const tax = item.taxAmountCents ?? item.taxCents ?? item.tax;
  return tax !== undefined && tax !== null && tax !== "" ? pretax + cents(tax) : Math.round(pretax * 1.085);
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
      if (value && typeof value === "object") {
        return [value.id, value.value, value.docId, value.internalId].filter(Boolean);
      }
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

const inferPackageUnit = (...values) => {
  const inferred = normalizeUnit(values.filter(Boolean).join(" "));
  return inferred === "unit" ? "" : inferred;
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

const packageQuantityInfo = ({ purchase = {}, databaseItem = {}, lineQuantity = 1 } = {}) => {
  const sizeValue = databaseItem.size ?? purchase.size ?? purchase.packageSize ?? purchase.packageQuantity ?? "";
  const parsedPackageSize = parseFirstNumber(sizeValue);
  const packageSize = parsedPackageSize && parsedPackageSize > 0 ? parsedPackageSize : 1;
  const sizeUnit = normalizeUnit(sizeValue);
  const databaseItemUnit = normalizeUnit(databaseItem.UOM || databaseItem.uom);
  const purchaseUnit = normalizeUnit(purchase.UOM || purchase.uom);
  const textUnit = inferPackageUnit(
    sizeValue,
    databaseItem.name,
    databaseItem.description,
    databaseItem.subCategory,
    databaseItem.category,
    purchase.name,
    purchase.description,
    purchase.notes
  );
  const itemUnit = databaseItemUnit === "unit" && textUnit ? textUnit : databaseItemUnit;
  const lineUnit = purchaseUnit === "unit" && textUnit ? textUnit : purchaseUnit;
  const unit = sizeUnit || itemUnit || lineUnit || textUnit || "unit";

  return {
    amount: Number(lineQuantity || 1) * packageSize,
    lineQuantity,
    packageSize,
    unit,
  };
};

const purchaseQuantity = (purchase, databaseItemById) => {
  const databaseItem = purchaseDatabaseItem(purchase, databaseItemById) || {};
  const lineQuantity = toNumber(purchase.quantity ?? purchase.quantityString ?? 1);
  return packageQuantityInfo({ purchase, databaseItem, lineQuantity });
};

const jobRevenueCents = (job) => cents(job.reportRevenueCents ?? job.revenueCents ?? job.invoiceTotalCents ?? job.totalAmountCents ?? job.totalCents ?? job.rate ?? job.amount ?? 0);
const jobLaborCostCents = (job) => cents(job.laborCostCents ?? job.laborCost ?? 0);
const payrollLineCents = (line) => cents(line.totalAmountCents ?? line.amountCents ?? line.payCents ?? 0);

const isPayrollLinePaid = (line) => Boolean(line?.paidAt) || reportStatusKey(line?.calculationStatus) === "paid";

const isPayrollLineApproved = (line) =>
  Boolean(line?.approvedAt) || reportStatusKey(line?.calculationStatus) === "approved" || isPayrollLinePaid(line);

const isPayrollLineVoided = (line) => Boolean(line?.voidedAt) || reportStatusKey(line?.calculationStatus) === "voided";

const payrollStatusCategory = (line) => {
  if (isPayrollLinePaid(line)) return "paid";
  if (isPayrollLineApproved(line)) return "approved";
  return "unapproved";
};

const payrollCategoryLabels = {
  paid: "Paid",
  approved: "Approved Unpaid",
  unapproved: "Unapproved",
  predicted: "Predicted",
};

const payrollCategoryOrder = ["paid", "approved", "unapproved", "predicted"];

const payrollCategoryLabel = (category) => payrollCategoryLabels[category] || "Unapproved";

const payrollLineWorkerId = (line = {}) =>
  line.technicianId || line.userId || line.techId || line.workerId || "unassigned";

const payrollLineWorkerName = (line = {}) =>
  line.technicianName || line.userName || line.techName || line.workerName || "Unassigned";

const payrollLineDisplayTitle = (line = {}) =>
  line.displayTitle || line.taskName || line.workTypeName || line.serviceStopTypeName || line.title || "Payroll Line";

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

const positiveCentsField = (...values) => {
  const value = centsField(...values);
  return value > 0 ? value : 0;
};

const positiveDollarFieldToCents = (...values) => {
  const value = dollarFieldToCents(...values);
  return value > 0 ? value : 0;
};

const databaseItemPackageCostCents = (item = {}) =>
  positiveCentsField(item.rate, item.rateCents, item.unitCostCents, item.costCents) ||
  positiveDollarFieldToCents(item.unitCost, item.cost);

const linkedItemSetForDosage = (dosage = {}, template = {}) =>
  new Set(dosageLinkedItemIds(dosage, template).map(String).filter(Boolean));

const linkedPurchaseUnitCostEstimate = ({ dosage = {}, template = {}, purchases = [], databaseItemById = new Map() } = {}) => {
  const linkedItemIds = linkedItemSetForDosage(dosage, template);
  const dosageUnit = normalizeUnit(reportItemUnit(dosage, template));
  if (!linkedItemIds.size || !dosageUnit) return null;

  const totals = purchases.reduce((result, purchase) => {
    const purchaseItemId = String(purchaseDatabaseItemId(purchase) || "");
    if (!linkedItemIds.has(purchaseItemId)) return result;

    const quantityInfo = purchaseQuantity(purchase, databaseItemById);
    const convertedAmount = convertAmount(quantityInfo.amount, quantityInfo.unit, dosageUnit);
    if (convertedAmount === null || convertedAmount <= 0) return result;

    const spendCents = purchaseTotalCents(purchase);
    if (!spendCents) return result;

    result.spendCents += spendCents;
    result.amount += convertedAmount;
    result.purchaseLines += 1;
    return result;
  }, { spendCents: 0, amount: 0, purchaseLines: 0 });

  if (!totals.amount) return null;

  return {
    unitCostCents: totals.spendCents / totals.amount,
    source: `${totals.purchaseLines} linked purchase${totals.purchaseLines === 1 ? "" : "s"}`,
  };
};

const linkedCatalogUnitCostEstimate = ({ dosage = {}, template = {}, databaseItemById = new Map() } = {}) => {
  const linkedItemIds = linkedItemSetForDosage(dosage, template);
  const dosageUnit = normalizeUnit(reportItemUnit(dosage, template));
  if (!linkedItemIds.size || !dosageUnit) return null;

  const totals = [...linkedItemIds].reduce((result, itemId) => {
    const databaseItem = databaseItemById.get(itemId);
    if (!databaseItem) return result;

    const packageCostCents = databaseItemPackageCostCents(databaseItem);
    if (!packageCostCents) return result;

    const quantityInfo = packageQuantityInfo({ databaseItem });
    const convertedAmount = convertAmount(quantityInfo.amount, quantityInfo.unit, dosageUnit);
    if (convertedAmount === null || convertedAmount <= 0) return result;

    result.costCents += packageCostCents;
    result.amount += convertedAmount;
    result.itemCount += 1;
    return result;
  }, { costCents: 0, amount: 0, itemCount: 0 });

  if (!totals.amount) return null;

  return {
    unitCostCents: totals.costCents / totals.amount,
    source: `${totals.itemCount} linked catalog item${totals.itemCount === 1 ? "" : "s"}`,
  };
};

const dosageTemplateUnitCostEstimate = (dosage = {}, template = {}) => {
  const unitCostCents =
    positiveCentsField(dosage.unitCostCents, dosage.costCents, template.unitCostCents, template.costCents) ||
    positiveDollarFieldToCents(dosage.unitCost, dosage.cost, template.unitCost, template.cost, dosage.rate, template.rate);

  return unitCostCents ? { unitCostCents, source: "template cost" } : null;
};

const dosageAmountForCost = (dosage = {}) => {
  const amount = Number(dosage.amount ?? dosage.quantity ?? dosage.value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

const dosageChemicalCostEstimate = ({ dosage = {}, template = {}, purchases = [], databaseItemById = new Map() } = {}) => {
  const explicitTotalCents =
    positiveCentsField(dosage.totalCostCents, dosage.extendedCostCents) ||
    positiveDollarFieldToCents(dosage.totalCost, dosage.extendedCost);
  const amount = dosageAmountForCost(dosage);

  if (explicitTotalCents || dosage.totalCostCents === 0 || dosage.extendedCostCents === 0) {
    return {
      totalCostCents: explicitTotalCents,
      unitCostCents: amount > 0 ? explicitTotalCents / amount : 0,
      source: "explicit dosage cost",
    };
  }

  if (amount <= 0) return { totalCostCents: 0, unitCostCents: 0, source: "" };

  const unitCostEstimate =
    linkedPurchaseUnitCostEstimate({ dosage, template, purchases, databaseItemById }) ||
    linkedCatalogUnitCostEstimate({ dosage, template, databaseItemById }) ||
    dosageTemplateUnitCostEstimate(dosage, template);

  if (!unitCostEstimate?.unitCostCents) return { totalCostCents: 0, unitCostCents: 0, source: "" };

  return {
    ...unitCostEstimate,
    totalCostCents: Math.round(amount * unitCostEstimate.unitCostCents),
  };
};

const dosageTemplateUnitPriceCents = (dosage = {}, template = {}) =>
  positiveCentsField(
    dosage.priceCents,
    dosage.unitPriceCents,
    dosage.billingRateCents,
    dosage.sellPriceCents,
    template.priceCents,
    template.unitPriceCents,
    template.billingRateCents,
    template.sellPriceCents
  ) ||
  positiveDollarFieldToCents(
    dosage.price,
    dosage.unitPrice,
    dosage.billingRate,
    dosage.sellPrice,
    template.price,
    template.unitPrice,
    template.billingRate,
    template.sellPrice
  );

const dosageChemicalRevenueCents = (dosage = {}, template = {}) => {
  const amount = dosageAmountForCost(dosage);
  const unitPriceCents = dosageTemplateUnitPriceCents(dosage, template);
  return amount > 0 && unitPriceCents > 0 ? Math.round(amount * unitPriceCents) : 0;
};

const activeRangeOverlapDays = (recordStart, recordEnd, rangeStart, rangeEnd) => {
  const start = dateFromValue(recordStart);
  const end = dateFromValue(recordEnd);
  const effectiveStart = start && start > rangeStart ? start : rangeStart;
  const effectiveEnd = end && end < rangeEnd ? end : rangeEnd;

  if (effectiveStart > rangeEnd || effectiveEnd < rangeStart) return 0;

  return Math.max(0, differenceInCalendarDays(effectiveEnd, effectiveStart) + 1);
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
    const quantity = Number(item.quantity ?? 1);
    const lineTotal = centsField(item.totalAmountCents);
    if (lineTotal) return total + lineTotal;
    return total + Math.round(centsField(item.unitAmountCents) * quantity);
  }, 0);
};

const isRecurringPnlAgreement = (agreement = {}) => (
  getAgreementBillingType(agreement) === AgreementBillingType.recurring
);

const agreementRevenueCentsForRange = (agreement = {}, startDate, endDate) => {
  if (isInactiveAgreementStatus(agreement.status) && !(
    ["canceled", "cancelled", "ended", "terminated"].includes(reportStatusKey(agreement.status)) &&
    firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt)
  )) return 0;
  if (["draft", "sent", "revised", "superseded", "pending"].includes(reportStatusKey(agreement.status))) return 0;
  if (agreement.pnlIncludeInReports === false) return 0;
  if (!isRecurringPnlAgreement(agreement)) return 0;
  const amountCents = agreementAmountCents(agreement);
  if (!amountCents) return 0;

  const agreementStart = firstPresent(agreement.startDate, agreement.acceptedAt, agreement.sentAt, agreement.createdAt);
  const agreementEnd = firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt);
  const overlapDays = activeRangeOverlapDays(agreementStart, agreementEnd, startDate, endDate);
  if (!overlapDays) return 0;

  const frequency = reportStatusKey(agreement.billingFrequency || agreement.billingCadence || agreement.invoiceFrequency || agreement.rateType || "monthly");
  if (frequency.includes("week") || frequency.includes("day")) return Math.round(amountCents * overlapDays / billingIntervalDays(agreement));
  const start = dateFromValue(agreementStart);
  const end = dateFromValue(agreementEnd);
  let cursor = new Date(Math.max(startOfMonth(startDate).getTime(), start ? startOfMonth(start).getTime() : 0));
  const last = end && end < endDate ? end : endDate;
  const count = Math.max(Number(agreement.billingFrequencyCount || agreement.billingCadenceCount || agreement.invoiceFrequencyCount || 1), 1);
  let total = 0;
  while (cursor <= last) {
    const monthEnd = endOfMonth(cursor);
    const days = activeRangeOverlapDays(agreementStart, agreementEnd,
      cursor > startDate ? cursor : startDate, monthEnd < endDate ? monthEnd : endDate);
    const daysInMonth = differenceInCalendarDays(monthEnd, cursor) + 1;
    total += amountCents * days / daysInMonth / count / (frequency.includes("year") || frequency.includes("annual") ? 12 : 1);
    cursor = startOfMonth(addDays(monthEnd, 1));
  }
  return Math.round(total);
};

const agreementServiceLocationIds = (agreement = {}) => {
  const snapshots = Array.isArray(agreement.serviceLocationSnapshots) ? agreement.serviceLocationSnapshots : [];
  const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  const nestedLocations = [
    ...(Array.isArray(agreement.serviceLocations) ? agreement.serviceLocations : []),
    ...(Array.isArray(agreement.locations) ? agreement.locations : []),
  ];
  const ids = normalizeIdList(
    agreement.serviceLocationId,
    agreement.serviceLocationID,
    agreement.companyServiceLocationId,
    agreement.locationId,
    agreement.locationID,
    agreement.serviceLocationIds,
    agreement.serviceLocation?.id,
    agreement.serviceLocation?.serviceLocationId,
    agreement.location?.id,
    agreement.location?.serviceLocationId,
    ...snapshots.map((snapshot) => firstPresent(
      snapshot.id,
      snapshot.serviceLocationId,
      snapshot.companyServiceLocationId,
      snapshot.locationId
    )),
    ...nestedLocations.map((location) => firstPresent(
      location.id,
      location.serviceLocationId,
      location.companyServiceLocationId,
      location.locationId
    )),
    ...lineItems.flatMap((item) => [
      item.serviceLocationId,
      item.serviceLocationIds,
      item.companyServiceLocationId,
      item.locationId,
      item.metadata?.serviceLocationId,
      item.metadata?.companyServiceLocationId,
      item.metadata?.locationId,
      item.serviceLocation?.id,
      item.serviceLocation?.serviceLocationId,
      item.location?.id,
      item.location?.serviceLocationId,
    ])
  );
  return ids;
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
      !["draft", "sent", "revised", "superseded", "pending", "rejected", "expired", "void", "voided"].includes(reportStatusKey(agreement.status)) &&
      (!isInactiveAgreementStatus(agreement.status) || firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt)) &&
      isRecurringPnlAgreement(agreement) &&
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
  !["draft", "void", "voided", "canceled", "cancelled", "uncollectible"].includes(reportStatusKey(invoice.status))
);

const invoiceLineAmountCents = (item = {}) => {
  const total = centsField(item.totalAmountCents, item.amountCents, item.totalCents);
  if ([item.totalAmountCents, item.amountCents, item.totalCents].some((value) => value !== undefined && value !== null)) return total;
  const quantity = Number(item.quantity ?? 1);
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

const buildReadingReport = ({ stopData, readingTemplates, dosageTemplates = [], mode, groupBy }) => {
  const readingTemplatesById = templateMap(readingTemplates, "readingsTemplateId");
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const groups = new Map();
  const overall = { visits: 0, readings: 0, dosages: 0 };
  const templateForItem = (item, templatesById) =>
    templatesById.get(item.templateId) ||
    templatesById.get(item.universalTemplateId) ||
    templatesById.get(item.readingsTemplateId) ||
    templatesById.get(item.dosageTemplateId) ||
    {};
  const addSummaryRow = (rows, item, templatesById, fallback) => {
    const template = templateForItem(item, templatesById);
    const name = templateName(item, templatesById, fallback);
    const unit = reportItemUnit(item, template);
    const rowKey = [name, unit].filter(Boolean).join("|");
    const value = parseReadingNumber(item.amount ?? item.value ?? item.quantity);
    if (!Number.isFinite(value)) return;
    const existingRow = rows.find((row) => row.rowKey === rowKey);

    if (existingRow) {
      existingRow.count += 1;
      existingRow.total += value;
      existingRow.min = Math.min(existingRow.min, value);
      existingRow.max = Math.max(existingRow.max, value);
      return;
    }

    rows.push({ rowKey, name, unit, count: 1, total: value, min: value, max: value });
  };
  const summaryGroupName = (baseGroup, label) =>
    groupBy === "company" ? label : `${baseGroup.name} - ${label}`;

  stopData.forEach((stop) => {
    const readings = Array.isArray(stop.readings) ? stop.readings : [];
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    if (!readings.length && !dosages.length && mode === "summary") return;

    overall.visits += 1;
    overall.readings += readings.length;
    overall.dosages += dosages.length;

    const baseGroup = groupKey(stop, groupBy);

    if (mode === "summary") {
      const readingsGroup = ensureGroup(groups, {
        id: `${baseGroup.id}-readings`,
        name: summaryGroupName(baseGroup, "Readings"),
      });
      const dosagesGroup = ensureGroup(groups, {
        id: `${baseGroup.id}-dosages`,
        name: summaryGroupName(baseGroup, "Dosages"),
      });

      if (readings.length) {
        addMetric(readingsGroup, "visits", 1);
        addMetric(readingsGroup, "readings", readings.length);
      }
      readings.forEach((reading) => {
        addSummaryRow(readingsGroup.rows, reading, readingTemplatesById, "Reading");
      });

      if (dosages.length) {
        addMetric(dosagesGroup, "visits", 1);
        addMetric(dosagesGroup, "dosages", dosages.length);
      }
      dosages.forEach((dosage) => {
        addSummaryRow(dosagesGroup.rows, dosage, dosageTemplatesById, "Dosage");
      });
    } else {
      const group = ensureGroup(groups, baseGroup);
      addMetric(group, "visits", 1);
      addMetric(group, "readings", readings.length);
      addMetric(group, "dosages", dosages.length);
      group.rows.push({
        date: shortDate(stop.date),
        customer: stop.customerName || "-",
        worker: stop.userName || stop.techName || stop.tech || "-",
        readings: readings.map((reading) => `${templateName(reading, readingTemplatesById, "Reading")}: ${valueWithUnit(reading)}`).join(", ") || "-",
        dosages: dosages.map((dosage) => `${templateName(dosage, dosageTemplatesById, "Dosage")}: ${valueWithUnit(dosage)}`).join(", ") || "-",
      });
    }
  });

  const resultGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => (a.name || a.date || "").localeCompare(b.name || b.date || "")),
    }))
    .filter((group) => group.rows.length);

  return {
    title: "Readings & Dosages Report",
    stats: [
      numberMetric("Service Visits", overall.visits),
      numberMetric("Readings", overall.readings),
      numberMetric("Dosages", overall.dosages),
      numberMetric("Templates", readingTemplates.length + dosageTemplates.length),
    ],
    columns: mode === "summary"
      ? [
        { key: "name", label: "Name" },
        { key: "average", label: "Average", align: "right", render: (row) => formatDecimal(row.count ? row.total / row.count : 0) },
        { key: "min", label: "Low", align: "right", render: (row) => formatDecimal(row.min) },
        { key: "max", label: "High", align: "right", render: (row) => formatDecimal(row.max) },
        { key: "unit", label: "Unit" },
      ]
      : [
        { key: "date", label: "Date" },
        { key: "customer", label: "Customer" },
        { key: "worker", label: "Worker" },
        { key: "readings", label: "Readings" },
        { key: "dosages", label: "Dosages" },
      ],
    groups: resultGroups,
  };
};

const createDailyRangeAccumulator = ({ type, item, template, templatesById, fallback, date }) => {
  const templateId = template?.id || template?.readingsTemplateId || template?.dosageTemplateId || "";
  const itemId = item.templateId || item.universalTemplateId || item.readingsTemplateId || item.dosageTemplateId || item.id || "";
  const name = templateName(item, templatesById, fallback);
  const unit = reportItemUnit(item, template);

  return {
    id: [type, templateId || itemId || name, unit].filter(Boolean).join("-"),
    type,
    name,
    unit,
    count: 0,
    total: 0,
    min: Infinity,
    max: -Infinity,
    firstDate: date,
    daily: new Map(),
  };
};

const addDailyRangeValue = (summary, date, value) => {
  const dateKey = format(date, "yyyy-MM-dd");
  const existingDay = summary.daily.get(dateKey) || {
    id: `${summary.id}-${dateKey}`,
    dateKey,
    date,
    dateLabel: format(date, "M/d"),
    count: 0,
    total: 0,
    low: Infinity,
    high: -Infinity,
  };

  existingDay.count += 1;
  existingDay.total += value;
  existingDay.low = Math.min(existingDay.low, value);
  existingDay.high = Math.max(existingDay.high, value);
  summary.daily.set(dateKey, existingDay);

  summary.count += 1;
  summary.total += value;
  summary.min = Math.min(summary.min, value);
  summary.max = Math.max(summary.max, value);
  if (!summary.firstDate || date < summary.firstDate) summary.firstDate = date;
};

const serializeDailyRangeSummary = (summary) => {
  const average = summary.count ? summary.total / summary.count : 0;
  const chartPoints = [...summary.daily.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((day) => ({
      id: day.id,
      dateKey: day.dateKey,
      dateLabel: day.dateLabel,
      date: day.date,
      count: day.count,
      average: day.count ? day.total / day.count : 0,
      low: day.low === Infinity ? 0 : day.low,
      high: day.high === -Infinity ? 0 : day.high,
    }));

  return {
    id: summary.id,
    type: summary.type,
    name: summary.name,
    unit: summary.unit,
    count: summary.count,
    average,
    low: summary.min === Infinity ? 0 : summary.min,
    high: summary.max === -Infinity ? 0 : summary.max,
    chartPoints,
  };
};

const buildFunReadingsDosagesReport = ({
  stopData,
  readingTemplates,
  dosageTemplates,
  dateRangeStart,
  dateRangeEnd,
}) => {
  const readingTemplatesById = templateMap(readingTemplates, "readingsTemplateId");
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const readingSummaries = new Map();
  const dosageSummaries = new Map();
  let readingCount = 0;
  let dosageCount = 0;

  const addValue = ({ map, type, item, templatesById, fallback, date }) => {
    const value = parseReadingNumber(item.amount ?? item.value ?? item.quantity);
    if (!Number.isFinite(value)) return;

    const template =
      templatesById.get(item.templateId) ||
      templatesById.get(item.universalTemplateId) ||
      templatesById.get(item.readingsTemplateId) ||
      templatesById.get(item.dosageTemplateId) ||
      {};
    const key = [
      type,
      template.id || item.templateId || item.universalTemplateId || item.readingsTemplateId || item.dosageTemplateId || item.name || fallback,
      reportItemUnit(item, template),
    ].filter(Boolean).join("-");

    if (!map.has(key)) {
      map.set(key, createDailyRangeAccumulator({ type, item, template, templatesById, fallback, date }));
    }

    addDailyRangeValue(map.get(key), date, value);
  };

  stopData.forEach((stop) => {
    const date = dateFromValue(stop.date);
    if (!date) return;

    (Array.isArray(stop.readings) ? stop.readings : []).forEach((reading) => {
      addValue({
        map: readingSummaries,
        type: "Reading",
        item: reading,
        templatesById: readingTemplatesById,
        fallback: "Reading",
        date,
      });
      if (Number.isFinite(parseReadingNumber(reading.amount ?? reading.value ?? reading.quantity))) readingCount += 1;
    });

    (Array.isArray(stop.dosages) ? stop.dosages : []).forEach((dosage) => {
      addValue({
        map: dosageSummaries,
        type: "Dosage",
        item: dosage,
        templatesById: dosageTemplatesById,
        fallback: "Dosage",
        date,
      });
      if (Number.isFinite(parseReadingNumber(dosage.amount ?? dosage.value ?? dosage.quantity))) dosageCount += 1;
    });
  });

  const sortSummaryRows = (rows) =>
    rows.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  const readingRows = sortSummaryRows([...readingSummaries.values()].map(serializeDailyRangeSummary));
  const dosageRows = sortSummaryRows([...dosageSummaries.values()].map(serializeDailyRangeSummary));
  const displayRows = (rows) => rows.map((row) => ({
    ...row,
    averageDisplay: formatDecimal(row.average),
    lowDisplay: formatDecimal(row.low),
    highDisplay: formatDecimal(row.high),
  }));
  const readingTableRows = displayRows(readingRows);
  const dosageTableRows = displayRows(dosageRows);

  return {
    title: "Fun Readings & Dosages",
    stats: [
      numberMetric("Service Visits", stopData.length),
      numberMetric("Readings", readingCount),
      numberMetric("Dosages", dosageCount),
      numberMetric("Daily Series", readingRows.length + dosageRows.length),
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "averageDisplay", label: "Average", align: "right" },
      { key: "lowDisplay", label: "Low", align: "right" },
      { key: "highDisplay", label: "High", align: "right" },
      { key: "unit", label: "Unit" },
    ],
    groups: [
      {
        id: "readings-summary",
        name: "Readings",
        metrics: {
          Series: readingRows.length,
          Values: readingCount,
        },
        rows: readingTableRows,
      },
      {
        id: "dosages-summary",
        name: "Dosages",
        metrics: {
          Series: dosageRows.length,
          Values: dosageCount,
        },
        rows: dosageTableRows,
      },
    ],
    chartSections: [
      { id: "reading-charts", title: "Reading Charts", items: readingRows },
      { id: "dosage-charts", title: "Dosage Charts", items: dosageRows },
    ],
    chartRange: {
      start: dateRangeStart,
      end: dateRangeEnd,
    },
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

      const readingValue = parseReadingNumber(reading.amount ?? reading.value ?? reading.quantity);
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
  companyUsers = [],
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
  const assessedStopIds = new Set();
  const overallStandardSummaries = new Map(
    standards.map((standard) => [
      standard.id,
      {
        id: standard.id,
        standard: standard.rule,
        assessedStops: 0,
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
          assessedStops: 0,
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
      customerId,
      customer: customerName,
      bodyOfWaterId,
      pool: poolName,
      serviceLocationId: stop.serviceLocationId || serviceStop.serviceLocationId || bodyOfWater.serviceLocationId || "",
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
        assessedStops: 0,
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
    let assessedStandards = 0;

    standards.forEach((standard) => {
      const matching = readings
        .filter((reading) => readingMatchesTemplate(reading, standard.template))
        .map((reading) => ({ reading, value: parseReadingNumber(reading.amount ?? reading.value ?? reading.quantity) }))
        .filter(({ value }) => Number.isFinite(value));
      if (matching.length) {
        assessedStandards += 1;
        group.performance.standards.get(standard.id).assessedStops += 1;
        overallStandardSummaries.get(standard.id).assessedStops += 1;
      }
      const failures = matching.filter(({ value }) => compareReadingValue(value, standard.operator, standard.threshold));

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

    if (assessedStandards === standards.length || failedStandardsForStop.size) {
      group.performance.assessedStops += 1;
      assessedStopIds.add(stopKey);
    }
    if (failedStandardsForStop.size) {
      group.performance.failingStopIds.add(stopKey);
      overallFailingStopIds.add(stopKey);
    }
  });

  const totalCompanyFailingStops = overallFailingStopIds.size;

  const resultGroups = [...groups.values()]
    .map((group) => {
      const companyUser = performanceView === "users"
        ? resolveCompanyUserForReportGroup(group, companyUsers)
        : null;
      const performance = group.performance || {
        assessedStops: 0,
        totalStops: 0,
        failingStopIds: new Set(),
        totalFailingReadings: 0,
        assignedRssTechs: new Set(),
        standards: makeStandardSummaries(),
        detailRows: [],
      };
      const failingStops = performance.failingStopIds.size;
      const successfulStops = Math.max(performance.assessedStops - failingStops, 0);
      const failRate = percentString(failingStops, performance.assessedStops);
      const successRate = percentString(successfulStops, performance.assessedStops);
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
        const standardSuccessfulStops = Math.max((summary?.assessedStops || 0) - standardFailingStops, 0);
        return {
          id: `${group.id}-${standard.id}`,
          standard: standard.rule,
          successfulStops: standardSuccessfulStops,
          successRate: percentString(standardSuccessfulStops, summary?.assessedStops || 0),
          failingStops: standardFailingStops,
          failingRate: percentString(standardFailingStops, summary?.assessedStops || 0),
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
      const customerReferences = customerReferencesForPerformanceRows(detailRows);

      return {
        id: group.id,
        name: group.name,
        reportSubjectType: performanceView === "users" ? "companyUser" : "customer",
        companyUserId: companyUser?.id || "",
        technicianUserId: companyUser?.userId || group.id || "",
        technicianName: companyUser ? companyUserDisplayName(companyUser) : group.name,
        sortFailRate: performance.assessedStops ? failingStops / performance.assessedStops : 0,
        sortFailingStops: failingStops,
        sortSuccessRate: performance.assessedStops ? successfulStops / performance.assessedStops : 0,
        sortSuccessfulStops: successfulStops,
        summary: {
          id: group.id,
          user: group.name,
          customer: group.name,
          serviceStops: performance.totalStops,
          unassessedStops: performance.totalStops - performance.assessedStops,
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
          "Unassessed Stops": performance.totalStops - performance.assessedStops,
          "Successful Stops": `${successfulStops.toLocaleString()} (${successRate})`,
          "Not Good Standing": `${failingStops.toLocaleString()} (${failRate})`,
          "Company Failing Share": percentString(failingStops, totalCompanyFailingStops),
          ...(performanceView === "customers" ? { "Assigned RSS Techs": assignedRssTechs } : {}),
          "Failing Readings": performance.totalFailingReadings,
        },
        rows: mode === "summary" ? [anyStandardRow, ...standardRows] : detailRows,
        customerReferences,
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
  const totalServicedGroupCount = resultGroups.filter((group) => group.summary.serviceStops > group.summary.unassessedStops).length;
  const successfulGroupCount = Math.max(totalServicedGroupCount - failedGroupCount, 0);
  const standardSummaryRows = [...overallStandardSummaries.values()]
    .sort((a, b) => b.failingStops - a.failingStops || a.standard.localeCompare(b.standard))
    .map((summary) => ({
      id: summary.id,
      standard: summary.standard,
      successfulStops: Math.max(summary.assessedStops - summary.failingStops, 0),
      companySuccessRate: percentString(Math.max(summary.assessedStops - summary.failingStops, 0), summary.assessedStops),
      failingStops: summary.failingStops,
      companyFailingRate: percentString(summary.failingStops, summary.assessedStops),
      failingReadings: summary.failingReadings,
      latestFail: summary.latestFail || "-",
      lastCustomer: summary.lastCustomer || "-",
      lastValue: summary.lastValue || "-",
    }));
  const summaryEntityKey = performanceView === "customers" ? "customer" : "user";
  const summaryEntityLabel = performanceView === "customers" ? "Customer" : "User";
  const summaryFailingRateKey = performanceView === "customers" ? "customerFailingRate" : "userFailingRate";
  const summarySuccessRateKey = performanceView === "customers" ? "customerSuccessRate" : "userSuccessRate";
  const summaryColumns = [
    { key: summaryEntityKey, label: summaryEntityLabel },
    { key: "serviceStops", label: "Service Stops", align: "right" },
    { key: "unassessedStops", label: "Unassessed Stops", align: "right" },
    { key: "successfulStops", label: "Successful Stops", align: "right" },
    { key: summarySuccessRateKey, label: "Success Rate", align: "right" },
    { key: "failingStops", label: "Failing Stops", align: "right" },
    { key: summaryFailingRateKey, label: "Fail Rate", align: "right" },
    ...(performanceView === "customers" ? [{ key: "companyFailingShare", label: "% of Company Fails", align: "right" }] : []),
    { key: "failingReadings", label: "Failing Readings", align: "right" },
    ...(performanceView === "customers" ? [{ key: "assignedRssTechs", label: "Assigned RSS Techs" }] : []),
    { key: "latestFail", label: "Latest Fail" },
  ];
  const baseTitle = performanceView === "customers" ? "Reading Performance by Customer Report" : "Reading Performance by User Report";
  const titleDateRange = displayDateRangeFromValues(dateRangeStart, dateRangeEnd);
  const totalSuccessfulStops = Math.max(assessedStopIds.size - overallFailingStopIds.size, 0);

  return {
    reportType: "readingPerformance",
    performanceView,
    title: [baseTitle, titleDateRange].filter(Boolean).join(" "),
    stats: [
      numberMetric("Service Stops", stopData.length),
      numberMetric("Unassessed Stops", stopData.length - assessedStopIds.size),
      ...(performanceView === "customers"
        ? [
          {
            label: "Successful Customers",
            value: `${successfulGroupCount.toLocaleString()} of ${totalServicedGroupCount.toLocaleString()}`,
            subtitle: `${percentString(successfulGroupCount, totalServicedGroupCount)} of serviced customers`,
          },
          {
            label: "Failed Customers",
            value: `${failedGroupCount.toLocaleString()} of ${totalServicedGroupCount.toLocaleString()}`,
            subtitle: `${percentString(failedGroupCount, totalServicedGroupCount)} of serviced customers`,
          },
        ]
        : []),
      numberMetric("Successful Stops", totalSuccessfulStops),
      {
        label: "Success Rate",
        value: percentString(totalSuccessfulStops, assessedStopIds.size),
        subtitle: "100% - fail rate",
      },
      numberMetric("Not Good Standing", overallFailingStopIds.size),
      percentageMetric("Not Good Standing %", overallFailingStopIds.size, assessedStopIds.size),
      numberMetric("Failing Readings", totalFailingReadings),
      {
        label: "Standards",
        value: standards.length.toLocaleString(),
        subtitle: worstStandard && worstStandard.failingStops > 0
          ? `Highest: ${worstStandard.standard} (${percentString(worstStandard.failingStops, worstStandard.assessedStops)})`
          : "No failing standards found",
      },
    ],
    columns: mode === "summary"
      ? [
        { key: "standard", label: "Standard" },
        { key: "successfulStops", label: "Successful Stops", align: "right" },
        { key: "successRate", label: "Success Rate", align: "right" },
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
  const overall = { visits: 0, dosages: 0 };
  const units = new Map();

  stopData.forEach((stop) => {
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    if (!dosages.length && mode === "summary") return;

    const group = ensureGroup(groups, groupKey(stop, groupBy));
    addMetric(group, "visits", 1);
    addMetric(group, "dosages", dosages.length);
    overall.visits += 1;
    overall.dosages += dosages.length;

    dosages.forEach((dosage) => {
      const template = dosageTemplateFor(dosage, dosageTemplatesById) || {};
      const unit = reportItemUnit(dosage, template);
      units.set(unit, (units.get(unit) || 0) + toNumber(dosage.amount ?? dosage.value ?? dosage.quantity));
    });
    if (mode === "summary") {
      dosages.forEach((dosage) => {
        const name = templateName(dosage, dosageTemplatesById, "Dosage");
        const amount = toNumber(dosage.amount ?? dosage.value ?? dosage.quantity);
        const unit = reportItemUnit(dosage, dosageTemplateFor(dosage, dosageTemplatesById) || {});
        const row = group.rows.find((item) => item.name === name && item.unit === unit);
        if (row) {
          row.count += 1;
          row.amount += amount;
        } else {
          group.rows.push({ name, unit, count: 1, amount });
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
      ...[...units.entries()].map(([unit, amount]) => numberMetric(`Total ${unit || "unlabeled units"}`, amount, unit ? ` ${unit}` : "")),
    ],
    columns: mode === "summary"
      ? [
        { key: "name", label: "Dosage" },
        { key: "unit", label: "Unit" },
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
    const quantity = toNumber(item.quantity ?? item.quantityString ?? 1);
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

const buildPayrollReport = ({ payrollLines, mode, groupBy }) => {
  const activeLines = payrollLines.filter((line) => !isPayrollLineVoided(line));
  const categoryTotals = {
    paid: { amountCents: 0, count: 0 },
    approved: { amountCents: 0, count: 0 },
    unapproved: { amountCents: 0, count: 0 },
  };
  const groups = new Map();

  activeLines.forEach((line) => {
    const amountCents = payrollLineCents(line);
    const category = payrollStatusCategory(line);
    const group = ensureGroup(groups, groupKey({
      ...line,
      userId: payrollLineWorkerId(line),
      userName: payrollLineWorkerName(line),
    }, groupBy));

    categoryTotals[category].amountCents += amountCents;
    categoryTotals[category].count += 1;
    addMetric(group, `${category}Cents`, amountCents);
    addMetric(group, `${category}Count`, 1);
    addMetric(group, "totalCents", amountCents);
    addMetric(group, "totalCount", 1);

    if (mode === "summary") return;

    const completedDate = itemDate(line, ["completedDate", "createdAt", "paidAt"]);
    group.rows.push({
      id: line.id,
      sortCategory: payrollCategoryOrder.indexOf(category),
      sortTime: completedDate?.getTime() || 0,
      date: shortDate(completedDate),
      paidDate: shortDate(line.paidAt),
      category: payrollCategoryLabel(category),
      worker: payrollLineWorkerName(line),
      customer: line.customerName || line.customerId || "-",
      title: payrollLineDisplayTitle(line),
      status: line.calculationStatus || "-",
      amountCents,
      paymentReference: line.paymentReference || line.externalReferenceId || "-",
    });
  });

  const categorySummaryRows = payrollCategoryOrder
    .filter((category) => category !== "predicted")
    .map((category) => ({
      id: category,
      category: payrollCategoryLabel(category),
      lines: categoryTotals[category].count,
      amountCents: categoryTotals[category].amountCents,
    }));
  const totalCents = categorySummaryRows.reduce((total, row) => total + row.amountCents, 0);
  const totalLines = categorySummaryRows.reduce((total, row) => total + row.lines, 0);
  const recentlyPaidRows = activeLines
    .filter(isPayrollLinePaid)
    .sort((left, right) => (dateFromValue(right.paidAt)?.getTime() || 0) - (dateFromValue(left.paidAt)?.getTime() || 0))
    .slice(0, 10)
    .map((line) => ({
      id: line.id,
      paidDate: shortDate(line.paidAt),
      completedDate: shortDate(firstPresent(line.completedDate, line.createdAt)),
      worker: payrollLineWorkerName(line),
      customer: line.customerName || line.customerId || "-",
      title: payrollLineDisplayTitle(line),
      amountCents: payrollLineCents(line),
      paymentReference: line.paymentReference || line.externalReferenceId || "-",
    }));

  const resultGroups = [...groups.values()]
    .map((group) => {
      const rows = mode === "summary"
        ? payrollCategoryOrder
          .filter((category) => category !== "predicted")
          .map((category) => ({
            id: `${group.id}-${category}`,
            category: payrollCategoryLabel(category),
            lines: group.metrics[`${category}Count`] || 0,
            amountCents: group.metrics[`${category}Cents`] || 0,
          }))
        : [...group.rows]
          .sort((a, b) => a.sortCategory - b.sortCategory || b.sortTime - a.sortTime)
          .map(({ sortCategory, sortTime, ...row }) => row);

      return {
        ...group,
        metrics: {
          Total: moneyFromCents(group.metrics.totalCents || 0),
          Lines: group.metrics.totalCount || 0,
          Paid: moneyFromCents(group.metrics.paidCents || 0),
          "Approved Unpaid": moneyFromCents(group.metrics.approvedCents || 0),
          Unapproved: moneyFromCents(group.metrics.unapprovedCents || 0),
        },
        rows,
        footerRow: mode === "summary"
          ? {
            category: "Total",
            lines: group.metrics.totalCount || 0,
            amountCents: group.metrics.totalCents || 0,
          }
          : {
            date: "Total",
            paidDate: "",
            category: "",
            worker: "",
            customer: "",
            title: "",
            status: "",
            amountCents: group.metrics.totalCents || 0,
            paymentReference: "",
          },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    title: "Payroll Report",
    stats: [
      numberMetric("Needs Review", activeLines.filter((line) => reportStatusKey(line.calculationStatus) === "needsreview").length),
      moneyMetric("Total Payroll", totalCents),
      moneyMetric("Paid", categoryTotals.paid.amountCents),
      moneyMetric("Approved Unpaid", categoryTotals.approved.amountCents),
      moneyMetric("Unapproved", categoryTotals.unapproved.amountCents),
      numberMetric("Payroll Lines", totalLines),
    ],
    columns: mode === "summary"
      ? [
        { key: "category", label: "Category" },
        { key: "lines", label: "Lines", align: "right" },
        { key: "amountCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.amountCents) },
      ]
      : [
        { key: "date", label: "Completed" },
        { key: "paidDate", label: "Paid" },
        { key: "category", label: "Category" },
        { key: "worker", label: "User" },
        { key: "customer", label: "Customer" },
        { key: "title", label: "Work" },
        { key: "status", label: "Status" },
        { key: "amountCents", label: "Amount", align: "right", render: (row) => moneyFromCents(row.amountCents) },
        { key: "paymentReference", label: "Payment Ref" },
      ],
    summarySections: [
      {
        title: "Payroll Categories",
        columns: [
          { key: "category", label: "Category" },
          { key: "lines", label: "Lines", align: "right" },
          { key: "amountCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.amountCents) },
        ],
        rows: categorySummaryRows,
      },
      {
        title: "Recently Paid",
        columns: [
          { key: "paidDate", label: "Paid" },
          { key: "completedDate", label: "Completed" },
          { key: "worker", label: "User" },
          { key: "customer", label: "Customer" },
          { key: "title", label: "Work" },
          { key: "amountCents", label: "Amount", align: "right", render: (row) => moneyFromCents(row.amountCents) },
          { key: "paymentReference", label: "Payment Ref" },
        ],
        rows: recentlyPaidRows,
      },
    ],
    total: {
      label: "Total Payroll",
      value: moneyFromCents(totalCents),
      subtitle: `${totalLines.toLocaleString()} line(s) in period`,
    },
    groups: resultGroups,
  };
};

const buildFuturePayrollReport = ({
  companyId = "",
  bodiesOfWater = [],
  payrollLines = [],
  allPayrollLines = payrollLines,
  serviceStops = [],
  paySettings = null,
  companyUsers = [],
  companyServiceStopTypes = [],
  companyWorkTypes = [],
  workTypeMappings = [],
  technicianRates = [],
  serviceStopTasksById = new Map(),
  mode,
  groupBy,
}) => {
  const activeLines = payrollLines.filter((line) => !isPayrollLineVoided(line));
  const unpaidLines = activeLines.filter((line) => !isPayrollLinePaid(line));
  const payrollServiceStopIds = new Set(
    allPayrollLines.filter((line) => !isPayrollLineVoided(line))
      .map((line) => firstPresent(line.serviceStopId, line.serviceStopID, line.stopId))
      .filter(Boolean)
      .map(String)
  );
  const serviceStopTypesById = new Map();
  const serviceStopTypesByName = new Map();
  const idValue = (value) => {
    if (!value) return "";
    if (typeof value === "object") {
      return String(value.id || value.value || value.docId || value.internalId || "").trim();
    }
    return String(value).trim();
  };
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

  const serviceStopWorkerName = (serviceStop = {}) =>
    serviceStop.tech || serviceStop.techName || serviceStop.technicianName || serviceStop.userName || "Unassigned";

  const groups = new Map();
  const totals = {
    approved: { amountCents: 0, count: 0 },
    unapproved: { amountCents: 0, count: 0 },
    predicted: { amountCents: 0, count: 0 },
  };

  const addFutureRow = ({
    category,
    amountCents,
    lineCount = 1,
    groupRecord,
    detailRow,
  }) => {
    const group = ensureGroup(groups, groupKey(groupRecord, groupBy));
    totals[category].amountCents += amountCents;
    totals[category].count += lineCount;
    addMetric(group, `${category}Cents`, amountCents);
    addMetric(group, `${category}Count`, lineCount);
    addMetric(group, "totalCents", amountCents);
    addMetric(group, "totalCount", lineCount);
    if (mode === "detail") group.rows.push(detailRow);
  };

  unpaidLines.forEach((line) => {
    const category = isPayrollLineApproved(line) ? "approved" : "unapproved";
    const amountCents = payrollLineCents(line);
    const completedDate = itemDate(line, ["completedDate", "createdAt"]);
    addFutureRow({
      category,
      amountCents,
      groupRecord: {
        ...line,
        userId: payrollLineWorkerId(line),
        userName: payrollLineWorkerName(line),
      },
      detailRow: {
        id: line.id,
        sortCategory: payrollCategoryOrder.indexOf(category),
        sortTime: completedDate?.getTime() || 0,
        date: shortDate(completedDate),
        category: payrollCategoryLabel(category),
        source: "Payroll Line",
        worker: payrollLineWorkerName(line),
        customer: line.customerName || line.customerId || "-",
        title: payrollLineDisplayTitle(line),
        status: line.calculationStatus || "-",
        amountCents,
        notes: line.payStatementId ? "Attached to statement" : "",
      },
    });
  });

  serviceStops.forEach((serviceStop, serviceStopIndex) => {
    const serviceStopId = String(serviceStop.id || serviceStop.serviceStopId || "");
    if (serviceStopId && payrollServiceStopIds.has(serviceStopId)) return;
    if (serviceStop.completed === true || serviceStop.isFinished === true || serviceStop.endTime || serviceStop.completedAt || serviceStop.finishedAt ||
      ["finished", "complete", "completed", "skipped", "canceled", "cancelled"].includes(reportStatusKey(serviceStop.operationStatus || serviceStop.status))) return;

    const estimatedPay = estimateServiceStopPaySummary({
      companyId,
      bodiesOfWater,
      settings: paySettings,
      serviceStop,
      serviceStopType: serviceStopTypeFor(serviceStop),
      serviceStopUseCaseSourceId: serviceStopUseCaseSourceId(serviceStop),
      tasks: tasksForServiceStop(serviceStop),
      worker: companyUserForServiceStop(serviceStop),
      workTypes: companyWorkTypes,
      mappings: workTypeMappings,
      rates: technicianRates,
      date: dateFromValue(firstPresent(serviceStop.serviceDate, serviceStop.date, serviceStop.createdAt)) || new Date(),
    });
    const estimateLines = estimatedPay.lines;
    if (!estimateLines.length) return;

    const workerId = firstPresent(serviceStop.techId, serviceStop.userId, serviceStop.technicianId, serviceStop.workerId, "unassigned");
    const workerName = serviceStopWorkerName(serviceStop);
    const serviceDate = itemDate(serviceStop, ["serviceDate", "date", "createdAt"]);
    estimateLines.forEach((line, lineIndex) => {
      const amountCents = payrollLineCents(line);
      addFutureRow({
        category: "predicted",
        amountCents,
        groupRecord: {
          ...serviceStop,
          userId: workerId,
          userName: workerName,
          customerId: serviceStop.customerId,
          customerName: serviceStop.customerName,
        },
        detailRow: {
          id: `${serviceStopId || `service-stop-${serviceStopIndex}`}-${line.id || lineIndex}`,
          sortCategory: payrollCategoryOrder.indexOf("predicted"),
          sortTime: serviceDate?.getTime() || 0,
          date: shortDate(serviceDate),
          category: payrollCategoryLabel("predicted"),
          source: "Scheduled Stop Estimate",
          worker: workerName,
          customer: serviceStop.customerName || serviceStop.customerId || "-",
          title: [
            line.title || line.workTypeName || serviceStop.type || serviceStop.serviceStopTypeName || "Service Stop Pay",
            line.workTypeName && line.title !== line.workTypeName ? line.workTypeName : "",
          ].filter(Boolean).join(" | "),
          status: line.calculationStatus || "calculated",
          amountCents,
          notes: line.notes || "",
        },
      });
    });
  });

  const totalCents = totals.approved.amountCents + totals.unapproved.amountCents + totals.predicted.amountCents;
  const totalLines = totals.approved.count + totals.unapproved.count + totals.predicted.count;
  const categorySummaryRows = ["approved", "unapproved", "predicted"].map((category) => ({
    id: category,
    category: payrollCategoryLabel(category),
    lines: totals[category].count,
    amountCents: totals[category].amountCents,
  }));

  const resultGroups = [...groups.values()]
    .map((group) => {
      const rows = mode === "summary"
        ? ["approved", "unapproved", "predicted"].map((category) => ({
          id: `${group.id}-${category}`,
          category: payrollCategoryLabel(category),
          lines: group.metrics[`${category}Count`] || 0,
          amountCents: group.metrics[`${category}Cents`] || 0,
        }))
        : [...group.rows]
          .sort((a, b) => a.sortCategory - b.sortCategory || b.sortTime - a.sortTime)
          .map(({ sortCategory, sortTime, ...row }) => row);

      return {
        ...group,
        metrics: {
          Total: moneyFromCents(group.metrics.totalCents || 0),
          Lines: group.metrics.totalCount || 0,
          "Approved Unpaid": moneyFromCents(group.metrics.approvedCents || 0),
          Unapproved: moneyFromCents(group.metrics.unapprovedCents || 0),
          Predicted: moneyFromCents(group.metrics.predictedCents || 0),
        },
        rows,
        footerRow: mode === "summary"
          ? {
            category: "Total",
            lines: group.metrics.totalCount || 0,
            amountCents: group.metrics.totalCents || 0,
          }
          : {
            date: "Total",
            category: "",
            source: "",
            worker: "",
            customer: "",
            title: "",
            status: "",
            amountCents: group.metrics.totalCents || 0,
            notes: "",
          },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    title: "Future Payroll Report",
    stats: [
      numberMetric("Needs Review", [...groups.values()].flatMap((group) => group.rows).filter((row) => reportStatusKey(row.status) === "needsreview").length),
      moneyMetric("Future Payroll", totalCents),
      moneyMetric("Approved Unpaid", totals.approved.amountCents),
      moneyMetric("Unapproved", totals.unapproved.amountCents),
      moneyMetric("Predicted", totals.predicted.amountCents),
      numberMetric("Lines", totalLines),
    ],
    columns: mode === "summary"
      ? [
        { key: "category", label: "Category" },
        { key: "lines", label: "Lines", align: "right" },
        { key: "amountCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.amountCents) },
      ]
      : [
        { key: "date", label: "Date" },
        { key: "category", label: "Category" },
        { key: "source", label: "Source" },
        { key: "worker", label: "User" },
        { key: "customer", label: "Customer" },
        { key: "title", label: "Work" },
        { key: "status", label: "Status" },
        { key: "amountCents", label: "Amount", align: "right", render: (row) => moneyFromCents(row.amountCents) },
        { key: "notes", label: "Notes" },
      ],
    summarySections: [
      {
        title: "Future Payroll Categories",
        columns: [
          { key: "category", label: "Category" },
          { key: "lines", label: "Lines", align: "right" },
          { key: "amountCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.amountCents) },
        ],
        rows: categorySummaryRows,
      },
    ],
    total: {
      label: "Future Payroll",
      value: moneyFromCents(totalCents),
      subtitle: `${totalLines.toLocaleString()} unpaid or predicted line(s)`,
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
  payrollLines.filter((line) => !isPayrollLineVoided(line)).forEach((line) => {
    userRow(line.technicianId || line.userId || line.techId, line.technicianName || line.userName || line.techName).payrollCents += payrollLineCents(line);
  });

  return {
    title: "Users Report",
    stats: [
      numberMetric("Users", groups.size),
      numberMetric("Service Stops", serviceStops.length),
      moneyMetric("Payroll", payrollLines.filter((line) => !isPayrollLineVoided(line)).reduce((total, line) => total + payrollLineCents(line), 0)),
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

const normalizePipelineChecklist = (checklist = {}, rowData = {}) => {
  const mergedChecklist = { ...(checklist || {}) };
  Object.entries(rowData || {}).forEach(([key, value]) => {
    if (!key.startsWith("checklist.")) return;
    const stageId = key.slice("checklist.".length);
    if (stageId && !Object.prototype.hasOwnProperty.call(mergedChecklist, stageId)) {
      mergedChecklist[stageId] = value;
    }
  });

  return Object.fromEntries(
    Object.entries(mergedChecklist).map(([key, value]) => [
      key,
      {
        complete: !!(value?.complete || value?.isComplete),
        completedAt: value?.completedAt || value?.dateCompleted || null,
        completedByName: value?.completedByName || value?.completedByUserName || "",
      },
    ])
  );
};

const pipelineRowName = (row = {}) => (
  row.customerName ||
  row.homeownerName ||
  row.name ||
  row.contactName ||
  row.customerId ||
  row.leadId ||
  "Unnamed pipeline"
);

const pipelineRowSource = (row = {}) => (
  row.leadSource ||
  row.marketingSource ||
  row.sourceLabel ||
  row.source ||
  "Unknown"
);

const pipelineStatus = (row = {}) => {
  const raw = reportStatusKey(row.pipelineStatus || row.lifecycleStatus || row.status || row.leadStatus || "");
  const safeRaw = raw.replace(/[\s-]+/g, "_");
  if (["fired", "fired_us", "customer_fired", "terminated", "churned"].includes(raw) || row.firedUs === true) return "Fired";
  if (["inactive", "ended_inactive", "customer_inactive"].includes(safeRaw) || row.inactiveAt) return "Inactive";
  if (["lost", "cancelled", "canceled"].includes(raw)) return "Lost";
  if (["one_off", "oneoff", "hired_one_off", "hired_for_one_off", "won_one_off"].includes(safeRaw) || row.hiredForOneOff === true) return "Hired for one off";
  if (["complete", "completed", "done"].includes(raw)) return "Complete";
  return "Active";
};

const pipelineStageAppliesToRow = (row = {}, stage = {}) => {
  const customerId = row.customerId || row.companyCustomerId || "";
  const leadId = row.leadId || row.sourceHomeownerServiceRequestId || "";
  if (stage.linkType === "lead" && customerId && !leadId) return false;
  return true;
};

const pipelineStageIsComplete = (row = {}, stage = {}) => {
  const checklist = normalizePipelineChecklist(row.checklist, row);
  if (checklist[stage.id]?.complete) return true;
  if (stage.linkType === "lead") return Boolean(row.leadId || row.sourceHomeownerServiceRequestId);
  if (stage.linkType === "customer") return Boolean(row.customerId || row.companyCustomerId);
  if (stage.linkType === "initialEstimate") return Boolean(row.estimateId || row.serviceEstimateServiceStopId || row.initialEstimateServiceStopId);
  if (stage.linkType === "serviceAgreement") return Boolean(row.agreementId || row.serviceAgreementId);
  if (stage.linkType === "routing") return Boolean(row.recurringServiceStopId || row.routeId);
  if (stage.linkType === "equipment") return Array.isArray(row.equipmentIds) && row.equipmentIds.length > 0;
  if (stage.linkType === "locationPhotos") return Number(row.locationPhotoCount || 0) > 0;
  return false;
};

const buildCustomerPipelineReport = ({ pipelineRows = [], pipelineItems = [], mode }) => {
  const activeItems = pipelineItems
    .filter((item) => item.active !== false)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.title || left.name || "").localeCompare(String(right.title || right.name || "")));
  const stages = activeItems.length
    ? activeItems
    : [
      { id: "default_lead", title: "Lead", linkType: "lead" },
      { id: "default_customer", title: "Customer", linkType: "customer" },
      { id: "default_initial_estimate", title: "Initial Estimate", linkType: "initialEstimate" },
      { id: "default_service_agreement", title: "Service Agreement", linkType: "serviceAgreement" },
      { id: "default_routing", title: "Routing", linkType: "routing" },
    ];

  const rows = pipelineRows.map((row) => {
    const applicableStages = stages.filter((stage) => pipelineStageAppliesToRow(row, stage));
    const completedStages = applicableStages.filter((stage) => pipelineStageIsComplete(row, stage));
    const nextOpenStage = applicableStages.find((stage) => !pipelineStageIsComplete(row, stage));
    const totalStages = applicableStages.length;
    const status = pipelineStatus(row);
    const ended = ["Complete", "Hired for one off", "Lost", "Fired"].includes(status);
    const completedCount = ended ? totalStages : completedStages.length;
    const percent = totalStages ? Math.round((completedCount / totalStages) * 100) : ended ? 100 : 0;

    return {
      id: row.id,
      name: pipelineRowName(row),
      source: pipelineRowSource(row),
      leadStatus: row.leadStatus || row.status || "-",
      pipelineStatus: status,
      completed: completedCount,
      total: totalStages,
      percent,
      nextOpenStage: status === "Lost" ? "Lost / cancelled" : status === "Fired" ? "Fired us" : status === "Hired for one off" ? "Hired for one off" : nextOpenStage?.title || "Complete",
      lostReason: row.firedReason || row.customerFiredReason || row.lostReason || row.cancelReason || row.statusChangeReason || "",
      customerId: row.customerId || row.companyCustomerId || "",
      leadId: row.leadId || row.sourceHomeownerServiceRequestId || "",
      notes: row.notes || "",
      createdAt: row.createdAt || row.dateCreated || null,
      updatedAt: row.updatedAt || null,
      stageDetail: stages.map((stage) => (
        `${stage.title}: ${pipelineStageAppliesToRow(row, stage) ? (pipelineStageIsComplete(row, stage) ? "Complete" : "Open") : "Optional"}`
      )).join(" | "),
    };
  }).sort((left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name));

  const sourceGroups = new Map();
  rows.forEach((row) => {
    if (!sourceGroups.has(row.source)) {
      sourceGroups.set(row.source, {
        source: row.source,
        total: 0,
        active: 0,
        won: 0,
        oneOff: 0,
        lost: 0,
        fired: 0,
        totalPercent: 0,
      });
    }
    const group = sourceGroups.get(row.source);
    group.total += 1;
    group.totalPercent += row.percent;
    if (row.pipelineStatus === "Lost") group.lost += 1;
    else if (row.pipelineStatus === "Fired") group.fired += 1;
    else if (row.pipelineStatus === "Inactive") group.fired += 1;
    else if (row.pipelineStatus === "Hired for one off") {
      group.oneOff += 1;
      group.won += 1;
    }
    else if (row.customerId || row.pipelineStatus === "Complete") group.won += 1;
    else group.active += 1;
  });

  const sourceRows = [...sourceGroups.values()]
    .map((group) => ({
      ...group,
      winRate: group.total ? `${((group.won / group.total) * 100).toFixed(1)}%` : "0.0%",
      lossRate: group.total ? `${(((group.lost + group.fired) / group.total) * 100).toFixed(1)}%` : "0.0%",
      averageCompletion: group.total ? `${(group.totalPercent / group.total).toFixed(1)}%` : "0.0%",
    }))
    .sort((left, right) => right.total - left.total || left.source.localeCompare(right.source));

  const displayRows = mode === "detail"
    ? rows
    : rows.filter((row) => row.pipelineStatus !== "Complete" && row.pipelineStatus !== "Hired for one off" && row.pipelineStatus !== "Lost" && row.pipelineStatus !== "Fired" && row.pipelineStatus !== "Inactive");

  return {
    title: "Pipeline Report",
    stats: [
      numberMetric("Pipeline Rows", rows.length),
      numberMetric("Active", rows.filter((row) => row.pipelineStatus === "Active").length),
      numberMetric("Won / Customer", rows.filter((row) => (
        row.pipelineStatus !== "Lost" &&
        row.pipelineStatus !== "Fired" &&
        row.pipelineStatus !== "Inactive" &&
        (row.customerId || row.pipelineStatus === "Complete")
      )).length),
      numberMetric("Hired One Off", rows.filter((row) => row.pipelineStatus === "Hired for one off").length),
      numberMetric("Lost", rows.filter((row) => row.pipelineStatus === "Lost").length),
      numberMetric("Fired", rows.filter((row) => row.pipelineStatus === "Fired").length),
      numberMetric("Inactive", rows.filter((row) => row.pipelineStatus === "Inactive").length),
    ],
    columns: [
      { key: "name", label: "Lead / Customer" },
      { key: "source", label: "Source" },
      { key: "leadStatus", label: "Lead Status" },
      { key: "pipelineStatus", label: "Pipeline Status" },
      { key: "percent", label: "Complete", align: "right", render: (row) => `${row.percent}%` },
      { key: "nextOpenStage", label: "Next Open Stage" },
      { key: "lostReason", label: "Lost / Fired Reason" },
      { key: "notes", label: "Notes" },
      ...(mode === "detail" ? [{ key: "stageDetail", label: "Stage Detail" }] : []),
    ],
    summarySections: [
      {
        title: "Source Performance",
        columns: [
          { key: "source", label: "Source" },
          { key: "total", label: "Total", align: "right" },
          { key: "active", label: "Active", align: "right" },
          { key: "won", label: "Won", align: "right" },
          { key: "oneOff", label: "One Off", align: "right" },
          { key: "lost", label: "Lost", align: "right" },
          { key: "fired", label: "Fired", align: "right" },
          { key: "winRate", label: "Win Rate", align: "right" },
          { key: "lossRate", label: "Loss Rate", align: "right" },
          { key: "averageCompletion", label: "Avg Completion", align: "right" },
        ],
        rows: sourceRows,
      },
    ],
    groups: [{
      id: "pipeline",
      name: mode === "detail" ? "All Pipeline Rows" : "Unfinished Pipeline Rows",
      rows: displayRows,
    }],
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
  recurringServiceStops = [],
  bodiesOfWater = [],
  customersById = new Map(),
  purchases = [],
  databaseItemById = new Map(),
  mode,
  dateRangeStart,
  dateRangeEnd,
}) => {
  let missingChemicalCosts = 0;
  let missingLaborCosts = 0;
  const serviceLocationsById = new Map();
  const bodiesById = new Map(bodiesOfWater.map((body) => [body.id, body]));
  const bodiesByLocationId = new Map();
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const serviceStopsById = new Map();
  const recurringStopsById = new Map();
  const stopDataByServiceStopId = new Map();
  const pools = new Map();
  const actualPayServiceStopIds = new Set();
  const serviceStopTypesById = new Map();
  const serviceStopTypesByName = new Map();
  const recurringServiceStopIds = new Set();
  const agreementLocationAuditRows = [];

  const idValue = (value) => {
    if (!value) return "";
    if (typeof value === "object") {
      return String(value.id || value.value || value.docId || value.internalId || "").trim();
    }
    return String(value).trim();
  };
  const keyValue = (value) => idValue(value).toLowerCase();
  const compareRowsByNetDescending = (left, right) => (
    right.netCents - left.netCents ||
    left.customer.localeCompare(right.customer) ||
    left.serviceLocation.localeCompare(right.serviceLocation) ||
    left.pool.localeCompare(right.pool)
  );
  const compareRowsByNetAscending = (left, right) => (
    left.netCents - right.netCents ||
    left.customer.localeCompare(right.customer) ||
    left.serviceLocation.localeCompare(right.serviceLocation) ||
    left.pool.localeCompare(right.pool)
  );
  const recurringIdsForRecord = (record = {}) => normalizeIdList(
    record.recurringServiceStopId,
    record.recurringStopId,
    record.rssId,
    reportStatusKey(record.sourceType) === "recurringservice" ? record.sourceId : ""
  );
  const isRecurringServiceRecord = (record = {}, linkedServiceStop = {}) => (
    serviceStopIsRecurringRoute(record) ||
    serviceStopIsRecurringRoute(linkedServiceStop) ||
    reportStatusKey(record.sourceType) === "recurringservice" ||
    reportStatusKey(linkedServiceStop.sourceType) === "recurringservice" ||
    [...recurringIdsForRecord(record), ...recurringIdsForRecord(linkedServiceStop)]
      .some((recurringId) => recurringServiceStopIds.has(recurringId))
  );

  serviceLocations.forEach((location) => {
    ["id", "serviceLocationId", "locationId", "internalId"].forEach((field) => {
      const value = idValue(location?.[field]);
      if (value) serviceLocationsById.set(value, location);
    });
  });

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

  recurringServiceStops.forEach((recurringStop) => {
    indexByIds(recurringStopsById, recurringStop, ["id", "recurringServiceStopId", "rssId", "internalId"]);
    normalizeIdList(recurringStop.id, recurringStop.recurringServiceStopId, recurringStop.rssId, recurringStop.internalId)
      .forEach((recurringId) => recurringServiceStopIds.add(recurringId));
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

  const bodyOfWaterName = (body = {}) =>
    body.name ||
    body.nickName ||
    body.label ||
    body.bodyOfWaterName ||
    "";

  const poolNamesForLocation = (serviceLocationId, fallbackBody = {}) => {
    const bodies = serviceLocationId ? bodiesByLocationId.get(serviceLocationId) || [] : [];
    const names = bodies.map(bodyOfWaterName).filter(Boolean);
    if (!names.length && bodyOfWaterName(fallbackBody)) names.push(bodyOfWaterName(fallbackBody));
    return Array.from(new Set(names)).join(", ");
  };

  const serviceLocationSnapshotId = (snapshot = {}) => idValue(firstPresent(
    snapshot.id,
    snapshot.serviceLocationId,
    snapshot.companyServiceLocationId,
    snapshot.locationId
  ));

  const serviceLocationSnapshotLabel = (snapshot = {}) => [
    snapshot.nickName || snapshot.name || snapshot.label,
    snapshot.streetAddress || snapshot.address?.streetAddress,
    snapshot.city || snapshot.address?.city,
    snapshot.state || snapshot.address?.state,
    snapshot.zip || snapshot.address?.zip,
  ].filter(Boolean).join(" | ");

  const serviceLocationSnapshotsForAgreement = (agreement = {}) => (
    Array.isArray(agreement.serviceLocationSnapshots) ? agreement.serviceLocationSnapshots : []
  );

  const serviceLocationSnapshotForId = (agreement = {}, serviceLocationId = "") => (
    serviceLocationSnapshotsForAgreement(agreement).find((snapshot) => serviceLocationSnapshotId(snapshot) === idValue(serviceLocationId)) || {}
  );

  const serviceLocationDescriptor = ({ bodyOfWaterId = "", serviceLocationId = "", serviceLocationSnapshot = {}, customerId = "", customerName = "" } = {}) => {
    const body = bodyOfWaterId ? bodiesById.get(bodyOfWaterId) || {} : {};
    const resolvedServiceLocationId = serviceLocationId || body.serviceLocationId || "";
    const location = resolvedServiceLocationId
      ? serviceLocationsById.get(resolvedServiceLocationId) || serviceLocationSnapshot || {}
      : serviceLocationSnapshot || {};
    const resolvedCustomerId = customerId || location.customerId || location.companyCustomerId || body.customerId || "no-customer";
    const resolvedCustomerName = customerNameFor(resolvedCustomerId, customerName || body.customerName || location.customerName);
    const locationName = resolvedServiceLocationId && serviceLocationsById.has(resolvedServiceLocationId)
      ? serviceLocationName(location)
      : serviceLocationSnapshotLabel(location);
    const poolName = poolNamesForLocation(resolvedServiceLocationId, body) || "-";
    const id = resolvedServiceLocationId
      ? `location:${resolvedServiceLocationId}`
      : `customer:${resolvedCustomerId || "unknown"}`;

    return {
      id,
      customerId: resolvedCustomerId,
      customerName: resolvedCustomerName,
      serviceLocationId: resolvedServiceLocationId,
      serviceLocation: locationName || location.nickName || location.name || "Unassigned Service Location",
      bodyOfWaterId: body.id || "",
      pool: poolName,
    };
  };

  const serviceLocationDescriptorsForLocation = (serviceLocationId, fallback = {}) => {
    return [
      serviceLocationDescriptor({
        serviceLocationId,
        serviceLocationSnapshot: fallback.serviceLocationSnapshot,
        customerId: fallback.customerId,
        customerName: fallback.customerName,
      }),
    ];
  };

  const fallbackPoolDescriptorsForCustomer = (customerId, customerName) => {
    const locations = serviceLocations.filter((location) => location.customerId === customerId && location.active !== false && location.isActive !== false);
    if (!locations.length) return [serviceLocationDescriptor({ customerId, customerName })];
    return locations.flatMap((location) => serviceLocationDescriptorsForLocation(location.id, { customerId, customerName }));
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

  const addChemicalRevenue = (descriptor, amountCents, agreement, row = {}) => {
    const amount = Math.round(Number(amountCents || 0));
    if (!amount) return;
    const pool = ensurePool(descriptor);
    pool.revenueCents += amount;
    if (agreement?.id) pool.agreementIds.add(agreement.id);
    addDetail(descriptor, {
      ...row,
      type: row.type || "Chemical Revenue",
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
        serviceLocationDescriptor({
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
          serviceLocationDescriptor({
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
      return serviceLocationDescriptorsForLocation(serviceLocationId, {
        customerId: fallback.customerId || serviceStop.customerId,
        customerName: fallback.customerName || serviceStop.customerName,
      });
    }

    return [
      serviceLocationDescriptor({
        customerId: fallback.customerId || serviceStop.customerId,
        customerName: fallback.customerName || serviceStop.customerName,
      }),
    ];
  };

  const linkedServiceStopIdsForAgreement = (agreement = {}) => normalizeIdList(
    agreement.serviceStopId,
    agreement.serviceStopIds,
    agreement.inspectionServiceStopId,
    agreement.serviceAgreementEstimateServiceStopId,
    agreement.estimateServiceStopId,
    agreement.sourceId,
    ...(Array.isArray(agreement.lineItems)
      ? agreement.lineItems.flatMap((item) => [
        item.serviceStopId,
        item.serviceStopIds,
        item.metadata?.serviceStopId,
        item.metadata?.inspectionServiceStopId,
      ])
      : [])
  );

  const linkedRecurringStopIdsForAgreement = (agreement = {}) => normalizeIdList(
    agreement.recurringServiceStopId,
    agreement.recurringStopId,
    agreement.rssId,
    agreement.sourceId,
    ...(Array.isArray(agreement.lineItems)
      ? agreement.lineItems.flatMap((item) => [
        item.recurringServiceStopId,
        item.recurringStopId,
        item.rssId,
        item.metadata?.recurringServiceStopId,
        item.metadata?.recurringStopId,
        item.metadata?.rssId,
      ])
      : [])
  );

  const serviceLocationResolutionForAgreement = (agreement = {}) => {
    const explicitIds = agreementServiceLocationIds(agreement);
    if (explicitIds.length) {
      return {
        ids: explicitIds,
        source: "Agreement serviceLocationIds / snapshots",
        inferred: false,
      };
    }

    const serviceStopIds = linkedServiceStopIdsForAgreement(agreement);
    const serviceStopLocationIds = normalizeIdList(
      ...serviceStopIds.flatMap((serviceStopId) => {
        const serviceStop = serviceStopsById.get(serviceStopId) || {};
        return [serviceStop.serviceLocationId, serviceStop.locationId, serviceStop.companyServiceLocationId];
      })
    );
    if (serviceStopLocationIds.length) {
      return {
        ids: serviceStopLocationIds,
        source: "Linked service stop",
        inferred: true,
      };
    }

    const recurringStopIds = linkedRecurringStopIdsForAgreement(agreement);
    const recurringLocationIds = normalizeIdList(
      ...recurringStopIds.flatMap((recurringStopId) => {
        const recurringStop = recurringStopsById.get(recurringStopId) || {};
        return [recurringStop.serviceLocationId, recurringStop.locationId, recurringStop.companyServiceLocationId];
      })
    );
    if (recurringLocationIds.length) {
      return {
        ids: recurringLocationIds,
        source: "Linked recurring service stop",
        inferred: true,
      };
    }

    return {
      ids: [],
      source: "Customer fallback",
      inferred: true,
    };
  };

  const auditAgreementLocationResolution = (agreement = {}, resolution = {}) => {
    const missingLocationIds = (resolution.ids || []).filter((serviceLocationId) => !serviceLocationsById.has(serviceLocationId));
    if (!resolution.inferred && !missingLocationIds.length) return;

    agreementLocationAuditRows.push({
      id: agreement.id || `agreement-${agreementLocationAuditRows.length}`,
      agreement: agreement.title || agreement.id || "Service Agreement",
      customer: agreement.customerName || customerNameFor(agreement.customerId),
      resolution: resolution.source,
      serviceLocations: (resolution.ids || []).length
        ? resolution.ids.map((serviceLocationId) => {
          const location = serviceLocationsById.get(serviceLocationId) || serviceLocationSnapshotForId(agreement, serviceLocationId) || {};
          return serviceLocationName(location) || serviceLocationSnapshotLabel(location) || serviceLocationId;
        }).join(", ")
        : "No specific service location id",
      issue: missingLocationIds.length
        ? `Location id not found in loaded service locations: ${missingLocationIds.join(", ")}`
        : "No direct serviceLocationIds on agreement",
    });
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

    const locationResolution = serviceLocationResolutionForAgreement(agreement);
    auditAgreementLocationResolution(agreement, locationResolution);
    const descriptors = locationResolution.ids.length
      ? locationResolution.ids.flatMap((serviceLocationId) =>
        serviceLocationDescriptorsForLocation(serviceLocationId, {
          customerId: agreement.customerId,
          customerName: agreement.customerName,
          serviceLocationSnapshot: serviceLocationSnapshotForId(agreement, serviceLocationId),
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
    if (!isRecurringServiceRecord(stop, serviceStop)) return;

    const descriptor = serviceLocationDescriptor({
      bodyOfWaterId: stop.bodyOfWaterId || serviceStop.bodyOfWaterId,
      serviceLocationId: stop.serviceLocationId || serviceStop.serviceLocationId,
      customerId: stop.customerId || serviceStop.customerId,
      customerName: stop.customerName || serviceStop.customerName,
    });
    const pool = ensurePool(descriptor);
    pool.visitIds.add(String(stop.serviceStopId || stop.id || `${descriptor.id}-${index}`));

    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    const detailPoolName =
      bodyOfWaterName(bodiesById.get(stop.bodyOfWaterId || serviceStop.bodyOfWaterId)) ||
      stop.bodyOfWaterName ||
      serviceStop.bodyOfWaterName ||
      descriptor.pool;
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
      const billing = costAgreement
        ? classifyAgreementChemicalBilling({ agreement: costAgreement, record: costRecord, linkedRecord: template })
        : null;
      const dateInfo = normalizeDetailDate(stop.date);
      const dosageName = dosage.name || template.name || template.chemType || "Dosage";
      const dosageValue = valueWithUnit(dosage);

      if (billing?.billSeparately) {
        const chemicalRevenueCents = dosageChemicalRevenueCents(dosage, template);
        if (chemicalRevenueCents) {
          addChemicalRevenue(descriptor, chemicalRevenueCents, costAgreement, {
            ...dateInfo,
            pool: detailPoolName,
            source: [
              dosageName,
              dosageValue,
              "separately billed",
            ].filter(Boolean).join(" | "),
          });
        }
      }

      if (shouldExcludePnlChemicalCost({ agreement: costAgreement, record: costRecord, linkedRecord: template })) return;

      const costEstimate = dosageChemicalCostEstimate({
        dosage,
        template,
        purchases,
        databaseItemById,
      });
      const chemicalCostCents = costEstimate.totalCostCents;
      if (!costEstimate.source && dosageAmountForCost(dosage) > 0) missingChemicalCosts += 1;

      if (!chemicalCostCents) return;

      addChemical(descriptor, chemicalCostCents, {
        ...dateInfo,
        pool: detailPoolName,
        source: [
          dosageName,
          dosageValue,
          costEstimate.source
            ? `${costEstimate.source} @ ${moneyFromCents(costEstimate.unitCostCents)}/${unitLabel(reportItemUnit(dosage, template)) || "unit"}`
            : "",
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
    if (!isRecurringServiceRecord(line, serviceStop)) return;

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
    if (!isRecurringServiceRecord(serviceStop)) return;

    const estimatedPay = estimateServiceStopPaySummary({
      companyId,
      bodiesOfWater,
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
    if (estimatedPay.needsReview || (!estimatedPay.lines.length && serviceStop.payrollMode !== "unpaid" && (!paySettings || !Object.keys(paySettings).length || paySettings.payrollEnabled === false || paySettings.companyPayrollEnabled === false || paySettings.payrollDisabled === true))) missingLaborCosts += 1;
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
    .sort(compareRowsByNetDescending);

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
    { key: "pool", label: "Pools" },
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
    { key: "pool", label: "Pool" },
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
      sortNetCents: groupTotals.netCents,
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
  }).sort((left, right) => right.sortNetCents - left.sortNetCents || left.name.localeCompare(right.name));

  const detailGroups = poolRows.map((row) => ({
    id: row.id,
    name: `${row.customer} | ${row.serviceLocation}`,
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
    .sort(compareRowsByNetAscending)
    .slice(0, 20);

  return {
    title: "PNL Per Service Location Report",
    warnings: [
      ...(missingChemicalCosts ? [`${missingChemicalCosts} recorded chemical dosage(s) have no usable cost. These costs are omitted from estimated margin.`] : []),
      ...(missingLaborCosts ? [`${missingLaborCosts} service stop(s) need payroll setup or rate review. Estimated labor costs may be incomplete.`] : []),
    ],
    stats: [
      numberMetric("Service Locations", poolRows.length),
      moneyMetric("Agreement Revenue", totals.revenueCents),
      moneyMetric("Direct Costs", totals.costCents),
      moneyMetric("Net", totals.netCents),
      numberMetric("Visits", totals.visits),
    ],
    columns: mode === "detail" ? detailColumns : summaryColumns,
    summarySections: [
      ...(agreementLocationAuditRows.length
        ? [{
          title: "Agreement Location Check",
          columns: [
            { key: "agreement", label: "Agreement" },
            { key: "customer", label: "Customer" },
            { key: "resolution", label: "Resolution" },
            { key: "serviceLocations", label: "Service Locations" },
            { key: "issue", label: "Issue" },
          ],
          rows: agreementLocationAuditRows,
        }]
        : []),
      {
        title: "Rate Watchlist",
        columns: [
          { key: "customer", label: "Customer" },
          { key: "serviceLocation", label: "Service Location" },
          { key: "pool", label: "Pools" },
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
      label: "Company Service Location Net",
      value: moneyFromCents(totals.netCents),
      subtitle: `${poolRows.length.toLocaleString()} service location(s) | ${totals.visits.toLocaleString()} visit(s)`,
    },
    groups: mode === "detail" ? detailGroups : customerGroups,
  };
};

const buildPnlReport = ({ jobs, purchases, payrollLines, salesInvoices = [], serviceAgreements = [], databaseItemById = new Map(), groupBy, dateRangeStart, dateRangeEnd }) => {
  const groups = new Map();
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    addMetric(group, "revenueCents", jobRevenueCents(job));
    addMetric(group, "jobLaborCents", payrollLines.some((line) => !isPayrollLineVoided(line) && reportJobId(line) === job.id) ? 0 : jobLaborCostCents(job));
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
    if (jobs.some((job) => reportJobId(invoice) === job.id || job.salesInvoiceId === invoice.id)) return;
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
  payrollLines.filter((line) => !isPayrollLineVoided(line)).forEach((line) => {
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

const reportJobId = (record = {}) => record.jobId || record.workOrderId || record.assignedJobId || "";

const buildJobReport = ({ jobs, purchases, payrollLines, groupBy }) => {
  const purchaseByJob = new Map();
  purchases.forEach((purchase) => {
    if (reportJobId(purchase)) purchaseByJob.set(reportJobId(purchase), (purchaseByJob.get(reportJobId(purchase)) || 0) + purchaseTotalCents(purchase));
  });
  const payrollByJob = new Map();
  payrollLines.filter((line) => !isPayrollLineVoided(line)).forEach((line) => {
    if (reportJobId(line)) payrollByJob.set(reportJobId(line), (payrollByJob.get(reportJobId(line)) || 0) + payrollLineCents(line));
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
      moneyMetric("Known Costs", [...groups.values()].flatMap((group) => group.rows).reduce((total, row) => total + row.costCents + row.payrollCents, 0)),
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

const routeDistanceMiles = (route = {}) => {
  const recorded = route.distanceMiles ?? route.distance;
  if (recorded !== undefined && recorded !== null) return toNumber(recorded);
  const start = route.startMileage ?? route.startMilage;
  const end = route.endMileage ?? route.endMilage;
  return start != null && end != null ? Math.max(0, toNumber(end) - toNumber(start)) : 0;
};

const buildVehicleReport = ({ vehicles, activeRoutes, mode }) => {
  const routesByVehicle = new Map();
  activeRoutes.forEach((route) => {
    const vehicleId = route.vehicalId || route.vehicleId || "unassigned";
    if (!routesByVehicle.has(vehicleId)) routesByVehicle.set(vehicleId, []);
    routesByVehicle.get(vehicleId).push(route);
  });

  const knownIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const allVehicles = [...vehicles, ...[...routesByVehicle.keys()].filter((id) => !knownIds.has(id)).map((id) => ({ id, nickName: id === "unassigned" ? "Unassigned vehicle" : `Unknown vehicle (${id})` }))];
  const groups = allVehicles.map((vehicle) => {
    const routes = routesByVehicle.get(vehicle.id) || [];
    const distance = routes.reduce((total, route) => total + routeDistanceMiles(route), 0);
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
          distance: routeDistanceMiles(route),
        })),
    };
  });

  return {
    title: "Vehicle Report",
    stats: [
      numberMetric("Vehicles", vehicles.length),
      numberMetric("Routes", activeRoutes.length),
      numberMetric("Route Miles", activeRoutes.reduce((total, route) => total + routeDistanceMiles(route), 0).toFixed(1)),
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

const buildTaxReport = ({ purchases, jobs = [], salesInvoices = [], groupBy }) => {
  const groups = new Map();
  purchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    const preTaxCents = purchasePreTaxCents(purchase);
    const afterTaxCents = purchaseTotalCents(purchase);
    const taxCents = Math.max(0, afterTaxCents - preTaxCents);
    addMetric(group, "purchaseTaxCents", taxCents);
    addMetric(group, "purchasePreTaxCents", preTaxCents);
  });
  salesInvoices.filter(invoiceRevenueStatusCounts).forEach((invoice) => {
    const group = ensureGroup(groups, groupKey(invoice, groupBy));
    addMetric(group, "revenueCents", cents(invoice.totalAmountCents ?? invoice.totalCents));
    addMetric(group, "revenueTaxCents", cents(invoice.taxAmountCents ?? invoice.taxCents ?? invoice.invoiceTaxCents));
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


export { dateInputValue, dateRangeFromDates, displayDateInputValue, displayDateRange, displayDateRangeFromValues, dateRangePresets, defaultDateRange, sanitizeDateRange, readingOperatorOptions, moneyFromCents, dateFromValue, shortDate, toNumber, cents, templateMap, templateName, valueWithUnit, reportItemUnit, formatDecimal, customerDisplayName, customerContactInfo, readingTemplateKey, readingTemplateLabel, sortReadingTemplates, hasNumericValue, defaultReadingHealthFilterFor, readingPerformanceStandardKey, withReadingPerformanceStandardId, defaultReadingPerformanceStandardsFor, parseReadingNumber, compareReadingValue, readingOperatorLabel, percentString, percentageMetric, readingMatchesTemplate, activeReadingPerformanceStandards, itemDate, inRange, groupKey, normalizeLookupValue, companyUserDisplayName, companyUserLookupValues, resolveCompanyUserForReportGroup, workerDisplayName, serviceWorkerDisplayName, assignedRssWorkerName, ensureGroup, addMetric, moneyMetric, numberMetric, purchaseTotalCents, purchasePreTaxCents, normalizePurchaseCategory, purchaseCategory, normalizeIdList, purchaseDatabaseItem, purchaseDatabaseItemId, dosageTemplateFor, dosageLinkedItemIds, normalizeUnit, inferPackageUnit, unitLabels, unitLabel, parseFirstNumber, volumeToGallons, weightToPounds, resolveUnitFamily, convertAmount, formatQuantity, databaseItemDisplayName, packageQuantityInfo, purchaseQuantity, jobRevenueCents, jobLaborCostCents, payrollLineCents, isPayrollLinePaid, isPayrollLineApproved, isPayrollLineVoided, payrollStatusCategory, payrollCategoryLabels, payrollCategoryOrder, payrollCategoryLabel, payrollLineWorkerId, payrollLineWorkerName, payrollLineDisplayTitle, firstPresent, moneyNumber, centsField, dollarFieldToCents, reportStatusKey, isInactiveAgreementStatus, pnlChemicalCostModes, positiveCentsField, positiveDollarFieldToCents, databaseItemPackageCostCents, linkedItemSetForDosage, linkedPurchaseUnitCostEstimate, linkedCatalogUnitCostEstimate, dosageTemplateUnitCostEstimate, dosageAmountForCost, dosageChemicalCostEstimate, dosageTemplateUnitPriceCents, dosageChemicalRevenueCents, activeRangeOverlapDays, billingIntervalDays, agreementAmountCents, isRecurringPnlAgreement, agreementRevenueCentsForRange, agreementServiceLocationIds, truthyReportFlag, reportTermList, recordIdCandidates, recordSearchText, customerPurchasedCostRecord, likelyChemicalCostRecord, agreementChemicalCostMode, chemicalCostMatchesAgreementTerms, agreementAppliesToRecord, agreementActiveForDate, agreementForPnlCost, shouldExcludePnlChemicalCost, invoiceRevenueStatusCounts, invoiceLineAmountCents, explicitlySeparateChemicalInvoiceLine, invoiceChemicalRevenueCentsForPnl, addressLine, serviceLocationName, targetRateCentsFor, marginString, normalizeDetailDate, buildReadingReport, createDailyRangeAccumulator, addDailyRangeValue, serializeDailyRangeSummary, buildFunReadingsDosagesReport, buildReadingHealthReport, buildReadingPerformanceReport, buildChemicalReport, buildPurchaseReport, buildWasteReport, buildPayrollReport, buildFuturePayrollReport, buildUsersReport, normalizePipelineChecklist, pipelineRowName, pipelineRowSource, pipelineStatus, pipelineStageAppliesToRow, pipelineStageIsComplete, buildCustomerPipelineReport, buildPnlPerPoolReport, buildPnlReport, buildJobReport, buildVehicleReport, buildTaxReport };

const customerReferencesForPerformanceRows = (rows = []) => {
  const references = new Map();

  rows.forEach((row) => {
    const customerId = String(row.customerId || "").trim();
    if (!customerId || customerId === "no-customer") return;

    const current = references.get(customerId) || {
      customerId,
      customerName: row.customer || "",
      serviceLocationId: "",
      bodyOfWaterId: "",
      bodyOfWaterName: "",
      rows: [],
    };

    const serviceLocationId = String(row.serviceLocationId || "").trim();
    const bodyOfWaterId = String(row.bodyOfWaterId || "").trim();

    references.set(customerId, {
      ...current,
      customerName: current.customerName || row.customer || "",
      serviceLocationId: current.serviceLocationId || serviceLocationId,
      bodyOfWaterId: current.bodyOfWaterId || bodyOfWaterId,
      bodyOfWaterName: current.bodyOfWaterName || row.pool || "",
      rows: [...current.rows, row],
    });
  });

  return [...references.values()];
};

