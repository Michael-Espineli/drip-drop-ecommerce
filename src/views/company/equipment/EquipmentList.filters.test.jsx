import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { getDoc, getDocs } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import EquipmentList from "./EquipmentList";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: () => true }));
jest.mock("firebase/firestore", () => ({
  collection: (base, ...parts) => [typeof base === "string" ? base : "", ...parts].filter(Boolean).join("/"),
  doc: (_, ...parts) => parts.join("/"), query: (ref) => ref, orderBy: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(),
}));
const snapshot = (id, data, path = "") => ({ id, ref: `${path}/${id}`, exists: () => true, data: () => data });
const customers = [
  { id: "c1", active: true, tags: ["R3", "VIP"] },
  { id: "c2", active: true, tags: "r3, Commercial" },
  { id: "c3", active: true, tags: ["R1"] },
];
const equipment = customers.map((customer, index) => ({
  id: `e${index}`, customerId: customer.id, customerName: `Customer ${index + 1}`,
  serviceLocationId: `location-${index}`, type: "Filter", needsService: true, isActive: true,
  status: "Needs Maintenance", nextServiceDate: new Date(2020, 0, 1),
}));
const recurringStops = [
  { id: "s1", serviceLocationId: "location-0", techId: "alex-auth", tech: "Alex Tech", noEndDate: true },
  { id: "s2", serviceLocationId: "location-1", techId: "blair-company", tech: "Blair Tech", noEndDate: true },
  { id: "s3", serviceLocationId: "location-2", techId: "alex-company", tech: "Alex Tech", noEndDate: true },
  { id: "ended", serviceLocationId: "location-1", techId: "alex-auth", tech: "Alex Tech", active: false },
  { id: "expired", serviceLocationId: "location-1", techId: "alex-auth", tech: "Alex Tech", endDate: new Date(2020, 0, 1) },
];
beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockImplementation(async (path) => snapshot(path.split("/").pop(), customers.find((customer) => path.endsWith(`/customers/${customer.id}`)) || {}));
  getDocs.mockImplementation(async (path) => ({ docs: (
    path.endsWith("/equipment") ? equipment : path.endsWith("/customers") ? customers
      : path.endsWith("/recurringServiceStop") ? recurringStops
        : path.endsWith("/companyUsers") ? [
          { id: "alex-company", userId: "alex-auth", userName: "Alex Tech" },
          { id: "blair-company", userId: "blair-auth", userName: "Blair Tech" },
        ] : []
  ).map(({ id, ...data }) => snapshot(id, data, path)) }));
});
const renderList = (company = "company-1", tab = "all-equipment") => <MemoryRouter initialEntries={[`/company/equipment/${tab}`]}>
  <Context.Provider value={{ recentlySelectedCompany: company }}>
    <Routes><Route path="/company/equipment/:tab" element={<EquipmentList />} /></Routes>
  </Context.Provider>
</MemoryRouter>;
const customerRows = () => within(screen.getByRole("table")).queryAllByRole("link", { name: /^Customer \d$/ }).map((link) => link.textContent);
const pick = async (label, value) => {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: value }));
};

test.each(["all-equipment", "needs-maintenance", "needs-repair", "non-operational", "upcoming"])("RSS technician and customer tags intersect on %s and reset together", async (tab) => {
  const originalStatus = equipment.map((item) => item.status);
  const originalDates = equipment.map((item) => item.nextServiceDate);
  equipment.forEach((item) => {
    if (tab === "needs-repair") item.status = "Needs Repair";
    if (tab === "non-operational") item.status = "Non-Operational";
    if (tab === "upcoming") {
      item.status = "Operational";
      item.nextServiceDate = new Date(Date.now() + 86400000 * 3);
    }
  });
  try {
    render(renderList("company-1", tab));
    await waitFor(() => expect(customerRows()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    await pick("RSS Technician", "Alex Tech");
    await waitFor(() => expect(customerRows()).toEqual(["Customer 1", "Customer 3"]));
    await pick("Customer Tags", "R3");
    await waitFor(() => expect(customerRows()).toEqual(["Customer 1"]));
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
    await pick("Customer Tags", "R1");
    await waitFor(() => expect(customerRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(customerRows()).toHaveLength(3));
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  } finally {
    equipment.forEach((item, index) => { item.status = originalStatus[index]; item.nextServiceDate = originalDates[index]; });
  }
});

test("search combines with RSS selection; filters persist across tabs and clear when switching companies", async () => {
  const view = render(renderList());
  await waitFor(() => expect(customerRows()).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  await pick("RSS Technician", "Alex Tech");
  await pick("Customer Tags", "R3");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: /^Needs Maintenance/ }));
  await waitFor(() => expect(customerRows()).toEqual(["Customer 1"]));
  await userEvent.type(screen.getByPlaceholderText("Search customer, address, job, make, model, status, notes..."), "Customer 2");
  await waitFor(() => expect(customerRows()).toHaveLength(0));
  fireEvent.click(screen.getByRole("button", { name: "Reset Filters" }));
  await waitFor(() => expect(customerRows()).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  await pick("Customer Tags", "R1");
  view.rerender(renderList("company-2"));
  expect(await screen.findByRole("button", { name: "Filters" })).toBeInTheDocument();
  await waitFor(() => expect(customerRows()).toHaveLength(3));
});
