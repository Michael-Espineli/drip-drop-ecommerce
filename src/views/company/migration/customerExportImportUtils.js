export const CUSTOMER_EXPORT_EXPECTED_COLUMNS = [
  "FullName",
  "DisplayAsCompany",
  "MobilePhone1",
  "Email1",
  "CustomerNotes",
  "TagList",
  "BillingAddress",
  "BillingCity",
  "BillingState",
  "BillingZip",
  "Status",
  "LocationAddress",
  "LocationCity",
  "LocationState",
  "LocationZip",
  "GateCode",
  "DogsName",
  "Rate",
  "RateType",
  "LaborCost",
  "LaborCostType",
  "MinutesAtStop",
  "LocationNotes",
  "FirstName",
  "LastName",
  "CompanyName",
  "CustomerCode",
];

export const cleanString = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const normalizeText = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

export const hashString = (source) => {
  let hash = 2166136261;
  const text = String(source || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

export const stableMigrationId = (prefix, source) => `${prefix}_mig_${hashString(source)}`;

const genericCustomerCodeKeys = new Set([
  "pretext",
  "pretexts",
  "pretxt",
  "pretextcustomer",
  "precall",
]);

const isUsefulCustomerCode = (value) => {
  const key = normalizeText(value);
  return Boolean(key && !genericCustomerCodeKeys.has(key));
};

export const toOptionalNumber = (value) => {
  const text = cleanString(value);
  if (!text) return "";

  const number = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : "";
};

const toBoolean = (value) => {
  if (value === true) return true;
  if (value === false) return false;

  const text = cleanString(value).toLowerCase();
  return ["true", "yes", "y", "1"].includes(text);
};

const uniqueStrings = (values) => {
  const seen = new Set();

  return values
    .map(cleanString)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const splitList = (value) =>
  uniqueStrings(
    cleanString(value)
      .split(/[,;\n]/)
      .map((item) => item.trim())
  );

export const mergeTags = (...tagGroups) => uniqueStrings(tagGroups.flat().filter(Boolean));

const firstNonEmpty = (...values) => values.map(cleanString).find(Boolean) || "";

const formatAddress = (address = {}) =>
  [address.streetAddress, address.city, address.state, address.zip].map(cleanString).filter(Boolean).join(", ");

const normalizeAddress = (address = {}) =>
  normalizeText([address.streetAddress, address.city, address.state, address.zip].map(cleanString).filter(Boolean).join("|"));

const buildAddress = ({ streetAddress, city, state, zip }) => ({
  streetAddress: cleanString(streetAddress),
  city: cleanString(city),
  state: cleanString(state),
  zip: cleanString(zip),
  latitude: 0,
  longitude: 0,
});

const splitFullName = (fullName) => {
  const parts = cleanString(fullName).replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] || "", lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
};

const labeledNotes = (entries) =>
  entries
    .map(({ label, value }) => {
      const text = cleanString(value);
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");

const buildCustomerKey = (row) => {
  const customerCode = cleanString(row.CustomerCode);
  if (isUsefulCustomerCode(customerCode)) return `code:${customerCode}`;

  return [
    firstNonEmpty(
      row.FullNameOrCompanyDisplay,
      [row.FirstName, row.LastName].map(cleanString).filter(Boolean).join(" "),
      row.FullName,
      row.CompanyName
    ),
    row.CompanyName,
    row.BillingAddress || row.LocationAddress,
    row.BillingCity || row.LocationCity,
    row.BillingState || row.LocationState,
    row.BillingZip || row.LocationZip,
  ]
    .map(cleanString)
    .join("|");
};

const buildLocationKey = (row, customerKey) =>
  [
    customerKey,
    row.LocationAddress || row.BillingAddress,
    row.LocationCity || row.BillingCity,
    row.LocationState || row.BillingState,
    row.LocationZip || row.BillingZip,
    row.LocationCode,
  ]
    .map(cleanString)
    .join("|");

const buildCustomerName = ({ displayAsCompany, companyName, firstName, lastName, fullName, displayName }) => {
  const personName = [firstName, lastName].filter(Boolean).join(" ");
  if (displayAsCompany && companyName && !personName && !fullName && !displayName) return companyName;

  return firstNonEmpty(displayName, personName, fullName, companyName);
};

const buildSourceEmails = (row) => uniqueStrings([row.Email1, row.Email2, row.Email3, row.Email4]);

const buildSourcePhones = (row) =>
  uniqueStrings([row.MobilePhone1, row.MobilePhone2, row.HomePhone, row.WorkPhone]);

const defaultEquipmentPartNames = {
  Pump: ["Basket", "Lid", "O-Ring", "Motor"],
  Filter: [
    "Pressure Gauge",
    "Spring Nut Assembly",
    "Manifold",
    "Short Grid",
    "Grid 1",
    "Grid 2",
    "Grid 3",
    "Grid 4",
    "Grid 5",
    "Grid 6",
    "Grid 7",
  ],
};

const addMonths = (date, monthCount) => {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + monthCount);
  return nextDate;
};

const buildDefaultEquipment = ({
  bodyOfWaterId,
  customerId,
  customerName,
  serviceLocationId,
  active,
  installedAt,
  migrationSource,
}) => {
  const pumpId = stableMigrationId("com_equ", `${bodyOfWaterId}|pump`);
  const filterId = stableMigrationId("com_equ", `${bodyOfWaterId}|filter`);

  const baseEquipment = {
    typeId: "",
    make: "",
    makeId: "",
    model: "",
    modelId: "",
    universalEquipmentId: "",
    manualPdfLink: "",
    dateInstalled: installedAt,
    status: "Operational",
    notes: "",
    customerName,
    customerId,
    serviceLocationId,
    bodyOfWaterId,
    photoUrls: [],
    isActive: active,
    migrationSource,
  };

  return [
    {
      ...baseEquipment,
      id: pumpId,
      name: "Pump 1",
      type: "Pump",
      needsService: false,
      cleanFilterPressure: null,
      currentPressure: null,
      lastServiceDate: null,
      serviceFrequency: null,
      serviceFrequencyEvery: null,
      nextServiceDate: null,
    },
    {
      ...baseEquipment,
      id: filterId,
      name: "Filter 1",
      type: "Filter",
      needsService: true,
      cleanFilterPressure: null,
      currentPressure: null,
      lastServiceDate: installedAt,
      serviceFrequency: 6,
      serviceFrequencyEvery: "Month",
      nextServiceDate: addMonths(installedAt, 6),
    },
  ];
};

const buildDefaultEquipmentParts = (equipment = []) =>
  equipment.flatMap((item) =>
    (defaultEquipmentPartNames[item.type] || []).map((partName) => ({
      id: stableMigrationId("com_equ_par", `${item.id}|${partName}`),
      equipmentId: item.id,
      equipmentType: item.type,
      name: partName,
      date: item.dateInstalled,
      createdAt: item.dateInstalled,
      notes: "",
      migrationSource: {
        ...item.migrationSource,
        sourceEquipmentId: item.id,
        sourceEquipmentType: item.type,
      },
    }))
  );

export const parseCustomerExportRows = (rows = []) => {
  const issues = [];
  const skippedRows = [];
  const records = [];

  const addSkippedRow = ({ rowNumber, customerName = "", reason, row, billingAddress = {}, locationAddress = {} }) => {
    const fallbackName = firstNonEmpty(row.FullNameOrCompanyDisplay, row.FullName, row.CompanyName, customerName);
    const label = fallbackName ? `Row ${rowNumber} (${fallbackName}): ${reason}` : `Row ${rowNumber}: ${reason}`;

    issues.push(label);
    skippedRows.push({
      id: `customer_export_skip_${rowNumber}_${hashString(label)}`,
      rowNumber,
      customerName: fallbackName || "-",
      reason,
      billingAddressLabel: formatAddress(billingAddress),
      serviceLocationLabel: formatAddress(locationAddress),
      sourceEmail: firstNonEmpty(row.Email1, row.Email2, row.Email3, row.Email4),
      sourcePhone: firstNonEmpty(row.MobilePhone1, row.MobilePhone2, row.HomePhone, row.WorkPhone),
      status: cleanString(row.Status),
    });
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const fullName = cleanString(row.FullName);
    const displayName = cleanString(row.FullNameOrCompanyDisplay);
    const sourceFirstName = cleanString(row.FirstName);
    const sourceLastName = cleanString(row.LastName);
    const splitName = splitFullName(fullName || displayName);
    const firstName = sourceFirstName || splitName.firstName;
    const lastName = sourceLastName || splitName.lastName;
    const companyName = cleanString(row.CompanyName);
    const hasPersonName = Boolean(firstName || lastName || fullName || displayName);
    const displayAsCompany = Boolean(companyName && !hasPersonName);
    const customerName = buildCustomerName({
      displayAsCompany,
      companyName,
      firstName,
      lastName,
      fullName,
      displayName,
    });
    const customerCompanyName = displayAsCompany ? companyName : customerName;

    if (!customerName) {
      addSkippedRow({
        rowNumber,
        reason: "Missing customer name.",
        row,
      });
      return;
    }

    const billingAddress = buildAddress({
      streetAddress: row.BillingAddress,
      city: row.BillingCity,
      state: row.BillingState,
      zip: row.BillingZip,
    });
    const locationAddress = buildAddress({
      streetAddress: firstNonEmpty(row.LocationAddress, row.BillingAddress),
      city: firstNonEmpty(row.LocationCity, row.BillingCity),
      state: firstNonEmpty(row.LocationState, row.BillingState),
      zip: firstNonEmpty(row.LocationZip, row.BillingZip),
    });

    if (!formatAddress(locationAddress)) {
      addSkippedRow({
        rowNumber,
        customerName,
        reason: "Missing service location or billing address.",
        row,
        billingAddress,
        locationAddress,
      });
      return;
    }

    const customerKey = buildCustomerKey(row);
    const locationKey = buildLocationKey(row, customerKey);
    const customerId = stableMigrationId("com_cus", customerKey);
    const serviceLocationId = stableMigrationId("com_sl", locationKey);
    const bodyOfWaterId = stableMigrationId("com_bow", `${locationKey}|pool`);
    const contactId = stableMigrationId("com_cus_con", customerKey);
    const createdAt = new Date();
    const sourceEmails = buildSourceEmails(row);
    const sourcePhones = buildSourcePhones(row);
    const sourceTags = splitList(row.TagList);
    const status = cleanString(row.Status);
    const active = status ? status.toLowerCase() !== "inactive" : true;
    const rate = cleanString(row.Rate);
    const laborCost = cleanString(row.LaborCost);
    const estimatedTimeRaw = toOptionalNumber(row.MinutesAtStop);
    const estimatedTime = estimatedTimeRaw === "" ? 15 : Math.round(Number(estimatedTimeRaw));

    const customerNotes = labeledNotes([
      { label: "Customer notes", value: row.CustomerNotes },
      { label: "Source company", value: companyName && companyName !== customerCompanyName ? companyName : "" },
      { label: "Lead source", value: row.LeadSource },
      { label: "Secondary phone", value: row.MobilePhone2 },
      { label: "Home phone", value: row.HomePhone },
      { label: "Work phone", value: row.WorkPhone },
      { label: "Secondary emails", value: uniqueStrings([row.Email2, row.Email3, row.Email4]).join(", ") },
    ]);
    const locationNotes = labeledNotes([
      { label: "Location notes", value: row.LocationNotes },
      { label: "Location code", value: row.LocationCode },
      { label: "Source rate type", value: row.RateType },
      { label: "Labor cost type", value: row.LaborCostType },
    ]);
    const migrationSource = {
      provider: "Customer Export",
      sourceCustomerKey: customerKey,
      sourceLocationKey: locationKey,
      sourceCustomerCode: cleanString(row.CustomerCode),
      sourceLocationCode: cleanString(row.LocationCode),
      sourceRowNumber: rowNumber,
      originalStatus: status,
    };
    const equipment = buildDefaultEquipment({
      bodyOfWaterId,
      customerId,
      customerName,
      serviceLocationId,
      active,
      installedAt: createdAt,
      migrationSource,
    });
    const equipmentParts = buildDefaultEquipmentParts(equipment);

    records.push({
      id: `${customerId}:${serviceLocationId}`,
      rowNumber,
      customerName,
      serviceLocationLabel: formatAddress(locationAddress),
      active,
      sourceTags,
      sourceEmails,
      sourcePhones,
      customer: {
        id: customerId,
        firstName,
        lastName,
        email: sourceEmails[0] || "",
        billingAddress,
        phoneNumber: sourcePhones[0] || "",
        phoneLabel: cleanString(row.MobileLabel1) || "Mobile",
        active,
        company: customerCompanyName,
        displayAsCompany,
        hireDate: new Date(),
        billingNotes: customerNotes,
        tags: sourceTags,
        linkedCustomerIds: [],
        linkedInviteId: "",
        migrationSource,
        sourceContactFields: {
          emails: sourceEmails,
          phones: sourcePhones,
          mobileLabel1: cleanString(row.MobileLabel1),
          mobileLabel2: cleanString(row.MobileLabel2),
          sourceCompanyName: companyName,
          sourceDisplayAsCompany: toBoolean(row.DisplayAsCompany),
        },
      },
      serviceLocation: {
        id: serviceLocationId,
        nickName: cleanString(row.LocationCode) || "Primary Location",
        address: locationAddress,
        gateCode: cleanString(row.GateCode),
        dogName: splitList(row.DogsName),
        estimatedTime,
        mainContact: {
          id: contactId,
          name: customerName,
          phoneNumber: sourcePhones[0] || "",
          email: sourceEmails[0] || "",
          notes: "",
        },
        notes: locationNotes,
        bodiesOfWaterId: [bodyOfWaterId],
        rateType: cleanString(row.RateType),
        laborType: cleanString(row.LaborCostType),
        chemicalCost: "",
        laborCost,
        rate,
        customerId,
        customerName,
        preText: normalizeText(row.LocationCode).includes("pretext"),
        verified: false,
        photoUrls: [],
        isActive: active,
        migrationSource,
      },
      bodyOfWater: {
        id: bodyOfWaterId,
        name: "Main",
        gallons: "16000",
        material: "Plaster",
        customerId,
        serviceLocationId,
        notes: "",
        lastFilled: new Date(),
        photoUrls: [],
        isActive: active,
        migrationSource,
      },
      equipment,
      equipmentParts,
    });
  });

  return {
    records,
    issues,
    skippedRows,
  };
};

export const summarizeCustomerExportRecords = (records = []) => {
  const customerIds = new Set();
  const tagKeys = new Set();
  let activeCount = 0;
  let inactiveCount = 0;

  records.forEach((record) => {
    customerIds.add(record.customer.id);
    record.sourceTags.forEach((tag) => tagKeys.add(tag.toLowerCase()));

    if (record.active) {
      activeCount += 1;
    } else {
      inactiveCount += 1;
    }
  });

  return {
    customers: customerIds.size,
    serviceLocations: records.length,
    bodiesOfWater: records.length,
    equipment: records.reduce((count, record) => count + (record.equipment?.length || 0), 0),
    equipmentParts: records.reduce((count, record) => count + (record.equipmentParts?.length || 0), 0),
    activeLocations: activeCount,
    inactiveLocations: inactiveCount,
    tagCount: tagKeys.size,
  };
};

const customerIdentityKeyForRecord = (record = {}) =>
  normalizeText(
    [
      record.customerName,
      record.customer?.firstName,
      record.customer?.lastName,
      record.customer?.company,
      record.customer?.email,
      record.customer?.phoneNumber,
      formatAddress(record.customer?.billingAddress),
    ]
      .map(cleanString)
      .filter(Boolean)
      .join("|")
  );

export const findCustomerExportCustomerIdCollisions = (records = []) => {
  const groups = new Map();

  records.forEach((record) => {
    const customerId = record.customer?.id || "";
    if (!customerId) return;

    if (!groups.has(customerId)) groups.set(customerId, []);
    groups.get(customerId).push(record);
  });

  return Array.from(groups.entries())
    .map(([customerId, groupedRecords]) => {
      const identityKeys = new Set(groupedRecords.map(customerIdentityKeyForRecord).filter(Boolean));
      return {
        customerId,
        rowCount: groupedRecords.length,
        distinctIdentityCount: identityKeys.size,
        rows: groupedRecords.map((record) => ({
          rowNumber: record.rowNumber,
          customerName: record.customerName,
          firstName: record.customer?.firstName || "",
          lastName: record.customer?.lastName || "",
          sourceCustomerKey: record.customer?.migrationSource?.sourceCustomerKey || "",
          sourceCustomerCode: record.customer?.migrationSource?.sourceCustomerCode || "",
        })),
      };
    })
    .filter((group) => group.distinctIdentityCount > 1);
};

const displayCustomerName = (customer = {}) => {
  if (customer.displayAsCompany && customer.company) return cleanString(customer.company);

  return firstNonEmpty(
    customer.label,
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    customer.company,
    customer.id
  );
};

const customerEmailKeys = (customer = {}) =>
  uniqueStrings([
    customer.email,
    customer.customerEmail,
    ...(customer.sourceContactFields?.emails || []),
  ]).map(normalizeText);

const customerPhoneKeys = (customer = {}) =>
  uniqueStrings([
    customer.phoneNumber,
    customer.customerPhone,
    ...(customer.sourceContactFields?.phones || []),
  ]).map(normalizeText);

const sameCustomerIdentity = (record, customer = {}) => {
  const recordName = normalizeText(record.customerName);
  const customerName = normalizeText(displayCustomerName(customer));
  const recordEmails = record.sourceEmails.map(normalizeText).filter(Boolean);
  const recordPhones = record.sourcePhones.map(normalizeText).filter(Boolean);
  const existingEmails = customerEmailKeys(customer);
  const existingPhones = customerPhoneKeys(customer);
  const emailMatch = recordEmails.some((email) => existingEmails.includes(email));
  const phoneMatch = recordPhones.some((phone) => existingPhones.includes(phone));
  const nameMatch = recordName && customerName && recordName === customerName;
  const billingMatch = normalizeAddress(record.customer.billingAddress) === normalizeAddress(customer.billingAddress);

  return Boolean(
    customer.id === record.customer.id ||
      customer.migrationSource?.sourceCustomerKey === record.customer.migrationSource?.sourceCustomerKey ||
      (nameMatch && (emailMatch || phoneMatch || billingMatch)) ||
      (billingMatch && (emailMatch || phoneMatch))
  );
};

const sameServiceLocation = (record, serviceLocation = {}, matchedCustomerId = "") => {
  const locationAddress = normalizeAddress(record.serviceLocation.address);
  const existingAddress = normalizeAddress(serviceLocation.address);
  const addressMatch = locationAddress && existingAddress && locationAddress === existingAddress;
  const customerMatch =
    serviceLocation.customerId === record.customer.id ||
    (matchedCustomerId && serviceLocation.customerId === matchedCustomerId) ||
    normalizeText(serviceLocation.customerName) === normalizeText(record.customerName);

  return Boolean(
    serviceLocation.id === record.serviceLocation.id ||
      serviceLocation.migrationSource?.sourceLocationKey === record.serviceLocation.migrationSource?.sourceLocationKey ||
      (addressMatch && customerMatch)
  );
};

export const compareCustomerExportRecords = (records = [], existingCustomers = [], existingServiceLocations = []) =>
  records.map((record) => {
    const exactCustomer = existingCustomers.find(
      (customer) =>
        customer.id === record.customer.id ||
        customer.migrationSource?.sourceCustomerKey === record.customer.migrationSource?.sourceCustomerKey
    );
    const likelyCustomer = exactCustomer || existingCustomers.find((customer) => sameCustomerIdentity(record, customer));
    const exactLocation = existingServiceLocations.find(
      (serviceLocation) =>
        serviceLocation.id === record.serviceLocation.id ||
        serviceLocation.migrationSource?.sourceLocationKey === record.serviceLocation.migrationSource?.sourceLocationKey
    );
    const likelyLocation =
      exactLocation ||
      existingServiceLocations.find((serviceLocation) =>
        sameServiceLocation(record, serviceLocation, likelyCustomer?.id || "")
      );

    if (exactCustomer && exactLocation) {
      return {
        ...record,
        migrationCheck: {
          status: "imported",
          label: "Already imported",
          tone: "emerald",
          matchedCustomerName: displayCustomerName(exactCustomer),
          matchedLocationLabel: formatAddress(exactLocation.address),
          reason: "Stable migration IDs already exist in Drip Drop.",
        },
      };
    }

    if (likelyCustomer && likelyLocation) {
      return {
        ...record,
        migrationCheck: {
          status: "matched",
          label: "Already added",
          tone: "emerald",
          matchedCustomerName: displayCustomerName(likelyCustomer),
          matchedLocationLabel: formatAddress(likelyLocation.address),
          reason: "Name/contact/address match an existing Drip Drop customer and location.",
        },
      };
    }

    if (likelyCustomer || likelyLocation) {
      return {
        ...record,
        migrationCheck: {
          status: "review",
          label: "Review",
          tone: "amber",
          matchedCustomerName: likelyCustomer ? displayCustomerName(likelyCustomer) : "",
          matchedLocationLabel: likelyLocation ? formatAddress(likelyLocation.address) : "",
          reason: likelyCustomer
            ? "Customer appears to exist, but this service location was not confidently matched."
            : "Service location appears to exist, but the customer was not confidently matched.",
        },
      };
    }

    return {
      ...record,
      migrationCheck: {
        status: "missing",
        label: "Needs import",
        tone: "blue",
        matchedCustomerName: "",
        matchedLocationLabel: "",
        reason: "No matching customer or location found in Drip Drop.",
      },
    };
  });

export const summarizeCustomerExportComparison = (records = []) =>
  records.reduce(
    (summary, record) => {
      const status = record.migrationCheck?.status || "missing";
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    },
    { imported: 0, matched: 0, review: 0, missing: 0 }
  );

export const applyImportMetadata = (record, { fileName = "", importBatchId = "", importedAt = new Date(), tags = [] } = {}) => {
  const migrationSource = {
    ...record.customer.migrationSource,
    sourceFile: fileName,
    importBatchId,
    importedAt,
  };

  return {
    customer: {
      ...record.customer,
      tags: mergeTags(record.customer.tags, tags),
      migrationSource,
    },
    serviceLocation: {
      ...record.serviceLocation,
      migrationSource,
    },
    bodyOfWater: {
      ...record.bodyOfWater,
      migrationSource,
    },
    equipment: (record.equipment || []).map((equipment) => ({
      ...equipment,
      migrationSource: {
        ...migrationSource,
        sourceEquipmentId: equipment.id,
        sourceEquipmentType: equipment.type,
      },
    })),
    equipmentParts: (record.equipmentParts || []).map((part) => ({
      ...part,
      migrationSource: {
        ...migrationSource,
        sourceEquipmentId: part.equipmentId,
        sourceEquipmentPartId: part.id,
        sourceEquipmentType: part.equipmentType,
      },
    })),
  };
};
