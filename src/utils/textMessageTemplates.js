import { collection } from "firebase/firestore";

export const TEXT_MESSAGE_TEMPLATE_COLLECTION = Object.freeze([
  "settings",
  "textTemplates",
  "templates",
]);

export const TEXT_MESSAGE_TEMPLATE_TOKENS = Object.freeze([
  { token: "{{customerName}}", label: "Customer" },
  { token: "{{customerFirstName}}", label: "First Name" },
  { token: "{{technicianName}}", label: "Technician" },
  { token: "{{companyName}}", label: "Company" },
  { token: "{{serviceDate}}", label: "Service Date" },
  { token: "{{serviceTime}}", label: "Service Time" },
  { token: "{{serviceAddress}}", label: "Address" },
  { token: "{{poolName}}", label: "Pool" },
]);

export const DEFAULT_TEXT_MESSAGE_TEMPLATES = Object.freeze([
  {
    id: "pre_arrival",
    name: "On My Way",
    description: "Let the customer know the technician is headed to the property.",
    body: "Hi {{customerFirstName}}, this is {{technicianName}} with {{companyName}}. I am on my way to service your pool at {{serviceAddress}} today.",
    sortOrder: 10,
    active: true,
  },
  {
    id: "arrival_notice",
    name: "Arrived",
    description: "Let the customer know service is beginning.",
    body: "Hi {{customerFirstName}}, this is {{technicianName}} with {{companyName}}. I just arrived and am starting your pool service now.",
    sortOrder: 20,
    active: true,
  },
  {
    id: "running_late",
    name: "Running Late",
    description: "Send a quick schedule update when the route is behind.",
    body: "Hi {{customerFirstName}}, this is {{technicianName}} with {{companyName}}. I am running a little behind today, but your pool service is still on my route.",
    sortOrder: 30,
    active: true,
  },
  {
    id: "access_issue",
    name: "Access Issue",
    description: "Ask the customer for help when the technician cannot access the pool.",
    body: "Hi {{customerFirstName}}, this is {{technicianName}} with {{companyName}}. I am at {{serviceAddress}} and cannot access the pool area. Could you please let me know the best way in?",
    sortOrder: 40,
    active: true,
  },
  {
    id: "service_complete",
    name: "Service Complete",
    description: "Let the customer know the visit is complete.",
    body: "Hi {{customerFirstName}}, this is {{technicianName}} with {{companyName}}. Your pool service at {{serviceAddress}} is complete. Thank you!",
    sortOrder: 50,
    active: true,
  },
]);

const cleanString = (value = "") => String(value || "").trim();

