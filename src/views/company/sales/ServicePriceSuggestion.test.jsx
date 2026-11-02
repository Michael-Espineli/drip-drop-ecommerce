import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ServicePriceSuggestion from "./ServicePriceSuggestion";

test("suggestions follow internal cost and saved company multiplier without applying a price automatically", () => {
  const onApply = jest.fn();
  const view = render(<ServicePriceSuggestion data={{ companySettings: { laborMultiplier: 2.5 } }} costInput="40" onApply={onApply} />);
  expect(screen.getByText('Suggested customer price: $100.00')).toBeInTheDocument();
  view.rerender(<ServicePriceSuggestion data={{ companySettings: { laborMultiplier: 3 } }} costInput="50" onApply={onApply} />);
  expect(screen.getByText('Suggested customer price: $150.00')).toBeInTheDocument();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use suggested customer price' }));
  expect(onApply).toHaveBeenCalledWith(15000);
});

test("an absent setting uses 2x, blank cost is not zero, and an explicit free price can be applied", () => {
  const onApply = jest.fn();
  const view = render(<ServicePriceSuggestion data={{ companySettings: {} }} costInput="" onApply={onApply} />);
  expect(screen.getByRole('button', { name: 'Use suggested customer price' })).toBeDisabled();
  view.rerender(<ServicePriceSuggestion data={{ companySettings: {} }} costInput="0" onApply={onApply} />);
  expect(screen.getByText('Suggested customer price: $0.00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use suggested customer price' }));
  expect(onApply).toHaveBeenCalledWith(0);
  view.rerender(<ServicePriceSuggestion data={{ companySettings: {} }} costInput="40" onApply={onApply} />);
  expect(screen.getByText('Suggested customer price: $80.00')).toBeInTheDocument();
});

test("pending or inaccessible company settings do not suggest a default, while unavailable payroll does not block pricing", () => {
  const view = render(<ServicePriceSuggestion data={{ companySettingsLoading: true }} costInput="40" onApply={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading company labor multiplier');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<ServicePriceSuggestion data={{ companySettingsError: 'permission-denied' }} costInput="40" onApply={jest.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('multiplier could not be loaded');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<ServicePriceSuggestion data={{ error: 'Payroll unavailable', companySettings: { laborMultiplier: 3 } }} costInput="40" onApply={jest.fn()} />);
  expect(screen.getByText('Suggested customer price: $120.00')).toBeInTheDocument();
});
