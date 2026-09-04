const OPEN_WORK_OFFER_STATUSES = new Set([
  "draft",
  "sent",
  "posted",
  "viewed",
  "pending",
  "pending approval",
  "acceptance pending approval",
  "open",
  "offered",
]);

const ACCEPTED_WORK_OFFER_STATUSES = new Set(["accepted"]);
const SCHEDULED_WORK_OFFER_STATUSES = new Set(["scheduled", "in progress", "inprogress", "completed"]);
const FINAL_WORK_OFFER_STATUSES = new Set(["rejected", "cancelled", "canceled", "expired", "completed"]);

const normalizeWorkOfferTypeKey = (value) =>
  String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

const BOARD_WORK_OFFER_TYPES = new Set(["board", "internal board"]);
const DIRECT_WORK_OFFER_TYPES = new Set(["direct", "direct user"]);
const EXTERNAL_WORK_OFFER_TYPES = new Set(["external", "external company"]);
const WORK_OFFER_CATEGORY_KEYS = new Set([
  "full route",
  "partial route",
  "route",
  "route stops",
  "one off job",
  "recurring work",
]);
const WORK_OFFER_SOURCE_KEYS = new Set([
  "full route",
  "partial route",
  "route",
  "route stops",
  "one off job",
  "recurring work",
  "work offer",
  "work offers",
  "offered work",
]);

const cents = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const workOfferOrEmpty = (offer) =>
  offer && typeof offer === "object" ? offer : {};

export const isWorkOfferRecord = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (Object.keys(safeOffer).length === 0) return false;

  const id = String(safeOffer.id || safeOffer.workOfferId || safeOffer.boardPostId || "");
  if (id.startsWith("comp_work_offer")) return true;

  const offerType = normalizeWorkOfferTypeKey(safeOffer.offerType);
  if (
    DIRECT_WORK_OFFER_TYPES.has(offerType) ||
    BOARD_WORK_OFFER_TYPES.has(offerType) ||
    EXTERNAL_WORK_OFFER_TYPES.has(offerType)
  ) {
    return true;
  }

  const category = normalizeWorkOfferTypeKey(safeOffer.workOfferCategory || safeOffer.workCategory);
  if (WORK_OFFER_CATEGORY_KEYS.has(category)) return true;

  const sourceType = normalizeWorkOfferTypeKey(safeOffer.sourceType || safeOffer.sourceRecordType);
  if (WORK_OFFER_SOURCE_KEYS.has(sourceType)) return true;

  return Boolean(
    safeOffer.postedToBoard ||
    safeOffer.isBoardPost ||
    safeOffer.boardId ||
    safeOffer.boardName ||
    (Array.isArray(safeOffer.boardIds) && safeOffer.boardIds.length > 0) ||
    safeOffer.offeredToUserId ||
    safeOffer.offeredToUserName ||
    safeOffer.acceptedByUserId ||
    safeOffer.acceptedByUserName ||
    safeOffer.canTechnicianSchedule ||
    safeOffer.allowsTechnicianSelfScheduling ||
    safeOffer.offeredAmountCents !== undefined ||
    safeOffer.estimatedPayWithIncentiveCents !== undefined
  );
};

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents(value) / 100);

const normalizeIncentiveTypeKey = (value) =>
  String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

export const WORK_OFFER_STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "ready", label: "Ready to Schedule" },
  { value: "accepted", label: "Accepted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "final", label: "Final" },
  { value: "all", label: "All" },
];

export const WORK_OFFER_TYPE_FILTERS = [
  { value: "all", label: "All Types" },
  { value: "direct user", label: "Direct" },
  { value: "internal board", label: "Board" },
  { value: "external company", label: "External" },
];

export const WORK_OFFER_CATEGORY_FILTERS = [
  { value: "all", label: "All Work" },
  { value: "fullRoute", label: "Full Routes" },
  { value: "partialRoute", label: "Partial Routes" },
  { value: "oneOffJob", label: "One-Off Jobs" },
  { value: "recurringWork", label: "Recurring Work" },
];

export const WORK_OFFER_INCENTIVE_TYPES = [
  { value: "none", label: "No Incentive" },
  { value: "flat", label: "Flat Rate" },
  { value: "percentage", label: "Percentage Bump" },
];

