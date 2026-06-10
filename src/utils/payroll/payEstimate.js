const cents = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const rateIsCurrent = (rate, date = new Date()) => {
  const status = String(rate?.status || "").toLowerCase();
  if (status === "draft" || status === "archived") return false;

  const start = dateFromValue(rate?.effectiveStartDate);
  const end = dateFromValue(rate?.effectiveEndDate);

  if (start && start > date) return false;
  if (end && end < date) return false;

  return true;
};

const calculateTotalAmountCents = ({ rateAmountCents, rateType, quantity, quantityUnit }) => {
  const amount = cents(rateAmountCents);
  const qty = Number(quantity || 0);

  switch (rateType) {
    case "hourly":
      return quantityUnit === "minutes"
        ? Math.round((amount / 60) * qty)
        : Math.round(amount * qty);
    case "flatPerStop":
    case "flatPerTask":
    case "manual":
    case "perBodyOfWater":
    case "perServiceLocation":
      return Math.round(amount * qty);
    case "percentage":
    default:
      return 0;
  }
};

const normalizeSettings = (settings = {}) => {
  const safeSettings = settings || {};

  return {
    payMode: safeSettings.payMode || "productionOnly",
    routePaySource: safeSettings.routePaySource || "serviceStopAndCompletedTasks",
    taskPaySource: safeSettings.taskPaySource || "technicianRateThenTaskContractedRate",
    allowMultipleWorkTypesPerStop: safeSettings.allowMultipleWorkTypesPerStop !== false,
  };
};

const userIdForRate = (worker) => worker?.userId || worker?.id || "";

const userNameForRate = (worker) =>
  worker?.userName ||
  worker?.displayName ||
  worker?.name ||
  `${worker?.firstName || ""} ${worker?.lastName || ""}`.trim() ||
  "Technician";

const uniqueIds = (ids = []) => {
  const seen = new Set();
  return ids.filter((id) => {
    const clean = String(id || "").trim();
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });
};

const workTypeName = (workTypesById, workTypeId) =>
  workTypesById[workTypeId]?.name || "Service Work";

const workTypeSuggestedPayBasis = (workType) => {
  if (!workType) return "serviceStop";
  if (workType.defaultRateType === "hourly") return "technicianHourly";

  switch (workType.category) {
    case "route":
    case "serviceCall":
    case "commercial":
    case "startup":
      return "serviceStop";
    case "repair":
    case "installation":
    case "cleaning":
    case "drainAndRefill":
    case "extra":
    case "custom":
      return "serviceStopTask";
    default:
      return "serviceStop";
  }
};

const otherProductionPayBasis = (payBasis) =>
  payBasis === "serviceStopTask" ? "serviceStop" : "serviceStopTask";

const payrollSourceIds = {
  recurringServiceStop: "system_recurring_service_stop",
  jobServiceStop: "system_job_service_stop",
  jobEstimateServiceStop: "system_job_estimate_service_stop",
  serviceAgreementEstimateServiceStop: "system_service_agreement_estimate_service_stop",
  customerRelationshipServiceStop: "system_customer_relationship_service_stop",
  unknownServiceStop: "system_unknown_service_stop",
};

const normalizedCategory = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_/-]/g, "");

const payrollSourceIdForCategory = (category = "") => {
  switch (normalizedCategory(category)) {
    case "route":
    case "recurringroute":
    case "recurringservicestop":
      return payrollSourceIds.recurringServiceStop;
    case "job":
    case "jobvisit":
    case "jobservicestop":
      return payrollSourceIds.jobServiceStop;
    case "jobestimate":
    case "estimateforjob":
      return payrollSourceIds.jobEstimateServiceStop;
    case "serviceagreementestimate":
    case "recurringserviceestimate":
    case "serviceestimate":
    case "startup":
      return payrollSourceIds.serviceAgreementEstimateServiceStop;
    case "customerrelationship":
    case "customervisit":
      return payrollSourceIds.customerRelationshipServiceStop;
    default:
      return "";
  }
};

