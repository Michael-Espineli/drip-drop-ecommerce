import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ServicePayrollTaskEditor from "./ServicePayrollTaskEditor";
import ServicePayrollCostPreview from "./ServicePayrollCostPreview";

const mockData = {
  companyId: "company", loading: false, error: "", settings: { taskPaySource: "technicianRate" },
  companyUsers: [{ userId: "a", name: "Alex" }, { userId: "b", name: "Blair" }],
  payTypes: [{ id: "clean", name: "Filter clean", category: "maintenance", defaultRateType: "flatPerTask", description: "Clean and inspect", defaultEstimatedMinutes: 30 }],
  rates: [2000, 4000].map((amountCents, index) => ({ id: `rate-${index}`, technicianId: index ? "b" : "a", payTypeId: "clean", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents, status: "Active" })),
};
jest.mock("../../../hooks/useServicePayrollData", () => () => mockData);

function Form() {
  const [form, setForm] = useState({ type: "service", name: "", unitAmount: "100.00", unitCost: "", taskTemplates: [] });
  return <><ServicePayrollTaskEditor companyId="company" form={form} setForm={setForm} /><output data-testid="form">{JSON.stringify(form)}</output></>;
}

test("pay item selection fills task details, previews the range, and applies internal cost without changing price", () => {
  render(<Form />);
  fireEvent.change(screen.getByLabelText("Default payroll pay item"), { target: { value: "clean" } });
  const preview = screen.getByRole("region", { name: "Service technician pay preview" });
  expect(within(preview).getAllByText(/\$20.00 – \$40.00/)).not.toHaveLength(0);
  fireEvent.click(within(preview).getByRole("button", { name: "Use high estimate for internal cost" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
  expect(screen.getByLabelText("Task name")).toHaveValue("Filter clean");
  expect(screen.getByLabelText("Task type")).toHaveValue("Maintenance");
  expect(screen.getByLabelText("Estimated minutes")).toHaveValue(30);
  expect(screen.getByLabelText("Task notes")).toHaveValue("Clean and inspect");
  expect(JSON.parse(screen.getByTestId("form").textContent)).toEqual(expect.objectContaining({ unitCost: "40.00", unitAmount: "100.00" }));
  expect(screen.getByLabelText("Task pay")).toHaveValue("none");
  fireEvent.change(screen.getByLabelText("Task pay"), { target: { value: "additional" } });
  fireEvent.change(screen.getByLabelText("Pay calculation"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Custom pay amount"), { target: { value: "15" } });
  expect(within(screen.getByRole("region", { name: "Task technician pay preview" })).getByText("$15.00 – $15.00")).toBeInTheDocument();
});

test("incomplete rates remain visible and cannot be used as a complete internal-cost estimate", () => {
  render(<ServicePayrollCostPreview data={{ ...mockData, rates: mockData.rates.slice(0, 1) }} tasks={[{ payTypeId: "clean" }]} onUseHighCost={jest.fn()} />);
  expect(screen.getByText(/1 technician estimate needs review/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use high estimate for internal cost" })).toBeDisabled();
});

test("loading, access failure, and disabled payroll do not show an invented zero cost", () => {
  const view = render(<ServicePayrollCostPreview data={{ ...mockData, loading: true }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading technician pay preview");
  view.rerender(<ServicePayrollCostPreview data={{ ...mockData, error: "Payroll access unavailable" }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Payroll access unavailable");
  view.rerender(<ServicePayrollCostPreview data={{ ...mockData, settings: { payrollEnabled: false } }} />);
  expect(screen.getByText(/Payroll is disabled/)).toBeInTheDocument();
  expect(screen.queryByText("$0.00 – $0.00")).not.toBeInTheDocument();
});
