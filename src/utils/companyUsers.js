const cleanString = (value) => String(value || "").trim();

export const getCompanyUserDisplayName = (user = {}, fallback = "Company User") => (
  cleanString(user.userName)
  || cleanString(user.displayName)
  || [user.firstName, user.lastName].map(cleanString).filter(Boolean).join(" ")
  || cleanString(user.name)
  || cleanString(user.label)
  || cleanString(user.email)
  || cleanString(user.userId)
  || cleanString(user.id)
  || fallback
);

export const compareCompanyUsersByName = (left = {}, right = {}) => (
  getCompanyUserDisplayName(left).localeCompare(getCompanyUserDisplayName(right), undefined, {
    numeric: true,
    sensitivity: "base",
  })
);

export const sortCompanyUsersByName = (users = []) => (
  [...users].sort(compareCompanyUsersByName)
);
