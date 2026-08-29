import { SalesAgreementChemicalBillingMode } from '../models/Sales';

export const TermsTemplateUseCase = Object.freeze({
  recurringService: 'recurringService',
  oneOffJob: 'oneOffJob',
  parts: 'parts',
  labor: 'labor',
  custom: 'custom',
});

export const termsTemplateUseCaseOptions = [
  { value: TermsTemplateUseCase.recurringService, label: 'Recurring Service' },
  { value: TermsTemplateUseCase.oneOffJob, label: 'Job Estimate' },
  { value: TermsTemplateUseCase.parts, label: 'Parts' },
  { value: TermsTemplateUseCase.labor, label: 'Labor' },
  { value: TermsTemplateUseCase.custom, label: 'Custom' },
];

export const TermsTemplateChemicalBillingMixedSelectionMode = Object.freeze({
  separatelyBilled: 'separatelyBilled',
  included: 'included',
});

export const termsTemplateMixedChemicalBillingSelectionOptions = [
  {
    value: TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled,
    label: 'Selected dosages are billed separately',
  },
  {
    value: TermsTemplateChemicalBillingMixedSelectionMode.included,
    label: 'Selected dosages are included in service',
  },
];

const cleanString = (value) => String(value || '').trim();

const normalizeList = (value) => (
  Array.from(new Set(
    (Array.isArray(value) ? value : cleanString(value).split(/[\n,]/))
      .map((item) => cleanString(item))
      .filter(Boolean)
  ))
);

const numberOrBlank = (value) => {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Math.max(Number(value) || 0, 0);
  return parsed > 0 ? parsed : '';
};

export const termsTemplateUseCaseLabel = (value) => {
  const key = cleanString(value);
  return termsTemplateUseCaseOptions.find((option) => option.value === key)?.label || 'Custom';
};

export const termsTemplateAgreementDefaults = (template = {}) => ({
  useCase: cleanString(template.useCase || template.templateUseCase || template.category),
  billingFrequency: cleanString(template.billingFrequency || template.defaultBillingFrequency),
  billingFrequencyCount: numberOrBlank(template.billingFrequencyCount || template.defaultBillingFrequencyCount),
  rateType: cleanString(template.rateType || template.defaultRateType),
  paymentTerms: cleanString(template.paymentTerms || template.defaultPaymentTerms),
  chemicalBillingMode: cleanString(template.chemicalBillingMode || template.defaultChemicalBillingMode),
  chemicalBillingMixedSelectionMode: cleanString(
    template.chemicalBillingMixedSelectionMode || template.defaultChemicalBillingMixedSelectionMode
  ),
  includedChemicalIds: normalizeList(template.includedChemicalIds || template.defaultIncludedChemicalIds),
  separatelyBilledChemicalIds: normalizeList(
    template.separatelyBilledChemicalIds || template.defaultSeparatelyBilledChemicalIds
  ),
  chemicalBillingNotes: cleanString(template.chemicalBillingNotes || template.defaultChemicalBillingNotes),
});

export const termsTemplateHasAgreementDefaults = (template = {}) => {
  const defaults = termsTemplateAgreementDefaults(template);
  return Boolean(
    defaults.billingFrequency ||
    defaults.billingFrequencyCount ||
    defaults.rateType ||
    defaults.paymentTerms ||
    defaults.chemicalBillingMode ||
    defaults.chemicalBillingMixedSelectionMode ||
    defaults.includedChemicalIds.length ||
    defaults.separatelyBilledChemicalIds.length ||
    defaults.chemicalBillingNotes
  );
};

export const termsTemplateAgreementDefaultsPatch = (template = {}) => {
  const defaults = termsTemplateAgreementDefaults(template);
  const patch = {};

  if (defaults.billingFrequency) patch.billingFrequency = defaults.billingFrequency;
  if (defaults.billingFrequencyCount) patch.billingFrequencyCount = String(defaults.billingFrequencyCount);
  if (defaults.rateType) patch.rateType = defaults.rateType;
  if (defaults.paymentTerms) patch.paymentTerms = defaults.paymentTerms;

  if (defaults.chemicalBillingMode) {
    patch.chemicalBillingMode = defaults.chemicalBillingMode;
    patch.includedChemicalKeywords = [];
    patch.separatelyBilledChemicalKeywords = [];
    patch.customerPurchasedChemicalKeywords = [];
    patch.customerPurchasedChemicalIds = [];

    if (defaults.chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed) {
      const mixedSelectionMode = defaults.chemicalBillingMixedSelectionMode ||
        TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled;

      patch.chemicalBillingMixedSelectionMode = mixedSelectionMode;
      patch.includedChemicalIds = mixedSelectionMode === TermsTemplateChemicalBillingMixedSelectionMode.included
        ? defaults.includedChemicalIds
        : [];
      patch.separatelyBilledChemicalIds = mixedSelectionMode === TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled
        ? defaults.separatelyBilledChemicalIds
        : [];
    } else {
      patch.chemicalBillingMixedSelectionMode = '';
      patch.includedChemicalIds = [];
      patch.separatelyBilledChemicalIds = [];
    }
  }

  if (defaults.chemicalBillingMode || defaults.chemicalBillingNotes) {
    patch.chemicalBillingNotes = defaults.chemicalBillingNotes;
  }

  return patch;
};

export const applyTermsTemplateAgreementDefaults = (draft = {}, template = {}) => ({
  ...draft,
  ...termsTemplateAgreementDefaultsPatch(template),
});

export const termsTemplateDefaultsFromAgreementDraft = (draft = {}) => {
  const chemicalBillingMode = cleanString(draft.chemicalBillingMode);
  const isMixed = chemicalBillingMode === SalesAgreementChemicalBillingMode.mixed;
  const mixedSelectionMode = isMixed
    ? cleanString(draft.chemicalBillingMixedSelectionMode) ||
      TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled
    : '';

  return {
    billingFrequency: cleanString(draft.billingFrequency),
    billingFrequencyCount: numberOrBlank(draft.billingFrequencyCount),
    rateType: cleanString(draft.rateType),
    paymentTerms: cleanString(draft.paymentTerms),
    chemicalBillingMode,
    chemicalBillingMixedSelectionMode: mixedSelectionMode,
    includedChemicalIds: isMixed && mixedSelectionMode === TermsTemplateChemicalBillingMixedSelectionMode.included
      ? normalizeList(draft.includedChemicalIds)
      : [],
    separatelyBilledChemicalIds: isMixed && mixedSelectionMode === TermsTemplateChemicalBillingMixedSelectionMode.separatelyBilled
      ? normalizeList(draft.separatelyBilledChemicalIds)
      : [],
    chemicalBillingNotes: cleanString(draft.chemicalBillingNotes),
  };
};
