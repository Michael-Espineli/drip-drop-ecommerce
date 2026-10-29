import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getDocs, setDoc } from "firebase/firestore";
import CreatePayrollPayItemDialog from "./CreatePayrollPayItemDialog";

const mockRequirePermission = jest.fn();
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ requirePermission: mockRequirePermission }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"),
  doc: (_, ...parts) => parts.join("/"),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
}));

const row = (id, data) => ({ id, data: () => data });
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { global.ResizeObserver = originalResizeObserver; });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequirePermission.mockReturnValue(true);
  getDocs.mockResolvedValue({ docs: [] });
  setDoc.mockResolvedValue(undefined);
});

const openDialog = async () => {
  const onCreated = jest.fn();
  const onClose = jest.fn();
  render(<CreatePayrollPayItemDialog companyId="company-1" userId="user-1" initialName="Filter cleaning" onCreated={onCreated} onClose={onClose} />);
  const submit = screen.getByRole("button", { name: "Create & select" });
  await waitFor(() => expect(submit).toBeEnabled());
  return { submit, onCreated, onClose };
};

test("custom bucket defaults are saved as a company pay item and returned for selection", async () => {
  getDocs.mockImplementation(async (path) => ({ docs: path.endsWith("companyStopPayBuckets")
    ? [row("custom", { label: "Special jobs", category: "Job", defaultWorkCategory: "repair", defaultRateType: "hourly", defaultIconName: "wrench" })]
    : [row("old", { name: "Old item", sortOrder: 30 })] }));
  const { submit, onCreated } = await openDialog();
  fireEvent.change(screen.getByLabelText("Stop bucket"), { target: { value: "custom" } });
  expect(screen.getByLabelText("Pay category")).toHaveValue("repair");
  expect(screen.getByLabelText("Rate type")).toHaveValue("hourly");
  fireEvent.click(submit);
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  const payload = onCreated.mock.calls[0][0];
  expect(payload).toEqual(expect.objectContaining({
    companyId: "company-1", name: "Filter cleaning", bucketId: "custom", bucketLabel: "Special jobs",
    stopPayBucketId: "custom", serviceStopCategory: "Job", category: "repair", defaultRateType: "hourly",
    defaultStackBehavior: "stackable", iconName: "wrench", sortOrder: 40, isActive: true,
    createdByUserId: "user-1", updatedByUserId: "user-1",
  }));
  expect(setDoc).toHaveBeenCalledWith(`companies/company-1/companyPayTypes/${payload.id}`, payload, { merge: true });
});

test("duplicate active names are rejected without creating another pay item", async () => {
  getDocs.mockImplementation(async (path) => ({ docs: path.endsWith("companyPayTypes")
    ? [row("existing", { name: " FILTER CLEANING ", isActive: true })] : [] }));
  const { submit, onCreated } = await openDialog();
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  expect(setDoc).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});

test("a failed save preserves the form for retry and prevents simultaneous writes", async () => {
  setDoc.mockRejectedValueOnce(new Error("Unavailable"));
  const { submit, onCreated } = await openDialog();
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your service draft is still open");
  expect(screen.getByLabelText("Name")).toHaveValue("Filter cleaning");
  let finishSave;
  setDoc.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
  fireEvent.click(submit);
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(2));
  fireEvent.submit(submit.closest("form"));
  expect(setDoc).toHaveBeenCalledTimes(2);
  finishSave();
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
});

test("pay item creation checks Manage Payroll permission before saving", async () => {
  mockRequirePermission.mockReturnValue(false);
  const { submit, onCreated } = await openDialog();
  fireEvent.click(submit);
  expect(mockRequirePermission).toHaveBeenCalledWith("424", "create payroll pay items");
  expect(setDoc).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});
