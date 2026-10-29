import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { deleteDoc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { appConfirm, appPrompt } from "../../../utils/appDialog";
import JobDetailView from "./JobDetailView";
import { runWorkCompletionEffects } from "../../../utils/workCompletionEffects";

let mockJob;
let mockPermissions;
let mockBatchWrites;
let mockBatchError;
let mockBatchCommit;
const mockWorkspaceCall = jest.fn();
const mockSites = {
  "site-1": { customerId: "customer-1", nickName: "Pool", address: { streetAddress: "11 Old Street" } },
  "site-2": { customerId: "customer-1", nickName: "Spa", address: { streetAddress: "22 New Street" } },
};
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });

jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {}, functions: {}, storage: {} }));
jest.mock("../../../utils/callableAuth", () => ({ getCallableAuthPayload: async () => ({ idToken: "test-token" }) }));
jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn(() => (...args) => mockWorkspaceCall(...args)) }));
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({
  can: (id) => mockPermissions.includes(String(id)),
  requirePermission: (id) => mockPermissions.includes(String(id)),
}));
jest.mock("../../../utils/appDialog", () => ({ appConfirm: jest.fn(), appPrompt: jest.fn() }));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../components/share/ShareItemButton", () => () => null);
jest.mock("../../../utils/workCompletionEffects", () => ({ runWorkCompletionEffects: jest.fn(async () => ({})) }));
jest.mock("firebase/firestore", () => {
  const ref = (first, ...parts) => [typeof first === "string" ? first : "", ...parts].filter(Boolean).join("/");
  return {
    collection: ref, doc: ref,
    query: (path, ...constraints) => ({ path: path.path || path, constraints: [...(path.constraints || []), ...constraints] }),
    where: (...args) => args, orderBy: jest.fn(),
    getDoc: jest.fn(), getDocs: jest.fn(), updateDoc: jest.fn(), setDoc: jest.fn(), deleteDoc: jest.fn(),
    onSnapshot: jest.fn(),
    serverTimestamp: () => "server-time", Timestamp: { fromDate: (date) => date },
    arrayUnion: jest.fn(), arrayRemove: jest.fn(),
    writeBatch: () => ({
      update: (ref, data) => mockBatchWrites.push({ type: "update", ref, data }),
      set: (ref, data) => mockBatchWrites.push({ type: "set", ref, data }),
      delete: (ref) => mockBatchWrites.push({ type: "delete", ref }),
      commit: async () => {
        if (mockBatchError) throw mockBatchError;
        if (mockBatchCommit) await mockBatchCommit(mockBatchWrites);
        mockBatchWrites.filter((write) => write.ref.endsWith("workOrders/job-1")).forEach((write) => Object.assign(mockJob, write.data));
      },
    }),
  };
});

const snapshot = (id, data) => ({ id, ref: id, exists: () => Boolean(data), data: () => data });
const openJob = async (initialEntry = "/company/jobs/detail/job-1/overview") => {
  await act(async () => { render(
    <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Context.Provider value={{ recentlySelectedCompany: "company-1", user: { uid: "user-1" } }}>
        <Routes><Route path="/company/jobs/detail/:jobId/:section?" element={<JobDetailView />} /></Routes>
      </Context.Provider>
    </MemoryRouter>
  ); });
  if (typeof initialEntry === 'string' || initialEntry.pathname.endsWith('/overview')) await screen.findByText("11 Old Street");
  else await screen.findByRole('button', { name: 'Actions', exact: true });
};
const openActions = () => fireEvent.click(screen.getByRole("button", { name: "Actions", exact: true }));
const openWorkOffer = async ({ canIncentivize = true, services = [] } = {}) => {
  if (canIncentivize) mockPermissions.push("328");
  mockJob.laborLineItems = services;
  const originalGetDocs = getDocs.getMockImplementation();
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    const records = path.endsWith("companyUsers") ? [
      { id: "alex", userId: "alex", userName: "Alex Adams" },
      { id: "zoe", userId: "zoe", userName: "Zoe Baker" },
    ] : path.endsWith("workOrders/job-1/tasks") ? [
      { id: "repair-task", name: "Repair pump", payTypeId: "repair", payrollMode: "automatic", estimatedTime: 60 },
      { id: "custom-task", name: "Clean filter", payTypeId: "clean", payrollMode: "custom", manualPayOverrideCents: 2500, estimatedTime: 30 },
    ] : path.endsWith("companyPayTypes") ? [
      { id: "unrelated", name: "Unrelated first pay item" }, { id: "repair", name: "Pump repair" }, { id: "clean", name: "Filter cleaning" },
    ] : null;
    return records ? { docs: records.map((row) => snapshot(row.id, row)), empty: false, size: records.length } : originalGetDocs(ref);
  });
  const offerCall = jest.fn(async ({ action, offer, technicianId }) => {
    if (action !== "quote") return { data: { offers: [], status: "Sent" } };
    if (!technicianId && offer.paySource === "Technician Rate") return { data: { totalCents: null, needsReview: false } };
    const baseCents = offer.paySource === "Offered Amount" ? offer.offeredAmountCents : 7500;
    const incentiveCents = offer.incentive.type === "flat" ? offer.incentive.amountCents
      : offer.incentive.type === "percentage" ? Math.round(baseCents * offer.incentive.percentage / 100) : 0;
    return { data: { baseCents, incentiveCents, totalCents: baseCents + incentiveCents, needsReview: false } };
  });
  httpsCallable.mockImplementation((functions, name) => name === "manageTechnicianWork" ? offerCall : mockWorkspaceCall);
  await openJob({ pathname: "/company/jobs/detail/job-1/actual" });
  fireEvent.click(screen.getByRole("button", { name: "Create Work Offer", exact: true }));
  return { dialog: await screen.findByRole("dialog", { name: "Create Work Offer" }), offerCall };
};

test("work offers search technician names and use the selected plan tasks' pay without extra setup", async () => {
  const { dialog, offerCall } = await openWorkOffer();
  expect(within(dialog).getByRole("checkbox", { name: /Override pay for this offer/ })).not.toBeChecked();
  expect(within(dialog).queryByLabelText("Visit pay type override")).not.toBeInTheDocument();
  const pay = within(dialog).getByRole("region", { name: "Technician pay" });
  expect(pay).toHaveTextContent("Pump repair");
  expect(pay).toHaveTextContent("Custom pay: $25.00");
  expect(pay).not.toHaveTextContent("Unrelated first pay item");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Technician" }), { target: { value: "Zoe" } });
  expect(await screen.findByText("Zoe Baker")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Zoe Baker"));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "quote", technicianId: "zoe", offer: expect.objectContaining({ serviceStopTypeId: "", paySource: "Technician Rate", jobTaskIds: ["repair-task", "custom-task"] }) })));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create Offer" }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "save", offer: expect.objectContaining({ offeredToUserId: "zoe", serviceStopTypeId: "", paySource: "Technician Rate", offeredAmountCents: 0, jobTaskIds: ["repair-task", "custom-task"], incentive: expect.objectContaining({ type: "none" }) }) })));
});

