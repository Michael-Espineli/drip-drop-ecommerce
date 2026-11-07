const asDate = (value) => {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (cents) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const text = (...values) => values.find(value => typeof value === "string" && value.trim())?.trim() || "";

function rateDescription(item) {
  const hourly = item.rateType === "hourly";
  const quantity = amount(item.quantity) / (hourly && item.quantityUnit === "minutes" ? 60 : 1);
  const rate = amount(item.rateAmountCents);
  if (item.source === "manualAdjustment") return "Pay adjustment";
  if (item.rateType === "manual") return "Custom pay";
  if (item.rateType === "percentage") return `${(rate / 100).toLocaleString()}% rate`;
  if (!quantity || !rate) return "";
  const units = { each: "", hours: "hr", minutes: "min", bodyOfWater: "pool/spa", serviceLocation: "location" };
  const unit = hourly && item.quantityUnit === "minutes" ? "hr" : units[item.quantityUnit] ?? "";
  return `${quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""} × ${money(rate)}${item.rateType === "hourly" ? "/hr" : ""}`;
}

// Read-only presentation of the existing 365-day payroll window, shared with iOS.
export function profilePayoutSummary(lineItems = [], statements = [], now = new Date()) {
  const paidStatements = statements.filter(statement => statement.status !== "voided" && (statement.status === "paid" || statement.paidAt));
  const paidStatementIds = new Set(paidStatements.map(statement => statement.id).filter(Boolean));
  const paidLineIds = new Set(paidStatements.flatMap(statement => statement.lineItemIds || []));
  const dates = [
    ...lineItems.filter(item => !item.voidedAt && item.calculationStatus !== "voided").map(item => asDate(item.paidAt)),
    ...paidStatements.map(statement => asDate(statement.paidAt) || asDate(statement.endDate)),
  ].filter(Boolean);
  const lastPayoutDate = dates.length ? new Date(Math.max(...dates.map(Number))) : null;
  const items = lineItems.filter(item => !item.voidedAt && ["pending", "calculated", "needsReview", "approved", "adjusted", "paid"].includes(item.calculationStatus)).map(item => {
    const isPaid = Boolean(item.paidAt) || item.calculationStatus === "paid" || paidStatementIds.has(item.payStatementId) || paidLineIds.has(item.id);
    const needsReview = !isPaid && ["pending", "needsReview"].includes(item.calculationStatus);
    return {
      id: item.id,
      title: text(item.taskName, item.payTypeName, item.workTypeName, item.serviceStopTypeName, item.displayTitle) || "Completed work",
      customer: text(item.customerName, item.serviceLocationAddress, item.displaySubtitle),
      completedDate: asDate(item.completedDate),
      paidDate: asDate(item.paidAt),
      amountCents: amount(item.totalAmountCents),
      rateDescription: rateDescription(item),
      isPaid,
      needsReview,
      statusLabel: isPaid ? "Marked paid" : needsReview ? "Pay needs review" : item.calculationStatus === "approved" ? "Approved · unpaid" : "Unpaid",
    };
  }).filter(item => item.amountCents !== 0 || item.needsReview)
    .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || (b.completedDate?.getTime() || 0) - (a.completedDate?.getTime() || 0) || a.id.localeCompare(b.id));
  const unpaidItems = items.filter(item => !item.isPaid);
  const paidItems = items.filter(item => item.isPaid);
  const reviewCount = unpaidItems.filter(item => item.needsReview).length;
  let lastPayoutLabel = "None recorded";
  if (lastPayoutDate) {
    const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.max(0, Math.round((calendarDay(now) - calendarDay(lastPayoutDate)) / 86400000));
    lastPayoutLabel = days === 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago`;
  }
  return {
    owedCents: unpaidItems.filter(item => !item.needsReview).reduce((total, item) => total + item.amountCents, 0),
    paidCents: paidItems.reduce((total, item) => total + item.amountCents, 0),
    unpaidItems, paidItems, reviewCount, lastPayoutDate, lastPayoutLabel,
    subtitle: "Recorded payroll · past 365 days",
  };
}
