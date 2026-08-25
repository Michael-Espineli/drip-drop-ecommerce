import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import PaymentMethodSelector from '../../../components/sales/PaymentMethodSelector';
import LineItemSectionTables from '../../../components/billing/LineItemSectionTables';
import { Context } from '../../../context/AuthContext';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { db, functions } from '../../../utils/config';
import {
  SalesAgreementChemicalBillingMode,
  SalesAgreementStatus,
  salesCollectionNames,
} from '../../../utils/models/Sales';
import {
  formatBillingFrequency,
  formatServiceFrequency,
} from '../../../utils/sales/agreementCadence';
import {
  getJobPlanDisplayName,
  getJobPlanRecommendationDisplay,
} from '../../../utils/models/JobPlan';
import {
  agreementChemicalBillingMode,
  chemicalBillingLabel,
} from '../../../utils/sales/chemicalBilling';
import { SalesPaymentMethodType } from '../../../utils/sales/paymentMethodFees';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const isEstimateAgreement = (agreement = {}) => {
  const sourceType = normalizeStatus(agreement.sourceType);
  const rateType = normalizeStatus(agreement.rateType);
  const serviceCadence = normalizeStatus(agreement.serviceCadence);

  return (
    sourceType === 'oneoffjob' ||
    sourceType === 'workoffer' ||
    sourceType === 'lead' ||
    rateType === 'onetime' ||
    serviceCadence === 'onetime'
  );
};

const agreementRecordLabel = (agreement = {}) => (
  isEstimateAgreement(agreement) ? 'Estimate' : 'Service Agreement'
);

const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(millis));
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const customerCanViewAgreement = (agreement = {}, user = {}) => {
  const customerUserId = String(agreement.customerUserId || '').trim();
  if (customerUserId) return customerUserId === user?.uid;

  const authEmail = normalizeEmail(user?.email);
  const agreementEmail = normalizeEmail(agreement.email || agreement.customerEmail || agreement.billingEmail);
  return Boolean(authEmail && agreementEmail && authEmail === agreementEmail);
};

const statusTone = {
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  superseded: 'border-violet-200 bg-violet-50 text-violet-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  revised: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  expired: 'border-slate-200 bg-slate-100 text-slate-600',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || statusTone.draft;

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(status)}
    </span>
  );
};

const Field = ({ label, value }) => (
  <div>
    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-sm font-semibold text-slate-950">{value || 'Not set'}</dd>
  </div>
);

const DocumentField = ({ label, value }) => (
  <div className="border-t border-slate-200 pt-3">
    <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 text-sm font-semibold leading-5 text-slate-950">{value || 'Not provided'}</dd>
  </div>
);

const DocumentSection = ({ number, title, children }) => (
  <section className="border-t border-slate-300 py-6 first:border-t-0 first:pt-0">
    <div className="mb-4 flex items-baseline gap-3">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{number}</span>
      <h2 className="text-base font-bold uppercase tracking-wide text-slate-950">{title}</h2>
    </div>
    {children}
  </section>
);

const normalizeList = (value) => (
  Array.from(new Set(
    (Array.isArray(value) ? value : String(value || '').split(/[\n,]/))
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ))
);

const renewalPreviousAgreementId = (agreement = {}) => (
  agreement.supersedesAgreementId ||
  agreement.previousAgreementId ||
  agreement.renewalSourceAgreementId ||
  ''
);

const firstText = (...values) => (
  values.map((value) => String(value || '').trim()).find(Boolean) || ''
);

const addressLine = (location = {}) => {
  const streetAddress = firstText(location.streetAddress, location.address01, location.address);
  const address02 = firstText(location.address02, location.unit, location.apt);
  const cityStateZip = [
    firstText(location.city),
    firstText(location.state),
    firstText(location.zip, location.zipCode),
  ].filter(Boolean).join(' ');

  return [streetAddress, address02, cityStateZip].filter(Boolean).join(', ');
};

const agreementServiceLocationDisplay = (agreement = {}) => {
  const snapshots = Array.isArray(agreement.serviceLocationSnapshots)
    ? agreement.serviceLocationSnapshots
    : [];
  const snapshotLines = snapshots.map((snapshot) => {
    const name = firstText(snapshot.nickName, snapshot.nickname, snapshot.name, snapshot.serviceLocationName);
    const address = addressLine(snapshot);
    return [name, address].filter(Boolean).join(' - ');
  }).filter(Boolean);

  if (snapshotLines.length > 0) return snapshotLines.join('; ');

  return firstText(
    agreement.serviceLocationName,
    agreement.address01,
    agreement.streetAddress,
    agreement.serviceLocationIds?.[0],
    ''
  );
};

const chemicalSelectionDisplay = (ids = [], keywords = []) => {
  const keywordItems = normalizeList(keywords);
  const idItems = normalizeList(ids);
  const parts = [];

  if (keywordItems.length > 0) parts.push(keywordItems.join(', '));
  if (idItems.length > 0) parts.push(`Selected dosage templates: ${idItems.join(', ')}`);

  return parts.join('; ');
};

const chemicalBillingExplanation = (agreement = {}, details = {}) => {
  const mode = agreementChemicalBillingMode(agreement);

  if (mode === SalesAgreementChemicalBillingMode.billAllSeparately) {
    return 'Chemicals are not included in the recurring service price. Chemical products or dosages used for service may be invoiced separately from regular pool service.';
  }

  if (mode === SalesAgreementChemicalBillingMode.mixed) {
    if (details.separatelyBilledChemicalDisplay) {
      return 'Routine service includes standard chemical treatment except for the specific chemicals or dosage templates listed as billed separately.';
    }

    if (details.includedChemicalDisplay) {
      return 'Only the chemicals or dosage templates listed as included are part of the recurring service price. Other chemical products may be billed separately.';
    }

    return 'Chemical billing is mixed. The company may include some chemical treatment in regular service and bill other chemical products separately as described in the notes below.';
  }

  return 'Routine chemical treatment is included in the recurring service price unless this agreement lists specific billed-separately or customer-purchased chemicals.';
};

const escapeAgreementHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

const agreementHtmlWithBreaks = (value) => escapeAgreementHtml(value).replace(/\n/g, '<br>');

const agreementTermText = (term) => {
  if (typeof term === 'string') return term;
  return term?.description || term?.value || term?.text || '';
};

