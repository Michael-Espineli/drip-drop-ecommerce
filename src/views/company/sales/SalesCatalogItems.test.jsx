import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs, onSnapshot } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { saveSalesCatalogItem } from "../../../utils/sales/salesFirestore";
import SalesCatalogItems from "./SalesCatalogItems";

let mockItems;
const payItem = { id: "clean", name: "Filter clean", category: "maintenance", description: "Open, clean, and inspect", defaultEstimatedMinutes: 30, defaultRateType: "flatPerTask" };
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {} }));
jest.mock("../../../components/FeatureInfoButton", () => () => null);
jest.mock("../../../utils/recurringServiceStopTasks", () => ({ fetchRecurringTaskGroupOptions: async () => [], fetchTaskGroupTasks: async () => [] }));
jest.mock("../../../utils/sales/salesFirestore", () => ({ salesCatalogCollection: (_, company) => `companies/${company}/salesCatalogItems`, saveSalesCatalogItem: jest.fn() }));
jest.mock("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: {} }) }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"), query: (ref) => ref,
  getDocs: jest.fn(), onSnapshot: jest.fn(),
}));
const doc = (value) => ({ id: value.id, data: () => value });
const openPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={{ recentlySelectedCompany: "company" }}><SalesCatalogItems /></Context.Provider></MemoryRouter>);
beforeEach(() => {
  jest.clearAllMocks();
  mockItems = [];
  getDocs.mockResolvedValue({ docs: [] });
  onSnapshot.mockImplementation((path, callback) => {
    if (path.endsWith("/main") || path.endsWith("/companyWide")) callback({ exists: () => true, data: () => ({ taskPaySource: "technicianRate" }) });
    else callback({ docs: (path.endsWith("/salesCatalogItems") ? mockItems
      : path.endsWith("/companyPayTypes") ? [payItem]
        : path.endsWith("/companyUsers") ? [{ id: "a", userId: "a", userName: "Alex" }, { id: "b", userId: "b", userName: "Blair" }]
          : path.endsWith("/technicianRates") ? [2000, 4000].map((amountCents, index) => ({ id: `rate-${index}`, technicianId: index ? "b" : "a", payTypeId: "clean", payBasis: "serviceStopTask", rateType: "flatPerTask", amountCents, status: "Active" })) : []).map(doc) });
    return () => {};
  });
});

test("catalog creation saves pay-item task defaults and an explicitly applied internal-cost estimate", async () => {
  openPage();
  fireEvent.click(screen.getByRole("button", { name: "Create Service", exact: true }));
  const form = screen.getByRole("heading", { name: "Create Service", exact: true }).closest("form");
  const fields = within(form);
  fireEvent.change(fields.getByLabelText("Name", { exact: true }), { target: { value: "Standard filter service" } });
  fireEvent.change(fields.getByLabelText("Customer Price", { exact: true }), { target: { value: "100" } });
  fireEvent.click(fields.getByRole("button", { name: "Add Task", exact: true }));
  fireEvent.change(fields.getByLabelText("Task pay"), { target: { value: "additional" } });
  fireEvent.change(fields.getByLabelText("Payroll pay item"), { target: { value: "clean" } });
  expect(fields.getByLabelText("Task Name")).toHaveValue("Filter clean");
  expect(fields.getByLabelText("Estimated Minutes")).toHaveValue(30);
  expect(fields.getByLabelText("Notes")).toHaveValue("Open, clean, and inspect");
  const estimate = fields.getByRole("region", { name: "Service technician pay preview" });
  expect(within(estimate).getByText("$20.00 – $40.00")).toBeInTheDocument();
  fireEvent.click(within(estimate).getByRole("button", { name: "Use high estimate for internal cost" }));
  await act(async () => { fireEvent.submit(form); });
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved).toEqual(expect.objectContaining({ name: "Standard filter service", unitAmountCents: 10000, unitCostCents: 4000 }));
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Filter clean", type: "Maintenance", payTypeId: "clean", estimatedMinutes: 30 }));
});

test("catalog editing updates the quantity-dependent pay range and retains custom task details", async () => {
  mockItems = [{ id: "existing", name: "Existing service", type: "service", sourceType: "manual", billingBehavior: "oneTime", unitAmountCents: 12500, unitCostCents: 3500, defaultQuantity: 1,
    metadata: { retained: "value", taskTemplates: [{ id: "task", name: "Custom inspection", description: "Keep my instructions", type: "Inspection", payTypeId: "clean", estimatedMinutes: 45 }] } }];
  openPage();
  fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
  const form = screen.getByRole("heading", { name: "Edit Service" }).closest("form");
  const fields = within(form);
  fireEvent.change(fields.getByLabelText("Payroll quantity"), { target: { value: "2" } });
  const estimate = fields.getByRole("region", { name: "Service technician pay preview" });
  expect(within(estimate).getByText("$40.00 – $80.00")).toBeInTheDocument();
  fireEvent.click(within(estimate).getByRole("button", { name: "Use high estimate for internal cost" }));
  await act(async () => { fireEvent.submit(form); });
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved).toEqual(expect.objectContaining({ id: "existing", unitAmountCents: 12500, unitCostCents: 8000 }));
  expect(saved.metadata.retained).toBe("value");
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Custom inspection", description: "Keep my instructions", type: "Inspection", payTypeId: "clean", payQuantity: 2 }));
});

test("an install service saves its reusable product and database requirement separately from service pricing", async () => {
  const vendor = { id: "db-pump", name: "Supplier pump", category: "Equipment", rate: 80000, equipmentType: "Pump", equipmentMake: "Pentair", equipmentModel: "VS" };
  const product = { id: "sell-pump", name: "Variable speed pump", preferredVendorItemId: "db-pump", sellPrice: 150000 };
  getDocs.mockImplementation(async (path) => ({ docs: (path.endsWith("genericItems/genericItems") ? [product] : path.endsWith("dataBase/dataBase") ? [vendor] : []).map(doc) }));
  openPage();
  fireEvent.click(screen.getByRole("button", { name: "Create Service", exact: true }));
  const form = screen.getByRole("heading", { name: "Create Service", exact: true }).closest("form");
  const fields = within(form);
  fireEvent.change(fields.getByLabelText("Name", { exact: true }), { target: { value: "Pump install service" } });
  fireEvent.change(fields.getByLabelText("Customer Price", { exact: true }), { target: { value: "300" } });
  fireEvent.click(fields.getByRole("button", { name: "Add Task", exact: true }));
  fireEvent.change(fields.getByLabelText("Task Name"), { target: { value: "Install new pump" } });
  fireEvent.keyDown(fields.getByRole("combobox", { name: "Task Type" }), { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(await screen.findByText("Install", { exact: true }));
  const chooser = await fields.findByRole("combobox", { name: "Product for this task" });
  await fields.findByRole("option", { name: "Variable speed pump" });
  fireEvent.change(chooser, { target: { value: "catalog:sell-pump" } });
  fireEvent.change(fields.getByRole("spinbutton", { name: "Product quantity" }), { target: { value: "2" } });
  await act(async () => { fireEvent.submit(form); });
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved.unitAmountCents).toBe(30000);
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Install new pump", type: "Install", genericItemId: "sell-pump", dataBaseItemId: "db-pump", productQuantity: 2 }));
  expect(saved.metadata.taskTemplates[0]).not.toHaveProperty("shoppingListItemId");
});
