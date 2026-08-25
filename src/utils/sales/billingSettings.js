export const SALES_BILLING_AUTOMATION_FIELD = 'salesBillingAutomationEnabled';
export const CUSTOMER_BILLING_ENABLED_FIELD = 'customerBillingEnabled';
export const SALES_CREATE_BILLING_SUBSCRIPTION_ON_ACCEPTANCE_FIELD = 'salesCreateBillingSubscriptionOnAcceptanceDefault';
export const SHOPPING_ITEM_INSTALL_INVOICE_AUTOMATION_FIELD = 'shoppingItemInstallInvoiceAutomationEnabled';

export const isCustomerBillingEnabled = (companyData = {}) => (
  companyData?.[CUSTOMER_BILLING_ENABLED_FIELD] === true ||
  companyData?.salesBillingEnabled === true ||
  companyData?.[SALES_BILLING_AUTOMATION_FIELD] === true
);

export const shouldCreateBillingSubscriptionOnAgreementAcceptance = (companyData = {}) => {
  if (typeof companyData?.[SALES_CREATE_BILLING_SUBSCRIPTION_ON_ACCEPTANCE_FIELD] === 'boolean') {
    return companyData[SALES_CREATE_BILLING_SUBSCRIPTION_ON_ACCEPTANCE_FIELD] === true;
  }

  return companyData?.[SALES_BILLING_AUTOMATION_FIELD] === true ||
    companyData?.salesBillingEnabled === true ||
    companyData?.[CUSTOMER_BILLING_ENABLED_FIELD] === true;
};

export const isSalesBillingAutomationEnabled = shouldCreateBillingSubscriptionOnAgreementAcceptance;

export const isShoppingItemInstallInvoiceAutomationEnabled = (companyData = {}) => (
  companyData?.[SHOPPING_ITEM_INSTALL_INVOICE_AUTOMATION_FIELD] === true
);
