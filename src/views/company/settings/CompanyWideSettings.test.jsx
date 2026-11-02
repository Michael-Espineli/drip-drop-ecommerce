import React, { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getDoc, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import CompanyWideSettings from "./CompanyWideSettings";

const mockRequirePermission = jest.fn();
jest.mock("../../../hooks/useCompanyPermissions", () => () => ({ requirePermission: mockRequirePermission }));
jest.mock("../../../context/AuthContext", () => ({ Context: require("react").createContext() }));
jest.mock("../../../utils/config", () => ({ db: {} }));
jest.mock("react-hot-toast", () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock("firebase/firestore", () => ({
  doc: (_, ...parts) => parts.join("/"), collection: (_, ...parts) => parts.join("/"), getDoc: jest.fn(),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }), serverTimestamp: () => "server-time", writeBatch: jest.fn(),
}));
let storedSettings;
let batch;
const view = (company = "company") => <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
  <Context.Provider value={{ recentlySelectedCompany: company, user: { uid: "manager" }, setCustomerBillingEnabled: jest.fn(), setPayrollEnabled: jest.fn(), setSalesBillingAutomationEnabled: jest.fn() }}>
    <CompanyWideSettings />
  </Context.Provider>
</MemoryRouter>;
beforeEach(() => {
  jest.clearAllMocks();
  storedSettings = {};
  mockRequirePermission.mockReturnValue(true);
  batch = { set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
  getDoc.mockImplementation(async (path) => ({ id: path.split('/').pop(), exists: () => path.endsWith('/companyWide'), data: () => storedSettings[path] || {} }));
});

test("an older company defaults to 2x and saves a changed multiplier under company settings", async () => {
  render(view());
  const input = await screen.findByLabelText('Labor multiplier');
  expect(input).toHaveValue(2);
  fireEvent.change(input, { target: { value: '2.5' } });
  expect(screen.getByText(/\$100.00 suggested customer price/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalledTimes(1));
  expect(mockRequirePermission).toHaveBeenCalledWith('900', 'update company-wide settings');
  expect(batch.set).toHaveBeenCalledWith('companies/company/settings/companyWide', expect.objectContaining({ laborMultiplier: 2.5, updatedByUserId: 'manager' }), { merge: true });
  expect(batch.set).toHaveBeenCalledTimes(1);
  expect(batch.set.mock.calls[0][1]).not.toHaveProperty('payrollEnabled');
  expect(batch.set.mock.calls.filter(([path]) => path !== 'companies/company/settings/companyWide').every(([, payload]) => !Object.hasOwn(payload, 'laborMultiplier'))).toBe(true);
});

test("invalid multipliers cannot be saved and existing settings load before edits", async () => {
  storedSettings['companies/company/settings/companyWide'] = { laborMultiplier: 3 };
  render(view());
  const input = await screen.findByLabelText('Labor multiplier');
  expect(input).toHaveValue(3);
  for (const value of ['', '0', '-2']) {
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  }
  expect(writeBatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Defaults' }));
  expect(input).toHaveValue(2);
});

test("a company switch loads its own multiplier and permission denial prevents writes", async () => {
  storedSettings['companies/first/settings/companyWide'] = { laborMultiplier: 4 };
  storedSettings['companies/second/settings/companyWide'] = { laborMultiplier: 1.5 };
  const { rerender } = render(view('first'));
  expect(await screen.findByLabelText('Labor multiplier')).toHaveValue(4);
  fireEvent.change(screen.getByLabelText('Labor multiplier'), { target: { value: '5' } });
  rerender(view('second'));
  await waitFor(() => expect(screen.getByLabelText('Labor multiplier')).toHaveValue(1.5));
  mockRequirePermission.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(writeBatch).not.toHaveBeenCalled();
});

test("a settings read failure cannot overwrite the company with defaults", async () => {
  getDoc.mockImplementation(async (path) => {
    if (path.endsWith('/companyWide')) throw new Error('permission-denied');
    return { exists: () => false };
  });
  render(view());
  expect(await screen.findByRole('alert')).toHaveTextContent('Company settings could not be loaded');
  expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(writeBatch).not.toHaveBeenCalled();
});

test("a save finishing after a company switch does not replace the new company's settings", async () => {
  let finishSave;
  batch.commit.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
  storedSettings['companies/first/settings/companyWide'] = { laborMultiplier: 4, routeCoverageMode: 'review' };
  storedSettings['companies/second/settings/companyWide'] = { laborMultiplier: 1.5, routeCoverageMode: 'notify' };
  const { rerender } = render(view('first'));
  await screen.findByLabelText('Labor multiplier');
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  rerender(view('second'));
  await waitFor(() => expect(screen.getByLabelText('Labor multiplier')).toHaveValue(1.5));
  await act(async () => { finishSave(); });
  expect(screen.getByLabelText('Labor multiplier')).toHaveValue(1.5);
  expect(screen.getByLabelText('Route coverage approval')).toHaveValue('notify');
});

test("an intentional payroll setting change still mirrors its enablement while retaining the labor multiplier", async () => {
  storedSettings['companies/company/settings/companyWide'] = { laborMultiplier: 3, payrollEnabled: true };
  render(view());
  await screen.findByLabelText('Labor multiplier');
  fireEvent.click(screen.getByRole('checkbox', { name: /Payroll enabled/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(batch.commit).toHaveBeenCalled());
  expect(batch.set).toHaveBeenCalledWith('companies/company/settings/companyWide', expect.objectContaining({ laborMultiplier: 3, payrollEnabled: false }), { merge: true });
  expect(batch.set).toHaveBeenCalledWith('companies/company/paySettings/main', expect.objectContaining({ payrollEnabled: false }), { merge: true });
  expect(batch.set).toHaveBeenCalledWith('companies/company', expect.objectContaining({ payrollEnabled: false }), { merge: true });
});
