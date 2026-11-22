import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import JobPayrollFields from "./JobPayrollFields";
const payTypes = [{ id: "filter", name: "Filter clean", isActive: true }, { id: "old", name: "Archived", isActive: false }];
function Form({ initial = { payrollMode: "included" }, inheritedPayTypeId = "", scope = "task" }) {
  const [value, setValue] = useState(initial);
  return <form><JobPayrollFields value={value} scope={scope} payTypes={payTypes} inheritedPayTypeId={inheritedPayTypeId} onChange={(field, next) => setValue((old) => ({ ...old, [field]: next }))} /><output data-testid="data">{JSON.stringify(value)}</output></form>;
}
const saved = () => JSON.parse(screen.getByTestId("data").textContent);
test("the stop form has an active pay item picker without task controls", () => {
  render(<Form initial={{ payrollMode: "automatic" }} />);
  expect(screen.queryByLabelText("Task pay")).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Archived" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payroll pay item"), { target: { value: "filter" } });
  expect(saved()).toMatchObject({ payrollMode: "automatic", payTypeId: "filter" });
});

test("fixed visit pay accepts zero and switching back clears the override", () => {
  render(<Form initial={{ payrollMode: "custom" }} />);
  const amount = screen.getByLabelText("Fixed pay amount");
  expect(amount).toBeRequired();
  fireEvent.change(amount, { target: { value: "15" } });
  expect(saved().manualPayOverrideCents).toBe(1500);
  fireEvent.change(amount, { target: { value: "0" } });
  expect(saved().manualPayOverrideCents).toBe(0);
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "automatic" } });
  expect(saved().manualPayOverrideCents).toBeNull();
});

test("service stop forms retain their own pay calculation choices", () => {
  render(<Form initial={{ payrollMode: "automatic" }} scope="stop" />);
  expect(screen.queryByLabelText("Task pay")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Pay calculation")).toHaveValue("automatic");
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "custom" } });
  expect(saved().payrollStackBehavior).toBeUndefined();
});
