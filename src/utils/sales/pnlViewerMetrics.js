import { estimateServiceStopPaySummary } from '../payroll/payEstimate';
import {
  ChemicalBillingTreatment,
  classifyAgreementChemicalBilling,
} from './chemicalBilling';

export const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export const moneyFromCents = (value = 0) => currencyFormatter.format((Number(value) || 0) / 100);

export const dateFromValue = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const reportStatusKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const labelize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const cents = (value) => Math.round(toNumber(value));

export const firstPresent = (...values) =>
  values.find((value) => value !== null && value !== undefined && value !== '');

const moneyNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const centsField = (...values) => Math.round(moneyNumber(firstPresent(...values)));

const dollarFieldToCents = (...values) => Math.round(moneyNumber(firstPresent(...values)) * 100);

const positiveCentsField = (...values) => {
  const value = centsField(...values);
  return value > 0 ? value : 0;
};

const positiveDollarFieldToCents = (...values) => {
  const value = dollarFieldToCents(...values);
  return value > 0 ? value : 0;
};

export const normalizeDocs = (snapshot) => snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

export const normalizeIdList = (...values) =>
  Array.from(new Set(
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    })
  ));

export const monthRangesForRange = (rangeStart, rangeEnd) => {
  const fallbackYear = new Date().getFullYear();
  const startValue = dateFromValue(rangeStart) || new Date(fallbackYear, 0, 1, 0, 0, 0, 0);
  const endValue = dateFromValue(rangeEnd) || new Date(startValue.getFullYear(), 11, 31, 23, 59, 59, 999);
  const firstMonth = new Date(startValue.getFullYear(), startValue.getMonth(), 1, 0, 0, 0, 0);
  const lastMonth = new Date(endValue.getFullYear(), endValue.getMonth(), 1, 0, 0, 0, 0);
  const months = [];
  let cursor = firstMonth;
  let index = 0;

  while (cursor <= lastMonth) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    const start = monthStart < startValue ? startValue : monthStart;
    const end = monthEnd > endValue ? endValue : monthEnd;
    const showYear = startValue.getFullYear() !== endValue.getFullYear();

    months.push({
      index,
      calendarMonthIndex: cursor.getMonth(),
      year: cursor.getFullYear(),
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      label: cursor.toLocaleDateString('en-US', showYear ? { month: 'short', year: '2-digit' } : { month: 'short' }),
      longLabel: cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      start,
      end,
    });

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 0, 0, 0, 0);
    index += 1;
  }

  return months;
};

