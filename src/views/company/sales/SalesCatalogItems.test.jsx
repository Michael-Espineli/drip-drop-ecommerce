import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs, onSnapshot } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { saveSalesCatalogItem } from "../../../utils/sales/salesFirestore";
import SalesCatalogItems from "./SalesCatalogItems";
import { SalesCatalogItem } from "../../../utils/models/Sales";

let mockItems;
let mockCompanySettings;
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
  mockCompanySettings = {};
  getDocs.mockResolvedValue({ docs: [] });
  onSnapshot.mockImplementation((path, callback) => {
    if (path.endsWith("/companyWide")) callback({ exists: () => true, data: () => mockCompanySettings });
    else if (path.endsWith("/main")) callback({ exists: () => true, data: () => ({ taskPaySource: "technicianRate" }) });
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
  const form = screen.getByRole("form", { name: "Create Service", exact: true });
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
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved).toEqual(expect.objectContaining({ name: "Standard filter service", unitAmountCents: 10000, unitCostCents: 4000 }));
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Filter clean", type: "Maintenance", payTypeId: "clean", estimatedMinutes: 30 }));
});

test("catalog editing updates the quantity-dependent pay range and retains custom task details", async () => {
  mockItems = [{ id: "existing", name: "Existing service", type: "service", sourceType: "manual", billingBehavior: "oneTime", unitAmountCents: 12500, unitCostCents: 3500, defaultQuantity: 1,
    metadata: { retained: "value", taskTemplates: [{ id: "task", name: "Custom inspection", description: "Keep my instructions", type: "Inspection", payTypeId: "clean", estimatedMinutes: 45 }] } }];
  openPage();
  fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
  const form = screen.getByRole("form", { name: "Edit Service" });
  const fields = within(form);
  fireEvent.change(fields.getByLabelText("Payroll quantity"), { target: { value: "2" } });
  const estimate = fields.getByRole("region", { name: "Service technician pay preview" });
  expect(within(estimate).getByText("$40.00 – $80.00")).toBeInTheDocument();
  fireEvent.click(within(estimate).getByRole("button", { name: "Use high estimate for internal cost" }));
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved).toEqual(expect.objectContaining({ id: "existing", unitAmountCents: 12500, unitCostCents: 8000 }));
  expect(saved.metadata.retained).toBe("value");
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Custom inspection", description: "Keep my instructions", type: "Inspection", payTypeId: "clean", payQuantity: 2 }));
});

test("the visible service pay type saves independently of a legacy catalog source and leaves cost manual", async () => {
  mockItems = [{ id: 'existing', name: 'Linked service', type: 'service', sourceType: 'databaseItem', sourceId: 'db-product', unitAmountCents: 12500, unitCostCents: 3500, metadata: {} }];
  openPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
  const form = screen.getByRole('form', { name: 'Edit Service' });
  const fields = within(form);
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'clean' } });
  expect(fields.getByLabelText('Internal Cost', { exact: true })).toHaveValue(35);
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(saveSalesCatalogItem.mock.calls[0][2]).toEqual(expect.objectContaining({
    payTypeId: 'clean', payTypeName: 'Filter clean', sourceType: 'databaseItem', sourceId: 'db-product', unitCostCents: 3500, unitAmountCents: 12500,
  }));
});

test("catalog service pay type and included tasks contribute once and apply cost only on click", async () => {
  openPage();
  fireEvent.click(screen.getByRole('button', { name: 'Create Service', exact: true }));
  const form = screen.getByRole('form', { name: 'Create Service', exact: true });
  const fields = within(form);
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'clean' } });
  fireEvent.click(fields.getByRole('button', { name: 'Add Task', exact: true }));
  expect(fields.getByLabelText('Internal Cost', { exact: true })).toHaveValue(null);
  const preview = fields.getByRole('region', { name: 'Service technician pay preview' });
  expect(within(preview).getByText('$20.00 – $40.00')).toBeInTheDocument();
  fireEvent.click(within(preview).getByRole('button', { name: 'Use high estimate for internal cost' }));
  expect(fields.getByLabelText('Internal Cost', { exact: true })).toHaveValue(40);
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(saveSalesCatalogItem.mock.calls[0][2]).toEqual(expect.objectContaining({ payTypeId: 'clean', sourceType: 'serviceStopType', sourceId: 'clean', unitCostCents: 4000 }));
});

test("catalog model round trips canonical pay links and reads legacy pay sources", () => {
  const legacy = SalesCatalogItem.fromFirestore({ id: 'legacy', data: () => ({ sourceType: 'workType', sourceId: 'clean' }) });
  expect(legacy.toFirestore().payTypeId).toBe('clean');
  const canonical = SalesCatalogItem.fromFirestore({ id: 'canonical', data: () => ({ sourceType: 'databaseItem', sourceId: 'product', payTypeId: 'clean', payTypeName: 'Filter clean' }) });
  expect(canonical.toFirestore()).toEqual(expect.objectContaining({ sourceId: 'product', payTypeId: 'clean', payTypeName: 'Filter clean' }));
});

