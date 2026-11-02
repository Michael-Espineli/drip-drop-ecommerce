const asDate = (value) => {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

// Keep the profile snapshot aligned with the native profile's existing payout window.
export function profilePayoutSummary(lineItems = [], statements = [], now = new Date()) {
  const dates = [
    ...lineItems.map((item) => asDate(item.paidAt)),
    ...statements.map((statement) => asDate(statement.paidAt) || (statement.status === "paid" ? asDate(statement.endDate) : null)),
  ].filter(Boolean);
  const lastPayoutDate = dates.length ? new Date(Math.max(...dates.map(Number))) : null;
  const owed = lineItems.filter((item) =>
    !item.voidedAt && !item.paidAt &&
    ["pending", "calculated", "needsReview", "approved", "adjusted"].includes(item.calculationStatus) &&
    (!lastPayoutDate || asDate(item.completedDate) >= lastPayoutDate)
  );
  const workDates = owed.map((item) => asDate(item.completedDate)).filter(Boolean);
  const oldestWorkDate = workDates.length ? new Date(Math.min(...workDates.map(Number))) : null;
  let lastPayoutLabel = "None";
  if (lastPayoutDate) {
    // Calendar days, including daylight-saving transitions.
    const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.max(0, Math.round((calendarDay(now) - calendarDay(lastPayoutDate)) / 86400000));
    lastPayoutLabel = days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
  }
  return {
    owedCents: owed.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0),
    workDone: owed.length,
    lastPayoutLabel,
    subtitle: oldestWorkDate ? `Unpaid work since ${oldestWorkDate.toLocaleDateString()}`
      : lastPayoutDate ? "No unpaid work since the last payout." : "No payout history found.",
  };
}
