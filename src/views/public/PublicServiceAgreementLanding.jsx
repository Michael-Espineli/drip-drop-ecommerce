import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  CheckCircleIcon,
  CreditCardIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import LineItemSectionTables from '../../components/billing/LineItemSectionTables';
import { functions } from '../../utils/config';
import { SalesAgreementStatus } from '../../utils/models/Sales';
import {
  formatBillingFrequency,
  formatServiceFrequency,
} from '../../utils/sales/agreementCadence';
import { chemicalBillingLabel } from '../../utils/sales/chemicalBilling';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const normalizeStatus = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

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

const listDisplay = (value) => (
  Array.isArray(value) && value.length > 0 ? value.join(', ') : ''
);

const statusTone = {
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sent: 'border-sky-200 bg-sky-50 text-sky-700',
  revised: 'border-amber-200 bg-amber-50 text-amber-700',
  canceled: 'border-slate-200 bg-slate-100 text-slate-600',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  expired: 'border-slate-200 bg-slate-100 text-slate-600',
  superseded: 'border-violet-200 bg-violet-50 text-violet-700',
};

const StatusBadge = ({ status }) => {
  const key = normalizeStatus(status);
  const tone = statusTone[key] || 'border-slate-200 bg-slate-50 text-slate-700';

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

const PublicServiceAgreementLanding = () => {
  const { agreementId } = useParams();
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const emailParam = queryParams.get('email') || '';
  const accessToken = queryParams.get('accessToken') || queryParams.get('reviewToken') || '';
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPricing, setAcceptedPricing] = useState(false);
  const [acceptedAutopayNotice, setAcceptedAutopayNotice] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [acceptanceNote, setAcceptanceNote] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [responding, setResponding] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');

  useEffect(() => {
    if (!agreementId) {
      setError('Missing service agreement id.');
      setLoading(false);
      return undefined;
    }

    if (!accessToken) {
      setError('This private review link is missing its email access token. Open the latest service agreement email link.');
      setLoading(false);
      return undefined;
    }

    let isActive = true;

    const loadAgreement = async () => {
      setLoading(true);
      setError('');

      try {
        const getPublicAgreement = httpsCallable(functions, 'getPublicServiceAgreement');
        const result = await getPublicAgreement({
          agreementId,
          email: emailParam,
          accessToken,
        });

        if (!isActive) return;
        setAgreement(result.data?.agreement || null);
        if (!result.data?.agreement) setError('Service agreement not found.');
      } catch (loadError) {
        console.error('Unable to load public service agreement', loadError);
        if (isActive) {
          setAgreement(null);
          setError(loadError.message || 'Unable to verify this service agreement link.');
        }
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadAgreement();

    return () => {
      isActive = false;
    };
  }, [accessToken, agreementId, emailParam]);

  const lineItems = Array.isArray(agreement?.lineItems) ? agreement.lineItems : [];
  const planOptions = Array.isArray(agreement?.planOptions) ? agreement.planOptions : Array.isArray(agreement?.solutionOptions) ? agreement.solutionOptions : [];
  const selectedPlanOption = planOptions.find((option) => (
    String(option.planId || option.solutionId || option.id || '') === String(selectedPlanId || agreement?.selectedPlanId || agreement?.selectedSolutionId || agreement?.acceptedPlanId || agreement?.acceptedSolutionId || '')
  )) || planOptions[0] || null;
  const displayLineItems = Array.isArray(selectedPlanOption?.lineItems) && selectedPlanOption.lineItems.length
    ? selectedPlanOption.lineItems
    : lineItems;
  const displayTotalAmountCents = Number(
    selectedPlanOption?.totalAmountCents ||
    selectedPlanOption?.rateAmountCents ||
    agreement?.totalAmountCents ||
    agreement?.rateAmountCents ||
    0
  );
  const termsList = Array.isArray(agreement?.termsList) ? agreement.termsList : [];
  const statusKey = normalizeStatus(agreement?.status);
  const isJobEstimate = Boolean(
    normalizeStatus(agreement?.sourceType) === 'oneoffjob' ||
    agreement?.jobId ||
    agreement?.workOrderId ||
    agreement?.rateType === 'oneTime' ||
    agreement?.serviceCadence === 'oneTime'
  );
  const documentLabel = isJobEstimate ? 'Estimate' : 'Service Agreement';
  const documentLabelLower = isJobEstimate ? 'estimate' : 'agreement';
  const isAccepted = statusKey === normalizeStatus(SalesAgreementStatus.accepted);
  const isRejected = statusKey === normalizeStatus(SalesAgreementStatus.rejected);
  const customerResponseType = agreement?.customerResponseType || '';
  const customerRequestedChanges = isRejected && customerResponseType === 'changesRequested';
  const isClosed = ['canceled', 'rejected', 'expired', 'superseded'].includes(statusKey);
  const redirectParam = encodeURIComponent(`${location.pathname}${location.search || ''}`);
  const signInPath = `/homeownerSignIn?redirect=${redirectParam}`;
  const signUpPath = `/homeownerSignUp?redirect=${redirectParam}${agreement?.email || emailParam ? `&email=${encodeURIComponent(agreement?.email || emailParam)}` : ''}`;
  const inspectionReportIncluded = agreement?.includeInspectionReport === true;
  const hasInspectionReport = agreement?.hasInspectionReport === true && agreement?.inspectionReportUrl;
  const publicInspectionReportPath = agreement?.id
    ? `/customer/service-agreements/${agreement.id}/inspection-report${location.search || ''}`
    : '';
  const inspectionReportUrl = String(agreement?.inspectionReportUrl || '');
  const usePublicInspectionReportRoute = (
    !inspectionReportUrl ||
    inspectionReportUrl.includes('/serviceStop/detail/') ||
    inspectionReportUrl.includes('/customer/service-agreements/')
  );

  useEffect(() => {
    if (!agreement || signatureName) return;

    setSignatureName(agreement.customerName || agreement.email || emailParam || '');
  }, [agreement, emailParam, signatureName]);

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

  const acceptAgreement = async () => {
    if (!agreement || accepting || isAccepted || isClosed) return;

    if (!acceptedTerms || !acceptedPricing || !acceptedAutopayNotice) {
      toast.error(`Confirm the ${documentLabelLower} terms, pricing, and payment authorization.`);
      return;
    }

    if (signatureName.trim().length < 2) {
      toast.error('Enter your name as the acceptance signature.');
      return;
    }

    setAccepting(true);

    try {
      const acceptPublicAgreement = httpsCallable(functions, 'acceptPublicSalesServiceAgreement');
      const result = await acceptPublicAgreement({
        agreementId: agreement.id,
        email: emailParam || agreement.email || '',
        accessToken,
        acceptanceNote,
        acceptedTerms,
        acceptedPricing,
        acceptedAutopayNotice,
        signatureName: signatureName.trim(),
        selectedPlanId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
        selectedSolutionId: selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId || '',
      });

      toast.success(`${documentLabel} accepted.`);
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
        customerCanPayImmediately: result.data?.customerCanPayImmediately === true,
      }));
    } catch (acceptError) {
      console.error('Unable to accept public sales document', acceptError);
      toast.error(acceptError.message || `Failed to accept ${documentLabelLower}.`);
    } finally {
      setAccepting(false);
    }
  };

  const respondToEstimate = async (responseType) => {
    if (!agreement || responding || accepting || isAccepted || isClosed) return;

    if (responseType === 'changesRequested' && responseNote.trim().length < 3) {
      toast.error('Add a short note about what you would like changed.');
      return;
    }

    setResponding(responseType);

    try {
      const rejectPublicAgreement = httpsCallable(functions, 'rejectPublicSalesServiceAgreement');
      await rejectPublicAgreement({
        agreementId: agreement.id,
        email: emailParam || agreement.email || '',
        accessToken,
        responseType,
        rejectionNote: responseNote.trim(),
      });

      toast.success(responseType === 'changesRequested' ? 'Change request sent.' : 'Estimate declined.');
      setAgreement((current) => ({
        ...(current || agreement),
        status: SalesAgreementStatus.rejected,
        rejectedAt: new Date().toISOString(),
        rejectedByEmail: emailParam || agreement.email || '',
        rejectedSource: 'emailLink',
        rejectedNote: responseNote.trim(),
        customerResponseType: responseType,
      }));
    } catch (responseError) {
      console.error('Unable to respond to public service agreement', responseError);
      toast.error(responseError.message || 'Failed to send your response.');
    } finally {
      setResponding('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Loading {documentLabelLower}...
        </div>
      </div>
    );
  }

  if (error || !agreement) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
          <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-bold text-amber-950">We could not verify this review link</h1>
          <p className="mt-2 text-sm text-amber-800">
            {error || 'Open the latest estimate or service agreement email link, or sign in with the recipient account.'}
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Link
              to={signInPath}
              className="inline-flex justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
            >
              Sign In
            </Link>
            <Link
              to="/"
              className="inline-flex justify-center rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100"
            >
              Drip Drop
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Private {documentLabel} Link</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-950">{agreement.title || documentLabel}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                {agreement.companyName || 'Your pool company'} sent this {documentLabelLower} to {agreement.email || emailParam || 'this email address'}.
                This link is only intended for the recipient of the email.
              </p>
            </div>
            <StatusBadge status={agreement.status || SalesAgreementStatus.sent} />
          </div>
        </section>

        {isAccepted && (
          <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex items-start gap-3">
              <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-none" />
              <div>
                <p className="font-bold">{documentLabel} accepted</p>
                <p className="mt-1">
                  Accepted {formatDate(agreement.acceptedAt)} by {agreement.acceptedByEmail || agreement.customerName || 'the email recipient'}.
                </p>
              </div>
            </div>
          </div>
        )}

        {isRejected && (
          <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-none" />
              <div>
                <p className="font-bold">
                  {customerRequestedChanges ? 'Change request sent' : 'Estimate declined'}
                </p>
                <p className="mt-1">
                  {customerRequestedChanges
                    ? 'The company received your requested changes and can follow up with a revised estimate.'
                    : 'The company received your response.'}
                </p>
                {agreement.rejectedNote && (
                  <p className="mt-2 whitespace-pre-wrap">{agreement.rejectedNote}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-bold">Reviewing from the email</p>
          <p className="mt-1">
            You can review and accept this {documentLabelLower} here without creating an account. Create or sign in to a homeowner account afterward for portal access and billing setup.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950">{documentLabel} Summary</h2>
                    <p className="mt-1 text-sm text-slate-500">{agreement.description || 'Review the service and billing terms below.'}</p>
                  </div>
                  <DocumentTextIcon className="h-6 w-6 text-slate-400" />
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Total" value={formatCurrency(displayTotalAmountCents)} />
                {isJobEstimate ? (
                  <Field label="Plan Options" value={String(planOptions.length || 1)} />
                ) : (
                  <Field label="Service Frequency" value={formatServiceFrequency(agreement)} />
                )}
                <Field label={isJobEstimate ? 'Billing Type' : 'Billing Frequency'} value={isJobEstimate ? 'One Time' : formatBillingFrequency(agreement)} />
                <Field label="Payment Terms" value={labelize(agreement.paymentTerms)} />
                <Field label={isJobEstimate ? 'Review By' : 'Start Date'} value={formatDate(isJobEstimate ? agreement.expiresAt : agreement.startDate)} />
              </dl>
            </section>

            {inspectionReportIncluded && (
              <section className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">Inspection Report</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {hasInspectionReport
                    ? `The company included the site inspection report gathered before preparing this ${documentLabelLower}.`
                    : 'The company selected the inspection report option, but no linked report is available yet.'}
                </p>
                {hasInspectionReport && (
                  usePublicInspectionReportRoute ? (
                    <Link
                      to={publicInspectionReportPath}
                      className="mt-4 inline-flex rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
                    >
                      View Inspection Report
                    </Link>
                  ) : (
                    <a
                      href={agreement.inspectionReportUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
                    >
                      View Inspection Report
                    </a>
                  )
                )}
              </section>
            )}

            {planOptions.length > 0 && (
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-lg font-bold text-slate-950">Plan Options</h2>
                  <p className="mt-1 text-sm text-slate-500">Choose how you want this job solved.</p>
                </div>
                <div className="grid gap-3 p-5 md:grid-cols-2">
                  {planOptions.map((option) => {
                    const optionId = option.planId || option.solutionId || option.id || '';
                    const active = optionId === (selectedPlanOption?.planId || selectedPlanOption?.solutionId || selectedPlanOption?.id || selectedPlanId);
                    return (
                      <label
                        key={optionId || option.title}
                        className={[
                          'cursor-pointer rounded-lg border p-4 transition',
                          active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="planOption"
                            checked={active}
                            onChange={() => setSelectedPlanId(optionId)}
                            disabled={isAccepted || isClosed}
                            className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-slate-950">
                              {[(option.planTierLabel || option.solutionTierLabel), option.title || option.name].filter(Boolean).join(' - ') || 'Plan Option'}
                            </span>
                            {option.description && (
                              <span className="mt-1 block text-sm text-slate-600">{option.description}</span>
                            )}
                            <span className="mt-3 block text-lg font-bold text-slate-950">
                              {formatCurrency(option.totalAmountCents || option.rateAmountCents)}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {Number(option.taskCount || 0)} task(s) • {Number(option.plannedStopCount || 0)} stop(s) • {Number(option.materialCount || 0)} material item(s)
                            </span>
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-lg font-bold text-slate-950">Services & Products</h2>
              </div>

              <div className="p-5">
                <LineItemSectionTables
                  lineItems={displayLineItems}
                  formatCurrency={formatCurrency}
                  emptyMessage="No services or products were included."
                />
              </div>
            </section>

            {!isJobEstimate && (
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-lg font-bold text-slate-950">Chemical Billing</h2>
                </div>

                <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
                  <Field label="Treatment" value={chemicalBillingLabel(agreement)} />
                  {listDisplay(agreement.separatelyBilledChemicalKeywords) && (
                    <Field label="Billed Separately" value={listDisplay(agreement.separatelyBilledChemicalKeywords)} />
                  )}
                  {listDisplay(agreement.includedChemicalKeywords) && (
                    <Field label="Included Chemicals" value={listDisplay(agreement.includedChemicalKeywords)} />
                  )}
                  {listDisplay(agreement.customerPurchasedChemicalKeywords) && (
                    <Field label="Customer Purchased" value={listDisplay(agreement.customerPurchasedChemicalKeywords)} />
                  )}
                  {agreement.chemicalBillingNotes && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-950">{agreement.chemicalBillingNotes}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-lg font-bold text-slate-950">Terms</h2>
                {agreement.termsTemplateName && (
                  <p className="mt-1 text-sm text-slate-500">{agreement.termsTemplateName}</p>
                )}
              </div>

              <div className="space-y-4 p-5">
                {termsList.length > 0 && (
                  <div className="space-y-3">
                    {termsList.map((term, index) => {
                      const title = typeof term === 'string'
                        ? `Term ${index + 1}`
                        : term.title || term.label || `Term ${index + 1}`;
                      const description = typeof term === 'string'
                        ? term
                        : term.description || term.value || term.text || '';

                      return (
                        <div key={term.id || index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <p className="font-semibold text-slate-950">{title}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{description}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {agreement.terms ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{agreement.terms}</p>
                ) : termsList.length === 0 ? (
                  <p className="text-sm text-slate-500">No written terms were included.</p>
                ) : null}
              </div>
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Acceptance</h2>
              <p className="mt-1 text-sm text-slate-500">
                Accepting records your approval. Payment setup appears only when the company has online billing turned on.
              </p>

              <dl className="mt-5 space-y-4">
                <Field label="Customer" value={agreement.customerName || agreement.email || emailParam} />
                <Field label="Sent" value={formatDate(agreement.sentAt || agreement.createdAt)} />
                <Field label="Expires" value={formatDate(agreement.expiresAt)} />
                <Field label="Billing Setup" value={labelize(agreement.billingFlowStatus || 'after acceptance')} />
              </dl>

              {!isAccepted && !isClosed && (
                <div className="mt-5 space-y-4">
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
                      I reviewed the {documentLabelLower}, pricing, and terms.
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
                      {isJobEstimate
                        ? 'I understand the accepted estimate can be invoiced after the work is complete.'
                        : 'I understand this agreement can be used to set up recurring online billing.'}
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
                    disabled={accepting || Boolean(responding)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckCircleIcon className="h-5 w-5" />
                    {accepting ? 'Accepting...' : `Accept ${documentLabel}`}
                  </button>

                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <label className="block text-sm font-semibold text-slate-700" htmlFor="responseNote">
                      Questions or requested changes
                      <textarea
                        id="responseNote"
                        value={responseNote}
                        onChange={(event) => setResponseNote(event.target.value)}
                        className="mt-1 h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Tell the company what you would like changed, or why you are declining."
                      />
                    </label>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => respondToEstimate('changesRequested')}
                        disabled={accepting || Boolean(responding)}
                        className="inline-flex justify-center rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {responding === 'changesRequested' ? 'Sending...' : 'Request Changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => respondToEstimate('rejected')}
                        disabled={accepting || Boolean(responding)}
                        className="inline-flex justify-center rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {responding === 'rejected' ? 'Sending...' : 'Decline Estimate'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {isClosed && (
                <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  {customerRequestedChanges
                    ? 'Your change request has been sent to the company.'
                    : `This ${documentLabelLower} is no longer available for acceptance.`}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
                <CreditCardIcon className="h-5 w-5 text-slate-400" />
                Portal and Billing
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Sign in or create a homeowner account for portal access, payment setup, and future service history.
              </p>

              <div className="mt-5 flex flex-col gap-2">
                <Link
                  to={signInPath}
                  className="inline-flex justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
                >
                  Sign In
                </Link>
                <Link
                  to={signUpPath}
                  className="inline-flex justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100"
                >
                  Create Account
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PublicServiceAgreementLanding;
