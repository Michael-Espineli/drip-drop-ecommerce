import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import JobPayrollFields from "./JobPayrollFields";
import { calculatePayLines } from "../../../utils/payroll/payCalculation";
const payTypes = [{ id: "filter", name: "Filter clean", isActive: true }, { id: "old", name: "Archived", isActive: false }];
function Form({ initial = { payrollMode: "included" }, inheritedPayTypeId = "", scope = "task" }) {
  const [value, setValue] = useState(initial);
  return <form><JobPayrollFields value={value} scope={scope} payTypes={payTypes} inheritedPayTypeId={inheritedPayTypeId} onChange={(field, next) => setValue((old) => ({ ...old, [field]: next }))} /><output data-testid="data">{JSON.stringify(value)}</output></form>;
}
const saved = () => JSON.parse(screen.getByTestId("data").textContent);
const selectAdditional = () => fireEvent.change(screen.getByLabelText("Task pay"), { target: { value: "additional" } });
const earnings = (task) => calculatePayLines({ companyId: "company", serviceStop: { id: "stop", operationStatus: "Finished", techId: "tech", payTypeId: "filter" },
  tasks: [{ ...task, id: "task", status: "Finished" }], workTypes: [{ id: "filter", category: "repair" }], rates: [
    { id: "stop-rate", technicianId: "tech", payTypeId: "filter", payBasis: "serviceStop", rateType: "flatPerStop", amountCents: 5000 },
    { id: "task-rate", technicianId: "tech", payTypeId: "filter", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents: 1500 },
  ] });

test("routine tasks need no extra pay setup and leave service stop pay intact", () => {
  render(<Form />);
  expect(screen.getByRole("option", { name: "No additional task pay" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Additional Task pay" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Payroll pay item")).not.toBeInTheDocument();
  expect(screen.queryByText(/A pay item is needed/)).not.toBeInTheDocument();
  expect(earnings(saved()).map((line) => [line.source, line.totalAmountCents])).toEqual([["serviceStop", 5000]]);
  selectAdditional();
  expect(screen.getByLabelText("Payroll pay item")).toHaveValue("");
  expect(screen.getByText(/A pay item is needed/)).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Archived" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payroll pay item"), { target: { value: "filter" } });
  expect(saved()).toEqual(expect.objectContaining({ payrollMode: "automatic", payrollStackBehavior: "stackable", payTypeId: "filter" }));
  expect(earnings(saved()).map((line) => line.totalAmountCents)).toEqual([5000, 1500]);
});

test("custom task pay stays additional, including zero, and can be turned off", () => {
  render(<Form initial={{ payTypeId: "filter", payrollMode: "included" }} />);
  selectAdditional();
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "custom" } });
  expect(screen.getByLabelText("Custom pay amount")).toBeRequired();
  fireEvent.change(screen.getByLabelText("Custom pay amount"), { target: { value: "15" } });
  expect(earnings(saved()).reduce((sum, line) => sum + line.totalAmountCents, 0)).toBe(6500);
  fireEvent.change(screen.getByLabelText("Custom pay amount"), { target: { value: "0" } });
  expect(saved().manualPayOverrideCents).toBe(0);
  expect(earnings(saved()).reduce((sum, line) => sum + line.totalAmountCents, 0)).toBe(5000);
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "automatic" } });
  expect(saved().manualPayOverrideCents).toBeNull();
  fireEvent.change(screen.getByLabelText("Task pay"), { target: { value: "none" } });
  expect(saved()).toEqual(expect.objectContaining({ payrollMode: "included", manualPayOverrideCents: null, payrollStackBehavior: null }));
  expect(screen.queryByLabelText("Custom pay amount")).not.toBeInTheDocument();
  expect(earnings(saved()).map((line) => line.totalAmountCents)).toEqual([5000]);
});

test("inherited pay items remain available when additional task pay is chosen", () => {
  render(<Form inheritedPayTypeId="filter" />);
  selectAdditional();
  expect(screen.getByRole("option", { name: "Use service pay item" })).toBeInTheDocument();
  expect(screen.queryByText(/A pay item is needed/)).not.toBeInTheDocument();
});

test("saved replacement and unpaid policies are preserved until explicitly edited", () => {
  const initial = { payTypeId: "filter", payrollMode: "custom", manualPayOverrideCents: 1200, payrollStackBehavior: "replacesBase" };
  const view = render(<Form initial={initial} />);
  expect(saved()).toEqual(initial);
  expect(screen.getByLabelText("Payment alongside visit pay")).toHaveValue("replacesBase");
  fireEvent.change(screen.getByLabelText("Custom pay amount"), { target: { value: "13" } });
  expect(saved().payrollStackBehavior).toBe("stackable");
  view.unmount();
  render(<Form initial={{ payrollMode: "unpaid" }} />);
  expect(saved().payrollMode).toBe("unpaid");
  expect(screen.getByText(/explicitly marked as unpaid/)).toBeInTheDocument();
});

test("service stop forms retain their own pay calculation choices", () => {
  render(<Form initial={{ payrollMode: "automatic" }} scope="stop" />);
  expect(screen.queryByLabelText("Task pay")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Pay calculation")).toHaveValue("automatic");
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "custom" } });
  expect(saved().payrollStackBehavior).toBeUndefined();
});
