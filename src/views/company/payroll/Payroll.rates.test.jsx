import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDoc, getDocs } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { technicianWorkflow } from "../../../utils/technicianWorkflow";
import Payroll from "./Payroll";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {} }));
jest.mock("../../../utils/technicianWorkflow", () => ({ technicianWorkflow: jest.fn() }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: () => true, permissionsReady: true }));
jest.mock("./PayRequestsPanel", () => () => null);
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"), query: (ref) => ref,
  where: jest.fn(), orderBy: jest.fn(), documentId: jest.fn(), limit: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(),
}));

const taskType = { id: "filter", name: "Filter cleaning", category: "serviceCall", defaultRateType: "flatPerTask" };
const hourlyType = { id: "diagnostic", name: "Hourly diagnostic", category: "estimate", defaultRateType: "hourly" };
const document = (record) => ({ id: record.id, data: () => record });
const taskRate = { technicianId: "tech", payTypeId: taskType.id, payBasis: "serviceStopTask", rateType: "flatPerTask" };
let rates;

beforeEach(() => {
  jest.clearAllMocks();
  rates = [];
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
  getDoc.mockResolvedValue({ exists: () => false });
  getDocs.mockImplementation(async (ref) => ({ docs: (ref.endsWith("/companyPayTypes") ? [taskType, hourlyType]
    : ref.endsWith("/companyUsers") ? [{ id: "membership", userId: "tech", userName: "Alex" }]
    : ref.endsWith("/technicianRates") ? rates : []).map(document) }));
  technicianWorkflow.mockResolvedValue({ rateIds: ["saved-rate"] });
});

const openRates = async () => {
  render(<MemoryRouter initialEntries={["/company/payroll/setup?tab=rates"]}>
    <Context.Provider value={{ recentlySelectedCompany: "company", user: { uid: "owner" }, setPayrollEnabled: jest.fn() }}>
      <Payroll mode="setup" />
    </Context.Provider>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "Technician Rates" });
};

const technicianTaskCell = () => {
  const technicianRow = screen.getByRole("row", { name: /Alex/ });
  const payTypeColumn = screen.getByRole("columnheader", { name: /Filter cleaning/ });
  return within(within(technicianRow).getAllByRole("cell")[payTypeColumn.cellIndex]);
};

test("the setup matrix saves a per-task rate effective today even when a rate is already scheduled", async () => {
  rates = [{ ...taskRate, id: "future", status: "scheduled", amountCents: 5700, effectiveStartDate: new Date("2099-11-21T12:00:00Z") }];
  technicianWorkflow.mockImplementationOnce(async () => {
    rates.push({ ...taskRate, id: "active", status: "active", amountCents: 4500, effectiveStartDate: new Date("2020-11-20T12:00:00Z") });
    return { rateIds: ["active"] };
  });
  await openRates();
  expect(technicianTaskCell().getByText("No active rate")).toBeInTheDocument();
  expect(technicianTaskCell().getByText("Scheduled 2099-11-21")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit Matrix" }));
  const amount = technicianTaskCell().getByLabelText("Amount");
  expect(amount).toHaveValue(null);
  fireEvent.change(amount, { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Matrix" }));
  await waitFor(() => expect(technicianWorkflow).toHaveBeenCalledWith("manageTechnicianRates", expect.objectContaining({
    companyId: "company", rates: [expect.objectContaining({ technicianId: "tech", payTypeId: "filter",
      payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents: 4500, existingId: undefined, effectiveToday: true })],
  })));
  expect(await technicianTaskCell().findByText("Active")).toBeInTheDocument();
  expect(technicianTaskCell().getByText("$45.00")).toBeInTheDocument();
});

test("stored scheduled rates are shown as active once their effective time has arrived", async () => {
  rates = [{ ...taskRate, id: "historically-scheduled", status: "scheduled", amountCents: 5700, effectiveStartDate: new Date("2020-01-01") }];
  await openRates();
  expect(technicianTaskCell().getByText("Active")).toBeInTheDocument();
  expect(technicianTaskCell().getByText("$57.00")).toBeInTheDocument();
});

test("advanced setup opens a popup and keeps an hourly rate linked to its pay type", async () => {
  await openRates();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Advanced Rate Rows" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Advanced Rate Rows" }));
  fireEvent.change(dialog.getByLabelText("Technician"), { target: { value: "tech" } });
  fireEvent.change(dialog.getByLabelText("Pay type"), { target: { value: "diagnostic" } });
  fireEvent.change(dialog.getByLabelText("Amount"), { target: { value: "55" } });
  fireEvent.change(dialog.getByLabelText("Effective date"), { target: { value: "2099-11-21" } });
  fireEvent.click(dialog.getByRole("button", { name: "Add Rate" }));
  await waitFor(() => expect(technicianWorkflow).toHaveBeenCalledWith("manageTechnicianRates", expect.objectContaining({
    rates: [expect.objectContaining({ technicianId: "tech", payTypeId: "diagnostic",
      payBasis: "technicianHourly", rateType: "hourly", amountCents: 5500, effectiveStartDay: "2099-11-21" })],
  })));
  expect(await dialog.findByText("Technician rate saved.")).toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("editing a scheduled row keeps its date and shows save failures in the popup", async () => {
  rates = [{ ...taskRate, id: "future", status: "scheduled", amountCents: 5700, effectiveStartDate: new Date("2099-11-21T12:00:00Z") }];
  technicianWorkflow.mockRejectedValueOnce(new Error("This rate has already changed. Reload the current schedule before editing."));
  await openRates();
  fireEvent.click(screen.getByRole("button", { name: "Advanced Rate Rows" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Advanced Rate Rows" }));
  fireEvent.click(dialog.getByRole("button", { name: "Edit Alex Filter cleaning rate" }));
  expect(dialog.getByLabelText("Effective date")).toHaveValue("2099-11-21");
  expect(dialog.getByLabelText("Amount")).toHaveValue(57);
  expect(dialog.getByLabelText("Pay type")).toBeDisabled();
  fireEvent.change(dialog.getByLabelText("Amount"), { target: { value: "60" } });
  fireEvent.click(dialog.getByRole("button", { name: "Update Rate" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("This rate has already changed.");
  expect(dialog.getByLabelText("Amount")).toHaveValue(60);
  expect(technicianWorkflow).toHaveBeenCalledWith("manageTechnicianRates", expect.objectContaining({
    rates: [expect.objectContaining({ existingId: "future", effectiveStartDay: "2099-11-21", amountCents: 6000 })],
  }));
});
