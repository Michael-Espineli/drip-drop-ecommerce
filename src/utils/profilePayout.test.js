import { profilePayoutSummary } from "./profilePayout";

const now = new Date(2026, 10, 1, 12);
const item = (fields = {}) => ({ completedDate: new Date(2026, 9, 31), totalAmountCents: 2500, calculationStatus: "calculated", ...fields });

test("matches native owed statuses and excludes paid, voided, and pre-payout work", () => {
  const result = profilePayoutSummary([
    ...["pending", "calculated", "needsReview", "approved", "adjusted"].map(calculationStatus => item({ calculationStatus })),
    item({ calculationStatus: "paid" }), item({ calculationStatus: "voided" }),
    item({ paidAt: new Date(2026, 9, 30) }), item({ voidedAt: now }),
    item({ completedDate: new Date(2026, 9, 29) }),
  ], [], now);
  expect(result).toMatchObject({ owedCents: 12500, workDone: 5, lastPayoutLabel: "2 days" });
});

test("uses a legacy paid statement's end date and Firestore timestamps", () => {
  const result = profilePayoutSummary([item({ completedDate: { toDate: () => now } })], [
    { status: "paid", endDate: { toDate: () => new Date(2026, 9, 31) } },
    { status: "approved", endDate: now },
  ], now);
  expect(result).toMatchObject({ owedCents: 2500, workDone: 1, lastPayoutLabel: "1 day" });
});

test("represents empty history and zero-dollar work without inventing a payout", () => {
  expect(profilePayoutSummary([], [], now)).toMatchObject({ owedCents: 0, workDone: 0, lastPayoutLabel: "None", subtitle: "No payout history found." });
  expect(profilePayoutSummary([item({ totalAmountCents: 0 })], [], now)).toMatchObject({ owedCents: 0, workDone: 1 });
});

test("calendar-day labels survive daylight-saving transitions", () => {
  expect(profilePayoutSummary([], [{ paidAt: new Date(2026, 10, 1, 0, 30) }], new Date(2026, 10, 2, 0, 30)).lastPayoutLabel).toBe("1 day");
  expect(profilePayoutSummary([], [{ paidAt: now }], now).lastPayoutLabel).toBe("Today");
});
