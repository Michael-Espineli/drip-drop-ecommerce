import React, { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { getDocs, getDoc, getCountFromServer, setDoc, runTransaction } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { technicianWorkflow } from "../../../utils/technicianWorkflow";
import { appConfirm } from "../../../utils/appDialog";
import { buildStatementCandidateGroups, statementPreviewSummary } from "../../../utils/payroll/statementCandidates";
import Payroll from "./Payroll";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../utils/technicianWorkflow", () => ({ technicianWorkflow: jest.fn() }));
jest.mock("../../../utils/appDialog", () => ({ appConfirm: jest.fn() }));
jest.mock("./PayRequestsPanel", () => () => null);
jest.mock("../../../components/FeatureInfoButton", () => () => null);
let mockManage;
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: () => mockManage, permissionsReady: true }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"), query: ref => ref,
  where: jest.fn(), orderBy: jest.fn(), startAfter: jest.fn(), limit: jest.fn(), documentId: jest.fn(),
  getDocs: jest.fn(), getDoc: jest.fn(), writeBatch: jest.fn(), updateDoc: jest.fn(), setDoc: jest.fn(), runTransaction: jest.fn(),
  getCountFromServer: jest.fn(),
}));

const generatedAt = new Date(2026, 9, 30, 12).getTime();
const line = (id, extra = {}) => ({ id, source: "serviceStop", technicianId: "tech", technicianName: "Alex",
  completedDate: new Date(2026, 9, 27, 10).getTime(), totalAmountCents: 5000, calculationStatus: "approved", taskName: id, ...extra });
const page = (items, extra = {}) => ({ lineItems: items, processedCount: items.length, skippedCount: 0, nextCursor: null, generatedAtMillis: generatedAt, ...extra });
const docs = items => ({ docs: items.map(item => ({ id: item.id, data: () => item })) });
let mockStatements;
beforeAll(() => { window.matchMedia = jest.fn(() => ({ matches: false })); });
beforeEach(() => {
  jest.clearAllMocks();
  mockManage = true;
  mockStatements = [];
  getDoc.mockResolvedValue({ exists: () => false });
  getDocs.mockImplementation(async ref => ref.endsWith("technicianPayStatements") ? docs(mockStatements)
    : ref.endsWith("companyUsers") ? docs([{ id: "tech", userId: "tech", userName: "Alex" }]) : docs([]));
  appConfirm.mockResolvedValue(true);
  technicianWorkflow.mockResolvedValue(page([line("pay-one")]));
});

const openStatements = async () => {
  render(<><MemoryRouter initialEntries={["/company/payroll"]}>
    <Context.Provider value={{ recentlySelectedCompany: "company", user: { uid: "owner" }, setPayrollEnabled: jest.fn() }}><Payroll /></Context.Provider>
  </MemoryRouter><Toaster /></>);
  await screen.findByRole("heading", { name: "Statement Previews" });
};
const generate = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Generate Previews" }));
  return screen.findByRole("button", { name: "Inspect" });
};

