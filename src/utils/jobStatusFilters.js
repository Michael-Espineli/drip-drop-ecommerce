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

export const normalizeJobStatus = (value) => String(value || "").trim().toLowerCase();

export const jobStatusMatches = (value, status) => (
  normalizeJobStatus(value) === normalizeJobStatus(status)
);

export const isDraftOperationJob = (job = {}) => (
  jobStatusMatches(job.operationStatus, JOB_OPERATION_STATUS.draft)
);

export const isAcceptedNotScheduledJob = (job = {}) => (
  jobStatusMatches(job.billingStatus, JOB_BILLING_STATUS.accepted) &&
  !jobStatusMatches(job.operationStatus, JOB_OPERATION_STATUS.scheduled)
);

export const isActionableOperationsJob = (job = {}) => (
  isDraftOperationJob(job) || isAcceptedNotScheduledJob(job)
);

export const isFinishedOutstandingJob = (job = {}) => (
  jobStatusMatches(job.operationStatus, JOB_OPERATION_STATUS.finished) &&
  !FINISHED_BILLING_STATUSES.some((status) => jobStatusMatches(job.billingStatus, status))
);
