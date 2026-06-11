const cleanString = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const normalizeCustomerDuplicateText = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

export const normalizeCustomerEmail = (value) => cleanString(value).toLowerCase();

export const normalizeCustomerPhone = (value) => cleanString(value).replace(/\D/g, "");

const uniqueStrings = (values = []) => {
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

const addressKey = (address = {}) =>
  normalizeCustomerDuplicateText(
    [
      address.streetAddress ?? address.address,
      address.city,
      address.state,
      address.zip ?? address.zipCode,
    ]
      .map(cleanString)
      .filter(Boolean)
      .join("|")
  );

export const getCustomerDuplicateDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    const companyName = cleanString(customer.company ?? customer.companyName);
    if (companyName) return companyName;
  }

  return (
    [customer.firstName, customer.lastName].map(cleanString).filter(Boolean).join(" ") ||
    cleanString(customer.customerName) ||
    cleanString(customer.company ?? customer.companyName) ||
    cleanString(customer.email) ||
    cleanString(customer.id)
  );
};

export const buildCustomerDuplicateKeys = (customer = {}) => {
  const displayName = normalizeCustomerDuplicateText(getCustomerDuplicateDisplayName(customer));
  const billingAddressKey = addressKey(customer.billingAddress ?? customer.address);
  const emails = uniqueStrings([
    customer.email,
    customer.customerEmail,
    ...(customer.sourceContactFields?.emails || []),
  ]);
  const phones = uniqueStrings([
    customer.phoneNumber,
    customer.customerPhone,
    ...(customer.sourceContactFields?.phones || []),
  ]);

  return uniqueStrings([
    ...emails.map(normalizeCustomerEmail).filter(Boolean).map((email) => `email:${email}`),
    ...phones
      .map(normalizeCustomerPhone)
      .filter((phone) => phone.length >= 7)
      .map((phone) => `phone:${phone.length > 10 ? phone.slice(-10) : phone}`),
    displayName && billingAddressKey ? `name_address:${displayName}|${billingAddressKey}` : "",
    customer.migrationSource?.sourceCustomerKey
      ? `migration_customer:${normalizeCustomerDuplicateText(customer.migrationSource.sourceCustomerKey)}`
      : "",
    customer.stripeCustomerId ? `stripe_customer:${cleanString(customer.stripeCustomerId)}` : "",
  ]);
};

export const findDuplicateCustomerMatches = (candidateCustomer = {}, existingCustomers = []) => {
  const candidateKeys = new Set(buildCustomerDuplicateKeys(candidateCustomer));
  if (candidateKeys.size === 0) return [];

  return existingCustomers
    .filter((customer) => customer?.id && customer.id !== candidateCustomer.id)
    .map((customer) => {
      const existingKeys = buildCustomerDuplicateKeys(customer);
      const matchedKeys = existingKeys.filter((key) => candidateKeys.has(key));

      return {
        customer,
        matchedKeys,
        displayName: getCustomerDuplicateDisplayName(customer),
      };
    })
    .filter((match) => match.matchedKeys.length > 0);
};

export const describeDuplicateCustomerMatch = (match = {}) => {
  const key = match.matchedKeys?.[0] || "";
  if (key.startsWith("email:")) return "email";
  if (key.startsWith("phone:")) return "phone";
  if (key.startsWith("name_address:")) return "name and billing address";
  if (key.startsWith("migration_customer:")) return "source customer key";
  if (key.startsWith("stripe_customer:")) return "Stripe customer";
  return "matching identity";
};
