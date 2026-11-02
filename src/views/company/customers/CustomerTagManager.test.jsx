import React, { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Context } from "../../../context/AuthContext";
import { appConfirm } from "../../../utils/appDialog";
import CustomerTagManager from "./CustomerTagManager";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {} }));
jest.mock("../../../utils/appDialog", () => ({ appConfirm: jest.fn() }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ requirePermission: () => true }));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"),
  doc: (_, ...parts) => parts.join("/"),
  getDocs: jest.fn(),
  writeBatch: jest.fn(),
}));
jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn() }));

const mockSet = jest.fn();
const mockCommit = jest.fn();
const mockUpdateAccess = jest.fn();
const sampleData = {
  customers: [
    { id: "amy", firstName: "Amy", active: true, tags: ["East"], zip: "85251" },
    { id: "ben", firstName: "Ben", active: true, tags: ["West"], zip: "85255" },
    { id: "iris", firstName: "Iris", active: false, tags: ["West"], zip: "85255" },
  ],
  recurringRoutes: [
    { id: "monday", name: "Monday North", techId: "alex-auth", order: [{ customerId: "amy" }] },
    { id: "friday", name: "Friday South", techId: "blair-auth", order: [{ customerId: "ben" }] },
  ],
  companyUsers: [
    { id: "alex-document", userId: "alex-auth", userName: "Alex Rivera", customerTagAccess: ["East"] },
    { id: "blair-document", userId: "blair-auth", userName: "Blair Chen" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCommit.mockResolvedValue(undefined);
  mockUpdateAccess.mockResolvedValue({});
  writeBatch.mockReturnValue({ set: mockSet, commit: mockCommit });
  httpsCallable.mockReturnValue(mockUpdateAccess);
  appConfirm.mockResolvedValue(true);
  getDocs.mockImplementation(async (ref) => ({
    docs: (sampleData[ref.split("/").pop()] || []).map(({ id, ...data }) => ({ id, data: () => data })),
  }));
});

const openPage = async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Context.Provider value={{ recentlySelectedCompany: "company", user: { getIdToken: async () => "test-token" } }}>
        <CustomerTagManager />
      </Context.Provider>
    </MemoryRouter>
  );
  await screen.findByRole("row", { name: /Amy/ });
};

const choose = async (label, query, optionName) => {
  const input = screen.getByRole("combobox", { name: label });
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
  return input;
};

const clickAction = async (name) => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
};

test("existing tags can be searched, cleared, and replaced by a new tag without saving", async () => {
  await openPage();
  expect(screen.getAllByRole("combobox")).toHaveLength(4);
  const input = screen.getByRole("combobox", { name: "Existing tag" });
  fireEvent.change(input, { target: { value: "wes" } });
  expect(await screen.findByRole("option", { name: "West" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "East" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "West" }));
  expect(screen.getByText("Active tag: West")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(screen.getByText("Active tag: None selected")).toBeInTheDocument();
  await choose("Existing tag", "east", "East");
  fireEvent.change(screen.getByPlaceholderText("Or type a new tag"), { target: { value: "Central" } });
  expect(screen.getByText("Active tag: Central")).toBeInTheDocument();
  expect(screen.queryByText("East", { selector: ".react-select__single-value" })).not.toBeInTheDocument();
  expect(writeBatch).not.toHaveBeenCalled();
});

test("searching a route selects its customers and renamed tag actions write only selected customers", async () => {
  await openPage();
  await choose("Existing tag", "wes", "West");
  const routeInput = await choose("Recurring route", "north", "Monday North");
  fireEvent.click(screen.getByRole("button", { name: "Select Route Customers" }));
  expect(within(screen.getByRole("row", { name: /Amy/ })).getByRole("checkbox")).toBeChecked();
  expect(within(screen.getByRole("row", { name: /Ben/ })).getByRole("checkbox")).not.toBeChecked();
  expect(writeBatch).not.toHaveBeenCalled();
  await clickAction("Add Tag to Selected Customers");
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(mockSet).toHaveBeenLastCalledWith("companies/company/customers/amy", { tags: ["East", "West"] }, { merge: true });
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove Tag from Selected Customers" })).toBeEnabled());
  await clickAction("Remove Tag from Selected Customers");
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(2));
  expect(mockSet).toHaveBeenLastCalledWith("companies/company/customers/amy", { tags: ["East"] }, { merge: true });
  fireEvent.keyDown(routeInput, { key: "Backspace" });
  expect(screen.getByRole("button", { name: "Select Route Customers" })).toBeDisabled();
});

test("technician search preserves matching by user ID and access updates by document ID", async () => {
  await openPage();
  await choose("Existing tag", "wes", "West");
  const technicianInput = await choose("Technician", "rivera", "Alex Rivera");
  fireEvent.click(screen.getByRole("button", { name: "Select Technician’s Customers" }));
  expect(within(screen.getByRole("row", { name: /Amy/ })).getByRole("checkbox")).toBeChecked();
  expect(within(screen.getByRole("row", { name: /Ben/ })).getByRole("checkbox")).not.toBeChecked();
  await clickAction("Assign Tag to Technician Access");
  await waitFor(() => expect(mockUpdateAccess).toHaveBeenCalledWith(expect.objectContaining({
    companyId: "company", companyUserId: "alex-document", idToken: "test-token",
    updates: expect.objectContaining({ fullCustomerRegionAccess: false, customerTagAccess: ["East", "West"] }),
  })));
  fireEvent.keyDown(technicianInput, { key: "Backspace" });
  expect(screen.getByRole("button", { name: "Assign Tag to Technician Access" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select Technician’s Customers" })).toBeDisabled();
});

test("status search and bulk removal keep the existing status scope and confirm customers hidden by search", async () => {
  await openPage();
  await choose("Customer status", "inactive", "Inactive Customers");
  expect(screen.getByRole("row", { name: /Iris/ })).toBeInTheDocument();
  expect(screen.queryByRole("row", { name: /Amy/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Select All Shown Customers" }));
  expect(within(screen.getByRole("row", { name: /Iris/ })).getByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Clear Customer Selection" }));
  expect(within(screen.getByRole("row", { name: /Iris/ })).getByRole("checkbox")).not.toBeChecked();
  await choose("Customer status", "active", "Active Customers");
  await choose("Existing tag", "wes", "West");
  fireEvent.change(screen.getByPlaceholderText("Search customers or tags"), { target: { value: "Amy" } });
  appConfirm.mockResolvedValueOnce(false);
  await clickAction("Remove Tag from All Active Customers");
  await waitFor(() => expect(appConfirm).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining("all active customers in your current area scope, including customers hidden by the search"),
  })));
  expect(writeBatch).not.toHaveBeenCalled();
  await clickAction("Remove Tag from All Active Customers");
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
  expect(mockSet).toHaveBeenCalledTimes(1);
  expect(mockSet).toHaveBeenCalledWith("companies/company/customers/ben", { tags: [] }, { merge: true });
});