const agreementTermTitle = (term) => {
  if (typeof term === 'string') return '';
  return term?.title || term?.label || '';
};

const agreementLineItemTotalCents = (item = {}) => {
  const explicitTotal = Number(item.totalAmountCents);
  if (Number.isFinite(explicitTotal)) return explicitTotal;

  const quantity = Number(item.quantity || 1) || 1;
  return (Number(item.unitAmountCents || item.amountCents || 0) || 0) * quantity;
};

const printableAgreementTermsHtml = (agreement = {}) => {
  const termsText = String(agreement.terms || '').trim();
  const termsList = Array.isArray(agreement.termsList) ? agreement.termsList : [];

  if (termsText) {
    return `<p class="preline">${agreementHtmlWithBreaks(termsText)}</p>`;
  }

  if (termsList.length) {
    return `
      <ol>
        ${termsList.map((term) => {
    const title = agreementTermTitle(term);
    const description = agreementTermText(term);
    return `
            <li>
              ${title ? `<strong>${escapeAgreementHtml(title)}</strong>` : ''}
              ${description ? `<div class="preline">${agreementHtmlWithBreaks(description)}</div>` : ''}
            </li>
          `;
  }).join('')}
      </ol>
    `;
  }

  return '<p class="muted">No written terms were included.</p>';
};

