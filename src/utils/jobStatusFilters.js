export const JOB_OPERATION_STATUS = {
  draft: "Draft",
  estimatePending: "Estimate Pending",
  unscheduled: "Unscheduled",
  scheduled: "Scheduled",
  inProgress: "In Progress",
  waitingForParts: "Waiting for Parts",
  finished: "Finished",
  canceled: "Canceled",
};

export const JOB_BILLING_STATUS = {
  draft: "Draft",
  estimate: "Estimate",
  accepted: "Accepted",
  inProgress: "In Progress",
  invoiced: "Invoiced",
  paid: "Paid",
  comped: "Comped",
  customerResolved: "Customer Resolved",
  canceled: "Canceled",
  expired: "Expired",
  rejected: "Rejected",
};

const NON_OUTSTANDING_FINISHED_BILLING_STATUSES = [
  JOB_BILLING_STATUS.invoiced,
  JOB_BILLING_STATUS.paid,
  JOB_BILLING_STATUS.comped,
  JOB_BILLING_STATUS.customerResolved,
  JOB_BILLING_STATUS.canceled,
];

const getOperationStatus = (job = {}) => job.operationStatus ?? job.status;
const getBillingStatus = (job = {}) => job.billingStatus;

export const normalizeJobStatus = (value) => String(value || "").trim().toLowerCase();

export const jobStatusMatches = (value, status) => (
  normalizeJobStatus(value) === normalizeJobStatus(status)
);

export const isCanceledJob = (job = {}) => (
  jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.canceled) ||
  jobStatusMatches(getBillingStatus(job), JOB_BILLING_STATUS.canceled)
);

export const isDraftOperationJob = (job = {}) => (
  !isCanceledJob(job) &&
  (
    jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.draft) ||
    jobStatusMatches(getBillingStatus(job), JOB_BILLING_STATUS.draft)
  )
);

export const isAcceptedNotScheduledJob = (job = {}) => (
  !isCanceledJob(job) &&
  jobStatusMatches(getBillingStatus(job), JOB_BILLING_STATUS.accepted) &&
  jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.unscheduled)
);

export const isActionableOperationsJob = (job = {}) => (
  isDraftOperationJob(job) || isAcceptedNotScheduledJob(job)
);

export const isFinishedOutstandingJob = (job = {}) => (
  !isCanceledJob(job) &&
  jobStatusMatches(getOperationStatus(job), JOB_OPERATION_STATUS.finished) &&
  !NON_OUTSTANDING_FINISHED_BILLING_STATUSES.some((status) => jobStatusMatches(getBillingStatus(job), status))
);
