import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import AlphaWaterReceiptImport from "./AlphaWaterReceiptImport";
import CreateNewPurchase from "./CreateNewPurchase";
import HeritageReceiptImport from "./HeritageReceiptImport";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, storage: {} }));
jest.mock("../../../utils/vendors", () => ({
  fetchCompanyVendors: async () => [{ id: "vendor", name: "Supply Store", label: "Supply Store" }],
}));
jest.mock("pdfjs-dist/webpack", () => ({}));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock("firebase/firestore", () => ({
  arrayUnion: (...values) => values,
  collection: (_, ...parts) => parts.join("/"),
  doc: (_, ...parts) => parts.join("/"),
  getDocs: jest.fn(),
  orderBy: jest.fn(),
  query: (path) => path,
  writeBatch: jest.fn(),
}));
jest.mock("react-select", () => ({ value, options, onChange, placeholder }) => (
  <select
    aria-label={placeholder}
    value={value?.value || value?.id || ""}
    onChange={(event) => onChange(options.find((option) => (option.value || option.id) === event.target.value) || null)}
  >
    <option value="">Choose</option>
    {options.map((option) => <option key={option.value || option.id} value={option.value || option.id}>{option.label || option.name}</option>)}
  </select>
));

const productPath = "/settings/genericItems/genericItems/";
const unavailable = {
  active: false,
  availableForJobs: false,
  availableForJob: false,
  jobProductAvailable: false,
  availableForPartApproval: false,
  partApprovalAvailable: false,
  availableForCustomerSale: false,
  availableForPartPurchase: false,
  partPurchaseAvailable: false,
};
let batch;

beforeEach(() => {
  jest.clearAllMocks();
  batch = { set: jest.fn(), update: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
  getDocs.mockImplementation(async (path) => ({
    docs: path.endsWith("/genericItems/genericItems") ? [{
      id: "existing", data: () => ({ id: "existing", commonName: "Existing seal", ...unavailable }),
    }] : [],
  }));
});

const open = (Screen) => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Context.Provider value={{ recentlySelectedCompany: "com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e" }}>
      <Screen />
    </Context.Provider>
  </MemoryRouter>
);

const disableAvailability = (form) => {
  const checkboxes = within(form).getAllByRole("checkbox");
  expect(checkboxes.map((input) => input.getAttribute("aria-label"))).toEqual([
    "Active", "Jobs", "Part Approval Sales", "Part Purchase",
  ]);
  for (const checkbox of checkboxes) {
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
  }
};

const savedProduct = () => batch.set.mock.calls.find(([path]) => path.includes(productPath))?.[1];

test("manual receipt vendor item creation saves the selected product availability", async () => {
  open(CreateNewPurchase);
  fireEvent.click(await screen.findByRole("button", { name: "Create Item", exact: true }));
  fireEvent.change(screen.getByLabelText("Vendor Item Name"), { target: { value: "New seal" } });
  disableAvailability(screen.getByRole("group", { name: "Availability" }));
  fireEvent.click(screen.getByRole("button", { name: "Create Vendor Item", exact: true }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(savedProduct()).toMatchObject({ name: "New seal", ...unavailable });
});

test.each([
  ["Alpha Water", AlphaWaterReceiptImport],
  ["Heritage", HeritageReceiptImport],
])("%s receipt lines persist availability in the receipt batch", async (_, Importer) => {
  open(Importer);
  await waitFor(() => expect(screen.getByLabelText("Vendor")).toHaveValue("vendor"));
  fireEvent.change(screen.getByLabelText("Invoice #"), { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Line Item" }));
  fireEvent.click(screen.getByText("Product Availability"));
  disableAvailability(screen.getByRole("group", { name: "Availability" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Confirmed Receipt" }));
  fireEvent.click(screen.getByRole("button", { name: "Create Receipt", exact: true }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(savedProduct()).toMatchObject(unavailable);
  expect(batch.set).toHaveBeenCalledWith(expect.stringContaining("/receipts/"), expect.objectContaining({ invoiceNum: "123" }));
});

test("Alpha Water's inline creator carries over line settings and saves them on the new product", async () => {
  open(AlphaWaterReceiptImport);
  await waitFor(() => expect(screen.getByLabelText("Vendor")).toHaveValue("vendor"));
  fireEvent.click(screen.getByRole("button", { name: "Add Line Item" }));
  fireEvent.click(screen.getByText("Product Availability"));
  disableAvailability(screen.getByRole("group", { name: "Availability" }));
  fireEvent.click(screen.getByRole("button", { name: "Create Vendor Item" }));
  const dialog = within(screen.getByRole("dialog", { name: "Create Vendor Item" }));
  const jobs = dialog.getByRole("checkbox", { name: "Jobs" });
  expect(jobs).not.toBeChecked();
  fireEvent.click(jobs);
  fireEvent.click(dialog.getByRole("button", { name: "Create Vendor Item" }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(savedProduct()).toMatchObject({
    ...unavailable, availableForJobs: true, availableForJob: true, jobProductAvailable: true,
  });
});

test("connecting to an existing product from Alpha Water preserves its availability", async () => {
  open(AlphaWaterReceiptImport);
  await waitFor(() => expect(screen.getByLabelText("Vendor")).toHaveValue("vendor"));
  fireEvent.click(screen.getByRole("button", { name: "Add Line Item" }));
  fireEvent.click(screen.getByRole("button", { name: "Create Vendor Item" }));
  const dialog = within(screen.getByRole("dialog", { name: "Create Vendor Item" }));
  fireEvent.change(dialog.getByLabelText("Connect to an existing product"), { target: { value: "existing" } });
  expect(dialog.queryByRole("group", { name: "Availability" })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "Create Vendor Item" }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(savedProduct()).toBeUndefined();
  const connection = batch.update.mock.calls.find(([path]) => path.endsWith(`${productPath}existing`))?.[1];
  expect(connection).toBeDefined();
  for (const key of Object.keys(unavailable)) expect(connection).not.toHaveProperty(key);
});
