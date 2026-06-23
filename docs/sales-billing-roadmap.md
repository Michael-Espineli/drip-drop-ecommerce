# Sales Billing Roadmap

Feature flag: `feature_flag_004` (`Sales`)

Email delivery flag: `feature_flag_012` (`Turn on real emails`)

## Purpose

Sales is the finance workspace for customer billing. It should support two billing flows:

- Recurring billing for monthly pool service.
- One-off billing from job detail views.

The one-off flow should stay owned by jobs. When purchased materials are assigned to a job, the job should handle customer billing for those materials instead of the purchased item being billed separately.

## Current Implementation Snapshot

The Sales workflow now has enough structure to support a real billing rollout in phases:

- `feature_flag_004` exposes the Sales workspace under Finance.
- `src/views/company/sales/Sales.jsx` reads company-scoped sales records and summarizes agreements, billing profiles, billing subscriptions, invoices, accounts receivable, and payments.
- `src/views/company/sales/SalesFinanceBoard.jsx` gives operators working views for invoices, payments, and subscriptions, including manual payment recording.
- `src/views/company/sales/SalesCatalogItems.jsx` manages company-owned catalog building blocks for estimates, service agreements, invoices, and future Stripe handoff.
- `src/views/company/sales/CreateSalesAgreement.jsx` and `src/views/company/sales/SalesAgreementDetail.jsx` support service agreement drafting, terms snapshots, pricing lines, internal manual acceptance, service agreement email send, and Stripe checkout handoff after acceptance.
- `src/views/company/sales/CreateSalesInvoice.jsx` and `src/views/company/sales/SalesInvoiceDetail.jsx` support manual one-time invoices, editable invoice lines, customer email delivery, voiding, write-offs, and manual payment recording.
- `src/views/company/sales/components/BillingReadinessCard.jsx` checks whether the selected company's connected Stripe account can bill customers and gives the company a setup link when action is needed.
- `functions/stripe/stripeCallableForConnectedAccounts.js` can create sales billing subscription checkout sessions on the connected account, update Sales records, and apply configured platform fee percentages.
- `functions/stripe/stripeWebHooks.js` syncs Stripe subscription, invoice, payment, connected account, external account, and payout events back into DripDrop Sales and company records.
- `src/views/company/settings/StripeBillingSnapshot.jsx` is a separate owner-only Stripe readiness page linked from company Settings.
- `src/views/admin/billing/BillingFeeCalculator.jsx` gives admins payment-fee comparison tables, custom transaction testing, Firebase cost estimates, and platform-fee coverage estimates.

## Pricing, Stripe Connect, And Platform Fee Decision

DripDrop owns the estimate and billing building blocks. Stripe is the payment rail and subscription/invoice processor, not the source of truth for what a pool company quoted.

Companies subscribe to DripDrop for the base web app. Customer payment processing happens through the pool company's Stripe connected account so the company can collect customer payments and receive payouts. DripDrop can collect a platform fee from connected-account Stripe billing to help cover Firebase, hosting, support, and billing workflow costs.

Current working pricing assumptions:

- Card platform fee target: `0.08%`.
- ACH platform fee target: `0.19%`.
- ACH is the strongest competitive path because Stripe ACH plus the DripDrop fee can stay around QuickBooks' public ACH rate while still creating platform margin.
- Card fees are more sensitive because Stripe's fixed card fee affects smaller invoices. The admin Billing Calculator should be used before changing public pricing.

Important implementation note: Stripe subscription `application_fee_percent` is a single subscription-level percentage. If DripDrop truly needs different platform percentages for card vs ACH on the same subscription, that needs an explicit follow-up design instead of relying on one static `application_fee_percent`.

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
- Recurring subscriptions can start as manual DripDrop invoices until the customer completes Stripe autopay setup.
- Once autopay is active, Stripe subscription webhooks should continue syncing invoice, payment, and failure state back to Sales.
- Application/platform fee percent can be sourced from the billing subscription, company configuration, or environment default.

### Company-Owned Catalog

- Company pricing building blocks should be company scoped because each pool company has its own pricing and terms.
- Use `companies/{companyId}/salesCatalogItems` for reusable sales building blocks.
- Keep Terms Templates at `companies/{companyId}/termsTemplates`. Do not move Terms Templates to a top-level collection without confirming the data model first.

### Connected Account Ownership

- Each app user can have a customer `stripeId` for subscribing to DripDrop.
- Each company should have one `stripeConnectedAccountId` for customer billing and payouts.
- The connected account setup/manage action should be owner-only in the company UI.
- Multi-company users should always act against the selected company's `stripeConnectedAccountId`, not a user-level connected account id.
- The company record remains the source of truth for which connected account belongs to that company.

### Webhook And Snapshot Payload Setup

- Use Stripe webhook snapshot payloads for the current implementation.
- The webhook handler expects classic Stripe events with `event.data.object`.
- Configure a Connected accounts webhook endpoint for connected account events.
- Configure a Your account webhook endpoint if DripDrop platform subscription billing also needs to sync through the same function.
- Store one signing secret in `STRIPE_WEBHOOK_SECRET` or multiple secrets in comma-separated `STRIPE_WEBHOOK_SECRETS`.
- The current deployed webhook URL is `https://stripewebhook-52bwqpekza-uc.a.run.app`.
- Required events include connected account updates, external account updates, payouts, checkout sessions, customer subscription changes, invoice finalized/paid/payment failed, and subscription deleted.

## Service Agreement Email Readiness

Before a company sends a service agreement, DripDrop should have a complete agreement record and a stable customer-facing snapshot. Email should notify the homeowner that the agreement is ready; it should not be the only place where the agreement exists.

Required before send:

