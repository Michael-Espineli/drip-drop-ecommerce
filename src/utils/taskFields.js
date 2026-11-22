const retiredTaskFields = new Set([
  "contractedRate", "contractedRateCents", "contractRateCents", "rate", "rateCents", "laborCost", "laborCostCents",
  "costCents", "plannedLaborCostCents", "billingLaborPriceCents", "customerLaborPriceCents", "billingLaborRateCents",
  "laborBillingRateCents", "billableLaborCents", "billingLaborCents", "billingLaborPrice", "customerPrice", "unitAmountCents",
  "priceCents", "taxable", "payTypeId", "payTypeName", "payWorkTypeId", "payWorkTypeName", "workTypeId", "workTypeName",
  "payrollMode", "payQuantity", "payrollStackBehavior", "payrollAgreement", "manualPayOverrideCents", "manualPayOverrideNotes",
  "workOfferId", "workOfferClaimId", "claimedWorkOfferId",
]);

export const operationalTask = (task = {}) => Object.fromEntries(
  Object.entries(task).filter(([field]) => !retiredTaskFields.has(field))
);
