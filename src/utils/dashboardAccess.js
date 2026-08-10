export const DASHBOARD_SCOPE_IDS = {
  personal: "personal",
  regional: "regional",
  company: "company",
};

export const DASHBOARD_SCOPE_ACCESS_OPTIONS = [
  {
    id: DASHBOARD_SCOPE_IDS.personal,
    label: "Personal",
    description: "User can see their own assigned work and activity.",
  },
  {
    id: DASHBOARD_SCOPE_IDS.regional,
    label: "Regional",
    description: "User can see work grouped by assigned customer tags.",
  },
  {
    id: DASHBOARD_SCOPE_IDS.company,
    label: "Whole Company",
    description: "User can see all loaded company dashboard data.",
  },
];

export const DEFAULT_DASHBOARD_SCOPE_ACCESS = DASHBOARD_SCOPE_ACCESS_OPTIONS.map((scope) => scope.id);

const dashboardScopeSet = new Set(DEFAULT_DASHBOARD_SCOPE_ACCESS);

export const normalizeDashboardScopeAccess = (scopeIds) => {
  if (!Array.isArray(scopeIds)) return [...DEFAULT_DASHBOARD_SCOPE_ACCESS];

  const normalized = scopeIds
    .map((scopeId) => String(scopeId || "").trim())
    .filter((scopeId) => dashboardScopeSet.has(scopeId));

  return [...new Set(normalized)];
};

export const sourceHasDashboardScopeAccessFields = (source = {}) => Boolean(
  source &&
    (
      Array.isArray(source.dashboardScopeAccess) ||
      Array.isArray(source.allowedDashboardScopes) ||
      source.dashboardScopeAccessMode
    )
);

export const getDashboardScopeAccessList = (source = {}) => normalizeDashboardScopeAccess(
  source?.dashboardScopeAccess ||
    source?.allowedDashboardScopes ||
    DEFAULT_DASHBOARD_SCOPE_ACCESS
);

export const getEffectiveDashboardScopeAccess = ({ userAccess, role } = {}) => {
  if (userAccess?.dashboardScopeAccessMode === "custom" || Array.isArray(userAccess?.dashboardScopeAccess)) {
    return {
      scopes: getDashboardScopeAccessList(userAccess),
      source: "user",
    };
  }

  if (sourceHasDashboardScopeAccessFields(role)) {
    return {
      scopes: getDashboardScopeAccessList(role),
      source: "role",
    };
  }

  return {
    scopes: [...DEFAULT_DASHBOARD_SCOPE_ACCESS],
    source: "default",
  };
};