test("catalog task pay controls keep each estimate with its cost and hide task costs when additional pay is off", async () => {
  openPage();
  fireEvent.click(screen.getByRole('button', { name: 'Create Service', exact: true }));
  const fields = within(screen.getByRole('form', { name: 'Create Service' }));
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'clean' } });
  const serviceCost = fields.getByRole('region', { name: 'Service internal cost' });
  expect(within(serviceCost).getByLabelText('Internal Cost')).toHaveValue(null);
  expect(within(serviceCost).getByRole('region', { name: 'Service technician pay preview' })).toBeInTheDocument();
  fireEvent.click(fields.getByRole('button', { name: 'Add Task', exact: true }));
  expect(fields.queryByLabelText('Tech Labor Cost')).not.toBeInTheDocument();
  expect(fields.queryByRole('region', { name: 'Task technician pay preview' })).not.toBeInTheDocument();
  expect(fields.getByLabelText('Estimated Minutes')).toBeInTheDocument();
  expect(fields.getByLabelText('Billing Labor')).toBeInTheDocument();
  fireEvent.change(fields.getByLabelText('Task pay'), { target: { value: 'additional' } });
  const taskCost = fields.getByRole('group', { name: 'Task labor cost' });
  expect(within(taskCost).getByLabelText('Tech Labor Cost')).toHaveValue(null);
  expect(within(taskCost).getByRole('region', { name: 'Task technician pay preview' })).toBeInTheDocument();
  fireEvent.click(within(taskCost).getByRole('button', { name: 'Use high estimate for task cost' }));
  expect(within(taskCost).getByLabelText('Tech Labor Cost')).toHaveValue(40);
  expect(within(serviceCost).getByLabelText('Internal Cost')).toHaveValue(null);
  fireEvent.change(fields.getByLabelText('Task pay'), { target: { value: 'none' } });
  expect(fields.queryByLabelText('Tech Labor Cost')).not.toBeInTheDocument();
  expect(fields.queryByRole('region', { name: 'Task technician pay preview' })).not.toBeInTheDocument();
  fireEvent.change(fields.getByLabelText('Task pay'), { target: { value: 'additional' } });
  expect(fields.getByLabelText('Tech Labor Cost')).toHaveValue(40);
  fireEvent.click(within(serviceCost).getByRole('button', { name: 'Use high estimate for internal cost' }));
  expect(within(serviceCost).getByLabelText('Internal Cost')).toHaveValue(80);
});

test("an install service saves its reusable product and database requirement separately from service pricing", async () => {
  const vendor = { id: "db-pump", name: "Supplier pump", category: "Equipment", rate: 80000, equipmentType: "Pump", equipmentMake: "Pentair", equipmentModel: "VS" };
  const product = { id: "sell-pump", name: "Variable speed pump", preferredVendorItemId: "db-pump", sellPrice: 150000 };
  getDocs.mockImplementation(async (path) => ({ docs: (path.endsWith("genericItems/genericItems") ? [product] : path.endsWith("dataBase/dataBase") ? [vendor] : []).map(doc) }));
  openPage();
  fireEvent.click(screen.getByRole("button", { name: "Create Service", exact: true }));
  const form = screen.getByRole("form", { name: "Create Service", exact: true });
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
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved.unitAmountCents).toBe(30000);
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Install new pump", type: "Install", genericItemId: "sell-pump", dataBaseItemId: "db-pump", productQuantity: 2 }));
  expect(saved.metadata.taskTemplates[0]).not.toHaveProperty("shoppingListItemId");
});

test("a catalog service suggests the company price as internal cost changes and saves it only after applying", async () => {
  mockCompanySettings = { laborMultiplier: 2.5 };
  openPage();
  fireEvent.click(screen.getByRole('button', { name: 'Create Service', exact: true }));
  const form = screen.getByRole('form', { name: 'Create Service' });
  const fields = within(form);
  fireEvent.change(fields.getByLabelText('Name', { exact: true }), { target: { value: 'Priced service' } });
  fireEvent.change(fields.getByLabelText('Customer Price'), { target: { value: '123' } });
  fireEvent.change(fields.getByLabelText('Internal Cost'), { target: { value: '40' } });
  expect(fields.getByText('Suggested customer price: $100.00')).toBeInTheDocument();
  expect(fields.getByLabelText('Customer Price')).toHaveValue(123);
  fireEvent.change(fields.getByLabelText('Internal Cost'), { target: { value: '50' } });
  expect(fields.getByText('Suggested customer price: $125.00')).toBeInTheDocument();
  expect(fields.getByLabelText('Customer Price')).toHaveValue(123);
  fireEvent.click(fields.getByRole('button', { name: 'Use suggested customer price' }));
  expect(fields.getByLabelText('Customer Price')).toHaveValue(125);
  expect(fields.getByLabelText('Internal Cost')).toHaveValue(50);
  fireEvent.submit(form);
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(saveSalesCatalogItem.mock.calls[0][2]).toEqual(expect.objectContaining({ unitAmountCents: 12500, unitCostCents: 5000 }));
});