test("turning off optional pay overrides and incentives restores planned pay in the saved offer", async () => {
  const { dialog, offerCall } = await openWorkOffer();
  const override = within(dialog).getByRole("checkbox", { name: /Override pay for this offer/ });
  fireEvent.click(override);
  fireEvent.change(within(dialog).getByLabelText("Visit pay type override"), { target: { value: "unrelated" } });
  fireEvent.change(within(dialog).getByLabelText("Pay source override"), { target: { value: "Offered Amount" } });
  fireEvent.change(within(dialog).getByLabelText("Offered amount"), { target: { value: "120" } });
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "quote", offer: expect.objectContaining({ serviceStopTypeId: "unrelated", paySource: "Offered Amount", offeredAmountCents: 12000 }) })));
  fireEvent.click(override);
  expect(within(dialog).queryByLabelText("Pay source override")).not.toBeInTheDocument();
  const incentive = within(dialog).getByRole("checkbox", { name: "Add incentive" });
  fireEvent.click(incentive);
  fireEvent.change(within(dialog).getByLabelText("Incentive amount"), { target: { value: "10" } });
  fireEvent.click(incentive);
  expect(within(dialog).queryByLabelText("Incentive amount")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Create Offer" }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "save", offer: expect.objectContaining({ serviceStopTypeId: "", paySource: "Technician Rate", offeredAmountCents: 0, incentive: expect.objectContaining({ type: "none", amountCents: 0, percentage: 0 }) }) })));
});

test("the separate incentive section supports percentages and notes before a personal quote is available", async () => {
  const { dialog, offerCall } = await openWorkOffer();
  const incentive = within(dialog).getByRole("region", { name: "Offer incentive" });
  expect(within(incentive).queryByLabelText("Incentive type")).not.toBeInTheDocument();
  fireEvent.click(within(incentive).getByRole("checkbox", { name: "Add incentive" }));
  fireEvent.change(within(incentive).getByLabelText("Incentive type"), { target: { value: "percentage" } });
  fireEvent.change(within(incentive).getByLabelText("Incentive percent"), { target: { value: "10" } });
  fireEvent.change(within(incentive).getByLabelText("Incentive notes"), { target: { value: "Complete by Friday" } });
  await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("$82.50"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create Offer" }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "save", offer: expect.objectContaining({ incentive: expect.objectContaining({ type: "percentage", percentage: 10, notes: "Complete by Friday" }) }) })));
});

test("offer incentives stay hidden without permission and diagnostics use the estimate pay type", async () => {
  const { dialog, offerCall } = await openWorkOffer({ canIncentivize: false });
  expect(within(dialog).queryByRole("checkbox", { name: "Add incentive" })).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Requested work" }), { target: { value: "diagnostic" } });
  expect(within(dialog).queryByText("Work Scope")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Create Offer" }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "save", offer: expect.objectContaining({ workPurpose: "diagnostic", serviceStopTypeId: "system_job_estimate_service_stop", jobTaskIds: [], incentive: expect.objectContaining({ type: "none" }) }) })));
});

test("board offers keep incentive notes available without a personal pay quote", async () => {
  const { dialog, offerCall } = await openWorkOffer();
  const offerType = within(dialog).getAllByRole("combobox").find((element) => element.value === "Direct User");
  fireEvent.change(offerType, { target: { value: "Internal Board" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Add incentive" }));
  fireEvent.change(within(dialog).getByLabelText("Incentive amount"), { target: { value: "15" } });
  fireEvent.change(within(dialog).getByLabelText("Incentive notes"), { target: { value: "Board bonus" } });
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "quote", technicianId: "", offer: expect.objectContaining({ incentive: expect.objectContaining({ amountCents: 1500, notes: "Board bonus" }) }) })));
  expect(within(dialog).getByLabelText("Incentive notes")).toHaveValue("Board bonus");
  expect(within(dialog).getByRole("status")).toHaveTextContent("Each technician reviews their personal pay before accepting.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create Offer" }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "save", offer: expect.objectContaining({ offerType: "Internal Board", offeredToUserId: "", incentive: expect.objectContaining({ type: "flat", amountCents: 1500, notes: "Board bonus" }) }) })));
});

test("a planned service's visit pay item is inherited without selecting a pay override", async () => {
  const { dialog, offerCall } = await openWorkOffer({ services: [
    { id: "service", name: "Pump service", sourceType: "serviceStopType", sourceId: "repair", taskIds: ["repair-task", "custom-task"] },
  ] });
  const pay = within(dialog).getByRole("region", { name: "Technician pay" });
  expect(pay).toHaveTextContent("Pump service · visit pay item");
  expect(within(dialog).getByRole("checkbox", { name: /Override pay for this offer/ })).not.toBeChecked();
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "quote", offer: expect.objectContaining({ serviceStopTypeId: "repair", paySource: "Technician Rate" }) })));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Override pay for this offer/ }));
  expect(within(dialog).getByLabelText("Visit pay type override")).toHaveValue("repair");
  fireEvent.change(within(dialog).getByLabelText("Visit pay type override"), { target: { value: "unrelated" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Override pay for this offer/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create Offer" }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "save", offer: expect.objectContaining({ serviceStopTypeId: "repair", paySource: "Technician Rate" }) })));
});

test("different service visit pay items require a clear choice and follow the selected work scope", async () => {
  const { dialog, offerCall } = await openWorkOffer({ services: [
    { id: "pump", name: "Pump service", sourceType: "serviceStopType", sourceId: "repair", taskIds: ["repair-task"] },
    { id: "filter", name: "Filter service", sourceType: "serviceStopType", sourceId: "clean", taskIds: ["custom-task"] },
  ] });
  expect(within(dialog).getByRole("status")).toHaveTextContent("Selected services use different visit pay items");
  expect(within(dialog).getByRole("button", { name: "Create Offer" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Clean filter/ }));
  await waitFor(() => expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "quote", offer: expect.objectContaining({ serviceStopTypeId: "repair", jobTaskIds: ["repair-task"] }) })));
  expect(within(dialog).getByRole("status")).not.toHaveTextContent("Selected services use different visit pay items");
  expect(within(dialog).getByRole("button", { name: "Create Offer" })).toBeEnabled();
});

