import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { getDocs, onSnapshot, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import JobCommentsDialog from "./JobCommentsDialog";
import Jobs from "./Jobs";

let mockPermissions;
let mockNextId;
let mockListeners;
let mockInitialComments;
const mockCommit = jest.fn();
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext({}) }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: (id) => mockPermissions.includes(id), requirePermission: jest.fn() }));
jest.mock("../../../components/CompanyUserSelect", () => () => null);
jest.mock("./CreateJobFlowLauncher", () => () => null);
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => ({ path: parts.join("/") }),
  doc: (first, ...parts) => {
    const path = parts.length ? parts.join("/") : `${first.path}/new-${++mockNextId}`;
    return { path, id: path.split("/").pop() };
  },
  query: (ref, ...constraints) => ({ ...ref, constraints }), where: (...values) => values,
  getDocs: jest.fn(), onSnapshot: jest.fn(), serverTimestamp: () => "server-time",
  writeBatch: jest.fn(() => ({ set: jest.fn(), update: jest.fn(), commit: mockCommit })),
}));

const job = { id: "comp_wo_document-secret", internalId: "JOB-1042", customerName: "Avery Pool", description: "Pump repair", operationStatus: "Scheduled", billingStatus: "Accepted", dateCreated: new Date(), solutionTier: 2 };
const context = (company = "company-1") => ({ recentlySelectedCompany: company, user: { uid: "user-1", displayName: "Alex" }, dataBaseUser: { id: "user-1", firstName: "Alex", lastName: "Rivera" }, featureFlagsLoaded: true, isFeatureEnabled: () => false });
const snapshot = (records = []) => ({ size: records.length, docs: records.map((record) => ({ id: record.id, data: () => record })) });
const comment = (id, extra = {}) => ({ id, comment: `Note ${id}`, userId: "other-user", userName: "Taylor", dateMillis: 1000, resolved: false, ...extra });
const path = `companies/company-1/workOrders/${job.id}`;
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });
beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ["20", "24"]; mockNextId = 0; mockListeners = []; mockInitialComments = [];
  mockCommit.mockReset().mockResolvedValue(undefined);
  writeBatch.mockImplementation(() => ({ set: jest.fn(), update: jest.fn(), commit: mockCommit }));
  onSnapshot.mockImplementation((ref, next, error) => {
    const listener = { ref, next, error, unsubscribe: jest.fn() };
    mockListeners.push(listener);
    next(snapshot(mockInitialComments));
    return listener.unsubscribe;
  });
  getDocs.mockImplementation(async (ref) => ref.path.endsWith("/workOrders") ? snapshot([job]) : snapshot());
});
afterEach(async () => { await act(async () => {}); });
const openDialog = (extra = {}) => {
  const props = { companyId: "company-1", job, onClose: jest.fn(), onCommentCountChange: jest.fn(), ...extra };
  return { ...render(<Context.Provider value={context()}><JobCommentsDialog {...props} /></Context.Provider>), props };
};
const publish = (records) => act(() => mockListeners[mockListeners.length - 1].next(snapshot(records)));