const getDateValue = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = getDateValue(value);
  if (!date) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatTime = (value) => {
  const date = getDateValue(value);
  if (!date) return "";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

const splitName = (name = "") => {
  const parts = cleanString(name).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
};

export const textMessageTemplatesRef = (db, companyId) => (
  collection(db, "companies", companyId, ...TEXT_MESSAGE_TEMPLATE_COLLECTION)
);

export const normalizeTextMessageTemplate = (template = {}, fallbackIndex = 0) => {
  const id = cleanString(template.id || template.templateId);
  const name = cleanString(template.name) || "Text Template";
  const body = cleanString(template.body || template.content || template.message);

  return {
    ...template,
    id,
    name,
    description: cleanString(template.description),
    body,
    sortOrder: Number.isFinite(Number(template.sortOrder))
      ? Number(template.sortOrder)
      : (fallbackIndex + 1) * 10,
    active: template.active !== false,
  };
};

export const sortTextMessageTemplates = (templates = []) => (
  [...templates].sort((left, right) => (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
    String(left.name || "").localeCompare(String(right.name || ""))
  ))
);

export const mergeTextMessageTemplates = (companyTemplates = [], { includeInactive = false } = {}) => {
  const merged = new Map();

  DEFAULT_TEXT_MESSAGE_TEMPLATES.forEach((template, index) => {
    merged.set(template.id, normalizeTextMessageTemplate({
      ...template,
      isBuiltInDefault: true,
      isSaved: false,
    }, index));
  });

  companyTemplates.forEach((template, index) => {
    const normalized = normalizeTextMessageTemplate({
      ...template,
      isBuiltInDefault: DEFAULT_TEXT_MESSAGE_TEMPLATES.some((item) => item.id === (template.id || template.templateId)),
      isSaved: true,
    }, DEFAULT_TEXT_MESSAGE_TEMPLATES.length + index);

    if (normalized.id) {
      merged.set(normalized.id, normalized);
    }
  });

  return sortTextMessageTemplates([...merged.values()])
    .filter((template) => includeInactive || template.active !== false);
};

export const buildServiceStopTextTemplateContext = ({
  stop = {},
  customer = {},
  serviceLocation = {},
  route = {},
  company = {},
} = {}) => {
  const customerName =
    cleanString(customer.customerName) ||
    cleanString(customer.displayName) ||
    cleanString(customer.label) ||
    cleanString(customer.company) ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    cleanString(stop.customerName);
  const { firstName } = splitName(customer.firstName || customerName);
  const address = stop.address || serviceLocation.address || {};
  const serviceAddress = [
    address.streetAddress || stop.streetAddress || serviceLocation.streetAddress,
    address.city || stop.city || serviceLocation.city,
    address.state || stop.state || serviceLocation.state,
    address.zip || address.zipCode || stop.zip || serviceLocation.zip || serviceLocation.zipCode,
  ].filter(Boolean).join(", ");
  const serviceDate = stop.serviceDate || route.date;
  const serviceTime = stop.startTime || stop.scheduledStartTime || stop.serviceDate;

  return {
    customerName,
    customerFirstName: firstName || customerName,
    technicianName: cleanString(route.techName) || cleanString(stop.tech) || cleanString(stop.techName),
    companyName: cleanString(company.name) || cleanString(company.companyName) || cleanString(stop.companyName),
    serviceDate: formatDate(serviceDate),
    serviceTime: formatTime(serviceTime),
    serviceAddress,
    poolName:
      cleanString(stop.poolName) ||
      cleanString(serviceLocation.poolName) ||
      cleanString(serviceLocation.nickName) ||
      cleanString(serviceLocation.name),
    serviceLocationName:
      cleanString(serviceLocation.nickName) ||
      cleanString(serviceLocation.name) ||
      cleanString(stop.serviceLocationName),
    stopType: cleanString(stop.type) || cleanString(stop.serviceStopTypeName),
  };
};

export const renderTextMessageTemplate = (template = {}, context = {}) => {
  const body = cleanString(template.body || template.content || template.message);

  return body.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match, key) => (
    cleanString(context[key])
  ));
};

export const normalizeSmsPhoneNumber = (value = "") => {
  const text = cleanString(value);
  if (!text) return "";

  const hasLeadingPlus = text.startsWith("+");
  const digits = text.replace(/\D/g, "");

  if (!digits) return "";
  return `${hasLeadingPlus ? "+" : ""}${digits}`;
};

export const getBestSmsPhoneNumber = ({ stop = {}, customer = {}, serviceLocation = {} } = {}) => (
  normalizeSmsPhoneNumber(
    stop.customerPhoneNumber ||
    stop.phoneNumber ||
    stop.phone ||
    customer.phoneNumber ||
    customer.phone ||
    customer.mainContact?.phoneNumber ||
    customer.contact?.phoneNumber ||
    serviceLocation.mainContact?.phoneNumber ||
    serviceLocation.phoneNumber ||
    serviceLocation.phone
  )
);

export const buildSmsHref = (phoneNumber, body) => {
  const phone = normalizeSmsPhoneNumber(phoneNumber);
  if (!phone) return "";

  return `sms:${phone}?body=${encodeURIComponent(cleanString(body))}`;
};
