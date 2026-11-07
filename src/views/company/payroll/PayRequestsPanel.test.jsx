import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { onSnapshot } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { technicianWorkflow } from "../../../utils/technicianWorkflow";
import PayRequestsPanel from "./PayRequestsPanel";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../utils/technicianWorkflow", () => ({ technicianWorkflow: jest.fn() }));
jest.mock("../../../hooks/usePayrollNotifications", () => { const notify = jest.fn(); return () => notify; });
jest.mock("firebase/firestore", () => ({ collection: (_, ...parts) => parts.join("/"), where: (...parts) => parts, query: (path, ...constraints) => ({ path, constraints }), onSnapshot: jest.fn() }));

const context = { user: { uid: "alex" }, companyRoleLoaded: true, hasCompanyPermission: () => true };
const snap = rows => ({ docs: rows.map(({ id, ...fields }) => ({ id, data: () => fields })) });
const own = { id: "own", technicianId: "alex", technicianName: "Alex", type: "payout", status: "Pending", amountCents: 7500, reason: "My request" };
const other = { ...own, id: "other", technicianId: "sam", technicianName: "Sam", reason: "Private other pay" };
const mount = (props = {}, ctx = context) => <Context.Provider value={ctx}><PayRequestsPanel companyId="north" {...props} /></Context.Provider>;
let callbacks;

beforeEach(() => {
  jest.clearAllMocks();
  callbacks = [];
  onSnapshot.mockImplementation((ref, next, error) => {
    callbacks.push({ ref, next, error });
    next(snap([own, other]));
    return jest.fn();
  });
  technicianWorkflow.mockResolvedValue({ requestId: "new" });
  Object.defineProperty(global, "crypto", { configurable: true, value: { randomUUID: () => "request-id" } });
});

test("self audience always scopes requests to the signed-in technician, including managers", async () => {
  render(mount({ audience: "self", initialRequestType: "payout" }));
  expect(screen.getByRole("region", { name: "My Pay Requests" })).toHaveTextContent("My request");
  expect(screen.queryByText("Private other pay")).not.toBeInTheDocument();
  expect(callbacks[0].ref.constraints).toContainEqual(["technicianId", "==", "alex"]);
  expect(screen.queryByLabelText("Propose to technician")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Approve|Reject|Counteroffer/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Requested amount"), { target: { value: "75" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Please pay my completed work" } });
  fireEvent.submit(screen.getByRole("form", { name: "Pay request" }));
  await waitFor(() => expect(technicianWorkflow).toHaveBeenCalledWith("manageTechnicianPayRequest", expect.objectContaining({ companyId: "north", action: "create", technicianId: "alex", type: "payout", amountCents: 7500 })));
});

test("management requests retain company-wide review and approval controls", () => {
  render(mount());
  expect(callbacks[0].ref).toBe("companies/north/payChangeRequests");
  expect(screen.getByText("Private other pay")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "approve" })).toHaveLength(2);
  expect(screen.getByLabelText("Propose to technician")).toBeInTheDocument();
});

test("correction requests use a work selector containing only the person's own nonvoided work", () => {
  render(mount({ audience: "self", payItems: [
    { id: "filter", technicianId: "alex", taskName: "Clean filter", totalAmountCents: 7500 },
    { id: "zero", technicianId: "alex", taskName: "Included water test", totalAmountCents: 0, calculationStatus: "calculated" },
    { id: "review", technicianId: "alex", taskName: "Missing rate", totalAmountCents: 0, calculationStatus: "needsReview" },
    { id: "secret", technicianId: "sam", taskName: "Private repair" },
    { id: "voided", technicianId: "alex", taskName: "Voided task", calculationStatus: "voided" },
  ] }));
  fireEvent.change(screen.getByLabelText("Request type"), { target: { value: "payCorrection" } });
  expect(screen.getByLabelText("Completed work")).toHaveTextContent("Clean filter");
  expect(screen.queryByRole("option", { name: /Private repair|Voided task|Included water test/ })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Missing rate.*Pending/ })).toBeInTheDocument();
  expect(screen.queryByLabelText("Earned-pay item ID")).not.toBeInTheDocument();
});

test("stale request callbacks cannot reveal the previous company or user", () => {
  const view = render(mount({ audience: "self" }));
  const old = callbacks[0];
  onSnapshot.mockImplementation((ref, next, error) => { callbacks.push({ ref, next, error }); return jest.fn(); });
  view.rerender(mount({ audience: "self", companyId: "south" }));
  expect(screen.queryByText("My request")).not.toBeInTheDocument();
  act(() => old.next(snap([own])));
  expect(screen.queryByText("My request")).not.toBeInTheDocument();
  view.rerender(mount({ audience: "self", companyId: "south" }, { ...context, user: { uid: "sam" } }));
  expect(callbacks[callbacks.length - 1].ref.constraints).toContainEqual(["technicianId", "==", "sam"]);
});

test("failed personal request reads show an error instead of claiming an empty history", () => {
  onSnapshot.mockImplementation((ref, next, error) => { error(new Error("offline")); return jest.fn(); });
  render(mount({ audience: "self" }));
  expect(screen.getByRole("alert")).toHaveTextContent("offline");
  expect(screen.queryByText("No pay requests yet.")).not.toBeInTheDocument();
});