export const inferPayrollServiceStopSourceId = (serviceStop = {}, serviceStopType = null) => {
  const explicitCategorySource =
    payrollSourceIdForCategory(serviceStopType?.category) ||
    payrollSourceIdForCategory(serviceStop?.category) ||
    payrollSourceIdForCategory(serviceStop?.serviceStopCategory);

  if (explicitCategorySource) return explicitCategorySource;

  const typeId = String(serviceStopType?.id || serviceStop?.typeId || serviceStop?.serviceStopTypeId || "").trim();
  const knownSourceIds = new Set(Object.values(payrollSourceIds));
  if (knownSourceIds.has(typeId)) return typeId;

  const useCaseSource = payrollSourceIdForCategory(
    serviceStop?.serviceStopTypeUseCaseRawValue ||
    serviceStopType?.serviceStopTypeUseCaseRawValue ||
    ""
  );

  if (useCaseSource) return useCaseSource;

  const typeText = `${serviceStopType?.name || ""} ${serviceStop?.type || ""} ${serviceStop?.serviceStopTypeName || ""} ${serviceStop?.description || ""}`;
  const normalizedText = normalizedCategory(typeText);

  if (
    normalizedText.includes("customerrelationship") ||
    normalizedText.includes("customervisit") ||
    normalizedText.includes("followup") ||
    normalizedText.includes("courtesyvisit")
  ) {
    return payrollSourceIds.customerRelationshipServiceStop;
  }

  if (
    normalizedText.includes("serviceagreementestimate") ||
    normalizedText.includes("recurringserviceestimate") ||
    normalizedText.includes("newserviceestimate") ||
    normalizedText.includes("serviceestimate") ||
    normalizedText.includes("startup") ||
    normalizedText.includes("newpool")
  ) {
    return payrollSourceIds.serviceAgreementEstimateServiceStop;
  }

  if (
    normalizedText.includes("jobestimate") ||
    normalizedText.includes("estimateforjob") ||
    normalizedText.includes("bidvisit")
  ) {
    return payrollSourceIds.jobEstimateServiceStop;
  }

  if (serviceStop?.recurringServiceStopId) return payrollSourceIds.recurringServiceStop;
  if (serviceStop?.jobId) return payrollSourceIds.jobServiceStop;

  return payrollSourceIds.recurringServiceStop;
};

const mappedWorkTypeIds = ({ mappings, sourceType, sourceId }) =>
  uniqueIds(
    (mappings || [])
      .filter((mapping) => mapping.sourceType === sourceType && mapping.sourceId === sourceId)
      .map((mapping) => mapping.workTypeId)
  );

const activeRate = ({
  companyId,
  technicianId,
  workTypeId,
  payBasis,
  preferredRateType,
  rates,
  date,
  allowGeneralHourlyFallback = false,
}) => {
  const candidates = (rates || [])
    .filter((rate) => {
      if (rate.companyId && rate.companyId !== companyId) return false;
      if (rate.technicianId !== technicianId) return false;
      if (!rateIsCurrent(rate, date)) return false;

      const exactPayBasisMatch = rate.payBasis === payBasis;
      const hourlyPayBasisFallback =
        allowGeneralHourlyFallback &&
        rate.payBasis === "technicianHourly" &&
        rate.rateType === "hourly";
      if (!exactPayBasisMatch && !hourlyPayBasisFallback) return false;

      const exactWorkTypeMatch = (rate.workTypeId || "") === (workTypeId || "");
      const generalHourlyFallback =
        allowGeneralHourlyFallback &&
        !rate.workTypeId &&
        rate.rateType === "hourly";

      return exactWorkTypeMatch || generalHourlyFallback;
    })
    .sort((a, b) => {
      if (a.workTypeId && !b.workTypeId) return -1;
      if (!a.workTypeId && b.workTypeId) return 1;
      const bDate = dateFromValue(b.effectiveStartDate)?.getTime?.() || 0;
      const aDate = dateFromValue(a.effectiveStartDate)?.getTime?.() || 0;
      return bDate - aDate;
    });

  if (preferredRateType) {
    const preferred = candidates.find((rate) => rate.rateType === preferredRateType);
    if (preferred) return preferred;
  }

  return candidates[0] || null;
};

