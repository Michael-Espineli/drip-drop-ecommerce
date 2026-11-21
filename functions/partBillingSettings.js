const customerBillingEnabled = (company = {}, settings = {}) =>
  settings.customerBillingEnabled ?? company.customerBillingEnabled ??
    (company.salesBillingEnabled === true || company.salesBillingAutomationEnabled === true);

module.exports = { customerBillingEnabled };
