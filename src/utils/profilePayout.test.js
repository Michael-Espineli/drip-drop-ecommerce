import { profilePayoutSummary } from "./profilePayout";

const now = new Date(2026, 10, 5, 12);
const item = (fields = {}) => ({ id: "work", completedDate: new Date(2026, 9, 31), totalAmountCents: 2500, calculationStatus: "calculated", ...fields });

test("keeps older unpaid work after a later payout, excluding paid and voided rows", () => {
  const result = profilePayoutSummary([
    item({ id: "old", completedDate: new Date(2026, 8, 1) }),
    item({ id: "approved", calculationStatus: "approved" }),
    item({ id: "adjusted", calculationStatus: "adjusted", totalAmountCents: -500 }),
    item({ id: "paid", calculationStatus: "paid", paidAt: now }),
    item({ id: "timestamp", paidAt: now }),
    item({ id: "voided", calculationStatus: "voided" }),
    item({ id: "voided-at", voidedAt: now }),
  ], [], now);
  expect(result).toMatchObject({ owedCents: 4500, paidCents: 5000, reviewCount: 0, lastPayoutLabel: "Today" });
  expect(result.unpaidItems.map(row => row.id)).toEqual(["adjusted", "approved", "old"]);
});

test("hides ordinary zero lines but keeps missing or pending pay separate from confirmed totals", () => {
  const result = profilePayoutSummary([
    ...["calculated", "approved", "adjusted", "paid"].map(calculationStatus => item({ id: calculationStatus, calculationStatus, totalAmountCents: 0 })),
    item({ id: "missing", calculationStatus: "needsReview", totalAmountCents: 0 }),
    item({ id: "pending", calculationStatus: "pending", totalAmountCents: 10000 }),
    item({ id: "real" }),
  ], [], now);
  expect(result).toMatchObject({ owedCents: 2500, paidCents: 0, reviewCount: 2 });
  expect(result.unpaidItems.map(row => row.id)).toEqual(["missing", "pending", "real"]);
  expect(result.unpaidItems[0].statusLabel).toBe("Pay needs review");
});

test("recognizes paid statement links and legacy line lists without inferring payment from dates", () => {
  const result = profilePayoutSummary([
    item({ id: "by-statement", payStatementId: "paid" }),
    item({ id: "by-list", calculationStatus: "needsReview" }),
    item({ id: "still-unpaid", payStatementId: "approved" }),
    item({ id: "void-link", payStatementId: "void" }),
  ], [
    { id: "paid", status: "paid", endDate: { toDate: () => now }, lineItemIds: ["by-list"] },
    { id: "approved", status: "approved", endDate: now },
    { id: "void", status: "voided", paidAt: now, lineItemIds: ["void-link"] },
  ], now);
  expect(result).toMatchObject({ owedCents: 5000, paidCents: 5000, reviewCount: 0, lastPayoutLabel: "Today" });
  expect(result.paidItems.map(row => row.id)).toEqual(["by-list", "by-statement"]);
});

test("shows work, customer, Firestore dates and hourly rate calculation in hours", () => {
  const result = profilePayoutSummary([item({
    completedDate: { toDate: () => now }, taskName: "Clean filter", payTypeName: "Maintenance", customerName: "Alex Rivera",
    rateType: "hourly", quantityUnit: "minutes", quantity: 90, rateAmountCents: 3000,
  })], [], now);
  expect(result.unpaidItems[0]).toMatchObject({ title: "Clean filter", customer: "Alex Rivera", completedDate: now, rateDescription: "1.5 hr × $30.00/hr" });
});

test("supports canonical/legacy work names, adjustments, percentage rates and malformed amounts", () => {
  const result = profilePayoutSummary([
    item({ id: "canonical", payTypeName: "Route" }),
    item({ id: "legacy", workTypeName: "Repair", customerName: " ", serviceLocationAddress: "123 Pool St" }),
    item({ id: "adjustment", source: "manualAdjustment", totalAmountCents: -500 }),
    item({ id: "percent", rateType: "percentage", rateAmountCents: 1500 }),
    item({ id: "custom", rateType: "manual" }),
    item({ id: "invalid", totalAmountCents: "bad" }),
  ], [], now);
  expect(result.unpaidItems).toHaveLength(5);
  expect(result.unpaidItems.find(row => row.id === "canonical").title).toBe("Route");
  expect(result.unpaidItems.find(row => row.id === "legacy")).toMatchObject({ title: "Repair", customer: "123 Pool St" });
  expect(result.unpaidItems.find(row => row.id === "adjustment").rateDescription).toBe("Pay adjustment");
  expect(result.unpaidItems.find(row => row.id === "percent").rateDescription).toBe("15% rate");
  expect(result.unpaidItems.find(row => row.id === "custom").rateDescription).toBe("Custom pay");
});

test("empty history and DST dates are explicit without claiming all completed work is paid", () => {
  expect(profilePayoutSummary([], [], now)).toMatchObject({ owedCents: 0, paidCents: 0, unpaidItems: [], paidItems: [], lastPayoutLabel: "None recorded", subtitle: "Recorded payroll · past 365 days" });
  expect(profilePayoutSummary([], [{ status: "paid", paidAt: new Date(2026, 10, 1, 0, 30) }], new Date(2026, 10, 2, 0, 30)).lastPayoutLabel).toBe("1 day ago");
});
