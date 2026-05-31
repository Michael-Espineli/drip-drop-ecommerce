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

const normalizeSettings = (settings = {}) => ({
  routePaySource: settings.routePaySource || "serviceStopAndCompletedTasks",
  taskPaySource: settings.taskPaySource || "technicianRateThenTaskContractedRate",
});

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
}) => {
  const candidates = (rates || [])
    .filter((rate) => {
      if (rate.companyId && rate.companyId !== companyId) return false;
      if (rate.technicianId !== technicianId) return false;
      if (rate.payBasis !== payBasis) return false;
      if ((rate.workTypeId || "") !== (workTypeId || "")) return false;
      return rateIsCurrent(rate, date);
    })
    .sort((a, b) => {
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
}) => {
  const rate = activeRate({
    companyId,
    technicianId: userIdForRate(worker),
    workTypeId,
    payBasis,
    preferredRateType,
    rates,
    date,
  });

  if (!rate) {
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
      notes: `No active technician rate found for ${userNameForRate(worker)}.`,
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
    quantity,
    quantityUnit,
    totalAmountCents: calculateTotalAmountCents({
      rateAmountCents: rate.amountCents,
      rateType: rate.rateType,
      quantity,
      quantityUnit,
    }),
    calculationStatus: rate.rateType === "percentage" ? "needsReview" : "calculated",
    notes: "Estimated from technician rate.",
  };
};

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
  serviceStopType,
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

  if (!worker || !userIdForRate(worker)) {
    return tasks.map((task) =>
      missingTaskLine({ task, notes: "Select a technician to estimate technician-rate pay." })
    );
  }

  const stopWorkTypeIds = uniqueIds([
    ...(serviceStopType?.defaultWorkTypeIds || []),
    ...mappedWorkTypeIds({
      mappings,
      sourceType: "serviceStopType",
      sourceId: serviceStopType?.id || "",
    }),
  ]);

  if (
    effectiveSettings.routePaySource === "serviceStop" ||
    effectiveSettings.routePaySource === "serviceStopAndCompletedTasks"
  ) {
    if (!stopWorkTypeIds.length) {
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
        notes: "No service stop work type is connected to this service stop type.",
      });
    } else {
      stopWorkTypeIds.forEach((workTypeId) => {
        lines.push(
          lineFromRate({
            companyId,
            worker,
            source: "serviceStop",
            title: workTypeName(workTypesById, workTypeId),
            workTypeId,
            payBasis: "serviceStop",
            preferredRateType: workTypesById[workTypeId]?.defaultRateType,
            estimatedMinutes: tasks.reduce((sum, task) => sum + Number(task.estimatedTime || 0), 0),
            rates,
            workTypesById,
            date,
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