const openServiceCreator = async () => {
  await openJob();
  fireEvent.click(screen.getByRole("button", { name: /^Create Plans/ }));
  fireEvent.click((await screen.findAllByRole("button", { name: "Service", exact: true }))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Create Service", exact: true }));
  return screen.findByRole("combobox", { name: "Default payroll pay item" });
};
const enterEdit = async () => {
  openActions();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit", exact: true }));
  return screen.findByRole("combobox", { name: "Customer site" });
};
const chooseNewSite = async () => {
  const input = await screen.findByRole("combobox", { name: "Customer site" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(await screen.findByText("Spa — 22 New Street"));
};

beforeEach(() => {
  jest.clearAllMocks();
  setDoc.mockResolvedValue(undefined);
  runWorkCompletionEffects.mockResolvedValue({});
  mockPermissions = ["24", "26"];
  mockBatchWrites = [];
  mockBatchError = null;
  mockBatchCommit = null;
  mockWorkspaceCall.mockReset();
  httpsCallable.mockImplementation((functions,name) => name === "manageTechnicianWork" ? async () => ({data:{offers:[]}}) : mockWorkspaceCall);
  onSnapshot.mockImplementation((ref, callback) => { callback(typeof ref === "string" && ref.split("/").length % 2 === 0 ? snapshot(ref.split("/").pop(), ref.endsWith("/workOrders/job-1") ? mockJob : null) : { docs: [], empty: true, size: 0 }); return () => {}; });
  mockJob = {
    id: "job-1", internalId: "JOB-1", customerId: "customer-1", customerName: "Test Customer",
    serviceLocationId: "site-1", bodyOfWaterId: "old-pool", equipmentId: "old-pump", equipmentIds: ["old-pump"],
    billingStatus: "Draft", operationStatus: "Estimate Pending", issuePriorityLevel: "2", rate: 0,
  };
  getDoc.mockImplementation(async (path) => snapshot(path.split("/").pop(),
    path.endsWith("workOrders/job-1") ? { ...mockJob }
      : path.includes("serviceLocations/") ? mockSites[path.split("/").pop()]
        : path.endsWith("customers/customer-1") ? { id: "customer-1", firstName: "Test", lastName: "Customer" } : null));
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    const docs = path.endsWith("serviceLocations")
      ? Object.entries(mockSites).map(([id, data]) => snapshot(id, data)) : [];
    return { docs, empty: !docs.length, size: docs.length };
  });
  updateDoc.mockImplementation(async (path, updates) => {
    if (path.endsWith("workOrders/job-1")) Object.assign(mockJob, updates);
  });
  appConfirm.mockResolvedValue(false);
  appPrompt.mockResolvedValue(null);
});

test.each(["button", "search"])("creating a payroll pay item from the %s selects it without saving or clearing the service draft", async (entry) => {
  mockPermissions.push("424");
  const picker = await openServiceCreator();
  fireEvent.change(screen.getByLabelText("Service Name"), { target: { value: "Service draft" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Keep this description" } });
  if (entry === "search") {
    fireEvent.change(picker, { target: { value: "Filter cleaning" } });
    fireEvent.click(await screen.findByText('Create payroll pay item "Filter cleaning"'));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Create payroll pay item" }));
  }
  const dialog = await screen.findByRole("dialog", { name: "Create payroll pay item" });
  if (entry === "button") fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Filter cleaning" } });
  else expect(within(dialog).getByLabelText("Name")).toHaveValue("Filter cleaning");
  const submit = within(dialog).getByRole("button", { name: "Create & select" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create payroll pay item" })).not.toBeInTheDocument());
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(setDoc).toHaveBeenCalledWith(expect.stringContaining("companies/company-1/companyPayTypes/comp_work_type_"), expect.objectContaining({ name: "Filter cleaning", bucketId: "job", createdByUserId: "user-1" }), { merge: true });
  expect(screen.getByLabelText("Service Name")).toHaveValue("Service draft");
  expect(screen.getByLabelText("Description")).toHaveValue("Keep this description");
  expect(picker.parentElement.parentElement).toHaveTextContent("Filter cleaning");
  expect(mockWorkspaceCall).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add Task", exact: true }));
  expect(screen.getByPlaceholderText("Clean filter")).toHaveValue("Filter cleaning");
});

test("canceling pay item creation keeps the service draft and does not create an item", async () => {
  mockPermissions.push("424");
  await openServiceCreator();
  fireEvent.change(screen.getByLabelText("Service Name"), { target: { value: "Service draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Create payroll pay item" }));
  const dialog = await screen.findByRole("dialog", { name: "Create payroll pay item" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create payroll pay item" })).not.toBeInTheDocument());
  expect(screen.getByLabelText("Service Name")).toHaveValue("Service draft");
  expect(setDoc).not.toHaveBeenCalled();
});

test("service editors without Manage Payroll permission can search but cannot create pay items", async () => {
  const picker = await openServiceCreator();
  expect(screen.queryByRole("button", { name: "Create payroll pay item" })).not.toBeInTheDocument();
  fireEvent.change(picker, { target: { value: "New payroll item" } });
  expect(await screen.findByText("No matching payroll pay items")).toBeInTheDocument();
  expect(screen.queryByText('Create payroll pay item "New payroll item"')).not.toBeInTheDocument();
  expect(setDoc).not.toHaveBeenCalled();
});

test("site edits are customer-scoped, save with history, and refresh the displayed address", async () => {
  await openJob();
  await enterEdit();
  await chooseNewSite();
  expect(getDocs).toHaveBeenCalledWith(expect.objectContaining({
    path: "companies/company-1/serviceLocations", constraints: [["customerId", "==", "customer-1"]],
  }));
  const headerControls = screen.getByRole("button", { name: "Cancel", exact: true }).parentElement;
  fireEvent.click(within(headerControls).getByRole("button", { name: "Save", exact: true }));
  await screen.findByText("22 New Street");
  expect(mockJob).toEqual(expect.objectContaining({ serviceLocationId: "site-2", serviceLocationName: "Spa", equipmentId: "", bodyOfWaterId: "", equipmentIds: [] }));
  expect(setDoc).toHaveBeenCalledWith(expect.stringContaining("/history/"), expect.objectContaining({
    changes: expect.arrayContaining([expect.objectContaining({ field: "serviceLocationId", before: "Pool — 11 Old Street", after: "Spa — 22 New Street" })]),
  }));
  expect(getDocs).toHaveBeenCalledWith(expect.objectContaining({
    path: "companies/company-1/equipment", constraints: [["serviceLocationId", "==", "site-2"]],
  }));
});

test("canceling Edit discards a site selection", async () => {
  await openJob();
  await enterEdit();
  await chooseNewSite();
  fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.getByText("11 Old Street")).toBeInTheDocument();
  expect(updateDoc).not.toHaveBeenCalled();
  await enterEdit();
  expect(screen.getByText("Pool — 11 Old Street")).toBeInTheDocument();
});

test.each([
  ["Cancel to Potential Work", appConfirm, "Cancel to Potential Work"],
  ["Cancel Job Only", appPrompt, "Cancel Job Only"],
  ["Customer Took Care Of It", appPrompt, "Customer Took Care Of It"],
  ["Delete Job", appConfirm, "Delete Job"],
])("Actions opens %s without Edit and keeps its confirmation", async (label, confirm, title) => {
  await openJob();
  expect(screen.queryByRole("button", { name: /^Cancel to Potential Work/ })).not.toBeInTheDocument();
  openActions();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "Cancel or delete job" });
  expect(within(dialog).getByRole("button", { name: /^Cancel Job Only/ })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: /^Customer Took Care Of It/ })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: /^Delete Job/ })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${label}`) }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(updateDoc).not.toHaveBeenCalled();
});

test("delete-only roles can open the popup while finished jobs stay protected", async () => {
  mockPermissions = ["26"];
  mockJob.operationStatus = "Finished";
  await openJob();
  openActions();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete", exact: true }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByRole("button", { name: /^Cancel Job Only/ })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: /^Delete Job/ })).toBeDisabled();
});


test("a site that no longer belongs to the customer cannot be saved", async () => {
  await openJob();
  await enterEdit();
  await chooseNewSite();
  getDoc.mockResolvedValueOnce(snapshot("site-2", { ...mockSites["site-2"], customerId: "another-customer" }));
  const headerControls = screen.getByRole("button", { name: "Cancel", exact: true }).parentElement;
  fireEvent.click(within(headerControls).getByRole("button", { name: "Save", exact: true }));
  await act(async () => {});
  expect(updateDoc).not.toHaveBeenCalled();
  expect(mockJob.serviceLocationId).toBe("site-1");
});

const installTemplateFixtures = () => {
  const previousGetDoc = getDoc.getMockImplementation();
  const previousGetDocs = getDocs.getMockImplementation();
  const template = { id: 'template-1', name: 'Pump repair', description: 'Repair using the standard kit', isActive: true, taskCount: 1, laborLineCount: 1 };
  const oldTask = { id: 'existing-task', name: 'Existing inspection', status: 'Draft', type: 'General' };
  mockJob.laborLineItems = [{ id: 'existing-line', name: 'Existing inspection service', quantity: 1, totalPriceCents: 5000, unitPriceCents: 5000, internalCostCents: 1000, taskIds: ['existing-task'] }];
  getDoc.mockImplementation(async (path) => path.endsWith('jobTemplates/template-1') ? snapshot('template-1', template) : previousGetDoc(path));
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    let docs;
    if (path.endsWith('/jobTemplates')) docs = [snapshot('template-1', template), snapshot('inactive-template', { name: 'Archived template', isActive: false })];
    else if (path.endsWith('/jobTemplates/template-1/tasks')) docs = [snapshot('template-task', { name: 'Template repair task', type: 'Repair', contractedRate: 3000 })];
    else if (path.endsWith('/jobTemplates/template-1/plannedServiceStops')) docs = [snapshot('template-stop', { name: 'Repair visit', taskTemplateIds: ['template-task'] })];
    else if (path.endsWith('/jobTemplates/template-1/laborLineItems')) docs = [snapshot('template-line', { name: 'Template repair service', quantity: 1, totalPriceCents: 10000, internalCostCents: 3000, taskTemplateIds: ['template-task'], plannedServiceStopTemplateIds: ['template-stop'] })];
    else if (path.endsWith('/jobTemplates/template-1/shoppingItems')) docs = [snapshot('template-product', { name: 'Repair seal', quantity: '2', plannedUnitPriceCents: 500, plannedUnitCostCents: 200, linkedTaskId: 'template-task' })];
    else if (path.endsWith('/workOrders/job-1/tasks')) docs = [snapshot('existing-task', oldTask)];
    else return previousGetDocs(ref);
    return { docs, empty: !docs.length, size: docs.length };
  });
};

const chooseJobTemplate = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  const button = await screen.findByRole('button', { name: 'Use Template', exact: true });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Use Template' });
  const input = await within(dialog).findByRole('combobox', { name: 'Job template' });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
  expect(screen.queryByText('Archived template')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByText('Pump repair'));
  return dialog;
};

test.each([
  ['add', 2, 16000],
  ['overwrite', 1, 11000],
])('Use Template %s saves the scope and calculated plan together', async (mode, expectedTasks, expectedPrice) => {
  installTemplateFixtures();
  await openJob();
  const dialog = await chooseJobTemplate();
  if (mode === 'overwrite') fireEvent.click(within(dialog).getByRole('radio', { name: /^Overwrite Planned Scope/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: mode === 'add' ? 'Add to Job' : 'Overwrite Planned Scope', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const plan = mockBatchWrites.find((write) => write.type === 'set' && write.ref.includes('/plans/')).data;
  expect(plan).toEqual(expect.objectContaining({ taskCount: expectedTasks, totalAmountCents: expectedPrice, isAccepted: false, sourceTemplateId: 'template-1' }));
  const task = plan.tasks.find((item) => item.sourceTemplateTaskId === 'template-task');
  const stop = plan.plannedServiceStops[0];
  expect(stop.taskIds).toEqual([task.id]);
  expect(plan.laborLineItems.find((line) => line.sourceTemplateLaborLineId)).toEqual(expect.objectContaining({ taskIds: [task.id], plannedServiceStopIds: [stop.id] }));
  expect(plan.shoppingItems[0]).toEqual(expect.objectContaining({ jobId: 'job-1', customerId: 'customer-1', serviceLocationId: 'site-1', linkedTaskId: task.id }));
  expect(mockBatchWrites.some((write) => write.type === 'delete' && write.ref === 'existing-task')).toBe(mode === 'overwrite');
  expect(mockJob).toEqual(expect.objectContaining({ customerId: 'customer-1', serviceLocationId: 'site-1', billingStatus: 'Draft', operationStatus: 'Estimate Pending' }));
  expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument();
  expect(setDoc).toHaveBeenCalledWith(expect.stringContaining('/history/'), expect.objectContaining({ eventType: 'Template', metadata: expect.objectContaining({ mode, templateId: 'template-1' }) }));
});

test('failed template writes leave the picker open and the original workspace displayed', async () => {
  installTemplateFixtures();
  mockBatchError = new Error('Unable to save template changes');
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await openJob();
    const dialog = await chooseJobTemplate();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to Job', exact: true }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unable to save template changes');
    expect(mockJob.activePlanId).toBeUndefined();
    expect(mockJob.laborLineItems).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel', exact: true }));
    expect(screen.queryByText('Template repair service')).not.toBeInTheDocument();
  } finally { consoleError.mockRestore(); }
});

test('applying a template to an accepted plan creates a draft and retains the accepted snapshot', async () => {
  installTemplateFixtures();
  mockJob.activePlanId = 'accepted-plan';
  mockJob.acceptedPlanId = 'accepted-plan';
  const acceptedPlan = { id: 'accepted-plan', title: 'Accepted repair', status: 'Accepted', isAccepted: true, isActivePlan: true, tasks: [], plannedServiceStops: [], shoppingItems: [], laborLineItems: mockJob.laborLineItems };
  onSnapshot.mockImplementation((ref, callback) => {
    const docs = (ref.path || ref).endsWith('/plans') ? [snapshot('accepted-plan', acceptedPlan)] : [];
    callback(typeof ref === "string" && ref.split("/").length % 2 === 0 ? snapshot(ref.split("/").pop(), ref.endsWith("/workOrders/job-1") ? mockJob : null) : { docs, empty: !docs.length, size: docs.length });
    return () => {};
  });
  await openJob();
  const dialog = await chooseJobTemplate();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to Job', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const savedPlan = mockBatchWrites.find((write) => write.type === 'set' && write.ref.includes('/plans/') && write.data.tasks).data;
  expect(savedPlan.id).not.toBe('accepted-plan');
  expect(savedPlan.status).toBe('Draft');
  expect(mockJob.acceptedPlanId).toBe('accepted-plan');
  expect(mockBatchWrites.find((write) => write.ref.endsWith('/accepted-plan')).data).toEqual(expect.objectContaining({ isActivePlan: false }));
  expect(acceptedPlan.isAccepted).toBe(true);
});

test('Use Template is hidden without permission to build job plans', async () => {
  mockPermissions = [];
  await openJob();
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  expect(screen.queryByRole('button', { name: 'Use Template', exact: true })).not.toBeInTheDocument();
});

const installSavedPlanFixtures = () => {
  mockJob.activePlanId = 'plan-A';
  const plans = ['A', 'B'].map((name) => ({ id: `plan-${name}`, title: `Saved plan ${name}`, status: 'Draft',
    tasks: [], plannedServiceStops: [], shoppingItems: [], laborLineItems: [], totalAmountCents: 0 }));
  onSnapshot.mockImplementation((ref, callback) => {
    const docs = (ref.path || ref).endsWith('/plans') ? plans.map((plan) => snapshot(plan.id, plan)) : [];
    callback(typeof ref === "string" && ref.split("/").length % 2 === 0 ? snapshot(ref.split("/").pop(), ref.endsWith("/workOrders/job-1") ? mockJob : null) : { docs, empty: !docs.length, size: docs.length });
    return () => {};
  });
  appConfirm.mockResolvedValue(true);
  return plans;
};

test('loading a saved plan uses the protected server workflow and refreshes its committed selection', async () => {
  installSavedPlanFixtures();
  mockWorkspaceCall.mockImplementation(async () => {
    mockJob.activePlanId = 'plan-B';
    mockJob.laborLineItems = [{ id: 'server-line', name: 'Committed service', totalPriceCents: 20000 }];
    return { data: { planId: 'plan-B' } };
  });
  await openJob();
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  const selector = await screen.findByRole('combobox', { name: 'Editing plan' });
  await waitFor(() => expect(selector).toBeEnabled());
  fireEvent.change(selector, { target: { value: 'plan-B' } });
  await waitFor(() => expect(selector).toHaveValue('plan-B'));
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'applyJobPlanWorkspace');
  expect(mockWorkspaceCall).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', planId: 'plan-B', mode: 'load', idToken: 'test-token' }));
  expect(deleteDoc).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
  expect(mockJob.laborLineItems[0].id).toBe('server-line');
});

test('a scope conflict keeps the current plan and shows the server explanation without client writes', async () => {
  installSavedPlanFixtures();
  mockWorkspaceCall.mockRejectedValue(new Error('This plan would remove completed work.'));
  const errorToast = jest.spyOn(toast, 'error');
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await openJob();
    fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
    const selector = await screen.findByRole('combobox', { name: 'Editing plan' });
    await waitFor(() => expect(selector).toBeEnabled());
    fireEvent.change(selector, { target: { value: 'plan-B' } });
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('This plan would remove completed work.'));
    expect(selector).toHaveValue('plan-A');
    expect(mockJob.activePlanId).toBe('plan-A');
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  } finally { errorToast.mockRestore(); consoleError.mockRestore(); }
});

test('staff plan acceptance sends the accept action through the same server workflow', async () => {
  installSavedPlanFixtures();
  mockWorkspaceCall.mockImplementation(async () => {
    Object.assign(mockJob, { activePlanId: 'plan-B', acceptedPlanId: 'plan-B', billingStatus: 'Accepted', operationStatus: 'Unscheduled' });
    return { data: { planId: 'plan-B' } };
  });
  await openJob();
  const buttons = await screen.findAllByRole('button', { name: 'Accept Plan', exact: true });
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(mockWorkspaceCall).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-B', mode: 'accept' })));
  await waitFor(() => expect(mockJob.acceptedPlanId).toBe('plan-B'));
  expect(deleteDoc).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
});

const openManualProductLine = async () => {
  await openJob();
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add first product', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Add Product Line' });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Type', exact: true }), { target: { value: 'Part' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name', exact: true }), { target: { value: 'Replacement seal' } });
  return dialog;
};

test.each([
  ['Add Part', 'Adding Part...', false],
  ['Save & Add More Parts', 'Saving Part...', true],
])('%s shows progress, blocks repeat submissions, and finishes its expected workflow', async (label, pendingLabel, keepOpen) => {
  const dialog = await openManualProductLine();
  let finishWrite;
  const pendingWrite = new Promise((resolve) => { finishWrite = resolve; });
  mockBatchCommit = () => pendingWrite;
  const originalGetDocs = getDocs.getMockImplementation();
  let finishRefresh;
  const pendingRefresh = new Promise((resolve) => { finishRefresh = resolve; });
  getDocs.mockImplementation((ref) => (ref.path || ref).endsWith('/shoppingList') ? pendingRefresh : originalGetDocs(ref));

  fireEvent.click(within(dialog).getByRole('button', { name: label, exact: true }));
  const pendingButton = within(dialog).getByRole('button', { name: pendingLabel, exact: true });
  expect(pendingButton).toBeDisabled();
  expect(pendingButton).toHaveAttribute('aria-busy', 'true');
  expect(within(dialog).getByRole('status')).toHaveTextContent('Adding part to the plan');
  expect(within(dialog).getByRole('button', { name: keepOpen ? 'Add Part' : 'Save & Add More Parts', exact: true })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Close product line creator' })).toBeDisabled();
  expect(within(dialog).getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();

  // Enter or another submit event must not create a second part while the first is pending.
  fireEvent.submit(pendingButton.closest('form'));
  expect(mockBatchWrites.filter((write) => write.type === 'set' && write.ref.includes('/shoppingList/'))).toHaveLength(1);
  await act(async () => { finishWrite(); });
  expect(pendingButton).toBeDisabled();
  expect(dialog).toBeInTheDocument();
  await act(async () => { finishRefresh({ docs: [], empty: true, size: 0 }); });

  if (keepOpen) {
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: 'Name', exact: true })).toBeEnabled();
    expect(within(dialog).getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('Part');
    expect(within(dialog).getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue(1);
    expect(within(dialog).getByRole('button', { name: 'Save & Add More Parts', exact: true })).toHaveAttribute('aria-busy', 'false');
    expect(within(dialog).getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  } else {
    expect(screen.queryByRole('dialog', { name: 'Add Product Line' })).not.toBeInTheDocument();
  }
});

test.each(['Add Part', 'Save & Add More Parts'])('%s restores the draft and controls after a failed save so it can be retried', async (label) => {
  const dialog = await openManualProductLine();
  mockBatchCommit = jest.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue(undefined);
  const errorToast = jest.spyOn(toast, 'error');
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fireEvent.click(within(dialog).getByRole('button', { name: label, exact: true }));
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Failed to add item'));
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Replacement seal');
    expect(within(dialog).getByRole('textbox', { name: 'Name', exact: true })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Add Part', exact: true })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Save & Add More Parts', exact: true })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Close product line creator' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Part', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Product Line' })).not.toBeInTheDocument());
    expect(mockBatchWrites.filter((write) => write.type === 'set' && write.ref.includes('/shoppingList/'))).toHaveLength(2);
  } finally { errorToast.mockRestore(); consoleError.mockRestore(); }
});

test('overview includes the next-visit assignment snapshot inside the job summary', async () => {
  const originalGetDocs = getDocs.getMockImplementation();
  getDocs.mockImplementation(async ref => (ref.path || ref).endsWith('/serviceStops') ? {
    docs: [snapshot('next-visit', { id: 'next-visit', jobId: 'job-1', serviceDate: new Date('2030-04-12T09:00:00'), operationStatus: 'Not Finished', techId: 'tech-1', tech: 'Alex Rivera', type: 'Job Visit' })], empty: false,
  } : originalGetDocs(ref));
  await openJob();
  const assignment = await screen.findByRole('region', { name: 'Next work assignment' });
  await waitFor(() => expect(within(assignment).getByText('Alex Rivera')).toBeInTheDocument());
  expect(within(assignment).getByRole('link', { name: 'View visit' })).toHaveAttribute('href', '/company/serviceStops/detail/next-visit');
});

const installCloseoutFixtures = () => {
  Object.assign(mockJob, { operationStatus: 'In Progress', equipmentId: '', equipmentIds: [], laborLineItems: [
    { id: 'service', name: 'Repair service', quantity: 1, unitPriceCents: 1000 },
  ] });
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => 'completion-request' } });
  mockWorkspaceCall.mockResolvedValue({ data: { jobId: 'job-1', finished: true, completedServiceStopIds: ['visit'] } });
  const originalGetDocs = getDocs.getMockImplementation();
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    const data = path.endsWith('/workOrders/job-1/tasks') ? [snapshot('repair', { name: 'Repair pump', type: 'Basic', status: 'Scheduled', workerId: 'tech' })]
      : path.endsWith('/serviceStops') ? [snapshot('visit', { id: 'visit', internalId: 'Visit 42', jobId: 'job-1', operationStatus: 'Not Finished', techId: 'tech', tech: 'Alex' })]
        : path.endsWith('/serviceStops/visit/tasks') ? [
          snapshot('repair-copy', { jobTaskId: 'repair', name: 'Repair pump copy', type: 'Basic', status: 'Not Finished' }),
          snapshot('cleanup', { name: 'Clean up site', type: 'Basic', status: 'Not Finished' }),
        ] : null;
    return data ? { docs: data, empty: !data.length, size: data.length } : originalGetDocs(ref);
  });
};

const openFinishJob = async () => {
  openActions();
  const finish = await screen.findByRole('menuitem', { name: 'Mark As Finished', exact: true });
  await waitFor(() => expect(finish).toBeEnabled());
  fireEvent.click(finish);
  return screen.findByRole('dialog', { name: 'Finish Job', exact: true });
};

test('Quick Finish includes stop tasks and services in the job completion request', async () => {
  installCloseoutFixtures();
  await openJob();
  const dialog = await openFinishJob();
  expect(within(dialog).getByRole('checkbox', { name: 'Repair service', exact: true })).toBeChecked();
  expect(within(dialog).getByRole('checkbox', { name: /^Visit 42/ })).not.toBeChecked();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quick Finish All Remaining Work' }));
  expect(within(dialog).getByRole('checkbox', { name: /^Visit 42/ })).toBeChecked();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Work and Job' }));
  await waitFor(() => expect(mockWorkspaceCall).toHaveBeenCalledWith(expect.objectContaining({
    finishJob: true, serviceIds: ['service'], taskIds: ['repair'], serviceStopIds: ['visit'],
    serviceStopTaskIds: { visit: ['repair-copy', 'cleanup'] }, cancelRemainingVisits: true,
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(runWorkCompletionEffects).toHaveBeenCalledWith(expect.objectContaining({
    task: expect.objectContaining({ id: 'cleanup', workerId: 'tech' }),
    serviceStop: expect.objectContaining({ id: 'visit' }),
  }));
  expect(runWorkCompletionEffects).not.toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ id: 'repair-copy' }) }));
});

test('selected stop work can finish while keeping the job open with accurate feedback', async () => {
  installCloseoutFixtures();
  await openJob();
  const dialog = await openFinishJob();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Finish the entire job' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /^Visit 42/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Selected Work' }));
  await waitFor(() => expect(mockWorkspaceCall).toHaveBeenCalledWith(expect.objectContaining({ finishJob: false, serviceStopIds: ['visit'] })));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Selected work finished. Job kept open.'));
  expect(setDoc).not.toHaveBeenCalledWith(expect.stringContaining('/history/'), expect.objectContaining({ title: 'Job marked as finished' }));
});

test('whole-job completion requires a decision for unchecked visits before any task writes', async () => {
  installCloseoutFixtures();
  await openJob();
  const dialog = await openFinishJob();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Work and Job' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Finish the remaining service stops');
  expect(mockWorkspaceCall).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('failed finalization keeps selections, shows the server error, and reuses its request ID', async () => {
  installCloseoutFixtures();
  mockWorkspaceCall.mockRejectedValueOnce(new Error('Review the remaining scheduled visits before closing the job.'));
  await openJob();
  const dialog = await openFinishJob();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quick Finish All Remaining Work' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Work and Job' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Review the remaining scheduled visits');
  expect(within(dialog).getByRole('checkbox', { name: /^Visit 42/ })).toBeChecked();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Finish Work and Job' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mockWorkspaceCall).toHaveBeenCalledTimes(2);
  expect(mockWorkspaceCall.mock.calls.map(([data]) => data.requestId)).toEqual(['completion-request', 'completion-request']);
});

test('service-stop finish handoff waits for task and visit loading before selecting remaining work', async () => {
  installCloseoutFixtures();
  const loadedGetDocs = getDocs.getMockImplementation();
  let finishTaskLoad;
  const pending = new Promise((resolve) => { finishTaskLoad = resolve; });
  let firstTaskRead = true;
  getDocs.mockImplementation(async (ref) => {
    if ((ref.path || ref).endsWith('/workOrders/job-1/tasks') && firstTaskRead) {
      firstTaskRead = false;
      return pending;
    }
    return loadedGetDocs(ref);
  });
  await openJob({ pathname: '/company/jobs/detail/job-1/Actual', state: { openFinishJobConfirm: true, fromServiceStopId: 'previous' } });
  expect(screen.queryByRole('dialog', { name: 'Finish Job', exact: true })).not.toBeInTheDocument();
  await act(async () => { finishTaskLoad(await loadedGetDocs('companies/company-1/workOrders/job-1/tasks')); });
  const dialog = await screen.findByRole('dialog', { name: 'Finish Job', exact: true });
  expect(within(dialog).getByRole('checkbox', { name: /^Repair pump/ })).toBeChecked();
  expect(within(dialog).getByRole('checkbox', { name: /^Visit 42/ })).toBeInTheDocument();
});

const installProductLinkFixtures = ({ withProduct = true, withInstallTask = false } = {}) => {
  const previousGetDocs = getDocs.getMockImplementation();
  const supplier = { id: 'db-pump', name: 'Supplier pump', category: 'Equipment', rate: 80000, equipmentType: 'Pump', equipmentMake: 'Pentair', equipmentModel: 'VS' };
  const product = { id: 'sell-pump', name: 'Variable speed pump', preferredVendorItemId: 'db-pump', sellPrice: 150000, taxable: true };
  const service = { id: 'install-service', name: 'Install pump service', type: 'service', billingBehavior: 'oneTime', unitAmountCents: 30000,
    metadata: { taskTemplates: [{ id: 'install-template', name: 'Install the pump', type: 'Install', genericItemId: 'sell-pump', dataBaseItemId: 'db-pump', productQuantity: 1 }] } };
  const previousOnSnapshot = onSnapshot.getMockImplementation();
  onSnapshot.mockImplementation((ref, callback, ...rest) => {
    if ((ref.path || ref).endsWith('/salesCatalogItems')) { callback({ docs: [snapshot(service.id, service)] }); return () => {}; }
    return previousOnSnapshot(ref, callback, ...rest);
  });
  const materials = withProduct ? [{ id: 'quoted-pump', name: 'Quoted pump', quantity: '2', genericItemId: 'sell-pump', dbItemId: 'db-pump', plannedUnitPriceCents: 120000, plannedTotalPriceCents: 240000, plannedUnitCostCents: 70000, plannedTotalCostCents: 140000, status: 'Need to Purchase' }] : [];
  const tasks = withInstallTask ? [{ id: 'existing-install', name: 'Install the pump', type: 'Install', status: 'Unassigned', shoppingListItemIds: [], dataBaseItemId: '', genericItemId: '' }] : [];
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    const records = path.endsWith('genericItems/genericItems') ? [product]
      : path.endsWith('dataBase/dataBase') ? [supplier]
        : path.endsWith('/salesCatalogItems') ? [service]
          : path.endsWith('/workOrders/job-1/tasks') ? tasks
            : path.endsWith('/shoppingList') ? materials : null;
    return records ? { docs: records.map((item) => snapshot(item.id, { ...item })), empty: !records.length, size: records.length } : previousGetDocs(ref);
  });
  mockBatchCommit = async (writes) => {
    writes.forEach((write) => {
      const records = write.ref.includes('/workOrders/job-1/tasks/') ? tasks : write.ref.includes('/shoppingList/') ? materials : null;
      if (!records) return;
      const id = write.ref.split('/').pop();
      const index = records.findIndex((item) => item.id === id);
      if (write.type === 'set' && index < 0) records.push({ ...write.data });
      else if (write.type === 'update' && index >= 0) Object.assign(records[index], write.data);
    });
  };
  return { materials, tasks };
};

test.each([true, false])('adding an install service links or creates its plan product without duplicate billing (existing product: %s)', async (withProduct) => {
  const { materials, tasks } = installProductLinkFixtures({ withProduct });
  await openJob();
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  const productsHeading = await screen.findByRole('heading', { name: 'Products', exact: true });
  const servicesHeading = screen.getByRole('heading', { name: 'Services', exact: true });
  expect(productsHeading.compareDocumentPosition(servicesHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Service', exact: true })[0]);
  const name = await screen.findByText('Install pump service', { exact: true });
  await act(async () => { fireEvent.click(within(name.closest('tr')).getByRole('button', { name: 'Add', exact: true })); });
  await waitFor(() => expect(tasks).toHaveLength(1));
  expect(materials).toHaveLength(1);
  expect(tasks[0]).toEqual(expect.objectContaining({ genericItemId: 'sell-pump', dataBaseItemId: 'db-pump', shoppingListItemId: materials[0].id, shoppingListItemIds: [materials[0].id] }));
  expect(materials[0].linkedTaskIds).toContain(tasks[0].id);
  expect(mockBatchWrites.filter((write) => write.type === 'set' && write.ref.includes('/shoppingList/'))).toHaveLength(withProduct ? 0 : 1);
  expect(materials[0].plannedUnitPriceCents).toBe(withProduct ? 120000 : 150000);
  expect(materials[0].quantity).toBe(withProduct ? '2' : '1');
  expect(mockJob.laborLineItems[0].totalPriceCents).toBe(30000);
});

test('adding a product first connects an unambiguous install task and its database item', async () => {
  const { materials, tasks } = installProductLinkFixtures({ withProduct: false, withInstallTask: true });
  await openJob();
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add first product', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Add Product Line' });
  const chooser = within(dialog).getByRole('combobox', { name: 'Select purchase line item' });
  fireEvent.keyDown(chooser, { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(await screen.findByText('Variable speed pump', { exact: true }));
  expect(within(dialog).getByRole('combobox', { name: 'Linked Task' })).toHaveValue('existing-install');
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add Part', exact: true })); });
  await waitFor(() => expect(materials).toHaveLength(1));
  expect(materials[0]).toEqual(expect.objectContaining({ genericItemId: 'sell-pump', dbItemId: 'db-pump', linkedTaskId: 'existing-install', linkedTaskIds: ['existing-install'] }));
  expect(tasks[0]).toEqual(expect.objectContaining({ genericItemId: 'sell-pump', dataBaseItemId: 'db-pump', shoppingListItemId: materials[0].id }));
});


const installEditablePlan = () => {
  const plans = installSavedPlanFixtures();
  const tasks = [{ id: 'task-1', name: 'Inspect pump', type: 'Basic', status: 'Unassigned', contractedRate: 1500, billingLaborPriceCents: 5000, estimatedTime: 30 }];
  const lines = [{ id: 'line-1', name: 'Inspection service', quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000, internalCostCents: 1500, taskIds: ['task-1'] }];
  Object.assign(plans[0], { tasks: tasks.map((task) => ({ ...task })), laborLineItems: lines.map((line) => ({ ...line })), totalAmountCents: 5000 });
  Object.assign(mockJob, { laborLineItems: lines, rate: 5000, laborCost: 1500 });
  const originalGetDocs = getDocs.getMockImplementation();
  getDocs.mockImplementation(async (ref) => {
    const path = ref.path || ref;
    if (path.endsWith('/workOrders/job-1/tasks')) return { docs: tasks.map((task) => snapshot(task.id, task)) };
    return originalGetDocs(ref);
  });
  mockBatchCommit = async (writes) => {
    writes.filter((write) => write.ref.endsWith('/tasks/task-1') && ['set', 'update'].includes(write.type))
      .forEach((write) => Object.assign(tasks[0], write.data));
  };
  return { plans, tasks };
};
const openPlanEditor = async () => {
  await openJob();
  fireEvent.click(screen.getByRole('button', { name: /^Create Plans/ }));
  const name = await screen.findByRole('textbox', { name: 'Plan Name', exact: true });
  await waitFor(() => expect(name).toHaveValue('Saved plan A'));
  return name;
};
const savedPlanWrites = () => mockBatchWrites.filter((write) => write.type === 'set' && write.ref.endsWith('/plans/plan-A'));

test('plan metadata automatically saves with the selected job and removes the extra save button', async () => {
  installEditablePlan();
  const name = await openPlanEditor();
  expect(screen.queryByRole('button', { name: 'Save Changes', exact: true })).not.toBeInTheDocument();
  fireEvent.change(name, { target: { value: 'Updated inspection' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Plan Description' }), { target: { value: 'Updated scope' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Recommendation Rank' }), { target: { value: '3' } });
  await waitFor(() => expect(savedPlanWrites()).toHaveLength(1));
  expect(savedPlanWrites()[0].data).toEqual(expect.objectContaining({ title: 'Updated inspection', description: 'Updated scope', planTier: 3, totalAmountCents: 5000 }));
  expect(mockJob).toEqual(expect.objectContaining({ activePlanId: 'plan-A', activePlanTier: 3, rate: 5000, laborCost: 1500, estimateTotalCents: 5000 }));
  await screen.findByText('All changes saved');
  expect(savedPlanWrites()).toHaveLength(1);
  expect(mockBatchWrites.some((write) => write.ref.endsWith('/plans/plan-B'))).toBe(false);
});

test('task actions float outside the services table and saving a task updates the plan automatically', async () => {
  installEditablePlan();
  await openPlanEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Task actions', exact: true }));
  const menu = await screen.findByRole('menu');
  expect(menu.closest('table')).toBeNull();
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit Task' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description', exact: true }), { target: { value: 'Inspect and test pump' } });
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Tech Labor Cost', exact: true }), { target: { value: '30' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Task', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Task' })).not.toBeInTheDocument());
  await waitFor(() => expect(savedPlanWrites().some((write) => write.data.tasks[0]?.name === 'Inspect and test pump')).toBe(true));
  expect(mockJob.taskCount).toBe(1);
  expect(mockJob.laborCost).toBe(3000);
  expect(savedPlanWrites().at(-1).data.laborCostCents).toBe(3000);
});

test('switching plans flushes pending edits without a discard confirmation', async () => {
  installSavedPlanFixtures();
  const name = await openPlanEditor();
  fireEvent.change(name, { target: { value: 'Saved before switch' } });
  mockWorkspaceCall.mockImplementation(async () => {
    expect(savedPlanWrites().at(-1).data.title).toBe('Saved before switch');
    mockJob.activePlanId = 'plan-B';
    return { data: { planId: 'plan-B' } };
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Editing plan' }), { target: { value: 'plan-B' } });
  await waitFor(() => expect(name).toHaveValue('Saved plan B'));
  expect(appConfirm).not.toHaveBeenCalled();
  expect(mockJob.activePlanId).toBe('plan-B');
});

test('autosave failures keep the latest draft visible and expose a retry', async () => {
  installEditablePlan();
  const name = await openPlanEditor();
  mockBatchError = new Error('offline');
  fireEvent.change(name, { target: { value: 'Keep this draft' } });
  const retry = await screen.findByRole('button', { name: 'Retry save' });
  expect(name).toHaveValue('Keep this draft');
  expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();
  mockBatchError = null;
  fireEvent.click(retry);
  await screen.findByText('All changes saved');
  expect(savedPlanWrites().at(-1).data.title).toBe('Keep this draft');
});


test('an earlier autosave response cannot replace a newer plan name, including a reversion', async () => {
  installEditablePlan();
  const name = await openPlanEditor();
  let finishWrite;
  const pendingWrite = new Promise((resolve) => { finishWrite = resolve; });
  mockBatchCommit = jest.fn().mockReturnValueOnce(pendingWrite);
  fireEvent.change(name, { target: { value: 'First edit' } });
  await waitFor(() => expect(savedPlanWrites()).toHaveLength(1));
  expect(name).toBeEnabled();
  fireEvent.change(name, { target: { value: 'Newer edit' } });
  fireEvent.change(name, { target: { value: 'Saved plan A' } });
  await act(async () => { finishWrite(); });
  await screen.findByText('All changes saved');
  expect(name).toHaveValue('Saved plan A');
  expect(savedPlanWrites().at(-1).data.title).toBe('Saved plan A');
});

test("Actual job view lists linked offers and opens their shared editor with list refresh after saving", async () => {
  mockPermissions.push("324", "328");
  let offer = { id: "comp_work_offer_job", jobId: "job-1", title: "Existing pump offer", status: "Sent", offerType: "Direct User", offeredToUserId: "tech", offeredToUserName: "Alex", jobTaskIds: ["task"], estimatedMinutes: 60, paySource: "Offered Amount", offeredAmountCents: 10000, revision: 1 };
  const offerCall = jest.fn(async payload => {
    if (payload.action === "update") {
      offer = { ...offer, ...payload.changes, revision: 2 };
      return { data: { offerId: offer.id, revision: 2 } };
    }
    if (payload.action === "details") return { data: { offer, scope: { tasks: [], services: [], products: [], stops: [] }, management: { canEdit: true, canDelete: true, canIncentivize: true, termsLocked: false } } };
    return { data: { offers: [offer] } };
  });
  httpsCallable.mockImplementation((functions, name) => name === "manageTechnicianWork" ? offerCall : mockWorkspaceCall);
  await openJob({ pathname: "/company/jobs/detail/job-1/actual" });
  const card = await screen.findByRole("article", { name: "Work offer: Existing pump offer" });
  expect(within(card).getByRole("button", { name: "Open offer" })).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Delete offer" })).toBeEnabled();
  fireEvent.click(within(card).getByRole("button", { name: "Edit offer" }));
  fireEvent.change(await screen.findByLabelText("Offer title"), { target: { value: "Revised pump offer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
  expect(await screen.findByRole("article", { name: "Work offer: Revised pump offer" })).toBeInTheDocument();
  expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "list", jobId: "job-1" }));
  expect(offerCall).toHaveBeenCalledWith(expect.objectContaining({ action: "update", offerId: "comp_work_offer_job", revision: 1 }));
});
