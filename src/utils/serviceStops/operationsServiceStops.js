import {
  SERVICE_STOP_TYPE_USE_CASES,
  normalizeServiceStopTypeBucket,
} from "../serviceStopTypes/serviceStopTypeResolver";

const recurringRouteBuckets = new Set([
  SERVICE_STOP_TYPE_USE_CASES.recurringRoute,
  "route",
  "routes",
  "poolroute",
  "standardroute",
  "weeklyroute",
  "residentialroute",
  "recurringroute",
  "recurringroutes",
  "recurringservice",
  "recurringservicestop",
  "systemrecurringservicestop",
].map(normalizeServiceStopTypeBucket));

const operationsActivityBuckets = new Set([
  SERVICE_STOP_TYPE_USE_CASES.jobVisit,
  SERVICE_STOP_TYPE_USE_CASES.jobEstimate,
  SERVICE_STOP_TYPE_USE_CASES.serviceAgreementEstimate,
  SERVICE_STOP_TYPE_USE_CASES.customerRelationship,
  "job",
  "jobvisit",
  "jobestimate",
  "bidvisit",
  "estimate",
  "serviceagreementestimate",
  "serviceestimate",
  "recurringserviceestimate",
  "newserviceestimate",
  "startup",
  "startupservice",
  "newpool",
  "customerrelationship",
  "customervisit",
  "customerservice",
  "followup",
  "courtesyvisit",
  "mistakefix",
  "systemjobservicestop",
  "systemjobestimateservicestop",
  "systemserviceagreementestimateservicestop",
  "systemcustomerrelationshipservicestop",
].map(normalizeServiceStopTypeBucket));

const idValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return String(value.id || value.value || value.docId || "").trim();
  return "";
};

const bucketValuesForStop = (stop = {}) => [
  stop.serviceStopTypeUseCaseRawValue,
  stop.serviceStopUseCaseSourceId,
  stop.serviceStopTypeUseCase,
  stop.typeUseCase,
  stop.category,
  stop.serviceStopCategory,
  stop.serviceStopTypeCategory,
  stop.typeId,
  stop.serviceStopTypeId,
  stop.payTypeId,
  stop.sourceId,
  stop.stopPayCategory,
  stop.stopPayBucketId,
  stop.serviceStopBucketId,
  stop.serviceStopBucket,
  stop.type,
  stop.payTypeName,
  stop.serviceStopType,
  stop.serviceStopTypeName,
].map(normalizeServiceStopTypeBucket).filter(Boolean);

export const serviceStopDateValue = (stop = {}) => (
  stop.serviceDate ||
  stop.scheduledDate ||
  stop.date ||
  stop.startTime ||
  stop.createdAt ||
  stop.dateCreated
);

export const serviceStopDateMillis = (stop = {}) => {
  const value = serviceStopDateValue(stop);
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const serviceStopIsRecurringRoute = (stop = {}) => {
  if (
    idValue(stop.recurringServiceStopId) ||
    idValue(stop.recurringStopId) ||
    idValue(stop.rssId) ||
    idValue(stop.routeId) ||
    idValue(stop.recurringRouteId)
  ) {
    return true;
  }

  return bucketValuesForStop(stop).some((value) => recurringRouteBuckets.has(value));
};

export const serviceStopHasOperationsActivity = (stop = {}) => {
  if (
    idValue(stop.jobId) ||
    idValue(stop.workOrderId) ||
    idValue(stop.leadId) ||
    idValue(stop.serviceAgreementId) ||
    idValue(stop.salesAgreementId) ||
    idValue(stop.agreementId) ||
    idValue(stop.repairRequestId) ||
    idValue(stop.customerServiceId) ||
    idValue(stop.customerRelationshipId)
  ) {
    return true;
  }

  return bucketValuesForStop(stop).some((value) => operationsActivityBuckets.has(value));
};

export const serviceStopIsOperationsActivity = (stop = {}) => (
  !serviceStopIsRecurringRoute(stop) && serviceStopHasOperationsActivity(stop)
);

export const serviceStopActivityLabel = (stop = {}) => {
  const values = bucketValuesForStop(stop);

  if (idValue(stop.jobId) || values.some((value) => ["job", "jobvisit", "systemjobservicestop"].includes(value))) {
    return "Job";
  }

  if (idValue(stop.leadId)) return "Lead";

  if (values.some((value) => ["jobestimate", "estimate", "systemjobestimateservicestop"].includes(value))) {
    return "Job Estimate";
  }

  if (
    idValue(stop.serviceAgreementId) ||
    idValue(stop.salesAgreementId) ||
    idValue(stop.agreementId) ||
    values.some((value) => [
      "serviceagreementestimate",
      "serviceestimate",
      "recurringserviceestimate",
      "newserviceestimate",
      "startup",
      "startupservice",
      "newpool",
      "systemserviceagreementestimateservicestop",
    ].includes(value))
  ) {
    return "Service Agreement";
  }

  if (idValue(stop.repairRequestId)) return "Repair";
  return "Customer Visit";
};

export const compareServiceStopsBySchedule = (left = {}, right = {}) => (
  serviceStopDateMillis(left) - serviceStopDateMillis(right)
);
