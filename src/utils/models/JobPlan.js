export const ISSUE_PRIORITY = {
  CRITICAL: 1,
  RECOMMENDED: 2,
  PREVENTIVE: 3,
  OPTIONAL_UPGRADE: 4,
};

export const DEFAULT_ISSUE_PRIORITY = ISSUE_PRIORITY.RECOMMENDED;

export const ISSUE_PRIORITY_OPTIONS = [
  {
    value: ISSUE_PRIORITY.CRITICAL,
    label: "Critical",
    shortLabel: "Critical",
    description: "Necessary work that should not sit for long.",
    tone: "red",
  },
  {
    value: ISSUE_PRIORITY.RECOMMENDED,
    label: "Recommended",
    shortLabel: "Recommended",
    description: "Recommended work that should be planned before it becomes urgent.",
    tone: "amber",
  },
  {
    value: ISSUE_PRIORITY.PREVENTIVE,
    label: "Preventive",
    shortLabel: "Preventive",
    description: "Preventive work that protects the equipment or pool condition.",
    tone: "blue",
  },
  {
    value: ISSUE_PRIORITY.OPTIONAL_UPGRADE,
    label: "Optional Upgrade",
    shortLabel: "Upgrade",
    description: "Optional improvement or upgrade work.",
    tone: "emerald",
  },
];

export const JOB_PLAN_TIER = {
  MINIMUM_REPAIR: 1,
  STANDARD_FIX: 2,
  BETTER_FIX: 3,
  BEST_UPGRADE: 4,
};

export const DEFAULT_JOB_PLAN_TIER = JOB_PLAN_TIER.STANDARD_FIX;

export const JOB_PLAN_TIER_OPTIONS = [
  {
    value: JOB_PLAN_TIER.MINIMUM_REPAIR,
    label: "Minimum Repair",
    shortLabel: "Minimum",
    description: "The smallest practical repair plan that addresses the issue.",
    tone: "red",
  },
  {
    value: JOB_PLAN_TIER.STANDARD_FIX,
    label: "Standard Fix",
    shortLabel: "Standard",
    description: "The normal recommended plan for the issue.",
    tone: "amber",
  },
  {
    value: JOB_PLAN_TIER.BETTER_FIX,
    label: "Better Fix",
    shortLabel: "Better",
    description: "A stronger or longer-lasting plan.",
    tone: "blue",
  },
  {
    value: JOB_PLAN_TIER.BEST_UPGRADE,
    label: "Best Upgrade",
    shortLabel: "Best",
    description: "The most complete plan or upgrade.",
    tone: "emerald",
  },
];

export const JOB_PLAN_STATUS = {
  DRAFT: "Draft",
  PRESENTED: "Presented",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  SUPERSEDED: "Superseded",
  ARCHIVED: "Archived",
};

export const JOB_PLAN_STATUS_OPTIONS = [
  JOB_PLAN_STATUS.DRAFT,
  JOB_PLAN_STATUS.PRESENTED,
  JOB_PLAN_STATUS.ACCEPTED,
  JOB_PLAN_STATUS.DECLINED,
  JOB_PLAN_STATUS.SUPERSEDED,
  JOB_PLAN_STATUS.ARCHIVED,
];

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeOption = (options, value, fallback) => {
  const parsed = normalizeNumber(value);
  return options.some((option) => option.value === parsed) ? parsed : fallback;
};

const optionForValue = (options, value, fallback) => {
  const normalized = normalizeOption(options, value, fallback);
  return options.find((option) => option.value === normalized) || options[0];
};

export const normalizeIssuePriority = (value, fallback = DEFAULT_ISSUE_PRIORITY) =>
  normalizeOption(ISSUE_PRIORITY_OPTIONS, value, fallback);

export const getIssuePriorityOption = (value) =>
  optionForValue(ISSUE_PRIORITY_OPTIONS, value, DEFAULT_ISSUE_PRIORITY);

export const getIssuePriorityLabel = (value) => getIssuePriorityOption(value).label;

export const getIssuePriorityTone = (value) => getIssuePriorityOption(value).tone;

export const normalizeJobPlanTier = (
  value,
  fallback = DEFAULT_JOB_PLAN_TIER
) => normalizeOption(JOB_PLAN_TIER_OPTIONS, value, fallback);

