import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";

export const CUSTOMER_PIPELINE_COLLECTION = "customerPipeline";
export const LEGACY_CUSTOMER_MIGRATION_COLLECTION = "customerMigrationTracker";
export const PIPELINE_VIEW_PERMISSION_ID = "630";
export const PIPELINE_CREATE_PERMISSION_ID = "632";
export const PIPELINE_UPDATE_PERMISSION_ID = "634";

export const PIPELINE_ITEM_TYPES = [
  { value: "internal", label: "Internal" },
  { value: "external", label: "External" },
];

export const PIPELINE_LINK_TYPES = [
  { value: "lead", label: "Lead" },
  { value: "customer", label: "Customer" },
  { value: "initialEstimate", label: "Initial Estimate" },
  { value: "serviceAgreement", label: "Service Agreement" },
  { value: "routing", label: "Routing" },
  { value: "equipment", label: "Equipment" },
  { value: "locationPhotos", label: "Location Photos" },
  { value: "external", label: "External / Manual" },
];

export const DEFAULT_PIPELINE_TEMPLATE_ITEMS = [
  {
    id: "default_lead",
    title: "Lead",
    description: "Lead intake is captured and the source is recorded.",
    sortOrder: 10,
    itemType: "internal",
    linkType: "lead",
    isDefault: true,
  },
  {
    id: "default_customer",
    title: "Customer",
    description: "Customer profile exists in Drip Drop.",
    sortOrder: 20,
    itemType: "internal",
    linkType: "customer",
    isDefault: true,
  },
  {
    id: "default_initial_estimate",
    title: "Initial Estimate",
    description: "Initial estimate, site visit, or survey has been completed.",
    sortOrder: 30,
    itemType: "internal",
    linkType: "initialEstimate",
    isDefault: true,
  },
  {
    id: "default_service_agreement",
    title: "Service Agreement",
    description: "Estimate or recurring service agreement has been created.",
    sortOrder: 40,
    itemType: "internal",
    linkType: "serviceAgreement",
    isDefault: true,
  },
  {
    id: "default_routing",
    title: "Routing",
    description: "Recurring service route, day, order, and technician assignment are ready.",
    sortOrder: 50,
    itemType: "internal",
    linkType: "routing",
    isDefault: true,
  },
  {
    id: "default_equipment",
    title: "Customer Equipment",
    description: "Equipment has been written down and linked to the customer.",
    sortOrder: 60,
    itemType: "internal",
    linkType: "equipment",
    isDefault: true,
  },
  {
    id: "default_location_photos",
    title: "Location Photos",
    description: "Location, pool, or equipment photos are saved for field context.",
    sortOrder: 70,
    itemType: "internal",
    linkType: "locationPhotos",
    isDefault: true,
  },
];

export const LEGACY_DEFAULT_PIPELINE_TEMPLATE_ITEM_IDS = new Set([
  "lead",
  "customer",
  "initial-estimate",
  "service-agreement",
  "routing",
  "customer-equipment",
  "location-photos",
]);

export const DEFAULT_PIPELINE_TEMPLATE_ITEM_IDS = new Set([
  ...DEFAULT_PIPELINE_TEMPLATE_ITEMS.map((item) => item.id),
  ...LEGACY_DEFAULT_PIPELINE_TEMPLATE_ITEM_IDS,
]);

export const DEFAULT_LEAD_SOURCES = [
  { id: "source_website", name: "Website", sortOrder: 10 },
  { id: "source_referral", name: "Referral", sortOrder: 20 },
  { id: "source_google", name: "Google", sortOrder: 30 },
  { id: "source_yelp", name: "Yelp", sortOrder: 40 },
  { id: "source_facebook", name: "Facebook", sortOrder: 50 },
  { id: "source_manual", name: "Manual", sortOrder: 60 },
  { id: "source_unknown", name: "Unknown", sortOrder: 999 },
];

export const LEAD_STAGE_OPTIONS = [
  { value: "Pending", label: "Pending", helper: "New lead" },
  { value: "In Progress", label: "In Progress", helper: "Working" },
  { value: "Completed", label: "Completed", helper: "Won or finished" },
  { value: "Cancelled", label: "Cancelled", helper: "Lost / no close" },
];

