import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Select from "react-select";
import toast from "react-hot-toast";
import { arrayUnion, collection, doc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  buildStopDataRecord,
  normalizeDosageForStopData,
  normalizeReadingForStopData,
  saveStopDataRecord,
} from "../../../utils/stopData";

const SKIMMER_REQUIRED_COLUMNS = ["Customer", "Address", "Start Time", "Pool"];
const MAX_WRITES_PER_BATCH = 450;
const UNASSIGNED_TECHNICIAN_VALUE = "__unassigned__";

const metadataColumnAliases = [
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
];

const reportAliases = {
  customerName: ["Customer", "Customer Name", "Client", "Client Name"],
  customerCode: ["Customer Code", "Customer Number", "Client Code"],
  address: ["Address", "Service Address", "Street Address"],
  city: ["City"],
  state: ["State"],
  zip: ["Zip", "Postal Code"],
  locationCode: ["Location Code"],
  techName: ["Tech", "Technician", "Service Tech"],
  startTime: ["Start Time", "Service Date", "Date"],
  completeTime: ["Complete Time", "End Time"],
  poolName: ["Pool", "Body of Water", "Water Body"],
  gallons: ["Gallons"],
  serviceNotes: ["Service Notes", "Notes"],
  rate: ["Rate"],
  rateType: ["Rate Type"],
  laborCost: ["Labor Cost"],
  laborCostType: ["Labor Cost Type"],
};

const readingColumnDefinitions = [
  { aliases: ["Water Balance (LSI)", "Water Balance", "LSI"], name: "Water Balance", UOM: "LSI", dosageType: "Balance" },
  { aliases: ["Total Hardness (ppm)", "Total Hardness", "Hardness"], name: "Total Hardness", UOM: "ppm", dosageType: "Hardness" },
  { aliases: ["Total Chlorine (ppm)", "Total Chlorine"], name: "Total Chlorine", UOM: "ppm", dosageType: "Sanitizer" },
  { aliases: ["Free Chlorine (ppm)", "Free Chlorine"], name: "Free Chlorine", UOM: "ppm", dosageType: "Sanitizer" },
  { aliases: ["pH", "PH"], name: "pH", UOM: "pH", dosageType: "Balance" },
  { aliases: ["Total Alkalinity (ppm)", "Total Alkalinity", "Alkalinity"], name: "Total Alkalinity", UOM: "ppm", dosageType: "Alkalinity" },
  { aliases: ["Cyanuric Acid (ppm)", "Cyanuric Acid", "CYA"], name: "Cyanuric Acid", UOM: "ppm", dosageType: "Stabilizer" },
  { aliases: ["Bromine (ppm)", "Bromine"], name: "Bromine", UOM: "ppm", dosageType: "Sanitizer" },
  { aliases: ["Temp (F)", "Temperature", "Temp"], name: "Temperature", UOM: "F", dosageType: "Temperature" },
  { aliases: ["Salt"], name: "Salt", UOM: "ppm", dosageType: "Salt" },
  { aliases: ["TDS (ppm)", "TDS"], name: "TDS", UOM: "ppm", dosageType: "TDS" },
  { aliases: ["PSI"], name: "PSI", UOM: "PSI", dosageType: "Equipment" },
];

const cleanString = (value) => String(value ?? "").trim();

const compact = (items = []) =>
  items.filter((item) => item !== undefined && item !== null && item !== "");

const deleteRefsInChunks = async (refs = [], onProgress = () => {}) => {
  let deletedCount = 0;

  for (let index = 0; index < refs.length; index += MAX_WRITES_PER_BATCH) {
    const batch = writeBatch(db);
    const chunk = refs.slice(index, index + MAX_WRITES_PER_BATCH);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deletedCount += chunk.length;
    onProgress(deletedCount, refs.length);
  }

  return deletedCount;
};

const normalizeHeader = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const normalizeText = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/↑/g, " up ")
    .replace(/↓/g, " down ")
    .replace(/[^a-z0-9]/g, "");

const stripMeasurementUnit = (value) =>
  cleanString(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripChemicalUnit = (value) =>
  stripMeasurementUnit(value)
    .replace(/\b(gallons?|gal|pounds?|lbs?|lb|ounces?|oz|tabs?|tablets?|scoops?|ppm|psi|fahrenheit)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeChemicalName = (value) => normalizeText(stripChemicalUnit(value));

const canonicalChemicalName = (value) =>
  normalizeChemicalName(value)
    .replace(/muratic/g, "muriatic")
    .replace(/dichloric/g, "dichlor")
    .replace(/sodiumcarbonate/g, "sodaash")
    .replace(/washing?soda/g, "sodaash")
    .replace(/liquidcl/g, "liquidchlorine")
    .replace(/chlorinetabs/g, "tabs");

const canonicalReadingName = (value) =>
  normalizeChemicalName(value)
    .replace(/cyanuricacid/g, "cya")
    .replace(/totalhardness/g, "hardness")
    .replace(/totalalkalinity/g, "alkalinity")
    .replace(/waterbalance/g, "lsi");

const toOptionalNumber = (value) => {
  const text = cleanString(value);
  if (!text) return "";
  const number = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : "";
};

const todayInputValue = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const dateFromInput = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12, 0, 0);
};

const parseReportDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
  }

  const text = cleanString(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);

  if (match) {
    const [, month, day, yearSource, hourSource = "0", minuteSource = "0", secondSource = "0", meridian = ""] = match;
    let year = Number(yearSource);
    if (year < 100) year += 2000;
    let hour = Number(hourSource);
    if (meridian.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (meridian.toUpperCase() === "AM" && hour === 12) hour = 0;
    const date = new Date(year, Number(month) - 1, Number(day), hour, Number(minuteSource), Number(secondSource));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateLabel = (date) => {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const toRangeLabel = (startDate, endDate) => {
  if (!startDate && !endDate) return "-";
  if (!startDate || !endDate || startDate.toDateString() === endDate.toDateString()) return toDateLabel(startDate || endDate);
  return `${toDateLabel(startDate)} - ${toDateLabel(endDate)}`;
};

const hashString = (source) => {
  let hash = 0;
  const text = String(source || "");

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
};

const getRowValue = (row, aliases) => {
  const normalizedAliases = aliases.map(normalizeHeader);
  const match = Object.entries(row).find(([key]) => normalizedAliases.includes(normalizeHeader(key)));
  return match ? match[1] : "";
};

const hasRequiredColumns = (columns) => {
  const normalizedColumns = columns.map(normalizeHeader);
  return SKIMMER_REQUIRED_COLUMNS.every((column) => normalizedColumns.includes(normalizeHeader(column)));
};

const measurementLabelForColumn = (column) => {
  const label = stripMeasurementUnit(column);
  return label || cleanString(column);
};

const unitForColumn = (column) => {
  const match = cleanString(column).match(/\(([^)]*)\)/);
  return match ? match[1].trim() : "";
};

const readingDefinitionForColumn = (column) => {
  const columnKey = normalizeHeader(column);
  return readingColumnDefinitions.find((definition) =>
    definition.aliases.some((alias) => normalizeHeader(alias) === columnKey)
  );
};

const isMetadataColumn = (column) => {
  const columnKey = normalizeHeader(column);
  return metadataColumnAliases.some((alias) => normalizeHeader(alias) === columnKey);
};

const discoverReportColumns = (rows, columns) => {
  const readingColumns = columns.filter((column) => Boolean(readingDefinitionForColumn(column)));
  const dosageColumns = columns.filter((column) => {
    if (isMetadataColumn(column) || readingDefinitionForColumn(column)) return false;

    return rows.some((row) => {
      const quantity = toOptionalNumber(getRowValue(row, [column]));
      return quantity !== "" && Number(quantity) !== 0;
    });
  });

  return {
    readingColumns,
    dosageColumns,
  };
};

const skimmerAddressText = (source = {}) =>
  compact([source.address, compact([source.city, source.state, source.zip]).join(" ")]).join(", ");

const sourceSiteKey = (sourceLocation = {}) =>
  [
    sourceLocation.customerName,
    sourceLocation.customerCode,
    sourceLocation.address,
    sourceLocation.city,
    sourceLocation.state,
    sourceLocation.zip,
  ]
    .map(normalizeText)
    .join("|");

const buildSourcePoolCountsBySiteKey = (sourceLocations = []) => {
  const poolsBySiteKey = new Map();

  sourceLocations.forEach((sourceLocation) => {
    const key = sourceSiteKey(sourceLocation);
    if (!poolsBySiteKey.has(key)) poolsBySiteKey.set(key, new Set());
    poolsBySiteKey.get(key).add(normalizeText(sourceLocation.poolName) || "pool");
  });

  return new Map(Array.from(poolsBySiteKey.entries()).map(([key, pools]) => [key, pools.size]));
};

const sourceLocationHasMultiplePools = (sourceLocation, sourcePoolCountsBySiteKey) =>
  (sourcePoolCountsBySiteKey.get(sourceSiteKey(sourceLocation)) || 0) > 1;

const parseSkimmerServiceHistoryRows = (rows) => {
  const issues = [];
  const columns = Object.keys(rows[0] || {});

  if (!hasRequiredColumns(columns)) {
    return {
      records: [],
      issues: [`This workbook does not look like a Skimmer Service History report. Required columns: ${SKIMMER_REQUIRED_COLUMNS.join(", ")}.`],
    };
  }

  const { readingColumns, dosageColumns } = discoverReportColumns(rows, columns);
  const records = [];

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const customerName = cleanString(getRowValue(row, reportAliases.customerName));
    const customerCode = cleanString(getRowValue(row, reportAliases.customerCode));
    const address = cleanString(getRowValue(row, reportAliases.address)).replace(/,\s*$/, "");
    const city = cleanString(getRowValue(row, reportAliases.city));
    const state = cleanString(getRowValue(row, reportAliases.state));
    const zip = cleanString(getRowValue(row, reportAliases.zip));
    const locationCode = cleanString(getRowValue(row, reportAliases.locationCode));
    const techName = cleanString(getRowValue(row, reportAliases.techName));
    const startTimeRaw = getRowValue(row, reportAliases.startTime);
    const completeTimeRaw = getRowValue(row, reportAliases.completeTime);
    const serviceDate = parseReportDate(startTimeRaw);
    const completeDate = parseReportDate(completeTimeRaw);
    const poolName = cleanString(getRowValue(row, reportAliases.poolName)) || "Pool";
    const gallons = toOptionalNumber(getRowValue(row, reportAliases.gallons));
    const serviceNotes = cleanString(getRowValue(row, reportAliases.serviceNotes));
    const rate = toOptionalNumber(getRowValue(row, reportAliases.rate));
    const rateType = cleanString(getRowValue(row, reportAliases.rateType));
    const laborCost = toOptionalNumber(getRowValue(row, reportAliases.laborCost));
    const laborCostType = cleanString(getRowValue(row, reportAliases.laborCostType));

    if (!customerName || !address || !poolName) {
      issues.push(`Row ${rowNumber}: missing Customer, Address, or Pool.`);
      return;
    }

    if (!serviceDate) {
      issues.push(`Row ${rowNumber}: missing or invalid Start Time. The fallback date will be used if uploaded.`);
    }

    const sourceLocationKey = [
      customerName,
      customerCode,
      address,
      city,
      state,
      zip,
      poolName,
    ].join("|");
    const sourceLocationId = `skimmer_location_${hashString(sourceLocationKey)}`;

    const readings = readingColumns
      .map((column) => {
        const definition = readingDefinitionForColumn(column);
        const amount = toOptionalNumber(getRowValue(row, [column]));

        if (amount === "") return null;

        return {
          key: `reading_${normalizeHeader(column)}`,
          column,
          displayName: definition?.name || measurementLabelForColumn(column),
          amount,
          uom: definition?.UOM || unitForColumn(column),
          dosageType: definition?.dosageType || "",
          sourceRows: [rowNumber],
        };
      })
      .filter(Boolean);

    const dosages = dosageColumns
      .map((column) => {
        const quantity = toOptionalNumber(getRowValue(row, [column]));

        if (quantity === "" || Number(quantity) === 0) return null;

        return {
          key: `dosage_${normalizeHeader(column)}`,
          column,
          chemicalName: measurementLabelForColumn(column),
          displayName: stripChemicalUnit(column) || measurementLabelForColumn(column),
          quantity,
          uom: unitForColumn(column),
          sourceRows: [rowNumber],
        };
      })
      .filter(Boolean);

    if (!readings.length && !dosages.length && !serviceNotes) return;

    const recordKey = [
      sourceLocationKey,
      cleanString(startTimeRaw),
      cleanString(completeTimeRaw),
      rowNumber,
    ].join("|");

    records.push({
      id: `skimmer_service_${hashString(recordKey)}`,
      key: recordKey,
      sourceLocationId,
      sourceLocationKey,
      rowNumber,
      customerName,
      customerCode,
      address,
      city,
      state,
      zip,
      locationCode,
      techName,
      startTimeRaw: cleanString(startTimeRaw),
      completeTimeRaw: cleanString(completeTimeRaw),
      serviceDate,
      completeDate,
      poolName,
      gallons,
      serviceNotes,
      rate,
      rateType,
      laborCost,
      laborCostType,
      readings,
      dosages,
      sourceRows: [rowNumber],
    });
  });

  return {
    records,
    issues,
  };
};

const buildSourceLocations = (records) => {
  const sourceLocationsById = new Map();

  records.forEach((record) => {
    if (!sourceLocationsById.has(record.sourceLocationId)) {
      sourceLocationsById.set(record.sourceLocationId, {
        id: record.sourceLocationId,
        key: record.sourceLocationKey,
        customerName: record.customerName,
        customerCode: record.customerCode,
        address: record.address,
        city: record.city,
        state: record.state,
        zip: record.zip,
        poolName: record.poolName,
        gallons: record.gallons || "",
        recordsCount: 0,
        dosageLineCount: 0,
        readingLineCount: 0,
        dateMin: null,
        dateMax: null,
        dosageKeys: new Set(),
        readingKeys: new Set(),
        dosageNames: new Set(),
      });
    }

    const sourceLocation = sourceLocationsById.get(record.sourceLocationId);
    sourceLocation.recordsCount += 1;
    sourceLocation.dosageLineCount += record.dosages.length;
    sourceLocation.readingLineCount += record.readings.length;
    if (sourceLocation.gallons === "" && record.gallons !== "") sourceLocation.gallons = record.gallons;
    record.dosages.forEach((dosage) => {
      sourceLocation.dosageKeys.add(dosage.key);
      sourceLocation.dosageNames.add(dosage.displayName);
    });
    record.readings.forEach((reading) => sourceLocation.readingKeys.add(reading.key));

    if (record.serviceDate) {
      if (!sourceLocation.dateMin || record.serviceDate < sourceLocation.dateMin) sourceLocation.dateMin = record.serviceDate;
      if (!sourceLocation.dateMax || record.serviceDate > sourceLocation.dateMax) sourceLocation.dateMax = record.serviceDate;
    }
  });

  return Array.from(sourceLocationsById.values())
    .map((sourceLocation) => ({
      ...sourceLocation,
      dosageKeys: Array.from(sourceLocation.dosageKeys),
      readingKeys: Array.from(sourceLocation.readingKeys),
      dosageNames: Array.from(sourceLocation.dosageNames),
    }))
    .sort((a, b) =>
      a.customerName.localeCompare(b.customerName) ||
      a.address.localeCompare(b.address) ||
      a.poolName.localeCompare(b.poolName)
    );
};

const displayCustomerName = (customer = {}) => {
  if (customer.displayAsCompany && customer.company) return customer.company;
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.company || customer.label || customer.id;
};

const displayServiceLocation = (serviceLocation = {}) => {
  const address = serviceLocation.address || {};
  return [address.streetAddress, address.city, address.state, address.zip].filter(Boolean).join(", ") || serviceLocation.nickName || serviceLocation.id;
};

const serviceLocationAddressKeys = (serviceLocation = {}) => {
  const address = serviceLocation.address || {};
  return [
    address.streetAddress,
    displayServiceLocation(serviceLocation),
    [address.streetAddress, address.city, address.state, address.zip].filter(Boolean).join(" "),
    serviceLocation.nickName,
  ]
    .map(normalizeText)
    .filter(Boolean);
};

const findMatchingCustomer = (customerName, customers) => {
  const customerKey = normalizeText(customerName);
  if (!customerKey) return null;

  return (
    customers.find((customer) => normalizeText(displayCustomerName(customer)) === customerKey) ||
    customers.find((customer) => normalizeText(customer.label) === customerKey) ||
    customers.find((customer) => normalizeText(customer.company) === customerKey) ||
    null
  );
};

