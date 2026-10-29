import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  getDoc: async () => ({ exists: () => false }), getDocs: async () => ({ docs: [] }),
  where: jest.fn(), query: jest.fn(), limit: jest.fn(), serverTimestamp: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), Timestamp: {},
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./WorkOfferManagementDialog", () => props => <div role="dialog" aria-label="Offer management"><p>{props.offer.id} · {props.initialTab}</p><button onClick={props.onClose}>Close manager</button></div>);
const offer = { id: "comp_work_offer_one", jobId: "job", title: "Pump repair", offerType: "Direct User", status: "Sent", offeredToUserId: "tech", offeredToUserName: "Alex", paySource: "Offered Amount", offeredAmountCents: 10000 };
beforeEach(() => { mockPermissions = ["324", "328", "332"]; manageTechnicianWork.mockResolvedValue({ offers: [offer] }); });
const open = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Context.Provider value={{ recentlySelectedCompany: "company", user: { uid: "manager" } }}><OfferedWork /></Context.Provider></MemoryRouter>);
test("management list opens, edits, deletes, and incentivizes the selected offer instead of navigating to its job", async () => {
  open();
  const row = await screen.findByRole("row", { name: /Pump repair/ });
  expect(within(row).getByRole("link", { name: "Open job" })).toHaveAttribute("href", "/company/jobs/detail/job/actual");
  for (const [label, tab] of [["Open offer", "details"], ["Edit offer", "edit"], ["Delete offer", "delete"], ["Incentive", "incentive"]]) {
    fireEvent.click(within(row).getByRole("button", { name: label }));
    expect(screen.getByRole("dialog")).toHaveTextContent(`comp_work_offer_one · ${tab}`);
    fireEvent.click(screen.getByRole("button", { name: "Close manager" }));
  }
});
test("read-all permission exposes details without granting edit, delete, or incentive access", async () => {
  mockPermissions = ["332"];
  open();
  const row = await screen.findByRole("row", { name: /Pump repair/ });
  expect(within(row).getByRole("button", { name: "Open offer" })).toBeEnabled();
  expect(within(row).queryByRole("button", { name: "Edit offer" })).not.toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Delete offer" })).not.toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Incentive" })).not.toBeInTheDocument();
});
