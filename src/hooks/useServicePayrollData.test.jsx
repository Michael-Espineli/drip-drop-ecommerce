import React from "react";
import { act, render, screen } from "@testing-library/react";
import { onSnapshot } from "firebase/firestore";
import useServicePayrollData from "./useServicePayrollData";

jest.mock("../utils/config", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({
  collection: (_, ...parts) => parts.join("/"), doc: (_, ...parts) => parts.join("/"), onSnapshot: jest.fn(),
}));
let subscriptions;
function Preview({ companyId, enabled = true }) {
  return <output data-testid="setup">{JSON.stringify(useServicePayrollData(companyId, enabled))}</output>;
}
const setup = () => JSON.parse(screen.getByTestId("setup").textContent);
const emit = (subscription, data, document = false) => act(() => subscription.callback(document
  ? { exists: () => true, data: () => data }
  : { docs: data.map((value) => ({ id: value.id, data: () => value })) }));
beforeEach(() => {
  subscriptions = [];
  onSnapshot.mockReset();
  onSnapshot.mockImplementation((path, callback, error) => {
    const subscription = { path, callback, error, unsubscribe: jest.fn() };
    subscriptions.push(subscription);
    return subscription.unsubscribe;
  });
});

test("waits for all setup sources and reacts to company-wide payroll disabling", () => {
  render(<Preview companyId="company" />);
  expect(setup().loading).toBe(true);
  subscriptions.slice(0, 3).forEach((subscription) => emit(subscription, []));
  emit(subscriptions[3], { taskPaySource: "technicianRate", payrollEnabled: true }, true);
  expect(setup().loading).toBe(true);
  emit(subscriptions[4], { payrollEnabled: false }, true);
  expect(setup()).toEqual(expect.objectContaining({ loading: false, settings: expect.objectContaining({ payrollEnabled: false }) }));
  emit(subscriptions[4], { payrollEnabled: true }, true);
  expect(setup().settings.payrollEnabled).toBe(true);
});

test("company changes unsubscribe and reject late rate callbacks from the previous company", () => {
  const view = render(<Preview companyId="first" />);
  const old = [...subscriptions];
  view.rerender(<Preview companyId="second" />);
  expect(old.every((subscription) => subscription.unsubscribe.mock.calls.length === 1)).toBe(true);
  emit(old[2], [{ id: "private-old-rate", amountCents: 99999 }]);
  expect(setup().companyId).toBe("second");
  expect(setup().rates).toEqual([]);
  const current = subscriptions.slice(5);
  view.unmount();
  expect(current.every((subscription) => subscription.unsubscribe.mock.calls.length === 1)).toBe(true);
});

test("closed forms do not subscribe and access errors stay distinct from empty rates", () => {
  const view = render(<Preview companyId="company" enabled={false} />);
  expect(onSnapshot).not.toHaveBeenCalled();
  view.rerender(<Preview companyId="company" />);
  act(() => subscriptions[2].error(new Error("permission-denied")));
  expect(setup().error).toMatch(/payroll access/);
});
