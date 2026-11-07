import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { Context } from "../../../../context/AuthContext";
import EmailConfiguration from "./EmailConfiguration";

jest.mock("../../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../../utils/config", () => ({ db: {} }));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"),
  doc: (base, ...parts) => typeof base === "string" ? [base, ...parts].join("/") : parts.join("/"),
  query: value => value, where: jest.fn(), orderBy: jest.fn(), serverTimestamp: () => "timestamp",
  getDoc: jest.fn(), getDocs: jest.fn(), setDoc: jest.fn(), writeBatch: jest.fn(),
}));
const snapshot = rows => ({ docs: rows, forEach: action => rows.forEach(action) });
const record = (id, data) => ({ id, data: () => data });
let batch;
beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ emailIsOn: true }) });
  getDocs.mockImplementation(ref => Promise.resolve(ref.endsWith("/customers")
    ? snapshot([record("new", { firstName: "New", lastName: "Customer", active: true }), record("off", { firstName: "Off", lastName: "Customer", active: true })])
    : snapshot([record("legacy-off", { customerId: "off", emailIsOn: false })])));
  batch = { set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
  setDoc.mockResolvedValue(undefined);
});
async function open() {
  render(<MemoryRouter><Context.Provider value={{ recentlySelectedCompany: "company", recentlySelectedCompanyName: "Pool Company" }}><EmailConfiguration /></Context.Provider></MemoryRouter>);
  await screen.findByRole("row", { name: /New Customer/ });
}
const customerToggle = name => within(screen.getByRole("row", { name: new RegExp(name) })).getByRole("button");

test("customers with no saved preference start on while explicit off choices stay off", async () => {
  await open();
  expect(customerToggle("New Customer")).toHaveTextContent("On");
  expect(customerToggle("Off Customer")).toHaveTextContent("Off");
  expect(setDoc).not.toHaveBeenCalled();
  expect(batch.commit).not.toHaveBeenCalled();
});
test("a customer can opt out directly from the default on state", async () => {
  await open();
  fireEvent.click(customerToggle("New Customer"));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(batch.set).toHaveBeenCalledWith("companies/company/settings/emailConfiguration/customerConfiguration/new", expect.objectContaining({ customerId: "new", emailIsOn: false }), { merge: true });
  await waitFor(() => expect(customerToggle("New Customer")).toHaveTextContent("Off"));
});
test("company-wide off preserves individual customer preferences", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Toggle company email sending" }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith("companies/company/settings/emailConfiguration", expect.objectContaining({ emailIsOn: false }), { merge: true }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Toggle company email sending" })).not.toBeDisabled());
  expect(customerToggle("New Customer")).toHaveTextContent("On");
  expect(customerToggle("Off Customer")).toHaveTextContent("Off");
  expect(batch.commit).not.toHaveBeenCalled();
});
test("conflicting legacy records show off and enabling the customer updates every record", async () => {
  getDocs.mockImplementation(ref => Promise.resolve(ref.endsWith("/customers")
    ? snapshot([record("new", { firstName: "New", lastName: "Customer", active: true })])
    : snapshot([record("legacy-a", { customerId: "new", emailIsOn: false }), record("legacy-z", { customerId: "new", emailIsOn: true })])));
  await open();
  expect(customerToggle("New Customer")).toHaveTextContent("Off");
  fireEvent.click(customerToggle("New Customer"));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(batch.set.mock.calls.map(([ref, data]) => [ref.split("/").pop(), data.emailIsOn])).toEqual([["legacy-a", true], ["legacy-z", true]]);
  await waitFor(() => expect(customerToggle("New Customer")).toHaveTextContent("On"));
});
test("a failed company-wide save does not falsely show sending as disabled", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  setDoc.mockRejectedValueOnce(new Error("Save failed"));
  try {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Toggle company email sending" }));
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Toggle company email sending" })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Toggle company email sending" })).toHaveAttribute("aria-pressed", "true");
  } finally { log.mockRestore(); }
});
