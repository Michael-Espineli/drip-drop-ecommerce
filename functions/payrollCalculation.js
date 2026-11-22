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

const isTaskPayLine = (line = {}) => line.payrollSource !== "workOfferIncentive" &&
  (line.source === "serviceStopTask" || line.payrollSource === "jobTask" || Boolean(line.serviceStopTaskId || line.jobTaskId || line.sourceTaskId));
const canClearZeroTask = (line = {}) => isTaskPayLine(line) &&
  ["number", "string"].includes(typeof line.totalAmountCents) && text(line.totalAmountCents) !== "" &&
  Number.isFinite(Number(line.totalAmountCents)) && Number(line.totalAmountCents) === 0 &&
  !line.paidAt && !line.payStatementId && !line.exportBatchId &&
  ["pending", "calculated", "needsReview", "approved"].includes(line.calculationStatus);

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
    if (rate.technicianId !== technicianId || rate.active === false || rate.isActive === false) return false;
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

const suggestedBasis = (type = {}) => type.defaultRateType === "hourly" ? "technicianHourly" : "serviceStop";

const normalizePaySources = (settings = {}) => ({
  ...settings,
  routePaySource: {
    completedTasks: "serviceStop",
    serviceStopAndCompletedTasks: "serviceStop",
    hourlyTaskActualTime: "hourlyServiceStopDuration",
  }[settings.routePaySource] || settings.routePaySource || "serviceStop",
  hourlyPaySource: settings.hourlyPaySource === "taskActualTime" ? "serviceStopDuration" : settings.hourlyPaySource,
});

const explicitUnitQuantity = (record, body) => {
  const count = record[body ? "bodyOfWaterCount" : "serviceLocationCount"];
  if (present(count)) return Number(count);
  const ids = unique(Array.isArray(record[body ? "bodyOfWaterIds" : "serviceLocationIds"])
    ? record[body ? "bodyOfWaterIds" : "serviceLocationIds"] : []);
  if (ids.length) return ids.length;
  return id(record[body ? "bodyOfWaterId" : "serviceLocationId"]) ? 1 : null;
};