const findMatchingServiceLocation = (sourceLocation, serviceLocations, customerId) => {
  const streetKey = normalizeText(sourceLocation.address);
  const fullKey = normalizeText(skimmerAddressText(sourceLocation));
  const candidateLocations = serviceLocations.filter((location) => location.customerId === customerId);
  if (!streetKey && !fullKey) return candidateLocations.length === 1 ? candidateLocations[0] : null;

  return (
    candidateLocations.find((location) => serviceLocationAddressKeys(location).includes(streetKey)) ||
    candidateLocations.find((location) => serviceLocationAddressKeys(location).includes(fullKey)) ||
    candidateLocations.find((location) =>
      serviceLocationAddressKeys(location).some((locationKey) => {
        if (!locationKey) return false;
        return (streetKey && (locationKey.includes(streetKey) || streetKey.includes(locationKey))) ||
          (fullKey && (locationKey.includes(fullKey) || fullKey.includes(locationKey)));
      })
    ) ||
    (candidateLocations.length === 1 ? candidateLocations[0] : null)
  );
};

const findMatchingBodyOfWater = (poolName, bodiesOfWater, serviceLocationId, options = {}) => {
  const { allowSingleFallback = true } = options;
  const poolKey = normalizeText(poolName);
  const candidateBodies = bodiesOfWater.filter((bodyOfWater) => bodyOfWater.serviceLocationId === serviceLocationId && bodyOfWater.isActive !== false);
  const allCandidateBodies = candidateBodies.length
    ? candidateBodies
    : bodiesOfWater.filter((bodyOfWater) => bodyOfWater.serviceLocationId === serviceLocationId);

  if (!poolKey) return allowSingleFallback && allCandidateBodies.length === 1 ? allCandidateBodies[0] : null;

  return (
    allCandidateBodies.find((bodyOfWater) => normalizeText(bodyOfWater.name) === poolKey) ||
    allCandidateBodies.find((bodyOfWater) => {
      const bodyKey = normalizeText(bodyOfWater.name);
      return bodyKey && (bodyKey.includes(poolKey) || poolKey.includes(bodyKey));
    }) ||
    (allowSingleFallback && allCandidateBodies.length === 1 ? allCandidateBodies[0] : null)
  );
};

const readingTemplateLabel = (template = {}) =>
  [template.name || "Unnamed reading", template.UOM ? template.UOM : ""].filter(Boolean).join(" - ");

const dosageTemplateLabel = (template = {}) =>
  [template.name || "Unnamed dosage", template.UOM ? template.UOM : ""].filter(Boolean).join(" - ");

const technicianSourceKey = (techName) => normalizeText(techName);

const companyUserMappingValue = (companyUser = {}) => {
  const user = companyUser || {};
  return user.userId || user.id || "";
};

const displayCompanyUserName = (companyUser = {}) => {
  const user = companyUser || {};
  return (
    user.userName ||
    user.name ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    user.id ||
    "Unnamed user"
  );
};

const companyUserOptionLabel = (companyUser = {}) => {
  const label = displayCompanyUserName(companyUser);
  const status = cleanString(companyUser.status);
  return status && normalizeText(status) !== "active" ? `${label} - ${status}` : label;
};

const companyUserKeys = (companyUser = {}) =>
  [
    displayCompanyUserName(companyUser),
    companyUser.userName,
    companyUser.name,
    companyUser.email,
    companyUser.userId,
    companyUser.id,
  ]
    .map(normalizeText)
    .filter(Boolean);

const findMatchingCompanyUser = (techName, companyUsers) => {
  const techKey = technicianSourceKey(techName);
  if (!techKey) return null;

  return (
    companyUsers.find((companyUser) => companyUserKeys(companyUser).includes(techKey)) ||
    companyUsers.find((companyUser) =>
      companyUserKeys(companyUser).some((companyUserKey) => companyUserKey.includes(techKey) || techKey.includes(companyUserKey))
    ) ||
    null
  );
};

const readingTemplateKeys = (template = {}) =>
  [template.name, template.chemType, template.dosageType, template.readingType, template.linkedItemName]
    .map(canonicalReadingName)
    .filter(Boolean);

const dosageTemplateKeys = (template = {}) =>
  [template.name, template.chemType, template.linkedItemName, template.linkedItem, template.linkedItemId]
    .map(canonicalChemicalName)
    .filter(Boolean);

const findMatchingReadingTemplate = (readingName, readingTemplates) => {
  const readingKey = canonicalReadingName(readingName);
  if (!readingKey) return null;

  return (
    readingTemplates.find((template) => readingTemplateKeys(template).includes(readingKey)) ||
    readingTemplates.find((template) => {
      const templateKeys = readingTemplateKeys(template);
      return templateKeys.some((templateKey) => templateKey.includes(readingKey) || readingKey.includes(templateKey));
    }) ||
    null
  );
};

const findMatchingDosageTemplate = (chemicalName, dosageTemplates) => {
  const chemicalKey = canonicalChemicalName(chemicalName);
  if (!chemicalKey) return null;

  return (
    dosageTemplates.find((template) => dosageTemplateKeys(template).includes(chemicalKey)) ||
    dosageTemplates.find((template) => {
      const templateKeys = dosageTemplateKeys(template);
      return templateKeys.some((templateKey) => templateKey.includes(chemicalKey) || chemicalKey.includes(templateKey));
    }) ||
    null
  );
};

const buildAutoReadingMappings = ({ sourceReadings, readingTemplates }) =>
  sourceReadings.reduce((acc, reading) => {
    const template = findMatchingReadingTemplate(reading.displayName, readingTemplates);
    acc[reading.key] = template?.id || "";
    return acc;
  }, {});

const buildAutoDosageMappings = ({ sourceDosages, dosageTemplates }) =>
  sourceDosages.reduce((acc, dosage) => {
    const template = findMatchingDosageTemplate(dosage.displayName, dosageTemplates);
    acc[dosage.key] = template?.id || "";
    return acc;
  }, {});

const buildAutoTechnicianMappings = ({ sourceTechnicians, companyUsers }) =>
  sourceTechnicians.reduce((acc, sourceTechnician) => {
    const companyUser = findMatchingCompanyUser(sourceTechnician.displayName, companyUsers);
    acc[sourceTechnician.key] = companyUserMappingValue(companyUser);
    return acc;
  }, {});

const buildAutoMappings = ({ sourceLocations, customers, serviceLocations, bodiesOfWater, sourcePoolCountsBySiteKey }) =>
  sourceLocations.reduce((acc, sourceLocation) => {
    const customer = findMatchingCustomer(sourceLocation.customerName, customers);
    const serviceLocation = customer
      ? findMatchingServiceLocation(sourceLocation, serviceLocations, customer.id)
      : null;
    const allowSingleFallback = !sourceLocationHasMultiplePools(sourceLocation, sourcePoolCountsBySiteKey);
    const bodyOfWater = serviceLocation
      ? findMatchingBodyOfWater(sourceLocation.poolName, bodiesOfWater, serviceLocation.id, { allowSingleFallback })
      : null;

    acc[sourceLocation.id] = {
      customerId: customer?.id || "",
      serviceLocationId: serviceLocation?.id || "",
      bodyOfWaterId: bodyOfWater?.id || "",
    };

    return acc;
  }, {});

const buildReadingRecord = ({ reading, bodyOfWaterId, readingTemplate }) => {
  const amount = reading.amount === "" ? "" : String(reading.amount);
  const baseRecord = readingTemplate
    ? normalizeReadingForStopData(readingTemplate, amount, bodyOfWaterId)
    : {
        id: `reading_skimmer_${hashString(reading.column)}`,
        templateId: "",
        universalTemplateId: "",
        dosageType: reading.dosageType,
        name: reading.displayName,
        amount,
        UOM: reading.uom,
        bodyOfWaterId,
      };

  return {
    ...baseRecord,
    name: baseRecord.name || reading.displayName,
    dosageType: baseRecord.dosageType || reading.dosageType,
    UOM: baseRecord.UOM || reading.uom,
    bodyOfWaterId,
    migrationSource: "Skimmer",
    sourceColumn: reading.column,
    sourceRows: reading.sourceRows,
  };
};

const buildDosageRecord = ({ dosage, bodyOfWaterId, dosageTemplate }) => {
  const amount = dosage.quantity === "" ? "" : String(dosage.quantity);
  const baseRecord = dosageTemplate
    ? normalizeDosageForStopData(dosageTemplate, amount, bodyOfWaterId)
    : {
        id: `dosage_skimmer_${hashString(dosage.column)}`,
        templateId: "",
        universalTemplateId: "",
        name: dosage.displayName || dosage.chemicalName,
        amount,
        UOM: dosage.uom,
        rate: "",
        linkedItem: "",
        bodyOfWaterId,
      };

  return {
    ...baseRecord,
    name: baseRecord.name || dosage.displayName || dosage.chemicalName,
    UOM: baseRecord.UOM || dosage.uom,
    bodyOfWaterId,
    migrationSource: "Skimmer",
    sourceChemicalName: dosage.chemicalName,
    sourceColumn: dosage.column,
    sourceRows: dosage.sourceRows,
  };
};

