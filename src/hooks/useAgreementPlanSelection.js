import { useState } from 'react';

export const agreementPlanId = (option) => String(option?.planId || option?.solutionId || option?.id || '');

export default function useAgreementPlanSelection(agreement) {
  const [choice, setChoice] = useState(null);
  const planOptions = Array.isArray(agreement?.planOptions) && agreement.planOptions.length
    ? agreement.planOptions
    : Array.isArray(agreement?.solutionOptions) ? agreement.solutionOptions : [];
  const acceptedId = String(agreement?.status).toLowerCase() === 'accepted'
    ? agreement.acceptedPlanId || agreement.acceptedSolutionId
    : '';
  const preferredIds = [
    acceptedId,
    choice?.agreementId === agreement?.id ? choice?.planId : '',
    agreement?.selectedPlanId || agreement?.selectedSolutionId,
    agreement?.defaultPlanId || agreement?.defaultSolutionId,
  ].filter(Boolean).map(String);
  const selectedPlanOption = preferredIds
    .map((id) => planOptions.find((option) => agreementPlanId(option) === id))
    .find(Boolean) || planOptions[0] || null;
  const selectedPlanId = agreementPlanId(selectedPlanOption);
  // An explicitly empty or free plan must not inherit another plan's scope or price.
  const displayLineItems = Array.isArray(selectedPlanOption?.lineItems)
    ? selectedPlanOption.lineItems
    : Array.isArray(selectedPlanOption?.estimateLineItems)
      ? selectedPlanOption.estimateLineItems
      : Array.isArray(agreement?.lineItems) ? agreement.lineItems : [];
  const displayTotalAmountCents = Number(
    selectedPlanOption?.totalAmountCents ?? selectedPlanOption?.rateAmountCents ??
    agreement?.totalAmountCents ?? agreement?.rateAmountCents ?? 0
  );

  return {
    planOptions, selectedPlanOption, selectedPlanId, displayLineItems, displayTotalAmountCents,
    selectPlan: (planId) => setChoice({ agreementId: agreement?.id, planId: String(planId) }),
  };
}