export const monthRangesForYear = (year = new Date().getFullYear()) => (
  Array.from({ length: 12 }, (_, index) => {
    const start = new Date(year, index, 1, 0, 0, 0, 0);
    const end = new Date(year, index + 1, 0, 23, 59, 59, 999);
    return {
      index,
      calendarMonthIndex: index,
      year,
      key: `${year}-${String(index + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-US', { month: 'short' }),
      longLabel: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      start,
      end,
    };
  })
);

export const monthIndexForDate = (value, months = []) => {
  const date = dateFromValue(value);
  if (!date) return -1;
  return months.findIndex((month) => date >= month.start && date <= month.end);
};

export const isInactiveAgreementStatus = (status) =>
  ['canceled', 'cancelled', 'rejected', 'expired', 'void', 'voided'].includes(reportStatusKey(status));

export const agreementHistoryGroupId = (agreement = {}) => (
  agreement.agreementHistoryGroupId ||
  agreement.supersedesAgreementId ||
  agreement.previousAgreementId ||
  agreement.renewalSourceAgreementId ||
  agreement.id ||
  ''
);

export const agreementEffectiveDate = (agreement = {}) => dateFromValue(
  firstPresent(agreement.startDate, agreement.acceptedAt, agreement.sentAt, agreement.createdAt)
);

export const agreementAmountCents = (agreement = {}) => {
  const directAmount = centsField(
    agreement.totalAmountCents,
    agreement.rateAmountCents,
    agreement.subtotalAmountCents,
    agreement.amountCents
  );
  if (directAmount) return directAmount;

  const lineItems = Array.isArray(agreement.lineItems) ? agreement.lineItems : [];
  return lineItems.reduce((total, item) => {
    const quantity = Number(item.quantity || 1) || 1;
    const lineTotal = centsField(item.totalAmountCents);
    if (lineTotal) return total + lineTotal;
    return total + Math.round(centsField(item.unitAmountCents) * quantity);
  }, 0);
};

export const agreementServiceLocationIds = (agreement = {}) => {
  const ids = normalizeIdList(agreement.serviceLocationIds);
  if (ids.length) return ids;

  const snapshots = Array.isArray(agreement.serviceLocationSnapshots) ? agreement.serviceLocationSnapshots : [];
  return normalizeIdList(...snapshots.map((snapshot) => snapshot.id || snapshot.serviceLocationId));
};

const activeRangeOverlapDays = (recordStart, recordEnd, rangeStart, rangeEnd) => {
  const start = dateFromValue(recordStart);
  const end = dateFromValue(recordEnd);
  const effectiveStart = start && start > rangeStart ? start : rangeStart;
  const effectiveEnd = end && end < rangeEnd ? end : rangeEnd;

  if (effectiveStart > rangeEnd || effectiveEnd < rangeStart) return 0;

  return Math.max(1, Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / 86400000));
};

const billingIntervalDays = (record = {}) => {
  const frequency = reportStatusKey(
    record.billingFrequency ||
    record.billingCadence ||
    record.invoiceFrequency ||
    record.rateType ||
    'monthly'
  );
  const count = Math.max(
    Number(record.billingFrequencyCount || record.billingCadenceCount || record.invoiceFrequencyCount || 1),
    1
  );

  if (frequency.includes('day')) return count;
  if (frequency.includes('week')) return 7 * count;
  if (frequency.includes('year') || frequency.includes('annual')) return 365.25 * count;
  return 30.4375 * count;
};

export const agreementRevenueCentsForRange = (agreement = {}, startDate, endDate) => {
  if (isInactiveAgreementStatus(agreement.status)) return 0;
  if (agreement.pnlIncludeInReports === false) return 0;

  const amountCents = agreementAmountCents(agreement);
  if (!amountCents) return 0;

  const agreementStart = firstPresent(agreement.startDate, agreement.acceptedAt, agreement.sentAt, agreement.createdAt);
  const agreementEnd = firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt);
  const overlapDays = activeRangeOverlapDays(agreementStart, agreementEnd, startDate, endDate);
  if (!overlapDays) return 0;

  return Math.round(amountCents * (overlapDays / billingIntervalDays(agreement)));
};

const templateMap = (templates = [], alternateIdField = '') => {
  const map = new Map();
  templates.forEach((template) => {
    if (template.id) map.set(template.id, template);
    if (alternateIdField && template[alternateIdField]) map.set(template[alternateIdField], template);
    [
      template.templateId,
      template.universalTemplateId,
      template.dosageTemplateId,
    ].filter(Boolean).forEach((id) => map.set(id, template));
  });
  return map;
};

const dosageTemplateFor = (dosage, dosageTemplatesById) =>
  dosageTemplatesById.get(dosage.templateId) ||
  dosageTemplatesById.get(dosage.universalTemplateId) ||
  dosageTemplatesById.get(dosage.dosageTemplateId) ||
  null;

const reportItemUnit = (item = {}, template = {}) =>
  item.UOM || item.uom || template.UOM || template.uom || '';

const valueWithUnit = (item = {}) =>
  [item.amount ?? '', item.UOM || item.uom || ''].filter(Boolean).join(' ').trim() || '-';

const purchaseDatabaseItem = (item = {}, databaseItemById = new Map()) =>
  databaseItemById.get(item.itemId) ||
  databaseItemById.get(item.dataBaseItemId) ||
  databaseItemById.get(item.databaseItemId) ||
  databaseItemById.get(item.templateId) ||
  null;

const purchaseDatabaseItemId = (item = {}) =>
  item.itemId || item.dataBaseItemId || item.databaseItemId || item.templateId || '';

const dosageLinkedItemIds = (dosage = {}, template = {}) =>
  normalizeIdList(
    template?.linkedItemIds,
    template?.linkedItemId,
    template?.linkedItem,
    template?.itemId,
    dosage.linkedItemIds,
    dosage.linkedItemId,
    dosage.linkedItem,
    dosage.itemId
  );

const normalizeUnit = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || /^\d+(\.\d+)?$/.test(raw)) return '';
  if (/fl\s*oz|fluid\s*ounce/.test(raw)) return 'floz';
  if (/gal|gallon/.test(raw)) return 'gal';
  if (/\blbs?\b|pound/.test(raw)) return 'lb';
  if (/quart|\bqt\b/.test(raw)) return 'qt';
  if (/liter|litre|\bl\b/.test(raw)) return 'l';
  if (/ounce|\boz\b/.test(raw)) return 'oz';
  if (/tab|tablet/.test(raw)) return 'tab';
  if (/each|\bea\b|unit/.test(raw)) return 'unit';
  return raw.replace(/[^a-z0-9]+/g, '');
};

const inferPackageUnit = (...values) => {
  const inferred = normalizeUnit(values.filter(Boolean).join(' '));
  return inferred === 'unit' ? '' : inferred;
};

const parseFirstNumber = (value) => {
  const match = String(value || '').replaceAll(',', '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const volumeToGallons = {
  floz: 1 / 128,
  gal: 1,
  l: 0.264172,
  oz: 1 / 128,
  qt: 0.25,
};

const weightToPounds = {
  lb: 1,
  oz: 1 / 16,
};

const resolveUnitFamily = (fromUnit, toUnit) => {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to || from === to) return null;

  const volumeUnits = new Set(Object.keys(volumeToGallons));
  const weightUnits = new Set(Object.keys(weightToPounds));
  const nonOunceVolumeUnits = new Set(['floz', 'gal', 'l', 'qt']);
  const nonOunceWeightUnits = new Set(['lb']);

  if (from === 'oz' && nonOunceVolumeUnits.has(to)) return 'volume';
  if (to === 'oz' && nonOunceVolumeUnits.has(from)) return 'volume';
  if (from === 'oz' && nonOunceWeightUnits.has(to)) return 'weight';
  if (to === 'oz' && nonOunceWeightUnits.has(from)) return 'weight';
  if (volumeUnits.has(from) && volumeUnits.has(to)) return 'volume';
  if (weightUnits.has(from) && weightUnits.has(to)) return 'weight';
  return null;
};

const convertAmount = (amount, fromUnit, toUnit) => {
  const numericAmount = Number(amount);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!Number.isFinite(numericAmount)) return null;
  if (!from || !to || from === to) return numericAmount;

  const family = resolveUnitFamily(from, to);
  if (family === 'volume') return (numericAmount * volumeToGallons[from]) / volumeToGallons[to];
  if (family === 'weight') return (numericAmount * weightToPounds[from]) / weightToPounds[to];
  return null;
};

const packageQuantityInfo = ({ purchase = {}, databaseItem = {}, lineQuantity = 1 } = {}) => {
  const sizeValue = databaseItem.size ?? purchase.size ?? purchase.packageSize ?? purchase.packageQuantity ?? '';
  const parsedPackageSize = parseFirstNumber(sizeValue);
  const packageSize = parsedPackageSize && parsedPackageSize > 0 ? parsedPackageSize : 1;
  const sizeUnit = normalizeUnit(sizeValue);
  const databaseItemUnit = normalizeUnit(databaseItem.UOM || databaseItem.uom);
  const purchaseUnit = normalizeUnit(purchase.UOM || purchase.uom);
  const textUnit = inferPackageUnit(
    sizeValue,
    databaseItem.name,
    databaseItem.description,
    databaseItem.subCategory,
    databaseItem.category,
    purchase.name,
    purchase.description,
    purchase.notes
  );
  const itemUnit = databaseItemUnit === 'unit' && textUnit ? textUnit : databaseItemUnit;
  const lineUnit = purchaseUnit === 'unit' && textUnit ? textUnit : purchaseUnit;
  const unit = sizeUnit || itemUnit || lineUnit || textUnit || 'unit';

  return {
    amount: Number(lineQuantity || 1) * packageSize,
    lineQuantity,
    packageSize,
    unit,
  };
};

const purchaseQuantity = (purchase, databaseItemById) => {
  const databaseItem = purchaseDatabaseItem(purchase, databaseItemById) || {};
  const lineQuantity = toNumber(purchase.quantity ?? purchase.quantityString ?? 1) || 1;
  return packageQuantityInfo({ purchase, databaseItem, lineQuantity });
};

const purchaseTotalCents = (item = {}) => {
  const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
  const priceCents = cents(item.priceCents ?? item.price ?? item.unitCostCents);
  const explicitTotal = cents(item.totalAfterTaxCents ?? item.totalCents ?? item.costAfterTax);
  if (explicitTotal > 0) return explicitTotal;
  return Math.round(priceCents * quantity * 1.085);
};

const databaseItemPackageCostCents = (item = {}) =>
  positiveCentsField(item.rate, item.rateCents, item.unitCostCents, item.costCents) ||
  positiveDollarFieldToCents(item.unitCost, item.cost);

const linkedItemSetForDosage = (dosage = {}, template = {}) =>
  new Set(dosageLinkedItemIds(dosage, template).map(String).filter(Boolean));

const linkedPurchaseUnitCostEstimate = ({ dosage = {}, template = {}, purchases = [], databaseItemById = new Map() } = {}) => {
  const linkedItemIds = linkedItemSetForDosage(dosage, template);
  const dosageUnit = normalizeUnit(reportItemUnit(dosage, template));
  if (!linkedItemIds.size || !dosageUnit) return null;

  const totals = purchases.reduce((result, purchase) => {
    const purchaseItemId = String(purchaseDatabaseItemId(purchase) || '');
    if (!linkedItemIds.has(purchaseItemId)) return result;

    const quantityInfo = purchaseQuantity(purchase, databaseItemById);
    const convertedAmount = convertAmount(quantityInfo.amount, quantityInfo.unit, dosageUnit);
    if (convertedAmount === null || convertedAmount <= 0) return result;

    const spendCents = purchaseTotalCents(purchase);
    if (!spendCents) return result;

    result.spendCents += spendCents;
    result.amount += convertedAmount;
    result.purchaseLines += 1;
    return result;
  }, { spendCents: 0, amount: 0, purchaseLines: 0 });

  if (!totals.amount) return null;

  return {
    unitCostCents: totals.spendCents / totals.amount,
    source: `${totals.purchaseLines} linked purchase${totals.purchaseLines === 1 ? '' : 's'}`,
  };
};

const linkedCatalogUnitCostEstimate = ({ dosage = {}, template = {}, databaseItemById = new Map() } = {}) => {
  const linkedItemIds = linkedItemSetForDosage(dosage, template);
  const dosageUnit = normalizeUnit(reportItemUnit(dosage, template));
  if (!linkedItemIds.size || !dosageUnit) return null;

  const totals = [...linkedItemIds].reduce((result, itemId) => {
    const databaseItem = databaseItemById.get(itemId);
    if (!databaseItem) return result;

    const packageCostCents = databaseItemPackageCostCents(databaseItem);
    if (!packageCostCents) return result;

    const quantityInfo = packageQuantityInfo({ databaseItem });
    const convertedAmount = convertAmount(quantityInfo.amount, quantityInfo.unit, dosageUnit);
    if (convertedAmount === null || convertedAmount <= 0) return result;

    result.costCents += packageCostCents;
    result.amount += convertedAmount;
    result.itemCount += 1;
    return result;
  }, { costCents: 0, amount: 0, itemCount: 0 });

  if (!totals.amount) return null;

  return {
    unitCostCents: totals.costCents / totals.amount,
    source: `${totals.itemCount} linked catalog item${totals.itemCount === 1 ? '' : 's'}`,
  };
};

const dosageTemplateUnitCostEstimate = (dosage = {}, template = {}) => {
  const unitCostCents =
    positiveCentsField(dosage.unitCostCents, dosage.costCents, template.unitCostCents, template.costCents) ||
    positiveDollarFieldToCents(dosage.unitCost, dosage.cost, template.unitCost, template.cost, dosage.rate, template.rate);

  return unitCostCents ? { unitCostCents, source: 'template cost' } : null;
};

const dosageAmountForCost = (dosage = {}) => {
  const amount = Number(dosage.amount ?? dosage.quantity ?? dosage.value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

const dosageChemicalCostEstimate = ({ dosage = {}, template = {}, purchases = [], databaseItemById = new Map() } = {}) => {
  const explicitTotalCents =
    positiveCentsField(dosage.totalCostCents, dosage.extendedCostCents) ||
    positiveDollarFieldToCents(dosage.totalCost, dosage.extendedCost);
  const amount = dosageAmountForCost(dosage);

  if (explicitTotalCents) {
    return {
      totalCostCents: explicitTotalCents,
      unitCostCents: amount > 0 ? explicitTotalCents / amount : 0,
      source: 'explicit dosage cost',
    };
  }

  if (amount <= 0) return { totalCostCents: 0, unitCostCents: 0, source: '' };

  const unitCostEstimate =
    linkedPurchaseUnitCostEstimate({ dosage, template, purchases, databaseItemById }) ||
    linkedCatalogUnitCostEstimate({ dosage, template, databaseItemById }) ||
    dosageTemplateUnitCostEstimate(dosage, template);

  if (!unitCostEstimate?.unitCostCents) return { totalCostCents: 0, unitCostCents: 0, source: '' };

  return {
    ...unitCostEstimate,
    totalCostCents: Math.round(amount * unitCostEstimate.unitCostCents),
  };
};

const dosageTemplateUnitPriceCents = (dosage = {}, template = {}) =>
  positiveCentsField(
    dosage.priceCents,
    dosage.unitPriceCents,
    dosage.billingRateCents,
    dosage.sellPriceCents,
    template.priceCents,
    template.unitPriceCents,
    template.billingRateCents,
    template.sellPriceCents
  ) ||
  positiveDollarFieldToCents(
    dosage.price,
    dosage.unitPrice,
    dosage.billingRate,
    dosage.sellPrice,
    template.price,
    template.unitPrice,
    template.billingRate,
    template.sellPrice
  );

const dosageChemicalRevenueCents = (dosage = {}, template = {}) => {
  const amount = dosageAmountForCost(dosage);
  const unitPriceCents = dosageTemplateUnitPriceCents(dosage, template);
  return amount > 0 && unitPriceCents > 0 ? Math.round(amount * unitPriceCents) : 0;
};

const truthyReportFlag = (value) => (
  value === true ||
  value === 1 ||
  ['true', 'yes', 'y', '1', 'customer', 'homeowner', 'owner', 'separate', 'separatelybilled', 'billseparately']
    .includes(reportStatusKey(value))
);

const reportTermList = (...values) => (
  Array.from(new Set(
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      return String(value || '').split(/[\n,]/);
    })
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ))
);

const recordIdCandidates = (...records) => (
  reportTermList(...records.flatMap((record) => [
    record?.id,
    record?.itemId,
    record?.dataBaseItemId,
    record?.databaseItemId,
    record?.templateId,
    record?.universalTemplateId,
    record?.dosageTemplateId,
    record?.linkedItemId,
    record?.linkedItemIds,
    record?.catalogItemId,
    record?.sourceId,
  ])).map((value) => reportStatusKey(value))
);

const recordSearchText = (...records) => (
  records.flatMap((record) => [
    record?.name,
    record?.chemType,
    record?.dosageType,
    record?.description,
    record?.category,
    record?.itemCategory,
    record?.materialCategory,
    record?.sku,
    record?.UOM,
    record?.uom,
  ]).filter(Boolean).join(' ').toLowerCase()
);

const customerPurchasedCostRecord = (...records) => records.some((record) => [
  record?.customerPurchased,
  record?.customerSupplied,
  record?.ownerSupplied,
  record?.homeownerSupplied,
  record?.purchasedByCustomer,
  record?.paidByCustomer,
  record?.excludeFromPnl,
  record?.excludeFromPNL,
  record?.pnlExcluded,
].some(truthyReportFlag));

const likelyChemicalCostRecord = (...records) => {
  if (records.some((record) => record?.isChemicalCostRecord)) return true;
  const text = recordSearchText(...records);
  return /\b(chem|chlor|tab|tablet|trichlor|dichlor|shock|acid|alkalinity|soda|bicarb|salt|algaecide|phosphate|clarifier|enzyme)\b/.test(text);
};

const pnlChemicalCostModes = {
  includeAll: 'includeAll',
  excludeAll: 'excludeAll',
  excludeSelected: 'excludeSelected',
};

const agreementChemicalCostMode = (agreement = {}) => {
  if (agreement.pnlExcludeAllChemicalCosts === true) return pnlChemicalCostModes.excludeAll;
  const mode = agreement.pnlChemicalCostMode || agreement.pnlChemicalCostTreatment || agreement.chemicalCostTreatment;
  if (Object.values(pnlChemicalCostModes).includes(mode)) return mode;
  const modeKey = reportStatusKey(mode);
  if (['excludeall', 'excludeallchemicals', 'separate', 'separatelybilled', 'billseparately'].includes(modeKey)) {
    return pnlChemicalCostModes.excludeAll;
  }
  if (['excludeselected', 'selected', 'specificchemicals'].includes(modeKey)) {
    return pnlChemicalCostModes.excludeSelected;
  }
  if (reportTermList(agreement.pnlExcludedChemicalIds, agreement.pnlExcludedChemicalKeywords).length) {
    return pnlChemicalCostModes.excludeSelected;
  }
  return pnlChemicalCostModes.includeAll;
};

const chemicalCostMatchesAgreementTerms = (agreement = {}, ...records) => {
  const terms = reportTermList(
    agreement.pnlExcludedChemicalIds,
    agreement.pnlExcludedChemicalKeywords,
    agreement.pnlExcludedChemicals
  );
  if (!terms.length) return false;

  const ids = recordIdCandidates(...records);
  const text = recordSearchText(...records);

  return terms.some((term) => {
    const normalizedTerm = reportStatusKey(term);
    if (!normalizedTerm) return false;
    if (ids.includes(normalizedTerm)) return true;
    return text.includes(String(term).trim().toLowerCase());
  });
};

const agreementAppliesToRecord = (agreement = {}, record = {}) => {
  const agreementCustomerId = String(agreement.customerId || '').trim();
  const recordCustomerId = String(record.customerId || record.customer || '').trim();
  if (agreementCustomerId && recordCustomerId && agreementCustomerId !== recordCustomerId) return false;

  const agreementLocationIds = agreementServiceLocationIds(agreement);
  const recordLocationIds = normalizeIdList(record.serviceLocationId, record.serviceLocationIds, record.locationId);
  if (agreementLocationIds.length && recordLocationIds.length && !recordLocationIds.some((id) => agreementLocationIds.includes(id))) {
    return false;
  }

  return Boolean(agreementCustomerId || agreementLocationIds.length);
};

const agreementActiveForDate = (agreement = {}, value) => {
  const date = dateFromValue(value);
  if (!date) return true;
  const agreementStart = firstPresent(agreement.startDate, agreement.acceptedAt, agreement.sentAt, agreement.createdAt);
  const agreementEnd = firstPresent(agreement.endDate, agreement.canceledAt, agreement.cancelledAt);
  return activeRangeOverlapDays(agreementStart, agreementEnd, date, date) > 0;
};

const itemDate = (item, fields) => {
  for (const field of fields) {
    const date = dateFromValue(item[field]);
    if (date) return date;
  }
  return null;
};

const agreementForPnlCost = (agreements = [], record = {}, value) => {
  const date = dateFromValue(value) || itemDate(record, ['date', 'createdAt', 'dateCreated', 'completedDate', 'serviceDate']);
  const recordLocationIds = normalizeIdList(record.serviceLocationId, record.serviceLocationIds, record.locationId);

  return agreements
    .filter((agreement) => (
      !isInactiveAgreementStatus(agreement.status) &&
      agreementAppliesToRecord(agreement, record) &&
      agreementActiveForDate(agreement, date)
    ))
    .sort((left, right) => {
      const leftLocationMatch = agreementServiceLocationIds(left).some((id) => recordLocationIds.includes(id));
      const rightLocationMatch = agreementServiceLocationIds(right).some((id) => recordLocationIds.includes(id));
      if (leftLocationMatch !== rightLocationMatch) return leftLocationMatch ? -1 : 1;
      return toNumber(right.agreementVersion || 1) - toNumber(left.agreementVersion || 1);
    })[0] || null;
};

const shouldExcludePnlChemicalCost = ({ agreement = null, record = {}, linkedRecord = {} } = {}) => {
  if (agreement) {
    const chemicalBilling = classifyAgreementChemicalBilling({ agreement, record, linkedRecord });
    if (chemicalBilling.treatment === ChemicalBillingTreatment.customerPurchased) {
      return agreement.pnlExcludeCustomerPurchasedChemicals !== false;
    }
  }

  if (customerPurchasedCostRecord(record, linkedRecord)) {
    return !agreement || agreement.pnlExcludeCustomerPurchasedChemicals !== false;
  }

  if (!agreement) return false;

  const mode = agreementChemicalCostMode(agreement);
  if (mode === pnlChemicalCostModes.excludeAll) return likelyChemicalCostRecord(record, linkedRecord);
  if (mode === pnlChemicalCostModes.excludeSelected) return chemicalCostMatchesAgreementTerms(agreement, record, linkedRecord);
  return false;
};

const addressLine = (record = {}) => {
  const address = record.address || record.billingAddress || {};
  return [
    address.streetAddress || record.streetAddress,
    address.address02 || record.address02,
    [address.city || record.city, address.state || record.state, address.zip || record.zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
};

const serviceLocationName = (location = {}) =>
  [
    location.nickName || location.name || location.label,
    addressLine(location),
  ].filter(Boolean).join(' | ') || location.id || 'No Service Location';

const customerDisplayName = (customer = {}) => {
  if (!customer) return '';
  const personalName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || customer.businessName || customer.displayName || customer.customerName || customer.label || personalName || '';
  }
  return customer.customerName || customer.displayName || customer.name || personalName || customer.label || customer.company || customer.companyName || customer.email || '';
};

const targetRateCentsFor = (costCents, margin = 0.45) => {
  const cost = Math.max(Number(costCents || 0), 0);
  if (!cost) return 0;
  return Math.ceil((cost / (1 - margin)) / 100) * 100;
};

const marginPercent = (netCents, revenueCents) => {
  const revenue = Number(revenueCents || 0);
  if (!revenue) return null;
  return (Number(netCents || 0) / revenue) * 100;
};

const payrollLineCents = (line = {}) => cents(line.totalAmountCents ?? line.amountCents ?? line.payCents ?? 0);

const workerDisplayName = (record = {}, fallback = '-') =>
  record.userName ||
  record.techName ||
  record.technicianName ||
  record.tech ||
  record.workerName ||
  record.companyUserName ||
  record.adminName ||
  record.workerId ||
  record.techId ||
  record.technicianId ||
  record.userId ||
  fallback;

const monthlyMetric = () => ({
  revenueCents: 0,
  chemicalRevenueCents: 0,
  laborCents: 0,
  chemicalCents: 0,
  visits: 0,
  netCents: 0,
});

const averageNonZero = (values = []) => {
  const nonZeroValues = values.filter((value) => Number(value || 0) !== 0);
  if (!nonZeroValues.length) return 0;
  return Math.round(nonZeroValues.reduce((total, value) => total + value, 0) / nonZeroValues.length);
};

const latestNonZeroMonth = (months = []) => {
  const now = new Date();
  const eligible = months.filter((month) => !month.end || month.start <= now);
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    if (eligible[index].netCents !== 0) return eligible[index];
  }
  return eligible[eligible.length - 1] || months[months.length - 1] || null;
};

const historySortValue = (agreement = {}) => {
  const date = agreementEffectiveDate(agreement);
  return date?.getTime() || 0;
};

export const sortAgreementHistory = (agreements = []) =>
  [...agreements].sort((left, right) => (
    historySortValue(left) - historySortValue(right) ||
    Number(left.agreementVersion || 1) - Number(right.agreementVersion || 1)
  ));

export const getAgreementLastRaisedAt = (history = []) => {
  const sorted = sortAgreementHistory(history).filter((agreement) => agreementAmountCents(agreement) > 0);
  let previousAmount = null;
  let lastRaisedAt = null;

  sorted.forEach((agreement) => {
    const amount = agreementAmountCents(agreement);
    const effectiveDate = agreementEffectiveDate(agreement);
    if (previousAmount !== null && amount > previousAmount && effectiveDate) {
      lastRaisedAt = effectiveDate;
    }
    previousAmount = amount;
  });

  return lastRaisedAt;
};

export const getAgreementHistorySummary = (history = []) => {
  const sorted = sortAgreementHistory(history);
  return sorted.map((agreement, index) => {
    const previousAmount = index > 0 ? agreementAmountCents(sorted[index - 1]) : null;
    const amount = agreementAmountCents(agreement);
    return {
      ...agreement,
      amountCents: amount,
      amountDeltaCents: previousAmount === null ? 0 : amount - previousAmount,
      effectiveDate: agreementEffectiveDate(agreement),
    };
  });
};

const noteTextForAgreement = (agreement = {}) => (
  [
    agreement.notes,
    agreement.description,
    agreement.chemicalBillingNotes,
    agreement.acceptedNote ? `Accepted note: ${agreement.acceptedNote}` : '',
    Array.isArray(agreement.includedServices) && agreement.includedServices.length
      ? `Included: ${agreement.includedServices.join(', ')}`
      : '',
    Array.isArray(agreement.excludedServices) && agreement.excludedServices.length
      ? `Excluded: ${agreement.excludedServices.join(', ')}`
      : '',
  ].filter(Boolean).join(' | ')
);

const extractWaterLevels = (stop = {}) => {
  const readings = Array.isArray(stop.readings) ? stop.readings : [];
  const findReading = (patterns) => readings.find((reading) => {
    const label = `${reading.name || ''} ${reading.chemType || ''} ${reading.readingType || ''}`.toLowerCase();
    return patterns.some((pattern) => pattern.test(label));
  });
  const hardness = findReading([/hardness/, /\bcalcium\b/, /\bch\b/]);
  const cya = findReading([/\bcya\b/, /cyanuric/]);
  const parts = [
    hardness ? `Hardness ${valueWithUnit(hardness)}` : '',
    cya ? `CYA ${valueWithUnit(cya)}` : '',
  ].filter(Boolean);
  return parts.join(' / ');
};

const serviceStopUseCaseSourceId = (serviceStop = {}) => {
  if (serviceStop.jobId) return 'system_job_service_stop';
  if (serviceStop.recurringServiceStopId || serviceStop.recurringStopId) return 'system_recurring_service_stop';
  if (serviceStop.serviceAgreementId || serviceStop.agreementId) return 'system_service_agreement_estimate_service_stop';
  return '';
};

const keyValue = (value) => String(value || '').trim().toLowerCase();

const serviceStopTypeLookup = (companyServiceStopTypes = []) => {
  const byId = new Map();
  const byName = new Map();
  companyServiceStopTypes.forEach((type) => {
    ['id', 'typeId', 'serviceStopTypeId'].forEach((field) => {
      const value = String(type?.[field] || '').trim();
      if (value) byId.set(value, type);
    });
    [type?.name, type?.serviceStopTypeName, type?.type].forEach((value) => {
      const key = keyValue(value);
      if (key && !byName.has(key)) byName.set(key, type);
    });
  });
  return { byId, byName };
};

const buildEmptyRow = (descriptor, months) => ({
  ...descriptor,
  agreementIds: new Set(),
  historyGroupIds: new Set(),
  agreements: [],
  monthly: months.map(monthlyMetric),
  visits: 0,
  notes: '',
  waterLevels: '',
  latestWaterLevelTime: 0,
});

export const buildPnlViewerMatrix = ({
  companyId = '',
  selectedYear = new Date().getFullYear(),
  dateRangeStart = null,
  dateRangeEnd = null,
  stopData = [],
  serviceStops = [],
  payrollLines = [],
  paySettings = null,
  companyUsers = [],
  companyServiceStopTypes = [],
  companyWorkTypes = [],
  workTypeMappings = [],
  technicianRates = [],
  serviceStopTasksById = new Map(),
  dosageTemplates = [],
  serviceAgreements = [],
  serviceLocations = [],
  bodiesOfWater = [],
  customersById = new Map(),
  purchases = [],
  databaseItemById = new Map(),
} = {}) => {
  const months = monthRangesForRange(
    dateRangeStart || new Date(selectedYear, 0, 1, 0, 0, 0, 0),
    dateRangeEnd || new Date(selectedYear, 11, 31, 23, 59, 59, 999)
  );
  const serviceLocationsById = new Map(serviceLocations.map((location) => [location.id, location]));
  const bodiesById = new Map(bodiesOfWater.map((body) => [body.id, body]));
  const bodiesByLocationId = new Map();
  const dosageTemplatesById = templateMap(dosageTemplates, 'dosageTemplateId');
  const serviceStopsById = new Map();
  const stopDataByServiceStopId = new Map();
  const pools = new Map();
  const actualPayServiceStopIds = new Set();
  const { byId: serviceStopTypesById, byName: serviceStopTypesByName } = serviceStopTypeLookup(companyServiceStopTypes);

  bodiesOfWater
    .filter((body) => body.active !== false && body.isActive !== false)
    .forEach((body) => {
      const serviceLocationId = body.serviceLocationId || '';
      if (!serviceLocationId) return;
      if (!bodiesByLocationId.has(serviceLocationId)) bodiesByLocationId.set(serviceLocationId, []);
      bodiesByLocationId.get(serviceLocationId).push(body);
    });

  const indexByIds = (map, record, fields) => {
    fields.forEach((field) => {
      const value = record?.[field];
      if (value) map.set(String(value), record);
    });
  };

  serviceStops.forEach((stop) => {
    indexByIds(serviceStopsById, stop, ['id', 'serviceStopId', 'internalId']);
  });

  stopData.forEach((stop, index) => {
    const stopId = String(stop.serviceStopId || stop.id || `stop-data-${index}`);
    if (!stopDataByServiceStopId.has(stopId)) stopDataByServiceStopId.set(stopId, []);
    stopDataByServiceStopId.get(stopId).push(stop);
  });

  const customerNameFor = (customerId, fallback = '') => {
    const customer = customerId ? customersById.get(customerId) : null;
    return customerDisplayName(customer) || fallback || customerId || 'No Customer';
  };

  const poolDescriptor = ({ bodyOfWaterId = '', serviceLocationId = '', customerId = '', customerName = '' } = {}) => {
    const body = bodyOfWaterId ? bodiesById.get(bodyOfWaterId) || {} : {};
    const resolvedServiceLocationId = serviceLocationId || body.serviceLocationId || '';
    const location = resolvedServiceLocationId ? serviceLocationsById.get(resolvedServiceLocationId) || {} : {};
    const resolvedCustomerId = customerId || body.customerId || location.customerId || 'no-customer';
    const resolvedCustomer = resolvedCustomerId ? customersById.get(resolvedCustomerId) : null;
    const resolvedCustomerName = customerNameFor(resolvedCustomerId, customerName || body.customerName || location.customerName);
    const locationName = serviceLocationName(location);
    const poolName =
      body.name ||
      body.nickName ||
      body.label ||
      location.poolName ||
      location.nickName ||
      locationName ||
      'Pool';
    const id = body.id
      ? `body:${body.id}`
      : `location:${resolvedServiceLocationId || resolvedCustomerId || 'unknown'}`;
    const poolType =
      body.poolType ||
      body.type ||
      body.bodyOfWaterType ||
      location.poolType ||
      location.serviceType ||
      'Pool';

    return {
      id,
      customerId: resolvedCustomerId,
      customerName: resolvedCustomerName,
      customerTags: Array.isArray(resolvedCustomer?.tags) ? resolvedCustomer.tags : [],
      serviceLocationId: resolvedServiceLocationId,
      serviceLocation: locationName,
      bodyOfWaterId: body.id || '',
      pool: poolName,
      poolType,
    };
  };

  const poolDescriptorsForLocation = (serviceLocationId, fallback = {}) => {
    const bodies = bodiesByLocationId.get(serviceLocationId) || [];
    if (bodies.length) {
      return bodies.map((body) =>
        poolDescriptor({
          bodyOfWaterId: body.id,
          serviceLocationId,
          customerId: fallback.customerId,
          customerName: fallback.customerName,
        })
      );
    }

    return [
      poolDescriptor({
        serviceLocationId,
        customerId: fallback.customerId,
        customerName: fallback.customerName,
      }),
    ];
  };

  const fallbackPoolDescriptorsForCustomer = (customerId, customerName) => {
    const locations = serviceLocations.filter((location) => location.customerId === customerId && location.active !== false && location.isActive !== false);
    if (!locations.length) return [poolDescriptor({ customerId, customerName })];
    return locations.flatMap((location) => poolDescriptorsForLocation(location.id, { customerId, customerName }));
  };

  const uniqueDescriptors = (descriptors) => {
    const seen = new Set();
    return descriptors.filter((descriptor) => {
      if (!descriptor?.id || seen.has(descriptor.id)) return false;
      seen.add(descriptor.id);
      return true;
    });
  };

  const ensurePool = (descriptor) => {
    const poolId = descriptor.id || 'location:unknown';
    if (!pools.has(poolId)) {
      pools.set(poolId, buildEmptyRow(descriptor, months));
    }

    const pool = pools.get(poolId);
    pool.customerName = pool.customerName || descriptor.customerName;
    pool.serviceLocation = pool.serviceLocation || descriptor.serviceLocation;
    pool.pool = pool.pool || descriptor.pool;
    pool.poolType = pool.poolType || descriptor.poolType;
    return pool;
  };

  const addToMonth = (descriptor, monthIndex, key, amountCents) => {
    const amount = Math.round(Number(amountCents || 0));
    if (monthIndex < 0 || monthIndex >= months.length || !amount) return;
    const pool = ensurePool(descriptor);
    pool.monthly[monthIndex][key] += amount;
  };

  const addVisit = (descriptor, monthIndex) => {
    if (monthIndex < 0 || monthIndex >= months.length) return;
    const pool = ensurePool(descriptor);
    pool.monthly[monthIndex].visits += 1;
    pool.visits += 1;
  };

  const distributeAmount = (descriptors, monthIndex, key, amountCents) => {
    const targets = uniqueDescriptors(descriptors);
    if (!targets.length || !amountCents) return;
    const share = Math.round(Number(amountCents || 0) / targets.length);
    targets.forEach((descriptor) => addToMonth(descriptor, monthIndex, key, share));
  };

  const descriptorsForServiceStop = (serviceStop = {}, fallback = {}) => {
    if (fallback.bodyOfWaterId || serviceStop.bodyOfWaterId) {
      return [
        poolDescriptor({
          bodyOfWaterId: fallback.bodyOfWaterId || serviceStop.bodyOfWaterId,
          serviceLocationId: fallback.serviceLocationId || serviceStop.serviceLocationId,
          customerId: fallback.customerId || serviceStop.customerId,
          customerName: fallback.customerName || serviceStop.customerName,
        }),
      ];
    }

    const stopRecords = stopDataByServiceStopId.get(String(serviceStop.id || serviceStop.serviceStopId || fallback.serviceStopId || '')) || [];
    if (stopRecords.length) {
      return uniqueDescriptors(
        stopRecords.map((record) =>
          poolDescriptor({
            bodyOfWaterId: record.bodyOfWaterId,
            serviceLocationId: record.serviceLocationId || serviceStop.serviceLocationId,
            customerId: record.customerId || serviceStop.customerId,
            customerName: record.customerName || serviceStop.customerName,
          })
        )
      );
    }

    const serviceLocationId = fallback.serviceLocationId || serviceStop.serviceLocationId;
    if (serviceLocationId) {
      return poolDescriptorsForLocation(serviceLocationId, {
        customerId: fallback.customerId || serviceStop.customerId,
        customerName: fallback.customerName || serviceStop.customerName,
      });
    }

    return [
      poolDescriptor({
        customerId: fallback.customerId || serviceStop.customerId,
        customerName: fallback.customerName || serviceStop.customerName,
      }),
    ];
  };

  const companyUserForServiceStop = (serviceStop = {}) => {
    const workerId = String(firstPresent(
      serviceStop.techId,
      serviceStop.userId,
      serviceStop.technicianId,
      serviceStop.workerId,
      serviceStop.companyUserId,
      serviceStop.assignedUserId,
      serviceStop.assignedToId
    ) || '').trim();

    if (!workerId) return null;

    return (
      companyUsers.find((user) =>
        [user.userId, user.id, user.docId, user.uid, user.companyUserId].some((value) => String(value || '').trim() === workerId)
      ) || {
        id: workerId,
        userId: workerId,
        userName: workerDisplayName(serviceStop, 'Technician'),
      }
    );
  };

  const serviceStopTypeFor = (serviceStop = {}) => {
    const typeId = String(firstPresent(
      serviceStop.typeId,
      serviceStop.serviceStopTypeId,
      serviceStop.companyServiceStopTypeId,
      typeof serviceStop.serviceStopType === 'string' ? serviceStop.serviceStopType : ''
    ) || '').trim();
    const typeName = keyValue(firstPresent(
      serviceStop.type,
      serviceStop.serviceStopTypeName,
      typeof serviceStop.serviceStopType === 'string' ? serviceStop.serviceStopType : ''
    ));

    if (typeId && serviceStopTypesById.has(typeId)) return serviceStopTypesById.get(typeId);
    if (typeName && serviceStopTypesByName.has(typeName)) return serviceStopTypesByName.get(typeName);

    if (!typeId && !typeName) return null;

    return {
      id: typeId || typeName,
      name: serviceStop.type || serviceStop.serviceStopTypeName || 'Service Stop',
      defaultWorkTypeIds: serviceStop.defaultWorkTypeIds || serviceStop.serviceStopDefaultWorkTypeIds || [],
      category: serviceStop.category || serviceStop.serviceStopCategory || '',
      serviceStopTypeUseCaseRawValue: serviceStop.serviceStopTypeUseCaseRawValue || '',
    };
  };

  const tasksForServiceStop = (serviceStop = {}) => {
    const stopId = String(firstPresent(serviceStop.id, serviceStop.serviceStopId) || '').trim();
    const tasks = [
      ...(serviceStopTasksById instanceof Map ? serviceStopTasksById.get(stopId) || [] : serviceStopTasksById?.[stopId] || []),
      ...(Array.isArray(serviceStop.tasks) ? serviceStop.tasks : []),
    ];
    if (tasks.length) return tasks;

    const estimatedMinutes = Number(firstPresent(serviceStop.duration, serviceStop.estimatedDuration, serviceStop.estimatedMinutes));
    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return [];

    return [{
      id: `${stopId || 'stop'}_duration_estimate`,
      name: 'Duration estimate',
      type: '__report_duration_estimate__',
      estimatedTime: estimatedMinutes,
      contractedRate: 0,
    }];
  };

  serviceAgreements.forEach((agreement) => {
    const locationIds = agreementServiceLocationIds(agreement);
    const descriptors = locationIds.length
      ? locationIds.flatMap((serviceLocationId) =>
        poolDescriptorsForLocation(serviceLocationId, {
          customerId: agreement.customerId,
          customerName: agreement.customerName,
        })
      )
      : fallbackPoolDescriptorsForCustomer(agreement.customerId, agreement.customerName);

    uniqueDescriptors(descriptors).forEach((descriptor) => {
      const pool = ensurePool(descriptor);
      pool.agreementIds.add(agreement.id);
      pool.historyGroupIds.add(agreementHistoryGroupId(agreement));
      pool.agreements.push(agreement);
    });

    months.forEach((month) => {
      const revenueCents = agreementRevenueCentsForRange(agreement, month.start, month.end);
      if (!revenueCents) return;
      distributeAmount(descriptors, month.index, 'revenueCents', revenueCents);
    });
  });

  stopData.forEach((stop, index) => {
    const serviceStop = serviceStopsById.get(String(stop.serviceStopId || '')) || {};
    const descriptor = poolDescriptor({
      bodyOfWaterId: stop.bodyOfWaterId || serviceStop.bodyOfWaterId,
      serviceLocationId: stop.serviceLocationId || serviceStop.serviceLocationId,
      customerId: stop.customerId || serviceStop.customerId,
      customerName: stop.customerName || serviceStop.customerName,
    });
    const pool = ensurePool(descriptor);
    const monthIndex = monthIndexForDate(stop.date || serviceStop.serviceDate || serviceStop.date, months);
    addVisit(descriptor, monthIndex);

    const waterLevels = extractWaterLevels(stop);
    const waterDate = dateFromValue(stop.date)?.getTime() || index;
    if (waterLevels && waterDate >= pool.latestWaterLevelTime) {
      pool.waterLevels = waterLevels;
      pool.latestWaterLevelTime = waterDate;
    }

    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    dosages.forEach((dosage) => {
      const template = dosageTemplateFor(dosage, dosageTemplatesById) || {};
      const costRecord = {
        ...dosage,
        isChemicalCostRecord: true,
        customerId: stop.customerId || serviceStop.customerId,
        customerName: stop.customerName || serviceStop.customerName,
        serviceLocationId: stop.serviceLocationId || serviceStop.serviceLocationId,
        bodyOfWaterId: stop.bodyOfWaterId || serviceStop.bodyOfWaterId,
        date: stop.date || serviceStop.serviceDate || serviceStop.date,
      };
      const costAgreement = agreementForPnlCost(serviceAgreements, costRecord, costRecord.date);
      const billing = costAgreement
        ? classifyAgreementChemicalBilling({ agreement: costAgreement, record: costRecord, linkedRecord: template })
        : null;

      if (billing?.billSeparately) {
        const chemicalRevenueCents = dosageChemicalRevenueCents(dosage, template);
        addToMonth(descriptor, monthIndex, 'chemicalRevenueCents', chemicalRevenueCents);
      }

      if (shouldExcludePnlChemicalCost({ agreement: costAgreement, record: costRecord, linkedRecord: template })) return;

      const costEstimate = dosageChemicalCostEstimate({
        dosage,
        template,
        purchases,
        databaseItemById,
      });

      addToMonth(descriptor, monthIndex, 'chemicalCents', costEstimate.totalCostCents);
    });
  });

  const activePayrollLines = payrollLines.filter((line) => reportStatusKey(line.calculationStatus) !== 'voided' && !line.voidedAt);
  activePayrollLines.forEach((line) => {
    const amountCents = payrollLineCents(line);
    if (!amountCents) return;

    const lineServiceStopId = String(firstPresent(line.serviceStopId, line.serviceStopID, line.stopId) || '').trim();
    const serviceStop = serviceStopsById.get(lineServiceStopId) || {};
    if (lineServiceStopId) actualPayServiceStopIds.add(lineServiceStopId);

    const descriptors = descriptorsForServiceStop(serviceStop, {
      serviceStopId: lineServiceStopId,
      bodyOfWaterId: line.bodyOfWaterId,
      serviceLocationId: line.serviceLocationId,
      customerId: line.customerId,
      customerName: line.customerName,
    });
    const monthIndex = monthIndexForDate(firstPresent(line.completedDate, line.paidAt, line.createdAt), months);
    distributeAmount(descriptors, monthIndex, 'laborCents', amountCents);
  });

  serviceStops.forEach((serviceStop) => {
    const serviceStopId = String(serviceStop.id || serviceStop.serviceStopId || '');
    if (!serviceStopId || actualPayServiceStopIds.has(serviceStopId)) return;
    const monthIndex = monthIndexForDate(firstPresent(serviceStop.completedDate, serviceStop.serviceDate, serviceStop.date, serviceStop.createdAt), months);
    if (monthIndex < 0) return;

    const estimatedPay = estimateServiceStopPaySummary({
      companyId,
      settings: paySettings,
      serviceStop,
      serviceStopType: serviceStopTypeFor(serviceStop),
      serviceStopUseCaseSourceId: serviceStopUseCaseSourceId(serviceStop),
      tasks: tasksForServiceStop(serviceStop),
      worker: companyUserForServiceStop(serviceStop),
      workTypes: companyWorkTypes,
      mappings: workTypeMappings,
      rates: technicianRates,
      date: dateFromValue(firstPresent(serviceStop.completedDate, serviceStop.serviceDate, serviceStop.date, serviceStop.createdAt)) || new Date(),
    });
    const laborCents = estimatedPay.lines.reduce((total, line) => total + cents(line.totalAmountCents), 0);
    if (!laborCents) return;

    distributeAmount(descriptorsForServiceStop(serviceStop), monthIndex, 'laborCents', laborCents);
  });

  const historyByGroupId = serviceAgreements.reduce((map, agreement) => {
    const groupId = agreementHistoryGroupId(agreement);
    if (!groupId) return map;
    if (!map.has(groupId)) map.set(groupId, []);
    map.get(groupId).push(agreement);
    return map;
  }, new Map());

  const rows = [...pools.values()].map((pool) => {
    const history = sortAgreementHistory(
      [...pool.historyGroupIds]
        .flatMap((groupId) => historyByGroupId.get(groupId) || [])
        .filter((agreement, index, list) => list.findIndex((item) => item.id === agreement.id) === index)
    );
    const currentAgreement = [...history]
      .filter((agreement) => !isInactiveAgreementStatus(agreement.status))
      .sort((left, right) => (
        (historySortValue(right) - historySortValue(left)) ||
        Number(right.agreementVersion || 1) - Number(left.agreementVersion || 1)
      ))[0] || history[history.length - 1] || pool.agreements[0] || null;

    const finalizedMonths = pool.monthly.map((metric, index) => {
      const revenueCents = metric.revenueCents + metric.chemicalRevenueCents;
      const directCostCents = metric.laborCents + metric.chemicalCents;
      return {
        ...metric,
        index,
        key: months[index].key,
        label: months[index].label,
        longLabel: months[index].longLabel,
        calendarMonthIndex: months[index].calendarMonthIndex,
        year: months[index].year,
        start: months[index].start,
        end: months[index].end,
        revenueCents,
        directCostCents,
        netCents: revenueCents - directCostCents,
      };
    });
    const netValues = finalizedMonths.map((month) => month.netCents);
    const summerValues = finalizedMonths
      .filter((month) => [4, 5, 6, 7, 8, 9].includes(month.calendarMonthIndex))
      .map((month) => month.netCents);
    const winterValues = finalizedMonths
      .filter((month) => [10, 11, 0, 1, 2, 3].includes(month.calendarMonthIndex))
      .map((month) => month.netCents);
    const revenueCents = finalizedMonths.reduce((total, month) => total + month.revenueCents, 0);
    const laborCents = finalizedMonths.reduce((total, month) => total + month.laborCents, 0);
    const chemicalCents = finalizedMonths.reduce((total, month) => total + month.chemicalCents, 0);
    const directCostCents = laborCents + chemicalCents;
    const netCents = revenueCents - directCostCents;
    const activeMonthCount = Math.max(finalizedMonths.filter((month) => (
      month.revenueCents || month.directCostCents || month.visits
    )).length, 1);
    const avgMonthlyCostCents = Math.round(directCostCents / activeMonthCount);
    const historySummary = getAgreementHistorySummary(history);
    const latestMonth = latestNonZeroMonth(finalizedMonths);
    const notes = noteTextForAgreement(currentAgreement || {});

    return {
      ...pool,
      agreementIds: [...pool.agreementIds],
      historyGroupIds: [...pool.historyGroupIds],
      history,
      historySummary,
      currentAgreement,
      currentAgreementId: currentAgreement?.id || '',
      currentAgreementTitle: currentAgreement?.title || '',
      status: currentAgreement?.status || '',
      currentRateCents: agreementAmountCents(currentAgreement || {}),
      startDate: agreementEffectiveDate(history[0] || currentAgreement || {}),
      lastRaisedAt: getAgreementLastRaisedAt(history),
      raiseHistory: historySummary
        .map((item) => {
          const date = item.effectiveDate ? item.effectiveDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : 'No date';
          const delta = item.amountDeltaCents > 0 ? ` (+${moneyFromCents(item.amountDeltaCents)})` : item.amountDeltaCents < 0 ? ` (${moneyFromCents(item.amountDeltaCents)})` : '';
          return `${date}: ${moneyFromCents(item.amountCents)}${delta}`;
        })
        .join(' | '),
      notes,
      monthly: finalizedMonths,
      annualAverageCents: averageNonZero(netValues),
      summerAverageCents: averageNonZero(summerValues),
      winterAverageCents: averageNonZero(winterValues),
      latestMonthNetCents: latestMonth?.netCents || 0,
      latestMonthLabel: latestMonth?.label || '',
      revenueCents,
      laborCents,
      chemicalCents,
      directCostCents,
      netCents,
      marginPercent: marginPercent(netCents, revenueCents),
      targetRateCents: targetRateCentsFor(avgMonthlyCostCents),
      averageMonthlyCostCents: avgMonthlyCostCents,
    };
  }).sort((left, right) => (
    left.annualAverageCents - right.annualAverageCents ||
    left.customerName.localeCompare(right.customerName) ||
    left.pool.localeCompare(right.pool)
  ));

  const totals = rows.reduce((result, row) => {
    result.revenueCents += row.revenueCents;
    result.directCostCents += row.directCostCents;
    result.laborCents += row.laborCents;
    result.chemicalCents += row.chemicalCents;
    result.netCents += row.netCents;
    result.visits += row.visits;
    result.currentRateCents += row.currentRateCents;
    row.monthly.forEach((month, index) => {
      result.monthly[index].revenueCents += month.revenueCents;
      result.monthly[index].directCostCents += month.directCostCents;
      result.monthly[index].netCents += month.netCents;
    });
    return result;
  }, {
    revenueCents: 0,
    directCostCents: 0,
    laborCents: 0,
    chemicalCents: 0,
    netCents: 0,
    visits: 0,
    currentRateCents: 0,
    monthly: months.map(() => ({ revenueCents: 0, directCostCents: 0, netCents: 0 })),
  });

  return { months, rows, totals };
};