const combineDosagesByTemplate = (dosages) => {
  const byTemplate = new Map();

  dosages.forEach((dosage) => {
    const key = dosage.universalTemplateId || dosage.templateId || dosage.name || dosage.id;
    if (!byTemplate.has(key)) {
      byTemplate.set(key, { ...dosage });
      return;
    }

    const existing = byTemplate.get(key);
    const existingAmount = Number(existing.amount);
    const nextAmount = Number(dosage.amount);

    if (Number.isFinite(existingAmount) && Number.isFinite(nextAmount)) {
      existing.amount = String(existingAmount + nextAmount);
    }

    existing.sourceChemicalName = compact([existing.sourceChemicalName, dosage.sourceChemicalName]).join(", ");
    existing.sourceColumn = compact([existing.sourceColumn, dosage.sourceColumn]).join(", ");
    existing.sourceRows = Array.from(new Set([...(existing.sourceRows || []), ...(dosage.sourceRows || [])]));
  });

  return Array.from(byTemplate.values());
};

const sourceLocationIsMatched = (sourceLocation, mappings) => {
  const mapping = mappings[sourceLocation.id] || {};
  return Boolean(mapping.customerId && mapping.serviceLocationId && mapping.bodyOfWaterId);
};

const sourceFilterCardClass = ({ active, tone = "slate" }) => {
  const activeClasses = {
    emerald: "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200",
    amber: "border-amber-300 bg-amber-50 ring-2 ring-amber-200",
    slate: "border-blue-300 bg-blue-50 ring-2 ring-blue-200",
  };
  const inactiveClasses = {
    emerald: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
    amber: "border-amber-200 bg-amber-50 hover:bg-amber-100",
    slate: "border-slate-200 bg-slate-50 hover:bg-slate-100",
  };

  return [
    "w-full border p-3 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-200",
    active ? activeClasses[tone] : inactiveClasses[tone],
  ].join(" ");
};