test("entry and date/filter changes fetch no pay-item candidates or payroll catalogs until confirmation", async () => {
  await openStatements();
  expect(technicianWorkflow).not.toHaveBeenCalled();
  expect(getCountFromServer).not.toHaveBeenCalled();
  expect(getDocs.mock.calls.some(([ref]) => /technicianPayLineItems|technicianRates|companyPayTypes|companyStopPayBuckets/.test(ref))).toBe(false);
  expect(getDoc.mock.calls.filter(([ref]) => ref.endsWith("settings/payStatements"))).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Payroll start date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Payroll end date"), { target: { value: "2026-10-31" } });
  await screen.findByRole("heading", { name: "Statement Previews" });
  fireEvent.change(screen.getByLabelText("Preview technician"), { target: { value: "tech" } });
  appConfirm.mockResolvedValueOnce(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Generate Previews" })));
  expect(appConfirm).toHaveBeenCalled();
  expect(technicianWorkflow).not.toHaveBeenCalled(); expect(setDoc).not.toHaveBeenCalled(); expect(runTransaction).not.toHaveBeenCalled();
  appConfirm.mockResolvedValueOnce(true);
  await generate();
  expect(technicianWorkflow).toHaveBeenCalledWith("previewPayrollStatements", {
    companyId: "company", startDateMillis: new Date(2026, 9, 1).getTime(), endDateExclusiveMillis: new Date(2026, 10, 1).getTime(), technicianId: "tech", cursor: null,
  });
  expect(appConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Generate statement previews", message: expect.stringContaining("Review the previews before creating statements") }));
});

test("manual generation waits for every page, reports completion, and invalidates previews on scope changes", async () => {
  const requests = [];
  technicianWorkflow.mockImplementation(() => new Promise(resolve => requests.push(resolve)));
  await openStatements();
  fireEvent.click(screen.getByRole("button", { name: "Generate Previews" }));
  const progress = await screen.findByRole("dialog", { name: "Generating statement previews" });
  const cursor = { id: "page-one", seconds: 1790812800, nanoseconds: 0 };
  await act(async () => requests[0](page(Array.from({ length: 200 }, (_, i) => line(`line-${i}`, { serviceStopId: `stop-${Math.floor(i / 100)}` })), { nextCursor: cursor, generatedAtMillis: null })));
  expect(within(progress).getByText(/Checked 200/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Inspect" })).not.toBeInTheDocument();
  expect(technicianWorkflow).toHaveBeenNthCalledWith(2, "previewPayrollStatements", expect.objectContaining({ cursor,
    summaryBeforePage: { technicianIds: ["tech"], serviceStopIds: ["stop-0", "stop-1"], totalAmountCents: 1000000 } }));
  await act(async () => requests[1](page([line("last-line", { totalAmountCents: -500, serviceStopId: "stop-1" })])));
  const inspect = await screen.findByRole("button", { name: "Inspect" });
  expect(screen.getByText("201 approved unpaid line item(s)")).toBeInTheDocument();
  const generationSummary = within(screen.getByRole("group", { name: "Last previews generated" }));
  expect(generationSummary.getByText("$9,995.00")).toBeInTheDocument();
  expect(generationSummary.getByText("1")).toBeInTheDocument();
  expect(generationSummary.getByText("2")).toBeInTheDocument();
  fireEvent.click(inspect);
  const detail = await screen.findByRole("dialog", { name: "Alex Statement Preview" });
  expect(within(detail).getByText("last-line")).toBeInTheDocument();
  fireEvent.click(within(detail).getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByLabelText("Payroll start date"), { target: { value: "2026-09-01" } });
  await screen.findByRole("heading", { name: "Statement Previews" });
  expect(screen.queryByRole("button", { name: "Inspect" })).not.toBeInTheDocument();
  expect(technicianWorkflow).toHaveBeenCalledTimes(2);
});

test("the saved generation summary appears after reload without fetching payroll rows", async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ lastPreviewGeneratedAt: generatedAt,
    lastPreviewSummary: { technicianCount: 3, totalAmountCents: 12500, stopCount: 7 } }) });
  await openStatements();
  const summary = within(screen.getByRole("group", { name: "Last previews generated" }));
  expect(summary.getByText("3")).toBeInTheDocument();
  expect(summary.getByText("$125.00")).toBeInTheDocument();
  expect(summary.getByText("7")).toBeInTheDocument();
  expect(technicianWorkflow).not.toHaveBeenCalled();
  expect(getDocs.mock.calls.some(([ref]) => ref.endsWith("technicianPayLineItems"))).toBe(false);
});

test("a failed later preview page exposes no partial groups and does not update the previous generation date", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ lastPreviewGeneratedAt: new Date(2026, 9, 20, 12) }) });
  technicianWorkflow.mockResolvedValueOnce(page([line("first")], { nextCursor: { id: "first", seconds: 1790812800, nanoseconds: 0 }, generatedAtMillis: null }))
    .mockRejectedValueOnce(new Error("Preview interrupted"));
  try {
    await openStatements();
    fireEvent.click(screen.getByRole("button", { name: "Generate Previews" }));
    await screen.findByText("Preview interrupted");
    expect(screen.queryByRole("button", { name: "Inspect" })).not.toBeInTheDocument();
    expect(screen.getByText(/Oct 20, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Oct 30, 2026/)).not.toBeInTheDocument();
  } finally { error.mockRestore(); }
});

