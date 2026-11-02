import React, { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { getDocs, getDoc, getCountFromServer, writeBatch, updateDoc } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { technicianWorkflow } from "../../../utils/technicianWorkflow";
import { appConfirm } from "../../../utils/appDialog";
import Payroll from "./Payroll";

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {} }));
jest.mock("../../../utils/technicianWorkflow", () => ({ technicianWorkflow: jest.fn() }));
jest.mock("../../../utils/appDialog", () => ({ appConfirm: jest.fn() }));
jest.mock("./PayRequestsPanel", () => () => null);
jest.mock("../../../components/FeatureInfoButton", () => () => null);
const mockCan = jest.fn();
let mockPermissionsReady;
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: mockCan, permissionsReady: mockPermissionsReady }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"), query: ref => ref,
  where: jest.fn(), orderBy: jest.fn(), startAfter: jest.fn(), limit: jest.fn(), documentId: jest.fn(),
  getDocs: jest.fn(), getDoc: jest.fn(), getCountFromServer: jest.fn(), writeBatch: jest.fn(), updateDoc: jest.fn(), setDoc: jest.fn(), runTransaction: jest.fn(),
}));

const line = (id, extra = {}) => ({ id, source: "serviceStopTask", totalAmountCents: 0, calculationStatus: "calculated",
  completedDate: new Date(), technicianId: "tech", technicianName: "Alex", taskName: id, ...extra });
const mockCommit = jest.fn();
const mockUpdate = jest.fn();
let mockLines;
beforeAll(() => { window.matchMedia = jest.fn(() => ({ matches: false })); });
beforeEach(() => {
  jest.clearAllMocks();
  mockCan.mockReturnValue(true);
  mockPermissionsReady = true;
  mockCommit.mockResolvedValue(undefined);
  writeBatch.mockReturnValue({ update: mockUpdate, commit: mockCommit });
  getDoc.mockResolvedValue({ exists: () => false });
  getCountFromServer.mockImplementation(async () => ({ data: () => ({ count: mockLines.length }) }));
  getDocs.mockImplementation(async ref => ({ docs: ref.endsWith("technicianPayLineItems") ? mockLines.map(data => ({ id: data.id, data: () => data })) : [] }));
  appConfirm.mockResolvedValue(true);
  technicianWorkflow.mockImplementation(async (name, { lineItemIds }) => {
    if (name === "approvePayrollDateRange") return { approvedLineItemIds: [], clearedLineItemIds: [], updates: [], processedCount: 0, needsReviewCount: 0, nextCursor: null };
    if (name === "previewPayrollStatements") return { lineItems: mockLines.filter(item => item.calculationStatus === "approved" && Number(item.totalAmountCents) !== 0), processedCount: mockLines.length, skippedCount: 0, nextCursor: null, generatedAtMillis: Date.now() };
    return { clearedLineItemIds: lineItemIds,
      updates: lineItemIds.map(id => ({ id, calculationStatus: "voided", voidedAtMillis: Date.now(), voidedByUserId: "owner", voidReason: "adminVoided" })) };
  });
  mockLines = [line("included-task"), line("missing-setup", { calculationStatus: "needsReview" }), line("payable", { totalAmountCents: 5000 }),
    line("statement-task", { payStatementId: "statement" }), line("service-pay", { source: "serviceStop", totalAmountCents: 8000 })];
});

const openPayroll = async (context = {}) => {
  render(<><MemoryRouter initialEntries={["/company/payroll?tab=lineItems"]}>
    <Context.Provider value={{ recentlySelectedCompany: "company", user: { uid: "owner" }, setPayrollEnabled: jest.fn(), ...context }}><Payroll /></Context.Provider>
  </MemoryRouter><Toaster /></>);
  await screen.findByText("included-task");
};

test("page totals cover the filtered range and navigation reuses the count", async () => {
  getCountFromServer.mockResolvedValue({ data: () => ({ count: 305 }) });
  mockLines = Array.from({ length: 101 }, (_, index) => line(index === 0 ? "included-task" : `review-${index}`, {
    calculationStatus: "needsReview", totalAmountCents: 1000,
  }));
  await openPayroll();
  expect(await screen.findByText("Page 1 of 4")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Page 2 of 4")).toBeInTheDocument();
  expect(getCountFromServer).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("Page 1 of 4")).toBeInTheDocument();
  expect(getCountFromServer).toHaveBeenCalledTimes(1);
  mockLines = [];
  getCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 0 }) });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
  expect(await screen.findByText("Page 0 of 0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(getCountFromServer).toHaveBeenCalledTimes(2);
});

