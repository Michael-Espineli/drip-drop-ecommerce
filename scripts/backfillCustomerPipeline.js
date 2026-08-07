#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_PROJECT_ID = "the-pool-app-3e652";
const DATABASE_ID = "(default)";
const FIREBASE_TOOLS_CLIENT_ID = process.env.FIREBASE_CLIENT_ID || "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_TOOLS_CLIENT_SECRET = process.env.FIREBASE_CLIENT_SECRET || "j9iVZfS8kkCEFUPaAeJV0sAi";
const GOOGLE_OAUTH_TOKEN_URL = "https://www.googleapis.com/oauth2/v3/token";

const DEFAULT_PIPELINE_ITEMS = [
  {
    id: "default_lead",
    title: "Lead",
    description: "Lead created, qualified, estimated, closed, or cancelled.",
    itemType: "internal",
    linkType: "lead",
    sortOrder: 10,
    isDefault: true,
  },
  {
    id: "default_customer",
    title: "Customer",
    description: "Customer profile created with contact and billing basics.",
    itemType: "internal",
    linkType: "customer",
    sortOrder: 20,
    isDefault: true,
  },
  {
    id: "default_initial_estimate",
    title: "Initial Estimate",
    description: "Initial estimate, site visit, or survey has been completed.",
    itemType: "internal",
    linkType: "initialEstimate",
    sortOrder: 30,
    isDefault: true,
  },
  {
    id: "default_service_agreement",
    title: "Service Agreement",
    description: "Service agreement, estimate, or billing agreement is ready.",
    itemType: "internal",
    linkType: "serviceAgreement",
    sortOrder: 40,
    isDefault: true,
  },
  {
    id: "default_routing",
    title: "Routing",
    description: "Customer is assigned to a route or recurring service stop.",
    itemType: "internal",
    linkType: "routing",
    sortOrder: 50,
    isDefault: true,
  },
  {
    id: "default_equipment",
    title: "Customer Equipment",
    description: "Equipment is recorded and connected to the customer location.",
    itemType: "internal",
    linkType: "equipment",
    sortOrder: 60,
    isDefault: true,
  },
  {
    id: "default_location_photos",
    title: "Location Photos",
    description: "Location photos and setup notes are saved.",
    itemType: "internal",
    linkType: "locationPhotos",
    sortOrder: 70,
    isDefault: true,
  },
];

const DEFAULT_LEAD_SOURCES = [
  { id: "source_website", name: "Website", sortOrder: 10 },
  { id: "source_referral", name: "Referral", sortOrder: 20 },
  { id: "source_google", name: "Google", sortOrder: 30 },
  { id: "source_yelp", name: "Yelp", sortOrder: 40 },
  { id: "source_facebook", name: "Facebook", sortOrder: 50 },
  { id: "source_manual", name: "Manual", sortOrder: 60 },
  { id: "source_unknown", name: "Unknown", sortOrder: 70 },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipRows = args.includes("--skip-rows");
const projectArg = args.find((arg) => arg.startsWith("--project="));
const companyArg = args.find((arg) => arg.startsWith("--company="));
const projectId = projectArg ? projectArg.split("=").slice(1).join("=") : DEFAULT_PROJECT_ID;
const companyFilter = companyArg ? companyArg.split("=").slice(1).join("=") : "";
const nowIso = new Date().toISOString();

const firestoreBaseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;

const counters = {
  companiesScanned: 0,
  companiesChanged: 0,
  itemDefaultsCreated: 0,
  sourceDefaultsCreated: 0,
  leadRowsCreated: 0,
  customerRowsCreated: 0,
  rowsSkippedExisting: 0,
};

const extractFirstJsonObject = (text = "") => {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
};

const exchangeRefreshTokenForAccessToken = async (refreshToken) => {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: FIREBASE_TOOLS_CLIENT_ID,
      client_secret: FIREBASE_TOOLS_CLIENT_SECRET,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    const message = body.length > 600 ? `${body.slice(0, 600)}...` : body;
    throw new Error(`OAuth token refresh failed (${response.status}): ${message}`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error("OAuth token refresh did not return an access token.");
  return data.access_token;
};

const readFirebaseCliAccessToken = async () => {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (process.env.FIREBASE_TOKEN) return exchangeRefreshTokenForAccessToken(process.env.FIREBASE_TOKEN);

  const gcloudResult = spawnSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  });
  const gcloudToken = String(gcloudResult.stdout || "").trim();
  if (gcloudResult.status === 0 && gcloudToken) return gcloudToken;

  const result = spawnSync("firebase", ["login:list", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FIREBASE_CLI_DISABLE_UPDATE_CHECK: "1",
      NO_UPDATE_NOTIFIER: "1",
    },
  });
  const jsonText = extractFirstJsonObject(result.stdout || "");

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const account = Array.isArray(parsed.result) ? parsed.result[0] : null;
      const refreshToken = account?.tokens?.refresh_token;
      const accessToken = account?.tokens?.access_token;
      if (refreshToken) return await exchangeRefreshTokenForAccessToken(refreshToken);
      if (accessToken) return accessToken;
    } catch {
      // Fall through to the configstore fallback.
    }
  }

  const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const refreshToken = config.tokens?.refresh_token || config.user?.tokens?.refresh_token;
  if (refreshToken) return await exchangeRefreshTokenForAccessToken(refreshToken);

  const accessToken = config.tokens?.access_token || config.user?.tokens?.access_token;
  if (!accessToken) {
    throw new Error("Firebase CLI is logged in, but no access token was found.");
  }

  return accessToken;
};

