import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDocs, onSnapshot } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import RepairRequests from "./RepairRequests";

const mockNavigate = jest.fn();
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ can: () => true }));
jest.mock("react-router-dom", () => ({ ...jest.requireActual("react-router-dom"), useNavigate: () => mockNavigate }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"),
  query: (collection) => collection,
  where: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  onSnapshot.mockImplementation((path, callback) => {
    if (path.endsWith('/repairRequests') || path === 'homeownerRepairRequests') {
      let active = true;
      getDocs(path).then((snapshot) => { if (active) callback(snapshot); });
      return () => { active = false; };
    }
    callback({ docs: [] });
    return () => {};
  });
});

test("external technician requests open company records while homeowner requests keep their own source", async () => {
  const snapshot = (id, description, extra = {}) => ({ id, data: () => ({
    id, description, date: { toDate: () => new Date() }, status: "Unresolved",
    requesterName: "Alex Technician", customerName: "Taylor Homeowner", ...extra,
  }) });
  getDocs.mockImplementation(async (path) => ({ docs: path === "companies/test-company/repairRequests" ? [
    snapshot("internal-request", "Internal issue"),
    snapshot("technician-request", "Technician issue", { source: "publicTechnician", customerId: "customer-taylor", equipmentId: "company-pump", serviceLocationName: "Backyard" }),
  ] : path === "homeownerRepairRequests" ? [snapshot("homeowner-request", "Homeowner issue")] : [] }));
  render(<MemoryRouter><Context.Provider value={{ recentlySelectedCompany: "test-company" }}><RepairRequests /></Context.Provider></MemoryRouter>);
  await screen.findByText("Internal issue");
  expect(screen.getByText("Technician issue")).toBeInTheDocument();
  expect(screen.getByText("Homeowner issue")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Internal Requests/ }));
  expect(screen.queryByText("Technician issue")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^External Requests/ }));
  expect(await screen.findByText("Technician issue")).toBeInTheDocument();
  expect(screen.getByText("Homeowner issue")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Technician issue"));
  expect(mockNavigate).toHaveBeenLastCalledWith("/company/repair-requests/detail/technician-request", {
    state: expect.objectContaining({ sourcePath: "company", repairRequest: expect.objectContaining({ customerId: "customer-taylor", equipmentId: "company-pump" }) }),
  });
  fireEvent.click(screen.getByText("Homeowner issue"));
  expect(mockNavigate).toHaveBeenLastCalledWith("/company/repair-requests/detail/homeowner-request", {
    state: expect.objectContaining({ sourcePath: "homeowner" }),
  });
});

test("unresolved comment badges update live and disappear when all comments are resolved", async () => {
  const requests = ["with-comments", "without-comments"].map((id) => ({ id, data: () => ({ id, description: id, status: "Unresolved" }) }));
  getDocs.mockImplementation(async (path) => ({ docs: path.endsWith("/repairRequests") ? requests : [] }));
  let updateComments;
  const unsubscribe = jest.fn();
  const defaultSnapshot = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((path, callback) => {
    if (!path.endsWith('/comments')) return defaultSnapshot(path, callback);
    if (path.endsWith("/with-comments/comments")) {
      updateComments = callback;
      callback({ docs: [{ data: () => ({ resolved: false }) }, { data: () => ({ resolved: true }) }, { data: () => ({ comment: "Legacy open comment" }) }] });
    } else callback({ docs: [] });
    return unsubscribe;
  });
  const view = render(<MemoryRouter><Context.Provider value={{ recentlySelectedCompany: "test-company" }}><RepairRequests /></Context.Provider></MemoryRouter>);
  const badge = await screen.findByLabelText("2 unresolved comments");
  expect(badge).toHaveTextContent(/^2$/);
  expect(badge).toHaveClass("bg-red-500", "text-white");
  expect(within(screen.getByText("without-comments").closest("tr")).queryByLabelText(/unresolved comments/)).not.toBeInTheDocument();
  act(() => updateComments({ docs: [{ data: () => ({ resolved: true }) }] }));
  expect(screen.queryByLabelText(/unresolved comments/)).not.toBeInTheDocument();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  act(() => updateComments({ docs: [{ data: () => ({ resolved: false }) }] }));
});

