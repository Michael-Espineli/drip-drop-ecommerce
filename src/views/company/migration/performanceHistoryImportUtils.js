export const TARGET_PERFORMANCE_IMPORT_COMPANY_ID = "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e";
export const MURDOCK_POOL_SERVICE_ONLY_LABEL = "Murdock Pool Service Only";

export const SKIP_TECHNICIAN_VALUE = "__skip_technician__";

export const PERFORMANCE_HISTORY_IMPORT_COLUMNS = [
  "Import Enabled",
  "Import Key",
  "Company ID",
  "Source Technician",
  "Suggested Technician",
  "Record Type",
  "Date",
  "Original Date Text",
  "Title",
  "Note",
  "Visible To Technician",
  "Source Kind",
  "Source File",
  "Source Sheet",
  "Source Row",
  "Source Table",
  "Reference Customer",
  "Reference Job Description",
  "Signer",
  "Confidence",
  "Parse Notes",
];

const allowedRecordTypes = new Set(["kudo", "complaint", "coaching", "observation"]);

export const cleanString = (value) => (
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
);

export const normalizeText = (value) => (
  cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
);

export const parseBoolean = (value, defaultValue = false) => {
  if (typeof value === "boolean") return value;
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return defaultValue;
  if (["true", "yes", "y", "1", "enabled", "import"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "disabled", "skip"].includes(normalized)) return false;
  return defaultValue;
};

export const normalizeRecordType = (value) => {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "praise" || normalized === "positive") return "kudo";
  if (normalized === "issue" || normalized === "complaints") return "complaint";
  if (normalized === "training") return "coaching";
  return allowedRecordTypes.has(normalized) ? normalized : "observation";
};

export const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86400000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = cleanString(value);
  if (!normalized || ["na", "n/a", "none", "-", "false"].includes(normalized.toLowerCase())) return null;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateLabel = (value) => {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No date";
};

export const getCompanyUserDisplayName = (companyUser = {}) => (
  cleanString(
    companyUser.userName ||
    companyUser.displayName ||
    [companyUser.firstName, companyUser.lastName].filter(Boolean).join(" ") ||
    companyUser.name ||
    companyUser.email ||
    companyUser.userId ||
    companyUser.id
  ) || "Unnamed company user"
);

export const getTechnicianGroupKey = (record = {}) => (
  [record.sourceTechnician || "Unknown Technician", record.suggestedTechnician || ""].join("||")
);

export const parsePerformanceHistoryRows = (rows = []) => {
  const issues = [];
  const skippedRows = [];
  const records = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const note = cleanString(row.Note);
    const title = cleanString(row.Title);
    const sourceTechnician = cleanString(row["Source Technician"]);
    const suggestedTechnician = cleanString(row["Suggested Technician"] || sourceTechnician);
    const importKey = cleanString(row["Import Key"] || `performance_row_${rowNumber}`);
    const companyId = cleanString(row["Company ID"]);

    if (!note && !title && !sourceTechnician) return;

    if (!sourceTechnician && !suggestedTechnician) {
      skippedRows.push({ rowNumber, reason: "Missing Source Technician/Suggested Technician" });
      return;
    }

    if (!note && !title) {
      skippedRows.push({ rowNumber, reason: "Missing note/title" });
      return;
    }

    if (companyId && companyId !== TARGET_PERFORMANCE_IMPORT_COMPANY_ID) {
      issues.push(`Row ${rowNumber} is for company ${companyId}, not ${TARGET_PERFORMANCE_IMPORT_COMPANY_ID}.`);
    }

    records.push({
      id: importKey,
      importKey,
      rowNumber,
      importEnabled: parseBoolean(row["Import Enabled"], true),
      companyId,
      sourceTechnician: sourceTechnician || suggestedTechnician || "Unknown Technician",
      suggestedTechnician: suggestedTechnician || sourceTechnician || "Unknown Technician",
      recordType: normalizeRecordType(row["Record Type"]),
      date: parseDateValue(row.Date),
      originalDateText: cleanString(row["Original Date Text"]),
      title: title || "Performance history import",
      note,
      visibleToTechnician: parseBoolean(row["Visible To Technician"], false),
      sourceKind: cleanString(row["Source Kind"]),
      sourceFile: cleanString(row["Source File"]),
      sourceSheet: cleanString(row["Source Sheet"]),
      sourceRow: cleanString(row["Source Row"]),
      sourceTable: cleanString(row["Source Table"]),
      referenceCustomer: cleanString(row["Reference Customer"]),
      referenceJobDescription: cleanString(row["Reference Job Description"]),
      signer: cleanString(row.Signer),
      confidence: cleanString(row.Confidence || "medium"),
      parseNotes: cleanString(row["Parse Notes"]),
    });
  });

  return { records, issues, skippedRows };
};

