export const COMPANY_WIDE_SETTINGS_DOC_ID = "companyWide";
export const PAYROLL_ENABLED_FIELD = "payrollEnabled";

export const DEFAULT_COMPANY_WORK_SETTINGS = {
  customerBillingEnabled: false,
  salesCreateBillingSubscriptionOnAcceptanceDefault: true,
  payrollEnabled: true,
  workOffersGoLiveByDefault: true,
  workOffersRequireApprovalBeforePosting: false,
  workOffersAutoAssignOnAcceptance: true,
  workOffersRequireApprovalBeforeAssignment: false,
  technicianCanOfferFullRoutes: true,
  technicianCanOfferPartialRoutes: true,
  technicianCanOfferOneOffJobs: true,
  technicianCanOfferRecurringWork: false,
  managementCanOfferAnyWork: true,
  workOfferIncentivesCreatePayrollLines: true,
};

const boolWithDefault = (value, defaultValue) =>
  typeof value === "boolean" ? value : defaultValue;

export const isPayrollEnabled = (settings = {}) => {
  const data = settings || {};

  if (data[PAYROLL_ENABLED_FIELD] === false) return false;
  if (data.companyPayrollEnabled === false) return false;
  if (data.payrollDisabled === true) return false;

  return true;
};

export const normalizeCompanyWorkSettings = (settings = {}) => {
  const data = settings || {};
  const legacyBillingEnabled = data.customerBillingEnabled === true ||
    data.salesBillingEnabled === true ||
    data.salesBillingAutomationEnabled === true;
  const customerBillingEnabled = boolWithDefault(
    data.customerBillingEnabled,
    legacyBillingEnabled
  );

  return {
    customerBillingEnabled,
    salesCreateBillingSubscriptionOnAcceptanceDefault: customerBillingEnabled && boolWithDefault(
      data.salesCreateBillingSubscriptionOnAcceptanceDefault,
      boolWithDefault(data.salesBillingAutomationEnabled, DEFAULT_COMPANY_WORK_SETTINGS.salesCreateBillingSubscriptionOnAcceptanceDefault)
    ),
    payrollEnabled: isPayrollEnabled(data),
    workOffersGoLiveByDefault: boolWithDefault(
      data.workOffersGoLiveByDefault,
      !boolWithDefault(data.workOffersRequireApprovalBeforePosting, false)
    ),
    workOffersRequireApprovalBeforePosting: boolWithDefault(
      data.workOffersRequireApprovalBeforePosting,
      DEFAULT_COMPANY_WORK_SETTINGS.workOffersRequireApprovalBeforePosting
    ),
    workOffersAutoAssignOnAcceptance: boolWithDefault(
      data.workOffersAutoAssignOnAcceptance,
      !boolWithDefault(data.workOffersRequireApprovalBeforeAssignment, false)
    ),
    workOffersRequireApprovalBeforeAssignment: boolWithDefault(
      data.workOffersRequireApprovalBeforeAssignment,
      DEFAULT_COMPANY_WORK_SETTINGS.workOffersRequireApprovalBeforeAssignment
    ),
    technicianCanOfferFullRoutes: boolWithDefault(
      data.technicianCanOfferFullRoutes,
      DEFAULT_COMPANY_WORK_SETTINGS.technicianCanOfferFullRoutes
    ),
    technicianCanOfferPartialRoutes: boolWithDefault(
      data.technicianCanOfferPartialRoutes,
      DEFAULT_COMPANY_WORK_SETTINGS.technicianCanOfferPartialRoutes
    ),
    technicianCanOfferOneOffJobs: boolWithDefault(
      data.technicianCanOfferOneOffJobs,
      DEFAULT_COMPANY_WORK_SETTINGS.technicianCanOfferOneOffJobs
    ),
    technicianCanOfferRecurringWork: boolWithDefault(
      data.technicianCanOfferRecurringWork,
      DEFAULT_COMPANY_WORK_SETTINGS.technicianCanOfferRecurringWork
    ),
    managementCanOfferAnyWork: boolWithDefault(
      data.managementCanOfferAnyWork,
      DEFAULT_COMPANY_WORK_SETTINGS.managementCanOfferAnyWork
    ),
    workOfferIncentivesCreatePayrollLines: boolWithDefault(
      data.workOfferIncentivesCreatePayrollLines,
      DEFAULT_COMPANY_WORK_SETTINGS.workOfferIncentivesCreatePayrollLines
    ),
  };
};

export const workOfferPostingStatusFor = ({ offerType = "Internal Board", settings = {} } = {}) => {
  const normalizedSettings = normalizeCompanyWorkSettings(settings);
  if (!normalizedSettings.workOffersGoLiveByDefault || normalizedSettings.workOffersRequireApprovalBeforePosting) {
    return "Pending Approval";
  }

  return offerType === "Direct User" ? "Sent" : "Posted";
};

export const workOfferAssignmentStatusFor = (settings = {}) => {
  const normalizedSettings = normalizeCompanyWorkSettings(settings);
  return normalizedSettings.workOffersAutoAssignOnAcceptance &&
    !normalizedSettings.workOffersRequireApprovalBeforeAssignment
    ? "Assigned"
    : "Assignment Pending Approval";
};