test("creation requires its own confirmation and retries the same request after a lost response", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  await openStatements(); await generate();
  technicianWorkflow.mockRejectedValueOnce(new Error("Response lost"));
  appConfirm.mockResolvedValueOnce(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create" })));
  expect(appConfirm).toHaveBeenCalledTimes(2);
  expect(technicianWorkflow).toHaveBeenCalledTimes(1);
  appConfirm.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  try {
    await screen.findByText("Response lost");
    const firstPayload = technicianWorkflow.mock.calls[1][1];
    technicianWorkflow.mockResolvedValueOnce({ alreadyCreated: true, statement: { id: "saved", technicianId: "tech", technicianName: "Alex",
      statementReference: "PS-000001", createdAt: generatedAt, startDate: generatedAt, endDate: generatedAt, lineItemIds: ["pay-one"], status: "draft", totalCents: 5000 } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText(/Created pay statement PS-000001/);
    expect(technicianWorkflow.mock.calls[2]).toEqual(["createPayrollStatement", firstPayload]);
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.getByText("PS-000001")).toBeInTheDocument();
  } finally { error.mockRestore(); }
});

test("saved statements load their complete linked items on inspection and preserve legacy zero visibility", async () => {
  mockStatements = [{ id: "statement", technicianId: "tech", technicianName: "Alex", statementReference: "PS-000005", status: "draft",
    lineItemIds: ["positive", "zero"], subtotalCents: 5000, totalCents: 5000, startDate: new Date(2026, 9, 25), endDate: new Date(2026, 9, 31) }];
  const initial = getDocs.getMockImplementation();
  getDocs.mockImplementation(async ref => ref.endsWith("technicianPayLineItems") ? docs([line("positive"), line("zero", { totalAmountCents: 0 })]) : initial(ref));
  await openStatements();
  // This historical statement must be inspected in its own period, regardless of today's date.
  fireEvent.change(screen.getByLabelText("Payroll start date"), { target: { value: "2026-10-25" } });
  fireEvent.change(screen.getByLabelText("Payroll end date"), { target: { value: "2026-10-31" } });
  fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
  const detail = await screen.findByRole("dialog", { name: "PS-000005" });
  await within(detail).findByText("positive");
  expect(within(detail).queryByText("zero")).not.toBeInTheDocument();
  fireEvent.click(within(detail).getByRole("button", { name: "Show 0 Amount Line Items" }));
  expect(within(detail).getByText("zero")).toBeInTheDocument();
  expect(within(within(detail).getByRole("complementary", { name: "Pay by day" })).getAllByText("$50.00")).toHaveLength(4);
  expect(technicianWorkflow).not.toHaveBeenCalled();
});

test("bulk creation preserves completed statements and retries only the remaining previews after failure", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  technicianWorkflow.mockResolvedValueOnce(page([line("alex-pay", { serviceStopId: "shared-stop" }), line("blair-pay", { technicianId: "other", technicianName: "Blair", serviceStopId: "shared-stop" })]));
  await openStatements();
  fireEvent.click(screen.getByRole("button", { name: "Generate Previews" }));
  await screen.findByText("Blair");
  const saved = (technicianId, name, ids) => ({ statement: { id: `saved-${technicianId}`, technicianId, technicianName: name,
    statementReference: `PS-${technicianId}`, createdAt: generatedAt, startDate: generatedAt, endDate: generatedAt,
    lineItemIds: ids, status: "draft", totalCents: 5000 } });
  technicianWorkflow.mockResolvedValueOnce(saved("tech", "Alex", ["alex-pay"])).mockRejectedValueOnce(new Error("Second statement interrupted"));
  try {
    fireEvent.click(screen.getByRole("button", { name: "Create Listed Statements" }));
    await screen.findByText(/Created 1 statement\(s\) before stopping/);
    expect(screen.getAllByRole("button", { name: "Create" })).toHaveLength(1);
    expect(screen.getByText("PS-tech")).toBeInTheDocument();
    const summary = within(screen.getByRole("group", { name: "Last previews generated" }));
    expect(summary.getByText("2")).toBeInTheDocument();
    expect(summary.getByText("$100.00")).toBeInTheDocument();
    expect(summary.getByText("1")).toBeInTheDocument();
    const failedRequest = technicianWorkflow.mock.calls[2][1];
    technicianWorkflow.mockResolvedValueOnce(saved("other", "Blair", ["blair-pay"]));
    fireEvent.click(screen.getByRole("button", { name: "Create Listed Statements" }));
    await screen.findByText("Created 1 pay statement(s).");
    expect(technicianWorkflow.mock.calls[3]).toEqual(["createPayrollStatement", failedRequest]);
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
  } finally { error.mockRestore(); }
});

test("large technician groups split without losing any earnings or deductions", () => {
  const items = Array.from({ length: 805 }, (_, i) => line(String(i), { serviceStopId: "shared-stop", totalAmountCents: i === 804 ? -500 : 5000 }));
  const groups = buildStatementCandidateGroups(items);
  expect(groups.map(group => group.lineItems.length)).toEqual([400, 400, 5]);
  expect(groups.map(group => [group.part, group.partCount])).toEqual([[1, 3], [2, 3], [3, 3]]);
  expect(new Set(groups.flatMap(group => group.lineItems.map(item => item.id))).size).toBe(805);
  expect(groups.reduce((sum, group) => sum + group.subtotalCents, 0)).toBe(804 * 5000 - 500);
  expect(statementPreviewSummary(items)).toEqual({ technicianCount: 1, totalAmountCents: 804 * 5000 - 500, stopCount: 1 });
});

test("payroll readers can inspect history but cannot generate previews", async () => {
  mockManage = false;
  await openStatements();
  expect(screen.getByRole("button", { name: "Generate Previews" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Generate Previews" })).toHaveAccessibleDescription("You need Manage Payroll access to generate statement previews.");
  expect(technicianWorkflow).not.toHaveBeenCalled();
});
