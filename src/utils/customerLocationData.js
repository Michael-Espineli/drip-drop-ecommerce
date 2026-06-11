import { buildCustomerDuplicateKeys } from './customerDuplicates';

export const asString = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  return String(value);
};

export const asBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(normalized)) return true;
    if (['false', 'no', '0'].includes(normalized)) return false;
  }

  return fallback;
};

export const asNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

export const asInteger = (value, fallback = 0) => {
  const numberValue = asNumber(value, fallback);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
};

export const asStringArray = (value, fallback = []) => {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item).trim()).filter(Boolean);
  }

  const text = asString(value).trim();
  return text ? [text] : fallback;
};

export const normalizeDateValue = (value, fallback = null) => {
  if (!value) return fallback;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? fallback : new Date(millis);
  }

  return fallback;
};

export const normalizeAddress = (address = {}) => {
  const source = address && typeof address === 'object' ? address : {};
  const zip = asString(source.zip ?? source.zipCode).trim();

  return {
    streetAddress: asString(source.streetAddress ?? source.address).trim(),
    city: asString(source.city).trim(),
    state: asString(source.state).trim(),
    zip,
    zipCode: zip,
    latitude: asNumber(source.latitude, 0),
    longitude: asNumber(source.longitude, 0),
  };
};

export const normalizeContact = (contact = {}) => {
  const source = contact && typeof contact === 'object' ? contact : {};

  return {
    id: asString(source.id).trim(),
    name: asString(source.name).trim(),
    phoneNumber: asString(source.phoneNumber ?? source.phone).trim(),
    email: asString(source.email).trim(),
    notes: asString(source.notes),
  };
};

export const formatAddressLabel = (address = {}) => (
  [
    address.streetAddress,
    address.city,
    address.state,
    address.zip || address.zipCode,
  ].map((part) => asString(part).trim()).filter(Boolean).join(' ')
);

export const getCustomerDisplayName = (customer = {}) => {
  if (asBoolean(customer.displayAsCompany, false)) {
    const companyName = asString(customer.company ?? customer.companyName).trim();
    if (companyName) return companyName;
  }

  const personName = [customer.firstName, customer.lastName]
    .map((part) => asString(part).trim())
    .filter(Boolean)
    .join(' ');

  return personName || asString(customer.email).trim() || asString(customer.id).trim();
};

export const normalizeCustomerForFirestore = (customer = {}) => {
  const active = asBoolean(customer.active ?? customer.isActive, true);
  const normalized = {
    id: asString(customer.id).trim(),
    firstName: asString(customer.firstName).trim(),
    lastName: asString(customer.lastName).trim(),
    email: asString(customer.email).trim(),
    billingAddress: normalizeAddress(customer.billingAddress ?? customer.address),
    phoneNumber: asString(customer.phoneNumber ?? customer.phone).trim(),
    phoneLabel: asString(customer.phoneLabel).trim(),
    active,
    isActive: active,
    company: asString(customer.company ?? customer.companyName).trim(),
    displayAsCompany: asBoolean(customer.displayAsCompany, false),
    hireDate: customer.hireDate ?? null,
    billingNotes: asString(customer.billingNotes),
    tags: asStringArray(customer.tags),
    linkedCustomerIds: asStringArray(customer.linkedCustomerIds),
    linkedCustomerUserId: asString(customer.linkedCustomerUserId).trim(),
    linkedHomeownerUserId: asString(customer.linkedHomeownerUserId).trim(),
    relationshipId: asString(customer.relationshipId).trim(),
    customerCompanyRelationshipId: asString(customer.customerCompanyRelationshipId).trim(),
    linkedStatus: asString(customer.linkedStatus).trim(),
    linkedEmail: asString(customer.linkedEmail).trim(),
    linkedAt: customer.linkedAt ?? null,
    linkedInviteId: asString(customer.linkedInviteId).trim(),
  };

  return {
    ...normalized,
    duplicateKeys: asStringArray([
      ...asStringArray(customer.duplicateKeys),
      ...buildCustomerDuplicateKeys({
        ...customer,
        ...normalized,
      }),
    ]),
  };
};

export const normalizeServiceLocationForFirestore = (serviceLocation = {}) => {
  const address = normalizeAddress(serviceLocation.address);
  const isActive = asBoolean(serviceLocation.isActive ?? serviceLocation.active, true);
  const label = asString(serviceLocation.label).trim() || formatAddressLabel(address);

  return {
    id: asString(serviceLocation.id).trim(),
    nickName: asString(serviceLocation.nickName ?? serviceLocation.name).trim(),
    address,
    gateCode: asString(serviceLocation.gateCode).trim(),
    dogName: asStringArray(serviceLocation.dogName),
    estimatedTime: asInteger(serviceLocation.estimatedTime, 0),
    mainContact: normalizeContact(serviceLocation.mainContact),
    notes: asString(serviceLocation.notes),
    bodiesOfWaterId: asStringArray(serviceLocation.bodiesOfWaterId),
    rateType: asString(serviceLocation.rateType),
    laborType: asString(serviceLocation.laborType),
    chemicalCost: asString(serviceLocation.chemicalCost),
    laborCost: asString(serviceLocation.laborCost),
    rate: asString(serviceLocation.rate),
    customerId: asString(serviceLocation.customerId).trim(),
    customerName: asString(serviceLocation.customerName).trim(),
    backYardTree: asStringArray(serviceLocation.backYardTree),
    backYardBushes: asStringArray(serviceLocation.backYardBushes),
    backYardOther: asStringArray(serviceLocation.backYardOther),
    preText: asBoolean(serviceLocation.preText, false),
    verified: asBoolean(serviceLocation.verified, false),
    photoUrls: Array.isArray(serviceLocation.photoUrls) ? serviceLocation.photoUrls : [],
    label,
    isActive,
    active: isActive,
  };
};