const calculatePayLines = ({ companyId, settings = {}, serviceStop = {}, tasks = [], workTypes = [], rates = [], workers = [],
  mode = "actual", date = new Date(), jobTaskSource = false, payHistory = [], bodyOfWaterIdsByServiceLocation = {} } = {}) => {
  if (jobTaskSource || !serviceStop.id || settings.payrollEnabled === false || settings.companyPayrollEnabled === false || settings.payrollDisabled === true) return [];
  if (mode !== "preview" && !finished({ status: serviceStop.operationStatus || serviceStop.status })) return [];

  const agreement = Array.isArray(serviceStop.payrollAgreement?.rates) ? serviceStop.payrollAgreement : null;
  const fixed = agreement && ["Offered Amount", "Unpaid", "Task Contracted Rates"].includes(agreement.paySource);
  if (agreement) {
    rates = agreement.rates;
    const acceptedTypes = new Map(workTypes.map(type => [type.id, type]));
    (agreement.workTypes || []).forEach(type => acceptedTypes.set(type.id, type));
    workTypes = [...acceptedTypes.values()];
    settings = { ...settings, ...agreement.settings };
  }
  settings = normalizePaySources(settings);
  const on = dateValue(serviceStop.serviceDate) || dateValue(date) || new Date();
  const types = new Map(workTypes.map(type => [type.id, type]));
  const stopPayId = payId(serviceStop) || (types.has(serviceStop.typeId) ? serviceStop.typeId : "")
    || (serviceStop.defaultWorkTypeIds || [])[0] || "";
  const custom = !fixed && (hasCustomPay(serviceStop) || serviceStop.payrollMode === "custom");
  const stopSource = settings.payMode === "hourlyOnly"
    ? settings.hourlyPaySource === "serviceStopDuration" ? "hourlyServiceStopDuration" : "none"
    : settings.routePaySource;
  const workerId = text(serviceStop.techId || serviceStop.technicianId);
  const worker = workers.find(value => (value.userId || value.id) === workerId) || {};
  const record = serviceStop;
  const build = (source, allowZeroLine = false) => {
    const type = types.get(stopPayId);
    const line = {
      id: ["comp_pay_line", source, serviceStop.id, "no_task", "no_route", "no_route_log", workerId || "no_technician", stopPayId || "no_work_type"].join("_"),
      companyId, technicianId: workerId, technicianName: worker.userName || worker.name || serviceStop.tech || "Technician not assigned",
      workerType: worker.workerType || "Not Assigned", source,
      workOfferId: agreement?.offerId || null, workOfferClaimId: agreement?.claimId || null, workOfferRevision: agreement?.revision || null,
      payrollSource: source, serviceStopId: serviceStop.id, serviceStopTaskId: null,
      sourceTaskId: null, jobTaskId: null, payrollComponentId: `stop:${serviceStop.id}:base`,
      activeRouteId: null, activeRouteLogId: null,
      payTypeId: stopPayId || null, payTypeName: type?.name || record.payTypeName || null,
      workTypeId: stopPayId || null, workTypeName: type?.name || record.payTypeName || null,
      title: type?.name || serviceStop.type || "Work pay", displayTitle: type?.name || serviceStop.type || "Work pay",
      displaySubtitle: serviceStop.customerName || null, taskName: null,
      jobId: id(serviceStop.jobId) || null, jobInternalId: serviceStop.jobName || serviceStop.jobInternalId || null,
      customerId: serviceStop.customerId || null, customerName: serviceStop.customerName || null,
      serviceLocationId: serviceStop.serviceLocationId || null, serviceLocationAddress: serviceStop.address?.streetAddress || null,
      serviceStopTypeName: serviceStop.type || null, serviceStopCategory: serviceStop.category || (serviceStop.jobId ? "Job" : "Route"),
      completedDate: dateValue(record.completedAt || record.finishedAt || record.endTime) || on, calculatedAt: new Date(),
      rateId: null, rateAmountCents: 0, rateType: "manual", payBasis: "serviceStop",
      quantity: 1, quantityUnit: "each", totalAmountCents: 0, calculationStatus: "calculated", notes: null,
      approvedAt: null, approvedByUserId: null, paidAt: null, paidByUserId: null, voidedAt: null, voidedByUserId: null,
      voidReason: null, payStatementId: null, exportBatchId: null, adminReviewNotes: null,
      payrollMode: record.payrollMode || "automatic",
      payrollStackBehavior: record.payrollStackBehavior || type?.defaultStackBehavior || settings.defaultStackBehavior || "stackable",
      additionalPayExplicit: record.payrollStackBehavior === "stackable",
    };
    const review = (message) => ({ ...line, calculationStatus: "needsReview", notes: message });
    if (!allowZeroLine && (record.payrollMode === "included" || record.payrollMode === "unpaid") && !fixed) return null;
    if (!allowZeroLine && (fixed ? agreement.paySource === "Unpaid" : hasCustomPay(record) && Number(record.manualPayOverrideCents) === 0)) return null;
    if (!workerId) return review("Assign a technician before calculating pay.");
    if (agreement && agreement.workerId !== workerId) return review("The assignment changed after this work offer was accepted. Review the agreed pay.");
    if (allowZeroLine) return line;
    if (fixed) {
      if (mode !== "preview" && agreement.completionReady === false) return null;
      const value = amount(agreement.fixedAmountCents);
      if (value <= 0) return null;
      return { ...line, payrollMode: "custom", rateAmountCents: value, totalAmountCents: value,
        notes: "Fixed pay accepted for this work offer." };
    }
    if (hasCustomPay(record)) {
      if (!Number.isFinite(Number(record.manualPayOverrideCents)) || Number(record.manualPayOverrideCents) < 0) return review("Custom pay must be a non-negative amount.");
      if (!allowZeroLine && amount(record.manualPayOverrideCents) === 0) return null;
      return { ...line, payrollMode: "custom", rateAmountCents: amount(record.manualPayOverrideCents), totalAmountCents: amount(record.manualPayOverrideCents),
        payBasis: "manualAdjustment", notes: record.manualPayOverrideNotes || "Custom pay replaces automatic pay for this work." };
    }
    if (record.payrollMode === "custom") return review("Enter the custom pay amount.");
    const hourly = stopSource === "hourlyServiceStopDuration" || type?.defaultRateType === "hourly";
    if (!hourly && (!stopPayId || !type)) return review("Select an active payroll pay item for this service stop.");
    if (type?.isActive === false || type?.active === false || type?.archived === true) return review("The selected payroll pay item is inactive.");
    const basis = hourly ? "technicianHourly" : "serviceStop";
    const stopRates = rates.filter(candidate => candidate.rateType !== "flatPerTask");
    const rateArgs = { companyId, technicianId: workerId, workTypeId: stopPayId,
      rates: stopRates, date: dateValue(agreement?.rateDate || agreement?.acceptedAt) || on,
      hourlyFallback: hourly };
    const rate = selectPayRate({ ...rateArgs, basis });
    if (!rate) return review("No active technician rate matches this pay item and pay basis on the work date.");
    if (present(rate.amountCents) && Number(rate.amountCents) === 0) return null;
    if (amount(rate.amountCents) <= 0) return review("The technician rate has no positive amount. Use explicit unpaid work for no pay.");
    line.rateId = rate.id; line.rateAmountCents = amount(rate.amountCents); line.rateType = rate.rateType; line.payBasis = basis;
    if (rate.rateType === "hourly") {
      const estimated = serviceStop.estimatedMinutes ?? serviceStop.estimatedDuration ?? serviceStop.duration;
      line.quantity = Number(mode === "preview" ? estimated : serviceStop.duration);
      line.quantityUnit = "minutes";
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return review("Record work minutes before calculating hourly pay.");
      line.totalAmountCents = Math.round(line.rateAmountCents * line.quantity / 60);
    } else if (rate.rateType === "perBodyOfWater" || rate.rateType === "perServiceLocation") {
      const body = rate.rateType === "perBodyOfWater";
      const locationId = id(record.serviceLocationId || serviceStop.serviceLocationId);
      let quantity = explicitUnitQuantity(record, body);
      if (quantity === null && body && Object.prototype.hasOwnProperty.call(bodyOfWaterIdsByServiceLocation, locationId)) {
        quantity = unique(bodyOfWaterIdsByServiceLocation[locationId]).length;
      }
      // Compatibility for legacy work with BOW links but no resolvable location.
      if (quantity === null) quantity = unique(tasks.flatMap(work => [
        ...(Array.isArray(work[body ? "bodyOfWaterIds" : "serviceLocationIds"]) ? work[body ? "bodyOfWaterIds" : "serviceLocationIds"] : []),
        work[body ? "bodyOfWaterId" : "serviceLocationId"],
      ])).length;
      line.quantity = quantity ?? 0;
      line.quantityUnit = body ? "bodyOfWater" : "serviceLocation";
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) return review("Specify a positive whole number of payable bodies of water or locations.");
      line.totalAmountCents = Math.round(line.rateAmountCents * line.quantity);
    } else if (rate.rateType === "percentage") {
      const base = record.payrollBaseAmountCents ?? serviceStop.payrollBaseAmountCents;
      if (!present(base) || !Number.isFinite(Number(base)) || Number(base) < 0) return review("Percentage pay requires an explicit non-negative base amount.");
      line.quantityUnit = "percent"; line.quantity = line.rateAmountCents / 100;
      line.totalAmountCents = Math.round(amount(base) * line.quantity / 100);
    } else {
      line.quantity = 1;
      line.totalAmountCents = Math.round(line.rateAmountCents * line.quantity);
    }
    return !allowZeroLine && line.totalAmountCents === 0 ? null : line;
  };
  const baseLine = custom || fixed ? build(custom ? "manualAdjustment" : "serviceStop")
    : stopSource !== "none" ? build("serviceStop") : null;
  const lines = baseLine ? [baseLine] : [];
  if (!agreement || (mode !== "preview" && agreement.incentiveReady === false)
      || (agreement.incentivePaymentStopId && agreement.incentivePaymentStopId !== serviceStop.id)) return lines;

  const base = (baseLine?.calculationStatus === "calculated" ? baseLine.totalAmountCents : 0)
    + payHistory.filter(line => line.workOfferId === agreement.offerId && (!line.workOfferClaimId || line.workOfferClaimId === agreement.claimId)
      && line.technicianId === workerId && line.payrollSource !== "workOfferIncentive" && !isTaskPayLine(line)
      && !["voided", "needsReview"].includes(line.calculationStatus) && line.serviceStopId !== serviceStop.id)
      .reduce((sum, line) => sum + line.totalAmountCents, 0);
  const value = agreement.incentive?.type === "percentage" ? Math.round(base * Number(agreement.incentive.percentage || 0) / 100)
    : agreement.incentive?.type === "flat" ? amount(agreement.flatIncentiveClaimCents ?? agreement.incentive.amountCents) : 0;
  if (value <= 0 || agreement.workerId !== workerId) return lines;
  const template = baseLine || build("manualAdjustment", true);
  return [...lines, {
    ...template,
    id: "comp_pay_offer_incentive_" + agreement.offerId + "_" + (agreement.claimId || workerId),
    payrollComponentId: "offer:" + agreement.offerId + ":claim:" + (agreement.claimId || workerId) + ":incentive",
    source: "manualAdjustment", payrollSource: "workOfferIncentive", payrollMode: "incentive",
    rateId: null, rateType: "manual", rateAmountCents: value, quantity: 1, quantityUnit: "each",
    totalAmountCents: value, calculationStatus: "calculated", additionalPayExplicit: true,
    payrollStackBehavior: "stackable", notes: agreement.incentive.notes || "Accepted work offer incentive.",
  }];
};

