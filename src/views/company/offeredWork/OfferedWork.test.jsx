import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs, setDoc } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { manageTechnicianWork } from "../../../utils/technicianWorkflow";
import OfferedWork from "./OfferedWork";
let mockPermissions;
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: id => mockPermissions.includes(id), requirePermission: id => mockPermissions.includes(id), permissionsReady: true }));
jest.mock("../../../utils/technicianWorkflow", () => ({ manageTechnicianWork: jest.fn() }));
jest.mock("firebase/firestore", () => ({
  collection: (...parts) => parts.slice(1).join("/"), doc: (...parts) => parts.slice(1).join("/"),
  getDoc: async () => ({ exists: () => false }), getDocs: jest.fn(),
  where: jest.fn(), query: jest.fn(), limit: jest.fn(), serverTimestamp: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), Timestamp: {},
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./WorkOfferManagementDialog", () => props => <div role="dialog" aria-label="Offer management"><p>{props.offer.id} · {props.initialTab}</p><button onClick={props.onClose}>Close manager</button></div>);
const offer = { id: "comp_work_offer_one", jobId: "job", title: "Pump repair", offerType: "Direct User", status: "Sent", offeredToUserId: "tech", offeredToUserName: "Alex", paySource: "Offered Amount", offeredAmountCents: 10000 };
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });
beforeEach(() => { getDocs.mockReset().mockResolvedValue({ docs: [] }); setDoc.mockClear(); mockPermissions = ["324", "328", "332"]; manageTechnicianWork.mockResolvedValue({ offers: [offer] }); });
const open = (uid = "manager") => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={{ recentlySelectedCompany: "company", user: { uid } }}><OfferedWork /></Context.Provider></MemoryRouter>);
test("management list opens, edits, deletes, and incentivizes the selected offer instead of navigating to its job", async () => {
  open();
  const row = await screen.findByRole("row", { name: /Pump repair/ });
  expect(within(row).queryByRole("button", { name: "Open offer" })).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Actions for Pump repair" }));
  expect(await screen.findByRole("menuitem", { name: "Open job" })).toHaveAttribute("href", "/company/jobs/detail/job/actual");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  for (const [label, tab] of [["Open offer", "details"], ["Edit offer", "edit"], ["Delete offer", "delete"], ["Incentive", "incentive"]]) {
    fireEvent.click(within(row).getByRole("button", { name: "Actions for Pump repair" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(screen.getByRole("dialog")).toHaveTextContent(`comp_work_offer_one · ${tab}`);
    fireEvent.click(screen.getByRole("button", { name: "Close manager" }));
  }
});

test("actions menu supports keyboard opening and Escape without changing an offer", async () => {
  open();
  const trigger = await screen.findByRole("button", { name: "Actions for Pump repair" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  expect(manageTechnicianWork.mock.calls.every(([, action]) => action === "list")).toBe(true);
});
test("read-all permission exposes details without granting edit, delete, or incentive access", async () => {
  mockPermissions = ["332"];
  open();
  const row = await screen.findByRole("row", { name: /Pump repair/ });
  fireEvent.click(within(row).getByRole("button", { name: "Actions for Pump repair" }));
  expect(await screen.findByRole("menuitem", { name: "Open offer" })).toBeEnabled();
  expect(screen.queryByRole("menuitem", { name: "Edit offer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Delete offer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Incentive" })).not.toBeInTheDocument();
});

test.each(["Accepted", "Acceptance Pending Approval"])("%s acceptance opens immediate scheduling only after approval", async status => {
  Object.defineProperty(global, "crypto", { configurable: true, value: { randomUUID: () => "claim" } });
  mockPermissions = ["334"];
  const schedulable = { ...offer, allowsTechnicianSelfScheduling: true };
  manageTechnicianWork.mockImplementation((company, action) => Promise.resolve(action === "preview" ? { scope: { tasks: [], services: [], products: [], stops: [] }, totalCents: 10000, baseCents: 10000, incentiveCents: 0, revision: 1 } : action === "accept" ? { offerId: offer.id, status } : { offers: [schedulable] }));
  open("tech");
  fireEvent.click(await screen.findByRole("button", { name: "Actions for Pump repair" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Accept" }));
  const review = screen.getByRole("dialog", { name: "Review offered work" });
  await waitFor(() => expect(within(review).getByRole("button", { name: "Accept Work" })).toBeEnabled());
  fireEvent.click(within(review).getByRole("button", { name: "Accept Work" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review offered work" })).not.toBeInTheDocument());
  if (status === "Accepted") expect(screen.getByRole("dialog", { name: "Schedule accepted work" })).toBeInTheDocument();
  else expect(screen.queryByRole("dialog", { name: "Schedule accepted work" })).not.toBeInTheDocument();
});

test("accepted offers hide Delete while keeping management details available", async () => {
  manageTechnicianWork.mockResolvedValue({ offers: [{ ...offer, status: "Accepted", acceptedByUserId: "tech" }] });
  open();
  fireEvent.change(screen.getByRole("option", { name: "Ready to Schedule" }).parentElement, { target: { value: "accepted" } });
  const row = await screen.findByRole("row", { name: /Pump repair/ });
  fireEvent.click(within(row).getByRole("button", { name: "Actions for Pump repair" }));
  expect(await screen.findByRole("menuitem", { name: "Open offer" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Delete offer" })).not.toBeInTheDocument();
});


const boardMembers = [
  { id: "alex-doc", userId: "alex", userName: "Alex Rivera", email: "alex@example.com", workerType: "Employee" },
  { id: "blair-doc", userId: "blair", userName: "Blair Chen", email: "blair@example.com", workerType: { rawValue: "Contractor" } },
  { id: "casey-doc", userId: "casey", userName: "Casey Smith", email: "casey@example.com", workerType: "Employee" },
];
const mockBoardData = (boards = [], members = boardMembers) => {
  getDocs.mockImplementation(async path => ({
    docs: (path.endsWith("companyUsers") ? members : boards).map(({ id, ...data }) => ({ id, data: () => data })),
  }));
};
const openBoards = async () => {
  open();
  await screen.findByRole("row", { name: /Pump repair/ });
  fireEvent.click(screen.getByRole("button", { name: "Boards" }));
  return screen.getByRole("dialog", { name: "Work Offer Boards" });
};

test("member search finds names, emails, and worker types while preserving hidden selections on save", async () => {
  mockBoardData();
  const dialog = await openBoards();
  const search = within(dialog).getByRole("searchbox", { name: "Search board members" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Board Name" }), { target: { value: "Repair team" } });
  fireEvent.change(search, { target: { value: "  ALEX  " } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Alex Rivera/ }));
  expect(within(dialog).queryByRole("checkbox", { name: /Blair Chen/ })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "blair@example.com" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Blair Chen/ }));
  fireEvent.change(search, { target: { value: "contractor" } });
  expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
  expect(within(dialog).getByRole("checkbox", { name: /Blair Chen/ })).toBeChecked();
  expect(within(dialog).getByText("2 selected")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "nobody" } });
  expect(within(dialog).getByRole("status")).toHaveTextContent("No members match your search.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => expect(setDoc).toHaveBeenCalledWith(
    expect.stringContaining("workOfferBoards/"),
    expect.objectContaining({ name: "Repair team", memberUserIds: ["alex", "blair"], memberNames: ["Alex Rivera", "Blair Chen"] }),
    { merge: true },
  ));
  await waitFor(() => expect(search).toHaveValue(""));
  expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
});

test("switching boards, starting a new board, and reopening clear member search", async () => {
  mockBoardData([{ id: "repairs", name: "Repair team", memberUserIds: ["alex"], memberNames: ["Alex Rivera"] }]);
  let dialog = await openBoards();
  const search = within(dialog).getByRole("searchbox", { name: "Search board members" });
  fireEvent.change(search, { target: { value: "blair" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Repair team/ }));
  expect(search).toHaveValue("");
  expect(within(dialog).getByRole("heading", { name: "Edit Board" })).toBeInTheDocument();
  expect(within(dialog).getByRole("checkbox", { name: /Alex Rivera/ })).toBeChecked();
  fireEvent.change(search, { target: { value: "casey" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "New", exact: true }));
  expect(search).toHaveValue("");
  expect(within(dialog).getByRole("textbox", { name: "Board Name" })).toHaveValue("");
  expect(within(dialog).getByRole("heading", { name: "Create New Board" })).toBeInTheDocument();
  expect(within(dialog).getByRole("checkbox", { name: /Alex Rivera/ })).not.toBeChecked();
  fireEvent.change(search, { target: { value: "alex" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close board manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Boards" }));
  dialog = screen.getByRole("dialog", { name: "Work Offer Boards" });
  expect(within(dialog).getByRole("searchbox", { name: "Search board members" })).toHaveValue("");
  expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
});

test("boards without company members show an explicit empty state", async () => {
  const dialog = await openBoards();
  expect(within(dialog).getByRole("status")).toHaveTextContent("No company members available.");
});
