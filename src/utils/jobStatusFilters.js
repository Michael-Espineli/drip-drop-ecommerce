export const JOB_OPERATION_STATUS = {
  draft: "Draft",
  scheduled: "Scheduled",
  finished: "Finished",
};

export const JOB_BILLING_STATUS = {
  draft: "Draft",
  estimate: "Estimate",
  accepted: "Accepted",
  inProgress: "In Progress",
  invoiced: "Invoiced",
  paid: "Paid",
  comped: "Comped",
  expired: "Expired",
  rejected: "Rejected",
};

const FINISHED_BILLING_STATUSES = [
  JOB_BILLING_STATUS.invoiced,
  JOB_BILLING_STATUS.paid,
  JOB_BILLING_STATUS.comped,
];

const getOperationStatus = (job = {}) => job.operationStatus ?? job.status;
const getBillingStatus = (job = {}) => job.billingStatus;

export const normalizeJobStatus = (value) => String(value || "").trim().toLowerCase();

export const jobStatusMatches = (value, status) => (
  normalizeJobStatus(value) === normalizeJobStatus(status)
);

export const isDraftOperationJob = (job = {}) => (
  jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.draft)
);

export const isAcceptedNotScheduledJob = (job = {}) => (
  jobStatusMatches(getBillingStatus(job), JOB_BILLING_STATUS.accepted) &&
  !jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.scheduled)
);

export const isActionableOperationsJob = (job = {}) => (
  isDraftOperationJob(job) || isAcceptedNotScheduledJob(job)
);

export const isFinishedOutstandingJob = (job = {}) => (
  jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.finished) &&
  !FINISHED_BILLING_STATUSES.some((status) => jobStatusMatches(getBillingStatus(job), status))
);
