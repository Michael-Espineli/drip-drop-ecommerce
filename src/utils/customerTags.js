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

export const getCustomerTagAccessList = (source) =>
  normalizeCustomerTags(
    source?.customerRegionTags ||
      source?.regionalCustomerTags ||
      source?.regionalTags ||
      source?.customerTagAccess ||
      source?.allowedCustomerTags ||
      source?.customerTags ||
      []
  );

export const hasFullCustomerRegionAccess = (source) => {
  if (!source) return true;
  if (source.fullCustomerRegionAccess === true || source.fullRegionalAccess === true) return true;
  if (source.regionalAccessMode === "all" || source.customerRegionAccessMode === "all") return true;
  if (source.fullCustomerRegionAccess === false || source.fullRegionalAccess === false) return false;
  if (source.regionalAccessMode === "limited" || source.customerRegionAccessMode === "limited") return false;
  return getCustomerTagAccessList(source).length === 0;
};

export const getRoleCustomerTagAccess = (role) => getCustomerTagAccessList(role);

export const getEffectiveCustomerRegionAccess = ({ userAccess, role } = {}) => {
  const userHasRegionalFields = Boolean(
    userAccess &&
      (
        userAccess.fullCustomerRegionAccess !== undefined ||
        userAccess.fullRegionalAccess !== undefined ||
        userAccess.regionalAccessMode ||
        userAccess.customerRegionAccessMode ||
        getCustomerTagAccessList(userAccess).length > 0
      )
  );

  const source = userHasRegionalFields ? userAccess : role;
  const fullAccess = hasFullCustomerRegionAccess(source);

  return {
    fullAccess,
    tags: fullAccess ? [] : getCustomerTagAccessList(source),
    source: userHasRegionalFields ? "user" : "role",
  };
};

export const getCustomerRegionAccessTags = (context = {}) =>
  getEffectiveCustomerRegionAccess(context).tags;

export const customerMatchesRoleTagAccess = (customer, role) => {
  const allowedTags = getRoleCustomerTagAccess(role);
  if (allowedTags.length === 0) return true;
  return customerHasAnyTag(customer, allowedTags);
};

export const customerMatchesRegionalAccess = (customer, context = {}) => {
  if (context.regionalAccessEnabled === false) return true;

  const access = getEffectiveCustomerRegionAccess(context);
  if (!access.fullAccess && !customerHasAnyTag(customer, access.tags)) return false;

  const selectedRegionTag = normalizeCustomerTag(context.selectedRegionTag);
  if (selectedRegionTag && !customerHasAnyTag(customer, [selectedRegionTag])) return false;

  return true;
};

export const filterCustomersByRoleTagAccess = (customers = [], role) =>
  customers.filter((customer) => customerMatchesRoleTagAccess(customer, role));

export const filterCustomersByRegionalAccess = (customers = [], context = {}) =>
  customers.filter((customer) => customerMatchesRegionalAccess(customer, context));

export const filterRecordsByCustomerTags = ({
  records = [],
  customersById,
  role,
  userAccess,
  selectedTags = [],
  selectedRegionTag = "",
  regionalAccessEnabled = true,
}) => {
  const selected = normalizeCustomerTags(selectedTags);
  const access = regionalAccessEnabled ? getEffectiveCustomerRegionAccess({ userAccess, role }) : { fullAccess: true };
  const regionTag = regionalAccessEnabled ? normalizeCustomerTag(selectedRegionTag) : "";

  if (selected.length === 0 && !regionTag && access.fullAccess) return records;

  return records.filter((record) => {
    const customerId = record.customerId || record.internalCustomerId || record.customer?.id;
    const customer = customerId ? customersById.get(customerId) : null;
    if (!customer) return false;

    return (
      customerMatchesRegionalAccess(customer, { userAccess, role, selectedRegionTag: regionTag, regionalAccessEnabled }) &&
      customerHasAnyTag(customer, selected)
    );
  });
};
