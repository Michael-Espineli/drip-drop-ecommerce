# Sales Billing Roadmap

Feature flag: `feature_flag_004` (`Sales`)

Email delivery flag: `feature_flag_005` (`Turn on real emails`)

## Purpose

Sales is the finance workspace for customer billing. It should support two billing flows:

- Recurring billing for monthly pool service.
- One-off billing from job detail views.

The one-off flow should stay owned by jobs. When purchased materials are assigned to a job, the job should handle customer billing for those materials instead of the purchased item being billed separately.

## Pricing And Stripe Product Decision

DripDrop owns the estimate and billing building blocks. Stripe is the payment rail and subscription/invoice processor, not the source of truth for what a pool company quoted.

### Job Detail Estimates

- Job Detail estimates should assemble company-owned building blocks into a customer-facing estimate snapshot.
- Building blocks can come from labor, planned service stops, materials, fees, discounts, tax, and manual line items.
- Do not create a permanent Stripe Product and Price for every custom job estimate.
- When a job estimate is accepted and billed through Stripe, create Stripe invoice items or ad hoc price data on the connected account from the accepted DripDrop snapshot.
- Keep the accepted estimate, invoice, payment records, Accounts Receivable, manual payments, and billing history in DripDrop.

### Recurring Customer Billing

- Use reusable Stripe Products and Prices for recurring service offerings such as monthly residential service, twice-weekly service, and commercial service.
- Store the app-side agreement and billing subscription in Sales so the company can still track the customer, terms, service location, and billing status inside DripDrop.
- Stripe subscription ids, product ids, price ids, invoice ids, and payment ids should be references attached to the DripDrop records, not replacements for them.

### Company-Owned Catalog

- Company pricing building blocks should be company scoped because each pool company has its own pricing and terms.
- Use `companies/{companyId}/salesCatalogItems` for reusable sales building blocks.
- Keep Terms Templates at `companies/{companyId}/termsTemplates`. Do not move Terms Templates to a top-level collection without confirming the data model first.

## Service Agreement Email Readiness

Before a company sends a service agreement, DripDrop should have a complete agreement record and a stable customer-facing snapshot. Email should notify the homeowner that the agreement is ready; it should not be the only place where the agreement exists.

Required before send:

- A `salesAgreements` draft that includes company id, customer id, service location id, billing cadence, pricing, status, and owner references.
- A copied terms snapshot from `companies/{companyId}/termsTemplates`, plus any company edits made for this specific customer. Future template edits should not rewrite already-sent agreements.
- Line item snapshots from `companies/{companyId}/salesCatalogItems` or job estimate lines. Store names, descriptions, quantities, unit amounts, totals, tax flags, catalog item ids, and Stripe references if available.
- A secure review URL for the customer portal. For homeowners without accounts, support a signed email link or a company-side manual acceptance flow.
- Company email settings, including from address, reply-to address, display name, phone number, and support/contact URLs.
- SendGrid dynamic template id for service agreements. The starter template lives at `docs/sendgrid-service-agreement-template.html`. The callable prefers `SEND_GRID_SERVICE_AGREEMENT_TEMPLATE_ID` and falls back to `d-866f4368544048aeabf108413f8b8c52` while the Sales slice is being tested.
- `feature_flag_005` controls real customer email delivery. When disabled, service agreement email sends to `michaelespineli@murdockpoolservice.com` for testing while recording the intended customer recipient on the agreement.
- A callable send workflow that validates the company, customer, service location, and agreement ownership before emailing.
- Delivery tracking on the agreement, including `sentAt`, `sentBy`, destination email, SendGrid message id when available, and status transition from `draft` to `sent`.

After send:

- The customer can review and accept or decline the agreement.
- Acceptance should record accepted timestamp, customer user id when signed in, signed-link id when not signed in, and the final accepted snapshot.
- Billing should start only after acceptance, unless the company explicitly marks the agreement accepted manually.
- Stripe subscriptions, invoices, receipts, manual payments, and Accounts Receivable records should reference the accepted DripDrop agreement instead of replacing it.

## Core Records

### Billing Account

Customer-level billing profile:

- Customer id and service location ids.
- Invoice delivery preferences.
- Payment terms.
- Tax settings.
- Default billing contact.
- Stripe/customer payment references when available.

### Service Agreement

Replacement direction for old recurring contracts:

- Customer id and service location id.
- Monthly price stored in cents.
- Billing cadence and billing day.
- Start date, optional end date, status.
- Included service expectations.
- Chemical/material inclusion rules.
- Link to recurring service stop or route setup when applicable.

### Billing Run

Monthly batch workflow:

- Company id.
- Billing period start and end.
- Draft, reviewed, finalized, sent, paid, failed statuses.
- Generated invoice draft ids.
- Exceptions for customers that need review.

### Invoice

Shared customer-facing bill:

- Customer id, billing account id, optional job id, optional service agreement id.
- Status: draft, estimate, accepted, in progress, invoiced, paid, void, expired.
- Totals in cents.
- Line items.
- Tax, discounts, credits, payments.

### Invoice Line Item

Reusable line item shape:

- Source type: recurring service, job labor, service stop labor, purchased material, manual item, discount, credit, tax.
- Source id.
- Description.
- Quantity.
- Unit price in cents.
- Total in cents.
- Taxable.

## Web First Slice

- Add Sales under Finance nav.
- Use `src/views/company/sales/Sales.jsx` as the Sales workspace.
- Keep one-off billing linked to job detail billing.
- Add recurring billing pages after the service agreement model is decided.

## iOS First Slice

- Add Sales under the Finance overview.
- Use `SalesFinanceView` as the iOS Sales workspace.
- Keep job billing actions in Job Detail.
- Use feature flag 4 to make the Sales area easy to enable when ready.

## Open Decisions

- Whether service agreements live in a new `serviceAgreements` collection or migrate from `recurringContracts`.
- Whether billing runs create invoice drafts immediately or stage draft line items first.
- How recurring service stop completion should affect monthly billing exceptions.
- Whether skipped service stops create credits automatically or only flag the invoice for review.