function SkimmerPreviousDosagesUpload() {
  const { recentlySelectedCompany, user } = useContext(Context);
  const [customers, setCustomers] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [bodiesOfWater, setBodiesOfWater] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [readingTemplates, setReadingTemplates] = useState([]);
  const [dosageTemplates, setDosageTemplates] = useState([]);
  const [companyDataLoading, setCompanyDataLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sourceSheetName, setSourceSheetName] = useState("");
  const [records, setRecords] = useState([]);
  const [parseIssues, setParseIssues] = useState([]);
  const [mappings, setMappings] = useState({});
  const [readingMappings, setReadingMappings] = useState({});
  const [dosageMappings, setDosageMappings] = useState({});
  const [technicianMappings, setTechnicianMappings] = useState({});
  const [fallbackDate, setFallbackDate] = useState(todayInputValue());
  const [sourceFilter, setSourceFilter] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [creatingBodyOfWaterIds, setCreatingBodyOfWaterIds] = useState({});

  useEffect(() => {
    if (!recentlySelectedCompany) return undefined;

    let cancelled = false;

    const loadCompanyData = async () => {
      setCompanyDataLoading(true);

      try {
        const [
          customersSnapshot,
          serviceLocationsSnapshot,
          bodiesOfWaterSnapshot,
          companyUsersSnapshot,
          readingTemplatesSnapshot,
          dosageTemplatesSnapshot,
        ] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "serviceLocations")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "bodiesOfWater")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "companyUsers")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings")),
          getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages")),
        ]);

        if (cancelled) return;

        setCustomers(customersSnapshot.docs.map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() })));
        setServiceLocations(serviceLocationsSnapshot.docs.map((locationDoc) => ({ id: locationDoc.id, ...locationDoc.data() })));
        setBodiesOfWater(bodiesOfWaterSnapshot.docs.map((bodyDoc) => ({ id: bodyDoc.id, ...bodyDoc.data() })));
        setCompanyUsers(companyUsersSnapshot.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));
        setReadingTemplates(readingTemplatesSnapshot.docs.map((readingDoc) => ({ id: readingDoc.id, ...readingDoc.data() })));
        setDosageTemplates(dosageTemplatesSnapshot.docs.map((dosageDoc) => ({ id: dosageDoc.id, ...dosageDoc.data() })));
      } catch (error) {
        console.error("Failed to load migration matching data:", error);
        toast.error("Could not load company data for matching.");
      } finally {
        if (!cancelled) setCompanyDataLoading(false);
      }
    };

    loadCompanyData();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  const sourceLocations = useMemo(() => buildSourceLocations(records), [records]);
  const sourcePoolCountsBySiteKey = useMemo(
    () => buildSourcePoolCountsBySiteKey(sourceLocations),
    [sourceLocations]
  );

  const multiPoolSourceGroups = useMemo(() => {
    const groups = new Map();

    sourceLocations.forEach((sourceLocation) => {
      const key = sourceSiteKey(sourceLocation);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          customerName: sourceLocation.customerName,
          address: skimmerAddressText(sourceLocation),
          poolNames: new Map(),
          recordsCount: 0,
        });
      }

      const group = groups.get(key);
      group.poolNames.set(normalizeText(sourceLocation.poolName) || "pool", sourceLocation.poolName || "Pool");
      group.recordsCount += sourceLocation.recordsCount;
    });

    return Array.from(groups.values())
      .filter((group) => group.poolNames.size > 1)
      .map((group) => ({
        ...group,
        poolNames: Array.from(group.poolNames.values()).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.address.localeCompare(b.address));
  }, [sourceLocations]);

  const autoMappings = useMemo(
    () => buildAutoMappings({ sourceLocations, customers, serviceLocations, bodiesOfWater, sourcePoolCountsBySiteKey }),
    [sourceLocations, customers, serviceLocations, bodiesOfWater, sourcePoolCountsBySiteKey]
  );

  useEffect(() => {
    setMappings((current) => {
      if (!sourceLocations.length) return autoMappings;

      return sourceLocations.reduce((next, sourceLocation) => {
        const existing = current[sourceLocation.id] || {};
        const automatic = autoMappings[sourceLocation.id] || {};

        next[sourceLocation.id] = {
          customerId: existing.customerId || automatic.customerId || "",
          serviceLocationId: existing.serviceLocationId || automatic.serviceLocationId || "",
          bodyOfWaterId: existing.bodyOfWaterId || automatic.bodyOfWaterId || "",
        };

        return next;
      }, {});
    });
  }, [autoMappings, sourceLocations]);

  const sourceReadings = useMemo(() => {
    const byKey = new Map();

    records.forEach((record) => {
      record.readings.forEach((reading) => {
        if (!byKey.has(reading.key)) {
          byKey.set(reading.key, {
            ...reading,
            recordCount: 0,
          });
        }

        byKey.get(reading.key).recordCount += 1;
      });
    });

    return Array.from(byKey.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [records]);

  const sourceDosages = useMemo(() => {
    const byKey = new Map();

    records.forEach((record) => {
      record.dosages.forEach((dosage) => {
        if (!byKey.has(dosage.key)) {
          byKey.set(dosage.key, {
            ...dosage,
            recordCount: 0,
            totalQuantity: 0,
          });
        }

        const sourceDosage = byKey.get(dosage.key);
        sourceDosage.recordCount += 1;
        sourceDosage.totalQuantity += Number(dosage.quantity || 0);
      });
    });

    return Array.from(byKey.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [records]);

  const sourceTechnicians = useMemo(() => {
    const byKey = new Map();

    records.forEach((record) => {
      const displayName = cleanString(record.techName);
      const key = technicianSourceKey(displayName);
      if (!key) return;

      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          displayName,
          recordCount: 0,
          sourceRows: new Set(),
        });
      }

      const sourceTechnician = byKey.get(key);
      sourceTechnician.recordCount += 1;
      (record.sourceRows || [record.rowNumber]).forEach((rowNumber) => sourceTechnician.sourceRows.add(rowNumber));
    });

    return Array.from(byKey.values())
      .map((sourceTechnician) => ({
        ...sourceTechnician,
        sourceRows: Array.from(sourceTechnician.sourceRows),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [records]);

  const autoReadingMappings = useMemo(
    () => buildAutoReadingMappings({ sourceReadings, readingTemplates }),
    [sourceReadings, readingTemplates]
  );

  const autoDosageMappings = useMemo(
    () => buildAutoDosageMappings({ sourceDosages, dosageTemplates }),
    [sourceDosages, dosageTemplates]
  );

  const autoTechnicianMappings = useMemo(
    () => buildAutoTechnicianMappings({ sourceTechnicians, companyUsers }),
    [sourceTechnicians, companyUsers]
  );

  useEffect(() => {
    setReadingMappings(autoReadingMappings);
  }, [autoReadingMappings]);

  useEffect(() => {
    setDosageMappings(autoDosageMappings);
  }, [autoDosageMappings]);

  useEffect(() => {
    setTechnicianMappings((current) => {
      if (!sourceTechnicians.length) return autoTechnicianMappings;

      return sourceTechnicians.reduce((next, sourceTechnician) => {
        next[sourceTechnician.key] = current[sourceTechnician.key] || autoTechnicianMappings[sourceTechnician.key] || "";
        return next;
      }, {});
    });
  }, [autoTechnicianMappings, sourceTechnicians]);

  const customerOptions = useMemo(
    () =>
      customers
        .map((customer) => ({
          value: customer.id,
          label: displayCustomerName(customer),
          customer,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [customers]
  );

  const readingTemplateOptions = useMemo(
    () =>
      readingTemplates
        .map((template) => ({
          value: template.id,
          label: readingTemplateLabel(template),
          template,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [readingTemplates]
  );

  const dosageTemplateOptions = useMemo(
    () =>
      dosageTemplates
        .map((template) => ({
          value: template.id,
          label: dosageTemplateLabel(template),
          template,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [dosageTemplates]
  );

  const technicianOptions = useMemo(
    () => [
      { value: UNASSIGNED_TECHNICIAN_VALUE, label: "Leave unassigned", user: null },
      ...companyUsers
        .map((companyUser) => ({
          value: companyUserMappingValue(companyUser),
          label: companyUserOptionLabel(companyUser),
          user: companyUser,
        }))
        .filter((option) => option.value)
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [companyUsers]
  );

  const readingTemplatesById = useMemo(
    () => new Map(readingTemplates.map((template) => [template.id, template])),
    [readingTemplates]
  );

  const dosageTemplatesById = useMemo(
    () => new Map(dosageTemplates.map((template) => [template.id, template])),
    [dosageTemplates]
  );

  const companyUsersByMappingId = useMemo(
    () => new Map(companyUsers.map((companyUser) => [companyUserMappingValue(companyUser), companyUser])),
    [companyUsers]
  );

  const recordsBySourceLocationId = useMemo(() => {
    const bySourceLocationId = new Map();

    records.forEach((record) => {
      if (!bySourceLocationId.has(record.sourceLocationId)) bySourceLocationId.set(record.sourceLocationId, []);
      bySourceLocationId.get(record.sourceLocationId).push(record);
    });

    return bySourceLocationId;
  }, [records]);

  const selectStyles = useMemo(
    () => ({
      menuPortal: (base) => ({ ...base, zIndex: 9999 }),
      control: (base) => ({
        ...base,
        minHeight: 40,
        borderColor: "#cbd5e1",
        boxShadow: "none",
      }),
      valueContainer: (base) => ({
        ...base,
        paddingLeft: 10,
        paddingRight: 8,
      }),
    }),
    []
  );

  const selectPortalTarget = typeof document !== "undefined" ? document.body : undefined;

  const recordIsUploadable = useCallback(
    (record) => {
      const mapping = mappings[record.sourceLocationId] || {};
      const locationReady = mapping.customerId && mapping.serviceLocationId && mapping.bodyOfWaterId;
      const dosagesReady = record.dosages.every((dosage) => dosageTemplatesById.has(dosageMappings[dosage.key]));
      const technicianKey = technicianSourceKey(record.techName);
      const technicianReady = !technicianKey || Boolean(technicianMappings[technicianKey]);
      const hasMappedReadings = record.readings.some((reading) => readingTemplatesById.has(readingMappings[reading.key]));
      const hasUploadableData = record.dosages.length > 0 || hasMappedReadings;

      return locationReady && dosagesReady && technicianReady && hasUploadableData;
    },
    [dosageMappings, dosageTemplatesById, mappings, readingMappings, readingTemplatesById, technicianMappings]
  );

  const totals = useMemo(() => {
    const dosageCount = records.reduce((total, record) => total + record.dosages.length, 0);
    const readingCount = records.reduce((total, record) => total + record.readings.length, 0);
    const matchedLocationCount = sourceLocations.filter((sourceLocation) => {
      const mapping = mappings[sourceLocation.id] || {};
      return mapping.customerId && mapping.serviceLocationId && mapping.bodyOfWaterId;
    }).length;
    const mappedSourceDosageCount = sourceDosages.filter((dosage) => dosageTemplatesById.has(dosageMappings[dosage.key])).length;
    const mappedSourceReadingCount = sourceReadings.filter((reading) => readingTemplatesById.has(readingMappings[reading.key])).length;
    const mappedSourceTechnicianCount = sourceTechnicians.filter((technician) => Boolean(technicianMappings[technician.key])).length;
    const uploadableRecordCount = records.filter(recordIsUploadable).length;

    return {
      sourceLocations: sourceLocations.length,
      records: records.length,
      dosageCount,
      readingCount,
      matchedLocationCount,
      unmatchedLocationCount: Math.max(sourceLocations.length - matchedLocationCount, 0),
      sourceDosageCount: sourceDosages.length,
      mappedSourceDosageCount,
      unmappedSourceDosageCount: Math.max(sourceDosages.length - mappedSourceDosageCount, 0),
      sourceReadingCount: sourceReadings.length,
      mappedSourceReadingCount,
      unmappedSourceReadingCount: Math.max(sourceReadings.length - mappedSourceReadingCount, 0),
      sourceTechnicianCount: sourceTechnicians.length,
      mappedSourceTechnicianCount,
      unmappedSourceTechnicianCount: Math.max(sourceTechnicians.length - mappedSourceTechnicianCount, 0),
      uploadableRecordCount,
    };
  }, [
    dosageMappings,
    dosageTemplatesById,
    mappings,
    readingMappings,
    readingTemplatesById,
    recordIsUploadable,
    records,
    sourceDosages,
    sourceLocations,
    sourceReadings,
    sourceTechnicians,
    technicianMappings,
  ]);

  const uploadableRecords = useMemo(
    () => records.filter(recordIsUploadable),
    [recordIsUploadable, records]
  );

  const filteredSourceLocations = useMemo(
    () =>
      sourceLocations.filter((sourceLocation) => {
        const matched = sourceLocationIsMatched(sourceLocation, mappings);
        if (sourceFilter === "matched") return matched;
        if (sourceFilter === "needsMapped") return !matched;
        return true;
      }),
    [mappings, sourceFilter, sourceLocations]
  );

  const serviceDateRange = useMemo(() => {
    const serviceDates = records.map((record) => record.serviceDate).filter(Boolean);
    if (!serviceDates.length) return "-";
    const min = new Date(Math.min(...serviceDates.map((date) => date.getTime())));
    const max = new Date(Math.max(...serviceDates.map((date) => date.getTime())));
    return toRangeLabel(min, max);
  }, [records]);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFileName(selectedFile.name);
    setSourceSheetName("");
    setRecords([]);
    setParseIssues([]);
    setReadingMappings({});
    setDosageMappings({});
    setTechnicianMappings({});
    setUploadProgress({ current: 0, total: 0 });
    setCreatingBodyOfWaterIds({});

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: "array", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!rows.length) {
          setParseIssues(["No rows found in the first worksheet."]);
          return;
        }

        const parsed = parseSkimmerServiceHistoryRows(rows);
        setSourceSheetName(sheetName);
        setRecords(parsed.records);
        setParseIssues(parsed.issues);

        if (parsed.records.length) {
          toast.success(`Parsed ${parsed.records.length} Skimmer service history rows.`);
        } else {
          toast.error("No usable service history rows were found.");
        }
      } catch (error) {
        console.error("Failed to parse Skimmer service history workbook:", error);
        setParseIssues(["Could not read this Excel file."]);
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const handleCustomerChange = useCallback(
    (sourceLocation, customerId) => {
      const serviceLocation = customerId
        ? findMatchingServiceLocation(sourceLocation, serviceLocations, customerId)
        : null;
      const allowSingleFallback = !sourceLocationHasMultiplePools(sourceLocation, sourcePoolCountsBySiteKey);
      const bodyOfWater = serviceLocation
        ? findMatchingBodyOfWater(sourceLocation.poolName, bodiesOfWater, serviceLocation.id, { allowSingleFallback })
        : null;

      setMappings((current) => ({
        ...current,
        [sourceLocation.id]: {
          customerId,
          serviceLocationId: serviceLocation?.id || "",
          bodyOfWaterId: bodyOfWater?.id || "",
        },
      }));
    },
    [bodiesOfWater, serviceLocations, sourcePoolCountsBySiteKey]
  );

  const handleServiceLocationChange = useCallback(
    (sourceLocation, customerId, serviceLocationId) => {
      const allowSingleFallback = !sourceLocationHasMultiplePools(sourceLocation, sourcePoolCountsBySiteKey);
      const bodyOfWater = serviceLocationId
        ? findMatchingBodyOfWater(sourceLocation.poolName, bodiesOfWater, serviceLocationId, { allowSingleFallback })
        : null;

      setMappings((current) => ({
        ...current,
        [sourceLocation.id]: {
          ...(current[sourceLocation.id] || {}),
          customerId,
          serviceLocationId,
          bodyOfWaterId: bodyOfWater?.id || "",
        },
      }));
    },
    [bodiesOfWater, sourcePoolCountsBySiteKey]
  );

  const handleBodyOfWaterChange = useCallback((sourceLocationId, bodyOfWaterId) => {
    setMappings((current) => ({
      ...current,
      [sourceLocationId]: {
        ...(current[sourceLocationId] || {}),
        bodyOfWaterId,
      },
    }));
  }, []);

  const handleCreateBodyOfWaterFromSource = useCallback(
    async (sourceLocation) => {
      if (!recentlySelectedCompany) {
        toast.error("Select a company before adding a body of water.");
        return;
      }

      const mapping = mappings[sourceLocation.id] || {};
      if (!mapping.customerId || !mapping.serviceLocationId) {
        toast.error("Select a customer and service location first.");
        return;
      }

      const poolName = cleanString(sourceLocation.poolName) || "Pool";
      const existingBodyOfWater = findMatchingBodyOfWater(
        poolName,
        bodiesOfWater,
        mapping.serviceLocationId,
        { allowSingleFallback: false }
      );

      if (existingBodyOfWater) {
        setMappings((current) => ({
          ...current,
          [sourceLocation.id]: {
            ...(current[sourceLocation.id] || {}),
            customerId: mapping.customerId,
            serviceLocationId: mapping.serviceLocationId,
            bodyOfWaterId: existingBodyOfWater.id,
          },
        }));
        toast.success(`Matched ${poolName} to an existing body of water.`);
        return;
      }

      setCreatingBodyOfWaterIds((current) => ({ ...current, [sourceLocation.id]: true }));

      try {
        const bodyOfWaterId = `com_bow_${uuidv4()}`;
        const sourceRecords = recordsBySourceLocationId.get(sourceLocation.id) || [];
        const sourceRows = Array.from(
          new Set(sourceRecords.flatMap((record) => record.sourceRows || [record.rowNumber]).filter(Boolean))
        );
        const sourceGallons = sourceLocation.gallons || sourceRecords.find((record) => record.gallons !== "")?.gallons || "";
        const bodyOfWater = {
          id: bodyOfWaterId,
          name: poolName,
          label: poolName,
          gallons: sourceGallons === "" ? "" : String(sourceGallons),
          material: "",
          customerId: mapping.customerId,
          serviceLocationId: mapping.serviceLocationId,
          notes: "Created from Skimmer Service History Upload",
          shape: "",
          length: ["", ""],
          depth: ["", ""],
          width: ["", ""],
          photoUrls: [],
          lastFilled: new Date(),
          isActive: true,
          imported: "From Skimmer",
          importedFrom: "skimmer",
          migrationSource: {
            provider: "Skimmer",
            featureFlagId: "feature_flag_009",
            reportName: "Service History",
            fileName,
            sheetName: sourceSheetName,
            importedAt: new Date(),
            importedBy: user?.uid || "",
            sourceCustomerName: sourceLocation.customerName,
            sourceCustomerCode: sourceLocation.customerCode,
            sourceAddress: skimmerAddressText(sourceLocation),
            sourcePoolName: poolName,
            sourceRows,
          },
        };

        await Promise.all([
          setDoc(doc(db, "companies", recentlySelectedCompany, "bodiesOfWater", bodyOfWaterId), bodyOfWater),
          setDoc(
            doc(db, "companies", recentlySelectedCompany, "serviceLocations", mapping.serviceLocationId),
            { bodiesOfWaterId: arrayUnion(bodyOfWaterId) },
            { merge: true }
          ),
        ]);

        setBodiesOfWater((current) =>
          [...current, bodyOfWater].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        );
        setMappings((current) => ({
          ...current,
          [sourceLocation.id]: {
            ...(current[sourceLocation.id] || {}),
            customerId: mapping.customerId,
            serviceLocationId: mapping.serviceLocationId,
            bodyOfWaterId,
          },
        }));
        toast.success(`Added ${poolName} as a body of water.`);
      } catch (error) {
        console.error("Failed to add Skimmer body of water:", error);
        toast.error(`Could not add ${poolName}.`);
      } finally {
        setCreatingBodyOfWaterIds((current) => {
          const next = { ...current };
          delete next[sourceLocation.id];
          return next;
        });
      }
    },
    [
      bodiesOfWater,
      fileName,
      mappings,
      recentlySelectedCompany,
      recordsBySourceLocationId,
      sourceSheetName,
      user?.uid,
    ]
  );

  const handleReadingMappingChange = useCallback((sourceReadingKey, readingTemplateId) => {
    setReadingMappings((current) => ({
      ...current,
      [sourceReadingKey]: readingTemplateId || "",
    }));
  }, []);

  const handleDosageMappingChange = useCallback((sourceDosageKey, dosageTemplateId) => {
    setDosageMappings((current) => ({
      ...current,
      [sourceDosageKey]: dosageTemplateId || "",
    }));
  }, []);

  const handleTechnicianMappingChange = useCallback((sourceTechnicianKey, technicianId) => {
    setTechnicianMappings((current) => ({
      ...current,
      [sourceTechnicianKey]: technicianId || "",
    }));
  }, []);

  const handleUpload = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before uploading.");
      return;
    }

    if (!uploadableRecords.length) {
      toast.error("Match at least one Skimmer service history row before uploading.");
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: uploadableRecords.length });
    let savedCount = 0;

    try {
      for (let index = 0; index < uploadableRecords.length; index += 1) {
        const record = uploadableRecords[index];
        const mapping = mappings[record.sourceLocationId];
        const technicianKey = technicianSourceKey(record.techName);
        const mappedTechnicianId = technicianMappings[technicianKey] || "";
        const mappedTechnician =
          mappedTechnicianId && mappedTechnicianId !== UNASSIGNED_TECHNICIAN_VALUE
            ? companyUsersByMappingId.get(mappedTechnicianId) || null
            : null;
        const stopDataUserId = mappedTechnician ? companyUserMappingValue(mappedTechnician) : "";
        const stopDataTechName = mappedTechnician ? displayCompanyUserName(mappedTechnician) : "";
        const recordDate = record.serviceDate || dateFromInput(fallbackDate);
        const recordDateKey = Number.isNaN(recordDate.getTime()) ? fallbackDate : recordDate.toISOString();
        const recordId = `com_sd_skimmer_service_${hashString(`${record.key}|${recordDateKey}`)}`;
        const readings = record.readings
          .map((reading) => {
            const readingTemplate = readingTemplatesById.get(readingMappings[reading.key]);
            return readingTemplate
              ? buildReadingRecord({
                  reading,
                  bodyOfWaterId: mapping.bodyOfWaterId,
                  readingTemplate,
                })
              : null;
          })
          .filter(Boolean);
        const dosages = combineDosagesByTemplate(
          record.dosages.map((dosage) =>
            buildDosageRecord({
              dosage,
              bodyOfWaterId: mapping.bodyOfWaterId,
              dosageTemplate: dosageTemplatesById.get(dosageMappings[dosage.key]),
            })
          )
        );

        const stopData = {
          ...buildStopDataRecord({
            existingStopData: {
              id: recordId,
              customerId: mapping.customerId,
              serviceLocationId: mapping.serviceLocationId,
              bodyOfWaterId: mapping.bodyOfWaterId,
              userId: stopDataUserId,
            },
            bodyOfWaterId: mapping.bodyOfWaterId,
            readings,
            dosages,
            observation: compact([
              `Skimmer service history upload${fileName ? `: ${fileName}` : ""}`,
              record.serviceNotes ? `Skimmer note: ${record.serviceNotes}` : "",
            ]),
            userId: stopDataUserId,
            date: recordDate,
            equipmentMeasurements: [],
          }),
          techId: stopDataUserId,
          techName: stopDataTechName,
          tech: stopDataTechName,
          imported: "From Skimmer",
          importedFrom: "skimmer",
          migrationSource: {
            provider: "Skimmer",
            featureFlagId: "feature_flag_009",
            reportName: "Service History",
            fileName,
            sheetName: sourceSheetName,
            importedAt: new Date(),
            importedBy: user?.uid || "",
            sourceCustomerName: record.customerName,
            sourceCustomerCode: record.customerCode,
            sourceAddress: skimmerAddressText(record),
            sourcePoolName: record.poolName,
            sourceTechName: record.techName,
            mappedTechnicianId: stopDataUserId,
            mappedTechnicianName: stopDataTechName,
            sourceStartTime: record.startTimeRaw,
            sourceCompleteTime: record.completeTimeRaw,
            sourceRows: record.sourceRows,
            locationCode: record.locationCode,
            gallons: record.gallons,
            rate: record.rate,
            rateType: record.rateType,
            laborCost: record.laborCost,
            laborCostType: record.laborCostType,
          },
        };

        await saveStopDataRecord({
          db,
          companyId: recentlySelectedCompany,
          stopData,
          writeHomeownerCopies: false,
        });

        savedCount = index + 1;
        setUploadProgress({ current: savedCount, total: uploadableRecords.length });
        setRecords((currentRecords) => currentRecords.filter((currentRecord) => currentRecord.id !== record.id));
      }

      toast.success(`Uploaded ${uploadableRecords.length} Skimmer service history records.`);
    } catch (error) {
      console.error("Failed to upload Skimmer service history:", error);
      toast.error(
        savedCount > 0
          ? `Upload stopped after ${savedCount} records. Saved records were removed from the pending list.`
          : "Upload failed before any records were saved."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteSkimmerHistory = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before deleting Skimmer history.");
      return;
    }

    const confirmation = window.prompt(
      "Delete all Skimmer-imported service history records for this company?\n\nType DELETE SKIMMER HISTORY to confirm."
    );
    if (confirmation !== "DELETE SKIMMER HISTORY") return;

    setDeletingHistory(true);
    setDeleteProgress({ current: 0, total: 0 });

    try {
      const stopDataRef = collection(db, "companies", recentlySelectedCompany, "stopData");
      const [providerSnapshot, importedFromSnapshot] = await Promise.all([
        getDocs(query(stopDataRef, where("migrationSource.provider", "==", "Skimmer"))),
        getDocs(query(stopDataRef, where("importedFrom", "==", "skimmer"))),
      ]);
      const docsByPath = new Map();

      providerSnapshot.docs.forEach((snapshot) => docsByPath.set(snapshot.ref.path, snapshot.ref));
      importedFromSnapshot.docs.forEach((snapshot) => docsByPath.set(snapshot.ref.path, snapshot.ref));

      const refs = Array.from(docsByPath.values());

      if (refs.length === 0) {
        toast.success("No Skimmer-imported service history records were found.");
        return;
      }

      setDeleteProgress({ current: 0, total: refs.length });
      const deletedCount = await deleteRefsInChunks(refs, (current, total) => {
        setDeleteProgress({ current, total });
      });

      toast.success(`Deleted ${deletedCount} Skimmer service history records.`);
    } catch (error) {
      console.error("Failed to delete Skimmer service history records:", error);
      toast.error("Could not delete the Skimmer service history records.");
    } finally {
      setDeletingHistory(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-0 py-4">
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Migration</p>
            <h1 className="text-2xl font-bold text-slate-950">Skimmer Service History Upload</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDeleteSkimmerHistory}
              disabled={uploading || deletingHistory}
              className="inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
            >
              {deletingHistory
                ? `Deleting ${deleteProgress.current}/${deleteProgress.total}`
                : "Delete Skimmer History"}
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || deletingHistory || uploadableRecords.length === 0}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {uploading ? `Uploading ${uploadProgress.current}/${uploadProgress.total}` : "Upload Matched History"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Service History report</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Fallback date</span>
                <input
                  type="date"
                  value={fallbackDate}
                  onChange={(event) => setFallbackDate(event.target.value)}
                  className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <button
                type="button"
                onClick={() => setSourceFilter("all")}
                className={sourceFilterCardClass({ active: sourceFilter === "all" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</p>
                <p className="text-2xl font-bold text-slate-950">{totals.sourceLocations}</p>
              </button>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stops</p>
                <p className="text-2xl font-bold text-slate-950">{totals.records}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dosage Lines</p>
                <p className="text-2xl font-bold text-slate-950">{totals.dosageCount}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Readings</p>
                <p className="text-2xl font-bold text-slate-950">{totals.readingCount}</p>
              </div>
              <button
                type="button"
                onClick={() => setSourceFilter("matched")}
                className={sourceFilterCardClass({ active: sourceFilter === "matched", tone: "emerald" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Sources Matched</p>
                <p className="text-2xl font-bold text-emerald-700">{totals.matchedLocationCount}</p>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("needsMapped")}
                className={sourceFilterCardClass({ active: sourceFilter === "needsMapped", tone: "amber" })}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Needs Mapped</p>
                <p className="text-2xl font-bold text-amber-700">{totals.unmatchedLocationCount}</p>
              </button>
              <div className="border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Ready Stops</p>
                <p className="text-2xl font-bold text-blue-700">{totals.uploadableRecordCount}</p>
              </div>
            </div>
          </section>

          <aside className="border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Report</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">File</dt>
                <dd className="break-words font-medium text-slate-900">{fileName || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sheet</dt>
                <dd className="font-medium text-slate-900">{sourceSheetName || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Dates</dt>
                <dd className="font-medium text-slate-900">{serviceDateRange}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Required Columns</dt>
                <dd className="text-slate-700">{SKIMMER_REQUIRED_COLUMNS.join(", ")}</dd>
              </div>
            </dl>
          </aside>
        </div>

        {companyDataLoading && (
          <div className="mx-4 border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            Loading Drip Drop matching data...
          </div>
        )}

        {parseIssues.length > 0 && (
          <div className="mx-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Skipped rows</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {parseIssues.slice(0, 8).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
              {parseIssues.length > 8 && <li>{parseIssues.length - 8} more rows skipped.</li>}
            </ul>
          </div>
        )}

        {multiPoolSourceGroups.length > 0 && (
          <div className="mx-4 border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold">Multiple bodies of water detected</p>
              <p className="text-xs font-medium text-blue-800">
                {multiPoolSourceGroups.length} service location{multiPoolSourceGroups.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {multiPoolSourceGroups.slice(0, 4).map((group) => (
                <div key={group.key} className="border border-blue-200 bg-white px-3 py-2">
                  <p className="font-medium text-slate-950">{group.customerName}</p>
                  <p className="text-xs text-slate-600">{group.address}</p>
                  <p className="mt-1 text-xs font-semibold text-blue-900">{group.poolNames.join(", ")}</p>
                </div>
              ))}
            </div>
            {multiPoolSourceGroups.length > 4 && (
              <p className="mt-2 text-xs font-medium text-blue-800">
                {multiPoolSourceGroups.length - 4} more service location
                {multiPoolSourceGroups.length - 4 === 1 ? "" : "s"} with multiple bodies of water.
              </p>
            )}
          </div>
        )}

        {sourceDosages.length > 0 && (
          <section className="border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-950">Dosage Template Mapping</h2>
              <span
                className={`text-sm font-medium ${
                  totals.unmappedSourceDosageCount > 0 ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                {totals.unmappedSourceDosageCount > 0
                  ? `${totals.unmappedSourceDosageCount} unmapped`
                  : "All mapped"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {sourceDosages.map((dosage) => {
                const selectedTemplateId = dosageMappings[dosage.key] || "";
                const selectedOption = dosageTemplateOptions.find((option) => option.value === selectedTemplateId) || null;

                return (
                  <div key={dosage.key} className="border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{dosage.displayName}</p>
                        <p className="text-xs text-slate-500">
                          Source: {dosage.column}
                          {dosage.uom ? `, ${dosage.uom}` : ""} · {dosage.recordCount} stops
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                          selectedTemplateId ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {selectedTemplateId ? "Mapped" : "Map"}
                      </span>
                    </div>
                    <Select
                      value={selectedOption}
                      options={dosageTemplateOptions}
                      onChange={(option) => handleDosageMappingChange(dosage.key, option?.value || "")}
                      isClearable
                      isSearchable
                      placeholder="Search Drip Drop dosage"
                      classNamePrefix="react-select"
                      menuPortalTarget={selectPortalTarget}
                      menuPosition="fixed"
                      styles={selectStyles}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {sourceReadings.length > 0 && (
          <section className="border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-950">Reading Template Mapping</h2>
              <span
                className={`text-sm font-medium ${
                  totals.unmappedSourceReadingCount > 0 ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                {totals.mappedSourceReadingCount}/{totals.sourceReadingCount} mapped
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {sourceReadings.map((reading) => {
                const selectedTemplateId = readingMappings[reading.key] || "";
                const selectedOption = readingTemplateOptions.find((option) => option.value === selectedTemplateId) || null;

                return (
                  <div key={reading.key} className="border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{reading.displayName}</p>
                        <p className="text-xs text-slate-500">
                          Source: {reading.column}
                          {reading.uom ? `, ${reading.uom}` : ""} · {reading.recordCount} stops
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                          selectedTemplateId ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {selectedTemplateId ? "Mapped" : "Skip"}
                      </span>
                    </div>
                    <Select
                      value={selectedOption}
                      options={readingTemplateOptions}
                      onChange={(option) => handleReadingMappingChange(reading.key, option?.value || "")}
                      isClearable
                      isSearchable
                      placeholder="Search Drip Drop reading"
                      classNamePrefix="react-select"
                      menuPortalTarget={selectPortalTarget}
                      menuPosition="fixed"
                      styles={selectStyles}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {sourceTechnicians.length > 0 && (
          <section className="border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-950">Technician Mapping</h2>
              <span
                className={`text-sm font-medium ${
                  totals.unmappedSourceTechnicianCount > 0 ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                {totals.mappedSourceTechnicianCount}/{totals.sourceTechnicianCount} mapped
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {sourceTechnicians.map((sourceTechnician) => {
                const selectedTechnicianId = technicianMappings[sourceTechnician.key] || "";
                const selectedOption = technicianOptions.find((option) => option.value === selectedTechnicianId) || null;
                const mappedLabel = selectedTechnicianId === UNASSIGNED_TECHNICIAN_VALUE ? "Unassigned" : "Mapped";

                return (
                  <div key={sourceTechnician.key} className="border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{sourceTechnician.displayName}</p>
                        <p className="text-xs text-slate-500">
                          Source: Tech column H · {sourceTechnician.recordCount} stops
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                          selectedTechnicianId ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {selectedTechnicianId ? mappedLabel : "Map"}
                      </span>
                    </div>
                    <Select
                      value={selectedOption}
                      options={technicianOptions}
                      onChange={(option) => handleTechnicianMappingChange(sourceTechnician.key, option?.value || "")}
                      isClearable
                      isSearchable
                      placeholder="Search Drip Drop technician"
                      classNamePrefix="react-select"
                      menuPortalTarget={selectPortalTarget}
                      menuPosition="fixed"
                      styles={selectStyles}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">Mapping Preview</h2>
            <span className="text-sm text-slate-500">
              {filteredSourceLocations.length}/{sourceLocations.length} sources shown · {uploadableRecords.length} stops ready
            </span>
          </div>

          {sourceLocations.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No Skimmer service history report has been parsed yet.
            </div>
          ) : filteredSourceLocations.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No source locations match the selected filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Skimmer Source</th>
                    <th className="px-4 py-3">Drip Drop Customer</th>
                    <th className="px-4 py-3">Service Location</th>
                    <th className="px-4 py-3">Body of Water</th>
                    <th className="px-4 py-3">History</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredSourceLocations.map((sourceLocation) => {
                    const mapping = mappings[sourceLocation.id] || {};
                    const locationOptions = serviceLocations.filter((location) => location.customerId === mapping.customerId);
                    const bodyOptions = bodiesOfWater.filter((bodyOfWater) => bodyOfWater.serviceLocationId === mapping.serviceLocationId);
                    const selectedCustomerOption = customerOptions.find((option) => option.value === mapping.customerId) || null;
                    const locationReady = mapping.customerId && mapping.serviceLocationId && mapping.bodyOfWaterId;
                    const dosagesReady = sourceLocation.dosageKeys.every((dosageKey) => dosageTemplatesById.has(dosageMappings[dosageKey]));
                    const sourceRecords = recordsBySourceLocationId.get(sourceLocation.id) || [];
                    const technicianReady = sourceRecords.every((record) => {
                      const technicianKey = technicianSourceKey(record.techName);
                      return !technicianKey || Boolean(technicianMappings[technicianKey]);
                    });
                    const readyStopCount = sourceRecords.filter(recordIsUploadable).length;
                    const ready = locationReady && dosagesReady && readyStopCount > 0;
                    const visibleDosageNames = sourceLocation.dosageNames.slice(0, 4).join(", ");
                    const hasMultipleSourcePools = sourceLocationHasMultiplePools(sourceLocation, sourcePoolCountsBySiteKey);
                    const strictBodyOfWaterMatch = mapping.serviceLocationId
                      ? findMatchingBodyOfWater(sourceLocation.poolName, bodiesOfWater, mapping.serviceLocationId, {
                          allowSingleFallback: false,
                        })
                      : null;
                    const shouldOfferCreateBodyOfWater = Boolean(
                      mapping.serviceLocationId &&
                        sourceLocation.poolName &&
                        !strictBodyOfWaterMatch &&
                        !mapping.bodyOfWaterId
                    );
                    const creatingBodyOfWater = Boolean(creatingBodyOfWaterIds[sourceLocation.id]);

                    return (
                      <tr key={sourceLocation.id} className="align-top">
                        <td className="w-[280px] px-4 py-4">
                          <div className="font-semibold text-slate-900">{sourceLocation.customerName}</div>
                          <div className="mt-1 text-slate-500">{skimmerAddressText(sourceLocation)}</div>
                          <div className="mt-1 text-xs font-medium text-slate-600">{sourceLocation.poolName}</div>
                        </td>
                        <td className="min-w-[300px] px-4 py-4">
                          <Select
                            value={selectedCustomerOption}
                            options={customerOptions}
                            onChange={(option) => handleCustomerChange(sourceLocation, option?.value || "")}
                            isClearable
                            isSearchable
                            placeholder="Search customer"
                            classNamePrefix="react-select"
                            menuPortalTarget={selectPortalTarget}
                            menuPosition="fixed"
                            styles={selectStyles}
                          />
                        </td>
                        <td className="min-w-[270px] px-4 py-4">
                          <select
                            value={mapping.serviceLocationId || ""}
                            onChange={(event) => handleServiceLocationChange(sourceLocation, mapping.customerId, event.target.value)}
                            disabled={!mapping.customerId}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Select location</option>
                            {locationOptions.map((serviceLocation) => (
                              <option key={serviceLocation.id} value={serviceLocation.id}>
                                {displayServiceLocation(serviceLocation)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="min-w-[190px] px-4 py-4">
                          <select
                            value={mapping.bodyOfWaterId || ""}
                            onChange={(event) => handleBodyOfWaterChange(sourceLocation.id, event.target.value)}
                            disabled={!mapping.serviceLocationId}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Select pool</option>
                            {bodyOptions.map((bodyOfWater) => (
                              <option key={bodyOfWater.id} value={bodyOfWater.id}>
                                {bodyOfWater.name || bodyOfWater.id}
                              </option>
                            ))}
                          </select>
                          {hasMultipleSourcePools && (
                            <p className="mt-1 text-xs font-medium text-blue-700">
                              Skimmer pool: {sourceLocation.poolName}
                            </p>
                          )}
                          {shouldOfferCreateBodyOfWater && (
                            <div className="mt-2 border border-amber-200 bg-amber-50 p-2">
                              <p className="text-xs font-medium text-amber-800">
                                No Drip Drop body of water matches {sourceLocation.poolName}.
                              </p>
                              <button
                                type="button"
                                onClick={() => handleCreateBodyOfWaterFromSource(sourceLocation)}
                                disabled={creatingBodyOfWater || uploading || deletingHistory}
                                className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                              >
                                {creatingBodyOfWater ? "Adding..." : `Add ${sourceLocation.poolName}`}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="min-w-[300px] px-4 py-4">
                          <div className="space-y-1 text-slate-700">
                            <div className="font-medium text-slate-900">
                              {sourceLocation.recordsCount} stops · {toRangeLabel(sourceLocation.dateMin, sourceLocation.dateMax)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {sourceLocation.dosageLineCount} dosage lines · {sourceLocation.readingLineCount} readings
                            </div>
                            {visibleDosageNames && (
                              <div className="max-w-[340px] truncate text-xs text-slate-500">
                                {visibleDosageNames}
                                {sourceLocation.dosageNames.length > 4 ? `, +${sourceLocation.dosageNames.length - 4} more` : ""}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {ready
                              ? `${readyStopCount} ready`
                              : !locationReady
                                ? "Map location"
                                : !dosagesReady
                                  ? "Map dosages"
                                  : !technicianReady
                                    ? "Map technician"
                                    : "Map location"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default SkimmerPreviousDosagesUpload;
