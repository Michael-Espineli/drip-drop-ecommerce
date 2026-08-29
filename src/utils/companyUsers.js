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

export const isActiveCompanyUser = (companyUser = {}) => {
  const status = cleanString(companyUser.status || companyUser.userStatus).toLowerCase();
  return companyUser.isActive !== false && companyUser.active !== false && status !== "inactive";
};

export const isLikelyAdminCompanyUser = (companyUser = {}) => {
  const searchable = [
    companyUser.roleName,
    companyUser.role,
    companyUser.workerType,
  ].map(cleanString).join(" ").toLowerCase();

  return ["owner", "admin", "manager", "office"].some((term) => searchable.includes(term));
};

export const filterCompanyUserAdminOptions = (companyUsers = []) => {
  const activeUsers = companyUsers.filter(isActiveCompanyUser);
  const adminUsers = activeUsers.filter(isLikelyAdminCompanyUser);

  return adminUsers.length ? adminUsers : activeUsers;
};
