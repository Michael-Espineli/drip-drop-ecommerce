import {
  OFFERED_WORK_PERMISSION_ID,
  SERVICE_AGREEMENTS_PERMISSION_ID,
  SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID,
} from "./companyPermissions";

const routePermissionRules = [
  [/^\/company\/shopping-list\/create/i, "102"],
  [/^\/company\/(shopping-list|shopping-purchase-reconciliation)/i, "100"],
  [/^\/company\/part-approvals/i, "400"],
  [/^\/company\/suggested-work/i, "30"],
  [/^\/company\/(chemicalHistory|serviceHistory)/i, "10"],
  [/^\/company\/(StripeProfile|stripe-subscriptions)/i, "408"],
  [/^\/company\/customers\/createnew/i, "12"],
  [/^\/company\/customers\/bulk-upload/i, "910"],
  [/^\/company\/customers\/tags/i, "14"],
  [/^\/company\/customers\/create-from-lead/i, "612"],
  [/^\/company\/customers/i, "10"],

  [/^\/company\/jobs\/basic-create/i, SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID],
  [/^\/company\/jobs\/createnew/i, "22"],
  [/^\/company\/jobs/i, "20"],
  [/^\/company\/offered-work/i, OFFERED_WORK_PERMISSION_ID],

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
  [/^\/company\/invites/i, "262"],

  [/^\/company\/roles/i, "860"],
  [/^\/company\/worklogs/i, "280"],
  [/^\/company\/associatedbusiness/i, "260"],
  [/^\/company\/setup-guide/i, "900"],

  [/^\/company\/payroll/i, "420"],
  [/^\/company\/accounting/i, "400"],
  [/^\/company\/sales\/pnl-viewer/i, "420"],
  [/^\/company\/sales\/agreements/i, SERVICE_AGREEMENTS_PERMISSION_ID],
  [/^\/company\/sales/i, "400"],
  [/^\/company\/purchased-items/i, "100"],
  [/^\/company\/purchaseditems/i, "100"],
  [/^\/company\/receipts/i, "100"],
  [/^\/company\/contract/i, "600"],
  [/^\/company\/recurring-contracts/i, "600"],
  [/^\/company\/laborcontracts/i, "260"],
  [/^\/company\/recurringlaborcontracts/i, "260"],

  [/^\/company\/leads\/new/i, "612"],
  [/^\/company\/leads\/[^/]+\/edit/i, "614"],
  [/^\/company\/leads/i, "610"],
  [/^\/company\/pipeline/i, "630"],
  [/^\/company\/initial-estimates/i, "620"],
  [/^\/company\/estimates\/create/i, "622"],
  [/^\/company\/estimates\/schedule/i, "622"],
  [/^\/company\/estimates/i, "620"],
  [/^\/company\/vendors/i, "600"],

  [/^\/company\/taskgroups\/createnew/i, "822"],
  [/^\/company\/taskgroups/i, "820"],
  [/^\/company\/readingsanddosages/i, "840"],
  [/^\/company\/product-catalog/i, "850"],
  [/^\/company\/items\/createnew/i, "852"],
  [/^\/company\/items\/bulk-upload/i, "910"],
  [/^\/company\/items/i, "850"],
  [/^\/company\/reports/i, "870"],
  [/^\/company\/migration/i, "910"],
  [/^\/company\/settings\/payroll-setup/i, "420"],
  [/^\/company\/settings\/company-wide/i, "900"],
  [/^\/company\/settings\/tester-strips/i, "900"],
  [/^\/company\/settings\/onboarding-checklist/i, "900"],
  [/^\/company\/settings\/text-templates/i, "900"],
  [/^\/company\/settings\/product-catalog/i, "850"],
  [/^\/company\/settings\/vendor-items\/createnew/i, "852"],
  [/^\/company\/settings\/vendor-items\/bulk-upload/i, "910"],
  [/^\/company\/settings\/vendor-items/i, "850"],
  [/^\/company\/settings\/stop-data/i, "840"],
  [/^\/company\/settings\/terms-templates/i, "880"],
  [/^\/company\/settings\/job-templates/i, "920"],
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
  /^\/company\/my-pay(?:\/|$)/i,
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
  if (!Array.isArray(companyRole.permissionIdList)) return false;

  const permissions = companyRole.permissionIdList.map(String);
  return permissions.includes(String(permissionId)) || (String(permissionId) === '400' && permissions.includes('404')) || (String(permissionId) === '420' && permissions.includes('424')) || (String(permissionId) === '860' && ['862','864','866'].some(id => permissions.includes(id)));
};

export const canManageCustomerBilling = (context = {}) => {
  const { companyRole, companyOwnerId, companyUserAccess, user } = context;
  if (companyOwnerId && companyOwnerId === user?.uid) return true;
  if (companyUserAccess && (companyUserAccess.active === false || companyUserAccess.isActive === false || companyUserAccess.accessActive === false || companyUserAccess.revoked === true ||
    [companyUserAccess.status, companyUserAccess.userStatus, companyUserAccess.companyUserStatus, companyUserAccess.accessStatus, companyUserAccess.userAccessStatus].some(status => ['inactive', 'revoked', 'past', 'deleted', 'declined', 'pending', 'invited', 'rejected', 'canceled', 'cancelled', 'expired'].includes(String(status || '').trim().toLowerCase())))) return false;
  if (['owner', 'admin', 'manager'].includes(String(companyUserAccess?.roleName || '').trim().toLowerCase())) return true;
  if (!companyRole) return false;
  return Array.isArray(companyRole.permissionIdList) && companyRole.permissionIdList.map(String).includes('404');
};


export const canDelegateCompanyRole = ({ currentRole, targetRole, userId, companyOwnerId }) => {
  if (userId && userId === companyOwnerId) return true;
  if (!currentRole || !targetRole || currentRole.id === targetRole.id || targetRole.id === "1") return false;
  if (["owner", "admin", "manager"].includes(String(targetRole.name || "").toLowerCase())) return false;
  const protectedIds = ["262","264","266","274","404","408","424","862","864","866","890"];
  return Array.isArray(targetRole.permissionIdList) && Array.isArray(currentRole.permissionIdList) &&
    targetRole.permissionIdList.every(id => !protectedIds.includes(String(id)) && currentRole.permissionIdList.map(String).includes(String(id)));
};
