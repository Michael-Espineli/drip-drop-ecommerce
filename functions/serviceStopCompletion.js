const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { sendServiceReportOnFinishCore } = require("./sendGrid/general");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const SERVICE_STOP_FINISHED = "Finished";
const ACTIVE_ROUTE_FINISHED = "Finished";
const ACTIVE_ROUTE_IN_PROGRESS = "In Progress";
const ACTIVE_ROUTE_DID_NOT_START = "Did Not Start";
const ACTIVE_ROUTE_TRAVELING = "Traveling";
const ACTIVE_ROUTE_ON_BREAK = "Break";

const SERVICE_STOP_CATEGORIES = {
  route: "Route",
  job: "Job",
  jobEstimate: "Job Estimate",
  serviceAgreementEstimate: "Service Agreement Estimate",
  customerRelationship: "Customer Relationship",
};

const PAYROLL_SOURCE_IDS = {
  recurringServiceStop: "system_recurring_service_stop",
  commercialRoute: "system_recurring_commercial_pay_type",
  jobServiceStop: "system_job_service_stop",
  jobSaltCellCleaning: "system_job_salt_cell_cleaning_pay_type",
  jobEstimateServiceStop: "system_job_estimate_service_stop",
  serviceAgreementEstimateServiceStop: "system_service_agreement_estimate_service_stop",
  customerRelationshipServiceStop: "system_customer_relationship_service_stop",
};

const blankToNull = (value) => {
  const text = cleanString(value);
  return text.length > 0 ? text : null;
};

function cleanString(value) {
  return String(value || "").trim();
}

function normalizedKey(value) {
  return cleanString(value).toLowerCase().replace(/[\s_/-]+/g, "");
}