export const normalizeWorkOfferStatus = (status) => {
  const text = String(status || "").trim();
  return text || "Pending";
};

export const normalizedWorkOfferStatusKey = (status) =>
  normalizeWorkOfferStatus(status).toLowerCase().replace(/\s+/g, " ");

export const isOpenWorkOffer = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (!isWorkOfferRecord(safeOffer)) return false;
  return OPEN_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(safeOffer.status));
};

export const isAcceptedWorkOffer = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (!isWorkOfferRecord(safeOffer)) return false;
  return ACCEPTED_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(safeOffer.status));
};

export const isAcceptedReadyToScheduleWorkOffer = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  return isAcceptedWorkOffer(safeOffer) && !(safeOffer.serviceStopId || safeOffer.scheduledServiceStopId);
};

export const isScheduledWorkOffer = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (!isWorkOfferRecord(safeOffer)) return false;
  return (
    SCHEDULED_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(safeOffer.status)) ||
    Boolean(safeOffer.serviceStopId || safeOffer.scheduledServiceStopId)
  );
};

export const isFinalWorkOffer = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (!isWorkOfferRecord(safeOffer)) return false;
  return FINAL_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(safeOffer.status));
};

export const getWorkOfferTaskCount = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (Array.isArray(safeOffer.jobTaskIds)) return safeOffer.jobTaskIds.length;
  if (Array.isArray(safeOffer.taskIds)) return safeOffer.taskIds.length;
  if (Array.isArray(safeOffer.tasks)) return safeOffer.tasks.length;
  if (Array.isArray(safeOffer.serviceStopTaskIds)) return safeOffer.serviceStopTaskIds.length;
  return 0;
};

export const getWorkOfferTargetText = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  if (safeOffer.offeredToUserName) return safeOffer.offeredToUserName;
  if (safeOffer.acceptedByUserName) return safeOffer.acceptedByUserName;
  if (safeOffer.receiverName) return safeOffer.receiverName;
  if (safeOffer.workerName) return safeOffer.workerName;
  if (safeOffer.companyUserName) return safeOffer.companyUserName;
  if (safeOffer.externalCompanyName) return safeOffer.externalCompanyName;
  if (safeOffer.boardName) return safeOffer.boardName;
  if (
    safeOffer.postedToBoard ||
    safeOffer.isBoardPost ||
    BOARD_WORK_OFFER_TYPES.has(normalizeWorkOfferTypeKey(safeOffer.offerType))
  ) {
    return "Internal Board";
  }
  return "Unassigned";
};

export const getWorkOfferTypeText = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  const offerType = normalizeWorkOfferTypeKey(safeOffer.offerType);
  if (offerType === "direct user" || offerType === "direct") return "Direct User";
  if (offerType === "internal board" || offerType === "board") return "Internal Board";
  if (offerType === "external company" || offerType === "external") return "External Company";
  if (safeOffer.postedToBoard || safeOffer.isBoardPost) return "Internal Board";
  if (safeOffer.externalCompanyId || safeOffer.externalCompanyName) return "External Company";
  return "Direct User";
};

export const getWorkOfferEstimatedPayCents = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  const explicitTotal =
    safeOffer.estimatedPayWithIncentiveCents ??
    safeOffer.totalPayWithIncentiveCents;

  if (explicitTotal !== undefined && explicitTotal !== null) {
    return cents(explicitTotal);
  }

  return getWorkOfferBasePayCents(safeOffer) + getWorkOfferIncentiveCents(safeOffer);
};

export const getWorkOfferBasePayCents = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  const value =
    safeOffer.estimatedBasePayCents ??
    safeOffer.basePayCents ??
    safeOffer.estimatedPayCents ??
    safeOffer.estimatedPayTotalCents ??
    safeOffer.estimatedLaborCents ??
    safeOffer.payEstimateCents ??
    safeOffer.totalEstimatedPayCents ??
    safeOffer.offeredAmountCents ??
    safeOffer.rate ??
    0;
  return cents(value);
};