const encodeSegment = (segment) => encodeURIComponent(String(segment || ""));
const encodePath = (documentPath) => documentPath.split("/").map(encodeSegment).join("/");

const docIdFromName = (name = "") => decodeURIComponent(String(name).split("/").pop() || "");

const compactObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  return Object.entries(value).reduce((next, [key, currentValue]) => {
    if (currentValue === undefined) return next;
    if (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) && currentValue.__timestamp) {
      next[key] = currentValue;
      return next;
    }

    if (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
      next[key] = compactObject(currentValue);
      return next;
    }

    next[key] = currentValue;
    return next;
  }, {});
};

const timestamp = (value = nowIso) => ({ __timestamp: value });

const encodeValue = (value) => {
  if (value && typeof value === "object" && value.__timestamp) {
    return { timestampValue: value.__timestamp };
  }

  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === "object") {
    return {
      mapValue: {
        fields: Object.entries(compactObject(value)).reduce((fields, [key, nestedValue]) => {
          fields[key] = encodeValue(nestedValue);
          return fields;
        }, {}),
      },
    };
  }

  return { stringValue: String(value ?? "") };
};

const encodeDocument = (data) => ({
  fields: Object.entries(compactObject(data)).reduce((fields, [key, value]) => {
    fields[key] = encodeValue(value);
    return fields;
  }, {}),
});

const decodeValue = (value = {}) => {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return timestamp(value.timestampValue);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) {
    return Object.entries(value.mapValue.fields || {}).reduce((map, [key, nestedValue]) => {
      map[key] = decodeValue(nestedValue);
      return map;
    }, {});
  }

  return "";
};

const decodeDocument = (document = {}) => ({
  id: docIdFromName(document.name),
  ...Object.entries(document.fields || {}).reduce((data, [key, value]) => {
    data[key] = decodeValue(value);
    return data;
  }, {}),
});

let accessToken = "";

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const body = await response.text();
    const message = body.length > 600 ? `${body.slice(0, 600)}...` : body;
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  return response.status === 204 ? null : response.json();
};

const collectionUrl = (collectionPath, pageToken = "") => {
  const params = new URLSearchParams({ pageSize: "300" });
  if (pageToken) params.set("pageToken", pageToken);
  return `${firestoreBaseUrl}/${encodePath(collectionPath)}?${params.toString()}`;
};

const documentUrl = (documentPath) => `${firestoreBaseUrl}/${encodePath(documentPath)}`;

