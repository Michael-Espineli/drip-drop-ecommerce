import {
  cleanString,
  hashString,
  normalizeText,
  stableMigrationId,
  toOptionalNumber,
} from "./customerExportImportUtils";

export const EQUIPMENT_IMPORT_REQUIRED_COLUMNS = [
  "Customer",
  "Street Address",
  "Type",
];

export const EQUIPMENT_IMPORT_OPTIONAL_COLUMNS = [
  "Scheduled",
  "BOW",
  "Make",
  "Model",
  "Install Date",
  "Has Service",
  "Frequency",
  "Last Serviced",
  "Next Service",
  "Status",
  "Last Audit",
  "Notes",
  "In Skimmer",
  "Date Removed",
  "Life Time (Years)",
  "Tech",
  "Day",
  "Repair History",
];

const columnAliases = {
  scheduled: ["Scheduled"],
  customerName: ["Customer", "Customer Name", "Client", "Client Name"],
  streetAddress: ["Street Address", "Address", "Service Address", "Location Address"],
  type: ["Type", "Equipment Type", "Category"],
  bodyOfWaterName: ["BOW", "Body of Water", "Pool", "Pool Name"],
  make: ["Make", "Manufacturer"],
  model: ["Model", "Equipment Model"],
  installDate: ["Install Date", "Installed Date", "Date Installed"],
  hasService: ["Has Service", "Needs Service", "Maintenance Required"],
  frequency: ["Frequency", "Service Frequency", "Service Every"],
  lastServiceDate: ["Last Serviced", "Last Service", "Last Service Date"],
  nextServiceDate: ["Next Service", "Next Service Date"],
  overdue: ["Over Due", "Overdue"],
  status: ["Status", "Equipment Status"],
  lastAudit: ["Last Audit", "Audit Date"],
  notes: ["Notes", "Equipment Notes"],
  inSkimmer: ["In Skimmer", "Skimmer"],
  dateRemoved: ["Date Removed", "Removed Date"],
  lifetimeYears: ["Life Time (Years)", "Lifetime Years", "Life Time"],
  techName: ["Tech", "Technician"],
  routeDay: ["Day", "Route Day"],
  repairHistory: ["Repair History", "Repairs"],
  name: ["Equipment Name", "Name", "Nickname", "Equipment Nickname"],
  cleanFilterPressure: ["Clean Filter Pressure", "Clean PSI", "Filter Pressure"],
  currentPressure: ["Current Pressure", "Current PSI"],
};

const statusLabels = {
  operational: "Operational",
  needsRepair: "Needs Repair",
  nonOperational: "Non-Operational",
  needsMaintenance: "Needs Maintenance",
  replaced: "Replaced",
};

const equipmentTypeLabels = {
  pump: "Pump",
  filter: "Filter",
  heater: "Heater",
  saltCell: "Salt Cell",
  light: "Light",
  cleaner: "Cleaner",
  controlSystem: "Control System",
  autoChlorinator: "Auto Chlorinator",
};

const equipmentTypeAliases = [
  { label: equipmentTypeLabels.pump, keys: ["pump", "motor", "boosterpump", "variablepump", "vsp"] },
  { label: equipmentTypeLabels.filter, keys: ["filter", "cartridgefilter", "sandfilter", "defilter"] },
  { label: equipmentTypeLabels.heater, keys: ["heater", "heatpump", "gasheater"] },
  { label: equipmentTypeLabels.saltCell, keys: ["saltcell", "salt", "swg", "chlorinegenerator"] },
  { label: equipmentTypeLabels.light, keys: ["light", "poollight", "spalight"] },
  { label: equipmentTypeLabels.cleaner, keys: ["cleaner", "sweep", "robot", "roboticcleaner"] },
  { label: equipmentTypeLabels.controlSystem, keys: ["controlsystem", "automation", "controller", "panel"] },
  { label: equipmentTypeLabels.autoChlorinator, keys: ["autochlorinator", "chlorinator", "feeder", "tabfeeder"] },
];

const frequencyUnits = {
  day: "Day",
  days: "Day",
  week: "Week",
  weeks: "Week",
  month: "Month",
  months: "Month",
  year: "Year",
  years: "Year",
};

