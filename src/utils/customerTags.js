export const normalizeCustomerTag = (tag) => String(tag || "").trim();

export const normalizeCustomerTags = (tags) => {
  const rawTags = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(",")
        .map((tag) => tag.trim());

  const seen = new Set();
  return rawTags.reduce((normalizedTags, tag) => {
    const normalizedTag = normalizeCustomerTag(tag);
    const key = normalizedTag.toLowerCase();

    if (!normalizedTag || seen.has(key)) return normalizedTags;

    seen.add(key);
    normalizedTags.push(normalizedTag);
    return normalizedTags;
  }, []);
};

export const customerHasAnyTag = (customer, tags) => {
  const customerTags = normalizeCustomerTags(customer?.tags).map((tag) => tag.toLowerCase());
  const selectedTags = normalizeCustomerTags(tags).map((tag) => tag.toLowerCase());

  if (selectedTags.length === 0) return true;
  return selectedTags.some((tag) => customerTags.includes(tag));
};

export const getCustomerTagOptions = (customers = []) => {
  const tags = customers.flatMap((customer) => normalizeCustomerTags(customer?.tags));
  return normalizeCustomerTags(tags).sort((a, b) => a.localeCompare(b));
};

export const getRoleCustomerTagAccess = (role) =>
  normalizeCustomerTags(
    role?.customerTagAccess ||
      role?.allowedCustomerTags ||
      role?.customerTags ||
      []
  );

export const customerMatchesRoleTagAccess = (customer, role) => {
  const allowedTags = getRoleCustomerTagAccess(role);
  if (allowedTags.length === 0) return true;
  return customerHasAnyTag(customer, allowedTags);
};

export const filterCustomersByRoleTagAccess = (customers = [], role) =>
  customers.filter((customer) => customerMatchesRoleTagAccess(customer, role));

export const filterRecordsByCustomerTags = ({
  records = [],
  customersById,
  role,
  selectedTags = [],
}) => {
  const selected = normalizeCustomerTags(selectedTags);
  const roleTags = getRoleCustomerTagAccess(role);

  if (selected.length === 0 && roleTags.length === 0) return records;

  return records.filter((record) => {
    const customerId = record.customerId || record.internalCustomerId || record.customer?.id;
    const customer = customerId ? customersById.get(customerId) : null;
    if (!customer) return false;

    return customerMatchesRoleTagAccess(customer, role) && customerHasAnyTag(customer, selected);
  });
};
