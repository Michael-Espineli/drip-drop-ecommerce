import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDoc, getDocs, updateDoc } from "firebase/firestore";
import { Context } from "../../context/AuthContext";
import ProfilePage from "./ProfilePage";

jest.mock("../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../utils/config", () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"),
  where: (...args) => args, limit: (...args) => args, orderBy: (...args) => args,
  query: (path, ...constraints) => ({ path, constraints }), getDoc: jest.fn(), getDocs: jest.fn(), updateDoc: jest.fn(),
}));
jest.mock("firebase/auth", () => ({ updateProfile: jest.fn() }));
jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn() }));
jest.mock("firebase/storage", () => ({ getDownloadURL: jest.fn(), ref: jest.fn(), uploadBytes: jest.fn() }));
jest.mock("../../utils/passwordReset", () => ({ getPasswordResetRecipientEmail: jest.fn(), sendAccountPasswordResetEmail: jest.fn() }));

const person = { firstName: "Alex", lastName: "Rivera", email: "alex@example.com", phoneNumber: "555-0100", bio: "Pool service technician" };
const base = { user: { uid: "alex" }, dataBaseUser: person, setDataBaseUser: jest.fn(), recentlySelectedCompany: "north", recentlySelectedCompanyName: "North Pools", hasCompanyPermission: () => true };
const snapshot = (rows) => ({ docs: rows.map(({ id, ...fields }) => ({ id, data: () => fields })) });
const renderPage = (value = base) => <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={value}><ProfilePage /></Context.Provider></MemoryRouter>;

beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => true, id: "north", data: () => ({ name: "North Pools", ownerId: "owner" }) });
  getDocs.mockImplementation(async ({ path }) => {
    if (path.endsWith("companyUsers")) return snapshot([{ id: "worker", userId: "alex", roleName: "Technician", workerType: "Employee" }]);
    if (path.endsWith("technicianPayLineItems")) return snapshot([
      { id: "own", technicianId: "alex", totalAmountCents: 13500, calculationStatus: "calculated", completedDate: new Date() },
      { id: "other", technicianId: "someone-else", totalAmountCents: 99900, calculationStatus: "calculated", completedDate: new Date() },
    ]);
    return snapshot([]);
  });
});

test("shows the shared profile sections, own payout, and existing payroll destinations", async () => {
  render(renderPage());
  const payout = await screen.findByRole("region", { name: "Payout Snapshot" });
  await waitFor(() => expect(payout).toHaveTextContent("$135.00"));
  expect(payout).not.toHaveTextContent("$999.00");
  expect(within(payout).getByRole("link", { name: "Open Paysheet" })).toHaveAttribute("href", "/company/payroll?tab=statements");
  expect(within(payout).getByRole("link", { name: "Pay Requests" })).toHaveAttribute("href", "/company/payroll?tab=requests");
  expect(screen.getAllByRole("region").map(node => node.getAttribute("aria-label"))).toEqual(["Payout Snapshot", "Account Info", "My Work History", "Selected Company", "Connected Accounts", "Settings"]);
  expect(getDocs.mock.calls.find(([ref]) => ref.path.endsWith("technicianPayLineItems"))[0].constraints).toContainEqual(["technicianId", "==", "alex"]);
});

test("editing and cancelling restores saved profile details without writing", async () => {
  render(renderPage());
  await screen.findByText("Technician");
  fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
  fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
  expect(screen.getByLabelText("First Name")).toHaveValue("Alex");
  expect(updateDoc).not.toHaveBeenCalled();
});

test("does not fetch or expose payout information when payroll access is absent", async () => {
  render(renderPage({ ...base, hasCompanyPermission: () => false }));
  await screen.findByText("Technician");
  expect(screen.queryByRole("region", { name: "Payout Snapshot" })).not.toBeInTheDocument();
  expect(getDocs.mock.calls.some(([ref]) => ref.path.includes("technicianPay"))).toBe(false);
});

test("company changes clear previous payout immediately and ignore late results", async () => {
  const view = render(renderPage());
  await screen.findByText("$135.00");
  let finish;
  getDoc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  view.rerender(renderPage({ ...base, recentlySelectedCompany: "south", recentlySelectedCompanyName: "South Pools" }));
  expect(screen.queryByText("$135.00")).not.toBeInTheDocument();
  view.rerender(renderPage({ ...base, recentlySelectedCompany: null }));
  await act(async () => finish({ exists: () => true, id: "south", data: () => ({ name: "Old result" }) }));
  expect(screen.queryByRole("region", { name: "Payout Snapshot" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Select Company" })).toHaveAttribute("href", "/company/selection");
});

test("failed reads show unavailable feedback without a misleading zero payout", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  getDoc.mockRejectedValue(new Error("offline"));
  render(renderPage());
  const payout = screen.getByRole("region", { name: "Payout Snapshot" });
  await waitFor(() => expect(payout).toHaveTextContent("Payout history is unavailable."));
  expect(payout).not.toHaveTextContent("$0.00");
  log.mockRestore();
});
