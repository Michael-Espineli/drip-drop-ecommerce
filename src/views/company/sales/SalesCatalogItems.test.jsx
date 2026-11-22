import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getDocs, onSnapshot } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { saveSalesCatalogItem } from "../../../utils/sales/salesFirestore";
import SalesCatalogItems from "./SalesCatalogItems";
import { SalesCatalogItem } from "../../../utils/models/Sales";

let mockItems;
let mockCompanySettings;
const payItem = { id: "clean", name: "Filter clean", category: "maintenance", description: "Open, clean, and inspect", defaultEstimatedMinutes: 30, defaultRateType: "flatPerStop" };
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
const catalogPath = "/company/sales/catalog-items";
const toggleAdvanced = () => fireEvent.click(screen.getByLabelText("Advanced service settings"));
const toggleTaskAdvanced = () => fireEvent.click(screen.getByLabelText("Advanced task settings"));
const openPage = () => render(
  <MemoryRouter initialEntries={[catalogPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Context.Provider value={{ recentlySelectedCompany: "company" }}>
      <Routes>
        <Route path={catalogPath} element={<SalesCatalogItems />} />
        <Route path={`${catalogPath}/:catalogItemId`} element={<SalesCatalogItems />} />
      </Routes>
    </Context.Provider>
  </MemoryRouter>
);
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
          : path.endsWith("/technicianRates") ? [2000, 4000].map((amountCents, index) => ({ id: `rate-${index}`, technicianId: index ? "b" : "a", payTypeId: "clean", payBasis: "serviceStop", rateType: "flatPerStop", amountCents, status: "Active" })) : []).map(doc) });
    return () => {};
  });
});

test("the service name opens a detail page with its own header actions and a catalog back link", async () => {
  mockItems = [{ id: "existing", name: "Filter service", type: "service", billingBehavior: "oneTime" }];
  openPage();
  expect(screen.getByText("Active Services")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Details", exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Filter service" })).toHaveTextContent(/^$/);

  fireEvent.click(screen.getByRole("link", { name: "Filter service" }));
  const header = within(screen.getByRole("banner"));
  expect(await header.findByRole("heading", { name: "Filter service", level: 1 })).toBeInTheDocument();
  expect(screen.queryByText("Active Services")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create Service" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Service Agreement Templates" })).not.toBeInTheDocument();

  fireEvent.click(header.getByRole("button", { name: "Edit Service" }));
  expect(screen.getByRole("form", { name: "Edit Service" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close service form" }));
  fireEvent.click(header.getByRole("link", { name: "Back to Service Catalog" }));
  expect(await screen.findByRole("heading", { name: "Service Catalog", level: 1 })).toBeInTheDocument();
});

test("catalog creation saves pay-item task defaults and an explicitly applied internal-cost estimate", async () => {
  openPage();
  fireEvent.click(screen.getByRole("button", { name: "Create Service", exact: true }));
  const form = screen.getByRole("form", { name: "Create Service", exact: true });
  const fields = within(form);
  fireEvent.change(fields.getByLabelText("Name", { exact: true }), { target: { value: "Standard filter service" } });
  fireEvent.change(fields.getByLabelText("Customer Price", { exact: true }), { target: { value: "100" } });
  fireEvent.click(fields.getByRole("button", { name: "Add Task", exact: true }));
  expect(fields.getByLabelText("Estimated Minutes")).toHaveValue(15);
  fireEvent.change(fields.getByLabelText("Source Type"), { target: { value: "serviceStopType" } });
  fireEvent.change(fields.getByLabelText("Technician pay type"), { target: { value: "clean" } });
  expect(fields.getByLabelText("Task Name")).toHaveValue("Filter clean");
  expect(fields.getByLabelText("Estimated Minutes")).toHaveValue(30);
  expect(fields.getByLabelText("Notes")).toHaveValue("Open, clean, and inspect");
  toggleAdvanced();
  const estimate = fields.getByRole("region", { name: "Service technician pay preview" });
  expect(within(estimate).getByText("$20.00 – $40.00")).toBeInTheDocument();
  fireEvent.click(within(estimate).getByRole("button", { name: "Use high estimate for internal cost" }));
  fireEvent.click(fields.getByRole("button", { name: "Save Task" }));
  expect(fields.queryByLabelText("Task Name")).not.toBeInTheDocument();
  expect(fields.getByRole("button", { name: "Edit task Filter clean" })).toBeInTheDocument();
  expect(saveSalesCatalogItem).not.toHaveBeenCalled();
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved).toEqual(expect.objectContaining({ name: "Standard filter service", unitAmountCents: 10000, unitCostCents: 4000 }));
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Filter clean", type: "Maintenance", estimatedMinutes: 30 }));
});