test("company and homeowner requests with the same ID use their own comment collections", async () => {
  getDocs.mockImplementation(async (path) => ({ docs: path === "companies/test-company/repairRequests" ? [{
    id: "shared-id", data: () => ({ id: "shared-id", description: "Technician issue", source: "publicTechnician", status: "Unresolved" }),
  }] : path === "homeownerRepairRequests" ? [{
    id: "shared-id", data: () => ({ id: "shared-id", description: "Homeowner issue", status: "Unresolved" }),
  }] : [] }));
  const defaultSnapshot = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((path, callback) => {
    if (!path.endsWith('/comments')) return defaultSnapshot(path, callback);
    const count = path.startsWith("companies/") ? 1 : 3;
    callback({ docs: Array.from({ length: count }, () => ({ data: () => ({ resolved: false }) })) });
    return () => {};
  });
  render(<MemoryRouter><Context.Provider value={{ recentlySelectedCompany: "test-company" }}><RepairRequests /></Context.Provider></MemoryRouter>);
  await screen.findByText("Technician issue");
  await waitFor(() => expect(within(screen.getByText("Technician issue").closest("tr")).getByLabelText("1 unresolved comments")).toHaveTextContent(/^1$/));
  expect(within(screen.getByText("Homeowner issue").closest("tr")).getByLabelText("3 unresolved comments")).toHaveTextContent(/^3$/);
  expect(onSnapshot).toHaveBeenCalledWith("companies/test-company/repairRequests/shared-id/comments", expect.any(Function), expect.any(Function));
  expect(onSnapshot).toHaveBeenCalledWith("homeownerRepairRequests/shared-id/comments", expect.any(Function), expect.any(Function));
});

test("the initial list matches the needs-action badge across all dates and sources, and filters remain adjustable", async () => {
  const requests = require('../../../utils/models/repairRequestQueueFixtures.json');
  getDocs.mockImplementation(async (path) => ({ docs: requests.filter((request) => path === 'homeownerRepairRequests' ? request.sourcePath === 'homeowner' : request.sourcePath === 'company').map((request) => ({
    id: request.id, data: () => ({ ...request, description: `${request.sourcePath}:${request.id}` }),
  })) }));
  render(<MemoryRouter><Context.Provider value={{ recentlySelectedCompany: 'test-company' }}><RepairRequests /></Context.Provider></MemoryRouter>);
  await screen.findByText('company:old-open');
  expect(screen.getByText('Needs action: 12')).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(13);
  expect(screen.getByText('homeowner:homeowner')).toBeInTheDocument();
  expect(screen.queryByText('company:in-progress')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Repair requests start date'), { target: { value: '2026-01-01' } });
  expect(screen.queryByText('company:old-open')).not.toBeInTheDocument();
  expect(screen.getByText('Needs action: 12')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All', exact: true }));
  expect(screen.getByText('company:in-progress')).toBeInTheDocument();
  expect(screen.getByText('company:resolved')).toBeInTheDocument();
});

test('opening My Repair Requests initially shows only submissions by the signed-in technician', async () => {
  const requests = require('../../../utils/models/repairRequestQueueFixtures.json');
  getDocs.mockImplementation(async (path) => ({ docs: requests.filter((request) => path === 'homeownerRepairRequests' ? request.sourcePath === 'homeowner' : request.sourcePath === 'company').map((request) => ({
    id: request.id, data: () => ({ ...request, description: `${request.sourcePath}:${request.id}` }),
  })) }));
  render(<MemoryRouter initialEntries={['/company/repair-requests?submittedBy=me']}><Context.Provider value={{ recentlySelectedCompany: 'test-company', user: { uid: 'tech-1' } }}><RepairRequests /></Context.Provider></MemoryRouter>);
  await screen.findByText('6 requests showing');
  expect(screen.getByRole('checkbox', { name: 'Only requests I submitted' })).toBeChecked();
  expect(screen.queryByText('company:assigned-customer')).not.toBeInTheDocument();
  expect(screen.queryByText('company:different-submitter')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Only requests I submitted' }));
  expect(screen.getByText('12 requests showing')).toBeInTheDocument();
});
