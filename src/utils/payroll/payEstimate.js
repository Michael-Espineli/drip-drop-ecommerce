import { normalizeWorkOfferIncentive } from "../workOffers";
import { calculatePayLines } from "./payCalculation";

const cents = (value) => Math.round(Number(value) || 0);
const userIdForRate = (worker) => worker?.userId || worker?.id || "";
const userNameForRate = (worker) => worker?.userName || worker?.displayName || worker?.name || [worker?.firstName, worker?.lastName].filter(Boolean).join(" ") || "Technician";
export const totalPayCents = (lines = []) => lines.reduce((total, line) => total + cents(line.totalAmountCents), 0);

const workOfferIncentiveLine = ({ serviceStop, basePayCents }) => {
  const offerLike = serviceStop?.workOfferIncentive
    ? { incentive: serviceStop.workOfferIncentive }
    : serviceStop;
  const incentive = normalizeWorkOfferIncentive(offerLike);
  const amountCents =
    incentive.type === "flat"
      ? incentive.amountCents
      : incentive.type === "percentage"
        ? Math.round(cents(basePayCents) * (incentive.percentage / 100))
        : 0;

  if (amountCents <= 0) return null;

  return {
    id: `estimate_work_offer_incentive_${serviceStop?.workOfferId || serviceStop?.id || "stop"}`,
    source: "workOfferIncentive",
    sourceTaskId: null,
    payTypeId: null,
    payTypeName: null,
    workTypeId: null,
    workTypeName: null,
    title: "Work Offer Incentive",
    rateAmountCents: amountCents,
    rateType: "manual",
    payBasis: "manualAdjustment",
    quantity: 1,
    quantityUnit: "each",
    totalAmountCents: amountCents,
    calculationStatus: "calculated",
    notes:
      incentive.notes ||
      (incentive.type === "percentage"
        ? `${incentive.percentage}% work offer incentive.`
        : "Flat-rate work offer incentive."),
  };
};

const withWorkOfferIncentiveLines = ({ serviceStop, lines }) => {
  const incentiveLine = workOfferIncentiveLine({
    serviceStop,
    basePayCents: totalPayCents(lines),
  });

  return incentiveLine ? [...lines, incentiveLine] : lines;
};


// The browser preview and server completion use the same calculation rules.
export const estimateServiceStopPay = ({ companyId, settings, serviceStop = {}, serviceStopType,
  serviceStopUseCaseSourceId = "", serviceStopWorkTypeIds = null, tasks = [], worker,
  workTypes = [], mappings = [], rates = [], date = new Date(), mode = "preview" }) => {
  const stop = serviceStop || {};
  // Accepted terms are private server data; use the authoritative projection on the stop.
  if (stop.workOfferId && stop.payrollAgreement && !Array.isArray(stop.payrollAgreement.rates) && Array.isArray(stop.estimatedPayLines)) return stop.estimatedPayLines;
  const mappedStop = mappings.find((mapping) => mapping.sourceType === "serviceStopType" &&
    [serviceStopType?.id, serviceStopUseCaseSourceId].includes(mapping.sourceId))?.workTypeId;
  const stopPayId = Array.isArray(serviceStopWorkTypeIds) ? serviceStopWorkTypeIds[0] || ""
    : stop.payTypeId || stop.payWorkTypeId || stop.workTypeId || serviceStopType?.payTypeId
      || (workTypes.some((type) => type.id === (serviceStopType?.id || stop.typeId)) ? serviceStopType?.id || stop.typeId : "")
      || serviceStopType?.defaultWorkTypeIds?.[0] || mappedStop || "";
  const selectedWorkerId = userIdForRate(worker);
  const lines = calculatePayLines({ companyId, settings: settings || {}, mode, date, workTypes, rates,
    workers: worker ? [{ ...worker, userId: selectedWorkerId, userName: userNameForRate(worker) }] : [],
    serviceStop: { ...stop, id: stop.id || "preview", payTypeId: stopPayId,
      type: stop.type || serviceStopType?.name || "Work pay", techId: selectedWorkerId || stop.techId || "",
      tech: worker ? userNameForRate(worker) : stop.tech || "", serviceDate: stop.serviceDate || date },
    tasks: tasks.map((task) => ({ ...task, payTypeId: task.payTypeId || task.payWorkTypeId || task.workTypeId ||
      mappings.find((mapping) => mapping.sourceType === "jobTaskType" && mapping.sourceId === task.type)?.workTypeId || "" })),
  });
  // Legacy offers retain their existing incentive preview.
  if (settings?.payrollEnabled === false || settings?.companyPayrollEnabled === false || settings?.payrollDisabled === true) return lines;
  return stop.payrollAgreement ? lines : withWorkOfferIncentiveLines({ serviceStop: stop, lines });
};

export const estimateServiceStopPaySummary = (args) => {
  const lines = estimateServiceStopPay(args);
  return { lines, totalAmountCents: totalPayCents(lines), needsReview: lines.some((line) => line.calculationStatus === "needsReview") };
};

export const estimatePlannedServiceStopPayRange = ({ companyUsers = [], ...args }) => {
  const eligible = companyUsers.filter((worker) => userIdForRate(worker) && worker.active !== false &&
    !["inactive", "archived", "deleted"].includes(String(worker.status || "").toLowerCase()));
  const summaries = eligible.map((worker) => ({ worker, ...estimateServiceStopPaySummary({ ...args, worker }) }));
  const complete = summaries.filter((summary) => !summary.needsReview);
  const highest = complete.reduce((current, summary) => !current || summary.totalAmountCents > current.totalAmountCents ? summary : current, null);
  return { minAmountCents: complete.length ? Math.min(...complete.map((summary) => summary.totalAmountCents)) : 0,
    maxAmountCents: highest?.totalAmountCents || 0, highestWorkerName: highest ? userNameForRate(highest.worker) : "",
    summaries, needsReview: !summaries.length || summaries.some((summary) => summary.needsReview) };
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
      return `${cents(line.rateAmountCents) / 100}%`;
    default:
      return money;
  }
};