const lineFromRate = ({
  companyId,
  worker,
  source,
  sourceTaskId = null,
  title,
  workTypeId,
  payBasis,
  preferredRateType,
  estimatedMinutes,
  rates,
  workTypesById,
  date,
  allowGeneralHourlyFallback = false,
  debugContext = {},
  fallbackPayBasis = "",
}) => {
  const primaryRate = activeRate({
    companyId,
    technicianId: userIdForRate(worker),
    workTypeId,
    payBasis,
    preferredRateType,
    rates,
    date,
    allowGeneralHourlyFallback,
  });
  const fallbackRate =
    !primaryRate && fallbackPayBasis
      ? activeRate({
          companyId,
          technicianId: userIdForRate(worker),
          workTypeId,
          payBasis: fallbackPayBasis,
          preferredRateType,
          rates,
          date,
          allowGeneralHourlyFallback,
        })
      : null;
  const rate = primaryRate || fallbackRate;

  if (!rate) {
    console.warn("[PayEstimate][missingRate]", {
      companyId,
      technicianId: userIdForRate(worker),
      technicianName: userNameForRate(worker),
      source,
      sourceTaskId,
      title,
      workTypeId,
      workTypeName: workTypeName(workTypesById, workTypeId),
      payBasis,
      fallbackPayBasis,
      preferredRateType,
      allowGeneralHourlyFallback,
      activeRateCountForTechnician: (rates || []).filter((candidate) => {
        if (candidate.companyId && candidate.companyId !== companyId) return false;
        if (candidate.technicianId !== userIdForRate(worker)) return false;
        return rateIsCurrent(candidate, date);
      }).length,
      debugContext,
    });

    return {
      id: `estimate_missing_${source}_${sourceTaskId || workTypeId}`,
      source,
      sourceTaskId,
      workTypeId,
      workTypeName: workTypeName(workTypesById, workTypeId),
      title,
      rateAmountCents: 0,
      rateType: "manual",
      quantity: 0,
      quantityUnit: "each",
      totalAmountCents: 0,
      calculationStatus: "needsReview",
      notes: `No active technician rate found for ${userNameForRate(worker)} and ${workTypeName(workTypesById, workTypeId)}.`,
    };
  }

  const quantity = rate.rateType === "hourly" ? Number(estimatedMinutes || 0) : 1;
  const quantityUnit =
    rate.rateType === "hourly"
      ? "minutes"
      : rate.rateType === "perBodyOfWater"
        ? "bodyOfWater"
        : rate.rateType === "perServiceLocation"
          ? "serviceLocation"
          : "each";

  return {
    id: `estimate_rate_${rate.id}_${sourceTaskId || "stop"}`,
    source,
    sourceTaskId,
    workTypeId,
    workTypeName: workTypeName(workTypesById, workTypeId),
    title,
    rateAmountCents: cents(rate.amountCents),
    rateType: rate.rateType,
    payBasis: rate.payBasis,
    quantity,
    quantityUnit,
    totalAmountCents: calculateTotalAmountCents({
      rateAmountCents: rate.amountCents,
      rateType: rate.rateType,
      quantity,
      quantityUnit,
    }),
    calculationStatus: rate.rateType === "percentage" ? "needsReview" : "calculated",
    notes:
      fallbackRate && !primaryRate
        ? `Estimated from ${statusLabelForNote(rate.payBasis)} rate after ${statusLabelForNote(payBasis)} did not match.`
        : "Estimated from technician rate.",
  };
};

const statusLabelForNote = (value) =>
  String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const lineFromTaskContractedRate = ({ task, workTypeId, workTypesById }) => ({
  id: `estimate_task_${task.id}`,
  source: "serviceStopTask",
  sourceTaskId: task.id,
  workTypeId,
  workTypeName: workTypeName(workTypesById, workTypeId),
  title: task.name || task.description || "Task",
  rateAmountCents: cents(task.contractedRate),
  rateType: "flatPerTask",
  quantity: 1,
  quantityUnit: "each",
  totalAmountCents: cents(task.contractedRate),
  calculationStatus: cents(task.contractedRate) > 0 ? "calculated" : "needsReview",
  notes: "Estimated from task contracted rate.",
});

const missingTaskLine = ({ task, notes }) => ({
  id: `estimate_task_needs_review_${task.id}`,
  source: "serviceStopTask",
  sourceTaskId: task.id,
  workTypeId: null,
  workTypeName: null,
  title: task.name || task.description || "Task",
  rateAmountCents: 0,
  rateType: "manual",
  quantity: 0,
  quantityUnit: "each",
  totalAmountCents: 0,
  calculationStatus: "needsReview",
  notes,
});

export const totalPayCents = (lines = []) =>
  lines.reduce((total, line) => total + cents(line.totalAmountCents), 0);