test("reads the job's existing thread, filters open/resolved comments, and reports live counts", () => {
  mockInitialComments = [comment("open"), comment("done", { resolved: true, dateMillis: 2000 })];
  const { props, unmount } = openDialog();
  expect(onSnapshot.mock.calls[0][0].path).toBe(`${path}/comments`);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Comments · JOB-1042");
  expect(screen.getByText("Note open")).toBeInTheDocument();
  expect(screen.queryByText("Note done")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resolved (1)" }));
  expect(screen.getByText("Note done")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All (2)" }));
  expect(within(screen.getByRole("list", { name: "Job comments" })).getAllByRole("listitem")[0]).toHaveTextContent("Note done");
  publish([comment("open", { resolved: true }), comment("done", { resolved: true })]);
  expect(props.onCommentCountChange).toHaveBeenLastCalledWith(job.id, 0);
  const listener = mockListeners[0]; unmount();
  expect(listener.unsubscribe).toHaveBeenCalledTimes(1);
  const countCalls = props.onCommentCountChange.mock.calls.length;
  act(() => listener.next(snapshot([comment("stale")])));
  expect(props.onCommentCountChange).toHaveBeenCalledTimes(countCalls);
});

test("adds a trimmed comment and records job history atomically with the signed-in author", async () => {
  openDialog();
  expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Resolved (0)" }));
  fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "  Order replacement pump\nCall customer  " } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add comment" })));
  await waitFor(() => expect(screen.getByLabelText("New comment")).toHaveValue(""));
  expect(screen.getByRole("button", { name: "Open (0)" })).toHaveAttribute("aria-pressed", "true");
  const batch = writeBatch.mock.results[0].value;
  expect(batch.set).toHaveBeenCalledWith(expect.objectContaining({ path: `${path}/comments/new-1` }), expect.objectContaining({
    id: "new-1", companyId: "company-1", jobId: job.id, userId: "user-1", authorId: "user-1",
    userName: "Alex Rivera", comment: "Order replacement pump\nCall customer", resolved: false, date: "server-time",
  }));
  expect(batch.set).toHaveBeenCalledWith(expect.objectContaining({ path: `${path}/history/new-2` }), expect.objectContaining({ title: "Comment added", eventType: "Comment", actorUserId: "user-1", metadata: { commentId: "new-1" } }));
  expect(batch.update).toHaveBeenCalledWith(expect.objectContaining({ path }), expect.objectContaining({ lastHistoryEventTitle: "Comment added" }));
  expect(mockCommit).toHaveBeenCalledTimes(1);
});

test("resolves and reopens comments using their document IDs and keeps the live badge current", async () => {
  mockInitialComments = [comment("open")];
  const { props } = openDialog();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resolve", exact: true })));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Saving..." })).not.toBeInTheDocument());
  expect(writeBatch.mock.results[0].value.update).toHaveBeenCalledWith(expect.objectContaining({ path: `${path}/comments/open` }), { resolved: true });
  publish([comment("open", { resolved: true })]);
  expect(props.onCommentCountChange).toHaveBeenLastCalledWith(job.id, 0);
  expect(screen.getByText("No open comments.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resolved (1)" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reopen" })));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(2));
  expect(writeBatch.mock.results[1].value.update).toHaveBeenCalledWith(expect.objectContaining({ path: `${path}/comments/open` }), { resolved: false });
});

