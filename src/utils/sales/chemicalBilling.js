import {
  SalesAgreementChemicalBillingMode,
} from '../models/Sales';

export const ChemicalBillingTreatment = {
  includedInService: 'includedInService',
  separatelyBilled: 'separatelyBilled',
  customerPurchased: 'customerPurchased',
};

const normalizeKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

export const normalizeChemicalTermList = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  return Array.from(new Set(
    String(value || '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
};

const recordIdCandidates = (...records) => (
  Array.from(new Set(
    records
      .filter(Boolean)
      .flatMap((record) => [
        record.id,
        record.itemId,
        record.dataBaseItemId,
        record.databaseItemId,
        record.catalogItemId,
        record.sourceId,
        record.templateId,
        record.universalTemplateId,
        record.dosageTemplateId,
        record.linkedItem,
        record.linkedItemId,
        ...(Array.isArray(record.linkedItemIds) ? record.linkedItemIds : []),
      ])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ))
);

const recordSearchText = (...records) => (
  records
    .filter(Boolean)
    .flatMap((record) => [
      record.name,
      record.chemType,
      record.dosageType,
      record.description,
      record.category,
      record.subCategory,
      record.notes,
      record.sku,
      record.label,
    ])
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
);

const truthyChemicalFlag = (record = {}) => (
  [
    record.customerPurchased,
    record.customerPurchasedChemical,
    record.customerSupplied,
    record.customerSuppliedChemical,
    record.homeownerPurchased,
    record.homeownerSupplied,
    record.ignoreFromPnl,
    record.excludeFromPnl,
  ].some((value) => {
    if (value === true) return true;
    const key = normalizeKey(value);
    return ['true', 'yes', 'y', '1', 'customer', 'homeowner', 'owner', 'customersupplied', 'customerpurchased'].includes(key);
  })
);

const matchesTerms = ({ ids = [], keywords = [], records = [] } = {}) => {
  const normalizedIds = normalizeChemicalTermList(ids).map(normalizeKey).filter(Boolean);
  const normalizedKeywords = normalizeChemicalTermList(keywords).map((term) => term.toLowerCase()).filter(Boolean);
  const candidateIds = recordIdCandidates(...records).map(normalizeKey);
  const searchText = recordSearchText(...records);

  return (
    (normalizedIds.length > 0 && normalizedIds.some((term) => candidateIds.includes(term))) ||
    (normalizedKeywords.length > 0 && normalizedKeywords.some((term) => searchText.includes(term)))
  );
};

export const agreementChemicalBillingMode = (agreement = {}) => {
  const key = normalizeKey(
    agreement.chemicalBillingMode ||
    agreement.chemicalBillingTreatment ||
    agreement.chemicalBilling ||
    ''
  );

  if (['billallseparately', 'billall', 'separateall', 'separatelybillall', 'allseparate'].includes(key)) {
    return SalesAgreementChemicalBillingMode.billAllSeparately;
  }

  if (['mixed', 'selected', 'billselected', 'billselectedseparately', 'selectedseparate'].includes(key)) {
    return SalesAgreementChemicalBillingMode.mixed;
  }

  return SalesAgreementChemicalBillingMode.includedAll;
};

const agreementMixedSelectionMode = (agreement = {}) => normalizeKey(
  agreement.chemicalBillingMixedSelectionMode ||
  agreement.mixedChemicalBillingSelectionMode ||
  ''
);

export const chemicalMatchesAgreementList = (agreement = {}, listPrefix = '', ...records) => (
  matchesTerms({
    ids: agreement[`${listPrefix}Ids`] || agreement[`${listPrefix}ChemicalIds`],
    keywords: agreement[`${listPrefix}Keywords`] || agreement[`${listPrefix}ChemicalKeywords`],
    records,
  })
);

export const classifyAgreementChemicalBilling = ({ agreement = {}, record = {}, linkedRecord = {} } = {}) => {
  const records = [record, linkedRecord];
  const isCustomerPurchased = (
    truthyChemicalFlag(record) ||
    truthyChemicalFlag(linkedRecord) ||
    chemicalMatchesAgreementList(agreement, 'customerPurchasedChemical', ...records)
  );

  if (isCustomerPurchased) {
    return {
      treatment: ChemicalBillingTreatment.customerPurchased,
      billSeparately: false,
      includedInService: false,
      pnlCostIncluded: false,
      reason: 'customerPurchased',
    };
  }

  const isIncludedOverride = chemicalMatchesAgreementList(agreement, 'includedChemical', ...records);
  const isSeparatelyBilled = chemicalMatchesAgreementList(agreement, 'separatelyBilledChemical', ...records);
  const mode = agreementChemicalBillingMode(agreement);
  const mixedSelectionMode = agreementMixedSelectionMode(agreement);
  const mixedDefaultsToSeparatelyBilled = mode === SalesAgreementChemicalBillingMode.mixed
    && ['included', 'selectincluded', 'includedinservice'].includes(mixedSelectionMode);

  if (isIncludedOverride) {
    return {
      treatment: ChemicalBillingTreatment.includedInService,
      billSeparately: false,
      includedInService: true,
      pnlCostIncluded: true,
      reason: 'includedOverride',
    };
  }

  if (isSeparatelyBilled || mode === SalesAgreementChemicalBillingMode.billAllSeparately || mixedDefaultsToSeparatelyBilled) {
    return {
      treatment: ChemicalBillingTreatment.separatelyBilled,
      billSeparately: true,
      includedInService: false,
      pnlCostIncluded: true,
      reason: isSeparatelyBilled
        ? 'matchedSeparatelyBilledTerms'
        : mode === SalesAgreementChemicalBillingMode.billAllSeparately
          ? 'billAllSeparately'
          : 'mixedDefaultSeparatelyBilled',
    };
  }

  return {
    treatment: ChemicalBillingTreatment.includedInService,
    billSeparately: false,
    includedInService: true,
    pnlCostIncluded: true,
    reason: mode === SalesAgreementChemicalBillingMode.mixed ? 'mixedDefaultIncluded' : 'includedAll',
  };
};

export const chemicalBillingLabel = (agreement = {}) => {
  const mode = agreementChemicalBillingMode(agreement);
  if (mode === SalesAgreementChemicalBillingMode.billAllSeparately) return 'Bill All Chemicals Separately';
  if (mode === SalesAgreementChemicalBillingMode.mixed) return 'Mixed Chemical Billing';
  return 'Chemicals Included In Service';
};