export const estimateServiceStopPay = ({
  companyId,
  settings,
  serviceStop = null,
  serviceStopType,
  serviceStopUseCaseSourceId = "",
  serviceStopWorkTypeIds = null,
  tasks = [],
  worker,
  workTypes = [],
  mappings = [],
  rates = [],
  date = new Date(),
}) => {
  const effectiveSettings = normalizeSettings(settings);
  const workTypesById = Object.fromEntries((workTypes || []).map((type) => [type.id, type]));
  const lines = [];

  if (effectiveSettings.payMode === "hourlyOnly") {
    return [];
  }

  if (!worker || !userIdForRate(worker)) {
    console.warn("[PayEstimate][missingWorker]", {
      companyId,
      serviceStopId: serviceStop?.id || "",
      serviceStopTypeId: serviceStopType?.id || serviceStop?.typeId || "",
      taskCount: tasks.length,
    });

    return tasks.map((task) =>
      missingTaskLine({ task, notes: "Select a technician to estimate technician-rate pay." })
    );
  }

  const hasSelectedStopWorkTypes = Array.isArray(serviceStopWorkTypeIds);
  const serviceStopTypeId = serviceStopType?.id || serviceStop?.typeId || "";
  const inferredServiceStopSourceId =
    serviceStopUseCaseSourceId ||
    inferPayrollServiceStopSourceId(serviceStop, serviceStopType);
  const defaultStopWorkTypeIds = uniqueIds(serviceStopType?.defaultWorkTypeIds || []);
  const explicitStopWorkTypeIds = mappedWorkTypeIds({
    mappings,
    sourceType: "serviceStopType",
    sourceId: serviceStopTypeId,
  });
  const inferredStopWorkTypeIds = mappedWorkTypeIds({
    mappings,
    sourceType: "serviceStopType",
    sourceId: inferredServiceStopSourceId,
  });
  const stopWorkTypeIds = hasSelectedStopWorkTypes
    ? uniqueIds(serviceStopWorkTypeIds)
    : defaultStopWorkTypeIds.length
      ? defaultStopWorkTypeIds
      : explicitStopWorkTypeIds.length
        ? explicitStopWorkTypeIds
        : inferredStopWorkTypeIds;

  const debugContext = {
    serviceStopId: serviceStop?.id || "",
    serviceStopTypeId,
    serviceStopTypeName: serviceStopType?.name || serviceStop?.type || "",
    inferredServiceStopSourceId,
    hasSelectedStopWorkTypes,
    selectedStopWorkTypeIds: hasSelectedStopWorkTypes ? serviceStopWorkTypeIds : null,
    defaultStopWorkTypeIds,
    explicitStopWorkTypeIds,
    inferredStopWorkTypeIds,
    mappingCount: (mappings || []).length,
    workTypeCount: (workTypes || []).length,
    rateCount: (rates || []).length,
    taskCount: tasks.length,
  };

  console.debug("[PayEstimate][serviceStopWorkTypeResolution]", debugContext);

  if (
    effectiveSettings.routePaySource === "serviceStop" ||
    effectiveSettings.routePaySource === "serviceStopAndCompletedTasks"
  ) {
    if (!stopWorkTypeIds.length) {
      console.warn("[PayEstimate][missingServiceStopWorkType]", debugContext);

      lines.push({
        id: "estimate_stop_needs_review",
        source: "serviceStop",
        sourceTaskId: null,
        workTypeId: null,
        workTypeName: null,
        title: "Service Stop Pay",
        rateAmountCents: 0,
        rateType: "manual",
        quantity: 0,
        quantityUnit: "each",
        totalAmountCents: 0,
        calculationStatus: "needsReview",
        notes: `No service stop work type is connected. typeId: ${serviceStopTypeId || "blank"}, inferredSourceId: ${inferredServiceStopSourceId}.`,
      });
    } else if (!effectiveSettings.allowMultipleWorkTypesPerStop && stopWorkTypeIds.length > 1) {
      console.warn("[PayEstimate][multipleServiceStopWorkTypesBlocked]", {
        ...debugContext,
        stopWorkTypeIds,
      });

      lines.push({
        id: "estimate_stop_multiple_work_types_needs_review",
        source: "serviceStop",
        sourceTaskId: null,
        workTypeId: null,
        workTypeName: null,
        title: "Service Stop Pay",
        rateAmountCents: 0,
        rateType: "manual",
        quantity: 0,
        quantityUnit: "each",
        totalAmountCents: 0,
        calculationStatus: "needsReview",
        notes: "Multiple work types matched this service stop, but company settings do not allow multiple work types per stop.",
      });
    } else {
      stopWorkTypeIds.forEach((workTypeId) => {
        const workType = workTypesById[workTypeId];
        const primaryPayBasis = workTypeSuggestedPayBasis(workType);
        const fallbackPayBasis =
          primaryPayBasis === "serviceStop" || primaryPayBasis === "serviceStopTask"
            ? otherProductionPayBasis(primaryPayBasis)
            : "serviceStop";

        lines.push(
          lineFromRate({
            companyId,
            worker,
            source: "serviceStop",
            title: workTypeName(workTypesById, workTypeId),
            workTypeId,
            payBasis: primaryPayBasis,
            fallbackPayBasis,
            preferredRateType: workType?.defaultRateType,
            estimatedMinutes: tasks.reduce((sum, task) => sum + Number(task.estimatedTime || 0), 0),
            rates,
            workTypesById,
            date,
            allowGeneralHourlyFallback: true,
            debugContext,
          })
        );
      });
    }
  }

  if (effectiveSettings.taskPaySource !== "none") {
    tasks.forEach((task) => {
      const workTypeId = mappedWorkTypeIds({
        mappings,
        sourceType: "jobTaskType",
        sourceId: task.type || "",
      })[0];

      if (!workTypeId) {
        console.warn("[PayEstimate][missingTaskWorkTypeMapping]", {
          ...debugContext,
          taskId: task.id,
          taskType: task.type || "",
          taskName: task.name || task.description || "Task",
          sourceType: "jobTaskType",
          sourceId: task.type || "",
        });

        lines.push(
          missingTaskLine({
            task,
            notes: `No work type mapping found for task type ${task.type || "Unknown"}.`,
          })
        );
        return;
      }

      const preferredRateType = workTypesById[workTypeId]?.defaultRateType;
      const taskPaySource = effectiveSettings.taskPaySource;

      if (taskPaySource === "taskContractedRate") {
        if (cents(task.contractedRate) > 0) {
          lines.push(lineFromTaskContractedRate({ task, workTypeId, workTypesById }));
        }
        return;
      }

      if (taskPaySource === "taskContractedRateThenTechnicianRate" && cents(task.contractedRate) > 0) {
        lines.push(lineFromTaskContractedRate({ task, workTypeId, workTypesById }));
        return;
      }

      const payBasis =
        taskPaySource === "hourlyEstimatedTime" || taskPaySource === "hourlyActualTime"
          ? "technicianHourly"
          : "serviceStopTask";

      const rateLine = lineFromRate({
        companyId,
        worker,
        source: "serviceStopTask",
        sourceTaskId: task.id,
        title: task.name || task.description || "Task",
        workTypeId,
        payBasis,
        preferredRateType: payBasis === "technicianHourly" ? "hourly" : preferredRateType,
        estimatedMinutes: task.estimatedTime,
        rates,
        workTypesById,
        date,
        allowGeneralHourlyFallback: payBasis === "technicianHourly",
        debugContext: {
          ...debugContext,
          taskId: task.id,
          taskType: task.type || "",
        },
      });

      if (
        taskPaySource === "technicianRateThenTaskContractedRate" &&
        rateLine.calculationStatus !== "calculated" &&
        cents(task.contractedRate) > 0
      ) {
        lines.push(lineFromTaskContractedRate({ task, workTypeId, workTypesById }));
        return;
      }

      lines.push(rateLine);
    });
  }

  return lines;
};