const buildPrintableAgreementHtml = ({
  agreement = {},
  chemicalBillingDescription = '',
  customerPurchasedChemicalDisplay = '',
  displayLineItems = [],
  displayTotalAmountCents = 0,
  includedChemicalDisplay = '',
  recordLabel = 'Service Agreement',
  separatelyBilledChemicalDisplay = '',
}) => {
  const providerName = firstText(agreement.companyName, 'Pool company');
  const clientName = firstText(agreement.customerName, 'Customer');
  const clientEmail = firstText(agreement.email, agreement.customerEmail, agreement.billingEmail, 'Not provided');
  const serviceLocation = agreementServiceLocationDisplay(agreement);
  const documentTitle = firstText(agreement.title, recordLabel);
  const preparedDate = formatDate(agreement.sentAt || agreement.createdAt);
  const lineItems = Array.isArray(displayLineItems) ? displayLineItems : [];
  const lineItemRows = lineItems.length
    ? lineItems.map((item) => {
      const quantity = Number(item.quantity || 1) || 1;
      return `
        <tr>
          <td>
            <strong>${escapeAgreementHtml(item.name || item.description || 'Service')}</strong>
            ${item.description ? `<div class="muted">${agreementHtmlWithBreaks(item.description)}</div>` : ''}
          </td>
          <td>${escapeAgreementHtml(quantity)}</td>
          <td>${escapeAgreementHtml(formatCurrency(item.unitAmountCents || item.amountCents || 0))}</td>
          <td><strong>${escapeAgreementHtml(formatCurrency(agreementLineItemTotalCents(item)))}</strong></td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="4" class="muted">No services or products were included.</td></tr>';
  const chemicalRows = [
    ['Billing Treatment', chemicalBillingLabel(agreement)],
    ['Billed Separately', separatelyBilledChemicalDisplay],
    ['Included Chemicals', includedChemicalDisplay],
    ['Customer Purchased Or Supplied', customerPurchasedChemicalDisplay],
    ['Chemical Billing Notes', agreement.chemicalBillingNotes],
  ].filter(([, value]) => String(value || '').trim());

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeAgreementHtml(providerName)} - ${escapeAgreementHtml(documentTitle)}</title>
        <style>
          @page { margin: 0.45in; size: Letter; }
          * { box-sizing: border-box; }
          body {
            background: #ffffff;
            color: #0f172a;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
            line-height: 1.45;
            margin: 0;
          }
          .page {
            margin: 0 auto;
            max-width: 7.7in;
            padding: 0.35in;
          }
          header {
            border-bottom: 2px solid #0f172a;
            margin-bottom: 20px;
            padding-bottom: 14px;
          }
          h1 {
            font-size: 19px;
            letter-spacing: 0;
            margin: 0 0 8px;
            text-transform: uppercase;
          }
          h2 {
            border-top: 1px solid #94a3b8;
            font-size: 11px;
            letter-spacing: 0;
            margin: 18px 0 8px;
            padding-top: 10px;
            text-transform: uppercase;
          }
          p { margin: 0 0 8px; }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th,
          td {
            border: 1px solid #cbd5e1;
            padding: 7px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background: #f1f5f9;
            color: #475569;
            font-size: 9px;
            text-transform: uppercase;
          }
          ol {
            margin: 0;
            padding-left: 18px;
          }
          li { margin-bottom: 6px; }
          .document-meta {
            color: #475569;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            font-size: 10px;
            text-transform: uppercase;
          }
          .summary-grid {
            display: grid;
            gap: 8px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            margin-top: 10px;
          }
          .summary-cell {
            border: 1px solid #cbd5e1;
            padding: 8px;
          }
          .summary-cell span {
            color: #475569;
            display: block;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
          }
          .summary-cell strong {
            display: block;
            margin-top: 3px;
          }
          .muted {
            color: #475569;
            font-size: 10px;
            font-weight: 400;
            margin-top: 3px;
          }
          .preline { white-space: pre-line; }
          .signature-grid {
            display: grid;
            gap: 26px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            margin-top: 32px;
          }
          .signature-line {
            border-top: 1px solid #0f172a;
            padding-top: 5px;
          }
          footer {
            align-items: center;
            color: #475569;
            display: flex;
            font-size: 10px;
            justify-content: space-between;
            margin-top: 28px;
          }
          @media print {
            body { margin: 0; padding: 0; }
            .page { max-width: none; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <header>
            <h1>${escapeAgreementHtml(documentTitle)}</h1>
            <div class="document-meta">
              <span>${escapeAgreementHtml(recordLabel)}</span>
              <span>Agreement: ${escapeAgreementHtml(agreement.id || 'Not assigned')}</span>
              <span>Prepared: ${escapeAgreementHtml(preparedDate)}</span>
              <span>Status: ${escapeAgreementHtml(labelize(agreement.status || SalesAgreementStatus.draft))}</span>
            </div>
          </header>

          <h2>1. Parties And Service Location</h2>
          <p>This ${escapeAgreementHtml(recordLabel)} is between ${escapeAgreementHtml(providerName)}, the service provider, and ${escapeAgreementHtml(clientName)}, the client.</p>
          <div class="summary-grid">
            <div class="summary-cell"><span>Service Provider</span><strong>${escapeAgreementHtml(providerName)}</strong></div>
            <div class="summary-cell"><span>Client</span><strong>${escapeAgreementHtml(clientName)}</strong></div>
            <div class="summary-cell"><span>Client Email</span><strong>${escapeAgreementHtml(clientEmail)}</strong></div>
            <div class="summary-cell"><span>Service Location</span><strong>${escapeAgreementHtml(serviceLocation || 'Not provided')}</strong></div>
          </div>

          <h2>2. Term And Billing Summary</h2>
          <div class="summary-grid">
            <div class="summary-cell"><span>Start Date</span><strong>${escapeAgreementHtml(formatDate(agreement.startDate))}</strong></div>
            <div class="summary-cell"><span>Service Frequency</span><strong>${escapeAgreementHtml(formatServiceFrequency(agreement))}</strong></div>
            <div class="summary-cell"><span>Billing Frequency</span><strong>${escapeAgreementHtml(formatBillingFrequency(agreement))}</strong></div>
            <div class="summary-cell"><span>Payment Terms</span><strong>${escapeAgreementHtml(labelize(agreement.paymentTerms))}</strong></div>
            <div class="summary-cell"><span>Invoice Delivery</span><strong>${escapeAgreementHtml(labelize(agreement.invoiceDeliveryMethod))}</strong></div>
            <div class="summary-cell"><span>Total</span><strong>${escapeAgreementHtml(formatCurrency(displayTotalAmountCents))}</strong></div>
          </div>

          <h2>3. Services And Products</h2>
          ${agreement.description ? `<p class="preline">${agreementHtmlWithBreaks(agreement.description)}</p>` : ''}
          <table>
            <thead>
              <tr>
                <th>Service Or Product</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${lineItemRows}</tbody>
          </table>

          <h2>4. Chemical Billing</h2>
          <p>${escapeAgreementHtml(chemicalBillingDescription)}</p>
          <table>
            <tbody>
              ${chemicalRows.map(([label, value]) => `
                <tr>
                  <th>${escapeAgreementHtml(label)}</th>
                  <td>${agreementHtmlWithBreaks(value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <h2>5. Terms And Conditions</h2>
          ${agreement.termsTemplateName ? `<p class="muted">Terms template: ${escapeAgreementHtml(agreement.termsTemplateName)}</p>` : ''}
          ${printableAgreementTermsHtml(agreement)}

          <h2>6. Acceptance</h2>
          <p>By signing below or accepting through the provided DripDrop review link, the client authorizes the service provider to begin the services described in this agreement.</p>
          <div class="signature-grid">
            <div><div class="signature-line">Client Signature</div></div>
            <div><div class="signature-line">Date</div></div>
            <div><div class="signature-line">Service Provider Representative</div></div>
            <div><div class="signature-line">Date</div></div>
          </div>

          <footer>
            <strong>DripDrop eSign</strong>
            <span>Generated from the customer agreement review page</span>
          </footer>
        </div>
      </body>
    </html>
  `;
};

const ServiceAgreementDetail = () => {
  const { agreementId } = useParams();
  const location = useLocation();
  const { user, featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
  const userId = user?.uid;
  const userEmail = user?.email;
  const [agreement, setAgreement] = useState(null);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [acceptanceNote, setAcceptanceNote] = useState('');
  const [rejectionNote, setRejectionNote] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPricing, setAcceptedPricing] = useState(false);
  const [acceptedAutopayNotice, setAcceptedAutopayNotice] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState(SalesPaymentMethodType.ach);
  const [customerBillingPreference, setCustomerBillingPreference] = useState('requestInvoice');
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const emailParam = queryParams.get('email') || '';
  const accessTokenParam = queryParams.get('accessToken') || queryParams.get('reviewToken') || '';
  const isCustomerEmailReview = location.pathname.startsWith('/customer/service-agreements/');

  useEffect(() => {
    if (!agreementId) {
      setError('Missing service agreement id.');
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');

    if (isCustomerEmailReview && !userId) {
      if (!accessTokenParam) {
        setAgreement(null);
        setError('Open the review link from the service agreement email, or sign in with the recipient account.');
        setLoading(false);
        return undefined;
      }

      let isActive = true;

      const loadPublicAgreement = async () => {
        try {
          const getPublicAgreement = httpsCallable(functions, 'getPublicServiceAgreement');
          const result = await getPublicAgreement({
            agreementId,
            email: emailParam,
            accessToken: accessTokenParam,
          });

          if (!isActive) return;

          const nextAgreement = result.data?.agreement;
          if (!nextAgreement) {
            setAgreement(null);
            setError('Service agreement not found.');
            return;
          }

          setAgreement(nextAgreement);
        } catch (publicError) {
          console.error('Unable to load public service agreement', publicError);
          if (isActive) {
            setAgreement(null);
            setError(publicError.message || 'Unable to verify this service agreement link.');
          }
        } finally {
          if (isActive) setLoading(false);
        }
      };

      loadPublicAgreement();

      return () => {
        isActive = false;
      };
    }

    return onSnapshot(
      doc(db, salesCollectionNames.agreements, agreementId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setAgreement(null);
          setError('Service agreement not found.');
          setLoading(false);
          return;
        }

        const nextAgreement = { id: snapshot.id, ...snapshot.data() };
        if (userId && !customerCanViewAgreement(nextAgreement, { uid: userId, email: userEmail })) {
          setAgreement(null);
          setError('This service agreement does not belong to your account.');
          setLoading(false);
          return;
        }

        setAgreement(nextAgreement);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load service agreement', snapshotError);
        setError(snapshotError.message || 'Unable to load service agreement.');
        setLoading(false);
      }
    );
  }, [accessTokenParam, agreementId, emailParam, isCustomerEmailReview, userEmail, userId]);

  useEffect(() => {
    const subscriptionId = agreement?.billingSubscriptionId;
    if (!userId || !subscriptionId) {
      setBillingSubscription(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, salesCollectionNames.billingSubscriptions, subscriptionId),
      (snapshot) => {
        setBillingSubscription(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (snapshotError) => {
        console.error('Unable to load billing subscription', snapshotError);
      }
    );
  }, [agreement?.billingSubscriptionId, userId]);

  useEffect(() => {
    if (queryParams.get('stripeCheckout') === 'success') {
      toast.success('Payment setup returned from Stripe.');
    }
  }, [queryParams]);

  useEffect(() => {
    if (!agreement || signatureName) return;

    setSignatureName(agreement.customerName || user?.displayName || user?.email || emailParam || '');
  }, [agreement, emailParam, signatureName, user?.displayName, user?.email]);

  useEffect(() => {
    if (!agreement || selectedPlanId) return;
    const options = Array.isArray(agreement.planOptions) ? agreement.planOptions : Array.isArray(agreement.solutionOptions) ? agreement.solutionOptions : [];
    const defaultSolutionId =
      agreement.acceptedPlanId ||
      agreement.acceptedSolutionId ||
      agreement.selectedPlanId ||
      agreement.selectedSolutionId ||
      agreement.defaultPlanId ||
      agreement.defaultSolutionId ||
      options[0]?.planId || options[0]?.solutionId ||
      options[0]?.id ||
      '';
    if (defaultSolutionId) setSelectedPlanId(defaultSolutionId);
  }, [agreement, selectedPlanId]);

  useEffect(() => {
    if (!agreement) return;

    const savedPreference = agreement.customerBillingPreference || agreement.billingPreference || agreement.paymentPreference;
    if (savedPreference) {
      setCustomerBillingPreference(savedPreference);
    }
  }, [agreement]);

  const lineItems = useMemo(
    () => (Array.isArray(agreement?.lineItems) ? agreement.lineItems : []),
    [agreement]
  );

  const planOptions = useMemo(
    () => (Array.isArray(agreement?.planOptions) ? agreement.planOptions : Array.isArray(agreement?.solutionOptions) ? agreement.solutionOptions : []),
    [agreement]
  );

  const selectedPlanOption = useMemo(() => (
    planOptions.find((option) => (
      String(option.planId || option.solutionId || option.id || '') === String(selectedPlanId || agreement?.selectedPlanId || agreement?.selectedSolutionId || agreement?.acceptedPlanId || agreement?.acceptedSolutionId || '')
    )) || planOptions[0] || null
  ), [agreement, selectedPlanId, planOptions]);

  const displayLineItems = useMemo(() => (
    Array.isArray(selectedPlanOption?.lineItems) && selectedPlanOption.lineItems.length
      ? selectedPlanOption.lineItems
      : lineItems
  ), [lineItems, selectedPlanOption]);

  const displayTotalAmountCents = Number(
    selectedPlanOption?.totalAmountCents ||
    selectedPlanOption?.rateAmountCents ||
    agreement?.totalAmountCents ||
    agreement?.rateAmountCents ||
    0
  );

  const termsList = useMemo(
    () => (Array.isArray(agreement?.termsList) ? agreement.termsList : []),
    [agreement]
  );
  const termsText = String(agreement?.terms || '').trim();

  const statusKey = normalizeStatus(agreement?.status);
  const isAccepted = statusKey === normalizeStatus(SalesAgreementStatus.accepted);
  const isClosed = ['canceled', 'rejected', 'expired', 'superseded'].includes(statusKey);
  const recordLabel = agreementRecordLabel(agreement || {});
  const isEstimate = isEstimateAgreement(agreement || {});
  const supersedesAgreementId = renewalPreviousAgreementId(agreement || {});
  const isSignedIn = Boolean(userId);
  const agreementReviewPath = `${location.pathname || `/customer/service-agreements/${agreementId}`}${location.search || ''}`;
  const redirectParam = encodeURIComponent(agreementReviewPath);
  const signInPath = `/homeownerSignIn?redirect=${redirectParam}`;
  const signUpEmail = agreement?.email || emailParam;
  const signUpPath = `/homeownerSignUp?redirect=${redirectParam}${signUpEmail ? `&email=${encodeURIComponent(signUpEmail)}` : ''}`;
  const reviewBackPath = isSignedIn ? '/client/finance' : '/';
  const reviewBackLabel = isSignedIn ? 'Finance' : 'Drip Drop';
  const canAcceptFromEmailLink = Boolean(!isSignedIn && isCustomerEmailReview && accessTokenParam);
  const canAccept = Boolean(
    agreement &&
    !isAccepted &&
    !isClosed &&
    !accepting &&
    (isSignedIn || canAcceptFromEmailLink)
  );
  const canReject = Boolean(
    agreement &&
    isSignedIn &&
    !isAccepted &&
    !isClosed &&
    !rejecting
  );
  const billingPreferenceOptions = isEstimate
    ? [
      { value: 'payNow', label: 'Pay right away', helper: 'Use online payment setup when available.' },
      { value: 'chargeOnDelivery', label: 'Charge on delivery', helper: 'Let the company collect when work is delivered.' },
      { value: 'requestInvoice', label: 'Request invoice', helper: 'Ask the company to invoice you.' },
    ]
    : [
      { value: 'payNow', label: 'Pay right away', helper: 'Set up autopay after accepting.' },
      { value: 'requestInvoice', label: 'Request invoices', helper: 'Ask the company to bill by invoice.' },
    ];
  const messageCompanyPath = useMemo(() => {
    if (!agreement?.companyId) return '';

    const params = new URLSearchParams();
    params.set('message', `I have a question about this ${recordLabel.toLowerCase()}.`);
    params.set('linkType', isEstimate ? 'estimate' : 'serviceAgreement');
    params.set('recordId', agreement.id);
    params.set('title', agreement.title || recordLabel);
    params.set('subtitle', `${agreement.companyName || 'Pool company'} - ${formatCurrency(displayTotalAmountCents)}`);
    params.set('companyId', agreement.companyId);
    params.set('customerId', agreement.customerId || '');
    params.set('customerUserId', agreement.customerUserId || userId || '');
    params.set('collectionPath', `${salesCollectionNames.agreements}/${agreement.id}`);
    params.set('clientWebPath', `/client/service-agreements/${agreement.id}`);
    params.set('companyWebPath', `/company/sales/agreements/${agreement.id}`);

    return `/messages/newCompany/${agreement.companyId}?${params.toString()}`;
  }, [agreement, displayTotalAmountCents, isEstimate, recordLabel, userId]);
  const messagesEnabled = featureFlagsLoaded && isFeatureEnabled('feature_flag_001');
  const effectiveSubscriptionId = billingSubscription?.id || agreement?.billingSubscriptionId;
  const subscriptionStatusKey = normalizeStatus(billingSubscription?.stripeStatus || billingSubscription?.status);
  const hasActiveStripeSubscription = ['active', 'trialing'].includes(subscriptionStatusKey);
  const canStartCheckout = Boolean(
    isSignedIn &&
    agreement &&
    effectiveSubscriptionId &&
    !hasActiveStripeSubscription &&
    billingSubscription?.stripeConnectedAccountId &&
    Number(billingSubscription?.amountCents || agreement?.totalAmountCents || 0) > 0 &&
    !startingCheckout
  );
  const companyName = agreement?.companyName || 'Pool company';
  const customerName = agreement?.customerName || 'Customer';
  const customerEmail = agreement?.email || user?.email || 'Not provided';
  const recurringServiceStopId = firstText(
    agreement?.recurringServiceStopId,
    billingSubscription?.recurringServiceStopId
  );
  const recurringRouteId = firstText(
    agreement?.recurringRouteId,
    billingSubscription?.recurringRouteId
  );
  const recurringSetupStatusKey = normalizeStatus(
    agreement?.operationsSetupStatus ||
    billingSubscription?.operationsSetupStatus ||
    ''
  );
  const recurringSetupReady = Boolean(
    recurringServiceStopId ||
    recurringRouteId ||
    [
      'recurringservicestopcreated',
      'recurringservicestopandroutecreated',
      'recurringroutecreated',
      'recurringrouteassigned',
      'servicestopcreated',
      'ready',
      'complete',
      'completed',
    ].includes(recurringSetupStatusKey)
  );
  const showRecurringSetupStatus = Boolean(isAccepted && !isEstimate);
  const recurringSetupUpdatedAt = agreement?.operationsSetupUpdatedAt ||
    billingSubscription?.operationsSetupUpdatedAt ||
    agreement?.recurringServiceStopCreatedAt ||
    billingSubscription?.recurringServiceStopCreatedAt ||
    agreement?.acceptedAt ||
    agreement?.updatedAt;
  const recurringSetupStatusLabel = recurringSetupReady
    ? 'Recurring service setup started'
    : 'Waiting on company setup';
  const recurringSetupMessage = recurringSetupReady
    ? `${companyName} created your recurring service stop${recurringRouteId ? ' and added it to a recurring route' : ''}.`
    : `${companyName} is setting up your recurring service stop and route.`;
  const recurringSetupToneClass = recurringSetupReady
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';
  const serviceLocationDisplay = agreementServiceLocationDisplay(agreement || {});
  const preparedDate = formatDate(agreement?.sentAt || agreement?.createdAt);
  const serviceSectionNumber = planOptions.length > 0 ? '4' : '3';
  const chemicalSectionNumber = planOptions.length > 0 ? '5' : '4';
  const termsSectionNumber = planOptions.length > 0 ? '6' : '5';
  const separatelyBilledChemicalDisplay = chemicalSelectionDisplay(
    agreement?.separatelyBilledChemicalIds,
    agreement?.separatelyBilledChemicalKeywords
  );
  const includedChemicalDisplay = chemicalSelectionDisplay(
    agreement?.includedChemicalIds,
    agreement?.includedChemicalKeywords
  );
  const customerPurchasedChemicalDisplay = chemicalSelectionDisplay(
    agreement?.customerPurchasedChemicalIds,
    agreement?.customerPurchasedChemicalKeywords
  );
  const chemicalBillingDescription = chemicalBillingExplanation(agreement || {}, {
    separatelyBilledChemicalDisplay,
    includedChemicalDisplay,
  });

  const acceptAgreement = async () => {
    if (!isSignedIn && !canAcceptFromEmailLink) {
      toast.error('Open the service agreement from the email link before accepting.');
      return;
    }

    if (!canAccept) return;

    if (!acceptedTerms || !acceptedPricing || !acceptedAutopayNotice) {
      toast.error('Confirm the agreement terms, pricing, and recurring payment authorization.');
      return;
    }

    if (signatureName.trim().length < 2) {
      toast.error('Enter your name as the acceptance signature.');
      return;
    }

    setAccepting(true);

    try {
      const acceptCallable = httpsCallable(
        functions,
        isSignedIn ? 'acceptSalesServiceAgreement' : 'acceptPublicSalesServiceAgreement'
      );
      const authPayload = isSignedIn ? await getCallableAuthPayload() : {};
      const result = await acceptCallable({
        ...authPayload,
        agreementId: agreement.id,
        email: emailParam || agreement.email || '',
        accessToken: accessTokenParam,
        acceptanceNote,
        acceptedTerms,
        acceptedPricing,
        acceptedAutopayNotice,
        signatureName: signatureName.trim(),
        customerBillingPreference,
        billingPreference: customerBillingPreference,
        createBillingSubscriptionOnAcceptance: customerBillingPreference === 'payNow',
        selectedPlanId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
        selectedSolutionId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
      });

      toast.success('Service agreement accepted.');
      if (!isSignedIn) {
        const billingSkipped = result.data?.billingSkipped === true;
        const billingSkippedReason = result.data?.billingSkippedReason || '';
        setAgreement((current) => ({
          ...(current || agreement),
          status: SalesAgreementStatus.accepted,
          acceptedAt: new Date().toISOString(),
          acceptedByEmail: emailParam || agreement.email || '',
          acceptedSource: 'emailLink',
          selectedPlanId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
          acceptedPlanId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
          acceptedSolutionId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
          totalAmountCents: displayTotalAmountCents,
          lineItems: displayLineItems,
          billingSubscriptionId: result.data?.billingSubscriptionId || current?.billingSubscriptionId || '',
          billingFlowStatus: billingSkipped
            ? billingSkippedReason === 'oneTimeAgreement'
              ? 'billingNotApplicable'
              : billingSkippedReason === 'acceptanceBillingSkipped'
                ? 'notStarted'
                : 'billingDisabled'
            : result.data?.nextAction
              ? 'pendingPaymentMethod'
              : current?.billingFlowStatus,
          billingFlowNextAction: result.data?.nextAction || current?.billingFlowNextAction,
          customerBillingPreference,
          operationsSetupStatus: current?.operationsSetupStatus || 'needsRecurringServiceStop',
          operationsSetupReason: current?.operationsSetupReason || 'acceptedServiceAgreement',
          operationsSetupUpdatedAt: new Date().toISOString(),
        }));
      }

      if (result.data?.customerCanPayImmediately) {
        setBillingSubscription((current) => ({
          ...(current || {}),
          id: result.data.billingSubscriptionId,
          customerCanPayImmediately: true,
        }));
      }
    } catch (acceptError) {
      console.error('Unable to accept service agreement', acceptError);
      toast.error(acceptError.message || 'Failed to accept service agreement.');
    } finally {
      setAccepting(false);
    }
  };

  const rejectAgreement = async () => {
    if (!isSignedIn) {
      toast.error('Sign in to decline this record.');
      return;
    }

    if (!canReject) return;

    setRejecting(true);
    try {
      const rejectCallable = httpsCallable(functions, 'rejectSalesServiceAgreement');
      const authPayload = await getCallableAuthPayload();
      await rejectCallable({
        ...authPayload,
        agreementId: agreement.id,
        rejectionNote,
      });

      toast.success(`${recordLabel} declined.`);
    } catch (rejectError) {
      console.error('Unable to decline service agreement', rejectError);
      toast.error(rejectError.message || `Failed to decline ${recordLabel.toLowerCase()}.`);
    } finally {
      setRejecting(false);
    }
  };

  const downloadAgreementPdf = () => {
    if (!agreement) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Allow popups to download the agreement PDF.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintableAgreementHtml({
      agreement,
      chemicalBillingDescription,
      customerPurchasedChemicalDisplay,
      displayLineItems,
      displayTotalAmountCents,
      includedChemicalDisplay,
      recordLabel,
      separatelyBilledChemicalDisplay,
    }));
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
    }, 250);

    toast.success('Use Save as PDF in the print dialog to download the agreement.');
  };

  const startCheckout = async () => {
    if (!canStartCheckout) return;

    setStartingCheckout(true);

    try {
      const startCheckoutCallable = httpsCallable(functions, 'createSalesBillingSubscriptionCheckoutSession');
      const authPayload = await getCallableAuthPayload();
      const result = await startCheckoutCallable({
        ...authPayload,
        billingSubscriptionId: effectiveSubscriptionId,
        agreementId: agreement.id,
        companyId: agreement.companyId,
        paymentMethodType: selectedPaymentMethodType,
        successUrl: `${window.location.origin}/client/service-agreements/${encodeURIComponent(agreement.id)}?stripeCheckout=success`,
        cancelUrl: `${window.location.origin}/client/service-agreements/${encodeURIComponent(agreement.id)}?stripeCheckout=canceled`,
      });

      if (result.data?.url) {
        window.location.href = result.data.url;
        return;
      }

      if (result.data?.status === 'already_active') {
        toast.success('Billing is already active.');
        return;
      }

      throw new Error(result.data?.message || 'Stripe did not return a Checkout URL.');
    } catch (checkoutError) {
      console.error('Unable to start Stripe Checkout', checkoutError);
      toast.error(checkoutError.message || 'Failed to start Stripe Checkout.');
    } finally {
      setStartingCheckout(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Loading service agreement...
        </div>
      </div>
    );
  }

  if (error || !agreement) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <Link to={reviewBackPath} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
          <ArrowLeftIcon className="h-4 w-4" />
          {reviewBackLabel}
        </Link>
        {!isSignedIn ? (
          <div className="mx-auto max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
            <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-amber-500" />
            <h1 className="mt-3 text-xl font-bold text-amber-950">
              {isCustomerEmailReview ? 'We could not verify this agreement link' : 'Sign in to review this agreement'}
            </h1>
            <p className="mt-2 text-sm text-amber-800">
              {isCustomerEmailReview
                ? error || 'Open the latest agreement email link, or sign in with the customer account for this agreement.'
                : 'Use the homeowner account for this email, or create one to review and accept the service agreement.'}
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <Link
                to={signInPath}
                className="inline-flex justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
              >
                Sign In
              </Link>
              <Link
                to={signUpPath}
                className="inline-flex justify-center rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100"
              >
                Create Account
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
            <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-rose-500" />
            <p className="mt-3 font-semibold text-rose-800">{error || 'Service agreement not found.'}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to={reviewBackPath} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
            <ArrowLeftIcon className="h-4 w-4" />
            {reviewBackLabel}
          </Link>
          <h1 className="text-3xl font-bold text-slate-950">{agreement.title || recordLabel}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {agreement.companyName || 'Pool company'} sent this {recordLabel.toLowerCase()} to {agreement.email || user?.email || 'your account'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {messagesEnabled && messageCompanyPath && (
            <Link
              to={messageCompanyPath}
              className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
            >
              <ChatBubbleLeftRightIcon className="h-5 w-5" />
              Message Company
            </Link>
          )}
          <StatusBadge status={agreement.status || SalesAgreementStatus.draft} />
        </div>
      </div>

      {isAccepted && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none" />
            <div>
              <p className="font-bold">{recordLabel} accepted</p>
              <p className="mt-1">
                Accepted {formatDate(agreement.acceptedAt)} by {agreement.acceptedByUserName || agreement.acceptedByEmail || 'this customer'}.
              </p>
            </div>
          </div>
        </div>
      )}

      {showRecurringSetupStatus && (
        <div className={`mb-5 rounded-lg border p-4 text-sm ${recurringSetupToneClass}`}>
          <div className="flex items-start gap-3">
            {recurringSetupReady ? (
              <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none" />
            ) : (
              <ClockIcon className="mt-0.5 h-5 w-5 flex-none" />
            )}
            <div>
              <p className="font-bold">{recurringSetupStatusLabel}</p>
              <p className="mt-1">{recurringSetupMessage}</p>
            </div>
          </div>
        </div>
      )}

      {!isSignedIn && isCustomerEmailReview && (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-bold">Reviewing as a guest</p>
          <p className="mt-1">
            You can review and accept this {recordLabel.toLowerCase()} without an account. Sign in or create a homeowner account when you want portal access and billing setup.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <article className="overflow-hidden rounded-sm border border-slate-300 bg-white shadow-sm">
            <header className="border-b-2 border-slate-900 px-5 py-6 sm:px-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-3">
                  <DocumentTextIcon className="h-7 w-7 text-slate-500" />
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{recordLabel}</p>
                </div>
                <StatusBadge status={agreement.status || SalesAgreementStatus.draft} />
              </div>

              <h2 className="mt-5 text-2xl font-bold uppercase tracking-wide text-slate-950">
                {agreement.title || `Professional ${recordLabel}`}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                This {recordLabel.toLowerCase()} is prepared by {companyName} for {customerName}. Review the service scope,
                pricing, chemical billing terms, and acceptance requirements below.
              </p>

              <dl className="mt-6 grid grid-cols-1 gap-4 border-y border-slate-300 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <DocumentField label={`${recordLabel} Number`} value={agreement.id} />
                <DocumentField label="Prepared" value={preparedDate} />
                <DocumentField label="Total" value={formatCurrency(displayTotalAmountCents)} />
                <DocumentField label="Status" value={labelize(agreement.status || SalesAgreementStatus.draft)} />
              </dl>
            </header>

            <div className="px-5 py-6 sm:px-8">
              <DocumentSection number="1" title="Parties And Service Location">
                <p className="text-sm leading-6 text-slate-700">
                  This {recordLabel.toLowerCase()} is between {companyName}, the service provider, and {customerName},
                  the client for the service location listed below.
                </p>
                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DocumentField label="Service Provider" value={companyName} />
                  <DocumentField label="Client" value={customerName} />
                  <DocumentField label="Client Email" value={customerEmail} />
                  <DocumentField label="Service Location" value={serviceLocationDisplay} />
                </dl>
              </DocumentSection>

              <DocumentSection number="2" title="Term And Billing Summary">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <DocumentField label="Start Date" value={formatDate(agreement.startDate)} />
                  <DocumentField label="Service Frequency" value={formatServiceFrequency(agreement)} />
                  <DocumentField label="Billing Frequency" value={formatBillingFrequency(agreement)} />
                  <DocumentField label="Payment Terms" value={labelize(agreement.paymentTerms)} />
                  <DocumentField label="Invoice Delivery" value={labelize(agreement.invoiceDeliveryMethod)} />
                  <DocumentField label="Offer Expires" value={formatDate(agreement.expiresAt)} />
                </dl>
              </DocumentSection>

              {planOptions.length > 0 && (
                <DocumentSection number="3" title="Plan Selection">
                  <p className="mb-4 text-sm leading-6 text-slate-700">
                    Select the service plan you want accepted. The selected plan controls the services and total shown here.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {planOptions.map((option) => {
                      const optionId = option.planId || option.solutionId || option.id || '';
                      const active = optionId === (selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId);
                      const recommendationRank = option.planTier || option.solutionTier || option.recommendationRank;
                      return (
                        <label
                          key={optionId || option.title}
                          className={[
                            'cursor-pointer rounded-md border p-4 transition',
                            active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                          ].join(' ')}
                        >
                          <span className="flex items-start gap-3">
                            <input
                              type="radio"
                              name="planOption"
                              checked={active}
                              onChange={() => setSelectedPlanId(optionId)}
                              disabled={isAccepted || isClosed}
                              className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="min-w-0 flex-1">
                              {recommendationRank && (
                                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  {getJobPlanRecommendationDisplay(recommendationRank)}
                                </span>
                              )}
                              <span className="block text-sm font-bold text-slate-950">
                                {getJobPlanDisplayName(option, 'Plan Option')}
                              </span>
                              {option.description && (
                                <span className="mt-1 block text-sm leading-5 text-slate-600">{option.description}</span>
                              )}
                              <span className="mt-3 block text-lg font-bold text-slate-950">
                                {formatCurrency(option.totalAmountCents || option.rateAmountCents)}
                              </span>
                              <span className="mt-1 block text-xs text-slate-500">
                                {Number(option.taskCount || 0)} task(s) / {Number(option.plannedStopCount || 0)} stop(s) / {Number(option.materialCount || 0)} material item(s)
                              </span>
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </DocumentSection>
              )}

              <DocumentSection number={serviceSectionNumber} title="Services And Products">
                {agreement.description && (
                  <p className="mb-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{agreement.description}</p>
                )}
                <div>
                  <LineItemSectionTables
                    lineItems={displayLineItems}
                    formatCurrency={formatCurrency}
                    emptyMessage="No services or products were included."
                  />
                </div>
              </DocumentSection>

              <DocumentSection number={chemicalSectionNumber} title="Chemical Billing">
                <p className="text-sm leading-6 text-slate-700">{chemicalBillingDescription}</p>
                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DocumentField label="Billing Treatment" value={chemicalBillingLabel(agreement)} />
                  {separatelyBilledChemicalDisplay && (
                    <DocumentField label="Billed Separately" value={separatelyBilledChemicalDisplay} />
                  )}
                  {includedChemicalDisplay && (
                    <DocumentField label="Included Chemicals" value={includedChemicalDisplay} />
                  )}
                  {customerPurchasedChemicalDisplay && (
                    <DocumentField label="Customer Purchased Or Supplied" value={customerPurchasedChemicalDisplay} />
                  )}
                  {agreement.chemicalBillingNotes && (
                    <div className="border-t border-slate-200 pt-3 sm:col-span-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Chemical Billing Notes</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-950">{agreement.chemicalBillingNotes}</dd>
                    </div>
                  )}
                </dl>
                {customerPurchasedChemicalDisplay && (
                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    Customer-purchased or customer-supplied chemicals are treated separately from company-provided
                    chemical billing and are not added as company chemical charges.
                  </p>
                )}
              </DocumentSection>

              <DocumentSection number={termsSectionNumber} title="Terms And Conditions">
                {agreement.termsTemplateName && (
                  <p className="mb-4 text-sm font-semibold text-slate-600">
                    Terms template: {agreement.termsTemplateName}
                  </p>
                )}

                {termsText ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{termsText}</p>
                ) : termsList.length > 0 ? (
                  <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-700">
                    {termsList.map((term, index) => {
                      const title = agreementTermTitle(term);
                      const description = agreementTermText(term);
                      const termKey = typeof term === 'object' && term?.id ? term.id : index;

                      return (
                        <li key={termKey} className="pl-1">
                          {title && <p className="font-semibold text-slate-950">{title}</p>}
                          {description && <p className="whitespace-pre-wrap">{description}</p>}
                        </li>
                      );
                    })}
                  </ol>
                ) : termsList.length === 0 ? (
                  <p className="text-sm text-slate-500">No written terms were included.</p>
                ) : null}
              </DocumentSection>
            </div>
          </article>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <DocumentTextIcon className="h-5 w-5 text-slate-400" />
              Document
            </h2>
            <button
              type="button"
              onClick={downloadAgreementPdf}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
              Download PDF
            </button>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Acceptance</h2>
            <p className="mt-1 text-sm text-slate-500">
              Accepting records your approval and saves the billing choice for the company.
            </p>

            <dl className="mt-5 space-y-4">
              <Field label="Customer" value={agreement.customerName || user?.email} />
              <Field label="Sent" value={formatDate(agreement.sentAt || agreement.createdAt)} />
              <Field label="Expires" value={formatDate(agreement.expiresAt)} />
              <Field label="Billing Setup" value={billingSubscription?.id ? labelize(billingSubscription.status || billingSubscription.stripeStatus) : 'Not created'} />
            </dl>

            {!isAccepted && !isClosed && (
              <div className="mt-5 space-y-4">
                {!isSignedIn && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    <p className="font-semibold">Secure email link</p>
                    <p className="mt-1">
                      This private email link lets you review and accept the agreement. Sign in or create a homeowner account when you want portal access and billing setup.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Link
                        to={signInPath}
                        className="inline-flex justify-center rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                      >
                        Sign In
                      </Link>
                      <Link
                        to={signUpPath}
                        className="inline-flex justify-center rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
                      >
                        Create Account
                      </Link>
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Billing Choice</p>
                  <div className="mt-3 grid gap-2">
                    {billingPreferenceOptions.map((option) => {
                      const selected = customerBillingPreference === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setCustomerBillingPreference(option.value)}
                          disabled={isAccepted || isClosed || accepting}
                          className={[
                            'rounded-md border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                            selected
                              ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                              : 'border-slate-200 bg-white hover:bg-slate-100',
                          ].join(' ')}
                        >
                          <span className="block text-sm font-bold text-slate-950">{option.label}</span>
                          <span className="mt-1 block text-xs text-slate-500">{option.helper}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block text-sm font-semibold text-slate-700" htmlFor="acceptanceNote">
                  Note
                  <textarea
                    id="acceptanceNote"
                    value={acceptanceNote}
                    onChange={(event) => setAcceptanceNote(event.target.value)}
                    className="mt-1 h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Optional"
                  />
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-700">
                    I reviewed the agreement, pricing, and terms.
                    {supersedesAgreementId ? ' I understand this agreement replaces my previous service agreement.' : ''}
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={acceptedPricing}
                    onChange={(event) => setAcceptedPricing(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-700">
                    I reviewed the price, billing frequency, and invoice terms.
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={acceptedAutopayNotice}
                    onChange={(event) => setAcceptedAutopayNotice(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-700">
                    I understand my billing choice. If I choose pay right away, I may be asked to set up online payment or autopay.
                  </span>
                </label>

                <label className="block text-sm font-semibold text-slate-700" htmlFor="signatureName">
                  Signature Name
                  <input
                    id="signatureName"
                    type="text"
                    value={signatureName}
                    onChange={(event) => setSignatureName(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Full name"
                  />
                </label>

                <button
                  type="button"
                  onClick={acceptAgreement}
                  disabled={!canAccept || accepting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                  {accepting ? 'Accepting...' : `Accept ${recordLabel}`}
                </button>

                {isSignedIn && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                    <label className="block text-sm font-semibold text-rose-800" htmlFor="rejectionNote">
                      Decline Note
                      <textarea
                        id="rejectionNote"
                        value={rejectionNote}
                        onChange={(event) => setRejectionNote(event.target.value)}
                        className="mt-1 h-20 w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
                        placeholder="Optional"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={rejectAgreement}
                      disabled={!canReject || rejecting}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <XCircleIcon className="h-5 w-5" />
                      {rejecting ? 'Declining...' : `Decline ${recordLabel}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {isClosed && (
              <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                This agreement is no longer available for acceptance.
              </div>
            )}
          </section>

          {showRecurringSetupStatus && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
                {recurringSetupReady ? (
                  <CheckCircleIcon className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ClockIcon className="h-5 w-5 text-amber-500" />
                )}
                Service Setup
              </h2>
              <p className="mt-1 text-sm text-slate-500">{recurringSetupMessage}</p>

              <dl className="mt-5 space-y-4">
                <Field label="Status" value={recurringSetupStatusLabel} />
                <Field label="Recurring Stop" value={recurringServiceStopId ? 'Created' : 'Waiting'} />
                <Field
                  label="Route"
                  value={recurringRouteId ? 'Assigned' : recurringSetupReady ? 'In route planning' : 'Waiting'}
                />
                <Field label="Last Updated" value={formatDate(recurringSetupUpdatedAt)} />
              </dl>
            </section>
          )}

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <CreditCardIcon className="h-5 w-5 text-slate-400" />
              Payment Setup
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              If you chose pay right away, you can continue to Stripe when the company has online billing ready.
            </p>

            <dl className="mt-5 space-y-4">
              <Field label="Amount" value={formatCurrency(billingSubscription?.amountCents || agreement.totalAmountCents || agreement.rateAmountCents)} />
              <Field label="Status" value={labelize(billingSubscription?.stripeStatus || billingSubscription?.status || agreement.billingFlowStatus)} />
              <Field label="Next Action" value={labelize(billingSubscription?.nextAction || agreement.billingFlowNextAction)} />
            </dl>

            {billingSubscription?.checkoutUrl && !hasActiveStripeSubscription && (
              <a
                href={billingSubscription.checkoutUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100"
              >
                Existing Checkout Link
              </a>
            )}

            {hasActiveStripeSubscription ? (
              <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                Billing is active.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <PaymentMethodSelector
                  amountCents={billingSubscription?.amountCents || agreement.totalAmountCents || agreement.rateAmountCents}
                  value={selectedPaymentMethodType}
                  onChange={setSelectedPaymentMethodType}
                  disabled={!canStartCheckout}
                />
                <button
                  type="button"
                  onClick={startCheckout}
                  disabled={!canStartCheckout}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CreditCardIcon className="h-5 w-5" />
                  {startingCheckout ? 'Opening Stripe...' : 'Set Up Payment'}
                </button>
              </div>
            )}

            {!canStartCheckout && !hasActiveStripeSubscription && (
              <p className="mt-3 text-xs text-slate-500">
                Payment setup appears after the agreement is accepted and the company billing account is ready.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};

export default ServiceAgreementDetail;