const normalizeHeader = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases) => {
  const normalizedAliases = aliases.map(normalizeHeader);
  const match = Object.entries(row).find(([key]) => normalizedAliases.includes(normalizeHeader(key)));
  return match ? match[1] : "";
};

const firstNonEmpty = (...values) => values.map(cleanString).find(Boolean) || "";

const compact = (items = []) => items.map(cleanString).filter(Boolean);

const uniqueText = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeText(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const toBoolean = (value) => {
  if (value === true) return true;
  if (value === false) return false;

  const text = cleanString(value).toLowerCase();
  if (!text) return false;

  return ["true", "yes", "y", "1", "x", "scheduled"].includes(text);
};

const normalizeEquipmentType = (value) => {
  const text = cleanString(value);
  const key = normalizeText(text);
  if (!key) return "";

  const aliasMatch = equipmentTypeAliases.find((alias) =>
    alias.keys.some((aliasKey) => key.includes(aliasKey))
  );

  return aliasMatch?.label || text;
};

const excelDateToLocalDate = (serialValue) => {
  const wholeDays = Math.floor(Number(serialValue));
  const fractionalDay = Number(serialValue) - wholeDays;
  const date = new Date(1899, 11, 30);
  date.setDate(date.getDate() + wholeDays);

  if (fractionalDay > 0) {
    const seconds = Math.round(fractionalDay * 24 * 60 * 60);
    date.setSeconds(date.getSeconds() + seconds);
  }

  return date;
};

export const toDisplayDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "number" && Number.isFinite(value)) return excelDateToLocalDate(value);

  const text = cleanString(value);
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const parsedSerial = excelDateToLocalDate(Number(text));
    return Number.isNaN(parsedSerial.getTime()) ? null : parsedSerial;
  }

  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
  if (slashDate) {
    const [, month, day, rawYear] = slashDate;
    let year = Number(rawYear);
    if (year < 100) year += 2000;
    const date = new Date(year, Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dashDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashDate) {
    const [, year, month, day] = dashDate;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateLabel = (value) => {
  const date = toDisplayDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const dateKey = (value) => {
  const date = toDisplayDate(value);
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const parseFrequencyNumber = (value) => {
  const numericValue = toOptionalNumber(value);
  if (numericValue !== "") return Number(numericValue);

  const text = cleanString(value);
  const match = text.match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
};

const parseFrequencyUnit = (value) => {
  const text = cleanString(value).toLowerCase();
  const unitMatch = Object.keys(frequencyUnits).find((unit) => text.includes(unit));
  return frequencyUnits[unitMatch] || "Month";
};

const normalizeStatus = ({ status, dateRemoved, overdue }) => {
  const statusKey = normalizeText(status);
  if (dateRemoved) return statusLabels.replaced;
  if (toBoolean(overdue)) return statusLabels.needsMaintenance;
  if (!statusKey) return "";
  if (statusKey.includes("repair")) return statusLabels.needsRepair;
  if (statusKey.includes("maintenance") || statusKey.includes("service")) return statusLabels.needsMaintenance;
  if (statusKey.includes("non") || statusKey.includes("down")) return statusLabels.nonOperational;
  if (statusKey.includes("removed") || statusKey.includes("replaced")) return statusLabels.replaced;
  if (statusKey.includes("operational") || statusKey.includes("active")) return statusLabels.operational;
  return cleanString(status);
};

const statusIsInactive = (status) => {
  const statusKey = normalizeText(status);
  return statusKey === normalizeText(statusLabels.nonOperational) || statusKey === normalizeText(statusLabels.replaced);
};

const buildSourceNotes = (record) =>
  [
    record.notes ? `Source notes: ${record.notes}` : "",
    record.techName ? `Tech: ${record.techName}` : "",
    record.routeDay ? `Route day: ${record.routeDay}` : "",
    record.repairHistory ? `Repair history: ${record.repairHistory}` : "",
    record.lastAudit ? `Last audit: ${formatDateLabel(record.lastAudit)}` : "",
    record.dateRemoved ? `Date removed: ${formatDateLabel(record.dateRemoved)}` : "",
    record.lifetimeYears !== "" ? `Life time years: ${record.lifetimeYears}` : "",
  ].filter(Boolean).join("\n");

const mergeNotes = (existingNotes, sourceNotes) => {
  const existing = cleanString(existingNotes);
  const source = cleanString(sourceNotes);
  if (!existing) return source;
  if (!source || normalizeText(existing).includes(normalizeText(source))) return existing;
  return `${existing}\n${source}`;
};

export const parseEquipmentImportRows = (rows = []) => {
  const records = [];
  const issues = [];
  const skippedRows = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 3;
    const customerName = cleanString(getRowValue(row, columnAliases.customerName));
    const streetAddress = cleanString(getRowValue(row, columnAliases.streetAddress)).replace(/,\s*$/, "");
    const type = normalizeEquipmentType(getRowValue(row, columnAliases.type));
    const make = cleanString(getRowValue(row, columnAliases.make));
    const model = cleanString(getRowValue(row, columnAliases.model));
    const bodyOfWaterName = cleanString(getRowValue(row, columnAliases.bodyOfWaterName));
    const hasAnyValue = Object.values(row).some((value) => cleanString(value));

    if (!hasAnyValue) return;

    const missingRequired = [
      !customerName ? "Customer" : "",
      !streetAddress ? "Street Address" : "",
      !type ? "Type" : "",
    ].filter(Boolean);

    if (missingRequired.length) {
      const reason = `Missing ${missingRequired.join(", ")}.`;
      issues.push(`Row ${rowNumber}: ${reason}`);
      skippedRows.push({
        id: `equipment_import_skip_${rowNumber}_${hashString(reason)}`,
        rowNumber,
        customerName: customerName || "-",
        streetAddress: streetAddress || "-",
        type: type || "-",
        reason,
      });
      return;
    }

    const installDate = toDisplayDate(getRowValue(row, columnAliases.installDate));
    const lastServiceDate = toDisplayDate(getRowValue(row, columnAliases.lastServiceDate));
    const nextServiceDate = toDisplayDate(getRowValue(row, columnAliases.nextServiceDate));
    const lastAudit = toDisplayDate(getRowValue(row, columnAliases.lastAudit));
    const dateRemoved = toDisplayDate(getRowValue(row, columnAliases.dateRemoved));
    const frequencyRaw = getRowValue(row, columnAliases.frequency);
    const frequency = parseFrequencyNumber(frequencyRaw);
    const frequencyUnit = parseFrequencyUnit(frequencyRaw);
    const status = normalizeStatus({
      status: getRowValue(row, columnAliases.status),
      dateRemoved,
      overdue: getRowValue(row, columnAliases.overdue),
    });
    const notes = cleanString(getRowValue(row, columnAliases.notes));
    const techName = cleanString(getRowValue(row, columnAliases.techName));
    const routeDay = cleanString(getRowValue(row, columnAliases.routeDay));
    const repairHistory = cleanString(getRowValue(row, columnAliases.repairHistory));
    const equipmentName = firstNonEmpty(
      getRowValue(row, columnAliases.name),
      compact([type, make, model]).join(" - "),
      type
    );
    const sourceEquipmentKey = [
      customerName,
      streetAddress,
      bodyOfWaterName,
      type,
      make,
      model,
      dateKey(installDate),
      rowNumber,
    ].join("|");

    records.push({
      id: stableMigrationId("com_equ", sourceEquipmentKey),
      rowNumber,
      sourceEquipmentKey,
      scheduled: toBoolean(getRowValue(row, columnAliases.scheduled)),
      customerName,
      streetAddress,
      type,
      bodyOfWaterName,
      make,
      model,
      name: equipmentName,
      installDate,
      hasService: toBoolean(getRowValue(row, columnAliases.hasService)),
      frequency,
      frequencyUnit,
      lastServiceDate,
      nextServiceDate,
      status,
      lastAudit,
      notes,
      inSkimmer: toBoolean(getRowValue(row, columnAliases.inSkimmer)),
      dateRemoved,
      lifetimeYears: toOptionalNumber(getRowValue(row, columnAliases.lifetimeYears)),
      techName,
      routeDay,
      repairHistory,
      cleanFilterPressure: toOptionalNumber(getRowValue(row, columnAliases.cleanFilterPressure)),
      currentPressure: toOptionalNumber(getRowValue(row, columnAliases.currentPressure)),
      sourceNotes: buildSourceNotes({
        notes,
        techName,
        routeDay,
        repairHistory,
        lastAudit,
        dateRemoved,
        lifetimeYears: toOptionalNumber(getRowValue(row, columnAliases.lifetimeYears)),
      }),
      raw: row,
    });
  });

  return {
    records,
    issues,
    skippedRows,
  };
};

export const displayCustomerName = (customer = {}) => {
  if (customer.displayAsCompany && customer.company) return cleanString(customer.company);
  return firstNonEmpty(
    customer.label,
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    customer.customerName,
    customer.company,
    customer.id
  );
};

export const formatServiceLocation = (serviceLocation = {}) => {
  const address = serviceLocation.address || {};
  return firstNonEmpty(
    [address.streetAddress, address.city, address.state, address.zip].filter(Boolean).join(", "),
    serviceLocation.nickName,
    serviceLocation.id
  );
};

const customerNameKeys = (customer = {}) =>
  uniqueText([
    displayCustomerName(customer),
    customer.customerName,
    customer.company,
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
  ]).map(normalizeText);

const serviceLocationAddressKeys = (serviceLocation = {}) => {
  const address = serviceLocation.address || {};
  return uniqueText([
    address.streetAddress,
    formatServiceLocation(serviceLocation),
    [address.streetAddress, address.city, address.state, address.zip].filter(Boolean).join(" "),
    serviceLocation.nickName,
  ]).map(normalizeText);
};

const findMatchingCustomer = (record, customers = []) => {
  const sourceKey = normalizeText(record.customerName);
  if (!sourceKey) return null;

  const exactMatches = customers.filter((customer) => customerNameKeys(customer).includes(sourceKey));
  if (exactMatches.length === 1) return exactMatches[0];

  return null;
};

const findMatchingServiceLocation = (record, serviceLocations = [], customerId = "") => {
  const sourceStreetKey = normalizeText(record.streetAddress);
  const candidateLocations = serviceLocations.filter((serviceLocation) => serviceLocation.customerId === customerId);
  const activeCandidateLocations = candidateLocations.filter((serviceLocation) => serviceLocation.isActive !== false);
  const fallbackLocations = activeCandidateLocations.length ? activeCandidateLocations : candidateLocations;

  const nameFallback = (reason) => {
    if (fallbackLocations.length === 1) {
      return {
        serviceLocation: fallbackLocations[0],
        matchMethod: "customerNameFallback",
        needsInspection: true,
        inspectionReason: reason || "Address did not match. Mapped to the customer's only service location by customer name.",
      };
    }

    return {
      serviceLocation: null,
      matchMethod: "customerNameOnly",
      needsInspection: true,
      inspectionReason: "Customer matched by name, but the address did not match a single service location.",
    };
  };

  if (!sourceStreetKey) return nameFallback("Source address was blank. Review the customer-name fallback before importing.");

  const exactMatch = candidateLocations.find((serviceLocation) =>
    serviceLocationAddressKeys(serviceLocation).includes(sourceStreetKey)
  );
  if (exactMatch) {
    return {
      serviceLocation: exactMatch,
      matchMethod: "addressExact",
      needsInspection: false,
      inspectionReason: "",
    };
  }

  const looseMatch = candidateLocations.find((serviceLocation) =>
    serviceLocationAddressKeys(serviceLocation).some((locationKey) =>
      locationKey && (locationKey.includes(sourceStreetKey) || sourceStreetKey.includes(locationKey))
    )
  );
  if (looseMatch) {
    return {
      serviceLocation: looseMatch,
      matchMethod: "addressLoose",
      needsInspection: false,
      inspectionReason: "",
    };
  }

  return nameFallback("Address did not match. Review the customer-name fallback before importing.");
};

const findMatchingBodyOfWater = (record, bodiesOfWater = [], serviceLocationId = "") => {
  const candidateBodies = bodiesOfWater.filter((bodyOfWater) => bodyOfWater.serviceLocationId === serviceLocationId);
  const activeBodies = candidateBodies.filter((bodyOfWater) => bodyOfWater.isActive !== false);
  const bodiesToSearch = activeBodies.length ? activeBodies : candidateBodies;
  const sourceKey = normalizeText(record.bodyOfWaterName);

  if (!sourceKey) return bodiesToSearch.length === 1 ? bodiesToSearch[0] : null;

  const exactMatch = bodiesToSearch.find((bodyOfWater) => normalizeText(bodyOfWater.name) === sourceKey);
  if (exactMatch) return exactMatch;

  const looseMatch = bodiesToSearch.find((bodyOfWater) => {
    const bodyKey = normalizeText(bodyOfWater.name);
    return bodyKey && (bodyKey.includes(sourceKey) || sourceKey.includes(bodyKey));
  });
  if (looseMatch) return looseMatch;

  return bodiesToSearch.length === 1 ? bodiesToSearch[0] : null;
};

export const buildEquipmentAutoMappings = ({ records = [], customers = [], serviceLocations = [], bodiesOfWater = [] }) =>
  records.reduce((mappings, record) => {
    const customer = findMatchingCustomer(record, customers);
    const serviceLocationMatch = customer
      ? findMatchingServiceLocation(record, serviceLocations, customer.id)
      : null;
    const serviceLocation = serviceLocationMatch?.serviceLocation || null;
    const bodyOfWater = serviceLocation
      ? findMatchingBodyOfWater(record, bodiesOfWater, serviceLocation.id)
      : null;

    mappings[record.id] = {
      customerId: customer?.id || "",
      serviceLocationId: serviceLocation?.id || "",
      bodyOfWaterId: bodyOfWater?.id || "",
      matchMethod: serviceLocationMatch?.matchMethod || (customer ? "customerNameOnly" : "none"),
      needsInspection: Boolean(serviceLocationMatch?.needsInspection),
      inspectionReason: serviceLocationMatch?.inspectionReason || "",
    };

    return mappings;
  }, {});

const existingMigrationProvider = (equipment) => cleanString((equipment || {}).migrationSource?.provider);

const isLikelyPlaceholder = (equipment = {}) => {
  const provider = existingMigrationProvider(equipment);
  const nameKey = normalizeText(equipment.name);
  return (
    provider === "Customer Export" ||
    ["pump1", "filter1"].includes(nameKey) ||
    (!cleanString(equipment.make) && !cleanString(equipment.model))
  );
};

const equipmentIsSameImportedRecord = (equipment = {}, record = {}) => (
  equipment.id === record.id ||
  equipment.migrationSource?.sourceEquipmentKey === record.sourceEquipmentKey
);

const equipmentIsExactTypeMakeModelMatch = (equipment = {}, record = {}) => {
  const typeKey = normalizeText(record.type);
  const makeKey = normalizeText(record.make);
  const modelKey = normalizeText(record.model);

  return (
    normalizeText(equipment.type || equipment.category) === typeKey &&
    Boolean(makeKey || modelKey) &&
    normalizeText(equipment.make) === makeKey &&
    normalizeText(equipment.model) === modelKey
  );
};

const equipmentTargetPriority = (candidate = {}) => {
  if (candidate.matchKind === "migration") return 0;
  if (candidate.matchKind === "exact") return 1;
  if (candidate.matchKind === "placeholder") return 2;
  return 3;
};

export const getEquipmentImportTargetCandidates = (record, mapping = {}, existingEquipment = []) => {
  const candidates = existingEquipment.filter((equipment) => equipment.bodyOfWaterId === mapping.bodyOfWaterId);
  const typeKey = normalizeText(record.type);
  const seen = new Set();

  return candidates
    .map((equipment) => {
      if (equipmentIsSameImportedRecord(equipment, record)) {
        return { ...equipment, matchKind: "migration" };
      }

      if (equipmentIsExactTypeMakeModelMatch(equipment, record)) {
        return { ...equipment, matchKind: "exact" };
      }

      if (normalizeText(equipment.type || equipment.category) !== typeKey) {
        return null;
      }

      if (isLikelyPlaceholder(equipment)) {
        return { ...equipment, matchKind: "placeholder" };
      }

      return { ...equipment, matchKind: "type" };
    })
    .filter(Boolean)
    .filter((equipment) => {
      if (seen.has(equipment.id)) return false;
      seen.add(equipment.id);
      return true;
    })
    .sort((left, right) => {
      const priorityDifference = equipmentTargetPriority(left) - equipmentTargetPriority(right);
      if (priorityDifference !== 0) return priorityDifference;
      return cleanString(left.name || left.type || left.id).localeCompare(cleanString(right.name || right.type || right.id));
    });
};

export const findExistingEquipmentForImportRecord = (record, mapping = {}, existingEquipment = []) => {
  if (["create", "skip"].includes(mapping.targetAction)) return null;

  const targetCandidates = getEquipmentImportTargetCandidates(record, mapping, existingEquipment);

  if (mapping.targetEquipmentId) {
    return (
      targetCandidates.find((equipment) => equipment.id === mapping.targetEquipmentId) ||
      existingEquipment.find((equipment) => equipment.id === mapping.targetEquipmentId) ||
      null
    );
  }

  const automaticMatch = targetCandidates.find((equipment) =>
    ["migration", "exact"].includes(equipment.matchKind)
  );

  return automaticMatch || null;
};

const computeNextServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
  const baseDate = toDisplayDate(lastServiceDate);
  const amount = Number(serviceFrequency);
  if (!baseDate || !Number.isFinite(amount) || amount <= 0) return null;

  const nextDate = new Date(baseDate);
  const unitText = cleanString(serviceFrequencyEvery);
  const unit = frequencyUnits[unitText.toLowerCase()] || unitText || "Month";

  if (unit === "Day") nextDate.setDate(nextDate.getDate() + amount);
  if (unit === "Week") nextDate.setDate(nextDate.getDate() + (amount * 7));
  if (unit === "Month") nextDate.setMonth(nextDate.getMonth() + amount);
  if (unit === "Year") nextDate.setFullYear(nextDate.getFullYear() + amount);

  return nextDate;
};

const preserveExistingValue = (existingEquipment = {}) => (
  existingEquipment?.id && existingMigrationProvider(existingEquipment) !== "Customer Export"
);

const fallbackDateValue = (sourceValue, existingValue, existingEquipment) => {
  if (sourceValue) return sourceValue;
  return preserveExistingValue(existingEquipment) ? existingValue || null : null;
};

export const buildEquipmentImportDoc = (
  record,
  mapping = {},
  {
    equipmentId = record.id,
    fileName = "",
    sheetName = "",
    importBatchId = "",
    importedAt = new Date(),
    existingEquipment = null,
  } = {}
) => {
  const hasService = Boolean(record.hasService);
  const serviceFrequency = hasService
    ? (record.frequency ?? existingEquipment?.serviceFrequency ?? null)
    : null;
  const serviceFrequencyEvery = hasService
    ? (record.frequencyUnit || existingEquipment?.serviceFrequencyEvery || "Month")
    : null;
  const lastServiceDate = fallbackDateValue(record.lastServiceDate, existingEquipment?.lastServiceDate, existingEquipment);
  const nextServiceDate = fallbackDateValue(
    record.nextServiceDate,
    existingEquipment?.nextServiceDate,
    existingEquipment
  ) || computeNextServiceDate(lastServiceDate, serviceFrequency, serviceFrequencyEvery);
  const status = record.status || (preserveExistingValue(existingEquipment) ? existingEquipment?.status : "") || statusLabels.operational;
  const cleanFilterPressure = record.cleanFilterPressure === ""
    ? existingEquipment?.cleanFilterPressure ?? null
    : Number(record.cleanFilterPressure);
  const currentPressure = record.currentPressure === ""
    ? existingEquipment?.currentPressure ?? null
    : Number(record.currentPressure);
  const needsInspection = Boolean(record.needsInspection || mapping.needsInspection);
  const inspectionReason = record.inspectionReason || mapping.inspectionReason || "";
  const matchMethod = record.matchMethod || mapping.matchMethod || "";
  const targetAction = mapping.targetAction || (existingEquipment ? "update" : "create");
  const targetMatchKind = existingEquipment?.matchKind || "";

  return {
    id: equipmentId,
    name: record.name || existingEquipment?.name || record.type,
    type: record.type || existingEquipment?.type || "",
    typeId: existingEquipment?.typeId || "",
    make: record.make || existingEquipment?.make || "",
    makeId: existingEquipment?.makeId || "",
    model: record.model || existingEquipment?.model || "",
    modelId: existingEquipment?.modelId || "",
    universalEquipmentId: existingEquipment?.universalEquipmentId || existingEquipment?.modelId || "",
    manualPdfLink: existingEquipment?.manualPdfLink || "",
    dateInstalled: fallbackDateValue(record.installDate, existingEquipment?.dateInstalled, existingEquipment),
    cleanFilterPressure,
    currentPressure,
    customerId: mapping.customerId,
    customerName: record.customerName,
    serviceLocationId: mapping.serviceLocationId,
    bodyOfWaterId: mapping.bodyOfWaterId,
    lastServiceDate,
    nextServiceDate,
    isActive: !record.dateRemoved && !statusIsInactive(status),
    needsService: hasService,
    serviceFrequency,
    serviceFrequencyEvery,
    status,
    notes: mergeNotes(existingEquipment?.notes, record.sourceNotes),
    photoUrls: existingEquipment?.photoUrls || [],
    verified: needsInspection ? false : existingEquipment?.verified || false,
    dateUninstalled: record.dateRemoved || existingEquipment?.dateUninstalled || null,
    needsInspection,
    inspectionReason,
    migrationSource: {
      provider: "Equipment Import",
      featureFlagId: "feature_flag_008",
      sourceFile: fileName,
      sheetName,
      importBatchId,
      importedAt,
      sourceRowNumber: record.rowNumber,
      sourceEquipmentKey: record.sourceEquipmentKey,
      sourceCustomerName: record.customerName,
      sourceStreetAddress: record.streetAddress,
      sourceBodyOfWaterName: record.bodyOfWaterName,
      sourceType: record.type,
      sourceMake: record.make,
      sourceModel: record.model,
      scheduled: record.scheduled,
      hasService: record.hasService,
      frequency: record.frequency,
      frequencyUnit: record.frequencyUnit,
      inSkimmer: record.inSkimmer,
      matchMethod,
      targetAction,
      targetMatchKind,
      needsInspection,
      inspectionReason,
      previousEquipmentId: existingEquipment?.id || "",
      previousMigrationProvider: existingMigrationProvider(existingEquipment),
    },
    updatedAt: importedAt,
  };
};

export const summarizeEquipmentImportRecords = (records = [], enrichedRecords = []) => {
  const skippedImportRows = enrichedRecords.filter((record) => record.mapping?.targetAction === "skip").length;
  const matchedRows = enrichedRecords.filter((record) =>
    record.mapping?.targetAction !== "skip" &&
    record.mappingReady &&
    !record.needsInspection &&
    !record.needsOverwriteChoice
  ).length;
  const needsMappedRows = enrichedRecords.filter((record) =>
    record.mapping?.targetAction !== "skip" && !record.mappingReady
  ).length;
  const inspectionRows = enrichedRecords.filter((record) =>
    record.mapping?.targetAction !== "skip" &&
    record.mappingReady &&
    (record.needsInspection || record.needsOverwriteChoice)
  ).length;
  const confirmedRecords = enrichedRecords.filter((record) =>
    record.mapping?.targetAction !== "skip" &&
    record.mappingReady &&
    !record.needsInspection &&
    !record.needsOverwriteChoice
  );
  const updateRows = confirmedRecords.filter((record) => record.targetEquipment).length;

  return {
    rows: records.length,
    matchedRows,
    needsMappedRows,
    inspectionRows,
    skippedImportRows,
    updateRows,
    createRows: Math.max(confirmedRecords.length - updateRows, 0),
    serviceTrackedRows: records.filter((record) => record.hasService).length,
  };
};
