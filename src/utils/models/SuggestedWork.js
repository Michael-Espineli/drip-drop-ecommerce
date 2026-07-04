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
    label: "Must Fix",
    shortLabel: "Must Fix",
    description: "Necessary work that should not sit for long.",
    tone: "red",
  },
  {
    value: SUGGESTED_WORK_TIER.GOOD,
    label: "Good",
    shortLabel: "Good",
    description: "Baseline option that solves the issue.",
    tone: "amber",
  },
  {
    value: SUGGESTED_WORK_TIER.BETTER,
    label: "Better",
    shortLabel: "Better",
    description: "More durable option with stronger value.",
    tone: "blue",
  },
  {
    value: SUGGESTED_WORK_TIER.BEST,
    label: "Best",
    shortLabel: "Best",
    description: "Most complete version of the work.",
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

export const suggestedWorkIdForSource = (sourceType, sourceId) => {
  const cleanSourceType = String(sourceType || "manual").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanSourceId = String(sourceId || "").replace(/[^a-zA-Z0-9_-]/g, "_");

  return cleanSourceId
    ? `comp_suggested_work_${cleanSourceType}_${cleanSourceId}`
    : "";
};