export const getJobPlanTierOption = (value) =>
  optionForValue(JOB_PLAN_TIER_OPTIONS, value, DEFAULT_JOB_PLAN_TIER);

export const getJobPlanTierLabel = (value) =>
  getJobPlanTierOption(value).label;

export const getJobPlanTierTone = (value) =>
  getJobPlanTierOption(value).tone;

export const getJobPlanRecommendationLabel = (value) => {
  const normalized = normalizeJobPlanTier(value);
  switch (normalized) {
    case JOB_PLAN_TIER.MINIMUM_REPAIR:
      return "Most Recommended";
    case JOB_PLAN_TIER.STANDARD_FIX:
      return "Second Recommendation";
    case JOB_PLAN_TIER.BETTER_FIX:
      return "Third Recommendation";
    case JOB_PLAN_TIER.BEST_UPGRADE:
      return "Least Recommended";
    default:
      return "Recommendation";
  }
};

export const getJobPlanRecommendationDisplay = (value) => {
  const normalized = normalizeJobPlanTier(value);
  return `#${normalized} ${getJobPlanRecommendationLabel(normalized)}`;
};

export const isGeneratedJobPlanName = (name, tier = DEFAULT_JOB_PLAN_TIER) => {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!normalizedName) return false;

  const normalizedTier = normalizeJobPlanTier(tier);
  const generatedNames = JOB_PLAN_TIER_OPTIONS.flatMap((option) => {
    const optionTier = normalizeJobPlanTier(option.value);
    const legacyLabel = getJobPlanTierLabel(optionTier);
    const recommendationLabel = getJobPlanRecommendationLabel(optionTier);

    return [
      legacyLabel,
      `${optionTier} - ${legacyLabel}`,
      `#${optionTier} ${recommendationLabel}`,
      `recommendation #${optionTier}`,
      getJobPlanRecommendationDisplay(optionTier),
    ];
  });

  const currentLegacyLabel = getJobPlanTierLabel(normalizedTier);
  generatedNames.push(currentLegacyLabel, `${normalizedTier} - ${currentLegacyLabel}`);

  return generatedNames.some((value) => value.toLowerCase() === normalizedName);
};

export const getJobPlanDisplayName = (plan = {}, fallback = "Untitled Plan") => {
  if (!plan) return fallback;

  const tier = normalizeJobPlanTier(plan.planTier || plan.solutionTier || plan.recommendationRank);
  const candidates = [
    plan.planName,
    plan.title,
    plan.name,
  ];

  const planName = candidates.find((value) => {
    const normalized = String(value || "").trim();
    return normalized && !isGeneratedJobPlanName(normalized, tier);
  });

  return planName ? String(planName).trim() : fallback;
};

export const normalizeJobPlanStatus = (status) => {
  const normalized = String(status || JOB_PLAN_STATUS.DRAFT).trim().toLowerCase();
  const option = JOB_PLAN_STATUS_OPTIONS.find(
    (value) => value.toLowerCase() === normalized
  );

  return option || JOB_PLAN_STATUS.DRAFT;
};

export const jobPlanId = () => {
  const nativeId =
    typeof window !== "undefined" ? window.crypto?.randomUUID?.() : "";

  return `comp_job_plan_${nativeId || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
};

// Backward-compatible aliases for records and code that still call plans "solutions".
export const JOB_SOLUTION_TIER = JOB_PLAN_TIER;
export const DEFAULT_JOB_SOLUTION_TIER = DEFAULT_JOB_PLAN_TIER;
export const JOB_SOLUTION_TIER_OPTIONS = JOB_PLAN_TIER_OPTIONS;
export const JOB_SOLUTION_STATUS = JOB_PLAN_STATUS;
export const JOB_SOLUTION_STATUS_OPTIONS = JOB_PLAN_STATUS_OPTIONS;
export const normalizeJobSolutionTier = normalizeJobPlanTier;
export const getJobSolutionTierOption = getJobPlanTierOption;
export const getJobSolutionTierLabel = getJobPlanTierLabel;
export const getJobSolutionTierTone = getJobPlanTierTone;
export const normalizeJobSolutionStatus = normalizeJobPlanStatus;
export const jobSolutionId = jobPlanId;
