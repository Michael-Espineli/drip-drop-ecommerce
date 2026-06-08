# SendGrid Template Map

This is the current backend email surface area and the matching Dynamic Template file to use in SendGrid.

## Already Covered

### Service Agreement / One-Time Estimate

- Template file: `docs/sendgrid-service-agreement-template.html`
- Callable: `sendServiceAgreementEmail`
- Backend template id source: `SEND_GRID_SERVICE_AGREEMENT_TEMPLATE_ID` or `SENDGRID_SERVICE_AGREEMENT_TEMPLATE_ID`
- Current fallback id: `d-866f4368544048aeabf108413f8b8c52`
- Notes: Current web job estimates create a sales agreement snapshot and send through this flow, so this template also covers one-time job estimates as long as the agreement title/line items/terms are populated as estimate content.

### Service Stop Report / Weekly Service Report

- Template source: pasted Weekly Service Report template
- Callable: `sendServiceReportOnFinish`
- Backend template id source: company email configuration `sendGridTemplateId`
- Current fallback id: `d-a987a065df0e43378dafd14c1b7ee419`
- Notes: Used for route, job visit summary, customer relationship visit recap, and other service stop recap categories unless the company category settings override the template id.

## Added Here

### Sales Invoice

- Template file: `docs/sendgrid-sales-invoice-template.html`
- Callable: `sendSalesInvoiceEmail`
- Backend template id source: `SEND_GRID_SALES_INVOICE_TEMPLATE_ID` or `SENDGRID_SALES_INVOICE_TEMPLATE_ID`
- Current fallback behavior: sends generated fallback HTML when no template id is configured.

### Job Estimate Recap

- Template file: `docs/sendgrid-job-estimate-recap-template.html`
- Callable: `sendJobEstimateEmail`
- Backend template id source: currently hardcoded as `d-566087cd96864db0a07167e8a080cc12`
- Notes: I do not see the current web UI calling this callable. It may still matter for iOS or legacy flows.

### Legacy Invoice

- Template file: `docs/sendgrid-legacy-invoice-template.html`
- Callable: `sendInvoiceEmail`
- Backend template id source: currently hardcoded as `d-16d13e4c5d7e4c6f91667c76a3513c41`
- Notes: This is different from the newer sales invoice flow.

### Payment Confirmation

- Template file: `docs/sendgrid-payment-confirmation-template.html`
- Callable: `sendPaymentConfirmationEmail`
- Backend template id source: currently hardcoded as `d-6f7f138176c747be80aabd671e67577a`

## Shared Customer Access Variables

Several newer templates may receive these fields:

- `customerActionUrl`
- `customerPortalUrl`
- `claimAccountUrl`
- `homeownerSignInUrl`
- `homeownerSignUpUrl`
- `primaryCustomerUrl`
- `shouldShowClaimAccountLink`
- `deliveryMode`
- `intendedCustomerEmail`
- `actualRecipientEmail`

