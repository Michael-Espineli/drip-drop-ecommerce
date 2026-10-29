// Shared with src/utils/payroll/payCalculation.js; parity is verified by payrollCalculation.test.js.
const text = (value) => String(value ?? "").trim();
const amount = (value) => Math.round(Number(value) || 0);
const id = (value) => text(typeof value === "object" ? value?.id : value);
const unique = (values = []) => [...new Set(values.map(id).filter(Boolean))];
const dateValue = (value) => {
  if (!value) return null;
  const date = value?.toDate?.() || (typeof value === "object" && (value.seconds ?? value._seconds) !== undefined
    ? new Date((value.seconds ?? value._seconds) * 1000) : new Date(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const finished = (record) => ["finished", "completed", "complete", "done"].includes(text(record?.status || record?.operationStatus).toLowerCase());
const present = (value) => value !== undefined && value !== null && value !== "";
const payId = (record = {}) => text(record.payTypeId || record.payWorkTypeId || record.workTypeId);
const hasCustomPay = (record) => record.payrollMode !== "automatic" && present(record.manualPayOverrideCents);

const jobPayFields = (record = {}, parent = {}) => {
  const parentPayId = payId(parent) || (["serviceStopType", "workType"].includes(parent.sourceType) ? text(parent.sourceId) : "");
  const selectedId = payId(record) || (["serviceStopType", "workType"].includes(record.sourceType) ? text(record.sourceId) : "") || parentPayId;
  const mode = record.payrollMode || record.metadata?.payrollMode || (present(record.manualPayOverrideCents) ? "custom" : parent.payrollMode || parent.metadata?.payrollMode || "automatic");
  return {
    payTypeId: selectedId,
    payTypeName: record.payTypeName || record.payWorkTypeName || record.workTypeName || (selectedId === parentPayId ? parent.payTypeName || parent.name || "" : ""),
    payrollMode: mode,
    manualPayOverrideCents: mode === "custom" && present(record.manualPayOverrideCents) ? amount(record.manualPayOverrideCents) : null,
    manualPayOverrideNotes: mode === "custom" ? record.manualPayOverrideNotes || "" : "",
    payrollStackBehavior: record.payrollStackBehavior || null,
    payQuantity: present(record.payQuantity) ? Number(record.payQuantity) : 1,
  };
};

const selectPayRate = ({ companyId, technicianId, workTypeId, basis, rates = [], date = new Date(), hourlyFallback = false }) => {
  const on = dateValue(date) || new Date();
  const candidates = rates.filter((rate) => {
    if (rate.companyId && rate.companyId !== companyId) return false;
    if (rate.technicianId !== technicianId) return false;
    if (["draft", "archived", "inactive", "deleted"].includes(text(rate.status).toLowerCase())) return false;
    const start = dateValue(rate.effectiveStartDate), end = dateValue(rate.effectiveEndDate);
    if (start && start > on || end && end < on) return false;
    if (text(rate.status).toLowerCase() === "expired" && !end) return false;
    if (rate.payBasis !== basis && !(hourlyFallback && rate.payBasis === "technicianHourly" && rate.rateType === "hourly")) return false;
    return payId(rate) === (workTypeId || "") || hourlyFallback && !payId(rate) && rate.rateType === "hourly";
  });
  return candidates.sort((a, b) => Number(Boolean(payId(b))) - Number(Boolean(payId(a)))
    || Number(b.payBasis === basis) - Number(a.payBasis === basis)
    || (dateValue(b.effectiveStartDate)?.getTime() || 0) - (dateValue(a.effectiveStartDate)?.getTime() || 0)
    || text(a.id).localeCompare(text(b.id)))[0] || null;
};

const suggestedBasis = (type = {}) => type.defaultRateType === "hourly" ? "technicianHourly"
  : ["route", "maintenance", "serviceCall", "commercial", "startup", "estimate"].includes(type.category) ? "serviceStop" : "serviceStopTask";

const calculatePayLines = ({ companyId, settings = {}, serviceStop = {}, tasks = [], workTypes = [], rates = [], workers = [],
  mode = "actual", date = new Date(), jobTaskSource = false, payHistory = [] } = {}) => {
  if (settings.payrollEnabled === false || settings.companyPayrollEnabled === false || settings.payrollDisabled === true) return [];
  const visitAgreement = Array.isArray(serviceStop.payrollAgreement?.rates) ? serviceStop.payrollAgreement : null;
  if (visitAgreement) {
    rates = [...rates.filter(rate => rate.technicianId !== visitAgreement.workerId), ...(visitAgreement.rates || [])];
    const acceptedTypes = new Map(workTypes.map(type => [type.id, type]));
    (visitAgreement.workTypes || []).forEach(type => acceptedTypes.set(type.id, type));
    workTypes = [...acceptedTypes.values()];
    settings = { ...settings, ...visitAgreement.settings };
    if (["Offered Amount", "Unpaid"].includes(visitAgreement.paySource)) {
      serviceStop = { ...serviceStop, payrollMode: "automatic", manualPayOverrideCents: null };
      settings = { ...settings, payMode: "productionOnly", routePaySource: (visitAgreement.taskIds || []).length ? "completedTasks" : "serviceStop", taskPaySource: (visitAgreement.taskIds || []).length ? "technicianRate" : "none" };
    }
  }
  const stopFinished = mode === "preview" || finished(serviceStop);
  const types = new Map(workTypes.map((type) => [type.id, type]));
  const workersById = new Map(workers.map((worker) => [worker.userId || worker.id, worker]));
  const routeSource = settings.routePaySource || "serviceStopAndCompletedTasks";
  let taskSource = routeSource === "hourlyTaskActualTime" ? "hourlyActualTime" : settings.taskPaySource || "technicianRateThenTaskContractedRate";
  let stopSource = routeSource;
  if (settings.payMode === "hourlyOnly") {
    if (["workLogs", "activeRouteDuration", "activeRouteLogs"].includes(settings.hourlyPaySource) && !visitAgreement && !tasks.some(task=>Array.isArray(task.payrollAgreement?.rates))) return [];
    stopSource = settings.hourlyPaySource === "serviceStopDuration" ? "hourlyServiceStopDuration" : "none";
    taskSource = settings.hourlyPaySource === "taskActualTime" ? "hourlyActualTime" : "none";
  }
  const on = dateValue(serviceStop.serviceDate) || dateValue(date) || new Date();
  const now = new Date();
  const stopPayId = payId(serviceStop) || (types.has(serviceStop.typeId) ? serviceStop.typeId : "")
    || (serviceStop.defaultWorkTypeIds || [])[0] || "";
  const allTasks = mode === "preview" ? tasks : tasks.filter(finished);
  const lines = [];
  const build = (record, source, selectedPayId, sourceSetting) => {
    const task = source !== "serviceStop" && source !== "manualAdjustment" ? record : null;
    const workerId = text(task?.workerId || serviceStop.techId || serviceStop.technicianId);
    const worker = workersById.get(workerId) || {};
    const agreement = Array.isArray(task?.payrollAgreement?.rates) ? task.payrollAgreement : visitAgreement;
    if (["included", "unpaid"].includes(record.payrollMode) && !["Offered Amount", "Unpaid"].includes(agreement?.paySource)) return null;
    const agreedTaskId = id(task?.jobTaskId || task?.workOrderTaskId || task?.id);
    const agreedTaskIds = agreement?.taskIds || [];
    const acceptedTask = !task || agreedTaskIds.includes(agreedTaskId) || (agreement?.stopTasks || []).some(v=>v.taskId===task.id);
    const type = agreement?.workTypes?.find(type => type.id === selectedPayId) || types.get(selectedPayId);
    const jobId = id(serviceStop.jobId || task?.jobId);
    const jobTaskId = jobTaskSource ? id(task?.id) : id(task?.jobTaskId || task?.workOrderTaskId);
    const componentId = task ? jobId && jobTaskId ? `job:${jobId}:task:${jobTaskId}` : `stop:${serviceStop.id}:task:${task.id}`
      : `stop:${serviceStop.id}:base`;
    const line = {
      id: ["comp_pay_line", source, jobTaskSource ? `job_${jobId}` : serviceStop.id || "no_stop", task?.id || "no_task", "no_route", "no_route_log", workerId || "no_technician", selectedPayId || "no_work_type"].join("_"),
      companyId, technicianId: workerId, technicianName: task?.workerName || worker.userName || worker.name || serviceStop.tech || "Technician not assigned",
      workerType: worker.workerType || task?.workerType || "Not Assigned", source,
      workOfferId: agreement?.offerId || null, workOfferClaimId: agreement?.claimId || null, workOfferRevision: agreement?.revision || null,
      payrollSource: jobTaskSource ? "jobTask" : source,
      serviceStopId: jobTaskSource ? null : serviceStop.id || null, serviceStopTaskId: jobTaskSource ? null : task?.id || null,
      sourceTaskId: task?.id || null, jobTaskId: jobTaskId || null, payrollComponentId: componentId,
      activeRouteId: null, activeRouteLogId: null,
      payTypeId: selectedPayId || null, payTypeName: type?.name || record.payTypeName || null,
      workTypeId: selectedPayId || null, workTypeName: type?.name || record.payTypeName || null,
      title: task?.name || type?.name || serviceStop.type || "Work pay", displayTitle: task?.name || type?.name || serviceStop.type || "Work pay",
      displaySubtitle: serviceStop.customerName || null, taskName: task?.name || null,
      jobId: jobId || null, jobInternalId: serviceStop.jobName || serviceStop.jobInternalId || null,
      customerId: serviceStop.customerId || null, customerName: serviceStop.customerName || null,
      serviceLocationId: serviceStop.serviceLocationId || null, serviceLocationAddress: serviceStop.address?.streetAddress || null,
      serviceStopTypeName: serviceStop.type || null, serviceStopCategory: serviceStop.category || (jobId ? "Job" : "Route"),
      completedDate: dateValue(record.completedAt || record.finishedAt) || on, calculatedAt: now,
      rateId: null, rateAmountCents: 0, rateType: "manual", payBasis: task ? "serviceStopTask" : "serviceStop",
      quantity: 1, quantityUnit: "each", totalAmountCents: 0, calculationStatus: "calculated", notes: null,
      approvedAt: null, approvedByUserId: null, paidAt: null, paidByUserId: null, voidedAt: null, voidedByUserId: null,
      voidReason: null, payStatementId: null, exportBatchId: null, adminReviewNotes: null,
      payrollMode: record.payrollMode || "automatic",
      payrollStackBehavior: record.payrollStackBehavior || type?.defaultStackBehavior || settings.defaultStackBehavior || "stackable",
      additionalPayExplicit: record.payrollStackBehavior === "stackable",
    };
    const review = (message) => ({ ...line, calculationStatus: "needsReview", notes: message });
    if (!workerId) return review("Assign a technician before calculating pay.");
    if (agreement && acceptedTask && agreement.workerId !== workerId) return review("The assignment changed after this work offer was accepted. Review the agreed pay.");
    if (agreement && acceptedTask && ["Offered Amount", "Unpaid"].includes(agreement.paySource)) {
      if (mode !== "preview" && agreement.completionReady === false) return null;
      const index = task ? agreedTaskIds.indexOf(agreedTaskId) : 0;
      const count = task ? Math.max(agreedTaskIds.length, 1) : 1;
      const fixed = agreement.paySource === "Unpaid" ? 0 : amount(agreement.fixedAmountCents);
      const value = Math.floor(fixed / count) + (index < fixed % count ? 1 : 0);
      return { ...line, payrollMode: "custom", rateAmountCents: value, totalAmountCents: value,
        workOfferId: agreement.offerId, workOfferRevision: agreement.revision,
        notes: "Fixed pay accepted for this work offer." };
    }
    if (hasCustomPay(record)) {
      if (!Number.isFinite(Number(record.manualPayOverrideCents)) || Number(record.manualPayOverrideCents) < 0) return review("Custom pay must be a non-negative amount.");
      return { ...line, payrollMode: "custom", rateAmountCents: amount(record.manualPayOverrideCents), totalAmountCents: amount(record.manualPayOverrideCents),
        payBasis: "manualAdjustment", notes: record.manualPayOverrideNotes || "Custom pay replaces automatic pay for this work." };
    }
    if (record.payrollMode === "custom") return review("Enter the custom pay amount.");
    if (!selectedPayId || !type) return review("Select an active payroll pay item for this work.");
    if (type.isActive === false || type.active === false || type.archived === true) return review("The selected payroll pay item is inactive.");
    const hourly = ["hourlyActualTime", "hourlyEstimatedTime", "hourlyServiceStopDuration"].includes(sourceSetting);
    const basis = hourly || type.defaultRateType === "hourly" ? "technicianHourly" : task ? "serviceStopTask" : "serviceStop";
    const rateArgs = { companyId, technicianId: workerId, workTypeId: selectedPayId, rates: agreement && acceptedTask ? agreement.rates || rates : rates, date: agreement && acceptedTask ? dateValue(agreement.rateDate || agreement.acceptedAt) || on : on, hourlyFallback: basis === "technicianHourly" };
    let rate = selectPayRate({ ...rateArgs, basis });
    if (!rate && !task && ["serviceStop", "serviceStopTask"].includes(basis)) rate = selectPayRate({ ...rateArgs, basis: basis === "serviceStop" ? "serviceStopTask" : "serviceStop" });
    const contracted = amount(record.contractedRate);
    const useContract = task && (sourceSetting === "taskContractedRate" || sourceSetting === "taskContractedRateThenTechnicianRate" && contracted > 0
      || sourceSetting === "technicianRateThenTaskContractedRate" && !rate && contracted > 0);
    if (useContract) {
      if (contracted <= 0) return review("Enter a custom task amount or explicitly mark this work unpaid.");
      const quantity = Number(record.payQuantity ?? 1);
      if (!Number.isFinite(quantity) || quantity <= 0) return review("Specify a positive payroll quantity.");
      return { ...line, rateType: "flatPerTask", rateAmountCents: contracted, totalAmountCents: Math.round(contracted * quantity),
        quantity, notes: "Used the task contracted amount selected by company pay rules." };
    }
    if (!rate) return review("No active technician rate matches this pay item and pay basis on the work date.");
    if (amount(rate.amountCents) <= 0) return review("The technician rate has no positive amount. Use explicit unpaid work for no pay.");
    line.rateId = rate.id; line.rateAmountCents = amount(rate.amountCents); line.rateType = rate.rateType; line.payBasis = rate.payBasis;
    if (rate.rateType === "hourly") {
      const estimated = task ? record.estimatedTime ?? record.estimatedMinutes : serviceStop.estimatedMinutes ?? serviceStop.estimatedDuration ?? serviceStop.duration ?? tasks.reduce((sum, t) => sum + Number(t.estimatedTime || 0), 0);
      const actual = task ? record.actualTime : serviceStop.duration;
      line.quantity = Number(mode === "preview" || sourceSetting === "hourlyEstimatedTime" ? estimated : actual);
      line.quantityUnit = "minutes";
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return review("Record work minutes before calculating hourly pay.");
      line.totalAmountCents = Math.round(line.rateAmountCents * line.quantity / 60);
    } else if (rate.rateType === "perBodyOfWater" || rate.rateType === "perServiceLocation") {
      const body = rate.rateType === "perBodyOfWater";
      const knownIds = record[body ? "bodyOfWaterIds" : "serviceLocationIds"] || serviceStop[body ? "bodyOfWaterIds" : "serviceLocationIds"] || [];
      const ids = unique([...knownIds, ...(task ? [] : allTasks.map((work) => work[body ? "bodyOfWaterId" : "serviceLocationId"]))]);
      const count = record[body ? "bodyOfWaterCount" : "serviceLocationCount"] ?? serviceStop[body ? "bodyOfWaterCount" : "serviceLocationCount"];
      line.quantity = present(count) ? Number(count) : ids.length || (id(record[body ? "bodyOfWaterId" : "serviceLocationId"] || serviceStop[body ? "bodyOfWaterId" : "serviceLocationId"]) ? 1 : 0);
      line.quantityUnit = body ? "bodyOfWater" : "serviceLocation";
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return review("Specify the number of payable bodies of water or locations.");
      line.totalAmountCents = Math.round(line.rateAmountCents * line.quantity);
    } else if (rate.rateType === "percentage") {
      const base = record.payrollBaseAmountCents ?? serviceStop.payrollBaseAmountCents;
      if (!present(base) || !Number.isFinite(Number(base)) || Number(base) < 0) return review("Percentage pay requires an explicit non-negative base amount.");
      line.quantityUnit = "percent"; line.quantity = line.rateAmountCents / 100;
      line.totalAmountCents = Math.round(amount(base) * line.quantity / 100);
    } else {
      line.quantity = Number(record.payQuantity ?? 1);
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return review("Specify a positive payroll quantity.");
      line.totalAmountCents = Math.round(line.rateAmountCents * line.quantity);
    }
    return line;
  };
  const customVisit = !jobTaskSource && (hasCustomPay(serviceStop) || serviceStop.payrollMode === "custom");
  if (customVisit) {
    if (stopFinished) {
      const manual = build(serviceStop, "manualAdjustment", stopPayId, "custom");
      if (manual) lines.push(manual);
    }
  } else if (!jobTaskSource && stopFinished && ["serviceStop", "serviceStopAndCompletedTasks", "hourlyServiceStopDuration"].includes(stopSource)) {
    const stopLine = build(serviceStop, "serviceStop", stopPayId, stopSource);
    if (stopLine) lines.push(stopLine);
  }
  allTasks.forEach((task) => {
    if (visitAgreement && ["Offered Amount", "Unpaid"].includes(visitAgreement.paySource) && !(visitAgreement.taskIds || []).length && (visitAgreement.stopTasks || []).some(ref=>ref.taskId===task.id)) return;
    // A custom visit amount includes its technician's tasks. Other technicians
    // still earn their separately assigned work, as do explicitly additional tasks.
    if (customVisit && (!task.workerId || task.workerId === text(serviceStop.techId || serviceStop.technicianId)) && (["Offered Amount", "Unpaid"].includes(visitAgreement?.paySource) || task.payrollStackBehavior !== "stackable")) return;
    if (taskSource === "none" && task.payrollMode !== "custom" && !hasCustomPay(task) && !["Offered Amount", "Unpaid"].includes(task.payrollAgreement?.paySource)) return;
    const line = build(task, "serviceStopTask", payId(task), taskSource);
    if (line) lines.push(line);
  });
  if (settings.payMode === "hourlyOnly" && ["workLogs", "activeRouteDuration", "activeRouteLogs"].includes(settings.hourlyPaySource) && (visitAgreement || tasks.some(task=>Array.isArray(task.payrollAgreement?.rates))) && !lines.length) {
    for (const task of allTasks) {
      const line = build({ ...task, payrollMode: "custom", manualPayOverrideCents: 0 }, "serviceStopTask", payId(task), "custom");
      if (line) lines.push({ ...line, clockIncentiveOnly: true });
    }
    if (!allTasks.length && !(visitAgreement?.taskIds || []).length && stopFinished) {
      const line = build({ ...serviceStop, payrollMode: "custom", manualPayOverrideCents: 0 }, "manualAdjustment", stopPayId, "custom");
      if (line) lines.push({ ...line, clockIncentiveOnly: true });
    }
  }
  // Task-priced work performed during a visit is the same payment, unless an
  // additional task payment is explicitly selected. Different technicians retain their pay.
  let selected = lines.filter((line) => {
    if (line.source === "serviceStop") return !lines.some((taskLine) => taskLine.source !== "serviceStop"
      && taskLine.technicianId === line.technicianId && taskLine.payTypeId === line.payTypeId
      && !taskLine.additionalPayExplicit && suggestedBasis(types.get(line.payTypeId)) !== "serviceStop");
    return line.additionalPayExplicit || !lines.some((stopLine) => stopLine.source === "serviceStop"
      && stopLine.technicianId === line.technicianId && stopLine.payTypeId === line.payTypeId
      && suggestedBasis(types.get(line.payTypeId)) === "serviceStop");
  });
  selected = selected.filter((line) => line.source !== "serviceStop" || !selected.some((other) => other.source !== "serviceStop"
    && other.technicianId === line.technicianId && other.payrollStackBehavior === "replacesBase"));
  const exclusiveWorkers = unique(selected.filter((line) => line.payrollStackBehavior === "exclusive").map((line) => line.technicianId));
  exclusiveWorkers.forEach((workerId) => {
    const candidates = selected.filter((line) => line.technicianId === workerId && !line.additionalPayExplicit && line.calculationStatus !== "needsReview");
    const winner = candidates.sort((a, b) => b.totalAmountCents - a.totalAmountCents || a.id.localeCompare(b.id))[0];
    selected = selected.filter((line) => line.technicianId !== workerId || line.additionalPayExplicit || line.calculationStatus === "needsReview" || line === winner);
  });
  const bonusLines = [];
  const agreements = new Map();
  if (visitAgreement) agreements.set(visitAgreement.claimId || visitAgreement.offerId, visitAgreement);
  allTasks.forEach(task => { if (task.payrollAgreement?.rates) agreements.set(task.payrollAgreement.claimId || task.payrollAgreement.offerId, task.payrollAgreement); });
  agreements.forEach(agreement => {
    const ready = mode === "preview" || (agreement.incentiveReady ?? (agreement.taskIds?.length ? agreement.taskIds.every(value=>allTasks.some(task=>id(task.jobTaskId || task.id)===value && finished(task))) : stopFinished));
    if (!ready || agreement.incentivePaymentStopId && agreement.incentivePaymentStopId !== serviceStop.id || !agreement.incentivePaymentStopId && !jobTaskSource && mode !== "preview" && agreement.taskIds?.length) return;
    const currentIds = new Set(selected.map(line=>line.id));
    const base = selected.filter(line=>line.technicianId===agreement.workerId && line.calculationStatus!=="needsReview").reduce((sum,line)=>sum+line.totalAmountCents,0)
      + payHistory.filter(line=>line.workOfferId===agreement.offerId && (!line.workOfferClaimId || line.workOfferClaimId===agreement.claimId) && line.technicianId===agreement.workerId && line.payrollSource!=="workOfferIncentive" && !["voided","needsReview"].includes(line.calculationStatus) && !currentIds.has(line.id)).reduce((sum,line)=>sum+line.totalAmountCents,0);
    const value = agreement.incentive?.type === "percentage" ? Math.round(base * Number(agreement.incentive.percentage || 0) / 100)
      : agreement.incentive?.type === "flat" ? amount(agreement.flatIncentiveClaimCents ?? agreement.incentive.amountCents) : 0;
    if (value <= 0) return;
    const template = selected.find(line=>line.technicianId===agreement.workerId) || build({payrollMode:"custom",manualPayOverrideCents:0,workerId:agreement.workerId,workerName:agreement.workerName},"serviceStopTask",stopPayId,"custom");
    if (!template) return;
    bonusLines.push({...template,id:"comp_pay_offer_incentive_"+agreement.offerId+"_"+(agreement.claimId || agreement.workerId),payrollComponentId:"offer:"+agreement.offerId+":claim:"+(agreement.claimId || agreement.workerId)+":incentive",source:"manualAdjustment",payrollSource:"workOfferIncentive",payrollMode:"incentive",workOfferId:agreement.offerId,workOfferClaimId:agreement.claimId || null,jobTaskId:null,serviceStopTaskId:null,rateType:"manual",rateAmountCents:value,quantity:1,quantityUnit:"each",totalAmountCents:value,calculationStatus:"calculated",additionalPayExplicit:true,payrollStackBehavior:"stackable",notes:agreement.incentive.notes || "Accepted work offer incentive."});
  });
  return [...selected.filter(line => !line.clockIncentiveOnly), ...bonusLines];
};

const reconcilePayLines = ({ generated = [], existing = [], now = new Date(), voidReason = "serviceStopReopened", preserveCalculated = false } = {}) => {
  const component = (line) => line.payrollComponentId || (line.jobId && line.jobTaskId ? `job:${id(line.jobId)}:task:${line.jobTaskId}`
    : line.serviceStopTaskId ? `stop:${line.serviceStopId}:task:${line.serviceStopTaskId}` : `stop:${line.serviceStopId}:base`);
  const protectedLine = (line) => Boolean(line.paidAt || line.approvedAt || line.payStatementId || line.exportBatchId
    || ["paid", "approved", "adjusted"].includes(line.calculationStatus)
    || line.calculationStatus === "voided" && !line.autoReconciled && ["adminVoided", "duplicate"].includes(line.voidReason));
  const frozen = (line) => preserveCalculated && ["pending", "calculated"].includes(line.calculationStatus);
  const locked = existing.filter((line) => protectedLine(line) || frozen(line));
  const conflicts = [];
  const writes = [];
  const desiredIds = new Set();
  generated.forEach((line) => {
    const previous = locked.find((old) => old.id === line.id || component(old) === component(line)
      || line.payrollMode !== "incentive" && old.payrollMode !== "incentive" && (!desiredIds.has(old.id) || old.source === "manualAdjustment") && old.serviceStopId && old.serviceStopId === line.serviceStopId && (old.source === "manualAdjustment" && old.technicianId === line.technicianId
        || old.source === "serviceStop" && old.payTypeId === line.payTypeId && !line.additionalPayExplicit));
    if (previous) {
      desiredIds.add(previous.id);
      if (!frozen(previous) && (previous.technicianId !== line.technicianId || previous.totalAmountCents !== line.totalAmountCents || previous.payTypeId !== line.payTypeId)) conflicts.push(previous.id);
      return;
    }
    desiredIds.add(line.id);
    const old = existing.find((record) => record.id === line.id);
    writes.push({ ...line, autoReconciled: false, ...(old ? { lineNumber: old.lineNumber || null, lineReference: old.lineReference || null,
      adminReviewNotes: old.adminReviewNotes || null } : {}) });
  });
  existing.filter((line) => !desiredIds.has(line.id) && line.calculationStatus !== "voided").forEach((line) => {
    if (frozen(line)) return;
    if (protectedLine(line)) { conflicts.push(line.id); return; }
    writes.push({ ...line, calculationStatus: "voided", voidedAt: now, voidReason,
      autoReconciled: true, notes: "Automatic payroll superseded after the work, assignment, or pay setup changed." });
  });
  return { writes, conflicts: unique(conflicts) };
};

module.exports = { jobPayFields, selectPayRate, calculatePayLines, reconcilePayLines };