test("explicit statement preview generation shows daily totals beside work", async () => {
  mockLines = [line("included-task"),
    line("Monday service", { source: "serviceStop", calculationStatus: "approved", completedDate: new Date(2026, 9, 26, 9), totalAmountCents: 5000, customerName: "Oak residence" }),
    line("Monday task", { calculationStatus: "approved", completedDate: new Date(2026, 9, 26, 10), totalAmountCents: 1500, customerName: "Oak residence" }),
    line("Tuesday service", { source: "serviceStop", calculationStatus: "approved", completedDate: new Date(2026, 9, 27, 9), totalAmountCents: 8000, customerName: "Pine residence" })];
  await openPayroll();
  fireEvent.click(screen.getByRole("button", { name: "Statements" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate Previews" }));
  fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
  const preview = await screen.findByRole("dialog", { name: "Alex Statement Preview" });
  const sidebar = within(preview).getByRole("complementary", { name: "Pay by day" });
  expect(within(sidebar).getByText("$65.00")).toBeInTheDocument();
  expect(within(sidebar).getByText("$80.00")).toBeInTheDocument();
  expect(within(sidebar).getAllByText("$145.00")).toHaveLength(3);
  fireEvent.click(within(preview).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("clear page reviews only eligible zero tasks and removes them after server success", async () => {
  await openPayroll();
  expect(screen.getByText("2 $0 task line(s) on this page")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear $0 tasks on page" }));
  await waitFor(() => expect(technicianWorkflow).toHaveBeenCalledWith("clearZeroDollarPayrollTasks", { companyId: "company", lineItemIds: ["included-task", "missing-setup"] }));
  await waitFor(() => expect(screen.queryByText("included-task")).not.toBeInTheDocument());
  expect(screen.getByText("payable")).toBeInTheDocument();
  expect(screen.getByText("statement-task")).toBeInTheDocument();
  expect(screen.getByText("service-pay")).toBeInTheDocument();
  expect(mockUpdate).not.toHaveBeenCalled(); expect(updateDoc).not.toHaveBeenCalled();
});

test("Approve All walks every server page, keeps progress open, and uses the selected dates and technician", async () => {
  const initial = getDocs.getMockImplementation();
  getDocs.mockImplementation(async ref => ref.endsWith("/companyUsers")
    ? { docs: [{ id: "tech", data: () => ({ userId: "tech", userName: "Alex" }) }] } : initial(ref));
  const responses = [];
  technicianWorkflow.mockImplementation((name) => {
    expect(name).toBe("approvePayrollDateRange");
    return new Promise(resolve => responses.push(resolve));
  });
  await openPayroll();
  fireEvent.change(screen.getByLabelText("Payroll start date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Payroll end date"), { target: { value: "2026-10-31" } });
  await screen.findByText("included-task");
  fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "tech" } });
  await screen.findByText("included-task");
  expect(screen.getByRole("button", { name: "Generate Previews" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Approve All" }));
  const progress = await screen.findByRole("dialog", { name: "Approving payroll" });
  expect(progress).toHaveAccessibleDescription("Checking all payroll line items in the selected date range.");
  const scope = { companyId: "company", startDateMillis: new Date("2026-10-01T00:00:00").getTime(),
    endDateExclusiveMillis: new Date("2026-11-01T00:00:00").getTime(), technicianId: "tech" };
  expect(technicianWorkflow).toHaveBeenNthCalledWith(1, "approvePayrollDateRange", { ...scope, cursor: null });
  fireEvent.keyDown(progress, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Approving payroll" })).toBeInTheDocument();
  const firstUpdates = [{ id: "included-task", calculationStatus: "voided", voidedAtMillis: Date.now() },
    { id: "payable", calculationStatus: "approved", approvedAtMillis: Date.now() },
    { id: "service-pay", calculationStatus: "approved", approvedAtMillis: Date.now() }];
  const cursor = { id: "page-1", seconds: 1790812800, nanoseconds: 0 };
  await act(async () => {
    mockLines = mockLines.map(item => ({ ...item, ...firstUpdates.find(update => update.id === item.id) }));
    responses[0]({ approvedLineItemIds: ["payable", "service-pay"], clearedLineItemIds: ["included-task"], updates: firstUpdates,
      processedCount: 200, needsReviewCount: 1, nextCursor: cursor });
  });
  expect(technicianWorkflow).toHaveBeenNthCalledWith(2, "approvePayrollDateRange", { ...scope, cursor });
  expect(screen.getByRole("dialog", { name: "Approving payroll" })).toHaveAccessibleDescription(/Checked 200 line\(s\)\. Approved 2; cleared 1/);
  await act(async () => { responses[1]({ approvedLineItemIds: ["beyond-loaded-page"], clearedLineItemIds: [], updates: [], processedCount: 1, needsReviewCount: 0, nextCursor: null }); });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approving payroll" })).not.toBeInTheDocument());
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.getByText("missing-setup")).toBeInTheDocument();
  expect(await screen.findByText(/Approved 3 payroll line item\(s\) across the selected date range\. Cleared 1.*1 item\(s\) still need review/)).toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /payable/ })).getByRole("button", { name: "Approve" })).toHaveAccessibleDescription("This line item has already been approved.");
});

test("single clear, cancellation, permission denial, and stale server rejection preserve review state", async () => {
  mockLines.push(line("missing-service-rate", { source: "serviceStop", calculationStatus: "needsReview", notes: "No active technician rate matches this pay item." }));
  await openPayroll();
  const row = screen.getByRole("row", { name: /missing-setup/ });
  const markPaid = within(row).getByRole("button", { name: "Mark Paid" });
  expect(markPaid).toBeDisabled();
  const zeroReason = "$0 tasks do not require payment. Use Clear $0 to remove this task from the queue.";
  expect(markPaid).toHaveAccessibleDescription(zeroReason);
  expect(within(row).getByTitle(zeroReason)).toContainElement(markPaid);
  const reviewRow = screen.getByRole("row", { name: /missing-service-rate/ });
  expect(within(reviewRow).getByRole("button", { name: "Approve" })).toHaveAccessibleDescription("Resolve this line item's payroll review before approving it. No active technician rate matches this pay item.");
  appConfirm.mockResolvedValueOnce(false);
  fireEvent.click(within(row).getByRole("button", { name: "Clear $0" }));
  await waitFor(() => expect(appConfirm).toHaveBeenCalled());
  expect(technicianWorkflow).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  let failClear;
  technicianWorkflow.mockReturnValueOnce(new Promise((_, reject) => { failClear = reject; }));
  fireEvent.click(within(row).getByRole("button", { name: "Clear $0" }));
  expect(await screen.findByRole("dialog", { name: "Clearing $0 tasks" })).toHaveAccessibleDescription("Please wait while the $0 task pay lines are cleared.");
  await act(async () => { failClear(new Error("Amount changed; reload")); });
  expect(await screen.findByText("Amount changed; reload")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Clearing $0 tasks" })).not.toBeInTheDocument();
  expect(screen.getByText("missing-setup")).toBeInTheDocument();
});

test("payroll readers cannot invoke zero task cleanup", async () => {
  mockCan.mockReturnValue(false);
  await openPayroll();
  expect(screen.getByRole("button", { name: "Clear $0 tasks on page" })).toBeDisabled();
  const reason = "Your account cannot clear payroll tasks. Ask the company owner to enable Manage Payroll for your role.";
  expect(screen.getByRole("button", { name: "Clear $0 tasks on page" })).toHaveAccessibleDescription(reason);
  expect(screen.getByRole("status")).toHaveTextContent(reason);
  expect(screen.getByRole("button", { name: "Approve All" })).toBeDisabled();
  expect(technicianWorkflow).not.toHaveBeenCalled();
});

test.each([
  ["company owner", { companyOwnerId: "owner" }],
  ["owner role", { companyUserAccess: { roleName: "Owner" } }],
  ["admin role", { companyUserAccess: { roleName: "Admin" } }],
  ["manager role", { companyUserAccess: { roleName: "Manager" } }],
])("%s can clear zero tasks even when a legacy role lacks permission 424", async (_, context) => {
  mockCan.mockReturnValue(false);
  await openPayroll(context);
  const panel = screen.getByRole("region", { name: "Clear zero-dollar payroll tasks" });
  const clear = within(panel).getByRole("button", { name: "Clear $0 tasks on page" });
  expect(clear).toBeEnabled();
  fireEvent.click(clear);
  await waitFor(() => expect(technicianWorkflow).toHaveBeenCalledWith("clearZeroDollarPayrollTasks", { companyId: "company", lineItemIds: expect.arrayContaining(["included-task", "missing-setup"]) }));
  await waitFor(() => expect(screen.queryByText("included-task")).not.toBeInTheDocument());
});

test("cleanup waits for loaded permissions and shows the loading reason beside the button", async () => {
  mockPermissionsReady = false;
  await openPayroll({ companyOwnerId: "owner" });
  expect(screen.getByRole("button", { name: "Clear $0 tasks on page" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Payroll permissions are still loading. Please wait.");
  expect(technicianWorkflow).not.toHaveBeenCalled();
});

test("Approve All remains available when the displayed page contains only Needs Review items", async () => {
  mockLines = [line("included-task", { calculationStatus: "needsReview" })];
  await openPayroll();
  expect(screen.getByRole("button", { name: "Approve All" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Approve All" }));
  expect(await screen.findByText(/Approved 0 payroll line item\(s\) across the selected date range/)).toBeInTheDocument();
  expect(technicianWorkflow).toHaveBeenCalledWith("approvePayrollDateRange", expect.objectContaining({ cursor: null }));
});

test("interrupted range approval closes progress, retains completed updates, and allows a fresh retry", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  let call = 0;
  technicianWorkflow.mockImplementation(async () => {
    call += 1;
    if (call === 2) throw new Error("Connection interrupted");
    if (call === 1) {
      mockLines = mockLines.map(item => item.id === "payable" ? { ...item, calculationStatus: "approved", approvedAt: new Date() } : item);
      return { approvedLineItemIds: ["payable"], clearedLineItemIds: [], updates: [{ id: "payable", calculationStatus: "approved", approvedAtMillis: Date.now() }],
        processedCount: 200, needsReviewCount: 0, nextCursor: { id: "page-1", seconds: 1790812800, nanoseconds: 0 } };
    }
    return { approvedLineItemIds: [], clearedLineItemIds: [], updates: [], processedCount: 1, needsReviewCount: 0, nextCursor: null };
  });
  try {
    await openPayroll();
    fireEvent.click(screen.getByRole("button", { name: "Approve All" }));
    expect(await screen.findByText(/Could not finish all approvals\. Confirmed 1 approved line\(s\)/)).toHaveTextContent("Completed changes are kept");
    expect(screen.queryByRole("dialog", { name: "Approving payroll" })).not.toBeInTheDocument();
    await screen.findByText("payable");
    expect(within(screen.getByRole("row", { name: /payable/ })).getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve All" }));
    await screen.findByText(/Approved 0 payroll line item\(s\) across the selected date range/);
    expect(technicianWorkflow).toHaveBeenNthCalledWith(3, "approvePayrollDateRange", expect.objectContaining({ cursor: null }));
  } finally { consoleError.mockRestore(); }
});

test('bulk Finish Stops leaves payroll to automatic processing without a per-stop payroll read', async () => {
  const initial = getDocs.getMockImplementation();
  getDocs.mockImplementation(async ref => {
    if (ref.endsWith('/serviceStops')) return { docs: ['one', 'two'].map(id => ({ id, data: () => ({
      operationStatus: 'Scheduled', techId: 'tech', serviceDate: new Date(), estimatedDuration: 30,
    }) })) };
    if (ref.endsWith('/tasks')) return { docs: [{ id: 'task', data: () => ({ status: 'Scheduled' }) }] };
    return initial(ref);
  });
  await openPayroll({ recentlySelectedCompany: 'com_b0a2fcda-6eb8-4024-8703-23aa6c53f78e' });
  const payrollReads = getDocs.mock.calls.filter(([ref]) => ref.endsWith('/technicianPayLineItems')).length;
  fireEvent.click(screen.getByRole('button', { name: 'Finish Stops' }));
  expect(await screen.findByText(/Finished 2 service stop\(s\) and 2 task\(s\)\. Payroll is updating/)).toBeInTheDocument();
  expect(mockCommit).toHaveBeenCalledTimes(2);
  expect(mockUpdate.mock.calls.filter(([path]) => path.endsWith('/tasks/task'))).toHaveLength(2);
  expect(mockUpdate.mock.calls.every(([, payload]) => payload.manualFinishSource === 'payroll_setup_bulk_finish')).toBe(true);
  expect(getDocs.mock.calls.filter(([ref]) => ref.endsWith('/technicianPayLineItems'))).toHaveLength(payrollReads);
  expect(technicianWorkflow).not.toHaveBeenCalled();
});