export const pipelineTemplateItemsRef = (companyId) => (
  collection(db, "companies", companyId, "settings", "customerPipeline", "items")
);

export const pipelineLeadSourcesRef = (companyId) => (
  collection(db, "companies", companyId, "settings", "customerPipeline", "leadSources")
);

export const customerPipelineRowsRef = (companyId) => (
  collection(db, "companies", companyId, CUSTOMER_PIPELINE_COLLECTION)
);

export const customerPipelineRowRef = (companyId, rowId) => (
  doc(db, "companies", companyId, CUSTOMER_PIPELINE_COLLECTION, rowId)
);

export const normalizePipelineItem = (item = {}, fallbackOrder = 0) => {
  const linkType = item.linkType || item.internalLinkType || "external";
  const itemType = linkType === "external" ? (item.itemType || "external") : "internal";
  const isDefault = item.isDefault === true || DEFAULT_PIPELINE_TEMPLATE_ITEM_IDS.has(item.id || "");

  return {
    id: item.id || "",
    title: String(item.title || item.name || "").trim(),
    description: String(item.description || "").trim(),
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : fallbackOrder,
    active: item.active !== false,
    itemType,
    linkType,
    isDefault,
    isInternal: itemType === "internal",
    canDelete: !isDefault && itemType !== "internal",
  };
};

export const normalizeLeadSourceItem = (item = {}, fallbackOrder = 0) => ({
  id: item.id || "",
  name: String(item.name || item.label || "").trim(),
  sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : fallbackOrder,
  active: item.active !== false,
});

export const leadSourceId = (sourceName = "") => {
  const safe = String(sourceName || "source")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "source";

  return `source_${safe}`;
};

export const getLeadSourceLabel = (lead = {}) => (
  lead.leadSource ||
  lead.marketingSource ||
  lead.sourceLabel ||
  lead.publicLeadIntake?.source ||
  lead.source ||
  "Unknown"
);

export const getCustomerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || customer.businessName || customer.name || "Unnamed customer";
  }

  return (
    customer.customerName ||
    customer.displayName ||
    customer.name ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    customer.company ||
    customer.companyName ||
    customer.email ||
    "Unnamed customer"
  );
};

export const getCustomerContact = (customer = {}) => (
  [
    customer.email,
    customer.phoneNumber || customer.phone,
    customer.mainContact?.email,
    customer.mainContact?.phoneNumber,
  ].filter(Boolean).join(" | ")
);

export const pipelineRowIdForCustomer = (customer = {}) => {
  const leadId = customer.sourceHomeownerServiceRequestId || customer.leadId || "";
  if (leadId) return `lead_${leadId}`;
  return `customer_${customer.id}`;
};

export const pipelineRowIdForLead = (leadId = "") => `lead_${leadId}`;

const normalizePipelineStatusKey = (value = "") => (
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
);

const ENDED_PIPELINE_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "oneoff",
  "one_off",
  "hire_done_off",
  "hired_one_off",
  "hired_for_one_off",
  "lost",
  "cancelled",
  "canceled",
  "fired",
  "fired_us",
  "customer_fired",
  "terminated",
  "churned",
  "inactive",
]);

export const endCustomerPipelineRowsForInactiveCustomer = async ({
  companyId,
  customerId,
  reason = "Customer marked inactive",
  actorId = "",
  actorName = "",
} = {}) => {
  if (!companyId || !customerId) return 0;

  const snapshot = await getDocs(query(
    customerPipelineRowsRef(companyId),
    where("customerId", "==", customerId)
  ));
  const activeRows = snapshot.docs.filter((rowDoc) => {
    const row = rowDoc.data() || {};
    const status = normalizePipelineStatusKey(row.pipelineStatus || row.lifecycleStatus || row.status || "");
    return !ENDED_PIPELINE_STATUSES.has(status);
  });

  if (!activeRows.length) return 0;

  const batch = writeBatch(db);
  activeRows.forEach((rowDoc) => {
    batch.set(rowDoc.ref, {
      pipelineStatus: "inactive",
      lifecycleStatus: "inactive",
      inactiveAt: serverTimestamp(),
      inactiveReason: reason,
      endedAt: serverTimestamp(),
      endedReason: reason,
      endedByUserId: actorId,
      endedByName: actorName,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  return activeRows.length;
};
