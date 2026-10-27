import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import JobPayrollFields from "./JobPayrollFields";
const payTypes = [{ id: "filter", name: "Filter clean", isActive: true }, { id: "old", name: "Archived", isActive: false }];
function Form({ initial = {}, inheritedPayTypeId = "" }) {
  const [value, setValue] = useState(initial);
  return <form><JobPayrollFields value={value} payTypes={payTypes} inheritedPayTypeId={inheritedPayTypeId} onChange={(field, next) => setValue((old) => ({ ...old, [field]: next }))} /><output data-testid="data">{JSON.stringify(value)}</output></form>;
}
test("a new task waits for an explicit or inherited pay item and excludes inactive choices", () => {
  render(<Form />);
  expect(screen.getByLabelText("Payroll pay item")).toHaveValue("");
  expect(screen.getByText(/A pay item is needed/)).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Archived" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payroll pay item"), { target: { value: "filter" } });
  expect(screen.queryByText(/A pay item is needed/)).not.toBeInTheDocument();
});
test("custom pay supports an intentional zero and clears the amount when automatic pay is restored", () => {
  render(<Form initial={{ payTypeId: "filter" }} />);
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "custom" } });
  expect(screen.getByLabelText("Custom pay amount")).toBeRequired();
  fireEvent.change(screen.getByLabelText("Custom pay amount"), { target: { value: "0" } });
  expect(JSON.parse(screen.getByTestId("data").textContent).manualPayOverrideCents).toBe(0);
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "automatic" } });
  expect(JSON.parse(screen.getByTestId("data").textContent).manualPayOverrideCents).toBeNull();
  fireEvent.change(screen.getByLabelText("Payment alongside visit pay"), { target: { value: "stackable" } });
  expect(JSON.parse(screen.getByTestId("data").textContent).payrollStackBehavior).toBe("stackable");
});
test("inherited, included and unpaid work are explicit choices", () => {
  render(<Form inheritedPayTypeId="filter" />);
  expect(screen.getByRole("option", { name: "Use service pay item" })).toBeInTheDocument();
  expect(screen.queryByText(/A pay item is needed/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "included" } });
  expect(screen.queryByLabelText("Custom pay amount")).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("data").textContent).payrollMode).toBe("included");
});
