import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { deleteDoc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { appConfirm, appPrompt } from "../../../utils/appDialog";
import JobDetailView from "./JobDetailView";

let mockJob;
let mockPermissions;
let mockBatchWrites;
let mockBatchError;
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
jest.mock("../../components/share/ShareItemButton", () => () => null);
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
        mockBatchWrites.filter((write) => write.ref.endsWith("workOrders/job-1")).forEach((write) => Object.assign(mockJob, write.data));
      },
    }),
  };
});

const snapshot = (id, data) => ({ id, ref: id, exists: () => Boolean(data), data: () => data });
const openJob = async () => {
  await act(async () => { render(
    <MemoryRouter initialEntries={["/company/jobs/detail/job-1/overview"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Context.Provider value={{ recentlySelectedCompany: "company-1", user: { uid: "user-1" } }}>
        <Routes><Route path="/company/jobs/detail/:jobId/:section?" element={<JobDetailView />} /></Routes>
      </Context.Provider>
    </MemoryRouter>
  ); });
  await screen.findByText("11 Old Street");
};
const openActions = () => fireEvent.click(screen.getByRole("button", { name: "Actions", exact: true }));
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
  mockPermissions = ["24", "26"];
  mockBatchWrites = [];
  mockBatchError = null;
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
  setDoc.mockImplementation((path) => path.includes('/shoppingList/') ? pendingWrite : Promise.resolve());
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
  expect(setDoc.mock.calls.filter(([path]) => path.includes('/shoppingList/'))).toHaveLength(1);
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
  setDoc.mockRejectedValueOnce(new Error('Connection interrupted'));
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
    expect(setDoc.mock.calls.filter(([path]) => path.includes('/shoppingList/'))).toHaveLength(2);
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