export const normalizeWorkOfferIncentive = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  const incentive = safeOffer.incentive && typeof safeOffer.incentive === "object"
    ? safeOffer.incentive
    : {};
  const type = normalizeIncentiveTypeKey(incentive.type || safeOffer.incentiveType || "none");
  const normalizedType =
    type === "flat" || type === "flat rate"
      ? "flat"
      : type === "percentage" || type === "percentage bump"
        ? "percentage"
        : "none";
  const amountCents = Math.max(0, cents(
    incentive.amountCents ??
    safeOffer.incentiveAmountCents ??
    safeOffer.flatIncentiveCents ??
    0
  ));
  const percentage = Math.max(0, Number(
    incentive.percentage ??
    safeOffer.incentivePercentage ??
    safeOffer.percentageIncentive ??
    0
  ) || 0);
  const notes = String(incentive.notes || safeOffer.incentiveNotes || "").trim();

  if (normalizedType === "flat") {
    return {
      type: "flat",
      amountCents,
      percentage: 0,
      notes,
    };
  }

  if (normalizedType === "percentage") {
    return {
      type: "percentage",
      amountCents: 0,
      percentage,
      notes,
    };
  }

  return {
    type: "none",
    amountCents: 0,
    percentage: 0,
    notes: "",
  };
};

export const getWorkOfferIncentiveCents = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  const incentive = normalizeWorkOfferIncentive(safeOffer);

  if (incentive.type === "flat") return incentive.amountCents;
  if (incentive.type === "percentage") {
    return Math.round(getWorkOfferBasePayCents(safeOffer) * (incentive.percentage / 100));
  }

  return 0;
};

export const getWorkOfferIncentiveText = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  const incentive = normalizeWorkOfferIncentive(safeOffer);
  const incentiveCents = getWorkOfferIncentiveCents(safeOffer);

  if (incentive.type === "flat") {
    return incentiveCents > 0 ? `Flat ${moneyFromCents(incentiveCents)}` : "Flat incentive";
  }

  if (incentive.type === "percentage") {
    return incentive.percentage > 0 ? `${incentive.percentage}% bump` : "Percentage bump";
  }

  return "No incentive";
};

export const getWorkOfferCategoryText = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  switch (safeOffer.workOfferCategory || safeOffer.workCategory || safeOffer.sourceType) {
    case "fullRoute":
    case "route":
      return "Full Route";
    case "partialRoute":
    case "routeStops":
      return "Partial Route";
    case "oneOffJob":
    case "job":
      return "One-Off Job";
    case "recurringWork":
      return "Recurring Work";
    default:
      return getWorkOfferTaskCount(offer) > 0 ? "Job Tasks" : "Work";
  }
};

export const getWorkOfferCanSelfSchedule = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  return Boolean(
    safeOffer.canTechnicianSchedule ||
    safeOffer.allowsTechnicianSelfScheduling ||
    safeOffer.allowTechnicianScheduling ||
    safeOffer.technicianCanSchedule
  );
};

export const workOfferMatchesStatusFilter = (offer = {}, filter = "open") => {
  if (!isWorkOfferRecord(offer)) return false;

  switch (filter) {
    case "all":
      return true;
    case "ready":
      return isAcceptedReadyToScheduleWorkOffer(offer);
    case "accepted":
      return isAcceptedWorkOffer(offer);
    case "scheduled":
      return isScheduledWorkOffer(offer);
    case "final":
      return isFinalWorkOffer(offer);
    case "open":
    default:
      return isOpenWorkOffer(offer);
  }
};

export const buildWorkOfferSearchText = (offer = {}) => {
  const safeOffer = workOfferOrEmpty(offer);
  return [
    safeOffer.id,
    safeOffer.title,
    safeOffer.name,
    safeOffer.description,
    safeOffer.notes,
    safeOffer.adminNotes,
    safeOffer.workerNotes,
    safeOffer.jobInternalId,
    safeOffer.jobName,
    safeOffer.customerName,
    safeOffer.serviceLocationName,
    safeOffer.serviceStopTypeName,
    safeOffer.companyServiceStopTypeName,
    safeOffer.routeName,
    safeOffer.routeTechName,
    safeOffer.boardName,
    Array.isArray(safeOffer.boardNames) ? safeOffer.boardNames.join(" ") : "",
    getWorkOfferCategoryText(safeOffer),
    getWorkOfferIncentiveText(safeOffer),
    safeOffer.status,
    getWorkOfferTargetText(safeOffer),
    getWorkOfferTypeText(safeOffer),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};