export const estimateServiceStopPaySummary = (args) => {
  const lines = estimateServiceStopPay(args);
  return {
    lines,
    totalAmountCents: totalPayCents(lines),
    needsReview: lines.some((line) => line.calculationStatus === "needsReview"),
  };
};

export const estimatePlannedServiceStopPayRange = ({
  companyUsers = [],
  ...args
}) => {
  const summaries = companyUsers
    .map((worker) => ({
      worker,
      ...estimateServiceStopPaySummary({ ...args, worker }),
    }))
    .filter((summary) => userIdForRate(summary.worker));

  if (!summaries.length) {
    return {
      minAmountCents: 0,
      maxAmountCents: 0,
      highestWorkerName: "",
      summaries: [],
      needsReview: true,
    };
  }

  const totals = summaries.map((summary) => summary.totalAmountCents);
  const highest = summaries.reduce((current, summary) => {
    if (!current || summary.totalAmountCents > current.totalAmountCents) return summary;
    return current;
  }, null);

  return {
    minAmountCents: Math.min(...totals),
    maxAmountCents: Math.max(...totals),
    highestWorkerName: highest ? userNameForRate(highest.worker) : "",
    summaries,
    needsReview: summaries.some((summary) => summary.needsReview),
  };
};

export const formatPayRate = (line) => {
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents(line.rateAmountCents) / 100);

  switch (line.rateType) {
    case "hourly":
      return `${money}/hr`;
    case "flatPerStop":
      return `${money}/stop`;
    case "flatPerTask":
      return `${money}/task`;
    case "perBodyOfWater":
      return `${money}/body`;
    case "perServiceLocation":
      return `${money}/location`;
    case "percentage":
      return `${money} %`;
    default:
      return money;
  }
};