const listCollection = async (collectionPath) => {
  const docs = [];
  let pageToken = "";

  do {
    const data = await api(collectionUrl(collectionPath, pageToken));
    if (!data) return docs;
    docs.push(...(data.documents || []).map(decodeDocument));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return docs;
};

const writeDocumentIfMissing = async (documentPath, data) => {
  if (dryRun) return true;

  const url = `${documentUrl(documentPath)}?currentDocument.exists=false`;
  const result = await api(url, {
    method: "PATCH",
    body: JSON.stringify(encodeDocument(data)),
  });

  return Boolean(result);
};

const runLeadQuery = async (companyId) => {
  const body = {
    structuredQuery: {
      from: [{ collectionId: "homeownerServiceRequests" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "companyId" },
          op: "EQUAL",
          value: { stringValue: companyId },
        },
      },
    },
  };
  const data = await api(`${firestoreBaseUrl}:runQuery`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return (Array.isArray(data) ? data : [])
    .map((result) => result.document)
    .filter(Boolean)
    .map(decodeDocument);
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
};

const pipelineRowIdForLead = (leadId = "") => `lead_${leadId}`;
const pipelineRowIdForCustomer = (customerId = "", customer = {}) => {
  const leadId = firstText(customer.sourceHomeownerServiceRequestId, customer.leadId);
  return leadId ? pipelineRowIdForLead(leadId) : `customer_${customerId}`;
};

const pipelineCustomerName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return firstText(customer.company, customer.companyName, customer.businessName, customer.name, "Unnamed customer");
  }

  return firstText(
    customer.customerName,
    customer.displayName,
    customer.name,
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    customer.company,
    customer.companyName,
    customer.email,
    "Unnamed customer"
  );
};

const pipelineLeadName = (lead = {}) => firstText(
  lead.customerName,
  lead.homeownerName,
  lead.creatorName,
  lead.name,
  lead.homeownerEmail,
  "Unnamed lead"
);

const pipelineStatusFromLead = (lead = {}) => {
  const status = String(lead.status || "").trim().toLowerCase();
  if (status === "cancelled" || status === "canceled") return "lost";
  return "active";
};

const leadSourceFromLead = (lead = {}) => firstText(
  lead.leadSource,
  lead.marketingSource,
  lead.sourceLabel,
  lead.source,
  "Unknown"
);

const mergeRow = (rowMap, rowId, nextRow) => {
  const existing = rowMap.get(rowId) || {};
  rowMap.set(rowId, compactObject({
    ...existing,
    ...nextRow,
    contact: firstText(existing.contact, nextRow.contact),
    leadSource: firstText(existing.leadSource, nextRow.leadSource),
    leadStatus: firstText(existing.leadStatus, nextRow.leadStatus),
    lostReason: firstText(existing.lostReason, nextRow.lostReason),
    customerName: firstText(nextRow.customerName, existing.customerName),
    createdAt: existing.createdAt || nextRow.createdAt || timestamp(),
  }));
};

const buildRows = ({ companyId, leads, customers }) => {
  const rowMap = new Map();

  leads.forEach((lead) => {
    const rowId = pipelineRowIdForLead(lead.id);
    mergeRow(rowMap, rowId, {
      id: rowId,
      companyId,
      leadId: lead.id,
      customerId: firstText(lead.customerId, lead.companyCustomerId),
      source: "lead",
      leadSource: leadSourceFromLead(lead),
      leadStatus: firstText(lead.status, "Pending"),
      pipelineStatus: pipelineStatusFromLead(lead),
      lostReason: firstText(lead.lostReason, lead.cancelReason, lead.statusChangeReason),
      customerName: pipelineLeadName(lead),
      contact: [lead.homeownerEmail, lead.homeownerPhone, lead.creatorEmail, lead.creatorPhone].filter(Boolean).join(" | "),
      serviceLocationId: firstText(lead.companyServiceLocationId, lead.serviceLocationId),
      estimateId: lead.estimateId || "",
      serviceAgreementId: lead.serviceAgreementId || "",
      serviceEstimateServiceStopId: lead.serviceEstimateServiceStopId || "",
      initialEstimateServiceStopId: lead.initialEstimateServiceStopId || "",
      sourceHomeownerServiceRequestId: lead.id,
      createdAt: lead.createdAt || timestamp(),
      updatedAt: timestamp(),
      completedAt: lead.dateCompleted || null,
    });
  });

  customers.forEach((customer) => {
    const rowId = pipelineRowIdForCustomer(customer.id, customer);
    const leadId = firstText(customer.sourceHomeownerServiceRequestId, customer.leadId);
    mergeRow(rowMap, rowId, {
      id: rowId,
      companyId,
      leadId,
      customerId: customer.id,
      source: firstText(customer.source, customer.migrationSource?.provider, "customer"),
      leadSource: firstText(customer.leadSource, customer.marketingSource, customer.sourceName, customer.migrationSource?.provider),
      pipelineStatus: "active",
      customerName: pipelineCustomerName(customer),
      contact: [
        customer.email,
        firstText(customer.phoneNumber, customer.phone),
        customer.mainContact?.email,
        customer.mainContact?.phoneNumber,
      ].filter(Boolean).join(" | "),
      sourceHomeownerServiceRequestId: leadId,
      createdAt: customer.createdAt || customer.dateCreated || timestamp(),
      updatedAt: timestamp(),
    });
  });

  return [...rowMap.values()];
};