export const buildTechnicianGroups = (records = [], mappings = {}) => {
  const groupsByKey = new Map();

  records.forEach((record) => {
    const key = getTechnicianGroupKey(record);
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, {
        key,
        sourceTechnician: record.sourceTechnician,
        suggestedTechnician: record.suggestedTechnician,
        records: [],
      });
    }

    groupsByKey.get(key).records.push(record);
  });

  return Array.from(groupsByKey.values())
    .map((group) => {
      const mappingValue = mappings[group.key] || "";
      const enabledRecords = group.records.filter((record) => record.importEnabled);

      return {
        ...group,
        mappingValue,
        totalRecords: group.records.length,
        enabledRecords: enabledRecords.length,
        disabledRecords: group.records.length - enabledRecords.length,
        readyRecords: mappingValue && mappingValue !== SKIP_TECHNICIAN_VALUE ? enabledRecords.length : 0,
        isSkipped: mappingValue === SKIP_TECHNICIAN_VALUE,
        needsMapping: Boolean(enabledRecords.length) && !mappingValue,
      };
    })
    .sort((left, right) => left.suggestedTechnician.localeCompare(right.suggestedTechnician));
};

export const buildAutoTechnicianMappings = (records = [], companyUsers = []) => {
  const mappings = {};
  const groups = buildTechnicianGroups(records, {});
  const userMatches = companyUsers.map((companyUser) => {
    const displayName = getCompanyUserDisplayName(companyUser);
    const normalizedName = normalizeText(displayName);
    const normalizedEmail = normalizeText(companyUser.email);

    return {
      companyUser,
      displayName,
      searchKeys: [normalizedName, normalizedEmail, normalizeText(companyUser.userId), normalizeText(companyUser.id)].filter(Boolean),
    };
  });

  groups.forEach((group) => {
    const sourceKey = normalizeText(group.sourceTechnician);
    const suggestedKey = normalizeText(group.suggestedTechnician);
    const match = userMatches.find((candidate) => (
      candidate.searchKeys.some((key) => key && (key === suggestedKey || key === sourceKey || suggestedKey.includes(key) || key.includes(suggestedKey)))
    ));

    if (match?.companyUser?.id) {
      mappings[group.key] = match.companyUser.id;
    }
  });

  return mappings;
};

export const summarizePerformanceHistoryRecords = (records = [], technicianGroups = []) => {
  const enabledRows = records.filter((record) => record.importEnabled).length;
  const disabledRows = records.length - enabledRows;
  const mappedRows = technicianGroups.reduce((total, group) => total + group.readyRecords, 0);
  const skippedRows = technicianGroups
    .filter((group) => group.isSkipped)
    .reduce((total, group) => total + group.enabledRecords, 0);
  const needsMappedRows = technicianGroups
    .filter((group) => group.needsMapping)
    .reduce((total, group) => total + group.enabledRecords, 0);

  return {
    rows: records.length,
    enabledRows,
    disabledRows,
    mappedRows,
    skippedRows,
    needsMappedRows,
    technicianGroups: technicianGroups.length,
  };
};