test("a new task starts at 15 minutes and Cancel discards its draft", async () => {
  openPage();
  fireEvent.click(screen.getByRole("button", { name: "Create Service", exact: true }));
  const form = screen.getByRole("form", { name: "Create Service" });
  const fields = within(form);
  expect(fields.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  fireEvent.change(fields.getByLabelText("Name", { exact: true }), { target: { value: "Filter service" } });
  fireEvent.click(fields.getByRole("button", { name: "Add Task", exact: true }));
  const draft = within(fields.getByRole("group", { name: "New task" }));
  expect(draft.getByLabelText("Estimated Minutes")).toHaveValue(15);
  expect(draft.queryByLabelText("Customer task price")).not.toBeInTheDocument();
  expect(draft.getByLabelText("Customer approval")).not.toBeVisible();
  expect(draft.queryByLabelText("Task pay")).not.toBeInTheDocument();
  toggleTaskAdvanced();
  expect(draft.queryByLabelText("Customer task price")).not.toBeInTheDocument();
  expect(draft.getByLabelText("Customer approval")).toBeVisible();
  expect(draft.queryByLabelText("Task pay")).not.toBeInTheDocument();
  fireEvent.change(draft.getByLabelText("Task Name"), { target: { value: "Canceled task" } });
  fireEvent.click(draft.getByRole("button", { name: "Cancel" }));
  expect(fields.getByText("No tasks yet.")).toBeInTheDocument();

  fireEvent.click(fields.getByRole("button", { name: "Add Task", exact: true }));
  fireEvent.change(fields.getByLabelText("Task Name"), { target: { value: "Inspect filter" } });
  fireEvent.click(fields.getByRole("button", { name: "Save Task" }));
  expect(fields.getByText("General · 15 min")).toBeVisible();
  fireEvent.submit(form);
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(saveSalesCatalogItem.mock.calls[0][2].metadata.taskTemplates).toEqual([
    expect.objectContaining({ name: "Inspect filter", estimatedMinutes: 15 }),
  ]);
});

test("catalog editing updates the visit pay range and retains custom task details", async () => {
  mockItems = [{ id: "existing", name: "Existing service", type: "service", sourceType: "manual", billingBehavior: "oneTime", unitAmountCents: 12500, unitCostCents: 3500, payTypeId: "clean", defaultQuantity: 1,
    metadata: { retained: "value", taskTemplates: [{ id: "task", name: "Custom inspection", description: "Keep my instructions", type: "Inspection", payTypeId: "clean", estimatedMinutes: 45 }] } }];
  openPage();
  fireEvent.click(await screen.findByRole("button", { name: "Edit Existing service", exact: true }));
  const form = screen.getByRole("form", { name: "Edit Service" });
  const fields = within(form);
  expect(fields.getByText("Keep my instructions")).toBeInTheDocument();
  expect(fields.getByText("Inspection · 45 min")).toBeInTheDocument();
  expect(fields.queryByLabelText("Task Name")).not.toBeInTheDocument();
  fireEvent.click(fields.getByRole("button", { name: "Edit task Custom inspection" }));
  fireEvent.change(fields.getByLabelText("Notes"), { target: { value: "Canceled instructions" } });
  fireEvent.change(fields.getByLabelText("Estimated Minutes"), { target: { value: "20" } });
  toggleTaskAdvanced();
  fireEvent.click(within(fields.getByRole("group", { name: "Edit task Custom inspection" })).getByRole("button", { name: "Cancel" }));
  expect(fields.getByText("Keep my instructions")).toBeVisible();
  expect(fields.getByText("Inspection · 45 min")).toBeVisible();

  fireEvent.click(fields.getByRole("button", { name: "Edit task Custom inspection" }));
  toggleTaskAdvanced();
  fireEvent.click(fields.getByRole("button", { name: "Save Task" }));
  expect(fields.queryByLabelText("Payroll quantity")).not.toBeInTheDocument();
  toggleAdvanced();
  const estimate = fields.getByRole("region", { name: "Service technician pay preview" });
  expect(within(estimate).getByText("$20.00 – $40.00")).toBeInTheDocument();
  fireEvent.click(within(estimate).getByRole("button", { name: "Use high estimate for internal cost" }));
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  const saved = saveSalesCatalogItem.mock.calls[0][2];
  expect(saved).toEqual(expect.objectContaining({ id: "existing", unitAmountCents: 12500, unitCostCents: 4000 }));
  expect(saved.metadata.retained).toBe("value");
  expect(saved.metadata.taskTemplates[0]).toEqual(expect.objectContaining({ name: "Custom inspection", description: "Keep my instructions", type: "Inspection" }));
});

test("an independent pay type preserves the legacy database source and its read-only cost", async () => {
  mockItems = [{ id: 'existing', name: 'Linked service', type: 'service', sourceType: 'databaseItem', sourceId: 'db-product', billingBehavior: 'recurring', unitAmountCents: 12500, unitCostCents: 3500, metadata: {} }];
  openPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Linked service', exact: true }));
  const form = screen.getByRole('form', { name: 'Edit Service' });
  const fields = within(form);
  expect(fields.getByLabelText('Source Type')).toBeVisible();
  expect(fields.getByLabelText('Taxable')).not.toBeVisible();
  expect(fields.getByLabelText('Recurs Every')).not.toBeVisible();
  expect(fields.getByText('Stripe Object')).not.toBeVisible();
  toggleAdvanced();
  expect(fields.getByLabelText('Taxable')).toBeVisible();
  expect(fields.getByLabelText('Recurs Every')).toBeVisible();
  expect(fields.getByText('Stripe Object')).toBeVisible();
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'clean' } });
  fireEvent.click(fields.getByLabelText('Taxable'));
  fireEvent.change(fields.getByLabelText('Recurs Every'), { target: { value: 'week' } });
  toggleAdvanced();
  expect(fields.getByLabelText('Recurs Every')).not.toBeVisible();
  expect(fields.getByLabelText('Source Type')).toHaveValue('databaseItem');
  expect(fields.queryByLabelText('Internal Cost', { exact: true })).not.toBeInTheDocument();
  expect(within(fields.getByRole('region', { name: 'Service internal cost' })).getByText('$35.00')).toBeVisible();
  fireEvent.submit(form);
  await waitFor(() => expect(saveSalesCatalogItem).toHaveBeenCalled());
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(saveSalesCatalogItem.mock.calls[0][2]).toEqual(expect.objectContaining({
    payTypeId: 'clean', payTypeName: 'Filter clean', sourceType: 'databaseItem', sourceId: 'db-product', unitCostCents: 3500, unitAmountCents: 12500,
    taxable: true, stripeRecurringInterval: 'week',
  }));
});

