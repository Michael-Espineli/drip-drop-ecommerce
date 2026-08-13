export const ACCOUNT_TYPES = Object.freeze({
  admin: "Admin",
  company: "Company",
  client: "Client",
});

const ACCOUNT_TYPE_ALIASES = Object.freeze({
  admin: ACCOUNT_TYPES.admin,
  administrator: ACCOUNT_TYPES.admin,
  company: ACCOUNT_TYPES.company,
  seller: ACCOUNT_TYPES.company,
  technician: ACCOUNT_TYPES.company,
  tech: ACCOUNT_TYPES.company,
  employee: ACCOUNT_TYPES.company,
  contractor: ACCOUNT_TYPES.company,
  client: ACCOUNT_TYPES.client,
  homeowner: ACCOUNT_TYPES.client,
  customer: ACCOUNT_TYPES.client,
});

export const normalizeAccountType = (accountType) => {
  const normalizedKey = String(accountType || "").trim().toLowerCase();
  return ACCOUNT_TYPE_ALIASES[normalizedKey] || null;
};