test("failed additions preserve drafts and duplicate submissions cannot create duplicate comments", async () => {
  mockCommit.mockRejectedValueOnce(new Error("offline"));
  openDialog();
  const input = screen.getByLabelText("New comment");
  fireEvent.change(input, { target: { value: "Keep this draft" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add comment" })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is still here");
  expect(input).toHaveValue("Keep this draft");
  let finish;
  mockCommit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const form = input.closest("form");
  fireEvent.submit(form); fireEvent.submit(form);
  expect(mockCommit).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Close job comments" })).toBeDisabled();
  await act(async () => finish());
  expect(input).toHaveValue("");
});

test("job viewers can add and resolve their own comments without attempting restricted history writes", async () => {
  mockPermissions = ["20"];
  mockInitialComments = [comment("mine", { userId: "user-1" }), comment("theirs")];
  openDialog();
  const mine = screen.getByText("Note mine").closest("li");
  const theirs = screen.getByText("Note theirs").closest("li");
  expect(within(theirs).getByRole("button", { name: "Resolve" })).toBeDisabled();
  await act(async () => fireEvent.click(within(mine).getByRole("button", { name: "Resolve" })));
  await waitFor(() => expect(within(mine).getByRole("button", { name: "Resolve" })).toBeEnabled());
  const batch = writeBatch.mock.results[0].value;
  expect(batch.update).toHaveBeenCalledTimes(1);
  expect(batch.set).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "Viewer comment" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add comment" })));
  await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(2));
  expect(writeBatch.mock.results[1].value.set).toHaveBeenCalledTimes(1);
  expect(writeBatch.mock.results[1].value.update).not.toHaveBeenCalled();
});

test("template editors can resolve comments on template jobs, while users without access cannot write", () => {
  mockPermissions = ["20", "28"]; mockInitialComments = [comment("theirs")];
  const { unmount } = openDialog({ job: { ...job, sourceTemplateId: "template" } });
  expect(screen.getByRole("button", { name: "Resolve" })).toBeEnabled();
  unmount(); mockPermissions = [];
  openDialog();
  expect(screen.getByLabelText("New comment")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Resolve" })).toBeDisabled();
  expect(writeBatch).not.toHaveBeenCalled();
});

test("load failures are visible and retry subscribes again without an old listener updating the thread", () => {
  openDialog();
  const old = mockListeners[0];
  act(() => old.error(new Error("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to load comments");
  mockInitialComments = [comment("retried")];
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(old.unsubscribe).toHaveBeenCalled();
  expect(screen.getByText("Note retried")).toBeInTheDocument();
  act(() => old.next(snapshot([comment("stale")])));
  expect(screen.queryByText("Note stale")).not.toBeInTheDocument();
});

const Location = () => <output data-testid="location">{useLocation().pathname}</output>;
const listView = (view, value = context()) => (
  <MemoryRouter initialEntries={[`/company/jobs/${view}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Context.Provider value={value}><Location /><Routes><Route path="/company/jobs/:view" element={<Jobs />} /><Route path="/company/jobs/detail/:id/*" element={<p>Job detail</p>} /></Routes></Context.Provider>
  </MemoryRouter>
);

test.each(["operations", "billing"])("%s: the job number and badge open comments without navigating, then closing restores the list", async (view) => {
  const listJob = { ...job, operationStatus: view === "billing" ? "Finished" : "Scheduled" };
  getDocs.mockImplementation(async (ref) => ref.path.endsWith("/workOrders") ? snapshot([listJob]) : ref.path.endsWith("/comments") ? snapshot([comment("open")]) : snapshot());
  mockInitialComments = [comment("open")];
  render(listView(view));
  const trigger = await screen.findByRole("button", { name: "Comments for job JOB-1042, 1 unresolved" });
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(within(trigger).getByText("JOB-1042"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(`/company/jobs/${view}`);
  publish([]);
  fireEvent.click(screen.getByRole("button", { name: "Close job comments" }));
  const updated = await screen.findByRole("button", { name: "Comments for job JOB-1042, 0 unresolved" });
  expect(within(updated).queryByLabelText("1 unresolved comments")).not.toBeInTheDocument();
  expect(screen.queryByText(job.id)).not.toBeInTheDocument();
  fireEvent.click(updated);
  await waitFor(() => expect(screen.getByLabelText("New comment")).toHaveFocus());
  fireEvent.keyDown(document.activeElement, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(updated).toHaveFocus());
  fireEvent.click(screen.getByText("Pump repair"));
  expect(screen.getByTestId("location")).toHaveTextContent(`/company/jobs/detail/${job.id}${view === "billing" ? "/billing" : ""}`);
});

test("the red badge itself opens comments and an empty job can still receive its first comment", async () => {
  getDocs.mockImplementation(async (ref) => ref.path.endsWith("/workOrders") ? snapshot([job]) : ref.path.endsWith("/comments") ? snapshot([comment("open")]) : snapshot());
  render(listView("operations"));
  fireEvent.click(await screen.findByLabelText("1 unresolved comments"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("No comments yet. Add the first comment below.")).toBeInTheDocument();
  expect(screen.getByLabelText("New comment")).toBeEnabled();
  expect(screen.getByTestId("location")).toHaveTextContent("/company/jobs/operations");
});

test("switching companies closes the popup and unsubscribes from the previous company's comments", async () => {
  const { rerender } = render(listView("operations"));
  fireEvent.click(await screen.findByRole("button", { name: "Comments for job JOB-1042, 0 unresolved" }));
  const old = mockListeners[0];
  rerender(listView("operations", context("company-2")));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(old.unsubscribe).toHaveBeenCalled();
});

test("a delayed initial badge read cannot overwrite the live count from the popup", async () => {
  let finishCount;
  const delayedCount = new Promise((resolve) => { finishCount = resolve; });
  getDocs.mockImplementation(async (ref) => ref.path.endsWith("/workOrders") ? snapshot([job]) : ref.path.endsWith("/comments") ? delayedCount : snapshot());
  mockInitialComments = [comment("one"), comment("two")];
  render(listView("operations"));
  fireEvent.click(await screen.findByRole("button", { name: "Comments for job JOB-1042, 0 unresolved" }));
  await act(async () => finishCount(snapshot([comment("old-count")])));
  fireEvent.click(screen.getByRole("button", { name: "Close job comments" }));
  expect(screen.getByRole("button", { name: "Comments for job JOB-1042, 2 unresolved" })).toBeInTheDocument();
});

test("the list preserves template job access so a template editor can resolve other people's comments", async () => {
  mockPermissions = ["20", "28"]; mockInitialComments = [comment("theirs")];
  getDocs.mockImplementation(async (ref) => ref.path.endsWith("/workOrders") ? snapshot([{ ...job, sourceTemplateId: "template-1" }]) : snapshot());
  render(listView("operations"));
  fireEvent.click(await screen.findByRole("button", { name: "Comments for job JOB-1042, 0 unresolved" }));
  expect(screen.getByRole("button", { name: "Resolve" })).toBeEnabled();
});

test("a failed resolution leaves the comment open and can be retried", async () => {
  mockInitialComments = [comment("open")]; mockCommit.mockRejectedValueOnce(new Error("offline"));
  openDialog();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resolve", exact: true })));
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to update this comment");
  expect(screen.getByText("Note open")).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resolve", exact: true })));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mockCommit).toHaveBeenCalledTimes(2);
});
