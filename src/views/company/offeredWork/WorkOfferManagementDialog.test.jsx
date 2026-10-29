import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import { manageTechnicianWork } from "../../../utils/technicianWorkflow";
import WorkOfferManagementDialog from "./WorkOfferManagementDialog";

jest.mock("../../../utils/technicianWorkflow", () => ({ manageTechnicianWork: jest.fn() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({ collection: (...parts) => parts.slice(1).join("/"), getDocs: jest.fn() }));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });
const offer = { id: "offer", jobId: "job", title: "Repair pump", status: "Sent", offerType: "Direct User", offeredToUserId: "tech", offeredToUserName: "Alex", paySource: "Offered Amount", offeredAmountCents: 10000, revision: 3, estimatedMinutes: 60, jobTaskIds: ["task"], claims: [] };
const workers = [{ id: "tech", userId: "tech", userName: "Alex", workerType: "Employee" }, { id: "other", userId: "other", userName: "Blair", workerType: "Employee" }];
const tasks = [{ id: "task", name: "Replace pump", status: "Draft" }];
const management = { canEdit: true, canDelete: true, canIncentivize: true, termsLocked: false, incentiveLocked: false };
const details = changes => ({ offer, management, scope: { tasks, services: [], products: [], stops: [] }, pay: null, ...changes });
const open = (props = {}) => {
  const onClose = jest.fn(), onChanged = jest.fn();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><WorkOfferManagementDialog companyId="company" offer={offer} workers={workers} tasks={tasks} onClose={onClose} onChanged={onChanged} {...props} /></MemoryRouter>);
  return { onClose, onChanged };
};
beforeEach(() => {
  jest.clearAllMocks();
  getDocs.mockResolvedValue({ docs: [] });
  manageTechnicianWork.mockImplementation((company, action) => Promise.resolve(action === "details" ? details() : { offerId: "offer" }));
});

test("opens unclaimed offer details, complete scope, and management actions without a technician claim", async () => {
  open();
  expect(await screen.findByText("Replace pump")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit offer" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Incentive" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Delete offer" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Open job" })).toHaveAttribute("href", "/company/jobs/detail/job/actual");
  expect(manageTechnicianWork).toHaveBeenCalledWith("company", "details", { offerId: "offer" });
});

test("saves revised pay, assignment, timing and task scope against the loaded revision", async () => {
  const { onChanged } = open({ initialTab: "edit" });
  const title = await screen.findByLabelText("Offer title");
  fireEvent.change(title, { target: { value: "Priority repair" } });
  fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "other" } });
  fireEvent.change(screen.getByLabelText("Offered amount"), { target: { value: "125.50" } });
  fireEvent.change(screen.getByLabelText("Completion deadline"), { target: { value: "2026-11-03T14:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
  await waitFor(() => expect(manageTechnicianWork).toHaveBeenCalledWith("company", "update", expect.objectContaining({ offerId: "offer", revision: 3, changes: expect.objectContaining({ title: "Priority repair", offeredToUserId: "other", offeredToUserName: "Blair", offeredAmountCents: 12550, jobTaskIds: ["task"], completionDeadlineAt: new Date("2026-11-03T14:00").getTime() }) })));
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ type: "updated", offerId: "offer" })));
});

test("accepted offers permit metadata changes while keeping pay and scope out of the mutation", async () => {
  manageTechnicianWork.mockImplementation((company, action) => Promise.resolve(action === "details" ? details({ offer: { ...offer, status: "Accepted" }, management: { ...management, termsLocked: true, canDelete: false, incentiveLocked: true } }) : { offerId: "offer" }));
  open({ initialTab: "edit" });
  fireEvent.change(await screen.findByLabelText("Offer title"), { target: { value: "Updated access details" } });
  expect(screen.queryByLabelText("Offered amount")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete offer" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
  await waitFor(() => expect(manageTechnicianWork).toHaveBeenCalledWith("company", "update", { offerId: "offer", revision: 3, changes: { title: "Updated access details", description: "", adminNotes: "" } }));
});

test("saves percentage incentives and notes through the authoritative incentive action", async () => {
  open({ initialTab: "incentive" });
  fireEvent.change(await screen.findByLabelText("Incentive type"), { target: { value: "percentage" } });
  fireEvent.change(screen.getByLabelText("Incentive percentage"), { target: { value: "12.5" } });
  fireEvent.change(screen.getByLabelText("Incentive notes"), { target: { value: "Priority work" } });
  fireEvent.click(screen.getByRole("button", { name: "Save incentive" }));
  await waitFor(() => expect(manageTechnicianWork).toHaveBeenCalledWith("company", "incentive", { offerId: "offer", revision: 3, incentive: { type: "percentage", amountCents: 0, percentage: 12.5, notes: "Priority work" } }));
});

test("deletion requires a reviewable confirmation and refreshes both entry points after success", async () => {
  const { onClose, onChanged } = open({ initialTab: "delete" });
  const confirmation = await screen.findByRole("region", { name: "Confirm offer deletion" });
  expect(manageTechnicianWork).not.toHaveBeenCalledWith("company", "delete", expect.anything());
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(manageTechnicianWork).toHaveBeenCalledWith("company", "delete", { offerId: "offer", revision: 3 }));
  expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ type: "deleted" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("failed edits retain the entered form and leave the offer open for refresh or retry", async () => {
  manageTechnicianWork.mockImplementation((company, action) => action === "details" ? Promise.resolve(details()) : Promise.reject(Error("This offer changed. Refresh it before saving.")));
  const { onClose } = open({ initialTab: "edit" });
  fireEvent.change(await screen.findByLabelText("Offer title"), { target: { value: "Unsaved change" } });
  fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This offer changed");
  expect(screen.getByLabelText("Offer title")).toHaveValue("Unsaved change");
  expect(onClose).not.toHaveBeenCalled();
});

test("read-only users have no mutation controls and a failed load never enables editing", async () => {
  manageTechnicianWork.mockResolvedValue(details({ management: { canEdit: false, canDelete: false, canIncentivize: false } }));
  open();
  await screen.findByText("Replace pump");
  expect(screen.queryByRole("button", { name: "Edit offer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Incentive" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete offer" })).not.toBeInTheDocument();
});

test("removing a private board clears its old membership restriction", async () => {
  const boardOffer = { ...offer, offerType: "Internal Board", boardIds: ["private"], boardNames: ["Private board"], boardMemberUserIds: ["tech"] };
  manageTechnicianWork.mockImplementation((company, action) => Promise.resolve(action === "details" ? details({ offer: boardOffer }) : { offerId: "offer" }));
  open({ offer: boardOffer, initialTab: "edit", boards: [{ id: "private", name: "Private board", memberUserIds: ["tech"] }] });
  const board = await screen.findByRole("checkbox", { name: "Private board" });
  fireEvent.click(board);
  fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
  await waitFor(() => expect(manageTechnicianWork).toHaveBeenCalledWith("company", "update", expect.objectContaining({ changes: expect.objectContaining({ boardIds: [], boardNames: [], boardMemberUserIds: [] }) })));
  await screen.findByText("Replace pump");
});
