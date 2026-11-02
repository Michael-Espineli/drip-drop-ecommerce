import React from "react";
import { render, screen, within } from "@testing-library/react";
import { groupStatementLinesByDay } from "../../../utils/payroll/payStatementSummary";
import PayStatementDailySummary from "./PayStatementDailySummary";

test("daily pay uses local completion dates, sorts days, and includes deductions and legacy zeros", () => {
  const date = new Date(2026, 9, 27, 23, 30);
  const lines = [
    { completedDate: "2026-10-28", totalAmountCents: 8000 },
    { completedDate: { toDate: () => date }, totalAmountCents: 5000 },
    { completedDate: { seconds: date.getTime() / 1000 }, totalAmountCents: -500 },
    { completedDate: "2026-10-27", totalAmountCents: 0 },
    { completedDate: "invalid", totalAmountCents: 700 },
  ];
  const days = groupStatementLinesByDay(lines);
  expect(days.map(({ key, totalCents, lineCount }) => ({ key, totalCents, lineCount }))).toEqual([
    { key: "2026-10-27", totalCents: 4500, lineCount: 3 },
    { key: "2026-10-28", totalCents: 8000, lineCount: 1 },
    { key: "undated", totalCents: 700, lineCount: 1 },
  ]);
  render(<PayStatementDailySummary lines={lines} subtotalCents={13200} adjustmentCents={-1000} totalCents={12200} />);
  const sidebar = within(screen.getByRole("complementary", { name: "Pay by day" }));
  expect(sidebar.getByText("$45.00")).toBeInTheDocument();
  expect(sidebar.getByText("-$10.00")).toBeInTheDocument();
  expect(sidebar.getByText("Date unavailable")).toBeInTheDocument();
  expect(sidebar.getAllByText("$122.00")).toHaveLength(2);
});

test("daily totals stay pending while lines load and disclose incomplete statement data", () => {
  const props = { lines: [{ completedDate: "2026-10-28", totalAmountCents: 5000 }],
    subtotalCents: 12000, adjustmentCents: 0, totalCents: 12000, expectedLineCount: 2 };
  const { rerender } = render(<PayStatementDailySummary {...props} loading />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading daily breakdown");
  expect(screen.queryByText("$50.00")).not.toBeInTheDocument();
  rerender(<PayStatementDailySummary {...props} loading={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("Daily totals are incomplete");
  expect(screen.getByText("$50.00")).toBeInTheDocument();
  expect(screen.getAllByText("$120.00")).toHaveLength(3);
});