test("pay-type sources display their cost and accept an estimate from Advanced", async () => {
  openPage();
  fireEvent.click(screen.getByRole('button', { name: 'Create Service', exact: true }));
  const form = screen.getByRole('form', { name: 'Create Service', exact: true });
  const fields = within(form);
  const source = fields.getByLabelText('Source Type');
  expect(source).toHaveValue('manual');
  expect(fields.getByLabelText('Internal Cost')).toBeVisible();
  fireEvent.change(source, { target: { value: 'serviceStopType' } });
  expect(fields.getByLabelText('Technician pay type')).toBeVisible();
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'clean' } });
  fireEvent.click(fields.getByRole('button', { name: 'Add Task', exact: true }));
  const serviceCost = within(fields.getByRole('region', { name: 'Service internal cost' }));
  expect(serviceCost.getByText('Not set')).toBeVisible();
  expect(serviceCost.queryByRole('spinbutton')).not.toBeInTheDocument();
  toggleAdvanced();
  const preview = fields.getByRole('region', { name: 'Service technician pay preview' });
  expect(within(preview).getByText('$20.00 – $40.00')).toBeInTheDocument();
  fireEvent.click(within(preview).getByRole('button', { name: 'Use high estimate for internal cost' }));
  expect(serviceCost.getByText('$40.00')).toBeVisible();
  expect(serviceCost.queryByRole('spinbutton')).not.toBeInTheDocument();
  fireEvent.change(source, { target: { value: 'manual' } });
  expect(serviceCost.getByLabelText('Internal Cost')).toHaveValue(40);
  fireEvent.change(source, { target: { value: 'serviceStopType' } });
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

test("catalog estimates are scoped to visits and task forms contain no money fields", async () => {
  openPage();
  fireEvent.click(screen.getByRole('button', { name: 'Create Service', exact: true }));
  const fields = within(screen.getByRole('form', { name: 'Create Service' }));
  fireEvent.change(fields.getByLabelText('Source Type'), { target: { value: 'serviceStopType' } });
  fireEvent.change(fields.getByLabelText('Technician pay type'), { target: { value: 'clean' } });
  const serviceCost = within(fields.getByRole('region', { name: 'Service internal cost' }));
  toggleAdvanced();
  const preview = within(fields.getByRole('region', { name: 'Service technician pay preview' }));
  expect(serviceCost.getByText('Not set')).toBeVisible();
  fireEvent.click(fields.getByRole('button', { name: 'Add Task', exact: true }));
  expect(fields.queryByLabelText('Contracted task pay')).not.toBeInTheDocument();
  expect(fields.queryByRole('region', { name: 'Task technician pay preview' })).not.toBeInTheDocument();
  expect(fields.getByLabelText('Estimated Minutes')).toBeInTheDocument();
  toggleTaskAdvanced();
  expect(fields.queryByLabelText('Customer task price')).not.toBeInTheDocument();
  expect(fields.queryByLabelText('Task pay')).not.toBeInTheDocument();
  expect(preview.getByText('$20.00 – $40.00')).toBeInTheDocument();
  fireEvent.click(preview.getByRole('button', { name: 'Use high estimate for internal cost' }));
  expect(serviceCost.getByText('$40.00')).toBeVisible();
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
  fireEvent.click(fields.getByRole("button", { name: "Save Task" }));
  expect(fields.getByText("Variable speed pump · Qty 2")).toBeInTheDocument();
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
  expect(fields.getByText('Suggested customer price: $100.00')).not.toBeVisible();
  toggleAdvanced();
  expect(fields.getByText('Suggested customer price: $100.00')).toBeVisible();
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