const backfillCompany = async (company) => {
  const companyId = company.id;
  counters.companiesScanned += 1;

  const [items, sources, existingRows, customers, leads] = await Promise.all([
    listCollection(`companies/${companyId}/settings/customerPipeline/items`),
    listCollection(`companies/${companyId}/settings/customerPipeline/leadSources`),
    listCollection(`companies/${companyId}/customerPipeline`),
    skipRows ? Promise.resolve([]) : listCollection(`companies/${companyId}/customers`),
    skipRows ? Promise.resolve([]) : runLeadQuery(companyId),
  ]);

  let companyChanged = false;
  let itemDefaultsCreatedForCompany = 0;
  let sourceDefaultsCreatedForCompany = 0;

  const existingItems = items.map((item) => ({ ...item, titleKey: String(item.title || "").toLowerCase() }));
  for (const item of DEFAULT_PIPELINE_ITEMS) {
    const exists = existingItems.some((currentItem) => (
      currentItem.id === item.id ||
      (
        currentItem.isDefault === true &&
        (currentItem.linkType === item.linkType || currentItem.titleKey === item.title.toLowerCase())
      )
    ));

    if (!exists) {
      await writeDocumentIfMissing(`companies/${companyId}/settings/customerPipeline/items/${item.id}`, {
        ...item,
        active: true,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      });
      counters.itemDefaultsCreated += 1;
      itemDefaultsCreatedForCompany += 1;
      companyChanged = true;
    }
  }

  if (sources.length === 0) {
    for (const source of DEFAULT_LEAD_SOURCES) {
      await writeDocumentIfMissing(`companies/${companyId}/settings/customerPipeline/leadSources/${source.id}`, {
        ...source,
        active: true,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      });
      counters.sourceDefaultsCreated += 1;
      sourceDefaultsCreatedForCompany += 1;
      companyChanged = true;
    }
  }

  if (!skipRows) {
    const existingRowIds = new Set(existingRows.map((row) => row.id));
    const rows = buildRows({ companyId, leads, customers });

    for (const row of rows) {
      if (existingRowIds.has(row.id)) {
        counters.rowsSkippedExisting += 1;
        continue;
      }

      await writeDocumentIfMissing(`companies/${companyId}/customerPipeline/${row.id}`, {
        notes: "",
        checklist: {},
        ...row,
      });

      if (row.leadId) counters.leadRowsCreated += 1;
      else counters.customerRowsCreated += 1;
      companyChanged = true;
    }
  }

  if (companyChanged) counters.companiesChanged += 1;

  console.log(
    `${dryRun ? "[dry-run] " : ""}${companyId}: ` +
    `${itemDefaultsCreatedForCompany} default items, ` +
    `${sourceDefaultsCreatedForCompany} lead sources` +
    `${skipRows ? "" : `, ${leads.length} leads scanned, ${customers.length} customers scanned`}`
  );
};

const main = async () => {
  accessToken = await readFirebaseCliAccessToken();
  const companies = companyFilter
    ? [{ id: companyFilter }]
    : await listCollection("companies");

  for (const company of companies) {
    await backfillCompany(company);
  }

  console.log(JSON.stringify({
    projectId,
    dryRun,
    skipRows,
    ...counters,
  }, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