- A `salesAgreements` draft that includes company id, customer id, service location id, billing cadence, pricing, status, and owner references.
- A copied terms snapshot from `companies/{companyId}/termsTemplates`, plus any company edits made for this specific customer. Future template edits should not rewrite already-sent agreements.
- Line item snapshots from `companies/{companyId}/salesCatalogItems` or job estimate lines. Store names, descriptions, quantities, unit amounts, totals, tax flags, catalog item ids, and Stripe references if available.
- A secure review URL for the customer portal. For homeowners without accounts, support a signed email link or a company-side manual acceptance flow.
- Company email settings, including from address, reply-to address, display name, phone number, and support/contact URLs.
- SendGrid dynamic template id for service agreements. The starter template lives at `docs/sendgrid-service-agreement-template.html`. The callable prefers `SEND_GRID_SERVICE_AGREEMENT_TEMPLATE_ID` and falls back to `d-866f4368544048aeabf108413f8b8c52` while the Sales slice is being tested.
- `feature_flag_012` controls real customer email delivery. When disabled, service agreement email sends to the internal test inbox while recording the intended customer recipient on the agreement.
- A callable send workflow that validates the company, customer, service location, and agreement ownership before emailing.
- Delivery tracking on the agreement, including `sentAt`, `sentBy`, destination email, SendGrid message id when available, and status transition from `draft` to `sent`.

After send:

- The customer can review and accept or decline the agreement.
- Acceptance should record accepted timestamp, customer user id when signed in, signed-link id when not signed in, and the final accepted snapshot.
- Billing should start only after acceptance, unless the company explicitly marks the agreement accepted manually.
- Stripe subscriptions, invoices, receipts, manual payments, and Accounts Receivable records should reference the accepted DripDrop agreement instead of replacing it.

## Core Records

Current model names live in `src/utils/models/Sales.js`.

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

### Payment And Payment Event

Payment history should support both app-collected and manually recorded payments:

- Stripe card and ACH payments.
- Cash, check, bank transfer, external card, and other manual payments.
- Payment status, amount, source invoice, source subscription, and source agreement.
- Stripe payment intent, charge, invoice, receipt, and failure references when available.
- Payment event history so webhook updates do not overwrite the audit trail.

### Payout

Connected account payouts should be visible to owners and admins:

- Store recent connected account payouts under `companies/{companyId}/stripePayouts`.
- Also keep root `stripePayouts` records for admin/reconciliation needs.
- Track payout status, amount, arrival date, destination, failure reason, and last Stripe event id.

## Web First Slice

- Add Sales under Finance nav.
- Use `src/views/company/sales/Sales.jsx` as the Sales workspace.
- Keep one-off billing linked to job detail billing.
- Add recurring billing pages after the service agreement model is decided.
- Keep the separate owner-only Stripe Billing Snapshot linked from company Settings.
- Keep admin billing calculators under `/admin/billing-fee-calculator` for pricing, Firebase cost, and payment volume tests.

## iOS First Slice

- Add Sales under the Finance overview.
- Use `SalesFinanceView` as the iOS Sales workspace.
- Keep job billing actions in Job Detail.
- Use feature flag 4 to make the Sales area easy to enable when ready.

## Deployment And Operations Notes

- Upgrade Firebase Functions off Node.js 20 before the next production deployment window. Firebase deploy output warned that Node.js 20 decommissions on `2026-10-30`.
- Keep Stripe API keys and webhook signing secrets out of tracked source.
- Use the Admin Billing Calculator to estimate whether base subscription fees plus platform fees cover Firebase usage.
- Use snapshot webhook payloads until the webhook handler is intentionally rewritten to support Stripe thin events.
- Before enabling real billing for companies, test Stripe account setup, checkout, subscription sync, invoice sync, payment failure sync, and payout sync with Stripe test events.

## What To Work On Next

Recommended next implementation order:

1. Finalize platform-fee policy.
   Decide whether the first production rollout uses one flat subscription-level `application_fee_percent` or needs method-specific card/ACH fee logic.

2. Finish production webhook setup.
   Create the Stripe snapshot webhook endpoints, set the signing secret environment variables, send test events, and verify the Stripe Billing Snapshot page changes from missing/stale to synced.

3. Harden the customer acceptance path.
   Finish signed customer review URLs, homeowner acceptance/decline, manual company acceptance rules, and acceptance audit fields before broad use.

4. Complete payment method and autopay UX.
   Make it obvious when a customer still needs to add ACH/card autopay and when a subscription is still running as manual invoices.

5. Build the recurring billing run.
   Add a monthly run or queue that creates recurring invoice drafts, identifies exceptions, prevents duplicate period billing, and supports review before sending.

6. Connect job detail one-off billing.
   Generate Sales invoices from accepted job estimates and assigned purchased materials while keeping the job as the owner of that one-off billing flow.

7. Improve reconciliation.
   Link payouts back to payments/invoices where possible, expose payout status in admin/company finance views, and add export/reporting for deposits.

8. Add guardrails and tests.
   Add callable and webhook tests for connected account ownership, multi-company users, subscription checkout, invoice/payment webhook sync, and manual payment balance updates.

## Open Decisions

- Whether service agreements live in a new `serviceAgreements` collection or migrate from `recurringContracts`.
- Whether billing runs create invoice drafts immediately or stage draft line items first.
- How recurring service stop completion should affect monthly billing exceptions.
- Whether skipped service stops create credits automatically or only flag the invoice for review.
- Whether platform fee percent should be company-level, subscription-level, environment default, or method-specific by payment rail.
- Whether the first production billing rollout should be ACH-first, card-and-ACH, or manual invoice first with autopay opt-in.
- Whether payout reconciliation should be company-facing only, admin-facing only, or both.