function numberFrom(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateFromValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === "object" && typeof value._seconds === "number") {
    return new Date(value._seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firestoreTimestamp(value, fallback = new Date()) {
  return Timestamp.fromDate(dateFromValue(value) || fallback);
}

function isFinishedStatus(value) {
  const normalized = normalizedKey(value);
  return normalized === "finished" || normalized === "complete" || normalized === "completed" || normalized === "done";
}

function isFinishedServiceStop(serviceStop = {}) {
  return isFinishedStatus(serviceStop.operationStatus || serviceStop.status);
}

function resolvedServiceStopCategory(serviceStop = {}) {
  const explicit = cleanString(serviceStop.category);
  const explicitKey = normalizedKey(explicit);

  for (const category of Object.values(SERVICE_STOP_CATEGORIES)) {
    if (explicitKey === normalizedKey(category)) {
      return category;
    }
  }

  switch (cleanString(serviceStop.typeId)) {
    case PAYROLL_SOURCE_IDS.recurringServiceStop:
    case PAYROLL_SOURCE_IDS.commercialRoute:
      return SERVICE_STOP_CATEGORIES.route;
    case PAYROLL_SOURCE_IDS.jobServiceStop:
    case PAYROLL_SOURCE_IDS.jobSaltCellCleaning:
      return SERVICE_STOP_CATEGORIES.job;
    case PAYROLL_SOURCE_IDS.jobEstimateServiceStop:
      return SERVICE_STOP_CATEGORIES.jobEstimate;
    case PAYROLL_SOURCE_IDS.serviceAgreementEstimateServiceStop:
      return SERVICE_STOP_CATEGORIES.serviceAgreementEstimate;
    case PAYROLL_SOURCE_IDS.customerRelationshipServiceStop:
      return SERVICE_STOP_CATEGORIES.customerRelationship;
    default:
      break;
  }

  if (cleanString(serviceStop.recurringServiceStopId)) {
    return SERVICE_STOP_CATEGORIES.route;
  }

  if (cleanString(serviceStop.jobId)) {
    return SERVICE_STOP_CATEGORIES.job;
  }

  const searchableText = `${cleanString(serviceStop.type)} ${cleanString(serviceStop.description)}`.toLowerCase();
  if (
    searchableText.includes("service agreement") ||
    searchableText.includes("recurring service estimate") ||
    searchableText.includes("new pool") ||
    searchableText.includes("new service") ||
    searchableText.includes("startup") ||
    searchableText.includes("start up")
  ) {
    return SERVICE_STOP_CATEGORIES.serviceAgreementEstimate;
  }

  if (searchableText.includes("estimate") || searchableText.includes("estiamte")) {
    return SERVICE_STOP_CATEGORIES.jobEstimate;
  }

  return SERVICE_STOP_CATEGORIES.route;
}

function defaultPaySettings(companyId) {
  return {
    companyId,
    payMode: "productionOnly",
    routePaySource: "serviceStopAndCompletedTasks",
    taskPaySource: "technicianRateThenTaskContractedRate",
    hourlyPaySource: "none",
    allowMultipleWorkTypesPerStop: false,
    defaultStackBehavior: "stackable",
    allowTechnicianRateOverrides: true,
    allowManualPayAdjustments: false,
    payCommercialAsSeparateWorkType: false,
    paySpaAsSeparateWorkType: false,
    payPerBodyOfWater: false,
    commercialMultiBodyPayStyle: "singleCommercialRate",
    lockPayAfterApproval: true,
    recalculateUnapprovedPayWhenRatesChange: true,
  };
}

function normalizedPaySettings(companyId, settings = {}) {
  return {
    ...defaultPaySettings(companyId),
    ...settings,
    companyId,
  };
}

function suggestedDefaultRateType(category) {
  switch (cleanString(category)) {
    case "repair":
    case "installation":
    case "cleaning":
    case "drainAndRefill":
    case "extra":
    case "custom":
      return "flatPerTask";
    default:
      return "flatPerStop";
  }
}

function normalizedWorkType(document) {
  const data = document.data() || {};
  const category = cleanString(data.category) || "serviceCall";
  return {
    ...data,
    id: cleanString(data.id) || document.id,
    companyId: cleanString(data.companyId),
    name: cleanString(data.name),
    category,
    isActive: data.isActive !== false && data.active !== false,
    defaultRateType: cleanString(data.defaultRateType) || suggestedDefaultRateType(category),
  };
}

function normalizedRate(document) {
  const data = document.data() || {};
  return {
    ...data,
    id: cleanString(data.id) || document.id,
    companyId: cleanString(data.companyId),
    technicianId: cleanString(data.technicianId),
    payBasis: cleanString(data.payBasis),
    workTypeId: blankToNull(data.payTypeId || data.workTypeId),
    amountCents: numberFrom(data.amountCents),
    rateType: cleanString(data.rateType) || "flatPerStop",
    effectiveStartDate: dateFromValue(data.effectiveStartDate) || new Date(0),
    effectiveEndDate: dateFromValue(data.effectiveEndDate),
    status: cleanString(data.status) || "active",
  };
}

function normalizedCompanyUser(document) {
  const data = document.data() || {};
  return {
    ...data,
    id: cleanString(data.id) || document.id,
    userId: cleanString(data.userId) || document.id,
    userName: cleanString(data.userName),
    status: cleanString(data.status) || "Active",
    workerType: normalizeWorkerType(data.workerType),
  };
}

function normalizedTask(document) {
  const data = document.data() || {};
  return {
    ...data,
    id: cleanString(data.id) || document.id,
    name: cleanString(data.name),
    status: cleanString(data.status),
    contractedRate: numberFrom(data.contractedRate),
    estimatedTime: numberFrom(data.estimatedTime),
    actualTime: numberFrom(data.actualTime),
    workerId: cleanString(data.workerId),
    workerName: cleanString(data.workerName),
    workerType: normalizeWorkerType(data.workerType),
    payTypeId: blankToNull(data.payTypeId),
    payTypeName: blankToNull(data.payTypeName),
  };
}

function normalizeWorkerType(value) {
  const normalized = cleanString(value).toLowerCase().replace(/[-_]+/g, " ");
  if (normalized === "independent contractor" || normalized === "contractor") {
    return "Independent Contractor";
  }
  if (normalized === "employee") {
    return "Employee";
  }
  return "";
}

function workTypeSuggestedPayBasis(workType) {
  if (!workType) return "serviceStop";
  if (workType.defaultRateType === "hourly") return "technicianHourly";

  switch (workType.category) {
    case "route":
    case "maintenance":
    case "serviceCall":
    case "commercial":
    case "startup":
    case "estimate":
      return "serviceStop";
    default:
      return "serviceStopTask";
  }
}

function serviceStopProductionPayBasis(workType) {
  const suggestedBasis = workTypeSuggestedPayBasis(workType);
  return suggestedBasis === "serviceStop" || suggestedBasis === "serviceStopTask"
    ? suggestedBasis
    : "serviceStop";
}

function rateIsUsable(rate, date) {
  if (rate.status === "draft" || rate.status === "archived") return false;
  if (rate.effectiveStartDate && rate.effectiveStartDate > date) return false;
  if (rate.effectiveEndDate && date > rate.effectiveEndDate) return false;
  return true;
}

function sortRates(lhs, rhs) {
  if (lhs.workTypeId && !rhs.workTypeId) return -1;
  if (!lhs.workTypeId && rhs.workTypeId) return 1;
  return rhs.effectiveStartDate.getTime() - lhs.effectiveStartDate.getTime();
}

function activeRate({
  companyId,
  technicianId,
  workTypeId,
  payBasis,
  preferredRateType,
  date,
  allowGeneralHourlyFallback,
  rates,
}) {
  const normalizedWorkTypeId = blankToNull(workTypeId);
  const candidates = rates.filter((rate) => {
    if (rate.companyId !== companyId) return false;
    if (rate.technicianId !== technicianId) return false;
    if (!rateIsUsable(rate, date)) return false;

    const exactPayBasisMatch = rate.payBasis === payBasis;
    const hourlyFallback =
      allowGeneralHourlyFallback &&
      rate.payBasis === "technicianHourly" &&
      rate.rateType === "hourly";

    if (!exactPayBasisMatch && !hourlyFallback) return false;

    const exactWorkTypeMatch = rate.workTypeId === normalizedWorkTypeId;
    const generalHourlyFallback =
      allowGeneralHourlyFallback &&
      !rate.workTypeId &&
      rate.rateType === "hourly";

    return exactWorkTypeMatch || generalHourlyFallback;
  });

  if (preferredRateType) {
    const preferred = candidates
      .filter((rate) => rate.rateType === preferredRateType)
      .sort(sortRates)[0];

    if (preferred) return preferred;
  }

  return candidates.sort(sortRates)[0] || null;
}

function calculateTotalAmountCents({ rateAmountCents, rateType, quantity, quantityUnit }) {
  switch (rateType) {
    case "flatPerStop":
    case "flatPerTask":
    case "manual":
      return Math.round(rateAmountCents * quantity);
    case "hourly":
      if (quantityUnit === "minutes") {
        return Math.round((rateAmountCents / 60) * quantity);
      }
      if (quantityUnit === "hours") {
        return Math.round(rateAmountCents * quantity);
      }
      return 0;
    case "perBodyOfWater":
    case "perServiceLocation":
      return Math.round(rateAmountCents * quantity);
    case "percentage":
    default:
      return 0;
  }
}

function quantityAndUnit({ rateType, serviceStop, task, minutesOverride }) {
  switch (rateType) {
    case "flatPerStop":
    case "flatPerTask":
    case "manual":
      return { quantity: 1, quantityUnit: "each" };
    case "hourly":
      return {
        quantity: numberFrom(minutesOverride ?? task?.actualTime ?? serviceStop.duration),
        quantityUnit: "minutes",
      };
    case "perBodyOfWater":
      return { quantity: 1, quantityUnit: "bodyOfWater" };
    case "perServiceLocation":
      return { quantity: 1, quantityUnit: "serviceLocation" };
    case "percentage":
    default:
      return { quantity: 1, quantityUnit: "percent" };
  }
}

function makeLineId({ source, serviceStopId, serviceStopTaskId, activeRouteId, activeRouteLogId, technicianId, workTypeId }) {
  return [
    "comp_pay_line",
    source,
    serviceStopId || "no_stop",
    serviceStopTaskId || "no_task",
    activeRouteId || "no_route",
    activeRouteLogId || "no_route_log",
    technicianId,
    workTypeId || "no_work_type",
  ].join("_");
}

function payrollDisplayTitle({ serviceStop, task, workTypeName }) {
  if (cleanString(task?.name)) return cleanString(task.name);
  if (cleanString(workTypeName)) return cleanString(workTypeName);
  if (cleanString(serviceStop.type)) return cleanString(serviceStop.type);
  return "Payroll Line Item";
}

function payrollDisplaySubtitle({ serviceStop, task, workTypeName }) {
  const parts = [];
  if (cleanString(task?.name)) {
    parts.push(cleanString(task.name));
  } else if (cleanString(workTypeName)) {
    parts.push(cleanString(workTypeName));
  } else if (cleanString(serviceStop.type)) {
    parts.push(cleanString(serviceStop.type));
  }

  const streetAddress = cleanString(serviceStop.address?.streetAddress);
  if (streetAddress) parts.push(streetAddress);

  const jobName = cleanString(serviceStop.jobName);
  const jobId = cleanString(serviceStop.jobId);
  if (jobName) {
    parts.push(jobName);
  } else if (jobId) {
    parts.push(`Job ${jobId}`);
  }

  return parts.join(" - ");
}

function lineBase({ serviceStop, task, worker, source, workTypeId, workTypeName, completedDate, now }) {
  return {
    id: makeLineId({
      source,
      serviceStopId: serviceStop.id,
      serviceStopTaskId: task?.id,
      activeRouteId: null,
      activeRouteLogId: null,
      technicianId: worker.userId,
      workTypeId,
    }),
    companyId: serviceStop.companyId,
    technicianId: worker.userId,
    technicianName: worker.userName,
    workerType: worker.workerType,
    source,
    serviceStopId: serviceStop.id,
    serviceStopTaskId: task?.id || null,
    activeRouteId: null,
    activeRouteLogId: null,
    payTypeId: workTypeId || null,
    payTypeName: workTypeName || null,
    completedDate: firestoreTimestamp(completedDate, now),
    calculatedAt: firestoreTimestamp(now, now),
    approvedAt: null,
    approvedByUserId: null,
    paidAt: null,
    paidByUserId: null,
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
    payStatementId: null,
    exportBatchId: null,
    adminReviewNotes: null,
    lineNumber: null,
    lineReference: null,
    paymentReference: null,
    displayTitle: payrollDisplayTitle({ serviceStop, task, workTypeName }),
    displaySubtitle: payrollDisplaySubtitle({ serviceStop, task, workTypeName }),
    customerId: serviceStop.customerId || null,
    customerName: serviceStop.customerName || null,
    serviceLocationId: serviceStop.serviceLocationId || null,
    serviceLocationAddress: cleanString(serviceStop.address?.streetAddress),
    jobId: cleanString(serviceStop.jobId) || null,
    jobInternalId: null,
    taskName: task?.name || null,
    serviceStopTypeName: serviceStop.type || null,
    serviceStopCategory: resolvedServiceStopCategory(serviceStop),
  };
}

function needsReviewLine({ serviceStop, task, worker, source, workTypeId, workTypeName, completedDate, now, notes }) {
  return {
    ...lineBase({ serviceStop, task, worker, source, workTypeId, workTypeName, completedDate, now }),
    rateId: null,
    rateAmountCents: 0,
    rateType: "manual",
    payBasis: null,
    quantity: 0,
    quantityUnit: "each",
    totalAmountCents: 0,
    calculationStatus: "needsReview",
    notes,
  };
}

function lineFromRate({ serviceStop, task, worker, source, workTypeId, workTypeName, rate, quantity, quantityUnit, completedDate, now, notes }) {
  if (rate.amountCents <= 0) {
    return needsReviewLine({
      serviceStop,
      task,
      worker,
      source,
      workTypeId,
      workTypeName,
      completedDate,
      now,
      notes: "Technician rate exists but amount is 0.",
    });
  }

  const totalAmountCents = calculateTotalAmountCents({
    rateAmountCents: rate.amountCents,
    rateType: rate.rateType,
    quantity,
    quantityUnit,
  });

  return {
    ...lineBase({ serviceStop, task, worker, source, workTypeId, workTypeName, completedDate, now }),
    rateId: rate.id,
    rateAmountCents: rate.amountCents,
    rateType: rate.rateType,
    payBasis: rate.payBasis,
    quantity,
    quantityUnit,
    totalAmountCents,
    calculationStatus: rate.rateType === "percentage" ? "needsReview" : "calculated",
    notes: rate.rateType === "percentage"
      ? "Percentage pay needs an invoice or base amount before it can be calculated."
      : notes || null,
  };
}

function serviceStopWorker(serviceStop, workersByUserId) {
  const knownWorker = workersByUserId.get(cleanString(serviceStop.techId));
  if (knownWorker) return knownWorker;

  return {
    userId: cleanString(serviceStop.techId),
    userName: cleanString(serviceStop.tech),
    workerType: "",
  };
}

function taskWorker({ serviceStop, task, workersByUserId }) {
  const workerId = cleanString(task.workerId) || cleanString(serviceStop.techId);
  const knownWorker = workersByUserId.get(workerId);
  const workerName = cleanString(task.workerName) || knownWorker?.userName || cleanString(serviceStop.tech);
  const workerType = cleanString(task.workerType) || knownWorker?.workerType || "";

  return {
    userId: workerId,
    userName: workerName,
    workerType,
  };
}

function serviceStopWorkTypeIds({ serviceStop, workTypesById, serviceStopTypesById }) {
  const ids = [];
  const directPayTypeId = blankToNull(
    serviceStop.payTypeId ||
    serviceStop.payWorkTypeId ||
    serviceStop.legacyWorkTypeId ||
    serviceStop.workTypeId
  );

  if (directPayTypeId) ids.push(directPayTypeId);

  const typeId = cleanString(serviceStop.typeId);
  if (typeId && workTypesById.has(typeId)) ids.push(typeId);

  const legacyDefaults = Array.isArray(serviceStop.legacyDefaultWorkTypeIds)
    ? serviceStop.legacyDefaultWorkTypeIds
    : serviceStop.defaultWorkTypeIds;
  if (Array.isArray(legacyDefaults)) ids.push(...legacyDefaults.map(cleanString));

  const serviceStopType = serviceStopTypesById.get(typeId);
  if (Array.isArray(serviceStopType?.defaultWorkTypeIds)) {
    ids.push(...serviceStopType.defaultWorkTypeIds.map(cleanString));
  }

  const seen = new Set();
  return ids.filter((id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function manualPayOverrideLine({ serviceStop, worker, amountCents, now }) {
  return {
    ...lineBase({
      serviceStop,
      task: null,
      worker,
      source: "manualAdjustment",
      workTypeId: blankToNull(serviceStop.payTypeId || serviceStop.payWorkTypeId || serviceStop.legacyWorkTypeId || serviceStop.workTypeId),
      workTypeName: blankToNull(serviceStop.payTypeName || serviceStop.payWorkTypeName || serviceStop.legacyWorkTypeName || serviceStop.workTypeName),
      completedDate: serviceStop.serviceDate,
      now,
    }),
    id: makeLineId({
      source: "manualAdjustment",
      serviceStopId: serviceStop.id,
      serviceStopTaskId: null,
      activeRouteId: null,
      activeRouteLogId: null,
      technicianId: worker.userId,
      workTypeId: null,
    }),
    rateId: null,
    rateAmountCents: amountCents,
    rateType: "manual",
    payBasis: "manualAdjustment",
    quantity: 1,
    quantityUnit: "each",
    totalAmountCents: amountCents,
    calculationStatus: "calculated",
    notes: cleanString(serviceStop.manualPayOverrideNotes) || "Manual payroll amount set while scheduling this service stop.",
  };
}

function makeServiceStopProductionLine({ companyId, serviceStop, workTypeId, workTypesById, workersByUserId, rates, now }) {
  const worker = serviceStopWorker(serviceStop, workersByUserId);
  const workType = workTypesById.get(workTypeId);
  const primaryPayBasis = serviceStopProductionPayBasis(workType);
  const fallbackPayBasis = primaryPayBasis === "serviceStop" ? "serviceStopTask" : "serviceStop";
  const serviceDate = dateFromValue(serviceStop.serviceDate) || now;

  const primaryRate = activeRate({
    companyId,
    technicianId: worker.userId,
    workTypeId,
    payBasis: primaryPayBasis,
    preferredRateType: workType?.defaultRateType,
    date: serviceDate,
    allowGeneralHourlyFallback: false,
    rates,
  });

  const fallbackRate = primaryRate ? null : activeRate({
    companyId,
    technicianId: worker.userId,
    workTypeId,
    payBasis: fallbackPayBasis,
    preferredRateType: workType?.defaultRateType,
    date: serviceDate,
    allowGeneralHourlyFallback: false,
    rates,
  });

  const rate = primaryRate || fallbackRate;
  if (!rate) {
    return needsReviewLine({
      serviceStop,
      task: null,
      worker,
      source: "serviceStop",
      workTypeId,
      workTypeName: workType?.name,
      completedDate: serviceStop.serviceDate,
      now,
      notes: `No active production rate found for ${worker.userName} and pay type ${workType?.name || workTypeId}. Checked ${primaryPayBasis} and ${fallbackPayBasis}.`,
    });
  }

  const { quantity, quantityUnit } = quantityAndUnit({ rateType: rate.rateType, serviceStop, task: null, minutesOverride: null });
  return lineFromRate({
    serviceStop,
    task: null,
    worker,
    source: "serviceStop",
    workTypeId,
    workTypeName: workType?.name,
    rate,
    quantity,
    quantityUnit,
    completedDate: serviceStop.serviceDate,
    now,
    notes: rate.payBasis === primaryPayBasis
      ? null
      : `Used ${rate.payBasis} rate for stop-level payroll because the service stop pay type is configured with ${primaryPayBasis} as its preferred pay basis.`,
  });
}

function makeServiceStopHourlyLine({ companyId, serviceStop, workTypeIds, workTypesById, workersByUserId, rates, now }) {
  const worker = serviceStopWorker(serviceStop, workersByUserId);
  const workTypeId = workTypeIds[0] || null;
  const workType = workTypeId ? workTypesById.get(workTypeId) : null;
  const serviceDate = dateFromValue(serviceStop.serviceDate) || now;
  const rate = activeRate({
    companyId,
    technicianId: worker.userId,
    workTypeId,
    payBasis: "technicianHourly",
    preferredRateType: "hourly",
    date: serviceDate,
    allowGeneralHourlyFallback: true,
    rates,
  });

  if (!rate) {
    return needsReviewLine({
      serviceStop,
      task: null,
      worker,
      source: "serviceStop",
      workTypeId,
      workTypeName: workType?.name,
      completedDate: serviceStop.serviceDate,
      now,
      notes: `No active hourly rate found for ${worker.userName}.`,
    });
  }

  return lineFromRate({
    serviceStop,
    task: null,
    worker,
    source: "serviceStop",
    workTypeId,
    workTypeName: workType?.name || "Hourly Service Stop Time",
    rate,
    quantity: numberFrom(serviceStop.duration),
    quantityUnit: "minutes",
    completedDate: serviceStop.serviceDate,
    now,
    notes: "Hourly pay from service stop duration. For hourly-only companies, prefer ActiveRoute pay generation instead.",
  });
}

function taskLineFromContractedRate({ serviceStop, task, worker, workTypeId, workTypeName, now }) {
  if (task.contractedRate <= 0) return null;

  const totalAmountCents = calculateTotalAmountCents({
    rateAmountCents: task.contractedRate,
    rateType: "flatPerTask",
    quantity: 1,
    quantityUnit: "each",
  });

  return {
    ...lineBase({ serviceStop, task, worker, source: "serviceStopTask", workTypeId, workTypeName, completedDate: serviceStop.serviceDate, now }),
    rateId: null,
    rateAmountCents: task.contractedRate,
    rateType: "flatPerTask",
    payBasis: "serviceStopTask",
    quantity: 1,
    quantityUnit: "each",
    totalAmountCents,
    calculationStatus: "calculated",
    notes: "Used ServiceStopTask.contractedRate.",
  };
}

function taskLineFromTechnicianRate({
  companyId,
  serviceStop,
  task,
  worker,
  workTypeId,
  workTypeName,
  preferredRateType,
  rates,
  now,
  returnNullWhenMissingRate = false,
}) {
  const serviceDate = dateFromValue(serviceStop.serviceDate) || now;
  const rate = activeRate({
    companyId,
    technicianId: worker.userId,
    workTypeId,
    payBasis: "serviceStopTask",
    preferredRateType,
    date: serviceDate,
    allowGeneralHourlyFallback: false,
    rates,
  });

  if (!rate) {
    if (returnNullWhenMissingRate) return null;
    return needsReviewLine({
      serviceStop,
      task,
      worker,
      source: "serviceStopTask",
      workTypeId,
      workTypeName,
      completedDate: serviceStop.serviceDate,
      now,
      notes: `No active technician task rate found for ${worker.userName} and pay type ${workTypeName || workTypeId}.`,
    });
  }

  if (rate.amountCents <= 0) return null;

  const { quantity, quantityUnit } = quantityAndUnit({ rateType: rate.rateType, serviceStop, task, minutesOverride: null });
  return lineFromRate({
    serviceStop,
    task,
    worker,
    source: "serviceStopTask",
    workTypeId,
    workTypeName,
    rate,
    quantity,
    quantityUnit,
    completedDate: serviceStop.serviceDate,
    now,
    notes: null,
  });
}

function taskLineFromHourlyRate({ companyId, serviceStop, task, worker, workTypeId, workTypeName, minutes, rates, now, notes }) {
  const serviceDate = dateFromValue(serviceStop.serviceDate) || now;
  const rate = activeRate({
    companyId,
    technicianId: worker.userId,
    workTypeId,
    payBasis: "technicianHourly",
    preferredRateType: "hourly",
    date: serviceDate,
    allowGeneralHourlyFallback: true,
    rates,
  });

  if (!rate) {
    return needsReviewLine({
      serviceStop,
      task,
      worker,
      source: "serviceStopTask",
      workTypeId,
      workTypeName,
      completedDate: serviceStop.serviceDate,
      now,
      notes: `No active hourly rate found for ${worker.userName}.`,
    });
  }

  return lineFromRate({
    serviceStop,
    task,
    worker,
    source: "serviceStopTask",
    workTypeId,
    workTypeName,
    rate,
    quantity: numberFrom(minutes),
    quantityUnit: "minutes",
    completedDate: serviceStop.serviceDate,
    now,
    notes,
  });
}

function makeTaskLine({ companyId, serviceStop, task, taskPaySource, workTypesById, workersByUserId, rates, now }) {
  const worker = taskWorker({ serviceStop, task, workersByUserId });
  const workTypeId = blankToNull(task.payTypeId);

  if (!workTypeId) {
    return needsReviewLine({
      serviceStop,
      task,
      worker,
      source: "serviceStopTask",
      workTypeId: null,
      workTypeName: null,
      completedDate: serviceStop.serviceDate,
      now,
      notes: `No pay type selected for task: ${task.name}`,
    });
  }

  const workType = workTypesById.get(workTypeId);
  const workTypeName = task.payTypeName || workType?.name || null;

  switch (taskPaySource) {
    case "technicianRate":
      return taskLineFromTechnicianRate({ companyId, serviceStop, task, worker, workTypeId, workTypeName, preferredRateType: workType?.defaultRateType, rates, now });
    case "taskContractedRate":
      return taskLineFromContractedRate({ serviceStop, task, worker, workTypeId, workTypeName, now });
    case "technicianRateThenTaskContractedRate":
      return taskLineFromTechnicianRate({
        companyId,
        serviceStop,
        task,
        worker,
        workTypeId,
        workTypeName,
        preferredRateType: workType?.defaultRateType,
        rates,
        now,
        returnNullWhenMissingRate: true,
      }) || taskLineFromContractedRate({ serviceStop, task, worker, workTypeId, workTypeName, now });
    case "taskContractedRateThenTechnicianRate":
      if (task.contractedRate > 0) {
        return taskLineFromContractedRate({ serviceStop, task, worker, workTypeId, workTypeName, now });
      }
      return taskLineFromTechnicianRate({ companyId, serviceStop, task, worker, workTypeId, workTypeName, preferredRateType: workType?.defaultRateType, rates, now });
    case "hourlyActualTime":
      return taskLineFromHourlyRate({ companyId, serviceStop, task, worker, workTypeId, workTypeName, minutes: task.actualTime, rates, now, notes: "Hourly pay from task actualTime." });
    case "hourlyEstimatedTime":
      return taskLineFromHourlyRate({ companyId, serviceStop, task, worker, workTypeId, workTypeName, minutes: task.estimatedTime, rates, now, notes: "Hourly pay from task estimatedTime." });
    case "none":
    default:
      return null;
  }
}

function generateLineItems({ companyId, serviceStop, tasks, settings, workTypesById, serviceStopTypesById, workersByUserId, rates }) {
  if (!isFinishedServiceStop(serviceStop)) return [];

  const now = new Date();
  const worker = serviceStopWorker(serviceStop, workersByUserId);
  const manualPayOverrideCents = serviceStop.manualPayOverrideCents === undefined || serviceStop.manualPayOverrideCents === null
    ? null
    : numberFrom(serviceStop.manualPayOverrideCents);

  if (manualPayOverrideCents !== null) {
    return manualPayOverrideCents > 0
      ? [manualPayOverrideLine({ serviceStop, worker, amountCents: manualPayOverrideCents, now })]
      : [];
  }

  if (settings.payMode === "hourlyOnly") return [];

  const lineItems = [];
  const stopWorkTypeIds = serviceStopWorkTypeIds({ serviceStop, workTypesById, serviceStopTypesById });

  switch (settings.routePaySource) {
    case "serviceStop":
    case "serviceStopAndCompletedTasks":
      if (stopWorkTypeIds.length === 0) {
        lineItems.push(needsReviewLine({
          serviceStop,
          task: null,
          worker,
          source: "serviceStop",
          workTypeId: null,
          workTypeName: null,
          completedDate: serviceStop.serviceDate,
          now,
          notes: `No service stop pay type could be resolved. typeId: ${serviceStop.typeId || ""}.`,
        }));
      } else if (!settings.allowMultipleWorkTypesPerStop && stopWorkTypeIds.length > 1) {
        lineItems.push(needsReviewLine({
          serviceStop,
          task: null,
          worker,
          source: "serviceStop",
          workTypeId: null,
          workTypeName: null,
          completedDate: serviceStop.serviceDate,
          now,
          notes: "Multiple pay types matched this service stop, but company settings do not allow multiple pay types per stop.",
        }));
      } else {
        const workTypeId = stopWorkTypeIds[0];
        lineItems.push(makeServiceStopProductionLine({ companyId, serviceStop, workTypeId, workTypesById, workersByUserId, rates, now }));
      }
      break;
    case "hourlyServiceStopDuration":
      lineItems.push(makeServiceStopHourlyLine({ companyId, serviceStop, workTypeIds: stopWorkTypeIds, workTypesById, workersByUserId, rates, now }));
      break;
    default:
      break;
  }

  const taskPaySource = settings.routePaySource === "hourlyTaskActualTime"
    ? "hourlyActualTime"
    : settings.taskPaySource;

  if (taskPaySource !== "none") {
    tasks
      .filter((task) => isFinishedStatus(task.status))
      .forEach((task) => {
        const line = makeTaskLine({ companyId, serviceStop, task, taskPaySource, workTypesById, workersByUserId, rates, now });
        if (line) lineItems.push(line);
      });
  }

  return lineItems.filter((lineItem) => lineItem.totalAmountCents > 0);
}

function shouldKeepExistingLineItem(existing, settings) {
  if (existing.calculationStatus === "paid") return true;

  if (existing.calculationStatus === "voided") {
    switch (existing.voidReason) {
      case "serviceStopReopened":
      case "serviceStopSkipped":
      case "taskReopened":
        return false;
      case "adminVoided":
      case "duplicate":
        return true;
      default:
        return true;
    }
  }

  if (settings.lockPayAfterApproval && existing.calculationStatus === "approved") {
    return true;
  }

  if (!settings.recalculateUnapprovedPayWhenRatesChange) {
    switch (existing.calculationStatus) {
      case "pending":
      case "calculated":
      case "adjusted":
        return true;
      case "needsReview":
        return false;
      default:
        return false;
    }
  }

  return false;
}

function appendAdminNote(existingNote, newNote) {
  const timestamp = new Date().toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
  const formattedNewNote = `[${timestamp}] ${newNote}`;
  const existing = cleanString(existingNote);
  return existing ? `${existing}\n${formattedNewNote}` : formattedNewNote;
}

function mergeGeneratedLineItems({ generatedLineItems, existingLineItems, settings }) {
  const existingById = new Map(existingLineItems.map((lineItem) => [lineItem.id, lineItem]));

  return generatedLineItems.map((generated) => {
    const existing = existingById.get(generated.id);
    if (!existing) return generated;

    if (shouldKeepExistingLineItem(existing, settings)) {
      return existing;
    }

    return {
      ...generated,
      adminReviewNotes: appendAdminNote(
        existing.adminReviewNotes,
        existing.calculationStatus === "voided"
          ? "Regenerated because the service stop was finished again."
          : "Regenerated from current payroll rules."
      ),
    };
  }).filter((lineItem) => lineItem.totalAmountCents > 0);
}

async function generatePayForFinishedStop({ companyId, serviceStop }) {
  const companyRef = db.collection("companies").doc(companyId);
  const [
    settingsSnap,
    workTypesSnap,
    serviceStopTypesSnap,
    ratesSnap,
    usersSnap,
    tasksSnap,
    existingLineItemsSnap,
  ] = await Promise.all([
    companyRef.collection("paySettings").doc("main").get(),
    companyRef.collection("companyWorkTypes").get(),
    companyRef.collection("companyServiceStopTypes").get(),
    companyRef.collection("technicianRates").get(),
    companyRef.collection("companyUsers").get(),
    companyRef.collection("serviceStops").doc(serviceStop.id).collection("tasks").get(),
    companyRef.collection("technicianPayLineItems").where("serviceStopId", "==", serviceStop.id).get(),
  ]);

  const settings = normalizedPaySettings(companyId, settingsSnap.exists ? settingsSnap.data() : {});
  const workTypes = workTypesSnap.docs.map(normalizedWorkType).filter((workType) => workType.isActive);
  const workTypesById = new Map(workTypes.map((workType) => [workType.id, workType]));
  const serviceStopTypesById = new Map(serviceStopTypesSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return [
      cleanString(data.id) || doc.id,
      {
        ...data,
        id: cleanString(data.id) || doc.id,
        defaultWorkTypeIds: Array.isArray(data.defaultWorkTypeIds) ? data.defaultWorkTypeIds : [],
      },
    ];
  }));
  const rates = ratesSnap.docs.map(normalizedRate);
  const workers = usersSnap.docs
    .map(normalizedCompanyUser)
    .filter((user) => user.status === "Active");
  const workersByUserId = new Map(workers.map((worker) => [
    worker.userId,
    {
      userId: worker.userId,
      userName: worker.userName,
      workerType: worker.workerType,
    },
  ]));
  const tasks = tasksSnap.docs.map(normalizedTask);
  const existingLineItems = existingLineItemsSnap.docs.map((doc) => ({
    ...doc.data(),
    id: cleanString(doc.data()?.id) || doc.id,
  }));

  const generatedLineItems = generateLineItems({
    companyId,
    serviceStop,
    tasks,
    settings,
    workTypesById,
    serviceStopTypesById,
    workersByUserId,
    rates,
  });

  const lineItemsToSave = mergeGeneratedLineItems({
    generatedLineItems,
    existingLineItems,
    settings,
  });

  let savedLineItemCount = 0;
  for (let index = 0; index < lineItemsToSave.length; index += 450) {
    const batch = db.batch();
    lineItemsToSave.slice(index, index + 450).forEach((lineItem) => {
      batch.set(companyRef.collection("technicianPayLineItems").doc(lineItem.id), lineItem, { merge: true });
    });
    await batch.commit();
    savedLineItemCount += Math.min(450, lineItemsToSave.length - index);
  }

  return {
    generatedLineItemCount: generatedLineItems.length,
    savedLineItemCount,
    keptExistingLockedLineItemCount: lineItemsToSave.filter((lineItem) => (
      existingLineItems.some((existing) => existing.id === lineItem.id && shouldKeepExistingLineItem(existing, settings))
    )).length,
  };
}

function routeStatus({ route, totalStops, finishedStops }) {
  if (totalStops > 0 && totalStops === finishedStops) {
    if (route.endMilage != null && route.endTime) {
      return ACTIVE_ROUTE_FINISHED;
    }

    if (route.status === ACTIVE_ROUTE_TRAVELING || route.status === ACTIVE_ROUTE_ON_BREAK) {
      return route.status;
    }

    return ACTIVE_ROUTE_IN_PROGRESS;
  }

  if (
    route.status === ACTIVE_ROUTE_IN_PROGRESS ||
    route.status === ACTIVE_ROUTE_TRAVELING ||
    route.status === ACTIVE_ROUTE_ON_BREAK
  ) {
    return route.status;
  }

  return finishedStops > 0 ? ACTIVE_ROUTE_IN_PROGRESS : ACTIVE_ROUTE_DID_NOT_START;
}

async function syncActiveRouteCounters({ companyId, serviceStopId }) {
  const companyRef = db.collection("companies").doc(companyId);
  const activeRoutesSnap = await companyRef
    .collection("activeRoutes")
    .where("serviceStopsIds", "array-contains", serviceStopId)
    .get();

  if (activeRoutesSnap.empty) {
    return { syncedRouteCount: 0 };
  }

  const batch = db.batch();
  let syncedRouteCount = 0;

  for (const routeDoc of activeRoutesSnap.docs) {
    const route = { ...routeDoc.data(), id: routeDoc.id };
    const serviceStopIds = Array.isArray(route.serviceStopsIds) ? route.serviceStopsIds.filter(Boolean) : [];
    const stopRefs = serviceStopIds.map((id) => companyRef.collection("serviceStops").doc(id));
    const stopDocs = stopRefs.length > 0 ? await db.getAll(...stopRefs) : [];
    const finishedStops = stopDocs.filter((doc) => doc.exists && isFinishedServiceStop(doc.data() || {})).length;
    const totalStops = serviceStopIds.length;

    batch.set(routeDoc.ref, {
      finishedStops,
      totalStops,
      status: routeStatus({ route, totalStops, finishedStops }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    syncedRouteCount += 1;
  }

  await batch.commit();
  return { syncedRouteCount };
}

async function claimCompletionWork(workRef, requestId) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workRef);
    if (!snapshot.exists) return false;

    const fresh = snapshot.data() || {};
    if (fresh.status !== "queued") return false;
    if (requestId && fresh.requestId !== requestId) return false;

    transaction.set(workRef, {
      status: "processing",
      attempts: FieldValue.increment(1),
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return true;
  });
}

async function runCompletionStep(name, work) {
  try {
    return { name, result: await work() };
  } catch (error) {
    console.error(`[serviceStopCompletion][${name}]`, error);
    return {
      name,
      error: {
        message: error.message || String(error),
        code: error.code || null,
      },
    };
  }
}

exports.processServiceStopCompletionWork = onDocumentWritten(
  "companies/{companyId}/serviceStopCompletionWork/{workId}",
  async (event) => {
    if (!event.data?.after?.exists) return null;

    const workRef = event.data.after.ref;
    const work = event.data.after.data() || {};
    if (work.status !== "queued") return null;

    const requestId = cleanString(work.requestId);
    const claimed = await claimCompletionWork(workRef, requestId);
    if (!claimed) return null;

    const companyId = cleanString(event.params.companyId || work.companyId);
    const serviceStopId = cleanString(work.serviceStopId || event.params.workId);
    const serviceStopRef = db.collection("companies").doc(companyId).collection("serviceStops").doc(serviceStopId);

    try {
      const serviceStopDoc = await serviceStopRef.get();
      if (!serviceStopDoc.exists) {
        await workRef.set({
          status: "error",
          errorMessages: ["Service stop not found."],
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
      }

      const serviceStop = {
        ...serviceStopDoc.data(),
        id: cleanString(serviceStopDoc.data()?.id) || serviceStopDoc.id,
        companyId,
      };

      if (
        requestId &&
        cleanString(serviceStop.completionWorkRequestId) &&
        cleanString(serviceStop.completionWorkRequestId) !== requestId
      ) {
        await workRef.set({
          status: "skipped",
          skippedReason: "Stale completion request.",
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
      }

      if (!isFinishedServiceStop(serviceStop)) {
        await Promise.all([
          workRef.set({
            status: "skipped",
            skippedReason: "Service stop is no longer finished.",
            finishedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true }),
          serviceStopRef.set({
            completionWorkStatus: "skipped",
            completionWorkProcessedAt: FieldValue.serverTimestamp(),
            completionWorkErrorMessages: ["Service stop is no longer finished."],
          }, { merge: true }),
        ]);
        return null;
      }

      const shouldSendServiceReport = work.sendServiceReport !== false;
      const steps = [
        runCompletionStep("activeRoute", () => syncActiveRouteCounters({ companyId, serviceStopId })),
        runCompletionStep("payroll", () => generatePayForFinishedStop({ companyId, serviceStop })),
      ];

      if (shouldSendServiceReport) {
        steps.push(runCompletionStep("serviceReportEmail", () => sendServiceReportOnFinishCore({
          companyId,
          serviceStopId,
          serviceReportBaseUrl: work.serviceReportBaseUrl,
        })));
      }

      const stepResults = await Promise.all(steps);
      const errors = stepResults
        .filter((step) => step.error)
        .map((step) => `${step.name}: ${step.error.message}`);
      const stepResultMap = Object.fromEntries(stepResults.map((step) => [step.name, step.result || step.error]));
      const status = errors.length > 0 ? "completedWithErrors" : "completed";

      await Promise.all([
        serviceStopRef.set({
          completionWorkStatus: status,
          completionWorkProcessedAt: FieldValue.serverTimestamp(),
          completionWorkErrorMessages: errors,
          serviceReportLastResult: stepResultMap.serviceReportEmail || null,
          payrollLastProcessedAt: FieldValue.serverTimestamp(),
          payrollLastResult: stepResultMap.payroll || null,
          activeRouteLastSyncResult: stepResultMap.activeRoute || null,
        }, { merge: true }),
        workRef.set({
          status,
          result: stepResultMap,
          errorMessages: errors,
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
      ]);

      return null;
    } catch (error) {
      console.error("[serviceStopCompletion][processServiceStopCompletionWork]", error);

      const message = error.message || String(error);
      await Promise.all([
        workRef.set({
          status: "error",
          errorMessages: [message],
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        serviceStopRef.set({
          completionWorkStatus: "error",
          completionWorkProcessedAt: FieldValue.serverTimestamp(),
          completionWorkErrorMessages: [message],
        }, { merge: true }),
      ]);

      return null;
    }
  }
);
