const routePermissionRules = [
  [/^\/company\/customers\/createnew/i, "12"],
  [/^\/company\/customers\/bulk-upload/i, "12"],
  [/^\/company\/customers/i, "10"],

  [/^\/company\/jobs\/createnew/i, "22"],
  [/^\/company\/jobs/i, "20"],

  [/^\/company\/repair-requests\/create/i, "32"],
  [/^\/company\/repair-requests/i, "30"],

  [/^\/company\/servicelocations\/createnew/i, "42"],
  [/^\/company\/servicelocations/i, "40"],

  [/^\/company\/bodiesofwater\/createnew/i, "52"],
  [/^\/company\/bodiesofwater/i, "50"],

  [/^\/company\/equipment\/createnew/i, "62"],
  [/^\/company\/equipment/i, "60"],

  [/^\/company\/fleet/i, "290"],

  [/^\/company\/route-dashboard/i, "210"],
  [/^\/company\/route-day-management/i, "210"],
  [/^\/company\/routing/i, "210"],
  [/^\/company\/route-management/i, "230"],
  [/^\/company\/route-builder/i, "232"],

  [/^\/company\/servicestops\/createnew/i, "242"],
  [/^\/company\/servicestops/i, "240"],
  [/^\/company\/recurringservicestop/i, "240"],
  [/^\/company\/recurring-service-stops/i, "242"],

  [/^\/company\/companyusers\/createnew/i, "262"],
  [/^\/company\/companyusers/i, "260"],
  [/^\/company\/user-dashboard/i, "260"],
  [/^\/company\/invites/i, "262"],

  [/^\/company\/roles/i, "860"],
  [/^\/company\/worklogs/i, "280"],
  [/^\/company\/associatedbusiness/i, "260"],

  [/^\/company\/payroll/i, "400"],
  [/^\/company\/accounting/i, "400"],
  [/^\/company\/sales/i, "400"],
  [/^\/company\/purchased-items/i, "400"],
  [/^\/company\/purchaseditems/i, "400"],
  [/^\/company\/receipts/i, "400"],
  [/^\/company\/contract/i, "600"],
  [/^\/company\/recurring-contracts/i, "600"],
  [/^\/company\/laborcontracts/i, "260"],
  [/^\/company\/recurringlaborcontracts/i, "260"],

  [/^\/company\/leads\/new/i, "612"],
  [/^\/company\/leads\/[^/]+\/edit/i, "614"],
  [/^\/company\/leads/i, "610"],
  [/^\/company\/customers\/create-from-lead/i, "612"],
  [/^\/company\/estimates\/create/i, "622"],
  [/^\/company\/estimates\/schedule/i, "622"],
  [/^\/company\/estimates/i, "620"],
  [/^\/company\/vendors/i, "600"],

  [/^\/company\/taskgroups\/createnew/i, "822"],
  [/^\/company\/taskgroups/i, "820"],
  [/^\/company\/readingsanddosages/i, "840"],
  [/^\/company\/items\/createnew/i, "852"],
  [/^\/company\/items\/bulk-upload/i, "852"],
  [/^\/company\/items/i, "850"],
  [/^\/company\/reports/i, "870"],
  [/^\/company\/migration/i, "800"],
  [/^\/company\/settings\/payroll-setup/i, "400"],
  [/^\/company\/settings\/terms-templates/i, "880"],
  [/^\/company\/settings\/job-templates/i, "820"],
  [/^\/company\/settings\/subscriptions/i, "890"],
  [/^\/company\/managesubscriptions/i, "890"],
  [/^\/company\/subscriptionmanagement/i, "890"],
  [/^\/company\/emailconfiguration/i, "830"],
  [/^\/company\/companyinfo/i, "810"],
  [/^\/company\/settings/i, "800"],

  [/^\/company\/operations-dashboard/i, "0"],
];

const publicCompanyRoutePatterns = [
  /^\/company\/dashboard/i,
  /^\/company\/selector/i,
  /^\/company\/selection/i,
  /^\/company\/profile/i,
  /^\/company\/messages/i,
  /^\/company\/public-profile/i,
  /^\/company\/reviews/i,
  /^\/success/i,
  /^\/cancel/i,
];

export const getCompanyPermissionForPath = (path = "") => {
  if (publicCompanyRoutePatterns.some((pattern) => pattern.test(path))) return null;

  const match = routePermissionRules.find(([pattern]) => pattern.test(path));
  return match ? match[1] : null;
};

export const roleHasCompanyPermission = (companyRole, permissionId) => {
  if (permissionId === undefined || permissionId === null || permissionId === "") return true;
  if (!companyRole) return false;
  if (!Array.isArray(companyRole.permissionIdList)) return true;

  return companyRole.permissionIdList.map(String).includes(String(permissionId));
};
