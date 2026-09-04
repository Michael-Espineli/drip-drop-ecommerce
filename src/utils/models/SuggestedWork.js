export const SUGGESTED_WORK_TIER = {
  MUST_FIX: 1,
  GOOD: 2,
  BETTER: 3,
  BEST: 4,
};

export const DEFAULT_SUGGESTED_WORK_TIER = SUGGESTED_WORK_TIER.GOOD;

export const SUGGESTED_WORK_TIER_OPTIONS = [
  {
    value: SUGGESTED_WORK_TIER.MUST_FIX,
    label: "Critical",
    shortLabel: "Critical",
    description: "Necessary work that should not sit for long.",
    tone: "red",
  },
  {
    value: SUGGESTED_WORK_TIER.GOOD,
    label: "Recommended",
    shortLabel: "Recommended",
    description: "Recommended work that should be planned before it becomes urgent.",
    tone: "amber",
  },
  {
    value: SUGGESTED_WORK_TIER.BETTER,
    label: "Preventive",
    shortLabel: "Preventive",
    description: "Preventive work that protects the equipment or pool condition.",
    tone: "blue",
  },
  {
    value: SUGGESTED_WORK_TIER.BEST,
    label: "Optional Upgrade",
    shortLabel: "Upgrade",
    description: "Optional improvement or upgrade work.",
    tone: "emerald",
  },
];

export const SUGGESTED_WORK_STATUS = {
  OPEN: "Open",
  DEFERRED: "Deferred",
  CONVERTED_TO_JOB: "Converted To Job",
  COMPLETED: "Completed",
  DECLINED: "Declined",
};

export const SUGGESTED_WORK_STATUS_OPTIONS = [
  SUGGESTED_WORK_STATUS.OPEN,
  SUGGESTED_WORK_STATUS.DEFERRED,
  SUGGESTED_WORK_STATUS.CONVERTED_TO_JOB,
  SUGGESTED_WORK_STATUS.COMPLETED,
  SUGGESTED_WORK_STATUS.DECLINED,
];

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeSuggestedWorkTier = (
  value,
  fallback = DEFAULT_SUGGESTED_WORK_TIER
) => {
  const parsed = normalizeNumber(value);
  return SUGGESTED_WORK_TIER_OPTIONS.some((option) => option.value === parsed)
    ? parsed
    : fallback;
};

export const getSuggestedWorkTierOption = (value) => {
  const tier = normalizeSuggestedWorkTier(value);
  return (
    SUGGESTED_WORK_TIER_OPTIONS.find((option) => option.value === tier) ||
    SUGGESTED_WORK_TIER_OPTIONS[1]
  );
};

export const getSuggestedWorkTierLabel = (value) =>
  getSuggestedWorkTierOption(value).label;

export const getSuggestedWorkTierTone = (value) =>
  getSuggestedWorkTierOption(value).tone;

export const normalizeSuggestedWorkStatus = (status) =>
  String(status || SUGGESTED_WORK_STATUS.OPEN).trim().toLowerCase();

export const isOpenSuggestedWorkStatus = (status) =>
  !["converted to job", "completed", "declined", "closed", "done"].includes(
    normalizeSuggestedWorkStatus(status)
  );

const normalizeRecordKey = (value) =>
  String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase();

const SUGGESTED_WORK_SOURCE_TYPES = new Set([
  "manual",
  "repairrequest",
  "repairrequestcomment",
  "workoffer",
  "offeredwork",
]);

export const suggestedWorkStatusValue = (work = {}) =>
  work?.status || work?.suggestionStatus || SUGGESTED_WORK_STATUS.OPEN;

export const isSuggestedWorkRecord = (work = {}) => {
  if (!work || typeof work !== "object" || Array.isArray(work)) return false;

  const id = String(work.id || work.suggestedWorkId || work.sourceSuggestedWorkId || "");
  if (id.startsWith("comp_suggested_work")) return true;

  const hasExplicitSuggestedWorkMarker = Boolean(
    work.suggestionStatus ||
    work.suggestedWorkPriorityLevel ||
    work.suggestedWorkPriorityLabel ||
    work.estimatedPriceCents !== undefined ||
    work.convertedToJobId ||
    work.convertedToJobInternalId
  );
  const looksLikeStandaloneWorkRecord = Boolean(
    work.operationStatus ||
    work.billingStatus ||
    work.internalId ||
    work.serviceDate ||
    work.scheduledDate ||
    work.techId ||
    work.serviceStopTypeId
  );
  if (looksLikeStandaloneWorkRecord && !hasExplicitSuggestedWorkMarker) return false;

  const sourceType = normalizeRecordKey(work.sourceType || work.sourceRecordType);
  if (SUGGESTED_WORK_SOURCE_TYPES.has(sourceType) && (work.title || work.description || work.note || work.customerId)) {
    return true;
  }

  const sourcePath = normalizeRecordKey(work.sourcePath);
  const sourceCollection = normalizeRecordKey(work.sourceCollection);
  if (sourcePath.includes("suggestedwork") || sourceCollection.includes("suggestedwork")) return true;

  return Boolean(
    hasExplicitSuggestedWorkMarker ||
    work.priorityLabel ||
    work.solutionTierLabel
  );
};

export const isCurrentSuggestedWorkRecord = (work = {}) =>
  isSuggestedWorkRecord(work) && isOpenSuggestedWorkStatus(suggestedWorkStatusValue(work));

export const suggestedWorkIdForSource = (sourceType, sourceId) => {
  const cleanSourceType = String(sourceType || "manual").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanSourceId = String(sourceId || "").replace(/[^a-zA-Z0-9_-]/g, "_");

  return cleanSourceId
    ? `comp_suggested_work_${cleanSourceType}_${cleanSourceId}`
    : "";
};
