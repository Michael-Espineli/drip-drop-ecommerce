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

const cents = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
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

export const isOpenWorkOffer = (offer = {}) =>
  OPEN_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(offer.status));

export const isAcceptedWorkOffer = (offer = {}) =>
  ACCEPTED_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(offer.status));

export const isAcceptedReadyToScheduleWorkOffer = (offer = {}) =>
  isAcceptedWorkOffer(offer) && !(offer.serviceStopId || offer.scheduledServiceStopId);

export const isScheduledWorkOffer = (offer = {}) =>
  SCHEDULED_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(offer.status)) ||
  Boolean(offer.serviceStopId || offer.scheduledServiceStopId);

export const isFinalWorkOffer = (offer = {}) =>
  FINAL_WORK_OFFER_STATUSES.has(normalizedWorkOfferStatusKey(offer.status));

export const getWorkOfferTaskCount = (offer = {}) => {
  if (Array.isArray(offer.jobTaskIds)) return offer.jobTaskIds.length;
  if (Array.isArray(offer.taskIds)) return offer.taskIds.length;
  if (Array.isArray(offer.tasks)) return offer.tasks.length;
  if (Array.isArray(offer.serviceStopTaskIds)) return offer.serviceStopTaskIds.length;
  return 0;
};

export const getWorkOfferTargetText = (offer = {}) => {
  if (offer.offeredToUserName) return offer.offeredToUserName;
  if (offer.acceptedByUserName) return offer.acceptedByUserName;
  if (offer.receiverName) return offer.receiverName;
  if (offer.workerName) return offer.workerName;
  if (offer.companyUserName) return offer.companyUserName;
  if (offer.externalCompanyName) return offer.externalCompanyName;
  if (offer.boardName) return offer.boardName;
  if (
    offer.postedToBoard ||
    offer.isBoardPost ||
    BOARD_WORK_OFFER_TYPES.has(normalizeWorkOfferTypeKey(offer.offerType))
  ) {
    return "Internal Board";
  }
  return "Unassigned";
};

export const getWorkOfferTypeText = (offer = {}) => {
  const offerType = normalizeWorkOfferTypeKey(offer.offerType);
  if (offerType === "direct user" || offerType === "direct") return "Direct User";
  if (offerType === "internal board" || offerType === "board") return "Internal Board";
  if (offerType === "external company" || offerType === "external") return "External Company";
  if (offer.postedToBoard || offer.isBoardPost) return "Internal Board";
  if (offer.externalCompanyId || offer.externalCompanyName) return "External Company";
  return "Direct User";
};

export const getWorkOfferEstimatedPayCents = (offer = {}) => {
  const explicitTotal =
    offer.estimatedPayWithIncentiveCents ??
    offer.totalPayWithIncentiveCents;

  if (explicitTotal !== undefined && explicitTotal !== null) {
    return cents(explicitTotal);
  }

  return getWorkOfferBasePayCents(offer) + getWorkOfferIncentiveCents(offer);
};

export const getWorkOfferBasePayCents = (offer = {}) => {
  const value =
    offer.estimatedBasePayCents ??
    offer.basePayCents ??
    offer.estimatedPayCents ??
    offer.estimatedPayTotalCents ??
    offer.estimatedLaborCents ??
    offer.payEstimateCents ??
    offer.totalEstimatedPayCents ??
    offer.offeredAmountCents ??
    offer.rate ??
    0;
  return cents(value);
};

export const normalizeWorkOfferIncentive = (offer = {}) => {
  const incentive = offer.incentive && typeof offer.incentive === "object"
    ? offer.incentive
    : {};
  const type = normalizeIncentiveTypeKey(incentive.type || offer.incentiveType || "none");
  const normalizedType =
    type === "flat" || type === "flat rate"
      ? "flat"
      : type === "percentage" || type === "percentage bump"
        ? "percentage"
        : "none";
  const amountCents = Math.max(0, cents(
    incentive.amountCents ??
    offer.incentiveAmountCents ??
    offer.flatIncentiveCents ??
    0
  ));
  const percentage = Math.max(0, Number(
    incentive.percentage ??
    offer.incentivePercentage ??
    offer.percentageIncentive ??
    0
  ) || 0);
  const notes = String(incentive.notes || offer.incentiveNotes || "").trim();

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
  const incentive = normalizeWorkOfferIncentive(offer);

  if (incentive.type === "flat") return incentive.amountCents;
  if (incentive.type === "percentage") {
    return Math.round(getWorkOfferBasePayCents(offer) * (incentive.percentage / 100));
  }

  return 0;
};

export const getWorkOfferIncentiveText = (offer = {}) => {
  const incentive = normalizeWorkOfferIncentive(offer);
  const incentiveCents = getWorkOfferIncentiveCents(offer);

  if (incentive.type === "flat") {
    return incentiveCents > 0 ? `Flat ${moneyFromCents(incentiveCents)}` : "Flat incentive";
  }

  if (incentive.type === "percentage") {
    return incentive.percentage > 0 ? `${incentive.percentage}% bump` : "Percentage bump";
  }

  return "No incentive";
};

export const getWorkOfferCategoryText = (offer = {}) => {
  switch (offer.workOfferCategory || offer.workCategory || offer.sourceType) {
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

export const getWorkOfferCanSelfSchedule = (offer = {}) =>
  Boolean(
    offer.canTechnicianSchedule ||
    offer.allowsTechnicianSelfScheduling ||
    offer.allowTechnicianScheduling ||
    offer.technicianCanSchedule
  );

export const workOfferMatchesStatusFilter = (offer = {}, filter = "open") => {
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

export const buildWorkOfferSearchText = (offer = {}) =>
  [
    offer.id,
    offer.title,
    offer.name,
    offer.description,
    offer.notes,
    offer.adminNotes,
    offer.workerNotes,
    offer.jobInternalId,
    offer.jobName,
    offer.customerName,
    offer.serviceLocationName,
    offer.serviceStopTypeName,
    offer.companyServiceStopTypeName,
    offer.routeName,
    offer.routeTechName,
    offer.boardName,
    Array.isArray(offer.boardNames) ? offer.boardNames.join(" ") : "",
    getWorkOfferCategoryText(offer),
    getWorkOfferIncentiveText(offer),
    offer.status,
    getWorkOfferTargetText(offer),
    getWorkOfferTypeText(offer),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
