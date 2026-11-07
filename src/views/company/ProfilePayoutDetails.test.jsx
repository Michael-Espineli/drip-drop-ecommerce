import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ProfilePayoutDetails from "./ProfilePayoutDetails";
import { profilePayoutSummary } from "../../utils/profilePayout";

const item = (id, fields = {}) => ({ id, taskName: `Work ${id}`, customerName: "Rivera Pool", completedDate: new Date(2026, 10, 1), totalAmountCents: 2500, calculationStatus: "calculated", ...fields });

test("shows meaningful work and pay while hiding zero lines and separating unresolved pay", () => {
  const summary = profilePayoutSummary([
    item("filter", { taskName: "Clean filter", quantity: 1, rateAmountCents: 2500 }),
    item("zero", { totalAmountCents: 0 }),
    item("missing", { totalAmountCents: 0, calculationStatus: "needsReview" }),
    item("paid", { calculationStatus: "paid" }),
  ]);
  render(<ProfilePayoutDetails summary={summary} loading={false} />);
  const unpaid = screen.getByRole("list", { name: "Unpaid work" });
  expect(within(unpaid).getByText("Clean filter")).toBeInTheDocument();
  expect(within(unpaid).getByText("1 × $25.00")).toBeInTheDocument();
  expect(within(unpaid).getAllByText(/Rivera Pool/)).toHaveLength(2);
  expect(within(unpaid).getByText("Pending")).toBeInTheDocument();
  expect(screen.queryByText("Work zero")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 pay item needs review");
  fireEvent.click(screen.getByRole("button", { name: "Paid (1)" }));
  expect(screen.getByRole("button", { name: "Paid (1)" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("list", { name: "Paid work" })).toHaveTextContent("Work paid");
  expect(screen.queryByText("Clean filter")).not.toBeInTheDocument();
});

test("expands the complete work list and resets it when switching status", () => {
  render(<ProfilePayoutDetails summary={profilePayoutSummary(Array.from({ length: 7 }, (_, i) => item(String(i))))} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Show all 7 unpaid items" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Paid (0)" }));
  expect(screen.getByText("No work marked paid in this period.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Unpaid (7)" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
});

test("loading displays placeholders and no empty or zero-payment claims", () => {
  render(<ProfilePayoutDetails summary={profilePayoutSummary()} loading />);
  expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText(/No unpaid/)).not.toBeInTheDocument();
});
