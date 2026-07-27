const OPEN_WORK_OFFER_STATUSES = new Set([
  "draft",
  "sent",
  "posted",
  "viewed",
  "pending",
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
  const value =
    offer.estimatedPayCents ??
    offer.estimatedPayTotalCents ??
    offer.estimatedLaborCents ??
    offer.payEstimateCents ??
    offer.totalEstimatedPayCents ??
    offer.offeredAmountCents ??
    offer.rate ??
    0;
  const cents = Number(value || 0);
  return Number.isFinite(cents) ? cents : 0;
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
    offer.status,
    getWorkOfferTargetText(offer),
    getWorkOfferTypeText(offer),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