const reconcilePayLines = ({ generated = [], existing = [], relatedTaskHistory = [], now = new Date(), voidReason = "serviceStopReopened", preserveCalculated = false } = {}) => {
  const component = (line) => line.payrollComponentId || (line.jobId && line.jobTaskId ? `job:${id(line.jobId)}:task:${line.jobTaskId}`
    : line.serviceStopTaskId ? `stop:${line.serviceStopId}:task:${line.serviceStopTaskId}` : `stop:${line.serviceStopId}:base`);
  const protectedLine = (line) => Boolean(line.paidAt || line.approvedAt || line.payStatementId || line.exportBatchId
    || ["paid", "approved", "adjusted"].includes(line.calculationStatus)
    || line.calculationStatus === "voided" && !line.autoReconciled && ["adminVoided", "duplicate"].includes(line.voidReason));
  const frozen = (line) => preserveCalculated && !isTaskPayLine(line) && ["pending", "calculated"].includes(line.calculationStatus);
  const locked = existing.filter((line) => protectedLine(line) || frozen(line));
  const conflicts = [];
  const writes = [];
  const desiredIds = new Set();
  generated.forEach((line) => {
    // Guard the persistence boundary too: time/other generators can bypass build().
    // Missing setup remains a review record, not a calculated zero-dollar earning.
    if (isTaskPayLine(line) || (line.calculationStatus !== "needsReview" && Number(line.totalAmountCents) === 0)) return;
    const previous = locked.find((old) => !isTaskPayLine(old) && (old.id === line.id || component(old) === component(line)
      || line.payrollMode !== "incentive" && old.payrollMode !== "incentive" && (!desiredIds.has(old.id) || old.source === "manualAdjustment") && old.serviceStopId && old.serviceStopId === line.serviceStopId && (old.source === "manualAdjustment" && old.technicianId === line.technicianId
        || old.source === "serviceStop" && old.payTypeId === line.payTypeId && !line.additionalPayExplicit)));
    if (previous) {
      desiredIds.add(previous.id);
      if (!frozen(previous) && (previous.technicianId !== line.technicianId || previous.totalAmountCents !== line.totalAmountCents || previous.payTypeId !== line.payTypeId)) conflicts.push(previous.id);
      return;
    }
    // A previously finalized task earning may have represented the original visit payment.
    // Hold a newly introduced visit component for review when that history exists.
    const historicalTask = line.serviceStopId && line.payrollComponentId === `stop:${line.serviceStopId}:base`
      && !existing.some(old => !isTaskPayLine(old) && component(old) === component(line))
      && (locked.find(old => old.serviceStopId === line.serviceStopId && isTaskPayLine(old) && old.calculationStatus !== "voided")
        || relatedTaskHistory.find(old => old.calculationStatus !== "voided" && protectedLine(old)));
    if (historicalTask) {
      conflicts.push(historicalTask.id);
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
    writes.push({ ...line, calculationStatus: "voided", voidedAt: now, voidReason: isTaskPayLine(line) ? "taskPayRetired" : voidReason,
      autoReconciled: true, notes: "Automatic payroll superseded after the work, assignment, or pay setup changed." });
  });
  return { writes, conflicts: unique(conflicts) };
};

module.exports = { jobPayFields, selectPayRate, suggestedBasis, normalizePaySources, calculatePayLines, reconcilePayLines, isTaskPayLine, canClearZeroTask };
